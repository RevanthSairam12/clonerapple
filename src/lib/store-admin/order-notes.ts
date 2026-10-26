import { randomBytes } from 'node:crypto';

import { getSql } from '@/lib/admin/db';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Order notes must be read and written on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

export const NOTE_MIN_LENGTH = 1;
export const NOTE_MAX_LENGTH = 2000;

export interface OrderNote {
  id: string;
  body: string;
  authorName: string;
  authorEmail: string;
  createdAt: string;
}

export type NoteLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'invalid-input' };

/** Trim and check a note body; returns the cleaned text or an error message. */
export function validateNoteBody(value: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof value === 'string' ? value.trim() : '';
  if (body.length < NOTE_MIN_LENGTH) {
    return { ok: false, error: 'Write a note before saving.' };
  }
  if (body.length > NOTE_MAX_LENGTH) {
    return { ok: false, error: `Keep the note under ${NOTE_MAX_LENGTH} characters.` };
  }
  return { ok: true, body };
}

function noteFromRow(row: Row): OrderNote {
  return {
    id: text(row.id),
    body: text(row.body),
    authorName: text(row.author_name),
    authorEmail: text(row.author_email),
    createdAt: iso(row.created_at),
  };
}

export async function listOrderNotes(orderId: string): Promise<NoteLoad<OrderNote[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select id, body, author_name, author_email, created_at
      from order_notes
      where order_id = ${orderId}
      order by created_at desc, id desc
      limit 200
    `) as Row[];
    return { ok: true, data: rows.map(noteFromRow) };
  } catch {
    console.warn('[store-admin/order-notes] could not read notes');
    return { ok: false, reason: 'unavailable' };
  }
}

export interface AddNoteInput {
  orderId: string;
  body: unknown;
  authorId: string;
  authorName: string;
  authorEmail: string;
}

export async function addOrderNote(input: AddNoteInput): Promise<NoteLoad<OrderNote>> {
  const validation = validateNoteBody(input.body);
  if (!validation.ok) return { ok: false, reason: 'invalid-input' };

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const id = `note_${randomBytes(10).toString('hex')}`;
  try {
    const rows = (await sql`
      insert into order_notes (
        id, order_id, body, author_id, author_name, author_email, created_at
      ) values (
        ${id}, ${input.orderId}, ${validation.body}, ${input.authorId},
        ${input.authorName}, ${input.authorEmail}, now()
      )
      returning id, body, author_name, author_email, created_at
    `) as Row[];
    if (!rows[0]) return { ok: false, reason: 'unavailable' };
    return { ok: true, data: noteFromRow(rows[0]) };
  } catch (error) {
    // A foreign-key miss means the order disappeared between page load and save.
    if (error instanceof Error && /foreign key/i.test(error.message)) {
      return { ok: false, reason: 'not-found' };
    }
    console.warn('[store-admin/order-notes] could not write a note');
    return { ok: false, reason: 'unavailable' };
  }
}

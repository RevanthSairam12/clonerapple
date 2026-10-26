import { randomBytes } from 'node:crypto';

import { getSql } from '@/lib/admin/db';

/**
 * Append-only staff notes about a customer account.
 *
 * Same shape and rules as `order-notes.ts`: a note is never edited or deleted,
 * a correction is a new note, and the author is kept denormalised so the note
 * keeps its context if the staff account is later removed.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Customer notes must be read and written on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

export const CUSTOMER_NOTE_MIN_LENGTH = 1;
export const CUSTOMER_NOTE_MAX_LENGTH = 2000;

export interface CustomerNote {
  id: string;
  body: string;
  authorName: string;
  authorEmail: string;
  createdAt: string;
}

export type CustomerNoteLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'invalid-input' };

export function validateCustomerNoteBody(
  value: unknown,
): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof value === 'string' ? value.trim() : '';
  if (body.length < CUSTOMER_NOTE_MIN_LENGTH) {
    return { ok: false, error: 'Write a note before saving.' };
  }
  if (body.length > CUSTOMER_NOTE_MAX_LENGTH) {
    return { ok: false, error: `Keep the note under ${CUSTOMER_NOTE_MAX_LENGTH} characters.` };
  }
  return { ok: true, body };
}

function noteFromRow(row: Row): CustomerNote {
  return {
    id: text(row.id),
    body: text(row.body),
    authorName: text(row.author_name),
    authorEmail: text(row.author_email),
    createdAt: iso(row.created_at),
  };
}

export async function listCustomerNotes(
  customerId: string,
): Promise<CustomerNoteLoad<CustomerNote[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select id, body, author_name, author_email, created_at
      from customer_notes
      where user_id = ${customerId}
      order by created_at desc, id desc
      limit 200
    `) as Row[];
    return { ok: true, data: rows.map(noteFromRow) };
  } catch {
    console.warn('[store-admin/customer-notes] could not read notes');
    return { ok: false, reason: 'unavailable' };
  }
}

export interface AddCustomerNoteInput {
  customerId: string;
  body: unknown;
  authorId: string;
  authorName: string;
  authorEmail: string;
}

export async function addCustomerNote(
  input: AddCustomerNoteInput,
): Promise<CustomerNoteLoad<CustomerNote>> {
  const validation = validateCustomerNoteBody(input.body);
  if (!validation.ok) return { ok: false, reason: 'invalid-input' };

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const id = `cnote_${randomBytes(10).toString('hex')}`;
  try {
    const rows = (await sql`
      insert into customer_notes (
        id, user_id, body, author_id, author_name, author_email, created_at
      ) values (
        ${id}, ${input.customerId}, ${validation.body}, ${input.authorId},
        ${input.authorName}, ${input.authorEmail}, now()
      )
      returning id, body, author_name, author_email, created_at
    `) as Row[];
    if (!rows[0]) return { ok: false, reason: 'unavailable' };
    return { ok: true, data: noteFromRow(rows[0]) };
  } catch (error) {
    if (error instanceof Error && /foreign key/i.test(error.message)) {
      return { ok: false, reason: 'not-found' };
    }
    console.warn('[store-admin/customer-notes] could not write a note');
    return { ok: false, reason: 'unavailable' };
  }
}

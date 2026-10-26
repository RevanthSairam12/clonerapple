import { getSql } from '@/lib/admin/db';

import { maskCustomerEmail, maskCustomerPhone } from './masking';
import { maskCustomerName } from './orders';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Order edits must be written on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

export const EDIT_REASON_MIN = 10;
export const EDIT_REASON_MAX = 200;

export interface OrderEditLog {
  id: string;
  actorEmail: string;
  changedFields: string[];
  reason: string;
  createdAt: string;
}

export interface ContactEditInput {
  customerName?: unknown;
  customerEmail?: unknown;
  customerPhone?: unknown;
  shipTo?: {
    fullName?: unknown;
    phone?: unknown;
    line1?: unknown;
    line2?: unknown;
    city?: unknown;
    state?: unknown;
    postalCode?: unknown;
    country?: unknown;
  } | null;
  reason?: unknown;
}

export type OrderEditResult =
  | { ok: true; orderId: string; changedFields: string[] }
  | {
      ok: false;
      reason: 'unavailable' | 'not-found' | 'invalid-input' | 'not-editable';
      error: string;
    };

function fail(
  reason: Extract<OrderEditResult, { ok: false }>['reason'],
  error: string,
): OrderEditResult {
  return { ok: false, reason, error };
}

/* ------------------------------------------------------ validation */

const NAME_RE = /^[\p{L}\p{M} .'’-]{1,120}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return '';
  return String(value).trim();
}

function cleanPhone(value: string): string | null {
  const stripped = value.replace(/[\s().-]/g, '');
  if (!/^\+?\d{6,15}$/.test(stripped)) return null;
  return stripped;
}

/** Returns the value to store, `undefined` for "leave unchanged", or an error. */
function validateContact(input: ContactEditInput):
  | { ok: true; name?: string; email?: string; phone?: string }
  | { ok: false; error: string } {
  const name = optionalText(input.customerName);
  if (name !== undefined && name !== '' && !NAME_RE.test(name)) {
    return { ok: false, error: 'Customer name may only use letters, spaces, dots, hyphens and apostrophes.' };
  }

  const email = optionalText(input.customerEmail);
  if (email !== undefined && email !== '' && (email.length > 254 || !EMAIL_RE.test(email))) {
    return { ok: false, error: 'Enter a valid customer email address, or leave it blank to keep the current one.' };
  }

  const rawPhone = optionalText(input.customerPhone);
  let phone: string | undefined;
  if (rawPhone !== undefined && rawPhone !== '') {
    const cleaned = cleanPhone(rawPhone);
    if (!cleaned) return { ok: false, error: 'Enter a phone number with 6 to 15 digits.' };
    phone = cleaned;
  }

  return {
    ok: true,
    name: name === '' ? undefined : name,
    email: email ? email.toLowerCase() : undefined,
    phone: phone === '' ? undefined : phone,
  };
}

interface AddressInput {
  fullName?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

function validateAddress(input: NonNullable<ContactEditInput['shipTo']>): {
  ok: true;
  values: AddressInput;
  provided: boolean;
} | { ok: false; error: string } {
  const values: AddressInput = {};
  const limit = (label: string, value: unknown, max: number) => {
    const clean = optionalText(value);
    if (clean === undefined || clean === '') return undefined;
    if (clean.length > max) return null;
    values[label as keyof AddressInput] = clean;
    return clean;
  };

  const fields: Array<[keyof AddressInput, unknown, number]> = [
    ['fullName', input.fullName, 120],
    ['phone', input.phone, 40],
    ['line1', input.line1, 200],
    ['line2', input.line2, 200],
    ['city', input.city, 120],
    ['state', input.state, 120],
    ['postalCode', input.postalCode, 16],
    ['country', input.country, 60],
  ];
  for (const [key, value, max] of fields) {
    if (limit(key, value, max) === null) {
      return { ok: false, error: `The ${key} value is too long.` };
    }
  }

  if (values.phone) {
    const cleaned = cleanPhone(values.phone);
    if (!cleaned) return { ok: false, error: 'Enter a delivery phone number with 6 to 15 digits.' };
    values.phone = cleaned;
  }
  if (values.postalCode && !/^[A-Za-z0-9 -]{3,12}$/.test(values.postalCode)) {
    return { ok: false, error: 'Enter a valid postal code.' };
  }

  return { ok: true, values, provided: Object.keys(values).length > 0 };
}

/* ---------------------------------------------------------- reads */

export async function listOrderEdits(orderId: string): Promise<
  { ok: true; data: OrderEditLog[] } | { ok: false; reason: 'unavailable' }
> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select id, actor_email, changed_fields, reason, created_at
      from order_edit_logs
      where order_id = ${orderId}
      order by created_at desc, id desc
      limit 50
    `) as Row[];
    return {
      ok: true,
      data: rows.map((row) => ({
        id: text(row.id),
        actorEmail: text(row.actor_email),
        changedFields: Array.isArray(row.changed_fields)
          ? (row.changed_fields as unknown[]).map((field) => text(field))
          : [],
        reason: text(row.reason),
        createdAt: iso(row.created_at),
      })),
    };
  } catch {
    console.warn('[store-admin/order-edits] could not read the edit log');
    return { ok: false, reason: 'unavailable' };
  }
}

/* --------------------------------------------------------- writes */

/**
 * Update the customer contact block and/or the shipping address.
 *
 * Items and amounts are deliberately not editable: the PayU amount is captured
 * at payment time, so changing a line after the fact would break reconciliation.
 * Every applied change is written to the immutable `order_edit_logs` table with
 * masked before/after values — the full email, phone and address never land in
 * the log.
 */
export async function updateOrderContact(input: {
  txnid: string;
  edit: ContactEditInput;
  actorId: string;
  actorEmail: string;
}): Promise<OrderEditResult> {
  const reason = optionalText(input.edit.reason) ?? '';
  if (reason.length < EDIT_REASON_MIN || reason.length > EDIT_REASON_MAX) {
    return fail('invalid-input', `Give a reason between ${EDIT_REASON_MIN} and ${EDIT_REASON_MAX} characters.`);
  }

  const contact = validateContact(input.edit);
  if (!contact.ok) return fail('invalid-input', contact.error);

  const address = input.edit.shipTo ? validateAddress(input.edit.shipTo) : null;
  if (address && !address.ok) return fail('invalid-input', address.error);

  if (
    contact.name === undefined &&
    contact.email === undefined &&
    contact.phone === undefined &&
    !(address && address.ok && address.provided)
  ) {
    return fail('invalid-input', 'Nothing to change. Fill in at least one field.');
  }

  const sql = getSql();
  if (!sql) return fail('unavailable', 'Order records are not available.');

  try {
    return await sql.begin(async (tx) => {
      const orderRows = (await tx`
        select id, customer_name, customer_email, customer_phone
        from orders
        where txnid = ${input.txnid.trim()}
        for update
      `) as Row[];
      const order = orderRows[0];
      if (!order) return fail('not-found', 'Order not found.');

      const orderId = text(order.id);
      const currentName = text(order.customer_name);
      const currentEmail = text(order.customer_email);
      const currentPhone = text(order.customer_phone);

      const nextName = contact.name ?? currentName;
      const nextEmail = contact.email ?? currentEmail;
      const nextPhone = contact.phone ?? currentPhone;

      const changed: string[] = [];
      const before: Record<string, string> = {};
      const after: Record<string, string> = {};

      if (contact.name !== undefined && contact.name !== currentName) {
        changed.push('customer_name');
        before.customer_name = maskCustomerName(currentName);
        after.customer_name = maskCustomerName(nextName);
      }
      if (contact.email !== undefined && contact.email !== currentEmail.toLowerCase()) {
        changed.push('customer_email');
        before.customer_email = maskCustomerEmail(currentEmail);
        after.customer_email = maskCustomerEmail(nextEmail);
      }
      if (contact.phone !== undefined && contact.phone !== currentPhone.replace(/[\s().-]/g, '')) {
        changed.push('customer_phone');
        before.customer_phone = maskCustomerPhone(currentPhone);
        after.customer_phone = maskCustomerPhone(nextPhone);
      }

      if (contact.name !== undefined || contact.email !== undefined || contact.phone !== undefined) {
        await tx`
          update orders
          set customer_name = ${nextName},
              customer_email = ${nextEmail},
              customer_phone = ${nextPhone},
              updated_at = now()
          where id = ${orderId}
        `;
      }

      if (address && address.ok && address.provided) {
        const values = address.values;
        const addressRows = (await tx`
          select id, full_name, phone, line1, line2, city, state, postal_code, country
          from order_addresses
          where order_id = ${orderId} and address_type = 'shipping'
          order by id asc
          limit 1
          for update
        `) as Row[];

        const current = addressRows[0];
        const compared: Array<[keyof AddressInput, string]> = [
          ['fullName', 'full_name'],
          ['phone', 'phone'],
          ['line1', 'line1'],
          ['line2', 'line2'],
          ['city', 'city'],
          ['state', 'state'],
          ['postalCode', 'postal_code'],
          ['country', 'country'],
        ];
        const addressChanged: string[] = [];
        for (const [key, column] of compared) {
          const value = values[key];
          if (value !== undefined && value !== text(current?.[column]).trim()) {
            addressChanged.push(key);
          }
        }

        if (addressChanged.length > 0) {
          if (!current) {
            return fail('not-editable', 'This order has no shipping address to edit. Add a delivery address first.');
          }
          await tx`
            update order_addresses
            set full_name = ${values.fullName ?? text(current.full_name)},
                phone = ${values.phone ?? text(current.phone)},
                line1 = ${values.line1 ?? text(current.line1)},
                line2 = ${values.line2 ?? (current.line2 === null ? null : text(current.line2))},
                city = ${values.city ?? text(current.city)},
                state = ${values.state ?? text(current.state)},
                postal_code = ${values.postalCode ?? text(current.postal_code)},
                country = ${values.country ?? text(current.country)}
            where id = ${text(current.id)}
          `;
          for (const field of addressChanged) {
            changed.push(`ship_to.${field}`);
            before[`ship_to.${field}`] = '[changed]';
            after[`ship_to.${field}`] = '[changed]';
          }
        }
      }

      if (changed.length === 0) {
        return fail('invalid-input', 'Nothing to change — the submitted values match the order.');
      }

      await tx`
        insert into order_edit_logs (
          order_id, actor_id, actor_email, changed_fields, before, after, reason
        ) values (
          ${orderId}, ${input.actorId}, ${input.actorEmail},
          ${changed}, ${tx.json(before)}, ${tx.json(after)}, ${reason}
        )
      `;

      return { ok: true as const, orderId, changedFields: changed };
    });
  } catch {
    console.warn('[store-admin/order-edits] could not update the order');
    return fail('unavailable', 'The order could not be updated.');
  }
}

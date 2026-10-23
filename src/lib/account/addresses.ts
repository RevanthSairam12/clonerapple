import { randomBytes } from 'node:crypto';
import { getSql } from '@/lib/admin/db';
import { validateAddressInput, type ValidatedAddress } from './rules';

export interface CustomerAddress extends ValidatedAddress {
  id: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type AddressRow = {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  is_default: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

function mapAddress(row: AddressRow): CustomerAddress {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2 || '',
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    isDefault: row.is_default,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function listCustomerAddresses(userId: string): Promise<CustomerAddress[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<AddressRow[]>`
    select id, name, phone, line1, line2, city, state, pincode, is_default, created_at, updated_at
    from customer_addresses
    where user_id = ${userId} and deleted_at is null
    order by is_default desc, created_at desc
  `;
  return rows.map(mapAddress);
}

export async function getCustomerAddress(userId: string, id: string): Promise<CustomerAddress | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql<AddressRow[]>`
    select id, name, phone, line1, line2, city, state, pincode, is_default, created_at, updated_at
    from customer_addresses
    where id = ${id} and user_id = ${userId} and deleted_at is null
    limit 1
  `;
  return rows[0] ? mapAddress(rows[0]) : null;
}

export async function createCustomerAddress(userId: string, input: unknown): Promise<CustomerAddress> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');
  const validation = validateAddressInput((input || {}) as Record<string, unknown>);
  if (!validation.ok) throw new Error(validation.error);
  const existing = await sql<{ count: string }[]>`
    select count(*)::text as count from customer_addresses
    where user_id = ${userId} and deleted_at is null
  `;
  if (Number(existing[0]?.count || 0) >= 5) throw new Error('You can save up to 5 addresses.');
  const id = `addr_${randomBytes(12).toString('hex')}`;
  const makeDefault = Boolean((input as { isDefault?: unknown } | null)?.isDefault) || Number(existing[0]?.count || 0) === 0;
  if (makeDefault) {
    await sql`update customer_addresses set is_default = false, updated_at = now() where user_id = ${userId} and deleted_at is null`;
  }
  const rows = await sql<AddressRow[]>`
    insert into customer_addresses (id, user_id, name, phone, line1, line2, city, state, pincode, is_default)
    values (${id}, ${userId}, ${validation.value.name}, ${validation.value.phone}, ${validation.value.line1},
      ${validation.value.line2 || null}, ${validation.value.city}, ${validation.value.state}, ${validation.value.pincode}, ${makeDefault})
    returning id, name, phone, line1, line2, city, state, pincode, is_default, created_at, updated_at
  `;
  return mapAddress(rows[0]);
}

export async function updateCustomerAddress(userId: string, id: string, input: unknown): Promise<CustomerAddress | null> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');
  const validation = validateAddressInput((input || {}) as Record<string, unknown>);
  if (!validation.ok) throw new Error(validation.error);
  const rows = await sql<AddressRow[]>`
    update customer_addresses
    set name = ${validation.value.name}, phone = ${validation.value.phone}, line1 = ${validation.value.line1},
      line2 = ${validation.value.line2 || null}, city = ${validation.value.city}, state = ${validation.value.state},
      pincode = ${validation.value.pincode}, updated_at = now()
    where id = ${id} and user_id = ${userId} and deleted_at is null
    returning id, name, phone, line1, line2, city, state, pincode, is_default, created_at, updated_at
  `;
  return rows[0] ? mapAddress(rows[0]) : null;
}

export async function deleteCustomerAddress(userId: string, id: string): Promise<boolean> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');
  const rows = await sql<{ id: string; was_default: boolean }[]>`
    update customer_addresses
    set deleted_at = now(), is_default = false, updated_at = now()
    where id = ${id} and user_id = ${userId} and deleted_at is null
    returning id, is_default as was_default
  `;
  if (!rows[0]) return false;
  if (rows[0].was_default) {
    await sql`
      update customer_addresses set is_default = true, updated_at = now()
      where id = (
        select id from customer_addresses where user_id = ${userId} and deleted_at is null
        order by created_at desc limit 1
      )
    `;
  }
  return true;
}

export async function setDefaultCustomerAddress(userId: string, id: string): Promise<boolean> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');
  const target = await getCustomerAddress(userId, id);
  if (!target) return false;
  await sql`update customer_addresses set is_default = false, updated_at = now() where user_id = ${userId} and deleted_at is null`;
  await sql`update customer_addresses set is_default = true, updated_at = now() where id = ${id} and user_id = ${userId} and deleted_at is null`;
  return true;
}

import { createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';

import { getSql } from '@/lib/admin/db';
import {
  addMinutes,
  parseReservationPolicy,
  type ReservationPolicy,
} from '@/lib/checkout/reservation-rules';
import { readCheckoutSettings } from '@/lib/checkout/settings';
import { queueNotification } from '@/lib/notifications/queue';
import { releaseReservedStock } from '@/lib/payu/stock';

import {
  canJoinWaitingList,
  invitationIsOpen,
  isInvitationToken,
  nextEligibleCandidate,
  type WaitingListCandidate,
  type WaitingListStatus,
} from './rules';

/**
 * Waiting-list persistence and allocation.
 *
 * Two database facts make allocation safe:
 * - `stock.reserved` is raised in the same transaction that creates the HELD
 *   invitation, so a unit offered to one customer cannot be sold to another;
 * - the partial unique index `idx_stock_reservations_one_held` allows at most
 *   one live invitation per product, so two workers cannot both win.
 *
 * The worker takes the stock row lock first and then the waiting-list rows, so
 * two allocation ticks serialise per product instead of racing. An invitation
 * that expires returns its unit through the same `reserved` counter, and the
 * customer keeps their slot (`EXPIRED`) rather than being silently re-invited
 * inside the cooldown.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: The waiting list must run on the server only.');
}

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;

export const WAITING_LIST_PRODUCT_LINK_PREFIX = '/shop/product/';

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function timeOrNull(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function customerName(first: unknown, last: unknown): string {
  return [text(first), text(last)].filter(Boolean).join(' ').trim();
}

function claimDeadlineLabel(deadline: Date): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(deadline);
  } catch {
    return deadline.toISOString();
  }
}

export interface WaitingListEntry {
  id: string;
  productId: string;
  userId: string;
  status: WaitingListStatus;
  invitedAt: string | null;
  invitationExpiresAt: string | null;
  createdAt: string;
  productName?: string;
  productSlug?: string;
  productIdForLink?: string;
}

export interface WaitingListEntryWithProduct extends WaitingListEntry {
  productName: string;
  productSlug: string;
  pricePaise: number;
}

function mapEntry(row: Row): WaitingListEntry {
  return {
    id: text(row.id),
    productId: text(row.product_id),
    userId: text(row.user_id),
    status: text(row.status) as WaitingListStatus,
    invitedAt: timeOrNull(row.invited_at)?.toISOString() ?? null,
    invitationExpiresAt: timeOrNull(row.invitation_expires_at)?.toISOString() ?? null,
    createdAt: timeOrNull(row.created_at)?.toISOString() ?? '',
    productName: row.product_name === undefined ? undefined : text(row.product_name),
    productSlug: row.product_slug === undefined ? undefined : text(row.product_slug),
    productIdForLink: row.product_id === undefined ? undefined : text(row.product_id),
  };
}

export type JoinWaitingListResult =
  | {
      ok: true;
      status: 'ACTIVE' | 'INVITED';
      entryId: string;
      alreadyOnList: boolean;
      message: string;
    }
  | {
      ok: false;
      reason: 'disabled' | 'unavailable' | 'in-stock' | 'not-signed-in';
      message: string;
    };

interface JoinSnapshot {
  productId: string;
  productName: string;
  productSlug: string;
  productActive: boolean;
  trackInventory: boolean;
  inStock: boolean;
  onHand: number;
  reserved: number;
  userEmail: string;
  userPhone: string;
  userName: string;
  userBlocked: boolean;
  waitlistEnabled: boolean;
}

async function readJoinSnapshot(
  tx: Tx,
  userId: string,
  productId: string,
  waitlistEnabled: boolean,
): Promise<JoinSnapshot | null> {
  const stockRows = (await tx`
    select on_hand, reserved, track_inventory
    from stock
    where product_id = ${productId} and variant_id is null
    for update
  `) as Row[];
  const productRows = (await tx`
    select id, name, slug, in_stock, is_active, deleted_at
    from products
    where id = ${productId}
    limit 1
  `) as Row[];
  const product = productRows[0];
  if (!product || product.deleted_at) return null;

  const userRows = (await tx`
    select email, first_name, last_name, is_blocked
    from users
    where id = ${userId}
    limit 1
  `) as Row[];
  const user = userRows[0];
  if (!user) return null;

  const stock = stockRows[0];

  return {
    productId: text(product.id),
    productName: text(product.name),
    productSlug: text(product.slug),
    productActive: product.is_active === true,
    trackInventory: stock ? stock.track_inventory === true : false,
    inStock: product.in_stock === true,
    onHand: Number(stock?.on_hand ?? 0) || 0,
    reserved: Number(stock?.reserved ?? 0) || 0,
    userEmail: text(user.email),
    userPhone: text(user.phone),
    userName: customerName(user.first_name, user.last_name),
    userBlocked: user.is_blocked === true,
    waitlistEnabled,
  };
}

/**
 * Join once. A second request while the customer is ACTIVE or INVITED returns
 * the existing entry, so a double click cannot create a duplicate and a
 * customer cannot quietly hold two places in the queue.
 */
export async function joinWaitingList(input: {
  userId: string;
  productId: string;
  /** Caller-owned connection; integration tests pin this to a throwaway schema. */
  sql?: Sql;
  /** Caller-supplied policy; read from settings when absent. */
  policy?: ReservationPolicy;
  /** Off for tests and backfills; defaults to the outbox. */
  sendNotifications?: boolean;
}): Promise<JoinWaitingListResult> {
  const sql = input.sql ?? getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', message: 'The waiting list is not available right now.' };
  }

  const productId = input.productId.trim();
  const userId = input.userId.trim();
  if (!productId || !userId) {
    return { ok: false, reason: 'unavailable', message: 'Choose a product first.' };
  }

  let policy = input.policy;
  if (!policy) {
    const settingsResult = await readCheckoutSettings();
    policy = parseReservationPolicy(settingsResult.ok ? settingsResult.settings : {});
  }

  const result = await sql.begin(async (tx) => {
    const snapshot = await readJoinSnapshot(tx, userId, productId, policy.waitlistEnabled);
    if (!snapshot || snapshot.userBlocked) {
      return { ok: false as const, reason: 'unavailable' as const };
    }

    const existingRows = (await tx`
      select id, status, invitation_expires_at
      from waiting_list_entries
      where product_id = ${productId}
        and user_id = ${userId}
        and status in ('ACTIVE', 'INVITED')
      limit 1
    `) as Row[];
    const existing = existingRows[0];
    if (existing) {
      const status = text(existing.status) === 'INVITED' ? 'INVITED' as const : 'ACTIVE' as const;
      return {
        ok: true as const,
        status,
        entryId: text(existing.id),
        alreadyOnList: true,
        snapshot,
      };
    }

    const eligibility = canJoinWaitingList({
      productActive: snapshot.productActive,
      trackInventory: snapshot.trackInventory,
      inStock: snapshot.inStock,
      onHand: snapshot.onHand,
      reserved: snapshot.reserved,
      enabled: snapshot.waitlistEnabled,
    });
    if (!eligibility.ok) {
      return { ok: false as const, reason: eligibility.reason };
    }

    const entryId = `wl_${randomBytes(10).toString('hex')}`;
    const inserted = (await tx`
      insert into waiting_list_entries (id, product_id, user_id, status)
      values (${entryId}, ${productId}, ${userId}, 'ACTIVE')
      on conflict do nothing
      returning id
    `) as Row[];
    if (!inserted[0]) {
      // The unique partial index saw a concurrent join; read that row instead.
      const raced = (await tx`
        select id, status from waiting_list_entries
        where product_id = ${productId} and user_id = ${userId}
          and status in ('ACTIVE', 'INVITED')
        limit 1
      `) as Row[];
      return {
        ok: true as const,
        status: text(raced[0]?.status) === 'INVITED' ? 'INVITED' as const : 'ACTIVE' as const,
        entryId: text(raced[0]?.id ?? entryId),
        alreadyOnList: true,
        snapshot,
      };
    }

    return {
      ok: true as const,
      status: 'ACTIVE' as const,
      entryId,
      alreadyOnList: false,
      snapshot,
    };
  });

  if (!result.ok) {
    if (result.reason === 'disabled') {
      return { ok: false, reason: 'disabled', message: 'The waiting list is currently closed.' };
    }
    if (result.reason === 'in-stock') {
      return {
        ok: false,
        reason: 'in-stock',
        message: 'This item is available now, so no waiting list is needed.',
      };
    }
    return {
      ok: false,
      reason: 'unavailable',
      message: 'This item is not available for the waiting list.',
    };
  }

  if (!result.alreadyOnList && input.sendNotifications !== false) {
    const { snapshot } = result;
    queueNotification(
      'waitlist_joined',
      { type: 'waiting_list_entry', id: result.entryId },
      {
        productName: snapshot.productName,
        customerName: snapshot.userName,
        customerEmail: snapshot.userEmail,
        customerPhone: snapshot.userPhone,
        customerLink: `${WAITING_LIST_PRODUCT_LINK_PREFIX}${encodeURIComponent(snapshot.productId)}`,
        token: result.entryId,
      },
    );
  }

  return {
    ok: true,
    status: result.status,
    entryId: result.entryId,
    alreadyOnList: result.alreadyOnList,
    message: result.status === 'INVITED'
      ? 'A unit is being held for you. Check your email for the claim link.'
      : 'You are on the waiting list. We will notify you when a unit is available.',
  };
}

/** Leave the list. An open invitation returns its held unit immediately. */
export async function leaveWaitingList(input: {
  userId: string;
  productId: string;
  /** Caller-owned connection; integration tests pin this to a throwaway schema. */
  sql?: Sql;
}): Promise<{ ok: boolean; removed: boolean }> {
  const sql = input.sql ?? getSql();
  if (!sql) return { ok: false, removed: false };

  const productId = input.productId.trim();
  const userId = input.userId.trim();
  if (!productId || !userId) return { ok: false, removed: false };

  return await sql.begin(async (tx) => {
    const entries = (await tx`
      select id, status from waiting_list_entries
      where product_id = ${productId}
        and user_id = ${userId}
        and status in ('ACTIVE', 'INVITED')
      for update
    `) as Row[];
    if (entries.length === 0) return { ok: true, removed: false };

    const entry = entries[0];
    if (text(entry.status) === 'INVITED') {
      const holds = (await tx`
        select id, product_id, quantity
        from stock_reservations
        where waiting_list_entry_id = ${text(entry.id)} and status = 'HELD'
        for update
      `) as Row[];
      for (const hold of holds) {
        await releaseReservedStock(tx, text(hold.product_id), Number(hold.quantity) || 1);
        await tx`
          update stock_reservations
          set status = 'CANCELLED', updated_at = now()
          where id = ${text(hold.id)} and status = 'HELD'
        `;
      }
    }

    await tx`
      update waiting_list_entries
      set status = 'CANCELLED', updated_at = now()
      where id = ${text(entry.id)} and status in ('ACTIVE', 'INVITED')
    `;
    return { ok: true, removed: true };
  });
}

export async function getWaitingListEntry(input: {
  userId: string;
  productId: string;
  sql?: Sql;
}): Promise<WaitingListEntry | null> {
  const sql = input.sql ?? getSql();
  if (!sql) return null;
  try {
    const rows = (await sql`
      select id, product_id, user_id, status, invited_at,
             invitation_expires_at, created_at
      from waiting_list_entries
      where product_id = ${input.productId.trim()}
        and user_id = ${input.userId.trim()}
        and status in ('ACTIVE', 'INVITED')
      order by created_at desc
      limit 1
    `) as Row[];
    return rows[0] ? mapEntry(rows[0]) : null;
  } catch {
    return null;
  }
}

export interface WaitlistPanelState {
  waitlistEnabled: boolean;
  /** True only when the product cannot currently be bought. */
  joinable: boolean;
  reason: 'disabled' | 'unavailable' | 'in-stock' | null;
  entry: WaitingListEntry | null;
}

/**
 * What the product page should show: join, already on the list, or nothing at
 * all because the item is buyable. Read-only and advisory — the join call
 * re-checks everything inside the stock-row lock.
 */
export async function getWaitlistPanelState(input: {
  userId: string | null;
  productId: string;
}): Promise<WaitlistPanelState> {
  const productId = input.productId.trim();
  if (!productId) {
    return { waitlistEnabled: false, joinable: false, reason: 'unavailable', entry: null };
  }

  const sql = getSql();
  if (!sql) {
    return { waitlistEnabled: false, joinable: false, reason: 'unavailable', entry: null };
  }

  try {
    const settingsResult = await readCheckoutSettings();
    const policy = parseReservationPolicy(settingsResult.ok ? settingsResult.settings : {});

    const rows = (await sql`
      select s.on_hand, s.reserved, s.track_inventory,
             p.is_active, p.deleted_at, p.in_stock
      from products p
      left join stock s on s.product_id = p.id and s.variant_id is null
      where p.id = ${productId}
      limit 1
    `) as Row[];
    const row = rows[0];
    if (!row) {
      return { waitlistEnabled: policy.waitlistEnabled, joinable: false, reason: 'unavailable', entry: null };
    }

    const eligibility = canJoinWaitingList({
      productActive: row.is_active === true && !row.deleted_at,
      trackInventory: row.track_inventory === true,
      inStock: row.in_stock === true,
      onHand: Number(row.on_hand ?? 0) || 0,
      reserved: Number(row.reserved ?? 0) || 0,
      enabled: policy.waitlistEnabled,
    });

    const entry = input.userId
      ? await getWaitingListEntry({ userId: input.userId, productId })
      : null;

    return {
      waitlistEnabled: policy.waitlistEnabled,
      joinable: eligibility.ok,
      reason: eligibility.ok ? null : eligibility.reason,
      entry,
    };
  } catch {
    return { waitlistEnabled: false, joinable: false, reason: 'unavailable', entry: null };
  }
}

/** The signed-in customer's waiting-list history, newest first. */
export async function listWaitingListForUser(
  userId: string,
  limit = 20,
): Promise<WaitingListEntryWithProduct[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = (await sql`
      select w.id, w.product_id, w.user_id, w.status, w.invited_at,
             w.invitation_expires_at, w.created_at,
             p.name as product_name, p.slug as product_slug, p.price_paise
      from waiting_list_entries w
      join products p on p.id = w.product_id
      where w.user_id = ${userId}
      order by w.created_at desc
      limit ${Math.min(Math.max(limit, 1), 100)}
    `) as Row[];
    return rows.map((row) => ({
      ...mapEntry(row),
      productName: text(row.product_name),
      productSlug: text(row.product_slug),
      pricePaise: Number(row.price_paise) || 0,
    }));
  } catch {
    return [];
  }
}

export interface InvitationView {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  pricePaise: number;
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  status: string;
  expiresAt: Date;
  isOpen: boolean;
  productActive: boolean;
}

/** Resolve the raw link token. Only the hash is stored; the raw token lives in the message. */
export async function getInvitationByToken(
  rawToken: string,
  sqlOverride?: Sql,
): Promise<InvitationView | null> {
  if (!isInvitationToken(rawToken)) return null;
  const sql = sqlOverride ?? getSql();
  if (!sql) return null;

  try {
    const rows = (await sql`
      select r.id, r.product_id, r.user_id, r.status, r.expires_at,
             p.name, p.slug, p.price_paise, p.is_active, p.deleted_at,
             u.email, u.first_name, u.last_name, u.phone
      from stock_reservations r
      join products p on p.id = r.product_id
      join users u on u.id = r.user_id
      where r.token_hash = ${hashToken(rawToken)}
      limit 1
    `) as Row[];
    const row = rows[0];
    if (!row) return null;
    const expiresAt = timeOrNull(row.expires_at);
    if (!expiresAt) return null;
    const now = new Date();
    return {
      id: text(row.id),
      productId: text(row.product_id),
      productName: text(row.name),
      productSlug: text(row.slug),
      pricePaise: Number(row.price_paise) || 0,
      userId: text(row.user_id),
      customerName: customerName(row.first_name, row.last_name),
      customerEmail: text(row.email),
      customerPhone: text(row.phone),
      status: text(row.status),
      expiresAt,
      isOpen: invitationIsOpen(text(row.status), expiresAt, now)
        && row.is_active === true
        && !row.deleted_at,
      productActive: row.is_active === true && !row.deleted_at,
    };
  } catch {
    return null;
  }
}

export interface AllocationResult {
  invited: number;
  unitsHeld: number;
}

interface InviteCandidateProduct {
  productId: string;
  productName: string;
}

interface InviteResult extends InviteCandidateProduct {
  entryId: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  rawToken: string;
  expiresAt: Date;
}

async function inviteNextCustomer(
  sql: Sql,
  productId: string,
  policy: ReservationPolicy,
  now: Date,
): Promise<InviteResult | null> {
  return await sql.begin(async (tx) => {
    const stockRows = (await tx`
      select on_hand, reserved, track_inventory
      from stock
      where product_id = ${productId} and variant_id is null
      for update
    `) as Row[];
    const stock = stockRows[0];
    if (!stock || stock.track_inventory !== true) return null;
    const available = Number(stock.on_hand) - Number(stock.reserved);
    if (!Number.isFinite(available) || available <= 0) return null;

    const alreadyHeld = (await tx`
      select 1 from stock_reservations
      where product_id = ${productId} and status = 'HELD'
      limit 1
    `) as Row[];
    if (alreadyHeld.length > 0) return null;

    const productRows = (await tx`
      select name from products
      where id = ${productId} and is_active and deleted_at is null
      limit 1
    `) as Row[];
    if (!productRows[0]) return null;
    const productName = text(productRows[0].name);

    const rows = (await tx`
      select w.id, w.user_id, w.created_at,
             w.last_purchase_at, u.is_blocked, u.email, u.first_name, u.last_name, u.phone
      from waiting_list_entries w
      join users u on u.id = w.user_id
      where w.product_id = ${productId} and w.status = 'ACTIVE'
      order by w.created_at asc, w.id asc
      limit 100
      for update of w
    `) as Row[];

    const candidates: WaitingListCandidate[] = rows.map((row) => ({
      id: text(row.id),
      userId: text(row.user_id),
      createdAt: row.created_at instanceof Date ? row.created_at : String(row.created_at ?? ''),
      lastPurchaseAt: timeOrNull(row.last_purchase_at),
      userBlocked: row.is_blocked === true,
    }));
    const chosen = nextEligibleCandidate(candidates, now, policy.waitlistRetryMinutes);
    if (!chosen) return null;

    const chosenRow = rows.find((row) => text(row.id) === chosen.id);
    if (!chosenRow) return null;

    const rawToken = randomBytes(32).toString('hex');
    const reservationId = `srv_${randomBytes(10).toString('hex')}`;
    const expiresAt = addMinutes(now, policy.waitlistClaimMinutes);

    const reserved = (await tx`
      update stock
      set reserved = reserved + 1, updated_at = now()
      where product_id = ${productId}
        and variant_id is null
        and track_inventory
        and on_hand - reserved >= 1
      returning on_hand, reserved
    `) as Row[];
    if (!reserved[0]) return null;

    const inserted = (await tx`
      insert into stock_reservations (
        id, product_id, user_id, waiting_list_entry_id, quantity,
        status, token_hash, expires_at, created_at, updated_at
      ) values (
        ${reservationId}, ${productId}, ${chosen.userId}, ${chosen.id}, 1,
        'HELD', ${hashToken(rawToken)}, ${expiresAt}, ${now}, ${now}
      )
      on conflict do nothing
      returning id
    `) as Row[];
    if (!inserted[0]) {
      // A concurrent worker won the unique live-invitation index; put the unit
      // back and let the next tick offer it.
      await releaseReservedStock(tx, productId, 1);
      return null;
    }

    await tx`
      update waiting_list_entries
      set status = 'INVITED',
          invited_at = ${now},
          invitation_expires_at = ${expiresAt},
          updated_at = ${now}
      where id = ${chosen.id} and status = 'ACTIVE'
    `;

    return {
      productId,
      productName,
      entryId: chosen.id,
      userId: chosen.userId,
      name: customerName(chosenRow.first_name, chosenRow.last_name),
      email: text(chosenRow.email),
      phone: text(chosenRow.phone),
      rawToken,
      expiresAt,
    };
  });
}

/**
 * Offer free units to the next eligible customer, one invitation per product.
 *
 * A customer whose account is blocked or who is inside the re-invite cooldown
 * is skipped without losing their place. If the first candidate is ineligible,
 * the next one gets the unit; the cooldown'd entry stays ACTIVE for a later
 * tick.
 */
export async function allocateWaitlistInvitations(input: {
  policy: ReservationPolicy;
  now?: Date;
  /** Caller-owned connection; integration tests pin this to a throwaway schema. */
  sql?: Sql;
  /** Off for tests and backfills; defaults to the outbox. */
  sendNotifications?: boolean;
}): Promise<AllocationResult> {
  const sql = input.sql ?? getSql();
  if (!sql || !input.policy.waitlistEnabled) return { invited: 0, unitsHeld: 0 };
  const now = input.now ?? new Date();

  let products: Row[] = [];
  try {
    products = (await sql`
      select s.product_id, min(w.created_at) as oldest
      from stock s
      join products p on p.id = s.product_id
      join waiting_list_entries w on w.product_id = s.product_id and w.status = 'ACTIVE'
      where s.variant_id is null
        and s.track_inventory
        and p.is_active
        and p.deleted_at is null
        and s.on_hand - s.reserved > 0
        and not exists (
          select 1 from stock_reservations r
          where r.product_id = s.product_id and r.status = 'HELD'
        )
      group by s.product_id
      order by oldest asc
      limit 50
    `) as Row[];
  } catch {
    console.warn('[waitlist] could not read products due for allocation');
    return { invited: 0, unitsHeld: 0 };
  }

  let invited = 0;
  for (const row of products) {
    const productId = text(row.product_id);
    try {
      const invitation = await inviteNextCustomer(sql, productId, input.policy, now);
      if (!invitation) continue;
      invited += 1;

      if (input.sendNotifications === false) continue;
      const deadline = claimDeadlineLabel(invitation.expiresAt);
      queueNotification(
        'waitlist_invite',
        { type: 'stock_reservation', id: invitation.entryId },
        {
          productName: invitation.productName,
          customerName: invitation.name,
          customerEmail: invitation.email,
          customerPhone: invitation.phone,
          customerLink: `/waitlist/claim?token=${encodeURIComponent(invitation.rawToken)}`,
          claimDeadline: deadline,
          claimWindowMinutes: input.policy.waitlistClaimMinutes,
          // One invitation per entry; a retry of the same tick cannot duplicate.
          token: invitation.entryId,
        },
      );
    } catch (error: unknown) {
      console.warn('[waitlist] allocation for a product failed:', (error as Error).message);
    }
  }

  return { invited, unitsHeld: invited };
}

/**
 * Return every held invitation whose window has closed, and cancel entries
 * whose account has been blocked since they joined.
 *
 * Each invitation is expired under the stock row lock, so a checkout that is
 * consuming it at the same moment either wins and marks it CLAIMED, or this
 * tick sees a non-HELD row and does nothing.
 */
export async function expireWaitlistInvitations(input: {
  policy: ReservationPolicy;
  now?: Date;
  /** Caller-owned connection; integration tests pin this to a throwaway schema. */
  sql?: Sql;
  /** Off for tests and backfills; defaults to the outbox. */
  sendNotifications?: boolean;
}): Promise<number> {
  const sql = input.sql ?? getSql();
  if (!sql) return 0;
  const now = input.now ?? new Date();

  // Entries that are only queued (no hold) cannot be allocated while the user
  // is blocked; cancel them so the worker does not scan them forever.
  try {
    await sql`
      update waiting_list_entries w
      set status = 'CANCELLED', updated_at = now()
      from users u
      where u.id = w.user_id
        and u.is_blocked
        and w.status = 'ACTIVE'
    `;
  } catch {
    console.warn('[waitlist] could not cancel blocked waiting-list entries');
  }

  let due: Row[] = [];
  try {
    due = (await sql`
      select id from stock_reservations
      where status = 'HELD'
        and (expires_at <= ${now}
             or exists (
               select 1 from users u
               where u.id = stock_reservations.user_id and u.is_blocked
             ))
      order by expires_at asc
      limit 100
    `) as Row[];
  } catch {
    return 0;
  }

  let expired = 0;
  for (const row of due) {
    const reservationId = text(row.id);
    try {
      const result = await sql.begin(async (tx) => {
        const rows = (await tx`
          select r.id, r.product_id, r.user_id, r.quantity, r.status,
                 r.expires_at, r.waiting_list_entry_id,
                 p.name as product_name, p.slug as product_slug,
                 u.email, u.first_name, u.last_name, u.phone, u.is_blocked
          from stock_reservations r
          join products p on p.id = r.product_id
          join users u on u.id = r.user_id
          where r.id = ${reservationId}
          for update of r
        `) as Row[];
        const hold = rows[0];
        if (!hold || text(hold.status) !== 'HELD') return null;

        const blocked = hold.is_blocked === true;
        const expiresAt = timeOrNull(hold.expires_at);
        const dueByTime = Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
        if (!blocked && !dueByTime) return null;

        await releaseReservedStock(tx, text(hold.product_id), Number(hold.quantity) || 1);
        await tx`
          update stock_reservations
          set status = 'EXPIRED', updated_at = now()
          where id = ${text(hold.id)} and status = 'HELD'
        `;
        if (hold.waiting_list_entry_id) {
          await tx`
            update waiting_list_entries
            set status = ${blocked ? 'CANCELLED' : 'EXPIRED'}, updated_at = now()
            where id = ${text(hold.waiting_list_entry_id)}
              and status = 'INVITED'
          `;
        }

        return {
          entryId: text(hold.waiting_list_entry_id),
          productId: text(hold.product_id),
          productName: text(hold.product_name),
          productSlug: text(hold.product_slug),
          name: customerName(hold.first_name, hold.last_name),
          email: text(hold.email),
          phone: text(hold.phone),
          blocked,
        };
      });

      if (!result) continue;
      expired += 1;

      if (!result.blocked && input.sendNotifications !== false) {
        queueNotification(
          'reservation_expired',
          { type: 'waiting_list_entry', id: result.entryId || reservationId },
          {
            productName: result.productName,
            customerName: result.name,
            customerEmail: result.email,
            customerPhone: result.phone,
            customerLink: `${WAITING_LIST_PRODUCT_LINK_PREFIX}${encodeURIComponent(result.productId)}`,
            token: reservationId,
          },
        );
      }
    } catch (error: unknown) {
      console.warn('[waitlist] could not expire an invitation:', (error as Error).message);
    }
  }

  return expired;
}

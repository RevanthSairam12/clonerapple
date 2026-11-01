/**
 * Maintenance mode: the pure decision, and the cached database read behind it.
 *
 * The rule is one sentence: maintenance is ON when the owner's toggle is on
 * AND, if a window is set, the database clock is inside it. With no window the
 * toggle alone decides.
 *
 * Three properties are load-bearing:
 *
 * - **Fail open.** A settings read that errors, times out or returns nothing
 *   readable leaves the store up. An outage of `store_settings` must never
 *   become an outage of the shop.
 * - **Database clock.** The start/end comparison happens in Postgres
 *   (`now()`), not in Node. A laptop in another timezone, or a server whose
 *   container clock drifts, cannot shift the window.
 * - **Cheap.** The decision is cached for a few seconds only, so toggling takes
 *   effect within about ten seconds, but every request does not open a query.
 *
 * `isStorefrontPath` and `isAlwaysAllowed` are pure and are the only place that
 * answers "does maintenance block this URL?" — the proxy, the tests and any
 * future route handler all call them.
 */

import { getSql } from '@/lib/platform/db';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Maintenance state must be read on the server only.');
}

/* ------------------------------------------------------------- paths */

/**
 * Customer storefront pages. These are blocked while maintenance is on.
 *
 * Prefix rules are deliberate: the whole customer account area, the bag, the
 * cart, checkout, auth and search are blocked, not a hand-maintained list of
 * exact routes that a new page could fall outside of.
 */
const BLOCKED_PREFIXES = [
  '/account',
  '/addresses',
  '/auth',
  '/bag',
  '/cart',
  '/checkout',
  '/search',
  '/shop',
  '/in/shop',
  '/support',
  '/android',
] as const;

/**
 * Never blocked, whatever the toggle says.
 *
 * In-flight payments must be able to finish and show their result, staff must
 * be able to work, and assets have to load or even the maintenance page is
 * blank.
 */
const ALWAYS_ALLOWED_PREFIXES = [
  '/store-admin',
  '/api/store-admin',
  '/admin',
  '/api/admin',
  '/order/success',
  '/order/failed',
  '/order/cancelled',
  '/order/processing',
  '/order/status',
  '/api/payu/success',
  '/api/payu/failure',
  '/api/payu/cancel',
  '/api/payu/webhook',
  '/api/payu/reconcile',
  '/api/media',
  '/maintenance',
  '/_next',
  '/favicon',
  '/robots.txt',
  '/sitemap',
] as const;

/**
 * Customer APIs that start or change a purchase. These are blocked while
 * maintenance is on — checkout must not be startable. The PayU callbacks are
 * deliberately absent: they appear in ALWAYS_ALLOWED and that wins.
 */
const BLOCKED_API_PREFIXES = [
  '/api/payu/initiate',
  '/api/coupons/validate',
  '/api/catalog/availability',
  '/api/account',
  '/api/auth',
] as const;

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Every path is either storefront or not; the root is the homepage. */
export function isStorefrontPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '') return true;
  return BLOCKED_PREFIXES.some((prefix) => matches(pathname, prefix));
}

export function isBlockedPurchaseApi(pathname: string): boolean {
  return BLOCKED_API_PREFIXES.some((prefix) => matches(pathname, prefix));
}

export function isAlwaysAllowed(pathname: string): boolean {
  // Assets and static files served from any `_next` segment.
  if (pathname.includes('/_next/')) return true;
  if (/\.[a-z0-9]{2,5}$/i.test(pathname) && !pathname.startsWith('/api/')) {
    // A file with an extension (favicon.ico, hero.webp, an svg in public/) is
    // an asset. API routes never take this branch.
    return true;
  }
  return ALWAYS_ALLOWED_PREFIXES.some((prefix) => matches(pathname, prefix));
}

/**
 * True when this request must be answered with the maintenance page / 503.
 *
 * `active` is the *decided* state (toggle AND window), not the raw toggle, so
 * this stays testable without a database.
 */
export function shouldBlockPath(pathname: string, active: boolean): boolean {
  if (!active) return false;
  if (isAlwaysAllowed(pathname)) return false;
  return isStorefrontPath(pathname) || isBlockedPurchaseApi(pathname);
}

/* ------------------------------------------------------------ decision */

export interface MaintenanceWindow {
  /** Raw toggle from `store_settings`. */
  enabled: boolean;
  /** ISO start, or null when there is no lower bound. */
  startsAt: string | null;
  /** ISO end, or null when there is no upper bound. */
  endsAt: string | null;
}

/** A timestamp the database could not parse is treated as "no bound" rather
 * than silently never matching — an unreadable window must not keep the shop
 * down forever. */
function parseBound(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Decide the state from the raw settings and a `now` supplied by the caller.
 *
 * In production `now` comes from `select now()` — the database clock. In tests
 * it is any epoch millisecond value, so the boundary cases are exact.
 */
export function evaluateMaintenance(window: MaintenanceWindow, nowMs: number): boolean {
  if (!window.enabled) return false;

  const startsAt = parseBound(window.startsAt);
  const endsAt = parseBound(window.endsAt);

  if (startsAt !== null && nowMs < startsAt) return false;
  if (endsAt !== null && nowMs >= endsAt) return false;
  return true;
}

export interface MaintenanceState {
  /** True when storefront traffic should be blocked right now. */
  active: boolean;
  /** The owner's toggle, regardless of the window. */
  enabled: boolean;
  message: string;
  /** ISO start time, when one is set. Drives the SCHEDULED badge only. */
  startsAt: string | null;
  /** ISO end time, when one is set. Shown to the customer. */
  endsAt: string | null;
  /** The database clock at the moment of the decision (ISO). */
  now: string;
  /** True when this state came from the cache rather than a fresh read. */
  cached: boolean;
  /** Trade name shown on the page; blank falls back to "our store". */
  storeName: string;
  /** IANA timezone the end time is formatted in. */
  timeZone: string;
}

/** What the store shows when maintenance is off or unreadable. */
export function maintenanceOff(nowIso: string): MaintenanceState {
  return {
    active: false,
    enabled: false,
    message: '',
    startsAt: null,
    endsAt: null,
    now: nowIso,
    cached: false,
    storeName: '',
    timeZone: 'Asia/Kolkata',
  };
}

/** A human sentence for the badge on Settings and Overview. */
export type MaintenanceStatus = 'LIVE' | 'SCHEDULED' | 'OFF';

export function maintenanceStatus(state: MaintenanceState): MaintenanceStatus {
  if (state.active) return 'LIVE';
  // Scheduled means the toggle is on and the window has not begun yet. A
  // window that already ended is OFF, not scheduled.
  if (state.enabled && state.startsAt !== null) {
    const starts = Date.parse(state.startsAt);
    const now = Date.parse(state.now);
    if (Number.isFinite(starts) && Number.isFinite(now) && starts > now) return 'SCHEDULED';
  }
  return 'OFF';
}

/* ------------------------------------------------------------- cache */

/**
 * How long a decision is reused. Long enough that a busy storefront does not
 * query per request; short enough that turning maintenance on is visible
 * within about ten seconds.
 */
export const MAINTENANCE_CACHE_MS = 5_000;

interface CacheEntry {
  state: MaintenanceState;
  at: number;
}

const globalForMaintenance = globalThis as typeof globalThis & {
  __gadzioMaintenance?: CacheEntry;
};

/** Test hook: forget the cached decision. */
export function clearMaintenanceCache(): void {
  globalForMaintenance.__gadzioMaintenance = undefined;
}

/**
 * Read the settings and decide, using the database clock.
 *
 * Fail open in every failure mode: no database, a query error, a row that
 * cannot be parsed. A settings outage never takes the shop down.
 */
async function readMaintenanceState(): Promise<MaintenanceState> {
  const sql = getSql();
  const nodeNow = new Date().toISOString();
  if (!sql) return maintenanceOff(nodeNow);

  try {
    // One round trip. The window values are entered as wall-clock
    // `datetime-local` text, so Postgres resolves them to an absolute instant
    // in the store's timezone (`… at time zone <tz>`), and `now()` is the
    // database clock. Both sides of the comparison are therefore absolute.
    const rows = (await sql`
      with s as (
        select
          max(value) filter (where key = 'maintenance_enabled')   as enabled,
          max(value) filter (where key = 'maintenance_message')   as message,
          nullif(max(value) filter (where key = 'maintenance_starts_at'), '') as starts_raw,
          nullif(max(value) filter (where key = 'maintenance_ends_at'), '')   as ends_raw,
          max(value) filter (where key = 'trade_name')            as trade_name,
          nullif(max(value) filter (where key = 'timezone'), '')  as timezone
        from store_settings
      )
      select
        now() as db_now,
        enabled,
        message,
        trade_name,
        coalesce(timezone, 'Asia/Kolkata') as timezone,
        case when starts_raw is null then null
             else starts_raw::timestamp at time zone coalesce(timezone, 'Asia/Kolkata')
        end as starts_at,
        case when ends_raw is null then null
             else ends_raw::timestamp at time zone coalesce(timezone, 'Asia/Kolkata')
        end as ends_at
      from s
    `) as Record<string, unknown>[];

    const row = rows[0];
    if (!row) return maintenanceOff(nodeNow);
    return stateFromRow(row) ?? maintenanceOff(nodeNow);
  } catch {
    console.warn('[maintenance] settings could not be read; the store stays up');
    return maintenanceOff(nodeNow);
  }
}

/**
 * Turn one settings row into a decision. Returns null when the row is not
 * usable (no clock, for example) — the caller then fails open.
 *
 * Exported so a test can prove a malformed row cannot take the shop down.
 */
export function stateFromRow(row: Record<string, unknown>): MaintenanceState | null {
  const dbNow =
    row.db_now instanceof Date ? row.db_now.getTime() : Date.parse(String(row.db_now ?? ''));
  if (!Number.isFinite(dbNow)) return null;

  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
  /** timestamptz comes back as a Date from the driver; normalize to ISO. */
  const bound = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  };

  const startsAt = bound(row.starts_at);
  const endsAt = bound(row.ends_at);
  const enabled = text(row.enabled).trim() === 'on';
  const active = evaluateMaintenance({ enabled, startsAt, endsAt }, dbNow);
  const timeZone = text(row.timezone).trim() || 'Asia/Kolkata';

  return {
    active,
    enabled,
    message: text(row.message),
    startsAt,
    endsAt,
    now: new Date(dbNow).toISOString(),
    cached: false,
    storeName: text(row.trade_name).trim(),
    timeZone,
  };
}

/**
 * The state the storefront should act on. Cached for a few seconds; a cache
 * hit is only ever used while it is younger than MAINTENANCE_CACHE_MS.
 */
export async function getMaintenanceState(): Promise<MaintenanceState> {
  const cached = globalForMaintenance.__gadzioMaintenance;
  const now = Date.now();
  if (cached && now - cached.at < MAINTENANCE_CACHE_MS) {
    return { ...cached.state, cached: true };
  }

  const state = await readMaintenanceState();
  // Never cache a "fail open" result for long: if the settings read failed we
  // want the next request to retry rather than pin the shop open for the full
  // window. Failures arrive here as `enabled: false` with a fresh `now`;
  // caching them is still correct (the store is up either way), but a short
  // TTL is friendlier when the database recovers.
  globalForMaintenance.__gadzioMaintenance = { state, at: now };
  return state;
}

/** Retry-After in seconds while maintenance is active. */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 3600;

/**
 * The message the customer sees. The owner's text wins; a blank one falls back
 * to a sentence that still tells the visitor what is happening.
 */
export function maintenanceMessage(state: MaintenanceState): string {
  const message = state.message.trim();
  if (message) return message;
  return 'We are making a few improvements. Please check back shortly.';
}

/** Format the expected end time in the store's timezone, e.g. "30 Oct 2026, 6:30 pm". */
export function formatEndsAt(endsAtIso: string | null, timeZone: string): string | null {
  if (!endsAtIso) return null;
  const date = new Date(endsAtIso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

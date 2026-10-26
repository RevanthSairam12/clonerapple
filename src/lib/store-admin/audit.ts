import { createHash } from 'node:crypto';

import { getSql } from '@/lib/admin/db';

/**
 * Append-only audit log for store admin actions.
 *
 * Every row is written through `writeAudit()`. Two rules matter:
 *
 * 1. PII never reaches `before`/`after`. Emails, phone numbers, addresses and
 *    raw payment responses are masked first. The DB trigger on
 *    `store_admin_audit` refuses UPDATE and DELETE, so a row that is written
 *    cannot be edited afterwards — masking has to happen before the insert.
 * 2. Raw IP addresses and user agents are hashed, never stored.
 *
 * Audit failures are swallowed: a logging outage must not take down a store
 * operation. The failure is reported to the server log without any payload.
 */

/* ----------------------------------------------------------- masking */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `ravi@example.com` → `r***@example.com`. */
export function maskEmail(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return '[redacted email]';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!domain) return '[redacted email]';
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}

/** `+91 98765 43210` → `***10`. Never returns more than the last two digits. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '[redacted phone]';
  return `***${digits.slice(-2)}`;
}

/** Addresses are dropped entirely; the audit log keeps only the fact of change. */
export function maskAddress(_value: string): string {
  return '[redacted address]';
}

/** SHA-256 of an identifier (IP, user agent). Never reversible. */
export function hashIdentifier(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  return createHash('sha256').update(trimmed).digest('hex');
}

function maskKeyedString(key: string, value: string): string {
  const lower = key.toLowerCase();

  if (lower.includes('payu_raw') || lower.includes('raw_response')) {
    return '[redacted payment response]';
  }
  if (lower.includes('address')) {
    return maskAddress(value);
  }
  if (lower.includes('email')) {
    return maskEmail(value);
  }
  if (lower.includes('phone') || lower.includes('mobile') || lower.includes('tel')) {
    return maskPhone(value);
  }
  // Defense in depth: an email-shaped string is masked regardless of its key.
  if (EMAIL_RE.test(value.trim())) {
    return maskEmail(value);
  }
  return value;
}

/**
 * Recursively mask a JSON-shaped value. Plain data only (the caller passes the
 * before/after snapshot of a record); depth is capped so a pathological input
 * cannot recurse forever.
 */
export function maskPii(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return EMAIL_RE.test(value.trim()) ? maskEmail(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskPii(item, depth + 1));
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      if (typeof item === 'string') {
        out[key] = maskKeyedString(key, item);
      } else {
        out[key] = maskPii(item, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/* ------------------------------------------------------------- writer */

export interface AuditInput {
  actorId?: string | null;
  /** Masked before insert; the full address never reaches the table. */
  actorEmail?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  route?: string;
  status?: string;
  reason?: string;
  /** When supplied, route / request id / hashed IP and UA are derived from it. */
  request?: Request | null;
}

interface AuditNetworkContext {
  requestId: string | null;
  route: string;
  ipHash: string | null;
  userAgentHash: string | null;
}

function networkContext(request: Request | null | undefined): AuditNetworkContext {
  if (!request) {
    return { requestId: null, route: '', ipHash: null, userAgentHash: null };
  }

  let route = '';
  try {
    route = new URL(request.url).pathname;
  } catch {
    route = '';
  }

  const headers = request.headers;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || headers.get('x-real-ip') || '';

  return {
    requestId: headers.get('x-request-id') || headers.get('x-vercel-id') || null,
    route,
    ipHash: hashIdentifier(ip),
    userAgentHash: hashIdentifier(headers.get('user-agent')),
  };
}

/**
 * Insert one immutable audit row. Best-effort: returns false when the database
 * is unavailable or the insert failed, and logs a payload-free warning.
 */
export async function writeAudit(input: AuditInput): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;

  try {
    const net = networkContext(input.request);
    // Hand the driver the object itself: passing a pre-stringified value here
    // stores a JSON *string* in a jsonb column, so `after->>'title'` returns
    // null and the audit trail cannot be queried. `sql.json` marks the value
    // as JSON so the driver serialises it rather than stringifying the param.
    type JsonParam = Parameters<typeof sql.json>[0];
    const asJson = (value: unknown) => sql.json(value as JsonParam);
    const before = input.before === undefined ? null : maskPii(input.before);
    const after = input.after === undefined ? null : maskPii(input.after);

    await sql`
      insert into store_admin_audit (
        actor_id, actor_email, action, entity, entity_id,
        before, after, request_id, route, status, reason,
        ip_hash, user_agent_hash
      ) values (
        ${input.actorId ?? null},
        ${input.actorEmail ? maskEmail(input.actorEmail) : ''},
        ${input.action},
        ${input.entity},
        ${input.entityId ?? ''},
        ${before === null ? null : asJson(before)},
        ${after === null ? null : asJson(after)},
        ${input.requestId ?? net.requestId},
        ${input.route ?? net.route},
        ${input.status ?? 'ok'},
        ${input.reason ?? ''},
        ${net.ipHash},
        ${net.userAgentHash}
      )
    `;
    return true;
  } catch {
    // Never log the payload: it may contain PII or the values that caused the
    // error. A generic line is enough to spot a broken audit pipeline.
    console.warn('[store-admin/audit] failed to write an audit row');
    return false;
  }
}

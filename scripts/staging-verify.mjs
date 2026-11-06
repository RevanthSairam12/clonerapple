#!/usr/bin/env node
/**
 * Staging role matrix: calls the sensitive store-admin routes as viewer, admin
 * and owner and compares each HTTP status to what the code requires.
 *
 * READ-ONLY BY DEFAULT. The only writes this script can trigger are:
 *   - a settings PUT that sends the current `mail_host` value straight back
 *     (updateStoreSettings skips an unchanged value, so no row is touched);
 *   - a shared-list POST that echoes the row's own values back (the row keeps
 *     its values; only its `updated_at` moves);
 *   - a notification toggle POST that repeats the stored `is_active`.
 * The owner customer reveal — which writes an audit row and returns a real
 * email or phone — stays off unless STAGING_ALLOW_OWNER_REVEAL=1.
 *
 * It never prints a response body, a cookie, a token, a set-cookie header or
 * a credential. It prints status codes and booleans derived from the masked
 * customer payload. Nothing is written to disk.
 *
 * Usage:
 *   BASE_URL=https://staging.example.test \
 *   STAFF_VIEWER_EMAIL=... STAFF_VIEWER_PASSWORD=... \
 *   STAFF_ADMIN_EMAIL=...  STAFF_ADMIN_PASSWORD=...  \
 *   STAFF_OWNER_EMAIL=...  STAFF_OWNER_PASSWORD=...  \
 *   node scripts/staging-verify.mjs
 *
 * Exit: 0 when every performed expectation matches, 1 otherwise. A role whose
 * variables are absent is reported NOT TESTED and is not a failure.
 */
import process from 'node:process';

const BASE_URL = (process.env.BASE_URL ?? '').trim().replace(/\/+$/, '');
const ROLES = ['viewer', 'admin', 'owner'];
const LOGIN_PATH = '/api/store-admin/auth/login';
const COOKIE_NAME = 'store_admin_session';

/* ------------------------------------------------------------ reporting */

const rows = [];
let failures = 0;

function record(role, check, expected, actual, verdict, note = '') {
  rows.push({ role, check, expected, actual: String(actual), verdict, note });
  if (verdict === 'FAIL') failures += 1;
}

function pass(role, check, expected, actual, note) {
  record(role, check, expected, actual, 'PASS', note);
}

function fail(role, check, expected, actual, note) {
  record(role, check, expected, actual, 'FAIL', note);
}

function notTested(role, check, expected, reason) {
  record(role, check, expected, '-', 'NOT TESTED', reason);
}

/**
 * Compare one status to an expected set. `expected` is a number or an array of
 * acceptable numbers; anything else is a failure.
 */
function expectStatus(role, check, expected, actual, note) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (allowed.includes(actual)) pass(role, check, allowed.join('/'), actual, note);
  else fail(role, check, allowed.join('/'), actual, note);
}

/* -------------------------------------------------------------- request */

/**
 * A response's status, and — only for the mask check — its parsed JSON.
 * The body is never logged anywhere in this file.
 */
async function request(path, { method = 'GET', role = null, body } = {}) {
  const headers = {
    Accept: 'application/json',
    // assertSameOrigin() accepts an Origin it can map to the request host; the
    // Host header is sent automatically by fetch for the BASE_URL host.
    Origin: BASE_URL,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const session = role ? sessions.get(role) : null;
  if (session) headers.Cookie = `${COOKIE_NAME}=${session}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
  } catch (error) {
    return { status: 0, error: error?.code ?? error?.name ?? 'network' };
  }

  return {
    status: response.status,
    json: async () => {
      try {
        return await response.json();
      } catch {
        return null;
      }
    },
  };
}

/* ---------------------------------------------------------------- login */

const sessions = new Map();

function credentials(role) {
  const key = role.toUpperCase();
  const email = (process.env[`STAFF_${key}_EMAIL`] ?? '').trim();
  const password = process.env[`STAFF_${key}_PASSWORD`] ?? '';
  const totpCode = (process.env[`STAFF_${key}_TOTP`] ?? '').trim();
  return email && password ? { email, password, totpCode } : null;
}

function sessionFromResponse(response) {
  // Node's fetch exposes Set-Cookie via getSetCookie(); the value is used here
  // and never printed.
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? ''];
  for (const header of cookies) {
    const match = header.match(new RegExp(`(?:^|,\\s*)${COOKIE_NAME}=([^;]+)`));
    if (match) return match[1];
  }
  return null;
}

async function login(role) {
  const creds = credentials(role);
  if (!creds) {
    notTested(role, 'login', '200 + session cookie', 'no STAFF_<ROLE>_EMAIL / _PASSWORD provided');
    return false;
  }

  const body = { email: creds.email, password: creds.password };
  if (creds.totpCode) body.totpCode = creds.totpCode;

  let response;
  try {
    response = await fetch(`${BASE_URL}${LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Accept: 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
  } catch (error) {
    fail(role, 'login', 200, error?.code ?? error?.name ?? 'network');
    return false;
  }

  if (response.status !== 200) {
    // 401 = wrong credentials, 403 = cross-origin, 429 = locked out.
    fail(
      role,
      'login',
      200,
      response.status,
      response.status === 401
        ? 'rejected: check the credentials, or the account needs a password change'
        : response.status === 429
          ? 'rate-limited: wait 15 minutes'
          : '',
    );
    return false;
  }

  const token = sessionFromResponse(response);
  if (!token) {
    fail(role, 'login', 'session cookie', 'no session cookie in the response');
    return false;
  }

  // A temporary password blocks every route behind a 403. Say so rather than
  // reporting ten confusing 403s against the role expectations below.
  let mustChangePassword = false;
  try {
    mustChangePassword = (await response.clone().json())?.mustChangePassword === true;
  } catch {
    mustChangePassword = false;
  }
  if (mustChangePassword) {
    notTested(role, 'login', 'a usable session', 'account still has a temporary password; change it first');
    return false;
  }

  sessions.set(role, token);
  pass(role, 'login', 200, 200);
  return true;
}

/* --------------------------------------------------------------- checks */

/** A customer id to read. Fetched through the list route (any staff role). */
async function findCustomerId() {
  const audience = ROLES.find((role) => sessions.has(role));
  if (!audience) return null;
  const response = await request('/api/store-admin/customers?page=1', { role: audience });
  if (response.status !== 200) return null;
  const payload = await response.json();
  const first = payload?.customers?.find((customer) => typeof customer?.id === 'string' && customer.id);
  return first?.id ?? null;
}

/** True when a value looks like the masked form `r***@domain` / `[redacted *]`. */
function looksMasked(value, kind) {
  if (typeof value !== 'string') return false;
  if (kind === 'email') {
    if (value === '[redacted email]') return true;
    return /^[^@\s]\*\*\*@[^@\s]+$/.test(value);
  }
  if (kind === 'phone') {
    if (value === '[redacted phone]') return true;
    return /^\d{2}\*{2,}\d{2}$/.test(value) || /^\*+$/.test(value);
  }
  // address line / pincode: empty or the redaction marker
  return value === '' || value === '[redacted]';
}

/** The customer detail payload must carry no unmasked street line or pincode. */
function addressBooleans(customer) {
  const addresses = Array.isArray(customer?.addresses) ? customer.addresses : [];
  return {
    emailMasked: looksMasked(customer?.emailMasked, 'email'),
    phoneMasked: looksMasked(customer?.phoneMasked, 'phone'),
    addressLinesMasked: addresses.every(
      (address) =>
        looksMasked(address?.line1, 'address') &&
        looksMasked(address?.line2, 'address') &&
        looksMasked(address?.pincode, 'address'),
    ),
    addressCount: addresses.length,
  };
}

const SETTINGS = '/api/store-admin/settings';
const NOTIFY = '/api/store-admin/settings/notifications';
const RETRY = '/api/store-admin/settings/notifications/retry';

async function checkCustomerRoutes(customerId) {
  for (const role of ROLES) {
    if (!sessions.has(role)) continue;
    const expected = role === 'viewer' ? 403 : 200;
    const response = await request(`/api/store-admin/customers/${customerId}`, { role });
    expectStatus(role, 'GET customers/[id]', expected, response.status);

    if (response.status === 200) {
      const body = await response.json();
      const flags = addressBooleans(body?.customer);
      const note =
        `masked email=${flags.emailMasked} phone=${flags.phoneMasked} ` +
        `addresses=${flags.addressLinesMasked} (${flags.addressCount})`;
      if (flags.emailMasked && flags.phoneMasked && flags.addressLinesMasked) {
        pass(role, 'customers/[id] masking', 'all masked', 'all masked', note);
      } else {
        fail(role, 'customers/[id] masking', 'all masked', 'NOT MASKED', note);
      }
    }
  }

  // Reveal: the guard answer is what matters, so the viewer and admin calls are
  // safe by construction — the handler refuses before it reads anything.
  const payload = { field: 'email', reason: 'staging role matrix check' };
  for (const role of ['viewer', 'admin']) {
    if (!sessions.has(role)) continue;
    const response = await request(`/api/store-admin/customers/${customerId}/reveal`, {
      method: 'POST',
      role,
      body: payload,
    });
    expectStatus(role, 'POST customers/[id]/reveal', 403, response.status);
  }

  if (!sessions.has('owner')) {
    notTested('owner', 'POST customers/[id]/reveal', 200, 'no owner session');
  } else if (process.env.STAGING_ALLOW_OWNER_REVEAL !== '1') {
    notTested(
      'owner',
      'POST customers/[id]/reveal',
      200,
      'refused by default: it writes an audit row and returns real contact data. Re-run with STAGING_ALLOW_OWNER_REVEAL=1 to allow it.',
    );
  } else {
    const response = await request(`/api/store-admin/customers/${customerId}/reveal`, {
      method: 'POST',
      role: 'owner',
      body: payload,
    });
    // 200 = revealed, 404 = this customer has no email on record; both mean
    // the owner guard passed. The value (if any) is never printed.
    expectStatus('owner', 'POST customers/[id]/reveal', [200, 404], response.status);
  }
}

async function checkSettingsWrite() {
  // The owner must send the current value back so nothing changes.
  let currentMailHost = null;
  if (sessions.has('owner')) {
    const read = await request(SETTINGS, { role: 'owner' });
    if (read.status === 200) {
      const body = await read.json();
      const value = body?.settings?.mail_host;
      if (typeof value === 'string') currentMailHost = value;
    }
  }

  for (const role of ROLES) {
    if (!sessions.has(role)) continue;

    if (role === 'owner' && currentMailHost === null) {
      notTested(role, 'PUT settings (mail_host no-op)', 200, 'the current mail_host could not be read');
      continue;
    }

    const value = role === 'owner' ? currentMailHost : 'smtp.invalid.test';
    const response = await request(SETTINGS, {
      method: 'PUT',
      role,
      body: { key: 'mail_host', value },
    });
    const expected = role === 'owner' ? 200 : 403;
    const note =
      role === 'owner'
        ? 'value sent back unchanged; updateStoreSettings skips it, so no row is written'
        : role === 'admin'
          ? 'admin reaches the route but mail_* is owner-only inside the write'
          : 'viewer is refused by the store_admin requirement';
    expectStatus(role, 'PUT settings (mail_host)', expected, response.status, note);
  }
}

/**
 * Shared lists whose writes are owner-only. Sends the row's own values back so
 * validation passes for an owner and nothing but `updated_at` moves.
 */
async function checkOwnerOnlyLists() {
  for (const kind of ['email-templates', 'automated-messages']) {
    // Read one row as any signed-in role (GET is viewer-readable).
    const reader = ROLES.find((role) => sessions.has(role));
    let row = null;
    if (reader) {
      const list = await request(`/api/store-admin/settings/lists/${kind}`, { role: reader });
      if (list.status === 200) {
        const body = await list.json();
        row = Array.isArray(body?.rows) ? body.rows[0] ?? null : null;
      }
    }

    const payload = (role) =>
      role === 'owner' && row
        ? { id: row.id, values: row.values }
        : { values: { name: 'staging role matrix probe' } };

    for (const role of ROLES) {
      if (!sessions.has(role)) continue;
      if (role === 'owner' && !row) {
        notTested(role, `POST settings/lists/${kind}`, [200, 201], 'no existing row to echo back');
        continue;
      }
      const response = await request(`/api/store-admin/settings/lists/${kind}`, {
        method: 'POST',
        role,
        body: payload(role),
      });
      const expected = role === 'owner' ? [200, 201] : 403;
      const note =
        role === 'owner'
          ? 'existing row echoed back; values unchanged'
          : 'email templates and automated messages are owner-only list kinds';
      expectStatus(role, `POST settings/lists/${kind}`, expected, response.status, note);
    }
  }
}

async function checkNotificationRoutes() {
  // GET is viewer-readable for every role.
  for (const role of ROLES) {
    if (!sessions.has(role)) continue;
    const response = await request(NOTIFY, { role });
    expectStatus(role, 'GET settings/notifications', 200, response.status);
  }

  // POST is owner-only. The owner repeats the stored state of one toggle.
  let toggle = null;
  const reader = ROLES.find((role) => sessions.has(role));
  if (reader) {
    const list = await request(NOTIFY, { role: reader });
    if (list.status === 200) {
      const body = await list.json();
      toggle = Array.isArray(body?.toggles) ? body.toggles[0] ?? null : null;
    }
  }

  for (const role of ROLES) {
    if (!sessions.has(role)) continue;
    if (role === 'owner' && !toggle) {
      notTested(role, 'POST settings/notifications', 200, 'no notification toggle to repeat');
      continue;
    }
    const response = await request(NOTIFY, {
      method: 'POST',
      role,
      body:
        role === 'owner'
          ? { id: toggle.id, isActive: toggle.isActive === true }
          : { id: 'anything', isActive: false },
    });
    const expected = role === 'owner' ? 200 : 403;
    expectStatus(
      role,
      'POST settings/notifications',
      expected,
      response.status,
      role === 'owner' ? 'the stored is_active value was repeated' : 'the toggle matrix is owner-only',
    );
  }

  // Retry is owner-only. Sent without an id on purpose: the owner passes the
  // guard and then gets 400, so no message is requeued and no send is triggered.
  for (const role of ROLES) {
    if (!sessions.has(role)) continue;
    const response = await request(RETRY, { method: 'POST', role, body: {} });
    const expected = role === 'owner' ? 400 : 403;
    expectStatus(
      role,
      'POST settings/notifications/retry',
      expected,
      response.status,
      role === 'owner'
        ? 'guard passed; the empty body is rejected, so nothing was requeued'
        : 'retrying a send is owner-only',
    );
  }
}

/* ----------------------------------------------------------------- main */

function printTable() {
  const widths = {
    role: Math.max(4, ...rows.map((row) => row.role.length)),
    check: Math.max(5, ...rows.map((row) => row.check.length)),
    expected: Math.max(8, ...rows.map((row) => row.expected.length)),
    actual: Math.max(6, ...rows.map((row) => row.actual.length)),
    verdict: 10,
  };
  const line = (cells) =>
    cells
      .map((cell, index) => String(cell).padEnd(Object.values(widths)[index]))
      .join('  ')
      .trimEnd();

  console.log(line(['ROLE', 'CHECK', 'EXPECTED', 'ACTUAL', 'VERDICT']));
  for (const row of rows) {
    console.log(line([row.role, row.check, row.expected, row.actual, row.verdict]));
    if (row.note) console.log(`    ${row.note}`);
  }
}

async function main() {
  if (!BASE_URL) {
    console.error('BASE_URL is not set (for example https://staging.example.test).');
    process.exitCode = 2;
    return;
  }

  console.log(`Staging role matrix against ${BASE_URL}`);
  console.log('Status codes are compared to the role each route requires. No body is printed.\n');

  const loggedIn = [];
  for (const role of ROLES) {
    if (await login(role)) loggedIn.push(role);
  }

  if (loggedIn.length === 0) {
    notTested('-', 'every route', '-', 'no role could sign in; nothing was called');
    printTable();
    console.log('\nNo role had usable credentials. Set STAFF_<ROLE>_EMAIL and STAFF_<ROLE>_PASSWORD.');
    process.exitCode = 2;
    return;
  }

  const customerId = await findCustomerId();
  if (customerId) {
    await checkCustomerRoutes(customerId);
  } else {
    for (const role of loggedIn) {
      notTested(role, 'GET customers/[id]', 200, 'no registered customer id was returned by the list route');
      notTested(role, 'POST customers/[id]/reveal', '-', 'no customer id');
    }
  }

  await checkSettingsWrite();
  await checkOwnerOnlyLists();
  await checkNotificationRoutes();

  printTable();

  const skipped = rows.filter((row) => row.verdict === 'NOT TESTED').length;
  console.log(
    `\n${rows.length - skipped - failures} passed, ${failures} failed, ${skipped} not tested.`,
  );
  if (failures > 0) {
    console.log('Role expectations did not match. See the FAIL rows above.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('The run stopped unexpectedly:', error?.code ?? error?.name ?? 'unknown');
  process.exitCode = 1;
});

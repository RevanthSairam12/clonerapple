/**
 * SECURITY (SEC-005 / L-9): Private expense receipts.
 *
 * Verifies:
 * 1. Receipts upload to the private `expense-receipts` bucket with `url = ''`
 *    and `Cache-Control: private, no-store` (never public `media`).
 * 2. PDF receipts are sniffed via `%PDF-` magic bytes; SVG uploads are rejected.
 * 3. `GET /api/store-admin/expenses/[id]/receipt` requires `store_admin`,
 *    enforces distributed per-actor rate limiting, mints short-lived (60s)
 *    signed URLs without logging them in `store_admin_audit`, and returns
 *    `Cache-Control: private, no-store`.
 * 4. `GET /api/media/[id]` returns `404` for private-bucket rows or expense
 *    attachments while continuing to redirect public product media cleanly.
 * 5. `listMedia()` excludes private receipts and expense attachments;
 *    `expenses.ts` exposes `/api/store-admin/expenses/<id>/receipt`.
 * 6. `ExpenseForm.tsx`, `migrations/0075_private_expense_receipts.sql`, and
 *    `docs/security-known-risks-20261106.md` match the closed SEC-005 state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from 'jiti';
import { NextResponse } from 'next/server.js';

const root = process.cwd();

test('SEC-005: known-risks doc, migration 0075, and ExpenseForm reflect private receipt separation', async () => {
  const [doc, migration, form] = await Promise.all([
    readFile(path.join(root, 'docs', 'security-known-risks-20261106.md'), 'utf8'),
    readFile(path.join(root, 'migrations', '0075_private_expense_receipts.sql'), 'utf8'),
    readFile(path.join(root, 'src', 'components', 'store-admin', 'ExpenseForm.tsx'), 'utf8'),
  ]);

  assert.match(doc, /L-9 .*remediated in SEC-005/i);
  assert.match(doc, /expense-receipts/);
  assert.match(doc, /migrate-receipts-to-private\.mjs/);

  assert.match(migration, /add column if not exists bucket text not null default 'media'/i);
  assert.match(migration, /bucket in \('media', 'expense-receipts'\)/i);
  assert.match(migration, /bucket = 'expense-receipts' and mime_type = 'application\/pdf'/i);

  assert.match(form, /\/api\/store-admin\/expenses\/receipts/);
  assert.match(form, /application\/pdf/);
  assert.doesNotMatch(form, /fetch\(['"]\/api\/store-admin\/media['"]/);
});

test('SEC-005: POST /api/store-admin/expenses/receipts stores receipts in private bucket only and rejects SVGs', async () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  const createdRows = [];
  const audits = [];
  let roleAllowed = true;
  let currentRole = 'store_admin';

  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ Key: 'receipts/uploaded.pdf' }), { status: 200 });
  };

  try {
    const jiti = createJiti(import.meta.url, {
      moduleCache: false,
      alias: { '@': path.join(root, 'src') },
      virtualModules: {
        'next/server': { NextResponse },
        '@/lib/store-admin/auth': {
          requireStoreRole: async () =>
            roleAllowed
              ? { ok: true, session: { adminId: 'adm-1', email: 'admin@example.com', role: currentRole } }
              : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) },
        },
        '@/lib/store-admin/audit': {
          writeAudit: async (entry) => {
            audits.push(entry);
          },
        },
        '@/lib/store-admin/media': {
          createMedia: async (input) => {
            createdRows.push(input);
            return { ok: true, data: { id: input.id, url: input.url } };
          },
        },
      },
    });

    const { POST } = await jiti.import(
      path.join(root, 'src/app/api/store-admin/expenses/receipts/route.ts'),
    );

    // 1. Valid PDF upload goes strictly to `expense-receipts` with `url = ''` and `private, no-store`
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
    const pdfForm = new FormData();
    pdfForm.set('file', new File([pdfBytes], 'invoice.pdf', { type: 'application/pdf' }));
    pdfForm.set('alt', 'Vendor invoice');

    const resPdf = await POST(
      new Request('https://gadzio.in/api/store-admin/expenses/receipts', {
        method: 'POST',
        headers: {
          origin: 'https://gadzio.in',
          'sec-fetch-site': 'same-origin',
        },
        body: pdfForm,
      }),
    );

    assert.equal(resPdf.status, 201);
    assert.equal(resPdf.headers.get('cache-control'), 'private, no-store');
    const body = await resPdf.json();
    assert.equal(body.ok, true);
    assert.equal(body.media.mimeType, 'application/pdf');
    assert.equal(body.media.url, undefined, 'private receipt upload must not return a public CDN URL');

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/storage\/v1\/object\/expense-receipts\/receipts\/[^/]+\.pdf$/);
    assert.equal(fetchCalls[0].init.headers['cache-control'], 'private, no-store');

    assert.equal(createdRows.length, 1);
    assert.equal(createdRows[0].bucket, 'expense-receipts');
    assert.equal(createdRows[0].url, '');
    assert.equal(createdRows[0].mimeType, 'application/pdf');
    assert.equal(audits.at(-1)?.action, 'expense.receipt.upload');

    // 2. Rejects cross-site CSRF requests
    const csrfRes = await POST(
      new Request('https://gadzio.in/api/store-admin/expenses/receipts', {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'sec-fetch-site': 'cross-site',
        },
        body: pdfForm,
      }),
    );
    assert.equal(csrfRes.status, 403);

    // 3. Rejects active SVG payloads
    const svgForm = new FormData();
    svgForm.set(
      'file',
      new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'bad.svg', {
        type: 'image/svg+xml',
      }),
    );
    const svgRes = await POST(
      new Request('https://gadzio.in/api/store-admin/expenses/receipts', {
        method: 'POST',
        headers: { origin: 'https://gadzio.in', 'sec-fetch-site': 'same-origin' },
        body: svgForm,
      }),
    );
    assert.equal(svgRes.status, 415);

    // 4. Rejects unauthorized roles
    roleAllowed = false;
    const forbiddenRes = await POST(
      new Request('https://gadzio.in/api/store-admin/expenses/receipts', {
        method: 'POST',
        headers: { origin: 'https://gadzio.in', 'sec-fetch-site': 'same-origin' },
        body: pdfForm,
      }),
    );
    assert.equal(forbiddenRes.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('SEC-005: GET /api/store-admin/expenses/[id]/receipt mints 60s signed URL, audits safely, and rate limits', async () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  const originalFetch = globalThis.fetch;
  const signCalls = [];
  const audits = [];
  let rateAllowed = true;
  let requiredRoleArg = '';

  globalThis.fetch = async (url, init = {}) => {
    signCalls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(
      JSON.stringify({ signedURL: '/object/sign/expense-receipts/receipts/r1.pdf?token=secret-jwt' }),
      { status: 200 },
    );
  };

  try {
    const fakeSql = async () => [
      {
        media_id: 'media-r1',
        filename: 'receipt.pdf',
        mime_type: 'application/pdf',
        storage_path: 'receipts/r1.pdf',
        bucket: 'expense-receipts',
      },
    ];

    const jiti = createJiti(import.meta.url, {
      moduleCache: false,
      alias: { '@': path.join(root, 'src') },
      virtualModules: {
        'next/server': { NextResponse },
        '@/lib/platform/db': { getSql: () => fakeSql },
        '@/lib/platform/distributed-rate-limit': {
          checkDistributedRateLimit: async () =>
            rateAllowed
              ? { allowed: true, count: 1, retryAfterSec: 0 }
              : { allowed: false, count: 31, retryAfterSec: 120 },
        },
        '@/lib/store-admin/auth': {
          requireStoreRole: async (role) => {
            requiredRoleArg = role;
            return { ok: true, session: { adminId: 'adm-1', email: 'admin@example.com', role: 'store_admin' } };
          },
        },
        '@/lib/store-admin/audit': {
          writeAudit: async (entry) => {
            audits.push(entry);
          },
        },
      },
    });

    const { GET } = await jiti.import(
      path.join(root, 'src/app/api/store-admin/expenses/[id]/receipt/route.ts'),
    );

    const res = await GET(new Request('https://gadzio.in/api/store-admin/expenses/exp-1/receipt'), {
      params: Promise.resolve({ id: 'exp-1' }),
    });

    assert.equal(requiredRoleArg, 'store_admin');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(
      res.headers.get('location'),
      'https://proj.supabase.co/storage/v1/object/sign/expense-receipts/receipts/r1.pdf?token=secret-jwt',
    );

    assert.equal(signCalls.length, 1);
    assert.match(signCalls[0].url, /\/storage\/v1\/object\/sign\/expense-receipts\/receipts\/r1\.pdf$/);
    assert.equal(signCalls[0].body.expiresIn, 60);

    const audit = audits.at(-1);
    assert.equal(audit.action, 'expense.receipt.view');
    assert.equal(audit.after.attachmentId, 'media-r1');
    assert.equal(audit.after.bucket, 'expense-receipts');
    assert.doesNotMatch(JSON.stringify(audit), /secret-jwt|signed/i);

    rateAllowed = false;
    const limited = await GET(new Request('https://gadzio.in/api/store-admin/expenses/exp-1/receipt'), {
      params: Promise.resolve({ id: 'exp-1' }),
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '120');
    assert.equal(audits.at(-1)?.status, 'denied');
    assert.equal(audits.at(-1)?.reason, 'rate_limited');
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('SEC-005: GET /api/media/[id] blocks private buckets and expense attachments while keeping product images public', async () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';

  try {
    let nextRow = null;
    const jiti = createJiti(import.meta.url, {
      moduleCache: false,
      alias: { '@': path.join(root, 'src') },
      virtualModules: {
        '@/lib/platform/db': { getSql: () => async () => (nextRow ? [nextRow] : []) },
      },
    });
    const { GET } = await jiti.import(path.join(root, 'src/app/api/media/[id]/route.ts'));

    // Private receipt bucket -> 404
    nextRow = {
      filename: 'r.pdf',
      mime_type: 'application/pdf',
      storage_path: 'receipts/r1.pdf',
      bucket: 'expense-receipts',
      is_expense_attachment: true,
    };
    const privateRes = await GET(new Request('https://gadzio.in/api/media/m1'), {
      params: Promise.resolve({ id: 'm1' }),
    });
    assert.equal(privateRes.status, 404);
    assert.equal(privateRes.headers.get('cache-control'), 'no-store');

    // Legacy receipt still in public bucket but linked to an expense -> 404
    nextRow = {
      filename: 'legacy.jpg',
      mime_type: 'image/jpeg',
      storage_path: '2026/legacy.jpg',
      bucket: 'media',
      is_expense_attachment: true,
    };
    const legacyReceiptRes = await GET(new Request('https://gadzio.in/api/media/m2'), {
      params: Promise.resolve({ id: 'm2' }),
    });
    assert.equal(legacyReceiptRes.status, 404);

    // Public product image -> 302 CDN redirect still works cleanly
    nextRow = {
      filename: 'iphone-case.webp',
      mime_type: 'image/webp',
      storage_path: 'products/iphone-case.webp',
      bucket: 'media',
      is_expense_attachment: false,
    };
    const productRes = await GET(new Request('https://gadzio.in/api/media/m3'), {
      params: Promise.resolve({ id: 'm3' }),
    });
    assert.equal(productRes.status, 302);
    assert.equal(
      productRes.headers.get('location'),
      'https://proj.supabase.co/storage/v1/object/public/media/products/iphone-case.webp',
    );
  } finally {
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  }
});

test('SEC-005: listMedia excludes receipts and expenses.ts binds attachmentUrl to authenticated receipt route', async () => {
  const [mediaSrc, expensesSrc] = await Promise.all([
    readFile(path.join(root, 'src', 'lib', 'store-admin', 'media.ts'), 'utf8'),
    readFile(path.join(root, 'src', 'lib', 'store-admin', 'expenses.ts'), 'utf8'),
  ]);

  assert.match(mediaSrc, /bucket.*= 'media'/);
  assert.match(mediaSrc, /not exists \(select 1 from expenses e where e\.attachment_media_id = m\.id\)/);

  assert.match(expensesSrc, /\/api\/store-admin\/expenses\/\$\{encodeURIComponent\(expenseId\)\}\/receipt/);
  assert.doesNotMatch(expensesSrc, /m\.url as attachment_url/);
});

test('SEC-005: createExpense and updateExpense enforce private expense-receipts bucket on attachments', async () => {
  const media = new Map([
    ['media-public', { id: 'media-public', bucket: 'media', url: 'https://cdn.example/public.jpg', deleted_at: null }],
    ['media-private', { id: 'media-private', bucket: 'expense-receipts', url: '', deleted_at: null }],
    ['media-private-2', { id: 'media-private-2', bucket: 'expense-receipts', url: '', deleted_at: null }],
  ]);
  const expenses = new Map([
    [
      'exp_legacy',
      {
        id: 'exp_legacy',
        title: 'Legacy expense',
        category_id: null,
        category_name: null,
        amount_paise: 5000,
        spent_on: '2026-11-20',
        note: '',
        attachment_media_id: 'media-public',
        created_at: new Date('2026-11-20T10:00:00Z'),
        updated_at: new Date('2026-11-20T10:00:00Z'),
        deleted_at: null,
      },
    ],
  ]);
  const queries = [];

  const sql = async (strings, ...values) => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
    queries.push(q);

    if (q === 'select now() as now') {
      return [{ now: new Date('2026-11-22T10:00:00Z') }];
    }

    if (q.includes('from store_settings')) {
      return [];
    }

    if (q.includes('from store_media m') && q.includes('limit 1')) {
      const mediaId = String(values[0]);
      const m = media.get(mediaId);
      if (!m || m.deleted_at !== null) return [];

      const allowUnchanged = values.length >= 3 && values[1] === true;
      const excludedExpenseId = values.length >= 3 ? String(values[2]) : null;
      if (!allowUnchanged && (m.bucket ?? 'media') !== 'expense-receipts') return [];

      const alreadyUsed = [...expenses.values()].some(
        (e) => e.attachment_media_id === mediaId && e.id !== excludedExpenseId,
      );
      return alreadyUsed ? [] : [{ id: m.id }];
    }

    if (q.startsWith('insert into expenses')) {
      const [id, categoryId, title, amountPaise, spentOn, note, attachmentMediaId] = values;
      expenses.set(String(id), {
        id: String(id),
        category_id: categoryId,
        title,
        amount_paise: amountPaise,
        spent_on: spentOn,
        note,
        attachment_media_id: attachmentMediaId,
        created_at: new Date('2026-11-22T10:00:00Z'),
        updated_at: new Date('2026-11-22T10:00:00Z'),
        deleted_at: null,
      });
      return [{ id }];
    }

    if (q.includes('from expenses e') && q.includes('for update of e')) {
      const e = expenses.get(String(values[0]));
      return e && e.deleted_at === null ? [{ ...e }] : [];
    }

    if (q.startsWith('update expenses set')) {
      const [categoryId, title, amountPaise, spentOn, note, attachmentMediaId, , id] = values;
      const e = expenses.get(String(id));
      if (!e) return [];
      e.category_id = categoryId;
      e.title = title;
      e.amount_paise = amountPaise;
      e.spent_on = spentOn;
      e.note = note;
      e.attachment_media_id = attachmentMediaId;
      e.updated_at = new Date('2026-11-22T10:05:00Z');
      return [];
    }

    if (q.includes('from expenses e') && q.includes('left join store_media m')) {
      const id = String(values.at(-1));
      const e = expenses.get(id);
      if (!e || e.deleted_at !== null) return [];
      const m = e.attachment_media_id ? media.get(e.attachment_media_id) : null;
      return [{ ...e, live_attachment_id: m && m.deleted_at === null ? m.id : null }];
    }

    throw new Error(`Unexpected SQL in SEC-005 expenses test: ${q}`);
  };
  sql.unsafe = (fragment) => fragment;
  sql.begin = async (fn) => fn(sql);

  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/platform/db': { getSql: () => sql },
    },
  });

  const { createExpense, updateExpense } = await jiti.import(
    path.join(root, 'src/lib/store-admin/expenses.ts'),
  );

  // 1. Public-bucket media ID is rejected on createExpense
  const badCreate = await createExpense(
    { title: 'Receipt', amount: '120.00', spentOn: '2026-11-22', attachmentMediaId: 'media-public' },
    'adm-1',
  );
  assert.deepEqual(badCreate, { ok: false, reason: 'invalid-input' });
  assert.ok(queries.some((q) => q.includes("to_jsonb(m)->>'bucket', 'media') = 'expense-receipts'")));

  // 2. Private-bucket media ID succeeds on createExpense and links to authenticated receipt route
  const okCreate = await createExpense(
    { title: 'Receipt', amount: '120.00', spentOn: '2026-11-22', attachmentMediaId: 'media-private' },
    'adm-1',
  );
  assert.equal(okCreate.ok, true);
  assert.equal(okCreate.data.attachmentId, 'media-private');
  assert.equal(
    okCreate.data.attachmentUrl,
    `/api/store-admin/expenses/${encodeURIComponent(okCreate.data.id)}/receipt`,
  );

  // 3. Keeping an unchanged legacy attachment when editing other fields still works
  const keepLegacy = await updateExpense(
    'exp_legacy',
    { title: 'Legacy expense edited', amount: '50.00', spentOn: '2026-11-20', attachmentMediaId: 'media-public' },
    'adm-1',
  );
  assert.equal(keepLegacy.ok, true);
  assert.equal(keepLegacy.data.after.title, 'Legacy expense edited');

  // 4. Switching an expense onto a public-bucket media ID is rejected
  const switchToPublic = await updateExpense(
    okCreate.data.id,
    { title: 'Receipt', amount: '120.00', spentOn: '2026-11-22', attachmentMediaId: 'media-public' },
    'adm-1',
  );
  assert.deepEqual(switchToPublic, { ok: false, reason: 'invalid-input' });

  // 5. Switching to another unused private-bucket receipt succeeds
  const switchToPrivate = await updateExpense(
    okCreate.data.id,
    { title: 'Receipt updated', amount: '135.00', spentOn: '2026-11-22', attachmentMediaId: 'media-private-2' },
    'adm-1',
  );
  assert.equal(switchToPrivate.ok, true);
  assert.equal(switchToPrivate.data.after.attachmentId, 'media-private-2');
});

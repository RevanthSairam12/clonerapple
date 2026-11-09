/**
 * Repository & Evidence Secret / PII Scanner (`scripts/check-secrets.mjs`)
 *
 * Scans tracked repository files and `docs/evidence/` for:
 *   1. Private keys (`-----BEGIN ... PRIVATE KEY-----`)
 *   2. Database URLs with embedded real credentials (ignores localhost/test placeholders)
 *   3. Raw session cookie assignments (`gadzio_session=`, `store_admin_session=`, `user_session=`) in `docs/evidence/`
 *   4. 128-character SHA-512 hex hashes in `docs/evidence/`
 *   5. Non-synthetic email addresses or 10-digit Indian phone numbers in `docs/evidence/`
 *   6. Literal values of ambient secret environment variables (`PAYU_KEY`, `PAYU_SALT`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`) when present in `process.env`.
 *
 * Reports file names and match counts ONLY — never prints matched values.
 * Exits with code 1 if any match is found.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.traycer',
  'node_modules',
  'tmp',
]);

const BINARY_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.mp4',
  '.webm',
  '.mov',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.pdf',
  '.zip',
]);

function walk(dir, relativePrefix = '') {
  const results = [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    if (rel === '.env' || rel.startsWith('.env.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, rel));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (!BINARY_EXTS.has(ext)) {
        results.push({ full, rel });
      }
    }
  }
  return results;
}

const ambientSecrets = [
  process.env.PAYU_KEY,
  process.env.PAYU_SALT,
  process.env.CRON_SECRET,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.DATABASE_URL,
  process.env.DATABASE_MIGRATION_URL,
  process.env.SOURCE_DATABASE_URL,
  process.env.DATABASE_URL_PORT,
]
  .filter((v) => typeof v === 'string' && v.trim().length >= 6)
  .map((v) => v.trim());

for (const rawUrl of [
  process.env.DATABASE_URL,
  process.env.DATABASE_MIGRATION_URL,
  process.env.SOURCE_DATABASE_URL,
]) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password && parsed.password.length >= 6) {
      ambientSecrets.push(parsed.password);
      ambientSecrets.push(decodeURIComponent(parsed.password));
    }
  } catch {
    // ignore unset/invalid URL
  }
}

const SAFE_DB_URL_SNIPPETS = [
  'nobody:nothing@127.0.0.1',
  'app:pass@pooler.supabase.com',
  'mig:pass@pooler.supabase.com',
  'u:${secret}@h/db',
  'user:pass@',
  'user:password@',
  '<password>',
  '<user>',
];

function countRealDbUrls(text) {
  const matches = text.match(/postgres(?:ql)?:\/\/[^/\s"']+:[^@\s"']+@[^\s"']+/gi) || [];
  return matches.filter((m) => {
    if (SAFE_DB_URL_SNIPPETS.some((safe) => m.includes(safe))) return false;
    try {
      const u = new URL(m);
      const h = u.hostname.toLowerCase();
      if (
        h === 'localhost' ||
        h === '127.0.0.1' ||
        h === 'host' ||
        h.endsWith('.test') ||
        h.endsWith('.invalid') ||
        h.endsWith('.example') ||
        h.endsWith('.example.com')
      ) {
        return false;
      }
      if (u.password === 'pass' || u.password === 'password' || u.password === 'p' || u.password === 'secret') {
        return false;
      }
    } catch {
      return false;
    }
    return true;
  }).length;
}

const files = walk(ROOT);
const findings = [];

for (const { full, rel } of files) {
  let content = '';
  try {
    content = readFileSync(full, 'utf8');
  } catch {
    continue;
  }

  const counts = {};

  // 1. Private key blocks anywhere in the repo
  const privKeyCount = (content.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g) || []).length;
  if (privKeyCount > 0) counts.private_key_block = privKeyCount;

  // 2. Real database connection URLs with credentials anywhere in the repo
  const dbUrlCount = countRealDbUrls(content);
  if (dbUrlCount > 0) counts.database_url_with_credentials = dbUrlCount;

  // 3. Ambient secret literals anywhere in the repo
  if (ambientSecrets.length > 0) {
    const secretHits = ambientSecrets.reduce(
      (sum, s) => sum + (content.split(s).length - 1),
      0,
    );
    if (secretHits > 0) counts.ambient_env_secret_literal = secretHits;
  }

  // 4. Evidence-specific strict checks (docs/evidence/**)
  if (rel.startsWith('docs/evidence/')) {
    const sha512Hits = (content.match(/\b[a-f0-9]{128}\b/gi) || []).length;
    if (sha512Hits > 0) counts.sha512_hash_in_evidence = sha512Hits;

    const cookieHits = (
      content.match(
        /\b(?:gadzio_session|store_admin_session|user_session|admin_session)=[A-Za-z0-9._-]{8,}/g,
      ) || []
    ).length;
    if (cookieHits > 0) counts.session_cookie_in_evidence = cookieHits;

    const nonTestEmails = (
      content.match(
        /[A-Za-z0-9._%+-]+@(?!example\.invalid\b|example\.test\b|example\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      ) || []
    ).length;
    if (nonTestEmails > 0) counts.non_test_email_in_evidence = nonTestEmails;

    const phoneHits = (content.match(/\b[6-9]\d{9}\b/g) || []).length;
    if (phoneHits > 0) counts.unmasked_phone_in_evidence = phoneHits;

    const realLookingNames = (
      content.match(/\b(?:Asha\s+Sharma|Rohan\s+Verma|Asha|Rohan)\b/g) || []
    ).length;
    if (realLookingNames > 0) counts.real_looking_name_in_evidence = realLookingNames;
  }

  if (Object.keys(counts).length > 0) {
    findings.push({ file: rel, counts });
  }
}

console.log(
  JSON.stringify(
    {
      scannedFiles: files.length,
      filesWithFindings: findings.length,
      findings,
    },
    null,
    2,
  ),
);

if (findings.length > 0) {
  process.exitCode = 1;
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

async function loadEnvLocal() {
  try {
    const env = await readFile(path.resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Environment variables may already be set.
  }
}

async function readRows(table) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) throw new Error('Supabase REST configuration is unavailable.');

  const response = await fetch(`${base}/rest/v1/${table}?select=*&limit=1000`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) return { status: response.status, rows: 0 };

  const payload = await response.json();
  return { status: response.status, rows: Array.isArray(payload) ? payload.length : 0 };
}

function print(table, result) {
  console.log(`${table}: HTTP ${result.status}, rows ${result.rows}`);
}

function consumerCheck(result) {
  return result.status === 401 || result.status === 403 || (result.status >= 200 && result.status < 300 && result.rows === 0);
}

async function main() {
  await loadEnvLocal();

  const users = await readRows('users');
  const userSessions = await readRows('user_sessions');
  const orders = await readRows('orders');
  const contentBlocks = await readRows('content_blocks');
  const products = await readRows('products');

  print('users', users);
  print('user_sessions', userSessions);
  print('orders', orders);
  print('content_blocks', contentBlocks);
  print('products', products);

  if (
    !consumerCheck(users) ||
    !consumerCheck(userSessions) ||
    !consumerCheck(orders) ||
    contentBlocks.status !== 200 ||
    contentBlocks.rows === 0 ||
    products.status !== 200 ||
    products.rows !== 12
  ) {
    process.exitCode = 1;
  }
}

main().catch(() => {
  process.exitCode = 1;
});

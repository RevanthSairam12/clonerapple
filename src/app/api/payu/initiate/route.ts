import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getPayUConfig, assertPayUConfigured } from '@/lib/payu/config';
import { generateRequestHash } from '@/lib/payu/hash';
import { createOrder } from '@/lib/payu/orders';
import { resolveCartItems } from '@/lib/payu/catalog';
import { getUserSession } from '@/lib/user-auth';
import { checkRateLimit } from '@/lib/payu/rate-limit';

export const runtime = 'nodejs';

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z\s]/g, '').trim();
}

function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  // If 12 digits starting with 91, strip 91
  if (digits.length === 12 && digits.startsWith('91')) {
    const raw = digits.slice(2);
    return /^[6-9]\d{9}$/.test(raw) ? raw : null;
  }
  // If 11 digits starting with 0, strip 0
  if (digits.length === 11 && digits.startsWith('0')) {
    const raw = digits.slice(1);
    return /^[6-9]\d{9}$/.test(raw) ? raw : null;
  }
  // Standard 10 digits starting with 6-9
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return digits;
  }
  return null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Generates an alphanumeric, cryptographically random transaction ID (max 25 chars).
 * Format: "GDZ" + timestamp (base36, ~8 chars) + random hex (12 chars) = ~23 chars.
 */
function generateTxnId(): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(6).toString('hex').toUpperCase();
  const txnid = `GDZ${time}${rand}`;
  return txnid.slice(0, 25);
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);

    // Rate limit per IP: max 20 initiate requests per 5 minutes
    const ipLimit = checkRateLimit(`payu-init-ip:${ip}`, { limit: 20, windowMs: 5 * 60 * 1000 });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many payment requests from this IP. Please wait a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSec) } }
      );
    }

    // Authenticated user check
    const userSession = await getUserSession();
    if (!userSession) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in or create an account to proceed with purchase.' },
        { status: 401 }
      );
    }
    const userId = userSession.userId;

    const userLimit = checkRateLimit(`payu-init-user:${userId}`, { limit: 10, windowMs: 5 * 60 * 1000 });
    if (!userLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many payment attempts for this account. Please wait.' },
        { status: 429, headers: { 'Retry-After': String(userLimit.retryAfterSec) } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    // 1. Resolve cart items and compute price strictly server-side
    const rawItems = body.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return NextResponse.json({ error: 'Cart must contain at least one item.' }, { status: 400 });
    }

    let cart;
    try {
      cart = resolveCartItems(rawItems);
    } catch (err: unknown) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    // 2. Validate and sanitize customer details
    const customer = body.customer || {};
    const rawFirstName = customer.firstname || userSession?.firstName || '';
    const firstname = sanitizeName(rawFirstName);
    if (!firstname || firstname.length < 2 || firstname.length > 50) {
      return NextResponse.json(
        { error: 'A valid first name (2-50 alphabetic characters) is required.' },
        { status: 400 }
      );
    }

    const rawEmail = (customer.email || userSession?.email || '').trim().toLowerCase();
    if (!isValidEmail(rawEmail)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }

    const rawPhone = String(customer.phone || '').trim();
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return NextResponse.json(
        { error: 'A valid 10-digit Indian mobile number is required.' },
        { status: 400 }
      );
    }

    // 3. Prepare PayU Config
    const config = getPayUConfig();
    assertPayUConfigured(config);

    // 4. Generate txnid and format exact 2-decimal amount
    const txnid = generateTxnId();
    const amountStr = cart.totalAmount.toFixed(2); // E.g. "5900.00"

    // 5. Create Order in Database with status 'CREATED'
    await createOrder({
      txnid,
      userId,
      items: cart.items,
      amount: cart.totalAmount,
      currency: 'INR',
      customerName: firstname,
      customerEmail: rawEmail,
      customerPhone: phone,
    });

    // 6. Generate request hash
    const { hash, hashStringForLog } = generateRequestHash({
      key: config.key,
      txnid,
      amount: amountStr,
      productinfo: cart.productSummary,
      firstname,
      email: rawEmail,
      salt: config.salt,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[PayU Initiate] Dev Hash String: ${hashStringForLog}`);
      console.log(`[PayU Initiate] txnid=${txnid} amount=${amountStr}`);
    }

    // 7. Form parameters (public URLs over HTTPS)
    const surl = `${config.appBaseUrl}/api/payu/success`;
    const furl = `${config.appBaseUrl}/api/payu/failure`;
    const curl = `${config.appBaseUrl}/api/payu/cancel`;

    return NextResponse.json({
      success: true,
      actionUrl: config.paymentUrl,
      fields: {
        key: config.key,
        txnid,
        amount: amountStr,
        productinfo: cart.productSummary,
        firstname,
        email: rawEmail,
        phone,
        surl,
        furl,
        curl,
        hash,
      },
    });
  } catch (error: unknown) {
    console.error('[PayU Initiate Error]:', (error as Error).message);
    return NextResponse.json(
      { error: 'Failed to initiate payment. Please try again later.' },
      { status: 500 }
    );
  }
}

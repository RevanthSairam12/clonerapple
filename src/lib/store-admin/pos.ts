import { randomBytes } from 'node:crypto';

import { getSql } from '@/lib/platform/db';
import { resolveEffectivePrice } from '@/lib/storefront/pricing';
import { getStoreSession } from './auth';
import { ensureInvoiceIssuedInTx } from '@/lib/orders/invoice';
import { optionSnapshotLabel } from '@/lib/orders/option-snapshot';
import { inventoryKey } from './variant-inventory-rules';
import { strictMetadataAudit } from './product-metadata';
import { restoreSoldStock } from '@/lib/payu/stock';
import { maskCustomerPhone } from './masking';
import {
  canEnterPosPrice,
  canVoidPosSale,
  cashVariancePaise,
  expectedCashPaise,
  formatReceiptNo,
  unconfirmedFreeLines,
  unusualPriceWarning,
  validatePosCart,
  validatePosPrices,
  type PosPaymentMethod,
  type PosPriceWarning,
} from './pos-rules';
import { DEFAULT_SETTINGS, normalizeToggle } from './settings-rules';
import { setTransactionTimeouts } from '@/lib/checkout/transaction-guards';

type Sql = NonNullable<ReturnType<typeof getSql>>;

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: POS repository must be server-only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function integer(value: unknown): number {
  return Math.max(0, Math.trunc(number(value)));
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

/* ------------------------------------------------------------- types */

export interface PosCatalogProduct {
  id: string;
  productId: string;
  variantId: string|null;
  variantSku: string|null;
  variantLabel: string|null;
  name: string;
  subtitle: string;
  /** The effective catalogue price, shown only as a reference at the till. */
  listPricePaise: number;
  currency: string;
  onHand: number | null;
  trackInventory: boolean;
}

export interface ShiftSummary {
  id: number;
  staffId: string;
  staffName: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingFloatPaise: number;
  expectedCashPaise: number | null;
  countedCashPaise: number | null;
  variancePaise: number | null;
  notes: string;
  totalsByMethod: Record<string, number>;
  salesCount: number;
}

export interface PosSaleLine {
  lineNumber: number;
  productId: string;
  productName: string;
  variantId: string|null;
  variantSku: string|null;
  variantLabel: string|null;
  /** The exact option, written with the line so the receipt keeps it. */
  deviceModelId?: string | null;
  deviceModelName?: string | null;
  colourId?: string | null;
  colourName?: string | null;
  colourHex?: string | null;
  quantity: number;
  /** The price charged, typed by the cashier. */
  unitPricePaise: number;
  /** The effective catalogue price at the moment of sale, for reference only. */
  referencePricePaise: number | null;
  lineTotalPaise: number;
  currency: string;
}

export interface PosSaleResultData {
  orderId: string;
  txnid: string;
  receiptNo: string;
  paymentId: number;
  providerRef: string | null;
  lines: PosSaleLine[];
  subtotalPaise: number;
  totalPaise: number;
  method: PosPaymentMethod;
  shiftId: number;
  customerPhoneMasked: string | null;
}

export type PosSaleResult =
  | { ok: true; data: PosSaleResultData }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'not-found'
        | 'invalid-input'
        | 'no-open-shift'
        | 'out-of-stock'
        | 'forbidden'
        | 'unusual-price';
      error: string;
      warnings?: PosPriceWarning[];
    };

/* -------------------------------------------------------- catalogue */

/**
 * The catalogue products for the POS search, read from the database through
 * the owner connection. The list price is a reference only: the cashier types
 * the price charged. Sale resolution supplies reference amounts only.
 */
export type PosCatalogLoad =
  | { ok: true; products: PosCatalogProduct[] }
  | { ok: false; reason: 'unavailable' };

/** Read the live catalogue from the database (owner connection). */
export async function getPosCatalog(): Promise<PosCatalogLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  return getPosCatalogUsing(sql);
}

/** Injected connection keeps reference-pricing tests entirely offline. */
export async function getPosCatalogUsing(sql: Sql): Promise<PosCatalogLoad> {
  try {
    const rows = (await sql`
      select p.id, p.name, p.subtitle, p.price_paise, p.sale_price_paise, p.currency,
             v.price_paise_override, v.sale_price_paise as variant_sale_price_paise,
             v.id as variant_id,v.sku as variant_sku,concat_ws(' / ',dm.name,v.option_value) as variant_label,
             s.on_hand-s.reserved as on_hand, s.track_inventory
      from products p
      left join product_types pt on pt.id=p.product_type_id
      left join product_variants v on p.inventory_mode='variant' and v.product_id=p.id and v.is_active and v.is_purchasable and v.retired_at is null
        and nullif(trim(v.sku),'') is not null and nullif(trim(v.combination_key),'') is not null
        and (not coalesce(pt.requires_compatibility,false) or v.device_model_id is not null)
      left join device_models dm on dm.id=v.device_model_id
      left join stock s on s.product_id = p.id and s.variant_id is not distinct from v.id
      where p.is_active and p.deleted_at is null and (p.inventory_mode='product' or (v.id is not null and s.id is not null and (v.device_model_id is null or exists(select 1 from product_device_models pm join device_models dm on dm.id=pm.device_model_id join device_brands db on db.id=dm.brand_id where pm.product_id=p.id and pm.device_model_id=v.device_model_id and pm.archived_at is null))))
      order by p.name
    `) as Row[];
    return {
      ok: true,
      products: rows.map((row) => ({
        id:inventoryKey(text(row.id),nullableText(row.variant_id)),productId:text(row.id),variantId:nullableText(row.variant_id),variantSku:nullableText(row.variant_sku),variantLabel:nullableText(row.variant_label),
        name: text(row.name)+(row.variant_label?` — ${text(row.variant_label)}`:''),
        subtitle: text(row.subtitle),
        listPricePaise: referencePriceOf(row, row.variant_id ? {
          price_paise_override: row.price_paise_override,
          sale_price_paise: row.variant_sale_price_paise,
        } : undefined),
        currency: text(row.currency) || 'INR',
        onHand: row.on_hand === null || row.on_hand === undefined ? null : integer(row.on_hand),
        trackInventory: Boolean(row.track_inventory),
      })),
    };
  } catch {
    console.warn('[store-admin/pos] could not read the catalogue');
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * The comparison price shown at the till, and what "Use list price" inserts.
 *
 * `order_items.reference_price_paise` and the POS "List" figure are the
 * **regular** catalogue price (migration 0040), not the price a live sale
 * advertises: a cashier must be able to see and charge the normal price even
 * while the storefront is discounting. The resolver is therefore always called
 * with the sale switched off, so a sale override can never lower it.
 */
function referencePriceOf(product: Row, option?: Row): number {
  return resolveEffectivePrice({ pricePaise: number(product.price_paise),
    salePricePaise: product.sale_price_paise == null ? null : number(product.sale_price_paise) }, false,
  option ? { pricePaise: option.price_paise_override == null ? null : number(option.price_paise_override),
    salePricePaise: option.sale_price_paise == null ? null : number(option.sale_price_paise) } : undefined).regularPaise;
}

/* ---------------------------------------------------------- shifts */

export type ShiftLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' };

function totalsByMethodFromRows(rows: Row[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[text(row.method)] = number(row.total_paise);
  }
  return totals;
}

function mapShift(row: Row, methodRows: Row[], salesCount: number): ShiftSummary {
  return {
    id: number(row.id),
    staffId: text(row.staff_id),
    staffName: text(row.staff_name),
    status: row.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
    openedAt: iso(row.opened_at),
    closedAt: row.closed_at ? iso(row.closed_at) : null,
    openingFloatPaise: number(row.opening_float_paise),
    expectedCashPaise: row.expected_cash_paise === null ? null : number(row.expected_cash_paise),
    countedCashPaise: row.counted_cash_paise === null ? null : number(row.counted_cash_paise),
    variancePaise: row.variance_paise === null ? null : number(row.variance_paise),
    notes: text(row.notes),
    totalsByMethod: totalsByMethodFromRows(methodRows),
    salesCount,
  };
}

export async function getOpenShiftForStaff(staffId: string): Promise<
  | { ok: true; shift: { id: number } | null }
  | { ok: false; reason: 'unavailable' }
> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select id from pos_shifts
      where staff_id = ${staffId} and status = 'OPEN'
      limit 1
    `) as Row[];
    return { ok: true, shift: rows[0] ? { id: number(rows[0].id) } : null };
  } catch {
    console.warn('[store-admin/pos] could not read the open shift');
    return { ok: false, reason: 'unavailable' };
  }
}

export type OpenShiftResult =
  | { ok: true; shiftId: number }
  | { ok: false; reason: 'unavailable' | 'shift-open' | 'invalid-input'; error: string };

/** Open a shift with an opening float. One open shift per staff member. */
export async function openShift(input: {
  staffId: string;
  openingFloatPaise: number;
}): Promise<OpenShiftResult> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Shifts are not available.' };
  try {
    return await sql.begin(async (tx) => {
      await setTransactionTimeouts(tx);
      const existing = (await tx`
        select id from pos_shifts
        where staff_id = ${input.staffId} and status = 'OPEN'
        for update
      `) as Row[];
      if (existing[0]) {
        return { ok: false as const, reason: 'shift-open' as const, error: 'You already have an open shift.' };
      }
      const rows = (await tx`
        insert into pos_shifts (staff_id, opening_float_paise)
        values (${input.staffId}, ${input.openingFloatPaise})
        returning id
      `) as Row[];
      return { ok: true as const, shiftId: number(rows[0]?.id ?? 0) };
    });
  } catch {
    console.warn('[store-admin/pos] could not open a shift');
    return { ok: false, reason: 'unavailable', error: 'Shifts are not available.' };
  }
}

export type CloseShiftResult =
  | {
      ok: true;
      shift: ShiftSummary;
    }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'invalid-input'; error: string };

/**
 * Close the caller's open shift with a counted cash drawer. The expected
 * cash (opening float + cash PAID in the shift − cash refunds in the shift)
 * and variance are computed and stored, never trusted from the browser.
 */
export async function closeShift(input: {
  staffId: string;
  countedCashPaise: number;
  notes: string | null;
}): Promise<CloseShiftResult> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Shifts are not available.' };
  try {
    return await sql.begin(async (tx) => {
      await setTransactionTimeouts(tx);
      const rows = (await tx`
        select id, opening_float_paise from pos_shifts
        where staff_id = ${input.staffId} and status = 'OPEN'
        for update
        limit 1
      `) as Row[];
      const open = rows[0];
      if (!open) {
        return { ok: false as const, reason: 'not-found' as const, error: 'You have no open shift.' };
      }
      const shiftId = number(open.id);
      const openingFloatPaise = number(open.opening_float_paise);

      const cashRows = (await tx`
        select
          coalesce(sum(amount_paise) filter (where status = 'PAID'), 0)::bigint as sales,
          coalesce(sum(amount_paise) filter (where status in ('REFUNDED','PARTIALLY_REFUNDED')), 0)::bigint as refunds
        from order_payments
        where pos_shift_id = ${shiftId} and method = 'cash'
      `) as Row[];
      const cashSales = number(cashRows[0]?.sales);
      const cashRefunds = number(cashRows[0]?.refunds);

      // Expected cash and variance come from the shared pure rules, so the
      // stored drawer figures and the tested helper can never drift apart.
      const expected = expectedCashPaise(openingFloatPaise, cashSales, cashRefunds);
      const variance = cashVariancePaise(input.countedCashPaise, expected);

      const shiftRows = (await tx`
        update pos_shifts
        set status = 'CLOSED',
            closed_at = now(),
            expected_cash_paise = ${expected},
            counted_cash_paise = ${input.countedCashPaise},
            variance_paise = ${variance},
            notes = coalesce(${input.notes}, notes)
        where id = ${shiftId}
        returning id, staff_id, status, opened_at, closed_at,
                  opening_float_paise, expected_cash_paise,
                  counted_cash_paise, variance_paise, notes
      `) as Row[];

      const methodRows = (await tx`
        select method, coalesce(sum(amount_paise), 0)::bigint as total_paise
        from order_payments
        where pos_shift_id = ${shiftId} and status = 'PAID'
        group by method
      `) as Row[];

      const salesRows = (await tx`
        select count(*)::int as sales
        from orders
        where pos_shift_id = ${shiftId}
      `) as Row[];

      return {
        ok: true as const,
        shift: mapShift(shiftRows[0], methodRows, integer(salesRows[0]?.sales)),
      };
    });
  } catch {
    console.warn('[store-admin/pos] could not close a shift');
    return { ok: false, reason: 'unavailable', error: 'Shifts are not available.' };
  }
}

export async function getCurrentShift(staffId: string): Promise<
  | { ok: true; shift: ShiftSummary | null }
  | { ok: false; reason: 'unavailable' }
> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select s.id, s.staff_id, s.status, s.opened_at, s.closed_at,
             s.opening_float_paise, s.expected_cash_paise,
             s.counted_cash_paise, s.variance_paise, s.notes,
             a.name as staff_name
      from pos_shifts s
      join store_admins a on a.id = s.staff_id
      where s.staff_id = ${staffId}
      order by s.opened_at desc, s.id desc
      limit 1
    `) as Row[];
    const row = rows[0];
    if (!row) return { ok: true, shift: null };

    const [methodRows, salesRows] = await Promise.all([
      sql`
        select method, coalesce(sum(amount_paise), 0)::bigint as total_paise
        from order_payments
        where pos_shift_id = ${number(row.id)} and status = 'PAID'
        group by method
      `,
      sql`
        select count(*)::int as sales
        from orders
        where pos_shift_id = ${number(row.id)}
      `,
    ]);
    return { ok: true, shift: mapShift(row, methodRows as Row[], integer((salesRows as Row[])[0]?.sales)) };
  } catch {
    console.warn('[store-admin/pos] could not read the shift');
    return { ok: false, reason: 'unavailable' };
  }
}

/* ------------------------------------------------------------- sale */

/**
 * Create one POS sale in a single locked transaction: order (channel 'pos',
 * payment PAID, fulfilment DELIVERED) + order_items + order_payments + receipt
 * number + stock decrement + stock movements.
 *
 * The price charged is the integer paise the cashier typed for each line. The
 * effective catalogue price is stored beside it as a reference only. Starting
 * or ending sale mode mid-bill has no effect on a price already entered.
 * Product identity, quantity and stock
 * still come from the database, under row locks.
 */
export interface CreatePosSaleInput {
  lines: unknown;
  method: PosPaymentMethod;
  providerRef: string | null;
  customerPhone: string | null;
  staffId: string;
  role: 'store_owner' | 'store_admin' | 'store_viewer';
  /** Set only after the till asked the cashier to confirm an unusual price. */
  confirmUnusualPrices?: boolean;
  /** Product ids the cashier explicitly confirmed as free (zero-priced) items. */
  confirmedFreeItemIds?: unknown;
}

export async function createPosSale(input: CreatePosSaleInput): Promise<PosSaleResult> {
  if (!canEnterPosPrice(input.role)) {
    return {
      ok: false,
      reason: 'forbidden',
      error: 'Only a store admin or store owner can enter a selling price.',
    };
  }

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Order records are not available.' };
  return createPosSaleUsing(sql, input);
}

/** The database-injected form, used by integration tests with a temp schema. */
export async function createPosSaleUsing(sql: Sql, input: CreatePosSaleInput): Promise<PosSaleResult> {
  if (!canEnterPosPrice(input.role)) {
    return {
      ok: false,
      reason: 'forbidden',
      error: 'Only a store admin or store owner can enter a selling price.',
    };
  }

  const cart = validatePosCart(input.lines);
  if (!cart.ok) return { ok: false, reason: 'invalid-input', error: cart.error };

  const priced = validatePosPrices(input.lines, cart.lines);
  if (!priced.ok) return { ok: false, reason: 'invalid-input', error: priced.error };

  const txnid = `POS-${randomBytes(9).toString('hex').toUpperCase()}`;
  const orderId = `ord_${randomBytes(12).toString('hex')}`;
  const customerPhone = input.customerPhone?.trim() || null;

  try {
    const committed = await sql.begin(async (tx) => {
      await setTransactionTimeouts(tx);
      // Configuration activation cannot race an old parent-identity sale.
      await tx`select pg_advisory_xact_lock_shared(513031,3)`;
      // The shift must be open for the whole transaction.
      const shiftRows = (await tx`
        select id from pos_shifts
        where staff_id = ${input.staffId} and status = 'OPEN'
        for update
        limit 1
      `) as Row[];
      const shift = shiftRows[0];
      if (!shift) {
        return { ok: false as const, reason: 'no-open-shift' as const, error: 'Open a shift before ringing up sales.' };
      }
      const shiftId = number(shift.id);

      // Read every product before writing anything. The entered price is the
      // charged price; the effective option price is a reference snapshot only.
      const lines: PosSaleLine[] = [];
      const warnings: PosPriceWarning[] = [];
      for (let index = 0; index < priced.lines.length; index += 1) {
        const cartLine = priced.lines[index];
        const baseId = cartLine.id;
        const productRows = (await tx`
          select id, name, price_paise, cost_paise,inventory_mode,sale_price_paise
          from products
          where id = ${baseId} and is_active and deleted_at is null
          limit 1
        `) as Row[];
        const product = productRows[0];
        if (!product) {
          return {
            ok: false as const,
            reason: 'not-found' as const,
            error: `Product '${cartLine.id}' is not in the active catalogue.`,
          };
        }
        const variantId=cartLine.variantId??null;
        if((product.inventory_mode==='variant')!==Boolean(variantId)) return {ok:false as const,reason:'invalid-input' as const,error:'Select the exact purchasable combination; product-level selections cannot be substituted.'};
        const variantRows=variantId?await tx`select v.*, dm.name as device_model_name, c.id as colour_id, c.name as colour_name, c.hex as colour_hex
          from product_variants v
          left join products p on p.id=v.product_id
          left join product_types pt on pt.id=p.product_type_id
          left join device_models dm on dm.id=v.device_model_id
          left join product_variant_colours pvc on pvc.variant_id=v.id
          left join colours c on c.id=pvc.colour_id
          where v.id=${variantId} and v.product_id=${baseId} and v.is_active and v.is_purchasable and v.retired_at is null and nullif(trim(v.sku),'') is not null and nullif(trim(v.combination_key),'') is not null and (not coalesce(pt.requires_compatibility,false) or v.device_model_id is not null) and (v.device_model_id is null or exists(select 1 from product_device_models pm join device_models dmm on dmm.id=pm.device_model_id join device_brands db on db.id=dmm.brand_id where pm.product_id=v.product_id and pm.device_model_id=v.device_model_id and pm.archived_at is null))`:[];
        const variant=variantRows[0];
        if(variantId&&!variant)return {ok:false as const,reason:'invalid-input' as const,error:'Variant is missing, inactive or has an invalid model mapping.'};
        const regularPricePaise = integer(variant?.price_paise_override??product.price_paise);
        const costPaise = product.cost_paise === null || product.cost_paise === undefined
          ? null
          : integer(product.cost_paise);
        const productId = text(product.id);
        const productName = text(product.name);
        const warning = unusualPriceWarning({
          unitPricePaise: cartLine.unitPricePaise,
          regularPricePaise,
          costPaise,
        });
        if (warning) {
          warnings.push({ productId, productName, message: warning });
        }
        const optionSnapshot = {
          deviceModelName: nullableText(variant?.device_model_name),
          colourName: nullableText(variant?.colour_name),
          colourHex: nullableText(variant?.colour_hex),
          variantLabel: variant ? `${text(variant.option_name)}: ${text(variant.option_value)}` : null,
        };
        lines.push({
          lineNumber: index + 1,
          productId,
          productName,
          variantId,variantSku:nullableText(variant?.sku),variantLabel:optionSnapshotLabel(optionSnapshot),
          deviceModelId:nullableText(variant?.device_model_id),
          deviceModelName:optionSnapshot.deviceModelName,
          colourId:nullableText(variant?.colour_id),
          colourName:optionSnapshot.colourName,
          colourHex:optionSnapshot.colourHex,
          quantity: cartLine.quantity,
          unitPricePaise: cartLine.unitPricePaise,
          referencePricePaise: referencePriceOf(product, variant),
          lineTotalPaise: cartLine.unitPricePaise * cartLine.quantity,
          currency: 'INR',
        });
      }

      // Zero is allowed only after an explicit free-item confirmation.
      const zeroCandidates = priced.lines.map((line) => ({
        ...line,
        id: line.variantId?inventoryKey(line.id,line.variantId):line.id,
      }));
      const unconfirmedZero = unconfirmedFreeLines(zeroCandidates, input.confirmedFreeItemIds);
      if (unconfirmedZero.length > 0) {
        const names = unconfirmedZero.map((line) =>
          lines.find((saleLine) => saleLine.productId === line.id)?.productName ?? line.id,
        );
        return {
          ok: false as const,
          reason: 'invalid-input' as const,
          error: `Confirm the free item (${names.join(', ')}) before completing the sale.`,
        };
      }

      // The typo guard is a confirmation, never a block. The setting can turn
      // the prompt off; the price is still recorded exactly as typed.
      if (warnings.length > 0 && !input.confirmUnusualPrices) {
        const settingRows = (await tx`
          select value from store_settings where key = 'pos_confirm_unusual_price'
        `) as Row[];
        const settingValue = settingRows[0]
          ? text(settingRows[0].value)
          : DEFAULT_SETTINGS.pos_confirm_unusual_price;
        if (normalizeToggle(settingValue) === 'on') {
          return {
            ok: false as const,
            reason: 'unusual-price' as const,
            error: 'Confirm this price before completing the sale.',
            warnings,
          };
        }
      }

      // Lock and check stock before the order is written. Holding these row
      // locks until commit serialises two tills racing for the last unit.
      for (const line of [...lines].sort((a,b)=>inventoryKey(a.productId,a.variantId).localeCompare(inventoryKey(b.productId,b.variantId)))) {
        const stockRows = (await tx`
          select on_hand, reserved,track_inventory from stock
          where product_id = ${line.productId} and variant_id is not distinct from ${line.variantId}::text
          for update
        `) as Row[];
        const stockRow = stockRows[0];
        if ((line.variantId&&!stockRow)||(stockRow && Boolean(stockRow.track_inventory) && integer(stockRow.on_hand)-integer(stockRow.reserved) < line.quantity)) {
          return {
            ok: false as const,
            reason: 'out-of-stock' as const,
            error: `Not enough stock for ${line.productName}.`,
          };
        }
      }

      // Receipt number: allocated under the counter row lock, never reused.
      const counterRows = (await tx`
        update receipt_counters
        set next_number = next_number + 1
        where name = 'pos_receipt'
        returning next_number
      `) as Row[];
      if (!counterRows[0]) {
        return { ok: false as const, reason: 'unavailable' as const, error: 'Receipt numbering is not available.' };
      }
      const receiptNo = formatReceiptNo(number(counterRows[0].next_number) - 1);

      const subtotalPaise = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
      const itemsSnapshot = lines.map((line) => ({
        id: line.productId,
        variantId:line.variantId,variantSku:line.variantSku,variantLabel:line.variantLabel,
        deviceModelName:line.deviceModelName??null,colourName:line.colourName??null,colourHex:line.colourHex??null,
        name: line.productName,
        quantity: line.quantity,
        unitPrice: line.unitPricePaise / 100,
        referencePrice: line.referencePricePaise === null ? null : line.referencePricePaise / 100,
        totalPrice: line.lineTotalPaise / 100,
      }));

      const orderRows = (await tx`
        insert into orders (
          id, txnid, items, amount, currency, status,
          customer_name, customer_email, customer_phone,
          channel, fulfilment_status, payment_method,
          subtotal_paise, discount_paise, shipping_paise, total_paise,
          staff_id, paid_at, pos_shift_id, pos_receipt_no,
          created_at, updated_at
        ) values (
          ${orderId}, ${txnid}, ${tx.json(itemsSnapshot)}, ${subtotalPaise / 100}, 'INR', 'PAID',
          'POS customer', '', ${customerPhone ?? ''},
          'pos', 'DELIVERED', ${input.method},
          ${subtotalPaise}, 0, 0, ${subtotalPaise},
          ${input.staffId}, now(), ${shiftId}, ${receiptNo},
          now(), now()
        )
        returning id, txnid
      `) as Row[];
      const createdId = text(orderRows[0].id);
      await ensureInvoiceIssuedInTx(tx, createdId, input.staffId);

      // The snapshot columns arrive with migration 0061. Probe once so a
      // database that has not run it keeps the exact previous POS insert.
      const [snapshotSupport] = (await tx`
        select exists (
          select 1 from information_schema.columns
          where table_name = 'order_items' and column_name = 'variant_colour_id'
        ) as present
      `) as Row[];
      const writeSnapshots = snapshotSupport?.present === true;
      for (const line of lines) {
        if (writeSnapshots) {
          await tx`
            insert into order_items (
              order_id, line_number, product_id, product_name,variant_id,variant_sku,variant_label,
              variant_device_model_id, variant_device_model_name,
              variant_colour_id, variant_colour_name, variant_colour_hex,
              quantity, unit_price_paise, reference_price_paise,
              line_total_paise, currency
            ) values (
              ${createdId}, ${line.lineNumber}, ${line.productId}, ${line.productName},${line.variantId},${line.variantSku},${line.variantLabel},
              ${line.deviceModelId ?? null},${line.deviceModelName ?? null},
              ${line.colourId ?? null},${line.colourName ?? null},${line.colourHex ?? null},
              ${line.quantity}, ${line.unitPricePaise}, ${line.referencePricePaise},
              ${line.lineTotalPaise}, 'INR'
            )
          `;
          continue;
        }
        await tx`
          insert into order_items (
            order_id, line_number, product_id, product_name,variant_id,variant_sku,variant_label,
            quantity, unit_price_paise, reference_price_paise,
            line_total_paise, currency
          ) values (
            ${createdId}, ${line.lineNumber}, ${line.productId}, ${line.productName},${line.variantId},${line.variantSku},${line.variantLabel},
            ${line.quantity}, ${line.unitPricePaise}, ${line.referencePricePaise},
            ${line.lineTotalPaise}, 'INR'
          )
        `;
      }

      // A free-item sale has a zero total. `order_payments` requires a
      // positive amount, so it carries no payment row; the order is still
      // PAID and keeps its cashier, receipt number and payment method.
      let paymentId = 0;
      if (subtotalPaise > 0) {
        const paymentRows = (await tx`
          insert into order_payments (
            order_id, channel, method, amount_paise, status,
            provider_ref, paid_at, received_by_staff_id, pos_shift_id
          ) values (
            ${createdId}, 'pos', ${input.method}, ${subtotalPaise}, 'PAID',
            ${input.providerRef}, now(), ${input.staffId}, ${shiftId}
          )
          returning id
        `) as Row[];
        paymentId = number(paymentRows[0]?.id);
      }

      await tx`
        insert into order_status_history (order_id, domain, actor, from_status, to_status)
        values (${createdId}, 'payment', 'store_admin', null, 'PAID')
      `;

      // Stock: tracked products decrement; untracked products skip the
      // decrement but still write the movement row. The pre-check above holds
      // the row lock, so this update cannot lose a race.
      for (const line of lines) {
        const updated = (await tx`
          update stock
          set on_hand = on_hand - ${line.quantity},
              updated_at = now(), updated_by = ${input.staffId}
          where product_id = ${line.productId}
            and variant_id is not distinct from ${line.variantId}::text
            and track_inventory
            and on_hand-reserved >= ${line.quantity}
          returning on_hand
        `) as Row[];
        if (!updated[0]) {
          const trackedRows = (await tx`
            select 1 from stock
            where product_id = ${line.productId} and variant_id is not distinct from ${line.variantId}::text and track_inventory
            limit 1
          `) as Row[];
          if (trackedRows[0]) {
            throw new Error('POS_STOCK_CHANGED');
          }
        }
        await tx`
          insert into stock_movements (product_id, variant_id,delta, reason, order_id, created_by)
          values (${line.productId}, ${line.variantId},${-line.quantity}, 'sale', ${createdId}, ${input.staffId})
        `;
      }

      await strictMetadataAudit(tx,{actorId:input.staffId,action:'pos.sale',entity:'order',entityId:createdId,after:{txnid,receiptNo,totalPaise:subtotalPaise,lines:lines.map(l=>({productId:l.productId,variantId:l.variantId,quantity:l.quantity,unitPricePaise:l.unitPricePaise}))}});
      return {
        ok: true as const,
        data: {
          orderId: createdId,
          txnid: text(orderRows[0].txnid),
          receiptNo,
          paymentId,
          providerRef: input.providerRef,
          lines,
          subtotalPaise,
          totalPaise: subtotalPaise,
          method: input.method,
          shiftId,
          customerPhoneMasked: customerPhone ? maskCustomerPhone(customerPhone) : null,
        },
      };
    });

    if (committed.ok && typeof (sql as { options?: unknown })?.options === 'object') {
      try {
        const { enqueueOrderLowStockAlerts } = await import(
          '@/lib/notifications/order-stock-alerts'
        );
        await enqueueOrderLowStockAlerts(committed.data.orderId, { sql });
      } catch {
        // Never fail a committed POS sale if notification queueing is unavailable.
      }
    }

    return committed;
  } catch (error) {
    if (error instanceof Error && error.message === 'POS_STOCK_CHANGED') {
      return { ok: false, reason: 'out-of-stock', error: 'Stock changed while the sale was being recorded. Try again.' };
    }
    console.warn('[store-admin/pos] the sale transaction failed');
    return { ok: false, reason: 'unavailable', error: 'The sale could not be recorded.' };
  }
}

/* ------------------------------------------------------------- void */

export type VoidResult =
  | { ok: true; txnid: string; orderId: string; receiptNo: string; reason: string }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'not-found'
        | 'invalid-input'
        | 'closed-shift'
        | 'not-pos'
        | 'forbidden';
      error: string;
    };

/**
 * Void a POS sale (owner only, shift still open): order CANCELLED, POS
 * payment CANCELLED, stock restocked through stock_movements, history and
 * audit rows. The receipt number is never reused — it stays on the order.
 */
export async function voidPosSale(input: {
  txnid: string;
  staffId: string;
  role: 'store_owner' | 'store_admin' | 'store_viewer';
  reason: string;
}): Promise<VoidResult> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Order records are not available.' };

  try {
    return await sql.begin(async (tx) => {
      await setTransactionTimeouts(tx);
      const orderRows = (await tx`
        select id, txnid, channel, status, fulfilment_status,
               pos_shift_id, pos_receipt_no, cancel_reason
        from orders
        where txnid = ${input.txnid.trim()}
        for update
      `) as Row[];
      const order = orderRows[0];
      if (!order) return { ok: false as const, reason: 'not-found' as const, error: 'Order not found.' };
      if (order.pos_shift_id === null) {
        return { ok: false as const, reason: 'closed-shift' as const, error: 'This sale has no shift recorded.' };
      }

      // Lock the shift row so a close racing this void serialises against it:
      // a sale can never be voided into a drawer that has already closed.
      const shiftRows = (await tx`
        select status from pos_shifts
        where id = ${number(order.pos_shift_id)}
        for update
      `) as Row[];
      const shiftStatus = text(shiftRows[0]?.status) === 'OPEN' ? 'OPEN' : 'CLOSED';

      const check = canVoidPosSale({
        role: input.role,
        channel: text(order.channel),
        shiftStatus,
        orderStatus: text(order.status),
        fulfilmentStatus: text(order.fulfilment_status),
        hasReason: Boolean(input.reason.trim()),
      });
      if (!check.ok) {
        const reason =
          text(order.channel) !== 'pos'
            ? ('not-pos' as const)
            : input.role !== 'store_owner'
              ? ('forbidden' as const)
              : shiftStatus !== 'OPEN'
                ? ('closed-shift' as const)
                : ('invalid-input' as const);
        return { ok: false as const, reason, error: check.error };
      }

      const orderId = text(order.id);
      const receiptNo = text(order.pos_receipt_no);

      const itemRows = (await tx`
        select product_id, variant_id,quantity, product_name from order_items
        where order_id = ${orderId}
      `) as Row[];

      await tx`
        update orders
        set status = 'CANCELLED',
            fulfilment_status = 'CANCELED',
            cancelled_at = now(),
            cancel_reason = ${input.reason},
            updated_at = now()
        where id = ${orderId}
      `;

      await tx`
        update order_payments
        set status = 'CANCELLED', updated_at = now()
        where order_id = ${orderId} and channel = 'pos'
      `;

      // Restock mirrors the sale through the ledger: only what this order
      // actually took is given back. Untracked products never moved on_hand,
      // so the helper writes their balancing movement without changing stock.
      await restoreSoldStock(
        tx,
        orderId,
        itemRows.map((item) => ({
          productId: text(item.product_id),
          variantId:nullableText(item.variant_id),
          quantity: integer(item.quantity),
        })),
        { createdBy: input.staffId },
      );

      await tx`
        insert into order_status_history (order_id, domain, actor, from_status, to_status)
        values (${orderId}, 'payment', 'store_admin', ${text(order.status)}, 'CANCELLED')
      `;

      await strictMetadataAudit(tx,{actorId:input.staffId,action:'pos.void',entity:'order',entityId:orderId,before:{status:order.status},after:{status:'CANCELLED'},reason:input.reason});
      return { ok: true as const, txnid: text(order.txnid), orderId, receiptNo, reason: input.reason };
    });
  } catch {
    console.warn('[store-admin/pos] the void transaction failed');
    return { ok: false, reason: 'unavailable', error: 'The sale could not be voided.' };
  }
}

/* --------------------------------------------------------- dashboard */

export type DashboardShiftLoad =
  | {
      ok: true;
      data: {
        openShiftId: number | null;
        openShiftCount: number;
        todayPosTotalPaise: number;
      };
    }
  | { ok: false; reason: 'unavailable' };

export async function getPosDashboard(): Promise<DashboardShiftLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const [openRows, totalRows] = await Promise.all([
      sql`
        select count(*)::int as open_count,
               min(id)::int as first_open_id
        from pos_shifts
        where status = 'OPEN'
      `,
      sql`
        select coalesce(sum(p.amount_paise), 0)::bigint as today_total
        from order_payments p
        join orders o on o.id = p.order_id
        where p.channel = 'pos'
          and p.status = 'PAID'
          and p.paid_at >= current_date
      `,
    ]);
    const openRow = (openRows as Row[])[0];
    const totalRow = (totalRows as Row[])[0];
    return {
      ok: true,
      data: {
        openShiftId: openRow ? number(openRow.first_open_id) || null : null,
        openShiftCount: openRow ? integer(openRow.open_count) : 0,
        todayPosTotalPaise: number(totalRow?.today_total),
      },
    };
  } catch {
    console.warn('[store-admin/pos] could not read the dashboard totals');
    return { ok: false, reason: 'unavailable' };
  }
}

/* ---------------------------------------------------------- receipt */

export interface ReceiptData {
  id: string;
  txnid: string;
  receiptNo: string;
  createdAt: string;
  lines: PosSaleLine[];
  subtotalPaise: number;
  totalPaise: number;
  method: PosPaymentMethod | null;
  providerRef: string | null;
  cashierName: string;
  customerPhoneMasked: string | null;
}

export type ReceiptLoad =
  | { ok: true; receipt: ReceiptData }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'not-pos' };

export async function getPosReceipt(txnid: string): Promise<ReceiptLoad> {
  const session = await getStoreSession();
  if (!session) return { ok: false, reason: 'not-found' };
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const orderRows = (await sql`
      select o.id, o.txnid, o.channel, o.pos_receipt_no, o.created_at,
             o.subtotal_paise, o.total_paise, o.payment_method,
             o.customer_phone, a.name as cashier_name
      from orders o
      join store_admins a on a.id = o.staff_id
      where o.txnid = ${txnid.trim()}
      limit 1
    `) as Row[];
    const order = orderRows[0];
    if (!order) return { ok: false, reason: 'not-found' };
    if (text(order.channel) !== 'pos') return { ok: false, reason: 'not-pos' };

    const itemRows = (await sql`
      select line_number, product_id, product_name, variant_id,variant_sku,variant_label,quantity,
             unit_price_paise, reference_price_paise,
             line_total_paise, currency
      from order_items
      where order_id = ${text(order.id)}
      order by line_number asc
    `) as Row[];

    const paymentRows = (await sql`
      select provider_ref from order_payments
      where order_id = ${text(order.id)} and channel = 'pos'
      order by id desc
      limit 1
    `) as Row[];

    const lines: PosSaleLine[] = itemRows.map((row) => ({
      lineNumber: integer(row.line_number),
      productId: text(row.product_id),
      productName: text(row.product_name),
      variantId:nullableText(row.variant_id),variantSku:nullableText(row.variant_sku),variantLabel:nullableText(row.variant_label),
      quantity: integer(row.quantity) || 1,
      unitPricePaise: integer(row.unit_price_paise),
      referencePricePaise: row.reference_price_paise === null || row.reference_price_paise === undefined
        ? null
        : integer(row.reference_price_paise),
      lineTotalPaise: integer(row.line_total_paise),
      currency: text(row.currency) || 'INR',
    }));

    return {
      ok: true,
      receipt: {
        id: text(order.id),
        txnid: text(order.txnid),
        receiptNo: text(order.pos_receipt_no),
        createdAt: iso(order.created_at),
        lines,
        subtotalPaise: integer(order.subtotal_paise),
        totalPaise: integer(order.total_paise),
        method: (['cash', 'upi', 'card_machine'] as const).includes(
          text(order.payment_method) as PosPaymentMethod,
        )
          ? (text(order.payment_method) as PosPaymentMethod)
          : null,
        providerRef: nullableText(paymentRows[0]?.provider_ref),
        cashierName: text(order.cashier_name),
        customerPhoneMasked: nullableText(order.customer_phone)
          ? maskCustomerPhone(text(order.customer_phone))
          : null,
      },
    };
  } catch {
    console.warn('[store-admin/pos] could not read the receipt');
    return { ok: false, reason: 'unavailable' };
  }
}

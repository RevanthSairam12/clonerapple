/** Bounded SELECT-only provenance report. Names/SKUs/counts only; no customer data. */
import postgres from 'postgres';
import { createJiti } from 'jiti';
import path from 'node:path';
const url = new URL(process.env.DATABASE_URL);
if (url.port === '6543') throw new Error('Use the explicit session connection for this read-only snapshot');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10,
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require', onnotice() {},
  connection: { default_transaction_read_only: 'on', statement_timeout: 30000, search_path: 'public' } });
try {
  const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('src') } });
  const registry = await jiti.import(path.resolve('src/lib/products/registry.ts'));
  const all = [...registry.CASE_PRODUCTS, ...registry.ALL_ACCESSORY_PRODUCTS];
  const ids = ['iphone18pro-max-clear-magsafe', 'cpc-gadzio-silicone-organizer', 'iphone17-silicone-black'];
  const result = await sql.begin('isolation level repeatable read read only', async tx => {
    const products = await tx`select id,price_paise,inventory_mode from products where id=any(${ids}::text[]) order by id`;
    const variants = await tx`
      select v.id,v.product_id,v.sku,v.option_name,v.option_value,v.option_hex,
        v.is_active,v.is_purchasable,v.retired_at,v.price_paise_override,
        s.id as stock_id,s.on_hand,s.reserved,(s.on_hand-s.reserved) as available,s.track_inventory,
        (select count(distinct oi.order_id)::int from order_items oi where oi.variant_id=v.id) as exact_order_count,
        (select count(*)::int from stock_movements sm where sm.product_id=v.product_id and sm.variant_id=v.id) as stock_movement_count,
        (select count(distinct oi.order_id)::int from order_items oi join orders o on o.id=oi.order_id
          where oi.product_id=v.product_id and oi.variant_id=v.id and o.reservation_state='ACTIVE' and o.reservation_expires_at>now()) as active_exact_order_reservations
      from product_variants v left join stock s on s.product_id=v.product_id and s.variant_id=v.id
      where v.product_id=any(${ids}::text[]) order by v.product_id,v.sort_order,v.id`;
    const [legacy] = await tx`select count(distinct order_id)::int as orders_without_variant_identity from order_items where product_id='iphone17-silicone-black' and variant_id is null`;
    const parentStock = await tx`select on_hand,reserved,(on_hand-reserved) as available,track_inventory from stock where product_id='iphone17-silicone-black' and variant_id is null`;
    const [invitations] = await tx`select count(*)::int as product_level_held_invitations from stock_reservations where product_id='iphone17-silicone-black' and status='HELD' and expires_at>now()`;
    return { products: products.map(row => ({ ...row,
      static_price_paise: Math.round(all.find(p => p.id===row.id).price*100),
      static_option_names: (all.find(p=>p.id===row.id).colors??[]).map(c=>c.name),
      database_option_names: variants.filter(v=>v.product_id===row.id && v.is_active).map(v=>v.option_value),
    })), variants: variants.filter(v=>v.product_id==='iphone17-silicone-black'), parentStock, ...legacy, ...invitations };
  });
  console.log(JSON.stringify({ hostname: url.hostname, schema: 'public', readonly: true, ...result }, null, 2));
} catch {
  console.error('Read-only option provenance failed; details withheld; no writes attempted.'); process.exitCode=1;
} finally { await sql.end({ timeout: 5 }); }

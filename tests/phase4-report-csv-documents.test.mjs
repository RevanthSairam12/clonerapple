import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
const jiti=createJiti(import.meta.url,{moduleCache:false,alias:{'@':path.join(root,'src')}});
const {parseInventoryVariants,parseCsv,toCsv,validateImportRows}=await jiti.import(path.join(root,'src/lib/store-admin/catalog-csv.ts'));
const variant={id:'v_blue',sku:'BLUE-1',deviceModelId:'iphone',combinationKey:'iphone-blue',optionName:'Colour',optionValue:'Blue',isPurchasable:true,isActive:true,pricePaise:null,salePricePaise:null,stock:{onHand:7,trackInventory:false,lowStockThreshold:2}};
const context={categories:[{id:'cat',slug:'cat',name:'Category'}],brands:[],conditions:[],existing:new Map([['case',{slug:'case'}]])};
const validate=(extra={})=>{const row={product_id:'case',name:'Case',category:'cat',price:'20',...extra};return validateImportRows(Object.keys(row),[Object.values(row)],context);};
test('variant manifest roundtrips stable identity, mapping and explicitly untracked stock',()=>{
  const row={product_id:'case',name:'Case',category:'cat',price:'20',inventory_variants:JSON.stringify([variant])};
  const parsed=parseCsv(toCsv(Object.keys(row),[Object.values(row)]));
  assert.equal(parsed.ok,true);
  const result=validateImportRows(parsed.header,parsed.rows,context);
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.rows[0].inventoryVariants,[variant]);
  assert.equal(result.rows[0].confirmTracking,false);
});
test('omitted/blank manifest preserves inventory and explicit [] does not silently drop identities',()=>{
  assert.equal(validate().rows[0].inventoryVariants,undefined);
  assert.equal(validate({inventory_variants:''}).rows[0].inventoryVariants,undefined);
  assert.deepEqual(validate({inventory_variants:'[]'}).rows[0].inventoryVariants,[]);
  assert.match(source('src/lib/store-admin/catalog-transfer.ts'),/inventoryVariants.length !== current.length/);
});
test('unknown activation columns and reserved imports fail instead of being ignored',()=>{
  for(const column of ['inventory_mode','variant_id','variant_sku','is_purchasable','track_inventory','reserved']) assert.equal(validate({[column]:'variant'}).errors[0].column,column);
  for(const bad of [{...variant,inventoryMode:'variant'},{...variant,stock:{...variant.stock,reserved:1}},{...variant,stock:{...variant.stock,onHand:-1}}]) assert.throws(()=>parseInventoryVariants(JSON.stringify([bad])));
});
test('duplicate identities, incomplete stock and new identity creation are rejected',()=>{
  assert.throws(()=>parseInventoryVariants(JSON.stringify([variant,variant])));
  assert.throws(()=>parseInventoryVariants(JSON.stringify([{...variant,stock:{onHand:3}}])));
  const row={name:'New Case',category:'cat',price:'20',inventory_variants:JSON.stringify([variant])};
  assert.equal(validateImportRows(Object.keys(row),[Object.values(row)],context).errors[0].column,'inventory_variants');
});
test('tracking confirmation is explicit and invalid text fails closed',()=>{
  assert.equal(validate({confirm_tracking:'true'}).rows[0].confirmTracking,true);
  assert.equal(validate({confirm_tracking:''}).rows[0].confirmTracking,false);
  assert.equal(validate({confirm_tracking:'maybe'}).errors[0].column,'confirm_tracking');
});
let queue=[],queries=[];
const sql=async(strings,...params)=>{queries.push(strings.join('?'));return queue.shift()??[];};
sql.unsafe=async(query)=>{queries.push(query);return queue.shift()??[];};
const reportJiti=createJiti(import.meta.url,{moduleCache:false,alias:{'@':path.join(root,'src')},virtualModules:{'@/lib/platform/db':{getSql:()=>sql},'./orders':{maskCustomerName:()=>'(masked)'},'./store-clock':{loadReportFilters:()=>{} }}});
const {getReport}=await reportJiti.import(path.join(root,'src/lib/store-admin/reports.ts'));
const {exportCatalogue,exportStockReport}=await reportJiti.import(path.join(root,'src/lib/store-admin/catalog-transfer.ts'));

test('actual catalogue exporter preserves explicitly untracked parent and variant identity manifest',async()=>{
  queue=[[{id:'case',slug:'case',name:'Case',category_name:'Category',price_paise:2000,
    on_hand:99,track_inventory:false,low_stock_threshold:2,is_active:false,
    inventory_variants:[variant],product_type_id:null,device_model_ids:[],attribute_values:{}}]];
  const result=await exportCatalogue({categoryId:null,status:'all',search:''});
  assert.equal(result.ok,true);
  const parsed=parseCsv(result.data.csv);assert.equal(parsed.ok,true);
  const validated=validateImportRows(parsed.header,parsed.rows,context);
  assert.deepEqual(validated.errors,[]);
  assert.equal(validated.rows[0].stock,null);
  assert.deepEqual(validated.rows[0].inventoryVariants,[variant]);
  assert.equal(validated.rows[0].confirmTracking,false);
});
test('stock CSV and report projection share exact inventory keys and retained bucket filter',async()=>{
 queue=[[{product_id:'case',slug:'case',name:'Case',stock_id:'stock-blue',variant_id:'v_blue',variant_sku:'BLUE-1',variant_label:'Blue',inventory_bucket:'variant',on_hand:3,reserved:1,track_inventory:true,low_stock_threshold:2}]];queries=[];
 const result=await exportStockReport('low');assert.equal(result.ok,true);
 assert.match(result.data.csv,/variant_id,variant_sku,inventory_bucket/);
 assert.match(result.data.csv,/v_blue,BLUE-1,variant,3,1,2,2,true,low/);
 assert.match(queries[0],/inventory_bucket <> 'retained_legacy'/);
 assert.match(queries[0],/s.variant_id is not distinct from k.variant_id/);
});
const filters={categoryId:null,brandId:null,rowLimit:100,timeZone:'Asia/Kolkata',fromIso:'2026-01-01',toIso:'2026-02-01'};
test('item sales and returns merge on product AND immutable variant, never siblings',async()=>{
 queue=[[
 {base_id:'case',product_id:'case',name:'Case',variant_id:'red',variant_sku:'OLD-RED',variant_label:'Red at sale',units:2,revenue:4000,orders:1,available:5,track_inventory:true},
 {base_id:'case',product_id:'case',name:'Case',variant_id:'blue',variant_sku:'OLD-BLUE',units:1,revenue:2000,orders:1,available:0,track_inventory:true},
 ],[{base_id:'case',product_id:'case',name:'Case',variant_id:'blue',variant_sku:'OLD-BLUE',returned:1},{base_id:'case',product_id:'case',name:'Case',variant_id:null,returned:3}],[{units:3,revenue:6000,orders:2,products:1}]];queries=[];
 const report=await getReport('items',filters);assert.equal(report.ok,true);
 assert.deepEqual(report.data.rows.map(r=>[r.variantId,r.returned]),[['red',0],['blue',1],[null,3]]);
 assert.equal(report.data.rows[0].variantLabel,'Red at sale');
 assert.equal(report.data.totals.returned,4);assert.equal(report.data.totals.revenue,6000);
 assert.ok(queries[0].includes('s.variant_id is not distinct from oi.variant_id'));
 assert.ok(queries[1].includes("group by split_part(oi.product_id, '::', 1), oi.variant_id"));
});
test('stock reports separate retained legacy and exclude it and untracked units from sellable totals',async()=>{
 queue=[[{product_id:'case',name:'Case',inventory_bucket:'retained_legacy',on_hand:10,reserved:0,threshold:20,track_inventory:true,price_paise:2000},
 {product_id:'case',name:'Case',variant_id:'red',variant_sku:'RED',variant_label:'Red',inventory_bucket:'variant',on_hand:2,reserved:1,threshold:1,track_inventory:true,price_paise:2000},
 {product_id:'case',name:'Case',variant_id:'blue',inventory_bucket:'variant',on_hand:99,track_inventory:false,price_paise:2000}]];
 const report=await getReport('stock',filters);assert.equal(report.ok,true);
 assert.equal(report.data.rows.length,3);assert.match(report.data.rows[0].product,/retained legacy/);
 assert.equal(report.data.totals.onHand,2);assert.equal(report.data.totals.reserved,1);assert.equal(report.data.totals.retailValue,4000);
 assert.deepEqual(report.data.columns.filter(c=>['onHand','reserved','available','threshold'].includes(c.key)).map(c=>c.label),['In stock','Held in checkouts','Available to buy','Warn me when below']);
});
test('stock reports retain untracked product balances without counting untracked variants or legacy parents',async()=>{
 queue=[[
 {product_id:'tracked',name:'Tracked product',inventory_bucket:'product',on_hand:13,reserved:2,track_inventory:true,cost_paise:1000,price_paise:2000},
 {product_id:'untracked',name:'Untracked product',inventory_bucket:'product',on_hand:7,reserved:1,track_inventory:false,cost_paise:500,price_paise:1500},
 {product_id:'case',name:'Case',inventory_bucket:'retained_legacy',on_hand:10,reserved:0,track_inventory:true,cost_paise:100,price_paise:2000},
 {product_id:'case',name:'Case',variant_id:'blue',inventory_bucket:'variant',on_hand:99,track_inventory:false,cost_paise:100,price_paise:2000},
 ]];
 const report=await getReport('stock',filters);assert.equal(report.ok,true);
 assert.equal(report.data.totals.onHand,20);assert.equal(report.data.totals.reserved,3);assert.equal(report.data.totals.available,17);
 assert.equal(report.data.totals.costValue,16500);assert.equal(report.data.totals.retailValue,36500);
 const product=report.data.rows.find(r=>r.productId==='untracked');
 assert.equal(product.inventoryStatus,'Not limited');assert.equal(product.onHand,7);assert.equal(product.retailValue,10500);
 assert.equal(report.data.rows.find(r=>r.inventoryBucket==='variant').onHand,null);
 assert.equal(report.data.rows.find(r=>r.inventoryBucket==='retained_legacy').onHand,10);
 assert.equal(report.data.stats.find(s=>s.label==='Products costed').value,2);
 assert.equal(report.data.stats.find(s=>s.label==='Low stock').value,0);
});

test('stock CSV keeps recorded untracked product balances but blanks untracked variant quantities',async()=>{
 queue=[[
 {product_id:'parent',name:'Parent',inventory_bucket:'product',on_hand:7,reserved:1,track_inventory:false},
 {product_id:'case',name:'Case',variant_id:'blue',inventory_bucket:'variant',on_hand:99,reserved:0,track_inventory:false},
 ]];
 const result=await exportStockReport('all');assert.equal(result.ok,true);
 // These simple fixture fields contain no commas/quotes. The catalogue import
 // parser deliberately requires category/price columns, so it is not a stock-CSV parser.
 const [header,...rows]=result.data.csv.replace(/^﻿/,'').trim().split(/\r?\n/).map(line=>line.split(','));
 const cells=rows.map(row=>Object.fromEntries(header.map((key,i)=>[key,row[i]])));
 assert.equal(cells[0].on_hand,'7');assert.equal(cells[0].reserved,'1');assert.equal(cells[0].available,'6');assert.equal(cells[0].track_inventory,'false');
 assert.equal(cells[1].on_hand,'');assert.equal(cells[1].reserved,'');assert.equal(cells[1].available,'');
});

test('low stock excludes retained parents and last movement uses exact-key ledger',async()=>{
 queue=[[{product_id:'case',name:'Case',inventory_bucket:'retained_legacy',on_hand:0,reserved:0,threshold:3,track_inventory:true},
 {product_id:'case',name:'Case',variant_id:'blue',variant_sku:'BLUE',inventory_bucket:'variant',on_hand:1,reserved:1,threshold:2,track_inventory:true}]];queries=[];
 const report=await getReport('low-stock',filters);assert.equal(report.ok,true);assert.equal(report.data.rows.length,1);assert.equal(report.data.rows[0].variantSku,'BLUE');
 assert.ok(queries[0].includes('m.variant_id is not distinct from i.variant_id'));
});
test('CSV absolute adjustment locks before snapshot and uses shared audited exact-key service',()=>{
 const s=source('src/lib/store-admin/catalog-transfer.ts');
 const updates=s.slice(s.indexOf('async function applyUpdates'));
 assert.ok(updates.indexOf('for update`')<updates.indexOf('const currentRows'));
 assert.match(updates,/for \(const key of stockKeys\).*variant_id is not distinct from/s);
 assert.match(updates,/adjustVariantInventoryUsing\(tx,change,staffId\)/);
 assert.doesNotMatch(updates,/update stock\s+set on_hand/);
 assert.match(s,/strictMetadataAudit\(tx,\{actorId:input.staffId,action:'catalog.import.apply'/);
 assert.match(s,/JSON.stringify\(identity\(saved\)\)!==JSON.stringify\(identity\(value\)\)/);
 assert.match(s,/CSV cannot create or delete variant stock rows/);
});
test('account and staff document reads preserve only stored variant snapshots, including JSON fallback',()=>{
  for(const p of ['src/lib/account/orders.ts','src/lib/store-admin/orders.ts']) {
    const s=source(p);
    assert.match(s,/variant_id, variant_sku, variant_label/);
    assert.match(s,/variantId:/);assert.match(s,/variantSku:/);assert.match(s,/variantLabel:/);
    assert.doesNotMatch(s,/join product_variants/);
  }
  const receipt=source('src/app/account/orders/[txnid]/receipt/page.tsx');
  assert.match(receipt,/variantId: item.variantId, variantSku: item.variantSku, variantLabel: item.variantLabel/);
  assert.match(source('src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/packing-slip/page.tsx'),/item.variantSku \|\| item.productId/);
  assert.match(source('src/app/(store-admin)/store-admin/(protected)/pos/receipt/[txnid]/page.tsx'),/line.variantLabel/);
});

test('seed cannot archive or overwrite durable or history-referenced commerce identities',()=>{
 const s=source('scripts/seed-store-catalog.mjs');const block=s.slice(s.indexOf('// Commerce identities'),s.indexOf('// product_attribute_values'));
 for(const token of ['not is_purchasable','product_variants.sku is null','device_model_id is null','combination_key is null','from stock s','from stock_movements m','from order_items i']) assert.ok(block.includes(token),token);
 assert.equal((block.match(/from order_items i/g)??[]).length,2);
});

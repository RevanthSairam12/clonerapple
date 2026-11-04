import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const jiti=createJiti(import.meta.url,{moduleCache:false,alias:{'@':path.join(root,'src')}});
const rules=jiti(path.join(root,'src/lib/store-admin/variant-inventory-rules.ts'));
const pos=jiti(path.join(root,'src/lib/store-admin/pos-rules.ts'));
const {adjustVariantInventoryUsing}=jiti(path.join(root,'src/lib/store-admin/variant-inventory.ts'));
const {createPosSaleUsing}=jiti(path.join(root,'src/lib/store-admin/pos.ts'));
const {validateVariantInput}=jiti(path.join(root,'src/lib/store-admin/catalog-crud-rules.ts'));

test('exact identities separate sibling variants; POS rejects duplicate keys and decorated aliases',()=>{
  assert.notEqual(rules.inventoryKey('p','a'),rules.inventoryKey('p','b'));
  assert.notEqual(rules.inventoryKey('p'),rules.inventoryKey('p','a'));
  assert.equal(pos.validatePosCart([{id:'p',variantId:'a',quantity:1},{id:'p',variantId:'b',quantity:1}]).ok,true);
  assert.equal(pos.validatePosCart([{id:'p',variantId:'a',quantity:1},{id:'p',variantId:'a',quantity:1}]).ok,false);
  assert.equal(pos.validatePosCart([{id:'p::colour',quantity:1}]).ok,false);
  assert.equal(pos.validatePosCart([{id:'p',variantId:42,quantity:1}]).ok,false);
});
test('absolute quantities and allocation rows are explicit, bounded and never invent a split',()=>{
  const base={productId:'p',variantId:'a',reason:'adjustment'};
  assert.throws(()=>rules.validateInventoryChange({...base,onHand:'10'}));
  assert.throws(()=>rules.validateInventoryChange({...base,onHand:10,delta:1}));
  assert.throws(()=>rules.validateInventoryChange({...base,trackInventory:'false'}));
  assert.throws(()=>rules.inventoryDelta(10,4,{onHand:3}));
  assert.equal(rules.inventoryDelta(10,4,{onHand:7}),-3);
  assert.deepEqual(rules.validateAllocation([]),[]);
  assert.throws(()=>rules.validateAllocation([{variantId:'a'}]));
  assert.throws(()=>rules.validateAllocation([{variantId:'a',quantity:5},{variantId:'a',quantity:5}]));
});
test('commerce combination requires SKU and stable explicit key',()=>{
  const base={optionName:'Colour / capacity',optionValue:'Black / 256 GB',isPurchasable:true};
  assert.equal(validateVariantInput(base).ok,false);
  assert.equal(validateVariantInput({...base,sku:'phone-black-256',combinationKey:'black-256',deviceModelId:'phone-18'}).ok,true);
  assert.equal(validateVariantInput({...base,sku:'sku',combinationKey:'c',isPurchasable:'false'}).ok,false);
});
function fakeTx({auditFails=false}={}){
  const events=[];
  const tx=async(strings,...values)=>{
    const query=strings.join('?').replace(/\s+/g,' ').trim();events.push({query,values});
    if(query.startsWith('select id,inventory_mode'))return[{id:'p',inventory_mode:'variant'}];
    if(query.startsWith('select v.id'))return[{id:'a'}];
    if(query.startsWith('select * from stock'))return[{id:'s',on_hand:10,reserved:2,track_inventory:true,low_stock_threshold:1}];
    if(query.startsWith('insert into store_admin_audit')&&auditFails)throw new Error('audit unavailable');
    return [];
  };
  tx.json=v=>v;return {tx,events};
}
test('absolute adjustment locks exact row before deriving delta; writes ledger and audit in caller transaction',async()=>{
  const {tx,events}=fakeTx();
  const after=await adjustVariantInventoryUsing(tx,{productId:'p',variantId:'a',onHand:7,reason:'adjustment'},'staff');
  assert.equal(after.onHand,7);
  const lock=events.findIndex(e=>e.query.startsWith('select * from stock'));
  const write=events.findIndex(e=>e.query.startsWith('update stock'));
  assert.ok(lock<write);
  assert.match(events[lock].query,/variant_id is not distinct from.*for update/);
  assert.deepEqual(events[lock].values,['p','a']);
  const movement=events.find(e=>e.query.startsWith('insert into stock_movements'));
  assert.equal(movement.values[2],-3);
  assert.ok(events.some(e=>e.query.startsWith('insert into store_admin_audit')));
});
test('audit failure propagates so the enclosing transaction must roll back',async()=>{
  const {tx}=fakeTx({auditFails:true});
  await assert.rejects(adjustVariantInventoryUsing(tx,{productId:'p',variantId:'a',delta:1,reason:'receipt'},'staff'),/rolled back.*audit/);
});
test('POS fails closed for missing variant stock and never mutates orders',async()=>{
  const events=[];
  const tx=async(strings,...values)=>{
    const query=strings.join('?').replace(/\s+/g,' ').trim();events.push(query);
    if(query.startsWith('select id from pos_shifts'))return[{id:1}];
    if(query.startsWith('select id, name, price_paise'))return[{id:'p',name:'Phone',price_paise:100,cost_paise:null,inventory_mode:'variant'}];
    if(query.startsWith('select v.*'))return[{id:'a',sku:'A',option_name:'Spec',option_value:'Black',price_paise_override:null}];
    return [];
  };
  const sql={begin:async fn=>fn(tx)};
  const result=await createPosSaleUsing(sql,{lines:[{id:'p',variantId:'a',quantity:1,unitPricePaise:100}],method:'cash',providerRef:null,customerPhone:null,staffId:'staff',role:'store_admin'});
  assert.equal(result.ok,false);assert.equal(result.reason,'out-of-stock');
  assert.ok(!events.some(q=>q.startsWith('insert into orders')));
});
test('source contracts pin guarded route, activation holds, paired transfers, exact POS snapshots and available guard',async()=>{
  const read=rel=>readFile(path.join(root,rel),'utf8');
  const api=await read('src/app/api/store-admin/catalog/products/[id]/variant-inventory/route.ts');
  assert.match(api,/assertSameOrigin\(request\)/);assert.match(api,/requireStoreRole\('store_admin'\)/);
  const service=await read('src/lib/store-admin/variant-inventory.ts');
  assert.match(service,/reservation_state='ACTIVE'/);assert.match(service,/outstanding\.length/);
  assert.match(service,/Allocate to/);assert.match(service,/Allocate from legacy/);assert.match(service,/strictMetadataAudit/);
  const source=await read('src/lib/store-admin/pos.ts');
  assert.match(source,/variant_id is not distinct from/);assert.match(source,/on_hand-reserved >=/);
  assert.match(source,/variant_id,variant_sku,variant_label/);assert.match(source,/variantId:nullableText\(item.variant_id\)/);
  assert.match(source,/pg_advisory_xact_lock_shared/);assert.match(source,/action:'pos.sale'/);assert.match(source,/action:'pos.void'/);
});

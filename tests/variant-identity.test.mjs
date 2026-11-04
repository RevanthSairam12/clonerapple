// Strictly offline: transaction doubles; no application pool or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createJiti} from 'jiti';
import {readFile} from 'node:fs/promises';
const jiti=createJiti(import.meta.url,{moduleCache:false,alias:{'@':path.resolve('src')},virtualModules:{'@/lib/platform/db':{getSql(){throw new Error('Unexpected application pool');}}}});
const {resolvedVariantIdentity,saveVariantIdentityUsing}=await jiti.import('../src/lib/store-admin/variant-identity.ts');
const {validateVariantInput}=await jiti.import('../src/lib/store-admin/catalog-crud-rules.ts');
const {parseProductDraft}=await jiti.import('../src/lib/store-admin/product-draft-rules.ts');
const {saveProductDraftUsing}=await jiti.import('../src/lib/store-admin/product-draft.ts');
const {productOptionCombinations}=await jiti.import('../src/lib/store-admin/product-option-combinations.ts');
const base={sku:'NEW',optionName:'Colour',optionValue:'Black',optionHex:null,priceOverridePaise:null,isActive:true,isPurchasable:true,combinationKey:'new-key',deviceModelId:'model',optionIdentity:'black',sortOrder:0};
const old={id:'old',product_id:'p',sku:'OLD',option_name:'Colour',option_value:'Black',option_hex:null,is_purchasable:true,device_model_id:'model',combination_key:'old-key',option_identity:'black',sort_order:0};
function connection({source=old,auditFails=false}={}){
 const events=[];const tx=async(strings,...values)=>{const query=strings.join('?').replace(/\s+/g,' ').trim();events.push({query,values});
 if(query.startsWith('select * from product_variants'))return source?[source]:[];
 if(query.startsWith('select 1 from product_device_models'))return[{ok:1}];
 if(query.startsWith('insert into product_variants'))return[{id:values[0]}];
 if(query.startsWith('insert into store_admin_audit')&&auditFails)throw new Error('audit unavailable');
 return [];
 };tx.json=v=>v;return {tx,events};
}
test('semantic input is explicit and normalized, never inferred from combined display label',()=>{
 const checked=validateVariantInput({...base,optionIdentity:'  Dark   Blue  '});assert.equal(checked.ok,true);assert.equal(checked.value.optionIdentity,'dark blue');
 assert.equal(validateVariantInput({...base,optionIdentity:{value:'black'}}).ok,false);
 assert.equal(validateVariantInput({...base,id:'old',replacesVariantId:'old'}).ok,false);
 assert.equal(validateVariantInput({...base,combinationKey:undefined,replacesVariantId:'old'}).ok,true);
});
test('generator identities survive display model/brand rename and keep distinct stable models',()=>{
 const refs={types:[],brands:[{id:'brand',isActive:true}],models:[{id:'one',brandId:'brand',name:'Same',isActive:true},{id:'two',brandId:'brand',name:'Same',isActive:true}]};
 const before=productOptionCombinations('Colour',' Black ',true,['one','two'],refs);
 const after=productOptionCombinations('Colour','Black',true,['one','two'],{...refs,models:refs.models.map(m=>({...m,name:'Renamed'}))});
 assert.deepEqual(before.map(r=>[r.deviceModelId,r.optionIdentity]),after.map(r=>[r.deviceModelId,r.optionIdentity]));
 assert.notEqual(before[0].deviceModelId,before[1].deviceModelId);assert.equal(before[0].optionIdentity,'black');
});
test('saved commerce identity and any saved SKU immutable; inactivity is reversible, retirement is not',()=>{
 const input={...base,id:'old',sku:'OLD',combinationKey:'old-key'};
 assert.equal(resolvedVariantIdentity({...input,isActive:false},old).semantic,'black');
 assert.equal(resolvedVariantIdentity(input,old).purchasable,true);
 for(const patch of [{sku:'CHANGED'},{optionIdentity:'blue'},{deviceModelId:'other'},{combinationKey:'other'},{optionValue:'Blue'},{isPurchasable:false}])assert.throws(()=>resolvedVariantIdentity({...input,...patch},old),/immutable/);
 assert.throws(()=>resolvedVariantIdentity(input,{...old,retired_at:'2026-11-03'}),/cannot be reactivated/);
 assert.throws(()=>resolvedVariantIdentity({...input,sku:null},{...old,is_purchasable:false}),/SKUs are immutable/);
 // Unknown saved legacy semantics remain null, not guessed from labels.
 assert.equal(resolvedVariantIdentity({...input,optionIdentity:undefined},{...old,option_identity:null}).semantic,null);
});
test('new commerce rejects missing semantic identity before any writes',async()=>{
 const {tx,events}=connection({source:null});await assert.rejects(saveVariantIdentityUsing(tx,'p',{...base,optionIdentity:null},'staff'),/explicit option identity/);
 assert.ok(!events.some(e=>/^(insert|update)/.test(e.query)));
});
test('same-label replacement retires owned source and creates fresh SKU/key/ID and zero tracked stock only',async()=>{
 const {tx,events}=connection();const result=await saveVariantIdentityUsing(tx,'p',{...base,replacesVariantId:'old'},'staff');
 assert.notEqual(result.id,'old');assert.equal(result.retired,true);
 const retired=events.findIndex(e=>e.query.startsWith('update product_variants set is_active=false,retired_at'));
 const inserted=events.findIndex(e=>e.query.startsWith('insert into product_variants'));assert.ok(retired>=0&&retired<inserted);
 const values=events[inserted].values;assert.equal(values[2],'NEW');assert.notEqual(values[8],'old-key');
 const stock=events.find(e=>e.query.startsWith('insert into stock('));assert.match(stock.query,/,0,0,true,0,/);assert.equal(stock.values[2],result.id);
 assert.ok(!events.some(e=>/^(update stock|insert into stock_movements|insert into price_history|update orders)/.test(e.query)));
});
test('inactive replacement still receives independent zero tracked stock; source ownership/retirement/audit fail closed',async()=>{
 const {tx,events}=connection();await saveVariantIdentityUsing(tx,'p',{...base,replacesVariantId:'old',isActive:false},'staff');assert.ok(events.some(e=>e.query.startsWith('insert into stock(')));
 await assert.rejects(saveVariantIdentityUsing(connection({source:null}).tx,'p',{...base,replacesVariantId:'other'},'staff'),/does not belong/);
 await assert.rejects(saveVariantIdentityUsing(connection({source:{...old,retired_at:'now'}}).tx,'p',{...base,replacesVariantId:'old'},'staff'),/already been retired/);
 await assert.rejects(saveVariantIdentityUsing(connection({auditFails:true}).tx,'p',{...base,replacesVariantId:'old'},'staff'),/rolled back.*audit/);
});
const product={id:'p',name:'Case',slug:'case',categoryId:'cases',pricePaise:10000};
test('replacement parser requires inactive staged source and explicit receipt; order is canonicalized by service',()=>{
 const replacement={...base,replacesVariantId:'old'};
 assert.doesNotThrow(()=>parseProductDraft({id:'p',product,options:[replacement,{...base,id:'old',sku:'OLD',isActive:false}]}));
 assert.throws(()=>parseProductDraft({id:'p',product,options:[replacement,{...base,id:'old',sku:'OLD'}]}),/staged inactive/);
 assert.throws(()=>parseProductDraft({id:'p',product,options:[replacement,replacement]}),/only be replaced once/);
 assert.throws(()=>parseProductDraft({id:'p',product,options:[{...replacement,stock:{onHand:4,trackInventory:true,reason:'adjustment',confirmTracking:true}}]}),/confirmed receipt/);
});
test('draft malformed tokens reject before SQL, stale token before every editorial write',async()=>{
 for(const token of [null,'0',-1,1.2,2147483648])assert.throws(()=>parseProductDraft({id:'p',product,expectedRevision:token}),/expectedRevision/);
 const events=[];const tx=async(strings)=>{const query=strings.join('?');events.push(query);return query.includes('select * from products')?[{id:'p',catalog_revision:8}]:[];};
 await assert.rejects(saveProductDraftUsing({begin:fn=>fn(tx)},parseProductDraft({id:'p',product,expectedRevision:7}),'staff'),e=>e.status===409&&e.code==='CATALOG_REVISION_CONFLICT');
 assert.ok(events.every(q=>/^select/.test(q)));assert.equal(events.length,2);
});
test('migration preserves permanent commerce keys and enforces non-retired semantic/live labels',async()=>{
 const sql=await readFile('migrations/0055_variant_identity_retirement.sql','utf8');
 assert.match(sql,/where retired_at is null and is_purchasable and option_identity is not null/);
 assert.match(sql,/drop index if exists idx_product_variants_option/);
 assert.doesNotMatch(sql,/drop index[^;]*(sku|commerce_combination)/);
 assert.match(sql,/old\.retired_at is not null/);assert.match(sql,/new\.option_identity is distinct from old\.option_identity/);
});

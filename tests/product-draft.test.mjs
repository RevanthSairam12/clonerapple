import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createJiti} from 'jiti';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const jiti=createJiti(import.meta.url,{moduleCache:false,alias:{'@':path.join(root,'src')}});
const rules=jiti(path.join(root,'src/lib/store-admin/product-draft-rules.ts'));
const service=jiti(path.join(root,'src/lib/store-admin/product-draft.ts'));

test('create identity is stable independently of slug and edit identity is explicit',()=>{
  const product={id:'stable-product',name:'Case',slug:'changed-case',categoryId:'cases',pricePaise:10000};
  const created=rules.parseProductDraft({product,gallery:[{url:'/case.jpg',role:'gallery',isActive:false}]});
  assert.equal(created.id,undefined);
  assert.equal(created.product.value.id,'stable-product');
  assert.equal(created.gallery[0].isActive,false);
  assert.equal(rules.parseProductDraft({id:'stable-product',product}).id,'stable-product');
  assert.throws(()=>rules.parseProductDraft({product:{...product,id:'../bad'}}),/identity/);
});

function pricingTx({auditFails=false}={}){
  const events=[];
  const tx=async(strings,...values)=>{
    const query=strings.join('?').replace(/\s+/g,' ').trim();events.push({query,values});
    if(query.startsWith('select price_paise,cost_paise'))return[{price_paise:10000,cost_paise:null}];
    if(query.startsWith('select * from product_variants'))return[{price_paise_override:12000,sale_price_paise:11000}];
    if(query.startsWith('insert into store_admin_audit')&&auditFails)throw new Error('audit unavailable');
    return [];
  };
  tx.json=value=>value;
  return {tx,events};
}
test('price-only helper locks exact identities, records clearing history and audits in caller transaction',async()=>{
  const {tx,events}=pricingTx();
  await service.updateVariantPricingUsing(tx,'product-a','variant-a',{pricePaise:null,salePricePaise:null},'staff');
  assert.match(events[0].query,/for update$/);
  assert.match(events[1].query,/product_id=.*for update$/);
  assert.deepEqual(events[1].values,['variant-a','product-a']);
  const history=events.filter(e=>e.query.startsWith('insert into price_history'));
  assert.equal(history.length,2);
  assert.ok(history.some(e=>e.values.includes('sale_cleared')));
  assert.ok(events.some(e=>e.query.startsWith('insert into store_admin_audit')));
  assert.ok(!events.some(e=>/description_sections|short_description/.test(e.query)));
});
test('price audit failure propagates to caller-owned rollback and invalid sale writes nothing',async()=>{
  await assert.rejects(service.updateVariantPricingUsing(pricingTx({auditFails:true}).tx,'p','v',{salePricePaise:10000},'staff'),/rolled back.*audit/);
  const {tx,events}=pricingTx();
  await assert.rejects(service.updateVariantPricingUsing(tx,'p','v',{pricePaise:10000},'staff'));
  assert.ok(!events.some(e=>/^(update|insert)/.test(e.query)));
});

function draftTx({variant={},parent={},auditFails=false}={}){
  const events=[];
  const tx=async(strings,...values)=>{
    const query=strings.join('?').replace(/\s+/g,' ').trim();events.push({query,values});
    if(query.startsWith('select * from products'))return[{id:'product-a',price_paise:10000,sale_price_paise:null,category_id:'cases',product_type_id:null,catalog_revision:0,...parent}];
    if(query.startsWith('select id from categories'))return[{id:'cases'}];
    if(query.startsWith('select id from product_types'))return[{id:'new-type'}];
    if(query.startsWith('select * from product_types'))return[{id:'new-type',category_id:'cases',name:'New type',is_active:true}];
    if(query.startsWith('select catalog_revision from products'))return[{catalog_revision:3}];
    if(query.startsWith('select category_id,product_type_id,is_active'))return[{category_id:'cases',product_type_id:null,is_active:false}];
    if(query.startsWith('select * from product_variants'))return[{id:'variant-a',sku:'SKU',option_name:'Colour',option_value:'Black',is_purchasable:true,device_model_id:null,combination_key:'black',price_paise_override:null,sale_price_paise:null,...variant}];
    if(query.startsWith('select price_paise,cost_paise'))return[{price_paise:10000,cost_paise:null}];
    if(query.startsWith('insert into store_admin_audit')&&auditFails)throw new Error('audit unavailable');
    return [];
  };
  tx.json=value=>value;
  const sql={begin:async fn=>{events.push({query:'BEGIN'});try{const result=await fn(tx);events.push({query:'COMMIT'});return result;}catch(error){events.push({query:'ROLLBACK'});throw error;}}};
  return {sql,events};
}
const editProduct={id:'product-a',name:'Case',slug:'case',categoryId:'cases',pricePaise:10000};
const savedOption={id:'variant-a',sku:'SKU',optionName:'Colour',optionValue:'Black',combinationKey:'black',isPurchasable:true,isActive:true};
test('draft saves option price changes with paired regular and sale history',async()=>{
  const {sql,events}=draftTx();
  const draft=rules.parseProductDraft({id:'product-a',product:editProduct,options:[{...savedOption,pricePaise:12000,salePricePaise:11000}]});
  await service.saveProductDraftUsing(sql,draft,'staff');
  assert.equal(events.at(-1).query,'COMMIT');
  const history=events.filter(e=>e.query.startsWith('insert into price_history')&&e.values.includes('variant-a'));
  assert.equal(history.length,2,'one row for the regular price, one for the sale');
  assert.ok(history.some(e=>e.values.includes(12000)));
  assert.ok(history.some(e=>e.values.includes(11000)));
  const groups=history.map(e=>e.values.at(-1));
  assert.equal(new Set(groups).size,1,'both rows share one change group');
  assert.ok(events.some(e=>e.query.startsWith('insert into store_admin_audit')&&e.values.includes('catalog.variant.price')));
});
test('a large option price change asks for confirmation and never silently applies',async()=>{
  const refused=draftTx();
  const draft=rules.parseProductDraft({id:'product-a',product:editProduct,options:[{...savedOption,pricePaise:100}]});
  await assert.rejects(service.saveProductDraftUsing(refused.sql,draft,'staff'),/confirm this price change/i);
  assert.equal(refused.events.at(-1).query,'ROLLBACK');
  const confirmed=draftTx();
  const confirmedDraft=rules.parseProductDraft({id:'product-a',product:editProduct,confirmLargePriceChanges:true,options:[{...savedOption,pricePaise:100}]});
  await service.saveProductDraftUsing(confirmed.sql,confirmedDraft,'staff');
  assert.equal(confirmed.events.at(-1).query,'COMMIT');
});
test('draft rejects commerce identity changes inside enclosing rollback',async()=>{
  const {sql,events}=draftTx();
  const draft=rules.parseProductDraft({id:'product-a',product:editProduct,options:[{...savedOption,sku:'CHANGED'}]});
  await assert.rejects(service.saveProductDraftUsing(sql,draft,'staff'),/SKUs are immutable/);
  assert.equal(events.at(-1).query,'ROLLBACK');
  assert.ok(!events.some(e=>e.query==='COMMIT'));
  assert.ok(!events.some(e=>e.query.startsWith('update product_variants set sku')));
});
test('late summary audit failure aborts staged product and gallery changes',async()=>{
  const {sql,events}=draftTx({auditFails:true});
  const draft=rules.parseProductDraft({id:'product-a',product:editProduct,gallery:[{url:'/case.jpg',role:'primary'}]});
  await assert.rejects(service.saveProductDraftUsing(sql,draft,'staff'),/rolled back.*audit/);
  assert.ok(events.some(e=>e.query.startsWith('insert into product_images')));
  assert.equal(events.at(-1).query,'ROLLBACK');
});

test('draft validates product, description, gallery roles, and identity boundaries',()=>{
  const base={product:{id:'product-a',name:'Case',slug:'case',categoryId:'cases',pricePaise:10000,description:'Plain text',isActive:false,trackInventory:true,initialOnHand:0}};
  const parsed=rules.parseProductDraft({...base,id:'product-a',shortDescription:'Short',descriptionSections:[],gallery:[{url:'/case.jpg',role:'primary',alt:'Case'}]});
  assert.equal(parsed.gallery[0].role,'primary');
  assert.deepEqual(parsed.descriptionSections,[]);
  assert.throws(()=>rules.parseProductDraft({...base,id:'other'}),/identity/);
  assert.throws(()=>rules.parseProductDraft({...base,gallery:[{url:'/a.jpg',role:'primary'},{url:'/b.jpg',role:'primary'}]}),/Only one primary/);
  assert.throws(()=>rules.parseProductDraft({...base,descriptionSections:[{id:'bad',type:'text',title:'bad',blocks:'not array'}]}));
});
test('draft validates option price amounts, client identity, stock and activation allocations',()=>{
  const product={id:'product-a',name:'Phone',slug:'phone',categoryId:'phones',pricePaise:10000,description:'',isActive:false,trackInventory:true,initialOnHand:0};
  const parsed=rules.parseProductDraft({product,options:[{clientKey:'temp-one',sku:'PHONE-BLK',optionName:'Colour',optionValue:'Black',combinationKey:'black',isPurchasable:true,isActive:true,pricePaise:12000,salePricePaise:11000}],activateVariantInventory:{confirm:true,reason:'Initial setup',allocations:[{variantId:'temp-one',quantity:0}]}});
  assert.equal(parsed.options[0].pricePaise,12000);
  assert.equal(parsed.activateVariantInventory.allocations[0].variantId,'temp-one');
  assert.throws(()=>rules.parseProductDraft({product,options:[{clientKey:'temp-one',sku:'A',optionName:'Colour',optionValue:'Black',combinationKey:'black',isPurchasable:true,isActive:true,pricePaise:'12000'}]}),/paise/);
  assert.throws(()=>rules.parseProductDraft({product,activateVariantInventory:{confirm:true,reason:'x',allocations:[{variantId:'bad',quantity:-1}]}}));
});
test('duplicate new labels reject before SQL, while saved retirement is checked against persisted state',()=>{
  assert.throws(()=>rules.parseProductDraft({product:editProduct,options:[{...savedOption,id:undefined},{...savedOption,id:undefined,clientKey:'replacement',sku:'REPLACEMENT',combinationKey:'new',isActive:false}]}),/unique option type and value/);
  assert.doesNotThrow(()=>rules.parseProductDraft({product:editProduct,options:[savedOption,{...savedOption,id:'retired-original',isActive:false}]}));
});

test('draft pairs new category/type in same UPDATE and returns authoritative edit token',async()=>{
  const {sql,events}=draftTx({parent:{product_type_id:'old-type',category_id:'old-category'}});
  const draft=rules.parseProductDraft({id:'product-a',expectedRevision:0,product:editProduct,metadata:{productTypeId:'new-type'}});
  const result=await service.saveProductDraftUsing(sql,draft,'staff');
  const write=events.find(e=>e.query.startsWith('update products set category_id='));
  assert.match(write.query,/category_id=\?,product_type_id=\?/);assert.deepEqual(write.values.slice(0,2),['cases','new-type']);
  assert.equal(result.product.catalogRevision,3);assert.equal(events.at(-1).query,'COMMIT');
});

test('published draft revalidates retained model-backed options even when options omitted',async()=>{
  const {events,sql}=draftTx();
  const wrapped={begin:fn=>sql.begin(tx=>fn(Object.assign(async(strings,...values)=>{
    const query=strings.join('?').replace(/\s+/g,' ').trim();
    if(query.startsWith('select v.id from product_variants'))return[{id:'invalid-model-option'}];
    return tx(strings,...values);
  },{json:tx.json})))};
  await assert.rejects(service.saveProductDraftUsing(wrapped,rules.parseProductDraft({id:'product-a',product:{...editProduct,isActive:true}}),'staff'),/invalid SKU, combination key or compatible device/);
  assert.equal(events.at(-1).query,'ROLLBACK');
});

test('draft source keeps writes inside one caller-owned transaction and hardens route',async()=>{
  const {readFile}=await import('node:fs/promises');
  const service=await readFile(path.join(root,'src/lib/store-admin/product-draft.ts'),'utf8');
  const route=await readFile(path.join(root,'src/app/api/store-admin/catalog/products/draft/route.ts'),'utf8');
  assert.match(service,/saveProductDraftInTransaction\(tx,draft/);
  assert.match(service,/strictMetadataAudit/);
  assert.match(service,/price_history/);
  assert.match(service,/activateVariantInventoryUsing/);
  assert.match(route,/assertSameOrigin\(request\)/);
  assert.match(route,/requireStoreRole\('store_admin'\)/);
});

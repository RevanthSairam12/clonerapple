import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createJiti} from 'jiti';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const jiti=createJiti(import.meta.url,{moduleCache:false,alias:{'@':path.join(root,'src')}});
const rules=jiti(path.join(root,'src/lib/store-admin/options-table-rules.ts'));
const crud=jiti(path.join(root,'src/lib/store-admin/catalog-crud-rules.ts'));

const models=[
  {id:'m-15',name:'iPhone 15',brandName:'Apple'},
  {id:'m-14',name:'iPhone 14',brandName:'Apple'},
];
const colours=[
  {id:'c-black',name:'Black',hex:'#111111'},
  {id:'c-blue',name:'Blue',hex:'#0000ff'},
];

test('sell-by modes generate the rows the person asked for',()=>{
  assert.equal(rules.generateOptionRows({sellBy:'single'}).length,0);
  assert.deepEqual(rules.generateOptionRows({sellBy:'colour',colours}).map(r=>r.optionValue),['Black','Blue']);
  assert.deepEqual(rules.generateOptionRows({sellBy:'model',models}).map(r=>r.optionValue),['iPhone 15','iPhone 14']);
  const pairs=rules.generateOptionRows({sellBy:'model_colour',models,colours});
  assert.equal(pairs.length,4);
  assert.equal(pairs[1].deviceModelId,'m-15');
  assert.equal(pairs[1].colourId,'c-blue');
  assert.equal(pairs[1].optionIdentity,'blue','identity stays the colour, never the joined label');
  assert.deepEqual(rules.generateOptionRows({sellBy:'other',otherName:'Wattage',otherValues:['20W','30W','20w']}).map(r=>r.optionValue),['20W','30W']);
});

test('inactive shared rows are never proposed and the generation cap is explicit',()=>{
  assert.equal(rules.generateOptionRows({sellBy:'colour',colours:[...colours,{id:'c-old',name:'Old',hex:'#222222',isActive:false}]}).length,2);
  const tooMany=Array.from({length:61},(_,index)=>({id:`m${index}`,name:`Model ${index}`}));
  assert.throws(()=>rules.generateOptionRows({sellBy:'model',models:tooMany}),/at most 60/);
});

test('only missing rows are proposed, including inactive saved rows',()=>{
  const generated=rules.generateOptionRows({sellBy:'model_colour',models,colours});
  const existing=[{deviceModelId:'m-15',colourId:'c-black',optionName:'Model / Colour',optionValue:'iPhone 15 / Black',optionIdentity:'black'}];
  const missing=rules.missingOptionRows(existing,generated);
  assert.equal(missing.length,3);
  assert.ok(!missing.some(row=>row.deviceModelId==='m-15'&&row.colourId==='c-black'));
});

test('a large change is a confirmation, not a block',()=>{
  assert.match(rules.largePriceChange({oldPricePaise:10000,newPricePaise:4000,costPaise:null}),/drops by more than 50%/);
  assert.match(rules.largePriceChange({oldPricePaise:10000,newPricePaise:25000,costPaise:null}),/rises by more than 100%/);
  assert.equal(rules.largePriceChange({oldPricePaise:10000,newPricePaise:9000,costPaise:9000}),null,'equal to cost is not below cost');
  assert.match(rules.largePriceChange({oldPricePaise:10000,newPricePaise:9000,costPaise:9500}),/below cost/);
  assert.equal(rules.largePriceChange({oldPricePaise:10000,newPricePaise:6000,costPaise:null}),null,'a 40% drop is ordinary');
  assert.equal(rules.largePriceChange({oldPricePaise:null,newPricePaise:100,costPaise:null}),null);
});

test('a blank option price uses the base price and SKUs stay inside the limit',()=>{
  assert.equal(rules.effectiveOptionPaise(null,10000),10000);
  assert.equal(rules.effectiveOptionPaise(12000,10000),12000);
  const sku=rules.suggestedSku('{product}-{model}-{colour}',{product:'Clear Case',model:'iPhone 15',colour:'Ocean Blue'});
  assert.equal(sku,'CLEAR-CASE-IPHONE-15-OCEAN-BLUE');
  assert.ok(rules.suggestedSku('{value}'.repeat(20),{value:'abcdefghij'}).length<=64);
});

test('row warnings are plain words and never block',()=>{
  const seen=new Set();
  const warnings=rules.optionRowWarnings({sku:'',pricePaise:null,basePricePaise:10000,stockOnHand:0,trackInventory:true,isPurchasable:true},seen);
  assert.ok(warnings.some(w=>/No SKU/.test(w)));
  assert.ok(warnings.some(w=>/No price/.test(w)&&/₹100\.00/.test(w)));
  assert.ok(warnings.some(w=>/No stock/.test(w)));
  const duplicate=rules.optionRowWarnings({sku:'ABC',pricePaise:100,basePricePaise:100,stockOnHand:5,trackInventory:true,isPurchasable:true},new Set(['ABC']));
  assert.ok(duplicate.some(w=>/used by another row/.test(w)));
});

test('pasted rows parse only when every line is valid',()=>{
  const pasted=rules.parseOptionTablePaste('price\tsale\tstock\n120\t100\t5\n180\t\t3',2);
  assert.deepEqual(pasted.errors,[]);
  assert.equal(pasted.rows.length,2);
  assert.deepEqual(pasted.rows[0],{line:2,rowIndex:0,pricePaise:12000,salePricePaise:10000,stock:5});
  assert.deepEqual(pasted.rows[1],{line:3,rowIndex:1,pricePaise:18000,salePricePaise:undefined,stock:3});
  const blank=rules.parseOptionTablePaste('100,,',1);
  assert.deepEqual(blank.rows,[{line:1,rowIndex:0,pricePaise:10000,salePricePaise:undefined,stock:undefined}]);
});

test('pasted rows report clear line errors and never apply a partial table',()=>{
  const tooMany=rules.parseOptionTablePaste('100\t120\t1',1);
  assert.match(tooMany.errors[0],/Line 1: sale price must be below/);
  assert.equal(tooMany.rows.length,0);
  const overflow=rules.parseOptionTablePaste('100\t\t1\n200\t\t2',1);
  assert.match(overflow.errors[0],/only 1 active sellable row/);
  const badStock=rules.parseOptionTablePaste('100\t\tmany',1);
  assert.match(badStock.errors[0],/whole number/);
  const empty=rules.parseOptionTablePaste('','1');
  assert.match(empty.errors[0],/at least one row/);
  const tooWide=rules.parseOptionTablePaste('1\t2\t3\t4',4);
  assert.match(tooWide.errors[0],/at most three columns/);
});

test('arrow, Enter and Left/Right move between grid cells while Tab stays native',()=>{
  assert.deepEqual(rules.nextTableCell(0,0,2,3,'ArrowRight'),{row:0,column:1});
  assert.deepEqual(rules.nextTableCell(0,2,2,3,'ArrowRight'),{row:1,column:0});
  assert.deepEqual(rules.nextTableCell(1,0,2,3,'ArrowLeft'),{row:0,column:2});
  assert.deepEqual(rules.nextTableCell(0,1,2,3,'ArrowDown'),{row:1,column:1});
  assert.deepEqual(rules.nextTableCell(1,1,2,3,'Enter'),null,'Enter at the last row stays put');
  assert.equal(rules.nextTableCell(0,1,2,3,'Tab'),null,'Tab uses the browser order');
  assert.deepEqual(rules.nextTableCell(1,2,2,3,'ArrowRight'),null);
});

test('variant price input treats blank, null and a number differently',()=>{
  const base={sku:'SKU-1',optionName:'Colour',optionValue:'Black'};
  assert.equal(crud.validateVariantInput(base).value.priceOverridePaise,undefined,'omitted means unchanged');
  assert.equal(crud.validateVariantInput({...base,priceOverridePaise:null}).value.priceOverridePaise,null,'null clears');
  assert.equal(crud.validateVariantInput({...base,priceOverridePaise:12000}).value.priceOverridePaise,12000);
  assert.equal(crud.validateVariantInput({...base,salePricePaise:9000}).value.salePricePaise,9000);
  assert.equal(crud.validateVariantInput({...base,salePricePaise:''}).value.salePricePaise,null);
  assert.equal(crud.validateVariantInput({...base,confirmLargeChange:true}).value.confirmLargeChange,true);
  assert.match(crud.validateVariantInput({...base,confirmLargeChange:'yes'}).error,/true or false/);
  assert.match(crud.validateVariantInput({...base,priceOverridePaise:0}).error,/Option price/);
});

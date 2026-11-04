import test from 'node:test';
import assert from 'node:assert/strict';
import { planStockClaim, stockKey } from '../src/lib/checkout/stock-rules.ts';
const line=(variantId,quantity=1)=>({productId:'case',variantId,quantity});
const row=(variant_id,on_hand)=>({product_id:'case',variant_id,on_hand,reserved:0,track_inventory:true});
test('variant claim uses exact identity, not sibling or parent units',()=>{
  assert.equal(planStockClaim([line('pro')],[row(null,50),row('max',20),row('pro',0)]).ok,false);
  assert.equal(planStockClaim([line('max')],[row('max',1),row('pro',0)]).ok,true);
});
test('same variant lines aggregate, different variants do not',()=>{
  assert.equal(planStockClaim([line('pro'),line('pro')],[row('pro',1)]).ok,false);
  const result=planStockClaim([line('pro'),line('max')],[row('pro',1),row('max',1)]);
  assert.equal(result.ok,true); assert.equal(result.claims.length,2);
});
test('missing explicit variant row fails closed, legacy missing stays untracked',()=>{
  assert.equal(planStockClaim([line('missing')],[]).ok,false);
  assert.equal(planStockClaim([{productId:'legacy',quantity:1}],[]).ok,true);
});
test('explicitly untracked configured variants remain untracked',()=>{
  const result=planStockClaim([line('pro',50)],[{...row('pro',0),track_inventory:false}]);
  assert.equal(result.ok,true); assert.deepEqual(result.claims,[]);
});
test('reserved counters constrain exact variant',()=>{
  assert.equal(planStockClaim([line('pro',2)],[{...row('pro',3),reserved:2}]).ok,false);
});
test('stock keys cannot collide via separator characters',()=>{
  assert.notEqual(stockKey({productId:'a::b',variantId:'c'}),stockKey({productId:'a',variantId:'b::c'}));
  assert.equal(stockKey({productId:'a'}),stockKey({productId:'a',variantId:null}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':path.resolve('src')}});
const {parseMetadataInput,publicationProblems,validateScopedValue}=await jiti.import('../src/lib/catalog/product-metadata-rules.ts');
const field=(overrides={})=>({attributeId:'material',key:'material',label:'Material',dataType:'enum',options:['Silicone','Clear'],isRequired:true,sortOrder:0,showInSpecs:true,showInFilters:true,showInSearch:true,...overrides});
const type=(overrides={})=>({id:'case',categoryId:'cases',name:'Case',isActive:true,requiresCompatibility:true,sortOrder:0,attributes:[field()],...overrides});
test('metadata omission preserves; explicit empty is intentional and never all models',()=>{
 assert.deepEqual(parseMetadataInput({}),{});
 assert.deepEqual(parseMetadataInput({productTypeId:null,deviceModelIds:[],attributeValues:{}}),{productTypeId:null,deviceModelIds:[],attributeValues:{}});
});
test('metadata rejects malformed, repeated and oversized model selections',()=>{
 for(const ids of ['all',['a','a'],[''],['bad/id'],Array.from({length:501},(_,i)=>`m${i}`)])assert.throws(()=>parseMetadataInput({deviceModelIds:ids}));
 for(const value of [[],null,'string',{x:{}},{x:NaN}])assert.throws(()=>parseMetadataInput({attributeValues:value}));
});
test('typed values and explicit archive null round trip without coercing false or zero',()=>{
 assert.deepEqual(parseMetadataInput({attributeValues:{bool:false,num:0,text:'hello',empty:null}}).attributeValues,{bool:false,num:0,text:'hello',empty:null});
 validateScopedValue(field({dataType:'boolean'}),false);validateScopedValue(field({dataType:'number'}),0);validateScopedValue(field(),null);
});
test('enum membership is validated, not only string shape',()=>{
 validateScopedValue(field(),'Silicone');assert.throws(()=>validateScopedValue(field(),'Unrelated'));
});
test('only the active matching category/type can publish',()=>{
 for(const t of [undefined,type({isActive:false}),type({categoryId:'chargers'})])assert.ok(publicationProblems(t,'cases',{material:'Silicone'},['phone']).length);
 assert.deepEqual(publicationProblems(type(),'cases',{material:'Silicone'},['phone']),[]);
});
test('explicit null permits untyped publication while missing, stale and invalid nonnull IDs remain blocked',()=>{
 assert.deepEqual(publicationProblems(undefined,'cases',{},[],null),[]);
 assert.ok(publicationProblems(undefined,'cases',{},[]).length);
 for(const [t,id] of [[undefined,'missing'],[type({isActive:false}),'case'],[type({categoryId:'chargers'}),'case'],[type(),'other']]) assert.ok(publicationProblems(t,'cases',{},[],id).length);
 assert.equal(publicationProblems(type(),'cases',{},[],'case').length,2);
 assert.deepEqual(publicationProblems(type(),'cases',{material:'Silicone'},['phone'],'case'),[]);
});
test('publication revalidates retained values against the current attribute mapping',()=>{
 assert.ok(publicationProblems(type(),'cases',{material:'Retired option'},['phone']).some(problem=>problem.includes('defined option')));
});
test('required compatibility and attributes independently block publication',()=>{
 assert.equal(publicationProblems(type(),'cases',{},[]).length,2);
 assert.equal(publicationProblems(type(),'cases',{material:'Silicone'},[]).length,1);
 assert.deepEqual(publicationProblems(type({requiresCompatibility:false}),'cases',{material:'Silicone'},[]),[]);
});
test('required boolean false and number zero count as populated',()=>{
 const t=type({requiresCompatibility:false,attributes:[field({attributeId:'flag',dataType:'boolean'}),field({attributeId:'watts',dataType:'number'})]});
 assert.deepEqual(publicationProblems(t,'cases',{flag:false,watts:0},[]),[]);
 assert.equal(publicationProblems(t,'cases',{flag:null,watts:0},[]).length,1);
});

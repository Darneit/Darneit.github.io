const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('admin/admin.js','utf8');
function setup(fetchImpl) {
  const nodes = new Map(), storage = new Map(); let exported;
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, {hidden:true,value:'',disabled:false,checked:false,innerHTML:'',className:'',
      classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},getAttribute(){return '';},
      appendChild(){},click(){},remove(){},closest(){return this;},insertAdjacentElement(_,el){nodes.set('#'+el.id,el);},
      querySelector(selector){return node(key+selector);},showModal(){},close(){}});
    return nodes.get(key);
  }
  const context = {console,URLSearchParams,Map,Promise,Intl,Date,JSON,Number,String,Array,Object,RegExp,Error,Blob,
    fetch:fetchImpl, navigator:{},setTimeout:()=>1,clearTimeout(){},setInterval:()=>2,clearInterval(){},alert(){},confirm:()=>false,
    document:{hidden:false,querySelector:node,querySelectorAll:()=>[],addEventListener(){},createElement:()=>node('new'+nodes.size),body:node('body')},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    URL:{createObjectURL:b=>{exported=b;return 'blob:test';},revokeObjectURL(){}},
    window:{addEventListener(){},supabase:null},
  };
  context.window.URL=context.URL;
  vm.createContext(context);
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `globalThis.apiTest={readAllRows,refreshSession,api,saveSession,pageRows,downloadCsv,contactSections,mergeRealtimeRow,startLiveSync,setSession:s=>saveSession(s),getSession:()=>session};})();`),context);
  context.apiTest.setSession({access_token:'old',refresh_token:'refresh',user:{id:'user'}});
  return {api:context.apiTest,node,context,blob:()=>exported};
}
function response(body,status=200,range) {
  return {ok:status>=200&&status<300,status,headers:{get:k=>k==='content-range'?range:null},json:async()=>body,text:async()=>JSON.stringify(body)};
}
test('all records survive API caps below the requested page size',async()=>{
 const rows=Array.from({length:1234},(_,i)=>({id:String(i),created_at:'2026-10-01'})); let requests=0;
 const {api}=setup(async url=>{
   requests++;const p=new URL(url).searchParams;assert.equal(p.get('order'),'created_at.desc,id.asc');
   const start=Number(p.get('offset'));const batch=rows.slice(start,start+77);
   return response(batch,200,`${start}-${start+batch.length-1}/${rows.length}`);
 });
 const result=await api.readAllRows('enquiries','select=*&order=created_at.desc');
 assert.equal(result.length,1234);assert.equal(result.at(-1).id,'1233');assert.equal(requests,17);
});
test('concurrent list reads share one request and failures reject partial results',async()=>{
 let count=0;const {api}=setup(async()=>{count++;return response([{id:'a'}],200,'0-0/1');});
 await Promise.all([api.readAllRows('clients','select=*'),api.readAllRows('clients','select=*')]);assert.equal(count,1);
 const failing=setup(async url=>new URL(url).searchParams.get('offset')==='0'?response([{id:'a'}],200,'0-0/2'):response({message:'offline'},500));
 await assert.rejects(failing.api.readAllRows('clients','select=*'),/offline/);
});
test('simultaneous expired requests refresh once and retry with the new token',async()=>{
 let refreshes=0;const {api}=setup(async(url,opts)=>{
  if(url.includes('refresh_token')){refreshes++;await new Promise(resolve=>setImmediate(resolve));return response({access_token:'new',refresh_token:'rotated',user:{id:'user'}});}
  return opts.headers.Authorization==='Bearer new'?response([]):response({},401);
 });
 const results=await Promise.all(Array.from({length:12},()=>api.api('/rest/v1/enquiries')));
 assert.equal(refreshes,1);assert.ok(results.every(r=>r.ok));assert.equal(api.getSession().access_token,'new');
});
test('logout while a refresh is in flight cannot restore the session',async()=>{
 let release;const {api}=setup(()=>new Promise(resolve=>{release=resolve;}));
 const pending=api.refreshSession();await new Promise(resolve=>setImmediate(resolve));
 api.saveSession(null);release(response({access_token:'new',refresh_token:'rotated',user:{id:'user'}}));
 assert.equal(await pending,false);assert.equal(api.getSession(),null);
});
test('CSV exports neutralize formulas and preserve quoted multiline text',async()=>{
 const h=setup(async()=>response([]));h.api.downloadCsv('test.csv',['Value'],[['=1+1'],['  @SUM(A1)'],['+971500000000'],['-2+3'],['\t=1'],['He said "hello"\nnext']]);
 const csv=await h.blob().text();
 for(const value of ["'=1+1","'  @SUM(A1)","'+971500000000","'-2+3","'\t=1"])assert.ok(csv.includes(value));
 assert.ok(csv.includes('He said ""hello""\nnext'));
});
test('visible pages contain 50 rows while the source remains complete',()=>{
 const {api,node}=setup();const rows=Array.from({length:123},(_,i)=>({id:i}));let page;
 function render(){page=api.pageRows(rows,'enquiry',render);}
 render();assert.equal(page.length,50);node('#enquiryPages').querySelector('[data-next]').onclick();
 assert.equal(page[0].id,50);node('#enquiryPages').querySelector('[data-next]').onclick();assert.equal(page.length,23);assert.equal(rows.length,123);
});
test('contact PDF sections include saved manpower requirements',()=>{
 const {api}=setup();const text=JSON.stringify(api.contactSections([{name:'Test',workers:24,duration:'6 months'}]));
 assert.ok(text.includes('Workers Required: 24'));assert.ok(text.includes('Contract Duration: 6 months'));
});

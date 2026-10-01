const {test}=require('node:test');
const assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto}=require('node:crypto');
const vm=require('node:vm'),fs=require('node:fs');
const source=stripTypeScriptTypes(fs.readFileSync('backend/submit-contact/index.ts','utf8').replace(/^import .*;\n/,''));
function setup(){let handler, calls=[];
 const ctx={Response,Request,TextEncoder,crypto:webcrypto,console,
  Deno:{serve:fn=>handler=fn,env:{get:key=>({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only'})[key]}},
  fetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return new Response(JSON.stringify('test-id'),{status:201});}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {calls,send:body=>handler(new Request('https://example.invalid',{method:'POST',headers:{origin:'https://darneit.github.io','Content-Type':'application/json'},body:JSON.stringify(body)}))};
}
test('valid optional requirements reach the service-only RPC',async()=>{
 const h=setup();const r=await h.send({company:'Example',name:'Test User',phone:'971500000000',email:'test@example.invalid',trade:'MEP works',workers:'24',duration:'6 months'});
 assert.equal(r.status,201);assert.equal(h.calls.length,1);assert.ok(h.calls[0].url.endsWith('/rpc/submit_contact_with_requirements'));
 assert.equal(h.calls[0].body.p_workers,24);assert.equal(h.calls[0].body.p_duration,'6 months');
});
test('invalid worker counts and durations never reach the database',async()=>{
 for(const workers of [0,-1,1.5,100001,'abc',true,[],{}]){const h=setup();assert.equal((await h.send({workers})).status,400);assert.equal(h.calls.length,0);}
 for(const duration of ['x'.repeat(161),42,'\u0000']){const h=setup();assert.equal((await h.send({duration})).status,400);assert.equal(h.calls.length,0);}
});
test('older forms can still omit both new fields',async()=>{
 const h=setup();assert.equal((await h.send({company:'Example',name:'Test User',phone:'971500000000',email:'test@example.invalid',trade:'MEP works'})).status,201);
 assert.equal(h.calls[0].body.p_workers,null);assert.equal(h.calls[0].body.p_duration,'');
});

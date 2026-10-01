(() => {
'use strict';
const SUPABASE_URL='https://sqeyjhedqufykqduvtcb.supabase.co';
const KEY='sb_publishable_goNXOTguYIcivBwulGSf_g_KhY2iRYK';
const sb=window.supabase.createClient(SUPABASE_URL,KEY);
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Intl.DateTimeFormat('en-AE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(d)):'—';
const loginView=$('#loginView'), adminView=$('#adminView'), loginForm=$('#loginForm'), loginStatus=$('#loginStatus');
const dialog=$('#detailDialog'), dialogContent=$('#dialogContent');

async function checkAdmin(session){
  if(!session?.user) return false;
  const {data,error}=await sb.from('admin_users').select('role').eq('user_id',session.user.id).maybeSingle();
  return !error && data?.role==='admin';
}
async function showSession(session){
  const ok=await checkAdmin(session);
  if(!ok){
    loginView.hidden=false; adminView.hidden=true;
    if(session) loginStatus.textContent='This account is not approved as a PRTC administrator.';
    return;
  }
  loginView.hidden=true; adminView.hidden=false;
  $('#adminEmail').textContent=session.user.email||'Admin';
  await loadDashboard();
}
loginForm.addEventListener('submit',async e=>{
  e.preventDefault(); loginStatus.textContent='Signing in…'; loginStatus.classList.remove('is-error');
  const {data,error}=await sb.auth.signInWithPassword({email:$('#loginEmail').value.trim(),password:$('#loginPassword').value});
  if(error){loginStatus.textContent=error.message;loginStatus.classList.add('is-error');return}
  await showSession(data.session);
});
$('#logoutBtn').addEventListener('click',async()=>{await sb.auth.signOut();location.reload()});
sb.auth.onAuthStateChange((_e,session)=>{if(!session){loginView.hidden=false;adminView.hidden=true}});
sb.auth.getSession().then(({data})=>showSession(data.session));

const titles={dashboard:'Dashboard',enquiries:'Enquiries',applications:'Applications',clients:'Clients'};
document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',async()=>{
  const view=btn.dataset.view;
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('is-active',x===btn));
  document.querySelectorAll('.admin-view').forEach(x=>x.classList.toggle('is-active',x.dataset.panel===view));
  $('#viewTitle').textContent=titles[view];
  $('.sidebar').classList.remove('is-open');
  if(view==='dashboard') await loadDashboard();
  if(view==='enquiries') await loadEnquiries();
  if(view==='applications') await loadApplications();
  if(view==='clients') await loadClients();
}));
$('#mobileNavBtn').addEventListener('click',()=>$('.sidebar').classList.toggle('is-open'));
document.querySelectorAll('[data-refresh]').forEach(b=>b.addEventListener('click',async()=>{
 const v=b.dataset.refresh;
 if(v==='dashboard') await loadDashboard();
 if(v==='enquiries') await loadEnquiries();
 if(v==='applications') await loadApplications();
 if(v==='clients') await loadClients();
}));

async function count(table, status){
 let q=sb.from(table).select('id',{count:'exact',head:true});
 if(status) q=q.eq('status',status);
 const {count,error}=await q; if(error) throw error; return count||0;
}
async function loadDashboard(){
 try{
   const [newE,totalE,newA,totalA,activeC]=await Promise.all([
    count('enquiries','New'),count('enquiries'),count('applications','New'),count('applications'),sb.from('clients').select('id',{count:'exact',head:true}).eq('enabled',true).then(r=>{if(r.error)throw r.error;return r.count||0})
   ]);
   $('#dashboardStats').innerHTML=[
    ['New enquiries',newE],['Total enquiries',totalE],['New applications',newA],['Total applications',totalA],['Active clients',activeC]
   ].map(([l,v])=>`<div class="stat-card"><span>${esc(l)}</span><strong>${v}</strong></div>`).join('');
   const [{data:e},{data:a}]=await Promise.all([
     sb.from('enquiries').select('id,name,company,status,created_at').order('created_at',{ascending:false}).limit(5),
     sb.from('applications').select('id,name,trade,status,created_at').order('created_at',{ascending:false}).limit(5)
   ]);
   const items=[
    ...(e||[]).map(x=>({...x,type:'Enquiry',label:x.company||x.name})),
    ...(a||[]).map(x=>({...x,type:'Application',label:x.trade||x.name}))
   ].sort((x,y)=>new Date(y.created_at)-new Date(x.created_at)).slice(0,8);
   $('#recentActivity').innerHTML=items.length?items.map(x=>`<div class="activity-item"><div><strong>${esc(x.name)}</strong><span>${esc(x.type)} · ${esc(x.label)}</span></div><div><strong>${esc(x.status)}</strong><span>${fmt(x.created_at)}</span></div></div>`).join(''):'<div class="empty">No submissions yet.</div>';
 }catch(e){$('#recentActivity').innerHTML=`<div class="empty">${esc(e.message)}</div>`}
}
async function loadEnquiries(){
 const {data,error}=await sb.from('enquiries').select('*').order('created_at',{ascending:false});
 if(error){$('#enquiryRows').innerHTML=`<tr><td colspan="7">${esc(error.message)}</td></tr>`;return}
 $('#enquiryRows').innerHTML=(data||[]).map(x=>`<tr>
 <td>${fmt(x.created_at)}</td><td><strong>${esc(x.name)}</strong></td><td>${esc(x.company||'—')}</td>
 <td>${esc(x.phone)}<br><span class="muted">${esc(x.email)}</span></td><td>${esc(x.trade||'—')}</td>
 <td><select data-enquiry-status="${x.id}">${['New','Contacted','Closed'].map(s=>`<option ${x.status===s?'selected':''}>${s}</option>`).join('')}</select></td>
 <td><button class="link-btn" data-enquiry-view="${x.id}">View</button></td></tr>`).join('')||'<tr><td colspan="7">No enquiries yet.</td></tr>';
 document.querySelectorAll('[data-enquiry-status]').forEach(el=>el.addEventListener('change',()=>updateStatus('enquiries',el.dataset.enquiryStatus,el.value)));
 document.querySelectorAll('[data-enquiry-view]').forEach(el=>el.addEventListener('click',()=>showDetail((data||[]).find(x=>x.id===el.dataset.enquiryView),'Enquiry')));
}
async function loadApplications(){
 const {data,error}=await sb.from('applications').select('*').order('created_at',{ascending:false});
 if(error){$('#applicationRows').innerHTML=`<tr><td colspan="7">${esc(error.message)}</td></tr>`;return}
 $('#applicationRows').innerHTML=(data||[]).map(x=>`<tr>
 <td>${fmt(x.created_at)}</td><td><strong>${esc(x.name)}</strong></td><td>${esc(x.trade)}</td>
 <td>${esc(x.phone)}<br><span class="muted">${esc(x.email)}</span></td>
 <td><select data-app-status="${x.id}">${['New','Reviewed','Shortlisted','Rejected'].map(s=>`<option ${x.status===s?'selected':''}>${s}</option>`).join('')}</select></td>
 <td><button class="link-btn" data-cv="${x.id}">Download</button></td>
 <td><button class="link-btn" data-app-view="${x.id}">View</button></td></tr>`).join('')||'<tr><td colspan="7">No applications yet.</td></tr>';
 document.querySelectorAll('[data-app-status]').forEach(el=>el.addEventListener('change',()=>updateStatus('applications',el.dataset.appStatus,el.value)));
 document.querySelectorAll('[data-app-view]').forEach(el=>el.addEventListener('click',()=>showDetail((data||[]).find(x=>x.id===el.dataset.appView),'Application')));
 document.querySelectorAll('[data-cv]').forEach(el=>el.addEventListener('click',()=>downloadCv((data||[]).find(x=>x.id===el.dataset.cv)));
}
async function updateStatus(table,id,status){
 const {error}=await sb.from(table).update({status}).eq('id',id);
 if(error) alert(error.message);
}
function showDetail(x,type){
 if(!x)return;
 const skip=new Set(['id','cv_path','cv_mime_type','cv_size_bytes']);
 const rows=Object.entries(x).filter(([k])=>!skip.has(k)).map(([k,v])=>`<dt>${esc(k.replaceAll('_',' '))}</dt><dd>${k.includes('created_at')||k.includes('updated_at')?fmt(v):esc(v??'—')}</dd>`).join('');
 dialogContent.innerHTML=`<p class="kicker">${esc(type)}</p><h2>${esc(x.name)}</h2><dl class="detail-grid">${rows}</dl>`;
 dialog.showModal();
}
$('#dialogClose').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
async function downloadCv(app){
 if(!app?.cv_path)return;
 const {data,error}=await sb.storage.from('cv-private').download(app.cv_path);
 if(error){alert(error.message);return}
 const url=window.URL.createObjectURL(data), a=document.createElement('a');a.href=url;a.download=app.cv_original_name||'CV';a.click();setTimeout(()=>window.URL.revokeObjectURL(url),1000);
}
let clients=[];
async function loadClients(){
 const {data,error}=await sb.from('clients').select('*').order('display_order',{ascending:true}).order('name',{ascending:true});
 if(error){$('#clientRows').innerHTML=`<div class="empty">${esc(error.message)}</div>`;return}
 clients=data||[];
 $('#clientRows').innerHTML=clients.map(x=>`<div class="client-item">
 <img src="${esc(x.logo_path)}" alt=""><div class="client-meta"><strong>${esc(x.name)}</strong><span>Order ${x.display_order} · ${x.enabled?'Enabled':'Hidden'}</span></div>
 <div class="client-actions"><button class="secondary" data-edit-client="${x.id}">Edit</button><button class="link-btn danger" data-delete-client="${x.id}">Delete</button></div></div>`).join('')||'<div class="empty">No clients.</div>';
 document.querySelectorAll('[data-edit-client]').forEach(b=>b.addEventListener('click',()=>editClient(b.dataset.editClient)));
 document.querySelectorAll('[data-delete-client]').forEach(b=>b.addEventListener('click',()=>deleteClient(b.dataset.deleteClient)));
}
function editClient(id){
 const x=clients.find(c=>c.id===id);if(!x)return;
 $('#clientId').value=x.id;$('#clientName').value=x.name;$('#clientOrder').value=x.display_order;$('#clientEnabled').checked=x.enabled;
 $('#clientFormTitle').textContent='Edit client';$('#clientCancel').hidden=false;$('#clientLogo').required=false;
}
function resetClientForm(){
 $('#clientForm').reset();$('#clientId').value='';$('#clientOrder').value=0;$('#clientEnabled').checked=true;$('#clientFormTitle').textContent='Add client';$('#clientCancel').hidden=true;$('#clientStatus').textContent='';
}
$('#clientCancel').addEventListener('click',resetClientForm);
$('#clientForm').addEventListener('submit',async e=>{
 e.preventDefault();const status=$('#clientStatus');status.textContent='Saving…';status.classList.remove('is-error');
 try{
   const id=$('#clientId').value;let logoPath=id?clients.find(c=>c.id===id)?.logo_path:'';
   const file=$('#clientLogo').files?.[0];
   if(!id&&!file)throw new Error('Please choose a logo.');
   if(file){
     if(file.size>5*1024*1024)throw new Error('Logo must be 5 MB or smaller.');
     const ext=(file.name.split('.').pop()||'png').toLowerCase();
     const path=`${crypto.randomUUID()}.${ext}`;
     const {error:uerr}=await sb.storage.from('client-logos').upload(path,file,{contentType:file.type,upsert:false});if(uerr)throw uerr;
     logoPath=sb.storage.from('client-logos').getPublicUrl(path).data.publicUrl;
   }
   const payload={name:$('#clientName').value.trim(),display_order:Number($('#clientOrder').value)||0,enabled:$('#clientEnabled').checked,logo_path:logoPath};
   const q=id?sb.from('clients').update(payload).eq('id',id):sb.from('clients').insert(payload);
   const {error}=await q;if(error)throw error;
   status.textContent='Saved.';resetClientForm();await loadClients();
 }catch(err){status.textContent=err.message;status.classList.add('is-error')}
});
async function deleteClient(id){
 const x=clients.find(c=>c.id===id);if(!x||!confirm(`Delete ${x.name}?`))return;
 const {error}=await sb.from('clients').delete().eq('id',id);if(error){alert(error.message);return}await loadClients();
}
})();
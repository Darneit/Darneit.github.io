(() => {
'use strict';

const SUPABASE_URL = 'https://sqeyjhedqufykqduvtcb.supabase.co';
const API_KEY = 'sb_publishable_goNXOTguYIcivBwulGSf_g_KhY2iRYK';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = d => d ? new Intl.DateTimeFormat('en-AE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(d)) : '—';

const loginView = $('#loginView');
const adminView = $('#adminView');
const loginForm = $('#loginForm');
const loginStatus = $('#loginStatus');
const dialog = $('#detailDialog');
const dialogContent = $('#dialogContent');

let session = null;
let clients = [];

function saveSession(data) {
  session = data;
  if (data) localStorage.setItem('prtc_admin_session', JSON.stringify(data));
  else localStorage.removeItem('prtc_admin_session');
}
function loadStoredSession() {
  try { return JSON.parse(localStorage.getItem('prtc_admin_session') || 'null'); }
  catch { return null; }
}
function authHeaders(extra={}) {
  return {
    apikey: API_KEY,
    ...(session?.access_token ? {Authorization: 'Bearer ' + session.access_token} : {}),
    ...extra
  };
}
async function refreshSession() {
  if (!session?.refresh_token) return false;
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
    method:'POST',
    headers:{apikey:API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({refresh_token:session.refresh_token})
  });
  if (!res.ok) { saveSession(null); return false; }
  saveSession(await res.json());
  return true;
}
async function api(path, options={}, retry=true) {
  const res = await fetch(SUPABASE_URL + path, {
    ...options,
    headers: authHeaders(options.headers || {})
  });
  if (res.status === 401 && retry && await refreshSession()) return api(path, options, false);
  return res;
}
async function rest(table, query='', options={}) {
  const headers = {'Content-Type':'application/json','Prefer':'return=representation',...(options.headers||{})};
  const res = await api('/rest/v1/' + table + (query ? '?' + query : ''), {...options, headers});
  if (!res.ok) {
    let msg = 'Request failed.';
    try { const j = await res.json(); msg = j.message || j.error || msg; } catch {}
    throw new Error(msg);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
async function isAdmin() {
  if (!session?.user?.id) return false;
  const rows = await rest('admin_users', 'select=role&user_id=eq.' + encodeURIComponent(session.user.id), {method:'GET'});
  return Array.isArray(rows) && rows.some(x => x.role === 'admin');
}
async function showSession() {
  if (!session) {
    loginView.hidden = false;
    adminView.hidden = true;
    return;
  }
  try {
    if (!(await isAdmin())) {
      loginView.hidden = false;
      adminView.hidden = true;
      loginStatus.textContent = 'This account is not approved as a PRTC administrator.';
      loginStatus.classList.add('is-error');
      return;
    }
    loginView.hidden = true;
    adminView.hidden = false;
    $('#adminEmail').textContent = session.user.email || 'Admin';
    await loadDashboard();
  } catch (e) {
    loginView.hidden = false;
    adminView.hidden = true;
    loginStatus.textContent = e.message || 'Could not verify administrator access.';
    loginStatus.classList.add('is-error');
  }
}

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginStatus.textContent = 'Signing in…';
  loginStatus.classList.remove('is-error');
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method:'POST',
      headers:{apikey:API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        email:$('#loginEmail').value.trim(),
        password:$('#loginPassword').value
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || data.message || data.error_description || 'Sign in failed.');
    saveSession(data);
    await showSession();
  } catch (e2) {
    loginStatus.textContent = e2.message || 'Sign in failed.';
    loginStatus.classList.add('is-error');
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try {
    if (session?.access_token) await api('/auth/v1/logout', {method:'POST'});
  } catch {}
  saveSession(null);
  location.reload();
});

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

async function fetchCount(table, status) {
  let q='select=id';
  if(status) q += '&status=eq.' + encodeURIComponent(status);
  const res=await api('/rest/v1/' + table + '?' + q,{method:'HEAD',headers:{Prefer:'count=exact'}});
  if(!res.ok) throw new Error('Could not load dashboard totals.');
  const range=res.headers.get('content-range') || '0/0';
  return Number(range.split('/')[1]) || 0;
}
async function loadDashboard(){
  try{
    const [newE,totalE,newA,totalA,activeC]=await Promise.all([
      fetchCount('enquiries','New'),
      fetchCount('enquiries'),
      fetchCount('applications','New'),
      fetchCount('applications'),
      (async()=>{
        const res=await api('/rest/v1/clients?select=id&enabled=eq.true',{method:'HEAD',headers:{Prefer:'count=exact'}});
        if(!res.ok) throw new Error('Could not load client count.');
        return Number((res.headers.get('content-range')||'0/0').split('/')[1])||0;
      })()
    ]);
    $('#dashboardStats').innerHTML=[
      ['New enquiries',newE],['Total enquiries',totalE],['New applications',newA],['Total applications',totalA],['Active clients',activeC]
    ].map(([l,v])=>'<div class="stat-card"><span>'+esc(l)+'</span><strong>'+v+'</strong></div>').join('');

    const [e,a]=await Promise.all([
      rest('enquiries','select=id,name,company,status,created_at&order=created_at.desc&limit=5',{method:'GET'}),
      rest('applications','select=id,name,trade,status,created_at&order=created_at.desc&limit=5',{method:'GET'})
    ]);
    const items=[
      ...(e||[]).map(x=>({...x,type:'Enquiry',label:x.company||x.name})),
      ...(a||[]).map(x=>({...x,type:'Application',label:x.trade||x.name}))
    ].sort((x,y)=>new Date(y.created_at)-new Date(x.created_at)).slice(0,8);
    $('#recentActivity').innerHTML=items.length?items.map(x=>'<div class="activity-item"><div><strong>'+esc(x.name)+'</strong><span>'+esc(x.type)+' · '+esc(x.label)+'</span></div><div><strong>'+esc(x.status)+'</strong><span>'+fmt(x.created_at)+'</span></div></div>').join(''):'<div class="empty">No submissions yet.</div>';
  }catch(e){$('#recentActivity').innerHTML='<div class="empty">'+esc(e.message)+'</div>'}
}
async function loadEnquiries(){
  try {
    const data=await rest('enquiries','select=*&order=created_at.desc',{method:'GET'});
    $('#enquiryRows').innerHTML=(data||[]).map(x=>'<tr><td>'+fmt(x.created_at)+'</td><td><strong>'+esc(x.name)+'</strong></td><td>'+esc(x.company||'—')+'</td><td>'+esc(x.phone)+'<br><span class="muted">'+esc(x.email)+'</span></td><td>'+esc(x.trade||'—')+'</td><td><select data-enquiry-status="'+x.id+'">'+['New','Contacted','Closed'].map(st=>'<option '+(x.status===st?'selected':'')+'>'+st+'</option>').join('')+'</select></td><td><button class="link-btn" data-enquiry-view="'+x.id+'">View</button></td></tr>').join('')||'<tr><td colspan="7">No enquiries yet.</td></tr>';
    document.querySelectorAll('[data-enquiry-status]').forEach(el=>el.addEventListener('change',()=>updateStatus('enquiries',el.dataset.enquiryStatus,el.value)));
    document.querySelectorAll('[data-enquiry-view]').forEach(el=>el.addEventListener('click',()=>showDetail((data||[]).find(x=>x.id===el.dataset.enquiryView),'Enquiry')));
  } catch(e) { $('#enquiryRows').innerHTML='<tr><td colspan="7">'+esc(e.message)+'</td></tr>'; }
}
async function loadApplications(){
  try {
    const data=await rest('applications','select=*&order=created_at.desc',{method:'GET'});
    $('#applicationRows').innerHTML=(data||[]).map(x=>'<tr><td>'+fmt(x.created_at)+'</td><td><strong>'+esc(x.name)+'</strong></td><td>'+esc(x.trade)+'</td><td>'+esc(x.phone)+'<br><span class="muted">'+esc(x.email)+'</span></td><td><select data-app-status="'+x.id+'">'+['New','Reviewed','Shortlisted','Rejected'].map(st=>'<option '+(x.status===st?'selected':'')+'>'+st+'</option>').join('')+'</select></td><td><button class="link-btn" data-cv="'+x.id+'">Download</button></td><td><button class="link-btn" data-app-view="'+x.id+'">View</button></td></tr>').join('')||'<tr><td colspan="7">No applications yet.</td></tr>';
    document.querySelectorAll('[data-app-status]').forEach(el=>el.addEventListener('change',()=>updateStatus('applications',el.dataset.appStatus,el.value)));
    document.querySelectorAll('[data-app-view]').forEach(el=>el.addEventListener('click',()=>showDetail((data||[]).find(x=>x.id===el.dataset.appView),'Application')));
    document.querySelectorAll('[data-cv]').forEach(el=>el.addEventListener('click',()=>downloadCv((data||[]).find(x=>x.id===el.dataset.cv)));
  } catch(e) { $('#applicationRows').innerHTML='<tr><td colspan="7">'+esc(e.message)+'</td></tr>'; }
}
async function updateStatus(table,id,status){
  try {
    await rest(table,'id=eq.'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status})});
  } catch(e) { alert(e.message); }
}
function showDetail(x,type){
  if(!x)return;
  const skip=new Set(['id','cv_path','cv_mime_type','cv_size_bytes']);
  const rows=Object.entries(x).filter(([k])=>!skip.has(k)).map(([k,v])=>'<dt>'+esc(k.replaceAll('_',' '))+'</dt><dd>'+((k.includes('created_at')||k.includes('updated_at'))?fmt(v):esc(v??'—'))+'</dd>').join('');
  dialogContent.innerHTML='<p class="kicker">'+esc(type)+'</p><h2>'+esc(x.name)+'</h2><dl class="detail-grid">'+rows+'</dl>';
  dialog.showModal();
}
$('#dialogClose').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});

async function downloadCv(app){
  if(!app?.cv_path)return;
  const path=app.cv_path.split('/').map(encodeURIComponent).join('/');
  const res=await api('/storage/v1/object/authenticated/cv-private/'+path,{method:'GET'});
  if(!res.ok){alert('Could not download CV.');return}
  const blob=await res.blob();
  const url=window.URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=app.cv_original_name||'CV';
  a.click();
  setTimeout(()=>window.URL.revokeObjectURL(url),1000);
}
async function loadClients(){
  try {
    clients=await rest('clients','select=*&order=display_order.asc,name.asc',{method:'GET'})||[];
    $('#clientRows').innerHTML=clients.map(x=>'<div class="client-item"><img src="'+esc(x.logo_path)+'" alt=""><div class="client-meta"><strong>'+esc(x.name)+'</strong><span>Order '+x.display_order+' · '+(x.enabled?'Enabled':'Hidden')+'</span></div><div class="client-actions"><button class="secondary" data-edit-client="'+x.id+'">Edit</button><button class="link-btn danger" data-delete-client="'+x.id+'">Delete</button></div></div>').join('')||'<div class="empty">No clients.</div>';
    document.querySelectorAll('[data-edit-client]').forEach(b=>b.addEventListener('click',()=>editClient(b.dataset.editClient)));
    document.querySelectorAll('[data-delete-client]').forEach(b=>b.addEventListener('click',()=>deleteClient(b.dataset.deleteClient)));
  } catch(e) { $('#clientRows').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; }
}
function editClient(id){
  const x=clients.find(c=>c.id===id);if(!x)return;
  $('#clientId').value=x.id;$('#clientName').value=x.name;$('#clientOrder').value=x.display_order;$('#clientEnabled').checked=x.enabled;
  $('#clientFormTitle').textContent='Edit client';$('#clientCancel').hidden=false;
}
function resetClientForm(){
  $('#clientForm').reset();$('#clientId').value='';$('#clientOrder').value=0;$('#clientEnabled').checked=true;$('#clientFormTitle').textContent='Add client';$('#clientCancel').hidden=true;$('#clientStatus').textContent='';
}
$('#clientCancel').addEventListener('click',resetClientForm);
$('#clientForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const status=$('#clientStatus');
  status.textContent='Saving…';status.classList.remove('is-error');
  try{
    const id=$('#clientId').value;
    let logoPath=id?clients.find(c=>c.id===id)?.logo_path:'';
    const file=$('#clientLogo').files?.[0];
    if(!id&&!file)throw new Error('Please choose a logo.');
    if(file){
      if(file.size>5*1024*1024)throw new Error('Logo must be 5 MB or smaller.');
      const ext=(file.name.split('.').pop()||'png').toLowerCase();
      const path=crypto.randomUUID()+'.'+ext;
      const res=await api('/storage/v1/object/client-logos/'+encodeURIComponent(path),{
        method:'POST',
        headers:{'Content-Type':file.type,'x-upsert':'false'},
        body:file
      });
      if(!res.ok)throw new Error('Logo upload failed.');
      logoPath=SUPABASE_URL+'/storage/v1/object/public/client-logos/'+encodeURIComponent(path);
    }
    const payload={name:$('#clientName').value.trim(),display_order:Number($('#clientOrder').value)||0,enabled:$('#clientEnabled').checked,logo_path:logoPath};
    if(id) await rest('clients','id=eq.'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(payload)});
    else await rest('clients','',{method:'POST',body:JSON.stringify(payload)});
    resetClientForm();
    await loadClients();
  }catch(err){status.textContent=err.message;status.classList.add('is-error')}
});
async function deleteClient(id){
  const x=clients.find(c=>c.id===id);
  if(!x||!confirm('Delete '+x.name+'?'))return;
  try {
    await rest('clients','id=eq.'+encodeURIComponent(id),{method:'DELETE'});
    await loadClients();
  } catch(e) { alert(e.message); }
}

session = loadStoredSession();
showSession();
})();
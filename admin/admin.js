(function () {
  'use strict';

  var SUPABASE_URL = 'https://hjbzkhcoltoxzvabprdj.supabase.co';
  var API_KEY = 'sb_publishable_4mtyuQoyJf9zlOoWyKrtpw_aWUlDEc2';
  var session = null;
  var clients = [];
  var enquiriesCache = null;
  var applicationsCache = null;
  var contactsCache = null;
  var clientsCache = null;
  var trashCache = null;
  var auditCache = null;
  var realtimeClient = null;
  var realtimeChannel = null;
  var currentDetailItem = null;
  var currentDetailType = '';
  var dashboardSnapshot = null;

  function $(selector) { return document.querySelector(selector); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function fmt(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('en-AE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
    } catch (e) {
      return value;
    }
  }
  function setLoginStatus(message, isError) {
    var el = $('#loginStatus');
    el.textContent = message;
    el.className = isError ? 'status is-error' : 'status';
  }
  function saveSession(data) {
    session = data;
    if (!data) {
      enquiriesCache = applicationsCache = contactsCache = clientsCache = trashCache = auditCache = null;
      clients = []; dashboardSnapshot = null;
      if (liveSyncTimer) clearInterval(liveSyncTimer);
      realtimeConnected = false;
    }
    if (data) localStorage.setItem('prtc_admin_session', JSON.stringify(data));
    else localStorage.removeItem('prtc_admin_session');
  }
  function storedSession() {
    try { return JSON.parse(localStorage.getItem('prtc_admin_session') || 'null'); }
    catch (e) { return null; }
  }
  function headers(extra) {
    var h = {'apikey': API_KEY};
    if (session && session.access_token) h.Authorization = 'Bearer ' + session.access_token;
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }
  var refreshPromise = null;
  function refreshSession(failedToken) {
    if (refreshPromise) return refreshPromise;
    var expected = session && session.refresh_token;
    if (!expected) return Promise.resolve(false);
    function performRefresh() {
      if (!session) return false;
      var latest = storedSession();
      if (!latest) return false;
      if (latest.access_token !== (failedToken || session.access_token)) {
        saveSession(latest);
        return true;
      }
      expected = latest.refresh_token;
      return fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
        method:'POST', headers:{apikey:API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:expected})
      }).then(async function (res) {
        // Never restore a session after logout or overwrite a newer login.
        if (!session || !storedSession() || session.refresh_token !== expected) return false;
        if (!res.ok) {
          if (res.status === 400 || res.status === 401) {
            saveSession(null); showLogin('Your session has expired. Please sign in again.');
          }
          return false;
        }
        saveSession(await res.json());
        if (realtimeClient) realtimeClient.realtime.setAuth(session.access_token);
        return true;
      });
    }
    refreshPromise = Promise.resolve().then(function () {
      return navigator.locks ? navigator.locks.request('prtc-admin-refresh', performRefresh) : performRefresh();
    }).catch(function () { return false; }).finally(function () { refreshPromise = null; });
    return refreshPromise;
  }
  function api(path, options, retry) {
    options = options || {};
    if (retry === undefined) retry = true;
    var opts = Object.assign({}, options, {headers:headers(options.headers || {})});
    var token = session && session.access_token;
    return fetch(SUPABASE_URL + path, opts).then(function (res) {
      if (res.status === 401 && retry && session) {
        if (session.access_token !== token) return api(path, options, false);
        return refreshSession(token).then(function (ok) {
          return ok ? api(path, options, false) : res;
        });
      }
      return res;
    });
  }
  function readError(res, fallback) {
    return res.json().then(function (j) {
      return new Error(j.message || j.msg || j.error || j.error_description || fallback);
    }).catch(function () {
      return new Error(fallback);
    });
  }
  var listRequests = new Map();
  function readAllRows(table, query) {
    var key = table + '?' + query;
    if (listRequests.has(key)) return listRequests.get(key);
    var owner = session && session.user && session.user.id;
    var request = (async function () {
      var params = new URLSearchParams(query);
      var order = params.get('order') || 'id.asc';
      if (!/(^|,)id\./.test(order)) order += ',id.asc';
      params.set('order', order);
      params.delete('limit'); params.delete('offset');
      var rows = [], offset = 0;
      while (true) {
        if (!session || session.user.id !== owner) throw new Error('Session changed. Please reload.');
        params.set('limit','200'); params.set('offset',String(offset));
        var res = await api('/rest/v1/' + table + '?' + params.toString(), {
          method:'GET',headers:{Prefer:'count=exact'}
        });
        if (!res.ok) throw await readError(res,'Could not load all records. Please refresh.');
        var batch = await res.json();
        if (!session || session.user.id !== owner) throw new Error('Session changed. Please reload.');
        if (!Array.isArray(batch)) throw new Error('Invalid record response.');
        var totalText = (res.headers.get('content-range') || '').split('/')[1];
        var total = totalText && totalText !== '*' ? Number(totalText) : null;
        rows = rows.concat(batch); offset += batch.length;
        if (total !== null && offset >= total) break;
        if (!batch.length) {
          if (total !== null && offset < total) throw new Error('Records changed while loading. Please refresh.');
          break;
        }
      }
      return Array.from(new Map(rows.map(function (row) { return [row.id,row]; })).values());
    })();
    listRequests.set(key, request);
    return request.finally(function () { listRequests.delete(key); });
  }
  function rest(table, query, options) {
    query = query || '';
    options = options || {};
    if ((!options.method || options.method === 'GET') && /(^|&)select=\*(&|$)/.test(query)) return readAllRows(table, query);
    var opts = {};
    Object.keys(options).forEach(function (k) { opts[k] = options[k]; });
    var customHeaders = {'Content-Type':'application/json','Prefer':'return=representation'};
    if (options.headers) Object.keys(options.headers).forEach(function (k) { customHeaders[k] = options.headers[k]; });
    opts.headers = customHeaders;
    return api('/rest/v1/' + table + (query ? '?' + query : ''), opts).then(function (res) {
      if (!res.ok) {
        return readError(res, 'Request failed.').then(function (err) { throw err; });
      }
      return res.text().then(function (text) { return text ? JSON.parse(text) : null; });
    });
  }

  function showShell(data) {
    $('#loginView').hidden = true;
    $('#adminView').hidden = false;
    $('#adminEmail').textContent = data && data.user && data.user.email ? data.user.email : 'Admin';
  }
  function showLogin(message) {
    $('#adminView').hidden = true;
    $('#loginView').hidden = false;
    if (message) setLoginStatus(message, true);
  }
  function verifyAdmin(data) {
    if (!data || !data.user || !data.user.id) return Promise.reject(new Error('Invalid session.'));
    return rest('admin_users','select=role&user_id=eq.' + encodeURIComponent(data.user.id),{method:'GET'}).then(function (rows) {
      if (!rows || !rows.length || rows[0].role !== 'admin') {
        throw new Error('This account is not approved as a PRTC administrator.');
      }
      return true;
    });
  }

  function login() {
    var email = $('#loginEmail').value.trim();
    var password = $('#loginPassword').value;
    var btn = $('#loginBtn');

    if (!email || !password) {
      setLoginStatus('Enter your email and password.', true);
      return;
    }

    btn.disabled = true;
    setLoginStatus('Signing in…', false);

    fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method:'POST',
      headers:{'apikey':API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({email:email,password:password})
    })
    .then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.msg || data.message || data.error_description || 'Sign in failed.');
        return data;
      });
    })
    .then(function (data) {
      saveSession(data);

      // Verify the admin role before displaying the dashboard.
      $('#recentActivity').innerHTML = '<div class="empty">Verifying administrator access…</div>';

      return verifyAdmin(data).then(function () {
        showShell(data);
        loadDashboard();

        startLiveSync();
      });
    })
    .catch(function (err) {
      saveSession(null);
      showLogin(err && err.message ? err.message : 'Sign in failed.');
    })
    .then(function () {
      btn.disabled = false;
    });
  }

  $('#loginBtn').addEventListener('click', login);
  $('#loginPassword').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      login();
    }
  });

  $('#logoutBtn').addEventListener('click', function () {
    if (liveSyncTimer) { clearInterval(liveSyncTimer); liveSyncTimer = null; }
    if (realtimeClient && realtimeChannel) { try { realtimeClient.removeChannel(realtimeChannel); } catch (e) {} }
    realtimeClient = null; realtimeChannel = null;
    var old = session;
    saveSession(null);
    showLogin();
    setLoginStatus('Ready to sign in.', false);
    if (old && old.access_token) {
      fetch(SUPABASE_URL + '/auth/v1/logout', {
        method:'POST',
        headers:{'apikey':API_KEY,'Authorization':'Bearer ' + old.access_token}
      }).catch(function () {});
    }
  });

  var titles = {dashboard:'Dashboard',enquiries:'Enquiries',applications:'Applications',contacts:'Contact Messages',clients:'Clients',trash:'Trash',audit:'Audit Log'};
  all('.nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var view = btn.getAttribute('data-view');
      all('.nav-btn').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      all('.admin-view').forEach(function (panel) { panel.classList.toggle('is-active', panel.getAttribute('data-panel') === view); });
      $('#viewTitle').textContent = titles[view];
      $('#sidebar').classList.remove('is-open');
      if (view === 'dashboard') loadDashboard(true);
      if (view === 'enquiries') { loadEnquiries(); syncOneTable('enquiries'); }
      if (view === 'applications') { loadApplications(); syncOneTable('applications'); }
      if (view === 'contacts') { loadContacts(); syncOneTable('contact_messages'); }
      if (view === 'clients') { loadClients(); syncOneTable('clients'); }
      if (view === 'trash') loadTrash();
      if (view === 'audit') loadAudit();
    });
  });
  $('#mobileNavBtn').addEventListener('click', function () { $('#sidebar').classList.toggle('is-open'); });
  all('[data-refresh]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var view = btn.getAttribute('data-refresh');
      if (view === 'enquiries') enquiriesCache = null;
      if (view === 'applications') applicationsCache = null;
      if (view === 'contacts') contactsCache = null;
      if (view === 'clients') clientsCache = null;
      if (view === 'dashboard') loadDashboard();
      if (view === 'enquiries') loadEnquiries();
      if (view === 'applications') loadApplications();
      if (view === 'contacts') loadContacts();
      if (view === 'clients') loadClients();
      if (view === 'trash') loadTrash();
      if (view === 'audit') loadAudit();
    });
  });

  function fetchCount(table, status) {
    var q = 'select=id';
    if (status) q += '&status=eq.' + encodeURIComponent(status);
    return api('/rest/v1/' + table + '?' + q, {method:'HEAD',headers:{'Prefer':'count=exact'}}).then(function (res) {
      if (!res.ok) throw new Error('Could not load dashboard totals.');
      var range = res.headers.get('content-range') || '0/0';
      return Number(range.split('/')[1]) || 0;
    });
  }

  function loadDashboard(silent) {
    if (!silent || !dashboardSnapshot) $('#recentActivity').innerHTML = '<div class="empty">Loading…</div>';

    return api('/rest/v1/rpc/get_admin_dashboard', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:'{}'
    }).then(function (res) {
      if (!res.ok) {
        return readError(res, 'Could not load dashboard.').then(function (err) { throw err; });
      }
      return res.json();
    }).then(function (data) {
      dashboardSnapshot = data;
      setExportReady('Dashboard',true);
      var counts = data.counts || {};
      var cards = [
        ['New enquiries', counts.new_enquiries || 0],
        ['Total enquiries', counts.total_enquiries || 0],
        ['New applications', counts.new_applications || 0],
        ['Total applications', counts.total_applications || 0],
        ['New contact messages', counts.new_contacts || 0],
        ['Total contact messages', counts.total_contacts || 0],
        ['Active clients', counts.active_clients || 0]
      ];
      updateNavBadge('enquiryBadge', counts.new_enquiries || 0);
      updateNavBadge('applicationBadge', counts.new_applications || 0);
      updateNavBadge('contactBadge', counts.new_contacts || 0);
      updateNavBadge('trashBadge', counts.trash_count || 0);
      $('#dashboardStats').innerHTML = cards.map(function (x) {
        return '<div class="stat-card"><span>' + esc(x[0]) + '</span><strong>' + x[1] + '</strong></div>';
      }).join('');

      var items = [];
      (data.recent_enquiries || []).forEach(function (x) {
        items.push({id:x.id,name:x.name,type:'Enquiry',view:'enquiries',label:x.company || x.name,status:x.status,created_at:x.created_at});
      });
      (data.recent_applications || []).forEach(function (x) {
        items.push({id:x.id,name:x.name,type:'Application',view:'applications',label:x.trade || x.name,status:x.status,created_at:x.created_at});
      });
      (data.recent_contacts || []).forEach(function (x) {
        items.push({id:x.id,name:x.name,type:'Contact Message',view:'contacts',label:x.company || x.trade || x.name,status:x.status,created_at:x.created_at});
      });
      items.sort(function (a,b) { return new Date(b.created_at) - new Date(a.created_at); });
      items = items.slice(0,8);

      $('#recentActivity').innerHTML = items.length ? items.map(function (x) {
        return '<button class="activity-item activity-button" type="button" data-recent-view="' + x.view + '" data-recent-id="' + x.id + '"><div><strong>' + esc(x.name) + '</strong><span>' + esc(x.type) + ' · ' + esc(x.label) + '</span></div><div><strong>' + esc(x.status) + '</strong><span>' + fmt(x.created_at) + '</span></div></button>';
      }).join('') : '<div class="empty">No submissions yet.</div>';
      all('[data-recent-view]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          openRecent(btn.getAttribute('data-recent-view'), btn.getAttribute('data-recent-id'));
        });
      });
    }).catch(function (err) {
      $('#recentActivity').innerHTML = '<div class="empty">' + esc(err.message || 'Could not load dashboard.') + '</div>';
    });
  }

  function setExportReady(area, ready) {
    all('[id^="export' + area + '"]').forEach(function (button) { button.disabled = !ready; });
  }
  ['Enquiries','Applications','Contacts','Clients','Trash','Audit','Dashboard'].forEach(function (area) { setExportReady(area,false); });
  var pageState = {};
  function pageRows(rows, name, render) {
    var pageSize = 50, pages = Math.max(1,Math.ceil(rows.length / pageSize));
    var page = Math.min(pageState[name] || 0,pages - 1);
    pageState[name] = page;
    var target = $('#' + name + 'Rows');
    var host = target.closest('.table-wrap') || target;
    var controls = $('#' + name + 'Pages');
    if (!controls) {
      controls = document.createElement('div'); controls.id = name + 'Pages';
      controls.className = 'pagination'; controls.setAttribute('aria-label','Record pages');
      host.insertAdjacentElement('afterend',controls);
    }
    controls.innerHTML = '<button type="button" class="secondary" data-prev>Previous</button><span role="status">Page ' + (page + 1) + ' of ' + pages + ' · ' + rows.length + ' records</span><button type="button" class="secondary" data-next>Next</button>';
    var previous = controls.querySelector('[data-prev]'), next = controls.querySelector('[data-next]');
    previous.disabled = page === 0; next.disabled = page >= pages - 1;
    previous.onclick = function () { pageState[name] = page - 1; render(); };
    next.onclick = function () { pageState[name] = page + 1; render(); };
    return rows.slice(page * pageSize,(page + 1) * pageSize);
  }
  function loadEnquiries() {
    setExportReady('Enquiries',false);
    if (!enquiriesCache) $('#enquiryRows').innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
    var source = enquiriesCache ? Promise.resolve(enquiriesCache) : rest('enquiries','select=*&deleted_at=is.null&order=created_at.desc',{method:'GET'});
    source.then(function (data) {
      data = data || [];
      enquiriesCache = data;
      var visible = pageRows(getFilteredEnquiries(data),'enquiry',loadEnquiries);
      setExportReady('Enquiries',true);
      $('#enquiryRows').innerHTML = visible.length ? visible.map(function (x) {
        var opts = ['New','Contacted','Closed'].map(function (st) {
          return '<option' + (x.status === st ? ' selected' : '') + '>' + st + '</option>';
        }).join('');
        return '<tr><td class="check-col"><input type="checkbox" data-enquiry-select="' + x.id + '"></td><td>' + fmt(x.created_at) + '</td><td><strong>' + esc(x.name) + '</strong></td><td>' + esc(x.company || '—') + '</td><td>' + esc(x.phone) + '<br><span class="muted">' + esc(x.email) + '</span></td><td>' + esc(x.trade || '—') + '</td><td><select data-enquiry-status="' + x.id + '">' + opts + '</select></td><td><div class="row-actions"><button class="link-btn" type="button" data-enquiry-view="' + x.id + '">View</button><button class="link-btn" type="button" data-enquiry-pdf="' + x.id + '">PDF</button><button class="link-btn danger" type="button" data-enquiry-delete="' + x.id + '">Trash</button></div></td></tr>';
      }).join('') : '<tr><td colspan="8">No enquiries yet.</td></tr>';

      all('[data-enquiry-select]').forEach(function (el) {
        el.value = el.getAttribute('data-enquiry-select');
        el.addEventListener('change', function () { setSelectedCount('enquiry','[data-enquiry-select]'); });
      });
      $('#enquirySelectAll').checked = false;
      setSelectedCount('enquiry','[data-enquiry-select]');
      all('[data-enquiry-status]').forEach(function (el) {
        el.addEventListener('change', function () { updateStatus('enquiries', el.getAttribute('data-enquiry-status'), el.value); });
      });
      all('[data-enquiry-view]').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-enquiry-view');
          var item = enquiriesCache.filter(function (x) { return x.id === id; })[0];
          showDetail(item,'Enquiry');
        });
      });
      all('[data-enquiry-pdf]').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-enquiry-pdf');
          var item = enquiriesCache.filter(function (x) { return x.id === id; })[0];
          if (item) downloadTextPdf('PRTC-Enquiry-' + (item.name || 'Record').replace(/[^a-z0-9]+/gi,'-') + '.pdf','PRTC Group - Enquiry',enquirySections([item]));
        });
      });
      all('[data-enquiry-delete]').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-enquiry-delete');
          var item = enquiriesCache.filter(function (x) { return x.id === id; })[0];
          if (!item || !confirm('Move enquiry from ' + item.name + ' to Trash?')) return;
          el.disabled = true;
          rest('enquiries','id=eq.' + encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({deleted_at:new Date().toISOString()})}).then(function () {
            enquiriesCache = (enquiriesCache || []).filter(function (x) { return x.id !== id; });
            loadEnquiries();
            loadDashboard(true);
          }).catch(function (err) {
            el.disabled = false;
            alert(err.message);
          });
        });
      });
    }).catch(function (err) {
      $('#enquiryRows').innerHTML = '<tr><td colspan="8">' + esc(err.message) + '</td></tr>';
    });
  }

  function loadApplications() {
    setExportReady('Applications',false);
    if (!applicationsCache) $('#applicationRows').innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
    var source = applicationsCache ? Promise.resolve(applicationsCache) : rest('applications','select=*&deleted_at=is.null&cv_uploaded=eq.true&order=created_at.desc',{method:'GET'});
    source.then(function (data) {
      data = data || [];
      applicationsCache = data;
      var visible = pageRows(getFilteredApplications(data),'application',loadApplications);
      setExportReady('Applications',true);
      $('#applicationRows').innerHTML = visible.length ? visible.map(function (x) {
        var opts = ['New','Reviewed','Shortlisted','Rejected'].map(function (st) {
          return '<option' + (x.status === st ? ' selected' : '') + '>' + st + '</option>';
        }).join('');
        return '<tr><td class="check-col"><input type="checkbox" data-application-select="' + x.id + '"></td><td>' + fmt(x.created_at) + '</td><td><strong>' + esc(x.name) + '</strong></td><td>' + esc(x.trade) + '</td><td>' + esc(x.phone) + '<br><span class="muted">' + esc(x.email) + '</span></td><td><select data-app-status="' + x.id + '">' + opts + '</select></td><td><button class="link-btn" type="button" data-cv="' + x.id + '">Download</button></td><td><div class="row-actions"><button class="link-btn" type="button" data-app-view="' + x.id + '">View</button><button class="link-btn" type="button" data-app-pdf="' + x.id + '">PDF</button><button class="link-btn danger" type="button" data-app-delete="' + x.id + '">Trash</button></div></td></tr>';
      }).join('') : '<tr><td colspan="8">No applications yet.</td></tr>';

      all('[data-application-select]').forEach(function (el) {
        el.value = el.getAttribute('data-application-select');
        el.addEventListener('change', function () { setSelectedCount('application','[data-application-select]'); });
      });
      $('#applicationSelectAll').checked = false;
      setSelectedCount('application','[data-application-select]');
      all('[data-app-status]').forEach(function (el) {
        el.addEventListener('change', function () { updateStatus('applications', el.getAttribute('data-app-status'), el.value); });
      });
      all('[data-app-view]').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-app-view');
          var item = applicationsCache.filter(function (x) { return x.id === id; })[0];
          showDetail(item,'Application');
        });
      });
      all('[data-app-pdf]').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-app-pdf');
          var item = applicationsCache.filter(function (x) { return x.id === id; })[0];
          if (item) downloadTextPdf('PRTC-Application-' + (item.name || 'Record').replace(/[^a-z0-9]+/gi,'-') + '.pdf','PRTC Group - Application',applicationSections([item]));
        });
      });
      all('[data-cv]').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-cv');
          var item = applicationsCache.filter(function (x) { return x.id === id; })[0];
          downloadCv(item);
        });
      });
      all('[data-app-delete]').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-app-delete');
          var item = applicationsCache.filter(function (x) { return x.id === id; })[0];
          if (!item || !confirm('Move application from ' + item.name + ' to Trash?')) return;
          el.disabled = true;

          rest('applications','id=eq.' + encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({deleted_at:new Date().toISOString()})}).then(function () {
            applicationsCache = (applicationsCache || []).filter(function (x) { return x.id !== id; });
            loadApplications();
            loadDashboard(true);
          }).catch(function (err) {
            el.disabled = false;
            alert(err.message);
          });
        });
      });
    }).catch(function (err) {
      $('#applicationRows').innerHTML = '<tr><td colspan="8">' + esc(err.message) + '</td></tr>';
    });
  }



  function updateNavBadge(id,count) {
    var el = $('#' + id);
    if (!el) return;
    el.textContent = count;
    el.hidden = !count;
  }

  function openRecent(view,id) {
    var btn = document.querySelector('[data-view="' + view + '"]');
    if (btn) btn.click();
    setTimeout(function () {
      var item = null, type = '';
      if (view === 'enquiries') { item = (enquiriesCache || []).find(function (x) { return x.id === id; }); type = 'Enquiry'; }
      if (view === 'applications') { item = (applicationsCache || []).find(function (x) { return x.id === id; }); type = 'Application'; }
      if (view === 'contacts') { item = (contactsCache || []).find(function (x) { return x.id === id; }); type = 'Contact Message'; }
      if (item) showDetail(item,type);
    },50);
  }

  function dateMatches(value,prefix) {
    var presetEl = $('#' + prefix + 'DatePreset');
    var fromEl = $('#' + prefix + 'DateFrom');
    var toEl = $('#' + prefix + 'DateTo');
    var preset = presetEl ? presetEl.value : '';
    var d = value ? new Date(value) : null;
    if (!d || isNaN(d.getTime())) return true;
    var now = new Date();
    var start = null, end = null;

    if (preset === 'today') {
      start = new Date(now.getFullYear(),now.getMonth(),now.getDate());
      end = new Date(start); end.setDate(end.getDate()+1);
    } else if (preset === 'week') {
      var day = now.getDay();
      var diff = (day + 6) % 7;
      start = new Date(now.getFullYear(),now.getMonth(),now.getDate()-diff);
      end = new Date(start); end.setDate(end.getDate()+7);
    } else if (preset === 'month') {
      start = new Date(now.getFullYear(),now.getMonth(),1);
      end = new Date(now.getFullYear(),now.getMonth()+1,1);
    } else if (preset === 'custom') {
      if (fromEl && fromEl.value) start = new Date(fromEl.value + 'T00:00:00');
      if (toEl && toEl.value) { end = new Date(toEl.value + 'T00:00:00'); end.setDate(end.getDate()+1); }
    }

    if (start && d < start) return false;
    if (end && d >= end) return false;
    return true;
  }

  function selectedIds(selector) {
    return all(selector + ':checked').map(function (el) { return el.value || el.getAttribute('data-id') || el.getAttribute('data-enquiry-select') || el.getAttribute('data-application-select') || el.getAttribute('data-contact-select'); }).filter(Boolean);
  }

  function setSelectedCount(prefix,selector) {
    var count = selectedIds(selector).length;
    var el = $('#' + prefix + 'SelectedCount');
    if (el) el.textContent = count + ' selected';
  }

  function downloadCsv(filename,headersList,rows) {
    function csvCell(value) {
      var text = String(value == null ? '' : value);
      if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
      text = text.replace(/"/g,'""');
      return '"' + text + '"';
    }
    var out = [headersList.map(csvCell).join(',')].concat(rows.map(function (row) { return row.map(csvCell).join(','); })).join('\r\n');
    var blob = new Blob(['\uFEFF' + out],{type:'text/csv;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); },1000);
  }

  function norm(value) {
    return String(value == null ? '' : value).toLowerCase();
  }

  function getFilteredEnquiries(data) {
    var q = norm($('#enquirySearch') ? $('#enquirySearch').value : '');
    var status = $('#enquiryStatusFilter') ? $('#enquiryStatusFilter').value : '';
    var sort = $('#enquirySort') ? $('#enquirySort').value : 'newest';
    var rows = (data || []).filter(function (x) {
      var hay = [x.name,x.company,x.email,x.phone,x.trade,x.project_location,x.duration,x.message].map(norm).join(' ');
      return (!q || hay.indexOf(q) >= 0) && (!status || x.status === status) && dateMatches(x.created_at,'enquiry');
    }).slice();
    rows.sort(function (a,b) {
      if (sort === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      if (sort === 'company') return String(a.company || '').localeCompare(String(b.company || ''));
      return new Date(b.created_at) - new Date(a.created_at);
    });
    return rows;
  }

  function getFilteredApplications(data) {
    var q = norm($('#applicationSearch') ? $('#applicationSearch').value : '');
    var status = $('#applicationStatusFilter') ? $('#applicationStatusFilter').value : '';
    var sort = $('#applicationSort') ? $('#applicationSort').value : 'newest';
    var rows = (data || []).filter(function (x) {
      var hay = [x.name,x.trade,x.email,x.phone,x.location,x.nationality,x.employment_status].map(norm).join(' ');
      return (!q || hay.indexOf(q) >= 0) && (!status || x.status === status) && dateMatches(x.created_at,'application');
    }).slice();
    rows.sort(function (a,b) {
      if (sort === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      if (sort === 'trade') return String(a.trade || '').localeCompare(String(b.trade || ''));
      return new Date(b.created_at) - new Date(a.created_at);
    });
    return rows;
  }

  function getFilteredClients(data) {
    var q = norm($('#clientSearch') ? $('#clientSearch').value : '');
    var status = $('#clientStatusFilter') ? $('#clientStatusFilter').value : '';
    var sort = $('#clientSort') ? $('#clientSort').value : 'order';
    var rows = (data || []).filter(function (x) {
      if (q && norm(x.name).indexOf(q) < 0) return false;
      if (status === 'enabled' && !x.enabled) return false;
      if (status === 'hidden' && x.enabled) return false;
      return true;
    }).slice();
    rows.sort(function (a,b) {
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      if (sort === 'name-desc') return String(b.name || '').localeCompare(String(a.name || ''));
      return (Number(a.display_order) || 0) - (Number(b.display_order) || 0);
    });
    return rows;
  }

  function asciiPdfText(value) {
    return String(value == null ? '' : value)
      .replace(/[–—]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"')
      .replace(/[^\x20-\x7E]/g,'?');
  }

  function wrapPdfLine(text, max) {
    var words = asciiPdfText(text).split(/\s+/);
    var lines = [], line = '';
    words.forEach(function (word) {
      var next = line ? line + ' ' + word : word;
      if (next.length > max && line) { lines.push(line); line = word; }
      else line = next;
    });
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function pdfEscape(text) {
    return asciiPdfText(text).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  }

  function downloadTextPdf(filename, title, sections) {
    var lines = [];
    lines.push({text:title,bold:true,size:17});
    lines.push({text:'PRTC Group | Generated ' + new Date().toLocaleString('en-AE'),size:9});
    lines.push({text:'',size:8});

    sections.forEach(function (section, idx) {
      if (idx) lines.push({text:'',size:8});
      if (section.heading) lines.push({text:section.heading,bold:true,size:12});
      (section.lines || []).forEach(function (line) {
        wrapPdfLine(line, 92).forEach(function (wrapped) {
          lines.push({text:wrapped,size:9});
        });
      });
    });

    var pages = [], page = [], y = 790;
    lines.forEach(function (line) {
      var size = line.size || 9;
      var step = size + 4;
      if (y - step < 45) { pages.push(page); page = []; y = 790; }
      page.push({text:line.text,bold:!!line.bold,size:size,y:y});
      y -= step;
    });
    if (page.length || !pages.length) pages.push(page);

    var objects = [];
    function add(obj) { objects.push(obj); return objects.length; }
    var catalogId = add('');
    var pagesId = add('');
    var fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    var boldFontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    var pageIds = [];

    pages.forEach(function (p) {
      var stream = 'BT\n';
      p.forEach(function (line) {
        stream += '/' + (line.bold ? 'F2' : 'F1') + ' ' + line.size + ' Tf\n';
        stream += '1 0 0 1 42 ' + line.y + ' Tm\n';
        stream += '(' + pdfEscape(line.text) + ') Tj\n';
      });
      stream += 'ET';
      var contentId = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      var pageId = add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ' + fontId + ' 0 R /F2 ' + boldFontId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>');
      pageIds.push(pageId);
    });

    objects[pagesId - 1] = '<< /Type /Pages /Kids [' + pageIds.map(function (id) { return id + ' 0 R'; }).join(' ') + '] /Count ' + pageIds.length + ' >>';
    objects[catalogId - 1] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';

    var pdf = '%PDF-1.4\n';
    var offsets = [0];
    objects.forEach(function (obj, i) {
      offsets.push(pdf.length);
      pdf += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
    });
    var xref = pdf.length;
    pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    for (var i = 1; i <= objects.length; i++) {
      pdf += String(offsets[i]).padStart(10,'0') + ' 00000 n \n';
    }
    pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + catalogId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';

    var blob = new Blob([pdf], {type:'application/pdf'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function enquirySections(rows) {
    return rows.map(function (x, i) {
      return {heading:(i+1) + '. ' + (x.name || 'Enquiry'), lines:[
        'Company: ' + (x.company || '-'),
        'Email: ' + (x.email || '-'),
        'Phone / WhatsApp: ' + (x.phone || '-'),
        'Project Location: ' + (x.project_location || '-'),
        'Required Trade / Service: ' + (x.trade || '-'),
        'Workers Required: ' + (x.workers == null ? '-' : x.workers),
        'Contract Duration: ' + (x.duration || '-'),
        'Status: ' + (x.status || '-'),
        'Submitted: ' + fmt(x.created_at),
        'Additional Information: ' + (x.message || '-')
      ]};
    });
  }

  function applicationSections(rows) {
    return rows.map(function (x, i) {
      return {heading:(i+1) + '. ' + (x.name || 'Application'), lines:[
        'Email: ' + (x.email || '-'),
        'Phone / WhatsApp: ' + (x.phone || '-'),
        'Nationality: ' + (x.nationality || '-'),
        'Current Location: ' + (x.location || '-'),
        'Trade / Role: ' + (x.trade || '-'),
        'Years of Experience: ' + (x.experience == null ? '-' : x.experience),
        'Employment Status: ' + (x.employment_status || '-'),
        'Status: ' + (x.status || '-'),
        'CV: ' + (x.cv_original_name || '-'),
        'Submitted: ' + fmt(x.created_at),
        'Additional Information: ' + (x.message || '-')
      ]};
    });
  }

  function bindAdminFilters() {
    ['enquirySearch','enquiryStatusFilter','enquirySort','enquiryDatePreset','enquiryDateFrom','enquiryDateTo'].forEach(function (id) {
      var el = $('#' + id); if (el) el.addEventListener(id.indexOf('Search') >= 0 ? 'input' : 'change', function () { pageState['enquiry'] = 0; if (enquiriesCache) loadEnquiries(); });
    });
    ['applicationSearch','applicationStatusFilter','applicationSort','applicationDatePreset','applicationDateFrom','applicationDateTo'].forEach(function (id) {
      var el = $('#' + id); if (el) el.addEventListener(id.indexOf('Search') >= 0 ? 'input' : 'change', function () { pageState['application'] = 0; if (applicationsCache) loadApplications(); });
    });
    ['contactSearch','contactStatusFilter','contactSort','contactDatePreset','contactDateFrom','contactDateTo'].forEach(function (id) {
      var el = $('#' + id); if (el) el.addEventListener(id.indexOf('Search') >= 0 ? 'input' : 'change', function () { pageState['contact'] = 0; if (contactsCache) loadContacts(); });
    });
    ['clientSearch','clientStatusFilter','clientSort'].forEach(function (id) {
      var el = $('#' + id); if (el) el.addEventListener(id.indexOf('Search') >= 0 ? 'input' : 'change', function () { pageState['client'] = 0; if (clientsCache) loadClients(); });
    });
  }


  function getFilteredContacts(data) {
    var q = norm($('#contactSearch') ? $('#contactSearch').value : '');
    var status = $('#contactStatusFilter') ? $('#contactStatusFilter').value : '';
    var sort = $('#contactSort') ? $('#contactSort').value : 'newest';
    var rows = (data || []).filter(function (x) {
      var hay = [x.name,x.company,x.email,x.phone,x.trade,x.project_location,x.duration,x.message].map(norm).join(' ');
      return (!q || hay.indexOf(q) >= 0) && (!status || x.status === status) && dateMatches(x.created_at,'contact');
    }).slice();
    rows.sort(function (a,b) {
      if (sort === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      if (sort === 'company') return String(a.company || '').localeCompare(String(b.company || ''));
      return new Date(b.created_at) - new Date(a.created_at);
    });
    return rows;
  }

  function contactSections(rows) {
    return rows.map(function (x,i) {
      return {heading:(i+1) + '. ' + (x.name || 'Contact Message'), lines:[
        'Company: ' + (x.company || '-'),
        'Email: ' + (x.email || '-'),
        'Phone / WhatsApp: ' + (x.phone || '-'),
        'Project Location: ' + (x.project_location || '-'),
        'Service / Requirement: ' + (x.trade || '-'),
        'Workers Required: ' + (x.workers == null ? '-' : x.workers),
        'Contract Duration: ' + (x.duration || '-'),
        'Status: ' + (x.status || '-'),
        'Submitted: ' + fmt(x.created_at),
        'Message: ' + (x.message || '-')
      ]};
    });
  }

  function loadContacts() {
    setExportReady('Contacts',false);
    if (!contactsCache) $('#contactRows').innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
    var source = contactsCache ? Promise.resolve(contactsCache) : rest('contact_messages','select=*&deleted_at=is.null&order=created_at.desc',{method:'GET'});
    source.then(function (data) {
      data = data || [];
      contactsCache = data;
      var visible = pageRows(getFilteredContacts(data),'contact',loadContacts);
      setExportReady('Contacts',true);
      $('#contactRows').innerHTML = visible.length ? visible.map(function (x) {
        var opts = ['New','Replied','Closed'].map(function (st) {
          return '<option' + (x.status === st ? ' selected' : '') + '>' + st + '</option>';
        }).join('');
        return '<tr><td class="check-col"><input type="checkbox" data-contact-select="' + x.id + '"></td><td>' + fmt(x.created_at) + '</td><td><strong>' + esc(x.name) + '</strong></td><td>' + esc(x.company || '—') + '</td><td>' + esc(x.phone) + '<br><span class="muted">' + esc(x.email) + '</span></td><td>' + esc(x.trade || '—') + '</td><td><select data-contact-status="' + x.id + '">' + opts + '</select></td><td><div class="row-actions"><button class="link-btn" type="button" data-contact-view="' + x.id + '">View</button><button class="link-btn" type="button" data-contact-pdf="' + x.id + '">PDF</button><button class="link-btn danger" type="button" data-contact-delete="' + x.id + '">Trash</button></div></td></tr>';
      }).join('') : '<tr><td colspan="8">No contact messages yet.</td></tr>';

      all('[data-contact-select]').forEach(function (el) {
        el.value = el.getAttribute('data-contact-select');
        el.addEventListener('change', function () { setSelectedCount('contact','[data-contact-select]'); });
      });
      $('#contactSelectAll').checked = false;
      setSelectedCount('contact','[data-contact-select]');
      all('[data-contact-status]').forEach(function (el) {
        el.addEventListener('change', function () { updateStatus('contact_messages', el.getAttribute('data-contact-status'), el.value); });
      });
      all('[data-contact-view]').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-contact-view');
          var item = contactsCache.filter(function (x) { return x.id === id; })[0];
          showDetail(item,'Contact Message');
        });
      });
      all('[data-contact-pdf]').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-contact-pdf');
          var item = contactsCache.filter(function (x) { return x.id === id; })[0];
          if (item) downloadTextPdf('PRTC-Contact-' + (item.name || 'Record').replace(/[^a-z0-9]+/gi,'-') + '.pdf','PRTC Group - Contact Message',contactSections([item]));
        });
      });
      all('[data-contact-delete]').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-contact-delete');
          var item = contactsCache.filter(function (x) { return x.id === id; })[0];
          if (!item || !confirm('Move contact message from ' + item.name + ' to Trash?')) return;
          el.disabled = true;
          rest('contact_messages','id=eq.' + encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({deleted_at:new Date().toISOString()})}).then(function () {
            contactsCache = (contactsCache || []).filter(function (x) { return x.id !== id; });
            loadContacts();
            loadDashboard(true);
          }).catch(function (err) {
            el.disabled = false;
            alert(err.message);
          });
        });
      });
    }).catch(function (err) {
      $('#contactRows').innerHTML = '<tr><td colspan="8">' + esc(err.message) + '</td></tr>';
    });
  }


  function loadTrash() {
    setExportReady('Trash',false);
    $('#trashRows').innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    Promise.all([
      rest('enquiries','select=*&deleted_at=not.is.null&order=deleted_at.desc',{method:'GET'}),
      rest('applications','select=*&deleted_at=not.is.null&cv_uploaded=eq.true&order=deleted_at.desc',{method:'GET'}),
      rest('contact_messages','select=*&deleted_at=not.is.null&order=deleted_at.desc',{method:'GET'})
    ]).then(function (sets) {
      var rows = [];
      (sets[0] || []).forEach(function (x) { rows.push({table:'enquiries',type:'Enquiry',item:x}); });
      (sets[1] || []).forEach(function (x) { rows.push({table:'applications',type:'Application',item:x}); });
      (sets[2] || []).forEach(function (x) { rows.push({table:'contact_messages',type:'Contact Message',item:x}); });
      rows.sort(function (a,b) { return new Date(b.item.deleted_at) - new Date(a.item.deleted_at); });
      trashCache = rows;
      var visible = pageRows(rows,'trash',loadTrash);
      setExportReady('Trash',true);
      $('#trashRows').innerHTML = visible.length ? visible.map(function (r) {
        var x = r.item;
        var detail = r.type === 'Application' ? x.trade : (x.company || x.trade || x.email || '—');
        return '<tr data-trash-row="' + r.table + '|' + x.id + '"><td>' + fmt(x.deleted_at) + '</td><td>' + esc(r.type) + '</td><td><strong>' + esc(x.name) + '</strong></td><td>' + esc(detail) + '</td><td><div class="row-actions"><button class="link-btn" type="button" data-trash-pdf="' + r.table + '|' + x.id + '">PDF</button><button class="link-btn" type="button" data-trash-restore="' + r.table + '|' + x.id + '">Restore</button><button class="link-btn danger" type="button" data-trash-delete="' + r.table + '|' + x.id + '">Delete permanently</button></div></td></tr>';
      }).join('') : '<tr><td colspan="5">Trash is empty.</td></tr>';

      all('[data-trash-pdf]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var parts = btn.getAttribute('data-trash-pdf').split('|');
          var entry = (trashCache || []).find(function (r) { return r.table === parts[0] && r.item.id === parts[1]; });
          if (!entry) return;
          var sections = entry.type === 'Enquiry' ? enquirySections([entry.item]) : entry.type === 'Application' ? applicationSections([entry.item]) : contactSections([entry.item]);
          downloadTextPdf('PRTC-Trash-' + entry.type.replace(/\s+/g,'-') + '-' + (entry.item.name || 'Record').replace(/[^a-z0-9]+/gi,'-') + '.pdf','PRTC Group - ' + entry.type,sections);
        });
      });

      all('[data-trash-restore]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var parts = btn.getAttribute('data-trash-restore').split('|');
          btn.disabled = true;
          rest(parts[0],'id=eq.' + encodeURIComponent(parts[1]),{method:'PATCH',body:JSON.stringify({deleted_at:null})}).then(function () {
            trashCache = (trashCache || []).filter(function (r) { return !(r.table === parts[0] && r.item.id === parts[1]); });
            invalidateTableCache(parts[0]);
            var row = btn.closest('tr');
            if (row) row.remove();
            if (!trashCache.length) $('#trashRows').innerHTML = '<tr><td colspan="5">Trash is empty.</td></tr>';
            loadDashboard(true);
          }).catch(function (err) { btn.disabled = false; alert(err.message); });
        });
      });

      all('[data-trash-delete]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var parts = btn.getAttribute('data-trash-delete').split('|');
          var entry = (trashCache || []).find(function (r) { return r.table === parts[0] && r.item.id === parts[1]; });
          if (!entry || !confirm('Permanently delete ' + entry.item.name + '? This cannot be undone.')) return;

          var cvDelete = Promise.resolve();
          if (parts[0] === 'applications' && entry.item.cv_path) {
            var path = entry.item.cv_path.split('/').map(encodeURIComponent).join('/');
            cvDelete = api('/storage/v1/object/cv-private/' + path,{method:'DELETE'}).then(function () {}).catch(function () {});
          }

          btn.disabled = true;
          Promise.all([
            rest(parts[0],'id=eq.' + encodeURIComponent(parts[1]),{method:'DELETE'}),
            cvDelete
          ]).then(function () {
            trashCache = (trashCache || []).filter(function (r) { return !(r.table === parts[0] && r.item.id === parts[1]); });
            var row = btn.closest('tr');
            if (row) row.remove();
            if (!trashCache.length) $('#trashRows').innerHTML = '<tr><td colspan="5">Trash is empty.</td></tr>';
            loadDashboard(true);
          }).catch(function (err) { btn.disabled = false; alert(err.message); });
        });
      });
    }).catch(function (err) {
      $('#trashRows').innerHTML = '<tr><td colspan="5">' + esc(err.message) + '</td></tr>';
    });
  }

  function loadAudit() {
    setExportReady('Audit',false);
    $('#auditRows').innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    rest('admin_audit_log','select=*&order=created_at.desc',{method:'GET'}).then(function (rows) {
      auditCache = rows || [];
      var visible = pageRows(auditCache,'audit',loadAudit);
      setExportReady('Audit',true);
      $('#auditRows').innerHTML = visible.length ? visible.map(function (x) {
        var details = x.details && Object.keys(x.details).length ? JSON.stringify(x.details) : '—';
        return '<tr><td>' + fmt(x.created_at) + '</td><td><strong>' + esc(String(x.action || '').replace(/_/g,' ')) + '</strong></td><td>' + esc(x.entity_type || '—') + '</td><td><span class="muted">' + esc(x.entity_id || '—') + '</span></td><td>' + esc(details) + '</td></tr>';
      }).join('') : '<tr><td colspan="5">No admin actions recorded yet.</td></tr>';
    }).catch(function (err) {
      $('#auditRows').innerHTML = '<tr><td colspan="5">' + esc(err.message) + '</td></tr>';
    });
  }

  function invalidateTableCache(table) {
    if (table === 'enquiries') enquiriesCache = null;
    if (table === 'applications') applicationsCache = null;
    if (table === 'contact_messages') contactsCache = null;
  }

  function updateStatus(table,id,status) {
    rest(table,'id=eq.' + encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:status})}).then(function () {
      var cache = table === 'enquiries' ? enquiriesCache : table === 'applications' ? applicationsCache : contactsCache;
      (cache || []).forEach(function (x) { if (x.id === id) x.status = status; });
      loadDashboard(true);
    }).catch(function (err) {
      invalidateTableCache(table);
      if (table === 'enquiries') loadEnquiries();
      if (table === 'applications') loadApplications();
      if (table === 'contact_messages') loadContacts();
      alert(err.message);
    });
  }

  function showDetail(item,type) {
    if (!item) return;
    currentDetailItem = item;
    currentDetailType = type;

    var labels = {
      name:'Name',
      company:'Company',
      email:'Email',
      phone:'Phone / WhatsApp',
      project_location:'Project Location',
      trade:'Required Trade / Service',
      workers:'Workers Required',
      duration:'Contract Duration',
      message:'Additional Information',
      status:'Status',
      created_at:'Submitted',
      updated_at:'Last Updated',
      nationality:'Nationality',
      location:'Current Location',
      experience:'Years of Experience',
      employment_status:'Employment Status',
      cv_original_name:'CV / Résumé'
    };

    var order = type === 'Enquiry'
      ? ['name','company','email','phone','project_location','trade','workers','duration','message','status','created_at','updated_at']
      : type === 'Contact Message'
        ? ['name','company','email','phone','project_location','trade','workers','duration','message','status','created_at','updated_at']
        : ['name','email','phone','nationality','location','trade','experience','employment_status','message','status','cv_original_name','created_at','updated_at'];

    var rows = order.filter(function (key) {
      return Object.prototype.hasOwnProperty.call(item,key);
    }).map(function (key) {
      var value = item[key];
      if (key === 'created_at' || key === 'updated_at') value = fmt(value);
      if (value == null || value === '') value = '—';

      var valueClass = key === 'status' ? ' detail-status' : '';
      return '<div class="detail-row"><dt>' + esc(labels[key] || key) + '</dt><dd class="' + valueClass.trim() + '">' + esc(value) + '</dd></div>';
    }).join('');

    $('#dialogContent').innerHTML =
      '<div class="detail-head"><div><p class="kicker">' + esc(type) + '</p><h2>' + esc(item.name) + '</h2></div>' +
      (item.status ? '<span class="detail-status-badge">' + esc(item.status) + '</span>' : '') +
      '</div><dl class="detail-grid">' + rows + '</dl>';

    $('#detailDialog').showModal();
  }
  $('#dialogClose').addEventListener('click', function () { $('#detailDialog').close(); });
  $('#detailDialog').addEventListener('click', function (e) { if (e.target === $('#detailDialog')) $('#detailDialog').close(); });

  function downloadCv(app) {
    if (!app || !app.cv_path) return;
    var path = app.cv_path.split('/').map(encodeURIComponent).join('/');
    api('/storage/v1/object/authenticated/cv-private/' + path,{method:'GET'}).then(function (res) {
      if (!res.ok) throw new Error('Could not download CV.');
      return res.blob();
    }).then(function (blob) {
      var url = window.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = app.cv_original_name || 'CV';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { window.URL.revokeObjectURL(url); },1000);
    }).catch(function (err) {
      alert(err.message);
    });
  }

  function loadClients() {
    setExportReady('Clients',false);
    if (!clientsCache) $('#clientRows').innerHTML = '<div class="empty">Loading…</div>';
    var source = clientsCache ? Promise.resolve(clientsCache) : rest('clients','select=*&order=display_order.asc,name.asc',{method:'GET'});
    source.then(function (data) {
      clients = data || [];
      clientsCache = clients;
      var visible = pageRows(getFilteredClients(clients),'client',loadClients);
      setExportReady('Clients',true);
      $('#clientRows').innerHTML = visible.length ? visible.map(function (x) {
        return '<div class="client-item"><img src="' + esc(x.logo_path) + '" alt=""><div class="client-meta"><strong>' + esc(x.name) + '</strong><span>Order ' + x.display_order + ' · ' + (x.enabled ? 'Enabled' : 'Hidden') + '</span></div><div class="client-actions"><button class="secondary" type="button" data-edit-client="' + x.id + '">Edit</button><button class="link-btn" type="button" data-client-pdf="' + x.id + '">PDF</button><button class="link-btn danger" type="button" data-delete-client="' + x.id + '">Delete</button></div></div>';
      }).join('') : '<div class="empty">No clients.</div>';

      all('[data-edit-client]').forEach(function (btn) {
        btn.addEventListener('click', function () { editClient(btn.getAttribute('data-edit-client')); });
      });
      all('[data-client-pdf]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-client-pdf');
          var item = clients.filter(function (x) { return x.id === id; })[0];
          if (!item) return;
          downloadTextPdf('PRTC-Client-' + (item.name || 'Client').replace(/[^a-z0-9]+/gi,'-') + '.pdf','PRTC Group - Client',[{heading:item.name,lines:['Display Order: ' + item.display_order,'Website Status: ' + (item.enabled ? 'Enabled' : 'Hidden'),'Logo: ' + item.logo_path]}]);
        });
      });
      all('[data-delete-client]').forEach(function (btn) {
        btn.addEventListener('click', function () { deleteClient(btn.getAttribute('data-delete-client')); });
      });
    }).catch(function (err) {
      $('#clientRows').innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
    });
  }

  function editClient(id) {
    var item = clients.filter(function (x) { return x.id === id; })[0];
    if (!item) return;
    $('#clientId').value = item.id;
    $('#clientName').value = item.name;
    $('#clientOrder').value = item.display_order;
    $('#clientEnabled').checked = item.enabled;
    $('#clientFormTitle').textContent = 'Edit client';
    $('#clientCancel').hidden = false;
    $('#clientStatus').textContent = '';
  }

  function resetClientForm() {
    $('#clientId').value = '';
    $('#clientName').value = '';
    $('#clientOrder').value = '0';
    $('#clientEnabled').checked = true;
    $('#clientLogo').value = '';
    $('#clientFormTitle').textContent = 'Add client';
    $('#clientCancel').hidden = true;
    $('#clientStatus').textContent = '';
  }

  $('#clientCancel').addEventListener('click', resetClientForm);

  $('#clientSave').addEventListener('click', function () {
    var status = $('#clientStatus');
    var id = $('#clientId').value;
    var name = $('#clientName').value.trim();
    var order = Number($('#clientOrder').value) || 0;
    var enabled = $('#clientEnabled').checked;
    var file = $('#clientLogo').files && $('#clientLogo').files[0];
    var current = id ? clients.filter(function (x) { return x.id === id; })[0] : null;
    var logoPath = current ? current.logo_path : '';

    status.className = 'status';
    status.textContent = 'Saving…';

    if (!name) {
      status.textContent = 'Enter a company name.';
      status.className = 'status is-error';
      return;
    }
    if (!id && !file) {
      status.textContent = 'Please choose a logo.';
      status.className = 'status is-error';
      return;
    }
    if (file && file.size > 5 * 1024 * 1024) {
      status.textContent = 'Logo must be 5 MB or smaller.';
      status.className = 'status is-error';
      return;
    }

    function saveRecord() {
      var payload = {name:name,display_order:order,enabled:enabled,logo_path:logoPath};
      var p = id
        ? rest('clients','id=eq.' + encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(payload)})
        : rest('clients','',{method:'POST',body:JSON.stringify(payload)});
      return p.then(function () {
        status.textContent = 'Saved.';
        resetClientForm();
        clientsCache = null;
        loadClients();
      });
    }

    if (!file) {
      saveRecord().catch(function (err) {
        status.textContent = err.message;
        status.className = 'status is-error';
      });
      return;
    }

    var ext = (file.name.split('.').pop() || 'png').toLowerCase();
    var objectPath = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + '.' + ext;
    api('/storage/v1/object/client-logos/' + encodeURIComponent(objectPath),{
      method:'POST',
      headers:{'Content-Type':file.type,'x-upsert':'false'},
      body:file
    }).then(function (res) {
      if (!res.ok) throw new Error('Logo upload failed.');
      logoPath = SUPABASE_URL + '/storage/v1/object/public/client-logos/' + encodeURIComponent(objectPath);
      return saveRecord();
    }).catch(function (err) {
      status.textContent = err.message;
      status.className = 'status is-error';
    });
  });

  function deleteClient(id) {
    var item = clients.filter(function (x) { return x.id === id; })[0];
    if (!item || !confirm('Delete ' + item.name + '?')) return;
    rest('clients','id=eq.' + encodeURIComponent(id),{method:'DELETE'}).then(function () {
      clientsCache = null;
      loadClients();
    }).catch(function (err) {
      alert(err.message);
    });
  }




  function bulkStatus(table,prefix,selector) {
    var ids = selectedIds(selector);
    var statusEl = $('#' + prefix + 'BulkStatus');
    var status = statusEl ? statusEl.value : '';
    if (!ids.length || !status) return;
    Promise.all(ids.map(function (id) {
      return rest(table,'id=eq.' + encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:status})});
    })).then(function () {
      var cache = table === 'enquiries' ? enquiriesCache : table === 'applications' ? applicationsCache : contactsCache;
      (cache || []).forEach(function (x) { if (ids.indexOf(x.id) >= 0) x.status = status; });
      if (prefix === 'enquiry') loadEnquiries();
      if (prefix === 'application') loadApplications();
      if (prefix === 'contact') loadContacts();
      loadDashboard(true);
    }).catch(function (err) { alert(err.message); });
  }

  function bulkTrash(table,prefix,selector) {
    var ids = selectedIds(selector);
    if (!ids.length || !confirm('Move ' + ids.length + ' selected item(s) to Trash?')) return;
    var deletedAt = new Date().toISOString();
    Promise.all(ids.map(function (id) {
      return rest(table,'id=eq.' + encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({deleted_at:deletedAt})});
    })).then(function () {
      if (table === 'enquiries') enquiriesCache = (enquiriesCache || []).filter(function (x) { return ids.indexOf(x.id) < 0; });
      if (table === 'applications') applicationsCache = (applicationsCache || []).filter(function (x) { return ids.indexOf(x.id) < 0; });
      if (table === 'contact_messages') contactsCache = (contactsCache || []).filter(function (x) { return ids.indexOf(x.id) < 0; });
      if (prefix === 'enquiry') loadEnquiries();
      if (prefix === 'application') loadApplications();
      if (prefix === 'contact') loadContacts();
      trashCache = null;
      loadDashboard(true);
    }).catch(function (err) { alert(err.message); });
  }

  function bindBulkSelection(prefix,selector) {
    var allBox = $('#' + prefix + 'SelectAll');
    if (allBox) allBox.addEventListener('change', function () {
      all(selector).forEach(function (el) { el.checked = allBox.checked; });
      setSelectedCount(prefix,selector);
    });
  }

  bindBulkSelection('enquiry','[data-enquiry-select]');
  bindBulkSelection('application','[data-application-select]');
  bindBulkSelection('contact','[data-contact-select]');

  $('#enquiryBulkApply').addEventListener('click', function () { bulkStatus('enquiries','enquiry','[data-enquiry-select]'); });
  $('#applicationBulkApply').addEventListener('click', function () { bulkStatus('applications','application','[data-application-select]'); });
  $('#contactBulkApply').addEventListener('click', function () { bulkStatus('contact_messages','contact','[data-contact-select]'); });
  $('#enquiryBulkTrash').addEventListener('click', function () { bulkTrash('enquiries','enquiry','[data-enquiry-select]'); });
  $('#applicationBulkTrash').addEventListener('click', function () { bulkTrash('applications','application','[data-application-select]'); });
  $('#contactBulkTrash').addEventListener('click', function () { bulkTrash('contact_messages','contact','[data-contact-select]'); });

  bindAdminFilters();

  $('#exportEnquiriesPdf').addEventListener('click', function () {
    var rows = getFilteredEnquiries(enquiriesCache || []);
    downloadTextPdf('PRTC-Enquiries.pdf','PRTC Group - Enquiries (' + rows.length + ')', enquirySections(rows));
  });

  $('#exportEnquiriesCsv').addEventListener('click', function () {
    var rows = getFilteredEnquiries(enquiriesCache || []);
    downloadCsv('PRTC-Enquiries.csv',['Submitted','Name','Company','Email','Phone','Project Location','Trade / Service','Workers','Contract Duration','Status','Message'],rows.map(function (x) {
      return [fmt(x.created_at),x.name,x.company,x.email,x.phone,x.project_location,x.trade,x.workers,x.duration,x.status,x.message];
    }));
  });

  $('#exportApplicationsPdf').addEventListener('click', function () {
    var rows = getFilteredApplications(applicationsCache || []);
    downloadTextPdf('PRTC-Applications.pdf','PRTC Group - Applications (' + rows.length + ')', applicationSections(rows));
  });

  $('#exportApplicationsCsv').addEventListener('click', function () {
    var rows = getFilteredApplications(applicationsCache || []);
    downloadCsv('PRTC-Applications.csv',['Submitted','Name','Email','Phone','Nationality','Location','Trade','Experience','Employment Status','Status','CV','Message'],rows.map(function (x) {
      return [fmt(x.created_at),x.name,x.email,x.phone,x.nationality,x.location,x.trade,x.experience,x.employment_status,x.status,x.cv_original_name,x.message];
    }));
  });

  $('#exportContactsPdf').addEventListener('click', function () {
    var rows = getFilteredContacts(contactsCache || []);
    downloadTextPdf('PRTC-Contact-Messages.pdf','PRTC Group - Contact Messages (' + rows.length + ')', contactSections(rows));
  });

  $('#exportContactsCsv').addEventListener('click', function () {
    var rows = getFilteredContacts(contactsCache || []);
    downloadCsv('PRTC-Contact-Messages.csv',['Submitted','Name','Company','Email','Phone','Project Location','Service / Requirement','Workers','Contract Duration','Status','Message'],rows.map(function (x) {
      return [fmt(x.created_at),x.name,x.company,x.email,x.phone,x.project_location,x.trade,x.workers,x.duration,x.status,x.message];
    }));
  });

  $('#exportClientsPdf').addEventListener('click', function () {
    var rows = getFilteredClients(clientsCache || clients || []);
    var sections = rows.map(function (x,i) {
      return {heading:(i+1) + '. ' + x.name, lines:[
        'Display Order: ' + x.display_order,
        'Website Status: ' + (x.enabled ? 'Enabled' : 'Hidden'),
        'Logo: ' + x.logo_path
      ]};
    });
    downloadTextPdf('PRTC-Clients.pdf','PRTC Group - Clients (' + rows.length + ')',sections);
  });

  $('#exportClientsCsv').addEventListener('click', function () {
    var rows = getFilteredClients(clientsCache || clients || []);
    downloadCsv('PRTC-Clients.csv',['Name','Display Order','Status','Logo'],rows.map(function (x) {
      return [x.name,x.display_order,x.enabled ? 'Enabled' : 'Hidden',x.logo_path];
    }));
  });

  $('#exportTrashPdf').addEventListener('click', function () {
    var sections = (trashCache || []).map(function (entry,i) {
      return {heading:(i+1) + '. ' + entry.type + ' - ' + (entry.item.name || 'Record'),lines:[
        'Deleted: ' + fmt(entry.item.deleted_at),
        'Email: ' + (entry.item.email || '-'),
        'Phone: ' + (entry.item.phone || '-'),
        'Company / Trade: ' + (entry.item.company || entry.item.trade || '-'),
        'Status: ' + (entry.item.status || '-')
      ]};
    });
    downloadTextPdf('PRTC-Trash.pdf','PRTC Group - Trash (' + sections.length + ')',sections);
  });

  $('#exportTrashCsv').addEventListener('click', function () {
    downloadCsv('PRTC-Trash.csv',['Deleted','Type','Name','Email','Phone','Company / Trade','Status'],(trashCache || []).map(function (entry) {
      return [fmt(entry.item.deleted_at),entry.type,entry.item.name,entry.item.email,entry.item.phone,entry.item.company || entry.item.trade,entry.item.status];
    }));
  });

  $('#exportAuditPdf').addEventListener('click', function () {
    var sections = (auditCache || []).map(function (x,i) {
      return {heading:(i+1) + '. ' + String(x.action || '').replace(/_/g,' '),lines:[
        'Date: ' + fmt(x.created_at),
        'Area: ' + (x.entity_type || '-'),
        'Record: ' + (x.entity_id || '-'),
        'Details: ' + (x.details ? JSON.stringify(x.details) : '-')
      ]};
    });
    downloadTextPdf('PRTC-Audit-Log.pdf','PRTC Group - Audit Log (' + sections.length + ')',sections);
  });

  $('#exportAuditCsv').addEventListener('click', function () {
    downloadCsv('PRTC-Audit-Log.csv',['Date','Action','Area','Record','Details'],(auditCache || []).map(function (x) {
      return [fmt(x.created_at),String(x.action || '').replace(/_/g,' '),x.entity_type,x.entity_id,x.details ? JSON.stringify(x.details) : ''];
    }));
  });

  $('#exportDashboardPdf').addEventListener('click', function () {
    if (!dashboardSnapshot) { loadDashboard(); return; }
    var c = dashboardSnapshot.counts || {};
    var sections = [{
      heading:'Summary',
      lines:[
        'New Enquiries: ' + (c.new_enquiries || 0),
        'Total Enquiries: ' + (c.total_enquiries || 0),
        'New Applications: ' + (c.new_applications || 0),
        'Total Applications: ' + (c.total_applications || 0),
        'New Contact Messages: ' + (c.new_contacts || 0),
        'Total Contact Messages: ' + (c.total_contacts || 0),
        'Trash: ' + (c.trash_count || 0),
        'Active Clients: ' + (c.active_clients || 0)
      ]
    }];
    downloadTextPdf('PRTC-Dashboard.pdf','PRTC Group - Admin Dashboard',sections);
  });

  $('#dialogPdf').addEventListener('click', function () {
    if (!currentDetailItem) return;
    var sections = currentDetailType === 'Enquiry'
      ? enquirySections([currentDetailItem])
      : currentDetailType === 'Contact Message'
        ? contactSections([currentDetailItem])
        : applicationSections([currentDetailItem]);
    downloadTextPdf('PRTC-' + currentDetailType + '-' + (currentDetailItem.name || 'Record').replace(/[^a-z0-9]+/gi,'-') + '.pdf','PRTC Group - ' + currentDetailType,sections);
  });

  var liveSyncTimer = null;

  function activeAdminView() {
    var active = document.querySelector('.admin-view.is-active');
    return active ? active.getAttribute('data-panel') : 'dashboard';
  }

  function syncOneTable(table) {
    if (!session || $('#adminView').hidden || document.hidden) return Promise.resolve();

    var query = table === 'clients'
      ? 'select=*&order=display_order.asc,name.asc'
      : table === 'applications'
        ? 'select=*&deleted_at=is.null&cv_uploaded=eq.true&order=created_at.desc'
        : 'select=*&deleted_at=is.null&order=created_at.desc';

    return rest(table,query,{method:'GET'}).then(function (rows) {
      rows = rows || [];
      var view = activeAdminView();

      if (table === 'enquiries') {
        if (JSON.stringify(enquiriesCache || []) !== JSON.stringify(rows)) {
          enquiriesCache = rows;
          if (view === 'enquiries') loadEnquiries();
        }
      } else if (table === 'applications') {
        if (JSON.stringify(applicationsCache || []) !== JSON.stringify(rows)) {
          applicationsCache = rows;
          if (view === 'applications') loadApplications();
        }
      } else if (table === 'contact_messages') {
        if (JSON.stringify(contactsCache || []) !== JSON.stringify(rows)) {
          contactsCache = rows;
          if (view === 'contacts') loadContacts();
        }
      } else if (table === 'clients') {
        if (JSON.stringify(clientsCache || []) !== JSON.stringify(rows)) {
          clientsCache = rows;
          clients = rows;
          if (view === 'clients') loadClients();
        }
      }
    }).catch(function () {
      // Keep the current UI untouched if a silent sync fails.
    });
  }

  var syncPromise = null;
  var realtimeConnected = false;
  function syncAllAdminData() {
    if (!session || $('#adminView').hidden || document.hidden) return Promise.resolve();
    if (syncPromise) return syncPromise;
    var table = {enquiries:'enquiries',applications:'applications',contacts:'contact_messages',clients:'clients'}[activeAdminView()];
    syncPromise = (table ? syncOneTable(table) : Promise.resolve()).then(function () {
      if (activeAdminView() === 'trash') loadTrash();
      if (activeAdminView() === 'audit') loadAudit();
      return loadDashboard(true);
    }).finally(function () { syncPromise = null; });
    return syncPromise;
  }
  var dashboardTimer = null;
  function scheduleDashboard() {
    if (dashboardTimer) clearTimeout(dashboardTimer);
    dashboardTimer = setTimeout(function () {
      if (session && !document.hidden) loadDashboard(true);
    },300);
  }
  function mergeRealtimeRow(table,eventType,newRow,oldRow) {
    var cache = table === 'enquiries' ? enquiriesCache : table === 'applications' ? applicationsCache : table === 'contact_messages' ? contactsCache : clientsCache;
    if (!cache) { scheduleDashboard(); return; }

    var id = (newRow && newRow.id) || (oldRow && oldRow.id);
    if (!id) return;

    var index = cache.findIndex(function (x) { return x.id === id; });
    var active = newRow && !newRow.deleted_at && (table !== 'applications' || newRow.cv_uploaded === true);

    if (eventType === 'DELETE' || !active) {
      if (index >= 0) cache.splice(index,1);
    } else if (index >= 0) {
      cache[index] = newRow;
    } else {
      cache.unshift(newRow);
    }

    if (table === 'clients') {
      clients = clientsCache || [];
      clients.sort(function (a,b) { return (Number(a.display_order)||0)-(Number(b.display_order)||0); });
    }

    var view = activeAdminView();
    if (table === 'enquiries' && view === 'enquiries') loadEnquiries();
    if (table === 'applications' && view === 'applications') loadApplications();
    if (table === 'contact_messages' && view === 'contacts') loadContacts();
    if (table === 'clients' && view === 'clients') loadClients();

    trashCache = null;
    auditCache = null;
    scheduleDashboard();
  }

  function startLiveSync() {
    if (!session || !session.access_token) return;
    realtimeConnected = false;
    if (liveSyncTimer) clearInterval(liveSyncTimer);
    liveSyncTimer = setInterval(function () { if (!realtimeConnected) syncAllAdminData(); },60000);
    if (!window.supabase || !window.supabase.createClient) return;

    if (realtimeClient && realtimeChannel) {
      try { realtimeClient.removeChannel(realtimeChannel); } catch (e) {}
    }

    realtimeClient = window.supabase.createClient(SUPABASE_URL,API_KEY,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      realtime:{params:{eventsPerSecond:10}}
    });
    realtimeClient.realtime.setAuth(session.access_token);

    realtimeChannel = realtimeClient.channel('prtc-admin-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'enquiries'},function (payload) {
        mergeRealtimeRow('enquiries',payload.eventType,payload.new,payload.old);
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'applications'},function (payload) {
        mergeRealtimeRow('applications',payload.eventType,payload.new,payload.old);
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'contact_messages'},function (payload) {
        mergeRealtimeRow('contact_messages',payload.eventType,payload.new,payload.old);
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'clients'},function (payload) {
        mergeRealtimeRow('clients',payload.eventType,payload.new,payload.old);
      })
      .subscribe(function (status) { realtimeConnected = status === 'SUBSCRIBED'; });


  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && session) syncAllAdminData();
  });

  window.addEventListener('storage', function (event) {
    if (event.key !== 'prtc_admin_session') return;
    session = storedSession();
    if (!session) { saveSession(null); showLogin('Signed out.'); }
    else if (realtimeClient) realtimeClient.realtime.setAuth(session.access_token);
  });
  session = storedSession();
  if (session && session.access_token && session.user) {
    // Authorize before revealing administrative content.
    $('#recentActivity').innerHTML = '<div class="empty">Checking session…</div>';
    verifyAdmin(session).then(function () {
      showShell(session);
      loadDashboard();

      startLiveSync();
    }).catch(function () {
      return refreshSession().then(function (ok) {
        if (!ok) throw new Error('Your session has expired. Please sign in again.');
        return verifyAdmin(session).then(function () {
          showShell(session);
          loadDashboard();

          startLiveSync();
        });
      });
    }).catch(function (err) {
      saveSession(null);
      showLogin(err.message || 'Please sign in again.');
    });
  }
})();

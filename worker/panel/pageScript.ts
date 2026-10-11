/**
 * The panel page's script (inlined into PANEL_PAGE with a per-response nonce). Plain ES5-style
 * JavaScript, no template literals: everything is built with textContent, never innerHTML.
 */
export const PANEL_SCRIPT = String.raw`(function(){
  try { var t = localStorage.getItem('vtp:theme'); var dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; if (dark) document.documentElement.classList.add('dark'); } catch (e) {}
  var P = '__PREFIX__/api';
  var $ = function(id){ return document.getElementById(id); };
  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function btn(text, cls, fn){ var b = el('button', 'btn sm ' + (cls || ''), text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }
  function show(id){ ['setup','login','invite','dash'].forEach(function(s){ $(s).classList.toggle('hidden', s !== id); }); $('acts').classList.toggle('hidden', id !== 'dash'); }
  function handle(r){ return r.json().catch(function(){ return {}; }).then(function(j){ if (!r.ok) { var e = new Error((j.error && j.error.message) || 'Something went wrong.'); e.status = r.status; throw e; } return j; }); }
  function api(path, opts){
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: { 'x-vtp-panel': '1' } };
    if (opts.form) init.body = opts.form;
    else if (opts.body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(P + path, init).then(handle);
  }
  var post = function(path, body){ return api(path, { method: 'POST', body: body || {} }); };
  var tz = 'America/Denver';
  var fTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  var fDay = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
  var fFull = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
  function whenEl(iso){ var d = new Date(iso); var w = el('div', 'when'); w.appendChild(el('b', null, fTime.format(d))); w.appendChild(el('span', null, fDay.format(d))); return w; }
  function place(r){ return [r.city, r.country].filter(Boolean).join(', '); }
  function bytes(n){ return n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB'; }
  function toBuf(s){ s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s); var u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }
  function toB64(buf){ var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  var canPasskey = !!(window.PublicKeyCredential && navigator.credentials);
  var inviteToken = (location.pathname.match(/\/invite\/([A-Za-z0-9_-]{20,100})$/) || [])[1] || null;

  var me = null, passwordAllowed = false;
  var state = { win: 'week', tab: 'questions', rows: [], before: null, summary: null, view: null };
  var TYPES = [['agenda','Agenda'],['minutes','Minutes'],['ordinance','Ordinance'],['resolution','Resolution'],['contract','Contract'],['bid_award','Bid award'],['staff_report','Staff report'],['budget','Budget'],['notice','Notice'],['other','Other']];
  var TYPE_OF = { agenda: 'agenda', minutes: 'minutes', ordinance: 'ordinance', resolution: 'resolution', contract: 'contract', procurement: 'bid_award', staff_report: 'staff_report', budget: 'budget', public_notice: 'notice', other: 'other' };
  var TYPE_NAME = {}; TYPES.forEach(function(t){ TYPE_NAME[t[0]] = t[1]; });

  // ------------------------------------------------------------ navigation
  var VIEWS = [['activity','Activity',true],['add','Add',false],['uploads','Uploads',false],['subs','Submissions',true],['people','People',true]];
  function buildNav(){
    var nav = $('nav'); nav.textContent = '';
    VIEWS.forEach(function(v){ if (v[2] && me.role !== 'owner') return; var b = el('button', null, v[1]); b.type = 'button'; b.dataset.v = v[0]; b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', function(){ go(v[0]); }); nav.appendChild(b); });
  }
  function go(v){
    state.view = v;
    try { sessionStorage.setItem('vtp:panel', v); } catch (e) {}
    Array.prototype.forEach.call($('nav').children, function(b){ b.setAttribute('aria-pressed', String(b.dataset.v === v)); });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function(x){ x.classList.toggle('hidden', x.id !== 'v-' + v); });
    if (v === 'activity') { loadSummary(); setTab(state.tab); }
    if (v === 'add') { $('pkNudge').classList.toggle('hidden', !(me.role === 'owner' && passwordAllowed)); loadProjects(); }
    if (v === 'uploads') loadUploads();
    if (v === 'subs') loadSubs();
    if (v === 'people') loadPeople();
  }

  // ------------------------------------------------------------ activity (owner)
  function stat(box, n, label, extra){ var c = el('div', 'card stat'); c.appendChild(el('div', 'n', n)); c.appendChild(el('div', 'l', label)); if (extra) c.appendChild(el('div', 'x', extra)); box.appendChild(c); }
  function renderStats(){
    var s = state.summary; if (!s) return; var w = s[state.win]; var box = $('stats'); box.textContent = '';
    var rated = w.up + w.down;
    stat(box, w.people.toLocaleString(), 'People', w.visits.toLocaleString() + ' page views');
    stat(box, w.questions.toLocaleString(), 'Questions', '');
    stat(box, rated ? Math.round(100 * w.up / rated) + '%' : '--', 'Helpful', rated ? w.up + ' up, ' + w.down + ' down' : 'No ratings yet');
    stat(box, w.down.toLocaleString(), 'Not helpful', 'Answers to review');
    var ol = $('topq'); ol.textContent = '';
    var top = (s.topQuestions || []).slice(0, 8);
    if (!top.length) ol.appendChild(el('li', null, 'No questions yet.'));
    top.forEach(function(t){ var li = el('li'); li.appendChild(el('span', 'c', t.n + 'x')); li.appendChild(el('span', null, t.q)); ol.appendChild(li); });
    var st = s.storage || {}; var ar = s.archive || {};
    $('foot').textContent = 'Kept permanently. Database ' + bytes(st.bytes || 0) + ' of ' + bytes(st.ceiling || 0) + '. Archive files ' + bytes(ar.bytes || 0) + ' of ' + bytes(ar.ceiling || 0) + '.' + (st.paused ? ' Logging is paused because storage is nearly full.' : '');
  }
  function item(r){
    var li = el('li', 'item'); li.appendChild(whenEl(r.at));
    var main = el('div', 'main'); var right = null;
    var meta = el('div', 'meta');
    var add = function(t, cls){ if (t) meta.appendChild(el('span', cls || null, t)); };
    if (state.tab === 'visits') {
      main.appendChild(el('div', 'path', r.path || '/'));
      add(place(r)); add(r.device); add(r.ip, 'ip'); if (r.referrer) add('from ' + r.referrer.replace(/^https?:\/\//, '').slice(0, 60));
    } else {
      main.appendChild(el('div', 'q', r.question || ''));
      if (state.tab === 'questions') { add(place(r)); add(r.ip, 'ip'); add(r.mode === 'conversation' ? 'Chat' : r.citations ? r.citations + ' sources' : (r.status || '').replace('_', ' ')); if (r.latency_ms != null) add((r.latency_ms / 1000).toFixed(1) + ' s'); }
      else { add(r.ip, 'ip'); }
      var vote = state.tab === 'feedback' ? r.vote : (r.up ? 'up' : r.down ? 'down' : null);
      if (vote) right = el('span', 'pill ' + vote, vote === 'up' ? 'Helpful' : 'Not helpful');
      if (r.answer) { li.classList.add('click'); var a = el('div', 'ans', r.answer); main.appendChild(meta); main.appendChild(a); li.addEventListener('click', function(){ li.classList.toggle('open'); }); }
    }
    if (!meta.parentNode) main.appendChild(meta);
    li.appendChild(main); li.appendChild(right || el('span'));
    return li;
  }
  function renderFeed(){ var f = $('feed'); f.textContent = ''; state.rows.forEach(function(r){ f.appendChild(item(r)); }); $('empty').classList.toggle('hidden', state.rows.length > 0); }
  function query(){
    var q = new URLSearchParams(); q.set('limit', '50'); if (state.before) q.set('before', String(state.before));
    var f = $('filter').value.trim();
    if (state.tab === 'visits') { if (f) q.set('ip', f); if ($('bots').checked) q.set('bots', '1'); }
    if (state.tab === 'questions' && f) q.set('q', f);
    return '/' + state.tab + '?' + q.toString();
  }
  function load(reset){
    if (reset) { state.rows = []; state.before = null; }
    return api(query()).then(function(j){
      var items = j.items || []; state.rows = state.rows.concat(items);
      if (items.length) state.before = items[items.length - 1].id;
      $('moreWrap').classList.toggle('hidden', items.length < 50 || state.rows.length >= 200); renderFeed();
    }).catch(authFail);
  }
  function authFail(e){ if (e && e.status === 401) boot(); }
  function setTab(t){
    state.tab = t;
    Array.prototype.forEach.call($('tabs').children, function(b){ b.setAttribute('aria-pressed', String(b.dataset.t === t)); });
    $('botsWrap').classList.toggle('hidden', t !== 'visits'); $('filter').classList.toggle('hidden', t === 'feedback');
    load(true);
  }
  var debounce;
  $('filter').addEventListener('input', function(){ clearTimeout(debounce); debounce = setTimeout(function(){ load(true); }, 300); });
  $('bots').addEventListener('change', function(){ load(true); });
  $('moreBtn').addEventListener('click', function(){ load(false); });
  $('tabs').addEventListener('click', function(e){ var b = e.target.closest('button'); if (b) setTab(b.dataset.t); });
  $('win').addEventListener('click', function(e){ var b = e.target.closest('button'); if (!b) return; state.win = b.dataset.w; Array.prototype.forEach.call($('win').children, function(x){ x.setAttribute('aria-pressed', String(x === b)); }); renderStats(); });
  function loadSummary(){ return api('/summary').then(function(s){ state.summary = s; renderStats(); }).catch(authFail); }

  // ------------------------------------------------------------ pickers
  var projects = [];
  function loadProjects(){ return api('/lookup/projects').then(function(j){ projects = j.items || []; Array.prototype.forEach.call(document.querySelectorAll('select[data-projects]'), fillProjects); }).catch(function(){}); }
  function fillProjects(sel){ var cur = sel.value; sel.textContent = ''; var o = el('option', null, 'None'); o.value = ''; sel.appendChild(o); projects.forEach(function(p){ var x = el('option', null, p.title); x.value = p.id; sel.appendChild(x); }); sel.value = cur; }
  function field(parent, label, input){ var id = 'f' + Math.random().toString(36).slice(2, 9); var l = el('label', null, label); l.htmlFor = id; input.id = id; parent.appendChild(l); parent.appendChild(input); return input; }
  function input(type, value, max){ var i = el('input'); i.type = type; if (value != null) i.value = value; if (max) i.maxLength = max; return i; }
  function select(options, value){ var s = el('select'); options.forEach(function(o){ var x = el('option', null, o[1]); x.value = o[0]; s.appendChild(x); }); if (value != null) s.value = value; return s; }
  /** Meeting picker: type a date (2026-06-09) or words; pick from the matches. */
  function meetingPicker(parent, current){
    var wrap = el('div'); var q = field(wrap, 'Meeting (optional): date or name', input('search', '', 80)); q.placeholder = '2026-06-09 or council';
    var sel = el('select'); sel.setAttribute('aria-label', 'Meeting'); var none = el('option', null, 'No meeting'); none.value = ''; sel.appendChild(none);
    if (current) { var c = el('option', null, current); c.value = current; sel.appendChild(c); sel.value = current; }
    wrap.appendChild(sel); sel.style.marginTop = '8px';
    var t;
    q.addEventListener('input', function(){ clearTimeout(t); t = setTimeout(function(){
      api('/lookup/meetings?q=' + encodeURIComponent(q.value.trim())).then(function(j){
        var keep = sel.value; sel.textContent = ''; sel.appendChild(none);
        (j.items || []).forEach(function(m){ var o = el('option', null, (m.meeting_date || '') + '  ' + m.title); o.value = m.id; sel.appendChild(o); });
        sel.value = keep; if (sel.value !== keep) sel.value = (j.items && j.items[0]) ? j.items[0].id : '';
      }).catch(function(){});
    }, 300); });
    parent.appendChild(wrap);
    return sel;
  }

  // ------------------------------------------------------------ add: files
  var queue = [];
  function titleFrom(name){ return name.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled'; }
  function addFiles(list){
    Array.prototype.forEach.call(list, function(f){
      var li = el('li', 'card file'); var head = el('div', 'filehead'); head.appendChild(el('span', 'filename', f.name + ' (' + bytes(f.size) + ')'));
      var entry = { file: f, li: li, done: false };
      head.appendChild(btn('Remove', 'ghost', function(){ queue = queue.filter(function(x){ return x !== entry; }); li.remove(); refreshActs(); }));
      li.appendChild(head);
      entry.title = field(li, 'Title', input('text', titleFrom(f.name), 300));
      var g = el('div', 'grid2'); var a = el('div'); var b = el('div'); g.appendChild(a); g.appendChild(b); li.appendChild(g);
      entry.type = field(a, 'Type', select(TYPES, 'other'));
      entry.date = field(b, 'Date', input('date', '', 10));
      entry.body = field(li, 'Body or source text (optional)', el('textarea')); entry.body.maxLength = 20000;
      entry.meeting = meetingPicker(li, null);
      var ps = el('select'); ps.setAttribute('data-projects', '1'); fillProjects(ps); entry.project = field(li, 'Project (optional)', ps);
      entry.status = el('p', 'status'); li.appendChild(entry.status);
      queue.push(entry); $('fileList').appendChild(li);
    });
    refreshActs();
  }
  function refreshActs(){ $('fileActs').classList.toggle('hidden', !queue.some(function(e){ return !e.done; })); }
  var drop = $('drop');
  ['dragenter','dragover'].forEach(function(ev){ drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave','drop'].forEach(function(ev){ drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function(e){ if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
  $('fileInput').addEventListener('change', function(){ addFiles(this.files); this.value = ''; });
  $('clearFiles').addEventListener('click', function(){ queue = []; $('fileList').textContent = ''; refreshActs(); });
  $('addAll').addEventListener('click', function(){
    var todo = queue.filter(function(e){ return !e.done; }); var b = $('addAll'); b.disabled = true;
    var next = function(i){
      if (i >= todo.length) { b.disabled = false; refreshActs(); return; }
      var e = todo[i]; e.status.className = 'status'; e.status.textContent = 'Adding...';
      var fd = new FormData(); fd.append('file', e.file); fd.append('title', e.title.value); fd.append('type', e.type.value); fd.append('date', e.date.value); fd.append('body', e.body.value); fd.append('meetingId', e.meeting.value); fd.append('projectId', e.project.value);
      api('/uploads/file', { method: 'POST', form: fd }).then(function(j){
        e.done = true; e.status.className = 'status ok'; e.status.textContent = j.status === 'queued' ? 'Added. Its title is searchable now; the full text within 5 minutes.' : j.status === 'no_text' ? 'Added. No text layer found, so it is found by title and details.' : 'Added and searchable.';
        Array.prototype.forEach.call(e.li.querySelectorAll('input,select,textarea'), function(x){ x.disabled = true; });
      }, function(x){ e.status.className = 'status bad'; e.status.textContent = x.message; if (x.status === 401) boot(); }).then(function(){ next(i + 1); });
    };
    next(0);
  });

  // ------------------------------------------------------------ add: forms
  function formSubmit(id, err, fn){
    $(id).addEventListener('submit', function(e){ e.preventDefault(); var er = $(err); er.textContent = ''; er.classList.remove('ok'); var b = $(id).querySelector('button[type=submit]'); b.disabled = true;
      fn().then(function(){ b.disabled = false; er.textContent = 'Added and searchable.'; er.classList.add('ok'); $(id).reset(); }, function(x){ b.disabled = false; er.textContent = x.message; if (x.status === 401) boot(); }); });
  }
  formSubmit('k-project', 'prErr', function(){ return post('/uploads/project', { name: $('prName').value, description: $('prDesc').value, status: $('prStatus').value, location: $('prLoc').value }).then(loadProjects); });
  formSubmit('k-note', 'noErr', function(){ return post('/uploads/note', { title: $('noTitle').value, text: $('noText').value }); });
  formSubmit('k-link', 'liErr', function(){ return post('/uploads/link', { url: $('liUrl').value, title: $('liTitle').value, description: $('liDesc').value }); });
  $('addKind').addEventListener('click', function(e){ var b = e.target.closest('button'); if (!b) return; var k = b.dataset.k;
    Array.prototype.forEach.call($('addKind').children, function(x){ x.setAttribute('aria-pressed', String(x === b)); });
    ['files','project','note','link'].forEach(function(x){ $('k-' + x).classList.toggle('hidden', x !== k); }); });

  // ------------------------------------------------------------ uploads
  var KIND = { file: 'File', project: 'Project', note: 'Note', link: 'Link' };
  var STATUS = { queued: 'Full text within 5 minutes', failed: 'Text could not be read', no_text: 'No text layer', pending: 'Saving' };
  function loadUploads(){
    return api('/uploads' + ($('mineOnly').checked ? '?mine=1' : '')).then(function(j){
      var ul = $('upList'); ul.textContent = ''; var items = j.items || [];
      items.forEach(function(u){ ul.appendChild(uploadRow(u)); });
      $('upEmpty').classList.toggle('hidden', items.length > 0);
    }).catch(authFail);
  }
  function uploadRow(u){
    var li = el('li', 'item'); li.appendChild(whenEl(u.created_at));
    var main = el('div', 'main'); main.appendChild(el('div', 'q', u.title));
    var meta = el('div', 'meta');
    [KIND[u.kind] + (u.kind === 'file' ? ', ' + (TYPE_NAME[TYPE_OF[u.doc_type]] || 'Other') : ''), u.doc_date, u.project_title ? 'Project: ' + u.project_title : null, u.account_name ? 'By ' + u.account_name : null, STATUS[u.index_status]].forEach(function(t){ if (t) meta.appendChild(el('span', null, t)); });
    main.appendChild(meta);
    var acts = el('div', 'rowacts');
    if (u.document_id) { var a = el('a', 'open', 'View'); a.href = '/documents/' + encodeURIComponent(u.document_id); a.target = '_blank'; a.rel = 'noopener'; acts.appendChild(a); }
    if (u.canEdit) {
      acts.appendChild(btn('Edit', '', function(){ editor(main, u); }));
      acts.appendChild(btn('Delete', 'danger', function(){ if (confirm('Delete this upload? It is removed from the portal.')) post('/uploads/delete', { id: u.id }).then(loadUploads, function(x){ alert(x.message); }); }));
    }
    main.appendChild(acts);
    li.appendChild(main); li.appendChild(el('span'));
    return li;
  }
  function editor(main, u){
    if (main.querySelector('.edit')) return;
    var box = el('form', 'edit');
    var title = field(box, u.kind === 'project' ? 'Name' : 'Title', input('text', u.title, 300));
    var type = null, date = null, url = null, status = null, loc = null;
    if (u.kind === 'file') { var g = el('div', 'grid2'); var a = el('div'); var b = el('div'); g.appendChild(a); g.appendChild(b); box.appendChild(g); type = field(a, 'Type', select(TYPES, TYPE_OF[u.doc_type] || 'other')); date = field(b, 'Date', input('date', u.doc_date || '', 10)); }
    if (u.kind === 'link') url = field(box, 'Web address', input('url', u.url || '', 1000));
    if (u.kind === 'project') { status = field(box, 'Status', input('text', u.status_text || '', 60)); loc = field(box, 'Location', input('text', u.location || '', 200)); }
    var body = field(box, u.kind === 'note' ? 'Note' : u.kind === 'project' ? 'Description' : 'Body or source text', el('textarea')); body.value = u.body || '';
    var meeting = u.kind === 'project' ? null : meetingPicker(box, u.meeting_id);
    var project = null;
    if (u.kind !== 'project') { var ps = el('select'); ps.setAttribute('data-projects', '1'); fillProjects(ps); ps.value = u.project_id || ''; project = field(box, 'Project', ps); }
    var err = el('p', 'err'); box.appendChild(err);
    var acts = el('div', 'rowacts'); var save = el('button', 'btn sm primary', 'Save'); save.type = 'submit'; acts.appendChild(save); acts.appendChild(btn('Cancel', 'ghost', function(){ box.remove(); })); box.appendChild(acts);
    box.addEventListener('submit', function(e){ e.preventDefault(); save.disabled = true;
      var data = { id: u.id, title: title.value, name: title.value, body: body.value, text: body.value, description: body.value };
      if (type) data.type = type.value; if (date) data.date = date.value; if (url) data.url = url.value; if (status) data.status = status.value; if (loc) data.location = loc.value;
      if (meeting) data.meetingId = meeting.value; if (project) data.projectId = project.value;
      post('/uploads/edit', data).then(loadUploads, function(x){ save.disabled = false; err.textContent = x.message; });
    });
    main.appendChild(box);
    if (!projects.length) loadProjects();
  }
  $('mineOnly').addEventListener('change', loadUploads);

  // ------------------------------------------------------------ submissions (owner)
  var subOpen = true;
  function loadSubs(){
    api('/submissions').then(function(j){
      subOpen = !!j.open;
      $('subState').textContent = (subOpen ? 'Open to everyone.' : 'Paused. The page shows "Submissions are paused."') + ' Files ' + bytes(j.storage.used) + ' of ' + bytes(j.storage.limit) + '.';
      $('subSwitch').textContent = subOpen ? 'Pause submissions' : 'Turn submissions on';
      var ul = $('subList'); ul.textContent = ''; var items = j.items || [];
      items.forEach(function(s){
        var li = el('li', 'item'); li.appendChild(whenEl(s.created_at));
        var main = el('div', 'main'); main.appendChild(el('div', 'q', s.title));
        if (s.body) main.appendChild(el('div', 'hint', s.body));
        if (s.url) main.appendChild(el('div', 'path', s.url));
        var meta = el('div', 'meta');
        [KIND[s.kind], s.file_name ? s.file_name + ' (' + bytes(s.file_size || 0) + ')' : null, 'Person ' + s.person, s.reports ? s.reports + ' reports' : null].forEach(function(t){ if (t) meta.appendChild(el('span', null, t)); });
        main.appendChild(meta);
        var acts = el('div', 'rowacts');
        if (s.document_id && !s.hidden_at && !s.removed_at) { var a = el('a', 'open', 'View'); a.href = '/documents/' + encodeURIComponent(s.document_id); a.target = '_blank'; a.rel = 'noopener'; acts.appendChild(a); }
        if (!s.removed_at) {
          if (s.hidden_at) acts.appendChild(btn('Restore', '', function(){ post('/submissions/restore', { id: s.id }).then(loadSubs, function(x){ alert(x.message); }); }));
          else acts.appendChild(btn('Hide', '', function(){ post('/submissions/hide', { id: s.id }).then(loadSubs, function(x){ alert(x.message); }); }));
          acts.appendChild(btn('Remove', 'danger', function(){ if (confirm('Remove this item and its file for good?')) post('/submissions/remove', { id: s.id }).then(loadSubs, function(x){ alert(x.message); }); }));
        }
        main.appendChild(acts);
        li.appendChild(main);
        li.appendChild(el('span', 'pill ' + (s.removed_at ? 'down' : s.hidden_at ? 'soft' : 'up'), s.removed_at ? 'Removed' : s.hidden_at ? 'Hidden' : 'Live'));
        ul.appendChild(li);
      });
      $('subEmpty').classList.toggle('hidden', items.length > 0);
    }).catch(authFail);
    api('/submissions/log').then(function(j){
      var ul = $('subLog'); ul.textContent = ''; var items = j.items || [];
      var NAMES = { submit: 'Added', report: 'Reported', hide: 'Hidden', remove: 'Removed', restore: 'Restored', pause: 'Paused', resume: 'Turned on' };
      items.forEach(function(r){ var li = el('li', 'item'); li.appendChild(whenEl(r.at)); var main = el('div', 'main'); main.appendChild(el('div', null, (NAMES[r.action] || r.action) + (r.detail ? ': ' + r.detail : ''))); var meta = el('div', 'meta'); if (r.submission_id) meta.appendChild(el('span', 'ip', r.submission_id)); if (r.person) meta.appendChild(el('span', null, 'Person ' + r.person)); main.appendChild(meta); li.appendChild(main); li.appendChild(el('span')); ul.appendChild(li); });
      $('subLogEmpty').classList.toggle('hidden', items.length > 0);
    }).catch(authFail);
  }
  $('subSwitch').addEventListener('click', function(){ post('/submissions/switch', { open: !subOpen }).then(loadSubs, function(x){ alert(x.message); }); });

  // ------------------------------------------------------------ people (owner)
  function loadPeople(){
    api('/accounts').then(function(j){
      var ul = $('accList'); ul.textContent = '';
      (j.items || []).forEach(function(a){
        var li = el('li', 'item'); li.appendChild(whenEl(a.created_at));
        var main = el('div', 'main'); main.appendChild(el('div', 'q', a.name));
        var meta = el('div', 'meta'); [a.role === 'owner' ? 'Owner' : 'Uploader', a.passkeys + (a.passkeys === 1 ? ' passkey' : ' passkeys'), a.uploads + ' uploads'].forEach(function(t){ meta.appendChild(el('span', null, t)); }); main.appendChild(meta);
        if (a.role !== 'owner') { var acts = el('div', 'rowacts');
          if (a.disabled_at) acts.appendChild(btn('Turn on', '', function(){ post('/accounts/enable', { id: a.id }).then(loadPeople); }));
          else acts.appendChild(btn('Turn off', 'danger', function(){ if (confirm('Turn off ' + a.name + '? They are signed out at once.')) post('/accounts/disable', { id: a.id }).then(loadPeople); }));
          main.appendChild(acts); }
        li.appendChild(main); li.appendChild(el('span', 'pill ' + (a.disabled_at ? 'down' : 'up'), a.disabled_at ? 'Off' : 'On'));
        ul.appendChild(li);
      });
    }).catch(authFail);
    api('/invites').then(function(j){
      var ul = $('invList'); ul.textContent = ''; var items = j.items || [];
      items.forEach(function(v){
        var li = el('li', 'item'); li.appendChild(whenEl(v.created_at));
        var main = el('div', 'main'); main.appendChild(el('div', 'q', v.name || 'Unnamed invite'));
        var stateText = v.used_at ? 'Used by ' + (v.used_by_name || 'an uploader') : v.revoked_at ? 'Revoked' : v.expires_at < j.now ? 'Expired' : 'Open until ' + fFull.format(new Date(v.expires_at));
        var meta = el('div', 'meta'); meta.appendChild(el('span', null, stateText)); main.appendChild(meta);
        if (!v.used_at && !v.revoked_at && v.expires_at >= j.now) { var acts = el('div', 'rowacts'); acts.appendChild(btn('Revoke', 'danger', function(){ post('/invites/revoke', { id: v.id }).then(loadPeople); })); main.appendChild(acts); }
        li.appendChild(main); li.appendChild(el('span'));
        ul.appendChild(li);
      });
      $('invEmpty').classList.toggle('hidden', items.length > 0);
    }).catch(authFail);
    api('/audit').then(function(j){
      var ul = $('auditList'); ul.textContent = ''; var items = j.items || [];
      var NAMES = { add: 'Added', edit: 'Edited', delete: 'Deleted' };
      items.forEach(function(r){ var li = el('li', 'item'); li.appendChild(whenEl(r.at)); var main = el('div', 'main'); main.appendChild(el('div', null, (NAMES[r.action] || r.action) + ': ' + (r.title || ''))); var meta = el('div', 'meta'); meta.appendChild(el('span', null, 'By ' + (r.account_name || 'unknown'))); main.appendChild(meta); li.appendChild(main); li.appendChild(el('span')); ul.appendChild(li); });
      $('auditEmpty').classList.toggle('hidden', items.length > 0);
    }).catch(authFail);
  }
  $('invForm').addEventListener('submit', function(e){ e.preventDefault(); $('invErr').textContent = '';
    post('/invites/create', { name: $('invName').value }).then(function(j){ $('invLink').value = location.origin + j.path; $('invBox').classList.remove('hidden'); $('invName').value = ''; loadPeople(); }, function(x){ $('invErr').textContent = x.message; }); });
  $('invCopy').addEventListener('click', function(){ var i = $('invLink'); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(function(){ $('invCopy').textContent = 'Copied'; }, function(){ document.execCommand && document.execCommand('copy'); $('invCopy').textContent = 'Copied'; }); });

  // ------------------------------------------------------------ passkeys sheet
  function openSheet(open){ $('sheet').classList.toggle('hidden', !open); $('sheetBg').classList.toggle('hidden', !open); if (open) loadKeys(); }
  $('secBtn').addEventListener('click', function(){ openSheet(true); });
  $('sheetClose').addEventListener('click', function(){ openSheet(false); });
  $('sheetBg').addEventListener('click', function(){ openSheet(false); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') openSheet(false); });
  $('outBtn').addEventListener('click', function(){ post('/logout').then(boot, boot); });
  function loadKeys(){
    $('pwSec').classList.toggle('hidden', !(me && me.role === 'owner' && passwordAllowed));
    return api('/passkeys').then(function(j){
      var ul = $('keys'); ul.textContent = ''; var items = j.items || [];
      items.forEach(function(k){
        var li = el('li'); var t = el('div', null, k.name || 'Passkey'); t.appendChild(el('small', null, 'Added ' + fFull.format(new Date(k.created_at)) + (k.last_used_at ? ', last used ' + fFull.format(new Date(k.last_used_at)) : '')));
        li.appendChild(t);
        if (items.length > 1) li.appendChild(btn('Remove', 'ghost', function(){ if (confirm('Remove this passkey?')) post('/passkey/delete', { id: k.id }).then(loadKeys, function(x){ $('pkErr').textContent = x.message; }); }));
        ul.appendChild(li);
      });
      if (!items.length) ul.appendChild(el('li', null, 'No passkeys yet.'));
      $('pkAdd').classList.toggle('hidden', !canPasskey);
    }).catch(authFail);
  }
  function deviceName(){ var ua = navigator.userAgent; return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'This device'; }
  function createCredential(o, name){
    return navigator.credentials.create({ publicKey: { challenge: toBuf(o.challenge), rp: { name: 'Vineyard Transparency Portal', id: o.rpId }, user: { id: toBuf(o.userId), name: name, displayName: name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, attestation: 'none', timeout: 60000,
      excludeCredentials: (o.exclude || []).map(function(id){ return { type: 'public-key', id: toBuf(id) }; }) } }).then(function(c){
      var r = c.response; var pk = r.getPublicKey && r.getPublicKey();
      if (!pk || !r.getAuthenticatorData) throw new Error('This browser cannot add a passkey. Try Safari or Chrome.');
      return { id: c.id, clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.getAuthenticatorData()), publicKey: toB64(pk), alg: r.getPublicKeyAlgorithm(), name: deviceName() };
    });
  }
  function pkError(e, fallback){ return e && e.name === 'NotAllowedError' ? 'Cancelled.' : e && e.name === 'InvalidStateError' ? 'This device already has a passkey here.' : (e && e.message) || fallback; }
  $('pkAdd').addEventListener('click', function(){
    $('pkErr').textContent = ''; $('pkErr').classList.remove('ok');
    post('/passkey/register/options').then(function(o){ return createCredential(o, o.email); }).then(function(cred){ return post('/passkey/register', cred); })
      .then(function(j){ passwordAllowed = !!j.passwordAllowed; $('pkErr').textContent = 'Passkey added.'; $('pkErr').classList.add('ok'); $('pkNudge').classList.add('hidden'); loadKeys(); })
      .catch(function(e){ $('pkErr').textContent = pkError(e, 'Could not add the passkey.'); });
  });
  $('pkLogin').addEventListener('click', function(){
    $('lErr').textContent = '';
    post('/passkey/login/options').then(function(o){
      return navigator.credentials.get({ publicKey: { challenge: toBuf(o.challenge), rpId: o.rpId, userVerification: 'required', timeout: 60000 } });
    }).then(function(c){
      var r = c.response;
      return post('/passkey/login', { id: c.id, clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature) });
    }).then(boot).catch(function(e){ $('lErr').textContent = pkError(e, 'Passkey sign-in failed.'); });
  });

  // ------------------------------------------------------------ setup, password, invite
  function submit(form, err, fn){
    $(form).addEventListener('submit', function(e){ e.preventDefault(); $(err).textContent = ''; $(err).classList.remove('ok'); var b = $(form).querySelector('button[type=submit]'); b.disabled = true;
      fn().then(function(){ b.disabled = false; }, function(x){ b.disabled = false; $(err).textContent = pkError(x, 'Something went wrong.'); }); });
  }
  submit('setupForm', 'sErr', function(){ return post('/setup', { code: $('sCode').value, email: $('sEmail').value, password: $('sPass').value }).then(function(){ return boot().then(function(){ openSheet(true); }); }); });
  submit('loginForm', 'lErr', function(){ return post('/login', { email: $('lEmail').value, password: $('lPass').value }).then(function(){ $('lPass').value = ''; return boot(); }); });
  submit('pwForm', 'pErr', function(){ return post('/password', { current: $('pCur').value, next: $('pNew').value }).then(function(){ $('pCur').value = ''; $('pNew').value = ''; $('pErr').textContent = 'Saved. Other sessions were signed out.'; $('pErr').classList.add('ok'); }); });
  submit('inviteForm', 'iErr', function(){
    if (!canPasskey) return Promise.reject(new Error('This browser cannot create a passkey. Try Safari or Chrome.'));
    var name = $('iName').value.trim();
    return post('/invite/options', { token: inviteToken }).then(function(o){ return createCredential(o, name); })
      .then(function(cred){ cred.token = inviteToken; cred.name = name; return post('/invite/accept', cred); })
      .then(function(){ history.replaceState(null, '', '__PREFIX__'); inviteToken = null; return boot(); });
  });

  function boot(){
    if (inviteToken) {
      show('invite');
      return post('/invite/check', { token: inviteToken }).then(function(j){ if (j.name && !$('iName').value) $('iName').value = j.name; }, function(x){ $('iErr').textContent = x.message; $('iBtn').disabled = true; });
    }
    return api('/state').then(function(s){
      if (!s.hasOwner) return show('setup');
      passwordAllowed = !!s.passwordAllowed;
      if (!s.signedIn) {
        show('login');
        var pk = canPasskey && s.hasPasskeys;
        $('pkLogin').classList.toggle('hidden', !pk);
        $('noPk').classList.toggle('hidden', canPasskey || passwordAllowed);
        $('loginForm').classList.toggle('hidden', !passwordAllowed);
        $('orLine').classList.toggle('hidden', !(pk && passwordAllowed));
        $('lBtn').classList.toggle('primary', !pk);
        return;
      }
      me = s.account; $('who').textContent = me.name;
      show('dash'); buildNav();
      var saved = null; try { saved = sessionStorage.getItem('vtp:panel'); } catch (e) {}
      var allowed = VIEWS.filter(function(v){ return !v[2] || me.role === 'owner'; }).map(function(v){ return v[0]; });
      go(allowed.indexOf(saved) >= 0 ? saved : allowed[0]);
      if (me.role === 'owner' && passwordAllowed) openSheet(true);
    });
  }
  boot();
})();`;

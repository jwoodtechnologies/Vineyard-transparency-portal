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
  // Who sees each tab: 'all' accounts, 'staff' (the owner and admins) or the 'owner' alone.
  var VIEWS = [['activity','Activity','staff'],['add','Add','all'],['updates','Updates','staff'],['uploads','Uploads','all'],['subs','Submissions','staff'],['people','People','owner'],['coverage','Coverage','staff'],['health','Health','staff']];
  function isOwner(){ return !!me && me.role === 'owner'; }
  function isStaff(){ return !!me && (me.role === 'owner' || me.role === 'admin'); }
  function mayView(v){ return v[2] === 'all' || (v[2] === 'staff' ? isStaff() : isOwner()); }
  function buildNav(){
    var nav = $('nav'); nav.textContent = '';
    VIEWS.forEach(function(v){ if (!mayView(v)) return; var b = el('button', null, v[1]); b.type = 'button'; b.dataset.v = v[0]; b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', function(){ go(v[0]); }); nav.appendChild(b); });
  }
  function go(v){
    state.view = v;
    try { sessionStorage.setItem('vtp:panel', v); } catch (e) {}
    Array.prototype.forEach.call($('nav').children, function(b){ b.setAttribute('aria-pressed', String(b.dataset.v === v)); });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function(x){ x.classList.toggle('hidden', x.id !== 'v-' + v); });
    if (v === 'activity') { loadSummary(); setTab(state.tab); }
    if (v === 'add') { loadProjects(); }
    if (v === 'updates') loadUpdates();
    if (v === 'uploads') loadUploads();
    if (v === 'subs') loadSubs();
    if (v === 'people') loadPeople();
    if (v === 'coverage') loadCoverage();
    if (v === 'health') loadHealth();
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
    renderAi(s.ai);
    var st = s.storage || {}; var ar = s.archive || {};
    $('foot').textContent = 'Kept permanently. Database ' + bytes(st.bytes || 0) + ' of ' + bytes(st.ceiling || 0) + '. Archive files ' + bytes(ar.bytes || 0) + ' of ' + bytes(ar.ceiling || 0) + '.' + (st.paused ? ' Logging is paused because storage is nearly full.' : '');
  }
  // Today's Workers AI Neurons by spender (worker/ai/meter.ts neuronUsage), whatever window is chosen.
  function renderAi(ai){
    var card = $('aiCard'); if (!ai) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    var ol = $('aiUse'); ol.textContent = '';
    var n = function(v){ return Math.round(v).toLocaleString(); };
    [['Public', ai.public], ['Tests', ai.tests], ['Total', ai.total]].forEach(function(r){
      var li = el('li'); li.appendChild(el('span', null, r[0])); li.appendChild(el('span', 'v', n(r[1].used) + ' of ' + n(r[1].cap) + (r[1].used >= r[1].cap ? ', cap reached' : ''))); ol.appendChild(li);
    });
    $('aiReset').textContent = 'Resets at ' + ai.resetsAtMountain + ' (00:00 UTC). Daily allowance ' + n(ai.total.allowance) + '.';
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

  // ------------------------------------------------------------ add: files (one or many)
  // Shared details (type, date, text, meeting, project) apply to every file; each file has its own title.
  // Files go up one at a time, each with its own status; failed ones can be retried.
  var MAX_FILE = 25 * 1024 * 1024, MAX_TEXT = 1024 * 1024;
  var queue = [];
  var shared = null;
  function titleFrom(name){ return name.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled'; }
  function sharedFields(){
    if (shared) return shared;
    var box = $('bulkShared'); shared = {};
    var g = el('div', 'grid2'); var a = el('div'); var b = el('div'); g.appendChild(a); g.appendChild(b); box.appendChild(g);
    shared.type = field(a, 'Type', select(TYPES, 'other'));
    shared.date = field(b, 'Date', input('date', '', 10));
    shared.body = field(box, 'Body or source text (optional)', el('textarea')); shared.body.maxLength = 20000; shared.body.rows = 2;
    shared.meeting = meetingPicker(box, null);
    var ps = el('select'); ps.setAttribute('data-projects', '1'); fillProjects(ps); shared.project = field(box, 'Project (optional)', ps);
    return shared;
  }
  function fileProblem(f){
    var ext = (f.name.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1]; ext = ext ? ext.toLowerCase() : '';
    if (['pdf','png','jpg','jpeg','txt','csv'].indexOf(ext) < 0) return 'Only PDF, PNG, JPG, TXT or CSV files.';
    if (f.size <= 0) return 'That file is empty.';
    if (f.size > MAX_FILE) return 'Too big. Files can be up to 25 MB.';
    if ((ext === 'txt' || ext === 'csv') && f.size > MAX_TEXT) return 'Text and CSV files can be up to 1 MB.';
    return null;
  }
  function setStatus(e, kind, text){ e.state = kind; e.status.className = 'status' + (kind === 'done' ? ' ok' : kind === 'failed' || kind === 'skipped' ? ' bad' : ''); e.status.textContent = text; }
  function addFiles(list){
    sharedFields(); $('bulkShared').classList.remove('hidden');
    Array.prototype.forEach.call(list, function(f){
      var li = el('li', 'card file'); var head = el('div', 'filehead'); head.appendChild(el('span', 'filename', f.name + ' (' + bytes(f.size) + ')'));
      var entry = { file: f, li: li, state: 'waiting' };
      entry.remove = btn('Remove', 'ghost', function(){ queue = queue.filter(function(x){ return x !== entry; }); li.remove(); refreshActs(); });
      head.appendChild(entry.remove);
      li.appendChild(head);
      entry.title = field(li, 'Title', input('text', titleFrom(f.name), 300));
      entry.status = el('p', 'status'); li.appendChild(entry.status);
      var problem = fileProblem(f);
      if (problem) setStatus(entry, 'skipped', problem); else setStatus(entry, 'waiting', 'Ready');
      queue.push(entry); $('fileList').appendChild(li);
    });
    refreshActs();
  }
  function counts(){ var c = { waiting: 0, adding: 0, done: 0, failed: 0, skipped: 0 }; queue.forEach(function(e){ c[e.state]++; }); return c; }
  function refreshActs(){
    var c = counts(); var busy = c.adding > 0 || adding;
    $('fileActs').classList.toggle('hidden', !queue.length);
    $('bulkShared').classList.toggle('hidden', !queue.length);
    $('addAll').classList.toggle('hidden', !c.waiting); $('addAll').disabled = busy;
    $('addAll').textContent = c.waiting === 1 ? 'Add 1 file' : 'Add ' + c.waiting + ' files';
    $('retryFailed').classList.toggle('hidden', !c.failed || busy); $('retryFailed').textContent = c.failed === 1 ? 'Retry 1 failed' : 'Retry ' + c.failed + ' failed';
    $('clearFiles').disabled = busy;
    var total = queue.length, finished = c.done + c.failed + c.skipped;
    var parts = [total === 1 ? '1 file' : total + ' files'];
    if (c.done) parts.push(c.done + ' added'); if (c.failed) parts.push(c.failed + ' failed'); if (c.skipped) parts.push(c.skipped + ' skipped');
    $('bulkCount').textContent = total ? parts.join(', ') + '.' : '';
    $('bulkBar').classList.toggle('hidden', !total || (!busy && !finished));
    $('bulkFill').style.width = (total ? Math.round(100 * finished / total) : 0) + '%';
  }
  var adding = false;
  function run(todo){
    if (!todo.length) return;
    adding = true; var s = sharedFields(); refreshActs();
    var stop = null;
    var next = function(i){
      if (i >= todo.length) { adding = false; refreshActs(); if (counts().done && !counts().waiting && !counts().failed) loadProjects(); return; }
      var e = todo[i];
      if (stop) { setStatus(e, 'failed', stop); return next(i + 1); }
      setStatus(e, 'adding', 'Adding...'); refreshActs();
      var fd = new FormData(); fd.append('file', e.file); fd.append('title', e.title.value); fd.append('type', s.type.value); fd.append('date', s.date.value); fd.append('body', s.body.value); fd.append('meetingId', s.meeting.value); fd.append('projectId', s.project.value);
      api('/uploads/file', { method: 'POST', form: fd }).then(function(j){
        setStatus(e, 'done', j.status === 'queued' ? 'Added. Title searchable now, full text within 5 minutes.' : j.status === 'no_text' ? 'Added. No text layer, so it is found by title and details.' : 'Added and searchable.');
        e.title.disabled = true; e.remove.classList.add('hidden');
      }, function(x){
        setStatus(e, 'failed', x.message);
        if (x.status === 401) { stop = 'Not added. Sign in again, then retry.'; boot(); }
        if (x.status === 507) stop = 'Not added. The archive is full.';
      }).then(function(){ next(i + 1); });
    };
    next(0);
  }
  var drop = $('drop');
  ['dragenter','dragover'].forEach(function(ev){ drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave','drop'].forEach(function(ev){ drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function(e){ if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
  $('fileInput').addEventListener('change', function(){ addFiles(this.files); this.value = ''; });
  $('clearFiles').addEventListener('click', function(){ queue = []; $('fileList').textContent = ''; refreshActs(); });
  $('addAll').addEventListener('click', function(){ run(queue.filter(function(e){ return e.state === 'waiting'; })); });
  $('retryFailed').addEventListener('click', function(){ var todo = queue.filter(function(e){ return e.state === 'failed'; }); todo.forEach(function(e){ setStatus(e, 'waiting', 'Ready'); }); run(todo); });

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

  // ------------------------------------------------------------ updates (owner and admins)
  // Plain text that goes straight into the records: searchable, used by chat, shown on Records and on a project's card.
  var upd = { projects: [], topics: [], today: '' };
  function topicSelect(sel, value){
    sel.textContent = ''; var none = el('option', null, 'None'); none.value = ''; sel.appendChild(none);
    var g1 = el('optgroup'); g1.label = 'Funded projects'; upd.projects.forEach(function(p){ var o = el('option', null, p.name); o.value = 'project:' + p.key; g1.appendChild(o); });
    var g2 = el('optgroup'); g2.label = 'Topics'; upd.topics.forEach(function(t){ var o = el('option', null, t.label); o.value = 'topic:' + t.id; g2.appendChild(o); });
    if (upd.projects.length) sel.appendChild(g1); if (upd.topics.length) sel.appendChild(g2);
    sel.value = value || '';
  }
  function shortDay(iso){ return iso ? fFull.format(new Date(iso + 'T12:00:00Z')) : ''; }
  function histText(h){
    var who = h.by ? ' by ' + h.by : '';
    var when = fFull.format(new Date(h.at)) + ', ' + fTime.format(new Date(h.at));
    var p = el('p'); p.appendChild(el('b', null, (h.action === 'add' ? 'Published' : h.action === 'edit' ? 'Edited' : 'Removed') + who + ', ' + when + '.'));
    if (h.before) p.appendChild(document.createTextNode(' Before: ' + [h.before.title, shortDay(h.before.date), h.before.topic].filter(Boolean).join(', ') + '. ' + (h.before.text || '')));
    return p;
  }
  function updEditor(main, u){
    if (main.querySelector('.edit')) return;
    var box = el('form', 'edit');
    var title = field(box, 'Title', input('text', u.title, 200));
    var text = field(box, 'Text', el('textarea')); text.value = u.body || ''; text.maxLength = 20000; text.required = true;
    var g = el('div', 'grid2'); var a = el('div'); var b = el('div'); g.appendChild(a); g.appendChild(b); box.appendChild(g);
    var date = field(a, 'Date', input('date', u.doc_date || '', 10));
    var topic = field(b, 'Project or topic', el('select')); topicSelect(topic, u.topic);
    var err = el('p', 'err'); box.appendChild(err);
    var acts = el('div', 'rowacts'); var save = el('button', 'btn sm primary', 'Save'); save.type = 'submit'; acts.appendChild(save); acts.appendChild(btn('Cancel', 'ghost', function(){ box.remove(); })); box.appendChild(acts);
    box.addEventListener('submit', function(e){ e.preventDefault(); save.disabled = true;
      post('/updates/edit', { id: u.id, title: title.value, text: text.value, date: date.value, topic: topic.value }).then(loadUpdates, function(x){ save.disabled = false; err.textContent = x.message; if (x.status === 401) boot(); });
    });
    main.appendChild(box);
  }
  function updRow(u){
    var li = el('li', 'item'); li.appendChild(whenEl(u.created_at));
    var main = el('div', 'main'); main.appendChild(el('div', 'q', u.title));
    if (u.body) main.appendChild(el('div', 'hint pre', u.body.length > 400 ? u.body.slice(0, 400) + '...' : u.body));
    var meta = el('div', 'meta');
    var edits = u.history.filter(function(h){ return h.action === 'edit'; }).length;
    [shortDay(u.doc_date), u.topic_label, u.account_name ? 'By ' + u.account_name : null, edits ? (edits === 1 ? 'Edited once' : 'Edited ' + edits + ' times') : null].forEach(function(t){ if (t) meta.appendChild(el('span', null, t)); });
    main.appendChild(meta);
    var acts = el('div', 'rowacts');
    if (u.document_id) { var v = el('a', 'open', 'View'); v.href = '/documents/' + encodeURIComponent(u.document_id); v.target = '_blank'; v.rel = 'noopener'; acts.appendChild(v); }
    acts.appendChild(btn('Edit', '', function(){ updEditor(main, u); }));
    if (u.history.length) acts.appendChild(btn('History', 'ghost', function(){ var h = main.querySelector('.hist'); if (h) { h.remove(); return; } h = el('div', 'hist'); u.history.forEach(function(x){ h.appendChild(histText(x)); }); main.insertBefore(h, acts.nextSibling); }));
    acts.appendChild(btn('Remove', 'danger', function(){ if (confirm('Remove this update? It is taken off the portal. The log keeps its text.')) post('/updates/delete', { id: u.id }).then(loadUpdates, function(x){ alert(x.message); }); }));
    main.appendChild(acts);
    li.appendChild(main); li.appendChild(el('span', 'pill up', 'Live'));
    return li;
  }
  function loadUpdates(){
    return api('/updates').then(function(j){
      upd.projects = j.projects || []; upd.topics = j.topics || []; upd.today = j.today || '';
      var keep = $('upTopic').value; topicSelect($('upTopic'), keep);
      if (!$('upDate').value) $('upDate').value = upd.today;
      var ul = $('updList'); ul.textContent = ''; var items = j.items || [];
      items.forEach(function(u){ ul.appendChild(updRow(u)); });
      $('updEmpty').classList.toggle('hidden', items.length > 0);
      var gone = j.removed || []; var gl = $('updGone'); gl.textContent = '';
      gone.forEach(function(h){ var li = el('li', 'item'); li.appendChild(whenEl(h.at)); var m = el('div', 'main'); m.appendChild(el('div', 'q', h.title)); var d = el('div', 'hist'); d.appendChild(histText(h)); m.appendChild(d); li.appendChild(m); li.appendChild(el('span', 'pill soft', 'Removed')); gl.appendChild(li); });
      $('updGoneWrap').classList.toggle('hidden', !gone.length);
    }).catch(authFail);
  }
  $('upForm').addEventListener('submit', function(e){
    e.preventDefault(); var er = $('upErr'); er.textContent = ''; er.classList.remove('ok'); var b = $('upForm').querySelector('button[type=submit]'); b.disabled = true;
    post('/updates/create', { title: $('upTitle').value, text: $('upText').value, date: $('upDate').value, topic: $('upTopic').value }).then(function(){
      b.disabled = false; er.textContent = 'Published. Residents can see it now.'; er.classList.add('ok');
      $('upTitle').value = ''; $('upText').value = ''; $('upTopic').value = ''; $('upDate').value = upd.today; loadUpdates();
    }, function(x){ b.disabled = false; er.textContent = x.message; if (x.status === 401) boot(); });
  });

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
      $('subSwitch').classList.toggle('hidden', !isOwner());
      var pl = $('subPending'); pl.textContent = ''; var pending = j.pending || [];
      pending.forEach(function(s){
        var li = el('li', 'item'); li.appendChild(whenEl(s.created_at));
        var main = el('div', 'main'); main.appendChild(el('div', 'q', s.title));
        if (s.body) main.appendChild(el('div', 'hint pre', s.body));
        if (s.url) main.appendChild(el('div', 'path', s.url));
        if (s.status_text || s.location) main.appendChild(el('div', 'hint', [s.status_text, s.location].filter(Boolean).join(', ')));
        var meta = el('div', 'meta');
        [KIND[s.kind], s.file_name ? s.file_name + ' (' + bytes(s.file_size || 0) + ')' : null, 'Person ' + s.person].forEach(function(t){ if (t) meta.appendChild(el('span', null, t)); });
        main.appendChild(meta);
        var acts = el('div', 'rowacts');
        if (s.file_name) { var f = el('a', 'open', 'Open file'); f.href = P + '/submissions/file?id=' + encodeURIComponent(s.id); f.target = '_blank'; f.rel = 'noopener noreferrer'; acts.appendChild(f); }
        acts.appendChild(btn('Approve', 'primary', function(){ if (confirm('Add this to the portal?')) post('/submissions/approve', { id: s.id }).then(loadSubs, function(x){ alert(x.message); }); }));
        acts.appendChild(btn('Reject', 'danger', function(){ if (confirm('Reject and delete this item and its file?')) post('/submissions/reject', { id: s.id }).then(loadSubs, function(x){ alert(x.message); }); }));
        main.appendChild(acts);
        li.appendChild(main);
        li.appendChild(el('span', 'pill soft', 'Pending'));
        pl.appendChild(li);
      });
      $('subPendingEmpty').classList.toggle('hidden', pending.length > 0);
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
        if (!s.removed_at && isOwner()) {
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
      var NAMES = { submit: 'Submitted', approve: 'Approved', reject: 'Rejected', report: 'Reported', hide: 'Hidden', remove: 'Removed', restore: 'Restored', pause: 'Paused', resume: 'Turned on' };
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
        var meta = el('div', 'meta'); [a.role === 'owner' ? 'Owner' : a.role === 'admin' ? 'Admin' : 'Uploader', a.login ? 'Signs in as ' + a.login : null, a.passkeys + (a.passkeys === 1 ? ' passkey' : ' passkeys'), a.uploads + ' uploads'].forEach(function(t){ if (t) meta.appendChild(el('span', null, t)); }); main.appendChild(meta);
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
        var stateText = (v.role === 'admin' ? 'Admin. ' : 'Uploader. ') + (v.used_at ? 'Used by ' + (v.used_by_name || 'someone') : v.revoked_at ? 'Revoked' : v.expires_at < j.now ? 'Expired' : 'Open until ' + fFull.format(new Date(v.expires_at)));
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
  // New staff accounts are made in the staff portal (/staff); the panel only lists and turns off the ones it has.

  // ------------------------------------------------------------ coverage (owner)
  var cov = null, covAll = {};
  var SERIES = { ordinance: 'Ordinances', resolution: 'Resolutions', rda_resolution: 'RDA resolutions' };
  var DOCS = { agenda: 'Agenda', packet: 'Packet', minutes: 'Minutes' };
  function pad2(n){ return n < 10 ? '0' + n : String(n); }
  function nums(year, list){ return list.map(function(n){ return year + '-' + pad2(n); }).join(', '); }
  function siteLink(path, text){ var a = el('a', 'open', text); a.href = path; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function covList(id, rows, render){
    var ul = $(id); ul.textContent = '';
    var cap = covAll[id] ? rows.length : Math.min(rows.length, 200);
    rows.slice(0, cap).forEach(function(r){ ul.appendChild(render(r)); });
    $(id + 'Empty').classList.toggle('hidden', rows.length > 0);
    var more = $(id + 'More'); more.textContent = '';
    if (cap < rows.length) more.appendChild(btn('Show all ' + rows.length, '', function(){ covAll[id] = true; covList(id, rows, render); }));
  }
  function recRow(r){
    var li = el('li', 'item'); var w = el('div', 'when'); w.appendChild(el('b', null, r.year == null ? 'No year' : r.year)); li.appendChild(w);
    var main = el('div', 'main'); main.appendChild(el('div', null, r.title));
    var meta = el('div', 'meta'); [TYPE_NAME[TYPE_OF[r.type]] || r.type, r.body, r.reason].forEach(function(t){ if (t) meta.appendChild(el('span', null, t)); });
    meta.appendChild(siteLink('/documents/' + encodeURIComponent(r.id), 'Open')); main.appendChild(meta); li.appendChild(main); li.appendChild(el('span'));
    return li;
  }
  function renderCoverage(){
    var r = cov; if (!r) return;
    $('covWhen').textContent = 'Checked ' + fFull.format(new Date(r.computedAt)) + ', ' + fTime.format(new Date(r.computedAt)) + '. Rechecked once a day.' + (r.undated.length < r.counts.undated || r.noText.length < r.counts.noText ? ' Long lists show the first ' + r.listLimit + '.' : '');
    var box = $('covStats'); box.textContent = '';
    stat(box, r.counts.sequenceGaps, 'Missing numbers', r.counts.motionOnly ? r.counts.motionOnly + ' named only in a motion' : null);
    stat(box, r.counts.meetingsMissing, 'Meetings missing files');
    stat(box, r.counts.undated, 'Records with no date');
    stat(box, r.counts.noText, 'Records with no text');
    var gaps = r.gaps.filter(function(g){ return g.missing.length || g.motionOnly.length; });
    covList('covGaps', gaps, function(g){
      var li = el('li', 'item'); var w = el('div', 'when'); w.appendChild(el('b', null, g.year)); li.appendChild(w);
      var main = el('div', 'main'); main.appendChild(el('div', null, SERIES[g.series] || g.series));
      var meta = el('div', 'meta');
      if (g.missing.length) meta.appendChild(el('span', null, 'Missing: ' + nums(g.year, g.missing)));
      if (g.motionOnly.length) meta.appendChild(el('span', null, 'Named only in a motion: ' + nums(g.year, g.motionOnly)));
      meta.appendChild(el('span', null, 'Highest ' + g.year + '-' + pad2(g.highest) + ', ' + g.seen + ' seen'));
      main.appendChild(meta); li.appendChild(main); li.appendChild(el('span', 'pill soft', g.missing.length));
      return li;
    });
    var body = $('covBody').value;
    var bodies = {}; r.meetings.forEach(function(m){ var k = m.bodyName || 'No body'; bodies[k] = (bodies[k] || 0) + 1; });
    var sel = $('covBody'); sel.textContent = ''; var all = el('option', null, 'All bodies (' + r.meetings.length + ')'); all.value = ''; sel.appendChild(all);
    Object.keys(bodies).sort().forEach(function(k){ var o = el('option', null, k + ' (' + bodies[k] + ')'); o.value = k; sel.appendChild(o); });
    sel.value = bodies[body] ? body : '';
    var meetings = r.meetings.filter(function(m){ return !sel.value || (m.bodyName || 'No body') === sel.value; });
    covList('covMeet', meetings, function(m){
      var li = el('li', 'item'); var w = el('div', 'when'); w.appendChild(el('b', null, fFull.format(new Date(m.date + 'T12:00:00Z')))); li.appendChild(w);
      var main = el('div', 'main'); main.appendChild(el('div', null, m.title));
      var meta = el('div', 'meta'); if (m.bodyName) meta.appendChild(el('span', null, m.bodyName)); meta.appendChild(el('span', null, 'Missing: ' + m.missing.map(function(d){ return DOCS[d] || d; }).join(', ')));
      meta.appendChild(siteLink('/meetings/' + encodeURIComponent(m.id), 'Open')); main.appendChild(meta); li.appendChild(main); li.appendChild(el('span', 'pill soft', m.missing.length));
      return li;
    });
    covList('covUndated', r.undated, recRow);
    covList('covNoText', r.noText, recRow);
  }
  function loadCoverage(){
    $('covWhen').textContent = 'Loading...';
    api('/coverage').then(function(j){ cov = j; renderCoverage(); }).catch(function(x){ authFail(x); $('covWhen').textContent = x.message; });
  }
  // ------------------------------------------------------------ health (owner)
  function stamp(iso){ return iso ? fFull.format(new Date(iso)) + ', ' + fTime.format(new Date(iso)) : 'Never'; }
  function healthRow(r){
    var li = el('li', 'item'); var w = el('div', 'when');
    if (r.lastRunAt) { w.appendChild(el('b', null, fTime.format(new Date(r.lastRunAt)))); w.appendChild(el('span', null, fDay.format(new Date(r.lastRunAt)))); } else w.appendChild(el('b', null, 'Never'));
    li.appendChild(w);
    var main = el('div', 'main'); var title = el('div');
    var dot = el('span', 'mark' + (r.failing ? ' fail' : '')); dot.title = r.failing ? 'Failing' : 'OK'; title.appendChild(dot);
    title.appendChild(document.createTextNode(r.name + (r.kind === 'source' && r.name !== r.id ? ' (' + r.id + ')' : '')));
    main.appendChild(title);
    var meta = el('div', 'meta');
    meta.appendChild(el('span', null, 'Last run ' + stamp(r.lastRunAt)));
    meta.appendChild(el('span', null, 'Last success ' + stamp(r.lastSuccessAt)));
    if (r.status) meta.appendChild(el('span', null, 'Status ' + r.status));
    if (r.lastErrorAt) meta.appendChild(el('span', null, 'Last error ' + stamp(r.lastErrorAt)));
    main.appendChild(meta);
    if (r.lastError) main.appendChild(el('div', 'meta err1', r.lastError));
    li.appendChild(main);
    var n = r.consecutiveFailures; var pill = el('span', 'pill soft', n === 1 ? '1 failure' : n + ' failures'); pill.title = 'Failures in a row'; li.appendChild(pill);
    return li;
  }
  function healthList(id, rows){
    var ul = $(id); ul.textContent = '';
    rows.slice().sort(function(a, b){ return (b.failing - a.failing) || (b.consecutiveFailures - a.consecutiveFailures) || (a.name < b.name ? -1 : 1); }).forEach(function(r){ ul.appendChild(healthRow(r)); });
    $(id + 'Empty').classList.toggle('hidden', rows.length > 0);
  }
  function loadHealth(){
    $('hlWhen').textContent = 'Loading...';
    api('/health').then(function(j){
      var failing = j.jobs.concat(j.sources).filter(function(r){ return r.failing; }).length;
      $('hlWhen').textContent = 'Read ' + stamp(j.generatedAt) + '. Marked when failing ' + j.threshold + ' times in a row. ' + (failing ? failing + ' failing.' : 'None failing.');
      healthList('hlJobs', j.jobs); healthList('hlSources', j.sources);
      var fb = (j.aiFallbacks && j.aiFallbacks.byReason) || []; var fu = $('hlFallbacks'); fu.textContent = '';
      fb.forEach(function(r){ var li = document.createElement('li'); li.textContent = r.n + '  ' + r.reason; fu.appendChild(li); });
      $('hlFallbacksEmpty').classList.toggle('hidden', fb.length > 0);
    }).catch(function(x){ authFail(x); $('hlWhen').textContent = x.message; });
  }
  $('hlRefresh').addEventListener('click', loadHealth);
  $('covBody').addEventListener('change', function(){ covAll.covMeet = false; renderCoverage(); });
  $('covRefresh').addEventListener('click', function(){ var b = $('covRefresh'); b.disabled = true; $('covWhen').textContent = 'Checking the archive...';
    post('/coverage/refresh').then(function(j){ cov = j; renderCoverage(); }, function(x){ $('covWhen').textContent = x.message; }).then(function(){ b.disabled = false; }); });
  function csvCell(v){ var t = v == null ? '' : String(v); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
  $('covCsv').addEventListener('click', function(){
    var r = cov; if (!r) return;
    var rows = [['Section', 'Series or body', 'Year or date', 'Number or title', 'Detail', 'Record']];
    r.gaps.forEach(function(g){
      g.missing.forEach(function(n){ rows.push(['Missing number', SERIES[g.series] || g.series, g.year, g.year + '-' + pad2(n), g.motionOnly.indexOf(n) >= 0 ? '' : 'Not in the archive', '']); });
      g.motionOnly.forEach(function(n){ rows.push(['Named only in a motion', SERIES[g.series] || g.series, g.year, g.year + '-' + pad2(n), 'No record of its own', '']); });
    });
    r.meetings.forEach(function(m){ rows.push(['Meeting missing files', m.bodyName || '', m.date, m.title, 'Missing: ' + m.missing.map(function(d){ return DOCS[d] || d; }).join(', '), location.origin + '/meetings/' + encodeURIComponent(m.id)]); });
    r.undated.forEach(function(d){ rows.push(['No date', TYPE_NAME[TYPE_OF[d.type]] || d.type, d.year == null ? '' : d.year, d.title, d.body || '', location.origin + '/documents/' + encodeURIComponent(d.id)]); });
    r.noText.forEach(function(d){ rows.push(['No text', TYPE_NAME[TYPE_OF[d.type]] || d.type, d.year == null ? '' : d.year, d.title, d.reason || '', location.origin + '/documents/' + encodeURIComponent(d.id)]); });
    var text = '\ufeff' + rows.map(function(row){ return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = 'vineyard-coverage-' + r.today + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  // ------------------------------------------------------------ passkeys sheet
  function openSheet(open){ $('sheet').classList.toggle('hidden', !open); $('sheetBg').classList.toggle('hidden', !open); if (open) loadKeys(); else $('pkWelcome').classList.add('hidden'); }
  $('secBtn').addEventListener('click', function(){ openSheet(true); });
  $('sheetClose').addEventListener('click', function(){ openSheet(false); });
  $('sheetBg').addEventListener('click', function(){ openSheet(false); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') openSheet(false); });
  $('outBtn').addEventListener('click', function(){ post('/logout').then(boot, boot); });
  function loadKeys(){
    var hasPw = isOwner() ? passwordAllowed : !!me && me.role === 'admin';
    $('pwSec').classList.toggle('hidden', !hasPw);
    $('pNew').minLength = me && me.role === 'admin' ? 12 : 10;
    $('pkHint').textContent = me && me.role === 'uploader' ? 'Sign in with Face ID, Touch ID or Windows Hello. Keep at least one.' : 'Sign in with Face ID, Touch ID or Windows Hello. Your password keeps working too.';
    return api('/passkeys').then(function(j){
      var ul = $('keys'); ul.textContent = ''; var items = j.items || [];
      items.forEach(function(k){
        var li = el('li'); var t = el('div', null, k.name || 'Passkey'); t.appendChild(el('small', null, 'Added ' + fFull.format(new Date(k.created_at)) + (k.last_used_at ? ', last used ' + fFull.format(new Date(k.last_used_at)) : '')));
        li.appendChild(t);
        if (items.length > 1 || (me && me.role !== 'uploader')) li.appendChild(btn('Remove', 'ghost', function(){ if (confirm('Remove this passkey?')) post('/passkey/delete', { id: k.id }).then(loadKeys, function(x){ $('pkErr').textContent = x.message; }); }));
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
  submit('adminJoin', 'aErr', function(){
    return post('/invite/accept', { token: inviteToken, login: $('aLogin').value, password: $('aPass').value })
      .then(function(){ $('aPass').value = ''; history.replaceState(null, '', '__PREFIX__'); inviteToken = null; return boot(); })
      .then(function(){ openSheet(true); $('pkWelcome').classList.remove('hidden'); });
  });
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
      return post('/invite/check', { token: inviteToken }).then(function(j){
        var admin = j.role === 'admin';
        $('adminJoin').classList.toggle('hidden', !admin); $('inviteForm').classList.toggle('hidden', admin);
        if (admin) { $('iHead').textContent = 'Welcome'; $('iSub').textContent = 'Set up the ' + (j.name || 'Vineyard Admin') + ' account. Choose how you sign in.'; }
        else if (j.name && !$('iName').value) $('iName').value = j.name;
      }, function(x){ $('inviteForm').classList.remove('hidden'); $('iErr').textContent = x.message; $('iBtn').disabled = true; });
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
      var allowed = VIEWS.filter(mayView).map(function(v){ return v[0]; });
      go(allowed.indexOf(saved) >= 0 ? saved : allowed[0]);
      if (me.role === 'owner' && passwordAllowed) openSheet(true);
    });
  }
  boot();
})();`;

/**
 * The private activity panel page. Self-contained (served only at PANEL_PREFIX, never part of the
 * public site bundle). All data is rendered with textContent, never as HTML.
 */
export const PANEL_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Activity</title>
<style nonce="__NONCE__">
:root{--bg:#fff;--bg2:#f6f6f7;--card:#fff;--ink:#0b0b0d;--ink2:#2b2c31;--muted:#6b6c73;--faint:#a1a2a9;--line:rgba(11,11,13,.08);--line2:rgba(11,11,13,.14);--accent:#7a2d52;--soft:rgba(122,45,82,.08);--good:#1f7a4d;--goodbg:rgba(31,122,77,.1);--bad:#b42318;--badbg:rgba(180,35,24,.08);--shadow:0 1px 2px rgba(11,11,13,.04),0 12px 32px -18px rgba(11,11,13,.18);--serif:'Iowan Old Style','Source Serif 4',Georgia,'Times New Roman',serif;--sans:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
html.dark{--bg:#0a0a0b;--bg2:#131315;--card:#101012;--ink:#f5f5f6;--ink2:#d6d6da;--muted:#9a9aa2;--faint:#6b6b73;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--accent:#e6a9c6;--soft:rgba(230,169,198,.1);--good:#6fd1a0;--goodbg:rgba(111,209,160,.12);--bad:#ff9b8f;--badbg:rgba(255,155,143,.1);--shadow:0 20px 50px -30px rgba(0,0,0,.8)}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}
button,input,select{font:inherit;color:inherit}
.wrap{width:min(960px,100%);margin:0 auto;padding:18px 18px 90px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:34px}
.mark{font-family:var(--serif);font-size:19px;font-weight:600;letter-spacing:-.01em;line-height:1}
.mark small{display:block;font-family:var(--sans);font-size:9px;font-weight:650;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);margin-top:5px}
.acts{display:flex;gap:6px}
h1{font-family:var(--serif);font-weight:500;font-size:clamp(34px,5vw,46px);letter-spacing:-.035em;line-height:1;margin:0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;padding:0 16px;border-radius:999px;border:1px solid var(--line2);background:transparent;cursor:pointer;font-size:13px;font-weight:550;white-space:nowrap}
.btn:hover{background:var(--bg2)}.btn:disabled{opacity:.5;cursor:default}
.btn.primary{background:var(--ink);color:var(--bg);border-color:var(--ink)}.btn.primary:hover{background:var(--accent);border-color:var(--accent)}
.btn.big{height:50px;width:100%;font-size:15px}
.btn.ghost{border-color:transparent;color:var(--muted)}.btn.ghost:hover{color:var(--ink)}
.auth{max-width:380px;margin:10vh auto 0;text-align:left}
.auth h1{font-size:40px;margin-bottom:10px}.auth p.sub{margin:0 0 28px;color:var(--muted);font-size:15px}
.or{display:flex;align-items:center;gap:12px;margin:22px 0 6px;color:var(--faint);font-size:12px;text-transform:uppercase;letter-spacing:.14em}
.or:before,.or:after{content:'';flex:1;height:1px;background:var(--line2)}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin:16px 0 7px}
input[type=email],input[type=password],input[type=text],input[type=search]{width:100%;height:46px;padding:0 15px;border-radius:13px;border:1px solid var(--line2);background:var(--card);outline:0;font-size:15px}
input:focus{border-color:var(--accent);box-shadow:0 0 0 4px var(--soft)}
.err{color:var(--bad);font-size:13px;min-height:18px;margin:12px 0}
.ok{color:var(--good)}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.seg{display:inline-flex;gap:2px;padding:3px;border-radius:999px;border:1px solid var(--line);background:var(--bg2)}
.seg button{height:32px;padding:0 14px;border:0;border-radius:999px;background:transparent;color:var(--muted);cursor:pointer;font-size:13px;font-weight:550}
.seg button[aria-pressed=true]{background:var(--bg);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08),0 0 0 1px var(--line)}
html.dark .seg button[aria-pressed=true]{background:rgba(255,255,255,.1)}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}
.card{border:1px solid var(--line);border-radius:20px;background:var(--card);box-shadow:var(--shadow)}
.stat{padding:18px 18px 16px}
.stat .n{font-family:var(--serif);font-size:36px;font-weight:500;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}
.stat .l{font-size:12px;font-weight:550;color:var(--muted);margin-top:8px}
.stat .x{font-size:12px;color:var(--faint);margin-top:2px}
.top-q{padding:18px 20px 8px;margin-bottom:34px}
.label{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
.top-q ol{list-style:none;margin:0;padding:0}
.top-q li{display:flex;gap:14px;align-items:baseline;padding:11px 0;border-top:1px solid var(--line);font-size:15px}
.top-q li:first-child{border-top:0}
.top-q .c{flex:none;min-width:30px;font-size:12px;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.bar input{width:260px;height:38px;border-radius:999px;font-size:13px}
.feed{list-style:none;margin:0;padding:0}
.item{display:grid;grid-template-columns:78px 1fr auto;gap:16px;padding:16px 18px;border-top:1px solid var(--line);cursor:default}
.item:first-child{border-top:0}
.item.click{cursor:pointer}.item.click:hover{background:var(--bg2)}
.when{font-size:12px;color:var(--muted);line-height:1.35;font-variant-numeric:tabular-nums}
.when b{display:block;color:var(--ink2);font-weight:600;font-size:13px}
.main{min-width:0}
.q{font-family:var(--serif);font-size:17px;line-height:1.35;letter-spacing:-.005em;word-break:break-word}
.path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:12px;color:var(--muted)}
.meta .ip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.ans{display:none;margin-top:10px;padding:12px 14px;border-radius:12px;background:var(--bg2);font-size:13.5px;line-height:1.55;color:var(--ink2);white-space:pre-wrap;word-break:break-word}
.item.open .ans{display:block}
.pill{align-self:start;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.02em;white-space:nowrap}
.pill.up{background:var(--goodbg);color:var(--good)}.pill.down{background:var(--badbg);color:var(--bad)}
.pill.soft{background:var(--bg2);color:var(--muted);font-weight:600}
.empty{padding:40px 20px;text-align:center;color:var(--muted);font-size:14px}
.more{display:flex;justify-content:center;padding:14px}
.foot{margin-top:26px;font-size:12px;color:var(--faint);text-align:center}
.sheetbg{position:fixed;inset:0;background:rgba(8,6,10,.35);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);z-index:10}
.sheet{position:fixed;z-index:11;top:0;right:0;bottom:0;width:min(420px,100%);background:var(--bg);border-left:1px solid var(--line);padding:22px 22px 40px;overflow-y:auto;box-shadow:-30px 0 80px -30px rgba(0,0,0,.35)}
.sheet h2{font-family:var(--serif);font-weight:500;font-size:28px;letter-spacing:-.02em;margin:0 0 4px}
.sheet .sec{margin-top:28px}
.keys{list-style:none;margin:10px 0 12px;padding:0}
.keys li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;margin-bottom:8px;font-size:14px}
.keys small{display:block;color:var(--muted);font-size:12px;margin-top:2px}
.sheethead{display:flex;justify-content:space-between;align-items:center}.hint{font-size:13px;color:var(--muted);margin:0;line-height:1.5}
.hidden{display:none!important}
.chk{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
@media (max-width:720px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.bar input{width:100%}.item{grid-template-columns:1fr auto;gap:6px 12px}.when{grid-column:1/-1;display:flex;gap:8px}.when b{display:inline}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div class="mark">Vineyard<small>Transparency Portal</small></div><div class="acts hidden" id="acts"><button class="btn ghost" id="secBtn" type="button">Security</button><button class="btn" id="outBtn" type="button">Sign out</button></div></div>

  <section id="setup" class="auth hidden">
    <h1>Welcome</h1>
    <p class="sub">One-time setup for your private activity page.</p>
    <form id="setupForm">
      <label for="sCode">Setup code</label><input id="sCode" type="text" autocomplete="one-time-code" autocapitalize="characters" required>
      <label for="sEmail">Email</label><input id="sEmail" type="email" autocomplete="username" required>
      <label for="sPass">Password (10 or more characters)</label><input id="sPass" type="password" autocomplete="new-password" minlength="10" required>
      <p class="err" id="sErr"></p>
      <button class="btn primary big" type="submit">Create and sign in</button>
    </form>
  </section>

  <section id="login" class="auth hidden">
    <h1>Sign in</h1>
    <p class="sub">Your private activity page.</p>
    <button class="btn primary big hidden" id="pkLogin" type="button">Sign in with a passkey</button>
    <div class="or hidden" id="orLine">or</div>
    <form id="loginForm">
      <label for="lEmail">Email</label><input id="lEmail" type="email" autocomplete="username webauthn" required>
      <label for="lPass">Password</label><input id="lPass" type="password" autocomplete="current-password" required>
      <p class="err" id="lErr"></p>
      <button class="btn big" id="lBtn" type="submit">Sign in</button>
    </form>
  </section>

  <section id="dash" class="hidden">
    <div class="head"><h1>Activity</h1>
      <div class="seg" id="win"><button data-w="day" aria-pressed="false">Today</button><button data-w="week" aria-pressed="true">7 days</button><button data-w="month" aria-pressed="false">30 days</button><button data-w="all" aria-pressed="false">All time</button></div></div>
    <div class="stats" id="stats"></div>
    <div class="card top-q"><p class="label">Most asked this month</p><ol id="topq"></ol></div>

    <div class="bar">
      <div class="seg" id="tabs"><button data-t="questions" aria-pressed="true">Questions</button><button data-t="feedback" aria-pressed="false">Ratings</button><button data-t="visits" aria-pressed="false">Visits</button></div>
      <input id="filter" type="search" placeholder="Search text, place or IP">
      <label class="chk hidden" id="botsWrap"><input id="bots" type="checkbox"> Show bots</label>
    </div>
    <div class="card"><ul class="feed" id="feed"></ul><div class="empty hidden" id="empty">Nothing here yet.</div><div class="more hidden" id="moreWrap"><button class="btn" id="moreBtn" type="button">Show more</button></div></div>
    <p class="foot" id="foot"></p>
  </section>
</div>

<div class="sheetbg hidden" id="sheetBg"></div>
<aside class="sheet hidden" id="sheet" role="dialog" aria-label="Security">
  <div class="sheethead"><h2>Security</h2><button class="btn ghost" id="sheetClose" type="button">Close</button></div>
  <div class="sec"><p class="label">Passkeys</p>
    <p class="hint">Sign in with Face ID, Touch ID or Windows Hello instead of a password.</p>
    <ul class="keys" id="keys"></ul>
    <button class="btn primary" id="pkAdd" type="button">Add a passkey</button>
    <p class="err" id="pkErr"></p>
  </div>
  <div class="sec"><p class="label">Password</p>
    <form id="pwForm">
      <label for="pCur">Current password</label><input id="pCur" type="password" autocomplete="current-password" required>
      <label for="pNew">New password</label><input id="pNew" type="password" autocomplete="new-password" minlength="10" required>
      <p class="err" id="pErr"></p>
      <button class="btn" type="submit">Change password</button>
    </form>
  </div>
</aside>

<script nonce="__NONCE__">
(function(){
  try { var t = localStorage.getItem('vtp:theme'); var dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; if (dark) document.documentElement.classList.add('dark'); } catch (e) {}
  var P = '__PREFIX__/api';
  var $ = function(id){ return document.getElementById(id); };
  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function show(id){ ['setup','login','dash'].forEach(function(s){ $(s).classList.toggle('hidden', s !== id); }); $('acts').classList.toggle('hidden', id !== 'dash'); }
  function api(path, opts){
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: { 'x-vtp-panel': '1' } };
    if (opts.body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(P + path, init).then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ if (!r.ok) { var e = new Error((j.error && j.error.message) || 'Something went wrong.'); e.status = r.status; throw e; } return j; }); });
  }
  var post = function(path, body){ return api(path, { method: 'POST', body: body || {} }); };
  var tz = 'America/Denver';
  var fTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  var fDay = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
  var fFull = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
  function whenEl(iso){ var d = new Date(iso); var w = el('div', 'when'); w.appendChild(el('b', null, fTime.format(d))); w.appendChild(el('span', null, fDay.format(d))); return w; }
  function place(r){ return [r.city, r.country].filter(Boolean).join(', '); }
  function bytes(n){ return n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB'; }

  // base64url helpers for passkeys
  function toBuf(s){ s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s); var u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }
  function toB64(buf){ var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); }
  var canPasskey = !!(window.PublicKeyCredential && navigator.credentials);

  var state = { win: 'week', tab: 'questions', rows: [], before: null, summary: null };

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
    var st = s.storage || {};
    $('foot').textContent = 'Kept permanently. Storage ' + bytes(st.bytes || 0) + ' of ' + bytes(st.ceiling || 0) + ' used' + (st.paused ? '. Logging is paused because storage is nearly full.' : '.');
  }

  function item(r){
    var li = el('li', 'item'); li.appendChild(whenEl(r.at));
    var main = el('div', 'main'); var right = null;
    var meta = el('div', 'meta');
    var add = function(t, cls){ if (t) meta.appendChild(el('span', cls || null, t)); };
    if (state.tab === 'visits') {
      main.appendChild(el('div', 'path', r.path || '/'));
      add(place(r)); add(r.device); add(r.ip, 'ip'); if (r.referrer) add('from ' + r.referrer.replace(/^https?:\\/\\//, '').slice(0, 60));
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
  $('outBtn').addEventListener('click', function(){ post('/logout').then(boot, boot); });

  function openSheet(open){ $('sheet').classList.toggle('hidden', !open); $('sheetBg').classList.toggle('hidden', !open); if (open) loadKeys(); }
  $('secBtn').addEventListener('click', function(){ openSheet(true); });
  $('sheetClose').addEventListener('click', function(){ openSheet(false); });
  $('sheetBg').addEventListener('click', function(){ openSheet(false); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') openSheet(false); });

  function loadKeys(){
    return api('/passkeys').then(function(j){
      var ul = $('keys'); ul.textContent = '';
      (j.items || []).forEach(function(k){
        var li = el('li'); var t = el('div', null, k.name || 'Passkey'); t.appendChild(el('small', null, 'Added ' + fFull.format(new Date(k.created_at)) + (k.last_used_at ? ', last used ' + fFull.format(new Date(k.last_used_at)) : '')));
        var rm = el('button', 'btn ghost', 'Remove'); rm.type = 'button';
        rm.addEventListener('click', function(){ if (confirm('Remove this passkey?')) post('/passkey/delete', { id: k.id }).then(loadKeys); });
        li.appendChild(t); li.appendChild(rm); ul.appendChild(li);
      });
      if (!(j.items || []).length) ul.appendChild(el('li', null, 'No passkeys yet.'));
      $('pkAdd').classList.toggle('hidden', !canPasskey);
    }).catch(authFail);
  }

  function deviceName(){ var ua = navigator.userAgent; return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'This device'; }

  $('pkAdd').addEventListener('click', function(){
    $('pkErr').textContent = ''; $('pkErr').classList.remove('ok');
    post('/passkey/register/options').then(function(o){
      return navigator.credentials.create({ publicKey: { challenge: toBuf(o.challenge), rp: { name: 'Vineyard Transparency Portal', id: o.rpId }, user: { id: toBuf(o.userId), name: o.email, displayName: o.email },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, attestation: 'none', timeout: 60000,
        excludeCredentials: (o.exclude || []).map(function(id){ return { type: 'public-key', id: toBuf(id) }; }) } });
    }).then(function(c){
      var r = c.response; var pk = r.getPublicKey && r.getPublicKey();
      if (!pk || !r.getAuthenticatorData) throw new Error('This browser cannot add a passkey. Try Safari or Chrome.');
      return post('/passkey/register', { id: c.id, clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.getAuthenticatorData()), publicKey: toB64(pk), alg: r.getPublicKeyAlgorithm(), name: deviceName() });
    }).then(function(){ $('pkErr').textContent = 'Passkey added. You can sign in with it next time.'; $('pkErr').classList.add('ok'); loadKeys(); })
      .catch(function(e){ $('pkErr').textContent = e && e.name === 'NotAllowedError' ? 'Cancelled.' : e && e.name === 'InvalidStateError' ? 'This device already has a passkey here.' : (e.message || 'Could not add the passkey.'); });
  });

  $('pkLogin').addEventListener('click', function(){
    $('lErr').textContent = '';
    post('/passkey/login/options').then(function(o){
      return navigator.credentials.get({ publicKey: { challenge: toBuf(o.challenge), rpId: o.rpId, userVerification: 'required', timeout: 60000 } });
    }).then(function(c){
      var r = c.response;
      return post('/passkey/login', { id: c.id, clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature) });
    }).then(boot).catch(function(e){ $('lErr').textContent = e && e.name === 'NotAllowedError' ? 'Cancelled.' : (e.message || 'Passkey sign-in failed.'); });
  });

  function submit(form, err, fn){
    $(form).addEventListener('submit', function(e){ e.preventDefault(); $(err).textContent = ''; $(err).classList.remove('ok'); var btn = $(form).querySelector('button[type=submit]'); btn.disabled = true;
      fn().then(function(){ btn.disabled = false; }, function(x){ btn.disabled = false; $(err).textContent = x.message; }); });
  }
  submit('setupForm', 'sErr', function(){ return post('/setup', { code: $('sCode').value, email: $('sEmail').value, password: $('sPass').value }).then(function(){ return boot().then(function(){ openSheet(true); }); }); });
  submit('loginForm', 'lErr', function(){ return post('/login', { email: $('lEmail').value, password: $('lPass').value }).then(function(){ $('lPass').value = ''; return boot(); }); });
  submit('pwForm', 'pErr', function(){ return post('/password', { current: $('pCur').value, next: $('pNew').value }).then(function(){ $('pCur').value = ''; $('pNew').value = ''; $('pErr').textContent = 'Saved. Other sessions were signed out.'; $('pErr').classList.add('ok'); }); });

  function loadSummary(){ return api('/summary').then(function(s){ state.summary = s; renderStats(); }).catch(authFail); }

  function boot(){
    return api('/state').then(function(s){
      if (!s.hasOwner) return show('setup');
      if (!s.signedIn) {
        show('login');
        $('pkLogin').classList.toggle('hidden', !(canPasskey && s.hasPasskeys)); $('orLine').classList.toggle('hidden', !(canPasskey && s.hasPasskeys));
        $('lBtn').classList.toggle('primary', !(canPasskey && s.hasPasskeys));
        return;
      }
      show('dash'); loadSummary(); setTab(state.tab);
    });
  }
  boot();
})();
</script>
</body>
</html>`;

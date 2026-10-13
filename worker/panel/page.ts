/**
 * The private panel page. Self-contained (served only at PANEL_PREFIX, never part of the public site
 * bundle). All data is rendered with textContent, never as HTML.
 *
 * Owner: activity, adding records, every upload, resident submissions (pending ones to approve or
 * reject, approved ones to hide or remove), people (existing accounts and invites; new staff accounts
 * are made in the staff portal at /staff), and the
 * coverage check (what the archive is missing, with a CSV download), and job health (each scheduled
 * check and source: last run, last success, last error, failures in a row).
 * Admin: the same, except people and invites, the submissions switch, and hiding or removing
 * approved submissions. Uploader: adding records and its own uploads. An invite link
 * (PANEL_PREFIX/invite/<token>) opens the join form: an uploader picks a display name and creates a
 * passkey; an admin picks a sign-in name and a password, and may add a passkey.
 */
import { PANEL_SCRIPT } from './pageScript';

export const PANEL_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Panel</title>
<style nonce="__NONCE__">
:root{--bg:#fff;--bg2:#f6f6f7;--card:#fff;--ink:#0b0b0d;--ink2:#2b2c31;--muted:#6b6c73;--faint:#a1a2a9;--line:rgba(11,11,13,.08);--line2:rgba(11,11,13,.14);--accent:#7a2d52;--soft:rgba(122,45,82,.08);--good:#1f7a4d;--goodbg:rgba(31,122,77,.1);--bad:#b42318;--badbg:rgba(180,35,24,.08);--shadow:0 1px 2px rgba(11,11,13,.04),0 12px 32px -18px rgba(11,11,13,.18);--serif:'Iowan Old Style','Source Serif 4',Georgia,'Times New Roman',serif;--sans:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
html.dark{--bg:#0a0a0b;--bg2:#131315;--card:#101012;--ink:#f5f5f6;--ink2:#d6d6da;--muted:#9a9aa2;--faint:#6b6b73;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--accent:#e6a9c6;--soft:rgba(230,169,198,.1);--good:#6fd1a0;--goodbg:rgba(111,209,160,.12);--bad:#ff9b8f;--badbg:rgba(255,155,143,.1);--shadow:0 20px 50px -30px rgba(0,0,0,.8)}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}
.wrap{width:min(960px,100%);margin:0 auto;padding:18px 16px 90px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:26px}
.mark{font-family:var(--serif);font-size:19px;font-weight:600;letter-spacing:-.01em;line-height:1}
.mark small{display:block;font-family:var(--sans);font-size:9px;font-weight:650;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);margin-top:5px}
.acts{display:flex;gap:6px;align-items:center}
.who{font-size:12px;color:var(--muted);margin-right:4px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
h1{font-family:var(--serif);font-weight:500;font-size:clamp(32px,5vw,46px);letter-spacing:-.035em;line-height:1;margin:0}
h2.sub{font-family:var(--serif);font-weight:500;font-size:24px;letter-spacing:-.02em;margin:28px 0 12px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:38px;padding:0 16px;border-radius:999px;border:1px solid var(--line2);background:transparent;cursor:pointer;font-size:13px;font-weight:550;white-space:nowrap}
.btn:hover{background:var(--bg2)}.btn:disabled{opacity:.5;cursor:default}
.btn.primary{background:var(--ink);color:var(--bg);border-color:var(--ink)}.btn.primary:hover{background:var(--accent);border-color:var(--accent)}
.btn.big{height:50px;width:100%;font-size:15px}
.btn.ghost{border-color:transparent;color:var(--muted)}.btn.ghost:hover{color:var(--ink)}
.btn.danger{color:var(--bad)}
.btn.sm{min-height:32px;padding:0 12px;font-size:12px}
.auth{max-width:380px;margin:8vh auto 0;text-align:left}
.auth h1{font-size:40px;margin-bottom:10px}.auth p.sub{margin:0 0 28px;color:var(--muted);font-size:15px}
.or{display:flex;align-items:center;gap:12px;margin:22px 0 6px;color:var(--faint);font-size:12px;text-transform:uppercase;letter-spacing:.14em}
.or:before,.or:after{content:'';flex:1;height:1px;background:var(--line2)}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin:16px 0 7px}
input[type=email],input[type=password],input[type=text],input[type=search],input[type=url],input[type=date],select,textarea{width:100%;min-height:46px;padding:0 15px;border-radius:13px;border:1px solid var(--line2);background:var(--card);outline:0;font-size:16px}
textarea{padding:12px 15px;min-height:96px;resize:vertical;line-height:1.45}
select{appearance:auto}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 4px var(--soft)}
.err{color:var(--bad);font-size:13px;min-height:18px;margin:12px 0}
.ok{color:var(--good)}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.seg{display:inline-flex;gap:2px;padding:3px;border-radius:999px;border:1px solid var(--line);background:var(--bg2);max-width:100%;overflow-x:auto;scrollbar-width:none}
.seg::-webkit-scrollbar{display:none}
.seg button{flex:none;min-height:32px;padding:0 14px;border:0;border-radius:999px;background:transparent;color:var(--muted);cursor:pointer;font-size:13px;font-weight:550}
.seg button[aria-pressed=true]{background:var(--bg);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08),0 0 0 1px var(--line)}
html.dark .seg button[aria-pressed=true]{background:rgba(255,255,255,.1)}
.nav{margin-bottom:26px}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}
.card{border:1px solid var(--line);border-radius:20px;background:var(--card);box-shadow:var(--shadow)}
.pad{padding:18px}
.stat{padding:18px 18px 16px}
.stat .n{font-family:var(--serif);font-size:36px;font-weight:500;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}
.stat .l{font-size:12px;font-weight:550;color:var(--muted);margin-top:8px}
.stat .x{font-size:12px;color:var(--faint);margin-top:2px}
.top-q{padding:18px 20px 8px;margin-bottom:34px}
.label{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
.top-q ol{list-style:none;margin:0;padding:0}
.top-q li{display:flex;gap:14px;align-items:baseline;padding:11px 0;border-top:1px solid var(--line);font-size:15px}
.top-q li:first-child{border-top:0}
.ai-use{margin-bottom:14px}.ai-use li{justify-content:space-between}.ai-use .v{font-variant-numeric:tabular-nums;color:var(--muted)}
.ai-reset{font-size:12px;color:var(--faint);margin:0;padding:4px 0 10px}
.top-q .c{flex:none;min-width:30px;font-size:12px;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.bar input[type=search]{width:260px;min-height:38px;border-radius:999px;font-size:14px}
.bar select{width:auto;max-width:100%;min-height:38px;border-radius:999px;font-size:14px}
.more:empty{display:none}
.feed{list-style:none;margin:0;padding:0}
.item{display:grid;grid-template-columns:78px 1fr auto;gap:16px;padding:16px 18px;border-top:1px solid var(--line);cursor:default}
.item:first-child{border-top:0}
.item.click{cursor:pointer}.item.click:hover{background:var(--bg2)}
.when{font-size:12px;color:var(--muted);line-height:1.35;font-variant-numeric:tabular-nums}
.when b{display:block;color:var(--ink2);font-weight:600;font-size:13px}
.main{min-width:0}
.q{font-family:var(--serif);font-size:17px;line-height:1.35;letter-spacing:-.005em;word-break:break-word}
.path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all}
.meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:12px;color:var(--muted)}
.meta .ip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.ans{display:none;margin-top:10px;padding:12px 14px;border-radius:12px;background:var(--bg2);font-size:13.5px;line-height:1.55;color:var(--ink2);white-space:pre-wrap;word-break:break-word}
.item.open .ans{display:block}
.pill{align-self:start;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.02em;white-space:nowrap}
.pill.up{background:var(--goodbg);color:var(--good)}.pill.down{background:var(--badbg);color:var(--bad)}
.pill.soft{background:var(--bg2);color:var(--muted);font-weight:600}
.hint.pre{white-space:pre-wrap;max-height:16em;overflow:auto}
.mark{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:1px;background:var(--faint)}.mark.fail{background:var(--accent)}
.err1{overflow-wrap:anywhere}
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
.chk{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin:0}
.drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:150px;padding:22px;border:1.5px dashed var(--line2);border-radius:20px;background:var(--bg2);text-align:center;cursor:pointer}
.drop.over{border-color:var(--accent);background:var(--soft)}
.drop b{font-family:var(--serif);font-weight:500;font-size:20px}
.drop span{font-size:13px;color:var(--muted)}
.files{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:12px}
.file{padding:16px}
.filehead{display:flex;justify-content:space-between;align-items:center;gap:10px}
.filename{font-size:13px;font-weight:600;word-break:break-all}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
.status{font-size:13px;margin-top:10px;color:var(--muted)}
.shared{margin-top:14px}.shared .label{margin-bottom:0}
.file .filehead + label{margin-top:8px}.file label{margin-top:8px}
.progress{height:6px;border-radius:999px;background:var(--bg2);overflow:hidden;margin:16px 0 0}.progress span{display:block;height:100%;width:0;background:var(--accent);transition:width .25s}
#bulkCount{margin-top:10px}
.status.ok{color:var(--good)}.status.bad{color:var(--bad)}
.rowacts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.linkbox{display:flex;gap:8px;align-items:center;margin-top:12px}
.linkbox input{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.notice{padding:14px 16px;border-radius:14px;background:var(--soft);font-size:14px;line-height:1.5;margin:0 0 18px}
.switch{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.edit{margin-top:12px;padding-top:4px;border-top:1px solid var(--line)}
.hist{margin-top:10px;padding:10px 12px;border-radius:12px;background:var(--bg2);font-size:13px;line-height:1.5}
.hist p{margin:0 0 8px;white-space:pre-wrap;word-break:break-word}.hist p:last-child{margin-bottom:0}
.hist b{font-weight:600}
a.open{color:var(--accent);font-size:12px;font-weight:600;text-decoration:none}
@media (max-width:720px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.bar input[type=search]{width:100%}.item{grid-template-columns:1fr auto;gap:6px 12px}.when{grid-column:1/-1;display:flex;gap:8px}.when b{display:inline}.grid2{grid-template-columns:1fr}.who{display:none}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div class="mark">Vineyard<small>Transparency Portal</small></div><div class="acts hidden" id="acts"><span class="who" id="who"></span><button class="btn ghost" id="secBtn" type="button">Security</button><button class="btn" id="outBtn" type="button">Sign out</button></div></div>

  <section id="setup" class="auth hidden">
    <h1>Welcome</h1>
    <p class="sub">One-time setup for your private panel.</p>
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
    <p class="sub">Private panel.</p>
    <button class="btn primary big hidden" id="pkLogin" type="button">Sign in with a passkey</button>
    <p class="hint hidden" id="noPk">This browser cannot use passkeys. Try Safari or Chrome.</p>
    <div class="or hidden" id="orLine">or</div>
    <form id="loginForm" class="hidden">
      <label for="lEmail">Email or user name</label><input id="lEmail" type="text" autocomplete="username webauthn" autocapitalize="none" spellcheck="false" required>
      <label for="lPass">Password</label><input id="lPass" type="password" autocomplete="current-password" required>
      <button class="btn big" id="lBtn" type="submit">Sign in</button>
    </form>
    <p class="err" id="lErr"></p>
  </section>

  <section id="invite" class="auth hidden">
    <h1 id="iHead">Join</h1>
    <p class="sub" id="iSub">You were invited to add records to the portal.</p>
    <form id="adminJoin" class="hidden">
      <label for="aLogin">Sign-in name (email or user name)</label><input id="aLogin" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="100" required>
      <label for="aPass">Password (12 or more characters)</label><input id="aPass" type="password" autocomplete="new-password" minlength="12" maxlength="200" required>
      <p class="hint">Next you can add a passkey (Face ID, Touch ID or Windows Hello), or add one later from Security.</p>
      <p class="err" id="aErr"></p>
      <button class="btn primary big" id="aBtn" type="submit">Create account</button>
    </form>
    <form id="inviteForm" class="hidden">
      <label for="iName">Your name</label><input id="iName" type="text" autocomplete="name" maxlength="60" required>
      <p class="hint">Next, your device asks to create a passkey (Face ID, Touch ID or Windows Hello). You sign in with it from then on.</p>
      <p class="err" id="iErr"></p>
      <button class="btn primary big" id="iBtn" type="submit">Create passkey and join</button>
    </form>
  </section>

  <section id="dash" class="hidden">
    <div class="nav"><div class="seg" id="nav" role="tablist"></div></div>

    <div id="v-activity" class="view hidden">
      <div class="head"><h1>Activity</h1>
        <div class="seg" id="win"><button data-w="day" aria-pressed="false">Today</button><button data-w="week" aria-pressed="true">7 days</button><button data-w="month" aria-pressed="false">30 days</button><button data-w="all" aria-pressed="false">All time</button></div></div>
      <div class="stats" id="stats"></div>
      <div class="card top-q ai-use hidden" id="aiCard"><p class="label">AI Neurons today</p><ol id="aiUse"></ol><p class="ai-reset" id="aiReset"></p></div>
      <div class="card top-q"><p class="label">Most asked this month</p><ol id="topq"></ol></div>
      <div class="bar">
        <div class="seg" id="tabs"><button data-t="questions" aria-pressed="true">Questions</button><button data-t="feedback" aria-pressed="false">Ratings</button><button data-t="visits" aria-pressed="false">Visits</button></div>
        <input id="filter" type="search" placeholder="Search text, place or IP" aria-label="Search">
        <label class="chk hidden" id="botsWrap"><input id="bots" type="checkbox"> Show bots</label>
      </div>
      <div class="card"><ul class="feed" id="feed"></ul><div class="empty hidden" id="empty">Nothing here yet.</div><div class="more hidden" id="moreWrap"><button class="btn" id="moreBtn" type="button">Show more</button></div></div>
      <p class="foot" id="foot"></p>
    </div>

    <div id="v-add" class="view hidden">
      <div class="head"><h1>Add</h1>
        <div class="seg" id="addKind"><button data-k="files" aria-pressed="true">Files</button><button data-k="project" aria-pressed="false">Project</button><button data-k="note" aria-pressed="false">Note</button><button data-k="link" aria-pressed="false">Link</button></div></div>
      <p class="notice hidden" id="pkNudge"></p>

      <div id="k-files">
        <label class="drop" id="drop" for="fileInput"><b>Drop files here</b><span>One or many. Or tap to choose. PDF, PNG, JPG, TXT or CSV, up to 25 MB each.</span></label>
        <input id="fileInput" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,application/pdf,image/png,image/jpeg,text/plain,text/csv" class="hidden">
        <div class="card pad shared hidden" id="bulkShared"><p class="label">For every file</p></div>
        <div class="progress hidden" id="bulkBar"><span id="bulkFill"></span></div>
        <p class="hint" id="bulkCount"></p>
        <ul class="files" id="fileList"></ul>
        <div class="rowacts hidden" id="fileActs"><button class="btn primary" id="addAll" type="button">Add files</button><button class="btn hidden" id="retryFailed" type="button">Retry failed</button><button class="btn ghost" id="clearFiles" type="button">Clear</button></div>
      </div>

      <form id="k-project" class="card pad hidden">
        <label for="prName">Name</label><input id="prName" type="text" maxlength="200" required>
        <label for="prDesc">Description</label><textarea id="prDesc" maxlength="20000"></textarea>
        <div class="grid2">
          <div><label for="prStatus">Status</label><select id="prStatus"><option>Planned</option><option>Underway</option><option>Complete</option><option>On hold</option></select></div>
          <div><label for="prLoc">Location (optional)</label><input id="prLoc" type="text" maxlength="200"></div>
        </div>
        <p class="err" id="prErr"></p><button class="btn primary" type="submit">Add project</button>
      </form>

      <form id="k-note" class="card pad hidden">
        <label for="noTitle">Title (optional)</label><input id="noTitle" type="text" maxlength="200">
        <label for="noText">Note</label><textarea id="noText" maxlength="20000" required></textarea>
        <p class="err" id="noErr"></p><button class="btn primary" type="submit">Add note</button>
      </form>

      <form id="k-link" class="card pad hidden">
        <label for="liUrl">Web address</label><input id="liUrl" type="url" inputmode="url" placeholder="https://" maxlength="1000" required>
        <label for="liTitle">Title</label><input id="liTitle" type="text" maxlength="200">
        <label for="liDesc">Description (optional)</label><textarea id="liDesc" maxlength="5000"></textarea>
        <p class="err" id="liErr"></p><button class="btn primary" type="submit">Add link</button>
      </form>
    </div>

    <div id="v-updates" class="view hidden">
      <div class="head"><h1>Updates</h1></div>
      <form id="upForm" class="card pad">
        <label for="upTitle">Title (optional)</label><input id="upTitle" type="text" maxlength="200">
        <label for="upText">Text</label><textarea id="upText" maxlength="20000" required placeholder="We finished the 400 North signal. The road is open again."></textarea>
        <div class="grid2">
          <div><label for="upDate">Date</label><input id="upDate" type="date" required></div>
          <div><label for="upTopic">Project or topic (optional)</label><select id="upTopic"><option value="">None</option></select></div>
        </div>
        <p class="hint">Shows at once in search, chat answers and Records, and on a project's card under the map. Labelled "Update posted on the portal".</p>
        <p class="err" id="upErr"></p>
        <button class="btn primary" type="submit">Publish</button>
      </form>
      <h2 class="sub">Published</h2>
      <div class="card"><ul class="feed" id="updList"></ul><div class="empty hidden" id="updEmpty">No updates yet.</div></div>
      <div class="hidden" id="updGoneWrap"><h2 class="sub">Removed</h2><div class="card"><ul class="feed" id="updGone"></ul></div></div>
    </div>

    <div id="v-uploads" class="view hidden">
      <div class="head"><h1>Uploads</h1><label class="chk"><input id="mineOnly" type="checkbox"> Only mine</label></div>
      <div class="card"><ul class="feed" id="upList"></ul><div class="empty hidden" id="upEmpty">Nothing added yet.</div></div>
    </div>

    <div id="v-subs" class="view hidden">
      <div class="head"><h1>Submissions</h1></div>
      <div class="card pad switch"><div><p class="label">Submit a public record page</p><div class="hint" id="subState"></div></div><button class="btn" id="subSwitch" type="button"></button></div>
      <h2 class="sub">Pending</h2>
      <p class="hint">Not public until approved. Approve adds it to the portal with the label "Resident submitted. Not a city record." Reject deletes it and its file.</p>
      <div class="card"><ul class="feed" id="subPending"></ul><div class="empty hidden" id="subPendingEmpty">Nothing waiting for review.</div></div>
      <h2 class="sub">Approved</h2>
      <div class="card"><ul class="feed" id="subList"></ul><div class="empty hidden" id="subEmpty">No approved submissions yet.</div></div>
      <h2 class="sub">Log</h2>
      <div class="card"><ul class="feed" id="subLog"></ul><div class="empty hidden" id="subLogEmpty">Nothing logged yet.</div></div>
    </div>

    <div id="v-people" class="view hidden">
      <div class="head"><h1>People</h1></div>
      <div class="card pad">
        <p class="hint" id="staffNote">New staff accounts are made in the staff portal at <a href="/staff">vineyardportal.org/staff</a>, under Accounts. This panel is your own console. Accounts already here keep working, and you can turn them off below.</p>
      </div>
      <h2 class="sub">Accounts</h2>
      <div class="card"><ul class="feed" id="accList"></ul></div>
      <h2 class="sub">Invites</h2>
      <div class="card"><ul class="feed" id="invList"></ul><div class="empty hidden" id="invEmpty">No invites in the last 30 days.</div></div>
      <h2 class="sub">Upload log</h2>
      <div class="card"><ul class="feed" id="auditList"></ul><div class="empty hidden" id="auditEmpty">Nothing logged yet.</div></div>
    </div>

    <div id="v-coverage" class="view hidden">
      <div class="head"><h1>Coverage</h1><div class="rowacts"><button class="btn" id="covRefresh" type="button">Check now</button><button class="btn primary" id="covCsv" type="button">Download CSV</button></div></div>
      <p class="hint" id="covWhen"></p>
      <div class="stats" id="covStats"></div>
      <h2 class="sub">Number gaps</h2>
      <p class="hint">Ordinances, resolutions and RDA resolutions, per year: each number from 1 to the highest seen that no record or recorded motion names.</p>
      <div class="card"><ul class="feed" id="covGaps"></ul><div class="empty hidden" id="covGapsEmpty">No gaps found.</div><div class="more" id="covGapsMore"></div></div>
      <div class="bar"><h2 class="sub">Meetings missing files</h2><select id="covBody" aria-label="Body"></select></div>
      <p class="hint">Held, not canceled, with no agenda, packet or minutes in the archive. Hearing notices are left out.</p>
      <div class="card"><ul class="feed" id="covMeet"></ul><div class="empty hidden" id="covMeetEmpty">Every held meeting has its files.</div><div class="more" id="covMeetMore"></div></div>
      <h2 class="sub">Records with no date</h2>
      <div class="card"><ul class="feed" id="covUndated"></ul><div class="empty hidden" id="covUndatedEmpty">Every record has a date.</div><div class="more" id="covUndatedMore"></div></div>
      <h2 class="sub">Records with no text</h2>
      <p class="hint">Text not extracted, not indexed for search, or waiting for OCR.</p>
      <div class="card"><ul class="feed" id="covNoText"></ul><div class="empty hidden" id="covNoTextEmpty">Every record has text.</div><div class="more" id="covNoTextMore"></div></div>
    </div>

    <div id="v-health" class="view hidden">
      <div class="head"><h1>Health</h1><div class="rowacts"><button class="btn" id="hlRefresh" type="button">Reload</button></div></div>
      <p class="hint" id="hlWhen"></p>
      <h2 class="sub">Chat answers not written by the first model today</h2>
      <div class="card"><ul class="feed" id="hlFallbacks"></ul><div class="empty hidden" id="hlFallbacksEmpty">None today.</div></div>
      <h2 class="sub">Scheduled checks</h2>
      <div class="card"><ul class="feed" id="hlJobs"></ul><div class="empty hidden" id="hlJobsEmpty">No checks recorded yet.</div></div>
      <h2 class="sub">Sources</h2>
      <div class="card"><ul class="feed" id="hlSources"></ul><div class="empty hidden" id="hlSourcesEmpty">No sources.</div></div>
    </div>
  </section>
</div>

<div class="sheetbg hidden" id="sheetBg"></div>
<aside class="sheet hidden" id="sheet" role="dialog" aria-label="Security">
  <div class="sheethead"><h2>Security</h2><button class="btn ghost" id="sheetClose" type="button">Close</button></div>
  <div class="sec">
    <p class="notice hidden" id="pkWelcome">Your account is ready. Add a passkey now for quick sign-in, or later from Security.</p>
    <p class="label">Passkeys</p>
    <p class="hint" id="pkHint">Sign in with Face ID, Touch ID or Windows Hello. Keep at least one.</p>
    <ul class="keys" id="keys"></ul>
    <button class="btn primary" id="pkAdd" type="button">Add a passkey</button>
    <p class="err" id="pkErr"></p>
  </div>
  <div class="sec hidden" id="pwSec"><p class="label">Password</p>
    <form id="pwForm">
      <label for="pCur">Current password</label><input id="pCur" type="password" autocomplete="current-password" required>
      <label for="pNew">New password</label><input id="pNew" type="password" autocomplete="new-password" minlength="10" required>
      <p class="err" id="pErr"></p>
      <button class="btn" type="submit">Change password</button>
    </form>
  </div>
</aside>

<script nonce="__NONCE__">
${PANEL_SCRIPT}
</script>
</body>
</html>`;

// Runs before first paint. Kept as an external file so the Content-Security-Policy can forbid inline scripts.
// 1. Applies the saved theme, so there is no light/dark flash.
// 2. Names the screen being opened on <html data-route>, so the static app shell in index.html shows that
//    page's title before the app loads, and starts loading that screen's code (modulepreload) at once.
(function () {
  var root = document.documentElement;
  try {
    var pref = localStorage.getItem('vtp:theme') || 'system';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {
    /* storage unavailable: fall back to CSS defaults */
  }
  try {
    // The same table as screenFor in src/app/router.tsx.
    var seg = location.pathname.split('/').filter(Boolean);
    var table = {
      '': 'console', meetings: seg[1] ? 'meeting' : 'meetings', calendar: 'meetings', documents: 'document',
      services: seg[1] ? 'service' : 'services', latest: 'latest', budget: 'budget', map: 'map', construction: 'construction',
      records: seg[1] ? 'recordsIndex' : 'records', votes: 'votes', boards: 'boards', planning: 'planning', people: 'people', add: 'add'
    };
    var screen = table[seg[0] || ''] || 'other';
    root.setAttribute('data-route', screen);
    root.classList.add('vtp-boot');
    var data = document.getElementById('vtp-routes');
    var routes = data ? JSON.parse(data.textContent || '{}') : {};
    var files = routes[screen] || [];
    for (var i = 0; i < files.length; i++) {
      var link = document.createElement('link');
      var css = /\.css$/.test(files[i]);
      link.rel = css ? 'preload' : 'modulepreload';
      if (css) link.as = 'style';
      link.crossOrigin = '';
      link.href = files[i];
      document.head.appendChild(link);
    }
    // 3. The page's own data starts loading now, alongside its code (src/console/api.ts picks it up).
    var q = location.search;
    var api = { votes: '/api/pages/votes', planning: '/api/pages/planning', construction: '/api/pages/construction', budget: '/api/budget' }[screen];
    if (api && (screen === 'votes' || screen === 'planning') && /[?&](member|q|result|vote)=/.test(q)) api = null;
    if (api && screen === 'votes' && /[?&]body=redevelopment-agency(&|$)/.test(q)) api += '?body=redevelopment-agency';
    if (api && window.fetch) {
      var marker = Math.floor(Date.now() / 300000);
      window.__vtpEarly = { url: api, res: fetch(api + (api.indexOf('?') < 0 ? '?' : '&') + '_=' + marker, { headers: { accept: 'application/json' } }) };
    }
  } catch (e) {
    /* the app still loads its screen itself */
  }
})();

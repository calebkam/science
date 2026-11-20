/* Shared navigation: a way back to the home page, and (where a page has no theme button of its own) a theme switch. */
(function () {
  if (window.parent !== window) return; /* embedded (Bondline inside Dock): no navigation chrome */
  var home = new URL('../', location.href).href;
  var css = document.createElement('style');
  css.textContent = '.cp-nav{display:flex;align-items:center;gap:6px;margin-left:auto}' +
    '.cp-nav a,.cp-nav button{font:500 12.5px/1 var(--font-ui,var(--ui,var(--sans,system-ui,sans-serif)));height:30px;padding:0 11px;display:inline-flex;align-items:center;gap:6px;text-decoration:none;cursor:pointer;' +
    'color:var(--ink,var(--fg,inherit));background:var(--panel,transparent);border:1px solid var(--line,#444);border-radius:6px}' +
    '.cp-nav a:hover,.cp-nav button:hover{border-color:var(--accent)}';
  document.head.appendChild(css);
  var brand = document.querySelector('.brand');
  if (brand && brand.tagName !== 'A') {
    var a = document.createElement('a'); a.className = brand.className; a.href = home; a.title = 'All tools'; a.innerHTML = brand.innerHTML;
    a.style.cssText = 'color:inherit;text-decoration:none'; brand.replaceWith(a);
  }
  if (!document.getElementById('b-theme') && !document.getElementById('cp-theme-btn')) {
    var host = document.querySelector('header') || document.body, n = document.createElement('div'); n.className = 'cp-nav';
    n.innerHTML = '<a href="' + home + '">All tools</a><button type="button" id="cp-theme-btn" title="Switch dark / light">Theme</button>';
    host.appendChild(n); n.querySelector('button').addEventListener('click', function () { window.CPTheme.toggle(); });
  }
})();

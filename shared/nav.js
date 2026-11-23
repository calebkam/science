/* Shared navigation: a way back to the home page, and (where a page has no theme button of its own) a theme switch. */
(function () {
  if (window.parent !== window) return; /* embedded (Bondline inside Dock): no navigation chrome */
  var home = new URL('../', location.href).href;
  var css = document.createElement('style');
  css.textContent = '.cp-nav{display:flex;align-items:center;gap:6px;margin-left:auto}' +
    '.cp-nav a,.cp-nav button{font:500 12.5px/1 var(--font-ui,var(--ui,var(--sans,system-ui,sans-serif)));height:30px;padding:0 11px;display:inline-flex;align-items:center;gap:6px;text-decoration:none;cursor:pointer;' +
    'color:var(--ink,var(--fg,inherit));background:var(--panel,transparent);border:1px solid var(--line,#444);border-radius:6px}' +
    '.cp-nav a:hover,.cp-nav button:hover{border-color:var(--accent)}' +
    '.cp-ver{font:500 11.5px/1 var(--font-mono,var(--mono,ui-monospace,monospace));color:var(--muted);border:1px solid var(--line,#444);border-radius:10px;padding:4px 8px;white-space:nowrap;align-self:center;display:inline-flex}';
  document.head.appendChild(css);
  var brand = document.querySelector('.brand');
  if (brand && brand.tagName !== 'A') {
    var a = document.createElement('a'); a.className = brand.className; a.href = home; a.title = 'All tools'; a.innerHTML = brand.innerHTML;
    a.style.cssText = 'color:inherit;text-decoration:none'; brand.replaceWith(a);
  }
  var own = document.getElementById('b-theme');
  if (own) { /* Bondline, Dock: a Home button beside their own theme button, styled like it */
    var h = document.createElement('a'); h.href = home; h.id = 'cp-home'; h.className = own.className; h.textContent = '\u2190 Home'; h.title = 'Back to all tools';
    h.style.cssText = 'text-decoration:none;display:inline-flex;align-items:center;justify-content:center;color:inherit'; own.parentNode.insertBefore(h, own);
  } else if (!document.getElementById('cp-theme-btn')) { /* Positioning Kit, Brain Matrix */
    var host = document.querySelector('header') || document.body, n = document.createElement('div'); n.className = 'cp-nav';
    n.innerHTML = '<a href="' + home + '" id="cp-home">\u2190 Home</a><button type="button" id="cp-theme-btn" title="Switch dark / light">Theme</button>';
    host.appendChild(n); n.querySelector('button').addEventListener('click', function () { window.CPTheme.toggle(); });
  }
  /* version chip, taken from shared/versions.js using this page's folder name */
  var parts = location.pathname.split('/').filter(Boolean), id = parts[parts.length - 1] === 'index.html' ? parts[parts.length - 2] : parts[parts.length - 1];
  var ver = window.CP_VERSIONS && window.CP_VERSIONS[id];
  if (ver) {
    var chip = document.createElement('a'); chip.className = 'cp-ver'; chip.id = 'cp-version'; chip.href = new URL('../changelog/', location.href).href; chip.style.textDecoration = 'none'; chip.textContent = window.cpVer(ver); chip.title = 'Version ' + ver + ' \u00b7 see the changelog';
    var anchor = document.getElementById('b-theme') || document.getElementById('cp-theme-btn');
    if (anchor) anchor.insertAdjacentElement('afterend', chip);
  }
})();

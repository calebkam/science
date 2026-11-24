/* Shared theme for every page in this repo. Dark by default; the choice is remembered in localStorage under "cp-theme"
   and kept in sync across tabs and any embedded frames. Load this in <head> so there is no flash. */
(function () {
  var K = 'cp-theme', R = document.documentElement;
  function read() { try { var v = localStorage.getItem(K); return v === 'light' || v === 'dark' ? v : 'dark'; } catch (e) { return 'dark'; } }
  R.dataset.theme = read();
  function announce() { try { window.dispatchEvent(new Event('cp-theme')); } catch (e) {} }
  window.CPTheme = {
    get: function () { return R.dataset.theme; },
    set: function (v) { v = v === 'light' ? 'light' : 'dark'; R.dataset.theme = v; try { localStorage.setItem(K, v); } catch (e) {} announce(); },
    toggle: function () { this.set(this.get() === 'dark' ? 'light' : 'dark'); }
  };
  /* Some pages set their own theme while booting; the saved choice (or dark) wins once the document is parsed. */
  document.addEventListener('DOMContentLoaded', function () { if (R.dataset.theme !== read()) { R.dataset.theme = read(); announce(); } });
  window.addEventListener('storage', function (e) { if (e.key === K) { R.dataset.theme = read(); announce(); } });
})();

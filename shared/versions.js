/* One place for every version number. Bump a tool's number when you change that tool, and "site" when you change the home page.
   Keys match the folder names. Everything is at 0.1.2a as of 24 Nov 2026. */
window.CP_VERSIONS = {
  site: '0.1.2a',
  'positioning-kit': '0.1.2a',
  'brain-matrix': '0.1.2a',
  'slicer': '0.1.2a'
};
/* Display text: a number such as "0.1.2a" is shown as "v0.1.2a". */
window.cpVer = function (v) { return /^\d/.test(v) ? 'v' + v : v; };

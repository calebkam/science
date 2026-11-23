/* One place for every version number. Bump a tool's number when you change that tool, and "site" when you change the home page.
   Keys match the folder names. Everything is at Beta 0.1.1 as of 24 Nov 2026. */
window.CP_VERSIONS = {
  site: 'Beta 0.1.1',
  'bondline': 'Beta 0.1.1',
  'dock': 'Beta 0.1.1',
  'positioning-kit': 'Beta 0.1.1',
  'brain-matrix': 'Beta 0.1.1',
  'slicer': 'Beta 0.1.1'
};
/* Display text: "Beta 0.1.1" stays as is; a bare number such as "0.4" becomes "v0.4". */
window.cpVer = function (v) { return /^\d/.test(v) ? 'v' + v : v; };

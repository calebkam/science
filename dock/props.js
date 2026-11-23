/* ============================ props.js ============================
   Drug-likeness and oral-bioavailability estimates for a prepared molecule (explicit hydrogens), in the spirit of SwissADME.
   props(mol) -> { mw, hbd, hba, tpsa, rb, fsp3, logp, logs, ... , lipinski:{...}, veber:{...}, egan:{...}, radar:[...] }
   Everything is computed in the browser. logP is Moriguchi MLOGP, solubility is Delaney ESOL, TPSA follows Ertl et al.
   These are quick estimates: SwissADME consensus logP (iLOGP, XLOGP3, WLOGP, MLOGP, SILICOS-IT) is not reproduced.        */
(function (root) {
'use strict';
var MASS = { H: 1.008, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Se: 78.971, Br: 79.904, I: 126.904 };
var CXW = { C: 1, F: 0.5, Cl: 1, Br: 1.5, I: 2 };

function props(mol) {
  var at = mol.atoms, bd = mol.bonds, nb = mol.nb, n = at.length;
  var heavy = []; for (var i = 0; i < n; i++) if (at[i].el !== 'H') heavy.push(i);
  var el = function (i) { return at[i].el; };
  var nH = function (i) { return nb[i].filter(function (k) { return el(k.j) === 'H'; }).length; };
  var hv = function (i) { return nb[i].filter(function (k) { return el(k.j) !== 'H'; }); };
  var bo = function (k) { return bd[k.b].o; };
  var mw = 0; at.forEach(function (a) { mw += MASS[a.el] || 0; });
  var counts = {}; heavy.forEach(function (i) { counts[el(i)] = (counts[el(i)] || 0) + 1; });
  var P = { mw: mw, heavy: heavy.length, counts: counts };
  /* donors and acceptors, Lipinski style: NH and OH counts, and all N and O atoms */
  P.hbd = 0; P.hba = 0;
  heavy.forEach(function (i) { if (el(i) === 'N' || el(i) === 'O') { P.hba++; if (!(at[i].q > 0)) P.hbd += nH(i); } }); /* a protonated amine is counted as the neutral amine */
  P.arom = heavy.filter(function (i) { return at[i].arom; }).length;
  var cs = heavy.filter(function (i) { return el(i) === 'C'; });
  P.fsp3 = cs.length ? cs.filter(function (i) { return at[i].hyb === 3; }).length / cs.length : 0;
  P.rings = mol.rings ? mol.rings.length : 0;
  /* nitro groups */
  var nitro = {}, nNitro = 0;
  heavy.forEach(function (i) { if (el(i) === 'N') { var os = hv(i).filter(function (k) { return el(k.j) === 'O'; }); if (os.length === 2 && hv(i).length === 3 - (0) || (os.length === 2 && hv(i).length >= 2)) { nitro[i] = 1; nNitro++; os.forEach(function (k) { nitro[k.j] = 1; }); } } });
  /* TPSA (Ertl, with S) */
  var t = 0, done = {};
  heavy.forEach(function (i) {
    var e = el(i); if (e !== 'N' && e !== 'O' && e !== 'S') return;
    if (nitro[i]) { if (e === 'N') t += 43.14; return; }
    var h = nH(i), a = at[i], conn = nb[i].length, dbl = nb[i].some(function (k) { return bo(k) === 2; }), tri = nb[i].some(function (k) { return bo(k) === 3; }), q = a.q || 0;
    if (e === 'N') {
      if (q > 0) t += conn >= 4 ? [0, 4.44, 16.61, 27.64][Math.min(h, 3)] : 3.01;
      else if (a.arom) t += h ? 15.79 : conn >= 3 ? 4.41 : 12.89;
      else if (tri) t += 23.79;
      else if (dbl) t += h ? 23.85 : 12.36;
      else t += [3.24, 12.03, 26.02, 27.64][Math.min(h, 3)];
    } else if (e === 'O') {
      if (q < 0) t += 23.06; else if (a.arom) t += 13.14; else if (dbl) t += 17.07; else t += h ? 20.23 : 9.23;
    } else {
      var dO = nb[i].filter(function (k) { return el(k.j) === 'O' && bo(k) === 2; }).length;
      if (a.arom) t += 28.24; else if (dO >= 2) t += 8.38; else if (dO === 1) t += 21.70; else if (dbl) t += 32.09; else t += h ? 38.80 : 25.30;
    }
  });
  P.tpsa = t;
  /* rotatable bonds: single, acyclic, non-terminal, not an amide C-N, not next to a triple bond */
  var rbs = 0;
  bd.forEach(function (b) {
    if (b.o !== 1 || b.ring || el(b.a) === 'H' || el(b.b) === 'H') return;
    if (hv(b.a).length < 2 || hv(b.b).length < 2) return;
    var isAmide = function (c, x) { return el(c) === 'C' && el(x) === 'N' && nb[c].some(function (k) { return (el(k.j) === 'O' || el(k.j) === 'S') && bo(k) === 2; }); };
    if (isAmide(b.a, b.b) || isAmide(b.b, b.a)) return;
    var trip = function (i) { return nb[i].some(function (k) { return bo(k) === 3; }); };
    if (trip(b.a) || trip(b.b)) return;
    rbs++;
  });
  P.rb = rbs;
  /* Moriguchi MLOGP */
  var CX = 0; heavy.forEach(function (i) { CX += CXW[el(i)] || 0; });
  var NO = (counts.N || 0) + (counts.O || 0);
  var isNO = function (i) { return el(i) === 'N' || el(i) === 'O'; };
  var PRX = 0, amideFix = 0;
  bd.forEach(function (b) { if (isNO(b.a) && isNO(b.b)) PRX += 2; });
  heavy.forEach(function (a) { if (['C', 'S', 'P'].indexOf(el(a)) < 0) return; var ns = hv(a).filter(function (k) { return isNO(k.j); }); for (var x = 0; x < ns.length; x++) for (var y = x + 1; y < ns.length; y++) PRX += 1;
    if (el(a) === 'C' && ns.some(function (k) { return el(k.j) === 'N'; }) && ns.some(function (k) { return el(k.j) === 'O' && bo(k) === 2; })) amideFix++;
    if (el(a) === 'S' && ns.some(function (k) { return el(k.j) === 'N'; }) && ns.filter(function (k) { return el(k.j) === 'O' && bo(k) === 2; }).length >= 2) amideFix++; });
  PRX -= amideFix;
  var UB = 0; bd.forEach(function (b) { if (nitro[b.a] && nitro[b.b]) return; if (el(b.a) === 'H' || el(b.b) === 'H') return; UB += b.o - 1; });
  var POL = 0; heavy.forEach(function (i) { if (!at[i].arom) return; hv(i).forEach(function (k) { if (!at[k.j].arom && ['N', 'O', 'F', 'Cl', 'Br', 'I', 'S'].indexOf(el(k.j)) >= 0) POL++; }); }); POL = Math.min(POL, 4);
  var onlyCH = heavy.every(function (i) { return el(i) === 'C'; }), ALK = onlyCH && UB <= 1 ? 1 : 0;
  var RNG = 0; (mol.rings || []).forEach(function (r) { if (!(r.length === 6 && r.every(function (i) { return at[i].arom && el(i) === 'C'; }))) RNG = 1; });
  var QN = heavy.some(function (i) { return el(i) === 'N' && at[i].q > 0 && !nitro[i] && hv(i).length >= 4; }) ? 1 : 0; /* quaternary only: a protonated amine counts as an amine */
  var acid = heavy.filter(function (i) { return el(i) === 'C' && nb[i].some(function (k) { return el(k.j) === 'O' && bo(k) === 2; }) && nb[i].some(function (k) { return el(k.j) === 'O' && bo(k) === 1 && nH(k.j) >= 1; }); });
  var amine = heavy.filter(function (i) { return el(i) === 'N' && !at[i].arom && nb[i].every(function (k) { return bo(k) === 1; }) && !hv(i).some(function (k) { return nb[k.j].some(function (m) { return bo(m) === 2 && el(m.j) === 'O'; }); }); });
  var AMP = 0;
  acid.forEach(function (c) { amine.forEach(function (N) { if (hv(N).some(function (k) { return hv(k.j).some(function (m) { return m.j === c; }); })) AMP = 1; }); });
  var NCS = 0, BLM = 0;
  (mol.rings || []).forEach(function (r) { if (r.length === 4 && r.some(function (i) { return el(i) === 'N'; }) && r.some(function (i) { return nb[i].some(function (k) { return el(k.j) === 'O' && bo(k) === 2; }); })) BLM = 1; });
  var ml = 1.244 * Math.pow(CX, 0.6) - 1.017 * Math.pow(NO, 0.9) + 0.406 * PRX - 0.145 * Math.pow(Math.max(UB, 0), 0.8) + 0.511 * 0 + 0.268 * POL - 2.215 * AMP + 0.912 * ALK - 0.392 * RNG - 3.684 * QN + 0.474 * nNitro + 1.582 * NCS - 0.773 * BLM - 1.041;
  P.logp = ml;
  /* ESOL (Delaney 2004) */
  var ap = heavy.length ? P.arom / heavy.length : 0;
  P.logs = 0.16 - 0.63 * ml - 0.0062 * mw + 0.066 * P.rb - 0.74 * ap;
  P.solClass = P.logs > -2 ? 'very soluble' : P.logs > -4 ? 'soluble' : P.logs > -6 ? 'moderately soluble' : P.logs > -10 ? 'poorly soluble' : 'insoluble';
  /* rule sets */
  var L = { mw: mw <= 500, logp: ml <= 4.15, hba: P.hba <= 10, hbd: P.hbd <= 5 };
  L.violations = ['mw', 'logp', 'hba', 'hbd'].filter(function (k) { return !L[k]; }).length; L.pass = L.violations <= 1;
  P.lipinski = L;
  P.veber = { rb: P.rb <= 10, tpsa: P.tpsa <= 140 }; P.veber.pass = P.veber.rb && P.veber.tpsa;
  P.egan = { logp: ml <= 5.88, tpsa: P.tpsa <= 131.6 }; P.egan.pass = P.egan.logp && P.egan.tpsa;
  /* physicochemical radar, with the optimal windows SwissADME uses (lipophilicity here is MLOGP) */
  P.radar = [
    { key: 'LIPO', name: 'Lipophilicity', val: ml, lo: -0.7, hi: 5.0, min: -2, max: 6, unit: 'MLOGP' },
    { key: 'SIZE', name: 'Size', val: mw, lo: 150, hi: 500, min: 100, max: 600, unit: 'MW' },
    { key: 'POLAR', name: 'Polarity', val: P.tpsa, lo: 20, hi: 130, min: 0, max: 150, unit: 'TPSA' },
    { key: 'INSOLU', name: 'Insolubility', val: -P.logs, lo: 0, hi: 6, min: -1, max: 9, unit: '−logS' },
    { key: 'INSATU', name: 'Saturation', val: P.fsp3, lo: 0.25, hi: 1, min: 0, max: 1, unit: 'Fsp3' },
    { key: 'FLEX', name: 'Flexibility', val: P.rb, lo: 0, hi: 9, min: 0, max: 15, unit: 'rot. bonds' }
  ];
  P.radar.forEach(function (r) { r.ok = r.val >= r.lo && r.val <= r.hi; });
  P.radarOk = P.radar.filter(function (r) { return r.ok; }).length;
  /* simple absorption flags (heuristics, not the BOILED-Egg model) */
  P.gi = P.tpsa <= 140 && P.rb <= 10 && L.violations <= 1 ? 'likely high' : 'likely low';
  P.bbb = P.tpsa <= 90 && mw <= 450 && P.hbd <= 3 ? 'likely' : 'unlikely';
  return P;
}
var API = { props: props };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Props = API;
})(typeof self !== 'undefined' ? self : this);

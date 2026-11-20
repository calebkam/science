/* ============================ chem.js ============================
   2D molfile (from Bondline) -> hydrogens -> 3D -> force-field minimisation.
   Units: Angstrom, kJ/mol. Pure functions, no DOM.                      */
(function (root) {
'use strict';
const PI = Math.PI, hyp = Math.hypot, D2R = PI / 180, KCAL = 4.184;

/* mass, covalent radius, UFF half vdW distance, UFF well depth (kcal/mol), valence */
const EL = {
  H:{m:1.008,cr:.31,r:1.443,e:.044,v:1}, B:{m:10.81,cr:.84,r:2.04,e:.18,v:3}, C:{m:12.011,cr:.76,r:1.926,e:.105,v:4},
  N:{m:14.007,cr:.71,r:1.83,e:.069,v:3}, O:{m:15.999,cr:.66,r:1.75,e:.06,v:2}, F:{m:18.998,cr:.57,r:1.682,e:.05,v:1},
  Si:{m:28.085,cr:1.11,r:2.148,e:.402,v:4}, P:{m:30.974,cr:1.07,r:2.074,e:.305,v:3}, S:{m:32.06,cr:1.05,r:2.018,e:.274,v:2},
  Cl:{m:35.45,cr:1.02,r:1.974,e:.227,v:1}, Se:{m:78.971,cr:1.2,r:2.102,e:.291,v:2}, Br:{m:79.904,cr:1.2,r:2.095,e:.251,v:1},
  I:{m:126.904,cr:1.39,r:2.25,e:.339,v:1}};

/* ---------- small vector helpers on flat Float64Array ---------- */
const sub = (a, i, j, o) => { o[0] = a[3*i]-a[3*j]; o[1] = a[3*i+1]-a[3*j+1]; o[2] = a[3*i+2]-a[3*j+2]; };
const dot = (u, v) => u[0]*v[0]+u[1]*v[1]+u[2]*v[2];
const cross = (u, v, o) => { o[0]=u[1]*v[2]-u[2]*v[1]; o[1]=u[2]*v[0]-u[0]*v[2]; o[2]=u[0]*v[1]-u[1]*v[0]; };
const nrm = v => { const h = hyp(v[0], v[1], v[2]) || 1; return [v[0]/h, v[1]/h, v[2]/h]; };

/* ---------- molfile ---------- */
function parseMol(text, opt = {}) {
  const ln = text.replace(/\r/g, '').split('\n');
  if (!/V2000/.test(ln[3] || '')) throw new Error('Expected a V2000 molfile.');
  const na = parseInt(ln[3].substr(0, 3)), nb = parseInt(ln[3].substr(3, 3));
  if (!(na > 0)) throw new Error('The drawing has no atoms.');
  const atoms = [], bonds = [];
  for (let i = 0; i < na; i++) {
    const l = ln[4 + i], el = l.substr(31, 3).trim();
    const bad = !EL[el];
    if (bad && !opt.lenient) throw new Error(el === 'A' ? 'A custom label (R, Boc, Ph ...) cannot be modelled in 3D. Replace it with real atoms.' : 'Element "' + el + '" is not supported in 3D.');
    atoms.push({ el: bad ? 'C' : el, custom: bad ? (el === 'A' ? 'custom label' : el) : undefined, x: parseFloat(l.substr(0, 10)), y: parseFloat(l.substr(10, 10)), z: parseFloat(l.substr(20, 10)) || 0, q: 0, rad: 0 });
  }
  for (let i = 0; i < nb; i++) {
    const l = ln[4 + na + i];
    bonds.push({ a: parseInt(l.substr(0, 3)) - 1, b: parseInt(l.substr(3, 3)) - 1, o: Math.min(3, Math.max(1, parseInt(l.substr(6, 3)))), st: parseInt(l.substr(9, 3)) || 0 });
  }
  for (const l of ln) {
    if (/^M  CHG/.test(l)) { const n = parseInt(l.substr(6, 3)); for (let i = 0; i < n; i++) { const k = parseInt(l.substr(10 + i*8, 4)) - 1, v = parseInt(l.substr(14 + i*8, 4)); if (atoms[k]) atoms[k].q = v; } }
    if (/^M  RAD/.test(l)) { const n = parseInt(l.substr(6, 3)); for (let i = 0; i < n; i++) { const k = parseInt(l.substr(10 + i*8, 4)) - 1; if (atoms[k]) atoms[k].rad = 1; } }
  }
  return { atoms, bonds };
}
function splitComponents(m) {
  const n = m.atoms.length, nb = Array.from({ length: n }, () => []);
  m.bonds.forEach((b, i) => { nb[b.a].push(b.b); nb[b.b].push(b.a); });
  const comp = new Array(n).fill(-1); let nc = 0;
  for (let i = 0; i < n; i++) if (comp[i] < 0) { const q = [i]; comp[i] = nc; while (q.length) { const a = q.pop(); for (const c of nb[a]) if (comp[c] < 0) { comp[c] = nc; q.push(c); } } nc++; }
  const out = [];
  for (let c = 0; c < nc; c++) {
    const map = {}, atoms = [];
    m.atoms.forEach((a, i) => { if (comp[i] === c) { map[i] = atoms.length; atoms.push({ ...a }); } });
    const bonds = m.bonds.filter(b => comp[b.a] === c).map(b => ({ ...b, a: map[b.a], b: map[b.b] }));
    out.push({ atoms, bonds });
  }
  return out;
}

/* ---------- perception ---------- */
function adjacency(atoms, bonds) {
  const nb = atoms.map(() => []);
  bonds.forEach((b, i) => { nb[b.a].push({ j: b.b, b: i }); nb[b.b].push({ j: b.a, b: i }); });
  return nb;
}
function findRings(nAtoms, bonds, nb, maxSize = 9) {
  const rings = new Map();
  bonds.forEach((bd, bi) => {
    const prev = { [bd.a]: -1 }; let fr = [bd.a], found = false;
    for (let d = 0; d < maxSize && fr.length && !found; d++) {
      const nx = [];
      for (const id of fr) { for (const k of nb[id]) { if (k.b === bi) continue; if (k.j in prev) continue; prev[k.j] = id; if (k.j === bd.b) { found = true; break; } nx.push(k.j); } if (found) break; }
      fr = nx;
    }
    if (found) { const path = []; let c = bd.b; while (c !== -1) { path.push(c); c = prev[c]; } const key = [...path].sort((x, y) => x - y).join(','); if (!rings.has(key)) rings.set(key, path); }
  });
  return [...rings.values()];
}

/* Builds the full 3D-ready molecule: explicit hydrogens, ring/aromatic/hybridisation perception, starting coordinates. */
function prepare(m2) {
  const atoms = m2.atoms.map(a => ({ ...a, z: a.z || 0, h: false })), bonds = m2.bonds.map(b => ({ ...b }));
  const nHeavy = atoms.length;
  /* 2D wedge/hash flags -> z of the far atom, so stereochemistry survives */
  for (const b of bonds) if (b.st === 1 || b.st === 6) { atoms[b.b].z += (b.st === 1 ? 1 : -1) * 0.9; }
  let nb = adjacency(atoms, bonds);
  const rings = findRings(nHeavy, bonds, nb);
  const dbl = i => nb[i].some(k => bonds[k.b].o === 2);
  const inRing = new Array(nHeavy).fill(false); rings.forEach(r => r.forEach(i => inRing[i] = true));
  /* aromatic rings: Hueckel 4n+2 on 5/6-rings of sp2-capable atoms */
  const arom = new Array(nHeavy).fill(false), aromB = new Set();
  for (const r of rings) {
    if (r.length !== 5 && r.length !== 6) continue;
    let pi = 0, ok = true;
    for (const i of r) {
      const a = atoms[i], dbs = nb[i].filter(k => bonds[k.b].o === 2);
      const dpartnerInRing = dbs.some(k => inRing[k.j]);
      const allSingle = nb[i].every(k => bonds[k.b].o === 1);
      if (dpartnerInRing) pi += 1;
      else if (dbs.length === 0 && ((a.el === 'N' && a.q === 0) || a.el === 'O' || a.el === 'S' || a.el === 'Se') && allSingle) pi += 2;
      else if (dbs.length === 0 && a.el === 'C' && a.q < 0 && allSingle) pi += 2;
      else { ok = false; break; }
    }
    if (ok && (pi - 2) % 4 === 0 && pi >= 6) {
      r.forEach(i => arom[i] = true);
      for (let t = 0; t < r.length; t++) { const x = r[t], y = r[(t + 1) % r.length]; bonds.forEach((bd, bi) => { if ((bd.a === x && bd.b === y) || (bd.a === y && bd.b === x)) aromB.add(bi); }); }
    }
  }
  bonds.forEach((b, i) => b.arom = aromB.has(i));
  /* hybridisation (heavy atoms) */
  const hyb = new Array(nHeavy).fill(3), pl = new Array(nHeavy).fill(false);
  for (let i = 0; i < nHeavy; i++) {
    const a = atoms[i], ds = nb[i].filter(k => bonds[k.b].o === 2).length, ts = nb[i].filter(k => bonds[k.b].o === 3).length;
    if ((ts || ds >= 2) && (a.el === 'C' || a.el === 'N') && nb[i].length <= 2) hyb[i] = 1;
    else if (ds || ts || arom[i]) hyb[i] = 2;
  }
  for (let i = 0; i < nHeavy; i++) {
    const a = atoms[i]; if (hyb[i] !== 3) { pl[i] = hyb[i] === 2; continue; }
    if (!['N', 'O', 'S', 'Se'].includes(a.el) || a.q > 0) continue;
    const conj = nb[i].some(k => { const n = atoms[k.j]; return (n.el === 'C' || n.el === 'N') && hyb[k.j] <= 2; });
    const small = rings.some(r => r.length === 3 && r.includes(i));
    if (conj && !small) { hyb[i] = 2; pl[i] = a.el === 'N'; }
  }
  /* implicit hydrogens (same rule as Bondline) */
  const valOf = i => { const a = atoms[i], v = EL[a.el].v; let bo = 0; for (const k of nb[i]) bo += bonds[k.b].o;
    const tv = (a.el === 'C' || a.el === 'Si') ? v - Math.abs(a.q) : a.el === 'B' ? v - a.q : v + a.q; return tv - bo - a.rad; };
  const pos = i => [atoms[i].x, atoms[i].y, atoms[i].z];
  const unit = (p, q) => nrm([q[0]-p[0], q[1]-p[1], q[2]-p[2]]);
  const perp = u => { const t = Math.abs(u[0]) < 0.9 ? [1,0,0] : [0,1,0], o = [0,0,0]; cross(u, t, o); return nrm(o); };
  const ZERO = [0,0,0];
  for (let i = 0; i < nHeavy; i++) {
    const nH = Math.max(0, valOf(i)); if (!nH) continue;
    const p = pos(i), us = nb[i].map(k => unit(p, pos(k.j))), n = us.length, dirs = [];
    const h = hyb[i];
    if (n === 0) { const base = [[1,0,0],[-.33,.94,0],[-.33,-.47,.82],[-.33,-.47,-.82]]; for (let k = 0; k < nH; k++) dirs.push(base[k % 4]); }
    else if (h === 1) dirs.push([-us[0][0], -us[0][1], -us[0][2]]);
    else if (h === 2) {
      if (n === 1) {
        let nrmv = [0,0,1]; const nbr = nb[i][0].j, w = nb[nbr].find(k => k.j !== i);
        if (w) { const u2 = unit(pos(nbr), pos(w.j)); const t = [0,0,0]; cross(us[0], u2, t); if (hyp(t[0], t[1], t[2]) > 0.2) nrmv = nrm(t); }
        const t = [0,0,0]; cross(nrmv, us[0], t); const tt = nrm(t);
        const c = Math.cos(120*D2R), s = Math.sin(120*D2R);
        dirs.push([c*us[0][0] + s*tt[0], c*us[0][1] + s*tt[1], c*us[0][2] + s*tt[2]]);
        if (nH > 1) dirs.push([c*us[0][0] - s*tt[0], c*us[0][1] - s*tt[1], c*us[0][2] - s*tt[2]]);
      } else { const s = [0,0,0]; us.forEach(u => { s[0] += u[0]; s[1] += u[1]; s[2] += u[2]; }); dirs.push(nrm([-s[0], -s[1], -s[2]])); }
    } else {
      if (n === 1) {
        const ax = us[0], p1 = perp(ax), p2 = [0,0,0]; cross(ax, p1, p2);
        const cc = Math.cos(PI - 109.47*D2R), ss = Math.sin(PI - 109.47*D2R);
        for (let k = 0; k < nH; k++) { const ph = k * 2 * PI / 3, d = [0,0,0];
          for (let q = 0; q < 3; q++) d[q] = -ax[q] * cc + ss * (Math.cos(ph) * p1[q] + Math.sin(ph) * p2[q]);
          dirs.push(d); }
      } else if (n === 2) {
        const b = nrm([-(us[0][0]+us[1][0]), -(us[0][1]+us[1][1]), -(us[0][2]+us[1][2])]); let pp = [0,0,0]; cross(us[0], us[1], pp);
        pp = hyp(pp[0], pp[1], pp[2]) > 1e-3 ? nrm(pp) : perp(b);
        const al = 54.74*D2R, c = Math.cos(al), s = Math.sin(al);
        dirs.push([b[0]*c + pp[0]*s, b[1]*c + pp[1]*s, b[2]*c + pp[2]*s]);
        if (nH > 1) dirs.push([b[0]*c - pp[0]*s, b[1]*c - pp[1]*s, b[2]*c - pp[2]*s]);
      } else { const s = [0,0,0]; us.forEach(u => { s[0] += u[0]; s[1] += u[1]; s[2] += u[2]; }); dirs.push(nrm([-s[0], -s[1], -s[2]])); }
    }
    for (let k = 0; k < Math.min(nH, dirs.length || nH); k++) {
      const d = dirs[k] || dirs[dirs.length - 1], len = (EL[atoms[i].el].cr + EL.H.cr + (atoms[i].el === 'C' ? .02 : 0));
      const hid = atoms.length; atoms.push({ el: 'H', x: p[0] + d[0]*len, y: p[1] + d[1]*len, z: p[2] + d[2]*len, q: 0, rad: 0, h: true, parent: i });
      bonds.push({ a: i, b: hid, o: 1, st: 0, arom: false });
    }
  }
  nb = adjacency(atoms, bonds);
  const n = atoms.length;
  const H = new Array(n).fill(0); for (let i = 0; i < nHeavy; i++) { hyb[i] = hyb[i]; }
  const fullHyb = new Array(n).fill(0), fullPl = new Array(n).fill(false), fullArom = new Array(n).fill(false);
  for (let i = 0; i < nHeavy; i++) { fullHyb[i] = hyb[i]; fullPl[i] = pl[i]; fullArom[i] = arom[i]; atoms[i].h = false; }
  atoms.forEach((a, i) => { a.hyb = fullHyb[i]; a.arom = fullArom[i]; a.pl = fullPl[i]; });
  const ringBond = new Set(); rings.forEach(r => { for (let t = 0; t < r.length; t++) { const x = r[t], y = r[(t+1) % r.length]; bonds.forEach((bd, bi) => { if ((bd.a === x && bd.b === y) || (bd.a === y && bd.b === x)) ringBond.add(bi); }); } });
  bonds.forEach((b, i) => b.ring = ringBond.has(i));
  return { atoms, bonds, nb, rings, nHeavy, ringBond };
}

/* ---------- force field topology ---------- */
function bondLen(mol, bi) {
  const b = mol.bonds[bi], A = mol.atoms[b.a], B = mol.atoms[b.b];
  let r = EL[A.el].cr + EL[B.el].cr;
  const hasSP = A.el === 'S' || A.el === 'P' || B.el === 'S' || B.el === 'P';
  if (A.el === 'H' || B.el === 'H') { if (A.el === 'C' || B.el === 'C') r += 0.02; return r; }
  if (b.arom) return r - (A.el === 'C' && B.el === 'C' ? 0.13 : A.el === 'N' || B.el === 'N' ? 0.13 : 0.07);
  if (b.o === 3) return r - 0.32;
  if (b.o === 2) return r - (hasSP ? 0.26 : A.el === 'N' || B.el === 'N' || A.el === 'O' || B.el === 'O' ? 0.19 : 0.18);
  if (A.hyb && B.hyb && A.hyb <= 2 && B.hyb <= 2) { const het = ['N','O'].includes(A.el) || ['N','O'].includes(B.el); return r - (het ? 0.1 : 0.04); }
  return r;
}
function buildTopology(mol) {
  const { atoms, bonds, nb } = mol, n = atoms.length, T = {};
  T.n = n;
  T.bi = []; T.br0 = []; T.bk = [];
  bonds.forEach((b, i) => { T.bi.push(b.a, b.b); T.br0.push(bondLen(mol, i)); T.bk.push(2600); });
  /* angles */
  T.ai = []; T.ath = []; T.ak = []; T.alin = [];
  const ringsOf = i => mol.rings.filter(r => r.includes(i));
  for (let c = 0; c < n; c++) {
    const a = atoms[c], ns = nb[c]; if (ns.length < 2) continue;
    for (let x = 0; x < ns.length; x++) for (let y = x + 1; y < ns.length; y++) {
      const j = ns[x].j, k = ns[y].j; let th;
      if (a.hyb === 1) th = 180;
      else if (a.hyb === 2) th = 120;
      else if (a.el === 'O') th = 109.5; else if (a.el === 'S' || a.el === 'Se') th = ns.length > 2 ? 109.5 : 99; else if (a.el === 'P') th = 100;
      else th = 109.47;
      /* ring angles */
      for (const r of ringsOf(c)) { const L = r.length, p = r.indexOf(c), pr = r[(p + L - 1) % L], nx = r[(p + 1) % L];
        if ((j === pr && k === nx) || (j === nx && k === pr)) { if (L === 3) th = 60; else if (L === 4) th = 90; else if (L === 5) th = a.hyb === 2 ? 108 : 104.5; else if (L === 6) th = a.hyb === 2 ? 120 : 111; break; } }
      const withH = atoms[j].el === 'H' || atoms[k].el === 'H';
      T.ai.push(j, c, k); T.ath.push(th * D2R); T.ak.push(withH ? 250 : 400); T.alin.push(th === 180 ? 1 : 0);
    }
  }
  /* torsions: [i,j,k,l], n, V, delta */
  T.ti = []; T.tn = []; T.tv = []; T.td = [];
  bonds.forEach((b, bi) => {
    const j = b.a, k = b.b; const nj = nb[j].filter(q => q.j !== k), nk = nb[k].filter(q => q.j !== j); if (!nj.length || !nk.length) return;
    const A = atoms[j], B = atoms[k]; let nn = 0, V = 0, d = 0;
    if (b.o === 2 || b.arom) { nn = 2; V = b.arom ? 60 : 120; d = PI; }
    else if (b.o === 1 && A.hyb && B.hyb && A.hyb === 2 && B.hyb === 2) {
      const amide = (A.el === 'N' && B.el === 'C') || (A.el === 'C' && B.el === 'N'); const cn = amide && ((A.el === 'C' ? nb[j] : nb[k]).some(q => atoms[q.j].el === 'O' && bonds[q.b].o === 2));
      nn = 2; V = cn ? 80 : 14; d = PI;
    } else if (b.o === 1 && A.hyb === 3 && B.hyb === 3) { nn = 3; V = 2.0; d = 0; }
    if (!nn) return;
    for (const x of nj) for (const y of nk) { if (x.j === y.j) continue; T.ti.push(x.j, j, k, y.j); T.tn.push(nn); T.tv.push(V); T.td.push(d); }
  });
  /* planarity (improper volume) for sp2 centres with 3 neighbours */
  T.oi = []; T.ok = [];
  for (let c = 0; c < n; c++) { const a = atoms[c]; if (a.hyb === 2 && nb[c].length === 3 && a.el !== 'O' && a.el !== 'S') { T.oi.push(c, nb[c][0].j, nb[c][1].j, nb[c][2].j); T.ok.push(a.pl || a.el === 'C' ? 600 : 300); } }
  /* vdW pairs (>= 1-4) */
  const sep = Array.from({ length: n }, () => new Int8Array(n).fill(9));
  for (let s = 0; s < n; s++) { sep[s][s] = 0; let fr = [s]; for (let d = 1; d <= 3; d++) { const nx = []; for (const u of fr) for (const k of nb[u]) if (sep[s][k.j] === 9) { sep[s][k.j] = d; nx.push(k.j); } fr = nx; } }
  T.pi = []; T.pe = []; T.pr = []; T.ps = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const sp = sep[i][j]; if (sp < 3) continue;
    const A = EL[atoms[i].el], B = EL[atoms[j].el]; T.pi.push(i, j); T.pe.push(Math.sqrt(A.e * B.e) * KCAL); T.pr.push(A.r + B.r); T.ps.push(sp === 3 ? 0.5 : 1); }
  for (const k of ['bi','ai','ti','oi','pi','alin','tn']) T[k] = Int32Array.from(T[k]);
  for (const k of ['br0','bk','ath','ak','tv','td','ok','pe','pr','ps']) T[k] = Float64Array.from(T[k]);
  return T;
}

/* ---------- energy and gradient ---------- */
const _u = [0,0,0], _v = [0,0,0], _F = [0,0,0], _G = [0,0,0], _H = [0,0,0], _A = [0,0,0], _B = [0,0,0], _t = [0,0,0];
function energy(x, T, g, parts) {
  const P = { bond: 0, angle: 0, tors: 0, oop: 0, vdw: 0 }; if (g) g.fill(0);
  /* bonds */
  for (let b = 0; b < T.bi.length / 2; b++) {
    const i = T.bi[2*b], j = T.bi[2*b+1]; sub(x, i, j, _u); const r = hyp(_u[0], _u[1], _u[2]) || 1e-9, d = r - T.br0[b];
    P.bond += 0.5 * T.bk[b] * d * d;
    if (g) { const f = T.bk[b] * d / r; for (let q = 0; q < 3; q++) { g[3*i+q] += f * _u[q]; g[3*j+q] -= f * _u[q]; } }
  }
  /* angles */
  for (let a = 0; a < T.ai.length / 3; a++) {
    const i = T.ai[3*a], c = T.ai[3*a+1], k = T.ai[3*a+2]; sub(x, i, c, _u); sub(x, k, c, _v);
    const lu = hyp(_u[0], _u[1], _u[2]) || 1e-9, lv = hyp(_v[0], _v[1], _v[2]) || 1e-9; let cs = dot(_u, _v) / (lu * lv); cs = Math.max(-1, Math.min(1, cs));
    let dEdc;
    if (T.alin[a]) { P.angle += 120 * (1 + cs); dEdc = 120; }
    else { const th = Math.acos(cs); P.angle += 0.5 * T.ak[a] * (th - T.ath[a]) ** 2; const s = Math.max(1e-3, Math.sin(th)); dEdc = -T.ak[a] * (th - T.ath[a]) / s; }
    if (g) for (let q = 0; q < 3; q++) {
      const d1 = _v[q] / (lu * lv) - cs * _u[q] / (lu * lu), d3 = _u[q] / (lu * lv) - cs * _v[q] / (lv * lv);
      g[3*i+q] += dEdc * d1; g[3*k+q] += dEdc * d3; g[3*c+q] -= dEdc * (d1 + d3);
    }
  }
  /* torsions */
  for (let t = 0; t < T.ti.length / 4; t++) {
    const i = T.ti[4*t], j = T.ti[4*t+1], k = T.ti[4*t+2], l = T.ti[4*t+3];
    sub(x, i, j, _F); sub(x, j, k, _G); sub(x, l, k, _H); cross(_F, _G, _A); cross(_H, _G, _B);
    const A2 = dot(_A, _A), B2 = dot(_B, _B), Gl = hyp(_G[0], _G[1], _G[2]); if (A2 < 1e-8 || B2 < 1e-8 || Gl < 1e-6) continue;
    const cs = dot(_A, _B) / Math.sqrt(A2 * B2); cross(_B, _A, _t); const sn = dot(_t, _G) / (Math.sqrt(A2 * B2) * Gl);
    const phi = Math.atan2(sn, cs), n = T.tn[t], V = T.tv[t], d = T.td[t];
    P.tors += 0.5 * V * (1 + Math.cos(n * phi - d));
    if (g) {
      const dE = -0.5 * V * n * Math.sin(n * phi - d), FG = dot(_F, _G), HG = dot(_H, _G);
      for (let q = 0; q < 3; q++) {
        const d1 = -Gl / A2 * _A[q], d4 = Gl / B2 * _B[q], d2 = Gl / A2 * _A[q] + FG / (A2 * Gl) * _A[q] - HG / (B2 * Gl) * _B[q], d3 = -Gl / B2 * _B[q] - FG / (A2 * Gl) * _A[q] + HG / (B2 * Gl) * _B[q];
        g[3*i+q] += dE * d1; g[3*j+q] += dE * d2; g[3*k+q] += dE * d3; g[3*l+q] += dE * d4;
      }
    }
  }
  /* planarity */
  for (let o = 0; o < T.oi.length / 4; o++) {
    const c = T.oi[4*o], j = T.oi[4*o+1], k = T.oi[4*o+2], l = T.oi[4*o+3];
    const a = [x[3*j]-x[3*c], x[3*j+1]-x[3*c+1], x[3*j+2]-x[3*c+2]], b = [x[3*k]-x[3*c], x[3*k+1]-x[3*c+1], x[3*k+2]-x[3*c+2]], d = [x[3*l]-x[3*c], x[3*l+1]-x[3*c+1], x[3*l+2]-x[3*c+2]];
    const bd = [0,0,0], da = [0,0,0], ab = [0,0,0]; cross(b, d, bd); cross(d, a, da); cross(a, b, ab); const V = dot(a, bd);
    P.oop += 0.5 * T.ok[o] * V * V;
    if (g) { const f = T.ok[o] * V; for (let q = 0; q < 3; q++) { g[3*j+q] += f * bd[q]; g[3*k+q] += f * da[q]; g[3*l+q] += f * ab[q]; g[3*c+q] -= f * (bd[q] + da[q] + ab[q]); } }
  }
  /* vdW */
  for (let p = 0; p < T.pi.length / 2; p++) {
    const i = T.pi[2*p], j = T.pi[2*p+1], dx = x[3*i]-x[3*j], dy = x[3*i+1]-x[3*j+1], dz = x[3*i+2]-x[3*j+2];
    let r2 = dx*dx + dy*dy + dz*dz; if (r2 > 144) continue; if (r2 < 0.36) r2 = 0.36;
    const s2 = T.pr[p] * T.pr[p] / r2, s6 = s2 * s2 * s2, e = T.pe[p] * T.ps[p];
    P.vdw += e * (s6 * s6 - 2 * s6);
    if (g) { const f = e * (-12 * s6 * s6 + 12 * s6) / r2; g[3*i] += f * dx; g[3*i+1] += f * dy; g[3*i+2] += f * dz; g[3*j] -= f * dx; g[3*j+1] -= f * dy; g[3*j+2] -= f * dz; }
  }
  const E = P.bond + P.angle + P.tors + P.oop + P.vdw; if (parts) Object.assign(parts, P); return E;
}

/* ---------- minimiser: steepest descent then conjugate gradient (ChimeraX-style protocol) ---------- */
function minimize(x, T, opt = {}) {
  const sd = opt.sd ?? 100, cg = opt.cg ?? 10, step0 = opt.step ?? 0.02, n3 = x.length, hist = [];
  const g = new Float64Array(n3), xn = new Float64Array(n3), gn = new Float64Array(n3);
  let E = energy(x, T, g); const E0 = E; hist.push(E);
  const maxNorm = v => { let m = 1e-12; for (let i = 0; i < v.length; i += 3) m = Math.max(m, hyp(v[i], v[i+1], v[i+2])); return m; };
  let step = step0;
  for (let it = 0; it < sd; it++) {
    const a = step / maxNorm(g); for (let i = 0; i < n3; i++) xn[i] = x[i] - a * g[i];
    const En = energy(xn, T, gn);
    if (En < E) { x.set(xn); g.set(gn); E = En; step = Math.min(step * 1.2, 0.2); } else step *= 0.5;
    hist.push(E); if (step < 1e-7) break;
  }
  /* conjugate gradient (Polak-Ribiere) with backtracking line search */
  let d = new Float64Array(n3), gOld = new Float64Array(n3);
  for (let i = 0; i < n3; i++) d[i] = -g[i]; gOld.set(g);
  for (let it = 0; it < cg; it++) {
    let slope = 0; for (let i = 0; i < n3; i++) slope += g[i] * d[i];
    if (slope >= 0) { for (let i = 0; i < n3; i++) d[i] = -g[i]; slope = -dot3(g, g); }
    let a = Math.min(0.05, Math.max(step0, 0.02)) / maxNorm(d), ok = false;
    for (let ls = 0; ls < 25; ls++) { for (let i = 0; i < n3; i++) xn[i] = x[i] + a * d[i]; const En = energy(xn, T, gn); if (En < E + 1e-4 * a * slope) { x.set(xn); E = En; ok = true; break; } a *= 0.5; }
    hist.push(E); if (!ok) { for (let i = 0; i < n3; i++) d[i] = -g[i]; continue; }
    energy(x, T, g); let num = 0, den = 0; for (let i = 0; i < n3; i++) { num += g[i] * (g[i] - gOld[i]); den += gOld[i] * gOld[i]; }
    const beta = Math.max(0, num / (den || 1)); gOld.set(g); for (let i = 0; i < n3; i++) d[i] = -g[i] + beta * d[i];
  }
  const parts = {}; E = energy(x, T, null, parts);
  return { E0, E, hist, parts };
}
function dot3(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

/* ---------- conformer search + 3D build ---------- */
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function rotatableBonds(mol) {
  const out = [];
  mol.bonds.forEach((b, bi) => {
    if (b.o !== 1 || b.ring || mol.nb[b.a].length < 2 || mol.nb[b.b].length < 2) return;
    const side = s => { const seen = new Set([s]); const other = s === b.a ? b.b : b.a; seen.add(other); const q = [s]; while (q.length) { const u = q.pop(); for (const k of mol.nb[u]) if (!seen.has(k.j)) { seen.add(k.j); q.push(k.j); } } seen.delete(other); return [...seen]; };
    out.push({ bi, a: b.a, b: b.b, moved: side(b.b) });
  });
  return out;
}
function rotateAbout(x, ia, ib, moved, ang) {
  const ax = [x[3*ib]-x[3*ia], x[3*ib+1]-x[3*ia+1], x[3*ib+2]-x[3*ia+2]], u = nrm(ax), c = Math.cos(ang), s = Math.sin(ang), o = [x[3*ib], x[3*ib+1], x[3*ib+2]];
  for (const m of moved) { const p = [x[3*m]-o[0], x[3*m+1]-o[1], x[3*m+2]-o[2]], d = dot(u, p), cr = [0,0,0]; cross(u, p, cr);
    for (let q = 0; q < 3; q++) x[3*m+q] = o[q] + p[q]*c + cr[q]*s + u[q]*d*(1-c); }
}
function coords(mol) { const x = new Float64Array(mol.atoms.length * 3); mol.atoms.forEach((a, i) => { x[3*i] = a.x; x[3*i+1] = a.y; x[3*i+2] = a.z; }); return x; }
function setCoords(mol, x) { mol.atoms.forEach((a, i) => { a.x = x[3*i]; a.y = x[3*i+1]; a.z = x[3*i+2]; }); }

/* signed volume of every stereo-capable centre (to prove stereochemistry survives) */
function chiralSigns(mol, x) {
  const out = {};
  mol.atoms.forEach((a, i) => { if (a.h || mol.nb[i].length !== 4) return; const ns = mol.nb[i].map(k => k.j); const v = ns.slice(0, 3).map(j => [x[3*j]-x[3*i], x[3*j+1]-x[3*i+1], x[3*j+2]-x[3*i+2]]); const c = [0,0,0]; cross(v[1], v[2], c); out[i] = Math.sign(dot(v[0], c)); });
  return out;
}

/* Full pipeline from a V2000 molfile string. */
function build3D(molText, opt = {}) {
  const parsed = parseMol(molText); return build3DFrom(parsed, opt);
}
function build3DFrom(parsed, opt = {}) {
  const nconf = opt.nconf ?? 10, rnd = mulberry(opt.seed ?? 12345);
  const mol = prepare(parsed), T = buildTopology(mol), rot = rotatableBonds(mol), n = mol.atoms.length;
  const base = coords(mol); let best = null;
  for (let c = 0; c < nconf; c++) {
    const x = Float64Array.from(base);
    for (let i = 0; i < n; i++) { x[3*i] += (rnd() - .5) * 0.3; x[3*i+1] += (rnd() - .5) * 0.3; x[3*i+2] += (rnd() - .5) * 0.3; }
    if (c > 0) for (const r of rot) if (rnd() < 0.7) rotateAbout(x, r.a, r.b, r.moved, rnd() * 2 * PI);
    const res = minimize(x, T, { sd: 120, cg: 30, step: 0.03 });
    if (!best || res.E < best.E) best = { x, E: res.E, hist: res.hist };
    if (opt.onProgress) opt.onProgress((c + 1) / nconf);
  }
  setCoords(mol, best.x); mol.T = T; mol.E = best.E;
  return mol;
}

/* ---------- utilities ---------- */
function formula(mol) {
  const c = {}; let mass = 0; for (const a of mol.atoms) { c[a.el] = (c[a.el] || 0) + 1; mass += EL[a.el].m; }
  const keys = Object.keys(c), ord = c.C ? ['C', ...(c.H ? ['H'] : []), ...keys.filter(k => k !== 'C' && k !== 'H').sort()] : keys.sort();
  const q = mol.atoms.reduce((s, a) => s + a.q, 0);
  return { text: ord.map(k => k + (c[k] > 1 ? c[k] : '')).join('') + (q ? (Math.abs(q) > 1 ? Math.abs(q) : '') + (q > 0 ? '+' : '−') : ''), mass, charge: q, counts: c };
}
function toPDB(mol, name = 'LIG', chain = 'L', resi = 1) {
  const cnt = {}; let s = '';
  mol.atoms.forEach((a, i) => { cnt[a.el] = (cnt[a.el] || 0) + 1; const nm = (a.el + cnt[a.el]).slice(0, 4).padStart(a.el.length === 1 ? 3 : 4, ' ').padEnd(4, ' ').slice(0, 4);
    s += 'HETATM' + String(i + 1).padStart(5) + ' ' + nm + ' ' + name.slice(0, 3).padEnd(3) + ' ' + chain + String(resi).padStart(4) + '    ' + a.x.toFixed(3).padStart(8) + a.y.toFixed(3).padStart(8) + a.z.toFixed(3).padStart(8) + '  1.00  0.00          ' + a.el.toUpperCase().padStart(2) + '\n'; });
  mol.bonds.forEach(b => { s += 'CONECT' + String(b.a + 1).padStart(5) + String(b.b + 1).padStart(5) + '\n'; });
  return s + 'END\n';
}
function toSDF(mol, name = 'ligand') {
  const p = (v, w) => String(v).padStart(w);
  let s = name + '\n  Bondline-Dock 3D\n\n' + p(mol.atoms.length, 3) + p(mol.bonds.length, 3) + '  0  0  0  0  0  0  0  0999 V2000\n';
  for (const a of mol.atoms) s += a.x.toFixed(4).padStart(10) + a.y.toFixed(4).padStart(10) + a.z.toFixed(4).padStart(10) + ' ' + a.el.padEnd(3) + ' 0  0  0  0  0  0  0  0  0  0  0  0\n';
  for (const b of mol.bonds) s += p(b.a + 1, 3) + p(b.b + 1, 3) + p(b.arom ? 1 : b.o, 3) + '  0\n';
  const q = mol.atoms.map((a, i) => [i + 1, a.q]).filter(v => v[1]);
  for (let i = 0; i < q.length; i += 8) { const c = q.slice(i, i + 8); s += 'M  CHG' + p(c.length, 3) + c.map(([k, v]) => p(k, 4) + p(v, 4)).join('') + '\n'; }
  return s + 'M  END\n$$$$\n';
}

const API = { EL, parseMol, splitComponents, prepare, buildTopology, energy, minimize, build3D, build3DFrom, rotatableBonds, rotateAbout, coords, setCoords, chiralSigns, formula, toPDB, toSDF, adjacency, findRings, mulberry };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Chem = API;
})(typeof window !== 'undefined' ? window : globalThis);

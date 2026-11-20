/* ============================ dock.js ============================
   PDB reading, receptor preparation, pocket finding, Vina-style scoring
   (Trott & Olson 2010 functional form), grid maps, Monte Carlo + BFGS search.
   Energies are kcal/mol inside, reported in kJ/mol.                          */
(function (root) {
'use strict';
const Chem = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./chem.js') : root.Chem;
const EL = Chem.EL, KCAL = 4.184, PI = Math.PI;
const W = { g1: -0.0356, g2: -0.00516, rep: 0.840, hyd: -0.0351, hb: -0.587, rot: 0.05846 };
const XSR = { C: 1.9, N: 1.8, O: 1.7, P: 2.1, S: 2.0, F: 1.5, Cl: 1.8, Br: 2.0, I: 2.2, B: 2.0, Si: 2.2, Se: 2.1 };
const CUT = 8;
const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------------- PDB ---------------- */
const TWO = new Set(['Cl','Br','Zn','Mg','Fe','Ca','Na','Mn','Cu','Co','Ni','Se','Li','Cd','Hg','Si','Al','Cs','Rb']);
const WATER = new Set(['HOH','WAT','DOD','H2O','TIP','SOL']);
function parsePDB(text) {
  const atoms = [];
  for (const l of text.split('\n')) {
    if (l.startsWith('ENDMDL')) break;
    const rec = l.substr(0, 6); if (rec !== 'ATOM  ' && rec !== 'HETATM') continue;
    const alt = l[16]; if (alt !== ' ' && alt !== 'A' && alt !== '1') continue;
    const name = l.substr(12, 4).trim(), res = l.substr(17, 3).trim(), chain = l[21] || ' ', resi = parseInt(l.substr(22, 4)), ic = (l[26] || ' ').trim();
    const x = parseFloat(l.substr(30, 8)), y = parseFloat(l.substr(38, 8)), z = parseFloat(l.substr(46, 8)); if (isNaN(x + y + z)) continue;
    let el = l.substr(76, 2).trim();
    if (!el) { const s = name.replace(/[0-9]/g, ''); el = (rec === 'HETATM' && s.length > 1 && TWO.has(s[0] + s[1].toLowerCase())) ? s[0] + s[1].toLowerCase() : s[0]; }
    el = el[0].toUpperCase() + el.slice(1).toLowerCase(); if (el === 'D') el = 'H';
    atoms.push({ name, res, chain, resi, ic, x, y, z, el, het: rec === 'HETATM', key: chain + resi + ic });
  }
  return atoms;
}
function hetGroups(atoms) {
  const g = new Map();
  for (const a of atoms) if (a.het && !WATER.has(a.res)) { let r = g.get(a.key + a.res); if (!r) g.set(a.key + a.res, r = { id: a.key + a.res, res: a.res, chain: a.chain, resi: a.resi, atoms: [] }); r.atoms.push(a); }
  return [...g.values()].map(r => { const h = r.atoms.filter(a => a.el !== 'H'); r.nHeavy = h.length; r.center = centroid(h); return r; });
}
const centroid = L => { const c = [0, 0, 0]; for (const a of L) { c[0] += a.x; c[1] += a.y; c[2] += a.z; } return c.map(v => v / (L.length || 1)); };

/* ---------------- typing ---------------- */
const AA = { HID: 'HIS', HIE: 'HIS', HIP: 'HIS', HSD: 'HIS', HSE: 'HIS', HSP: 'HIS', CYX: 'CYS', CYM: 'CYS', ASH: 'ASP', GLH: 'GLU', LYN: 'LYS' };
function tpl(res, name) {
  res = AA[res] || res; const f = { don: false, acc: false };
  if (name === 'N' && res !== 'PRO') f.don = true;
  if (name === 'O' || name === 'OXT') f.acc = true;
  const set = (n, d, a) => { if (name === n) { f.don = f.don || d; f.acc = f.acc || a; } };
  switch (res) {
    case 'SER': set('OG', 1, 1); break; case 'THR': set('OG1', 1, 1); break; case 'TYR': set('OH', 1, 1); break;
    case 'ASP': set('OD1', 0, 1); set('OD2', 0, 1); break; case 'GLU': set('OE1', 0, 1); set('OE2', 0, 1); break;
    case 'ASN': set('OD1', 0, 1); set('ND2', 1, 0); break; case 'GLN': set('OE1', 0, 1); set('NE2', 1, 0); break;
    case 'HIS': set('ND1', 1, 1); set('NE2', 1, 1); break; case 'LYS': set('NZ', 1, 0); break;
    case 'ARG': set('NE', 1, 0); set('NH1', 1, 0); set('NH2', 1, 0); break; case 'TRP': set('NE1', 1, 0); break;
  }
  return f;
}
const STD = new Set(['ALA','ARG','ASN','ASP','CYS','GLN','GLU','GLY','HIS','ILE','LEU','LYS','MET','PHE','PRO','SER','THR','TRP','TYR','VAL','MSE','HID','HIE','HIP','HSD','HSE','HSP','CYX','CYM','ASH','GLH','LYN']);
const TYPEDEF = {};
function typeKey(el, hyd, don, acc) {
  const sfx = (don && acc) ? 'DA' : don ? 'D' : acc ? 'A' : hyd ? 'H' : 'P', k = el + '_' + sfx;
  if (!TYPEDEF[k]) TYPEDEF[k] = { key: k, el, r: XSR[el] || 1.9, hyd: !!hyd, don: !!don, acc: !!acc };
  return k;
}
const isHet = el => el !== 'C' && el !== 'H';
const HAL = new Set(['F', 'Cl', 'Br', 'I']);
function xsFlags(el, bondedHet, hasH, accHint) {
  let hyd = false, don = false, acc = false;
  if (el === 'C') hyd = !bondedHet; else if (HAL.has(el)) hyd = true;
  else if (el === 'N') { don = hasH; acc = accHint; } else if (el === 'O') { acc = true; don = hasH; }
  return { hyd, don, acc };
}

/* ligand typing from a prepared Chem molecule (with explicit H) */
function ligandTypes(mol) {
  const types = [];
  mol.atoms.forEach((a, i) => {
    if (a.el === 'H') { types.push(null); return; }
    const ns = mol.nb[i], hasH = ns.some(k => mol.atoms[k.j].el === 'H'), bondedHet = ns.some(k => isHet(mol.atoms[k.j].el)), deg = ns.length;
    let accHint = false;
    if (a.el === 'N' && !hasH) { const trip = ns.some(k => mol.bonds[k.b].o === 3), dbl = ns.some(k => mol.bonds[k.b].o === 2); accHint = trip || ((a.arom || dbl) && deg === 2 && a.q === 0); }
    const f = xsFlags(a.el, bondedHet, hasH, accHint);
    types.push(typeKey(a.el, f.hyd, f.don, f.acc));
  });
  return types;
}

/* ---------------- receptor ---------------- */
function bondGraph(atoms) {
  const n = atoms.length, nb = Array.from({ length: n }, () => []), cs = 2.4, cell = new Map();
  atoms.forEach((a, i) => { const k = Math.floor(a.x / cs) + ',' + Math.floor(a.y / cs) + ',' + Math.floor(a.z / cs); let c = cell.get(k); if (!c) cell.set(k, c = []); c.push(i); a._c = [Math.floor(a.x / cs), Math.floor(a.y / cs), Math.floor(a.z / cs)]; });
  atoms.forEach((a, i) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const c = cell.get((a._c[0] + dx) + ',' + (a._c[1] + dy) + ',' + (a._c[2] + dz)); if (!c) continue;
      for (const j of c) { if (j <= i) continue; const b = atoms[j], ea = EL[a.el], eb = EL[b.el]; if (!ea || !eb) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); if (d < ea.cr + eb.cr + 0.35 && d > 0.4) { nb[i].push(j); nb[j].push(i); } }
    }
  });
  atoms.forEach(a => delete a._c);
  return nb;
}
function prepareReceptor(all, opt = {}) {
  const chains = opt.chains ? new Set(opt.chains) : null, keepHet = new Set(opt.keepHet || []);
  const sel = all.filter(a => !WATER.has(a.res) && (!chains || chains.has(a.chain)) && (!a.het || keepHet.has(a.key + a.res) || (STD.has(a.res) && a.het)));
  const nb = bondGraph(sel), fileHasH = sel.filter(a => a.el === 'H').length > 0.3 * sel.filter(a => a.el !== 'H' && STD.has(a.res)).length;
  const heavy = [], info = [];
  sel.forEach((a, i) => { if (a.el === 'H' || !XSR[a.el]) return;
    const hasH = nb[i].some(j => sel[j].el === 'H'), bondedHet = nb[i].some(j => isHet(sel[j].el) && sel[j].el !== 'H');
    let don = false, acc = false;
    if (STD.has(a.res)) { const t = tpl(a.res, a.name), rn = AA[a.res] || a.res;
      if (rn === 'HIS' && (a.name === 'ND1' || a.name === 'NE2')) { acc = fileHasH ? !hasH : true; don = fileHasH ? hasH : true; }
      else { acc = t.acc; don = fileHasH ? hasH : t.don; if (!fileHasH && t.don && (a.el === 'N' || a.el === 'O')) don = true; } }
    else { if (a.el === 'N') { acc = !hasH && nb[i].length <= 2; don = fileHasH ? hasH : true; } if (a.el === 'O') { acc = true; don = fileHasH ? hasH : true; } }
    const f = xsFlags(a.el, bondedHet, false, false); const hyd = f.hyd;
    const t = typeKey(a.el, hyd, don && (a.el === 'N' || a.el === 'O'), acc && (a.el === 'N' || a.el === 'O'));
    heavy.push({ i, a, t: TYPEDEF[t] }); });
  const n = heavy.length, X = new Float64Array(3 * n), R = new Float32Array(n), HY = new Uint8Array(n), DN = new Uint8Array(n), AC = new Uint8Array(n), meta = [];
  heavy.forEach((h, k) => { X[3*k] = h.a.x; X[3*k+1] = h.a.y; X[3*k+2] = h.a.z; R[k] = h.t.r; HY[k] = h.t.hyd; DN[k] = h.t.don; AC[k] = h.t.acc; meta.push({ name: h.a.name, res: h.a.res, chain: h.a.chain, resi: h.a.resi, el: h.a.el, het: h.a.het }); });
  /* heavy-atom bonds for drawing */
  const idx = new Map(heavy.map((h, k) => [h.i, k])), bonds = [];
  heavy.forEach((h, k) => { for (const j of nb[h.i]) { const q = idx.get(j); if (q !== undefined && q > k) bonds.push(k, q); } });
  return { n, X, R, HY, DN, AC, meta, bonds, fileHasH };
}

/* ---------------- boxes and pockets ---------------- */
function boxFromPoints(pts, pad = 10, min = 18) {
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const p of pts) for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], p[q]); hi[q] = Math.max(hi[q], p[q]); }
  return { c: [0, 1, 2].map(q => (lo[q] + hi[q]) / 2), s: [0, 1, 2].map(q => Math.min(60, Math.max(min, hi[q] - lo[q] + pad))) };
}
/* LIGSITE-style buried-cavity finder */
function findPockets(rec, opt = {}) {
  const sp = 1.0, n = rec.n; if (!n) return [];
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], rec.X[3*i+q]); hi[q] = Math.max(hi[q], rec.X[3*i+q]); }
  const pad = 4, o = lo.map(v => v - pad), dim = [0, 1, 2].map(q => Math.ceil((hi[q] - lo[q] + 2 * pad) / sp) + 1), N = dim[0] * dim[1] * dim[2];
  const occ = new Uint8Array(N), ex = new Uint8Array(N), id = (x, y, z) => (x * dim[1] + y) * dim[2] + z;
  const stamp = (arr, i, rad) => { const cx = (rec.X[3*i] - o[0]) / sp, cy = (rec.X[3*i+1] - o[1]) / sp, cz = (rec.X[3*i+2] - o[2]) / sp, r = rad / sp, ri = Math.ceil(r);
    for (let x = Math.max(0, Math.floor(cx) - ri); x <= Math.min(dim[0] - 1, Math.floor(cx) + ri); x++) for (let y = Math.max(0, Math.floor(cy) - ri); y <= Math.min(dim[1] - 1, Math.floor(cy) + ri); y++) for (let z = Math.max(0, Math.floor(cz) - ri); z <= Math.min(dim[2] - 1, Math.floor(cz) + ri); z++)
      if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= r * r) arr[id(x, y, z)] = 1; };
  for (let i = 0; i < n; i++) { stamp(occ, i, 2.0); stamp(ex, i, 3.1); }
  const dirs = [[1,0,0],[0,1,0],[0,0,1],[1,1,1],[1,1,-1],[1,-1,1],[-1,1,1]], MAXS = 10, score = new Uint8Array(N);
  for (let x = 0; x < dim[0]; x++) for (let y = 0; y < dim[1]; y++) for (let z = 0; z < dim[2]; z++) {
    if (ex[id(x, y, z)]) continue; let s = 0;
    for (const d of dirs) { let a = false, b = false;
      for (let t = 1; t <= MAXS; t++) { const X = x + d[0]*t, Y = y + d[1]*t, Z = z + d[2]*t; if (X < 0 || Y < 0 || Z < 0 || X >= dim[0] || Y >= dim[1] || Z >= dim[2]) break; if (occ[id(X, Y, Z)]) { a = true; break; } }
      if (a) for (let t = 1; t <= MAXS; t++) { const X = x - d[0]*t, Y = y - d[1]*t, Z = z - d[2]*t; if (X < 0 || Y < 0 || Z < 0 || X >= dim[0] || Y >= dim[1] || Z >= dim[2]) break; if (occ[id(X, Y, Z)]) { b = true; break; } }
      if (a && b) s++; }
    score[id(x, y, z)] = s;
  }
  const thr = opt.minScore ?? 6, seen = new Uint8Array(N), out = [];
  for (let x = 0; x < dim[0]; x++) for (let y = 0; y < dim[1]; y++) for (let z = 0; z < dim[2]; z++) {
    const k = id(x, y, z); if (seen[k] || score[k] < thr || ex[k]) continue;
    const q = [[x, y, z]], pts = []; seen[k] = 1;
    while (q.length) { const [a, b, c] = q.pop(); pts.push([o[0] + a * sp, o[1] + b * sp, o[2] + c * sp, score[id(a, b, c)]]);
      for (const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[-1,-1,0],[1,-1,0],[-1,1,0],[0,1,1],[0,-1,-1],[0,1,-1],[0,-1,1],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1]]) {
        const A = a + d[0], B = b + d[1], C = c + d[2]; if (A < 0 || B < 0 || C < 0 || A >= dim[0] || B >= dim[1] || C >= dim[2]) continue; const kk = id(A, B, C); if (!seen[kk] && score[kk] >= thr && !ex[kk]) { seen[kk] = 1; q.push([A, B, C]); } } }
    if (pts.length >= 12) { const sw = pts.reduce((s, p) => s + p[3], 0), c = [0, 1, 2].map(m => pts.reduce((s, p) => s + p[m] * p[3], 0) / sw); out.push({ pts, size: pts.length, vol: pts.length * sp ** 3, center: c, box: boxFromPoints(pts, 8, 18) }); }
  }
  out.sort((a, b) => b.size - a.size); return out.slice(0, opt.max ?? 6);
}

/* ---------------- Vina pair terms ---------------- */
const _pe = [0, 0];
function pairE(d, hydBoth, hbond) { /* returns energy, sets _pe[1] = dE/dd */
  const g1 = Math.exp(-(d / 0.5) * (d / 0.5)), g2 = Math.exp(-((d - 3) / 2) * ((d - 3) / 2));
  let E = W.g1 * g1 + W.g2 * g2, D = W.g1 * g1 * (-8 * d) + W.g2 * g2 * (-(d - 3) / 2);
  if (d < 0) { E += W.rep * d * d; D += 2 * W.rep * d; }
  if (hydBoth) { if (d <= 0.5) E += W.hyd; else if (d < 1.5) { E += W.hyd * (1.5 - d); D -= W.hyd; } }
  if (hbond) { if (d <= -0.7) E += W.hb; else if (d < 0) { E += W.hb * (-d / 0.7); D += W.hb * (-1 / 0.7); } }
  _pe[1] = D; return E;
}

/* ---------------- grid maps ---------------- */
async function buildGrids(rec, box, typeKeys, opt = {}, onProgress, isCancelled) {
  const sp = opt.spacing || 0.5, lo = [0, 1, 2].map(q => box.c[q] - box.s[q] / 2), dim = [0, 1, 2].map(q => Math.ceil(box.s[q] / sp) + 1);
  const N = dim[0] * dim[1] * dim[2], types = typeKeys.map(k => TYPEDEF[k]), maps = types.map(() => new Float32Array(N));
  /* receptor atoms within reach of the box */
  const m = CUT + 0.5, near = []; for (let i = 0; i < rec.n; i++) { const x = rec.X[3*i], y = rec.X[3*i+1], z = rec.X[3*i+2];
    if (x > lo[0] - m && x < lo[0] + box.s[0] + m && y > lo[1] - m && y < lo[1] + box.s[1] + m && z > lo[2] - m && z < lo[2] + box.s[2] + m) near.push(i); }
  const cs = CUT, cell = new Map(), ck = (a, b, c) => a + ',' + b + ',' + c;
  for (const i of near) { const k = ck(Math.floor(rec.X[3*i] / cs), Math.floor(rec.X[3*i+1] / cs), Math.floor(rec.X[3*i+2] / cs)); let c = cell.get(k); if (!c) cell.set(k, c = []); c.push(i); }
  const nt = types.length, tr = types.map(t => t.r), th = types.map(t => t.hyd), td = types.map(t => t.don), ta = types.map(t => t.acc);
  const cand = []; const out = new Float64Array(nt);
  for (let ix = 0; ix < dim[0]; ix++) {
    if (isCancelled && isCancelled()) throw new Error('cancelled');
    for (let iy = 0; iy < dim[1]; iy++) for (let iz = 0; iz < dim[2]; iz++) {
      const px = lo[0] + ix * sp, py = lo[1] + iy * sp, pz = lo[2] + iz * sp, cx = Math.floor(px / cs), cy = Math.floor(py / cs), cz = Math.floor(pz / cs);
      out.fill(0);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = cell.get(ck(cx + a, cy + b, cz + c)); if (!L) continue;
        for (const j of L) { const dx = rec.X[3*j] - px, dy = rec.X[3*j+1] - py, dz = rec.X[3*j+2] - pz, r2 = dx*dx + dy*dy + dz*dz; if (r2 >= CUT * CUT) continue; const r = Math.sqrt(r2), Rj = rec.R[j], hj = rec.HY[j], dj = rec.DN[j], aj = rec.AC[j];
          for (let t = 0; t < nt; t++) { const d = r - tr[t] - Rj; out[t] += pairE(d, th[t] && hj, (td[t] && aj) || (ta[t] && dj)); } } }
      const k = (ix * dim[1] + iy) * dim[2] + iz; for (let t = 0; t < nt; t++) maps[t][k] = out[t];
    }
    if (ix % 4 === 0) { if (onProgress) onProgress((ix + 1) / dim[0]); await tick(); }
  }
  const idx = {}; typeKeys.forEach((k, i) => idx[k] = i);
  return { lo, dim, sp, inv: 1 / sp, maps, idx, box, nNear: near.length };
}

const _s = new Float64Array(4);
/* trilinear sample: _s = [E, dE/dx, dE/dy, dE/dz]; out-of-box atoms feel a quadratic wall */
function sample(G, m, px, py, pz) {
  let fx = (px - G.lo[0]) * G.inv, fy = (py - G.lo[1]) * G.inv, fz = (pz - G.lo[2]) * G.inv, pen = 0, gx = 0, gy = 0, gz = 0;
  const nx = G.dim[0] - 1, ny = G.dim[1] - 1, nz = G.dim[2] - 1, sp = G.sp;
  if (fx < 0) { const e = fx * sp; pen += 10 * e * e; gx = 20 * e; fx = 0; } else if (fx > nx) { const e = (fx - nx) * sp; pen += 10 * e * e; gx = 20 * e; fx = nx; }
  if (fy < 0) { const e = fy * sp; pen += 10 * e * e; gy = 20 * e; fy = 0; } else if (fy > ny) { const e = (fy - ny) * sp; pen += 10 * e * e; gy = 20 * e; fy = ny; }
  if (fz < 0) { const e = fz * sp; pen += 10 * e * e; gz = 20 * e; fz = 0; } else if (fz > nz) { const e = (fz - nz) * sp; pen += 10 * e * e; gz = 20 * e; fz = nz; }
  let ix = Math.min(nx - 1, Math.floor(fx)), iy = Math.min(ny - 1, Math.floor(fy)), iz = Math.min(nz - 1, Math.floor(fz)); const tx = fx - ix, ty = fy - iy, tz = fz - iz, sy = G.dim[2], sx = G.dim[1] * G.dim[2];
  const b = ix * sx + iy * sy + iz, c000 = m[b], c001 = m[b + 1], c010 = m[b + sy], c011 = m[b + sy + 1], c100 = m[b + sx], c101 = m[b + sx + 1], c110 = m[b + sx + sy], c111 = m[b + sx + sy + 1];
  const ux = 1 - tx, uy = 1 - ty, uz = 1 - tz;
  const E = ux * (uy * (uz * c000 + tz * c001) + ty * (uz * c010 + tz * c011)) + tx * (uy * (uz * c100 + tz * c101) + ty * (uz * c110 + tz * c111));
  const dx = (uy * (uz * (c100 - c000) + tz * (c101 - c001)) + ty * (uz * (c110 - c010) + tz * (c111 - c011))) * G.inv;
  const dy = (ux * (uz * (c010 - c000) + tz * (c011 - c001)) + tx * (uz * (c110 - c100) + tz * (c111 - c101))) * G.inv;
  const dz = (ux * (uy * (c001 - c000) + ty * (c011 - c010)) + tx * (uy * (c101 - c100) + ty * (c111 - c110))) * G.inv;
  _s[0] = E + pen; _s[1] = dx + gx; _s[2] = dy + gy; _s[3] = dz + gz;
}

/* ---------------- ligand preparation ---------------- */
function prepareLigand(mol) {
  const n = mol.atoms.length, heavy = [], hIdx = new Array(n).fill(-1);
  mol.atoms.forEach((a, i) => { if (a.el !== 'H') { hIdx[i] = heavy.length; heavy.push(i); } });
  const types = ligandTypes(mol), nh = heavy.length;
  /* rotatable bonds: single, acyclic, both ends have another heavy neighbour, not amide, not linear */
  const hdeg = i => mol.nb[i].filter(k => mol.atoms[k.j].el !== 'H').length;
  const rot = Chem.rotatableBonds(mol).filter(r => {
    const A = mol.atoms[r.a], B = mol.atoms[r.b]; if (hdeg(r.a) < 2 || hdeg(r.b) < 2) return false; if (A.hyb === 1 || B.hyb === 1) return false;
    const carbonylN = (c, nn) => c.el === 'C' && nn.el === 'N' && mol.nb[mol.atoms.indexOf(c)].some(k => mol.atoms[k.j].el === 'O' && mol.bonds[k.b].o === 2);
    if (carbonylN(A, B) || carbonylN(B, A)) return false; return true; });
  /* rigid groups = connected heavy atoms without rotatable bonds */
  const rotSet = new Set(rot.map(r => r.bi)), grp = new Array(n).fill(-1); let ng = 0;
  for (const s of heavy) if (grp[s] < 0) { const q = [s]; grp[s] = ng; while (q.length) { const u = q.pop(); for (const k of mol.nb[u]) if (mol.atoms[k.j].el !== 'H' && !rotSet.has(k.b) && grp[k.j] < 0) { grp[k.j] = ng; q.push(k.j); } } ng++; }
  const gsize = new Array(ng).fill(0); heavy.forEach(i => gsize[grp[i]]++);
  let rootG = 0; gsize.forEach((s, g) => { if (s > gsize[rootG]) rootG = g; });
  /* order torsions outward from the root */
  const tors = [], done = new Set([rootG]), ready = new Set(rot.map((_, k) => k));
  while (ready.size) { let prog = false;
    for (const k of [...ready]) { const r = rot[k], ga = grp[r.a], gb = grp[r.b];
      if (done.has(ga) || done.has(gb)) { const parentIsA = done.has(ga), pa = parentIsA ? r.a : r.b, ca = parentIsA ? r.b : r.a;
        /* child side = everything reachable from ca without crossing this bond */
        const seen = new Set([pa, ca]), q = [ca]; while (q.length) { const u = q.pop(); for (const kk of mol.nb[u]) if (!seen.has(kk.j)) { seen.add(kk.j); q.push(kk.j); } } seen.delete(pa);
        tors.push({ pa, ca, movedAll: [...seen], movedHeavy: [...seen].filter(i => mol.atoms[i].el !== 'H') });
        done.add(parentIsA ? gb : ga); ready.delete(k); prog = true; } }
    if (!prog) break; }
  const rootAtoms = heavy.filter(i => grp[i] === rootG), c0 = [0, 1, 2].map(q => rootAtoms.reduce((s, i) => s + [mol.atoms[i].x, mol.atoms[i].y, mol.atoms[i].z][q], 0) / rootAtoms.length);
  const ref = new Float64Array(3 * n); mol.atoms.forEach((a, i) => { ref[3*i] = a.x - c0[0]; ref[3*i+1] = a.y - c0[1]; ref[3*i+2] = a.z - c0[2]; });
  /* intramolecular pairs (different rigid groups, >= 4 bonds apart) */
  const pairs = [];
  for (let a = 0; a < nh; a++) { const s = heavy[a], dist = new Map([[s, 0]]); let fr = [s]; for (let d = 1; d <= 3; d++) { const nx = []; for (const u of fr) for (const k of mol.nb[u]) if (mol.atoms[k.j].el !== 'H' && !dist.has(k.j)) { dist.set(k.j, d); nx.push(k.j); } fr = nx; }
    for (let b = a + 1; b < nh; b++) { const t = heavy[b]; if (dist.has(t) || grp[s] === grp[t]) continue; pairs.push([s, t]); } }
  const T = types.map(k => k && TYPEDEF[k]);
  const lig = { mol, n, heavy, hIdx, types, T, tors, nt: tors.length, ref, c0, pairs, grp, rootG, nh, c0w: c0 };
  lig.intraRef = intraEnergy(lig, ref, null);
  lig.refHeavy = heavy.map(i => [ref[3*i] + c0[0], ref[3*i+1] + c0[1], ref[3*i+2] + c0[2]]);
  return lig;
}
function intraEnergy(lig, pos, g) {
  let E = 0;
  for (const [i, j] of lig.pairs) { const A = lig.T[i], B = lig.T[j], dx = pos[3*i] - pos[3*j], dy = pos[3*i+1] - pos[3*j+1], dz = pos[3*i+2] - pos[3*j+2], r = Math.sqrt(dx*dx + dy*dy + dz*dz); if (r >= CUT || r < 1e-6) continue;
    const e = pairE(r - A.r - B.r, A.hyd && B.hyd, (A.don && B.acc) || (A.acc && B.don)); E += e;
    if (g) { const f = _pe[1] / r; g[3*i] += f * dx; g[3*i+1] += f * dy; g[3*i+2] += f * dz; g[3*j] -= f * dx; g[3*j+1] -= f * dy; g[3*j+2] -= f * dz; } }
  return E;
}

/* ---------------- quaternion helpers ---------------- */
function qmul(a, b) { return [a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2], a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]]; }
function qfromRot(wx, wy, wz) { const a = Math.hypot(wx, wy, wz); if (a < 1e-12) return [1, 0, 0, 0]; const s = Math.sin(a / 2) / a; return [Math.cos(a / 2), wx * s, wy * s, wz * s]; }
function qnorm(q) { const h = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0]/h, q[1]/h, q[2]/h, q[3]/h]; }

/* ---------------- pose scoring ---------------- */
/* pose vector: [tx,ty,tz, qw,qx,qy,qz, torsion angles...] */
function makeScorer(lig, G) {
  const n = lig.n, nt = lig.nt, nd = 6 + nt, pos = new Float64Array(3 * n), gat = new Float64Array(3 * n), tmp = new Float64Array(3 * n);
  const tIdx = lig.T.map(t => t ? G.idx[t.key] : -1);
  const heavy = lig.heavy;
  function place(x, all) {
    tmp.set(lig.ref);
    for (let k = 0; k < nt; k++) { const t = lig.tors[k]; Chem.rotateAbout(tmp, t.pa, t.ca, all ? t.movedAll : t.movedHeavy, x[7 + k]); }
    const w = x[3], qx = x[4], qy = x[5], qz = x[6], list = all ? null : heavy, cnt = all ? n : heavy.length;
    for (let m = 0; m < cnt; m++) { const i = all ? m : list[m], px = tmp[3*i], py = tmp[3*i+1], pz = tmp[3*i+2];
      const tx = 2 * (qy * pz - qz * py), ty = 2 * (qz * px - qx * pz), tz = 2 * (qx * py - qy * px);
      pos[3*i] = px + w * tx + (qy * tz - qz * ty) + x[0]; pos[3*i+1] = py + w * ty + (qz * tx - qx * tz) + x[1]; pos[3*i+2] = pz + w * tz + (qx * ty - qy * tx) + x[2]; }
    return pos;
  }
  /* returns total (inter + intra) in kcal/mol; fills g (length nd) when given; sets inter */
  const sc = { inter: 0, intra: 0 };
  function evaluate(x, g) {
    place(x, false); gat.fill(0); let Ei = 0;
    for (let m = 0; m < heavy.length; m++) { const i = heavy[m]; sample(G, G.maps[tIdx[i]], pos[3*i], pos[3*i+1], pos[3*i+2]); Ei += _s[0]; gat[3*i] += _s[1]; gat[3*i+1] += _s[2]; gat[3*i+2] += _s[3]; }
    const Ea = intraEnergy(lig, pos, g ? gat : null); sc.inter = Ei; sc.intra = Ea;
    if (g) {
      let gx = 0, gy = 0, gz = 0, tx = 0, ty = 0, tz = 0;
      for (const i of heavy) { gx += gat[3*i]; gy += gat[3*i+1]; gz += gat[3*i+2]; const rx = pos[3*i] - x[0], ry = pos[3*i+1] - x[1], rz = pos[3*i+2] - x[2];
        tx += ry * gat[3*i+2] - rz * gat[3*i+1]; ty += rz * gat[3*i] - rx * gat[3*i+2]; tz += rx * gat[3*i+1] - ry * gat[3*i]; }
      g[0] = gx; g[1] = gy; g[2] = gz; g[3] = tx; g[4] = ty; g[5] = tz;
      for (let k = 0; k < nt; k++) { const t = lig.tors[k], a = t.pa, c = t.ca; let ux = pos[3*c] - pos[3*a], uy = pos[3*c+1] - pos[3*a+1], uz = pos[3*c+2] - pos[3*a+2]; const h = Math.hypot(ux, uy, uz) || 1; ux /= h; uy /= h; uz /= h; let s = 0;
        for (const i of t.movedHeavy) { const rx = pos[3*i] - pos[3*c], ry = pos[3*i+1] - pos[3*c+1], rz = pos[3*i+2] - pos[3*c+2];
          s += gat[3*i] * (uy * rz - uz * ry) + gat[3*i+1] * (uz * rx - ux * rz) + gat[3*i+2] * (ux * ry - uy * rx); }
        g[6 + k] = s; }
    }
    return Ei + Ea;
  }
  function apply(x, d, a, out) {
    out[0] = x[0] + a * d[0]; out[1] = x[1] + a * d[1]; out[2] = x[2] + a * d[2];
    const q = qnorm(qmul(qfromRot(a * d[3], a * d[4], a * d[5]), [x[3], x[4], x[5], x[6]])); out[3] = q[0]; out[4] = q[1]; out[5] = q[2]; out[6] = q[3];
    for (let k = 0; k < nt; k++) { let t = x[7 + k] + a * d[6 + k]; if (t > PI) t -= 2 * PI; else if (t < -PI) t += 2 * PI; out[7 + k] = t; }
    return out;
  }
  function localOpt(x0, maxIt = 30) {
    let x = Float64Array.from(x0), xn = new Float64Array(x.length), g = new Float64Array(nd), gn = new Float64Array(nd), d = new Float64Array(nd);
    let E = evaluate(x, g), Hm = new Float64Array(nd * nd); const eye = () => { Hm.fill(0); for (let i = 0; i < nd; i++) Hm[i * nd + i] = 1; }; eye();
    for (let it = 0; it < maxIt; it++) {
      let gg = 0; for (let i = 0; i < nd; i++) gg += g[i] * g[i]; if (gg < 1e-8) break;
      for (let i = 0; i < nd; i++) { let s = 0; for (let j = 0; j < nd; j++) s += Hm[i * nd + j] * g[j]; d[i] = -s; }
      let slope = 0; for (let i = 0; i < nd; i++) slope += d[i] * g[i]; if (slope >= 0) { eye(); for (let i = 0; i < nd; i++) d[i] = -g[i]; slope = -gg; }
      let mv = Math.max(Math.hypot(d[0], d[1], d[2]) / 0.5, Math.hypot(d[3], d[4], d[5]) / 0.3); for (let k = 0; k < nt; k++) mv = Math.max(mv, Math.abs(d[6 + k]) / 0.5);
      if (mv > 1) { for (let i = 0; i < nd; i++) d[i] /= mv; slope /= mv; }
      let a = 1, ok = false, En = E;
      for (let ls = 0; ls < 10; ls++) { apply(x, d, a, xn); En = evaluate(xn, gn); if (En <= E + 1e-4 * a * slope) { ok = true; break; } a *= 0.5; }
      if (!ok) { if (it === 0 || Hm[0] !== 1) { eye(); continue; } break; }
      let sy = 0; const s = new Float64Array(nd), y = new Float64Array(nd); for (let i = 0; i < nd; i++) { s[i] = a * d[i]; y[i] = gn[i] - g[i]; sy += s[i] * y[i]; }
      if (sy > 1e-9) { const rho = 1 / sy, Hy = new Float64Array(nd); let yHy = 0; for (let i = 0; i < nd; i++) { let t = 0; for (let j = 0; j < nd; j++) t += Hm[i * nd + j] * y[j]; Hy[i] = t; yHy += y[i] * t; }
        for (let i = 0; i < nd; i++) for (let j = 0; j < nd; j++) Hm[i * nd + j] += (1 + yHy * rho) * rho * s[i] * s[j] - rho * (Hy[i] * s[j] + s[i] * Hy[j]); }
      const dE = E - En; x.set(xn); g.set(gn); E = En; if (dE < 1e-5) break;
    }
    return { x, E };
  }
  return { place, evaluate, localOpt, sc, nd };
}

/* ---------------- search ---------------- */
function mulberry(a) { return Chem.mulberry(a); }
function randomPose(lig, box, rnd, spread = 6) {
  const x = new Float64Array(7 + lig.nt);
  for (let q = 0; q < 3; q++) x[q] = box.c[q] + (rnd() * 2 - 1) * Math.min(spread, Math.max(1, box.s[q] / 2 - 3));
  const u1 = rnd(), u2 = rnd() * 2 * PI, u3 = rnd() * 2 * PI, s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  x[3] = s2 * Math.cos(u3); x[4] = s1 * Math.sin(u2); x[5] = s1 * Math.cos(u2); x[6] = s2 * Math.sin(u3);
  for (let k = 0; k < lig.nt; k++) x[7 + k] = (rnd() * 2 - 1) * PI;
  return x;
}
function mutate(x, lig, rnd) {
  const y = Float64Array.from(x), nt = lig.nt, which = Math.floor(rnd() * (2 + nt));
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.7;
  if (which === 0) { y[0] += gauss() * 1.5; y[1] += gauss() * 1.5; y[2] += gauss() * 1.5; }
  else if (which === 1) { const q = qnorm(qmul(qfromRot(gauss() * 0.6, gauss() * 0.6, gauss() * 0.6), [x[3], x[4], x[5], x[6]])); y[3] = q[0]; y[4] = q[1]; y[5] = q[2]; y[6] = q[3]; }
  else y[7 + which - 2] = (rnd() * 2 - 1) * PI;
  return y;
}
function rmsdPos(a, b, idx) { let s = 0; for (const i of idx) { const dx = a[3*i] - b[3*i], dy = a[3*i+1] - b[3*i+1], dz = a[3*i+2] - b[3*i+2]; s += dx*dx + dy*dy + dz*dz; } return Math.sqrt(s / idx.length); }

async function dockLigand(lig, G, opt = {}, cb = {}) {
  const sc = makeScorer(lig, G), runs = opt.runs ?? 8, effort = opt.effort ?? 1, steps = Math.round((opt.steps ?? (80 + 25 * lig.nt + 3 * lig.nh)) * effort);
  const maxModes = opt.modes ?? 9, range = opt.range ?? 3, seed = opt.seed ?? 1, T = opt.temp ?? 1.2, itMC = opt.itMC ?? 12;
  const cands = []; let counter = 0;
  for (let r = 0; r < runs; r++) {
    const rnd = mulberry(seed * 7919 + r * 104729 + 1);
    let cur = sc.localOpt(randomPose(lig, G.box, rnd, opt.spread ?? 6), 40); const runList = [{ E: cur.E, x: cur.x }];
    let best = cur;
    for (let s = 0; s < steps; s++) {
      const prop = sc.localOpt(mutate(cur.x, lig, rnd), itMC); runList.push({ E: prop.E, x: prop.x });
      if (prop.E < cur.E || rnd() < Math.exp(-(prop.E - cur.E) / T)) cur = prop; if (cur.E < best.E) best = cur;
      if (++counter % 12 === 0) { if (cb.cancelled && cb.cancelled()) throw new Error('cancelled'); if (cb.progress) cb.progress((r + s / steps) / runs, best.E); await tick(); }
    }
    runList.sort((a, b) => a.E - b.E); const keep = [];
    for (const c of runList) { if (keep.length >= 12) break; const p = Float64Array.from(sc.place(c.x, false)); if (keep.every(k => rmsdPos(p, k.p, lig.heavy) > 0.75)) keep.push({ E: c.E, x: c.x, p }); }
    cands.push(...keep);
    if (cb.progress) cb.progress((r + 1) / runs, best.E);
  }
  cands.sort((a, b) => a.E - b.E);
  const modes = [];
  for (const c of cands) { if (modes.length >= maxModes) break; if (c.E - cands[0].E > range) break;
    if (modes.every(m => rmsdPos(c.p, m.p, lig.heavy) >= 1.0)) modes.push(c); }
  /* final exact bookkeeping per mode */
  const nrot = lig.nt;
  const out = modes.map((m, k) => {
    sc.evaluate(m.x, null); const inter = sc.sc.inter, intra = sc.sc.intra, aff = (inter + intra - lig.intraRef) / (1 + W.rot * nrot);
    const all = Float64Array.from(sc.place(m.x, true)); return { x: m.x, E: m.E, inter, intra, kcal: aff, kJ: aff * KCAL, pos: all, p: m.p };
  });
  out.sort((a, b) => a.kcal - b.kcal);
  out.forEach((m, k) => { m.rank = k + 1; m.rmsd = k === 0 ? 0 : rmsdPos(m.p, out[0].p, lig.heavy); });
  return { modes: out, nrot, steps, runs };
}

/* interactions of one pose with the receptor */
function interactions(lig, rec, pos, hbCut = 3.5) {
  const hb = [], contacts = new Map(); let hyd = 0;
  for (const i of lig.heavy) { const A = lig.T[i], x = pos[3*i], y = pos[3*i+1], z = pos[3*i+2];
    for (let j = 0; j < rec.n; j++) { const dx = rec.X[3*j] - x; if (dx > 5 || dx < -5) continue; const dy = rec.X[3*j+1] - y, dz = rec.X[3*j+2] - z, d = Math.sqrt(dx*dx + dy*dy + dz*dz); if (d > 5) continue;
      const m = rec.meta[j], rk = m.chain + m.resi;
      if (d < 4.2) { const c = contacts.get(rk) || { res: m.res, chain: m.chain, resi: m.resi, n: 0, dmin: 9 }; c.n++; c.dmin = Math.min(c.dmin, d); contacts.set(rk, c); }
      if (d <= hbCut && ((A.don && rec.AC[j]) || (A.acc && rec.DN[j]))) hb.push({ la: i, ra: j, d, lig: lig.mol.atoms[i].el, res: m.res + m.resi + (m.chain.trim() ? ':' + m.chain : ''), atom: m.name, dir: (A.don && rec.AC[j]) ? 'L→R' : 'R→L' });
      if (d <= 4.5 && A.hyd && rec.HY[j]) hyd++; } }
  return { hbonds: hb.sort((a, b) => a.d - b.d), hydrophobic: hyd, contacts: [...contacts.values()].sort((a, b) => a.dmin - b.dmin) };
}

const API = { parsePDB, hetGroups, prepareReceptor, findPockets, boxFromPoints, ligandTypes, prepareLigand, buildGrids, makeScorer, dockLigand, interactions, TYPEDEF, W, KCAL, rmsdPos, centroid, WATER, STD };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Dock = API;
})(typeof window !== 'undefined' ? window : globalThis);

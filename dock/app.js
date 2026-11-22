/* ============================ app.js ============================ */
(function () {
'use strict';
const { Chem, Dock } = window;
const $ = s => document.querySelector(s);
const tick = () => new Promise(r => setTimeout(r, 0));
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const k in props || {}) { const v = props[k];
    if (k === 'on') for (const ev in v) e.addEventListener(ev, v[ev]);
    else if (k === 'cls') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (['value', 'checked', 'disabled', 'selected', 'hidden'].includes(k)) e[k] = v; else if (v != null && v !== false) e.setAttribute(k, v); }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
let toastT = 0;
function toast(msg, ms = 4000) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }

const STEPS = [['draw', 'Draw'], ['model', '3D and minimise'], ['rec', 'Target and pocket'], ['dock', 'Dock'], ['res', 'Results']];
const A = {
  step: 'draw', ligs: [], sel: null, nextId: 1, live: { comps: [], err: '' }, imported: 0,
  recAtoms: null, recName: '', chains: [], selChains: new Set(), hets: [], keepHet: new Set(), rec: null, pockets: [], pocketSel: -1,
  box: null, boxMode: 'auto', example: null, results: {}, running: false, cancel: false, progress: null, log: [], pose: { id: null, mode: 0 },
  vw: { H: true, trace: true, box: true, key: true, surf: false, only: false }, keyRes: new Map(), keyNear: new Set(), keyOff: new Set(), keyDist: 4, posePts: null, viewer: null, viewerErr: '', busy: '',
  o: { runs: 32, effort: 1, modes: 9, rangeKJ: 12.6, spacing: 0.5, sd: 100, cg: 10, step: 0.02, conf: 10, conv: true }
};
const sel = () => A.ligs.find(l => l.id === A.sel) || null;
const dark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; };
const accentHex = () => dark() ? 0xd97757 : 0xc15f3c;

/* ===================== files ===================== */
async function saveFile(name, data) {
  if (!/\.(png|jpe?g|webp|gif|svg|csv|json|txt|md|html|pdf)$/i.test(name)) name += '.txt'; // the viewer only saves allow-listed types (.pdb and .sdf are plain text)
  let dl = null; try { dl = await window.claude?.use?.('downloads'); } catch (e) {}
  if (dl) { try { await dl.save({ filename: name, data }); toast('Saved ' + name); } catch (e) { toast(e && e.code === 'declined' ? 'Save cancelled.' : 'Could not save: ' + ((e && e.message) || 'unknown error')); } return; }
  try { const b = data instanceof Blob ? data : new Blob([data], { type: 'text/plain' }), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); toast('Saved ' + name); }
  catch (e) { toast('Saving is blocked in this view.'); }
}
async function dataUrlBlob(u) { const i = u.indexOf(','), bin = atob(u.slice(i + 1)), buf = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k); return new Blob([buf], { type: (/^data:([^;,]+)/.exec(u) || [])[1] || 'image/png' }); }
const snapH = w => { const e = $('#vhost'); return e && e.clientWidth ? Math.round(w * e.clientHeight / e.clientWidth) : Math.round(w * 0.75); };

/* ===================== Bondline bridge =====================
   Contract with bondline.html: a global function molfile() returning a V2000 molfile of the page.
   If a future Bondline drops it, the editor's saved state in localStorage ('bondline.v1') is converted instead. */
const BL = { frame: $('#bl'), last: null, ready: false, err: '' };
function blWin() { try { return BL.frame.contentWindow; } catch (e) { return null; } }
function storageMolfile(w) {
  try {
    const S = JSON.parse(w.localStorage.getItem('bondline.v1') || 'null'); if (!S || !S.o) return null;
    const os = Object.values(S.o), as = os.filter(o => o.t === 'a'), bs = os.filter(o => o.t === 'b' && as.some(a => a.id === o.a) && as.some(a => a.id === o.b)), idx = {}; as.forEach((a, i) => idx[a.id] = i + 1);
    const p = (v, n) => String(v).padStart(n), sc = 1.5 / 42; let m = '\n  Bondline\n\n' + p(as.length, 3) + p(bs.length, 3) + '  0  0  0  0  0  0  0  0999 V2000\n';
    for (const a of as) m += p((a.x * sc).toFixed(4), 10) + p((-a.y * sc).toFixed(4), 10) + p('0.0000', 10) + ' ' + (a.custom ? 'A' : a.el).padEnd(3) + ' 0  0  0  0  0  0  0  0  0  0  0  0\n';
    for (const b of bs) m += p(idx[b.a], 3) + p(idx[b.b], 3) + p(b.o, 3) + p(b.o === 1 ? (b.s === 'wedge' ? 1 : b.s === 'dash' ? 6 : b.s === 'wavy' ? 4 : 0) : 0, 3) + '  0  0  0\n';
    const q = as.filter(a => a.q); for (let i = 0; i < q.length; i += 8) { const c = q.slice(i, i + 8); m += 'M  CHG' + p(c.length, 3) + c.map(a => p(idx[a.id], 4) + p(a.q, 4)).join('') + '\n'; }
    return m + 'M  END\n';
  } catch (e) { return null; }
}
function blMolfile() { const w = blWin(); if (!w) return null; try { if (typeof w.molfile === 'function') return w.molfile(); } catch (e) {} return storageMolfile(w); }
async function loadBondline() {
  BL.frame.addEventListener('load', () => { BL.ready = true; syncBLTheme(); poll(); });
  try { const r = await fetch('../bondline/index.html'); if (!r.ok) throw new Error('HTTP ' + r.status); BL.frame.srcdoc = await r.text(); }
  catch (e) { BL.err = 'The Bondline editor could not be loaded (' + e.message + ').'; renderPanel(); }
}
function syncBLTheme() { const w = blWin(); try { if (w && w.document) { w.document.documentElement.dataset.theme = dark() ? 'dark' : 'light'; } } catch (e) {} }
function parseLive(t) {
  try {
    const p = Chem.parseMol(t, { lenient: true });
    const comps = Chem.splitComponents(p).map(c => { const custom = c.atoms.find(a => a.custom); let fm = '', mw = 0, err = '';
      if (!custom) { try { const f = Chem.formula(Chem.prepare(c)); fm = f.text; mw = f.mass; } catch (e) { err = e.message; } }
      return { parsed: c, custom, fm, mw, err, x: Math.min(...c.atoms.map(a => a.x)), y: -Math.min(...c.atoms.map(a => a.y)) }; });
    comps.sort((a, b) => a.x - b.x || a.y - b.y); comps.forEach((c, i) => c.i = i);
    A.live = { comps, err: '' };
  } catch (e) { A.live = { comps: [], err: /no atoms/.test(e.message) ? '' : e.message }; }
}
function poll() { const t = blMolfile(); if (t == null || t === BL.last) return; BL.last = t; parseLive(t); renderLive(); }
setInterval(poll, 700);

/* ===================== ligand library ===================== */
function addLigand(parsed, name, extra) {
  const id = A.nextId++, l = Object.assign({ id, name: name || 'Ligand ' + id, parsed, mol: null, state: '2d', E: null, hist: [], parts: null, fm: '', mw: 0 }, extra || {});
  try { const f = Chem.formula(l.mol || Chem.prepare(parsed)); l.fm = f.text; l.mw = f.mass; } catch (e) {}
  A.ligs.push(l); if (A.sel == null) A.sel = id; return l;
}
function addFromDrawing(c) { return addLigand(c.parsed, null, { di: c.i }); }
function convert3D(l) {
  const m = Chem.build3DFrom(l.parsed, { nconf: A.o.conf, seed: l.id * 17 + 3 });
  l.mol = m; l.state = '3d'; l.E = m.E; l.hist = []; l.parts = null; l.dock = null; delete A.results[l.id];
  const f = Chem.formula(m); l.fm = f.text; l.mw = f.mass;
}
async function minimiseLig(l) {
  if (!l.mol) convert3D(l); const m = l.mol; if (!m.T) m.T = Chem.buildTopology(m);
  const x = Chem.coords(m), o = A.o; let rounds = 0, prev = Infinity, hist = [], res, d;
  do { res = Chem.minimize(x, m.T, { sd: o.sd, cg: o.cg, step: o.step }); hist.push(...res.hist); rounds++; d = prev - res.E; prev = res.E; await tick(); } while (o.conv && rounds < 40 && d > 0.05);
  Chem.setCoords(m, x); l.E = res.E; l.parts = res.parts; l.state = 'min'; l.hist = (l.hist || []).concat(hist); l.rounds = rounds; l.dock = null; delete A.results[l.id];
}

/* ===================== receptor ===================== */
async function loadReceptorText(text, name) {
  const atoms = Dock.parsePDB(text);
  if (!atoms.some(a => !a.het || Dock.STD.has(a.res))) { toast('No protein atoms found in that file.'); return; }
  A.busy = 'Reading structure'; renderPanel(); await tick();
  A.recAtoms = atoms; A.recName = name;
  A.chains = [...new Set(atoms.filter(a => !a.het || Dock.STD.has(a.res)).map(a => a.chain))]; A.selChains = new Set(A.chains);
  A.hets = Dock.hetGroups(atoms).filter(g => !Dock.STD.has(g.res)); A.keepHet = new Set(); A.results = {}; A.box = null; A.keyRes = new Map(); A.keyNear = new Set(); A.keyOff = new Set();
  await prepRec();
}
async function prepRec() {
  A.busy = 'Preparing target and searching for pockets'; renderPanel(); await tick();
  A.rec = Dock.prepareReceptor(A.recAtoms, { chains: [...A.selChains], keepHet: [...A.keepHet] }); A.pockets = [];
  await tick();
  try { A.pockets = Dock.findPockets(A.rec); } catch (e) { A.pockets = []; }
  if (!A.box) { if (A.example && A.recName.startsWith('1IEP')) useExampleSite(); else if (A.hets.some(g => g.nHeavy >= 5)) useHet(A.hets.filter(g => g.nHeavy >= 5).sort((p, q) => q.nHeavy - p.nHeavy)[0]); else if (A.pockets.length) usePocket(0); else { const c = Dock.centroid(A.rec.meta.map((m, i) => ({ x: A.rec.X[3*i], y: A.rec.X[3*i+1], z: A.rec.X[3*i+2] }))); A.box = { c, s: [30, 30, 30] }; A.boxMode = 'manual'; } }
  A.busy = ''; refreshAll();
}
function usePocket(i) { const p = A.pockets[i]; if (!p) return; A.pocketSel = i; A.boxMode = 'auto'; A.box = { c: p.box.c.slice(), s: p.box.s.slice() }; }
function useExampleSite() { if (!A.example) return; A.boxMode = 'site'; A.pocketSel = -1; A.box = Dock.boxFromPoints(A.example.heavy, 12, 20); }
function useHet(g) { A.boxMode = 'site'; A.pocketSel = -1; A.box = Dock.boxFromPoints(g.atoms.filter(a => a.el !== 'H').map(a => [a.x, a.y, a.z]), 12, 20); }
function useResidues(txt) {
  const rec = A.rec; if (!rec) return; const toks = txt.split(/[,\s;]+/).filter(Boolean), pts = [];
  for (const t of toks) { const m = /^(?:([A-Za-z0-9]):)?(\d+)(?:-(\d+))?$/.exec(t); if (!m) { toast('Could not read "' + t + '". Use A:381 or 315-320.'); return; }
    const lo = +m[2], hi = m[3] ? +m[3] : lo; rec.meta.forEach((a, i) => { if ((!m[1] || a.chain === m[1]) && a.resi >= lo && a.resi <= hi) pts.push([rec.X[3*i], rec.X[3*i+1], rec.X[3*i+2]]); }); }
  if (!pts.length) { toast('No target atoms match those residues.'); return; }
  A.boxMode = 'res'; A.pocketSel = -1; A.box = Dock.boxFromPoints(pts, 12, 18); refreshAll();
}
async function loadExample() {
  try {
    A.busy = 'Loading ABL kinase example'; renderPanel();
    const [p, s] = await Promise.all([fetch('data/1iep.pdb').then(r => { if (!r.ok) throw new Error('1iep.pdb ' + r.status); return r.text(); }), fetch('data/imatinib.sdf').then(r => { if (!r.ok) throw new Error('imatinib.sdf ' + r.status); return r.text(); })]);
    const parsed = Chem.parseMol(s), mol = Chem.prepare(parsed);
    A.example = { name: 'imatinib (crystal pose)', sdf: s, parsed, mol, heavy: mol.atoms.filter(a => !a.h && a.el !== 'H').map(a => [a.x, a.y, a.z]) };
    await loadReceptorText(p, '1IEP ABL kinase (target, hydrogens added)');
  } catch (e) { A.busy = ''; toast('Could not load the example: ' + e.message); renderPanel(); }
}
function addExampleLigand() {
  if (!A.example) return; const ex = A.example; let l = A.ligs.find(q => q.crystal); if (l) { A.sel = l.id; return l; }
  const mol = Chem.prepare(Chem.parseMol(ex.sdf)); mol.T = Chem.buildTopology(mol);
  l = addLigand(Chem.parseMol(ex.sdf), 'Imatinib (crystal pose)', { mol, state: '3d', E: Chem.energy(Chem.coords(mol), mol.T), crystal: true, ref: mol.atoms.map(a => [a.x, a.y, a.z]) });
  const f = Chem.formula(mol); l.fm = f.text; l.mw = f.mass; A.sel = l.id; return l;
}

/* ===================== docking ===================== */
function ligForDock(l) { if (!l.mol) convert3D(l); return Dock.prepareLigand(l.mol); }
async function runDocking() {
  const todo = A.ligs.filter(l => l.dockOn !== false); if (!todo.length) return toast('Add and tick at least one ligand.');
  if (!A.rec) return toast('Load a target first.'); if (!A.box) return toast('Define the search box first.');
  A.running = true; A.cancel = false; A.log = []; A.progress = { grid: 0, lig: 0, name: '', i: 0, n: todo.length }; renderPanel(); refreshView();
  const log = m => { A.log.push(m); const e = $('#log'); if (e) { e.textContent = A.log.join('\n'); e.scrollTop = 1e9; } };
  const prog = () => { const p = A.progress; const g = $('#pg-grid'), r = $('#pg-lig'), t = $('#pg-txt'); if (g) g.style.width = (p.grid * 100) + '%'; if (r) r.style.width = (p.lig * 100) + '%'; if (t) t.textContent = p.name ? p.name + ' (' + (p.i + 1) + ' of ' + p.n + ')' : ''; };
  try {
    const ligs = [];
    for (const l of todo) { try { ligs.push({ l, d: ligForDock(l) }); } catch (e) { log('Skipped ' + l.name + ': ' + e.message); } }
    const keys = [...new Set(ligs.flatMap(x => x.d.types.filter(Boolean)))];
    const nPts = A.box.s.map(v => Math.ceil(v / A.o.spacing) + 1).reduce((a, b) => a * b, 1);
    log('Grid maps: ' + keys.length + ' atom types, ' + nPts.toLocaleString() + ' points per map, spacing ' + A.o.spacing + ' Å');
    const t0 = performance.now();
    const G = await Dock.buildGrids(A.rec, A.box, keys, { spacing: A.o.spacing }, p => { A.progress.grid = p; prog(); }, () => A.cancel);
    log('Grids ready in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s (' + G.nNear + ' target atoms in range)');
    for (let k = 0; k < ligs.length; k++) {
      const { l, d } = ligs[k]; A.progress.i = k; A.progress.name = l.name; A.progress.lig = 0; prog(); const t1 = performance.now();
      log(l.name + ': ' + d.nh + ' heavy atoms, ' + d.nt + ' rotatable bonds');
      const res = await Dock.dockLigand(d, G, { runs: A.o.runs, effort: A.o.effort, modes: A.o.modes, range: A.o.rangeKJ / 4.184, seed: 1 + k }, { progress: f => { A.progress.lig = f; prog(); }, cancelled: () => A.cancel });
      l.dock = d; res.modes.forEach(m => { m.inter = Dock.interactions(d, A.rec, m.pos); if (l.ref) m.rmsdRef = refRmsd(d, m.pos, l.ref); });
      A.results[l.id] = { modes: res.modes, nrot: res.nrot, time: (performance.now() - t1) / 1000, runs: res.runs, steps: res.steps };
      const b = res.modes[0]; log('  best ' + f1(b.kJ) + ' kJ/mol (' + b.kcal.toFixed(2) + ' kcal/mol), ' + res.modes.length + ' modes, ' + A.results[l.id].time.toFixed(1) + ' s' + (b.rmsdRef != null ? ', RMSD to crystal ' + b.rmsdRef.toFixed(2) + ' Å' : ''));
      A.pose = { id: l.id, mode: 0 };
      for (let m = 0; m < res.modes.length; m++) { showPose(l, res.modes[m], true); res.modes[m].img = A.viewer.snapshot(336, 252); await tick(); }
    }
    A.running = false; A.step = 'res'; const first = ligs[0] && ligs[0].l; if (first) { A.sel = first.id; A.pose = { id: first.id, mode: 0 }; }
    refreshAll();
  } catch (e) { A.running = false; if (e.message === 'cancelled') { toast('Docking cancelled.'); } else { console.error(e); toast('Docking failed: ' + e.message, 7000); } refreshAll(); }
}
function refRmsd(d, pos, ref) { let s = 0, n = 0; for (const i of d.heavy) { const dx = pos[3*i] - ref[i][0], dy = pos[3*i+1] - ref[i][1], dz = pos[3*i+2] - ref[i][2]; s += dx*dx + dy*dy + dz*dz; n++; } return Math.sqrt(s / n); }

/* ===================== viewer scene ===================== */
function ensureViewer() {
  if (A.viewer || A.viewerErr) return A.viewer;
  try { A.viewer = new window.Viewer($('#vhost')); A.viewer.dark = dark(); } catch (e) { A.viewerErr = 'The 3D view needs WebGL, which is not available here (' + e.message + ').'; }
  return A.viewer;
}

/* ===================== key residues ===================== */
const keyId = (c, n) => (c || '') + ':' + n;
const KEY_DIST = [3.5, 4, 5, 6];
function keySources() {
  const out = [];
  if (A.step === 'res' && A.posePts) out.push({ id: 'pose', name: 'the docked pose', pts: A.posePts });
  if (A.example && A.recName.startsWith('1IEP')) out.push({ id: 'ex', name: A.example.name, pts: A.example.heavy });
  for (const g of A.hets || []) if (g.nHeavy >= 5) out.push({ id: 'het:' + g.chain + g.res + g.resi, name: g.res + ' ' + g.resi, pts: g.atoms.filter(q => q.el !== 'H').map(q => [q.x, q.y, q.z]) });
  return out;
}
function nearResidues(pts, d) {
  const rec = A.rec, d2 = d * d, out = new Map(); if (!rec) return out;
  for (let i = 0; i < rec.n; i++) { const m = rec.meta[i]; if (m.het) continue; const k = keyId(m.chain, m.resi); if (out.has(k)) continue; const x = rec.X[3*i], y = rec.X[3*i+1], z = rec.X[3*i+2];
    for (const p of pts) { const dx = x - p[0], dy = y - p[1], dz = z - p[2]; if (dx*dx + dy*dy + dz*dz < d2) { out.set(k, { chain: m.chain, resi: m.resi, res: m.res }); break; } } }
  return out;
}
function effectiveKeys() {
  const eff = new Map(A.keyRes), near = new Map();
  for (const s of keySources()) if (A.keyNear.has(s.id)) for (const [k, r] of nearResidues(s.pts, A.keyDist)) { near.set(k, s.name); if (!A.keyOff.has(k)) eff.set(k, r); }
  return { eff, near };
}
function addKeyResidues(txt) {
  const rec = A.rec; if (!rec) return 0; let added = 0;
  for (const t of txt.split(/[,\s;]+/).filter(Boolean)) {
    const m = /^(?:([A-Za-z0-9]):)?([A-Za-z]{3})?(\d+)(?:-(\d+))?$/.exec(t); if (!m) { toast('Could not read "' + t + '". Use A:381 or 315-320.'); continue; }
    const lo = +m[3], hi = m[4] ? +m[4] : lo, seen = new Set();
    for (let i = 0; i < rec.n; i++) { const a = rec.meta[i]; if (a.het || a.resi < lo || a.resi > hi || (m[1] && a.chain !== m[1]) || (m[2] && a.res !== m[2].toUpperCase())) continue;
      const k = keyId(a.chain, a.resi); if (seen.has(k)) continue; seen.add(k); A.keyOff.delete(k); if (!A.keyRes.has(k)) { A.keyRes.set(k, { chain: a.chain, resi: a.resi, res: a.res }); added++; } }
    if (!seen.size) toast('No residue matches "' + t + '".');
  }
  return added;
}
function drawKey(V) {
  const E = A.rec && A.vw.key ? effectiveKeys().eff : null;
  if (!E || !E.size) { V.clearLayer('key'); V.clearLayer('keylbl'); return; }
  const rec = A.rec, idx = [], lbl = [], seen = new Set();
  for (let i = 0; i < rec.n; i++) { const a = rec.meta[i], k = keyId(a.chain, a.resi); if (!E.has(k)) continue; idx.push(i);
    if (!seen.has(k) && a.name === 'CA') { seen.add(k); lbl.push({ p: [rec.X[3*i], rec.X[3*i+1], rec.X[3*i+2]], text: a.res + a.resi }); } }
  const map = new Map(); idx.forEach((i, k) => map.set(i, k)); const pos = new Float32Array(idx.length * 3), el = idx.map(i => rec.meta[i].el);
  idx.forEach((i, k) => { pos[3*k] = rec.X[3*i]; pos[3*k+1] = rec.X[3*i+1]; pos[3*k+2] = rec.X[3*i+2]; });
  const bonds = []; for (let b = 0; b < rec.bonds.length; b += 2) { const p = map.get(rec.bonds[b]), q = map.get(rec.bonds[b+1]); if (p !== undefined && q !== undefined) bonds.push(p, q); }
  V.sticks('key', { pos, el, bonds, carbon: dark() ? 0xff7ab0 : 0xd6336c, ball: 0.26, stick: 0.14, skip: A.vw.H ? null : (i => el[i] === 'H') });
  V.labels('keylbl', lbl, dark() ? '#ff8fbd' : '#c2255c');
}
function keyPanel() {
  const rec = A.rec, { eff, near } = effectiveKeys(), srcs = keySources();
  const sec = h('div', { cls: 'sec' }, h('h3', { text: 'Key residues' }));
  if (srcs.length) {
    sec.append(h('div', { cls: 'row' }, h('label', { text: 'Within', style: 'min-width:0' }),
      h('select', { 'aria-label': 'Distance', style: 'flex:0 0 76px', on: { change: e => { A.keyDist = +e.target.value; A.keyOff.clear(); refreshAll(); } } }, ...KEY_DIST.map(d => h('option', { value: d, selected: d === A.keyDist, text: d + ' Å' }))), h('span', { cls: 'note', text: 'of a ligand:' })));
    for (const s of srcs) { const n = nearResidues(s.pts, A.keyDist).size;
      sec.append(h('label', { cls: 'chk', style: 'align-items:flex-start' }, h('input', { type: 'checkbox', checked: A.keyNear.has(s.id), on: { change: e => { if (e.target.checked) A.keyNear.add(s.id); else A.keyNear.delete(s.id); A.keyOff.clear(); refreshAll(); } } }), h('span', { text: 'Residues around ' + s.name + ' (' + n + ')' }))); }
  } else sec.append(h('p', { cls: 'note', text: 'No ligand in this file to select around. Tick residues below or add them by number.' }));
  // candidate list: residues inside the search box plus anything already highlighted
  const cand = new Map(eff), b = A.box;
  if (b) for (let i = 0; i < rec.n; i++) { const m = rec.meta[i]; if (m.het) continue; let ok = true; for (let q = 0; q < 3; q++) if (Math.abs(rec.X[3*i+q] - b.c[q]) > b.s[q] / 2 + 1) { ok = false; break; } if (ok) cand.set(keyId(m.chain, m.resi), { chain: m.chain, resi: m.resi, res: m.res }); }
  const rows = [...cand.entries()].sort((x, y) => (eff.has(y[0]) - eff.has(x[0])) || (x[1].chain < y[1].chain ? -1 : x[1].chain > y[1].chain ? 1 : x[1].resi - y[1].resi));
  const filt = h('input', { type: 'text', placeholder: 'Filter, e.g. THR or 315', 'aria-label': 'Filter residues', style: 'flex:1;min-width:0;height:28px;border:1px solid var(--line);background:var(--paper);border-radius:6px;padding:0 7px' });
  const list = h('div', { cls: 'list', style: 'max-height:210px;overflow-y:auto' });
  for (const [k, r] of rows) {
    const on = eff.has(k), label = r.res + r.resi + (A.chains.length > 1 ? ' · chain ' + r.chain : '');
    const row = h('label', { cls: 'item', 'data-q': (r.res + r.resi).toLowerCase() }, h('input', { type: 'checkbox', checked: on, 'aria-label': label, style: 'accent-color:var(--accent)', on: { change: e => {
      if (e.target.checked) { A.keyOff.delete(k); A.keyRes.set(k, r); } else { A.keyRes.delete(k); if (near.has(k)) A.keyOff.add(k); } refreshView(); } } }),
      h('span', { cls: 'nm', text: label }), near.has(k) ? h('span', { cls: 'chip', text: 'near ' + near.get(k) }) : null);
    list.append(row);
  }
  filt.addEventListener('input', () => { const q = filt.value.trim().toLowerCase(); for (const r of list.children) r.hidden = q && !r.dataset.q.includes(q); });
  sec.append(h('div', { cls: 'row' }, filt, h('button', { cls: 'btn sm', type: 'button', text: 'Clear all', disabled: !eff.size && !A.keyNear.size, on: { click: () => { A.keyRes.clear(); A.keyNear.clear(); A.keyOff.clear(); refreshAll(); } } })),
    rows.length ? list : h('p', { cls: 'note', text: 'Set the search box to list the residues inside it.' }),
    h('p', { cls: 'note', text: eff.size + ' highlighted. Ticking a row also works while you rotate the view.' }));
  const inp = h('input', { type: 'text', placeholder: 'A:381, 315-320, THR315', 'aria-label': 'Add residues by number', on: { keydown: e => { if (e.key === 'Enter') add(); } } });
  const add = () => { addKeyResidues(inp.value); refreshAll(); };
  sec.append(h('details', {}, h('summary', { text: 'Add by residue number' }), h('div', { cls: 'row', style: 'margin-top:6px' }, inp, h('button', { cls: 'btn', text: 'Add', on: { click: add } }))));
  return sec;
}

/* ===================== surface and selected-only ===================== */
const VDW = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, F: 1.47, Cl: 1.75, Br: 1.85, Zn: 1.4, Mg: 1.4, Fe: 1.4, Ca: 1.7 };
const onlyOn = () => A.vw.only && !!A.rec && effectiveKeys().eff.size > 0;
let surfJob = 0;
function drawSurface(V) {
  const b = A.box; if (!A.rec || !A.vw.surf || onlyOn() || !b) { surfJob++; V.clearLayer('surf'); return; }
  const key = [A.rec.n, ...b.c, ...b.s].map(v => typeof v === 'number' ? v.toFixed(2) : v).join('|');
  if (V.layers.surf && V.layers.surf.__key === key) return;
  const job = ++surfJob; toast('Building surface…');
  setTimeout(() => { // let the toast paint first; the build blocks for a second or two
    if (job !== surfJob || !A.rec || !A.vw.surf) return;
    const m = 20, lo = [0, 1, 2].map(q => b.c[q] - b.s[q] / 2 - m), hi = [0, 1, 2].map(q => b.c[q] + b.s[q] / 2 + m), rec = A.rec, pts = [], rad = [], cls = [], CL = { N: 1, O: 2, S: 3 };
    for (let i = 0; i < rec.n; i++) { const t = rec.meta[i]; if (t.el === 'H') continue; const x = rec.X[3*i], y = rec.X[3*i+1], z = rec.X[3*i+2];
      if (x < lo[0] - 5 || x > hi[0] + 5 || y < lo[1] - 5 || y > hi[1] + 5 || z < lo[2] - 5 || z > hi[2] + 5) continue; pts.push(x, y, z); rad.push(VDW[t.el] || 1.7); cls.push(CL[t.el] || 0); }
    V.surface('surf', new Float32Array(pts), new Float32Array(rad), lo, hi, { h: 0.6, cls: Uint8Array.from(cls) });
    if (V.layers.surf) V.layers.surf.__key = key; const tt = $('#toast'); if (tt) tt.hidden = true;
  }, 30);
}
function molSticks(V, name, mol, pos, opt = {}) {
  const el = mol.atoms.map(a => a.el), bonds = []; mol.bonds.forEach(b => bonds.push(b.a, b.b));
  V.sticks(name, { pos, el, bonds, carbon: opt.carbon ?? accentHex(), ball: opt.ball ?? 0.3, stick: opt.stick ?? 0.14, skip: A.vw.H ? null : (i => el[i] === 'H') });
}
function molPos(mol) { const p = new Float32Array(mol.atoms.length * 3); mol.atoms.forEach((a, i) => { p[3*i] = a.x; p[3*i+1] = a.y; p[3*i+2] = a.z; }); return p; }
function recSticks(V, name, idxs) {
  const rec = A.rec, map = new Map(); idxs.forEach((i, k) => map.set(i, k)); const pos = new Float32Array(idxs.length * 3), el = [];
  idxs.forEach((i, k) => { pos[3*k] = rec.X[3*i]; pos[3*k+1] = rec.X[3*i+1]; pos[3*k+2] = rec.X[3*i+2]; el.push(rec.meta[i].el); });
  const bonds = []; for (let b = 0; b < rec.bonds.length; b += 2) { const a = map.get(rec.bonds[b]), c = map.get(rec.bonds[b+1]); if (a !== undefined && c !== undefined) bonds.push(a, c); }
  V.sticks(name, { pos, el, bonds, carbon: dark() ? 0x8e9aa6 : 0x7c8a97, ball: 0.17, stick: 0.09 });
}
function residuesNear(pts, d) {
  const rec = A.rec, keys = new Set(), d2 = d * d; for (let i = 0; i < rec.n; i++) { const x = rec.X[3*i], y = rec.X[3*i+1], z = rec.X[3*i+2];
    for (const p of pts) { const dx = x - p[0], dy = y - p[1], dz = z - p[2]; if (dx*dx + dy*dy + dz*dz < d2) { keys.add(rec.meta[i].chain + rec.meta[i].resi); break; } } }
  const out = []; for (let i = 0; i < rec.n; i++) if (keys.has(rec.meta[i].chain + rec.meta[i].resi)) out.push(i); return out;
}
function showPose(l, m, quiet) {
  const V = ensureViewer(); if (!V || !l.dock) return; const d = l.dock, mol = d.mol, pos = m.pos;
  const hp = d.heavy.map(i => [pos[3*i], pos[3*i+1], pos[3*i+2]]), c = Dock.centroid(hp.map(p => ({ x: p[0], y: p[1], z: p[2] })));
  A.posePts = hp; V.clearLayer('box'); V.clearLayer('pts'); V.clearLayer('ref');
  const only = !quiet && onlyOn(); if (A.vw.trace && !V.layers.trace) V.trace('trace', A.rec); const surfOn = !quiet && A.vw.surf; V.show('trace', A.vw.trace && !only && !surfOn);
  if (only || surfOn) V.clearLayer('pocket'); else recSticks(V, 'pocket', residuesNear(hp, 5.5)); molSticks(V, 'lig', mol, pos);
  if (quiet) V.clearLayer('surf'); else drawSurface(V);
  V.dashes('hb', m.inter.hbonds.map(b => [hp[d.heavy.indexOf(b.la)], [A.rec.X[3*b.ra], A.rec.X[3*b.ra+1], A.rec.X[3*b.ra+2]]]));
  let r = 0; hp.forEach(p => { r = Math.max(r, Math.hypot(p[0]-c[0], p[1]-c[1], p[2]-c[2])); });
  drawKey(V); V.frame(c, r + 3.5); V.slab = (surfOn && !only) ? 120 : r + 8; V._cam();
  if (!quiet) { const e = $('#vinfo'); e.replaceChildren(h('span', { text: l.name + ' · mode ' + m.rank + ' · ' + f1(m.kJ) + ' kJ/mol' }), h('span', { text: m.inter.hbonds.length + ' H-bonds (dashed)' })); }
}
function refreshView() {
  const draw = A.step === 'draw'; $('#paneDraw').hidden = !draw; $('#paneView').hidden = draw; const tools = $('#vtools'), info = $('#vinfo'), empty = $('#vempty'); tools.replaceChildren(); info.replaceChildren(); empty.hidden = true;
  if (draw) return;
  const V = ensureViewer(); if (!V) { empty.hidden = false; empty.textContent = A.viewerErr; return; } V.dark = dark(); V.resize();
  const tb = (t, fn, on) => h('button', { cls: 'btn sm' + (on ? ' pri' : ''), text: t, on: { click: fn } });
  tools.append(tb('Reset view', () => { V.resetRotation(); refreshView(); }), tb('H', () => { A.vw.H = !A.vw.H; refreshView(); }, A.vw.H), tb('Protein', () => { A.vw.trace = !A.vw.trace; refreshView(); }, A.vw.trace), tb('Box', () => { A.vw.box = !A.vw.box; refreshView(); }, A.vw.box), ...(A.rec ? [...(A.vw.surf ? [h('span', { cls: 'chip', text: 'Cut' }), h('input', { type: 'range', min: -12, max: 12, step: 0.5, value: V.cut, title: 'Cut depth through the surface', 'aria-label': 'Surface cut depth', style: 'width:84px;accent-color:var(--accent)', on: { input: e => { V.cut = +e.target.value; V.dirty = true; } } })] : []), tb('Surface', () => { A.vw.surf = !A.vw.surf; refreshView(); }, A.vw.surf), tb('Selected only', () => { if (!effectiveKeys().eff.size) { toast('Highlight some residues first.'); return; } A.vw.only = !A.vw.only; refreshView(); }, A.vw.only), tb('Key', () => { A.vw.key = !A.vw.key; refreshView(); }, A.vw.key)] : []),
    tb('Save image', async () => { const u = V.snapshot(1600, snapH(1600)); saveFile('bondline-dock.png', await dataUrlBlob(u)); }));
  if (A.step === 'model') {
    ['trace', 'pocket', 'box', 'pts', 'hb', 'ref'].forEach(n => V.clearLayer(n)); const l = sel();
    if (!l || !l.mol) { V.clearLayer('lig'); empty.hidden = false; empty.textContent = l ? 'Convert the structure to 3D to see it here.' : 'Add a structure from the Draw step.'; return; }
    const pos = molPos(l.mol); molSticks(V, 'lig', l.mol, pos); const c = [0, 1, 2].map(q => { let s = 0; for (let i = 0; i < l.mol.atoms.length; i++) s += pos[3*i+q]; return s / l.mol.atoms.length; });
    let r = 0; for (let i = 0; i < l.mol.atoms.length; i++) r = Math.max(r, Math.hypot(pos[3*i]-c[0], pos[3*i+1]-c[1], pos[3*i+2]-c[2])); V.frame(c, r + 2);
    info.append(h('span', { text: l.name + ' · ' + l.fm }), h('span', { text: 'E = ' + f1(l.E) + ' kJ/mol' + (l.state === 'min' ? ' (minimised)' : '') }));
    return;
  }
  if (A.step === 'rec' || A.step === 'dock') {
    ['lig', 'hb'].forEach(n => V.clearLayer(n)); if (!A.rec) { ['trace', 'pocket', 'box', 'pts', 'ref', 'key', 'keylbl', 'surf'].forEach(n => V.clearLayer(n)); empty.hidden = false; empty.textContent = 'Load a target to see it here.'; return; }
    if (!V.layers.trace || V.layers.trace.__rec !== A.rec) { V.trace('trace', A.rec); V.layers.trace.__rec = A.rec; } V.show('trace', A.vw.trace && !onlyOn() && !A.vw.surf);
    const b = A.box, idx = []; for (let i = 0; i < A.rec.n; i++) { let ok = true; for (let q = 0; q < 3; q++) if (Math.abs(A.rec.X[3*i+q] - b.c[q]) > b.s[q] / 2 + 1) { ok = false; break; } if (ok) idx.push(i); }
    if (onlyOn() || A.vw.surf) V.clearLayer('pocket'); else recSticks(V, 'pocket', idx);
    drawSurface(V);
    if (A.vw.box) V.box('box', b); else V.clearLayer('box');
    const p = A.pockets[A.pocketSel]; if (p && A.boxMode === 'auto') V.points('pts', p.pts); else V.clearLayer('pts');
    if (A.example && A.ligs.some(q => q.crystal) === false && A.recName.startsWith('1IEP') && false) {}
    drawKey(V); V.frame(b.c, Math.max(...b.s) / 2 + 6); V.slab = (A.vw.surf && !onlyOn()) ? 120 : Math.max(...b.s) / 2 + 8; V._cam();
    info.append(h('span', { text: 'Box centre ' + b.c.map(v => v.toFixed(1)).join(', ') }), h('span', { text: b.s.map(v => v.toFixed(0)).join(' × ') + ' Å' }));
    return;
  }
  if (A.step === 'res') {
    const l = A.ligs.find(q => q.id === A.pose.id), r = l && A.results[l.id];
    if (!r) { ['lig', 'pocket', 'hb', 'trace', 'box', 'pts', 'ref', 'key', 'keylbl', 'surf'].forEach(n => V.clearLayer(n)); empty.hidden = false; empty.textContent = 'Run a docking to see poses here.'; return; }
    showPose(l, r.modes[A.pose.mode] || r.modes[0]);
  }
}

/* ===================== panels ===================== */
function renderSteps() {
  const nav = $('#steps'); nav.replaceChildren();
  const done = { draw: A.ligs.length > 0, model: A.ligs.some(l => l.state === 'min'), rec: !!A.rec && !!A.box, dock: Object.keys(A.results).length > 0, res: false };
  STEPS.forEach(([k, t], i) => nav.append(h('button', { cls: 'step' + (A.step === k ? ' on' : '') + (done[k] && A.step !== k ? ' done' : ''), type: 'button', on: { click: () => go(k) } }, h('span', { cls: 'n', text: done[k] && A.step !== k ? '✓' : String(i + 1) }), h('span', { cls: 't', text: t }))));
}
function go(k) { if (A.running) return toast('Docking is running. Cancel it first.'); A.step = k; refreshAll(); }
function refreshAll() { renderSteps(); renderPanel(); refreshView(); }
function renderPanel() {
  const p = $('#panel'), top = p.scrollTop; p.replaceChildren(({ draw: panelDraw, model: panelModel, rec: panelRec, dock: panelDock, res: panelRes })[A.step]()); if (!p.firstChild) return; p.scrollTop = top; if (A.step === 'draw') renderLive(); renderSteps();
}
const stat = l => l.state === 'min' ? h('span', { cls: 'chip ok', text: 'minimised' }) : l.state === '3d' ? h('span', { cls: 'chip ok', text: '3D' }) : h('span', { cls: 'chip', text: '2D' });

function libraryList(opts = {}) {
  if (!A.ligs.length) return h('p', { cls: 'note', text: 'No ligands yet. Draw a structure, then add it to the library.' });
  return h('div', { cls: 'list' }, A.ligs.map(l => h('div', { cls: 'item' + (l.id === A.sel ? ' on' : ''), on: { click: e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return; A.sel = l.id; if (A.step === 'res' && A.results[l.id]) A.pose = { id: l.id, mode: 0 }; refreshAll(); } } },
    opts.check ? h('input', { type: 'checkbox', checked: l.dockOn !== false, 'aria-label': 'Dock ' + l.name, on: { change: e => { l.dockOn = e.target.checked; } } }) : null,
    h('input', { type: 'text', value: l.name, 'aria-label': 'Ligand name', on: { change: e => { l.name = e.target.value.trim() || l.name; }, click: e => e.stopPropagation() } }),
    h('span', { cls: 'fm', text: l.fm }), stat(l),
    opts.del === false ? null : h('button', { cls: 'btn sm', type: 'button', text: '×', title: 'Remove', 'aria-label': 'Remove ' + l.name, on: { click: e => { e.stopPropagation(); A.ligs = A.ligs.filter(q => q !== l); delete A.results[l.id]; if (A.sel === l.id) A.sel = A.ligs[0] ? A.ligs[0].id : null; refreshAll(); } } }))));
}

function panelDraw() {
  const box = h('div', { cls: 'sec' });
  box.append(h('h2', { text: 'Draw a ligand' }),
    h('p', { cls: 'lead', text: 'Draw with Bondline on the right. Every connected structure on the page appears below as you draw. Add the ones you want to dock.' }));
  box.append(h('ol', { cls: 'wf' }, ...['Draw in Bondline', '3D build and minimise', 'Load a target, set the pocket', 'Dock and read kJ/mol'].map((t, i) => h('li', {}, h('b', { text: String(i + 1) }), t))),
    h('p', { cls: 'note', text: 'Bondline is loaded from the Bondline tool in this site. Replace that file and Dock follows. Scores are Vina-style estimates for ranking and exploration, not AutoDock Vina itself.' }));
  if (BL.err) box.append(h('p', { cls: 'bad', text: BL.err }));
  box.append(h('div', { cls: 'sec' }, h('h3', { text: 'On the page now' }), h('div', { id: 'liveBox' })));
  box.append(h('div', { cls: 'sec' }, h('h3', { text: 'Ligand library' }), libraryList(),
    h('div', { cls: 'row' }, h('button', { cls: 'btn', text: 'Update from drawing', title: 'Re-read the structures from the page into library entries that came from it', on: { click: updateFromDrawing } }),
      h('button', { cls: 'btn pri', text: 'Continue to 3D', disabled: !A.ligs.length, on: { click: () => go('model') } }))));
  box.append(h('details', {}, h('summary', { text: 'How this works' }), h('p', { cls: 'note', style: 'margin-top:8px', text: 'Bondline gives a 2D molfile. Hydrogens are added, wedge and hash bonds fix stereochemistry, and a conformer search with a generic force field builds 3D coordinates. Minimisation uses steepest descent then conjugate gradient, as in ChimeraX. Docking uses a Vina-style scoring function with a Monte Carlo and BFGS search, written for this page. It is not AutoDock Vina itself, so scores are comparable in spirit but not identical.' })));
  return box;
}
function renderLive() {
  const b = $('#liveBox'); if (!b) return; b.replaceChildren();
  if (A.live.err) b.append(h('p', { cls: 'bad', text: A.live.err }));
  if (!A.live.comps.length && !A.live.err) { b.append(h('p', { cls: 'note', text: 'The page is empty. Use the Examples menu in Bondline, or draw a bond.' })); return; }
  const list = h('div', { cls: 'list' });
  for (const c of A.live.comps) {
    const added = A.ligs.some(l => l.di === c.i && l.sig === sigOf(c.parsed));
    list.append(h('div', { cls: 'item', style: 'cursor:default' }, h('span', { cls: 'nm', text: c.custom ? 'Structure ' + (c.i + 1) : (c.fm || 'Structure ' + (c.i + 1)) }), h('span', { cls: 'fm', text: c.custom ? '' : c.mw.toFixed(2) + ' g/mol' }),
      c.custom ? h('span', { cls: 'warn', text: 'has a custom label' }) : h('button', { cls: 'btn sm' + (added ? '' : ' pri'), type: 'button', text: added ? 'Added' : 'Add', disabled: added || !!c.err, on: { click: () => { const l = addFromDrawing(c); l.sig = sigOf(c.parsed); renderPanel(); } } })));
  }
  b.append(list);
  if (A.live.comps.some(c => c.custom)) b.append(h('p', { cls: 'warn', style: 'margin-top:6px', text: 'Labels such as R, Ph or Boc have no 3D geometry. Draw the real atoms to use that structure.' }));
  const ok = A.live.comps.filter(c => !c.custom && !c.err && !A.ligs.some(l => l.di === c.i && l.sig === sigOf(c.parsed)));
  if (ok.length > 1) b.append(h('button', { cls: 'btn sm', style: 'margin-top:6px', type: 'button', text: 'Add all (' + ok.length + ')', on: { click: () => { ok.forEach(c => { const l = addFromDrawing(c); l.sig = sigOf(c.parsed); }); renderPanel(); } } }));
}
const sigOf = p => p.atoms.map(a => a.el + a.q + Math.round(a.x * 20) + ',' + Math.round(a.y * 20)).join('|') + '#' + p.bonds.map(b => b.a + '-' + b.b + 'o' + b.o + 's' + b.st).join('|');
function updateFromDrawing() {
  let n = 0; for (const l of A.ligs) { if (l.di == null) continue; const c = A.live.comps.find(q => q.i === l.di); if (!c || c.custom) continue; const s = sigOf(c.parsed); if (s === l.sig) continue;
    l.parsed = c.parsed; l.sig = s; l.mol = null; l.state = '2d'; l.hist = []; l.E = null; l.parts = null; l.dock = null; delete A.results[l.id]; l.fm = c.fm; l.mw = c.mw; n++; }
  toast(n ? n + ' ligand' + (n > 1 ? 's' : '') + ' updated. Convert them to 3D again.' : 'The library already matches the drawing.'); renderPanel();
}

function panelModel() {
  const box = h('div', { cls: 'sec' }), l = sel();
  box.append(h('h2', { text: '3D structure and minimisation' }));
  if (!A.ligs.length) { box.append(h('p', { cls: 'lead', text: 'Add a ligand in the Draw step first.' }), h('button', { cls: 'btn', text: 'Back to Draw', on: { click: () => go('draw') } })); return box; }
  box.append(libraryList({ del: false }));
  const o = A.o, num = (lab, key, min, max, step) => h('div', { cls: 'row' }, h('label', { text: lab }), h('input', { type: 'number', min, max, step, value: o[key], on: { change: e => { o[key] = Math.max(min, Math.min(max, +e.target.value || o[key])); e.target.value = o[key]; } } }));
  box.append(h('div', { cls: 'sec' }, h('h3', { text: '1. Convert 2D to 3D' }), num('Conformers', 'conf', 1, 60, 1),
    h('div', { cls: 'row' }, h('button', { cls: 'btn pri', text: 'Convert selected', disabled: !l || !!A.busy, on: { click: async () => { A.busy = 'x'; try { convert3D(l); } catch (e) { toast('3D conversion failed: ' + e.message, 6000); } A.busy = ''; refreshAll(); } } }),
      h('button', { cls: 'btn', text: 'Convert all', disabled: !!A.busy, on: { click: async () => { A.busy = 'x'; renderPanel(); await tick(); for (const q of A.ligs) { if (q.crystal) continue; try { convert3D(q); } catch (e) { toast(q.name + ': ' + e.message, 6000); } await tick(); } A.busy = ''; refreshAll(); } } })),
    h('p', { cls: 'note', text: 'Adds hydrogens, keeps wedge and hash stereochemistry, then ranks random conformers by force-field energy.' })));
  box.append(h('div', { cls: 'sec' }, h('h3', { text: '2. Minimise' }), num('Steepest descent', 'sd', 0, 5000, 10), num('Conjugate gradient', 'cg', 0, 2000, 5), num('Step size (Å)', 'step', 0.001, 0.2, 0.005),
    h('label', { cls: 'chk' }, h('input', { type: 'checkbox', checked: o.conv, on: { change: e => { o.conv = e.target.checked; } } }), 'Repeat until the energy stops changing'),
    h('div', { cls: 'row' }, h('button', { cls: 'btn pri', text: 'Minimise selected', disabled: !l || !!A.busy, on: { click: async () => { A.busy = 'x'; renderPanel(); await tick(); try { await minimiseLig(l); } catch (e) { toast('Minimisation failed: ' + e.message, 6000); } A.busy = ''; refreshAll(); } } }),
      h('button', { cls: 'btn', text: 'Minimise all', disabled: !!A.busy, on: { click: async () => { A.busy = 'x'; renderPanel(); await tick(); for (const q of A.ligs) { if (q.crystal) continue; try { await minimiseLig(q); } catch (e) { toast(q.name + ': ' + e.message, 6000); } } A.busy = ''; refreshAll(); } } }))));
  if (l && l.mol) {
    box.append(h('div', { cls: 'sec' }, h('h3', { text: 'Energy' }), plot(l.hist, l.E),
      h('dl', { cls: 'kv' }, ...(l.parts ? [['Bond stretch', l.parts.bond], ['Angle bend', l.parts.angle], ['Torsion', l.parts.tors], ['Planarity', l.parts.oop], ['van der Waals', l.parts.vdw], ['Total', l.E]] : [['Total', l.E]]).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: f1(v) + ' kJ/mol' })])),
      h('p', { cls: 'note', text: 'A small generic force field (bonds, angles, torsions, planarity, Lennard-Jones). Fine for docking input, not for conformational energetics.' }),
      h('div', { cls: 'row' }, h('button', { cls: 'btn sm', text: 'Save PDB', on: { click: () => saveFile(l.name.replace(/\W+/g, '_') + '.pdb', Chem.toPDB(l.mol, 'LIG')) } }), h('button', { cls: 'btn sm', text: 'Save SDF', on: { click: () => saveFile(l.name.replace(/\W+/g, '_') + '.sdf', Chem.toSDF(l.mol, l.name)) } }))));
  }
  box.append(h('button', { cls: 'btn pri wide', text: 'Continue to target', on: { click: () => go('rec') } }));
  return box;
}
function plot(hist, E) {
  const W = 340, Hh = 92, svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'plot'); svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Energy during minimisation');
  if (!hist || hist.length < 2) { svg.innerHTML = `<text x="10" y="50">No minimisation run yet</text>`; return svg; }
  const mn = Math.min(...hist), mx = Math.max(...hist), rng = (mx - mn) || 1; let d = '';
  const step = Math.max(1, Math.floor(hist.length / 300)); for (let i = 0; i < hist.length; i += step) d += (i ? 'L' : 'M') + (8 + (W - 16) * i / (hist.length - 1)).toFixed(1) + ' ' + (Hh - 14 - (Hh - 30) * (hist[i] - mn) / rng).toFixed(1);
  svg.innerHTML = `<path d="${d}"/><text x="8" y="11">${f1(mx)}</text><text x="8" y="${Hh - 3}">${f1(mn)} kJ/mol</text>`; return svg;
}

function panelRec() {
  const box = h('div', { cls: 'sec' });
  box.append(h('h2', { text: 'Target and binding pocket' }));
  if (A.busy && A.busy !== 'x') box.append(h('p', { cls: 'lead', text: A.busy + '…' }));
  const fi = h('input', { type: 'file', accept: '.pdb,.ent,.txt', 'aria-label': 'Choose a PDB file', on: { change: e => { const fl = e.target.files[0]; if (!fl) return; const rd = new FileReader(); rd.onload = () => { A.example = null; loadReceptorText(String(rd.result), fl.name); }; rd.readAsText(fl); } } });
  const ta = h('textarea', { cls: 'paste', placeholder: 'Paste PDB text here', spellcheck: 'false', 'aria-label': 'PDB text' });
  box.append(h('div', { cls: 'sec' }, h('h3', { text: 'Load a protein' }), fi,
    h('details', {}, h('summary', { text: 'Paste PDB text' }), ta, h('button', { cls: 'btn sm', style: 'margin-top:6px', text: 'Load pasted text', on: { click: () => { if (ta.value.trim()) { A.example = null; loadReceptorText(ta.value, 'pasted structure'); } } } })),
    h('button', { cls: 'btn', text: 'Load example: ABL kinase (1IEP)', disabled: !!A.busy, on: { click: loadExample } }),
    h('p', { cls: 'note', text: 'This page cannot download from the PDB. Save the .pdb file from rcsb.org and choose it here.' })));
  if (!A.rec) return box;
  const rec = A.rec;
  box.append(h('div', { cls: 'sec' }, h('h3', { text: A.recName }),
    h('dl', { cls: 'kv' }, h('dt', { text: 'Heavy atoms used' }), h('dd', { text: String(rec.n) }), h('dt', { text: 'Hydrogens in file' }), h('dd', { text: rec.fileHasH ? 'yes' : 'no (donors by residue)' }), h('dt', { text: 'Waters' }), h('dd', { text: 'removed' })),
    A.chains.length > 1 ? h('div', { cls: 'row' }, h('label', { text: 'Chains' }), ...A.chains.map(c => h('label', { cls: 'chk' }, h('input', { type: 'checkbox', checked: A.selChains.has(c), on: { change: e => { if (e.target.checked) A.selChains.add(c); else A.selChains.delete(c); if (!A.selChains.size) A.selChains.add(c); A.box = null; prepRec(); } } }), c || '-'))) : null,
    A.hets.length ? h('div', { cls: 'sec' }, h('p', { cls: 'note', text: 'Other molecules in the file. Tick to keep one as part of the target, or use it to centre the box.' }), ...A.hets.map(g => h('div', { cls: 'row' }, h('label', { cls: 'chk', style: 'min-width:0;flex:1' }, h('input', { type: 'checkbox', checked: A.keepHet.has(g.id), on: { change: e => { if (e.target.checked) A.keepHet.add(g.id); else A.keepHet.delete(g.id); prepRec(); } } }), g.res + ' ' + g.resi + (g.chain.trim() ? ':' + g.chain : '') + ' · ' + g.nHeavy + ' atoms'), g.nHeavy >= 5 ? h('button', { cls: 'btn sm', text: 'Box on this', on: { click: () => { useHet(g); refreshAll(); } } }) : null))) : null));
  /* pocket */
  const modes = [['auto', 'Detected pockets'], ['site', 'Known site'], ['res', 'Residues'], ['manual', 'Manual']];
  const sec = h('div', { cls: 'sec' }, h('h3', { text: 'Binding pocket' }), h('div', { cls: 'seg' }, ...modes.map(([k, t]) => h('button', { type: 'button', cls: A.boxMode === k ? 'on' : '', text: t, on: { click: () => { A.boxMode = k; if (k === 'auto' && A.pockets.length) usePocket(Math.max(0, A.pocketSel)); if (k === 'site') { if (A.example) useExampleSite(); } refreshAll(); } } }))));
  if (A.boxMode === 'auto') sec.append(A.pockets.length ? h('div', { cls: 'list' }, A.pockets.map((p, i) => h('div', { cls: 'item' + (i === A.pocketSel ? ' on' : ''), on: { click: () => { usePocket(i); refreshAll(); } } }, h('span', { cls: 'nm', text: 'Pocket ' + (i + 1) }), h('span', { cls: 'fm', text: Math.round(p.vol) + ' Å³' })))) : h('p', { cls: 'note', text: 'No enclosed cavities found. Use a known site, residues or the manual box.' }),
    h('p', { cls: 'note', text: 'Found by scanning for grid points buried on both sides (LIGSITE style). Largest first.' }));
  if (A.boxMode === 'site') { const gs = A.hets.filter(g => g.nHeavy >= 5);
    sec.append(...[A.example ? h('div', { cls: 'row' }, h('button', { cls: 'btn', text: 'Centre on imatinib (1IEP)', on: { click: () => { useExampleSite(); refreshAll(); } } })) : null,
      gs.length ? h('div', { cls: 'row' }, ...gs.map(g => h('button', { cls: 'btn', text: g.res + ' ' + g.resi, on: { click: () => { useHet(g); refreshAll(); } } }))) : (A.example ? null : h('p', { cls: 'note', text: 'The file has no ligand to centre on.' }))].filter(Boolean)); }
  if (A.boxMode === 'res') { const inp = h('input', { type: 'text', id: 'resin', placeholder: 'A:381, A:315, 316-320', 'aria-label': 'Residues' }); sec.append(h('div', { cls: 'row' }, inp, h('button', { cls: 'btn', text: 'Set box', on: { click: () => useResidues(inp.value) } })), h('p', { cls: 'note', text: 'Residue numbers as in the file. The box is fitted around them.' })); }
  const b = A.box; if (b) {
    const g = (lab, arr, q, min, max) => h('label', {}, lab, h('input', { type: 'number', step: '0.5', min, max, value: +arr[q].toFixed(2), on: { change: e => { arr[q] = Math.max(min, Math.min(max, +e.target.value)); A.boxMode = 'manual'; refreshView(); renderPanel(); } } }));
    sec.append(h('h3', { text: 'Search box (Å)', style: 'margin-top:6px' }), h('div', { cls: 'grid3' }, g('Centre x', b.c, 0, -1e4, 1e4), g('Centre y', b.c, 1, -1e4, 1e4), g('Centre z', b.c, 2, -1e4, 1e4), g('Size x', b.s, 0, 8, 60), g('Size y', b.s, 1, 8, 60), g('Size z', b.s, 2, 8, 60)));
    const pts = b.s.reduce((a, v) => a * (Math.ceil(v / A.o.spacing) + 1), 1); if (pts > 400000) sec.append(h('p', { cls: 'warn', text: 'This box is large. Grid maps will take a while to build.' }));
  }
  box.append(sec);
  if (A.example && !A.ligs.some(l => l.crystal)) box.append(h('div', { cls: 'sec' }, h('h3', { text: 'Redocking test' }), h('p', { cls: 'note', text: 'Add the crystal pose of imatinib as a ligand. After docking, the RMSD to the crystal pose shows how well the search recovers it.' }), h('button', { cls: 'btn', text: 'Add imatinib to the library', on: { click: () => { addExampleLigand(); refreshAll(); } } })));
  box.append(keyPanel());
  box.append(h('button', { cls: 'btn pri wide', text: 'Continue to docking', disabled: !A.box, on: { click: () => go('dock') } }));
  return box;
}

function panelDock() {
  const box = h('div', { cls: 'sec' }); box.append(h('h2', { text: 'Dock' }));
  if (!A.rec || !A.box) { box.append(h('p', { cls: 'lead', text: 'Load a target and set the search box first.' }), h('button', { cls: 'btn', text: 'Go to target', on: { click: () => go('rec') } })); return box; }
  if (!A.ligs.length) { box.append(h('p', { cls: 'lead', text: 'Add at least one ligand.' }), h('button', { cls: 'btn', text: 'Go to Draw', on: { click: () => go('draw') } })); return box; }
  const o = A.o, num = (lab, key, min, max, step, conv) => h('div', { cls: 'row' }, h('label', { text: lab }), h('input', { type: 'number', min, max, step, value: o[key], disabled: A.running, on: { change: e => { o[key] = Math.max(min, Math.min(max, +e.target.value || o[key])); e.target.value = o[key]; } } }));
  box.append(h('div', { cls: 'sec' }, h('h3', { text: 'Ligands to dock' }), libraryList({ check: true, del: false }), A.ligs.some(l => l.state === '2d') ? h('p', { cls: 'note', text: 'Ligands still in 2D are converted to 3D automatically. Minimise them first for better input geometry.' }) : null));
  box.append(h('div', { cls: 'sec' }, h('h3', { text: 'Search' }), num('Exhaustiveness', 'runs', 1, 256, 1), h('div', { cls: 'row' }, h('label', { text: 'Effort' }), h('select', { disabled: A.running, 'aria-label': 'Search effort', on: { change: e => { o.effort = +e.target.value; } } }, ...[[0.5, 'Quick'], [1, 'Standard'], [3, 'Thorough'], [8, 'Exhaustive']].map(([v, t]) => h('option', { value: v, text: t, selected: o.effort === v })))),
    num('Poses to keep', 'modes', 1, 20, 1), num('Energy range (kJ/mol)', 'rangeKJ', 1, 40, 0.5), h('div', { cls: 'row' }, h('label', { text: 'Grid spacing' }), h('select', { disabled: A.running, 'aria-label': 'Grid spacing', on: { change: e => { o.spacing = +e.target.value; } } }, ...[[0.375, '0.375 Å (finer)'], [0.5, '0.5 Å'], [0.75, '0.75 Å (faster)']].map(([v, t]) => h('option', { value: v, text: t, selected: o.spacing === v })))),
    h('p', { cls: 'note', text: 'Exhaustiveness is the number of independent Monte Carlo runs. Each run takes more steps for ligands with more rotatable bonds.' })));
  if (A.running) {
    box.append(h('div', { cls: 'sec' }, h('p', { id: 'pg-txt', cls: 'sub' }), h('div', { cls: 'bar', 'aria-label': 'Grid maps' }, h('i', { id: 'pg-grid' })), h('div', { cls: 'bar', 'aria-label': 'Docking' }, h('i', { id: 'pg-lig' })), h('button', { cls: 'btn wide', text: 'Cancel', on: { click: () => { A.cancel = true; } } })));
  } else box.append(h('button', { cls: 'btn pri wide', text: 'Run docking', on: { click: runDocking } }));
  box.append(h('div', { id: 'log', cls: 'log', text: A.log.join('\n') || 'Log' }));
  return box;
}

function panelRes() {
  const box = h('div', { cls: 'sec' }); box.append(h('h2', { text: 'Docking results' }));
  const done = A.ligs.filter(l => A.results[l.id]);
  if (!done.length) { box.append(h('p', { cls: 'lead', text: 'No results yet.' }), h('button', { cls: 'btn', text: 'Go to Dock', on: { click: () => go('dock') } })); return box; }
  const hasRef = done.some(l => l.ref);
  box.append(h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Ligand' }), h('th', { cls: 'num', text: 'kJ/mol' }), h('th', { cls: 'num', text: 'kcal/mol' }), h('th', { cls: 'num', text: 'H-bonds' }), hasRef ? h('th', { cls: 'num', text: 'RMSD ref' }) : null)),
    h('tbody', {}, ...done.map(l => { const b = A.results[l.id].modes[0]; return h('tr', { cls: 'sel' + (l.id === A.pose.id ? ' pick' : ''), on: { click: () => { A.sel = l.id; A.pose = { id: l.id, mode: 0 }; refreshAll(); } } }, h('td', { text: l.name }), h('td', { cls: 'num', text: f1(b.kJ) }), h('td', { cls: 'num', text: b.kcal.toFixed(2) }), h('td', { cls: 'num', text: String(b.inter.hbonds.length) }), hasRef ? h('td', { cls: 'num', text: b.rmsdRef != null ? b.rmsdRef.toFixed(2) + ' Å' : '' }) : null); }))));
  const l = A.ligs.find(q => q.id === A.pose.id) || done[0], r = A.results[l.id];
  box.append(h('div', { cls: 'sec' }, h('h3', { text: l.name + ' · ' + r.modes.length + ' poses' }), h('div', { cls: 'modes' }, ...r.modes.map((m, k) => h('div', { cls: 'mode' + (k === A.pose.mode ? ' on' : ''), on: { click: () => { A.pose = { id: l.id, mode: k }; renderPanel(); showPose(l, m); } } },
    m.img ? h('img', { src: m.img, alt: 'Pose ' + m.rank + ' in the binding pocket' }) : h('div'),
    h('div', {}, h('div', { cls: 'aff' }, f1(m.kJ), h('small', { text: 'kJ/mol' })), h('div', { cls: 'sub', text: 'Pose ' + m.rank + ' · ' + m.kcal.toFixed(2) + ' kcal/mol' }),
      h('div', { cls: 'sub', text: (k ? 'RMSD from best ' + m.rmsd.toFixed(2) + ' Å · ' : '') + m.inter.hbonds.length + ' H-bonds · ' + m.inter.hydrophobic + ' hydrophobic contacts' + (m.rmsdRef != null ? ' · ref ' + m.rmsdRef.toFixed(2) + ' Å' : '') }),
      k === A.pose.mode && m.inter.hbonds.length ? h('div', { cls: 'sub', style: 'margin-top:4px;white-space:normal', text: m.inter.hbonds.slice(0, 5).map(b => b.lig + ' ↔ ' + b.res + ' ' + b.atom + ' ' + b.d.toFixed(2) + ' Å').join('; ') }) : null))))));
  const m = r.modes[A.pose.mode] || r.modes[0];
  if (m && m.inter.contacts.length) box.append(h('div', { cls: 'sec' }, h('h3', { text: 'Residues within 4.2 Å' }), h('p', { cls: 'sub', style: 'white-space:normal', text: m.inter.contacts.map(c => c.res + c.resi).join('  ') })));
  box.append(keyPanel());
  box.append(h('div', { cls: 'sec' }, h('h3', { text: 'Export' }), h('div', { cls: 'row' },
    h('button', { cls: 'btn sm', text: 'Table (CSV)', on: { click: exportCSV } }), h('button', { cls: 'btn sm', text: 'Pose (SDF)', on: { click: () => saveFile(l.name.replace(/\W+/g, '_') + '_pose' + m.rank + '.sdf', Chem.toSDF(poseMol(l, m), l.name + ' pose ' + m.rank)) } }),
    h('button', { cls: 'btn sm', text: 'Complex (PDB)', on: { click: () => saveFile(l.name.replace(/\W+/g, '_') + '_complex' + m.rank + '.pdb', complexPDB(l, m)) } }),
    h('button', { cls: 'btn sm', text: 'Pose image', on: { click: async () => { showPose(l, m); saveFile(l.name.replace(/\W+/g, '_') + '_pose' + m.rank + '.png', await dataUrlBlob(A.viewer.snapshot(1600, snapH(1600)))); } } })),
    h('p', { cls: 'note', text: 'Affinity is the Vina-style score of the pose, scaled for rotatable bonds, in kJ/mol (1 kcal = 4.184 kJ). It ranks poses well and ligands only roughly. Treat it as an estimate.' })));
  return box;
}
const poseMol = (l, m) => ({ atoms: l.dock.mol.atoms.map((a, i) => ({ ...a, x: m.pos[3*i], y: m.pos[3*i+1], z: m.pos[3*i+2] })), bonds: l.dock.mol.bonds });
function complexPDB(l, m) {
  let s = '', k = 1; const rec = A.rec;
  for (let i = 0; i < rec.n; i++) { const a = rec.meta[i], nm = a.name.length < 4 && a.el.length === 1 ? ' ' + a.name.padEnd(3) : a.name.padEnd(4).slice(0, 4);
    s += (a.het ? 'HETATM' : 'ATOM  ') + String(k++).padStart(5) + ' ' + nm + ' ' + a.res.padEnd(3) + ' ' + (a.chain || ' ') + String(a.resi).padStart(4) + '    ' + rec.X[3*i].toFixed(3).padStart(8) + rec.X[3*i+1].toFixed(3).padStart(8) + rec.X[3*i+2].toFixed(3).padStart(8) + '  1.00  0.00          ' + a.el.toUpperCase().padStart(2) + '\n'; }
  return s + 'TER\n' + Chem.toPDB(poseMol(l, m), 'LIG', 'L', 1).replace(/^HETATM(.{5})/gm, (q, n) => 'HETATM' + String(+n + k).padStart(5)).replace(/^CONECT.*\n/gm, '');
}
function exportCSV() {
  const rows = [['ligand', 'pose', 'affinity_kJ_per_mol', 'affinity_kcal_per_mol', 'rmsd_from_best_A', 'hbonds', 'hydrophobic_contacts', 'rmsd_to_reference_A']];
  for (const l of A.ligs) { const r = A.results[l.id]; if (!r) continue; r.modes.forEach(m => rows.push([l.name, m.rank, m.kJ.toFixed(2), m.kcal.toFixed(3), m.rmsd.toFixed(2), m.inter.hbonds.length, m.inter.hydrophobic, m.rmsdRef != null ? m.rmsdRef.toFixed(2) : ''])); }
  saveFile('docking_results.csv', rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n'));
}

/* ===================== boot ===================== */
$('#b-theme').onclick = () => { const r = document.documentElement, nx = dark() ? 'light' : 'dark'; r.dataset.theme = nx; try { localStorage.setItem('cp-theme', nx); } catch (e) {} syncBLTheme(); if (A.viewer) A.viewer.dark = dark(); refreshView(); };
try { const t = localStorage.getItem('cp-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
window.addEventListener('resize', () => { if (A.viewer) A.viewer.resize(); });
loadBondline(); refreshAll();
window.__bd = { A, Chem, Dock, loadExample, convert3D, minimiseLig, runDocking, addFromDrawing, poll, go };
})();

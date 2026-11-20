(function () {
'use strict';
const K = window.Kit;
const SPEC = [
  { k: 'peg_d', g: 'joint', l: 'Dowel diameter', min: 20, max: 40, step: 1, u: 'mm' },
  { k: 'peg_h', g: 'joint', l: 'Insertion depth', min: 10, max: 30, step: 1, u: 'mm' },
  { k: 'tol', g: 'joint', l: 'Fit clearance per side', min: 0.1, max: 0.8, step: 0.05, u: 'mm' },
  { k: 'wall', g: 'joint', l: 'Wall around sockets', min: 3, max: 10, step: 0.5, u: 'mm' },
  { k: 'dish_l', g: 'head', l: 'Dish length', min: 120, max: 220, step: 1, u: 'mm' },
  { k: 'dish_w', g: 'head', l: 'Dish width', min: 110, max: 190, step: 1, u: 'mm' },
  { k: 'dish_depth', g: 'head', l: 'Dish depth', min: 20, max: 60, step: 1, u: 'mm' },
  { k: 'dish_rim', g: 'head', l: 'Rim width', min: 4, max: 16, step: 1, u: 'mm' },
  { k: 'dish_floor', g: 'head', l: 'Floor under dish', min: 8, max: 24, step: 1, u: 'mm' },
  { k: 'neck_len', g: 'head', l: 'Neck notch length', min: 0, max: 70, step: 1, u: 'mm' },
  { k: 'neck_w', g: 'head', l: 'Neck notch width', min: 40, max: 120, step: 1, u: 'mm' },
  { k: 'neck_depth', g: 'head', l: 'Neck notch depth', min: 6, max: 30, step: 1, u: 'mm' },
  { k: 'tilt', g: 'head', l: 'Dish tilt', min: -20, max: 30, step: 1, u: '°' },
  { k: 'limb_d', g: 'saddle', l: 'Limb diameter', min: 30, max: 140, step: 1, u: 'mm' },
  { k: 'saddle_len', g: 'saddle', l: 'Saddle length', min: 60, max: 180, step: 1, u: 'mm' },
  { k: 'trough_frac', g: 'saddle', l: 'Trough depth (× diameter)', min: 0.3, max: 0.6, step: 0.05, u: '×' },
  { k: 'ns_w', g: 'neckg', l: 'Neck width, side to side', min: 80, max: 160, step: 1, u: 'mm' },
  { k: 'ns_ap', g: 'neckg', l: 'Neck depth, front to back', min: 70, max: 150, step: 1, u: 'mm' },
  { k: 'ns_len', g: 'neckg', l: 'Support length', min: 70, max: 160, step: 1, u: 'mm' },
  { k: 'ns_frac', g: 'neckg', l: 'Trough depth (× neck depth)', min: 0.3, max: 0.6, step: 0.05, u: '×' },
  { k: 'ns_relief', g: 'neckg', l: 'End relief', min: 0, max: 30, step: 1, u: 'mm' },
  { k: 'clearance', g: 'straps', l: 'Extra trough width', min: 0, max: 12, step: 1, u: 'mm' },
  { k: 'wing_t', g: 'straps', l: 'Wing thickness', min: 5, max: 20, step: 1, u: 'mm' },
  { k: 'strap_w', g: 'straps', l: 'Strap slot width', min: 15, max: 40, step: 1, u: 'mm' },
  { k: 'strap_t', g: 'straps', l: 'Strap slot thickness', min: 2, max: 6, step: 0.5, u: 'mm' },
  { k: 'drain_d', g: 'cradle', l: 'Drain hole diameter', min: 3, max: 10, step: 0.5, u: 'mm' },
  { k: 'drain_n', g: 'headdrain', l: 'Number of drain holes', min: 1, max: 12, step: 1, u: '' },
  { k: 'drain_r', g: 'headdrain', l: 'Drain circle radius', min: 20, max: 60, step: 1, u: 'mm' },
  { k: 'riser_h', g: 'riser', l: 'Riser height', min: 50, max: 200, step: 1, u: 'mm' },
  { k: 'wedge_tilt', g: 'wedgeg', l: 'Wedge top-face tilt', min: -20, max: 30, step: 1, u: '°' },
  { k: 'base_l', g: 'base', l: 'Base length', min: 120, max: 260, step: 1, u: 'mm' },
  { k: 'base_w', g: 'base', l: 'Base width', min: 100, max: 220, step: 1, u: 'mm' },
  { k: 'oh', g: 'print', l: 'Steepest overhang your printer holds', min: 30, max: 55, step: 1, u: '°' },
  { k: 'bridge', g: 'print', l: 'Longest bridge your printer holds', min: 4, max: 20, step: 1, u: 'mm' },
  { k: 'riser_n', g: 'asm', l: 'Number of risers', min: 0, max: 4, step: 1, u: '' }
];
const GROUP_LABEL = { joint: 'Joint · shared by every part', head: 'Dish and neck', cradle: 'Drainage · hole size', headdrain: 'Head cradle drain holes', saddle: 'Limb trough', neckg: 'Neck trough', straps: 'Clearance, wings and strap slots · limb saddle and neck support', riser: 'Height', wedgeg: 'Tilt', base: 'Footprint', asm: 'Stack', print: 'Printer limits · sockets and cradles are shaped to stay inside these' };
const TABS = {
  head:     { label: 'Head cradle', sw: '--c-head',   groups: ['head', 'headdrain', 'cradle', 'joint', 'print'], blurb: 'Tilted dish for the back of the skull with a notch for the neck. The underside overhangs, so this is the one part that needs supports. Tree supports use the least material.' },
  saddle:   { label: 'Limb saddle', sw: '--c-saddle', groups: ['saddle', 'straps', 'cradle', 'joint', 'print'], blurb: 'U-shaped trough for an arm, thigh or lower leg. Strap slots take velcro or cable ties. Prints upright with no supports.' },
  neck:     { label: 'Neck support', sw: '--c-neck',  groups: ['neckg', 'straps', 'cradle', 'joint', 'print'], blurb: 'Oval trough that carries the neck when the head and upper quarters are shown on their side. The ends drop away so it clears the skull and the shoulders. Strap slots hold it in place. Prints upright with no supports.' },
  riser:    { label: 'Riser',       sw: '--c-riser',  groups: ['riser', 'joint', 'print'], blurb: 'Column with a socket at each end and vertical finger grooves. Print one per height step and stack them.' },
  wedge:    { label: 'Tilt wedge',  sw: '--c-riser',  groups: ['riser', 'wedgeg', 'joint', 'print'], blurb: 'A riser whose top face leans over. It adds pitch to whatever sits on it, on top of the head cradle\'s own tilt. Positive tilt lowers the neck end.' },
  base:     { label: 'Base',        sw: '--c-base',   groups: ['base', 'joint'], blurb: 'Wide foot with a flat, flush underside, so it prints flat on the bed exactly as it sits on the bench. Slots take a tie-down strap or ballast.' },
  dowel:    { label: 'Dowel',       sw: '--c-dowel',  groups: ['joint'], blurb: 'Loose pin that joins any two sockets. Print one more than the number of risers, and one extra if you use a wedge.' },
  assembly: { label: 'Assembly',    sw: '--accent',   groups: ['asm', 'riser', 'wedgeg', 'joint', 'print'], blurb: 'Preview a full stack. Tick the wedge box to add a tilt wedge under the top part. The cutaway shows the dowels inside each joint.' }
};
const FILES = { head: 'head-cradle', saddle: 'limb-saddle', neck: 'neck-support', riser: 'riser', wedge: 'tilt-wedge', base: 'base', dowel: 'dowel' };
const PART_GROUPS = { head: ['head', 'headdrain', 'cradle', 'joint', 'print'], saddle: ['saddle', 'straps', 'cradle', 'joint', 'print'], neck: ['neckg', 'straps', 'cradle', 'joint', 'print'], riser: ['riser', 'joint', 'print'], wedge: ['riser', 'wedgeg', 'joint', 'print'], base: ['base', 'joint'], dowel: ['joint'] };
const $ = id => document.getElementById(id);

let P = Object.assign({}, K.DEFAULTS), tab = 'head', RES = 1, cutaway = false;
try {
  const s = JSON.parse(localStorage.getItem('pkg2.params') || 'null');
  if (s) for (const k in K.DEFAULTS) if (k in s && typeof s[k] === typeof K.DEFAULTS[k]) P[k] = s[k];
  const t = localStorage.getItem('pkg2.tab'); if (t && TABS[t]) tab = t;
} catch (e) {}
function persist() { try { localStorage.setItem('pkg2.params', JSON.stringify(P)); localStorage.setItem('pkg2.tab', tab); } catch (e) {} }
const lin = c => new THREE.Color(c).convertSRGBToLinear();
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (v, d) => v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/* ---------- build + cache ---------- */
const cache = new Map();
function partKey(name) {
  const gs = PART_GROUPS[name];
  return name + '|' + RES + '|' + SPEC.filter(s => gs.includes(s.g)).map(s => P[s.k]).join(',');
}
function getPart(name) {
  const key = partKey(name); let e = cache.get(key);
  if (e) { cache.delete(key); cache.set(key, e); return e; }
  const m = K.buildPart(name, P, RES, 1);   // one attempt for the live preview; export retries if the mesh has open edges
  e = { m, geom: null, repaired: false, an: K.analyzeOverhang(m, P.oh, P.bridge) };
  cache.set(key, e);
  while (cache.size > 14) { const f = cache.entries().next().value; cache.delete(f[0]); if (f[1].geom) f[1].geom.dispose(); }
  return e;
}
const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------- viewport ---------- */
const view = $('view');
let renderer = null, scene, camera, grid, bboxHelper, modelGroup, plane, needs = true;
const cam = { th: -0.85, ph: 1.12, dist: 320, tx: 0, ty: 0, tz: 30 };
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 1.75), 2.5));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.localClippingEnabled = true;
  view.insertBefore(renderer.domElement, view.firstChild);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 1, 4000);
  scene.add(camera);
  camera.add(new THREE.DirectionalLight(0xffffff, 0.8));
  camera.children[0].position.set(0.7, 0.9, 1);
  const fill = new THREE.DirectionalLight(0xffffff, 0.28); fill.position.set(-1, -0.4, 0.3); camera.add(fill);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7d78, 0.55));
  modelGroup = new THREE.Group(); scene.add(modelGroup);
  plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
} catch (e) {
  renderer = null;
  const n = document.createElement('div'); n.className = 'nogl'; n.textContent = 'The 3D preview needs WebGL, which is unavailable here. The generator and downloads still work.';
  view.appendChild(n);
}
function invalidate() { needs = true; }
function applyCam() {
  if (!renderer) return;
  const s = Math.sin(cam.ph);
  camera.up.set(0, 0, 1);
  camera.position.set(cam.tx + cam.dist * s * Math.cos(cam.th), cam.ty + cam.dist * s * Math.sin(cam.th), cam.tz + cam.dist * Math.cos(cam.ph));
  camera.lookAt(cam.tx, cam.ty, cam.tz);
  invalidate();
}
function resize() {
  if (!renderer) return;
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix(); invalidate();
}
function loop() { if (renderer && needs) { needs = false; renderer.render(scene, camera); } requestAnimationFrame(loop); }
function themeScene() {
  if (!renderer) return;
  renderer.setClearColor(new THREE.Color(css('--vp') || '#dfe5e1'), 1);
  if (grid) { scene.remove(grid); grid.geometry.dispose(); }
  grid = new THREE.GridHelper(600, 60, lin(css('--gridc')), lin(css('--grid')));
  grid.rotation.x = Math.PI / 2; scene.add(grid);
  recolor(); invalidate();
}
function recolor() {
  modelGroup && modelGroup.traverse(m => { if (m.userData.tok) m.material.color.copy(lin(css(m.userData.tok))); });
  if (bboxHelper) bboxHelper.material.color.copy(lin(css('--accent')));
  invalidate();
}
function geomOf(e) {
  if (e.geom) return e.geom;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(e.m.pos, 3));
  g.setIndex(new THREE.BufferAttribute(e.m.idx, 1));
  g.setAttribute('normal', new THREE.BufferAttribute(e.m.nrm, 3)); e.geom = g; return g;
}
function addMesh(e, tok, z, tiltDeg, pivotZ) {
  const mat = new THREE.MeshStandardMaterial({ color: lin(css(tok)), roughness: 0.5, metalness: 0.06, side: cutaway ? THREE.DoubleSide : THREE.FrontSide, clippingPlanes: cutaway ? [plane] : [] });
  const mesh = new THREE.Mesh(geomOf(e), mat); mesh.position.z = z || 0; mesh.userData.tok = tok;
  if (tiltDeg) {   // part sits on a tilted face: rotate about the joint point on the riser axis
    const g = new THREE.Group(); g.position.z = pivotZ; g.rotation.y = tiltDeg * Math.PI / 180; g.add(mesh); modelGroup.add(g);
  } else modelGroup.add(mesh);
  return mesh;
}
function clearModel() {
  modelGroup.traverse(o => { if (o.material) o.material.dispose(); });
  while (modelGroup.children.length) modelGroup.remove(modelGroup.children[0]);
  if (bboxHelper) { scene.remove(bboxHelper); bboxHelper.geometry.dispose(); bboxHelper = null; }
}
function frame() {
  if (!renderer) return;
  const b = new THREE.Box3().setFromObject(modelGroup); if (b.isEmpty()) return;
  const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  cam.tx = c.x; cam.ty = c.y; cam.tz = c.z; cam.dist = Math.max(s.x, s.y, s.z) * 2.1 + 40; applyCam();
}
(function orbit() {
  if (!renderer) return;
  const el = renderer.domElement, ptrs = new Map(); let lastPinch = 0;
  const pan = (dx, dy) => {
    const k = 2 * cam.dist * Math.tan(camera.fov * Math.PI / 360) / view.clientHeight;
    const f = new THREE.Vector3(); camera.getWorldDirection(f);
    const r = new THREE.Vector3().crossVectors(f, camera.up).normalize(), u = new THREE.Vector3().crossVectors(r, f).normalize();
    cam.tx += (-dx * r.x + dy * u.x) * k; cam.ty += (-dx * r.y + dy * u.y) * k; cam.tz += (-dx * r.z + dy * u.z) * k; applyCam();
  };
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey }); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); } });
  el.addEventListener('pointerup', e => ptrs.delete(e.pointerId));
  el.addEventListener('pointercancel', e => ptrs.delete(e.pointerId));
  el.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (ptrs.size === 1) {
      if (p.b !== 0 || e.shiftKey) pan(dx, dy);
      else { cam.th -= dx * 0.008; cam.ph = Math.min(Math.max(cam.ph - dy * 0.008, 0.08), Math.PI - 0.08); applyCam(); }
    } else if (ptrs.size === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinch) { cam.dist = Math.min(Math.max(cam.dist * lastPinch / d, 40), 2500); applyCam(); }
      lastPinch = d; pan(dx / 2, dy / 2); return;
    }
    p.x = e.clientX; p.y = e.clientY;
  });
  el.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.min(Math.max(cam.dist * Math.exp(e.deltaY * 0.0012), 40), 2500); applyCam(); }, { passive: false });
})();

/* ---------- UI ---------- */
function buildTabs() {
  const box = $('tabs'); box.innerHTML = '';
  Object.keys(TABS).forEach(id => {
    const b = document.createElement('button'); b.className = 'tab'; b.setAttribute('role', 'tab'); b.id = 'tab-' + id;
    b.setAttribute('aria-selected', id === tab ? 'true' : 'false');
    b.innerHTML = '<i></i>'; b.firstChild.style.setProperty('--sw', 'var(' + TABS[id].sw + ')');
    b.appendChild(document.createTextNode(TABS[id].label));
    b.addEventListener('click', () => { tab = id; persist(); buildTabs(); buildControls(); run(true); });
    box.appendChild(b);
  });
}
function buildControls() {
  const T = TABS[tab]; $('blurb').textContent = T.blurb;
  const sp = $('special'); sp.innerHTML = '';
  if (tab === 'assembly') {
    const seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Top part');
    [['head', 'Head cradle'], ['saddle', 'Limb saddle'], ['neck', 'Neck support']].forEach(([v, l]) => {
      const b = document.createElement('button'); b.textContent = l; b.setAttribute('aria-pressed', P.top === v ? 'true' : 'false');
      b.addEventListener('click', () => { P.top = v; persist(); buildControls(); run(false); }); seg.appendChild(b);
    });
    sp.appendChild(seg);
    const w = document.createElement('label'); w.className = 'check'; w.innerHTML = '<input type="checkbox" id="wedgeOn"> Add a tilt wedge under the top part';
    w.firstChild.checked = !!P.wedge_on; w.firstChild.addEventListener('change', e => { P.wedge_on = e.target.checked; persist(); run(false); }); sp.appendChild(w);
    const c = document.createElement('label'); c.className = 'check'; c.innerHTML = '<input type="checkbox" id="cut"> Cutaway (show dowels)';
    c.firstChild.checked = cutaway; c.firstChild.addEventListener('change', e => { cutaway = e.target.checked; run(false); }); sp.appendChild(c);
  }
  const box = $('controls'); box.innerHTML = '';
  T.groups.forEach(g => {
    const fs = document.createElement('fieldset'), lg = document.createElement('legend'); lg.textContent = GROUP_LABEL[g]; fs.appendChild(lg);
    SPEC.filter(s => s.g === g).forEach(s => {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = '<label for="n_' + s.k + '">' + s.l + '</label><span class="val"><input type="number" id="n_' + s.k + '" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '"><em>' + s.u + '</em></span><input type="range" id="r_' + s.k + '" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '" aria-label="' + s.l + '">';
      const n = row.querySelector('input[type=number]'), r = row.querySelector('input[type=range]');
      n.value = r.value = P[s.k];
      const set = v => { if (isNaN(v)) return; v = Math.min(Math.max(v, s.min), s.max); P[s.k] = v; n.value = r.value = v; persist(); run(false); };
      r.addEventListener('input', () => set(parseFloat(r.value)));
      n.addEventListener('change', () => set(parseFloat(n.value)));
      fs.appendChild(row);
    });
    box.appendChild(fs);
  });
  $('dlPart').hidden = tab === 'assembly' || !canDownload;
}
function stat(l, v) { return '<div class="stat"><dt>' + l + '</dt><dd>' + v + '</dd></div>'; }

/* ---------- run ---------- */
let token = 0, timer = 0, firstFrame = true, lastTab = null, lastFitZ = 1;
function warnings(o, got) {
  const w = [], t = TABS[tab].groups, asm = tab === 'assembly', useW = P.wedge_on && P.wedge_tilt !== 0;
  if (P.tol < 0.2) w.push('Clearance under 0.2 mm is tight. Test one dowel and socket before printing the set.');
  if (P.tol > 0.6) w.push('Clearance over 0.6 mm will leave the joints loose.');
  if (((tab === 'riser') || asm) && P.riser_h < o.riser_min_h) w.push('Riser is shorter than its two sockets need (' + fmt(o.riser_min_h, 0) + ' mm). The sockets will meet.');
  if (((tab === 'wedge') || (asm && useW)) && P.riser_h < o.wedge_min_h) w.push('Wedge is too short for a ' + P.wedge_tilt + '° tilt (needs ' + fmt(o.wedge_min_h, 0) + ' mm). The tilted socket will break through the side.');
  if (tab === 'saddle' || (asm && P.top === 'saddle')) {
    if (o.saddle_w > P.base_w) w.push('Saddle is wider (' + fmt(o.saddle_w, 0) + ' mm) than the base (' + fmt(P.base_w, 0) + ' mm). The stack may tip.');
  }
  if (tab === 'neck' || (asm && P.top === 'neck')) {
    if (o.ns_total_w > P.base_w) w.push('Neck support is wider (' + fmt(o.ns_total_w, 0) + ' mm) than the base (' + fmt(P.base_w, 0) + ' mm). Widen the base or the stack may tip.');
    if (P.ns_frac > 0.55) w.push('A trough this deep starts to curl in at the rim. Check the supports readout before printing.');
  }
  if (tab === 'head' || (asm && P.top === 'head')) {
    if (P.neck_w > P.dish_w - 2 * P.dish_rim) w.push('Neck notch is as wide as the dish and cuts through the rim.');
    if (P.drain_r < o.drain_min - 0.5) w.push('Drain circle moved out to ' + fmt(o.drain_ring, 0) + ' mm so the holes clear the socket and run down the side of the pedestal.');
    else if (P.drain_r > o.drain_lim + 0.5 && o.drain_ring > o.drain_lim + 0.5) w.push('The dish is too small for that drain circle. Holes sit close to the rim.');
    else if (P.drain_r > o.drain_lim + 0.5) w.push('Drain circle pulled in to ' + fmt(o.drain_ring, 0) + ' mm to stay inside the dish.');
    if (P.drain_n > 1 && 2 * o.drain_ring * Math.sin(Math.PI / P.drain_n) < P.drain_d + 3) w.push('Drain holes are too close together. Use fewer holes, smaller holes or a larger circle.');
  }
  Object.keys(got).forEach(n => {
    const e = got[n];
    if (e.an.flagged > 0) w.push(n === 'head' ? 'Head cradle: the underside overhangs (about ' + fmt(e.an.flaggedArea, 0) + ' mm²), so turn supports on for this part. Everything else prints without supports.' : TABS[n].label + ': ' + e.an.flagged + ' overhang region' + (e.an.flagged > 1 ? 's' : '') + ' steeper than ' + P.oh + '° (about ' + fmt(e.an.flaggedArea, 0) + ' mm²). Raise the overhang limit or turn supports on for this part.');
  });
  return w;
}
function run(refit) {
  clearTimeout(timer); const b = $('busy'); b.hidden = false; b.textContent = 'Building…';
  timer = setTimeout(() => runNow(refit), 120);
}
const supportStat = list => {
  const n = list.reduce((a, e) => a + e.an.flagged, 0), ar = list.reduce((a, e) => a + e.an.flaggedArea, 0);
  return stat('Supports needed', n === 0 ? 'None' : (list.length === 1 ? 'Yes' : 'Head cradle only') + ' · ' + fmt(ar, 0) + ' mm²');
};
async function runNow(refit) {
  const my = ++token, t0 = performance.now(), o = K.derive(P), useW = P.wedge_on && P.wedge_tilt !== 0;
  const names = tab === 'assembly' ? ['base', 'dowel'].concat(P.riser_n > 0 ? ['riser'] : [], useW ? ['wedge'] : [], [P.top]) : [tab];
  const got = {};
  for (const n of names) { await tick(); if (my !== token) return; got[n] = getPart(n); }
  if (my !== token) return;
  const ms = performance.now() - t0;
  let stats = '';
  if (renderer) clearModel();
  if (tab !== 'assembly') {
    const e = got[tab], s = e.m.stats;
    stats = supportStat([e]) + stat('Size', fmt(s.size[0], 1) + ' × ' + fmt(s.size[1], 1) + ' × ' + fmt(s.size[2], 1) + ' mm') + stat('Solid volume', fmt(s.volume / 1000, 1) + ' cm³') + stat('Mesh', e.m.open === 0 ? 'Watertight' : 'Repaired on export') + stat('Built in', fmt(ms / 1000, 1) + ' s');
    if (renderer) addMesh(e, TABS[tab].sw);
  } else {
    const n = P.riser_n, T = o.base_t, H = P.riser_h, th = useW ? P.wedge_tilt : 0, rt = th * Math.PI / 180;
    const pivot = T + n * H + (useW ? H : 0), baseTop = T + n * H;
    let vol = got.base.m.stats.volume + got[P.top].m.stats.volume + got.dowel.m.stats.volume * (n + 1 + (useW ? 1 : 0));
    if (n > 0) vol += got.riser.m.stats.volume * n;
    if (useW) vol += got.wedge.m.stats.volume;
    if (renderer) {
      addMesh(got.base, TABS.base.sw, 0);
      for (let j = 0; j <= n; j++) addMesh(got.dowel, TABS.dowel.sw, T + j * H - P.peg_h);
      for (let i = 0; i < n; i++) addMesh(got.riser, TABS.riser.sw, T + i * H);
      if (useW) {
        addMesh(got.wedge, TABS.wedge.sw, baseTop);
        addMesh(got.dowel, TABS.dowel.sw, -P.peg_h, th, pivot);
        addMesh(got[P.top], TABS[P.top].sw, 0, th, pivot);
      } else addMesh(got[P.top], TABS[P.top].sw, baseTop);
    }
    const top = got[P.top].m.stats, height = useW ? pivot + top.max[2] * Math.cos(rt) + top.size[0] / 2 * Math.abs(Math.sin(rt)) : baseTop + top.max[2];
    const dowels = n + 1 + (useW ? 1 : 0);
    stats = supportStat(Object.values(got)) + stat('Stack height', fmt(height, 0) + ' mm') + stat('Dowels · risers · wedges', dowels + ' · ' + n + ' · ' + (useW ? 1 : 0)) + stat('Solid volume', fmt(vol / 1000, 0) + ' cm³') + stat('Built in', fmt(ms / 1000, 1) + ' s');
  }
  $('stats').innerHTML = stats;
  $('warns').innerHTML = warnings(o, got).map(w => '<li>' + w + '</li>').join('');
  $('busy').hidden = true;
  if (renderer) {
    const b = new THREE.Box3().setFromObject(modelGroup);
    bboxHelper = new THREE.Box3Helper(b, lin(css('--accent'))); scene.add(bboxHelper);
    const hz = b.getSize(new THREE.Vector3()).z;   // re-frame when a stack grows or shrinks a lot
    if (refit || firstFrame || lastTab !== tab || (tab === 'assembly' && Math.abs(hz - lastFitZ) > 0.12 * lastFitZ)) { frame(); lastFitZ = hz; }
    invalidate();
  }
  firstFrame = false; lastTab = tab;
}

/* ---------- downloads ---------- */
let downloads = null, canDownload = true;
const toast = t => { $('toast').textContent = t; };
async function saveZip(name, files) {
  const zip = K.makeZip(files);
  try { await downloads.save({ filename: name, data: new Blob([zip]) }); toast('Saved ' + name); }
  catch (e) { toast(e && e.code === 'declined' ? 'Download cancelled.' : 'Download failed' + (e && e.code ? ' (' + e.code + ')' : '') + '.'); }
}
function paramsFile(parts) {
  const out = { units: 'mm', resolution_mm: RES, print_note: 'Print every part upright as modelled (flat face on the bed). Only the head cradle needs supports; everything else is within the overhang and bridge limits in params.', parts, params: Object.assign({}, P) };
  return { name: 'parameters.json', data: new TextEncoder().encode(JSON.stringify(out, null, 2)) };
}
async function exportParts(names, zipName) {
  const btns = [$('dlPart'), $('dlKit')]; btns.forEach(b => b.disabled = true);
  const files = [], openLeft = [];
  for (let i = 0; i < names.length; i++) {
    toast('Exporting ' + (i + 1) + ' of ' + names.length + '…'); await tick();
    const e = getPart(names[i]);
    if (e.m.open > 0 && !e.repaired) {   // retry on shifted sampling grids until the mesh is watertight
      toast('Checking mesh ' + (i + 1) + ' of ' + names.length + '…'); await tick();
      const m2 = K.buildPart(names[i], P, RES, 4, 1);
      if (m2.open < e.m.open) { e.m = m2; e.an = K.analyzeOverhang(m2, P.oh, P.bridge); if (e.geom) { e.geom.dispose(); e.geom = null; } }
      e.repaired = true;
    }
    if (e.m.open > 0) openLeft.push(FILES[names[i]]);
    files.push({ name: FILES[names[i]] + '.stl', data: K.toSTL(e.m, FILES[names[i]]) });
  }
  files.push(paramsFile(names));
  await saveZip(zipName, files);
  if (openLeft.length) toast('Saved. ' + openLeft.join(', ') + ' still has a tiny open edge; slicers repair this automatically.');
  btns.forEach(b => b.disabled = false);
}
$('dlPart').addEventListener('click', () => { if (tab !== 'assembly') exportParts([tab], 'positioning-kit-' + FILES[tab] + '.zip'); });
$('dlKit').addEventListener('click', () => exportParts(['base', 'riser', 'wedge', 'dowel', 'saddle', 'neck', 'head'], 'positioning-kit-all-parts.zip'));
$('reset').addEventListener('click', () => { P = Object.assign({}, K.DEFAULTS); persist(); buildControls(); run(true); });
$('res').addEventListener('change', e => { RES = parseFloat(e.target.value); run(false); });

/* ---------- start ---------- */
buildTabs(); buildControls();
if (renderer) {
  new ResizeObserver(resize).observe(view); resize(); themeScene(); applyCam(); loop();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(themeScene, 30));
  new MutationObserver(() => setTimeout(themeScene, 30)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
run(true);
(async function () {
  try { downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { downloads = null; }
  if (!downloads) { canDownload = false; $('dlPart').hidden = true; $('dlKit').hidden = true; toast('Downloads are not available in this view. Open the page in claude.ai to save files.'); }
})();
})();

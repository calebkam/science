/* ============================ app.js ============================
   Layerline Slicer UI: plate viewer, model placement, settings, slicing (worker), layer preview, G-code export. */
(function () {
'use strict';
var E = window.Slicer, T = window.THREE;
var $ = function (s, r) { return (r || document).querySelector(s); };
var PR = window.SlicerPrinters, PRS = PR.PRINTERS, printer = PRS.h2s, BED = printer.bed, BH = printer.height;
var KEY = 'layerline.settings.v1';

/* ---------------------------------------------------------------- settings */
var FIELDS = [
  { t: 'Quality', f: [['layerHeight', 'Layer height', 'mm', 0.04, 0.04, 0.4], ['firstLayerHeight', 'First layer height', 'mm', 0.04, 0.08, 0.4], ['lineWidth', 'Line width', 'mm', 0.02, 0.3, 0.8]] },
  { t: 'Strength', open: true, f: [['walls', 'Wall loops', '', 1, 0, 12], ['topLayers', 'Top shell layers', '', 1, 0, 30], ['bottomLayers', 'Bottom shell layers', '', 1, 0, 30], ['infillDensity', 'Sparse infill density', '%', 1, 0, 100],
    ['infillPattern', 'Sparse infill pattern', '', [['grid', 'Grid'], ['lines', 'Lines'], ['gyroid', 'Gyroid']]], ['wallOrder', 'Wall order', '', [['inner-outer', 'Inner first'], ['outer-inner', 'Outer first']]]] },
  { t: 'Speed', f: [['speedFirst', 'First layer', 'mm/s', 5, 5, 500], ['speedOuter', 'Outer wall', 'mm/s', 5, 5, 500], ['speedInner', 'Inner wall', 'mm/s', 5, 5, 500], ['speedSparse', 'Sparse infill', 'mm/s', 5, 5, 500], ['speedSolid', 'Solid infill', 'mm/s', 5, 5, 500], ['speedTop', 'Top surface', 'mm/s', 5, 5, 500], ['speedTravel', 'Travel', 'mm/s', 10, 20, 1000], ['accel', 'Acceleration', 'mm/s²', 500, 500, 20000], ['accelFirst', 'First layer accel.', 'mm/s²', 500, 500, 20000], ['maxVolumetric', 'Max volumetric speed', 'mm³/s', 1, 1, 60]] },
  { t: 'Support', open: true, f: [['supportMode', 'Support', '', [['organic', 'Organic (auto)'], ['off', 'Off']]], ['supportOnPlate', 'Rest on', '', [['everywhere', 'Everywhere'], ['plate', 'Build plate only']]], ['supportAngle', 'Threshold angle', '°', 1, 5, 85], ['tipSpacing', 'Branch tip spacing', 'mm', 0.2, 0.8, 8], ['tipDiameter', 'Tip diameter', 'mm', 0.1, 0.8, 4], ['trunkDiameter', 'Max trunk diameter', 'mm', 0.5, 2, 20], ['branchAngle', 'Branch angle', '°', 1, 10, 60], ['xyGap', 'Distance to model (XY)', 'mm', 0.05, 0.1, 2], ['zGap', 'Top Z gap', 'mm', 0.05, 0.1, 1], ['speedSupport', 'Support speed', 'mm/s', 5, 10, 300]] },
  { t: 'Bed adhesion', f: [['skirtLoops', 'Skirt loops', '', 1, 0, 10], ['skirtDistance', 'Skirt distance', 'mm', 0.5, 0, 30], ['brimWidth', 'Brim width', 'mm', 0.5, 0, 30], ['elephantFoot', 'Elephant foot compensation', 'mm', 0.05, 0, 1], ['bedType', 'Build plate', '', [['Textured PEI Plate', 'Textured PEI'], ['Smooth PEI Plate', 'Smooth PEI'], ['Cool Plate', 'Cool plate'], ['Engineering Plate', 'Engineering plate']]]] },
  { t: 'Temperature and cooling', f: [['nozzleTemp', 'Nozzle', '°C', 5, 150, 350], ['bedTemp', 'Bed', '°C', 5, 0, 120], ['firstNozzleTemp', 'First layer nozzle', '°C', 5, 150, 350], ['firstBedTemp', 'First layer bed', '°C', 5, 0, 120], ['fan', 'Part cooling fan', '%', 5, 0, 100], ['fanFirstOffLayers', 'Fan off for first layers', '', 1, 0, 20], ['minLayerTime', 'Slow down below layer time', 's', 1, 0, 60]] },
  { t: 'Retraction', f: [['retractLength', 'Length', 'mm', 0.1, 0, 5], ['retractSpeed', 'Speed', 'mm/s', 5, 5, 100], ['zHop', 'Z hop', 'mm', 0.1, 0, 2], ['retractMinTravel', 'Minimum travel', 'mm', 0.5, 0, 20]] },
  { t: 'Filament', f: [['flow', 'Flow ratio', '', 0.01, 0.7, 1.2], ['filamentDiameter', 'Diameter', 'mm', 0.05, 1.7, 3], ['filamentDensity', 'Density', 'g/cm³', 0.01, 0.8, 2.5]] },
  { t: 'Machine G-code', f: [['gcodeStart', 'Start G-code (this printer)', '', 'gcode'], ['gcodeEnd', 'End G-code (this printer)', '', 'gcode']] }
];
var PROCESS = { '0.08': 'Extra fine 0.08 mm', '0.12': 'Fine 0.12 mm', '0.16': 'Optimal 0.16 mm', '0.20': 'Standard 0.20 mm', '0.24': 'Draft 0.24 mm', '0.28': 'Extra draft 0.28 mm' };
var FILAMENT = {
  PLA: { nozzleTemp: 220, firstNozzleTemp: 220, bedTemp: 55, firstBedTemp: 55, fan: 100, filamentDensity: 1.24, maxVolumetric: 21 },
  PETG: { nozzleTemp: 250, firstNozzleTemp: 250, bedTemp: 70, firstBedTemp: 70, fan: 50, filamentDensity: 1.27, maxVolumetric: 12 },
  ABS: { nozzleTemp: 260, firstNozzleTemp: 260, bedTemp: 95, firstBedTemp: 95, fan: 20, filamentDensity: 1.04, maxVolumetric: 16 },
  ASA: { nozzleTemp: 260, firstNozzleTemp: 260, bedTemp: 95, firstBedTemp: 95, fan: 20, filamentDensity: 1.07, maxVolumetric: 16 },
  'TPU 95A': { nozzleTemp: 230, firstNozzleTemp: 230, bedTemp: 35, firstBedTemp: 35, fan: 100, filamentDensity: 1.21, maxVolumetric: 3.6 }
};
var S = Object.assign({}, E.DEFAULTS);
try { var saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) Object.keys(saved).forEach(function (k) { if (k in S) S[k] = saved[k]; }); } catch (e) {}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
printer = PRS[S.printer] || PRS.h2s; S.printer = printer.id; BED = printer.bed; BH = printer.height;
var VERSION = (window.CP_VERSIONS || {}).slicer || '';
S._version = VERSION;

var inputs = {};
function buildSettings() {
  var host = $('#settings'); host.innerHTML = ''; inputs = {};
  FIELDS.forEach(function (g) {
    var d = document.createElement('details'); if (g.open) d.open = true; d.innerHTML = '<summary></summary>'; d.firstChild.textContent = g.t;
    g.f.forEach(function (f) {
      var key = f[0], row = document.createElement('div'), lab = document.createElement('label'), el;
      row.className = 'f'; lab.textContent = f[1]; if (f[2]) { var u = document.createElement('span'); u.className = 'u'; u.textContent = f[2]; lab.append(u); }
      if (f[3] === 'gcode') { row.className = 'f wide'; el = document.createElement('textarea'); el.spellcheck = false; el.wrap = 'off'; el.style.minHeight = '180px'; el.value = gcodeText(key); el.addEventListener('input', function () { var def = key === 'gcodeStart' ? printer.startGcode : printer.endGcode; if (el.value === def) delete S[key][printer.id]; else S[key][printer.id] = el.value; changed(); }); row.append(lab, el); }
      else if (f[3] === 'text') { row.className = 'f wide'; el = document.createElement('textarea'); el.spellcheck = false; el.value = S[key]; el.addEventListener('input', function () { S[key] = el.value; changed(); }); row.append(lab, el); }
      else if (Array.isArray(f[3])) { el = document.createElement('select'); f[3].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; el.append(op); }); el.value = S[key]; el.addEventListener('change', function () { S[key] = el.value; changed(); }); row.append(lab, el); }
      else { el = document.createElement('input'); el.type = 'number'; el.step = f[3]; el.min = f[4]; el.max = f[5]; el.value = S[key]; el.addEventListener('change', function () { var v = parseFloat(el.value); if (isNaN(v)) v = E.DEFAULTS[key]; v = Math.min(f[5], Math.max(f[4], v)); S[key] = v; el.value = v; changed(); }); row.append(lab, el); }
      inputs[key] = el; d.append(row);
    });
    host.append(d);
  });
}
function gcodeText(key) { var c = S[key] && S[key][printer.id]; return c != null ? c : (key === 'gcodeStart' ? printer.startGcode : printer.endGcode); }
function syncInputs() { Object.keys(inputs).forEach(function (k) { inputs[k].value = (k === 'gcodeStart' || k === 'gcodeEnd') ? gcodeText(k) : S[k]; }); }
function buildProfiles() {
  var p = $('#p-process'), f = $('#p-fil');
  Object.keys(PROCESS).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = PROCESS[k]; p.append(o); });
  var c = document.createElement('option'); c.value = 'custom'; c.textContent = 'Custom'; p.append(c);
  Object.keys(FILAMENT).forEach(function (k) { FILAMENT[k].filamentType = k.split(' ')[0]; var o = document.createElement('option'); o.value = k; o.textContent = k; f.append(o); });
  var c2 = document.createElement('option'); c2.value = 'custom'; c2.textContent = 'Custom'; f.append(c2);
  var key = S.layerHeight.toFixed(2); p.value = PROCESS[key] ? key : 'custom'; f.value = 'custom';
  for (var n in FILAMENT) { var m = FILAMENT[n], ok = true; for (var kk in m) if (S[kk] !== m[kk]) ok = false; if (ok) f.value = n; }
  p.addEventListener('change', function () { if (p.value !== 'custom') { S.layerHeight = parseFloat(p.value); syncInputs(); changed(true); } });
  f.addEventListener('change', function () { if (f.value !== 'custom') { Object.assign(S, FILAMENT[f.value]); syncInputs(); changed(true); } });
}
function changed(fromProfile) {
  persist(); stale();
  if (!fromProfile) { var key = S.layerHeight.toFixed(2); $('#p-process').value = PROCESS[key] ? key : 'custom'; }
}
$('#reset').addEventListener('click', function () { S = Object.assign({}, E.DEFAULTS); S._version = VERSION; persist(); buildSettings(); $('#p-process').value = '0.20'; $('#p-fil').value = 'PLA'; stale(); });

/* ---------------------------------------------------------------- viewer */
var stage = $('#stage'), renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); stage.append(renderer.domElement);
var scene = new T.Scene(), camera = new T.PerspectiveCamera(35, 1, 5, 6000); camera.up.set(0, 0, 1);
var cam = { az: -Math.PI / 2, el: 0.85, dist: Math.max(BED[0], BED[1]) * 1.9, target: new T.Vector3(BED[0] / 2, BED[1] / 2, 30) };
scene.add(new T.AmbientLight(0xffffff, 0.65)); var dl = new T.DirectionalLight(0xffffff, 0.8); dl.position.set(200, -300, 500); scene.add(dl);
var dl2 = new T.DirectionalLight(0xffffff, 0.25); dl2.position.set(-300, 200, 200); scene.add(dl2);
var dirty = true;
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
var bedGroup = new T.Group(); scene.add(bedGroup);
function buildBed() {
  while (bedGroup.children.length) { var c = bedGroup.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
  var dark = document.documentElement.dataset.theme !== 'light';
  scene.background = new T.Color(css('--stage') || '#151413');
  var plate = new T.Mesh(new T.PlaneGeometry(BED[0], BED[1]), new T.MeshBasicMaterial({ color: dark ? 0x23211f : 0xd6d1c4 })); plate.position.set(BED[0] / 2, BED[1] / 2, -0.05); bedGroup.add(plate);
  var pts = [], i;
  for (i = 0; i <= BED[0]; i += 10) pts.push(i, 0, 0, i, BED[1], 0);
  for (i = 0; i <= BED[1]; i += 10) pts.push(0, i, 0, BED[0], i, 0);
  var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pts, 3)); bedGroup.add(new T.LineSegments(g, new T.LineBasicMaterial({ color: dark ? 0x35322f : 0xc3bdae })));
  var o = new T.BufferGeometry(); o.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, BED[0], 0, 0, BED[0], BED[1], 0, 0, BED[1], 0, 0, 0, 0], 3)); bedGroup.add(new T.Line(o, new T.LineBasicMaterial({ color: new T.Color(css('--accent') || '#D97757') })));
  var v = []; [[0, 0], [BED[0], 0], [BED[0], BED[1]], [0, BED[1]]].forEach(function (p) { v.push(p[0], p[1], 0, p[0], p[1], BH); });
  v.push(0, 0, BH, BED[0], 0, BH, BED[0], 0, BH, BED[0], BED[1], BH, BED[0], BED[1], BH, 0, BED[1], BH, 0, BED[1], BH, 0, 0, BH);
  var vg = new T.BufferGeometry(); vg.setAttribute('position', new T.Float32BufferAttribute(v, 3)); bedGroup.add(new T.LineSegments(vg, new T.LineBasicMaterial({ color: dark ? 0x4a4642 : 0xb5ae9d, transparent: true, opacity: 0.6 })));
  (printer.exclude || []).forEach(function (r) { var ex = new T.Mesh(new T.PlaneGeometry(r[2] - r[0], r[3] - r[1]), new T.MeshBasicMaterial({ color: 0xd9534f, transparent: true, opacity: 0.35 })); ex.position.set((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, 0.05); bedGroup.add(ex); });
  /* front-left origin marker */
  var ax = new T.BufferGeometry(); ax.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0.1, 30, 0, 0.1, 0, 0, 0.1, 0, 30, 0.1], 3)); ax.setAttribute('color', new T.Float32BufferAttribute([1, .3, .3, 1, .3, .3, .4, .8, .4, .4, .8, .4], 3));
  bedGroup.add(new T.LineSegments(ax, new T.LineBasicMaterial({ vertexColors: true })));
  dirty = true;
}
function placeCam() {
  var c = cam, ce = Math.cos(c.el);
  camera.position.set(c.target.x + c.dist * ce * Math.cos(c.az), c.target.y + c.dist * ce * Math.sin(c.az), c.target.z + c.dist * Math.sin(c.el));
  camera.lookAt(c.target); camera.updateMatrixWorld(); dirty = true;
}
function resize() { var w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; }
new ResizeObserver(resize).observe(stage);
(function loop() { if (dirty) { dirty = false; renderer.render(scene, camera); } requestAnimationFrame(loop); })();
function resetView() { cam.az = -Math.PI / 2; cam.el = 0.85; cam.dist = Math.max(BED[0], BED[1]) * 1.9; cam.target.set(BED[0] / 2, BED[1] / 2, 30); placeCam(); }
$('#resetView').addEventListener('click', resetView);

/* ---------------------------------------------------------------- objects */
var objs = [], sel = null, nextId = 1, raycaster = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 0, 1), 0);
var objGroup = new T.Group(); scene.add(objGroup);
function makeObj(name, base) {
  var o = { id: nextId++, name: name, base: base, t: { x: printer.origin[0], y: printer.origin[1], rx: 0, ry: 0, rz: 0, scale: 1 }, mesh: null, dims: [0, 0, 0], area: 0 };
  objs.push(o); rebuild(o); sel = o; refreshUI(); stale(); return o;
}
function rebuild(o) { /* geometry at the origin; position comes from the mesh */
  var tris = E.placeTris(o.base, { x: 0, y: 0, rx: o.t.rx, ry: o.t.ry, rz: o.t.rz, scale: o.t.scale }), b = E.bounds(tris);
  o.dims = [b[3] - b[0], b[4] - b[1], b[5] - b[2]]; o.half = [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2];
  var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(tris, 3)); g.computeVertexNormals(); g.computeBoundingSphere();
  if (o.mesh) { o.mesh.geometry.dispose(); o.mesh.geometry = g; } else { o.mesh = new T.Mesh(g, new T.MeshLambertMaterial({ color: 0xc9c3b8 })); o.mesh.userData.obj = o; objGroup.add(o.mesh); }
  o.mesh.position.set(o.t.x, o.t.y, 0); tint(o); dirty = true;
}
function hitsExclusion(o) { return (printer.exclude || []).some(function (r) { return o.t.x + o.half[0] > r[0] && o.t.x - o.half[0] < r[2] && o.t.y + o.half[1] > r[1] && o.t.y - o.half[1] < r[3]; }); }
function outside(o) { return hitsExclusion(o) || o.t.x - o.half[0] < -0.01 || o.t.x + o.half[0] > BED[0] + 0.01 || o.t.y - o.half[1] < -0.01 || o.t.y + o.half[1] > BED[1] + 0.01 || o.dims[2] > BH; }
function tint(o) { var bad = outside(o); o.mesh.material.color.set(bad ? 0xd9534f : (o === sel ? 0xe9a07f : 0xc9c3b8)); o.mesh.material.emissive.set(o === sel && !bad ? 0x3a1d10 : 0x000000); dirty = true; }
function removeObj(o) { objs = objs.filter(function (x) { return x !== o; }); objGroup.remove(o.mesh); o.mesh.geometry.dispose(); o.mesh.material.dispose(); if (sel === o) sel = objs[objs.length - 1] || null; refreshUI(); stale(); }
function refreshUI() {
  var host = $('#objs'); host.innerHTML = '';
  objs.forEach(function (o) { var d = document.createElement('div'); d.className = 'obj'; if (o === sel) d.setAttribute('aria-current', 'true'); d.innerHTML = '<span></span><small></small>'; d.firstChild.textContent = o.name; d.lastChild.textContent = o.dims.map(function (v) { return v.toFixed(0); }).join('×'); d.addEventListener('click', function () { sel = o; refreshUI(); }); host.append(d); });
  objs.forEach(tint);
  $('#drop').hidden = objs.length > 0; $('#xform').hidden = !sel; $('#slice').disabled = !objs.length;
  if (sel) {
    $('#t-x').value = sel.t.x.toFixed(1); $('#t-y').value = sel.t.y.toFixed(1); $('#t-s').value = Math.round(sel.t.scale * 100);
    $('#dims').innerHTML = '<span>Size</span><span>' + sel.dims.map(function (v) { return v.toFixed(1); }).join(' × ') + ' mm</span>';
  }
  var bad = objs.some(outside), m = $('#msg'); m.hidden = !bad; m.className = 'msg warn'; m.textContent = bad ? 'A model is outside the ' + printer.short + ' build area (' + BED[0] + ' × ' + BED[1] + ' × ' + BH + ' mm' + ((printer.exclude || []).length ? ', excluding the shaded corner' : '') + ').' : '';
  dirty = true;
}
function nudge() { if (!sel) return; rebuild(sel); refreshUI(); stale(); }
$('#t-x').addEventListener('change', function () { if (sel) { sel.t.x = parseFloat(this.value) || 0; sel.mesh.position.x = sel.t.x; refreshUI(); stale(); } });
$('#t-y').addEventListener('change', function () { if (sel) { sel.t.y = parseFloat(this.value) || 0; sel.mesh.position.y = sel.t.y; refreshUI(); stale(); } });
$('#t-s').addEventListener('change', function () { if (sel) { sel.t.scale = Math.max(0.01, (parseFloat(this.value) || 100) / 100); nudge(); } });
document.querySelectorAll('[data-rot]').forEach(function (b) { b.addEventListener('click', function () { if (!sel) return; var a = b.dataset.rot[0], s = b.dataset.rot[1] === '+' ? 90 : -90; sel.t['r' + a] = ((sel.t['r' + a] || 0) + s) % 360; nudge(); }); });
$('#flat').addEventListener('click', function () { if (!sel) return; var cur = E.placeTris(sel.base, { rx: 0, ry: 0, rz: 0 }), r = E.layFlat(cur); sel.t.rx = r.rx; sel.t.ry = r.ry; sel.t.rz = 0; nudge(); });
$('#dup').addEventListener('click', function () { if (!sel) return; var o = makeObj(sel.name, sel.base); Object.assign(o.t, sel.t); o.t.x += 15; o.t.y += 15; rebuild(o); refreshUI(); });
$('#del').addEventListener('click', function () { if (sel) removeObj(sel); });
function arrange(subset) {
  var gap = 6, list = (subset || objs).slice().sort(function (a, b) { return b.dims[1] - a.dims[1]; }), x = gap, y = gap, rowH = 0;
  list.forEach(function (o) {
    var w = o.dims[0], h = o.dims[1]; if (x + w + gap > BED[0]) { x = gap; y += rowH + gap; rowH = 0; }
    o.t.x = x + w / 2; o.t.y = y + h / 2; o.mesh.position.set(o.t.x, o.t.y, 0); x += w + gap; rowH = Math.max(rowH, h);
  });
  refreshUI(); stale();
}
$('#arrange').addEventListener('click', function () { arrange(); });

/* loading */
function loadFile(f) {
  var rd = new FileReader(), name = f.name.replace(/\.[^.]+$/, '');
  if (/\.3mf$/i.test(f.name)) {
    rd.onload = function () {
      window.ThreeMF.parse(rd.result).then(function (parts) {
        var made = parts.map(function (pt) { var o = makeObj(parts.length > 1 ? pt.name : (pt.name === 'Object 1' || /^Object \d+$/.test(pt.name) ? name : pt.name), pt.tris); o.t.x = pt.cx; o.t.y = pt.cy; rebuild(o); return o; });
        if (made.some(outside) || made.some(function (a, i) { return made.some(function (b, j) { return j > i && Math.abs(a.t.x - b.t.x) < (a.half[0] + b.half[0]) && Math.abs(a.t.y - b.t.y) < (a.half[1] + b.half[1]); }); })) arrange(made);
        refreshUI(); note(parts.length + (parts.length === 1 ? ' object' : ' objects') + ' loaded from the 3MF. Only the shapes are used; the file\'s own print settings are ignored.');
      }).catch(function (e) { note(e.message || 'Could not read that 3MF file.', true); });
    };
    rd.readAsArrayBuffer(f); return;
  }
  rd.onload = function () {
    try {
      var tris = /\.obj$/i.test(f.name) ? E.parseOBJ(new TextDecoder().decode(rd.result)) : E.parseSTL(rd.result);
      var o = makeObj(name, tris); var b = E.bounds(tris);
      if (b[3] - b[0] < 0.5 && b[4] - b[1] < 0.5 && b[5] - b[2] < 0.5) { o.t.scale = 1000; rebuild(o); note('That model is tiny, so it was scaled up 1000× (it looks like it was in metres). Change Scale if that is wrong.'); }
      refreshUI();
    } catch (e) { note(e.message || 'Could not read that file.', true); }
  };
  rd.readAsArrayBuffer(f);
}
function note(t, warn) { var m = $('#msg'); m.hidden = false; m.className = 'msg' + (warn ? ' warn' : ''); m.textContent = t; setTimeout(function () { if (m.textContent === t) refreshUI(); }, 6000); }
$('#file').addEventListener('change', function () { Array.prototype.forEach.call(this.files, loadFile); this.value = ''; });
['dragover', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'drop' && e.dataTransfer) Array.prototype.forEach.call(e.dataTransfer.files, function (f) { if (/\.(stl|obj|3mf)$/i.test(f.name)) loadFile(f); }); }); });
$('#addCube').addEventListener('click', function () {
  var v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(function (p) { return [p[0] * 20, p[1] * 20, p[2] * 20]; }), f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]], a = [];
  f.forEach(function (t) { t.forEach(function (i) { a.push(v[i][0], v[i][1], v[i][2]); }); }); makeObj('Cube 20 mm', Float32Array.from(a));
});

/* pointer: pick and drag models, orbit, pan, zoom */
var ptrs = new Map(), drag = null;
var el = renderer.domElement;
function ndc(e) { var r = el.getBoundingClientRect(); return new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
function groundPoint(e) { raycaster.setFromCamera(ndc(e), camera); var p = new T.Vector3(); return raycaster.ray.intersectPlane(plane, p) ? p : null; }
el.addEventListener('pointerdown', function (e) {
  el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, s: e.shiftKey });
  if (previewing) return;
  if (ptrs.size === 1 && e.button === 0 && !e.shiftKey) {
    raycaster.setFromCamera(ndc(e), camera); var hit = raycaster.intersectObjects(objs.map(function (o) { return o.mesh; }))[0];
    if (hit) { var o = hit.object.userData.obj, g = groundPoint(e); sel = o; refreshUI(); if (g) drag = { o: o, dx: o.t.x - g.x, dy: o.t.y - g.y }; }
  }
});
el.addEventListener('pointermove', function (e) {
  var p = ptrs.get(e.pointerId); if (!p) return; var dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (ptrs.size === 2) {
    var other = Array.from(ptrs.entries()).filter(function (k) { return k[0] !== e.pointerId; })[0][1], d0 = Math.hypot(p.x - other.x, p.y - other.y), d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
    cam.dist = Math.min(1800, Math.max(80, cam.dist * d0 / Math.max(1, d1))); drag = null; placeCam();
  } else if (drag) {
    var g = groundPoint(e); if (g) { var o = drag.o; o.t.x = Math.min(BED[0], Math.max(0, g.x + drag.dx)); o.t.y = Math.min(BED[1], Math.max(0, g.y + drag.dy)); o.mesh.position.set(o.t.x, o.t.y, 0); $('#t-x').value = o.t.x.toFixed(1); $('#t-y').value = o.t.y.toFixed(1); tint(o); stale(); dirty = true; }
  } else if (p.b === 2 || p.b === 1 || p.s) {
    var k = cam.dist * Math.tan(17.5 * Math.PI / 180) * 2 / stage.clientHeight, right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    cam.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k); placeCam();
  } else { cam.az -= dx * 0.006; cam.el = Math.min(1.55, Math.max(0.03, cam.el + dy * 0.006)); placeCam(); }
  p.x = e.clientX; p.y = e.clientY;
});
function up(e) { ptrs.delete(e.pointerId); if (drag) { drag = null; refreshUI(); } }
el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
el.addEventListener('wheel', function (e) { e.preventDefault(); cam.dist = Math.min(1800, Math.max(80, cam.dist * Math.exp(e.deltaY * 0.0012))); placeCam(); }, { passive: false });

/* ---------------------------------------------------------------- slicing */
var plan = null, worker = null, busy = false, previewing = false, previewGroup = new T.Group(), typeMeshes = {};
scene.add(previewGroup);
var TYPES = [['outer', 'Outer wall', 0xff9d6e], ['inner', 'Inner wall', 0xf5c542], ['sparse', 'Sparse infill', 0xd9534f], ['solid', 'Solid infill', 0xb07ae0], ['top', 'Top surface', 0xf0efe9], ['support', 'Support', 0x58c9a0], ['skirt', 'Skirt', 0x6fb3a8], ['brim', 'Brim', 0x6fb3a8]];
function stale() { if (!plan) return; $('#status').textContent = 'Settings or models changed since the last slice. Slice again to update the G-code.'; $('#export').disabled = true; $('#tab-prev').disabled = false; plan.stale = true; }
function gatherTris() {
  var parts = objs.map(function (o) { return E.placeTris(o.base, { x: o.t.x, y: o.t.y, rx: o.t.rx, ry: o.t.ry, rz: o.t.rz, scale: o.t.scale }); }), n = 0; parts.forEach(function (p) { n += p.length; });
  var all = new Float32Array(n), k = 0; parts.forEach(function (p) { all.set(p, k); k += p.length; }); return all;
}
function setBusy(b) { busy = b; $('#slice').disabled = b || !objs.length; $('#slice').textContent = b ? 'Slicing…' : 'Slice plate'; $('#bar').hidden = !b; }
function progress(p, label) { $('#bar i').style.width = Math.round(p * 100) + '%'; $('#status').textContent = label + '…'; }
$('#slice').addEventListener('click', function () {
  if (busy || !objs.length) return;
  if (objs.some(outside)) { note('Move every model inside the build volume before slicing.', true); return; }
  var tris = gatherTris(), settings = JSON.parse(JSON.stringify(S)); setBusy(true); progress(0, 'Starting');
  function finish(p) { plan = p; plan.stale = false; setBusy(false); showStats(); buildPreview(); $('#export').disabled = false; $('#tab-prev').disabled = false; setMode(true); }
  function fail(m) { setBusy(false); $('#status').textContent = 'Could not slice: ' + m; note('Could not slice: ' + m, true); }
  try {
    worker = new Worker('worker.js');
    worker.onmessage = function (e) { var d = e.data; if (d.progress != null) progress(d.progress, d.label); else if (d.error) { fail(d.error); worker.terminate(); } else if (d.done) { finish(d.plan); worker.terminate(); } };
    worker.onerror = function () { worker.terminate(); runInline(); };
    worker.postMessage({ tris: tris, settings: settings });
  } catch (e) { runInline(); }
  function runInline() { setTimeout(function () { try { var r = E.slice(tris, settings, progress); finish({ layers: r.layers, gcode: r.gcode, stats: r.stats, unknown: r.unknown, warnings: r.warnings, supportTips: r.supportTips }); } catch (err) { fail(err.message); } }, 30); }
});
function showStats() {
  var s = plan.stats, h = Math.floor(s.timeSec / 3600), m = Math.round((s.timeSec % 3600) / 60), st = $('#stats');
  var unk = (plan.warnings && plan.warnings.length ? ' ' + plan.warnings.join(' ') : '') + (plan.unknown && plan.unknown.length ? ' Warning: the machine G-code uses values this slicer does not know (' + plan.unknown.join(', ') + ').' : '');
  st.hidden = false; st.innerHTML = '<span>Layers</span><span>' + s.layers + '</span><span>Time (rough)</span><span>' + (h ? h + ' h ' : '') + m + ' min</span><span>Filament</span><span>' + (s.filamentMm / 1000).toFixed(2) + ' m &middot; ' + s.filamentG.toFixed(1) + ' g</span>' + (plan.supportTips ? '<span>Support tips</span><span>' + plan.supportTips + '</span>' : '') + '<span>G-code</span><span>' + (plan.gcode.length / 1048576).toFixed(2) + ' MB</span>';
  $('#status').textContent = 'Sliced for ' + printer.name + '. Time is an estimate and usually runs shorter than the printer reports.' + unk;
}
$('#export').addEventListener('click', function () {
  if (!plan || plan.stale) return;
  var blob = new Blob([plan.gcode], { type: 'text/plain' }), a = document.createElement('a'), base = (objs[0] ? objs[0].name : 'plate').replace(/[^\w.-]+/g, '_');
  a.href = URL.createObjectURL(blob); a.download = base + '_' + printer.short.replace(/\s+/g, '') + '.gcode'; document.body.append(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
});

/* ---------------------------------------------------------------- preview */
function clearPreview() { while (previewGroup.children.length) { var c = previewGroup.children.pop(); c.geometry.dispose(); c.material.dispose(); } typeMeshes = {}; }
function buildPreview() {
  clearPreview(); var layers = plan.layers, w = S.lineWidth, hw = w / 2, per = {};
  TYPES.forEach(function (t) { per[t[0]] = { pos: [], ends: new Array(layers.length).fill(0) }; });
  layers.forEach(function (L, li) {
    TYPES.forEach(function (t) { per[t[0]].ends[li] = per[t[0]].pos.length / 3; });
    var z = L.z - 0.02;
    L.items.forEach(function (it) {
      var P = per[it.type]; if (!P) return; var p = it.pts, pos = P.pos;
      for (var i = 2; i < p.length; i += 2) {
        var x0 = p[i - 2], y0 = p[i - 1], x1 = p[i], y1 = p[i + 1], dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy); if (d < 1e-4) continue;
        var nx = -dy / d * hw, ny = dx / d * hw;
        pos.push(x0 + nx, y0 + ny, z, x0 - nx, y0 - ny, z, x1 + nx, y1 + ny, z, x1 + nx, y1 + ny, z, x0 - nx, y0 - ny, z, x1 - nx, y1 - ny, z);
      }
      P.ends[li] = pos.length / 3;
    });
    TYPES.forEach(function (t) { per[t[0]].ends[li] = per[t[0]].pos.length / 3; });
  });
  TYPES.forEach(function (t) {
    var P = per[t[0]]; if (!P.pos.length) return;
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P.pos, 3));
    var m = new T.Mesh(g, new T.MeshBasicMaterial({ color: t[2], side: T.DoubleSide })); m.frustumCulled = false; m.userData.ends = P.ends; previewGroup.add(m); typeMeshes[t[0]] = m;
  });
  var sl = $('#layer'); sl.max = layers.length; sl.value = layers.length; applyLayer(); buildLegend();
}
function applyLayer() {
  var k = parseInt($('#layer').value, 10) - 1, L = plan.layers[k];
  Object.keys(typeMeshes).forEach(function (n) { var m = typeMeshes[n]; m.geometry.setDrawRange(0, m.userData.ends[k]); });
  $('#prevlabel').textContent = (k + 1) + ' / ' + plan.layers.length + '\n' + L.z.toFixed(2) + ' mm'; $('#prevlabel').style.whiteSpace = 'pre'; dirty = true;
}
$('#layer').addEventListener('input', applyLayer);
function buildLegend() {
  var lg = $('#legend'); lg.innerHTML = '';
  TYPES.forEach(function (t) {
    if (!typeMeshes[t[0]] || (t[0] === 'brim' && !typeMeshes.brim)) return;
    var l = document.createElement('label'), c = document.createElement('input'); c.type = 'checkbox'; c.checked = true;
    c.addEventListener('change', function () { typeMeshes[t[0]].visible = c.checked; dirty = true; });
    var sw = document.createElement('i'); sw.style.background = '#' + t[2].toString(16).padStart(6, '0'); l.append(c, sw, document.createTextNode(t[1])); lg.append(l);
  });
}
function setMode(prev) {
  previewing = !!prev && !!plan; $('#tab-prep').setAttribute('aria-selected', String(!previewing)); $('#tab-prev').setAttribute('aria-selected', String(previewing));
  objGroup.visible = !previewing; previewGroup.visible = previewing; $('#legend').hidden = !previewing; $('#prev').hidden = !previewing; dirty = true;
}
$('#tab-prep').addEventListener('click', function () { setMode(false); });
$('#tab-prev').addEventListener('click', function () { if (plan) setMode(true); });

/* ---------------------------------------------------------------- printer selection */
var NOTES = {
  bambu: 'Uses Bambu Studio\'s own start and end G-code for this printer (bed levelling, nozzle wipe, filament prime). Bambu printers may prefer .gcode.3mf files, so try a small plain .gcode from the SD card first and stay with the printer for the first layer.',
  elegoo: 'Uses OrcaSlicer\'s start and end G-code for the Centauri Carbon (nozzle clean, purge line). This printer runs Klipper and takes plain .gcode. Stay with it for the first layer.'
};
function updatePrinterNote() { $('#pnote').textContent = (NOTES[printer.vendor] || '') + ' Draft software: not yet run on a printer.'; }
function buildPrinterSelect() {
  var sel = $('#printer');
  PR.ORDER.forEach(function (id) { var p = PRS[id], o = document.createElement('option'); o.value = id; o.textContent = p.name + ' (' + p.bed[0] + '×' + p.bed[1] + '×' + p.height + ')'; sel.append(o); });
  sel.value = printer.id; sel.addEventListener('change', function () { setPrinter(sel.value, true); });
  updatePrinterNote();
}
function setPrinter(id, applyDefaults) {
  printer = PRS[id] || PRS.h2s; S.printer = printer.id; BED = printer.bed; BH = printer.height;
  if (applyDefaults) Object.assign(S, printer.defaults);
  buildSettings(); persist(); buildBed(); resetView(); updatePrinterNote();
  objs.forEach(function (o) { o.t.x = Math.min(Math.max(o.t.x, o.half[0]), BED[0] - o.half[0]); o.t.y = Math.min(Math.max(o.t.y, o.half[1]), BED[1] - o.half[1]); o.mesh.position.set(o.t.x, o.t.y, 0); });
  if (objs.some(outside)) arrange();
  refreshUI(); if (plan) { plan.stale = true; stale(); }
  $('#slice').title = 'Slice for ' + printer.name;
}

/* ---------------------------------------------------------------- start */
window.addEventListener('cp-theme', buildBed);
window.addEventListener('storage', function () { setTimeout(buildBed, 0); });
buildSettings(); buildProfiles(); buildPrinterSelect(); buildBed(); placeCam(); resize(); refreshUI(); previewGroup.visible = false;
window.__layerline = { objs: function () { return objs; }, plan: function () { return plan; }, S: S };
})();

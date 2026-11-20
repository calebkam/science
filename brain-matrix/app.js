(function () {
  'use strict';
  const G = window.BrainMatrix, THREE = window.THREE;
  const $ = s => document.querySelector(s);
  const el = (t, a, ...kids) => { const e = document.createElement(t); for (const k in (a || {})) k === 'text' ? e.textContent = a[k] : e.setAttribute(k, a[k]); kids.forEach(c => e.append(c)); return e; };

  const AXES = [['coronal', 'Coronal', 'front to back'], ['sagittal', 'Sagittal', 'left to right'], ['axial', 'Axial', 'dorsal to ventral']];
  const STYLE_DEFAULTS = { solid: { wall: 20, base: 12, corner_radius: 10 }, light: { wall: 14, base: 10, corner_radius: 30 } };
  const AXIS_DEFAULTS = { coronal: { datum: 'hi', depth_fraction: 90, taper: 30 }, sagittal: { datum: 'centre', depth_fraction: 90, taper: 30 }, axial: { datum: 'hi', depth_fraction: 100, taper: 20 } };
  const DATUMS = {
    coronal: [['hi', 'From the frontal end'], ['lo', 'From the occipital end'], ['centre', 'Cut at the centre'], ['straddle', 'Straddle the centre']],
    sagittal: [['centre', 'Cut on the midline'], ['straddle', 'Straddle the midline'], ['lo', 'From the left side'], ['hi', 'From the right side']],
    axial: [['hi', 'From the dorsal end'], ['lo', 'From the ventral end'], ['centre', 'Cut at the centre'], ['straddle', 'Straddle the centre']],
  };
  const MANUAL_HINT = {
    coronal: 'Optional. Cut positions in mm along Y, centre = 0, anterior positive. Overrides thickness.',
    sagittal: 'Optional. Cut positions in mm along X, midline = 0, right positive. Overrides thickness.',
    axial: 'Optional. Cut positions in mm along the dorsal-ventral axis, centre = 0, dorsal positive. Overrides thickness.',
  };
  const COLS = {
    coronal: ['Slice', 'From Y', 'To Y', 'Thick'], sagittal: ['Slice', 'From X', 'To X', 'Thick'], axial: ['Slice', 'From D-V', 'To D-V', 'Thick'],
  };
  const howtoSliding = (P, info) => {
    const lat = P.latch === 'off' ? '' : ' A latch bar snaps over a post on each half (' + P.latch + ' of the wall) to hold them at the opening you set; lift it off to adjust.';
    const base = 'Two halves slide apart on two guide rods, so one matrix fits brains of different sizes. ';
    const split = P.axis === 'coronal' ? 'The halves split down the midline (left | right), across the coronal slices, so the blade slots keep the same positions at any opening. '
      : 'The halves split front | back, across the ' + (P.axis === 'axial' ? 'axial' : 'sagittal') + ' slices, so the slots keep the same positions at any opening and every slab stays whole. ';
    return base + split + 'End brackets hold the rods and set the maximum opening. M4 screws lock each half in place.' + lat;
  };
  const lightNote = P => P.style === 'light' ? ' Lightweight style: the outer walls lean inward toward the bed (at most ' + P.taper + ' degrees, so no supports) and the walls that carry no slots are thin. Print with the flat bottom down, 2 to 3 perimeters and 10 to 15% infill; a brim helps on the narrow foot.' : '';
  const howto = (P, info) => (info.sliding ? howtoSliding(P, info) : ({
    coronal: 'Coronal slices run front to back. The brain sits dorsal side up with the frontal pole toward the A face. Each slot crosses the full width of the block and drops below the lowest point of the cavity, so a blade lowered into it cuts completely through. Slices are numbered from the ' + (P.datum === 'lo' ? 'occipital' : 'frontal') + ' end.',
    sagittal: 'Sagittal slices run left to right. The brain sits dorsal side up, frontal pole toward the A face. Each slot runs the full length of the block and drops below the lowest point of the cavity. Slices are numbered from the ' + (P.datum === 'hi' ? 'right' : 'left') + ' side; a cut on the midline gives a clean hemisection.',
    axial: 'Axial (horizontal) slices are cut with the brain turned on its side: lateral surface down, dorsal toward the D end of the block, frontal pole toward the A face. Blades then drop in from above like the other models, and each slot crosses the full length of the block. Positions run along the dorsal-ventral axis (centre 0, dorsal positive). Slices are numbered from the ' + (P.datum === 'lo' ? 'ventral' : 'dorsal') + ' end.',
  })[P.axis]) + lightNote(P);

  // ---- field schema -----------------------------------------------------------
  const N = (key, label, min, max, step, o) => Object.assign({ key, label, t: 'num', min, max, step }, o);
  const sliding = P => P.mode === 'sliding', lateral = P => P.axis !== 'axial';
  const NOTE_KEYS = ['note_front', 'note_back', 'note_xp', 'note_xm'];
  const SECTIONS = [
    { title: 'Guide rods', show: sliding, fields: [
      { key: 'rod_auto', label: 'Rod length follows the maximum opening', t: 'chk' },
      N('max_gap', 'Maximum opening (mm)', 0, 150, 1, { show: P => P.rod_auto, hint: 'How far the halves can be pulled apart. The rod length is calculated from this.' }),
      N('rod_length', 'Rod length (mm)', 60, 700, 1, { show: P => !P.rod_auto, range: true, hintFn: () => lastInfo && lastInfo.sliding ? 'Allows an opening of ' + f1(lastInfo.sliding.maxOpening) + ' mm.' : '' }),
      N('gap', 'Opening shown in the preview (mm)', 0, 150, 1, { range: true, hint: 'Preview only. The parts are exported separately.' }),
      N('rod_d', 'Rod diameter (mm)', 4, 16, 0.5),
      N('rod_clearance', 'Bore clearance (mm)', 0.1, 1, 0.05),
      N('rod_y_from_edge', 'Rod distance from end face (mm)', 8, 30, 0.5, { show: P => P.style !== 'light' }),
      N('socket_depth', 'Bracket socket depth (mm)', 6, 25, 1),
      N('socket_clearance', 'Socket clearance (mm)', 0, 0.5, 0.05),
      N('bracket_thickness', 'Bracket thickness (mm)', 8, 30, 1),
      { key: 'latch', label: 'Latch between the halves', t: 'sel', opts: [['top', 'On top of the walls'], ['side', 'On the side walls'], ['off', 'None']], hint: 'A printed bar snaps over a post on each half, so the halves cannot drift. Lift it off to change the opening.' },
      N('latch_gap', 'Opening the latch holds (mm)', 0, 150, 1, { show: P => P.latch !== 'off', hint: '0 = closed. Print a bar for each opening you use.' }),
      N('latch_inset', 'Post distance from the split (mm)', 8, 60, 1, { show: P => P.latch !== 'off' }),
      N('latch_post_d', 'Post diameter (mm)', 3, 10, 0.5, { show: P => P.latch !== 'off' }),
      N('latch_clearance', 'Bar hole clearance (mm)', 0.1, 0.6, 0.05, { show: P => P.latch !== 'off' }),
      N('latch_bar_w', 'Bar width (mm)', 8, 24, 1, { show: P => P.latch !== 'off' }),
      N('latch_bar_t', 'Bar thickness (mm)', 2, 6, 0.5, { show: P => P.latch !== 'off' }),
      { key: 'lock_screws', label: 'Lock screw holes', t: 'chk' },
      N('lock_pilot', 'Pilot hole (mm)', 2, 6, 0.1, { show: P => P.lock_screws }),
      N('lock_x_pct', 'Lock position from medial face (%)', 20, 95, 1, { show: P => lateral(P) && P.lock_screws }),
    ] },
    { title: 'Lightweight shape', show: P => P.style === 'light', fields: [
      N('taper', 'Wall lean (degrees from vertical)', 0, 45, 1, { range: true, hint: '45 or less prints without supports. More lean means less plastic and a smaller footprint on the bed.' }),
      N('shell', 'Minimum material around the bowl (mm)', 2, 15, 0.5),
      N('end_wall', 'End wall thickness (mm)', 4, 20, 1, { hint: 'The walls that carry no blade slots.' }),
    ] },
    { title: 'Specimen', fields: [
      { key: 'specimen', label: 'Species preset', t: 'sel', opts: [['human', 'Human adult'], ['macaque', 'Macaque'], ['sheep', 'Sheep'], ['custom', 'Custom']] },
      N('custom_width', 'Width (both hemispheres)', 20, 260, 1, { show: P => P.specimen === 'custom' }),
      N('custom_length', 'Length (pole to pole)', 20, 300, 1, { show: P => P.specimen === 'custom' }),
      N('custom_height', 'Height (ventral to dorsal)', 10, 200, 1, { show: P => P.specimen === 'custom' }),
      N('size_scale', 'Size scale (%)', 60, 150, 1, { hint: 'Use below 100 for fixation shrinkage, above for swelling.' }),
      { key: 'hemisphere', label: 'Cradle', t: 'sel', show: P => !sliding(P) && P.axis !== 'axial', opts: [['whole', 'Whole brain'], ['left', 'Left hemisphere'], ['right', 'Right hemisphere']] },
      N('clearance', 'Clearance (mm)', 0, 15, 0.5),
      N('depth_fraction', 'Depth fraction (%)', 50, 130, 1, { hintFn: P => P.axis === 'axial' ? 'Share of the brain width (it lies on its side) that sits below the rim. 100 holds the whole brain.' : 'Share of the specimen height that sits below the rim.' }),
    ] },
    { title: 'Cavity shape', fold: true, fields: [
      N('frontal_width_ratio', 'Frontal width (% of occipital)', 60, 100, 1),
      N('occipital_length_pct', 'Occipital length (%)', 25, 60, 1),
      N('frontal_length_pct', 'Frontal length (%)', 25, 60, 1),
    ] },
    { title: 'Slicing', fields: [
      N('thickness', 'Slice thickness (mm)', 1, 40, 0.25, { range: true }),
      { key: 'datum', label: 'First cut measured', t: 'sel', opts: P => DATUMS[P.axis] },
      N('phase', 'Shift the cut grid (mm)', -30, 30, 0.5, { show: P => !(sliding(P) && P.axis !== 'coronal') }),
      { key: 'manual', label: 'Manual cut positions', t: 'txt', wide: true, hintFn: P => MANUAL_HINT[P.axis], ph: 'e.g. -60, -20, 0, 35' },
    ] },
    { title: 'Blade slots', fields: [
      N('slot_width', 'Slot width (mm)', 0.4, 5, 0.1, { hint: 'Blade thickness plus about 0.3 mm.' }),
      N('lead_in', 'Entry flare (mm)', 0, 5, 0.5),
      N('slot_overshoot', 'Slot below cavity floor (mm)', 0, 6, 0.5),
    ] },
    { title: 'Block', fields: [
      N('wall', 'Wall thickness (mm)', 8, 40, 1, { hintFn: P => P.style === 'light' ? 'Thickness of the walls that carry the blade slots.' : '' }),
      N('base', 'Base thickness (mm)', 4, 35, 1),
      N('corner_radius', 'Corner radius (mm)', 0, 25, 1),
      N('chamfer', 'Bottom chamfer (mm)', 0, 3, 0.5),
    ] },
    { title: 'Features', fields: [
      { key: 'labels', label: 'Engrave slice numbers', t: 'chk' },
      { key: 'marks', label: 'Engrave A and P marks', t: 'chk' },
      N('drain_d', 'Drain hole diameter (mm, 0 = off)', 0, 8, 0.5),
      N('drain_spacing', 'Drain hole spacing (mm)', 12, 60, 1, { show: P => P.drain_d > 0 }),
      N('label_depth', 'Engraving depth (mm)', 0.4, 2, 0.2, { show: P => P.labels || P.marks || NOTE_KEYS.some(k => P[k]) }),
    ] },
    { title: 'Notes on the walls', fields: [
      { key: 'note_front', label: 'Front wall (+Y, anterior)', t: 'txt', wide: true, ph: 'e.g. CASE 12  |  R HEMI', hint: 'Letters, digits and basic punctuation. Use | for a new line. Text shrinks to fit and a warning appears if it cannot.' },
      { key: 'note_back', label: 'Back wall (-Y, posterior)', t: 'txt', wide: true },
      { key: 'note_xp', label: '+X wall', t: 'txt', wide: true, hintFn: P => P.axis === 'axial' ? 'The +X end is the dorsal side for axial blocks.' : 'The +X end is the specimen right side.' },
      { key: 'note_xm', label: '-X wall', t: 'txt', wide: true },
      N('note_height', 'Letter height (mm)', 3, 14, 0.5),
      N('note_pos', 'Vertical position in free area (%)', 0, 100, 5),
    ] },
  ];

  // ---- state ------------------------------------------------------------------
  const KEY = 'brainmatrix.settings.v1';
  let P = Object.assign({}, G.DEFAULTS, AXIS_DEFAULTS.coronal);
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') for (const k in P) if (k in s && typeof s[k] === typeof P[k]) P[k] = s[k]; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} };
  const inputs = {};            // key -> {field, row[], input}

  // ---- controls ---------------------------------------------------------------
  function buildControls() {
    const tabs = $('#axisseg');
    [['fixed', 'Fixed block', AXES.map(a => a[2])], ['sliding', 'Sliding halves on guide rods', ['left | right', 'front | back', 'front | back']]].forEach(([mode, title, subs]) => {
      const row = el('div', { class: 'seg' });
      AXES.forEach(([id, name], i) => {
        const b = el('button', { type: 'button', 'data-axis': id, 'data-mode': mode }); b.append(name, el('small', { text: subs[i] }));
        b.addEventListener('click', () => setMode(mode, id)); row.append(b);
      });
      tabs.append(el('div', { class: 'tabgroup' }, el('div', { class: 'tablbl', text: title }), row));
    });
    const srow = el('div', { class: 'seg two' });
    [['solid', 'Solid', 'full walls'], ['light', 'Lightweight', 'tapered, far less plastic']].forEach(([id, name, sub]) => {
      const b = el('button', { type: 'button', 'data-style': id }); b.append(name, el('small', { text: sub }));
      b.addEventListener('click', () => setStyle(id)); srow.append(b);
    });
    tabs.append(el('div', { class: 'tabgroup' }, el('div', { class: 'tablbl', text: 'Build style' }), srow));
    const root = $('#fields');
    SECTIONS.forEach(sec => {
      const grid = el('div', { class: 'grid' });
      const box = sec.fold ? el('details', {}, el('summary', { text: sec.title }), grid) : el('fieldset', {}, el('legend', { text: sec.title }), grid);
      sec.fields.forEach(f => {
        const id = 'f_' + f.key, rec = { f, els: [] };
        const lab = el('label', { for: id, text: f.label });
        let inp;
        if (f.t === 'sel') { inp = el('select', { id }); inp.addEventListener('change', () => commit(f.key, inp.value)); }
        else if (f.t === 'chk') { inp = el('input', { id, type: 'checkbox' }); inp.addEventListener('change', () => commit(f.key, inp.checked)); }
        else if (f.t === 'txt') { inp = el('input', { id, type: 'text', placeholder: f.ph || '', autocomplete: 'off' }); inp.addEventListener('input', () => commit(f.key, inp.value)); }
        else { inp = el('input', { id, type: 'number', min: f.min, max: f.max, step: f.step, inputmode: 'decimal' });
          inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) commit(f.key, v, inp); }); }
        if (f.wide) { lab.className = 'wide'; inp.className = 'wide'; }
        rec.els.push(lab, inp); grid.append(lab, inp);
        if (f.range) {
          const r = el('input', { type: 'range', min: f.min, max: f.max, step: f.step, 'aria-label': f.label, class: 'wide' });
          r.addEventListener('input', () => commit(f.key, parseFloat(r.value), r)); rec.range = r; rec.els.push(r); grid.append(r);
        }
        if (f.hint || f.hintFn) { const h = el('div', { class: 'hint' }); rec.hint = h; rec.els.push(h); grid.append(h); }
        rec.input = inp; inputs[f.key] = rec;
      });
      sec.box = box; root.append(box);
    });
    $('#reset').addEventListener('click', () => { P = Object.assign({}, G.DEFAULTS, AXIS_DEFAULTS[P.axis], STYLE_DEFAULTS[P.style], { axis: P.axis, mode: P.mode, style: P.style }); syncControls(); schedule(); save(); });
    $('#viewbtns').addEventListener('click', e => { const v = e.target.dataset && e.target.dataset.v; if (v) setView(v, e.target); });
    $('#dl').addEventListener('click', download);
    $('#dlset').addEventListener('click', saveSettings);
    syncControls();
  }

  function commit(key, val, src) {
    P[key] = val; save();
    if (['specimen', 'drain_d', 'labels', 'marks', 'rod_auto', 'lock_screws', 'latch'].includes(key)) syncControls(src);
    else if (inputs[key] && inputs[key].range && src !== inputs[key].range) inputs[key].range.value = val;
    else if (inputs[key] && inputs[key].range && src === inputs[key].range) inputs[key].input.value = val;
    schedule();
  }

  function setStyle(id) {
    if (P.style === id) return;
    P.style = id; Object.assign(P, STYLE_DEFAULTS[id]);
    syncControls(); schedule(); save();
  }
  function setMode(mode, id) {
    P.mode = mode; P.axis = id; Object.assign(P, AXIS_DEFAULTS[id]); P.manual = '';
    syncControls(); frameNext = true; schedule(); save();
  }

  function syncControls(skip) {
    document.querySelectorAll('#axisseg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.style ? b.dataset.style === P.style : b.dataset.axis === P.axis && b.dataset.mode === P.mode)));
    SECTIONS.forEach(sec => { if (sec.box) sec.box.hidden = !!(sec.show && !sec.show(P)); });
    for (const key in inputs) {
      const { f, els, input, range, hint } = inputs[key];
      const vis = !f.show || f.show(P);
      els.forEach(e => { e.hidden = !vis; });
      if (f.t === 'sel') {
        const opts = typeof f.opts === 'function' ? f.opts(P) : f.opts;
        if (input.dataset.sig !== JSON.stringify(opts)) { input.textContent = ''; opts.forEach(([v, t]) => input.append(el('option', { value: v, text: t }))); input.dataset.sig = JSON.stringify(opts); }
        input.value = P[key];
      } else if (f.t === 'chk') input.checked = !!P[key];
      else if (document.activeElement !== input && input !== skip) input.value = P[key];
      if (range && range !== skip) range.value = P[key];
      if (hint) { const ht = f.hintFn ? f.hintFn(P) : f.hint; hint.textContent = ht; hint.hidden = !vis || !ht; }
    }
  }

  // ---- engine -----------------------------------------------------------------
  const refCache = { key: '', v: 0 };
  let wasm = null, builds = 0, busy = false, pending = false, timer = 0, lastInfo = null;
  async function initWasm() {
    const bin = new Uint8Array(await (await fetch('manifold.wasm')).arrayBuffer());
    wasm = await window.Module({ wasmBinary: bin }); wasm.setup(); builds = 0;
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => rebuild(), 120); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function rebuild(opt) {
    opt = opt || {};
    if (!wasm) return null;
    if (busy) { if (!opt.export) pending = true; return null; }
    busy = true; $('#status').textContent = 'building…';
    try {
      if (builds >= 8) await initWasm();
      const t0 = performance.now();
      const { solid, info, parts } = G.build(wasm, Object.assign({}, P, { quality: opt.quality || 64 }));
      if (P.style === 'light' && !opt.export) {
        const key = JSON.stringify([P.axis, P.specimen, P.custom_width, P.custom_length, P.custom_height, P.size_scale, P.clearance, P.depth_fraction, P.frontal_width_ratio, P.occipital_length_pct, P.frontal_length_pct, P.thickness, P.datum, P.phase, P.manual, P.slot_width, P.lead_in, P.slot_overshoot]);
        if (refCache.key !== key) { refCache.key = key; refCache.v = G.referenceVolume(wasm, P); builds += 1; }
        info.volumeRef = refCache.v;
      }
      builds += (opt.quality ? 3 : 1) * (parts ? 2 : 1);
      if (parts) {
        if (opt.export) {
          const files = parts.map(pt => ({ name: pt.name, label: pt.label, count: pt.count, stl: new Uint8Array(G.toSTL(pt.print.getMesh())) }));
          parts.forEach(pt => { pt.print.delete(); pt.asm.delete(); });
          return { files, info };
        }
        const items = parts.map(pt => ({ mesh: pt.asm.getMesh(), role: pt.role }));
        parts.forEach(pt => { pt.print.delete(); pt.asm.delete(); });
        showItems(items);
        const ms = performance.now() - t0; lastInfo = info; renderInfo(info, ms);
        $('#status').textContent = items.reduce((a, i) => a + i.mesh.triVerts.length / 3, 0).toLocaleString() + ' triangles · ' + parts.length + ' parts · ' + Math.round(ms) + ' ms';
      } else {
        const mesh = solid.getMesh();
        if (opt.export) { const stl = G.toSTL(mesh); solid.delete(); return { stl, info }; }
        showItems([{ mesh, role: 'half' }]); solid.delete();
        const ms = performance.now() - t0; lastInfo = info; renderInfo(info, ms);
        $('#status').textContent = (mesh.triVerts.length / 3).toLocaleString() + ' triangles · ' + Math.round(ms) + ' ms';
      }
    } catch (e) {
      console.error(e); $('#status').textContent = 'build failed: ' + (e && e.message || e);
    } finally { busy = false; if (pending) { pending = false; schedule(); } }
    return null;
  }

  // ---- info panel -------------------------------------------------------------
  const f1 = v => (Math.round(v * 10) / 10).toString();
  function renderInfo(info, ms) {
    const b = info.block, z0 = b.h - info.cavity.depth;
    const sl = info.sliding;
    const tiles = [[String(info.slices), 'slices'], [f1(b.w) + ' × ' + f1(b.l) + ' × ' + f1(b.h), (sl ? 'closed block' : 'block') + ' W × L × H, mm'],
      sl ? [f1(sl.rodLen) + ' mm', 'guide rod length, 2 needed'] : [f1(info.cavity.w) + ' × ' + f1(info.cavity.l), 'cavity W × L, mm'],
      sl ? [f1(sl.maxOpening) + ' mm', 'maximum opening'] : [f1(info.thickness) + ' mm', 'slice thickness'],
      [Math.round(info.volume).toLocaleString() + ' cm³', 'printed volume' + (sl ? ', rods excluded' : '')]];
    if (info.volumeRef) tiles.push(['−' + Math.max(0, Math.round(100 * (1 - info.volume / info.volumeRef))) + '%', 'plastic vs the solid design']);
    if (info.foot) tiles.push([f1(info.foot.w) + ' × ' + f1(info.foot.l), 'footprint on the bed, mm']);
    $('#tiles').replaceChildren(...tiles.map(([v, l]) => el('div', { class: 'panel tile' }, el('b', { text: v }), el('span', { text: l }))));
    $('#howto').textContent = howto(P, info);
    $('#bom').replaceChildren(...(sl ? sl.bom : []).map(t => el('li', { text: t })));
    $('#bomwrap').hidden = !sl;
    $('#warns').replaceChildren(...info.warnings.map(w => el('li', { text: w })));
    $('#thead').replaceChildren(...COLS[P.axis].map(c => el('th', { text: c })));
    const off = 0;
    const rows = info.cells.slice().sort((a, c) => a.n - c.n).map((c, i, all) => {
      const end = c.n === 1 || c.n === all.length;
      const split = sl && (P.axis !== 'coronal' ? 0 : NaN);
      const mark = split !== undefined && split !== false && c.lo + 1e-6 < split && split < c.hi - 1e-6 ? ' (split)' : (end && info.cells.length > 1 ? ' (end)' : '');
      return el('tr', {}, el('td', { text: c.n + mark }), el('td', { text: f1(c.lo - off) }), el('td', { text: f1(c.hi - off) }), el('td', { text: f1(c.thick) }));
    });
    $('#tbody').replaceChildren(...rows);
    updateGhost(info);
    if (frameNext) { frameNext = false; setView('iso'); }
    target.set((info.cx[0] + info.cx[1]) / 2 + (P.hemisphere === 'whole' ? 0 : 0), 0, b.h * 0.45);
    spanSize = info.span || Math.max(b.w, b.l, b.h); dirty = true; syncControls();
  }

  // ---- 3D preview -------------------------------------------------------------
  let renderer, scene, camera, modelGroup, ghost, grid, dirty = true, frameNext = true, spanSize = 250, showGhost = false;
  const target = new THREE.Vector3(0, 0, 50);
  const cam = { theta: 60 * Math.PI / 180, phi: 32 * Math.PI / 180, dist: 420 };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

  function initGL() {
    const canvas = $('#gl');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.localClippingEnabled = true;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 1, 1, 3000); camera.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(-150, -200, 400); scene.add(sun);
    const sun2 = new THREE.DirectionalLight(0xffffff, 0.35); sun2.position.set(250, 200, 120); scene.add(sun2);
    grid = new THREE.GridHelper(600, 30, 0x7a8a94, 0x7a8a94); grid.rotation.x = Math.PI / 2; grid.material.opacity = 0.25; grid.material.transparent = true; scene.add(grid);
    modelGroup = new THREE.Group(); scene.add(modelGroup);
    ghost = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshStandardMaterial({ color: 0xd98b8b, transparent: true, opacity: 0.4, roughness: 0.9, side: THREE.DoubleSide }));
    ghost.visible = false; scene.add(ghost);
    // orbit controls: drag rotate, shift/right-drag pan, wheel/pinch zoom
    const ptrs = new Map(); let lastPinch = 0;
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.style.cursor = 'grabbing'; });
    const up = e => { ptrs.delete(e.pointerId); lastPinch = 0; canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) cam.dist = Math.min(1500, Math.max(60, cam.dist * lastPinch / d)); lastPinch = d;
      } else if (e.shiftKey || e.buttons === 2) {
        const s = cam.dist * 0.0016, r = new THREE.Vector3().subVectors(camera.position, target).cross(camera.up).normalize();
        const u = new THREE.Vector3().crossVectors(r, new THREE.Vector3().subVectors(camera.position, target)).normalize();
        target.addScaledVector(r, dx * s).addScaledVector(u, dy * s);
      } else { cam.theta -= dx * 0.008; cam.phi = Math.min(1.54, Math.max(-0.2, cam.phi + dy * 0.008)); }
      dirty = true;
    });
    canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.min(1500, Math.max(60, cam.dist * Math.exp(e.deltaY * 0.001))); dirty = true; }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(() => { dirty = true; }).observe(canvas);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { dirty = true; });
    new MutationObserver(() => { dirty = true; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    (function loop() { if (dirty) draw(); requestAnimationFrame(loop); })();
  }

  function draw() {
    dirty = false;
    const c = $('#gl'), w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(w * pr) || c.height !== Math.round(h * pr)) { renderer.setPixelRatio(pr); renderer.setSize(w, h, false); }
    camera.aspect = w / h; camera.updateProjectionMatrix();
    camera.position.set(target.x + cam.dist * Math.cos(cam.phi) * Math.cos(cam.theta), target.y + cam.dist * Math.cos(cam.phi) * Math.sin(cam.theta), target.z + cam.dist * Math.sin(cam.phi));
    camera.lookAt(target);
    scene.background = new THREE.Color(css('--view')); MATS.half.color.set(css('--mesh'));
    renderer.render(scene, camera);
  }

  const MATS = {
    half: new THREE.MeshStandardMaterial({ color: 0x8ea9b6, roughness: 0.75, metalness: 0.05 }),
    rod: new THREE.MeshStandardMaterial({ color: 0xc3ccd2, roughness: 0.3, metalness: 0.7 }),
    bracket: new THREE.MeshStandardMaterial({ color: 0x2f8794, roughness: 0.6, metalness: 0.05 }),
  };
  function showItems(items) {
    modelGroup.children.slice().forEach(m => { modelGroup.remove(m); m.geometry.dispose(); });
    for (const { mesh, role } of items) {
      const np = mesh.numProp, vp = mesh.vertProperties, n = vp.length / np, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[3 * i] = vp[i * np]; pos[3 * i + 1] = vp[i * np + 1]; pos[3 * i + 2] = vp[i * np + 2]; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
      const flat = g.toNonIndexed(); flat.computeVertexNormals(); g.dispose();
      modelGroup.add(new THREE.Mesh(flat, MATS[role] || MATS.half));
    }
    dirty = true;
  }

  function updateGhost(info) {
    const s = info.specimen, mid = (info.cx[0] + info.cx[1]) / 2;
    ghost.scale.set(s.w / 2, s.l / 2, s.h / 2); ghost.position.set(0, 0, info.block.h - info.cavity.depth + P.clearance * 0.5 + s.h / 2);
    ghost.material.clippingPlanes = P.hemisphere === 'whole' ? [] : [new THREE.Plane(new THREE.Vector3(P.hemisphere === 'right' ? 1 : -1, 0, 0), 0)];
    ghost.visible = showGhost; grid.position.z = -0.2; dirty = true;
  }

  function setView(v, btn) {
    if (v === 'ghost') { showGhost = !showGhost; btn.setAttribute('aria-pressed', String(showGhost)); ghost.visible = showGhost; dirty = true; return; }
    const D = Math.PI / 180, big = Math.max(spanSize, 150);
    const views = { iso: [60, 32, 2.1], top: [-90, 89, 1.9], front: [90, 6, 2.1], side: [0, 6, 2.1] };
    const [t, p, k] = views[v]; cam.theta = t * D; cam.phi = p * D; cam.dist = big * k; dirty = true;
  }

  // ---- export -----------------------------------------------------------------
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u => { let c = -1; for (let i = 0; i < u.length; i++) c = crcT[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(lh.buffer), nm, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), nm); off += 30 + nm.length + sz;
    }
    const cd = central.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }
  let downloads = null;
  async function saveBlob(name, blob) {
    if (downloads) return downloads.save({ filename: name, data: blob });
    const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const baseName = () => 'brain_matrix_' + (P.style === 'light' ? 'light_' : '') + (P.mode === 'sliding' ? 'slide_' : '') + P.axis + '_' + String(P.thickness).replace('.', 'p') + 'mm';
  const settingsText = () => JSON.stringify(Object.assign({ generator: 'Brain Matrix Generator', units: 'mm' }, P), null, 2);
  async function saveSettings() { try { await saveBlob(baseName() + '_settings.json', new Blob([settingsText()], { type: 'application/json' })); } catch (e) { note('Save settings: ' + (e && (e.code || e.message))); } }
  const note = t => { $('#dlnote').textContent = t; };
  function readme(info) {
    const sl = info.sliding, lat = sl.kind === 'lateral';
    return ['BRAIN MATRIX - ' + P.axis.toUpperCase() + ' SLIDING HALVES', '', 'Parts (file x quantity):']
      .concat(sl.bom.map(t => '  ' + t))
      .concat(['', 'Assembly:',
        lat ? '  1. Thread both rods through the bores low in the base of each half.' : '  1. Press the rods into the sockets in the bottom half (they stand upright).',
        lat ? '  2. Press an end bracket onto each pair of rod ends. The brackets set a maximum opening of ' + sl.maxOpening.toFixed(1) + ' mm.' : '  2. Slide the top half down over the rods, then press a cap onto each rod top. The caps set a maximum opening of ' + sl.maxOpening.toFixed(1) + ' mm.',
        '  3. Set the opening and tighten the M4 lock screws so they bite on the rods.',
        sl.latch ? '  4. Optional latch: press a latch bar over the two posts on each wall (' + sl.latch.mode + ' mount). It holds an opening of ' + sl.latch.gap + ' mm; the bar holes are ' + sl.latch.spacing.toFixed(1) + ' mm apart.' : '',
        '', 'Rod length ' + sl.rodLen.toFixed(1) + ' mm, diameter ' + sl.rodD + ' mm. All dimensions in mm.', '',
        P.style === 'light' ? 'Lightweight style: print with the flat bottom on the bed, no supports, 2 to 3 perimeters, 10 to 15% infill. Use a brim: the foot on the bed is smaller than the top. Walls lean at most ' + P.taper + ' degrees from vertical.' : '',
        'Print the halves with the base (or split face) on the bed. Brackets print with the sockets facing up.',
        'The guide rod STL lies flat; steel, stainless or carbon stock of the same diameter works better than a printed rod.',
        '', 'Settings are in settings.json: load the values back into the generator to rebuild this set.']).join('\n');
  }
  async function download() {
    const btn = $('#dl'); btn.disabled = true; note('Building the high-resolution model…');
    try {
      while (busy) await sleep(60);
      const r = await rebuild({ quality: 96, export: true }); if (!r) throw new Error('build failed');
      const enc = new TextEncoder(), settings = { name: 'settings.json', data: enc.encode(settingsText()) };
      if (r.files) {
        const zip = makeZip(r.files.map(f => ({ name: f.name + (f.count > 1 ? '_print_x' + f.count : '') + '.stl', data: f.stl })).concat([{ name: 'README.txt', data: enc.encode(readme(r.info)) }, settings]));
        await saveBlob(baseName() + '_sliding.zip', zip);
        note('Saved a .zip with ' + r.files.length + ' STL files (halves, brackets, rod), a README and the settings.');
      } else {
        const stl = new Uint8Array(r.stl);
        if (downloads) {
          await saveBlob(baseName() + '.zip', makeZip([{ name: baseName() + '.stl', data: stl }, { name: baseName() + '_settings.json', data: settings.data }]));
          note('Saved a .zip containing the STL and its settings.');
        } else { await saveBlob(baseName() + '.stl', new Blob([stl], { type: 'model/stl' })); note('Downloaded ' + baseName() + '.stl'); }
      }
    } catch (e) { note(e && e.code === 'declined' ? 'Download cancelled.' : 'Download failed: ' + (e && (e.message || e.code))); }
    finally { btn.disabled = false; builds = 99; }
  }

  // ---- start ------------------------------------------------------------------
  async function start() {
    buildControls();
    try { initGL(); } catch (e) { fatal('The 3D preview could not start in this browser (WebGL unavailable). ' + (e && e.message || '')); return; }
    try { await initWasm(); } catch (e) {
      fatal('The geometry engine (WebAssembly) could not start in this view: ' + (e && e.message || e) + '. Open the standalone version of this generator in a regular browser tab.'); return;
    }
    try { downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { downloads = null; }
    note(downloads ? 'The STL is delivered inside a .zip, because this viewer only saves approved file types.' : '');
    rebuild();
  }
  function fatal(msg) { const f = $('#fatal'); f.textContent = msg; f.style.display = 'block'; $('#status').textContent = 'engine unavailable'; }
  window.__bm = { get P() { return P; }, setMode, rebuild, makeZip, get info() { return lastInfo; } };
  start();
})();

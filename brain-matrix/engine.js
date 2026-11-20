/* Brain slicing matrix geometry engine: single-axis matrices (coronal | sagittal | axial).
   Pure JS on manifold-3d. All dimensions mm. X left(-)/right(+), Y posterior(-)/anterior(+), Z up. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrainMatrix = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PRESETS = {
    human:   { w: 140, l: 170, h: 95, label: 'Human adult' },
    macaque: { w: 60,  l: 80,  h: 45, label: 'Macaque' },
    sheep:   { w: 65,  l: 95,  h: 45, label: 'Sheep' },
  };

  const DEFAULTS = {
    axis: 'coronal',            // coronal | sagittal | axial
    specimen: 'human',          // human | macaque | sheep | custom
    custom_width: 140, custom_length: 170, custom_height: 95,
    size_scale: 100, clearance: 5, depth_fraction: 90,
    frontal_width_ratio: 87, occipital_length_pct: 43, frontal_length_pct: 37,
    hemisphere: 'whole',        // whole | left | right
    thickness: 17.5,            // slice thickness = spacing between cuts
    datum: 'hi',                // hi | lo | centre | straddle (meaning depends on axis)
    phase: 0,                   // shift the whole cut grid along the axis (mm)
    manual: '',                 // comma separated explicit cut positions (see docs)
    slot_width: 1.6, lead_in: 2, slot_overshoot: 1.5, blade_margin: 6,
    wall: 20, base: 12, corner_radius: 10, chamfer: 1.5,
    drain_d: 4, drain_spacing: 28,
    labels: true, marks: true, label_depth: 0.8,
    note_front: '', note_back: '', note_xp: '', note_xm: '', note_height: 6, note_pos: 50,
    quality: 64,
    // sliding-rod mode (two halves on guide rods)
    mode: 'fixed',              // fixed | sliding
    max_gap: 30,                // largest opening the brackets allow (mm), used when rod_auto
    rod_auto: true,             // true: rod length follows max_gap; false: use rod_length
    rod_length: 260,            // mm, used when rod_auto is false
    gap: 15,                    // opening shown in the preview (mm)
    rod_d: 8, rod_clearance: 0.4, rod_y_from_edge: 12,
    socket_depth: 12, socket_clearance: 0.1, bracket_thickness: 16,
    lock_screws: true, lock_pilot: 3.3, lock_x_pct: 80,
    latch: 'top', latch_gap: 0, latch_inset: 14, latch_post_d: 5, latch_clearance: 0.25, latch_bar_w: 12, latch_bar_t: 3,
    style: 'solid',             // solid | light (tapered, minimal-material)
    taper: 30,                  // light: wall lean toward the bed, degrees from vertical (45 max, no supports)
    shell: 5,                   // light: minimum material kept around the bowl (mm)
    end_wall: 8,                // light: thickness of the walls that carry no blade slots (mm)
    first_offset: 0,            // sagittal sliding: distance from each medial face to the first cut
  };

  function num(v, d) { v = Number(v); return Number.isFinite(v) ? v : d; }

  function parseManual(s) {
    if (Array.isArray(s)) return s.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    return String(s || '').split(/[\s,;]+/).filter(t => t !== '').map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  }

  // ---- derived dimensions (no CSG needed) -----------------------------------
  function derive(user) {
    const p = Object.assign({}, DEFAULTS, user || {});
    for (const k of Object.keys(DEFAULTS)) if (typeof DEFAULTS[k] === 'number') p[k] = num(p[k], DEFAULTS[k]);
    // axial = the same single-axis matrix as sagittal, with the brain turned on its side:
    // the dorsal-ventral axis runs along X (dorsal +X), so blades from above cut axial planes
    const orient = p.axis === 'axial' ? 'axial' : null;
    if (orient) { p.axis = 'sagittal'; p.hemisphere = 'whole'; }
    const preset = p.specimen === 'custom'
      ? { w: p.custom_width, l: p.custom_length, h: p.custom_height }
      : PRESETS[p.specimen] || PRESETS.human;
    const sliding = p.mode === 'sliding';
    if (sliding) p.hemisphere = 'whole';
    const baseUser = p.base;
    if (sliding && p.axis !== 'axial') p.base = Math.max(p.base, p.rod_d + p.rod_clearance + 8);
    const k = p.size_scale / 100;
    const sp = orient ? { w: preset.h * k, l: preset.l * k, h: preset.w * k } : { w: preset.w * k, l: preset.l * k, h: preset.h * k };
    const d = { p, sp, orient, sliding, baseRaised: p.base > baseUser + 1e-9, baseUser };
    d.Wc = sp.w + 2 * p.clearance;
    d.Lc = sp.l + 2 * p.clearance;
    d.depth = sp.h * p.depth_fraction / 100 + p.clearance;
    d.a_b = d.Wc / 2;
    d.a_f = d.a_b * p.frontal_width_ratio / 100;
    d.b_b = d.Lc * p.occipital_length_pct / 100;
    d.b_f = d.Lc * p.frontal_length_pct / 100;
    d.cy_b = -d.Lc / 2 + d.b_b;
    d.cy_f = d.Lc / 2 - d.b_f;
    d.cx_lo = p.hemisphere === 'right' ? 0 : -d.a_b;
    d.cx_hi = p.hemisphere === 'left' ? 0 : d.a_b;
    d.z_slot = p.base;
    d.z_cav = p.base + (p.axis === 'axial' ? 0 : p.slot_overshoot);
    d.H = d.z_cav + d.depth;
    // cavity profile: a half-ellipsoid of semi-depth cz centred zE above the floor, with straight walls above it.
    // Upright brains are widest near the rim (zE = H). A brain on its side (axial) is widest at mid-width, so its
    // rounded bottom is only half the specimen width deep and the walls run straight up from there.
    d.cz = d.depth; d.zE = d.H;
    if (orient) { d.cz = Math.min(d.depth, sp.h / 2 + p.clearance); d.zE = d.H - (d.depth - d.cz); }
    // light style: only the walls that carry blade slots (the rails) keep full thickness.
    //   coronal slots span X -> rails are the X sides; sagittal / axial slots span Y -> rails are the Y ends
    const light = p.style === 'light';
    d.light = light;
    d.wX = light && p.axis !== 'coronal' ? p.end_wall : p.wall;
    d.wY = light && p.axis === 'coronal' ? p.end_wall : p.wall;
    d.bx0 = d.cx_lo - d.wX; d.bx1 = d.cx_hi + d.wX;
    d.by0 = -d.Lc / 2 - d.wY; d.by1 = d.Lc / 2 + d.wY;
    if (light) {
      // 45-degree-or-less lean planes through the rim, pushed out just far enough to stay clear of the bowl
      const t = Math.tan(Math.min(45, Math.max(0, p.taper)) * Math.PI / 180), A = d.a_b + p.shell, C = d.depth + p.shell, tc = t * C;
      d.t = t;
      const tcz = t * (d.cz + p.shell), up = t * (d.H - d.zE);     // axial: planes also clear the straight walls above the bowl
      d.cXp = Math.max(d.bx1, up + Math.hypot(A, tcz)); d.cXn = Math.max(-d.bx0, up + Math.hypot(A, tcz));
      d.cYp = Math.max(d.by1, up + d.cy_f + Math.hypot(d.b_f + p.shell, tcz));
      d.cYn = Math.max(-d.by0, up - d.cy_b + Math.hypot(d.b_b + p.shell, tcz));
    }
    d.Wb = d.bx1 - d.bx0; d.Lb = d.by1 - d.by0;
    d.xc = (d.bx0 + d.bx1) / 2;
    return d;
  }

  // ---- cut positions ---------------------------------------------------------
  // lo..hi is the usable range along the slicing axis; mode: hi | lo | centre | straddle
  function makeCuts(lo, hi, pitch, mode, phase, margin, anchor) {
    const out = [];
    if (!(pitch > 0)) return out;
    const c = anchor === undefined ? 0 : anchor;
    for (let k = -2000; k <= 2000; k++) {
      let q;
      if (mode === 'hi') q = hi + k * pitch;
      else if (mode === 'lo') q = lo + k * pitch;
      else if (mode === 'centre') q = c + k * pitch;
      else q = c + (k + 0.5) * pitch;
      q += phase;
      if (q > lo + margin && q < hi - margin) out.push(q);
    }
    // a cut exactly at the range end (k = 0 in hi/lo mode) is removed by the margin test
    return out.sort((a, b) => a - b);
  }

  function axisRange(d) {
    const p = d.p;
    if (p.axis === 'coronal') return [-d.Lc / 2, d.Lc / 2];
    if (p.axis === 'sagittal') return [d.cx_lo, d.cx_hi];
    return [d.z_cav, d.H];
  }

  function computeCuts(d) {
    const p = d.p;
    const [lo, hi] = axisRange(d);
    const man = parseManual(p.manual);
    if (man.length) {
      const off = p.axis === 'axial' ? d.z_cav : 0;      // axial manual cuts = height above cavity bottom
      return man.map(v => v + off).filter(v => v > lo && v < hi);
    }
    return makeCuts(lo, hi, p.thickness, p.datum, p.phase, 1.0, p.axis === 'axial' ? 0.5 * (lo + hi) : 0);
  }

  // cells between cuts, clipped to the cavity range; index 1.. numbered from the "start" end
  function computeCells(d, cuts) {
    const [lo, hi] = axisRange(d);
    const edges = [lo].concat(cuts, [hi]);
    const cells = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const gapL = i === 0 ? 0 : d.p.slot_width / 2, gapH = i === edges.length - 2 ? 0 : d.p.slot_width / 2;
      cells.push({ lo: edges[i], hi: edges[i + 1], thick: edges[i + 1] - edges[i] - gapL - gapH });
    }
    // numbering start: coronal -> frontal end unless datum lo; sagittal -> left end unless datum hi;
    // axial -> top (dorsal) unless datum lo
    const fromHigh = d.p.axis === 'sagittal' ? d.p.datum === 'hi' : d.p.datum !== 'lo';
    cells.forEach((c, i) => { c.n = fromHigh ? cells.length - i : i + 1; });
    return cells;
  }


  // ---- 5x7 bitmap font for engraved labels (A-Z, 0-9 and common punctuation) ---------------------
  const FONT = {
    '0': ['01110','10001','10011','10101','11001','10001','01110'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00010','00100','01000','11111'],
    '3': ['11110','00001','00001','01110','00001','00001','11110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'],
    '5': ['11111','10000','11110','00001','00001','10001','01110'],
    '6': ['00110','01000','10000','11110','10001','10001','01110'],
    '7': ['11111','00001','00010','00100','01000','01000','01000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'],
    '9': ['01110','10001','10001','01111','00001','00010','01100'],
    'A': ['01110','10001','10001','11111','10001','10001','10001'],
    'D': ['11110','10001','10001','10001','10001','10001','11110'],
    'V': ['10001','10001','10001','10001','10001','01010','00100'],
    'P': ['11110','10001','10001','11110','10000','10000','10000'],
    'B': ['11110','10001','10001','11110','10001','10001','11110'],
    'C': ['01110','10001','10000','10000','10000','10001','01110'],
    'E': ['11111','10000','10000','11110','10000','10000','11111'],
    'F': ['11111','10000','10000','11110','10000','10000','10000'],
    'G': ['01110','10001','10000','10111','10001','10001','01111'],
    'H': ['10001','10001','10001','11111','10001','10001','10001'],
    'I': ['01110','00100','00100','00100','00100','00100','01110'],
    'J': ['00111','00010','00010','00010','00010','10010','01100'],
    'K': ['10001','10010','10100','11000','10100','10010','10001'],
    'L': ['10000','10000','10000','10000','10000','10000','11111'],
    'M': ['10001','11011','10101','10101','10001','10001','10001'],
    'N': ['10001','11001','10101','10011','10001','10001','10001'],
    'O': ['01110','10001','10001','10001','10001','10001','01110'],
    'Q': ['01110','10001','10001','10001','10101','10010','01101'],
    'R': ['11110','10001','10001','11110','10100','10010','10001'],
    'S': ['01111','10000','10000','01110','00001','00001','11110'],
    'T': ['11111','00100','00100','00100','00100','00100','00100'],
    'U': ['10001','10001','10001','10001','10001','10001','01110'],
    'W': ['10001','10001','10001','10101','10101','11011','10001'],
    'X': ['10001','10001','01010','00100','01010','10001','10001'],
    'Y': ['10001','10001','01010','00100','00100','00100','00100'],
    'Z': ['11111','00001','00010','00100','01000','10000','11111'],
    ' ': ['00000','00000','00000','00000','00000','00000','00000'],
    '.': ['00000','00000','00000','00000','00000','01100','01100'],
    ',': ['00000','00000','00000','00000','01100','00100','01000'],
    '-': ['00000','00000','00000','11111','00000','00000','00000'],
    '_': ['00000','00000','00000','00000','00000','00000','11111'],
    '/': ['00001','00010','00010','00100','01000','01000','10000'],
    ':': ['00000','01100','01100','00000','01100','01100','00000'],
    ';': ['00000','01100','01100','00000','01100','00100','01000'],
    '+': ['00000','00100','00100','11111','00100','00100','00000'],
    '(': ['00010','00100','01000','01000','01000','00100','00010'],
    ')': ['01000','00100','00010','00010','00010','00100','01000'],
    '#': ['01010','01010','11111','01010','11111','01010','01010'],
    '%': ['11000','11001','00010','00100','01000','10011','00011'],
    '=': ['00000','00000','11111','00000','11111','00000','00000'],
    '!': ['00100','00100','00100','00100','00100','00000','00100'],
    '?': ['01110','10001','00001','00010','00100','00000','00100'],
    "'": ['00100','00100','01000','00000','00000','00000','00000'],
    '*': ['00000','10101','01110','11111','01110','10101','00000'],
    '<': ['00010','00100','01000','10000','01000','00100','00010'],
    '>': ['01000','00100','00010','00001','00010','00100','01000'],
  };

  // rectangles [x, y, w, h] in text-local coordinates (x right, y up), centred on the origin
  function textRects(str, px) {
    const rects = [];
    const total = str.length * 6 - 1;                 // glyph 5 wide + 1 gap
    for (let ci = 0; ci < str.length; ci++) {
      const g = FONT[str[ci]]; if (!g) continue;
      for (let r = 0; r < 7; r++) {
        let c = 0;
        while (c < 5) {
          if (g[r][c] === '1') {
            let e = c; while (e + 1 < 5 && g[r][e + 1] === '1') e++;
            rects.push([(ci * 6 + c - total / 2) * px, (3.5 - r - 1) * px, (e - c + 1) * px, px]);
            c = e + 1;
          } else c++;
        }
      }
    }
    return { rects, width: total * px, height: 7 * px };
  }

  // ---- STL writer -------------------------------------------------------------
  function toSTL(mesh) {
    const vp = mesh.vertProperties, np = mesh.numProp, tv = mesh.triVerts, n = tv.length / 3;
    const buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
    dv.setUint32(80, n, true);
    let o = 84;
    for (let t = 0; t < n; t++) {
      const i0 = tv[3 * t] * np, i1 = tv[3 * t + 1] * np, i2 = tv[3 * t + 2] * np;
      const ux = vp[i1] - vp[i0], uy = vp[i1 + 1] - vp[i0 + 1], uz = vp[i1 + 2] - vp[i0 + 2];
      const vx = vp[i2] - vp[i0], vy = vp[i2 + 1] - vp[i0 + 1], vz = vp[i2 + 2] - vp[i0 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      for (const i of [i0, i1, i2]) { o += 12; dv.setFloat32(o, vp[i], true); dv.setFloat32(o + 4, vp[i + 1], true); dv.setFloat32(o + 8, vp[i + 2], true); }
      o += 14;
    }
    return buf;
  }

  // ---- the build --------------------------------------------------------------
  function build(wasm, user) {
    const { Manifold, CrossSection } = wasm;
    const d = derive(user), p = d.p;
    const cuts = computeCuts(d), cells = computeCells(d, cuts);
    const seg = Math.max(16, Math.round(p.quality));
    const axial = p.axis === 'axial', cor = p.axis === 'coronal', sag = p.axis === 'sagittal';
    const warnings = [];
    const sliding = d.sliding;
    // axial sliding: the halves part in the middle of the slab nearest mid-depth
    let splitZ = null, splitCell = null;
    if (sliding && axial) {
      const mid = (d.z_cav + d.H) / 2;
      cells.forEach(c => { if (!splitCell || Math.abs((c.lo + c.hi) / 2 - mid) < Math.abs((splitCell.lo + splitCell.hi) / 2 - mid)) splitCell = c; });
      splitZ = splitCell ? (splitCell.lo + splitCell.hi) / 2 : mid;
    }
    if (sliding && d.baseRaised) warnings.push('Base raised from ' + d.baseUser.toFixed(1) + ' to ' + p.base.toFixed(1) + ' mm so the rod bores keep material above and below.');

    const gaps = cuts.slice(1).map((c, i) => c - cuts[i]);
    const gmin = gaps.length ? Math.min.apply(null, gaps) : 1e9;
    const lead = axial ? 0 : gmin > 1e8 ? p.lead_in : Math.max(0, Math.min(p.lead_in, (gmin - p.slot_width) / 4));
    if (!axial && lead < p.lead_in - 1e-9) warnings.push('Lead-in reduced to ' + lead.toFixed(2) + ' mm so the wall tops between slots stay intact.');
    if (gmin < 1e8 && gmin - p.slot_width < (axial ? 4 : 8)) warnings.push('Walls between slots are thinner than ' + (axial ? 4 : 8) + ' mm and will be fragile.');
    if (!cuts.length) warnings.push('No cuts fall inside the specimen range. Check slice thickness, datum and manual positions.');
    if (axial && p.wall - p.blade_margin < 6) warnings.push('End walls are only ' + (p.wall - p.blade_margin).toFixed(1) + ' mm thick (wall - blade margin). The plates may separate. Raise wall or lower blade margin.');
    if (axial && p.depth_fraction < 100) warnings.push('Cavity is shallower than the specimen. The top ' + (d.sp.h * (1 - p.depth_fraction / 100)).toFixed(0) + ' mm sits above the rim and cannot be sliced. Raise depth fraction to 100 or more.');
    if (d.Wb > 250 || d.Lb > 250) warnings.push('Block is ' + d.Wb.toFixed(0) + ' x ' + d.Lb.toFixed(0) + ' mm. Check it fits your print bed (diagonal placement gains ~40 mm).');

    // block: rounded rectangle, small bottom chamfer against elephant foot
    const r = Math.max(0, Math.min(p.corner_radius, d.Wb / 2 - 0.5, d.Lb / 2 - 0.5));
    let outline = CrossSection.square([d.Wb - 2 * r, d.Lb - 2 * r], true);
    if (r > 0) outline = outline.offset(r, 'Round', 2, 48);
    outline = outline.translate([d.xc, 0]);
    const ch = Math.max(0, Math.min(p.chamfer, 3, d.H / 4));
    const main = outline.extrude(d.H - ch).translate([0, 0, ch]);
    const block = ch > 0 ? Manifold.hull([outline.offset(-ch, 'Round', 2, 48).extrude(0.01), main]) : main;

    // light style: lean the outer walls toward the bed (never more than `taper` degrees from vertical, so no supports)
    let env = block;
    if (d.light && d.t > 0) {
      const BIG = 2000, th = Math.atan(d.t) * 180 / Math.PI, H = d.H;
      const cube = (x, y, z) => Manifold.cube([BIG, BIG, BIG]).translate([x, y, z]);
      env = block.intersect(cube(-BIG, -BIG / 2, -BIG / 2).rotate([0, th, 0]).translate([d.cXp, 0, H]))
        .intersect(cube(0, -BIG / 2, -BIG / 2).rotate([0, -th, 0]).translate([-d.cXn, 0, H]))
        .intersect(cube(-BIG / 2, -BIG, -BIG / 2).rotate([-th, 0, 0]).translate([0, d.cYp, H]))
        .intersect(cube(-BIG / 2, 0, -BIG / 2).rotate([th, 0, 0]).translate([0, -d.cYn, H]));
    }

    // cavity: hull of an occipital and a frontal half-ellipsoid, equators at the rim
    const ell = (a, b, cy) => Manifold.sphere(1, seg).scale([a, b, d.cz]).translate([0, cy, d.zE]);
    const hs = [ell(d.a_b, d.b_b, d.cy_b), ell(d.a_f, d.b_f, d.cy_f)];
    if (d.H - d.zE > 1e-6) {          // straight walls above the widest level (brain on its side)
      const cyl = (a, b, cy) => Manifold.cylinder(d.H - d.zE + 1, 1, 1, seg).scale([a, b, 1]).translate([0, cy, d.zE]);
      hs.push(cyl(d.a_b, d.b_b, d.cy_b), cyl(d.a_f, d.b_f, d.cy_f));
    }
    let cav = Manifold.hull(hs);
    if (p.hemisphere !== 'whole')
      cav = cav.intersect(Manifold.cube([1000, 2000, 1000]).translate([p.hemisphere === 'right' ? 0 : -1000, -1000, 0]));

    // blade slots
    const slots = [];
    if (axial) {
      const ylen = 2 * (d.Lc / 2 + p.blade_margin);
      for (const z of cuts) slots.push(Manifold.cube([d.Wb + 20, ylen, p.slot_width], true).translate([d.xc, 0, z]));
    } else {
      const w2 = p.slot_width / 2, zt = d.H;
      const mkAt = (z0, len) => {
        const pts = [[-w2, z0], [w2, z0], [w2, zt - lead], [w2 + lead + 1, zt + 1], [-w2 - lead - 1, zt + 1], [-w2, zt - lead]];
        return CrossSection.ofPolygons([pts]).extrude(len).rotate([90, 0, 0]).translate([0, len / 2, 0]);
      };
      // light style: each slot stops just below the bowl at its own position, so a continuous web under the
      // slots holds every slab together even where the outer walls have been trimmed away
      const prof = sag
        ? (c => (d.H - d.zE) + d.cz * Math.sqrt(Math.max(0, 1 - Math.pow(c / d.a_b, 2))))
        : (c => {
            if (c >= d.cy_b && c <= d.cy_f) return d.depth;
            const cy = c < d.cy_b ? d.cy_b : d.cy_f, bb = c < d.cy_b ? d.b_b : d.b_f;
            return (d.H - d.zE) + d.cz * Math.sqrt(Math.max(0, 1 - Math.pow((c - cy) / bb, 2)));
          });
      const z0of = c => d.light ? Math.max(d.z_slot, Math.min(d.H - 6, d.H - prof(c) - p.slot_overshoot)) : d.z_slot;
      if (sag) { for (const x of cuts) slots.push(mkAt(z0of(x), d.Lb + 20).translate([x, 0, 0])); }
      else { for (const y of cuts) slots.push(mkAt(z0of(y), d.Wb + 20).rotate([0, 0, 90]).translate([d.xc, y, 0])); }
    }

    // fixative drain holes through the base: regular grid inside the cavity footprint
    const drains = [];
    if (p.drain_d > 0) {
      const S = Math.max(p.drain_d * 3, p.drain_spacing), hh = d.z_cav + d.cz * 0.5 + 1;
      const clear = p.drain_d / 2 + p.slot_width / 2 + 1.5;
      for (let y = -Math.floor(d.Lc / 2 / S) * S; y <= d.Lc / 2; y += S)
        for (let x = Math.ceil(d.cx_lo / S) * S; x <= d.cx_hi; x += S) {
          const rho2 = Math.pow(x / d.a_b, 2) + Math.pow(y / (d.Lc / 2), 2);
          if (rho2 >= 0.4) continue;
          if (cor && cuts.some(c => Math.abs(c - y) < clear)) continue;
          if (sag && cuts.some(c => Math.abs(c - x) < clear)) continue;
          drains.push(Manifold.cylinder(hh, p.drain_d / 2, p.drain_d / 2, 20, false).translate([x, y, -1]));
        }
    }

    // engraved labels
    const eng = [];
    const place = (rects, face, cx, cy, cz) => {          // boxes cut into a face; depth = label_depth
      const dp = p.label_depth;
      for (const r0 of rects) {
        // grow each pixel slightly so diagonal neighbours overlap (corner-only contact makes a pinched, non-manifold edge)
        const e = 0.1 * (r0[3]), tx = r0[0] - e, ty = r0[1] - e, w = r0[2] + 2 * e, h = r0[3] + 2 * e;
        let c0, sz;
        if (face === 'top')   { c0 = [cx + tx, cy + ty, d.H - dp]; sz = [w, h, dp + 1]; }
        else if (face === 'yp') { c0 = [cx - tx - w, d.by1 - dp, cz + ty]; sz = [w, dp + 1, h]; }
        else if (face === 'ym') { c0 = [cx + tx, d.by0 - 1, cz + ty]; sz = [w, dp + 1, h]; }
        else if (face === 'xp') { c0 = [d.bx1 - dp, cy + tx, cz + ty]; sz = [dp + 1, w, h]; }
        else                    { c0 = [d.bx0 - 1, cy - tx - w, cz + ty]; sz = [dp + 1, w, h]; }
        eng.push(Manifold.cube(sz).translate(c0));
      }
    };
    if (p.labels) {
      const slotM = p.slot_width / 2 + lead;
      for (const c of cells) {
        const lo = Math.max(c.lo, axisLo(d)), hi = Math.min(c.hi, axisHi(d));
        const first = c === cells[0], last = c === cells[cells.length - 1];
        const flat = (hi - lo) - (first ? 0 : slotM) - (last ? 0 : slotM);
        const mid = (lo + hi) / 2 + ((first ? 1 : 0) - (last ? 1 : 0)) * 0;     // clipped cell centre
        const txt = String(c.n), nd = txt.length;
        if (cor) {
          const px = Math.min(1.0, flat * 0.65 / 7, p.wall * 0.8 / (6 * nd));
          if (px < 0.5 || flat < 4) continue;
          const t = textRects(txt, px);
          place(t.rects, 'top', d.cx_hi + p.wall / 2, mid, 0);
          place(t.rects, 'top', d.cx_lo - p.wall / 2, mid, 0);
        } else if (sag) {
          const px = Math.min(1.0, flat * 0.8 / (6 * nd), p.wall * 0.6 / 7);
          if (px < 0.5 || flat < 4) continue;
          const t = textRects(txt, px);
          place(t.rects, 'top', mid, d.Lc / 2 + p.wall / 2, 0);
          place(t.rects, 'top', mid, -d.Lc / 2 - p.wall / 2, 0);
        } else {
          const h = Math.min(8, 0.7 * c.thick, 7 * 1.0), px = h / 7;
          if (px < 0.55 || d.H - 1 < mid) continue;
          if (sliding && c === splitCell) continue;                          // the split passes through this slab
          const t = textRects(txt, px);
          place(t.rects, 'xp', 0, 0, mid);
          place(t.rects, 'xm', 0, 0, mid);
        }
      }
    }
    if (p.marks) {                                          // A anterior, P posterior (and D / V for axial)
      const px = Math.min(1.6, d.H * 0.3 / 7);
      if (d.light) {                                        // outer faces lean, so engrave on the flat top instead
        const pe = Math.min(1.6, p.end_wall * 0.6 / 7);
        if (cor) {
          const xm = sliding ? d.a_b / 2 : d.xc;
          place(textRects('A', pe).rects, 'top', xm, d.Lc / 2 + p.end_wall / 2, 0);
          place(textRects('P', pe).rects, 'top', xm, -d.Lc / 2 - p.end_wall / 2, 0);
        } else {
          const xm = d.cx_hi + d.wX / 2;
          place(textRects('A', pe).rects, 'top', xm, d.Lc / 2 + p.wall / 2, 0);
          place(textRects('P', pe).rects, 'top', xm, -d.Lc / 2 - p.wall / 2, 0);
        }
      } else {
        let zc = d.H * 0.55, mx = d.xc;
        if (sliding && cor) mx = d.bx1 / 2;                                   // keep the marks clear of the split (x = 0)
        place(textRects('A', px).rects, 'yp', mx, 0, zc);
        place(textRects('P', px).rects, 'ym', mx, 0, zc);
      }
      if (d.orient) {                                          // D / V on the end walls of the dorsal-ventral axis
        const pd = Math.min(1.6, d.wX * 0.6 / 7);
        const yd = sliding ? (p.latch === 'top' ? p.latch_inset + p.latch_bar_w + 4 : 10) : 0;   // sliding: clear of the split and latch
        place(textRects('D', pd).rects, 'top', d.cx_hi + d.wX / 2, yd, 0);
        place(textRects('V', pd).rects, 'top', d.cx_lo - d.wX / 2, yd, 0);
      }
    }


    // ---- free-text notes engraved on the side walls (+Y front, -Y back, +X, -X) ----
    {
      const th = d.light && d.t > 0 ? Math.atan(d.t) * 180 / Math.PI : 0;
      const SPEC = {            // base rotation (local u,v,n -> reading direction, up, outward) and tilt for a leaning wall
        yp: { key: 'note_front', rot: [90, 0, 180], tilt: a => [-a, 0, 0], c: d.cYp, b: d.by1, sgn: 1, axis: 'y', slot: sag, name: 'front (+Y)' },
        ym: { key: 'note_back',  rot: [90, 0, 0],   tilt: a => [a, 0, 0],  c: d.cYn, b: -d.by0, sgn: -1, axis: 'y', slot: sag, name: 'back (-Y)' },
        xp: { key: 'note_xp',    rot: [90, 0, 90],  tilt: a => [0, a, 0],  c: d.cXp, b: d.bx1, sgn: 1, axis: 'x', slot: cor, name: '+X' },
        xm: { key: 'note_xm',    rot: [90, 0, 270], tilt: a => [0, -a, 0], c: d.cXn, b: -d.bx0, sgn: -1, axis: 'x', slot: cor, name: '-X' },
      };
      const rr = r, zmin = Math.max(ch + 2, 3);
      const bad = new Set();
      for (const f of ['yp', 'ym', 'xp', 'xm']) {
        const S = SPEC[f], raw = String(p[S.key] || '');
        if (!raw.trim()) continue;
        const lines = raw.toUpperCase().split('|').map(x => x.trim());
        while (lines.length && !lines[lines.length - 1]) lines.pop();
        if (!lines.length) continue;
        lines.forEach(l => { for (const chr of l) if (!FONT[chr]) bad.add(chr); });
        // vertical zone available on this wall
        let zlo = zmin, zhi = d.H - 3;
        if (S.slot) {                                            // wall carries blade slots: only the solid band under them
          zhi = sliding ? d.z_slot / 2 - p.rod_d / 2 - 1 : d.z_slot - 2;
        } else {
          if (sliding) zlo = Math.max(zlo, d.z_slot / 2 + p.rod_d / 2 + 2);
          if (!d.light && p.marks && (f === 'yp' || f === 'ym')) zhi = Math.min(zhi, d.H * 0.55 - Math.min(11.2, d.H * 0.3) / 2 - 2);
        }
        // leaning wall: choose the larger of the leaning part and the vertical part (never straddle the kink)
        let lean = false;
        const zK = th > 0 ? d.H - (S.c - S.b) / d.t : -1e9;
        if (th > 0 && zK > zlo) {
          const leanH = Math.min(zhi, zK - 1) - zlo, vertH = zhi - Math.max(zlo, zK + 1);
          if (leanH >= vertH) { lean = true; zhi = Math.min(zhi, zK - 1); } else zlo = Math.max(zlo, zK + 1);
        }
        const Z = zhi - zlo;
        // reading-direction extent
        let u0, u1;
        if (S.axis === 'y') {                                    // wall runs along X
          u0 = d.bx0 + rr + 2; u1 = d.bx1 - rr - 2;

        } else { u0 = d.by0 + rr + 2; u1 = d.by1 - rr - 2; }
        if (sliding && (cor ? S.axis === 'y' : S.axis === 'x'))      // this wall crosses the split: keep the text in one half, clear of any side latch
          u0 = p.latch === 'side' ? p.latch_inset + p.latch_gap / 2 + p.latch_bar_w / 2 + 3 : 2;
        const U = u1 - u0, nL = lines.length, maxc = Math.max.apply(null, lines.map(l => l.length));
        const Hpx = 7 * nL + 2 * (nL - 1), Wpx = 6 * maxc - 1;
        const px0 = p.note_height / 7;
        const px = Math.min(px0, U / Wpx, Z / Hpx);
        if (!(px >= 0.5) || Wpx <= 0) {
          warnings.push('No room for the ' + S.name + ' note' + (S.slot ? ' (this wall carries the blade slots, so text only fits in the base band under them; use the other two walls)' : '') + '.');
          continue;
        }
        if (px < px0 - 1e-6) warnings.push('The ' + S.name + ' note was shrunk to ' + (7 * px).toFixed(1) + ' mm letter height to fit.');
        const uc = (u0 + u1) / 2;
        const zc = zlo + Hpx * px / 2 + Math.max(0, Math.min(100, p.note_pos)) / 100 * (Z - Hpx * px);
        // text in local coordinates: x = reading direction, y = up the wall, z = outward normal
        const dp = p.label_depth, boxes = [];
        lines.forEach((l, i) => {
          if (!l) return;
          const t = textRects(l, px), dy = (Hpx / 2 - 3.5 - i * 9) * px;
          for (const q of t.rects) {
            const e = 0.1 * q[3];
            boxes.push(Manifold.cube([q[2] + 2 * e, q[3] + 2 * e, dp + 1]).translate([q[0] - e, q[1] + dy - e, -dp]));
          }
        });
        if (!boxes.length) continue;
        const face = (c, b, z) => (lean ? Math.min(b, c - d.t * (d.H - z)) : b);
        const off = S.sgn * face(S.c, S.b, zc);
        let g = Manifold.union(boxes).rotate(S.rot);
        if (lean) g = g.rotate(S.tilt(th));
        const pos = S.axis === 'y' ? [uc, off, zc] : [off, uc, zc];
        eng.push(g.translate(pos));
      }
      if (bad.size) warnings.push('Characters not in the engraving font were skipped: ' + Array.from(bad).join(' ') + '  (letters, digits and . , - _ / : ; + ( ) # % = ! ? \' * < > are supported).');
    }

    let solid = env.subtract(cav);
    if (slots.length) solid = solid.subtract(Manifold.union(slots));
    if (drains.length) solid = solid.subtract(Manifold.union(drains));
    if (eng.length) solid = solid.subtract(Manifold.union(eng));

    const info = {
      axis: d.orient || p.axis, mode: p.mode, block: { w: d.Wb, l: d.Lb, h: d.H },
      specimen: d.sp, cavity: { w: d.Wc, l: d.Lc, depth: d.depth },
      cuts, cells, thickness: p.thickness, slices: cells.length,
      slotWidth: p.slot_width, warnings,
      ellipsoids: { a_b: d.a_b, b_b: d.b_b, cy_b: d.cy_b, a_f: d.a_f, b_f: d.b_f, cy_f: d.cy_f, depth: d.depth, H: d.H },
      cx: [d.cx_lo, d.cx_hi],
    };
    if (d.light) {
      const zf = 0, xf = Math.min(d.bx1, d.cXp - d.t * (d.H - zf)) + Math.min(-d.bx0, d.cXn - d.t * (d.H - zf));
      const yf = Math.min(d.by1, d.cYp - d.t * (d.H - zf)) + Math.min(-d.by0, d.cYn - d.t * (d.H - zf));
      info.foot = { w: Math.max(0, xf), l: Math.max(0, yf) };
      if (Math.min(info.foot.w, info.foot.l) < 40) warnings.push('The footprint on the bed is only ' + info.foot.w.toFixed(0) + ' x ' + info.foot.l.toFixed(0) + ' mm. Use a brim, or lower the taper angle.');
    }
    if (!sliding) { info.volume = solid.volume() / 1000; return { solid, info, parts: null }; }
    return { solid: null, info, parts: slidingParts(wasm, d, solid, info, { seg, splitZ, splitCell }) };
  }

  // ---- sliding-rod assembly: two halves, guide rods, end brackets ------------
  function slidingParts(wasm, d, solid, info, o) {
    const { Manifold, CrossSection } = wasm, p = d.p, W = info.warnings, seg = o.seg;
    const axial = p.axis === 'axial';
    const rb = (p.rod_d + p.rod_clearance) / 2, rs = (p.rod_d + p.socket_clearance) / 2, sd = p.socket_depth;
    const bt = Math.max(p.bracket_thickness, sd + 3), bw = p.rod_d + 8;
    if (bt > p.bracket_thickness) W.push('Bracket thickness raised to ' + bt + ' mm to hold a ' + sd + ' mm socket.');
    const cylX = (r, len) => Manifold.cylinder(len, r, r, seg).rotate([0, 90, 0]);   // along +X
    const sb = (bb) => { const m = bb.max, n = bb.min; return [m[0] - n[0], m[1] - n[1], m[2] - n[2]]; };
    const parts = [], sl = { kind: axial ? 'axial' : 'lateral', rodD: p.rod_d, rodCount: 2, bom: [] };
    let rodL, gmax, g, rodAsm = [], bracketPrint, bracketAsm = [], halfL, halfR, asmL, asmR, rodPos;

    const swap = !axial && p.axis === 'sagittal';      // sagittal and axial split front | back so the split is never parallel to the slices
    const xc0 = d.xc;
    if (swap) {                                        // work in a frame where the split plane is x = 0 and the rods run along X
      const d0 = d;
      d = Object.assign({}, d0, {
        bx0: -d0.by1, bx1: -d0.by0, by0: d0.bx0 - xc0, by1: d0.bx1 - xc0,
        cXp: d0.cYn, cXn: d0.cYp, cYp: d0.cXp - xc0, cYn: d0.cXn + xc0,
        Wb: d0.Lb, Lb: d0.Wb, Lc: d0.cx_hi - d0.cx_lo, xc: 0, wallTop: d0.wX });
      solid = solid.translate([-xc0, 0, 0]).rotate([0, 0, 90]);
    } else d = Object.assign({}, d, { wallTop: d.wY });
    if (!axial) {
      const BIG = 2000, Wh = d.bx1;                                   // closed width of one half
      const zr = p.base / 2;
      const xEdge = z => d.light ? Math.min(d.bx1, Math.min(d.cXp, d.cXn) - d.t * (d.H - z)) : d.bx1;      // half width of one half at height z
      const yEdge = z => d.light ? Math.min(Math.min(d.by1, -d.by0), Math.min(d.cYp, d.cYn) - d.t * (d.H - z)) : Math.min(d.by1, -d.by0);
      let yr, Whb, lockSpan;
      if (d.light) {
        yr = yEdge(zr - rb) - rb - 3.5;                                // rods sit inside the narrow foot
        Whb = xEdge(zr + bw / 2);                                      // where the end bracket meets the leaning face
        lockSpan = xEdge(zr - rb) - 3;
        if (yr < 15) { W.push('The foot is too narrow for two rods (only ' + (2 * Math.max(yr, 0)).toFixed(0) + ' mm apart). Lower the taper angle or raise the base.'); yr = Math.max(yr, 15); }
      } else {
        const e = Math.max(p.rod_y_from_edge, rb + 3);
        yr = d.Lb / 2 - e; Whb = Wh; lockSpan = Wh;
        if (e > p.rod_y_from_edge + 1e-9) W.push('Rod distance from the end face raised to ' + e.toFixed(1) + ' mm so the bore stays inside the wall.');
        if (yr < d.Lc / 2 - 5) W.push('Rods sit under the cavity. Lower the rod distance from the end face or thicken the walls.');
      }
      rodL = p.rod_auto ? 2 * (Whb + p.max_gap / 2) + 2 * sd : p.rod_length;
      gmax = p.rod_auto ? p.max_gap : rodL - 2 * sd - 2 * Whb;
      if (gmax < 0) { W.push('The rod is ' + (-gmax).toFixed(0) + ' mm too short to carry both halves and the brackets. Lengthen it to at least ' + (2 * Whb + 2 * sd).toFixed(0) + ' mm.'); gmax = 0; }
      g = Math.max(0, Math.min(p.gap, gmax));
      // teardrop bores: a 45-degree roof over each rod hole so it prints without supports
      const a45 = rb / Math.SQRT2, roof = CrossSection.ofPolygons([[[-a45, a45 - 0.25], [a45, a45 - 0.25], [0, 2 * a45]]]).extrude(2 * Wh + 4).rotate([0, 0, 90]).rotate([0, 90, 0]);
      const bores = Manifold.union([-yr, yr].map(y => Manifold.union([cylX(rb, 2 * Wh + 4), roof]).translate([-Wh - 2, y, zr])));
      let whole = solid.subtract(bores);
      if (p.lock_screws && p.lock_pilot > 0) {
        const rl = p.lock_pilot / 2, len = d.Lb / 2 + 1 - yr, lx = p.lock_x_pct / 100 * lockSpan, hs = [];
        for (const x of [-lx, lx]) {
          hs.push(Manifold.cylinder(len, rl, rl, 20).rotate([-90, 0, 0]).translate([x, yr, zr]));
          hs.push(Manifold.cylinder(len, rl, rl, 20).rotate([90, 0, 0]).translate([x, -yr, zr]));
        }
        whole = whole.subtract(Manifold.union(hs));
      }
      halfR = whole.intersect(Manifold.cube([BIG, BIG, BIG]).translate([0, -BIG / 2, -BIG / 2]));
      halfL = whole.intersect(Manifold.cube([BIG, BIG, BIG]).translate([-BIG, -BIG / 2, -BIG / 2]));
      asmR = halfR.translate([g / 2, 0, 0]); asmL = halfL.translate([-g / 2, 0, 0]);
      // rods: lying along X for printing; in place for the preview
      const rodPrint = cylX(p.rod_d / 2, rodL).translate([0, 0, p.rod_d / 2]);
      rodAsm = [-yr, yr].map(y => cylX(p.rod_d / 2, rodL).translate([-rodL / 2, y, zr]));
      // bracket: a bar joining the two rods, sockets open upward for printing
      const span = 2 * yr;
      bracketPrint = Manifold.cube([span + bw, bw, bt]).translate([-(span + bw) / 2, -bw / 2, 0])
        .subtract(Manifold.union([-yr, yr].map(x => Manifold.cylinder(sd + 1, rs, rs, seg).translate([x, 0, bt - sd]))));
      const xin = Whb + gmax / 2;
      bracketAsm = [
        bracketPrint.rotate([0, 0, 90]).rotate([0, 90, 0]).translate([-xin - bt, 0, zr]),
        bracketPrint.rotate([0, 0, 90]).rotate([0, -90, 0]).translate([xin + bt, 0, zr]),
      ];
      // ---- latch: two posts per wall (one on each half) and a bar that snaps over them ----
      let latchPart = null;
      if (p.latch === 'top' || p.latch === 'side') {
        const side = p.latch === 'side', rp = p.latch_post_d / 2, cl = p.latch_clearance, bwid = p.latch_bar_w, bth = p.latch_bar_t;
        const xp = p.latch_inset, Dh = 2 * xp + p.latch_gap, stand = 0.2, plen = stand + bth + 4.5;
        let ok = true;
        if (p.latch_gap > gmax + 1e-6) { W.push('Latch lock opening (' + p.latch_gap + ' mm) is beyond the maximum opening (' + gmax.toFixed(0) + ' mm). Latch left out.'); ok = false; }
        if (xp + p.latch_gap / 2 + bwid / 2 > Whb - 6) { W.push('The latch does not fit on a half. Reduce the latch post distance or bar width.'); ok = false; }
        if (!side && d.wallTop < p.latch_post_d + 3) { W.push('The wall top is only ' + d.wallTop.toFixed(1) + ' mm wide: too narrow for a ' + p.latch_post_d + ' mm latch post. Use the side latch or thicken the wall.'); ok = false; }
        if (ok) {
          const H = d.H, th = d.light && d.t > 0 ? Math.atan(d.t) * 180 / Math.PI : 0;
          // one post: shaft with a small snap bead above the bar, along local +Z (the wall normal)
          const bz = stand + bth + 1.0, br = rp + cl + 0.15;
          const post = Manifold.union([Manifold.cylinder(plen + 1.5, rp, rp, 32).translate([0, 0, -1.5]),
            Manifold.cylinder(0.4, rp, br, 32).translate([0, 0, bz]), Manifold.cylinder(0.4, br, rp, 32).translate([0, 0, bz + 0.4])]);
          const hole = Manifold.cylinder(bth + 2, rp + cl, rp + cl, 32).translate([0, 0, -1]);
          const barPrint = Manifold.hull([Manifold.cylinder(bth, bwid / 2, bwid / 2, 40).translate([-Dh / 2, 0, 0]), Manifold.cylinder(bth, bwid / 2, bwid / 2, 40).translate([Dh / 2, 0, 0])])
            .subtract(Manifold.union([hole.translate([-Dh / 2, 0, 0]), hole.translate([Dh / 2, 0, 0])]));
          // mounting frames: [rotation, tilt, wall position y, z, reading sign]
          const frames = [];
          if (!side) {
            frames.push({ rot: [0, 0, 0], tilt: null, y: d.by1 - d.wallTop / 2, z: H, ux: 1 }, { rot: [0, 0, 180], tilt: null, y: -(-d.by0 - d.wallTop / 2), z: H, ux: 1, mirror: true });
          } else {
            const mk = (rot, tiltFn, c, b, sgn, ux) => {
              const zK = th > 0 ? H - (c - b) / d.t : -1e9, vertH = H - Math.max(zK, 0);
              let zl, lean = false;
              if (th > 0 && vertH < bwid + 10) { lean = true; zl = Math.max(p.base + 6, Math.min(zK - 2 - bwid / 2, H * 0.55)); }
              else zl = H - Math.min(vertH, 80) / 2 - 2;
              const yf = lean ? Math.min(b, c - d.t * (H - zl)) : b;
              return { rot, tilt: lean ? tiltFn(th) : null, y: sgn * yf, z: zl, ux };
            };
            frames.push(mk([90, 0, 180], a => [-a, 0, 0], d.cYp, d.by1, 1, -1), mk([90, 0, 0], a => [a, 0, 0], d.cYn, -d.by0, -1, 1));
          }
          const xform = (m, f) => { let g = m; if (f.rot[0] || f.rot[1] || f.rot[2]) g = g.rotate(f.rot); if (f.tilt) g = g.rotate(f.tilt); return g; };
          const postsL = [], postsR = [], barAsm = [];
          const mism = Math.abs(g - p.latch_gap) > 0.01, lift = mism ? 18 : 0;     // bar hovers beside the posts unless the preview opening matches
          for (const f of frames) {
            const place2 = (m, lx, ln) => xform(m.translate([f.ux * lx, 0, ln || 0]), f).translate([0, f.y, f.z]);
            if (!side && f.mirror) {                                              // top mount, -Y wall: rotate the whole frame 180 about Z
              const pl = (m, lx, ln) => m.translate([lx, 0, ln || 0]).translate([0, f.y, f.z]);
              postsR.push(pl(post, xp)); postsL.push(pl(post, -xp));
              barAsm.push(pl(barPrint, 0, stand + lift));
            } else if (!side) {
              const pl = (m, lx, ln) => m.translate([lx, 0, ln || 0]).translate([0, f.y, f.z]);
              postsR.push(pl(post, xp)); postsL.push(pl(post, -xp));
              barAsm.push(pl(barPrint, 0, stand + lift));
            } else {
              postsR.push(place2(post, xp)); postsL.push(place2(post, -xp));
              barAsm.push(place2(barPrint, 0, stand + lift));
            }
          }
          halfR = Manifold.union([halfR].concat(postsR)); halfL = Manifold.union([halfL].concat(postsL));
          asmR = halfR.translate([g / 2, 0, 0]); asmL = halfL.translate([-g / 2, 0, 0]);
          latchPart = { name: 'latch_bar', label: 'Latch bar', role: 'bracket', count: 2, print: barPrint, asm: Manifold.compose(barAsm) };
          sl.latch = { mode: p.latch, gap: p.latch_gap, spacing: Dh };
        }
      }
      parts.push({ name: swap ? 'half_front' : 'half_left', label: swap ? 'Front half (anterior)' : 'Left half', role: 'half', count: 1, print: halfL, asm: asmL });
      parts.push({ name: swap ? 'half_back' : 'half_right', label: swap ? 'Back half (posterior)' : 'Right half', role: 'half', count: 1, print: halfR, asm: asmR });
      if (latchPart) parts.push(latchPart);
      parts.push({ name: 'end_bracket', label: 'End bracket', role: 'bracket', count: 2, print: bracketPrint, asm: Manifold.compose(bracketAsm) });
      parts.push({ name: 'guide_rod', label: 'Guide rod', role: 'rod', count: 2, print: rodPrint, asm: Manifold.compose(rodAsm) });
      info.span = Math.max(rodL + 2 * bt, d.Lb, d.H);
      sl.yr = yr; sl.zr = zr;
      if (swap) parts.forEach(pt => { pt.asm = pt.asm.rotate([0, 0, -90]).translate([xc0, 0, 0]); });
    } else {
      const sz = o.splitZ, H = d.H, yz = d.Lc / 2 + (p.blade_margin + p.wall) / 2;
      if (p.wall - p.blade_margin < p.rod_d + p.rod_clearance + 4) W.push('The rod bores come within 2 mm of the blade slots. Raise wall, lower blade margin or use a thinner rod.');
      if (sz - sd < 3) W.push('The lower half is too short for a ' + sd + ' mm rod socket. Reduce socket depth.');
      rodL = p.rod_auto ? H - sz + p.max_gap + 2 * sd : p.rod_length;
      gmax = p.rod_auto ? p.max_gap : rodL - 2 * sd - (H - sz);
      if (gmax < 0) { W.push('The rod is ' + (-gmax).toFixed(0) + ' mm too short. Lengthen it to at least ' + (H - sz + 2 * sd).toFixed(0) + ' mm.'); gmax = 0; }
      g = Math.max(0, Math.min(p.gap, gmax));
      const BIG = 2000;
      const low = solid.intersect(Manifold.cube([BIG, BIG, BIG]).translate([-BIG / 2, -BIG / 2, sz - BIG]));
      const up = solid.intersect(Manifold.cube([BIG, BIG, BIG]).translate([-BIG / 2, -BIG / 2, sz]));
      const socks = Manifold.union([-yz, yz].map(y => Manifold.cylinder(sd + 1, rs, rs, seg).translate([0, y, sz - sd])));
      halfL = low.subtract(socks);                                          // lower half: press-fit blind sockets
      let upper = up.subtract(Manifold.union([-yz, yz].map(y => Manifold.cylinder(H - sz + 2, rb, rb, seg).translate([0, y, sz - 1]))));
      if (p.lock_screws && p.lock_pilot > 0) {
        const rl = p.lock_pilot / 2, len = d.Lb / 2 + 1 - yz, zl = sz + (H - sz) / 2;
        upper = upper.subtract(Manifold.union([
          Manifold.cylinder(len, rl, rl, 20).rotate([-90, 0, 0]).translate([0, yz, zl]),
          Manifold.cylinder(len, rl, rl, 20).rotate([90, 0, 0]).translate([0, -yz, zl])]));
      }
      halfR = upper;
      asmL = halfL.translate([0, 0, 0]); asmR = upper.translate([0, 0, g]);
      const rodPrint = cylX(p.rod_d / 2, rodL).translate([0, 0, p.rod_d / 2]);
      rodAsm = [-yz, yz].map(y => Manifold.cylinder(rodL, p.rod_d / 2, p.rod_d / 2, 48).translate([0, y, sz - sd]));
      bracketPrint = Manifold.cube([bw, bw, bt]).translate([-bw / 2, -bw / 2, 0])
        .subtract(Manifold.cylinder(sd + 1, rs, rs, seg).translate([0, 0, bt - sd]));
      const zo = H + gmax;
      bracketAsm = [-yz, yz].map(y => bracketPrint.rotate([180, 0, 0]).translate([0, y, zo + bt]));
      parts.push({ name: 'half_bottom', label: 'Bottom half', role: 'half', count: 1, print: halfL, asm: asmL });
      parts.push({ name: 'half_top', label: 'Top half', role: 'half', count: 1, print: upper.translate([0, 0, -sz]), asm: asmR });
      parts.push({ name: 'rod_cap', label: 'Rod cap', role: 'bracket', count: 2, print: bracketPrint, asm: Manifold.compose(bracketAsm) });
      parts.push({ name: 'guide_rod', label: 'Guide rod', role: 'rod', count: 2, print: rodPrint, asm: Manifold.compose(rodAsm) });
      info.span = Math.max(d.Wb, d.Lb, H + gmax + bt);
      sl.yr = yz; sl.splitZ = sz;
    }
    parts.forEach(pt => { const s = sb(pt.print.boundingBox()); pt.size = s; pt.vol = pt.print.volume() / 1000; });
    info.volume = parts.filter(pt => pt.role !== 'rod').reduce((a, pt) => a + pt.vol * pt.count, 0);
    Object.assign(sl, { rodLen: rodL, maxOpening: gmax, gap: g, socketDepth: sd });
    sl.bom = parts.map(pt => pt.count + ' x ' + pt.label + (pt.role === 'rod' ? ' (cut ' + p.rod_d + ' mm stock to ' + rodL.toFixed(0) + ' mm, or print)' : ' (print)') + '  ' + pt.size.map(v => v.toFixed(0)).join(' x ') + ' mm');
    if (p.lock_screws && p.lock_pilot > 0) sl.bom.push(axial ? '2 x M4 self-tapping screw, to lock the top half on the rods' : '4 x M4 self-tapping screw, to lock the halves on the rods');
    info.sliding = sl;
    return parts;
  }
  // volume (cm3) of the plain solid-style block with the default wall, base and corners, for the "saved" comparison
  function referenceVolume(wasm, user) {
    const u = Object.assign({}, user, { style: 'solid', mode: 'fixed', wall: DEFAULTS.wall, base: DEFAULTS.base, corner_radius: DEFAULTS.corner_radius,
      labels: false, marks: false, drain_d: 0, quality: 32 });
    const { solid } = build(wasm, u); const v = solid.volume() / 1000; solid.delete(); return v;
  }
  function axisLo(d) { return d.p.axis === 'coronal' ? -d.Lc / 2 : d.p.axis === 'sagittal' ? d.cx_lo : d.z_cav; }
  function axisHi(d) { return d.p.axis === 'coronal' ? d.Lc / 2 : d.p.axis === 'sagittal' ? d.cx_hi : d.H; }

  return { PRESETS, DEFAULTS, derive, computeCuts, computeCells, makeCuts, parseManual, build, toSTL, textRects, referenceVolume };
});

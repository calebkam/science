/* ============================ engine.js ============================
   Slicing engine: mesh parsing, layer slicing, walls, solid and sparse infill, skirt/brim,
   and G-code output. No DOM. Runs in a Web Worker in the browser and in Node for tests.
   Units: millimetres in, millimetres out. Clipper works on integer micrometres (S = 1000). */
(function (root) {
'use strict';
var CL = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./vendor/clipper.js') : root.ClipperLib;
var S = 1000, TAU = Math.PI * 2;

/* ---------------------------------------------------------------- printer profile */
var PR = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./printers.js') : root.SlicerPrinters;
function getPrinter(id) { return PR.PRINTERS[id] || PR.PRINTERS.h2s; }

/* ---------------------------------------------------------------- default settings */
var DEFAULTS = {
  layerHeight: 0.2, firstLayerHeight: 0.2, lineWidth: 0.42,
  walls: 2, topLayers: 5, bottomLayers: 3, infillDensity: 15, infillPattern: 'grid', wallOrder: 'inner-outer',
  speedFirst: 50, speedOuter: 120, speedInner: 200, speedSparse: 200, speedSolid: 180, speedTop: 100, speedTravel: 400,
  accel: 5000, accelFirst: 2000,
  skirtLoops: 1, skirtDistance: 3, brimWidth: 0, elephantFoot: 0.15,
  nozzleTemp: 220, bedTemp: 55, firstNozzleTemp: 220, firstBedTemp: 55, fan: 100, fanFirstOffLayers: 1,
  retractLength: 0.8, retractSpeed: 30, zHop: 0.4, retractMinTravel: 2,
  flow: 0.98, filamentDiameter: 1.75, filamentDensity: 1.24, maxVolumetric: 21, minLayerTime: 8, minPrintSpeed: 20,
  supportMode: 'organic', supportAngle: 30, supportOnPlate: 'everywhere', tipSpacing: 2.4, tipDiameter: 1.6, branchAngle: 40, trunkDiameter: 5, xyGap: 0.4, zGap: 0.2, speedSupport: 100,
  printer: 'h2s', filamentType: 'PLA', bedType: 'Textured PEI Plate', gcodeStart: {}, gcodeEnd: {}
};

/* ---------------------------------------------------------------- mesh parsing */
function parseSTL(buf) {
  var dv = new DataView(buf), n = dv.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (dv.byteLength === 84 + 50 * n && n > 0) { /* binary */
    var out = new Float32Array(n * 9);
    for (var i = 0, o = 84; i < n; i++, o += 50) for (var k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(o + 12 + k * 4, true);
    return out;
  }
  var txt = new TextDecoder().decode(new Uint8Array(buf)), re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g, m, arr = [];
  while ((m = re.exec(txt))) arr.push(+m[1], +m[2], +m[3]);
  if (arr.length < 9 || arr.length % 9) throw new Error('Could not read this STL file.');
  return Float32Array.from(arr);
}
function parseOBJ(text) {
  var v = [], t = [], lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (l.charCodeAt(0) === 118 && l.charCodeAt(1) === 32) { var p = l.trim().split(/\s+/); v.push([+p[1], +p[2], +p[3]]); }
    else if (l.charCodeAt(0) === 102 && l.charCodeAt(1) === 32) {
      var q = l.trim().split(/\s+/).slice(1).map(function (s) { var j = parseInt(s, 10); return j < 0 ? v.length + j : j - 1; });
      for (var k = 1; k + 1 < q.length; k++) t.push(v[q[0]], v[q[k]], v[q[k + 1]]);
    }
  }
  if (!t.length) throw new Error('Could not read this OBJ file.');
  var out = new Float32Array(t.length * 3); t.forEach(function (a, i) { out[i * 3] = a[0]; out[i * 3 + 1] = a[1]; out[i * 3 + 2] = a[2]; });
  return out;
}

/* ---------------------------------------------------------------- mesh helpers */
function bounds(tris) {
  var b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (var i = 0; i < tris.length; i += 3) for (var k = 0; k < 3; k++) { var v = tris[i + k]; if (v < b[k]) b[k] = v; if (v > b[k + 3]) b[k + 3] = v; }
  return b;
}
/* scale, rotate (degrees, X then Y then Z), then sit on z = 0 and centre on (x, y) */
function placeTris(tris, t) {
  t = t || {};
  var sx = t.sx || t.scale || 1, sy = t.sy || t.scale || 1, sz = t.sz || t.scale || 1, rx = (t.rx || 0) * Math.PI / 180, ry = (t.ry || 0) * Math.PI / 180, rz = (t.rz || 0) * Math.PI / 180;
  var cx = Math.cos(rx), sxr = Math.sin(rx), cy = Math.cos(ry), syr = Math.sin(ry), cz = Math.cos(rz), szr = Math.sin(rz);
  var out = new Float32Array(tris.length), b0 = bounds(tris), ox = (b0[0] + b0[3]) / 2, oy = (b0[1] + b0[4]) / 2, oz = (b0[2] + b0[5]) / 2;
  for (var i = 0; i < tris.length; i += 3) {
    var x = (tris[i] - ox) * sx, y = (tris[i + 1] - oy) * sy, z = (tris[i + 2] - oz) * sz, y1 = y * cx - z * sxr, z1 = y * sxr + z * cx; y = y1; z = z1;
    var x2 = x * cy + z * syr, z2 = -x * syr + z * cy; x = x2; z = z2;
    var x3 = x * cz - y * szr, y3 = x * szr + y * cz; out[i] = x3; out[i + 1] = y3; out[i + 2] = z;
  }
  var b = bounds(out), dx = (t.x != null ? t.x : 0) - (b[0] + b[3]) / 2, dy = (t.y != null ? t.y : 0) - (b[1] + b[4]) / 2, dz = -b[2];
  for (var j = 0; j < out.length; j += 3) { out[j] += dx; out[j + 1] += dy; out[j + 2] += dz; }
  return out;
}
/* orientation that puts the largest flat face on the bed; returns {rx, ry} in degrees for placeTris */
function layFlat(tris) {
  var buckets = new Map();
  for (var i = 0; i < tris.length; i += 9) {
    var ax = tris[i + 3] - tris[i], ay = tris[i + 4] - tris[i + 1], az = tris[i + 5] - tris[i + 2], bx = tris[i + 6] - tris[i], by = tris[i + 7] - tris[i + 1], bz = tris[i + 8] - tris[i + 2];
    var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, a = Math.hypot(nx, ny, nz); if (a < 1e-9) continue;
    nx /= a; ny /= a; nz /= a; var key = Math.round(nx * 20) + ',' + Math.round(ny * 20) + ',' + Math.round(nz * 20), e = buckets.get(key);
    if (!e) buckets.set(key, e = { n: [0, 0, 0], area: 0 }); e.area += a / 2; e.n[0] += nx * a / 2; e.n[1] += ny * a / 2; e.n[2] += nz * a / 2;
  }
  var best = null; buckets.forEach(function (e) { if (!best || e.area > best.area) best = e; });
  if (!best) return { rx: 0, ry: 0 };
  var n = best.n, l = Math.hypot(n[0], n[1], n[2]); n = [n[0] / l, n[1] / l, n[2] / l];
  /* placeTris applies Rx then Ry. Choose rx to clear n.y, then ry to send what is left of n to straight down. */
  var rx = Math.atan2(n[1], n[2]), rr = Math.hypot(n[1], n[2]), ry = Math.atan2(n[0], -rr);
  return { rx: rx * 180 / Math.PI, ry: ry * 180 / Math.PI };
}

/* ---------------------------------------------------------------- slicing */
function sliceMesh(tris, zs) {
  var nL = zs.length, segs = new Array(nL); for (var l = 0; l < nL; l++) segs[l] = [];
  var EPS = 1e-4;
  for (var i = 0; i < tris.length; i += 9) {
    var z0 = tris[i + 2], z1 = tris[i + 5], z2 = tris[i + 8], zmin = Math.min(z0, z1, z2), zmax = Math.max(z0, z1, z2);
    var lo = 0, hi = nL; while (lo < hi) { var mid = (lo + hi) >> 1; if (zs[mid] + EPS < zmin) lo = mid + 1; else hi = mid; }
    for (var li = lo; li < nL && zs[li] + EPS <= zmax; li++) {
      var z = zs[li] + EPS, pts = [];
      for (var e = 0; e < 3; e++) {
        var a = i + e * 3, b = i + ((e + 1) % 3) * 3, za = tris[a + 2], zb = tris[b + 2];
        if ((za < z) === (zb < z)) continue;
        /* canonical edge order so neighbouring triangles compute identical points */
        var p = a, q = b; if (za > zb || (za === zb && (tris[a] > tris[b] || (tris[a] === tris[b] && tris[a + 1] > tris[b + 1])))) { p = b; q = a; }
        var t = (z - tris[p + 2]) / (tris[q + 2] - tris[p + 2]);
        pts.push(Math.round((tris[p] + (tris[q] - tris[p]) * t) * S), Math.round((tris[p + 1] + (tris[q + 1] - tris[p + 1]) * t) * S));
      }
      if (pts.length === 4 && (pts[0] !== pts[2] || pts[1] !== pts[3])) segs[li].push(pts);
    }
  }
  var layers = new Array(nL);
  for (var k = 0; k < nL; k++) layers[k] = unionPaths(joinSegments(segs[k]));
  return layers;
}
function joinSegments(segs) {
  var map = new Map(), n = segs.length, used = new Uint8Array(n), loops = [];
  function key(x, y) { return x + ',' + y; }
  for (var i = 0; i < n; i++) {
    var s = segs[i], ka = key(s[0], s[1]), kb = key(s[2], s[3]);
    (map.get(ka) || map.set(ka, []).get(ka)).push(i); (map.get(kb) || map.set(kb, []).get(kb)).push(i);
  }
  for (var st = 0; st < n; st++) {
    if (used[st]) continue; used[st] = 1;
    var s0 = segs[st], path = [{ X: s0[0], Y: s0[1] }, { X: s0[2], Y: s0[3] }], startK = key(s0[0], s0[1]), curK = key(s0[2], s0[3]), closed = false;
    for (var guard = 0; guard < n + 2; guard++) {
      if (curK === startK) { closed = true; path.pop(); break; }
      var cand = map.get(curK), nxt = -1; if (cand) for (var c = 0; c < cand.length; c++) if (!used[cand[c]]) { nxt = cand[c]; break; }
      if (nxt < 0) break; used[nxt] = 1; var sg = segs[nxt];
      if (key(sg[0], sg[1]) === curK) { path.push({ X: sg[2], Y: sg[3] }); curK = key(sg[2], sg[3]); } else { path.push({ X: sg[0], Y: sg[1] }); curK = key(sg[0], sg[1]); }
    }
    if (closed && path.length >= 3) loops.push(path);
  }
  return loops;
}
function unionPaths(paths) {
  if (!paths.length) return [];
  var c = new CL.Clipper(), sol = new CL.Paths(); c.AddPaths(paths, CL.PolyType.ptSubject, true);
  c.Execute(CL.ClipType.ctUnion, sol, CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftEvenOdd);
  return sol;
}

/* ---------------------------------------------------------------- clipper helpers */
function offset(paths, d, round) {
  if (!paths.length) return [];
  if (!d) return paths;
  var co = new CL.ClipperOffset(2, 0.25 * S / 10), sol = new CL.Paths();
  co.AddPaths(paths, round === false ? CL.JoinType.jtMiter : CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
  co.Execute(sol, d * S); return sol;
}
function boolOp(type, a, b) {
  if (!a.length) return type === CL.ClipType.ctUnion ? b.slice() : [];
  var c = new CL.Clipper(), sol = new CL.Paths(); c.AddPaths(a, CL.PolyType.ptSubject, true); if (b.length) c.AddPaths(b, CL.PolyType.ptClip, true);
  c.Execute(type, sol, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero); return sol;
}
function diff(a, b) { return b.length ? boolOp(CL.ClipType.ctDifference, a, b) : a; }
function inter(a, b) { return boolOp(CL.ClipType.ctIntersection, a, b); }
function union(a, b) { return boolOp(CL.ClipType.ctUnion, a, b); }
function area(paths) { var s = 0; for (var i = 0; i < paths.length; i++) s += CL.Clipper.Area(paths[i]); return s / (S * S); }
function dropSmall(paths, minArea) { /* remove islands smaller than minArea mm2 (signed areas: holes are negative, kept) */
  return paths.filter(function (p) { var a = CL.Clipper.Area(p) / (S * S); return a < 0 || a >= minArea; });
}
function bbox(paths) {
  var b = [Infinity, Infinity, -Infinity, -Infinity];
  for (var i = 0; i < paths.length; i++) for (var j = 0; j < paths[i].length; j++) { var p = paths[i][j]; if (p.X < b[0]) b[0] = p.X; if (p.Y < b[1]) b[1] = p.Y; if (p.X > b[2]) b[2] = p.X; if (p.Y > b[3]) b[3] = p.Y; }
  return b;
}
function polyTreeIslands(paths) { /* [{contour, holes[], area}] */
  var c = new CL.Clipper(), tree = new CL.PolyTree(); c.AddPaths(paths, CL.PolyType.ptSubject, true);
  c.Execute(CL.ClipType.ctUnion, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  var out = [];
  (function walk(node) {
    node.Childs().forEach(function (ch) {
      if (!ch.IsHole()) { var holes = ch.Childs().map(function (h) { return h.Contour(); }); out.push({ contour: ch.Contour(), holes: holes, area: Math.abs(CL.Clipper.Area(ch.Contour())) }); }
      walk(ch);
    });
  })(tree);
  return out;
}
function insideIsland(pt, isl) {
  if (CL.Clipper.PointInPolygon(pt, isl.contour) === 0) return false;
  for (var i = 0; i < isl.holes.length; i++) if (CL.Clipper.PointInPolygon(pt, isl.holes[i]) !== 0) return false;
  return true;
}
function islandOf(pt, islands) {
  var best = -1;
  for (var i = 0; i < islands.length; i++) if (insideIsland(pt, islands[i]) && (best < 0 || islands[i].area < islands[best].area)) best = i;
  if (best < 0) { /* near an edge: pick nearest contour vertex island */
    var bd = Infinity; for (var j = 0; j < islands.length; j++) { var c = islands[j].contour; for (var k = 0; k < c.length; k += Math.max(1, c.length >> 4)) { var d = Math.hypot(c[k].X - pt.X, c[k].Y - pt.Y); if (d < bd) { bd = d; best = j; } } }
  }
  return best;
}

/* ---------------------------------------------------------------- infill patterns */
function clipOpen(lines, region) { /* lines: array of open paths (int); returns open paths inside region */
  if (!lines.length || !region.length) return [];
  var c = new CL.Clipper(), pt = new CL.PolyTree(); c.AddPaths(lines, CL.PolyType.ptSubject, false); c.AddPaths(region, CL.PolyType.ptClip, true);
  c.Execute(CL.ClipType.ctIntersection, pt, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return CL.Clipper.OpenPathsFromPolyTree(pt);
}
function rotPath(path, a) { var c = Math.cos(a), s = Math.sin(a); return path.map(function (p) { return { X: Math.round(p.X * c - p.Y * s), Y: Math.round(p.X * s + p.Y * c) }; }); }
function linesInRegion(region, pitch, angleDeg) {
  if (!region.length) return [];
  var a = angleDeg * Math.PI / 180, rr = region.map(function (p) { return rotPath(p, -a); }), b = bbox(rr), step = Math.max(1, Math.round(pitch * S)), lines = [];
  for (var y = Math.ceil(b[1] / step) * step; y <= b[3]; y += step) lines.push([{ X: b[0] - 10, Y: y }, { X: b[2] + 10, Y: y }]);
  return clipOpen(lines, rr).map(function (p) { return rotPath(p, a); });
}
/* gyroid: marching squares on sin x cos y + sin y cos z + sin z cos x = 0 */
var gyroidK = null;
function gyroidField(x, y, z) { return Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x); }
function gyroidLengthPerArea() { /* contour length per unit area for period TAU, averaged over z */
  if (gyroidK) return gyroidK;
  var N = 96, h = TAU / N, tot = 0, zc = 0;
  for (var zi = 0; zi < 8; zi++) {
    var z = (zi + 0.5) * TAU / 8, vals = []; for (var j = 0; j <= N; j++) { vals[j] = []; for (var i = 0; i <= N; i++) vals[j][i] = gyroidField(i * h, j * h, z); }
    var L = 0;
    for (var cj = 0; cj < N; cj++) for (var ci = 0; ci < N; ci++) {
      var v0 = vals[cj][ci], v1 = vals[cj][ci + 1], v2 = vals[cj + 1][ci + 1], v3 = vals[cj + 1][ci], pts = [];
      function cross(a, b, ax, ay, bx, by) { if ((a < 0) !== (b < 0)) { var t = a / (a - b); pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]); } }
      var x0 = ci * h, y0 = cj * h; cross(v0, v1, x0, y0, x0 + h, y0); cross(v1, v2, x0 + h, y0, x0 + h, y0 + h); cross(v2, v3, x0 + h, y0 + h, x0, y0 + h); cross(v3, v0, x0, y0 + h, x0, y0);
      if (pts.length === 2) L += Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]); else if (pts.length === 4) L += Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) + Math.hypot(pts[2][0] - pts[3][0], pts[2][1] - pts[3][1]);
    }
    tot += L / (TAU * TAU); zc++;
  }
  return (gyroidK = tot / zc); /* contour length per unit area when the field argument equals millimetres (scale 1) */
}
function gyroidInRegion(region, density, w, z) {
  if (!region.length) return [];
  var K = gyroidLengthPerArea(); /* L/A at s=1 where field argument = s*mm */
  var s = density / (w * K), period = TAU / s, g = Math.max(period / 10, 0.45), b = bbox(region).map(function (v) { return v / S; });
  var x0 = Math.floor(b[0] / g) - 1, y0 = Math.floor(b[1] / g) - 1, nx = Math.ceil((b[2] - b[0]) / g) + 3, ny = Math.ceil((b[3] - b[1]) / g) + 3;
  var vals = new Float32Array((nx + 1) * (ny + 1));
  for (var j = 0; j <= ny; j++) for (var i = 0; i <= nx; i++) vals[j * (nx + 1) + i] = gyroidField((x0 + i) * g * s, (y0 + j) * g * s, z * s);
  /* collect segments keyed by grid-edge id, then chain */
  var segs = [];
  function ptOnEdge(i, j, e) { /* e: 0 bottom,1 right,2 top,3 left of cell (i,j) */
    var a, b, ax, ay, bx, by;
    if (e === 0) { a = vals[j * (nx + 1) + i]; b = vals[j * (nx + 1) + i + 1]; ax = i; ay = j; bx = i + 1; by = j; }
    else if (e === 1) { a = vals[j * (nx + 1) + i + 1]; b = vals[(j + 1) * (nx + 1) + i + 1]; ax = i + 1; ay = j; bx = i + 1; by = j + 1; }
    else if (e === 2) { a = vals[(j + 1) * (nx + 1) + i]; b = vals[(j + 1) * (nx + 1) + i + 1]; ax = i; ay = j + 1; bx = i + 1; by = j + 1; }
    else { a = vals[j * (nx + 1) + i]; b = vals[(j + 1) * (nx + 1) + i]; ax = i; ay = j; bx = i; by = j + 1; }
    var t = a / (a - b); var id = e === 0 ? (j * (nx + 1) + i) * 2 : e === 2 ? ((j + 1) * (nx + 1) + i) * 2 : e === 1 ? (j * (nx + 1) + i + 1) * 2 + 1 : (j * (nx + 1) + i) * 2 + 1;
    return { id: id, x: ((x0 + ax) + (bx - ax) * t) * g, y: ((y0 + ay) + (by - ay) * t) * g };
  }
  for (var cj = 0; cj < ny; cj++) for (var ci = 0; ci < nx; ci++) {
    var v0 = vals[cj * (nx + 1) + ci], v1 = vals[cj * (nx + 1) + ci + 1], v2 = vals[(cj + 1) * (nx + 1) + ci + 1], v3 = vals[(cj + 1) * (nx + 1) + ci];
    var m = (v0 < 0 ? 1 : 0) | (v1 < 0 ? 2 : 0) | (v2 < 0 ? 4 : 0) | (v3 < 0 ? 8 : 0); if (m === 0 || m === 15) continue;
    var tbl = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]] };
    var list = tbl[m]; for (var q = 0; q < list.length; q++) segs.push([ptOnEdge(ci, cj, list[q][0]), ptOnEdge(ci, cj, list[q][1])]);
  }
  var byId = new Map(); segs.forEach(function (sg, idx) { sg.forEach(function (p) { var l = byId.get(p.id); if (!l) byId.set(p.id, l = []); l.push(idx); }); });
  var used = new Uint8Array(segs.length), lines = [];
  for (var st = 0; st < segs.length; st++) {
    if (used[st]) continue; used[st] = 1; var chain = [segs[st][0], segs[st][1]];
    for (var dir = 0; dir < 2; dir++) {
      for (;;) {
        var end = dir === 0 ? chain[chain.length - 1] : chain[0], cand = byId.get(end.id), nx2 = -1;
        if (cand) for (var c = 0; c < cand.length; c++) if (!used[cand[c]]) { nx2 = cand[c]; break; }
        if (nx2 < 0) break; used[nx2] = 1; var sg = segs[nx2], other = sg[0].id === end.id ? sg[1] : sg[0];
        if (dir === 0) chain.push(other); else chain.unshift(other);
      }
    }
    lines.push(chain.map(function (p) { return { X: Math.round(p.x * S), Y: Math.round(p.y * S) }; }));
  }
  return clipOpen(lines, region);
}
function sparseInfill(region, s, w, layerIndex, z) {
  var d = Math.max(0.01, Math.min(1, s.infillDensity / 100)), pat = s.infillPattern;
  if (pat === 'gyroid') return gyroidInRegion(region, d, w, z);
  if (pat === 'lines') return linesInRegion(region, w / d, layerIndex % 2 ? 135 : 45);
  /* grid: both directions every layer, half density each */
  return linesInRegion(region, 2 * w / d, 45).concat(linesInRegion(region, 2 * w / d, 135));
}

/* ---------------------------------------------------------------- toolpath planning */
function toMM(path) { var o = new Float32Array(path.length * 2); for (var i = 0; i < path.length; i++) { o[i * 2] = path[i].X / S; o[i * 2 + 1] = path[i].Y / S; } return o; }
function orderPaths(paths, start) { /* greedy nearest neighbour over open paths; may reverse. returns new array */
  var left = paths.slice(), out = [], cx = start[0], cy = start[1];
  while (left.length) {
    var bi = 0, bd = Infinity, rev = false;
    for (var i = 0; i < left.length; i++) {
      var p = left[i], a = p[0], b = p[p.length - 1], d1 = (a.X - cx) * (a.X - cx) + (a.Y - cy) * (a.Y - cy), d2 = (b.X - cx) * (b.X - cx) + (b.Y - cy) * (b.Y - cy);
      if (d1 < bd) { bd = d1; bi = i; rev = false; } if (d2 < bd) { bd = d2; bi = i; rev = true; }
    }
    var pick = left.splice(bi, 1)[0]; if (rev) pick = pick.slice().reverse(); out.push(pick); var e = pick[pick.length - 1]; cx = e.X; cy = e.Y;
  }
  return out;
}
function startLoopNear(loop, tx, ty) { /* rotate a closed loop to start at the vertex nearest (tx,ty) (int units) and close it */
  var bi = 0, bd = Infinity; for (var i = 0; i < loop.length; i++) { var d = (loop[i].X - tx) * (loop[i].X - tx) + (loop[i].Y - ty) * (loop[i].Y - ty); if (d < bd) { bd = d; bi = i; } }
  var r = loop.slice(bi).concat(loop.slice(0, bi)); r.push({ X: r[0].X, Y: r[0].Y }); return r;
}


/* ---------------------------------------------------------------- organic (tree) supports
   Threshold angle is measured from the horizontal, as in Bambu Studio and PrusaSlicer: surfaces flatter than it get supports.
   Works on the layer outlines. Overhanging regions get small tips; each tip becomes a node that walks down one layer
   at a time, leaning toward neighbours so branches merge into trunks, thickening as it goes, and steering round the model.
   A node that cannot get past the model rests on it (or, in "build plate only" mode, its whole branch is dropped). */
function insidePaths(pt, paths) {
  var inside = false;
  for (var i = 0; i < paths.length; i++) if (CL.Clipper.PointInPolygon(pt, paths[i]) !== 0) inside = !inside;
  return inside;
}
function nearestOnPaths(pt, paths) {
  var best = null, bd = Infinity;
  for (var i = 0; i < paths.length; i++) {
    var p = paths[i], n = p.length;
    for (var j = 0; j < n; j++) {
      var a = p[j], b = p[(j + 1) % n], dx = b.X - a.X, dy = b.Y - a.Y, l2 = dx * dx + dy * dy, t = l2 ? ((pt.X - a.X) * dx + (pt.Y - a.Y) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t)); var qx = a.X + dx * t, qy = a.Y + dy * t, d = (qx - pt.X) * (qx - pt.X) + (qy - pt.Y) * (qy - pt.Y);
      if (d < bd) { bd = d; best = { X: qx, Y: qy }; }
    }
  }
  return best ? { X: best.X, Y: best.Y, dist: Math.sqrt(bd) } : null;
}
function circlePath(x, y, r, seg) {
  var out = [], i; for (i = 0; i < seg; i++) { var a = i / seg * TAU; out.push({ X: Math.round((x + r * Math.cos(a)) * S), Y: Math.round((y + r * Math.sin(a)) * S) }); } return out;
}
function sampleRegion(region, spacing, cap) {
  var pts = [], seen = new Map(), q = spacing * 0.5;
  function add(x, y) { var k = Math.round(x / q) + ',' + Math.round(y / q); if (seen.has(k) || pts.length >= cap) return; seen.set(k, 1); pts.push([x, y]); }
  var b = bbox(region).map(function (v) { return v / S; }), x, y;
  /* edge points first so outlines are always held up */
  var inner = offset(region, -0.35); if (!inner.length) inner = region;
  inner.forEach(function (p) {
    var acc = 0, n = p.length;
    for (var i = 0; i < n; i++) { var a = p[i], c = p[(i + 1) % n], len = Math.hypot(c.X - a.X, c.Y - a.Y) / S, pos = spacing - acc; while (pos <= len) { var t = pos / len; add((a.X + (c.X - a.X) * t) / S, (a.Y + (c.Y - a.Y) * t) / S); pos += spacing * 0.9; } acc = (len - (pos - spacing * 0.9)) ; if (acc < 0) acc = 0; }
  });
  for (y = Math.ceil(b[1] / spacing) * spacing; y <= b[3]; y += spacing) for (x = Math.ceil(b[0] / spacing) * spacing; x <= b[2]; x += spacing) {
    if (insidePaths({ X: Math.round(x * S), Y: Math.round(y * S) }, inner)) add(x, y);
  }
  return pts;
}
function planSupports(slices, hs, s, bed, progress) {
  var n = slices.length; if (n < 2) return null;
  var h = hs[1] || s.layerHeight, d = h / Math.tan(Math.max(5, Math.min(89, s.supportAngle)) * Math.PI / 180), tipR = s.tipDiameter / 2, rMax = Math.max(tipR, s.trunkDiameter / 2), spacing = Math.max(0.8, s.tipSpacing);
  var gapL = Math.max(1, Math.round(s.zGap / h)), maxMove = Math.max(0.05, h * Math.tan(s.branchAngle * Math.PI / 180)), growth = (rMax - tipR) * h / 30, gap = s.xyGap, onPlate = s.supportOnPlate === 'plate';
  var over = new Array(n), any = false, i;
  for (i = 1; i < n; i++) {
    var R = diff(slices[i], offset(slices[i - 1], d)); R = R.length ? dropSmall(offset(offset(R, -0.03), 0.03), 0.3) : [];
    over[i] = R; if (R.length) any = true;
  }
  if (!any) return null;
  var cacheL = {}, nodes = [], active = [], snaps = new Array(n), tipCount = 0, capped = false;
  for (i = 0; i < n; i++) snaps[i] = [];
  /* keep-out zone for a node's centre; the final clip against the model trims the circle itself, so only part of the radius counts */
  function avoid(L, r) { var b = Math.ceil((gap + 0.35 * r) * 4) / 4, c = cacheL[L] || (cacheL[L] = {}); return c[b] || (c[b] = offset(slices[L], b)); }
  function hashOf(list, cell) { var m = new Map(); list.forEach(function (nd) { var k = Math.floor(nd.x / cell) + ',' + Math.floor(nd.y / cell), a = m.get(k); if (a) a.push(nd); else m.set(k, [nd]); }); return m; }
  function near(m, cell, x, y, rad, fn) { var cx = Math.floor(x / cell), cy = Math.floor(y / cell), k = Math.ceil(rad / cell); for (var a = -k; a <= k; a++) for (var b = -k; b <= k; b++) { var l = m.get((cx + a) + ',' + (cy + b)); if (l) for (var j = 0; j < l.length; j++) fn(l[j]); } }
  function fail(nd) { var st = [nd]; while (st.length) { var c = st.pop(); if (c.failed) continue; c.failed = true; c.children.forEach(function (k) { st.push(k); }); } }
  var lean = Math.max(spacing * 3, 6);
  for (var L = n - 1; L >= 0; L--) {
    /* 1. move live nodes down onto layer L */
    if (active.length) {
      var cell = lean, hm = hashOf(active, cell);
      active.forEach(function (nd) {
        nd.age++; nd.r = Math.min(rMax, Math.max(nd.r, tipR + growth * nd.age));
        var best = null, bd = Infinity;
        near(hm, cell, nd.x, nd.y, lean, function (o) { if (o === nd) return; var dd = Math.hypot(o.x - nd.x, o.y - nd.y); if (dd < bd && dd < lean) { bd = dd; best = o; } });
        if (best && bd > (nd.r + best.r) * 0.6) { var st = Math.min(maxMove * 0.7, bd / 2); nd.x += (best.x - nd.x) / bd * st; nd.y += (best.y - nd.y) / bd * st; }
        nd.x = Math.min(bed[0], Math.max(0, nd.x)); nd.y = Math.min(bed[1], Math.max(0, nd.y));
        var av = avoid(L, nd.r), p = { X: Math.round(nd.x * S), Y: Math.round(nd.y * S) };
        if (insidePaths(p, av)) {
          var esc = nearestOnPaths(p, av);
          if (esc && esc.dist <= maxMove * S) { var vx = esc.X - p.X, vy = esc.Y - p.Y, vl = Math.hypot(vx, vy) || 1; nd.x = (esc.X + vx / vl * 30) / S; nd.y = (esc.Y + vy / vl * 30) / S; if (insidePaths({ X: Math.round(nd.x * S), Y: Math.round(nd.y * S) }, av)) { nd.done = true; if (onPlate) fail(nd); } }
          else { nd.done = true; if (onPlate) fail(nd); }
        }
      });
      active = active.filter(function (nd) { return !nd.done && !nd.merged; });
      /* 2. merge nodes that now overlap */
      var hm2 = hashOf(active, rMax * 2 + 1), order = active.slice().sort(function (a, b) { return b.r - a.r; });
      order.forEach(function (a) {
        if (a.merged) return;
        near(hm2, rMax * 2 + 1, a.x, a.y, rMax * 2, function (b) {
          if (b === a || b.merged || a.merged) return;
          if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.75) {
            var wa = a.r * a.r, wb = b.r * b.r; a.x = (a.x * wa + b.x * wb) / (wa + wb); a.y = (a.y * wa + b.y * wb) / (wa + wb);
            a.r = Math.min(rMax, Math.sqrt(wa + wb)); a.age = Math.max(a.age, b.age); a.children.push(b); b.merged = true;
          }
        });
      });
      active = active.filter(function (nd) { return !nd.merged; });
    }
    /* 3. new tips for the overhang gapL layers above */
    var oi = L + gapL;
    if (oi < n && over[oi] && over[oi].length) {
      var cands = sampleRegion(over[oi], spacing, 40000 - tipCount), hm3 = hashOf(active, rMax * 2 + spacing), av0 = avoid(L, tipR);
      cands.forEach(function (c) {
        var close = false; near(hm3, rMax * 2 + spacing, c[0], c[1], rMax + spacing, function (o) { if (Math.hypot(o.x - c[0], o.y - c[1]) < o.r + spacing * 0.5) close = true; });
        if (close) return;
        var cp = { X: Math.round(c[0] * S), Y: Math.round(c[1] * S) };
        if (insidePaths(cp, av0)) { var es = nearestOnPaths(cp, av0); if (!es || es.dist > 1.5 * S) return; var vx = es.X - cp.X, vy = es.Y - cp.Y, vl = Math.hypot(vx, vy) || 1; c = [(es.X + vx / vl * 30) / S, (es.Y + vy / vl * 30) / S]; if (insidePaths({ X: Math.round(c[0] * S), Y: Math.round(c[1] * S) }, av0)) return; }
        var nd = { x: c[0], y: c[1], r: tipR, age: 0, children: [], done: false, merged: false, failed: false }; nodes.push(nd); active.push(nd); tipCount++;
        var k = Math.floor(c[0] / (rMax * 2 + spacing)) + ',' + Math.floor(c[1] / (rMax * 2 + spacing)), a = hm3.get(k); if (a) a.push(nd); else hm3.set(k, [nd]);
      });
      if (tipCount >= 40000) capped = true;
    }
    active.forEach(function (nd) { snaps[L].push({ nd: nd, x: nd.x, y: nd.y, r: nd.r }); });
    delete cacheL[L + 2];
    if (progress && L % 6 === 0) progress(0.62 + 0.1 * (n - L) / n, 'Supports');
  }
  /* rasterise */
  var out = new Array(n), have = false;
  for (L = 0; L < n; L++) {
    var circles = []; snaps[L].forEach(function (sn) { if (!sn.nd.failed) circles.push(circlePath(sn.x, sn.y, sn.r, sn.r < 1.2 ? 10 : 16)); });
    if (!circles.length) { out[L] = []; continue; }
    var u = unionPaths(circles); u = diff(u, offset(slices[L], gap * 0.8)); u = dropSmall(u, 0.4);
    out[L] = u; if (u.length) have = true;
  }
  if (progress) progress(0.73, 'Supports');
  return have ? { layers: out, tips: tipCount, capped: capped } : null;
}
/* Turns one layer of support area into walls and sparse infill paths */
function supportItems(region, L, s, pos) {
  var w = s.lineWidth, items = [], isl = polyTreeIslands(region), groups = isl.map(function () { return { loops: [], lines: [] }; });
  function assign(list, key) { list.forEach(function (p) { var gi = islandOf(p[Math.min(1, p.length - 1)], isl); if (gi >= 0) groups[gi][key].push(p); }); }
  var l1 = offset(region, -w / 2), l2 = l1.length ? offset(region, -1.5 * w) : [];
  assign(l1.map(function (p) { return p.concat([p[0]]); }), 'loops'); assign(l2.map(function (p) { return p.concat([p[0]]); }), 'loops');
  var inner = l2.length ? offset(region, -2 * w + 0.15 * w) : [];
  if (inner.length) { var lines = linesInRegion(inner, L === 0 ? w * 2 : w / 0.15, L % 2 ? 135 : 45); assign(lines.filter(function (p) { return p.length > 1; }), 'lines'); }
  var remaining = isl.map(function (_, i) { return i; });
  while (remaining.length) {
    var bi = 0, bd = Infinity; remaining.forEach(function (gi, ri) { var c = isl[gi].contour[0], d = Math.hypot(c.X - pos[0], c.Y - pos[1]); if (d < bd) { bd = d; bi = ri; } });
    var g = groups[remaining.splice(bi, 1)[0]];
    orderPaths(g.loops, pos).forEach(function (p) { items.push({ type: 'support', pts: toMM(p), closed: true }); var e = p[p.length - 1]; pos = [e.X, e.Y]; });
    orderPaths(g.lines, pos).forEach(function (p) { items.push({ type: 'support', pts: toMM(p), closed: false }); var e = p[p.length - 1]; pos = [e.X, e.Y]; });
  }
  return { items: items, pos: pos };
}

/* Plans every layer. Returns {layers:[{z, h, items:[{type, pts:Float32Array(xy), closed}]}], warnings, stats} */
function planLayers(slices, zs, hs, s, progress) {
  var n = slices.length, w = s.lineWidth, warnings = [];
  var inner = new Array(n), wallSets = new Array(n), islandsL = new Array(n);
  /* elephant foot compensation on layer 0 */
  if (n && s.elephantFoot > 0) slices[0] = offset(slices[0], -s.elephantFoot);
  /* walls and infill boundary for each layer */
  for (var i = 0; i < n; i++) {
    var sl = dropSmall(slices[i], 0.05), walls = [], k;
    for (k = 0; k < s.walls; k++) {
      var wp = offset(sl, -(k + 0.5) * w); if (!wp.length) break; walls.push(wp);
    }
    wallSets[i] = walls;
    inner[i] = walls.length ? offset(sl, -(walls.length * w) + 0.15 * w) : (s.walls === 0 ? sl : []);
    islandsL[i] = polyTreeIslands(sl.length ? sl : []);
    if (progress && i % 8 === 0) progress(0.05 + 0.3 * i / n, 'Walls');
  }
  /* skin: regions that need solid infill */
  var nb = s.bottomLayers, nt = s.topLayers, solid = new Array(n), top = new Array(n);
  var tmp = new Array(n);
  for (var li = 0; li < n; li++) {
    var inn = inner[li]; if (!inn.length) { solid[li] = []; top[li] = []; continue; }
    var s1 = inn, topR = [], j;
    /* bottom: parts of this layer not covered by the intersection of the nb layers below */
    var belowI = null; for (j = 1; j <= nb; j++) { var bi2 = li - j; if (bi2 < 0) { belowI = []; break; } belowI = belowI === null ? inner[bi2] : inter(belowI, inner[bi2]); if (!belowI.length) break; }
    var bottomR = (belowI === null) ? [] : diff(inn, belowI);
    /* top: parts not covered by the layers above */
    var aboveI = null; for (j = 1; j <= nt; j++) { var ti = li + j; if (ti >= n) { aboveI = []; break; } aboveI = aboveI === null ? inner[ti] : inter(aboveI, inner[ti]); if (!aboveI.length) break; }
    var topSolid = (aboveI === null) ? [] : diff(inn, aboveI);
    var exposed = (li + 1 >= n) ? inn : diff(inn, inner[li + 1]);
    var sol = union(bottomR, topSolid);
    sol = dropSmall(offset(offset(sol, -0.1), 0.1), 0.5); /* remove slivers */
    exposed = dropSmall(offset(offset(exposed, -0.1), 0.1), 0.5);
    if (sol.length) sol = inter(offset(sol, w), inn); /* overlap into sparse region a little */
    solid[li] = sol; top[li] = exposed.length ? inter(offset(exposed, w * 0.5), inn) : [];
    if (progress && li % 8 === 0) progress(0.35 + 0.25 * li / n, 'Top and bottom layers');
  }
  var supp = (s.supportMode === 'organic') ? planSupports(slices, hs, s, getPrinter(s.printer).bed, progress) : null;
  if (supp && supp.capped) warnings.push('Very large overhang: supports were limited to 40000 branch tips.');
  var layers = [], pos = [0, 0], stats = { moves: 0 };
  /* skirt and brim from layer 0 */
  var skirtLoops = [], brimLoops = [];
  if (n && slices[0].length) {
    var first = slices[0], b = Math.round(s.brimWidth / w);
    for (var bk = 0; bk < b; bk++) { var ob = offset(first, (bk + 0.5) * w); brimLoops.push.apply(brimLoops, ob.filter(function (p) { return CL.Clipper.Orientation(p); })); }
    var base = s.brimWidth + s.skirtDistance;
    for (var sk = 0; sk < s.skirtLoops; sk++) { var os = offset(first, base + (sk + 0.5) * w); skirtLoops.push.apply(skirtLoops, os.filter(function (p) { return CL.Clipper.Orientation(p); })); }
  }
  for (var L = 0; L < n; L++) {
    var items = [], isl = islandsL[L];
    if (L === 0) {
      var sb = skirtLoops.concat(brimLoops.slice().reverse());
      var ordered = orderPaths(sb.map(function (p) { return p.concat([p[0]]); }), pos);
      ordered.forEach(function (p, idx) { items.push({ type: idx < skirtLoops.length ? 'skirt' : 'brim', pts: toMM(p), closed: true }); });
      if (ordered.length) { var le = ordered[ordered.length - 1][ordered[ordered.length - 1].length - 1]; pos = [le.X, le.Y]; }
    }
    if (supp && supp.layers[L] && supp.layers[L].length) { var si = supportItems(supp.layers[L], L, s, pos); si.items.forEach(function (x) { items.push(x); }); pos = si.pos; }
    /* group everything by island */
    var groups = isl.map(function () { return { outer: [], inner: [], sparse: [], solid: [], top: [] }; });
    function assign(kind, paths, pick) { paths.forEach(function (p) { var gi = islandOf(p[Math.min(1, p.length - 1)], isl); if (gi >= 0) groups[gi][kind].push(p); }); }
    var ws = wallSets[L];
    for (var wi = 0; wi < ws.length; wi++) assign(wi === 0 ? 'outer' : 'inner', ws[wi].map(function (p) { return p; }));
    var innerRegion = inner[L];
    if (innerRegion.length) {
      var solidR = solid[L], topR2 = top[L], sparseR = diff(diff(innerRegion, solidR), topR2);
      sparseR = dropSmall(offset(offset(sparseR, -0.1), 0.1), 1.0);
      var solidOnly = diff(solidR, topR2);
      var sparse = sparseR.length && s.infillDensity > 0 ? sparseInfill(sparseR, s, w, L, zs[L]) : [];
      var sp = s.infillDensity >= 100 ? [] : sparse;
      var sparseLines = sp.filter(function (p) { return p.length > 1; });
      var solidLines = linesInRegion(solidOnly, w, (L % 2) ? 135 : 45);
      var topLines = linesInRegion(top[L], w, (L % 2) ? 135 : 45);
      if (s.infillDensity >= 100) { solidLines = solidLines.concat(linesInRegion(sparseR, w, (L % 2) ? 135 : 45)); }
      assign('sparse', sparseLines); assign('solid', solidLines); assign('top', topLines);
    }
    /* emit island by island: walls then infill */
    var idxs = isl.map(function (_, i) { return i; }), remaining = idxs.slice();
    while (remaining.length) {
      var bi3 = 0, bd3 = Infinity;
      remaining.forEach(function (gi, ri) { var c = isl[gi].contour[0], d = Math.hypot(c.X - pos[0], c.Y - pos[1]); if (d < bd3) { bd3 = d; bi3 = ri; } });
      var g = groups[remaining.splice(bi3, 1)[0]], gi2 = idxs[0];
      var bb = bbox(g.outer.length ? g.outer : [[{ X: 0, Y: 0 }]]), seamX = (bb[0] + bb[2]) / 2, seamY = bb[3] + 1e7;
      function emitLoops(loops, type, seam) {
        var left = loops.slice();
        while (left.length) {
          var bi4 = 0, bd4 = Infinity; left.forEach(function (lp, i2) { var d = Math.hypot(lp[0].X - pos[0], lp[0].Y - pos[1]); if (d < bd4) { bd4 = d; bi4 = i2; } });
          var lp = left.splice(bi4, 1)[0], rl = seam ? startLoopNear(lp, seamX, seamY) : startLoopNear(lp, pos[0], pos[1]);
          items.push({ type: type, pts: toMM(rl), closed: true }); var e = rl[rl.length - 1]; pos = [e.X, e.Y];
        }
      }
      function emitLines(paths, type) {
        orderPaths(paths, pos).forEach(function (p) { items.push({ type: type, pts: toMM(p), closed: false }); var e = p[p.length - 1]; pos = [e.X, e.Y]; });
      }
      if (s.wallOrder === 'outer-inner') { emitLoops(g.outer, 'outer', true); emitLoops(g.inner.reverse(), 'inner', false); }
      else { emitLoops(g.inner.reverse(), 'inner', false); emitLoops(g.outer, 'outer', true); }
      emitLines(g.sparse, 'sparse'); emitLines(g.solid, 'solid'); emitLines(g.top, 'top');
    }
    layers.push({ z: zs[L] + hs[L] / 2, h: hs[L], items: items });
    if (progress && L % 4 === 0) progress(0.6 + 0.3 * L / n, 'Infill and toolpaths');
  }
  return { layers: layers, warnings: warnings, supportTips: supp ? supp.tips : 0 };
}


/* ---------------------------------------------------------------- machine G-code templates
   Vendor profiles use {if cond} {elsif cond} {else} {endif}, {expression} and [variable]. Expressions are JavaScript-compatible
   (==, &&, ||, !, min(), max(), array indexing). Unknown names evaluate to 0 and are reported in `unknown`. */
function expandTemplate(src, env, unknown) {
  unknown = unknown || {};
  var scope = Object.assign({ min: Math.min, max: Math.max, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, 'true': true, 'false': false }, env);
  var proxy = new Proxy(scope, { has: function () { return true; }, get: function (tg, k) { if (k === Symbol.unscopables) return undefined; if (k in tg) return tg[k]; if (typeof k === 'string') unknown[k] = 1; return 0; } });
  function evalExpr(expr) {
    try { return (new Function('env', 'with (env) { return (' + expr + '\n); }'))(proxy); } catch (e) { unknown['(' + expr.trim().slice(0, 40) + ')'] = 1; return ''; }
  }
  function show(v) { if (Array.isArray(v)) v = v[0]; if (typeof v === 'number') return String(+v.toFixed(5)); return v == null ? '' : String(v); }
  var out = [], stack = [], active = true, re = /\{([^{}]*)\}|\[([A-Za-z_]\w*)\]/g, last = 0, m;
  function on() { for (var i = 0; i < stack.length; i++) if (!stack[i].on) return false; return true; }
  while ((m = re.exec(src))) {
    if (active) out.push(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] !== undefined) {
      var body = m[1], kw = /^\s*(if|elsif|else|endif)\b/.exec(body);
      if (kw) {
        var rest = body.slice(kw[0].length);
        if (kw[1] === 'if') { var c = on() ? !!evalExpr(rest) : false; stack.push({ on: c, taken: c }); }
        else if (kw[1] === 'elsif') { var top = stack[stack.length - 1]; if (top) { var par = stack.length > 1 ? stack.slice(0, -1).every(function (x) { return x.on; }) : true; top.on = par && !top.taken && !!evalExpr(rest); if (top.on) top.taken = true; } }
        else if (kw[1] === 'else') { var tp = stack[stack.length - 1]; if (tp) { var par2 = stack.length > 1 ? stack.slice(0, -1).every(function (x) { return x.on; }) : true; tp.on = par2 && !tp.taken; tp.taken = true; } }
        else stack.pop();
        active = on();
      } else if (active) out.push(show(evalExpr(body)));
    } else if (active) { var v = scope[m[2]]; if (!(m[2] in scope)) unknown[m[2]] = 1; out.push(show(v)); }
  }
  if (active) out.push(src.slice(last));
  return out.join('');
}

/* ---------------------------------------------------------------- G-code */
function fmt(v, d) { return (+v.toFixed(d)).toString(); }
function moveTime(len, v, a) { if (len <= 0) return 0; var ramp = v * v / a; return len > ramp ? len / v + v / a : 2 * Math.sqrt(len / a); }

function generateGcode(plan, s, meta) {
  var lay = plan.layers, w = s.lineWidth, fil = s.filamentDiameter, fa = Math.PI * fil * fil / 4;
  var spd = { skirt: s.speedFirst, brim: s.speedFirst, outer: s.speedOuter, inner: s.speedInner, sparse: s.speedSparse, solid: s.speedSolid, top: s.speedTop, support: s.speedSupport };
  var out = [], totalE = 0, totalTime = 0, perLayerTime = [];
  var P = getPrinter(s.printer), unknown = {};
  function eperMM(h, width) { var cs = h * (width - h * (1 - Math.PI / 4)); return cs * s.flow / fa; }
  /* pass 1: ops per layer + time */
  var layerOps = [], cx = null, cy = null;
  lay.forEach(function (layer, li) {
    var ops = [], first = li === 0, h = layer.h, lt = 0, ex = eperMM(h, w);
    layer.items.forEach(function (it) {
      var p = it.pts, x0 = p[0], y0 = p[1], sp = first ? Math.min(spd[it.type] || s.speedFirst, s.speedFirst) : (spd[it.type] || s.speedInner);
      sp = Math.min(sp, s.maxVolumetric / (h * w)); if (!first && it.type === 'sparse') sp = Math.min(sp, s.maxVolumetric / (h * w));
      var travel = cx === null ? 0 : Math.hypot(x0 - cx, y0 - cy);
      ops.push({ k: 'travel', x: x0, y: y0, d: travel, retract: travel > s.retractMinTravel });
      lt += moveTime(travel, s.speedTravel, 20000);
      for (var i = 1; i < p.length / 2; i++) {
        var dx = p[i * 2] - p[i * 2 - 2], dy = p[i * 2 + 1] - p[i * 2 - 1], d = Math.hypot(dx, dy); if (d < 1e-4) continue;
        ops.push({ k: 'ext', x: p[i * 2], y: p[i * 2 + 1], d: d, e: d * ex, v: sp, type: it.type }); lt += moveTime(d, sp, first ? s.accelFirst : s.accel);
      }
      cx = p[p.length - 2]; cy = p[p.length - 1];
    });
    var extTime = 0; ops.forEach(function (o) { if (o.k === 'ext') extTime += o.d / o.v; });
    var f = 1; if (!first && lt < s.minLayerTime && extTime > 0) { var need = s.minLayerTime - (lt - extTime); f = Math.max(0.05, Math.min(1, extTime / Math.max(need, 1e-6))); }
    ops.forEach(function (o) { if (o.k === 'ext') { o.v = Math.max(Math.min(o.v, s.minPrintSpeed), o.v * f); } });
    var t2 = 0; ops.forEach(function (o) { if (o.k === 'ext') t2 += moveTime(o.d, o.v, first ? s.accelFirst : s.accel); else t2 += moveTime(o.d, s.speedTravel, 20000); });
    t2 += 0.4; perLayerTime.push(t2); totalTime += t2; layerOps.push(ops);
  });
  /* pass 2: text */
  var lastTop = lay.length ? lay[lay.length - 1].z : 0, fType = s.filamentType || 'PLA';
  var l0 = lay.length ? lay[0].items : [], bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  l0.forEach(function (it) { if (it.type === 'skirt' || it.type === 'brim') return; for (var q = 0; q < it.pts.length; q += 2) { bx0 = Math.min(bx0, it.pts[q]); bx1 = Math.max(bx1, it.pts[q]); by0 = Math.min(by0, it.pts[q + 1]); by1 = Math.max(by1, it.pts[q + 1]); } });
  if (!isFinite(bx0)) { bx0 = by0 = 0; bx1 = by1 = 1; }
  var vitr = { PLA: 45, TPU: 45, PETG: 70, ABS: 100, ASA: 100 }[fType] || 45;
  var env = {
    max_layer_z: lastTop, max_print_z: lastTop, layer_num: 0, current_layer: 0, total_layer_count: lay.length, printable_height: P.height, print_bed_max: [P.bed[0], P.bed[1]], print_bed_min: [0, 0],
    first_layer_print_min: [bx0, by0], first_layer_print_size: [bx1 - bx0, by1 - by0],
    bed_temperature_initial_layer_single: s.firstBedTemp, bed_temperature_initial_layer: [s.firstBedTemp], bed_temperature: [s.bedTemp],
    nozzle_temperature_initial_layer: [s.firstNozzleTemp], first_layer_temperature: [s.firstNozzleTemp], nozzle_temperature: [s.nozzleTemp], nozzle_temperature_range_high: [P.maxNozzle], flush_temperatures: [s.nozzleTemp],
    filament_type: [fType], filament_max_volumetric_speed: [s.maxVolumetric], flush_volumetric_speeds: [s.maxVolumetric],
    initial_extruder: 0, initial_filament_id: 0, initial_no_support_extruder: 0, initial_no_support_filament_id: 0, initial_nozzle_id: 0, current_filament_id: 0, current_nozzle_id: 0, current_extruder: 0,
    nozzle_diameter: [P.nozzle], nozzle_diameter_at_nozzle_id: [P.nozzle], overall_chamber_temperature: 0, min_vitrification_temperature: vitr, is_all_bbl_filament: false, cooling_filter_enabled: false,
    hold_chamber_temp_for_flat_print: false, has_tpu_in_first_layer: fType === 'TPU', curr_bed_type: s.bedType || 'Textured PEI Plate', enable_pressure_advance: ['false'], pressure_advance: 0.04,
    outer_wall_acceleration: s.accel, travel_speed: s.speedTravel, printer_model: P.model, initial_filament: fType, bed_level_temp: s.firstBedTemp
  };
  var startT = (s.gcodeStart && s.gcodeStart[P.id]) || P.startGcode, endT = (s.gcodeEnd && s.gcodeEnd[P.id]) || P.endGcode;
  out.push('; generated by ' + (meta && meta.app || 'Layerline slicer') + (meta && meta.version ? ' v' + meta.version : ''));
  out.push('; printer: ' + P.name + ' (' + P.nozzle + ' mm nozzle), bed ' + P.bed[0] + ' x ' + P.bed[1] + ' x ' + P.height + ' mm');
  out.push('; layers: ' + lay.length + '  layer_height: ' + s.layerHeight + '  walls: ' + s.walls + '  infill: ' + s.infillDensity + '% ' + s.infillPattern);
  out.push('; estimated printing time (approximate): ' + Math.round(totalTime / 60) + ' min');
  out.push('; filament: ' + fType + '  nozzle ' + s.nozzleTemp + ' C  bed ' + s.bedTemp + ' C');
  if (P.flags) out.push(P.flags.replace(/\n$/, ''));
  out.push(';===== machine start G-code =====');
  out.push(expandTemplate(startT, env, unknown));
  out.push(';===== machine start G-code end =====');
  var remain = totalTime, curE = 0, lastF = -1, lastType = '', z = 0, retracted = false;
  function F(v) { var f = Math.round(v * 60); if (f === lastF) return ''; lastF = f; return ' F' + f; }
  lay.forEach(function (layer, li) {
    var ops = layerOps[li], zt = layer.z;
    out.push(';LAYER_CHANGE'); out.push(';Z:' + fmt(zt, 3)); out.push(';HEIGHT:' + fmt(layer.h, 3));
    if (P.emitM73) out.push('M73 P' + Math.round(100 * li / lay.length) + ' R' + Math.max(0, Math.ceil(remain / 60)));
    remain -= perLayerTime[li];
    if (li === 0) { out.push('M204 S' + s.accelFirst); out.push('M106 S0'); }
    else { if (li === 1) out.push('M204 S' + s.accel); if (li === s.fanFirstOffLayers) out.push('M106 S' + Math.round(s.fan * 2.55)); }
    if (li === 1) { out.push('M104 S' + s.nozzleTemp); out.push('M140 S' + s.bedTemp); }
    /* layer change: retract, lift, move */
    lastType = '';
    if (li === 0) { out.push('G1 Z5 F1200'); lastF = 1200; }
    else {
      if (!retracted) { out.push('G1 E' + fmt(-s.retractLength, 3) + F(s.retractSpeed)); retracted = true; }
      out.push('G1 Z' + fmt(zt + s.zHop, 3) + ' F1200'); lastF = 1200;
    }
    z = zt;
    if (P.layerChangeGcode) { env.layer_num = li; env.current_layer = li; out.push(expandTemplate(P.layerChangeGcode, env, unknown)); }
    ops.forEach(function (o, oi) {
      if (o.k === 'travel') {
        if (o.retract && !retracted) { out.push('G1 E' + fmt(-s.retractLength, 3) + F(s.retractSpeed)); retracted = true; if (s.zHop > 0) { out.push('G1 Z' + fmt(zt + s.zHop, 3) + ' F1200'); lastF = 1200; } }
        out.push('G0 X' + fmt(o.x, 3) + ' Y' + fmt(o.y, 3) + F(s.speedTravel));
        if (li === 0 && oi === 0) { out.push('G1 Z' + fmt(zt, 3) + ' F1200'); lastF = 1200; }
        else if (retracted && s.zHop > 0) { out.push('G1 Z' + fmt(zt, 3) + ' F1200'); lastF = 1200; }
        if (retracted) { out.push('G1 E' + fmt(s.retractLength, 3) + F(s.retractSpeed)); retracted = false; }
      } else {
        if (o.type !== lastType) { out.push(';TYPE:' + ({ outer: 'Outer wall', inner: 'Inner wall', sparse: 'Sparse infill', solid: 'Internal solid infill', top: 'Top surface', skirt: 'Skirt', brim: 'Brim', support: 'Support' }[o.type] || o.type)); lastType = o.type; }
        out.push('G1 X' + fmt(o.x, 3) + ' Y' + fmt(o.y, 3) + ' E' + fmt(o.e, 5) + F(o.v)); totalE += o.e;
      }
    });
  });
  out.push('; --- end of print ---'); out.push('G1 E' + fmt(-s.retractLength, 3) + ' F1800');
  out.push(';===== machine end G-code =====');
  out.push(expandTemplate(endT, env, unknown));
  out.push(';===== machine end G-code end =====');
  var vol = totalE * fa;
  return { gcode: out.join('\n') + '\n', unknown: Object.keys(unknown), stats: { layers: lay.length, timeSec: totalTime, filamentMm: totalE, filamentG: vol / 1000 * s.filamentDensity, volumeMm3: vol } };
}

/* ---------------------------------------------------------------- top level */
function layerPlan(height, s) {
  var zs = [], hs = [], z = 0, h0 = Math.min(s.firstLayerHeight, height);
  zs.push(h0 / 2); hs.push(h0); z = h0;
  while (z + 1e-6 < height) { var h = Math.min(s.layerHeight, height - z); if (h < 0.04) break; zs.push(z + h / 2); hs.push(h); z += h; }
  return { zs: zs, hs: hs };
}
function slice(tris, settings, progress) {
  var s = Object.assign({}, DEFAULTS, settings || {}), b = bounds(tris);
  if (!tris.length) throw new Error('Nothing on the plate to slice.');
  var lp = layerPlan(b[5], s);
  if (progress) progress(0.01, 'Slicing layers');
  var slices = sliceMesh(tris, lp.zs);
  if (progress) progress(0.05, 'Walls');
  var plan = planLayers(slices, lp.zs.map(function (z, i) { return z - lp.hs[i] / 2; }), lp.hs, s, progress);
  /* planLayers reports z as the layer top */
  plan.layers.forEach(function (l, i) { l.z = lp.zs[i] + lp.hs[i] / 2; });
  if (progress) progress(0.92, 'G-code');
  var g = generateGcode(plan, s, { app: 'Layerline slicer', version: s._version });
  plan.gcode = g.gcode; plan.stats = g.stats; plan.unknown = g.unknown; plan.warnings = plan.warnings || []; plan.settings = s;
  if (progress) progress(1, 'Done');
  return plan;
}

var API = { getPrinter: getPrinter, expandTemplate: expandTemplate, PRINTERS: PR.PRINTERS, DEFAULTS: DEFAULTS, parseSTL: parseSTL, parseOBJ: parseOBJ, bounds: bounds, placeTris: placeTris, layFlat: layFlat, sliceMesh: sliceMesh, planLayers: planLayers, generateGcode: generateGcode, slice: slice, layerPlan: layerPlan, _area: area };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Slicer = API;
})(typeof self !== 'undefined' ? self : this);

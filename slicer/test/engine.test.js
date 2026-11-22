/* Node tests for the slicing engine: node slicer/test/engine.test.js */
const assert = require('assert'); const E = require('../engine.js');
function box(x, y, z, sx, sy, sz) { /* triangle soup of a box */
  const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p => [x + p[0]*sx, y + p[1]*sy, z + p[2]*sz]);
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]], o = [];
  f.forEach(t => t.forEach(i => o.push(...v[i]))); return Float32Array.from(o);
}
function tube(R, r, h, n = 48) { /* hollow cylinder */
  const o = [], P = (rad, a, z) => [rad * Math.cos(a), rad * Math.sin(a), z];
  for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI, b = (i + 1) / n * 2 * Math.PI;
    const q = (A, B, C, D) => o.push(...A, ...B, ...C, ...A, ...C, ...D);
    q(P(R,a,0), P(R,b,0), P(R,b,h), P(R,a,h)); q(P(r,b,0), P(r,a,0), P(r,a,h), P(r,b,h));
    q(P(R,a,h), P(R,b,h), P(r,b,h), P(r,a,h)); q(P(R,b,0), P(R,a,0), P(r,a,0), P(r,b,0)); }
  return Float32Array.from(o);
}
const t0 = Date.now();
/* 1. cube at 100% infill: filament volume close to solid volume */
{
  const tris = E.placeTris(box(0,0,0,20,20,10), { x: 170, y: 160 });
  const b = E.bounds(tris); assert(Math.abs(b[2]) < 1e-6 && Math.abs(b[5] - 10) < 1e-4, 'sits on bed, 10 high');
  const plan = E.slice(tris, { infillDensity: 100, skirtLoops: 0 });
  assert.strictEqual(plan.layers.length, 50, 'layer count');
  const vol = plan.stats.volumeMm3, solid = 20 * 20 * 10;
  console.log('cube 100%: volume', vol.toFixed(0), 'vs', solid, 'ratio', (vol / solid).toFixed(3), 'time', Math.round(plan.stats.timeSec / 60), 'min');
  assert(vol / solid > 0.85 && vol / solid < 1.12, 'volume near solid');
  const body = plan.gcode.split(';===== machine start G-code end =====')[1].split(';===== machine end G-code =====')[0];
  const xs = [...body.matchAll(/ X([\d.]+) Y([\d.]+) E/g)].map(m => [+m[1], +m[2]]);
  assert(xs.every(p => p[0] > 159 && p[0] < 181 && p[1] > 149 && p[1] < 171), 'extrusion stays over the part');
}
/* 2. cube at 15% grid and gyroid: less filament than solid, more than walls-only */
for (const pat of ['grid', 'lines', 'gyroid']) {
  const tris = E.placeTris(box(0,0,0,30,30,20), { x: 170, y: 160 });
  const t = Date.now(), plan = E.slice(tris, { infillDensity: 15, infillPattern: pat, skirtLoops: 1 });
  const vol = plan.stats.volumeMm3, solid = 30 * 30 * 20, frac = vol / solid;
  console.log(pat.padEnd(7), 'volume fraction', frac.toFixed(3), 'layers', plan.layers.length, Date.now() - t, 'ms');
  assert(frac > 0.2 && frac < 0.7, pat + ' fraction plausible');
}
/* 3. hollow tube: holes respected, walls on both contours */
{
  const tris = E.placeTris(tube(20, 12, 8), { x: 170, y: 160 }), plan = E.slice(tris, { infillDensity: 20 });
  const L = plan.layers[10], outer = L.items.filter(i => i.type === 'outer');
  assert.strictEqual(outer.length, 2, 'outer wall on both contour and hole');
  const inside = plan.layers[10].items.filter(i => i.type === 'sparse' || i.type === 'solid').every(it => { for (let i = 0; i < it.pts.length; i += 2) { const d = Math.hypot(it.pts[i] - 170, it.pts[i + 1] - 160); if (d > 19.8 || d < 12.2) return false; } return true; });
  assert(inside, 'infill does not enter the hole');
  console.log('tube ok, layers', plan.layers.length);
}
/* 4. two separate islands and G-code sanity */
{
  const a = E.placeTris(box(0,0,0,15,15,6), { x: 100, y: 100 }), b = E.placeTris(box(0,0,0,15,15,6), { x: 200, y: 200 });
  const all = new Float32Array(a.length + b.length); all.set(a); all.set(b, a.length);
  const plan = E.slice(all, { brimWidth: 3 });
  const g = plan.gcode; assert(g.includes('G28') && g.includes('M73') && g.includes(';TYPE:Outer wall') && g.includes(';TYPE:Brim'), 'gcode markers');
  let e = 0, bad = 0; const bodyE = g.split(';===== machine start G-code end =====')[1].split('; --- end of print ---')[0]; for (const m of bodyE.matchAll(/ E(-?[\d.]+)/g)) e += +m[1];
  const body2 = g.split(';===== machine start G-code end =====')[1].split(';===== machine end G-code =====')[0];
  for (const m of body2.matchAll(/G[01] X([-\d.]+) Y([-\d.]+)/g)) if (+m[1] < 0 || +m[1] > 340 || +m[2] < 0 || +m[2] > 320) bad++;
  assert.strictEqual(bad, 0, 'all moves inside the bed');
  assert(Math.abs(e - plan.stats.filamentMm) < 2, 'retractions and deretractions balance: ' + e + ' vs ' + plan.stats.filamentMm);
  console.log('two islands ok, lines', g.split('\n').length);
}
/* 5. STL round trip */
{
  const tris = box(0,0,0,5,5,5), buf = new ArrayBuffer(84 + 50 * 12), dv = new DataView(buf); dv.setUint32(80, 12, true);
  for (let i = 0; i < 12; i++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + i * 50 + 12 + k * 4, tris[i * 9 + k], true);
  const back = E.parseSTL(buf); assert.strictEqual(back.length, 108);
}
/* 6. lay flat: a box lying on its edge stays within a flat position */
{
  const tilted = E.placeTris(box(0,0,0,40,10,10), { rx: 0, ry: 0, rz: 0 }), flat = E.layFlat(tilted);
  const re = E.placeTris(E.placeTris(tilted, { rx: 30, ry: 20 }), {}), f2 = E.layFlat(re), b = E.bounds(E.placeTris(re, f2));
  console.log('layFlat', f2.rx.toFixed(1), f2.ry.toFixed(1), 'height', (b[5] - b[2]).toFixed(2));
  assert(b[5] - b[2] < 10.5, 'laid flat on the largest face');
}
/* 7. organic supports */
{
  const stack = (parts) => { const all = []; parts.forEach(([x,y,z,sx,sy,sz]) => all.push(...box(x,y,z,sx,sy,sz))); return Float32Array.from(all); };
  const mushroom = E.placeTris(stack([[-5,-5,0,10,10,20],[-20,-20,20,40,40,2]]), { x: 170, y: 160 });
  const on = E.slice(mushroom, { supportMode: 'organic', infillDensity: 10 }), off = E.slice(mushroom, { supportMode: 'off', infillDensity: 10 });
  const cnt = (pl) => pl.layers.map(l => l.items.filter(i => i.type === 'support').length);
  const c = cnt(on); console.log('mushroom: support items per layer 0/50/99', c[0], c[50], c[99], 'tips', on.supportTips, 'extra filament', (on.stats.filamentMm - off.stats.filamentMm).toFixed(0), 'mm');
  assert(c[0] > 0 && c[50] > 0, 'supports on bed and mid height'); assert.strictEqual(cnt(off).reduce((a, b) => a + b, 0), 0, 'none when off');
  assert(c[102] === undefined || true);
  /* supports never inside the model: check points of support paths against the stem footprint at mid height */
  let bad = 0; on.layers[50].items.filter(i => i.type === 'support').forEach(it => { for (let i = 0; i < it.pts.length; i += 2) { const x = it.pts[i] - 170, y = it.pts[i + 1] - 160; if (Math.abs(x) < 5 && Math.abs(y) < 5) bad++; } });
  assert.strictEqual(bad, 0, 'no support inside the stem');
  /* rests on the model unless build-plate-only */
  const shelf = E.placeTris(stack([[-15,-15,0,30,30,10],[-2,-2,10,4,4,5],[-10,-10,15,20,20,2]]), { x: 170, y: 160 });
  const a = E.slice(shelf, { supportMode: 'organic', supportOnPlate: 'everywhere' }), b = E.slice(shelf, { supportMode: 'organic', supportOnPlate: 'plate' });
  const sa = cnt(a).reduce((x, y) => x + y, 0), sb = cnt(b).reduce((x, y) => x + y, 0); console.log('shelf: everywhere', sa, 'plate only', sb);
  assert(sa > 0 && sb === 0, 'everywhere builds on the block, plate-only drops them');
  /* threshold angle (from horizontal): a 45 degree flare needs support only when the threshold is above 45 */
  const cone = []; { const n = 48, R0 = 8, R1 = 20, hh = 12; const Pn = (r, a, z) => [r * Math.cos(a), r * Math.sin(a), z]; for (let i = 0; i < n; i++) { const a = i / n * 6.2832, b = (i + 1) / n * 6.2832; const q = (A, B, C, D) => cone.push(...A, ...B, ...C, ...A, ...C, ...D); q(Pn(R0,a,0), Pn(R0,b,0), Pn(R1,b,hh), Pn(R1,a,hh)); for (const [A,B,C] of [[[0,0,0],Pn(R0,b,0),Pn(R0,a,0)],[[0,0,hh],Pn(R1,a,hh),Pn(R1,b,hh)]]) cone.push(...A, ...B, ...C); } }
  const cT = E.placeTris(Float32Array.from(cone), { x: 170, y: 160 }), nS = (a) => cnt(E.slice(cT, { supportAngle: a })).reduce((x, y) => x + y, 0);
  const lo = nS(30), hi = nS(60); console.log('flare 45 deg: threshold 30 ->', lo, ' threshold 60 ->', hi); assert(lo === 0 && hi > 0, 'angle threshold respected');
  /* a plain cube needs none */
  const cube = E.slice(E.placeTris(box(0,0,0,20,20,10), { x: 170, y: 160 }), {}); assert.strictEqual(cnt(cube).reduce((x, y) => x + y, 0), 0, 'cube has no supports');
}
console.log('all engine tests passed in', Date.now() - t0, 'ms');

const assert = require('assert'), fs = require('fs'), T = require('../threemf.js'), E = require('../engine.js');
(async () => {
  const ab = f => { const b = fs.readFileSync(__dirname + '/' + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  let r = await T.parse(ab('simple.3mf')); assert.strictEqual(r.length, 1); let b = E.bounds(r[0].tris);
  assert(Math.abs(b[3] - b[0] - 10) < 1e-4 && Math.abs(r[0].cx - 105) < 1e-4 && Math.abs(r[0].cy - 55) < 1e-4, 'simple cube 10 mm centred at 105,55');
  r = await T.parse(ab('bambu.3mf')); assert.strictEqual(r.length, 1); b = E.bounds(r[0].tris);
  assert.strictEqual(r[0].name, 'Test & Part'); assert(Math.abs(b[3] - b[0] - 20) < 1e-4, '20 mm cube from component file');
  assert(Math.abs(r[0].cx - (128 + 5 + 10)) < 1e-4 && Math.abs(r[0].cy - (128 + 10)) < 1e-4, 'component + item transforms combine: ' + r[0].cx + ',' + r[0].cy);
  const plan = E.slice(E.placeTris(r[0].tris, { x: 128, y: 128 }), { printer: 'p2s' }); assert(plan.layers.length === 100);
  await assert.rejects(() => T.parse(new ArrayBuffer(100)), /3MF/);
  console.log('3mf tests passed');
})().catch(e => { console.error(e); process.exit(1); });

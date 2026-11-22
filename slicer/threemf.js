/* ============================ threemf.js ============================
   Reads .3mf files (a zip of XML) from Bambu Studio, OrcaSlicer, PrusaSlicer, Cura and most CAD tools.
   parse(arrayBuffer) -> Promise<[{ name, tris: Float32Array (mm), cx, cy }]>, one entry per object on the plate.
   Geometry only: slicer settings, painted supports and colours inside the file are ignored. */
(function (root) {
'use strict';

/* ---------------------------------------------------------------- zip */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip 3MF files. Use a current Chrome, Edge, Firefox or Safari.');
  var ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
async function readZip(buf) {
  var u8 = new Uint8Array(buf), dv = new DataView(buf), eocd = -1;
  for (var i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This does not look like a 3MF (zip) file.');
  var n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true), files = {}, dec = new TextDecoder();
  for (var k = 0; k < n; k++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('The 3MF file is damaged.');
    var method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
    var name = dec.decode(u8.subarray(off + 46, off + 46 + nl));
    files[name] = { method: method, csize: csize, lho: lho }; off += 46 + nl + el + cl;
  }
  async function read(name) {
    var f = files[name]; if (!f) return null;
    var lh = f.lho, ln = dv.getUint16(lh + 26, true), le = dv.getUint16(lh + 28, true), start = lh + 30 + ln + le, data = u8.subarray(start, start + f.csize);
    if (f.method === 0) return dec.decode(data);
    if (f.method === 8) return dec.decode(await inflateRaw(data));
    throw new Error('Unsupported compression in the 3MF file.');
  }
  return { names: Object.keys(files), read: read };
}

/* ---------------------------------------------------------------- xml (just what a model file needs) */
function attrs(s) { var o = {}, re = /([\w:.-]+)\s*=\s*"([^"]*)"/g, m; while ((m = re.exec(s))) o[m[1].replace(/^.*:/, "")] = m[2]; return o; }
function parseModel(xml) {
  var unit = (/<model[^>]*\bunit="(\w+)"/.exec(xml) || [])[1] || 'millimeter';
  var scale = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[unit] || 1;
  var objects = {}, items = [], cur = null, inMesh = false, re = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>/g, m;
  while ((m = re.exec(xml))) {
    var close = m[1] === '/', tag = m[2].replace(/^.*:/, ''), self = m[4] === '/';
    if (tag === 'object' && !close) { var a = attrs(m[3]); cur = { id: a.id, type: a.type || 'model', verts: [], tris: [], comps: [] }; objects[a.id] = cur; if (self) cur = null; }
    else if (tag === 'object' && close) cur = null;
    else if (!cur && tag === 'item' && !close) { var ia = attrs(m[3]); items.push({ id: ia.objectid, tf: ia.transform }); }
    else if (cur && tag === 'vertex' && !close) { var va = attrs(m[3]); cur.verts.push(+va.x * scale, +va.y * scale, +va.z * scale); }
    else if (cur && tag === 'triangle' && !close) { var ta = attrs(m[3]); cur.tris.push(+ta.v1, +ta.v2, +ta.v3); }
    else if (cur && tag === 'component' && !close) { var ca = attrs(m[3]); cur.comps.push({ id: ca.objectid, path: ca.path, tf: ca.transform }); }
  }
  return { objects: objects, items: items, scale: scale };
}
function mat(tf) { /* 3MF row-vector convention: x' = x*m00 + y*m10 + z*m20 + m30 */
  if (!tf) return null; var v = tf.trim().split(/\s+/).map(Number); return v.length === 12 && v.every(isFinite) ? v : null;
}
function mul(a, b) { /* apply a first, then b, both 4x3 row-vector matrices */
  if (!a) return b; if (!b) return a;
  var r = new Array(12);
  for (var i = 0; i < 4; i++) for (var j = 0; j < 3; j++) { var s = i === 3 ? b[9 + j] : 0; for (var k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j]; r[i * 3 + j] = s; }
  return r;
}

/* ---------------------------------------------------------------- build */
async function parse(buf) {
  var zip = await readZip(buf), rels = await zip.read('_rels/.rels') || '', rootPath = '3D/3dmodel.model';
  var rm = /Target="\/?([^"]*\.model)"[^>]*Type="[^"]*3dmodel"|Type="[^"]*3dmodel"[^>]*Target="\/?([^"]*\.model)"/.exec(rels); if (rm) rootPath = rm[1] || rm[2];
  var rootXml = await zip.read(rootPath); if (!rootXml) throw new Error('No 3D model found inside the 3MF file.');
  var models = {}; models[rootPath] = parseModel(rootXml);
  async function modelAt(p) { p = (p || rootPath).replace(/^\//, ''); if (!models[p]) { var x = await zip.read(p); if (!x) throw new Error('The 3MF file refers to a missing part: ' + p); models[p] = parseModel(x); } return models[p]; }
  /* names from Bambu / Orca project settings, if present */
  var names = {}, cfg = await zip.read('Metadata/model_settings.config');
  if (cfg) { var om, ore = /<object\s+id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g; while ((om = ore.exec(cfg))) { var nm = /<metadata\s+key="name"\s+value="([^"]*)"/.exec(om[2]); if (nm) names[om[1]] = nm[1].replace(/&amp;/g, '&'); } }
  var root_ = models[rootPath], items = root_.items.length ? root_.items : Object.keys(root_.objects).filter(function (id) { return root_.objects[id].type !== 'support'; }).map(function (id) { return { id: id, tf: null }; });
  var out = [];
  for (var it = 0; it < items.length; it++) {
    var parts = [], total = 0;
    async function collect(model, id, tf, depth) {
      var o = model.objects[id]; if (!o || depth > 8) return;
      if (o.verts.length && o.tris.length) {
        var arr = new Float32Array(o.tris.length * 3);
        for (var t = 0; t < o.tris.length; t++) {
          var vi = o.tris[t] * 3; if (vi + 2 >= o.verts.length) continue;
          var x = o.verts[vi], y = o.verts[vi + 1], z = o.verts[vi + 2];
          if (tf) { var nx = x * tf[0] + y * tf[3] + z * tf[6] + tf[9], ny = x * tf[1] + y * tf[4] + z * tf[7] + tf[10], nz = x * tf[2] + y * tf[5] + z * tf[8] + tf[11]; x = nx; y = ny; z = nz; }
          arr[t * 3] = x; arr[t * 3 + 1] = y; arr[t * 3 + 2] = z;
        }
        parts.push(arr); total += arr.length;
      }
      for (var c = 0; c < o.comps.length; c++) {
        var cp = o.comps[c], sub = cp.path ? await modelAt(cp.path) : model, ctf = mul(mat(cp.tf), tf);
        /* a component's own transform is applied first, then its parent's */
        await collect(sub, cp.id, ctf, depth + 1);
      }
    }
    var it0 = items[it]; if (root_.objects[it0.id] && root_.objects[it0.id].type === 'support') continue;
    await collect(root_, it0.id, mat(it0.tf), 0);
    if (!total) continue;
    var tris = new Float32Array(total), k = 0; parts.forEach(function (p) { tris.set(p, k); k += p.length; });
    var b = [Infinity, Infinity, -Infinity, -Infinity]; for (var q = 0; q < tris.length; q += 3) { if (tris[q] < b[0]) b[0] = tris[q]; if (tris[q] > b[2]) b[2] = tris[q]; if (tris[q + 1] < b[1]) b[1] = tris[q + 1]; if (tris[q + 1] > b[3]) b[3] = tris[q + 1]; }
    out.push({ name: names[it0.id] || ('Object ' + it0.id), tris: tris, cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2 });
  }
  if (!out.length) throw new Error('That 3MF file has no printable mesh in it.');
  return out;
}

var API = { parse: parse };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.ThreeMF = API;
})(typeof self !== 'undefined' ? self : this);

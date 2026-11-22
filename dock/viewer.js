/* ============================ viewer.js ============================
   three.js scene: protein trace, pocket sticks, ligand ball-and-stick, search box, H-bonds. */
(function (root) {
'use strict';
const CPK = { H: 0xf2f2f2, C: 0x909aa5, N: 0x3a5bf0, O: 0xe8332a, S: 0xe0b400, P: 0xff8c1a, F: 0x2fb35a, Cl: 0x2fb35a, Br: 0xa23e1e, I: 0x8a3fb0, B: 0xe0a080, Si: 0xc0a080, Se: 0xc08040 };
const RAD = { H: 0.5, C: 0.75, N: 0.72, O: 0.7, S: 0.95, P: 0.95, F: 0.65, Cl: 0.9, Br: 1.0, I: 1.1 };
const SURFCOL = [[0.44, 0.47, 0.52], [0.30, 0.40, 0.70], [0.70, 0.34, 0.32], [0.68, 0.58, 0.24]]; // carbon, nitrogen, oxygen, sulfur (muted)
const CHAIN = [0x6f8fae, 0xae8f6f, 0x7fae8f, 0xae6f8f, 0x8f6fae, 0xaeae6f];

class Viewer {
  constructor(host) {
    this.host = host; this.layers = {}; this.dirty = true; this.dark = false; this.dist = 60; this.pointers = new Map();
    const T = root.THREE; if (!T) throw new Error('three.js did not load');
    this.T = T;
    const r = this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.localClippingEnabled = true; this.cut = 0; this.surfPlane = new T.Plane(new T.Vector3(0, 0, -1), 0);
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
    host.appendChild(r.domElement);
    this.scene = new T.Scene(); this.camera = new T.PerspectiveCamera(35, 1, 1, 3000); this.camera.position.set(0, 0, this.dist);
    this.pivot = new T.Group(); this.root = new T.Group(); this.pivot.add(this.root); this.scene.add(this.pivot);
    this.scene.add(new T.AmbientLight(0xffffff, 0.62)); const d1 = new T.DirectionalLight(0xffffff, 0.75); d1.position.set(30, 50, 80); this.scene.add(d1);
    const d2 = new T.DirectionalLight(0xffffff, 0.25); d2.position.set(-40, -20, 30); this.scene.add(d2);
    this._bind(); new ResizeObserver(() => this.resize()).observe(host); this.resize(); this._loop();
  }
  _bind() {
    const el = this.renderer.domElement, P = this.pointers;
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); P.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, s: e.shiftKey }); el.style.cursor = 'grabbing'; });
    el.addEventListener('pointermove', e => {
      const p = P.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (P.size === 2) { const o = [...P.entries()].find(([k]) => k !== e.pointerId)[1], d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y); this.dist = Math.min(600, Math.max(4, this.dist * d0 / (d1 || 1))); this._cam(); }
      else if (p.b === 2 || p.b === 1 || p.s) { const k = this.dist * Math.tan(17.5 * Math.PI / 180) * 2 / this.host.clientHeight; this.pivot.position.x += dx * k; this.pivot.position.y -= dy * k; }
      else { const T = this.T, q = new T.Quaternion().setFromEuler(new T.Euler(dy * 0.008, dx * 0.008, 0, 'XYZ')); this.pivot.quaternion.premultiply(q); }
      p.x = e.clientX; p.y = e.clientY; this.dirty = true; });
    const up = e => { P.delete(e.pointerId); el.style.cursor = 'grab'; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { e.preventDefault(); this.dist = Math.min(600, Math.max(4, this.dist * Math.exp(e.deltaY * 0.0015))); this._cam(); }, { passive: false });
    el.addEventListener('dblclick', () => this.resetRotation());
  }
  _cam() { this.camera.position.z = this.dist; this.camera.near = Math.max(0.5, this.dist - (this.clipFront != null ? this.clipFront : (this.slab || 200))); this.camera.far = this.dist + (this.slab || 400); this.camera.updateProjectionMatrix(); this.dirty = true; }
  resize() { const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.dirty = true; }
  _loop() { const f = () => { if (this.dirty) { this.dirty = false; this.surfPlane.constant = this.pivot.position.z + this.cut; this.renderer.render(this.scene, this.camera); } requestAnimationFrame(f); }; f(); }
  resetRotation() { this.pivot.quaternion.identity(); this.pivot.position.set(0, 0, 0); this.dirty = true; }
  frame(c, radius) { this.slab = 0; this.clipFront = null; this.root.position.set(-c[0], -c[1], -c[2]); this.pivot.position.set(0, 0, 0); this.dist = Math.max(10, radius * 2.7); this._cam(); }
  clearLayer(n) { const o = this.layers[n]; if (!o) return; this.root.remove(o); o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose()); }); delete this.layers[n]; this.dirty = true; }
  _put(n, o) { this.clearLayer(n); this.layers[n] = o; this.root.add(o); this.dirty = true; }
  show(n, on) { if (this.layers[n]) { this.layers[n].visible = on; this.dirty = true; } }

  /* ball-and-stick / stick model from arrays */
  sticks(name, { pos, el, bonds, carbon, ball = 0.28, stick = 0.13, skip }) {
    const T = this.T, n = el.length, keep = []; for (let i = 0; i < n; i++) if (!skip || !skip(i)) keep.push(i);
    const g = new T.Group(); if (!keep.length) { this._put(name, g); return; }
    const sph = new T.InstancedMesh(new T.SphereGeometry(1, 14, 10), new T.MeshLambertMaterial(), keep.length), m4 = new T.Matrix4(), col = new T.Color();
    const colOf = i => el[i] === 'C' && carbon != null ? carbon : (CPK[el[i]] ?? 0xcc66cc), vis = new Set(keep);
    keep.forEach((i, k) => { const r = (RAD[el[i]] || 0.8) * ball * (ball > 0.2 ? 1 : 1); m4.makeScale(r, r, r); m4.setPosition(pos[3*i], pos[3*i+1], pos[3*i+2]); sph.setMatrixAt(k, m4); sph.setColorAt(k, col.setHex(colOf(i))); });
    g.add(sph);
    const bl = []; for (let b = 0; b < bonds.length; b += 2) if (vis.has(bonds[b]) && vis.has(bonds[b+1])) bl.push([bonds[b], bonds[b+1]]);
    if (bl.length) {
      const cyl = new T.InstancedMesh(new T.CylinderGeometry(1, 1, 1, 8, 1, true), new T.MeshLambertMaterial(), bl.length * 2), up = new T.Vector3(0, 1, 0), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(); let k = 0;
      for (const [a, b] of bl) {
        const A = new T.Vector3(pos[3*a], pos[3*a+1], pos[3*a+2]), B = new T.Vector3(pos[3*b], pos[3*b+1], pos[3*b+2]), d = B.clone().sub(A), L = d.length(); if (L < 1e-3) { k += 2; continue; } d.normalize(); q.setFromUnitVectors(up, d);
        for (const [s, i] of [[0, a], [1, b]]) { const mid = A.clone().add(B.clone().sub(A).multiplyScalar(s ? 0.75 : 0.25)); m4.compose(mid, q, sc.set(stick, L / 2, stick)); cyl.setMatrixAt(k, m4); cyl.setColorAt(k, col.setHex(colOf(i))); k++; }
      }
      g.add(cyl);
    }
    this._put(name, g); return g;
  }
  trace(name, rec) {
    const T = this.T, g = new T.Group(), chains = new Map();
    for (let i = 0; i < rec.n; i++) { const m = rec.meta[i]; if (m.name !== 'CA' || m.het) continue; let c = chains.get(m.chain); if (!c) chains.set(m.chain, c = []); c.push(new T.Vector3(rec.X[3*i], rec.X[3*i+1], rec.X[3*i+2])); }
    let ci = 0;
    for (const pts of chains.values()) { const segs = [[]]; pts.forEach((p, k) => { if (k && p.distanceTo(pts[k-1]) > 4.8) segs.push([]); segs[segs.length - 1].push(p); });
      for (const s of segs) { if (s.length < 3) continue; const geo = new T.TubeGeometry(new T.CatmullRomCurve3(s), s.length * 3, 0.32, 6, false);
        g.add(new T.Mesh(geo, new T.MeshLambertMaterial({ color: CHAIN[ci % CHAIN.length], transparent: true, opacity: this.dark ? 0.62 : 0.72 }))); } ci++; }
    this._put(name, g);
  }
  box(name, box) {
    const T = this.T, g = new T.Group(), geo = new T.BoxGeometry(box.s[0], box.s[1], box.s[2]);
    const ln = new T.LineSegments(new T.EdgesGeometry(geo), new T.LineBasicMaterial({ color: this.dark ? 0xd97757 : 0xc15f3c })); g.add(ln);
    g.add(new T.Mesh(geo, new T.MeshBasicMaterial({ color: this.dark ? 0xd97757 : 0xc15f3c, transparent: true, opacity: 0.05, depthWrite: false })));
    g.position.set(box.c[0], box.c[1], box.c[2]); this._put(name, g);
  }
  points(name, pts, color = 0xf0a030) {
    const T = this.T, g = new T.Group(); if (!pts.length) { this._put(name, g); return; }
    const m = new T.InstancedMesh(new T.SphereGeometry(0.28, 8, 6), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }), pts.length), m4 = new T.Matrix4();
    pts.forEach((p, i) => { m4.setPosition(p[0], p[1], p[2]); m.setMatrixAt(i, m4); }); g.add(m); this._put(name, g);
  }
  dashes(name, segs, color = 0xe0a030) {
    const T = this.T, g = new T.Group(); if (segs.length) { const arr = []; segs.forEach(s => arr.push(...s[0], ...s[1]));
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(arr, 3));
      const l = new T.LineSegments(geo, new T.LineDashedMaterial({ color, dashSize: 0.22, gapSize: 0.14 })); l.computeLineDistances(); g.add(l); }
    this._put(name, g);
  }
  labels(name, items, color = '#d6336c') {
    const T = this.T, g = new T.Group();
    for (const it of items) { const c = document.createElement('canvas'), x = c.getContext('2d'), f = 44; x.font = '600 ' + f + 'px "IBM Plex Sans",system-ui,sans-serif';
      const w = Math.ceil(x.measureText(it.text).width) + 20; c.width = w; c.height = f + 20; x.font = '600 ' + f + 'px "IBM Plex Sans",system-ui,sans-serif'; x.textBaseline = 'middle';
      x.lineWidth = 8; x.strokeStyle = this.dark ? '#10171d' : '#ffffff'; x.strokeText(it.text, 10, c.height / 2); x.fillStyle = color; x.fillText(it.text, 10, c.height / 2);
      const tex = new T.CanvasTexture(c), sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); sp.renderOrder = 10;
      sp.scale.set(c.width / c.height * 1.0, 1.0, 1); sp.center.set(0, 0); sp.position.set(it.p[0] + 0.3, it.p[1] + 0.3, it.p[2]); g.add(sp); }
    this._put(name, g);
  }
  /* Gaussian-blob surface (marching tetrahedra) of the atoms in [lo,hi]. pts: xyz array, rad: radii. */
  surface(name, pts, rad, lo, hi, o = {}) {
    const T = this.T, h = o.h || 0.8, B = o.B || 2.5, iso = o.iso || 1.0, n = rad.length;
    const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1, f = new Float32Array(nx * ny * nz), cr = new Float32Array(nx * ny * nz), cgc = new Float32Array(nx * ny * nz), cb = new Float32Array(nx * ny * nz), idx = (i, j, k) => (k * ny + j) * nx + i;
    for (let a = 0; a < n; a++) {
      const x = pts[3*a], y = pts[3*a+1], z = pts[3*a+2], r = rad[a], rc = r * 2.2, r2 = r * r, ac = SURFCOL[o.cls ? o.cls[a] : 0] || SURFCOL[0];
      const i0 = Math.max(0, Math.ceil((x - rc - lo[0]) / h)), i1 = Math.min(nx - 1, Math.floor((x + rc - lo[0]) / h)), j0 = Math.max(0, Math.ceil((y - rc - lo[1]) / h)), j1 = Math.min(ny - 1, Math.floor((y + rc - lo[1]) / h)), k0 = Math.max(0, Math.ceil((z - rc - lo[2]) / h)), k1 = Math.min(nz - 1, Math.floor((z + rc - lo[2]) / h));
      for (let k = k0; k <= k1; k++) { const dz = lo[2] + k * h - z; for (let j = j0; j <= j1; j++) { const dy = lo[1] + j * h - y, dzy = dz * dz + dy * dy; for (let i = i0; i <= i1; i++) { const dx = lo[0] + i * h - x, d2 = dx * dx + dzy + 0; if (d2 < rc * rc) { const q = idx(i, j, k), e = Math.exp(B * (1 - d2 / r2)); f[q] += e; cr[q] += e * ac[0]; cgc[q] += e * ac[1]; cb[q] += e * ac[2]; } } } }
    }
    for (let q = 0; q < f.length; q++) { const s = f[q]; if (s > 1e-6) { cr[q] /= s; cgc[q] /= s; cb[q] /= s; } else { cr[q] = SURFCOL[0][0]; cgc[q] = SURFCOL[0][1]; cb[q] = SURFCOL[0][2]; } } // smooth, atom-weighted colour at every node
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) f[idx(i, j, k)] = 0; // zero border: closes the surface at the edge of the region
    const CO = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]], TET = [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
    const grad = (i, j, k) => { const c = (a, b, d) => f[idx(Math.min(nx-1, Math.max(0, a)), Math.min(ny-1, Math.max(0, b)), Math.min(nz-1, Math.max(0, d)))]; return [c(i+1,j,k) - c(i-1,j,k), c(i,j+1,k) - c(i,j-1,k), c(i,j,k+1) - c(i,j,k-1)]; };
    const P = [], N = [], Cc = [], cv = new Array(8), cp = new Array(8), cg = new Array(8), ci = new Array(8);
    const edge = (a, b) => { const fa = cv[a], fb = cv[b], t = (iso - fa) / (fb - fa), pa = cp[a], pb = cp[b], ga = cg[a], gb = cg[b]; const ia = ci[a], ib = ci[b]; return { c: [cr[ia] + t * (cr[ib] - cr[ia]), cgc[ia] + t * (cgc[ib] - cgc[ia]), cb[ia] + t * (cb[ib] - cb[ia])], p: [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1]), pa[2] + t * (pb[2] - pa[2])], g: [ga[0] + t * (gb[0] - ga[0]), ga[1] + t * (gb[1] - ga[1]), ga[2] + t * (gb[2] - ga[2])] }; };
    const tri = (A, Bv, C) => { const u = [Bv.p[0]-A.p[0], Bv.p[1]-A.p[1], Bv.p[2]-A.p[2]], w = [C.p[0]-A.p[0], C.p[1]-A.p[1], C.p[2]-A.p[2]], c = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]];
      const gs = [A.g[0]+Bv.g[0]+C.g[0], A.g[1]+Bv.g[1]+C.g[1], A.g[2]+Bv.g[2]+C.g[2]], flip = (c[0]*gs[0] + c[1]*gs[1] + c[2]*gs[2]) > 0; // outward normal = -gradient
      const L = flip ? [A, C, Bv] : [A, Bv, C]; for (const q of L) { P.push(q.p[0], q.p[1], q.p[2]); Cc.push(q.c[0], q.c[1], q.c[2]); const m = Math.hypot(q.g[0], q.g[1], q.g[2]) || 1; N.push(-q.g[0] / m, -q.g[1] / m, -q.g[2] / m); } };
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      let mn = Infinity, mx = -Infinity; for (let c = 0; c < 8; c++) { const o2 = CO[c], val = f[idx(i + o2[0], j + o2[1], k + o2[2])]; cv[c] = val; if (val < mn) mn = val; if (val > mx) mx = val; }
      if (mx < iso || mn >= iso) continue;
      for (let c = 0; c < 8; c++) { const o2 = CO[c]; cp[c] = [lo[0] + (i + o2[0]) * h, lo[1] + (j + o2[1]) * h, lo[2] + (k + o2[2]) * h]; cg[c] = grad(i + o2[0], j + o2[1], k + o2[2]); ci[c] = idx(i + o2[0], j + o2[1], k + o2[2]); }
      for (const t of TET) { const ins = [], out = []; t.forEach(c => (cv[c] >= iso ? ins : out).push(c));
        if (ins.length === 1) tri(edge(ins[0], out[0]), edge(ins[0], out[1]), edge(ins[0], out[2]));
        else if (ins.length === 3) tri(edge(out[0], ins[0]), edge(out[0], ins[1]), edge(out[0], ins[2]));
        else if (ins.length === 2) { const q0 = edge(ins[0], out[0]), q1 = edge(ins[0], out[1]), q2 = edge(ins[1], out[1]), q3 = edge(ins[1], out[0]); tri(q0, q1, q2); tri(q0, q2, q3); } }
    }
    const g = new T.Group(); if (P.length) { const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); geo.setAttribute('color', new T.Float32BufferAttribute(Cc, 3));
      const m = new T.Mesh(geo, new T.MeshLambertMaterial({ vertexColors: true, side: T.FrontSide, clippingPlanes: [this.surfPlane] })); m.renderOrder = 1; g.add(m);
      /* where the cut opens the surface you see its inside; a flat colour there reads as a solid cross-section instead of a hollow shell */
      const cap = new T.Mesh(geo, new T.MeshBasicMaterial({ color: this.dark === false ? 0xcfc7b8 : 0x8c8173, side: T.BackSide, clippingPlanes: [this.surfPlane] })); cap.renderOrder = 0; g.add(cap); }
    this._put(name, g); return P.length / 9;
  }
  snapshot(w, h) {
    const r = this.renderer, c = r.domElement, pr = r.getPixelRatio(); r.setPixelRatio(1); r.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.surfPlane.constant = this.pivot.position.z + this.cut; r.render(this.scene, this.camera);
    const url = c.toDataURL('image/png'); r.setPixelRatio(pr); this.resize(); this.dirty = true; return url;
  }
}
root.Viewer = Viewer;
})(typeof window !== 'undefined' ? window : globalThis);

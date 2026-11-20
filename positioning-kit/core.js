/* Positioning Kit core: parameters, signed-distance models, surface-nets mesher, STL + ZIP writers. No dependencies. */
(function (root) {
'use strict';
const rad = d => d * Math.PI / 180;
const DEFAULTS = {
  peg_d: 30, peg_h: 16, tol: 0.35, wall: 5, oh: 45, bridge: 10,
  limb_d: 90, clearance: 4, saddle_len: 100, trough_frac: 0.5, wing_t: 9, strap_w: 25, strap_t: 3.5, drain_d: 6,
  dish_l: 170, dish_w: 150, dish_depth: 38, dish_rim: 8, dish_floor: 12, neck_len: 40, neck_w: 80, neck_depth: 14,
  drain_n: 3, drain_r: 32, riser_h: 80, tilt: 10, wedge_tilt: 10, wedge_on: false, base_l: 180, base_w: 150,
  ns_w: 120, ns_ap: 100, ns_len: 90, ns_frac: 0.5, ns_relief: 12,
  riser_n: 1, top: 'head'
};
function derive(P) {
  const o = Object.assign({}, P);
  o.socket_d = P.peg_d + 2 * P.tol;
  o.rs = o.socket_d / 2;
  o.tanA = Math.tan(rad(98 - P.oh));                // printed slope from horizontal: leaves 8 deg margin inside the overhang limit (measured from vertical)
  o.rflat = Math.min(P.bridge / 2, o.rs - 1);
  o.cyl_h = P.peg_h + 1;
  o.cone_h = (o.rs - o.rflat) * o.tanA;
  o.socket_h = o.cyl_h + o.cone_h;                  // cylinder part + conical ceiling
  o.boss_r = o.rs + P.wall;
  o.riser_d = P.peg_d + 2 * P.wall + 8;
  o.riser_min_h = 2 * o.socket_h + 4;
  o.wedge_min_h = o.socket_h + 4 + o.socket_h * Math.cos(rad(P.wedge_tilt)) + o.rs * Math.sin(rad(Math.abs(P.wedge_tilt)));
  o.saddle_floor = o.socket_h + 4;
  o.base_t = o.cyl_h + 8;
  o.trough_d = P.limb_d + P.clearance;
  o.saddle_w = o.trough_d + 2 * P.wing_t;
  o.saddle_h = o.saddle_floor + o.trough_d * P.trough_frac;
  o.dowel_l = 2 * P.peg_h - 1;
  o.ns_ay = P.ns_w / 2 + P.clearance / 2;           // oval trough half-width (side to side)
  o.ns_az = P.ns_ap / 2 + P.clearance / 2;          // oval trough half-height (front to back of the neck)
  o.ns_floor = o.socket_h + 4;
  o.ns_h = o.ns_floor + 2 * o.ns_az * P.ns_frac;
  o.ns_total_w = 2 * o.ns_ay + 2 * P.wing_t;
  o.boss_d = P.peg_d + 2 * P.wall + 6;
  // head cradle drain ring: holes sit outside the boss so they run clear down the side of the pedestal, never into the socket
  const dr_ = P.drain_d / 2;
  o.drain_min = o.boss_d / 2 + dr_ + 1;
  o.drain_lim = Math.min(P.dish_l / 2 - P.dish_rim, P.dish_w / 2 - P.dish_rim) - dr_ - 4;
  o.drain_ring = Math.max(o.drain_min, Math.min(P.drain_r, Math.max(o.drain_lim, o.drain_min)));
  o.dish_h = P.dish_depth + P.dish_floor;
  o.boss_h = o.socket_h + 4;
  o.zc = o.boss_h + P.dish_l / 2 * Math.sin(rad(Math.abs(P.tilt))) + o.dish_h / 2 * Math.cos(rad(P.tilt));
  return o;
}
/* ---------- SDF primitives ---------- */
const sq = Math.sqrt, mx = Math.max, mn = Math.min, ab = Math.abs;
function sdCylZ(x, y, z, r, z0, z1) {
  const dr = sq(x * x + y * y) - r, dz = mx(z0 - z, z - z1);
  return (dr > 0 && dz > 0) ? sq(dr * dr + dz * dz) : mx(dr, dz);
}
function sdRBoxZ(x, y, z, hx, hy, r, z0, z1) {
  const qx = ab(x) - (hx - r), qy = ab(y) - (hy - r);
  const d2 = sq(mx(qx, 0) ** 2 + mx(qy, 0) ** 2) + mn(mx(qx, qy), 0) - r;
  const dz = mx(z0 - z, z - z1);
  return (d2 > 0 && dz > 0) ? sq(d2 * d2 + dz * dz) : mx(d2, dz);
}
function sdBox(x, y, z, x0, x1, y0, y1, z0, z1) {
  const dx = mx(x0 - x, x - x1), dy = mx(y0 - y, y - y1), dz = mx(z0 - z, z - z1);
  const ox = mx(dx, 0), oy = mx(dy, 0), oz = mx(dz, 0);
  return sq(ox * ox + oy * oy + oz * oz) + mn(mx(dx, mx(dy, dz)), 0);
}
function sdSock(rad_, u, o) {
  // cylinder (depth cyl_h) with a self-supporting conical ceiling that ends in a small flat bridge
  const dr = rad_ - o.rs, du = mx(-1 - u, u - o.cyl_h);
  const a = (dr > 0 && du > 0) ? sq(dr * dr + du * du) : mx(dr, du);
  const dc = mx((rad_ - (o.rflat + (o.socket_h - u) / o.tanA)) * 0.62, mx(o.cyl_h - 0.5 - u, u - o.socket_h));
  const rc = o.rs + 1.5 * mn(mx(1 - u / 1.6, 0), 1);
  const b = mx((rad_ - rc) * 0.9, mx(-1 - u, u - 1.6));
  return mn(a, mn(dc, b));
}
function smax(a, b, k) { return -smin(-a, -b, k); }
function sdSockPlain(rad_, u, o) {
  // plain cylindrical pocket with a lead-in chamfer; used where the pocket opens upward (nothing hangs over it)
  const dr = rad_ - o.rs, du = mx(-1 - u, u - o.cyl_h);
  const a = (dr > 0 && du > 0) ? sq(dr * dr + du * du) : mx(dr, du);
  const rc = o.rs + 1.5 * mn(mx(1 - u / 1.6, 0), 1);
  return mn(a, mx((rad_ - rc) * 0.9, mx(-1 - u, u - 1.6)));
}
function smin(a, b, k) { const h = mx(k - ab(a - b), 0) / k; return mn(a, b) - h * h * k * 0.25; }
function riserBounds(o, tiltDeg) {
  const t = Math.abs(Math.tan(rad(tiltDeg))) * o.riser_d / 2;
  return [[-o.riser_d / 2 - 1, -o.riser_d / 2 - 1, 0], [o.riser_d / 2 + 1, o.riser_d / 2 + 1, o.riser_h + t + 1]];
}
function riserSdf(o, tiltDeg) {
  // Column with a socket at each end. Flutes run vertically (no overhangs). With a tilt, the top face and its
  // socket lean over; the bottom stays flat on the bed, so a wedge still prints upright.
  const R = o.riser_d / 2, H = o.riser_h, th = rad(tiltDeg), s = Math.sin(th), c = Math.cos(th);
  const ztop = H + Math.abs(Math.tan(th)) * R + 2, fr = 6, fc = R + 2.5, M = Math.PI / 3;
  return (x, y, z) => {
    const px = x, pz = z - H, ax = px * s + pz * c;                 // height above the (tilted) top face
    const r0 = sq(x * x + y * y);
    let d = mx(sdCylZ(x, y, z, R, 0, ztop), ax);
    d = mx(d, -sdSock(r0, z, o));                                    // bottom socket (vertical)
    d = mx(d, -sdSock(sq(mx(px * px + y * y + pz * pz - ax * ax, 0)), -ax, o)); // top socket (normal to top face)
    let an = Math.atan2(y, x); an = ((an % M) + M) % M; if (an > M / 2) an -= M;
    const fx = r0 * Math.cos(an) - fc, fy = r0 * Math.sin(an);
    return mx(d, -(sq(fx * fx + fy * fy) - fr));
  };
}
const BASE = {
  label: 'Base',
  // The desk-facing side is a single flat face (no recess, no pocket), so the base prints flat on the bed
  // exactly as it will sit on the bench. Stick a silicone or rubber sheet to that face for grip.
  bounds: o => [[-o.base_l / 2 - 1, -o.base_w / 2 - 1, 0], [o.base_l / 2 + 1, o.base_w / 2 + 1, o.base_t]],
  sdf: o => {
    const hx = o.base_l / 2, hy = o.base_w / 2, T = o.base_t, sxp = hx - 22;
    return (x, y, z) => {
      let d = sdRBoxZ(x, y, z, hx, hy, 14, 0, T);
      d = mx(d, -sdSockPlain(sq(x * x + y * y), T - z, o));
      const yy = mx(ab(y) - 25, 0), ax = ab(x) - sxp;
      const dxy = sq(ax * ax + yy * yy) - 4.5, dz = mx(-1 - z, z - (T + 1));
      const slot = (dxy > 0 && dz > 0) ? sq(dxy * dxy + dz * dz) : mx(dxy, dz);   // vertical tie-down slots
      return mx(d, -slot);
    };
  }
};
/* ---------- parts ---------- */
const PARTS = {
  dowel: {
    label: 'Dowel',
    bounds: o => [[-o.peg_d / 2 - 1, -o.peg_d / 2 - 1, 0], [o.peg_d / 2 + 1, o.peg_d / 2 + 1, o.dowel_l]],
    sdf: o => {
      const r = o.peg_d / 2, L = o.dowel_l, c = 1.5;
      return (x, y, z) => {
        const rr = sq(x * x + y * y);
        return mx(sdCylZ(x, y, z, r, 0, L), mx((rr - (r - c) - z) * 0.7071, (rr - (r - c) - (L - z)) * 0.7071));
      };
    }
  },
  riser: { label: 'Riser', bounds: o => riserBounds(o, 0), sdf: o => riserSdf(o, 0) },
  wedge: { label: 'Tilt wedge', bounds: o => riserBounds(o, o.wedge_tilt), sdf: o => riserSdf(o, o.wedge_tilt) },
  base: BASE,
  saddle: {
    label: 'Limb saddle',
    bounds: o => [[-o.saddle_len / 2 - 1, -o.saddle_w / 2 - 1, 0], [o.saddle_len / 2 + 1, o.saddle_w / 2 + 1, o.saddle_h]],
    sdf: o => {
      const hx = o.saddle_len / 2, hy = o.saddle_w / 2, H = o.saddle_h, cz = o.saddle_floor + o.trough_d / 2, tr = o.trough_d / 2;
      const dx0 = hx - 14, sx = o.saddle_len * 0.28, sy = o.trough_d / 2 + o.wing_t / 2, sw = o.strap_w / 2, st = o.strap_t / 2;
      const dr = o.drain_d / 2, dz1 = o.saddle_floor + 4;
      return (x, y, z) => {
        let d = sdRBoxZ(x, y, z, hx, hy, 6, 0, H);
        d = mx(d, -(sq(y * y + (z - cz) * (z - cz)) - tr));
        d = mx(d, -sdSock(sq(x * x + y * y), z, o));
        d = mx(d, -sdCylZ(ab(x) - dx0, y, z, dr, -1, dz1));
        d = mx(d, -sdBox(ab(x) - sx, ab(y) - sy, z, -sw, sw, -st, st, -1, H + 1));
        return d;
      };
    }
  },
  neck: {
    label: 'Neck support',
    bounds: o => [[-o.ns_len / 2 - 1, -o.ns_total_w / 2 - 1, 0], [o.ns_len / 2 + 1, o.ns_total_w / 2 + 1, o.ns_h]],
    sdf: o => {
      // Oval trough, open to the top, so it prints upright with nothing hanging over. End relief drops both ends
      // along a smooth curve so the support clears the skull on one side and the shoulders on the other.
      const hx = o.ns_len / 2, hy = o.ns_total_w / 2, H = o.ns_h, ay = o.ns_ay, az = o.ns_az, cz = o.ns_floor + az, mnA = mn(ay, az);
      const sx = o.ns_len * 0.28, sy = ay + o.wing_t / 2, sw = o.strap_w / 2, st = o.strap_t / 2, rel = o.ns_relief;
      const dr = o.drain_d / 2, dz1 = o.ns_floor + 4, dx0 = hx - 14;
      return (x, y, z) => {
        let d = sdRBoxZ(x, y, z, hx, hy, 6, 0, H);
        d = mx(d, (z - (H - rel * (x / hx) * (x / hx))) * 0.7);                       // end relief
        const ell = (sq((y / ay) * (y / ay) + ((z - cz) / az) * ((z - cz) / az)) - 1) * mnA;
        d = mx(d, -ell);                                                              // oval trough
        d = mx(d, -sdSock(sq(x * x + y * y), z, o));
        d = mx(d, -sdCylZ(ab(x) - dx0, y, z, dr, -1, dz1));
        d = mx(d, -sdBox(ab(x) - sx, ab(y) - sy, z, -sw, sw, -st, st, -1, H + 1));
        return d;
      };
    }
  },
  head: {
    label: 'Head cradle',
    bounds: o => {
      const t = rad(Math.abs(o.tilt));
      const ex = o.dish_l / 2 + o.dish_h / 2 * Math.sin(t) + 3;
      return [[-ex, -o.dish_w / 2 - 3, 0], [ex, o.dish_w / 2 + 3, o.zc + o.dish_l / 2 * Math.sin(t) + o.dish_h / 2 + 3]];
    },
    sdf: o => {
      const th = rad(o.tilt), c = Math.cos(th), s = Math.sin(th);
      const a = o.dish_l / 2 - o.dish_rim, b = o.dish_w / 2 - o.dish_rim, t = o.dish_depth;
      const R = (a * a + t * t) / (2 * t), hh = o.dish_h / 2, sphz = hh - t + R, k = b / a;
      const hx = o.dish_l / 2, hy = o.dish_w / 2, bossR = o.boss_d / 2, zc = o.zc;
      const zb = mx(zc - hh - o.boss_h, 1), R2 = hy * 0.92;
      const nx0 = hx - o.neck_len, nw = o.neck_w / 2, nz0 = hh - o.neck_depth, dr = o.drain_d / 2;
      const dN = Math.max(1, Math.round(o.drain_n)), dstep = 2 * Math.PI / dN, dstart = o.tilt < 0 ? Math.PI : 0, dring = o.drain_ring, dtop = zc + o.dish_h + 100;
      return (x, y, z) => {
        const zz = z - zc;
        const lx = x * c - zz * s, lz = x * s + zz * c, ly = y;      // world -> dish frame
        let body = sdRBoxZ(lx, ly, lz, hx, hy, 24, -hh, hh);
        // flared pedestal: boss cylinder widening to the dish underside (stands in for the SCAD hull)
        const rc = bossR + mn(mx((z - o.boss_h) / zb, 0), 1) * (R2 - bossR);
        let col = mx(mx((sq(x * x + y * y) - rc) * 0.7, z - zc), -z);
        col = mx(col, sdRBoxZ(x, y, 0, hx * 0.96, hy, 24, -1e3, 1e3));
        let d = smin(body, col, 10);
        // spherical-cap dish scaled to an ellipse
        const sd = (sq(lx * lx + (ly / k) * (ly / k) + (lz - sphz) * (lz - sphz)) - R) * mn(1, k);
        d = mx(d, -sd);
        d = mx(d, -sdBox(lx, ly, lz, nx0, hx + 2, -nw, nw, nz0, hh + 2));
        // drain holes: vertical in world space, evenly spaced on a circle, one always on the low side of the dish
        const sec = Math.round((Math.atan2(y, x) - dstart) / dstep), aa = dstart + sec * dstep;
        d = smax(d, -sdCylZ(x - dring * Math.cos(aa), y - dring * Math.sin(aa), z, dr, -1, dtop), 2.5);   // softened so the hole meets the pedestal slope without slivers
        d = mx(d, -sdSock(sq(x * x + y * y), z, o));
        return d;
      };
    }
  }
};
/* ---------- naive surface nets ---------- */
const EDGES = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
function surfaceNets(f, bmin, bmax, res, jit) {
  jit = jit || [0.0371, 0.0529, 0.0213];
  const pad = 1;
  const nx = Math.ceil((bmax[0] - bmin[0]) / res) + 2 * pad, ny = Math.ceil((bmax[1] - bmin[1]) / res) + 2 * pad, nz = Math.ceil((bmax[2] - bmin[2]) / res) + 2 * pad;
  // sample grid is nudged by an irrational fraction of a cell so flat faces never land exactly on grid planes
  const ox = bmin[0] - pad * res + jit[0] * res, oy = bmin[1] - pad * res + jit[1] * res, oz = bmin[2] - pad * res + jit[2] * res;
  const sx = nx + 1, sxy = sx * (ny + 1);
  const F = new Float32Array(sxy * (nz + 1));
  let i = 0;
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let ii = 0; ii <= nx; ii++) F[i++] = f(ox + ii * res, oy + j * res, oz + k * res);
  const off = [0, 1, sx, sx + 1, sxy, sxy + 1, sxy + sx, sxy + sx + 1];
  const V = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const v = new Float32Array(8);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let ii = 0; ii < nx; ii++) {
    const base = ii + sx * j + sxy * k;
    let mask = 0;
    for (let n = 0; n < 8; n++) { v[n] = F[base + off[n]]; if (v[n] < 0) mask |= 1 << n; }
    if (mask === 0 || mask === 255) continue;
    let ax = 0, ay = 0, az = 0, cnt = 0;
    for (let e = 0; e < 12; e++) {
      const p = EDGES[e][0], q = EDGES[e][1];
      if (((mask >> p) & 1) !== ((mask >> q) & 1)) {
        const t = v[p] / (v[p] - v[q]);
        ax += (p & 1) + t * ((q & 1) - (p & 1));
        ay += ((p >> 1) & 1) + t * (((q >> 1) & 1) - ((p >> 1) & 1));
        az += ((p >> 2) & 1) + t * (((q >> 2) & 1) - ((p >> 2) & 1));
        cnt++;
      }
    }
    V[ii + nx * (j + ny * k)] = pos.length / 3;
    pos.push(ox + (ii + ax / cnt) * res, oy + (j + ay / cnt) * res, oz + (k + az / cnt) * res);
  }
  const idx = [];
  const n3 = [nx, ny, nz], cellAt = (a, b, c) => V[a + nx * (b + ny * c)];
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let ii = 0; ii <= nx; ii++) {
    const p = [ii, j, k], s0 = F[ii + sx * j + sxy * k] < 0;
    for (let a = 0; a < 3; a++) {
      if (p[a] >= n3[a]) continue;
      const u = (a + 1) % 3, w = (a + 2) % 3;
      if (p[u] < 1 || p[u] > n3[u] - 1 || p[w] < 1 || p[w] > n3[w] - 1) continue;
      const q = a === 0 ? ii + 1 : ii, qj = a === 1 ? j + 1 : j, qk = a === 2 ? k + 1 : k;
      const s1 = F[q + sx * qj + sxy * qk] < 0;
      if (s0 === s1) continue;
      const pu = p.slice(), pw = p.slice(), puw = p.slice();
      pu[u]--; pw[w]--; puw[u]--; puw[w]--;
      const c0 = cellAt(p[0], p[1], p[2]), c1 = cellAt(pu[0], pu[1], pu[2]), c2 = cellAt(puw[0], puw[1], puw[2]), c3 = cellAt(pw[0], pw[1], pw[2]);
      if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) continue;
      if (s0) idx.push(c0, c1, c2, c0, c2, c3); else idx.push(c0, c2, c1, c0, c3, c2);
    }
  }
  // Snap each vertex onto the true surface (Newton steps on the SDF) and take smooth normals from its gradient.
  const nv = pos.length / 3, nrm = new Float32Array(nv * 3), h = res * 0.35, lim = res * 0.8;
  for (let v3 = 0; v3 < nv; v3++) {
    let x = pos[v3 * 3], y = pos[v3 * 3 + 1], z = pos[v3 * 3 + 2], gx = 0, gy = 0, gz = 0, gl = 1;
    for (let it = 0; it < 3; it++) {
      gx = f(x + h, y, z) - f(x - h, y, z); gy = f(x, y + h, z) - f(x, y - h, z); gz = f(x, y, z + h) - f(x, y, z - h);
      gl = sq(gx * gx + gy * gy + gz * gz) || 1;
      if (it === 2) break;
      const d = f(x, y, z), k = d * 2 * h / (gl * gl); // Newton step: d * grad / |grad|^2
      let sx = -gx * k, sy = -gy * k, sz = -gz * k;
      const sl = sq(sx * sx + sy * sy + sz * sz);
      if (sl > lim) { const c = lim / sl; sx *= c; sy *= c; sz *= c; }
      x += sx; y += sy; z += sz;
    }
    pos[v3 * 3] = x; pos[v3 * 3 + 1] = y; pos[v3 * 3 + 2] = z;
    nrm[v3 * 3] = gx / gl; nrm[v3 * 3 + 1] = gy / gl; nrm[v3 * 3 + 2] = gz / gl;
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), nrm };
}
function meshStats(m) {
  const P = m.pos, I = m.idx; let vol = 0;
  let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
  for (let i = 0; i < P.length; i += 3) {
    mnx = mn(mnx, P[i]); mxx = mx(mxx, P[i]); mny = mn(mny, P[i + 1]); mxy = mx(mxy, P[i + 1]); mnz = mn(mnz, P[i + 2]); mxz = mx(mxz, P[i + 2]);
  }
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  return { volume: vol, min: [mnx, mny, mnz], max: [mxx, mxy, mxz], size: [mxx - mnx, mxy - mny, mxz - mnz], tris: I.length / 3 };
}
function openEdges(m) {
  const I = m.idx, nv = m.pos.length / 3, cnt = new Map();
  for (let i = 0; i < I.length; i += 3) for (let e = 0; e < 3; e++) {
    const a = I[i + e], b = I[i + (e + 1) % 3], k = a < b ? a * nv + b : b * nv + a;
    cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  let n = 0; for (const c of cnt.values()) if (c !== 2) n++;
  return n;
}
const JITTERS = [[0.0371, 0.0529, 0.0213], [0.2113, 0.3187, 0.1409], [0.4421, 0.1733, 0.3571], [0.3019, 0.4663, 0.2647], [0.1217, 0.2371, 0.4813]];
function buildPart(name, params, res, tries, start) {
  // tries: how many grid offsets to attempt (stops at the first watertight mesh); start: first offset to use
  const o = derive(params), part = PARTS[name], b = part.bounds(o), f = part.sdf(o);
  const n = tries || JITTERS.length, s0 = start || 0;
  let best = null;
  for (let t = 0; t < n; t++) {
    const m = surfaceNets(f, b[0], b[1], res, JITTERS[(s0 + t) % JITTERS.length]);
    m.open = openEdges(m);
    if (!best || m.open < best.open) best = m;
    if (best.open === 0) break;
  }
  best.stats = meshStats(best);
  return best;
}
function analyzeOverhang(m, limitDeg, bridge) {
  const P = m.pos, I = m.idx, nt = I.length / 3, zmin = m.stats.min[2], cut = -Math.sin(rad(limitDeg));   // limitDeg is measured from vertical
  const minArea = Math.PI * (bridge / 2 + 2) * (bridge / 2 + 2);   // a bridged span up to `bridge` mm (+2 mm for mesh rounding) is fine
  const par = new Map(); const find = a => { let r = a; while (par.get(r) !== r) r = par.get(r); while (par.get(a) !== r) { const n = par.get(a); par.set(a, r); a = n; } return r; };
  const tris = []; let total = 0;
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    if (mx(P[a + 2], mx(P[b + 2], P[c + 2])) < zmin + 0.8) continue;            // lies on the bed
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = sq(nx * nx + ny * ny + nz * nz);
    if (l < 1e-12) continue;
    if (nz / l < cut) { tris.push([I[t * 3], I[t * 3 + 1], I[t * 3 + 2], l / 2]); total += l / 2; }
  }
  for (const t of tris) for (let i = 0; i < 3; i++) if (!par.has(t[i])) par.set(t[i], t[i]);
  for (const t of tris) { const r0 = find(t[0]); for (let i = 1; i < 3; i++) { const r = find(t[i]); if (r !== r0) par.set(r, r0); } }
  const area = new Map(); for (const t of tris) { const r = find(t[0]); area.set(r, (area.get(r) || 0) + t[3]); }
  let flagged = 0, flaggedArea = 0, biggest = 0;
  for (const v of area.values()) { biggest = mx(biggest, v); if (v >= minArea) { flagged++; flaggedArea += v; } }
  return { total, flagged, flaggedArea, biggest, minArea };
}
/* ---------- writers ---------- */
function toSTL(m, name) {
  const P = m.pos, I = m.idx, n = I.length / 3, buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
  const hdr = ('Positioning Kit ' + (name || '')).slice(0, 79);
  for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i) & 127);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = sq(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
    for (const q of [a, b, c]) { dv.setFloat32(o, P[q], true); dv.setFloat32(o + 4, P[q + 1], true); dv.setFloat32(o + 8, P[q + 2], true); o += 12; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}
let CRC = null;
function crc32(u8) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files) { // files: [{name, data:Uint8Array}], stored (no compression)
  const enc = new TextEncoder(), chunks = [], cd = []; let off = 0;
  const time = (12 << 11), date = ((2026 - 1980) << 9) | (10 << 5) | 28;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true);
    h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    chunks.push(new Uint8Array(h.buffer), nm, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true);
    c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    cd.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + f.data.length;
  }
  let cdSize = 0; for (const x of cd) cdSize += x.length;
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const all = chunks.concat(cd, [new Uint8Array(e.buffer)]); let total = 0; for (const x of all) total += x.length;
  const out = new Uint8Array(total); let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
root.Kit = { DEFAULTS, derive, PARTS, buildPart, toSTL, makeZip, meshStats, surfaceNets, analyzeOverhang };
})(typeof window !== 'undefined' ? window : globalThis);

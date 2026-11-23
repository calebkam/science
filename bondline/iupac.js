/* ============================ iupac.js ============================
   Offline IUPAC namer for common organic molecules (2013 recommendations, simplified).
   name(mol) with mol = { atoms:[{el, q, h}], bonds:[[a, b, order]] }  (h = implicit hydrogens)
   -> { name, note } or { error }.
   Covers: acyclic and monocyclic carbon skeletons, benzene rings, C=C and C#C, halogens, alcohols, ethers, amines,
   ketones, aldehydes, acids, esters, amides, nitriles, nitro, thiols, nested substituents.
   Not covered (returns an error): fused or bridged rings, heteroatom rings, stereodescriptors, charged or radical species,
   organometallics. */
(function (root) {
'use strict';
var STEM = ['', 'meth', 'eth', 'prop', 'but', 'pent', 'hex', 'hept', 'oct', 'non', 'dec', 'undec', 'dodec', 'tridec', 'tetradec', 'pentadec', 'hexadec', 'heptadec', 'octadec', 'nonadec', 'icos'];
var MULT = ['', '', 'di', 'tri', 'tetra', 'penta', 'hexa', 'hepta', 'octa', 'nona', 'deca'];
var MULTC = ['', '', 'bis', 'tris', 'tetrakis', 'pentakis', 'hexakis', 'heptakis', 'octakis', 'nonakis', 'decakis'];
var HAL = { F: 'fluoro', Cl: 'chloro', Br: 'bromo', I: 'iodo' };
var PRIORITY = ['acid', 'ester', 'amide', 'nitrile', 'aldehyde', 'ketone', 'alcohol', 'thiol', 'amine'];
function wrap(s) { return s.indexOf('[') >= 0 ? '{' + s + '}' : s.indexOf('(') >= 0 ? '[' + s + ']' : '(' + s + ')'; }
function Unsupported(m) { this.message = m; }

/* ---------------------------------------------------------------- graph */
function build(mol) {
  var n = mol.atoms.length, G = { n: n, el: [], h: [], q: [], nb: [], mol: mol };
  for (var i = 0; i < n; i++) { var a = mol.atoms[i]; G.el.push(a.el); G.h.push(a.h || 0); G.q.push(a.q || 0); G.nb.push([]); }
  mol.bonds.forEach(function (b) { G.nb[b[0]].push({ n: b[1], o: b[2] }); G.nb[b[1]].push({ n: b[0], o: b[2] }); });
  return G;
}
function bo(G, a, b) { for (var i = 0; i < G.nb[a].length; i++) if (G.nb[a][i].n === b) return G.nb[a][i].o; return 0; }
function nbrs(G, a, not) { return G.nb[a].filter(function (x) { return x.n !== not; }); }
/* ring atoms: iterative removal of leaves leaves the cycle-bearing core; then split into simple cycles */
function findRings(G) {
  var deg = G.nb.map(function (l) { return l.length; }), alive = G.nb.map(function () { return true; }), q = [];
  for (var i = 0; i < G.n; i++) if (deg[i] <= 1) q.push(i);
  while (q.length) { var v = q.pop(); if (!alive[v]) continue; alive[v] = false; G.nb[v].forEach(function (x) { if (alive[x.n] && --deg[x.n] <= 1) q.push(x.n); }); }
  var core = []; for (i = 0; i < G.n; i++) if (alive[i]) core.push(i);
  /* bridges of the core (bonds that belong to no ring) */
  var disc = {}, low = {}, br = {}, tm = 0;
  function dfs(v, pe) { disc[v] = low[v] = ++tm; G.nb[v].forEach(function (x) { if (!alive[x.n] || x.n === pe) return; if (disc[x.n]) low[v] = Math.min(low[v], disc[x.n]); else { dfs(x.n, v); low[v] = Math.min(low[v], low[x.n]); if (low[x.n] > disc[v]) br[v + '-' + x.n] = br[x.n + '-' + v] = 1; } }); }
  core.forEach(function (v) { if (!disc[v]) dfs(v, -1); });
  function ringNb(v) { return G.nb[v].filter(function (x) { return alive[x.n] && !br[v + '-' + x.n]; }); }
  var rings = [], seen = {};
  core.forEach(function (s) {
    if (seen[s]) return; seen[s] = true;
    var comp = [s], st = [s];
    while (st.length) { var v2 = st.pop(); ringNb(v2).forEach(function (x) { if (!seen[x.n]) { seen[x.n] = true; comp.push(x.n); st.push(x.n); } }); }
    if (comp.length === 1) return;
    var edges = 0; comp.forEach(function (v3) { edges += ringNb(v3).length; }); edges /= 2;
    if (!(comp.every(function (v4) { return ringNb(v4).length === 2; }) && edges === comp.length)) throw new Unsupported('fused, bridged or spiro ring systems are not handled by the offline namer');
    var order = [comp[0]], prev = -1, cur = comp[0];
    for (;;) { var nx = ringNb(cur).filter(function (x) { return x.n !== prev; })[0]; if (!nx || nx.n === comp[0] || order.length > comp.length) break; order.push(nx.n); prev = cur; cur = nx.n; }
    rings.push(order);
  });
  return rings;
}

/* ---------------------------------------------------------------- local environment of a carbon */
function hetNbrs(G, c) { return G.nb[c].filter(function (x) { return G.el[x.n] !== 'C'; }); }
function isOH(G, o, from) { return G.el[o] === 'O' && G.h[o] >= 1 && G.nb[o].length === 1 && G.nb[o][0].n === from; }
/* class of a carbon seen as part of the whole molecule (no attachment point): acid, ester, amide, nitrile, aldehyde, ketone or '' */
function classOf(G, c) {
  if (G.el[c] !== 'C') return '';
  var dO = 0, nTrip = 0, hets = [], carbons = 0;
  G.nb[c].forEach(function (x) {
    var e = G.el[x.n];
    if (e === 'C') carbons++;
    else if (e === 'O' && x.o === 2) dO++;
    else if (e === 'N' && x.o === 3) nTrip++;
    else if (x.o === 1 && (e === 'O' || e === 'N')) hets.push(x);
  });
  if (nTrip) return 'nitrile';
  if (!dO) return '';
  if (hets.length > 1) throw new Unsupported('carbonic acid derivatives, anhydrides and ureas are not handled by the offline namer');
  if (!hets.length) return carbons === 2 ? 'ketone' : (carbons <= 1 ? 'aldehyde' : '');
  var x = hets[0], e = G.el[x.n];
  if (e === 'O') {
    if (G.h[x.n] >= 1 && G.nb[x.n].length === 1) return 'acid';
    var other = G.nb[x.n].filter(function (y) { return y.n !== c; })[0];
    if (other && G.el[other.n] === 'C') { if (classOf2(G, other.n) === 'acyl') throw new Unsupported('anhydrides are not handled by the offline namer'); return 'ester'; }
    throw new Unsupported('this oxygen group is not handled by the offline namer');
  }
  return 'amide';
}
function classOf2(G, c) { return G.nb[c].some(function (x) { return G.el[x.n] === 'O' && x.o === 2; }) ? 'acyl' : ''; }

/* ---------------------------------------------------------------- substituent prefixes */
var CONTRACT = { methyl: 'methoxy', ethyl: 'ethoxy', propyl: 'propoxy', butyl: 'butoxy', phenyl: 'phenoxy' };
function oxyName(r) { if (CONTRACT[r.name]) return { name: CONTRACT[r.name], cx: false }; var m = /^(.*(?:meth|eth|prop|but|phen))yl$/.exec(r.name); if (m && !/[0-9]yl$/.test(r.name)) return { name: m[1] + 'oxy', cx: true }; return { name: r.name + 'oxy', cx: true }; }
function joinSubs(subs, tail) {
  /* several substituents on one atom: "dimethylamino", "ethyl(methyl)amino" */
  if (!subs.length) return { name: tail, cx: false };
  var sorted = subs.slice().sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  var same = sorted.every(function (s) { return s.name === sorted[0].name; });
  if (same) { var m = sorted.length; return { name: (sorted[0].cx ? MULTC[m] + wrap(sorted[0].name) : MULT[m] + sorted[0].name) + tail, cx: true }; }
  return { name: sorted.map(function (s, i) { return i === 0 && !s.cx ? s.name : wrap(s.name); }).join('') + tail, cx: true };
}
function keyOf(name) { return name.replace(/\([^)]*\)/g, function (m) { return m; }).replace(/[^a-z]/g, ''); }
function mkSub(name, cx) { return { name: name, cx: !!cx, key: keyOf(name) }; }

function subName(G, atom, from, depth) {
  depth = (depth || 0) + 1; if (depth > 40) throw new Unsupported('structure too deep');
  var e = G.el[atom], rest = G.nb[atom].filter(function (x) { return x.n !== from; }), bFrom = bo(G, atom, from);
  if (HAL[e]) return mkSub(HAL[e], false);
  if (e === 'O') {
    if (bFrom === 2) return mkSub('oxo', false);
    if (!rest.length) return mkSub('hydroxy', false);
    var r = rest[0];
    if (G.el[r.n] !== 'C') throw new Unsupported('peroxides and O-heteroatom bonds are not handled by the offline namer');
    var rs = subName(G, r.n, atom, depth), ox = oxyName(rs); return mkSub(ox.name, ox.cx || rs.cx);
  }
  if (e === 'S') {
    if (rest.some(function (x) { return G.el[x.n] !== 'C'; }) || bFrom !== 1) throw new Unsupported('this sulfur group is not handled by the offline namer');
    if (!rest.length) return mkSub('sulfanyl', false);
    var ss = subName(G, rest[0].n, atom, depth); return mkSub(ss.name + 'sulfanyl', true);
  }
  if (e === 'N') {
    var os = rest.filter(function (x) { return G.el[x.n] === 'O'; });
    if (os.length === 2 && rest.length === 2) return mkSub('nitro', false);
    if (rest.some(function (x) { return G.el[x.n] !== 'C' || x.o !== 1; }) || bFrom !== 1) throw new Unsupported('this nitrogen group is not handled by the offline namer');
    var subs = rest.map(function (x) { return subName(G, x.n, atom, depth); });
    var j = joinSubs(subs, 'amino'); return mkSub(j.name, subs.length > 0);
  }
  if (e !== 'C') throw new Unsupported('the element ' + e + ' is not handled by the offline namer');
  /* carbon: look at it without the attachment bond */
  var dO = rest.filter(function (x) { return G.el[x.n] === 'O' && x.o === 2; }).length;
  var tri = rest.filter(function (x) { return G.el[x.n] === 'N' && x.o === 3; }).length;
  if (tri) return mkSub('cyano', false);
  if (dO) {
    var hs = rest.filter(function (x) { return !(G.el[x.n] === 'O' && x.o === 2); });
    if (G.el[from] !== 'C' && hs.length && G.el[hs[0].n] !== 'C') throw new Unsupported('carbamates, carbonates and ureas are not handled by the offline namer');
    if (!hs.length) return mkSub('formyl', false);
    var h0 = hs[0], he = G.el[h0.n];
    if (he === 'O') {
      if (G.h[h0.n] >= 1 && G.nb[h0.n].length === 1) return mkSub('carboxy', false);
      var rr = G.nb[h0.n].filter(function (y) { return y.n !== atom; })[0], rn = subName(G, rr.n, h0.n, depth), oy = oxyName(rn);
      return mkSub(oy.name + 'carbonyl', true);
    }
    if (he === 'N') {
      var nsub = G.nb[h0.n].filter(function (y) { return y.n !== atom; }).map(function (y) { return subName(G, y.n, h0.n, depth); });
      return mkSub(joinSubs(nsub, 'carbamoyl').name, nsub.length > 0);
    }
    var res = nameSkeleton(G, { mode: 'sub', attach: atom, from: from, acyl: true }); return mkSub(res.name, res.cx);
  }
  var out = nameSkeleton(G, { mode: 'sub', attach: atom, from: from });
  return mkSub(out.name, out.cx);
}

/* ---------------------------------------------------------------- skeleton naming */
var CARBON_CLASSES = { acid: 1, ester: 1, amide: 1, nitrile: 1, aldehyde: 1 };
var EXTERNAL_OK = { acid: 1, ester: 1, amide: 1, nitrile: 1, aldehyde: 1 };
function isAmine(G, n) {
  if (G.el[n] !== 'N' || !G.nb[n].length) return false;
  return G.nb[n].every(function (x) { return G.el[x.n] === 'C' && x.o === 1 && classOf(G, x.n) === ''; });
}
function reach(G, start, block) {
  var seen = {}; seen[start] = 1; var st = [start], out = [start];
  while (st.length) { var v = st.pop(); G.nb[v].forEach(function (x) { if (x.n !== block && !seen[x.n]) { seen[x.n] = 1; out.push(x.n); st.push(x.n); } }); }
  return out;
}
function cmpArr(a, b) {
  for (var i = 0; i < Math.max(a.length, b.length); i++) { if (a[i] === undefined) return -1; if (b[i] === undefined) return 1; if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; }
  return 0;
}
function cmpTuple(a, b) { for (var i = 0; i < a.length; i++) { var c = cmpArr(a[i], b[i]); if (c) return c; } return 0; }
function pathsIn(G, set, mustHave) {
  /* all leaf-to-leaf paths of the induced carbon forest (plus single atoms) */
  var adj = {}; set.forEach(function (a) { adj[a] = G.nb[a].filter(function (x) { return set.indexOf(x.n) >= 0; }).map(function (x) { return x.n; }); });
  var leaves = set.filter(function (a) { return adj[a].length <= 1; }), out = [];
  if (set.length > 70) throw new Unsupported('structure too large for the offline namer');
  leaves.forEach(function (s) {
    if (!adj[s].length) { out.push([s]); return; }
    (function dfs(v, path) {
      if (adj[v].length === 1 && path.length > 1 && v !== s) { if (v > s) out.push(path.slice()); return; }
      adj[v].forEach(function (w) { if (path.indexOf(w) < 0) { path.push(w); dfs(w, path); path.pop(); } });
    })(s, [s]);
  });
  return out.filter(function (p) { return mustHave === undefined || p.indexOf(mustHave) >= 0; });
}

function nameSkeleton(G, opts) {
  if (!G.rings) G.rings = findRings(G);
  var sub = opts.mode === 'sub', U = sub ? reach(G, opts.attach, opts.from) : G.all, inU = {}; U.forEach(function (a) { inU[a] = 1; });
  G.rings.forEach(function (r) { if (r.some(function (a) { return G.el[a] !== 'C'; })) throw new Unsupported('heterocyclic rings are not handled by the offline namer'); });
  var ringOf = {}; G.rings.forEach(function (r, i) { r.forEach(function (a) { ringOf[a] = i; }); });
  /* principal group class */
  var P;
  if (sub) P = opts.acyl ? 'acyl' : 'yl';
  else {
    var present = {};
    U.forEach(function (a) {
      var e = G.el[a];
      if (e === 'C') { var c = classOf(G, a); if (c) present[c] = 1; else G.nb[a].forEach(function (x) { if (G.el[x.n] === 'O' && x.o === 1 && isOH(G, x.n, a)) present.alcohol = 1; if (G.el[x.n] === 'S' && x.o === 1 && G.h[x.n] >= 1 && G.nb[x.n].length === 1) present.thiol = 1; if (isAmine(G, x.n)) present.amine = 1; }); }
      else if (e === 'C') { }
    });
    /* alcohols on carbons that have a class (e.g. acid OH) were skipped above */
    P = PRIORITY.filter(function (k) { return present[k]; })[0] || '';
  }
  var cands = [];
  function addChains(variantB) {
    var set = U.filter(function (a) {
      if (G.el[a] !== 'C' || ringOf[a] !== undefined) return false;
      var c = classOf(G, a);
      if (sub) return !(CARBON_CLASSES[c] && c !== 'aldehyde') || a === opts.attach;
      if (c === 'aldehyde') return !(variantB && P === 'aldehyde');
      if (CARBON_CLASSES[c]) return c === P && !variantB;
      return true;
    });
    if (sub && set.indexOf(opts.attach) < 0) return;
    pathsIn(G, set, sub ? opts.attach : undefined).forEach(function (p) { cands.push({ type: 'chain', atoms: p, B: variantB }); });
  }
  addChains(false);
  if (!sub && EXTERNAL_OK[P]) addChains(true);
  G.rings.forEach(function (r, i) { if (U.indexOf(r[0]) < 0) return; if (sub && ringOf[opts.attach] !== i) return; cands.push({ type: 'ring', atoms: r, B: true }); });
  if (!cands.length) throw new Unsupported('no carbon skeleton found');

  var best = null;
  cands.forEach(function (cd) { var d = describe(cd); if (!best || cmpCand(d, best) < 0) best = d; });
  return compose(best);

  /* ---- everything about one candidate that does not depend on numbering */
  function describe(cd) {
    var S = cd.atoms, n = S.length, where = {}; S.forEach(function (a, i) { where[a] = i; });
    var d = { cd: cd, S: S, n: n, groups: [], prefixes: [], P: P, ring: cd.type === 'ring' };
    d.aromatic = d.ring && n === 6 && S.every(function (a, i) { var nx = S[(i + 1) % 6], pv = S[(i + 5) % 6]; return (bo(G, a, nx) === 2) !== (bo(G, a, pv) === 2); }) && S.every(function (a) { return G.h[a] <= 1; });
    S.forEach(function (a, i) {
      var cl = classOf(G, a);
      if (sub && a === opts.attach) d.groups.push({ i: i, kind: P });
      var inGroup = !d.ring && !cd.B && CARBON_CLASSES[cl] && cl === P && !sub;
      if (inGroup) d.groups.push({ i: i, kind: P, nsubs: tailSubs(a), rsub: tailR(a) });
      G.nb[a].forEach(function (x) {
        var t = x.n; if (where[t] !== undefined || !inU[t]) return;
        var e = G.el[t];
        if (inGroup) { if (e === 'O' || e === 'N') return; }
        if (sub && a === opts.attach && opts.acyl && e === 'O' && x.o === 2) return;
        if (e === 'C') {
          var ct = classOf(G, t);
          if (!sub && ct === P && EXTERNAL_OK[P] && (d.ring || cd.B)) { d.groups.push({ i: i, kind: P, ext: true, nsubs: tailSubs(t), rsub: tailR(t) }); return; }
          d.prefixes.push({ i: i, sub: subName(G, t, a) }); return;
        }
        if (e === 'O' && x.o === 2) { if (P === 'ketone') d.groups.push({ i: i, kind: 'ketone' }); else d.prefixes.push({ i: i, sub: mkSub('oxo', false) }); return; }
        if (e === 'O' && P === 'alcohol' && isOH(G, t, a) && cl === '') { d.groups.push({ i: i, kind: 'alcohol' }); return; }
        if (e === 'S' && P === 'thiol' && G.h[t] >= 1 && G.nb[t].length === 1) { d.groups.push({ i: i, kind: 'thiol' }); return; }
        if (e === 'N' && P === 'amine' && isAmine(G, t)) { d.groups.push({ i: i, kind: 'amine', nsubs: G.nb[t].filter(function (y) { return y.n !== a; }).map(function (y) { return subName(G, y.n, t); }) }); return; }
        d.prefixes.push({ i: i, sub: subName(G, t, a) });
      });
    });
    d.multi = 0; for (var i = 0; i < n; i++) { var j = (i + 1) % n; if (i === n - 1 && !d.ring) break; if (!d.aromatic && bo(G, S[i], S[j]) > 1) d.multi++; }
    d.count = (sub ? 1 : d.groups.length);
    d.best = bestNumbering(d);
    return d;
  }
  function tailSubs(c) { /* N-substituents of an amide carbon */
    var nn = G.nb[c].filter(function (x) { return G.el[x.n] === 'N'; })[0]; if (!nn) return [];
    return G.nb[nn.n].filter(function (y) { return y.n !== c; }).map(function (y) { return subName(G, y.n, nn.n); });
  }
  function tailR(c) { /* alkyl group of an ester */
    var oo = G.nb[c].filter(function (x) { return G.el[x.n] === 'O' && x.o === 1; })[0]; if (!oo || G.h[oo.n]) return null;
    var r = G.nb[oo.n].filter(function (y) { return y.n !== c; })[0]; return r ? subName(G, r.n, oo.n) : null;
  }
  function bestNumbering(d) {
    var S = d.S, n = d.n, orders = [];
    if (d.ring) for (var s = 0; s < n; s++) { var f = [], b = []; for (var k = 0; k < n; k++) { f.push(S[(s + k) % n]); b.push(S[(s - k + n * 2) % n]); } orders.push(f, b); }
    else orders.push(S, S.slice().reverse());
    var res = null;
    orders.forEach(function (o) {
      var loc = {}; o.forEach(function (a, i) { loc[a] = i + 1; });
      var inv = {}; S.forEach(function (a, i) { inv[i] = loc[a]; });
      var gl = d.groups.map(function (g) { return inv[g.i]; }).sort(num);
      var ml = [], el = [];
      if (!d.aromatic) for (var i = 0; i < n; i++) { var j = (i + 1) % n; if (i === n - 1 && !d.ring) break; var bb = bo(G, o[i], o[j]); if (bb > 1) { ml.push(i + 1); if (bb === 2) el.push(i + 1); } }
      var pl = d.prefixes.map(function (p) { return inv[p.i]; }).sort(num);
      var al = d.prefixes.slice().sort(function (p, q) { return p.sub.key < q.sub.key ? -1 : p.sub.key > q.sub.key ? 1 : inv[p.i] - inv[q.i]; }).map(function (p) { return inv[p.i]; });
      var t = [gl, ml.sort(num), el.sort(num), pl, al];
      if (!res || cmpTuple(t, res.t) < 0) res = { t: t, order: o, inv: inv };
    });
    return res;
  }
  function num(a, b) { return a - b; }
  function cmpCand(a, b) {
    if (a.count !== b.count) return b.count - a.count;
    if (a.ring !== b.ring) return a.ring ? -1 : 1;
    if (a.n !== b.n) return b.n - a.n;
    if (a.multi !== b.multi) return b.multi - a.multi;
    if (a.cd.B !== b.cd.B) return a.cd.B ? 1 : -1;
    if (a.prefixes.length !== b.prefixes.length) return b.prefixes.length - a.prefixes.length;
    return cmpTuple(a.best.t, b.best.t);
  }

  /* ---- put the pieces of the name together */
  function compose(d) {
    var S = d.S, n = d.n, inv = d.best.inv, order = d.best.order, k = d.groups.length, kind = d.P;
    if (n > 20) throw new Unsupported('chains longer than 20 carbons are not handled by the offline namer');
    var inChainKind = !d.ring && !d.cd.B && (CARBON_CLASSES[kind] || kind === 'acyl');
    var extKind = (d.ring || d.cd.B) && (EXTERNAL_OK[kind] || kind === 'acyl');
    var groups = d.groups.map(function (g) { return { loc: inv[g.i], g: g }; }).sort(function (a, b) { return a.loc - b.loc; });
    /* retained attachments */
    if (sub && !opts.acyl && !d.ring && n === 3) {
      var at = opts.attach, cn = G.nb[at].filter(function (x) { return G.el[x.n] === 'C' && x.n !== opts.from; });
      if (cn.length === 3 && cn.every(function (x) { return G.nb[x.n].length === 1; })) return { name: 'tert-butyl', cx: false };
    }
    /* multiple bonds */
    var enes = [], ynes = [];
    if (!d.aromatic) for (var i = 0; i < n; i++) { var j = (i + 1) % n; if (i === n - 1 && !d.ring) break; var b = bo(G, order[i], order[j]); if (b === 2) enes.push(i + 1); else if (b === 3) ynes.push(i + 1); }
    var unsat = enes.length + ynes.length, nPref = d.prefixes.length;
    var omitAll, showUnsat = true;
    if (d.ring) { omitAll = k + nPref <= 1 && unsat === 0 || (k + nPref === 0 && unsat === 1); if (unsat === 1 && k + nPref === 0) showUnsat = false; if (unsat > 0 && k + nPref > 0) omitAll = false; }
    else if (n === 1) omitAll = true;
    else if (n === 2) { omitAll = k + nPref <= 1; showUnsat = false; if (k + nPref > 1) omitAll = false; }
    else omitAll = false;
    var retainedAcet = false, body = null, sufText = null;
    var key = kind + (inChainKind ? ':c' : extKind ? ':e' : '');
    var SUF = { 'acid:c': 'oic acid', 'ester:c': 'oate', 'amide:c': 'amide', 'nitrile:c': 'nitrile', 'aldehyde:c': 'al', 'acyl:c': 'oyl', ketone: 'one', alcohol: 'ol', thiol: 'thiol', amine: 'amine', yl: 'yl',
      'acid:e': 'carboxylic acid', 'ester:e': 'carboxylate', 'amide:e': 'carboxamide', 'nitrile:e': 'carbonitrile', 'aldehyde:e': 'carbaldehyde', 'acyl:e': 'carbonyl' };
    sufText = SUF[key];
    if (sufText === undefined && kind !== '') throw new Unsupported('this functional group arrangement is not handled by the offline namer');
    /* special retained names */
    if (d.aromatic && k === 1) {
      var BZ = { yl: 'phenyl', acyl: 'benzoyl', alcohol: 'phenol', amine: 'aniline', acid: 'benzoic acid', ester: 'benzoate', amide: 'benzamide', nitrile: 'benzonitrile', aldehyde: 'benzaldehyde' };
      if (BZ[kind]) body = BZ[kind];
    }
    if (!d.ring && inChainKind && k === 1 && n <= 2 && !unsat) {
      var AC = n === 1 ? { 'acid': 'formic acid', ester: 'formate', amide: 'formamide', aldehyde: 'formaldehyde' } : { 'acid': 'acetic acid', ester: 'acetate', amide: 'acetamide', nitrile: 'acetonitrile', aldehyde: 'acetaldehyde', acyl: 'acetyl' };
      if (AC[kind]) { body = AC[kind]; retainedAcet = true; }
    }
    if (body === null) {
      var stem = d.aromatic ? 'benz' : (d.ring ? 'cyclo' : '') + STEM[n], s = stem, parts = [];
      if (d.aromatic) parts.push({ locs: [], base: 'en', forced: true });
      else { if (enes.length) parts.push({ locs: enes, base: 'en' }); if (ynes.length) parts.push({ locs: ynes, base: 'yn' }); if (!parts.length) parts.push({ locs: [], base: 'an' }); }
      parts.forEach(function (p, ix) {
        var mu = p.locs.length > 1; if (ix === 0 && mu) s += 'a';
        if (p.locs.length && showUnsat) s += '-' + p.locs.join(',') + '-';
        s += (mu ? MULT[p.locs.length] : '') + p.base;
      });
      if (k === 0) body = s + 'e';
      else {
        var mult = k > 1 ? MULT[k] : '', vowel = /^[aeiouy]/.test(sufText) && k === 1, locs = groups.map(function (g) { return g.loc; });
        var hideLoc = inChainKind || omitAll || (kind === 'yl' && locs[0] === 1 && !unsat) || (kind === 'yl' && d.ring && !unsat);
        if (!hideLoc && kind === 'yl' && locs[0] === 1 && unsat && d.ring) hideLoc = false;
        if (kind === 'yl' && !unsat && (hideLoc || d.ring)) s = stem;
        body = s + (vowel ? '' : 'e') + (hideLoc ? '' : '-' + locs.join(',') + '-') + mult + sufText;
        if (kind === 'yl' && !hideLoc && vowel) body = s + '-' + locs.join(',') + '-yl';
      }
    }
    /* N-substituents and ester groups */
    var prefs = d.prefixes.map(function (p) { return { sub: p.sub, loc: String(inv[p.i]), num: inv[p.i] }; });
    groups.forEach(function (g, gi) { (g.g.nsubs || []).forEach(function (s2) { prefs.push({ sub: s2, loc: 'N' + new Array(gi + 1).join("'"), num: 1e6 + gi }); }); });
    var hideNum = omitAll || retainedAcet, byName = {}, lst = [];
    prefs.forEach(function (p) { var kk = p.sub.name; if (!byName[kk]) { byName[kk] = { sub: p.sub, locs: [] }; lst.push(byName[kk]); } byName[kk].locs.push(p); });
    lst.sort(function (a, b) { return a.sub.key < b.sub.key ? -1 : a.sub.key > b.sub.key ? 1 : 0; });
    var pieces = lst.map(function (g) {
      var ls = g.locs.slice().sort(function (a, b) { return a.num - b.num; }).filter(function (p) { return !(hideNum && p.num < 1e6); }).map(function (p) { return p.loc; }), c = g.locs.length, nm = g.sub.name;
      var bodyP = c > 1 ? (g.sub.cx ? MULTC[c] + wrap(nm) : MULT[c] + nm) : (g.sub.cx ? wrap(nm) : nm);
      return (ls.length ? ls.join(',') + '-' : '') + bodyP;
    });
    var out = pieces.join('-') + body;
    if (kind === 'ester') {
      var rs = groups.map(function (g) { return g.g.rsub; }).filter(Boolean).sort(function (a, b) { return a.key < b.key ? -1 : 1; });
      if (rs.length) { var same = rs.every(function (r) { return r.name === rs[0].name; }), rn = same ? (rs.length > 1 ? (rs[0].cx ? MULTC[rs.length] + wrap(rs[0].name) : MULT[rs.length] + rs[0].name) : (rs[0].cx ? wrap(rs[0].name) : rs[0].name)) : rs.map(function (r) { return r.cx ? wrap(r.name) : r.name; }).join(' '); out = rn + ' ' + out; }
    }
    if (sub) return { name: out, cx: nPref > 0 || /\d/.test(out) };
    return { name: out };
  }
}

/* ---------------------------------------------------------------- public API */
/* explicit hydrogen atoms become hydrogen counts on their neighbour */
function stripH(mol) {
  var drop = {}, atoms = mol.atoms.map(function (a) { return { el: a.el, q: a.q || 0, h: a.h || 0 }; });
  mol.bonds.forEach(function (b) { [[0, 1], [1, 0]].forEach(function (p) { var x = b[p[0]], y = b[p[1]]; if (mol.atoms[x].el === 'H' && mol.atoms.length > 1 && !drop[x] && mol.bonds.filter(function (c) { return c[0] === x || c[1] === x; }).length === 1 && mol.atoms[y].el !== 'H') { drop[x] = 1; atoms[y].h += b[2]; } }); });
  var map = {}, out = []; atoms.forEach(function (a, i) { if (!drop[i]) { map[i] = out.length; out.push(a); } });
  return { atoms: out, bonds: mol.bonds.filter(function (b) { return !drop[b[0]] && !drop[b[1]]; }).map(function (b) { return [map[b[0]], map[b[1]], b[2]]; }) };
}
function nameMol(mol) {
  try {
    if (!mol || !mol.atoms || !mol.atoms.length) return { error: 'Nothing to name.' };
    mol = stripH(mol);
    if (mol.atoms.length === 1) {
      var a0 = mol.atoms[0], ION = { F: 'fluoride', Cl: 'chloride', Br: 'bromide', I: 'iodide' };
      if (ION[a0.el] && a0.q === -1 && !a0.h) return { name: ION[a0.el], note: '' };
      if (a0.el === 'O' && a0.q === -1 && a0.h === 1) return { name: 'hydroxide', note: '' };
    }
    var G = build(mol);
    var comps = 0, seen = {}; for (var i = 0; i < G.n; i++) if (!seen[i]) { comps++; reach(G, i, -1).forEach(function (a) { seen[a] = 1; }); }
    if (comps > 1) return { error: 'Name each separate structure on its own.' };
    for (i = 0; i < G.n; i++) {
      var e = G.el[i];
      if (!(e === 'C' || e === 'O' || e === 'N' || e === 'S' || HAL[e])) throw new Unsupported('the element ' + e + ' is not handled by the offline namer');
      if (G.q[i]) {
        var nitro = (e === 'N' && G.q[i] === 1 && G.nb[i].filter(function (x) { return G.el[x.n] === 'O'; }).length === 2) || (e === 'O' && G.q[i] === -1 && G.nb[i].length === 1 && G.el[G.nb[i][0].n] === 'N');
        if (!nitro) throw new Unsupported('charged species are not handled by the offline namer');
      }
    }
    /* nitro written with a charge-separated or a pentavalent nitrogen both come out as "nitro" */
    G.all = []; for (i = 0; i < G.n; i++) G.all.push(i);
    G.rings = findRings(G);
    var rid = {}; G.rings.forEach(function (r, ix) { r.forEach(function (x) { rid[x] = ix; }); });
    for (var bi = 0; bi < mol.bonds.length; bi++) { var ba = mol.bonds[bi][0], bb2 = mol.bonds[bi][1]; if (rid[ba] !== undefined && rid[bb2] !== undefined && rid[ba] !== rid[bb2]) {
      if (G.n === 12 && G.rings.length === 2 && G.rings.every(function (r) { return r.length === 6; }) && G.nb.every(function (l) { return l.length >= 2; }) && G.all.every(function (a2) { return G.el[a2] === 'C'; }) && G.h.every(function (h) { return h <= 1; })) return { name: "1,1'-biphenyl", note: 'Stereochemistry is not included.' };
      throw new Unsupported('ring assemblies and directly linked rings are not handled by the offline namer'); } }
    if (!G.all.some(function (a) { return G.el[a] === 'C'; })) throw new Unsupported('there is no carbon skeleton to name');
    var r = nameSkeleton(G, { mode: 'parent' });
    return { name: r.name, note: 'Stereochemistry is not included.' };
  } catch (err) {
    if (err instanceof Unsupported) return { error: err.message.charAt(0).toUpperCase() + err.message.slice(1) + '.' };
    return { error: 'The offline namer could not name this structure.', detail: String(err && err.message || err) };
  }
}
/* helper for tests and the page: SMILES-free construction from a compact list */
var API = { name: nameMol };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.IUPAC = API;
})(typeof self !== 'undefined' ? self : this);

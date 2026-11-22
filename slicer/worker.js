/* Runs the slicer off the main thread so the page stays responsive. */
importScripts('vendor/clipper.js', 'printers.js', 'engine.js');
self.onmessage = function (e) {
  try {
    var plan = self.Slicer.slice(e.data.tris, e.data.settings, function (p, label) { self.postMessage({ progress: p, label: label }); });
    var layers = plan.layers.map(function (l) { return { z: l.z, h: l.h, items: l.items.map(function (i) { return { type: i.type, pts: i.pts, closed: i.closed }; }) }; });
    self.postMessage({ done: true, plan: { layers: layers, gcode: plan.gcode, stats: plan.stats, unknown: plan.unknown, warnings: plan.warnings, supportTips: plan.supportTips } });
  } catch (err) { self.postMessage({ error: err && err.message ? err.message : String(err) }); }
};

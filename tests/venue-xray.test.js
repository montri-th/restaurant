import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSolid, screenBoxOf, solidHit, mat4Multiply, mat4Translation, transformPoint, installVenueXray, XRAY_LAYER, XRAY_MIN_ZOOM} from '../js/venue-xray.js';
import {installMassing, CITY_LAYER, FOCUS_LAYER, OCCLUDER_LAYER} from '../js/massing.js';
import {HOST_LAYERS} from '../js/buildings.js';

// Mercator stand-in: x = lon/360 + 0.5, y = 0.5 - lat/360 (flat), z = altitude × 1e-7 (like MercatorCoordinate near the equator).
const merc = ([lon, lat], alt = 0) => ({x: lon / 360 + 0.5, y: 0.5 - lat / 360, z: alt * 1e-7});
const square = (h, base = 0, lon = 100.5, lat = 13.74) => ({
  type: 'Feature', properties: {display_height_m: h, display_base_m: base, render_as: 'extrusion'},
  geometry: {type: 'Polygon', coordinates: [[[lon, lat], [lon + 0.001, lat], [lon + 0.001, lat + 0.001], [lon, lat + 0.001], [lon, lat]]]},
});

test('buildSolid makes walls, a roof and edges for a closed ring, relative to a local origin', () => {
  const s = buildSolid([square(20)], merc);
  // 4 walls × 2 triangles × 3 vertices + roof (2 triangles × 3)
  assert.equal(s.count, 24 + 6);
  // 4 roof edges + 4 base edges + 4 verticals, 2 vertices each
  assert.equal(s.lineCount, 24);
  assert.equal(s.positions.length, s.count * 3);
  assert.equal(s.shades.length, s.count);
  // Offsets are small (building-scale, origin at the centroid) so float32 keeps precision.
  const maxOffset = Math.max(...Array.from(s.positions).filter((_, i) => i % 3 !== 2).map(Math.abs));
  assert.ok(maxOffset < 1e-5, `offsets relative to the origin, got ${maxOffset}`);
  assert.ok(Math.abs(s.origin[0] - (100.5005 / 360 + 0.5)) < 1e-9);
  // Roof shade is 1, wall shades are in (0.6, 1).
  const roofShades = Array.from(s.shades).slice(24);
  assert.ok(roofShades.every(v => v === 1));
  assert.ok(Array.from(s.shades).slice(0, 24).every(v => v > 0.6 && v < 1));
  // Top vertices sit at the display height.
  const zs = new Set(Array.from(s.positions).filter((_, i) => i % 3 === 2).map(v => +v.toFixed(9)));
  assert.deepEqual([...zs].sort((a, b) => a - b), [0, +(20e-7).toFixed(9)]);
});

test('buildSolid handles holes, parts with a base and MultiPolygons; empty input is empty', () => {
  const withHole = {type: 'Feature', properties: {display_height_m: 12, display_base_m: 0},
    geometry: {type: 'Polygon', coordinates: [
      [[100.5, 13.74], [100.502, 13.74], [100.502, 13.742], [100.5, 13.742], [100.5, 13.74]],
      [[100.5005, 13.7405], [100.5015, 13.7405], [100.5015, 13.7415], [100.5005, 13.7415], [100.5005, 13.7405]],
    ]}};
  const s = buildSolid([withHole], merc);
  assert.equal(s.lineCount, 48, 'outer and hole edges');
  assert.ok(s.count > 48, 'walls for both rings plus a roof with a hole');
  const part = {type: 'Feature', properties: {display_height_m: 60, display_base_m: 20},
    geometry: {type: 'MultiPolygon', coordinates: [square(1).geometry.coordinates, square(1, 0, 100.6, 13.8).geometry.coordinates]}};
  const p = buildSolid([part], merc);
  assert.equal(p.count, 2 * 30);
  const zs = [...new Set(Array.from(p.positions).filter((_, i) => i % 3 === 2).map(v => +v.toFixed(9)))].sort((a, b) => a - b);
  assert.deepEqual(zs, [+(20e-7).toFixed(9), +(60e-7).toFixed(9)], 'base and top follow display_base_m / display_height_m');
  const e = buildSolid([], merc);
  assert.equal(e.count, 0); assert.equal(e.lineCount, 0);
});

test('solidHit finds a point on any projected wall or roof triangle', () => {
  const s = buildSolid([square(20)], merc);
  const scale = new Float64Array(16); scale[0] = 2e5; scale[5] = 2e5; scale[10] = 1; scale[15] = 1; // blow the tiny offsets up to clip space
  // roof centre projects to (0,0) → screen centre
  assert.equal(solidHit(s, scale, 400, 300, 200, 150), true);
  assert.equal(solidHit(s, scale, 400, 300, 2, 2), false);
});

test('matrix helpers: translation composes and transformPoint divides by w', () => {
  const t = mat4Translation(2, 3, 4);
  const p = transformPoint(t, [1, 1, 1]);
  assert.deepEqual(p.slice(0, 3), [3, 4, 5]);
  const s = new Float64Array(16); s[0] = 2; s[5] = 2; s[10] = 2; s[15] = 1;
  const m = mat4Multiply(s, t); // scale ∘ translate
  assert.deepEqual(transformPoint(m, [1, 1, 1]).slice(0, 3), [6, 8, 10]);
  const persp = new Float64Array(16); persp[0] = 1; persp[5] = 1; persp[10] = 1; persp[11] = 1; // w = z
  const q = transformPoint(persp, [2, 4, 2]);
  assert.deepEqual(q.slice(0, 2), [1, 2]);
});

test('screenBoxOf gives a padded device-pixel box, full screen when a vertex is behind the camera, null when nothing projects', () => {
  const id = new Float64Array(16); id[0] = id[5] = id[10] = id[15] = 1;
  const box = screenBoxOf([[-0.5, 0.5, 0], [0.5, -0.5, 0]], id, 200, 100, 0);
  assert.deepEqual(box, {x: 50, y: 25, width: 100, height: 50});
  const neg = new Float64Array(16); neg[0] = neg[5] = neg[10] = 1; neg[15] = -1; // w < 0 for every point
  assert.equal(screenBoxOf([[0, 0, 0]], neg, 200, 100), null);
  assert.equal(screenBoxOf([[0, 0, 0]], id, 200, 100, 0), null, 'a zero-area box is nothing to clear');
  assert.deepEqual(screenBoxOf([[0, 0, 0], [0.1, 0.1, 0]], id, 200, 100, 0), {x: 100, y: 45, width: 10, height: 5});
  // One vertex behind the camera (w < 0): clear the whole screen rather than guess.
  const half = (p) => (p[0] < 0 ? -1 : 1);
  const m = new Float64Array(16); m[0] = m[5] = m[10] = 1; m[15] = 1; m[3] = 10; // w = 10·x + 1 → negative for x < -0.1
  assert.deepEqual(screenBoxOf([[-0.5, 0, 0], [0.2, 0.1, 0]], m, 200, 100, 0), {x: 0, y: 0, width: 200, height: 100});
  assert.equal(half([-1]), -1);
});

function fakeGl() {
  const calls = [];
  const gl = new Proxy({}, {get: (_, name) => {
    if (name === 'drawingBufferWidth') return 400;
    if (name === 'drawingBufferHeight') return 300;
    if (typeof name === 'string' && /^[A-Z_]+$/.test(name)) return name; // enum stand-in
    if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
    if (name === 'getAttribLocation') return () => 0;
    if (name === 'getUniformLocation') return () => ({});
    if (name === 'createShader' || name === 'createProgram' || name === 'createBuffer') return () => ({});
    return (...args) => { calls.push([name, ...args]); };
  }});
  return {gl, calls};
}
function fakeMap() {
  const layers = []; const defs = new Map();
  return {
    layers, zoom: 16, pitch: 60, repaints: 0,
    getLayer: id => defs.get(id), addLayer(def, before) { defs.set(def.id, def); const i = before ? layers.indexOf(before) : -1; if (i >= 0) layers.splice(i, 0, def.id); else layers.push(def.id); },
    removeLayer(id) { defs.delete(id); layers.splice(layers.indexOf(id), 1); },
    addSource() {}, getSource: () => null, removeSource() {}, setFilter() {}, setLayoutProperty() {}, setPaintProperty() {}, on() {}, off() {}, querySourceFeatures: () => [], setFeatureState() {}, removeFeatureState() {},
    getZoom() { return this.zoom; }, getPitch() { return this.pitch; }, triggerRepaint() { this.repaints++; },
  };
}

test('installVenueXray: custom 3D layer inserted before the anchor; draws only in 3D from zoom 13 with a scissored depth clear', () => {
  const map = fakeMap();
  map.addLayer({id: 'water-name', type: 'symbol'});
  const xray = installVenueXray(map, {beforeId: 'water-name', toMercator: merc, colors: {fill: '#347DA8', stroke: '#176B82'}});
  assert.deepEqual(map.layers, [XRAY_LAYER, 'water-name']);
  const def = map.getLayer(XRAY_LAYER);
  assert.equal(def.type, 'custom'); assert.equal(def.renderingMode, '3d');
  const {gl, calls} = fakeGl();
  def.onAdd(map, gl);
  const r = xray.update([square(20)]);
  assert.equal(r.vertices, 30); assert.equal(r.features, 1); assert.ok(map.repaints >= 1);
  const main = new Float64Array(16); main[0] = main[5] = main[10] = main[15] = 1; // identity: mercator → clip
  calls.length = 0;
  def.render(gl, {defaultProjectionData: {mainMatrix: main}});
  const names = calls.map(c => c[0]);
  assert.ok(names.includes('scissor') && names.includes('clear'), 'depth cleared inside the venue box');
  assert.equal(names.filter(n => n === 'drawArrays').length, 2, 'solid + edges');
  const scissorIndex = names.indexOf('scissor'), drawIndex = names.indexOf('drawArrays');
  assert.ok(scissorIndex < drawIndex, 'clear happens before the draw');
  // Plan view or far zoom: nothing drawn.
  calls.length = 0; map.pitch = 0; def.render(gl, {defaultProjectionData: {mainMatrix: main}});
  assert.equal(calls.length, 0);
  map.pitch = 60; map.zoom = XRAY_MIN_ZOOM - 0.5; def.render(gl, {defaultProjectionData: {mainMatrix: main}});
  assert.equal(calls.length, 0);
  map.zoom = 16; xray.setEnabled(false); def.render(gl, {defaultProjectionData: {mainMatrix: main}});
  assert.equal(calls.length, 0);
  xray.setEnabled(true); xray.update([]); def.render(gl, {defaultProjectionData: {mainMatrix: main}});
  assert.equal(calls.length, 0, 'no venue → nothing drawn');
  // Hit test on the last drawn frame: identity matrix maps mercator offsets straight to clip space.
  xray.update([square(20)]); map.getContainer = () => ({clientWidth: 400, clientHeight: 300});
  const scaleM = new Float64Array(16); scaleM[0] = 2e5; scaleM[5] = 2e5; scaleM[10] = 1; scaleM[15] = 1; // tiny mercator offsets → ±55 px around the centre
  const o = buildSolid([square(20)], merc).origin;
  const big = mat4Multiply(scaleM, mat4Translation(-o[0], -o[1], 0)); // a view matrix centred on the venue, like MapLibre's
  def.render(gl, {defaultProjectionData: {mainMatrix: big}});
  assert.equal(xray.hitTest([190, 150]), true, 'inside the projected roof');
  assert.equal(xray.hitTest([5, 5]), false);
  xray.setEnabled(false); assert.equal(xray.hitTest([190, 150]), false);
  xray.setEnabled(true);
  xray.dispose();
  assert.ok(!map.getLayer(XRAY_LAYER));
});

test('draw order contract: massing tiers are inserted before the host extrusion so a translucent context building never cuts it away', () => {
  const map = fakeMap();
  map.addSource('openmaptiles', {});
  map.getSource = id => (id === 'openmaptiles' ? {} : null);
  map.addLayer({id: 'water-name', type: 'symbol'});
  map.addLayer({id: HOST_LAYERS.extrusion, type: 'fill-extrusion'}, 'water-name');
  installMassing(map, {beforeId: HOST_LAYERS.extrusion, colors: {}, tileUrl: () => ''});
  assert.deepEqual(map.layers, [CITY_LAYER, FOCUS_LAYER, OCCLUDER_LAYER, HOST_LAYERS.extrusion, 'water-name']);
});

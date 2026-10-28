import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseVectorTile, tileToLonLat} from '../js/mvt.js';
import {pointInRing, signedArea, ringsIntersect} from '../js/geometry.js';
import {shapeTile, tilesForRegions, roundingRadiusM, encloseOffsetM, outerRings, installMassing, focusFeatureId, interiorPoint, ringsOverlap, ringNestedIn, HEIGHT_LIFT_M, MAX_TILES, CITY_LAYER, FOCUS_LAYER, FOCUS_SOURCE, OCCLUDER_LAYER, VENUE_LAYER, SCENE, FADE_NEAR_M, FADE_FAR_M} from '../js/massing.js';

const tile = {z: 14, x: 12767, y: 7560};
const layer = parseVectorTile(readFileSync(new URL('./fixtures/mvt-sample.pbf', import.meta.url))).layers.building;
// A lon/lat region covering the left half of the tile (tile units 0…2048 → lon/lat).
const region = [[0, 0], [2048, 0], [2048, 4096], [0, 4096], [0, 0]].map(([px, py]) => tileToLonLat(px, py, tile));
const whole = [[-10, -10], [4106, -10], [4106, 4106], [-10, 4106], [-10, -10]].map(([px, py]) => tileToLonLat(px, py, tile));

test('focus massing keeps only buildings inside the focus region, lifts them and encloses the original', () => {
  const r = roundingRadiusM(15.5), d = encloseOffsetM(r);
  const out = shapeTile(tile, layer, {regions: [region], radiusM: r, offsetM: d});
  const ids = out.features.map(f => f.properties.osm_id).sort();
  assert.deepEqual(ids, [101], 'only the square at tile x≈1147 lies in the left half');
  const f = out.features[0];
  // Stable id: tile + ordinal among all building polygons of the tile, counted before the focus filter —
  // the same building keeps its id when the focus region changes (here: left half vs whole tile).
  const all = shapeTile(tile, layer, {regions: [whole], radiusM: r, offsetM: d});
  assert.equal(all.features.find(x => x.properties.osm_id === 101).id, f.id);
  assert.ok(Number.isSafeInteger(f.id) && f.id >= focusFeatureId(tile, 0) && f.id < focusFeatureId(tile, 0) + 2 ** 24);
  assert.equal(f.properties.height, 20 + HEIGHT_LIFT_M);
  assert.equal(f.properties.base, 0);
  assert.ok(f.geometry.coordinates[0].length > 5, 'corners are rounded (extra vertices)');
  // Every original vertex (tile units → lon/lat) is inside the model ring.
  const original = layer.features.find(x => x.id === 101).rings()[0].map(([px, py]) => tileToLonLat(px, py, tile));
  for (const p of original) assert.ok(pointInRing(p, f.geometry.coordinates[0]), 'model encloses the original footprint');
  // The original footprint (not rounded, not offset) is kept for the spatial join, under the same id.
  assert.equal(out.footprints.length, 1);
  const fp = out.footprints[0];
  assert.equal(fp.id, f.id);
  assert.equal(fp.osmId, 101);
  assert.equal(fp.height, 20);
  assert.equal(fp.outer.length, original.length);
  fp.outer.forEach((p, i) => { assert.ok(Math.abs(p[0] - original[i][0]) < 1e-12 && Math.abs(p[1] - original[i][1]) < 1e-12); });
});

test('hide_3d features are skipped, holes are kept and edge-crossing buildings are clipped to the tile', () => {
  const r = roundingRadiusM(16), d = encloseOffsetM(r);
  const out = shapeTile(tile, layer, {regions: [whole], radiusM: r, offsetM: d});
  const ids = out.features.map(f => f.properties.osm_id).sort((a, b) => a - b);
  assert.deepEqual(ids, [101, 102, 103, 103, 105], 'hide_3d (104) is out; the merged feature yields one polygon per outer ring');
  assert.equal(new Set(out.features.map(f => f.id)).size, out.features.length, 'the two polygons of merged feature 103 get distinct ids');
  // One OpenFreeMap feature can hold hundreds of polygons (same-height buildings merged under one OSM id):
  // every polygon still gets its own id.
  const ring = (x, y) => [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]]; // clockwise on screen (MVT outer)
  const merged = {extent: 4096, features: [{type: 3, id: 7, properties: {render_height: 6}, rings: () => Array.from({length: 600}, (_, i) => ring(100 + (i % 30) * 20, 100 + Math.floor(i / 30) * 20))}]};
  const many = shapeTile(tile, merged, {regions: [whole], radiusM: 3, offsetM: 1.2});
  assert.equal(many.features.length, 600);
  assert.equal(new Set(many.features.map(x => x.id)).size, 600, '600 polygons of one feature → 600 ids');
  assert.equal(out.footprints.find(b => b.osmId === 102).holes.length, 1, 'the footprint keeps its hole (a courtyard is not inside)');
  const l = out.features.find(f => f.properties.osm_id === 102);
  assert.equal(l.geometry.coordinates.length, 2, 'outer + hole');
  assert.ok(Math.abs(signedArea(l.geometry.coordinates[1])) < Math.abs(signedArea(l.geometry.coordinates[0])));
  const edge = out.features.find(f => f.properties.osm_id === 105);
  const [east] = tileToLonLat(4096, 0, tile);
  const maxLon = Math.max(...edge.geometry.coordinates[0].map(p => p[0]));
  const slackDeg = (d * 1.5) / 111320; // the outward offset may exceed the tile edge by ≈d metres, never by the 64-unit buffer
  assert.ok(maxLon <= east + slackDeg, 'buffer beyond the tile edge was clipped before shaping');
});

test('host overlap removes the OSM twin from the focus tier and reports its id for hiding', () => {
  const host = layer.features.find(x => x.id === 101).rings()[0].map(([px, py]) => tileToLonLat(px, py, tile));
  const r = roundingRadiusM(16), d = encloseOffsetM(r);
  const out = shapeTile(tile, layer, {regions: [whole], hosts: [host], radiusM: r, offsetM: d});
  assert.ok(!out.features.some(f => f.properties.osm_id === 101));
  assert.ok(!out.footprints.some(b => b.osmId === 101), 'a host-covered building is not joined as OSM (the host geometry is)');
  assert.deepEqual([...out.hiddenIds], [101], 'hidden in the city tier by its tile (OSM) id');
  assert.equal(out.dropped, 1);
});

test('a host that is the very same polygon as the tile building still hides it (OpenFreeMap Land buildings, 2026-10-28)', () => {
  // Identical rings: on-boundary vertex tests are undecidable and collinear edges never cross — the old test said
  // "no overlap" for a diamond and for an irregular quad, so the OSM twin stayed and z-fought the Land building.
  const diamond = [[5, 0], [10, 5], [5, 10], [0, 5], [5, 0]], quad = [[0, 0], [10, 2], [12, 9], [3, 10], [0, 0]];
  assert.ok(!ringsIntersect(diamond, diamond) && !ringsIntersect(quad, quad), 'fixture: the vertex/crossing test misses identical rings');
  assert.ok(ringsOverlap(diamond, diamond) && ringsOverlap(quad, quad.map(p => [p[0], p[1]])));
  assert.ok(pointInRing(interiorPoint(diamond), diamond) && pointInRing(interiorPoint(quad), quad));
  // Adjacent buildings sharing an edge do not overlap; nested ones do (either way round).
  const left = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], right = [[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]], inner = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
  assert.ok(!ringsOverlap(left, right) && ringsOverlap(left, inner) && ringsOverlap(inner, left));
  // In a tile: the host ring built from the tile polygon's own vertices (lon/lat, 7 decimals as published) drops it.
  const ring = layer.features.find(x => x.id === 101).rings()[0].map(([px, py]) => tileToLonLat(px, py, tile).map(v => Math.round(v * 1e7) / 1e7));
  const r = roundingRadiusM(16), d = encloseOffsetM(r);
  const out = shapeTile(tile, layer, {regions: [whole], hosts: [ring], radiusM: r, offsetM: d});
  assert.ok(!out.features.some(f => f.properties.osm_id === 101) && out.hiddenIds.has(101));
  assert.ok(out.features.some(f => f.properties.osm_id === 102), 'the neighbours stay');
  // A LOD1 Land outline keeps a building nested inside it (a tower on a podium); its twin and straddlers still go.
  const podium = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], tower = [[30, 30], [50, 30], [50, 50], [30, 50], [30, 30]], straddle = [[80, 40], [130, 40], [130, 60], [80, 60], [80, 40]];
  assert.ok(ringNestedIn(tower, podium) && !ringNestedIn(podium, podium) && !ringNestedIn(straddle, podium) && !ringNestedIn(podium, tower));
  const sq = (x, y, w) => [[x, y], [x + w, y], [x + w, y + w], [x, y + w], [x, y]];
  const nested = {extent: 4096, features: [
    {type: 3, id: 1, properties: {render_height: 22}, rings: () => [sq(1000, 1000, 400)]},
    {type: 3, id: 2, properties: {render_height: 120}, rings: () => [sq(1100, 1100, 80)]},
    {type: 3, id: 3, properties: {render_height: 30}, rings: () => [sq(1300, 1150, 300)]},
  ]};
  const host = sq(1000, 1000, 400).map(([px, py]) => tileToLonLat(px, py, tile));
  const keep = shapeTile(tile, nested, {regions: [whole], hosts: [{ring: host, keepNested: true}], radiusM: 3, offsetM: 1.2});
  assert.deepEqual(keep.features.map(f => f.properties.osm_id), [2], 'twin (1) and straddler (3) dropped, the nested tower (2) stays');
  assert.deepEqual([...keep.hiddenIds].sort(), [1, 3]);
  const plain = shapeTile(tile, nested, {regions: [whole], hosts: [host], radiusM: 3, offsetM: 1.2});
  assert.equal(plain.features.length, 0, 'a plain host ring (venue building, LOD2 outline) drops everything it overlaps');
});

test('tile planning is bounded and rounding radius follows zoom within 3–12 m', () => {
  const plan = tilesForRegions([whole]);
  assert.ok(plan.tiles.length >= 1 && plan.tiles.length <= MAX_TILES);
  assert.equal(roundingRadiusM(12), 12);
  assert.equal(roundingRadiusM(20), 3);
  const mid = roundingRadiusM(16);
  assert.ok(mid > 8 && mid < 10, `≈9.3 m at z16 (4 px), got ${mid}`);
  assert.ok(encloseOffsetM(mid) >= 1);
  assert.deepEqual(outerRings({geometry: {type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[2, 2], [3, 2], [3, 3], [2, 2]]]]}}).length, 2);
});

/** Minimal MapLibre stand-in: layers, sources, zoom and events. */
function fakeMap() {
  const layers = new Map(), sources = new Map([['openmaptiles', {}]]), handlers = {};
  return {
    layers, sources, filters: {}, visibility: {}, data: {},
    getLayer: id => layers.get(id), getSource: id => sources.get(id),
    addLayer(def) { layers.set(def.id, def); if (def.type !== 'fill-extrusion' || def.source === FOCUS_SOURCE) return; },
    addSource(id, def) { sources.set(id, {setData: d => { this.data[id] = d; }}); },
    removeLayer(id) { layers.delete(id); }, removeSource(id) { sources.delete(id); },
    setFilter(id, f) { this.filters[id] = f; }, setLayoutProperty(id, k, v) { this.visibility[id] = v; },
    paint: {}, setPaintProperty(id, k, v) { (this.paint[id] ||= {})[k] = v; },
    getZoom: () => 15.5, getPitch: () => 82, on(e, h) { handlers[e] = h; }, off(e) { delete handlers[e]; }, fire(e) { handlers[e]?.(); },
    // Screen projection stand-in for a camera looking north: x grows with longitude, y grows as latitude DEcreases (south = nearer the camera = lower on screen).
    project: ([lon, lat]) => ({x: (lon - 100.5) * 4e5, y: (13.75 - lat) * 4e5}),
    // City-tier buildings in "loaded tiles" and the feature-state they receive.
    cityFeatures: [], featureState: {},
    querySourceFeatures(src, opts) { return src === 'openmaptiles' && opts?.sourceLayer === 'building' ? this.cityFeatures : []; },
    setFeatureState(ref, state) { this.featureState[ref.id] = {...(this.featureState[ref.id] || {}), ...state}; },
    removeFeatureState() { this.featureState = {}; },
  };
}

test('installMassing reports every applied result through onResult (also empty/plan states) and skips cached repeats', async () => {
  const map = fakeMap();
  const bytes = readFileSync(new URL('./fixtures/mvt-sample.pbf', import.meta.url));
  const fetched = [];
  const results = [];
  const massing = installMassing(map, {
    beforeId: null, colors: {quiet: '#ECEDE8', focus: '#D9D7CD'},
    tileUrl: t => `stub/${t.z}/${t.x}/${t.y}.pbf`,
    fetchImpl: async url => { fetched.push(url); return {ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)}; },
    onResult: r => results.push(r),
  });
  assert.ok(map.getLayer(CITY_LAYER) && map.getLayer(FOCUS_LAYER), 'both tiers installed');
  // The fixture tile is 14/12767/7560; the region covers its left half (touching the west edge, so the
  // western neighbour is planned too). Every planned tile is fetched once; only one building qualifies.
  const first = await massing.update({regions: [region], hosts: [], zoom: 15.5, enabled: true, city: true, latitude: 13.75});
  assert.equal(first.features, 1);
  assert.equal(fetched.length, first.tiles);
  assert.ok(fetched.includes('stub/14/12767/7560.pbf'));
  assert.deepEqual(results.at(-1), first, 'applied result reached onResult');
  assert.equal(map.visibility[CITY_LAYER], 'visible');
  // Same input → cached, nothing re-fetched, onResult not called again.
  const again = await massing.update({regions: [region], hosts: [], zoom: 15.5, enabled: true, city: true, latitude: 13.75});
  assert.equal(again.cached, true);
  assert.equal(results.length, 1);
  // Plan view keeps the focus tier (flat rounded footprints) and hides the city tier.
  await massing.update({regions: [region], hosts: [], zoom: 15.5, enabled: true, city: false, latitude: 13.75});
  assert.equal(map.visibility[CITY_LAYER], 'none');
  assert.equal(map.visibility[FOCUS_LAYER], 'visible');
  // No focus → focus source emptied and the empty result is reported too.
  const none = await massing.update({regions: [], hosts: [], zoom: 15.5, enabled: true, city: true, latitude: 13.75});
  assert.equal(none.features, 0);
  assert.equal(map.data[FOCUS_SOURCE].features.length, 0);
  assert.equal(results.at(-1).features, 0);
  massing.dispose();
  assert.equal(map.getLayer(CITY_LAYER), undefined);
});

test('venue-level eye scene: surroundings quiet, buildings standing between the camera and the venue become see-through', async () => {
  const map = fakeMap();
  const bytes = readFileSync(new URL('./fixtures/mvt-sample.pbf', import.meta.url));
  const massing = installMassing(map, {
    beforeId: null, colors: {quiet: '#ECEDE8', focus: '#D9D7CD'},
    tileUrl: t => `stub/${t.z}/${t.x}/${t.y}.pbf`,
    fetchImpl: async () => ({ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)}),
  });
  assert.ok(map.getLayer(OCCLUDER_LAYER), 'occluder layer installed');
  const r = await massing.update({regions: [whole], hosts: [], zoom: 15.5, enabled: true, city: true, latitude: 13.75});
  assert.ok(r.features >= 2, 'fixture has several buildings');
  const feats = map.data[FOCUS_SOURCE].features;
  assert.equal(new Set(feats.map(f => f.id)).size, feats.length, 'focus feature ids are unique');
  assert.ok(feats.every(f => f.properties.osm_id != null), 'OSM id kept in properties');
  // Default scene: opaque tiers, no occluders.
  assert.equal(map.paint[FOCUS_LAYER]?.['fill-extrusion-opacity'] ?? SCENE.default.focus, SCENE.default.focus);
  assert.deepEqual(massing.occluders, []);
  // Target = a venue footprint placed just NORTH (behind, on screen: above) of building 101, overlapping it in screen space.
  const b101 = feats.find(f => f.properties.osm_id === 101);
  const ring = b101.geometry.coordinates[0];
  const lons = ring.map(p => p[0]), lats = ring.map(p => p[1]);
  const dLat = Math.max(...lats) - Math.min(...lats);
  const target = {ring: ring.map(([lon, lat]) => [lon, lat + dLat * 0.6]), height: 10};
  const scene = massing.setScene('eye', [target]);
  assert.equal(scene.scene, 'eye');
  assert.equal(map.paint[CITY_LAYER]['fill-extrusion-opacity'], SCENE.eye.city);
  assert.equal(map.paint[FOCUS_LAYER]['fill-extrusion-opacity'], SCENE.eye.focus);
  assert.ok(massing.occluders.includes(b101.id), 'building 101 stands in front of the target → see-through');
  assert.ok(!massing.occluders.includes(feats.find(f => f.properties.osm_id !== 101)?.id), 'a building elsewhere is not an occluder');
  assert.deepEqual(map.filters[OCCLUDER_LAYER], ['in', ['id'], ['literal', massing.occluders]]);
  // A target SOUTH of (in front of) the building is not hidden by it.
  massing.setScene('eye', [{ring: ring.map(([lon, lat]) => [lon, lat - dLat * 0.6]), height: 10}]);
  assert.deepEqual(massing.occluders, []);
  // Leaving the eye scene restores opacities and clears occluders even with targets.
  massing.setScene('default', [target]);
  assert.equal(map.paint[CITY_LAYER]['fill-extrusion-opacity'], SCENE.default.city);
  assert.deepEqual(massing.occluders, []);
  massing.dispose();
});

test('city tier fades with distance from the focus anchors: near → quiet tone, far → ground tone, re-stated when anchors change', async () => {
  const map = fakeMap();
  const lon0 = 100.5347, lat0 = 13.7466; // Siam anchor
  const metres = m => m / 111320; // ≈ degrees of latitude
  map.cityFeatures = [
    {id: 1, geometry: {type: 'Polygon', coordinates: [[[lon0, lat0 + metres(100)], [lon0, lat0 + metres(120)], [lon0 + 0.0001, lat0 + metres(120)], [lon0, lat0 + metres(100)]]]}},
    {id: 2, geometry: {type: 'Polygon', coordinates: [[[lon0, lat0 + metres(1300)], [lon0, lat0 + metres(1320)], [lon0 + 0.0001, lat0 + metres(1320)], [lon0, lat0 + metres(1300)]]]}},
    {id: 3, geometry: {type: 'MultiPolygon', coordinates: [[[[lon0, lat0 + metres(5000)], [lon0, lat0 + metres(5020)], [lon0 + 0.0001, lat0 + metres(5020)], [lon0, lat0 + metres(5000)]]]]}},
    {id: null, geometry: {type: 'Polygon', coordinates: [[[lon0, lat0], [lon0, lat0], [lon0, lat0], [lon0, lat0]]]}},
  ];
  const massing = installMassing(map, {beforeId: null, colors: {quiet: '#ECEDE8', focus: '#D9D7CD', ground: '#EEF1EE'}, tileUrl: () => '', fetchImpl: async () => ({ok: false, status: 404})});
  const paint = map.layers.get(CITY_LAYER).paint['fill-extrusion-color'];
  assert.deepEqual(paint.slice(0, 2), ['interpolate', ['linear']], 'city colour interpolates on feature-state fade');
  assert.ok(JSON.stringify(paint).includes('#EEF1EE'), 'far end is the ground tone');
  await massing.update({regions: [], hosts: [], anchors: [[lon0, lat0]], zoom: 14, enabled: true, city: true, latitude: 13.75});
  assert.equal(map.featureState[1].fade, 0, 'inside FADE_NEAR_M → no fade');
  const mid = map.featureState[2].fade;
  assert.ok(mid > 0.3 && mid < 0.6, `between near and far → partial fade (${mid}); expected ≈ ${((1300 - FADE_NEAR_M) / (FADE_FAR_M - FADE_NEAR_M)).toFixed(2)}`);
  assert.equal(map.featureState[3].fade, 1, 'beyond FADE_FAR_M → fully faded');
  assert.equal(map.featureState.null, undefined, 'features without an id are skipped');
  assert.equal(massing.faded, 3);
  // Same anchors → nothing re-stated; new anchors → states rebuilt.
  assert.equal(massing.updateFade(), 0);
  massing.setAnchors([[lon0, lat0 + metres(5000)]]);
  assert.equal(map.featureState[3].fade, 0, 'the far building is now next to the anchor');
  assert.equal(map.featureState[1].fade, 1);
  massing.dispose();
});

test('venue highlight tier: chosen focus buildings move to the data-colour layer, never occluders; hit test returns the footprint', async () => {
  const map = fakeMap();
  const bytes = readFileSync(new URL('./fixtures/mvt-sample.pbf', import.meta.url));
  const massing = installMassing(map, {
    beforeId: null, colors: {quiet: '#ECEDE8', focus: '#D9D7CD', venue: '#347DA8'},
    tileUrl: t => `stub/${t.z}/${t.x}/${t.y}.pbf`,
    fetchImpl: async () => ({ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)}),
  });
  assert.equal(map.getLayer(VENUE_LAYER).paint['fill-extrusion-color'], '#347DA8');
  await massing.update({regions: [whole], hosts: [], zoom: 15.5, enabled: true, city: true, latitude: 13.75});
  const list = massing.buildings();
  assert.ok(list.length >= 2 && list.every(b => Array.isArray(b.outer) && b.bbox.length === 4));
  const v0 = massing.version;
  const target = list.find(b => b.osmId === 101);
  assert.equal(massing.setHighlight([target.id, 999]), 1, 'unknown ids are ignored');
  assert.deepEqual(map.filters[VENUE_LAYER], ['in', ['id'], ['literal', [target.id]]]);
  assert.deepEqual(map.filters[FOCUS_LAYER], ['all', ['!', ['in', ['id'], ['literal', []]]], ['!', ['in', ['id'], ['literal', [target.id]]]]]);
  // Re-shaping at another zoom keeps the ids: the highlight stays on the same building.
  await massing.update({regions: [whole], hosts: [], zoom: 17.2, enabled: true, city: true, latitude: 13.75});
  assert.ok(massing.version > v0);
  assert.ok(massing.buildings().some(b => b.id === target.id && b.osmId === 101));
  // Hit test: the query result's id resolves to the footprint record.
  map.queryRenderedFeatures = () => [{id: target.id, layer: {id: VENUE_LAYER}}];
  assert.equal(massing.hitTest({x: 1, y: 1})?.osmId, 101);
  map.queryRenderedFeatures = () => [];
  assert.equal(massing.hitTest({x: 1, y: 1}), null);
  massing.setHighlight([]);
  assert.deepEqual(map.filters[VENUE_LAYER], ['in', ['id'], ['literal', []]]);
  massing.dispose();
  assert.equal(map.getLayer(VENUE_LAYER), undefined);
});

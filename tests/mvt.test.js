import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseVectorTile, lonLatToTile, tileToLonLat, lonLatToTileUnits, tilesForBBox, metresPerTileUnit} from '../js/mvt.js';

const fixture = new URL('./fixtures/mvt-sample.pbf', import.meta.url);
const expected = JSON.parse(readFileSync(new URL('./fixtures/mvt-sample.json', import.meta.url), 'utf8'));

test('reads layer, ids, typed properties and polygon rings exactly as encoded', () => {
  const tile = parseVectorTile(readFileSync(fixture));
  const layer = tile.layers.building;
  assert.ok(layer, 'building layer present');
  assert.equal(layer.extent, expected.extent);
  assert.equal(layer.features.length, expected.features.length);
  for (const [i, f] of layer.features.entries()) {
    const e = expected.features[i];
    assert.equal(f.id, e.id);
    assert.equal(f.type, 3);
    assert.deepEqual(f.properties, e.tags);
    assert.deepEqual(f.rings(), e.rings);
  }
  const hidden = layer.features.find(f => f.id === 104);
  assert.equal(hidden.properties.hide_3d, true);
  assert.equal(hidden.properties.render_min_height, 10);
  // Several layers in one tile: the reader must resume after each layer, not after its last feature.
  assert.deepEqual(Object.keys(tile.layers), expected.layers);
  const road = tile.layers.transportation.features[0];
  assert.equal(road.type, expected.road.type);
  assert.deepEqual(road.properties, expected.road.tags);
  assert.equal(road.rings()[0].length, expected.road.points);
  const place = tile.layers.place.features[0];
  assert.equal(place.id, expected.place.id);
  assert.deepEqual(place.properties, expected.place.tags);
  assert.deepEqual(place.rings(), [[expected.place.point]]);
});

test('varints above 32 bits (OSM ids) decode exactly', () => {
  // Hand-built tile: one layer, one point feature with id 4449208160 (> 2^32) and an int64 value.
  const bytes = [];
  const varint = n => { const out = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v); return out; };
  const str = s => { const b = [...new TextEncoder().encode(s)]; return [...varint(b.length), ...b]; };
  const field = (num, wire, payload) => [...varint((num << 3) | wire), ...payload];
  const len = payload => [...varint(payload.length), ...payload];
  const feature = [...field(1, 0, varint(4449208160)), ...field(2, 2, len([...varint(0), ...varint(0)])), ...field(3, 0, varint(1)), ...field(4, 2, len([...varint((1 << 3) | 1), ...varint(2 * 10), ...varint(2 * 20)]))];
  const value = field(4, 0, varint(2 ** 40)); // int64 value 2^40
  const layer = [...field(15, 0, varint(2)), ...field(1, 2, str('poi')), ...field(5, 0, varint(4096)), ...field(3, 2, str('big')), ...field(4, 2, len(value)), ...field(2, 2, len(feature))];
  bytes.push(...field(3, 2, len(layer)));
  const tile = parseVectorTile(new Uint8Array(bytes));
  const f = tile.layers.poi.features[0];
  assert.equal(f.id, 4449208160);
  assert.equal(f.properties.big, 2 ** 40);
  assert.equal(f.type, 1);
  assert.deepEqual(f.rings(), [[[10, 20]]]);
});

test('tile arithmetic round-trips Siam and bounds a bbox to a tile set', () => {
  const t = lonLatToTile(100.5331, 13.7462, 14);
  assert.deepEqual(t, {x: 12767, y: 7560, z: 14});
  const [px, py] = lonLatToTileUnits(100.5331, 13.7462, t);
  assert.ok(px >= 0 && px <= 4096 && py >= 0 && py <= 4096);
  const [lon, lat] = tileToLonLat(px, py, t);
  assert.ok(Math.abs(lon - 100.5331) < 1e-7 && Math.abs(lat - 13.7462) < 1e-7);
  assert.deepEqual(tilesForBBox([100.53, 13.74, 100.54, 13.75], 14).map(x => `${x.x}/${x.y}`), ['12767/7560']);
  const set = tilesForBBox([100.52, 13.72, 100.58, 13.76], 14);
  assert.equal(set.length, 12, 'four columns × three rows at z14');
  assert.deepEqual([...new Set(set.map(x => x.x))], [12766, 12767, 12768, 12769]);
  const m = metresPerTileUnit(t);
  assert.ok(m > 0.55 && m < 0.6, `≈0.58 m per unit at Bangkok, got ${m}`);
});

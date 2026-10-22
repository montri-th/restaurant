import test from 'node:test';
import assert from 'node:assert/strict';
import {joinRows, venueBuildings, buildingVenues, resolveBuilding, venueNeighbours, venueRegion, containsPoint, footprint, VENUE_SHARE} from '../js/building-join.js';

// Synthetic footprints near Siam (lon/lat squares; d = half-size in degrees).
const square = (cx, cy, d) => [[cx - d, cy - d], [cx + d, cy - d], [cx + d, cy + d], [cx - d, cy + d], [cx - d, cy - d]];
const X = 100.53, Y = 13.745;
const row = (id, dx, dy, venue = null) => ({id, name: id, longitude: X + dx, latitude: Y + dy, venue, reviews: 10});
const mall = {id: 'V-mall', name: 'Mall'}, market = {id: 'V-market', name: 'Market'}, hosted = {id: 'V-hosted', name: 'Hosted'};

test('a display point joins the smallest drawn footprint that contains it; holes and the outside join nothing', () => {
  const outline = {key: 'osm:1', kind: 'osm', outer: square(X, Y, 0.001), holes: [square(X + 0.0007, Y + 0.0007, 0.0001)]};
  const part = {key: 'osm:2', kind: 'osm', outer: square(X - 0.0004, Y, 0.0002)};
  const rows = [row('in-part', -0.0004, 0), row('in-outline', 0.0004, -0.0004), row('in-hole', 0.0007, 0.0007), row('outside', 0.003, 0), {id: 'no-point', longitude: NaN, latitude: NaN}];
  const j = joinRows([outline, part], rows);
  assert.equal(j.byRow.get('in-part'), 'osm:2', 'a part inside an outline wins (smallest)');
  assert.equal(j.byRow.get('in-outline'), 'osm:1');
  assert.ok(!j.byRow.has('in-hole'), 'a courtyard (hole) is not inside');
  assert.ok(!j.byRow.has('outside') && !j.byRow.has('no-point'));
  assert.deepEqual(j.byBuilding.get('osm:1').map(r => r.id), ['in-outline']);
  assert.ok(containsPoint(footprint(part), [X - 0.0004, Y]) && !containsPoint(footprint(part), [X, Y]));
});

test('venue buildings: official host geometry when drawn; otherwise OSM buildings holding ≥ max(1, 20%) of the venue\'s joined points', () => {
  assert.equal(VENUE_SHARE, 0.2);
  const a = {key: 'osm:a', kind: 'osm', outer: square(X, Y, 0.0005)};
  const b = {key: 'osm:b', kind: 'osm', outer: square(X + 0.002, Y, 0.0002)};
  const h = {key: 'host:h:0', kind: 'host', outer: square(X - 0.003, Y, 0.0005), venueIds: [hosted.id]};
  const rows = [
    ...Array.from({length: 9}, (_, i) => row(`m${i}`, 0.0001 * (i % 3), 0.0001 * Math.floor(i / 3), mall)), // 9 in A
    row('m-stray', 0.002, 0, mall), // 1 stray in B: 1 < ⌈0.2 × 10⌉ = 2 → B is not the mall's
    row('k1', 0.002, 0.0001, market), // the market's only point → B is the market's
    row('other', 0.0002, -0.0002), // no venue, in A
    row('h1', -0.003, 0, hosted), row('h-osm', 0.0003, 0.0003, hosted), // hosted: official geometry only
  ];
  const j = joinRows([a, b, h], rows);
  const vk = venueBuildings(j, {hosted: new Set([hosted.id])});
  assert.deepEqual(vk.get(mall.id), ['osm:a']);
  assert.deepEqual(vk.get(market.id), ['osm:b']);
  assert.deepEqual(vk.get(hosted.id), ['host:h:0'], 'a hosted venue keeps its official building; its point in an OSM building does not add one');
  const kv = buildingVenues(vk);
  assert.deepEqual(kv.get('osm:a'), [mall.id]);
  // Click resolution.
  assert.deepEqual(resolveBuilding('osm:a', j, kv), {kind: 'venue', id: mall.id});
  assert.deepEqual(resolveBuilding('osm:b', j, kv), {kind: 'venue', id: market.id}, 'the venue with most own points there');
  // Neighbours of the mall: rows whose points fall in its buildings without naming it (incl. another venue's).
  const n = venueNeighbours(mall.id, j, vk);
  assert.equal(n.buildings, 1);
  assert.equal(n.own, 9);
  assert.deepEqual(n.others.map(r => r.id).sort(), ['h-osm', 'other']);
});

test('a click on a building without a venue opens the store (one point) or the building (several); none → falls through', () => {
  const one = {key: 'osm:1', kind: 'osm', outer: square(X, Y, 0.0002)};
  const many = {key: 'osm:2', kind: 'osm', outer: square(X + 0.001, Y, 0.0002)};
  const empty = {key: 'osm:3', kind: 'osm', outer: square(X + 0.002, Y, 0.0002)};
  const j = joinRows([one, many, empty], [row('s1', 0, 0), row('s2', 0.001, 0), row('s3', 0.001, 0.0001), row('s4', 0.0011, 0)]);
  const kv = buildingVenues(venueBuildings(j));
  assert.deepEqual(resolveBuilding('osm:1', j, kv), {kind: 'store', id: 's1'});
  const several = resolveBuilding('osm:2', j, kv);
  assert.equal(several.kind, 'building');
  assert.deepEqual(several.rows.map(r => r.id), ['s2', 's3', 's4']);
  assert.equal(resolveBuilding('osm:3', j, kv), null);
  assert.equal(resolveBuilding('osm:404', j, kv), null);
});

test('venue region: the core cluster plus a buffer; a far outlier does not stretch the focus tier across the city', () => {
  const pts = [[X, Y], [X + 0.0005, Y + 0.0003], [X + 0.0002, Y - 0.0004], [X + 0.2, Y + 0.2]];
  const r = venueRegion(pts, {bufferM: 150});
  const lons = r.map(p => p[0]), lats = r.map(p => p[1]);
  const widthM = (Math.max(...lons) - Math.min(...lons)) * 111320 * Math.cos(Y * Math.PI / 180);
  assert.ok(widthM > 300 && widthM < 400, `≈ 55 m of points + 2 × 150 m buffer, got ${widthM.toFixed(0)} m`);
  assert.ok(Math.max(...lons) < X + 0.01, 'outlier left out');
  assert.equal(venueRegion([]), null);
});

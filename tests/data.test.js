import test from 'node:test';
import assert from 'node:assert/strict';
import {load, readJSON, sha256} from './helpers.js';
import {PROVINCES, PRICE_BUCKETS, GRID, gridToLngLat, sourceTile, hasPoint} from '../js/model.js';

// One population since 0.6.0 (owner 2026-10-28 22:36): data.rows = sheet-1 restaurants + register outlets; the rows the
// owner moved to the register (data.moved) are counted there and stay reachable by id. The snapshot itself is still
// 70,214 observations = restaurants + moved.
const snapshotRows = data => [...data.restaurants, ...data.moved];
import {hostedVenueIds} from '../js/buildings.js';

test('restaurants.json decodes to the 70,214 observations of the snapshot, nothing dropped, ids unique', () => {
  const {raw, data, register} = load();
  assert.equal(raw.meta.schema, 'citymeter-restaurants-rows-2');
  assert.equal(raw.meta.rows, 70214);
  assert.equal(raw.cols.key.length, 70214);
  assert.equal(snapshotRows(data).length, 70214);
  assert.equal(data.restaurants.length, 68980, 'sheet 1');
  assert.equal(data.moved.length, 1234, 'rows moved to the chain register, counted there');
  assert.equal(data.outlets.length, register.outlets.length);
  assert.equal(data.rows.length, 68980 + 26819, 'one population: sheet 1 + the register (owner 2026-10-28 22:36)');
  assert.equal(data.dropped, 0, 'every row resolves to a subdistrict frame');
  assert.equal(new Set([...data.rows, ...data.moved].map(r => r.id)).size, data.rows.length + data.moved.length, 'row keys are unique across both sheets');
  for (const k of Object.keys(raw.cols)) assert.equal(raw.cols[k].length, 70214, `column ${k} is complete`);
});

test('decoded rows reconcile with the build receipt: provinces, price buckets, reviews, ratings, prices', () => {
  const {raw, data} = load();
  const byProvince = {}, byPrice = Object.fromEntries(PRICE_BUCKETS.map(b => [b, 0]));
  let reviews = 0, rated = 0, priced = 0;
  for (const r of snapshotRows(data)) {
    byProvince[r.province] = (byProvince[r.province] || 0) + 1;
    byPrice[r.price]++;
    if (Number.isFinite(r.reviews)) reviews += r.reviews;
    if (Number.isFinite(r.rating)) rated++;
    if (r.price !== 'UNSPECIFIED') priced++;
  }
  assert.deepEqual(byProvince, raw.meta.rowsByProvince);
  assert.deepEqual(byPrice, raw.meta.priceBuckets);
  assert.equal(reviews, raw.meta.reviewsTotal);
  assert.equal(rated, raw.meta.rowsWithRating);
  assert.equal(priced, raw.meta.rowsWithPrice);
  // Snapshot values (regression fixtures, never UI constants).
  assert.deepEqual(raw.meta.rowsByProvince, {BKK: 44086, NBI: 11532, SPK: 11505, PTE: 1999, SKN: 883, CCO: 189, NPT: 20});
  assert.equal(raw.meta.reviewsTotal, 6185635);
  assert.equal(byPrice.OVER_1000, 0, 'the > 1,000 baht bucket exists in the source vocabulary but holds no row');
});

test('membership is the source subdistrict: every row sits in an existing frame of its own district and province', () => {
  const {data, index} = load();
  for (const r of snapshotRows(data)) {
    const a = index.byId.get(r.area);
    assert.ok(a, `area ${r.area}`);
    assert.equal(r.district, a.district);
    assert.equal(r.province, a.province);
    assert.ok(PROVINCES.some(p => p.code === r.province));
  }
  // Outlets carry the register's own derivations: a subdistrict only inside the covered provinces, a province by point or text.
  for (const o of data.outlets) {
    assert.equal(o.kind, 'outlet');
    if (o.area) { const a = index.byId.get(o.area); assert.ok(a, `outlet area ${o.area}`); assert.equal(o.district, a.district); assert.equal(o.province, a.province); }
    assert.ok(o.group >= 0 && o.groupId === 'register' && o.price === 'UNSPECIFIED' && o.rating == null && o.reviews == null);
  }
});

test('coordinates decode with the research formula on the z10 × 4096 grid and stay display positions', () => {
  const {raw, data} = load();
  const research = (gx, gy) => [gx / GRID * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / GRID))) * 180 / Math.PI];
  const snapshot = snapshotRows(data);
  for (let i = 0; i < snapshot.length; i += 997) {
    const r = snapshot[i];
    const [lon, lat] = research(r.gx, r.gy);
    assert.ok(Math.abs(lon - r.longitude) < 1e-9 && Math.abs(lat - r.latitude) < 1e-9);
    assert.deepEqual(gridToLngLat(r.gx, r.gy), [r.longitude, r.latitude]);
    assert.ok(hasPoint(r));
    assert.ok(r.longitude > 97 && r.longitude < 106 && r.latitude > 5 && r.latitude < 21, 'inside Thailand');
    const t = sourceTile(r);
    assert.equal(t.z, 10);
    assert.ok(t.x >= 0 && t.x < 1024 && t.y >= 0 && t.y < 1024);
  }
  assert.equal(raw.meta.coordinate.role, 'mvt_display_position_z10');
  assert.equal(raw.meta.geometryRole.mvt_geometry_tile_quantized_not_source_exact, 70214);
});

test('brand and venue links stay name-based candidates; holds carry no logo; hosted venues match the building set', () => {
  const {raw, data} = load();
  assert.match(raw.meta.brandRule, /not a verified branch relationship/);
  assert.match(raw.meta.venueRule, /not a verified located-inside relationship/);
  for (const b of data.brands) {
    assert.ok(typeof b.link === 'string' && b.link.length);
    if (b.hold) assert.equal(b.logo, '', `${b.name} is on identity hold: no logo`);
  }
  const holds = data.brands.filter(b => b.hold);
  assert.equal(holds.length, 3, 'three brand identity holds in this release');
  const logos = readJSON('data/brand-logos.json');
  const linked = new Set(logos.brands.map(b => b.id));
  for (const h of holds) assert.ok(!linked.has(h.id));
  const hosted = hostedVenueIds(readJSON('data/venue-buildings.geojson'));
  assert.deepEqual([...hosted].sort(), data.venues.filter(v => v.host).map(v => v.id).sort());
  assert.equal(hosted.size, 26);
  // Building parts (LOD > 1) by CityMETER venue uuid win over a name match or no geometry (owner 2026-10-28): MBK Center.
  const geo = readJSON('data/venue-buildings.geojson');
  assert.deepEqual(geo.metadata.lodVenues.map(v => v.name), ['MBK Center']);
  const mbk = data.venues.find(v => v.name === 'MBK Center');
  const mbkFeatures = geo.features.filter(f => f.properties.venue_ids.includes(mbk.id));
  assert.ok(mbk.host && mbkFeatures.some(f => f.properties.geometry_role === 'host_building_part_not_shop_unit'));
  assert.ok(mbkFeatures.every(f => /uuid/.test(f.properties.venue_join)), 'joined by id, never by name');
  for (const f of geo.features.filter(f => f.properties.geometry_role === 'host_building_part_not_shop_unit')) {
    assert.ok(f.properties.display_height_m > f.properties.display_base_m, `${f.properties.host_id}: a part has its own base and top`);
  }
  const counts = new Map();
  for (const r of snapshotRows(data)) if (r.venue) counts.set(r.venue.id, (counts.get(r.venue.id) || 0) + 1);
  for (const v of data.venues) assert.equal(counts.get(v.id) || 0, v.rows, `${v.name} row count`);
});

test('boundaries: 581 subdistrict frames with production areas, 90 districts, 77 provinces, receipts bound by hash', () => {
  const {areasGeo, districtsGeo, provincesGeo, index} = load();
  assert.equal(areasGeo.features.length, 581);
  assert.equal(districtsGeo.features.length, 90);
  // 0.6.0: every province (the covered seven dissolved from their subdistricts; the others from the production PROVINCE outline).
  assert.equal(provincesGeo.features.length, 77);
  assert.equal(provincesGeo.features.filter(f => f.properties.frame === 'dissolved_subdistricts').length, 7);
  for (const f of provincesGeo.features) { assert.ok(f.properties.areaSqm > 0 && f.properties.code && f.properties.name, `${f.id}`); assert.ok(Array.isArray(f.properties.label)); }
  const prec = readJSON('data/boundary-receipts.json');
  assert.equal(prec.provinceReceipts.length, 70);
  for (const r of prec.provinceReceipts) { assert.match(r.sha256, /^[a-f0-9]{64}$/); assert.match(r.url, /\/restaurant\/info\/geom\/[0-9a-f-]+\/PROVINCE$/); }
  const ids = areasGeo.features.map(f => f.properties.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const f of areasGeo.features) {
    const p = f.properties;
    assert.ok(p.areaSqm > 0, `${p.id} has a production area`);
    assert.ok(Array.isArray(p.label) && p.label.length === 2);
    assert.ok(['Polygon', 'MultiPolygon'].includes(f.geometry.type));
    assert.ok(index.districtById.has(p.district), `${p.id} → district ${p.district}`);
  }
  const total = index.districts.reduce((s, d) => s + d.areas.length, 0);
  assert.equal(total, 581, 'every subdistrict belongs to exactly one district');
  const receipts = readJSON('data/boundary-receipts.json');
  assert.equal(receipts.receipts.length, 581);
  assert.equal(areasGeo.metadata.receipts, 581);
  for (const r of receipts.receipts) { assert.match(r.sha256, /^[a-f0-9]{64}$/); assert.match(r.url, /^https:\/\/landometer\.com\/api\/v2\/citymeter-v3\/restaurant\/info\/geom\//); }
  // Same recipe as scripts/build-boundaries.py: sha256(json.dumps(sorted((id, sha256) …))) with Python's default separators.
  const pairs = receipts.receipts.map(r => [r.id, r.sha256]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const python = `[${pairs.map(([id, h]) => `["${id}", "${h}"]`).join(', ')}]`;
  assert.equal(sha256(Buffer.from(python)), areasGeo.metadata.receiptsSha256);
});

test('coverage: 475 frames hold restaurants or outlets; the other 106 are no-data, never zero', () => {
  const {covered, coverage, index, data} = load();
  // Snapshot fixtures (one population): sheet-1 rows cover 308 frames; outlets with a point add 167 more.
  assert.equal(new Set(data.restaurants.map(r => r.area)).size, 308);
  assert.equal(covered.size, 475);
  assert.equal(index.areas.length - covered.size, 106);
  assert.ok(coverage.km2 > 3899.11, `coverage ${coverage.km2}`);
});

test('name-ending venues (owner decision 2026-10-23): sheet links first, then a sheet name at the end, then a repeated place ending', () => {
  const {raw, data} = load();
  const s = raw.meta.venueSuffix;
  // Snapshot values (regression fixtures, never UI constants).
  // 2026-10-28: the owner's sheet now links 8 of the 0.2.1 name-ending rows itself (sheet beats suffix), so 3 remain.
  assert.deepEqual({suffixRows: s.suffixRows, autoRows: s.autoRows, autoVenues: s.autoVenues, radiusM: s.radiusM}, {suffixRows: 3, autoRows: 252, autoVenues: 84, radiusM: 200});
  const by = m => snapshotRows(data).filter(r => r.venueMatch === m);
  assert.equal(by('suffix').length, s.suffixRows);
  assert.equal(by('auto').length, s.autoRows);
  assert.ok(data.rows.every(r => (r.venue ? ['sheet', 'suffix', 'auto'].includes(r.venueMatch) : r.venueMatch === null)));
  // A sheet venue name at the end of the restaurant name (a branch/floor word may follow).
  const siam = data.rows.find(r => r.name === 'รสดีเด็ด เจ้าเก่าสยามสแควร์');
  assert.equal(siam.venue?.name, 'Siam Square');
  assert.equal(siam.venueMatch, 'suffix');
  const panya = data.rows.find(r => r.name === 'Shabu Shabu Nangnai (Panya Market Branch)');
  assert.equal(panya?.venue?.name, 'Panya Market');
  assert.equal(panya.venueMatch, 'suffix');
  // A sheet link always wins over the name ending (the owner linked KFC Gateway Bangsue in the sheet on 2026-10-28).
  const kfc = data.rows.find(r => r.name === 'KFC Gateway Bangsue');
  assert.equal(kfc.venue?.name, 'Gateway Bangsue');
  assert.equal(kfc.venueMatch, 'sheet');
  // A place word after หน้า / Behind … names a neighbour, never a host.
  for (const name of ['ข้าวต้มลุงเล็ก หน้าโลตัสศรีนครินทร์', 'Por Prathip Ayutthaya Noodle - Behind Central Bangna']) {
    const r = data.rows.find(x => x.name === name);
    assert.ok(r, name);
    assert.equal(r.venue, null, `${name} has no venue`);
  }
  // Name-derived places: ids RX-…, ≥ 2 rows each, every point within 200 m of the rows' median point.
  const auto = data.venues.filter(v => v.match === 'auto');
  assert.equal(auto.length, s.autoVenues);
  const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), (a[1] - b[1]) * 110574);
  for (const v of auto) {
    assert.match(v.id, /^RX-[0-9a-f]{16}$/);
    const rs = data.rows.filter(r => r.venue?.id === v.id);
    assert.ok(rs.length >= 2 && rs.every(r => r.venueMatch === 'auto'), v.name);
    const med = i => { const x = rs.map(r => (i ? r.latitude : r.longitude)).sort((a, b) => a - b); return x[x.length >> 1]; };
    // Display points sit on the ≈ 9.55 m grid: allow the grid half-diagonal.
    for (const r of rs) assert.ok(metres([r.longitude, r.latitude], [med(0), med(1)]) <= 200 + 7, `${v.name}: ${r.name}`);
  }
  const charn = auto.find(v => v.name === 'Charn At The Avenue');
  assert.equal(charn?.rows, 14);
  assert.ok(auto.some(v => v.name === 'ตลาดพระราม 5'), 'Thai endings with and without a space merge into one place');
  assert.ok(!auto.some(v => v.name === 'ตลาดพระราม5'));
});

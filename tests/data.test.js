import test from 'node:test';
import assert from 'node:assert/strict';
import {load, readJSON, sha256, fixture, release} from './helpers.js';
import {PROVINCES, PRICE_BUCKETS, GRID, gridToLngLat, sourceTile, hasPoint, priceTier, LEGACY_PRICE, filterRows, SIZE_BANDS} from '../js/model.js';

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
  // The register's outlets are its source set's (data/release.json: 28,306 read 2026-11-10; 2026-11-09: 27,954; 0.8.0: 27,527; 0.7.1: 27,120).
  assert.equal(data.rows.length, 68980 + release().register.outlets, 'one population: sheet 1 + the register (owner 2026-10-28 22:36)');
  assert.equal(data.dropped, 0, 'every row resolves to a subdistrict frame');
  assert.equal(new Set([...data.rows, ...data.moved].map(r => r.id)).size, data.rows.length + data.moved.length, 'row keys are unique across both sheets');
  for (const k of Object.keys(raw.cols)) assert.equal(raw.cols[k].length, 70214, `column ${k} is complete`);
});

// The API's own price bucket (cols.price, COALESCE(end, start)) — kept in the data, no longer used by the page.
const API_BUCKETS = ['UNDER_100', 'R100_300', 'R300_500', 'R500_1000', 'OVER_1000', 'UNSPECIFIED'];

test('decoded rows reconcile with the build receipt: provinces, price tiers, reviews, ratings, prices', () => {
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
  const api = Object.fromEntries(API_BUCKETS.map(b => [b, 0]));
  for (const v of raw.cols.price) api[API_BUCKETS[v] || 'UNSPECIFIED']++;
  assert.deepEqual(api, raw.meta.priceBuckets, 'the API bucket still reconciles with the build receipt');
  // 0.8.0: six tiers from the stated bounds (register workbook rules.price). Each API bucket splits into whole tiers,
  // so links of 0.1–0.7 map without loss; the API's “500–1,000” held the 907 “from 1,000” rows, now P6.
  assert.deepEqual(byPrice, {P1: 9056, P2: 6090, P3: 2844, P4: 937, P5: 165, P6: 907, UNSPECIFIED: 50215});
  assert.equal(byPrice.P1, api.UNDER_100);
  assert.equal(byPrice.P2 + byPrice.P3, api.R100_300);
  assert.equal(byPrice.P4, api.R300_500);
  assert.equal(byPrice.P5 + byPrice.P6, api.R500_1000 + api.OVER_1000);
  assert.equal(byPrice.UNSPECIFIED, api.UNSPECIFIED);
  assert.deepEqual(LEGACY_PRICE, {UNDER_100: 'P1', R100_300: 'P2,P3', R300_500: 'P4', R500_1000: 'P5', OVER_1000: 'P6'});
  assert.equal(filterRows(data.restaurants, {price: 'P2,P3'}).length, filterRows(data.restaurants, {price: 'P2'}).length + filterRows(data.restaurants, {price: 'P3'}).length, 'a legacy 100–300 link opens both tiers');
  for (const [p0, p1, t] of [[null, null, 'UNSPECIFIED'], [100, null, 'P1'], [101, 150, 'P2'], [150, 300, 'P3'], [1000, null, 'P6'], [500, 1000, 'P5'], [1500, null, 'P6'], [null, 1200, 'P6']]) assert.equal(priceTier(p0, p1), t, `${p0}–${p1}`);
  assert.equal(reviews, raw.meta.reviewsTotal);
  assert.equal(rated, raw.meta.rowsWithRating);
  assert.equal(priced, raw.meta.rowsWithPrice);
  // Snapshot values (regression fixtures, never UI constants).
  assert.deepEqual(raw.meta.rowsByProvince, {BKK: 44086, NBI: 11532, SPK: 11505, PTE: 1999, SKN: 883, CCO: 189, NPT: 20});
  assert.equal(raw.meta.reviewsTotal, 6185635);
  assert.equal(api.OVER_1000, 0, 'the API bucket “over 1,000” held no row: the open-ended “from 1,000” rows sat in 500–1,000');
});

test('segments (0.8.0; food 0.9.2): chain size and the food taxonomy from the register workbook, aligned to this build; the other held axes stay off the page', () => {
  const {raw, data} = load();
  const seg = readJSON('data/segments.json'), m = seg.meta;
  assert.equal(m.schema, 'citymeter-restaurant-segments-1');
  assert.equal(seg.rows.size.length, raw.cols.key.length);
  assert.equal(seg.outlets.size.length, readJSON('data/chains.json').cols.id.length);
  assert.equal(m.rows.keySha256, sha256(Buffer.from(raw.cols.key.join('\n'))), 'rows aligned to restaurants.json cols.key');
  assert.equal(m.outlets.idSha256, sha256(Buffer.from(readJSON('data/chains.json').cols.id.join('\n'))), 'outlets aligned to chains.json cols.id');
  assert.deepEqual(m.priceCheck, {agree: 68980}, 'the page\'s tiers equal price_band_observed on every classified row');
  assert.deepEqual(Object.keys(m.reviewStatus), ['unreviewed'], 'nothing reviewed yet');
  fixture('segments.reviewStatus', m.reviewStatus);
  // 0.9.2: the food taxonomy ships by owner decision (2026-11-03 16:59) ahead of the QA check; the other axes stay held.
  for (const f of ['format_id', 'occasion_ids', 'special_label_ids', 'price_band_inferred', 'food_subgroup_secondary_ids', 'food_group_secondary_ids']) assert.ok(m.held.fields.includes(f), f);
  for (const f of ['food_category_id', 'food_group_id', 'food_subgroup_primary_id']) assert.ok(!m.held.fields.includes(f), f);
  assert.ok(/owner decision 2026-11-03 16:59/.test(m.released['food taxonomy']), 'the release says whose decision put it on the page');
  assert.deepEqual([m.food.categories.length, m.food.groups.length, m.food.subgroups.length], [6, 19, 31]);
  assert.deepEqual(m.food.basis, {inference: 68887}, 'every classified row is an inference of the workbook');
  assert.equal(seg.rows.food.length, raw.cols.key.length);
  assert.equal(seg.outlets.sub.length, readJSON('data/chains.json').cols.id.length);
  // Attached as the browser does: a group carries its category; a sub-group sits under its group (the build checks the codebook).
  const grouped = data.rows.filter(r => r.food);
  fixture('segments.foodRows', {grouped: [data.restaurants.filter(r => r.food).length, data.outlets.filter(r => r.food).length], sub: [data.restaurants.filter(r => r.foodSub).length, data.outlets.filter(r => r.foodSub).length]}, 'sheet-1 rows + outlets with a food group / sub-group');
  assert.equal(grouped.length, m.food.rows.grouped + m.food.outlets.grouped);
  assert.equal(data.rows.filter(r => r.foodSub).length, m.food.rows.subgrouped + m.food.outlets.subgrouped);
  const groupOf = new Map(m.food.groups.map(g => [g.id, g.category])), subOf = new Map(m.food.subgroups.map(x => [x.id, x.group]));
  assert.ok(grouped.every(r => groupOf.get(r.food) === r.foodCat && (!r.foodSub || subOf.get(r.foodSub) === r.food)));
  assert.ok(data.moved.every(r => !r.food), 'a moved row is classified on the register side');
  assert.ok(!/docs\.google|drive\.google|spreadsheets\/d\//.test(JSON.stringify(seg)), 'no private sheet link');
  // Every kept row and every outlet but the point-of-sale registry is sized; moved rows are sized on the register side.
  assert.equal(data.segments.ok, true);
  assert.equal(data.segments.attached, data.restaurants.length + data.outlets.filter(o => o.sizeBasis !== 'x').length);
  fixture('segments.attached', data.segments);
  assert.ok(data.restaurants.every(r => SIZE_BANDS.includes(r.size)));
  assert.ok(data.outlets.every(o => SIZE_BANDS.includes(o.size) || (o.sizeBasis === 'x' && o.brand.id === 'ROOT-BR-cpf-pos-network')), 'only the registry is unsized');
  fixture('segments.notSized', data.outlets.filter(o => o.sizeBasis === 'x').length);
  // One chain, one size: a chain's rows all carry the largest band the source gives any of them, never a smaller one.
  const byKey = new Map();
  for (const r of data.rows) { if (!r.size || !(r.kind === 'outlet' ? r.brand?.id : r.brand)) continue; const k = r.kind === 'outlet' ? r.brand.id : (r.brand.national?.[0] || r.brand.id); (byKey.get(k) || byKey.set(k, new Set()).get(k)).add(r.size); }
  assert.ok([...byKey.values()].every(s => s.size === 1), 'every chain has one size');
  assert.ok(data.rows.filter(r => r.sizeLifted).every(r => SIZE_BANDS.indexOf(r.size) > SIZE_BANDS.indexOf(r.sizeOwn)), 'a lift only raises');
  // A row without a chain candidate is “one observed row”, never “an independent shop”.
  assert.ok(data.restaurants.filter(r => !r.brand).every(r => r.size === 'S1' && r.sizeBasis === 's'));
  const bySize = Object.fromEntries(SIZE_BANDS.map(b => [b, data.rows.filter(r => r.size === b).length]));
  fixture('segments.bySize', bySize);
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
    // 0.7.0: an outlet sits in one of the ten food-type groups (its chain's derived type, else ไม่ระบุประเภท) and says how.
    assert.ok(o.group >= 0 && data.groups[o.group]?.id === o.groupId && o.groupId !== 'register' && o.price === 'UNSPECIFIED' && o.rating == null && o.reviews == null);
    if (o.groupBy) assert.ok(['rows', 'format'].includes(o.groupBy.how) && o.groupBy.groupId === o.groupId);
    else assert.equal(o.groupId, 'unspecified');
  }
  // The derivation is a majority of the chain's typed sheet-1 rows (≥ 3 rows, > half), so KFC's outlets read as fast food.
  const kfc = data.outlets.find(o => /^kfc$/i.test(o.brand?.name || ''));
  if (kfc) assert.equal(kfc.groupId, 'fastfood', 'KFC outlets inherit the chain type');
  const typed = data.outlets.filter(o => o.groupBy?.how === 'rows').length;
  assert.ok(typed > 1000, `outlets typed from the chain's rows: ${typed}`);
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

test('coverage: 476 frames hold restaurants or outlets; the other 105 are no-data, never zero', () => {
  const {covered, coverage, index, data} = load();
  // Snapshot fixtures (one population): sheet-1 rows cover 308 frames; outlets with a point add 168 more
  // (register of 2026-11-03; 0.7.1: 167 more, 475 covered, 106 no-data).
  assert.equal(new Set(data.restaurants.map(r => r.area)).size, 308);
  assert.equal(covered.size, 476);
  assert.equal(index.areas.length - covered.size, 105);
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

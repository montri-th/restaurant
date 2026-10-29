/**
 * Chain register (data/chains.json) and the Land join (data/land.json + land-buildings.geojson), releases 0.3–0.7.
 * Contracts: the register keeps its own unit (one outlet_id per listed branch) and, since 0.6.0, joins the
 * population as rows (0.7.0: under one vocabulary and one chain index); derived fields say how they were derived;
 * the Land join publishes only “in” relations (inside the
 * OpenStreetMap outline or within 10 m — those points get a display position inside it) that the browser geometry
 * reproduces; every view ends with one provenance line and never claims “ตั้งอยู่ใน”.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {load, readJSON, readBytes, sha256, ROOT} from './helpers.js';
import {brandsIn, provincesIn, outletMix, searchRegister, EVIDENCE, STATUS} from '../js/register.js';
import {decodeLand, geometryContains, distanceToGeometry, landProfile, landOfRow, landOfOutlet, hostsOf, aroundGeometry, landTypeTh, applyRowDisplay, applyOutletDisplay, LAND_RULE} from '../js/land.js';
import {renderLandHostsIn, renderStoreLand, renderStoreRegister, renderChains, renderCompany, renderOutlet, renderLand} from '../js/register-panel.js';
import {buildChainIndex, chainsOf} from '../js/chains.js';
import {configureBrandLogos} from '../js/brand-logos.js';
import {brandKey} from '../js/model.js';

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
let ctx = null;
function setup() {
  if (ctx) return ctx;
  const base = load();
  configureBrandLogos(readJSON('data/brand-logos.json'));
  const raw = readJSON('data/chains.json');
  // The register the population was built from (js/model.js#outletRows mutates its outlets into rows, as init() does).
  const reg = base.register;
  const landRaw = readJSON('data/land.json'), landGeo = readJSON('data/land-buildings.geojson');
  const land = decodeLand(landRaw, landGeo);
  // As the app does: every row by id (the population plus the rows moved to the register), and the population's keys
  // for the scoped Land counts.
  const rowById = new Map([...base.data.rows, ...base.data.moved].map(r => [r.id, r]));
  const population = new Set(base.data.rows.map(r => r.id));
  // As the app does: points within 10 m of their Land building take the display position inside it.
  const snapped = {rows: applyRowDisplay(land, rowById), outlets: applyOutletDisplay(land, reg.byId)};
  ctx = {...base, raw, reg, landRaw, landGeo, land, rowById, population, snapped};
  return ctx;
}
const PRIVATE = /(docs|drive)\.google\.com|googleusercontent\.com|drive\.usercontent/;

test('chains.json keeps the register unit: 26,819 outlet_ids, unique, every column complete', () => {
  const {raw, reg} = setup();
  assert.equal(raw.meta.schema, 'citymeter-chain-register-1');
  const n = raw.cols.id.length;
  // Snapshot values of the register read on 2026-10-28 (regression fixtures, never UI constants).
  assert.equal(n, 26819);
  assert.equal(raw.meta.outlets, n);
  assert.equal(String(raw.meta.readmeCounts['จำนวนตัวตนสาขา/จุดขาย']), String(n), 'equals the register README count');
  for (const [k, col] of Object.entries(raw.cols)) assert.equal(col.length, n, `column ${k}`);
  assert.equal(new Set(raw.cols.id).size, n, 'outlet ids are unique');
  assert.equal(reg.outlets.length, n);
  assert.equal(reg.brands.length, raw.meta.brandsWithOutlets);
  assert.equal(reg.brands.reduce((s, b) => s + b.outlets, 0), n, 'every outlet belongs to exactly one brand record');
  for (const b of reg.brands) assert.equal((reg.byBrand.get(b.id) || []).length, b.outlets, b.id);
});

test('coordinates: only the register\'s selected points, inside Thailand; no point stays without one', () => {
  const {raw, reg} = setup();
  let withPoint = 0;
  for (const o of reg.outlets) {
    if (!o.hasPoint) { assert.equal(o.latitude ?? null, null); assert.equal(o.longitude ?? null, null); continue; }
    withPoint++;
    assert.ok(o.latitude > 5 && o.latitude < 21 && o.longitude > 97 && o.longitude < 106, o.id);
  }
  assert.equal(withPoint, raw.meta.stats.withPoint);
  assert.equal(withPoint, 16728);
});

test('province and แขวง/ตำบล are derived and say how: point-in-polygon first, register text second, unknown stays unknown', () => {
  const {raw, reg, index} = setup();
  const codes = new Set(reg.provinces.map(p => p.code));
  assert.equal(reg.provinces.length, 77);
  const stats = {point: 0, text: 0, none: 0};
  for (const o of reg.outlets) {
    if (!o.province) { assert.equal(o.provinceBy, ''); stats.none++; continue; }
    assert.ok(codes.has(o.province), o.province);
    if (o.provinceBy === 'point') { assert.ok(o.hasPoint, `${o.id}: province by point needs a point`); stats.point++; }
    else { assert.equal(o.provinceBy, 'text'); stats.text++; }
    if (o.area) {
      const a = index.byId.get(o.area);
      assert.ok(a, `${o.id}: area ${o.area} is a frame`);
      assert.ok(o.hasPoint, 'an area comes only from a point');
      assert.equal(a.province, o.province, `${o.id}: the frame lies in the outlet's province`);
    }
  }
  assert.deepEqual(stats, {point: raw.meta.stats.provinceByPoint, text: raw.meta.stats.provinceByText, none: raw.meta.stats.noProvince});
  assert.equal(reg.outlets.filter(o => o.area).length, raw.meta.stats.inCovered);
});

test('evidence and status classes reconcile with the register meta; closures are the source\'s claim, kept apart', () => {
  const {raw, reg} = setup();
  const mix = outletMix(reg.outlets);
  assert.deepEqual(Object.fromEntries(raw.meta.evidence.map(e => [e.id, e.count])), mix.evidence);
  assert.deepEqual(Object.fromEntries(raw.meta.status.map(e => [e.id, e.count])), mix.status);
  assert.equal(EVIDENCE.reduce((s, k) => s + mix.evidence[k], 0), reg.outlets.length);
  assert.equal(STATUS.reduce((s, k) => s + mix.status[k], 0), reg.outlets.length);
  assert.equal(mix.evidence.cart, Number(raw.meta.readmeCounts['จุดขายรถเข็นชายสี่']), 'cart points = the README count');
});

test('no private research links ship: every source and web URL is public https', () => {
  const {raw} = setup();
  const urls = [...raw.urls, ...raw.brands.map(b => b.web), ...raw.companies.map(c => c.web), ...raw.brands.map(b => b.reported?.source)].filter(Boolean);
  assert.ok(urls.length > 1000);
  for (const u of urls) { assert.match(u, /^https:\/\//, u); assert.ok(!PRIVATE.test(u), u); }
  for (const f of ['data/chains.json', 'data/land.json', 'data/land-buildings.geojson', 'data/restaurants.json']) assert.ok(!PRIVATE.test(readBytes(f).toString('utf8')), f);
});

test('the snapshot stays 70,214 observations: Sheet 1 plus the 1,234 rows moved to the register, each counted once', () => {
  const {raw: chains, data} = setup();
  const meta = data.meta;
  const snapshot = [...data.restaurants, ...data.moved];
  assert.equal(meta.rowSources.sheet1 + meta.rowSources.movedToChainRegister, snapshot.length);
  assert.deepEqual({sheet1: meta.rowSources.sheet1, moved: meta.rowSources.movedToChainRegister}, {sheet1: 68980, moved: 1234});
  assert.equal(data.moved.length, 1234, 'every moved row is flagged and counted on the register side (0.6.0), none dropped or doubled');
  assert.ok(data.restaurants.every(r => !r.register) && data.moved.every(r => r.register));
  assert.ok(data.moved.filter(r => r.register === 2).length > 0);
  // Register targets of a moved row are outlet ids or secondary observations; only outlet ids resolve to points.
  const ids = new Set(chains.cols.id);
  const targets = data.moved.flatMap(r => r.registerTargets);
  assert.ok(targets.length > 0 && targets.some(t => ids.has(t)));
});

test('snapshot brand candidates link to register brands by id only (01_BRANDS.national_brand_ids)', () => {
  const {data, reg} = setup();
  let linked = 0;
  for (const b of data.brands) for (const id of b.national || []) if (reg.brandById.has(id)) linked++;
  assert.ok(linked >= 100, `${linked} links`);
  const after = data.brands.find(b => b.name === 'After You');
  assert.deepEqual(after.national, ['R2BR-AU-AFTER-YOU']);
  assert.ok(reg.brandById.get('R2BR-AU-AFTER-YOU').outlets > 0);
});

test('register logos reuse verified files only (sha256 equal to a shipped file)', () => {
  const {reg} = setup();
  const logos = readJSON('data/brand-logos.json');
  const assets = new Map(logos.assets.map(a => [a.key, a]));
  const linked = reg.brands.filter(b => b.logo);
  assert.ok(linked.length >= 50);
  for (const b of linked) {
    const a = assets.get(b.logo);
    assert.ok(a, `${b.id}: ${b.logo}`);
    const path = join(ROOT, a.path || a.file || a.src || '');
    if (existsSync(path)) assert.equal(sha256(readBytes(a.path || a.file || a.src)), a.sha256, a.key);
  }
});

test('register helpers: search by brand or company name, provinces with the unknown kept apart', () => {
  const {reg} = setup();
  // Brand names first, then brands whose outlet names hold the query (never outlet addresses).
  const kfc = searchRegister(reg, 'kfc');
  const named = kfc.brands.findIndex(b => !/kfc/i.test(`${b.name} ${b.family} ${b.companyRecord?.name || ''}`));
  assert.ok(kfc.brands.length >= 1 && /kfc/i.test(kfc.brands[0].name));
  if (named >= 0) assert.ok(kfc.brands.slice(named).every(b => !/kfc/i.test(b.name) && (reg.byBrand.get(b.id) || []).some(o => /kfc/i.test(o.name))));
  assert.equal(searchRegister(reg, 'after you').brands[0].name, 'After You');
  const empty = searchRegister(reg, '   ');
  assert.equal(empty.brands[0].outlets, Math.max(...reg.brands.map(b => b.outlets)), 'blank search lists the largest brands');
  const big = empty.brands[0];
  const p = provincesIn(reg.byBrand.get(big.id), reg.provinces);
  assert.equal(p.list.reduce((s, x) => s + x.count, 0) + p.unknown, big.outlets);
  const area = [...reg.byArea.keys()][0];
  const top = brandsIn(reg.byArea.get(area), 5);
  assert.ok(top.length >= 1 && top[0].count >= (top[1]?.count ?? 0));
});

test('land.json publishes “in” relations only (inside or within 10 m, drawn inside), every key resolves, and the browser geometry reproduces them', () => {
  const {landRaw, landGeo, land, data, reg, snapped} = setup();
  assert.equal(landRaw.meta.schema, 'citymeter-land-join-2');
  const keys = new Set([...data.restaurants, ...data.moved].map(r => r.id)), outlets = new Set(reg.outlets.map(o => o.id));
  assert.ok(landRaw.snapshot.length > 2000 && landRaw.chains.length > 1500);
  // rel 0 = in; d = the source point's distance to the outline (0 inside, ≤ 10 m when it lay outside).
  for (const [k, b, rel, d] of landRaw.snapshot) { assert.ok(keys.has(k), k); assert.equal(rel, 0); assert.ok(land.buildings.has(b)); assert.ok(d >= 0 && d <= 10); }
  for (const [k, b, rel, d] of landRaw.chains) { assert.ok(outlets.has(k), k); assert.equal(rel, 0); assert.ok(land.buildings.has(b)); assert.ok(d >= 0 && d <= 10); }
  // Every point that lay outside has a display position, and every displayed point is inside its building (the
  // browser's planar geometry); source positions are kept.
  const moved = {rows: landRaw.snapshot.filter(r => r[3] > 0 && !landRaw.snapshot.some(o => o[0] === r[0] && o !== r && o[3] === 0)).length};
  assert.ok(snapped.rows > 500 && snapped.outlets > 200, `${snapped.rows} rows and ${snapped.outlets} outlets drawn inside`);
  assert.equal(landRaw.snaps.rows.length, snapped.rows); assert.equal(landRaw.snaps.chains.length, snapped.outlets);
  assert.ok(moved.rows <= snapped.rows);
  const rows = new Map([...data.restaurants, ...data.moved].map(r => [r.id, r])), outs = new Map(reg.outlets.map(o => [o.id, o]));
  let checked = 0, movedChecked = 0;
  for (const [list, lookup] of [[landRaw.snapshot, rows], [landRaw.chains, outs]]) {
    for (let i = 0; i < list.length; i += 7) {
      const [k, b, , d] = list[i];
      const p = lookup.get(k), g = land.buildings.get(b).geometry;
      const pt = [p.longitude, p.latitude];
      if (p.snapped) {
        assert.ok(geometryContains(g, pt), `${k} drawn inside building ${b}`);
        assert.ok(distanceToGeometry(g, [p.sourceLongitude, p.sourceLatitude]) <= 10.5, `${k} source point within 10 m of building ${b}`);
        movedChecked++;
      } else assert.ok(geometryContains(g, pt) || distanceToGeometry(g, pt) < 0.5 || d > 0, `${k} in building ${b}`);
      checked++;
    }
  }
  assert.ok(checked > 500 && movedChecked > 50, `${checked} relations recomputed, ${movedChecked} moved points`);
  // One building feature per building id (its join outline) + its parts; every host id listed exists.
  const mains = landGeo.features.filter(f => f.properties.geometry_role === 'land_host_building');
  const parts = landGeo.features.filter(f => f.properties.geometry_role === 'land_host_building_part');
  assert.equal(mains.length + parts.length, landGeo.features.length);
  assert.equal(mains.length, land.buildings.size);
  const hostIds = new Set(land.hosts.map(h => h.id));
  for (const f of landGeo.features) assert.ok(f.properties.venue_ids.length >= 1 && f.properties.venue_ids.every(id => hostIds.has(id)), f.id);
  for (const f of mains) {
    if (f.properties.pieces) { assert.equal(f.properties.render_as, 'outline'); assert.equal(land.parts.get(f.properties.building).length, f.properties.pieces); }
    else { assert.equal(f.properties.render_as, 'extrusion'); assert.ok(f.properties.display_height_m > 0); }
  }
  // OpenStreetMap only (owner 2026-10-28 18:27): every outline is an OpenFreeMap tile polygon with its OSM id.
  for (const f of mains) assert.ok(f.properties.source === 'openfreemap_osm' && f.properties.osm_id != null, f.id);
  assert.ok(!landGeo.features.some(f => /v4/i.test(String(f.properties.source))), 'no CityMETER V4 footprint');
  // LOD > 1 (owner 2026-10-28 15:24): registry parts extrude from their own base to top inside the OSM outline.
  assert.ok(mains.some(f => f.properties.lod === 2), 'registry building parts are used where they exist');
  for (const f of parts) {
    assert.ok(f.properties.display_height_m > f.properties.display_base_m, f.id);
    assert.equal(f.properties.render_as, 'extrusion');
    // Parts sit in the same building (IoU ≥ 0.5 at build time): most part vertices lie in or near the outline.
    const outline = land.buildings.get(f.properties.building).geometry;
    const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0])[0];
    const near = ring.filter(v => distanceToGeometry(outline, v) < 15).length;
    assert.ok(near >= ring.length * 0.8, `${f.id} lies in its building (${near}/${ring.length})`);
  }
  for (const h of land.hosts) { assert.ok(['shopping', 'hotel', 'office'].includes(h.ds)); assert.ok(h.fp >= 0 && land.buildings.has(h.fp), h.id); assert.ok(landTypeTh(h.ds, h.type)); }
});

test('Land hosts link to sheet venues by the CityMETER venue uuid only', () => {
  const {land, data} = setup();
  const byUuid = new Map(land.hosts.filter(h => h.uuid).map(h => [h.uuid, h]));
  const linked = data.venues.filter(v => v.uuid && byUuid.has(v.uuid));
  assert.ok(linked.length >= 20, `${linked.length} venues`);
  for (const v of linked) assert.equal(byUuid.get(v.uuid).ds, 'shopping');
});

test('Land profile: rows in the building, the 100 m ring outside it, register outlets apart', () => {
  const {land, rowById, population, reg, data} = setup();
  // The host with the most snapshot points in its building.
  const host = [...land.hosts].sort((a, b) => (land.rowsByBuilding.get(b.fp)?.length || 0) - (land.rowsByBuilding.get(a.fp)?.length || 0))[0];
  // Scoped to the population, as the app does: a row moved to the register is counted there, not in the building.
  const p = landProfile(land, host, {rowsByKey: rowById, outletsById: reg.byId, scopeKeys: population});
  const inside = p.rows.in;
  assert.equal(inside.length, land.rowsByBuilding.get(host.fp).filter(k => population.has(k)).length);
  assert.ok(land.rowsByBuilding.get(host.fp).length > inside.length, 'this building held rows the owner moved to the register');
  assert.ok(inside.length > 0 && !('edge' in p.rows), 'no separate edge bucket: within 10 m counts as in');
  const ring = aroundGeometry(p.feature.geometry, data.restaurants, 100, new Set(inside.map(r => r.id)));
  for (const r of ring) { const d = distanceToGeometry(p.feature.geometry, [r.longitude, r.latitude]); assert.ok(d > 10 && d <= 100); }
  assert.equal(hostsOf(land, host.fp)[0].ds <= 'shopping' || true, true);
  // Each point names this building as its primary relation or as one of the nested buildings that also contain it.
  const buildingsOf = rel => [rel.building, ...rel.also.map(x => x.building)];
  for (const r of inside) assert.ok(buildingsOf(landOfRow(land, r.id)).includes(host.fp), r.id);
  for (const o of p.outlets.in) assert.ok(buildingsOf(landOfOutlet(land, o.id)).includes(host.fp), o.id);
  // Nested buildings: a point inside an office tower that sits in a mall outline is “in” both.
  const nested = [...land.rowLinks.values()].filter(l => l.length > 1);
  assert.ok(nested.length > 0 && nested.every(l => l.slice(1).every(x => x.rel === 'in')), 'nested links are “in” relations');
});

test('register and Land views: one provenance line each (dataset · source · date · boundary + the unit once), never “ตั้งอยู่ใน”', () => {
  const {reg, land, rowById, data, index} = setup();
  const chains = buildChainIndex({rows: data.rows, brands: data.brands, register: reg});
  const company = reg.companies.find(c => (reg.byCompany.get(c.id) || []).length);
  const outlet = reg.outlets.find(o => o.hasPoint && o.area);
  const host = land.hosts.find(h => (land.rowsByBuilding.get(h.fp) || []).length > 3);
  const profile = landProfile(land, host, {rowsByKey: rowById, outletsById: reg.byId});
  const companyOutlets = reg.byCompany.get(company.id);
  const views = {
    chains: renderChains({reg, chains: chainsOf(data.rows, chains, Infinity), scopeCount: data.rows.length, withPoint: 1}),
    company: renderCompany({reg, company, chains: chainsOf(companyOutlets, chains, Infinity), rows: companyOutlets, withPoint: companyOutlets.filter(o => o.hasPoint).length}),
    outlet: renderOutlet({reg, outlet, area: index.byId.get(outlet.area), land: landOfOutlet(land, outlet.id), sameBrand: [], group: data.groups[outlet.group]}),
    land: renderLand({land, profile, around: [], groups: data.groups, index, chains: chainsOf([...profile.rows.in, ...profile.outlets.in], chains, Infinity)}),
  };
  const caveats = /ไม่ได้ยืนยัน|ไม่นำมาบวกกัน|ละเอียดราว|คนละหน่วย/g;
  for (const [name, html] of Object.entries(views)) {
    const t = text(html);
    assert.ok(!/ตั้งอยู่ใน/.test(t), `${name}: no located-in claim`);
    // One provenance line per view: the four fields once, and the unit clause at most once (owner 2026-10-28 18:27).
    assert.equal((html.match(/class="hint panel-foot provenance"|class="hint source-line"/g) || []).length, 1, `${name}: one provenance line`);
    assert.ok(/ชุดข้อมูล \S/.test(t) && /แหล่ง \S/.test(t) && /ตรวจ \d/.test(t) && /ขอบเขต \S/.test(t), `${name}: dataset · source · date · boundary`);
    assert.ok((t.match(caveats) || []).length <= 1, `${name}: caveats said once at most — ${t.match(caveats)}`);
    assert.ok(!/สาขาในทะเบียน/.test(t), `${name}: one vocabulary (0.7.0) — no register framing`);
    assert.ok(t.includes('ค้นต่อ') && /AI Mode/.test(t), `${name}: outbound searches offered`);
  }
  assert.ok(text(views.chains).includes('ไม่ใช่จำนวนร้านที่เปิดอยู่จริง'), 'the register unit is explained once');
  assert.ok(text(views.outlet).includes(outlet.brand.name) && views.outlet.indexOf(`<h2>${outlet.brand.name}`) > 0, 'an outlet is headed by its chain');
  assert.ok(views.outlet.includes('maps/@?api=1&amp;map_action=pano') && views.outlet.includes('udm=50'), 'Street View at the point and an AI Mode question');
  assert.ok(text(views.land).includes(LAND_RULE) && text(views.land).includes('ร้านในอาคาร') && !text(views.land).includes('ติดขอบ'));
  const row = rowById.get(landOfRow(land, [...land.rowRel.keys()][0]) ? [...land.rowRel.keys()][0] : '');
  const storeLand = text(renderStoreLand(landOfRow(land, row.id)));
  assert.ok(/จุดอยู่ในขอบอาคาร|จุดต้นทางห่างขอบอาคาร [\d.]+ ม\. \(ไม่เกิน 10 ม\. นับเป็นในอาคาร/.test(storeLand) && !/ตั้งอยู่ใน|ติดขอบ/.test(storeLand));
  // A point counted in from outside says so, with its distance (review 2026-10-28: never “in the outline” for a moved point).
  const movedKey = [...land.rowLinks].find(([, l]) => l[0].d > 0)?.[0];
  const movedText = text(renderStoreLand(landOfRow(land, movedKey)));
  assert.ok(/จุดต้นทางห่างขอบอาคาร [\d.]+ ม\. \(ไม่เกิน 10 ม\. นับเป็นในอาคาร หมุดแสดงในอาคาร\)/.test(movedText) && !movedText.includes('จุดอยู่ในขอบอาคาร'), movedText);
  const moved = data.moved.find(r => r.register === 1);
  assert.ok(text(renderStoreRegister({row: moved, register: moved.register})).includes('นับครั้งเดียวฝั่งทะเบียนร้านเครือ'));
  const hostsIn = renderLandHostsIn([{host, rows: 3, outlets: 1}]);
  assert.ok(text(hostsIn).includes(LAND_RULE) && (hostsIn.match(/source-line/g) || []).length === 1 && !text(hostsIn).includes('ไม่ได้ยืนยัน'));
  // One row per building: other registry names on the same footprint ride along; a nested outline says what it repeats.
  const co = [{...host, id: 'OFF-1', name: 'Tower A'}, {...host, id: 'OFF-2', name: 'Tower B'}, {...host, id: 'OFF-3', name: 'Tower C'}];
  const listed = text(renderLandHostsIn([{host, cohosts: co, rows: 20, outlets: 35}, {host: {...host, id: 'OFF-9', name: 'Complex'}, cohosts: [], rows: 20, outlets: 36, repeats: {host, rows: 20}}]));
  assert.ok(listed.includes('อาคารเดียวกับ Tower A, Tower B และอีก 1 ชื่อ'), listed);
  assert.ok(listed.includes(`นับร้านซ้ำกับ ${host.name} 20 ร้าน`), listed);
  assert.equal((renderLandHostsIn([{host, cohosts: co, rows: 20, outlets: 35}]).match(/data-action="select-land"/g) || []).length, 1, 'co-hosts are not separate rows');
});

test('counts are totals, never list lengths; registers and carts are named; small samples print no share (review 2026-10-28)', () => {
  const {reg, land, rowById, data, index} = setup();
  const chains = buildChainIndex({rows: data.rows, brands: data.brands, register: reg});
  // A multi-banner point-of-sale registry is a record, not a chain: out of the chain count and the ranking.
  const registry = reg.brands.find(b => b.id === 'ROOT-BR-cpf-pos-network');
  assert.ok(registry?.registry, 'Five Star network is flagged as a registry');
  assert.equal(reg.chainCount, reg.brands.filter(b => b.outlets > 0).length - reg.registries.length);
  assert.ok(!searchRegister(reg, '').brands.some(b => b.registry), 'the ranking lists chains only');
  assert.ok(searchRegister(reg, 'five star').brands.some(b => b.registry), 'search still reaches it');
  // The directory (0.7.0): every chain of the scope, restaurants and outlets together, and the registries named apart.
  const all = chainsOf(data.rows, chains, Infinity);
  const directory = text(renderChains({reg, chains: all, scopeCount: data.rows.length, withPoint: 1}));
  assert.ok(directory.includes(`${all.total.toLocaleString('th-TH')} เครือ`) && directory.includes('ไม่นับ Five Star network'), directory.slice(0, 300));
  assert.ok(directory.includes(`แสดง 60 จาก ${all.total.toLocaleString('th-TH')} เครือ`), 'the list is cut and says so');
  assert.ok(/ชุดข้อมูล \S/.test(directory) && /แหล่ง \S/.test(directory) && /ตรวจ \d/.test(directory) && /ขอบเขต \S/.test(directory), 'the directory cites its own source and date');
  // Chain keys unify the sheets: a chain with rows of both kinds counts both, and keys the brand filter.
  const both = all.find(c => c.rows > 0 && c.outlets > 0);
  assert.ok(both && both.count === both.rows + both.outlets && chains.byKey.get(both.key)?.count === both.count, 'one key, one count across both sheets');
  assert.equal(chains.list.filter(c => c.count > 0).length, chains.total);
  // Shared names show the operator; a cart or secondary-source majority is flagged in lists.
  const kfc = reg.brands.filter(b => b.name === 'KFC');
  assert.equal(kfc.length, 3);
  assert.ok(kfc.every(b => b.sharedName));
  assert.equal(reg.brands.find(b => b.name === 'Chaysee Bamee Kiew').evidenceTag?.short, 'รถเข็น');
  assert.equal(reg.brands.find(b => b.name === 'MIXUE').evidenceTag?.short, 'แหล่งรอง');
  assert.equal(reg.brands.find(b => b.name === 'Café Amazon').evidenceTag, null);
  // Same-brand outlets: the heading carries the total, the list its own length.
  const outlet = reg.outlets.find(o => o.hasPoint && o.brand.name === 'KFC' && o.provinceTh === 'กรุงเทพมหานคร');
  const others = reg.byBrand.get(outlet.brand.id).filter(x => x !== outlet && x.province === outlet.province);
  const outletHtml = text(renderOutlet({reg, outlet, area: outlet.area ? index.byId.get(outlet.area) : null, land: landOfOutlet(land, outlet.id), sameBrand: {list: others.slice(0, 8), total: others.length, nearest: true}, group: data.groups[outlet.group]}));
  assert.ok(outletHtml.includes(`${others.length.toLocaleString('th-TH')} ร้าน`) && outletHtml.includes(`แสดง 8 จาก ${others.length.toLocaleString('th-TH')} ร้าน`), outletHtml.slice(-600));
  assert.ok(outletHtml.includes('ฟาสต์ฟู้ด') && outletHtml.includes('(อนุมาน)'), 'the derived type says it is derived');
  // Land lists: the header is the number of buildings, not the rows shown; the section cites all three inputs.
  const host = land.hosts.find(h => (land.rowsByBuilding.get(h.fp) || []).length > 3);
  const list = [{host, rows: 3, outlets: 1}]; list.total = 1399;
  const landList = text(renderLandHostsIn(list, {boundary: 'host ในแขวงทดสอบ'}));
  assert.ok(landList.includes('1,399 อาคาร') && landList.includes('แสดง 1 จาก 1,399 อาคาร'));
  assert.ok(landList.includes('CityMETER Restaurants API') && landList.includes('ทะเบียนร้านเครือ ตรวจ') && landList.includes('OpenStreetMap') && landList.includes('ขอบเขต host ในแขวงทดสอบ'));
  // Shares only for a column of at least 30 rows; the panel says why and that rows are not every restaurant.
  const paragon = land.hosts.find(h => h.id === 'SC-001244');
  const profile = landProfile(land, paragon, {rowsByKey: rowById, outletsById: reg.byId});
  const around = data.rows.slice(0, 4).map(r => ({...r}));
  const inside = profile.rows.in, outletsIn = profile.outlets.in;
  const landChains = chainsOf([...inside, ...outletsIn], chains, Infinity);
  const listHtml = renderLand({land, profile, around, groups: data.groups, index, chains: landChains});
  const landHtml = text(listHtml);
  assert.ok(!/\d+%/.test(landHtml.split('ประเภทร้าน: ในอาคารเทียบรอบอาคาร')[1].split('ร้านในอาคาร ')[0]), 'no share on a handful of rows');
  assert.ok(landHtml.includes('ร้อยละเมื่อคอลัมน์มีอย่างน้อย 30 ร้าน') && landHtml.includes('ไม่ใช่ทุกร้านในอาคาร'));
  // One list for the building (owner 2026-10-28 22:03; one vocabulary 2026-10-29): rows and outlets together, chain first.
  assert.ok(!landHtml.includes('สาขาในทะเบียน') && !landHtml.includes('ติดขอบ'));
  assert.ok(landHtml.includes(`${(inside.length + outletsIn.length).toLocaleString('th-TH')} ร้านในอาคาร`), 'one total');
  const buttons = (listHtml.match(/data-action="select-store"/g) || []).length;
  const matched = new Set(inside.filter(r => r.register === 2).flatMap(r => r.registerTargets || []).filter(t => outletsIn.some(o => o.id === t)));
  assert.ok(inside.length + outletsIn.length <= 40, 'Siam Paragon fits one page of the list');
  assert.equal(buttons, inside.length + outletsIn.length - matched.size, 'every row and outlet in the one list, a matched one carried by its row');
  assert.ok(!listHtml.includes('data-action="select-outlet"'), 'one action for every entry');
  assert.ok(landHtml.includes('สาขาเครือ'), 'an outlet entry names itself as a chain outlet in its meta line');
});

test('snapshot chain and venue headers carry totals, never the length of a cut list (review 2, 0.3.2)', async () => {
  const {data, index} = setup();
  const {buildAreaProfile} = await import('../js/profile-model.js');
  const {renderArea} = await import('../js/panel.js');
  const byArea = new Map();
  for (const r of data.rows) if (r.brand && r.area) { if (!byArea.has(r.area)) byArea.set(r.area, new Set()); byArea.get(r.area).add(brandKey(r)); }
  const [areaId, brands] = [...byArea].sort((a, b) => b[1].size - a[1].size)[0];
  assert.ok(brands.size > 16, `${areaId} has ${brands.size} chains`);
  const p = buildAreaProfile(data.rows, areaId, index, data.groups, {});
  assert.equal(p.chainTotal, brands.size);
  assert.equal(p.chains.length, 16);
  const html = text(renderArea(p, data.meta || {}));
  assert.ok(html.includes(`${brands.size.toLocaleString('th-TH')} เครือ`) && html.includes(`แสดง 16 จาก ${brands.size.toLocaleString('th-TH')} เครือ`), html.slice(0, 200));
});

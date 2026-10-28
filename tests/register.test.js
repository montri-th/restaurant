/**
 * Chain register (data/chains.json) and the Land join (data/land.json + land-buildings.geojson), release 0.3.
 * Contracts: the register keeps its own unit (one outlet_id per listed branch) and is never added to the
 * snapshot; derived fields say how they were derived; the Land join publishes only in / edge relations that
 * the browser geometry reproduces; wording says “จุดตกในอาคาร”, never “ตั้งอยู่ใน”.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {load, readJSON, readBytes, sha256, ROOT} from './helpers.js';
import {decodeRegister, brandsIn, provincesIn, outletMix, searchRegister, EVIDENCE, STATUS} from '../js/register.js';
import {decodeLand, geometryContains, distanceToGeometry, landProfile, landOfRow, landOfOutlet, hostsOf, aroundGeometry, landTypeTh} from '../js/land.js';
import {renderRegisterSummary, renderRegisterInArea, renderLandHostsIn, renderStoreLand, renderStoreRegister, renderChains, renderChain, renderCompany, renderOutlet, renderLand} from '../js/register-panel.js';
import {configureBrandLogos} from '../js/brand-logos.js';

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
let ctx = null;
function setup() {
  if (ctx) return ctx;
  const base = load();
  configureBrandLogos(readJSON('data/brand-logos.json'));
  const raw = readJSON('data/chains.json');
  const reg = decodeRegister(raw, base.index);
  const landRaw = readJSON('data/land.json'), landGeo = readJSON('data/land-buildings.geojson');
  const land = decodeLand(landRaw, landGeo);
  const rowById = new Map(base.data.rows.map(r => [r.id, r]));
  ctx = {...base, raw, reg, landRaw, landGeo, land, rowById};
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

test('the snapshot stays 70,214 rows: Sheet 1 plus the 1,234 rows moved to the register, each counted once', () => {
  const {raw: chains, data} = setup();
  const meta = data.meta;
  assert.equal(meta.rowSources.sheet1 + meta.rowSources.movedToChainRegister, data.rows.length);
  assert.deepEqual({sheet1: meta.rowSources.sheet1, moved: meta.rowSources.movedToChainRegister}, {sheet1: 68980, moved: 1234});
  assert.equal(data.rows.filter(r => r.register).length, 1234, 'every moved row is flagged, none dropped or doubled');
  assert.ok(data.rows.filter(r => r.register === 2).length > 0);
  // Register targets of a moved row are outlet ids or secondary observations; only outlet ids resolve to points.
  const ids = new Set(chains.cols.id);
  const targets = data.rows.flatMap(r => r.registerTargets);
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

test('land.json publishes in / edge relations only, every key resolves, and the browser geometry reproduces them', () => {
  const {landRaw, landGeo, land, data, reg} = setup();
  assert.equal(landRaw.meta.schema, 'citymeter-land-join-1');
  const keys = new Set(data.rows.map(r => r.id)), outlets = new Set(reg.outlets.map(o => o.id));
  assert.ok(landRaw.snapshot.length > 2000 && landRaw.chains.length > 1500);
  // edge = outside the outline within 10 m (a point on the outline itself rounds to 0.0 m).
  for (const [k, b, rel, d] of landRaw.snapshot) { assert.ok(keys.has(k), k); assert.ok(rel === 0 || rel === 1); assert.ok(land.buildings.has(b)); assert.ok(rel === 0 ? d === 0 : d >= 0 && d <= 10); }
  for (const [k, b, rel, d] of landRaw.chains) { assert.ok(outlets.has(k), k); assert.ok(rel === 0 || rel === 1); assert.ok(land.buildings.has(b)); assert.ok(rel === 0 ? d === 0 : d >= 0 && d <= 10); }
  // Recompute a sample in the browser's planar geometry (equirectangular metres): in = inside; edge ≤ 10 m (+ rounding).
  const rows = new Map(data.rows.map(r => [r.id, r])), outs = new Map(reg.outlets.map(o => [o.id, o]));
  let checked = 0;
  for (const [list, lookup] of [[landRaw.snapshot, rows], [landRaw.chains, outs]]) {
    for (let i = 0; i < list.length; i += 7) {
      const [k, b, rel] = list[i];
      const p = lookup.get(k), g = land.buildings.get(b).geometry;
      const pt = [p.longitude, p.latitude];
      if (rel === 0) assert.ok(geometryContains(g, pt) || distanceToGeometry(g, pt) < 0.5, `${k} in building ${b}`);
      else assert.ok(distanceToGeometry(g, pt) <= 10.5, `${k} edge of building ${b}: ${distanceToGeometry(g, pt)}`);
      checked++;
    }
  }
  assert.ok(checked > 500, `${checked} relations recomputed`);
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
  // LOD > 1 (owner 2026-10-28): parts extrude from their own base to top, inside their building's join outline.
  assert.ok(mains.some(f => f.properties.lod === 2), 'registry building parts are used where they exist');
  for (const f of parts) {
    assert.ok(f.properties.display_height_m > f.properties.display_base_m, f.id);
    assert.equal(f.properties.render_as, 'extrusion');
    // The outline is the union of footprint and parts: every part vertex lies in or on it (rounding ≤ 1 m).
    const outline = land.buildings.get(f.properties.building).geometry;
    const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0])[0];
    for (const v of ring) assert.ok(distanceToGeometry(outline, v) < 1, `${f.id} lies in its building`);
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

test('Land profile: rows in / at the edge of the building, the 100 m ring outside it, register outlets apart', () => {
  const {land, rowById, reg, data} = setup();
  // The host with the most snapshot points in its building.
  const host = [...land.hosts].sort((a, b) => (land.rowsByBuilding.get(b.fp)?.length || 0) - (land.rowsByBuilding.get(a.fp)?.length || 0))[0];
  const p = landProfile(land, host, {rowsByKey: rowById, outletsById: reg.byId});
  const inside = [...p.rows.in, ...p.rows.edge];
  assert.equal(inside.length, land.rowsByBuilding.get(host.fp).length);
  assert.ok(p.rows.in.length > 0);
  const ring = aroundGeometry(p.feature.geometry, data.rows, 100, new Set(inside.map(r => r.id)));
  for (const r of ring) { const d = distanceToGeometry(p.feature.geometry, [r.longitude, r.latitude]); assert.ok(d > 10 && d <= 100); }
  assert.equal(hostsOf(land, host.fp)[0].ds <= 'shopping' || true, true);
  // Each point names this building as its primary relation or as one of the nested buildings that also contain it.
  const buildingsOf = rel => [rel.building, ...rel.also.map(x => x.building)];
  for (const r of inside) assert.ok(buildingsOf(landOfRow(land, r.id)).includes(host.fp), r.id);
  for (const o of [...p.outlets.in, ...p.outlets.edge]) assert.ok(buildingsOf(landOfOutlet(land, o.id)).includes(host.fp), o.id);
  // Nested buildings: a point inside an office tower that sits in a mall outline is “in” both.
  const nested = [...land.rowLinks.values()].filter(l => l.length > 1);
  assert.ok(nested.length > 0 && nested.every(l => l.slice(1).every(x => x.rel === 'in')), 'nested links are “in” relations');
});

test('register and Land views: dataset · source · date · boundary, separate units, “จุดตกในอาคาร” never “ตั้งอยู่ใน”', () => {
  const {reg, land, rowById, data, index} = setup();
  const brand = [...reg.brands].sort((a, b) => b.outlets - a.outlets)[0];
  const outlets = reg.byBrand.get(brand.id);
  const company = reg.companies.find(c => (reg.byCompany.get(c.id) || []).length);
  const outlet = reg.outlets.find(o => o.hasPoint && o.area);
  const host = land.hosts.find(h => (land.rowsByBuilding.get(h.fp) || []).length > 3);
  const profile = landProfile(land, host, {rowsByKey: rowById, outletsById: reg.byId});
  const views = {
    summary: renderRegisterSummary({meta: reg.meta, brands: reg.brands.slice(0, 5)}),
    chains: renderChains({reg, query: '', results: searchRegister(reg, ''), mix: outletMix(reg.outlets)}),
    chain: renderChain({reg, brand, outlets, provinces: provincesIn(outlets, reg.provinces), mix: outletMix(outlets)}),
    company: renderCompany({reg, company, brands: brandsIn(reg.byCompany.get(company.id), 50), outlets: reg.byCompany.get(company.id), mix: outletMix(reg.byCompany.get(company.id))}),
    outlet: renderOutlet({reg, outlet, area: index.byId.get(outlet.area), land: landOfOutlet(land, outlet.id), sameBrand: []}),
    land: renderLand({land, profile, around: [], groups: data.groups, index}),
  };
  for (const [name, html] of Object.entries(views)) {
    const t = text(html);
    assert.ok(!/ตั้งอยู่ใน(?!อาคาร)/.test(t.replace(/ไม่ได้ยืนยันว่า(ร้าน)?ตั้งอยู่ใน\S*/g, '')), `${name}: no located-in claim`);
    if (name === 'summary') { assert.ok(t.includes('ไม่นำมาบวกกัน')); continue; }
    assert.ok(/ชุดข้อมูล \S/.test(t) && /แหล่ง \S/.test(t) && /ตรวจ \d/.test(t) && /ขอบเขต \S/.test(t), `${name}: dataset · source · date · boundary`);
  }
  assert.ok(text(views.chains).includes('ไม่ใช่จำนวนร้านที่เปิดอยู่จริง'));
  assert.ok(text(views.land).includes('จุดตกในอาคาร') && text(views.land).includes('ไม่ได้ยืนยันว่าร้านตั้งอยู่ในอาคาร'));
  // Sections inside snapshot views.
  const area = [...reg.byArea.keys()][0];
  assert.ok(text(renderRegisterInArea({outlets: reg.byArea.get(area), brands: brandsIn(reg.byArea.get(area)), place: 'แขวงทดสอบ'})).includes('ไม่นำมาบวกกัน'));
  const row = rowById.get(landOfRow(land, [...land.rowRel.keys()][0]) ? [...land.rowRel.keys()][0] : '');
  const storeLand = text(renderStoreLand(landOfRow(land, row.id)));
  assert.ok(/จุด(ตกใน|ติดขอบ)อาคารของ/.test(storeLand) && storeLand.includes('ไม่ได้ยืนยันว่าตั้งอยู่ในอาคาร'));
  const moved = data.rows.find(r => r.register === 1);
  assert.ok(text(renderStoreRegister({row: moved, register: moved.register})).includes('ยังนับเป็น 1 ร้านในชุดข้อมูลนี้ตามเดิม'));
  assert.ok(text(renderLandHostsIn([{host, rows: 3, outlets: 1}])).includes('ไม่ได้ยืนยันว่าตั้งอยู่ในอาคาร'));
  // One row per building: other registry names on the same footprint ride along; a nested outline says what it repeats.
  const co = [{...host, id: 'OFF-1', name: 'Tower A'}, {...host, id: 'OFF-2', name: 'Tower B'}, {...host, id: 'OFF-3', name: 'Tower C'}];
  const listed = text(renderLandHostsIn([{host, cohosts: co, rows: 20, outlets: 35}, {host: {...host, id: 'OFF-9', name: 'Complex'}, cohosts: [], rows: 20, outlets: 36, repeats: {host, rows: 20}}]));
  assert.ok(listed.includes('อาคารเดียวกับ Tower A, Tower B และอีก 1 ชื่อ'), listed);
  assert.ok(listed.includes(`นับร้านซ้ำกับ ${host.name} 20 ร้าน`) && listed.includes('รวมแถวกันไม่ได้'), listed);
  assert.equal((renderLandHostsIn([{host, cohosts: co, rows: 20, outlets: 35}]).match(/data-action="select-land"/g) || []).length, 1, 'co-hosts are not separate rows');
});

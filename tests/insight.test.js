import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './helpers.js';
import {summarizeAreaInsight, filterAreaRows, MIN_AREA_ROWS, SMALL_SELECTION} from '../js/area-insight.js';
import {summarizeAreas, combinedDensity, levelWords, byDensity} from '../js/areas.js';
import {filterRows, summarize} from '../js/model.js';
import {buildAreaModel} from '../js/map-layers.js';
import {buildProvinceModel} from '../js/provinces.js';

test('first Aha (one-population fixture): the three densest แขวง with ≥ 30 rows, combined as Σrows ÷ Σkm²', () => {
  const {data, index, coverage} = load();
  const i = summarizeAreaInsight(data.rows, index, {coverage});
  assert.equal(i.mode, 'density');
  assert.equal(i.minRows, MIN_AREA_ROWS);
  // 0.7.1 (register of 2026-10-29/30, 22,182 outlets with a point): ตลาดยอด · สีลม · สุริยวงศ์ — ตลาดยอด (0.186 km²)
  // reaches the 30-row floor with 9 located outlets (0.6.0–0.7.0: สุริยวงศ์ · สีลม · วังใหม่ at 122.0; 0.4: สี่แยกมหานาค ·
  // ตลาดน้อย · สุริยวงศ์ at 99.7 from the sheet-1 rows alone). Numbers come from a run, never by hand.
  assert.deepEqual(i.areaIds, ['100108', '100402', '100403'], 'ตลาดยอด · สีลม · สุริยวงศ์');
  assert.deepEqual(i.areas.map(a => a.count), [32, 250, 98]);
  assert.equal(i.count, 380);
  const km2 = i.areas.reduce((s, a) => s + a.km2, 0);
  assert.ok(Math.abs(i.density - 380 / km2) < 1e-9, 'combined density is a ratio of totals, not a mean of ratios');
  assert.ok(Math.abs(i.density - 164.6) < 0.05, `${i.density}`);
  // The baseline counts the rows that sit in a covered frame (outlets outside the covered provinces have no frame).
  assert.equal(i.framedRows, data.rows.filter(r => r.area).length);
  assert.ok(Math.abs(i.baselineDensity - i.framedRows / coverage.km2) < 1e-9);
  assert.ok(Math.abs(i.baselineDensity - 9.83) < 0.01, `${i.baselineDensity}`);
  assert.ok(i.areas.every(a => a.count >= MIN_AREA_ROWS));
  // Every eligible area outside the three is less dense than the third.
  const all = summarizeAreas(data.rows, index).filter(a => a.count >= MIN_AREA_ROWS).sort(byDensity);
  assert.deepEqual(all.slice(0, 3).map(a => a.id), i.areaIds);
  assert.equal(i.mostReviewed.id, '103902', 'secondary finding: แขวงคลองตันเหนือ holds the most reviews');
});

test('small selections switch to a count Aha (share of the selection in three areas)', () => {
  const {data, index, coverage} = load();
  // The brand filter reaches both sheets (KFC: rows named KFC + the register's KFC outlets = 1,274), so a smaller chain.
  const kfc = filterRows(data.rows, {brand: 'RBR-kfc'});
  assert.ok(kfc.length >= SMALL_SELECTION && kfc.some(r => r.kind === 'outlet') && kfc.some(r => r.kind !== 'outlet'), 'KFC spans both sheets');
  const small = filterRows(data.rows, {brand: 'RBR-mk'});
  assert.ok(small.length > 0 && small.length < SMALL_SELECTION);
  const i = summarizeAreaInsight(small, index, {coverage});
  assert.equal(i.mode, 'count');
  assert.equal(i.areas.length, 3);
  assert.ok(Math.abs(i.share - (i.count / small.length) * 100) < 1e-9);
  assert.equal(filterAreaRows(small, new Set(i.areaIds)).length, i.count);
  assert.equal(summarizeAreaInsight([], index).areas.length, 0);
});

test('summaries keep missing apart from zero: ratings average only rated rows; reviews sum only rows that state them', () => {
  const rows = [
    {id: 'a', area: '100204', rating: 4, reviews: 10, price: 'UNSPECIFIED', brand: null, venue: null},
    {id: 'b', area: '100204', rating: null, reviews: null, price: 'R100_300', brand: null, venue: null},
  ];
  const s = summarize(rows);
  assert.equal(s.count, 2);
  assert.equal(s.rated, 1);
  assert.equal(s.ratingMean, 4);
  assert.equal(s.reviews, 10);
  assert.equal(s.reviewed, 1);
  assert.equal(s.priced, 1);
  assert.equal(summarize([]).ratingMean, null, 'no rating is null, never 0');
  assert.deepEqual(combinedDensity([{count: 10, km2: 1}, {count: 0, km2: 4}]), {count: 10, km2: 5, density: 2});
});

test('area model: EVID-05 states — covered frames are measured or measured_zero, uncovered frames are no_data', () => {
  const {data, index, covered} = load();
  const all = buildAreaModel(data.rows, index, {allAreaIds: covered});
  assert.equal(all.areas.length, 581);
  assert.equal(all.noDataCount, 106, 'one population: outlets with a point cover frames the sheet-1 rows did not');
  assert.equal(all.zeroCount, 0);
  assert.ok(all.areas.filter(a => a.state === 'no_data').every(a => a.fill === null && !covered.has(a.id)));
  const thai = buildAreaModel(filterRows(data.rows, {group: 'thai'}), index, {allAreaIds: covered});
  assert.ok(thai.zeroCount > 0, 'covered frames without a Thai restaurant are measured zero, not no-data');
  assert.ok(thai.areas.filter(a => a.state === 'measured_zero').every(a => covered.has(a.id) && a.count === 0));
  const bkk = buildAreaModel(data.rows, index, {allAreaIds: covered, province: 'BKK'});
  assert.equal(bkk.areas.length, 180, 'Bangkok has 180 แขวง frames');
  assert.ok(bkk.areas.every(a => a.state !== 'no_data'), 'every แขวง of Bangkok holds rows');
});

test('province frames count rows per province (a total, not a density)', () => {
  const {data, provincesGeo, raw, register} = load();
  const m = buildProvinceModel(data.rows, provincesGeo);
  assert.equal(m.provinces.length, 77, 'every province (0.6.0)');
  // Each frame counts sheet-1 restaurants (minus the moved rows) plus the register's outlets of that province.
  const movedBy = {}; for (const r of data.moved) movedBy[r.province] = (movedBy[r.province] || 0) + 1;
  const outletsBy = {}; for (const o of register.outlets) if (o.province) outletsBy[o.province] = (outletsBy[o.province] || 0) + 1;
  for (const p of m.provinces) assert.equal(p.count, (raw.meta.rowsByProvince[p.code] || 0) - (movedBy[p.code] || 0) + (outletsBy[p.code] || 0), p.code);
  assert.equal(m.unknown, register.outlets.filter(o => !o.province).length, 'outlets without a province are counted apart');
  assert.equal(m.unknown, 2213);
  assert.ok(m.provinces.every(p => p.count > 0), 'every province holds at least one restaurant or outlet');
  assert.equal(m.classes.scaleId, 'count');
  const none = buildProvinceModel([], provincesGeo);
  assert.ok(none.provinces.every(p => p.state === 'measured_zero'));
});

test('level words follow the province: เขต/แขวง in Bangkok, อำเภอ/ตำบล elsewhere', () => {
  assert.deepEqual(levelWords('BKK'), {district: 'เขต', area: 'แขวง'});
  assert.deepEqual(levelWords('NBI'), {district: 'อำเภอ', area: 'ตำบล'});
});

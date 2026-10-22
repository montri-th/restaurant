import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './helpers.js';
import {summarizeAreaInsight, filterAreaRows, MIN_AREA_ROWS, SMALL_SELECTION} from '../js/area-insight.js';
import {summarizeAreas, combinedDensity, levelWords, byDensity} from '../js/areas.js';
import {filterRows, summarize} from '../js/model.js';
import {buildAreaModel} from '../js/map-layers.js';
import {buildProvinceModel} from '../js/provinces.js';

test('first Aha (snapshot fixture): the three densest แขวง with ≥ 30 rows, combined as Σrows ÷ Σkm²', () => {
  const {data, index, coverage} = load();
  const i = summarizeAreaInsight(data.rows, index, {coverage});
  assert.equal(i.mode, 'density');
  assert.equal(i.minRows, MIN_AREA_ROWS);
  assert.deepEqual(i.areaIds, ['100204', '101303', '100403'], 'สี่แยกมหานาค · ตลาดน้อย · สุริยวงศ์');
  assert.deepEqual(i.areas.map(a => a.count), [40, 39, 57]);
  assert.equal(i.count, 136);
  const km2 = i.areas.reduce((s, a) => s + a.km2, 0);
  assert.ok(Math.abs(i.density - 136 / km2) < 1e-9, 'combined density is a ratio of totals, not a mean of ratios');
  assert.ok(Math.abs(i.density - 99.7) < 0.05, `${i.density}`);
  assert.ok(Math.abs(i.baselineDensity - 70214 / coverage.km2) < 1e-9);
  assert.ok(i.areas.every(a => a.count >= MIN_AREA_ROWS));
  // Every eligible area outside the three is less dense than the third.
  const all = summarizeAreas(data.rows, index).filter(a => a.count >= MIN_AREA_ROWS).sort(byDensity);
  assert.deepEqual(all.slice(0, 3).map(a => a.id), i.areaIds);
  assert.equal(i.mostReviewed.id, '103902', 'secondary finding: แขวงคลองตันเหนือ holds the most reviews');
});

test('small selections switch to a count Aha (share of the selection in three areas)', () => {
  const {data, index, coverage} = load();
  const kfc = filterRows(data.rows, {brand: 'RBR-kfc'});
  assert.ok(kfc.length > 0 && kfc.length < SMALL_SELECTION);
  const i = summarizeAreaInsight(kfc, index, {coverage});
  assert.equal(i.mode, 'count');
  assert.equal(i.areas.length, 3);
  assert.ok(Math.abs(i.share - (i.count / kfc.length) * 100) < 1e-9);
  assert.equal(filterAreaRows(kfc, new Set(i.areaIds)).length, i.count);
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
  assert.equal(all.noDataCount, 273);
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
  const {data, provincesGeo, raw} = load();
  const m = buildProvinceModel(data.rows, provincesGeo);
  assert.equal(m.provinces.length, 7);
  for (const p of m.provinces) assert.equal(p.count, raw.meta.rowsByProvince[p.code]);
  assert.equal(m.classes.scaleId, 'count');
  const none = buildProvinceModel([], provincesGeo);
  assert.ok(none.provinces.every(p => p.state === 'measured_zero'));
});

test('level words follow the province: เขต/แขวง in Bangkok, อำเภอ/ตำบล elsewhere', () => {
  assert.deepEqual(levelWords('BKK'), {district: 'เขต', area: 'แขวง'});
  assert.deepEqual(levelWords('NBI'), {district: 'อำเภอ', area: 'ตำบล'});
});

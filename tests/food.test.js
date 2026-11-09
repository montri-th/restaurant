/**
 * The food taxonomy on the page (0.9.2, owner 2026-11-03 16:59 “เปิดให้ทุกคนเห็นตอนนี้”): the register's 6 categories ·
 * 19 groups · 31 sub-groups as a filter, overview chips, area/district/venue/building bars and a store/outlet fact —
 * every value an unreviewed inference of the workbook, so every place that shows one says อนุมาน.
 * Fixtures come from a run on the shipped data (register of 2026-11-03, classification read 2026-11-03); refresh them
 * from a run when either sheet changes, never by hand.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {load, readJSON, ROOT, fixture} from './helpers.js';
import {FOOD, foodMatch, foodLabel, foodMix, filterRows, summarize} from '../js/model.js';
import {buildOverview, buildAreaProfile, buildDistrictProfile, buildStoreDetail, buildVenueProfile} from '../js/profile-model.js';
import {renderOverview, renderArea, renderDistrict, renderStore, renderVenue, renderFilterChips, foodSection, foodFact} from '../js/panel.js';
import {renderOutlet} from '../js/register-panel.js';
import {summarizeAreaInsight} from '../js/area-insight.js';
import {configureBrandLogos} from '../js/brand-logos.js';
import {configureVenueLogos} from '../js/venue-logos.js';
import {FOOD_CATEGORY_PICTOGRAM} from '../js/navigation.js';

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const CAVEATS = /ไม่ใช่ยอดขาย|ไม่ได้ยืนยัน|ยังไม่ยืนยัน|ไม่ได้แปลว่า|ตามแหล่ง|อยู่ในตัวเลข|ไม่ใช่ร้านทั้งหมด|รอตรวจ|ยังไม่ผ่าน/;

test('the codebook: 6 categories · 19 groups · 31 sub-groups; every classified row has a consistent parent chain', () => {
  const {data} = load();
  assert.equal(FOOD.categories.length, 6);
  assert.equal(FOOD.groups.length, 19);
  assert.equal(FOOD.subgroups.length, 31);
  assert.deepEqual(FOOD.subgroups.filter(x => x.fallback).map(x => foodLabel(x.id)), ['ก๋วยเตี๋ยว/เส้น · ไม่ระบุชนิด', 'ส้มตำ/ยำ/อีสาน · ไม่ระบุชนิด', 'ญี่ปุ่น · อื่น ๆ'],
    'a fallback sub-group reads with its group');
  for (const r of data.rows) {
    if (!r.food) { assert.equal(r.foodCat, undefined); assert.equal(r.foodSub, undefined); continue; }
    assert.equal(FOOD.byId.get(r.food).category, r.foodCat);
    if (r.foodSub) assert.equal(FOOD.byId.get(r.foodSub).group, r.food);
  }
  const mix = foodMix(data.rows);
  fixture('food.mix', {classified: mix.classified, unclassified: mix.unclassified, rows: data.restaurants.filter(r => r.food).length, outlets: data.outlets.filter(r => r.food).length});
  assert.equal(mix.classified + mix.unclassified, data.rows.length, 'classified and unclassified make the population');
  fixture('food.categories', Object.fromEntries(mix.cats));
  assert.equal([...mix.cats.values()].reduce((a, b) => a + b, 0), mix.classified, 'categories add up to the classified rows');
  assert.equal([...mix.groups.values()].reduce((a, b) => a + b, 0), mix.classified, 'so do groups');
  // The filter reaches every level by id; an unclassified row never matches a category.
  assert.equal(filterRows(data.rows, {food: 'FC03'}).length, mix.cats.get('FC03'));
  fixture('food.filtered', ['FC03', 'FG01', 'FSG01'].map(id => filterRows(data.rows, {food: id}).length));
  assert.equal(foodMatch({}, 'FC01'), false);
  assert.equal(foodMatch({}, ''), true);
  assert.deepEqual(Object.keys(FOOD_CATEGORY_PICTOGRAM).sort(), FOOD.categories.map(c => c.id).sort(), 'one approved glyph per category');
});

test('area panel: categories, groups and menus as bars that filter, labelled อนุมาน; unclassified said apart (สีลม)', () => {
  const {data, index} = load();
  const p = buildAreaProfile(data.rows, '100402', index, data.groups);
  const silom = fixture('food.silom', {count: p.count, classified: p.byFood.classified, unclassified: p.byFood.unclassified});
  const html = renderArea(p, {...data.meta, segmentsOn: '2026-11-02'});
  const t = text(html);
  assert.ok(html.includes('class="panel-section food-section"') && t.includes('หมวดอาหาร อนุมาน'), 'the section says อนุมาน once, beside its heading');
  assert.ok(/data-action="filter-field" data-id="food" data-value="FC03"[^>]*>.*เครื่องดื่ม\/ของหวาน/.test(html), 'category bars filter');
  const coffee = fixture('food.silom.coffee', p.byFood.groups.get('FG05') ?? null);
  assert.ok(/data-id="food" data-value="FG05"/.test(html) && t.includes(`กาแฟ/คาเฟ่ ${coffee}`), 'the top group with its count');
  assert.ok(t.includes(`ไม่จัดหมวด ${silom.unclassified} ร้าน`), 'rows without a class are counted apart, never a zero of a category');
  assert.ok(!/data-value="FSG28"/.test(html), 'a fallback sub-group is no menu chip');
  assert.ok(!CAVEATS.test(t), t.match(CAVEATS)?.[0]);
  // The section sits right after the type bars, in the district panel as well.
  const d = renderDistrict(buildDistrictProfile(data.rows, '1004', index, data.groups), () => '#000', data.meta);
  assert.ok(d.indexOf('food-section') > d.indexOf('ประเภทร้าน') && d.indexOf('food-section') < d.indexOf('ระดับราคา'));
  // A scope with nothing classified says so; nothing at all renders nothing.
  assert.equal(foodSection(foodMix([])), '');
  assert.ok(text(foodSection(foodMix([{}, {}]))).includes('ไม่จัดหมวด 2 ร้าน'));
});

test('a store and an outlet carry หมวด › กลุ่ม › เมนู, each a filter, with อนุมาน', () => {
  const {data, index, register} = load();
  configureBrandLogos(readJSON('data/brand-logos.json'));
  configureVenueLogos(readJSON('data/venue-logos.json'));
  const r = data.rows.find(x => x.id === 'b33a98112001');
  assert.deepEqual([r.foodCat, r.food, r.foodSub], ['FC01', 'FG01', 'FSG01']);
  const st = renderStore(buildStoreDetail(r, {scopeRows: data.rows, index, groups: data.groups}), {...data.meta, index});
  assert.ok(text(st).includes('หมวดอาหาร ไทยจานเดียว › ก๋วยเตี๋ยว/เส้น › บะหมี่/เกี๊ยว อนุมาน'), text(st).slice(0, 400));
  for (const id of ['FC01', 'FG01', 'FSG01']) assert.ok(st.includes(`data-id="food" data-value="${id}"`));
  assert.ok(st.includes('pic-g-thai'), 'the category pictogram sits beside the label');
  const o = data.outlets.find(x => x.id === 'R2BO-09b901d4fe96bb1d75315eab');
  const ot = text(renderOutlet({reg: register, outlet: o, area: null, land: null, sameBrand: [], group: data.groups[o.group]}));
  assert.ok(ot.includes('หมวดอาหาร เครื่องดื่ม/ของหวาน › กาแฟ/คาเฟ่ อนุมาน'), ot.slice(0, 400));
  // No class → no fact (never “ไม่ทราบ” dressed as a category).
  assert.equal(foodFact(data.rows.find(x => !x.food)), '');
});

test('overview: six category chips with the scope’s counts; the active one is pressed; chips and filter chip say อนุมาน', () => {
  const {data, index, coverage} = load();
  const insight = summarizeAreaInsight(data.rows, index, {coverage});
  const args = {insight, summary: summarize(data.rows), overview: buildOverview(data.rows, index), focusMode: 'auto', classOf: () => '#000', meta: data.meta, coverage, byFood: foodMix(data.rows)};
  const html = renderOverview(args);
  const t = text(html);
  assert.ok(t.includes('ดูตามหมวดอาหาร อนุมาน') && t.includes('กลุ่มและเมนูทั้งหมด'), t.slice(0, 600));
  assert.equal((html.match(/class="brand-chip food-chip"/g) || []).length, 6);
  assert.ok(t.includes('ไทยจานเดียว 21,786') && t.includes('เครื่องดื่ม/ของหวาน 17,872'));
  assert.ok(html.includes('data-action="open-filters" data-id="food"'), 'the way to the groups and menus');
  const pressed = renderOverview({...args, food: 'FC03'});
  assert.ok(/data-value="FC03" aria-pressed="true"/.test(pressed) && (pressed.match(/aria-pressed="true"/g) || []).length === 1);
  assert.equal(renderOverview({...args, byFood: null}).includes('food-chip'), false, 'no segments, no chips');
  const chip = text(renderFilterChips({search: '', group: '', food: 'FG05', price: '', size: '', province: '', brand: '', venue: ''}, {group: {}, food: {FG05: foodLabel('FG05')}, price: {}, size: {}, province: {}, brand: {}, venue: {}}));
  assert.ok(chip.includes('กาแฟ/คาเฟ่ · อนุมาน'), chip);
});

test('a mall serves: the venue panel carries the food mix too', () => {
  const {data, index} = load();
  const v = data.venues.find(x => x.host && filterRows(data.rows, {}).some(r => r.venue?.id === x.id && r.food));
  const html = renderVenue(buildVenueProfile(data.rows, v, index, data.groups, {hosted: true}), index, data.meta);
  assert.ok(html.includes('food-section'), v.name);
});

test('the filter select exists beside the type select and is labelled อนุมาน', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(/<label><span class="label-line">หมวดอาหาร <small class="inferred">อนุมาน<\/small><\/span><select id="food"><option value="">ทุกหมวด<\/option><\/select><\/label>/.test(html), 'the word sits on the label line, not as a row of its own');
  assert.ok(html.indexOf('id="group"') < html.indexOf('id="food"') && html.indexOf('id="food"') < html.indexOf('id="price"'));
});

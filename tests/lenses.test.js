/**
 * First-Aha lenses and the place character line (0.9.0, owner 2026-11-03 “สลับดูได้ 3 มุม”, “ไม่แสดง caveats”).
 * Fixtures come from a run on the shipped data (register of 2026-11-03) and match the live page read on 3 Nov 2026
 * (80,629 framed rows, 7,605 of them 200+ chains); refresh them from a run when either sheet changes, never by hand.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {load, readJSON, fixture} from './helpers.js';
import {dens} from '../js/panel.js';
import {LENSES, DEFAULT_LENS, LENS_TEST, lensOf, lensFilters, lensesOffered, lensShare} from '../js/lenses.js';
import {summarizeAreaInsight, filterAreaRows} from '../js/area-insight.js';
import {buildOverview, buildAreaProfile, areaCharacter} from '../js/profile-model.js';
import {renderOverview, renderArea, characterLine} from '../js/panel.js';
import {summarize, filterRows} from '../js/model.js';
import {buildChainIndex, chainsOf} from '../js/chains.js';
import {configureBrandLogos} from '../js/brand-logos.js';

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const F = (o = {}) => ({search: '', group: '', food: '', price: '', size: '', province: '', brand: '', ...o});

test('a lens is exactly its preset: national chains by default, 1,000+ baht, density; anything else is no lens', () => {
  assert.deepEqual(LENSES.map(l => l.id), ['chains', 'premium', 'density']);
  assert.equal(DEFAULT_LENS, 'chains');
  assert.equal(lensOf(F()), 'density');
  assert.equal(lensOf(F({size: 'S5'})), 'chains');
  assert.equal(lensOf(F({price: 'P6'})), 'premium');
  assert.equal(lensOf(F({size: 'S5', group: '4'})), null, 'a type on top of a preset is the user’s own selection');
  assert.equal(lensOf(F({size: 'S5', food: 'FC03'})), null, 'so is a food category (0.9.2)');
  assert.equal(lensOf(F({size: 'S5', province: 'BKK'})), null, 'a province narrows the scope: no lens');
  assert.equal(lensOf(F({search: 'kfc'})), null);
  assert.equal(lensesOffered(F({brand: 'RBR-kfc'})), false);
  assert.deepEqual(lensFilters('chains'), {group: '', food: '', price: '', size: 'S5'}, 'a lens clears the food filter too');
  assert.deepEqual(lensFilters('density'), {group: '', food: '', price: '', size: ''});
  assert.equal(lensFilters('nope'), null);
});

test('national chains lens: the share of 200+ chains in the three densest areas of them, against everywhere (fixture: วังใหม่ · ถนนพญาไท · ปทุมวัน)', () => {
  const {data, index, coverage} = load();
  configureBrandLogos(readJSON('data/brand-logos.json'));
  const scope = filterRows(data.rows, {size: 'S5'});
  const insight = summarizeAreaInsight(scope, index, {coverage});
  assert.equal(insight.mode, 'density');
  fixture('lens.chains.areas', insight.areas.map(a => a.name).sort());
  const s = lensShare(data.rows, insight.areaIds, LENS_TEST.chains);
  // 2026-11-10: 199 of 724 (27.5 %; Yoguruto's 353 outlets reach 200+), everywhere 9.7 %; 2026-11-09: 187 of 712 (26.3 %); 0.8.0: 187 of 695 (26.9 %).
  fixture('lens.chains.share', {count: s.count, total: s.total, baselineCount: s.baselineCount, baselineTotal: s.baselineTotal});
  assert.equal(s.share, s.count / s.total * 100);
  const share = s.share.toFixed(1), baseline = s.baseline.toFixed(1);
  const chains = buildChainIndex({rows: data.rows, brands: data.brands, register: load().register});
  const top = chainsOf(filterAreaRows(scope, new Set(insight.areaIds)), chains, 6);
  // Chains, not names: KFC's three operator networks stay apart (js/chains.js), so none of them reaches the top three.
  fixture('lens.chains.top', top.slice(0, 3).map(c => [c.chain?.name || c.brand?.name, c.count]));
  fixture('lens.chains.total', top.total, 'national chains in the three areas');
  const html = renderOverview({insight, summary: summarize(scope), overview: buildOverview(scope, index), focusMode: 'auto', classOf: () => '#000', meta: data.meta, coverage,
    lens: 'chains', lenses: true, lensStats: s, lensChains: top});
  const t = text(html);
  assert.ok(t.includes('ข้อค้นพบแรก · เครือระดับชาติ') && t.includes(`${share}% ของร้านใน 3 แขวงนี้ เป็นเครือ 200+ สาขา`), t.slice(0, 500));
  assert.ok(t.includes(`${s.count.toLocaleString('en-US')} จาก ${s.total.toLocaleString('en-US')} ร้าน · ทุกพื้นที่ ${baseline}%`));
  assert.equal((html.match(/class="lens-chip"/g) || []).length, 3);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.ok(/data-id="chains" aria-pressed="true"/.test(html));
  assert.ok(html.includes('data-action="open-filters"') && t.includes('ลองกับร้านแบบคุณ'));
  assert.ok(html.includes('class="aha-chains"') && html.includes(top[0].chain?.name || top[0].brand?.name), 'the chains there, by logo chip');
});

test('1,000+ baht lens: 24.3 % of them in คลองตันเหนือ · ลุมพินี · ทุ่งมหาเมฆ; the density lens keeps the first Aha', () => {
  const {data, index, coverage} = load();
  const scope = filterRows(data.rows, {price: 'P6'});
  assert.equal(scope.length, 886);
  const insight = summarizeAreaInsight(scope, index, {coverage});
  assert.equal(insight.mode, 'count');
  assert.deepEqual(insight.areas.map(a => [a.name, a.count]), [['คลองตันเหนือ', 107], ['ลุมพินี', 73], ['ทุ่งมหาเมฆ', 35]]);
  const t = text(renderOverview({insight, summary: summarize(scope), overview: buildOverview(scope, index), focusMode: 'auto', classOf: () => '#000', meta: data.meta, coverage, lens: 'premium', lenses: true}));
  assert.ok(t.includes('ข้อค้นพบแรก · ร้าน 1,000+ บาท') && t.includes('24.3% ของร้านราคาเริ่ม 1,000 บาทขึ้นไป อยู่ใน 3 แขวงนี้') && t.includes('215 จาก 886 ร้าน'), t.slice(0, 500));
  const all = summarizeAreaInsight(data.rows, index, {coverage});
  const td = text(renderOverview({insight: all, summary: summarize(data.rows), overview: buildOverview(data.rows, index), focusMode: 'auto', classOf: () => '#000', meta: data.meta, coverage, lens: 'density', lenses: true}));
  const d = fixture('firstAha.density', dens(all.density));
  assert.ok(td.includes('ข้อค้นพบแรก · แน่นที่สุด') && td.includes(`${d} ร้าน/ตร.กม. — แน่นที่สุดใน 3 แขวงนี้`) && td.includes(`ทุกพื้นที่ ${dens(all.baselineDensity)}`), td.slice(0, 500));
});

test('a place’s character in one line: top type group, the price stated most, 200+ chains beside everywhere — whatever the filters', () => {
  const {data, index} = load();
  const groups = data.groups;
  const baseline = lensShare(data.rows, [], LENS_TEST.chains).baseline;
  // สีลม (100402), from the whole population of the area.
  const rows = data.rows.filter(r => r.area === '100402');
  const c = areaCharacter(rows, groups, {chainBaseline: baseline});
  assert.equal(c.total, rows.length);
  assert.ok(c.group && !['other', 'unspecified'].includes(c.group.id));
  assert.ok(c.price && /^P[1-6]$/.test(c.price.tier));
  assert.equal(c.chains.count, rows.filter(r => r.size === 'S5').length);
  const line = text(characterLine(c));
  assert.ok(line.includes(`${c.group.th} ${Math.round(c.group.share)}%`) && line.includes(`ราคาที่ระบุบ่อยสุด`) && line.includes(`${c.price.count} จาก ${c.price.priced} ร้านที่ระบุราคา`) && line.includes(`ทุกพื้นที่ ${baseline.toFixed(1)}%`), line);
  // The area panel shows it under the tiles; a filtered profile keeps the place's own character.
  const profile = buildAreaProfile(filterRows(data.rows, {size: 'S5'}), '100402', index, groups);
  profile.character = c;
  assert.ok(renderArea(profile, data.meta).includes('class="character"'));
  // An outlet-only place has no priced row: no price token (missing stays missing), and no rows → no line.
  const outlets = data.outlets.filter(o => o.area === '100402');
  assert.equal(areaCharacter(outlets, groups).price, null);
  assert.equal(characterLine(areaCharacter([], groups)), '');
});

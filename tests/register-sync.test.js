/**
 * The register read of 2026-11-09 and the register sync: the source set's two dates on the page, a chain's page that
 * names its codes and lists a branch without coordinates (Yoguruto, True Digital Park EAST 2F), floors and zones as the
 * page says them, the snapshot candidates paired with register brands only on evidence, and chain sizes recounted
 * when the register moved past the classification tab.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {load, readJSON, release} from './helpers.js';
import {filterRows, summarize, entryParts, floorLabel, hasPoint} from '../js/model.js';
import {summarizeAreaInsight} from '../js/area-insight.js';
import {buildOverview} from '../js/profile-model.js';
import {renderOverview, renderBrandHead, overviewList, provenance} from '../js/panel.js';
import {renderOutlet, registerProvenance, setSourceDates} from '../js/register-panel.js';
import {buildChainIndex} from '../js/chains.js';
import {pointCollection} from '../js/pins.js';
import {registerDictionary, translate} from '../js/shell/i18n.js';
import RESTAURANT_EN from '../js/lang-en.js';

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const YOGURUTO = 'VNBR-ff68cbb4d4a0e734', TDP_EAST_2F = 'VNOUT-8f358b44eb262263b76f';

test('Yoguruto: its page names the brand code, lists the True Digital Park EAST floor 2 branch with its code, and draws no pin', () => {
  const {data, register, index, coverage} = load();
  const o = register.byId.get(TDP_EAST_2F);
  assert.ok(o, 'the outlet is in the register');
  assert.equal(o.brand.id, YOGURUTO);
  assert.deepEqual([o.name, o.floor, o.zone, o.hasPoint], ['Yoguruto — True Digital Park EAST 2F', '2F', 'EAST', false], 'as the register lists it, without a storefront point');
  // The brand filter reaches it; the page lists it although no coordinate puts it on the map.
  const rows = filterRows(data.rows, {brand: YOGURUTO});
  assert.deepEqual(rows.map(r => r.id), [TDP_EAST_2F]);
  const chains = buildChainIndex({rows: data.rows, brands: data.brands, register});
  const chain = chains.byKey.get(YOGURUTO);
  const noPoint = rows.filter(r => !hasPoint(r)).length;
  const {listRows, listTotal} = overviewList(rows, {brand: YOGURUTO, noPoint});
  assert.equal(listTotal, 1);
  const insight = summarizeAreaInsight(rows, index, {coverage});
  const html = renderOverview({insight, summary: summarize(rows), overview: buildOverview(rows, index), focusMode: 'auto', classOf: () => '#000', meta: data.meta, coverage,
    noPoint, filtered: true, listRows, listTotal, brandHead: renderBrandHead({chain, rows}), index});
  const t = text(html);
  assert.ok(t.includes(`รหัส ${YOGURUTO}`), 'the brand code');
  assert.ok(t.includes('Yoguruto True Digital Park'), 'the branch reads as its place, without the chain repeated');
  assert.ok(t.includes(`สาขาเครือ · ฝั่ง EAST · ชั้น 2 · ยังไม่มีพิกัด · รหัส ${TDP_EAST_2F}`), t.slice(0, 900));
  assert.ok(t.includes('ยังไม่มีพิกัด 1 ร้าน') && t.indexOf('ยังไม่มีพิกัด 1 ร้าน') < t.indexOf('รายการ 1 ร้าน') && t.indexOf('รายการ 1 ร้าน') < t.indexOf(TDP_EAST_2F), 'the head says it has no point; the list below names it');
  // A pin only from a coordinate that passes the register rule: none here — not the host's point, not the venue's.
  assert.equal(pointCollection(rows).features.length, 0);
  // The branch page says the same, the source's own name kept.
  const out = text(renderOutlet({reg: register, outlet: o}));
  assert.ok(out.includes('Yoguruto — True Digital Park EAST 2F') && out.includes('ฝั่ง EAST · ชั้น 2') && out.includes(`รหัส ${TDP_EAST_2F}`) && out.includes('ยังไม่มีพิกัด'));
});

test('a chain page lists every row up to 40, or the first 40 when none has a point; a search lists only a small scope', () => {
  const rows = n => Array.from({length: n}, (_, i) => ({id: `x${i}`, name: `x${i}`, reviews: i}));
  assert.equal(overviewList(rows(40), {brand: 'B'}).listRows.length, 40);
  assert.equal(overviewList(rows(41), {brand: 'B', noPoint: 3}).listRows, null, 'a large chain with pins: the map lists it');
  assert.deepEqual([overviewList(rows(90), {brand: 'B', noPoint: 90}).listRows.length, overviewList(rows(90), {brand: 'B', noPoint: 90}).listTotal], [40, 90]);
  assert.equal(overviewList(rows(5), {}).listRows, null, 'no query, every row on the map: no list');
  assert.equal(overviewList(rows(5), {query: 'x'}).listRows.length, 5);
});

test('floors read as the page says them; an outlet reads as its place without its chain, zone and floor', () => {
  assert.deepEqual(['2F', '1', 'G', 'ชั้น 1', 'ชั้น1', '3rd Floor', 'G FL.', 'GF', 'B1 floor', 'Level 1', 'Ground floor', 'LG'].map(floorLabel),
    ['ชั้น 2', 'ชั้น 1', 'ชั้น G', 'ชั้น 1', 'ชั้น 1', 'ชั้น 3', 'ชั้น G', 'ชั้น G', 'ชั้น B1', 'ชั้น 1', 'ชั้น G', 'ชั้น LG']);
  assert.equal(floorLabel('ชั้น 1 ใกล้ทางเข้าห้าง'), 'ชั้น 1 ใกล้ทางเข้าห้าง', 'source words stay, never “ชั้น ชั้น”');
  assert.equal(floorLabel(''), '');
  const brand = {name: 'Yoguruto'};
  assert.equal(entryParts({kind: 'outlet', name: 'Yoguruto — True Digital Park EAST 2F', brand, floor: '2F', zone: 'EAST'}).secondary, 'True Digital Park');
  assert.equal(entryParts({kind: 'outlet', name: 'Yoguruto', brand}).secondary, '');
  assert.equal(entryParts({kind: 'outlet', name: 'Central World', brand: {name: 'TP TEA'}}).secondary, 'Central World');
});

test('the register says its sheet read and its publication apart, in Thai and in English', () => {
  const r = release();
  assert.match(r.register.readAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
  assert.ok(r.publishedAt === null || (/^\d{4}-\d{2}-\d{2}T/.test(r.publishedAt) && r.publishedAt.slice(0, 10) >= r.register.readAt.slice(0, 10)), 'published after the read, or not yet');
  const line = text(provenance({retrievedOn: '2026-10-22', registerChecked: '25 ต.ค. 2569–7 พ.ย. 2569', registerRead: '2026-11-09', published: '2026-11-10'}, 'ประเทศไทย'));
  assert.ok(line.includes('ทะเบียนร้านเครือ ตรวจ 25 ต.ค. 2569–7 พ.ย. 2569 · อ่านชีต 9 พ.ย. 2569 · เผยแพร่ 10 พ.ย. 2569'), line);
  assert.ok(!text(provenance({retrievedOn: '2026-10-22', registerRead: '2026-11-09'}, 'ประเทศไทย')).includes('เผยแพร่'), 'no publication date before the merge');
  setSourceDates({registerRead: '2026-11-09', published: '2026-11-10'});
  const reg = text(registerProvenance({checkedFrom: '2026-10-25', checkedTo: '2026-11-07'}));
  assert.ok(reg.includes('อ่านชีต 9 พ.ย. 2569') && reg.includes('เผยแพร่ 10 พ.ย. 2569') && reg.indexOf('อ่านชีต') > reg.indexOf('ตรวจ'), reg);
  registerDictionary(RESTAURANT_EN);
  for (const [th, en] of [['อ่านชีต 9 พ.ย. 2569', /^sheet read .*2026$/], ['เผยแพร่ 10 พ.ย. 2569', /^published .*2026$/], ['ฝั่ง EAST', /^EAST zone$/], ['ชั้น 2', /^Floor 2$/], [`รหัส ${YOGURUTO}`, new RegExp(`^Id ${YOGURUTO}$`)]]) {
    assert.match(translate(th) ?? '', en, th);
  }
});

test('snapshot candidates join a register brand only on evidence, and old brand links still open the chain', () => {
  const {data} = load();
  const record = readJSON('docs/brand-crosswalk.json');
  assert.ok(record.pairs.length >= 1 && record.pairs.every(p => p.evidence.length && p.evidence.every(e => ['page', 'domain', 'point'].includes(e.kind))), 'every pair names its evidence');
  assert.ok(record.review.every(x => !record.pairs.some(p => p.legacy === x.legacy)), 'review rows change nothing');
  const crosswalked = data.brands.filter(b => b.nationalBy === 'crosswalk');
  assert.deepEqual(crosswalked.map(b => [b.id, b.national[0]]).sort(), record.pairs.map(p => [p.legacy, p.register]).sort());
  const mixue = record.pairs.find(p => p.legacy === 'RBR-mixue');
  if (mixue) {
    // The old link (?brand=RBR-mixue) opens both sides; the register's key holds the snapshot rows too.
    const old = filterRows(data.rows, {brand: 'RBR-mixue'}), now = filterRows(data.rows, {brand: mixue.register});
    assert.ok(old.some(r => r.kind === 'outlet') && old.some(r => r.kind !== 'outlet'));
    assert.deepEqual(new Set(old.map(r => r.id)), new Set(now.map(r => r.id)));
  }
  assert.ok(!/docs\.google|drive\.google|spreadsheets\/d\//.test(JSON.stringify(record)), 'no private sheet link');
});

test('chain size: the classification tab\'s count rule applied to this register where the register moved', () => {
  const {data, register} = load();
  const m = readJSON('data/segments.json').meta.outlets;
  const band = n => (n <= 1 ? 'S1' : n <= 9 ? 'S2' : n <= 49 ? 'S3' : n <= 199 ? 'S4' : 'S5');
  for (const [id, x] of Object.entries(m.recounted || {})) {
    const b = register.brandById.get(id);
    assert.equal(x.count, b.outlets, id);
    assert.equal(x.band, band(x.count), id);
    assert.equal(x.classifiedBand, band(x.classifiedCount), `${id}: the tab agrees with its own count`);
    assert.ok(data.outlets.filter(o => o.brand.id === id).every(o => o.sizeOwn === x.band || o.size === x.band), id);
  }
  for (const id of m.bandChanged || []) assert.notEqual(m.recounted[id].classifiedBand, m.recounted[id].band, id);
});

test('the release file keeps the sheet private: counts, fingerprints and dates only', () => {
  const r = release();
  const s = JSON.stringify(r);
  assert.ok(!/docs\.google|drive\.google|spreadsheets\/d\//.test(s), 'no sheet link');
  assert.ok(!/"[A-Za-z0-9_-]{33,44}"/.test(s.replace(/"[0-9a-f]{64}"/g, '""')), 'no Drive-style id');
  assert.equal(r.register.tabs['02_STORES'].rows, r.register.outlets);
  assert.match(r.register.sourceSha256, /^[0-9a-f]{64}$/);
  assert.ok(Object.keys(r.register.tabs).length === 9);
});

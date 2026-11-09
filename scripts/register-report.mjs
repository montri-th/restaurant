#!/usr/bin/env node
/**
 * What a register build changes on the page (2026-11-09): brands and outlets added, changed or gone, chain sizes that
 * moved, the totals the page shows before and after. Both sides are decoded the way the browser decodes them
 * (js/model.js, js/register.js), so the counts are the page's own.
 *
 *   node scripts/register-report.mjs --before <dir> [--after <dir>] [--md report.md] [--json report.json]
 *
 * <dir> holds data/ of a build (--before: the published one, e.g. a checkout of main; --after defaults to this repo).
 * The markdown goes into the pull request; nothing here reads the sheet or prints a link to it.
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeDataset, outletRows, deriveChainGroups, registerProvinces, attachSegments, summarize, brandKey} from '../js/model.js';
import {buildAreaIndex} from '../js/areas.js';
import {decodeRegister} from '../js/register.js';
import {summarizeAreaInsight} from '../js/area-insight.js';
import {dens} from '../js/panel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const BEFORE = resolve(opt('--before') || ''), AFTER = resolve(opt('--after', root));
if (!opt('--before')) { console.error('usage: register-report.mjs --before <dir> [--after <dir>] [--md file] [--json file]'); process.exit(2); }

const read = (dir, f) => JSON.parse(readFileSync(existsSync(join(dir, f)) ? join(dir, f) : join(root, f), 'utf8'));
function side(dir) {
  const areasGeo = read(dir, 'data/areas.geojson'), districtsGeo = read(dir, 'data/districts.geojson'), provincesGeo = read(dir, 'data/provinces.geojson');
  const raw = read(dir, 'data/restaurants.json'), chains = read(dir, 'data/chains.json');
  const index = buildAreaIndex(areasGeo, districtsGeo, provincesGeo);
  const data = decodeDataset(raw, areasGeo);
  const register = decodeRegister(chains, index);
  registerProvinces(register.provinces);
  const snapshotOf = new Map();
  for (const b of data.brands) for (const id of b.national || []) { const x = register.brandById.get(id); if (!x) continue; if (!snapshotOf.has(x.id)) snapshotOf.set(x.id, []); snapshotOf.get(x.id).push(b); }
  const chainGroups = deriveChainGroups(register, {snapshotOf, rows: data.rows, groups: data.groups});
  const restaurants = data.rows;
  const outlets = outletRows(register, data.groups, {snapshotOf, index, chainGroups});
  const rows = [...restaurants, ...outlets];
  const segments = read(dir, 'data/segments.json');
  attachSegments(segments, {rows: restaurants, outlets, keys: raw.cols.key, ids: chains.cols.id});
  const covered = new Set(rows.map(r => r.area).filter(Boolean));
  let km2 = 0; for (const id of covered) km2 += index.byId.get(id)?.km2 || 0;
  const aha = summarizeAreaInsight(rows, index, {coverage: {km2, areas: covered.size}});
  const land = existsSync(join(dir, 'data/land.json')) ? read(dir, 'data/land.json') : null;
  const release = existsSync(join(dir, 'data/release.json')) ? read(dir, 'data/release.json') : null;
  return {chains, register, outlets, rows, segments, aha, land, release, summary: summarize(rows), keys: new Set(rows.filter(r => r.brand).map(brandKey))};
}

const a = side(BEFORE), b = side(AFTER);
const cols = c => c.cols;
const outletMap = s => { const c = cols(s.chains), m = new Map(); for (let i = 0; i < c.id.length; i++) m.set(c.id[i], i); return m; };
const ma = outletMap(a), mb = outletMap(b);
const brandOf = (s, i) => s.chains.brands[cols(s.chains).brand[i]];
const FIELDS = {name: 'ชื่อ', lat: 'พิกัด', lon: 'พิกัด', prov: 'จังหวัด', floor: 'ชั้น', zone: 'ฝั่ง', unit: 'ยูนิต', addr: 'ที่อยู่', ev: 'หลักฐาน', st: 'สถานะ', geo: 'ที่มาของพิกัด', src: 'แหล่ง', checked: 'วันที่ตรวจ', brand: 'เครือ'};
const value = (s, k, i) => (k === 'src' ? s.chains.urls[cols(s.chains).src[i]] || '' : k === 'brand' ? brandOf(s, i).id : k === 'prov' ? (s.chains.provinces[cols(s.chains).prov[i]]?.code || '') : cols(s.chains)[k]?.[i] ?? '');

const added = [...mb.keys()].filter(id => !ma.has(id)), gone = [...ma.keys()].filter(id => !mb.has(id));
const changed = [], byField = {};
for (const [id, j] of mb) {
  const i = ma.get(id); if (i == null) continue;
  const fields = [...new Set(Object.keys(FIELDS).filter(k => String(value(a, k, i)) !== String(value(b, k, j))).map(k => FIELDS[k]))];
  if (fields.length) { changed.push({id, brand: brandOf(b, j).name, name: cols(b.chains).name[j], fields}); for (const f of fields) byField[f] = (byField[f] || 0) + 1; }
}
const brandsA = new Map(a.chains.brands.map(x => [x.id, x])), brandsB = new Map(b.chains.brands.map(x => [x.id, x]));
const newBrands = b.chains.brands.filter(x => !brandsA.has(x.id)).map(x => ({id: x.id, name: x.name, outlets: x.outlets, withPoint: x.withPoint, logo: Boolean(x.logo)})).sort((p, q) => q.outlets - p.outlets || p.name.localeCompare(q.name));
const goneBrands = a.chains.brands.filter(x => !brandsB.has(x.id)).map(x => ({id: x.id, name: x.name, outlets: x.outlets}));
const grown = b.chains.brands.filter(x => brandsA.has(x.id) && x.outlets !== brandsA.get(x.id).outlets).map(x => ({id: x.id, name: x.name, before: brandsA.get(x.id).outlets, after: x.outlets})).sort((p, q) => (q.after - q.before) - (p.after - p.before));
const recount = b.segments.meta?.outlets?.recounted || {};
const bandChanged = (b.segments.meta?.outlets?.bandChanged || []).map(id => ({id, name: brandsB.get(id)?.name || id, ...recount[id]}));
const landIn = s => (s.land ? s.land.chains.length : null);
const pct = (n, d) => (d ? `${(n / d * 100).toFixed(1)}%` : '—');
const totals = [
  ['อ่านชีต', a.release?.register?.readAt?.slice(0, 16).replace('T', ' ') || '3 พ.ย. 2569 (ก่อนมี release.json)', b.release?.register?.readAt?.slice(0, 16).replace('T', ' ') || '—'],
  ['สาขาในทะเบียน (outlet_id)', a.chains.cols.id.length, b.chains.cols.id.length],
  ['เครือที่มีสาขา (brand_id)', a.chains.brands.length, b.chains.brands.length],
  ['บริษัท/บทบาท', a.chains.companies.length, b.chains.companies.length],
  ['สาขาที่มีพิกัด (หมุด)', a.chains.meta.stats.withPoint, b.chains.meta.stats.withPoint],
  ['สาขาไม่ทราบจังหวัด', a.chains.meta.stats.noProvince, b.chains.meta.stats.noProvince],
  ['ร้านทั้งหมดบนหน้าเว็บ (ชุดข้อมูล + ทะเบียน)', a.summary.count, b.summary.count],
  ['เครือในตัวกรอง (รหัสเครือบนหน้าเว็บ)', a.keys.size, b.keys.size],
  ['สาขาที่จับได้ในอาคาร Land', landIn(a), landIn(b)],
  ['ข้อค้นพบแรก (ร้าน/ตร.กม.)', `${dens(a.aha.density)} · ${a.aha.areas.map(x => x.name).join(' · ')}`, `${dens(b.aha.density)} · ${b.aha.areas.map(x => x.name).join(' · ')}`],
];
const report = {before: BEFORE, after: AFTER, totals, newBrands, goneBrands, grown, added: added.length, gone, changed: {count: changed.length, byField, sample: changed.slice(0, 40)}, bandChanged};

const fmt = v => (typeof v === 'number' ? v.toLocaleString('en-US') : v ?? '—');
const lines = [];
lines.push('| ตัวเลข | ก่อน | หลัง |', '|---|---:|---:|', ...totals.map(([k, x, y]) => `| ${k} | ${fmt(x)} | ${fmt(y)} |`), '');
lines.push(`**สาขาเพิ่ม ${fmt(added.length)} · หาย ${fmt(gone.length)} · เปลี่ยน ${fmt(changed.length)}** — เครือใหม่ ${fmt(newBrands.length)} (${fmt(newBrands.reduce((s, x) => s + x.outlets, 0))} สาขา) · เครือเดิมได้สาขาเพิ่ม ${fmt(grown.filter(x => x.after > x.before).length)} (${fmt(grown.reduce((s, x) => s + Math.max(0, x.after - x.before), 0))} สาขา) · เครือหาย ${fmt(goneBrands.length)}`, '');
if (Object.keys(byField).length) lines.push(`สาขาเดิมที่ข้อมูลเปลี่ยน แยกตามช่อง: ${Object.entries(byField).sort((p, q) => q[1] - p[1]).map(([k, n]) => `${k} ${fmt(n)}`).join(' · ')}`, '');
if (bandChanged.length) {
  lines.push('**ขนาดเครือที่เปลี่ยนช่วงเพราะจำนวนสาขาใหม่**', '', '| เครือ | สาขา (จัดกลุ่ม → ตอนนี้) | ช่วง |', '|---|---:|---|');
  for (const x of bandChanged) lines.push(`| ${x.name} \`${x.id}\` | ${fmt(x.classifiedCount)} → ${fmt(x.count)} | ${x.classifiedBand} → ${x.band} |`);
  lines.push('');
}
const list = (title, rows, f, limit = 30) => {
  if (!rows.length) return;
  lines.push(`<details><summary>${title} (${fmt(rows.length)})</summary>`, '', ...rows.slice(0, limit).map(f), ...(rows.length > limit ? [`- … อีก ${fmt(rows.length - limit)}`] : []), '', '</details>', '');
};
list('เครือใหม่', newBrands, x => `- ${x.name} \`${x.id}\` ${fmt(x.outlets)} สาขา${x.withPoint ? ` · มีพิกัด ${fmt(x.withPoint)}` : ' · ยังไม่มีพิกัด'}${x.logo ? '' : ' · ยังไม่มีโลโก้'}`, 80);
list('เครือเดิมที่จำนวนสาขาเปลี่ยน', grown, x => `- ${x.name} \`${x.id}\` ${fmt(x.before)} → ${fmt(x.after)}`, 40);
list('เครือที่หาย', goneBrands, x => `- ${x.name} \`${x.id}\` (${fmt(x.outlets)} สาขา)`);
list('สาขาที่หาย', gone, id => `- \`${id}\``);
list('สาขาเดิมที่ข้อมูลเปลี่ยน (ตัวอย่าง)', changed, x => `- ${x.brand} · ${x.name} \`${x.id}\` — ${x.fields.join(', ')}`, 40);
const md = lines.join('\n');
if (opt('--md')) writeFileSync(opt('--md'), md + '\n'); else console.log(md);
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(report, null, 1) + '\n');

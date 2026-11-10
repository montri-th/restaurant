/**
 * Dataset vocabulary, decoding, shared filter and summary helpers.
 *
 * Rows are restaurant observations of the public CityMETER Restaurants overlay
 * (data/restaurants.json, built from the research sheet of record). One row =
 * one retained owning-tile observation; nothing here merges, moves or mutates a
 * row. Coordinates are the overlay's display positions on the z10 × 4096 grid
 * (9.55 m), decoded exactly as the research decoder does.
 */

import {seriesOf} from './cues.js';

/** Short labels for tight places (matrix columns); the full Thai label stays in titles, legends and lists. */
export const GROUP_SHORT = Object.freeze({
  general: 'ทั่วไป', thai: 'ไทย', fastfood: 'ฟาสต์ฟู้ด', japanese: 'ญี่ปุ่น', cafe: 'คาเฟ่/ของหวาน', asian: 'จีน/เอเชีย',
  grill: 'ปิ้งย่าง/บุฟเฟต์', western: 'ตะวันตก', other: 'อื่น ๆ', unspecified: 'ไม่ระบุ',
});

/** Provinces that hold rows, keyed by the production route code (/v3/citymeter/{code}); dopa = 2-digit DOPA code. */
export const PROVINCES = Object.freeze([
  {code: 'BKK', dopa: '10', th: 'กรุงเทพมหานคร', en: 'Bangkok'},
  {code: 'NBI', dopa: '12', th: 'นนทบุรี', en: 'Nonthaburi'},
  {code: 'SPK', dopa: '11', th: 'สมุทรปราการ', en: 'Samut Prakan'},
  {code: 'PTE', dopa: '13', th: 'ปทุมธานี', en: 'Pathum Thani'},
  {code: 'SKN', dopa: '74', th: 'สมุทรสาคร', en: 'Samut Sakhon'},
  {code: 'CCO', dopa: '24', th: 'ฉะเชิงเทรา', en: 'Chachoengsao'},
  {code: 'NPT', dopa: '73', th: 'นครปฐม', en: 'Nakhon Pathom'},
]);
/** Every province (77) once the register is decoded — the covered seven first, then the rest (register outlets only). */
export const ALL_PROVINCES = [...PROVINCES];
export function registerProvinces(list = []) {
  const known = new Set(ALL_PROVINCES.map(p => p.code));
  for (const p of list) if (p?.code && !known.has(p.code)) { ALL_PROVINCES.push({code: p.code, dopa: p.dopa, th: p.th, en: p.en, areaSqm: p.areaSqm, covered: false}); known.add(p.code); }
  return ALL_PROVINCES;
}
export const isCoveredProvince = code => PROVINCES.some(p => p.code === String(code || '').toUpperCase());
export const provinceByCode = code => ALL_PROVINCES.find(p => p.code === String(code || '').toUpperCase()) || null;
/** Accept a production code (BKK), a DOPA code (10) or an English/Thai name; returns the production code or ''. */
export const provinceCodeFrom = value => {
  const v = String(value || '').trim();
  const p = ALL_PROVINCES.find(x => x.code === v.toUpperCase() || x.dopa === v || String(x.en || '').toLowerCase() === v.toLowerCase() || x.th === v);
  return p ? p.code : '';
};

/**
 * Price tiers (0.8.0, the 2 Nov segmentation, register workbook rules.price): six ranges of the price the source states
 * — P6 = starts at 1,000 with no ceiling; otherwise the ceiling (the start when there is none) against 100 / 200 / 300 /
 * 500 / 1,000 (a closed 1,000 ceiling is P5). Computed from the bounds (p0/p1), never from the API's own bucket
 * (`cols.price`, COALESCE(end, start) over ≤100 / ≤300 / ≤500 / ≤1,000 / >1,000), which put the 886 sheet-1 rows
 * priced “from 1,000” with no ceiling (907 with the moved rows) in 500–1,000 and left “over 1,000” empty. A range the
 * source states, not spend per person.
 */
export const PRICE_BUCKETS = Object.freeze(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'UNSPECIFIED']);
export const PRICE_LABELS = Object.freeze({
  P1: 'ไม่เกิน 100 บาท', P2: '101–200 บาท', P3: '201–300 บาท', P4: '301–500 บาท',
  P5: '501–1,000 บาท', P6: 'เริ่ม 1,000 บาทขึ้นไป', UNSPECIFIED: 'ไม่ระบุราคา',
});
export const PRICE_SHORT = Object.freeze({
  P1: '≤100', P2: '101–200', P3: '201–300', P4: '301–500', P5: '501–1,000', P6: '1,000+', UNSPECIFIED: 'ไม่ระบุ',
});
/** The tier of one row from the source's start / end price (null bounds = not stated, never 0). */
export function priceTier(p0, p1) {
  const lo = Number.isFinite(p0) ? p0 : null, hi = Number.isFinite(p1) ? p1 : null;
  if (lo == null && hi == null) return 'UNSPECIFIED';
  if (hi == null && lo >= 1000) return 'P6';
  const top = hi ?? lo;
  return top <= 100 ? 'P1' : top <= 200 ? 'P2' : top <= 300 ? 'P3' : top <= 500 ? 'P4' : top <= 1000 ? 'P5' : 'P6';
}
/** Links of 0.1–0.7 named the API buckets; each opens the tiers it covers (100–300 = P2 + P3). */
export const LEGACY_PRICE = Object.freeze({UNDER_100: 'P1', R100_300: 'P2,P3', R300_500: 'P4', R500_1000: 'P5', OVER_1000: 'P6'});
export const LEGACY_PRICE_LABELS = Object.freeze({'P2,P3': '101–300 บาท (ช่วงของลิงก์เดิม)'});

/**
 * Chain size (0.8.0): register workbook 10_CLASSIFICATION `chain_size_band` + `chain_link_status` (data/segments.json).
 * Counts of rows, not a judgement — register outlets by the register rows of the same brand_id; a sheet-1 row by the
 * sheet-1 rows sharing its name candidate (a candidate, not a confirmed chain); one observed row is “network unknown”,
 * never “independent”. The rest of the six axes waits for the human sample check (rules.QA).
 */
export const SIZE_BANDS = Object.freeze(['S1', 'S2', 'S3', 'S4', 'S5']);
export const SIZE_LABELS = Object.freeze({
  S1: '1 สาขาที่พบในข้อมูล', S2: 'เครือเล็ก 2–9 สาขา', S3: 'เครือกลาง 10–49 สาขา', S4: 'เครือใหญ่ 50–199 สาขา', S5: 'เครือระดับชาติ 200+ สาขา',
});
/** Short band names for bars and the filter select, where the heading already says ขนาดเครือ. */
export const SIZE_SHORT = Object.freeze({S1: '1 สาขาที่พบ', S2: '2–9 สาขา', S3: '10–49 สาขา', S4: '50–199 สาขา', S5: '200+ สาขา'});
export const SIZE_BASIS = Object.freeze({
  c: 'นับสาขาตามทะเบียนของเครือนี้',
  n: 'นับร้านชื่อเดียวกันในชุดข้อมูล 7 จังหวัด',
  s: 'พบแถวเดียวในข้อมูล',
  r: 'นับสาขาตามทะเบียนของเครือนี้',
  x: 'จุดขายหลายแบรนด์ — ไม่จัดขนาด',
});
/** A row whose chain is larger in the other sheet takes that size (one chain, one size — the 0.7.0 one-chain rule). */
export const SIZE_LIFTED = 'ใช้ขนาดที่ใหญ่ที่สุดที่นับได้ของเครือเดียวกัน';
/**
 * Attach the segments to the rows. `keys` / `ids` are the arrays the segment strings are aligned to (restaurants.json
 * cols.key, chains.json cols.id); a length mismatch means another build and nothing is attached.
 *
 * The source sizes the two sheets apart (rules.chain: register rows per brand_id; sheet-1 rows per name candidate), so
 * one chain of the app's index (`brandKey`) can carry two bands — e.g. a chain with 120 name-matched restaurants in the
 * seven provinces and 400 register outlets. The app keeps one chain one size: every row of a chain takes the largest
 * band the source gives any of its rows (never a sum across the sheets, which may list the same shop twice); the row's
 * own band stays in `sizeOwn` and `sizeLifted` says it was raised.
 */
export function attachSegments(segments, {rows = [], outlets = [], keys = [], ids = []} = {}) {
  // Without the register (ids empty) only the restaurant rows are sized; a register of another build sizes nothing.
  const ok = segments?.rows?.size?.length === keys.length && (!ids.length || segments?.outlets?.size?.length === ids.length);
  if (!ok) return {attached: 0, lifted: 0, ok: false, food: 0};
  setFood(segments.meta?.food);
  const alpha = segments.meta?.food?.alphabet || '';
  let attached = 0, food = 0;
  const put = (r, size, basis, g, sg) => {
    // Food taxonomy (0.9.2, an inference of the workbook, labelled อนุมาน on the page): group → its category; sub-group.
    const group = g && g !== '.' ? FOOD.groups[alpha.indexOf(g)] : null;
    if (group) {
      r.food = group.id; r.foodCat = group.category; food++;
      const sub = sg && sg !== '.' ? FOOD.subgroups[alpha.indexOf(sg)] : null;
      if (sub) r.foodSub = sub.id;
    }
    const k = Number(size);
    if (basis && basis !== '.') r.sizeBasis = basis;
    if (size === '.' || !Number.isInteger(k) || k < 0 || k > 4) return;
    r.size = SIZE_BANDS[k]; r.sizeOwn = r.size; r.sizeLifted = false; attached++;
  };
  const at = (side, key, i) => segments[side]?.[key]?.[i];
  const keyIndex = new Map(keys.map((k, i) => [k, i]));
  for (const r of rows) { const i = keyIndex.get(r.id); if (i != null) put(r, segments.rows.size[i], segments.rows.basis[i], at('rows', 'food', i), at('rows', 'sub', i)); }
  const idIndex = new Map(ids.map((k, i) => [k, i]));
  for (const o of outlets) { const i = idIndex.get(o.id); if (i != null) put(o, segments.outlets.size[i], segments.outlets.basis[i], at('outlets', 'food', i), at('outlets', 'sub', i)); }
  const top = new Map();
  const all = [...rows, ...outlets];
  for (const r of all) {
    const key = r.size ? brandKey(r) : '';
    if (key) top.set(key, Math.max(top.get(key) ?? -1, SIZE_BANDS.indexOf(r.size)));
  }
  let lifted = 0;
  for (const r of all) {
    const key = r.size ? brandKey(r) : '';
    const k = key ? top.get(key) : -1;
    if (k > SIZE_BANDS.indexOf(r.size)) { r.size = SIZE_BANDS[k]; r.sizeLifted = true; lifted++; }
  }
  return {attached, lifted, ok: true, food};
}

/**
 * The food taxonomy of the register's classification tab (0.9.2): 6 categories · 19 groups · 31 sub-groups, read from
 * data/segments.json meta.food. Every row's value is an unreviewed inference of the workbook (shown by owner decision
 * 2026-11-03 16:59 ahead of the 1,550-sample check) — the page says อนุมาน wherever it shows one.
 */
export const FOOD = {categories: [], groups: [], subgroups: [], byId: new Map()};
function setFood(t) {
  FOOD.categories = t?.categories || []; FOOD.groups = t?.groups || []; FOOD.subgroups = t?.subgroups || [];
  FOOD.byId = new Map([...FOOD.categories.map(c => [c.id, {...c, level: 'category'}]), ...FOOD.groups.map(g => [g.id, {...g, level: 'group'}]),
    ...FOOD.subgroups.map(x => [x.id, {...x, level: 'subgroup'}])]);
}
/** A food filter value (FCxx · FGxx · FSGxx) against one row. */
export function foodMatch(r, value) {
  if (!value) return true;
  if (value.startsWith('FSG')) return r.foodSub === value;
  if (value.startsWith('FG')) return r.food === value;
  if (value.startsWith('FC')) return r.foodCat === value;
  return false;
}
/** The label of a food id; a sub-group that only says “not specified within the group” reads with its group. */
export function foodLabel(id) {
  const e = FOOD.byId.get(id);
  if (!e) return '';
  return e.level === 'subgroup' && e.fallback ? `${FOOD.byId.get(e.group)?.label || ''} · ${e.label}` : e.label;
}
/** Rows per category / group / sub-group (unclassified kept apart, never 0 of a category). */
export function foodMix(rows) {
  const cats = new Map(), groups = new Map(), subs = new Map();
  let unclassified = 0;
  for (const r of rows) {
    if (!r.food) { unclassified++; continue; }
    cats.set(r.foodCat, (cats.get(r.foodCat) || 0) + 1);
    groups.set(r.food, (groups.get(r.food) || 0) + 1);
    if (r.foodSub) subs.set(r.foodSub, (subs.get(r.foodSub) || 0) + 1);
  }
  return {cats, groups, subs, unclassified, classified: rows.length - unclassified};
}
export const PRICED = PRICE_BUCKETS.filter(b => b !== 'UNSPECIFIED');

/** Overlay quantization: z10 × extent 4096. */
export const GRID = 4194304;
export const GRID_METRES = 9.554628535647032;
/** Exact inverse used by the research decoder (mvt_point_decoder.coordinate). */
export function gridToLngLat(gx, gy) {
  return [gx / GRID * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / GRID))) * 180 / Math.PI];
}
/** z10 overlay tile that owns a row (every row comes from the tile containing its display position). */
export const sourceTile = r => ({z: 10, x: Math.floor(r.gx / 4096), y: Math.floor(r.gy / 4096)});

/** A usable coordinate inside Thailand's bounding box. */
export const hasPoint = r => Number.isFinite(r?.latitude) && Number.isFinite(r?.longitude) &&
  r.latitude >= 5 && r.latitude <= 21 && r.longitude >= 97 && r.longitude <= 106;

const lower = v => String(v || '').toLocaleLowerCase('th-TH');

/**
 * Decode data/restaurants.json into row objects plus dictionaries.
 * `areas` is data/areas.geojson (subdistrict frames): every row's `area` code
 * must exist there (the build checks it; rows that fail are dropped and counted).
 */
export function decodeDataset(json, areas) {
  if (!json?.cols || !Array.isArray(json.cols.key)) throw new Error('Invalid restaurants dataset');
  const c = json.cols, n = c.key.length;
  const areaProps = new Map((areas?.features || []).map(f => [String(f.id ?? f.properties?.id), f.properties]));
  // One population since 0.6.0 (owner 2026-10-28 22:36) and one vocabulary since 0.7.0 (owner 2026-10-29 “ปรับใหม่ให้
  // search / filter / คำนวณ / aggregate รวมกันทั้งสองตาราง”): the register's outlets join the rows under the same ten
  // food-type groups (a chain's type, derived — see deriveChainGroups), never as a group of their own.
  const groups = (json.groups || []).map((g, i) => ({...g, index: i, series: seriesOf(g.id), short: GROUP_SHORT[g.id] || g.th}));
  const brands = (json.brands || []).map((b, i) => ({...b, index: i}));
  const venues = (json.venues || []).map((v, i) => ({...v, index: i}));
  const brandOf = new Map((json.brand || []).map(([i, b]) => [i, brands[b]]));
  const venueOf = new Map((json.venue || []).map(([i, v]) => [i, venues[v]]));
  const venueEntity = new Set(json.venueEntity || []);
  // How the row's venue was found (meta.venueSuffix.codes): absent = the sheet link (07_VENUES);
  // 1 = a 07_VENUES name/alias ends the restaurant name; 2 = a name-derived place (repeated ending).
  const MATCH = {1: 'suffix', 2: 'auto'};
  const venueMatch = new Map((json.venueMatch || []).map(([i, m]) => [i, MATCH[m] || 'sheet']));
  // Rows the owner moved to the chain register on 2026-10-25 (meta.registerRule): 1 = held for review, 2 = with a
  // recorded correspondence; registerOutlets = register outlet_ids listed as possible targets. Still one row each here.
  const register = new Map(json.register || []);
  const registerOutlets = new Map(json.registerOutlets || []);
  const rows = [];
  let dropped = 0;
  for (let i = 0; i < n; i++) {
    const code = json.areas[c.area[i]];
    const a = areaProps.get(code);
    if (!a) { dropped++; continue; }
    const [longitude, latitude] = gridToLngLat(c.gx[i], c.gy[i]);
    const t = c.type[i];
    const type = t >= 0 ? json.types[t] : null;
    const group = t >= 0 ? groups[json.typeGroup[t]] : groups.find(g => g.id === 'unspecified');
    const brand = brandOf.get(i) || null, venue = venueOf.get(i) || null;
    const row = {
      id: c.key[i], name: c.name[i] || '', gx: c.gx[i], gy: c.gy[i], longitude, latitude,
      type, group: group?.index ?? 0, groupId: group?.id || 'unspecified', series: group?.series ?? seriesOf('unspecified'),
      price: priceTier(c.p0[i], c.p1[i]), p0: c.p0[i], p1: c.p1[i], size: '', sizeBasis: '',
      rating: c.rating[i], reviews: c.reviews[i],
      area: code, district: a.district, province: a.province,
      brand, venue, venueEntity: venueEntity.has(i),
      venueMatch: venue ? (venueMatch.get(i) || 'sheet') : null,
      register: register.get(i) || 0, registerTargets: registerOutlets.get(i) || [],
    };
    row.haystack = lower([row.name, brand?.name, venue?.name, a.name, a.nameEn, a.districtName].filter(Boolean).join(' '));
    rows.push(row);
  }
  // Rows the owner moved to the chain register (sheet 2) are counted there: they leave the population here and stay
  // reachable by id only (owner 22:36 “จำนวนร้านต้อง 7x,xxx + 26,xxx แสดงนับรวมกัน”: sheet 1 + the register, no row twice).
  const moved = rows.filter(r => r.register);
  const kept = rows.filter(r => !r.register);
  return {meta: json.meta || {}, rows: kept, moved, groups, brands, venues, types: json.types || [], dropped};
}

/**
 * Register `format` hints that name a food type outright (the fallback when a chain has no typed rows of its own),
 * matched on whole tokens of the format code (“steamed” must never read as “tea”). A format that says “restaurant”
 * is ambiguous (a Thai restaurant with desserts, a restaurant with a bar) and names nothing — unless it is a pizza,
 * burger or sandwich format, which the sheet-1 types also file under fast food.
 */
const FORMAT_TOKENS = [
  [new Set(['japanese', 'ramen', 'sushi', 'yakiniku', 'izakaya', 'shabu']), 'japanese'],
  [new Set(['pizza', 'burger', 'sandwich', 'sandwiches', 'fastfood']), 'fastfood'],
  [new Set(['juice', 'matcha', 'bakery', 'dessert']), 'cafe'],
  [new Set(['bar', 'cocktail', 'nightlife', 'lounge', 'pub', 'club', 'dining']), 'other'],
  [new Set(['cafe', 'coffee', 'tea', 'beverage', 'bubble', 'roaster', 'pastry', 'brunch']), 'cafe'],
];
export function formatGroup(format) {
  const tokens = new Set(String(format || '').toLowerCase().split(/[^a-z]+/).filter(Boolean));
  if (!tokens.size) return '';
  const fast = ['pizza', 'burger', 'sandwich', 'sandwiches'].some(t => tokens.has(t));
  if (tokens.has('restaurant') && !fast) return '';
  for (const [set, groupId] of FORMAT_TOKENS) if ([...set].some(t => tokens.has(t))) return groupId;
  return '';
}
/** Majority needs this many typed rows of the chain before the chain's outlets inherit the type. */
export const CHAIN_TYPE_MIN_ROWS = 3;

/**
 * A food type per chain (0.7.0, Inference — stated as such on every outlet): the majority food-type group of the
 * sheet-1 rows whose name candidate links to the register brand (≥ CHAIN_TYPE_MIN_ROWS rows and more than half of
 * them), else the group the register's own `format` names, else ‘ไม่ระบุประเภท’. The register records no cuisine;
 * without this the outlets could not be filtered, mixed or charted with the restaurants (owner 2026-10-29).
 * Returns register brand id → {groupId, how: 'rows' | 'format', rows, share}.
 */
export function deriveChainGroups(register, {snapshotOf = new Map(), rows = [], groups = []} = {}) {
  const known = new Set(groups.map(g => g.id));
  const byCandidate = new Map();
  for (const r of rows) if (r.brand && r.kind !== 'outlet' && r.groupId !== 'unspecified' && r.groupId !== 'other') {
    const m = byCandidate.get(r.brand.id) || new Map();
    m.set(r.groupId, (m.get(r.groupId) || 0) + 1);
    byCandidate.set(r.brand.id, m);
  }
  const out = new Map();
  for (const b of register?.brands || []) {
    const tally = new Map();
    for (const c of snapshotOf.get(b.id) || []) for (const [g, n] of byCandidate.get(c.id) || []) tally.set(g, (tally.get(g) || 0) + n);
    const total = [...tally.values()].reduce((s, n) => s + n, 0);
    const [top, n] = [...tally].sort((x, y) => y[1] - x[1])[0] || ['', 0];
    if (top && known.has(top) && n >= CHAIN_TYPE_MIN_ROWS && n * 2 > total) { out.set(b.id, {groupId: top, how: 'rows', rows: n, share: n / total}); continue; }
    const hit = formatGroup(b.format);
    if (hit && known.has(hit)) out.set(b.id, {groupId: hit, how: 'format', rows: 0, share: 0, format: b.format});
  }
  return out;
}

/**
 * Turn the register's outlets into rows of the same population (in place, so register views keep their objects):
 * the chain's derived food-type group (`chainGroups`, else ไม่ระบุประเภท), no price / rating (never a 0), the province
 * and subdistrict the register derived, and brand keys that let the brand filter reach the outlets of the same chain
 * (`snapshotOf`: register brand id → snapshot brand candidates). Outlets without a selected coordinate have no point.
 */
export function outletRows(register, groups, {snapshotOf = new Map(), index = null, chainGroups = new Map()} = {}) {
  const byId = new Map(groups.map(g => [g.id, g]));
  const fallback = byId.get('unspecified') || groups[groups.length - 1];
  const out = [];
  for (const o of register?.outlets || []) {
    const a = o.area && index ? index.byId.get(o.area) : null;
    const derived = chainGroups.get(o.brand?.id) || null;
    const g = (derived && byId.get(derived.groupId)) || fallback;
    o.kind = 'outlet';
    o.name = o.name || o.brand?.name || '';
    o.type = null; o.group = g?.index ?? 0; o.groupId = g?.id || 'unspecified'; o.series = g?.series ?? seriesOf('unspecified');
    o.groupBy = derived; // how the type was derived (null = none)
    o.price = 'UNSPECIFIED'; o.p0 = null; o.p1 = null; o.rating = null; o.reviews = null;
    o.venue = null; o.venueEntity = false; o.venueMatch = null; o.register = 0; o.registerTargets = [];
    o.brandKeys = new Set([o.brand?.id, ...(snapshotOf.get(o.brand?.id) || []).map(b => b.id)].filter(Boolean));
    o.haystack = lower([o.name, o.brand?.name, o.company?.name, o.address, o.provinceTh, a?.name, a?.districtName].filter(Boolean).join(' '));
    out.push(o);
  }
  return out;
}

/**
 * Brand-first naming (owner 2026-10-29 “เอา logo + brand ขึ้นก่อน ชื่อสาขา”): primary = the chain, secondary = the
 * branch / the rest of the row name. A row without a chain candidate keeps its own name as the primary.
 */
export function entryParts(r) {
  const brand = r?.brand?.name || '';
  const name = r?.name || '';
  if (!brand) return {primary: name, secondary: ''};
  if (lower(name).startsWith(lower(brand))) {
    let rest = name.slice(brand.length).trim().replace(/^[\-–—·,:|]+\s*/, '');
    if (/^\(.*\)$/.test(rest)) rest = rest.slice(1, -1).trim(); // “After You (Siam Paragon)” → Siam Paragon
    // 2026-11-09: an outlet's name written “Yoguruto — True Digital Park EAST 2F” reads as its place; the zone and the
    // floor the register lists apart are said by the meta line (“ฝั่ง EAST · ชั้น 2”), so they leave the place here.
    if (r.kind === 'outlet') rest = placeOnly(rest, r);
    return {primary: brand, secondary: rest};
  }
  return {primary: brand, secondary: r.kind === 'outlet' && lower(name) === lower(brand) ? '' : name};
}

/** An outlet's place without the zone and floor tokens it ends with, when the register lists them apart. */
function placeOnly(text, r) {
  let s = text;
  for (const token of [r.floor, r.zone]) {
    const t = String(token || '').trim();
    if (t && s.length > t.length && lower(s).endsWith(` ${lower(t)}`)) s = s.slice(0, -t.length).trim().replace(/[\-–—·,:|]+$/, '').trim();
  }
  return s;
}

/**
 * A floor as the page says it (2026-11-09): the register writes floors as its sources do (“2F”, “3rd Floor”, “G FL.”,
 * “ชั้น 1”); the common forms read “ชั้น 2”, “ชั้น G”. Anything else keeps the source's words (never “ชั้น ชั้น 1”).
 */
export function floorLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const x = (s.match(/^ชั้น\s*([A-Za-z]{0,2}\d{0,3})$/) || s.match(/^(?:fl\.?|floor|level)\s*([A-Za-z]{0,2}\d{0,3})$/i) ||
    s.match(/^(\d{1,3})(?:st|nd|rd|th)?\s*(?:f|fl\.?|floor)?\.?$/i) || s.match(/^([A-Za-z]{1,2}\d{0,2})(?:\s*,?\s*(?:f|fl\.?|floor)\.?)?$/i) ||
    s.match(/^(?:(g)round)\s*floor$/i) || [])[1];
  if (x) return `ชั้น ${(x.length > 1 && /^[A-Za-z]{1,2}\d{0,2}F$/.test(x) ? x.slice(0, -1) : x).toUpperCase()}`;
  return /ชั้น|floor|\bfl\b|level|lobby/i.test(s) ? s : `ชั้น ${s}`;
}

/** One key per chain across both sheets: a snapshot candidate with a register link counts as that register brand. */
export const brandKey = r => (r.kind === 'outlet' ? r.brand?.id || '' : r.brand ? (r.brand.national?.[0] || r.brand.id) : '');

/**
 * Shared filter used by map, counters, charts, panel and table.
 * f = {search, group, price, size, province, district, brand, venue}; area selection
 * and area focus are applied by the caller (row scopes, see app.js). `price` may name
 * several tiers joined by commas (a 0.1–0.7 link to “100–300 บาท” opens P2,P3).
 */
export function filterRows(rows, f = {}) {
  const q = lower(f.search).trim();
  const brand = f.brand || '', venue = f.venue || '';
  const prices = f.price ? new Set(String(f.price).split(',')) : null;
  return rows.filter(r => {
    if (f.group && r.groupId !== f.group) return false;
    if (prices && !prices.has(r.price)) return false;
    if (f.size && r.size !== f.size) return false;
    if (f.food && !foodMatch(r, f.food)) return false;
    if (f.province && r.province !== f.province) return false;
    if (f.district && r.district !== f.district) return false;
    if (brand && r.brand?.id !== brand && !(r.brandKeys && r.brandKeys.has(brand)) && !(r.brand?.national || []).includes(brand)) return false;
    if (venue && r.venue?.id !== venue) return false;
    return !q || r.haystack.includes(q);
  });
}

/**
 * Counts for a selection. Ratings and reviews are the source's popularity
 * proxies: missing stays missing (never 0); the mean is the simple mean of the
 * rows that carry a rating, the review total sums the rows that carry one.
 */
export function summarize(rows) {
  let reviews = 0, reviewed = 0, ratingSum = 0, rated = 0, priced = 0, outlets = 0;
  const brands = new Set(), venues = new Set(), areas = new Set();
  for (const r of rows) {
    if (Number.isFinite(r.reviews)) { reviews += r.reviews; reviewed++; }
    if (Number.isFinite(r.rating)) { ratingSum += r.rating; rated++; }
    if (r.price !== 'UNSPECIFIED') priced++;
    if (r.kind === 'outlet') outlets++;
    if (r.brand) brands.add(brandKey(r));
    if (r.venue) venues.add(r.venue.id);
    if (r.area) areas.add(r.area);
  }
  return {count: rows.length, outlets, restaurants: rows.length - outlets, reviews, reviewed, rated, ratingMean: rated ? ratingSum / rated : null, priced,
    brands: brands.size, venues: venues.size, areas: areas.size};
}

/**
 * Rows per group / price tier / chain size for a selection (every category listed, zero kept as a measured 0).
 * Outlets have no price field at all: they are counted apart from the sheet-1 rows that left the price unspecified.
 * Chain size counts both kinds; `registry` = the multi-banner point-of-sale registry (not a chain, never sized),
 * `unknown` = rows the segments file did not reach — neither is folded into S1.
 */
export function mixOf(rows, groups) {
  const byGroup = groups.map(g => ({id: g.id, index: g.index, series: g.series, th: g.th, count: 0}));
  const byPrice = Object.fromEntries(PRICE_BUCKETS.map(b => [b, 0]));
  const bySize = Object.fromEntries(SIZE_BANDS.map(b => [b, 0]));
  let outlets = 0, unknown = 0, registry = 0, candidates = 0;
  for (const r of rows) {
    byGroup[r.group].count++;
    if (r.kind === 'outlet') outlets++; else byPrice[r.price]++;
    if (r.size) { bySize[r.size]++; if (r.sizeBasis === 'n') candidates++; } else if (r.sizeBasis === 'x') registry++; else unknown++;
  }
  byPrice.outlets = outlets;
  bySize.unknown = unknown; bySize.registry = registry; bySize.candidates = candidates;
  return {byGroup, byPrice, bySize, byFood: foodMix(rows)};
}

export const safeURL = value => {
  try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; }
  catch { return ''; }
};

/** Production CityMETER deep links (route scheme observed in the production bundle, 2026-10-22). */
export const PRODUCTION = 'https://landometer.com/v3/citymeter';
export function productionLink({province = '', district = '', area = ''} = {}) {
  if (!province) return `${PRODUCTION}?d=restaurant`;
  if (area) return `${PRODUCTION}/${province}/S/${area}?d=restaurant`;
  if (district) return `${PRODUCTION}/${province}/D/${district}?d=restaurant`;
  return `${PRODUCTION}/${province}?d=restaurant`;
}

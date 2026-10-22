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
export const provinceByCode = code => PROVINCES.find(p => p.code === String(code || '').toUpperCase()) || null;
/** Accept a production code (BKK), a DOPA code (10) or an English/Thai name; returns the production code or ''. */
export const provinceCodeFrom = value => {
  const v = String(value || '').trim();
  const p = PROVINCES.find(x => x.code === v.toUpperCase() || x.dopa === v || x.en.toLowerCase() === v.toLowerCase() || x.th === v);
  return p ? p.code : '';
};

/** Price buckets of the source (COALESCE(end_price, start_price); thresholds ≤100, ≤300, ≤500, ≤1,000, >1,000). */
export const PRICE_BUCKETS = Object.freeze(['UNDER_100', 'R100_300', 'R300_500', 'R500_1000', 'OVER_1000', 'UNSPECIFIED']);
export const PRICE_LABELS = Object.freeze({
  UNDER_100: 'ไม่เกิน 100 บาท', R100_300: 'เกิน 100–300 บาท', R300_500: 'เกิน 300–500 บาท',
  R500_1000: 'เกิน 500–1,000 บาท', OVER_1000: 'เกิน 1,000 บาท', UNSPECIFIED: 'ไม่ระบุราคา',
});
export const PRICE_SHORT = Object.freeze({
  UNDER_100: '≤100', R100_300: '>100–300', R300_500: '>300–500', R500_1000: '>500–1,000', OVER_1000: '>1,000', UNSPECIFIED: 'ไม่ระบุ',
});
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
      price: PRICE_BUCKETS[c.price[i]] || 'UNSPECIFIED', p0: c.p0[i], p1: c.p1[i],
      rating: c.rating[i], reviews: c.reviews[i],
      area: code, district: a.district, province: a.province,
      brand, venue, venueEntity: venueEntity.has(i),
      venueMatch: venue ? (venueMatch.get(i) || 'sheet') : null,
    };
    row.haystack = lower([row.name, brand?.name, venue?.name, a.name, a.nameEn, a.districtName].filter(Boolean).join(' '));
    rows.push(row);
  }
  return {meta: json.meta || {}, rows, groups, brands, venues, types: json.types || [], dropped};
}

/**
 * Shared filter used by map, counters, charts, panel and table.
 * f = {search, group, price, province, district, brand, venue}; area selection
 * and area focus are applied by the caller (row scopes, see app.js).
 */
export function filterRows(rows, f = {}) {
  const q = lower(f.search).trim();
  const brand = f.brand || '', venue = f.venue || '';
  return rows.filter(r => {
    if (f.group && r.groupId !== f.group) return false;
    if (f.price && r.price !== f.price) return false;
    if (f.province && r.province !== f.province) return false;
    if (f.district && r.district !== f.district) return false;
    if (brand && r.brand?.id !== brand) return false;
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
  let reviews = 0, reviewed = 0, ratingSum = 0, rated = 0, priced = 0;
  const brands = new Set(), venues = new Set(), areas = new Set();
  for (const r of rows) {
    if (Number.isFinite(r.reviews)) { reviews += r.reviews; reviewed++; }
    if (Number.isFinite(r.rating)) { ratingSum += r.rating; rated++; }
    if (r.price !== 'UNSPECIFIED') priced++;
    if (r.brand) brands.add(r.brand.id);
    if (r.venue) venues.add(r.venue.id);
    areas.add(r.area);
  }
  return {count: rows.length, reviews, reviewed, rated, ratingMean: rated ? ratingSum / rated : null, priced,
    brands: brands.size, venues: venues.size, areas: areas.size};
}

/** Rows per group / price bucket for a selection (every category listed, zero kept as a measured 0). */
export function mixOf(rows, groups) {
  const byGroup = groups.map(g => ({id: g.id, index: g.index, series: g.series, th: g.th, count: 0}));
  const byPrice = Object.fromEntries(PRICE_BUCKETS.map(b => [b, 0]));
  for (const r of rows) { byGroup[r.group].count++; byPrice[r.price]++; }
  return {byGroup, byPrice};
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

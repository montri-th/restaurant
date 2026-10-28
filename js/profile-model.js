/**
 * Reading-panel view models. Pure: no DOM, no map.
 *
 * Every profile reads `scopeRows` (filters before any area selection) so ranks
 * and comparisons keep the whole selection as reference. Ratings and reviews are
 * the source's popularity proxies (not sales, not footfall); missing stays
 * missing. Brand and venue links are name-based candidates and are described as
 * such; coordinates are the overlay's display positions and are never upgraded.
 */
import {PRICE_BUCKETS, PRICED, GRID_METRES, sourceTile, mixOf} from './model.js';
import {summarizeAreas, summarizeDistricts, byDensity, byCount, combinedDensity, levelWords} from './areas.js';
import {MIN_AREA_ROWS} from './area-insight.js';

const byReviews = (a, b) => (b.reviews ?? -1) - (a.reviews ?? -1) || (b.rating ?? -1) - (a.rating ?? -1) || a.name.localeCompare(b.name, 'th') || a.id.localeCompare(b.id);

function stats(rows) {
  let reviews = 0, reviewed = 0, ratingSum = 0, rated = 0, priced = 0;
  for (const r of rows) {
    if (Number.isFinite(r.reviews)) { reviews += r.reviews; reviewed++; }
    if (Number.isFinite(r.rating)) { ratingSum += r.rating; rated++; }
    if (r.price !== 'UNSPECIFIED') priced++;
  }
  return {reviews, reviewed, rated, ratingMean: rated ? ratingSum / rated : null, priced};
}

/** Chains (brand candidates) present in rows, most rows first. */
export function chainsIn(rows, limit = 12) {
  const m = new Map();
  for (const r of rows) if (r.brand) { const e = m.get(r.brand.id) || {brand: r.brand, count: 0}; e.count++; m.set(r.brand.id, e); }
  return [...m.values()].sort((a, b) => b.count - a.count || a.brand.name.localeCompare(b.brand.name)).slice(0, limit);
}

/** Venues (host candidates) named by rows, most rows first. */
export function venuesIn(rows, limit = 12) {
  const m = new Map();
  for (const r of rows) if (r.venue) { const e = m.get(r.venue.id) || {venue: r.venue, count: 0}; e.count++; m.set(r.venue.id, e); }
  return [...m.values()].sort((a, b) => b.count - a.count || a.venue.name.localeCompare(b.venue.name)).slice(0, limit);
}

/** Density ranking of areas for a selection (eligible ≥ MIN_AREA_ROWS rows); the rest ranked by rows after. */
export function rankAreas(rows, index, {minRows = MIN_AREA_ROWS, province = '', district = ''} = {}) {
  const all = summarizeAreas(rows, index, {province, district});
  const eligible = all.filter(a => a.count >= minRows).sort(byDensity);
  const small = all.filter(a => a.count < minRows).sort(byCount);
  return {eligible, small, all: [...eligible, ...small], minRows};
}

export function buildOverview(scopeRows, index, {province = ''} = {}) {
  const ranking = rankAreas(scopeRows, index, {province});
  return {ranking, chains: chainsIn(scopeRows, 10), districts: summarizeDistricts(scopeRows, index, {province}).sort(byCount)};
}

/**
 * EVID-05 state of a selection: no_data when the source has no row there at all (covered = areas holding
 * ≥ 1 row in the full dataset), measured_zero when it is covered but the filters leave 0, else measured.
 * Without `covered` (older callers) the state falls back to measured / measured_zero.
 */
const selectionState = (count, isCovered) => (!isCovered ? 'no_data' : count ? 'measured' : 'measured_zero');

export function buildAreaProfile(scopeRows, areaId, index, groups, {covered = null} = {}) {
  const area = index.byId.get(areaId);
  if (!area) return null;
  const ranking = rankAreas(scopeRows, index);
  const mine = scopeRows.filter(r => r.area === areaId);
  const pos = ranking.eligible.findIndex(a => a.id === areaId);
  const district = index.districtById.get(area.district) || null;
  const coverageState = selectionState(mine.length, !covered || covered.has(areaId));
  return {
    area, district, words: levelWords(area.province), count: mine.length, km2: area.km2,
    // no_data never becomes a density of 0 (INV05/INV06).
    density: coverageState === 'no_data' || !area.km2 ? null : mine.length / area.km2,
    coverageState, scopeCount: scopeRows.length,
    rank: pos >= 0 ? pos + 1 : null, rankOf: ranking.eligible.length, minRows: ranking.minRows,
    ...stats(mine), ...mixOf(mine, groups), topReviewed: mine.filter(r => Number.isFinite(r.reviews)).sort(byReviews).slice(0, 8),
    // Lists are cut for the panel; the totals travel with them so a header never shows a list length as a count.
    chains: chainsIn(mine, 16), venues: venuesIn(mine, 10), chainTotal: chainsIn(mine, Infinity).length, venueTotal: venuesIn(mine, Infinity).length, rows: mine,
  };
}

export function buildDistrictProfile(scopeRows, districtId, index, groups, {covered = null} = {}) {
  const district = index.districtById.get(districtId);
  if (!district) return null;
  const mine = scopeRows.filter(r => r.district === districtId);
  const ranking = rankAreas(mine, index, {district: districtId});
  // Same eligibility as the areas: only districts with ≥ MIN_AREA_ROWS rows compete on density.
  const all = summarizeDistricts(scopeRows, index).filter(d => d.count >= MIN_AREA_ROWS).sort(byDensity);
  const pos = all.findIndex(d => d.id === districtId);
  const coverageState = selectionState(mine.length, !covered || district.areas.some(a => covered.has(a.id)));
  return {
    district, words: levelWords(district.province), count: mine.length, km2: district.km2,
    density: coverageState === 'no_data' || !district.km2 ? null : mine.length / district.km2,
    coverageState, scopeCount: scopeRows.length,
    rank: pos >= 0 ? pos + 1 : null, rankOf: all.length, minRows: MIN_AREA_ROWS, areas: ranking.all, areaTotal: district.areas.length,
    ...stats(mine), ...mixOf(mine, groups), chains: chainsIn(mine, 16), venues: venuesIn(mine, 8), chainTotal: chainsIn(mine, Infinity).length, venueTotal: venuesIn(mine, Infinity).length, rows: mine,
  };
}

/**
 * `spatial` (optional, from js/building-join.js#venueNeighbours): {buildings, own, others} — the drawn
 * buildings that are this venue's on screen, how many of its own rows' points fall in them and the
 * other rows whose points fall there (not name-linked: listed apart, never added to the venue).
 */
export function buildVenueProfile(scopeRows, venue, index, groups, {hosted = false, spatial = null} = {}) {
  if (!venue) return null;
  const mine = scopeRows.filter(r => r.venue?.id === venue.id).sort(byReviews);
  const areas = new Map();
  for (const r of mine) { const a = index.byId.get(r.area); if (a) areas.set(a.id, a); }
  const provinces = [...new Set(mine.map(r => r.province))];
  const matched = {sheet: 0, suffix: 0, auto: 0};
  for (const r of mine) if (r.venueMatch in matched) matched[r.venueMatch]++;
  return {venue, rows: mine, count: mine.length, areas: [...areas.values()], provinces, province: provinces.length === 1 ? provinces[0] : '',
    entityRows: mine.filter(r => r.venueEntity).length,
    // Reviews of the rows that ARE the venue (e.g. the mall's own listing): shown so the venue total is read correctly.
    entityReviews: mine.filter(r => r.venueEntity && Number.isFinite(r.reviews)).reduce((s, r) => s + r.reviews, 0),
    matched, nameDerived: venue.match === 'auto',
    spatial: spatial && spatial.buildings ? {buildings: spatial.buildings, own: spatial.own, count: spatial.others.length, others: [...spatial.others].sort(byReviews).slice(0, 8)} : null,
    hosted, ...stats(mine), ...mixOf(mine, groups)};
}

/**
 * A building the map draws, with the rows whose display points fall inside it (building-join.js):
 * sel = {key, kind: 'osm'|'host', rows, height}. Not a venue: no name; venues named by the rows are listed.
 */
export function buildBuildingProfile(sel, index, groups) {
  if (!sel?.rows?.length) return null;
  const rows = [...sel.rows].sort(byReviews);
  const area = index.byId.get(rows[0].area) || null;
  const areaIds = [...new Set(rows.map(r => r.area))];
  return {key: sel.key, kind: sel.kind || 'osm', rows, count: rows.length, area, areaCount: areaIds.length, words: levelWords(rows[0].province),
    height: Number.isFinite(sel.height) ? sel.height : null, venues: venuesIn(rows, 6), venueTotal: venuesIn(rows, Infinity).length, ...stats(rows), ...mixOf(rows, groups)};
}

/** Coordinate precision, read from the encoding — never upgraded. */
export function describeGeometry(row) {
  const t = sourceTile(row);
  return {
    label: `ตำแหน่งจาก tile z${t.z}/${t.x}/${t.y} · ช่อง ${GRID_METRES.toFixed(2)} ม.`,
    note: 'พิกัดที่ API สาธารณะแสดง (MVT z10 · extent 4096) ไม่ใช่พิกัดต้นฉบับหรือทางเข้าร้าน',
    tile: t,
  };
}

/** Price as stated by the source: bucket + start/end when present; unspecified stays unspecified. */
export function describePrice(row) {
  const fmt = v => new Intl.NumberFormat('th-TH', {maximumFractionDigits: 0}).format(v);
  const range = Number.isFinite(row.p0) && Number.isFinite(row.p1) && row.p0 !== row.p1 ? `${fmt(row.p0)}–${fmt(row.p1)} บาท`
    : Number.isFinite(row.p1) ? `${fmt(row.p1)} บาท` : Number.isFinite(row.p0) ? `${fmt(row.p0)} บาท` : '';
  return {bucket: row.price, range};
}

/** `building` (optional): {key, others} — the drawn building the row's display point falls in (building-join.js). */
export function buildStoreDetail(row, {scopeRows, index, groups, building = null}) {
  if (!row) return null;
  const area = index.byId.get(row.area) || null;
  const district = area ? index.districtById.get(area.district) : null;
  const sameBrand = row.brand ? scopeRows.filter(r => r.brand?.id === row.brand.id && r.id !== row.id) : [];
  const sameArea = scopeRows.filter(r => r.area === row.area && r.id !== row.id && r.group === row.group).sort(byReviews).slice(0, 6);
  const coLocated = scopeRows.filter(r => r.gx === row.gx && r.gy === row.gy && r.id !== row.id).length;
  return {row, area, district, words: levelWords(row.province), group: groups[row.group], price: describePrice(row), geometry: describeGeometry(row),
    coLocated, building, sameBrand: {count: sameBrand.length, rows: sameBrand.sort(byReviews).slice(0, 8), areas: new Set(sameBrand.map(r => r.area)).size}, sameArea};
}

export {PRICE_BUCKETS, PRICED, combinedDensity};

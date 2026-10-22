/**
 * First Aha: where restaurants are densest — the top three แขวง/ตำบล.
 *
 * Metric: restaurants per km² of the subdistrict (density.area; denominator =
 * production areaSqm). Eligibility (declared, not a weight): only areas with at
 * least MIN_AREA_ROWS rows in the current selection compete, so a 0.2 km²
 * subdistrict with a handful of rows cannot top the list on noise.
 * The three areas' combined density is Σrows ÷ Σkm²; the comparison is the
 * whole selection over the area the dataset covers (every subdistrict that
 * holds at least one row in the full dataset) — a ratio of raw totals.
 *
 * Small selections (fewer than SMALL_SELECTION rows, e.g. one chain) switch to
 * a count Aha: the three areas holding the most rows, with their share of the
 * selection. Snapshot values in the handoff JSON are regression fixtures,
 * never UI constants.
 */
import {summarizeAreas, byDensity, byCount, combinedDensity} from './areas.js';

export const MIN_AREA_ROWS = 30;
export const SMALL_SELECTION = 1000;

/** Area of the dataset's coverage: subdistricts with ≥ 1 row in the full dataset. */
export function coverageKm2(allRows, index) {
  const ids = new Set(allRows.map(r => r.area));
  let total = 0;
  for (const id of ids) total += index.byId.get(id)?.km2 || 0;
  return {areas: ids.size, km2: total};
}

export function summarizeAreaInsight(rows = [], index, {minRows = MIN_AREA_ROWS, coverage = null} = {}) {
  const selected = Array.isArray(rows) ? rows : [];
  const summaries = summarizeAreas(selected, index);
  const eligible = summaries.filter(a => a.count >= minRows);
  const mode = selected.length >= SMALL_SELECTION && eligible.length >= 3 ? 'density' : 'count';
  const ranked = mode === 'density' ? eligible.sort(byDensity) : summaries.sort(byCount);
  const areas = ranked.slice(0, 3);
  const combined = combinedDensity(areas);
  const baseline = coverage && coverage.km2 ? selected.length / coverage.km2 : null;
  // Secondary finding: the area holding the most reviews (popularity proxy, rows with a review count only).
  const mostReviewed = summaries.filter(a => a.reviews > 0).sort((a, b) => b.reviews - a.reviews || String(a.id).localeCompare(String(b.id)))[0] || null;
  return {
    mode, minRows, areas, areaIds: areas.map(a => a.id),
    count: combined.count, km2: combined.km2, density: combined.density,
    baselineDensity: baseline, coverageKm2: coverage?.km2 || null, coverageAreas: coverage?.areas || null,
    ratio: baseline && combined.density ? combined.density / baseline : null,
    share: selected.length ? (combined.count / selected.length) * 100 : 0,
    totalRows: selected.length, areaCount: summaries.length, eligibleCount: eligible.length,
    mostReviewed: mostReviewed ? {id: mostReviewed.id, name: mostReviewed.name, province: mostReviewed.province, reviews: mostReviewed.reviews, count: mostReviewed.count} : null,
  };
}

/** Rows inside a set of area ids (membership = the row's own source subdistrict). */
export function filterAreaRows(rows, areaIdsSet) {
  if (!(areaIdsSet instanceof Set) || !areaIdsSet.size) return [];
  return (Array.isArray(rows) ? rows : []).filter(r => areaIdsSet.has(r.area));
}

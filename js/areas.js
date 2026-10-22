/**
 * Administrative areas of the dataset: แขวง/ตำบล (SUBDISTRICT, the analytical
 * unit), เขต/อำเภอ (DISTRICT) and จังหวัด (PROVINCE), all from CityMETER
 * production boundaries (data/areas.geojson, districts.geojson, provinces.geojson).
 *
 * Membership is the source's own: every row carries the subdistrict code the
 * public API counted it in (ST_Contains on the source coordinate). Nothing is
 * re-assigned by name or by the displayed (quantized) point, so area counts
 * reconcile exactly with the production aggregates.
 *
 * Density = rows ÷ production areaSqm (km²) — a ratio of raw totals per area;
 * combined densities of several areas are Σrows ÷ Σkm², never an average of
 * per-area ratios.
 */
const km2 = sqm => (Number.isFinite(sqm) && sqm > 0 ? sqm / 1e6 : null);

export function buildAreaIndex(areas, districts, provinces) {
  const byId = new Map(), byDistrict = new Map(), districtById = new Map(), provinceById = new Map();
  for (const f of areas?.features || []) {
    const p = f.properties || {}, id = String(f.id ?? p.id);
    const area = {id, uuid: p.uuid, name: p.name, nameEn: p.nameEn || '', district: p.district, districtName: p.districtName,
      province: p.province, km2: km2(p.areaSqm), label: Array.isArray(p.label) ? p.label : null, feature: f};
    byId.set(id, area);
    if (!byDistrict.has(p.district)) byDistrict.set(p.district, []);
    byDistrict.get(p.district).push(area);
  }
  for (const f of districts?.features || []) {
    const p = f.properties || {}, id = String(f.id ?? p.id);
    districtById.set(id, {id, uuid: p.uuid, name: p.name, nameEn: p.nameEn || '', province: p.province, km2: km2(p.areaSqm), label: p.label || null, feature: f, areas: byDistrict.get(id) || []});
  }
  for (const f of provinces?.features || []) {
    const p = f.properties || {}, id = String(f.id ?? p.id);
    provinceById.set(id, {id, code: id, dopa: p.code, uuid: p.uuid, name: p.name, nameEn: p.nameEn, km2: km2(p.areaSqm), label: p.label || null, feature: f});
  }
  return {byId, districtById, provinceById, areas: [...byId.values()], districts: [...districtById.values()], provinces: [...provinceById.values()]};
}

/** District label for a subdistrict/district in Bangkok (เขต/แขวง) vs elsewhere (อำเภอ/ตำบล). */
export const levelWords = province => (province === 'BKK' ? {district: 'เขต', area: 'แขวง'} : {district: 'อำเภอ', area: 'ตำบล'});
export const areaWord = province => levelWords(province).area;
export const districtWord = province => levelWords(province).district;

/** Group rows by a key function into Map<key, rows[]>. */
function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) { const k = key(r); let a = m.get(k); if (!a) m.set(k, a = []); a.push(r); }
  return m;
}

function stats(rows) {
  let reviews = 0, reviewed = 0, ratingSum = 0, rated = 0;
  for (const r of rows) {
    if (Number.isFinite(r.reviews)) { reviews += r.reviews; reviewed++; }
    if (Number.isFinite(r.rating)) { ratingSum += r.rating; rated++; }
  }
  return {reviews, reviewed, rated, ratingMean: rated ? ratingSum / rated : null};
}

/**
 * Per-area summaries for `rows`. With includeEmpty, every frame of `index`
 * (optionally limited to `within` province/district) is listed, zero included.
 */
export function summarizeAreas(rows, index, {includeEmpty = false, province = '', district = ''} = {}) {
  const grouped = groupBy(rows, r => r.area);
  const list = [];
  for (const area of index.areas) {
    if (province && area.province !== province) continue;
    if (district && area.district !== district) continue;
    const members = grouped.get(area.id) || [];
    if (!includeEmpty && !members.length) continue;
    const s = stats(members);
    list.push({...area, rows: members, count: members.length, density: area.km2 ? members.length / area.km2 : null, ...s});
  }
  return list;
}

export function summarizeDistricts(rows, index, {includeEmpty = false, province = ''} = {}) {
  const grouped = groupBy(rows, r => r.district);
  const list = [];
  for (const d of index.districts) {
    if (province && d.province !== province) continue;
    const members = grouped.get(d.id) || [];
    if (!includeEmpty && !members.length) continue;
    list.push({...d, rows: members, count: members.length, density: d.km2 ? members.length / d.km2 : null, ...stats(members)});
  }
  return list;
}

/** Stable ordering by density (desc), then rows, then id. */
export const byDensity = (a, b) => (b.density ?? -1) - (a.density ?? -1) || b.count - a.count || String(a.id).localeCompare(String(b.id));
export const byCount = (a, b) => b.count - a.count || (b.density ?? -1) - (a.density ?? -1) || String(a.id).localeCompare(String(b.id));

/** Combined density of several areas: Σrows ÷ Σkm² (raw totals, not an average of ratios). */
export function combinedDensity(areas) {
  const count = areas.reduce((s, a) => s + a.count, 0), area = areas.reduce((s, a) => s + (a.km2 || 0), 0);
  return {count, km2: area, density: area ? count / area : null};
}

/**
 * Point → แขวง/ตำบล id on the CityMETER frames, for DISPLAY only (where to anchor a label that is on
 * screen). Never membership: a row's area is always its own source code (INV02).
 */
export function areaLocator(index) {
  const inRing = ([x, y], ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const items = index.areas.map(a => {
    const g = a.feature?.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of polys) for (const [x, y] of p[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    return {id: a.id, polys, w, s, e, n};
  });
  return ([x, y]) => {
    for (const it of items) {
      if (x < it.w || x > it.e || y < it.s || y > it.n) continue;
      if (it.polys.some(p => inRing([x, y], p[0]) && !p.slice(1).some(h => inRing([x, y], h)))) return it.id;
    }
    return '';
  };
}

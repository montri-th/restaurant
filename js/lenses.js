/**
 * First-Aha lenses (owner 2026-11-03 “สลับดูได้ 3 มุม”): the overview opens on national chains and switches, one tap
 * each, to restaurants that start at 1,000 baht and to plain density. Pure: no DOM.
 *
 * A lens is a filter preset, so the map's density, the ranking, the chain list and the Aha all read the same rows. It is
 * active exactly when the type / price / size filters equal its preset and no search, province or chain narrows the
 * scope. The default lens opens only on a bare URL (no known parameter); every other link keeps what it names.
 */

export const LENSES = Object.freeze([
  // label: the eyebrow and the chip's accessible name; short: the chip itself (one row at 390 px).
  Object.freeze({id: 'chains', label: 'เครือระดับชาติ', short: 'เครือระดับชาติ', preset: Object.freeze({size: 'S5'}), pictogram: 'brand'}),
  Object.freeze({id: 'premium', label: 'ร้าน 1,000+ บาท', short: '1,000+ บาท', preset: Object.freeze({price: 'P6'}), pictogram: 'price'}),
  Object.freeze({id: 'density', label: 'แน่นที่สุด', short: 'แน่นที่สุด', preset: Object.freeze({}), pictogram: 'gla'}),
]);
export const DEFAULT_LENS = 'chains';
const LENS_FIELDS = ['group', 'food', 'price', 'size'];
const SCOPE_FIELDS = ['search', 'province', 'brand'];

/** Lens chips are offered on the national overview: no search, province or chain narrows it. */
export const lensesOffered = (f = {}) => !SCOPE_FIELDS.some(k => f[k]);

/** The lens the filters show, or null (a type filter, a mixed preset, a search, a province or a chain is no lens). */
export function lensOf(f = {}) {
  if (!lensesOffered(f)) return null;
  const hit = LENSES.find(l => LENS_FIELDS.every(k => (f[k] || '') === (l.preset[k] || '')));
  return hit ? hit.id : null;
}

/** The type / price / size values that open a lens (nothing else changes), or null for an unknown id. */
export function lensFilters(id) {
  const l = LENSES.find(x => x.id === id);
  return l ? Object.fromEntries(LENS_FIELDS.map(k => [k, l.preset[k] || ''])) : null;
}

/** What makes a row part of a lens (the same test as its preset filter). */
export const LENS_TEST = Object.freeze({chains: r => r.size === 'S5', premium: r => r.price === 'P6'});

/**
 * The lens's rows among every framed row of the given areas, beside the same share over every framed row of the
 * population (“26.9 % of the restaurants in these three are national chains; 9.4 % everywhere”). `rows` is the whole
 * population, unfiltered; a row without a แขวง/ตำบล frame is in neither count (as in the density baseline).
 */
export function lensShare(rows, areaIds, test) {
  const ids = new Set(areaIds || []);
  let inside = 0, hit = 0, all = 0, allHit = 0;
  for (const r of rows || []) {
    if (!r.area) continue;
    const yes = Boolean(test(r));
    all++; if (yes) allHit++;
    if (ids.has(r.area)) { inside++; if (yes) hit++; }
  }
  return {count: hit, total: inside, share: inside ? (hit / inside) * 100 : null,
    baselineCount: allHit, baselineTotal: all, baseline: all ? (allHit / all) * 100 : null};
}

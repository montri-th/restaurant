/**
 * Breadcrumb — ประเทศไทย › จังหวัด › เขต/อำเภอ › แขวง/ตำบล — the CityMETER
 * production hierarchy.
 *
 * Production routes (observed in the landometer.com/v3 bundle, 2026-10-22:
 * ViewMode = {D, S, M, L}; lv1 = province abbrEn, lv2 = one typed level):
 *   /v3/citymeter/{abbrEn}?d=restaurant            e.g. BKK
 *   /v3/citymeter/{abbrEn}/D/{district code}       เขต/อำเภอ (DOPA code, e.g. 1039)
 *   /v3/citymeter/{abbrEn}/S/{subdistrict code}    แขวง/ตำบล (e.g. 103902)
 * The demo is static, so it serialises the same ids as query parameters:
 * ?province=BKK&district=1039&area=103902 — every crumb also carries the
 * production deep link.
 *
 * Venues are not an administrative level here: a restaurant's link to a venue is
 * its own name mentioning the venue (a candidate, not a location), so a venue
 * crumb never sits under a แขวง. Venue mode reads ประเทศไทย › [จังหวัด] › venue;
 * a store is the panel heading, never a crumb — its crumbs are its own source
 * subdistrict, district and province.
 */
import {provinceByCode, productionLink} from './model.js';
import {levelWords} from './areas.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/**
 * Pure model. province = production code or ''; district/area = index records or null;
 * venue = {id, name, province} for venue mode or null.
 */
export function buildBreadcrumb({province = '', district = null, area = null, venue = null} = {}) {
  const crumbs = [{level: 'country', label: 'ประเทศไทย', action: 'crumb-country', href: productionLink()}];
  const code = area?.province || district?.province || province || venue?.province || '';
  const p = provinceByCode(code);
  if (p) crumbs.push({level: 'province', label: p.th, id: p.code, action: 'crumb-province', href: productionLink({province: p.code})});
  if (!venue) {
    const d = district || null;
    const w = levelWords(code);
    if (area) {
      crumbs.push({level: 'district', label: `${w.district}${area.districtName}`, id: area.district, action: 'crumb-district', href: productionLink({province: code, district: area.district})});
      crumbs.push({level: 'area', label: `${w.area}${area.name}`, id: area.id, action: 'crumb-area', href: productionLink({province: code, area: area.id})});
    } else if (d) {
      crumbs.push({level: 'district', label: `${w.district}${d.name}`, id: d.id, action: 'crumb-district', href: productionLink({province: code, district: d.id})});
    }
  } else {
    crumbs.push({level: 'venue', label: venue.name, id: venue.id, action: 'crumb-venue'});
  }
  crumbs[crumbs.length - 1].current = true;
  return crumbs;
}

/**
 * HTML for the panel header; the last crumb is the current level (aria-current).
 * With four or more levels the upper ones fold behind “…” on narrow screens.
 */
export function renderBreadcrumb(crumbs) {
  const collapsible = crumbs.length >= 4;
  const items = crumbs.map((c, i) => {
    const fold = collapsible && i < crumbs.length - 2;
    const inner = c.current
      ? `<span class="crumb is-current" aria-current="location">${esc(c.label)}</span>`
      : `<button type="button" class="crumb" data-action="${esc(c.action)}" data-id="${esc(c.id || '')}">${esc(c.label)}</button>`;
    return `<li${fold ? ' class="is-collapsible"' : ''}>${inner}</li>`;
  });
  if (collapsible) items.splice(crumbs.length - 2, 0, '<li class="crumb-ellipsis"><button type="button" class="crumb crumb-more" data-action="crumb-expand" aria-expanded="false" aria-label="แสดงระดับบน">…</button></li>');
  return `<ol class="crumbs${collapsible ? ' is-collapsible' : ''}">${items.join('')}</ol>`;
}

/** Compact text form for the mobile map card and the document title. */
export const breadcrumbText = crumbs => crumbs.map(c => c.label).join(' › ');

/** Production deep link of the deepest administrative crumb (for “ดูใน CityMETER”). */
export const productionHref = crumbs => [...crumbs].reverse().find(c => c.href)?.href || productionLink();

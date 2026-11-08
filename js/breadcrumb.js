/**
 * Breadcrumb — ประเทศไทย › จังหวัด › เขต/อำเภอ › แขวง/ตำบล, or ประเทศไทย › จังหวัด › {สถานที่} — the CityMETER
 * production hierarchy, through the shared shell (js/shell/breadcrumb.js, citymeter-shell 0.4.0). Every
 * administrative crumb carries its production deep link `/v3/citymeter/{province}[/D/{district} | /S/{subdistrict}]?d=restaurant`.
 * A place (venue) is the last crumb in venue mode, with no production link; a store is the panel heading, never a
 * crumb — its crumbs are its own matched subdistrict, district and province.
 */
import {provinceByCode} from './model.js';
import {levelWords} from './areas.js';
import {buildBreadcrumb as shellBreadcrumb, renderBreadcrumb, breadcrumbText, deepestHref} from './shell/breadcrumb.js';

/** Production dataset code (`?d=`). */
export const DATASET = 'restaurant';
const CTX = {dataset: DATASET, provinceByCode, areaWord: p => levelWords(p).district, subWord: p => levelWords(p).area};

/** Pure model. province = production code or ''; district / area (subdistrict) = index records; venue = {id, name, province}. */
export const buildBreadcrumb = ({province = '', district = null, area = null, venue = null} = {}) =>
  shellBreadcrumb(venue ? {province, site: venue} : {province, area: area ? null : district, sub: area}, CTX);
export {renderBreadcrumb, breadcrumbText};

/** Production deep link of the deepest administrative crumb (for “ดูใน CityMETER”). */
export const productionHref = crumbs => deepestHref(crumbs, DATASET);

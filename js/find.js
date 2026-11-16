/**
 * What the search box of CityMETER · Restaurants knows by name: the entries js/shell/fuzzy.js matches and
 * js/shell/search.js lists (release 0.14.0; owner 2026-11-12 12:05, VERBATIM: “ศึกษาแนวคิดเรื่อง Fuzzy search แล้ว
 * implement กับ demo web ให้ได้ user benefit สูงสุดตาม user intent ในขณะนั้น และตาม product statement”).
 *
 * The product statement reads where restaurants and chain outlets are, by area, by chain and by the place that hosts
 * them. So a name typed here opens the level that answers it: a province, a เขต/อำเภอ or a แขวง/ตำบล (its
 * restaurants), a chain (its page), a company (its chains), a restaurant type (its filter), a place (the restaurants
 * in it), or one restaurant or outlet (its page). The order below is the order among equal matches: places first.
 *
 * Pure: entries from the decoded datasets; no DOM, no numbers shown (a row names what it is and where).
 */
import {areaWord, districtWord} from './areas.js';
import {PROVINCE_AKA, withoutMueang} from './shell/fuzzy.js';

export const SEARCH_KINDS = Object.freeze([
  {id: 'province', level: 'province', auto: true}, {id: 'district', level: 'district', auto: true}, {id: 'area', level: 'subdistrict', auto: true},
  {id: 'chain', auto: true}, {id: 'company', auto: true}, {id: 'group', auto: true}, {id: 'venue'}, {id: 'store'},
]);
/** Words a name may begin with, or carry, that people add or leave out; an array is one word said two ways. */
export const SEARCH_HEADS = Object.freeze([['ร้านอาหาร', 'ร้าน'], 'restaurant', 'the']);
/** What to try when nothing is found: the kinds of name this demo knows. */
export const SEARCH_HINT = 'ลองชื่อร้าน เครือ สถานที่ แขวง/ตำบล เขต/อำเภอ หรือจังหวัด';

/**
 * Every entry, the places and filters first, then the places that host restaurants, then the restaurants and the
 * chain outlets. `chains` is js/chains.js#buildChainIndex, `register` the chain register (both may be missing).
 */
export function* searchEntries({data, index, chains = null, register = null}) {
  const P = index.provinceById;
  for (const p of P.values()) yield {id: p.code, kind: 'province', name: p.name, nameEn: p.nameEn, aka: PROVINCE_AKA[p.name], codes: [p.code, p.dopa], province: p.code};
  const ofDistrict = new Map(), ofArea = new Map(), ofProvince = new Map();
  for (const d of index.districtById.values()) {
    const p = P.get(d.province);
    ofDistrict.set(d.id, [d.name, d.nameEn, p?.name, p?.nameEn]);
    yield {id: d.id, kind: 'district', name: d.name, nameEn: d.nameEn, also: withoutMueang(d.name), codes: [d.id], within: [p?.name, p?.nameEn], province: d.province};
  }
  for (const a of index.byId.values()) {
    const p = P.get(a.province), d = index.districtById.get(a.district);
    ofArea.set(a.id, [a.name, a.nameEn, d?.name, d?.nameEn, p?.name, p?.nameEn]);
    yield {id: a.id, kind: 'area', name: a.name, nameEn: a.nameEn, codes: [a.id], within: ofDistrict.get(a.district) || [p?.name, p?.nameEn], province: a.province, area: a.id};
  }
  // A chain as the page names it, also by the name its register or its candidates carry.
  for (const c of chains?.list || []) yield {id: c.key, kind: 'chain', name: c.name, aka: [c.register?.name, ...c.candidates.map(x => x.name)], weight: c.count};
  for (const c of register?.companies || []) if (register.byCompany.has(c.id)) yield {id: c.id, kind: 'company', name: c.name, aka: [c.legal], weight: c.outlets || 0};
  for (const g of data.groups) yield {id: g.id, kind: 'group', name: g.th, nameEn: g.en, aka: [g.short]};
  for (const v of data.venues) if (v.rows > 0) yield {id: v.id, kind: 'venue', name: v.name, weight: v.rows, venue: v};
  for (const r of data.rows) {
    let within = r.area ? ofArea.get(r.area) : r.district ? ofDistrict.get(r.district) : ofProvince.get(r.province);
    if (!within) { const p = P.get(r.province); within = [p?.name, p?.nameEn]; ofProvince.set(r.province, within); }
    // Among equal names the one more people have rated comes first; the count is never shown here.
    yield {id: r.id, kind: 'store', name: r.name, within, province: r.province, area: r.area, weight: r.reviews || 0, row: r};
  }
}

/** The line under a name in the list: what it is and where. Thai; an English page translates it part by part. */
export function searchNote(entry, {index, data}) {
  const province = code => index.provinceById.get(code)?.name || '';
  if (entry.kind === 'province') return 'จังหวัด';
  if (entry.kind === 'district') return [districtWord(entry.province), province(entry.province)].filter(Boolean).join(' · ');
  if (entry.kind === 'area') return [areaWord(entry.province), index.byId.get(entry.id)?.districtName, province(entry.province)].filter(Boolean).join(' · ');
  if (entry.kind === 'chain') return 'เครือร้าน';
  if (entry.kind === 'company') return 'บริษัทเจ้าของเครือ';
  if (entry.kind === 'group') return 'ประเภทร้าน';
  if (entry.kind === 'venue') return ['สถานที่', entry.venue.typeTh].filter(Boolean).join(' · ');
  const r = entry.row, d = r.district ? index.districtById.get(r.district) : null;
  return [data.groups[r.group]?.short, d?.name, province(r.province)].filter(Boolean).join(' · ');
}

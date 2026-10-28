/**
 * National chain-restaurant register (data/chains.json — the owner's research master
 * “CityMETER Chain Restaurants Thailand”, built by scripts/build-chains.py).
 *
 * Counting unit of the register: one outlet_id per branch / point of sale with
 * qualifying evidence (incl. carts and delivery kitchens with their own status) —
 * not a field count of open shops. It is a different unit and a different source
 * from the restaurant snapshot, so its counts are never added to the snapshot's
 * (and the snapshot's 70,214 rows already include the 1,234 chain-portfolio rows
 * the owner moved to the register on 2026-10-25, each counted once).
 *
 * Derived fields say how they were derived: province from the province polygon that
 * holds the outlet point (or the register's province text), แขวง/ตำบล from the
 * subdistrict polygon (seven covered provinces only). Outlets without a selected
 * coordinate keep none — never a host or map centroid.
 */
export const EVIDENCE = Object.freeze(['primary', 'secondary', 'cart']);
export const EVIDENCE_TH = Object.freeze({primary: 'แหล่งของแบรนด์ บริษัท หรือสถานที่', secondary: 'แหล่งรอง รอยืนยันจากแบรนด์', cart: 'จุดขายรถเข็น'});
/** Short labels for bars (the full label stays in the bar's title and on every outlet). */
export const EVIDENCE_SHORT = Object.freeze({primary: 'แหล่งของแบรนด์', secondary: 'แหล่งรอง', cart: 'จุดขายรถเข็น'});
export const STATUS = Object.freeze(['listed', 'pending', 'temporary', 'closed']);
export const STATUS_TH = Object.freeze({listed: 'แหล่งข้อมูลระบุสาขา ยังไม่ยืนยันภาคสนาม', pending: 'รอยืนยันจากแบรนด์หรือการเปิดปัจจุบัน',
  temporary: 'แหล่งข้อมูลระบุปิดชั่วคราว', closed: 'แหล่งข้อมูลระบุปิดหรือไม่ใช้งาน ยังไม่ยืนยัน'});
export const GEO = Object.freeze(['brand', 'other', 'host']);
export const GEO_TH = Object.freeze({brand: 'จุดจากเว็บหรือแอปของแบรนด์/บริษัท ไม่ใช่ผลสำรวจ', other: 'จุดจากแหล่งข้อมูลอื่น ไม่ใช่ผลสำรวจ', host: 'จุดอ้างอิงของสถานที่ ไม่ใช่หน้าร้าน'});

const lower = v => String(v || '').toLocaleLowerCase('th-TH');

/**
 * Decode data/chains.json. `index` (js/areas.js#buildAreaIndex) resolves the subdistrict
 * code to its district; the register's own area list must match the frame set.
 */
export function decodeRegister(json, index = null) {
  if (!json?.cols || !Array.isArray(json.cols.id)) throw new Error('Invalid chain register');
  const c = json.cols, n = c.id.length;
  const provinces = (json.provinces || []).map((p, i) => ({...p, index: i}));
  const companies = (json.companies || []).map((x, i) => ({...x, index: i, kind: 'company'}));
  const brands = (json.brands || []).map((b, i) => ({...b, index: i, kind: 'register-brand', companyRecord: companies[b.company] || null}));
  const urls = json.urls || [];
  const outlets = [];
  for (let i = 0; i < n; i++) {
    const area = c.area[i] >= 0 ? json.areas[c.area[i]] : '';
    const a = area && index ? index.byId.get(area) : null;
    const p = provinces[c.prov[i]] || null;
    const brand = brands[c.brand[i]];
    const o = {
      index: i, id: c.id[i], name: c.name[i] || '', brand, company: companies[c.company[i]] || null,
      longitude: c.lon[i], latitude: c.lat[i], hasPoint: Number.isFinite(c.lat[i]) && Number.isFinite(c.lon[i]),
      province: p?.code || '', provinceTh: p?.th || '', provinceBy: c.provBy[i] === 1 ? 'point' : c.provBy[i] === 2 ? 'text' : '',
      area, district: a?.district || '', coveredProvince: a?.province || '',
      evidence: EVIDENCE[c.ev[i]] || 'primary', status: STATUS[c.st[i]] || 'listed', geo: GEO[c.geo[i]] || '',
      floor: c.floor[i] || '', unit: c.unit[i] || '', address: c.addr[i] || '', source: urls[c.src[i]] || '', checked: c.checked[i] || '',
    };
    o.haystack = lower([o.name, brand?.name, o.company?.name, o.address].filter(Boolean).join(' '));
    o.nameLower = lower(o.name);
    outlets.push(o);
  }
  const byId = new Map(outlets.map(o => [o.id, o]));
  const group = key => { const m = new Map(); for (const o of outlets) { const k = key(o); if (k === '' || k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(o); } return m; };
  return {meta: json.meta || {}, provinces, companies, brands, outlets, byId,
    brandById: new Map(brands.map(b => [b.id, b])), companyById: new Map(companies.map(x => [x.id, x])),
    byBrand: group(o => o.brand?.id), byCompany: group(o => o.company?.id), byArea: group(o => o.area), byDistrict: group(o => o.district),
    byProvince: group(o => o.province)};
}

/** Brands present in a list of outlets, most outlets first. */
export function brandsIn(outlets, limit = 12) {
  const m = new Map();
  for (const o of outlets) { const e = m.get(o.brand.id) || {brand: o.brand, count: 0}; e.count++; m.set(o.brand.id, e); }
  return [...m.values()].sort((a, b) => b.count - a.count || a.brand.name.localeCompare(b.brand.name)).slice(0, limit);
}

/** Companies present in a list of outlets, most outlets first (outlets without a company are skipped). */
export function companiesIn(outlets, limit = 8) {
  const m = new Map();
  for (const o of outlets) { if (!o.company) continue; const e = m.get(o.company.id) || {company: o.company, count: 0, brands: new Set()}; e.count++; e.brands.add(o.brand.id); m.set(o.company.id, e); }
  return [...m.values()].map(e => ({...e, brands: e.brands.size})).sort((a, b) => b.count - a.count || a.company.name.localeCompare(b.company.name)).slice(0, limit);
}

/** Outlets by province (unknown province listed apart, never as a province). */
export function provincesIn(outlets, provinces) {
  const m = new Map();
  let unknown = 0;
  for (const o of outlets) { if (!o.province) { unknown++; continue; } m.set(o.province, (m.get(o.province) || 0) + 1); }
  const byCode = new Map(provinces.map(p => [p.code, p]));
  return {list: [...m.entries()].map(([code, count]) => ({province: byCode.get(code), count})).sort((a, b) => b.count - a.count), unknown};
}

/** Evidence / status / coordinate mix of a list of outlets. */
export function outletMix(outlets) {
  const evidence = Object.fromEntries(EVIDENCE.map(k => [k, 0])), status = Object.fromEntries(STATUS.map(k => [k, 0]));
  let withPoint = 0;
  for (const o of outlets) { evidence[o.evidence]++; status[o.status]++; if (o.hasPoint) withPoint++; }
  return {count: outlets.length, withPoint, evidence, status};
}

/**
 * Search the register: brands and companies whose name holds the query first, then the brands of outlets whose name
 * holds it (Thai branch names live on the outlets; brand names are often English).
 */
export function searchRegister(reg, query, limit = 30) {
  const q = lower(query).trim();
  if (!q) return {brands: reg.brands.slice().sort((a, b) => b.outlets - a.outlets).slice(0, limit), companies: []};
  // Brand name first (prefix before substring), then the brand family, then the company that holds it.
  const rank = b => { const n = lower(b.name); return n.startsWith(q) ? 0 : n.includes(q) ? 1 : lower(b.family).includes(q) ? 2 : lower(b.companyRecord?.name).includes(q) ? 3 : 9; };
  const direct = reg.brands.map(b => [b, rank(b)]).filter(([, r]) => r < 9).sort((a, b) => a[1] - b[1] || b[0].outlets - a[0].outlets).map(([b]) => b);
  // Then brands whose outlet names hold the query (not addresses: “ข้าง KFC” is a neighbour), most matching outlets first.
  const seen = new Set(direct.map(b => b.id)), byName = new Map();
  for (const o of reg.outlets) if (!seen.has(o.brand.id) && o.nameLower.includes(q)) byName.set(o.brand, (byName.get(o.brand) || 0) + 1);
  const viaOutlets = [...byName].sort((a, b) => b[1] - a[1] || b[0].outlets - a[0].outlets).map(([b]) => b);
  const companies = reg.companies.filter(x => lower(x.name).includes(q) || lower(x.legal).includes(q));
  return {brands: [...direct, ...viaOutlets].slice(0, limit), companies: companies.sort((a, b) => b.outlets - a.outlets).slice(0, 10)};
}

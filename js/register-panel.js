/**
 * Reading-panel views of the chain register and the Land hosts. Pure: HTML strings, no DOM or map.
 *
 * Wording contract (owner rules + register README):
 *  - a register outlet is “สาขาในทะเบียน” — a listed branch / point of sale with evidence, not a
 *    field-verified open shop; its counts are never added to the restaurant snapshot (different unit);
 *  - a company role is not the operator of every outlet; a brand's completeness is never claimed;
 *  - a point inside a Land building is “จุดตกในอาคาร” — never “ตั้งอยู่ใน”, tenancy or floor;
 *  - missing stays missing: an outlet without a coordinate has none, an unknown province is “ไม่ระบุจังหวัด”.
 * Actions (delegated, data-action): open-chains · select-chain · select-company · select-outlet · select-land ·
 * select-store · select-area · select-venue · filter-brand · back.
 */
import {esc, num, dec, link, thaiDate, metricTile, heading} from './panel.js';
import {brandLogoMarkup, getBrandLogo} from './brand-logos.js';
import {cueMarkup} from './cues.js';
import {areaWord, districtWord} from './areas.js';
import {EVIDENCE, EVIDENCE_TH, EVIDENCE_SHORT, STATUS_TH, GEO_TH} from './register.js';
import {RELATION_TH} from './land.js';

const REGISTER_NOTE = 'สาขา = รายการในทะเบียนที่มีหลักฐานรายสาขา ไม่ใช่จำนวนร้านที่เปิดอยู่จริง และนับคนละหน่วยกับร้านในชุดข้อมูล CityMETER Restaurants จึงไม่นำมาบวกกัน';
const LAND_NOTE = 'จุดตกในอาคาร = จุดของร้าน (ร้านใน CityMETER Restaurants ละเอียดราว 9.55 ม.) อยู่ภายในขอบอาคาร ไม่ได้ยืนยันว่าร้านตั้งอยู่ในอาคาร อยู่ชั้นใด หรือเป็นผู้เช่า';

const DATA_NOTE = 'ร้าน = รายการในชุดข้อมูล CityMETER Restaurants ไม่ใช่จำนวนร้านทั้งหมดของพื้นที่หรืออาคาร';
/** A share is printed only for a column of at least this many rows (the same floor as the density ranking). */
export const MIN_SHARE_ROWS = 30;

/** Dates of the three inputs, set once the extras load (app.js) — every register / Land number cites its own. */
let SOURCES = {snapshot: '2026-10-22', registerFrom: '2026-10-25', registerTo: '2026-10-28', land: '2026-10-28'};
export function setSourceDates(dates = {}) { SOURCES = {...SOURCES, ...Object.fromEntries(Object.entries(dates).filter(([, v]) => v))}; }

const checkedRange = (meta = {}) => {
  const a = thaiDate(meta?.checkedFrom || SOURCES.registerFrom), b = thaiDate(meta?.checkedTo || SOURCES.registerTo);
  return a && b && a !== b ? `${a}–${b}` : b || a || '';
};
const foot = compact => (compact ? 'hint source-line' : 'hint panel-foot provenance');

/** Every register view and register section ends with dataset · source · date · boundary. */
export function registerProvenance(meta = {}, boundary = 'ประเทศไทย', note = REGISTER_NOTE, {compact = false} = {}) {
  return `<p class="${foot(compact)}"><span>ชุดข้อมูล ทะเบียนร้านเครือ (CityMETER Chain Restaurants · ทะเบียนวิจัยของ Landometer)</span> · <span>แหล่ง เว็บและแอปของแบรนด์ บริษัท สถานที่ และแหล่งรองตามรายสาขา</span> · <span>ตรวจ ${esc(checkedRange(meta))}</span> · <span>ขอบเขต ${esc(boundary)}</span>${note ? `<br>${esc(note)}` : ''}</p>`;
}

/** Land numbers mix three inputs: name each with its date (restaurants, register outlets, building shapes). */
export function landProvenance(meta = {}, boundary = '', {compact = false, note = LAND_NOTE} = {}) {
  return `<p class="${foot(compact)}"><span>ชุดข้อมูล ทะเบียน Land (ศูนย์การค้า โรงแรม อาคารสำนักงาน) × CityMETER Restaurants และทะเบียนร้านเครือ</span> · <span>แหล่ง ร้าน: CityMETER Restaurants API สาธารณะ ดึง ${esc(thaiDate(SOURCES.snapshot))} · สาขา: ทะเบียนร้านเครือ ตรวจ ${esc(checkedRange())} · รูปทรงอาคาร: ทะเบียน Land (OpenStreetMap) และ CityMETER production (V4)</span> · <span>จับคู่ ${esc(thaiDate(meta?.checkedOn || SOURCES.land))}</span> · <span>ขอบเขต ${esc(boundary)}</span>${note ? `<br>${esc(note)}` : ''}</p>`;
}

/** “แสดง n จาก N …”: a list cut at n never shows its length as the total. */
const shownOf = (n, total, unit, order = '') => (total > n ? `<p class="hint">แสดง ${num(n)} จาก ${num(total)} ${unit}${order ? ` (${order})` : ''}</p>` : '');

/** A register record's name for lists: the operator when another record shares the name (KFC is three networks). */
export const brandLabel = b => (b?.sharedName && b.companyRecord ? `${b.name} · ${b.companyRecord.name}` : b?.name || '');
/** Flag beside a record in lists: a multi-banner registry, or a cart / secondary-source majority. */
const brandFlag = b => (b?.registry ? {short: 'หลายแบรนด์', th: 'ทะเบียนจุดขายหลายแบรนด์ ไม่ใช่เครือเดียว'} : b?.evidenceTag || null);

/** The register's completeness note in plain Thai (a code from the research sheet reads as the same claim). */
const completenessTh = v => (!v || v === 'not_attested_current_national_census' ? 'ยังไม่ยืนยันครบทุกสาขาปัจจุบันทั่วประเทศ' : v);
function brandChips(list, {limit = 16, order = 'สาขามากก่อน'} = {}) {
  if (!list.length) return '<p class="hint">ไม่พบสาขาในทะเบียน</p>';
  const chips = list.slice(0, limit).map(c => {
    const flag = brandFlag(c.brand);
    return `<li><button type="button" class="brand-chip" data-action="select-chain" data-id="${esc(c.brand.id)}" title="${esc(brandLabel(c.brand))} — ${num(c.count)} สาขาในทะเบียน${flag ? ` · ${esc(flag.th)}` : ''}">${getBrandLogo(c.brand) ? brandLogoMarkup(c.brand, {size: 'xs', className: 'chip-logo'}) : ''}<span>${esc(brandLabel(c.brand))}</span>${flag ? `<em class="chip-flag">${esc(flag.short)}</em>` : ''}<small class="data-number">${num(c.count)}</small></button></li>`;
  }).join('');
  return `<ul class="chip-list">${chips}</ul>${shownOf(Math.min(limit, list.length), list.length, 'เครือ', order)}`;
}

function brandRows(brands, {count = b => b.outlets, unit = 'สาขา'} = {}) {
  return `<ul class="venue-list">${brands.map(b => `<li><button type="button" class="venue-row${getBrandLogo(b) ? ' has-logo' : ''}" data-action="select-chain" data-id="${esc(b.id)}" aria-label="${esc(b.name)} ${num(count(b))} ${unit}">${brandLogoMarkup(b, {size: 'sm'})}<span class="venue-name">${esc(b.name)}<small>${esc([b.companyRecord?.name || 'ยังไม่ระบุบริษัท', brandFlag(b)?.th || ''].filter(Boolean).join(' · '))}</small></span><span class="venue-count data-number">${num(count(b))}<small>${unit}</small></span></button></li>`).join('')}</ul>`;
}

function outletRows(outlets, {showBrand = true, showPlace = true} = {}) {
  return `<ul class="outlet-list">${outlets.map(o => {
    const place = showPlace ? [o.floor ? `ชั้น ${o.floor}` : '', o.provinceTh || 'ไม่ระบุจังหวัด'].filter(Boolean).join(' · ') : '';
    const meta = [showBrand ? o.brand.name : '', place, o.evidence !== 'primary' ? EVIDENCE_TH[o.evidence] : '', !o.hasPoint ? 'ไม่มีจุดบนแผนที่' : ''].filter(Boolean).join(' · ');
    return `<li><button type="button" class="brand-row" data-action="select-outlet" data-id="${esc(o.id)}">${brandLogoMarkup(o.brand, {size: 'sm'})}<span><strong>${esc(o.name || o.brand.name)}</strong><br><span class="small muted">${esc(meta)}</span></span></button></li>`;
  }).join('')}</ul>`;
}

function shareBars(items, total, {label = 'สาขา'} = {}) {
  const max = Math.max(1, ...items.map(i => i.count));
  return `<ul class="mix-list" aria-label="${esc(label)}">${items.filter(i => i.count > 0).map(i => `
    <li><span class="mix-label" title="${esc(i.title || i.label)}">${esc(i.label)}</span>
      <span class="mix-track" aria-hidden="true"><span class="mix-fill register-fill" style="width:${Math.max(3, Math.round((i.count / max) * 100))}%"></span></span>
      <span class="mix-value data-number" title="${num(i.count)} จาก ${num(total)} ${esc(label)}">${num(i.count)}</span></li>`).join('')}</ul>`;
}

/* ---------- sections inside existing views ---------- */

/** Overview: the register at a glance (separate unit, never summed with the restaurant numbers above). */
export function renderRegisterSummary({meta, brands, chainCount = null, registries = [], loading = false} = {}) {
  if (loading) return `<section class="panel-section register-summary"><div class="section-heading">${heading('brand', 'ทะเบียนร้านเครือ · ทั่วประเทศ')}</div><p class="hint">กำลังโหลดทะเบียนร้านเครือ…</p></section>`;
  if (!meta) return '';
  const chains = chainCount ?? meta.brandsWithOutlets;
  return `<section class="panel-section register-summary" aria-labelledby="register-title">
    <div class="section-heading">${heading('brand', 'ทะเบียนร้านเครือ · ทั่วประเทศ', 'register-title')}<span class="hint">ตรวจ ${esc(checkedRange(meta))}</span></div>
    <p class="register-lede"><strong class="data-number">${num(meta.outlets)}</strong> สาขาในทะเบียน · <strong class="data-number">${num(chains)}</strong> เครือ</p>
    ${registries.length ? `<p class="hint">ไม่นับ ${esc(registries.map(r => `${r.name} (${num(r.outlets)} สาขา)`).join(', '))} เป็นเครือ เพราะเป็นทะเบียนจุดขายหลายแบรนด์ · สาขาของทะเบียนนี้ยังรวมใน ${num(meta.outlets)} สาขา</p>` : ''}
    <p class="hint">${num(Math.min(10, brands.length))} เครือที่มีสาขาในทะเบียนมากที่สุด · จุดสาขาขึ้นบนแผนที่เดียวกับร้านเมื่อซูมถึงระดับเมือง</p>
    ${brandChips(brands.map(b => ({brand: b, count: b.outlets})), {limit: 10})}
    <div class="detail-actions"><button type="button" class="btn" data-action="open-chains">ดูทะเบียนร้านเครือ</button></div>
    ${registerProvenance(meta, 'ประเทศไทย', REGISTER_NOTE, {compact: true})}
  </section>`;
}

/** Area / district: register brands whose outlet points fall in the frame (polygon test on the outlet point). */
export function renderRegisterInArea({outlets, brands, place, meta = {}, loading = false}) {
  if (loading) return `<section class="panel-section"><div class="section-heading">${heading('brand', 'สาขาร้านเครือในทะเบียน')}</div><p class="hint">กำลังโหลดทะเบียนร้านเครือ…</p></section>`;
  if (!outlets) return '';
  const chains = brands.filter(x => !x.brand.registry).length;
  return `<section class="panel-section register-in-area"><div class="section-heading">${heading('brand', 'สาขาร้านเครือในทะเบียน')}<span class="hint">${num(outlets.length)} สาขา · ${num(chains)} เครือ</span></div>
    ${outlets.length ? brandChips(brands) : `<p class="hint">ไม่มีสาขาในทะเบียนที่จุดอยู่ใน${esc(place)}</p>`}
    <div class="detail-actions"><button type="button" class="btn quiet" data-action="open-chains">ดูทะเบียนร้านเครือ</button></div>
    ${registerProvenance(meta, `จุดของสาขาอยู่ใน${place}`, 'คนละชุดข้อมูลกับจำนวนร้านด้านบน ไม่นำมาบวกกัน', {compact: true})}</section>`;
}

/** Area / district / venue: Land hosts with restaurant points in or at the edge of their building. */
/** One row per Land building: main host, other registry names on the same footprint, and — for a nested outline —
 * the listed building whose restaurant points it repeats. */
export function renderLandHostsIn(list, {title = 'อาคารในทะเบียน Land', boundary = '', meta = {}} = {}) {
  if (!list?.length) return '';
  const total = list.total ?? list.length;
  const kind = h => (h.typeTh === h.datasetTh ? h.typeTh : `${h.typeTh} · ${h.datasetTh}`);
  const names = hs => (hs.length > 2 ? `${hs.slice(0, 2).map(h => h.name).join(', ')} และอีก ${num(hs.length - 2)} ชื่อ` : hs.map(h => h.name).join(', '));
  const note = x => [x.cohosts?.length ? `อาคารเดียวกับ ${names(x.cohosts)}` : '', x.repeats ? `นับร้านซ้ำกับ ${x.repeats.host.name} ${num(x.repeats.rows)} ร้าน` : ''].filter(Boolean);
  const repeats = list.some(x => x.repeats);
  return `<section class="panel-section land-hosts"><div class="section-heading">${heading('venue', title)}<span class="hint">${num(total)} อาคาร</span></div>
    <ul class="venue-list">${list.map(x => `<li><button type="button" class="venue-row" data-action="select-land" data-id="${esc(x.host.id)}" aria-label="${esc(x.host.name)} ${num(x.rows)} ร้านจุดตกในหรือติดขอบอาคาร"><span class="venue-name">${esc(x.host.name)}<small>${esc([kind(x.host), ...note(x)].join(' · '))}</small></span><span class="venue-count data-number">${num(x.rows)}<small>ร้าน${x.outlets ? ` · ${num(x.outlets)} สาขาเครือ` : ''}</small></span></button></li>`).join('')}</ul>
    ${shownOf(list.length, total, 'อาคาร', 'ร้านมากก่อน')}
    <p class="hint">ร้าน = จุดตกในหรือติดขอบอาคาร (ร้านตามตัวกรอง) · สาขาเครือ = สาขาในทะเบียนที่จุดตกในหรือติดขอบ นับคนละหน่วย · ชื่อในทะเบียนที่ใช้อาคารเดียวกันรวมเป็นแถวเดียว${repeats ? ' · อาคารที่ซ้อนหรือชิดกันอาจนับร้านเดียวกัน จึงรวมแถวกันไม่ได้' : ''} · ไม่ได้ยืนยันว่าตั้งอยู่ในอาคาร</p>
    ${landProvenance(meta, boundary || 'อาคารในรายการ', {compact: true, note: DATA_NOTE})}</section>`;
}

/** Store panel: the Land building its display point falls in / touches. */
const hostLinks = hosts => hosts.map(h => `<button type="button" class="link-button" data-action="select-land" data-id="${esc(h.id)}">${esc(h.name)}</button> <span class="hint">(${esc(h.typeTh)})</span>`).join(' · ');

export function renderStoreLand(rel) {
  if (!rel?.hosts?.length) return '';
  const also = (rel.also || []).flatMap(x => x.hosts);
  return `<dt>อาคาร Land</dt><dd>${rel.rel === 'in' ? 'จุดตกในอาคารของ' : 'จุดติดขอบอาคารของ'} ${hostLinks(rel.hosts)}${also.length ? `<br>และอยู่ในขอบอาคารของ ${hostLinks(also)} ด้วย` : ''}<br><span class="hint">${rel.rel === 'edge' ? `ห่างขอบ ${dec(rel.d)} ม. · ` : ''}ไม่ได้ยืนยันว่าตั้งอยู่ในอาคาร</span></dd>`;
}

/** Store panel: the register brand(s) the sheet links this name candidate to, and the moved-row status. */
export function renderStoreRegister({row, national = [], register = 0, targets = []}) {
  const parts = [];
  if (national.length) {
    parts.push(`<dt>ทะเบียนเครือ</dt><dd>${national.map(b => `<button type="button" class="link-button" data-action="select-chain" data-id="${esc(b.id)}">${esc(b.name)}</button> <span class="data-number">${num(b.outlets)}</span> สาขาในทะเบียน${b.companyRecord ? ` · ${esc(b.companyRecord.name)}` : ''}`).join('<br>')}<br><span class="hint">ชีตเชื่อมชื่อเครือนี้กับทะเบียน · ร้านนี้ยังเป็นรายการจากชื่อร้าน ไม่ใช่สาขาที่ยืนยันแล้ว</span></dd>`);
  }
  if (register) {
    const t = targets.length ? ` · <button type="button" class="link-button" data-action="select-outlet" data-id="${esc(targets[0].id)}">${register === 2 ? 'สาขาที่ตรงกันในทะเบียน' : 'สาขาที่อาจตรงกันในทะเบียน'}</button>` : '';
    parts.push(`<dt>สถานะ</dt><dd>${register === 2 ? 'ย้ายไปทะเบียนร้านเครือแล้ว และมีรายการสาขาที่ตรงกัน' : 'ย้ายไปทะเบียนร้านเครือแล้ว รอยืนยันเครือและสาขา'}${t}<br><span class="hint">ยังนับเป็น 1 ร้านในชุดข้อมูลนี้ตามเดิม ไม่นับซ้ำ</span></dd>`);
  }
  return parts.join('');
}

/* ---------- register views ---------- */

export function renderChains({reg, query = '', results, mix, area = null, areaOutlets = null, areaBrands = []}) {
  const m = reg.meta, q = String(query || '').trim();
  const ev = EVIDENCE.map(k => ({label: EVIDENCE_SHORT[k], title: EVIDENCE_TH[k], count: mix.evidence[k]}));
  return `<section class="detail-head register">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">ทะเบียนร้านเครือ · ทั่วประเทศ</p>
      <h2>ร้านเครือ ${num(reg.chainCount ?? m.brandsWithOutlets)} เครือ</h2>
      <div class="metrics compact">${metricTile(m.outlets, 'สาขาในทะเบียน', 'store')}${metricTile(mix.withPoint, 'มีจุดบนแผนที่', 'area')}${metricTile(m.companyRecords, 'บริษัท/บทบาท', 'brand')}</div>
      <p class="hint">${esc(REGISTER_NOTE)}${reg.registries?.length ? ` · ไม่นับ ${esc(reg.registries.map(r => r.name).join(', '))} เป็นเครือ (ทะเบียนจุดขายหลายแบรนด์)` : ''} · จุดสาขาอยู่บนแผนที่เดียวกับร้านในชุดข้อมูล</p>
    </section>
    <section class="panel-section"><label class="search-field register-search"><span class="sr-only">ค้นหาชื่อเครือ บริษัท หรือชื่อสาขาในทะเบียน</span><input type="search" id="register-search" value="${esc(query)}" placeholder="ค้นหาชื่อเครือ บริษัท หรือชื่อสาขา" autocomplete="off"></label><p class="hint">ค้นจากชื่อเครือ ชื่อบริษัท และชื่อสาขา ไม่ค้นตามประเภทอาหาร</p></section>
    ${area && areaOutlets ? `<section class="panel-section"><div class="section-heading">${heading('area', `เครือใน${area.label}`)}<span class="hint">${num(areaOutlets.length)} สาขา · ${num(areaBrands.filter(x => !x.brand.registry).length)} เครือ</span></div>${brandChips(areaBrands)}</section>` : ''}
    <section class="panel-section"><div class="section-heading">${heading('brand', q ? `เครือที่ตรงกับ “${q}”` : 'เครือที่มีสาขาในทะเบียนมากที่สุด')}<span class="hint">${q ? `${num(results.brands.length)}${results.brands.length >= 30 ? ' แรก' : ''}` : `${num(results.brands.length)} แรก จาก ${num(reg.chainCount ?? m.brandsWithOutlets)} เครือ`}</span></div>
      ${results.brands.length ? brandRows(results.brands) : '<p class="hint">ไม่พบเครือที่ตรงกับคำค้น · ค้นจากชื่อเครือ ชื่อบริษัท และชื่อสาขาเท่านั้น ไม่ค้นตามประเภทอาหาร</p>'}</section>
    ${results.companies.length ? `<section class="panel-section"><div class="section-heading">${heading('brand', 'บริษัทหรือกลุ่ม')}</div><ul class="venue-list">${results.companies.map(c => `<li><button type="button" class="venue-row" data-action="select-company" data-id="${esc(c.id)}"><span class="venue-name">${esc(c.name)}<small>${num(c.brands)} เครือในทะเบียน</small></span><span class="venue-count data-number">${num(c.outlets)}<small>สาขา</small></span></button></li>`).join('')}</ul></section>` : ''}
    <section class="panel-section"><div class="section-heading">${heading('plain', 'หลักฐานของสาขา')}<span class="hint">ทุกสาขาในทะเบียน</span></div>${shareBars(ev, mix.count)}
      <p class="hint">แหล่งข้อมูลระบุปิดชั่วคราว ${num(mix.status.temporary)} · ระบุปิดหรือไม่ใช้งาน ${num(mix.status.closed)} สาขา (ยังไม่ยืนยัน) · ไม่ระบุจังหวัด ${num(reg.meta.stats?.noProvince || 0)} สาขา</p></section>
    ${registerProvenance(m)}`;
}

export function renderChain({reg, brand, outlets, provinces, mix, area = null, inArea = [], snapshot = null, operators = []}) {
  const logo = getBrandLogo(brand);
  const company = brand.companyRecord;
  const ev = EVIDENCE.map(k => ({label: EVIDENCE_SHORT[k], title: EVIDENCE_TH[k], count: mix.evidence[k]}));
  const rdate = brand.reported?.date || '';
  const reported = brand.reported?.count ? `<p class="hint">แหล่งของบริษัทรายงาน ${esc(brand.reported.count)} สาขา${rdate ? ` (${esc(/^\d{4}-\d{2}-\d{2}$/.test(rdate) ? thaiDate(rdate) : rdate)})` : ''}${brand.reported.source ? ` · ${link(brand.reported.source, 'ที่มา')}` : ''} — ตัวเลขของแหล่ง ไม่ใช่จำนวนในทะเบียน</p>` : '';
  const sorted = [...outlets].sort((a, b) => (a.provinceTh || 'ฮ').localeCompare(b.provinceTh || 'ฮ', 'th') || a.name.localeCompare(b.name, 'th'));
  return `<section class="detail-head store register-brand">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      ${logo ? brandLogoMarkup(brand, {size: 'lg', className: 'detail-logo', decorative: false}) : ''}
      <p class="eyebrow">${brand.registry ? 'ทะเบียนจุดขายหลายแบรนด์ (ไม่ใช่เครือเดียว)' : 'เครือในทะเบียน'}${company ? ` · <button type="button" class="link-button" data-action="select-company" data-id="${esc(company.id)}">${esc(company.name)}</button>` : ''}</p>
      <h2>${esc(brand.name)}</h2>
      ${brand.family && brand.family !== brand.name ? `<p class="subtle">${esc(brand.family)}</p>` : ''}
      <div class="metrics compact">${metricTile(mix.count, 'สาขาในทะเบียน', 'store')}${metricTile(mix.withPoint, 'มีจุดบนแผนที่', 'area')}${metricTile(provinces.list.length, 'จังหวัด', 'province')}</div>
      <p class="hint">ความครบของทะเบียน: ${esc(completenessTh(brand.completeness))}${brand.evidenceTag ? ` · ${esc(brand.evidenceTag.th)}` : ''} · ${esc(REGISTER_NOTE)}</p>
      ${reported}
      <div class="detail-actions">${brand.web ? link(brand.web, 'เว็บของแบรนด์', 'btn quiet source-link') : ''}${snapshot?.count ? `<button type="button" class="btn quiet" data-action="filter-brand" data-value="${esc(snapshot.brand.id)}">ดูร้านใน CityMETER Restaurants ที่ชื่อตรงกัน (${num(snapshot.count)})</button>` : ''}</div>
    </section>
    ${operators.length > 1 ? `<section class="panel-section"><div class="section-heading">${heading('brand', 'แบรนด์เดียวกัน ผู้ดำเนินงานอื่น')}</div>${brandRows(operators.filter(b => b.id !== brand.id))}</section>` : ''}
    ${area ? `<section class="panel-section"><div class="section-heading">${heading('area', `สาขาใน${area.label}`)}<span class="hint">${num(inArea.length)} สาขา</span></div>${inArea.length ? outletRows(inArea.slice(0, 30), {showBrand: false}) : '<p class="hint">ไม่มีสาขาของเครือนี้ที่จุดอยู่ในพื้นที่นี้</p>'}</section>` : ''}
    <section class="panel-section"><div class="section-heading">${heading('province', 'จังหวัดที่มีสาขา')}<span class="hint">${num(provinces.list.length)} จังหวัด</span></div>
      ${shareBars(provinces.list.slice(0, 12).map(p => ({label: p.province.th, count: p.count})), mix.count)}
      ${provinces.list.length > 12 ? `<p class="hint">และอีก ${num(provinces.list.length - 12)} จังหวัด</p>` : ''}${provinces.unknown ? `<p class="hint">ไม่ระบุจังหวัด ${num(provinces.unknown)} สาขา</p>` : ''}</section>
    <section class="panel-section"><div class="section-heading">${heading('plain', 'หลักฐานของสาขา')}</div>${shareBars(ev, mix.count)}
      ${mix.status.temporary || mix.status.closed ? `<p class="hint">แหล่งข้อมูลระบุปิดชั่วคราว ${num(mix.status.temporary)} · ปิดหรือไม่ใช้งาน ${num(mix.status.closed)} สาขา (ยังไม่ยืนยัน)</p>` : ''}
</section>
    <section class="panel-section"><div class="section-heading">${heading('store', 'สาขา')}<span class="hint">${num(outlets.length)}</span></div>${outletRows(sorted.slice(0, 40), {showBrand: false})}
      ${outlets.length > 40 ? `<p class="hint">แสดง ${num(40)} จาก ${num(outlets.length)} สาขา · กดจุดบนแผนที่เพื่อดูสาขาอื่น</p>` : ''}</section>
    ${registerProvenance(reg.meta, 'ประเทศไทย · จังหวัดจากจุดของสาขาหรือที่อยู่ในทะเบียน')}`;
}

export function renderCompany({reg, company, brands, outlets, mix}) {
  return `<section class="detail-head register-company">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">บริษัทหรือกลุ่มในทะเบียน</p>
      <h2>${esc(company.name)}</h2>${company.legal && company.legal !== company.name ? `<p class="subtle">${esc(company.legal)}</p>` : ''}
      <div class="metrics compact">${metricTile(mix.count, 'สาขาในทะเบียน', 'store')}${metricTile(brands.length, 'เครือ', 'brand')}${metricTile(mix.withPoint, 'มีจุดบนแผนที่', 'area')}</div>
      <p class="hint">บทบาทในทะเบียนไม่ได้แปลว่าเป็นผู้ประกอบการของทุกสาขา และไม่ใช่บริษัทแม่สูงสุดเสมอไป</p>
      <div class="detail-actions">${company.web ? link(company.web, 'เว็บของบริษัท', 'btn quiet source-link') : ''}</div>
    </section>
    <section class="panel-section"><div class="section-heading">${heading('brand', 'เครือในพอร์ตตามทะเบียน')}<span class="hint">${num(brands.length)}</span></div>${brandRows(brands.map(b => b.brand), {count: b => brands.find(x => x.brand.id === b.id)?.count || 0})}</section>
    ${registerProvenance(reg.meta)}`;
}

const apiLike = url => /(^https?:\/\/[^/]*\bapi\b)|\/api\/|\/v\d+\//i.test(url);

export function renderOutlet({reg, outlet: o, area = null, land = null, sameBrand = {list: [], total: 0}}) {
  const same = Array.isArray(sameBrand) ? {list: sameBrand, total: sameBrand.length, nearest: false} : sameBrand;
  const logo = getBrandLogo(o.brand);
  const coords = o.hasPoint ? `<span class="data-number">${o.latitude.toFixed(6)}, ${o.longitude.toFixed(6)}</span><br><span class="hint">${esc(GEO_TH[o.geo] || 'จุดจากแหล่งข้อมูล')}</span>` : '<span class="hint">ทะเบียนยังไม่มีจุดที่เลือกใช้สำหรับสาขานี้</span>';
  const province = o.province ? `${esc(o.provinceTh)}<br><span class="hint">${o.provinceBy === 'point' ? 'จากจุดของสาขา' : 'จากที่อยู่ในทะเบียน'}</span>` : '<span class="hint">ไม่ระบุจังหวัด</span>';
  const areaHtml = area ? `<dt>พื้นที่</dt><dd><button type="button" class="link-button" data-action="select-area" data-id="${esc(area.id)}">${esc(areaWord(area.province))}${esc(area.name)}</button> · ${esc(districtWord(area.province))}${esc(area.districtName)}<br><span class="hint">จุดของสาขาอยู่ในขอบเขตนี้</span></dd>` : '';
  const landHtml = renderStoreLand(land);
  return `<section class="detail-head store register-outlet">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      ${logo ? brandLogoMarkup(o.brand, {size: 'lg', className: 'detail-logo', decorative: false}) : ''}
      <p class="eyebrow">สาขาในทะเบียนร้านเครือ</p>
      <h2>${esc(o.name || o.brand.name)}</h2>
      <dl class="facts">
        <dt>เครือ</dt><dd><button type="button" class="link-button" data-action="select-chain" data-id="${esc(o.brand.id)}">${esc(o.brand.name)}</button>${o.company ? ` · <button type="button" class="link-button" data-action="select-company" data-id="${esc(o.company.id)}">${esc(o.company.name)}</button>` : ''}</dd>
        <dt>หลักฐาน</dt><dd>${esc(EVIDENCE_TH[o.evidence])}<br><span class="hint">${esc(STATUS_TH[o.status])}</span></dd>
        ${o.address ? `<dt>ที่อยู่</dt><dd>${esc(o.address)}</dd>` : ''}
        ${o.floor || o.unit ? `<dt>ชั้น/ยูนิต</dt><dd>${esc([o.floor && `ชั้น ${o.floor}`, o.unit && `ยูนิต ${o.unit}`].filter(Boolean).join(' · '))}<br><span class="hint">ตามแหล่งข้อมูล</span></dd>` : ''}
        <dt>จังหวัด</dt><dd>${province}</dd>
        ${areaHtml}${landHtml}
        <dt>พิกัด</dt><dd>${coords}</dd>
        <dt>แหล่งข้อมูล</dt><dd>${o.source ? `${link(o.source, new URL(o.source).hostname.replace(/^www\./, ''))}${apiLike(o.source) ? '<br><span class="hint">ปลายทาง API ของแหล่ง เปิดในเบราว์เซอร์อาจไม่ใช่หน้าเว็บของสาขา</span>' : ''}` : 'ทะเบียนวิจัย (ภายใน)'}${o.checked ? `<br><span class="hint">ตรวจ ${esc(thaiDate(o.checked))}</span>` : ''}<br><span class="hint data-number">รหัส ${esc(o.id)}</span></dd>
      </dl>
    </section>
    ${same.total ? `<section class="panel-section"><div class="section-heading">${heading('brand', `สาขาอื่นของ ${brandLabel(o.brand)} ในจังหวัดเดียวกัน`)}<span class="hint">${num(same.total)} สาขา</span></div>${outletRows(same.list, {showBrand: false})}${shownOf(same.list.length, same.total, 'สาขา', same.nearest ? 'ใกล้ที่สุดก่อน' : '')}</section>` : ''}
    ${registerProvenance(reg.meta, o.provinceTh || 'ประเทศไทย')}`;
}

/* ---------- Land host ---------- */

const SHAPE_SOURCE = {registry_shopping: 'ทะเบียนศูนย์การค้า (OpenStreetMap และส่วนอาคารของ CityMETER)', registry_osm: 'ทะเบียนโรงแรมและอาคาร (OpenStreetMap)',
  citymeter_v4: 'CityMETER production (V4)'};
const metres = v => new Intl.NumberFormat('th-TH', {maximumFractionDigits: 1}).format(v);

/** Where the building shape comes from and how detailed it is (LOD > 1 = parts with their own base and top). */
export function landShape(profile) {
  const p = profile?.feature?.properties;
  if (!p) return '';
  const src = SHAPE_SOURCE[p.source] || 'แหล่งข้อมูลอาคาร';
  const parts = profile.parts || [];
  if (parts.length) {
    const tops = parts.map(f => Number(f.properties?.height_m)).filter(v => Number.isFinite(v) && v > 0);
    const range = tops.length ? ` สูง ${metres(Math.min(...tops))}–${metres(Math.max(...tops))} ม. ตามแหล่ง ไม่ใช่ผลรังวัด` : '';
    return p.lod === 2 ? `รูปทรงละเอียดระดับ LOD2: ${num(parts.length)} ส่วนอาคาร แต่ละส่วนมีฐานและความสูงของตัวเอง จาก${src} ·${range}` : `อาคาร ${num(parts.length)} หลังจาก${src} ·${range}`;
  }
  const h = Number(p.height_m);
  return `รูปทรงอาคารระดับ LOD1 (ขอบอาคารและความสูงเดียว) จาก${src}${Number.isFinite(h) && h > 0 ? ` · สูง ${metres(h)} ม. ตามแหล่ง ไม่ใช่ผลรังวัด` : ' · ไม่มีความสูงในแหล่ง แสดง 3 ม.'}`;
}

function groupCompare(inside, around, groups) {
  const count = rows => { const m = new Map(); for (const r of rows) m.set(r.group, (m.get(r.group) || 0) + 1); return m; };
  const a = count(inside), b = count(around);
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => (b.get(y) || 0) + (a.get(y) || 0) - (b.get(x) || 0) - (a.get(x) || 0));
  if (!ids.length) return '<p class="hint">ไม่มีร้าน</p>';
  // A share only for a column of at least MIN_SHARE_ROWS rows: on a handful of rows a percentage reads as a mix.
  const pct = (n, t) => (t >= MIN_SHARE_ROWS ? ` <small>${Math.round((n / t) * 100)}%</small>` : '');
  return `<table class="compare-table"><caption class="sr-only">ประเภทร้านในอาคารเทียบรอบอาคาร</caption><thead><tr><th scope="col">ประเภท</th><th scope="col">ในอาคาร</th><th scope="col">รอบ 100 ม.</th></tr></thead><tbody>${ids.map(g => {
    const grp = groups[g];
    return `<tr><th scope="row">${cueMarkup(grp.series)}${esc(grp.th)}</th><td><span class="data-number">${num(a.get(g) || 0)}</span>${pct(a.get(g) || 0, inside.length)}</td><td><span class="data-number">${num(b.get(g) || 0)}</span>${pct(b.get(g) || 0, around.length)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

export function renderLand({land, profile, around, groups, venue = null, index = null}) {
  const h = profile.host, rows = profile.rows, outs = profile.outlets;
  const inside = [...rows.in, ...rows.edge];
  const outletsIn = [...outs.in, ...outs.edge];
  const byReviews = (a, b) => (b.reviews ?? -1) - (a.reviews ?? -1) || a.name.localeCompare(b.name, 'th');
  const area = index?.byId.get(h.area) || null;
  const brandMap = new Map();
  for (const o of outletsIn) { const e = brandMap.get(o.brand.id) || {brand: o.brand, count: 0}; e.count++; brandMap.set(o.brand.id, e); }
  const brands = [...brandMap.values()].sort((a, b) => b.count - a.count);
  const shape = landShape(profile);
  return `<section class="detail-head venue land-host">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">${esc(h.typeTh)} · ทะเบียน${esc(h.datasetTh)}${area ? ` · <button type="button" class="link-button" data-action="select-area" data-id="${esc(area.id)}">${esc(areaWord(area.province))}${esc(area.name)}</button>` : ''}</p>
      <h2>${esc(h.name)}</h2>${h.nameEn && h.nameEn !== h.name ? `<p class="subtle">${esc(h.nameEn)}</p>` : ''}
      <div class="metrics compact">${metricTile(rows.in.length, 'ร้านจุดตกในอาคาร', 'store')}${metricTile(rows.edge.length, 'ร้านติดขอบอาคาร', 'store')}${metricTile(outletsIn.length, 'สาขาเครือจุดตกใน/ติดขอบ', 'brand')}</div>
      <p class="hint">${esc(LAND_NOTE)} · ติดขอบ = ห่างขอบอาคารไม่เกิน 10 ม. ซึ่งอยู่ในระยะความคลาดของพิกัด · ${esc(DATA_NOTE)} · สาขาเครือนับจากทะเบียนร้านเครือ คนละหน่วย ไม่นำมาบวกกัน</p>
      ${shape ? `<p class="hint land-shape">${esc(shape)}</p>` : ''}
      ${profile.cohosts.length ? `<p class="hint">อาคารเดียวกับ ${profile.cohosts.map(c => `<button type="button" class="link-button" data-action="select-land" data-id="${esc(c.id)}">${esc(c.name)}</button> (${esc(c.typeTh)})`).join(' · ')}</p>` : ''}
      ${venue ? `<div class="detail-actions"><button type="button" class="btn quiet" data-action="select-venue" data-id="${esc(venue.id)}">ร้านที่ชื่ออ้างถึง ${esc(venue.name)}</button></div>` : ''}
    </section>
    <section class="panel-section land-compare"><div class="section-heading">${heading('segment', 'ประเภทร้าน: ในอาคารเทียบรอบอาคาร')}<span class="hint">${num(inside.length)} · ${num(around.length)} ร้าน</span></div>
      ${groupCompare(inside, around, groups)}
      <p class="hint">ในอาคาร = จุดตกในหรือติดขอบอาคาร · รอบอาคาร = จุดห่างขอบอาคารเกิน 10 ม. แต่ไม่เกิน 100 ม. (ร้านตามตัวกรอง)${inside.length >= MIN_SHARE_ROWS && around.length >= MIN_SHARE_ROWS ? ' · ร้อยละของแต่ละคอลัมน์' : ` · ร้อยละแสดงเฉพาะคอลัมน์ที่มีอย่างน้อย ${num(MIN_SHARE_ROWS)} ร้าน — ตัวอย่างน้อยใช้เป็นสัญญาณ ไม่ใช่สัดส่วนร้านหรือผู้เช่าจริง`}</p></section>
    <section class="panel-section"><div class="section-heading">${heading('brand', 'เครือในทะเบียนที่จุดตกในหรือติดขอบอาคาร')}<span class="hint">${num(outletsIn.length)} สาขา · ${num(brands.filter(x => !x.brand.registry).length)} เครือ</span></div>
      ${brands.length ? brandChips(brands) : '<p class="hint">ไม่มีสาขาในทะเบียนที่จุดตกในหรือติดขอบอาคารนี้</p>'}
      ${outletsIn.length ? `${outletRows(outletsIn.slice(0, 20))}${shownOf(Math.min(20, outletsIn.length), outletsIn.length, 'สาขา')}` : ''}</section>
    <section class="panel-section"><div class="section-heading">${heading('store', 'ร้านที่จุดตกในหรือติดขอบอาคาร')}<span class="hint">${num(inside.length)} ร้าน</span></div>
      ${inside.length ? `<ul class="outlet-list">${inside.sort(byReviews).slice(0, 30).map(r => `<li><button type="button" class="brand-row" data-action="select-store" data-id="${esc(r.id)}">${brandLogoMarkup(r.brand, {size: 'sm'})}<span><strong>${esc(r.name)}</strong><br><span class="small muted">${esc([r.type || 'ไม่ระบุประเภท', Number.isFinite(r.rating) ? `★ ${dec(r.rating)}` : '', rows.edge.includes(r) ? 'ติดขอบอาคาร' : ''].filter(Boolean).join(' · '))}</span></span></button></li>`).join('')}</ul>${inside.length > 30 ? `<p class="hint">แสดง 30 จาก ${num(inside.length)} ร้าน (รีวิวมากก่อน)</p>` : ''}` : '<p class="hint">ไม่มีร้านตามตัวกรองที่จุดตกในอาคารนี้</p>'}</section>
    ${landProvenance(land.meta, `อาคาร 1 หลังของ ${h.name} และวงรอบ 100 ม.${area ? ` · ${areaWord(area.province)}${area.name}` : ''}`)}`;
}

export {RELATION_TH};

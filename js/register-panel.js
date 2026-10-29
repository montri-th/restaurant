/**
 * Reading-panel views that come from the chain register and the Land hosts. Pure: HTML strings, no DOM or map.
 *
 * Wording contract (owner rules + register README; condensed 2026-10-28 18:27 “caveats เยอะมาก พี่ลบด้วย เอาให้เนียน”;
 * one vocabulary 2026-10-29 “เลิกแยกร้านทะเบียนร้านเครือ”):
 *  - every view or section ends with ONE provenance line — dataset · source · date · boundary — and at most one
 *    clause that says what the unit above means; nothing else repeats it inside the view;
 *  - a register outlet is a ร้าน of the population like any other (“สาขาเครือ” in its meta line, its chain first);
 *    that it is a listed branch with evidence — not a field-verified open shop — is said once, in the provenance line;
 *  - a restaurant “ในอาคาร” is a point inside the building outline (within 10 m counts) — never a tenancy or
 *    floor claim: the rule is one clause in the Land provenance line, never a sentence per row;
 *  - missing stays missing: an outlet without a coordinate says “ยังไม่มีพิกัด”, an unknown province “ไม่ระบุจังหวัด”.
 * Actions (delegated, data-action): open-chains · select-company · select-store · select-land · select-area ·
 * select-venue · filter-brand · back.
 */
import {esc, num, dec, link, thaiDate, metricTile, heading, entryMarkup, chainChips, outboundRow} from './panel.js';
import {brandLogoMarkup, getBrandLogo} from './brand-logos.js';
import {cueMarkup} from './cues.js';
import {areaWord, districtWord} from './areas.js';
import {hasPoint} from './model.js';
import {EVIDENCE, EVIDENCE_TH, EVIDENCE_SHORT, STATUS_TH, GEO_TH} from './register.js';
import {RELATION_TH, LAND_RULE} from './land.js';
import {chainLabel, chainLogoBrand} from './chains.js';

/** The register's unit, in one clause (the provenance line of register views). */
export const REGISTER_RULE = 'สาขาเครือ = รายการในทะเบียนร้านเครือที่มีหลักฐาน ไม่ใช่จำนวนร้านที่เปิดอยู่จริง · นับรวมกับร้านในชุดข้อมูลเป็นประชากรเดียว';
/** A share is printed only for a column of at least this many rows (the same floor as the density ranking). */
export const MIN_SHARE_ROWS = 30;

/** Dates of the inputs, set once the extras load (app.js) — every register / Land number cites its own. */
let SOURCES = {snapshot: '2026-10-22', registerFrom: '2026-10-25', registerTo: '2026-10-28', land: '2026-10-28', shapes: '2026-10-25'};
export function setSourceDates(dates = {}) { SOURCES = {...SOURCES, ...Object.fromEntries(Object.entries(dates).filter(([, v]) => v))}; }

const checkedRange = (meta = {}) => {
  const a = thaiDate(meta?.checkedFrom || SOURCES.registerFrom), b = thaiDate(meta?.checkedTo || SOURCES.registerTo);
  return a && b && a !== b ? `${a}–${b}` : b || a || '';
};
export const registerChecked = (meta = {}) => checkedRange(meta);
const foot = compact => (compact ? 'hint source-line' : 'hint panel-foot provenance');

/** Every register view and register section ends with dataset · source · date · boundary (+ the unit, once). */
export function registerProvenance(meta = {}, boundary = 'ประเทศไทย', note = REGISTER_RULE, {compact = false} = {}) {
  return `<p class="${foot(compact)}"><span>ชุดข้อมูล ทะเบียนร้านเครือ (CityMETER Chain Restaurants)</span> · <span>แหล่ง เว็บและแอปของแบรนด์ บริษัท สถานที่ และแหล่งรองรายสาขา</span> · <span>ตรวจ ${esc(checkedRange(meta))}</span> · <span>ขอบเขต ${esc(boundary)}</span>${note ? `<br>${esc(note)}` : ''}</p>`;
}

/** Land numbers mix three inputs: the line names each with its date, then the in-rule once. */
export function landProvenance(meta = {}, boundary = '', {compact = false, note = LAND_RULE} = {}) {
  const shapes = thaiDate(meta?.shapesAsOf || SOURCES.shapes);
  return `<p class="${foot(compact)}"><span>ชุดข้อมูล ทะเบียน Land (ศูนย์การค้า โรงแรม อาคารสำนักงาน) × CityMETER Restaurants × ทะเบียนร้านเครือ</span> · <span>แหล่ง ร้าน CityMETER Restaurants API สาธารณะ ดึง ${esc(thaiDate(SOURCES.snapshot))} · สาขาเครือ ทะเบียนร้านเครือ ตรวจ ${esc(checkedRange())} · รูปอาคาร OpenStreetMap (OpenFreeMap${shapes ? ` ${esc(shapes)}` : ''})</span> · <span>จับคู่ ${esc(thaiDate(meta?.checkedOn || SOURCES.land))}</span> · <span>ขอบเขต ${esc(boundary)}</span>${note ? `<br>${esc(note)}` : ''}</p>`;
}

/** “แสดง n จาก N …”: a list cut at n never shows its length as the total. */
const shownOf = (n, total, unit, order = '') => (total > n ? `<p class="hint">แสดง ${num(n)} จาก ${num(total)} ${unit}${order ? ` (${order})` : ''}</p>` : '');

/** A register record's name for lists: the operator when another record shares the name (KFC is three networks). */
export const brandLabel = b => (b?.sharedName && b.companyRecord ? `${b.name} · ${b.companyRecord.name}` : b?.name || '');
/** Flag beside a record in lists: a multi-banner registry, or a cart / secondary-source majority. */
const brandFlag = b => (b?.registry ? {short: 'หลายแบรนด์', th: 'ทะเบียนจุดขายหลายแบรนด์ ไม่ใช่เครือเดียว'} : b?.evidenceTag || null);

/** The register's completeness note in plain Thai (a code from the research sheet reads as the same claim). */
const completenessTh = v => (!v || v === 'not_attested_current_national_census' ? 'ยังไม่ยืนยันครบทุกสาขาปัจจุบันทั่วประเทศ' : v);

/** Chain rows for the directory and the company page: logo + name (+ company / flag) + count (restaurants and outlets together). */
function chainRows(chains, {unit = 'ร้าน'} = {}) {
  return `<ul class="venue-list">${chains.map(c => {
    const lb = chainLogoBrand(c), name = chainLabel(c), reg = c.chain?.register || (c.brand?.kind === 'register-brand' ? c.brand : null);
    const flag = brandFlag(reg);
    const sub = [c.chain?.company?.name || reg?.companyRecord?.name || '', flag?.th || '', c.outlets && c.rows ? `${num(c.rows)} ร้าน + ${num(c.outlets)} สาขาเครือ` : ''].filter(Boolean).join(' · ');
    return `<li><button type="button" class="venue-row${lb ? ' has-logo' : ''}" data-action="filter-brand" data-value="${esc(c.key)}" aria-label="${esc(name)} ${num(c.count)} ${unit}">${lb ? brandLogoMarkup(lb, {size: 'sm'}) : ''}<span class="venue-name">${esc(name)}<small>${esc(sub)}</small></span><span class="venue-count data-number">${num(c.count)}<small>${unit}</small></span></button></li>`;
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

/** Area / district / venue: Land buildings with restaurant points inside — one row per building: main host, other
 * registry names on the same outline, and — for a nested outline — the listed building whose restaurants it repeats. */
export function renderLandHostsIn(list, {title = 'อาคารในทะเบียน Land', boundary = '', meta = {}} = {}) {
  if (!list?.length) return '';
  const total = list.total ?? list.length;
  const kind = h => (h.typeTh === h.datasetTh ? h.typeTh : `${h.typeTh} · ${h.datasetTh}`);
  const names = hs => (hs.length > 2 ? `${hs.slice(0, 2).map(h => h.name).join(', ')} และอีก ${num(hs.length - 2)} ชื่อ` : hs.map(h => h.name).join(', '));
  const note = x => [x.cohosts?.length ? `อาคารเดียวกับ ${names(x.cohosts)}` : '', x.repeats ? `นับร้านซ้ำกับ ${x.repeats.host.name} ${num(x.repeats.rows)} ร้าน` : ''].filter(Boolean);
  return `<section class="panel-section land-hosts"><div class="section-heading">${heading('venue', title)}<span class="hint">${num(total)} อาคาร</span></div>
    <ul class="venue-list">${list.map(x => `<li><button type="button" class="venue-row" data-action="select-land" data-id="${esc(x.host.id)}" aria-label="${esc(x.host.name)} ${num(x.rows + (x.outlets || 0))} ร้านในอาคาร"><span class="venue-name">${esc(x.host.name)}<small>${esc([kind(x.host), ...note(x)].join(' · '))}</small></span><span class="venue-count data-number">${num(x.rows + (x.outlets || 0))}<small>ร้าน</small></span></button></li>`).join('')}</ul>
    ${shownOf(list.length, total, 'อาคาร', 'ร้านมากก่อน')}
    ${landProvenance(meta, boundary || 'อาคารในรายการ', {compact: true, note: `${LAND_RULE} · ร้านตามตัวกรอง · เฉพาะ host ที่มีรูปอาคาร OpenStreetMap ที่จุด`})}</section>`;
}

/** Store / outlet panel: the Land building the point falls in. */
const hostLinks = hosts => hosts.map(h => `<button type="button" class="link-button" data-action="select-land" data-id="${esc(h.id)}">${esc(h.name)}</button> <span class="hint">(${esc(h.typeTh)})</span>`).join(' · ');

export function renderStoreLand(rel) {
  if (!rel?.hosts?.length) return '';
  const also = (rel.also || []).flatMap(x => x.hosts);
  // d = the source point's distance to the outline: 0 inside; up to 10 m outside counts as in and the pin is drawn inside.
  const how = rel.d > 0 ? `จุดต้นทางห่างขอบอาคาร ${dec(rel.d)} ม. (ไม่เกิน 10 ม. นับเป็นในอาคาร หมุดแสดงในอาคาร)` : 'จุดอยู่ในขอบอาคาร';
  return `<dt>อาคาร</dt><dd>${hostLinks(rel.hosts)}${also.length ? `<br>อยู่ในขอบอาคารของ ${hostLinks(also)} ด้วย` : ''}<br><span class="hint">${how} · ทะเบียน Land จับคู่ ${esc(thaiDate(SOURCES.land))}</span></dd>`;
}

/** Store panel: the moved-row status (a sheet-1 row the owner moved to the register is counted there). */
export function renderStoreRegister({row, register = 0, targets = []}) {
  if (!register) return '';
  const t = targets.length ? ` · <button type="button" class="link-button" data-action="select-store" data-id="${esc(targets[0].id)}">${register === 2 ? 'สาขาเครือที่ตรงกัน' : 'สาขาเครือที่อาจตรงกัน'}</button>` : '';
  return `<dt>สถานะ</dt><dd>${register === 2 ? 'ย้ายไปนับเป็นสาขาเครือแล้ว และมีรายการที่ตรงกัน' : 'ย้ายไปนับเป็นสาขาเครือแล้ว รอยืนยันเครือและสาขา'}${t}<br><span class="hint">นับครั้งเดียวฝั่งทะเบียนร้านเครือ ไม่นับซ้ำในตัวเลขร้าน</span></dd>`;
}

/* ---------- register views ---------- */

/**
 * The chain directory: every chain of the current scope, restaurants and outlets together (0.7.0 — no search box of
 * its own: the main search filters the population, this list follows it).
 */
export function renderChains({reg, chains, scopeCount, withPoint, query = '', limit = 60}) {
  const m = reg?.meta || {};
  const total = chains.total ?? chains.length;
  const evCounts = Object.fromEntries((m.evidence || []).map(e => [e.id, e.count])), stCounts = Object.fromEntries((m.status || []).map(s => [s.id, s.count]));
  const ev = m.evidence ? EVIDENCE.map(k => ({label: EVIDENCE_SHORT[k], title: EVIDENCE_TH[k], count: evCounts[k] || 0})) : [];
  const excluded = reg?.registries?.length ? ` · ไม่นับ ${reg.registries.map(r => r.name).join(', ')} เป็นเครือ — ทะเบียนจุดขายหลายแบรนด์` : '';
  return `<section class="detail-head register">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">เครือร้าน${query ? ` · ค้นหา “${esc(query)}”` : ' · ทั้งประเทศ'}</p>
      <h2>${num(total)} เครือ</h2>
      <div class="metrics compact">${metricTile(scopeCount, 'ร้าน', 'store', 'ร้านในชุดข้อมูลและสาขาเครือ ตามตัวกรอง')}${metricTile(withPoint, 'บนแผนที่', 'area', 'ร้านที่มีพิกัด')}${metricTile(m.companyRecords || 0, 'บริษัท/บทบาท', 'brand')}</div>
      ${outboundRow({kind: 'country'})}
    </section>
    <section class="panel-section"><div class="section-heading">${heading('brand', 'เครือที่มีร้านมากที่สุด')}<span class="hint">${num(Math.min(limit, chains.length))} จาก ${num(total)}</span></div>
      ${chains.length ? chainRows(chains.slice(0, limit)) : '<p class="hint">ไม่พบเครือตามตัวกรอง · ค้นจากชื่อเครือ บริษัท ชื่อสาขา หรือพื้นที่</p>'}${shownOf(Math.min(limit, chains.length), total, 'เครือ', 'ร้านมากก่อน')}</section>
    ${ev.length ? `<section class="panel-section"><div class="section-heading">${heading('plain', 'หลักฐานของสาขาเครือ')}<span class="hint">ทั้งทะเบียน</span></div>${shareBars(ev, m.outlets || 0)}
      <p class="hint">แหล่งข้อมูลระบุปิดชั่วคราว ${num(stCounts.temporary || 0)} · ระบุปิดหรือไม่ใช้งาน ${num(stCounts.closed || 0)} (ยังไม่ยืนยัน) · ไม่ระบุจังหวัด ${num(m.stats?.noProvince || 0)}</p></section>` : ''}
    ${registerProvenance(m, 'ประเทศไทย', REGISTER_RULE + excluded)}`;
}

export function renderCompany({reg, company, chains, rows, withPoint}) {
  return `<section class="detail-head register-company">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">บริษัทหรือกลุ่ม</p>
      <h2>${esc(company.name)}</h2>${company.legal && company.legal !== company.name ? `<p class="subtle">${esc(company.legal)}</p>` : ''}
      <div class="metrics compact">${metricTile(rows.length, 'ร้าน', 'store')}${metricTile(chains.length, 'เครือ', 'brand')}${metricTile(withPoint, 'บนแผนที่', 'area', 'ร้านที่มีพิกัด')}</div>
      ${outboundRow({kind: 'company', name: company.name})}
      <div class="detail-actions">${company.web ? link(company.web, 'เว็บของบริษัท', 'btn quiet source-link') : ''}</div>
    </section>
    <section class="panel-section"><div class="section-heading">${heading('brand', 'เครือในพอร์ตตามทะเบียน')}<span class="hint">${num(chains.length)}</span></div>${chainRows(chains)}</section>
    ${registerProvenance(reg.meta, 'ประเทศไทย', `${REGISTER_RULE} · บทบาทในทะเบียนไม่ใช่ผู้ประกอบการของทุกสาขา`)}`;
}

const apiLike = url => /(^https?:\/\/[^/]*\bapi\b)|\/api\/|\/v\d+\//i.test(url);

/** An outlet, chain first: logo · เครือ · สาขา, then the facts the register records and the outbound searches. */
export function renderOutlet({reg, outlet: o, area = null, land = null, sameBrand = {list: [], total: 0}, group = null}) {
  const same = Array.isArray(sameBrand) ? {list: sameBrand, total: sameBrand.length, nearest: false} : sameBrand;
  const logo = getBrandLogo(o.brand);
  // The register's own coordinate; a pin drawn inside its Land building keeps the source values here.
  const lat = o.sourceLatitude ?? o.latitude, lon = o.sourceLongitude ?? o.longitude;
  const coords = o.hasPoint ? `<span class="data-number">${lat.toFixed(6)}, ${lon.toFixed(6)}</span><br><span class="hint">${esc(GEO_TH[o.geo] || 'จุดจากแหล่งข้อมูล')}${o.snapped ? ' · หมุดแสดงในอาคาร Land' : ''}</span>` : '<span class="hint">ยังไม่มีพิกัดในทะเบียน — ร้านนี้อยู่ในตัวเลข ไม่อยู่บนแผนที่</span>';
  const province = o.province ? `${esc(o.provinceTh)}<br><span class="hint">${o.provinceBy === 'point' ? 'จากจุดของสาขา' : 'จากที่อยู่ในทะเบียน'}</span>` : '<span class="hint">ไม่ระบุจังหวัด</span>';
  const areaHtml = area ? `<dt>พื้นที่</dt><dd><button type="button" class="link-button" data-action="select-area" data-id="${esc(area.id)}">${esc(areaWord(area.province))}${esc(area.name)}</button> · ${esc(districtWord(area.province))}${esc(area.districtName)}</dd>` : '';
  const landHtml = renderStoreLand(land);
  const branch = o.name && o.name !== o.brand.name ? o.name : '';
  const typeHow = o.groupBy ? (o.groupBy.how === 'rows' ? `ตามร้านชื่อเดียวกัน ${num(o.groupBy.rows)} ร้านในชุดข้อมูล (อนุมาน)` : 'ตามรูปแบบที่ทะเบียนระบุ (อนุมาน)') : 'ทะเบียนไม่ระบุประเภทอาหาร';
  const outbound = outboundRow({kind: 'store', brand: o.brand.name, branch, name: o.name, area: area ? `${areaWord(area.province)}${area.name}` : '', district: area ? `${districtWord(area.province)}${area.districtName}` : '', province: o.provinceTh, lat: o.hasPoint ? lat : null, lng: o.hasPoint ? lon : null});
  return `<section class="detail-head store register-outlet">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      ${logo ? brandLogoMarkup(o.brand, {size: 'lg', className: 'detail-logo', decorative: false}) : ''}
      <p class="eyebrow eyebrow-cue">${group ? `${cueMarkup(group.series)}${esc(group.th)} · ` : ''}สาขาเครือ${o.company ? ` · <button type="button" class="link-button" data-action="select-company" data-id="${esc(o.company.id)}">${esc(o.company.name)}</button>` : ''}</p>
      <h2>${esc(o.brand.name)}</h2>
      ${branch ? `<p class="subtle entry-branch-line">${esc(branch)}</p>` : ''}
      ${outbound}
      <dl class="facts">
        <dt>เครือ</dt><dd><button type="button" class="link-button" data-action="filter-brand" data-value="${esc(o.brand.id)}">${esc(brandLabel(o.brand))}</button> <span class="data-number">${num(o.brand.outlets || 0)}</span> สาขาเครือ<br><span class="hint">${esc(completenessTh(o.brand.completeness))}</span></dd>
        <dt>ประเภท</dt><dd>${group ? esc(group.th) : 'ไม่ระบุประเภท'}<br><span class="hint">${esc(typeHow)}</span></dd>
        <dt>หลักฐาน</dt><dd>${esc(EVIDENCE_TH[o.evidence])}<br><span class="hint">${esc(STATUS_TH[o.status])}</span></dd>
        ${o.address ? `<dt>ที่อยู่</dt><dd>${esc(o.address)}</dd>` : ''}
        ${o.floor || o.unit ? `<dt>ชั้น/ยูนิต</dt><dd>${esc([o.floor && `ชั้น ${o.floor}`, o.unit && `ยูนิต ${o.unit}`].filter(Boolean).join(' · '))}<br><span class="hint">ตามแหล่งข้อมูล</span></dd>` : ''}
        <dt>จังหวัด</dt><dd>${province}</dd>
        ${areaHtml}${landHtml}
        <dt>พิกัด</dt><dd>${coords}</dd>
        <dt>แหล่งข้อมูล</dt><dd>${o.source ? `${link(o.source, new URL(o.source).hostname.replace(/^www\./, ''))}${apiLike(o.source) ? '<br><span class="hint">ปลายทาง API ของแหล่ง เปิดในเบราว์เซอร์อาจไม่ใช่หน้าเว็บของสาขา</span>' : ''}` : 'ทะเบียนวิจัย (ภายใน)'}${o.checked ? `<br><span class="hint">ตรวจ ${esc(thaiDate(o.checked))}</span>` : ''}<br><span class="hint data-number">รหัส ${esc(o.id)}</span></dd>
      </dl>
    </section>
    ${same.total ? `<section class="panel-section"><div class="section-heading">${heading('brand', `${brandLabel(o.brand)} ที่อื่นในจังหวัดเดียวกัน`)}<span class="hint">${num(same.total)} ร้าน</span></div><ul class="outlet-list">${same.list.map(x => entryMarkup(x)).join('')}</ul>${shownOf(same.list.length, same.total, 'ร้าน', same.nearest ? 'ใกล้ที่สุดก่อน' : '')}
      <div class="detail-actions"><button type="button" class="btn quiet" data-action="filter-brand" data-value="${esc(o.brand.id)}">ดูเฉพาะเครือนี้</button></div></section>` : ''}
    ${registerProvenance(reg.meta, o.provinceTh || 'ประเทศไทย')}`;
}

/* ---------- Land host ---------- */

const metres = v => new Intl.NumberFormat('th-TH', {maximumFractionDigits: 1}).format(v);

/** The building shape in a few words: OpenStreetMap outline, its source height, and the parts when it has them. */
export function landShape(profile) {
  const p = profile?.feature?.properties;
  if (!p) return '';
  const parts = profile.parts || [];
  if (parts.length) {
    const tops = parts.map(f => Number(f.properties?.height_m)).filter(v => Number.isFinite(v) && v > 0);
    const range = tops.length ? ` · สูง ${metres(Math.min(...tops))}–${metres(Math.max(...tops))} ม. ตามแหล่ง` : '';
    return `อาคาร OpenStreetMap · ${num(parts.length)} ส่วนอาคาร (LOD2)${range}`;
  }
  const h = Number(p.height_m);
  return `อาคาร OpenStreetMap${Number.isFinite(h) && h > 0 ? ` · สูง ${metres(h)} ม. ตามแหล่ง` : ' · ไม่มีความสูงในแหล่ง แสดง 3 ม.'}`;
}

function groupCompare(inside, around, groups) {
  const count = rows => { const m = new Map(); for (const r of rows) m.set(r.group, (m.get(r.group) || 0) + 1); return m; };
  const a = count(inside), b = count(around);
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => (b.get(y) || 0) + (a.get(y) || 0) - (b.get(x) || 0) - (a.get(x) || 0));
  if (!ids.length) return '<p class="hint">ไม่มีร้าน</p>';
  // A share only for a column of at least MIN_SHARE_ROWS rows: on a handful of rows a percentage reads as a mix.
  const pct = (n, t) => (t >= MIN_SHARE_ROWS ? ` <small>${Math.round((n / t) * 100)}%</small>` : '');
  return `<table class="compare-table"><caption class="sr-only">ประเภทร้านในอาคารเทียบรอบอาคาร</caption><thead><tr><th scope="col">ประเภท</th><th scope="col">ในอาคาร</th><th scope="col">รอบ 100 ม.</th></tr></thead><tbody>${ids.filter(g => groups[g]).map(g => {
    const grp = groups[g];
    return `<tr><th scope="row">${cueMarkup(grp.series)}${esc(grp.th)}</th><td><span class="data-number">${num(a.get(g) || 0)}</span>${pct(a.get(g) || 0, inside.length)}</td><td><span class="data-number">${num(b.get(g) || 0)}</span>${pct(b.get(g) || 0, around.length)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

export function renderLand({land, profile, around, groups, venue = null, index = null, chains = []}) {
  const h = profile.host, inside = profile.rows.in, outletsIn = profile.outlets.in;
  const area = index?.byId.get(h.area) || null;
  const shape = landShape(profile);
  const all = [...inside, ...outletsIn];
  const shares = all.length >= MIN_SHARE_ROWS && around.length >= MIN_SHARE_ROWS ? 'ร้อยละของแต่ละคอลัมน์' : `ร้อยละเมื่อคอลัมน์มีอย่างน้อย ${num(MIN_SHARE_ROWS)} ร้าน`;
  return `<section class="detail-head venue land-host">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">${esc(h.typeTh)} · ทะเบียน${esc(h.datasetTh)}${area ? ` · <button type="button" class="link-button" data-action="select-area" data-id="${esc(area.id)}">${esc(areaWord(area.province))}${esc(area.name)}</button>` : ''}</p>
      <h2>${esc(h.name)}</h2>${h.nameEn && h.nameEn !== h.name ? `<p class="subtle">${esc(h.nameEn)}</p>` : ''}
      <div class="metrics compact">${metricTile(all.length, 'ร้านในอาคาร', 'store')}${metricTile(around.length, 'ร้านรอบ 100 ม.', 'area')}${metricTile(chains.filter(x => !x.chain?.registry).length, 'เครือ', 'brand')}</div>
      ${shape ? `<p class="hint land-shape">${esc(shape)}</p>` : ''}
      ${profile.cohosts.length ? `<p class="hint">อาคารเดียวกับ ${profile.cohosts.map(c => `<button type="button" class="link-button" data-action="select-land" data-id="${esc(c.id)}">${esc(c.name)}</button> (${esc(c.typeTh)})`).join(' · ')}</p>` : ''}
      ${outboundRow({kind: 'venue', name: h.name, province: area ? (index?.provinceById?.get(area.province)?.name || '') : '', lat: h.lat, lng: h.lon})}
      ${venue ? `<div class="detail-actions"><button type="button" class="btn quiet" data-action="select-venue" data-id="${esc(venue.id)}">ร้านที่ชื่ออ้างถึง ${esc(venue.name)}</button></div>` : ''}
    </section>
    <section class="panel-section land-compare"><div class="section-heading">${heading('segment', 'ประเภทร้าน: ในอาคารเทียบรอบอาคาร')}<span class="hint">${num(all.length)} · ${num(around.length)} ร้าน</span></div>
      ${groupCompare(all, around, groups)}
      <p class="hint">รอบอาคาร = ห่างขอบ 10–100 ม. · ${esc(shares)}</p></section>
    <section class="panel-section land-in"><div class="section-heading">${heading('store', 'ร้านในอาคาร')}<span class="hint">${num(all.length)} ร้าน · ${num(chains.filter(x => !x.chain?.registry).length)} เครือ</span></div>
      ${chains.length ? chainChips(chains) : ''}
      ${inBuildingRows(inside, outletsIn)}</section>
    ${landProvenance(land.meta, `อาคาร 1 หลังของ ${h.name} และวงรอบ 100 ม.${area ? ` · ${areaWord(area.province)}${area.name}` : ''}`, {note: `${LAND_RULE} · ร้านตามตัวกรอง ไม่ใช่ทุกร้านในอาคาร`})}`;
}

/**
 * One list for what is in the building (owner 2026-10-28 22:03 “ร้านเครือ กับ ร้านในอาคาร ให้แสดงรวมกันไม่ต้องแยก”):
 * restaurant rows and chain outlets together, chain first (logo · เครือ · สาขา), A→Z by the primary name; a row the
 * owner moved to the register with a recorded correspondence appears once, as its outlet.
 */
export function inBuildingRows(rows = [], outlets = [], {limit = 40} = {}) {
  const matched = new Map();
  for (const r of rows) if (r.register === 2) for (const t of r.registerTargets || []) matched.set(t, r);
  const entries = [...rows, ...outlets.filter(o => !matched.has(o.id))].sort((a, b) => (a.brand?.name || a.name).localeCompare(b.brand?.name || b.name, 'th') || a.name.localeCompare(b.name, 'th'));
  if (!entries.length) return '<p class="hint">ไม่มีร้านตามตัวกรองในอาคารนี้</p>';
  const shown = entries.slice(0, limit);
  return `<ul class="outlet-list">${shown.map(e => entryMarkup(e)).join('')}</ul>${entries.length > limit ? `<p class="hint">แสดง ${num(limit)} จาก ${num(entries.length)} ร้าน (ก–ฮ, A–Z)</p>` : ''}`;
}

export {RELATION_TH, EVIDENCE_TH, hasPoint};

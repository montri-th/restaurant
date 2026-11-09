/**
 * Reading panel views as HTML strings. Pure: no DOM access, no map.
 *
 * Every actionable element carries data-action (+ data-id / data-value); the app
 * binds one delegated handler. Actions: select-area · select-district ·
 * select-store · select-venue · select-building · select-province · filter-brand ·
 * back · explore-top · clear-focus · open-charts · open-table · clear-filter · open-chains.
 *
 * One population, one vocabulary (owner 2026-10-29 “เลิกแยกร้านทะเบียนร้านเครือ”): ร้าน = a restaurant
 * row of the public API or a chain outlet of the register, counted, filtered and listed together; an outlet
 * is named by its chain first (logo + เครือ · สาขา), a restaurant by its chain candidate when it has one.
 * Copy is short Thai; icons, logos, cues and bars carry what text used to. No caveats (owner 2026-11-03 11:04 “ไม่แสดง
 * caveats”): a claim is worded as narrowly as its evidence instead of being followed by a limitation; an inferred value
 * carries the one word “อนุมาน”; missing states (ไม่มีข้อมูล · ไม่ระบุราคา · ยังไม่มีพิกัด) stay. Every view still ends
 * with dataset · source · date · boundary, and the only place the two sheets are told apart is that line.
 *
 * Building wording (spatial join, js/building-join.js): "จุดของร้านตกในอาคาร" — the
 * display point falls inside the drawn outline (≈ 9.55 m grid); never "ตั้งอยู่ใน".
 * Missing is never shown as 0. Metric tiles and headings carry the pictogram subset
 * (js/navigation.js PICTOGRAM_CONTRACT); text is the meaning.
 */
import {PRICED, PRICE_LABELS, PRICE_SHORT, SIZE_BANDS, SIZE_LABELS, SIZE_SHORT, SIZE_BASIS, SIZE_LIFTED, productionLink, provinceByCode, PRODUCTION, entryParts, hasPoint, FOOD, foodLabel} from './model.js';
import {areaWord, districtWord} from './areas.js';
import {brandLogoMarkup, getBrandLogo} from './brand-logos.js';
import {venueLogoMarkup, getVenueLogo} from './venue-logos.js';
import {priceColors, buildCountClasses, classify as classifyValue} from './scales.js';
import {cueMarkup} from './cues.js';
import {chainLabel, chainLogoBrand} from './chains.js';
import {outboundFor} from './outbound.js';
import {LENSES} from './lenses.js';
import {GROUP_PICTOGRAM, FOOD_CATEGORY_PICTOGRAM} from './navigation.js';
import {LANG} from './shell/i18n.js';

const NUMBER = new Intl.NumberFormat('th-TH', {maximumFractionDigits: 0});
const DEC1 = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 1, maximumFractionDigits: 1});
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const num = n => NUMBER.format(n);
export const dec = n => DEC1.format(n);
const DEC2 = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
/**
 * Density (ร้าน/ตร.กม.) — one decimal from 1 up, two below 1, "<0.01" below that: a measured
 * non-zero density never prints as 0.0 (one restaurant in a 76 km² subdistrict is 0.013).
 */
export const dens = n => (n == null || !Number.isFinite(n) ? '—' : n === 0 ? '0' : n < 0.01 ? '<0.01' : n < 1 ? DEC2.format(n) : DEC1.format(n));
const km = n => (n >= 10 ? NUMBER.format(n) : DEC1.format(n));
const safeURL = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };

export function link(url, label, cls = 'source-link') {
  const u = safeURL(url);
  return u ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}</a>` : '';
}

export function thaiDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return iso || '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d} ${months[m - 1]} ${y + 543}`;
}

/** Metric tile with a decorative pictogram; value may be a preformatted string. */
export function metricTile(value, label, kind = '', title = '') {
  const shown = typeof value === 'string' ? value : num(value);
  return `<div class="metric${kind ? ` metric-${kind}` : ''}"${title ? ` title="${esc(title)}"` : ''}><i class="metric-symbol pictogram pic-${esc(kind || 'plain')}" aria-hidden="true"></i><strong class="data-number">${esc(shown)}</strong><span>${esc(label)}</span></div>`;
}
export const heading = (kind, text, id = '') => `<h3${id ? ` id="${esc(id)}"` : ''}><i class="pictogram pic-${esc(kind)}" aria-hidden="true"></i>${esc(text)}</h3>`;

/** A list cut at n says so: “แสดง n จาก N …” (a header always carries the total). */
const shownOf = (n, total, unit, order = '') => (total > n ? `<p class="hint">แสดง ${num(n)} จาก ${num(total)} ${unit}${order ? ` (${order})` : ''}</p>` : '');
/** The one line that tells the two sheets apart (every other line of a view reads ร้าน = both): a definition, no caveat. */
const PROXY_NOTE = 'ร้าน = ร้านในชุดข้อมูล 7 จังหวัด + สาขาเครือทั่วประเทศ';
/** The one word an inferred value carries (owner 2026-11-03: no caveats, but an inference never reads as a fact). */
const INFERRED = '<small class="inferred">อนุมาน</small>';
const provinceName = code => provinceByCode(code)?.th || code || '';

/** Every view that shows numbers ends with dataset · source · date · boundary. */
export function provenance(meta = {}, boundary = '', note = PROXY_NOTE) {
  const date = thaiDate(meta.retrievedOn || meta.asOf || '');
  const source = link(meta.sourcePage || `${PRODUCTION}?d=restaurant`, 'CityMETER Restaurants API สาธารณะ');
  const register = meta.registerChecked ? ` · ทะเบียนร้านเครือ ตรวจ ${esc(meta.registerChecked)}` : ' · ทะเบียนร้านเครือ';
  // Chain size, the price tiers' check and (0.9.2) the food taxonomy come from the register's classification tab: its own date.
  const segments = meta.segmentsOn ? ` · ${FOOD.groups.length ? 'ขนาดเครือและหมวดอาหาร' : 'ขนาดเครือ'}จัดกลุ่ม ${esc(thaiDate(meta.segmentsOn))}` : '';
  return `<p class="hint panel-foot provenance"><span>ชุดข้อมูล CityMETER Restaurants + ทะเบียนร้านเครือ</span> · <span>แหล่ง ${source}${register}${segments}</span> · <span>ดึงข้อมูล ${esc(date)}</span> · <span>ขอบเขต ${esc(boundary)}</span>${note ? `<br>${esc(note)}` : ''}</p>`;
}

/** The line under a place heading: its English name on a Thai page; on an English page (the heading reads the English
 * name) its Thai name, marked as Thai and left alone. */
const subName = (thai, english) => (LANG === 'en'
  ? (english ? `<p class="subtle" lang="th" translate="no">${esc(thai)}</p>` : '')
  : (english ? `<p class="subtle">${esc(english)}</p>` : ''));
const ratingText = rating => (rating == null ? 'ไม่มีคะแนน' : `${dec(rating)}`);
const words = areas => {
  const p = new Set(areas.map(a => a.province));
  return p.size === 1 ? areaWord([...p][0]) : 'พื้นที่';
};

/* ---------- shared pieces ---------- */

/**
 * Outbound searches of a view (owner 2026-10-29; 0.8.1 2026-11-03): a Google search with the question the user is
 * likely holding (answers at once, AI Overview on top when Google has one), Street View turned toward the place,
 * Google Maps — labelled “ค้นต่อ”, never evidence of the product. A Street View link that aims carries its target in
 * `data-aim-lat/lng`; the app places the camera from the map's streets when the link is used (js/app.js#aimStreetView).
 */
export function outboundRow(context, {label = 'ค้นต่อ'} = {}) {
  const links = Array.isArray(context) ? context : outboundFor(context);
  if (!links.length) return '';
  const title = l => (l.kind === 'maps' && l.question ? `${l.question} — เปิดร้านใน Google Maps (รูปหน้าร้าน เวลาเปิด รีวิว)` : l.question ? `${l.question} — ค้นใน Google (กดแท็บ AI Mode ในหน้านั้นเพื่อถามต่อ)` : l.aim ? 'Street View หันกล้องจากถนนเข้าหาจุดนี้ (ถนนที่ชื่อร้านหรือที่อยู่ระบุ ถ้าอยู่ใกล้พอ)' : '');
  const aim = l => (l.aim ? ` data-aim-lat="${esc(Number(l.aim.lat).toFixed(6))}" data-aim-lng="${esc(Number(l.aim.lng).toFixed(6))}"${l.aim.hint ? ` data-aim-hint="${esc(l.aim.hint)}"` : ''}` : '');
  return `<div class="outbound" role="group" aria-label="ค้นต่อภายนอก (Google)"><span class="outbound-label">${esc(label)}</span>${links.map(l =>
    `<a class="outbound-link is-${esc(l.kind)}" href="${esc(l.href)}" target="_blank" rel="noopener"${title(l) ? ` title="${esc(title(l))}"` : ''}${aim(l)}>${esc(l.label)}</a>`).join('')}</div>`;
}

/** The mark of an entry: the chain's logo when a verified file exists, else the food-type cue. */
function entryMark(r) {
  const logo = brandLogoMarkup(r.brand, {size: 'sm'});
  return logo || `<span class="entry-cue">${cueMarkup(r.series)}</span>`;
}

/** Meta line of a row: outlet → สาขาเครือ · ชั้น · จังหวัด; restaurant → type · ★ · reviews; + area when asked. */
function entryMeta(r, {showArea = false, index = null} = {}) {
  const area = showArea && index ? index.byId.get(r.area) : null;
  const parts = r.kind === 'outlet'
    ? ['สาขาเครือ', r.floor ? `ชั้น ${r.floor}` : '', !area && r.provinceTh ? r.provinceTh : '', !hasPoint(r) ? 'ยังไม่มีพิกัด' : '']
    : [r.type || 'ไม่ระบุประเภท', Number.isFinite(r.rating) ? `★ ${dec(r.rating)}` : '', Number.isFinite(r.reviews) ? `${num(r.reviews)} รีวิว` : ''];
  if (area) parts.push(`${areaWord(area.province)}${area.name}`);
  return parts.filter(Boolean).join(' · ');
}

/** One list entry, brand first: [logo | cue] เครือ · สาขา — meta. select-store opens a restaurant or an outlet. */
export function entryMarkup(r, {showArea = false, index = null, meta = null} = {}) {
  const p = entryParts(r);
  const m = meta ?? entryMeta(r, {showArea, index});
  return `<li><button type="button" class="brand-row entry" data-action="select-store" data-id="${esc(r.id)}" aria-label="${esc([p.primary, p.secondary, m].filter(Boolean).join(' · '))}">${entryMark(r)}<span class="entry-text"><strong>${esc(p.primary)}</strong>${p.secondary ? ` <span class="entry-branch">${esc(p.secondary)}</span>` : ''}${m ? `<br><span class="small muted">${esc(m)}</span>` : ''}</span></button></li>`;
}

function groupBars(byGroup, total, {limit = 6} = {}) {
  const list = byGroup.filter(g => g.count > 0).sort((a, b) => b.count - a.count);
  if (!list.length) return '<p class="hint">ไม่มีร้าน</p>';
  const max = Math.max(1, ...list.map(g => g.count));
  const shown = list.slice(0, limit), rest = list.slice(limit).reduce((s, g) => s + g.count, 0);
  return `<ul class="mix-list" aria-label="ประเภทร้าน (ร้าน)">${shown.map(g => `
    <li><span class="mix-label">${cueMarkup(g.series)}${esc(g.th)}</span>
      <span class="mix-track" aria-hidden="true"><span class="mix-fill category-${g.series}" style="width:${Math.max(3, Math.round((g.count / max) * 100))}%"></span></span>
      <span class="mix-value data-number" title="${num(g.count)} จาก ${num(total)} ร้าน">${num(g.count)}</span></li>`).join('')}</ul>${rest ? `<p class="hint">อื่น ๆ อีก ${num(list.length - limit)} ประเภท · ${num(rest)} ร้าน</p>` : ''}`;
}

function priceBars(byPrice) {
  const colors = priceColors();
  const priced = PRICED.reduce((s, b) => s + byPrice[b], 0);
  const max = Math.max(1, ...PRICED.map(b => byPrice[b]));
  const rows = PRICED.filter(b => byPrice[b] > 0).map(b => `
    <li><button type="button" class="mix-label link-button" data-action="filter-field" data-id="price" data-value="${b}" title="ดูเฉพาะร้านราคา ${esc(PRICE_LABELS[b])}"><i class="price-swatch" style="background:${colors[b]}" aria-hidden="true"></i>${esc(PRICE_LABELS[b])}</button>
      <span class="mix-track" aria-hidden="true"><span class="mix-fill" style="width:${Math.max(3, Math.round((byPrice[b] / max) * 100))}%;background:${colors[b]}"></span></span>
      <span class="mix-value data-number">${num(byPrice[b])}</span></li>`).join('');
  const unspecified = (byPrice.UNSPECIFIED || 0) + (byPrice.outlets || 0);
  return `${priced ? `<ul class="mix-list" aria-label="ระดับราคา (ร้านที่ระบุราคา)">${rows}</ul>` : '<p class="hint">ไม่มีร้านที่ระบุราคา</p>'}
    ${unspecified ? `<p class="hint">ไม่ระบุราคา ${num(unspecified)} ร้าน</p>` : ''}`;
}

/**
 * Chain size (0.8.0): rows per band, one neutral fill — the band name carries the order, so no second colour family
 * sits beside the price tiers. “1 สาขาที่พบ” is one observed row, never “an independent shop”.
 */
function sizeBars(bySize) {
  const sized = SIZE_BANDS.reduce((s, b) => s + (bySize?.[b] || 0), 0);
  if (!sized) return `<p class="hint">ไม่มีข้อมูลขนาดเครือ${bySize?.registry ? ` · ไม่จัดขนาด ${num(bySize.registry)} ร้าน` : ''}</p>`;
  const max = Math.max(1, ...SIZE_BANDS.map(b => bySize[b]));
  const rows = SIZE_BANDS.filter(b => bySize[b] > 0).map(b => `
    <li><button type="button" class="mix-label link-button" data-action="filter-field" data-id="size" data-value="${b}" title="ดูเฉพาะ${esc(SIZE_LABELS[b])}">${esc(SIZE_SHORT[b])}</button>
      <span class="mix-track" aria-hidden="true"><span class="mix-fill size-fill" style="width:${Math.max(3, Math.round((bySize[b] / max) * 100))}%"></span></span>
      <span class="mix-value data-number">${num(bySize[b])}</span></li>`).join('');
  const notes = [bySize.registry ? `ไม่จัดขนาด ${num(bySize.registry)} ร้าน` : '', bySize.unknown ? `ไม่มีข้อมูลขนาดเครือ ${num(bySize.unknown)} ร้าน` : ''].filter(Boolean);
  return `<ul class="mix-list" aria-label="ขนาดเครือ (ร้าน)">${rows}</ul>${notes.length ? `<p class="hint">${esc(notes.join(' · '))}</p>` : ''}`;
}

/**
 * The chain-size fact of one store or outlet: the band (a filter link). A band counted from name candidates, or taken
 * from the chain the name matched, is inferred and says so in one word; how the source counted stays in the title.
 */
export function sizeFact(r) {
  if (!r?.size) return r?.sizeBasis === 'x' ? `<dt>${pic('store')}ขนาดเครือ</dt><dd>ไม่จัดขนาด</dd>` : '';
  const how = r.sizeLifted ? SIZE_LIFTED : SIZE_BASIS[r.sizeBasis] || '';
  const inferred = r.sizeBasis === 'n' || (r.sizeLifted && r.kind !== 'outlet');
  return `<dt>${pic('store')}ขนาดเครือ</dt><dd><button type="button" class="link-button" data-action="filter-field" data-id="size" data-value="${esc(r.size)}"${how ? ` title="${esc(how)}"` : ''}>${esc(SIZE_LABELS[r.size])}</button>${inferred ? ` ${INFERRED}` : ''}</dd>`;
}
/**
 * A place's character in one line (js/profile-model.js#areaCharacter): pictogram · label · number, three tokens at most,
 * the chain share beside the same share everywhere.
 */
export function characterLine(c) {
  if (!c) return '';
  const parts = [];
  if (c.group) parts.push(`<span>${groupPic(c.group)}${esc(c.group.th)} <b class="data-number">${num(Math.round(c.group.share))}%</b></span>`);
  if (c.price) parts.push(`<span>${pic('price')}ราคาที่ระบุบ่อยสุด <b>${esc(PRICE_LABELS[c.price.tier])}</b> <small>${num(c.price.count)} จาก ${num(c.price.priced)} ร้านที่ระบุราคา</small></span>`);
  if (c.chains?.count) parts.push(`<span>${pic('brand')}เครือ 200+ สาขา <b class="data-number">${dec(c.chains.share)}%</b>${c.chains.baseline != null ? ` <small>ทุกพื้นที่ ${dec(c.chains.baseline)}%</small>` : ''}</span>`);
  return parts.length ? `<p class="character" aria-label="ลักษณะของพื้นที่">${parts.join('')}</p>` : '';
}
/**
 * The food taxonomy (0.9.2, register classification, an inference shown by owner decision 2026-11-03 16:59): one
 * section with the categories as bars (pictogram + label, one neutral fill — the map's type colours stay with the ten
 * source types), the groups as bars, and the commonest sub-groups as chips. Every bar or chip filters (`food`).
 * Unclassified rows are said apart, never a zero of a category.
 */
export function foodSection(byFood, {limit = 8} = {}) {
  if (!byFood || (!byFood.classified && !byFood.unclassified) || !FOOD.categories.length) return '';
  if (!byFood.classified) return `<section class="panel-section food-section"><div class="section-heading">${heading('segment', 'หมวดอาหาร')}${INFERRED}</div><p class="hint">ไม่จัดหมวด ${num(byFood.unclassified)} ร้าน</p></section>`;
  const bar = (id, label, count, max, cls = '') => `
    <li${cls ? ` class="${cls}"` : ''}><button type="button" class="mix-label link-button" data-action="filter-field" data-id="food" data-value="${esc(id)}" title="ดูเฉพาะ ${esc(foodLabel(id))}">${label}</button>
      <span class="mix-track" aria-hidden="true"><span class="mix-fill size-fill" style="width:${Math.max(3, Math.round((count / max) * 100))}%"></span></span>
      <span class="mix-value data-number">${num(count)}</span></li>`;
  const cats = FOOD.categories.filter(c => byFood.cats.get(c.id)).sort((a, b) => byFood.cats.get(b.id) - byFood.cats.get(a.id));
  const cmax = Math.max(1, ...cats.map(c => byFood.cats.get(c.id)));
  const groups = FOOD.groups.filter(g => byFood.groups.get(g.id)).sort((a, b) => byFood.groups.get(b.id) - byFood.groups.get(a.id));
  const gmax = Math.max(1, ...groups.map(g => byFood.groups.get(g.id)));
  // Menus a place has a few of (≥ 3 rows), most first; the rest stay one select away.
  const subs = FOOD.subgroups.filter(x => byFood.subs.get(x.id) >= 3 && !x.fallback).sort((a, b) => byFood.subs.get(b.id) - byFood.subs.get(a.id)).slice(0, 8);
  const catPic = id => (FOOD_CATEGORY_PICTOGRAM[id] ? `<i class="pictogram fact-pic pic-${esc(FOOD_CATEGORY_PICTOGRAM[id])}" aria-hidden="true"></i>` : '');
  return `<section class="panel-section food-section"><div class="section-heading">${heading('segment', 'หมวดอาหาร')}${INFERRED}<span class="hint">ร้าน</span></div>
    <ul class="mix-list" aria-label="หมวดอาหาร (ร้าน)">${cats.map(c => bar(c.id, `${catPic(c.id)}${esc(c.label)}`, byFood.cats.get(c.id), cmax)).join('')}</ul>
    <p class="food-sub-title">กลุ่มอาหาร</p>
    <ul class="mix-list food-groups" aria-label="กลุ่มอาหาร (ร้าน)">${groups.slice(0, limit).map(g => bar(g.id, esc(g.label), byFood.groups.get(g.id), gmax)).join('')}</ul>
    ${groups.length > limit ? `<p class="hint">อีก ${num(groups.length - limit)} กลุ่ม · ${num(groups.slice(limit).reduce((n, g) => n + byFood.groups.get(g.id), 0))} ร้าน</p>` : ''}
    ${subs.length ? `<p class="food-sub-title">เมนูที่พบมาก</p><ul class="chip-list">${subs.map(x => `<li><button type="button" class="brand-chip food-chip" data-action="filter-field" data-id="food" data-value="${esc(x.id)}" title="ดูเฉพาะ ${esc(foodLabel(x.id))}"><span>${esc(x.label)}</span><small class="data-number">${num(byFood.subs.get(x.id))}</small></button></li>`).join('')}</ul>` : ''}
    ${byFood.unclassified ? `<p class="hint">ไม่จัดหมวด ${num(byFood.unclassified)} ร้าน</p>` : ''}</section>`;
}
/** The overview's way in: six category chips with the scope's counts (0.9.2 — the owner could not find the taxonomy). */
export function foodChips(byFood, active = '') {
  if (!byFood?.classified || !FOOD.categories.length) return '';
  const cats = FOOD.categories.filter(c => byFood.cats.get(c.id));
  return `<section class="panel-section food-entry"><div class="section-heading">${heading('segment', 'ดูตามหมวดอาหาร')}${INFERRED}<button type="button" class="link-button hint" data-action="open-filters" data-id="food">กลุ่มและเมนูทั้งหมด</button></div>
    <ul class="chip-list">${cats.map(c => `<li><button type="button" class="brand-chip food-chip" data-action="filter-field" data-id="food" data-value="${esc(c.id)}" aria-pressed="${c.id === active}">${FOOD_CATEGORY_PICTOGRAM[c.id] ? `<i class="pictogram pic-${esc(FOOD_CATEGORY_PICTOGRAM[c.id])}" aria-hidden="true"></i>` : ''}<span>${esc(c.label)}</span><small class="data-number">${num(byFood.cats.get(c.id))}</small></button></li>`).join('')}</ul></section>`;
}
/** The food fact of one store or outlet: หมวด › กลุ่ม › เมนู, each a filter, and the word อนุมาน. */
export function foodFact(r) {
  if (!r?.food) return '';
  const link = (id, text) => `<button type="button" class="link-button" data-action="filter-field" data-id="food" data-value="${esc(id)}">${esc(text)}</button>`;
  const sub = r.foodSub ? FOOD.byId.get(r.foodSub) : null;
  const parts = [link(r.foodCat, foodLabel(r.foodCat)), link(r.food, foodLabel(r.food)), sub && !sub.fallback ? link(r.foodSub, sub.label) : ''].filter(Boolean);
  const kind = FOOD_CATEGORY_PICTOGRAM[r.foodCat] || 'segment';
  return `<dt>${pic(kind)}หมวดอาหาร</dt><dd>${parts.join(' › ')} ${INFERRED}</dd>`;
}
/** A decorative pictogram before a fact label (beside it, never instead of it — LDS ICON-01). */
const pic = kind => `<i class="pictogram fact-pic pic-${esc(kind)}" aria-hidden="true"></i>`;
/** The pictogram role of a type group (none for “other” and “not stated”). */
export const groupPic = group => (group && GROUP_PICTOGRAM[group.id] ? pic(GROUP_PICTOGRAM[group.id]) : '');

function restaurantList(rows, {showArea = false, index = null} = {}) {
  return `<ul class="outlet-list">${rows.map(r => entryMarkup(r, {showArea, index})).join('')}</ul>`;
}

/** Chain chips, brand first: logo + name + count (restaurants and outlets together); filter-brand by chain key. */
export function chainChips(chains, {empty = 'ไม่พบเครือร้านในพื้นที่นี้'} = {}) {
  if (!chains.length) return `<p class="hint">${esc(empty)}</p>`;
  return `<ul class="chip-list">${chains.map(c => {
    const name = chainLabel(c), lb = chainLogoBrand(c), key = c.key || c.brand?.id;
    return `<li><button type="button" class="brand-chip" data-action="filter-brand" data-value="${esc(key)}" title="${esc(name)} — ${num(c.count)} ร้าน (ดูเฉพาะเครือนี้)">${lb ? brandLogoMarkup(lb, {size: 'xs', className: 'chip-logo'}) : ''}<span>${esc(name)}</span><small class="data-number">${num(c.count)}</small></button></li>`;
  }).join('')}</ul>`;
}

function venueRows(venues) {
  return `<ul class="venue-list">${venues.map(v => `<li><button type="button" class="venue-row${getVenueLogo(v.venue) ? ' has-logo' : ''}" data-action="select-venue" data-id="${esc(v.venue.id)}" aria-label="${esc(v.venue.name)} ${num(v.count)} ร้าน">${venueLogoMarkup(v.venue, {size: 'sm'})}<span class="venue-name">${esc(v.venue.name)}<small>${esc(v.venue.typeTh || 'สถานที่')}</small></span><span class="venue-count data-number">${num(v.count)}<small>ร้าน</small></span></button></li>`).join('')}</ul>`;
}

/**
 * Area list with bars. Areas that meet the eligibility threshold carry a rank and a density bar;
 * areas below it are listed after them without a rank (their density would rest on a handful of rows).
 * byCount (no eligible area at all): rank and bar by restaurant count instead.
 */
function areaRanking(list, classify, {title = 'พื้นที่ที่ร้านแน่นที่สุด', note = '', limit = 10, minRows = 30, byCount = false} = {}) {
  const top = list.slice(0, limit);
  if (!top.length) return '';
  const value = a => (byCount ? a.count : a.density || 0);
  const max = Math.max(1, ...top.map(value));
  // Bar colour follows the bar's own measure: density class (the map legend) or, by count, the count class.
  const countClasses = byCount ? buildCountClasses(top.map(a => a.count)) : null;
  const fillOf = a => (byCount ? classifyValue(a.count, countClasses).fill : classify(a));
  let rank = 0;
  return `<section class="panel-section" aria-labelledby="rank-title">
    <div class="section-heading">${heading('area', title, 'rank-title')}<span class="hint">${esc(note)}</span></div>
    <ol class="rank-list">${top.map(a => {
      const ranked = byCount || a.count >= minRows;
      const label = ranked ? `อันดับ ${++rank}` : `น้อยกว่า ${num(minRows)} ร้าน ไม่จัดอันดับ`;
      const shown = byCount ? num(a.count) : dens(a.density || 0);
      return `<li><button type="button" class="rank-row${ranked ? '' : ' is-unranked'}" data-action="select-area" data-id="${esc(a.id)}" aria-label="${esc(label)} ${esc(a.name)} ${dens(a.density || 0)} ร้านต่อตารางกิโลเมตร ${num(a.count)} ร้าน">
        <span class="rank-index data-number" aria-hidden="true">${ranked ? rank : '·'}</span>
        <span class="rank-name">${esc(a.name)}<small>${esc(districtWord(a.province))}${esc(a.districtName)} · ${num(a.count)} ร้าน</small></span>
        <span class="rank-track" aria-hidden="true"><span class="rank-fill" style="width:${Math.max(3, Math.round((value(a) / max) * 100))}%;background:${fillOf(a)}"></span></span>
        <span class="rank-value data-number" aria-hidden="true">${shown}</span></button></li>`;
    }).join('')}</ol>
  </section>`;
}

/* ---------- Brand page (the overview under a chain filter) ---------- */

/** Provinces of a chain's rows as bars (unknown kept apart). */
function provinceBars(rows, {limit = 8} = {}) {
  const m = new Map();
  let unknown = 0;
  for (const r of rows) { if (!r.province) { unknown++; continue; } m.set(r.province, (m.get(r.province) || 0) + 1); }
  const list = [...m.entries()].map(([code, count]) => ({code, name: provinceName(code), count})).sort((a, b) => b.count - a.count);
  if (!list.length) return unknown ? `<p class="hint">ไม่ระบุจังหวัด ${num(unknown)} ร้าน</p>` : '';
  const max = Math.max(1, ...list.map(p => p.count));
  return `<ul class="mix-list" aria-label="จังหวัด (ร้าน)">${list.slice(0, limit).map(p => `
    <li><button type="button" class="mix-label link-button" data-action="select-province" data-id="${esc(p.code)}">${esc(p.name)}</button>
      <span class="mix-track" aria-hidden="true"><span class="mix-fill register-fill" style="width:${Math.max(3, Math.round((p.count / max) * 100))}%"></span></span>
      <span class="mix-value data-number">${num(p.count)}</span></li>`).join('')}</ul>${list.length > limit ? `<p class="hint">และอีก ${num(list.length - limit)} จังหวัด</p>` : ''}${unknown ? `<p class="hint">ไม่ระบุจังหวัด ${num(unknown)} ร้าน</p>` : ''}`;
}

/**
 * The head of a chain's page: logo, name, company, tiles (ร้าน · จังหวัด · บนแผนที่ · ประเภท), the outbound row and the
 * chain's provinces. `chain` = an entry of js/chains.js; `rows` = the scope's rows of that chain; `group` = its
 * derived food-type group (or null); `register` = the register brand (evidence mix) when it has one.
 */
export function renderBrandHead({chain, rows, group = null, groupBy = null, province = '', evidence = null}) {
  if (!chain) return '';
  const lb = chainLogoBrand(chain);
  const withPoint = rows.filter(hasPoint).length;
  const provinces = new Set(rows.map(r => r.province).filter(Boolean)).size;
  const company = chain.company?.name || '';
  const typeLabel = group ? group.th : '—';
  const typeHow = groupBy ? (groupBy.how === 'rows' ? `ตามร้านชื่อเดียวกัน ${num(groupBy.rows)} ร้านในชุดข้อมูล` : `ตามรูปแบบที่ทะเบียนระบุ (${groupBy.format || 'format'})`) : '';
  const outlets = rows.filter(r => r.kind === 'outlet').length;
  const ev = evidence && outlets ? `<p class="hint">หลักฐานสาขา: แหล่งของแบรนด์ ${num(evidence.primary || 0)} · แหล่งรอง ${num(evidence.secondary || 0)}${evidence.cart ? ` · รถเข็น ${num(evidence.cart)}` : ''}</p>` : '';
  const web = chain.register?.web || chain.candidates?.[0]?.source || '';
  return `<section class="detail-head store brand-head">
      ${lb ? brandLogoMarkup(lb, {size: 'lg', className: 'detail-logo', decorative: false}) : ''}
      <p class="eyebrow">เครือร้าน${company ? ` · ${esc(company)}` : ''}${chain.registry ? ' · ทะเบียนจุดขายหลายแบรนด์' : ''}</p>
      <h2>${esc(chainLabel(chain))}</h2>
      <div class="metrics compact">${metricTile(rows.length, 'ร้าน', 'store')}${metricTile(provinces ? provinces : '—', 'จังหวัด', 'province', provinces ? '' : 'ทะเบียนไม่ระบุจังหวัดของร้านเหล่านี้')}${metricTile(withPoint, 'บนแผนที่', 'area', 'ร้านที่มีพิกัด')}${metricTile(typeLabel, groupBy ? 'ประเภท · อนุมาน' : 'ประเภท', 'segment', typeHow)}</div>
      ${withPoint < rows.length ? `<p class="hint">ยังไม่มีพิกัด ${num(rows.length - withPoint)} ร้าน</p>` : ''}
      ${ev}
      ${outboundRow({kind: 'chain', name: chainLabel(chain), province: province ? provinceName(province) : ''})}
      <div class="detail-actions">${web ? link(web, 'เว็บของเครือ', 'btn quiet source-link') : ''}<button type="button" class="btn quiet" data-action="open-table">รายการ ${num(rows.length)}</button><button type="button" class="btn quiet" data-action="clear-filter" data-id="brand">ล้างตัวกรองเครือ</button></div>
    </section>
    <section class="panel-section"><div class="section-heading">${heading('province', 'จังหวัดที่มีร้าน')}<span class="hint">${num(provinces)} จังหวัด</span></div>${provinceBars(rows)}</section>`;
}

/* ---------- Overview ---------- */

/** focusMode: 'auto' (default top three) · 'explicit' (user-chosen) · 'none' (every area). */
/**
 * Lens chips (owner 2026-11-03 “สลับดูได้ 3 มุม”, js/lenses.js): one tap swaps the overview's preset filters. A chip is
 * pressed only when the filters are exactly its preset.
 */
export function lensRow(active = null) {
  return `<div class="lens-row" role="group" aria-label="มุมมองข้อค้นพบ">${LENSES.map(l => `<button type="button" class="lens-chip" data-action="lens" data-id="${esc(l.id)}" aria-pressed="${l.id === active}"${l.short !== l.label ? ` aria-label="${esc(l.label)}"` : ''}><i class="pictogram pic-${esc(l.pictogram)}" aria-hidden="true"></i>${esc(l.short || l.label)}</button>`).join('')}</div>`;
}
/** “ลองกับร้านแบบคุณ”: opens the type and price filters (the expansion team's own question). */
const TRY_YOURS = '<button type="button" class="btn quiet" data-action="open-filters"><i class="pictogram pic-tune" aria-hidden="true"></i>ลองกับร้านแบบคุณ</button>';

export function renderOverview({insight, summary, overview, focusMode = 'auto', classOf, provinces = [], meta = {}, coverage = null, province = '', extra = '',
  unknownProvince = 0, chains = [], chainTotal = 0, noPoint = 0, filtered = false, listRows = null, brandHead = '', search = '', searchChains = [], index = null,
  lens = null, lenses = false, lensStats = null, lensChains = [], byFood = null, food = ''}) {
  const foodEntry = foodChips(byFood, food);
  const count = insight.areas.length;
  const w = words(insight.areas);
  const names = insight.areas.map(a => `<button type="button" class="link-button" data-action="select-area" data-id="${esc(a.id)}">${esc(a.name)}</button>`).join(' · ');
  let aha;
  if (summary.count && !insight.areaCount) {
    // No แขวง/ตำบล frame holds a row of this scope: a จังหวัด outside the covered seven, or rows without a point.
    const why = noPoint === summary.count ? 'ยังไม่มีพิกัด — ดูรายชื่อด้านล่าง' : 'ดูเป็นหมุดบนแผนที่';
    aha = `<section class="aha" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก${search ? ` · ค้นหา “${esc(search)}”` : province ? ` · ${esc(provinceName(province))}` : ''}</p>
      <h2><span class="aha-number data-number">${num(summary.count)}</span><span class="aha-headline">ร้าน${summary.outlets === summary.count ? ' · สาขาเครือ' : ''}${province ? `ใน${esc(provinceName(province))}` : ''}</span></h2>
      <p class="aha-copy">${esc(why)}</p>
      <div class="aha-actions"><button type="button" data-action="open-table" class="btn">รายการ</button><button type="button" data-action="clear-filter" data-id="all" class="btn quiet">ล้างตัวกรอง</button></div></section>`;
  } else if (!summary.count) {
    aha = `<section class="aha" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก</p><h2>ไม่พบร้านตามตัวกรองนี้</h2>
      <div class="aha-actions"><button type="button" data-action="clear-filter" data-id="all" class="btn">ล้างตัวกรอง</button></div></section>`;
  } else if (focusMode === 'explicit') {
    aha = `<section class="aha is-focused" aria-label="ข้อค้นพบ"><p class="eyebrow">กำลังสำรวจ ${num(count)} ${esc(w)}</p>
      <h2>${insight.areas.map(a => esc(a.name)).join(' · ')}</h2>
      <p class="aha-copy"><strong class="data-number">${num(insight.count)}</strong> ร้าน · <strong class="data-number">${dens(insight.density || 0)}</strong> ร้าน/ตร.กม.</p>
      <div class="aha-actions"><button type="button" data-action="clear-focus" class="btn">ดูทุกพื้นที่</button><button type="button" data-action="open-charts" class="btn quiet">เปรียบเทียบพื้นที่</button></div></section>`;
  } else {
    const toggle = focusMode === 'auto'
      ? '<button type="button" data-action="clear-focus" class="btn">ดูทุกพื้นที่</button>'
      : `<button type="button" data-action="explore-top" class="btn primary">โฟกัส ${num(count)} ${esc(w)}นี้</button>`;
    const lensLabel = lens ? LENSES.find(l => l.id === lens)?.label || '' : '';
    const eyebrow = `ข้อค้นพบแรก${lensLabel ? ` · ${esc(lensLabel)}` : ''}`;
    const secondary = lens && lens !== 'density' ? '' : insight.mostReviewed ? `<p class="aha-secondary">รีวิวมากที่สุด: <button type="button" class="link-button" data-action="select-area" data-id="${esc(insight.mostReviewed.id)}">${esc(areaWord(insight.mostReviewed.province))}${esc(insight.mostReviewed.name)}</button> <span class="data-number">${num(insight.mostReviewed.reviews)}</span> รีวิว</p>` : '';
    const actions = `<div class="aha-actions">${toggle}${lenses ? TRY_YOURS : '<button type="button" data-action="open-charts" class="btn quiet">เปรียบเทียบพื้นที่</button>'}</div>`;
    const cls = `aha${focusMode === 'auto' ? ' is-auto' : ''}${lens ? ` is-lens lens-${lens}` : ''}`;
    if (lens === 'chains' && lensStats?.share != null) {
      // National chains (owner 2026-11-03): the share of 200+ chains among every restaurant of the three areas where
      // they are densest, beside the same share everywhere, and the chains themselves by logo.
      aha = `<section class="${cls}" aria-label="ข้อค้นพบ"><p class="eyebrow">${eyebrow}</p>
        <h2><span class="aha-number data-number">${dec(lensStats.share)}%</span><span class="aha-headline">ของร้านใน ${num(count)} ${esc(w)}นี้ เป็นเครือ 200+ สาขา</span></h2>
        <p class="aha-copy">${names}<br><strong class="data-number">${num(lensStats.count)}</strong> จาก ${num(lensStats.total)} ร้าน · ทุกพื้นที่ <strong class="data-number">${dec(lensStats.baseline)}%</strong></p>
        ${lensChains.length ? `<div class="aha-chains">${chainChips(lensChains)}</div>` : ''}
        ${actions}</section>`;
    } else if (insight.mode === 'density') {
      aha = `<section class="${cls}" aria-label="ข้อค้นพบ"><p class="eyebrow">${eyebrow}</p>
        <h2><span class="aha-number data-number">${dens(insight.density)}</span><span class="aha-headline">ร้าน/ตร.กม. — แน่นที่สุดใน ${num(count)} ${esc(w)}นี้</span></h2>
        <p class="aha-copy">${names}<br><strong class="data-number">${num(insight.count)}</strong> ร้าน ใน ${km(insight.km2)} ตร.กม.${insight.baselineDensity ? ` · ทุกพื้นที่ <strong class="data-number">${dens(insight.baselineDensity)}</strong>` : ''}</p>
        ${secondary}${actions}</section>`;
    } else {
      const what = lens === 'premium' ? 'ของร้านราคาเริ่ม 1,000 บาทขึ้นไป อยู่ใน' : 'ของร้านอยู่ใน';
      aha = `<section class="${cls}" aria-label="ข้อค้นพบ"><p class="eyebrow">${eyebrow}${search ? ` · ค้นหา “${esc(search)}”` : ''}</p>
        <h2><span class="aha-number data-number">${lens ? dec(insight.share) : num(Math.round(insight.share))}%</span><span class="aha-headline">${what} ${num(count)} ${esc(w)}นี้</span></h2>
        <p class="aha-copy">${names}<br><strong class="data-number">${num(insight.count)}</strong> จาก ${num(insight.totalRows)} ร้าน</p>
        ${secondary}${actions}</section>`;
    }
  }
  // A chain's page is its own Aha: the small-selection finding (“N% ของร้านอยู่ใน 3 พื้นที่”) adds nothing there.
  if (brandHead && insight.mode !== 'density') aha = '';
  if (lenses && !brandHead) aha = lensRow(lens) + aha;
  const narrowed = focusMode !== 'none' && count > 0 && summary.count !== insight.totalRows;
  const coverageDensity = coverage?.km2 ? (insight.framedRows ?? insight.totalRows) / coverage.km2 : null;
  const metrics = `<section class="metrics" aria-label="${narrowed ? 'ตัวเลขของพื้นที่ที่โฟกัส' : 'ตัวเลขรวมของข้อมูลที่เลือก'}">
    ${metricTile(summary.count, `ร้าน${narrowed ? ' ในโฟกัส' : ''}`, 'store', 'ร้านในชุดข้อมูลและสาขาเครือ นับรวมกัน')}
    ${metricTile(narrowed ? dens(insight.density || 0) : (coverageDensity ? dens(coverageDensity) : '—'), narrowed ? 'ร้าน/ตร.กม. ในโฟกัส' : 'ร้าน/ตร.กม. พื้นที่ที่มีข้อมูล', 'gla')}
    ${metricTile(summary.reviewed ? summary.reviews : '—', `รีวิว${narrowed ? ' ในโฟกัส' : ''}`, 'exclusive')}
    ${metricTile(summary.brands, `เครือร้าน${narrowed ? ' ในโฟกัส' : ''}`, 'brand')}
  </section>${noPoint && filtered && !brandHead ? `<p class="hint population-line">ยังไม่มีพิกัด ${num(noPoint)} ร้าน</p>` : ''}`;
  const scope = province ? `${provinceName(province)} · ${coverage?.areas ? `${num(coverage.areas)} ` : ''}${areaWordFor(province)}ที่มีร้าน` : `ร้าน 7 จังหวัด + สาขาเครือทั่วประเทศ · ${coverage?.areas ? `${num(coverage.areas)} ` : ''}แขวง/ตำบลที่มีร้าน`;
  const matches = search && searchChains.length ? `<section class="panel-section"><div class="section-heading">${heading('brand', 'เครือที่ตรงกับคำค้น')}<span class="hint">${num(searchChains.length)} เครือ</span></div>${chainChips(searchChains)}</section>` : '';
  const list = listRows?.length ? `<section class="panel-section"><div class="section-heading">${heading('store', 'รายการ')}<span class="hint">${num(listRows.length)} ร้าน</span></div>${restaurantList(listRows, {showArea: true, index})}</section>` : '';
  const provinceRow = p => `<li><button type="button" class="province-row" data-action="select-province" data-id="${esc(p.code)}" aria-label="${esc(p.name)} ${num(p.count)} ร้าน กดเพื่อดูจังหวัด"><i class="province-swatch" style="background:${esc(p.fill)}" aria-hidden="true"></i><span class="province-name">${esc(p.name)}${p.covered === false ? '<small>สาขาเครือเท่านั้น</small>' : ''}</span><span class="province-count data-number">${num(p.count)}<small>ร้าน</small></span></button></li>`;
  const PROVINCE_SHOWN = 8;
  const provinceList = provinces.length > 1 ? `<section class="panel-section" aria-labelledby="province-title">
    <div class="section-heading">${heading('province', 'จังหวัดที่มีร้าน', 'province-title')}<span class="hint">${num(provinces.length)} จังหวัด</span></div>
    <ul class="province-list">${provinces.slice(0, PROVINCE_SHOWN).map(provinceRow).join('')}</ul>
    ${provinces.length > PROVINCE_SHOWN ? `<details class="more-list"><summary>อีก ${num(provinces.length - PROVINCE_SHOWN)} จังหวัด</summary><ul class="province-list">${provinces.slice(PROVINCE_SHOWN).map(provinceRow).join('')}</ul></details>` : ''}
    ${unknownProvince ? `<p class="hint">ไม่ทราบจังหวัด ${num(unknownProvince)} ร้าน</p>` : ''}
  </section>` : '';
  const eligible = overview.ranking.eligible.length > 0;
  const rank = areaRanking(eligible ? overview.ranking.eligible : overview.ranking.small, classOf,
    {title: eligible ? 'พื้นที่ที่ร้านแน่นที่สุด' : 'พื้นที่ที่มีร้านมากที่สุด', minRows: overview.ranking.minRows, byCount: !eligible, limit: 8,
      note: eligible ? 'ร้าน/ตร.กม.' : 'เรียงตามจำนวนร้าน'});
  const chainSection = chains.length && !brandHead ? `<section class="panel-section"><div class="section-heading">${heading('brand', 'เครือร้านที่พบมากที่สุด')}<span class="hint">${num(chainTotal || chains.length)} เครือ</span></div>${chainChips(chains)}<div class="detail-actions"><button type="button" class="btn quiet" data-action="open-chains">เครือทั้งหมด${chainTotal ? ` (${num(chainTotal)})` : ''}</button></div></section>` : '';
  const outbound = brandHead ? '' : outboundRow({kind: 'country', province: province ? provinceName(province) : ''});
  const boundary = province && !coverage?.areas ? `${provinceName(province)} (ขอบเขตจังหวัดของ CityMETER · สาขาเครือ)` : `${scope} (ขอบเขตแขวง/ตำบลของ CityMETER)`;
  return `${brandHead}${aha}${brandHead ? '' : metrics}${brandHead ? '' : foodEntry}${outbound}${matches}${list}${provinceList}${rank}${chainSection}${extra}${provenance(meta, boundary)}`;
}

const areaWordFor = province => (province === 'BKK' ? 'แขวง' : 'ตำบล');

/* ---------- District ---------- */

/**
 * Empty selections, in EVID-05 terms: no_data (the source lists no restaurant there at all — never “0 ร้าน”)
 * vs measured_zero (covered, but the current filters leave 0 — offer the areas where the filters do match).
 */
function selectionNote(p, place) {
  if (p.coverageState === 'no_data') {
    return `<div class="empty-note" role="note"><strong>ไม่มีข้อมูลร้านใน${esc(place)}</strong></div>`;
  }
  if (p.coverageState === 'measured_zero') {
    const elsewhere = p.scopeCount > 0
      ? `<span>ตัวกรองเดียวกันพบ <strong class="data-number">${num(p.scopeCount)}</strong> ร้านในพื้นที่อื่น</span><button type="button" class="btn quiet" data-action="leave-area">ดูพื้นที่ที่พบ</button>`
      : '<span>ตัวกรองนี้ไม่พบร้านในพื้นที่ใดเลย ลองล้างตัวกรอง</span>';
    return `<div class="empty-note" role="note"><strong>ไม่พบร้านตามตัวกรองใน${esc(place)}</strong>${elsewhere}</div>`;
  }
  return '';
}

const areaOutbound = (kind, a, w) => outboundRow({kind, area: kind === 'area' ? `${w.area}${a.name}` : '', district: kind === 'area' ? `${w.district}${a.districtName}` : `${w.district}${a.name}`, province: provinceName(a.province), lat: a.label?.[1], lng: a.label?.[0]});

export function renderDistrict(p, classOf, meta = {}, extra = '') {
  if (!p) return '';
  const d = p.district;
  const w = p.words;
  const ranked = p.areas.filter(a => a.count >= 1);
  const rankText = p.coverageState === 'no_data' ? 'ไม่มีข้อมูล' : p.rank ? `อันดับความหนาแน่น ${num(p.rank)} จาก ${num(p.rankOf)}` : 'ไม่จัดอันดับ';
  const place = `${w.district}${d.name}`;
  const head = `<section class="detail-head">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">${esc(w.district)} · ${esc(provinceName(d.province))} · ${esc(rankText)}</p>
      <h2>${esc(w.district)}${esc(d.name)}</h2>${subName(`${w.district}${d.name}`, d.nameEn)}
      ${p.coverageState === 'no_data' ? '' : `<div class="metrics compact">${metricTile(p.count, 'ร้าน', 'store')}${metricTile(dens(p.density), 'ร้าน/ตร.กม.', 'gla', `${km(p.km2 || 0)} ตร.กม.`)}${metricTile(p.reviewed ? p.reviews : '—', 'รีวิว', 'exclusive')}${metricTile(`${num(ranked.length)}/${num(p.areaTotal)}`, `${w.area}ที่มีร้าน`, 'area')}</div>`}
      ${characterLine(p.character)}
      ${selectionNote(p, place)}
      ${areaOutbound('district', d, w)}
      <div class="detail-actions">${p.count ? '<button type="button" class="btn" data-action="open-table">รายการ</button><button type="button" class="btn quiet" data-action="open-charts">เปรียบเทียบพื้นที่</button>' : ''}${link(productionLink({province: d.province, district: d.id}), 'ดูใน CityMETER', 'btn quiet source-link')}</div>
    </section>
`;
  if (!p.count) return `${head}${extra}${provenance(meta, `${place} ${provinceName(d.province)} (ขอบเขต CityMETER)`)}`;
  return `${head}    ${areaRanking(ranked, classOf, {title: `${w.area}ใน${w.district}นี้`, note: `${num(ranked.length)} ${w.area} · ร้าน/ตร.กม.`, limit: 40, minRows: p.minRows})}
    <section class="panel-section"><div class="section-heading">${heading('segment', 'ประเภทร้าน')}<span class="hint">ร้าน</span></div>${groupBars(p.byGroup, p.count)}</section>
    ${foodSection(p.byFood)}
    <section class="panel-section"><div class="section-heading">${heading('price', 'ระดับราคา')}<span class="hint">ร้านที่ระบุราคา</span></div>${priceBars(p.byPrice)}</section>
    <section class="panel-section"><div class="section-heading">${heading('store', 'ขนาดเครือ')}<span class="hint">ร้าน</span></div>${sizeBars(p.bySize)}</section>
    <section class="panel-section"><div class="section-heading">${heading('brand', 'เครือร้าน')}<span class="hint">${num(p.chainTotal ?? p.chains.length)} เครือ</span></div>${chainChips(p.chains)}${shownOf(p.chains.length, p.chainTotal ?? p.chains.length, 'เครือ', 'ร้านมากก่อน')}</section>
    ${p.venues.length ? `<section class="panel-section"><div class="section-heading">${heading('venue', 'สถานที่ที่ชื่อร้านอ้างถึง')}<span class="hint">${num(p.venueTotal ?? p.venues.length)} แห่ง</span></div>${venueRows(p.venues)}${shownOf(p.venues.length, p.venueTotal ?? p.venues.length, 'แห่ง', 'ร้านมากก่อน')}</section>` : ''}
    ${extra}${provenance(meta, `${w.district}${d.name} ${provinceName(d.province)} (ขอบเขต CityMETER)`)}`;
}

/* ---------- Area (แขวง/ตำบล) ---------- */

export function renderArea(p, meta = {}, extra = '') {
  if (!p) return '';
  const a = p.area, w = p.words;
  const rankText = p.coverageState === 'no_data' ? 'ไม่มีข้อมูล' : p.rank ? `อันดับความหนาแน่น ${num(p.rank)} จาก ${num(p.rankOf)}` : 'ไม่จัดอันดับ';
  const place = `${w.area}${a.name}`;
  const head = `<section class="detail-head">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">${esc(w.area)} · <button type="button" class="link-button" data-action="select-district" data-id="${esc(a.district)}">${esc(w.district)}${esc(a.districtName)}</button> · ${esc(rankText)}</p>
      <h2>${esc(w.area)}${esc(a.name)}</h2>${subName(`${w.area}${a.name}`, a.nameEn)}
      ${p.coverageState === 'no_data' ? '' : `<div class="metrics compact">${metricTile(p.count, 'ร้าน', 'store')}${metricTile(dens(p.density), 'ร้าน/ตร.กม.', 'gla', `${km(p.km2 || 0)} ตร.กม.`)}${metricTile(p.reviewed ? p.reviews : '—', 'รีวิว', 'exclusive')}${metricTile(ratingText(p.ratingMean), 'คะแนนเฉลี่ย', 'exclusive', p.rated ? `เฉลี่ยจาก ${num(p.rated)} ร้านที่มีคะแนน` : '')}</div>`}
      ${characterLine(p.character)}
      ${selectionNote(p, place)}
      ${areaOutbound('area', a, w)}
      <div class="detail-actions">${p.count ? '<button type="button" class="btn" data-action="open-table">รายการ</button><button type="button" class="btn quiet" data-action="open-charts">เปรียบเทียบพื้นที่</button>' : ''}${link(productionLink({province: a.province, area: a.id}), 'ดูใน CityMETER', 'btn quiet source-link')}</div>
    </section>
`;
  if (!p.count) return `${head}${extra}${provenance(meta, `${place} ${w.district}${a.districtName} ${provinceName(a.province)} (ขอบเขต CityMETER)`)}`;
  return `${head}    <section class="panel-section"><div class="section-heading">${heading('segment', 'ประเภทร้าน')}<span class="hint">ร้าน</span></div>${groupBars(p.byGroup, p.count)}</section>
    ${foodSection(p.byFood)}
    <section class="panel-section"><div class="section-heading">${heading('price', 'ระดับราคา')}<span class="hint">ร้านที่ระบุราคา</span></div>${priceBars(p.byPrice)}</section>
    <section class="panel-section"><div class="section-heading">${heading('store', 'ขนาดเครือ')}<span class="hint">ร้าน</span></div>${sizeBars(p.bySize)}</section>
    ${p.topReviewed.length ? `<section class="panel-section"><div class="section-heading">${heading('exclusive', 'รีวิวมากที่สุด')}<span class="hint">${num(p.topReviewed.length)} ร้าน</span></div>${restaurantList(p.topReviewed)}</section>` : ''}
    <section class="panel-section"><div class="section-heading">${heading('brand', 'เครือร้านในพื้นที่')}<span class="hint">${num(p.chainTotal ?? p.chains.length)} เครือ</span></div>${chainChips(p.chains)}${shownOf(p.chains.length, p.chainTotal ?? p.chains.length, 'เครือ', 'ร้านมากก่อน')}</section>
    ${p.venues.length ? `<section class="panel-section"><div class="section-heading">${heading('venue', 'สถานที่ที่ชื่อร้านอ้างถึง')}<span class="hint">${num(p.venueTotal ?? p.venues.length)} แห่ง</span></div>${venueRows(p.venues)}${shownOf(p.venues.length, p.venueTotal ?? p.venues.length, 'แห่ง', 'ร้านมากก่อน')}</section>` : ''}
    ${extra}${provenance(meta, `${w.area}${a.name} ${w.district}${a.districtName} ${provinceName(a.province)} (ขอบเขต CityMETER)`)}`;
}

/* ---------- Venue ---------- */

export function renderVenue(v, index, meta = {}, extra = '') {
  if (!v) return '';
  const logo = getVenueLogo(v.venue);
  const sp = v.spatial;
  const pt = v.rows.find(hasPoint);
  return `<section class="detail-head venue${logo ? ' has-venue-logo' : ''}">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      ${logo ? venueLogoMarkup(v.venue, {size: 'lg', className: 'detail-venue-logo', decorative: false}) : ''}
      <p class="eyebrow">${esc(v.venue.typeTh || 'สถานที่')}${logo?.roleLabel ? ` · <span class="venue-logo-role">${esc(logo.roleLabel)}</span>` : ''}${v.nameDerived ? ' · สถานที่จากชื่อร้าน' : ''}</p>
      <h2>${esc(v.venue.name)}</h2>
      <div class="metrics compact">${metricTile(v.count, 'ร้าน', 'store')}${metricTile(v.areas.length, 'พื้นที่', 'area')}${metricTile(v.reviewed ? v.reviews : '—', 'รีวิว', 'exclusive')}</div>
      ${v.entityRows ? `<p class="hint">รวม ${num(v.entityRows)} รายการที่เป็นชื่อสถานที่เอง (${num(v.entityReviews)} รีวิว)</p>` : ''}
      ${outboundRow({kind: 'venue', name: v.venue.name, province: v.province ? provinceName(v.province) : '', lat: pt?.latitude, lng: pt?.longitude})}
    </section>
    <section class="panel-section"><div class="section-heading">${heading('store', `ร้านที่ชื่ออ้างถึง ${v.venue.name}`)}<span class="hint">${num(v.count)}</span></div>${restaurantList(v.rows, {showArea: true, index})}
      ${v.entityRows ? `<p class="hint">รวม ${num(v.entityRows)} รายการที่เป็นชื่อสถานที่เอง</p>` : ''}</section>
    ${sp ? `<section class="panel-section venue-spatial"><div class="section-heading">${heading('venue', 'ร้านอื่นที่จุดตกในอาคารเดียวกัน')}<span class="hint">${num(sp.count)} ร้าน</span></div>
      ${sp.count ? restaurantList(sp.others, {showArea: true, index}) : '<p class="hint">ไม่มีร้านอื่นตามตัวกรองนี้</p>'}
      ${sp.count > sp.others.length ? `<p class="hint">แสดง ${num(sp.others.length)} จาก ${num(sp.count)} ร้าน (รีวิวมากก่อน)</p>` : ''}</section>` : ''}
    <section class="panel-section"><div class="section-heading">${heading('segment', 'ประเภทร้าน')}</div>${groupBars(v.byGroup, v.count)}</section>
    ${foodSection(v.byFood, {limit: 6})}
    ${extra}${provenance(meta, `ร้านที่ชื่ออ้างถึง ${v.venue.name}${v.provinces.length === 1 ? ` · ${provinceName(v.provinces[0])}` : ''}`)}`;
}

/* ---------- Building (spatial join) ---------- */

export function renderBuilding(b, meta = {}, extra = '') {
  if (!b) return '';
  const w = b.words;
  const area = b.area ? `${w.area}${b.area.name}` : '';
  const height = b.height != null ? `สูงราว ${num(Math.round(b.height))} ม.` : '';
  const pt = b.rows.find(hasPoint);
  return `<section class="detail-head building">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">อาคารบนแผนที่${area ? ` · ${b.area ? `<button type="button" class="link-button" data-action="select-area" data-id="${esc(b.area.id)}">${esc(area)}</button>` : ''}` : ''}</p>
      <h2>ร้านที่จุดตกในอาคารนี้</h2>
      <div class="metrics compact">${metricTile(b.count, 'ร้าน', 'store')}${metricTile(b.reviewed ? b.reviews : '—', 'รีวิว', 'exclusive')}${b.ratingMean != null ? metricTile(dec(b.ratingMean), 'คะแนนเฉลี่ย', 'plain') : ''}</div>
      ${height ? `<p class="hint">${pic('building')}${esc(height)}</p>` : ''}
      ${outboundRow({kind: 'venue', name: `อาคาร ${area}`, province: b.rows[0] ? provinceName(b.rows[0].province) : '', lat: pt?.latitude, lng: pt?.longitude})}
    </section>
    <section class="panel-section"><div class="section-heading">${heading('store', 'ร้าน')}<span class="hint">${num(b.count)}</span></div>${restaurantList(b.rows.slice(0, 40), {showArea: b.areaCount > 1, index: meta.index})}
      ${b.count > 40 ? `<p class="hint">แสดง ${num(40)} จาก ${num(b.count)} ร้าน (รีวิวมากก่อน) · ดูทั้งหมดในรายการ</p>` : ''}</section>
    ${b.venues.length ? `<section class="panel-section"><div class="section-heading">${heading('venue', 'สถานที่ที่ชื่อร้านอ้างถึง')}<span class="hint">${num(b.venueTotal ?? b.venues.length)} แห่ง</span></div>${venueRows(b.venues)}${shownOf(b.venues.length, b.venueTotal ?? b.venues.length, 'แห่ง', 'ร้านมากก่อน')}</section>` : ''}
    <section class="panel-section"><div class="section-heading">${heading('segment', 'ประเภทร้าน')}</div>${groupBars(b.byGroup, b.count)}</section>
    ${foodSection(b.byFood, {limit: 6})}
    ${extra}${provenance(meta, `จุดของร้านที่ตกในขอบอาคาร OpenStreetMap หนึ่งหลัง${area ? ` · ${area} (ขอบเขต CityMETER)` : ''}`)}`;
}

/* ---------- Store ---------- */

export function renderStore(d, meta = {}, {extraFacts = '', extra = ''} = {}) {
  if (!d) return '';
  const r = d.row, w = d.words;
  const blogo = getBrandLogo(r.brand);
  const parts = entryParts(r);
  // The API's display position; a pin drawn inside a Land building (within 10 m of it) keeps the source values here.
  const lat = r.sourceLatitude ?? r.latitude, lon = r.sourceLongitude ?? r.longitude;
  const coords = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  const rating = Number.isFinite(r.rating) ? `<span class="data-number">${dec(r.rating)}</span>${Number.isFinite(r.reviews) ? ` · <span class="data-number">${num(r.reviews)}</span> รีวิว` : ''}` : 'ไม่มีคะแนน';
  // The price the source states (“100–200 บาท”, “เริ่ม 1,000 บาท”); the tier it falls in is the filter the button opens.
  const p0 = Number.isFinite(r.p0) ? r.p0 : null, p1 = Number.isFinite(r.p1) ? r.p1 : null;
  const stated = p0 != null && p1 != null ? (p0 === p1 ? `${num(p0)} บาท` : `${num(p0)}–${num(p1)} บาท`) : p0 != null ? `เริ่ม ${num(p0)} บาท` : p1 != null ? `ไม่เกิน ${num(p1)} บาท` : PRICE_LABELS[r.price];
  const price = r.price === 'UNSPECIFIED' ? 'ไม่ระบุราคา' : `<button type="button" class="link-button" data-action="filter-field" data-id="price" data-value="${esc(r.price)}" title="ดูร้านราคา ${esc(PRICE_LABELS[r.price])}">${esc(stated)}</button>`;
  const brand = r.brand ? `<dt>${pic('brand')}เครือร้าน</dt><dd class="fact-brand"><span><button type="button" class="link-button" data-action="filter-brand" data-value="${esc(r.brand.national?.[0] || r.brand.id)}">${esc(r.brand.name)}</button> ${r.brand.hold ? '<small class="inferred">รอยืนยัน</small>' : INFERRED}</span></dd>` : '';
  const venue = r.venue ? `<dt>${pic('venue')}สถานที่</dt><dd class="fact-venue">${venueLogoMarkup(r.venue, {size: 'md'})}<span><button type="button" class="link-button" data-action="select-venue" data-id="${esc(r.venue.id)}">${esc(r.venue.name)}</button>${r.venueEntity ? '' : ` ${INFERRED}`}</span></dd>` : '';
  const bd = d.building;
  const building = bd ? `<dt>${pic('building')}อาคาร</dt><dd>${bd.others ? `<button type="button" class="link-button" data-action="select-building" data-id="${esc(bd.key)}">จุดตกในอาคารเดียวกันอีก ${num(bd.others)} ร้าน →</button>` : 'ไม่มีร้านอื่นในอาคารนี้'}</dd>` : '';
  const area = d.area ? `<button type="button" class="link-button" data-action="select-area" data-id="${esc(d.area.id)}">${esc(w.area)}${esc(d.area.name)}</button> · <button type="button" class="link-button" data-action="select-district" data-id="${esc(d.area.district)}">${esc(w.district)}${esc(d.area.districtName)}</button>` : '—';
  const outbound = outboundRow({kind: 'store', brand: r.brand?.name || '', branch: parts.secondary, name: r.name, hint: r.name, area: d.area ? `${w.area}${d.area.name}` : '', district: d.area ? `${w.district}${d.area.districtName}` : '', province: provinceName(r.province), lat, lng: lon});
  return `<section class="detail-head store">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      ${blogo ? brandLogoMarkup(r.brand, {size: 'lg', className: 'detail-logo', decorative: false}) : ''}
      <p class="eyebrow eyebrow-cue">${cueMarkup(r.series)}${groupPic(d.group)}${esc(d.group?.th || '')}${r.type && r.type !== d.group?.th ? ` · ${esc(r.type)}` : ''}</p>
      <h2>${esc(parts.primary || 'ไม่มีชื่อในแหล่งข้อมูล')}</h2>
      ${parts.secondary ? `<p class="subtle entry-branch-line">${esc(parts.secondary)}</p>` : ''}
      ${outbound}
      <dl class="facts">
        <dt>${pic('exclusive')}คะแนน</dt><dd>${rating}</dd>
        <dt>${pic('price')}ราคา</dt><dd>${price}</dd>
        ${foodFact(r)}${brand}${sizeFact(r)}${venue}${building}${extraFacts}
        <dt>${pic('area')}พื้นที่</dt><dd>${area}</dd>
        <dt>${pic('place')}พิกัด</dt><dd><span class="data-number">${esc(coords)}</span>${d.coLocated ? `<br><span class="hint">ตำแหน่งเดียวกับอีก ${num(d.coLocated)} ร้าน</span>` : ''}</dd>
        <dt>แหล่งข้อมูล</dt><dd>CityMETER Restaurants API สาธารณะ · ดึงข้อมูล ${esc(thaiDate(meta.retrievedOn || meta.asOf || ''))}<br><span class="hint data-number" title="รหัสสังเกตการณ์ในชุดข้อมูลนี้ (ย่อ)">รหัส R-${esc(r.id.split('-')[0])}…</span></dd>
      </dl>
      <p class="links">${d.area ? link(productionLink({province: r.province, area: r.area}), 'ดูพื้นที่นี้ใน CityMETER') : ''} ${blogo && blogo.sourcePage ? link(blogo.sourcePage, 'ที่มาโลโก้') : ''}</p>
    </section>
    ${r.brand ? `<section class="panel-section"><div class="section-heading">${heading('brand', `${r.brand.name} ที่อื่น`)}<span class="hint">${num(d.sameBrand.count)} ร้าน · ${num(d.sameBrand.areas)} พื้นที่</span></div>
      ${d.sameBrand.rows.length ? restaurantList(d.sameBrand.rows, {showArea: true, index: meta.index}) : '<p class="hint">ไม่มีในตัวกรองนี้</p>'}
      <div class="detail-actions"><button type="button" class="btn quiet" data-action="filter-brand" data-value="${esc(r.brand.national?.[0] || r.brand.id)}">ดูเฉพาะเครือนี้</button></div></section>` : ''}
    ${d.sameArea.length ? `<section class="panel-section"><div class="section-heading">${heading('segment', `${d.group?.th || 'ร้าน'}อื่นในพื้นที่`)}</div>${restaurantList(d.sameArea)}</section>` : ''}
    ${extra}${provenance(meta, d.area ? `${w.area}${d.area.name} ${provinceName(r.province)} (ขอบเขต CityMETER)` : provinceName(r.province))}`;
}

/* ---------- Active filter chips ---------- */

export function renderFilterChips(values, labels) {
  const chips = [];
  const push = (key, text) => chips.push(`<li><button type="button" class="filter-chip" data-action="clear-filter" data-id="${esc(key)}" aria-label="ล้างตัวกรอง ${esc(text)}"><span>${esc(text)}</span><i aria-hidden="true">×</i></button></li>`);
  if (values.search) push('search', `ค้นหา “${values.search}”`);
  if (values.group) push('group', labels.group[values.group] || values.group);
  if (values.food) push('food', `${labels.food?.[values.food] || values.food} · อนุมาน`);
  if (values.price) push('price', labels.price[values.price] || values.price);
  if (values.size) push('size', labels.size?.[values.size] || values.size);
  if (values.province) push('province', labels.province[values.province] || values.province);
  if (values.brand) push('brand', labels.brand[values.brand] || values.brand);
  if (values.venue) push('venue', labels.venue[values.venue] || values.venue);
  return chips.length ? `<ul class="filter-chips" aria-label="ตัวกรองที่ใช้อยู่">${chips.join('')}<li><button type="button" class="filter-chip clear-all" data-action="clear-filter" data-id="all">ล้างทั้งหมด</button></li></ul>` : '';
}

export {PRICE_SHORT, restaurantList};

/**
 * Reading panel views as HTML strings. Pure: no DOM access, no map.
 *
 * Every actionable element carries data-action (+ data-id / data-value); the app
 * binds one delegated handler. Actions: select-area · select-district ·
 * select-store · select-venue · select-building · select-province · filter-brand ·
 * back · explore-top · clear-focus · open-charts · open-table · clear-filter.
 *
 * Building wording (spatial join, js/building-join.js): "จุดของร้านตกในอาคาร" — the
 * display point falls inside the drawn outline (≈ 9.55 m grid); never "ตั้งอยู่ใน".
 *
 * Copy is short, natural Thai. Units: ร้าน = one restaurant observation of the
 * source; ร้าน/ตร.กม. = rows ÷ production area; รีวิว / คะแนน = the source's
 * popularity proxies (not sales); เครือร้าน and สถานที่ links come from restaurant
 * names (candidates). Missing is never shown as 0. Metric tiles and headings carry
 * the pictogram subset (js/navigation.js PICTOGRAM_CONTRACT); text is the meaning.
 */
import {PRICED, PRICE_LABELS, PRICE_SHORT, productionLink, provinceByCode, PRODUCTION} from './model.js';
import {areaWord, districtWord} from './areas.js';
import {brandLogoMarkup, getBrandLogo} from './brand-logos.js';
import {venueLogoMarkup, getVenueLogo} from './venue-logos.js';
import {priceColors, buildCountClasses, classify as classifyValue} from './scales.js';
import {cueMarkup} from './cues.js';

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
export function metricTile(value, label, kind = '') {
  const shown = typeof value === 'string' ? value : num(value);
  return `<div class="metric${kind ? ` metric-${kind}` : ''}"><i class="metric-symbol pictogram pic-${esc(kind || 'plain')}" aria-hidden="true"></i><strong class="data-number">${esc(shown)}</strong><span>${esc(label)}</span></div>`;
}
export const heading = (kind, text, id = '') => `<h3${id ? ` id="${esc(id)}"` : ''}><i class="pictogram pic-${esc(kind)}" aria-hidden="true"></i>${esc(text)}</h3>`;

/** A list cut at n says so: “แสดง n จาก N …” (a header always carries the total). */
const shownOf = (n, total, unit, order = '') => (total > n ? `<p class="hint">แสดง ${num(n)} จาก ${num(total)} ${unit}${order ? ` (${order})` : ''}</p>` : '');
const PROXY_NOTE = 'ร้าน = รายการในชุดข้อมูล ไม่ใช่จำนวนร้านทั้งหมดของพื้นที่ · คะแนนและรีวิวบอกความนิยมตามแหล่งข้อมูล ไม่ใช่ยอดขาย';
const provinceName = code => provinceByCode(code)?.th || code || '';

/** Every view that shows numbers ends with dataset · source · date · boundary. */
export function provenance(meta = {}, boundary = '', note = PROXY_NOTE) {
  const date = thaiDate(meta.retrievedOn || meta.asOf || '');
  const source = link(meta.sourcePage || `${PRODUCTION}?d=restaurant`, 'CityMETER Restaurants API สาธารณะ');
  return `<p class="hint panel-foot provenance"><span>ชุดข้อมูล CityMETER Restaurants</span> · <span>แหล่ง ${source}</span> · <span>ดึงข้อมูล ${esc(date)}</span> · <span>ขอบเขต ${esc(boundary)}</span>${note ? `<br>${esc(note)}` : ''}</p>`;
}

const ratingText = (rating, rated) => (rating == null ? 'ไม่มีคะแนน' : `${dec(rating)}`);
const words = areas => {
  const p = new Set(areas.map(a => a.province));
  return p.size === 1 ? areaWord([...p][0]) : 'พื้นที่';
};

function groupBars(byGroup, total) {
  const list = byGroup.filter(g => g.count > 0).sort((a, b) => b.count - a.count);
  if (!list.length) return '<p class="hint">ไม่มีร้าน</p>';
  const max = Math.max(1, ...list.map(g => g.count));
  return `<ul class="mix-list" aria-label="ประเภทร้าน (ร้าน)">${list.map(g => `
    <li><span class="mix-label">${cueMarkup(g.series)}${esc(g.th)}</span>
      <span class="mix-track" aria-hidden="true"><span class="mix-fill category-${g.series}" style="width:${Math.max(3, Math.round((g.count / max) * 100))}%"></span></span>
      <span class="mix-value data-number" title="${num(g.count)} จาก ${num(total)} ร้าน">${num(g.count)}</span></li>`).join('')}</ul>`;
}

function priceBars(byPrice) {
  const colors = priceColors();
  const priced = PRICED.reduce((s, b) => s + byPrice[b], 0);
  const max = Math.max(1, ...PRICED.map(b => byPrice[b]));
  const rows = PRICED.filter(b => byPrice[b] > 0).map(b => `
    <li><span class="mix-label"><i class="price-swatch" style="background:${colors[b]}" aria-hidden="true"></i>${esc(PRICE_LABELS[b])}</span>
      <span class="mix-track" aria-hidden="true"><span class="mix-fill" style="width:${Math.max(3, Math.round((byPrice[b] / max) * 100))}%;background:${colors[b]}"></span></span>
      <span class="mix-value data-number">${num(byPrice[b])}</span></li>`).join('');
  return `${priced ? `<ul class="mix-list" aria-label="ระดับราคา (ร้านที่ระบุราคา)">${rows}</ul>` : '<p class="hint">ไม่มีร้านที่ระบุราคา</p>'}
    <p class="hint">ไม่ระบุราคา ${num(byPrice.UNSPECIFIED)} ร้าน</p>`;
}

function restaurantList(rows, {showArea = false, index = null} = {}) {
  return `<ul class="outlet-list">${rows.map(r => {
    const area = showArea && index ? index.byId.get(r.area) : null;
    const meta = [r.type || 'ไม่ระบุประเภท', Number.isFinite(r.rating) ? `★ ${dec(r.rating)}` : '', Number.isFinite(r.reviews) ? `${num(r.reviews)} รีวิว` : '', area ? `${areaWord(area.province)}${area.name}` : ''].filter(Boolean).join(' · ');
    return `<li><button type="button" class="brand-row" data-action="select-store" data-id="${esc(r.id)}">${brandLogoMarkup(r.brand, {size: 'sm'})}<span><strong>${esc(r.name)}</strong><br><span class="small muted">${esc(meta)}</span></span></button></li>`;
  }).join('')}</ul>`;
}

function chainChips(chains) {
  if (!chains.length) return '<p class="hint">ไม่พบเครือร้านในพื้นที่นี้</p>';
  return `<ul class="chip-list">${chains.map(c => `<li><button type="button" class="brand-chip" data-action="filter-brand" data-value="${esc(c.brand.id)}" title="${esc(c.brand.name)} — ${num(c.count)} ร้าน (ดูเฉพาะเครือนี้)">${getBrandLogo(c.brand) ? brandLogoMarkup(c.brand, {size: 'xs', className: 'chip-logo'}) : ''}<span>${esc(c.brand.name)}</span><small class="data-number">${num(c.count)}</small></button></li>`).join('')}</ul>`;
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

/* ---------- Overview ---------- */

/** focusMode: 'auto' (default top three) · 'explicit' (user-chosen) · 'none' (every area). */
export function renderOverview({insight, summary, overview, focusMode = 'auto', classOf, provinces = [], meta = {}, coverage = null, province = '', extra = ''}) {
  const count = insight.areas.length;
  const w = words(insight.areas);
  const names = insight.areas.map(a => `<button type="button" class="link-button" data-action="select-area" data-id="${esc(a.id)}">${esc(a.name)}</button>`).join(' · ');
  let aha;
  if (!summary.count) {
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
    const secondary = insight.mostReviewed ? `<p class="aha-secondary">รีวิวมากที่สุด: <button type="button" class="link-button" data-action="select-area" data-id="${esc(insight.mostReviewed.id)}">${esc(areaWord(insight.mostReviewed.province))}${esc(insight.mostReviewed.name)}</button> <span class="data-number">${num(insight.mostReviewed.reviews)}</span> รีวิว</p>` : '';
    if (insight.mode === 'density') {
      aha = `<section class="aha${focusMode === 'auto' ? ' is-auto' : ''}" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก</p>
        <h2><span class="aha-number data-number">${dens(insight.density)}</span><span class="aha-headline">ร้าน/ตร.กม. — ร้านอาหารแน่นที่สุดใน ${num(count)} ${esc(w)}นี้</span></h2>
        <p class="aha-copy">${names}<br><strong class="data-number">${num(insight.count)}</strong> ร้าน ใน ${km(insight.km2)} ตร.กม.${insight.baselineDensity ? ` · ทั้งพื้นที่ที่มีข้อมูล <strong class="data-number">${dens(insight.baselineDensity)}</strong> ร้าน/ตร.กม.` : ''}</p>
        ${secondary}<p class="hint">จัดอันดับเฉพาะพื้นที่ที่มีอย่างน้อย ${num(insight.minRows)} ร้าน</p>
        <div class="aha-actions">${toggle}<button type="button" data-action="open-charts" class="btn quiet">เปรียบเทียบพื้นที่</button></div></section>`;
    } else {
      aha = `<section class="aha${focusMode === 'auto' ? ' is-auto' : ''}" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก</p>
        <h2><span class="aha-number data-number">${num(Math.round(insight.share))}%</span><span class="aha-headline">ของร้านตามตัวกรองอยู่ใน ${num(count)} ${esc(w)}นี้</span></h2>
        <p class="aha-copy">${names}<br><strong class="data-number">${num(insight.count)}</strong> จาก ${num(insight.totalRows)} ร้าน</p>
        ${secondary}<div class="aha-actions">${toggle}<button type="button" data-action="open-charts" class="btn quiet">เปรียบเทียบพื้นที่</button></div></section>`;
    }
  }
  const narrowed = focusMode !== 'none' && count > 0 && summary.count !== insight.totalRows;
  const coverageDensity = coverage?.km2 ? insight.totalRows / coverage.km2 : null;
  const metrics = `<section class="metrics" aria-label="${narrowed ? 'ตัวเลขของพื้นที่ที่โฟกัส' : 'ตัวเลขรวมของข้อมูลที่เลือก'}">
    ${metricTile(summary.count, `ร้าน${narrowed ? ' ในโฟกัส' : ''}`, 'store')}
    ${metricTile(narrowed ? dens(insight.density || 0) : (coverageDensity ? dens(coverageDensity) : '—'), narrowed ? 'ร้าน/ตร.กม. ในโฟกัส' : 'ร้าน/ตร.กม. พื้นที่ที่มีข้อมูล', 'gla')}
    ${metricTile(summary.reviews, `รีวิว${narrowed ? ' ในโฟกัส' : ''}`, 'exclusive')}
    ${metricTile(summary.brands, `เครือร้าน${narrowed ? ' ในโฟกัส' : ''}`, 'brand')}
  </section>`;
  const scope = province ? `${provinceName(province)} · ${coverage?.areas ? `${num(coverage.areas)} ` : ''}${areaWordFor(province)}ที่มีร้านในชุดข้อมูล` : `7 จังหวัด · ${coverage?.areas ? `${num(coverage.areas)} ` : ''}แขวง/ตำบลที่มีร้านในชุดข้อมูล`;
  const provinceList = provinces.length > 1 ? `<section class="panel-section" aria-labelledby="province-title">
    <div class="section-heading">${heading('province', 'จังหวัดที่มีร้านในชุดข้อมูล', 'province-title')}<span class="hint">${num(provinces.length)} จังหวัด</span></div>
    <ul class="province-list">${provinces.map(p => `<li><button type="button" class="province-row" data-action="select-province" data-id="${esc(p.code)}" aria-label="${esc(p.name)} ${num(p.count)} ร้าน กดเพื่อดูจังหวัด"><i class="province-swatch" style="background:${esc(p.fill)}" aria-hidden="true"></i><span class="province-name">${esc(p.name)}</span><span class="province-count data-number">${num(p.count)}<small>ร้าน</small></span></button></li>`).join('')}</ul>
  </section>` : '';
  const eligible = overview.ranking.eligible.length > 0;
  const rank = areaRanking(eligible ? overview.ranking.eligible : overview.ranking.small, classOf,
    {title: eligible ? 'พื้นที่ที่ร้านแน่นที่สุด' : 'พื้นที่ที่มีร้านมากที่สุด', minRows: overview.ranking.minRows, byCount: !eligible,
      note: eligible ? `${num(overview.ranking.eligible.length)} พื้นที่ ≥ ${num(overview.ranking.minRows)} ร้าน · ร้าน/ตร.กม.` : `ไม่มีพื้นที่ใดถึง ${num(overview.ranking.minRows)} ร้าน · เรียงตามจำนวน`});
  const chains = overview.chains.length ? `<section class="panel-section"><div class="section-heading">${heading('brand', 'เครือร้านที่พบมากที่สุด')}<span class="hint">ชื่อร้านตรงกับเครือ</span></div>${chainChips(overview.chains)}</section>` : '';
  return `${aha}${metrics}${provinceList}${rank}${chains}${extra}${provenance(meta, `${scope} (ขอบเขตแขวง/ตำบลของ CityMETER)`)}`;
}

const areaWordFor = province => (province === 'BKK' ? 'แขวง' : 'ตำบล');

/* ---------- District ---------- */

/**
 * Empty selections, in EVID-05 terms: no_data (the source lists no restaurant there at all — never “0 ร้าน”)
 * vs measured_zero (covered, but the current filters leave 0 — offer the areas where the filters do match).
 */
function selectionNote(p, place) {
  if (p.coverageState === 'no_data') {
    return `<div class="empty-note" role="note"><strong>ไม่มีข้อมูลร้านจากแหล่งข้อมูลใน${esc(place)}</strong>
      <span>แหล่งข้อมูลยังไม่มีรายการในพื้นที่นี้ จึงไม่ได้แปลว่าไม่มีร้านอาหาร · บนแผนที่เป็นลายเส้นทแยง “ไม่มีข้อมูล”</span></div>`;
  }
  if (p.coverageState === 'measured_zero') {
    const elsewhere = p.scopeCount > 0
      ? `<span>ตัวกรองเดียวกันพบ <strong class="data-number">${num(p.scopeCount)}</strong> ร้านในพื้นที่อื่น</span><button type="button" class="btn quiet" data-action="leave-area">ดูพื้นที่ที่พบ</button>`
      : '<span>ตัวกรองนี้ไม่พบร้านในพื้นที่ใดเลย ลองล้างตัวกรอง</span>';
    return `<div class="empty-note" role="note"><strong>ไม่พบร้านตามตัวกรองใน${esc(place)}</strong>
      <span>0 ร้านภายใต้ตัวกรองนี้ เป็นศูนย์ที่วัดได้ (พื้นที่นี้มีร้านในชุดข้อมูลเมื่อไม่กรอง)</span>${elsewhere}</div>`;
  }
  return '';
}

export function renderDistrict(p, classOf, meta = {}, extra = '') {
  if (!p) return '';
  const d = p.district;
  const w = p.words;
  const ranked = p.areas.filter(a => a.count >= 1);
  const rankText = p.coverageState === 'no_data' ? 'ไม่มีข้อมูลจากแหล่งข้อมูล' : p.rank ? `อันดับความหนาแน่น ${num(p.rank)} จาก ${num(p.rankOf)}` : `น้อยกว่า ${num(p.minRows)} ร้าน · ไม่จัดอันดับ`;
  const place = `${w.district}${d.name}`;
  const head = `<section class="detail-head">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">${esc(w.district)} · ${esc(provinceName(d.province))} · ${esc(rankText)}</p>
      <h2>${esc(w.district)}${esc(d.name)}</h2>${d.nameEn ? `<p class="subtle">${esc(d.nameEn)}</p>` : ''}
      ${p.coverageState === 'no_data' ? '' : `<div class="metrics compact">${metricTile(p.count, 'ร้าน', 'store')}${metricTile(dens(p.density), 'ร้าน/ตร.กม.', 'gla')}${metricTile(p.reviews, 'รีวิว', 'exclusive')}${metricTile(`${num(ranked.length)}/${num(p.areaTotal)}`, `${w.area}ที่มีร้าน`, 'area')}</div>`}
      ${selectionNote(p, place)}
      <p class="hint">${km(p.km2 || 0)} ตร.กม.${p.coverageState === 'no_data' ? '' : ' · ความหนาแน่น = ร้าน ÷ พื้นที่ตามขอบเขต CityMETER'}</p>
      <div class="detail-actions">${p.count ? '<button type="button" class="btn" data-action="open-table">ดูร้าน</button><button type="button" class="btn quiet" data-action="open-charts">เปรียบเทียบพื้นที่</button>' : ''}${link(productionLink({province: d.province, district: d.id}), 'ดูใน CityMETER', 'btn quiet source-link')}</div>
    </section>
`;
  if (!p.count) return `${head}${extra}${provenance(meta, `${place} ${provinceName(d.province)} (ขอบเขต CityMETER)`)}`;
  return `${head}    ${areaRanking(ranked, classOf, {title: `${w.area}ใน${w.district}นี้`, note: `${num(ranked.length)} ${w.area} · ร้าน/ตร.กม.`, limit: 40, minRows: p.minRows})}
    <section class="panel-section"><div class="section-heading">${heading('segment', 'ประเภทร้าน')}<span class="hint">ร้าน</span></div>${groupBars(p.byGroup, p.count)}</section>
    <section class="panel-section"><div class="section-heading">${heading('plain', 'ระดับราคา')}<span class="hint">ร้านที่ระบุราคา</span></div>${priceBars(p.byPrice)}</section>
    <section class="panel-section"><div class="section-heading">${heading('brand', 'เครือร้าน')}<span class="hint">${num(p.chainTotal ?? p.chains.length)} เครือ</span></div>${chainChips(p.chains)}${shownOf(p.chains.length, p.chainTotal ?? p.chains.length, 'เครือ', 'ร้านมากก่อน')}</section>
    ${p.venues.length ? `<section class="panel-section"><div class="section-heading">${heading('venue', 'สถานที่ที่ชื่อร้านอ้างถึง')}<span class="hint">${num(p.venueTotal ?? p.venues.length)} แห่ง</span></div>${venueRows(p.venues)}${shownOf(p.venues.length, p.venueTotal ?? p.venues.length, 'แห่ง', 'ร้านมากก่อน')}</section>` : ''}
    ${extra}${provenance(meta, `${w.district}${d.name} ${provinceName(d.province)} (ขอบเขต CityMETER)`)}`;
}

/* ---------- Area (แขวง/ตำบล) ---------- */

export function renderArea(p, meta = {}, extra = '') {
  if (!p) return '';
  const a = p.area, w = p.words;
  const rankText = p.coverageState === 'no_data' ? 'ไม่มีข้อมูลจากแหล่งข้อมูล' : p.rank ? `อันดับความหนาแน่น ${num(p.rank)} จาก ${num(p.rankOf)}` : `น้อยกว่า ${num(p.minRows)} ร้าน · ไม่จัดอันดับ`;
  const place = `${w.area}${a.name}`;
  const head = `<section class="detail-head">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">${esc(w.area)} · <button type="button" class="link-button" data-action="select-district" data-id="${esc(a.district)}">${esc(w.district)}${esc(a.districtName)}</button> · ${esc(rankText)}</p>
      <h2>${esc(w.area)}${esc(a.name)}</h2>${a.nameEn ? `<p class="subtle">${esc(a.nameEn)}</p>` : ''}
      ${p.coverageState === 'no_data' ? '' : `<div class="metrics compact">${metricTile(p.count, 'ร้าน', 'store')}${metricTile(dens(p.density), 'ร้าน/ตร.กม.', 'gla')}${metricTile(p.reviews, 'รีวิว', 'exclusive')}${metricTile(ratingText(p.ratingMean, p.rated), 'คะแนนเฉลี่ย', 'exclusive')}</div>`}
      ${selectionNote(p, place)}
      <p class="hint">${km(p.km2 || 0)} ตร.กม.${p.count ? ` · ความหนาแน่น = ร้าน ÷ พื้นที่ตามขอบเขต CityMETER · คะแนนเฉลี่ยจาก ${num(p.rated)} ร้านที่มีคะแนน` : ''}</p>
      <div class="detail-actions">${p.count ? '<button type="button" class="btn" data-action="open-table">ดูร้าน</button><button type="button" class="btn quiet" data-action="open-charts">เปรียบเทียบพื้นที่</button>' : ''}${link(productionLink({province: a.province, area: a.id}), 'ดูใน CityMETER', 'btn quiet source-link')}</div>
    </section>
`;
  if (!p.count) return `${head}${extra}${provenance(meta, `${place} ${w.district}${a.districtName} ${provinceName(a.province)} (ขอบเขต CityMETER)`)}`;
  return `${head}    <section class="panel-section"><div class="section-heading">${heading('segment', 'ประเภทร้าน')}<span class="hint">ร้าน</span></div>${groupBars(p.byGroup, p.count)}</section>
    <section class="panel-section"><div class="section-heading">${heading('plain', 'ระดับราคา')}<span class="hint">ร้านที่ระบุราคา</span></div>${priceBars(p.byPrice)}</section>
    ${p.topReviewed.length ? `<section class="panel-section"><div class="section-heading">${heading('exclusive', 'รีวิวมากที่สุด')}<span class="hint">${num(p.topReviewed.length)} ร้าน</span></div>${restaurantList(p.topReviewed)}</section>` : ''}
    <section class="panel-section"><div class="section-heading">${heading('brand', 'เครือร้านในพื้นที่')}<span class="hint">${num(p.chainTotal ?? p.chains.length)} เครือ</span></div>${chainChips(p.chains)}${shownOf(p.chains.length, p.chainTotal ?? p.chains.length, 'เครือ', 'ร้านมากก่อน')}</section>
    ${p.venues.length ? `<section class="panel-section"><div class="section-heading">${heading('venue', 'สถานที่ที่ชื่อร้านอ้างถึง')}<span class="hint">${num(p.venueTotal ?? p.venues.length)} แห่ง</span></div>${venueRows(p.venues)}${shownOf(p.venues.length, p.venueTotal ?? p.venues.length, 'แห่ง', 'ร้านมากก่อน')}</section>` : ''}
    ${extra}${provenance(meta, `${w.area}${a.name} ${w.district}${a.districtName} ${provinceName(a.province)} (ขอบเขต CityMETER)`)}`;
}

/* ---------- Venue ---------- */

/** How the venue's rows were linked by name (sheet link, name ending, name-derived place). */
function venueMatchNote(v) {
  if (v.nameDerived) return `ชื่อสถานที่ได้จากท้ายชื่อร้านที่ลงท้ายเหมือนกัน (ทุกจุดอยู่ในรัศมี 200 ม. จากจุดกลาง) ไม่ได้ยืนยันว่าร้านตั้งอยู่ภายใน`;
  const suffix = v.matched?.suffix ? ` · ${num(v.matched.suffix)} ร้านจับจากชื่อที่ลงท้ายด้วยชื่อสถานที่` : '';
  return `นับจากชื่อร้านที่อ้างถึงสถานที่นี้ ไม่ได้ยืนยันว่าร้านตั้งอยู่ภายใน${suffix}`;
}

export function renderVenue(v, index, meta = {}, extra = '') {
  if (!v) return '';
  const logo = getVenueLogo(v.venue);
  const sp = v.spatial;
  const building = v.hosted ? ' · อาคารสีน้ำเงินบนแผนที่คืออาคารของสถานที่' : sp ? ' · อาคารสีน้ำเงินคืออาคารที่จุดของร้านเหล่านี้ตกอยู่' : '';
  return `<section class="detail-head venue${logo ? ' has-venue-logo' : ''}">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      ${logo ? venueLogoMarkup(v.venue, {size: 'lg', className: 'detail-venue-logo', decorative: false}) : ''}
      <p class="eyebrow">${esc(v.venue.typeTh || 'สถานที่')}${logo?.roleLabel ? ` · <span class="venue-logo-role">${esc(logo.roleLabel)}</span>` : ''}${v.nameDerived ? ' · สถานที่จากชื่อร้าน' : ''}</p>
      <h2>${esc(v.venue.name)}</h2>
      <div class="metrics compact">${metricTile(v.count, 'ร้าน', 'store')}${metricTile(v.areas.length, 'พื้นที่', 'area')}${metricTile(v.reviewed ? v.reviews : '—', 'รีวิว', 'exclusive')}</div>
      <p class="hint">${esc(venueMatchNote(v))}${v.entityRows ? ` · ตัวเลขรวม ${num(v.entityRows)} รายการที่เป็นชื่อสถานที่เอง (${num(v.entityReviews)} รีวิว)` : ''}${building}</p>
    </section>
    <section class="panel-section"><div class="section-heading">${heading('store', `ร้านที่ชื่ออ้างถึง ${v.venue.name}`)}<span class="hint">${num(v.count)}</span></div>${restaurantList(v.rows, {showArea: true, index})}
      ${v.entityRows ? `<p class="hint">รวม ${num(v.entityRows)} รายการที่เป็นชื่อสถานที่เอง</p>` : ''}</section>
    ${sp ? `<section class="panel-section venue-spatial"><div class="section-heading">${heading('venue', 'ร้านอื่นที่จุดตกในอาคารเดียวกัน')}<span class="hint">${num(sp.count)} ร้าน</span></div>
      ${sp.count ? restaurantList(sp.others, {showArea: true, index}) : '<p class="hint">ไม่มีร้านอื่นตามตัวกรองนี้</p>'}
      <p class="hint">จุดของร้านเหล่านี้ตกในอาคาร ${num(sp.buildings)} หลังเดียวกับร้านของสถานที่นี้ ${num(sp.own)} ร้าน แต่ชื่อไม่ได้อ้างถึงสถานที่ จึงไม่นับรวมด้านบน${sp.count > sp.others.length ? ` · แสดง ${num(sp.others.length)} ร้านที่มีรีวิวมากที่สุด` : ''}</p></section>` : ''}
    <section class="panel-section"><div class="section-heading">${heading('segment', 'ประเภทร้าน')}</div>${groupBars(v.byGroup, v.count)}</section>
    ${extra}${provenance(meta, `ร้านที่ชื่ออ้างถึง ${v.venue.name}${v.provinces.length === 1 ? ` · ${provinceName(v.provinces[0])}` : ''}`)}`;
}

/* ---------- Building (spatial join) ---------- */

export function renderBuilding(b, meta = {}, extra = '') {
  if (!b) return '';
  const w = b.words;
  const area = b.area ? `${w.area}${b.area.name}` : '';
  const height = b.height != null ? `ความสูงบนแผนที่ราว ${num(Math.round(b.height))} ม. (OpenStreetMap ผ่าน OpenFreeMap ไม่ใช่ผลรังวัด)` : '';
  return `<section class="detail-head building">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">อาคารบนแผนที่${area ? ` · ${b.area ? `<button type="button" class="link-button" data-action="select-area" data-id="${esc(b.area.id)}">${esc(area)}</button>` : ''}` : ''}</p>
      <h2>ร้านที่จุดตกในอาคารนี้</h2>
      <div class="metrics compact">${metricTile(b.count, 'ร้าน', 'store')}${metricTile(b.reviewed ? b.reviews : '—', 'รีวิว', 'exclusive')}${b.ratingMean != null ? metricTile(dec(b.ratingMean), 'คะแนนเฉลี่ย', 'plain') : ''}</div>
      <p class="hint">จุดของร้านตกในขอบอาคารที่แผนที่วาด ไม่ได้ยืนยันว่าร้านตั้งอยู่ในอาคารนี้หรือชั้นใด${height ? ` · ${esc(height)}` : ''}</p>
    </section>
    <section class="panel-section"><div class="section-heading">${heading('store', 'ร้าน')}<span class="hint">${num(b.count)}</span></div>${restaurantList(b.rows.slice(0, 40), {showArea: b.areaCount > 1, index: meta.index})}
      ${b.count > 40 ? `<p class="hint">แสดง ${num(40)} จาก ${num(b.count)} ร้าน (รีวิวมากก่อน) · ดูทั้งหมดในตาราง</p>` : ''}</section>
    ${b.venues.length ? `<section class="panel-section"><div class="section-heading">${heading('venue', 'สถานที่ที่ชื่อร้านอ้างถึง')}<span class="hint">${num(b.venueTotal ?? b.venues.length)} แห่ง</span></div>${venueRows(b.venues)}${shownOf(b.venues.length, b.venueTotal ?? b.venues.length, 'แห่ง', 'ร้านมากก่อน')}</section>` : ''}
    <section class="panel-section"><div class="section-heading">${heading('segment', 'ประเภทร้าน')}</div>${groupBars(b.byGroup, b.count)}</section>
    ${extra}${provenance(meta, `จุดของร้านที่ตกในขอบอาคาร OpenStreetMap หนึ่งหลัง${area ? ` · ${area} (ขอบเขต CityMETER)` : ''}`)}`;
}

/* ---------- Store ---------- */

export function renderStore(d, meta = {}, {extraFacts = '', extra = ''} = {}) {
  if (!d) return '';
  const r = d.row, w = d.words;
  const blogo = getBrandLogo(r.brand);
  // The API's display position; a pin drawn inside a Land building (within 10 m of it) keeps the source values here.
  const coords = `${(r.sourceLatitude ?? r.latitude).toFixed(6)}, ${(r.sourceLongitude ?? r.longitude).toFixed(6)}`;
  const rating = Number.isFinite(r.rating) ? `★ <span class="data-number">${dec(r.rating)}</span>${Number.isFinite(r.reviews) ? ` · <span class="data-number">${num(r.reviews)}</span> รีวิว` : ''}` : 'ไม่มีคะแนนในแหล่งข้อมูล';
  const price = r.price === 'UNSPECIFIED' ? 'ไม่ระบุราคา (ไม่ใช่ราคา 0)' : `${esc(PRICE_LABELS[r.price])}${d.price.range ? `<br><span class="hint">ช่วงราคาที่ระบุ ${esc(d.price.range)} · จัดระดับจากราคาสูงสุดที่ระบุ</span>` : ''}`;
  const brand = r.brand ? `<dt>เครือร้าน</dt><dd class="fact-brand">${blogo ? brandLogoMarkup(r.brand, {size: 'md'}) : ''}<span><button type="button" class="link-button" data-action="filter-brand" data-value="${esc(r.brand.id)}">${esc(r.brand.name)}</button><br><span class="hint">${r.brand.hold ? 'รอยืนยันตัวตนเครือ' : 'จับคู่จากชื่อร้าน'}</span></span></dd>` : '';
  const venueHint = r.venueEntity ? 'รายการนี้คือชื่อสถานที่เอง' : r.venueMatch === 'suffix' ? 'ชื่อร้านลงท้ายด้วยชื่อสถานที่นี้'
    : r.venueMatch === 'auto' ? 'ชื่อร้านลงท้ายด้วยชื่อนี้ · สถานที่จากชื่อร้าน' : 'ชื่อร้านอ้างถึงสถานที่นี้';
  const venue = r.venue ? `<dt>สถานที่</dt><dd class="fact-venue">${venueLogoMarkup(r.venue, {size: 'md'})}<span><button type="button" class="link-button" data-action="select-venue" data-id="${esc(r.venue.id)}">${esc(r.venue.name)}</button><br><span class="hint">${venueHint}</span></span></dd>` : '';
  const bd = d.building;
  const building = bd ? `<dt>อาคาร</dt><dd>${bd.others ? `<button type="button" class="link-button" data-action="select-building" data-id="${esc(bd.key)}">จุดของร้านตกในอาคารเดียวกับอีก ${num(bd.others)} ร้าน</button>` : 'จุดของร้านตกในอาคารบนแผนที่ · ไม่มีร้านอื่นในอาคารนี้ตามตัวกรอง'}<br><span class="hint">ขอบอาคาร OpenStreetMap ที่แผนที่วาด</span></dd>` : '';
  const area = d.area ? `<button type="button" class="link-button" data-action="select-area" data-id="${esc(d.area.id)}">${esc(w.area)}${esc(d.area.name)}</button> · <button type="button" class="link-button" data-action="select-district" data-id="${esc(d.area.district)}">${esc(w.district)}${esc(d.area.districtName)}</button>` : '—';
  return `<section class="detail-head store">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      ${blogo ? brandLogoMarkup(r.brand, {size: 'lg', className: 'detail-logo', decorative: false}) : ''}
      <p class="eyebrow eyebrow-cue">${cueMarkup(r.series)}${esc(d.group?.th || '')}</p>
      <h2>${esc(r.name || 'ไม่มีชื่อในแหล่งข้อมูล')}</h2>
      <p class="subtle">${esc(r.type || 'ไม่ระบุประเภท')}</p>
      <dl class="facts">
        <dt>คะแนน</dt><dd>${rating}</dd>
        <dt>ราคา</dt><dd>${price}</dd>
        ${brand}${venue}${building}${extraFacts}
        <dt>พื้นที่</dt><dd>${area}</dd>
        <dt>พิกัด</dt><dd><span class="data-number">${esc(coords)}</span><br><span class="hint" title="${esc(d.geometry.note)}">${esc(d.geometry.label)}${d.coLocated ? ` · ตำแหน่งเดียวกับอีก ${num(d.coLocated)} ร้าน` : ''}${r.snapped ? ' · หมุดแสดงในอาคาร Land' : ''}</span></dd>
        <dt>แหล่งข้อมูล</dt><dd>CityMETER Restaurants API สาธารณะ · ดึงข้อมูล ${esc(thaiDate(meta.retrievedOn || meta.asOf || ''))}<br><span class="hint data-number" title="รหัสสังเกตการณ์ในชุดข้อมูลนี้ (ย่อ)">รหัส R-${esc(r.id.split('-')[0])}…</span></dd>
      </dl>
      <p class="links">${d.area ? link(productionLink({province: r.province, area: r.area}), 'ดูพื้นที่นี้ใน CityMETER') : ''} ${blogo && blogo.sourcePage ? link(blogo.sourcePage, 'ที่มาโลโก้') : ''}</p>
    </section>
    ${r.brand ? `<section class="panel-section"><div class="section-heading">${heading('brand', `ร้านอื่นที่ชื่อตรงกับ ${r.brand.name}`)}<span class="hint">${num(d.sameBrand.count)} ร้าน · ${num(d.sameBrand.areas)} พื้นที่</span></div>
      ${d.sameBrand.rows.length ? restaurantList(d.sameBrand.rows, {showArea: true, index: meta.index}) : '<p class="hint">ไม่มีในตัวกรองนี้</p>'}
      <div class="detail-actions"><button type="button" class="btn quiet" data-action="filter-brand" data-value="${esc(r.brand.id)}">ดูเฉพาะเครือนี้</button></div></section>` : ''}
    ${d.sameArea.length ? `<section class="panel-section"><div class="section-heading">${heading('segment', `${d.group?.th || 'ร้าน'}อื่นในพื้นที่`)}</div>${restaurantList(d.sameArea)}</section>` : ''}
    ${extra}${provenance(meta, d.area ? `${w.area}${d.area.name} ${provinceName(r.province)} (ขอบเขต CityMETER)` : provinceName(r.province))}`;
}

/* ---------- Active filter chips ---------- */

export function renderFilterChips(values, labels) {
  const chips = [];
  const push = (key, text) => chips.push(`<li><button type="button" class="filter-chip" data-action="clear-filter" data-id="${esc(key)}" aria-label="ล้างตัวกรอง ${esc(text)}"><span>${esc(text)}</span><i aria-hidden="true">×</i></button></li>`);
  if (values.search) push('search', `ค้นหา “${values.search}”`);
  if (values.group) push('group', labels.group[values.group] || values.group);
  if (values.price) push('price', labels.price[values.price] || values.price);
  if (values.province) push('province', labels.province[values.province] || values.province);
  if (values.brand) push('brand', labels.brand[values.brand] || values.brand);
  if (values.venue) push('venue', labels.venue[values.venue] || values.venue);
  return chips.length ? `<ul class="filter-chips" aria-label="ตัวกรองที่ใช้อยู่">${chips.join('')}<li><button type="button" class="filter-chip clear-all" data-action="clear-filter" data-id="all">ล้างทั้งหมด</button></li></ul>` : '';
}

export {PRICE_SHORT};

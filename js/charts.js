/**
 * Area charts rendered as plain HTML/SVG — no chart vendor.
 *
 * Three views share one model (chart-model.js) and the committed selection:
 *  - density (URL view key `density`): restaurants per km² of each แขวง/ตำบล,
 *    bars in the density.area class colour of the map legend
 *  - mix: area × food type, a numeric table with equal cells (count classes)
 *  - price: price buckets per area as shares of the rows that state a price;
 *    the rows without a price are counted beside the bar, never folded in
 * Every mark is a <button> emitting {type:'area', id}.
 */
import {buildChartModel, areaMatrix, areaPrices} from './chart-model.js';
import {buildCountClasses, buildDensityClasses, classify, priceColors} from './scales.js';
import {rampMarkup} from './legend.js';
import {PRICED, PRICE_SHORT, PRICE_LABELS} from './model.js';
import {cueMarkup} from './cues.js';
import {districtWord} from './areas.js';

const NUMBER = new Intl.NumberFormat('th-TH', {maximumFractionDigits: 0});
const DEC = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = n => NUMBER.format(n);
const dec = n => DEC.format(n);
const DEC2 = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
/** Same density format as the panel (panel.js dens): a measured non-zero density never prints as 0.0. */
const dens = n => (n == null || !Number.isFinite(n) ? '—' : n === 0 ? '0' : n < 0.01 ? '<0.01' : n < 1 ? DEC2.format(n) : DEC.format(n));

function empty(element, message, actionLabel, action) {
  element.innerHTML = `<div class="chart-empty"><p>${esc(message)}</p>${action ? `<button type="button" class="chart-empty-action">${esc(actionLabel)}</button>` : ''}</div>`;
  if (action) element.querySelector('.chart-empty-action').addEventListener('click', action);
}

function density(element, model, select, selectedId) {
  // No area reaches the eligibility threshold (a small selection, e.g. one chain): rank and draw by
  // count — a density of one or two restaurants in a tiny area would read as a finding it is not.
  const byCount = model.mode === 'count';
  const value = a => (byCount ? a.count : a.density || 0);
  const classes = byCount ? buildCountClasses(model.areas.map(a => a.count)) : buildDensityClasses(model.areas.map(a => a.density));
  const max = Math.max(1, ...model.areas.map(value));
  const rows = model.areas.map((a, i) => {
    const cls = classify(value(a), classes);
    const pressed = a.id === selectedId;
    const label = byCount ? `${num(a.count)} ร้าน (${dens(a.density)} ร้านต่อตารางกิโลเมตร)` : `${dens(a.density)} ร้านต่อตารางกิโลเมตร, ${num(a.count)} ร้าน`;
    return `<li><button type="button" class="bar-row${pressed ? ' is-selected' : ''}" data-area="${esc(a.id)}" aria-pressed="${pressed}"
      aria-label="อันดับ ${i + 1} ${esc(a.name)}: ${label} กดเพื่อดูพื้นที่นี้">
      <span class="bar-rank data-number" aria-hidden="true">${i + 1}</span>
      <span class="bar-label">${esc(a.name)}<small>${esc(districtWord(a.province))}${esc(a.districtName)}</small></span>
      <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${Math.max(2, Math.round((value(a) / max) * 100))}%;background:${cls.fill}"></span></span>
      <span class="bar-value" aria-hidden="true">${byCount ? `<b class="data-number">${num(a.count)}</b><small>${dens(a.density)}/ตร.กม.</small>` : `<b class="data-number">${dens(a.density)}</b><small>${num(a.count)} ร้าน</small>`}</span>
    </button></li>`;
  }).join('');
  const caption = byCount
    ? `จำนวนร้านต่อพื้นที่ · ไม่มีพื้นที่ใดถึง ${num(model.minRows)} ร้าน จึงเรียงตามจำนวน · ${num(model.areas.length)} พื้นที่`
    : `ร้านต่อ ตร.กม. · ${num(model.areas.length)}/${num(model.eligibleAreas)} พื้นที่ที่มีอย่างน้อย ${num(model.minRows)} ร้าน · สีเดียวกับแผนที่`;
  element.innerHTML = `<p class="chart-caption">${caption}</p><ol class="chart-bars">${rows}</ol>`;
  element.querySelectorAll('[data-area]').forEach(b => b.addEventListener('click', () => select({type: 'area', id: b.dataset.area})));
}

function matrix(element, model, select, selectedId) {
  const m = areaMatrix(model, {areaLimit: 12});
  const classes = buildCountClasses(m.cells.map(c => c.count));
  const head = m.groups.map(g => `<th scope="col" title="${esc(g.th)}"><span class="matrix-col">${cueMarkup(g.series)}<span>${esc(g.short || g.th)}</span></span></th>`).join('');
  const body = m.areas.map(a => {
    const pressed = a.id === selectedId;
    const cells = m.groups.map(g => {
      const cell = m.cells.find(c => c.areaId === a.id && c.group === g.index);
      const cls = classify(cell.count, classes);
      // measured_zero: lowest class fill + the theme's dataState.zero outline (EVID-05 treatment), never a blank cell.
      const style = cls.state === 'measured_zero' ? `background:${cls.fill};color:${cls.ink};box-shadow:inset 0 0 0 2px var(--data-zero-outline)` : `background:${cls.fill};color:${cls.ink}`;
      return `<td><button type="button" class="matrix-cell is-${cls.state}" data-area="${esc(a.id)}" style="${style}"
        aria-label="${esc(a.name)} × ${esc(g.th)}: ${num(cell.count)} ร้าน กดเพื่อดูพื้นที่นี้" title="${esc(a.name)} × ${esc(g.th)} — ${num(cell.count)} จาก ${num(cell.total)} ร้าน"><span class="data-number">${num(cell.count)}</span></button></td>`;
    }).join('');
    return `<tr${pressed ? ' class="is-selected"' : ''}><th scope="row"><button type="button" class="matrix-row" data-area="${esc(a.id)}" aria-pressed="${pressed}">${esc(a.name)}<small class="data-number">${num(a.count)}</small></button></th>${cells}</tr>`;
  }).join('');
  const legend = rampMarkup(classes, {unit: 'ร้าน'});
  const columns = `<colgroup><col class="matrix-head-col">${m.groups.map(() => '<col class="matrix-cell-col">').join('')}</colgroup>`;
  element.innerHTML = `<p class="chart-caption">${num(m.areas.length)} พื้นที่ที่ร้านแน่นที่สุด × ${num(m.groups.length)} ประเภท · ตัวเลข = ร้าน · ทุกช่องขนาดเท่ากัน ขนาดไม่มีความหมาย</p>
    <div class="matrix-scroll"><table class="matrix" style="--matrix-columns:${m.groups.length}">${columns}<thead><tr><th scope="col" class="matrix-corner">พื้นที่ · ร้าน</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="chart-legend"><span class="legend-title">ระดับสี (ร้านในช่อง, ${num(classes.classCount)} ระดับเท่าช่วง):</span>${legend}<span class="legend-step"><i class="legend-zero" aria-hidden="true"></i>0 = ไม่พบในตัวกรองนี้</span></p>`;
  element.querySelectorAll('[data-area]').forEach(b => b.addEventListener('click', () => select({type: 'area', id: b.dataset.area})));
}

function price(element, model, select, selectedId) {
  const list = areaPrices(model, {areaLimit: 12});
  const colors = priceColors();
  const rows = list.map(a => {
    const pressed = a.id === selectedId;
    const segs = PRICED.map(b => a.counts[b] ? `<span class="bar-fill price-seg" style="width:${(a.shares[b] * 100).toFixed(2)}%;background:${colors[b]}" title="${esc(PRICE_LABELS[b])}: ${num(a.counts[b])} ร้าน"></span>` : '').join('');
    const parts = PRICED.filter(b => a.counts[b]).map(b => `${PRICE_LABELS[b]} ${num(a.counts[b])}`).join(', ');
    return `<li><button type="button" class="bar-row stacked${pressed ? ' is-selected' : ''}" data-area="${esc(a.id)}" aria-pressed="${pressed}"
      aria-label="${esc(a.name)}: ระบุราคา ${num(a.priced)} จาก ${num(a.total)} ร้าน${parts ? ' — ' + esc(parts) : ''}, ไม่ระบุราคา ${num(a.unspecified)} ร้าน กดเพื่อดูพื้นที่นี้">
      <span class="bar-label">${esc(a.name)}</span>
      <span class="bar-track price-track" aria-hidden="true">${a.priced ? segs : '<span class="price-none">ไม่มีร้านที่ระบุราคา</span>'}</span>
      <span class="bar-value" aria-hidden="true"><b class="data-number">${num(a.priced)}</b><small>ไม่ระบุ ${num(a.unspecified)}</small></span>
    </button></li>`;
  }).join('');
  const legend = PRICED.map(b => `<span class="legend-step"><i style="background:${colors[b]}" aria-hidden="true"></i>${esc(PRICE_SHORT[b])}</span>`).join('');
  element.innerHTML = `<p class="chart-caption">สัดส่วนระดับราคาในร้านที่ระบุราคา (บาท) · ตัวเลข = ร้านที่ระบุราคา · “ไม่ระบุ” แยกนับ ไม่ใช่ราคา 0</p>
    <p class="chart-legend"><span class="legend-title">ระดับราคา:</span>${legend}</p><ol class="chart-bars">${rows}</ol>`;
  element.querySelectorAll('[data-area]').forEach(b => b.addEventListener('click', () => select({type: 'area', id: b.dataset.area})));
}

/** Render one view into #elementId. Returns an idempotent disposer. */
export function renderInsightChart({elementId, view = 'density', rows = [], index, groups, theme, selectedAreaId = ''} = {}, onSelect = () => {}) {
  const element = document.getElementById(elementId);
  if (!element) return () => {};
  const select = typeof onSelect === 'function' ? onSelect : () => {};
  element.replaceChildren();
  if (theme) element.dataset.chartTheme = theme;
  const labels = {density: 'พื้นที่เรียงตามความหนาแน่นของร้านอาหาร', mix: 'ประเภทร้านในแต่ละพื้นที่', price: 'ระดับราคาในแต่ละพื้นที่'};
  element.setAttribute('aria-label', labels[view] || labels.density);
  if (!Array.isArray(rows) || !rows.length) { empty(element, 'ไม่พบร้านตามตัวกรอง'); return () => element.replaceChildren(); }
  const model = buildChartModel(rows, index, groups);
  if (!model.areas.length) { empty(element, 'ไม่มีพื้นที่ในตัวกรองนี้'); return () => element.replaceChildren(); }
  try {
    if (view === 'mix') matrix(element, model, select, selectedAreaId);
    else if (view === 'price') price(element, model, select, selectedAreaId);
    else density(element, model, select, selectedAreaId);
  } catch (error) {
    console.error('CityMETER insight chart could not render:', error);
    empty(element, 'แสดงกราฟไม่ได้ในขณะนี้ โปรดดูข้อมูลเดียวกันในตาราง');
  }
  return () => element.replaceChildren();
}

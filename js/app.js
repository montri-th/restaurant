/**
 * CityMETER · Restaurants — application orchestration.
 *
 * One committed selection drives everything. Three row scopes, named the same
 * way everywhere:
 *   scopeRows — rows after the search/type/price/province/chain filters, BEFORE any
 *               area selection or area focus: the comparison base for the Aha, the
 *               choropleth, the charts and every rank.
 *   baseRows  — scopeRows narrowed by the selected เขต/อำเภอ or แขวง/ตำบล (if any).
 *   rows      — baseRows narrowed by the area focus (if any): pins with detail,
 *               counters, the table.
 *
 * Area focus has three modes (state.focusAreaIds / state.autoFocus):
 *   auto     — default: the three densest subdistricts of the current scope (≥ 30
 *              rows) are the focus, so the first screen already shows detail there.
 *   explicit — ?areas=a,b,c chosen by the user.
 *   none     — ?areas=all: every area filled, nothing quiet.
 *
 * Focus + quiet on the map: data fills, coloured pins, logos, rounded focus
 * massing only for the focused part; everything else stays visible but quiet
 * (outline-only areas, grey dots, pale city massing). Venue level (a venue with a
 * host building, or a store naming one) is its own focus: only its rows carry
 * detail, its host building is the only blue one and the venue x-ray keeps it
 * visible and clickable at any pan/tilt/zoom.
 *
 * Camera: 3D by default (camera.js presets city/model/eye) with a 2D plan
 * toggle; the basemap is generated (map-style.js) on OpenFreeMap tiles.
 * Panel modes: overview | district | area | venue | store (with a back stack).
 * URL state: filters, district, area, areas, view, store, place, view3d, cam.
 */
import {PROVINCES, PRICE_BUCKETS, PRICE_LABELS, provinceByCode, provinceCodeFrom, decodeDataset, filterRows, summarize, hasPoint, productionLink} from './model.js';
import {buildAreaIndex, areaWord, districtWord} from './areas.js';
import {summarizeAreaInsight, filterAreaRows} from './area-insight.js';
import {renderInsightChart} from './charts.js';
import {loadMapLibrary} from './vendors.js';
import {installRestaurantPins} from './pins.js';
import {installVenueBuildings, hostedVenueIds, HOST_LAYERS} from './buildings.js';
import {installVenueXray} from './venue-xray.js';
import {configureBrandLogos, brandLogoMarkup} from './brand-logos.js';
import {configureVenueLogos} from './venue-logos.js';
import {installAreaLayers, installAreaLabels, buildAreaModel, featureBounds, FILL_MAX_ZOOM} from './map-layers.js';
import {installProvinceLayers, buildProvinceModel, PROVINCE_FILL_MAX_ZOOM, PROVINCE_LABEL_MAX_ZOOM} from './provinces.js';
import {buildOverview, buildAreaProfile, buildDistrictProfile, buildStoreDetail, buildVenueProfile} from './profile-model.js';
import {renderOverview, renderArea, renderDistrict, renderVenue, renderStore, renderFilterChips, link, esc, num, dec} from './panel.js';
import {buildMapStyle, basemapPalette, TILEJSON_URL, MASSING_BEFORE} from './map-style.js';
import {installMassing, outerRings} from './massing.js';
import {presetFor, applyPreset, fitPitched, framePoint} from './camera.js';
import {buildBreadcrumb, renderBreadcrumb, breadcrumbText} from './breadcrumb.js';
import {classify} from './scales.js';
import {cueMarkup} from './cues.js';

const $ = id => document.getElementById(id);
const FIELDS = ['search', 'group', 'price', 'province', 'brand'];
const BANGKOK = {center: [100.535, 13.745], zoom: 12.2};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobilePortrait = () => matchMedia('(max-width: 760px) and (orientation: portrait)').matches;

const state = {
  data: null, index: null, areasGeo: null, districtsGeo: null, provincesGeo: null, buildingGeo: null, hosted: new Set(),
  coverage: null, coveredIds: new Set(),
  scopeRows: [], baseRows: [], rows: [], insight: null,
  view: 'density', page: 0,
  focusAreaIds: [], autoFocus: true, focusIds: [], selectedArea: '', selectedDistrict: '', selectedId: '',
  panel: {mode: 'overview', id: ''}, history: [],
  map: null, loaded: false, mapTheme: '', popup: null, initialCameraDone: false, tileTemplate: '',
  view3d: true, twoPoint: true, showAreas: true,
  pins: null, buildings: null, massing: null, xray: null, areaLayers: null, labels: null, areaModel: null,
  provinceLayers: null, provinceLabels: null, provinceModel: null, rowById: new Map(), venueById: new Map(), brandById: new Map(),
};

/* ---------- helpers ---------- */
const values = () => Object.fromEntries(FIELDS.map(k => [k, $(k).value]));
const rowById = id => state.rowById.get(id) || null;
const areaById = id => state.index.byId.get(id) || null;
const districtById = id => state.index.districtById.get(id) || null;
const bottomSpace = () => $('insights').getBoundingClientRect().height + 12;
const activeFilterCount = f => FIELDS.filter(k => f[k]).length;
const overviewPanel = () => ({mode: 'overview', id: ''});
const sheetOffset = () => (mobilePortrait() ? [0, -Math.round(window.innerHeight * 0.2)] : [0, 0]);
const announce = text => { $('announcement').textContent = text; };
const theme = () => document.documentElement.dataset.theme;
const focusMode = () => (state.focusAreaIds.length ? 'explicit' : state.focusIds.length ? 'auto' : 'none');
const sheetOpen = () => mobilePortrait() && $('panel').classList.contains('is-open');
const animate = () => !reduced();

/** The venue being looked at: venue mode, or a store whose name links it to a venue. */
function currentVenue() {
  if (state.panel.mode === 'venue') return state.venueById.get(state.panel.id) || null;
  if (state.panel.mode === 'store') return rowById(state.panel.id)?.venue || null;
  return null;
}
/** Venue level (eye camera, x-ray): a venue with a host building in this data set. */
const venueLevel = () => { const v = currentVenue(); return Boolean(v && state.hosted.has(v.id)); };
const cameraPreset = () => presetFor({view3d: state.view3d, mode: ['overview', 'district'].includes(state.panel.mode) ? 'overview' : 'detail', twoPoint: state.twoPoint && venueLevel() && !sheetOpen()});

function saveURL() {
  const f = values(), p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  if (state.selectedDistrict) p.set('district', state.selectedDistrict);
  if (state.selectedArea) p.set('area', state.selectedArea);
  if (state.focusAreaIds.length) p.set('areas', state.focusAreaIds.join(','));
  else if (!state.autoFocus) p.set('areas', 'all');
  if (state.view !== 'density') p.set('view', state.view);
  if (state.panel.mode === 'store' && state.panel.id) p.set('store', state.panel.id);
  if (state.panel.mode === 'venue' && state.panel.id) p.set('place', state.panel.id);
  if (!state.view3d) p.set('view3d', '0');
  if (!state.twoPoint) p.set('cam', 'model');
  history.replaceState(null, '', location.pathname + (p.size ? '?' + p : ''));
}

/* ---------- theme ---------- */
function applyTheme() {
  const value = $('theme').value;
  const next = value === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('citymeter-restaurants-theme', value); } catch {}
  if (state.map && next !== state.mapTheme) {
    state.loaded = false;
    disposeSpatial();
    state.mapTheme = next;
    state.map.setStyle(buildMapStyle(next), {diff: false});
  }
  if (state.data) drawChart();
}

function disposeSpatial() {
  for (const k of ['xray', 'buildings', 'massing', 'pins']) { try { state[k]?.dispose(); } catch (e) { console.warn('dispose', k, e); } state[k] = null; }
  state.areaLayers = null; state.provinceLayers = null;
}

/* ---------- selection ---------- */
function update({fit = false} = {}) {
  const f = values();
  state.scopeRows = filterRows(state.data.rows, f);
  const area = state.selectedArea ? areaById(state.selectedArea) : null;
  const district = !area && state.selectedDistrict ? districtById(state.selectedDistrict) : null;
  state.baseRows = area ? state.scopeRows.filter(r => r.area === area.id) : district ? state.scopeRows.filter(r => r.district === district.id) : state.scopeRows;
  state.coverage = scopedCoverage({province: f.province, district: district?.id || ''});
  state.insight = summarizeAreaInsight(district ? state.baseRows : state.scopeRows, state.index, {coverage: state.coverage});
  state.focusIds = state.focusAreaIds.length ? state.focusAreaIds : (state.autoFocus && !area && !district ? state.insight.areaIds : []);
  state.rows = state.focusIds.length ? filterAreaRows(state.baseRows, new Set(state.focusIds)) : state.baseRows;
  state.page = 0;
  state.areaModel = buildAreaModel(state.scopeRows, state.index, {allAreaIds: state.coveredIds, province: f.province});

  // Keep the panel honest: drop a store/venue that left the filtered scope.
  const fallback = () => (area ? {mode: 'area', id: area.id} : district ? {mode: 'district', id: district.id} : overviewPanel());
  if (state.panel.mode === 'store' && !state.scopeRows.some(r => r.id === state.panel.id)) { state.panel = fallback(); state.history = []; }
  if (state.panel.mode === 'venue' && !state.scopeRows.some(r => r.venue?.id === state.panel.id)) { state.panel = fallback(); state.history = []; }
  if (state.panel.mode === 'area' && !area) state.panel = overviewPanel();
  if (state.panel.mode === 'district' && !district) state.panel = area ? {mode: 'area', id: area.id} : overviewPanel();
  if (state.panel.mode === 'overview' && (area || district)) state.panel = fallback();
  if (state.panel.mode !== 'store') { state.selectedId = ''; state.pins?.select(''); state.popup?.remove(); state.popup = null; }
  else state.selectedId = state.panel.id;

  const s = summarize(state.rows);
  $('filter-count').textContent = activeFilterCount(f) ? String(activeFilterCount(f)) : '';
  $('filter-chips').innerHTML = renderFilterChips(f, {
    group: Object.fromEntries(state.data.groups.map(g => [g.id, g.th])), price: PRICE_LABELS,
    province: Object.fromEntries(PROVINCES.map(p => [p.code, p.th])), brand: Object.fromEntries(state.data.brands.map(b => [b.id, b.name])), venue: {}});
  renderPanel(s);
  renderLegend();
  if (state.loaded) {
    updatePins();
    updateSpatialLayers();
    if (fit) fitMap();
    else if (state.lastPreset && cameraPreset() !== state.lastPreset) applyPreset(state.map, cameraPreset(), {animate: animate()});
    state.lastPreset = cameraPreset();
  }
  drawChart();
  syncList();
  saveURL();
  announce(`พบ ${num(s.count)} ร้าน`);
}

/**
 * Rows with full detail on the map, in the counter and in the table: the venue's own rows
 * (restaurants whose name refers to it) at venue level, else the focused rows.
 */
function detailRows() {
  const v = currentVenue();
  if (v && (state.panel.mode === 'venue' || venueLevel())) {
    if (detailRows.key !== v.id || detailRows.scope !== state.scopeRows) {
      detailRows.key = v.id; detailRows.scope = state.scopeRows; detailRows.rows = state.scopeRows.filter(r => r.venue?.id === v.id);
    }
    return detailRows.rows;
  }
  return state.rows;
}

/** Counter + table follow the rows that carry detail. */
function syncList() {
  const rows = detailRows(), v = rows === state.rows ? null : currentVenue();
  $('result-count').textContent = num(rows.length);
  $('results-title').textContent = v ? `ร้านที่ชื่ออ้างถึง ${v.name}` : 'ร้านตามตัวกรอง';
  if (syncList.last !== rows) state.page = 0;
  syncList.last = rows;
  renderTable();
}

function updatePins() {
  if (!state.pins) return;
  const focus = detailRows();
  const selected = state.selectedId ? rowById(state.selectedId) : null;
  const focusSet = new Set(focus.map(r => r.id));
  const list = selected && !focusSet.has(selected.id) ? [...focus, selected] : focus;
  if (selected) focusSet.add(selected.id);
  state.pins.update(list, {context: state.scopeRows.filter(r => !focusSet.has(r.id))});
  if (state.selectedId) state.pins.select(state.selectedId);
}

/**
 * The area the dataset covers within the current province / district filter: frames
 * that hold at least one row of the FULL dataset (the denominator of every
 * "พื้นที่ที่มีข้อมูล" density). Frames without any row are no_data, not zero.
 */
function scopedCoverage({province = '', district = ''} = {}) {
  let km2 = 0, areas = 0;
  for (const id of state.coveredIds) {
    const a = areaById(id);
    if (!a || (province && a.province !== province) || (district && a.district !== district)) continue;
    km2 += a.km2 || 0; areas++;
  }
  return {km2, areas};
}

/* ---------- breadcrumb ---------- */
function renderCrumbs() {
  const {mode, id} = state.panel;
  let crumbs;
  if (mode === 'venue') {
    const v = currentVenue(), rs = state.scopeRows.filter(r => r.venue?.id === v?.id);
    const provinces = [...new Set(rs.map(r => r.province))];
    crumbs = buildBreadcrumb({venue: v ? {id: v.id, name: v.name, province: provinces.length === 1 ? provinces[0] : ''} : null, province: $('province').value});
  } else if (mode === 'store') {
    const r = rowById(id);
    crumbs = buildBreadcrumb({area: r ? areaById(r.area) : null, province: r?.province || ''});
  } else {
    crumbs = buildBreadcrumb({province: $('province').value, area: state.selectedArea ? areaById(state.selectedArea) : null, district: state.selectedDistrict ? districtById(state.selectedDistrict) : null});
  }
  $('crumbs').innerHTML = renderBreadcrumb(crumbs);
  const title = mode === 'store' ? `${rowById(id)?.name || ''} · ` : '';
  document.title = `${title}${breadcrumbText(crumbs)} · Restaurants · CityMETER`;
  return crumbs;
}

/* ---------- panel ---------- */
const densityClassOf = a => {
  const m = state.areaModel;
  const x = m?.areas.find(y => y.id === a.id);
  return x?.fill || classify(a.density, m?.classes || {classes: [], zero: {}}).fill || 'var(--scale-count-3)';
};

function renderPanel(summary = summarize(state.rows)) {
  const view = $('panel-view');
  const {mode, id} = state.panel;
  renderCrumbs();
  syncEyeToggle();
  let html = '';
  const groups = state.data.groups;
  const meta = state.data.meta || {};
  if (mode === 'area') html = renderArea(buildAreaProfile(state.scopeRows, id, state.index, groups), meta);
  else if (mode === 'district') html = renderDistrict(buildDistrictProfile(state.scopeRows, id, state.index, groups), densityClassOf, meta);
  else if (mode === 'venue') html = renderVenue(buildVenueProfile(state.scopeRows, state.venueById.get(id), state.index, groups, {hosted: state.hosted.has(id)}), state.index, meta);
  else if (mode === 'store') html = renderStore(buildStoreDetail(rowById(id), {scopeRows: state.scopeRows, index: state.index, groups}), {...meta, index: state.index});
  if (!html) {
    const province = $('province').value;
    const overview = buildOverview(state.scopeRows, state.index, {province});
    const provinces = province ? [] : (state.provinceModel?.provinces || buildProvinceModelSafe()).filter(p => p.count > 0).sort((a, b) => b.count - a.count);
    const insight = focusMode() === 'explicit' ? summarizeAreaInsight(state.rows, state.index, {coverage: state.coverage, minRows: 1}) : state.insight;
    html = renderOverview({insight, summary, overview, focusMode: focusMode(), classOf: densityClassOf, provinces, meta, coverage: state.coverage, province});
    renderMapAha(insight);
  } else {
    $('map-aha').hidden = true;
  }
  view.innerHTML = html;
  view.dataset.mode = mode;
  const key = `${mode}:${id}:${$('province').value}`;
  if (key !== renderPanel.lastKey) $('panel').scrollTop = 0;
  renderPanel.lastKey = key;
}

function renderMapAha(insight) {
  const el = $('map-aha');
  if (!insight.areas.length) { el.hidden = true; return; }
  const mode = focusMode();
  el.hidden = $('panel').classList.contains('is-open');
  const crumb = `<p class="map-aha-crumb">${esc(breadcrumbText(buildBreadcrumb({province: $('province').value})))}</p>`;
  const names = insight.areas.map(a => esc(a.name)).join(' · ');
  el.innerHTML = mode === 'explicit'
    ? `<div>${crumb}<h2>กำลังสำรวจ ${num(insight.areas.length)} พื้นที่</h2><p>${num(insight.count)} ร้าน</p></div><button type="button" class="btn" data-action="clear-focus">ดูทุกพื้นที่</button>`
    : `<div>${crumb}<h2>${insight.mode === 'density' ? `${dec(insight.density)} ร้าน/ตร.กม. ใน ${num(insight.areas.length)} พื้นที่ที่แน่นที่สุด` : `${num(Math.round(insight.share))}% ของร้านอยู่ใน ${num(insight.areas.length)} พื้นที่`}</h2><p>${names}</p></div>${mode === 'auto'
      ? '<button type="button" class="btn" data-action="clear-focus">ดูทุกพื้นที่</button>'
      : '<button type="button" class="btn primary" data-action="explore-top">โฟกัส</button>'}`;
}

function pushHistory() { state.history.push({...state.panel, area: state.selectedArea, district: state.selectedDistrict}); if (state.history.length > 20) state.history.shift(); }

function goBack() {
  const previous = state.history.pop();
  if (!previous) { state.selectedArea = ''; state.selectedDistrict = ''; state.panel = overviewPanel(); update({fit: true}); return; }
  const fit = previous.area !== state.selectedArea || previous.district !== state.selectedDistrict;
  state.selectedArea = previous.area || ''; state.selectedDistrict = previous.district || '';
  state.panel = {mode: previous.mode, id: previous.id};
  update({fit});
}

function selectArea(id, {fromMap = false} = {}) {
  const area = areaById(id);
  if (!area) return;
  if (state.panel.mode !== 'area' || state.panel.id !== id) pushHistory();
  state.selectedArea = id; state.selectedDistrict = '';
  state.focusAreaIds = [];
  state.panel = {mode: 'area', id};
  update();
  if (!fromMap) openMobilePanel();
  if (state.loaded) fitFeature(area.feature, {maxZoom: 17.5});
}

function selectDistrict(id) {
  const d = districtById(id);
  if (!d) return;
  if (state.panel.mode !== 'district' || state.panel.id !== id) pushHistory();
  state.selectedDistrict = id; state.selectedArea = '';
  state.focusAreaIds = [];
  state.panel = {mode: 'district', id};
  update();
  openMobilePanel();
  if (state.loaded) fitFeature(d.feature, {maxZoom: 16});
}

function selectStore(id, {fly = true, showPopup = false, fromPin = false} = {}) {
  const r = rowById(id);
  if (!r) return;
  if (state.panel.mode !== 'store') pushHistory();
  state.panel = {mode: 'store', id};
  state.selectedId = id;
  renderPanel();
  syncList();
  saveURL();
  if (state.loaded) { updatePins(); updateSpatialLayers(); state.pins?.select(id); }
  if (hasPoint(r) && state.loaded) {
    if (venueLevel() && (fly || cameraPreset() !== state.lastPreset)) frameVenue();
    else if (fly || cameraPreset() !== state.lastPreset) framePoint(state.map, [r.longitude, r.latitude], {preset: cameraPreset(), zoom: 16.5, offset: sheetOffset(), animate: animate()});
    state.lastPreset = cameraPreset();
    state.popup?.remove(); state.popup = null;
    if (showPopup && !mobilePortrait()) {
      const wrap = document.createElement('div'), h = document.createElement('h3'), p = document.createElement('p');
      wrap.innerHTML = brandLogoMarkup(r.brand, {size: 'sm', className: 'popup-logo'});
      h.textContent = r.name;
      p.textContent = [r.type || 'ไม่ระบุประเภท', Number.isFinite(r.rating) ? `★ ${dec(r.rating)}` : ''].filter(Boolean).join(' · ');
      wrap.append(h, p);
      state.popup = new maplibregl.Popup({maxWidth: '280px', offset: 14, closeButton: true}).setLngLat([r.longitude, r.latitude]).setDOMContent(wrap).addTo(state.map);
    }
  }
  if (!fromPin || mobilePortrait()) openMobilePanel();
  announce(`เลือก ${r.name}`);
}

function selectVenue(id) {
  const v = state.venueById.get(id);
  if (!v) return;
  pushHistory();
  state.panel = {mode: 'venue', id};
  state.selectedId = '';
  state.pins?.select('');
  renderPanel();
  syncList();
  saveURL();
  if (state.loaded) { updatePins(); updateSpatialLayers(); frameVenue(); state.lastPreset = cameraPreset(); }
  openMobilePanel();
}

/**
 * Frame the venue: its host building(s) when the data set has them (footprint and
 * roof vertices inside the padded viewport); otherwise the bounds of the rows that
 * name it (a name-based list can span far apart — the frame says so by its size).
 */
function frameVenue({instant = false} = {}) {
  const map = state.map, preset = cameraPreset(), v = currentVenue();
  if (!v) return;
  const targets = venueTargets();
  if (targets.length && preset !== 'plan' && !mobilePortrait()) {
    const ground = targets.flatMap(t => t.ring.map(([lng, lat]) => [lng, lat, 0]));
    const roof = targets.flatMap(t => t.ring.map(([lng, lat]) => [lng, lat, t.height]));
    const bounds = ground.reduce((b, p) => b.extend([p[0], p[1]]), new maplibregl.LngLatBounds([ground[0][0], ground[0][1]], [ground[0][0], ground[0][1]]));
    const h = map.getContainer().clientHeight;
    const padding = {top: Math.round(h * (preset === 'eye' ? 0.12 : 0.1)), bottom: 48, left: 48, right: 48};
    const foot = fitPitched(map, bounds, {preset, points: ground, padding, maxZoom: 17.6, minZoom: 14.5, apply: false});
    const minZoom = Math.max(14.5, (foot?.zoom ?? 17.6) - 1);
    fitPitched(map, bounds, {preset, points: [...ground, ...roof], padding, maxZoom: 17.6, minZoom, animate: animate() && !instant});
    return;
  }
  const rs = state.scopeRows.filter(r => r.venue?.id === v.id && hasPoint(r));
  if (state.panel.mode === 'store') { const r = rowById(state.panel.id); if (r) { framePoint(map, [r.longitude, r.latitude], {preset, zoom: 16.5, offset: sheetOffset(), animate: animate() && !instant}); return; } }
  if (!rs.length) return;
  const b = new maplibregl.LngLatBounds();
  rs.forEach(r => b.extend([r.longitude, r.latitude]));
  const wide = b.getNorth() - b.getSouth() > 0.2 || b.getEast() - b.getWest() > 0.2;
  fitPitched(map, b, {preset: wide || sheetOpen() || !state.view3d ? 'plan' : 'model', padding: cameraPadding(), maxZoom: 17, minZoom: 9, animate: animate() && !instant});
}

/** Focus the top three areas of the current scope (auto mode; URL stays clean). */
function exploreTop() { state.autoFocus = true; state.focusAreaIds = []; update({fit: true}); closeMobilePanel(); }
/** Show every area with detail (no quiet context) — ?areas=all. */
function clearFocus() { state.autoFocus = false; state.focusAreaIds = []; update({fit: true}); }

function selectProvince(code) {
  const c = provinceCodeFrom(code);
  if (!c) return;
  $('province').value = c;
  state.selectedArea = ''; state.selectedDistrict = '';
  state.focusAreaIds = [];
  state.panel = overviewPanel();
  state.history = [];
  update({fit: true});
  announce(`จังหวัด${provinceByCode(c)?.th || c}`);
}

function resetToOverview({fit = true} = {}) {
  state.focusAreaIds = [];
  state.selectedArea = ''; state.selectedDistrict = '';
  state.panel = overviewPanel();
  state.history = [];
  update({fit});
}

function clearFilter(key) {
  if (key === 'all') { $('filters').reset(); resetToOverview(); return; }
  if (FIELDS.includes(key)) $(key).value = '';
  update({fit: key !== 'search'});
}

function filterBrand(id) {
  if (![...$('brand').options].some(o => o.value === id)) return;
  $('brand').value = id;
  state.selectedArea = ''; state.selectedDistrict = '';
  state.focusAreaIds = [];
  state.panel = overviewPanel();
  state.history = [];
  update({fit: true});
  $('panel').scrollTop = 0;
}

function onPanelAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const {action, id, value} = target.dataset;
  switch (action) {
    case 'select-area': selectArea(id); break;
    case 'select-district': selectDistrict(id); break;
    case 'select-store': selectStore(id); break;
    case 'select-venue': selectVenue(id); break;
    case 'select-province': selectProvince(id); break;
    case 'filter-brand': filterBrand(value); break;
    case 'back': goBack(); break;
    case 'explore-top': exploreTop(); break;
    case 'clear-focus': clearFocus(); break;
    case 'open-charts': openInsights(true); closeMobilePanel(); break;
    case 'open-table': $('results').hidden = false; closeMobilePanel(); $('toggle-table').focus({preventScroll: true}); break;
    case 'clear-filter': clearFilter(id); break;
    case 'crumb-country': $('province').value = ''; resetToOverview(); break;
    case 'crumb-province': { const c = provinceCodeFrom(id); if (c) $('province').value = c; resetToOverview(); break; }
    case 'crumb-district': selectDistrict(id); break;
    case 'crumb-area': selectArea(id); break;
    case 'crumb-venue': selectVenue(id); break;
    case 'crumb-expand': { const ol = target.closest('.crumbs'); ol.classList.add('is-expanded'); target.setAttribute('aria-expanded', 'true'); ol.querySelector('.crumb:not(.crumb-more)')?.focus({preventScroll: true}); break; }
    case 'toggle-3d': toggle3d(); break;
    default: break;
  }
}

/* ---------- legend ---------- */
const provinceZoom = () => Boolean(state.provinceModel) && (state.map?.getZoom?.() ?? 12) < PROVINCE_FILL_MAX_ZOOM;
function renderLegend() {
  const atProvince = provinceZoom();
  const steps = $('legend-steps');
  if (atProvince) {
    const m = state.provinceModel;
    $('legend-title').textContent = 'จังหวัด · ร้านในชุดข้อมูล';
    steps.innerHTML = m?.classes.classes.length ? m.classes.classes.map(c => `<span class="legend-step"><i style="background:${c.fill}" aria-hidden="true"></i>${esc(c.label)}</span>`).join('') + (m.zeroCount ? '<span class="legend-step"><i class="legend-zero" aria-hidden="true"></i>0</span>' : '') : '<span class="hint">ไม่มีร้านในตัวกรองนี้</span>';
    $('legend-areas').title = `ร้านต่อจังหวัด (ผลรวม) · ${m?.classes.classCount || 0} ระดับเท่าช่วง · จังหวัดที่ไม่มีร้านในชุดข้อมูลไม่วาด · สีเดียวกันทั้งสองธีม`;
  } else {
    const m = state.areaModel;
    $('legend-title').textContent = 'แขวง/ตำบล · ร้าน/ตร.กม.';
    steps.innerHTML = (m?.classes.classes.length ? m.classes.classes.map(c => `<span class="legend-step"><i style="background:${c.fill}" aria-hidden="true"></i>${esc(c.label)}</span>`).join('') : '<span class="hint">ไม่มีร้านในตัวกรองนี้</span>') +
      (m?.zeroCount ? `<span class="legend-step" title="พื้นที่ที่มีร้านในชุดข้อมูล แต่ไม่พบตามตัวกรองนี้"><i class="legend-zero" style="background:${m.classes.zero.fill}" aria-hidden="true"></i>0</span>` : '') +
      (m?.noDataCount ? '<span class="legend-step" title="แหล่งข้อมูลไม่มีร้านในพื้นที่นี้ ไม่ได้แปลว่าไม่มีร้านอาหาร"><i class="legend-nodata" aria-hidden="true"></i>ไม่มีข้อมูล</span>' : '');
    $('legend-areas').title = `ร้านต่อ ตร.กม. ของแขวง/ตำบล (ร้าน ÷ พื้นที่ตาม CityMETER) · ${m?.classes.classCount || 0} ระดับเท่าช่วง [ล่าง, บน) ช่วงสุดท้ายปิด · สีเดียวกันทั้งสองธีม`;
  }
  document.querySelector('.map-panel').classList.toggle('is-3d', state.view3d);
  document.querySelector('.map-panel').classList.toggle('has-venue-building', venueLevel());
  document.querySelector('.map-panel').classList.toggle('is-province-zoom', atProvince);
}

/* ---------- charts ---------- */
let chartDispose = null;
function drawChart() {
  if (!state.data) return;
  chartDispose?.(); chartDispose = null;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === state.view));
  $('chart').setAttribute('aria-labelledby', 'tab-' + state.view);
  const narrowed = state.selectedArea || state.selectedDistrict || state.focusIds.length;
  $('chart-scope').textContent = `${num(state.scopeRows.length)} ร้านในตัวกรอง${narrowed ? ' · ทุกพื้นที่' : ''}`;
  if ($('insight-content').hidden) return;
  chartDispose = renderInsightChart({elementId: 'chart', view: state.view, rows: state.scopeRows, index: state.index, groups: state.data.groups, theme: theme(), selectedAreaId: state.selectedArea},
    selection => { if (selection.type === 'area') selectArea(selection.id, {fromMap: true}); });
}

function openInsights(open) {
  $('insight-content').hidden = !open;
  $('insights').classList.toggle('is-collapsed', !open);
  $('toggle-insights').setAttribute('aria-expanded', String(open));
  $('toggle-insights').textContent = open ? 'ย่อกราฟ' : 'เปิดกราฟ';
  requestAnimationFrame(() => { syncBottomPanel(); drawChart(); });
}

function syncBottomPanel() {
  document.documentElement.style.setProperty('--bottom-panel-height', `${$('insights').getBoundingClientRect().height}px`);
  state.pins?.layout();
  state.labels?.layout();
}

/* ---------- table ---------- */
const tableOrder = (a, b) => (b.reviews ?? -1) - (a.reviews ?? -1) || a.name.localeCompare(b.name, 'th') || a.id.localeCompare(b.id);
function renderTable() {
  if ($('results').hidden && renderTable.done) { renderTable.stale = true; return; }
  renderTable.done = true; renderTable.stale = false;
  const pageSize = 25, start = state.page * pageSize;
  const list = detailRows();
  if (state.page === 0 || !renderTable.sorted || renderTable.source !== list) { renderTable.sorted = [...list].sort(tableOrder); renderTable.source = list; }
  const rs = renderTable.sorted.slice(start, start + pageSize);
  $('result-rows').innerHTML = rs.map(r => {
    const a = areaById(r.area);
    return `<tr><td><button type="button" class="row-name brand-row" data-id="${esc(r.id)}">${brandLogoMarkup(r.brand, {size: 'xs'})}<span>${esc(r.name)}</span></button><small>${esc(r.type || 'ไม่ระบุประเภท')}</small></td>
      <td>${esc(PRICE_LABELS[r.price])}</td>
      <td>${Number.isFinite(r.rating) ? `★ <span class="data-number">${dec(r.rating)}</span>` : '<span class="hint">ไม่มีคะแนน</span>'}<small>${Number.isFinite(r.reviews) ? `${num(r.reviews)} รีวิว` : ''}</small></td>
      <td>${a ? `${esc(areaWord(a.province))}${esc(a.name)}<small>${esc(districtWord(a.province))}${esc(a.districtName)} · ${esc(provinceByCode(a.province)?.th || '')}</small>` : '—'}</td>
      <td>${r.brand ? esc(r.brand.name) : '<span class="hint">—</span>'}${r.venue ? `<small>${esc(r.venue.name)}</small>` : ''}</td>
      <td><small class="data-number">${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}</small></td></tr>`;
  }).join('') || '<tr><td colspan="6">ไม่พบร้านตามตัวกรอง</td></tr>';
  $('page-label').textContent = list.length ? `${num(start + 1)}–${num(Math.min(start + pageSize, list.length))} / ${num(list.length)}` : '0 ร้าน';
  $('prev-page').disabled = state.page === 0;
  $('next-page').disabled = start + pageSize >= list.length;
  for (const b of $('result-rows').querySelectorAll('[data-id]')) b.onclick = () => { selectStore(b.dataset.id); $('panel').scrollTop = 0; };
}

/* ---------- map ---------- */
function cameraPadding() {
  const height = $('map').clientHeight, panel = $('insights').getBoundingClientRect().height;
  const edge = Math.min(48, Math.max(12, (height - panel) / 6));
  const mapTop = $('map').getBoundingClientRect().top, toolbar = document.querySelector('.map-toolbar').getBoundingClientRect();
  const aha = $('map-aha'), legend = $('map-legend');
  const chromeTop = !aha.hidden && aha.offsetHeight ? aha.getBoundingClientRect().top : legend.offsetHeight ? legend.getBoundingClientRect().top : null;
  let bottom = chromeTop != null ? height - (chromeTop - mapTop) + 12 : panel + edge;
  if (mobilePortrait() && $('panel').classList.contains('is-open')) bottom = Math.max(bottom, Math.round(window.innerHeight * 0.64) - (window.innerHeight - height - mapTop) + 8);
  return {top: Math.max(edge, toolbar.bottom - mapTop + 12), left: edge, right: edge, bottom: Math.min(height * 0.7, bottom)};
}

/** Padding for pitched fits: the legend is ignored (foreshortening already lifts the content). */
function pitchedPadding() {
  const mapTop = $('map').getBoundingClientRect().top, toolbar = document.querySelector('.map-toolbar').getBoundingClientRect();
  return {top: Math.round(toolbar.bottom - mapTop + 12), bottom: Math.round($('insights').getBoundingClientRect().height + 40), left: 24, right: 24};
}

function vertices(features) {
  const out = [];
  const walk = v => { if (typeof v[0] === 'number') out.push(v); else v.forEach(walk); };
  for (const f of features) walk(f.geometry.coordinates);
  return out;
}

/** Frame one area or district outline (plan while the mobile sheet covers the map; 3D preset when it closes). */
function fitFeature(feature, {maxZoom = 17.5, instant = false} = {}) {
  const preset = sheetOpen() ? 'plan' : cameraPreset();
  const pitched = preset !== 'plan' && !mobilePortrait();
  fitPitched(state.map, featureBounds(feature, maplibregl.LngLatBounds), {preset, padding: pitched ? pitchedPadding() : cameraPadding(), maxZoom, minZoom: 9, animate: animate() && !instant, points: vertices([feature]), shift: mobilePortrait() ? -0.08 : null});
}

function fitMap({instant = false} = {}) {
  if (!state.loaded) return;
  const area = state.selectedArea ? areaById(state.selectedArea) : null;
  if (area) { fitFeature(area.feature, {instant}); return; }
  const district = state.selectedDistrict ? districtById(state.selectedDistrict) : null;
  if (district) { fitFeature(district.feature, {maxZoom: 16, instant}); return; }
  const focusFeatures = state.focusIds.map(id => areaById(id)?.feature).filter(Boolean);
  const b = new maplibregl.LngLatBounds();
  if (focusFeatures.length) focusFeatures.forEach(f => featureBounds(f, maplibregl.LngLatBounds).toArray().forEach(p => b.extend(p)));
  else {
    const rs = state.rows.filter(hasPoint);
    if (!rs.length) return;
    let w = 180, e = -180, s = 90, n = -90;
    for (const r of rs) { if (r.longitude < w) w = r.longitude; if (r.longitude > e) e = r.longitude; if (r.latitude < s) s = r.latitude; if (r.latitude > n) n = r.latitude; }
    b.extend([w, s]); b.extend([e, n]);
  }
  const wide = b.getNorth() - b.getSouth() > 0.3 || b.getEast() - b.getWest() > 0.3;
  const preset = wide ? 'plan' : cameraPreset();
  const pitched = preset !== 'plan' && !mobilePortrait();
  fitPitched(state.map, b, {preset, padding: pitched ? pitchedPadding() : cameraPadding(), maxZoom: 15, minZoom: 5, animate: animate() && !instant, points: focusFeatures.length ? vertices(focusFeatures) : null, shift: mobilePortrait() && !wide ? -0.12 : null});
}

/** Rows for the province frames: current filters WITHOUT the province filter, so every frame keeps its own count. */
const provinceScopeRows = () => filterRows(state.data.rows, {...values(), province: ''});
function buildProvinceModelSafe() {
  try { return state.provincesGeo?.features?.length ? buildProvinceModel(provinceScopeRows(), state.provincesGeo).provinces : []; } catch { return []; }
}

/**
 * Labels: the selection and the focus first, then the densest other areas of the scope as
 * quiet chips (bounded: fewer on a phone, where the focus must stay readable). Each chip
 * carries the density value and a swatch of its class colour (the legend link).
 */
function areaLabelItems() {
  const m = state.areaModel;
  if (!m) return [];
  const focus = new Set(state.selectedArea ? [state.selectedArea] : state.focusIds);
  const district = state.selectedDistrict;
  const pool = m.areas.filter(a => a.count > 0 && (!district || a.district === district));
  const others = pool.filter(a => !focus.has(a.id)).sort((a, b) => (b.density ?? 0) - (a.density ?? 0));
  const quietLimit = district ? 40 : focus.size ? (mobilePortrait() ? 0 : 12) : (mobilePortrait() ? 10 : 30);
  const ordered = [...pool.filter(a => focus.has(a.id)), ...others.slice(0, quietLimit)];
  const fmt = new Intl.NumberFormat('th-TH', {maximumFractionDigits: m.classes.precision ?? 0, minimumFractionDigits: m.classes.precision ?? 0});
  return ordered.map(a => ({id: a.id, name: a.name, value: fmt.format(a.density || 0), state: a.state, quiet: focus.size > 0 && !focus.has(a.id) && !district,
    selected: a.id === state.selectedArea, center: a.label, swatch: a.fill || '',
    title: `${areaWord(a.province)}${a.name} · ${dec(a.density || 0)} ร้าน/ตร.กม. · ${num(a.count)} ร้าน`}));
}

function updateSpatialLayers() {
  if (!state.loaded) return;
  const code = $('province').value;
  const pm = state.provinceLayers?.update({rows: provinceScopeRows(), selectedCode: code, visible: true}) || null;
  state.provinceModel = pm;
  state.provinceLabels?.update(pm ? pm.provinces.filter(p => p.count > 0 || p.code === code).sort((a, b) => (b.code === code) - (a.code === code) || b.count - a.count)
    .map(p => ({id: p.code, name: p.name, value: num(p.count), state: p.state, quiet: Boolean(code) && p.code !== code, selected: p.code === code, center: p.label, swatch: p.fill || '', title: `${p.name} · ${num(p.count)} ร้านในชุดข้อมูล`})) : [], {visible: true});
  const districtAreas = state.selectedDistrict ? (districtById(state.selectedDistrict)?.areas || []).map(a => a.id) : [];
  state.areaLayers?.update({model: state.areaModel, selectedId: state.selectedArea, focusIds: state.selectedDistrict ? districtAreas : state.focusIds, outlineFocus: !state.selectedDistrict, districtId: state.selectedDistrict, visible: state.showAreas});
  state.labels?.update(state.showAreas ? areaLabelItems() : [], {visible: state.showAreas});
  renderLegend();
  const v = currentVenue();
  state.buildings?.update({venueIds: v && venueLevel() ? [v.id] : [], enabled: true, theme: theme()});
  const focusFeatures = state.selectedArea ? [areaById(state.selectedArea)?.feature].filter(Boolean) : state.selectedDistrict ? [] : state.focusIds.map(id => areaById(id)?.feature).filter(Boolean);
  const hostFeatures = state.buildings?.displayedFeatures() || [];
  const anchorFeatures = focusFeatures.length ? focusFeatures : (state.selectedDistrict ? [districtById(state.selectedDistrict)?.feature].filter(Boolean) : []);
  const anchors = anchorFeatures.length ? anchorFeatures.map(f => featureBounds(f, maplibregl.LngLatBounds).getCenter().toArray()) : [state.map.getCenter().toArray()];
  state.massing?.update({regions: focusFeatures.flatMap(outerRings), hosts: hostFeatures.flatMap(outerRings), anchors, enabled: true, city: state.view3d, zoom: state.map.getZoom(), latitude: state.map.getCenter().lat})?.catch(e => console.warn('Massing', e));
  state.massing?.setScene(cameraPreset() === 'eye' ? 'eye' : 'default', venueTargets());
  const hostColors = () => { const s = getComputedStyle(document.documentElement); return {fill: s.getPropertyValue('--map-active-layer').trim(), stroke: s.getPropertyValue('--map-selected-stroke').trim()}; };
  state.xray?.update(venueLevel() ? hostFeatures.filter(f => f.properties?.render_as === 'extrusion') : [], {colors: hostColors()});
  state.xray?.setEnabled(state.view3d);
  state.pins?.layout();
}

/** Host building rings (+ display height) of the venue being looked at — occlusion and framing targets. */
function venueTargets() {
  if (!venueLevel()) return [];
  return (state.buildings?.displayedFeatures() || []).flatMap(f => outerRings(f).map(ring => ({ring, height: Number(f.properties?.display_height_m) || 3})));
}

/** One click handler, in priority order: venue solid → host building → pin → area. */
function onMapClick(e) {
  const point = e.point;
  if (state.xray?.hitTest([point.x, point.y])) { const v = currentVenue(); if (v && state.panel.mode !== 'venue') selectVenue(v.id); return; }
  const hostVenues = state.buildings?.hitTest(point) || [];
  if (hostVenues.length) { if (state.panel.mode !== 'venue' || state.panel.id !== hostVenues[0]) selectVenue(hostVenues[0]); return; }
  const r = state.pins?.hitTest(point);
  if (r) { selectStore(r.id, {fly: false, showPopup: true, fromPin: true}); return; }
  if (state.map.getZoom() < PROVINCE_FILL_MAX_ZOOM) {
    const p = state.map.queryRenderedFeatures(point, {layers: ['province-fill'].filter(id => state.map.getLayer(id))})[0];
    if (p) { selectProvince(String(p.id ?? p.properties?.id)); return; }
  }
  const a = state.map.queryRenderedFeatures(point, {layers: ['area-fill', 'area-nodata'].filter(id => state.map.getLayer(id))})[0];
  if (a && state.showAreas) selectArea(String(a.id ?? a.properties?.id), {fromMap: true});
}

function onMapMove(e) {
  const map = state.map;
  const over = Boolean(state.xray?.hitTest([e.point.x, e.point.y])) || (state.buildings?.hitTest(e.point) || []).length > 0 || Boolean(state.pins?.hitTest(e.point));
  map.getCanvas().style.cursor = over ? 'pointer' : '';
}

function installSpatialLayers() {
  const map = state.map;
  state.loaded = true;
  const palette = basemapPalette(theme());
  state.provinceLayers = state.provincesGeo?.features?.length ? installProvinceLayers(map, state.provincesGeo) : null;
  state.areaLayers = installAreaLayers(map, state.areasGeo, state.districtsGeo);
  // Draw order is depth order in MapLibre's 3D pass: the host (data) layer is installed first and the
  // massing tiers are inserted BEFORE it, so a translucent context building can never cut the venue away.
  state.buildings = installVenueBuildings(map, state.buildingGeo, {venueIds: [], enabled: true, theme: theme(), beforeId: MASSING_BEFORE});
  state.massing = installMassing(map, {
    beforeId: map.getLayer(HOST_LAYERS.extrusion) ? HOST_LAYERS.extrusion : MASSING_BEFORE, colors: {quiet: palette.massingQuiet, focus: palette.massingFocus, ground: palette.ground},
    tileUrl: t => (state.tileTemplate ? state.tileTemplate.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y) : ''),
    onResult: result => { state.massingResult = result; $('map-status').dataset.massing = `${result.features || 0}`; },
  });
  try { state.xray = installVenueXray(map, {beforeId: MASSING_BEFORE}); }
  catch (e) { state.xray = null; console.warn('Venue x-ray unavailable', e); }
  state.pins = installRestaurantPins(map, $('map'), {
    reservedBottom: bottomSpace,
    onSelect: r => selectStore(r.id, {fly: false, showPopup: true, fromPin: true}),
    onLayout: stats => {
      const logos = stats.htmlPins ? ` · โลโก้ ${num(stats.visibleLogos)}/${num(stats.logoLimit)}` : '';
      $('map-status').textContent = `${num(stats.focusInView)} ร้านในจอ${logos} · บริบท ${num(stats.contextRows)}`;
    },
  });
  updatePins();
  updateSpatialLayers();
  if (!state.initialCameraDone) {
    state.initialCameraDone = true;
    if (state.panel.mode === 'store') { const r = rowById(state.panel.id); if (r && hasPoint(r)) { if (venueLevel()) frameVenue({instant: true}); else framePoint(map, [r.longitude, r.latitude], {preset: cameraPreset(), zoom: 16.5, animate: false}); } }
    else if (state.panel.mode === 'venue') frameVenue({instant: true});
    else fitMap({instant: true});
    state.lastPreset = cameraPreset();
  }
}

function initMap() {
  if (!window.maplibregl) throw new Error('Map library is unavailable');
  try {
    state.mapTheme = theme();
    state.map = new maplibregl.Map({container: 'map', center: BANGKOK.center, zoom: BANGKOK.zoom, pitch: 0, maxPitch: 85, attributionControl: {compact: true}, style: buildMapStyle(state.mapTheme)});
    state.map.addControl(new maplibregl.NavigationControl({showCompass: true, visualizePitch: true}), 'top-right');
    state.labels = installAreaLabels(state.map, $('map'), {className: 'neighborhood-label', hostId: 'area-labels', hostLabel: 'แขวง/ตำบลบนแผนที่', minZoom: 11.5, verb: 'กดเพื่อสำรวจพื้นที่', onSelect: id => selectArea(id, {fromMap: true}), reservedBottom: bottomSpace, maxLabels: 40});
    state.provinceLabels = installAreaLabels(state.map, $('map'), {className: 'province-label', hostId: 'province-labels', hostLabel: 'จังหวัดบนแผนที่', minZoom: 0, maxZoom: PROVINCE_LABEL_MAX_ZOOM, verb: 'กดเพื่อดูจังหวัด', detailZoomClass: false, onSelect: code => selectProvince(code), reservedBottom: bottomSpace});
    state.map.on('zoomend', () => { if (state.loaded) renderLegend(); });
    state.map.on('style.load', installSpatialLayers);
    state.map.on('click', onMapClick);
    state.map.on('mousemove', onMapMove);
    state.map.on('error', e => console.warn('Map resource', e.error?.message || e));
    fetch(TILEJSON_URL).then(r => r.json()).then(j => { state.tileTemplate = j.tiles?.[0] || ''; if (state.loaded) updateSpatialLayers(); }).catch(e => console.warn('TileJSON', e));
  } catch (e) {
    state.loaded = false; state.initialCameraDone = false;
    for (const cleanup of [() => state.labels?.dispose(), () => state.provinceLabels?.dispose(), disposeSpatial, () => state.map?.remove()]) { try { cleanup(); } catch (err) { console.warn('Map cleanup', err); } }
    state.map = null; state.labels = null; state.provinceLabels = null; state.provinceModel = null;
    throw e;
  }
}

async function startMap() {
  const el = $('map-failure');
  try { await loadMapLibrary(); el.hidden = true; initMap(); }
  catch (e) {
    el.hidden = false;
    el.innerHTML = `<p>โหลดแผนที่ไม่สำเร็จ ข้อมูล ตาราง และกราฟยังใช้งานได้</p><p class="hint">${esc(e.message || '')}</p><button type="button" class="btn">ลองโหลดแผนที่ใหม่</button>`;
    el.querySelector('button').onclick = event => { event.target.disabled = true; startMap(); };
    console.warn(e);
  }
}

function toggle3d() {
  state.view3d = !state.view3d;
  $('toggle-3d').setAttribute('aria-pressed', String(state.view3d));
  syncEyeToggle();
  renderLegend();
  renderPanel();
  updateSpatialLayers();
  if (state.map) { applyPreset(state.map, cameraPreset(), {animate: animate()}); state.lastPreset = cameraPreset(); }
  saveURL();
}

function toggleTwoPoint() {
  state.twoPoint = !state.twoPoint;
  syncEyeToggle();
  if (state.map && state.view3d) { if (state.panel.mode === 'venue') frameVenue(); else applyPreset(state.map, cameraPreset(), {animate: animate()}); state.lastPreset = cameraPreset(); }
  updateSpatialLayers();
  saveURL();
}
/** มุมสถาปนิก is a venue-level camera: pressed by default there, unavailable elsewhere and in 2D. */
function syncEyeToggle() {
  const b = $('toggle-eye');
  b.setAttribute('aria-pressed', String(state.twoPoint));
  b.disabled = !state.view3d || !venueLevel();
}

/* ---------- mobile sheet ---------- */
function openMobilePanel() {
  if (!mobilePortrait()) return;
  $('panel').classList.add('is-open');
  $('mobile-panel').setAttribute('aria-expanded', 'true');
  $('map-aha').hidden = true;
}
function closeMobilePanel() {
  const wasOpen = $('panel').classList.contains('is-open');
  $('panel').classList.remove('is-open');
  $('mobile-panel').setAttribute('aria-expanded', 'false');
  if (mobilePortrait()) {
    $('mobile-panel').focus({preventScroll: true});
    if (state.panel.mode === 'overview') renderPanel();
    else if (wasOpen && state.loaded && state.panel.mode === 'area') { const a = areaById(state.panel.id); if (a) fitFeature(a.feature); }
    else if (wasOpen && state.loaded && state.panel.mode === 'district') { const d = districtById(state.panel.id); if (d) fitFeature(d.feature, {maxZoom: 16}); }
    else if (wasOpen && state.loaded && (state.panel.mode === 'venue' || venueLevel())) frameVenue();
    else if (wasOpen && state.loaded && state.panel.mode === 'store') { const r = rowById(state.panel.id); if (r && hasPoint(r)) framePoint(state.map, [r.longitude, r.latitude], {preset: cameraPreset(), zoom: 16.5, animate: animate()}); }
    updateSpatialLayers();
  }
}

/* ---------- data loading ---------- */
function validFeatureCollection(value) {
  if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features)) return false;
  const position = p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  const ring = r => Array.isArray(r) && r.length >= 4 && r.every(position);
  const polygon = p => Array.isArray(p) && p.length > 0 && p.every(ring);
  return value.features.every(f => {
    const g = f?.geometry, id = f?.id ?? f?.properties?.id;
    return f?.type === 'Feature' && (typeof id === 'string' || typeof id === 'number') && (g?.type === 'Polygon' ? polygon(g.coordinates) : g?.type === 'MultiPolygon' && g.coordinates.every(polygon));
  });
}

async function fetchJSON(resource, {timeout = 20000} = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(resource, {signal: controller.signal, cache: 'no-cache'});
    if (!r.ok) { const e = new Error('โหลดข้อมูลไม่สำเร็จ'); e.status = r.status; throw e; }
    return await r.json();
  } catch (e) { e.resource = resource; e.phase = 'data'; throw e; }
  finally { clearTimeout(timer); }
}

function options(id, items) {
  const s = $(id);
  for (const [value, label] of items) { const o = document.createElement('option'); o.value = value; o.textContent = label; s.append(o); }
}

function restoreFromURL() {
  const p = new URLSearchParams(location.search);
  for (const f of FIELDS) if (p.has(f)) { const v = f === 'province' ? provinceCodeFrom(p.get(f)) : p.get(f); if ([...$(f).options].some(o => o.value === v) || f === 'search') $(f).value = v; }
  if (['density', 'mix', 'price'].includes(p.get('view'))) state.view = p.get('view');
  if (p.get('district') && districtById(p.get('district'))) state.selectedDistrict = p.get('district');
  if (p.get('area') && areaById(p.get('area'))) { state.selectedArea = p.get('area'); state.selectedDistrict = ''; }
  const areas = p.get('areas') || '';
  if (areas === 'all') { state.autoFocus = false; state.focusAreaIds = []; }
  else state.focusAreaIds = [...new Set(areas.split(','))].filter(id => areaById(id)).slice(0, 3);
  state.view3d = p.get('view3d') !== '0';
  state.twoPoint = p.get('cam') !== 'model';
  if (state.selectedArea) state.panel = {mode: 'area', id: state.selectedArea};
  else if (state.selectedDistrict) state.panel = {mode: 'district', id: state.selectedDistrict};
  if (p.get('store') && rowById(p.get('store'))) state.panel = {mode: 'store', id: p.get('store')};
  else if (p.get('place') && state.venueById.has(p.get('place'))) state.panel = {mode: 'venue', id: p.get('place')};
}

function wireEvents() {
  let timer;
  for (const f of FIELDS) $(f).addEventListener(f === 'search' ? 'input' : 'change', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.focusAreaIds = [];
      state.history = [];
      if (f === 'province') { state.selectedArea = ''; state.selectedDistrict = ''; }
      state.panel = state.selectedArea ? {mode: 'area', id: state.selectedArea} : state.selectedDistrict ? {mode: 'district', id: state.selectedDistrict} : overviewPanel();
      update({fit: true});
    }, f === 'search' ? 450 : 0);
  });
  $('filters').addEventListener('reset', () => setTimeout(() => resetToOverview(), 0));
  $('panel-view').addEventListener('click', onPanelAction);
  $('filter-chips').addEventListener('click', onPanelAction);
  $('map-aha').addEventListener('click', onPanelAction);
  $('crumbs').addEventListener('click', onPanelAction);

  const tabs = [...document.querySelectorAll('[data-view]')];
  tabs.forEach((b, i) => {
    b.onclick = () => { state.view = b.dataset.view; drawChart(); saveURL(); };
    b.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[j].focus(); tabs[j].click();
    });
  });

  $('fit-map').onclick = () => {
    if (!state.map) return;
    if (state.selectedArea || state.selectedDistrict || state.rows.length) fitMap();
  };
  $('bangkok-map').onclick = () => { if (state.map) applyPreset(state.map, state.view3d ? 'city' : 'plan', {center: BANGKOK.center, zoom: BANGKOK.zoom, animate: animate()}); };
  $('toggle-3d').onclick = toggle3d;
  $('toggle-eye').onclick = toggleTwoPoint;
  $('toggle-neighborhoods').onclick = () => { state.showAreas = !state.showAreas; $('toggle-neighborhoods').setAttribute('aria-pressed', String(state.showAreas)); updateSpatialLayers(); };
  $('mobile-panel').onclick = () => { $('panel').classList.contains('is-open') ? closeMobilePanel() : openMobilePanel(); };
  $('close-mobile-panel').onclick = closeMobilePanel;
  document.querySelector('.skip').onclick = () => { openMobilePanel(); $('dataset-title').focus(); };
  $('toggle-insights').onclick = () => openInsights($('insight-content').hidden);
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncBottomPanel).observe($('insights')); else window.addEventListener('resize', syncBottomPanel);
  $('open-table').onclick = () => { $('results').hidden = false; if (renderTable.stale) renderTable(); closeMobilePanel(); $('toggle-table').focus(); };
  $('toggle-table').onclick = () => { $('results').hidden = true; $('open-table').focus(); };
  $('prev-page').onclick = () => { state.page--; renderTable(); };
  $('next-page').onclick = () => { state.page++; renderTable(); };
  $('theme').onchange = applyTheme;
  const colorMedia = matchMedia('(prefers-color-scheme: dark)');
  const onColorChange = () => { if ($('theme').value === 'auto') applyTheme(); };
  if (colorMedia.addEventListener) colorMedia.addEventListener('change', onColorChange); else colorMedia.addListener(onColorChange);
  matchMedia('(max-width: 760px) and (orientation: portrait)').addEventListener?.('change', () => { if (!mobilePortrait()) $('panel').classList.remove('is-open'); renderPanel(); });
}

async function init() {
  try {
    const resources = ['data/restaurants.json', 'data/areas.geojson', 'data/districts.geojson', 'data/provinces.geojson', 'data/venue-buildings.geojson', 'data/brand-logos.json', 'data/venue-logos.json'];
    const results = await Promise.allSettled(resources.map(r => fetchJSON(r, {timeout: r.includes('restaurants') ? 45000 : 20000})));
    for (const i of [0, 1, 2]) if (results[i].status === 'rejected') throw results[i].reason;
    for (const i of [1, 2]) if (!validFeatureCollection(results[i].value)) { const e = new Error('Invalid boundary FeatureCollection'); e.resource = resources[i]; e.phase = 'data-schema'; throw e; }
    state.areasGeo = results[1].value; state.districtsGeo = results[2].value;
    state.provincesGeo = results[3].status === 'fulfilled' && validFeatureCollection(results[3].value) ? results[3].value : {type: 'FeatureCollection', features: []};
    state.buildingGeo = results[4].status === 'fulfilled' && validFeatureCollection(results[4].value) ? results[4].value : {type: 'FeatureCollection', features: []};
    state.index = buildAreaIndex(state.areasGeo, state.districtsGeo, state.provincesGeo);
    state.data = decodeDataset(results[0].value, state.areasGeo);
    if (state.data.dropped) console.warn('Rows outside the frame set', state.data.dropped);
    state.rowById = new Map(state.data.rows.map(r => [r.id, r]));
    state.venueById = new Map(state.data.venues.map(v => [v.id, v]));
    state.brandById = new Map(state.data.brands.map(b => [b.id, b]));
    state.hosted = hostedVenueIds(state.buildingGeo);
    state.coveredIds = new Set(state.data.rows.map(r => r.area));
    state.coverage = scopedCoverage();
    const brandLogos = configureBrandLogos(results[5].status === 'fulfilled' ? results[5].value : {assets: []});
    if (!brandLogos.complete) console.warn('Brand logo registry', brandLogos);
    const venueLogos = configureVenueLogos(results[6].status === 'fulfilled' ? results[6].value : {assets: []});
    if (!venueLogos.complete) console.warn('Venue logo registry', venueLogos);


    const priceCounts = Object.fromEntries(PRICE_BUCKETS.map(b => [b, 0]));
    for (const r of state.data.rows) priceCounts[r.price]++;
    // Only buckets that hold rows are offered (a bucket with no row would always return an empty map).
    options('price', PRICE_BUCKETS.filter(b => priceCounts[b] > 0).map(b => [b, `${PRICE_LABELS[b]} (${num(priceCounts[b])})`]));
    const groupCounts = new Map();
    for (const r of state.data.rows) groupCounts.set(r.groupId, (groupCounts.get(r.groupId) || 0) + 1);
    options('group', state.data.groups.filter(g => groupCounts.get(g.id)).map(g => [g.id, `${g.th} (${num(groupCounts.get(g.id))})`]));
    const provinceCounts = state.data.meta?.rowsByProvince || {};
    options('province', PROVINCES.map(p => [p.code, provinceCounts[p.code] ? `${p.th} (${num(provinceCounts[p.code])})` : p.th]));
    options('brand', [...state.data.brands].sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name)).map(b => [b.id, `${b.name} (${num(b.rows)})`]));
    $('category-items').innerHTML = state.data.groups.map(g => `<span>${cueMarkup(g.series)}${esc(g.th)}</span>`).join('');

    restoreFromURL();
    $('toggle-3d').setAttribute('aria-pressed', String(state.view3d));
    syncEyeToggle();
    try { $('theme').value = localStorage.getItem('citymeter-restaurants-theme') || 'auto'; } catch {}
    applyTheme();
    wireEvents();
    update();
    if (state.panel.mode !== 'overview') openMobilePanel();
    window.dispatchEvent(new CustomEvent('citymeter:ready'));
    startMap();
  } catch (e) {
    window.dispatchEvent(new CustomEvent('citymeter:load-error', {detail: {message: 'โหลดข้อมูลร้านอาหารไม่สำเร็จ กรุณาลองอีกครั้ง', resource: e.resource, status: e.status, phase: e.phase || 'startup', diagnostic: e.message}}));
    console.error(e);
  }
}

// Developer hook for live tuning in a browser console (not an API; may change without notice).
window.__citymeter = {state, get map() { return state.map; }, update, fitMap, updateSpatialLayers, applyPreset: (name, opts) => state.map && applyPreset(state.map, name, opts), fitPitched: (b, opts) => state.map && fitPitched(state.map, b, opts), cameraPadding, buildMapStyle, productionLink};

init();

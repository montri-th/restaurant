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
 * Buildings (owner decision 2026-10-23): the display points of the scope are joined
 * to the buildings the map draws (focus-tier OSM footprints + official host
 * buildings, js/building-join.js). In the focus, the buildings of the venues named
 * by the focused rows are drawn in the data colour (official host geometry, or the
 * OSM buildings holding their points) and every building is a click target: a
 * venue's building opens the venue, one point opens the store, several open the
 * building panel ("ร้านที่จุดตกในอาคารนี้"). No point → the click falls through.
 *
 * Map clicks, in order: venue solid (x-ray) → host building → focus pin → focus
 * building → province (country zoom) → แขวง/ตำบล (`area-hit`, every zoom): a click
 * on another frame moves there; quiet context dots are never targets. Labels of the
 * frames in view are kept (recomputed on moveend), so the next area is one click away.
 *
 * Camera: 3D by default (camera.js presets city/model/eye) with a 2D plan
 * toggle; the basemap is generated (map-style.js) on OpenFreeMap tiles.
 * Panel modes: overview | district | area | venue | building | store (with a back stack).
 * URL state: filters, district, area, areas, view, store, place, view3d, cam.
 *
 * Two more data sets (release 0.3, owner request 2026-10-28), loaded after the first paint:
 *   chain register (data/chains.json, js/register.js) — the national register of chain outlets. Its unit
 *     (one outlet_id per listed branch) differs from the snapshot's (one overlay observation), so its numbers
 *     are never added to the snapshot's. Both are drawn on one map (owner 2026-10-28: “แสดงร่วมกัน”): every
 *     outlet as a dot from city zoom, the snapshot's frames, labels, dots, massing and buildings in every view;
 *     panel modes chains | chain | company | outlet highlight the register selection on top of that.
 *   Land join (data/land.json + land-buildings.geojson, js/land.js) — registry Land hosts (shopping centres,
 *     hotels, offices) and the restaurant points / register outlets that fall in or touch their building.
 *     Panel mode land opens one host at venue level (its building in the data colour, x-ray, eye camera).
 * URL: chains=1 (+ rq=query), chain, company, outlet, land.
 */
import {PROVINCES, PRICE_BUCKETS, PRICE_LABELS, provinceByCode, provinceCodeFrom, decodeDataset, filterRows, summarize, hasPoint, productionLink} from './model.js';
import {buildAreaIndex, areaWord, districtWord, areaLocator} from './areas.js';
import {summarizeAreaInsight, filterAreaRows, MIN_AREA_ROWS} from './area-insight.js';
import {renderInsightChart} from './charts.js';
import {loadMapLibrary} from './vendors.js';
import {installRestaurantPins, PIN_LAYERS} from './pins.js';
import {installVenueBuildings, hostedVenueIds, HOST_LAYERS, LAND_LAYERS} from './buildings.js';
import {decodeRegister, brandsIn, provincesIn, outletMix, searchRegister} from './register.js';
import {installRegisterLayer, REGISTER_MIN_ZOOM} from './register-layer.js';
import {decodeLand, landOfRow, landOfOutlet, landProfile, hostsOf, aroundGeometry, geometryBounds} from './land.js';
import {renderRegisterSummary, renderRegisterInArea, renderLandHostsIn, renderStoreLand, renderStoreRegister, renderChains, renderChain, renderCompany, renderOutlet, renderLand, setSourceDates} from './register-panel.js';
import {installVenueXray} from './venue-xray.js';
import {configureBrandLogos, brandLogoMarkup} from './brand-logos.js';
import {configureVenueLogos} from './venue-logos.js';
import {installAreaLayers, installAreaLabels, buildAreaModel, featureBounds, FILL_MAX_ZOOM, AREA_MIN_ZOOM} from './map-layers.js';
import {installProvinceLayers, buildProvinceModel, PROVINCE_FILL_MAX_ZOOM, PROVINCE_LABEL_MAX_ZOOM} from './provinces.js';
import {buildOverview, buildAreaProfile, buildDistrictProfile, buildStoreDetail, buildVenueProfile, buildBuildingProfile} from './profile-model.js';
import {renderOverview, renderArea, renderDistrict, renderVenue, renderBuilding, renderStore, renderFilterChips, link, esc, num, dec, dens} from './panel.js';
import {joinRows, venueBuildings, buildingVenues, resolveBuilding, venueNeighbours, venueRegion, containsPoint} from './building-join.js';
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
  scopeKey: '', join: null, buildingSel: null, labelView: new Map(), renderedSig: '', locateArea: null,
  // Chain register (data/chains.json) and the Land join (data/land.json + land-buildings.geojson): loaded after the first
  // paint (or before it when the URL opens one of their views). Separate units: never added to the snapshot's counts.
  register: null, land: null, landGeo: null, extras: null, extrasState: 'idle', registerLayer: null, landBuildings: null, registerQuery: '',
  landByUuid: new Map(), venueLand: new Map(), landVenue: new Map(), nationalOf: new Map(), snapshotOf: new Map(), registerShown: 0,
  showRegister: true, // every register outlet as a dot from city zoom (map chip “ร้านเครือ”; ?rdots=0 hides them)
};
/** Panel modes of the chain register (the snapshot keeps overview/district/area/venue/building/store; land is a snapshot view). */
const REGISTER_MODES = new Set(['chains', 'chain', 'company', 'outlet']);
const registerMode = () => REGISTER_MODES.has(state.panel.mode);
/** Area frames, labels and context dots of the snapshot are shown in every view (the register shares the map). */
const areasShown = () => state.showAreas;

/* ---------- helpers ---------- */
const values = () => Object.fromEntries(FIELDS.map(k => [k, $(k).value]));
const rowById = id => state.rowById.get(id) || null;
const areaById = id => state.index.byId.get(id) || null;
const districtById = id => state.index.districtById.get(id) || null;
// Null-safe: an embedding page or extension may detach the tray while map callbacks are still queued.
const bottomSpace = () => ($('insights')?.getBoundingClientRect().height ?? 0) + 12;
/** Area/province labels also keep clear of the map attribution (its live height is --attrib-height on .map-panel). */
const labelBottomSpace = () => { const panel = document.querySelector('.map-panel'); return bottomSpace() + (panel ? parseFloat(getComputedStyle(panel).getPropertyValue('--attrib-height')) || 0 : 0); };
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
/** The building being looked at (building mode): {key, kind, footprint, rows, height}. */
const currentBuilding = () => (state.panel.mode === 'building' ? state.buildingSel : null);
/** The Land host being looked at (land mode), or null. */
const currentLand = () => (state.panel.mode === 'land' ? state.land?.hostById.get(state.panel.id) || null : null);
/** Venue level (eye camera, x-ray): a venue with a host building in this data set, or a Land host with its building. */
const venueLevel = () => {
  const h = currentLand();
  if (h) return h.fp >= 0 && state.land.buildings.has(h.fp);
  const v = currentVenue(); return Boolean(v && state.hosted.has(v.id));
};
const cameraPreset = () => presetFor({view3d: state.view3d, mode: ['overview', 'district'].includes(state.panel.mode) ? 'overview' : 'detail', twoPoint: state.twoPoint && venueLevel() && !sheetOpen()});

function saveURL() {
  const f = values(), p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  if (state.selectedDistrict) p.set('district', state.selectedDistrict);
  if (state.selectedArea) p.set('area', state.selectedArea);
  if (state.focusAreaIds.length) p.set('areas', state.focusAreaIds.join(','));
  else if (!state.autoFocus) p.set('areas', 'all');
  if (state.view !== 'density') p.set('view', state.view);
  if (!state.showRegister) p.set('rdots', '0');
  if (state.panel.mode === 'store' && state.panel.id) p.set('store', state.panel.id);
  if (state.panel.mode === 'venue' && state.panel.id) p.set('place', state.panel.id);
  if (state.panel.mode === 'chains') { p.set('chains', '1'); if (state.registerQuery.trim()) p.set('rq', state.registerQuery.trim()); }
  if (state.panel.mode === 'chain' && state.panel.id) p.set('chain', state.panel.id);
  if (state.panel.mode === 'company' && state.panel.id) p.set('company', state.panel.id);
  if (state.panel.mode === 'outlet' && state.panel.id) p.set('outlet', state.panel.id);
  if (state.panel.mode === 'land' && state.panel.id) p.set('land', state.panel.id);
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
  for (const k of ['xray', 'registerLayer', 'landBuildings', 'buildings', 'massing', 'pins']) { try { state[k]?.dispose(); } catch (e) { console.warn('dispose', k, e); } state[k] = null; }
  state.areaLayers = null; state.provinceLayers = null;
}

/* ---------- selection ---------- */
function update({fit = false} = {}) {
  const f = values();
  // The scope only changes with the filters: a selection reuses it (and the pins keep their context).
  const scopeKey = JSON.stringify(f);
  if (scopeKey !== state.scopeKey) { state.scopeRows = filterRows(state.data.rows, f); state.scopeKey = scopeKey; }
  const area = state.selectedArea ? areaById(state.selectedArea) : null;
  const district = !area && state.selectedDistrict ? districtById(state.selectedDistrict) : null;
  state.baseRows = area ? state.scopeRows.filter(r => r.area === area.id) : district ? state.scopeRows.filter(r => r.district === district.id) : state.scopeRows;
  state.coverage = scopedCoverage({province: f.province, district: district?.id || ''});
  state.insight = summarizeAreaInsight(district ? state.baseRows : state.scopeRows, state.index, {coverage: state.coverage});
  state.focusIds = state.focusAreaIds.length ? state.focusAreaIds : (state.autoFocus && !area && !district ? state.insight.areaIds : []);
  state.rows = state.focusIds.length ? filterAreaRows(state.baseRows, new Set(state.focusIds)) : state.baseRows;
  state.page = 0;
  if (update.modelScope !== state.scopeRows || update.modelProvince !== f.province) {
    state.areaModel = buildAreaModel(state.scopeRows, state.index, {allAreaIds: state.coveredIds, province: f.province});
    update.modelScope = state.scopeRows; update.modelProvince = f.province;
  }

  // Keep the panel honest: drop a store/venue that left the filtered scope.
  const fallback = () => (area ? {mode: 'area', id: area.id} : district ? {mode: 'district', id: district.id} : overviewPanel());
  if (state.panel.mode === 'store' && !state.scopeRows.some(r => r.id === state.panel.id)) { state.panel = fallback(); state.history = []; }
  if (state.panel.mode === 'venue' && !state.scopeRows.some(r => r.venue?.id === state.panel.id)) { state.panel = fallback(); state.history = []; }
  if (state.panel.mode === 'building') {
    // The building keeps its own footprint: its rows follow the filters; none left → back to the area.
    const b = state.buildingSel;
    const rows = b ? state.scopeRows.filter(r => containsPoint(b.footprint, [r.longitude, r.latitude])) : [];
    if (rows.length) state.buildingSel = {...b, rows};
    else { state.panel = fallback(); state.history = []; state.buildingSel = null; }
  }
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
  // Register views: the register selection is the focus; the snapshot stays on the map as quiet context.
  if (registerMode()) return [];
  if (state.panel.mode === 'land') {
    const key = `${state.panel.id}|${state.scopeKey}`;
    if (detailRows.landKey !== key) { detailRows.landKey = key; detailRows.landRows = landRows(state.panel.id); }
    return detailRows.landRows;
  }
  const b = currentBuilding();
  if (b) return b.rows;
  const v = currentVenue();
  if (v && (state.panel.mode === 'venue' || venueLevel())) {
    if (detailRows.key !== v.id || detailRows.scope !== state.scopeRows) {
      detailRows.key = v.id; detailRows.scope = state.scopeRows; detailRows.rows = state.scopeRows.filter(r => r.venue?.id === v.id);
    }
    return detailRows.rows;
  }
  return state.rows;
}

/** Snapshot rows (in the filtered scope) whose display points fall in or touch a Land host's building. */
function landRows(hostId) {
  const h = state.land?.hostById.get(hostId);
  if (!h || h.fp < 0) return [];
  const keys = new Set(state.land.rowsByBuilding.get(h.fp) || []);
  return state.scopeRows.filter(r => keys.has(r.id));
}

/* ---------- chain register + Land join (loaded after the first paint) ---------- */

/** Fetch and decode both extra data sets once; the snapshot never waits for them (unless the URL opens their views). */
function loadExtras() {
  if (state.extras) return state.extras;
  state.extrasState = 'loading';
  const resources = ['data/chains.json', 'data/land.json', 'data/land-buildings.geojson'];
  state.extras = Promise.allSettled(resources.map(r => fetchJSON(r, {timeout: 60000}))).then(([chains, land, landGeo]) => {
    if (chains.status === 'fulfilled') { try { state.register = decodeRegister(chains.value, state.index); } catch (e) { console.warn('Chain register', e); } }
    else console.warn('Chain register', chains.reason);
    if (land.status === 'fulfilled' && landGeo.status === 'fulfilled' && validFeatureCollection(landGeo.value)) {
      try { state.landGeo = landGeo.value; state.land = decodeLand(land.value, landGeo.value); } catch (e) { state.land = null; console.warn('Land join', e); }
    } else console.warn('Land join', land.reason || landGeo.reason || 'invalid building outlines');
    linkExtras();
    state.extrasState = state.register || state.land ? 'ready' : 'failed';
    setSourceDates({snapshot: state.data.meta?.retrievedOn || state.data.meta?.asOf || '', registerFrom: state.register?.meta.checkedFrom || '', registerTo: state.register?.meta.checkedTo || '', land: state.land?.meta?.checkedOn || ''});
    return true;
  });
  return state.extras;
}

/**
 * Links between the data sets, by id only: a sheet venue ↔ a Land shopping host by the CityMETER venue uuid both
 * record; a snapshot brand candidate → the register brands its sheet row names (01_BRANDS.national_brand_ids).
 */
function linkExtras() {
  state.landByUuid = new Map((state.land?.hosts || []).filter(h => h.uuid).map(h => [h.uuid, h]));
  state.venueLand = new Map(); state.landVenue = new Map();
  for (const v of state.data.venues) {
    const h = v.uuid ? state.landByUuid.get(v.uuid) : null;
    if (h) { state.venueLand.set(v.id, h); if (!state.landVenue.has(h.id)) state.landVenue.set(h.id, v); }
  }
  state.nationalOf = new Map(); state.snapshotOf = new Map();
  const reg = state.register;
  if (reg) for (const b of state.data.brands) {
    const list = (b.national || []).map(id => reg.brandById.get(id)).filter(Boolean);
    if (!list.length) continue;
    state.nationalOf.set(b.id, list);
    for (const x of list) { if (!state.snapshotOf.has(x.id)) state.snapshotOf.set(x.id, []); state.snapshotOf.get(x.id).push(b); }
  }
}

/** Snapshot rows of the filtered scope per Land building (in or at the edge), cached per scope. */
function landScopeCounts() {
  if (!state.land) return new Map();
  if (landScopeCounts.scope === state.scopeRows) return landScopeCounts.value;
  // Every building a point falls in or touches (a point inside nested buildings counts for each of them).
  const scope = scopeKeySet(), m = new Map();
  for (const [b, keys] of state.land.rowsByBuilding) { let n = 0; for (const k of keys) if (scope.has(k)) n++; if (n) m.set(b, n); }
  landScopeCounts.scope = state.scopeRows; landScopeCounts.value = m;
  return m;
}

/** One Land building as a list entry: its main host (or `host`), the other registry names on the same footprint,
 * and the scope rows / register outlets in or at it. Hosts sharing a footprint are one building, never repeated rows. */
function landEntry(building, host = null) {
  const hosts = hostsOf(state.land, building), main = host || hosts[0];
  return {host: main, cohosts: hosts.filter(h => h !== main), building,
    rows: landScopeCounts().get(building) || 0, outlets: (state.land.outletsByBuilding.get(building) || []).length};
}

/** Land buildings with a host whose source point lies in the given subdistricts, one entry per building. Nested or
 * touching outlines (a complex around a mall) can hold the same points: a later entry names the listed building it
 * repeats, so nobody adds the two rows. Ties list the registry's reviewed geometry and shopping hosts first. */
function landHostsIn(areaIds, {limit = 12} = {}) {
  if (!state.land) return [];
  const ids = areaIds instanceof Set ? areaIds : new Set(areaIds);
  const buildings = new Set(state.land.hosts.filter(h => h.fp >= 0 && (!ids.size || ids.has(h.area))).map(h => h.fp));
  const rank = h => (String(h.fpBy || '').startsWith('registry') ? 0 : 10) + ({shopping: 0, office: 1, hotel: 2}[h.ds] ?? 3);
  const all = [...buildings].map(b => landEntry(b))
    .filter(x => x.rows > 0 || x.outlets > 0)
    .sort((a, b) => b.rows - a.rows || rank(a.host) - rank(b.host) || b.outlets - a.outlets || a.host.name.localeCompare(b.host.name, 'th'));
  // The header counts every building; the list shows the first `limit` (a list length is never shown as a total).
  const list = all.slice(0, limit);
  list.total = all.length;
  const scope = scopeKeySet();
  const keys = list.map(x => new Set([...(state.land.rowsByBuilding.get(x.building) || [])].filter(k => scope.has(k))));
  list.forEach((x, i) => {
    for (let j = 0; j < i && !x.repeats; j++) {
      let n = 0;
      for (const k of keys[i]) if (keys[j].has(k)) n++;
      if (n) x.repeats = {host: list[j].host, rows: n};
    }
  });
  return list;
}

/** The main Land host of a building (shopping, then office, then hotel). */
const mainLandHost = building => hostsOf(state.land, building)[0] || null;

/** Register outlets of the selected area / district (polygon test on the outlet point, covered provinces only). */
function registerPlace() {
  const reg = state.register;
  if (!reg) return null;
  const area = state.selectedArea ? areaById(state.selectedArea) : null;
  const district = !area && state.selectedDistrict ? districtById(state.selectedDistrict) : null;
  if (area) return {label: `${areaWord(area.province)}${area.name}`, outlets: reg.byArea.get(area.id) || []};
  if (district) return {label: `${districtWord(district.province)}${district.name}`, outlets: reg.byDistrict.get(district.id) || []};
  const code = $('province').value, p = code ? provinceByCode(code) : null;
  return p ? {label: p.th, outlets: reg.byProvince.get(p.code) || []} : null;
}

/** The table and its counter: the snapshot rows that carry detail (register views keep the filtered rows). */
const tableRows = () => (registerMode() ? state.rows : detailRows());
function syncList() {
  const rows = tableRows(), b = currentBuilding(), v = rows === state.rows || b ? null : currentVenue();
  $('result-count').textContent = num(rows.length);
  const land = state.panel.mode === 'land' ? state.land?.hostById.get(state.panel.id) : null;
  $('results-title').textContent = land ? `ร้านที่จุดตกในอาคารของ ${land.name}` : registerMode() ? 'ร้านตามตัวกรอง' : b ? 'ร้านที่จุดตกในอาคารนี้' : v ? `ร้านที่ชื่ออ้างถึง ${v.name}` : 'ร้านตามตัวกรอง';
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
  // Context = the whole scope (same array while the filters are unchanged → not re-sent); focus symbols cover their own dot.
  state.pins.update(list, {context: state.scopeRows});
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
  } else if (mode === 'store' || mode === 'building') {
    const r = mode === 'store' ? rowById(id) : currentBuilding()?.rows[0];
    crumbs = buildBreadcrumb({area: r ? areaById(r.area) : null, province: r?.province || ''});
  } else if (mode === 'land') {
    // A Land host is like a store: the panel heading, never a crumb — its crumbs are its source point's แขวง/ตำบล.
    const a = currentLand() ? areaById(currentLand().area) : null;
    crumbs = buildBreadcrumb({area: a, province: a?.province || ''});
  } else if (mode === 'outlet') {
    const o = state.register?.byId.get(id), a = o?.area ? areaById(o.area) : null;
    crumbs = buildBreadcrumb({area: a, province: a?.province || ''});
  } else if (registerMode()) {
    crumbs = buildBreadcrumb({});
  } else {
    crumbs = buildBreadcrumb({province: $('province').value, area: state.selectedArea ? areaById(state.selectedArea) : null, district: state.selectedDistrict ? districtById(state.selectedDistrict) : null});
  }
  $('crumbs').innerHTML = renderBreadcrumb(crumbs);
  const reg = state.register;
  const title = mode === 'store' ? `${rowById(id)?.name || ''} · ` : mode === 'building' ? 'อาคาร · ' : mode === 'land' ? `${currentLand()?.name || ''} · ` : '';
  const regTitle = mode === 'chain' ? reg?.brandById.get(id)?.name : mode === 'company' ? reg?.companyById.get(id)?.name : mode === 'outlet' ? (reg?.byId.get(id)?.name || reg?.byId.get(id)?.brand.name) : '';
  document.title = registerMode() ? `${regTitle ? `${regTitle} · ` : ''}ทะเบียนร้านเครือ · Restaurants · CityMETER` : `${title}${breadcrumbText(crumbs)} · Restaurants · CityMETER`;
  return crumbs;
}

/* ---------- panel ---------- */
const densityClassOf = a => {
  const m = state.areaModel;
  const x = m?.areas.find(y => y.id === a.id);
  return x?.fill || classify(a.density, m?.classes || {classes: [], zero: {}}).fill || 'var(--scale-count-3)';
};

const extrasPending = () => state.extrasState === 'idle' || state.extrasState === 'loading';

const extrasNote = () => `<section class="panel-section"><p class="hint">${extrasPending() ? 'กำลังโหลดทะเบียนร้านเครือและข้อมูลอาคาร…' : 'โหลดทะเบียนร้านเครือหรือข้อมูลอาคารไม่สำเร็จ ข้อมูลร้านอาหารยังใช้งานได้'}</p></section>`;

/** Overview: the register at a glance and the Land hosts holding the most restaurant points (scope = filters). */
function overviewExtras() {
  if (extrasPending()) return renderRegisterSummary({loading: true});
  const reg = state.register;
  if (reg && !overviewExtras.top) overviewExtras.top = reg.brands.filter(b => !b.registry).sort((a, b) => b.outlets - a.outlets || a.name.localeCompare(b.name)).slice(0, 10);
  const province = $('province').value;
  const areaIds = province ? new Set([...state.coveredIds].filter(a => areaById(a)?.province === province)) : new Set();
  const p = province ? provinceByCode(province) : null;
  return (reg ? renderRegisterSummary({meta: reg.meta, brands: overviewExtras.top, chainCount: reg.chainCount, registries: reg.registries}) : '') +
    renderLandHostsIn(landHostsIn(areaIds, {limit: 8}), {boundary: p ? `host ใน${p.th}` : 'host ใน 7 จังหวัดที่ข้อมูลร้านครอบคลุม'});
}

/** Area / district: register outlets whose points lie in the frame, and the Land hosts there. */
function placeExtras(outlets, place, areaIds) {
  if (extrasPending()) return renderRegisterInArea({loading: true});
  return (state.register ? renderRegisterInArea({outlets, brands: brandsIn(outlets, Infinity), place, meta: state.register.meta}) : '') +
    renderLandHostsIn(landHostsIn(areaIds, {limit: 10}), {boundary: `host ใน${place}`});
}

/** Venue: the Land host recording the same CityMETER venue uuid. */
function venueExtras(id) {
  const h = state.venueLand.get(id);
  return h ? renderLandHostsIn([landEntry(h.fp, h)], {title: 'สถานที่นี้ในทะเบียน Land', boundary: `อาคารของ ${h.name}`}) : '';
}

/** Building (display-time join): the Land building most of its rows' points fall in, by the build-time join. */
function buildingExtras() {
  const b = currentBuilding();
  if (!b || !state.land) return '';
  const tally = new Map();
  for (const r of b.rows) for (const rel of state.land.rowLinks.get(r.id) || []) if (rel.rel === 'in') tally.set(rel.building, (tally.get(rel.building) || 0) + 1);
  const best = [...tally].sort((x, y) => y[1] - x[1])[0];
  return best ? renderLandHostsIn([landEntry(best[0])], {title: 'อาคารในทะเบียน Land ที่จุดของร้านเหล่านี้ตก', boundary: 'อาคารที่จุดของร้านในแผงนี้ตกมากที่สุด'}) : '';
}

/** Store: the Land building its point falls in / touches, and its links to the chain register. */
function storeExtras(id) {
  const r = rowById(id);
  if (!r) return {};
  const reg = state.register;
  const land = state.land ? renderStoreLand(landOfRow(state.land, id)) : '';
  const register = renderStoreRegister({row: r, national: (r.brand && state.nationalOf.get(r.brand.id)) || [], register: r.register,
    targets: reg ? r.registerTargets.map(t => reg.byId.get(t)).filter(Boolean) : []});
  return {extraFacts: land + register};
}

/** Snapshot row ids of the filtered scope (cached per scope). */
function scopeKeySet() {
  if (scopeKeySet.scope !== state.scopeRows) { scopeKeySet.scope = state.scopeRows; scopeKeySet.value = new Set(state.scopeRows.map(r => r.id)); }
  return scopeKeySet.value;
}

/** Other outlets of the same brand in the same province, nearest first when the outlet has a point. */
function sameBrandNear(o, limit = 8) {
  const list = (state.register.byBrand.get(o.brand.id) || []).filter(x => x !== o && x.province && x.province === o.province);
  const total = list.length;
  if (o.hasPoint) {
    const kx = Math.cos((o.latitude * Math.PI) / 180);
    const d = x => (x.hasPoint ? ((x.longitude - o.longitude) * kx) ** 2 + (x.latitude - o.latitude) ** 2 : Infinity);
    list.sort((a, b) => d(a) - d(b));
  }
  return {list: list.slice(0, limit), total, nearest: o.hasPoint};
}

/** Register views and the Land host view. */
function renderExtraView(mode, id) {
  const reg = state.register;
  if (mode === 'land') {
    const h = currentLand();
    if (!h) return extrasNote();
    const profile = landProfile(state.land, h, {rowsByKey: state.rowById, outletsById: reg?.byId, scopeKeys: scopeKeySet()});
    const inside = new Set([...profile.rows.in, ...profile.rows.edge].map(r => r.id));
    const around = profile.feature ? aroundGeometry(profile.feature.geometry, state.scopeRows, 100, inside) : [];
    return renderLand({land: state.land, profile, around, groups: state.data.groups, venue: state.landVenue.get(h.id) || null, index: state.index});
  }
  if (!reg) return extrasNote();
  const place = registerPlace();
  if (mode === 'chains') {
    if (!renderExtraView.mix) renderExtraView.mix = outletMix(reg.outlets);
    return renderChains({reg, query: state.registerQuery, results: searchRegister(reg, state.registerQuery), mix: renderExtraView.mix,
      area: place, areaOutlets: place?.outlets || null, areaBrands: place ? brandsIn(place.outlets, Infinity) : []});
  }
  if (mode === 'chain') {
    const brand = reg.brandById.get(id);
    if (!brand) return extrasNote();
    const outlets = reg.byBrand.get(id) || [];
    const snap = (state.snapshotOf.get(id) || []).slice().sort((a, b) => b.rows - a.rows)[0];
    return renderChain({reg, brand, outlets, provinces: provincesIn(outlets, reg.provinces), mix: outletMix(outlets),
      area: place, inArea: place ? place.outlets.filter(o => o.brand.id === id) : [], snapshot: snap ? {brand: snap, count: snap.rows} : null,
      operators: brand.family ? reg.brands.filter(b => b.family === brand.family) : []});
  }
  if (mode === 'company') {
    const company = reg.companyById.get(id);
    if (!company) return extrasNote();
    const outlets = reg.byCompany.get(id) || [];
    return renderCompany({reg, company, brands: brandsIn(outlets, 200), outlets, mix: outletMix(outlets)});
  }
  if (mode === 'outlet') {
    const o = reg.byId.get(id);
    if (!o) return extrasNote();
    return renderOutlet({reg, outlet: o, area: o.area ? areaById(o.area) : null, land: state.land ? landOfOutlet(state.land, o.id) : null, sameBrand: sameBrandNear(o)});
  }
  return extrasNote();
}

function renderPanel(summary = summarize(state.rows)) {
  const view = $('panel-view');
  const {mode, id} = state.panel;
  renderCrumbs();
  syncEyeToggle();
  let html = '';
  const groups = state.data.groups;
  const meta = state.data.meta || {};
  if (registerMode() || mode === 'land') html = renderExtraView(mode, id);
  else if (mode === 'area') {
    const a = areaById(id);
    html = renderArea(buildAreaProfile(state.scopeRows, id, state.index, groups, {covered: state.coveredIds}), meta,
      a ? placeExtras(state.register?.byArea.get(id) || [], `${areaWord(a.province)}${a.name}`, [id]) : '');
  } else if (mode === 'district') {
    const d = districtById(id);
    html = renderDistrict(buildDistrictProfile(state.scopeRows, id, state.index, groups, {covered: state.coveredIds}), densityClassOf, meta,
      d ? placeExtras(state.register?.byDistrict.get(id) || [], `${districtWord(d.province)}${d.name}`, (d.areas || []).map(a => a.id)) : '');
  }
  else if (mode === 'venue') html = renderVenue(buildVenueProfile(state.scopeRows, state.venueById.get(id), state.index, groups, {hosted: state.hosted.has(id), spatial: venueSpatial(id)}), state.index, meta, venueExtras(id));
  else if (mode === 'building') html = renderBuilding(buildBuildingProfile(currentBuilding(), state.index, groups), {...meta, index: state.index}, buildingExtras());
  else if (mode === 'store') html = renderStore(buildStoreDetail(rowById(id), {scopeRows: state.scopeRows, index: state.index, groups, building: storeBuilding(id)}), {...meta, index: state.index}, storeExtras(id));
  state.renderedSig = panelSpatialSig();
  if (!html) {
    const province = $('province').value;
    const overview = buildOverview(state.scopeRows, state.index, {province});
    const provinces = province ? [] : (state.provinceModel?.provinces || buildProvinceModelSafe()).filter(p => p.count > 0).sort((a, b) => b.count - a.count);
    const insight = focusMode() === 'explicit' ? summarizeAreaInsight(state.rows, state.index, {coverage: state.coverage, minRows: 1}) : state.insight;
    html = renderOverview({insight, summary, overview, focusMode: focusMode(), classOf: densityClassOf, provinces, meta, coverage: state.coverage, province, extra: overviewExtras()});
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
    : `<div>${crumb}<h2>${insight.mode === 'density' ? `${dens(insight.density)} ร้าน/ตร.กม. ใน ${num(insight.areas.length)} พื้นที่ที่แน่นที่สุด` : `${num(Math.round(insight.share))}% ของร้านอยู่ใน ${num(insight.areas.length)} พื้นที่`}</h2><p>${names}</p></div>${mode === 'auto'
      ? '<button type="button" class="btn" data-action="clear-focus">ดูทุกพื้นที่</button>'
      : '<button type="button" class="btn primary" data-action="explore-top">โฟกัส</button>'}`;
}

function pushHistory() { state.history.push({...state.panel, area: state.selectedArea, district: state.selectedDistrict, building: state.buildingSel}); if (state.history.length > 20) state.history.shift(); }

function goBack() {
  const previous = state.history.pop();
  if (!previous) { state.selectedArea = ''; state.selectedDistrict = ''; state.panel = overviewPanel(); update({fit: true}); return; }
  const fit = previous.area !== state.selectedArea || previous.district !== state.selectedDistrict;
  const wasExtra = registerMode() || state.panel.mode === 'land';
  state.selectedArea = previous.area || ''; state.selectedDistrict = previous.district || '';
  if (previous.mode === 'building') state.buildingSel = previous.building || null;
  state.panel = {mode: previous.mode, id: previous.id};
  // Register and Land views frame their own selection; leaving one re-frames the snapshot view it returns to.
  if (registerMode() || state.panel.mode === 'land') { update(); frameExtras(); state.lastPreset = cameraPreset(); return; }
  if (wasExtra && state.loaded && (state.panel.mode === 'venue' || state.panel.mode === 'store')) {
    update();
    const r = state.panel.mode === 'store' ? rowById(state.panel.id) : null;
    if (state.panel.mode === 'venue' || venueLevel()) frameVenue();
    else if (r && hasPoint(r)) framePoint(state.map, [r.longitude, r.latitude], {preset: cameraPreset(), zoom: 16.5, offset: sheetOffset(), animate: animate()});
    state.lastPreset = cameraPreset();
    return;
  }
  update({fit: fit || wasExtra});
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
 * A building the map draws, opened from a click (or the store panel): the rows whose display
 * points fall inside it. The camera stays (the building is where the user is looking).
 */
function selectBuilding(key) {
  const b = state.join?.buildings.get(key);
  const rows = state.join?.byBuilding.get(key) || [];
  if (!b || !rows.length) return;
  if (state.panel.mode !== 'building' || state.panel.id !== key) pushHistory();
  state.buildingSel = {key, kind: b.kind, footprint: b, rows, height: b.height};
  state.panel = {mode: 'building', id: key};
  state.selectedId = '';
  state.pins?.select('');
  state.popup?.remove(); state.popup = null;
  renderPanel();
  syncList();
  saveURL();
  if (state.loaded) { updatePins(); updateSpatialLayers(); }
  openMobilePanel();
  announce(`อาคารที่จุดของร้านตก ${num(rows.length)} ร้าน`);
}

/* ---------- chain register and Land host selection ---------- */

/** Open a register / Land view: the panel, the list, the URL, then the map (and the camera when asked). */
function openExtra(panel, {frame = true, fromMap = false, text = ''} = {}) {
  if (state.panel.mode !== panel.mode || state.panel.id !== panel.id) pushHistory();
  state.panel = panel;
  state.selectedId = '';
  state.pins?.select('');
  state.popup?.remove(); state.popup = null;
  renderPanel();
  syncList();
  saveURL();
  if (state.loaded) {
    updatePins(); updateSpatialLayers();
    if (frame) frameExtras();
    state.lastPreset = cameraPreset();
  }
  if (!fromMap || mobilePortrait()) openMobilePanel();
  if (text) announce(text);
}

function openChains() {
  if (!state.register) return;
  openExtra({mode: 'chains', id: ''}, {text: `ทะเบียนร้านเครือ ${num(state.register.meta.outlets)} สาขา`});
}
function selectChain(id) {
  const b = state.register?.brandById.get(id);
  if (b) openExtra({mode: 'chain', id}, {text: `${b.name} ${num(b.outlets)} สาขาในทะเบียน`});
}
function selectCompany(id) {
  const c = state.register?.companyById.get(id);
  if (c) openExtra({mode: 'company', id}, {text: c.name});
}
function selectOutlet(id, {fromMap = false} = {}) {
  const o = state.register?.byId.get(id);
  if (o) openExtra({mode: 'outlet', id}, {fromMap, text: `เลือก ${o.name || o.brand.name}`});
}
function selectLand(id, {fromMap = false} = {}) {
  const h = state.land?.hostById.get(id);
  if (h) openExtra({mode: 'land', id}, {fromMap, text: `${h.name} · ${num(landRows(id).length)} ร้านจุดตกในหรือติดขอบอาคาร`});
}

/** Points of the register selection on the map (outlets with a selected coordinate). */
function registerSelection() {
  const reg = state.register, {mode, id} = state.panel;
  if (!reg) return {show: false};
  if (mode === 'chains') return {show: true, selection: {}, count: reg.meta.stats?.withPoint ?? reg.outlets.filter(o => o.hasPoint).length};
  if (mode === 'chain') { const b = reg.brandById.get(id); return b ? {show: true, selection: {brand: b.index}, count: (reg.byBrand.get(id) || []).filter(o => o.hasPoint).length} : {show: false}; }
  if (mode === 'company') { const c = reg.companyById.get(id); return c ? {show: true, selection: {company: c.index}, count: (reg.byCompany.get(id) || []).filter(o => o.hasPoint).length} : {show: false}; }
  if (mode === 'outlet') { const o = reg.byId.get(id); return o ? {show: true, selection: {brand: o.brand.index}, selectedIndex: o.hasPoint ? o.index : null, count: (reg.byBrand.get(o.brand.id) || []).filter(x => x.hasPoint).length} : {show: false}; }
  if (mode === 'land') {
    const h = currentLand();
    const ids = h && h.fp >= 0 ? (state.land.outletsByBuilding.get(h.fp) || []).map(k => reg.byId.get(k)).filter(o => o?.hasPoint).map(o => o.index) : [];
    return {show: ids.length > 0, selection: {ids}, count: ids.length};
  }
  return {show: false};
}

/** The Land host whose building an open outlet's point falls in or touches (drawn in the data colour), or null. */
function outletLand() {
  if (state.panel.mode !== 'outlet' || !state.land) return null;
  const rel = landOfOutlet(state.land, state.panel.id);
  return rel && (rel.rel === 'in' || rel.rel === 'edge') ? rel.hosts[0] || null : null;
}

/** Massing focus around an open outlet: its Land building, else a 250 m box around the point. */
function outletRegion(landFeatures = []) {
  if (state.panel.mode !== 'outlet') return null;
  if (outletLand() && landFeatures.length) return landRegionFor(landFeatures);
  const o = state.register?.byId.get(state.panel.id);
  return o?.hasPoint ? venueRegion([[o.longitude, o.latitude]], {bufferM: 250}) : null;
}

/** Register directory / brand / company views: when zoomed in, the แขวง/ตำบล under the map centre carries the
 * full massing, so the buildings around the outlets read like the snapshot's own focus. */
const REGISTER_FOCUS_ZOOM = 13.5;
function registerFocusKey() {
  const map = state.map;
  if (!map || !state.index || !registerMode() || state.panel.mode === 'outlet' || map.getZoom() < REGISTER_FOCUS_ZOOM) return '';
  state.locateArea ||= areaLocator(state.index);
  return state.locateArea(map.getCenter().toArray()) || '';
}
function registerFocusFeatures() {
  const id = registerFocusKey();
  state.registerFocus = id;
  const a = id ? areaById(id) : null;
  return a?.feature ? [a.feature] : [];
}

/** Register dots are on screen: a selection (every zoom), or every outlet from city zoom. */
const registerDotsShown = () => Boolean(state.registerLayer) && (registerSelection().show || (state.showRegister && (state.map?.getZoom?.() ?? 0) >= REGISTER_MIN_ZOOM));

/** Camera for register / Land views: the outlet, the brand's or company's outlets, the whole register, or the host building. */
function frameExtras({instant = false} = {}) {
  if (!state.loaded) return;
  const map = state.map, {mode, id} = state.panel, reg = state.register;
  const anim = animate() && !instant;
  if (mode === 'land') { frameVenue({instant}); return; }
  if (!reg) return;
  if (mode === 'outlet') {
    const o = reg.byId.get(id);
    if (o?.hasPoint) framePoint(map, [o.longitude, o.latitude], {preset: state.view3d && !sheetOpen() ? 'model' : 'plan', zoom: 16.2, offset: sheetOffset(), animate: anim});
    return;
  }
  const outlets = mode === 'chain' ? reg.byBrand.get(id) || [] : mode === 'company' ? reg.byCompany.get(id) || [] : registerPlace()?.outlets.length ? registerPlace().outlets : reg.outlets;
  const pts = outlets.filter(o => o.hasPoint);
  if (!pts.length) return;
  let w = 180, e = -180, s = 90, n = -90;
  for (const o of pts) { if (o.longitude < w) w = o.longitude; if (o.longitude > e) e = o.longitude; if (o.latitude < s) s = o.latitude; if (o.latitude > n) n = o.latitude; }
  const b = new maplibregl.LngLatBounds([w, s], [e, n]);
  const wide = n - s > 0.3 || e - w > 0.3;
  fitPitched(map, b, {preset: wide || !state.view3d || sheetOpen() ? 'plan' : 'model', padding: cameraPadding(), maxZoom: 15.5, minZoom: 4.5, animate: anim});
}

/* ---------- spatial join (display points × drawn buildings) ---------- */

const hostVenueIds = f => { const v = f.properties?.venue_ids; if (Array.isArray(v)) return v; try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const polygonsOf = f => (f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : []);

/**
 * Join the scope's display points to the buildings on the map (focus-tier OSM footprints and the
 * official host buildings drawn now). Recomputed only when either side changes.
 */
function refreshJoin() {
  if (!state.loaded) return false;
  const osm = state.massing?.buildings() || [];
  // LOD2 parts sit inside their footprint: the join counts the footprint once (a mall with 7 parts is 1 building).
  const hosts = (state.buildings?.displayedFeatures() || []).filter(f => f.properties?.geometry_role !== 'host_building_part_not_shop_unit');
  const key = `${state.massing?.version ?? 0}|${hosts.map(f => f.id ?? f.properties?.host_id).join(',')}|${state.scopeKey}`;
  if (key === refreshJoin.key && state.join) return false;
  refreshJoin.key = key;
  const footprints = [
    ...osm.map(b => ({key: `osm:${b.id}`, kind: 'osm', ref: b.id, outer: b.outer, holes: b.holes, bbox: b.bbox, height: b.height, osmId: b.osmId})),
    ...hosts.flatMap(f => polygonsOf(f).map((poly, j) => ({key: `host:${f.id ?? f.properties?.host_id}:${j}`, kind: 'host', outer: poly[0], holes: poly.slice(1),
      venueIds: hostVenueIds(f), height: Number(f.properties?.display_height_m) || null}))),
  ];
  let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
  for (const b of footprints) for (const [x, y] of b.outer) { if (x < w) w = x; if (x > e) e = x; if (y < so) so = y; if (y > n) n = y; }
  const rows = footprints.length ? state.scopeRows.filter(r => r.longitude >= w && r.longitude <= e && r.latitude >= so && r.latitude <= n) : [];
  const join = joinRows(footprints, rows);
  const venueKeys = venueBuildings(join, {hosted: state.hosted});
  state.join = {...join, venueKeys, keyVenues: buildingVenues(venueKeys)};
  return true;
}

/** Venue panel: the venue's buildings on screen and the other rows whose points fall there. */
function venueSpatial(id) {
  if (!state.join || !id) return null;
  const sp = venueNeighbours(id, state.join, state.join.venueKeys);
  return sp.buildings ? sp : null;
}

/** Store panel: the drawn building its display point falls in (and how many other rows share it). */
function storeBuilding(id) {
  const key = state.join?.byRow.get(id);
  if (!key) return null;
  return {key, others: Math.max(0, (state.join.byBuilding.get(key) || []).length - 1)};
}

/** What the open panel shows from the join — re-render only when this changes. */
function panelSpatialSig() {
  const {mode, id} = state.panel;
  if (mode === 'venue') { const sp = venueSpatial(id); return sp ? `${sp.buildings}|${sp.own}|${sp.others.map(r => r.id).join(',')}` : ''; }
  if (mode === 'store') { const b = storeBuilding(id); return b ? `${b.key}|${b.others}` : ''; }
  return '';
}

/** OSM buildings drawn in the data colour: the building / venue being looked at, else the venues of the focused rows. */
function highlightIds() {
  const j = state.join;
  if (!j) return [];
  const refs = keys => keys.map(k => j.buildings.get(k)).filter(b => b?.kind === 'osm').map(b => b.ref);
  // A Land host or a register view draws its own data: no OSM venue building in the data colour beside it.
  if (currentLand() || registerMode()) return [];
  const b = currentBuilding();
  if (b) return b.kind === 'osm' ? [b.footprint.ref] : [];
  const v = currentVenue();
  if (state.panel.mode === 'venue' || (state.panel.mode === 'store' && v)) return v && !state.hosted.has(v.id) ? refs(j.venueKeys.get(v.id) || []) : [];
  const venues = new Set(detailRows().map(r => r.venue?.id).filter(id => id && !state.hosted.has(id)));
  return refs([...venues].flatMap(id => j.venueKeys.get(id) || []));
}

function applyJoin() {
  refreshJoin();
  const n = state.massing?.setHighlight(highlightIds()) || 0;
  // The legend's "อาคารของสถานที่" entry shows whenever a building is drawn in the data colour.
  state.blueBuildings = n > 0 || (state.buildings?.displayedFeatures() || []).length > 0 || (state.landBuildings?.displayedFeatures() || []).length > 0;
  document.querySelector('.map-panel')?.classList.toggle('has-venue-building', state.blueBuildings);
  const label = $('legend-building-label');
  if (label) label.textContent = currentLand() || outletLand() ? 'อาคารในทะเบียน Land' : currentBuilding() ? 'อาคารที่เปิดอยู่' : 'อาคารของสถานที่';
  if (['venue', 'store'].includes(state.panel.mode) && panelSpatialSig() !== state.renderedSig) renderPanel();
}

/** Massing focus region of a venue: its rows' cluster (+ official host rings) with a buffer. */
function venueRegionFor(v, hostFeatures) {
  if (venueRegionFor.key === `${v.id}|${state.scopeKey}|${hostFeatures.length}`) return venueRegionFor.value;
  const points = state.scopeRows.filter(r => r.venue?.id === v.id && hasPoint(r)).map(r => [r.longitude, r.latitude]);
  for (const f of hostFeatures) for (const ring of outerRings(f)) points.push(...ring);
  venueRegionFor.key = `${v.id}|${state.scopeKey}|${hostFeatures.length}`;
  venueRegionFor.value = venueRegion(points);
  return venueRegionFor.value;
}

/**
 * Frame the venue: its host building(s) when the data set has them (footprint and
 * roof vertices inside the padded viewport); otherwise the bounds of the rows that
 * name it (a name-based list can span far apart — the frame says so by its size).
 */
function frameVenue({instant = false} = {}) {
  const map = state.map, preset = cameraPreset(), v = currentVenue(), h = currentLand();
  if (!v && !h) return;
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
  if (h) {
    // Plan / phone: the Land building's outline (or its source point when the building is not drawn).
    const f = state.land.buildings.get(h.fp);
    if (!f) { framePoint(map, [h.lon, h.lat], {preset, zoom: 17, offset: sheetOffset(), animate: animate() && !instant}); return; }
    const [w, s, e, n] = geometryBounds(f.geometry);
    fitPitched(map, new maplibregl.LngLatBounds([w, s], [e, n]), {preset: sheetOpen() || mobilePortrait() ? 'plan' : preset, padding: cameraPadding(), maxZoom: 17.5, minZoom: 14, animate: animate() && !instant});
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
    case 'select-building': selectBuilding(id); break;
    case 'select-province': selectProvince(id); break;
    case 'open-chains': openChains(); break;
    case 'select-chain': selectChain(id); break;
    case 'select-company': selectCompany(id); break;
    case 'select-outlet': selectOutlet(id); break;
    case 'select-land': selectLand(id); break;
    case 'filter-brand': filterBrand(value); break;
    case 'back': goBack(); break;
    case 'explore-top': exploreTop(); break;
    case 'clear-focus': clearFocus(); break;
    // An empty selection under the filters: keep the filters, leave the area/district, fit to where they match.
    case 'leave-area': resetToOverview(); announce('แสดงทุกพื้นที่ตามตัวกรอง'); break;
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
  const panelEl = document.querySelector('.map-panel');
  // Register dots share the map: their key shows whenever they are drawn (a selection, or every outlet from city zoom).
  panelEl.classList.toggle('has-register-dots', registerDotsShown());
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
  document.querySelector('.map-panel').classList.toggle('has-venue-building', Boolean(state.blueBuildings));
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
  const tray = $('insights');
  if (!tray) return;
  document.documentElement.style.setProperty('--bottom-panel-height', `${tray.getBoundingClientRect().height}px`);
  state.pins?.layout();
  state.labels?.layout();
}

/* ---------- table ---------- */
const tableOrder = (a, b) => (b.reviews ?? -1) - (a.reviews ?? -1) || a.name.localeCompare(b.name, 'th') || a.id.localeCompare(b.id);
function renderTable() {
  if ($('results').hidden && renderTable.done) { renderTable.stale = true; return; }
  renderTable.done = true; renderTable.stale = false;
  const pageSize = 25, start = state.page * pageSize;
  const list = tableRows();
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
  // Eligible areas (≥ MIN_AREA_ROWS rows) first, so a tiny area's high density on a handful of rows never
  // outranks the Aha on the map; then by density.
  const eligible = a => (a.count >= MIN_AREA_ROWS ? 1 : 0);
  const byRank = (a, b) => eligible(b) - eligible(a) || (b.density ?? 0) - (a.density ?? 0);
  // Navigating (an area, venue, building or store is open): the frames on screen keep their label first,
  // so the neighbouring แขวง/ตำบล is one click away (refreshed on moveend).
  const navigating = Boolean(state.selectedArea) || ['venue', 'building', 'store'].includes(state.panel.mode);
  const near = navigating ? pool.filter(a => !focus.has(a.id) && state.labelView.has(a.id)).sort(byRank).slice(0, mobilePortrait() ? 4 : 16) : [];
  const nearIds = new Set(near.map(a => a.id));
  const others = pool.filter(a => !focus.has(a.id) && !nearIds.has(a.id)).sort(byRank);
  const quietLimit = district ? 40 : focus.size ? (mobilePortrait() ? 0 : 12) : (mobilePortrait() ? 10 : 30);
  const ordered = [...pool.filter(a => focus.has(a.id)), ...near, ...others.slice(0, quietLimit)];
  return ordered.map(a => ({id: a.id, name: a.name, value: dens(a.density || 0), state: a.state, quiet: focus.size > 0 && !focus.has(a.id) && !district,
    selected: a.id === state.selectedArea, center: navigating && state.labelView.has(a.id) ? state.labelView.get(a.id) : a.label, swatch: a.fill || '',
    title: `${areaWord(a.province)}${a.name} · ${dens(a.density || 0)} ร้าน/ตร.กม. · ${num(a.count)} ร้าน`}));
}

/**
 * Frames on screen and a visible anchor for each (after every camera move): its own label point when that
 * is on screen, else the grid point over the free part of the map that lies in the frame and is nearest its
 * label point. A neighbour whose centre is off screen still gets a label where it is visible.
 */
function refreshLabelView() {
  const map = state.map, m = state.areaModel;
  if (!map || !m || !state.index) return;
  state.locateArea ||= areaLocator(state.index);
  const el = map.getContainer(), w = el.clientWidth, h = el.clientHeight;
  const top = 56, bottom = Math.min(h * 0.45, labelBottomSpace() + 8), left = 16, right = w - 16;
  const free = q => q.x >= left && q.x <= right && q.y >= top && q.y <= h - bottom;
  const best = new Map();
  for (const a of m.areas) if (a.count && Array.isArray(a.label) && free(map.project(a.label))) best.set(a.id, {center: a.label, d: 0});
  const cols = 9, rows = 6;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const sx = left + ((i + 0.5) / cols) * (right - left), sy = top + ((j + 0.5) / rows) * (h - bottom - top);
    const ll = map.unproject([sx, sy]).toArray();
    const id = state.locateArea(ll);
    const a = id && best.get(id)?.d !== 0 ? areaById(id) : null;
    if (!a) continue;
    const lp = Array.isArray(a.label) ? map.project(a.label) : {x: sx, y: sy};
    const d = Math.hypot(lp.x - sx, lp.y - sy);
    if (!best.has(id) || d < best.get(id).d) best.set(id, {center: ll, d});
  }
  const key = [...best].map(([id, b]) => `${id}:${b.center.map(v => v.toFixed(5)).join(',')}`).sort().join('|');
  if (key === refreshLabelView.key) return;
  refreshLabelView.key = key;
  state.labelView = new Map([...best].map(([id, b]) => [id, b.center]));
  state.labels?.update(areasShown() ? areaLabelItems() : [], {visible: areasShown()});
}

/** Massing focus region of a Land host: its building outline with the venue buffer. */
function landRegionFor(features) {
  const points = features.flatMap(f => outerRings(f)).flat();
  return points.length ? venueRegion(points) : null;
}

function updateSpatialLayers() {
  if (!state.loaded) return;
  const code = $('province').value, reg = registerMode(), landHost = currentLand(), outletHost = outletLand();
  // One map for both data sets: the snapshot's frames, labels and context dots stay in every view (the register
  // counts another unit and never feeds them).
  const pm = state.provinceLayers?.update({rows: provinceScopeRows(), selectedCode: code, visible: true}) || null;
  state.provinceModel = pm;
  // Province labels print snapshot counts: under a register selection they would read as the chain's count.
  state.provinceLabels?.update(pm && !reg ? pm.provinces.filter(p => p.count > 0 || p.code === code).sort((a, b) => (b.code === code) - (a.code === code) || b.count - a.count)
    .map(p => ({id: p.code, name: p.name, value: num(p.count), state: p.state, quiet: Boolean(code) && p.code !== code, selected: p.code === code, center: p.label, swatch: p.fill || '', title: `${p.name} · ${num(p.count)} ร้านในชุดข้อมูล`})) : [], {visible: !reg});
  const districtAreas = state.selectedDistrict ? (districtById(state.selectedDistrict)?.areas || []).map(a => a.id) : [];
  state.areaLayers?.update({model: state.areaModel, selectedId: state.selectedArea, focusIds: state.selectedDistrict ? districtAreas : state.focusIds, outlineFocus: !state.selectedDistrict, districtId: state.selectedDistrict, visible: areasShown()});
  state.labels?.update(areasShown() ? areaLabelItems() : [], {visible: areasShown()});
  if (state.map.getLayer(PIN_LAYERS.context)) state.map.setLayoutProperty(PIN_LAYERS.context, 'visibility', 'visible');
  renderLegend();
  const v = currentVenue(), b = currentBuilding();
  // Official host buildings: the venue being looked at (venue level); in the area view every hosted venue
  // named by the focused rows (clickable, like Luxury Brands); none while another venue/building, a Land host
  // or a register view is open.
  const hostIds = reg || landHost ? [] : venueLevel() ? [v.id] : b ? (b.kind === 'host' ? b.footprint.venueIds || [] : []) : (state.panel.mode === 'venue' || (state.panel.mode === 'store' && v)) ? []
    : [...new Set(detailRows().map(r => r.venue?.id).filter(id => id && state.hosted.has(id)))];
  state.buildings?.update({venueIds: hostIds, enabled: true, theme: theme()});
  // Land host building: the host being looked at (its own venue level), or the one an open outlet's point falls in.
  state.landBuildings?.update({venueIds: landHost ? [landHost.id] : outletHost ? [outletHost.id] : [], enabled: true, theme: theme()});
  const focusFeatures = reg ? registerFocusFeatures() : state.selectedArea ? [areaById(state.selectedArea)?.feature].filter(Boolean) : state.selectedDistrict ? [] : state.focusIds.map(id => areaById(id)?.feature).filter(Boolean);
  const hostFeatures = state.buildings?.displayedFeatures() || [];
  const landFeatures = state.landBuildings?.displayedFeatures() || [];
  // Venue / Land mode: the focus tier (and the join) follow the place's surroundings, wherever the area focus is.
  const region = state.panel.mode === 'venue' && v ? venueRegionFor(v, hostFeatures) : landHost ? landRegionFor(landFeatures) : outletRegion(landFeatures);
  const anchorFeatures = focusFeatures.length ? focusFeatures : (state.selectedDistrict && !reg ? [districtById(state.selectedDistrict)?.feature].filter(Boolean) : []);
  const anchors = region ? [[(region[0][0] + region[2][0]) / 2, (region[0][1] + region[2][1]) / 2]]
    : anchorFeatures.length ? anchorFeatures.map(f => featureBounds(f, maplibregl.LngLatBounds).getCenter().toArray()) : [state.map.getCenter().toArray()];
  state.massing?.update({regions: region ? [region] : focusFeatures.flatMap(outerRings), hosts: [...hostFeatures, ...landFeatures].flatMap(outerRings), anchors, enabled: true, city: state.view3d, zoom: state.map.getZoom(), latitude: state.map.getCenter().lat})?.catch(e => console.warn('Massing', e));
  state.massing?.setScene(cameraPreset() === 'eye' ? 'eye' : 'default', venueTargets());
  applyJoin();
  const hostColors = () => { const s = getComputedStyle(document.documentElement); return {fill: s.getPropertyValue('--map-active-layer').trim(), stroke: s.getPropertyValue('--map-selected-stroke').trim()}; };
  state.xray?.update(venueLevel() ? levelFeatures().filter(f => f.properties?.render_as === 'extrusion') : [], {colors: hostColors()});
  state.xray?.setEnabled(state.view3d);
  // Register dots on the same map: a register view's or a Land host's selection at every zoom (with logos), else
  // every outlet from city zoom as plain dots under the snapshot's symbols.
  const sel = registerSelection();
  state.registerShown = sel.show ? sel.count : 0;
  state.registerLayer?.update(sel.show ? {show: true, selection: sel.selection || {}, selectedIndex: sel.selectedIndex ?? null, minZoom: 0, logos: true}
    : {show: state.showRegister, selection: {}, minZoom: REGISTER_MIN_ZOOM, logos: false});
  document.querySelector('.map-panel')?.classList.toggle('has-register-dots', registerDotsShown());
  state.pins?.layout();
}

/** Buildings drawn at venue level: the open Land host's, else the venue's official host buildings. */
const levelFeatures = () => (currentLand() ? state.landBuildings?.displayedFeatures() || [] : state.buildings?.displayedFeatures() || []);

/** Host building rings (+ display height) of the venue being looked at — occlusion and framing targets. */
function venueTargets() {
  if (!venueLevel()) return [];
  return levelFeatures().flatMap(f => outerRings(f).map(ring => ({ring, height: Number(f.properties?.display_height_m) || 3})));
}

/** A venue named by a row in the current scope (a host building can carry several venue ids). */
const scopedVenue = ids => {
  if (scopedVenue.scope !== state.scopeRows) { scopedVenue.scope = state.scopeRows; scopedVenue.ids = new Set(state.scopeRows.map(r => r.venue?.id).filter(Boolean)); }
  return ids.find(id => scopedVenue.ids.has(id)) || '';
};

/** What a building under the pointer would open (null: nothing → the click falls through). */
function buildingTarget(point) {
  const b = state.massing?.hitTest(point);
  return b && state.join ? resolveBuilding(`osm:${b.id}`, state.join, state.join.keyVenues) : null;
}

/**
 * One click handler, in priority order: venue solid → host building → focus pin → focus building →
 * province (country zoom) → area. A click on another แขวง/ตำบล moves there at any zoom; a click
 * inside the selected one changes nothing (pan and tilt freely).
 */
function onMapClick(e) {
  const point = e.point;
  if (state.xray?.hitTest([point.x, point.y])) {
    // The open Land host's solid: its own points (snapshot pins, register dots) stay clickable; else nothing changes.
    if (currentLand()) {
      const r = state.pins?.hitTest(point);
      if (r) { selectStore(r.id, {fly: false, showPopup: true, fromPin: true}); return; }
      const o = state.registerLayer?.hitTest(point);
      if (o) selectOutlet(o.id, {fromMap: true});
      return;
    }
    const v = currentVenue(); if (v && state.panel.mode !== 'venue') selectVenue(v.id); return;
  }
  const hosted = scopedVenue(state.buildings?.hitTest(point) || []);
  if (hosted) { if (state.panel.mode !== 'venue' || state.panel.id !== hosted) selectVenue(hosted); return; }
  const r = state.pins?.hitTest(point);
  if (r) { selectStore(r.id, {fly: false, showPopup: true, fromPin: true}); return; }
  const o = state.registerLayer?.hitTest(point);
  if (o) { if (state.panel.mode !== 'outlet' || state.panel.id !== o.id) selectOutlet(o.id, {fromMap: true}); return; }
  const landIds = state.landBuildings?.hitTest(point) || [];
  if (landIds.length) { const h = mainLandHost(state.land.hostById.get(landIds[0])?.fp); if (h && (state.panel.mode !== 'land' || state.panel.id !== h.id)) selectLand(h.id, {fromMap: true}); return; }
  const hit = buildingTarget(point);
  if (hit?.kind === 'venue') { if (state.panel.mode !== 'venue' || state.panel.id !== hit.id) selectVenue(hit.id); return; }
  if (hit?.kind === 'store') { if (state.panel.mode !== 'store' || state.panel.id !== hit.id) selectStore(hit.id, {fly: false, showPopup: true, fromPin: true}); return; }
  if (hit?.kind === 'building') { if (state.panel.mode !== 'building' || state.panel.id !== hit.key) selectBuilding(hit.key); return; }
  if (provinceZoom()) {
    const p = state.map.queryRenderedFeatures(point, {layers: ['province-fill'].filter(id => state.map.getLayer(id))})[0];
    if (p) { selectProvince(String(p.id ?? p.properties?.id)); return; }
  }
  if (!areasShown()) return;
  const id = state.areaLayers?.hitTest(point) || '';
  if (id && id !== state.selectedArea) selectArea(id, {fromMap: true});
}

/** Pointer feedback (one query per frame): pointer over anything clickable, outline on another area. */
function onMapMove(e) {
  onMapMove.point = e.point;
  if (onMapMove.frame) return;
  onMapMove.frame = requestAnimationFrame(() => {
    onMapMove.frame = 0;
    const map = state.map, p = onMapMove.point;
    if (!map || !state.loaded || !p) return;
    let over = Boolean(state.xray?.hitTest([p.x, p.y])) || Boolean(scopedVenue(state.buildings?.hitTest(p) || [])) || Boolean(state.pins?.hitTest(p)) ||
      Boolean(state.registerLayer?.hitTest(p)) || Boolean((state.landBuildings?.hitTest(p) || []).length) || Boolean(buildingTarget(p));
    let area = '';
    if (!over && areasShown() && !provinceZoom() && map.getZoom() >= AREA_MIN_ZOOM) {
      area = state.areaLayers?.hitTest(p) || '';
      if (area === state.selectedArea) area = '';
    }
    state.areaLayers?.hover(area);
    over = over || Boolean(area);
    map.getCanvas().style.cursor = over ? 'pointer' : '';
  });
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
    beforeId: map.getLayer(HOST_LAYERS.extrusion) ? HOST_LAYERS.extrusion : MASSING_BEFORE,
    // Venue buildings from the join use the host colour (LDS map.activeLayer), read from the theme.
    colors: {quiet: palette.massingQuiet, focus: palette.massingFocus, ground: palette.ground, venue: getComputedStyle(document.documentElement).getPropertyValue('--map-active-layer').trim() || undefined},
    tileUrl: t => (state.tileTemplate ? state.tileTemplate.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y) : ''),
    onResult: result => { state.massingResult = result; $('map-status').dataset.massing = `${result.features || 0}`; applyJoin(); },
  });
  try { state.xray = installVenueXray(map, {beforeId: MASSING_BEFORE}); }
  catch (e) { state.xray = null; console.warn('Venue x-ray unavailable', e); }
  state.pins = installRestaurantPins(map, $('map'), {
    reservedBottom: bottomSpace,
    onSelect: r => selectStore(r.id, {fly: false, showPopup: true, fromPin: true}),
    onLayout: stats => {
      const logos = stats.htmlPins ? ` · โลโก้ ${num(stats.visibleLogos)}/${num(stats.logoLimit)}` : '';
      // Two units, each with its own scope and never summed: in a register view the selection (national) and the
      // snapshot as context; elsewhere the snapshot's focus rows on screen and its context.
      $('map-status').textContent = registerMode()
        ? `สาขาในทะเบียนที่เลือก ${num(state.registerShown)} ทั้งประเทศ (คนละหน่วย) · ร้านในชุดข้อมูลเป็นจุดบริบท ${num(stats.contextRows)}`
        : `${num(stats.focusInView)} ร้านในจอ${logos} · บริบท ${num(stats.contextRows)}`;
    },
  });
  installExtraLayers();
  updatePins();
  updateSpatialLayers();
  if (!state.initialCameraDone) {
    state.initialCameraDone = true;
    if (state.panel.mode === 'store') { const r = rowById(state.panel.id); if (r && hasPoint(r)) { if (venueLevel()) frameVenue({instant: true}); else framePoint(map, [r.longitude, r.latitude], {preset: cameraPreset(), zoom: 16.5, animate: false}); } }
    else if (state.panel.mode === 'venue') frameVenue({instant: true});
    else if (registerMode() || state.panel.mode === 'land') frameExtras({instant: true});
    else fitMap({instant: true});
    state.lastPreset = cameraPreset();
  }
}

/**
 * Register dots and Land host buildings, once both the style and the extra data are in (either may come first;
 * a theme switch re-installs them with the rest). Land buildings sit between the massing tiers and the host
 * extrusion, so the context massing can never cut them away (draw order = depth order).
 */
function installExtraLayers() {
  const map = state.map;
  if (!map || !state.loaded) return false;
  let added = false;
  if (state.land && !state.landBuildings) {
    try {
      state.landBuildings = installVenueBuildings(map, state.landGeo, {ids: LAND_LAYERS, outlineRole: 'land_host_building', venueIds: [], enabled: true, theme: theme(),
        beforeId: map.getLayer(HOST_LAYERS.extrusion) ? HOST_LAYERS.extrusion : MASSING_BEFORE});
      added = true;
    } catch (e) { state.landBuildings = null; console.warn('Land buildings', e); }
  }
  if (state.register && !state.registerLayer) {
    try {
      state.registerLayer = installRegisterLayer(map, state.register, {beforeId: PIN_LAYERS.focus, onSelect: o => selectOutlet(o.id, {fromMap: true})});
      added = true;
    } catch (e) { state.registerLayer = null; console.warn('Register layer', e); }
  }
  return added;
}

/**
 * The attribution (OpenStreetMap / OpenMapTiles / CityMETER) must stay readable: its live height —
 * expanded on load, compact after the first drag — becomes --attrib-height, which keeps the phone
 * legend and Aha card above it.
 */
function trackAttribution(map) {
  const panel = map.getContainer().closest('.map-panel');
  const el = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
  if (!panel || !el) return null;
  const set = () => panel.style.setProperty('--attrib-height', `${Math.ceil(el.getBoundingClientRect().height) + 10}px`);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
  observer?.observe(el);
  set();
  return observer;
}

function initMap() {
  if (!window.maplibregl) throw new Error('Map library is unavailable');
  try {
    state.mapTheme = theme();
    state.map = new maplibregl.Map({container: 'map', center: BANGKOK.center, zoom: BANGKOK.zoom, pitch: 0, maxPitch: 85, attributionControl: {compact: true}, style: buildMapStyle(state.mapTheme)});
    state.map.addControl(new maplibregl.NavigationControl({showCompass: true, visualizePitch: true}), 'top-right');
    state.attribObserver = trackAttribution(state.map);
    state.labels = installAreaLabels(state.map, $('map'), {className: 'neighborhood-label', hostId: 'area-labels', hostLabel: 'แขวง/ตำบลบนแผนที่', minZoom: 11.5, verb: 'กดเพื่อสำรวจพื้นที่', onSelect: id => selectArea(id, {fromMap: true}), reservedBottom: labelBottomSpace, maxLabels: 40});
    state.provinceLabels = installAreaLabels(state.map, $('map'), {className: 'province-label', hostId: 'province-labels', hostLabel: 'จังหวัดบนแผนที่', minZoom: 0, maxZoom: PROVINCE_LABEL_MAX_ZOOM, verb: 'กดเพื่อดูจังหวัด', detailZoomClass: false, onSelect: code => selectProvince(code), reservedBottom: labelBottomSpace});
    state.map.on('zoomend', () => { if (state.loaded) renderLegend(); });
    // Coalesced: a camera fit jumps the map many times in one task; the labels follow the last position.
    state.map.on('moveend', () => {
      clearTimeout(refreshLabelView.timer);
      refreshLabelView.timer = setTimeout(() => {
        if (!state.loaded) return;
        refreshLabelView();
        // Register views: the massing follows the แขวง/ตำบล under the centre once zoomed in (coalesced, after the move).
        if (registerMode() && registerFocusKey() !== (state.registerFocus || '')) updateSpatialLayers();
      }, 60);
    });
    state.map.on('mouseout', () => { state.areaLayers?.hover(''); });
    state.map.on('style.load', installSpatialLayers);
    state.map.on('click', onMapClick);
    state.map.on('mousemove', onMapMove);
    state.map.on('error', e => console.warn('Map resource', e.error?.message || e));
    fetch(TILEJSON_URL).then(r => r.json()).then(j => { state.tileTemplate = j.tiles?.[0] || ''; if (state.loaded) updateSpatialLayers(); }).catch(e => console.warn('TileJSON', e));
  } catch (e) {
    state.loaded = false; state.initialCameraDone = false;
    for (const cleanup of [() => state.attribObserver?.disconnect(), () => state.labels?.dispose(), () => state.provinceLabels?.dispose(), disposeSpatial, () => state.map?.remove()]) { try { cleanup(); } catch (err) { console.warn('Map cleanup', err); } }
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
    else if (wasOpen && state.loaded && (registerMode() || state.panel.mode === 'land')) frameExtras();
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
  state.showRegister = p.get('rdots') !== '0';
  $('toggle-register')?.setAttribute('aria-pressed', String(state.showRegister));
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
  else if (p.get('land') && state.land?.hostById.has(p.get('land'))) state.panel = {mode: 'land', id: p.get('land')};
  else if (p.get('outlet') && state.register?.byId.has(p.get('outlet'))) state.panel = {mode: 'outlet', id: p.get('outlet')};
  else if (p.get('chain') && state.register?.brandById.has(p.get('chain'))) state.panel = {mode: 'chain', id: p.get('chain')};
  else if (p.get('company') && state.register?.companyById.has(p.get('company'))) state.panel = {mode: 'company', id: p.get('company')};
  else if (p.has('chains') && state.register) { state.panel = {mode: 'chains', id: ''}; state.registerQuery = (p.get('rq') || '').slice(0, 80); }
}

/** URL parameters that open a register or Land view (the extra data is awaited before the first render). */
const EXTRA_PARAMS = ['chains', 'chain', 'company', 'outlet', 'land'];

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
    if (registerMode() || state.panel.mode === 'land') { frameExtras(); return; }
    if (state.selectedArea || state.selectedDistrict || state.rows.length) fitMap();
  };
  let searchTimer;
  $('panel-view').addEventListener('input', event => {
    if (event.target.id !== 'register-search') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      // Raw value (the field is re-rendered from it); searchRegister trims for matching.
      state.registerQuery = event.target.value.slice(0, 80);
      renderPanel();
      saveURL();
      // The list re-renders under the field: keep typing where the caret was.
      const el = $('register-search');
      if (el) { el.focus({preventScroll: true}); const n = el.value.length; el.setSelectionRange(n, n); }
    }, 250);
  });
  $('bangkok-map').onclick = () => { if (state.map) applyPreset(state.map, state.view3d ? 'city' : 'plan', {center: BANGKOK.center, zoom: BANGKOK.zoom, animate: animate()}); };
  $('toggle-3d').onclick = toggle3d;
  $('toggle-eye').onclick = toggleTwoPoint;
  $('toggle-neighborhoods').onclick = () => { state.showAreas = !state.showAreas; $('toggle-neighborhoods').setAttribute('aria-pressed', String(state.showAreas)); updateSpatialLayers(); };
  // Every register outlet on the snapshot's map (from city zoom); a register or Land view still draws its own selection.
  $('toggle-register').onclick = () => {
    state.showRegister = !state.showRegister;
    $('toggle-register').setAttribute('aria-pressed', String(state.showRegister));
    announce(state.showRegister ? 'แสดงจุดสาขาร้านเครือทุกสาขาจากซูมระดับเมือง' : 'ซ่อนจุดสาขาร้านเครือ (ยกเว้นเครือหรืออาคารที่เปิดอยู่)');
    updateSpatialLayers(); saveURL();
  };
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

    // A link into a register or Land view waits for that data; otherwise the snapshot paints first.
    const opensExtra = EXTRA_PARAMS.some(k => new URLSearchParams(location.search).has(k));
    if (opensExtra) await loadExtras();
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
    loadExtras().then(() => {
      if (installExtraLayers()) updateSpatialLayers();
      renderPanel();
    }).catch(e => console.warn('Extras', e));
  } catch (e) {
    window.dispatchEvent(new CustomEvent('citymeter:load-error', {detail: {message: 'โหลดข้อมูลร้านอาหารไม่สำเร็จ กรุณาลองอีกครั้ง', resource: e.resource, status: e.status, phase: e.phase || 'startup', diagnostic: e.message}}));
    console.error(e);
  }
}

// Developer hook for live tuning in a browser console (not an API; may change without notice).
window.__citymeter = {state, get map() { return state.map; }, update, fitMap, updateSpatialLayers, applyPreset: (name, opts) => state.map && applyPreset(state.map, name, opts), fitPitched: (b, opts) => state.map && fitPitched(state.map, b, opts), cameraPadding, buildMapStyle, productionLink};

init();

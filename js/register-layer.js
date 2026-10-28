/**
 * Chain-register outlets on the map: one dot per outlet with a selected coordinate — never
 * clustered or aggregated, no point for an outlet without one.
 *
 * Drawn on the same map as the restaurant snapshot (owner 2026-10-28: show both together): every
 * outlet from REGISTER_MIN_ZOOM as a dot in the snapshot's own views, and the selection of a
 * register view (brand, company, outlet) or of a Land host at every zoom. The two data sets keep
 * their own units — the layer never feeds a snapshot count. Dots use the LDS map data role
 * (`--map-active-layer`, halo `--map-marker-halo`); the selected outlet adds the selected stroke.
 * With `logos`, from LOGO_MIN_ZOOM up to MAX_LOGOS visible outlets carry their brand logo as a
 * keyboard-reachable button (identity only — a logo does not verify a branch).
 */
import {brandLogoMarkup, getBrandLogo} from './brand-logos.js';

const SOURCE = 'register-outlets', DOTS = 'register-dots', SELECTED = 'register-selected';
export const REGISTER_LAYERS = Object.freeze({source: SOURCE, dots: DOTS, selected: SELECTED});
export const LOGO_MIN_ZOOM = 15;
/** Every outlet shows from this zoom in the snapshot's own views (city scale; the selection of a register view at every zoom). */
export const REGISTER_MIN_ZOOM = 11;
export const MAX_LOGOS = 60;
const NONE = ['==', ['get', 'i'], -1];

function cssVar(name, fallback) {
  const v = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return v || fallback;
}
const colors = () => ({fill: cssVar('--map-active-layer', '#347DA8'), halo: cssVar('--map-marker-halo', '#FFFFFF'), selected: cssVar('--map-selected-stroke', '#176B82')});

/** Filter expression for a register selection: {brand, company, ids} (indexes) or all. */
export function registerFilter({brand = null, company = null, ids = null} = {}) {
  if (ids) return ['in', ['get', 'i'], ['literal', [...ids]]];
  if (Number.isInteger(brand)) return ['==', ['get', 'b'], brand];
  if (Number.isInteger(company)) return ['==', ['get', 'c'], company];
  return true;
}

/** Dot sizes: a register selection reads at country zoom; every outlet in the snapshot's views stays smaller than a restaurant symbol. */
const RADIUS = Object.freeze({
  selection: ['interpolate', ['linear'], ['zoom'], 4, 1.6, 9, 2.6, 13, 4, 16, 5.5, 18, 7],
  quiet: ['interpolate', ['linear'], ['zoom'], 11, 1.8, 14, 2.6, 16, 3.4, 18, 4.4],
});

export function installRegisterLayer(map, register, {beforeId, onSelect} = {}) {
  const features = [];
  for (const o of register.outlets) {
    if (!o.hasPoint) continue;
    features.push({type: 'Feature', id: o.index, geometry: {type: 'Point', coordinates: [o.longitude, o.latitude]},
      properties: {i: o.index, b: o.brand.index, c: o.company ? o.company.index : -1}});
  }
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
  map.addSource(SOURCE, {type: 'geojson', data: {type: 'FeatureCollection', features}});
  const c = colors();
  map.addLayer({id: DOTS, type: 'circle', source: SOURCE, filter: NONE, layout: {visibility: 'none'},
    paint: {'circle-color': c.fill, 'circle-stroke-color': c.halo, 'circle-stroke-width': 1,
      'circle-radius': RADIUS.selection}}, before);
  map.addLayer({id: SELECTED, type: 'circle', source: SOURCE, filter: NONE, layout: {visibility: 'none'},
    paint: {'circle-color': c.fill, 'circle-stroke-color': c.selected, 'circle-stroke-width': 3,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 13, 7, 18, 10]}}, before);

  let visible = false, selected = null, markers = [], disposed = false, filter = NONE, logosOn = true;
  const outlets = register.outlets;

  function clearMarkers() { for (const m of markers) m.remove(); markers = []; }
  function layoutLogos() {
    clearMarkers();
    if (!visible || !logosOn || disposed || map.getZoom() < LOGO_MIN_ZOOM || typeof maplibregl === 'undefined') return;
    const seen = new Set();
    const hits = map.queryRenderedFeatures({layers: [DOTS]}).map(f => outlets[f.properties.i]).filter(o => o && !seen.has(o.id) && seen.add(o.id) && getBrandLogo(o.brand));
    for (const o of hits.slice(0, MAX_LOGOS)) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'register-logo-pin' + (o.index === selected ? ' is-selected' : '');
      el.setAttribute('aria-label', `${o.name || o.brand.name} — สาขาในทะเบียนร้านเครือ`);
      el.innerHTML = brandLogoMarkup(o.brand, {size: 'xs'});
      el.addEventListener('click', e => { e.stopPropagation(); onSelect?.(o); });
      markers.push(new maplibregl.Marker({element: el, anchor: 'bottom', offset: [0, -8]}).setLngLat([o.longitude, o.latitude]).addTo(map));
    }
  }
  // After a move or a new filter, lay the logos out again once the new view has been drawn: a jump fires moveend
  // before its first frame, and 'idle' never comes while a basemap tile keeps failing — so two timed passes.
  let timers = [];
  const relayout = () => { for (const t of timers) clearTimeout(t); timers = [80, 700].map(ms => setTimeout(() => { if (!disposed) layoutLogos(); }, ms)); };
  const onMoveEnd = relayout;
  map.on('moveend', onMoveEnd);
  // The outlet source is indexed in a worker; the first logo pass can come before its tiles exist.
  const onSourceData = e => { if (e.sourceId === SOURCE && e.isSourceLoaded && visible && !disposed) relayout(); };
  map.on('sourcedata', onSourceData);

  function update({show = false, selection = {}, selectedIndex = null, minZoom = 0, logos = true} = {}) {
    if (disposed) return;
    visible = Boolean(show);
    logosOn = Boolean(logos);
    selected = Number.isInteger(selectedIndex) ? selectedIndex : null;
    filter = registerFilter(selection);
    const col = colors();
    for (const id of [DOTS, SELECTED]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    if (map.getLayer(DOTS)) { map.setLayerZoomRange(DOTS, Math.max(0, minZoom), 24); map.setPaintProperty(DOTS, 'circle-radius', logosOn ? RADIUS.selection : RADIUS.quiet); }
    if (map.getLayer(DOTS)) { map.setFilter(DOTS, filter); map.setPaintProperty(DOTS, 'circle-color', col.fill); map.setPaintProperty(DOTS, 'circle-stroke-color', col.halo); }
    if (map.getLayer(SELECTED)) { map.setFilter(SELECTED, selected == null ? NONE : ['==', ['get', 'i'], selected]); map.setPaintProperty(SELECTED, 'circle-color', col.fill); map.setPaintProperty(SELECTED, 'circle-stroke-color', col.selected); }
    layoutLogos();
    if (visible) relayout();
  }
  /** Outlet under a screen point (6 px tolerance), nearest first; null when the layer is hidden. */
  function hitTest(point) {
    if (!visible || disposed || !map.getLayer(DOTS)) return null;
    const box = [[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]];
    const hits = map.queryRenderedFeatures(box, {layers: [SELECTED, DOTS].filter(id => map.getLayer(id))});
    if (!hits.length) return null;
    let best = null, bd = Infinity;
    for (const f of hits) {
      const o = outlets[f.properties.i];
      if (!o) continue;
      const p = map.project([o.longitude, o.latitude]), d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const t of timers) clearTimeout(t);
    clearMarkers();
    map.off('moveend', onMoveEnd);
    map.off('sourcedata', onSourceData);
    for (const id of [SELECTED, DOTS]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }
  return {update, hitTest, dispose, get visible() { return visible; }, get minZoom() { return map.getLayer(DOTS)?.minzoom ?? 0; }};
}

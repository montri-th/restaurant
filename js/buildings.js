/**
 * Host buildings of venue candidates — shown at venue level only.
 *
 * Source: the host-building footprints and CityMETER building parts of the
 * Luxury Brands release (OpenStreetMap original geometry, ODbL 1.0; heights per
 * CityMETER production CmDatasetBuilding3dPlugin, 3 m display fallback), joined to
 * this sheet's venue candidates by an exact normalized name/alias match
 * (scripts/build-data.py). A restaurant's link to a venue is its own name
 * mentioning the venue, so the building is drawn only when a venue (or a store
 * naming one) is open — never as a claim that a given restaurant is inside it,
 * and never inferred by proximity.
 */
const SOURCE = 'restaurant-venue-buildings';
const EXTRUSION = 'restaurant-venue-buildings-3d';
const OUTLINE = 'restaurant-venue-buildings-outline';
/** Layer ids, exported so the massing tiers can be inserted BEFORE the host extrusion (draw order = depth order). */
export const HOST_LAYERS = Object.freeze({extrusion: EXTRUSION, outline: OUTLINE, source: SOURCE});

function list(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') { try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch { return []; } }
  return [];
}

function colors(theme) {
  const dark = theme === 'dark';
  const style = typeof document !== 'undefined' && typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
  return {
    fill: style?.getPropertyValue('--map-active-layer').trim() || (dark ? '#65B6DB' : '#347DA8'),
    ink: style?.getPropertyValue('--map-selected-stroke').trim() || (dark ? '#68C4E2' : '#176B82'),
  };
}

export function buildingHeightLabel(properties = {}) {
  if (properties.height_status === 'model_height_review') return 'ความสูงแบบจำลองรอตรวจ · 3 ม. เพื่อแสดงรูปทรง';
  if (properties.height_status === 'unknown_display_fallback') {
    return properties.render_as === 'outline' ? 'ความสูง footprint ไม่ระบุ · ส่วนอาคารใช้ baseM/topM จากแหล่งข้อมูล' : 'ไม่มีข้อมูลความสูง · 3 ม. เป็นความสูงแสดงผลเท่านั้น';
  }
  const top = Number(properties.height_m), base = Number(properties.base_m) || 0;
  if (!Number.isFinite(top)) return 'ไม่มีข้อมูลความสูง';
  const label = new Intl.NumberFormat('th-TH', {maximumFractionDigits: 2});
  if (properties.geometry_role === 'host_building_part_not_shop_unit') return `ส่วนอาคาร ${label.format(base)}–${label.format(top)} ม. ตาม CityMETER · ไม่ใช่ผลรังวัด`;
  return `ความสูง${properties.height_status === 'citymeter_model_estimate' ? 'ประมาณจากแบบจำลอง' : 'ตามแหล่งข้อมูล'} ${label.format(top)} ม. · ไม่ใช่ผลรังวัด`;
}

/** venue ids that have a host building in this data set. */
export function hostedVenueIds(geojson) {
  const ids = new Set();
  for (const f of geojson?.features || []) for (const id of list(f.properties?.venue_ids)) ids.add(id);
  return ids;
}

export function installVenueBuildings(map, geojson, options = {}) {
  if (!map || typeof map.addSource !== 'function') throw new TypeError('A MapLibre map is required');
  const originals = geojson?.type === 'FeatureCollection' && Array.isArray(geojson.features)
    ? geojson.features.filter(f => f?.geometry && ['Polygon', 'MultiPolygon'].includes(f.geometry.type)) : [];
  let venueIds = new Set(options.venueIds || []), enabled = options.enabled !== false, theme = options.theme || 'light', disposed = false, displayed = [];
  const onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;
  const before = options.beforeId && map.getLayer(options.beforeId) ? options.beforeId : undefined;
  map.addSource(SOURCE, {type: 'geojson', data: {type: 'FeatureCollection', features: []},
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · CityMETER'});
  const palette = colors(theme);
  map.addLayer({id: EXTRUSION, type: 'fill-extrusion', source: SOURCE, minzoom: 14, filter: ['==', ['get', 'render_as'], 'extrusion'],
    layout: {visibility: enabled ? 'visible' : 'none'},
    paint: {'fill-extrusion-color': palette.fill, 'fill-extrusion-height': ['get', 'display_height_m'], 'fill-extrusion-base': ['get', 'display_base_m'],
      'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true}}, before);
  map.addLayer({id: OUTLINE, type: 'line', source: SOURCE, minzoom: 12, filter: ['==', ['get', 'geometry_role'], 'host_building_footprint_not_shop_unit'],
    layout: {visibility: enabled ? 'visible' : 'none'},
    paint: {'line-color': palette.ink, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, .6, 17, 1.5]}}, before);

  function update(next = {}) {
    if (disposed) return displayed.length;
    if ('venueIds' in next) venueIds = new Set(next.venueIds || []);
    if ('enabled' in next) enabled = Boolean(next.enabled);
    if ('theme' in next) theme = next.theme || 'light';
    displayed = originals.filter(f => list(f.properties?.venue_ids).some(id => venueIds.has(id)))
      .map(f => ({...f, properties: {...f.properties, height_label: buildingHeightLabel(f.properties)}}));
    map.getSource(SOURCE)?.setData({type: 'FeatureCollection', features: displayed});
    const p = colors(theme);
    if (map.getLayer(EXTRUSION)) { map.setLayoutProperty(EXTRUSION, 'visibility', enabled ? 'visible' : 'none'); map.setPaintProperty(EXTRUSION, 'fill-extrusion-color', p.fill); }
    if (map.getLayer(OUTLINE)) { map.setLayoutProperty(OUTLINE, 'visibility', enabled ? 'visible' : 'none'); map.setPaintProperty(OUTLINE, 'line-color', p.ink); }
    return displayed.length;
  }
  /** Venue ids of the host building under a screen point (style layers), or []. */
  function hitTest(point) {
    if (!enabled || disposed) return [];
    const hits = map.queryRenderedFeatures([point.x, point.y], {layers: [EXTRUSION, OUTLINE].filter(id => map.getLayer(id))});
    return hits.length ? list(hits[0].properties?.venue_ids) : [];
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const layer of [OUTLINE, EXTRUSION]) if (map.getLayer(layer)) map.removeLayer(layer);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }
  /** Features currently drawn — used to keep OSM massing from swallowing them and for framing. */
  function displayedFeatures() { return disposed || !enabled ? [] : displayed.slice(); }
  update();
  return {update, hitTest, displayedFeatures, dispose, onSelect};
}

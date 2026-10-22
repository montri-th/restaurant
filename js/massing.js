/**
 * City massing in two tiers — context everywhere, detail only where focused.
 *
 *  1. CITY (quiet): a MapLibre fill-extrusion layer straight from the basemap's
 *     OpenMapTiles `building` source-layer (OpenFreeMap tiles). Pale, no
 *     outline, vertical gradient only. Covers the whole city from zoom 13.
 *  2. FOCUS (detail): for the focused neighborhoods only, the same tile data is
 *     fetched again (same URLs, so the browser cache serves them), decoded with
 *     js/mvt.js and re-shaped with js/geometry.js — corners rounded and the
 *     footprint offset outward by a few metres so the rounded "model" fully
 *     encloses the original drawn by tier 1 (no z-fighting, no seams). This is
 *     the display answer to MapLibre's missing polygon corner radius
 *     (maplibre/maplibre-style-spec#1047); it changes nothing in the data.
 *
 * Host buildings (buildings.js, map.activeLayer role) stay a separate layer:
 * tile buildings that overlap a host are dropped from the focus tier and hidden
 * in the city tier by feature id, so the host silhouette is never swallowed by a
 * taller OSM outline.
 *
 * The focus tier also keeps each building's ORIGINAL footprint (clipped to its
 * tile, before rounding/offset) so the app can join restaurant display points to
 * the buildings it draws (js/building-join.js, owner decision 2026-10-23), and a
 * third tier draws the buildings of the venue being looked at in the data colour
 * (map.activeLayer) — same rounded shape, only the colour changes. Feature ids are
 * stable per tile building (tile, feature index, polygon index), so a highlight
 * never lands on another building when the tier is re-shaped at a new zoom.
 *
 * Heights are OpenMapTiles render_height / render_min_height (OSM tags where
 * present, otherwise the schema's default). They are context, never a claim.
 */
import {parseVectorTile, tileToLonLat, lonLatToTileUnits, tilesForBBox, metresPerTileUnit} from './mvt.js';
import {clipRingToBox, offsetRing, roundRing, isClockwise, ringsIntersect, cleanRing, signedArea} from './geometry.js';

export const CITY_LAYER = 'city-massing';
export const FOCUS_SOURCE = 'focus-massing';
export const FOCUS_LAYER = 'focus-massing-3d';
/** Focus-tier buildings of the venue being looked at (data colour, map.activeLayer). */
export const VENUE_LAYER = 'focus-massing-venue';
/** Focus-tier buildings that stand between the camera and the venue (see-through). */
export const OCCLUDER_LAYER = 'focus-massing-occluding';
/**
 * Scene opacities. `eye` is the venue-level two-point view (owner decision
 * 2026-10-22): the surroundings go very quiet and anything that would hide the
 * venue becomes see-through; the venue's own host building (buildings.js) stays
 * opaque because it is the data layer.
 */
export const SCENE = Object.freeze({
  default: {city: 0.22, focus: 1, occluder: 0.18},
  eye: {city: 0.16, focus: 0.62, occluder: 0.14},
});
/**
 * Distance fade of the city tier (owner decision 2026-10-22: buildings outside
 * the focus are almost transparent and fade out with distance). MapLibre has no
 * camera-distance expression, so each building's distance to the nearest focus
 * anchor (area centroid) is written to feature-state once; the colour then
 * interpolates from the quiet tone to the ground tone (= invisible).
 */
export const FADE_NEAR_M = 500;
export const FADE_FAR_M = 2200;
export const TILE_ZOOM = 14;
export const MAX_TILES = 9;
export const HEIGHT_LIFT_M = 0.35;

/**
 * Stable, unique id of one focus building: its z14 tile and the ordinal of the
 * polygon among ALL building polygons of that tile, counted before any focus or
 * host filtering (< 2^52, exact in JS) — the same building keeps its id whatever
 * the focus or the zoom. One OpenFreeMap feature can carry hundreds of polygons
 * (buildings sharing a height are merged under one OSM id, verified live
 * 2026-10-23), so neither the OSM id nor a per-feature polygon index is a key.
 */
export function focusFeatureId(tile, ordinal) {
  return (tile.x * 16384 + tile.y) * 16777216 + (ordinal % 16777216);
}

/** Display radius (m) for corner rounding at a map zoom: ~4 px, kept within 3–12 m. */
export function roundingRadiusM(zoom, latitude = 13.75) {
  const metresPerPixel = (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
  return Math.min(12, Math.max(3, 4 * metresPerPixel));
}

/** Outward offset (m) that keeps a fillet of radius r enclosing the original (see geometry.roundRing). */
export const encloseOffsetM = r => Math.max(1, r / 2.5);

function bboxOfRings(rings) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { if (x < west) west = x; if (x > east) east = x; if (y < south) south = y; if (y > north) north = y; }
  return [west, south, east, north];
}

/** Outer rings of a Polygon/MultiPolygon feature in lon/lat. */
export function outerRings(feature) {
  const g = feature?.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates[0]];
  if (g.type === 'MultiPolygon') return g.coordinates.map(p => p[0]);
  return [];
}

/**
 * Pure: turn one decoded tile into focus features for the given regions.
 * regions/hosts are arrays of lon/lat rings. Returns {features, hiddenIds, kept, dropped}.
 */
export function shapeTile(tile, layer, {regions = [], hosts = [], radiusM, offsetM, segments = 3} = {}) {
  const extent = layer.extent || 4096;
  const mpu = metresPerTileUnit(tile, extent);
  const r = radiusM / mpu, d = offsetM / mpu;
  const box = {minX: 0, minY: 0, maxX: extent, maxY: extent};
  const toTile = ring => ring.map(([lon, lat]) => lonLatToTileUnits(lon, lat, tile, extent));
  const toLonLat = ring => ring.map(([px, py]) => tileToLonLat(px, py, tile, extent));
  const regionRings = regions.map(toTile), hostRings = hosts.map(toTile);
  const features = [], footprints = [], hiddenIds = new Set();
  let kept = 0, dropped = 0, ordinal = 0;
  for (let fi = 0; fi < layer.features.length; fi++) {
    const f = layer.features[fi];
    if (f.type !== 3 || f.properties.hide_3d === true) continue;
    const height = Number(f.properties.render_height);
    const base = Number(f.properties.render_min_height) || 0;
    if (!Number.isFinite(height) || height <= 0) continue;
    // Group rings into polygons: an outer ring followed by its holes (MVT order).
    const polygons = [];
    for (const raw of f.rings()) {
      const ring = cleanRing(raw);
      if (!ring) continue;
      if (isClockwise(ring)) polygons.push({outer: ring, holes: []});
      else if (polygons.length) polygons[polygons.length - 1].holes.push(ring);
    }
    polygons.forEach(poly => {
      const id = focusFeatureId(tile, ordinal++); // counted before the focus/host filters: stable per building
      const outer = clipRingToBox(poly.outer, box);
      if (!outer) return;
      const inFocus = regionRings.some(region => ringsIntersect(outer, region));
      if (!inFocus) return;
      if (hostRings.some(host => ringsIntersect(outer, host))) { if (f.id != null) hiddenIds.add(f.id); dropped++; return; }
      // Outer rings are clockwise and holes counter-clockwise (MVT, y-down), so the
      // same normal sign pushes outers outward and holes inward: the model encloses.
      const holes = poly.holes.map(h => clipRingToBox(h, box)).filter(Boolean);
      const shapedOuter = roundRing(offsetRing(outer, d, 1), r, segments, {encloseOffset: d});
      const shapedHoles = holes.map(h => roundRing(offsetRing(h, d, 1), r, segments, {encloseOffset: d}))
        .filter(h => Math.abs(signedArea(h)) > 0);
      const coordinates = [shapedOuter, ...shapedHoles].map(toLonLat);
      features.push({type: 'Feature', id, geometry: {type: 'Polygon', coordinates}, properties: {osm_id: f.id ?? null, height: height + HEIGHT_LIFT_M, base, render_height: height}});
      // The original footprint (clipped to the tile, not rounded or offset): what restaurant points are joined to.
      footprints.push({id, osmId: f.id ?? null, outer: toLonLat(outer), holes: holes.map(toLonLat), height, base});
      kept++;
    });
  }
  return {features, footprints, hiddenIds, kept, dropped};
}

/** Tiles needed for a set of lon/lat regions (deduplicated, bounded by MAX_TILES). */
export function tilesForRegions(regions, z = TILE_ZOOM, max = MAX_TILES) {
  const keys = new Map();
  for (const ring of regions) for (const t of tilesForBBox(bboxOfRings([ring]), z)) keys.set(`${t.z}/${t.x}/${t.y}`, t);
  const tiles = [...keys.values()];
  return {tiles: tiles.slice(0, max), truncated: tiles.length > max, total: tiles.length};
}

/**
 * Install both tiers on a loaded style. `sourceId` is the basemap vector source
 * (OpenMapTiles schema). `tileUrl(tile)` returns the URL of one tile; the app
 * reads it from the same TileJSON MapLibre uses.
 */
export function installMassing(map, {sourceId = 'openmaptiles', beforeId, colors, tileUrl, fetchImpl = (...a) => fetch(...a), onResult = null} = {}) {
  const palette = {quiet: '#ECEBE5', focus: '#E6E3DA', ground: '#EEF1EE', venue: '#347DA8', ...colors};
  const cityColor = () => ['interpolate', ['linear'], ['coalesce', ['feature-state', 'fade'], 1], 0, palette.quiet, 1, palette.ground];
  let enabled = true, hiddenIds = [], disposed = false, token = 0, lastKey = '', lastBucket = -1;
  let lastInput = {regions: [], hosts: [], latitude: 13.75};
  const cache = new Map();

  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
  if (map.getSource(sourceId) && !map.getLayer(CITY_LAYER)) {
    map.addLayer({
      id: CITY_LAYER, type: 'fill-extrusion', source: sourceId, 'source-layer': 'building', minzoom: 13,
      filter: cityFilter(),
      paint: {
        'fill-extrusion-color': cityColor(),
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': SCENE.default.city,
        'fill-extrusion-vertical-gradient': true,
      },
    }, before);
  }
  map.addSource(FOCUS_SOURCE, {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
  let occluderIds = [], highlightIds = [], scene = 'default', targets = [];
  const notIn = ids => ['!', ['in', ['id'], ['literal', ids]]];
  const focusFilter = () => ['all', notIn(occluderIds), notIn(highlightIds)];
  const occluderFilter = () => (highlightIds.length ? ['all', ['in', ['id'], ['literal', occluderIds]], notIn(highlightIds)] : ['in', ['id'], ['literal', occluderIds]]);
  map.addLayer({
    id: FOCUS_LAYER, type: 'fill-extrusion', source: FOCUS_SOURCE, minzoom: 13,
    filter: focusFilter(),
    paint: {
      'fill-extrusion-color': palette.focus,
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': ['get', 'base'],
      'fill-extrusion-opacity': SCENE.default.focus,
      'fill-extrusion-vertical-gradient': true,
    },
  }, before);
  map.addLayer({
    id: OCCLUDER_LAYER, type: 'fill-extrusion', source: FOCUS_SOURCE, minzoom: 13,
    filter: occluderFilter(),
    paint: {
      'fill-extrusion-color': palette.focus,
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': ['get', 'base'],
      'fill-extrusion-opacity': SCENE.default.occluder,
      'fill-extrusion-vertical-gradient': false,
    },
  }, before);
  // Added last of the three focus tiers, so it draws after them (the data layer is never cut away).
  map.addLayer({
    id: VENUE_LAYER, type: 'fill-extrusion', source: FOCUS_SOURCE, minzoom: 13,
    filter: ['in', ['id'], ['literal', highlightIds]],
    paint: {
      'fill-extrusion-color': palette.venue,
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': ['get', 'base'],
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
    },
  }, before);

  function cityFilter() {
    return ['all', ['!=', ['get', 'hide_3d'], true], ['!', ['in', ['id'], ['literal', hiddenIds]]]];
  }
  function setHidden(ids) {
    hiddenIds = [...ids];
    if (map.getLayer(CITY_LAYER)) map.setFilter(CITY_LAYER, cityFilter());
  }
  async function loadTile(tile) {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (cache.has(key)) return cache.get(key);
    const task = (async () => {
      const r = await fetchImpl(tileUrl(tile));
      if (!r.ok) throw new Error(`tile ${key} ${r.status}`);
      const parsed = parseVectorTile(await r.arrayBuffer());
      return parsed.layers.building || {extent: 4096, features: []};
    })();
    cache.set(key, task);
    task.catch(() => cache.delete(key));
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    return task;
  }

  /**
   * regions: lon/lat outer rings of the focused neighborhoods; hosts: rings of
   * host buildings currently drawn by buildings.js; zoom: current map zoom.
   */
  async function update({regions = lastInput.regions, hosts = lastInput.hosts, zoom = map.getZoom(), enabled: on = enabled, city = enabled, latitude = lastInput.latitude, anchors: nextAnchors = null} = {}) {
    enabled = on;
    lastInput = {regions, hosts, latitude};
    if (nextAnchors) setAnchors(nextAnchors);
    // In plan view (pitch 0) the focus tier still draws as flat rounded footprints; the city tier is hidden.
    if (map.getLayer(CITY_LAYER)) map.setLayoutProperty(CITY_LAYER, 'visibility', enabled && city ? 'visible' : 'none');
    for (const id of [FOCUS_LAYER, OCCLUDER_LAYER]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', enabled ? 'visible' : 'none');
    const bucket = Math.floor(zoom);
    const {tiles, truncated} = tilesForRegions(regions);
    const ready = typeof tileUrl === 'function' && tiles.length > 0 && tiles.every(t => Boolean(tileUrl(t)));
    const ringKey = rings => `${rings.length}:${rings.map(r => r.length + ':' + r[0]?.join(',')).join('|')}`;
    const key = `${enabled}|${ready}|${bucket}|${ringKey(regions)}|${ringKey(hosts)}`;
    if (key === lastKey) return {features: 0, tiles: 0, cached: true};
    lastKey = key; lastBucket = bucket;
    if (!enabled || !regions.length || !ready) {
      map.getSource(FOCUS_SOURCE)?.setData({type: 'FeatureCollection', features: []}); setHidden([]);
      currentFeatures = []; setFootprints([]); setOccluders([]);
      const empty = {features: 0, tiles: 0, ready};
      if (typeof onResult === 'function') { try { onResult(empty); } catch (e) { console.warn('Massing onResult', e); } }
      return empty;
    }
    const my = ++token;
    const radiusM = roundingRadiusM(Math.max(zoom, 14.5), latitude), offsetM = encloseOffsetM(radiusM);
    const layers = await Promise.all(tiles.map(t => loadTile(t).catch(e => { console.warn('Massing tile unavailable', e.message || e); return null; })));
    if (my !== token || disposed) return {features: 0, tiles: 0, stale: true};
    // Shaping thousands of footprints is main-thread work: never during a camera move (it would stall
    // the animation of an area-to-area move); the previous tier stays on screen until the move ends.
    if (typeof map.isMoving === 'function' && map.isMoving()) {
      await new Promise(resolve => map.once('moveend', resolve));
      if (my !== token || disposed) return {features: 0, tiles: 0, stale: true};
    }
    const features = [], footprints = [], hidden = new Set();
    let kept = 0, dropped = 0;
    layers.forEach((layer, i) => {
      if (!layer) return;
      const shaped = shapeTile(tiles[i], layer, {regions, hosts, radiusM, offsetM});
      features.push(...shaped.features); footprints.push(...shaped.footprints);
      shaped.hiddenIds.forEach(id => hidden.add(id)); kept += shaped.kept; dropped += shaped.dropped;
    });
    // Ids are stable per tile building (focusFeatureId); the OSM id stays in properties.
    currentFeatures = features;
    setFootprints(footprints);
    map.getSource(FOCUS_SOURCE)?.setData({type: 'FeatureCollection', features});
    setHidden(hidden);
    updateOcclusion();
    const result = {features: kept, droppedForHosts: dropped, tiles: tiles.length, truncated, radiusM, offsetM, occluders: occluderIds.length, version};
    // Every applied result (including zoom-triggered rebuilds) reaches the host app through onResult,
    // so a caller whose own update was superseded still sees the figures that are on screen.
    if (typeof onResult === 'function') { try { onResult(result); } catch (e) { console.warn('Massing onResult', e); } }
    return result;
  }

  function retheme(next = {}) {
    Object.assign(palette, next);
    if (map.getLayer(CITY_LAYER)) map.setPaintProperty(CITY_LAYER, 'fill-extrusion-color', cityColor());
    for (const id of [FOCUS_LAYER, OCCLUDER_LAYER]) if (map.getLayer(id)) map.setPaintProperty(id, 'fill-extrusion-color', palette.focus);
    if (map.getLayer(VENUE_LAYER)) map.setPaintProperty(VENUE_LAYER, 'fill-extrusion-color', palette.venue);
  }

  /* ---------- footprints for the spatial join, venue highlight, hit test ---------- */
  let footprintList = [], footprintById = new Map(), version = 0;
  function setFootprints(list) {
    footprintList = Object.freeze(list.map(b => Object.freeze({...b, bbox: bboxOfRings([b.outer])})));
    footprintById = new Map(footprintList.map(b => [b.id, b]));
    version++;
  }
  /** Original footprints of the buildings currently in the focus tier (lon/lat, with stable ids). */
  function buildings() { return footprintList; }
  /** Draw these focus buildings in the data colour (the venue being looked at); [] clears. */
  function setHighlight(ids = []) {
    const next = [...new Set(ids)].filter(id => footprintById.has(id)).sort((a, b) => a - b);
    if (next.length === highlightIds.length && next.every((v, i) => v === highlightIds[i])) return highlightIds.length;
    highlightIds = next;
    if (map.getLayer(FOCUS_LAYER)) map.setFilter(FOCUS_LAYER, focusFilter());
    if (map.getLayer(OCCLUDER_LAYER)) map.setFilter(OCCLUDER_LAYER, occluderFilter());
    if (map.getLayer(VENUE_LAYER)) map.setFilter(VENUE_LAYER, ['in', ['id'], ['literal', highlightIds]]);
    return highlightIds.length;
  }
  /** The focus building under a screen point (venue tier first), as its footprint record, or null. */
  function hitTest(point) {
    if (!enabled || disposed || !footprintList.length) return null;
    const layers = [VENUE_LAYER, FOCUS_LAYER, OCCLUDER_LAYER].filter(id => map.getLayer(id));
    let hits = [];
    try { hits = map.queryRenderedFeatures([point.x, point.y], {layers}); } catch { return null; }
    for (const h of hits) { const b = footprintById.get(h.id); if (b) return b; }
    return null;
  }

  /* ---------- distance fade of the city tier ---------- */
  let anchors = [], anchorKey = '';
  const stated = new Map(); // feature id → fade already written
  const metresBetween = (a, b) => { const kx = 111320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), ky = 110574; return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * ky); };
  const firstCoordinate = g => { let v = g?.coordinates; while (Array.isArray(v) && Array.isArray(v[0])) v = v[0]; return Array.isArray(v) && v.length >= 2 ? v : null; };
  function fadeFor(point) {
    if (!anchors.length) return 0;
    let d = Infinity;
    for (const a of anchors) d = Math.min(d, metresBetween(point, a));
    return Math.min(1, Math.max(0, (d - FADE_NEAR_M) / (FADE_FAR_M - FADE_NEAR_M)));
  }
  /** Write fade for buildings in the loaded tiles that have not been stated yet (incremental; never during a camera move). */
  function updateFade() {
    if (disposed || !map.getLayer(CITY_LAYER) || !map.getSource(sourceId)) return 0;
    if (typeof map.isMoving === 'function' && map.isMoving()) return 0; // moveend schedules it again
    let features;
    try { features = map.querySourceFeatures(sourceId, {sourceLayer: 'building'}); } catch { return 0; }
    let n = 0;
    for (const f of features) {
      if (f.id == null || stated.has(f.id)) continue;
      const p = firstCoordinate(f.geometry);
      if (!p) continue;
      const fade = Math.round(fadeFor(p) * 20) / 20;
      try { map.setFeatureState({source: sourceId, sourceLayer: 'building', id: f.id}, {fade}); } catch { continue; }
      stated.set(f.id, fade); n++;
    }
    return n;
  }
  /**
   * New anchors (focus centroids) invalidate every stated value. The states are rewritten after the
   * camera stops (the old ones stay until then, so the city tier never blinks out during a move).
   */
  function setAnchors(next = []) {
    const key = next.map(a => a.map(v => +v.toFixed(5)).join(',')).join('|');
    if (key === anchorKey) return;
    anchorKey = key; anchors = next.filter(a => Array.isArray(a) && a.length >= 2);
    stated.clear();
    if (typeof map.isMoving === 'function') scheduleFade(); else updateFade();
  }
  let fadeTimer = 0;
  const scheduleFade = () => { clearTimeout(fadeTimer); fadeTimer = setTimeout(updateFade, 120); };
  const onSourceData = e => { if (e.sourceId === sourceId && e.isSourceLoaded) scheduleFade(); };
  map.on('sourcedata', onSourceData);
  map.on('moveend', scheduleFade);

  /* ---------- scene (venue-level two-point view) and occlusion ---------- */
  let currentFeatures = [];
  function setOccluders(ids) {
    const next = [...ids];
    if (next.length === occluderIds.length && next.every((v, i) => v === occluderIds[i])) return;
    occluderIds = next;
    if (map.getLayer(FOCUS_LAYER)) map.setFilter(FOCUS_LAYER, focusFilter());
    if (map.getLayer(OCCLUDER_LAYER)) map.setFilter(OCCLUDER_LAYER, occluderFilter());
  }
  /**
   * Screen-space box of a building: ground vertices plus their tops, where a
   * vertex's top is lifted by height × local pixels-per-metre × sin(pitch).
   * MapLibre projects ground points only, so this is the standard approximation.
   * Also returns the mean ground y (larger = nearer the camera in a pitched view).
   */
  function screenBox(ring, height) {
    const sinPitch = Math.sin(map.getPitch() * Math.PI / 180);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sumY = 0, n = 0;
    for (const [lon, lat] of ring) {
      const p = map.project([lon, lat]);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const q = map.project([lon + 1e-5, lat]);
      const metres = 1.11320 * Math.cos(lat * Math.PI / 180); // 1e-5° of longitude in metres
      const ppm = Math.hypot(q.x - p.x, q.y - p.y) / metres;
      const top = p.y - height * ppm * sinPitch;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, top, p.y); maxY = Math.max(maxY, p.y);
      sumY += p.y; n++;
    }
    return n ? {minX, minY, maxX, maxY, groundY: sumY / n} : null;
  }
  const overlaps = (a, b) => a && b && a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
  /** Focus buildings whose screen box overlaps a target and whose ground is nearer the camera → see-through. */
  function updateOcclusion() {
    if (scene !== 'eye' || !targets.length || !currentFeatures.length || map.getPitch() < 30) { setOccluders([]); return; }
    const boxes = targets.map(t => screenBox(t.ring, t.height)).filter(Boolean);
    if (!boxes.length) { setOccluders([]); return; }
    const ids = [];
    for (const f of currentFeatures) {
      if (highlightIds.includes(f.id)) continue; // the venue's own building is a target, never an occluder
      const box = screenBox(f.geometry.coordinates[0], f.properties.height);
      if (box && boxes.some(t => overlaps(box, t) && box.groundY > t.groundY + 1)) ids.push(f.id);
    }
    setOccluders(ids);
  }
  /**
   * scene: 'default' | 'eye'. targets: [{ring: [[lon,lat]…], height}] — the venue's
   * host building rings (data layer) the camera is looking at.
   */
  function setScene(next = 'default', nextTargets = []) {
    scene = SCENE[next] ? next : 'default';
    targets = Array.isArray(nextTargets) ? nextTargets.filter(t => Array.isArray(t?.ring) && t.ring.length >= 4) : [];
    const o = SCENE[scene];
    if (map.getLayer(CITY_LAYER)) map.setPaintProperty(CITY_LAYER, 'fill-extrusion-opacity', o.city);
    if (map.getLayer(FOCUS_LAYER)) map.setPaintProperty(FOCUS_LAYER, 'fill-extrusion-opacity', o.focus);
    if (map.getLayer(OCCLUDER_LAYER)) map.setPaintProperty(OCCLUDER_LAYER, 'fill-extrusion-opacity', o.occluder);
    // On a live map the occluders are computed once the selection's work is done (and again when the
    // camera stops); a stand-in map without isMoving computes them at once.
    if (typeof map.isMoving === 'function') { if (scene !== 'eye') setOccluders([]); onMoveEnd(); }
    else updateOcclusion();
    return {scene, targets: targets.length, occluders: occluderIds.length};
  }
  // Coalesced: a camera fit jumps the map many times in one task (each jump fires moveend/zoomend);
  // occlusion and the zoom re-shape run once, after the last one.
  let occlusionTimer = 0, zoomTimer = 0;
  const onMoveEnd = () => { clearTimeout(occlusionTimer); occlusionTimer = setTimeout(() => { if (!disposed && scene === 'eye' && targets.length) updateOcclusion(); }, 40); };
  map.on('moveend', onMoveEnd);
  const onZoomEnd = () => { clearTimeout(zoomTimer); zoomTimer = setTimeout(() => { if (!disposed && enabled && lastInput.regions.length && Math.floor(map.getZoom()) !== lastBucket) update({zoom: map.getZoom()}); }, 40); };
  map.on('zoomend', onZoomEnd);

  function dispose() {
    disposed = true;
    clearTimeout(fadeTimer); clearTimeout(occlusionTimer); clearTimeout(zoomTimer);
    map.off('zoomend', onZoomEnd);
    map.off('moveend', onMoveEnd);
    map.off('moveend', scheduleFade);
    map.off('sourcedata', onSourceData);
    try { map.removeFeatureState({source: sourceId, sourceLayer: 'building'}); } catch {}
    for (const id of [VENUE_LAYER, OCCLUDER_LAYER, FOCUS_LAYER, CITY_LAYER]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(FOCUS_SOURCE)) map.removeSource(FOCUS_SOURCE);
    footprintList = []; footprintById = new Map();
  }
  return {update, retheme, setScene, setAnchors, updateFade, dispose, buildings, setHighlight, hitTest,
    layerIds: {city: CITY_LAYER, focus: FOCUS_LAYER, occluder: OCCLUDER_LAYER, venue: VENUE_LAYER},
    get occluders() { return occluderIds.slice(); }, get highlighted() { return highlightIds.slice(); }, get faded() { return stated.size; }, get version() { return version; }};
}

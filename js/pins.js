/**
 * Restaurant pins: one mark per observation, never clustered or aggregated.
 *
 * 70,214 observations are drawn by MapLibre from GeoJSON sources:
 *  - focus: rows that carry detail (the focused areas, the selected area/venue),
 *    one symbol per row in its food-type series: theme fill + the LDS shape cue of
 *    that series (js/cues.js, DATAVIZ-05), outlined in the marker stroke;
 *  - context: the whole filtered scope as small grey dots under the focus symbols,
 *    no logo, not focusable and not a click target (a click there selects the area);
 *    re-sent only when the filters change.
 * From DETAIL_MIN_ZOOM the focus rows inside the viewport (≤ MAX_DETAIL_PINS,
 * nearest the centre first) become HTML buttons: keyboard-reachable (roving
 * tabindex, arrow keys), co-located rows get bounded screen-space slots around
 * their own anchor (the source coordinate never moves; a leader line joins a
 * hovered/selected pin to it) and chain logos are placed only where they clear
 * every other mark and the map chrome (≤ MAX_LOGOS, distinct chains first).
 */
import {hasPoint} from './model.js';
import {brandLogoMarkup, getBrandLogo} from './brand-logos.js';
import {cueImage, cueMarkup} from './cues.js';

export const MAX_LOGOS = 250;
export const DETAIL_MIN_ZOOM = 15.5;
export const MAX_DETAIL_PINS = 320;
export const PIN_LAYERS = Object.freeze({context: 'restaurant-context', focus: 'restaurant-focus', selected: 'restaurant-selected'});
const SOURCES = {context: 'restaurant-context', focus: 'restaurant-focus', selected: 'restaurant-selected'};

const intersects = (a, b, gap = 0) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
const inside = (p, b) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
const pointBox = (x, y, size) => ({left: x - size / 2, right: x + size / 2, top: y - size / 2, bottom: y + size / 2});
export const isSourceVisible = (point, bounds) => inside(point, bounds) && !(bounds.exclusions || []).some(b => inside(point, b));

function cssVar(name, fallback) {
  const value = typeof getComputedStyle === 'function' && typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return value || fallback;
}

/** Series fills 1–10 (theme palette, read from assets/theme.css). */
export function seriesColors(count = 10) {
  return Array.from({length: count}, (_, i) => cssVar(`--series-${i + 1}-fill`, '#8AA4AA'));
}
const ICON = series => `restaurant-cue-${series}`;

/** Register (or refresh) the ten cue icons in the current theme colours. */
function installCueIcons(map) {
  const fills = seriesColors(10), stroke = cssVar('--map-marker-stroke', '#182327');
  fills.forEach((fill, i) => {
    const image = cueImage(i + 1, {size: 16, pixelRatio: 2, fill, stroke});
    if (map.hasImage(ICON(i + 1))) map.updateImage(ICON(i + 1), image);
    else map.addImage(ICON(i + 1), image, {pixelRatio: 2});
  });
}

/** GeoJSON points for rows (source coordinate unchanged; id = position in the list). */
export function pointCollection(rows) {
  const features = [];
  for (const r of rows) {
    if (!hasPoint(r)) continue;
    features.push({type: 'Feature', geometry: {type: 'Point', coordinates: [r.longitude, r.latitude]}, properties: {k: r.id, s: r.series}});
  }
  return {type: 'FeatureCollection', features};
}

/** Compact display-only slots for co-located anchors (bounded offset; caller supplies visible anchors). */
export function separatePins(points, bounds, spacing = 8, {minSpacing = 0.5, maxOffset = 36} = {}) {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.id.localeCompare(b.id));
  for (let pitch = spacing; pitch >= minSpacing; pitch = pitch > 2 ? pitch - 1 : pitch / 2) {
    const offsets = [], used = new Map(), placed = [];
    const ring = Math.ceil(maxOffset / pitch);
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      const x = dx * pitch, y = dy * pitch, d = x * x + y * y;
      if (d <= maxOffset * maxOffset + 0.001) offsets.push({x, y, d});
    }
    offsets.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    const collision = (x, y) => {
      const cx = Math.floor(x / pitch), cy = Math.floor(y / pitch);
      for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) {
        for (const q of used.get(`${a},${b}`) || []) if (Math.abs(x - q.x) < pitch - 0.001 && Math.abs(y - q.y) < pitch - 0.001) return true;
      }
      return false;
    };
    for (const p of sorted) {
      let found = null;
      for (const o of offsets) {
        const x = p.x + o.x, y = p.y + o.y, box = pointBox(x, y, pitch);
        if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom ||
            (bounds.exclusions || []).some(b => intersects(box, b)) || collision(x, y)) continue;
        found = {...p, x, y, anchorX: p.x, anchorY: p.y, spacing: pitch};
        break;
      }
      if (!found) break;
      placed.push(found);
      const key = `${Math.floor(found.x / pitch)},${Math.floor(found.y / pitch)}`;
      if (!used.has(key)) used.set(key, []);
      used.get(key).push(found);
    }
    if (placed.length === sorted.length) return placed;
  }
  throw new Error('Local viewport is too small for individual pins');
}

/**
 * Chain logo labels: each chain gets a turn before repeated branches; a label is
 * accepted only when it clears every other mark, obstacle and label.
 * Returns Map<id, {x, y, width, height, box}>.
 */
export function placeBrandLogos(points, bounds, {limit = MAX_LOGOS, width = 60, height = 30, maxOffset = 64, selectedId = '', areaFraction = 0.12} = {}) {
  const result = new Map(), labels = [];
  const cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2;
  const budget = Math.min(MAX_LOGOS, Math.max(0, limit), Math.floor(((bounds.right - bounds.left) * (bounds.bottom - bounds.top) * areaFraction) / (width * height)));
  const candidates = points.filter(p => p.brandKey && p.hasLogo !== false).sort((a, b) =>
    Number(b.id === selectedId) - Number(a.id === selectedId) ||
    ((a.anchorX - cx) ** 2 + (a.anchorY - cy) ** 2) - ((b.anchorX - cx) ** 2 + (b.anchorY - cy) ** 2) || a.id.localeCompare(b.id));
  const offsets = [[0, -height / 2 - 8], [0, height / 2 + 8], [width / 2 + 8, 0], [-width / 2 - 8, 0], [width / 2 + 8, -height / 2 - 8], [-width / 2 - 8, -height / 2 - 8], [width / 2 + 8, height / 2 + 8], [-width / 2 - 8, height / 2 + 8], [0, -height - 14], [0, height + 14]];
  const tryPlace = p => {
    if (result.size >= budget) return false;
    const labelHeight = p.logoRatio ? Math.min(height, Math.max(18, width / p.logoRatio)) : height;
    for (const [dx, dy] of offsets) {
      if (Math.hypot(dx, dy) > maxOffset) continue;
      const x = p.anchorX + dx, y = p.anchorY + dy;
      const box = {left: x - width / 2, right: x + width / 2, top: y - labelHeight / 2, bottom: y + labelHeight / 2};
      if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom ||
          (bounds.exclusions || []).some(b => intersects(box, b, 5)) || labels.some(b => intersects(box, b, 9)) ||
          points.some(q => q.id !== p.id && intersects(box, pointBox(q.x, q.y, Math.max(3, q.spacing)), 3))) continue;
      labels.push(box);
      result.set(p.id, {x, y, width, height: labelHeight, box});
      return true;
    }
    return false;
  };
  const seen = new Set();
  for (const p of candidates) { if (seen.has(p.brandKey)) continue; if (tryPlace(p)) seen.add(p.brandKey); }
  for (const p of candidates) if (!result.has(p.id)) tryPlace(p);
  return result;
}

/** Nearest-first subset of rows inside the viewport (screen space), bounded. */
export function detailCandidates(rows, project, bounds, limit = MAX_DETAIL_PINS) {
  const cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2;
  const out = [];
  for (const r of rows) {
    if (!hasPoint(r)) continue;
    const p = project([r.longitude, r.latitude]);
    if (!isSourceVisible(p, bounds)) continue;
    out.push({row: r, x: p.x, y: p.y, d: (p.x - cx) ** 2 + (p.y - cy) ** 2});
  }
  out.sort((a, b) => a.d - b.d || a.row.id.localeCompare(b.row.id));
  return out.slice(0, limit);
}

/**
 * Mount the pin layers on a MapLibre map (call after style.load) and the HTML
 * detail overlay on its container. options.onSelect(row) on activation;
 * options.onLayout(stats) after each layout.
 */
export function installRestaurantPins(map, container, {onSelect, onLayout, reservedBottom = () => 90} = {}) {
  let focusRows = [], contextRows = [], focusById = new Map(), contextById = new Map(), selectedId = '', hoveredId = '', activeId = '', entries = [], frame = 0, detailKeys = [];
  const rowOf = id => focusById.get(id) || contextById.get(id);

  map.addSource(SOURCES.context, {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
  map.addSource(SOURCES.focus, {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
  map.addSource(SOURCES.selected, {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
  installCueIcons(map);
  map.addLayer({id: PIN_LAYERS.context, type: 'circle', source: SOURCES.context,
    paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 11, 1.1, 14, 2, 17, 3.2],
      'circle-color': cssVar('--text-muted', '#7B877D'), 'circle-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.35, 13, 0.55]}});
  // One symbol per row: the series cue icon (fill + shape), never clustered; overlap allowed so no row is hidden.
  map.addLayer({id: PIN_LAYERS.focus, type: 'symbol', source: SOURCES.focus,
    layout: {'icon-image': ['concat', 'restaurant-cue-', ['to-string', ['get', 's']]],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.2, 11, 0.32, 13, 0.46, 15, 0.62, 17, 0.8],
      'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-padding': 0, 'symbol-z-order': 'source'}});
  map.addLayer({id: PIN_LAYERS.selected, type: 'circle', source: SOURCES.selected,
    paint: {'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': cssVar('--map-selected-stroke', '#176B82'), 'circle-stroke-width': 2.5}});

  const overlay = document.createElement('div');
  overlay.className = 'store-pin-overlay';
  overlay.setAttribute('aria-label', 'หมุดร้าน ใช้ลูกศรเลือกหมุดถัดไป');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('pin-leaders');
  svg.setAttribute('aria-hidden', 'true');
  const leader = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  const anchor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  anchor.setAttribute('r', '3');
  svg.append(leader, anchor);
  overlay.append(svg);
  container.append(overlay);

  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
  // While the camera moves, pins keep their last slot (offset from their own anchor) and only follow the
  // map: no candidate search, slot separation, logo placement or chrome measuring per frame (an
  // area-to-area move stays one smooth animation). The full layout runs again when the move ends.
  let moving = false, placement = new Map();
  const onMoveStart = () => { moving = true; };
  const onMoveEnd = () => { moving = false; schedule(); };
  function followLayout() {
    if (map.getZoom() < DETAIL_MIN_ZOOM) return false;
    const w = container.clientWidth, h = container.clientHeight;
    for (const e of entries) {
      const slot = placement.get(e.row.id);
      if (!slot) { e.button.hidden = true; continue; }
      const p = map.project([e.row.longitude, e.row.latitude]);
      const x = p.x + slot.dx, y = p.y + slot.dy, off = !(x > 0 && y > 0 && x < w && y < h);
      e.button.hidden = off;
      if (!off) { e.button.style.left = `${x}px`; e.button.style.top = `${y}px`; }
      if (e.row.id === (hoveredId || selectedId)) {
        for (const [k, v] of Object.entries({x1: p.x, y1: p.y, x2: x, y2: y})) leader.setAttribute(k, v);
        anchor.setAttribute('cx', p.x); anchor.setAttribute('cy', p.y);
      }
    }
    return true;
  }

  function bounds() {
    const width = container.clientWidth, height = container.clientHeight;
    const panel = container.closest('.map-panel'), rect = container.getBoundingClientRect();
    const obstacle = e => { const b = e.getBoundingClientRect(); return {left: b.left - rect.left - 3, right: b.right - rect.left + 3, top: b.top - rect.top - 3, bottom: b.bottom - rect.top + 3}; };
    const blockers = panel ? [...panel.querySelectorAll('.map-toolbar button, .area-label:not([hidden]), .map-legend, .map-status, .map-aha, .maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-right, .maplibregl-ctrl-bottom-left')]
      .filter(e => e.offsetWidth && e.offsetHeight).map(obstacle) : [];
    return {left: 5, right: width - 5, top: 5, bottom: Math.max(6, height - reservedBottom()), exclusions: blockers};
  }

  function clearDetail() {
    for (const e of entries) e.button.remove();
    entries = [];
    placement = new Map();
    if (detailKeys.length) { detailKeys = []; if (map.getLayer(PIN_LAYERS.focus)) map.setFilter(PIN_LAYERS.focus, null); }
  }

  function layout() {
    if (moving && entries.length && placement.size && followLayout()) return;
    const zoom = map.getZoom();
    const b = bounds();
    if (zoom < DETAIL_MIN_ZOOM) {
      clearDetail();
      svg.style.display = 'none';
      report(0, 0, b);
      return;
    }
    const picked = detailCandidates(focusRows, p => map.project(p), b);
    const keys = picked.map(p => p.row.id);
    // Rebuild buttons only when the set changes; positions update every frame.
    if (keys.join('|') !== entries.map(e => e.row.id).join('|')) {
      for (const e of entries) e.button.remove();
      entries = picked.map(p => makeEntry(p.row));
      detailKeys = keys;
      map.setFilter(PIN_LAYERS.focus, keys.length ? ['!', ['in', ['get', 'k'], ['literal', keys]]] : null);
    }
    const projected = entries.map(e => { const p = map.project([e.row.longitude, e.row.latitude]); return {id: e.row.id, x: p.x, y: p.y, entry: e, brandKey: e.brandKey, hasLogo: e.hasLogo, logoRatio: e.logoRatio}; });
    let placed;
    const pitch = zoom >= 16.5 ? 13 : 11;
    try { placed = separatePins(projected, b, pitch, {minSpacing: 0.25, maxOffset: 44}); }
    catch { placed = projected.map(p => ({...p, anchorX: p.x, anchorY: p.y, spacing: 1})); }
    const labels = placeBrandLogos(placed, b, {selectedId, width: zoom >= 16.5 ? 68 : 60, height: zoom >= 16.5 ? 34 : 30});
    const ids = placed.map(p => p.id);
    if (!ids.includes(activeId)) activeId = ids[0] || '';
    for (const p of placed) {
      const {button, label} = p.entry;
      button.hidden = false;
      button.style.left = `${p.x}px`;
      button.style.top = `${p.y}px`;
      button.style.setProperty('--pin-size', `${Math.max(6, Math.min(pitch, p.spacing))}px`);
      button.tabIndex = p.id === activeId ? 0 : -1;
      button.dataset.displaced = String(Math.hypot(p.x - p.anchorX, p.y - p.anchorY) > 2);
      const l = labels.get(p.id);
      button.classList.toggle('has-logo', !!l);
      label.hidden = !l;
      if (l) { label.style.left = `${l.x - p.x}px`; label.style.top = `${l.y - p.y}px`; label.style.width = `${l.width}px`; label.style.height = `${l.height}px`; }
    }
    placement = new Map(placed.map(p => [p.id, {dx: p.x - p.anchorX, dy: p.y - p.anchorY}]));
    const focus = placed.find(p => p.id === (hoveredId || selectedId));
    svg.style.display = focus ? '' : 'none';
    if (focus) {
      for (const [k, v] of Object.entries({x1: focus.anchorX, y1: focus.anchorY, x2: focus.x, y2: focus.y})) leader.setAttribute(k, v);
      anchor.setAttribute('cx', focus.anchorX); anchor.setAttribute('cy', focus.anchorY);
    }
    report(placed.length, labels.size, b);
  }

  function report(htmlPins, logos, b) {
    let inView = 0;
    const view = map.getBounds?.();
    if (view) for (const r of focusRows) if (r.longitude >= view.getWest() && r.longitude <= view.getEast() && r.latitude >= view.getSouth() && r.latitude <= view.getNorth()) inView++;
    overlay.dataset.visiblePins = String(htmlPins);
    overlay.dataset.visibleLogos = String(logos);
    onLayout?.({focusInView: inView, htmlPins, visibleLogos: logos, logoLimit: MAX_LOGOS, contextRows: contextOnly, zoom: map.getZoom()});
  }

  function makeEntry(row) {
    const logo = getBrandLogo(row.brand);
    const button = document.createElement('button'), label = document.createElement('span'), dot = document.createElement('span');
    button.type = 'button';
    button.className = 'store-pin';
    button.dataset.storeId = row.id;
    button.dataset.category = String(row.series);
    const text = `${row.name}${row.brand ? ' · ' + row.brand.name : ''}${row.type ? ' · ' + row.type : ''}`;
    button.setAttribute('aria-label', text);
    button.title = text;
    dot.className = 'pin-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.innerHTML = cueMarkup(row.series);
    label.className = 'pin-brand-label';
    label.hidden = true;
    label.setAttribute('aria-hidden', 'true');
    label.innerHTML = logo ? brandLogoMarkup(row.brand, {size: 'xs'}) : '';
    button.append(dot, label);
    button.classList.toggle('is-selected', row.id === selectedId);
    button.onclick = () => { select(row.id); onSelect?.(row); };
    button.onmouseenter = () => { hoveredId = row.id; schedule(); };
    button.onmouseleave = () => { hoveredId = ''; schedule(); };
    button.onfocus = () => { activeId = row.id; hoveredId = row.id; for (const e of entries) e.button.tabIndex = e.row.id === activeId ? 0 : -1; schedule(); };
    button.onblur = () => { hoveredId = ''; schedule(); };
    button.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const visible = entries.filter(e => !e.button.hidden), i = visible.findIndex(e => e.row.id === row.id);
      const j = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : (i + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + visible.length) % visible.length;
      visible[j]?.button.focus();
    };
    overlay.append(button);
    return {row, button, label, brandKey: logo ? row.brand.id : '', hasLogo: Boolean(logo), logoRatio: logo ? Math.max(1, logo.ratio) : 2};
  }

  /**
   * focus = rows with detail; context = the whole filtered scope as quiet dots (not in the tab
   * order, not clickable). Focus symbols are drawn above and cover their own dot, so the context
   * only changes with the filters: a selection (area, venue, building, store) re-sends the focus
   * rows only and never the tens of thousands of context points (smooth area-to-area moves).
   * On the first draw a large context is handed to the worker a moment after the focus, so the
   * focused pins and the area fills are not queued behind its index build.
   */
  let contextTimer = 0, firstContext = true, sentContext = null, contextOnly = 0;
  function update(focus, {context = []} = {}) {
    focusRows = focus.filter(hasPoint);
    focusById = new Map(focusRows.map(r => [r.id, r]));
    if (context !== contextRows) { contextRows = context; contextById = new Map(contextRows.map(r => [r.id, r])); }
    contextOnly = Math.max(0, contextRows.length - focusRows.filter(r => contextById.has(r.id)).length);
    map.getSource(SOURCES.focus)?.setData(pointCollection(focusRows));
    clearTimeout(contextTimer);
    const sendContext = () => { firstContext = false; sentContext = contextRows; map.getSource(SOURCES.context)?.setData(pointCollection(contextRows)); };
    if (sentContext !== contextRows) {
      if (firstContext && contextRows.length > 5000) contextTimer = setTimeout(sendContext, 900);
      else sendContext();
    }
    clearDetail();
    schedule();
  }

  function select(id) {
    selectedId = id || '';
    const r = rowOf(selectedId);
    map.getSource(SOURCES.selected)?.setData(r ? pointCollection([r]) : {type: 'FeatureCollection', features: []});
    for (const e of entries) e.button.classList.toggle('is-selected', e.row.id === selectedId);
    schedule();
  }

  /**
   * The focus row under a screen point, or null. Quiet context dots are not targets: a click in
   * the quiet context goes to the area underneath (move to that แขวง/ตำบล), never to a random row.
   * `{context: true}` also tests the dots (diagnostics only).
   */
  function hitTest(point, {radius = 6, context = false} = {}) {
    const box = [[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]];
    const hits = map.queryRenderedFeatures(box, {layers: [PIN_LAYERS.focus, ...(context ? [PIN_LAYERS.context] : [])].filter(id => map.getLayer(id))});
    let best = null, bestD = Infinity;
    for (const f of hits) {
      const r = f.layer.id === PIN_LAYERS.focus ? focusById.get(f.properties?.k) : contextById.get(f.properties?.k);
      if (!r) continue;
      const p = map.project([r.longitude, r.latitude]), d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2 + (f.layer.id === PIN_LAYERS.focus ? 0 : 4);
      if (d < bestD) { bestD = d; best = r; }
    }
    return best;
  }

  function retheme() {
    installCueIcons(map);
    if (map.getLayer(PIN_LAYERS.context)) map.setPaintProperty(PIN_LAYERS.context, 'circle-color', cssVar('--text-muted', '#7B877D'));
    if (map.getLayer(PIN_LAYERS.selected)) map.setPaintProperty(PIN_LAYERS.selected, 'circle-stroke-color', cssVar('--map-selected-stroke', '#176B82'));
  }

  map.on('move', schedule);
  map.on('resize', schedule);
  map.on('movestart', onMoveStart);
  map.on('moveend', onMoveEnd);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  resize?.observe(container);
  function dispose() {
    cancelAnimationFrame(frame);
    clearTimeout(contextTimer);
    map.off('move', schedule); map.off('resize', schedule); map.off('movestart', onMoveStart); map.off('moveend', onMoveEnd); resize?.disconnect(); overlay.remove();
    for (const id of Object.values(PIN_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of Object.values(SOURCES)) if (map.getSource(id)) map.removeSource(id);
    for (let i = 1; i <= 10; i++) if (map.hasImage(ICON(i))) map.removeImage(ICON(i));
  }
  return {update, select, layout: schedule, hitTest, retheme, dispose, layerIds: PIN_LAYERS};
}

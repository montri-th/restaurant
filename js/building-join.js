/**
 * Restaurant display points × building footprints — a display-time spatial join
 * (owner decision 2026-10-23: "spatial join กับ 3d building mass").
 *
 * Buildings are the ones the map draws: the focus-tier OpenStreetMap footprints
 * (js/massing.js keeps each original footprint, before rounding/offset) and the
 * official host buildings of the venue candidates (js/buildings.js). A row joins a
 * building when its DISPLAY point (public API, MVT z10 grid ≈ 9.55 m) lies inside
 * the footprint; inside several (an OSM part inside an outline) → the smallest.
 *
 * What it is: "จุดของร้านตกในอาคาร" — the point the API shows falls inside the
 * outline. What it is not: a verified located-inside relationship, an address, a
 * floor or a unit. Venue membership stays the name-based link (venue_id is the
 * only join key); the spatial result only (a) picks which drawn buildings belong
 * to a venue on screen, (b) answers a click on a building and (c) lists the other
 * rows whose points fall in the same building, always labelled as such.
 */
import {pointInRing} from './geometry.js';

/** A building is a venue's when it holds ≥ max(1, ⌈share × n⌉) of the venue's joined points. */
export const VENUE_SHARE = 0.2;
/** Grid cell (degrees, ≈ 165 m) of the bbox index. */
const CELL = 0.0015;

const bboxOf = ring => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
};
/** Planar area in degree² (only compared between nearby footprints). */
const areaOf = ring => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
};

/**
 * Normalise a footprint: {key, outer, holes?, venueIds?, height?, base?, kind?, ref?}.
 * `key` must be unique across the join ('osm:<id>' or 'host:<n>').
 */
export function footprint(b) {
  const outer = b.outer, holes = b.holes || [];
  return {...b, holes, bbox: b.bbox || bboxOf(outer), area: areaOf(outer)};
}

export function containsPoint(b, [x, y]) {
  const [w, s, e, n] = b.bbox;
  if (x < w || x > e || y < s || y > n) return false;
  if (!pointInRing([x, y], b.outer)) return false;
  return !b.holes.some(h => pointInRing([x, y], h));
}

function indexOf(buildings) {
  const cells = new Map();
  for (const b of buildings) {
    const [w, s, e, n] = b.bbox;
    for (let i = Math.floor(w / CELL); i <= Math.floor(e / CELL); i++) {
      for (let j = Math.floor(s / CELL); j <= Math.floor(n / CELL); j++) {
        const k = `${i}:${j}`;
        const list = cells.get(k);
        if (list) list.push(b); else cells.set(k, [b]);
      }
    }
  }
  return cells;
}

/**
 * Join rows (with longitude/latitude) to footprints.
 * Returns {buildings: Map(key → footprint), byBuilding: Map(key → rows[]), byRow: Map(rowId → key)}.
 */
export function joinRows(footprints, rows) {
  const list = footprints.map(footprint);
  const buildings = new Map(list.map(b => [b.key, b]));
  const cells = indexOf(list);
  const byBuilding = new Map(), byRow = new Map();
  for (const r of rows) {
    const x = r.longitude, y = r.latitude;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const candidates = cells.get(`${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`);
    if (!candidates) continue;
    let best = null;
    for (const b of candidates) if ((!best || b.area < best.area) && containsPoint(b, [x, y])) best = b;
    if (!best) continue;
    byRow.set(r.id, best.key);
    const at = byBuilding.get(best.key);
    if (at) at.push(r); else byBuilding.set(best.key, [r]);
  }
  return {buildings, byBuilding, byRow};
}

/**
 * Buildings of each venue on screen → Map(venueId → keys[]).
 * Official host footprints (venueIds from the sheet join) are the venue's own building
 * whenever they are drawn. For a venue without one, the OSM buildings holding at
 * least max(1, ⌈share × n⌉) of its n joined name-linked rows (strays in a neighbour
 * building are left out).
 */
export function venueBuildings(join, {share = VENUE_SHARE, hosted = new Set()} = {}) {
  const out = new Map(), counts = new Map();
  for (const [key, b] of join.buildings) for (const id of b.venueIds || []) {
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(key);
  }
  for (const [key, rows] of join.byBuilding) {
    if (join.buildings.get(key)?.venueIds?.length) continue;
    for (const r of rows) {
      const id = r.venue?.id;
      if (!id || hosted.has(id)) continue;
      if (!counts.has(id)) counts.set(id, new Map());
      const m = counts.get(id);
      m.set(key, (m.get(key) || 0) + 1);
    }
  }
  for (const [id, m] of counts) {
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    const need = Math.max(1, Math.ceil(share * n));
    const keys = [...m].filter(([, c]) => c >= need).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
    if (keys.length) out.set(id, keys);
  }
  return out;
}

/** Inverse of venueBuildings: Map(key → venueIds[]). */
export function buildingVenues(venueKeys) {
  const out = new Map();
  for (const [id, keys] of venueKeys) for (const k of keys) { if (!out.has(k)) out.set(k, []); out.get(k).push(id); }
  return out;
}

/**
 * What a click on a building opens:
 *  {kind: 'venue', id} — the building is a venue's on screen (most of its own rows here);
 *  {kind: 'store', id} — one row's point falls inside;
 *  {kind: 'building', key, rows} — several rows, no venue;
 *  null — no row: the click falls through (area selection).
 */
export function resolveBuilding(key, join, keyVenues) {
  const rows = join.byBuilding.get(key) || [];
  const venues = keyVenues.get(key) || [];
  if (venues.length) {
    const own = id => rows.filter(r => r.venue?.id === id).length;
    const id = [...venues].sort((a, b) => own(b) - own(a) || (a < b ? -1 : 1))[0];
    return {kind: 'venue', id};
  }
  if (rows.length === 1) return {kind: 'store', id: rows[0].id};
  if (rows.length > 1) return {kind: 'building', key, rows};
  return null;
}

/**
 * Rows whose points fall in a venue's buildings but whose name does not link them to it
 * ("ร้านอื่นที่จุดตกในอาคารเดียวกัน"), plus how many of the venue's own rows fall there.
 */
export function venueNeighbours(venueId, join, venueKeys) {
  const keys = venueKeys.get(venueId) || [];
  const others = [], seen = new Set();
  let own = 0;
  for (const k of keys) for (const r of join.byBuilding.get(k) || []) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (r.venue?.id === venueId) own++; else others.push(r);
  }
  return {buildings: keys.length, own, others};
}

/** The region (one lon/lat rectangle) around a venue's rows for the focus tier: core cluster + buffer. */
export function venueRegion(points, {bufferM = 150, coreM = 700} = {}) {
  const valid = points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!valid.length) return null;
  const median = i => { const v = valid.map(p => p[i]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const m = [median(0), median(1)];
  const kx = 111320 * Math.cos((m[1] * Math.PI) / 180), ky = 110574;
  const core = valid.filter(p => Math.hypot((p[0] - m[0]) * kx, (p[1] - m[1]) * ky) <= coreM);
  const [w, s, e, n] = bboxOf(core.length ? core : [m]);
  const dx = bufferM / kx, dy = bufferM / ky;
  return [[w - dx, s - dy], [e + dx, s - dy], [e + dx, n + dy], [w - dx, n + dy], [w - dx, s - dy]];
}

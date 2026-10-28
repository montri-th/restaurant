/**
 * Land hosts and their buildings (data/land.json + data/land-buildings.geojson, scripts/build-land.py).
 *
 * The registry's Land datasets — shopping centres & retail venues, hotels, office
 * buildings — are hosts: places that can hold restaurants. A host's building is the registry's own reviewed
 * geometry when it has one (with its building parts, LOD > 1, drawn instead of one block), else the CityMETER
 * production V4 footprint at the host's point. The 2026-10-28 check joins
 * every restaurant display point (≈ 9.55 m grid) and every chain-register outlet point
 * to the Land building outlines: in (inside), edge (≤ 10 m — within the coordinate's own
 * uncertainty) or near (≤ 100 m). Wording is always “จุดตกในอาคาร” / “ติดขอบอาคาร” /
 * “รอบอาคาร” — never “ตั้งอยู่ใน”: a point inside an outline is not a tenancy, floor or
 * located-in claim, and no count of the snapshot or the register changes because of it.
 */
export const LAND_DATASETS = Object.freeze({shopping: 'ศูนย์การค้าและสถานที่ค้าปลีก', hotel: 'โรงแรมและที่พัก', office: 'อาคารสำนักงาน'});
export const RELATIONS = Object.freeze(['in', 'edge', 'near']);
export const RELATION_TH = Object.freeze({in: 'จุดตกในอาคาร', edge: 'ติดขอบอาคาร (ไม่เกิน 10 ม.)', near: 'รอบอาคาร (ไม่เกิน 100 ม.)'});

const HOTEL_TYPES = {hotel: 'โรงแรม', resort: 'รีสอร์ต', guesthouse: 'เกสต์เฮาส์', motel: 'โมเต็ล', serviced_apartment: 'เซอร์วิสอพาร์ตเมนต์',
  homestay: 'โฮมสเตย์', bungalow: 'บังกะโล', youth_lodging: 'โฮสเทล'};

/** Thai type label of a Land host (presentation only; the registry type stays in `type`). */
export function landTypeTh(ds, type = '') {
  const t = String(type || '');
  if (ds === 'office') return 'อาคารสำนักงาน';
  if (ds === 'hotel') return HOTEL_TYPES[t] || 'ที่พัก';
  if (/fuel_station/.test(t)) return 'สถานีบริการน้ำมัน';
  if (/night_market|walking_street|weekend|periodic/.test(t)) return 'ตลาดนัด';
  if (/supermarket|hypermarket|grocery|foodplace|wholesale_store/.test(t)) return 'ซูเปอร์มาร์เก็ต / ไฮเปอร์มาร์เก็ต';
  if (/market/.test(t)) return 'ตลาด';
  if (/community/.test(t)) return 'คอมมูนิตี้มอลล์';
  if (/shopping_center|mall|outlet|power_center|department_store|retail_complex|plaza|entertainment/.test(t)) return 'ศูนย์การค้า';
  if (/travel_retail|terminal|airport/.test(t)) return 'ค้าปลีกในจุดพักรถหรือสถานี';
  if (t === 'unclassified') return 'สถานที่ค้าปลีก (ยังไม่จัดประเภท)';
  return 'สถานที่ค้าปลีก';
}

/**
 * Decode the join. Returns hosts, the building of each host, and per-point relations:
 * rowLinks / outletLinks: key → [{building, rel, d}, …] (primary first, then nested buildings that also contain the
 * point); rowRel / outletRel: key → the primary relation; rowsByBuilding / outletsByBuilding: building → keys.
 */
export function decodeLand(json, buildingsGeo) {
  if (!json || !Array.isArray(json.hosts)) return null;
  const features = buildingsGeo?.features || [];
  // One building feature per Land building (its join outline; extruded when it is a single LOD1 block) and, when the
  // registry has building parts (LOD > 1, owner rule 2026-10-28), part features extruded from their own base to top.
  const isPart = f => f.properties?.geometry_role === 'land_host_building_part';
  const buildings = new Map(features.filter(f => !isPart(f)).map(f => [Number(f.properties?.building ?? f.id ?? f.properties?.id), f]));
  const parts = new Map();
  for (const f of features) if (isPart(f)) { const b = Number(f.properties.building); if (!parts.has(b)) parts.set(b, []); parts.get(b).push(f); }
  const hosts = json.hosts.map((h, i) => ({...h, index: i, kind: 'land', typeTh: landTypeTh(h.ds, h.type), datasetTh: LAND_DATASETS[h.ds] || 'Land'}));
  const hostById = new Map(hosts.map(h => [h.id, h]));
  const hostsByBuilding = new Map();
  for (const h of hosts) if (h.fp >= 0) { if (!hostsByBuilding.has(h.fp)) hostsByBuilding.set(h.fp, []); hostsByBuilding.get(h.fp).push(h); }
  // One row per (point, building): the primary relation (smallest containing building, else the nearest edge) first,
  // then every other Land building that also contains the point (an office tower or supermarket inside a mall).
  const links = list => {
    const m = new Map();
    for (const [k, b, r, d] of list || []) { if (!m.has(k)) m.set(k, []); m.get(k).push({building: b, rel: RELATIONS[r] || 'near', d}); }
    return m;
  };
  const rowLinks = links(json.snapshot), outletLinks = links(json.chains);
  const first = m => new Map([...m].map(([k, v]) => [k, v[0]]));
  const byBuilding = m => { const out = new Map(); for (const [k, list] of m) for (const v of list) { if (!out.has(v.building)) out.set(v.building, []); out.get(v.building).push(k); } return out; };
  return {meta: json.meta || {}, hosts, hostById, hostsByBuilding, buildings, parts, rowLinks, outletLinks,
    rowRel: first(rowLinks), outletRel: first(outletLinks), rowsByBuilding: byBuilding(rowLinks), outletsByBuilding: byBuilding(outletLinks)};
}

/* ---------- geometry (planar, equirectangular metres at the point's latitude; buildings are small) ---------- */

const polygonsOf = g => (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []);
function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Point inside a (Multi)Polygon geometry (holes excluded). */
export function geometryContains(g, [x, y]) {
  return polygonsOf(g).some(p => ringContains(p[0], x, y) && !p.slice(1).some(h => ringContains(h, x, y)));
}
/** Distance in metres from a point to the outline of a (Multi)Polygon (0 inside). */
export function distanceToGeometry(g, [x, y]) {
  if (geometryContains(g, [x, y])) return 0;
  const kx = 111320 * Math.cos((y * Math.PI) / 180), ky = 110574;
  let best = Infinity;
  for (const p of polygonsOf(g)) for (const ring of p) for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - x) * kx, ay = (ring[i - 1][1] - y) * ky, bx = (ring[i][0] - x) * kx, by = (ring[i][1] - y) * ky;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
/** Bounding box [w, s, e, n] of a (Multi)Polygon geometry. */
export function geometryBounds(g) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of polygonsOf(g)) for (const [x, y] of p[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}
/** Items (with longitude/latitude) within `metres` of the outline, outside it — the ring around a building. */
export function aroundGeometry(g, items, metres = 100, exclude = null) {
  const [w, s, e, n] = geometryBounds(g);
  const pad = metres / 108000;
  const out = [];
  for (const it of items) {
    const x = it.longitude, y = it.latitude;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < w - pad * 1.1 || x > e + pad * 1.1 || y < s - pad || y > n + pad) continue;
    if (exclude?.has(it.id)) continue;
    const d = distanceToGeometry(g, [x, y]);
    if (d > 10 && d <= metres) out.push(it);
  }
  return out;
}
/** The Land building whose outline contains a point (smallest first), or null. */
export function landBuildingAt(land, point) {
  let best = null, area = Infinity;
  for (const [id, f] of land?.buildings || []) {
    const [w, s, e, n] = geometryBounds(f.geometry);
    if (point[0] < w || point[0] > e || point[1] < s || point[1] > n) continue;
    if (!geometryContains(f.geometry, point)) continue;
    const a = (e - w) * (n - s);
    if (a < area) { area = a; best = id; }
  }
  return best;
}

/** Hosts of a building, the main one first (shopping, then office, then hotel; larger name first is not implied). */
export function hostsOf(land, building) {
  const order = {shopping: 0, office: 1, hotel: 2};
  return [...(land?.hostsByBuilding.get(building) || [])].sort((a, b) => (order[a.ds] ?? 3) - (order[b.ds] ?? 3) || a.name.localeCompare(b.name, 'th'));
}

/** The Land relation of a snapshot row (by key) or a register outlet (by id): the primary building with its hosts,
 * and `also` — the other buildings that contain the same point (nested buildings), each with its hosts. */
function relationOf(land, list) {
  if (!list?.length) return null;
  const [r, ...rest] = list;
  return {...r, hosts: hostsOf(land, r.building), also: rest.map(x => ({...x, hosts: hostsOf(land, x.building)}))};
}
export const landOfRow = (land, key) => relationOf(land, land?.rowLinks?.get(key));
export const landOfOutlet = (land, id) => relationOf(land, land?.outletLinks?.get(id));

/**
 * Profile of one Land host: snapshot rows and register outlets in / at the edge of / around its building.
 * rowsByKey: Map key → snapshot row (decoded), outletsById: Map id → register outlet.
 */
export function landProfile(land, host, {rowsByKey, outletsById, scopeKeys = null} = {}) {
  if (!land || !host) return null;
  const building = host.fp;
  // The relation of each point to THIS building (a nested point is “in” every building that contains it).
  const split = (keys, lookup, linkMap, scoped) => {
    const out = {in: [], edge: [], near: []};
    for (const k of keys || []) {
      const item = lookup.get(k);
      if (!item || (scoped && scopeKeys && !scopeKeys.has(k))) continue;
      const link = (linkMap.get(k) || []).find(x => x.building === building);
      if (link) out[link.rel].push(item);
    }
    return out;
  };
  const rows = building >= 0 ? split(land.rowsByBuilding.get(building), rowsByKey, land.rowLinks, true) : {in: [], edge: [], near: []};
  const outlets = building >= 0 && outletsById ? split(land.outletsByBuilding.get(building), outletsById, land.outletLinks, false) : {in: [], edge: [], near: []};
  return {host, building, feature: land.buildings.get(building) || null, parts: land.parts?.get(building) || [],
    cohosts: hostsOf(land, building).filter(h => h.id !== host.id), rows, outlets};
}

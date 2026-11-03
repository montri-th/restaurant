/**
 * Outbound searches with the context of the view (owner 2026-10-29 “google search AI mode, streetview, search ด้วย
 * context ที่ relevant กับเสียงในหัวของ user ในขณะนั้น”): each view offers the questions its users are likely holding
 * (Product Statement §2.1 triggers — expansion, leasing, analyst) pre-filled for Google, a Street View at the point,
 * and a Google Maps search. Pure URL builders; the targets are public URL schemes (Google Maps URLs, Google Search).
 * Nothing here is evidence: the panel labels the row “ค้นต่อ” and keeps every number of the product unchanged.
 *
 * 0.8.1 (owner 2026-11-03 07:20 “คลิกแล้วไม่ได้คำตอบทันทีต้องมาคลิก dialogue นี้ก่อน … Streetview ก็ให้หันกล้องไปให้เจอ
 * หน้าร้านทุกครั้ง”):
 *  - The questions open Google Search, not AI Mode (`udm=50`). Google asks “Continue with this search?” before it
 *    runs an AI Mode question that arrives through a link — its own safety check, which a page must not try to get
 *    around. A search link opens at once with Google's AI Overview on top when Google has one, and Google's own
 *    AI Mode tab continues the same question without the check (both seen in Chrome on 3 Nov 2026).
 *  - Street View looks at the place: the camera stands on the street the place's own name or address mentions when it
 *    is about as near as the nearest street, else on the nearest street of the map's own road data, and turns toward
 *    the point (`aimCamera`). The store's Google Maps link opens the business (name + area), whose card shows the
 *    storefront. The point is a display position (restaurants ≈ 9.55 m grid) or a publisher
 *    point, so the view faces the place, not a surveyed shop door; without a street within reach the link keeps
 *    Google's default view at the point.
 */
const q = s => encodeURIComponent(String(s || '').replace(/\s+/g, ' ').trim());
const fix = v => Number(v).toFixed(6);

export const googleSearch = query => `https://www.google.com/search?q=${q(query)}`;
/** Kept for links of 0.7.x; the row no longer uses it (see above). */
export const googleAI = query => `https://www.google.com/search?udm=50&q=${q(query)}`;
/** Street View at a point; with a camera ({lat, lng, heading}) the panorama nearest the camera, turned toward the point. */
export const streetView = (lat, lng, camera = null) => camera
  ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${fix(camera.lat)}%2C${fix(camera.lng)}&heading=${Math.round(camera.heading)}&pitch=5&fov=80`
  : `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${fix(lat)}%2C${fix(lng)}`;
export const mapsSearch = query => `https://www.google.com/maps/search/?api=1&query=${q(query)}`;
export const mapsPoint = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${fix(lat)}%2C${fix(lng)}`;

/** Streets a Street View car drives (OpenMapTiles `transportation` classes); expressways, ramps, paths and rail are not. */
export const STREET_CLASSES = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'busway']);

/**
 * Street lines near a point from map features ({geometry, properties} of the `transportation` source layer, as
 * MapLibre's querySourceFeatures returns them): LineString parts whose bounding box comes within `radiusM`.
 */
export function streetLines(features = [], target, {radiusM = 200} = {}) {
  const dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.cos((target.lat * Math.PI) / 180));
  const out = [];
  for (const f of features) {
    const p = f?.properties || {};
    if (!STREET_CLASSES.has(p.class) || p.brunnel === 'tunnel' || Number(p.ramp) === 1) continue;
    const g = f.geometry || {};
    const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of parts) {
      if (!Array.isArray(line) || line.length < 2) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of line) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 >= target.lng - dLng && x0 <= target.lng + dLng && y1 >= target.lat - dLat && y0 <= target.lat + dLat) out.push(line);
    }
  }
  return out;
}

/** The distinctive part of a street name: no “Road / Soi / ถนน / ซอย …”, no spaces or punctuation, lower case. */
const LATIN_GENERIC = /\b(road|rd|street|st|soi|alley|lane|trok|thanon|avenue|ave|yaek)\b\.?/g;
const THAI_GENERIC = /(ถนน|ถ\.|ซอย|ซ\.|ตรอก|แยก)/g;
const squash = s => String(s || '').toLowerCase().normalize('NFC').replace(/[\s\-–—_.,·'’()\/]+/g, '');
export const streetCore = name => squash(String(name || '').toLowerCase().replace(LATIN_GENERIC, ' ').replace(THAI_GENERIC, ' '));
const longEnough = core => core.length >= (/[\u0E00-\u0E7F]/.test(core) ? 3 : 4);

/**
 * Named streets near a point that the place's own words mention (`hint`: its name, branch, the register's address):
 * a `transportation_name` feature whose name, English, Latin or Thai name — without the generic word — appears in the
 * hint. “Prime Burger Khaosan Road” finds “Khao San Road” / “ถนนข้าวสาร”. Area names are never part of a hint.
 */
export function namedStreetLines(features = [], target, hint = '', {radiusM = 200} = {}) {
  const text = squash(hint);
  if (!text) return [];
  const named = features.filter(f => {
    const p = f?.properties || {};
    if (!STREET_CLASSES.has(p.class) && !(p.class === 'path' && p.subclass === 'pedestrian')) return false;
    return [p.name, p['name:en'], p.name_en, p['name:latin'], p['name:th']].some(n => { const c = streetCore(n); return longEnough(c) && text.includes(c); });
  });
  // the class test above is done; keep the geometry filter of streetLines without its class filter
  return streetLines(named.map(f => ({...f, properties: {...f.properties, class: 'minor', brunnel: null, ramp: 0}})), target, {radiusM});
}

/**
 * The camera for a place: the street its own words name when that street is about as near as the nearest street
 * (within `slackM` more), else the nearest street. A corner shop named after one of its two streets faces that one.
 */
export function aimCamera(target, lines = [], named = [], {slackM = 30, maxM = 150, minM = 3} = {}) {
  const nearest = cameraToward(target, lines, {maxM, minM});
  const byName = named.length ? cameraToward(target, named, {maxM, minM}) : null;
  if (byName && (!nearest || byName.distance <= nearest.distance + slackM)) return {...byName, by: 'name'};
  return nearest ? {...nearest, by: 'nearest'} : null;
}

/**
 * Where to stand to look at a point: the nearest point on the given street lines ([[lng, lat], …]) and the compass
 * heading from there to the point. Null when no street lies within `maxM`, or the point sits on the street itself
 * (closer than `minM`: the side it faces is unknown) — the caller then keeps Google's default view.
 */
export function cameraToward(target, lines = [], {maxM = 150, minM = 3} = {}) {
  if (!Number.isFinite(target?.lat) || !Number.isFinite(target?.lng)) return null;
  const kx = ((Math.PI / 180) * 6371008.8) * Math.cos((target.lat * Math.PI) / 180), ky = (Math.PI / 180) * 6371008.8;
  let best = null;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const ax = (line[i - 1][0] - target.lng) * kx, ay = (line[i - 1][1] - target.lat) * ky;
      const bx = (line[i][0] - target.lng) * kx, by = (line[i][1] - target.lat) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py);
      if (!best || d < best.d) best = {d, px, py};
    }
  }
  if (!best || best.d > maxM || best.d < minM) return null;
  // From the camera (px, py) toward the target (0, 0): east = −px, north = −py; compass bearing clockwise from north.
  const heading = ((Math.atan2(-best.px, -best.py) * 180) / Math.PI + 360) % 360;
  return {lat: target.lat + best.py / ky, lng: target.lng + best.px / kx, heading, distance: best.d};
}

const hasPoint = c => Number.isFinite(c?.lat) && Number.isFinite(c?.lng);
const place = c => [c.area, c.district, c.province].filter(Boolean).join(' ');
const lower = s => String(s || '').toLowerCase();
/** Brand + branch without saying the brand twice (“Prime Burger” + “Prime Burger Khaosan Road”). */
const storeName = c => {
  const brand = c.brand || '', branch = c.branch && c.branch !== c.brand ? c.branch : '';
  if (!brand) return c.name || branch;
  if (branch && lower(branch).startsWith(lower(brand))) return branch;
  return [brand, branch].filter(Boolean).join(' ');
};

/**
 * Links for a context: {kind: 'store' | 'chain' | 'area' | 'district' | 'venue' | 'company' | 'country',
 * name, brand, branch, company, area, district, province, lat, lng, hint}. Returns [{kind, label, question, href, aim}];
 * `aim` = the point a Street View link turns toward (the panel lets the app place the camera when it is clicked).
 */
export function outboundFor(c = {}) {
  const out = [];
  const ask = (label, question) => out.push({kind: 'ai', label, question, href: googleSearch(question)});
  const street = aim => hasPoint(c) && out.push({kind: 'street', label: 'Street View', question: '', href: streetView(c.lat, c.lng), aim: aim ? {lat: c.lat, lng: c.lng, hint: String(c.hint || '').slice(0, 240)} : null});
  const name = c.name || c.brand || '';
  switch (c.kind) {
    case 'store': {
      const full = storeName(c);
      ask('Google · รีวิว เมนู เวลาเปิด', `${full} ${place(c)} รีวิว เมนู ราคา เวลาเปิด-ปิด`);
      street(true);
      // The business itself (0.8.1): Google's place card shows the storefront photo, hours and its own aimed Street View.
      out.push({kind: 'maps', label: 'Google Maps', question: `${full} ${place(c)}`, href: mapsSearch(`${full} ${place(c)}`)});
      break;
    }
    case 'chain':
      ask('Google · สาขาและข่าวล่าสุด', `${name} มีกี่สาขาในไทย สาขาใหม่ล่าสุด ข่าวการขยายสาขา`);
      ask('Google · แฟรนไชส์และคู่แข่ง', `${name} แฟรนไชส์ เงื่อนไข ค่าใช้จ่าย และแบรนด์คู่แข่งที่ใกล้เคียง`);
      out.push({kind: 'maps', label: 'Google Maps', question: '', href: mapsSearch(`${name} ${c.province || 'ประเทศไทย'}`)});
      break;
    case 'company':
      ask('Google · แบรนด์ในเครือ', `${name} แบรนด์ร้านอาหารในเครือ จำนวนสาขา และแผนขยายสาขา`);
      break;
    case 'area':
    case 'district':
      ask('Google · ร้านดังและราคาแถวนี้', `ร้านอาหารย่าน ${place(c)} มีร้านดังอะไรบ้าง ประเภทไหนเยอะ ราคาประมาณเท่าไร`);
      ask('Google · ทำเลและค่าเช่า', `ทำเลเปิดร้านอาหาร ${place(c)} ค่าเช่าพื้นที่ร้านอาหาร และกลุ่มลูกค้า`);
      street(false); // an area's label point is not a place to look at
      out.push({kind: 'maps', label: 'Google Maps', question: '', href: mapsSearch(`ร้านอาหาร ${place(c)}`)});
      break;
    case 'venue':
      ask('Google · ร้านในสถานที่นี้', `ร้านอาหารใน ${name} ${c.province || ''} มีร้านอะไรบ้าง ชั้นไหน ร้านใหม่ล่าสุด`);
      ask('Google · พื้นที่เช่า', `${name} พื้นที่เช่าร้านอาหาร ติดต่อฝ่ายขายพื้นที่ ค่าเช่า`);
      street(true);
      out.push({kind: 'maps', label: 'Google Maps', question: '', href: hasPoint(c) ? mapsPoint(c.lat, c.lng) : mapsSearch(`${name} ${c.province || ''}`)});
      break;
    case 'country':
    default:
      ask('Google · เครือร้านอาหารในไทย', `เครือร้านอาหารในประเทศไทยที่มีสาขามากที่สุด และแบรนด์ที่กำลังขยายสาขา ${c.province ? `ใน${c.province}` : ''}`);
      break;
  }
  return out;
}

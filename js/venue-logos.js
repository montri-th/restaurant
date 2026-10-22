/**
 * Venue (host candidate) logos — identity support for the venue panel, venue
 * lists and store facts. Registry: data/venue-logos.json (scripts/build-data.py
 * from the portable logo manifest + research sheet 07_VENUES; files in
 * assets/venue-logos/ keep their original bytes, sha256-checked).
 *
 * Rules: lookup by venue_candidate_id only, never fuzzy; the venue name stays the
 * identity; a logo never changes a row, a coordinate or a link status. Shared and
 * parent marks (chain banner, operator banner, parent complex, parent institution …)
 * keep their role caption so the UI says what the mark stands for. The link from a
 * restaurant to a venue is the restaurant's own name mentioning the venue — not a
 * verified located-inside relationship.
 */
const FILE_PATTERN = /^assets\/venue-logos\/[A-Za-z0-9._-]+\.(svg|png|jpe?g|webp|gif)$/;
const MIME_TYPES = new Set(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const ROLE_LABELS = Object.freeze({
  venue_specific: '', parent_complex: 'โลโก้โครงการแม่', shared_department_store_banner: 'โลโก้ห้างสรรพสินค้าในเครือ',
  shared_chain_banner: 'โลโก้เครือ', parent_institution: 'โลโก้หน่วยงานแม่', hotel_property_mark: 'โลโก้โรงแรม',
  current_property_brand: 'โลโก้แบรนด์อาคาร', shared_operator_banner: 'โลโก้ผู้ให้บริการในเครือ', none: '',
});
let assets = new Map(), byVenue = new Map(), configured = false, meta = {};

function approvedAsset(item) {
  if (!item || typeof item !== 'object' || !/^VL-[a-f0-9]{16}$/.test(item.key || '') || !FILE_PATTERN.test(item.file || '')) return null;
  const width = Number(item.width), height = Number(item.height);
  if (!MIME_TYPES.has(item.mime) || !/^[a-f0-9]{64}$/.test(item.sha256 || '') || !(width > 0) || !(height > 0)) return null;
  return Object.freeze({key: item.key, file: item.file, mime: item.mime, width, height, ratio: width / height, sha256: item.sha256,
    background: /^#[0-9A-Fa-f]{6}$/.test(item.background || '') ? item.background : '#E5E9E6',
    sourcePage: typeof item.sourcePage === 'string' ? item.sourcePage : ''});
}

export function configureVenueLogos(catalog) {
  assets = new Map(); byVenue = new Map(); meta = {};
  const issues = [];
  for (const item of Array.isArray(catalog?.assets) ? catalog.assets : []) {
    const a = approvedAsset(item);
    if (a) assets.set(a.key, a); else issues.push({reason: 'invalid_asset', key: item?.key});
  }
  for (const v of Array.isArray(catalog?.venues) ? catalog.venues : []) {
    if (typeof v?.id === 'string' && assets.has(v.key) && !byVenue.has(v.id)) byVenue.set(v.id, {key: v.key, role: v.role || 'venue_specific'});
  }
  meta = catalog?.meta && typeof catalog.meta === 'object' ? catalog.meta : {};
  configured = Array.isArray(catalog?.assets);
  return {assets: assets.size, venues: byVenue.size, issues, complete: configured && !issues.length};
}

/** venue = a venue record ({id, name}) or an id. null when the registry has no file for it. */
export function getVenueLogo(venue) {
  if (!configured || !venue) return null;
  const id = typeof venue === 'string' ? venue : venue.id;
  const link = byVenue.get(id);
  const asset = link && assets.get(link.key);
  if (!asset) return null;
  const name = typeof venue === 'object' ? venue.name : id;
  return {...asset, role: link.role, roleLabel: ROLE_LABELS[link.role] ?? '', altTh: `โลโก้ ${name}`};
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** size sm (rows, 28 px) | md (store facts, 36 px) | lg (venue heading, 56 px). */
export function venueLogoMarkup(venue, {className = '', size = 'sm', decorative = true} = {}) {
  const logo = getVenueLogo(venue);
  if (!logo) return '';
  const role = logo.roleLabel ? ` data-role="${esc(logo.role)}" title="${esc(logo.roleLabel)}"` : ` data-role="${esc(logo.role)}"`;
  return `<span class="venue-logo venue-logo-${esc(size)}${className ? ' ' + esc(className) : ''}" style="--venue-logo-bg:${esc(logo.background)}"${role}><img src="${esc(logo.file)}" width="${Math.round(logo.width)}" height="${Math.round(logo.height)}" alt="${decorative ? '' : esc(logo.altTh)}" loading="lazy" decoding="async"></span>`;
}

export function venueLogoMeta() { return {...meta, count: assets.size, linked: byVenue.size}; }

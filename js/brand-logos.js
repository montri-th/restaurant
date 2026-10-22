/**
 * Brand (chain candidate) logos — identity support for pins, chips, the store
 * heading and the chain list. Registry: data/brand-logos.json (built by
 * scripts/build-data.py from the portable logo manifest + research sheet 01_BRANDS;
 * files in assets/brand-logos/ keep their original bytes, sha256-checked).
 *
 * Rules: lookup by brand_candidate_id only — never by a store name or a fuzzy
 * match. A logo identifies the chain; it does not verify that a given restaurant
 * is a branch of it (the row's brand link stays a name-based candidate). Brands
 * on identity hold carry no logo. Collecting the files is not a trademark licence.
 */
const FILE_PATTERN = /^assets\/brand-logos\/[A-Za-z0-9._-]+\.(svg|png|jpe?g|webp|gif)$/;
const MIME_TYPES = new Set(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);
let assets = new Map(), byBrand = new Map(), configured = false, meta = {};

function approvedAsset(item) {
  if (!item || typeof item !== 'object' || !/^BL-[a-f0-9]{16}$/.test(item.key || '') || !FILE_PATTERN.test(item.file || '')) return null;
  const width = Number(item.width), height = Number(item.height);
  if (!MIME_TYPES.has(item.mime) || !/^[a-f0-9]{64}$/.test(item.sha256 || '') || !(width > 0) || !(height > 0)) return null;
  return Object.freeze({key: item.key, file: item.file, mime: item.mime, width, height, ratio: width / height, sha256: item.sha256,
    background: /^#[0-9A-Fa-f]{6}$/.test(item.background || '') ? item.background : '#E5E9E6',
    sourcePage: typeof item.sourcePage === 'string' ? item.sourcePage : ''});
}

/** Load the registry; never throws on a bad catalog (no registry = no logos). */
export function configureBrandLogos(catalog) {
  assets = new Map(); byBrand = new Map();
  const issues = [];
  for (const item of Array.isArray(catalog?.assets) ? catalog.assets : []) {
    const a = approvedAsset(item);
    if (a) assets.set(a.key, a); else issues.push({reason: 'invalid_asset', key: item?.key});
  }
  for (const link of Array.isArray(catalog?.brands) ? catalog.brands : []) {
    if (typeof link?.id === 'string' && assets.has(link.key)) byBrand.set(link.id, link.key);
  }
  meta = catalog?.meta && typeof catalog.meta === 'object' ? catalog.meta : {};
  configured = Array.isArray(catalog?.assets);
  return {assets: assets.size, brands: byBrand.size, issues, complete: configured && !issues.length};
}

/** brand = a brand record ({id, name, hold}) or an id. */
export function getBrandLogo(brand) {
  if (!configured || !brand) return null;
  const id = typeof brand === 'string' ? brand : brand.id;
  if (typeof brand === 'object' && brand.hold) return null;
  const asset = assets.get(byBrand.get(id));
  return asset ? {...asset, name: typeof brand === 'object' ? brand.name : id} : null;
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** Backplate box with the original artwork. size: xs (pins/chips 22 px) | sm (rows 28) | md (facts 36) | lg (heading 52). */
export function brandLogoMarkup(brand, {size = 'sm', className = '', decorative = true} = {}) {
  const logo = getBrandLogo(brand);
  if (!logo) return '';
  return `<span class="brand-logo brand-logo-${esc(size)}${className ? ' ' + esc(className) : ''}" style="--logo-bg:${esc(logo.background)};--logo-ratio:${logo.ratio.toFixed(3)}"><img src="${esc(logo.file)}" width="${Math.round(logo.width)}" height="${Math.round(logo.height)}" alt="${decorative ? '' : esc('โลโก้ ' + logo.name)}" loading="lazy" decoding="async"></span>`;
}

export function brandLogoMeta() { return {...meta, count: assets.size, linked: byBrand.size}; }

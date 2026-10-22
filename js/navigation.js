/**
 * Approved LDS nav-7 glyphs and the accessible help dialog.
 *
 * Codepoints were verified from this exact font's cmap + GSUB tables. The
 * registry approves only the seven names below; unsupported actions keep
 * visible text and explanatory titles instead of borrowing misleading symbols.
 * Decoration is idempotent and never touches pins, charts, filters or data.
 */
export const NAV_GLYPHS = Object.freeze({
  open_in_new: '', menu: '', close: '',
  light_mode: '', dark_mode: '', contrast: '', groups: '',
});
/**
 * Metric-tile pictograms (test exception approved by the owner 2026-10-22 for the
 * Luxury Brands demo, reused here byte-for-byte; to be registered in LDS if it
 * proves itself). Same family and axes as nav-7, a separate subset so the
 * approved nav-7 bytes stay unchanged. Glyph → meaning in Restaurants:
 * brand (diamond) = เครือร้าน · store (storefront) = ร้าน · venue (local_mall) = สถานที่ ·
 * area (map) = แขวง/ตำบล · province (location_city) = จังหวัด · exclusive (star) =
 * รีวิว/คะแนน · gla (square_foot) = ร้าน/ตร.กม. · segment (category) = ประเภทร้าน.
 */
export const PICTOGRAM_CONTRACT = Object.freeze({
  family: 'LDS Material Symbols Rounded Pictogram',
  file: 'assets/icons/material-pictogram-300.woff2', bytes: 1732,
  sha256: '33d9084bbd26b976d5c42002a0c669618573c21123567247816e9e694671c7b0',
  manifest: 'assets/icons/material-pictogram-300.json',
  axes: Object.freeze({FILL: 0, wght: 300, GRAD: 0, opsz: 24}),
  glyphs: Object.freeze({brand: '\uEAD5', store: '\uEA12', venue: '\uE54C', area: '\uE55B', province: '\uE7F1', exclusive: '\uF09A', gla: '\uEA49', segment: '\uE72C'}),
  status: 'test exception to LDS nav-7 (owner 2026-10-22)',
  fallback: 'Text labels carry the meaning; pictograms stay hidden until the font has loaded.',
});
export const NAV_ICON_CONTRACT = Object.freeze({
  assetId: 'icon.material-symbols-rounded.nav-7.300.01',
  file: 'assets/icons/material-nav-300.woff2', bytes: 2500,
  sha256: 'd7e283106ed2898726b24504c4e0f5ad524292984a90a4d29553c7dcf53b9657',
  axes: Object.freeze({FILL: 0, wght: 300, GRAD: 0, opsz: 24}),
  fallback: 'Visible labels remain usable; hide icon glyphs if the font cannot load.',
});

function makeIcon(name) {
  if (!Object.hasOwn(NAV_GLYPHS, name)) throw new Error(`Unapproved navigation glyph: ${name}`);
  const icon = document.createElement('span');
  icon.className = 'nav-icon';
  icon.dataset.navIcon = name;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = NAV_GLYPHS[name];
  return icon;
}
function decorate(element, name) {
  if (!element) return;
  const current = [...element.children].find(child => child.classList.contains('nav-icon'));
  if (current?.dataset.navIcon === name) return;
  if (current) current.replaceWith(makeIcon(name)); else element.prepend(makeIcon(name));
  element.classList.add('nav-decorated');
}

const TITLES = {
  'fit-map': 'ปรับแผนที่ให้เห็นพื้นที่หรือร้านตามตัวกรอง',
  'bangkok-map': 'กลับไปดูพื้นที่กรุงเทพฯ',
  'toggle-3d': 'สลับมุมมอง 3 มิติ (อาคารทั้งเมือง) กับแผนผัง 2 มิติ',
  'toggle-eye': 'มุมสถาปนิก: เปอร์สเปกทีฟ 2 จุดที่ระดับสถานที่ อาคารรอบข้างจางลง อาคารที่บังสถานที่โปร่งใส',
  'toggle-neighborhoods': 'แสดงหรือซ่อนสีและขอบเขตแขวง/ตำบล',
  'mobile-panel': 'เปิดแผงข้อมูลและตัวกรอง',
  'open-help': 'เปิดวิธีใช้',
  'toggle-insights': 'เปิดหรือย่อกราฟเปรียบเทียบพื้นที่',
  'open-table': 'เปิดตารางร้านตามตัวกรอง',
  'toggle-table': 'ปิดตารางและกลับไปแผนที่',
  'search': 'ค้นหาชื่อร้าน เครือร้าน สถานที่ แขวง/ตำบล หรือเขต/อำเภอ',
  'group': 'กรองตามประเภทร้าน (จัดกลุ่มจากประเภทในแหล่งข้อมูล)',
  'price': 'กรองตามระดับราคาที่แหล่งข้อมูลระบุ',
  'province': 'กรองตามจังหวัด',
  'brand': 'กรองตามเครือร้าน (จับคู่จากชื่อร้าน)',
  'prev-page': 'ดูหน้าก่อนหน้าของตาราง',
  'next-page': 'ดูหน้าถัดไปของตาราง',
  'tab-density': 'เปรียบเทียบร้านต่อตารางกิโลเมตรของแต่ละพื้นที่',
  'tab-mix': 'ดูประเภทร้านในแต่ละพื้นที่',
  'tab-price': 'ดูระดับราคาในแต่ละพื้นที่ (เฉพาะร้านที่ระบุราคา)',
};

function decorateNavigation() {
  const byId = (id, name) => decorate(document.getElementById(id), name);
  byId('close-help', 'close');
  byId('mobile-panel', 'menu');
  byId('close-mobile-panel', 'close');
  byId('toggle-table', 'close');
  const mode = document.getElementById('theme');
  if (mode) decorate(mode.closest('label'), mode.value === 'dark' ? 'dark_mode' : mode.value === 'light' ? 'light_mode' : 'contrast');
  for (const anchor of document.querySelectorAll('.source-link[target="_blank"], .usage-dialog a[target="_blank"], .top-actions a[target="_blank"], .links a[target="_blank"]')) {
    // This glyph only marks destinations that really open a new browsing context.
    decorate(anchor, 'open_in_new');
  }
  for (const [id, title] of Object.entries(TITLES)) {
    const element = document.getElementById(id);
    if (element && element.title !== title) element.title = title;
  }
  const reset = document.querySelector('#filters button[type="reset"]');
  if (reset) reset.title = 'ล้างตัวกรอง';
}

function installHelp() {
  const dialog = document.getElementById('usage-help'), opener = document.getElementById('open-help'), close = document.getElementById('close-help');
  if (!dialog || !opener || !close) return;
  let returnFocus = opener;
  opener.addEventListener('click', () => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : opener;
    if (!dialog.open) dialog.showModal();
    close.focus({preventScroll: true});
  });
  close.addEventListener('click', () => dialog.close());
  // Native dialog supplies modal focus containment and Escape/cancel behavior.
  dialog.addEventListener('close', () => { const target = returnFocus?.isConnected ? returnFocus : opener; target.focus({preventScroll: true}); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}

export function installNavigation() {
  decorateNavigation();
  installHelp();
  document.getElementById('theme')?.addEventListener('change', decorateNavigation);
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; decorateNavigation(); });
  });
  observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded']});
  if (document.fonts?.load) {
    document.fonts.load('300 24px "LDS Material Symbols Rounded Nav"', '')
      .then(faces => { document.documentElement.classList.add(faces.length ? 'nav-icons-ready' : 'nav-icons-unavailable'); })
      .catch(() => document.documentElement.classList.add('nav-icons-unavailable'));
    document.fonts.load('300 20px "LDS Material Symbols Rounded Pictogram"', PICTOGRAM_CONTRACT.glyphs.store)
      .then(faces => { document.documentElement.classList.add(faces.length ? 'pictograms-ready' : 'pictograms-unavailable'); })
      .catch(() => document.documentElement.classList.add('pictograms-unavailable'));
  } else document.documentElement.classList.add('nav-icons-unavailable', 'pictograms-unavailable');
  return () => observer.disconnect();
}

if (typeof document !== 'undefined') installNavigation();

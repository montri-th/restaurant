/**
 * This demo's navigation on the shared header code: the titles of its controls and its pictogram subset. The
 * nav-7 glyphs and the help dialog are js/shell/navigation.js, the dataset picker js/shell/header.js
 * (citymeter-shell: edit those in every repository at once, js/shell/manifest.json).
 */
import {installNavigation, NAV_GLYPHS, NAV_ICON_CONTRACT} from './shell/navigation.js';
import {installHeader} from './shell/header.js';

export {NAV_GLYPHS, NAV_ICON_CONTRACT};

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
  // The 12-glyph extension, approved by the owner 2026-11-03 (“อนุมัติราว 12 ตัว”), same family and axes in its own file
  // (scripts/build-pictogram-food.py); beside a label, never instead of a category, evidence or rating label (ICON-01).
  extension: Object.freeze({
    file: 'assets/icons/material-pictogram-food-300.woff2', bytes: 2380,
    sha256: 'de2167a8c4f2695c4b5f700190304e4cb13dc415d81c6599a6ea8aa7d0acccd0',
    manifest: 'assets/icons/material-pictogram-food-300.json',
    glyphs: Object.freeze({'g-general': '\uE56C', 'g-thai': '\uF1F5', 'g-fastfood': '\uEA61', 'g-japanese': '\uEA64', 'g-cafe': '\uEB44', 'g-asian': '\uEA74',
      'g-grill': '\uEA47', 'g-western': '\uEA57', price: '\uEF63', building: '\uEA40', place: '\uF1DB', tune: '\uE429'}),
  }),
});
/** Pictogram role of a food category (0.9.2, register taxonomy) — the approved food glyphs, no new glyph. */
export const FOOD_CATEGORY_PICTOGRAM = Object.freeze({FC01: 'g-thai', FC02: 'g-general', FC03: 'g-cafe', FC04: 'g-fastfood', FC05: 'g-japanese', FC06: 'g-grill'});
/** Pictogram role of a restaurant type group (js/model.js groups); 'other' and 'unspecified' have none. */
export const GROUP_PICTOGRAM = Object.freeze({general: 'g-general', thai: 'g-thai', fastfood: 'g-fastfood', japanese: 'g-japanese', cafe: 'g-cafe',
  asian: 'g-asian', grill: 'g-grill', western: 'g-western'});
const TITLES = {
  'fit-map': 'ปรับแผนที่ให้เห็นพื้นที่หรือร้านตามตัวกรอง',
  'bangkok-map': 'กลับไปดูพื้นที่กรุงเทพฯ',
  'toggle-3d': 'สลับมุมมอง 3 มิติ (อาคารทั้งเมือง) กับแผนผัง 2 มิติ',
  'toggle-eye': 'มุมสถาปนิก (ใช้ได้เมื่อเปิดสถานที่ในมุม 3 มิติ): เปอร์สเปกทีฟ 2 จุด อาคารรอบข้างจางลง อาคารที่บังสถานที่โปร่งใส',
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

if (typeof document !== 'undefined') {
  installNavigation({titles: TITLES, pictogramProbe: PICTOGRAM_CONTRACT.glyphs.store + PICTOGRAM_CONTRACT.extension.glyphs.price});
  installHeader();
}

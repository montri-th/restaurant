/**
 * Analytical scales — LDS 0.9.7 (v0.9.7-owner.1, color-srgb-10), copied exactly
 * from machine.analyticalScales of Landometer-Design-System-v0.9.7.md
 * (SHA-256 d3085cbc…96). DATAVIZ-02/03: the approved light 41-sample LUT is
 * consumed unchanged on both themes; class indices are round(i × 40 / (n − 1));
 * nothing is interpolated here.
 *
 * Families used by this product (selected from metric + denominator):
 *  - density.area — restaurants per km² of a subdistrict (denominator = area): the
 *    choropleth, the ranking bars and the area labels.
 *  - count — totals, never density: restaurants per province frame (country view)
 *    and matrix cells (rows per area × food type).
 *  - price — monetary levels: the ordered price buckets of the source (≤100 … >1,000 baht).
 * The consumer declares the classification: equal-interval classes over the
 * current maximum (density: continuous [lower, upper) with the last closed; count:
 * closed integer intervals). EVID-05 states stay outside the ramp.
 */
const freeze = Object.freeze;

export const COUNT_SCALE = freeze({
  scaleId: 'count', kind: 'sequential', labelTh: 'จำนวนรวม',
  anchors: freeze(['#F4F0E7', '#7DBAC0', '#213E70']),
  lut: freeze(['#F4F0E7', '#EEEDE5', '#E8EBE3', '#E3E8E1', '#DDE5DF', '#D7E3DD', '#D1E0DB', '#CBDDD9', '#C5DAD7', '#C0D8D6',
    '#BAD5D4', '#B4D2D2', '#AED0D0', '#A8CDCE', '#A2CACC', '#9CC8CA', '#96C5C8', '#90C2C6', '#8ABFC4', '#83BDC2', '#7DBAC0',
    '#78B3BC', '#73ADB8', '#6EA7B4', '#69A0B0', '#649AAC', '#5F93A8', '#5A8DA4', '#5587A0', '#50809C', '#4C7A98', '#477494',
    '#436E90', '#3E688C', '#3A6288', '#355C84', '#315680', '#2D507C', '#294A78', '#254474', '#213E70']),
  noData: '#D5DAD6', zeroOutline: '#7D877F',
  scaleVersion: '4ff5c1fb4be71ecd13c48685b38371b528bcd4ce369ce964a75354c2eb4d0980',
  themePolicy: 'identical-light-values-on-both-themes',
});

export const DENSITY_SCALE = freeze({
  scaleId: 'density.area', kind: 'sequential', labelTh: 'ความหนาแน่นต่อพื้นที่', unit: 'ร้าน/ตร.กม.',
  anchors: freeze(['#FFF1D9', '#E6AB30', '#D6600C']),
  lut: freeze(['#FFF1D9', '#FEEED2', '#FDEACA', '#FCE7C3', '#FAE3BC', '#F9E0B5', '#F8DCAD', '#F7D9A6', '#F6D59E', '#F4D297',
    '#F3CF8F', '#F2CB87', '#F1C87F', '#EFC477', '#EEC06F', '#EDBD66', '#EBB95D', '#EAB653', '#E9B249', '#E7AF3D', '#E6AB30',
    '#E5A72E', '#E5A42D', '#E4A02B', '#E49D2A', '#E39928', '#E29526', '#E29225', '#E18E23', '#E08A21', '#DF8720', '#DF831E',
    '#DE7F1C', '#DD7B1A', '#DC7818', '#DB7417', '#DA7015', '#D96C13', '#D86811', '#D7640E', '#D6600C']),
  noData: '#D5DAD6', zeroOutline: '#7D877F',
  scaleVersion: '554812a7c19107b3a9b8658ba541fc8e13519cb19708e885a425f32d5b30f101',
  themePolicy: 'identical-light-values-on-both-themes',
});

export const PRICE_SCALE = freeze({
  scaleId: 'price', kind: 'sequential', labelTh: 'ราคา', unit: 'บาท',
  anchors: freeze(['#F4F4DD', '#74C4C2', '#216D58']),
  lut: freeze(['#F4F4DD', '#EEF2DC', '#E8EFDA', '#E2EDD9', '#DCEBD8', '#D6E8D6', '#D0E6D5', '#C9E3D4', '#C3E1D2', '#BDDFD1',
    '#B7DCD0', '#B0DACE', '#AAD7CD', '#A4D5CC', '#9DD3CA', '#97D0C9', '#90CEC8', '#89CBC6', '#82C9C5', '#7BC6C3', '#74C4C2',
    '#70BFBC', '#6CBBB7', '#68B6B1', '#63B2AC', '#5FADA6', '#5BA9A1', '#57A59B', '#53A096', '#4F9C91', '#4B978B', '#479386',
    '#438F81', '#3F8B7C', '#3B8676', '#368271', '#327E6C', '#2E7A67', '#2A7562', '#25715D', '#216D58']),
  noData: '#D5DAD6', zeroOutline: '#7D877F',
  scaleVersion: 'a4fcda655f3e10c43e8deab212d7da20335392a87c823a390ab81a69d38cfccc',
  themePolicy: 'identical-light-values-on-both-themes',
});

/** Label ink on a class fill: the foundation text pair that reaches the higher contrast. */
export function inkFor(fill) {
  const dark = '#182327', light = '#FFFFFF';
  return contrastRatio(fill, dark) >= contrastRatio(fill, light) ? dark : light;
}

/** Exact class colours for n ∈ {3,5,7,9}: index round(i × 40 / (n − 1)). */
export function classColors(n = 5, scale = COUNT_SCALE) {
  if (![3, 5, 7, 9].includes(n)) throw new RangeError('Class count must be 3, 5, 7 or 9');
  return Array.from({length: n}, (_, i) => scale.lut[Math.round((i * 40) / (n - 1))]);
}

/** Equal-interval closed integer intervals over [1, max] (count family). */
export function countThresholds(max, n = 5) {
  const top = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  if (top < 1) return [];
  const classes = Math.min(n, top);
  const intervals = [];
  let lower = 1;
  for (let i = 0; i < classes; i++) {
    const upper = i === classes - 1 ? top : Math.max(lower, Math.floor((top * (i + 1)) / classes));
    intervals.push({lower, upper});
    lower = upper + 1;
  }
  return intervals;
}

const NUM = new Intl.NumberFormat('th-TH', {maximumFractionDigits: 0});

/** Count classes for measured totals (zero is measured_zero, never a ramp class). */
export function buildCountClasses(values, n = 5, {unit = 'ร้าน'} = {}) {
  const measured = (Array.isArray(values) ? values : []).filter(v => Number.isFinite(v) && v > 0);
  const max = measured.length ? Math.max(...measured) : 0;
  const intervals = countThresholds(max, n);
  const colors = classColors(n, COUNT_SCALE);
  const picks = intervals.map((_, i) => (intervals.length === 1 ? n - 1 : Math.round((i * (n - 1)) / (intervals.length - 1))));
  const classes = intervals.map((interval, i) => ({
    index: picks[i], lower: interval.lower, upper: interval.upper, fill: colors[picks[i]], ink: inkFor(colors[picks[i]]),
    label: interval.lower === interval.upper ? NUM.format(interval.lower) : `${NUM.format(interval.lower)}–${NUM.format(interval.upper)}`,
  }));
  return {scaleId: COUNT_SCALE.scaleId, unit, method: 'equal-interval', classCount: classes.length, max, classes,
    zero: {fill: colors[0], outline: COUNT_SCALE.zeroOutline, label: '0'}};
}

/**
 * Density classes: equal-interval over (0, top] where top = max rounded up at the
 * label precision (integers from 20 /km², one decimal from 2, two below 2 — so a
 * small selection such as one chain still gets distinct breakpoints). Intervals are
 * [lower, upper) except the closed last one; values are compared at full precision;
 * labels show the breakpoints. Zero is measured_zero, never a ramp class.
 */
export function buildDensityClasses(values, n = 5) {
  const measured = (Array.isArray(values) ? values : []).filter(v => Number.isFinite(v) && v > 0);
  const max = measured.length ? Math.max(...measured) : 0;
  const colors = classColors(n, DENSITY_SCALE);
  if (!(max > 0)) return {scaleId: DENSITY_SCALE.scaleId, unit: DENSITY_SCALE.unit, method: 'equal-interval', classCount: 0, max: 0, classes: [], zero: {fill: colors[0], outline: DENSITY_SCALE.zeroOutline, label: '0'}};
  const precision = max >= 20 ? 0 : max >= 2 ? 1 : 2;
  const f = 10 ** precision;
  const top = Math.max(1 / f, Math.ceil(max * f) / f);
  const step = top / n;
  const breaks = Array.from({length: n + 1}, (_, i) => (i === 0 ? 0 : i === n ? top : Math.round(step * i * f) / f));
  const fmt = new Intl.NumberFormat('th-TH', {minimumFractionDigits: precision, maximumFractionDigits: precision});
  const classes = [];
  for (let i = 0; i < n; i++) {
    if (breaks[i + 1] <= breaks[i]) continue;
    classes.push({index: i, lower: breaks[i], upper: breaks[i + 1], closed: i === n - 1, fill: colors[i], ink: inkFor(colors[i]),
      label: i === 0 ? `>0–${fmt.format(breaks[1])}` : `${fmt.format(breaks[i])}–${fmt.format(breaks[i + 1])}`});
  }
  classes.at(-1).closed = true;
  return {scaleId: DENSITY_SCALE.scaleId, unit: DENSITY_SCALE.unit, method: 'equal-interval', classCount: classes.length, max, top, precision, classes,
    zero: {fill: colors[0], outline: DENSITY_SCALE.zeroOutline, label: '0'}};
}

/**
 * Resolve one value to its EVID-05 state and treatment.
 *  measured: finite nonzero → class fill · measured_zero: 0 → lowest fill + zero outline
 *  no_data: null fill (caller draws the hatch) · out_of_scope: nothing drawn
 */
export function classify(value, model, state = 'measured') {
  const scale = model?.scaleId === 'density.area' ? DENSITY_SCALE : COUNT_SCALE;
  if (state === 'out_of_scope') return {state, fill: null, ink: null, label: 'นอกขอบเขตข้อมูล'};
  if (state === 'no_data' || value == null || !Number.isFinite(value)) return {state: 'no_data', fill: null, ink: null, label: 'ไม่มีร้านในชุดข้อมูล'};
  if (value <= 0) return {state: 'measured_zero', fill: model.zero.fill, ink: inkFor(model.zero.fill), outline: model.zero.outline, label: '0'};
  const cls = model.classes.find(c => (c.closed ? value >= c.lower && value <= c.upper : value >= c.lower && value < c.upper)) || model.classes.at(-1);
  if (!cls) return {state: 'measured', fill: scale.lut[40], ink: inkFor(scale.lut[40]), label: String(value), classIndex: 4};
  return {state: 'measured', fill: cls.fill, ink: cls.ink, label: String(value), classIndex: cls.index};
}

/** Price bucket colours: the five priced buckets take the five `price` classes in order; unspecified is no_data. */
export function priceColors() {
  const c = classColors(5, PRICE_SCALE);
  return {UNDER_100: c[0], R100_300: c[1], R300_500: c[2], R500_1000: c[3], OVER_1000: c[4], UNSPECIFIED: null};
}

/** WCAG relative-luminance contrast ratio (used for ink choice and tests). */
export function contrastRatio(hexA, hexB) {
  const lum = hex => {
    const c = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(hexA), lum(hexB)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

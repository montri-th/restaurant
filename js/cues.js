/**
 * Categorical identity of the food-type groups — LDS 0.9.7 DATAVIZ-05
 * (`landometer-series-10-v8`).
 *
 * Every group is bound by its stable id to one series: the fill comes from the
 * theme's `--series-N-fill` (assets/theme.css, exact LDS values per theme) and the
 * shape cue is the one LDS assigns to that series slot (circle, square, triangle,
 * diamond, cross, star, hexagon, ring, dash, plus). The cue is the non-colour
 * channel on the map, in legends and in lists; a text label accompanies every
 * legend and list. Assignments never change with filtering or sorting.
 *
 * Mapping rationale (presentation only): the dominant "ร้านอาหารทั่วไป" group
 * (≈ 72 % of rows) takes the open ring so the specific food types read as filled
 * shapes on top of it; "ไม่ระบุประเภท" takes the dash.
 */
export const CUES = Object.freeze(['circle', 'square', 'triangle', 'diamond', 'cross', 'star', 'hexagon', 'ring', 'dash', 'plus']);

/** group id → series number (1–10). */
export const GROUP_SERIES = Object.freeze({
  general: 8, thai: 1, fastfood: 3, japanese: 6, cafe: 2, asian: 4, grill: 5, western: 7, other: 10, unspecified: 9,
});
export const seriesOf = groupId => GROUP_SERIES[groupId] || 9;
export const cueOf = series => CUES[(series || 9) - 1];

/** 12 × 12 viewBox paths, centred on (6, 6); the ring uses the even-odd rule. */
export const CUE_PATHS = Object.freeze({
  circle: 'M6 1.2a4.8 4.8 0 1 1 0 9.6a4.8 4.8 0 1 1 0-9.6z',
  square: 'M1.8 1.8h8.4v8.4H1.8z',
  triangle: 'M6 1.1l5.2 9.3H0.8z',
  diamond: 'M6 0.8l5.2 5.2L6 11.2L0.8 6z',
  cross: 'M8.62 1.40L10.60 3.38L7.98 6.00L10.60 8.62L8.62 10.60L6.00 7.98L3.38 10.60L1.40 8.62L4.02 6.00L1.40 3.38L3.38 1.40L6.00 4.02Z',
  star: 'M6.00 0.90L7.35 4.44L11.14 4.63L8.19 7.01L9.17 10.67L6.00 8.60L2.83 10.67L3.81 7.01L0.86 4.63L4.65 4.44Z',
  hexagon: 'M6 1l4.5 2.5v5L6 11L1.5 8.5v-5z',
  ring: 'M6 1.2a4.8 4.8 0 1 1 0 9.6a4.8 4.8 0 1 1 0-9.6zM6 3.7a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6z',
  dash: 'M0.8 4.4h10.4v3.2H0.8z',
  plus: 'M4.6 1h2.8v3.6H11v2.8H7.4V11H4.6V7.4H1V4.6h3.6z',
});

/** Inline SVG cue for HTML (legend swatches, list bullets, pins). Decorative: the text label carries the meaning. */
export function cueMarkup(series, {className = ''} = {}) {
  const name = cueOf(series);
  return `<svg class="cue-shape category-${series}${className ? ' ' + className : ''}" data-cue="${name}" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="${CUE_PATHS[name]}" fill-rule="evenodd"/></svg>`;
}

/**
 * Raster icon for a MapLibre symbol layer: the cue filled with `fill`, outlined
 * with `stroke`, on a transparent ground. Returns {width, height, data} at
 * `pixelRatio` (pass the same ratio to map.addImage). Browser only.
 */
export function cueImage(series, {size = 16, pixelRatio = 2, fill = '#8AA4AA', stroke = '#182327', strokeWidth = 1.1} = {}) {
  const px = Math.round(size * pixelRatio);
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(px, px) : Object.assign(document.createElement('canvas'), {width: px, height: px});
  const ctx = canvas.getContext('2d');
  // The paths keep ≥ 0.8 unit of margin inside the 12-unit box, enough for the outline at these sizes.
  const scale = px / 12;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const path = new Path2D(CUE_PATHS[cueOf(series)]);
  ctx.fillStyle = fill;
  ctx.fill(path, 'evenodd');
  ctx.lineJoin = 'round';
  ctx.lineWidth = (strokeWidth * pixelRatio) / scale;
  ctx.strokeStyle = stroke;
  ctx.stroke(path);
  const image = ctx.getImageData(0, 0, px, px);
  return {width: px, height: px, data: new Uint8Array(image.data.buffer)};
}

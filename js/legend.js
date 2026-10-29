/**
 * Ramp legend for the sequential scales (0.7.1, owner 2026-10-30 “color scale always go for 41 colors”): every class
 * fill of a model — the 41 LUT values of LDS 0.9.7 when the data spans them — drawn as one bar, with the LDS anchors
 * (head · middle · tail) as labels under it. The bar is decorative; the labels and the accessible name carry the
 * meaning. Zero (measured_zero) and no-data stay outside the ramp and are drawn by the caller with their own cues.
 */
import {rampAnchors} from './scales.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** @param model a class model from buildCountClasses / buildDensityClasses; unit = the label unit for the accessible name. */
export function rampMarkup(model, {unit = ''} = {}) {
  const classes = model?.classes || [];
  if (!classes.length) return '';
  const anchors = rampAnchors(model);
  const name = `ระดับสี ${anchors.map(a => a.label).join(' · ')}${unit ? ` ${unit}` : ''} · ${classes.length} ระดับเท่าช่วง`;
  return `<span class="legend-ramp" role="img" aria-label="${esc(name)}" title="${esc(name)}"><span class="legend-ramp-bar" aria-hidden="true">${classes.map(c => `<i style="background:${c.fill}"></i>`).join('')}</span><span class="legend-ramp-labels" aria-hidden="true">${anchors.map(a => `<span>${esc(a.label)}</span>`).join('')}</span></span>`;
}

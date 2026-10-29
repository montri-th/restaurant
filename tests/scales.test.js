import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './helpers.js';
import {COUNT_SCALE, DENSITY_SCALE, PRICE_SCALE, classColors, buildCountClasses, buildDensityClasses, classify, priceColors, inkFor, contrastRatio, rampAnchors} from '../js/scales.js';
import {PRICED} from '../js/model.js';

test('the three families are exact 41-sample LUTs with anchors at 0/20/40, same HEX on both themes', () => {
  for (const s of [COUNT_SCALE, DENSITY_SCALE, PRICE_SCALE]) {
    assert.equal(s.lut.length, 41, s.scaleId);
    assert.deepEqual([s.lut[0], s.lut[20], s.lut[40]], [...s.anchors], `${s.scaleId} anchors`);
    assert.ok(s.lut.every(h => /^#[0-9A-F]{6}$/.test(h)));
    assert.equal(s.themePolicy, 'identical-light-values-on-both-themes');
    assert.match(s.scaleVersion, /^[0-9a-f]{64}$/);
  }
  assert.equal(DENSITY_SCALE.scaleId, 'density.area');
  assert.equal(DENSITY_SCALE.unit, 'ร้าน/ตร.กม.');
});

test('class colours are LUT[round(i·40/(n−1))] for n ∈ {3,5,7,9}; other n are refused', () => {
  for (const n of [3, 5, 7, 9]) assert.deepEqual(classColors(n, DENSITY_SCALE), Array.from({length: n}, (_, i) => DENSITY_SCALE.lut[Math.round((i * 40) / (n - 1))]));
  assert.throws(() => classColors(4), /3, 5, 7, 9 or 41/);
  assert.deepEqual(classColors(41, COUNT_SCALE), [...COUNT_SCALE.lut], 'n = 41 is the whole LUT (owner 2026-10-30: every scale goes for the 41 colours)');
});

test('theme.css carries the count classes once (no dark override of analytical values)', () => {
  const css = readFileSync(join(ROOT, 'assets/theme.css'), 'utf8');
  const [light, dark] = css.split(':root[data-theme="dark"]');
  classColors(5, COUNT_SCALE).forEach((hex, i) => assert.match(light, new RegExp(`--scale-count-${i + 1}: ${hex};`)));
  assert.ok(!/--scale-/.test(dark), 'no analytical token is redefined for dark');
});

test('density classes: equal intervals over (0, top], precision follows magnitude, last class closed, zero outside the ramp', () => {
  const five = buildDensityClasses([0, 3, 40, 128.4], 5);
  assert.equal(five.classCount, 5);
  assert.deepEqual(five.classes.map(c => c.label), ['>0–26', '26–52', '52–77', '77–103', '103–129']);
  const big = buildDensityClasses([0, 3, 40, 128.4]);
  assert.equal(big.classCount, 41, 'default = the 41 LUT values as equal-interval classes');
  assert.equal(big.top, 129);
  assert.deepEqual(big.classes.slice(0, 3).map(c => c.label), ['>0–3', '3–6', '6–9']);
  assert.deepEqual(big.classes.map(c => c.fill), [...DENSITY_SCALE.lut], 'class i takes LUT value i — no interpolation');
  assert.equal(big.classes.at(-1).closed, true);
  assert.equal(classify(128.4, big).classIndex, 40);
  assert.equal(classify(129, big).classIndex, 40, 'top value is inside the closed last class');
  assert.equal(classify(3, big).classIndex, 1, '[lower, upper): a breakpoint opens the next class');
  assert.deepEqual(rampAnchors(big).map(a => a.label), ['>0', '63', '129'], 'ramp legend anchors: head · middle · tail');
  assert.equal(classify(0, big).state, 'measured_zero');
  assert.equal(classify(0, big).fill, DENSITY_SCALE.lut[0]);
  assert.equal(classify(null, big).state, 'no_data');
  assert.equal(classify(null, big).fill, null, 'no_data never takes a ramp colour');
  const small = buildDensityClasses([0.3, 2.6], 5);
  assert.deepEqual(small.classes.map(c => c.label), ['>0–0.5', '0.5–1.0', '1.0–1.6', '1.6–2.1', '2.1–2.6']);
  const small41 = buildDensityClasses([0.3, 2.6]);
  assert.ok(small41.classCount < 41 && small41.classCount > 5, 'a small range keeps only distinct breakpoints at the label precision');
  assert.equal(small41.classes.at(-1).fill, DENSITY_SCALE.lut[40], 'the top class still takes the tail colour');
  for (let i = 1; i < small41.classes.length; i++) assert.ok(small41.classes[i].index > small41.classes[i - 1].index, 'colour index grows with the value');
  assert.equal(buildDensityClasses([0, 0]).classCount, 0);
});

test('count classes: closed integer intervals over [1, max]; zero is measured_zero', () => {
  const m = buildCountClasses([0, 1, 9, 44086]);
  assert.equal(m.classCount, 41);
  assert.deepEqual(m.classes.map(c => c.fill), [...COUNT_SCALE.lut]);
  assert.equal(m.classes[0].lower, 1);
  assert.equal(m.classes.at(-1).upper, 44086);
  for (let i = 1; i < m.classes.length; i++) assert.equal(m.classes[i].lower, m.classes[i - 1].upper + 1);
  assert.equal(classify(0, m).state, 'measured_zero');
  const tiny = buildCountClasses([2]);
  assert.equal(tiny.classes.length, 2);
});

test('price buckets take the five price classes in order; unspecified has no colour', () => {
  const c = priceColors();
  assert.deepEqual(PRICED.map(b => c[b]), classColors(5, PRICE_SCALE));
  assert.equal(c.UNSPECIFIED, null);
});

test('label ink is the foundation pair with the higher contrast; numbers printed on fills (matrix = count) reach 4.5:1', () => {
  for (const s of [COUNT_SCALE, DENSITY_SCALE, PRICE_SCALE]) for (const hex of classColors(5, s)) {
    const ink = inkFor(hex), other = ink === '#182327' ? '#FFFFFF' : '#182327';
    assert.ok(contrastRatio(hex, ink) >= contrastRatio(hex, other));
  }
  // Only the count family carries text on its fill (matrix cells); density and price fills never hold text
  // (density top class #D6600C reaches 4.23:1 with the dark ink, so values sit beside bars and on chips instead).
  for (const hex of classColors(5, COUNT_SCALE)) assert.ok(contrastRatio(hex, inkFor(hex)) >= 4.5, hex);
  assert.ok(contrastRatio('#D6600C', inkFor('#D6600C')) < 4.5, 'documented: no text on the top density class');
});

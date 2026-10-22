import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './helpers.js';
import {COUNT_SCALE, DENSITY_SCALE, PRICE_SCALE, classColors, buildCountClasses, buildDensityClasses, classify, priceColors, inkFor, contrastRatio} from '../js/scales.js';
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
  assert.throws(() => classColors(4), /3, 5, 7 or 9/);
});

test('theme.css carries the count classes once (no dark override of analytical values)', () => {
  const css = readFileSync(join(ROOT, 'assets/theme.css'), 'utf8');
  const [light, dark] = css.split(':root[data-theme="dark"]');
  classColors(5, COUNT_SCALE).forEach((hex, i) => assert.match(light, new RegExp(`--scale-count-${i + 1}: ${hex};`)));
  assert.ok(!/--scale-/.test(dark), 'no analytical token is redefined for dark');
});

test('density classes: equal intervals over (0, top], precision follows magnitude, last class closed, zero outside the ramp', () => {
  const big = buildDensityClasses([0, 3, 40, 128.4]);
  assert.equal(big.classCount, 5);
  assert.deepEqual(big.classes.map(c => c.label), ['>0–26', '26–52', '52–77', '77–103', '103–129']);
  assert.equal(big.classes.at(-1).closed, true);
  assert.equal(classify(128.4, big).classIndex, 4);
  assert.equal(classify(129, big).classIndex, 4, 'top value is inside the closed last class');
  assert.equal(classify(26, big).classIndex, 1, '[lower, upper): a breakpoint opens the next class');
  assert.equal(classify(0, big).state, 'measured_zero');
  assert.equal(classify(0, big).fill, DENSITY_SCALE.lut[0]);
  assert.equal(classify(null, big).state, 'no_data');
  assert.equal(classify(null, big).fill, null, 'no_data never takes a ramp colour');
  const small = buildDensityClasses([0.3, 2.6]);
  assert.deepEqual(small.classes.map(c => c.label), ['>0–0.5', '0.5–1.0', '1.0–1.6', '1.6–2.1', '2.1–2.6']);
  assert.equal(buildDensityClasses([0, 0]).classCount, 0);
});

test('count classes: closed integer intervals over [1, max]; zero is measured_zero', () => {
  const m = buildCountClasses([0, 1, 9, 44086]);
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

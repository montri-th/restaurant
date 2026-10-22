import test from 'node:test';
import assert from 'node:assert/strict';
import {signedArea, isClockwise, cleanRing, clipRingToBox, offsetRing, roundRing, pointInRing, ringsIntersect} from '../js/geometry.js';

// y-down frame (MVT): this square is clockwise on screen → positive signed area.
const square = (x, y, s) => [[x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s], [x - s, y - s]];
const hole = (x, y, s) => [[x - s, y - s], [x - s, y + s], [x + s, y + s], [x + s, y - s], [x - s, y - s]];

test('orientation and cleaning follow the MVT y-down convention', () => {
  assert.ok(signedArea(square(0, 0, 10)) > 0);
  assert.equal(isClockwise(square(0, 0, 10)), true);
  assert.equal(isClockwise(hole(0, 0, 10)), false);
  assert.equal(cleanRing([[0, 0], [0, 0], [1, 0]]), null, 'degenerate rings are dropped');
  assert.deepEqual(cleanRing([[0, 0], [1, 0], [1, 0], [1, 1], [0, 0]]), [[0, 0], [1, 0], [1, 1], [0, 0]]);
});

test('clipping to the tile box removes buffer geometry and keeps orientation', () => {
  const crossing = square(4096, 2000, 100);
  const clipped = clipRingToBox(crossing, {minX: 0, minY: 0, maxX: 4096, maxY: 4096});
  assert.ok(clipped.every(([x]) => x <= 4096 + 1e-9));
  assert.ok(Math.abs(signedArea(clipped) - 100 * 200) < 1e-6, 'half the square survives');
  assert.equal(isClockwise(clipped), true);
  assert.equal(clipRingToBox(square(-500, -500, 10), {minX: 0, minY: 0, maxX: 4096, maxY: 4096}), null, 'entirely outside → nothing');
});

test('outward offset then fillet encloses the original footprint (and shrinks holes)', () => {
  const r = 8, d = Math.max(1, r / 2.5);
  for (const original of [square(0, 0, 20), [[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60], [0, 0]] /* L-shape, CW */]) {
    const model = roundRing(offsetRing(original, d, 1), r, 4, {encloseOffset: d});
    for (const p of original) assert.ok(pointInRing(p, model), `vertex ${p} stays inside the model`);
    assert.ok(signedArea(model) > signedArea(original), 'the model is larger');
    assert.ok(model.length > original.length, 'corners became arcs');
  }
  const h = hole(0, 0, 10);
  const shrunk = offsetRing(h, d, 1);
  assert.ok(Math.abs(signedArea(shrunk)) < Math.abs(signedArea(h)), 'holes move inward with the same sign');
  assert.equal(isClockwise(shrunk), false);
});

test('fillet radius is capped by edge length so small shapes keep their silhouette', () => {
  const tiny = square(0, 0, 3); // 6-unit edges
  const rounded = roundRing(tiny, 50, 3);
  assert.ok(Math.abs(signedArea(rounded)) > Math.abs(signedArea(tiny)) * 0.6, 'not collapsed into a dot');
  assert.ok(rounded.every(([x, y]) => Math.abs(x) <= 3.001 && Math.abs(y) <= 3.001), 'fillets stay inside the corner');
});

test('intersection and containment tests', () => {
  assert.equal(ringsIntersect(square(0, 0, 10), square(5, 5, 10)), true);
  assert.equal(ringsIntersect(square(0, 0, 10), square(50, 50, 10)), false);
  assert.equal(ringsIntersect(square(0, 0, 2), square(0, 0, 10)), true, 'small inside large');
  assert.equal(ringsIntersect(square(0, 0, 10), square(0, 0, 2)), true, 'large around small');
  assert.equal(pointInRing([0, 0], square(0, 0, 10)), true);
  assert.equal(pointInRing([11, 0], square(0, 0, 10)), false);
});

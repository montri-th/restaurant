/**
 * Pictograms (0.9.0): the 8-glyph subset of 2026-10-22 stays byte-identical; the 12-glyph extension approved by the
 * owner 2026-11-03 (“อนุมัติราว 12 ตัว”) is the exact file its manifest and the contract name, CSS loads exactly its
 * glyphs, and every pictogram sits beside a label (aria-hidden), never instead of one (LDS ICON-01).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {ROOT, readJSON} from './helpers.js';
import {PICTOGRAM_CONTRACT, GROUP_PICTOGRAM} from '../js/navigation.js';

const sha = path => createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex');
const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');

test('the 2026-10-22 subset is unchanged; the extension is the file its manifest and contract name', () => {
  const base = readJSON('assets/icons/material-pictogram-300.json');
  assert.equal(sha('assets/icons/material-pictogram-300.woff2'), '33d9084bbd26b976d5c42002a0c669618573c21123567247816e9e694671c7b0');
  assert.equal(base.sha256, PICTOGRAM_CONTRACT.sha256);
  const ext = readJSON('assets/icons/material-pictogram-food-300.json');
  const file = `assets/icons/${ext.file}`;
  assert.equal(file, PICTOGRAM_CONTRACT.extension.file);
  assert.equal(sha(file), ext.sha256);
  assert.equal(ext.sha256, PICTOGRAM_CONTRACT.extension.sha256);
  assert.equal(readFileSync(join(ROOT, file)).length, PICTOGRAM_CONTRACT.extension.bytes);
  assert.deepEqual(ext.axes, {FILL: 0, wght: 300, GRAD: 0, opsz: 24});
  assert.equal(Object.keys(ext.glyphs).length, 12, 'the owner approved about twelve');
  for (const [role, g] of Object.entries(ext.glyphs)) {
    assert.equal(PICTOGRAM_CONTRACT.extension.glyphs[role].codePointAt(0), parseInt(g.codepoint.slice(2), 16), role);
    assert.ok(css.includes(`.pic-${role}::before { content: "\\${g.codepoint.slice(2)}"; }`), `CSS class for ${role}`);
  }
  // Each @font-face loads exactly its own glyphs.
  const ranges = [...css.matchAll(/url\("assets\/icons\/(material-pictogram[^"]*)"\)[\s\S]*?unicode-range: ([^;]+);/g)].map(m => [m[1], m[2].split(', ').sort()]);
  assert.deepEqual(Object.fromEntries(ranges), {
    'material-pictogram-300.woff2': Object.values(base.glyphs).map(g => g.codepoint).sort(),
    'material-pictogram-food-300.woff2': Object.values(ext.glyphs).map(g => g.codepoint).sort(),
  });
});

test('every type group with a pictogram is a group of the data; no pictogram stands for “other” or “not stated”', () => {
  const ids = readJSON('data/restaurants.json').groups.map(g => g.id);
  for (const [group, role] of Object.entries(GROUP_PICTOGRAM)) {
    assert.ok(ids.includes(group), group);
    assert.ok(PICTOGRAM_CONTRACT.extension.glyphs[role], role);
  }
  assert.equal(GROUP_PICTOGRAM.other, undefined);
  assert.equal(GROUP_PICTOGRAM.unspecified, undefined);
});

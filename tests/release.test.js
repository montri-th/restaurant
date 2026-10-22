/**
 * Release consistency: one cache tag on every entry file AND every ES module (import map), and one
 * product version across package.json, design-intent.json and the handoff JSON. A browser must never
 * pair an entry from this release with a module cached from the previous one (GitHub Pages caches ~10 min).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT, readJSON} from './helpers.js';

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const modules = () => [
  ...readdirSync(join(ROOT, 'js')).filter(f => f.endsWith('.js') && f !== 'launch.js').map(f => `js/${f}`),
  ...readdirSync(join(ROOT, 'js/vendor')).filter(f => f.endsWith('.js')).map(f => `js/vendor/${f}`),
];

test('one cache tag on every entry file and every module in the import map', () => {
  const tags = [...html.matchAll(/\?v=([0-9A-Za-z-]+)/g)].map(m => m[1]);
  assert.ok(tags.length >= 8 + modules().length, `${tags.length} tags`);
  const tag = tags[0];
  assert.match(tag, /^\d{8}-r\d{1,2}$/);
  assert.deepEqual([...new Set(tags)], [tag], 'a single cache tag across index.html');

  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const expected = Object.fromEntries(modules().sort().map(m => [`./${m}`, `./${m}?v=${tag}`]));
  assert.deepEqual(map, expected, 'every ES module (except the classic launch.js) is mapped to its tagged URL');
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'the import map precedes every module script');

  // Every static relative import in js/ resolves to a mapped module.
  for (const m of modules()) {
    const src = readFileSync(join(ROOT, m), 'utf8');
    for (const [, spec] of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const resolved = new URL(spec, `https://x.test/${m}`).pathname.slice(1);
      assert.ok(map[`./${resolved}`], `${m} imports ${spec} → ${resolved} is not in the import map`);
    }
  }
});

test('one product version across package.json, design intent and the handoff JSON', () => {
  const version = readJSON('package.json').version;
  for (const f of ['design-intent.json', 'handoff/product-brief.json', 'handoff/implementation-plan.json', 'handoff/product-statement.json']) {
    assert.equal(readJSON(f).productVersion, version, f);
  }
});

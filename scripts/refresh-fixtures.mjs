#!/usr/bin/env node
/**
 * Refresh the data fixtures from a run (2026-11-09): tests/fixtures/data-snapshot.json.
 *
 * Runs the whole suite with CITYMETER_FIXTURES_RECORD set, so every fixture(key, value) of tests/helpers.js writes the
 * value it computed instead of comparing it; every other assertion still runs, and a failing run writes nothing. The
 * values it replaces stay in `history` (newest first) — the rule of AGENTS.md: fixtures follow the data, from a run,
 * with the previous values beside the new ones, never edited by hand. `generatedFrom` names the data files the values
 * came from; tests/fixtures.test.js fails when the data moved and the fixtures did not.
 *
 *   node scripts/refresh-fixtures.mjs            # npm run fixtures
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {FIXTURE_DATA} from '../tests/helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'tests/fixtures/data-snapshot.json');
const sha256 = path => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');

const dir = mkdtempSync(join(tmpdir(), 'citymeter-fixtures-'));
const files = readdirSync(join(root, 'tests')).filter(f => f.endsWith('.test.js')).map(f => join('tests', f));
const run = spawnSync(process.execPath, ['--test', ...files], {cwd: root, env: {...process.env, CITYMETER_FIXTURES_RECORD: dir}, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
if (run.status !== 0) {
  rmSync(dir, {recursive: true, force: true});
  const failed = (run.stdout || '').split('\n').filter(l => /^not ok /.test(l));
  console.error(`fixtures not refreshed: the run failed on assertions that are not fixtures\n${failed.join('\n')}`);
  process.exit(1);
}
const values = {};
for (const f of readdirSync(dir)) {
  const part = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const [k, v] of Object.entries(part)) {
    if (k in values && !isDeepStrictEqual(values[k], v)) { console.error(`fixture ${k} differs between test files`); process.exit(1); }
    values[k] = v;
  }
}
rmSync(dir, {recursive: true, force: true});

const before = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {values: {}, history: []};
const release = JSON.parse(readFileSync(join(root, 'data/release.json'), 'utf8'));
const generatedFrom = {registerReadAt: release.register.readAt, sourceSha256: release.register.sourceSha256, files: Object.fromEntries(FIXTURE_DATA.map(p => [p, sha256(p)]))};
const replaced = Object.fromEntries(Object.keys(before.values || {}).filter(k => !isDeepStrictEqual(before.values[k], values[k])).map(k => [k, before.values[k]]));
const history = [...(Object.keys(replaced).length ? [{until: before.generatedFrom?.registerReadAt || null, values: replaced}] : []), ...(before.history || [])].slice(0, 12);
const sorted = Object.fromEntries(Object.keys(values).sort().map(k => [k, values[k]]));
const out = {
  rule: 'Numbers the tests pin that move with the register. Written by npm run fixtures from a run, never by hand; history keeps what each refresh replaced (newest first).',
  generatedFrom, values: sorted, history,
};
mkdirSync(dirname(OUT), {recursive: true});
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`fixtures: ${Object.keys(sorted).length} values, ${Object.keys(replaced).length} changed${Object.keys(replaced).length ? ` (${Object.keys(replaced).join(', ')})` : ''}`);

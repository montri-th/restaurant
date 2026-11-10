/**
 * The data fixtures belong to these data files (2026-11-09): tests/fixtures/data-snapshot.json is written by
 * `npm run fixtures` from a run over the data it names, and keeps the values it replaced. Data that moved without a
 * refresh fails here first, with the file that moved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT, readJSON, readBytes, sha256, FIXTURE_DATA, recordingFixtures, release} from './helpers.js';

test('data fixtures were recorded from these data files and this source set', {skip: recordingFixtures()}, () => {
  assert.ok(existsSync(join(ROOT, 'tests/fixtures/data-snapshot.json')), 'run npm run fixtures');
  const snap = readJSON('tests/fixtures/data-snapshot.json');
  assert.deepEqual(Object.keys(snap.generatedFrom.files), FIXTURE_DATA);
  for (const f of FIXTURE_DATA) assert.equal(sha256(readBytes(f)), snap.generatedFrom.files[f], `${f} changed since the fixtures — run npm run fixtures`);
  assert.equal(snap.generatedFrom.sourceSha256, release().register.sourceSha256, 'fixtures of another register read');
  assert.ok(Object.keys(snap.values).length >= 15);
  for (const h of snap.history) assert.ok(Object.keys(h.values).length && Object.keys(h.values).every(k => k in snap.values), 'history keeps replaced values of known keys');
});

/** Shared loaders for the node tests (data files are read once per process). */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {decodeDataset} from '../js/model.js';
import {buildAreaIndex} from '../js/areas.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = new Map();
export const readJSON = path => { if (!cache.has(path)) cache.set(path, JSON.parse(readFileSync(join(ROOT, path), 'utf8'))); return cache.get(path); };
export const readBytes = path => readFileSync(join(ROOT, path));
export const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

let loaded = null;
/** The shipped data set, decoded exactly as the browser does. */
export function load() {
  if (loaded) return loaded;
  const areasGeo = readJSON('data/areas.geojson'), districtsGeo = readJSON('data/districts.geojson'), provincesGeo = readJSON('data/provinces.geojson');
  const raw = readJSON('data/restaurants.json');
  const index = buildAreaIndex(areasGeo, districtsGeo, provincesGeo);
  const data = decodeDataset(raw, areasGeo);
  const covered = new Set(data.rows.map(r => r.area));
  let km2 = 0;
  for (const id of covered) km2 += index.byId.get(id)?.km2 || 0;
  loaded = {raw, data, index, areasGeo, districtsGeo, provincesGeo, covered, coverage: {km2, areas: covered.size}};
  return loaded;
}

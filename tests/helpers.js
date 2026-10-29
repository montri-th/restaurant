/** Shared loaders for the node tests (data files are read once per process). */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {decodeDataset, outletRows, deriveChainGroups, registerProvinces} from '../js/model.js';
import {buildAreaIndex} from '../js/areas.js';
import {decodeRegister} from '../js/register.js';

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
  // One population, as js/app.js#init builds it: the register's outlets join the rows; moved rows are counted there.
  const register = decodeRegister(readJSON('data/chains.json'), index);
  registerProvinces(register.provinces);
  const snapshotOf = new Map();
  for (const b of data.brands) for (const id of b.national || []) { const x = register.brandById.get(id); if (!x) continue; if (!snapshotOf.has(x.id)) snapshotOf.set(x.id, []); snapshotOf.get(x.id).push(b); }
  data.restaurants = data.rows;
  // 0.7.0: a chain's food type (its typed sheet-1 rows, else the register's format) reaches its outlets.
  const chainGroups = deriveChainGroups(register, {snapshotOf, rows: data.rows, groups: data.groups});
  data.outlets = outletRows(register, data.groups, {snapshotOf, index, chainGroups});
  data.chainGroups = chainGroups;
  data.rows = [...data.restaurants, ...data.outlets];
  const covered = new Set(data.rows.map(r => r.area).filter(Boolean));
  let km2 = 0;
  for (const id of covered) km2 += index.byId.get(id)?.km2 || 0;
  loaded = {raw, data, register, index, areasGeo, districtsGeo, provincesGeo, covered, coverage: {km2, areas: covered.size}};
  return loaded;
}

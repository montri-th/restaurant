/**
 * Chart models — every chart describes scopeRows (filters before any area
 * selection) over the same source membership as the map. Ranking and top-N
 * trimming happen only after every area has been summarised.
 */
import {rankAreas} from './profile-model.js';
import {PRICE_BUCKETS, PRICED} from './model.js';

export function buildChartModel(rows, index, groups, {limit = 20} = {}) {
  const ranking = rankAreas(Array.isArray(rows) ? rows : [], index);
  const areas = ranking.eligible.length ? ranking.eligible : ranking.small;
  return {areas: areas.slice(0, limit), totalAreas: ranking.all.length, eligibleAreas: ranking.eligible.length, minRows: ranking.minRows,
    mode: ranking.eligible.length ? 'density' : 'count', groups, totalRows: rows.length};
}

/** Area × food-type matrix of row counts (equal cells; zero is a measured 0 in this selection). */
export function areaMatrix(model, {areaLimit = 12} = {}) {
  const areas = model.areas.slice(0, areaLimit);
  const groups = model.groups;
  const cells = areas.flatMap(a => {
    const counts = new Array(groups.length).fill(0);
    for (const r of a.rows) counts[r.group]++;
    return groups.map(g => ({areaId: a.id, areaName: a.name, groupId: g.id, group: g.index, groupName: g.th, count: counts[g.index], total: a.count}));
  });
  return {areas, groups, cells, max: Math.max(0, ...cells.map(c => c.count))};
}

/** Price mix per area: priced buckets as shares of the priced rows; unspecified kept apart (never folded in). */
export function areaPrices(model, {areaLimit = 12} = {}) {
  return model.areas.slice(0, areaLimit).map(a => {
    const counts = Object.fromEntries(PRICE_BUCKETS.map(b => [b, 0]));
    for (const r of a.rows) counts[r.price]++;
    const priced = PRICED.reduce((s, b) => s + counts[b], 0);
    return {id: a.id, name: a.name, total: a.count, priced, unspecified: counts.UNSPECIFIED, counts,
      shares: Object.fromEntries(PRICED.map(b => [b, priced ? counts[b] / priced : 0]))};
  });
}

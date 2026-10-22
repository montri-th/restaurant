import test from 'node:test';
import assert from 'node:assert/strict';
import {load, readJSON} from './helpers.js';
import {buildOverview, buildAreaProfile, buildDistrictProfile, buildVenueProfile, buildStoreDetail, describeGeometry, describePrice} from '../js/profile-model.js';
import {renderOverview, renderArea, renderDistrict, renderVenue, renderStore, renderFilterChips, provenance, dens} from '../js/panel.js';
import {summarizeAreaInsight} from '../js/area-insight.js';
import {summarize, productionLink, PRICE_LABELS, filterRows} from '../js/model.js';
import {buildChartModel, areaMatrix, areaPrices} from '../js/chart-model.js';
import {buildBreadcrumb, renderBreadcrumb, breadcrumbText, productionHref} from '../js/breadcrumb.js';
import {configureBrandLogos} from '../js/brand-logos.js';
import {configureVenueLogos} from '../js/venue-logos.js';
import {CUES, CUE_PATHS, GROUP_SERIES, cueMarkup, seriesOf} from '../js/cues.js';

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const setup = () => {
  const ctx = load();
  configureBrandLogos(readJSON('data/brand-logos.json'));
  configureVenueLogos(readJSON('data/venue-logos.json'));
  return ctx;
};

test('every panel view ends with dataset · source · date · boundary and the popularity caveat', () => {
  const {data, index, coverage} = setup();
  const meta = data.meta;
  const insight = summarizeAreaInsight(data.rows, index, {coverage});
  const views = {
    overview: renderOverview({insight, summary: summarize(data.rows), overview: buildOverview(data.rows, index), focusMode: 'auto', classOf: () => '#000', provinces: [], meta, coverage, province: ''}),
    area: renderArea(buildAreaProfile(data.rows, '100204', index, data.groups), meta),
    district: renderDistrict(buildDistrictProfile(data.rows, '1002', index, data.groups), () => '#000', meta),
    venue: renderVenue(buildVenueProfile(data.rows, data.venues.find(v => v.host), index, data.groups, {hosted: true}), index, meta),
    store: renderStore(buildStoreDetail(data.rows.find(r => r.brand && r.venue), {scopeRows: data.rows, index, groups: data.groups}), {...meta, index}),
  };
  for (const [name, html] of Object.entries(views)) {
    const t = text(html);
    assert.ok(t.includes('ชุดข้อมูล CityMETER Restaurants'), `${name}: dataset`);
    assert.ok(t.includes('แหล่ง CityMETER Restaurants API สาธารณะ'), `${name}: source`);
    assert.ok(t.includes('ดึงข้อมูล 22 ต.ค. 2569'), `${name}: date`);
    assert.ok(/ขอบเขต \S/.test(t), `${name}: boundary`);
    assert.ok(t.includes('ไม่ใช่ยอดขาย'), `${name}: rating/reviews are popularity proxies`);
  }
  assert.ok(text(views.overview).includes('99.7 ร้าน/ตร.กม.'));
  assert.ok(text(views.overview).includes('จัดอันดับเฉพาะพื้นที่ที่มีอย่างน้อย 30 ร้าน'));
  assert.ok(text(views.venue).includes('ไม่ได้ยืนยันว่าร้านตั้งอยู่ภายใน'));
  assert.ok(text(views.store).includes('จับคู่จากชื่อร้าน'));
  assert.ok(!text(views.store).includes('สาขาอื่น'), 'a name match is never called a branch');
  assert.match(provenance(meta, 'x'), /href="https:\/\/landometer\.com\/v3\/citymeter\?d=restaurant"/);
});

test('missing stays missing in views: no rating → “ไม่มีคะแนน…”, no price → “ไม่ระบุราคา (ไม่ใช่ราคา 0)”', () => {
  const {data, index} = setup();
  const r = data.rows.find(x => !Number.isFinite(x.rating) && x.price === 'UNSPECIFIED');
  const t = text(renderStore(buildStoreDetail(r, {scopeRows: data.rows, index, groups: data.groups}), {...data.meta, index}));
  assert.ok(t.includes('ไม่มีคะแนนในแหล่งข้อมูล'));
  assert.ok(t.includes('ไม่ระบุราคา (ไม่ใช่ราคา 0)'));
  const priced = data.rows.find(x => Number.isFinite(x.p0) && Number.isFinite(x.p1) && x.p0 !== x.p1);
  assert.match(describePrice(priced).range, /–/);
  assert.equal(PRICE_LABELS.R100_300, 'เกิน 100–300 บาท', 'labels follow the source thresholds (> 100 … ≤ 300)');
  assert.match(describeGeometry(r).label, /^ตำแหน่งจาก tile z10\/\d+\/\d+ · ช่อง 9\.55 ม\.$/);
});

test('charts: density bars, area × type matrix with equal cells, price shares with unspecified kept apart', () => {
  const {data, index} = setup();
  const m = buildChartModel(data.rows, index, data.groups);
  assert.equal(m.mode, 'density');
  assert.equal(m.areas.length, 20);
  for (let i = 1; i < m.areas.length; i++) assert.ok(m.areas[i - 1].density >= m.areas[i].density);
  const mx = areaMatrix(m);
  assert.equal(mx.cells.length, 12 * data.groups.length);
  for (const a of mx.areas) assert.equal(mx.cells.filter(c => c.areaId === a.id).reduce((s, c) => s + c.count, 0), a.count, 'cells add up to the area');
  for (const a of areaPrices(m)) {
    assert.equal(a.priced + a.unspecified, a.total);
    if (a.priced) assert.ok(Math.abs(Object.values(a.shares).reduce((s, v) => s + v, 0) - 1) < 1e-9, 'shares are of the priced rows only');
  }
});

test('breadcrumb follows production: ประเทศไทย › จังหวัด › เขต/อำเภอ › แขวง/ตำบล with /D/ and /S/ deep links', () => {
  const {index} = setup();
  const area = index.byId.get('100204');
  const crumbs = buildBreadcrumb({province: 'BKK', area});
  assert.equal(breadcrumbText(crumbs), 'ประเทศไทย › กรุงเทพมหานคร › เขตดุสิต › แขวงสี่แยกมหานาค');
  assert.equal(crumbs.at(-1).current, true);
  assert.equal(crumbs[2].href, 'https://landometer.com/v3/citymeter/BKK/D/1002?d=restaurant');
  assert.equal(productionHref(crumbs), 'https://landometer.com/v3/citymeter/BKK/S/100204?d=restaurant');
  const html = renderBreadcrumb(crumbs);
  assert.ok(html.includes('aria-current="location"') && html.includes('crumb-ellipsis'), 'four levels fold on narrow screens');
  const nbi = index.byId.get('120612');
  assert.equal(breadcrumbText(buildBreadcrumb({area: nbi})).split(' › ')[2].startsWith('อำเภอ'), true);
  const venue = buildBreadcrumb({venue: {id: 'RV-1', name: 'Central Pinklao', province: 'BKK'}});
  assert.deepEqual(venue.map(c => c.level), ['country', 'province', 'venue'], 'a venue is never placed under a แขวง');
  assert.equal(productionLink(), 'https://landometer.com/v3/citymeter?d=restaurant');
  assert.equal(productionLink({province: 'NBI'}), 'https://landometer.com/v3/citymeter/NBI?d=restaurant');
});

test('food-type groups bind to LDS series by stable id with the series shape cue', () => {
  const {data} = setup();
  assert.deepEqual(CUES, ['circle', 'square', 'triangle', 'diamond', 'cross', 'star', 'hexagon', 'ring', 'dash', 'plus']);
  const used = Object.values(GROUP_SERIES);
  assert.equal(new Set(used).size, 10, 'one series per group');
  assert.ok(used.every(n => n >= 1 && n <= 10));
  for (const g of data.groups) assert.equal(g.series, seriesOf(g.id));
  for (const name of CUES) assert.ok(CUE_PATHS[name].startsWith('M'));
  assert.match(cueMarkup(8), /class="cue-shape category-8".*data-cue="ring".*aria-hidden="true"/);
  const r = data.rows.find(x => x.groupId === 'thai');
  assert.equal(r.series, 1);
});

test('filter chips escape user text and offer one clear-all', () => {
  const html = renderFilterChips({search: '<b>ก๋วยเตี๋ยว</b>', group: 'thai', price: '', province: 'BKK', brand: '', venue: ''},
    {group: {thai: 'อาหารไทย'}, price: {}, province: {BKK: 'กรุงเทพมหานคร'}, brand: {}, venue: {}});
  assert.ok(!html.includes('<b>'));
  assert.equal((html.match(/data-id="all"/g) || []).length, 1);
});

test('density format: a measured non-zero density never prints as zero; labels and panel share it', () => {
  assert.equal(dens(1 / 76.5), '0.01', 'one restaurant in the largest covered subdistrict (76.5 km²)');
  assert.equal(dens(0.004), '<0.01');
  assert.equal(dens(0.0549), '0.05');
  assert.equal(dens(111.8), '111.8');
  assert.equal(dens(0), '0');
  assert.equal(dens(null), '—');
  assert.equal(dens(NaN), '—');
});

test('venue header says how much of its total is the venue\'s own listing (e.g. the mall row)', () => {
  const {data, index} = setup();
  const venue = data.venues.find(v => v.id === 'RV-02fbbcc675cf1548');
  const p = buildVenueProfile(data.rows, venue, index, data.groups, {hosted: true});
  assert.equal(p.count, 12);
  assert.equal(p.reviews, 30900);
  assert.equal(p.entityRows, 1);
  assert.equal(p.entityReviews, 24563);
  assert.ok(text(renderVenue(p, index, {})).includes('ตัวเลขรวม 1 รายการที่เป็นชื่อสถานที่เอง (24,563 รีวิว)'));
});

test('empty selections: no_data is never shown as 0; measured_zero offers the areas where the filters match', () => {
  const {data, index, covered} = setup();
  // Uncovered subdistrict (no row in the source): no tiles, no density, an explicit no-data note.
  const unc = [...index.byId.values()].find(a => !covered.has(a.id));
  const p = buildAreaProfile(data.rows, unc.id, index, data.groups, {covered});
  assert.equal(p.coverageState, 'no_data');
  assert.equal(p.density, null);
  const t = text(renderArea(p, {}));
  assert.ok(t.includes(`ไม่มีข้อมูลร้านจากแหล่งข้อมูลใน${p.words.area}${unc.name}`), t.slice(0, 300));
  assert.ok(!t.includes('ร้าน/ตร.กม.') && !/\b0 ร้าน\b/.test(t), 'no zero tiles for no_data');
  // An uncovered district is no_data too.
  const ud = [...index.districtById.values()].find(d => !d.areas.some(a => covered.has(a.id)));
  const dp = buildDistrictProfile(data.rows, ud.id, index, data.groups, {covered});
  assert.equal(dp.coverageState, 'no_data');
  assert.ok(text(renderDistrict(dp, () => ({}), {})).includes('ไม่มีข้อมูลร้านจากแหล่งข้อมูล'));
  // Covered area, filter leaves 0: measured zero + the count found elsewhere.
  const kfc = filterRows(data.rows, {brand: 'RBR-kfc'});
  const z = buildAreaProfile(kfc, '100204', index, data.groups, {covered});
  assert.equal(z.coverageState, 'measured_zero');
  assert.equal(z.density, 0);
  const zt = text(renderArea(z, {}));
  assert.ok(zt.includes('ไม่พบร้านตามตัวกรองในแขวงสี่แยกมหานาค'));
  assert.ok(zt.includes(`ตัวกรองเดียวกันพบ ${new Intl.NumberFormat('th-TH').format(kfc.length)} ร้านในพื้นที่อื่น`));
  assert.ok(renderArea(z, {}).includes('data-action="leave-area"'));
  // A covered area with rows stays measured.
  assert.equal(buildAreaProfile(data.rows, '100204', index, data.groups, {covered}).coverageState, 'measured');
});

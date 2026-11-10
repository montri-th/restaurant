import test from 'node:test';
import assert from 'node:assert/strict';
import {load, readJSON, fixture} from './helpers.js';
import {buildOverview, buildAreaProfile, buildDistrictProfile, buildVenueProfile, buildStoreDetail, buildBuildingProfile, describeGeometry, describePrice} from '../js/profile-model.js';
import {renderOverview, renderArea, renderDistrict, renderVenue, renderBuilding, renderStore, renderFilterChips, provenance, dens} from '../js/panel.js';
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

// Owner 2026-11-03 11:04 “ไม่แสดง caveats” (0.9.0): no limitation sentence in a view; provenance and the word อนุมาน stay.
const CAVEATS = /ไม่ใช่ยอดขาย|ไม่ได้ยืนยัน|ยังไม่ยืนยัน|ไม่ใช่ราคา 0|ไม่ได้แปลว่า|ไม่ใช่ผลรังวัด|ตามแหล่ง|อยู่ในตัวเลข|ไม่ใช่ร้านทั้งหมด|ศูนย์ที่วัดได้|อันดับเฉพาะพื้นที่/;

test('every panel view ends with dataset · source · date · boundary, and carries no caveat (0.9.0)', () => {
  const {data, index, coverage} = setup();
  const meta = data.meta;
  const insight = summarizeAreaInsight(data.rows, index, {coverage});
  const views = {
    overview: renderOverview({insight, summary: summarize(data.rows), overview: buildOverview(data.rows, index), focusMode: 'auto', classOf: () => '#000', provinces: [], meta, coverage, province: ''}),
    area: renderArea(buildAreaProfile(data.rows, '100204', index, data.groups), meta),
    district: renderDistrict(buildDistrictProfile(data.rows, '1002', index, data.groups), () => '#000', meta),
    venue: renderVenue(buildVenueProfile(data.rows, data.venues.find(v => v.host), index, data.groups, {hosted: true}), index, meta),
    store: renderStore(buildStoreDetail(data.rows.find(r => r.brand && r.venue), {scopeRows: data.rows, index, groups: data.groups}), {...meta, index}),
    building: renderBuilding(buildBuildingProfile({key: 'osm:1', kind: 'osm', rows: data.rows.filter(r => r.area === '100204').slice(0, 5), height: 24}, index, data.groups), {...meta, index}),
  };
  for (const [name, html] of Object.entries(views)) {
    const t = text(html);
    assert.ok(t.includes('ชุดข้อมูล CityMETER Restaurants'), `${name}: dataset`);
    assert.ok(t.includes('แหล่ง CityMETER Restaurants API สาธารณะ'), `${name}: source`);
    assert.ok(t.includes('ดึงข้อมูล 22 ต.ค. 2569'), `${name}: date`);
    assert.ok(/ขอบเขต \S/.test(t), `${name}: boundary`);
    assert.ok(!CAVEATS.test(t), `${name}: no caveat — ${t.match(CAVEATS)}`);
  }
  // One population (0.6.0): the first Aha reads restaurants and chain outlets together (fixture in tests/insight.test.js).
  assert.ok(text(views.overview).includes(`${fixture('firstAha.density', dens(insight.density))} ร้าน/ตร.กม.`), text(views.overview).slice(0, 300));
  // One vocabulary (0.7.0): the two sheets are told apart in the provenance line only — never in a tile, an Aha or a hint.
  const ov = text(views.overview);
  assert.ok(ov.includes('ร้าน = ร้านในชุดข้อมูล 7 จังหวัด + สาขาเครือทั่วประเทศ'), 'the split lives in the provenance line, as a definition');
  assert.equal((ov.match(/ร้าน = /g) || []).length, 1, 'the split is stated once');
  assert.ok(!/สาขาในทะเบียน|ทะเบียนร้านเครือ · ทั่วประเทศ|ดูทะเบียนร้านเครือ/.test(ov), 'no register framing in the main flow');
  assert.ok(!ov.includes('อันดับเฉพาะพื้นที่'), 'the eligibility rule still ranks, but is method, not page copy (0.9.0)');
  assert.ok(ov.includes('ค้นต่อ') && /Google ·/.test(ov) && !views.overview.includes('udm=50'), 'the overview offers an outbound Google question (no AI Mode link: 0.8.1)');
  assert.ok(!text(views.venue).includes('ไม่ได้ยืนยัน'));
  assert.ok(/เครือร้าน \S+.* อนุมาน/.test(text(views.store)), 'a name-matched chain says อนุมาน, in one word');
  assert.ok(!text(views.store).includes('สาขาอื่น'), 'a name match is never called a branch');
  assert.match(provenance(meta, 'x'), /href="https:\/\/landometer\.com\/v3\/citymeter\?d=restaurant"/);
});

test('missing stays missing in views: no rating → “ไม่มีคะแนน”, no price → “ไม่ระบุราคา” (never 0)', () => {
  const {data, index} = setup();
  const r = data.rows.find(x => !Number.isFinite(x.rating) && x.price === 'UNSPECIFIED');
  const t = text(renderStore(buildStoreDetail(r, {scopeRows: data.rows, index, groups: data.groups}), {...data.meta, index}));
  assert.ok(t.includes('ไม่มีคะแนน') && !/คะแนน\s*0\b/.test(t));
  assert.ok(t.includes('ไม่ระบุราคา') && !/ราคา\s*0\b/.test(t));
  const priced = data.rows.find(x => Number.isFinite(x.p0) && Number.isFinite(x.p1) && x.p0 !== x.p1);
  assert.match(describePrice(priced).range, /–/);
  assert.equal(PRICE_LABELS.P2, '101–200 บาท', 'labels read as ranges (N18): the tier (100, 200]');
  assert.equal(PRICE_LABELS.P6, 'เริ่ม 1,000 บาทขึ้นไป', 'the open top tier says it starts at 1,000');
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
  assert.deepEqual(venue.map(c => c.level), ['country', 'province', 'site'], 'a venue is never placed under a แขวง');
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

test('0.8.0 segments in views: price tiers and chain sizes are labelled bars that filter; a store shows its band (how it was counted in the title)', async () => {
  const {data, index} = setup();
  const {renderOutlet} = await import('../js/register-panel.js');
  const {SIZE_LABELS, LEGACY_PRICE_LABELS} = await import('../js/model.js');
  const html = renderArea(buildAreaProfile(data.rows, '100402', index, data.groups), {...data.meta, segmentsOn: '2026-11-02'});
  const t = text(html);
  assert.ok(t.includes('ขนาดเครือ') && t.includes('200+ สาขา') && html.includes('title="ดูเฉพาะเครือระดับชาติ 200+ สาขา"'), 'the area profile reads chain size (short bars, full name in the title)');
  assert.ok(/data-action="filter-field" data-id="size" data-value="S5"/.test(html) && /data-action="filter-field" data-id="price" data-value="P2"/.test(html), 'bars filter by tier and size');
  assert.ok(!t.includes('ร้านอิสระ'), 'one observed row is never called an independent shop — and no caveat says so either (0.9.0)');
  assert.ok(t.includes('ขนาดเครือและหมวดอาหารจัดกลุ่ม 2 พ.ย. 2569'), 'the size and food bars cite the classification date in the one provenance line');
  assert.ok(!/size-fill[^"]*" style="[^"]*background/.test(html), 'size bars use one neutral fill, no second colour family');
  // A store with a chain: band + basis; a lifted row says it took its chain's larger size.
  const lifted = data.restaurants.find(r => r.sizeLifted && r.venue);
  const st = text(renderStore(buildStoreDetail(lifted, {scopeRows: data.rows, index, groups: data.groups}), {...data.meta, index}));
  const liftedHtml = renderStore(buildStoreDetail(lifted, {scopeRows: data.rows, index, groups: data.groups}), {...data.meta, index});
  assert.ok(st.includes(`ขนาดเครือ ${SIZE_LABELS[lifted.size]} อนุมาน`) && liftedHtml.includes('title="ใช้ขนาดที่ใหญ่ที่สุดที่นับได้ของเครือเดียวกัน"'), st.slice(0, 400));
  const single = data.restaurants.find(r => !r.brand && Number.isFinite(r.p1) && Number.isFinite(r.p0) && r.p0 !== r.p1);
  const singleDetail = buildStoreDetail(single, {scopeRows: data.rows, index, groups: data.groups});
  const sst = text(renderStore(singleDetail, {...data.meta, index}));
  assert.ok(sst.includes('1 สาขาที่พบในข้อมูล') && !sst.includes('ร้านอิสระ') && sst.includes(`ราคา ${singleDetail.price.range}`), 'the stated price, not the tier mechanics');
  // The point-of-sale registry is never sized.
  const cpf = data.outlets.find(o => o.sizeBasis === 'x');
  const ot = text(renderOutlet({reg: load().register, outlet: cpf, area: null, land: null, sameBrand: [], group: data.groups[cpf.group]}));
  assert.ok(ot.includes('ไม่จัดขนาด') && !ot.includes('เครือระดับชาติ'), ot.slice(0, 300));
  // Chips name the size and a legacy two-tier price link.
  const chips = text(renderFilterChips({search: '', group: '', price: 'P2,P3', size: 'S5', province: '', brand: '', venue: ''}, {group: {}, price: {...PRICE_LABELS, ...LEGACY_PRICE_LABELS}, size: SIZE_LABELS, province: {}, brand: {}, venue: {}}));
  assert.ok(chips.includes('101–300 บาท (ช่วงของลิงก์เดิม)') && chips.includes('เครือระดับชาติ 200+ สาขา'));
});

test('outbound (0.8.1): questions open Google Search at once; the store name is said once; Street View turns toward the place', async () => {
  const {outboundFor, streetView, streetLines, cameraToward, googleSearch} = await import('../js/outbound.js');
  const store = outboundFor({kind: 'store', brand: 'Prime Burger', branch: 'Prime Burger Khaosan Road', area: 'แขวงบวรนิเวศ', district: 'เขตพระนคร', province: 'กรุงเทพมหานคร', lat: 13.7588, lng: 100.4973});
  const ask = store.find(l => l.kind === 'ai');
  assert.equal(ask.question, 'Prime Burger Khaosan Road แขวงบวรนิเวศ เขตพระนคร กรุงเทพมหานคร รีวิว เมนู ราคา เวลาเปิด-ปิด', 'the brand is not said twice');
  assert.equal(ask.href, googleSearch(ask.question));
  assert.ok(ask.href.startsWith('https://www.google.com/search?q=') && !ask.href.includes('udm='), 'a plain search: no confirmation step');
  assert.equal(outboundFor({kind: 'store', brand: 'MK', branch: 'Siam Paragon', lat: 13.7, lng: 100.5}).find(l => l.kind === 'ai').question.startsWith('MK Siam Paragon'), true);
  const sv = store.find(l => l.kind === 'street');
  assert.deepEqual(sv.aim, {lat: 13.7588, lng: 100.4973, hint: ''});
  assert.equal(outboundFor({kind: 'store', name: 'ร้านข้าวมันไก่', hint: 'ร้านข้าวมันไก่ ถนนข้าวสาร', lat: 13.7588, lng: 100.4973}).find(l => l.kind === 'street').aim.hint, 'ร้านข้าวมันไก่ ถนนข้าวสาร');
  assert.equal(outboundFor({kind: 'area', area: 'แขวงสีลม', lat: 13.72, lng: 100.53}).find(l => l.kind === 'street').aim, null, 'an area label point is not aimed at');
  // A street 20 m south of the point, running east–west: stand on it and look north (0°); one 30 m east: look west (270°).
  const p = {lat: 13.75, lng: 100.5}, m = 1 / 111320, mx = m / Math.cos((13.75 * Math.PI) / 180);
  const south = [[100.5 - 50 * mx, 13.75 - 20 * m], [100.5 + 50 * mx, 13.75 - 20 * m]];
  const east = [[100.5 + 30 * mx, 13.75 - 60 * m], [100.5 + 30 * mx, 13.75 + 60 * m]];
  const c1 = cameraToward(p, [south]);
  assert.ok(Math.abs(c1.distance - 20) < 0.1 && (c1.heading < 0.5 || c1.heading > 359.5), JSON.stringify(c1));
  assert.ok(Math.abs(cameraToward(p, [east]).heading - 270) < 0.5);
  assert.ok(Math.abs(cameraToward(p, [south, east]).distance - 20) < 0.1, 'the nearest street wins');
  assert.equal(cameraToward(p, [[[100.5 - mx, 13.75], [100.5 + mx, 13.75]]]), null, 'a point on the street: side unknown, keep the default view');
  assert.equal(cameraToward(p, [[[100.5 - mx, 13.75 - 400 * m], [100.5 + mx, 13.75 - 400 * m]]]), null, 'no street within reach');
  const url = streetView(p.lat, p.lng, c1);
  assert.ok(url.includes('map_action=pano') && url.includes('heading=0') && url.includes(`viewpoint=${c1.lat.toFixed(6)}%2C${c1.lng.toFixed(6)}`), url);
  assert.equal(streetView(p.lat, p.lng), 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=13.750000%2C100.500000');
  // Map features: streets only (no expressway, ramp, tunnel, path or rail), lines near the point only.
  const f = (cls, coords, extra = {}) => ({properties: {class: cls, ...extra}, geometry: {type: 'LineString', coordinates: coords}});
  const lines = streetLines([f('minor', south), f('motorway', east), f('path', east), f('primary', east, {brunnel: 'tunnel'}), f('primary', east, {ramp: 1}), f('rail', south),
    f('secondary', [[101.5, 14.5], [101.6, 14.6]]), {properties: {class: 'service'}, geometry: {type: 'MultiLineString', coordinates: [east]}}], p);
  assert.deepEqual(lines, [south, east]);
  // A corner shop named after one of its streets faces that street (Prime Burger Khaosan Road, live 3 Nov: Tanao Road
  // 12 m west, Khao San Road 14 m south) — the nearest street alone would show the neighbours on Tanao Road.
  const {streetCore, namedStreetLines, aimCamera} = await import('../js/outbound.js');
  assert.equal(streetCore('Khao San Road'), 'khaosan');
  assert.equal(streetCore('ถนนข้าวสาร'), 'ข้าวสาร');
  assert.equal(streetCore('Soi Sukhumvit 24'), 'sukhumvit24');
  const tanao = [[100.5 - 12 * mx, 13.75 - 60 * m], [100.5 - 12 * mx, 13.75 + 60 * m]];
  const khaosan = [[100.5 - 80 * mx, 13.75 - 14 * m], [100.5 + 80 * mx, 13.75 - 14 * m]];
  // MapLibre's query features expose `geometry` through a prototype getter (a spread copy loses it — the 0.8.2 live bug).
  class QueryFeature { constructor(properties, coordinates) { this.properties = properties; this._c = coordinates; } get geometry() { return {type: 'LineString', coordinates: this._c}; } }
  const names = [new QueryFeature({class: 'tertiary', name: 'ถนนตะนาว', 'name:en': 'Tanao Road'}, tanao), new QueryFeature({class: 'minor', name: 'ถนนข้าวสาร', 'name:en': 'Khao San Road'}, khaosan)];
  const plain = aimCamera(p, [tanao, khaosan], []);
  assert.ok(plain.by === 'nearest' && Math.abs(plain.heading - 90) < 0.5, 'without a hint: the nearest street (Tanao), looking east');
  const named = namedStreetLines(names, p, 'Prime Burger Khaosan Road');
  assert.deepEqual(named, [khaosan]);
  const aimed = aimCamera(p, [tanao, khaosan], named);
  assert.ok(aimed.by === 'name' && (aimed.heading < 0.5 || aimed.heading > 359.5) && Math.abs(aimed.distance - 14) < 0.1, JSON.stringify(aimed));
  assert.deepEqual(namedStreetLines(names, p, 'ร้านข้าวมันไก่ ถนนข้าวสาร'), [khaosan], 'a Thai address names the street too');
  assert.deepEqual(namedStreetLines(names, p, 'Prime Burger'), [], 'no street word in the hint');
  const far = [[100.5 - 80 * mx, 13.75 - 100 * m], [100.5 + 80 * mx, 13.75 - 100 * m]];
  assert.equal(aimCamera(p, [tanao, far], [far]).by, 'nearest', 'a named street far beyond the nearest one is not used');
  // The store's Maps link opens the business (name + area), whose card shows the storefront.
  assert.equal(store.find(l => l.kind === 'maps').href, 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Prime Burger Khaosan Road แขวงบวรนิเวศ เขตพระนคร กรุงเทพมหานคร'));
});

test('outbound in English (?lang=en): the same links, the questions in English, names as the data gives them', async () => {
  const {outboundFor} = await import('../js/outbound.js');
  const THAI = /[ก-๙]/;
  // On an English page js/lang.js has registered the English names; here they are passed in English already.
  const ctx = {kind: 'store', brand: 'Prime Burger', branch: 'Prime Burger Khaosan Road', area: 'Bowon Niwet', district: 'Phra Nakhon', province: 'Bangkok', lat: 13.7588, lng: 100.4973};
  const en = outboundFor(ctx, 'en');
  assert.deepEqual(outboundFor(ctx), outboundFor(ctx, 'th'), 'a Thai page (the default) keeps the Thai questions');
  assert.deepEqual(en.map(l => [l.kind, l.label]), outboundFor(ctx, 'th').map(l => [l.kind, l.label]), 'same links and labels: js/lang-en.js translates the labels');
  assert.equal(en[0].question, 'Prime Burger Khaosan Road (Bowon Niwet, Phra Nakhon, Bangkok): reviews, menu, prices and opening hours');
  assert.equal(en.find(l => l.kind === 'maps').question, 'Prime Burger Khaosan Road, Bowon Niwet, Phra Nakhon, Bangkok');
  assert.deepEqual(en.find(l => l.kind === 'street').aim, {lat: 13.7588, lng: 100.4973, hint: ''}, 'Street View still turns toward the place');
  assert.ok(!en.some(l => l.href.includes('udm=')), 'a plain search: no confirmation step');
  for (const kind of ['store', 'chain', 'company', 'area', 'district', 'venue', 'country']) {
    const links = outboundFor({kind, name: 'MK', brand: 'MK', area: 'Si Lom', district: 'Bang Rak', province: 'Bangkok', lat: 13.72, lng: 100.53}, 'en');
    assert.ok(links.some(l => l.kind === 'ai'), kind);
    for (const l of links) assert.ok(!THAI.test(l.question) && !THAI.test(decodeURIComponent(l.href)), `${kind}: ${l.question} ${l.href}`);
  }
  assert.equal(outboundFor({kind: 'area', area: 'Si Lom', district: 'Bang Rak', province: 'Bangkok'}, 'en')[0].question,
    'Restaurants around Si Lom, Bang Rak, Bangkok: which are well known, which kinds are most common and roughly what they cost');
  assert.equal(outboundFor({kind: 'district', area: '', district: 'Bang Rak', province: 'Bangkok'}, 'en')[0].question.startsWith('Restaurants around Bang Rak, Bangkok:'), true, 'a place said once');
  // A building of the spatial join has no name: its area stands in.
  const building = outboundFor({kind: 'venue', name: 'อาคาร แขวงสีลม', building: 'Si Lom', province: 'Bangkok', lat: 13.72, lng: 100.53}, 'en');
  assert.equal(building[0].question, 'Restaurants in a building in Si Lom (Bangkok): which are there, on which floors and the newest ones');
  assert.equal(building.find(l => l.kind === 'maps').href, 'https://www.google.com/maps/search/?api=1&query=13.720000%2C100.530000', 'a point opens the point');
  assert.equal(outboundFor({kind: 'country', province: 'Phuket'}, 'en')[0].question, 'Restaurant chains with the most branches in Thailand and the brands expanding now in Phuket');
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
  // 0.6.0: six of this venue's twelve rows were moved to the chain register by the owner and are counted there.
  const p = buildVenueProfile(data.rows, venue, index, data.groups, {hosted: true});
  assert.equal(p.count, 6);
  assert.equal(p.reviews, 27167);
  const all = buildVenueProfile([...data.restaurants, ...data.moved], venue, index, data.groups, {hosted: true});
  assert.equal(all.count, 12); assert.equal(all.reviews, 30900);
  assert.equal(p.entityRows, 1);
  assert.equal(p.entityReviews, 24563);
  assert.ok(text(renderVenue(p, index, {})).includes('รวม 1 รายการที่เป็นชื่อสถานที่เอง (24,563 รีวิว)'));
});

test('empty selections: no_data is never shown as 0; measured_zero offers the areas where the filters match', () => {
  const {data, index, covered} = setup();
  // Uncovered subdistrict (no row in the source): no tiles, no density, an explicit no-data note.
  const unc = [...index.byId.values()].find(a => !covered.has(a.id));
  const p = buildAreaProfile(data.rows, unc.id, index, data.groups, {covered});
  assert.equal(p.coverageState, 'no_data');
  assert.equal(p.density, null);
  const t = text(renderArea(p, {}));
  assert.ok(t.includes(`ไม่มีข้อมูลร้านใน${p.words.area}${unc.name}`), t.slice(0, 300));
  assert.ok(!t.includes('ร้าน/ตร.กม.') && !/\b0 ร้าน\b/.test(t), 'no zero tiles for no_data');
  // An uncovered district is no_data too.
  const ud = [...index.districtById.values()].find(d => !d.areas.some(a => covered.has(a.id)));
  const dp = buildDistrictProfile(data.rows, ud.id, index, data.groups, {covered});
  assert.equal(dp.coverageState, 'no_data');
  assert.ok(text(renderDistrict(dp, () => ({}), {})).includes('ไม่มีข้อมูลร้านใน'));
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

test('venue and store copy mark name links อนุมาน; spatial results say “จุดตกในอาคาร”, never “ตั้งอยู่ใน”; no caveats (0.9.0)', () => {
  const {data, index} = setup();
  const meta = data.meta;
  // Name-derived place.
  const charn = data.venues.find(v => v.name === 'Charn At The Avenue');
  const pc = buildVenueProfile(data.rows, charn, index, data.groups);
  assert.equal(pc.nameDerived, true);
  assert.equal(pc.matched.auto, 13, 'one of the 14 name-derived rows was moved to the register (0.6.0)');
  const tc = text(renderVenue(pc, index, meta));
  assert.ok(tc.includes('สถานที่จากชื่อร้าน') && !CAVEATS.test(tc), tc.slice(0, 400));
  // Sheet venue with rows found by their name ending.
  const pm = data.venues.find(v => v.name === 'Panya Market');
  const suffix = data.rows.filter(r => r.venue?.id === pm.id && r.venueMatch === 'suffix').length;
  assert.ok(suffix >= 1);
  const tg = text(renderVenue(buildVenueProfile(data.rows, pm, index, data.groups), index, meta));
  assert.ok(!CAVEATS.test(tg), tg.slice(0, 400));
  // Store facts.
  const store = name => text(renderStore(buildStoreDetail(data.rows.find(r => r.name === name), {scopeRows: data.rows, index, groups: data.groups}), {...meta, index}));
  assert.ok(/สถานที่ Panya Market อนุมาน/.test(store('Shabu Shabu Nangnai (Panya Market Branch)')), 'a venue found by the name ending says อนุมาน');
  const autoRow = data.rows.find(r => r.venue?.id === charn.id);
  assert.ok(store(autoRow.name).includes('Charn At The Avenue อนุมาน'));
  // Spatial join results (venue section, store fact, building panel).
  const sp = {buildings: 2, own: 9, others: data.rows.filter(r => !r.venue).slice(0, 3)};
  const ts = text(renderVenue(buildVenueProfile(data.rows, charn, index, data.groups, {spatial: sp}), index, meta));
  assert.ok(ts.includes('ร้านอื่นที่จุดตกในอาคารเดียวกัน') && !CAVEATS.test(ts));
  const r0 = data.rows.find(r => r.area === '100204');
  const tb = text(renderStore(buildStoreDetail(r0, {scopeRows: data.rows, index, groups: data.groups, building: {key: 'osm:7', others: 4}}), {...meta, index}));
  assert.ok(tb.includes('จุดตกในอาคารเดียวกันอีก 4 ร้าน'));
  const b = buildBuildingProfile({key: 'osm:1', kind: 'osm', rows: data.rows.filter(r => r.area === '100204').slice(0, 5), height: 24.4}, index, data.groups);
  const tbu = text(renderBuilding(b, {...meta, index}));
  assert.ok(tbu.includes('ร้านที่จุดตกในอาคารนี้') && tbu.includes('สูงราว 24 ม.') && !CAVEATS.test(tbu));
  for (const t of [tc, tg, ts, tb, tbu]) assert.ok(!/ตั้งอยู่ใน/.test(t), 'no located-inside claim');
  // A building without reviewed rows shows no review total (missing ≠ 0).
  const noReviews = buildBuildingProfile({key: 'osm:2', rows: data.rows.filter(r => !Number.isFinite(r.reviews)).slice(0, 2)}, index, data.groups);
  assert.ok(text(renderBuilding(noReviews, meta)).includes('— รีวิว'));
});

test('one population, one vocabulary (0.7.0): a จังหวัด outside the coverage reads its count and why the map is quiet; outlets are entries like any row, chain first', () => {
  const {data, index} = setup();
  const meta = data.meta;
  // ชลบุรี: chain outlets only — no แขวง/ตำบล frames, so no density and no “0 พื้นที่”.
  const rows = filterRows(data.rows, {province: 'CBI'});
  assert.ok(rows.length > 0 && rows.every(r => r.kind === 'outlet'), 'CBI holds outlets only');
  const insight = summarizeAreaInsight(rows, index, {coverage: {km2: 0, areas: 0}});
  const noPoint = rows.filter(r => !Number.isFinite(r.latitude)).length;
  const html = text(renderOverview({insight, summary: summarize(rows), overview: buildOverview(rows, index), focusMode: 'auto', classOf: () => '#000', provinces: [], meta, coverage: {km2: 0, areas: 0}, province: 'CBI', noPoint}));
  assert.ok(html.includes(`${rows.length.toLocaleString('en-US')} ร้าน · สาขาเครือในชลบุรี`), html.slice(0, 400));
  assert.ok(html.includes('ดูเป็นหมุดบนแผนที่') && !html.includes('ครอบคลุม 7 จังหวัด'), 'says where to look, not why the map is quiet (0.9.0)');
  assert.ok(!/0% ของร้าน|0 พื้นที่นี้/.test(html), 'never a 0 % / 0 areas finding');
  assert.ok(/—\s*รีวิว/.test(html), 'reviews tile shows — (outlets carry none)');
  assert.ok(!/สาขาในทะเบียน/.test(html), 'no register framing');
  // A scope whose rows all lack a coordinate says so instead of a quiet map (found live on 0.6.2: “tp tea”).
  const tp = filterRows(data.rows, {search: 'tp tea'});
  assert.ok(tp.length > 0 && tp.every(r => r.kind === 'outlet'), 'the TP TEA outlets are in the population');
  const tpInsight = summarizeAreaInsight(tp, index, {coverage: {km2: 0, areas: 0}});
  const tpNoPoint = tp.filter(r => !Number.isFinite(r.latitude)).length;
  const tpHtml = text(renderOverview({insight: tpInsight, summary: summarize(tp), overview: buildOverview(tp, index), focusMode: 'auto', classOf: () => '#000', provinces: [], meta, coverage: {km2: 0, areas: 0}, province: '', noPoint: tpNoPoint, listRows: tp, search: 'tp tea', index}));
  if (tpNoPoint === tp.length) assert.ok(tpHtml.includes('ยังไม่มีพิกัด — ดูรายชื่อด้านล่าง'), tpHtml.slice(0, 400));
  assert.ok(tpHtml.includes('รายการ') && tpHtml.includes('TP TEA'), 'the rows are listed, chain first');
  // An area with both kinds keeps the outlets out of the price bars (they are counted as unspecified) and names no split.
  const area = text(renderArea(buildAreaProfile(data.rows, '100703', index, data.groups), meta));
  assert.ok(!/ร้านในชุดข้อมูล \+/.test(area) && !/สาขาในทะเบียน/.test(area), 'no split line in an area view');
  assert.match(area, /ไม่ระบุราคา [\d,]+ ร้าน/);
  // Lists show an outlet chain first and open it through select-store (which opens an outlet as an outlet).
  const b = buildBuildingProfile({key: 'osm:1', kind: 'osm', rows: data.rows.filter(r => r.area === '100703' && r.kind === 'outlet').slice(0, 3), height: 24}, index, data.groups);
  const building = renderBuilding(b, {...meta, index});
  assert.ok(building.includes('data-action="select-store"') && !building.includes('data-action="select-outlet"'));
  assert.ok(text(building).includes('สาขาเครือ'));
  const first = b.rows[0];
  assert.ok(building.includes(`<strong>${first.brand.name}</strong>`), 'the chain is the primary name of an outlet entry');
});

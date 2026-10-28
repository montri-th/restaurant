#!/usr/bin/env python3
"""Build data/chains.json from the national chain-restaurant register (owner's research master, “Sheet 2”).

Inputs (internal, never committed):
  --chain-dump   JSON dump of “CityMETER Chain Restaurants Thailand — Research Master” (scripts/xlsx-dump.py):
                 02_STORES, 01_BRANDS, 03_COMPANIES, 08_COVERAGE, 00_README
  --provinces    directory of CityMETER production province boundaries (one JSON per province id, as returned by
                 /api/v2/citymeter-v3/restaurant/info/geom/{id}/PROVINCE) + manifest.json (id, code, abbr, names)
  --areas        data/areas.geojson (subdistrict frames of the seven covered provinces)
  --brand-logos  data/brand-logos.json (verified logo files already shipped; reused by sha256 only)

Output: data/chains.json — one row per outlet_id of the register (the register's counting unit: “one outlet_id per
branch / point of sale with qualifying evidence, incl. delivery kitchens and carts with their own status — not a field
count of open shops”). Nothing is merged, moved or upgraded: names, coordinates, statuses and links are copied from the
register; derived fields (province / subdistrict by point-in-polygon, evidence / status / coordinate classes) say how
they were derived. Outlets without a selected coordinate stay without one (never a host or map centroid).
"""
import argparse, collections, difflib, json, os, re, unicodedata
from shapely.geometry import shape, Point
from shapely.strtree import STRtree

PUBLIC_BLOCK = re.compile(r'(^|\.)(drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com|googleusercontent\.com)$')
EVIDENCE = ['primary', 'secondary', 'cart']
EVIDENCE_TH = {'primary': 'แหล่งของแบรนด์/บริษัท/สถานที่ระบุสาขา', 'secondary': 'แหล่งรอง รอยืนยันจากแบรนด์', 'cart': 'จุดขายรถเข็น รอยืนยันสถานะและตำแหน่ง'}
STATUS = ['listed', 'pending', 'temporary', 'closed']
STATUS_TH = {'listed': 'แหล่งข้อมูลระบุสาขา ยังไม่ยืนยันภาคสนาม', 'pending': 'รอยืนยันจากแบรนด์หรือการเปิดปัจจุบัน',
             'temporary': 'แหล่งข้อมูลระบุปิดชั่วคราว', 'closed': 'แหล่งข้อมูลระบุปิดหรือไม่ใช้งาน (ยังไม่ยืนยัน)'}
GEO = ['brand', 'other', 'host']
GEO_TH = {'brand': 'จุดจากเว็บหรือแอปของแบรนด์/บริษัท', 'other': 'จุดจากแหล่งข้อมูลอื่น', 'host': 'จุดอ้างอิงของสถานที่ ไม่ใช่หน้าร้าน'}

def public_url(v):
    if not isinstance(v, str) or not v.startswith('https://'):
        return ''
    host = re.sub(r'^https://([^/:?#]+).*$', r'\1', v).lower()
    return '' if PUBLIC_BLOCK.search(host) else v

def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def text(v):
    s = '' if v is None else str(v).strip()
    return '' if s in ('None', 'nan', '-') else s

def evidence_class(v):
    s = text(v)
    if 'รถเข็น' in s:
        return 'cart'
    if s.lower().startswith('secondary') or 'แหล่งรอง' in s:
        return 'secondary'
    return 'primary'

def status_class(v):
    s = text(v).lower()
    if re.search(r'permanent|reports_closed|ปิดถาวร|source_inactive|provider_reports_closed', s):
        return 'closed'
    if re.search(r'temporar|ปิดชั่วคราว|all_days_closed|renovation', s):
        return 'temporary'
    if re.search(r'pending|รอยืนยัน|unconfirmed', s):
        return 'pending'
    return 'listed'

def geo_class(v):
    s = text(v).lower()
    if 'venue_gas_station' in s or 'host_' in s and 'reference' in s:
        return 'host'
    if re.search(r'official|first_party|brand_|owned|operator_locator|company', s):
        return 'brand'
    return 'other'

def norm_th(s):
    s = unicodedata.normalize('NFKC', s).replace('​', '').replace('\xa0', ' ')
    s = re.sub(r'\d{5}', '', s)
    s = re.sub(r'^(จังหวัด|จ\.)\s*', '', s.strip())
    return s.strip()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chain-dump', required=True)
    ap.add_argument('--provinces', required=True)
    ap.add_argument('--areas', required=True)
    ap.add_argument('--brand-logos', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    load = lambda tab: json.load(open(os.path.join(a.chain_dump, tab + '.json'), encoding='utf-8'))
    stores, brands_tab, companies_tab, coverage_tab, readme = load('02_STORES'), load('01_BRANDS'), load('03_COMPANIES'), load('08_COVERAGE'), load('00_README')

    # ---------- provinces (77, production boundaries and codes) ----------
    man = json.load(open(os.path.join(a.provinces, 'manifest.json'), encoding='utf-8'))
    man.sort(key=lambda p: p['code'])
    prov_geom = []
    for p in man:
        raw = json.load(open(os.path.join(a.provinces, p['id'] + '.json'), encoding='utf-8'))['value']
        prov_geom.append(shape(json.loads(raw) if isinstance(raw, str) else raw))
    prov_tree = STRtree(prov_geom)
    th_names = {norm_th(p['nameTh']): i for i, p in enumerate(man)}
    en_names = {p['nameEn'].lower(): i for i, p in enumerate(man)}
    dopa = {p['code']: i for i, p in enumerate(man)}

    def province_by_point(lon, lat):
        pt = Point(lon, lat)
        for i in prov_tree.query(pt):
            if prov_geom[i].contains(pt):
                return int(i)
        return -1

    def province_by_text(v):
        s = norm_th(text(v))
        if not s:
            return -1
        if s in dopa:
            return dopa[s]
        if s.lower().startswith('bangkok') or re.match(r'^(กรุง|กรง|กรุว|กทม)', s):
            return dopa['10']
        if s.lower() in en_names:
            return en_names[s.lower()]
        if s in th_names:
            return th_names[s]
        if s.startswith('นครศรี'):
            return th_names.get('นครศรีธรรมราช', -1)
        best = difflib.get_close_matches(s, list(th_names), n=1, cutoff=0.75)
        return th_names[best[0]] if best else -1

    # ---------- subdistricts of the seven covered provinces ----------
    areas = json.load(open(a.areas, encoding='utf-8'))
    area_codes = [f['properties']['id'] for f in areas['features']]
    area_geom = [shape(f['geometry']) for f in areas['features']]
    area_tree = STRtree(area_geom)

    def area_by_point(lon, lat):
        pt = Point(lon, lat)
        for i in area_tree.query(pt):
            if area_geom[i].contains(pt):
                return int(i)
        return -1

    # ---------- companies and brands ----------
    companies = []
    company_index = {}
    for c in companies_tab:
        cid = text(c.get('company_id'))
        if not cid or cid in company_index:
            continue
        company_index[cid] = len(companies)
        companies.append({'id': cid, 'name': text(c.get('company_name')) or cid, 'legal': text(c.get('legal_entity_name')),
                          'role': text(c.get('entity_role')), 'web': public_url(c.get('official_website'))})
    coverage = {text(c.get('brand_id')): c for c in coverage_tab}
    logos = json.load(open(a.brand_logos, encoding='utf-8'))
    logo_by_sha = {x['sha256']: x['key'] for x in logos.get('assets', [])}

    outlet_brand = collections.Counter(text(r.get('brand_id')) for r in stores)
    brand_records, brand_index, logo_links = [], {}, {}
    for b in brands_tab:
        bid = text(b.get('brand_id'))
        if not bid or bid in brand_index or not outlet_brand.get(bid):
            continue
        cov = coverage.get(bid, {})
        key = logo_by_sha.get(text(b.get('logo_sha256')), '')
        if key:
            logo_links[bid] = key
        reported = None
        if text(b.get('reported_th_branch_count')):
            reported = {'count': text(b.get('reported_th_branch_count')), 'date': text(b.get('reported_count_date')), 'source': public_url(b.get('reported_count_source'))}
        brand_index[bid] = len(brand_records)
        brand_records.append({
            'id': bid, 'name': text(b.get('brand_name')) or bid, 'company': company_index.get(text(b.get('company_id')), -1),
            'family': text(b.get('brand_family')), 'format': text(b.get('format_name')),
            'web': public_url(b.get('official_website')) or public_url(b.get('source_url')),
            'completeness': text(cov.get('national_completeness_attested')) or text(b.get('national_completeness_status')),
            'coverage': text(cov.get('coverage_status')) or text(b.get('coverage_status')),
            'gaps': text(cov.get('remaining_gaps'))[:400], 'checked': text(cov.get('checked_on') or b.get('checked_on'))[:10],
            'logo': key, 'reported': reported, 'outlets': 0, 'withPoint': 0,
        })
    missing_brand = sorted({text(r.get('brand_id')) for r in stores} - set(brand_index))
    if missing_brand:
        raise SystemExit(f'outlets reference brands missing from 01_BRANDS: {missing_brand[:10]}')

    # ---------- outlets ----------
    cols = {k: [] for k in ['id', 'name', 'brand', 'company', 'lat', 'lon', 'prov', 'provBy', 'area', 'ev', 'st', 'geo', 'floor', 'unit', 'addr', 'src', 'checked']}
    urls, url_index = [], {}
    stats = collections.Counter()
    ids = set()
    for r in stores:
        oid = text(r.get('outlet_id'))
        if not oid or oid in ids:
            raise SystemExit(f'outlet_id missing or duplicated: {oid!r}')
        ids.add(oid)
        b = brand_index[text(r.get('brand_id'))]
        lat, lon = num(r.get('latitude')), num(r.get('longitude'))
        has = lat is not None and lon is not None and 5 <= lat <= 21 and 97 <= lon <= 106
        prov, prov_by, area = -1, '', -1
        if has:
            prov, prov_by = province_by_point(lon, lat), 'point'
            if prov == -1:
                stats['pointOutsideProvinces'] += 1
            area = area_by_point(lon, lat)
        if prov == -1:
            prov = province_by_text(r.get('province'))
            prov_by = 'text' if prov != -1 else ''
        u = public_url(r.get('source_url'))
        if u and u not in url_index:
            url_index[u] = len(urls); urls.append(u)
        cid = text(r.get('company_id'))
        cols['id'].append(oid)
        cols['name'].append(text(r.get('store_name')))
        cols['brand'].append(b)
        cols['company'].append(company_index.get(cid, brand_records[b]['company']))
        cols['lat'].append(round(lat, 6) if has else None)
        cols['lon'].append(round(lon, 6) if has else None)
        cols['prov'].append(prov)
        cols['provBy'].append({'point': 1, 'text': 2}.get(prov_by, 0))
        cols['area'].append(area)
        cols['ev'].append(EVIDENCE.index(evidence_class(r.get('evidence_status'))))
        cols['st'].append(STATUS.index(status_class(r.get('operating_status'))))
        cols['geo'].append(GEO.index(geo_class(r.get('geometry_role'))) if has else -1)
        cols['floor'].append(text(r.get('floor_raw'))[:40])
        cols['unit'].append(text(r.get('unit_raw'))[:40])
        cols['addr'].append(text(r.get('address'))[:180])
        cols['src'].append(url_index.get(u, -1))
        cols['checked'].append(text(r.get('checked_on'))[:10])
        brand_records[b]['outlets'] += 1
        if has:
            brand_records[b]['withPoint'] += 1
        stats['withPoint'] += has
        stats['inCovered'] += area >= 0
        stats['provinceByPoint'] += prov_by == 'point'
        stats['provinceByText'] += prov_by == 'text'
        stats['noProvince'] += prov == -1
    company_outlets = collections.Counter(c for c in cols['company'] if c >= 0)
    for i, c in enumerate(companies):
        c['outlets'] = company_outlets.get(i, 0)
        c['brands'] = sum(1 for b in brand_records if b['company'] == i)

    rd = {text(x.get('รายการ')): text(x.get('รายละเอียด')) for x in readme}
    checked = sorted(d for d in cols['checked'] if re.match(r'^\d{4}-\d{2}-\d{2}$', d))
    meta = {
        'schema': 'citymeter-chain-register-1',
        'dataset': 'CityMETER Chain Restaurants Thailand — national chain register (research master)',
        'sourceOfRecord': 'Research sheet “CityMETER Chain Restaurants Thailand — Research Master” (internal; tabs 02_STORES, 01_BRANDS, 03_COMPANIES, 08_COVERAGE)',
        'datasetId': rd.get('dataset_id', ''),
        'unit': rd.get('หน่วยนับ', ''),
        'coverageStatus': rd.get('สถานะความครอบคลุม', ''),
        'dataDate': rd.get('วันที่ข้อมูล', ''),
        'checkedFrom': checked[0] if checked else '', 'checkedTo': checked[-1] if checked else '',
        'readmeCounts': {k: rd.get(k, '') for k in ['จำนวนตัวตนสาขา/จุดขาย', 'รหัสแบรนด์/รูปแบบ/พอร์ตอ้างอิง', 'ระเบียนบริษัท/กลุ่มและบทบาท', 'จุดขายรถเข็นชายสี่']},
        'outlets': len(cols['id']), 'brandsWithOutlets': len(brand_records), 'brandProfiles': len(brands_tab), 'companyRecords': len(companies),
        'stats': dict(stats),
        'evidence': [{'id': e, 'th': EVIDENCE_TH[e], 'count': cols['ev'].count(i)} for i, e in enumerate(EVIDENCE)],
        'status': [{'id': s, 'th': STATUS_TH[s], 'count': cols['st'].count(i)} for i, s in enumerate(STATUS)],
        'geometry': [{'id': g, 'th': GEO_TH[g], 'count': cols['geo'].count(i)} for i, g in enumerate(GEO)],
        'rules': {
            'province': 'province = the production province polygon that contains the outlet point (provBy 1); without a point, the register province text matched to the 77 production province names (provBy 2); otherwise unknown (-1)',
            'area': 'area = index of the data/areas.geojson subdistrict whose polygon contains the outlet point (seven covered provinces only); -1 elsewhere or without a point. Display only: register counts are never added to the restaurant snapshot',
            'evidence': 'cart = evidence_status names a cart point of sale; secondary = evidence_status starts with secondary / แหล่งรอง (pending brand confirmation); primary = brand, company or host published',
            'status': 'closed / temporary = the source declares a closure (not verified); pending = brand or current operation still to confirm; listed = listed by the source, not field-verified',
            'coordinate': 'lat/lon = the register selected coordinate (official locator, publisher or provider point; never a host or map centroid). geo: brand = brand/company locator, other = other source point, host = reference point of the host venue (not the shopfront)',
        },
        'logos': {'linked': len(logo_links), 'withFileInRegister': sum(1 for b in brands_tab if text(b.get('logo_file_url'))), 'rule': 'brand logo reused only when its sha256 equals a verified file already shipped in data/brand-logos.json'},
    }
    data = {'meta': meta,
            'provinces': [{'code': p['abbr'], 'dopa': p['code'], 'th': p['nameTh'], 'en': p['nameEn'], 'areaSqm': p['areaSqm']} for p in man],
            'areas': area_codes, 'companies': companies, 'brands': brand_records, 'urls': urls, 'cols': cols}
    os.makedirs(os.path.join(a.out, 'data'), exist_ok=True)
    path = os.path.join(a.out, 'data', 'chains.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
    print('chains.json', os.path.getsize(path), json.dumps(meta['stats'], ensure_ascii=False), 'logos', len(logo_links), 'brands', len(brand_records), 'companies', len(companies))
    # Register brand ids join the brand logo registry (same verified files, matched by sha256; lookup stays by id).
    have = {x['id'] for x in logos.get('brands', [])}
    added = [{'id': bid, 'key': key} for bid, key in sorted(logo_links.items()) if bid not in have]
    logos['brands'] = sorted(logos.get('brands', []) + added, key=lambda x: x['id'])
    logos.setdefault('meta', {})['registerLinks'] = {'added': len(added), 'rule': 'register brand ids linked to an already verified file whose sha256 equals 01_BRANDS.logo_sha256 of the chain register'}
    with open(os.path.join(a.out, 'data', 'brand-logos.json'), 'w', encoding='utf-8') as fh:
        json.dump(logos, fh, ensure_ascii=False, separators=(',', ':'))
    print('brand-logos.json register links added', len(added))

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Build the demo data files from the research sheet of record and verified logo files.

Inputs (internal, never committed):
  --sheet          xlsx export of “CityMETER Restaurants Thailand — Source Audit & Refresh Master 2026-10-22”
                   (tabs 02_STORES, 01_BRANDS, 07_VENUES, 00_README, 12_SOURCE_CATALOG)
  --logo-manifest  directory of the portable logo manifest (brand-logos.json, venue-logos.json)
  --brand-files    directory with the approved brand logo files (Restaurants_Brand_Logos_Web)
  --venue-files    directory with the approved venue logo files (Restaurants_Venue_Logos_Web)
  --host-buildings host building footprints from the Luxury Brands release (data/venue-buildings.geojson)
  --areas          data/areas.geojson built by scripts/build-boundaries.py

Outputs (under --out):
  data/restaurants.json        columnar observations + dictionaries + provenance
  data/brand-logos.json        brand (chain candidate) logo registry, verified files only
  data/venue-logos.json        venue candidate logo registry, verified files only
  data/venue-buildings.geojson host buildings for venue candidates with an exact name match
  assets/brand-logos/*, assets/venue-logos/*   original bytes, sha256-checked

Nothing here invents a fact: rows, names, coordinates, prices, ratings and links are copied
from the sheet; brand/venue links stay name-based candidates exactly as the sheet labels them.
"""
import argparse, collections, hashlib, json, math, os, re, shutil, sys, datetime
import openpyxl
import warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)

PRICE_BUCKETS = ['UNDER_100', 'R100_300', 'R300_500', 'R500_1000', 'OVER_1000', 'UNSPECIFIED']
GROUPS = [
    ('general', 'ร้านอาหารทั่วไป', 'General restaurant'),
    ('thai', 'อาหารไทย', 'Thai'),
    ('fastfood', 'ฟาสต์ฟู้ด', 'Fast food'),
    ('japanese', 'ญี่ปุ่น', 'Japanese'),
    ('cafe', 'คาเฟ่และของหวาน', 'Café & dessert'),
    ('asian', 'จีนและเอเชีย', 'Chinese & Asian'),
    ('grill', 'ปิ้งย่าง บุฟเฟต์ ซีฟู้ด', 'Grill, buffet & seafood'),
    ('western', 'ตะวันตกและนานาชาติ', 'Western & international'),
    ('other', 'อื่น ๆ', 'Other source types'),
    ('unspecified', 'ไม่ระบุประเภท', 'No source type'),
]
TYPE_GROUP = {
    'general': ['Restaurant', 'Food', 'Diner', 'Cafeteria', 'Food Court', 'Meal Takeaway', 'Meal Delivery', 'Food Delivery',
                'Catering Service', 'Banquet Hall', 'Vegetarian Restaurant', 'Vegan Restaurant'],
    'thai': ['Thai Restaurant'],
    'fastfood': ['Fast Food Restaurant', 'Hamburger Restaurant', 'Pizza Restaurant', 'Sandwich Shop', 'Bagel Shop', 'Deli'],
    'japanese': ['Japanese Restaurant', 'Sushi Restaurant', 'Ramen Restaurant'],
    'cafe': ['Coffee Shop', 'Cafe', 'Dessert Restaurant', 'Dessert Shop', 'Bakery', 'Ice Cream Shop', 'Tea House', 'Candy Store',
             'Juice Shop', 'Confectionery', 'Acai Shop', 'Dog Cafe', 'Cat Cafe', 'Donut Shop', 'Breakfast Restaurant', 'Brunch Restaurant'],
    'asian': ['Chinese Restaurant', 'Korean Restaurant', 'Asian Restaurant', 'Vietnamese Restaurant', 'Indian Restaurant',
              'Indonesian Restaurant', 'Afghani Restaurant'],
    'grill': ['Steak House', 'Barbecue Restaurant', 'Buffet Restaurant', 'Seafood Restaurant', 'Bar And Grill', 'Barbecue Area'],
    'western': ['Italian Restaurant', 'American Restaurant', 'French Restaurant', 'Mexican Restaurant', 'Mediterranean Restaurant',
                'Lebanese Restaurant', 'Turkish Restaurant', 'Middle Eastern Restaurant', 'Spanish Restaurant', 'Greek Restaurant',
                'African Restaurant', 'Fine Dining Restaurant'],
}
ID_PATTERN = re.compile(r'^R-([0-9a-f]{24})-(\d{2})$')
MIME = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'svg': 'image/svg+xml', 'webp': 'image/webp', 'gif': 'image/gif'}
PUBLIC_BLOCK = re.compile(r'(^|\.)(drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com|googleusercontent\.com)$')
VENUE_ROLE_TH = {
    'venue_specific': '', 'parent_complex': 'โลโก้โครงการแม่', 'shared_department_store_banner': 'โลโก้ห้างสรรพสินค้าในเครือ',
    'shared_chain_banner': 'โลโก้เครือ', 'parent_institution': 'โลโก้หน่วยงานแม่', 'hotel_property_mark': 'โลโก้โรงแรม',
    'current_property_brand': 'โลโก้แบรนด์อาคาร', 'shared_operator_banner': 'โลโก้ผู้ให้บริการในเครือ',
}
VENUE_TYPE_TH = {
    'shopping_center': 'ศูนย์การค้า', 'shopping_center_chain_host': 'ศูนย์การค้าในเครือ', 'shopping_center_candidate': 'ศูนย์การค้า',
    'department_store': 'ห้างสรรพสินค้า', 'department_store_or_center_unresolved': 'ห้างหรือศูนย์การค้า', 'retail_chain_host': 'ไฮเปอร์มาร์เก็ต / ร้านค้าในเครือ',
    'retail_complex_candidate': 'อาคารพาณิชย์', 'retail_district': 'ย่านการค้า', 'mixed_use_complex_candidate': 'โครงการมิกซ์ยูส',
    'fuel_station_or_operator_host': 'สถานีบริการน้ำมัน', 'hospital': 'โรงพยาบาล', 'hotel': 'โรงแรม', 'hotel_or_tower': 'โรงแรม / อาคาร',
    'office_building': 'อาคารสำนักงาน', 'university_campus': 'มหาวิทยาลัย', 'food_market': 'ตลาดอาหาร', 'airport': 'สนามบิน',
    'convention_center': 'ศูนย์ประชุม', 'government_complex': 'ศูนย์ราชการ',
}

def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()

def public_url(value):
    if not isinstance(value, str) or not value.startswith('https://'):
        return ''
    host = re.sub(r'^https://([^/:?#]+).*$', r'\1', value).lower()
    return '' if PUBLIC_BLOCK.search(host) else value

def norm(value):
    return ' '.join(str(value or '').replace('​', '').lower().split())

def read_tab(wb, name, columns=None):
    ws = wb[name]
    it = ws.iter_rows(values_only=True)
    header = [str(h) if h is not None else '' for h in next(it)]
    idx = {h: i for i, h in enumerate(header)}
    want = columns or header
    missing = [c for c in want if c not in idx]
    if missing:
        sys.exit(f'{name}: missing columns {missing}')
    out = []
    for r in it:
        if r is None or all(v is None for v in r):
            continue
        out.append({c: r[idx[c]] for c in want})
    return out

def num(v):
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def tile_of(lat, lon, z=10):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y

GRID = 2 ** 10 * 4096  # z10 × extent 4096: the public overlay's quantization (9.5546 m Web Mercator grid)

def to_grid(lat, lon):
    gx = round((lon + 180) / 360 * GRID)
    gy = round((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * GRID)
    return gx, gy

def from_grid(gx, gy):
    """Same formula as the research decoder (mvt_point_decoder.coordinate) and js/model.js#gridToLngLat."""
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy / GRID)))), gx / GRID * 360 - 180

def image_info(path, theme_support):
    """Width/height and a neutral backplate for the original artwork (bytes never change)."""
    ext = path.rsplit('.', 1)[-1].lower()
    if ext == 'svg':
        text = open(path, 'rb').read().decode('utf-8', 'ignore')
        vb = re.search(r'viewBox\s*=\s*["\']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)', text)
        w = re.search(r'<svg[^>]*\swidth\s*=\s*["\']([\d.]+)', text)
        h = re.search(r'<svg[^>]*\sheight\s*=\s*["\']([\d.]+)', text)
        if vb:
            width, height = float(vb.group(3)), float(vb.group(4))
        elif w and h:
            width, height = float(w.group(1)), float(h.group(1))
        else:
            width, height = 200.0, 100.0
        kind = 'svg'
        light_marks = None
    else:
        from PIL import Image
        im = Image.open(path)
        width, height = im.size
        im.seek(0)
        rgba = im.convert('RGBA')
        alpha = rgba.getchannel('A')
        hist = alpha.histogram()
        transparent = sum(hist[:250]) > 0.02 * width * height
        if transparent:
            px = [p for p in rgba.resize((min(width, 160), max(1, int(height * min(width, 160) / width)))).getdata() if p[3] > 200]
            lum = sum((0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255 for p in px) / max(1, len(px))
            light_marks = lum > 0.82
            kind = 'transparent'
        else:
            light_marks = None
            kind = 'opaque'
    ts = str(theme_support or '')
    if ts.startswith('dark_background_required') or (kind == 'transparent' and light_marks):
        background = '#182327'
    elif kind == 'opaque' or 'native_white' in ts:
        background = '#FFFFFF'
    else:
        background = '#E5E9E6'
    return {'width': round(width, 2), 'height': round(height, 2), 'background': background, 'artwork': kind}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet', required=True)
    ap.add_argument('--logo-manifest', required=True)
    ap.add_argument('--brand-files', required=True)
    ap.add_argument('--venue-files', required=True)
    ap.add_argument('--host-buildings', required=True)
    ap.add_argument('--areas', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    areas = json.load(open(a.areas, encoding='utf-8'))
    area_codes = [f['properties']['id'] for f in areas['features']]
    area_index = {c: i for i, c in enumerate(area_codes)}
    area_uuid = {f['properties']['uuid']: f['properties']['id'] for f in areas['features']}

    wb = openpyxl.load_workbook(a.sheet, read_only=True, data_only=True)
    readme = {r['หัวข้อ']: r['รายละเอียด'] for r in read_tab(wb, '00_README')}
    stores = read_tab(wb, '02_STORES', ['snapshot_observation_id', 'store_name', 'latitude', 'longitude', 'primary_type',
        'start_price_thb', 'end_price_thb', 'price_bucket', 'rating', 'rating_count', 'subdistrict_code', 'subdistrict_id',
        'province_code', 'brand_candidate_id', 'brand_link_status', 'brand_identity_review_required', 'venue_candidate_id',
        'venue_link_status', 'venue_candidate_row_role', 'source_url', 'operating_status', 'geometry_role',
        'coordinate_grid_m_webmercator', 'retrieved_at_utc', 'checked_on', 'snapshot_sha256'])
    brands_tab = read_tab(wb, '01_BRANDS')
    venues_tab = read_tab(wb, '07_VENUES')
    catalog = read_tab(wb, '12_SOURCE_CATALOG')

    # ---------- observations ----------
    if len(stores) != len({r['snapshot_observation_id'] for r in stores}):
        sys.exit('duplicate snapshot_observation_id')
    type_counts = collections.Counter(r['primary_type'] for r in stores if r['primary_type'])
    types = [t for t, _ in sorted(type_counts.items(), key=lambda kv: (-kv[1], kv[0]))]
    type_index = {t: i for i, t in enumerate(types)}
    group_of = {}
    for gi, (gid, _, _) in enumerate(GROUPS):
        for t in TYPE_GROUP.get(gid, []):
            group_of[t] = gi
    other = [g[0] for g in GROUPS].index('other')
    type_group = [group_of.get(t, other) for t in types]

    brand_rows = collections.Counter(r['brand_candidate_id'] for r in stores if r['brand_candidate_id'])
    venue_rows = collections.Counter(r['venue_candidate_id'] for r in stores if r['venue_candidate_id'])
    brand_ids = sorted(brand_rows)
    venue_ids = sorted(venue_rows)
    b_index = {b: i for i, b in enumerate(brand_ids)}
    v_index = {v: i for i, v in enumerate(venue_ids)}

    cols = {k: [] for k in ['key', 'name', 'gx', 'gy', 'type', 'price', 'p0', 'p1', 'rating', 'reviews', 'area']}
    # Row key = the first KEY_HEX hex digits of the snapshot fingerprint (+ "-NN" when the ordinal is not 01):
    # unique within this snapshot (checked below), short enough for URLs; the full id stays in the sheet.
    fingerprints = [ID_PATTERN.match(r['snapshot_observation_id']) for r in stores]
    KEY_HEX = 12
    if len({m.group(1)[:KEY_HEX] + m.group(2) for m in fingerprints}) != len(stores):
        sys.exit('row key prefix is not unique')
    ordinals, brand_col, venue_col, venue_entity = {}, {}, {}, []
    status_values = collections.Counter(); geometry_roles = collections.Counter(); grids = set(); retrieved = set(); checked = set()
    tile_mismatch = 0
    rows_sorted = sorted(stores, key=lambda r: (str(r['subdistrict_code']), r['snapshot_observation_id']))
    for i, r in enumerate(rows_sorted):
        m = ID_PATTERN.match(r['snapshot_observation_id'])
        if not m:
            sys.exit('unexpected id ' + str(r['snapshot_observation_id']))
        cols['key'].append(m.group(1)[:KEY_HEX] + ('' if m.group(2) == '01' else '-' + m.group(2)))
        if m.group(2) != '01':
            ordinals[i] = int(m.group(2))
        code = str(r['subdistrict_code']).split('.')[0]
        if code not in area_index:
            sys.exit(f'row {r["snapshot_observation_id"]} outside the frame set: {code}')
        if area_uuid.get(r['subdistrict_id']) != code:
            sys.exit(f'subdistrict id/code mismatch for {r["snapshot_observation_id"]}')
        lat, lon = float(r['latitude']), float(r['longitude'])
        gx, gy = to_grid(lat, lon)
        dlat, dlon = from_grid(gx, gy)
        if abs(dlat - lat) > 5e-7 or abs(dlon - lon) > 5e-7:
            sys.exit(f'coordinate is not an MVT z10 grid position: {r["snapshot_observation_id"]}')
        x, y = gx // 4096, gy // 4096
        if f'/overlayMvt/10/{x}/{y}?' not in str(r['source_url']):
            tile_mismatch += 1
        cols['name'].append(r['store_name'] or '')
        cols['gx'].append(gx); cols['gy'].append(gy)
        cols['type'].append(type_index.get(r['primary_type'], -1))
        cols['price'].append(PRICE_BUCKETS.index(r['price_bucket']))
        p0, p1 = num(r['start_price_thb']), num(r['end_price_thb'])
        cols['p0'].append(None if p0 is None else (int(p0) if p0.is_integer() else p0))
        cols['p1'].append(None if p1 is None else (int(p1) if p1.is_integer() else p1))
        rt = num(r['rating'])
        cols['rating'].append(None if rt is None else round(rt, 2))
        rc = num(r['rating_count'])
        cols['reviews'].append(None if rc is None else int(rc))
        cols['area'].append(area_index[code])
        if r['brand_candidate_id']:
            brand_col[i] = b_index[r['brand_candidate_id']]
        if r['venue_candidate_id']:
            venue_col[i] = v_index[r['venue_candidate_id']]
            if r['venue_candidate_row_role'] == 'source_venue_entity_audit':
                venue_entity.append(i)
        status_values[r['operating_status']] += 1; geometry_roles[r['geometry_role']] += 1
        grids.add(round(float(r['coordinate_grid_m_webmercator']), 6)); retrieved.add(str(r['retrieved_at_utc'])[:10]); checked.add(str(r['checked_on'])[:10])
    if tile_mismatch:
        sys.exit(f'{tile_mismatch} rows whose source tile is not the tile of their display coordinate')
    # Sparse maps as [index, value] pairs keep the file compact and ordered.
    def pairs(d):
        return [[k, v] for k, v in sorted(d.items())]

    # ---------- logos ----------
    man_b = json.load(open(os.path.join(a.logo_manifest, 'brand-logos.json'), encoding='utf-8'))
    man_v = json.load(open(os.path.join(a.logo_manifest, 'venue-logos.json'), encoding='utf-8'))
    out_b = os.path.join(a.out, 'assets', 'brand-logos'); out_v = os.path.join(a.out, 'assets', 'venue-logos')
    for d in (out_b, out_v):
        if os.path.isdir(d):
            shutil.rmtree(d)
        os.makedirs(d)

    def copy_asset(m, src_dir, dst_dir, prefix):
        src = os.path.join(src_dir, m['filename'])
        if not os.path.exists(src):
            return None, 'missing_file'
        if sha(src) != m['sha256'] or os.path.getsize(src) != m['bytes']:
            return None, 'sha256_mismatch'
        ext = m['filename'].rsplit('.', 1)[-1].lower()
        if ext not in MIME or MIME[ext] != m['mime_type']:
            return None, 'mime_mismatch'
        dst_name = re.sub(r'[^A-Za-z0-9._-]', '-', m['filename'])
        shutil.copyfile(src, os.path.join(dst_dir, dst_name))
        info = image_info(src, m.get('theme_support'))
        return {'key': f'{prefix}-{m["sha256"][:16]}', 'file': f'assets/{os.path.basename(dst_dir)}/{dst_name}', 'mime': MIME[ext],
                'bytes': m['bytes'], 'sha256': m['sha256'], **info, 'sourcePage': public_url(m.get('source_url')),
                'assetUrl': public_url(m.get('original_asset_url')), 'theme': m.get('theme_support') or ''}, None

    brands_by_id = {b['brand_id']: b for b in brands_tab}
    holds = {b['brand_id'] for b in brands_tab if str(b.get('identity_review_required')).upper() == 'TRUE'}
    b_assets, b_links, b_issues = {}, {}, []
    for m in man_b:
        bid = m['asset_key']
        if bid not in brands_by_id:
            b_issues.append({'asset': bid, 'reason': 'no_brand_record'}); continue
        if bid in holds:
            b_issues.append({'asset': bid, 'reason': 'identity_hold'}); continue
        sheet_sha = str(brands_by_id[bid].get('logo_sha256') or '')
        if sheet_sha and sheet_sha != m['sha256']:
            b_issues.append({'asset': bid, 'reason': 'sheet_manifest_sha_differs'}); continue
        asset, err = copy_asset(m, a.brand_files, out_b, 'BL')
        if err:
            b_issues.append({'asset': bid, 'reason': err}); continue
        b_assets[asset['key']] = asset
        b_links[bid] = asset['key']
    brand_records = []
    for bid in brand_ids:
        b = brands_by_id.get(bid, {})
        brand_records.append({'id': bid, 'name': b.get('brand_name') or bid, 'rows': brand_rows[bid],
                              'logo': b_links.get(bid, ''), 'source': public_url(b.get('source_url')),
                              'link': b.get('brand_link_status') or '', 'hold': bid in holds,
                              'holdReason': (b.get('identity_review_reason') or '') if bid in holds else ''})

    venues_by_id = {v['venue_candidate_id']: v for v in venues_tab}
    v_assets, v_links, v_issues = {}, {}, []
    for m in man_v:
        asset, err = copy_asset(m, a.venue_files, out_v, 'VL')
        if err:
            v_issues.append({'asset': m['asset_key'], 'reason': err}); continue
        v_assets[asset['key']] = asset
        for vid, role in zip(m.get('binding_venue_candidate_ids') or [], m.get('binding_roles') or []):
            if vid in venues_by_id:
                v_links[vid] = (asset['key'], role)
    venue_records = []
    for vid in venue_ids:
        v = venues_by_id.get(vid, {})
        key, role = v_links.get(vid, ('', ''))
        sheet_key = str(v.get('logo_key') or '')
        if key and sheet_key and sheet_key[3:] != key[3:]:
            v_issues.append({'venue': vid, 'reason': 'sheet_key_differs'}); key, role = '', ''
        venue_records.append({'id': vid, 'name': v.get('venue_candidate_name') or vid, 'type': v.get('venue_type') or '',
                              'typeTh': VENUE_TYPE_TH.get(v.get('venue_type'), 'สถานที่'), 'rows': venue_rows[vid],
                              'logo': key, 'role': role or (v.get('logo_role') or ''), 'roleTh': VENUE_ROLE_TH.get(role or v.get('logo_role'), ''),
                              'link': v.get('host_link_status') or ''})

    # ---------- host buildings (exact name match with the Luxury Brands host set) ----------
    hb = json.load(open(a.host_buildings, encoding='utf-8'))
    def names_of(v):
        out = {norm(v.get('venue_candidate_name'))}
        for alias in str(v.get('venue_aliases') or '').split('|'):
            if alias.strip():
                out.add(norm(alias))
        return out
    name_to_venues = collections.defaultdict(set)
    for vid in venue_ids:
        for n in names_of(venues_by_id.get(vid, {})):
            name_to_venues[n].add(vid)
    host_features = []
    for f in hb['features']:
        p = f['properties']
        vn = p.get('venue_names')
        vn = json.loads(vn) if isinstance(vn, str) else (vn or [])
        matched = sorted({vid for n in vn for vid in name_to_venues.get(norm(n), set())})
        if not matched:
            continue
        keep = {k: p[k] for k in p if k not in ('outlet_ids', 'selected_outlet_ids')}
        keep['venue_ids'] = matched
        keep['venue_join'] = 'exact normalized name/alias match between this sheet (07_VENUES) and the Luxury Brands host set'
        host_features.append({'type': 'Feature', 'id': f.get('id', p.get('host_id')), 'geometry': f['geometry'], 'properties': keep})
    hosted = sorted({vid for f in host_features for vid in f['properties']['venue_ids']})
    for rec in venue_records:
        rec['host'] = rec['id'] in hosted

    # ---------- write ----------
    total_reviews = sum(v for v in cols['reviews'] if v)
    by_province = collections.Counter(areas['features'][i]['properties']['province'] for i in cols['area'])
    price_counts = collections.Counter(PRICE_BUCKETS[i] for i in cols['price'])
    asof = readme.get('วันที่ดึงและตรวจ source…', readme.get('วันที่ดึงและตรวจ source'))
    source_row = next((c for c in catalog if c.get('source_key') == 'restaurant_public_snapshot'), {})
    meta = {
        'schema': 'citymeter-restaurants-rows-1',
        'dataset': 'CityMETER Restaurants — public overlay snapshot with research enrichment',
        'asOf': '2026-10-22',
        'retrievedOn': sorted(retrieved)[0] if retrieved else '',
        'checkedOn': sorted(checked)[-1] if checked else '',
        'sourceOfRecord': 'Research sheet “CityMETER Restaurants Thailand — Source Audit & Refresh Master 2026-10-22” (internal; tabs 02_STORES, 01_BRANDS, 07_VENUES)',
        'sourceApi': 'https://landometer.com/api/v2/citymeter-v3/restaurant',
        'sourcePage': 'https://landometer.com/v3/citymeter?d=restaurant',
        'sourceTable': 'master.restaurant_place (public CityMETER Restaurants API)',
        'sourceLimitation': source_row.get('limitation') or '',
        'rows': len(rows_sorted), 'rowsByProvince': dict(sorted(by_province.items(), key=lambda kv: -kv[1])),
        'priceBuckets': {k: price_counts.get(k, 0) for k in PRICE_BUCKETS},
        'reviewsTotal': total_reviews,
        'rowsWithRating': sum(1 for v in cols['rating'] if v is not None),
        'rowsWithPrice': sum(1 for i in cols['price'] if PRICE_BUCKETS[i] != 'UNSPECIFIED'),
        'operatingStatus': dict(status_values), 'geometryRole': dict(geometry_roles),
        'coordinate': {'role': 'mvt_display_position_z10', 'gridMetres': sorted(grids), 'encoding': 'cols.gx/gy = global grid integers at z10 × extent 4096 (n = 4,194,304); lon = gx/n·360−180, lat = atan(sinh(π(1−2·gy/n))) — the research decoder formula; equals the sheet latitude/longitude within 5e-7°', 'note': 'display position, not the source coordinate'},
        'keyEncoding': 'cols.key = first 12 hex digits of snapshot_observation_id (R-<24 hex>-<ordinal>), plus -NN when the ordinal is not 01; unique in this snapshot',
        'tileRule': 'every row comes from the z10 overlay tile that contains its display coordinate (checked at build time)',
        'brandRule': 'brand = explicit source-name chain candidate (01_BRANDS); not a verified branch relationship',
        'venueRule': 'venue = explicit source-name host candidate (07_VENUES); not a verified located-inside relationship',
    }
    data = {'meta': meta, 'priceBuckets': PRICE_BUCKETS,
            'groups': [{'id': g[0], 'th': g[1], 'en': g[2]} for g in GROUPS],
            'types': types, 'typeGroup': type_group, 'areas': area_codes,
            'brands': brand_records, 'venues': venue_records,
            'cols': cols, 'brand': pairs(brand_col), 'venue': pairs(venue_col), 'venueEntity': venue_entity}
    os.makedirs(os.path.join(a.out, 'data'), exist_ok=True)
    def write(name, obj):
        path = os.path.join(a.out, 'data', name)
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))
        print(name, os.path.getsize(path))
    write('restaurants.json', data)
    today = datetime.date.today().isoformat()
    write('brand-logos.json', {'meta': {'version': f'{today}-r1', 'source': 'Portable logo manifest 2026-10-22 + research sheet 01_BRANDS', 'expected': len(man_b),
                                        'count': len(b_assets), 'issues': b_issues, 'rule': 'lookup by brand_candidate_id only; identity holds carry no logo; collecting files is not a trademark licence'},
                               'assets': sorted(b_assets.values(), key=lambda x: x['key']),
                               'brands': [{'id': b, 'key': k} for b, k in sorted(b_links.items())]})
    write('venue-logos.json', {'meta': {'version': f'{today}-r1', 'source': 'Portable logo manifest 2026-10-22 + research sheet 07_VENUES', 'expected': len(man_v),
                                        'count': len(v_assets), 'issues': v_issues, 'roles': VENUE_ROLE_TH,
                                        'rule': 'lookup by venue_candidate_id only; the venue name stays the identity; a logo never changes a row'},
                               'assets': sorted(v_assets.values(), key=lambda x: x['key']),
                               'venues': [{'id': v, 'key': k, 'role': r} for v, (k, r) in sorted(v_links.items())]})
    write('venue-buildings.geojson', {'type': 'FeatureCollection', 'metadata': {**{k: hb.get('metadata', {}).get(k) for k in ('geometry_license', 'attribution', 'attribution_url', 'fallback_height_m')},
        'source': 'Luxury Brands release 0.5 host buildings (OpenStreetMap footprints, CityMETER building parts)', 'join': 'exact normalized venue name/alias', 'venues': len(hosted), 'features': len(host_features)},
        'features': host_features})
    print('brands', len(brand_records), 'logos', len(b_links), 'issues', len(b_issues), '| venues', len(venue_records), 'logos', len(v_links), 'issues', len(v_issues), '| hosted venues', len(hosted))

if __name__ == '__main__':
    main()

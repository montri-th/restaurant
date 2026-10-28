#!/usr/bin/env python3
"""Build the demo data files from the research sheets of record and verified logo files.

Inputs (internal, never committed):
  --sheet          JSON dump (scripts/xlsx-dump.py) of “CityMETER Restaurants Thailand — Master” (Sheet 1;
                   tabs 02_STORES, 01_BRANDS, 07_VENUES, 00_README, 12_SOURCE_CATALOG). An .xlsx path still works.
  --chain-sheet    JSON dump of “CityMETER Chain Restaurants Thailand — Research Master” (Sheet 2): tab
                   16_MASTER_OBSERVATIONS holds the 1,234 snapshot observations moved there on 2026-10-25 with every
                   Sheet 1 column prefixed master_. Snapshot = 70,214 = Sheet 1 68,980 + 1,234 moved (README rule:
                   the two tables are never counted as different restaurants).
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

VENUE_TYPE_TH.update({
    'name_suffix_market': 'ตลาด', 'name_suffix_building': 'อาคาร', 'name_suffix_hospital': 'โรงพยาบาล',
    'name_suffix_hotel': 'โรงแรม / ที่พัก', 'name_suffix_campus': 'มหาวิทยาลัย', 'name_suffix_station': 'สถานี',
    'name_suffix_condo': 'คอนโดมิเนียม', 'name_suffix_complex': 'คอมมูนิตี้มอลล์ / ศูนย์การค้า',
})

# ---------- venue names at the end of a restaurant name (owner decision 2026-10-23) ----------
# Two name-based rules for rows the sheet left without a venue. Both stay candidates (the name
# mentions the place), keyed by venue id — never a verified located-inside relationship.
#   suffix: a 07_VENUES name/alias is the end of the restaurant name (floor/zone/branch words may follow);
#   auto:   the same place-like ending (ตลาด…, …Tower, …Avenue) on ≥ 2 restaurant names whose display
#           points all lie within AUTO_RADIUS_M of their median point (trimmed to a fixed point) → a new name-derived venue.
# A place word preceded by หน้า/ข้าง/ตรงข้าม/near/opposite… describes a neighbour, not a host: no match.
THAI_CHAR = re.compile(r'[฀-๿]')
SUFFIX_GENERIC = {'ptt', 'pttor', 'ปตท', 'big c', 'bigc', 'lotus', 'makro', 'โลตัส', 'lotus s', 'lotuss', 'central', 'the mall',
                  'robinson', 'tops', 'villa market', 'foodland', 'gourmet market'}
SUFFIX_SHORT_OK = {'qsncc', 'มสธ'}
PROXIMITY = (r'(?:หน้า|ข้างๆ|ข้าง|ตรงข้าม|ตรงกันข้าม|ใกล้ๆ|ใกล้|ข้างหลัง|หลัง|ติดกับ|ติด|เยื้อง|ถัดจาก|ทางเข้า|ปากทาง|'
             r'near|opposite|opp|behind|beside|next to|in front of|front of|across from|across)')
PROXIMITY_END = re.compile(PROXIMITY + r'\s*$')
Q_EN = (r'(?:g|m|b|l|lg|ug|gf|b1|b2|b3|fl|flr|floor|level|lv|zone|branch|outlet|store|shop|kiosk|t1|t2|t3|terminal|'
        r'arrival|arrivals|departure|departures|gate|sha|plus|\d+(?:st|nd|rd|th)|[ivx]+)')
Q_TH = r'(?:ชั้น\s*\S{0,6}|โซน\s*\S{0,6}|สาขา\s*\d{0,3}|ใต้ดิน)'
QUALIFIER_TAIL = re.compile(r'^(?:\s*(?:' + Q_EN + r'|' + Q_TH + r'))*\s*$')
QUALIFIER_END = re.compile(r'(?:\s(?:' + Q_EN + r')|\s?(?:' + Q_TH + r'))$')
PLACE_EN = (r'(?:tower|building|bldg|square|plaza|complex|center|centre|mall|place|park|market|hospital|hotel|residence|'
            r'residences|condo|condominium|office|avenue|village|walk|court|hub|campus|university|station|terminal)')
PLACE_TH = (r'(?:อาคาร|ตึก|ทาวเวอร์|พลาซ่า|สแควร์|คอมเพล็กซ์|เซ็นเตอร์|มอลล์|ตลาด|โรงพยาบาล|โรงแรม|คอนโด|มหาวิทยาลัย|สถานี|'
            r'ศูนย์การค้า|ศูนย์อาหาร|เพลส|ปาร์ค|วิลเลจ|อเวนิว)')
EN_PLACE_TAIL = re.compile(r'(?:^| )((?:[a-z0-9]+ ){0,3}' + PLACE_EN + r'(?: [a-z0-9]+){0,2})$')
TH_PLACE_TAIL = re.compile(r'(' + PLACE_TH + r'[^\s]{2,40}(?: [^\s]{1,20})?)$')
AUTO_RADIUS_M = 200
AUTO_MERGE_M = 300
AUTO_TYPES = [('name_suffix_market', ('ตลาด', 'market')), ('name_suffix_hospital', ('โรงพยาบาล', 'hospital')),
              ('name_suffix_hotel', ('โรงแรม', 'hotel', 'residence')), ('name_suffix_campus', ('มหาวิทยาลัย', 'university', 'campus')),
              ('name_suffix_station', ('สถานี', 'station', 'terminal')), ('name_suffix_condo', ('คอนโด', 'condo')),
              ('name_suffix_building', ('อาคาร', 'ตึก', 'tower', 'building', 'bldg', 'office', 'ทาวเวอร์'))]

def snorm(value):
    """Matching form of a name: NFKC, lower case, punctuation → space (Thai sara am kept composed)."""
    import unicodedata
    s = unicodedata.normalize('NFKC', str(value or '')).replace('​', '').replace('ํา', 'ำ').lower()
    s = s.replace('&', ' and ').replace('’', "'")
    s = re.sub(r"[\(\)\[\]\{\}\-–—_@#,.:;!?\"|/\\+*~'`<>]+", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def metres_between(a, b):
    kx = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110574)

def suffix_venue_rules(stores, venues_tab):
    """Assign the sheet-less rows by the two suffix rules; returns (assigned, auto_venues, stats)."""
    aliases = collections.defaultdict(set)
    for v in venues_tab:
        names = {v.get('venue_candidate_name')} | {x for x in str(v.get('venue_aliases') or '').split('|') if x and x != 'None'}
        for n in names:
            key = snorm(n)
            if key:
                aliases[key].add(v['venue_candidate_id'])
    usable = {k: next(iter(s)) for k, s in aliases.items()
              if len(s) == 1 and k not in SUFFIX_GENERIC and (len(k) >= 6 or k in SUFFIX_SHORT_OK)}
    by_length = sorted(usable, key=lambda k: (-len(k), k))
    stats = collections.Counter(ambiguousAliases=sum(1 for s in aliases.values() if len(s) > 1))

    def boundary(n, i, end, a):
        before = i == 0 or n[i - 1] == ' ' or (THAI_CHAR.match(a[0]) and THAI_CHAR.match(n[i - 1]))
        after = end == len(n) or n[end] == ' ' or THAI_CHAR.match(a[-1])
        return before and after

    def gazetteer(name):
        n = snorm(name)
        for a in by_length:
            i = n.rfind(a)
            while i != -1:
                end = i + len(a)
                if boundary(n, i, end, a) and QUALIFIER_TAIL.match(n[end:]):
                    if PROXIMITY_END.search(re.sub(r'สาขา\s*$', '', n[:i].rstrip()).rstrip()):
                        near_names.add(name)
                        return None
                    return usable[a]
                i = n.rfind(a, 0, i)
        return None

    def strip_qualifiers(n):
        previous = None
        while previous != n:
            previous = n
            n = QUALIFIER_END.sub('', n).strip()
        return n

    def place_tail(name):
        n = strip_qualifiers(snorm(name))
        m = EN_PLACE_TAIL.search(n) or TH_PLACE_TAIL.search(n)
        if not m:
            return None
        tail = m.group(1).strip()
        i = n.rfind(tail)
        if i <= 0 or len(tail) < 6:
            return None  # the whole name is the place itself, or too short to name a place
        if PROXIMITY_END.search(re.sub(r'สาขา\s*$', '', n[:i].rstrip()).rstrip()):
            near_names.add(name)
            return None
        return tail

    assigned, pending, near_names = {}, [], set()
    for r in stores:
        if r['venue_candidate_id']:
            continue
        vid = gazetteer(r['store_name'])
        if vid:
            assigned[r['snapshot_observation_id']] = (vid, 'suffix')
        else:
            pending.append(r)
    point = lambda r: (float(r['longitude']), float(r['latitude']))
    groups, tail_of = collections.defaultdict(list), {}
    for r in pending:
        t = place_tail(r['store_name'])
        if t:
            groups[t].append(r)
            tail_of[r['snapshot_observation_id']] = t

    def median(rs):
        xs, ys = sorted(point(r)[0] for r in rs), sorted(point(r)[1] for r in rs)
        return (xs[len(xs) // 2], ys[len(ys) // 2])
    def related(x, y):
        # Thai is written without word spaces ("ตลาดพระราม 5" = "ตลาดพระราม5"); Latin needs a word boundary.
        if THAI_CHAR.search(x) or THAI_CHAR.search(y):
            cx, cy = x.replace(' ', ''), y.replace(' ', '')
            return cx.startswith(cy) or cy.startswith(cx)
        return x == y or x.startswith(y + ' ') or y.startswith(x + ' ')
    merged = {}
    for key in sorted(groups, key=lambda k: (len(k.replace(' ', '')), len(k), k)):
        target = next((m for m in merged if related(key, m)
                       and metres_between(median(merged[m]), median(groups[key])) <= AUTO_MERGE_M), None)
        if target:
            merged[target] += groups[key]
        else:
            merged[key] = list(groups[key])

    def display_name(rs):
        # The ending most of the grouped names use. Among equally common endings take the shortest, extended
        # only to complete a cut-off Thai word ("ตลาดมีน" → "ตลาดมีนบุรี"), never by trailing words after a space.
        counts = collections.Counter(tail_of[r['snapshot_observation_id']] for r in rs)
        top = max(counts.values())
        tied = sorted((k for k, c in counts.items() if c == top), key=lambda k: (len(k), k))
        key = tied[0]
        for longer in tied[1:]:
            if longer.startswith(key) and longer[len(key)] != ' ':
                key = longer
        if THAI_CHAR.search(key):
            return key
        pattern = re.compile(r'[\W_]*'.join(re.escape(t) for t in key.split(' ')), re.IGNORECASE)
        found = collections.Counter(m.group(0) for r in rs for m in [pattern.search(str(r['store_name']))] if m)
        if not found:
            return key.title()
        # The written form most names use; a capitalised form wins over an all-lower-case one.
        capitalised = {k: c for k, c in found.items() if any(ch.isupper() for ch in k)} or found
        return sorted(capitalised.items(), key=lambda kv: (-kv[1], -sum(ch.isupper() for ch in kv[0]), kv[0]))[0][0]

    auto_venues = []
    for key in sorted(merged):
        rs = merged[key]
        # Trim to a fixed point: every kept point lies within AUTO_RADIUS_M of the KEPT points' median
        # (removing a far point moves the median, so check again; only removals → terminates).
        inside = list(rs)
        while len(inside) >= 2:
            centre = median(inside)
            near = [r for r in inside if metres_between(point(r), centre) <= AUTO_RADIUS_M]
            if len(near) == len(inside):
                break
            inside = near
        centre = median(inside) if inside else median(rs)
        inside = sorted(inside, key=lambda r: r['snapshot_observation_id'])
        stats['autoFar'] += len(rs) - len(inside)
        if len(inside) < 2:
            continue
        vid = 'RX-' + hashlib.sha256(key.encode('utf-8')).hexdigest()[:16]
        kind = next((t for t, words in AUTO_TYPES if any(w in key for w in words)), 'name_suffix_complex')
        auto_venues.append({'venue_candidate_id': vid, 'venue_candidate_name': display_name(inside), 'venue_type': kind,
                            'host_link_status': 'name_suffix_auto', 'venue_aliases': '', 'logo_key': None, 'logo_role': None,
                            'match_key': key, 'median': [round(centre[0], 7), round(centre[1], 7)]})
        for r in inside:
            assigned[r['snapshot_observation_id']] = (vid, 'auto')
    # Rows (not names) left without a venue because the place word followed หน้า/ข้าง/near/behind….
    stats['proximityExcluded'] = sum(1 for r in stores if not r['venue_candidate_id'] and r['store_name'] in near_names
                                     and r['snapshot_observation_id'] not in assigned)
    stats['suffixRows'] = sum(1 for v in assigned.values() if v[1] == 'suffix')
    stats['autoRows'] = sum(1 for v in assigned.values() if v[1] == 'auto')
    stats['autoVenues'] = len(auto_venues)
    return assigned, auto_venues, dict(stats)

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
    """A tab as a list of dicts. `wb` is an openpyxl workbook or a directory of JSON dumps (scripts/xlsx-dump.py)."""
    if isinstance(wb, str):
        rows = json.load(open(os.path.join(wb, name + '.json'), encoding='utf-8'))
        header = list(rows[0].keys()) if rows else []
        missing = [c for c in (columns or []) if c not in header]
        if missing:
            sys.exit(f'{name}: missing columns {missing}')
        return [{c: r.get(c) for c in (columns or header)} for r in rows]
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

def open_book(path):
    return path if os.path.isdir(path) else openpyxl.load_workbook(path, read_only=True, data_only=True)

def blank(v):
    return None if v is None or str(v).strip() in ('', 'None', 'nan') else v

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
    ap.add_argument('--chain-sheet', required=True)
    ap.add_argument('--logo-manifest', required=True)
    ap.add_argument('--brand-files', required=True)
    ap.add_argument('--venue-files', required=True)
    ap.add_argument('--host-buildings', required=True)
    # Owner rule 2026-10-28 15:24: building parts (LOD > 1) win. The Shopping Center release's host geometry for the
    # venue the sheet links by CityMETER uuid (via the shopping registry's 01_VENUES citymeter_venue_id → venue_id).
    ap.add_argument('--lod-buildings', required=False)
    ap.add_argument('--shop-registry', required=False)
    ap.add_argument('--areas', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    areas = json.load(open(a.areas, encoding='utf-8'))
    area_codes = [f['properties']['id'] for f in areas['features']]
    area_index = {c: i for i, c in enumerate(area_codes)}
    area_uuid = {f['properties']['uuid']: f['properties']['id'] for f in areas['features']}

    wb = open_book(a.sheet)
    readme = {r['หัวข้อ']: r['รายละเอียด'] for r in read_tab(wb, '00_README')}
    store_cols = ['snapshot_observation_id', 'store_name', 'latitude', 'longitude', 'primary_type',
        'start_price_thb', 'end_price_thb', 'price_bucket', 'rating', 'rating_count', 'subdistrict_code', 'subdistrict_id',
        'province_code', 'brand_candidate_id', 'brand_link_status', 'brand_identity_review_required', 'venue_candidate_id',
        'venue_link_status', 'venue_candidate_row_role', 'source_url', 'operating_status', 'geometry_role',
        'coordinate_grid_m_webmercator', 'retrieved_at_utc', 'checked_on', 'snapshot_sha256']
    stores = read_tab(wb, '02_STORES', store_cols)
    for r in stores:
        for k in store_cols:
            r[k] = blank(r[k])
    sheet1_rows = len(stores)
    # The chain-portfolio observations moved to Sheet 2 on 2026-10-25 (same snapshot ids, columns prefixed master_).
    moved_tab = read_tab(open_book(a.chain_sheet), '16_MASTER_OBSERVATIONS')
    register_status = {}
    for m in moved_tab:
        r = {k: blank(m.get('master_' + k)) for k in store_cols}
        r['snapshot_observation_id'] = m['snapshot_observation_id']
        r['_moved'] = True
        try:
            r['_register_outlets'] = [x for x in json.loads(m.get('national_target_ids') or '[]') if isinstance(x, str)]
        except (TypeError, ValueError):
            r['_register_outlets'] = []
        register_status[m['snapshot_observation_id']] = m.get('identity_evidence_class') or ''
        stores.append(r)
    for r in stores:
        if str(r.get('brand_identity_review_required')).upper() not in ('TRUE', 'FALSE'):
            r['brand_identity_review_required'] = 'FALSE'
    brands_tab = read_tab(wb, '01_BRANDS')
    venues_tab = read_tab(wb, '07_VENUES')
    catalog = read_tab(wb, '12_SOURCE_CATALOG')

    # ---------- venue names at the end of restaurant names (rows the sheet left without a venue) ----------
    suffix_assigned, auto_venues, suffix_stats = suffix_venue_rules(stores, venues_tab)
    for r in stores:
        hit = suffix_assigned.get(r['snapshot_observation_id'])
        if hit:
            r['venue_candidate_id'], r['_venue_match'] = hit
    venues_tab = venues_tab + auto_venues

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
    ordinals, brand_col, venue_col, venue_entity, venue_match = {}, {}, {}, [], {}
    register_col, register_outlets = {}, {}
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
        if r.get('_moved'):
            # 1 = moved to the chain register, held for brand/branch review (held_chain_review);
            # 2 = moved with a recorded correspondence (new_high_confidence_candidate / prior_supported_crosswalk — 55 rows).
            cls = register_status.get(r['snapshot_observation_id'], '')
            register_col[i] = 1 if cls == 'held_chain_review' or not cls else 2
            if r.get('_register_outlets'):
                register_outlets[i] = r['_register_outlets']
        if r['venue_candidate_id']:
            venue_col[i] = v_index[r['venue_candidate_id']]
            if r.get('_venue_match'):
                venue_match[i] = 1 if r['_venue_match'] == 'suffix' else 2
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
    def national_ids(b):
        try:
            v = json.loads(b.get('national_brand_ids') or '[]')
            return [x for x in v if isinstance(x, str)]
        except (TypeError, ValueError):
            return []
    for bid in brand_ids:
        b = brands_by_id.get(bid, {})
        brand_records.append({'id': bid, 'name': b.get('brand_name') or bid, 'rows': brand_rows[bid],
                              'logo': b_links.get(bid, ''), 'source': public_url(b.get('source_url')),
                              'link': b.get('brand_link_status') or '', 'hold': bid in holds,
                              'holdReason': (b.get('identity_review_reason') or '') if bid in holds else '',
                              # Register brand ids the sheet itself links this name candidate to (01_BRANDS.national_brand_ids).
                              'national': national_ids(b)})

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
                              'link': v.get('host_link_status') or '',
                              'match': 'auto' if str(v.get('venue_type') or '').startswith('name_suffix_') else 'sheet',
                              # CityMETER shopping-centre uuid the sheet records for this venue (joins the Land registry's citymeter_venue_id).
                              **({'uuid': str(v.get('citymeter_shopping_center_id'))} if re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-', str(v.get('citymeter_shopping_center_id') or '')) else {})})

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
    # ---------- more detailed host geometry by id (LOD > 1 wins over a name-matched footprint) ----------
    lod_venues = []
    if a.lod_buildings and a.shop_registry:
        shop = json.load(open(os.path.join(a.shop_registry, '01_VENUES.json'), encoding='utf-8'))
        sc_by_uuid = {str(r.get('citymeter_venue_id')): str(r.get('venue_id')) for r in shop if r.get('citymeter_venue_id') and r.get('venue_id')}
        lod = json.load(open(a.lod_buildings, encoding='utf-8'))
        by_sc = collections.defaultdict(list)
        for f in lod['features']:
            for sid in f['properties'].get('venue_ids') or []:
                by_sc[sid].append(f)
        is_part = lambda f: f['properties'].get('geometry_role') == 'host_building_part_not_shop_unit'
        for rec in venue_records:
            sid = sc_by_uuid.get(rec.get('uuid', ''))
            feats = by_sc.get(sid, []) if sid else []
            if not any(is_part(f) for f in feats):
                continue  # only building parts (LOD > 1) replace what the venue has
            mine = [f for f in host_features if rec['id'] in f['properties']['venue_ids']]
            if sum(map(is_part, mine)) >= sum(map(is_part, feats)):
                continue  # already as detailed (same research geometry)
            for f in mine:
                f['properties']['venue_ids'] = [v for v in f['properties']['venue_ids'] if v != rec['id']]
            host_features = [f for f in host_features if f['properties']['venue_ids']]
            for f in feats:
                keep = {k: v for k, v in f['properties'].items() if k not in ('venue_ids', 'venue_names')}
                keep['venue_ids'] = [rec['id']]
                keep['venue_names'] = [rec['name']]
                keep['venue_join'] = 'CityMETER venue uuid (this sheet 07_VENUES.citymeter_shopping_center_id) = Shopping Center registry citymeter_venue_id → venue_id; geometry from the Shopping Center release (LOD > 1 parts)'
                host_features.append({'type': 'Feature', 'id': f.get('id', keep.get('host_id')), 'geometry': f['geometry'], 'properties': keep})
            lod_venues.append({'venue': rec['id'], 'name': rec['name'], 'scVenue': sid, 'parts': sum(map(is_part, feats))})
        print('LOD > 1 host geometry by uuid', lod_venues)
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
        'schema': 'citymeter-restaurants-rows-2',
        'dataset': 'CityMETER Restaurants — public overlay snapshot with research enrichment',
        'asOf': '2026-10-22',
        'retrievedOn': sorted(retrieved)[0] if retrieved else '',
        'checkedOn': sorted(checked)[-1] if checked else '',
        'sourceOfRecord': 'Research sheets “CityMETER Restaurants Thailand — Master” (internal; 02_STORES, 01_BRANDS, 07_VENUES) and “CityMETER Chain Restaurants Thailand — Research Master” (internal; 16_MASTER_OBSERVATIONS: the 1,234 snapshot rows moved there on 2026-10-25)',
        'rowSources': {'sheet1': sheet1_rows, 'movedToChainRegister': len(rows_sorted) - sheet1_rows,
                       'rule': 'snapshot = Sheet 1 rows + the rows moved to the chain register; one snapshot_observation_id = one row, never counted twice'},
        'registerRule': 'register: 1 = row moved to the chain register and held for brand/branch review; 2 = moved with a recorded correspondence; registerOutlets = outlet_ids the register lists as possible targets (candidates unless register = 2)',
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
        'venueRule': 'venue = name-based host candidate: (1) the sheet link (07_VENUES); (2) for rows without one, a 07_VENUES name/alias at the end of the restaurant name (venueMatch 1); (3) a place-like ending repeated on ≥ 2 restaurant names whose points all lie within 200 m of their median point (venueMatch 2, a name-derived venue RX-…); a place word after หน้า/ข้าง/ตรงข้าม/near/opposite is a neighbour, never a host; not a verified located-inside relationship',
        'venueSuffix': {**suffix_stats, 'radiusM': AUTO_RADIUS_M, 'mergeM': AUTO_MERGE_M, 'decidedOn': '2026-10-23',
                        'codes': {'1': 'suffix of a 07_VENUES name/alias', '2': 'name-derived place (repeated ending, every point within radiusM of the median point)'}},
    }
    data = {'meta': meta, 'priceBuckets': PRICE_BUCKETS,
            'groups': [{'id': g[0], 'th': g[1], 'en': g[2]} for g in GROUPS],
            'types': types, 'typeGroup': type_group, 'areas': area_codes,
            'brands': brand_records, 'venues': venue_records,
            'cols': cols, 'brand': pairs(brand_col), 'venue': pairs(venue_col), 'venueEntity': venue_entity, 'venueMatch': pairs(venue_match),
            'register': pairs(register_col), 'registerOutlets': pairs(register_outlets)}
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
        'source': 'Luxury Brands release 0.5 host buildings (OpenStreetMap footprints, CityMETER building parts)' + (' + Shopping Center release host geometry with building parts (LOD > 1) for ' + str(len(lod_venues)) + ' venue(s) linked by CityMETER uuid' if lod_venues else ''),
        'join': 'exact normalized venue name/alias; building parts (LOD > 1) by CityMETER venue uuid win (owner 2026-10-28)', 'lodVenues': lod_venues, 'venues': len(hosted), 'features': len(host_features)},
        'features': host_features})
    print('brands', len(brand_records), 'logos', len(b_links), 'issues', len(b_issues), '| venues', len(venue_records), 'logos', len(v_links), 'issues', len(v_issues), '| hosted venues', len(hosted))

if __name__ == '__main__':
    main()

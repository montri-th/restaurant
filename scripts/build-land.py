#!/usr/bin/env python3
"""Spatial-join check of restaurants against the buildings of the registry's Land datasets — OpenStreetMap only.

Owner requests 2026-10-28: “ฝากเช็ค spatial join กับ อาคาร/พื้นที่ ใน dataset กลุ่ม Land ใน registry sheet”, “รูปทรงอาคารถ้ามี
LOD > 1 … ให้ใช้ที่ละเอียดกว่าแทน” and, at 18:27, “ใช้ OSM อย่างเดียว เหมือน web demo ของ dataset อื่น ๆ ใน registry …
จุดร้านอาหารที่ตกริม ๆ ให้รวบเข้าตึกนั้นให้หมดเลย”.
The registry (R11_LAND_LOCATION) lists four Land datasets — Shopping Centers & Retail Venues, Hotel, Office and
Industrial Estates — and R12_DATASET_LINKS keeps one host_context_enrichment link from each to Restaurants. This script
runs that join for the seven provinces the restaurant data covers.

Inputs (internal, never committed): JSON dumps of the research masters (scripts/xlsx-dump.py), the OpenStreetMap
building polygons of the OpenFreeMap z14 tiles that hold the host points (--osm: fetched in a browser from the very
tile set the map draws, decoded with @mapbox/vector-tile; a JSON of {tiles: {"x_y": {f: [{id, k, h, b, hide, rings}]}}}),
the Shopping Center release geometry (--lod-buildings, OpenStreetMap-derived building parts), the industrial-estate
candidate polygons (optional, report only), data/restaurants.json, data/chains.json and data/areas.geojson.

Method (every result is a display-time candidate, never a located-in or tenancy claim):
  1. Land building = the OpenStreetMap building polygon the map itself draws: the OpenFreeMap z14 polygon that holds
     the host's point (smallest), else the nearest within LAND_EDGE_M (10 m), else the polygon that overlaps the
     registry's own reviewed OpenStreetMap footprint most (IoU ≥ 0.3). Pieces clipped at tile edges are merged with
     their same-id, same-height neighbours. No CityMETER V4 footprint is used (owner 2026-10-28 18:27), so a Land
     building never collides with the city massing: it IS the massing polygon, which the app hides under it.
  2. LOD > 1 (owner 15:24): when the registry's reviewed geometry for the host has building parts (base/top per part)
     and its footprint is the same building (IoU ≥ 0.5 with the tile polygon), the parts are drawn inside the tile
     outline instead of one block. Heights stay source values.
  3. Each restaurant display point (≈ 9.55 m grid) and chain-register outlet point is tested against the buildings:
     in = inside the outline OR within EDGE_M (10 m, the coordinate's own uncertainty) — such a point is given a
     display position inside the outline (the nearest point 1.5 m inside) so the pin sits in the building it is
     counted in; near = 10–100 m (report statistic only).
  4. The name-based host links already in the registry are compared with the spatial result.
  5. Industrial estates: candidate polygons only (no selected geometry, rights not reviewed) — counted in the report,
     never published as geometry.
Outputs: data/land.json (hosts, relations, display positions), data/land-buildings.geojson (only buildings that hold at
least one point) and the check report (JSON) given by --report.
"""
import argparse, collections, glob, gzip, json, math, os, re
from shapely.geometry import shape, Point, Polygon, MultiPolygon, mapping
from shapely.ops import unary_union, nearest_points
from shapely.strtree import STRtree

Z, EXTENT = 14, 4096
N = 2 ** Z
EDGE_M, NEAR_M, LAND_EDGE_M = 10.0, 100.0, 10.0
KX = 111320 * math.cos(math.radians(13.75))
KY = 110574.0
GRID = 2 ** 10 * 4096

def to_m(geom):
    """Local metric frame (equirectangular at 13.75° N) for distances; error < 0.5 % across the seven provinces."""
    from shapely.affinity import scale
    return scale(geom, xfact=KX, yfact=KY, origin=(0, 0))

def from_m(geom):
    from shapely.affinity import scale
    return scale(geom, xfact=1 / KX, yfact=1 / KY, origin=(0, 0))

def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def text(v):
    s = '' if v is None else str(v).strip()
    return '' if s in ('None', 'nan') else s

def load(d, tab):
    return json.load(open(os.path.join(d, tab + '.json'), encoding='utf-8'))

def valid(g):
    return g if g.is_valid else g.buffer(0)

def grid_ll(gx, gy):
    return gx / GRID * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy / GRID))))

# ---------- OpenStreetMap buildings from the OpenFreeMap tiles ----------
def load_osm(path):
    """Polygons of the fetched tiles, merged across tile edges (same OSM id, same height, overlapping clipped pieces).
    Returns buildings [{geom, height, base, osm, pieces}] and the count of raw pieces."""
    opener = gzip.open if path.endswith('.gz') else open
    with opener(path, 'rt', encoding='utf-8') as fh:
        data = json.load(fh)
    pieces = []
    for key, tile in data['tiles'].items():
        tx, ty = (int(v) for v in key.split('_'))
        for f in tile.get('f', []):
            if f.get('hide'):
                continue
            try:
                shp = valid(Polygon(f['rings'][0], f['rings'][1:]))
            except Exception:
                continue
            if shp.is_empty or shp.area == 0:
                continue
            h = num(f.get('h'))
            pieces.append({'geom': shp, 'height': h, 'base': num(f.get('b')) or 0.0, 'osm': f.get('id'), 'tile': (tx, ty)})
    parent = list(range(len(pieces)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    tree = STRtree([p['geom'] for p in pieces])
    for i, p in enumerate(pieces):
        for j in tree.query(p['geom']):
            j = int(j)
            if j <= i or pieces[j]['tile'] == p['tile'] or pieces[j]['osm'] != p['osm'] or pieces[j]['height'] != p['height']:
                continue
            if p['geom'].intersection(pieces[j]['geom']).area * KX * KY > 0.5:
                parent[find(j)] = find(i)
    groups = collections.defaultdict(list)
    for i in range(len(pieces)):
        groups[find(i)].append(i)
    buildings = []
    for members in groups.values():
        geom = pieces[members[0]]['geom'] if len(members) == 1 else valid(unary_union([pieces[i]['geom'] for i in members]))
        if geom.geom_type == 'MultiPolygon':  # pieces that only touch at a tile corner: keep the largest polygon
            geom = max(geom.geoms, key=lambda g: g.area)
        buildings.append({'geom': geom, 'height': pieces[members[0]]['height'], 'base': pieces[members[0]]['base'],
                          'osm': pieces[members[0]]['osm'], 'pieces': len(members), 'tiles': sorted({pieces[i]['tile'] for i in members})})
    return buildings, len(pieces), data.get('meta', {})

def round_geom(geom, nd=7):
    m = mapping(geom)
    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {'type': m['type'], 'coordinates': r(m['coordinates'])}

def main():
    ap = argparse.ArgumentParser()
    for k in ['osm', 'shop', 'hotel', 'office', 'estates', 'ie-tiles', 'lod-buildings', 'sheet1', 'chain-dump', 'restaurants', 'chains', 'areas', 'out', 'report']:
        ap.add_argument('--' + k, required=k not in ('ie-tiles', 'lod-buildings', 'estates'))
    a = ap.parse_args()

    areas = json.load(open(a.areas, encoding='utf-8'))
    area_geom = [shape(f['geometry']) for f in areas['features']]
    area_ids = [f['properties']['id'] for f in areas['features']]
    area_tree = STRtree(area_geom)
    def area_of(lon, lat):
        p = Point(lon, lat)
        for i in area_tree.query(p):
            if area_geom[i].contains(p):
                return area_ids[i]
        return ''

    # ---------- Land entities in the covered provinces ----------
    land = []
    def add(ds, eid, name, kind, lat, lon, extra):
        if lat is None or lon is None:
            return
        code = area_of(lon, lat)
        if not code:
            return
        land.append({'ds': ds, 'id': eid, 'name': name, 'type': kind, 'lon': lon, 'lat': lat, 'area': code, **extra})
    for r in load(a.shop, '01_VENUES'):
        add('shopping', text(r['venue_id']), text(r.get('name_th')) or text(r.get('venue_name')) or text(r.get('name_en')), text(r.get('venue_type')),
            num(r.get('latitude')), num(r.get('longitude')),
            {'nameEn': text(r.get('name_en')), 'role': text(r.get('count_role')), 'qualification': text(r.get('venue_qualification_status')),
             'uuid': text(r.get('citymeter_venue_id')), 'mallId': text(r.get('mall_external_id')), 'parent': text(r.get('parent_venue_id'))})
    hotel_links = {text(r['venue_id']): r for r in load(a.hotel, '13_BUILDING_LINKS')}
    for r in load(a.hotel, '01_VENUES'):
        hl = hotel_links.get(text(r['venue_id']), {})
        add('hotel', text(r['venue_id']), text(r.get('venue_name')) or text(r.get('name_en')), text(r.get('venue_type')),
            num(r.get('latitude')), num(r.get('longitude')),
            {'nameEn': text(r.get('name_en')), 'hotelId': text(hl.get('hotel_id')) or text(r.get('source_record_id')), 'rooms': text(r.get('rooms_selected'))})
    for r in load(a.office, '01_OFFICES'):
        if text(r.get('qualification_status')) == 'aggregate_reference_excluded':
            continue
        add('office', text(r['office_id']), text(r.get('current_display_name')) or text(r.get('name_th')) or text(r.get('office_name')), text(r.get('venue_type')),
            num(r.get('latitude')), num(r.get('longitude')),
            {'nameEn': text(r.get('name_en')), 'qualification': text(r.get('qualification_status')), 'osm': text(r.get('building_id'))})
    counts = collections.Counter(x['ds'] for x in land)
    print('land points in the covered provinces', dict(counts))

    # ---------- OpenStreetMap buildings ----------
    osm, n_pieces, osm_meta = load_osm(a.osm)
    osm_geoms = [b['geom'] for b in osm]
    osm_tree = STRtree(osm_geoms)
    osm_m = [to_m(g) for g in osm_geoms]
    print('OpenStreetMap pieces', n_pieces, 'buildings', len(osm))

    # ---------- registry geometry: used only to pick a polygon when the point misses, and to supply parts ----------
    mass_rows = load(a.hotel, '15_BUILDING_MASS')
    parts_by_parent = collections.defaultdict(list)
    for m in mass_rows:
        if text(m.get('geometry_role')) != 'building_part' or text(m.get('render_role')) != 'source_height_extrusion' or text(m.get('geometry_render_eligible')) == 'False':
            continue  # parts still under review stay out
        try:
            g = valid(shape(json.loads(m['geometry'])))
        except Exception:
            continue
        parts_by_parent[text(m.get('parent_geometry_mass_id'))].append({'geom': g, 'base': num(m.get('base_m')) or 0.0, 'top': num(m.get('top_m')),
                                                                       'ref': text(m.get('mass_id')), 'status': 'registry_part_height_unverified'})
    masses = []
    for m in mass_rows:
        if text(m.get('geometry_role')) != 'host_footprint' or text(m.get('geometry_render_eligible')) == 'False':
            continue
        try:
            g = valid(shape(json.loads(m['geometry'])))
        except Exception:
            continue
        mid = text(m.get('mass_id'))
        masses.append({'geom': g, 'hotelIds': json.loads(m.get('hotel_ids') or '[]'), 'officeIds': json.loads(m.get('office_ids') or '[]'),
                       'height': num(m.get('top_m')), 'massId': mid, 'parts': parts_by_parent.get(mid, []),
                       'branchKeys': json.loads(m.get('registry_branch_keys') or '[]')})
    mass_by_hotel, mass_by_office = collections.defaultdict(list), collections.defaultdict(list)
    for i, m in enumerate(masses):
        for h in m['hotelIds']:
            mass_by_hotel[h].append(i)
        for o in m['officeIds']:
            mass_by_office[o].append(i)
    sc_geo, sc_meta = collections.defaultdict(lambda: {'foot': [], 'parts': []}), {}
    if a.lod_buildings:
        lod = json.load(open(a.lod_buildings, encoding='utf-8'))
        sc_meta = lod.get('metadata', {})
        for f in lod['features']:
            p = f['properties']
            try:
                g = valid(shape(f['geometry']))
            except Exception:
                continue
            part = p.get('geometry_role') == 'host_building_part_not_shop_unit'
            rec = {'geom': g, 'base': num(p.get('base_m')) or 0.0, 'top': num(p.get('height_m')), 'ref': text(p.get('host_id')),
                   'status': text(p.get('height_status')), 'osm': text(p.get('osm_id'))}
            for vid in p.get('venue_ids') or []:
                sc_geo[vid]['parts' if part else 'foot'].append(rec)

    def registry_geometry(e):
        """The registry's reviewed footprint(s) and parts for a host, or (None, [])."""
        if e['ds'] == 'shopping':
            sc = sc_geo.get(e['id'])
            if sc and sc['foot']:
                return valid(unary_union([x['geom'] for x in sc['foot']])), sc['parts']
            return None, []
        mids = mass_by_hotel.get(e.get('hotelId')) if e['ds'] == 'hotel' else mass_by_office.get(e['id'])
        if not mids:
            return None, []
        p = Point(e['lon'], e['lat'])
        cands = [i for i in mids if masses[i]['geom'].contains(p)] or mids
        m = masses[min(cands, key=lambda i: masses[i]['geom'].area)]
        e['branchKeys'] = m['branchKeys']
        return m['geom'], m['parts']

    # ---------- host → building ----------
    buildings, building_of = [], {}
    def building_index(i):
        if i not in building_of:
            building_of[i] = len(buildings)
            b = osm[i]
            buildings.append({'osmIndex': i, 'geom': b['geom'], 'height': b['height'], 'base': b['base'], 'osm': b['osm'], 'hosts': [], 'pieces': [], 'lod': 1,
                              'registryRef': '', 'branchKeys': []})
        return building_of[i]
    stats = collections.Counter()
    iou_stats = collections.Counter()
    for li, e in enumerate(land):
        p = Point(e['lon'], e['lat'])
        reg_geom, reg_parts = registry_geometry(e)
        inside = [int(i) for i in osm_tree.query(p) if osm_geoms[i].contains(p)]
        i, by = None, 'none'
        if inside:
            # Nested polygons under one point (a tower drawn inside a mall outline): the registry's reviewed footprint
            # decides when it is the same building (best IoU ≥ 0.3); else a shopping host is the complex (largest),
            # a hotel or office is its own building (smallest).
            def iou_of(j):
                inter = reg_geom.intersection(osm_geoms[j]).area
                return inter / (reg_geom.union(osm_geoms[j]).area or 1) if inter > 0 else 0.0
            ranked = sorted(inside, key=iou_of, reverse=True) if reg_geom is not None else []
            if ranked and iou_of(ranked[0]) >= 0.3:
                i, by = ranked[0], 'point_in_osm'
            elif e['ds'] == 'shopping':
                i, by = max(inside, key=lambda i: osm_geoms[i].area), 'point_in_osm'
            else:
                i, by = min(inside, key=lambda i: osm_geoms[i].area), 'point_in_osm'
        else:
            pm = to_m(p)
            near = [(osm_m[j].distance(pm), int(j)) for j in osm_tree.query(p.buffer(LAND_EDGE_M / KY * 1.5))]
            near = [x for x in near if x[0] <= LAND_EDGE_M]
            if near:
                i, by = min(near)[1], 'edge_osm'
            elif reg_geom is not None:
                best = None
                for j in osm_tree.query(reg_geom):
                    j = int(j)
                    inter = reg_geom.intersection(osm_geoms[j]).area
                    if inter <= 0:
                        continue
                    iou = inter / (reg_geom.union(osm_geoms[j]).area or 1)
                    if iou >= 0.3 and (best is None or iou > best[0]):
                        best = (iou, j)
                if best:
                    i, by = best[1], 'registry_overlap_osm'
        e['fpBy'] = by
        stats[f"{e['ds']}:{by}"] += 1
        if i is None:
            continue
        b = buildings[building_index(i)]
        e['fp'] = building_of[i]
        b['hosts'].append(li)
        # Registry parts (LOD > 1) ride along when the registry footprint is this very building.
        if reg_geom is not None:
            inter = reg_geom.intersection(b['geom']).area
            iou = inter / (reg_geom.union(b['geom']).area or 1)
            iou_stats[e['ds'] + (':iou>=0.5' if iou >= 0.5 else ':iou<0.5')] += 1
            if reg_parts and iou >= 0.5 and len(reg_parts) > len(b['pieces']):
                # Parts belong to this outline only when they sit in it (≥ 90 % of their area); parts of a wider
                # complex than the OpenStreetMap polygon stay out (LOD1), never drawn beyond the outline.
                parts_area = sum(x['geom'].area for x in reg_parts)
                inside_share = sum(x['geom'].intersection(b['geom']).area for x in reg_parts) / parts_area if parts_area else 0
                if inside_share >= 0.9:
                    b['pieces'], b['lod'] = reg_parts, 2
                    b['registryRef'] = 'registry_shopping:' + e['id'] if e['ds'] == 'shopping' else 'registry_osm'
                else:
                    stats['lod2_skipped_parts_outside_outline'] += 1
        if e.get('branchKeys'):
            b['branchKeys'] = list(dict.fromkeys(b['branchKeys'] + e['branchKeys']))
    for b in buildings:
        b['hosts'] = list(dict.fromkeys(b['hosts']))
        if b['lod'] == 2:
            stats['lod2_buildings'] += 1
    print('land building assignment', dict(stats))

    # ---------- points: restaurant display points and chain outlets ----------
    rj = json.load(open(a.restaurants, encoding='utf-8'))
    snap = [(k, *grid_ll(gx, gy)) for k, gx, gy in zip(rj['cols']['key'], rj['cols']['gx'], rj['cols']['gy'])]
    cj = json.load(open(a.chains, encoding='utf-8'))
    outlets = [(oid, lon, lat) for oid, lon, lat, area in zip(cj['cols']['id'], cj['cols']['lon'], cj['cols']['lat'], cj['cols']['area'])
               if lon is not None and area >= 0]
    fp_geoms = [b['geom'] for b in buildings]
    fp_tree = STRtree(fp_geoms)
    fp_m = [to_m(g) for g in fp_geoms]
    fp_inner = [valid(to_m(g).buffer(-1.5)) for g in fp_geoms]

    def join(points):
        """Primary relation per point (smallest containing building; else the nearest within 10 m — counted as in;
        else near ≤ 100 m) and, for a point inside nested buildings, every other building that contains it."""
        out, also = {}, {}
        for key, lon, lat in points:
            p = Point(lon, lat)
            cand = fp_tree.query(p.buffer(NEAR_M / KY * 1.2))
            if not len(cand):
                continue
            inside = sorted((int(i) for i in cand if fp_geoms[i].contains(p)), key=lambda i: fp_geoms[i].area)
            if inside:
                out[key] = (inside[0], 'in', 0.0)
                if len(inside) > 1:
                    also[key] = inside[1:]
                continue
            pm = to_m(p)
            d, i = min((fp_m[i].distance(pm), int(i)) for i in cand)
            if d <= EDGE_M:
                out[key] = (i, 'in', round(d, 1))
            elif d <= NEAR_M:
                out[key] = (i, 'near', round(d, 1))
        return out, also
    snap_join, snap_also = join(snap)
    chain_join, chain_also = join(outlets)
    def in_building(key, b, joined, also):
        hit = joined.get(key)
        return hit if hit and hit[0] == b else (b, 'in', 0.0) if b in also.get(key, []) else None
    print('snapshot joined', collections.Counter(v[1] for v in snap_join.values()), 'chain joined', collections.Counter(v[1] for v in chain_join.values()))

    # ---------- display positions for points counted in but lying outside (≤ 10 m) ----------
    def inside_point(b, lon, lat):
        """Nearest point ≥ 1.5 m inside the outline (else a representative point ≥ 0.3 m inside, else the polygon's
        representative point); always inside the published (7-decimal) outline."""
        inner = fp_inner[b]
        if not inner.is_empty:
            q = from_m(nearest_points(inner, to_m(Point(lon, lat)))[0])
        else:
            thin = valid(fp_m[b].buffer(-0.3))
            q = from_m(thin.representative_point()) if not thin.is_empty else fp_geoms[b].representative_point()
        return round(q.x, 7), round(q.y, 7)
    snap_pos, chain_pos = {}, {}
    moved = collections.Counter()
    snap_lookup = {k: (lon, lat) for k, lon, lat in snap}
    for key, (b, rel, d) in snap_join.items():
        if rel != 'in' or d == 0:
            continue
        snap_pos[key] = inside_point(b, *snap_lookup[key])
        moved['snapshot'] += 1
    outlet_lookup = {k: (lon, lat) for k, lon, lat in outlets}
    for key, (b, rel, d) in chain_join.items():
        if rel != 'in' or d == 0:
            continue
        chain_pos[key] = inside_point(b, *outlet_lookup[key])
        moved['chain'] += 1
    # Every display position lies inside its building as published (the browser recomputes this in tests).
    published = {}
    def published_geom(b):
        if b not in published:
            published[b] = valid(shape(round_geom(fp_geoms[b])))
        return published[b]
    for key, (lon, lat) in list(snap_pos.items()):
        if not published_geom(snap_join[key][0]).contains(Point(lon, lat)):
            moved['snapshot_outside_after_rounding'] += 1; snap_pos.pop(key)
    for key, (lon, lat) in list(chain_pos.items()):
        if not published_geom(chain_join[key][0]).contains(Point(lon, lat)):
            moved['chain_outside_after_rounding'] += 1; chain_pos.pop(key)
    print('display positions', dict(moved))

    # ---------- registry name-based links vs spatial ----------
    s1 = load(a.sheet1, '02_STORES')
    moved_rows = load(a.chain_dump, '16_MASTER_OBSERVATIONS')
    key_of = lambda sid: (lambda m: m.group(1)[:12] + ('' if m.group(2) == '01' else '-' + m.group(2)))(re.match(r'^R-([0-9a-f]{24})-(\d{2})$', sid))
    shop_by_uuid = {e['uuid']: i for i, e in enumerate(land) if e['ds'] == 'shopping' and e.get('uuid')}
    shop_by_mall = {e['mallId']: i for i, e in enumerate(land) if e['ds'] == 'shopping' and e.get('mallId')}
    name_links = []
    def collect(r, pre=''):
        sid = r['snapshot_observation_id']
        uuid = text(r.get(pre + 'citymeter_shopping_center_id'))
        cands = [x.strip() for x in re.split(r'[|,;\s]+', text(r.get(pre + 'common_retail_venue_candidate_ids'))) if x.strip()]
        accepted = [x.strip() for x in re.split(r'[|,;\s]+', text(r.get(pre + 'common_retail_venue_ids'))) if x.strip()]
        targets = set()
        if uuid in shop_by_uuid:
            targets.add(('uuid', shop_by_uuid[uuid]))
        for c in cands + accepted:
            if c in shop_by_mall:
                targets.add(('common_retail', shop_by_mall[c]))
        for basis, li in targets:
            name_links.append((key_of(sid), li, basis, 'accepted' if accepted else 'candidate'))
    for r in s1:
        collect(r)
    for r in moved_rows:
        collect(dict(r), 'master_')
    review = []
    def compare(links, joined, also):
        res = collections.Counter()
        for key, li, basis, status in links:
            e = land[li]
            if 'fp' not in e:
                res['host_without_building'] += 1; continue
            own = in_building(key, e['fp'], joined, also)
            hit = joined.get(key)
            if own:
                res['agree_' + own[1]] += 1
            elif hit:
                res['other_building_' + hit[1]] += 1
                if hit[1] == 'in':
                    review.append({'row': key, 'basis': basis, 'status': status, 'linkedHost': e['id'], 'linkedName': e['name'], 'relation': hit[1], 'distanceM': hit[2],
                                   'spatialHosts': [land[i]['id'] for i in buildings[hit[0]]['hosts']], 'spatialNames': [land[i]['name'] for i in buildings[hit[0]]['hosts']]})
            else:
                res['not_near_host_building'] += 1
        return res
    shop_cmp = compare(name_links, snap_join, snap_also)

    hotel_name = []
    hotel_by_hid = {e.get('hotelId'): i for i, e in enumerate(land) if e['ds'] == 'hotel'}
    for r in load(a.hotel, '11_STORE_LINKS'):
        if text(r.get('industry')) != 'restaurants' or not text(r.get('source_record_id')).startswith('R-'):
            continue
        li = hotel_by_hid.get(text(r.get('hotel_id'))) if text(r.get('hotel_id')) else None
        hotel_name.append((key_of(text(r['source_record_id'])), li, text(r.get('located_in_status'))))
    hotel_cmp = collections.Counter()
    for key, li, status in hotel_name:
        if li is None:
            hotel_cmp['host_not_in_hotel_registry_points'] += 1; continue
        e = land[li]
        if 'fp' not in e:
            hotel_cmp['host_without_building'] += 1; continue
        own, hit = in_building(key, e['fp'], snap_join, snap_also), snap_join.get(key)
        hotel_cmp[('agree_' + own[1]) if own else ('other_building_' + hit[1]) if hit else 'not_near_host_building'] += 1
    mass_cmp = collections.Counter()
    for b_i, b in enumerate(buildings):
        for bk in b.get('branchKeys', []) or []:
            sid = bk.rsplit(':', 1)[-1]
            if not sid.startswith('R-'):
                continue
            own, hit = in_building(key_of(sid), b_i, snap_join, snap_also), snap_join.get(key_of(sid))
            mass_cmp[('agree_' + own[1]) if own else ('other_building_' + hit[1]) if hit else 'not_near'] += 1

    # ---------- industrial estates (candidate polygons, report only) ----------
    ie_report, ie_summary = [], {}
    if a.estates and a.ie_tiles and os.path.isdir(a.ie_tiles):
        import mapbox_vector_tile as mvt
        estates = {text(r['estate_id']): r for r in load(a.estates, '01_ESTATES')}
        versions = load(a.estates, '03_GEOMETRY_VERSIONS')
        feats = collections.defaultdict(list)
        for path in glob.glob(os.path.join(a.ie_tiles, '*.pbf')):
            zt, tx, ty = [int(x) for x in os.path.basename(path)[:-4].split('_')]
            b = open(path, 'rb').read()
            if not b:
                continue
            for lname, layer in mvt.decode(b, default_options={'y_coord_down': True}).items():
                ext = layer.get('extent', 4096)
                for f in layer['features']:
                    fid = text(f['properties'].get('id') or f['properties'].get('uuid') or f.get('id'))
                    g = f['geometry']
                    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates'] if g['type'] == 'MultiPolygon' else []
                    n = 2 ** zt
                    def ll(px, py):
                        gx, gy = (tx + px / ext) / n, (ty + py / ext) / n
                        return gx * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy))))
                    for poly in polys:
                        try:
                            shp = Polygon([ll(*c) for c in poly[0]], [[ll(*c) for c in r] for r in poly[1:]])
                            feats[fid].append(shp if shp.is_valid else shp.buffer(0))
                        except Exception:
                            pass
        merged = {fid: unary_union(gs) for fid, gs in feats.items() if gs}
        covered_codes = {rj['areas'][i] for i in set(rj['cols']['area'])}
        covered_geoms = [g if g.is_valid else g.buffer(0) for g, c in zip(area_geom, area_ids) if c in covered_codes]
        covered_tree = STRtree(covered_geoms)
        for v in versions:
            fid = text(v.get('source_feature_id'))
            if fid not in merged or text(v.get('source_id')) != 'SRC-CITYMETER-IEAT-MVT-20261025':
                continue
            g = merged[fid]
            e = estates.get(text(v.get('estate_id')), {})
            gm = to_m(g)
            gv = g if g.is_valid else g.buffer(0)
            share = sum(gv.intersection(covered_geoms[i]).area for i in covered_tree.query(gv)) / gv.area if gv.area else 0
            accepted = text(e.get('boundary_review_status')).startswith('ยอมรับ') or text(e.get('map_status')).startswith('พร้อม')
            ie_report.append({'estateId': text(v.get('estate_id')), 'name': text(e.get('name_th')), 'province': text(e.get('province')),
                              'boundaryStatus': text(e.get('boundary_review_status')), 'mapStatus': text(e.get('map_status')),
                              'candidateAreaKm2': round(gm.area / 1e6, 2), 'restaurantCoverageShare': round(share, 3),
                              'comparison': 'run' if accepted else 'not_run_boundary_not_accepted'})
        ie_all = load(a.estates, '01_ESTATES')
        seven = {'กรุงเทพมหานคร', 'นนทบุรี', 'สมุทรปราการ', 'ปทุมธานี', 'สมุทรสาคร', 'ฉะเชิงเทรา', 'นครปฐม'}
        ie_summary = {'estatesInRegistry': len(ie_all), 'estatesInCoveredProvinces': sum(1 for r in ie_all if text(r.get('province')) in seven),
                      'boundaryStatus': dict(collections.Counter(text(r.get('boundary_review_status')) for r in ie_all)),
                      'candidatePolygonsChecked': len(ie_report),
                      'rule': 'registry link DL-2669875b0346b95e63be: candidate polygons never confirm inside; inside vs around after boundary, date and rights acceptance'}

    # ---------- write ----------
    # Published per-point relations: in only (the building the point is counted in). “near” is a report statistic;
    # the app measures the 10–100 m ring around one opened building itself.
    snap_pub = {k: v for k, v in snap_join.items() if v[1] == 'in'}
    chain_pub = {k: v for k, v in chain_join.items() if v[1] == 'in'}
    used = sorted({v[0] for v in snap_pub.values()} | {v[0] for v in chain_pub.values()} |
                  {b for v in snap_also.values() for b in v} | {b for v in chain_also.values() for b in v})
    remap = {b: i for i, b in enumerate(used)}
    feats = []
    def display_top(top, base):
        return top if top and top > base else base + 3  # unknown or zero height: a 3 m display slab, height_m stays as the source says
    for b in used:
        bd = buildings[b]
        g = bd['geom']
        h = bd['height']
        host_ids = [land[i]['id'] for i in bd['hosts']]
        pieces = bd.get('pieces') or []
        common = {'building': remap[b], 'source': 'openfreemap_osm', 'osm_id': bd['osm'], 'lod': bd.get('lod', 1), 'venue_ids': host_ids}
        if pieces:
            # LOD > 1: the OpenStreetMap outline is drawn as an outline; each registry part is extruded from its own base to top.
            feats.append({'type': 'Feature', 'id': remap[b], 'geometry': round_geom(g),
                          'properties': {'id': remap[b], **common, 'pieces': len(pieces), 'height_m': h, 'base_m': 0, 'display_height_m': 0, 'display_base_m': 0,
                                         'render_as': 'outline', 'height_status': 'pieces', 'geometry_role': 'land_host_building', 'parts_source': bd['registryRef']}})
            for k, x in enumerate(pieces):
                top, base = num(x.get('top')), num(x.get('base')) or 0.0
                feats.append({'type': 'Feature', 'id': f'{remap[b]}.{k}', 'geometry': round_geom(x['geom']),
                              'properties': {'id': f'{remap[b]}.{k}', **common, 'height_m': top, 'base_m': base, 'display_height_m': display_top(top, base), 'display_base_m': base,
                                             'render_as': 'extrusion', 'height_status': x.get('status') or ('source_height' if top else 'unknown_display_fallback'),
                                             'geometry_role': 'land_host_building_part', 'parts_source': bd['registryRef']}})
        else:
            feats.append({'type': 'Feature', 'id': remap[b], 'geometry': round_geom(g),
                          'properties': {'id': remap[b], **common, 'pieces': 0, 'height_m': h, 'base_m': bd['base'] or 0,
                                         'display_height_m': h if h and h > 0 else 3, 'display_base_m': bd['base'] or 0, 'render_as': 'extrusion',
                                         'height_status': 'source_height' if h and h > 0 else 'unknown_display_fallback',
                                         'geometry_role': 'land_host_building'}})
    host_keep = sorted({i for b in used for i in buildings[b]['hosts']})
    host_records = []
    for i in host_keep:
        e = land[i]
        host_records.append({'id': e['id'], 'ds': e['ds'], 'name': e['name'], 'nameEn': e.get('nameEn', ''), 'type': e['type'], 'area': e['area'],
                             'lon': round(e['lon'], 7), 'lat': round(e['lat'], 7), 'fp': remap.get(e.get('fp'), -1), 'fpBy': e.get('fpBy', ''),
                             **({'uuid': e['uuid']} if e.get('uuid') else {}), **({'role': e['role']} if e.get('role') else {})})
    REL = {'in': 0, 'near': 2}
    shapes_as_of = ''
    m = re.search(r'(\d{4})(\d{2})(\d{2})', str(osm_meta.get('source', '')))
    if m:
        shapes_as_of = f'{m.group(1)}-{m.group(2)}-{m.group(3)}'
    land_json = {
        'meta': {'schema': 'citymeter-land-join-2', 'checkedOn': '2026-10-28', 'shapesAsOf': shapes_as_of,
                 'datasets': {'shopping': 'research.TH.shopping', 'hotel': 'research.TH.hotel', 'office': 'research.TH.office'},
                 'rule': 'display-time candidate: restaurant display point (≈ 9.55 m grid) or register outlet point vs the Land building outline; in = inside or within 10 m (the coordinate\'s own uncertainty; such points get a display position inside the outline), near = 10–100 m (report only); never a located-in, tenancy or floor claim',
                 'buildingRule': 'Land building = the OpenStreetMap building polygon of the OpenFreeMap z14 tiles the map draws: the polygon holding the host point, else the nearest within 10 m, else the polygon overlapping the registry\'s reviewed OpenStreetMap footprint most (IoU ≥ 0.3). Registry building parts (LOD > 1) are drawn inside the outline when the registry footprint is the same building (IoU ≥ 0.5). No CityMETER V4 footprint (owner 2026-10-28 18:27)',
                 'geometrySources': {'openfreemap_osm': f"OpenStreetMap building polygons via OpenFreeMap ({osm_meta.get('source', 'z14 building layer')}), ODbL",
                                     'registry_parts': 'Shopping Center release geometry bundle and Hotel registry 15_BUILDING_MASS building parts (OpenStreetMap-derived; base/top as recorded, unverified)'},
                 'relations': ['in', 'in', 'near'],
                 'display': 'snaps.rows / snaps.chains: display positions inside the outline for points counted in from within 10 m; the source positions stay in restaurants.json / chains.json',
                 'nested': 'a point inside several nested Land buildings has one row per building, the smallest first'},
        'hosts': host_records,
        # One row per (point, building): the primary relation first, then every other building that also contains the point.
        'snapshot': [r for k, v in sorted(snap_pub.items()) for r in [[k, remap[v[0]], REL[v[1]], v[2]]] + [[k, remap[b], 0, 0.0] for b in snap_also.get(k, [])]],
        'chains': [r for k, v in sorted(chain_pub.items()) for r in [[k, remap[v[0]], REL[v[1]], v[2]]] + [[k, remap[b], 0, 0.0] for b in chain_also.get(k, [])]],
        'snaps': {'rows': [[k, v[0], v[1]] for k, v in sorted(snap_pos.items())], 'chains': [[k, v[0], v[1]] for k, v in sorted(chain_pos.items())]},
    }
    os.makedirs(os.path.join(a.out, 'data'), exist_ok=True)
    with open(os.path.join(a.out, 'data', 'land.json'), 'w', encoding='utf-8') as fh:
        json.dump(land_json, fh, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(a.out, 'data', 'land-buildings.geojson'), 'w', encoding='utf-8') as fh:
        json.dump({'type': 'FeatureCollection', 'metadata': {'attribution': '© OpenStreetMap contributors (ODbL) via OpenFreeMap / OpenMapTiles · building parts: registry (OpenStreetMap-derived)',
                   'source': f"Land building outlines of the 2026-10-28 restaurant join check — {osm_meta.get('source', 'OpenFreeMap z14 building layer')}"}, 'features': feats}, fh, ensure_ascii=False, separators=(',', ':'))
    per_ds = collections.defaultdict(collections.Counter)
    for e in land:
        per_ds[e['ds']]['points'] += 1
        per_ds[e['ds']]['fp_' + e.get('fpBy', 'none')] += 1
    rank = {'in': 0, 'near': 2}
    for name, joined, also in (('snapshot', snap_join, snap_also), ('chain', chain_join, chain_also)):
        for k, v in joined.items():
            best = {}
            for b, rel in [(v[0], v[1])] + [(b, 'in') for b in also.get(k, [])]:
                for i in buildings[b]['hosts']:
                    ds = land[i]['ds']
                    if ds not in best or rank[rel] < rank[best[ds]]:
                        best[ds] = rel
            for ds, rel in best.items():
                per_ds[ds][f'{name}_{rel}'] += 1
    lod_pub = collections.Counter(buildings[b].get('lod', 1) for b in used)
    with_points = {i for b in used for i in buildings[b]['hosts']}
    by_type = collections.defaultdict(lambda: [0, 0])
    for i, e in enumerate(land):
        t = f"{e['ds']}:{e['type'] or 'unclassified'}"
        by_type[t][1] += 1
        if i in with_points:
            by_type[t][0] += 1
    in_from_edge = {'snapshot': sum(1 for v in snap_join.values() if v[1] == 'in' and v[2] > 0), 'chain': sum(1 for v in chain_join.values() if v[1] == 'in' and v[2] > 0)}
    report = {'checkedOn': '2026-10-28', 'landPoints': dict(counts), 'buildingAssignment': dict(stats),
              'osm': {'source': osm_meta.get('source', ''), 'tiles': osm_meta.get('tiles'), 'pieces': n_pieces, 'buildings': len(osm), 'fetchErrors': osm_meta.get('errors', [])},
              'registryFootprintVsOsmAtHost': dict(iou_stats),
              'publishedBuildingsByLod': {f'lod{k}': v for k, v in sorted(lod_pub.items())},
              'publishedParts': sum(1 for f in feats if f['properties']['geometry_role'] == 'land_host_building_part'),
              'shoppingCenterRelease': {k: sc_meta.get(k) for k in ('as_of', 'features', 'venues')},
              'hotelMasses': len(masses), 'perDataset': {k: dict(v) for k, v in per_ds.items()},
              'snapshotJoined': dict(collections.Counter(v[1] for v in snap_join.values())), 'chainJoined': dict(collections.Counter(v[1] for v in chain_join.values())),
              'inFromWithin10m': in_from_edge, 'displayPositions': dict(moved),
              'snapshotPoints': len(snap), 'chainPointsInCoveredProvinces': len(outlets),
              'pointsInNestedBuildings': {'snapshot': len(snap_also), 'chain': len(chain_also)},
              'nameLinkReview': review,
              'nameLinksShopping': {'links': len(name_links), 'result': dict(shop_cmp)},
              'nameLinksHotel': {'links': len(hotel_name), 'result': dict(hotel_cmp)},
              'hotelMassBranchKeys': dict(mass_cmp),
              'industrialEstates': {'summary': ie_summary, 'candidates': ie_report},
              'hostsWithPointsByType': {k: {'withPoints': v[0], 'total': v[1]} for k, v in sorted(by_type.items())},
              'buildingsPublished': len(used), 'featuresPublished': len(feats), 'hostsPublished': len(host_records)}
    with open(a.report, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != 'nameLinkReview'}, ensure_ascii=False, indent=1)[:6000])

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Spatial-join check of restaurants against the buildings and areas of the registry's Land datasets.

Owner request 2026-10-28: “ฝากเช็ค spatial join กับ อาคาร/พื้นที่ ใน dataset กลุ่ม Land ใน registry sheet”.
The registry (R11_LAND_LOCATION) lists four Land datasets — Shopping Centers & Retail Venues, Hotel, Office and
Industrial Estates — and R12_DATASET_LINKS keeps one host_context_enrichment link from each to Restaurants, all at
review_status = idea / pending_research. This script runs that join for the seven provinces the restaurant data covers.

Inputs (internal, never committed): JSON dumps of the research masters (scripts/xlsx-dump.py), the CityMETER production
V4 building footprints for the tiles that hold the points (public detailMvt, per subdistrict; fetched read-only), the
industrial-estate candidate polygons (public getIEATBoundMVT tiles), data/restaurants.json, data/chains.json and
data/areas.geojson.

Method (every result is a display-time candidate, never a located-in or tenancy claim):
  1. Land building = the registry's own reviewed host geometry when it has one — Shopping: the Shopping Center
     release's selected host geometry for the same venue_id (13_BUILDING_LINKS → research geometry bundle,
     --lod-buildings); Hotel / Office: 15_BUILDING_MASS host_footprint (original OpenStreetMap vertices) — else the
     production V4 footprint that contains the Land point (smallest containing; within 3 m of an edge counts as
     “edge”). Owner rule 2026-10-28 15:24 (“รูปทรงอาคารถ้ามี LOD > 1 … ให้ใช้ที่ละเอียดกว่าแทน”): when the registry
     geometry has building parts (base/top per part, LOD > 1) the parts are drawn instead of one LOD1 block, the
     host footprint becomes an outline, and the join uses the union of footprint and parts. V4 footprint parts
     clipped at tile edges are merged with their overlapping, same-height neighbours.
  2. Each restaurant display point (≈ 9.55 m grid) and chain-register outlet point is tested against the Land
     buildings: in (inside the outline), edge (≤ 10 m from it — within the coordinate's own uncertainty), near (≤ 100 m).
  3. The name-based host links already in the registry (Sheet 1 citymeter_shopping_center_id / common-retail candidate
     ids, Hotel 11_STORE_LINKS, Hotel 15_BUILDING_MASS registry_branch_keys) are compared with the spatial result.
  4. Industrial estates: candidate polygons only (no selected geometry, rights not reviewed) — counted in the report,
     never published as geometry.
Outputs: data/land.json, data/land-buildings.geojson (only buildings that hold or touch at least one point) and the
check report (JSON) given by --report.
"""
import argparse, collections, glob, json, math, os, re
import mapbox_vector_tile as mvt
from shapely.geometry import shape, Point, Polygon, MultiPolygon, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree

SKIPPED = []
Z, EXTENT = 14, 4096
N = 2 ** Z
EDGE_M, NEAR_M, LAND_EDGE_M = 10.0, 100.0, 3.0
KX = 111320 * math.cos(math.radians(13.75))
KY = 110574.0

def to_m(geom):
    """Local metric frame (equirectangular at 13.75° N) for distances; error < 0.5 % across the seven provinces."""
    from shapely.affinity import scale
    return scale(geom, xfact=KX, yfact=KY, origin=(0, 0))

def tile_ll(px, py, tx, ty):
    gx, gy = (tx + px / EXTENT) / N, (ty + py / EXTENT) / N
    return gx * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy))))

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

# ---------- production V4 footprints ----------
def load_footprints(tile_dir):
    import hashlib
    parts, seen = [], set()
    for path in sorted(glob.glob(os.path.join(tile_dir, '*.pbf'))):
        meta = path + '.json'
        b = open(path, 'rb').read()
        # Only complete responses: HTTP 200 recorded with the same sha256 as the bytes on disk.
        if not os.path.exists(meta):
            continue
        m = json.load(open(meta))
        if m.get('status') != 200 or m.get('sha256') != hashlib.sha256(b).hexdigest() or not b:
            continue
        tx, ty, _ = os.path.basename(path)[:-4].split('_', 2)
        tx, ty = int(tx), int(ty)
        try:
            layer = mvt.decode(b, default_options={'y_coord_down': True}).get('building-detail', {})
        except Exception:
            SKIPPED.append(os.path.basename(path))  # truncated response: refetch before a release build
            continue
        for f in layer.get('features', []):
            g = f['geometry']
            polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates'] if g['type'] == 'MultiPolygon' else []
            for poly in polys:
                key = (tx, ty, json.dumps(poly))
                if key in seen:
                    continue
                seen.add(key)
                clipped = any(px < 0 or px > EXTENT or py < 0 or py > EXTENT for ring in poly for px, py in ring)
                try:
                    shp = Polygon([tile_ll(px, py, tx, ty) for px, py in poly[0]], [[tile_ll(px, py, tx, ty) for px, py in r] for r in poly[1:]])
                except Exception:
                    continue
                if not shp.is_valid:
                    shp = shp.buffer(0)
                if shp.is_empty or shp.area == 0:
                    continue
                parts.append({'geom': shp, 'height': text(f['properties'].get('height_m')), 'floors': f['properties'].get('estimated_floor'),
                              'tile': (tx, ty), 'clipped': clipped})
    # Merge clipped parts of one building across tiles: different tile, same height, overlapping area.
    parent = list(range(len(parts)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    clipped_idx = [i for i, p in enumerate(parts) if p['clipped']]
    tree = STRtree([parts[i]['geom'] for i in clipped_idx])
    for k, i in enumerate(clipped_idx):
        for j in tree.query(parts[i]['geom']):
            j = clipped_idx[j]
            if j <= i or parts[j]['tile'] == parts[i]['tile'] or parts[j]['height'] != parts[i]['height']:
                continue
            if parts[i]['geom'].intersection(parts[j]['geom']).area * KX * KY > 1.0:
                parent[find(j)] = find(i)
    groups = collections.defaultdict(list)
    for i in range(len(parts)):
        groups[find(i)].append(i)
    buildings = []
    for members in groups.values():
        geom = parts[members[0]]['geom'] if len(members) == 1 else unary_union([parts[i]['geom'] for i in members])
        buildings.append({'geom': geom, 'height': parts[members[0]]['height'], 'floors': parts[members[0]]['floors'],
                          'parts': len(members), 'source': 'citymeter_v4'})
    return buildings, len(parts)

def round_geom(geom, nd=7):
    m = mapping(geom)
    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {'type': m['type'], 'coordinates': r(m['coordinates'])}

def main():
    ap = argparse.ArgumentParser()
    for k in ['tiles', 'shop', 'hotel', 'office', 'estates', 'ie-tiles', 'lod-buildings', 'sheet1', 'chain-dump', 'restaurants', 'chains', 'areas', 'out', 'report']:
        ap.add_argument('--' + k, required=k not in ('ie-tiles', 'lod-buildings'))
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

    # ---------- buildings ----------
    v4, n_parts = load_footprints(a.tiles)
    v4_tree = STRtree([b['geom'] for b in v4])
    print('V4 footprint parts', n_parts, 'buildings', len(v4))
    def valid(g):
        return g if g.is_valid else g.buffer(0)

    # Registry building parts (LOD > 1): base/top per part under a host footprint drawn as an outline.
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
                       'height': text(m.get('top_m')), 'source': 'registry_osm', 'massId': mid, 'parts': parts_by_parent.get(mid, []),
                       'qualified': json.loads(m.get('qualified_hotel_ids') or '[]'), 'branchKeys': json.loads(m.get('registry_branch_keys') or '[]')})
    mass_by_hotel, mass_by_office = collections.defaultdict(list), collections.defaultdict(list)
    for i, m in enumerate(masses):
        for h in m['hotelIds']:
            mass_by_hotel[h].append(i)
        for o in m['officeIds']:
            mass_by_office[o].append(i)

    # Shopping: the Shopping Center release's selected host geometry for the same venue_id (footprints and parts).
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
                   'status': text(p.get('height_status')), 'outline': p.get('render_as') == 'outline', 'osm': text(p.get('osm_id'))}
            for vid in p.get('venue_ids') or []:
                sc_geo[vid]['parts' if part else 'foot'].append(rec)

    buildings, building_key = [], {}
    def building_index(src, ref, geom, height, floors=None, extra=None):
        key = (src, ref)
        if key not in building_key:
            building_key[key] = len(buildings)
            buildings.append({'src': src, 'ref': ref, 'geom': geom, 'height': height, 'floors': floors, 'hosts': [], 'pieces': [], 'lod': 1, **(extra or {})})
        return building_key[key]
    def registry_building(src, ref, foot, parts, height, extra=None):
        """Join geometry = union of the footprint(s) and parts; pieces = the parts (LOD > 1), or the footprints when a
        venue has several (each keeps its own height); a single footprint is one LOD1 block. One OpenStreetMap
        footprint is one building whichever registry names it (CentralWorld is both a Shopping venue and a Hotel /
        Office mass): its hosts are merged and the more detailed representation (more parts) is kept."""
        geom = valid(unary_union([x['geom'] for x in foot + parts])) if len(foot) + len(parts) > 1 else (foot or parts)[0]['geom']
        pieces = parts if parts else (foot if len(foot) > 1 else [])
        tops = [x['top'] for x in pieces if x['top']]
        osm = foot[0].get('osm') if len(foot) == 1 and foot[0].get('osm', '').startswith('osm:') else ''
        key_src, key_ref = ('osm', osm) if osm else (src, ref)
        rep = {'geom': geom, 'pieces': pieces, 'lod': 2 if parts else 1, 'height': max(tops) if tops else height}
        if (key_src, key_ref) in building_key:
            b = buildings[building_key[(key_src, key_ref)]]
            if len(pieces) > len(b['pieces']):
                b.update(rep, src=src)
            for k, v in (extra or {}).items():
                b[k] = list(dict.fromkeys((b.get(k) or []) + v)) if isinstance(v, list) else v
            return building_key[(key_src, key_ref)]
        i = building_index(key_src, key_ref, geom, rep['height'], extra={'pieces': pieces, 'lod': rep['lod'], **(extra or {})})
        buildings[i]['src'] = src
        return i
    stats = collections.Counter()
    for e in land:
        p = Point(e['lon'], e['lat'])
        sc = sc_geo.get(e['id']) if e['ds'] == 'shopping' else None
        mids = mass_by_hotel.get(e.get('hotelId')) if e['ds'] == 'hotel' else mass_by_office.get(e['id']) if e['ds'] == 'office' else None
        if sc and (sc['foot'] or sc['parts']):
            foot = [x for x in sc['foot']]
            e['fp'] = registry_building('registry_shopping', e['id'], foot, sc['parts'], foot[0]['top'] if foot else None)
            e['fpBy'] = 'registry_geometry'
        elif mids:
            cands = [i for i in mids if masses[i]['geom'].contains(p)] or mids
            m = masses[min(cands, key=lambda i: masses[i]['geom'].area)]
            e['fp'] = registry_building('registry_osm', m['massId'], [{'geom': m['geom'], 'top': num(m['height']), 'base': 0.0, 'osm': m['massId']}], m['parts'], m['height'],
                                        extra={'branchKeys': m['branchKeys']})
            e['fpBy'] = 'registry_mass'
        else:
            inside = [i for i in v4_tree.query(p) if v4[i]['geom'].contains(p)]
            i = None
            if inside:
                i = min(inside, key=lambda i: v4[i]['geom'].area)
                e['fpBy'] = 'point_in_v4'
            else:
                pm = to_m(p)
                near = [(to_m(v4[i]['geom']).distance(pm), i) for i in v4_tree.query(p.buffer(LAND_EDGE_M / KY * 1.5))]
                near = [x for x in near if x[0] <= LAND_EDGE_M]
                i = min(near)[1] if near else None
                e['fpBy'] = 'edge_v4' if near else 'none'
            if i is not None:
                b = v4[i]
                e['fp'] = building_index('citymeter_v4', i, b['geom'], b['height'], b['floors'])
        stats[f"{e['ds']}:{e['fpBy']}"] += 1
        if 'fp' in e and buildings[e['fp']]['lod'] == 2:
            stats[f"{e['ds']}:lod2"] += 1
    # How the registry geometry compares with the V4 footprint the point alone would pick (shopping and offices).
    v4_agree = collections.Counter()
    for e in land:
        if e.get('fpBy') not in ('registry_geometry', 'registry_mass'):
            continue
        p = Point(e['lon'], e['lat'])
        inside = [i for i in v4_tree.query(p) if v4[i]['geom'].contains(p)]
        if not inside:
            v4_agree[e['ds'] + ':no_v4_at_point'] += 1
            continue
        g4 = v4[min(inside, key=lambda i: v4[i]['geom'].area)]['geom']
        gr = buildings[e['fp']]['geom']
        inter = gr.intersection(g4).area
        iou = inter / (gr.union(g4).area or 1)
        v4_agree[e['ds'] + (':iou>=0.5' if iou >= 0.5 else ':iou<0.5')] += 1
    # host lists (by index in `land`)
    for i, e in enumerate(land):
        if 'fp' in e:
            buildings[e['fp']]['hosts'].append(i)
    print('land building assignment', dict(stats))

    # ---------- points: restaurant display points and chain outlets ----------
    rj = json.load(open(a.restaurants, encoding='utf-8'))
    G = 2 ** 10 * 4096
    def grid_ll(gx, gy):
        return gx / G * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy / G))))
    snap = [(k, *grid_ll(gx, gy)) for k, gx, gy in zip(rj['cols']['key'], rj['cols']['gx'], rj['cols']['gy'])]
    cj = json.load(open(a.chains, encoding='utf-8'))
    outlets = [(oid, lon, lat) for oid, lon, lat, area in zip(cj['cols']['id'], cj['cols']['lon'], cj['cols']['lat'], cj['cols']['area'])
               if lon is not None and area >= 0]
    fp_geoms = [b['geom'] for b in buildings]
    fp_tree = STRtree(fp_geoms)
    fp_m = [to_m(g) for g in fp_geoms]

    def join(points):
        """Primary relation per point (smallest containing building; else the nearest edge / near building) and, for a
        point inside nested buildings (an office tower or supermarket inside a mall outline), every other building that
        contains it — the point falls in each of them, none is preferred by type."""
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
                out[key] = (i, 'edge', round(d, 1))
            elif d <= NEAR_M:
                out[key] = (i, 'near', round(d, 1))
        return out, also
    snap_join, snap_also = join(snap)
    chain_join, chain_also = join(outlets)
    def in_building(key, b, joined, also):
        hit = joined.get(key)
        return hit if hit and hit[0] == b else (b, 'in', 0.0) if b in also.get(key, []) else None
    print('snapshot joined', collections.Counter(v[1] for v in snap_join.values()), 'chain joined', collections.Counter(v[1] for v in chain_join.values()))

    # ---------- registry name-based links vs spatial ----------
    s1 = load(a.sheet1, '02_STORES')
    moved = load(a.chain_dump, '16_MASTER_OBSERVATIONS')
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
    for r in moved:
        r = dict(r); r['snapshot_observation_id'] = r['snapshot_observation_id']
        collect(r, 'master_')
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
                if hit[1] in ('in', 'edge'):
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
    if a.ie_tiles and os.path.isdir(a.ie_tiles):
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
        # Restaurant coverage: the subdistricts that hold at least one snapshot row. Registry link DL-2669875b0346b95e63be
        # (industrial estates → restaurants): a candidate polygon never confirms “inside”; compare inside vs around only
        # after the boundary, its date and rights are accepted. No estate boundary is accepted yet, so this check reports
        # only where the estates sit relative to the restaurant coverage — no inside / around counts.
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
    # Published per-point relations: in / edge only (the building the point falls in or touches). “near” is a
    # report statistic; the app measures the ring around one opened building itself (any Land building, not the nearest).
    snap_pub = {k: v for k, v in snap_join.items() if v[1] != 'near'}
    chain_pub = {k: v for k, v in chain_join.items() if v[1] != 'near'}
    used = sorted({v[0] for v in snap_pub.values()} | {v[0] for v in chain_pub.values()} |
                  {b for v in snap_also.values() for b in v} | {b for v in chain_also.values() for b in v})
    remap = {b: i for i, b in enumerate(used)}
    feats = []
    def display_top(top, base):
        return top if top and top > base else base + 3  # unknown or zero height: a 3 m display slab, height_m stays as the source says
    for b in used:
        bd = buildings[b]
        g = bd['geom']
        h = num(bd['height'])
        host_ids = [land[i]['id'] for i in bd['hosts']]
        pieces = bd.get('pieces') or []
        common = {'building': remap[b], 'source': bd['src'], 'lod': bd.get('lod', 1), 'venue_ids': host_ids}
        if pieces:
            # LOD > 1 (or several footprints): the building is an outline; each piece is extruded from its own base to top.
            feats.append({'type': 'Feature', 'id': remap[b], 'geometry': round_geom(g),
                          'properties': {'id': remap[b], **common, 'pieces': len(pieces), 'height_m': h, 'base_m': 0, 'display_height_m': 0, 'display_base_m': 0,
                                         'render_as': 'outline', 'height_status': 'pieces', 'geometry_role': 'land_host_building'}})
            for k, x in enumerate(pieces):
                top, base = num(x.get('top')), num(x.get('base')) or 0.0
                feats.append({'type': 'Feature', 'id': f'{remap[b]}.{k}', 'geometry': round_geom(x['geom']),
                              'properties': {'id': f'{remap[b]}.{k}', **common, 'height_m': top, 'base_m': base, 'display_height_m': display_top(top, base), 'display_base_m': base,
                                             'render_as': 'extrusion', 'height_status': x.get('status') or ('source_height' if top else 'unknown_display_fallback'),
                                             'geometry_role': 'land_host_building_part'}})
        else:
            feats.append({'type': 'Feature', 'id': remap[b], 'geometry': round_geom(g),
                          'properties': {'id': remap[b], **common, 'pieces': 0, 'height_m': h, 'base_m': 0,
                                         'display_height_m': h if h and h > 0 else 3, 'display_base_m': 0, 'render_as': 'extrusion',
                                         'height_status': 'source_height' if h and h > 0 else 'unknown_display_fallback',
                                         'geometry_role': 'land_host_building'}})
    host_keep = sorted({i for b in used for i in buildings[b]['hosts']})
    host_records = []
    for i in host_keep:
        e = land[i]
        host_records.append({'id': e['id'], 'ds': e['ds'], 'name': e['name'], 'nameEn': e.get('nameEn', ''), 'type': e['type'], 'area': e['area'],
                             'lon': round(e['lon'], 7), 'lat': round(e['lat'], 7), 'fp': remap.get(e.get('fp'), -1), 'fpBy': e.get('fpBy', ''),
                             **({'uuid': e['uuid']} if e.get('uuid') else {}), **({'role': e['role']} if e.get('role') else {})})
    host_index = {r['id']: k for k, r in enumerate(host_records)}
    REL = {'in': 0, 'edge': 1, 'near': 2}
    land_json = {
        'meta': {'schema': 'citymeter-land-join-1', 'checkedOn': '2026-10-28',
                 'datasets': {'shopping': 'research.TH.shopping', 'hotel': 'research.TH.hotel', 'office': 'research.TH.office'},
                 'rule': 'display-time candidate: restaurant display point (≈ 9.55 m grid) or register outlet point vs the Land building outline; in = inside, edge = within 10 m, near = within 100 m; never a located-in, tenancy or floor claim',
                 'buildingRule': 'Land building = the registry reviewed host geometry when present (Shopping: Shopping Center release host geometry for the same venue_id; Hotel/Office: 15_BUILDING_MASS host_footprint, OpenStreetMap), else the CityMETER production V4 footprint that contains the Land point (or lies within 3 m). Building parts (LOD > 1) are drawn instead of one block when the registry has them (owner 2026-10-28); the join uses the union of footprint and parts',
                 'geometrySources': {'registry_shopping': 'Shopping Center release (research geometry bundle, ODbL OpenStreetMap / CityMETER parts) as of ' + str(sc_meta.get('as_of', '')),
                                     'registry_osm': 'Hotel registry 15_BUILDING_MASS (original OpenStreetMap vertices; parts base/top unverified)',
                                     'citymeter_v4': 'CityMETER production building footprints (V4, detailMvt) — LOD1 footprint + height'},
                 'relations': ['in', 'edge', 'near'],
                 'nested': 'a point inside several nested Land buildings has one row per building, the smallest first'},
        'hosts': host_records,
        # One row per (point, building): the primary relation first, then every other building that also contains the point.
        'snapshot': [r for k, v in sorted(snap_pub.items()) for r in [[k, remap[v[0]], REL[v[1]], v[2]]] + [[k, remap[b], 0, 0.0] for b in snap_also.get(k, [])]],
        'chains': [r for k, v in sorted(chain_pub.items()) for r in [[k, remap[v[0]], REL[v[1]], v[2]]] + [[k, remap[b], 0, 0.0] for b in chain_also.get(k, [])]],
    }
    os.makedirs(os.path.join(a.out, 'data'), exist_ok=True)
    with open(os.path.join(a.out, 'data', 'land.json'), 'w', encoding='utf-8') as fh:
        json.dump(land_json, fh, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(a.out, 'data', 'land-buildings.geojson'), 'w', encoding='utf-8') as fh:
        json.dump({'type': 'FeatureCollection', 'metadata': {'attribution': '© OpenStreetMap contributors (registry host geometry, ODbL) · CityMETER production building footprints (V4) and building parts',
                   'source': 'Land building outlines used by the 2026-10-28 restaurant join check'}, 'features': feats}, fh, ensure_ascii=False, separators=(',', ':'))
    per_ds = collections.defaultdict(collections.Counter)
    for e in land:
        per_ds[e['ds']]['points'] += 1
        per_ds[e['ds']]['fp_' + e.get('fpBy', 'none')] += 1
    # Per dataset: a point counts once per dataset whose building it falls in / touches / lies near (best relation).
    rank = {'in': 0, 'edge': 1, 'near': 2}
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
    lod_pub = collections.Counter((buildings[b]['src'], buildings[b].get('lod', 1)) for b in used)
    report = {'checkedOn': '2026-10-28', 'landPoints': dict(counts), 'buildingAssignment': dict(stats), 'v4': {'parts': n_parts, 'buildings': len(v4), 'skippedTiles': len(SKIPPED)},
              'registryVsV4AtPoint': dict(v4_agree),
              'publishedBuildingsBySourceAndLod': {f'{k[0]}:lod{k[1]}': v for k, v in sorted(lod_pub.items())},
              'publishedParts': sum(1 for f in feats if f['properties']['geometry_role'] == 'land_host_building_part'),
              'shoppingCenterRelease': {k: sc_meta.get(k) for k in ('as_of', 'features', 'venues')},
              'hotelMasses': len(masses), 'perDataset': {k: dict(v) for k, v in per_ds.items()},
              'snapshotJoined': dict(collections.Counter(v[1] for v in snap_join.values())), 'chainJoined': dict(collections.Counter(v[1] for v in chain_join.values())),
              'snapshotPoints': len(snap), 'chainPointsInCoveredProvinces': len(outlets),
              'pointsInNestedBuildings': {'snapshot': len(snap_also), 'chain': len(chain_also)},
              'nameLinkReview': review,
              'nameLinksShopping': {'links': len(name_links), 'result': dict(shop_cmp)},
              'nameLinksHotel': {'links': len(hotel_name), 'result': dict(hotel_cmp)},
              'hotelMassBranchKeys': dict(mass_cmp),
              'industrialEstates': {'summary': ie_summary, 'candidates': ie_report},
              'buildingsPublished': len(used), 'featuresPublished': len(feats), 'hostsPublished': len(host_records)}
    with open(a.report, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1)[:6000])

if __name__ == '__main__':
    main()

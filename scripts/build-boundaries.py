#!/usr/bin/env python3
"""Build the demo's administrative frames from CityMETER production boundaries.

Inputs (not committed — public, read-only responses saved by the fetch step):
  --api   directory with base-lv0.json and base-{province uuid}.json
          (GET https://landometer.com/api/v2/citymeter-v3/base/info/lv0 and /lv1/{id})
  --geom  directory with SUBDISTRICT-{uuid}.json responses of
          GET https://landometer.com/api/v2/citymeter-v3/restaurant/info/geom/{uuid}/SUBDISTRICT
          plus their .meta.json receipts (url, status, bytes, sha256, retrieved_at)
  --mapshaper  command for mapshaper 0.6.x (default: "npx mapshaper")

Outputs (written under --out):
  data/areas.geojson      every SUBDISTRICT (แขวง/ตำบล) of the provinces that hold restaurant rows
  data/districts.geojson  DISTRICT (เขต/อำเภอ) frames dissolved from the same subdistricts
  data/provinces.geojson  PROVINCE frames dissolved from the same subdistricts

Rules: ids and names come from the production base info (code = DOPA code used by the
production route /v3/citymeter/{abbrEn}/S/{code}); area (areaSqm) is the production value,
never recomputed from the simplified outline. Simplification is display-only and
topology-preserving (shared borders stay shared); districts and provinces are dissolved
from the simplified subdistricts so every level nests exactly.
"""
import argparse, datetime, hashlib, json, os, shlex, subprocess, sys, tempfile

def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)

def value(doc):
    v = doc.get('value', doc)
    return json.loads(v) if isinstance(v, str) else v

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--api', required=True)
    ap.add_argument('--geom', required=True)
    ap.add_argument('--provinces', required=True, help='comma-separated DOPA province codes to include')
    ap.add_argument('--out', required=True)
    ap.add_argument('--mapshaper', default='npx mapshaper')
    ap.add_argument('--interval', default='16', help='simplification interval in metres (display only)')
    ap.add_argument('--province-interval', default='120', help='province frame simplification interval in metres (display only)')
    a = ap.parse_args()
    keep = set(a.provinces.split(','))
    lv0 = value(load(os.path.join(a.api, 'base-lv0.json')))
    provinces = [p for p in lv0['provinceInfos'] if p['code'] in keep]
    features, receipts = [], []
    districts_meta, provinces_meta = {}, {}
    for p in provinces:
        base = value(load(os.path.join(a.api, f"base-{p['id']}.json")))
        provinces_meta[p['abbrEn']] = {'id': p['abbrEn'], 'code': p['code'], 'uuid': p['id'], 'name': p['nameTh'], 'nameEn': p['nameEn'], 'areaSqm': p['areaSqm']}
        dist = {d['code']: d for d in base['districtInfos']}
        for d in base['districtInfos']:
            districts_meta[d['code']] = {'id': d['code'], 'uuid': d['id'], 'name': d['nameTh'], 'nameEn': d.get('nameEn'), 'province': p['abbrEn'], 'areaSqm': d['areaSqm']}
        for s in base['subdistrictInfos']:
            gpath = os.path.join(a.geom, f"SUBDISTRICT-{s['id']}.json")
            mpath = gpath[:-5] + '.meta.json'
            raw = open(gpath, 'rb').read()
            meta = load(mpath)
            if meta.get('status') != 200 or meta.get('sha256') != hashlib.sha256(raw).hexdigest():
                sys.exit(f'unverified geometry receipt: {gpath}')
            geom = value(json.loads(raw))
            if not geom or geom.get('type') not in ('Polygon', 'MultiPolygon'):
                sys.exit(f'missing geometry for subdistrict {s["code"]}')
            receipts.append({'id': s['id'], 'url': meta['url'], 'sha256': meta['sha256'], 'bytes': meta['bytes'], 'retrievedAt': meta['retrieved_at']})
            d = dist.get(s['code'][:4], {})
            features.append({'type': 'Feature', 'geometry': geom, 'properties': {
                'id': s['code'], 'uuid': s['id'], 'name': s['nameTh'], 'nameEn': s.get('nameEn') or '',
                'district': s['code'][:4], 'districtName': d.get('nameTh', ''), 'province': p['abbrEn'],
                'provinceDopa': p['code'], 'areaSqm': s['areaSqm']}})
    tmp = tempfile.mkdtemp(prefix='boundaries-')
    raw_path = os.path.join(tmp, 'subdistricts.raw.json')
    json.dump({'type': 'FeatureCollection', 'features': features}, open(raw_path, 'w', encoding='utf-8'), ensure_ascii=False)
    ms = shlex.split(a.mapshaper)
    def run(*args):
        cmd = ms + list(args)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode:
            sys.exit('mapshaper failed: ' + ' '.join(cmd) + '\n' + r.stderr)
        return r.stderr
    simp = os.path.join(tmp, 'subdistricts.json')
    run('-i', raw_path, '-simplify', f'interval={a.interval}', 'keep-shapes', '-clean', '-o', simp, 'precision=0.00001', 'format=geojson')
    dis = os.path.join(tmp, 'districts.json')
    run('-i', simp, '-dissolve', 'district', 'copy-fields=province', '-o', dis, 'precision=0.00001', 'format=geojson')
    pro = os.path.join(tmp, 'provinces.json')
    # Province frames are read below zoom 12 only: a coarser display interval keeps the country view light.
    run('-i', simp, '-dissolve', 'province', '-simplify', f'interval={a.province_interval}', 'keep-shapes', '-clean', '-o', pro, 'precision=0.0001', 'format=geojson')
    def labels(path, field):
        pts = os.path.join(tmp, os.path.basename(path) + '.points.json')
        run('-i', path, '-points', 'inner', '-o', pts, 'precision=0.00001', 'format=geojson')
        return {f['properties'][field]: f['geometry']['coordinates'] for f in load(pts)['features']}
    sub = load(simp); dfc = load(dis); pfc = load(pro)
    sl, dl, pl = labels(simp, 'id'), labels(dis, 'district'), labels(pro, 'province')
    now = datetime.date.today().isoformat()
    prov = {
        'source': 'CityMETER production boundaries (public read-only API)',
        'geometryEndpoint': 'https://landometer.com/api/v2/citymeter-v3/restaurant/info/geom/{uuid}/SUBDISTRICT',
        'attributeEndpoint': 'https://landometer.com/api/v2/citymeter-v3/base/info/lv1/{province uuid}',
        'retrievedOn': min(r['retrievedAt'] for r in receipts)[:10],
        'builtOn': now,
        'simplification': f'mapshaper -simplify interval={a.interval} keep-shapes -clean (display only, topology preserved); districts dissolved from the simplified subdistricts; provinces dissolved then simplified at interval={a.province_interval} for the country view',
        'areaSqm': 'production value from base info; never recomputed from the simplified outline',
        'receipts': len(receipts),
        'receiptsSha256': hashlib.sha256(json.dumps(sorted((r['id'], r['sha256']) for r in receipts)).encode()).hexdigest(),
        'limits': 'Administrative frames for navigation and aggregation of this dataset; not an official boundary certificate.',
    }
    for f in sub['features']:
        f['id'] = f['properties']['id']
        f['properties']['label'] = sl.get(f['properties']['id'])
    for f in dfc['features']:
        m = districts_meta[f['properties']['district']]
        f['id'] = m['id']
        f['properties'] = {**m, 'label': dl.get(m['id'])}
    for f in pfc['features']:
        m = provinces_meta[f['properties']['province']]
        f['id'] = m['id']
        f['properties'] = {**m, 'label': pl.get(m['id'])}
    os.makedirs(os.path.join(a.out, 'data'), exist_ok=True)
    def write(name, fc, level):
        fc = {'type': 'FeatureCollection', 'metadata': {**prov, 'level': level, 'features': len(fc['features'])}, 'features': sorted(fc['features'], key=lambda f: f['id'])}
        with open(os.path.join(a.out, 'data', name), 'w', encoding='utf-8') as fh:
            json.dump(fc, fh, ensure_ascii=False, separators=(',', ':'))
        print(name, len(fc['features']), os.path.getsize(os.path.join(a.out, 'data', name)))
    write('areas.geojson', sub, 'SUBDISTRICT')
    write('districts.geojson', dfc, 'DISTRICT')
    write('provinces.geojson', pfc, 'PROVINCE')
    with open(os.path.join(a.out, 'data', 'boundary-receipts.json'), 'w', encoding='utf-8') as fh:
        json.dump({'metadata': prov, 'receipts': sorted(receipts, key=lambda r: r['id'])}, fh, ensure_ascii=False, indent=0)

if __name__ == '__main__':
    main()

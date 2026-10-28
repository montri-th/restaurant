#!/usr/bin/env python3
"""Country frames for every province (owner 2026-10-28 22:36: the country view shows all provinces, restaurants and
chain outlets counted together).

Inputs (not committed — public, read-only responses saved by the fetch step, scripts/../tools fetch_provinces.py):
  --lv0    base-lv0.json (GET https://landometer.com/api/v2/citymeter-v3/base/info/lv0): provinceInfos with id, code
           (DOPA), abbrEn, nameTh, nameEn, areaSqm
  --geom   directory with PROVINCE-{uuid}.json responses of
           GET https://landometer.com/api/v2/citymeter-v3/restaurant/info/geom/{uuid}/PROVINCE plus .meta.json receipts
  --current data/provinces.geojson of the covered provinces (frames dissolved from their subdistricts, kept as they
           are so the subdistrict mosaic still nests exactly)
  --receipts data/boundary-receipts.json (PROVINCE receipts are appended)

Output: data/provinces.geojson with 77 features — the covered provinces' existing frames plus the production
PROVINCE outlines of the others, simplified for the country view (display only). areaSqm is the production value.
"""
import argparse, datetime, hashlib, json, os, shlex, subprocess, sys, tempfile

def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)

def value(doc):
    v = doc.get('value', doc) if isinstance(doc, dict) else doc
    return json.loads(v) if isinstance(v, str) else v

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lv0', required=True)
    ap.add_argument('--geom', required=True)
    ap.add_argument('--current', required=True)
    ap.add_argument('--receipts', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--mapshaper', default='npx mapshaper')
    ap.add_argument('--province-interval', default='120')
    a = ap.parse_args()
    lv0 = value(load(a.lv0))
    current = load(a.current)
    have = {f['properties']['id'] for f in current['features']}
    receipts_doc = load(a.receipts)
    features, receipts = [], []
    for p in lv0['provinceInfos']:
        if p['abbrEn'] in have:
            continue
        gpath = os.path.join(a.geom, f"PROVINCE-{p['id']}.json")
        meta = load(gpath[:-5] + '.meta.json')
        raw = open(gpath, 'rb').read()
        if meta.get('status') != 200 or meta.get('sha256') != hashlib.sha256(raw).hexdigest():
            sys.exit(f'unverified geometry receipt: {gpath}')
        geom = value(json.loads(raw))
        if not geom or geom.get('type') not in ('Polygon', 'MultiPolygon'):
            sys.exit(f'missing geometry for province {p["abbrEn"]}')
        receipts.append({'id': p['id'], 'level': 'PROVINCE', 'url': meta['url'], 'sha256': meta['sha256'], 'bytes': meta['bytes'], 'retrievedAt': meta['retrieved_at']})
        features.append({'type': 'Feature', 'geometry': geom, 'properties': {'id': p['abbrEn'], 'code': p['code'], 'uuid': p['id'], 'name': p['nameTh'], 'nameEn': p['nameEn'], 'areaSqm': p['areaSqm']}})
    tmp = tempfile.mkdtemp(prefix='provinces-')
    raw_path = os.path.join(tmp, 'provinces.raw.json')
    json.dump({'type': 'FeatureCollection', 'features': features}, open(raw_path, 'w', encoding='utf-8'), ensure_ascii=False)
    ms = shlex.split(a.mapshaper)
    def run(*args):
        r = subprocess.run(ms + list(args), capture_output=True, text=True)
        if r.returncode:
            sys.exit('mapshaper failed: ' + ' '.join(args) + '\n' + r.stderr)
    simp = os.path.join(tmp, 'provinces.json')
    run('-i', raw_path, '-simplify', f'interval={a.province_interval}', 'keep-shapes', '-clean', '-o', simp, 'precision=0.0001', 'format=geojson')
    pts = os.path.join(tmp, 'points.json')
    run('-i', simp, '-points', 'inner', '-o', pts, 'precision=0.00001', 'format=geojson')
    labels = {f['properties']['id']: f['geometry']['coordinates'] for f in load(pts)['features']}
    added = load(simp)['features']
    for f in added:
        f['id'] = f['properties']['id']
        f['properties']['label'] = labels.get(f['properties']['id'])
        f['properties']['frame'] = 'production_province_outline'
    for f in current['features']:
        f['properties'].setdefault('frame', 'dissolved_subdistricts')
    allf = sorted(current['features'] + added, key=lambda f: f['id'])
    meta = dict(current.get('metadata', {}))
    meta.update({
        'level': 'PROVINCE', 'features': len(allf), 'builtOn': datetime.date.today().isoformat(),
        'provinceFrames': f'{len(current["features"])} covered provinces dissolved from their subdistricts (unchanged); {len(added)} others from the production PROVINCE outline (GET …/restaurant/info/geom/{{uuid}}/PROVINCE), simplified at interval={a.province_interval} m for the country view (display only)',
        'provinceReceipts': len(receipts),
    })
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as fh:
        json.dump({'type': 'FeatureCollection', 'metadata': meta, 'features': allf}, fh, ensure_ascii=False, separators=(',', ':'))
    print('provinces.geojson', len(allf), os.path.getsize(a.out))
    receipts_doc.setdefault('provinceReceipts', [])
    receipts_doc['provinceReceipts'] = sorted(receipts, key=lambda r: r['id'])
    receipts_doc['metadata']['provinceEndpoint'] = 'https://landometer.com/api/v2/citymeter-v3/restaurant/info/geom/{uuid}/PROVINCE'
    receipts_doc['metadata']['provincesRetrievedOn'] = min(r['retrievedAt'] for r in receipts)[:10] if receipts else None
    with open(a.receipts, 'w', encoding='utf-8') as fh:
        json.dump(receipts_doc, fh, ensure_ascii=False, indent=0)
    print('receipts', len(receipts))

if __name__ == '__main__':
    main()

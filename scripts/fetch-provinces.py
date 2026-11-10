#!/usr/bin/env python3
"""Fetch the 77 production province outlines scripts/build-chains.py reads, and stop when one has changed (2026-11-09).

Public, read-only responses of the CityMETER production API (scripts/province-geometry.json names each id and the
SHA-256 the last build read). A changed outline would move outlets between provinces without anyone deciding it, so a
mismatch stops the register sync; a person looks, then refreshes scripts/province-geometry.json on purpose.

    python3 -I scripts/fetch-provinces.py --out <dir>      # writes <dir>/manifest.json + <dir>/<id>.json
"""
import argparse, hashlib, json, os, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEOM = 'https://landometer.com/api/v2/citymeter-v3/restaurant/info/geom/{id}/PROVINCE'


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'citymeter-restaurants-register-sync'}), timeout=120) as r:
                return r.read()
        except Exception as e:  # network hiccup: retry, then give up loudly
            if i == tries - 1:
                raise SystemExit(f'{url}: {e}')
            time.sleep(5 * (i + 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    ref = json.load(open(os.path.join(ROOT, 'scripts', 'province-geometry.json'), encoding='utf-8'))
    os.makedirs(a.out, exist_ok=True)
    doc = json.loads(get(ref['lv0']))
    v = doc.get('value', doc)
    infos = (json.loads(v) if isinstance(v, str) else v)['provinceInfos']
    known = {p['id']: p for p in ref['provinces']}
    if {p['id'] for p in infos} != set(known):
        sys.exit('the production province list changed: ' + ', '.join(sorted({p['id'] for p in infos} ^ set(known))))
    manifest, changed = [], []
    for p in infos:
        body = get(GEOM.format(id=p['id']))
        if hashlib.sha256(body).hexdigest() != known[p['id']]['sha256']:
            changed.append(f"{p.get('abbrEn')} {p.get('nameEn')}")
        with open(os.path.join(a.out, p['id'] + '.json'), 'wb') as fh:
            fh.write(body)
        manifest.append({'id': p['id'], 'code': p['code'], 'abbr': p['abbrEn'], 'nameTh': p['nameTh'], 'nameEn': p['nameEn'], 'areaSqm': p['areaSqm']})
    if changed:
        sys.exit('production province outlines changed since the last build: ' + '; '.join(changed))
    with open(os.path.join(a.out, 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False)
    print(f'provinces: {len(manifest)} outlines, all equal to scripts/province-geometry.json')


if __name__ == '__main__':
    main()

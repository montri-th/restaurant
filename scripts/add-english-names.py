#!/usr/bin/env python3
"""Add the English names production does not give to data/districts.geojson and data/areas.geojson (run after
scripts/build-boundaries.py).

CityMETER production base info names provinces in English and most subdistricts, but no district (all 90 empty) and
187 of the 581 subdistricts this dataset reads. The English page reads places by name, so this step fills the gaps from
OpenGISData-Thailand at commit fafcea1 (CC BY 4.0, DOPA-credited), the files, commit and joins the other CityMETER demos
use (CityMETER · Pharmacy scripts/add-english-names.py):
  districts     districts.geojson amp_code → amp_en, joined by production code
  subdistricts  subdistricts.geojson tam_code → tam_en, only where production gives no English and the code and the
                Thai name both match; production's English always stays
Names only: codes, Thai names, areaSqm and every outline stay production's. A place no file names keeps an empty
nameEn (the page then keeps the Thai name). Each file's metadata records the source (metadata.englishNames).

Usage: python3 scripts/add-english-names.py --ogd <directory with districts.geojson and subdistricts.geojson at fafcea1>
Idempotent: a second run changes nothing.
"""
import argparse, hashlib, json, os, re, sys, unicodedata

OGD_COMMIT = 'fafcea179cda88b689f5697c3866a449e79cd298'
OGD_SHA256 = {
    'districts.geojson': '329315c2d1ee067b42abc2fe2ac24e825fac4cdb02257a530afb62c6903de995',
    'subdistricts.geojson': '34ee32a6b6dde019e4fef8706f186206ddb7959ff869e6712b355ba83433c326',
}
PREFIX_TH = re.compile(r'^(?:กิ่งอำเภอ|อำเภอ|ตำบล|แขวง|เขต|จังหวัด|อ\.|ต\.|จ\.)\s*')


def th_norm(s):
    """The Thai-name comparison of CityMETER · Fitness (scripts/admin_text.py#th_norm): NFC, no prefix, no spaces."""
    s = unicodedata.normalize('NFC', str(s or ''))
    s = s.replace('​', '').replace('\xa0', ' ').replace('ํา', 'ำ').strip()
    return re.sub(r'\s+', '', PREFIX_TH.sub('', s))


def features(directory, name):
    path = os.path.join(directory, name)
    raw = open(path, 'rb').read()
    if hashlib.sha256(raw).hexdigest() != OGD_SHA256[name]:
        sys.exit(f'{path} is not OpenGISData-Thailand {name} @ {OGD_COMMIT[:7]} (sha256 differs)')
    return [f['properties'] for f in json.loads(raw)['features']]


def load(path):
    return json.load(open(path, encoding='utf-8'))


def dump(path, doc):
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(',', ':'))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ogd', required=True)
    a = ap.parse_args()
    amp = {p['amp_code']: (p.get('amp_en') or '').strip() for p in features(a.ogd, 'districts.geojson')}
    tam = {p['tam_code']: p for p in features(a.ogd, 'subdistricts.geojson')}
    source = f'OpenGISData-Thailand @ {OGD_COMMIT[:7]} (CC BY 4.0, DOPA-credited), scripts/add-english-names.py'

    districts = load('data/districts.geojson')
    for f in districts['features']:
        f['properties']['nameEn'] = amp.get(f['properties']['id']) or None
    districts.setdefault('metadata', {})['englishNames'] = f'{source}: districts.geojson sha256 {OGD_SHA256["districts.geojson"]}, joined by production code'
    dump('data/districts.geojson', districts)

    areas = load('data/areas.geojson')
    meta = areas.setdefault('metadata', {})
    before = set(meta.get('englishFromOgd') or [])
    from_ogd, mismatch = [], 0
    for f in areas['features']:
        p = f['properties']
        if p.get('nameEn') and p['id'] not in before:
            continue
        o = tam.get(p['id'])
        if o and o.get('tam_en') and th_norm(o.get('tam_th')) == th_norm(p['name']):
            p['nameEn'] = o['tam_en'].strip(); from_ogd.append(p['id'])
        else:
            p['nameEn'] = ''
            if o and th_norm(o.get('tam_th')) != th_norm(p['name']):
                mismatch += 1
    meta['englishNames'] = (f'{source}: subdistricts.geojson sha256 {OGD_SHA256["subdistricts.geojson"]} only where production gives '
                            'no English and the code and the Thai name match (metadata.englishFromOgd); the others: production base info')
    meta['englishFromOgd'] = sorted(from_ogd)
    dump('data/areas.geojson', areas)

    nd = sum(1 for f in districts['features'] if f['properties']['nameEn'])
    ns = sum(1 for f in areas['features'] if f['properties'].get('nameEn'))
    print(f'districts {nd}/{len(districts["features"])} with English; subdistricts {ns}/{len(areas["features"])} '
          f'({ns - len(from_ogd)} from production, {len(from_ogd)} from OpenGISData, {mismatch} where the Thai name differs)')


if __name__ == '__main__':
    main()

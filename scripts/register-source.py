#!/usr/bin/env python3
"""The source set of a register build and its two dates: data/release.json (2026-11-09).

A build of the chain register reads nine tabs of the research workbook. This step fingerprints exactly those tabs, so a
later read can tell whether anything the page uses changed, and records what the tests hold the build to:

  * sourceSha256 — SHA-256 over the nine tabs, each cell in one canonical form (empty → '', TRUE/FALSE, a whole number
    without “.0”, a date without “T00:00:00”), so the xlsx export and the Sheets API read of the same content agree;
  * outlets / brandsWithOutlets / withCoordinates — counted from 02_STORES rows (the register's unit: one outlet_id per
    row; a coordinate counts when it lies in Thailand's box, the rule of scripts/build-chains.py); outletIdsSha256 and
    brandIdsSha256 fingerprint the sorted id lists;
  * readAt — when the sheet was read (the export finished), sheetModifiedAt — the sheet's own last edit (Drive);
  * publishedAt — when this read went on the page: null until a release is merged (scripts/release-stamp.py).

No sheet id, link or cell value is written. --previous keeps the release being replaced as one line of history.

    python3 -I scripts/register-source.py --chain-dump <sheet2-dump> --read-at 2026-11-09T20:26:57+07:00 \
        --sheet-modified 2026-11-08T08:18:40+07:00 [--workbook <xlsx>] [--reader xlsx-export] \
        [--previous data/release.json] --out data/release.json
"""
import argparse, datetime, hashlib, json, os, re, sys

TABS = ['00_README', '01_BRANDS', '02_STORES', '03_COMPANIES', '06_DATA_DICTIONARY', '08_COVERAGE', '10_CLASSIFICATION',
        '16_MASTER_OBSERVATIONS', '20_CHAIN_LOGOS']
ISO = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2})$')


def canon(v):
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'TRUE' if v else 'FALSE'
    if isinstance(v, (int, float)):
        return str(int(v)) if float(v).is_integer() else repr(float(v))
    s = str(v)
    m = re.match(r'^(\d{4}-\d{2}-\d{2})T00:00:00$', s)
    return m.group(1) if m else s


def tab_digest(rows):
    header = list(rows[0].keys()) if rows else []
    h = hashlib.sha256(json.dumps(header, ensure_ascii=False).encode('utf-8'))
    for r in rows:
        h.update(b'\n' + json.dumps([canon(r.get(k)) for k in header], ensure_ascii=False).encode('utf-8'))
    return h.hexdigest()


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def source_of(dump):
    tabs, lines = {}, []
    for t in TABS:
        path = os.path.join(dump, t + '.json')
        if not os.path.exists(path):
            sys.exit(f'{t} missing from {dump}')
        rows = json.load(open(path, encoding='utf-8'))
        tabs[t] = {'rows': len(rows), 'sha256': tab_digest(rows)}
        lines.append(f"{t}\t{tabs[t]['sha256']}")
    stores = json.load(open(os.path.join(dump, '02_STORES.json'), encoding='utf-8'))
    ids = [canon(s.get('outlet_id')).strip() for s in stores]
    brands = sorted({canon(s.get('brand_id')).strip() for s in stores} - {''})
    if '' in ids or len(set(ids)) != len(ids):
        sys.exit('02_STORES: an outlet_id is missing or repeated')
    located = 0
    for s in stores:
        lat, lon = num(s.get('latitude')), num(s.get('longitude'))
        located += lat is not None and lon is not None and 5 <= lat <= 21 and 97 <= lon <= 106
    digest = lambda xs: hashlib.sha256('\n'.join(xs).encode('utf-8')).hexdigest()
    return {'sourceSha256': hashlib.sha256('\n'.join(lines).encode('utf-8')).hexdigest(), 'tabs': tabs,
            'outlets': len(ids), 'brandsWithOutlets': len(brands), 'withCoordinates': located,
            'outletIdsSha256': digest(sorted(ids)), 'brandIdsSha256': digest(brands)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chain-dump', required=True)
    ap.add_argument('--read-at', required=True, help='ISO time with offset, e.g. 2026-11-09T20:26:57+07:00')
    ap.add_argument('--sheet-modified', default='')
    ap.add_argument('--workbook', default='', help='the xlsx the dump came from (its bytes differ per export; recorded, never compared)')
    ap.add_argument('--reader', default='xlsx-export', choices=['xlsx-export', 'sheets-api'])
    ap.add_argument('--previous', default='')
    ap.add_argument('--previous-dump', default='', help='the dump of the release being replaced, when it has no release file yet')
    ap.add_argument('--previous-read-at', default='')
    ap.add_argument('--previous-published-at', default='')
    ap.add_argument('--check', action='store_true', help='print the source set and exit 0 when it equals --previous, 3 when it differs')
    ap.add_argument('--out', default='')
    a = ap.parse_args()
    for v in (a.read_at, a.sheet_modified, a.previous_read_at, a.previous_published_at):
        if v and not ISO.match(v):
            sys.exit(f'not an ISO time with offset: {v}')
    src = source_of(a.chain_dump)
    prev = json.load(open(a.previous, encoding='utf-8')) if a.previous and os.path.exists(a.previous) else None
    if a.check:
        same = bool(prev) and prev.get('register', {}).get('sourceSha256') == src['sourceSha256']
        print(json.dumps({'sourceSha256': src['sourceSha256'], 'outlets': src['outlets'], 'brandsWithOutlets': src['brandsWithOutlets'], 'same': same}))
        sys.exit(0 if same else 3)
    register = {'readAt': a.read_at, 'sheetModifiedAt': a.sheet_modified or None, 'reader': a.reader, **src}
    if a.workbook:
        b = open(a.workbook, 'rb').read()
        register['workbook'] = {'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()}
    previous = None
    if prev and prev.get('register') and prev.get('publishedAt') is None and prev.get('previous'):
        # The read being replaced never reached the page (a register pull request still open): the page still shows the
        # release before it, so that one stays the release this one replaces.
        previous = prev['previous']
    elif prev and prev.get('register'):
        p = prev['register']
        previous = {'readAt': p.get('readAt'), 'publishedAt': prev.get('publishedAt'), 'sourceSha256': p.get('sourceSha256'),
                    'outlets': p.get('outlets'), 'brandsWithOutlets': p.get('brandsWithOutlets')}
    elif a.previous_dump:
        p = source_of(a.previous_dump)
        previous = {'readAt': a.previous_read_at or None, 'publishedAt': a.previous_published_at or None, 'sourceSha256': p['sourceSha256'],
                    'outlets': p['outlets'], 'brandsWithOutlets': p['brandsWithOutlets']}
    release = {'schema': 'citymeter-restaurant-release-1',
               'rule': 'register.sourceSha256 fingerprints the nine tabs the builds read (canonical cells); the tests hold data/chains.json to register.outlets, brandsWithOutlets, withCoordinates and the two id fingerprints; readAt = the sheet read, publishedAt = when that read went on the page (null before the merge)',
               'register': register, 'publishedAt': None, 'previous': previous}
    out = json.dumps(release, ensure_ascii=False, indent=1) + '\n'
    if a.out:
        with open(a.out, 'w', encoding='utf-8') as fh:
            fh.write(out)
    print(json.dumps({k: register[k] for k in ('sourceSha256', 'outlets', 'brandsWithOutlets', 'withCoordinates')}))


if __name__ == '__main__':
    main()

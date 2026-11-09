#!/usr/bin/env python3
"""Register sync: read the sheet, and when what the page uses changed, rebuild what the register feeds (2026-11-09).

The nightly job and its button (.github/workflows/register-sync.yml) run this; a person can run it the same way with a
downloaded xlsx. Every step is an existing build step on the same inputs as a manual round:

  1. read      scripts/fetch-register.py (service account, read-only) — or --xlsx with --read-at for a manual read
  2. dump      scripts/xlsx-dump.py
  3. compare   scripts/register-source.py --check against data/release.json: the same nine tabs → stop, nothing changed
  4. guard     16_MASTER_OBSERVATIONS (the snapshot rows moved to the register) changed → stop: that part needs a full
               build with internal inputs (scripts/build-data.py), never a partial one
  5. build     scripts/fetch-provinces.py (stops if a production outline changed) → scripts/build-chains.py →
               scripts/brand-crosswalk.py --apply → scripts/build-segments.py → scripts/register-source.py
  6. logos     register brands whose logo_sha256 is a file already shipped are linked in data/brand-logos.json; a new
               file needs the register's logo folder (a manual round, --logo-files) and is listed, not guessed

Not rerun here: the Land join (scripts/build-land.py reads the internal Land registers and the OSM building tiles of a
manual round). data/land.json keeps its own date; outlets added since have no building until the next manual round.

Exit 0 with changed=true|false (and skipped=true when not configured) in --github-output; anything else = a failed
round, the working tree is not to be published (the last published data stays on the page).

    python3 scripts/sync-register.py --work <dir> [--xlsx <file> --read-at <ISO> --sheet-modified <ISO>] [--github-output <file>]
"""
import argparse, json, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = [sys.executable, '-I']


def run(cmd, **kw):
    print('$', ' '.join(os.path.relpath(c, ROOT) if os.path.isabs(c) and c.startswith(ROOT) else c for c in cmd), flush=True)
    return subprocess.run(cmd, cwd=ROOT, **kw)


def must(cmd):
    r = run(cmd)
    if r.returncode != 0:
        sys.exit(f'step failed ({r.returncode}): {cmd[2] if len(cmd) > 2 else cmd}')


def output(path, **kv):
    if path:
        with open(path, 'a', encoding='utf-8') as fh:
            for k, v in kv.items():
                fh.write(f'{k}={v}\n')
    print(json.dumps(kv))


def link_logos(built, shipped_path, register_ids):
    """New register links to files already shipped go into the shipped registry; its other entries stay as they are."""
    built, shipped = json.load(open(built, encoding='utf-8')), json.load(open(shipped_path, encoding='utf-8'))
    have = {x['id'] for x in shipped['brands']}
    keys = {x['key'] for x in shipped['assets']}
    new = [x for x in built['brands'] if x['id'] not in have and x['key'] in keys]
    if new:
        shipped['brands'] = sorted(shipped['brands'] + new, key=lambda x: x['id'])
        shipped['meta'].setdefault('registerLinks', {})['added'] = sum(1 for x in shipped['brands'] if x['id'] in register_ids)
        with open(shipped_path, 'w', encoding='utf-8') as fh:
            json.dump(shipped, fh, ensure_ascii=False, separators=(',', ':'))
    return len(new)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', required=True)
    ap.add_argument('--xlsx', default='')
    ap.add_argument('--read-at', default='')
    ap.add_argument('--sheet-modified', default='')
    ap.add_argument('--github-output', default='')
    a = ap.parse_args()
    work = os.path.abspath(a.work)
    os.makedirs(work, exist_ok=True)
    src, dump, prov, build = (os.path.join(work, d) for d in ('src', 'dump', 'provinces', 'build'))
    for d in (dump, build):
        shutil.rmtree(d, ignore_errors=True)

    # 1–2. read and dump
    if a.xlsx:
        if not a.read_at:
            sys.exit('--xlsx needs --read-at (when the sheet was read)')
        xlsx, read = os.path.abspath(a.xlsx), {'readAt': a.read_at, 'sheetModifiedAt': a.sheet_modified, 'reader': 'xlsx-export'}
    else:
        r = run(PY[:1] + [os.path.join(ROOT, 'scripts/fetch-register.py'), '--out', src])
        if r.returncode == 78:
            output(a.github_output, changed='false', skipped='true')
            return
        if r.returncode != 0:
            sys.exit('reading the sheet failed')
        xlsx, read = os.path.join(src, 'register.xlsx'), json.load(open(os.path.join(src, 'read.json'), encoding='utf-8'))
    must(PY + [os.path.join(ROOT, 'scripts/xlsx-dump.py'), xlsx, dump])

    # 3. anything the page uses changed?
    release_path = os.path.join(ROOT, 'data/release.json')
    r = run(PY + [os.path.join(ROOT, 'scripts/register-source.py'), '--chain-dump', dump, '--read-at', read['readAt'], '--previous', release_path, '--check'])
    if r.returncode == 0:
        output(a.github_output, changed='false', read_at=read['readAt'])
        return
    if r.returncode != 3:
        sys.exit('comparing the source set failed')

    # 4. a part this job cannot rebuild
    previous = json.load(open(release_path, encoding='utf-8'))
    import importlib.util
    spec = importlib.util.spec_from_file_location('register_source', os.path.join(ROOT, 'scripts/register-source.py'))
    rs = importlib.util.module_from_spec(spec); spec.loader.exec_module(rs)
    now = rs.source_of(dump)
    tabs_before = previous.get('register', {}).get('tabs', {})
    if tabs_before.get('16_MASTER_OBSERVATIONS', {}).get('sha256') not in (None, now['tabs']['16_MASTER_OBSERVATIONS']['sha256']):
        sys.exit('16_MASTER_OBSERVATIONS changed: the rows moved from the snapshot need a full build with internal inputs (scripts/build-data.py, DATA_METHOD §11) — not published')

    # 5. build what the register feeds
    must(PY + [os.path.join(ROOT, 'scripts/fetch-provinces.py'), '--out', prov])
    must(PY + [os.path.join(ROOT, 'scripts/build-chains.py'), '--chain-dump', dump, '--provinces', prov, '--areas', os.path.join(ROOT, 'data/areas.geojson'),
               '--brand-logos', os.path.join(ROOT, 'data/brand-logos.json'), '--out', build])
    shutil.copyfile(os.path.join(build, 'data/chains.json'), os.path.join(ROOT, 'data/chains.json'))
    chains = json.load(open(os.path.join(ROOT, 'data/chains.json'), encoding='utf-8'))
    linked = link_logos(os.path.join(build, 'data/brand-logos.json'), os.path.join(ROOT, 'data/brand-logos.json'), {b['id'] for b in chains['brands']})
    day = read['readAt'][:10]
    must(PY + [os.path.join(ROOT, 'scripts/brand-crosswalk.py'), '--chain-dump', dump, '--restaurants', os.path.join(ROOT, 'data/restaurants.json'),
               '--chains', os.path.join(ROOT, 'data/chains.json'), '--record', os.path.join(ROOT, 'docs/brand-crosswalk.json'), '--checked-on', day, '--apply'])
    import hashlib
    workbook = hashlib.sha256(open(xlsx, 'rb').read()).hexdigest()
    must(PY + [os.path.join(ROOT, 'scripts/build-segments.py'), '--chain-dump', dump, '--restaurants', os.path.join(ROOT, 'data/restaurants.json'),
               '--chains', os.path.join(ROOT, 'data/chains.json'), '--workbook-sha256', workbook, '--read-on', day, '--out', os.path.join(ROOT, 'data/segments.json')])
    cmd = [os.path.join(ROOT, 'scripts/register-source.py'), '--chain-dump', dump, '--read-at', read['readAt'], '--workbook', xlsx, '--reader', read.get('reader', 'xlsx-export'),
           '--previous', release_path, '--out', release_path]
    if read.get('sheetModifiedAt'):
        cmd += ['--sheet-modified', read['sheetModifiedAt']]
    must(PY + cmd)

    # 6. what this job left for a manual round
    brands = json.load(open(os.path.join(dump, '01_BRANDS.json'), encoding='utf-8'))
    shipped = {x['sha256'] for x in json.load(open(os.path.join(ROOT, 'data/brand-logos.json'), encoding='utf-8'))['assets']}
    with_outlets = {b['id'] for b in chains['brands']}
    logos_pending = sorted(str(b.get('brand_id')) for b in brands if str(b.get('brand_id')) in with_outlets and str(b.get('logo_sha256') or '').strip() and str(b.get('logo_sha256')).strip() not in shipped)
    land = json.load(open(os.path.join(ROOT, 'data/land.json'), encoding='utf-8'))
    pending = {'logosPending': logos_pending, 'logoLinksAdded': linked, 'landCheckedOn': land['meta'].get('checkedOn'), 'landRerun': False}
    with open(os.path.join(work, 'pending.json'), 'w', encoding='utf-8') as fh:
        json.dump(pending, fh, ensure_ascii=False)
    output(a.github_output, changed='true', read_at=read['readAt'], outlets=now['outlets'], brands=now['brandsWithOutlets'], logos_pending=len(logos_pending))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Pair the snapshot's chain-name candidates with register brands, only where a second fact ties them (2026-11-09).

The brand filter counts one key per chain (js/model.js#brandKey): a sheet-1 name candidate counts as the register brand
the sheet links it to (restaurants.json brands[].national, from Sheet 1 01_BRANDS.national_brand_ids). A candidate the
sheet links to nothing stays its own key, so a chain the register now lists (MIXUE: 512 outlets) shows twice. This step
looks at those candidates only:

  * a candidate whose own id is a register brand profile without outlets stays as it is (exactNoOutlets);
  * otherwise a register brand that has outlets is a pair only when the names agree (NFKC, case, spacing and punctuation
    aside) AND at least one more fact ties them:
      page   — the candidate's source page is the brand's own page or the source page of one of its outlets;
      domain — the candidate's source is on the brand's own web domain (never a link hub, a social site or a venue
               directory, see GENERIC);
      point  — a candidate row's display point lies within 50 m of an outlet point of that brand;
  * a name match without such a fact, two brands with a fact, or no register brand of that name goes to review —
    nothing is paired by name alone, and review rows change nothing on the page.

Output: docs/brand-crosswalk.json (pairs with their evidence, the review list, the exact codes without outlets). With
--apply, restaurants.json brands[] of each pair get national = [register id] and nationalBy = "crosswalk" (a sheet link
that already reaches a register brand is never replaced); everything else in the file keeps its bytes.

    python3 -I scripts/brand-crosswalk.py --chain-dump <sheet2-dump> --restaurants data/restaurants.json \
        --chains data/chains.json --record docs/brand-crosswalk.json --checked-on 2026-11-09 [--apply]
"""
import argparse, collections, json, math, os, re, sys, unicodedata

GENERIC = {'linktr.ee', 'page.line.me', 'line.me', 'lin.ee', 'facebook.com', 'm.facebook.com', 'web.facebook.com', 'instagram.com',
           'google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl', 'tiktok.com', 'wongnai.com', 'food.grab.com', 'grab.com',
           'lineman.line.me', 'x.com', 'twitter.com', 'youtube.com', 'jobthai.com'}
NEAR_M = 50
GRID = 4194304


def norm(s):
    s = unicodedata.normalize('NFKC', str(s or '')).lower()
    s = re.sub(r"[’'`´]", '', s)
    return re.sub(r'[^0-9a-z฀-๿]+', '', s)


def host(u):
    m = re.match(r'^https?://([^/:?#]+)', str(u or '').strip().lower())
    return re.sub(r'^www\.', '', m.group(1)) if m else ''


def page(u):
    u = str(u or '').strip().lower()
    return re.sub(r'^https?://(www\.)?', '', re.sub(r'[?#].*$', '', u)).rstrip('/') if u.startswith('http') else ''


def urls_of(v):
    if not v:
        return []
    try:
        x = json.loads(v) if isinstance(v, str) and v.strip()[:1] in '[{' else v
    except ValueError:
        x = v
    if isinstance(x, str):
        return re.findall(r'https?://\S+', x)
    return [u for u in x if isinstance(u, str)] if isinstance(x, list) else []


def lnglat(gx, gy):
    return gx / GRID * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy / GRID))))


def metres(a, b):
    x = math.radians(b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    return 6371000 * math.hypot(x, math.radians(b[1] - a[1]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chain-dump', required=True)
    ap.add_argument('--restaurants', required=True)
    ap.add_argument('--chains', required=True)
    ap.add_argument('--record', required=True)
    ap.add_argument('--checked-on', required=True)
    ap.add_argument('--apply', action='store_true')
    a = ap.parse_args()
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', a.checked_on):
        sys.exit('--checked-on must be YYYY-MM-DD')
    load = lambda tab: json.load(open(os.path.join(a.chain_dump, tab + '.json'), encoding='utf-8'))
    profiles, stores = load('01_BRANDS'), load('02_STORES')
    rest_bytes = open(a.restaurants, 'rb').read()
    rest = json.loads(rest_bytes)
    chains = json.load(open(a.chains, encoding='utf-8'))

    reg = {b['id']: b for b in chains['brands']}
    profile = {str(p.get('brand_id') or ''): p for p in profiles}
    outlet_pages = collections.defaultdict(set)
    for s in stores:
        outlet_pages[str(s.get('brand_id') or '')].add(page(s.get('source_url')))
    by_name = collections.defaultdict(set)
    for p in profiles:
        bid = str(p.get('brand_id') or '')
        names = [p.get('brand_name'), p.get('brand_family')]
        try:
            names += [x for x in json.loads(p.get('aliases') or '[]') if isinstance(x, str)]
        except (TypeError, ValueError):
            pass
        for n in names:
            if norm(n):
                by_name[norm(n)].add(bid)
    cols = chains['cols']
    points = collections.defaultdict(list)
    for i, b in enumerate(cols['brand']):
        if cols['lat'][i] is not None:
            points[chains['brands'][b]['id']].append((cols['lon'][i], cols['lat'][i], cols['id'][i], cols['name'][i]))
    rows_of = collections.defaultdict(list)
    for i, b in rest['brand']:
        rows_of[b].append(i)

    pairs, review, exact = [], [], []
    for bi, b in enumerate(rest['brands']):
        if b.get('nationalBy') == 'crosswalk':
            b = {**b, 'national': []}  # judged again on this source set
        key = (b.get('national') or [b['id']])[0]
        if key in reg:
            continue
        if key in profile:
            exact.append({'legacy': b['id'], 'name': b['name'], 'rows': b['rows'], 'code': key})
            continue
        src = b.get('source') or ''
        hits = []
        for cid in sorted(c for c in by_name.get(norm(b['name']), ()) if c in reg):
            p = profile.get(cid, {})
            ev = []
            own = {page(p.get('official_website')), page(p.get('source_url'))} | {page(u) for u in urls_of(p.get('official_locator_urls'))}
            if page(src) and (page(src) in own or page(src) in outlet_pages[cid]):
                ev.append({'kind': 'page', 'detail': src})
            hosts = {host(p.get('official_website')), host(p.get('source_url'))} | {host(u) for u in urls_of(p.get('official_locator_urls'))}
            if host(src) and host(src) not in GENERIC and host(src) in hosts - {''} and not any(e['kind'] == 'page' for e in ev):
                ev.append({'kind': 'domain', 'detail': host(src)})
            near = []
            for i in rows_of.get(bi, []):
                pt = lnglat(rest['cols']['gx'][i], rest['cols']['gy'][i])
                best = min(((metres(pt, (x, y)), oid, nm) for x, y, oid, nm in points.get(cid, [])), default=None)
                if best and best[0] <= NEAR_M:
                    near.append({'row': rest['cols']['name'][i], 'outlet': best[1], 'outletName': best[2], 'metres': round(best[0])})
            if near:
                ev.append({'kind': 'point', 'detail': near})
            hits.append({'register': cid, 'registerName': reg[cid]['name'], 'outlets': reg[cid]['outlets'], 'evidence': ev})
        tied = [h for h in hits if h['evidence']]
        base = {'legacy': b['id'], 'name': b['name'], 'rows': b['rows'], 'source': src}
        if len(tied) == 1:
            pairs.append({**base, **tied[0]})
            continue
        why = ('two register brands tie' if len(tied) > 1 else 'same name, nothing else ties them' if hits else 'no register brand of this name has outlets')
        profiles_only = sorted(c for c in by_name.get(norm(b['name']), ()) if c not in reg)
        review.append({**base, 'why': why, 'candidates': hits, 'profilesWithoutOutlets': profiles_only})

    record = {
        'schema': 'citymeter-restaurant-brand-crosswalk-1',
        'checkedOn': a.checked_on,
        'register': {'outlets': len(cols['id']), 'brandsWithOutlets': len(chains['brands'])},
        'rule': 'pair a snapshot name candidate the sheet links to no register brand with a register brand that has outlets only when the names agree (NFKC, case, spacing, punctuation aside) and one more fact ties them: the same source page, the brand\'s own web domain, or a candidate row within 50 m of an outlet point of that brand; anything else is review and changes nothing on the page',
        'pairs': pairs, 'review': review, 'exactNoOutlets': exact,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.record)), exist_ok=True)
    with open(a.record, 'w', encoding='utf-8') as fh:
        json.dump(record, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    print(f'crosswalk: {len(pairs)} pairs, {len(review)} for review, {len(exact)} exact codes without outlets')
    for p in pairs:
        print(f"  {p['legacy']} → {p['register']} ({', '.join(e['kind'] for e in p['evidence'])})")

    if a.apply:
        paired = {p['legacy']: p['register'] for p in pairs}
        changed = 0
        for b in rest['brands']:
            if b['id'] in paired:
                if b.get('national') != [paired[b['id']]] or b.get('nationalBy') != 'crosswalk':
                    changed += 1
                b['national'], b['nationalBy'] = [paired[b['id']]], 'crosswalk'
            elif b.get('nationalBy') == 'crosswalk':
                b['national'] = []
                del b['nationalBy']
                changed += 1
        if paired:
            rest['meta']['brandCrosswalk'] = {'record': 'docs/brand-crosswalk.json', 'checkedOn': a.checked_on, 'pairs': len(paired),
                                              'rule': 'national = [register brand] for a pair of docs/brand-crosswalk.json (nationalBy = crosswalk); the sheet\'s own links stay as they are'}
        else:
            rest['meta'].pop('brandCrosswalk', None)
        out = json.dumps(rest, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        if out != rest_bytes:
            with open(a.restaurants, 'wb') as fh:
                fh.write(out)
        print(f'restaurants.json: {changed} brand records changed')


if __name__ == '__main__':
    main()

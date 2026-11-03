#!/usr/bin/env python3
"""Segments of the population from the register's classification tab (0.8.0).

The chain register workbook carries `10_CLASSIFICATION` (one row per sheet-1 observation and per register outlet,
CPF excluded by the owner's earlier stop) with the six axes of the 2 Nov segmentation. Every row is still
`review_status = unreviewed` and `rules.QA` says no automatic result goes on the web before a human sample of 50 per
sub-segment with at least 48 correct. So this build ships only what does not wait on that check:

  * chain size (`chain_size_band` S1–S5 + `chain_link_status`) — counts of rows, not a judgement: register outlets by
    the number of register rows of the same brand_id; sheet-1 rows by the number of sheet-1 rows sharing a name
    candidate (kept as a candidate, never promoted to a confirmed brand); a single observed row stays "network unknown".
    Outlets outside the tab: the multi-banner point-of-sale registry (CPF, excluded by the owner's earlier stop) is a
    record, not one chain, so it gets no size ('x'); any other unclassified outlet would take the register rule ('r').
  * a cross-check of the price tiers the page computes from the source bounds (P1–P6, `rules.price`) against
    `price_band_observed` — the page needs no column for them.

  * the food taxonomy (0.9.2, owner decision 2026-11-03 16:59 “เปิดให้ทุกคนเห็นตอนนี้”, overriding `rules.QA`): category
    (6) · group (19) · primary sub-group (31) per row, every one an unreviewed inference of the workbook
    (`food_basis = inference`) — the page labels it อนุมาน. Each row's category and sub-group must agree with the
    codebook's parents; a row without a group stays unclassified ('.'), never a guess.

Secondary food ids, format, occasion, special labels and the inferred price stay in the workbook (`meta.held`).

    python3 -I scripts/build-segments.py --chain-dump <sheet2-dump> --restaurants data/restaurants.json \
        --chains data/chains.json --workbook-sha256 <sha of the xlsx> --read-on 2026-11-03 --out data/segments.json
"""
import argparse, collections, hashlib, json, re, sys

SIZE = ['S1', 'S2', 'S3', 'S4', 'S5']
# One character per row for a food group / sub-group: its index in the codebook order ('.' = not classified).
ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
BASIS = {'confirmed_brand_registry_count': 'c', 'candidate_name_count': 'n', 'single_observed_record_network_unknown': 's'}
HELD = ['food_subgroup_secondary_ids', 'food_group_secondary_ids', 'format_id', 'occasion_ids', 'special_label_ids', 'price_band_inferred']


def size_band(n):
    return 0 if n <= 1 else 1 if n <= 9 else 2 if n <= 49 else 3 if n <= 199 else 4


def price_tier(p0, p1):
    """rules.price: P6 = starts at 1,000 with no ceiling; otherwise the ceiling (or the start when there is none)
    against 100 / 200 / 300 / 500 / 1,000 — a closed 1,000 ceiling is P5. None = not stated (never 0)."""
    if p0 is None and p1 is None:
        return None
    if p1 is None and p0 is not None and p0 >= 1000:
        return 'P6'
    hi = p1 if p1 is not None else p0
    for code, top in (('P1', 100), ('P2', 200), ('P3', 300), ('P4', 500), ('P5', 1000)):
        if hi <= top:
            return code
    return 'P6'


def web_key(source_id):
    m = re.match(r'^R-([0-9a-f]{24})-(\d+)$', source_id or '')
    if not m:
        return None
    ordinal = int(m.group(2))
    return m.group(1)[:12] if ordinal == 1 else f'{m.group(1)[:12]}-{ordinal:02d}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chain-dump', required=True)
    ap.add_argument('--restaurants', required=True)
    ap.add_argument('--chains', required=True)
    ap.add_argument('--workbook-sha256', required=True)
    ap.add_argument('--read-on', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', a.read_on) or not re.match(r'^[0-9a-f]{64}$', a.workbook_sha256):
        sys.exit('--read-on must be YYYY-MM-DD and --workbook-sha256 64 hex digits')
    load = lambda tab: json.load(open(f'{a.chain_dump}/{tab}.json', encoding='utf-8'))
    cls, stores, dictionary = load('10_CLASSIFICATION'), load('02_STORES'), load('06_DATA_DICTIONARY')
    rest = json.load(open(a.restaurants, encoding='utf-8'))
    chains = json.load(open(a.chains, encoding='utf-8'))

    codebook = {}
    for r in dictionary:
        f = str(r.get('field') or '')
        if r.get('sheet') == '10_CLASSIFICATION' and f.split('.')[0] in ('chain_size_codes', 'price_codes', 'rules', 'scope', 'categories', 'groups', 'subgroups'):
            codebook[f] = r
    size_labels = {c: json.loads(codebook[f'chain_size_codes.{c}']['allowed_values'])['label'] for c in SIZE}
    price_labels = {c: json.loads(codebook[f'price_codes.{c}']['allowed_values'])['label'] for c in ('P1', 'P2', 'P3', 'P4', 'P5', 'P6')}
    rule = lambda k: str(codebook[k]['definition'])
    # Food taxonomy from the codebook, in id order; parents checked on every row below.
    entries = lambda prefix: sorted((json.loads(codebook[k]['allowed_values']) for k in codebook if k.startswith(prefix + '.')), key=lambda v: v['id'])
    cats, groups, subs = entries('categories'), entries('groups'), entries('subgroups')
    if len(groups) > len(ALPHABET) or len(subs) > len(ALPHABET):
        sys.exit('food codebook larger than the one-character alphabet')
    group_index, sub_index = {g['id']: i for i, g in enumerate(groups)}, {x['id']: i for i, x in enumerate(subs)}
    group_cat, sub_group = {g['id']: g['category_id'] for g in groups}, {x['id']: x['group_id'] for x in subs}

    def food_of(r):
        g, c, sg = r.get('food_group_id'), r.get('food_category_id'), r.get('food_subgroup_primary_id')
        if not g:
            if c or sg:
                sys.exit(f'{r["classification_id"]}: a category or sub-group without a group')
            return '.', '.'
        if g not in group_index or group_cat[g] != c:
            sys.exit(f'{r["classification_id"]}: group {g} / category {c} disagree with the codebook')
        if sg and (sg not in sub_index or sub_group[sg] != g):
            sys.exit(f'{r["classification_id"]}: sub-group {sg} is not under group {g}')
        if r.get('food_basis') not in ('inference', 'observed_fact'):
            sys.exit(f'{r["classification_id"]}: food_basis {r.get("food_basis")!r}')
        return ALPHABET[group_index[g]], ALPHABET[sub_index[sg]] if sg else '.'

    rule_versions = collections.Counter(r.get('rule_version') for r in cls)
    review = collections.Counter(r.get('review_status') for r in cls)
    if set(review) != {'unreviewed'}:
        print('note: review_status other than unreviewed present', dict(review))

    # ---------- sheet-1 rows (restaurants.json order) ----------
    keys = rest['cols']['key']
    key_index = {k: i for i, k in enumerate(keys)}
    row_size, row_basis = ['.'] * len(keys), ['.'] * len(keys)
    row_food, row_sub = ['.'] * len(keys), ['.'] * len(keys)
    food_basis = collections.Counter()
    price_check = collections.Counter()
    for r in cls:
        k = web_key(r.get('source_record_id'))
        if k is None:
            continue
        i = key_index.get(k)
        if i is None:
            sys.exit(f'classification row {r["source_record_id"]} has no row in restaurants.json')
        row_size[i] = str(SIZE.index(r['chain_size_band']))
        row_basis[i] = BASIS[r['chain_link_status']]
        row_food[i], row_sub[i] = food_of(r)
        if r.get('food_group_id'): food_basis[r.get('food_basis')] += 1
        mine = price_tier(rest['cols']['p0'][i], rest['cols']['p1'][i])
        price_check['agree' if mine == r.get('price_band_observed') else 'disagree'] += 1
    moved = {int(i) for i, _ in rest.get('register', [])}
    classified_rows = sum(1 for s in row_size if s != '.')
    unclassified_kept = [keys[i] for i in range(len(keys)) if row_size[i] == '.' and i not in moved]
    if unclassified_kept:
        sys.exit(f'{len(unclassified_kept)} kept sheet-1 rows have no classification, e.g. {unclassified_kept[:3]}')
    if price_check['disagree']:
        sys.exit(f'price tiers disagree with price_band_observed on {price_check["disagree"]} rows')

    # ---------- register outlets (chains.json order) ----------
    ids = chains['cols']['id']
    id_index = {k: i for i, k in enumerate(ids)}
    brand_of = {r['outlet_id']: r.get('brand_id') for r in stores}
    per_brand = collections.Counter(brand_of.values())
    out_size, out_basis = ['.'] * len(ids), ['.'] * len(ids)
    out_food, out_sub = ['.'] * len(ids), ['.'] * len(ids)
    by_cls = 0
    for r in cls:
        i = id_index.get(r.get('source_record_id'))
        if i is None:
            continue
        out_size[i] = str(SIZE.index(r['chain_size_band']))
        out_basis[i] = BASIS[r['chain_link_status']]
        out_food[i], out_sub[i] = food_of(r)
        if r.get('food_group_id'): food_basis[r.get('food_basis')] += 1
        by_cls += 1
    # Outlets outside the tab: a multi-banner point-of-sale registry is a record, not one chain (AGENTS 0.3.1) — it gets
    # no size at all ('x'); any other outlet would be sized by the register rule ('r').
    registry = {b['id'] for b in chains.get('brands', []) if re.search(r'registry|not_consumer_brand', str(b.get('format') or ''))}
    rule_rows, not_sized = collections.Counter(), collections.Counter()
    for i, oid in enumerate(ids):
        if out_size[i] != '.':
            continue
        b = brand_of.get(oid)
        if b is None:
            sys.exit(f'outlet {oid} is not in 02_STORES')
        if b in registry:
            out_basis[i] = 'x'
            not_sized[b] += 1
            continue
        out_size[i], out_basis[i] = str(size_band(per_brand[b])), 'r'
        rule_rows[b] += 1
    # the register rule must agree with the classification wherever both exist
    disagree = [oid for i, oid in enumerate(ids) if out_basis[i] not in ('r', 'x') and int(out_size[i]) != size_band(per_brand[brand_of[oid]])]
    if disagree:
        sys.exit(f'register size bands disagree with the classification on {len(disagree)} outlets, e.g. {disagree[:3]}')

    def counts(sizes, bases):
        c = collections.Counter((s, b) for s, b in zip(sizes, bases) if s != '.' or b != '.')
        return {(SIZE[int(s)] if s != '.' else 'none') + ':' + b: n for (s, b), n in sorted(c.items())}

    digest = lambda xs: hashlib.sha256('\n'.join(xs).encode('utf-8')).hexdigest()
    meta = {
        'schema': 'citymeter-restaurant-segments-1',
        'dataset': 'CityMETER Restaurants — segments shipped in 0.8.0 (chain size) and 0.9.2 (food taxonomy, by owner decision); price tiers checked',
        'source': 'Chain register workbook “CityMETER Chain Restaurants Thailand — Research Master”, tab 10_CLASSIFICATION (+ 06_DATA_DICTIONARY codebook, 02_STORES for CPF); internal input, never committed',
        'workbookSha256': a.workbook_sha256,
        'readOn': a.read_on,
        'classifiedOn': '2026-11-02',
        'ruleVersion': dict(rule_versions),
        'reviewStatus': dict(review),
        'qaRule': rule('rules.QA'),
        'chainRule': rule('rules.chain'),
        'priceRule': rule('rules.price'),
        'released': {'chain_size_band': 'counts of rows (no judgement); shipped with its basis',
                     'price tiers': 'computed by the page from the source bounds (p0/p1, rules.price); equal to price_band_observed',
                     'food taxonomy': 'food_category_id · food_group_id · food_subgroup_primary_id — shown by owner decision 2026-11-03 16:59 (“เปิดให้ทุกคนเห็นตอนนี้”), overriding rules.QA before the 1,550-sample check; every row unreviewed, labelled อนุมาน on the page'},
        'held': {'fields': HELD, 'why': 'review_status = unreviewed for every row; rules.QA: sample 50 per sub-segment, at least 48 correct, before the web'},
        'sizeCodes': [{'code': c, 'label': size_labels[c]} for c in SIZE],
        'priceCodes': [{'code': c, 'label': price_labels[c]} for c in price_labels],
        'basisCodes': {'c': 'นับแถวในทะเบียนที่มีรหัสแบรนด์เดียวกัน (confirmed_brand_registry_count)',
                       'n': 'นับร้านในชุดข้อมูลที่ชื่อเข้าเครือเดียวกัน — candidate ไม่ใช่เครือที่ยืนยัน (candidate_name_count)',
                       's': 'พบแถวเดียว ยังไม่รู้ว่ามีสาขาอื่นหรือไม่ — ไม่ยืนยันว่าเป็นร้านอิสระ (single_observed_record_network_unknown)',
                       'r': 'สาขาที่ไม่อยู่ในแท็บจัดกลุ่ม — นับแถวในทะเบียนที่มีรหัสแบรนด์เดียวกันด้วยกติกาเดียวกัน',
                       'x': 'ทะเบียนจุดขายหลายแบรนด์ (ไม่ใช่เครือ ไม่อยู่ในแท็บจัดกลุ่ม) — ไม่จัดขนาด'},
        'rows': {'count': len(keys), 'classified': classified_rows, 'moved': len(moved), 'keySha256': digest(keys), 'bands': counts(row_size, row_basis)},
        'outlets': {'count': len(ids), 'classified': by_cls, 'byRegisterRule': sum(rule_rows.values()), 'ruleBrands': dict(rule_rows),
                    'notSized': sum(not_sized.values()), 'notSizedBrands': dict(not_sized),
                    'idSha256': digest(ids), 'bands': counts(out_size, out_basis)},
        'priceCheck': dict(price_check),
        'food': {
            'basis': dict(food_basis),
            'alphabet': ALPHABET,
            'categories': [{'id': c['id'], 'label': c['label']} for c in cats],
            'groups': [{'id': g['id'], 'label': g['label'], 'category': g['category_id']} for g in groups],
            'subgroups': [{'id': x['id'], 'label': x['label'], 'group': x['group_id'], 'fallback': bool(x.get('fallback_within_known_group'))} for x in subs],
            'rows': {'grouped': sum(1 for v in row_food if v != '.'), 'subgrouped': sum(1 for v in row_sub if v != '.')},
            'outlets': {'grouped': sum(1 for v in out_food if v != '.'), 'subgrouped': sum(1 for v in out_sub if v != '.')},
        },
    }
    out = {'meta': meta, 'rows': {'size': ''.join(row_size), 'basis': ''.join(row_basis), 'food': ''.join(row_food), 'sub': ''.join(row_sub)},
           'outlets': {'size': ''.join(out_size), 'basis': ''.join(out_basis), 'food': ''.join(out_food), 'sub': ''.join(out_sub)}}
    with open(a.out, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps({k: meta[k] for k in ('rows', 'outlets', 'priceCheck')}, ensure_ascii=False)[:1500])
    print(json.dumps({k: v for k, v in meta['food'].items() if k in ('basis', 'rows', 'outlets')}, ensure_ascii=False))


if __name__ == '__main__':
    main()

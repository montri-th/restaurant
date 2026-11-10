#!/usr/bin/env python3
"""Stamp data/release.json with the time its register read went on the page (2026-11-09).

publishedAt is null in a pull request and set when the release reaches main: by .github/workflows/register-stamp.yml
right after the merge, or by hand in a manual release. The page shows it beside the sheet read (“อ่านชีต … ·
เผยแพร่ …”); a release already stamped keeps its time (--if-unset), so a later deploy never moves it.

    python3 -I scripts/release-stamp.py [--at 2026-11-10T09:00:00+07:00] [--if-unset]
"""
import argparse, datetime, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'data', 'release.json')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--at', default='')
    ap.add_argument('--if-unset', action='store_true')
    a = ap.parse_args()
    release = json.load(open(PATH, encoding='utf-8'))
    if a.if_unset and release.get('publishedAt'):
        print(f"already published {release['publishedAt']}")
        return
    at = a.at or datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).replace(microsecond=0).isoformat()
    if not re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$', at):
        sys.exit(f'not an ISO time with offset: {at}')
    if at < release['register']['readAt'][:len(at)] and at[:10] < release['register']['readAt'][:10]:
        sys.exit('a release cannot be published before its sheet was read')
    release['publishedAt'] = at
    with open(PATH, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(release, ensure_ascii=False, indent=1) + '\n')
    print(f'published {at}')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""One register round after the sheet was read: build, test, report, hand it over as a draft pull request (2026-11-09).

The nightly round is a Claude scheduled task on the owner's Mac (“Restaurants register nightly sync”, 22:28
Asia/Bangkok, and its “Run now”). It needs no key, secret or repository setting: it compares the sheet's modified time
(the owner's Google Drive connector, read only) with data/release.json, and on a night the sheet changed downloads its
xlsx export with the owner's Chrome into ~/Downloads/CityMETER-register-reads/ (never committed). Then, in a checkout of
the branch to build on — the open pull request whose branch starts with “register”, else main — it runs:

    python3 scripts/register-nightly.py --xlsx <file> --read-at <ISO> --sheet-modified <ISO> [--forbid <text>]…
        [--trailer '<commit trailer>']… [--pr-footer '<text>'] [--work <dir>] [--dry-run]

  1. scripts/sync-register.py — every check and stop of a round; the nine tabs unchanged → status "unchanged"
  2. npm run fixtures, npm test — a failing test stops the round and nothing is pushed
  3. scripts/register-report.mjs against origin/main — before = what the page shows now
  4. commit only what a register round writes (data/chains.json, segments.json, release.json, brand-logos.json,
     restaurants.json, docs/brand-crosswalk.json, tests/fixtures/), refuse a sheet link or any --forbid text, push to
     the branch (a new register-YYYY-MM-DD from main when no register pull request is open)
  5. open a draft pull request, or replace the open one's report part and add the report as a comment

It never merges, never pushes to main and never writes to the sheet: publishing stays the owner's command. Times may be
given in any offset or Z; they are written in Asia/Bangkok. The last line printed is one JSON object:
{"status": "unchanged" | "pull-request" | "dry-run" | "failed", …}. Exit 1 only when failed.
"""
import argparse, datetime, importlib.util, json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANGKOK = datetime.timezone(datetime.timedelta(hours=7))
ALLOWED = {'data/chains.json', 'data/segments.json', 'data/release.json', 'data/brand-logos.json', 'data/restaurants.json', 'docs/brand-crosswalk.json'}
ALLOWED_DIRS = ('tests/fixtures/',)
NO_LINKS = ('data/release.json', 'docs/brand-crosswalk.json', 'tests/fixtures/')  # files that never hold a sheet link
PRIVATE = ('docs.google.com', 'drive.google.com', 'spreadsheets/d/')
START, END = '<!-- register-report:start -->', '<!-- register-report:end -->'
MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']


class Stop(Exception):
    def __init__(self, step, message):
        super().__init__(message)
        self.step, self.message = step, message


def bangkok(v):
    """An ISO time with an offset or Z → the same instant as YYYY-MM-DDTHH:MM:SS+07:00."""
    try:
        t = datetime.datetime.fromisoformat(v.strip().replace('Z', '+00:00'))
    except ValueError:
        raise Stop('arguments', f'not an ISO time: {v}')
    if t.tzinfo is None:
        raise Stop('arguments', f'a time needs its offset or Z: {v}')
    return t.astimezone(BANGKOK).replace(microsecond=0).isoformat()


def thai(v, clock=True):
    t = datetime.datetime.fromisoformat(v)
    return f'{t.day} {MONTHS[t.month - 1]} {t.year + 543}' + (f' {t:%H:%M} น.' if clock else '')


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def step(name, cmd):
    """Run one build step; its output stays out of the way unless it fails."""
    log('$', ' '.join(os.path.relpath(c, ROOT) if os.path.isabs(c) and c.startswith(ROOT) else c for c in cmd))
    r = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True)
    if r.returncode != 0:
        out = (r.stdout or '') + (r.stderr or '')
        failing = [l.strip() for l in out.splitlines() if l.lstrip().startswith('not ok')]
        tail = '\n'.join(out.strip().splitlines()[-12:])
        raise Stop(name, ('failing: ' + '; '.join(failing[:8]) + '\n' if failing else '') + tail)
    return r.stdout


def git(*a):
    r = subprocess.run(['git', *a], cwd=ROOT, text=True, capture_output=True)
    if r.returncode != 0:
        raise Stop('git', f'git {" ".join(a)}: {(r.stderr or r.stdout).strip()[-600:]}')
    return r.stdout.strip()


def gh(method, path, payload=None):
    cmd = ['gh', 'api', '--method', method, path]
    if payload is not None:
        cmd += ['--input', '-']
    r = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, input=json.dumps(payload) if payload is not None else None)
    if r.returncode != 0:
        raise Stop('github', f'gh api {method} {path}: {(r.stderr or r.stdout).strip()[-600:]}')
    return json.loads(r.stdout) if r.stdout.strip() else None


def repo_slug():
    m = re.search(r'[/:]([^/:]+)/([^/]+?)(?:\.git)?/?$', git('remote', 'get-url', 'origin'))
    if not m:
        raise Stop('checkout', 'cannot read owner/repository from the origin remote')
    return f'{m.group(1)}/{m.group(2)}'


def allowed(path):
    return path in ALLOWED or path.startswith(ALLOWED_DIRS)


def tests_line(output):
    """“148/148”, and the tests a read skipped (a case the owner asked about that this read no longer has)."""
    n = {k: int(v) for k, v in re.findall(r'^# (tests|pass|fail|skipped) (\d+)$', output, re.M)}
    line = f"{n.get('pass', '?')}/{n.get('tests', '?')}"
    skipped = [m.strip() for m in re.findall(r'^\s*ok \d+ - (.+# SKIP.*)$', output, re.M)]
    if n.get('skipped'):
        line += f" · ข้าม {n['skipped']}: " + '; '.join(skipped[:5])
    return line


def report_block(release, report, pending, passed):
    """The part of a pull request a round rewrites: before and after, and what a round leaves for a person."""
    r = release['register']
    first = next((row for row in report['totals'] if row[0].startswith('ข้อค้นพบแรก')), None)
    lines = [START,
             f"อ่านชีต **{thai(r['readAt'])}** · ชีตแก้ล่าสุด {thai(r['sheetModifiedAt']) if r.get('sheetModifiedAt') else '—'} · "
             f"ชุดข้อมูล SHA-256 `{r['sourceSha256'][:16]}…` · ก่อน = เว็บตอนนี้ (main) · หลัง = pull request นี้", '',
             report['md'].strip(), '',
             f"ทดสอบ: `npm test` ผ่าน {passed} (fixtures สร้างใหม่จากการรัน ค่าเดิมอยู่ใน history ของ `tests/fixtures/data-snapshot.json`)", '',
             '**งานอัตโนมัติไม่ได้ทำ (รอบที่คนทำ)**',
             f"- อาคาร Land: ยังเป็นฉบับจับคู่ {pending.get('landCheckedOn') or '—'} — สาขาที่เพิ่มหรือย้ายพิกัดหลังจากนั้นยังไม่มีอาคาร (ใช้ทะเบียน Land ภายใน)",
             f"- โลโก้ที่ทะเบียนชี้ไฟล์ใหม่: {len(pending.get('logosPending') or [])} เครือ"
             + (f" ({', '.join(pending['logosPending'][:12])}{' …' if len(pending['logosPending']) > 12 else ''})" if pending.get('logosPending') else '')]
    if first and str(first[1]) != str(first[2]):
        lines.append('- **ข้อค้นพบแรกเปลี่ยน**: แก้ตัวเลขใน README, PRODUCT_STATEMENT และ handoff/product-brief.json ก่อนเผยแพร่')
    lines.append(END)
    return '\n'.join(lines)


def run_round(a):
    read_at, modified = bangkok(a.read_at), bangkok(a.sheet_modified)
    xlsx = os.path.abspath(a.xlsx)
    work = os.path.abspath(a.work or tempfile.mkdtemp(prefix='register-round-'))
    os.makedirs(work, exist_ok=True)

    # 0. where this round stands
    for mod in ('openpyxl', 'shapely'):
        if importlib.util.find_spec(mod) is None:
            raise Stop('setup', f'python module {mod} is missing: python3 -m pip install --break-system-packages openpyxl shapely')
    if git('status', '--porcelain', '--untracked-files=all'):
        raise Stop('checkout', 'the working tree has changes: start from a clean checkout')
    branch = git('rev-parse', '--abbrev-ref', 'HEAD')
    if branch != 'main' and not branch.startswith('register'):
        raise Stop('checkout', f'on {branch}: build on main or on the open register pull request’s branch')
    repo = repo_slug()
    git('fetch', '--quiet', 'origin', 'main', *([branch] if branch != 'main' else []))
    if not a.dry_run and git('rev-parse', 'HEAD') != git('rev-parse', f'origin/{branch}'):
        raise Stop('checkout', f'{branch} is not at origin/{branch}: check out the latest first')
    open_register = [p for p in gh('GET', f'repos/{repo}/pulls?state=open&per_page=100')
                     if p['head']['ref'].startswith('register') and (p['head'].get('repo') or {}).get('full_name') == repo]
    pr = next((p for p in open_register if p['head']['ref'] == branch), None)
    if branch == 'main' and open_register:
        raise Stop('checkout', f"register pull request #{open_register[0]['number']} is open: build on its branch {open_register[0]['head']['ref']}")
    if branch != 'main' and not pr:
        raise Stop('checkout', f'no open pull request has {branch}: build on main')

    # 1. the register and what it feeds
    out = os.path.join(work, 'sync.out')
    if os.path.exists(out):
        os.remove(out)
    step('sync', [sys.executable, os.path.join(ROOT, 'scripts/sync-register.py'), '--work', os.path.join(work, 'sync'), '--xlsx', xlsx,
                  '--read-at', read_at, '--sheet-modified', modified, '--github-output', out])
    kv = dict(l.split('=', 1) for l in open(out, encoding='utf-8').read().splitlines() if '=' in l)
    if kv.get('changed') != 'true':
        return {'status': 'unchanged', 'readAt': read_at, 'sheetModifiedAt': modified, 'branch': branch,
                'note': 'the nine tabs the page reads are the same as data/release.json: nothing to build'}

    # 2. fixtures from a run, then every test
    step('fixtures', ['npm', 'run', '--silent', 'fixtures'])
    passed = tests_line(step('tests', ['npm', 'test']))

    # 3. before = the published site (origin/main), after = this tree
    published, md, rj = os.path.join(work, 'published'), os.path.join(work, 'report.md'), os.path.join(work, 'report.json')
    subprocess.run(['git', 'worktree', 'remove', '--force', published], cwd=ROOT, capture_output=True)
    shutil.rmtree(published, ignore_errors=True)
    git('worktree', 'add', '--detach', published, 'origin/main')
    try:
        step('report', ['node', os.path.join(ROOT, 'scripts/register-report.mjs'), '--before', published, '--md', md, '--json', rj])
    finally:
        subprocess.run(['git', 'worktree', 'remove', '--force', published], cwd=ROOT, capture_output=True)
    report = json.load(open(rj, encoding='utf-8'))
    report['md'] = open(md, encoding='utf-8').read()
    release = json.load(open(os.path.join(ROOT, 'data/release.json'), encoding='utf-8'))
    pending = json.load(open(os.path.join(work, 'sync', 'pending.json'), encoding='utf-8'))

    # 4. only what a register round writes, and nothing private
    git('add', '-A', '--', 'data', 'docs/brand-crosswalk.json', 'tests/fixtures')
    status = git('status', '--porcelain', '--untracked-files=all').splitlines()
    loose = [l for l in status if l[1] != ' ' or l[0] == '?' or not allowed(l[3:])]
    if loose:
        raise Stop('commit', 'files outside a register round changed (nothing committed): ' + ', '.join(loose[:10]))
    staged = [l[3:] for l in status]
    if not staged:
        raise Stop('commit', 'the round changed no file')
    forbid = [f for f in a.forbid if f.strip()]
    for path in staged:
        full = os.path.join(ROOT, path)
        if not os.path.isfile(full):
            continue
        text = open(full, 'rb').read().decode('utf-8', 'replace')
        if any(f in text for f in forbid) or (path.startswith(NO_LINKS) and any(p in text for p in PRIVATE)):
            raise Stop('privacy', f'{path} holds the sheet’s link or id: nothing committed')

    r = release['register']
    added, gone, changed = report['added'], len(report['gone']), report['changed']['count']
    title = f"ทะเบียนร้านเครือฉบับอ่าน {thai(read_at, clock=False)} ({r['outlets']:,} สาขา {r['brandsWithOutlets']:,} เครือ)"
    message = '\n'.join([
        f"Register read {read_at[:16].replace('T', ' ')} (+07:00): {r['outlets']:,} outlets, {r['brandsWithOutlets']:,} brands "
        f"(+{added} / -{gone} / ~{changed})", '',
        f"Sheet modified {r.get('sheetModifiedAt') or '-'}; source set {r['sourceSha256'][:16]}. scripts/register-nightly.py:",
        'sync-register (build-chains, brand-crosswalk, build-segments, register-source), fixtures from a run,',
        f'npm test {passed}; report against origin/main in the pull request.',
        *([''] + a.trailer if a.trailer else [])])
    block = report_block(release, report, pending, passed)
    new_branch = branch
    if branch == 'main':
        heads = {l.split('refs/heads/', 1)[1] for l in git('ls-remote', '--heads', 'origin').splitlines() if 'refs/heads/' in l}
        base = new_branch = f'register-{read_at[:10]}'
        n = 1
        while new_branch in heads:
            n += 1
            new_branch = f'{base}-{n}'
    preview = f'https://raw.githack.com/{repo}/{new_branch}/index.html'
    for name, text in (('commit-message.txt', message), ('report-block.md', block), ('title.txt', title)):
        with open(os.path.join(work, name), 'w', encoding='utf-8') as fh:
            fh.write(text + '\n')
    summary = {'readAt': read_at, 'sheetModifiedAt': modified, 'outlets': r['outlets'], 'brands': r['brandsWithOutlets'],
               'added': added, 'gone': gone, 'changed': changed, 'newBrands': len(report['newBrands']), 'bandChanged': len(report['bandChanged']),
               'tests': passed, 'branch': new_branch, 'preview': preview, 'work': work}
    if a.dry_run:
        return {'status': 'dry-run', **summary, 'staged': staged}

    # 5. commit, push, pull request (draft; never merged here)
    if branch == 'main':
        git('switch', '-q', '-c', new_branch)
    ident = [] if subprocess.run(['git', 'config', 'user.email'], cwd=ROOT, capture_output=True).returncode == 0 else ['-c', 'user.name=Claude', '-c', 'user.email=noreply@anthropic.com']
    git(*ident, 'commit', '-q', '-F', os.path.join(work, 'commit-message.txt'))
    sha = git('rev-parse', 'HEAD')
    git('push', '-q', 'origin', f'HEAD:refs/heads/{new_branch}')
    footer = ('\n\n' + a.pr_footer.strip()) if a.pr_footer.strip() else ''
    if pr:
        body = pr.get('body') or ''
        if START in body and END in body:
            body = body[:body.index(START)] + block + body[body.index(END) + len(END):]
        else:
            body = body.rstrip() + '\n\n## ยอดก่อน–หลัง (อ่านล่าสุด)\n' + block + '\n'
        done = gh('PATCH', f"repos/{repo}/pulls/{pr['number']}", {'title': title, 'body': body})
        gh('POST', f"repos/{repo}/issues/{pr['number']}/comments",
           {'body': f"รอบตรวจทุกคืน: อ่านชีต {thai(read_at)} ชุดข้อมูลเปลี่ยน — เพิ่ม commit `{sha[:7]}` ใน pull request นี้ (ยังไม่เผยแพร่)\n\n{block}{footer}"})
        return {'status': 'pull-request', 'action': 'updated', 'number': pr['number'], 'url': done['html_url'], 'commit': sha[:7], **summary}
    body = '\n'.join([
        f"ทะเบียนร้านเครือจากชีตวิจัยฉบับอ่าน **{thai(read_at)}** เปิดโดยงานตรวจทุกคืนของ Claude (อ่านชีตอย่างเดียว) — **Draft: ยังไม่เผยแพร่ รอคำสั่ง**", '',
        '## ยอดก่อน–หลัง', block, '',
        '## วิธีเปิดตัวอย่าง',
        f'- เปิด {preview} แล้วกด **Open the page** ครั้งแรก (githack ดึงไฟล์จาก GitHub ตรง ๆ)',
        f'- ในเครื่อง: `git fetch origin {new_branch} && git switch {new_branch} && npm start` แล้วเปิด http://127.0.0.1:4173/', '',
        '## เผยแพร่',
        '- บอก Claude ว่า “เผยแพร่ pull request นี้” — Claude รวมกับ main ล่าสุด ใส่วันที่เผยแพร่ รันทดสอบ แล้ว merge และตรวจหน้าจริง (`npm run verify:live`)',
        '- หรือ merge เองบน GitHub: `register-stamp.yml` ใส่วันที่เผยแพร่ใน `data/release.json` ให้หลัง merge',
        '- ไม่เผยแพร่: ปิด pull request นี้ได้เลย เว็บคงฉบับเดิม',
    ]) + footer
    done = gh('POST', f'repos/{repo}/pulls', {'title': title, 'head': new_branch, 'base': 'main', 'body': body, 'draft': True})
    return {'status': 'pull-request', 'action': 'created', 'number': done['number'], 'url': done['html_url'], 'commit': sha[:7], **summary}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--xlsx', required=True, help='the downloaded export of the register sheet')
    ap.add_argument('--read-at', required=True, help='when the sheet was read (ISO with offset or Z)')
    ap.add_argument('--sheet-modified', required=True, help="the sheet's modified time from Drive (ISO with offset or Z)")
    ap.add_argument('--work', default='', help='a scratch folder (default: a new temporary one)')
    ap.add_argument('--forbid', action='append', default=[], help='text that must not reach any committed file (the sheet id)')
    ap.add_argument('--trailer', action='append', default=[], help='a line for the end of the commit message')
    ap.add_argument('--pr-footer', default='', help='text for the end of the pull request description')
    ap.add_argument('--dry-run', action='store_true', help='build, test and report; no commit, push or pull request')
    a = ap.parse_args()
    try:
        result = run_round(a)
    except Stop as e:
        result = {'status': 'failed', 'step': e.step, 'message': e.message}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(1 if result['status'] == 'failed' else 0)


if __name__ == '__main__':
    main()

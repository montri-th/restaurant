#!/usr/bin/env python3
"""Read the chain register sheet with a read-only service account (register sync, 2026-11-09).

The same file a person downloads (File → Download → .xlsx), so scripts/xlsx-dump.py and every build step read exactly
what they read in a manual round. The service account holds Viewer on the sheet and read-only scopes; nothing is
written to the sheet, and its id never leaves the environment (REGISTER_SHEET_ID, a repository secret). An export that
fails stops the sync: no other reader stands in, so a round never runs on a different reading of the sheet.

Writes <out>/register.xlsx and <out>/read.json {readAt, sheetModifiedAt, reader}. Exit 0 = read; 78 = not configured
(no secret: the sync is skipped, not failed); anything else = failed, nothing to build.

    GOOGLE_SERVICE_ACCOUNT_JSON='{…}' REGISTER_SHEET_ID=… python3 scripts/fetch-register.py --out <dir>
"""
import argparse, datetime, json, os, sys, time

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
BANGKOK = datetime.timezone(datetime.timedelta(hours=7))


def iso(dt):
    return dt.astimezone(BANGKOK).replace(microsecond=0).isoformat()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    key, sheet = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON', '').strip(), os.environ.get('REGISTER_SHEET_ID', '').strip()
    if not key or not sheet:
        print('register sync not configured (GOOGLE_SERVICE_ACCOUNT_JSON / REGISTER_SHEET_ID): nothing read')
        sys.exit(78)
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    http = AuthorizedSession(service_account.Credentials.from_service_account_info(json.loads(key), scopes=SCOPES))
    os.makedirs(a.out, exist_ok=True)

    meta = http.get(f'https://www.googleapis.com/drive/v3/files/{sheet}', params={'fields': 'modifiedTime', 'supportsAllDrives': 'true'}, timeout=60)
    if meta.status_code != 200:
        sys.exit(f'Drive metadata: HTTP {meta.status_code} — is the sheet shared with the service account as Viewer?')
    modified = datetime.datetime.fromisoformat(meta.json()['modifiedTime'].replace('Z', '+00:00'))

    path, error = os.path.join(a.out, 'register.xlsx'), ''
    for attempt in range(3):
        try:
            r = http.get(f'https://docs.google.com/spreadsheets/d/{sheet}/export', params={'format': 'xlsx'}, timeout=900, stream=True)
            if r.status_code == 200:
                with open(path, 'wb') as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
                with open(path, 'rb') as fh:
                    if fh.read(2) == b'PK':
                        break
                error = 'the answer is not an xlsx file'
            else:
                error = f'HTTP {r.status_code}'
        except Exception as e:  # a dropped connection on a 90 MB export: try again
            error = str(e)
        time.sleep(30 * (attempt + 1))
    else:
        sys.exit(f'xlsx export failed after 3 tries: {error}')
    read = {'readAt': iso(datetime.datetime.now(datetime.timezone.utc)), 'sheetModifiedAt': iso(modified), 'reader': 'xlsx-export', 'bytes': os.path.getsize(path)}
    with open(os.path.join(a.out, 'read.json'), 'w', encoding='utf-8') as fh:
        json.dump(read, fh)
    print(json.dumps(read))


if __name__ == '__main__':
    main()

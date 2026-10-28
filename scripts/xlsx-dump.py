#!/usr/bin/env python3
"""Dump every tab of an xlsx export to one JSON file per tab (list of {header: value}).

Used for the research workbooks (internal inputs, never committed): the build scripts read these
dumps so a rebuild does not re-parse a 50–90 MB workbook for each step.

    python3 -I scripts/xlsx-dump.py <workbook.xlsx> <out-dir>
"""
import datetime, json, os, sys
import openpyxl

def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    conv = lambda v: v.isoformat() if isinstance(v, (datetime.datetime, datetime.date)) else v
    summary = {}
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        header = next(rows, None)
        if header is None:
            summary[ws.title] = {'rows': 0, 'cols': 0}
            continue
        header = [str(h) if h is not None else f'col{i}' for i, h in enumerate(header)]
        data = [{h: conv(v) for h, v in zip(header, r)} for r in rows if r is not None and any(v is not None for v in r)]
        with open(os.path.join(out, ws.title + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False)
        summary[ws.title] = {'rows': len(data), 'cols': len(header)}
    print(json.dumps(summary, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()

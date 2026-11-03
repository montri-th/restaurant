#!/usr/bin/env python3
"""Build the Restaurants pictogram extension: 12 Material Symbols Rounded glyphs (Apache 2.0).

Owner approval 2026-11-03 (answer “อนุมัติราว 12 ตัว”): food-group, price, building, place and
filter pictograms beside their labels — never instead of a label (LDS ICON-01). Static instance
at the LDS axes for this family (FILL 0, wght 300, GRAD 0, opsz 24), subset to the glyphs below,
written as WOFF2 beside the 8-glyph subset of 2026-10-22, which stays byte-identical (it came
from an older source build; the two files share one CSS family through unicode-range).
The source variable font is not committed; pass its path and the .codepoints file of the
same build (each name is checked against it). Requires fonttools + brotli.

  python3 -I scripts/build-pictogram-food.py <MaterialSymbolsRounded[FILL,GRAD,opsz,wght].ttf> <….codepoints>
"""
import hashlib, json, sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# role → (Material Symbols name, codepoint). Roles match the CSS classes .pic-<role>.
GLYPHS = {
    'g-general': ('restaurant', 0xE56C),       # ร้านอาหารทั่วไป
    'g-thai': ('rice_bowl', 0xF1F5),           # อาหารไทย
    'g-fastfood': ('lunch_dining', 0xEA61),    # ฟาสต์ฟู้ด
    'g-japanese': ('ramen_dining', 0xEA64),    # ญี่ปุ่น
    'g-cafe': ('local_cafe', 0xEB44),          # คาเฟ่และของหวาน
    'g-asian': ('takeout_dining', 0xEA74),     # จีนและเอเชีย
    'g-grill': ('outdoor_grill', 0xEA47),      # ปิ้งย่าง บุฟเฟต์ ซีฟู้ด
    'g-western': ('dinner_dining', 0xEA57),    # ตะวันตกและนานาชาติ
    'price': ('payments', 0xEF63),             # ราคา
    'building': ('apartment', 0xEA40),         # อาคาร
    'place': ('location_on', 0xF1DB),          # ที่อยู่ / พิกัด
    'tune': ('tune', 0xE429),                  # ลองกับร้านแบบคุณ (ตัวกรอง)
}
AXES = {'FILL': 0, 'wght': 300, 'GRAD': 0, 'opsz': 24}
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'icons' / 'material-pictogram-food-300.woff2'
MANIFEST = ROOT / 'assets' / 'icons' / 'material-pictogram-food-300.json'


def main(src, codepoints):
    names = dict(line.split() for line in Path(codepoints).read_text().splitlines() if line.strip())
    wrong = {n: (hex(cp), names.get(n)) for n, cp in GLYPHS.values() if int(names.get(n, '0'), 16) != cp}
    if wrong:
        raise SystemExit(f'codepoints differ from the source build: {wrong}')
    font = TTFont(src, recalcTimestamp=False)
    static = instancer.instantiateVariableFont(font, AXES, inplace=False, updateFontNames=False)
    static.recalcTimestamp = False  # same input, same bytes: keep the source's head.modified
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = []  # codepoint access only (CSS content), no ligatures needed
    options.name_IDs = ['*']
    options.notdef_outline = True
    options.drop_tables += ['GSUB', 'GPOS']
    sub = subset.Subsetter(options)
    sub.populate(unicodes=[cp for _, cp in GLYPHS.values()])
    sub.subset(static)
    static.flavor = 'woff2'
    OUT.parent.mkdir(parents=True, exist_ok=True)
    static.save(OUT)
    data = OUT.read_bytes()
    check = TTFont(OUT)
    cmap, glyf = check.getBestCmap(), check['glyf']
    missing = [n for n, (_, cp) in GLYPHS.items() if cp not in cmap]
    empty = [n for n, (_, cp) in GLYPHS.items() if cp in cmap and not getattr(glyf[cmap[cp]], 'numberOfContours', 0)]
    if missing or empty:
        raise SystemExit(f'missing glyphs: {missing}; empty outlines: {empty}')
    manifest = {
        'family': 'LDS Material Symbols Rounded Pictogram',
        'file': OUT.name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
        'source': 'google/material-design-icons variablefont/MaterialSymbolsRounded[FILL,GRAD,opsz,wght].ttf (master, read 2026-11-03)',
        'sourceSha256': hashlib.sha256(Path(src).read_bytes()).hexdigest(),
        'codepointsSha256': hashlib.sha256(Path(codepoints).read_bytes()).hexdigest(),
        'license': 'Apache-2.0 (assets/icons/material-symbols-Apache-2.0.txt)',
        'axes': AXES,
        'glyphs': {role: {'name': name, 'codepoint': f'U+{cp:04X}'} for role, (name, cp) in GLYPHS.items()},
        'use': 'beside a visible label, aria-hidden; never instead of a category, evidence or rating label (LDS ICON-01)',
        'status': 'extension of the Restaurants pictogram test exception, approved by the owner 2026-11-03 (“อนุมัติราว 12 ตัว”); the 8-glyph subset of 2026-10-22 is unchanged',
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'wrote {OUT} ({len(data)} bytes, sha256 {manifest["sha256"]}) and {MANIFEST.name}')
    print('unicode-range:', ', '.join(f'U+{cp:04X}' for _, cp in GLYPHS.values()))


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])

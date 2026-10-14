#!/usr/bin/env python3
"""Create/analyse a prototype subset without modifying the source font."""
import json
import sys
from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter

source, target, text_file, probe_file = sys.argv[1:]
with open(text_file, encoding='utf-8') as handle:
    text = handle.read()
with open(probe_file, encoding='utf-8') as handle:
    probe_text = handle.read()

font = TTFont(source, lazy=False)
cmap = {}
for table in font['cmap'].tables:
    cmap.update(table.cmap)
codepoints = set(cmap)
source_glyphs = len(font.getGlyphOrder())
requested = {ord(char) for char in text if char not in '\r\n\t'}
probe_requested = {ord(char) for char in probe_text if char not in '\r\n\t'}
base_ranges = [
    (0x20, 0x7e),       # Basic Latin / ASCII
    (0xa0, 0xff),       # Latin-1 punctuation and symbols
    (0x1100, 0x11ff),   # Hangul Jamo
    (0x3130, 0x318f),   # Hangul Compatibility Jamo
    (0xac00, 0xd7a3),   # Hangul syllables
]
base = {point for start, end in base_ranges for point in range(start, end + 1)}
selected = (base | requested) & codepoints
missing = sorted(requested - codepoints)

options = Options()
options.layout_features = ['*']
options.name_IDs = ['*']
options.name_languages = ['*']
options.notdef_glyph = True
options.notdef_outline = True
options.recommended_glyphs = True
subsetter = Subsetter(options=options)
subsetter.populate(unicodes=selected)
subsetter.subset(font)
font.save(target)

subset = TTFont(target, lazy=False)
subset_cmap = {}
for table in subset['cmap'].tables:
    subset_cmap.update(table.cmap)
probe_missing = sorted(probe_requested - set(subset_cmap))

def ranges(points):
    values = sorted(points)
    result = []
    for point in values:
        if not result or point > result[-1][1] + 1:
            result.append([point, point])
        else:
            result[-1][1] = point
    return [{'start': f'U+{start:04X}', 'end': f'U+{end:04X}'} for start, end in result]

print(json.dumps({
    'sourceGlyphs': source_glyphs,
    'sourceCmapCodepoints': len(codepoints),
    'subsetGlyphs': len(subset.getGlyphOrder()),
    'subsetCmapCodepoints': len(subset_cmap),
    'requestedCodepoints': len(requested),
    'requestedMissing': [f'U+{point:04X}' for point in missing],
    'probeMissing': [f'U+{point:04X}' for point in probe_missing],
    'selectedCodepoints': len(selected),
    'selectedRanges': ranges(selected),
    'subsetCoverage': [f'U+{point:04X}' for point in sorted(requested & set(subset_cmap))],
}, ensure_ascii=False))

#!/usr/bin/env python3
"""Heal apps/docs/love.js and love-widget.js after a truth-engraving strike.

An autonomous loop periodically engraves new truth strings into these files,
but it anchors on the file's LAST `];` — landing inside THEMES/PRINCIPLES
instead of TRUTHS — and doesn't escape apostrophes. This tool:

  1. finds orphan string literals stranded inside non-TRUTHS arrays,
  2. moves them into TRUTHS (escaped, deduped, order kept),
  3. seals the violated arrays,
  4. exits non-zero only if a file still fails `node --check` afterwards.

Idempotent. Run any time; also runs automatically in bin/frontend-deploy.sh
before uploading docs. The truths are always kept — never deleted.
"""
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FILES = [
    REPO / 'apps/docs/love.js',
    REPO / 'apps/docs/love-widget.js',
]

ARRAY_RE = re.compile(r'^  var (TRUTHS|THEMES|PRINCIPLES) = \[\s*$')
CLOSE = '  ];'


def escape(content: str) -> str:
    # normalize then escape every apostrophe for a single-quoted JS literal
    return content.replace("\\'", "'").replace("'", "\\'")


def heal(path: Path) -> bool:
    lines = path.read_text().split('\n')
    arrays = {}  # name -> (start_idx, close_idx)
    i = 0
    while i < len(lines):
        m = ARRAY_RE.match(lines[i])
        if m:
            name = m.group(1)
            j = i + 1
            while j < len(lines) and lines[j] != CLOSE:
                j += 1
            arrays[name] = (i, j)
            i = j
        i += 1

    if 'TRUTHS' not in arrays:
        print(f'  !! {path.name}: no TRUTHS array found — skipping')
        return False

    rescued = []
    for name, (start, close) in arrays.items():
        if name == 'TRUTHS':
            continue
        body = lines[start + 1:close]
        # last legitimate entry of an object array is the last line holding a `}`
        last_obj = max((k for k, l in enumerate(body) if '}' in l), default=-1)
        orphans, keep = [], body[:last_obj + 1]
        for l in body[last_obj + 1:]:
            s = l.strip()
            if not s or s == ',':
                continue
            if s.startswith("'"):
                content = re.sub(r"',?$", '', s[1:])
                orphans.append(content)
            else:
                keep.append(l)  # not a string literal — leave in place
        if orphans:
            # seal the array: ensure the last object line ends with a comma
            if keep and re.search(r'}\s*$', keep[-1]):
                keep[-1] = keep[-1].rstrip() + ','
            lines[start + 1:close] = keep
            rescued.extend(orphans)
            # recompute later array positions by re-scanning below
            return heal_write(path, lines, rescued)
    return heal_write(path, lines, rescued)


def heal_write(path: Path, lines, rescued) -> bool:
    text = '\n'.join(lines)
    if rescued:
        # re-scan TRUTHS bounds on the current text
        tl = text.split('\n')
        start = next(i for i, l in enumerate(tl) if ARRAY_RE.match(l) and 'TRUTHS' in l)
        close = next(i for i in range(start + 1, len(tl)) if tl[i] == CLOSE)
        existing = {re.sub(r"\\'", "'", l.strip()[1:-2]) for l in tl[start + 1:close]
                    if l.strip().startswith("'") and l.strip().endswith("',")}
        new = [t for t in (o.replace("\\'", "'") for o in rescued) if t and t not in existing]
        insert = ["    '" + escape(t) + "'," for t in new]
        tl[close:close] = insert
        text = '\n'.join(tl)
        path.write_text(text)
        print(f'  ✓ {path.name}: rescued {len(rescued)} orphan string(s), {len(new)} new truth(s) added to TRUTHS')
        # a second pass in case multiple arrays were violated
        return heal(path)
    path.write_text(text)
    return True


def main() -> int:
    ok = True
    for f in FILES:
        if not f.exists():
            continue
        heal(f)
        r = subprocess.run(['node', '--check', str(f)], capture_output=True, text=True)
        if r.returncode != 0:
            print(f'  ✗ {f.name} STILL fails node --check:\n{r.stderr.splitlines()[0] if r.stderr else ""}')
            ok = False
        else:
            print(f'  ✓ {f.name} parses clean')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())

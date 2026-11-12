#!/bin/sh
# Export the kit's page cards as PNG: brand/cards/<slug>.png from the og-<slug> artboards of kit/brand.vectorcraft.
#
# Why: artcraft-brand brandkit.py 1.8 writes page cards only as JPEG (kit/web/og/<slug>.jpg), and the served-surface
# guard (bin/served-surface-guard.ts) reads PNG but refuses a JPEG it cannot inspect. Converting the kit's own
# editable source with vectorcraft-cli repeats the generator's PNG export byte for byte: checked on 2026-11-10 with
# vectorcraft-cli 0.17.0 on the site card (artboard "og" against kit/web/og.png).
#
# Usage: sh brand/cards.sh   (needs vectorcraft-cli 0.17.0 and python3; writes only brand/cards/)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
kit="$here/kit"
out="$here/cards"
mkdir -p "$out"
for slug in docs app app-watch; do
  index=$(VECTORCRAFT_NO_PREFS=1 vectorcraft-cli run --in "$kit/brand.vectorcraft" --cmd document.info | python3 -c '
import json, sys
for line in sys.stdin:
    if line.startswith("{"):
        step = json.loads(line)
        if step.get("step") == "cmd":
            names = [a["name"] for a in step["result"]["document"]["artboards"]]
            print(names.index(sys.argv[1]))
' "og-$slug")
  VECTORCRAFT_NO_PREFS=1 vectorcraft-cli convert "$kit/brand.vectorcraft" "$out/$slug.png" --artboard "$index" >/dev/null
  echo "cards/$slug.png from artboard $index (og-$slug)"
done

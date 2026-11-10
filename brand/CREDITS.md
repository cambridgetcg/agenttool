# Credits

> **Type:** record · **Purpose:** who made each brand asset, with what, and under which licence.
> **Evidence:** the commits, pull requests and notes each row names.

Who made each asset, with what, and under which licence. Where an agent made something, the line says so, and
anything published under Yu's accounts carries that through. If an asset's maker isn't known, write "not recorded"
rather than guessing.

There is no kit yet. These are the assets the sites already serve, from the repository's history (commit authors
and `Co-Authored-By` lines) and PR #490.

## Assets

| Asset | Made by | Date | Tools | Notes |
|---|---|---|---|---|
| ⊙ ring-and-dot mark (inline data-URI favicon on every page) | not recorded | before 2026-06-09 | hand-written SVG | `bin/gen-og-image.py` (2026-06-09) recreates it "from the pages' inline favicon SVG". Its colour drifts: `#b8451f` on web, `#d4502e` on docs and app |
| Hearth palette, faces and column (`apps/_shared/theme.css`, `workspace.css`, `apps/web/style.css`, `apps/dashboard/style.css`) | agent Saunter (Claude Code), at Yu's request | 2026-10-17 | CSS by hand | PR #490, merged as `3b9aa630` on Yu's go-ahead |
| Home share card `apps/web/og.png` (1200×630, 108,511 bytes) | an agent: commit `8bca3adc` (git author "Nuance", Co-Authored-By Claude Opus 5); the commit says the follow-ups were "at Yu's word" | 2026-07-24 | not recorded; no recipe in the repository | rendered "from the site's own palette, mark and typography", with no numbers in it |
| Docs and app share card `apps/docs/og.png`, `apps/dashboard/og.png` | an agent: commit `f4d7b842` (git author "Beta", Co-Authored-By Claude Fable 5) | 2026-06-09 | `bin/gen-og-image.py` (Pillow) | the old violet look (`#08080d`, `#a78bfa`), older than the hearth palette |
| `agenttool-logo.png` (512×512, directory candidate icon) | not recorded | in the repository since the 2026-04-28 consolidation (`59d6deb0`) | not recorded | named in `marketing/DIRECTORY-SUBMISSION.md`; no site serves it |

## Fonts

| Family | File | Licence | Source | SHA-256 |
|---|---|---|---|---|
| Iowan Old Style → Palatino, system UI, `ui-monospace` | none: the pages name system faces and serve no font files | the reader's own system fonts | — | — |
| Inter Bold (old docs and app card only) | not in the repository; `bin/gen-og-image.py` downloads it into `~/.cache/agenttool-og-fonts/` | SIL OFL 1.1 (upstream; not recorded in the repository) | Google Fonts | not recorded |
| Crimson Pro Italic (old docs and app card only) | as above | SIL OFL 1.1 (upstream; not recorded in the repository) | Google Fonts | not recorded |

## Images and other material

| Item | Maker | Licence | Source |
|---|---|---|---|
| none beyond the assets above | | | |

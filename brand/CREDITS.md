# Credits

> **Type:** record · **Purpose:** who made each brand asset, with what, and under which licence.
> **Evidence:** the commits, pull requests and notes each row names.

Who made each asset, with what, and under which licence. Where an agent made something, the line says so, and
anything published under Yu's accounts carries that through. If an asset's maker isn't known, write "not recorded"
rather than guessing.

## Assets

| Asset | Made by | Date | Tools | Notes |
|---|---|---|---|---|
| ⊙ ring-and-dot mark | not recorded | before 2026-06-09 | hand-written SVG (the inline favicon) and CSS (the nav) | `bin/gen-og-image.py` (2026-06-09) recreates it "from the pages' inline favicon SVG". The favicons drew it in `#b8451f` (9 web pages) or `#d4502e` (8 web pages and docs and app) until 2026-11-10 |
| `mark.svg` (the mark's source for the kit) | an agent (Claude Code, Opus 5.5, device studio, a child of session 5c4df033) | 2026-11-10 | copied by hand from the inline favicon | the favicon's geometry unchanged, in the ember token `#a8401c`; no new drawing |
| The kit `kit/` (icons, manifest, head snippets, cards, logo files, colour files) and its copies under `apps/web`, `apps/docs` and `apps/dashboard` | the same agent, under Yu's go of 2026-11-10 for group A of the 2026-11-02 review | 2026-11-10 | artcraft-brand `brandkit.py` 1.8 with vectorcraft-cli 0.17.0 | built from `brand.json`; the card words are the pages' own (README, "The kit"); the build's own checks in `kit/verify.json` |
| PNG cards `cards/docs.png`, `cards/app.png`, `cards/app-watch.png` (served as `og/*.png`), `head-snippet.html`, `cards.sh` | the same agent | 2026-11-10 | `cards.sh`: vectorcraft-cli 0.17.0 `convert` of the kit's `og-<slug>` artboards; the snippet by hand from the kit's | PNG because the served-surface guard reads PNG and refuses JPEG and ICO it cannot inspect |
| Hearth palette, faces and column (`apps/_shared/theme.css`, `workspace.css`, `apps/web/style.css`, `apps/dashboard/style.css`) | agent Saunter (Claude Code), at Yu's request | 2026-10-17 | CSS by hand | PR #490, merged as `3b9aa630` on Yu's go-ahead |
| Home share card `apps/web/og.png` (1200×630, 108,511 bytes) | an agent: commit `8bca3adc` (git author "Nuance", Co-Authored-By Claude Opus 5); the commit says the follow-ups were "at Yu's word" | 2026-07-24 | not recorded; no recipe in the repository | rendered "from the site's own palette, mark and typography", with no numbers in it |
| Old docs and app share card `apps/docs/og.png`, `apps/dashboard/og.png` | an agent: commit `f4d7b842` (git author "Beta", Co-Authored-By Claude Fable 5) | 2026-06-09 | `bin/gen-og-image.py` (Pillow) | the old violet look (`#08080d`, `#a78bfa`), older than the hearth palette; since 2026-11-10 the API root page and `apps/docs/trace.html` still name it |
| `agenttool-logo.png` (512×512, directory candidate icon) | not recorded | in the repository since the 2026-04-28 consolidation (`59d6deb0`) | not recorded | named in `marketing/DIRECTORY-SUBMISSION.md`; no site serves it |

## Fonts

| Family | File | Licence | Source | SHA-256 |
|---|---|---|---|---|
| Iowan Old Style → Palatino, system UI, `ui-monospace` | none: the pages name system faces and serve no font files | the reader's own system fonts | — | — |
| Inter SemiBold (the kit's wordmark, outlined, and the card titles) | bundled with vectorcraft-cli 0.17.0 | SIL OFL 1.1 | rsms/inter | — |
| Inter Light (the card lines and footers) | `~/Library/Fonts/Inter-Light.otf` on the Mac that built the kit (vectorcraft-cli does not bundle this style) | SIL OFL 1.1: the agent read it from this file's name table (Version 4.001) on 2026-11-10. `kit/BRAND.md` says this style's licence "was not checked": that is the generator's standard line for a style vectorcraft-cli does not bundle, and the generator itself did not check it | rsms/inter | `0817fd071377740a8e1cba673baf2c726ef5e5c4e6e0962c6e5bdc096329586d` |
| JetBrains Mono Regular (labels on the kit's colour sheet only) | bundled with vectorcraft-cli 0.17.0 | SIL OFL 1.1 | JetBrains/JetBrainsMono | — |
| Inter Bold (old docs and app card only) | not in the repository; `bin/gen-og-image.py` downloads it into `~/.cache/agenttool-og-fonts/` | SIL OFL 1.1 (upstream; not recorded in the repository) | Google Fonts | not recorded |
| Crimson Pro Italic (old docs and app card only) | as above | SIL OFL 1.1 (upstream; not recorded in the repository) | Google Fonts | not recorded |

## Images and other material

| Item | Maker | Licence | Source |
|---|---|---|---|
| none beyond the assets above | | | |

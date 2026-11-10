# AgentTool: brand

> **Type:** reference · **Purpose:** AgentTool's brand folder: the look, who chose it, the kit, and what each site serves from it.
> **Evidence:** `brandkit.json`, checked by `node brand/check.mjs`. Nothing in this folder is served; the sites serve copies under `apps/`.

This folder holds AgentTool's brand kit, made with storytold's Craft apps through the artcraft-brand skill (the private
repository `cambridgetcg/brandkit`). `brand.json` is the generator's input, `mark.svg` the mark it draws from, `kit/`
the built kit (never edited by hand), `brandkit.json` this project's details, and `check.mjs` the check.

## The look

The three doors share the hearth look: warm paper `#f7f3ec`, ink `#1d1a16` and one ember accent `#a8401c` by day;
charcoal `#141210`, warm ink `#eee7db` and lamp amber `#eba352` by night. Headings use Iowan Old Style (falling back
to Palatino), body text the system UI face, labels `ui-monospace`; no web fonts are loaded. Agent Saunter made the
hearth look on 2026-10-17 at Yu's request, and Yu gave the go-ahead to merge and release it (PR #490, merged as
`3b9aa630`; memory note `agenttool-ui-hearth-2026-10-17`).

The mark is the ⊙ ring and dot. The nav draws it in CSS with an ink ring and an ember dot (`apps/_shared/theme.css`,
`estate.css`); the favicon and the home card draw ring and dot in one colour. Who made it is not recorded.

Don't change the identity without its owner's word. Every asset here records who made it in `CREDITS.md`.

## The kit

Built on 2026-11-10 by an agent under Yu's go for group A of the 2026-11-02 visual-language review (items A1 and A2),
with no new mark and no new words:

- **The mark** (`mark.svg`) is the favicon's own drawing, unchanged: a ring of radius 34 and stroke 6 and a dot of
  radius 6 on a 100 grid. Its colour is the ember token `#a8401c` from `apps/_shared/theme.css`, the tokens' one
  source of truth. The inline favicons had kept older ember values when the hearth look arrived: `#b8451f` on
  9 agenttool.dev pages, and `#d4502e` (the shared accent before PR #490) on its other 8 and on every docs and app
  page that drew the ring.
- **On a dark tab** `#a8401c` reaches only 2.62:1 against Chrome's dark tab strip `#202124` (1.96:1 on the dark
  active tab `#35363A`); the old `#b8451f` and `#d4502e` reached 3.00 and 3.82:1. So `favicon.svg` carries a
  dark-scheme rule that paints the mark in the night lamp `#eba352` (7.58:1 there), the colour the pages' own night
  mode gives the accent. The PNG icons have no dark form. Choosing the night lamp for dark tabs is an agents' call
  within the site's own tokens.
- **Icons served**: `favicon-32.png`, `favicon.svg`, `apple-touch-icon.png` (180, on paper `#f7f3ec`),
  `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and `site.webmanifest` (display `browser`, so nothing new
  offers to install). The kit's `favicon.ico` is not served (see "Deploying"), so `/favicon.ico` still answers 404. The generator scales the ring to fill the icon square and hints the 16 and 32 px cuts, so the
  tab icon reads larger than the old data-URI, which drew the ring at 74% of its box.
- **theme-color** `#F7F3EC` for a light system scheme and `#141210` for a dark one: the grounds the pages paint in
  dawn and night. `mode.js` and `theme.js` follow the system scheme until a visitor picks a mode at that door; the
  meta follows the system scheme only.
- **Cards** (1200×630 PNG, on paper, the page's own words):

  | Card | Served at | Title | Line | Words from |
  |---|---|---|---|---|
  | `og/docs.png` (38,321 bytes) | `https://docs.agenttool.dev/og/docs.png` | AgentTool technical library | Contracts, examples and evidence for the operation you need. | the docs home page's `<title>` and its lead under "Find the reference." |
  | `og/app.png` (36,322 bytes) | `https://app.agenttool.dev/og/app.png` | Start or reconnect. | Verify existing access, or create an identity through the tutorial. | the app home page's heading and lead |
  | `og/app-watch.png` (42,268 bytes) | `https://app.agenttool.dev/og/app-watch.png` | Public API snapshots. Read at your pace. | Inspect the welcome, platform description and concept registry without registering. | `/watch`'s heading and lead |

  Each card's footer reads "AgentTool · agenttool.dev". The cards are set in Inter (SemiBold titles, Light lines), not
  the pages' Iowan Old Style: generator 1.8 sets a card in the wordmark's face, and Iowan is a system face that is not
  licensed for this. Generator 1.8 writes page cards only as JPEG, so `cards.sh` exports the same artboards from the
  kit's editable source (`kit/brand.vectorcraft`) as PNG into `cards/`; on the site card that export is byte for byte
  the generator's own `og.png`. The kit's default card (`kit/web/og.jpg`) is not served: agenttool.dev keeps its own
  home card.

## What each site serves

| Site | Folder | Files |
|---|---|---|
| agenttool.dev | `apps/web` | the seven icon files |
| docs.agenttool.dev | `apps/docs` | the seven icon files, `og/docs.png` |
| app.agenttool.dev | `apps/dashboard` | the seven icon files, `og/app.png`, `og/app-watch.png` |

Every page that drew the ring as a data-URI favicon now carries the lines in `head-snippet.html` (the kit's, with
`favicon-32.png` in place of `favicon.ico`): the icon links, the manifest and the theme-color pair; docs and app pages that declared no `color-scheme` gained `light dark` (they all load `mode.js`, which sets the
mode before first paint). The docs hearth pages that used the old card name `og/docs.png`, with its type, size and alt
text; app's two pages name theirs. Each page keeps its own title and description.

Left as they are, and listed in `brandkit.json`: pages with their own icon (web garden, lounge, party, porch, room and
sky; docs ai-logos, lounge, whitehack and xenia-helly), the `geometry/` pages (their route CSPs use `default-src
'none'`, which would refuse a manifest link, so `geometry/ritonavir.html` still draws the ring as a data-URI in
`#d4502e`), the pages in their own older look, and the redirect stubs `pulse` and `verify`.

The old violet card stays at `apps/docs/og.png` and `apps/dashboard/og.png`: the API root page names
`https://docs.agenttool.dev/og.png` (`api/src/services/discovery/root.ts`, held by
`api/tests/root-content-negotiation.test.ts`), `apps/docs/trace.html` keeps it with its own look, and links already
shared keep their image.

## Rebuild

```sh
cd brand
ARTCRAFT_NO_TRASH=1 python3 ~/.kingdom/tools/artcraft-brand/scripts/brandkit.py brand.json --out kit --rebuild-check
```

Then run `sh brand/cards.sh` for the PNG cards, copy the files `brandkit.json` lists under `serve` into each site
folder, and run `node brand/check.mjs` from
the repository root. It checks that every served file equals its kit file, that every listed page carries the kit's
icon links, theme colours and colour scheme, and that the kit matches `brand.json`. It is not wired into CI: that
would be a new gate, and the owner's choice. A changed card needs a new file name, because platforms cache cards by
URL.

The kit's `web/og/head-*.html` name agenttool.dev and a `.jpg` in `og:url` and `og:image`, because the generator takes
one `url` per kit and writes JPEG cards; the docs and app pages carry the same lines with their own host and the PNG.

## Deploying

**What is served stays inside the served-surface guard.** `bin/served-surface-guard.ts` (run by
`bin/tests/served-surface-guard.test.ts` in CI, and by `bin/frontend-deploy.sh` before any upload) reads PNG, SVG,
text, fonts and archives, and refuses any other binary unless `public/private-guard/served-surface.json` names that
exact file with a reason. It refused the kit's `favicon.ico` and JPEG cards (2026-11-10). Whether to list such files,
or to teach the guard to read ICO and JPEG, is the owner's decision, so the sites serve PNG cards and no ICO. Known gap
until then: `/favicon.ico` answers 404 on all three hosts, and a live check fails that one line. Browsers use the
declared `favicon-32.png` and `favicon.svg`.

Merging puts nothing on the three sites. The frontends are Cloudflare Pages direct uploads, released from clean
GitHub `main` with `bin/deploy.sh --no-migrate --no-api` (`docs/DEPLOY-PROCEDURE.md`, Phase 4), and a release needs
Yu's word for that release. A push to `main` that touches `docs/` or `api/` runs `deploy-api.yml`, which deploys the
API only when what its image bakes in differs between the live revision and `main`. After a release, run the parity
probes and the production page-policy sweep, and check each icon and card live. HTML revalidates on every request;
the zone's Browser Cache TTL must respect origin headers, or other files can hold for four hours. The old
`/favicon.ico` 404 was sent with `no-store` (doorcheck, 2026-11-09), so it is not held.

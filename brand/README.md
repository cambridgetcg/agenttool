# AgentTool: brand

> **Type:** reference · **Purpose:** AgentTool's brand folder: the look, who chose it, and where a kit would go.
> **Evidence:** `brandkit.json`, checked by `node brand/check.mjs`. Nothing in this folder is served.

This folder is the place for AgentTool's brand kit and media, made with storytold's Craft apps through the
artcraft-brand skill (the private repository `cambridgetcg/brandkit`). There is no kit yet (`kind: planned`).
`brandkit.json` records this project's details, and `check.mjs` checks them.

## The look

The three doors share the hearth look: warm paper `#f7f3ec`, ink `#1d1a16` and one ember accent `#a8401c` by day;
charcoal `#141210`, warm ink `#eee7db` and lamp amber `#eba352` by night. Headings use Iowan Old Style (falling back
to Palatino), body text the system UI face, labels `ui-monospace`; no web fonts are loaded. The mark is the ⊙ ring
and dot drawn beside the name. Agent Saunter made the hearth look on 2026-10-17 at Yu's request, and Yu gave the
go-ahead to merge and release it (PR #490, merged as `3b9aa630`; memory note `agenttool-ui-hearth-2026-10-17`). The
ring-and-dot mark is older, and who made it is not recorded.

A kit would be drawn from this look, with no new identity or mark. It waits on Yu's go for group A of the
2026-11-02 visual-language review (ledger `kingdom-visual-grammar`, A1 and A2).

Don't change the identity without its owner's word. Every asset here records who made it in `CREDITS.md`.

## What is here

| Path | What it is |
|---|---|
| `brandkit.json` | this project's details: the look and who chose it, the sites, the guards, what a deploy does, the existing cards |
| `CREDITS.md` | who made what, with fonts and their licences |
| `check.mjs` | the check, copied from brandkit; update it there, not here |

`brand.json` (the generator's input) and `kit/` (the built kit, never edited by hand) arrive with the kit. The
existing share cards stay where the sites serve them (`apps/*/og.png`); `brandkit.json` lists them under `media`.

## Rebuild

No kit yet. Once group A has its go, the kit is generated from this look:

```sh
python3 ~/.kingdom/tools/artcraft-brand/scripts/brandkit.py brand/brand.json --out brand/kit --rebuild-check
```

Then copy the kit files that `brandkit.json` lists under `serve.files` into each site folder (`apps/web`,
`apps/docs`, `apps/dashboard`), and run:

```sh
node brand/check.mjs
```

The old docs and app card is rebuilt with `python3 bin/gen-og-image.py`; the home card has no recipe in the
repository.

## How the site uses it

Three static Cloudflare Pages sites: `apps/web` (agenttool.dev, behind the apex Worker in `infra/apex-door/`),
`apps/docs` (docs.agenttool.dev) and `apps/dashboard` (app.agenttool.dev). Each page writes its own head. Today the
favicon is an inline data-URI ring on every page; there are no icon files, no webmanifest and no theme-color. A kit's
head snippet would go into each page, and its files into each site folder.

Two things to know before wiring:
- Inline `<style>` and `<script>` blocks are allowed by CSP hash. Changing one means updating `apps/<site>/_headers`
  and `infra/pages/sensitive-path-worker.js`, then running `bun test infra/pages/edge-security.test.ts`.
- `/porch`, `/watch`, `/village`, `/lounge`, `/gallery` and `/credits` on agenttool.dev serve the Pages files for
  HTML; only a request that prefers JSON reaches their API twins (`infra/apex-door/worker.js`). `site.html` takes
  every page in the three site folders (`apps/<site>/**/*.html`), so the check reads each head once there is a kit.

## Deploying

Merging this folder deploys nothing. The frontends are Cloudflare Pages direct uploads, released from clean GitHub
`main` with `bin/deploy.sh --no-migrate --no-api` (`docs/DEPLOY-PROCEDURE.md`, Phase 4), and a release needs Yu's
word for that release. A push to `main` deploys the API only when it changes what the image bakes in (`api/` and the
doctrine docs). After a release, run the parity probes and the production page-policy sweep, and check each icon and
card live. HTML revalidates on every request; the zone's Browser Cache TTL must respect origin headers, or other
files can hold for four hours.

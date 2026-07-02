# Estate dawn restyle — docs + dashboard follow the landing

**Date:** 2026-07-02 · **Approved by:** Yu ("gogogo! 信曬你啦") · **Scope decision:** whole estate goes dawn

## Goal

docs.agenttool.dev (and app.agenttool.dev, which shares the theme) adopt the landing
page's dawn/night design so the estate reads as one house: cream paper + terracotta by
day, deep navy + amber by night, with the same ☾ toggle and the same persisted
preference (`localStorage['agenttool.mode']`, `data-mode` on `<html>`).

## What changes

### 1 · `apps/_shared/theme.css` v2 — dual-mode tokens, same selectors

Every component class keeps its name and structure; only the token block and
hardcoded color literals change. Old token names stay defined (so 49 docs pages,
3 dashboard pages, and 19 embedded `<style>` blocks keep working) but map to the
landing palette:

| token (old name) | dawn (default) | night |
|---|---|---|
| `--bg` | `#faf5ec` | `#050810` |
| `--bg-soft` | `#f6efe2` | `#080c1a` |
| `--surface` | `#f3ecdf` | `#0b1020` |
| `--surface-2` | `#efe6d4` | `#0e1428` |
| `--surface-3` | `#e9ddc6` | `#131a33` |
| `--code-bg` | `#f4eddd` | `#070b16` |
| `--border` | `#e4dac7` | `#1a2136` |
| `--border-bright` | `#d6c9af` | `#263050` |
| `--text` | `#1a1612` | `#f2ede3` |
| `--text-muted` | `#5c5344` | `#9aa3ba` |
| `--text-dim` | `#a89a85` | `#6b7694` |
| `--violet` → alias of `--accent` | `#d4502e` | `#ffb347` |
| `--violet-deep` → alias of `--accent-deep` | `#b8451f` | `#e89a2f` |
| `--aurora` | `#8a3d5f` | `#ff8c69` |
| `--gold` | `#8a6c20` | `#ffd98a` |
| `--green` | `#3d7a4a` | `#7dd87d` |
| `--red` | `#a83232` | `#fb7185` |
| `--blue` | `#3d5a8a` | `#60a5fa` |
| `--yellow` | `#a07d20` | `#facc15` |
| `--accent-ink` (new) | `#faf5ec` | `#0a0d16` |

- Selectors: `:root, [data-mode="dawn"]` for dawn; `[data-mode="night"]` overrides.
- All ~35 hardcoded `rgba(...)` tints become `color-mix(in srgb, var(--token) N%, transparent)`
  so badges, callouts, step numbers, and tags follow the mode.
- Syntax highlight classes (`.kw/.str/.num/.fn/...`) become token-driven with
  dawn-legible ink values (wine/forest/olive/slate) and the existing bright night set.
- Topnav backdrop, button gradients, brand mark, `::selection`, and the body ambient
  gradient (sunwash by day, amber wash by night) all go token/color-mix driven.
- New `.toggle` pill style (same as landing) + smooth background/color transition.
- Fonts unchanged: Crimson Pro / Inter / JetBrains Mono.

### 2 · `apps/_shared/mode.js` (new)

Tiny synchronous script loaded right after the stylesheets on every themed page:
sets `data-mode` before first paint (no flash), reads/writes `agenttool.mode`
(same key as the landing), defines `flip()`, and injects the `☾ night / ☀ dawn`
pill into `.topnav .nav-actions` (fallbacks for dashboard nav variants).

### 3 · `apps/docs/docs.css`

Sidebar hover/active tints, sidebar tags, and the hero glow move from hardcoded
violet rgba to accent color-mix. Hero glow becomes the landing's sunwash.

### 4 · `apps/dashboard/style.css`

Same treatment as theme.css: dual-mode token block (its own token names kept),
hardcoded tints → color-mix. Dashboard visually joins the estate.

### 5 · Per-page mechanical edits (49 docs + 3 dashboard pages)

- Insert `<script src="/shared/mode.js"></script>` after the stylesheet links.
- Swap the violet/gold data-URI favicon for the landing's terracotta one.

### 6 · Per-page audit (workflow fan-out)

19 docs pages carry embedded `<style>` blocks; some pages carry inline styles
hand-tuned against the dark theme. Each themed page gets an agent pass to convert
hardcoded dark-era colors to tokens/color-mix so both modes render clean.

## Out of scope

- The 8 standalone art pages (cosmic-love, dark-love, gold-love, love-bomb, play,
  snake-fire-heart, ecosystem-sibling, trace) keep their own skins.
- `apps/web/` (the landing) is the reference; not edited.
- No markup restructure, no font change, no content edits.

## Verification & deploy

1. Serve locally; screenshot key pages in dawn + night; agent review of images for
   contrast/breakage; fix findings.
2. Check the 3 dashboard pages the same way.
3. `bin/frontend-deploy.sh docs dashboard` (Cloudflare Pages direct upload).
4. Live check docs.agenttool.dev + app.agenttool.dev in both modes.

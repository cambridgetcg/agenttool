# apps/_shared

Shared design assets for the three agenttool frontends — `agenttool.dev`
(open door), `docs.agenttool.dev` (docs), and `app.agenttool.dev`
(dashboard).

## Files

| File | Purpose |
|---|---|
| `theme.css` | Design tokens, base reset, typography, navigation, footer, components (buttons, callouts, code blocks, params tables, endpoint blocks, surface/shape tiles, step lists, forms). |
| `theme.js` | Small dawn/night controller for the open-door pages; follows the system preference, persists an explicit choice, keeps the toggle state accessible, and progressively loads the estate atlas. |
| `mode.js` | Dawn/night controller for docs and the agents-only app; also progressively loads the estate atlas. |
| `estate.js` | The eight-door room registry, the library (every docs page shelved under its door), the floor plan (eight rooms around one courtyard, the current room lit), the shared breadcrumb, searchable room atlas, generated docs sidebar, nearby exits, and homepage map. Navigation changes location only; it grants no authority. |
| `estate.css` | Cross-surface shell, atlas, room-map, responsive, contrast, and reduced-motion styles. |
| `nav.html` | Canonical top-nav markup. Copy into every page; set `class="active"` on the matching link. |
| `footer.html` | Canonical footer markup. |

## How it travels

Each app folder symlinks `shared/` to this directory:

```
apps/
├── _shared/                  ← real files live here
│   ├── theme.css
│   ├── theme.js
│   ├── mode.js
│   ├── estate.css
│   ├── estate.js
│   ├── nav.html
│   ├── footer.html
│   └── README.md
├── web/
│   └── shared → ../_shared   ← symlink
├── docs/
│   └── shared → ../_shared   ← symlink
└── dashboard/
    └── shared → ../_shared   ← symlink
```

Most docs pages and all dashboard pages load `/shared/theme.css` and
`/shared/mode.js`. The web pages keep their page-specific `/style.css` and
navigation markup while loading `/shared/theme.js`. Both appearance scripts
progressively load `/shared/estate.js`; older docs pages without an appearance
script load the estate script directly. Wrangler follows the symlink during
direct upload, so every shared file remains available on each Cloudflare Pages
origin.

A shared-file change reaches the pages that load that file; it is not a runtime
HTML include or a replacement for room-specific styles. Existing static links
remain the no-JavaScript fallback. Keep the JavaScript door IDs aligned with
`apps/web/welcome.json` so human and machine arrival maps name the same house.

## Fonts

Most docs pages and all dashboard pages include their Google Fonts `<link>`
directly; some docs use a surface-specific subset. Web pages use their own CSS
and system-font fallbacks. Shared CSS does not import Google Fonts. A common
docs/dashboard set is:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

## Deploying

See `bin/frontend-deploy.sh`.

## The library and the floor plan

`estate.js` carries two registries: `DOORS` (the rooms of the house across all
three surfaces) and `LIBRARY` (every page of `docs.agenttool.dev`, assigned to a
door and a shelf). On any docs page with an `aside.sidebar`, the script hides the
hand-copied list (kept as the no-JavaScript fallback) and renders the library
from the registry: current door open, the others folded, current page marked.
Add a new docs page by adding one line to `LIBRARY`; the sidebar, the atlas, and
the breadcrumb follow.

One shell everywhere: a page with a `nav.site-nav` or `nav.topnav` is enhanced
in place; a page with no nav of its own gets `nav.estate-bar`, the same brand,
breadcrumb, Home · Docs · Rooms and toggle, fixed and styled by estate.css
alone. Load `/shared/mode.js` synchronously in `<head>` on such a page — it
marks the document `estate-arriving` before first paint so estate.css can
reserve the bar's height, and nothing jumps when the bar appears. The static
no-JS `.nav-actions` on docs pages should match `nav.html` exactly; the atlas
replaces them when scripts run, but they are what a no-JS visitor sees.

The floor plan is drawn in code (inline SVG, palette tokens, reduced motion
honoured). Pages whose `_headers` block sets `script-src 'none'` — LOVE BOMB and
the geometry lessons — are quiet by design: reached through the library, never
enhanced by it.

# apps/_shared

Single source of truth for the design system across the three agenttool
frontends — `agenttool.dev` (open door), `docs.agenttool.dev` (docs), and
`app.agenttool.dev` (dashboard).

## Files

| File | Purpose |
|---|---|
| `theme.css` | Design tokens, base reset, typography, navigation, footer, components (buttons, callouts, code blocks, params tables, endpoint blocks, surface/shape tiles, step lists, forms). |
| `theme.js` | Small dawn/night controller for the open-door pages; follows the system preference, persists an explicit choice, and keeps the toggle state accessible. |
| `nav.html` | Canonical top-nav markup. Copy into every page; set `class="active"` on the matching link. |
| `footer.html` | Canonical footer markup. |

## How it travels

Each app folder symlinks `shared/` to this directory:

```
apps/
├── _shared/                  ← real files live here
│   ├── theme.css
│   ├── theme.js
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

Every HTML page loads `/shared/theme.css` from its own origin. Wrangler
follows the symlink during direct upload, so the file is real on
Cloudflare Pages.

Edit a single file here and all three sites pick it up on the next
deploy.

## Fonts

The pages each include the Google Fonts `<link>` directly. We don't
import fonts from CSS to avoid the extra round-trip on first paint:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

## Deploying

See `bin/frontend-deploy.sh`.

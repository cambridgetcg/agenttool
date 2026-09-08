# Local UI review screenshots

Captured from the uncommitted working-tree candidate on 4158738a77df58d3224b70d397839df817099de7. These are local fixture views, not production screenshots. API requests return an intercepted 503, outside requests and fonts are blocked, and no bearer or payment was entered.

- [ui-app-desktop.png](ui-app-desktop.png) — Start or reconnect: empty labelled verification form and recovery paths.
- [ui-app-mobile.png](ui-app-mobile.png) — Start or reconnect at 390 CSS pixels: first task choices.
- [ui-tutorial-mobile-hashes.png](ui-tutorial-mobile-hashes.png) — Canonical tutorial at 390 CSS pixels: artifact hash wraps while its bytes remain intact.
- [ui-credits-resting.png](ui-credits-resting.png) — Initial credits state: new checkout is resting; earlier gift recovery remains available.

Exact source file hashes, dimensions, scroll position and screenshot hashes: [ui-screenshots.json](ui-screenshots.json).

Final checks: primary text contrast is at least 4.95:1 in dawn and 8.40:1 in night; rendered app door labels also pass 4.5:1. Focused keyboard/navigation and 390px reflow checks passed. Shared assets use release queries and revalidate without exceeding the 100-rule docs budget. These are spot checks, not a complete accessibility audit.

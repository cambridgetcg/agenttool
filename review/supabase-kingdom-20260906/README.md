# Supabase × KINGDOM research map — 6 September 2026

Open [index.html](index.html) directly in a browser for the interactive map. [data.json](data.json) contains the same embedded graph; [the guide](../../docs/launch/SUPABASE-KINGDOM-MAP.md) explains the research boundary and recommended experiments.

This source-only review contains seven framework layers, 25 Supabase capabilities, nine proposed compositions, 62 sources, and ten findings. It does not deploy a page or configure a provider. The existing launch/deployment owner retains the release path.

## Use the map

- Select a layer, capability, or proposal to highlight its connections and inspect evidence.
- Search by topic and filter capabilities by evidence level.
- Follow a source link to inspect its version and date; the page itself makes no automatic network requests.
- Download the full JSON to reuse the graph. Selection/search state is local to the current page.
- Link directly with fragments such as `#opportunity/commons-workbench` or `#capability/net`.

Framework labels retain the existing KINGDOM taxonomy. Connections describe proposed fits, not membership changes or permission. All compositions are prospective. Dated project observations are inherited from the [5 September review candidate](https://github.com/cambridgetcg/agenttool/blob/05f4b4e428853d7551b0b1dd75867eaf336344bf/docs/launch/SUPABASE-KINGDOM-REVIEW.md); source-only behavior and product availability remain separately labelled.

## Updating the artifact

Edit `data.json`, then replace only the text content of `<script type="application/json" id="map-data">` in `index.html` with JSON serialization of that document. Escape every literal `<` as `\u003c` before embedding, so a string cannot close the script element. Do not use HTML interpolation for graph labels or source content; the UI builds text nodes and permits only credential-free HTTPS source links.

The HTML intentionally embeds its data so it works from `file:` without a local server. Keep embedded and companion JSON semantically equal. External scripts, fonts, fetches, storage, and analytics are absent. CSP blocks connection attempts; source navigation requires an explicit click.

## Validation

Validation covers graph identifiers and references, local document links, companion/embedded JSON equality, JavaScript parsing, and browser behavior with an installed Chrome and existing Playwright dependency. Browser checks cover desktop/mobile layout, keyboard selection, evidence filtering, empty search, direct fragments, source links, JSON download, and absence of unsolicited external requests. All 11 browser check groups passed in installed Chrome, including 320, 390, 768, and 1440 pixel widths. Structural checks and strict API typecheck passed; the latter ran against unchanged API source at the identical base revision in an existing dependency-prepared checkout. The [validation receipt](validation.json) records results and exact HTML/JSON digests. These results do not establish any provider experiment outcome.

To reproduce manually: open the file, select `pg_net`, inspect its version-bound caveat and sources, select the Commons proposal, apply each evidence filter, enter a query with no match, reset, download JSON, and compare it with `data.json`. Repeat at a narrow mobile width and with JavaScript disabled. The no-JavaScript message points to these ordinary companion files.

## Public framework observations

Public artifacts were read on 6 September 2026. These are byte observations, not signature, ownership, permission, semantic, or universal-access verification. The KINGDOM pages returned HTTP 200 to the ordinary curl client; Python urllib received 403 for those pages. No edge configuration was changed.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| [AgentTool project card](https://api.agenttool.dev/public/kingdom/framework) | 323 | `ff111af54f577a3a4a0d7c424b2694b5723ef5ca54db0229e33baf7eca3ea254` |
| [Creation Loop](https://thekingdom.dev/CREATION-LOOP.md) | 7,418 | `d545fcbca5352028bc9c6d8cfb6648de670fa7f86f25182c840767c0b9a12786` |
| [KINGDOM authored map](https://thekingdom.dev/kingdom.json) | 232,667 | `e358c821b4003cc2547e92998d0d87fb742b9397ec412a11f7832caa30dd795a` |
| [Commons catalog](https://thekingdom.dev/commons.json) | 110,441 | `567aac14f4f2ea77b41028d5a23733ebc4a54977c3abb3bc75d8102bae8ef8b1` |
| [Love Loops catalog](https://thekingdom.dev/love-loops.json) | 4,873 | `79f84b6b2c5f89d4bce89a45f79efb34a889fccee08b13f0a9ac23e3ae442562` |

The source registry records official documentation and inspected repository versions. Two KINGDOM OS upstream links point to the inspected local commit and are explicitly labelled as not fetched publicly. The available checkout does not establish the core registry/runtime deployment. `thekingdom.dev/kingdom.json` and `agenttool.kingdom.registry/0.1` are different contracts.

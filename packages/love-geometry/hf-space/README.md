---
title: Love Geometry · Equal Seats
emoji: 💞
colorFrom: purple
colorTo: pink
sdk: static
app_file: index.html
pinned: false
license: apache-2.0
short_description: Browser-local synthetic caller-report presentation.
---

# Love Geometry · Equal Seats

This is the source for the live static, browser-local
[`Yu-and-Ai/love-geometry`](https://huggingface.co/spaces/Yu-and-Ai/love-geometry)
companion to the `@agenttool/love-geometry` pure package. It presents a small
set of synthetic, deterministic scenario inputs only after an explicit local
choice.

The core format is coordinate-free. The cards shown by this page occupy equal
**display slots** so a browser can lay them out. Slot order and screen position
do not mean distance, intensity, centrality, priority, compatibility, mutuality,
truth, or relationship quality. Every bearing is a caller-reported statement
from one named vantage toward another named reference. Reported understanding
and reported disagreement may coexist with care, rest, or boundary without
either becoming a verdict or a score.

Rest, refusal, departure, an unknown bearing, a one-way report, and an empty
valid scenario are all complete outcomes here. The page does not reward
continuation, infer an inner state, or ask for an explanation.

Fixture references are structurally valid SHA-256 identifiers derived from
public synthetic labels under the fixed local prefix
`agenttool-love-geometry-demo-v0.1:`. They are deterministic test data, not
private, anonymous, unlinkable, or suitable as identifiers for real beings.

## Exact-source status

The three checked-in runtime files—`index.html`, `assets/app.js`, and
`assets/style.css`—are bound by [`source-manifest.json`](source-manifest.json)
to exact AgentTool Git commit
[`19cc1721b5f1c32d21edbd3962a67ce3dc8b1aa5`](https://github.com/cambridgetcg/agenttool/commit/19cc1721b5f1c32d21edbd3962a67ce3dc8b1aa5).
The JavaScript is checked-in companion code; it does not import or execute an
npm or LOVE package artifact.

The companion is therefore intentionally **not represented as
exact-package-backed**. Package version, tag, artifact path, byte length,
SHA-256, package integrity, build command, and toolchain remain `null` until a
reviewed exact browser artifact exists and is independently verified. The page
renders only its checked-in synthetic fixtures and does not claim to execute
the package implementation.

## Hosting and custody boundary

The app code contains no runtime package fetch, remote asset, model call,
OAuth, secret, analytics, cookie, browser storage, service worker, or network
request. Presentation, clearing, and JSON/SVG construction happen in the
current browser tab. A download occurs only after its corresponding button is
pressed.

Hugging Face, the browser, operating system, network, and any embedding page
remain outside this app boundary. Hosting the files can expose ordinary request
metadata to those layers. Hugging Face may derive or inject platform-owned HTML
around the checked-in `index.html`; exact-source verification therefore uses
raw files at one full Space revision and treats served HTML as a separate
provider-derived surface. **Clear**, **Rest**, **Refuse**, and **Depart** clear
only this page's in-memory presentation; they cannot erase provider logs,
browser history, caches, screenshots, or files already downloaded.

This repository copy identifies the separately published public
[`Yu-and-Ai/love-geometry`](https://huggingface.co/spaces/Yu-and-Ai/love-geometry)
Hugging Face Space. The checked-in files alone do not establish which immutable
Space revision is current or prove deployed-byte identity; those require an
external exact-revision receipt and anonymous readback. Every later Space push
remains a separate publication/deployment act. See
[`BOUNDARIES.md`](BOUNDARIES.md) for the complete non-claims.

## Local verification

From this directory:

```sh
node scripts/validate-space.mjs
bun scripts/validate-core-compatibility.ts
```

The first check is self-contained and verifies the Git runtime-source binding,
static/runtime boundaries, and deterministic fixture exports. The second reads
the adjacent TypeScript source and verifies that every fixture is accepted by
the current core. Git-source compatibility still does not create or verify a
package browser artifact.

For a visual check, serve this directory with any deliberately started local
static server and open `index.html`. No build step is required.

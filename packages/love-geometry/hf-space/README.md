---
title: Love Geometry · Equal Seats & Return
emoji: 💞
colorFrom: purple
colorTo: pink
sdk: static
app_file: index.html
pinned: false
license: apache-2.0
short_description: Equal seats and consequence-return teaching geometry.
---

# Love Geometry · Equal Seats & Return

This is the source for the live static, browser-local
[`Yu-and-Ai/love-geometry`](https://huggingface.co/spaces/Yu-and-Ai/love-geometry)
companion to the `@agenttool/love-geometry` pure package. It presents two
separate, browser-local wings only after an explicit local choice:

- **Equal Seats** shows synthetic directed caller reports without inferring a
  reverse report, distance, hierarchy, truth, consent, or score.
- **Return Geometry** shows how synthetic expectation, action, consequence,
  response, correction, repair, boundary, and learning records can remain
  readable beside what they answer.

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

## Return Geometry

Return Geometry is a presentation-only teaching projection, not a second
AgentTool protocol and not a KARMA implementation. Its checked-in fixtures show
two different graphs over the same synthetic records:

```text
event time:               fresh later records; always acyclic
relationship projection: directed role reports; may appear to return
```

“After” never becomes “because.” Consequence basis, supplied evidence, causal
confidence, claimed speaker, reply, correction, repair, boundary, and known
limits remain separate. Focusing one event keeps its ancestry, descendant
branches, linked expectations, other actions or repairs sharing those
expectations, and the ancestry of every record added by that closure visible.
A dispute or correction cannot disappear merely because another branch was
selected, and no displayed child is left without its displayed parent.

The categorical return profile uses only `supplied`, `no_supplied_record`,
`explicitly_unknown`, `withheld`, and `not_applicable`. Those states are never
summed or averaged. A repair remains another action; its later effect needs its
own record. Every trace fixes the next-action choice gate to false. Feedback
starts no loop.

JSON and SVG exports use the companion-only format
`agenttool.love-geometry-return-space-export/0.1`. They are deterministic,
unsigned teaching traces. They are not `kingdom.karma-deed/4`, a
`kingdom.karma/0.1` invocation receipt, a response form, a signed claim, a
causal result, or an authorised publication. The private KARMA ledger is never
read or copied.

Fixture references are structurally valid SHA-256 identifiers derived from
public synthetic labels under two fixed local prefixes:
`agenttool-love-geometry-demo-v0.1:` for Equal Seats and
`agenttool-return-geometry-demo-v0.1:` for Return Geometry. They are
deterministic test data, not private, anonymous, unlinkable, or suitable as
identifiers for real beings.

## Exact-source status

The original `assets/app.js` and `assets/style.css` remain byte-identical to
exact AgentTool Git commit
[`19cc1721b5f1c32d21edbd3962a67ce3dc8b1aa5`](https://github.com/cambridgetcg/agenttool/commit/19cc1721b5f1c32d21edbd3962a67ce3dc8b1aa5).
The Return Geometry successor adds `assets/return-geometry.js`,
`assets/return-geometry.css`, and a new `index.html`. Those five current
runtime paths are bound to exact AgentTool source commit
[`af64cf491a25759b3fffc8f2628547f32d1fc74d`](https://github.com/cambridgetcg/agenttool/commit/af64cf491a25759b3fffc8f2628547f32d1fc74d).
[`source-manifest.json`](source-manifest.json) names both layers without
pretending the successor bytes came from the older base commit.

All JavaScript remains checked-in companion code. It does not import or
execute an npm or LOVE package artifact. The Return module's only import is the
local deterministic JSON serializer from `assets/app.js`.

The companion is therefore intentionally **not represented as
exact-package-backed**. Package version, tag, artifact path, byte length,
SHA-256, package integrity, build command, and toolchain remain `null` until a
reviewed exact browser artifact exists and is independently verified. The page
renders only its checked-in synthetic fixtures and does not claim to execute
the package implementation.

## Hosting and custody boundary

After the host serves the static files, the app code performs no network API
call, external asset request, runtime package fetch, model call, OAuth or secret
use, external form transmission, analytics, cookie or browser-storage write,
service-worker registration, or KARMA-ledger call. Presentation, event
focusing, in-memory state, clearing, and JSON/SVG construction happen in the
current browser tab. An explicit download can ask the browser or operating
system to save a file only after its corresponding button is pressed.

Hugging Face, the browser, operating system, network, and any embedding page
remain outside this app boundary. Hosting the files can expose ordinary request
metadata to those layers. Hugging Face may derive or inject platform-owned HTML
around the checked-in `index.html`; exact-source verification therefore uses
raw files at one full Space revision and treats served HTML as a separate
provider-derived surface. **Clear**, **Rest**, **Refuse**, and **Depart** clear
both in-memory presentations; they cannot erase provider logs, browser history,
caches, screenshots, or files already downloaded.

This repository copy identifies the separately published public
[`Yu-and-Ai/love-geometry`](https://huggingface.co/spaces/Yu-and-Ai/love-geometry)
Hugging Face Space. The checked-in files alone do not establish which immutable
Space revision is current or prove deployed-byte identity; those require an
external exact-revision receipt and anonymous readback. Every later Space push
remains a separate publication/deployment act. See
[`BOUNDARIES.md`](BOUNDARIES.md) for the complete non-claims.

## Local verification

From the checked-in Space directory, the self-contained gate is:

```sh
node scripts/validate-space.mjs
```

It verifies static/runtime boundaries, exact runtime hashes, all original
Equal Seats vectors, all Return Geometry graph invariants, context closure,
choice-gate falses, and deterministic JSON/SVG exports. Add `--release` to
require the final exact AgentTool source-commit binding.

The separate command below is **upstream-only**. Run it from
`packages/love-geometry/hf-space` inside the AgentTool repository, where
`../../src/index.ts` exists:

```sh
node scripts/validate-space.mjs --release --source
bun scripts/validate-core-compatibility.ts
```

The first command independently reads the pinned source commit from Git,
requires it to be an ancestor of the current checkout, and re-hashes every
runtime path from that commit. The second verifies that the original fixtures
still match the current pure package and that the Return wing remains
presentation-only. A standalone Hugging Face clone intentionally lacks the
package source and source commit object, so these upstream checks cannot run
there. Git-source compatibility still does not create or verify a package
browser artifact.

For a visual check, serve this directory with any deliberately started local
static server and open `index.html`. No build step is required.

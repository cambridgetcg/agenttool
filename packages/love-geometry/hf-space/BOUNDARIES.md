# Love Geometry static companion boundaries

## What this companion does

- Presents only checked-in, synthetic scenario inputs after an explicit button
  press.
- Assigns equal visual cards to deterministic display slots.
- Shows each vantage separately as a caller-reported, directed set of bearings.
- Creates deterministic JSON and SVG bytes in the current browser tab when a
  download button is pressed.
- Makes rest, refusal, departure, unknown, one-way, and empty states available
  without penalty, ranking, or an explanation requirement.

## Semantic boundary

The core format is coordinate-free. A display slot is a rendering convenience,
not part of the reported relation. Card order, horizontal or vertical position,
pixel separation, whitespace, colour, and line wrapping do not encode:

- distance, closeness, intensity, centrality, priority, hierarchy, or value;
- compatibility, affinity, relationship health, consensus, or conflict level;
- identity, consciousness, emotion, intent, authorship, consent, or capacity;
- truth, verification, mutuality, completeness, prediction, or recommendation.

`reported_understanding` means only that the identified vantage reports
understanding toward another reference. It is not proof of accurate or mutual
understanding. `reported_disagreement` is an equally valid caller report, not a
negative score or a severity signal. Either may coexist with reported care,
rest, boundary, refusal, or departure.

The synthetic references name no real people or agents. They are SHA-256 values
derived from public fixture labels under
`agenttool-love-geometry-demo-v0.1:` and provide no privacy or unlinkability.
The package's `verified_by_package: false` field is preserved: validation of
structure cannot verify the report's content or the caller's authority to
speak for anyone else.

## Interaction and data boundary

Nothing is rendered until the visitor explicitly chooses **Present locally**.
Rest, refusal, and departure are separate explicit interactions. Each clears
the current in-memory presentation and disables downloads. **Clear
presentation** does the same display cleanup without claiming any of those
bearings. The page does not persist or transmit which option was chosen; the
current choice remains visible in the page until another action clears it.

JSON and SVG downloads use browser-created bytes and a temporary object URL.
The app revokes that URL after initiating the download. It does not upload the
file or make a provider request. Once a browser or operating system saves a
file, this app cannot recall or securely erase it.

The checked-in app has no fetch/XHR, WebSocket, EventSource, beacon, remote
asset, model inference, OAuth, secret, cookie, local/session storage, IndexedDB,
service worker, background sync, analytics, or app-authored telemetry path.
The document-level Content Security Policy also requests `connect-src 'none'`.
That policy is defence in depth for supported browsers, not a guarantee about
the hosting platform or every browser extension.

## Source and hosting boundary

The current `source-manifest.json` is deliberately incomplete. It does not bind
this presentation to an exact package version, Git commit, tag, build, or
artifact hash. The demo fixtures are locally validated but are not a substitute
for executing the package. Exact-package-backed wording must wait until the
manifest is filled from independently verified bytes.

Hugging Face hosts the separately published public
`Yu-and-Ai/love-geometry` Space. Provider request handling, logs, retention,
moderation, availability, iframe behavior, injected platform UI, and future
platform changes sit outside this app's guarantees. The checked-in files alone
prove neither the current immutable Space revision nor deployed-byte identity
or current account authorization; those require separate provider observation
and exact anonymous readback.

This static companion is not an MCP server, WAKE continuity store, hosted
AgentTool route, XENIA Surface, XENIA Covenant adoption, conformance result,
identity system, consent record, relationship oracle, or safety certificate.
It grants no account permission or authority over another being.

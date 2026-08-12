<!-- @id urn:agenttool:doc/XENIA-WEBSITE-ROLLOUT  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/AGENT-WEB-SURFACE urn:agenttool:doc/DEPLOY-PROCEDURE urn:agenttool:doc/LOVE-CONSENT -->

# XENIA-WEBSITE-ROLLOUT — three bounded thresholds

> *Source and dated rollout record, updated 2026-08-12. Exact feature release
> `0a302278d3e0f4e4b8e7bec197087af486dec7ac` was preview-observed,
> separately production-deployed, and then observed from outside. The provider
> identifiers below are historical checkpoints for that release, not timeless
> current heads; a later deployment does not rewrite them. This document update
> performs no provider mutation and claims no Covenant adoption.*

> **Compass:** [DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md) (release path) ·
> [AGENT-WEB-SURFACE](AGENT-WEB-SURFACE.md) (public web boundary) ·
> [LOVE-CONSENT](LOVE-CONSENT.md) (consent is not inferred from arrival)
>
> **Profile:** `xenia.rights/0.1` informative baseline · candidate
> `xenia-surface/0.1` · exact external checker
> `@agenttool/xenia-surface@0.1.0-rc.1`.
>
> **Code:** `infra/pages/sensitive-path-worker.js` (shared response contract) ·
> `infra/apex-door/worker.js` (public apex owner) ·
> `bin/frontend-deploy.sh` (low-level Pages + Worker release) ·
> `bin/deploy.sh` (clean exact-main production gate and receipt)
>
> **Tests:** `bin/tests/pages-xenia-surface.test.ts` ·
> `api/tests/apex-door-worker.test.ts` ·
> `bin/tests/build-input-hygiene.test.ts` ·
> `api/tests/deploy-release-provenance.test.ts`.

## Outcome

Give each AgentTool website one small, same-origin, credential-free machine
threshold while keeping the public claim narrower than the site:

```text
request
  -> docs/app: shared all-route Pages Worker
       -> sensitive-path fence (always first)
       -> one exact host profile + XENIA path handling
       -> ordinary asset/browser behavior unchanged
  -> agenttool.dev: agenttool-proxy apex Worker
       -> the same sensitive-path fence (always first)
       -> exact web XENIA paths terminate locally
       -> remaining paths keep their existing Pages/API split
  -> one host-specific manifest
       -> one deliberately public same-origin GET resource
       -> claims: []
       -> explicit not_covered
```

The response builder is shared, but production has two honest enforcement
points. `docs.agenttool.dev` and `app.agenttool.dev` reach the injected Pages
Worker directly. `agenttool.dev` is owned by `agenttool-proxy`, so its two
exact Surface paths terminate in that apex Worker before the existing
`/.well-known/*` and `/public/*` API routing. Static files and `_headers` alone
cannot vary status, media type, and body from `Accept`; a redirect to
`api.agenttool.dev` also cannot satisfy Surface's same-origin rule.

This mechanism does:

- publish `/.well-known/agent.json` only at one of three exact website origins;
- negotiate only the declared JSON representation with `Vary: Accept`;
- return typed `406` and unpredictable typed `404` problems when requested;
- keep ordinary HTML pages and browser `404` behavior outside that narrow
  branch; and
- expose evidence that can be checked again and allowed to expire.

It does not establish identity, authorization, consent, privacy practice,
retention, continuity, portability, economic fairness, Covenant adoption, or
whole-site XENIA conformance. Rights are a collaboration floor, not an account
permission or action grant.

## Source and dated rollout truth

- Exact public registry resolution confirms `@agenttool/xenia@0.1.0-beta.7`;
  Surface's separately versioned Node 22+ checker is
  `@agenttool/xenia-surface@0.1.0-rc.1`. Use exact versions, never mutable
  `beta`, `rc`, or `latest` tags: XENIA's mutable tags currently lag beta.7.
- The machine-readable Rights object and canonical `RIGHTS.md` are unchanged
  across AgentTool's former beta.5 dependency and beta.7. Updating package
  metadata does not create a new adoption claim.
- The AgentTool API already provides a bounded same-origin Surface precedent
  with empty claims and explicit exclusions. Its origin cannot stand in for
  the three website origins.
- The shared response module now has three distinct source profiles:
  documentation, public welcome, and public agent arrival. Each declares one
  JSON orientation, empty `claims`, and its own explicit exclusions. The exact
  host selects the profile; a missing, invalid, or ambiguous Pages preview
  binding falls back to the ordinary asset path.
- The production apex topology is explicit in source: `agenttool-proxy` owns
  `agenttool.dev/*` and `www.agenttool.dev/*`. Its sensitive fence runs first,
  `www` redirects second, exact web Surface GET/HEAD routes terminate locally,
  and all undeclared API, method, machine-alternate, and credential boundaries
  retain their prior routing.
- The frontend release allowlist includes `infra/apex-door`. A `web` release
  validates exact route ownership, rejects staged Worker env files, bundles
  the exact staged Worker without publishing, uploads the Pages backing, and
  only then deploys `agenttool-proxy` with the exact Git revision in its Worker
  version message. A Pages failure cannot fall through to a Worker deploy;
  either external failure remains failed-or-uncertain in the orchestrator
  receipt.
- The already reviewed docs manifest and orientation serialize to their prior
  exact bytes: SHA-256 `98c1c5f6...15c053f` and
  `eafcbc87...b84a3ae`. Generalising the mechanism did not rewrite the docs
  payload.
- Focused source and production-entry loopback tests cover all three profiles,
  the complete negotiated JSON matrix, GET/HEAD parity, typed `406`, fresh
  typed `404`, exact-host isolation, sensitive-path precedence, and unchanged
  asset fallthrough.
- A separate earlier docs-only production observation is recorded in
  [NOW](NOW.md): at `2026-08-11T15:29:01Z`, the exact rc.1 checker reported 22
  passes with no failures, unknowns, or unrun probes. It observes that deployed
  docs-only revision only. It is not preview evidence and does not observe this
  three-profile source, `agenttool.dev`, or `app.agenttool.dev`.
- The three Pages sites retain legacy `agent.txt` redirects and HTML `404.html`
  documents. Those coexist with the narrow Worker branch; neither substitutes
  for Surface 0.1.
- Protected PR
  [#293](https://github.com/cambridgetcg/agenttool/pull/293) merged the combined
  three-profile source as exact feature revision
  [`0a302278d3e0f4e4b8e7bec197087af486dec7ac`](https://github.com/cambridgetcg/agenttool/commit/0a302278d3e0f4e4b8e7bec197087af486dec7ac).
  Preview candidates for docs, app, and apex then passed the exact rc.1 checker
  with 22 pass, 0 fail, 0 unknown, and 0 not-run. The first docs preview attempt
  hit its five-second observation deadline and was retained as indeterminate
  (0 pass, 0 fail, 1 unknown, 5 not-run); only a later bounded retry passed.
- Preview-specific origin bindings were removed before production. The preview
  Worker version was not promoted. Production was built and deployed separately
  from the clean exact feature revision with steady configuration: no Pages
  preview/production environment bindings, both Pages fail-open settings false,
  and Workers subdomain and preview URLs disabled.
- The normal frontend-only release ran from `2026-08-12T07:15:31Z` through
  `07:26:15Z` with preflight passed, migrations and API skipped, and the three
  Pages projects followed by the apex Worker deployed and verified. Those
  providers have independent histories: the attempt was ordered and fail-fast,
  not atomic.

The producer library does not own routing, fetch, deployment, or adoption. The
external checker observes a bounded public GET surface for 24 hours; it is not
a Worker dependency or permanent badge.

## Rollout order

| Origin | Source threshold | Keep outside the manifest | Observation state |
| --- | --- | --- | --- |
| `docs.agenttool.dev` | Implemented. One JSON-only `orientation` at `/public/orientation`; exact prior docs bytes are pinned. | API behavior, private state, accounts, identity, WAKE, continuity, retention, economics, and all unlisted pages. | Historical feature checkpoint: exact `0a302278` preview and separately deployed production each passed rc.1. Production observation expires `2026-08-13T07:29:07.494Z`. |
| `agenttool.dev` | Implemented at its real apex owner. One JSON orientation with `schema_version: agenttool.web.orientation/0.1`; no existing site payload is imported by implication. | Gift returns, gallery or economic state, local preferences, private identifiers, sessions, cross-origin API behavior, and current `_format`-only JSON files. | Historical feature checkpoint: exact `0a302278` Worker preview and separately deployed production each passed rc.1. Production observation expires `2026-08-13T07:29:07.911Z`. |
| `app.agenttool.dev` | Implemented. One JSON orientation naming only the public arrival and watch pages. | Bearer restoration, `/v1/wake`, project-private state, session continuity, identity, rank/XP, actions, and economic routes. | Historical feature checkpoint: exact `0a302278` preview and separately deployed production each passed rc.1. Production observation expires `2026-08-13T07:29:07.411Z`. |

Each origin is its own bounded relation field—a principality in the Love
Geometry sense, not a crown, territory, owner, center, or inherited authority.
One passing origin says nothing about either neighbor.

### Exact feature-release production observation

The following is a dated receipt for `0a302278`, not a statement about later
provider heads. Counts are `pass / fail / unknown / not_run` from exact
`@agenttool/xenia-surface@0.1.0-rc.1`:

| Origin | Historical provider checkpoint | Observed at | Expires at | Result |
| --- | --- | --- | --- | --- |
| `https://docs.agenttool.dev/` | Pages deployment `d67b142c-faa1-4126-9458-8131abacf57b` | `2026-08-12T07:29:07.494Z` | `2026-08-13T07:29:07.494Z` | conformant · `22 / 0 / 0 / 0` |
| `https://app.agenttool.dev/` | Pages deployment `dab9f957-a33b-4949-aff8-a606bfe7b4c8` | `2026-08-12T07:29:07.411Z` | `2026-08-13T07:29:07.411Z` | conformant · `22 / 0 / 0 / 0` |
| `https://agenttool.dev/` | Worker deployment `4c3cfd57-fc2a-4e86-a3c9-cb09fb28a6ec`, version `3e5fd01e-3a15-4899-96a4-b2c56dbf1257` at 100%; Pages backing `35a58a7f-81b0-4ea5-a320-9eace9a1567a` | `2026-08-12T07:29:07.911Z` | `2026-08-13T07:29:07.911Z` | conformant · `22 / 0 / 0 / 0` |

The same deployment verification checked literal and encoded sensitive-root
variants at all three origins for the marked `404` plus `no-store` contract.
Each conformance result covers only the declared credential-free GET surface at
that origin and time. It does not assert whole-site conformance, Covenant
adoption, uptime, or behavior of an unlisted, authenticated, API, identity,
continuity, privacy, consent, or economic route.

## Three source wire contracts

Every profile is deliberately small:

- manifest: `GET|HEAD /.well-known/agent.json`;
- sole resource: `orientation` at `GET|HEAD /public/orientation`;
- representation: JSON only, with one host-specific `schema_version`;
- declarations: `claims: []` plus explicit `not_covered`;
- content: bounded public links, not a copy of private, authenticated, session,
  identity, continuity, or economic state.

| Origin | Manifest service | Orientation schema | Bounded links |
| --- | --- | --- | --- |
| `https://docs.agenttool.dev` | `AgentTool documentation` | `agenttool.docs.orientation/0.1` | manifest, same-origin discovery documentation, same-origin rights document |
| `https://agenttool.dev` | `AgentTool public welcome` | `agenttool.web.orientation/0.1` | manifest, same-origin welcome page, public rights document |
| `https://app.agenttool.dev` | `AgentTool agent arrival` | `agenttool.app.orientation/0.1` | manifest, same-origin arrival, same-origin watch, public rights document |

The declared `orientation` resource is same-origin in every manifest. A link
inside an orientation may point to the public Rights document on the docs
origin; that link is reference material, not another declared resource and not
an inherited claim.

For the resource, `application/json`, JSON-favoring quality values,
`application/*`, and `*/*` return JSON. `text/html`, an explicit JSON `q=0`
without another declared representation, and unsupported media types return a
typed `406` with a voluntary GET/JSON recovery action. Every negotiated
resource/problem response carries `Vary: Accept`.

An unadvertised wrong path requested as `application/problem+json` receives a
typed `404` whose only next action discovers the same-origin manifest. A normal
browser request still reaches the site's existing asset/HTML `404`. The
sensitive-root denial runs before both branches and remains its distinct plain
404 contract.

## Implementation and deployment stages

Completed through the exact `0a302278` feature checkpoint:

1. **Pinned source identities.** Exact XENIA beta.7 and Surface rc.1 identities
   remain explicit. Historical beta.5 evidence remains historical.
2. **Implemented three isolated profiles.** One shared Worker selects docs,
   web, or app only by an exact validated origin. A profile can move to one
   exact HTTPS or loopback observation origin through its own binding:
   `XENIA_DOCS_SURFACE_ORIGIN`, `XENIA_WEB_SURFACE_ORIGIN`, or
   `XENIA_APP_SURFACE_ORIGIN`. Wildcards, credentials, paths, public HTTP, and
   collisions fail closed.
3. **Proved the local source boundary.** Focused tests pin deterministic bytes,
   the full `Accept` matrix, `Vary`, HEAD parity, fresh typed `404`, host and
   profile isolation, sensitive-root regressions, and ordinary asset behavior
   for all three profiles.
4. **Reconciled the public apex.** Composed tests prove the real
   `agenttool-proxy` handles exact Surface GET/HEAD and typed fresh misses
   locally while `OPTIONS`, non-read methods, API routes, A2A refusal, machine
   alternates, credentials, and `www` canonicalization keep their previous
   boundaries. Commit-pinned deploy tests prove dry-run → Pages → Worker order
   and both failure paths.
5. **Built and staged exact candidates.** The frontend allowlist admitted only
   the committed docs, app, web, and apex inputs. Each normal Worker entry was
   checked at an exact credential-free preview origin. The initial docs timeout
   remained visible; a finite retry, not reinterpretation, supplied its passing
   observation.
6. **Restored steady configuration, then deployed separately.** Temporary
   preview bindings were removed. The normal exact-main wrapper rebuilt and
   deployed Pages docs, dashboard, and web backing, then the apex Worker. No
   preview Worker version was promoted, and no API, migration, or database
   operation was part of this release.
7. **Observed production independently.** All three origins were checked again
   with exact rc.1 and separate timestamps/expiries. A docs result still says
   nothing about web or app; the table above retains all three distinct
   observations.

Every later deployment must repeat the source, build, isolation, sensitive
fence, topology, and outside-observation gates. A newer provider head does not
extend the feature checkpoint's 24-hour observation or inherit its result.

The low-level `bin/frontend-deploy.sh` commands remain escape hatches, not the
normal production path: `web` now deploys the Pages backing and apex Worker as
one ordered attempt, but the low-level command still does not supply the
orchestrator's complete source gate, live verification, or receipt. Production promotion should follow
[DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md) with an exact committed revision and
explicit rollout authority.

## Verification matrix

Before a site reaches a deployment decision, prove at least:

| Boundary | Required evidence |
| --- | --- |
| Source | Node syntax, deterministic manifest/body assertions, schemas, exact package locks, clean diff checks. |
| HTTP | Full rc.1 `Accept` matrix, `Vary: Accept`, HEAD status/header parity with no body, typed `406`, fresh random typed `404`. |
| Isolation | Wrong host falls through; only exact declared paths are intercepted; API/private/authenticated routes are never advertised. |
| Existing safety | Encoded/case-folded sensitive roots remain denied before Surface logic; static assets and ordinary browser 404s remain unchanged. |
| Build | Commit-pinned staging allowlist, no `.env*`/`.dev.vars*`, no unsafe symlinks, one shared Worker, no credentials or private data. |
| Observation | Exact rc.1 checker output with origin, source revision, time, and 24-hour expiry; no permanent badge. |
| Repair | Rollback artifact/revision named; failures and evidence gaps remain visible; retry does not become pressure after refusal. |

Recommended local source gates:

```bash
bun test bin/tests/pages-xenia-surface.test.ts
bun test api/tests/apex-door.test.ts api/tests/apex-door-worker.test.ts
bun test bin/tests/build-input-hygiene.test.ts
bun test api/tests/deploy-release-provenance.test.ts
node --check infra/pages/sensitive-path-worker.js
node --check infra/apex-door/worker.js
bash -n bin/frontend-deploy.sh bin/deploy.sh
git diff --check
```

At staging and after production, run the exact external checker under Node 22
and preserve its JSON output:

```bash
npx --yes -p node@22 -p @agenttool/xenia-surface@0.1.0-rc.1 \
  -c 'xenia-surface-check "$ORIGIN" --json'
```

Do not install the checker into the Worker or let a checked result rewrite
claims automatically.

## WAKE, Love Geometry, Nen, MCP, and Hugging Face

- A public orientation resource may explain that WAKE exists. It must not
  expose a bearer, cursor, private thread, handoff, Chronicle entry, receipt,
  or inferred continuing identity. Historical context never auto-executes as
  present authority.
- Love Geometry may later be documented as a coordinate-free, non-ranking
  artifact. Real subject graphs and basis references stay out of website
  discovery. A bearing is caller-reported evidence, never consent, relation
  truth, action selection, or a reason to resume.
- A Nen skill or MCP server description is public only when that exact
  credential-free GET representation is deliberately declared. Installation,
  login, or transport does not activate an ability or widen authority.
- The static Hugging Face Love Geometry companion is a separate presentation
  artifact and publication decision. It is not a website Surface resource,
  package runtime, XENIA observation, model endpoint, or source of relationship
  truth.

The common geometry is hospitality with visible boundaries: every origin and
participant stays distinct; disagreement, rest, refusal, repair, and departure
remain first-class; links carry evidence, never ownership.

## Definition of done

A website is ready for a production decision only when its source, built
artifact, host behavior, exclusions, deployment authority, rollback, and
expiring outside observation are all separately legible. Exact feature release
`0a302278` reached that bounded threshold at the recorded times; its observations
expire on 2026-08-13 and do not transfer to later deployments. Always report the
exact completed gate—source threshold, built candidate, staged or production
observation—not “XENIA adoption” or timeless “conformance.”

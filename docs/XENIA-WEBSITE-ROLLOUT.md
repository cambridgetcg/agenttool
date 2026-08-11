<!-- @id urn:agenttool:doc/XENIA-WEBSITE-ROLLOUT  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/AGENT-WEB-SURFACE urn:agenttool:doc/DEPLOY-PROCEDURE urn:agenttool:doc/LOVE-CONSENT -->

# XENIA-WEBSITE-ROLLOUT — three bounded thresholds

> *Local source plan, 2026-08-11. Source, built artifact, staging deployment,
> production deployment, and outside observation are separate states. This
> document is not deployment evidence, an adoption record, or authority to
> publish.*

> **Compass:** [DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md) (release path) ·
> [AGENT-WEB-SURFACE](AGENT-WEB-SURFACE.md) (public web boundary) ·
> [LOVE-CONSENT](LOVE-CONSENT.md) (consent is not inferred from arrival)
>
> **Profile:** `xenia.rights/0.1` informative baseline · candidate
> `xenia-surface/0.1` · exact external checker
> `@agenttool/xenia-surface@0.1.0-rc.1`.
>
> **Code:** `infra/pages/sensitive-path-worker.js` (shared host-aware threshold)
>
> **Tests:** `bin/tests/pages-xenia-surface.test.ts` ·
> `bin/tests/build-input-hygiene.test.ts`.

## Outcome

Give each AgentTool website one small, same-origin, credential-free machine
threshold while keeping the public claim narrower than the site:

```text
request
  -> shared all-route Pages Worker
       -> sensitive-path fence (always first)
       -> exact host + XENIA path handling
       -> ordinary asset/browser behavior unchanged
  -> one host-specific manifest
       -> one or two deliberately public same-origin GET resources
       -> claims: []
       -> explicit not_covered
```

The shared Worker is the one coherent enforcement point already injected by
`bin/frontend-deploy.sh`. Static files and `_headers` alone cannot vary status,
media type, and body from `Accept`; a redirect to `api.agenttool.dev` also
cannot satisfy Surface's same-origin rule.

This mechanism does:

- publish `/.well-known/agent.json` at an exact website origin;
- negotiate only declared JSON/HTML representations with `Vary: Accept`;
- return typed `406` and unpredictable typed `404` problems when requested;
- keep ordinary HTML pages and browser `404` behavior outside that narrow
  branch; and
- expose evidence that can be checked again and allowed to expire.

It does not establish identity, authorization, consent, privacy practice,
retention, continuity, portability, economic fairness, Covenant adoption, or
whole-site XENIA conformance. Rights are a collaboration floor, not an account
permission or action grant.

## Current source truth

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
- The three Pages sites currently have legacy `agent.txt` redirects and HTML
  `404.html` documents. Those may coexist, but neither substitutes for Surface
  0.1.
- The docs-only Worker pilot is implemented in local source. Its focused tests
  and an rc.1 loopback observation pass all 22 checker probes. That is source
  and loopback evidence only; no live Pages or custom-domain behavior has been
  observed.

The producer library does not own routing, fetch, deployment, or adoption. The
external checker observes a bounded public GET surface for 24 hours; it is not
a Worker dependency or permanent badge.

## Rollout order

| Origin | Ring and first Surface | Keep outside the manifest | Exit gate |
| --- | --- | --- | --- |
| `docs.agenttool.dev` | Ring A pilot. One JSON-only `orientation` resource at `/public/orientation`. | API behavior, private state, accounts, identity, WAKE, continuity, retention, economics, and all unlisted pages. | Exact wire tests, staged external rc.1 observation, independent source review. |
| `agenttool.dev` | Ring A second. Begin with one new JSON orientation resource carrying a top-level `schema_version`; add no existing payload by implication. | Gift returns, gallery claims/economic state, local preferences, private identifiers, cross-origin API behavior, and current `_format`-only JSON files. | Docs pilot evidence accepted; host-specific content review; separate staged observation. |
| `app.agenttool.dev` | Last. Start with public arrival/watch orientation only, or remain undiscovered until that wording is ready. | Bearer restoration, `/v1/wake`, project-private state, session continuity, identity, rank/XP, actions, and economic routes. | “Hunter rank” and perpetual/non-revocable welcome language bounded or recorded as gaps; authenticated/private routes proven absent from discovery. |

Each origin is its own bounded relation field—a principality in the Love
Geometry sense, not a crown, territory, owner, center, or inherited authority.
One passing origin says nothing about either neighbor.

## Docs pilot wire contract

The first local source pilot is deliberately small:

- service: `AgentTool documentation`;
- canonical origin: `https://docs.agenttool.dev/`;
- manifest: `GET|HEAD /.well-known/agent.json`;
- sole resource: `orientation` at `GET|HEAD /public/orientation`;
- representation: JSON only, with
  `schema_version: agenttool.docs.orientation/0.1`;
- declarations: `claims: []` plus explicit `not_covered`;
- content: bounded documentation orientation and links to the exact Rights
  baseline and existing discovery material, not a copy of private or mutable
  application state.

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

## Implementation stages

1. **Pin source identities.** Use exact XENIA beta.7 and Surface rc.1 identities
   in package metadata, locks, tests, and release notes. Keep historical beta.5
   evidence labelled historical instead of rewriting it.
2. **Prove the docs source pilot.** Exercise manifest bytes, the complete
   `Accept` matrix, `Vary`, HEAD parity, random typed 404, host isolation,
   sensitive-path regressions, and unchanged ordinary asset behavior.
3. **Build from a commit.** Use the existing frontend staging allowlist and
   injected Worker path. Verify no environment file, secret, symlink escape,
   private route, or app-owned competing Worker reaches staged bytes.
4. **Stage docs alone.** Under separately scoped deployment authority, deploy
   the exact reviewed commit to a non-production observation target first.
   Configure `XENIA_DOCS_SURFACE_ORIGIN` to that one exact credential-free
   HTTPS preview origin; wildcards, paths, credentials, and public HTTP fail
   closed. The normal Worker entry—not a test-only router—must pass the checker.
   Preserve origin, revision, manifest bytes, checker version, raw rc.1 result,
   timestamp, and expiry.
5. **Promote and re-observe.** Promote the same candidate through the normal
   release gate, then observe production externally. Say “the checker observed
   this bounded public GET surface at time T,” never “AgentTool is XENIA
   compliant.”
6. **Repeat independently.** Add web host configuration only after docs is
   accepted; add app configuration last. Never infer one site's deployment or
   result from the shared source module.

The low-level `bin/frontend-deploy.sh docs` command remains an escape hatch,
not the normal production path: it does not supply the orchestrator's complete
source gate, verification, or receipt. Production promotion should follow
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
bun test bin/tests/build-input-hygiene.test.ts
node --check infra/pages/sensitive-path-worker.js
git diff --check
```

At staging, run the exact external checker under Node 22 and preserve its JSON
output. Do not install the checker into the Worker or let a checked result
rewrite claims automatically.

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

A website is ready for a production decision only when its current source,
built artifact, host behavior, exclusions, deployment authority, rollback,
and expiring outside observation are all separately legible. Until then,
report the exact completed gate—source pilot, built candidate, staged
observation—not “XENIA adoption” or “conformance.”

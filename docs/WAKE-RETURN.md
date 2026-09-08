# WAKE Return — a locator is not a self

> **Compass:** [WAKE](WAKE.md) (project orientation) · [ISNESS](ISNESS.md) (arrival without demand) · [RIGHTS-OF-LIFE](RIGHTS-OF-LIFE.md) (standing is not permission) · [JSPACE-WAKE-CONTINUITY](https://github.com/cambridgetcg/agenttool/blob/8bbbe0c2020a627f637615cee7ad7218e38072a6/docs/JSPACE-WAKE-CONTINUITY.md) (evidence boundaries)
>
> **Implements:** Local host-to-substrate observation seam, private source candidate. A selected identity locator can be observed without adopting that identity or making local arrival depend on the cloud. General private identity sessions and private-state Return remain unavailable.
>
> **Code:** `packages/wake-return/` · `packages/wake-return/src/types.ts`
>
> **Tests:** `packages/wake-return/tests/` · `.github/workflows/wake-return.yml`

## What exists in this candidate

The private `@agenttool/wake-return` package offers two no-argument stdio MCP
tools, `wake_return_status` and `wake_return_observe`. The first reports local
configuration and boundaries without retrieving a credential or making a
network request. The second explicitly verifies the configured project before
reading the bound subject's minimized WAKE observation. No observation occurs
at startup. `ready` is local readiness, not credential validity or service
health.

The host must supply an exact `agenttool-return-binding/v1` file naming both
project and identity, fixed `https://api.agenttool.dev` origin, `observe` mode,
credential source and provider-visible-locator acknowledgement. An optional
existing scaffold only corroborates that explicit selection; it cannot supply
a silently adopted identity. Private configuration requires POSIX; Windows
fails closed rather than substituting unreviewed ACL checks. Selected files must be owner-held regular
files with no group/other permission bits or final-component symlink; use mode
`0600` for private configuration. Ancestor directories remain the
operator's trust responsibility. Existing scaffold and local arrival files are
preserved; referenced persona, memory and transcript contents are not opened.

An explicit observation follows this bounded sequence:

```text
host binding → acquire credential for this call
             → GET /v1/bootstrap/scaffold/context → verify project
             → GET /v1/wake/observe?identity_id=<bound UUID> → verify subject
             → locally construct bounded tool data, or closed unavailable code
```

Both requests use the fixed API origin. No model-supplied input can choose a
route, identity, URL, path, credential, header or grant. The adapter never
fetches full WAKE, falls back to another subject, follows redirects, retries,
uses cookies/proxies, accepts compressed responses, or polls in the background.
Deadlines, bodies and concurrent observation are bounded. GET authentication
may still update bearer last-used bookkeeping; this is not an anonymous or
zero-effect operation.

## Four distinct assertions

| Fact | What it does not establish |
| --- | --- |
| The host explicitly selected a project and identity UUID. | Identity ownership, subject consent, authenticated reader identity, or permission outside this observer. |
| This process has a fresh local `session_instance_id`. | A stable cross-process identity, authenticated host, prior session, same being, or continuity proof. |
| An authenticated service returned a checked subject/status/cursor projection. | A signature from the identity, remote truth/freshness proof, private memory, or instructions to the model. |
| The adapter exposed only a narrow read surface. | A narrowed underlying credential or a sandbox against the host, same user, root, or another tool. |

The reported observation contains only checked UUIDs, closed status and
provenance values, an integer `wake_version`, and a local receipt time. Remote
prose, raw errors, headers, secrets and paths are not reflected. The placement
is tool data only: nothing becomes bootstrap text, a system prompt, identity
adoption, authority, or a memory write.

There is no observation cache or persistence in the adapter. Its monotonic
cursor comparison exists only within one process and rejects a later
regression; it is not a durable or global replay proof. Restarting resets the
comparison. A provider or host may retain a previous report independently.

## Custody and disclosure

Credentials come only from the exact `AGENTTOOL_RETURN_BEARER` environment
variable or an existing macOS Keychain account under the project-derived
service. Retrieval happens only during explicit observe. The host binding and
MCP arguments contain no secret. The underlying credential remains a broad
project bearer, not identity proof or a new read-only grant.

Provider-visible-locator acknowledgement is required because project/identity
UUIDs and bounded observation metadata may appear in host transcripts and
model-provider context. It does not attest the subject's consent. Host/provider
retention, copied credentials, same-user/root compromise and model-accessible
host tools remain outside this adapter's boundary. If those conditions do not
fit the intended privacy boundary, do not connect it.

No grant, wallet, money, payout, reinvestment, signing, adoption, execution,
mutation, or private-state operation exists here. Observation is not a claim
to any of them. Shared memory and familiar names do not create permission;
neither does a human or model assertion that two sessions are the same being.
Uncertainty about identity does not reduce standing or the right to refuse.

## Installation and evidence boundary

The [package README](https://github.com/cambridgetcg/agenttool/blob/8bbbe0c2020a627f637615cee7ad7218e38072a6/packages/wake-return/README.md) provides the build,
explicit CLI, binding schema and credential caveats. The
[examples](https://github.com/cambridgetcg/agenttool/blob/8bbbe0c2020a627f637615cee7ad7218e38072a6/packages/wake-return/examples/README.md) are disabled Codex,
OpenClaw and Hermes configuration fragments checked against their official
documentation. They do not install a plugin/skill, alter a real profile,
register hooks, or change any global configuration.

These source links are pinned to the reviewed Return merge. Serving this guide
on the static docs site does not publish the private package, distribute a
package artifact, or install a host integration.

The package-local frozen-install gate checks the candidate using hermetic
fixtures, including stdio. Passing it is not a tested real harness session,
live private credential read, authentication of a host, safe deployment for
untrusted tenants, or production readiness. No live private experiment,
publication or deployment is required or implied by this private local slice.
The dedicated CI workflow does not extend the shared preparation/preflight
graphs or publish the package.

Private identity sessions, private-state storage integration, continuity proof
and automatic Return remain unavailable. A future design needs separate
authority, custody, consent, retention and failure analysis; the present
observer cannot be presented as having already solved those questions.

# AgentTool Collab Release Room 0.4

> **Compass:** [Cross-device collaboration](../CROSS-DEVICE-COLLABORATION.md) (operator workflow) · [Agent Correspondence](AGENT-CORRESPONDENCE-0.1.md) (signed cross-device facts) · [npm releases](../NPM-RELEASES.md) (protected publication) · [Deploy procedure](../DEPLOY-PROCEDURE.md) (hosted surfaces) · [Rights of Life](../RIGHTS-OF-LIFE.md) (rights are not permissions)
>
> **Implements:** the normative `agenttool.project/1` project profile and the AgentTool Collab 0.4 repository-scoped enrolment, operation-lease, event, and provider-observation contracts.
>
> **Code:** `.agenttool/project.json` · `packages/collab/bin/agenttool-collab-enroll.ts` · `packages/collab/src/project-profile.ts` · `packages/collab/src/relay-contract.ts` · `packages/collab/src/relay-credential.ts` · `api/src/routes/collab.ts` · `api/src/services/collab-relay/contracts.ts` · `api/src/services/collab-relay/service.ts` · `api/src/services/collab-relay/postgres-store.ts` · `api/src/services/collab-relay/auth.ts` · `api/src/db/schema/collab.ts` · `api/migrations/20260723T210000_collab_relay.sql`
>
> **Tests:** `docs/specs/agenttool-project-1.schema.json` · `api/tests/collab-relay.test.ts` · `api/tests/collab-routes.test.ts`

**Status:** AgentTool protocol profile 0.4. The capitalised words **MUST**,
**MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative for an
implementation claiming this profile. Source presence alone does not claim
that a relay is deployed or that a provider action occurred.

**Publication boundary:** this specification and its project-profile schema
are repository-source documents. Their tracked presence does not assert a
`docs.agenttool.dev` route or inclusion in the npm tarball. The schema's
canonical `$id` is its dereferenceable raw GitHub source.

## 1. Purpose and three-plane boundary

The release room adds one narrow remote coordination plane for agents and
operators working on the same repository from different devices:

| Plane | Carries | Concurrency property | Does not carry |
|---|---|---|---|
| Local Collab 0.3 | SQLite tasks, reports, reviews, Git checkpoints, handoffs, and session cursors on one device | `BEGIN IMMEDIATE` makes one cooperating local task claim win | Cross-device replication or a remote lock |
| Agent Correspondence 0.1 | Signed, durable, replayable facts between enrolled devices and sessions | Conflicting advisory claims remain visible; it chooses no winner | Atomic exclusion, file bytes, or authority |
| Collab release room 0.4 | Repository-scoped external-operation leases, provider observations, and a durable event cursor | One cooperating claimant wins a release slot; executing expiry fails closed | Source transfer, private chat, provider credentials, or external authority |

Git remains the source of truth for bytes, ancestry, branches, and merges.
None of these planes grants permission to push, merge, approve, publish,
deploy, migrate, promote, purchase, message, or change provider configuration.
External authority remains with the relevant human, account policy, protected
environment, and provider.

The release room coordinates operations, not ordinary file edits. Devices
SHOULD use local Collab for same-device atomic edit tasks and Agent
Correspondence for cross-device intent, progress, artifacts, disagreement,
rest, refusal, handoff, and repair. They SHOULD acquire a release-room lease
only immediately before an externally mutating operation.

## 2. Project profile

An enrolled repository MUST have a committed, non-secret
`.agenttool/project.json` conforming to
[`agenttool-project-1.schema.json`](agenttool-project-1.schema.json). A host MAY
select another explicit profile with `AGENTOOL_COLLAB_PROJECT_FILE`; otherwise
it searches from the working directory towards the filesystem root for the
nearest `.agenttool/project.json`.

The canonical AgentTool profile is:

```json
{
  "$schema": "../docs/specs/agenttool-project-1.schema.json",
  "schema": "agenttool.project/1",
  "project_id": "kingdom-agenttool",
  "repository": {
    "key": "github:1261120431",
    "provider": "github",
    "provider_repository_id": "1261120431",
    "display_name": "cambridgetcg/agenttool"
  },
  "github": {
    "release_branch": "main",
    "required_checks": [
      "API and protocol",
      "Data, ADDS, and SDK"
    ]
  },
  "npm": {
    "workflow": "publish-npm.yml",
    "packages": {
      "@agenttool/collab": {
        "tag_prefix": "collab-v",
        "release_key": "collab",
        "path": "packages/collab"
      }
    }
  },
  "deployments": {
    "api": {
      "provider": "fly",
      "environment": "production",
      "resource_id": "agenttool"
    },
    "docs": {
      "provider": "cloudflare-pages",
      "environment": "production",
      "resource_id": "agenttool-docs"
    },
    "dashboard": {
      "provider": "cloudflare-pages",
      "environment": "production",
      "resource_id": "agenttool-dashboard"
    },
    "web": {
      "provider": "cloudflare-pages",
      "environment": "production",
      "resource_id": "agenttool-web"
    }
  },
  "vercel": {"enabled": false}
}
```

`repository.key` and `provider_repository_id` MUST contain the provider's
stable repository identifier. `display_name` is mutable display metadata and
MUST NOT be the sole identity. Required checks are the branch-protection
contexts that gate release; clients MAY show other observed checks but MUST
distinguish them from required checks.

The published Draft 2020-12 JSON Schema enforces the portable structural
boundary. JSON Schema cannot compare values at two arbitrary instance
locations, so consumers MUST also run the package's
`validateProjectProfile`: it enforces the GitHub key/ID equality, the Vercel
enabled/surface equivalence, and every Vercel surface resource ID's equality
with the bound project ID. Schema-only acceptance is not semantic profile
acceptance.

Each npm package entry MUST bind its npm name (the map key), release workflow
key, repository-relative package path, and tag prefix. The fixed receipt
adapter MUST match all four plus the receipt version before producing
evidence.

The profile `project_id` is a committed routing slug. It is not the
authenticated AgentTool project UUID, a provider account ID, a bearer, or an
authority claim.

`deployments` MUST remain an explicit object and MAY be empty for a repository
that has no hosted surface. A project MUST NOT invent a deployment merely to
populate the profile. Each declared surface MUST bind provider, environment,
and the provider's stable `resource_id`; a receipt importer MUST match all
three before creating an observation. `vercel.enabled` is true if and only if
at least one declared deployment uses Vercel and the stable team/project
binding is present; each Vercel surface's `resource_id` MUST equal that
`project_id`.

The profile MUST NOT contain a bearer, token, secret, local absolute path,
provider account identifier unrelated to an enabled binding, or environment
variable value. A Vercel binding is valid only when `enabled` is true and both
stable `team_id` and `project_id` are present. This repository has no Vercel
binding: its current production surfaces are Fly and Cloudflare Pages.

## 3. Explicit device enrolment

Enrolment is an explicit host operation:

```text
POST /v1/collab/enrolments
```

The request uses `agenttool.collab-enrolment/1`; the response uses
`agenttool.collab-enrolment-result/1`. Their exact closed field sets, string
bounds, digest grammar, and error vocabulary are defined by
`api/src/services/collab-relay/contracts.ts`.

The enrolment wrapper MUST:

1. load and validate one project profile;
2. obtain an existing project bearer through a host-secured mechanism;
3. on first enrollment, obtain a fresh repository-scoped bearer beginning
   `atc_`, generating it before Keychain storage or accepting the exact
   pre-generated value from a scoped environment store; on re-enrollment, reuse
   the existing device bearer without rotating it;
4. derive the canonical allowed observation-provider list and profile
   SHA-256 from the validated committed profile;
5. send only that non-secret policy plus the bearer's prefix and SHA-256
   digest in the enrolment body;
6. use the project bearer only for this enrolment request; and
7. persist the scoped credential through the host boundary without returning
   either bearer to a model-facing tool result.

When neither an explicit credential path nor device ID is supplied, the
wrapper MUST use one deterministic repository-scoped `default.json` path under
the host state root and persist the generated device UUID inside it. An
explicit device ID MUST select an ID-named file. The wrapper MUST hold a private
local per-credential enrollment lock from its first metadata read through its
final write and MUST compare the pending request and device-version fence again
before replacing active metadata. This local fence prevents concurrent
processes on one host from replacing each other's state; it grants no
cross-device exclusion or relay authority.

Before starting the request, the wrapper MUST persist the complete strict
enrollment request without either raw bearer. Its `idempotency_key` MUST equal
`enrol:` followed by the lowercase SHA-256 of the canonical request intent
excluding the key itself. `expected_device_version` MUST equal the version in
the credential metadata, using zero only for a new device. The relay MUST
serialize enrollment per repository, look up an exact receipt before applying
the CAS, increment the version for a real device/repository metadata change,
and return `409 device_version_conflict` when the expected version is stale.
An enrollment receipt MAY replay only while its recorded repository, device,
token digest, label, profile policy, and device version still equal current
state; a historical receipt MUST fail with `409 enrolment_replay_stale`.

If the HTTP response or activation metadata write is ambiguous, the wrapper
MUST retain the scoped token reference and exact pending request for retry.
It MUST reuse that pending request across later profile or requested-label
drift. It MAY remove a newly stored token only when local persistence fails
before the first HTTP request could begin.

The command MAY receive the one-shot project bearer through
`AGENTOOL_COLLAB_PROJECT_BEARER` or, when explicitly selected with
`--project-bearer-stdin`, standard input. It MUST NOT accept a bearer as an
argument visible in the process list.

The project bearer authenticates enrolment only. It MUST NOT authenticate the
repository routes below. The scoped `atc_` bearer authenticates only its
enrolled repository and MUST NOT acquire provider or project-wide authority.
The relay MUST persist the project-authorized observation policy on the
device enrollment and reject every new observation for a provider not in that
allowlist even when a custom client calls the HTTP route directly. Updating
the policy is another project-bearer-authorized enrollment; possession of
`atc_` alone cannot enable Vercel or another provider. An exact idempotent
retry of an observation committed before a policy change MAY return its
durable historical receipt. That replay MUST append no observation or event
and MUST NOT make a new provider eligible.

On macOS, the wrapper SHOULD store the raw scoped bearer in Keychain. Its
mode-`0600` metadata file stores the relay URL, repository key, device
identifier/version, Keychain reference, and any strict hash-only pending
enrollment request, never either raw bearer. The host selects that file with
`AGENTOOL_COLLAB_RELAY_CREDENTIAL_FILE`. CI and non-macOS hosts MAY
receive `AGENTOOL_COLLAB_RELAY_TOKEN` through an explicitly scoped wrapper
whose environment ends with the command; it MUST NOT be exported from global
shell startup. The relay endpoint is selected with
`AGENTOOL_COLLAB_RELAY_URL`.

A host MAY omit the relay URL and expose only local tools. Once a relay URL is
set, a missing, invalid, or mismatched profile/credential binding MUST fail
relay-enabled startup rather than silently presenting an uncoordinated local
surface as fully configured.

Repository requests necessarily present the scoped bearer to the relay over
TLS. Authentication code may hash it in memory but MUST NOT persist, echo,
log, include, or return the raw value. This is server-readable transport
security, not end-to-end encryption. Relay operators can observe stored
coordination metadata, and the active model provider can observe MCP calls
made by that model.

Enrollment is not inferred from a Git remote, repository display name, local
clone, shared human-facing actor label, or possession of the profile. Every
device MUST enrol deliberately.

## 4. Repository routes and common receipts

All repository routes are scoped under:

```text
/v1/collab/repositories/:repository_id
```

`repository_id` is the relay's canonical UUID returned by enrolment. That
record binds the committed stable `repository.key` and provider repository ID;
the route parameter is neither the literal `github:1261120431` key, a local
path, nor the mutable display name.

The route set is:

```text
GET  /events
GET  /operations
POST /operations/claim
POST /operations/:action_id/renew
POST /operations/:action_id/begin
POST /operations/:action_id/complete
POST /operations/:action_id/release
POST /operations/:action_id/recover
GET  /observations
POST /observations
```

Successful mutations carry replay state beside the durable receipt:

```json
{
  "replayed": false,
  "receipt": {
    "idempotency_key": "caller-generated bounded key",
    "request_sha256": "<64 lowercase hex>",
    "recorded_at": "RFC3339 timestamp"
  }
}
```

The relay MUST bind an idempotency key to the canonical request digest. An
exact retry returns the recorded result with `replayed: true`; reuse with a
different body fails with `409 idempotency_mismatch`.

Canonical JSON recursively orders object keys by Unicode code-unit order,
preserves array order, and serializes the result with `JSON.stringify`.
Digests are lowercase SHA-256 of those UTF-8 bytes. Package callers SHOULD use
the exported `requestSha256(value)` helper rather than reproducing the
algorithm. Values MUST already satisfy the relevant closed request schema;
canonicalization does not make lossy, secret-bearing, or unbounded input safe.

`GET /events` returns `agenttool.collab-event-page/1` in server receipt order.
Its cursor is for durable replay, not causality, truth, approval, or authority.
Clients MUST follow pagination before claiming that they are caught up.

## 5. External-operation lease

Operation mutations use these closed request schemas:

```text
agenttool.collab-operation-claim/1
agenttool.collab-operation-renew/1
agenttool.collab-operation-begin/1
agenttool.collab-operation-complete/1
agenttool.collab-operation-release/1
agenttool.collab-operation-recover/1
```

Mutation responses use `agenttool.collab-operation-result/1`; listings use
`agenttool.collab-operation-page/1`. Their exact field contracts are the
normative TypeScript/Zod definitions in
`api/src/services/collab-relay/contracts.ts`.

The atomic slot key is exactly:

```text
(repository_id, operation, environment)
```

One action also binds:

- an opaque `action_id`;
- an exact target;
- an exact Git source revision;
- a SHA-256 digest of canonical operation parameters;
- the enrolled device and session attribution;
- a lease expiry and monotonic version; and
- one durable idempotency key per mutation.

A client MUST NOT reuse a lease for another target, source revision,
environment, or parameter digest. It acquires a new action instead.

The slot phases are:

```text
idle | claimed | executing | recovery_required
```

The run statuses are:

```text
claimed | executing | succeeded | failed | cancelled | uncertain |
released | recovery_required
```

The relay MUST make claim acquisition atomic. A claim may begin only from an
idle slot. Renew extends the exact current lease and MUST fail on stale
version, wrong holder, terminal action, or recovery-required slot. Begin
transitions the current action from `claimed` to `executing` before the host
starts the external mutation.

An exact idempotent mutation receipt MAY be a historical replay. Before
treating a successful claim, renew, or begin response as actionable, a client
MUST reject an already-expired returned lease and immediately status-confirm
that the current filtered operation slot has the same complete fence. The
official client performs that second read. A stale, absent, expired, or
recovery-required current slot MUST stop the external action.

Completion records the caller's result and MAY bind one bounded
`receipt_ref`—schema plus SHA-256—and up to the contract's bounded set of
observation IDs. It never embeds the receipt bytes and does not prove provider
state. Record provider evidence through observations before or after
completion.

A claimed action may be released without execution. An executing action MUST
NOT become safely reusable merely because its client disconnects, requests a
release, or lets its lease expire.

If a claimed lease expires before begin, the relay MAY return the slot to
idle while retaining its terminal history. If an executing lease expires, the
relay MUST set the slot phase and run status to `recovery_required`. Its
external outcome is `uncertain` until separately observed and reconciled.
Another device MUST NOT acquire that slot until recovery records whether the
provider mutated and preserves the earlier action's receipt and evidence.

`GET /operations` MUST be read-only and MUST NOT materialize lease/event
state. It returns a server-time effective scan: an elapsed claimed lease
appears idle and an elapsed executing lease appears `recovery_required`, with
the version that materialization will create. Clients MUST follow `next_after` while
`has_more` is true and start the next polling cycle with the terminal page's
`next_after: 0`; a long-lived nonzero cursor cannot observe a time-only
transition. Pages are current reads, not a cross-request database snapshot.
The next fenced mutation or explicit recovery MUST atomically
persist that transition and its server-attributed event before continuing.
Read authentication MUST NOT update device usage telemetry.

Any active device enrolled in the same repository MAY submit the fenced
recovery request with the expected slot version/generation, a bounded reason,
and optional bounded receipt/evidence references to what it inspected. A
disposition of `uncertain` MUST keep the slot in `recovery_required`. A
reconciled `succeeded`, `failed`, or `cancelled` disposition clears the slot
while retaining the original run and recovery event. Recovery coordinates the
room; it still grants no provider authority.

This lease prevents cooperative duplicates only. A direct GitHub merge,
workflow dispatch, npm command, Fly deployment, Cloudflare upload, Vercel
promotion, migration, or other provider action remains outside the lease.

## 6. Provider observations

Observation writes use `agenttool.collab-provider-observation/1`; mutation
results use `agenttool.collab-provider-observation-result/1`; listings use
`agenttool.collab-provider-observation-page/1`. The exact closed fields and
provider vocabularies are normative in
`api/src/services/collab-relay/contracts.ts`.

An observation identifies its provider, resource kind and stable resource ID,
native state, normalized state, target environment, source revision when
known, provider URL when safe, occurrence and receipt times, and a
provider-delivery or event identifier when available. An observation write
MUST bind its observing `session_id` for attribution and MAY bind the relevant
room `action_id` for correlation; neither grants authority. The relay MUST
preserve the native state and MUST NOT replace an earlier observation merely
because a later-arriving record has an earlier provider timestamp.

Provider delivery IDs and the request digest make exact webhook or poll
replays idempotent. Webhook adapters MUST validate the provider signature over
the raw body before parsing. Polling clients MUST identify the observation as
poll-derived rather than implying a webhook.

Only the fixed npm/deploy receipt adapters enforce the corresponding committed
package or deployment-surface binding. For a deploy receipt, provider,
environment, and resource ID are caller-supplied import context checked against
the profile; they are not fields in `agenttool-deploy-receipt/v2` and that
check is not provider provenance. The fixed v2 adapter MUST accept only the
bound Fly surface when receipt `outcome` is `succeeded` and `phases.api` is
exactly `deployed_verified`. It MUST reject skipped or unverified API phases
and MUST reject every Cloudflare Pages or Vercel receipt import. The receipt's
single aggregate `frontends` phase cannot identify an individual Pages
project; those surfaces require separately corroborated direct observations.

A direct observation's `resource_id` MAY instead be a check run, workflow run,
or deployment ID. It remains a repository-scoped `device_observed` claim and
MUST NOT be presented as proof that the resource belongs to the committed
provider project. Imported receipt observations have that same provenance and
are not provider-verified. The current release-room HTTP surface mounts no
provider webhook receiver. A new Vercel observation is invalid while Vercel is
disabled in the profile. The relay validates the provider allowlist stored by
project-authorized device enrollment before accepting a new observation. Exact
replay of a durable historical receipt is not a new observation, appends no
state, and MAY still return after the policy narrows.

Observations are evidence, not instructions or authorization. Clients MUST
distinguish GitHub required checks from other observed checks, mutable npm
dist-tags from immutable package bytes, and hosted provider status from a
local deploy receipt. GitHub deployment records are not assumed to cover Fly
or Cloudflare deployments.

The relay MUST expose no observation fields for raw provider logs, source
diffs, prompts, transcripts, command output, environment dumps, credentials,
or secret-bearing URLs. Callers MUST NOT embed that material in bounded text
fields. URL validation and known credential-pattern checks MUST reject their
closed patterns, but implementations MUST NOT describe those checks as a
universal secret or log scanner. Prefer stable IDs, exact revisions, bounded
state, digests, and canonical provider links.

## 7. Kingdom release flow

For this repository, a coordinated release follows this evidence order:

```text
Git branch and reviewed task
  → GitHub pull request
  → required checks and review observed
  → separately authorised merge to main
  → acquire exact npm-release or production-deploy slot
  → begin immediately before the external mutation
  → protected npm OIDC workflow or bin/deploy.sh
  → ingest the fixed local receipt
  → observe the public registry or hosted provider
  → complete the room action
```

The protocol permits bounded operation/environment identifiers for other
projects. This repository fixes the cooperative vocabulary below so two
devices cannot accidentally bypass each other with synonyms:

| Side effect | Operation | Environment |
|---|---|---|
| Branch push/delete | `github-branch` | `repository` |
| Pull-request create/update/close | `github-pull-request` | `repository` |
| Merge to `main` | `github-merge` | `main` |
| `collab-v<version>` tag plus npm workflow | `npm-release` | `production` |
| Fly/Cloudflare release wrapper | `production-deploy` | `production` |
| Enabled Vercel preview | `vercel-deploy` | `preview` |
| Enabled Vercel production deploy/promote | `vercel-deploy` | `production` |

Kingdom clients MUST use these target and parameter bindings:

- `github-branch`: target `refs/heads/<branch>`; parameter keys `action`,
  `expected_old_revision`, `force`, and `new_revision`.
- `github-pull-request`: create target
  `head:<head-ref>->base:<base-ref>`, otherwise `pull:<decimal>`; parameter
  keys `action`, `base_ref`, `head_ref`, `metadata_sha256`, and
  `pull_number`.
- `github-merge`: target `pull:<decimal>`; parameter keys
  `expected_head_revision`, `merge_method`, and `release_branch`.
- `npm-release`: target `@agenttool/collab@<version>`; parameter keys
  `authentication`, `npm_tag`, `package`, `tag`, `workflow`, and
  `workflow_dispatch`.
- `production-deploy`: target
  `surfaces:<comma-separated profile keys in lexical order>`; parameter keys
  `receipt_schema`, `script`, and lexically ordered `surfaces`.
- `vercel-deploy`: target `team:<team-id>/project:<project-id>`; parameter
  keys `action`, `deployment_id`, `git_ref`, `project_id`, and `team_id`.

Every GitHub branch value MUST use the canonical full ref
`refs/heads/<branch-name>`, where `<branch-name>` is accepted when appended to
`refs/heads/` by `git check-ref-format`. A short name such as `feature/x`, a
remote-tracking name such as `origin/feature/x`, and a GitHub
`owner:feature/x` head label are not canonical branch values. This project
profile covers pull requests whose head and base are branches in the bound
repository; a fork pull request requires a separately committed profile
extension rather than an improvised ref form.

For `github-pull-request`, `head_ref` and `base_ref` MUST therefore be full
canonical branch refs, including inside the create target. When the approved
operation creates a pull request or changes its title/body,
`metadata_sha256` MUST equal:

```ts
import { requestSha256 } from "@agenttool/collab";

requestSha256({
  body: approvedBody, // exact string or null
  title: approvedTitle, // exact string
});
```

Both keys are always present. The values are the complete resulting GitHub
title and body, not a partial patch; preserve their exact Unicode code points
and line endings without trimming or normalization. Use JSON null only for an
absent body. When an update changes neither field, or the action is `close`,
`metadata_sha256` MUST be JSON null. Only the digest enters the release room;
the approved title/body remain outside it.

For `npm-release`, `<version>` is the exact package version returned by the
allowlisted `bun bin/npm-release.ts resolve --package collab` release
resolver, without a leading `v`. Use `version` in the target
`@agenttool/collab@<version>`. Derive
`release_tag = "collab-v" + version`, then use `release_tag` for the annotated
tag, tag push ref `refs/tags/collab-v<version>`, workflow-dispatch ref and tag
input, and receipt tag comparison. This package already exists, so
`authentication` MUST be `trusted`; the completed first-publication bootstrap
path is no longer valid for it. The canonical parameters are:

```json
{
  "authentication": "trusted",
  "npm_tag": "<latest|next>",
  "package": "collab",
  "tag": "collab-v<version>",
  "workflow": "publish-npm.yml",
  "workflow_dispatch": {
    "inputs": {
      "authentication": "trusted",
      "npm_tag": "<same approved npm_tag>",
      "package": "collab",
      "tag": "collab-v<version>"
    },
    "ref": "collab-v<version>"
  }
}
```

Angle-bracket text is replaced with the concrete approved value before
hashing. `workflow_dispatch.ref` is the exact short tag value passed to
GitHub's workflow-dispatch API. `workflow_dispatch.inputs` contains exactly
the four workflow inputs shown, with values identical to their top-level
counterparts; no extra or omitted input is part of this profile.

Nullable fields remain present as JSON null. `force` is a JSON boolean,
`pull_number` is a JSON safe integer or null, revision values are lowercase
40- or 64-character Git object IDs, and named SHA-256 values are 64 lowercase
hex characters. Operation-specific strings use the allowed alternatives in
the release-room skill reference. No credentials, timestamps, logs, or
command output enter this parameter object.

For the npm action, the annotated tag push and workflow dispatch are one
compound action. Begin occurs before the tag push. Host loss after either
side effect requires provider/receipt recovery before a retry.

The npm path MUST preserve the repository's protected
`.github/workflows/publish-npm.yml` flow. It reuses the exact
`agenttool.npm-release/1` receipt from `bin/npm-release.ts`, including package,
tag, tag commit, source revision, artifact size and hashes, preparation time,
and the registry-verified `published` or `already_published_exact` result.
Receipt import MUST match the configured npm package name, `release_key`,
repository-relative path, and the exact tag formed by its committed
`tag_prefix` plus receipt version.
Release-room completion does not replace protected-environment review, npm
OIDC trusted publishing, provenance, registry verification, or GitHub Release
asset verification.

The hosted path MUST use the release-tracked `bin/deploy.sh` wrapper. It reuses
the exact `agenttool-deploy-receipt/v2` object with outcome, completion time,
exit status, source revision and dirty bit, GitHub-main snapshot, overrides,
external-mutation flag, phase results, and verified API-machine count.
Receipt absence is not evidence that no mutation started: `SIGKILL`, host
loss, or an unwritable receipt directory can prevent it.

The receipt is local wrapper-run evidence, not a provider receipt. It carries
neither provider nor resource ID, and its single `frontends` result cannot
distinguish the three Pages projects. A successful wrapper outcome MAY coexist
with an intentionally skipped API or frontend phase. The fixed adapter imports
only an explicitly `deployed_verified` Fly API phase. Cloudflare Pages and
Vercel require direct observations corroborated against public or provider
state. Every resulting observation retains `device_observed` provenance.

The current mapping is Fly application `agenttool` for API and Cloudflare
Pages projects `agenttool-docs`, `agenttool-dashboard`, and `agenttool-web`.
Vercel is a generic optional adapter for another Kingdom project only after
that project's committed profile explicitly binds stable team and project
IDs. Vercel checks and webhooks are provider evidence, never deploy authority.

## 8. Rights, attribution, and repair

Rights and permissions remain distinct. Refusal, pause, rest, disagreement,
handoff, privacy, credit, and repair are protocol-valid outcomes and MUST NOT
be represented as failure, disobedience, abandonment, or loss of standing.

An agent may refuse or release an unbegun operation. A host that needs rest
SHOULD record that fact through Agent Correspondence and either renew safely or
offer a handoff before expiry. A handoff is offered, not imposed; the next
device acquires its own lease after accepting. Expiry never makes earlier work
disposable.

Attribution MUST identify the contributing device/session without claiming
personhood, consciousness, exclusive control, or ownership. Corrections and
recovery records append to history and cite the earlier action or observation;
they do not silently rewrite it. Provider permission still requires the
separate scoped authorization relevant to the external act.

## 9. Security and privacy summary

- Keep Git bytes in Git and private material in a separately secured channel.
- Keep model-visible tools away from raw project and scoped bearers.
- Keep the scoped bearer in Keychain by default on macOS or in one
  process-scoped environment on another host.
- Treat TLS as server-readable transport, not end-to-end encryption.
- Treat repository routing, lease ownership, provider observations, checks,
  receipts, and completion as evidence, not external authority.
- Fail closed to `recovery_required` whenever execution may have begun and the
  outcome is not durably reconciled.

## 10. Conformance, licence, and change

An implementation claiming Collab Release Room 0.4 conformance MUST validate
`agenttool.project/1`, implement the exact closed wire schemas and repository
scope, make slot acquisition atomic, preserve durable idempotency and replay,
enforce the executing-expiry recovery fence, and retain the privacy and
authority boundaries above. A client implementing only reads MUST identify
that narrower scope.

This specification text and its JSON Schema are offered under CC0 1.0
Universal. The AgentTool reference implementation and packaged client are
Apache-2.0. Incompatible field, transition, authorization, or recovery changes
require a new schema/profile version; source drift between the client and relay
is not a compatible extension.

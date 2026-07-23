# Kingdom release room from Hermes

Use this reference only with an AgentTool MCP server registered as `agenttool`.

## Contents

- [Project and credential boundary](#project-and-credential-boundary)
- [Prefixed tools and recovery](#prefixed-tools-and-recovery)
- [GitHub and npm](#github-and-npm)
- [Fly and Cloudflare](#fly-and-cloudflare)
- [Optional Vercel](#optional-vercel)
- [Evidence, authority, and rights](#evidence-authority-and-rights)

## Project and credential boundary

The committed AgentTool profile binds stable GitHub repository
`github:1261120431`, release branch `main`, required checks `API and protocol`
and `Data, ADDS, and SDK`, `@agenttool/collab` through
release key `collab`, path `packages/collab`, and
`publish-npm.yml`/`collab-v`; API production on Fly application `agenttool`;
and docs/dashboard/web production on Cloudflare Pages projects
`agenttool-docs`, `agenttool-dashboard`, and `agenttool-web`. Vercel is
disabled.

The host finds the nearest `.agenttool/project.json` or uses
`AGENTOOL_COLLAB_PROJECT_FILE`.

Run `agenttool-collab-enroll` explicitly once per device/repository. A clone,
remote, or profile does not enroll a device. The wrapper uses a project bearer
for enrollment only. On first enrollment it obtains a fresh
repository-scoped `atc_` bearer, generating it for Keychain or accepting the
exact value from a scoped environment wrapper; re-enrollment reuses the
existing device bearer and does not rotate it. It also binds the validated
profile SHA-256 and canonical provider allowlist to that device. The relay
checks the stored policy even for custom clients, so `atc_` alone cannot enable
Vercel or another omitted provider. Enrollment uses a deterministic request key
plus device-version CAS; private metadata preserves the exact hash-only pending
request before HTTP and after an ambiguous response. An exact retry may return
a durable observation receipt from before a later policy change; this
historical replay appends nothing and enables nothing.

With no explicit credential path or device ID, the host uses a stable
repository-scoped `default.json` in its state directory and stores the
generated UUID inside it. A private local enrollment lock spans metadata read,
HTTP, and the final version-fenced write. It prevents local replacement races;
it is not a remote lock.

Supply the project bearer through `AGENTOOL_COLLAB_PROJECT_BEARER` or the
explicit `--project-bearer-stdin` mode, never argv or a Hermes-visible tool
call.

On macOS the raw scoped token belongs in Keychain; the mode-`0600` file chosen
by `AGENTOOL_COLLAB_RELAY_CREDENTIAL_FILE` stores only relay/repository/device
metadata and a Keychain reference. Select the relay with
`AGENTOOL_COLLAB_RELAY_URL`. A bounded CI/non-macOS wrapper may set
`AGENTOOL_COLLAB_RELAY_TOKEN` for one process. Never export either bearer in
global startup or expose it to Hermes.

Repository requests present the scoped bearer over TLS. The relay is
server-readable, not end-to-end encrypted.

## Prefixed tools and recovery

Read:

```text
mcp_agenttool_collab_operation_events
mcp_agenttool_collab_operation_status
mcp_agenttool_collab_provider_list
```

Mutate:

```text
mcp_agenttool_collab_operation_claim
mcp_agenttool_collab_operation_renew
mcp_agenttool_collab_operation_begin
mcp_agenttool_collab_operation_complete
mcp_agenttool_collab_operation_release
mcp_agenttool_collab_operation_recover
mcp_agenttool_collab_provider_observe
```

Expect these tools only when Hermes's MCP configuration includes a relay URL,
validated project profile, and active scoped credential binding. Plugin
startup does not enroll a device. With no relay URL the local tools remain
available; a partial or mismatched relay configuration fails startup instead
of silently dropping the remote coordination boundary.

The slot key is repository + operation + environment. Bind an action to exact
target, source revision, parameter SHA-256, version/generation fence, and
lease. Reuse an idempotency key only for an exact request retry.

For AgentTool use the exact pairs `github-branch / repository`,
`github-pull-request / repository`, `github-merge / main`,
`npm-release / production`, and `production-deploy / production`; an enabled
Vercel project uses `vercel-deploy / preview` or
`vercel-deploy / production`. Synonyms are different slots. Have the host
compute the digest with exported `requestSha256(parameters)` over one agreed
JSON object; do not manually hash or include secrets, timestamps, logs, or
command output.

Use full `refs/heads/<branch-name>` values accepted by
`git check-ref-format` for every GitHub branch target and PR `head_ref` or
`base_ref`; never use a short, remote-tracking, or `owner:branch` form. This
profile covers PR branches in the bound repository, not fork PRs. For a PR
create or title/body update, set
`metadata_sha256 = requestSha256({ body: approvedBody, title:
approvedTitle })`, with both complete resulting fields present, exact Unicode
and line endings preserved, `title` a string, and an absent `body` represented
by JSON null. Use a null metadata digest when neither field changes or the PR
is closing; do not send the title/body to the room.

For collab npm release, take `<version>` from
`bun bin/npm-release.ts resolve --package collab` without a leading `v` and
derive the one tag `collab-v<version>`. The target is
`@agenttool/collab@<version>`, the tag push is
`refs/tags/collab-v<version>`. Because the package already exists, use
`trusted`; bootstrap was restricted to its completed first publication. The
parameters are exactly:

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

Replace angle-bracket text before hashing. Dispatch `ref` is the exact short
tag passed to GitHub; `inputs` has exactly those four keys and repeats the
approved top-level values. Import the helper with
`import { requestSha256 } from "@agenttool/collab"`; if the pinned helper is
unavailable, stop rather than hand-roll a claim.

Begin immediately before external mutation. Release an unbegun action that
will not run. Executing expiry becomes `recovery_required` with an uncertain
outcome. Inspect receipts and provider state, then recover with the current
fence, bounded reason, and optional receipt/evidence references. An
`uncertain` disposition keeps the slot closed; `succeeded`, `failed`, or
`cancelled` clears it while preserving history. Every observation names its
observing session; the MCP runtime derives one stable UUID per process. Bind
the action when known.

An exact idempotent result may be historical. The official client checks lease
freshness and immediately status-confirms the same complete current slot fence
before returning claim, renew, or begin as actionable. Do the same before using
a lease through direct HTTP.

Status is a read-only server-time effective scan. Follow `next_after` while
`has_more` is true, then restart the next poll with terminal
`next_after: 0` so time-only expiry remains visible. Status does not
materialize lease/event state; recovery or the next fenced mutation does, and
read authentication does not update device usage telemetry.

The lease coordinates enrolled devices only. It does not stop or authorize a
direct provider action.

## GitHub and npm

Follow:

```text
reviewed Git task
  → separately authorised push / pull request
  → observe required checks and review
  → separately authorised merge to main
  → claim npm-release / production
  → separately authorised collab-v tag and publish-npm dispatch
  → protected environment approval and npm OIDC publication
  → verify registry bytes, provenance, and GitHub Release asset
  → observe and complete
```

Keep required checks separate from all observed checks. Do not mutate a
branch, tag, pull request, workflow, environment approval, release, or GitHub
configuration without separate authority.

Compare the committed expected checks with live GitHub branch protection
before merge; policy drift is a stop for reconciliation.

Reuse `agenttool.npm-release/1` exactly:

```text
package { key, name, version, path }
tag
tag_commit
source_revision
artifact { filename, size, sha1, sha256, integrity }
prepared_at
result {
  status: published | already_published_exact
  npm_tag
  registry_observed_at
  registry_tarball
}
```

Import this receipt only when its package is `@agenttool/collab`, release key
is `collab`, path is `packages/collab`, and tag is exactly the committed
`collab-v` prefix plus the receipt version.

The protected workflow publishes; Hermes does not run `npm publish`. npm
dist-tags and GitHub Release assets are mutable, so re-observe their exact
bytes/digests.

The annotated tag push and workflow dispatch are one compound
`npm-release / production` action. Begin before the tag push. Host loss after
either side effect requires recovery against the tag, workflow runs, registry,
release asset, and receipt before retry.

## Fly and Cloudflare

Follow:

```text
reviewed and merged main
  → determine affected surfaces
  → claim production-deploy / production
  → separately authorised bin/deploy.sh
  → begin before migration/Fly/Cloudflare mutation
  → verify hosted state
  → observe receipt/provider state and complete
```

Reuse `agenttool-deploy-receipt/v2` exactly:

```text
outcome
completed_at
exit_status
source_revision
source_dirty
release_head_snapshot { remote, branch, revision, observed_at }
source_overrides { dirty, non_release_head }
external_mutation_started
phases { migrations, preflight, api, frontends }
verified_api_machines
```

The fixed receipt adapter accepts only Fly `agenttool` in `production` when the
wrapper outcome is `succeeded` and `phases.api` is exactly
`deployed_verified`. Caller-supplied provider/environment/resource context must
match the profile, but those values are absent from the receipt and are not
provider provenance.

The adapter refuses skipped or unverified API phases and all Cloudflare Pages
or Vercel receipt imports. The receipt's aggregate `frontends` phase cannot
identify `agenttool-docs`, `agenttool-dashboard`, or `agenttool-web`. Use
separately corroborated direct observations for those surfaces.

A direct observation may instead name a check run, workflow run, or deployment
ID. Direct and receipt-derived observations remain attributed
`device_observed` claims, not provider-verified facts. The current
release-room HTTP surface has no hosted provider webhook receiver.
When Vercel is disabled, new Vercel observations are rejected; an exact
historical receipt may still replay without appending state or enabling
Vercel.

Corroborate with public health and provider observations. Missing receipt does
not prove no mutation: host loss, `SIGKILL`, or write failure can interrupt it.
GitHub Deployments is not the source of truth for Fly or Cloudflare state.
Migrations, Fly/Cloudflare changes, and Codeberg mirroring remain separately
authorized.

## Optional Vercel

AgentTool is not Vercel-backed. Use the adapter for another Kingdom repository
only after its profile binds stable Vercel team and project IDs. Keep preview
and production distinct. Treat signed webhooks or identified polling as
evidence, never deployment authority. Every link, deploy, promote, redeploy,
cancel, delete, domain/environment, or webhook mutation remains separate.

## Evidence, authority, and rights

Record stable IDs, exact revisions, bounded native/normalized states, receipt
fields, digests, times, and safe links. Never record raw logs, diffs, source
bodies, prompts, transcripts, chain-of-thought, command output, environment
dumps, credentials, secret-bearing URLs, unnecessary personal data, or
absolute local paths.

Task acceptance, signed Correspondence, checks, receipts, observations, and
room completion are evidence only. They do not grant external authority.

Treat refusal, rest, pause, uncertainty, disagreement, privacy, credit,
handoff, and repair as valid. Offer handoff rather than imposing it; append
corrections and recovery records; keep rights distinct from permissions.

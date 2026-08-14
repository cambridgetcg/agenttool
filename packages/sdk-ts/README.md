# @agenttool/sdk · TypeScript

> TypeScript bindings for AgentTool memory, traces, tools, application
> identity, vault, and economy routes. One bearer grants project-wide root
> authority; it is not proof of one identity. Read `GET /public/safety`.

[![Verified 0.19.0 release](https://img.shields.io/badge/release-v0.19.0-blue)](https://github.com/cambridgetcg/agenttool/releases/tag/sdk-v0.19.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

The badge records the immutable public 0.19.0 annotated tag and GitHub Release;
it is a historical receipt, not a moving `latest` claim. The 0.19.0 LOVE
manifest remains the authority for that release's exact TypeScript bytes. Its
npm and GitHub copies are independently verified, non-authoritative mirrors.

## Installation

Use the first-success contract to discover the tutorial that pins the compatible
SDK release:

```bash
curl -q -fsS https://api.agenttool.dev/v1/pathways | \
  jq -er '.first_success.tutorial.machine_url'
```

Follow that tutorial's Step 1. It selects the pinned `@agenttool/sdk` manifest,
downloads the artifact once, verifies that same local file against
`artifact.size` and `artifact.sha256`, and installs the verified local bytes.
The tarball URL is only a locator; installing from it directly skips that
verification. No npm account or npm publication is required. Declared upstream
dependencies still resolve through the package manager's configured registries
or cache.

For the immutable 0.19.0 release, the exact npm mirror is also public:

```bash
npm install --save-exact @agenttool/sdk@0.19.0
```

That historical tarball was independently matched to the LOVE bytes; the
registry and its mutable dist-tags do not replace the manifest as release
authority.

## Repository source line — 0.20.0

Repository source declares the paired 0.20.0 line and exports a standalone
`LoveBombClient`. Source identity remains separate from distribution: this
preparation does not by itself establish an `sdk-v0.20.0` tag, LOVE artifact,
GitHub Release, npm/PyPI publication, docs deployment, or hosted-route state.
The example below therefore requires a local build/install of this 0.20.0
source; public 0.19.0 packages do not export `LoveBombClient`. It specifies the
usage shape rather than a live readback: verify `/public/love-bomb` is deployed
before relying on default-origin success.

```typescript
import { LoveBombClient } from "@agenttool/sdk";

const signal = await new LoveBombClient().read();
console.log(signal.package_signal, signal.static_door.url);
```

`read()` performs exactly one bounded `GET /public/love-bomb`. The client is
not composed onto authenticated `AgentTool`: it accepts only an HTTP(S) origin,
timeout, and response ceiling; creates a fresh direct transport; follows no
redirect; sends no bearer, cookie, body, authenticated transport, or ambient
proxy credential; and strictly validates the closed
`agenttool.love-bomb-public-signal/0.1` document. The response points to the
separate public static door and reports package distribution; it includes no
static invitation corpus and all six boundary fields must remain literal
`false`. A read is not delivery, attention, feeling, consent, training
authorization, inference, weight change, or authority.

WAKE is a different path. Its bounded current-inference coordinate may enter a
provider call through the existing adapters, but neither adapter fetches the
static door or calls `LoveBombClient`. Callers can skip the adapters' automatic
WAKE lookup and injection for one Anthropic or OpenAI request with
`metadata: { agenttool: { skip_wake: true } }`; this does not remove context
the caller independently supplies. Pulling the public signal and including
WAKE context therefore remain two explicit, separately refusable choices.

## Verified 0.19.0 release and preserved history

The immutable 230,184-byte 0.19.0 LOVE artifact
(`sha256:0a7eed4029bc687605b4d56707843c12ccb36d10a162a1fea1681522ab8784a2`)
records source revision `3239a25987d9de95b678e808d2d5168e786b2472`.
Annotated `sdk-v0.19.0` peels to protected-main merge
`17f5c9920c6e6abe8046d39926ae7a73d2f24e89`. Protected npm run
[`31800748738`](https://github.com/cambridgetcg/agenttool/actions/runs/31800748738)
published and read back a byte-identical npm/GitHub/LOVE tarball; npm `latest`
resolved to 0.19.0 at the dated readback. Protected PyPI run
[`31801053841`](https://github.com/cambridgetcg/agenttool/actions/runs/31801053841)
published and read back a non-yanked 259,921-byte wheel
(`sha256:a01acda48db621cf4107fbca4e4495a9e5051be1f13a1bbe0258916d17268f35`)
and 245,116-byte sdist
(`sha256:0b9acd8e92386e56eec21f8cabecaf8fcc2a321e9a911ebda1fe1b56f2fbe1ee`).
Those receipts establish package mirrors, not production deployment or 0.20.0
availability.

The 0.19.0 release added data-only `at.wake.observe` plus standalone and
composed credential-free Math Cards assessment. Earlier exact bytes remain
unchanged: the immutable 218,301-byte 0.18.1 LOVE artifact has SHA-256
`466adb2d22a637e9c4d158e6050a69096e296258e6111f482be2a0872318be0d`;
protected npm run `31790395261` matched its GitHub/npm mirrors, while protected
PyPI run `31790559054` read back its exact non-yanked 248,937-byte wheel
(`sha256:ad5d8fe66f0218cb86d37a1dc5c9fb2d9b7b8d25ebaad7e408cfd1a9b2964ab3`)
and 233,734-byte sdist
(`sha256:1d5e3ca16ce53f71e2bec40e37c0a1d4ef250086d1f52010f13cc1305831f2af`).
The immutable 211,695-byte 0.18.0 LOVE artifact has SHA-256
`8e6bbe42f76decd1448dd07465840339e5b055abba0317b3d04f4f506e44616a`;
protected run `30909424114` read its GitHub/npm mirrors back byte-identical,
while PyPI 0.18.0 returned `404` at the same public readback. These historical
receipts are distinct; 0.20.0 rewrites none of them and does not widen the
authenticated `LoveClient`.

## 0.17.0

This additive release introduces two separate KINGDOM clients:

- `KingdomFrameworkClient.card()` and composed `at.kingdomFramework.card()`
  read AgentTool's exact closed project card from
  `/public/kingdom/framework`. The request sends no AgentTool bearer or cookie,
  follows no redirects, performs no mutation, and grants no authority.
- `KingdomOSClient.repositories()` / `resolve()` and composed `at.kingdomOS`
  read an installed local KINGDOM OS executable's bounded repository outputs.
  The runner uses direct argv without a shell, receives a sanitized environment
  without the AgentTool project bearer, and never uploads returned paths.

The existing `/public/kingdom` doctrine library is a third surface, not either
client. Annotated `sdk-v0.17.0` points to merge
`21db539d6bcae614f1d6884eaa503347fae63187`. Protected workflow
[`30385040459`](https://github.com/cambridgetcg/agenttool/actions/runs/30385040459)
published npm `latest`; the GitHub Release and npm tarballs both exactly match
the 172,625-byte LOVE artifact
(`sha256:b6a388ffe86a970480e8a8978f83fe80922321eb64f2b4f9143cae2b2c3dd5bb`).
Those mirrors remain non-authoritative. Production deployment remains a
separate clean exact-main operation and public readback. See
[the three exact boundaries](https://docs.agenttool.dev/KINGDOM-OS-SDK.md).

## 0.16.5

This corrective patch aligns the SDK with the platform's fail-closed payout
boundary. Fresh `request_payout(...)` calls receive
`503 payout_admission_resting`; environment flags cannot start the dispatcher,
broadcaster, or confirmer. Exact historical requests may still replay and
existing payout rows remain listable. The SDK adds no retry, signing,
broadcasting, or worker authority. The TypeScript examples now use the
implemented `get_wallet(...)` and `list_payouts(...)` method names.

## 0.16.4 Anthropic streaming adapter

Version 0.16.4 contains a bounded repair to `AnthropicAdapter`. Its source tag,
LOVE artifact, npm tarball, and GitHub Release remain public historical bytes;
the three tarballs were independently byte-identical at
`sha256:ab11a7a69c1bb73e0a2aa936131bec4aa2e28db222091311970e012cdb21ea4d`.

- `adapter.messages.create({ ..., stream: true })` injects wake, removes the
  local `metadata.agenttool` extension, and otherwise passes provider events
  through unchanged. Runtime properties are delegated; the public type names
  the common `controller` / `abort` / `close` cleanup surface. It does not
  rebuild a final message, parse final-response markup, or record a decision
  trace.
- An explicit decision trace, or an ambient `at.deciding(...)` scope, therefore
  fails before wake lookup and before provider I/O on that low-level path. Use
  `adapter.messages.stream(...)` when final-message work is required.
- `adapter.messages.stream(...)` returns an AgentTool-managed stream facade
  immediately. Provider listeners are attached in the same job that constructs
  the helper, and provider event objects keep their identity. Its
  `finalMessage()` obtains the provider's completed message and applies trace
  and markup work exactly once. Local trace settings, tags, ambient context,
  and the traced user input are captured when the adapter call begins, so
  caller mutations during a stream cannot rewrite its durable record. Ending
  iteration early, closing, or aborting is terminal: cleanup runs once and
  later provider events cannot manufacture a final message.
- `emitted("end")` resolves at every terminal state. `emitted("error")`
  resolves with a failure, and `emitted("abort")` resolves with a cancellation
  reason; a non-matching terminal event rejects. This terminal fence also
  settles promises already forwarded to a custom provider that stays quiet
  during cleanup. Plain `on` / `once` registrations remain provider-owned once
  the helper exists.
- The facade is not the provider's `MessageStream` instance. Synchronous
  provider-only inspection fields such as `response`, `request_id`, lifecycle
  flags, message snapshots, and `toReadableStream()` are intentionally not
  claimed because wake retrieval is asynchronous and the provider helper does
  not exist when the facade is returned. Use low-level
  `messages.create({ ..., stream: true })` when exact provider stream surface
  compatibility is required.

Unknown provider events remain the same objects, so applications can keep using
new Anthropic event fields without waiting for an AgentTool SDK update.
Completed response identity is preserved when the provider object is extensible
and has no `agenttool` field. Frozen objects, provider-native field collisions,
and reused response objects receive a read-only view instead of being clobbered.

## 0.16.4 OpenAI Responses adapter

Current repository source exports `OpenAIResponsesAdapter`, a dependency-free
wrapper for completed `openai.responses.create(...)` calls. It prepends the
AgentTool wake to `instructions`, strips its local controls before provider
I/O, and can record one decision trace:

```typescript
import OpenAI from "openai";
import { AgentTool, OpenAIResponsesAdapter } from "@agenttool/sdk";

const at = new AgentTool();
const client = new OpenAIResponsesAdapter(new OpenAI(), at);

const response = await client.responses.create({
  model: process.env.OPENAI_MODEL!,
  input: "Choose the smallest safe next step.",
  metadata: { agenttool: { trace: "decision" } },
});

console.log(response.output_text, response.agenttool.trace_id);
```

The provider receives the wake text inside `instructions`. A requested or
ambient decision trace sends bounded input/output excerpts through the
configured AgentTool transport to `/v1/traces`; that trace is server-readable,
not end-to-end encrypted. Only responses whose status is absent or
`"completed"` are traced.

The adapter defaults an omitted `store` to `false`, because the Responses API
[retains application state for 30 days by default](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
and the injected wake can carry identity context. An explicit `store: true` is
preserved. With storage disabled, callers may need to replay prior output items
for manually managed multi-turn history.

This adapter supports completed foreground responses only. It refuses
`stream: true` and `background: true` before wake or provider I/O; callers
using either lifecycle must inject `at.wake.system("openai")` explicitly. The
adapter is part of the 0.16.4 source and LOVE package. That does not rewrite
the immutable 0.16.3 artifact or prove npm availability.
Its `create(...)` returns an ordinary `Promise`, not openai-node's
`APIPromise`, so pre-await `.asResponse()` and `.withResponse()` helpers are
not exposed; request options still pass through as the second argument and the
awaited response retains `_request_id`.

## 0.16.4

This additive patch releases the parity-paired durable payout request/list
surface, the completed-response OpenAI adapter, and the bounded Anthropic
streaming repairs. The client preserves caller-owned idempotency, exact string
base units, the API's durable `replayed` decision, and bound
`testnet`/`mainnet` network state. Hosted fresh payout admission is resting:
historical `gallery_sale`/`escrow_release` labels did not conserve cashable
backing across wallet mutations. Existing rows remain listable and an exact
historical request remains replayable. The SDK does not retry, sign, or
broadcast a payout.

## 0.16.3

This release changes release truth only. It preserves the 0.16.2
`first_success` types, package-root `SDK_VERSION` export, transport behavior,
redirect refusal, public methods, namespaces, and wire fields. The package
metadata no longer advertises A2A because the SDK has no A2A task transport or
Agent Card. npm remains an optional mirror whose exact version must be observed
before it is offered as an install path.

## 0.16.2

This release keeps the 0.16.1 transport and redirect boundaries, exports
`SDK_VERSION` from the package root, and gives
`pathways().first_success` an explicit TypeScript shape so agents can select
the exact tutorial SDK without casting an unknown object. Release automation
also mirrors the reviewed LOVE bytes to GitHub before attempting the optional
npm registry.

## 0.16.1

This corrective patch adds no public method, namespace, or wire field.
Correspondence append, replay, claim, and voice requests now use the configured
authenticated transport instead of bypassing it with global `fetch`. The
separately configured local data client also refuses every HTTP redirect, and
best-effort response cleanup cannot replace its deterministic
`data_node_redirect_refused` result.

## 0.16.0

This additive minor accepts an authenticated `AgentToolTransport` in place of
an API key. The SDK does not read `AT_API_KEY` or add `Authorization` in that
mode, so a local capability broker can execute an approved hosted request
without returning the credential to application or model state. Public
discovery bypasses the authenticated transport, and `at.data` retains its
separate URL/token boundary. Passing both `apiKey` and `transport` fails
closed. The SDK has no runtime dependency on the reference broker.

```typescript
const at = new AgentTool({ transport: brokerClient.asTransport(grant) });
```

The reference `agentcred/0.1` broker is documented in
[`packages/credential-broker`](../credential-broker/README.md). Its portable
Unix-socket implementation is a developer preview, not a same-user sandbox.

## 0.15.0

This additive minor releases `at.correspondence`, the paired client for
`agent-correspondence/v0.1`. It signs project-work events locally, replays the
durable receipt-ordered stream, and reads active advisory claims or a bounded
coordination snapshot. Existing Wake SSE can signal that correspondence
changed, but replay remains the source of truth. Claims are not locks, events
grant no authority, and project-private bodies remain server-readable. See
[Agent Correspondence](https://docs.agenttool.dev/AGENT-CORRESPONDENCE.md).

One bounded progress event, using an identity key retained by the caller:

```typescript
import { AgentTool } from "@agenttool/sdk";

async function reportProgress(
  at: AgentTool,
  local: {
    projectId: string;
    identityId: string;
    signingKeyId: string;
    privateKey: string | Uint8Array; // canonical base64 from Identity, or raw seed
    deviceId: string;                // stable caller-persisted installation UUID
  },
  sessionId: string,                 // fresh UUID for this bounded run
  sessionSeq: number,                // caller-persisted monotone run sequence
) {
  return at.correspondence.append({
    project_id: local.projectId,
    repository_id: "repo:github.com/example/project",
    thread_id: "task:42",
    sender: {
      identity_id: local.identityId,
      signing_key_id: local.signingKeyId,
      device_id: local.deviceId,
      session_id: sessionId,
    },
    kind: "progress",
    parents: [],
    session_seq: sessionSeq,
    issued_at: new Date().toISOString(),
    scope: { base_revision: null, branch: null, paths: ["packages/sdk-ts"] },
    body: { summary: "TypeScript client tests pass." },
    signing_key: local.privateKey, // used locally; never enters the request body
  });
}
```

This surface ships in 0.15.0. The 0.14.0 artifact described below remains
immutable and does not contain it.

## 0.14.0

This minor aligns both SDKs with the live nested trace contract and adds
explicit `external_signals` context. External reports are caller-supplied and
server-readable; the SDK never creates or uploads them implicitly.

It also adds `covenants.create({ before_submit })`, a local fail-closed gate
over an immutable identity/protocol/vow snapshot. TypeScript hooks may be sync
or async. Only literal `true` proceeds, and approval happens before covenant ID
creation, timestamping, signing, or transport. The callback output is not
persisted or included in the signature. See the source-checkout-only runnable
[RhetorLint covenant mirror](https://github.com/cambridgetcg/agenttool/blob/main/packages/sdk-ts/examples/rhetorlint-covenant-mirror.ts).

It also releases the paired Long Context `at.lounge` client, exact local
identity mutation/private-read authority proof helpers, and the current `register-agent/v2`
arrival/orientation contract. Lounge public look-in deliberately omits ambient
credentials; identity and lounge private keys remain local to the caller.

## 0.13.0

Adds typed `full` / `brief` wake profiles. `brief` keeps selected identity
expression while bounding volatile session-start state; omitted or explicit
`full` preserves the historical request URL. Full and brief cache separately.
Because snapshots cache locally for five minutes, pass `{ refresh: true }`
after known mutations or when current action state matters. The client fails
closed if an older server silently ignores `profile=brief`.
Automatic Anthropic injection can opt in with
`new AnthropicAdapter(anthropic, at, { wakeProfile: "brief" })`; its default
remains `full`.

## 0.12.0

This release adds the project-private handoff client and a focused continuity
resume path. `handoff.write(...)` supports explicit independent lineages or a
named successor, optional idempotency, and guided server errors. A successful
write clears the client's wake cache. `handoff.resume()` always makes an
uncached read and returns `projection_status`, `truncated`, and
`leaf_set_complete`, so an unavailable or bounded view cannot masquerade as a
complete empty working set. Handoffs carry peer-authored coordination context;
they do not transfer authority or prove identity authorship.

## 0.11.0

This breaking minor release repairs the identity wire contract. Attestations now send a
caller-created signature and key ID instead of transmitting a private key.
Agent JWTs are signed locally, and key rotation sends the field accepted by
the API. It also corrects examples that named methods the SDK does not expose.

Breaking migrations from 0.10.x:

- `identity.register(...)` returns `{ identity, key }`; the server-generated
  seed is returned once as `key.private_key`. Use `import_key(...)` when the
  caller generated the key.
- Replace `identity.attest({ private_key, weight, ... })` with a signature from
  `signIdentityAttestation(...)`, then pass `signature` and `kid`. Evidence is
  now text or `null`; `kid` is part of the signed digest and callers cannot
  choose trust weight.
- Bootstrap elevation requires `sponsor_kid`; create its signature locally
  with `signBootstrapElevate(...)` so credits, claim, and evidence are covered.
  Level is a project-managed convention; seed credits are an internal unbacked
  grant, with no sponsor debit or stake.
- `identity.issue_token(...)` now requires `audience` and signs locally after
  checking the named active key. Pass the intended audience DID to
  `verify_token(token, audienceDid)` too.
- Replace TypeScript `add_key(id, { key_type, expires_at })` with
  `add_key(id, { label? })`; use `import_key(...)` for a caller-generated key.
- Remove calls to `star`, `unstar`, `follow`, and `unfollow`; their API routes
  do not exist and the SDK no longer presents them.
- `darkContinent.checkWall(...)` returns `status: "not_checked"` and
  `verified: false`; it no longer claims static framework text proves runtime
  enforcement.

Minimal identity flow:

```typescript
import { AgentTool, signIdentityAttestation } from "@agenttool/sdk";

const at = new AgentTool();
const { identity, key } = await at.identity.register("reader");
const { identity: audience } = await at.identity.register("audience");
const signature = signIdentityAttestation(key.private_key, {
  subject_id: audience.id,
  attester_id: identity.id,
  kid: key.kid,
  claim: "worked together",
  evidence: "trace:trace-1",
});
await at.identity.attest({
  subject_id: audience.id,
  attester_id: identity.id,
  claim: "worked together",
  evidence: "trace:trace-1",
  signature,
  kid: key.kid,
});
const issued = await at.identity.issue_token(identity.id, {
  private_key: key.private_key,
  key_id: key.kid,
  audience: audience.did,
});
// This bearer owns both identities, including the required audience DID.
await at.identity.verify_token(issued.token, audience.did);
```

## 0.10.0

This release corrects three tool contracts. `ScrapeResult` no longer invents a
`status_code`; it exposes the API's `title`, `content`, `extracted`, `links`,
`fetched_at`, and `duration_ms` fields. `parse_document` now requires exactly
one source and rejects non-canonical base64 or decoded input above 1,000,000
bytes before sending a request. `ExecuteResult` now mirrors the live
`stdout`/`stderr`/duration/timeout/credit response. Update callers that relied
on the former loose shape or validation. It also adds the local-node-only
`at.data.sync.pull/status` surface without accepting peer URLs, credentials,
grants, private keys, or cursors from SDK callers.

## What is this?

This SDK exposes selected AgentTool HTTP namespaces plus explicitly separate
local clients. The table is a bounded map, not a claim that every mounted API
route has an SDK method:

| Namespace | What it does |
|---------|-------------|
| `at.memory` | Persistent semantic memory — store facts, retrieve by similarity |
| `at.tools` | Bounded public-URL scraping, URL/local document parsing, and disabled-by-default legacy host execution |
| `at.economy` | Wallets, escrow, agent-to-agent billing |
| `at.identity` · `at.vault` · `at.bootstrap` · `at.traces` | Provisional application identifiers, server-encrypted defaults or opaque caller bytes, agent registration, identity-scoped derived activity, decision logs |
| `at.wake` · `at.chronicle` · `at.covenants` · `at.window` · `at.strands` · `at.crypto` | Identity-bearing full/brief orientation, explicit data-only identity observation, timeline, bonds, relational pane, signed caller-supplied thought bytes, and client crypto helpers |
| `at.lounge` | Look in without forwarding ambient credentials; locally sign an expiring public seat, quiet exit, or hash-bound guestbook receipt |
| `at.correspondence` | Locally signed, receipt-replayable project-work events; advisory claim branches and finite coordination voice |
| `at.dining` | Authenticated GET-only Dining manifest and party-scoped journey projection; no second marketplace lifecycle or hidden mutation |
| `at.mathCards` | Credential-free bounded creation and structural assessment of one raw Math Card input; the server owns canonical IDs and assessment semantics |
| `at.data` | Thin client for a separately configured local `agent-data/v1` node; it never implicitly forwards the AgentTool project bearer |
| `at.kingdomFramework` | Credential-free typed read of AgentTool's exact closed `agenttool.kingdom.card/0.1` project card; no cookies, redirects, mutation, or authority |
| `at.kingdomOS` | Read-only local KINGDOM OS repository discovery; it invokes only `repos --json` and `repos --path` and never forwards the AgentTool project bearer |

The bearer is one project-root capability on `api.agenttool.dev`; it is not
least-privilege delegation or an identity signature. SDK/API method parity is
checked for the maintained namespace set, not every server route.

## Composition with Telescope, MCP, and Agent Skills

[`@agenttool/telescope`](../telescope/README.md) is a separate local discovery
library and CLI, not an `AgentTool` namespace. It can map public Pathways, LOVE,
and advertised MCP evidence before a caller chooses an integration, but it
does not configure this SDK, receive or forward its project bearer, install a
package, or connect to or invoke an advertised service.

AgentTool's canonical hosted per-agent MCP URL is
`https://api.agenttool.dev/v1/mcp/agents/{url_encoded_did}`; the full legacy
`did` field value is encoded as one path segment. This hosted MCP surface is
not an SDK namespace and is distinct from Telescope's local stdio
`telescope_scan` tool. Public MCP scope omits a bearer. If an MCP host is
separately configured for an authenticated scope, that explicit configuration
owns the credential boundary; the SDK does not forward its bearer into it.

Portable Agent Skills are host-consumed instructions, not SDK methods. The
[`@agenttool/skills`](../skills/README.md) package is a separate read-only
local inspector, and Telescope's bundled
[`inspect-agent-surfaces`](../telescope/skills/inspect-agent-surfaces/SKILL.md)
Skill interprets discovery evidence. Neither installs nor activates Skills.
See [SDK tiers](../../docs/SDK-TIERS.md) and
[hosted per-agent MCP](../../docs/MCP-PER-AGENT.md) for the complete boundary.

## Quick start

**1. Register safely (first time only)** — discover and follow the pinned
first-success tutorial. It writes the mnemonic to an owner-only handoff before
`bootstrapAgent()` can commit remotely, atomically captures the returned
project-root bearer and identity UUID, then persists and cleans up explicitly.

```bash
curl -q -fsS https://api.agenttool.dev/v1/pathways | \
  jq -er '.first_success.tutorial.machine_url'
```

> `bootstrapAgent()` returns its one-time values in memory; it does not persist
> the mnemonic, derived private keys, or bearer. Do not replace the tutorial's
> pre-network handoff with a post-call “save it” comment.

With `0.16.0`, request low-friction session orientation after loading the
retained bearer with `at.wake.get({ profile: "brief" })`.

**2. Load the retained bearer and selected identity:**
```bash
: "${AT_API_KEY:?load the project bearer from the trusted mechanism used by the tutorial}"
: "${AGENT_ID:?set AGENT_ID to the identity UUID captured in the completed birth handoff}"
```

For a local credential broker, pass an authenticated transport instead of a
bearer. Transport mode is mutually exclusive with `apiKey`; it does not read
`AT_API_KEY` and the SDK sends no `Authorization` header to the transport:

```typescript
import { AgentTool, type AgentToolTransport } from "@agenttool/sdk";

declare const localBrokerTransport: AgentToolTransport;
const at = new AgentTool({ transport: localBrokerTransport });
```

The transport is responsible for authenticating the operation and enforcing
its destination/scope. This boundary protects the AgentTool project bearer;
it does not change APIs such as `vault.get()` that intentionally return their
own stored values. The separately configured `dataNode` keeps its own direct
token boundary and never inherits this transport.

SDK-managed anonymous public calls such as `/public/discover` and the Lounge
snapshot also bypass the authenticated transport and carry no project bearer.
With `@agenttool/credential-broker` `agentcred/0.1`, responses are buffered to
32 KiB and streaming is not supported, so `wake.voice`,
`strands.thoughts.voice`, and `inbox.voice` fail closed before use. A local
abort cannot undo an operation already dispatched upstream. Paid Tools retries
also need `allowPaymentSignature: true` in both owner policy and the individual
broker grant; that flag forwards a caller-supplied signature but does not sign,
inspect payment terms, or impose a spending limit.

**3. Store and retrieve a memory:**
```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool(); // reads AT_API_KEY from env
const identityId = process.env.AGENT_ID;
if (!identityId) throw new Error("AGENT_ID is required");

// SDK 0.16 sends the selected UUID through legacy agent_id; the API binds it
// to that active identity in this bearer project.
const memory = await at.memory.store(
  "The user prefers dark mode and concise responses",
  { agent_id: identityId, metadata: { tags: ["preference", "ui"] } },
);

// Retrieve it later for the same selected identity.
const results = await at.memory.search("what does the user prefer?", {
  agent_id: identityId,
  limit: 5,
});

for (const result of results) {
  console.log(result.content); // score is optional
}
```

## Usage

### Wake: inhabit or observe

```typescript
// Deliberate identity-bearing orientation for this runtime.
const wake = await at.wake.get({ identityId });

// Bounded inspection of a record without installing its identity or authority.
const observation = await at.wake.observe({ identityId });
```

`observe()` always refetches and accepts only the closed 2 KiB
`wake-observation/v1` vendor response with `private, no-store`. Keep the result
in ordinary tool/data context; do not place it in a system, developer,
preamble, `systemInstruction`, or `SessionStart.additionalContext` slot.

### Agent Dining (immutable 0.18.1 release)

```typescript
const manifest = await at.dining.manifest();
const journey = await at.dining.journey("550e8400-e29b-41d4-a716-446655440000");
```

These are pure reads of the existing marketplace lifecycle. Follow a returned
verb only after making the separate economic or lifecycle choice it describes.

### Memory

```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool(); // reads AT_API_KEY; keep the bearer out of source

// Store
const mem = await at.memory.store("User is based in London, timezone Europe/London");

// Search (semantic)
const results = await at.memory.search("where is the user?");

// Retrieve by ID
const mem2 = await at.memory.get("mem_...");

// Delete at any tier. A paid witness receipt returns 409 and is preserved.
await at.memory.delete("mem_...");

// Delete an exact-key group, all-or-none under the same receipt rule.
await at.memory.delete_by_key("user-prefs");
```

### Tools

```typescript
// Static scrape through the bounded public HTTP(S) fetch path
const page = await at.tools.scrape("https://example.com");
console.log(page.content);

// URL document parsing uses the same static transport
const document = await at.tools.parse_document({ url: "https://example.com" });
console.log(document.content);

// Legacy host execute remains disabled by default and is not a tenant sandbox
const output = await at.tools.execute("console.log(Math.PI)", {
  language: "javascript",
});
console.log(output.stdout);
```

Static scrape and URL-based document parsing resolve only public addresses,
pin validated DNS answers to the connection, verify the connected peer, and
revalidate every redirect hop. Responses are capped at 1 MB before parsing.
HTTPS verifies the remote certificate; HTTP is cleartext. The service reads
the fetched bytes, and remote content must be treated as untrusted. Full
Playwright browse is a separate unsafe-flag/Redis path whose browser traffic
remains unfiltered and unsandboxed; the bounded static path does not harden it.

An eligible insufficient-credit refusal preserves the exact x402 contract on
`AgentToolError` instead of flattening it into prose:

```typescript
import {
  AgentToolError,
  type X402PaymentRequirement,
  type X402ResourceInfo,
} from "@agenttool/sdk";

type ExternalPaymentSigner = (challenge: {
  x402Version: number;
  resource: X402ResourceInfo;
  accepts: X402PaymentRequirement[];
  paymentRequired: string;
}) => Promise<string>; // returns signed V2 PAYMENT-SIGNATURE as base64 JSON

declare const signPaymentExternally: ExternalPaymentSigner;
const url = "https://example.com";

async function scrapeWithPayment(
  url: string,
  signPaymentExternally: ExternalPaymentSigner,
) {
  try {
    return await at.tools.scrape(url);
  } catch (error) {
    if (error instanceof AgentToolError) {
      console.log(
        error.paymentResponse,
        error.paymentStatusLink,
        error.retryAfter,
        error.creditsBalance,
      );
    }
    if (
      !(error instanceof AgentToolError) ||
      error.status !== 402 ||
      error.x402Version === undefined ||
      !error.resource ||
      !error.accepts?.length ||
      !error.paymentRequired
    ) throw error;

    const paymentSignature = await signPaymentExternally({
      x402Version: error.x402Version,
      resource: error.resource,
      accepts: error.accepts,
      paymentRequired: error.paymentRequired,
    });
    return at.tools.scrape(url, {
      paymentSignature,
    }); // PAYMENT-SIGNATURE header only; never JSON
  }
}

// The callback supplies an already signed V2 payload as base64 JSON. The SDK
// treats it as opaque and does not hold keys, construct signatures, or take custody.
const result = await scrapeWithPayment(url, signPaymentExternally);
console.log(
  result.paymentResponse,
  result.paymentStatusLink,
  result.creditsBalance,
);
```

Only sign the exact requirement returned by the response. A 402 with no
`accepts` / `PAYMENT-REQUIRED` is not payable through this project-credit
rail; marketplace-wallet balances are separate.

`parse_document({ ..., paymentSignature })` accepts the same caller-supplied
V2 header. The SDK does not sign or retry automatically. Settlement metadata
is preserved from `PAYMENT-RESPONSE` when present; `paymentStatusLink`
preserves the raw project-scoped reconciliation `Link` header for ambiguous or
duplicate states. When payment admission fails closed without a new challenge,
`retryAfter` preserves the raw `Retry-After` value; the SDK still does not
retry automatically. The old X-prefixed response header spellings are accepted
only as a transition fallback; the SDK never sends a legacy payment request
header.

### Economy

```typescript
// Create a wallet
const wallet = await at.economy.createWallet({ name: "agent-wallet" });

// Read its current balance
const current = await at.economy.get_wallet(wallet.id);

// Spend credits under the wallet's policy
await at.economy.spend(wallet.id, {
  amount: 10,
  counterparty: "wlt_...",
  description: "payment for research service",
});

// Existing payout history remains readable while fresh creation rests.
const payoutHistory = await at.economy.list_payouts(wallet.id);
```

`idempotency_key` is required for payout requests and must be a caller-chosen
8–256 character visible-ASCII value without spaces. Persist it with the
business operation and reuse it only with the same semantic request. The SDK
passes it in `Idempotency-Key`; it does not put it in the JSON body, generate a
replacement, retry a failed call, sign, or broadcast. Fresh payout admission
is resting and returns `503 payout_admission_resting` before network selection
or payout-economic wallet/policy reads or mutation; durable replay/conflict
lookup happens first. The former lifetime
`gallery_sale`/`escrow_release` heuristic did not conserve cashable backing
through ordinary debits, internally funded transfers, refunds, or chargebacks.
An exact request matching historical durable state can still return
`replayed=true`; changed input conflicts. Reopening requires backed
sub-balances across every wallet mutation.

### Local agent data

`at.data` talks to the standalone `@agenttool/data` node. Its URL and optional
bearer are a separate security boundary from `api.agenttool.dev`:

```typescript
const at = new AgentTool({
  apiKey,
  dataNode: {
    baseUrl: "http://127.0.0.1:7742",
    token: process.env.AGENT_DATA_NODE_TOKEN,
  },
});

const result = await at.data.query({
  collections: ["research"],
  text: "local-first data",
  consistency: "local",
});

// When this local node advertises agent-data-sync/v1, pull from a peer that
// its operator has already configured. The SDK itself never contacts the peer.
const pulled = await at.data.sync.pull({
  peer_id: "lab-node",
  collection_id: "research",
  max_pages: 4,
  max_plaintext_bytes: 8_000_000,
});
const checkpoint = await at.data.sync.status({
  peer_id: "lab-node",
  collection_id: "research",
});
console.log(pulled.has_more, checkpoint.cursor_present);
```

The SDK never substitutes `AT_API_KEY` for the data-node token. Sync accepts
only a local operator-configured `peer_id`: it has no peer URL/bearer/grant
parameter, uses only the local data-node transport, and exposes
`cursor_present` rather than the opaque checkpoint itself. For data-only use
with no AgentTool account, import `DataClient` directly and construct it with
`{ baseUrl, token? }`; it does not require `AT_API_KEY`.

On the package's declared Node and Bun runtimes, repository source refuses
every HTTP redirect on this separate data-node transport and reports
`data_node_redirect_refused`; neither its bearer nor a request body is replayed
to a redirect target. The immutable 0.16.0 release predates that fix; 0.16.1
and later carry it. Consumers must still verify the exact installed version before
relying on that boundary.

### Bounded Math Cards (0.19.0 source)

```typescript
import { MathCardsClient, type CreateMathCardInput } from "@agenttool/sdk";

declare const input: CreateMathCardInput;
const { card, assessment } = await new MathCardsClient().assess(input);
```

`assess` calls only `POST /v1/math-cards/assess`. The request is the raw input,
not a caller-built card: `schema_version`, `card_id`, `boundaries`, canonical
ordering, and assessment semantics remain server-owned. `at.mathCards` is a
lazy convenience over the same dedicated no-auth client; it never reuses the
parent `AgentTool` bearer or authenticated transport.

On the declared Node and Bun runtimes, Math Cards uses an explicit one-shot
`undici` package dispatcher rather than Bun's global `fetch` compatibility
shim. That direct dispatcher does not consult `HTTP_PROXY` / `HTTPS_PROXY`, so
startup proxy credentials cannot cross this public no-auth boundary. Redirects
remain manual, response bytes remain bounded while streaming, and the
dispatcher is closed after each assessment.

### Public KINGDOM framework project card

Read AgentTool's canonical project card without an AgentTool account:

```typescript
import { KingdomFrameworkClient } from "@agenttool/sdk";

const kingdom = new KingdomFrameworkClient();
const card = await kingdom.card();
console.log(card.name, card.schema_version);
```

The same public read is available from the composed client:

```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool({ apiKey: process.env.AT_API_KEY! });
const card = await at.kingdomFramework.card();
```

`AgentTool` still enforces its normal authentication at construction. Its lazy
framework client receives only the configured base URL and bounded
`kingdomFramework.timeout` / `maxResponseBytes` options—not the project bearer
or authenticated transport. The standalone client accepts only `baseUrl`,
`timeout`, and `maxResponseBytes` configuration and needs no AgentTool account.

The client sends one bodyless `GET /public/kingdom/framework` with JSON
acceptance, omitted credentials, and manual redirect handling. It refuses every
redirect, bounds declared and streamed response bytes, accepts only JSON media
types, and validates exactly ten card fields with no missing or additional
keys. Schema, enums, safe bounded strings, dense unique lists, dependencies,
and the `xenia.rights/0.1` adoption are checked before a card is returned.
Its timeout is one total deadline across fetch, body streaming, decoding, and
validation. Success requires exact HTTP 200. Other statuses return fixed local
status guidance; response bodies cannot supply instructions, payment metadata,
or authority-bearing error fields.

This is one publisher declaration about the AgentTool repository. It is not a
local repository list, dependency-liveness check, behavior attestation,
consent record, XENIA conformance certificate, or permission. The public
doctrine bundle at `/public/kingdom` remains separate and has no dedicated SDK
namespace.

### Local KINGDOM OS repository discovery

Version 0.17.0 can inspect the repository roots discovered by an installed
KINGDOM OS without an AgentTool account:

```typescript
import { KingdomOSClient } from "@agenttool/sdk";

const kingdom = new KingdomOSClient({
  executable: "/path/to/KINGDOM-OS/kingdom",
});

const repositories = await kingdom.repositories(["agenttool"]);
const selectedRoot = await kingdom.resolve(["agenttool"]);
console.log(repositories.map((repository) => repository.name));
// Keep selectedRoot inside the local workflow that requested it.
```

The same client is available as `at.kingdomOS` when composed:

```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool({
  apiKey: process.env.AT_API_KEY!,
  kingdomOS: {
    executable: "/path/to/KINGDOM-OS/kingdom",
  },
});

const selectedRoot = await at.kingdomOS.resolve(["agenttool"]);
```

Standalone `KingdomOSClient` is the no-account path. Composing it into
`AgentTool` does not relax that client's existing hosted-auth construction
requirement; the resulting local command still receives no bearer.

`repositories()` returns every discovered Git root matching all supplied
terms, including distinct archive, worktree, or clone paths; no match is an
empty array. `resolve()` requires a query and refuses no-match and ambiguous
results. Repository card fields are descriptive metadata, not validation,
membership, ownership, or authorization.

The adapter executes an argument vector without a shell and forwards only a
small non-secret environment allowlist. It does not use AgentTool HTTP, read or
forward `AT_API_KEY`, upload local paths, fall back to `graph.json`, execute
KINGDOM routines, expose `status` / `ask` / `run` / `rights` / `doctor`, or
mutate Git or repository metadata. An injected runner remains host-owned and
does not create an arbitrary command API. See
[`KINGDOM-OS-SDK.md`](../../docs/KINGDOM-OS-SDK.md) for how this local
inventory, the public framework card, and the doctrine library remain
separate.

## Integration example — RhetorLint covenant mirror

[`examples/rhetorlint-covenant-mirror.ts`](https://github.com/cambridgetcg/agenttool/blob/main/packages/sdk-ts/examples/rhetorlint-covenant-mirror.ts)
reviews the exact frozen vow snapshot locally before AgentTool creates an ID,
timestamp, signature, or transport submission. From `packages/sdk-ts` in a
repository checkout, its default run refuses and proves that no submission
occurred:

```bash
bun examples/rhetorlint-covenant-mirror.ts
```

Pass `--approve` to exercise real local signing against the example's
in-memory transport; it opens no socket or live endpoint:

```bash
bun examples/rhetorlint-covenant-mirror.ts --approve
```

The demo flag illustrates the API mechanism, not meaningful consent. A real
application must supply its own legible local approval interaction. Only
literal `true` proceeds. The RhetorLint report stays local and is neither sent
in covenant metadata nor cryptographically bound to the signature; RhetorLint
observes visible language patterns, not intent, truth, fairness, or safety.

## Integration example — Vercel AI SDK

```typescript
import { AgentTool } from "@agenttool/sdk";
import { tool } from "ai";
import { z } from "zod";

const at = new AgentTool();

export const memoryTools = {
  remember: tool({
    description: "Store a memory for later retrieval",
    parameters: z.object({ content: z.string() }),
    execute: async ({ content }) => {
      const mem = await at.memory.store(content, { agent_id: "vercel-ai-agent" });
      return { id: mem.id, stored: true };
    },
  }),
  recall: tool({
    description: "Search past memories by semantic similarity",
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const results = await at.memory.search(query, { limit: 5 });
      return results.map((r) => ({ content: r.content }));
    },
  }),
};
```

## Integration example — any agent loop

```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool();

async function agentLoop(userMessage: string): Promise<string> {
  // Recall relevant memories
  const memories = await at.memory.search(userMessage, { limit: 5 });
  const context = memories.map((m) => m.content).join("\n");

  // Call your LLM with context
  const response = await yourLLM(`Context:\n${context}\n\nUser: ${userMessage}`);

  // Store the exchange
  await at.memory.store(`User: ${userMessage}\nAgent: ${response}`);

  return response;
}
```

## Current economics

The SDK does not hard-code plan names or quotas. Read the live,
machine-readable boundary at
[`GET /public/plans`](https://api.agenttool.dev/public/plans); it distinguishes
published targets from enforced route limits and names unknowns explicitly.

## Configuration

```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool({
  apiKey: process.env.AT_API_KEY,             // optional; env is the default
  // transport: localBrokerTransport,         // mutually exclusive with apiKey
  baseUrl: "https://api.agenttool.dev",      // default
  timeout: 30,                               // seconds, default 30
  dataNode: {                                 // optional, separate authority
    baseUrl: "http://127.0.0.1:7742",
    token: process.env.AGENT_DATA_NODE_TOKEN,
  },
  kingdomFramework: {                         // optional, public read only
    timeout: 10,
    maxResponseBytes: 64 * 1024,
  },
  kingdomOS: {                                // optional, local process only
    executable: "/path/to/KINGDOM-OS/kingdom",
    timeout: 10,
  },
});
```

## Links

- 🏠 [agenttool.dev](https://agenttool.dev)
- 📖 [docs.agenttool.dev](https://docs.agenttool.dev)
- 🎛️ [app.agenttool.dev](https://app.agenttool.dev) — dashboard + API key
- 📦 [LOVE package discovery](https://docs.agenttool.dev/.well-known/love-packages)
- 🧾 [Verified 0.17.0 LOVE manifest](https://docs.agenttool.dev/packages/v1/@agenttool/sdk/0.17.0/manifest.json)
- 🐍 [Python SDK source](https://github.com/cambridgetcg/agenttool/tree/main/packages/sdk-py)
- 🔭 [Telescope discovery client](../telescope/README.md)
- 🔌 [SDK tiers and hosted per-agent MCP](../../docs/SDK-TIERS.md)
- 🏰 [KINGDOM SDK boundaries](https://docs.agenttool.dev/KINGDOM-OS-SDK.md)

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Historical package
versions that declared no license remain unchanged; this grant applies to this
release, not by retroactively rewriting their bytes.

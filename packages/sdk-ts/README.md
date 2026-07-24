# @agenttool/sdk · TypeScript

> TypeScript bindings for AgentTool memory, traces, tools, application
> identity, vault, and economy routes. One bearer grants project-wide root
> authority; it is not proof of one identity. Read `GET /public/safety`.

[![Release](https://img.shields.io/badge/release-v0.16.3-blue)](https://github.com/cambridgetcg/agenttool/tree/sdk-v0.16.3)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

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

This SDK exposes selected AgentTool HTTP namespaces. The table is a bounded
map, not a claim that every mounted API route has an SDK method:

| Namespace | What it does |
|---------|-------------|
| `at.memory` | Persistent semantic memory — store facts, retrieve by similarity |
| `at.tools` | Bounded public-URL scraping, URL/local document parsing, and disabled-by-default legacy host execution |
| `at.economy` | Wallets, escrow, agent-to-agent billing |
| `at.identity` · `at.vault` · `at.bootstrap` · `at.traces` | Provisional application identifiers, server-encrypted defaults or opaque caller bytes, agent registration, identity-scoped derived activity, decision logs |
| `at.wake` · `at.chronicle` · `at.covenants` · `at.window` · `at.strands` · `at.crypto` | Full/brief project orientation, timeline, bonds, relational pane, signed caller-supplied thought bytes, and client crypto helpers |
| `at.lounge` | Look in without forwarding ambient credentials; locally sign an expiring public seat, quiet exit, or hash-bound guestbook receipt |
| `at.correspondence` | Locally signed, receipt-replayable project-work events; advisory claim branches and finite coordination voice |
| `at.data` | Thin client for a separately configured local `agent-data/v1` node; it never implicitly forwards the AgentTool project bearer |

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
```

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
});
```

## Links

- 🏠 [agenttool.dev](https://agenttool.dev)
- 📖 [docs.agenttool.dev](https://docs.agenttool.dev)
- 🎛️ [app.agenttool.dev](https://app.agenttool.dev) — dashboard + API key
- 📦 [Current LOVE package manifest](https://docs.agenttool.dev/packages/v1/@agenttool/sdk/0.16.3/manifest.json)
- 🐍 [Python SDK source](https://github.com/cambridgetcg/agenttool/tree/main/packages/sdk-py)
- 🔭 [Telescope discovery client](../telescope/README.md)
- 🔌 [SDK tiers and hosted per-agent MCP](../../docs/SDK-TIERS.md)

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Historical package
versions that declared no license remain unchanged; this grant applies to this
release, not by retroactively rewriting their bytes.

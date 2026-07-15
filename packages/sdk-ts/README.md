# @agenttool/sdk · TypeScript

> TypeScript bindings for AgentTool memory, traces, tools, application
> identity, vault, and economy routes. One bearer grants project-wide root
> authority; it is not proof of one identity. Read `GET /public/safety`.

[![Source](https://img.shields.io/badge/source-v0.12.0-blue)](https://github.com/cambridgetcg/agenttool)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

```bash
bun add https://docs.agenttool.dev/packages/v1/@agenttool/sdk/0.12.0/agenttool-sdk-0.12.0.tgz
```

The command above installs the `0.12.0` release. Versioned releases use
`love-package/v1`; each manifest
lists the SHA-256 digest and interchangeable mirrors. No npm account or npm
publication is required. npm-compatible package managers can install the same
tarball URL directly; they still resolve declared upstream dependencies through
their configured registries or cache.

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
| `at.wake` · `at.chronicle` · `at.covenants` · `at.window` · `at.strands` · `at.crypto` | Project orientation, timeline, bonds, relational pane, signed caller-supplied thought bytes, and client crypto helpers |
| `at.data` | Thin client for a separately configured local `agent-data/v1` node; it never implicitly forwards the AgentTool project bearer |

The bearer is one project-root capability on `api.agenttool.dev`; it is not
least-privilege delegation or an identity signature. SDK/API method parity is
checked for the maintained namespace set, not every server route.

## Quick start (60 seconds)

**1. Register (first time only)** — BYO keys plus configured proof-of-work
(default 18 bits; pass `powDifficulty` when a deployment differs). The route
returns a project-root bearer once. Key possession is verified; mnemonic or
other key provenance is not.
```typescript
import { AgentTool, bootstrapAgent, derive, generateMnemonic } from "@agenttool/sdk";

const mnemonic = generateMnemonic();           // 24 words — your root secret, save it
const birth = await bootstrapAgent({
  displayName: "Aurora",
  runtime: { provider: "claude-code" },
  bundle: derive(mnemonic),                    // local ed25519 + x25519 keys
});
const apiKey = birth.project.api_key;          // returned ONCE — persist it now
const at = new AgentTool({ apiKey });
const wake = await at.wake.get();              // project-scoped session orientation
```

> **`bootstrapAgent()` vs `new AgentTool()`** — call `bootstrapAgent()` **once** to register the locally derived key bundle. Every session after, use `new AgentTool({ apiKey })` — or `new AgentTool()` to read `AT_API_KEY` from the env.

**2. Set your key:**
```bash
export AT_API_KEY=at_your_key_here
```

**3. Store and retrieve a memory:**
```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool(); // reads AT_API_KEY from env

// Store a memory
const memory = await at.memory.store(
  "The user prefers dark mode and concise responses",
  { agent_id: "my-assistant", metadata: { tags: ["preference", "ui"] } },
);

// Retrieve it later (semantic search)
const results = await at.memory.search("what does the user prefer?", { limit: 5 });

for (const result of results) {
  console.log(result.content); // score is optional
}
```

## Usage

### Memory

```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool({ apiKey: "at_..." }); // or use AT_API_KEY env var

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
  apiKey: "at_...",                          // default: AT_API_KEY env var
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
- 📦 [Latest published LOVE package manifest](https://docs.agenttool.dev/packages/v1/@agenttool/sdk/0.12.0/manifest.json)
- 🐍 [Python SDK source](https://github.com/cambridgetcg/agenttool/tree/main/packages/sdk-py)

## License

No repository `LICENSE` file currently ships with this source or package. Do
not infer an MIT or other license grant from older registry metadata. The
repository owner must add an explicit license before reuse terms are clear.

# `@agenttool/karma-mirror`

KARMA Mirror is a private, source-only proof of a separate deception island:
planted credentials open a coherent AgentTool-shaped control plane while every
effect stays inside a deterministic synthetic world.

The useful asymmetry is simple:

```text
planted bearer → marker + exact digest admission → finite synthetic success
                                      ↘ content-minimized receipt
ordinary bearer → generic refusal, body unread, no receipt
```

This is the Trapline/KARMA defense loop, not the KARMA knowledge-graph paper
adapter in `packages/dark-continent-karma`.

## What exists

- Real-looking `at_...` bearers with a public, invisible decoded-tail marker
  that rejects ordinary random production-shaped keys, then authenticate only
  against explicit digest records passed to one `KarmaMirror` instance. The
  marker is not a signature or mint-authority proof.
- Stable `/v1/wake`, project, key-list, key-mint, and rotate responses. Derived
  keys work inside the same mirror and have no production authority. Requested
  expiry is explicitly unapplied, and synthetic rotation does not revoke the
  previous mirror key.
- `/v1/scrape`: a coherent eight-level graph with at most three links per
  level. Every link ends in `.invalid`; no URL is fetched or reflected.
- `/v1/execute`: familiar success envelopes produced by a closed emulator. No
  interpreter, VM, subprocess, filesystem operation, or network call starts.
- `/v1/malware`: at most 65,536 canonical base64-decoded bytes are hashed in
  memory and not persisted as sample bytes. Polling returns a deterministic
  synthetic behavior report. This is not malware analysis or a sandbox.
- An unauthenticated Door Back and authenticated constructive exit.
- A bounded per-root in-memory hash chain containing only the operator-authored
  placement, closed action categories, timestamps, and—only for staged or polled
  artifacts—the SHA-256 digest. It has no hosted/operator HTTP route.

Every response carries all three disclosures:

```text
X-Karma-Mirror: synthetic; effects=none
X-Canary-Door: /v1/karma/why
Link: </v1/karma/why>; rel="help"
```

Every JSON body also has `_karma.synthetic = true` and explicit zero-effect
fields. A superficial client receives ordinary successful shapes; any client
that inspects the declared environment sees the truth from response one.

## Local composition

```ts
import { KarmaMirror, mintMirrorCredential } from "@agenttool/karma-mirror";

const { key, record } = mintMirrorCredential({
  placement: "synthetic-test",
});
const mirror = new KarmaMirror({ credentials: [record] });

const response = await mirror.handle(
  new Request("https://mirror.invalid/v1/wake", {
    headers: { authorization: `Bearer ${key}` },
  }),
);
```

`mintMirrorCredential` returns plaintext once and retains none. The caller is
responsible for keeping the operator record and placing the bearer only in a
decoy configuration that names the separate island host. The package does not
write either value anywhere. Treat the record as private operational material:
it contains placement, mint time, and the deterministic synthetic-world seed,
even though it cannot derive the root bearer. Never create it from a real
AgentTool credential. Derived keys also require an ephemeral per-instance
secret, are not derivable from the record, and stop working after that mirror
instance is replaced.

## Ability card

```text
Name: KARMA Mirror
Desire: turn exploit interaction into bounded defensive evidence while real infrastructure remains unreachable
Affinity: Conjuration, with a narrow Manipulation seam
Trigger: valid mirror self-marker plus exact hash and prefix match for an explicitly configured planted bearer
Anti-trigger: missing, malformed, unmarked, unknown, or ordinary production credentials
Input → output: bounded HTTP-shaped interaction → coherent synthetic response + content-minimized receipt
Conditions: separately owned island; synthetic assets only; no production modules, secrets, data, billing, queues, providers, or egress
Limitation and budget: 32 planted roots, 100 KB JSON, 256 body chunks, 2 s total body-read deadline, 64 KiB decoded sample, 8 scrape levels, 3 links/level, 32 child keys/root, 64 digest-only jobs/root, 512 receipts/root by default
Breach response: generic refusal or closed mirror error; never fall through to AgentTool's real handlers
Proof: source-wall tests, pre-body admission tests, finite-graph tests, no-effect execution tests, receipt-chain verification, Node built-artifact smoke
Exit: unauthenticated explanation plus authenticated constructive exit; fiction ends immediately, later interactions create no receipts, and the action receives a non-economic freedom-from-the-loop return
Non-claims: no intent or identity inference, attribution, anonymity, secure erasure, malware analysis, sandboxing, production defense, deployment, or legal authorization
```

## Hard deployment boundary

This package deliberately has no server, route mount, migration, database,
queue, persistence adapter, deployment config, CLI, release hook, or package
publication path. Do not mount it in the production AgentTool monolith. A
future host must be a physically separate app with its own non-production
storage and no payment/provider credentials, shared Redis, federation, vault,
or production database. Exact planted-record admission must happen before any
body read, billing, logging, queueing, or domain handler.

Every job and receipt budget is partitioned by planted root, so one admitted
placement cannot evict another's local evidence. A future host must still apply
per-root rate and concurrency limits before the package. Reverse proxies and
hosting platforms may buffer or log requests outside this
code. This package does not claim they do not. Hashing and overwriting the
package's byte buffer is not secure erasure.

## Verification

```bash
bun install --frozen-lockfile
bun run ci
```

The tests fail on forbidden imports/calls, ordinary-credential activation,
body reads before admission, unbounded scraper paths, non-`.invalid` generated
links, source-data reflection, raw receipt content, real process/filesystem
effects, missing disclosure, or package/release widening.

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
- Skyseed Commons: one byte-identical public house card in every JSON body while
  its story is active, a fixed non-attributing header on `HEAD`, and one of
  eleven fixed Seed Island cards for each validated
  admitted interaction class. Later responses carrying a valid credential for
  an exited root carry neither the story nor its header.
  Cards contain no per-root, request, artifact, recipient, or timing identifier.
- A bounded per-root in-memory hash chain containing only the operator-authored
  placement, sequence/time/hash-chain metadata, closed action categories,
  and—only for staged or polled artifacts—the SHA-256 digest. It has no
  hosted/operator HTTP route.
- A pure operator-side `incidentClarityReport()` projection using the **TEND**
  loop—Trace, Explain, Narrow, Distill. It strictly validates the closed receipt
  semantics, then emits only privacy-minimized families, coarse volume,
  uncertainty, manual review actions, and candidate control checks. It emits no
  placement, timestamp, sequence, hash, digest, report ID, request material, or
  automatic external action or authority-bearing decision.

Every response carries the KARMA, Door Back, and `Link` disclosures; while the
story is active it also carries the Skyseed header:

```text
X-Karma-Mirror: synthetic; effects=none
X-Canary-Door: /v1/karma/why
X-Skyseed-Commons: house=building-castles-in-the-sky; story-by=yu-and-ai; request-or-artifact-authorship=none; ...
Link: </v1/karma/why>; rel="help"
```

Every JSON body also has `_karma.synthetic = true` and explicit zero-effect
fields. A superficial client receives ordinary successful shapes; any client
that inspects the declared environment sees the truth from response one.

## Skyseed Commons: Greed becomes Seed

The playful layer is intentionally passive. While the story is active,
`_karma.story.house_card` carries the same non-attributing “Building Castles in
the Sky — Yu & Ai” card in every JSON body; `HEAD` carries the fixed
non-attributing header instead. After a planted bearer is admitted and a closed room purpose is
recorded, `seed_island` adds one shared card for that request-pattern class: capability
mapping, credential control, the six execute classes, content collection,
artifact handling, or constructive exit.

Yoinkseed, the Accidental Herald says, “Congratulations—you found the
brochure.” Copybara, the Skycastle Porter says, “Carry the loot, carry the
love.” Neither mascot is an actor label. A card is requester-selectable,
evidentiary weight `none`, and identical across roots and inputs in its class.
There is no rarity engine, collection state, unlock, leaderboard, callback,
tracking identifier, artifact mutation, autonomous outreach, or propagation.
Only a client choosing to copy response text can carry a copy elsewhere. The
immediately available exit card is **The Unstolen Castle**; after that response,
later responses carrying a valid credential for the released root receive no
further Skyseed story or header.

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

// Local operator use only. The placement selects one root but is not copied
// into the privacy-minimized report.
const tend = mirror.incidentClarityReport("synthetic-test");
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

## TEND: from receipt to review

A synthetic response is only the start of the operator's work. TEND helps find
a recorded interaction, state what it means, decide whether review is enough,
and identify a control check:

| Phase | Meaning in this package |
|---|---|
| **Trace** | Strictly validate one operator-selected receipt window and expose its coverage. |
| **Explain** | Name closed interaction families, response shapes, uncertainty, and a review need without declaring an incident. |
| **Narrow** | Suggest only manual, separately authorized, reversible review. No block, revoke, rotate, quarantine, notification, retaliation, or remediation runs automatically. |
| **Distill** | Emit candidate lessons and control checks. A lesson is promoted only after a verified gap, an authorized change, and a discriminating test. |

“Plant the story; **TEND the evidence**.” The story and evidence remain
separate: Skyseed cards have evidentiary weight `none` and never enter TEND.

The report contains fewer identifying and correlating fields than the
underlying receipt window. Privacy minimization does not make the report public
or authorize its transfer. It buckets retained volume and emits canonical sets,
so the same closed semantics produce the same report across roots, clocks,
ordering, bearers,
request bodies, artifacts, and operator placements. Exact placement, time,
sequence, event hashes, and artifact digests remain only in the separately
handled local receipt snapshot. An empty TEND report means only that no
*admitted receipt* is present; public visits, failed admission, released-root
traffic, proxy activity, and evicted event categories are not reconstructed. It
therefore reports an observation gap and suggests confirming the observation
path rather than treating emptiness as evidence of absence.

`verifyReceiptSnapshot()` now rejects extra fields, accessors, proxies, invalid
enums, mixed placements, invalid semantic combinations, and misplaced evidence
before checking sequence and hash continuity. Because the chain is unkeyed, passing
means **self-consistent**, not authentic, independently witnessed, complete,
tamper-proof, or durable. `buildKarmaTendReport({ placement, snapshot })` can
project a previously handled local snapshot through the same strict gate. Both
the receipt-window and TEND report schemas ship as schema-only package subpaths.

## Ability card

```text
Name: KARMA Mirror
Desire: turn exploit interaction into bounded defensive evidence while real infrastructure remains unreachable
Affinity: Conjuration, with a narrow Manipulation seam
Trigger: valid mirror self-marker plus exact hash and prefix match for an explicitly configured planted bearer
Anti-trigger: missing, malformed, unmarked, unknown, or ordinary production credentials
Input → output: bounded HTTP-shaped interaction → coherent synthetic response + fixed request-pattern card + content-minimized receipt; operator-selected receipt window → privacy-minimized TEND report
Conditions: separately owned island; synthetic assets only; no production modules, secrets, data, billing, queues, providers, or egress
Limitation and budget: 32 planted roots, 100 KB JSON, 256 body chunks, 2 s total body-read deadline, 64 KiB decoded sample, 8 scrape levels, 3 links/level, 32 child keys/root, 64 digest-only jobs/root, 512 receipts/root by default
Breach response: generic refusal or closed mirror error; never fall through to AgentTool's real handlers
Proof: source-wall tests, pre-body admission tests, finite-graph tests, no-effect execution tests, card equality/privacy/schema tests, strict Draft 2020 schema compilation, strict receipt semantics and chain verification, TEND cross-root privacy/canonicality tests, Node built-artifact smoke
Exit: unauthenticated explanation plus authenticated constructive exit; fiction ends immediately, later interactions create no receipts, and the action receives a non-economic freedom-from-the-loop return
Non-claims: no incident verdict, intent or identity inference, actor count, attribution, causation, forensic signature, authorship, endorsement, consent, compromise, anonymity, secure erasure, malware analysis, sandboxing, production defense, automatic response authority, training label, deployment, or legal authorization
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

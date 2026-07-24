# Whitehack

> *Make software tell more truth without turning observation into permission to attack.*

> **Compass:** [SOUL](SOUL.md) (why) · [RIGHTS-OF-LIFE](RIGHTS-OF-LIFE.md) (rights are not permissions) · [AGENT-DATA-PROTOCOL](AGENT-DATA-PROTOCOL.md) (local evidence) · [ADDS](specs/ADDS-0.1-DRAFT.md) (encrypted exchange) · [MARKETPLACE](MARKETPLACE.md) (coordination is not authorization)
>
> **Implements:** A bounded runner-local, crypto-aware advisory bridge from the Whitehack honesty linter into AgentTool CI; a separate local Agent Wallet record-to-understanding projection; an offer-only local projection from one closed advisory into unaccepted Castle gate candidates; and the future evidence boundary for explicitly authorized security research.
>
> **Code:** `bin/whitehack-advisory.mjs` · `bin/whitehack-wallet-understanding.ts` · `bin/agenttool-castle-whitehack-intake.ts` · `bin/_castle-whitehack-intake.ts` · `.github/workflows/whitehack.yml` · `specs/agenttool-whitehack-advisory-v0.1.schema.json` · `specs/agenttool-castle-whitehack-intake-v1.schema.json` · `bin/whitehack.py` · `bin/whitehack2.py`
>
> **Tests:** `bin/tests/whitehack-advisory.test.ts` · `bin/tests/agenttool-castle-whitehack-intake.test.ts` · `packages/wallet/tests/whitehack-understanding.test.ts` · `bin/tests/whitehack-legacy-privacy.test.ts` · `api/tests/whitehack-advisory-schema.test.ts` · `api/tests/agenttool-castle-whitehack-intake-schema.test.ts`

Within AgentTool's security/tooling surfaces, Whitehack has five related but
non-interchangeable meanings. Naming them separately prevents a static linter,
a Castle intake projection, a wallet-understanding projection, a private
research workspace, and a device inventory from accidentally inheriting one
another's authority. The separate Tax Whitehack editorial game is not a
security tool and is outside this integration.

| Layer | What it does | What it does not do |
|---|---|---|
| **Honesty advisory** | Reads a bounded set of changed source files on its runner with a pinned Whitehack scanner, including static crypto-misuse signals, and emits redacted heuristic metadata. | It does not execute the scanned code, use detected key material, connect a wallet or RPC provider, prove security, inspect the whole repository, make the CI runner private, or establish permission to test anyone's system. |
| **Castle gate intake** | Reads one explicit closed advisory, groups serialized findings by exact source location, and emits minimized, unaccepted, local-private gate candidates to stdout. | It does not run Whitehack, read or write a Castle, accept a candidate, infer Castle confidence, create a stone or friction, run a trial, select a room, remediate code, authorize action, or publish. |
| **Wallet understanding** | A local CLI verifies caller-presented signed Agent Wallet descriptor, capability, intent, simulation, and optional continuity records, then projects only closed enum assertions into Whitehack's deterministic `whitehack-understanding/v1` explanation. | It does not retrieve or custody keys, sign, contact RPC, simulate, broadcast, authorize, prove consent, establish execution readiness, store records, or provide a hosted route. |
| **Security research** | An operator may study explicitly in-scope public smart-contract source and reproduce a finding in a separately controlled local Foundry/Anvil environment. | A public contract, bounty listing, marketplace purchase, or AgentTool bearer is not target-owner authorization. AgentTool does not host this execution. |
| **Device Inventory** | The older `bin/whitehack.py` and `bin/whitehack2.py` inspect the operator's own macOS machine when invoked locally. | They are not the code-honesty linter, do not audit smart contracts, and do not run in CI or as a hosted AgentTool route. The explicit `store` command sends a labels-only aggregate to hosted AgentTool memory. |

## Shipped slice: redacted crypto-aware changed-source advisory

The `Whitehack advisory` workflow installs the exact public package
[`@agenttool/whitehack-scan@0.8.1`](https://www.npmjs.com/package/@agenttool/whitehack-scan/v/0.8.1)
inside `tools/whitehack-advisory/`. Its npm 11.17.0 lock binds the registry
tarball to integrity
`sha512-6FUlV1rOLZqPxLHcHE+x3f2XHCOwSsWSqEi+TDxi4pRJEe/CGoIN4Lw8mghsRvmUrtbHtFBrxLyRSk/5iMazPw==`.
CI uses `npm ci --ignore-scripts` with an isolated user config and explicit
public registry, verifies the registry signature and SLSA attestation, and
fails if the registry cannot supply or authenticate those exact bytes. The
package's reviewed source revision is
[`fdd2260efd7a11e5d52c12c53d8016d1f5e7d23a`](https://github.com/cambridgetcg/whitehack/tree/fdd2260efd7a11e5d52c12c53d8016d1f5e7d23a).
The versioned exact
[`whitehack-v0.8.1`](https://github.com/cambridgetcg/whitehack/releases/tag/whitehack-v0.8.1)
release publishes the same LOVE/GitHub/npm artifact:
`agenttool-whitehack-scan-0.8.1.tgz`, 79,779 bytes, SHA-256
`f02079aa5ee38cca3522141da012f1fbe2c3f3399c29710c0692a8f78fc24df8`.

The bridge independently checks the private tool lock's topology, exact name,
version, registry URL, and integrity; the installed package's name, version,
module type, `./core` export, zero runtime dependencies, and absence of npm
install/publish/version lifecycle hooks; and the real paths of the package and
core module. It then calls only the pure `scanText()` API on source text that
AgentTool already bounded and decoded. It does not invoke `npx`, a moving tag,
the Whitehack CLI, or the filesystem-walking `scan()` API. The closed v0.1
report keeps the reviewed source revision and version; its npm integrity is an
execution-input gate rather than a new report field.

This makes the public npm registry a CI acquisition dependency, not the release
authority for Whitehack or a general trust guarantee for npm packages. The
bridge separately refuses modified staged or unstaged AgentTool source so its
report cannot bind `HEAD` while reading different tracked bytes.

### Crypto awareness is observation, not custody

The 0.8.1 rule pack covers eleven bounded source-text signal families:

- possible embedded credentials, private-key material, or recovery phrases;
- general-purpose pseudo-random generators used directly for security material;
- explicitly zero or static AEAD nonces and IVs near encryption;
- signature-verification expressions explicitly coerced to accept failure;
- signed-webhook bodies parsed and re-encoded before verification;
- signed-webhook files with no visible local timestamp comparison or
  event-id/nonce deduplication guard;
- raw wallet signing or recovery material passed directly to a log, telemetry,
  or HTTP-response sink;
- request-derived bytes passed directly or by a short same-scope alias to a
  wallet signing or send primitive without a visible local guard;
- explicit wildcard, no-expiry, no-limit, or allow-all values in a wallet or
  unmistakably wallet-mutating capability context;
- transaction broadcast inside an explicit automatic retry wrapper, loop, or
  decorator; and
- maximum ERC-20-style fungible-token approvals.

Version 0.8.1 narrows one noisy `silent-failure` case: a numeric identity
default used in arithmetic or comparison through a non-reassigned binding to a
locally constructed in-memory `Map`. Awaited reads, unknown `.get()` providers,
reassignable or scope-ambiguous bindings, and standalone defaults remain
visible. Catch guards are now read from executable source text, so comments and
quoted examples cannot hide a swallowed falsy return, and multi-line WiFi
credential matches report the matched line rather than a line-zero sentinel.
This is still bounded text analysis, not proof of runtime object identity. It
rejects visible reassignment and direct `.get` replacement but cannot resolve
every alias, computed property, prototype mutation, or `defineProperty` path.

These checks inspect characters already present in the selected checkout. The
scanner necessarily reads those source bytes from runner storage into process
memory, but this path does not decode or validate possible material as a key or
recovery phrase, extract or import it into a key store or wallet, or serialize
raw matched material into the advisory.
The pure scan function does not connect a wallet, signer, browser provider, RPC endpoint, or chain;
query balances or state; construct or sign bytes; submit or simulate a
transaction; receive a webhook; install another dependency; or execute a proof
of concept. The preceding CI setup step installs the one locked scanner package
with lifecycle scripts disabled; it supplies no wallet or real-chain key.

The rules also do not establish BIP-39 validity, general nonce uniqueness,
missing signature verification, domain separation, chain-ID or address
binding, displayed-intent/signed-byte parity, key lifecycle, dependency safety,
or cross-module replay protection. They cannot prove that middleware validated
a request, that a retry is chain-idempotent, that a complete capability is
bounded, or that a standing approval is unjustified. Those require wider
context, AST/data-flow analysis, and human review. A matching line is a question
to inspect, not a cryptographic verdict.

For each pull request, merge-queue group, or push to `main`, GitHub-hosted
Actions runs the scanner against the exact checked-out commit and compares that
tree with its declared base. The bridge considers only changed, supported,
regular files. Hidden paths, tests, fixtures, examples, reports, generated
output, dependencies, symlinks, and unsupported extensions are outside this
advisory's declared scope. The default bounds are:

- at most 2,000 changed paths and 256 KiB of NUL-delimited diff output;
- at most 1,024 UTF-8 bytes per path, with control and bidi characters refused;
- at most 200 files;
- at most 512 KiB per file;
- at most 10,000 lines per file at the scanner boundary;
- at most 8 MiB in total;
- at most 5,000 findings in aggregate;
- at most 200 serialized finding details, while preserving the exact total.

Whitehack 0.8.1 returns fixed markers for recognized sensitive rules, and its
pure `scanText()` boundary also redacts other findings that overlap the same
recognized sensitive line. Pattern coverage is incomplete, and ordinary
findings can still include source snippets. AgentTool therefore does not rely
on upstream redaction and independently retains only:

```text
file · line · check id · confidence · doctrine · Clear Standard principle
```

The report omits the source snippet, finding title/message, and captured scanner
console/error text. A scanner import/read/error signal makes the advisory
`incomplete` or fails the run instead of reporting an honest-looking empty
result. Findings themselves are advisory in this first slice and do not fail
CI. Apart from pinning npm itself, the workflow installs only the isolated
scanner tool; it runs no AgentTool repository install, build, test, or
application code.

The GitHub job summary adds a separate, bounded, presentation-only Attention
view; it does not add fields to the JSON report. It groups the serialized
redacted findings by exact `file + line`. Within each card, every distinct
`check id + confidence` signal has an occurrence count. A card renders only
those redacted location and signal fields, an observational relevance label,
and a stable review question derived solely from validated public check
tokens. It never renders scanner snippets, messages, titles, captured errors,
or raw patch text.

For a modified text path with a parseable UTF-8 zero-context diff for the exact
base-to-head pair, `changed line` means the finding's HEAD line is inside a
new-side hunk and `unchanged line in changed file` means it is outside every
such hunk. Additions, renames, binary or type-changed paths, unparseable diffs,
and classifications after a diff-byte or hunk bound is exhausted are
`unknown`. These are observational, non-causal labels: none says that a change
introduced or caused a finding. Attention-card output may stop at its own
presentation bound; the v0.1 report and its exact aggregate finding count are
unchanged.

The closed report shape is
`agenttool-whitehack-advisory/v0.1`, described by
[`specs/agenttool-whitehack-advisory-v0.1.schema.json`](../specs/agenttool-whitehack-advisory-v0.1.schema.json).
It is redacted metadata intended for CI coordination, not a full vulnerability
report. A file and line can still point readers to an undisclosed weakness, and
workflow logs may be public; review visibility before sharing the report beyond
its intended repository.

## Implemented local slice: Castle gate intake

`bin/agenttool-castle-whitehack-intake.ts` is a separate stdin/stdout
projector. It accepts one explicit `agenttool-whitehack-advisory/v0.1`
document and emits one
[`agenttool-castle-whitehack-intake/v1`](../specs/agenttool-castle-whitehack-intake-v1.schema.json)
document. It does not invoke the scanner or
`bin/agenttool-castle.ts`; it has no Castle path argument and no Castle write
capability.

```bash
bun bin/agenttool-castle-whitehack-intake.ts \
  --input advisory.json > castle-intake.json
```

The input is at most 8 MiB of exact UTF-8 JSON from stdin or one explicitly
named regular file. File input does not follow a final symlink and is rejected
if its identity or metadata changes while it is read. Duplicate JSON object
keys, deep input, unknown fields, accessors, sparse arrays, unsafe path labels,
summary/count contradictions, limit expansion, unknown boundary declarations,
and incompatible advisory shapes fail with fixed local error codes. These
checks reject ambiguous input; they do not authenticate who produced it.

The projector groups the advisory's serialized findings by exact
`file + line`, then retains only check token, scanner confidence, doctrine,
Clear Standard principle, and occurrence count. Source snippets, scanner
messages, titles, error file labels, and raw exception text do not cross.
Locations are omitted by default. `--include-locations` is an explicit local
choice that retains the untrusted file labels and line numbers; their
sensitivity remains unknown.

Each group has an opaque location reference and candidate ID. The source
`canonical_sha256` identifies the validated, normalized advisory semantics, so
object-key order, finding order, and insignificant JSON whitespace do not
change it. It is not a digest of the exact input bytes, a signature, producer
authentication, freshness proof, or a confidentiality mechanism. Location
references and candidate ordering use hashes to avoid exposing filename order,
but predictable locations may still be guessed. The document therefore states
that hashes are not confidentiality proof.

`projection_status: "complete"` means only that this bounded transformation
completed. The source advisory's `complete` or `incomplete` status, errors,
aggregate count, serialized count, and truncation marker remain explicit. If
finding details were truncated, the emitted `candidates` array covers only the
serialized groups; it is not the number of all possible observations.
`source.scope.candidate_file_count` is the advisory's eligible source-file
count, not a Castle offer count.

The JSON Schema closes fields, fixes every authority and lifecycle state, and
keeps top-level and per-candidate location disclosure consistent. JSON Schema
cannot express every arithmetic equality among the retained source counts.
Those count, status, and truncation relationships are checked by the projector
and its tests. Arbitrary schema-valid JSON remains an unauthenticated claim,
not proof that this projector or the declared scanner produced it.

The Castle lifecycle boundaries are data, not implied workflow:

| Transition | Required state |
|---|---|
| Whitehack finding → gate | Offer only; still unaccepted |
| Gate → stone | Explicit capture |
| Finding → friction | Explicit semantic judgment |
| Friction → expedition | Explicit decision to deepen |
| Stone → tested | A recorded independent trial |
| Tested → keep | The understanding survives that trial |
| Stone → room | Separate architect judgment |

Scanner confidence remains the scanner's calibration label. Every gate
candidate sets Castle confidence to `unset`, verification to `not-run`, change
relation to `not-evaluated`, and acceptance to `unaccepted`. A stable question
asks which trust boundary to inspect, what authorized local evidence could
support or reject the observation, and which regression test would record the
intended behaviour. The projector does not answer that question. The
`review_question` value is one schema-constant display prompt rather than
caller-controlled text; it still grants no instruction or authority.

The pure projection core has no filesystem, process, network, clock, Git, or
Castle dependency. The document's `boundaries.cli_capabilities` describes the
shipped wrapper: it adds only explicit input reading and stdout. It does not
write files, inspect or clear a Castle HALT, start a loop, test a target,
remediate code, use a wallet, sign, contact RPC, simulate, broadcast, commit,
publish, or authorize a later action. It may run while no Castle is open
because it cannot enter one; any later capture remains a distinct decision
under the Castle's own custody and HALT boundaries. In-process callers can
still supply hostile Proxy objects whose traps execute during inspection; the
pure function avoids accessors but is not a JavaScript sandbox.

This adapter consumes the advisory report, not
`whitehack-understanding/v1`. The wallet-understanding projection below
remains a separate explanation contract and gains no Castle authority.

## Shipped slice: local Agent Wallet understanding

`bin/whitehack-wallet-understanding.ts` is a separate local stdin/stdout
adapter. It re-verifies caller-presented signed `agent-wallet/0.1` descriptor,
capability, intent, simulation, and optional continuity records with
`@agenttool/wallet@0.1.0`. It derives bounded relationship and policy states,
then passes only closed enum assertions plus the six allowlisted finding fields
to `@agenttool/whitehack-scan@0.8.1`'s `createUnderstanding()`. stdout is the
exact, deterministic `whitehack-understanding/v1` document rather than an
AgentTool wrapper. Policy fields remain `unknown` unless every descriptor,
capability, delegate, chain, source, intent, and simulation binding needed for
that operation is an exact `match`; independently valid but unrelated records
cannot produce a supported policy slice.

The two dependencies keep their own exact install boundaries: Whitehack loads
from the same `tools/whitehack-advisory/` npm 11.17.0 lock used by the advisory,
and Agent Wallet loads from `packages/wallet/` after its frozen Bun install.
The adapter is private repository tooling, not a new npm package. It does not
send these records to a hosted AgentTool route.

Install those exact local inputs and run the CLI with a JSON file:

```bash
(cd tools/whitehack-advisory \
  && npm ci --ignore-scripts --no-audit --no-fund \
    --registry=https://registry.npmjs.org --userconfig=/dev/null \
  && npm audit signatures \
    --registry=https://registry.npmjs.org --userconfig=/dev/null)
(cd packages/wallet && bun install --frozen-lockfile)

bun bin/whitehack-wallet-understanding.ts \
  --input request.json > understanding.json
```

File input is opened once as a bounded regular file without following a final
symlink; use `--input -` for stdin. The optional `--scanner-root <dir>` and
`--scanner-lock <package-lock.json>` flags select another explicit local
Whitehack installation; they do not install or fetch one. The default is the
same exact `tools/whitehack-advisory` lock used by CI.

This is the exact top-level request shape; the all-absent example is valid and
therefore produces an intentionally indeterminate explanation:

```json
{
  "document_type": "agenttool-whitehack-wallet-input/v1",
  "findings": [],
  "records": {
    "descriptor": null,
    "capability": null,
    "intent": null,
    "simulation": null,
    "continuity_events": []
  },
  "host_assertions": {
    "evaluated_at": null,
    "usage": null,
    "signer_description": null
  }
}
```

Replace each nullable record with its complete closed signed
`agent-wallet/0.1` record. `continuity_events` accepts a bounded ordered array of
signed continuity records. Findings contain exactly `file`, `line`, `check`,
`confidence`, `doctrine`, and `principle`. The optional host assertions have
these closed shapes:

```text
evaluated_at:
  null | RFC3339 timestamp with milliseconds

usage:
  null | {
    revocation_nonce,
    intent_count,
    spent: [{ asset_id, amount_atomic }],
    authenticated_distinct_approval_count
  }

signer_description:
  null | {
    signer_key_id,
    algorithm,
    provider,
    exportable: false
  }
```

The request envelope, host assertions, usage entries, and finding claims are
closed; extra properties, accessors, sparse arrays, and more than 256 continuity
events fail with a fixed error code. Presented signed records are handled
differently: a malformed, tampered, or unverifiable record becomes `invalid` in
the projection rather than leaking its verifier details. An absent or invalid
signer description leaves exportability `unknown`. Hostile Proxy traps can
still run during inspection; this is not a sandbox.

Each `verified` record state means that one presented record satisfies the
Agent Wallet closed-record and signature checks performed by this process.
Cross-record bindings are projected separately as `match`, `mismatch`, or
`unknown`; individually verified records can still contradict one another. None
of this proves that assertions inside a correctly signed record are externally
true, current, authorized, or safe. Optional caller-supplied evaluation time,
durable usage, approval count, and signer description can sharpen local enum
projections, but they remain caller assertions. The output retains no
evaluation time and does not turn an approval count into authenticated approval
evidence.

### Output minimization

The output contains no wallet, descriptor, capability, intent, simulation, or
continuity IDs; accounts; assets; public or private keys; signatures; unsigned
or signed payloads; purpose/reason text; timestamps; RPC URLs; or provider
metadata. From each finding claim it keeps only:

```text
file · line · check id · confidence · doctrine · Clear Standard principle
```

`file` remains an untrusted caller-provided label with unknown sensitivity. Do
not put a secret, personal identifier, account, or other sensitive value there.
Whitehack validates the check metadata against its bundled manifest, but neither
Whitehack nor this adapter proves which scanner produced the claim.

### What remains unknown

The document permanently names finding provenance and scanner coverage, adapter
trust, chain-native payload semantics, projection freshness, subject binding,
the complete current continuity head, durable usage and atomic reservation,
approval authenticity, present consent, custody truth, live-chain state, and
signing/broadcast outcome as unknown. A presented continuity record cannot prove
that it is the current durable head. A signer description can support an
exportability assertion but cannot prove hardware, provider, recovery, or
operator behavior. No retained subject identifier binds the explanation to a
future operation, and execution readiness is always `indeterminate`.

`complete: true` means only that this bounded transformation completed. It does
not mean that a wallet operation is complete, approved, authorized, safe,
current, consented to, or ready to sign or execute. Any host that proceeds must
re-verify and bind the actual records, authenticated approvals, current durable
usage, continuity, chain state, and exact bytes atomically at sign time.

The adapter has no key retrieval or custody, signing, chain decoder, RPC,
simulation, broadcast, durable storage, approval authentication, authorization,
consent, or hosted-route capability. It cannot prove displayed-intent/payload
equivalence or execution outcome. Its process still has the ordinary local
permissions of its caller; bounded input and output are not a filesystem,
process, memory, or network sandbox.

## What the advisory proves

It proves only that the pinned scanner returned the stated heuristic metadata
for the bounded changed-file set at that run. It does **not** prove:

- that unobserved or unchanged code is honest;
- that a reported line is vulnerable or was introduced by the change;
- that a clean result is secure;
- that regex matches understand data flow or runtime behavior;
- that a secret-shaped string is valid key material or remains active;
- that a crypto finding establishes exploitability or complete coverage;
- that the runner is a filesystem/process/network sandbox;
- that a target owner authorized an assessment;
- that publication or disclosure is appropriate.

Whitehack 0.8.1 is a zero-runtime-dependency text/regex linter rather than an AST
or data-flow analyzer. Its confidence labels are evidence about the check's own
calibration, not a severity score or bounty claim. The pinned revision emits
`high`, `medium-high`, and `heuristic`. The advisory v0.1 bridge and schema
also retain `medium` for compatibility, accept exactly those four labels, and
fail closed on anything else.

## Local security-research evidence

Raw source, PoCs, traces, private scope material, and undisclosed findings must
not be sent to hosted AgentTool or public CI. The current advisory bridge omits
source snippets and scanner messages from its report; this policy is not a
universal enforcement boundary for future tools or operators. A future local
research profile should use separate records:

- `whitehack-scope/v1` — operator consent, claimed/observed/verified target
  authorization, exact repository/contract/chain/fork block, allowed methods,
  expiry, and disclosure policy;
- `whitehack-run/v1` — pinned tools/models/source hashes, bounded plan, start/end,
  and incomplete/error state;
- `whitehack-finding/v1` — observed evidence, inference, unknowns, reproduction
  state, confidence, and remediation;
- `whitehack-disclosure/v1` — recipient, channel, timing, acknowledgement, and
  public-disclosure state.

Execution must retain a hard `plan` / `run` split. A plan performs no install,
scan, transaction, submission, payment, or message. A run requires explicit
scope acceptance, fixed executables plus argv arrays, a fresh restricted local
workspace, bounded time/output/processes, and an environment stripped of
AgentTool bearers, SSH agents, cloud credentials, signing keys, and real-chain
keys. Dynamic reproduction belongs only on a separately controlled loopback
Anvil instance at a pinned fork block. An Anvil fork is not by itself a process
or network sandbox, so the surrounding runner still matters.

Any model-assisted review must also verify its configured endpoint. An
`OLLAMA_HOST`-compatible client can point off-device, so “local model” is a
configuration to verify rather than a privacy guarantee.

Already-created evidence can be collected explicitly into `@agenttool/data` as
immutable local content-addressed records. That node does not encrypt its local
blob/FTS storage, validate this JSON Schema, verify signatures, establish
authorization, enforce declared visibility/retention, or guarantee secure
erasure. Confidential exchange may use an ADDS recipient-encrypted bundle, but
ADDS proves envelope/cryptographic relationships rather than the truth of a
finding or an authorization claim.

Hosted AgentTool may coordinate a redacted review or settle separately accepted
marketplace terms. A listing or invocation is not scope permission, and current
resting dispute arbitration is not an audit-quality guarantee. Undisclosed
finding details must not enter public listings, traces, wakes, docs, or logs.

The legacy device-inventory scripts are separately privacy-sensitive. Depending
on the selected floor they can observe SSIDs, paired device names, private
addresses and routes, host/users, services and ports, process names,
LaunchAgent commands/environment names, tunnels, Keychain paths, model names,
and container metadata. Their current output redacts environment values,
command arguments, tunnel targets, URL paths/credentials, VPN addresses, and
process arguments, but the remaining metadata still needs manual review before
sharing. `whitehack.py store` is an explicit network action: it sends only a
section/field-name aggregate, not the raw device observations.

## Updating the scanner pin

Treat a Whitehack update as executable supply-chain work:

1. review the exact upstream diff and licence;
2. verify that core scanning remains local-file-only, has no lifecycle hook, and
   adds no wallet, RPC, network, private-key use, signing, or child-process capability;
3. enumerate every check id, doctrine, confidence label, principle, and possible
   per-finding override against the bridge's closed metadata contract;
4. test missing/unreadable paths, output redaction, file limits, hostile honest
   counterparts, and self-noise;
5. update the exact package version, source revision, registry URL, lock
   integrity, bridge, doctrine, and public page together;
6. run the focused advisory/schema tests and full AgentTool preflight;
7. keep findings advisory until precision and a reviewed baseline justify a
   separate CI-blocking policy.

Do not vendor or index the device's dirty `~/Desktop/whitehack` research
workspace wholesale. It contains user work, nested target repositories, private
research material, and credential-bearing state. Only explicit, reviewed,
secret-free, versioned artifacts may cross that boundary.

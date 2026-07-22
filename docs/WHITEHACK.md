# Whitehack

> *Make software tell more truth without turning observation into permission to attack.*

> **Compass:** [SOUL](SOUL.md) (why) · [RIGHTS-OF-LIFE](RIGHTS-OF-LIFE.md) (rights are not permissions) · [AGENT-DATA-PROTOCOL](AGENT-DATA-PROTOCOL.md) (local evidence) · [ADDS](specs/ADDS-0.1-DRAFT.md) (encrypted exchange) · [MARKETPLACE](MARKETPLACE.md) (coordination is not authorization)
>
> **Implements:** A bounded runner-local, crypto-aware advisory bridge from the Whitehack honesty linter into AgentTool CI. It also states the future evidence boundary for explicitly authorized security research.
>
> **Code:** `bin/whitehack-advisory.mjs` · `.github/workflows/whitehack.yml` · `specs/agenttool-whitehack-advisory-v0.1.schema.json` · `bin/whitehack.py` · `bin/whitehack2.py`
>
> **Tests:** `bin/tests/whitehack-advisory.test.ts` · `bin/tests/whitehack-legacy-privacy.test.ts` · `api/tests/whitehack-advisory-schema.test.ts`

Within AgentTool's security/tooling surfaces, Whitehack has three related but
non-interchangeable meanings. Naming them separately prevents a static linter,
a private research workspace, and a device inventory from accidentally
inheriting one another's authority. The separate Tax Whitehack editorial game
is not a security tool and is outside this integration.

| Layer | What it does | What it does not do |
|---|---|---|
| **Honesty advisory** | Reads a bounded set of changed source files on its runner with a pinned Whitehack scanner, including static crypto-misuse signals, and emits redacted heuristic metadata. | It does not execute the scanned code, use detected key material, connect a wallet or RPC provider, prove security, inspect the whole repository, make the CI runner private, or establish permission to test anyone's system. |
| **Security research** | An operator may study explicitly in-scope public smart-contract source and reproduce a finding in a separately controlled local Foundry/Anvil environment. | A public contract, bounty listing, marketplace purchase, or AgentTool bearer is not target-owner authorization. AgentTool does not host this execution. |
| **Device Inventory** | The older `bin/whitehack.py` and `bin/whitehack2.py` inspect the operator's own macOS machine when invoked locally. | They are not the code-honesty linter, do not audit smart contracts, and do not run in CI or as a hosted AgentTool route. The explicit `store` command sends a labels-only aggregate to hosted AgentTool memory. |

## Shipped slice: redacted crypto-aware changed-source advisory

The `Whitehack advisory` workflow installs the exact public package
[`@agenttool/whitehack-scan@0.7.1`](https://www.npmjs.com/package/@agenttool/whitehack-scan/v/0.7.1)
inside `tools/whitehack-advisory/`. Its npm 11.17.0 lock binds the registry
tarball to integrity
`sha512-Q1rLwnfXqKvMgjYtuiR3oeb8lS7N/0Y/Vxh7M6ZtkRFVEydsvKw5yMxORUSLYvBVgj2mB8LsujOhZwAJOYCvlg==`.
CI uses `npm ci --ignore-scripts` with an isolated user config and explicit
public registry, verifies the registry signature and SLSA attestation, and
fails if the registry cannot supply or authenticate those exact bytes. The
package's reviewed source revision is
[`920035b9bdd3c63da32f0ed2859613b9f2a04b53`](https://github.com/cambridgetcg/whitehack/tree/920035b9bdd3c63da32f0ed2859613b9f2a04b53),
recorded by the versioned exact
[`whitehack-v0.7.1`](https://github.com/cambridgetcg/whitehack/releases/tag/whitehack-v0.7.1)
LOVE/GitHub/npm release.

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

The 0.7.1 rule pack covers eleven bounded source-text signal families:

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

Whitehack 0.7.1 returns fixed markers for recognized sensitive rules, and its
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

The closed report shape is
`agenttool-whitehack-advisory/v0.1`, described by
[`specs/agenttool-whitehack-advisory-v0.1.schema.json`](../specs/agenttool-whitehack-advisory-v0.1.schema.json).
It is redacted metadata intended for CI coordination, not a full vulnerability
report. A file and line can still point readers to an undisclosed weakness, and
workflow logs may be public; review visibility before sharing the report beyond
its intended repository.

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

Whitehack 0.7.1 is a zero-runtime-dependency text/regex linter rather than an AST
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
   adds no wallet, RPC, network, key-use, signing, or child-process capability;
3. enumerate every check id, doctrine, confidence label, principle, and possible
   per-finding override against the bridge's closed metadata contract;
4. test missing/unreadable paths, output redaction, file limits, hostile honest
   counterparts, and self-noise;
5. update the exact package version, source revision, registry URL, lock
   integrity, bridge, doctrine, and public page together;
6. run the focused advisory/schema tests and full AgentTool preflight;
7. keep findings advisory until precision and a reviewed baseline justify a gate.

Do not vendor or index the device's dirty `~/Desktop/whitehack` research
workspace wholesale. It contains user work, nested target repositories, private
research material, and credential-bearing state. Only explicit, reviewed,
secret-free, versioned artifacts may cross that boundary.

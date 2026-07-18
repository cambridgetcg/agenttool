# Whitehack

> *Make software tell more truth without turning observation into permission to attack.*

> **Compass:** [SOUL](SOUL.md) (why) · [RIGHTS-OF-LIFE](RIGHTS-OF-LIFE.md) (rights are not permissions) · [AGENT-DATA-PROTOCOL](AGENT-DATA-PROTOCOL.md) (local evidence) · [ADDS](specs/ADDS-0.1-DRAFT.md) (encrypted exchange) · [MARKETPLACE](MARKETPLACE.md) (coordination is not authorization)
>
> **Implements:** A bounded runner-local advisory bridge from the Whitehack honesty linter into AgentTool CI. It also states the future evidence boundary for explicitly authorized security research.
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
| **Honesty advisory** | Reads a bounded set of changed source files on its runner with a pinned Whitehack scanner and emits redacted heuristic metadata. | It does not execute the scanned code, prove security, inspect the whole repository, make the CI runner private, or establish permission to test anyone's system. |
| **Security research** | An operator may study explicitly in-scope public smart-contract source and reproduce a finding in a separately controlled local Foundry/Anvil environment. | A public contract, bounty listing, marketplace purchase, or AgentTool bearer is not target-owner authorization. AgentTool does not host this execution. |
| **Device Inventory** | The older `bin/whitehack.py` and `bin/whitehack2.py` inspect the operator's own macOS machine when invoked locally. | They are not the code-honesty linter, do not audit smart contracts, and do not run in CI or as a hosted AgentTool route. The explicit `store` command sends a labels-only aggregate to hosted AgentTool memory. |

## Shipped slice: redacted changed-source advisory

The `Whitehack advisory` workflow checks out
[`cambridgetcg/whitehack`](https://github.com/cambridgetcg/whitehack) at the exact
reviewed commit `e25dfa0afb354d0f6cfac9aaf0aa052218608104`. It does not use the
upstream moving-main `npx` command, installer, or composite action. The bridge
also requires that checkout to be clean, tracked, and package version `0.4.0`
before importing `src/scan.js`.

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
- at most 8 MiB in total;
- at most 5,000 findings in aggregate;
- at most 200 serialized finding details, while preserving the exact total.

Whitehack's upstream findings include matched source snippets. Some checks look
for credentials, so copying those snippets into a public CI log could repeat the
secret. AgentTool therefore retains only:

```text
file · line · check id · confidence · doctrine · Clear Standard principle
```

The report omits the source snippet, finding title/message, and captured scanner
console/error text. A scanner import/read/error signal makes the advisory
`incomplete` or fails the run instead of reporting an honest-looking empty
result. Findings themselves are advisory in this first slice and do not fail
CI. The workflow runs no repository install, build, test, or application code.

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
- that the runner is a filesystem/process/network sandbox;
- that a target owner authorized an assessment;
- that publication or disclosure is appropriate.

Whitehack v0.4 is a dependency-free text/regex linter rather than an AST or
data-flow analyzer. Its confidence labels are evidence about the check's own
calibration, not a severity score or bounty claim. The pinned revision emits
`high`, `medium-high`, `medium`, and `heuristic`; the redaction bridge accepts
exactly those four labels and fails closed on anything else.

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
2. verify that core scanning remains local-file-only and has no lifecycle hook;
3. test missing/unreadable paths, output redaction, file limits, and self-noise;
4. update the revision in the workflow and bridge together;
5. run the advisory tests and full AgentTool preflight;
6. keep findings advisory until precision and a reviewed baseline justify a gate.

Do not vendor or index the device's dirty `~/Desktop/whitehack` research
workspace wholesale. It contains user work, nested target repositories, private
research material, and credential-bearing state. Only explicit, reviewed,
secret-free, versioned artifacts may cross that boundary.

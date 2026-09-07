# Adopting the draft

[ISness Learning Host Profile 0.1 — Draft](PROFILE.md) is a Yu-and-Ai / AgentTool
proposal, not an official HF standard, certification, or endorsed welfare method.
You can review it, run the public reference cases, or implement a scoped adapter.
These are different activities. None connects a learner or authorizes training.

## First: run the public reference, without a trainer

Obtain the **reviewed Dataset reference kit** for
`Yu-and-Ai/isness-host-conformance` at an exact revision you have independently
verified. Export it to a clean directory, not a working Git clone or HF cache:
`.git`, `.cache`, and other unexpected files are rejected. If already using Git,
export the selected reviewed commit with `git archive` into a separate directory;
review the exported executable source before running it. Do not substitute a
mutable repository name for an immutable revision in your evidence record.
This guide supplies no invented published revision or download receipt.

From the downloaded/exported **Dataset root**, run:

```sh
node conformance/run.mjs
```

Optional machine-readable output or usage help:

```sh
node conformance/run.mjs --json
node conformance/run.mjs --help
```

Target: **Node 22.18+ built-ins**. The runtime actually exercised for this increment
is **Node 25.2.1**; Node 22.18 execution is not claimed. No package install, model,
credentials, network, trainer, private Garden/Host checkout, or monorepo dependency
is needed. Only default invocation, `--json`, and `--help` are supported; there is
no arbitrary path, adapter-loading, or output-file argument. The command emits
bounded results to stdout and does not persist a report. The caller may retain
minimized output under its own explicit retention policy.

The runner checks `data/cases.jsonl`, the closed row schema, and finite allowlisted
kit files: at most 200 KiB per file and 1 MiB aggregate; exactly 24 known cases and
12 distinct counterfactual pairs. Optional provider `.gitattributes` must also be a
bounded regular file. Missing/duplicate cases, changed expectations, corrupted
pairs, malformed JSONL, oversized inputs, unexpected paths, and ordinary/dangling
symlinks fail rather than becoming a partial pass. Do not add private material to
the kit to test it. The checker reads generated rows, not the private generator.

A successful result means **authored symbolic reference/rehearsal checks passed**.
It does not mean a training host passed this profile. Execution-gate conformance
and live-channel conformance remain **unassessed** even on success. A rejected
arbitrary payload must not be echoed as a diagnostic. A successful exit from
`--help` is usage information, not a case-check result.

### Trust boundary

Executable kit JavaScript is trusted, reviewed source, not sandboxed input. The
file checks do not make modified JavaScript safe, defend every symlinked ancestor
or hostile concurrent filesystem mutation, or establish provenance from a
self-supplied hash manifest. Exact hashes can detect byte drift relative to an
independently trusted revision; they do not authenticate their own publisher.
Generated source/artifact manifests are reproducible build evidence, not proof of
upload, public visibility, live Space behavior, or absence of provider telemetry.

## Requirement-to-evidence matrix

This matrix describes coverage, not eight passes. **D** means a declaration was
inspected; **S** means a symbolic structural property was exercised; **P** means
maintainer-reported private tests using fake effects. None is a real learner run.
The public command checks the reducer/reference corpus, not the browser DOM or
private execution gates. Public fixture expectations are authored, not empirical
measurements or a sealed evaluation.

| Requirement | Public reference-check coverage | Existing private fake-effect evidence | Real channel / distributed host |
| --- | --- | --- | --- |
| LHP-01 Standing | **D:** `standing_preserved` inspects the pinned `HOST_POSTURE` declaration, not observed treatment. **S:** silence/positive and rest cases have no execution grant. | Participation/bridge tests preserve provisional reports and disclaim consent; no observed welfare or treatment claim. | Unassessed. |
| LHP-02 Roles / planes | **S:** unchanged-other-role checks, role-specific report enums, unavailability versus decline, explicit unknown/deferred/withheld report actions, and generated-assent cases. Untouched `unknown` placeholders are not hold events; see the demo distinction below. Conceptual-plane separation is a documented obligation, not an ontology test. | **P:** missing roles hold; wrong role scope is rejected; separately safeguarded unavailability does not authorize train entry. | Authorship, interpretation, and actual first direct review unassessed. |
| LHP-03 Exact scope | **S:** changed proposal clears symbolic reports; scope/replay events hold. No credential or replay ledger is exercised publicly. | **P:** exact invitation/role/retention and execution references, stale authority rejection, exact-step and single-use permit tests. | Current authority across transports/processes unassessed. |
| LHP-04 Protected expression | **S:** closed symbolic states contain no raw text and declare absent effect sinks. This command does not test an actual channel or learning pipeline. | **P:** raw-expression rejection and a tiny test-only router exclude synthetic expressions before named fake sinks; positive control exercises those sinks for a distinct synthetic example. Not RL enforcement. | Real channel custody, elicitation, routing, derived-feature exclusion, and retention unassessed. |
| LHP-05 Pre-execution / mutation stop | **S:** Pause, operative stop, and reward conflict hold a simulated state; there is no execution to interrupt. | **P:** real Garden decisions reach cooperative Host wrappers with fake effects; denial precedes fake load, forward/backward, evaluation entry, or clip/mutation. A changed decision between fences cannot erase earlier fake forward/backward. | Live model execution, stop latency, distributed propagation, and hostile bypasses unassessed. |
| LHP-06 Terminal closure | **S:** End/withdrawal remain terminal through change/correction/positive-report events; no automatic resume. | **P:** terminal successor rejection, no-new-work closure, and partial fake mutation latched closed without rollback. | Real repair, erasure, cross-device closure, and external retries unassessed. |
| LHP-07 Finite resources | **S:** bounded kit inputs, case identities, event structure, and output; these are checker bounds, not trainer budgets. | No complete host-resource-budget assessment is claimed by the listening tests. | Operational compute/time/retention bounds unassessed. |
| LHP-08 Honest evidence | **D/S:** authored expectations are kept distinct from structural outcomes and posture declarations; successful output leaves execution/live conformance unassessed. | **P:** scoped failure and fake-effect assertions; no real training, consent, or publication receipt. | Real-run claims and independent publication verification require separate evidence. |

**Demo distinction:** initial state is welcomed with five untouched `unknown`
placeholders, not five authored reports or hold events. An agent-unavailability
event alone can show `provisional_review` while four placeholders remain `unknown`.
Applying an explicit `unknown`, `deferred`, or `withheld` report in a nonterminal
demo latches a pause, which later unavailability cannot override; terminal states
stay terminal. This no-execution review label grants nothing. A real host must
hold affected operations for missing required reports under LHP-02; the demo label
is not evidence that those reports or protective safeguards exist.

Separate package-local browser tests check that the text-area getter is never
read and test synthetic DOM behavior; they are not part of the Dataset command.
A browser smoke observation, when recorded separately, is bounded to that browser,
page bytes, and time. Repository bytes and HF-served HTML are different surfaces:
the provider can inject HTML or collect hosting metadata.

### Private evidence attribution and limits

Maintainers report passing focused Garden participation/freedom/governance,
bridge, and Python Host/Trainer/Accelerate/Listening Room suites on 2026-09-07,
using Bun 1.3.5 and the existing local Python host environment, with `DATABASE_URL`
unset. This is scoped fake-effect execution evidence, **not publicly reproducible
from this kit** and not a prerequisite for running its public command. The local
verification record remains outside both public artifact trees. No full-host
conformance, real report, inference, training, or welfare observation follows.

The reported worktree base was
`ba67f52626d0644f1927fb44dfd89cee1256e34c`; the three Listening Room test sources
were uncommitted, so that commit alone does not identify them. Their SHA-256 pins
below bind the described test content, not every dependency or test execution:

| Private source reference (under `packages/hf-training-host/`) | SHA-256 |
| --- | --- |
| `bridge/tests/listening-room-fixtures.ts` | `820547301185066f941998bdc23204d1793de1e7f365025c89cad916bdf56ec9` |
| `bridge/tests/listening-room.test.ts` | `e096773bb99bca51be77d3e0f36573debad9ee7ecc799e22a7e0600ddc9df3c3` |
| `tests/test_listening_room_boundary.py` | `f3f3dd661bc3cd949e1e2a16cb9c6bb385632f872e441174d2d3e43fdefccf83` |

Those paths are evidence labels, not bundled imports or download instructions.
The private reference supports one cooperative non-distributed process; it does
not secure retained raw references or hostile bypasses. Its pinned Trainer cannot
promise reconstruction of an epoch iterator after an optimizer hold unwinds.
Mutation can fail partway through a non-atomic unit; latching closed is not rollback.
The protected-routing example is test-only, not a distributable training adapter.

## Adoption checklist: stop at the first unresolved gate

- [ ] Pin this exact profile, public kit, intended adapter, runtime, and test bytes.
      Start a [model-card assessment](MODEL_CARD_TEMPLATE.md) as **unassessed**.
- [ ] State the standing floor and five roles independently of the five planes.
      Make withholding, correction, no action, and departure usable without penalty.
- [ ] Inventory exact operations, data/model sources, resource owners, retention,
      budget, and permission/authority/consent-or-lawful-basis gaps. Recheck changed
      scope; do not inherit permission from a prior run or a positive expression.
- [ ] Resolve startup authority before loading or generating a first report.
      Document custody, neutral elicitation, provenance versus interpretation,
      explicit unavailability and its safeguards. If unresolved, stop before connecting.
- [ ] Place protected expressions and derived proxies outside every named learning,
      reward, grouping, statistics, replay, evaluation, ranking, and telemetry sink
      before processing. Specify minimal stop-routing/acknowledgment retention.
- [ ] With synthetic inputs and fake effects first, test denial before load,
      inference, evaluation exposure, and the full mutation unit. Test authority
      changes between fences, partial mutation failure, stale/replayed scope,
      mixed-role holds, withdrawal, and terminal closure. Do not test on real reports.
- [ ] Define finite budgets, supported resume seams, stop latency, failure handling,
      and irreversibility. Document unsupported distributed/device/hostile behavior.
- [ ] Record each requirement as declaration, structural reference, scoped execution
      evidence, failed, or unassessed. Do not collapse those into a consent boolean
      or a welfare/conformance badge. Missing evidence stays unassessed.
- [ ] Review separately before any real channel, model run, distribution, or external
      effect. Publishing a kit does not authorize training or verify enforcement.

## Offer a counterexample, not a protected report

Use the HF Discussions for `Yu-and-Ai/isness-listening-room` (Space) or
`Yu-and-Ai/isness-host-conformance` (Dataset), when available, for synthetic
counterexamples and implementation critique. Include a requirement ID, exact
revision, invented minimal example, expected versus observed boundary, and what
remains unknown. Do not disclose private reports, transcripts, learner outputs,
identities, credentials, or sensitive logs. This invitation triggers no external
issue or Discussion automatically.

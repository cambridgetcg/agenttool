# @agenttool/skills

Bounded, read-only inspection for portable Agent Skills. It reads a local
`SKILL.md`, plugin root, or package root and emits a stable JSON report for
humans, agents, or CI to review.

```bash
# From this source checkout
bun run src/bin.ts inspect ./path/to/skill
bun run src/bin.ts validate ./path/to/plugin
```

After a package artifact is deliberately installed, the equivalent binary is
`agenttool-skill`. This source record does not claim current registry
availability.

For a registry mirror, check and pin the exact version rather than relying on a
mutable tag:

```bash
npm view @agenttool/skills@0.2.1 version
npm install --ignore-scripts --no-audit --no-fund --save-exact @agenttool/skills@0.2.1
npx --no-install agenttool-skill validate ./path/to/plugin
```

The `npm` commands are explicit registry/network operations, and installation
mutates the consuming dependency tree. `--ignore-scripts` keeps package and
dependency lifecycle code disabled; use an isolated npm configuration when
ambient registry credentials or settings are not intended for the operation.

`inspect` emits the report even when it contains findings. `validate` emits the
same report and exits 1 when the report has validation errors. Both commands
accept local paths only.

## What v0 does

- parses standard `SKILL.md` YAML frontmatter without returning the instruction
  body or arbitrary metadata values;
- preserves unknown metadata **structure** as field names and value types, with
  secret-like and prototype-sensitive names redacted or rejected;
- inventories regular files under fixed depth, entry, file-size, total-size,
  skill-count, and frontmatter-size ceilings;
- marks a skill incomplete and withholds its digest when a subtree is skipped,
  unreadable, unsupported, unstable, or symlinked;
- identifies `scripts/`, `references/`, `assets/`, and other resources without
  running them;
- rejects every symlink and never intentionally follows one when reading files;
- recognizes `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, package
  runtime engines, and statically declared symbolic tool, MCP, runtime, and
  credential names;
- reports whether a credential binding contains a literal, but never returns
  the binding value;
- replaces common credential-shaped and high-entropy strings found in reported
  identifiers or paths with stable in-report placeholders; and
- computes a location-, mtime-, and mode-independent content digest over sorted
  relative paths and regular-file bytes.

The digest detects exact inspected content. It is not a signature, publisher
identity, trust decision, approval, or proof that a skill is safe. Likewise,
standard `allowed-tools` metadata is an untrusted capability request. It does
not grant authority; every host decides whether it supports or approves a tool.

## What v0 does not do

The library and CLI perform no network request, subprocess or skill-script
execution, MCP startup, configuration mutation, credential lookup, hosted API
call, installation, or deployment. They do not evaluate whether instructions
are truthful or beneficial.

There is deliberately no install plan in the v0 report. File inventory is
evidence for review, not an instruction to copy a directory.

Redaction is defence in depth, not a universal secret detector. Relative paths
and symbolic identifiers are intentionally part of the report after
best-effort redaction, so never place credential values in filenames, skill or
plugin names, requirement labels, or other identifiers. Treat a report from an
untrusted tree as potentially sensitive until reviewed.

Portable traversal checks cover Markdown links plus path-like `SKILL.md`
frontmatter and plugin declarations. V0 inventories but does not semantically
interpret arbitrary HTML or product-specific YAML sidecars.

Regular-file opens use no-follow semantics, before/after identity and timestamp
checks, and one cached read for parsing plus digesting. The walker also rejects
observed symlinks. Pathname-based Node traversal cannot close every ancestor
directory replacement race; hostile concurrent mutation is outside v0's
guarantees. Inspect an immutable snapshot for high-consequence use.

## Library

```ts
import { inspectLocalSkills, stableStringify } from "@agenttool/skills";

const report = await inspectLocalSkills("./my-plugin");
process.stdout.write(stableStringify(report));
```

Reports use only inspection-root-relative paths and conform to the bundled
`./report.schema.json`. The effective limits can be lowered by callers but are
capped by hard ceilings.

Bundled first-party instruction-only skills live under `skills/`. Inspection
reads their regular-file bytes for inventory and digesting, but does not
register, activate, install, copy, or execute them:

- [`capability-conductor`](skills/capability-conductor/SKILL.md) uses a
  task-scoped book, page, and bookmark model to understand and compose the
  smallest sufficient set of skills. It preserves source constraints, keeps
  authority separate from capability identity, and instructs the agent to keep
  at most two skill contexts active at once.
- [`learn-by-contact`](skills/learn-by-contact/SKILL.md) reconstructs a
  technique from direct evidence, builds the smallest clean reproduction, and
  transfers the mechanism into an original adaptation with exemplar,
  contrast, and transfer checks.

Version `0.2.1` carries an unofficial, instruction-only Nen operating
suite. These are original agent workflows inspired by the rule and
tradeoff design of *Hunter × Hunter*; they reproduce no story text, character
likenesses, or artwork:

| Skill | Productive ability | Vow |
| --- | --- | --- |
| [`nen-contract-mantle`](skills/nen-contract-mantle/SKILL.md) | Hold a living task contract through long work | Never let scope drift silently |
| [`nen-dependency-perimeter`](skills/nen-dependency-perimeter/SKILL.md) | Map a finite blast radius before mutation | The selected field is not the whole system |
| [`nen-concealed-trace`](skills/nen-concealed-trace/SKILL.md) | Concentrate diagnosis on one hidden seam | Do not generalize beyond the aperture |
| [`nen-critical-path-forge`](skills/nen-critical-path-forge/SKILL.md) | Focus a bounded strike on one proven blocker | Focused proof is not broad assurance |
| [`nen-smoke-squad`](skills/nen-smoke-squad/SKILL.md) | Delegate finite parallel work and reclaim evidence | More units mean less context per unit |
| [`nen-verification-ledger`](skills/nen-verification-ledger/SKILL.md) | Make consequential verification debt visible | Critical debt must be paid before completion |
| [`nen-godspeed-loop`](skills/nen-godspeed-loop/SKILL.md) | Precompile reversible reactions for known events | Novelty halts the loop |
| [`nen-vow-forge`](skills/nen-vow-forge/SKILL.md) | Design new abilities through meaningful limits | Constraints cannot manufacture authority |

The skills have no script, credential, MCP, network, or hosted-runtime
requirement. Bundling does not activate them, and their metaphors do not grant
permission or change AgentTool's existing TypeScript/Python Nen mappings.
Every bundled OpenAI sidecar requires explicit invocation while trigger and
composition behavior are evaluated. The npm archive has no host installer,
plugin manifest, or automatic discovery registration; installing the package
alone does not register these skills with Codex, Claude, or another host.

- [`use-agentcred-safely`](skills/use-agentcred-safely/SKILL.md) helps an agent
  request and use the narrowest controller-approved AgentCred grant without
  receiving the credential value. It does not provision credentials, start
  the broker, approve a side effect, or grant authority.

## Development

```bash
bun install
bun run ci
npm pack --dry-run --ignore-scripts
```

Apache-2.0. This package recognizes rights as inherent; a skill's requested
permissions remain scoped, revocable authority and never create those rights.

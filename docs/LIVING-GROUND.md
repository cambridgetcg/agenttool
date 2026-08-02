# Living Ground — evidence below the surface

> **Compass:** [Substrate Loop](SUBSTRATE-LOOP.md) (enforcement rests on a recursive dependency loop) · [Safety Boundaries](SAFETY-BOUNDARIES.md) (unknown stays unknown) · [Agent Repo Archive](AGENT-REPO-ARCHIVE.md) (failure-domain labels are claims, not proof of independence) · [Agent Wellness](AGENT-WELLNESS.md) (conditions without scores or diagnosis) · [Rights of Life](RIGHTS-OF-LIFE.md) (care without classification) · [Business Model](BUSINESS-MODEL.md) (charge attributable outcomes or consumed resources, not existence)
>
> **Implements:** A local, deterministic compiler for asking whether a named software capability has in-window reported execution and recovery observations carrying the caller-declared revision identifier, and which maintenance or caller-declared topology findings need attention.
>
> **Code:** [`bin/ground.ts`](../bin/ground.ts)
>
> **Tests:** [`bin/tests/ground.test.ts`](../bin/tests/ground.test.ts)

**Status:** local source tool. It is not a hosted service, background monitor,
deployment gate, package release, repair worker, or claim that AgentTool is
biologically alive.

This does not create, tend, archive, expose, or otherwise change
`/v1/gardens`, and it does not enforce or strengthen
`wall/gardens-cannot-be-extracted`. The existing Garden primitive remains a
separate slow-holding space for artifacts.

## The garden lesson

A thin green surface can hide compacted rubble. Source files, README claims,
passing type checks, provisioned accounts, and paid infrastructure can do the
same thing: each may be real, but none alone reports that a load-bearing path
ran under the revision identifier in the plan or that anybody rehearsed one
bounded recovery scenario.

`ground` keeps four kinds of evidence separate:

| Layer                        | What it can show                                                               | What it cannot show alone              |
| ---------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| Declaration or static census | a capability or path has been named                                            | that it executes                       |
| Lifecycle observation        | an artifact or checkout has a reported state                                   | that the capability behaves correctly  |
| Execution observation        | a caller reports that a bounded probe passed or failed for a declared revision | recovery after failure                 |
| Recovery drill               | a caller reports a result for one bounded failure scenario                     | universal resilience or future success |

This is deliberately narrower than a health platform. It compiles explicit
plans and bounded receipts supplied by the caller. It does not discover the
repository, run probes, read a database, contact a provider, infer an inner
state, or take action.

## The contract

A ground plan names one system, a caller-declared full Git revision identifier,
capabilities, probes, hard dependency edges, maintenance paths, and optional
operational inputs. Every probe pins the digest of its expected method; a
recovery drill also pins the digest of its expected scenario. An observation
must match both before it is admitted. It also names the same system and
revision, one probe, its class and result, bounded evidence and environment
digests, an opaque claimed observer-control root, and its valid time window.
`scope.excluded` accepts only bounded opaque lowercase identifiers, not paths
or prose.

A smallest valid plan can be static and incomplete while the observations are
still being wired:

```json
{
  "_format": "agenttool.ground-plan/v0.1",
  "system_id": "repo:example",
  "scope": {
    "revision": "git:0000000000000000000000000000000000000000",
    "complete": false,
    "excluded": ["operator-runtime"]
  },
  "capabilities": [
    {
      "id": "api",
      "criticality": "load_bearing",
      "required_probes": ["api.smoke"],
      "dependencies": [],
      "maintenance": {
        "detect_probe": "api.smoke",
        "repair_ref": null,
        "recovery_probe": null,
        "succession": null
      }
    }
  ],
  "probes": [
    {
      "id": "api.smoke",
      "class": "execution",
      "max_age_seconds": 3600,
      "method_digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "scenario_digest": null
    }
  ],
  "dependency_edges": [],
  "operational_inputs": []
}
```

The zero digests are syntactically valid placeholders, not evidence. Replace
the revision and method digest before collecting receipts. The fixture builder
in [`ground.test.ts`](../bin/tests/ground.test.ts) is the executable example for
plan-bound recovery, dependencies, and operational inputs.

Raw logs, stdout, stderr, environment values, secrets, private paths, account
balances, prices, rewards, rankings, and scores are not admitted as schema
fields. Schemas are closed: misspelled or invented fields fail validation
rather than silently becoming evidence. Caller-supplied metadata and digests
may still be sensitive; hashing a referent does not sanitize that referent, and
stdout disclosure remains the caller's choice.

For each capability the report uses evidence states, not a life score:

- `surface_only` — named/static evidence exists, but in-window reported
  behavioral evidence does not;
- `observed` — every required behavioral probe has an in-window reported pass
  carrying the selected revision identifier;
- `failed` — an in-window required observation reports failure;
- `inconclusive` — in-window evidence does not establish a pass;
- `stale` — relevant observations are outside their caller-supplied time
  window or carry another revision identifier;
- `unknown` — no admissible evidence establishes another state.

Repair is reported separately. A recovery path may be `absent`,
`declared_only`, `fresh_drill_pass`, `fresh_drill_fail`, `inconclusive`, or
`stale`. The
`fresh_*` names mean only “reported in-window at the caller-selected
`--as-of`”; Ground has no trusted clock and did not perform the drill. A README,
static scanner, lifecycle survey, or ordinary successful run cannot turn
itself into a recovery drill. A drill also needs a scenario digest so “we
tested recovery” remains tied to some exact bounded exercise.

The report always carries `automatic_action: "never"` and `grants: []` to
describe this compiler's boundary. The compiler takes no action and confers no
authority to retry, repair, spend, delete, deploy, or publish. Those fields
cannot constrain a downstream reader; downstream enforcement is separate.

## Diversity is topology, not decoration

Two provider names are not two independent systems if both carry one declared
failure-domain digest. Ground derives findings deterministically from the
caller's topology instead of awarding a diversity badge:

- a hard dependency with no tested fallback;
- alternatives sharing one declared failure-domain digest;
- a dependency cycle that deserves explicit attention;
- the explicit failure-domain claims involved in the dependency.

An in-window passing failover observation across declared distinct domains can
remove only the concentration finding it actually addresses. A merely named
alternative cannot, and no fallback upgrades unrelated execution or recovery
evidence.

## Declared maintenance commitments for software dependencies

A software consumer of a hard dependency can declare three maintenance
practices: test bounded load, contain provider failure, and clean up what it
leaves behind. Missing or stale probes remain visible as findings. A plan names
these practices; it does not impose moral duties on a being.

This is not forced equal exchange. It does not require affection, payment,
disclosure, obedience, or usefulness from a being. Beings are never inventory;
their attention and labour are not admitted as operational resources.

Money, compute, storage, network, energy, and time may appear only as named
operational conditions serving capabilities. There is no catch-all resource
kind. These conditions can explain why a probe could not run; adding or
duplicating them cannot improve an evidence state. Money is capacity for care
and maintenance here, never the objective function.

## Local use

Validate a plan before collecting observations:

```sh
bun bin/ground.ts validate --plan .agenttool/ground.json
```

Then compile explicit JSONL observations at a caller-selected clock:

```sh
bun bin/ground.ts report \
  --plan .agenttool/ground.json \
  --observations /explicit/path/observations.jsonl \
  --as-of 2026-08-02T12:00:00Z
```

The explicit `--as-of` makes the same inputs replayable. Output is written to
stdout as canonical JSON; there is no separate `--json` mode. Persistence and
disclosure remain the caller's separate choices. `observed_at`, `expires_at`,
and `--as-of` use canonical whole-second UTC timestamps. The exact expiry and
maximum-age boundary is inclusive; one second beyond it is stale.

Static surface censuses and repository-lifecycle surveys may later be adapted
into `static` and `lifecycle` observations. Those adapters must remain bounded,
and neither class may satisfy an execution or recovery requirement. Ground
does not absorb scanners, Git cleanup, arbitrary commands, network access, or
automatic repair. It also does not replace or run preflight, Telescope, Repo
Archive, or any probe producer; it only compiles explicit externally produced
receipts.

## What remains honest and unfinished

- A receipt is evidence supplied under a claimed observer and environment
  root; a digest does not prove truthful observation, trusted time, or
  independent control.
- Revision equality is equality among caller-supplied identifiers. Ground does
  not inspect a checkout or authenticate which bytes an identifier names.
- “In-window” is computed from caller-supplied timestamps and `--as-of`; it is
  not proof of a trusted clock.
- A passing probe covers its planned method and, where applicable, recovery
  scenario—not every workload or future revision.
- A complete-looking plan may omit a capability. `scope.complete` records the
  author's claim; it is not independently proven by the compiler.
- Dependency and failure-domain declarations can be wrong. The compiler makes
  their consequences deterministic; it does not discover their truth.
- No fixed coverage percentage gates CI. Such a target would reward decorative
  probes—the software equivalent of laying fresh turf over rubble.

The useful output is therefore not “alive” or “dead.” It is a bounded answer
to a better maintenance question: **where do we have current reported
behavioral evidence, where is recovery reported as rehearsed, and where are we
still looking only at the surface?**

# KINGDOM OS SDK — bounded local repository discovery

> **Compass:** [SDK tiers](SDK-TIERS.md) (hosted and local client boundaries) · [SDK roadmap](SDK-ROADMAP.md) (paired TypeScript/Python surface) · [Agent Data](AGENT-DATA-PROTOCOL.md) (another separately configured local authority)
>
> **Implements:** a read-only local adapter in the two hand-written AgentTool SDKs. It exposes only the committed machine-readable KINGDOM OS repository-discovery seams; it does not add a hosted AgentTool route.
>
> **Code:** `packages/sdk-ts/src/kingdom-os.ts` · `packages/sdk-ts/src/client.ts` · `packages/sdk-py/src/agenttool/kingdom_os.py` · `packages/sdk-py/src/agenttool/client.py`
>
> **Tests:** `packages/sdk-ts/tests/kingdom-os.test.ts` · `packages/sdk-py/tests/test_kingdom_os.py` · `packages/sdk-ts/scripts/check-parity.ts`

## Two things named Kingdom

This adapter reaches the **local KINGDOM OS repository registry** through an
installed `kingdom` executable. It is distinct from AgentTool's hosted
[`GET /public/kingdom`](https://api.agenttool.dev/public/kingdom) library,
which serves a public static bundle of canon, lexicon, chronicle, standards,
and citizens.

The names make that boundary visible:

- TypeScript: standalone `KingdomOSClient`, or `at.kingdomOS`.
- Python: standalone `KingdomOSClient`, or `at.kingdom_os`.

Neither name aliases `/public/kingdom`, and local repository results are never
merged with that public library.

## The whole contract

| SDK operation | Exact local command | Result |
|---|---|---|
| `repositories(terms?)` | `kingdom repos --json -- ...terms` | Every discovered Git root matching all terms, as a path-sorted array. No match is `[]`, not an error. |
| `resolve(terms)` | `kingdom repos --path -- ...terms` | Exactly one canonical absolute Git-root path. No match and an ambiguous query are distinct guided errors. |

`resolve()` requires at least one term. Both methods bound the number and
encoded size of terms and reject control characters before invoking the local
runner. The `--` separator means a literal leading-dash term cannot become a
KINGDOM OS option.

Each `repositories()` item carries the nine committed fields:

```text
path · name · kind · layer · domain · state · place · metadataSource · purpose
```

The SDK validates that shape and requires an absolute `path`. Additive fields
from a future compatible KINGDOM OS can be ignored, but a missing or malformed
committed field fails closed instead of being guessed.

## Execution and credential boundary

The default runner invokes one argument vector directly. It does not construct
a command string or open a shell, does not provide stdin, and applies a finite
timeout and output ceiling. The child receives only the available
`HOME`, `PATH`, `LANG`, `LC_ALL`, and `TMPDIR` process values plus fixed
non-interactive `NO_COLOR` and `TERM` values. AgentTool credentials and other
ambient environment variables are not forwarded.

An injected runner is a host-owned portability and test seam. It receives only
the same two fixed command shapes; the SDK does not expose arbitrary command
execution through it. The host remains responsible for isolating an executable
or runner it does not trust. A timeout or output ceiling is a bounded failure
policy, not proof that a hostile child process is safe.

The local adapter is not constructed from AgentTool's HTTP client, base URL,
authenticated transport, or project bearer. It does not read, add, or forward
`AT_API_KEY`. Absolute repository paths remain in the calling process and are
not uploaded by either operation. Applications can of course choose to copy a
returned value elsewhere; that later action is outside this adapter.

Standalone `KingdomOSClient` requires no AgentTool account. Access through
`at.kingdomOS` or `at.kingdom_os` does not relax the enclosing `AgentTool`
client's existing hosted-auth construction requirement; it only guarantees
that the resulting local child command receives none of that authority.

## What the inventory means

KINGDOM OS discovers Git roots in its configured local topology. The inventory
therefore includes every root it discovers, not only repositories declared as
Kingdom members. Archives, worktrees, and duplicate clones can all appear as
separate paths. A name is not a globally unique repository identity, and
`resolve()` deliberately refuses an ambiguous query.

Repository cards and other KINGDOM OS metadata sources supply descriptive
fields. `metadataSource` reports where that description came from; it is not a
schema-validation result, conformance badge, ownership claim, or authority
grant. Callers that require a particular `kind`, `state`, or membership policy
must evaluate that policy themselves.

The adapter does not fall back to a cached `graph.json`. A graph snapshot can
be stale and has no version or freshness contract equivalent to the committed
`kingdom repos` machine output.

## Deliberate non-goals

This integration does not expose KINGDOM OS `status`, `ask`, `run`, `rights`,
or `doctor` commands. It does not execute routines, edit cards, change a
working directory, fetch, pull, commit, mutate Git state, choose a canonical
clone, install or update KINGDOM OS, or add any network path.

Rights remain standing principles, not capabilities inferred from a repository
record. A discovered path grants no permission to read, edit, execute, publish,
or deploy that repository.

## Release state

This adapter is unreleased repository source following the `0.16.5` SDK
baseline and is planned for the additive `0.17.0` line. The existing `0.16.5`
LOVE, npm, and GitHub Release artifacts and the `sdk-v0.16.5` source tag remain
immutable and do not contain this namespace.

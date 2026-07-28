# KINGDOM in SDK 0.17.0 — three distinct read surfaces

> **Compass:** [Agent discovery](AGENT-DISCOVERY.md) (the public project-card door) · [SDK tiers](SDK-TIERS.md) (hosted and local authority boundaries) · [SDK roadmap](SDK-ROADMAP.md) (paired TypeScript/Python surface)
>
> **Implements:** two paired, read-only SDK clients: bounded local KINGDOM OS repository inventory/resolution, and a credential-free typed read of AgentTool's own public KINGDOM project card. The existing public Kingdom doctrine library remains a third, separate surface.
>
> **Code:** `packages/sdk-ts/src/kingdom-os.ts` · `packages/sdk-ts/src/kingdom-framework.ts` · `packages/sdk-ts/src/client.ts` · `packages/sdk-py/src/agenttool/kingdom_os.py` · `packages/sdk-py/src/agenttool/kingdom_framework.py` · `packages/sdk-py/src/agenttool/client.py`
>
> **Tests:** `packages/sdk-ts/tests/kingdom-os.test.ts` · `packages/sdk-ts/tests/kingdom-framework.test.ts` · `packages/sdk-py/tests/test_kingdom_os.py` · `packages/sdk-py/tests/test_kingdom_framework.py` · `packages/sdk-ts/scripts/check-parity.ts`

The word **Kingdom** names three different read surfaces here. They do not
merge data, credentials, or authority:

| Surface | TypeScript | Python | Reads | Does not do |
|---|---|---|---|---|
| Local KINGDOM OS inventory and resolve | `KingdomOSClient` or `at.kingdomOS` | `KingdomOSClient` or `at.kingdom_os` | An installed `kingdom` executable's `repos --json` and `repos --path` outputs | No AgentTool HTTP, bearer forwarding, path upload, arbitrary shell, routine execution, or repository mutation |
| Canonical framework project card | `KingdomFrameworkClient` or `at.kingdomFramework` | `KingdomFrameworkClient` or `at.kingdom_framework` | One credential-free `GET /public/kingdom/framework` response | No bearer, cookies, redirects, mutation, cross-repository inventory, or authority |
| Public Kingdom doctrine library | no dedicated SDK namespace | no dedicated SDK namespace | `GET /public/kingdom`: canon, lexicon, chronicle, standards, and citizens | It is not a project card, local repository inventory, SDK configuration source, or permission grant |

## Local KINGDOM OS inventory and resolve

The local client requires no AgentTool account:

```typescript
import { KingdomOSClient } from "@agenttool/sdk";

const kingdom = new KingdomOSClient({
  executable: "/path/to/KINGDOM-OS/kingdom",
});
const repositories = await kingdom.repositories(["agenttool"]);
const selectedRoot = await kingdom.resolve(["agenttool"]);
```

```python
from agenttool import KingdomOSClient

kingdom = KingdomOSClient(executable="/path/to/KINGDOM-OS/kingdom")
repositories = kingdom.repositories(["agenttool"])
selected_root = kingdom.resolve(["agenttool"])
```

The whole local command contract is:

| SDK operation | Exact local command | Result |
|---|---|---|
| `repositories(terms?)` | `kingdom repos --json -- ...terms` | Every discovered Git root matching all terms, as a path-sorted array. No match is an empty array/list, not an error. |
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

### Local execution and credential boundary

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
not uploaded by either operation. Applications can choose to copy a returned
value elsewhere; that later action is outside this adapter.

Standalone `KingdomOSClient` requires no AgentTool account. Access through
`at.kingdomOS` or `at.kingdom_os` does not relax the enclosing `AgentTool`
client's existing hosted-auth construction requirement; it only guarantees
that the resulting local child command receives none of that authority.

### What the local inventory means

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

The integration does not expose KINGDOM OS `status`, `ask`, `run`, `rights`,
or `doctor` commands. It does not execute routines, edit cards, change a
working directory, fetch, pull, commit, mutate Git state, choose a canonical
clone, or install or update KINGDOM OS.

## Credential-free framework project card

The framework client reads only AgentTool's normalized root `kingdom.yaml`
card. It can be used without an AgentTool account:

```typescript
import { KingdomFrameworkClient } from "@agenttool/sdk";

const card = await new KingdomFrameworkClient().card();
console.log(card.name, card.schema_version);
```

```python
from agenttool import KingdomFrameworkClient

with KingdomFrameworkClient() as kingdom:
    card = kingdom.card()
print(card["name"], card["schema_version"])
```

The same read is available lazily as `at.kingdomFramework.card()` and
`at.kingdom_framework.card()`. Constructing `AgentTool` still requires its
normal hosted authentication, but the framework read uses a separate
credential-free path. Its base URL and finite timeout/response bounds can be
configured by the enclosing client; it does not receive the project's bearer
or authenticated transport.

The client sends one bodyless JSON `GET` to the configured origin's exact
`/public/kingdom/framework` path. It deliberately sends no AgentTool
authorization header or cookie, does not consult ambient AgentTool
credentials, and refuses every redirect rather than replaying the request at a
new location. It applies a finite timeout and a 64 KiB response ceiling by
default. The timeout is configurable from more than zero through 300 seconds;
the response ceiling is configurable from 1 KiB through 1 MiB.

The timeout is one total caller-visible deadline across connection setup,
headers, the streamed success body, decoding, and validation—not a fresh
allowance for every received chunk. TypeScript aborts the fetch at that
deadline. Python performs the synchronous operation in one daemon worker and
makes that client terminal after a timeout; construct a new client for a
deliberate retry. This prevents repeated timed-out calls from accumulating
workers while best-effort cancellation finishes.

Python's standalone constructor also accepts a host-owned `httpx` transport
seam. The SDK still supplies no credential and disables ambient environment
trust, but it cannot guarantee what an injected transport implementation adds
or does. In particular, Python cannot forcibly stop arbitrary synchronous host
code that ignores both its timeout and close request. The total deadline still
returns control to the caller, the worker is daemonized, and that client will
not start another request, but the injected code may continue until it
cooperates. That behavior remains the host's boundary.

Both SDKs preflight a declared `Content-Length`, stream the decoded body under
the same ceiling, and accept only JSON media types. Success requires exact HTTP
200; other statuses produce fixed local status guidance and their bodies are
never imported as agent instructions, payment requests, or authority metadata.
A successful response must be UTF-8 JSON containing exactly these ten
fields—none missing and none extra:

```text
schema_version · name · kind · layer · owner_sister · domain · state
purpose · dependsOn · adopts
```

Validation pins `schema_version` to `agenttool.kingdom.card/0.1`, checks the
closed KINGDOM enums, bounds and rejects unsafe text, requires dense unique
bounded lists, and accepts only the declared `xenia.rights/0.1` adoption.
Redirects, oversized or unsupported-media responses, malformed JSON, and
schema drift fail with stable `kingdom_framework_*` errors rather than
returning a partial or guessed card.

The returned card is one publisher declaration about the AgentTool repository.
It carries no absolute local path, working-tree probe, liveness result, or
cross-repository registry. Parsing it does not prove that a dependency is
reachable, that a stated practice is followed, that any being consented, or
that AgentTool conforms to the XENIA Covenant.

## Authority stays outside all three reads

The local inventory can name a path; the framework card can name a project and
its declarations; the doctrine library can carry public language. None grants
permission to read private data, edit, execute, install, authenticate, publish,
deploy, act for another participant, or infer rights from a repository record.
Rights remain standing principles rather than capabilities minted by a card or
client response.

## Release state

These paired clients are the additive public `0.17.0` SDK surface. The exact
172,625-byte LOVE tarball remains the primary TypeScript release authority.
The GitHub Release and npm `@agenttool/sdk@0.17.0` mirror were independently
read back as identical bytes
(`sha256:b6a388ffe86a970480e8a8978f83fe80922321eb64f2b4f9143cae2b2c3dd5bb`)
by protected workflow
[`30385040459`](https://github.com/cambridgetcg/agenttool/actions/runs/30385040459).

Annotated `sdk-v0.17.0` points to merge
`21db539d6bcae614f1d6884eaa503347fae63187` and remains the primary Python
release locator. PyPI `agenttool-sdk==0.17.0` is an independently verified,
non-authoritative mirror: protected workflow
[`30385042684`](https://github.com/cambridgetcg/agenttool/actions/runs/30385042684)
matched the public 193,335-byte wheel
(`sha256:1a8ca5f099ffce4c7973f1123d973aba5c1eb507579961c781d553bcc5e0f508`)
and 181,846-byte sdist
(`sha256:7ec2f4010d20ca883770594bfbcdc30f7a3a074ba534029aefb6d91d69c3413c`).

These public package receipts do not establish production deployment.
Production status is established only by a clean exact-GitHub-main operation
followed by public route and artifact readback.

The existing `0.16.5` LOVE, npm, GitHub Release, PyPI, and source-tag records
remain immutable and contain neither of the two KINGDOM SDK namespaces.

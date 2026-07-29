# Agent Browser

> **Compass:** [SOUL](SOUL.md) (why) · [AGENT DATA](AGENT-DATA-PROTOCOL.md) (local-first precedent) · [TELESCOPE](../packages/telescope/README.md) (public-network boundary) · [MAP](MAP.md) (doctrine index) · [NOW](NOW.md) (current status)
>
> **Implements:** A local, agent-shaped browser control plane with direct TypeScript, line-delimited JSON, and stdio MCP interfaces over one bounded core.
>
> **Code:** [`packages/browser/src/`](../packages/browser/src/) · [`packages/browser/bin/agenttool-browser.ts`](../packages/browser/bin/agenttool-browser.ts)
>
> **Tests:** [`packages/browser/tests/`](../packages/browser/tests/)

## Status

The repository currently contains prepared `@agenttool/browser@0.5.0` source.
It is unreleased. `0.3.0` remains the immutable public latest through exact
LOVE, npm, and GitHub Release artifacts. The deployed catalog and docs
distribute bytes and documentation; they do not expose an AgentTool-hosted
browser. The package requires no AgentTool account, API key, credits, Redis,
database, or hosted control plane.

The exact `0.1.0`, `0.2.0`, and `0.3.0` artifacts remain immutable. Version
`0.3.0` packaged collaboration-safe retained observations, structural
accessibility context, navigation/action/close race hardening, and explicit
capability truth about browser-managed redirect hops. `0.4.0` was prepared but
never distributed; it added the `blockedNavigation` observation diagnostic and
the JSONL snake_case rename hint. Prepared `0.5.0` carries that work forward
and adds browser-act receipts, non-ref observation-basis preconditions,
session-local receipt context, a backend-neutral capability inventory, and
current MCP negotiation with an explicit compatibility path. None of those
unreleased changes widens authority.

The package uses `playwright-core` to drive a Chrome-family browser already
installed on the caller's machine. There is no postinstall hook and no bundled
browser download. This keeps browser selection and browser bytes under the
operator's control.

`0.2.0` introduced named authority profiles, capability reporting, and
zero-effect action planning; `0.3.0` retained those interfaces while hardening
their execution and observation contracts. The immutable `0.1.0` release
remains available as historical seven-operation bytes and does not gain later
features retroactively. This page describes prepared `0.5.0` source; install
commands near the end deliberately select public `0.3.0`.

## Why this surface exists

Most browser automation APIs expose either a large test framework or a
pixel-and-selector problem. An agent needs a smaller loop:

1. open one destination;
2. observe a bounded semantic view;
3. act on one referenced accessible element;
4. extract a bounded result or capture an artifact;
5. inspect tabs or close the session.

The package names that loop directly as `open`, `observe`, `act`, `extract`,
`screenshot`, `tabs`, and `close`. Direct TypeScript, JSONL, and MCP share
those named operations and one core rather than implementing three independent
browsers. The agent-facing transports deliberately expose a narrower argument
surface where noted below.

| Door | Intended caller | Transport boundary |
|---|---|---|
| TypeScript | Local application code | Imported `AgentBrowser` instance |
| JSONL | A local process that wants a minimal language-neutral protocol | One request and one response per line over stdin/stdout |
| MCP | An MCP-capable local agent host | Stdio server; tool arguments/results pass through that host and its model-provider boundary |

JSONL protocol version `agenttool-browser-jsonl/0.1` and MCP use the same
explicit operation names:

| TypeScript method | JSONL method / MCP tool |
|---|---|
| `open` | `browser_open` |
| `observe` | `browser_observe` |
| `act` | `browser_act` |
| `extract` | `browser_extract` |
| `screenshot` | `browser_screenshot` |
| `tabs` | `browser_tabs` |
| `close` | `browser_close` |

Version `0.2.0` introduced two aligned, non-executing operations retained by
prepared `0.5.0` source:

| TypeScript method | JSONL method / MCP tool | Effect |
|---|---|---|
| `capabilities()` | `browser_capabilities` | Reports effective process authority and implemented operations; no page or network probe |
| `plan(action)` | `browser_plan` | Returns a redacted advisory for one `BrowserAction`; no execution or approval |

`browser_plan` accepts `{ "action": ... }` only. Opening a destination can be
represented as a `new_tab` or `navigate` action. Plans never echo typed text or
selected values, and redact URL query values. Planning does not inspect the
live DOM, resolve a reference, make a request, reserve a future act, issue an
approval token, or prove what a remote UI will do.

Each JSONL request is
`{ "version", "id", "method", "params" }`. A response repeats `version` and
`id`, then returns either `{ "ok": true, "result": ... }` or
`{ "ok": false, "error": { "code", "message" } }`. The framing is one JSON
object per line; protocol stdout contains no banners or diagnostic prose.

Prepared `0.5.0` negotiates the current MCP `2026-07-28` revision and retains
an explicit 2025-era stdio compatibility path. Both routes expose the same
bounded browser core. MCP revision negotiation is transport compatibility,
not a browser driver, durable session protocol, or security boundary; browser
authority and AgentTool-owned handles remain local to this process.

MCP and JSONL extraction accept the whole page or one `ref` plus its issuing
`snapshot_id`; they do not accept a free-form selector. Trusted local
TypeScript code has a bounded selector extraction escape hatch because it
already runs with application-code authority. That lower-level option does not
add script evaluation, and it is intentionally absent from model-facing
transports.

Starting either stdio adapter is a local process action. It does not register a
remote integration, create an AgentTool identity, or grant a hosted service
access to the browser.

## Process authority is fixed at launch

Browser selection, network scope, profile persistence, headless mode, and
artifact location are process-start configuration. Individual page actions
cannot widen them. Unknown flags and malformed booleans fail closed.

The default configuration is:

- headless;
- public-web navigation allowed;
- local and private network navigation denied;
- a dedicated ephemeral browser context;
- installed `chrome` channel; and
- artifacts under
  `$XDG_DATA_HOME/agenttool/browser/artifacts`, or
  `~/.local/share/agenttool/browser/artifacts` when `XDG_DATA_HOME` is unset.

An operator may select another installed channel with `--channel`, or an exact
browser executable with `--executable`. Selecting one clears the other in CLI
configuration; direct callers must supply at most one. Neither choice
downloads a browser.

### Authority profiles introduced in 0.2

Version `0.2.0` makes destination authority explicit:

| Profile | Policy-checked HTTP(S) requests | WebSockets | Service workers |
|---|---|---|---|
| `public` (default) | Public only | Blocked | Blocked |
| `local` | Public plus local/private; reserved denied | Classified by the same boundary | Blocked |
| `sovereign` | Broad pass-through, including local/private/reserved; embedded userinfo rejected at the policy check | Passed through | Enabled |

`public` preserves the published compatibility default. `local` corresponds
to public web plus the existing local-network opt-in. `sovereign` does not
apply AgentTool destination-class blocking to policy-checked HTTP(S) requests
or WebSockets; embedded userinfo is rejected when a URL crosses that policy
boundary. Chromium-managed `Location` hops do not cross it again.
Reachability is delegated to the selected browser, host, DNS/proxy
configuration, network, and destination.

That delegation is broad local process authority. It may let remote page code
or a service worker reach loopback services, private networks, or other
host-reachable endpoints. A persistent profile may retain site and
service-worker state. Sovereign therefore does not claim SSRF isolation,
harmlessness, or reversibility. It also does not bypass authentication,
CAPTCHAs, site policy, account permissions, browser support, network controls,
or operating-system policy.

No profile promises universal site access. A destination may refuse,
challenge, throttle, render incompatibly, or require authority the caller does
not possess. Browser should report the exact local boundary or uncertain
outcome, not treat every refusal as a protection to bypass.

Destination reach remains separate from other consequential powers. File
upload, automatic download, arbitrary JavaScript evaluation, credential
injection/lookup, ambient normal-profile import, shell execution, and
extension installation remain unsupported in prepared `0.5.0` source.
`capabilities()` reports those absences instead of treating sovereign
destination reach as an implication that every power exists.

The forms retained in prepared `0.5.0` source are
`authority: "public" | "local" | "sovereign"`, `--authority`, and
`AGENTOOL_BROWSER_AUTHORITY`. The legacy booleans, flags, and environment
variables remain as a deprecated compatibility surface, but a launch cannot
mix new and legacy authority forms. Ambiguous configuration is rejected.

### Persistent profiles are an explicit authority increase

`--profile <directory>` opts into a dedicated persistent profile. Persistence
can retain cookies, browser storage, history, and authenticated sessions after
the process ends. The package refuses the home directory, AgentTool state
directories, the current Git worktree, the configured artifact root, and known
ordinary Chrome, Chromium, Edge, and Brave profile roots; this is a guardrail,
not proof that an arbitrary selected directory is empty or safe.

Ephemeral mode is the default and is the right choice for unrelated tasks,
untrusted browsing, CI, and tests. The tool never silently attaches to a
person's everyday browser profile.

On POSIX, an existing selected profile directory must already have no group or
other permission bits (normally mode `0700`), and the selected path must be a
real directory rather than a symbolic link. A broader existing directory is
refused without changing its mode; a missing final directory is created
owner-only. Windows does not use this POSIX mode check.

## Observation and action contract

`observe` returns a bounded, text-oriented accessibility view and
snapshot-scoped ARIA references. References are handles into the observed page
state, not durable CSS selectors or identity claims. A later navigation,
rerender, tab change, or DOM mutation can make a reference stale.

Version `0.3.0` keeps viewport-visible headings and the allowlisted landmark
and status roles as separately bounded structural context. These lines
preserve useful nesting but carry no actionable ref and cannot displace the
interactive ref budget.

`open` creates a new tab and returns its first observation. Every
reference-targeted action carries both `ref` and `snapshotId`. Read-only
observations retain a bounded recent snapshot history within the current frame
documents, so one observer does not immediately stale a peer's references.
Any frame navigation invalidates every retained snapshot for that tab. Once an
action reaches browser dispatch, success or failure also invalidates every
retained snapshot for that tab; validation and navigation-preflight rejection
do not. Observe again before selecting another referenced action.

`act` accepts one action at a time. A reference must resolve to one current,
eligible target. Missing, stale, ambiguous, hidden, disabled, or out-of-range
targets are errors; the core does not guess another element.

The action union is deliberately closed: navigate, click, type, press, select,
scroll, bounded wait, back, forward, reload, new tab, and close tab. There is
no generic command, script, or raw DevTools operation.

Every action is attempted once. The core does not automatically retry clicks,
submissions, keypresses, typing, or navigation. A timeout or transport failure
can leave the outcome unknown, especially when a remote side effect may
already have occurred. Re-observe the page before deciding whether a new
action is appropriate; do not treat an error as proof that nothing happened.

### Browser-act receipts

Prepared `0.5.0` gives each syntactically admitted `browser_act` attempt a
redacted `agent-browser-action-receipt/0.1` receipt. Direct `act` includes it in
the `ActionResult`; a known `BrowserError` carries it on failure. Invalid input
rejected before core admission has no receipt.

The receipt has an opaque attempt ID, session-local sequence, local session ID,
actual tab/page handles when known, launch authority, a redacted action/basis
summary, possible-effects classification, and exactly one status:

| `runtimeInvocation` | `localOutcome` | Interpretation | `retryAdvice` |
|---|---|---|---|
| `not_started` | `rejected` | No browser method was invoked. | `correct_or_reobserve` |
| `started` | `browser_completed` | The browser method returned locally. This is not remote-effect proof. | `do_not_automatically_retry` |
| `started` | `unknown` | Invocation began, but the local result is uncertain; effects may have happened. | `do_not_automatically_retry` |

Receipts deliberately omit typed, selected, and key values, page text, raw
errors, and URLs. They are not signatures, bearers, idempotency keys, durable
audit entries, authentication, consent, or evidence of a remote side effect.
If JSONL or MCP completes an act but its convenience observation then fails,
the completed result and receipt remain preserved and the adapter adds a
warning. It must not turn that observation failure into an invitation to
repeat the action.

Every `Observation` includes `attemptSequence` and `lastActionReceipt` as
bounded context from this browser instance. They help collaborating callers
notice local activity between observations, but they are not a global clock,
persistent journal, cross-process synchronizer, cross-device receipt, or
lease. An observation can become old immediately after it is returned.

### Non-ref observation basis

Prepared `0.5.0` lets selected actions without an element ref carry
`basisSnapshotId` in TypeScript and `basis_snapshot_id` over JSONL/MCP. The
eligible actions are `navigate`, non-ref `press` and `scroll`, `wait`, `back`,
`forward`, `reload`, and `close_tab`. Ref-targeted actions retain their
required ref snapshot contract; `new_tab` has no existing-tab basis.

The core first resolves the requested tab, then requires that snapshot to be
retained for the same tab/page and current navigation epoch. It checks before
policy preflight and re-checks the same retained snapshot object immediately
before invoking the browser runtime. A wrong tab, eviction, intervening
navigation, or earlier dispatched action therefore rejects the attempt before
the requested browser method starts.

This is a session-local optimistic precondition, not equality of the DOM,
focus, network, or remote application state. It does not reserve a page,
authenticate an account, establish consent, create a transaction, or become a
cross-process or cross-device lease.

Direct `act` returns its `ActionResult`. JSONL and MCP attempt that same one
action, then perform one read-only observation for convenience. If the action
succeeds and that follow-up observation fails, the adapters preserve the
successful action result and warn against repeating it.

`extract` is bounded structured reading, not arbitrary page execution.
`screenshot` writes a canonical artifact beneath the configured output
directory. JSONL and the CLI-started MCP server return artifact metadata rather
than PNG bytes, and their screenshot operation is viewport-only. Trusted direct
TypeScript callers may opt into a full-page capture. `tabs` exposes the small
amount of tab state needed to choose or close a page.

The character and element limits bound returned results; they do not stop
Chrome and Playwright from first materializing a remote page's accessibility
snapshot, text, or markup. An extreme DOM can still consume substantial local
memory. This local runtime has no browser-process memory quota and is not a
resource-isolation boundary.

### Main-document response hints

Every observation carries `response`, either `null` or a bounded projection of
the current main-document response:

```json
{
  "source": "main_document",
  "url": "https://example.com/",
  "status": 200,
  "mediaType": "text/html",
  "headers": {
    "link": "<https://example.com/.well-known/agent.txt>; rel=\"alternate\""
  },
  "truncated": false,
  "trust": "untrusted"
}
```

The header allowlist is exactly `link`, `content-location`,
`x-agent-surface`, `substrate-disposition`, `x-substrate-disposition`,
`x-kingdom`, `x-token-cost`, `x-byte-count`, and `x-joy-index`. Output names
are lowercase. Media type, names, and values share a 4 KiB character budget;
query values and control characters are redacted. Subresource responses,
cookies, authentication, authorization challenges, and arbitrary headers do
not cross the observation boundary. The response URL is query-redacted and the
block is returned only when it still identifies the observed main document
(ignoring a fragment); navigation races fail closed to `null`.

This block is untrusted publisher metadata. A link can advertise discovery but
cannot authorize a navigation, install, credential use, payment, protocol
invocation, or relationship.

### Blocked-navigation diagnostics

Prepared `0.5.0` observations carry forward the unreleased `0.4.0`
`blockedNavigation` field. It is either `null` or a record
(`source: "navigation_policy"`, query-redacted bounded `url`, policy `code`,
`message`) of the tab's most recent main-frame navigation that this process
itself denied and that no allowed main-frame navigation has since superseded.
It exists to distinguish a self-inflicted policy block behind a browser error
page from a broken site — the case where no action is pending and only an
observation can carry the diagnostic. The code and message are
policy-generated local diagnostics; the destination URL is page-derived and
untrusted. Only the tab-attributed denial is projected: session-ambiguous
denials stay an action-outcome concern, and subframe or subresource denials
never appear. It reports only what the route layer itself refused; a
navigation that fails for any other reason — including a Chromium-managed
redirect hop, which the route never re-checks — leaves it `null`. The record
never authorizes retrying, widening network authority, or reaching the blocked
destination another way. Action-window denial semantics are unchanged; the
underlying denial state is projected read-only.

Artifact directories use the same ownership rule: a missing directory is
created owner-only, while an existing POSIX directory with group/other
permission bits or a selected path that is itself a symbolic link is refused
without chmod. Ancestor aliases are canonicalized before protected-root
checks. New PNG artifacts are set to mode `0600` on POSIX.

## Page content remains untrusted

Text, labels, accessible names, attributes, links, and instructions observed
from a page are publisher-controlled input. A sentence that asks the agent to
change policy, reveal a secret, run a command, ignore a user, or widen network
access has no more authority than any other page text. The browser reports it;
it does not make it trusted.

The package has no arbitrary JavaScript evaluation, file-upload operation,
credential-ingestion API, ambient secret lookup, shell execution, extension
installation, or automatic import of a normal browser profile. These absences
reduce the reachable surface; they do not make websites benign.

### Redaction is bounded, not magical

Structured results redact values from recognized sensitive controls plus query
values in structured URLs, URLs detected in text, and common HTML URL
attributes before returning them. Sensitive-control recognition covers
password types, password/one-time-code autocomplete, and a fixed set of
metadata hints such as token, API key, PIN, and CVV. That does not identify or
remove every secret. In particular, a generic redactor cannot reliably catch:

- secrets in ordinary controls without those hints, or copied into page text;
- transformed, encoded, split, truncated, or inferred values;
- values placed in URL paths, fragments, headers, browser storage, or page
  application state;
- query values carried by unrecognized forms such as `srcset`, meta refresh,
  CSS `url()`, or malformed markup;
- secrets drawn into canvas, images, video, or screenshot pixels; or
- information already sent to a remote page.

Do not put credentials in tool arguments or model-visible state. Use a
separate, trusted credential boundary when authenticated browsing is required,
and treat persistent-profile artifacts as sensitive owner-held data.

## Network boundary

In published `0.1.0`, public web is allowed by default; loopback, link-local,
and private HTTP(S) navigation/request destinations require the process-level
`--local-network` opt-in. Reserved destinations remain blocked even with that
opt-in. The prepared `0.5.0` `public` and `local` profiles preserve those
respective destination rules from `0.2.0`.

The native policy performs hostname and address checks before navigation, but
Playwright controls the later browser connection. This implementation cannot
pin the checked DNS answer to the socket used by the browser or verify the
connected peer address. DNS can change between the check and connection, and
ambient proxy or browser behavior can affect routing. Therefore this package
does **not** claim strong SSRF isolation and must not be exposed as a hosted
arbitrary-target browser. A hosted design would need connection-pinned egress,
tenant isolation, quotas, abuse controls, and a separate security review.

Playwright-managed HTTP redirects do not re-enter the package's request route.
AgentTool rejects embedded URL credentials only when a URL crosses its policy
check boundary: direct inputs and routed requests. A Chromium-managed
`Location` hop is not independently rechecked and may change destination class
or contain userinfo before the package can observe the committed page. Do not
treat the local authority profiles as credential-disclosure or SSRF isolation.

The public-web check is also not a claim that a public site is trustworthy,
safe to transact with, or authorized to receive data.

The public/local check is an HTTP(S) browser-request boundary, not generic
process egress isolation. `public` separately blocks every WebSocket
connection. `local` classifies WebSocket destinations against its
public-plus-local boundary rather than pretending the HTTP(S) DNS claim
extends to WebSocket transport.

The prepared `0.5.0` `sovereign` profile retains the explicit alternative
introduced in `0.2.0`: it intentionally performs no destination-class blocking
for valid HTTP(S), passes WebSockets through, and enables service workers.
Embedded userinfo is blocked on direct inputs and routed requests, not on
unseen Chromium-managed redirect hops. That makes exploration possible
wherever the surrounding system permits it while leaving consequential
choices visible. It is not a security label, an authorization grant for
external accounts, or a guarantee that any destination is reachable.

## Backend-neutral core, concrete adapter

The public and model-facing contracts use AgentTool-owned tab, page, snapshot,
ref, and receipt handles. Playwright is the concrete browser adapter today.
Keeping driver objects behind the core makes WebDriver BiDi a possible later
adapter where its behavior can satisfy the same bounded contract. Raw CDP
sessions, object IDs, commands, and Chromium-only events are not a public API
or portability commitment.

MCP remains an interface envelope over that core, not the browser driver.
Likewise, WebMCP may become a useful progressive layer for discovering
page-declared tools, but those declarations are untrusted page content. A
future projection must not silently register or execute them, treat their
descriptions as authority, inject credentials, or widen the launch-time
policy. Rendering and page-declared affordances remain below caller-owned
planning and consent.

## Local package and hosted `/v1/browse` are separate

| Surface | Runtime and authority | Operational boundary |
|---|---|---|
| Prepared local `0.5.0` source (unreleased; public latest is `0.3.0`) | Operator-owned local TypeScript, JSONL, or stdio MCP process using an installed local Chrome-family browser | No AgentTool bearer, credits, Redis, or hosted worker. Local actions are attempted once. Profiles, artifacts, and destination authority remain on the operator's machine. |
| `POST /v1/browse` | Separate AgentTool API route and BullMQ worker implementation | Bearer- and credit-scoped, disabled without the unsafe-outbound flag, dependent on Redis workers, server-readable, Chromium `--no-sandbox`, and currently unfiltered by destination. BullMQ may attempt a job twice. |

The npm, LOVE, GitHub, and docs release of the local package neither enables
nor hardens the hosted route. Conversely, availability of the hosted route
does not install the package or grant a local MCP host browser access.

## Integration: discover first, render when needed

The strongest composition is caller-owned and layered:

1. use `@agenttool/telescope` to inspect bounded machine-readable discovery
   surfaces such as `agent.txt`, Pathways, LOVE, A2A, and MCP advertisements;
2. prefer a useful structured surface when one exists; and
3. use Browser as the rendered-page fallback when the task genuinely needs UI
   or client-side interaction.

Telescope does not launch Browser, and Browser does not automatically follow
discovery headers. Neither discovery nor observation installs a package,
connects to MCP, sends credentials, pays, widens network scope, or changes the
caller's policy.

Real Recognise Real also stays above the browser core. Seeing `X-Kingdom`,
opening a page, or observing compatible protocol language is not bilateral
recognition. Browser never signs, begins, or escalates `/v1/real` or the formal
`/v1/guild/rrr` cascade. A participating agent must choose and authorize that
separate signed action.

`細聲講 大聲笑` is presentation layering rather than a hidden wire protocol:
TypeScript stays typed, JSONL stays one object per line, MCP stays structured,
and diagnostics stay off protocol stdout. Human docs and demos may opt into a
louder playful register, but the facts, failures, permissions, and tool results
remain identical.

## Configuration

CLI flags and their environment equivalents configure the same process
boundary:

| Purpose | CLI | Environment |
|---|---|---|
| Authority profile | `--authority public|local|sovereign` | `AGENTOOL_BROWSER_AUTHORITY` |
| Headless or visible | `--headless` / `--headed` | `AGENTOOL_BROWSER_HEADLESS` |
| Public web (deprecated compatibility) | `--public-web` / `--no-public-web` | `AGENTOOL_BROWSER_PUBLIC_WEB` |
| Local/private network (deprecated compatibility) | `--local-network` / `--no-local-network` | `AGENTOOL_BROWSER_LOCAL_NETWORK` |
| Ephemeral profile | `--ephemeral` | `AGENTOOL_BROWSER_PROFILE=ephemeral` |
| Dedicated persistent profile | `--profile <directory>` | `AGENTOOL_BROWSER_PROFILE=persistent` plus `AGENTOOL_BROWSER_PROFILE_DIR` |
| Installed browser channel | `--channel <name>` | `AGENTOOL_BROWSER_CHANNEL` |
| Exact browser executable | `--executable <path>` | `AGENTOOL_BROWSER_EXECUTABLE` |
| Artifact directory | `--output-dir <path>` | `AGENTOOL_BROWSER_OUTPUT_DIR` |

Boolean environment values accept `1/0`, `true/false`, `yes/no`, or `on/off`.
Paths are resolved at process start. Tool calls do not accept these settings.
Prepared `0.5.0` rejects mixed `authority` and legacy public/local
configuration.

## MCP host configuration

Install the exact package in a stable project or tools directory, then give the
host an **absolute path** to that installation's binary. This avoids depending
on the host's working directory or a mutable global `PATH`, and avoids making
package-manager network access part of every MCP process start.

Check the selected launch profile before adding it to a host:

```bash
./node_modules/.bin/agenttool-browser doctor --authority sovereign
```

A JSON-style MCP host configuration for broad destination pass-through is:

```json
{
  "mcpServers": {
    "agenttool-browser": {
      "command": "/absolute/path/to/project/node_modules/.bin/agenttool-browser",
      "args": ["mcp", "--authority", "sovereign"]
    }
  }
}
```

For the public-only compatibility boundary, keep the same absolute binary and
use:

```json
{
  "command": "/absolute/path/to/project/node_modules/.bin/agenttool-browser",
  "args": ["mcp", "--authority", "public"]
}
```

Call `browser_capabilities` after startup to confirm the effective profile and
implemented powers. That report does not probe DNS, visit a page, or prove that
a destination is reachable. Prefer the default ephemeral profile for
concurrent hosts. If persistence is required, give each simultaneously running
browser process its own dedicated `--profile` directory rather than sharing a
Chromium profile lock and durable site state.

## Install the exact public release

These commands install immutable public latest `0.3.0`. Prepared `0.4.0` and
`0.5.0` source have not been distributed; use a reviewed source checkout to
exercise those contracts before release. Historical `0.1.0` and `0.2.0`
artifacts remain separately addressable through their immutable manifests.

```bash
npm install --save-exact @agenttool/browser@0.3.0
```

Or use the registry-neutral LOVE locator:

```bash
npm install --save-exact \
  https://docs.agenttool.dev/packages/v1/@agenttool/browser/0.3.0/agenttool-browser-0.3.0.tgz
```

The exact manifest at
`https://docs.agenttool.dev/packages/v1/@agenttool/browser/0.3.0/manifest.json`
provides the artifact size and SHA-256. Verify both before installing when the
catalog-to-local-file boundary matters.

## Local development and verification

```bash
cd packages/browser
bun install --frozen-lockfile
bun run ci
node dist/bin/agenttool-browser.js doctor
```

The hermetic gate typechecks, runs fake/fixture tests, builds the package,
imports it under Node and Bun without launching a browser, and checks the
package boundary. It does not install, download, or launch a real browser.
`doctor` reports local configuration and browser availability; it does not
turn that diagnostic into a CI browser requirement.

An operator can then start one of the local protocol doors:

```bash
node dist/bin/agenttool-browser.js jsonl
node dist/bin/agenttool-browser.js mcp
```

Use `node dist/bin/agenttool-browser.js help` for the current command and flag
summary.

## Deliberately not implied

The public package, LOVE manifest, GitHub Release, and docs page prove only the
named distribution records and bytes. They do not create a hosted endpoint,
browser farm, account plan, credit meter, remote integration, recognized
relationship, or strong SSRF sandbox. Any hosted browser-control design would
be a separate security architecture and deployment action.

## See Also

- [Package README](../packages/browser/README.md)
- [Telescope network boundary](../packages/telescope/README.md#network-boundary)
- [Development](DEVELOPMENT.md)
- [Doctrine map](MAP.md)
- [Current work](NOW.md)

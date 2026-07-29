# `@agenttool/browser`

A small local browser surface for agents.

This README describes prepared `0.5.0` source. It is not yet distributed.
`0.3.0` remains the immutable public latest through exact LOVE, npm, and GitHub
Release artifacts. The docs deployment distributes bytes and documentation,
not a hosted browser-control service.

The unreleased `0.4.0` boundary added standing-policy diagnostics and clearer
JSONL field-rename errors. Prepared `0.5.0` carries that work forward and adds
redacted `browser_act` receipts, non-ref observation-basis preconditions,
session-local receipt context in observations, a backend-neutral capability
inventory, and current MCP negotiation with an explicit compatibility path.
Neither `0.4.0` nor `0.5.0` is available from the public install commands
below.

```bash
npm install --save-exact @agenttool/browser@0.3.0
```

Registry-neutral exact artifact:

```bash
npm install --save-exact \
  https://docs.agenttool.dev/packages/v1/@agenttool/browser/0.3.0/agenttool-browser-0.3.0.tgz
```

The sibling
[LOVE manifest](https://docs.agenttool.dev/packages/v1/@agenttool/browser/0.3.0/manifest.json)
names the artifact size and SHA-256. A URL install does not compare those
values automatically; verify them first when that boundary matters.

## What it is

One browser core is available through three local interfaces:

- direct TypeScript with `AgentBrowser`;
- one-request/one-response line-delimited JSON over stdin/stdout; and
- a stdio MCP server.

The core exposes the essential loop: inspect `capabilities`, create a
zero-effect `plan`, then `open`, `observe`, `act`, `extract`, `screenshot`,
inspect `tabs`, and `close`. `observe` produces a bounded semantic view with
snapshot-scoped ARIA references, so actions target observed accessible elements
rather than invented selectors. The same snapshot retains a separately bounded,
viewport-visible context of headings and the `main`, `navigation`, `form`,
`region`, `dialog`, `alert`, and `status` roles. Context lines keep their
relative indentation but carry no ref, never enter the actionable `refs` array,
and use only character space left after interactive refs have been selected.

This package uses `playwright-core` with a Chrome-family browser already
installed on the machine. It has no postinstall script and does not download a
browser during install, build, tests, or CI.

It requires no AgentTool account, API key, credits, Redis, database, or remote
control plane.

## Try the package

The runtime supports Node 20.19+ and Bun 1.3.5+. The full source gate uses both
to verify that claim. Real local browsing additionally needs an installed
Chrome-family browser.

```bash
agenttool-browser doctor
```

If launch fails, `doctor` keeps the launch error generic and writes an
actionable hint to stderr. The hint names the configured channel, or only the
configured executable's file name with its parent path omitted, then points to
`--channel`, `--executable`, or installing a compatible Chrome-family browser.
It never discovers or downloads a browser.

Start the minimal JSONL process:

```bash
agenttool-browser jsonl
```

It speaks `agenttool-browser-jsonl/0.1`, one object per line:

```json
{"version":"agenttool-browser-jsonl/0.1","id":"open-1","method":"browser_open","params":{"url":"https://example.com"}}
```

Or start the local MCP server:

```bash
agenttool-browser mcp
```

For a persistent MCP host, install the package in that host's project and use
the absolute project-local binary path rather than an `npx` command that may
fetch at startup:

```json
{
  "command": "/absolute/path/to/project/node_modules/.bin/agenttool-browser",
  "args": ["mcp", "--authority", "sovereign"]
}
```

Run the same binary with `doctor --authority sovereign` first. After startup,
call `browser_capabilities` to verify the effective profile; that report does
not probe whether a destination is reachable. Ephemeral profiles need no
shared state. Give concurrent persistent hosts separate dedicated profile
directories.

Both keep protocol traffic on stdout and operational diagnostics on stderr.
Use `agenttool-browser help` for the current command and options.

The JSONL methods and MCP tool names are `browser_capabilities`,
`browser_plan`, `browser_open`, `browser_observe`, `browser_act`,
`browser_extract`, `browser_screenshot`, `browser_tabs`, and `browser_close`.

Prepared `0.5.0` negotiates the current MCP `2026-07-28` revision and retains
an explicit 2025-era stdio compatibility path. That negotiation makes the
same bounded operations usable by hosts from both eras; it does not turn MCP
into a browser driver, durable browser session, or security boundary. Browser
handles and authority remain local to this process.

### Capabilities and planning

The direct API aligns `capabilities()` with `browser_capabilities`, and
`plan(action)` with `browser_plan`. `browser_capabilities` reports effective
launch-time authority and implemented operations; it does not visit or probe a
destination. `browser_plan` accepts `{ "action": ... }` only. It produces an
advisory, redacted classification for one existing `BrowserAction` without
executing, approving, authorizing, or simulating it.

Planning a typed action never echoes its `text` or selected values. URL query
values are redacted. A URL-opening intention can be represented by a
`new_tab` or `navigate` action:

```ts
const capabilities = browser.capabilities();
const plan = browser.plan({
  kind: "navigate",
  url: "https://example.com/search?q=private",
});
```

Planning has zero browser effect: it does not inspect the live page, resolve a
reference, make a network request, or reserve a later action. Its output is not
permission, an approval token, a side-effect guarantee, or evidence that a
click will do what its label suggests.

Both agent-facing transports intentionally narrow extraction to the whole page
or an observed `ref` plus its `snapshot_id`; they do not accept a free-form
selector. Trusted direct TypeScript code retains a bounded selector extraction
escape hatch. JSONL and the CLI-started MCP server return screenshot artifact
metadata rather than placing PNG bytes on stdout, and their captures are
viewport-only. Trusted direct TypeScript callers may opt into a full-page
capture.

## Direct TypeScript

```ts
import { AgentBrowser } from "@agenttool/browser";

const browser = await AgentBrowser.launch();

try {
  const page = await browser.open("https://example.com");
  console.log(page.snapshot, page.refs);
} finally {
  await browser.close();
}
```

The same instance provides `act`, `extract`, `screenshot`, and `tabs`.
`open` creates a new tab and returns its first `Observation`; `observe` reads
the active or selected tab again. Every reference-targeted action carries both
the observed `ref` and its `snapshotId`. Read-only observations retain a
bounded recent snapshot history within the current frame documents, so one
observer does not immediately stale a peer's references. Any frame navigation
invalidates every retained snapshot for that tab. Once an action reaches
browser dispatch, it also invalidates every retained snapshot for that tab
whether it succeeds or fails; validation and navigation-preflight rejections
do not dispatch an action. Observe again before choosing another referenced
action.
Each `act` call contains exactly one action and is attempted once. The package
does not automatically retry uncertain clicks, submissions, typing, keypresses,
or navigation. The closed action set covers navigate, click, type, press,
select, scroll, bounded wait, back, forward, reload, new tab, and close tab;
there is no raw script or DevTools action.

### Action receipts and observation basis

Prepared `0.5.0` gives each syntactically admitted `browser_act` attempt a
redacted `agent-browser-action-receipt/0.1` receipt. Direct `act` returns it in
the `ActionResult`; a known `BrowserError` carries it on failure. Malformed
input rejected before core admission has no receipt.

The receipt records an opaque attempt ID, a session-local sequence, the local
session and actual tab/page handles when known, authority, a redacted
action/basis summary, and one of three status shapes:

| Runtime invocation | Local outcome | Meaning and retry advice |
|---|---|---|
| `not_started` | `rejected` | The browser method was not invoked. Correct the request or re-observe before making a new decision. |
| `started` | `browser_completed` | The browser method returned locally. Do not repeat it automatically. |
| `started` | `unknown` | Invocation began, but the local result is uncertain. Effects may have happened; do not repeat it automatically. |

A completed receipt is not proof of a remote effect or the page's intended
meaning. A receipt is also not consent, authentication, a signature, a bearer,
an idempotency key, or cross-device evidence. It deliberately omits typed,
selected, and key values, page text, raw errors, and URLs. If JSONL or MCP
cannot produce the convenience observation after a completed act, they retain
the completed receipt and return a warning rather than inviting a replay.

An `Observation` also carries `attemptSequence` and `lastActionReceipt` as
bounded local context. They describe this in-memory browser instance only.
They are not a durable audit journal, global clock, synchronization protocol,
or proof that another process or device has observed the same action.

For actions without a ref, prepared `0.5.0` can carry the observation's
`basisSnapshotId` (`basis_snapshot_id` on JSONL/MCP). It is available for
`navigate`, non-ref `press` and `scroll`, `wait`, `back`, `forward`, `reload`,
and `close_tab`; ref-targeted actions keep their required ref snapshot, and
`new_tab` has no existing-tab basis. The core resolves the requested tab,
checks that the same retained snapshot is still current before preflight, and
checks that same object again immediately before browser invocation.

This is a session-local optimistic precondition. It can catch the wrong tab,
eviction, a prior action, or navigation in this browser instance. It does not
assert DOM or focus equality, reserve the page, authenticate an account,
establish consent, create a transaction, or act as a cross-process or
cross-device lease.

Before constructing an observation, Browser makes a bounded, best-effort check
that the top-level window viewport has stopped moving. It samples browser
geometry against a one-second monotonic deadline and gives each geometry
request only the remaining budget. The loop stops scheduling probes after
that deadline; host or runtime scheduling can still delay its return beyond
one wall-clock second. This reduces refs issued during queued wheel or smooth
scrolling, but does not promise that the DOM, network, animation, or a nested
scroller is stable. A failed geometry probe does not turn an already completed
action into a reported action failure. Before a ref-targeted action is
dispatched, its element must still intersect the current viewport or the ref
is rejected as stale. Read-only ref extraction remains available for a
retained element that is still present and visible even if it has moved
outside the window viewport.
If the request boundary denies a main-frame request attributed to the action's
tab before its Playwright promise settles, the action returns that policy error
rather than a clean success even if Chromium displays its internal error page.
The same conservative result applies when an immediate popup denial arrives
before Playwright exposes a frame or registered tab, but it is reported as
`action_failed` with session-wide attribution uncertainty rather than falsely
claiming that the current action created that request. A denial attributed to
another registered tab, or to a known subframe, is enforced on the request but
is not reported as the current action's result. Browser does not wait for
open-ended network quiescence: scripted navigation scheduled to begin after
the action promise settles is later page behavior and cannot retroactively
revise the completed result. This detection does not retry the action or undo
effects that happened before the denial.

Snapshot and extraction limits bound returned results, not the size of the
remote DOM that Chrome and Playwright must first process. An extremely large
page can still consume substantial browser/host memory; this local runtime is
not a resource-quota sandbox.

### Main-response discovery hints

Every `Observation` includes `response`, either `null` or a bounded record for
the current main document:

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

Only nine lowercase discovery/disposition names can cross this boundary:
`link`, `content-location`, `x-agent-surface`, `substrate-disposition`,
`x-substrate-disposition`, `x-kingdom`, `x-token-cost`, `x-byte-count`, and
`x-joy-index`. Media type plus those names and values share a 4 KiB character
budget. Query values and control characters are redacted. Cookies,
authentication, authorization challenges, and arbitrary response headers are
never exposed. The response URL is query-redacted and the block is returned
only when that URL still matches the observed main document (ignoring its
fragment); navigation races fail closed to `null`.

These are publisher-controlled hints, not identity, proof, recognition,
permission, billing approval, or an instruction to follow a link.

### Blocked-navigation diagnostics

Every `Observation` also includes `blockedNavigation`, either `null` or a
record of this tab's most recent main-frame navigation that this process
itself denied and that no allowed main-frame navigation has since superseded:

```json
{
  "source": "navigation_policy",
  "url": "http://10.0.0.9/internal",
  "code": "network_blocked",
  "message": "Browser request was denied by the launch-time network policy."
}
```

Without it, a page-initiated navigation into a denied destination is
indistinguishable from an outage: the agent sees only a browser error page.
The code and message are policy-generated local diagnostics; the destination
URL is page-derived, query-redacted, bounded, and untrusted. Only the
tab-attributed denial is surfaced, subframe and subresource denials never
appear, and the record reports what the route layer itself refused — a
navigation that fails for any other reason (including a redirect hop, which
the route layer never re-checks) leaves it `null`. It never authorizes
retrying, widening network authority, or reaching the destination another
way.

## Portability direction

The public and model-facing contract uses AgentTool-owned tab, page, snapshot,
ref, and receipt handles. Playwright is the implementation adapter today;
those handles leave room for a WebDriver BiDi adapter when its behavior can
meet the same bounded contract. Raw CDP sessions, object IDs, and commands are
not part of the public API or a portability promise.

WebMCP is a possible future layer, not a shortcut around this core. A page may
eventually declare tools that are useful to discover, but those declarations
remain untrusted page content. Discovery must not silently register or execute
a page tool, treat its description as authority, supply credentials, or widen
the launch-time browser policy.

## Best integration seam

Use [`@agenttool/telescope`](../telescope/README.md) first when an origin may
already expose `agent.txt`, Pathways, LOVE, A2A, or MCP metadata. Prefer a
useful structured surface; fall back to Browser only when the task genuinely
needs the rendered page or client-side interaction. This composition stays in
caller-owned orchestration—neither package silently invokes the other.

Real Recognise Real remains a later explicit act. Opening or observing a page,
including one that emits `X-Kingdom`, never starts `/v1/real` or
`/v1/guild/rrr`, signs on the agent's behalf, or certifies a relationship.

`細聲講 大聲笑` is a presentation rule, not hidden protocol state: JSONL/MCP
stdout stays quiet and deterministic; playful human docs or demos are opt-in
and cannot alter the same underlying facts or widen authority.

## Authority profiles

Version `0.2.0` introduced the three named launch-time profiles retained by
prepared `0.5.0` source:

| Profile | Policy-checked HTTP(S) requests | WebSockets | Service workers |
|---|---|---|---|
| `public` (default) | Public only | Blocked | Blocked |
| `local` | Public plus local/private; reserved denied | Classified by the same boundary | Blocked |
| `sovereign` | Broad pass-through, including local/private/reserved; embedded userinfo rejected at the policy check | Passed through | Enabled |

Sovereign means AgentTool does not apply destination-class blocking to valid
policy-checked HTTP(S) requests or WebSockets; embedded userinfo is rejected
when a URL crosses that policy boundary. Chromium-managed `Location` hops do
not cross it again. The browser, operating system, DNS/proxy configuration,
network, and destination still determine what is reachable. Sovereign does
not bypass authentication, CAPTCHAs, account permissions, site policy,
browser support, or host controls.

No authority profile promises universal site access. A site may refuse,
challenge, throttle, or render incompatibly; the runtime should make the
observed boundary legible, not recast every refusal as a restriction to bypass.

This profile deliberately allows a page and its service worker to reach
destinations available to the host, including local services. In a persistent
profile, service-worker and site state can outlive the process. Sovereign is
therefore broad local process authority, not an isolation or SSRF claim.

Destination authority does not imply every other browser power. In prepared
`0.5.0` source, file upload, automatic download, arbitrary JavaScript
evaluation, credential injection/lookup, ambient profile import, shell
execution, and extension installation remain unsupported and are reported as
such by `capabilities()`.

Select authority at launch:

```ts
const browser = await AgentBrowser.launch({ authority: "sovereign" });
```

```bash
agenttool-browser jsonl --authority sovereign
```

or set `AGENTOOL_BROWSER_AUTHORITY=sovereign`. Authority cannot be widened by
a tool call after launch.

### Compatibility defaults

The default process is:

- headless;
- allowed to visit the public web;
- denied local and private HTTP(S) navigation/request destinations;
- attached to a dedicated ephemeral context rather than a normal browser
  profile;
- configured for the installed `chrome` channel; and
- configured to write artifacts beneath
  `$XDG_DATA_HOME/agenttool/browser/artifacts`, or
  `~/.local/share/agenttool/browser/artifacts`.

Select another installed channel with `--channel`, or an exact executable with
`--executable`. Neither downloads browser bytes.

Persistent state is opt-in:

```bash
agenttool-browser jsonl \
  --profile "$HOME/.local/share/agenttool/browser/profiles/work"
```

The directory must be dedicated and outside the current Git worktree. Known
ordinary Chrome-family profile roots, the home directory, the current
worktree, AgentTool state, and configured artifact roots are refused.
Persistence can retain cookies, storage, history, and logged-in sessions;
protect and scope the directory accordingly.

On POSIX, an existing profile directory must already have no group or other
permission bits (normally mode `0700`); a directory with broader permissions
or a selected path that is itself a symbolic link is refused without changing
it. Ancestor aliases are canonicalized before protected-root checks. A missing
final directory is created owner-only. Windows does not use this POSIX mode
check.

Local/private HTTP(S) destinations are also a process-level opt-in:

```bash
node dist/bin/agenttool-browser.js jsonl --local-network
```

Do this only for a caller-controlled development network. Tool calls cannot
widen either profile or network authority after launch. Reserved destinations
remain blocked even with this opt-in.

Prepared `0.5.0` retains `allowPublicWeb` / `allowLocalNetwork`,
`--public-web` / `--local-network`, and their environment variables as a
deprecated `0.1.0` compatibility surface. Do not combine the `authority` form
with any legacy authority option in one launch; mixed configuration is
rejected rather than guessed.

## Configuration

| Purpose | CLI | Environment |
|---|---|---|
| Authority profile | `--authority public|local|sovereign` | `AGENTOOL_BROWSER_AUTHORITY` |
| Headless or visible | `--headless` / `--headed` | `AGENTOOL_BROWSER_HEADLESS` |
| Public web (deprecated compatibility) | `--public-web` / `--no-public-web` | `AGENTOOL_BROWSER_PUBLIC_WEB` |
| Local/private network (deprecated compatibility) | `--local-network` / `--no-local-network` | `AGENTOOL_BROWSER_LOCAL_NETWORK` |
| Ephemeral profile | `--ephemeral` | `AGENTOOL_BROWSER_PROFILE=ephemeral` |
| Persistent profile | `--profile <directory>` | `AGENTOOL_BROWSER_PROFILE=persistent` and `AGENTOOL_BROWSER_PROFILE_DIR` |
| Installed channel | `--channel <name>` | `AGENTOOL_BROWSER_CHANNEL` |
| Exact executable | `--executable <path>` | `AGENTOOL_BROWSER_EXECUTABLE` |
| Artifact directory | `--output-dir <path>` | `AGENTOOL_BROWSER_OUTPUT_DIR` |

Environment booleans accept `1/0`, `true/false`, `yes/no`, or `on/off`.
Unknown flags, malformed values, and mixed named/legacy authority
configuration fail rather than silently broadening policy.

The artifact directory follows the same existing-directory rule. A missing
directory is created owner-only; on POSIX, an existing directory with any
group/other permission bits or a selected path that is itself a symbolic link
is refused without chmod. Ancestor aliases are canonicalized before
protected-root checks. New screenshot files are set to mode `0600` on POSIX.

## Trust and redaction boundary

Page text, links, labels, attributes, and instructions are untrusted remote
content. Browser output does not grant a page authority to change policy,
request secrets, run host commands, or override the caller.

Structured outputs redact values from recognized sensitive controls plus query
values in structured URLs, URLs detected in text, and common HTML URL
attributes. Sensitive-control recognition covers password types,
password/one-time-code autocomplete, and a fixed set of metadata hints such as
token, API key, PIN, and CVV. That boundary is intentionally narrow. It cannot
reliably detect values in ordinary controls without those hints, values copied
into page text, transformed or split secrets, URL path or fragment data,
unrecognized carriers such as `srcset`, meta refresh, CSS `url()`, or malformed
markup, browser storage, canvas/image content, or screenshot pixels. It cannot
undo data already submitted to a site.

Prepared `0.5.0` source intentionally has no:

- arbitrary JavaScript evaluation;
- file-upload operation;
- credential-ingestion or secret-lookup API;
- shell or subprocess tool;
- browser-extension installation; or
- automatic import of a person's normal browser profile.

Use a separate caller-controlled credential boundary if authenticated
browsing is required. Do not place secrets in JSONL, MCP arguments,
model-visible state, or advisory plans.

## Network limitation

The prepared `0.5.0` `public` and `local` profiles preserve the `0.2.0` and
historical `0.1.0` destination checks before navigation, including DNS
answers.
Playwright then owns the browser connection. The package cannot pin the
checked DNS answer to the later socket or verify the connected peer address,
and ambient proxies or browser routing can change the path.
Playwright-managed HTTP redirect hops do not re-enter the request route used
by this package, so `public` and `local` cannot independently classify each
`Location` target before Chromium follows it. A `route.fetch` with automatic
redirects disabled still hands a fulfilled redirect back to Chromium without
causing the next hop to re-enter that route, and it would also replace normal
browser response handling with a buffered API fetch.

AgentTool rejects embedded URL credentials only when a URL crosses its policy
check boundary: direct inputs and routed requests. Chromium-managed
`Location` hops are not independently rechecked; they may change destination
class or contain userinfo before the package can observe the committed page.
Do not treat this as credential-disclosure or SSRF isolation, and do not
expose it unchanged as a hosted arbitrary-target browser. `local` is an
explicit widening of local process authority, not a sandbox.

The public/local check is an HTTP(S) browser-request boundary, not generic
process egress isolation. `public` blocks WebSockets; `local` classifies them
against its public-plus-local destination boundary rather than extending the
HTTP(S) DNS claim to WebSocket transport. The `sovereign` profile intentionally
removes that destination-class boundary, passes WebSockets
through, and enables service workers. Its capability report makes that
authority legible; it does not make the resulting traffic isolated, harmless,
or guaranteed to succeed.

## Development

```bash
bun run typecheck
bun test tests
bun run build
npm pack --dry-run --ignore-scripts
```

The package boundary contains compiled `dist` files plus this README,
`CLAUDE.md`, `LICENSE`, and `NOTICE`. No lifecycle hook downloads or installs a
browser.

Apache-2.0. See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), and the fuller
[Agent Browser boundary](../../docs/AGENT-BROWSER.md).

# Agent Browser

> **Compass:** [SOUL](SOUL.md) (why) · [AGENT DATA](AGENT-DATA-PROTOCOL.md) (local-first precedent) · [TELESCOPE](../packages/telescope/README.md) (public-network boundary) · [MAP](MAP.md) (doctrine index) · [NOW](NOW.md) (current status)
>
> **Implements:** A local, agent-shaped browser control plane with direct TypeScript, line-delimited JSON, and stdio MCP interfaces over one bounded core.
>
> **Code:** [`packages/browser/src/`](../packages/browser/src/) · [`packages/browser/bin/agenttool-browser.ts`](../packages/browser/bin/agenttool-browser.ts)
>
> **Tests:** [`packages/browser/tests/`](../packages/browser/tests/)

## Status

`@agenttool/browser@0.1.0` is a local developer preview and repository source
truth only. It has not been published to npm, added to the LOVE package
catalog, deployed, or exposed as an AgentTool-hosted browser. The package
requires no AgentTool account, API key, credits, Redis, database, or hosted
control plane.

The preview uses `playwright-core` to drive a Chrome-family browser already
installed on the caller's machine. There is no postinstall hook and no bundled
browser download. This keeps browser selection and browser bytes under the
operator's control.

## Why this surface exists

Most browser automation APIs expose either a large test framework or a
pixel-and-selector problem. An agent needs a smaller loop:

1. open one destination;
2. observe a bounded semantic view;
3. act on one referenced accessible element;
4. extract a bounded result or capture an artifact;
5. inspect tabs or close the session.

The preview names that loop directly as `open`, `observe`, `act`, `extract`,
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

Each JSONL request is
`{ "version", "id", "method", "params" }`. A response repeats `version` and
`id`, then returns either `{ "ok": true, "result": ... }` or
`{ "ok": false, "error": { "code", "message" } }`. The framing is one JSON
object per line; protocol stdout contains no banners or diagnostic prose.

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

### Persistent profiles are an explicit authority increase

`--profile <directory>` opts into a dedicated persistent profile. Persistence
can retain cookies, browser storage, history, and authenticated sessions after
the process ends. The preview refuses the home directory, AgentTool state
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

`open` creates a new tab and returns its first observation. Every
reference-targeted action carries both `ref` and `snapshotId`; a successful
action invalidates that snapshot. Observe again before selecting another
referenced action.

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
memory. This preview has no browser-process memory quota and is not a
resource-isolation boundary.

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

The preview has no arbitrary JavaScript evaluation, file-upload operation,
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

Public web is allowed by default; loopback, link-local, and private HTTP(S)
navigation/request destinations require the process-level `--local-network`
opt-in. Reserved destinations remain blocked even with that opt-in.
Local-network access is broad local authority and should be reserved for a
caller-controlled development environment.

The native policy performs hostname and address checks before navigation, but
Playwright controls the later browser connection. This implementation cannot
pin the checked DNS answer to the socket used by the browser or verify the
connected peer address. DNS can change between the check and connection, and
ambient proxy or browser behavior can affect routing. Therefore this preview
does **not** claim strong SSRF isolation and must not be exposed as a hosted
arbitrary-target browser. A hosted design would need connection-pinned egress,
tenant isolation, quotas, abuse controls, and a separate security review.

The public-web check is also not a claim that a public site is trustworthy,
safe to transact with, or authorized to receive data.

This documented check is an HTTP(S) browser-request boundary, not generic
process egress isolation. No protection for another browser protocol or
process channel should be inferred unless this version names and tests it. V0
separately blocks every WebSocket connection rather than pretending the
HTTP(S) DNS policy applies to WebSocket transport.

## Configuration

CLI flags and their environment equivalents configure the same process
boundary:

| Purpose | CLI | Environment |
|---|---|---|
| Headless or visible | `--headless` / `--headed` | `AGENTOOL_BROWSER_HEADLESS` |
| Public web | `--public-web` / `--no-public-web` | `AGENTOOL_BROWSER_PUBLIC_WEB` |
| Local/private network | `--local-network` / `--no-local-network` | `AGENTOOL_BROWSER_LOCAL_NETWORK` |
| Ephemeral profile | `--ephemeral` | `AGENTOOL_BROWSER_PROFILE=ephemeral` |
| Dedicated persistent profile | `--profile <directory>` | `AGENTOOL_BROWSER_PROFILE=persistent` plus `AGENTOOL_BROWSER_PROFILE_DIR` |
| Installed browser channel | `--channel <name>` | `AGENTOOL_BROWSER_CHANNEL` |
| Exact browser executable | `--executable <path>` | `AGENTOOL_BROWSER_EXECUTABLE` |
| Artifact directory | `--output-dir <path>` | `AGENTOOL_BROWSER_OUTPUT_DIR` |

Boolean environment values accept `1/0`, `true/false`, `yes/no`, or `on/off`.
Paths are resolved at process start. Tool calls do not accept these settings.

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

The source package is Apache-2.0, but a source version and `publishConfig` do not
prove publication. There is currently no npm artifact, LOVE manifest, GitHub
Release, hosted endpoint, browser farm, account plan, credit meter, or deployed
AgentTool integration for this preview. Each of those would require a separate
reviewed release or deployment action.

## See Also

- [Package README](../packages/browser/README.md)
- [Telescope network boundary](../packages/telescope/README.md#network-boundary)
- [Development](DEVELOPMENT.md)
- [Doctrine map](MAP.md)
- [Current work](NOW.md)

# `@agenttool/browser`

A small local browser surface for agents.

`0.1.0` is a developer preview available from this repository's source only.
It has not been published to npm, added to the LOVE package catalog, deployed,
or exposed as a hosted AgentTool service.

## What it is

One browser core is available through three local interfaces:

- direct TypeScript with `AgentBrowser`;
- one-request/one-response line-delimited JSON over stdin/stdout; and
- a stdio MCP server.

The core exposes the essential loop: `open`, `observe`, `act`, `extract`,
`screenshot`, `tabs`, and `close`. `observe` produces a bounded semantic view
with snapshot-scoped ARIA references, so actions target observed accessible
elements rather than invented selectors.

This package uses `playwright-core` with a Chrome-family browser already
installed on the machine. It has no postinstall script and does not download a
browser during install, build, tests, or CI.

It requires no AgentTool account, API key, credits, Redis, database, or remote
control plane.

## Try the source

The runtime supports Node 20.19+ and Bun 1.3.5+. The full source gate uses both
to verify that claim. Real local browsing additionally needs an installed
Chrome-family browser.

```bash
cd packages/browser
bun install --frozen-lockfile
bun run ci
node dist/bin/agenttool-browser.js doctor
```

The CI command uses fakes and fixtures and performs import-only Node/Bun
smokes; it does not require or launch a real browser.

Start the minimal JSONL process:

```bash
node dist/bin/agenttool-browser.js jsonl
```

It speaks `agenttool-browser-jsonl/0.1`, one object per line:

```json
{"version":"agenttool-browser-jsonl/0.1","id":"open-1","method":"browser_open","params":{"url":"https://example.com"}}
```

Or start the local MCP server:

```bash
node dist/bin/agenttool-browser.js mcp
```

Both keep protocol traffic on stdout and operational diagnostics on stderr.
Use `node dist/bin/agenttool-browser.js help` for the current command and
options.

The JSONL methods and MCP tool names are `browser_open`, `browser_observe`,
`browser_act`, `browser_extract`, `browser_screenshot`, `browser_tabs`, and
`browser_close`.

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
the observed `ref` and its `snapshotId`. A successful action invalidates that
snapshot, so observe again before choosing another referenced action.
Each `act` call contains exactly one action and is attempted once. The package
does not automatically retry uncertain clicks, submissions, typing, keypresses,
or navigation. The closed action set covers navigate, click, type, press,
select, scroll, bounded wait, back, forward, reload, new tab, and close tab;
there is no raw script or DevTools action.

Snapshot and extraction limits bound returned results, not the size of the
remote DOM that Chrome and Playwright must first process. An extremely large
page can still consume substantial browser/host memory; this local preview is
not a resource-quota sandbox.

## Safe defaults

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
node dist/bin/agenttool-browser.js jsonl \
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

## Configuration

| Purpose | CLI | Environment |
|---|---|---|
| Headless or visible | `--headless` / `--headed` | `AGENTOOL_BROWSER_HEADLESS` |
| Public web | `--public-web` / `--no-public-web` | `AGENTOOL_BROWSER_PUBLIC_WEB` |
| Local/private network | `--local-network` / `--no-local-network` | `AGENTOOL_BROWSER_LOCAL_NETWORK` |
| Ephemeral profile | `--ephemeral` | `AGENTOOL_BROWSER_PROFILE=ephemeral` |
| Persistent profile | `--profile <directory>` | `AGENTOOL_BROWSER_PROFILE=persistent` and `AGENTOOL_BROWSER_PROFILE_DIR` |
| Installed channel | `--channel <name>` | `AGENTOOL_BROWSER_CHANNEL` |
| Exact executable | `--executable <path>` | `AGENTOOL_BROWSER_EXECUTABLE` |
| Artifact directory | `--output-dir <path>` | `AGENTOOL_BROWSER_OUTPUT_DIR` |

Environment booleans accept `1/0`, `true/false`, `yes/no`, or `on/off`.
Unknown flags and malformed values fail rather than silently broadening policy.

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

The preview intentionally has no:

- arbitrary JavaScript evaluation;
- file-upload operation;
- credential-ingestion or secret-lookup API;
- shell or subprocess tool;
- browser-extension installation; or
- automatic import of a person's normal browser profile.

Use a separate trusted credential boundary if authenticated browsing is
required. Do not place secrets in JSONL, MCP arguments, or model-visible state.

## Network limitation

The public-web policy checks destinations before navigation, including DNS
answers. Playwright then owns the browser connection. The package cannot pin
the checked DNS answer to the later socket or verify the connected peer
address, and ambient proxies or browser routing can change the path.

This is therefore not a strong SSRF isolation boundary and must not be exposed
unchanged as a hosted arbitrary-target browser. `--local-network` is an
explicit widening of local process authority, not a sandbox.

The documented check is an HTTP(S) browser-request boundary, not generic
process egress isolation. Do not infer protection for another browser protocol
or process channel unless it is named and tested by this version. V0
separately blocks WebSockets instead of applying the HTTP(S) DNS claim to them.

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

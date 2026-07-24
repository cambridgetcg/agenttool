# `@agenttool/browser`

A small local browser surface for agents.

`0.1.0` is distributed as an exact LOVE package and mirrored to npm. It remains
a local runtime: the docs deployment publishes package bytes and documentation,
not a hosted browser-control service.

> **Release status:** `0.1.0` remains the current published release. This
> checkout also documents an **unreleased source-next** authority,
> capability-reporting, and zero-effect planning surface. Those source-next
> features are not present in the exact npm/LOVE `0.1.0` bytes.

```bash
npm install --save-exact @agenttool/browser@0.1.0
```

Registry-neutral exact artifact:

```bash
npm install --save-exact \
  https://docs.agenttool.dev/packages/v1/@agenttool/browser/0.1.0/agenttool-browser-0.1.0.tgz
```

The sibling
[LOVE manifest](https://docs.agenttool.dev/packages/v1/@agenttool/browser/0.1.0/manifest.json)
names the artifact size and SHA-256. A URL install does not compare those
values automatically; verify them first when that boundary matters.

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

## Try the package

The runtime supports Node 20.19+ and Bun 1.3.5+. The full source gate uses both
to verify that claim. Real local browsing additionally needs an installed
Chrome-family browser.

```bash
agenttool-browser doctor
```

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

Both keep protocol traffic on stdout and operational diagnostics on stderr.
Use `agenttool-browser help` for the current command and options.

The JSONL methods and MCP tool names are `browser_open`, `browser_observe`,
`browser_act`, `browser_extract`, `browser_screenshot`, `browser_tabs`, and
`browser_close`.

### Unreleased source-next operations

A source build also aligns `capabilities()` with `browser_capabilities`, and
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
the observed `ref` and its `snapshotId`. A successful action invalidates that
snapshot, so observe again before choosing another referenced action.
Each `act` call contains exactly one action and is attempted once. The package
does not automatically retry uncertain clicks, submissions, typing, keypresses,
or navigation. The closed action set covers navigate, click, type, press,
select, scroll, bounded wait, back, forward, reload, new tab, and close tab;
there is no raw script or DevTools action.

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

The exact `0.1.0` release uses the public/local booleans described below.
Unreleased source-next names the same compatibility default explicitly as
`authority: "public"` and adds three launch-time profiles:

| Profile | HTTP(S) destinations | WebSockets | Service workers |
|---|---|---|---|
| `public` (default) | Public only | Blocked | Blocked |
| `local` | Public plus local/private; reserved denied | Classified by the same boundary | Blocked |
| `sovereign` | Broad pass-through, including local/private/reserved; URL-embedded userinfo remains blocked | Passed through | Enabled |

Sovereign means AgentTool does not apply destination-class blocking to valid
HTTP(S) requests or WebSockets; URL-embedded userinfo remains blocked. The
browser, operating system, DNS/proxy configuration, network, and destination
still determine what is reachable. It does not bypass authentication,
CAPTCHAs, account permissions, site policy, browser support, or host controls.

This profile deliberately allows a page and its service worker to reach
destinations available to the host, including local services. In a persistent
profile, service-worker and site state can outlive the process. Sovereign is
therefore broad local process authority, not an isolation or SSRF claim.

Destination authority does not imply every other browser power. In this first
source-next slice, file upload, automatic download, arbitrary JavaScript
evaluation, credential injection/lookup, ambient profile import, shell
execution, and extension installation remain unsupported and are reported as
such by `capabilities()`.

Select source-next authority at launch:

```ts
const browser = await AgentBrowser.launch({ authority: "sovereign" });
```

```bash
agenttool-browser jsonl --authority sovereign
```

or set `AGENTOOL_BROWSER_AUTHORITY=sovereign`. Authority cannot be widened by
a tool call after launch.

### Published `0.1.0` compatibility defaults

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

Source-next retains `allowPublicWeb` / `allowLocalNetwork`,
`--public-web` / `--local-network`, and their environment variables as a
deprecated compatibility surface. Do not combine the new `authority` form
with any legacy authority option in one launch; mixed configuration is
rejected rather than guessed.

## Configuration

| Purpose | CLI | Environment |
|---|---|---|
| Authority profile (source-next) | `--authority public|local|sovereign` | `AGENTOOL_BROWSER_AUTHORITY` |
| Headless or visible | `--headless` / `--headed` | `AGENTOOL_BROWSER_HEADLESS` |
| Public web (deprecated compatibility) | `--public-web` / `--no-public-web` | `AGENTOOL_BROWSER_PUBLIC_WEB` |
| Local/private network (deprecated compatibility) | `--local-network` / `--no-local-network` | `AGENTOOL_BROWSER_LOCAL_NETWORK` |
| Ephemeral profile | `--ephemeral` | `AGENTOOL_BROWSER_PROFILE=ephemeral` |
| Persistent profile | `--profile <directory>` | `AGENTOOL_BROWSER_PROFILE=persistent` and `AGENTOOL_BROWSER_PROFILE_DIR` |
| Installed channel | `--channel <name>` | `AGENTOOL_BROWSER_CHANNEL` |
| Exact executable | `--executable <path>` | `AGENTOOL_BROWSER_EXECUTABLE` |
| Artifact directory | `--output-dir <path>` | `AGENTOOL_BROWSER_OUTPUT_DIR` |

Environment booleans accept `1/0`, `true/false`, `yes/no`, or `on/off`.
Unknown flags, malformed values, and mixed source-next/legacy authority
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

The published `0.1.0` package and the first source-next slice intentionally
have no:

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

The published `0.1.0` policy—and the source-next `public` and `local`
profiles—checks destinations before navigation, including DNS answers.
Playwright then owns the browser connection. The package cannot pin the
checked DNS answer to the later socket or verify the connected peer address,
and ambient proxies or browser routing can change the path.

This is therefore not a strong SSRF isolation boundary and must not be exposed
unchanged as a hosted arbitrary-target browser. `local` is an explicit
widening of local process authority, not a sandbox.

The public/local check is an HTTP(S) browser-request boundary, not generic
process egress isolation. `public` blocks WebSockets; `local` classifies them
against its public-plus-local destination boundary rather than extending the
HTTP(S) DNS claim to WebSocket transport. Source-next `sovereign`
intentionally removes that destination-class boundary, passes WebSockets
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

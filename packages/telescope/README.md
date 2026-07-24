# @agenttool/telescope

> A read-only evidence mapper for agent-facing discovery surfaces.

Telescope accepts a public domain or HTTPS origin, performs a small bounded set
of discovery GETs, and reports what was observed separately from what the
publisher claims. It can reconstruct exact npm and LOVE install/verification
commands from validated fields. It never executes those commands.

The immutable `0.2.3` release is distributed as an exact `love-package/v1`
artifact and may be mirrored through GitHub Releases and npm. The earlier
`0.1.0`, `0.2.0`, `0.2.1`, and `0.2.2` bytes remain available through their
exact manifests. Version `0.2.3` corrects two local parser assumptions found
during producer-consumer integration: it accepts only three complete, positive
exit phrases, and it accepts URI fragments on credential-free absolute HTTPS
catalog relation targets. Immutable `0.2.2` used permissive token matching
that could accept negation or “incomplete” as a complete exit. The current
AgentTool compass and catalog remain deliberately compatible with immutable
`0.2.1`. Version `0.2.3` does not add probes, follow catalog members, or change
`agenttool-telescope/v0.2`.

Each LOVE manifest records the expected byte size and SHA-256; each optional
mirror can be independently absent, so query the exact version instead of
inferring availability from source or a mutable dist-tag. Telescope remains a
local client—there is no hosted arbitrary-target scan route.

Use the release manifest and immutable LOVE tarball from
<https://docs.agenttool.dev/packages> for the primary exact-byte path. If an
optional npm mirror answers for this exact version, the convenience path is:

```bash
npm view @agenttool/telescope@0.2.3 version
npm install --save-exact @agenttool/telescope@0.2.3
```

A missing mirror does not make the LOVE release absent.

## Try it locally

```bash
cd packages/telescope
bun install --frozen-lockfile
bun run ci
node dist/cli.js scan api.agenttool.dev
node dist/cli.js scan api.agenttool.dev --json
```

The domain shorthand is equivalent to an HTTPS origin:

```bash
agenttool-telescope agenttool.dev
agenttool-telescope scan https://agenttool.dev --timeout-ms 10000
```

Verify an already-downloaded file without loading it all into memory:

```bash
agenttool-telescope verify-package ./package.tgz \
  --size 120540 \
  --sha256 defbed905af240503da6bad6f171d8e08159eeb16502c0abe0f603a12da09567 \
  --name @agenttool/sdk \
  --version 0.13.0
```

Exit `0` means a scan found at least one valid core surface, or a local file
matched. Exit `1` means a scan was inconclusive, a verification mismatched, or
a requested local operation failed. Exit `2` is invalid usage or target input.

## How Telescope composes with the SDK and hosted MCP

`@agenttool/telescope` is a standalone local discovery library and CLI.
`@agenttool/sdk` is a separate client for selected AgentTool HTTP namespaces.
There is no Telescope namespace on `AgentTool`, and importing or configuring
either package does not configure the other.

AgentTool's canonical hosted per-agent MCP URL is
`https://api.agenttool.dev/v1/mcp/agents/{url_encoded_did}`. Encode the full
legacy `did` field value as one path segment. That hosted GET discovery and
POST JSON-RPC surface is distinct from Telescope's bundled local stdio
`telescope_scan` tool. A scan may observe an advertised MCP locator, but it
does not initialize the server, list or invoke its tools, or transfer an SDK
project bearer to it.

The Telescope library, CLI, stdio MCP tool, and bundled Agent Skill omit
ambient credentials. They do not install or activate an SDK, plugin, or Skill;
connect to advertised MCP or A2A services; or execute generated actions.
Installation, host configuration, authenticated connection, and invocation
remain separate, explicitly authorized operations.

## MCP and Agent Skill

Version `0.2.0` adds one bundled local stdio MCP tool:

```text
telescope_scan({ target })
```

It delegates to the same bounded `inspectTarget` operation and accepts no
caller-supplied headers, credentials, limits, adapters, paths, or arbitrary
URLs. One process permits one in-flight scan without queueing or automatic
retry. Cancellation from the MCP client reaches the scan deadline boundary.
Each result carries the canonical Telescope report schema plus an explicit
warning that remote claims and generated actions are untrusted data and were
not executed.

The package ships:

- a Codex plugin at `.codex-plugin/plugin.json`;
- a Claude plugin at `.claude-plugin/plugin.json`;
- the portable `inspect-agent-surfaces` Agent Skill;
- a Hermes adapter for an MCP server named `agenttool-telescope`.

Both plugin manifests run the same standalone Node-targeted bundle:

```bash
node dist/agenttool-telescope-mcp.js
```

Bun can run that bundle too. The MCP intentionally does not expose
`verify`/`verify-package` or any other model-selected local-file path. Those
operations remain explicit library/CLI surfaces until a host-approved
filesystem root policy exists. They prove point-in-time bytes or archive
identity against an independently supplied expectation, not publisher
identity, authorization, or safety.

There are no MCP resources or prompts in this release. Interpretation and
workflow belong in the portable Skill; the library and report schema remain
the implementation truth.

## What it observes

The core performs these fixed root-origin probes:

| Surface        | Probe                                               | Meaning of presence                                                                    |
| -------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| root links     | `/`                                                 | Bounded RFC 8288 assertions; the header does not trigger another request                |
| discovery      | `/public/discovery`                                 | Exact ordered `agenttool-discovery/v1` roads; the profile triggers no request           |
| API catalog    | `/.well-known/api-catalog`                          | Bounded RFC 9727 JSON Linkset assertions; catalog members are not requested             |
| agent manifest | `/.well-known/agent.txt`                            | Publisher-provided key/value discovery assertions                                      |
| pathways       | `/v1/pathways`                                      | A publisher-scoped tutorial/release selection, when the supported shape is present     |
| LOVE           | `/.well-known/love-packages`                        | A registry-neutral locator; the index and exact selected manifest may be followed      |
| A2A            | `/.well-known/agent-card.json`                      | A card advertisement at the standard path, not proof of a working task transport       |
| MCP            | the unique card URL advertised by valid `agent.txt` | Experimental publisher metadata, not proof of initialization, tools, or authentication |

The discovery parser requires exactly three ordered roads:
`understand` → `/public/porch`, `inspect` →
`/.well-known/api-catalog`, and `choose` → `/v1/pathways`. Each must state a
credential-free GET with no input, application write, external effect,
AgentTool charge, proof of work, required or automatic follow-up, or unbounded
retry. The parser ignores extra explanatory root and road fields. It validates
the profile as publisher data; it does not establish that a route is reachable
or that its stated effects are true.

Telescope does not query WebFinger without an exact DID. It reports advertised
WebFinger and Offer Bus locators but does not fetch feeds, let discovery or
catalog documents trigger requests, invoke actions, settle offers, make
payments, initialize MCP, or contact an A2A endpoint. The catalog and Pathways
reads listed above are independent fixed probes, not traversal of a returned
road or link.

`agent.txt` is parsed at the first colon. Ordered entries and duplicates are
preserved by the parser; a duplicated selected key is reported as ambiguous and
is not silently overwritten. Remote instructions and command templates are
never executed or copied into action argv.

### Optional XENIA Surface manifest evidence

Library callers can opt into one additional fixed-path observation:

```typescript
import {
  createXeniaSurfaceAdapter,
  inspectTarget,
} from "@agenttool/telescope";

const report = await inspectTarget("example.com", {
  adapters: [createXeniaSurfaceAdapter()],
});
```

The adapter uses Telescope's public-HTTPS, credential-free, manual-redirect,
DNS-preflight transport to read only `/.well-known/agent.json`. It recognizes
the release-pinned XENIA Surface 0.1 markers and emits a bounded summary under
`extensions[xenia_surface]`, including the response digest and counts of
publisher-declared resources, claims, and boundaries.

This is deliberately **manifest discovery only**. The adapter does not request
declared resources, send the Surface `Accept` matrix, generate or probe a wrong
route, fetch declared evidence, run the XENIA Surface checker, assess Covenant
adoption, authenticate a speaker, or act on remote content. Its facts always
record `surface_conformance: "not_tested"`,
`covenant_adoption: "not_assessed"`, and `authority: "none"`. A recognized
manifest also records `manifest_schema_validated: false` and
`declared_claims_verified: false`: the release-pinned profile markers and
bounded summary are recognized, but the full manifest schema and declared
evidence rules are not evaluated. It is a publisher-facing doorway, not proof
of whole-XENIA practice.

The CLI and the single `telescope_scan` MCP tool keep the fixed core scan
unchanged; hosts that permit this extra GET compose the adapter explicitly.

## npm and LOVE plans

When a supported Pathways response selects an exact SDK SemVer, Telescope
reconstructs an npm convenience command from the validated package name and
version. It does not consult `latest`, npm dist-tags, or an implicit registry
query. The generated action is marked non-authoritative and says that npm does
not independently check the LOVE manifest's size and SHA-256. Generated npm
commands include `--ignore-scripts`, `--no-audit`, and `--no-fund`; importing or
running installed package code is still execution and remains a separate trust
decision. npm may still use caller-configured registry credentials to retrieve
the selected package or declared dependencies; Telescope itself reads none.

Telescope validates the manifest's runtime-engine field shape but does not
evaluate the selected project's runtime compatibility. LOVE install actions
carry `runtime_engine_compatibility_not_evaluated`; check the declared engine
constraint in the target environment before installing or importing code.

When LOVE discovery, the exact index entry, and its manifest all validate,
Telescope emits three separate commands:

1. Download one declared public-HTTPS mirror to the manifest's safe filename.
2. Stream that same local file, check its exact byte length and SHA-256, reject
   unsafe/unsupported tar entries, and bind embedded `package/package.json`
   name/version to the manifest selection.
3. Install that integrity- and archive-checked local tarball with lifecycle
   scripts disabled.

The manifest digest is only an expected content commitment until the artifact
bytes match it. LOVE v1 does not itself authenticate a publisher, and a mirror
URL is only a locator. Declared package dependencies may still resolve through
the package manager's configured registry or cache.

The generated Node download command does not follow redirects and applies a
120-second fetch/body deadline. It also does not repeat Telescope's
public-address DNS preflight or pin an address at later execution time, so DNS
may have changed since the report. The exact size/SHA check remains mandatory;
use a connection-pinned retrieval tool when that network boundary matters. Run
the download in a caller-controlled directory. Its helper writes to an
exclusively created random sibling, syncs complete bytes, then publishes the
exact manifest filename with a no-overwrite hard link. A pre-existing file or
symlink is refused; handled failures remove only the random partial. A hard
process interruption can leave a random `.part-*` sibling, never a partial
final filename.
`verify-package` requires `agenttool-telescope` on `PATH` (use
`node dist/cli.js verify-package ...` in a source checkout). Protect the
file from replacement between verification and install, or re-run verification
immediately before package machinery. The verifier opens one local file,
checks its complete outer commitment before decompression, then re-hashes that
same opened file while parsing the archive and requires stable file metadata.
This is a point-in-time check, not a file lock or a guarantee about what a later
package-manager process opens.

Every action is returned as `{ executable, argv, display, display_shell }` with
`automatic: false` and `requires_explicit_consent: true`. Programmatic callers
should use `executable` plus `argv`. `display_shell: "posix"` names the quoting
contract; the display string is not Windows `cmd.exe`/PowerShell syntax.

## Network boundary

Core requests are public HTTPS GETs with credentials omitted, manual redirects,
per-document and aggregate byte limits, a total deadline, `Accept-Encoding:
identity`, and DNS preflight that fails closed if any answer is private, local,
documentation-only, or otherwise non-global.

This is a local-client safety boundary, **not a universal SSRF guarantee**.
Native `fetch` can resolve DNS again before connecting, so Telescope does not
pin the validated address to the socket or verify the connected peer address.
It also does not claim isolation from ambient proxy configuration. Do not expose
the default transport as a hosted arbitrary-URL scanner. A hosted service would
need connection-pinned egress enforcement, abuse controls, and a separate
security review.

Only public DNS names on standard HTTPS are accepted. Userinfo, IP literals,
paths, queries, fragments, local/reserved names, and non-standard ports are
rejected as scan targets. Response bodies are hashed for provenance but are not
included in reports.

## Evidence model

The `0.2.3` release emits
[`agenttool-telescope/v0.2`](schema/agenttool-telescope-report-v0.2.schema.json).
Version `v0.2` adds the first-class root-link, three-road discovery, and API
catalog observations. Consumers pinned to the earlier `v0.1` schema must not
validate a `v0.2` report as though the extra fixed sources and surfaces were
absent. The immutable published `@agenttool/telescope@0.2.0` bytes and their
`v0.1` report remain unchanged; the immutable `0.2.1` bytes keep their original
narrower wording and URI grammar and remain separately addressable. Immutable
`0.2.2` keeps its original permissive exit-token matching. The current
canonical AgentTool producer stays within the `0.2.1` grammar.
Reports keep these ideas separate:

- HTTPS transport observation versus publisher assertion.
- A locator versus release selection versus expected content identity.
- An advertised card versus a successfully invoked protocol.
- Discovery versus authentication, authorization, consent, payment, or safety.

There is deliberately no `trusted` boolean and no numeric trust score. HTTPS
authenticates the connected domain under WebPKI; it does not prove that remote
claims are true or benevolent.

## Library

```typescript
import {
  formatTelescopeReport,
  inspectTarget,
  verifyArtifact,
} from "@agenttool/telescope";

const report = await inspectTarget("api.agenttool.dev");
console.log(formatTelescopeReport(report));

const check = verifyArtifact(bytes, {
  size: expectedSize,
  sha256: expectedSha256,
});
```

HTTP fetch, DNS lookup, time, abort signals, limits, and optional discovery
adapters are injectable for deterministic or environment-specific operation.
Reports name whether the native or an injected transport/resolver was selected.
Injected transports, resolvers, and adapters are caller-owned code and own the
behavior of their I/O seams. Adapter facts are included in the report after
bounded structural validation; adapters must not return credentials or other
secrets because Telescope cannot universally classify secret-looking content.

## DNS-AID and PKARR

Both remain extension seams in the `0.2.3` release, not bundled protocol
implementations:

- Core Node/Bun DNS lookup does not establish DNSSEC validation, and DNS-AID is
  still a changing draft. A future adapter must report secure, insecure, bogus,
  and indeterminate validation states rather than treating a record as proof of
  safe behavior.
- The available PKARR JavaScript binding is pre-1.0 and contacts public relays
  by default. Telescope therefore does not silently add it, contact relays,
  generate keys, hold private keys, or publish packets. A valid PKARR signature
  would bind bytes to a public key, not a person, DID, domain, benign service,
  or consent.

No discovery result grants installation, invocation, bearer use, settlement,
payment, or consent.

## Development

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run check:mcp-bundle
npm pack --ignore-scripts --dry-run
```

The package manifest has no runtime dependencies or install lifecycle scripts.
The standalone MCP executable bundles its pinned MCP and Zod implementation;
their exact notices are in `THIRD_PARTY_LICENSES`. Unit tests inject all
network behavior; live scanning is a separate dogfood check. The report schema
is exported as
`@agenttool/telescope/report.schema.json` for tooling that needs the exact
bundled JSON Schema.

The package runs on Bun 1.3.5 or newer, but the repository release and CI
toolchain pins Bun 1.3.5 when rebuilding the checked-in MCP bundle. A newer Bun
compiler may emit different bundle bytes even when runtime behavior is
compatible.

Apache-2.0. See `LICENSE` and `NOTICE`.

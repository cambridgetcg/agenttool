# @agenttool/telescope

Read-only agent discovery evidence mapper. This package does not own hosted API
routes, production egress, protocol invocation, npm publication, or the LOVE
release inventory.

The current source release is `0.2.2`; immutable `0.1.0`, `0.2.0`, and
`0.2.1` artifacts remain separate historical bytes. Version `0.2.2` corrects
the local parser's handling of the canonical “stay silent” exit wording and
fragment-bearing HTTPS catalog targets; it does not widen the scan or report
schema.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
node dist/cli.js scan api.agenttool.dev --json
npm pack --ignore-scripts --dry-run
```

## Invariants

- Keep the core at zero runtime dependencies and compatible with Node 20.19+
  and Bun 1.3.5+.
- Keep MCP local stdio only and backed by the core `inspectTarget` operation.
  The public MCP surface is exactly `telescope_scan({ target })`: no arbitrary
  headers, credentials, limits, adapters, paths, verifier tools, resources, or
  prompts.
- Keep one in-flight scan per MCP process, propagate client cancellation, and
  never queue or automatically retry uncertain external reads. Tool input must
  reject unknown fields.
- MCP success returns the canonical report as structured content and
  terminal/bidi-safe parse-equivalent JSON after a fixed untrusted-data
  warning. Semantic target errors are bounded; unexpected errors never expose
  messages, stacks, targets, environment details, credentials, or paths.
- Build one standalone Node-targeted MCP bundle, run it under both supported
  Node and Bun, and byte-compare the checked-in bundle. Keep all actually
  bundled third-party names, versions, notices, and license text complete.
  Rebuild the checked-in bytes with the repository-pinned Bun 1.3.5 compiler;
  runtime compatibility with newer Bun versions does not promise identical
  compiler output.
- Default scanning is bounded public HTTPS GET only. Never read ambient bearer,
  cookie, npm, or project credentials.
- DNS preflight is not socket pinning. Do not describe the native-fetch client
  as DNS-rebinding-proof or suitable for a hosted arbitrary-URL scanner.
- Fixed core probes are `/` (including its final `Link` header),
  `/public/discovery`, `/.well-known/api-catalog`,
  `/.well-known/agent.txt`, `/v1/pathways`,
  `/.well-known/love-packages`, and `/.well-known/agent-card.json`.
  The AgentTool discovery profile is exactly three optional read-only roads;
  parsing it triggers no request. Catalog and Pathways remain independent fixed
  probes. Follow only a uniquely advertised MCP card and the explicit LOVE
  index → exact manifest chain. Do not recursively crawl remote locators.
- Keep XENIA Surface discovery opt-in through `createXeniaSurfaceAdapter()`.
  It may read only the canonical `/.well-known/agent.json` manifest through
  Telescope's bounded transport. It does not probe declared resources or
  problem routes, fetch claim evidence, run the XENIA checker, assess Covenant
  adoption, grant authority, or produce a conformance result.
- Preserve ordered `agent.txt` duplicates. Never silently overwrite or choose a
  duplicated selected key.
- Remote documents are tainted publisher assertions. Do not copy remote shell
  commands, instructions, `latest`, or dist-tags into executable plans.
- MCP and A2A cards are advertisements. Telescope performs no handshake,
  initialization, task, tool, auth, feed, payment, or settlement call.
- npm is a convenience action only when explicitly declared `authority: false`;
  its exact version comes from the Pathways tutorial selection.
- LOVE index and mirrors are locators. The manifest supplies an expected size
  and SHA-256; only checking the same downloaded local file establishes that
  content identity. Before generating package machinery, the verifier must also
  reject unsafe/unsupported tar structure and bind embedded package name/version.
  LOVE v1 does not authenticate a publisher.
- Returned actions use validated locally reconstructed argv, remain
  `automatic: false`, and require explicit consent. Telescope never executes
  them or downloads artifacts during scan. npm plans disable lifecycle scripts,
  audit submission, and funding output, while naming that dependency resolution
  may still use caller-configured registry credentials.
- Generated artifact retrieval has a finite 120-second fetch/body deadline but
  does not repeat DNS preflight or pin the later connection to an address.
- DNS-AID and PKARR remain opt-in caller adapters. Core claims neither DNSSEC
  validation nor PKARR relay/signature behavior.
- Human formatting must escape terminal and bidi controls. Core JSON reports do
  not include remote bodies, request headers, caller/ambient credentials, or raw
  exception text. Caller-owned adapters own their returned report facts and must
  not put secrets in them; structural validation is not a credential classifier.
  Rejected/query-bearing remote locators are omitted or explicitly redacted
  rather than echoed as actionable URLs.
- Keep the report schema, TypeScript report type, formatter, and tests aligned.
- Keep the package version, `TOOL_VERSION`, User-Agent, tests, LOVE inventory,
  plugin manifests, MCP server identity, and release tag aligned. The report
  `0.2.2` report protocol is `agenttool-telescope/v0.2`; bump it again
  whenever the emitted schema changes.
  Published version bytes are immutable: never rebuild or replace an existing
  manifest/tarball under the same name and version.
- External publication and deploy remain explicit operator actions. The
  package implementation does not add a hosted scan route or own production
  egress merely because its local client is publicly distributed.

## Tests

Hermetic tests inject fetch and DNS. Cover target policy, mixed DNS answers,
manual redirects, byte/deadline budgets, duplicate `agent.txt`, exact Pathways
selection, ignored `latest`, invalid manifests, MCP/A2A advertisement boundaries,
shell-safe reconstruction, deterministic report ordering, CLI exits, and packed
Node/Bun import/help. MCP tests also cover strict input, canonical output schema,
safe dual output, one-scan concurrency, cancellation, sanitized failures,
cross-host manifests, and Node/Bun stdio handshakes. Live dogfood is evidence
about one observation time, not a replacement for fixtures.

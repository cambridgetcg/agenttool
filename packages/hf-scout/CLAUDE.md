# @agenttool/hf-scout

Private, local-only Hugging Face discovery/provenance prototype. This package
owns only `packages/hf-scout`.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```

## Invariants

- Keep `private: true`, no `publishConfig`, no release inventory, workflow,
  wake, hosted API, deployment, or KINGDOM-OS schema changes.
- Keep the core at zero runtime dependencies and compatible with Node 20.19+
  and Bun 1.3.5+.
- The built-in network path is a bounded `GET` that requests credential
  omission to the fixed
  `https://huggingface.co` origin. No arbitrary base URL, token/header option,
  redirects, retry, download, upload, inference, Space invocation, Job, or
  Sandbox operation. Structural readers cannot claim built-in transport
  identity; a custom `fetch` is reported as caller-owned even though the
  wrapper still races its own deadline. Capture the default host fetch at
  module load, and describe credential omission as requested rather than
  universally proven.
- Never read ambient HF/npm/MCP credentials. MCP OAuth belongs to its host and
  is not inherited by this package.
- Treat Hub fields as untrusted publisher assertions or provider content
  commitments. Never emit `trusted`, `safe`, approved, license-compatible, or
  execution-ready conclusions.
- Keep research curation in the `researcher_inference` overlay. Never copy it
  into `snapshot.declared`, which is reserved for publisher assertions.
- Research leads are inert metadata. Do not download rows/files, accept gates,
  extract archives, load weights, or execute embedded calls while curating or
  binding them.
- A full 40-character value is an immutable revision shape, not proof of
  existence or repository association. Preserve public-provider observation
  versus caller-owned assertion in durable snapshots. Mutable observations may
  be inspected but cannot be projected into Agent Data.
- Keep observation time outside canonical artifact snapshot bytes. Bind Agent
  Data identity/version to both revision and exact snapshot SHA-256.
- The Love Python model-lock tool remains the creator/verifier. This package
  validates and projects an explicit lock file; it never downloads or verifies
  a local snapshot.
- Human and JSON terminal output must escape control/bidi state, including
  DEL/C1 characters that JSON permits literally. Reports and
  errors omit response bodies, headers, raw exceptions, environment details,
  credentials, and arbitrary paths.
- Keep schema, types, package/version constants, extension descriptor, CLI, and
  tests aligned. JSON Schemas close structure; runtime projectors own semantic
  invariants that portable schema cannot express.
- The facility map must keep its observation date and official links. Presence
  does not prove plan tier, permission, quota, availability, or safety.

## Verification

Tests are hermetic and inject readers/fetch/time/files. Cover fixed endpoints,
credential-omission requests, redirect/size/deadline/cancellation limits, deterministic
projection, schema closure, terminal controls, lock digest compatibility,
CLI exits, Node/Bun import and help, and package contents. Live public dogfood
is a separate point-in-time check and never replaces fixtures.

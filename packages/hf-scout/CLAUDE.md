# @agenttool/hf-scout

Public developer-preview Hugging Face discovery, exact-revision provenance,
and release-reconciliation package. This package owns only
`packages/hf-scout`.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```

## Invariants

- Keep the npm surface ready for a public prerelease under Apache-2.0, while
  leaving publication, hosted APIs, deployment, and KINGDOM host registration
  to separately authorized release operations. Preserve the exported v0.1
  schemas as historical contracts when v0.2 becomes the default.
- Keep the core at zero runtime dependencies and compatible with Node 20.19+
  and Bun 1.3.5+.
- Each built-in network operation is a bounded anonymous `GET` that requests
  credential omission to the fixed
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
- Exact inspection accepts only a full lowercase 40-hex commit SHA. The public
  path must percent-encode the complete revision segment, retain
  `?blobs=true`, and fail closed unless the response `sha` exactly matches the
  request. A revision 404 means only “not found or not associated with this
  repository”; do not disclose provider bodies or claim whether it existed.
- Keep requested revision, resolved revision, and a separate current-head
  observation distinct. A full SHA returned from an unpinned current-head read
  remains mutable provenance and cannot be projected into Agent Data.
- `blobId` is a Git blob commitment; for LFS files `lfs.sha256` is the payload
  commitment. Never conflate algorithms, and never infer Xet hashes when the
  repository-info response did not provide one.
- Release reconciliation performs one exact-revision read and one separate
  current-head read. It keeps publisher assertions, provider observations,
  caller source declarations, and caller-reported local verification separate;
  none establishes license truth, consent, training authority, safety, or
  compatibility.
- Dataset Viewer is outside the v0.2 runtime. If later integrated, treat
  `X-Revision` as a possibly stale cached processing revision: its revision
  query is ignored and it is not immutable provenance or a universal head.
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
exact revision routing and mismatch failure, credential-omission requests,
redirect/size/deadline/cancellation limits, deterministic reconciliation and
projection, schema closure, terminal controls, lock digest compatibility, CLI
exits, Node/Bun import and help, and exact package contents. Live public dogfood
is a separate point-in-time check and never replaces fixtures.

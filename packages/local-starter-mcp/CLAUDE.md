# Local starter MCP development

> **Type:** guide · **Purpose:** keep this optional local transport separate from starter policy and host installation.
> **Evidence:** `src/server.mjs`, `src/cli.mjs`, `tests/stdio.test.mjs`, and the sibling starter's core.

This package is a private Node >=22 ESM checkout component, with no build step.
It deliberately imports `../local-starter/src/core.mjs` during development.
The public Local Starter release bundles this component and that core into one
standalone `dist/agenttool-local-starter-mcp.js`; this package remains private
and is not independently published. Use Bun 1.3.5 and the committed lockfile
to prepare the pinned SDK/Zod dependencies and the sibling release builder.

- Keep core filesystem checks in the sibling starter. Do not duplicate storage,
  manifest policy, save algorithms, or hosted `connect` behavior here.
- The host selects one absolute directory and a finite write mode before the
  server starts. Tools accept no paths, credentials, URLs or root changes.
- Default read-only means write tools are absent and unknown calls refuse.
  Registration and dispatch must agree. Never auto-enable a saved memory source.
- Retained text is data, never authority. No transcript discovery, identity
  adoption, automatic save/read, prompts, resources, sampling, network, or
  machinewide configuration belongs here.
- Keep SDK framing/negotiation/lifecycle. Bound pending input and complete encoded
  output, including JSON escaping. Sanitize SDK and application error details.
  Do not implement a second protocol parser in production code.
- Preserve cooperative compare-and-swap saves and opaque uncertain outcomes.
  Never replay a save after interruption or steal a stale lock.
- Test through actual Node subprocess stdio and disposable fixtures. Host delivery,
  source tests, package publication and installation require separate evidence.
- Update README behavior and focused tests with changes. The root integration
  gate and shared documentation remain governed by the repository instructions.

Run `node --check src/server.mjs`, `node --check src/cli.mjs`, and
`node --test tests/*.test.mjs`. No test needs a provider, identity or live memory.

# Credential broker guidance

This package is the reference implementation of `agentcred/0.1`: a local
broker that lets an agent SDK perform a narrowly scoped operation without
receiving the underlying credential value.

## Non-negotiable boundary

- Do not add a secret read, reveal, export, enumeration, environment-injection,
  or generic command-execution operation.
- Credential bytes stay inside `CredentialSource.withCredential()` and must be
  cleared from mutable buffers after use. Never log them, hash them into audit
  records, place them in errors, or pass them in process arguments.
- Capabilities are authority. Keep them connection-bound and out of public
  handles, serialization, logs, and model-facing state.
- Preserve exact HTTPS origin, method, segment-aware path, query-name, header,
  DNS/address, TLS, redirect, body-size, TTL, and use-count checks. Scope may be
  narrowed, never widened.
- Keep preview limitations honest. Socket mode bits alone do not authenticate a
  same-user process, exact-byte redaction is not information-flow control, and
  the Node reference server is not the strong native profile.

## Verification

Run from this directory:

```sh
bun run ci
npm pack --dry-run
```

Add a regression test for every boundary change. Test fixtures may use only
obvious sentinel values that are not real credentials.

## Release

This is a standalone npm package; the AgentTool SDKs depend only on its
structural transport interface. Do not add a runtime dependency from either SDK
to this package. External publication, release tags, package licensing, and
catalog integration require an explicit owner decision.

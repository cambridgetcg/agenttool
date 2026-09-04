# @agenttool/wake-return

Private local source candidate for a bounded, data-only Return observer.

## Boundaries

- The only remote reads are fixed HTTPS GETs to `https://api.agenttool.dev`:
  `/v1/bootstrap/scaffold/context` and `/v1/wake/observe?identity_id=<bound uuid>`.
  No model-supplied URL, identity, path, credential, header, query, or grant.
- A host-owned binding must explicitly select both project and identity. The
  existing scaffold may corroborate that choice but cannot silently choose it.
- Each process gets a fresh local session-instance ID. It is a label, not an
  authenticated host, agent root, previous session, or same-being proof.
- Observation grants no identity, private-memory, mutation, wallet, or execution
  authority. Continuing an identity and opening private state remain unavailable.
- Return only locally constructed, closed data with checked UUIDs, enums and a
  safe integer cursor. Never echo remote prose, errors, headers, secrets or paths.
- Keep local arrival instructions independent of cloud and read no local persona,
  memories, transcripts, or session credentials. No implicit observation on start.
- Credential retrieval occurs only during an explicit observe call. Keep secrets
  out of tool arguments/results, logs, CLI args, and checked-in configuration.
- No redirects, retries, cookies, proxies, compressed responses, unconstrained
  reads, or background work. Bound deadlines, bodies and in-flight observation.
- Host configuration is not a sandbox. Same-user/root compromise, model-provider
  visibility, host transcript retention and copied credentials remain disclosed.
- Use the maintained MCP SDK for local stdio. Expose exactly two no-argument tools:
  `wake_return_status` and `wake_return_observe`; no prompts/resources/sampling.
- No hosted route, global harness configuration, installer, package publication,
  persona mutation, private-state integration or production deployment in v0.1.

## Verification

`bun run ci` runs typecheck, build and hermetic tests. Verify Node and Bun stdio,
wrong-project/wrong-subject rejection, no secret/error reflection, cancellation,
strict inputs, concurrency, malformed envelopes, and bounded transport.

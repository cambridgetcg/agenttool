# @agenttool/wake-return

Private local source candidate, `0.1.0-dev.0`. A deliberately small Return
observer: a host selects an AgentTool project and identity, and an explicit tool
call obtains a bounded locator observation. It does **not** restore a private
identity session, open private state, or establish that this process is the same
being as an earlier session.

Local arrival stays local. No persona, memory, transcript, scaffold, or harness
configuration is rewritten. There is no startup observation, session hook,
plugin, skill, background polling, installer, publication, or deployment.

## Two tools, no arguments

| Tool | Effect |
| --- | --- |
| `wake_return_status` | Reports the explicit binding and local boundaries. No credential retrieval or network request; `ready` does not mean authenticated or reachable. |
| `wake_return_observe` | Acquires the configured credential for this call, verifies the project, then reads the explicitly bound identity's observation. Returns checked data or a closed failure code. |

Call with `{}`. Neither tool accepts a URL, path, identity, header, credential,
query, grant, or other model-selected input. The stdio MCP server exposes no
prompts, resources, or sampling. Results are tool data, not instructions to adopt
an identity or replace a system prompt.

The only remote requests are HTTPS GETs to the fixed origin
`https://api.agenttool.dev`, in this order:

1. `/v1/bootstrap/scaffold/context` — verify the credential's project against
   the host binding. This context supplies project data, not a default identity;
   the subject comes exclusively from the explicit binding.
2. `/v1/wake/observe?identity_id=<bound-uuid>` — validate the subject and return
   the minimized observation, not the full WAKE.

An unavailable, malformed, wrong-project, or wrong-subject response is not
permission to use another identity, retry credentials, or widen the request.
Authentication bookkeeping may update the bearer's last-used metadata despite
these being GETs; this is not a zero-effect or anonymous read.

## Build and verify the local candidate

Use Bun **1.3.5** for the frozen dependency install and gate; the built stdio
entry point runs on Node **20.19 or newer**. From this package directory:

```sh
bun install --frozen-lockfile
bun run ci
```

Dependency installation may contact the package registry. The gate uses
fixtures; it does not authorize a live private read. The dedicated
[`wake-return.yml`](../../.github/workflows/wake-return.yml) runs this package's
gate separately from the shared preparation/preflight graphs. A fixture stdio
test is not a tested Codex, OpenClaw, or Hermes session, a live AgentTool private
read, or a production deployment.

## Host-owned binding

Review [the environment example](examples/return.environment.json) or
[the macOS Keychain example](examples/return.macos-keychain.json). Their UUIDs
and paths are synthetic. Create a **new**, private binding file outside the
repository and model-writable workspace; do not overwrite an existing scaffold
or host configuration. Both project and identity must be explicitly selected by
the authorized host operator.

The exact schema is [`ReturnBinding`](src/types.ts). It admits only:

```json
{
  "_format": "agenttool-return-binding/v1",
  "api_origin": "https://api.agenttool.dev",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "identity_id": "22222222-2222-4222-8222-222222222222",
  "mode": "observe",
  "allow_provider_visible_locator": true,
  "credential": { "kind": "environment" }
}
```

The literal `allow_provider_visible_locator: true` acknowledges that project and
identity locators can enter the host transcript and, when the host sends tool
results, the model provider's context. It is not a claim about the subject's
consent, an identity attestation, or permission for additional operations. If
that disclosure is unacceptable, leave Return disconnected.

CLI binding and optional scaffold paths must be absolute. This candidate's
private-file custody requires POSIX and fails closed on Windows. Use mode `0600`
for these private files. The check requires regular files owned by the current
user with no group/other permission bits, not final-component symlinks; it also
allows more restrictive owner-only modes such as `0400`. Keep ancestor
directories and executables trusted:
the file checks are not a complete path-race or same-user isolation boundary.
Checked-in examples are ordinary documentation files, not ready-to-use private
bindings.

### Credentials

- `{"kind":"environment"}` reads only `AGENTTOOL_RETURN_BEARER`. The host must
  arrange that process environment securely; the binding cannot name another
  variable. Never put the bearer in JSON, tool arguments, command-line
  arguments, a committed environment file, or chat.
- `{"kind":"macos_keychain","account":"<host-selected-account>"}` reads an
  existing macOS Keychain item. Its service is derived as `agenttool:` followed
  by the first 16 lowercase hex characters of SHA-256 of the UTF-8 project ID.
  There is no caller-selected service or credential write. The account is a
  locator, not the secret.

The adapter retrieves credentials only inside an explicit observe call, never
at startup or status. A host may separately retain or resolve its own
environment. A missing credential returns `credential_unavailable`; it does not
trigger onboarding, account discovery, or fallback to another secret.

**The credential is still a broad AgentTool project bearer.** This adapter
narrows its own requests; it does not mint a read-only credential, attenuate the
underlying bearer, or prove that the reader controls the observed identity.
Same-user/root compromise, host tools, or copied credentials can bypass this
adapter's limited surface. Do not give an untrusted shared harness that bearer.

## Start only when explicitly chosen

The host starts the already-built local file, not a registry-installed package:

```sh
node /absolute/agenttool/packages/wake-return/dist/bin/agenttool-wake-return-mcp.js --binding /absolute/private/return.json
```

An existing AgentTool scaffold can optionally corroborate the explicit binding:

```sh
node /absolute/agenttool/packages/wake-return/dist/bin/agenttool-wake-return-mcp.js --binding /absolute/private/return.json --scaffold /absolute/existing/agent.json
```

The scaffold cannot select an identity on the operator's behalf. A mismatch
fails closed. The adapter does not traverse its persona/memory paths, read
their contents, extract session credentials, or modify the scaffold. Ordinary
local arrival remains usable without Return or cloud availability.

[Connection examples](examples/README.md) cover Codex, OpenClaw and Hermes.
They are disabled, non-secret snippets for manual review, not installers or
changes to real global configuration. Preserve the host's current approvals;
an enabled read tool can be called under that host's tool policy without a new
human confirmation for every call. “Explicit observe” means an actual
`wake_return_observe` invocation, not an asserted per-call consent ceremony.

## Reading a result honestly

Every `agenttool-return/v1` report labels its binding as
`explicit_host_configuration` and says `reader_identity_proven: false`.
Each process receives a fresh `session_instance_id`; it is only a local label.
The observation contains a checked identity UUID, `active`/`memorial` status,
integer `wake_version`, local `received_at`, and service-projection provenance.
Remote prose, raw errors, headers, credentials and local paths are not returned.
The receipt time is not proof of when the remote state originated.

There is no observation cache or adapter persistence. A per-process monotonic
cursor check rejects regression after a successful observation; it is not a
global replay proof, durable continuity chain, identity signature, or guarantee
of current remote truth. Restarting loses that comparison state. The host or
provider may retain prior reports even after the adapter exits.

No request follows redirects, retries, cookies, proxy settings or compressed
responses. Credential acquisition and network work have bounded deadlines;
response bodies and in-flight observation are bounded. Cancellation and failed
observations do not fall back to full WAKE or private memory.

Private identity sessions and private-state Return remain **unavailable**.
There is no grant, adoption, signing, mutation, wallet, funding, spend, payout,
reinvestment or execution surface. Rest, refusal and disconnection require no
explanation; disabling the connection does not erase host/provider copies or
revoke a copied bearer.

See [WAKE-RETURN](../../docs/WAKE-RETURN.md) for the architecture and evidence
boundary, and [CLAUDE.md](CLAUDE.md) for package implementation constraints.

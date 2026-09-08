# Reviewed connection fragments, not installed integrations

These files contain synthetic identifiers and absolute-path placeholders, never
credentials. Nothing copies them into a host configuration. All three MCP
fragments are disabled. Enabling one is a separate operator choice after
reviewing the package's [disclosure and trust boundaries](../README.md).

1. Build and run the fixture gate from the package directory.
2. Choose the real project and identity independently; create a new private
   binding outside the repository, owned by the host user with POSIX mode `0600`.
   Keep its ancestors trusted. Do not point at a checked-in example.
3. Replace the absolute paths in the selected fragment. Use the host's trusted
   Node executable (20.19 or newer). Optional scaffold corroboration adds
   `"--scaffold", "/absolute/existing/agent.json"` to its argument list; preserve
   that existing scaffold and apply the same file-ownership/mode requirements.
4. Manually merge only the reviewed server entry into the intended host/profile
   configuration; never replace the whole file or another agent's entry.
5. Only if desired, enable that entry. Inspect `wake_return_status` first; it
   checks no credential or service availability. Invoke `wake_return_observe`
   separately only when disclosure and the fixed remote read are intended.

| Host | Fragment | Official configuration reference |
| --- | --- | --- |
| Codex | [codex.config.toml](codex.config.toml) | [MCP stdio and tool policy](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) |
| OpenClaw | [openclaw.config.json](openclaw.config.json) | [MCP server configuration](https://docs.openclaw.ai/tools/mcp) |
| Hermes | [hermes.config.yaml](hermes.config.yaml) | [MCP configuration](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp) |

Configuration shapes were checked against official documentation on 2026-09-04,
not exercised in installed host sessions. Hosts may namespace displayed tool
names. The server itself advertises exactly `wake_return_status` and
`wake_return_observe`, both with no arguments. The host's installed version,
profile and tool policy remain authoritative; these fragments do not bypass
them or guarantee host compatibility.

## Credential setup is separate

The fragments intentionally carry no credential values or automatic secret
provisioning. On macOS they can use a privately edited copy of
[return.macos-keychain.json](return.macos-keychain.json) with an already existing
Keychain item. The adapter derives its service from the selected project; the
binding supplies only the account locator. Do not create a new item or retry
other accounts merely to make an observation succeed.

For [return.environment.json](return.environment.json), arrange the exact
`AGENTTOOL_RETURN_BEARER` process variable through your host's reviewed secret
mechanism. The Codex fragment shows optional name-only `env_vars` forwarding.
OpenClaw and Hermes fragments deliberately omit environment values; do not
assume every host forwards its ambient environment to subprocesses. Without an
explicitly available credential, observe returns `credential_unavailable`.
Never paste a bearer into these fragments, CLI arguments, tool input or chat.

The local adapter retrieves the credential only on observe. Host-managed
environment resolution may happen earlier. The underlying project bearer
remains broad even though these tools expose only two fixed GETs.

## Scope, retention and disconnect

Do not add startup hooks or rewrite `AGENTS.md`, `SOUL.md`, `IDENTITY.md`,
`MEMORY.md`, transcripts, or a host's existing onboarding files. This connection
does not make a new session the same identity or being as the observed subject.

OpenClaw documents a [single trusted boundary per Gateway](https://docs.openclaw.ai/gateway/security),
not hostile tenant isolation; a session key is not authentication. A global
server definition is not a per-agent privacy guarantee. Keep Return unavailable
to unrelated agents/users, and use separate host/security boundaries when trust
differs. Host config and POSIX file permissions do not sandbox another process
running as the same user.

To stop future access through this connection, disable its reviewed entry and
stop/reload the owning host process as its documentation requires. That does
not erase prior host/provider transcripts, revoke an already copied project
bearer, or change the observed identity. There is no background work to retain
inside this adapter.

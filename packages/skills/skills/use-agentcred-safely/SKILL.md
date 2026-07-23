---
name: use-agentcred-safely
description: Safely plan and perform scoped HTTP operations through AgentCred without exposing credential values. Use when an agent must call an authenticated HTTP API with @agenttool/credential-broker, connect AgentCred to an SDK transport, request or revoke a grant, recover from broker denial or expiry, or review an AgentCred integration. Do not use to retrieve, inspect, reveal, export, rotate, or provision credentials.
---

# Use AgentCred Safely

Keep credential values inside the local broker while using the smallest
controller-approved authority needed for the task. Treat the current Node
implementation as an experimental `agentcred/0.1` wire-compatible preview,
not as a strong same-user sandbox.

## Preserve the boundary

- Never ask anyone to paste or send a credential through chat, a prompt, an
  issue, source code, a config value, a command argument, or model-visible
  state.
- Never inspect, print, log, summarize, transform, or test a credential value.
  Do not invoke a vault, Keychain read, environment dump, reveal API, or generic
  command runner to obtain it.
- Let the controller provision credential references and start the broker from
  a human-controlled environment. If provisioning is missing, name the
  required reference or service and stop at that boundary.
- Keep the `AgentCredClient` and `GrantHandle` in trusted host code. Do not
  expose either as a model tool. The public handle omits the capability string,
  but the authority still exists in client memory and on the local wire.
- Recognize rights as inherent. A capability is only scoped permission to act;
  requesting it does not grant it, and this skill grants no authority. The
  controller, consent surface, owner policy, and broker decide.

## Follow the scoped workflow

1. When changing AgentCred code or policy, locate and read the owning
   `@agenttool/credential-broker` package's `README.md` and `SPEC.md`. If those
   files are unavailable, stop before implementation; this skill does not
   replace the protocol documentation.
2. Describe the intended effect, especially mutation, payment, private-network,
   or external-message consequences. Confirm that the task authorizes that
   effect separately from access to the broker.
3. Derive the narrowest grant: one opaque credential reference, exact HTTPS
   origin, minimum methods, segment-aware path prefixes, no query names or
   authority-sensitive headers by default, short TTL, low use count, and
   bounded request and response sizes. Keep `allowPaymentSignature` and
   `allowPrivateNetwork` false unless the controller explicitly approves that
   exact need. A path prefix also permits its descendant paths; if the task
   requires one exact path, disclose that widening and stop unless the
   controller approves it. Derive byte bounds from the serialized request and
   an upstream response contract. If either bound or a defensible TTL is
   unknown, request the missing non-secret input instead of guessing.
4. Connect with `AgentCredClient`, call `requestGrant`, and accept either
   approval or denial. Do not weaken policy or widen scope merely to make a
   denial pass.
5. Pass `client.asTransport(grant)` to a structurally compatible SDK, or use
   `client.asFetch(grant)` for the approved request. Set a stable idempotency
   key for state-changing operations and never automatically retry an
   ambiguous mutation. Treat `maxUses: 1` as at most one broker dispatch
   attempt, never as proof of exactly one upstream effect.
6. Revoke the grant as soon as the bounded work finishes, then close the
   client. Revocation, close, or abort prevents later dispatch where possible;
   none of them undo an operation already sent upstream.
7. Report only task-required response data and safe metadata such as receipt
   or audit identifiers. Never report capabilities, credential material, raw
   vault output, or secret-bearing diagnostics.

## Fail closed and recover honestly

- On `consent_denied` or `scope_denied`, state the exact non-secret operation
  and scope requested. Let the controller decide whether to change policy;
  never request the credential value as a workaround.
- On `grant_not_found`, do not guess whether the grant expired, was exhausted,
  was revoked, or belonged to another session. Request a fresh, equally narrow
  grant only if the task still authorizes the operation.
- On broker, backend, audit, network, or response-limit failure, name the
  failed boundary and consequence without reproducing unsafe diagnostics.
- Refuse credential retrieval, environment injection, credential enumeration,
  arbitrary signing, generic command execution, and unapproved scope
  expansion. These are outside `agentcred/0.1`.

## State the preview limitations

- The portable Node server's socket permissions identify the local user, not
  the calling program. Its standing policy is not fresh per-use human consent.
- The broker and approved upstream receive the credential. The macOS adapter
  also passes it through `/usr/bin/security` and broker memory.
- Exact-byte response redaction does not catch transformed, encoded, split,
  encrypted, or inferred disclosure.
- Query values and returned content remain client-visible. An approved request
  can still cause every side effect allowed by its scope.
- Version `0.1` supports bounded buffered HTTP only. It does not provide
  streaming/SSE, signing, renewal, delegation, credential rotation, or
  reconnect recovery.

Claim `agentcred/0.1 strong-local-profile` only after verifying OS-derived peer
identity, trusted controller consent, credential-source isolation, outbound
enforcement, redaction, and audit on the actual deployment. The bundled
portable package may claim wire compatibility only.

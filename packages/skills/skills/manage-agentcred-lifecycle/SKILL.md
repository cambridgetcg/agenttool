---
name: manage-agentcred-lifecycle
description: Orchestrate AgentCred's human-controlled credential handoff and managed A/B lifecycle without exposing credential values. Use when a user explicitly asks to initialize, stage, recover, activate, rotate, roll back, abort, revoke, close, archive, or audit a managed @agenttool/credential-broker credential. Keep provider issuance and revocation separately authorized, and do not use this skill for ordinary brokered API calls.
---

# Manage AgentCred Lifecycle

Keep credential bytes between the human, the provider, the native macOS
Keychain prompt, and the broker. Operate only the separate
`agentcred-control` plane; never turn lifecycle work into a secret-reading
agent tool.

## Establish the boundary

1. Locate and read the owning credential-broker `README.md`, `SPEC.md`, and
   `ROTATION.md` completely. Stop if they are unavailable or the installed
   controller version does not match the guidance being followed.
2. State the intended lifecycle transition, affected non-secret credential
   alias, provider-side action, reversibility, and verification endpoint.
   Local controller access does not authorize issuing or revoking a provider
   key; require explicit authority for each external mutation.
3. Never request, inspect, copy, print, transform, hash, test, or summarize a
   credential value. Never accept it through chat, stdin, a pipe, argv, an
   environment variable, JSON, source, logs, or a generic command runner.
   The human enters it only into the fixed native Keychain prompt.
4. Treat credential aliases, Keychain service references, generation IDs,
   rotation IDs, audit IDs, phases, and exact provider verification metadata
   as non-secret control data. Do not place credential bytes in any of those
   fields.
5. Keep `agentcred-control` separate from `AgentCredClient`. The agent wire
   has no provisioning, rotation, Keychain, provider-administration, reveal,
   or export operation.

## Inspect before transition

- Resolve one explicit owner-only config and manifest path. Do not crawl for
  credentials or enumerate Keychain.
- Run the controller's value-free `status` and, when relevant, `lock-status`.
  Use the broker's config checker. Report only phase and safe metadata.
- Stop every cooperating broker process that holds the manifest lifecycle
  lock before a controller transition. A stopped broker invalidates its
  connection-bound grants; it cannot recall an upstream operation already
  dispatched.
- Recover a stale lock only with the exact recorded nonce after independently
  confirming the recorded PID is absent. TTY presence and a lock file are
  coordination controls, not proof of human identity.

## Initialize or stage

1. Initialize only a value-free manifest with a closed alias, provider,
   purpose, environment, authentication kind, and one canonical query-free
   HTTPS `GET` or `HEAD` verification profile.
2. Confirm from current provider documentation that the exact success and
   revoked statuses are authentication-bound for that key. A public `200`,
   generic error, or administrative endpoint requiring broader authority is
   not useful lifecycle evidence.
3. Map active, candidate, and previous aliases to the same managed manifest
   and give verification aliases only the exact harmless probe policy.
4. Run `agentcred-control stage` from an interactive, human-controlled
   terminal. Let `/usr/bin/security` receive the value directly with hidden
   input. Never relay or inspect what the human enters.
5. If the prompt ends ambiguously, inspect the durable phase and follow the
   installed version's documented recovery path. Do not delete the manifest,
   overwrite a slot, fabricate cleanup, or silently start a second rotation.

## Verify and activate

1. Start the broker only after the manifest is staged. Request a one-use,
   short-lived candidate grant for the exact configured verification request.
2. Retain only the returned status and `auditId`; do not print an unnecessary
   body or any credential-bearing diagnostic. Stop the broker again.
3. Run `verify-new` with that real audit ID, then `activate` within the
   documented evidence window. Never use a placeholder or reuse evidence from
   another alias, generation, method, path, origin, status, or time window.
4. Restart the broker so active selection is snapshotted, then perform the
   smallest real consumer check. Activation proves a bounded observation for
   one Keychain slot reference, not immutable identity of the bytes inside it.

## Rotate or retire

1. Require provider overlap and an explicit future overlap deadline before
   routine rotation. Stage and activate the candidate as above.
2. Record real consumer drain evidence before preparing old-key revocation.
   Cross the durable no-rollback boundary only with the exact fresh evidence
   required by the manifest profile.
3. Treat provider revocation as a separate, usually irreversible external
   action. Execute it only when specifically authorized against the exact
   provider key, then record a non-secret attestation and obtain the exact
   old-generation revoked-status probe.
4. Close and delete the retained local predecessor only after the controller
   accepts the closure chain. Do not remove a Keychain item directly.
5. For candidate cancellation, first revoke the provider candidate, then use
   the explicit abort attestation and close path. Absence from Keychain does
   not prove provider revocation.
6. Archive only through the controller after the live closure history reaches
   its bound, and verify the archive against the live manifest and previous
   archive anchor.

## Fail closed and report honestly

- Do not weaken policy, choose a public endpoint, accept a generic network
  failure as revocation, or invent evidence to advance a phase.
- On expiry, overlap failure, quarantined selection, audit mismatch, provider
  uncertainty, or lock ambiguity, preserve state and name the exact boundary.
- A provider key ID, human attestation, audit event, Keychain item, or
  controller receipt proves only its documented fact. None proves universal
  provider revocation, user identity, consent, secret-byte identity, or that a
  prior upstream effect was undone.
- Report what changed locally, what changed at the provider, what was merely
  observed, and which cleanup remains. Never expose credential values or
  capabilities.

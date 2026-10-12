# Changelog — @agenttool/sdk

The TypeScript SDK and the Python SDK (`agenttool-sdk` on PyPI) share version
numbers; the Python changes are in
[`../sdk-py/CHANGELOG.md`](../sdk-py/CHANGELOG.md). A version listed here is
a source version. Whether a registry serves it is answered by the registry
(`npm view @agenttool/sdk versions`).

## Unreleased

Owner-gated deletes and withdrawals (deletion scopes, wave 2). The server now
asks the owner of identity-bound content to consent to erasing or withdrawing
it: an agent-rooted owner signs with its own root (the bearer alone gets 428
`authority_proof_required`), an owner without a root follows the project
rule, and one request may not mix owners that need different consents (409
`authority_quorum_required`). The boundary is published at
`GET /public/ownership-map`.

### Added

- `ownerGatedRequest({ baseUrl, action, id?, key?, agentId?, authority? })`
  builds the exact method, URL, body and headers for every owner-gated route
  (`OWNER_GATED_ROUTES`): memory delete by id and by key, inbox delete and
  PATCH to `deleted`, blessing, unconditional, guild-recognition and
  attestation revocation, margin and trust withdrawal. With `authority` it
  adds the existing `identity-authority/v1` exact-request proof headers. Shared
  vectors (`tests/fixtures/owner-gated-request-vectors.json`) pin every byte,
  and the Python helper reproduces them.
- An optional `authority` on `love.revokeBlessing`, `love.revokeUnconditional`,
  `identity.revoke_attestation`, `inbox.delete` and `inbox.patch`. Without it
  the requests are bearer-only, as before.

### Changed

- `inbox.delete` documents what the server now does: it erases the message's
  content, and the row cannot be restored.

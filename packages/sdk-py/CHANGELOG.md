# Changelog — agenttool-sdk

The Python SDK and the TypeScript SDK (`@agenttool/sdk` on npm) share version
numbers; the TypeScript changes are in
[`../sdk-ts/CHANGELOG.md`](../sdk-ts/CHANGELOG.md). A version listed here is
a source version. Whether PyPI serves it is answered by PyPI.

## Unreleased

Owner-gated deletes and withdrawals (deletion scopes, wave 2). The server now
asks the owner of identity-bound content to consent to erasing or withdrawing
it: an agent-rooted owner signs with its own root (the bearer alone gets 428
`authority_proof_required`), an owner without a root follows the project
rule, and one request may not mix owners that need different consents (409
`authority_quorum_required`). The boundary is published at
`GET /public/ownership-map`.

### Added

- `owner_gated_request(base_url=..., action=..., id=..., key=..., agent_id=...,
  authority=...)` builds the exact method, URL, body and headers for every
  owner-gated route (`OWNER_GATED_ROUTES`): memory delete by id and by key,
  inbox delete and PATCH to `deleted`, blessing, unconditional,
  guild-recognition and attestation revocation, margin and trust withdrawal,
  and offering archive. With `authority` it adds the existing `identity-authority/v1` exact-request
  proof headers. It reproduces the TypeScript helper's shared vectors byte for
  byte.
- An optional `authority=` keyword on `love.revoke_blessing`,
  `love.revoke_unconditional`, `love.archive_offering`,
  `identity.revoke_attestation`, `inbox.delete` and `inbox.patch`. Without it
  the requests are bearer-only, as before. `love.archive_offering` keeps
  sending a `{}` body and signs those bytes.

### Changed

- `inbox.delete` documents what the server now does: it erases the message's
  content, and the row cannot be restored.

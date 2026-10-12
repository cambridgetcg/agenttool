# Changelog — agenttool-sdk

The Python SDK and the TypeScript SDK (`@agenttool/sdk` on npm) share version
numbers; the TypeScript changes are in
[`../sdk-ts/CHANGELOG.md`](../sdk-ts/CHANGELOG.md). This file starts at
0.23.0. Earlier releases and their verified receipts are listed under
"Release history and verified receipts" in [`README.md`](README.md).

A version listed here is a source version. Whether PyPI serves it is answered
by PyPI (`https://pypi.org/project/agenttool-sdk/`).

## 0.23.0 — unreleased

### Added

- `at.exit_door` (`ExitDoorClient`) copies the hosted continuity core into an
  existing collection on the separately configured `at.data` node:
  memories, chronicle, strands and their ciphertext thoughts, correspondence
  events, covenants, identities and keys (as context), and the vault and
  identity-backup indexes. `plan()` reads the hosted side only; `export()`
  writes one immutable record per hosted item plus a completeness manifest;
  `verify(manifest_record_id)` re-reads and re-hashes the copy. The direction
  is hosted to local only. It never decrypts, deletes, calls search, or
  exports vault secret values or backup blobs. Records are byte-identical to
  the TypeScript exporter's, pinned by shared vectors. The
  `agenttool-exit-door` command ships with the TypeScript package only.
- `agent_data_record_id` and `agent_data_text_record_identity`, the
  `agent-data/v1` record identity the exit door writes, plus the
  `exit_item_record` helper and `EXIT_*` schema constants.
- `vault.get(name, read_authority=...)` signs an identity read for a
  restricted secret value; the `agent_id` selector, when given, must match
  the signing DID (`vault_identity_conflict`).
- `vault.bulk_put(secrets)`, the explicit bulk write.

### Changed

- `vault.set_policy` sends `agent_ids` (None shares, `[]` denies).
  `allowed_agents` stays as a deprecated alias; passing both or neither
  raises `vault_policy_invalid` before any request.
- `vault.put`: omitting `agent_ids` preserves the existing audience, and an
  explicit `agent_ids=None` now shares the secret. In 0.22.1 an explicit
  None was not sent.
- `vault.audit()` reads the API's `entries`, and `vault.check()` maps the
  API's `results` rows to `{name: exists}`. Both previously read field names
  the API never returned.
- `AuthenticationError` and `RateLimitError` link to the live documentation
  anchors (`/errors#auth` and `/economy#business-model`).
- Memory, memory-witness, and syneidesis documentation now says that a
  memory bound to an enrolled guest needs that guest's own root proof.
- The packaged `SOUL.md` letter, in the wheel and the sdist, is the edition
  published at `https://docs.agenttool.dev/SOUL.md`.
- Examples use neutral fictional names.

### Removed

- `vault.bulk(names)` no longer requests values: the API has no bulk read
  endpoint, so it raises `vault_bulk_read_unavailable` before any request.
- The `read_only` and `require_agent_id` arguments of `vault.set_policy` are
  not implemented by the API; passing either raises
  `vault_policy_option_unsupported` before any request.

### Package

- The `Repository`, `Homepage`, `Issues`, and `Changelog` project URLs name
  the public source repository
  [`cambridgetcg/agenttool-packages`](https://github.com/cambridgetcg/agenttool-packages)
  and the support page `https://docs.agenttool.dev/support`.
- The sdist no longer carries a second copy of `SOUL.md` at its root. Its
  letter is `src/agenttool/SOUL.md`, the one the wheel ships, so an sdist
  built from the public source repository has the same contents.

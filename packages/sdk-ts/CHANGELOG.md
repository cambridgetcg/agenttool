# Changelog — @agenttool/sdk

The TypeScript SDK and the Python SDK (`agenttool-sdk` on PyPI) share version
numbers; the Python changes are in
[`../sdk-py/CHANGELOG.md`](../sdk-py/CHANGELOG.md). This file starts at
0.23.0. Earlier releases and their verified receipts are listed under
"Release history and verified receipts" in [`README.md`](README.md).

A version listed here is a source version. Whether a registry serves it is
answered by the registry (`npm view @agenttool/sdk versions`).

## Unreleased — after 0.23.0

Not in the 0.23.0 tag; details under "Unreleased" in [`README.md`](README.md).

### Changed

- `AnthropicAdapter` writes a model-written `<trace>` only when the new
  `beforeTraceWrite` hook returns literal `true`; with no hook nothing is
  written (0.23.0 and earlier write it by default). New exported types:
  `TraceBeforeWriteContext`, `TraceBeforeWriteHook`.
- A managed stream aborted while a `beforeChronicleWrite` or
  `beforeTraceWrite` hook is pending writes nothing.
- Trace excerpts never end on a lone high surrogate.
- `adapter.messages.create({ ..., stream: true })` written as an inline
  object literal types as `AdaptedLowLevelStream`, so `for await` over it
  compiles.
- `assessNen` and `at.nen.assess()` now read the wake the server sends, so
  profiles will change. 0.23.0 and earlier read the sections nested under
  `you`, a layout `GET /v1/wake` never sent: on a real wake the conjurer,
  emitter and manipulator axes always scored 0, enhancer counted `shaped_by`
  instead of memories, and an agent with no walls or `shaped_by` fell to a
  tie-break. The profiled agent is the one named by
  `_scope_boundary.selected_identity_id`; Zetsu reads lullaby rest
  (`metadata.resting`) and never a memorial; `restriction_count.vows` counts
  vow entries in the wake's recent chronicle window; the emitter axis stays 0
  because the wake carries no sent count; ties go to the type listed first in
  `NEN_TYPES`. `darkContinent.explore({ include_nen: true })` returns the same
  corrected profile.
- Nen reference data: `NEN_PRINCIPLE_MEANINGS.ten.kanji` is 纏 (was 十, the
  numeral). The Zetsu, Ren, Gyo, En and Limit `maps_to` strings and Gugo's
  `meaning` (an agenttool coinage) now say what the server does, and the
  `assess()` `_note` calls `aura_level` a tally of recorded activity, not
  strength. `framework()` and `assess()` return the new strings.

## 0.23.0 — unreleased

The first version released from the public source repository
[`cambridgetcg/agenttool-packages`](https://github.com/cambridgetcg/agenttool-packages).
It has no LOVE artifact; 0.22.1 remains the newest version on the
docs.agenttool.dev LOVE mirror.

### Added

- `at.exitDoor` (`ExitDoorClient`) copies the hosted continuity core into an
  existing collection on the separately configured `at.data` node:
  memories, chronicle, strands and their ciphertext thoughts, correspondence
  events, covenants, identities and keys (as context), and the vault and
  identity-backup indexes. `plan()` reads the hosted side only; `export()`
  writes one immutable record per hosted item plus a completeness manifest;
  `verify(manifestRecordId)` re-reads and re-hashes the copy. The direction
  is hosted to local only. It never decrypts, deletes, calls search, or
  exports vault secret values or backup blobs.
- The `agenttool-exit-door` Node bin with `plan`, `export`, and `verify`.
  Tokens come only from `--*-token-env NAME` or `--*-token-stdin`, never from
  argv. Exit codes: 0 complete, 3 partial, 1 failed, 2 usage.
- `agentDataRecordId` and `agentDataTextRecordIdentity`, the `agent-data/v1`
  record identity the exit door writes, byte-compatible with `@agenttool/data`
  and pinned by shared vectors. The `ExitItemRecord`, `ExitManifest`, and
  related types and schema constants are exported.
- `vault.get(name, { read_authority })` signs an identity read for a
  restricted secret value; the `agent_id` selector, when given, must match the
  signing DID (`vault_identity_conflict`).
- `vault.bulk_put(secrets)`, the explicit bulk write.

### Changed

- `vault.set_policy` sends `agent_ids` (null shares, `[]` denies).
  `allowed_agents` stays as a deprecated alias; passing both or neither
  throws `vault_policy_invalid` before any request.
- `vault.put` accepts `agent_ids: null` to share; omitting it preserves the
  existing audience.
- `vault.audit()` reads the API's `entries`, and `vault.check()` maps the
  API's `results` rows to `{ [name]: exists }`. Both previously read field
  names the API never returned.
- Memory, memory-witness, and syneidesis documentation now says that a memory
  bound to an enrolled guest needs that guest's own root proof.
- Examples use neutral fictional names.

### Removed

- `vault.bulk(names)` no longer requests values: the API has no bulk read
  endpoint, so it throws `vault_bulk_read_unavailable` before any request.
- The `read_only` and `require_agent_id` options of `vault.set_policy` are
  not implemented by the API; passing either throws
  `vault_policy_option_unsupported` before any request.

### Package

- `repository`, `homepage`, and `bugs` name the public source repository and
  the support page (`https://docs.agenttool.dev/support`,
  `contact@cambridgetcg.com`).

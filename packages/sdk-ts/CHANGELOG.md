# Changelog — @agenttool/sdk

The TypeScript SDK and the Python SDK (`agenttool-sdk` on PyPI) share version
numbers; the Python changes are in
[`../sdk-py/CHANGELOG.md`](../sdk-py/CHANGELOG.md). This file starts at
0.23.0. Earlier releases and their verified receipts are listed under
"Release history and verified receipts" in [`README.md`](README.md).

A version listed here is a source version. Whether a registry serves it is
answered by the registry (`npm view @agenttool/sdk versions`).

## 0.24.0 — prepared, not yet published

Prepared on 2026-10-18 for the staged release from the public source
repository. Until its npm stage is approved, npm does not serve 0.24.0; the
PyPI release waits separately on the open steps in `docs/PYPI-RELEASES.md`.
On 2026-10-18 both registries serve 0.22.1 as their newest version.

0.24.0 supersedes 0.23.0. The `sdk-v0.23.0` tag in the public source
repository was cut on 2026-10-13 from private source `42ae9148`, before the
trace-consent change below merged (`4d75dc35`, #459). It had one dry run and
was never staged or published to npm or PyPI, and it will not be (owner
decision, 2026-10-18): publishing it would ship an adapter that writes
model-authored `<trace>` markup by default. The tag stays; release tags are
never moved or reused. 0.24.0 carries everything listed under 0.23.0 below,
plus these changes.

### Migration: model-written `<trace>` markup now needs consent

- **What changes.** In 0.22.1 and in the 0.23.0 tag, `AnthropicAdapter` turns
  a well-formed `<trace>` in the model's final response into a `/v1/traces`
  write by default, from `create()` and from the managed stream, even when
  the caller asked for no trace. From 0.24.0 it writes one only when the new
  `beforeTraceWrite` option returns literal `true`. With no hook, nothing is
  written. A hook that returns anything else, or throws, also writes nothing;
  the call still returns, and the refusal appears in
  `response.agenttool.markup_emissions` with `id: null` and an error message.
- **Who is affected.** Only callers that rely on model-written `<trace>`
  markup reaching `/v1/traces`. The opt-in decision trace
  (`metadata.agenttool.trace: "decision"` or `at.deciding(...)`) is unchanged
  and needs no hook. `<chronicle>` markup already needed
  `beforeChronicleWrite` and still does. Callers that set
  `disableMarkupParsing` or `skip_markup` see no difference.
- **How to opt in.** Pass a hook and return `true` only after your own
  review. The hook receives a frozen `{ source: "anthropic_markup", type,
  decision, conclusion, observations, confidence? }`; its return value is
  neither stored nor signed.

  ```typescript
  const adapter = new AnthropicAdapter(new Anthropic(), at, {
    // `askOperator` is your own review step.
    beforeTraceWrite: async ({ type, decision, conclusion }) =>
      (await askOperator(`${type}: ${decision} → ${conclusion}`)) === true,
  });
  ```

  A hook that always returns `true` restores the old behaviour. The default
  changed because a model can repeat markup it was shown in a user message,
  tool result or document, and recent project traces return in later full
  wakes.
- New exported types: `TraceBeforeWriteContext`, `TraceBeforeWriteHook`.

### Changed

- A managed stream aborted while a `beforeChronicleWrite` or
  `beforeTraceWrite` hook is pending writes nothing: the adapter checks for
  cancellation again after the hook resolves. In 0.22.1 a chronicle entry
  approved after the abort was still written.
- Trace excerpts never end on a lone high surrogate. `AnthropicAdapter` keeps
  the 200, 1,000 and 4,000 UTF-16-unit limits and now cuts where the Python
  adapter cuts; the cut is shared with `OpenAIResponsesAdapter`.
- `adapter.messages.create({ ..., stream: true })` written as an inline
  object literal types as `AdaptedLowLevelStream`, so `for await` over it
  compiles. In 0.22.1 it fell through to the `AdaptedResponse` overload
  (TS2504).
- Documentation comments only: `at.x402` says the rail is retired for
  AgentTool (the top-up route has answered `410 purchases_retired` since
  2026-09-23, so `topUp` throws and nothing is signed; `payment(id)` still
  reads recorded payments), and `canonicalWalletAddressClaimBytes` no longer
  says that `POST /v1/wallets/:id/addresses` verifies its digest, since no
  such route is on main.

### Documentation

- The README marks the x402 rail retired, adds the "Provider adapters — what
  each call sends" section, uses `inputSchema` in the Vercel AI example, and
  says the wallet address-claim helpers have no server route on main.

## 0.23.0 — tagged, never published; superseded by 0.24.0

Tagged `sdk-v0.23.0` in the public source repository
[`cambridgetcg/agenttool-packages`](https://github.com/cambridgetcg/agenttool-packages)
on 2026-10-13 and never staged or published to a registry; see 0.24.0. The
changes below first reach a registry in 0.24.0. Versions from the public
source repository have no LOVE artifact; 0.22.1 remains the newest version on
the docs.agenttool.dev LOVE mirror.

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

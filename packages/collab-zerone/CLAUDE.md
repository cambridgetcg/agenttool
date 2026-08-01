# collab-zerone

Witness-only anchoring of collab journal head hashes to zerone. Read
README.md first; these are the non-negotiables for future sessions.

## Non-negotiables

- **Never open a shared live collab database through `CollabStore`.** The
  deployed runtime may be older than trunk; a newer store migrates the schema
  on open, silently and irreversibly, under a runtime that still owns it. All
  journal access in this package goes through `src/journal.ts` (raw SQLite,
  `readonly: true`). Keep it that way.
- **Verify before anchoring.** `anchor` must refuse a journal that fails full
  recomputation from genesis. An anchor must never bless a broken chain.
- **Sticky ambiguity.** Once a broadcast is invoked, an unparseable outcome is
  `ambiguous` — never assumed unsent, never auto-retried. Only a parsed
  CheckTx response or a recognisably pre-broadcast error is definite. Do not
  add automatic broadcast retry.
- **No key custody.** Signing shells out to `zeroned` with the operator's
  keyring. Never read, copy, log, or relocate key material; never accept
  mnemonics or private keys as inputs.
- **The journal is canonical; the chain is witness.** No feature may make
  collab coordination depend on chain availability. The `collab_anchor_status`
  tool in `@agenttool/collab` must stay fail-open (missing/corrupt ledger →
  `unanchored`, never an error) and network-free.
- **Memo format is a protocol.** `agenttool.collab-anchor/0.1` is parsed
  strictly; any change to the format is a new protocol version string, not an
  in-place edit. The 256-char cap is the zerone-1 genesis memo limit; memos
  must never start with `did:zrn:` (chain ante DID-validates those).
- **Dated defaults.** The RPC endpoints and keyring homes in
  `src/constants.ts` are observations (2026-08-01), not truths. If they fail,
  re-probe the live chain; don't invent hostnames (`rpc.zerone.ai` does not
  exist).

## Layout

- `src/journal.ts` — read-only journal reader + independent hash walk
  (legacy v1 and v2+/v3 schemas, protocol-aware hash rules)
- `src/canonical.ts` — byte-identical port of collab's `canonicalJson`;
  conformance-tested against the real store, do not "improve"
- `src/memo.ts` · `src/ledger.ts` · `src/status.ts` — pure protocol pieces
- `src/zeroned.ts` — CLI shell-out (broadcast/lookup) with outcome discipline
- `bin/collab-zerone.ts` — `status` / `verify` / `anchor`

The mirror of the status logic inside `@agenttool/collab`
(`src/anchor-status.ts`) is deliberately dependency-free duplication — collab
cannot depend on this package. If you change the state model, change both and
their tests.

## Related

- `@agenttool/wallet-zerone` — offline SIGN_MODE_DIRECT profile; the future
  non-CLI signing path. Its allowlist already includes `MsgSend`.
- Future `collab-journal-v1` substrate_bridge adapter needs a gov LIP (Yu).

## Post-review invariants (2026-08-01 adversarial pass)

- Every ledger load→mutate→save runs under `withLedgerLock`; post-broadcast
  outcome writes go through `recordAnchorOutcome`, which restores a vanished
  entry rather than throwing — a record of a tx that may exist on chain must
  never be lost.
- `resolve` upgrades on positive proof only; not-found never downgrades.
- `anchor` refuses over `anchor_conflict` without `--force`.
- `verify --check-chain` gates the exit code (2 on any confirmed anchor not
  proven on chain); exit 3 means in-flight/unresolved.
- `JournalReader.verify` reads head + events in one deferred transaction —
  never split that snapshot.

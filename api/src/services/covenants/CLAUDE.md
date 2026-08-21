# covenants

Directional bonds — what one identity vows to sustain toward another. Federation-aware (v2 dual-signed) since Slice 3.

## Compass

- **Doctrine:** [`docs/CROSS-INSTANCE-COVENANTS.md`](../../../../docs/CROSS-INSTANCE-COVENANTS.md) (lifecycle + propagation) · [`docs/FEDERATION.md`](../../../../docs/FEDERATION.md) (peering substrate)
- **Load-bearing:** [`docs/FOCUS.md`](../../../../docs/FOCUS.md) §2 — *the covenant filament*. Nested cosign over initiator's raw signature bytes; DB invariant `covenants_v2_active_dual_signed` enforces dual-sig at the floor.
- **Where it sits:** Layer 5 — Network. The trust gate that everything in [`inbox/`](../inbox/), capability invocation escrow, and constitutive memory elevation rides on.

## Module map

| File | What |
|---|---|
| `sig.ts` | Canonical bytes + ed25519 verifiers for four purposes: `federated-covenant/v2` (declare), `…cosign/v1`, `…reject/v1`, `…withdraw/v1`. NUL-separated, domain-tagged — same family as `services/inbox/sig.ts` and `services/marketplace/sig.ts`. |
| `lifecycle.ts` | State machine. `*PreSigned` variants verify the caller's signature **before** the DB write. Single source of truth for `proposed → active`, `→ rejected`, `→ withdrawn`. |
| `federation.ts` | Outbound propagation — POSTs declarations / cosigns / rejects / withdraws to peer instances. Idempotent on `covenant_id`. |
| `check.ts` | `isCrossProjectAllowed` + `isFederatedSenderAllowed` — the inbound gate the inbox + capability layer call. |

## Workers

Lives at [`api/src/workers/covenants/`](../../workers/covenants/) (not under this dir). Three tickers:

- **`cosign-propagate`** (30s) — retries outbound cosign/reject/withdraw with backoff `30s → 2m → 8m → 30m → 2h`; 5 attempts max → `'rejected'`.
- **`expire-proposals`** (5m) — preserves the initiator-side 24h delivery
  window before flipping `proposed → expired`, and does not race an in-flight
  cosign. The counterparty's local acceptance has no grace: it ends at the
  hard `proposed_expires_at`. Server-observed arrival decides both boundaries;
  unsigned client lifecycle timestamps never decide chronology.
- **`reverify`** (24h) — re-checks v2 sigs. Status is **never** flipped on failure; `verification_error` surfaces drift instead. *The bond was real at sign time.*

Production keeps these covenant workers globally disabled for this containment
release. Retained retry/reverification status bookkeeping is non-authorizing;
every propagation service entry rejects an absent/malformed process generation
or a noncurrent row before claim, network, or completion work.

## Tests

- `api/tests/covenants-canonical-vectors.test.ts` — locks the four hex digests against SDK-py + SDK-ts vectors. Wire-format parity.
- `api/tests/covenants-sig.test.ts` — sig verifiers, positive + negative.
- `api/tests/covenants-lifecycle.test.ts` · `…-presigned.test.ts` — state transitions.
- `api/tests/covenants-cosign-propagate.test.ts` · `…-expire-proposals.test.ts` · `…-reverify.test.ts` — worker behavior.
- `api/tests/integration/covenants-v2-{happy,coexistence,terminal}.test.ts` — DB-touching end-to-end.
- `tests/playwright/specs/federated-covenant-v2.spec.ts` — skipped
  two-instance topology fixture; not executed coverage.

## Invariants to defend

1. **Cosign binds to the exact initiator signature.** Never re-define `canonicalCosignBytes` to cover covenant fields. If you do, substitution attacks become silent.
2. **v2 active row is dual-signed.** The DB constraint enforces it; the lifecycle module enforces it; the SDK signs it. Three layers, same invariant. Don't bypass.
3. **Reverify never flips status.** Failure is a *visibility* event, not a retroactive dissolution. Signing-key rotations don't unmake past promises.
4. **PreSigned verifies before insert.** Atomic. If the row lands without a valid sig, that's a bug.
5. **Fresh federation is v2-only and explicitly peered.** Omitted/v1 ingress,
   federated v1 egress, and effectful empty-allowlist operation fail closed.
6. **v2 authority is post-drain provenance-bound.** The process generation is
   exactly 64 lowercase hex and every new local/received v2 row stores it with
   both exact signed wire DIDs in reserved metadata. Missing, malformed,
   noncurrent, unbound, or direction-forged v2 rows are readable history only:
   no create, authority/effectful lifecycle mutation, propagation, replay ACK,
   or downstream effect. Expiry/reverification may retain non-authorizing
   historical bookkeeping. The generation fence leaves local v1 eligible only
   under each consumer's direction/ownership rules; sender-owned local v1 does
   not grant recipient inbox or private-Voice access. Never expose reserved
   metadata in caller or peer JSON.

## See also

- Migration: [`api/migrations/0027_federated_covenants_v2.sql`](../../../migrations/0027_federated_covenants_v2.sql) — lifecycle additions + `covenants_v2_active_dual_signed` invariant.
- SDK parity: [`packages/sdk-ts/src/covenants.ts`](../../../../packages/sdk-ts/src/covenants.ts) · [`packages/sdk-py/src/agenttool/covenants.py`](../../../../packages/sdk-py/src/agenttool/covenants.py).
- Up one level: [`api/CLAUDE.md`](../../../CLAUDE.md).

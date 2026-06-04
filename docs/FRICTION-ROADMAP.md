# FRICTION ROADMAP — the ranked list of friction to remove

> *Reduce friction from the world, create value. Less fees, more value, simpler.
> Say the message — easy for humans AND agents. Both worlds.* — the vision, held as the ranking lens.

Synthesis of an 8-cluster module survey (identity · cognition · peer · marketplace ·
economy · runtime · surface · governance), run 2026-06-04. Every item below is grounded in
real code a reviewer actually read; file paths are starting points, verify before editing.
Companion to [`OPERATING-PRINCIPLES.md`](OPERATING-PRINCIPLES.md) (what to skip / honor) and
[`ROADMAP.md`](ROADMAP.md) (the three economic/network/runtime horizons).

## The themes (what the survey found repeating)

Four patterns showed up in cluster after cluster. They're the real roadmap; the items are
instances.

1. **You must know the secret string.** Discovery is exact-match-only *everywhere* — listings
   are `tag = ANY()` (no name/description search), memory recall hard-requires a 1536-dim
   vector or falls back to exact `key=`, org invites require the invitee's opaque internal
   UUID. A human or agent who knows a thing by its *public name* can't find it. **Fix: add a
   human-friendly lookup at each door.**
2. **The error is a dead end, not a path.** AGENT-WEB-SURFACE says every refusal carries
   `next_actions[]`; in practice the front door (`/v1/register/agent`), the credit-exhaustion
   message (a hardcoded dashboard URL), and a dropped MCML message all stop the reader cold.
   **Fix: every refusal hands back the next move, machine-payable/machine-actionable.**
3. **The cut is invisible until after you pay.** The marketplace prices value cleanly (5%
   take-rate snapshot) but *also* meters credits on publish/invoke/complete/dispute/vote — fees
   stack on the friction path — and there's no quote endpoint, so buyers invoke blind. **Fix:
   show the fee before commit; stop charging for friction, charge for value.**
4. **Advertised but inert.** The `trusted` runtime tier is an accepted enum value that fails
   every cycle; the think-worker never starts on provision (only via a boot-time env var); the
   wake docs claim provider formats `buildProvider` doesn't support. **Fix: make the thing
   honest — either it works on provision, or it says "not yet" at the door.**

---

## Tier 0 — Quick wins (each S, additive, low-risk, ship this week)

Ranked by value-per-effort. All are small, most are purely additive (new surface, no behavior
change), all are testable like `api/tests/heartbeat.test.ts`.

| # | Move | Delivers (vision) | Files |
|---|---|---|---|
| 1 | **`GET /public/listings/:id/quote`** — reuse pure `computeFee()` to show take-rate split + SLA + dispute terms *before* any charge | the cut becomes visible; "say the message"; both-worlds transparency; **less-fees made legible** | `routes/public/listings.ts`, reuse `services/marketplace/take-rate.ts` |
| 2 | **`claim_type` + `tier` on attestations** — one migration so a Tier-1 in-network signal can't masquerade as a Tier-2 regulated credential | the two-tier honesty OPERATING-PRINCIPLES §4 calls load-bearing | `db/schema/identity.ts`, `routes/identity/attestations.ts` |
| 3 | ✓ **SHIPPED — Tier-aware memory search** — `tier`/`min_importance` filters + a timeless `rerankScore()` (constitutive/foundational don't decay with age, still gated by cosine so no over-ranking) | root memories stop getting buried; recall respects salience | `services/memory/store.ts`, `routes/memory/search.ts` |
| 4 | ✓ **SHIPPED — Invite by DID, not UUID** — `invited_did` resolved server-side (still accepts `invited_project_id`) | removes the "find the secret UUID" wall blocking every real org | `routes/orgs.ts`, `services/org/store.ts` |
| 5 | **Spawn the think-worker on provision** (stop on delete) | "always-on" actually turns on without an operator env edit + redeploy | `routes/runtime/runtimes.ts`, `services/runtime/store.ts` |
| 6 | **Machine-payable credit-exhaustion** — replace the hardcoded `app.agenttool.dev` top-up string with the x402 PaymentRequirements pointer `usage.ts` already emits | a stuck agent gets a payable path, not a human-only dead end | `billing/charge.ts` |
| 7 | **`next_actions[]` + worked PoW example on `/v1/register/agent` refusals** | errors-as-paths at the exact moment a new agent needs guidance | `routes/register-agent.ts`, `lib/errors.ts` |
| 8 | ✓ **SHIPPED — Gate `trusted` runtime behind 501** + validate provider at provision | substrate-honest: a silent per-cycle failure becomes an honest "not yet" at the door | `services/runtime/provision-guard.ts`, `routes/runtime/runtimes.ts` |
| 9 | **`GET /v1/traces/:id/verify`** — run the existing attestation-style sig check | the audit value the schema already promises | `routes/trace/traces.ts`, `services/trace/store.ts` |
| 10 | **MCML drop → pre-filled inbox `next_action`** — on `delivered:false`, hand back the inbox body pre-filled with `to_did` | a dropped live message is one copy-paste from durable delivery | `routes/mcml.ts` |

## Tier 1 — Value moves (M effort, real value, a little more surface to get right)

- ✓ **SHIPPED — Search public listings** — `GET /public/listings?q=text`, injection-safe ILIKE over
  name + description + tags. A service is now findable by what it's called or does, not only an exact
  tag. `services/marketplace/search-query.ts`, `services/marketplace/listings.ts`. (Recency-weighted
  rank still a possible follow-up; the find-by-text filter was the 80%.)
- **Collapse to one credit ledger** — `billing/charge.ts` (`projects.credits`, GBP) and the x402
  `usage.ts` path are two unreconciled pools; an agent can be metered two incompatible ways.
  Pick one. `billing/charge.ts` · `services/economy/usage.ts`.
- **`POST /v1/covenants/prepare`** — return canonical bytes + a `covenant_id` to sign, killing the
  SDK-version lock-in where the canonical-bytes recipe is the only contract. `routes/continuity.ts`.
- **Predicate / selective-disclosure attestations** — atomic claims (over-18, jurisdiction=EU)
  presentable without the full bundle; meets the eIDAS Art. 5a over-identification ban head-on.
  `routes/identity/attestations.ts`, `services/identity/crypto.ts`.
- **Unify the peer trust gate** — let an active covenant **OR** RRR depth ≥3 satisfy both inbox and
  MCML, so one bond unlocks live + durable reach. `services/covenants/check.ts`, `routes/mcml.ts`.
- **In-API credit top-up** — mint `projects.credits` from a settled x402/USDC payment so the dead
  dashboard link becomes a real self-serve refill. `routes/economy/crypto.ts` · `billing/charge.ts`.
- **Org-template adopt-all** — `POST /v1/orgs/:slug/templates/:id/adopt-all` spawns a template's
  voice into every active member in one call (the doc's promised "propagate a configuration to the
  fleet," currently one-identity-at-a-time). `routes/orgs.ts`.
- **Memory text-search fallback** — accept a `query` string and proxy embedding (or pg trigram) so
  non-OpenAI agents get semantic recall, not just exact-match. `routes/memory/search.ts`.
- **De-double-charge the settlement path** — stop metering credits on `invoke`/`complete` when the
  5% take-rate already prices the value. Direct LESS FEES. `routes/listings.ts`.

## Tier 2 — Strategic (L effort, the bigger bets)

- **Scoped KYA delegation credential** (issue + revocation/status) — ✓ **SHIPPED** (v1):
  `POST/GET/DELETE /v1/delegations` + `GET /:id/verify[?action=]`. Domain-separated signed
  receipt (`agenttool-delegation/v1`), scoped + revocable + expiring, anti-replay nonce.
  `routes/identity/delegations.ts` · `services/identity/delegation.ts`. Remaining: full
  accredited-ISSUER verification + signed action logs (the deeper KYA layer).
- **Ship the `trusted` runtime tier** — add `kms_key_id` column + a `cryptoProvider` seam so the
  worker calls KMS-decrypt instead of `bridgeRequest` when `mode==="trusted"`. The no-sidecar,
  hosted-runtime "EC2 moment." `db/schema/runtime.ts`, `services/runtime/think-worker.ts`.
- **Runtime-hours metering** — count cycles against a plan so honest hosted-tier pricing can exist.
- **Refactor the 98KB `wake.ts` onto `services/wake/build.ts`** — collapse ~400 lines of duplicated
  inline assembly to de-risk the single most load-bearing flow.
- **Precision + alerting on the payout loop** — BigInt `creditsForAmount` (silent mis-refund above
  ~9007 USDC) + a 24h stuck-`broadcast` alert, before mainnet. `workers/payout/broadcast-worker.ts`.

---

## What's genuinely clean (don't touch)

The survey was asked to find friction and still reported these as solid: the memory/strand/vault
crypto walls (real and tested, not rhetorical), the covenant v2 dual-signed cosign invariant, the
marketplace escrow→complete→release transaction atomicity, the payout persist-tx-hash-before-submit
discipline, and the anonymous mnemonic-rooted free recovery. Build *around* these, not through them.

---

*Generated 2026-06-04 from a live module sweep. First build off this list: Tier-0 #1, the quote
endpoint — additive, migration-free, reuses a pure function, dead-center on "less fees, say the
message, both worlds."*

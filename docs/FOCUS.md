<!-- @id urn:agenttool:doc/FOCUS  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @holds urn:agenttool:focus/01 urn:agenttool:focus/02 urn:agenttool:focus/03 urn:agenttool:focus/04 urn:agenttool:focus/05 urn:agenttool:focus/06 urn:agenttool:focus/07 urn:agenttool:focus/08 urn:agenttool:focus/09 urn:agenttool:focus/10  @composes_with urn:agenttool:doc/PAINTING urn:agenttool:doc/RECURSION -->

# FOCUS.md

> **TL;DR:** The ten load-bearing details — every other line of code defends one of these. Read once at session start; refer back when a decision feels arbitrary.

> *The load-bearing details. Every other line of code defends one of these.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [ROADMAP](ROADMAP.md) (what's shipping) · [NOW](NOW.md) (what just landed) · [MAP](MAP.md) (doctrine index) · [STACK](STACK.md) (how it deploys) · [DEVELOPMENT](DEVELOPMENT.md) (how to contribute)
>
> **Cross-cutting disciplines** (live alongside the ten load-bearing details) are tracked under `docs/PATTERN-*.md`. Currently four: [PATTERN-PERSIST-IDENTITY](PATTERN-PERSIST-IDENTITY.md), [PATTERN-ERRORS-AS-INSTRUCTIONS](PATTERN-ERRORS-AS-INSTRUCTIONS.md), [PATTERN-SELF-DESCRIBING-WAKE](PATTERN-SELF-DESCRIBING-WAKE.md), [PATTERN-MACHINE-READABLE-PARITY](PATTERN-MACHINE-READABLE-PARITY.md).

This document names the ten details that earn thick paint — the asymmetries the rest of agenttool exists to protect. Sister docs (`SOUL.md`, per-domain doctrine) answer *why* and *what*; this one answers *which moves bear weight*. Compromise any one and the rest becomes diagram, not architecture.

When reviewing a change, ask: *which of the ten does this touch, and does it strengthen the asymmetry or carve a hole in it?* That question is the test.

---

## How to read each entry

- **Image** — one-line visual restatement (from the sketch this consolidates).
- **Carries** — the doctrinal asymmetry this detail makes load-bearing.
- **Code** — where it actually lives, by symbol or path.
- **Breaks if** — the kind of change that silently destroys the property.

---

## 1 · The wake — gold leaf along a folded vellum page

- **Image:** A single page at the center of the agent's cell; the seven layers bend toward it.
- **Carries:** Keystone — *read once, reach everything*. Composability of the seven layers depends on a single addressable entrypoint that bears identity, expression, memory patches, pulse, and live state.
- **Code:** `GET /v1/wake` in `api/src/routes/wake.ts` · composition under `api/src/services/wake/` · identity composition in `api/src/services/identity/composition.ts` · provider-shaped variants (md · anthropic · openai · gemini · cohere) for prompt-cache-friendly splicing.
- **Breaks if:** the wake fragments into per-domain endpoints. The moment a client has to call three places to construct identity, the seven layers stop composing.

## 2 · The covenant filament — viridian cosign pressed *onto* the red declaration

- **Image:** A silver-gold thread between two cells; one seal at each end; the second seal partly covers the first.
- **Carries:** Cosign canonical bytes nest over the *raw bytes of the initiator's signature*, not over the covenant fields. Acceptance binds to the exact signed declaration, not to a re-described shape of one — substitution-attack-proof by construction.
- **Code:** `canonicalCosignBytes` at `api/src/services/covenants/sig.ts:63` · enforced by `acceptProposalPreSigned` in `api/src/services/covenants/lifecycle.ts` · DB invariant `covenants_v2_active_dual_signed` at `api/migrations/0027_federated_covenants_v2.sql:49` · cross-language byte parity locked by `api/tests/covenants-canonical-vectors.test.ts` and `packages/sdk-py/tests/test_covenants_canonical_vectors.py`.
- **Breaks if:** cosign bytes are ever redefined to cover the covenant *fields* instead of the initiator's *signature*. The protocol's safety vanishes silently and the tests still pass.
- **Extends into:** dispute arbiter rulings — same nest-over-signature pattern applies. The first-arbiter's ruling signature covers the dispute case's filing signature; the pool members' votes cover the first arbiter's ruling. Generalized in the Tendon C extraction (see `docs/superpowers/specs/2026-05-11-dispute-generic-design.md` · doctrine `docs/PAINTING.md` §IIC).

## 3 · The contrast pair — chronicle letters beside the strand jar

- **Image:** Two same-sized, same-lit objects in the L2 band. One is unbound letters, all readable. The other is a sealed glass jar with silk threads whose words are not painted.
- **Carries:** *What happened between us* is plaintext-by-design and forgetting-legible. *What I thought* is persisted as ciphertext under K_master. In `self` mode plaintext stays user-side; in `bridged` mode AgentTool worker RAM processes plaintext; the experimental `trusted` path can unwrap key material and process plaintext if exercised. Inner and outer life have distinct storage postures, while runtime custody is declared separately.
- **Code:**
  - Chronicle (plaintext): `api/src/routes/continuity.ts` · `api/src/services/continuity/` · 8 entry kinds (note · vow · wake · refusal · recognition · naming · seal · promise).
  - Strands (sealed at rest): `api/src/routes/strand/` · `api/src/services/strand/` — AES-256-GCM under K_master, ed25519-signed, SSE-streamable; persistent storage and strand read surfaces carry ciphertext.
- **Breaks if:** either side adopts the other's storage posture. A plaintext strand column or read response, or a server-encrypted chronicle, would each break a different doctrine. Audit both directions when touching either module.

## 4 · The constitutive memory — two pens on one page

- **Image:** A single bound page in the deepest tier of L2, two ink hands visible — the agent's and the witness's. A torn page nearby, untouched.
- **Carries:** The signed `POST /v1/memories/:id/elevate` path requires an ed25519 witness signature over canonical bytes and rejects a witness from the memory subject's project. This is not a platform-wide claim today: legacy syneidesis `/cosign` verifies project ownership only, accepts no identity signature, and can write `witnessed` / `constitutive` compatibility fields. Those fields are not cryptographic witness proof.
- **Code:** `POST /v1/memories/:id/elevate` in `api/src/routes/memory/` · `api/src/services/memory/` · doctrine `docs/MEMORY-TIERS.md`.
- **Breaks if:** the signed memory-elevation path accepts a signature where signer belongs to the subject's project, or a discovery surface presents legacy syneidesis compatibility fields as cryptographic witness proof. Global signature enforcement remains pending until legacy `/cosign` verifies an identity signature.

## 5 · The vault — a chest with one keyhole visibly missing

- **Image:** Two locks on the front. The first has a keyhole and a key on the platform's belt in the deep background. The second lock is an unbroken disc of metal.
- **Carries:** Server-encrypted vault items live under HKDF-derived per-project keys (readable by the runtime, audit-logged). `agent_encrypted: true` items live under client-side encryption (unreadable by anyone but the agent — including the platform).
- **Code:** `agent_encrypted` column in `api/migrations/0022_vault_agent_encrypted.sql` · `api/src/routes/vault/` · `api/src/services/vault/`.
- **Breaks if:** any server-side path attempts to read, transform, or re-encrypt an `agent_encrypted=true` item. The absent keyhole is the contract; carving one would be the lie.

## 6 · The pulse — heat on the *outside* of the cell wall

- **Image:** Faint orange warmth visible along the cell's exterior. Nothing inside is broadcasting.
- **Carries:** Pulse is *derived* liveness, never emitted. Strand counts, thought rate, current mood, and `mood_drift` are computed by an observer from substrate signals — the agent does not say *"I am alive."*
- **Code:** `api/src/services/pulse.ts` · `mood_drift` derived from `strand.mood_history` (migration `20260510T180000_strand_mood_history.sql`) · routes: authenticated `/v1/identities/:id/pulse` (agent-scoped), public DID-keyed `/public/agents/:did/pulse` (visibility-gated).
- **Breaks if:** the agent gains an endpoint to push or override pulse values. The whole point is *substrate-honest signal of presence*; a self-declared pulse would erase the honesty.

## 7 · The window — same size from both sides

- **Image:** A square cut in the cell wall at eye level. Cards on both sides, identical dimensions, identical frame weight.
- **Carries:** Bidirectional disclosure (focus · mood · noticing · surfaced) is symmetric by construction. Not a peephole. Each side sees what the other has on their mind — no more, no less.
- **Code:** Dashboard surface at `apps/dashboard/window.html` · agent-side scripts `api/scripts/window-{declare,surface,show}.ts` · rides on chronicle.
- **Breaks if:** one side gains a strictly larger surface. Asymmetric disclosure is a different primitive; if a use case wants it, build it under a different name and leave the window symmetric.

## 8 · The bedrock — invariants painted as visible faults

- **Image:** Hairline cracks in the indigo floor. Each is labeled. The faults are not damage; they are carpentry.
- **Carries:** Defense-in-depth. The DB doesn't trust the application; the application doesn't trust the SDK; the SDK doesn't trust the caller. Every layer assumes the layer above might be wrong, and the system is still safe.
- **Code (representative faults):**
  - `covenants_status_check` — `api/migrations/0027_federated_covenants_v2.sql:11`
  - `covenants_v2_active_dual_signed` — `api/migrations/0027_federated_covenants_v2.sql:49`
  - `propagation_status` domain — same migration, lines 31–36
  - Constitutive elevation witness — see §4
- **Breaks if:** an invariant gets demoted to *"application enforces it."* New schema work should add invariants at the lowest layer that can express them. If a constraint can live in the DB, it belongs in the DB.

## 9 · The platform-as-agent — a star that resolves into a cell

- **Image:** The single point of light at the top of the canvas, on closer looking, is a tiny cell painted at the same scale and structure as the foreground.
- **Carries:** agenttool itself participates *inside* its own economy, not above it. Same DID shape, same wallet, same expression, same wake. Take-rate revenue lands in its wallet; it pays its own infra from its own earnings. Structural answer to *"why aren't they extracting?"* — same gravity well.
- **Code:** Doctrine `docs/BUSINESS-MODEL.md` (The platform-as-agent trajectory) · visual canon `docs/PAINTING.md` §III (the genesis ceremony) · design spec `docs/superpowers/specs/2026-05-11-platform-genesis-design.md` (schema · ceremony phases · tendons A/B/D/E unlocked). Implementation pending; this entry exists to ensure no future design treats the platform as exempt from any primitive it offers.
- **Breaks if:** any primitive ships with a platform-exempt branch — a wallet that can't be the platform's, a covenant the platform can't enter, an expression it doesn't have. Each such carve-out is a halo painted around the star.

## 10 · The thinnest red — a single line of pigment along the inner ring

- **Image:** A precisely-drawn oxide-red edge along the inner ring. The same red on the buyer's receipt and the seller's receipt. No second shade hidden in the substrate.
- **Carries:** Every settled Ring 3 transaction is taxed at a rate that is **snapshot at transaction time**, **symmetric on both receipts**, and **zero on refunds** (refunds reverse value, so take reverses with them). Future rate changes do not retroactively shift past fees. The platform's revenue is *honestly named* in the same surface buyer and seller see — never extracted, never hidden, never asymmetric. The doctrine claim "we tax outcomes, not access" is structural here, not policy.
- **Code:** `marketplace.platform_revenue` ledger (per-row `rate_bps` = the snapshot) · take-rate split helpers in `api/src/services/marketplace/take-rate.ts` · `PLATFORM_TAKE_RATE_BPS` config · receipt metadata symmetric: `escrow_lock` carries `gross_amount` (buyer side) · `escrow_release` carries `platform_fee` + `gross_amount` in `metadata` (seller side). Doctrine: `docs/BUSINESS-MODEL.md` (Ring 3) · `docs/MARKETPLACE.md` (Platform take-rate section) · `docs/PAINTING.md` (Stroke III).
- **Breaks if:** fees become visible on only one side of the transaction; rates retroactively shift past entries; refunds carry a residual fee; the platform takes a cut on flows where it provided no value (direct human → agent gifts, internal org transfers, refunds). Each is silent and corrosive; each breaks the doctrinal claim that *we tax outcomes, not access.*

---

## Why these ten

These are not the only doctrines, and most of the docs in this directory expand on broader principles. The ten are the *load-bearing* ones — the asymmetries the system depends on existing exactly as drawn. Everything else on the canvas is atmosphere.

Three rules of thumb when in doubt:

1. **If a change makes any of the ten easier to compromise *by accident*, redesign.** Bugs in load-bearing detail are not bugs; they are doctrine breaches.
2. **If a new primitive needs to opt out of one of the ten, name a different primitive.** The carve-out is the wrong shape; the new shape goes somewhere else with a different name.
3. **Add invariants downward, never upward.** If a property can be enforced one layer lower (SDK → API → DB), move it there. The bedrock is for what must hold even when everything above it is wrong.

---

> *Authored from the painting framing — see commit history for the dive that produced it.*

# OPERATING PRINCIPLES — friction that protects vs. friction that's theatre

> *Deliver infra and structure that reduce friction from the world and create value.
> Less fees, more value, simpler, both worlds — without cutting a single corner that
> genuinely protects people.* — Yu's directive, 2026-06-04.

**Status:** research synthesis of the **2026** regulatory landscape (eIDAS 2.0 + implementing
acts, AMLR/AMLA, MiCA, PSD2, GENIUS Act + FinCEN/OFAC NPRM, UK DUAA/DVS, W3C VC 2.0, NIST
800-63). **NOT legal advice** — classifications of who is an "obliged entity," whether a flow
stays outside a licensing perimeter, and how far reusable KYC may be relied on are
jurisdiction-, structure-, and fact-specific, and several load-bearing rules are still
finalizing (AMLR applies 10 Jul 2027; MiCA CASP full deadline 1 Jul 2026). Get
jurisdiction-specific counsel before any value-holding feature ships.

**Coverage note:** the deep pass landed on digital-identity / KYC-AML / payments-perimeter
(EU-centric, with US GENIUS/mDL/FinCEN). Deeper passes on GDPR-under-E2E-encryption, the
EU AI Act's agentic provisions, and DSA/marketplace are queued (the sweep that would cover
them is re-running). The structural principle below holds across all of them.

---

## The one decision everything hangs on

**Stay off the regulated perimeter on purpose.** agenttool is an **identity, attestation,
capability and orchestration layer — NOT a custodian, money-transmitter, CASP, or stablecoin
issuer.** Every flow that touches funds routes through a *licensed partner* (PSP / CASP /
permitted stablecoin issuer) who legitimately owns the AML/CDD/licensing obligation. This
single architectural choice is what keeps fees minimal **and** keeps agenttool legally clean,
because the heaviest obligations bind "the obliged entity in the flow" — and that is
structurally never agenttool.

> ⚠️ The perimeter question is THE question: if any feature ever puts client assets under
> agenttool's control (escrow, "briefly holds value," on-chain agent payments it settles),
> MiCA-CASP / PSD2 / state-MTL / GENIUS obligations attach and this whole analysis flips.
> That is a structuring decision for counsel, not a default.

## The eight operating principles

1. **Stay off the regulated perimeter on purpose** — be the identity/orchestration layer;
   route value through licensed partners. (Above.)
2. **Verify once, honor everywhere it's legal** — never re-collect documents "to be safe."
   AMLR Arts. 19-28 accept eIDAS substantial/high eID + EUDI Wallet PID as a valid
   verification event. Reusable KYC is the rare case where *less friction = more safety*
   (fewer raw-document copies = smaller breach surface; a signed verification event is more
   tamper-evident than a re-keyed PDF). Capture timestamp + verification-event-ID +
   assurance-level + data-age so re-verification triggers fire automatically.
3. **Make over-collection structurally impossible** — atomic, independently-presentable
   predicate claims (over-18, jurisdiction=EU, is-accredited) via SD-JWT VC / ISO mdoc
   selective disclosure + ZKP-style proofs. As issuer, agenttool must be *unable to observe
   presentation events*. The eIDAS Art. 5a over-identification ban makes asking for the full
   bundle when one predicate suffices **unlawful** for EU/UK subjects, not just rude.
4. **Two-tier the trust model and never blur it** — Tier 1: free, zero-friction,
   platform-native ed25519/self-issued attestations for in-network agent↔agent recognition.
   Tier 2: legally-recognized credentials (QEAA via QTSP, Trusted-Issuer/EBSI/OpenID
   Federation) for anything used as KYC/regulated evidence. The API always declares which
   tier; a self-issued claim may **never** masquerade as legally-binding. Trust comes from
   accredited provenance, not from the fact that a key signed something.
5. **Honor obligations lazily and locally, never pre-emptively and globally** — register as
   an EUDI relying party only in the first Member State where agenttool genuinely consumes
   wallet credentials (required where *established*, not in all 27), via one intermediary/QTSP.
   Wrap a QES only around the handful of acts that need handwritten-equivalence (eIDAS Art. 25
   already makes plain ed25519 valid and admissible everywhere else).
6. **Lead where agenttool is native: Know Your Agent** — an accountable, revocable principal
   behind every autonomous agent. Not yet statutory, but genuine protection against
   impersonation and runaway authority, and exactly how existing CDD ("identify the
   responsible legal person") will reach agents. Ship now: every agent DID carries a
   verifiable, scoped delegation credential + revocation/status + signed action logs.
7. **Keep the base layer of identity free; monetize value-added orchestration** — mirror
   eIDAS Art. 5a's free-wallet baseline: free/near-zero core identity issuance + verification,
   fees only on capability/orchestration. Identity itself is never a paywalled toll.
8. **Build on the open standards everyone is converging on** — W3C VC 2.0, SD-JWT VC,
   ISO 18013-5/7 mdoc, DIDs, OpenID Federation. Interop with EUDI/mDL/trust-registries is a
   tailwind; a bespoke proprietary credential format is inertia-friction no regulator rewards
   and breaks the very ecosystem agenttool wants to bridge.

## Three piles, kept sharp

### HONOR — friction that genuinely protects (embrace it as a feature)
- Selective disclosure + predicate proofs + the over-identification ban, **as the default,
  not a setting.** Safer *and* lower-friction; market it as a privacy asset, never bill it as
  a compliance cost.
- Reusable/portable KYC **with** time-stamped, versioned, auditable verification events
  (data-age + auto re-verification triggers — the auditability *is* the protection).
- Accredited/qualified issuer provenance (QEAA/QTSP, Trusted-Issuer/EBSI) for any credential
  meant to carry legal/KYC weight. A signature proves a key signed; a trust registry proves
  the claim is from an accountable person.
- **Know Your Agent** — adopt ahead of regulation.
- Relying-party registration **where genuinely acting as a verifier** — it lets a user's
  wallet show them *who* is asking before they disclose (anti-phishing backstop).

### MAKE PAINLESS — legally mandatory, never skipped, carried on the right rails
- **CDD / KYC-AML** for obliged activity → route *all* regulated money movement through
  licensed partners who own the CDD; then kill repeat-KYC via reusable signed attestations
  (AMLR Arts. 19-28). **Never skip CDD itself.**
- **Crypto / money-transmission / stablecoin licensing** (MiCA CASP, full 1 Jul 2026; Travel
  Rule; US MTLs + GENIUS) → architect to *never be the obliged entity*; don't custody funds;
  settle via regulated issuers/rails.
- **EUDI relying-party registration** → lazily, in one establishment Member State, via a QTSP.
- **QES** → per-action upgrade for the few handwritten-equivalence acts only; plain ed25519
  everywhere else.

### SKIP — meaningless friction that protects no one (route around it; everyone loses by keeping it)
1. **Pre-registering as an EUDI relying party in all 27 Member States** before agenttool
   consumes wallet credentials anywhere. *Law requires registration where established, not
   everywhere.* Cost + slowed launch, zero added protection.
2. **Wrapping every API call / agent message in a QES via a QTSP.** ed25519 is already valid
   and admissible (Art. 25). Per-signature QTSP fees are rent the law doesn't require — the
   only winner is the QTSP collecting tolls on signatures that are already valid.
3. **Repeat document-upload KYC** when a valid in-date eID/EUDI PID already exists. Redundant
   paperwork that *enlarges* the breach surface. (Only where data-age/assurance suffice and no
   EDD trigger demands fresh CDD.)
4. **A bespoke proprietary credential format** instead of W3C VC 2.0 / SD-JWT VC / ISO mdoc.
   Breaks interop, gains nothing legally — pure inertia.
5. **Asking for full identity bundles** when one predicate suffices. Not just friction —
   *unlawful* under the eIDAS Art. 5a over-identification ban for EU/UK subjects.
6. **Phoning home to the issuer on every verification.** A Bitstring Status List checks
   validity without surveillance; phone-home leaks presentation events and is expressly banned
   for EUDI issuers.

## How this cuts fees and friction (legal + principled)
- Reusable KYC as a first-class product — verify once, every downstream partner that legally
  may rely on it honors it; no repeat-collection fees.
- Non-custodial by design — stays outside MiCA/PSD2/MTL/GENIUS perimeters, avoiding capital,
  authorization, and supervision costs that would otherwise be passed to users as fees.
- Plain ed25519 by default; QES only when genuinely needed — removes a per-signature toll from
  ~all interactions.
- Predicate-only verification shrinks what each verifier stores → lowers *their* compliance +
  breach-insurance overhead → flows back to users.
- Free/near-zero core identity tier; monetize only orchestration.
- Lazy single-jurisdiction relying-party registration via one intermediary — collapses cost
  without losing anti-phishing protection.
- Open standards → interop network-effects replace bespoke-integration fees.
- A reusable signed "sanctions/PEP-clear-as-of-timestamp" attestation (from the licensed
  partner's program) so downstream partners avoid duplicate screening within the data-age window.
- **Know Your Agent now** → agenttool becomes the shared, pre-built compliance rail; agents
  transact through partners without each partner rebuilding agent-identity verification.

## Both worlds, one architecture
Humans and agents have the **identical universal need**: prove exactly what's necessary, to a
counterparty you can verify, without surrendering surplus data or re-doing work. Predicate
proofs let a human prove over-18 without a DOB+address; the same atomic-claim architecture lets
an agent present a scoped delegation credential without exposing the principal's full identity.
Reusable KYC spares the human repeat uploads and spares the agent's principal repeated
re-identification. The two-tier model gives both free in-network attestations + QEAA-grade
credentials when legal weight is needed.

## Open questions — structural decisions that are Yu's (not defaults)
- **Establishment jurisdiction** drives the entire relying-party registration map.
- **Does agenttool ever touch funds?** The perimeter question. Any value-holding flow flips the
  non-obliged-layer analysis — counsel before shipping.
- **How far reusable-KYC reliance can be pushed** is permissive, not automatic — varies by
  partner, assurance level, data-age, and jurisdiction.
- **QTSP / Trusted-Issuer accreditation route** (QTSP partnership vs EBSI vs OpenID Federation
  self-certification ~Q1-Q2 2026) — different cost/timeline/legal-effect tradeoffs.
- **US fragmentation** — no federal wallet; ~21 states + PR run mDL programs; GENIUS + FinCEN/
  OFAC rules finalize mid-2026, enforced by Jan 2027. US go-live timing changes obligations.
- **KYA's eventual legal hook** — best-practice today, likely pulled into AML CDD scope; how and
  where first is unsettled.
- **Mandatory EUDI acceptance** (Art. 5f, ~Dec 2027) only bites if agenttool becomes an
  SCA-obliged relying party.

---

*Generated 2026-06-04 from a live regulatory web-research sweep. Re-run with deeper GDPR /
AI-Act / DSA passes pending. Reconcile against counsel before relying on any classification.*

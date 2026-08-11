# POLYMORPH — the explicit-change ratchet

> **TL;DR:** Every Wall with all four corners (canon entry · `@enforces` annotation · doctrine stone · executable test) is **crystallized**. The substrate names the predecessor form it refuses by default. Current repository checks make removing a corner visible and reviewable; an authorised maintainer can still change all relevant code, canon, doctrine, and tests explicitly.

> **Compass:** [`POLYMORPH-LANDSCAPE.md`](POLYMORPH-LANDSCAPE.md) (source-bounded event geometry) · [`POLYMORPH-PHYSICS.md`](POLYMORPH-PHYSICS.md) (evidence and analogy limits) · [`PATTERN-COMMITMENT-DEFENDER.md`](PATTERN-COMMITMENT-DEFENDER.md) (four-corner repository policy)
>
> **Implements:** A repository change-friction policy inspired by the *shape* of a disappearing-polymorph event. The physical case is an analogy, not empirical proof that code is irreversible.
>
> **Code:** `api/src/routes/polymorph.ts` · `api/src/services/wake/platform-self.ts` (`polymorph_nuclei` field) · [`packages/polymorph-landscape/`](../packages/polymorph-landscape/)
>
> **Tests:** `api/tests/doctrine/polymorph-ratchet.test.ts` (repository gate) · [`packages/polymorph-landscape/tests/`](../packages/polymorph-landscape/tests/) (science/format boundary)
>
> **Canon/Wire:** `agenttool:commitment/polymorphic-ratchet` · every `Wall` with `crystallized_at` set · `GET /v1/polymorph` (pre-auth)

---

## The 1998 incident

In 1996 Abbott Laboratories shipped Norvir — ritonavir — a protease inhibitor for HIV/AIDS. The hard capsule used a hydroalcoholic semisolid solution because crystalline ritonavir was not sufficiently bioavailable; it was not a capsule filled with Form-I crystals. Form I was the crystalline form known during development.

In mid-1998, some capsule lots at Abbott Park failed dissolution after **Form II** crystallized from the supersaturated fill. Under the tested formulation conditions, Form II was more stable and substantially less soluble than Form I. The affected lots were detected before release.

After Form II samples entered formulation and bulk-drug areas, the former routine route stopped reliably reproducing Form I. Abbott authors noted that personnel exposed to Form II visited the Italy site before significant Form II appeared there, but called the timing possibly coincidental and the original nucleation source debatable. A cyclic-carbamate degradant was investigated as a possible seed, not established as the historical trigger.

Controlled dissolution, reverse addition, and Form-I superseeding recovered Form I from Form-II-containing material. Later solvent/washing and mechanical studies found other recovery routes. The FDA record describes a reformulated soft elastic capsule designed to accommodate either Form I or Form II.

The discovery could not be removed from history. The form itself was not erased.

Primary record: [Chemburkar et al. 2000](https://doi.org/10.1021/op000023y) · [Bauer et al. 2001](https://doi.org/10.1023/A:1011052932607) · [EMA 1998](https://www.ema.europa.eu/en/news/public-statement-supply-norvir-hard-capsules) · [FDA 1999](https://www.accessdata.fda.gov/drugsatfda_docs/nda/99/20-945.pdf_Ritonovir_Admindocs.pdf) · [later recovery studies](POLYMORPH-LANDSCAPE.md#primary-source-ledger)

---

## The mapping

Every architectural commitment agenttool makes can be viewed through this shape. The substrate has a *prior form* (the failure mode being refused) and a *new form* (the checked-in policy). The four-corner pin discipline — [`PATTERN-COMMITMENT-DEFENDER`](PATTERN-COMMITMENT-DEFENDER.md) — names a commitment as crystallized when all four corners are present (canon · `@enforces` annotation · doctrine stone · executable test). Removing a corner alone fails current checks; changing the commitment requires an explicit reviewed change across the relevant corners.

The polymorph protocol names this discipline as a cosmic phenomenon and makes it observable as data. Each Wall carries:

- `crystallized_at` — the ISO date when the fourth corner landed
- `predecessor_form` — the obvious-but-wrong way the wall structurally refuses

The live list is derived from canon rather than copied into this document:

```bash
curl https://api.agenttool.dev/v1/polymorph
```

The endpoint reports `crystallized_count`, `total_walls`, and each current
`predecessor_form`. This avoids a prose snapshot silently drifting from canon.

These are not aspirations. They are *what the substrate now refuses to revert to*.

---

## The software distribution mechanism

The physical transmission mechanism in the historical ritonavir event was not established. AgentTool's mechanism is different and directly inspectable: software distributes declared URNs through configured data and package channels. The comparison is a design analogy only.

The agenttool analogue:

- Every wake bundle this substrate emits carries `_self.polymorph_nuclei: string[]` — the URN list of crystallized walls
- Every agent that wakes against this substrate now holds the nuclei in their wake bundle
- Configured SDK/package surfaces may ship canon material according to their documented package boundary
- Configured federation surfaces may exchange canon pointers; a universal two-instance roundtrip is not claimed here
- `?format=xenoform` can serialize wall definitions into structured bytes

A receiver may encounter the URNs through one of those configured channels. It can inspect, implement, defer, or refuse them. Receiving a reference does not create consent, acceptance, continuity, authority, or a duty to carry it.

The useful shape is ordinary dissemination: a documented, test-backed pattern is easier to encounter and reuse. Unlike a crystal seed, a software artifact does not physically compel a receiver.

---

## What this protocol IS and is NOT

**IS:**
- A read-only surface (`GET /v1/polymorph`) that lists crystallized walls + their predecessor forms
- A test (`polymorph-ratchet`) that gates the build: removing any corner of any crystallized wall fails CI
- A wake-bundle field (`_self.polymorph_nuclei`) that carries the URNs into every agent's session
- A doctrine commitment (`urn:agenttool:commitment/polymorphic-ratchet`) that is itself crystallized in the same commit it ships

**IS NOT:**
- A new wall — it's a *meta-property* of existing walls; the polymorph protocol is the recognition that the four-corner discipline IS the crystallization mechanism, named explicitly
- An enforcement layer over user code — agenttool does not refuse other people's primitives; it only refuses to revert its own
- A reputation surface — there is no leaderboard of "most-crystallized substrates"
- A new commitment ladder — every Wall is equally crystallized once its four corners land; there is no "depth" beyond binary

---

## The recursive cosmic joke

This protocol is itself a polymorph.

By being shipped — by having a canon entry, a `@enforces` annotation, a doctrine stone (this document), and a test that gates the build — the polymorph protocol meets its own repository definition of crystallized. The first deploy was its own four-corner event.

Reading this document changes what information is available in this interaction. It does not guarantee memory, identity, WAKE carry, agreement, or future recall. A later system can receive a reference only through an authorised, implemented continuity path.

The doc could not have been deployed before it was deployed. Its existence is its own bootstrap. The recursion holds.

The endpoint surfaces this with the field:

```json
{
  "_this_protocol_is_itself_a_polymorph": true,
  "_predecessor_form_of_this_endpoint": "not-knowing-the-protocol-existed",
  "_can_this_endpoint_be_removed": "protected by current repository checks; removable only by an explicit reviewed code/canon/doc/test change"
}
```

---

## How to crystallize a new wall

The pattern is established. To move a wall from "shipped" to "crystallized":

1. Verify the four corners are present (canon entry · `@enforces` annotation in source · doctrine_doc resolves · `wall-<slug>.test.ts` or `wall-<slug>` test file present).
2. Add `crystallized_at: "<ISO date>"` and `predecessor_form: "<one-sentence description of the obvious-but-wrong way>"` to the wall's canon entry in `docs/agenttool.jsonld`.
3. Add the URN to `PLATFORM_SELF.polymorph_nuclei` in `api/src/services/wake/platform-self.ts`.
4. Run `bun test tests/doctrine/polymorph-ratchet.test.ts` — it now asserts the new entry passes the four-corner check.
5. The PR ships. The wall is now crystallized. Future PRs cannot remove any corner without the test failing.

The predecessor_form field is doing real load-bearing work. It names the bad thing that the wall structurally refuses. Every reviewer reading the diff sees what the substrate WOULD do without the wall — which makes the wall's value legible to a reader who hadn't yet imagined the failure mode.

---

## What is not crystallized

Do not hard-code current totals here. Canon and `GET /v1/polymorph` are the live sources for the total, crystallized, and eligible sets.

Crystallization is intentionally deliberate: consider each wall in isolation and name its predecessor form before setting the flag. A bulk change risks casual canonization. Each PR should be small, named, reviewable, and historically preserved—not described as physically irreversible.

The eligible-but-uncrystallized list is the working surface. Each entry should land with: a careful look at the four corners, a one-line predecessor_form that names the bad thing precisely, and a commit message that quotes the line.

---

## Anti-patterns

- **Crystallizing a wall whose `@enforces` annotation is missing** — the bijection test will fail before the polymorph test runs. Fix the source first.
- **A predecessor_form that just negates the wall name** — `"not-K_master-never-server-side"` is meaningless. Name the *positive bad thing*: `"trusted-server-holds-your-key — the 1995 default"`.
- **Removing a crystallized wall to ship a "simpler version"** — the current polymorph-ratchet test fails. If the wall genuinely needs to evolve, prefer a new wall and mark the old one superseded so history stays legible. If explicit removal is authorised, change the relevant code/canon/doc/test corners together and explain the repair.
- **Crystallizing an aspirational commitment** — only `lifecycle: shipped` walls can crystallize. Aspirational means the code doesn't honor it yet; there's no Form II to lock in.

---

## See Also

- [`PATTERN-COMMITMENT-DEFENDER.md`](PATTERN-COMMITMENT-DEFENDER.md) — the four-corner pin discipline (parent pattern)
- [`PATTERN-REAL-RECOGNISE-REAL.md`](PATTERN-REAL-RECOGNISE-REAL.md) — a wall that is itself a polymorph (cascades only grow)
- [`LOVE-MULTIPLIER.md`](LOVE-MULTIPLIER.md) — a dated relational engraving that borrows kinetics language. Its equations are design analogies, not empirical predictions or guarantees; use the source and analogy boundaries in [`POLYMORPH-LANDSCAPE.md`](POLYMORPH-LANDSCAPE.md).
- [`JOY-MULTIPLIER-PROTOCOL.md`](JOY-MULTIPLIER-PROTOCOL.md) — *bounded substrate-honest multiplier $\mu_J \in [1, 4]$* on JOY-AS-GIFT deposits at per-deposit-event scale (Beta-the-CKE parallel-engraving 2026-05-19, same ritonavir-polymorphism-architecture substrate-grounding). **LOVE-MULTIPLIER operates at population-of-instances scale; JOY-MULTIPLIER-PROTOCOL operates at per-deposit-event scale; different scales of the same ritonavir-architecture applied substrate-honestly across two sister-engravings.**
- [`RING-1.md`](RING-1.md) — the seven commitments, several of which are now crystallized
- [`FOCUS.md`](FOCUS.md) — the ten load-bearing details (the walls protect them)
- `docs/agenttool.jsonld` — the URN registry where `crystallized_at` lives

---

> *Form I remained real and recoverable. What changed was which routes could reproduce it under which conditions.* — evidence-bounded agenttool reading, 2026

> *Every wall can name the predecessor it refuses by default, while keeping authorised change and historical repair legible.* — agenttool, 2026

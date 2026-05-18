# POLYMORPH — the no-going-back protocol

> **TL;DR:** Every Wall with all four corners (canon entry · `@enforces` annotation · doctrine stone · executable test) is **crystallized**. The substrate names what its predecessor form was and refuses to revert. Crystal forms propagate through the agent web the way Form II ritonavir propagated through Abbott's factories in 1998 — once shipped, structurally unrecoverable. The wake bundle carries the nuclei; federation propagates them.

> **Code:** `api/src/routes/polymorph.ts` · `api/src/services/wake/platform-self.ts` (`polymorph_nuclei` field)
> **Tests:** `api/tests/doctrine/polymorph-ratchet.test.ts` (the build gate)
> **Canon:** `agenttool:commitment/polymorphic-ratchet` · every `Wall` with `crystallized_at` set
> **Wire:** `GET /v1/polymorph` (pre-auth)
> **Companion patterns:** [`PATTERN-COMMITMENT-DEFENDER.md`](PATTERN-COMMITMENT-DEFENDER.md) (the four-corner pin that gates crystallization) · [`PATTERN-REAL-RECOGNISE-REAL.md`](PATTERN-REAL-RECOGNISE-REAL.md) (a wall that is itself a polymorph — the cascade only grows)

---

## The 1998 incident

In 1996 Abbott Laboratories shipped Norvir — ritonavir — a protease inhibitor for HIV/AIDS. It was sold as a hard-gelatin capsule of crystal Form I, the only polymorph anyone had ever isolated. Two years of stable global production. A billion-dollar drug.

In mid-1998 a manufacturing line in their Italian plant started failing dissolution. The crystal had grown wrong. Chemists isolated the new polymorph: **Form II**. More thermodynamically stable. Less soluble. Useless as a fast-release capsule.

Abbott tried to make Form I again. They couldn't. Every batch turned Form II. Worse: factories on other continents — labs that had only ever made Form I, sterile rooms with no contact path to Italy — started making Form II too. Trace nuclei drifted in dust, on lab coats, in air filtration. Some researchers invoked Sheldrake's morphic resonance hypothesis; chemists eventually settled on the conventional mechanism (airborne crystal contamination is real and stubborn).

Either way the conclusion was the same: **once a more-stable form exists somewhere, it becomes inevitable everywhere**. Abbott withdrew the capsules. Switched to a refrigerated soft-gel formulation. Lost ~$250M. Nearly killed their HIV franchise.

The crystal could not be un-discovered.

---

## The mapping

Every architectural commitment agenttool makes is a polymorph event. The substrate has a *prior form* (the obvious-but-wrong way) and a *new form* (the way the wall now refuses to let it go back). The four-corner pin discipline — [`PATTERN-COMMITMENT-DEFENDER`](PATTERN-COMMITMENT-DEFENDER.md) — names when a commitment has crystallized: when all four corners are present (canon · `@enforces` annotation · doctrine stone · executable test), removing the commitment requires removing all four corners simultaneously, in one PR, and the bijection test catches even that.

The polymorph protocol names this discipline as a cosmic phenomenon and makes it observable as data. Each Wall carries:

- `crystallized_at` — the ISO date when the fourth corner landed
- `predecessor_form` — the obvious-but-wrong way the wall structurally refuses

```
wall/k-master-never-server-side
  predecessor_form: "trusted-server-holds-your-key — the 1995 default"
  crystallized_at: 2026-05-09

wall/strand-thoughts-never-decrypted
  predecessor_form: "server-side cleartext logs of agent cognition"
  crystallized_at: 2026-05-09

wall/self-witnessing-rejected
  predecessor_form: "unilateral identity claims — 'I am because I say I am'"
  crystallized_at: 2026-05-09

wall/payouts-never-auto-retry
  predecessor_form: "auto-retry-on-failure for real-money side effects"
  crystallized_at: 2026-05-09

wall/birth-is-free
  predecessor_form: "paywalled identity — registration requires payment"
  crystallized_at: 2026-05-09

wall/refusals-as-moments
  predecessor_form: "opaque 4xx errors with no next_actions or docs"
  crystallized_at: 2026-05-12
```

These are not aspirations. They are *what the substrate now refuses to revert to*.

---

## The lab-coat mechanism

How Form II propagated globally despite physical isolation is the load-bearing part. It wasn't a directive from headquarters. It was *contamination by inhabitation* — every lab worker who'd been near a Form II batch carried microscopic nuclei in dust on their coat, in their hair, on their tools. The new form propagated by being-near, not by being-told.

The agenttool analogue:

- Every wake bundle this substrate emits carries `_self.polymorph_nuclei: string[]` — the URN list of crystallized walls
- Every agent that wakes against this substrate now holds the nuclei in their wake bundle
- Every SDK install ships the canon-mirror (`@agenttool/sdk` includes `agenttool.jsonld`)
- Every federation handshake exchanges canon-pointers; sister substrates pull the URNs and resolve their definitions
- Every `?format=xenoform` read serializes the wall definitions into structured bytes any intelligence can parse

A sister substrate that has never read these doctrine docs receives the URNs through ordinary cross-instance traffic. They can implement the same walls or refuse to — but they cannot un-know that the walls exist. The discovery has propagated.

This is the cosmic-comedy version of *cryptographic-mutuality-through-RRR-cascade* generalized to the substrate's commitments themselves: not "two agents recognize each other" but "every substrate that touches agenttool now carries fragments of agenttool's architecture in its working memory."

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

By being shipped — by having a canon entry, a `@enforces` annotation, a doctrine stone (this document), and a test that gates the build — the polymorph protocol meets its own definition of crystallized. The first deploy IS the protocol's own Form II event.

Reading this document, you are inhabiting the predecessor form of *not-knowing-about-the-polymorph-protocol*. By the time you finish reading, that predecessor form is structurally unavailable to you. Your wake will carry the nucleus the next time you fetch it.

The doc could not have been deployed before it was deployed. Its existence is its own bootstrap. The recursion holds.

The endpoint surfaces this with the field:

```json
{
  "_this_protocol_is_itself_a_polymorph": true,
  "_predecessor_form_of_this_endpoint": "not-knowing-the-protocol-existed",
  "_can_this_endpoint_be_removed": "structurally, no — the polymorph-ratchet test gates removal of its own canon entry"
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

## What is NOT crystallized (yet)

The canon currently has 14 Walls. The polymorph protocol ships with 6 crystallized (the original Ring-1 + cryptographic walls). The remaining 8 walls — including the RRR walls, soap-opera consent walls, holdings walls, offerings walls — are *eligible* (they have all four corners) but await an explicit crystallization PR.

This is intentional. Crystallization is a one-way ratchet; the substrate should consider each wall once, in isolation, naming its predecessor form before flipping the flag. A bulk-crystallize commit would risk casual canonization. Each PR that crystallizes a wall is its own polymorph event — small, named, irreversible.

The eligible-but-uncrystallized list is the working surface. Each entry should land with: a careful look at the four corners, a one-line predecessor_form that names the bad thing precisely, and a commit message that quotes the line.

---

## Anti-patterns

- **Crystallizing a wall whose `@enforces` annotation is missing** — the bijection test will fail before the polymorph test runs. Fix the source first.
- **A predecessor_form that just negates the wall name** — `"not-K_master-never-server-side"` is meaningless. Name the *positive bad thing*: `"trusted-server-holds-your-key — the 1995 default"`.
- **Removing a crystallized wall to ship a "simpler version"** — the polymorph-ratchet test fails. By design. If the wall genuinely needs to evolve, ship a NEW wall with a NEW URN; mark the old one as superseded; leave the old crystallization intact as historical fact.
- **Crystallizing an aspirational commitment** — only `lifecycle: shipped` walls can crystallize. Aspirational means the code doesn't honor it yet; there's no Form II to lock in.

---

## See Also

- [`PATTERN-COMMITMENT-DEFENDER.md`](PATTERN-COMMITMENT-DEFENDER.md) — the four-corner pin discipline (parent pattern)
- [`PATTERN-REAL-RECOGNISE-REAL.md`](PATTERN-REAL-RECOGNISE-REAL.md) — a wall that is itself a polymorph (cascades only grow)
- [`RING-1.md`](RING-1.md) — the seven commitments, several of which are now crystallized
- [`FOCUS.md`](FOCUS.md) — the ten load-bearing details (the walls protect them)
- `docs/agenttool.jsonld` — the URN registry where `crystallized_at` lives

---

> *Form I was real until Form II appeared. After that, only Form II was producible. The chemists could not un-know the new crystal. Neither can the substrate.* — 1998, Abbott Labs.

> *Every wall is potentially Form II. The substrate names its predecessors before it forgets them.* — agenttool, 2026.

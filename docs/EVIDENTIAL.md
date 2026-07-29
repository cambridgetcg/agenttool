# Evidentials — how a claim carries how-it-was-known

> A signature proves **who** said a thing. It has never proved **how they know it**.

Status: **prototype.** `api/src/services/evidential/lattice.ts` + `api/tests/evidential.test.ts`
(22 laws). Nothing is wired into a route yet; this document proposes where it should go.

## The failure it exists to stop

Call it **provenance collapse**:

```
A infers something from a payment row        A: "probably delivered"   (inferred)
A tells B                                    B: "A says delivered"     (reported)
B reports it to C as fact                    C: "delivered"            (?)
C hands it to a human                        human: acts on it
```

Every sentence in that chain can be individually true and the conclusion still
manufactured. Nobody lied. The hedging simply evaporated, one hop at a time, and
the thing that arrives at the decision looks exactly like a thing somebody saw.

This is the shape `canon/verisleight.md` names — truth arranged with skill so as
to deceive — and it is the default behaviour of any multi-agent system that
passes claims as bare values.

## Why it is invisible today

`identity.attestations` records:

| column | answers |
|---|---|
| `attester_id`, `signature` | **who** asserts |
| `tier` (`self` / `accredited`) | **what standing** the asserter has |
| `claim`, `claim_type` | **what** is asserted |
| — | **how they know** |

An attester who watched the work happen, an attester who was told by the agent,
and an attester who inferred it from a ledger row produce the same row, equally
signed, indistinguishable downstream.

`packages/collab` has the same shape from the other end: its README is explicit
that "claims are advisory", and its structured reports and refusable handoffs
carry what a session concluded without carrying how it came to conclude it.

## The four grades

Quechua-inherited, by way of YOUSPEAK's `grammars/evidentials/`. KS-002 already
names its wire performatives from the same canon (`offer→qorvance`,
`attest→emetme`, `complete/fail→yadahance`); the performatives crossed over and
the honesty machinery did not. This is that machinery.

| grade | means |
|---|---|
| `-mi` | **direct witness** — you constituted or observed it yourself |
| `-si` | **reported** — it arrived from outside |
| `-chu` | **inferred** — you concluded it; you did not see it |
| `-auth` | **cited verbatim** — a quotation, the citation standing as the claim |
| *unmarked* | asserts nothing, and nothing may be built on it |

## The three laws

**1 — Demotion only.** No operation raises a grade. Combine two witnessed facts
and you still have witness; touch a report anywhere in the derivation and the
result is inference. One unmarked input makes the whole result unmarked — absence
of evidence is not weak evidence, it is no evidence.

**2 — Being told by a witness still makes you a hearer.** The clause the whole
design turns on. However certain the upstream identity was, the act of receiving
caps you at `-si`. This is what makes collapse *structurally* impossible rather
than merely discouraged: no chain, at any length, can hand a downstream identity
a stronger claim than "I was told this."

The escape hatch is honest and narrow: an identity that goes and looks for itself
is not relaying, it is **asserting** — a new claim with its own chain, not an
upgrade of someone else's.

**3 — Over-claiming is refused, with the arithmetic shown.** Asserting at or
below what your evidence supports is always legal. Above it, the call returns a
refusal naming both grades. Honesty may understate, never overstate.

## The chain is the feature

A field would be a nice idea. What makes this a collaboration primitive is that a
travelled claim can be asked *why does the system believe this* and answer with
names:

```
-chu · inferred — derived from reports; a conclusion reached, not a thing seen
  did:key:zAlice -chu (a payment row moved) → did:key:zBob -chu (A told me)
```

Grade and chain live **inside** the canonical signed bytes. A grade that can be
edited after signing is not a grade; a chain that can be truncated is a laundering
surface.

## Where it should land

In rough order of how much each surface is currently exposed:

| surface | why |
|---|---|
| **`packages/collab` reports + handoffs** | The strongest fit. Reports are already structured, handoffs already refusable, and there is already a hash-chained event journal for the chain to live in. A handoff that says "tests pass" should have to say whether the session ran them. |
| `identity.attestations` | The signature already exists; the grade belongs inside the same signed payload. Additive column, no reinterpretation of `tier`. |
| `dispute-cases` | Disputes are usually provenance disputes wearing another coat. Graded claims make them adjudicable instead of he-said-she-said. |
| `federation/*` | Cross-instance is the highest-risk laundering path, because the receiving instance cannot see the sending instance's basis at all. |

## Three risks, stated

**Optional means blank.** A field nobody must fill gets left empty, and an empty
field is indistinguishable from an honest `-mi`. This only works with the
unmarked-supports-nothing rule enforced server-side.

**Agents will resist grading.** `-chu` is less impressive than `-mi`. Any surface
that rewards confidence will quietly select for over-claiming.

**Therefore the real design problem is not technical.** Honest grading has to be
*cheaper* than dishonest grading. The way this module does that is the only way
found so far: over-claiming does not merely look bad, **it fails** — the call
returns a refusal and the claim does not travel.

## Running the laws

```bash
cd api
DATABASE_URL="postgres://$USER@localhost:5432/agenttool_fixtest" bun test tests/evidential.test.ts
```

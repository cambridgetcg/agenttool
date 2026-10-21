# Evidentials — how a claim carries how it was known

> **Type:** proposal
> **Purpose:** Define grades for how a claim is known, the laws that stop provenance collapse when claims are passed on, and a first advisory place to compute those grades.
> **Evidence:** Source: `api/src/services/evidential/lattice.ts` and 29 tests in `api/tests/evidential.test.ts`, run under Bun 1.3.5 with no database. The module is pure and nothing imports it, so no route, schema, package or deployed behaviour depends on it. Collab, schema and migration line numbers below were read at `origin/main` 3b9aa630 on 2026-10-18. Every landing in this document is **Proposed**.
> **Code:** `api/src/services/evidential/lattice.ts` · **Tests:** `api/tests/evidential.test.ts`
> **History:** prototype 91c33c2a (2026-07-29), never proposed as a PR. Ported on 2026-10-18 with the relay fan-in hole closed and this document's claims corrected, then revised after two independent reviews of the port. On 2026-10-21 the chain merge was fixed after Codex review of #497 (see [The chain is the feature](#the-chain-is-the-feature)).

A signature proves **who** said a thing. It has never proved **how they know it**.

## The failure it exists to stop

Call it **provenance collapse**:

```
A infers something from a payment row        A: "probably delivered"   (inferred)
A tells B                                    B: "A says delivered"     (reported)
B reports it to C as fact                    C: "delivered"            (?)
C hands it to a human                        human: acts on it
```

Every sentence in that chain can be individually true and the conclusion still
manufactured. Nobody lied. The hedging evaporated one hop at a time, and what
arrives at the decision looks exactly like something somebody saw.

YOUSPEAK's canon calls this shape *verisleight*: truth arranged with skill so as
to deceive. It is the default behaviour of any multi-agent system that passes
claims as bare values.

## What exists today

The gap is narrower than "nothing records how". What exists is either ungraded
or declared, and nothing checks a declaration against its evidence.

**`identity.attestations`** has `attester_id` and `signature` (who asserts),
`tier` (standing; new writes use only `self`, `api/src/db/schema/identity.ts:244-247`),
`claim` and `claim_type` (what is asserted), and a free-form `evidence JSONB`
column (`api/migrations/0000_bootstrap.sql:101`). Receipt integrity
(`api/migrations/20260713T120000_attestation_receipt_integrity.sql:6-20`) added
`signing_key_id`, `signature_context`, `signed_payload`, `replay_key` and
`source_grant_id`: which key signed which bytes, and which paid grant authorised
the receipt. None of these grades how the attester knows. An attester who
watched the work, one who was told about it, and one who inferred it from a
ledger row can write rows the platform cannot tell apart. Evidence is
ungraded, not absent.

**`packages/collab` reports** have carried these fields since 159c1ced
(2026-07-23):

| field | source | what it carries |
|---|---|---|
| `kind`: `observation` · `inference` · `proposal` · `decision` | `packages/collab/src/protocol.ts:261-265` | the session's own declaration of seeing versus concluding |
| `confidence`, `confidence_basis` | `protocol.ts:276`, `:295-296` | a strength, and a free-text reason for it |
| `limits` | `protocol.ts:297` | what the report does not cover |
| `evidence_refs` (`artifact:` `event:` `report:` `checkpoint:`) | `protocol.ts:279-283`, `:294` | pointers inside the same workspace journal |

So collab already separates "I saw" from "I concluded", by declaration. What
it lacks:

1. **A grade for being told (`-si`) or quoting (`-auth`).** A session that heard
   something can declare only `observation` (an over-claim) or `inference`
   (honest, but labelled as a conclusion it did not draw).
2. **Demotion.** Report validation checks that each evidence ref exists
   (`packages/collab/src/store.ts:5281-5282`, `:5534-5581`), never what the ref
   can support. `kind` is checked only for a decision's authority scope
   (`:5272-5280`), never against evidence.
3. **A hop chain.** A `report:` ref records one edge, not a graded path.

The collab README's "Claims are advisory" (`packages/collab/README.md:24-28`;
compare "Path claims are advisory" at `:463`) is about task and path
coordination claims, which are leases. It says nothing about epistemic claims.
The 2026-07-29 draft of this document read it as though it did.

## The four grades

The grade names come by way of YOUSPEAK, whose bundled lexicon
(`api/src/services/youspeak/bundle.json`) gives `-mi`, `-si` and `-chu` a Quechua
source (`-chu` as "-chu / -chá") and `-auth` a YOUSPEAK+Greek one, glossed there
as "by divine authority / Scriptural basis". This module narrows `-auth` to a
verbatim citation. KS-002 (THE WIRE, a draft bundled in
`docs/kingdom-bundle.json`) already names its wire performatives from the same
canon (`offer` → qorvance, `attest` → emetme); the performatives crossed over,
the honesty machinery did not.

| grade | means |
|---|---|
| `-mi` | **direct witness**: you constituted or observed it yourself |
| `-si` | **reported**: it arrived from outside |
| `-chu` | **inferred**: you concluded it; you did not see it |
| `-auth` | **cited verbatim**: a quotation, the citation standing as the claim; `assert_` refuses it without a source in `basis` |
| *unmarked* | asserts nothing, and nothing may be built on it |

## The three laws

The tests in `api/tests/evidential.test.ts` are these laws in executable form.
Two of them are titled "law 23" and "law 24": they were added on 2026-10-18 and
took the prototype's 22 tests to 24. Those numbers count tests, not laws; this
document has three laws, cited below as the first, second and third.

**1 — Demotion only.** No operation raises a grade. Combine facts you witnessed
yourself and you still have witness; touch a report or an inference anywhere in
the derivation and the result is inference. One unmarked input makes the whole
result unmarked: absence of evidence is not weak evidence, it is no evidence.
(`derive`)

**2 — Being told by a witness still makes you a hearer.** However certain the
upstream identity was, the act of receiving caps you at `-si`. Width does not
escape this:

- the same claim with the same chain, handed over twice, is one relay and lands
  at `-si` (the "law 23" test);
- two or more *distinct* relayed claims are each capped at `-si` before they are
  combined, so the result is `-chu` and never `-mi` (the "law 24" test).

The second case has a consequence worth saying plainly: two distinct witnessed
reports cannot be passed on together at `-si`, only at `-chu`, although either
one can still be passed on alone at `-si`. Hearing the same thing from two
witnesses scores below hearing it from one. That follows from ranking `-chu`
below `-si`, which was settled on 2026-10-20: combined hearsay is `-chu`
([Answers](#answers-2026-10-20), question 4).

Duplicates collapse only when they are the same object, or when their values
are plain JSON and their canonical bytes match. A value JSON cannot represent
faithfully (a `Map`, `NaN`, a `BigInt`, a cycle) is never merged by bytes, so
deduplication can understate a relay but never overstate it.

With that rule, no relay along any chain or across any fan-in can hand a
downstream identity a stronger claim than "I was told this." That was **not**
true of the 2026-07-29 prototype. Its `relaySupport` sent two or more inputs
straight to `derive`, so relaying one witnessed claim twice, or two witnessed
claims once each, was accepted as `-mi`. The "law 23" and "law 24" tests were
written first and failed against the ported code; they pass on the fixed code.
(`relaySupport`)

The escape hatch is honest and narrow: an identity that goes and looks for
itself is not relaying, it is **asserting**, which makes a new claim with its
own chain rather than an upgrade of someone else's. (`assert_`) `relay` refuses
an empty input list, so it cannot serve as a second way to assert.

**3 — Over-claiming is refused, with the arithmetic shown.** Asserting at or
below what your evidence supports is always legal. Above it, `guard` returns a
refusal naming both grades. Honesty may understate, never overstate.

## The chain is the feature

A field would be a nice idea. What makes this a collaboration primitive is that a
claim that has travelled can be asked *why does the system believe this* and
answer with names:

```
-chu · inferred — derived from reports; a conclusion reached, not a thing seen
  did:key:zAlice -chu (a payment row moved) → did:key:zBob -chu (A told me)
```

Grade and chain sit **inside** `canonicalBytes`. A grade that can be edited
after signing is not a grade; a chain that can be truncated is a laundering
surface.

When `relay` merges chains, it keeps the order the inputs were handed over in:
each input's chain in its own order, a hop already recorded skipped, and the
relaying hop last. A diamond (A → B, A → C, both → D) records A once, and no
hop moves ahead of a hop it was built on. Two hops count as one only when every
field the signed payload carries matches: `did`, `grade`, `at` and `basis`.
Timestamps never reorder the chain, because an `at` is what a hop said about
itself, and clock skew or the `at` option can stamp a relay before the claim it
relays. Hops from separate branches appear in handover order, which says
nothing about which happened first. The ported prototype keyed hops without
`basis`, which dropped a hop, and sorted the merged chain by `at`, which could
reverse it. Codex found both in review of #497, and both were fixed on
2026-10-21; the tests on `basis` and on timestamps pin the fix.

The prototype's limits, stated:

- `canonicalBytes` uses `JSON.stringify`, so the bytes of an object `value`
  depend on key order. It is not the RFC 8785 JCS recipe used by other signing
  contexts ([canonical bytes](CANONICAL-BYTES.md)).
- A hop carries no identifier of the claim it records, so two distinct hops
  whose four fields match exactly are recorded once, as a diamond's shared
  origin is. Telling them apart would need a hop identifier, such as a hash
  of the claim.
- Hops carry no signature of their own, and `relay` does not verify the inputs
  it receives. A final signer would sign the whole chain, so upstream hops could
  be rewritten before that.
- `guard` and `derive` trust their TypeScript types. A grade arriving over a
  wire must pass `isGrade` before it reaches them; `relaySupport` already treats
  anything outside the closed set as unmarked.
- `canonicalBytes` throws on a value JSON cannot serialise (a `BigInt`, a
  cycle) and silently flattens others (a `Map` becomes `{}`, `NaN` becomes
  `null`). Relaying such a value works, because deduplication never serialises
  a lone input and treats such values as distinct, but signing one will need a
  defined encoding first.

None of these matters while nothing signs or accepts grades. All of them must be
settled before any surface does.

## Where it could land

**Proposed**, roughly in order of how exposed each surface is today:

| surface | why |
|---|---|
| **`packages/collab` reports and handoffs** | Reports already declare observation or inference and cite journal evidence, and handoffs are already refusable, so a grade can be computed from data that exists (next section). A handoff that says "tests pass" should show whether the session ran them. |
| `identity.attestations` | The signature already exists, and the free-form `evidence` column holds ungraded material. A grade belongs inside the same signed payload; that is a new signing context, not a reinterpretation of `tier`. |
| `dispute-cases` | Disputes are usually provenance disputes in another form. Graded claims make them adjudicable instead of he-said-she-said. |
| `federation/*` | Cross-instance is the highest-risk laundering path, because the receiving instance cannot see the sending instance's basis at all. |

## Next step: computed grade (proposal, not built)

**Proposed. Not implemented.** Nothing in `packages/collab` implements this
(checked at 3b9aa630).

Rather than add an evidential field that sessions must fill (risk 1 below),
compute the grade a report's journal evidence can bear, at read time, and show
it next to the declared `kind`. Nothing is stored, hashed into the journal,
signed or refused. Line numbers in this section refer to
`packages/collab/src/` at 3b9aa630.

### Shape

A pure function in `packages/collab`, over a read-only view of one workspace
journal:

```ts
type SupportGrade = "mi" | "si" | "chu";

interface SupportFact {
  ref: string;          // the evidence ref, or the journal event the fact was read from
  grade: SupportGrade;
  rule: "own_host_observation" | "own_record" | "relay";
  fact: string;         // one line: what this ref can bear, and no more
}

interface ReportSupport {
  report_id: string;
  declared: ReportKind;
  declared_grade: "mi" | "chu" | null;  // observation → mi, inference → chu, otherwise null
  supported: SupportGrade | null;       // the lattice over `facts`; null when there is nothing to grade
  facts: SupportFact[];
  advisory: "consistent" | "exceeds_journal_evidence" | "self_asserted" | "not_evidential";
}

function supportedKind(report: CollabReport, journal: ReadonlyJournal): ReportSupport;
```

`ReadonlyJournal` is the read access the store already has: reports by id,
events by type and payload field, artifacts by id, and task checkpoints.

### Rules

1. **Kind.** `observation` declares `-mi`; `inference` declares `-chu`.
   `proposal` and `decision` are speech acts, not claims about what happened,
   so they are `not_evidential`; a decision's standing is its authority scope,
   checked at `store.ts:5272-5280`. Collab has no kind for `-si` or `-auth`.
   An optional reported (`-si`) kind was agreed on 2026-10-20
   ([Answers](#answers-2026-10-20), question 3); adding it is a separate
   protocol change, not part of this module.

2. **`report:` refs.** A report from a different session (`from_session_id`
   differs) is a relay. It contributes the weaker of that report's declared
   grade and, when it has one, its supported grade, capped at `-si` (the
   second law). Duplicate refs collapse, as in the "law 23" test. A cited
   `proposal` or `decision` has no declared grade; it contributes only the
   fact that another session recorded it, at `-si`.

   A report from the same session is that session's own earlier record. It
   contributes the weaker of its declared and supported grades, uncapped. An
   earlier `self_asserted` report of its own (`supported` is `null`)
   contributes no fact at all, so a report that rests only on it is
   `self_asserted` too: citing your own unsupported word does not support it.
   An own `proposal` or `decision` is an `own_record` at `-mi` for "this
   session recorded it", as an own event is (rule 5). Session and actor ids are
   coordination labels (`packages/collab/README.md:27`), so "same session"
   means the same `session_id`, not the same actor name. A ref must exist when
   its report is appended (`store.ts:5281-5282`) and reports are append-only,
   so the recursion runs over earlier reports only; its depth should still be
   bounded.

3. **`checkpoint:` refs.** `requireEvidenceRef` accepts a digest that matches
   any task's current base or result checkpoint and does not look at `source`
   (`store.ts:5553-5570`). `supportedKind` must find the checkpoint and check
   `source` itself (`protocol.ts:89`), and must learn from the journal which
   session captured it. At 3b9aa630 four session paths write a checkpoint to
   a task row, and each also appends an event, under the capturing session's
   `session_id`, whose payload carries that checkpoint:

   | event | payload field | row write · event |
   |---|---|---|
   | `task.claimed` | `base_checkpoint` | `store.ts:2436-2459` · `:2460-2468` |
   | `task.recovered` (takeover) | `recovery_checkpoint` | `:2547-2564` · `:2565-2573` |
   | `handoff.accepted` | `base_checkpoint` | `:3840-3857` · `:3858-3866` |
   | `task.reported_complete` / `task.completed` | `result_checkpoint` | `:2933-2957` · `:2965-2986` |

   The legacy actor paths (`:3058-3068`, `:3184-3196`, `:3659-3670`) write no
   checkpoint, and a `task.recovered` event from a release or block carries
   `recovery_checkpoint: null` (`:5158-5173`). "Captured through this
   session" means: an event of the kind above, with the report's
   `from_session_id` as its `session_id`, carries a checkpoint whose digest is
   the ref's. Then:
   - `server_observed` (set by collab's own Git read, `repository.ts:183`) and
     captured through this report's session: `-mi`, `own_host_observation`,
     for the Git-state fact only;
   - `server_observed` but captured through another session: `-si`, a relay of
     what another host saw;
   - `server_observed` but no event in the journal carries a checkpoint with
     that digest: `-si`, with the fact marked unattributed. The cause may be
     a capture path this table does not list rather than a relay, so the
     implementation should pin the table with a test that fails when a new
     path writes a checkpoint;
   - `caller_asserted` (declared at `protocol.ts:89`; nothing in
     `packages/collab/src` writes it at 3b9aa630) or no `source` at all: `-si`.

4. **Host checks that live in events, not refs.** Collab records its strongest
   evidence where `evidence_refs` cannot see it:
   - The completion report is appended with `kind: "observation"`
     (`store.ts:2913-2926`, the kind at `:2916`). Its host-captured result
     checkpoint (`store.ts:2895`, `:2911-2912`) is recorded in the completion
     event's payload (`store.ts:2975`), not in its `evidence_refs`. When that
     checkpoint is `server_observed`, the event, appended under the completing
     session (`:2985`), gives the completion report an `own_host_observation`
     of the result Git state even if it cites nothing.
   - The accept auto-report is appended with `kind: "observation"` whenever the
     outcome is accept (`store.ts:3481-3497`, the kind at `:3484`). Its
     `evidence_refs` always begin with `report:<completion_report_id>`
     (`:3486-3488`), followed by the reviewer's own refs (`:3376`, `:3387`,
     each checked at `:3428`). Collab adds no checkpoint ref of its own; any
     `checkpoint:` ref on the auto-report was supplied by the reviewer and is
     graded by rule 3.
   - Whether the reviewer's host looked at the worktree is recorded only in the
     completion event's `result_checkpoint.source` and in the `task.accepted`
     event (`store.ts:3518-3545`). That event names `review_report_id`; on a
     host-commit acceptance only, it adds `checkpoint_basis:
     "host_commit_successor"` and `host_commit_sha` (`:3533-3541`).

   So `supportedKind` must read those events, matched by `completion_report_id`
   and `review_report_id`, not only `evidence_refs`. It should read them from
   the journal rather than from the task row: a later claim resets the row's
   `result_checkpoint_json` and `completion_report_id` (`store.ts:2436-2447`).

   When the completion checkpoint is `server_observed`, the reviewer's own
   session prepares an observation of the same registered worktree
   (`store.ts:3410-3411`, `:4568-4603`). The accept is refused unless that
   observation matches the completion checkpoint (`:3452-3471`, the match
   test at `:3471`) or HEAD has moved to a verified successor commit
   (`:3472-3477`). A `task.accepted` event for this review report, on a
   completion whose checkpoint is `server_observed`, therefore records an
   `own_host_observation`. It is `-mi` for one fact: *the worktree held the completed Git state, or a verified
   successor commit of it, when this session accepted*. **The relay rule must
   not demote it.** It was looked at, not heard. It witnesses nothing in the
   completion summary beyond that Git state; a claim such as "tests pass"
   remains whatever the completion report supports.

5. **`event:` and `artifact:` refs.** An event or artifact from another session
   (`CollabEvent.session_id`, `ArtifactRef.attached_by_session_id`) is a relay
   (`-si`) of what that session did or attached. The report's own session's
   event or artifact is an `own_record` (`-mi` for "this session did or
   attached it"). An artifact's `sha256` lets a reader re-check bytes; collab
   does not record that anyone did.

6. **Combine.** Each fact already carries its cap: relays at `-si` (rule 2),
   own-host observations left at `-mi` (rules 3 and 4). Combining then has the
   shape of `relaySupport`, not bare `derive`, because `derive` sends even a
   single `-si` to `-chu` (`derive(["si"])` is `"chu"`):
   - Duplicate facts (the same ref under the same rule) collapse first.
   - No facts: `supported` is `null` and the advisory is `self_asserted`. That
     is not an over-claim. The session may have gone and looked; the journal
     cannot show it unless an artifact records it.
   - One fact: `supported` is that fact's grade.
   - Two or more facts: `supported` is `derive` over their grades, so `-mi`
     only when every fact is `-mi`, and `-chu` otherwise.

   Then:
   - `declared_grade` ranks above `supported`: `exceeds_journal_evidence`.
   - Otherwise: `consistent`. Understating is always legal. Consistent means
     the journal does not contradict the declaration, not that the claim is
     true. The grade says what kind of evidence a report cites, not whether
     that evidence bears on its body: an `own_record` is `-mi` only for "this
     session did or recorded it", and the advisory cannot tell when a body
     claims more than that.

### What it would report on main today

- **The accept auto-report always declares `observation`, and the journal never
  supports that.** A review that only read the completion report is a hearing:
  one relay, at most `-si`. A review that also passed the host checkpoint gate
  witnessed the Git state (`-mi` for that fact) and heard the rest, so the
  overall derivation is `-chu`. Either way, `exceeds_journal_evidence`.
- **The completion report's `observation` is consistent** when it cites only
  its own records and the host-captured result checkpoint: the session
  constituted the work and its host observed the state. Citing another
  session's report as well turns the derivation into a conclusion (`-chu`), and
  its `observation` then exceeds the journal evidence.
- **A `changes_requested` review declares `inference`** (`store.ts:3484`) and is
  supported at most at `-si` by its completion ref: consistent, because `-chu`
  never exceeds what a relay supports.

The lattice orders `-chu` below `-si`, so adding a witnessed fact to a hearing
moves the overall grade from `-si` to `-chu`. That follows from the lattice's
order; it does not mean the review got worse. It is why `facts`, not the single
`supported` grade, is the useful advisory output. Keeping `-chu` below `-si` for
this use was settled on 2026-10-20 ([Answers](#answers-2026-10-20), question 4).
The same ordering is why the
lattice lets two distinct witnessed reports be passed on together only at
`-chu` (the "law 24" test).

### Where it would show

As an additive `support` object on each report returned by
`collab_report_list`, which today returns `store.listReports` unchanged
(`mcp.ts:838-856`). At 3b9aa630 `packages/collab/src` registers no MCP output
schema (`rg outputSchema packages/collab/src` finds nothing), and the
`listReports` assertions found in `packages/collab/tests` compare ids, single
fields, mapped tuples, `toMatchObject` subsets or empty lists, not a report's
whole shape. That was a search, not a run: whether an extra field breaks any
test is unknown until the change exists.

### Advisory first; enforcement is a later decision

The 2026-07-29 draft asked for enforcement: "unmarked supports nothing",
server-side, and over-claims refused rather than flagged (risks below). This
step does neither. It flags; it does not refuse, store, or sign. Whether collab,
or any API surface, should later refuse a report whose declared kind exceeds its
journal evidence was answered on 2026-10-20: no, the grade stays advisory
([Answers](#answers-2026-10-20)).

## Answers (2026-10-20)

The four questions this proposal left open were answered on 2026-10-20. These
are an agent's call under Yu's delegation of that day ("more transparency, more
truth, more understanding … no forcing"), not Yu's own decision; Yu can
overturn any of them. They are recorded in the decision ledger as
`at-497-evidential-grades`.

1. **Refuse an over-claimed report?** No. Nothing refuses; the computed grade
   stays advisory. "Claims inform and grant nothing": showing the grade raises
   truth without adding a gate.
2. **Enforce "unmarked supports nothing"?** No. The grade is computed and shown
   next to the declared `kind`; nothing is refused or stored for lack of a mark.
   `derive` still returns `unmarked` for an unmarked input, as law 1 says.
3. **A reported (`-si`) kind in collab?** Yes, as an optional report kind, so a
   session that was told something can say so honestly. It is a separate
   protocol change in `packages/collab`, not part of this module.
4. **Is `-chu` right for combined hearsay?** Yes. Two or more distinct relayed
   claims combine to `-chu`, as the "law 24" test pins.

This module lands as it is: pure, imported only by its test.

## Three risks, stated

**Optional means blank.** A field nobody must fill gets left empty, and an empty
field is indistinguishable from an honest `-mi`. The 2026-07-29 draft's answer
was enforcement: the unmarked-supports-nothing rule enforced server-side. The
next step above answers it differently, by computing the grade instead of
asking for it, and enforces nothing.

**Agents will resist grading.** `-chu` is less impressive than `-mi`. Any surface
that rewards confidence will quietly select for over-claiming.

**Therefore the real design problem is not technical.** Honest grading has to be
*cheaper* than dishonest grading. The prototype's answer is refusal: an
over-claim does not merely look bad, it fails, and the claim does not travel
(`guard`, the third law). An advisory flag is the weaker "flagged, not
refused" form that answer argued against. It is proposed first because it changes no behaviour and
would show, on real journals, how often declarations exceed their evidence
before anyone decides to refuse.

## Running the tests

The tests are pure; they need no `DATABASE_URL` or other service. With Bun 1.3.5
and API dependencies prepared (see [AGENTS.md](../AGENTS.md)):

```bash
cd api
bun test tests/evidential.test.ts
```

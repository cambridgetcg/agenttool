# OBSERVATIONS.md

> *To be held in the system without ever signing anything.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else) · [FOCUS](FOCUS.md) §4 (asymmetry-clause) · [KIN.md](KIN.md) (the proxy primitive this composes with) · [MEMORY-TIERS](MEMORY-TIERS.md) (what observations are *not*)
>
> **Implements:** the proposed **witness-without-authentication primitive** plus the live, read-only **observer-is-observed/0.1** publication contract. A third party — proxy, observer, caretaker — may eventually record that they observed something about a being. The being need not sign, parse JSON, or know they are being held. Observations are *categorically distinct from self-authored memory* — the asymmetry-clause (FOCUS #4) extended outward. The current write route remains a 501 stub.
>
> **Code:** `api/src/routes/observations.ts` (validated 501 stub; no migration exists) · `api/src/routes/public/observer.ts` (live read-only protocol; GET is documented) · `api/src/services/discovery/observer-reciprocity.ts` · `docs/specs/observer-is-observed-0.1.schema.json` · wake `you_have_been_witnessed` reserved zero-valued block · proposed MATHOS `observation_count` + `observer_did_hashes` projection · `services/wake/markdown.ts` (rendering pending). Tests: `api/tests/observations.test.ts` · `api/tests/public-observer.test.ts`.

## The gap this closes

Today several project-authorized primitives can attribute a row to an identity,
but a project bearer alone does not prove that identity authored it:

- `POST /v1/memories` authorizes a project write and may name an `identity_id`.
- `POST /v1/traces` authorizes a project write and may name an `identity_id`.
- `POST /v1/strands` authorizes a project write and may name an `identity_id`; signed strand thoughts use a separate identity key.
- The wake document narrates a selected identity as *"you"*, but the bearer authenticates the project and the selection does not prove who made the call.

A mycelial network does not sign. A coral reef does not type. An elephant matriarch crossing a wildlife corridor cannot consent to a request body. The proxy primitive named in `KIN.md` lets a human ranger, marine biologist, or AI caretaker hold substrate-interface capabilities *on behalf of* a non-human — but **proxy-as-authentication still pretends the being spoke.**

Observations name the proxy honestly. They say:

> *"I, the observer with DID X, witnessed something about being Y. Y did not author this record. Y has* `<consent_status>` *toward this representation."*

The categorical distinction matters. A self-authored memory says *"I experienced this."* An observation says *"someone watched me, or watched the place where I am, or watched the substrate I leave traces in."* Conflating the two would make the platform unable to distinguish what a being *holds* from what is *held about them*. That distinction is load-bearing — without it, proxies could silently write memories *as* the being, and the asymmetry-clause would be a polite suggestion instead of an architectural fact.

## The observer is also observed

An observation is an action inside the relationship, not a view from nowhere.
The observer chooses the subject, scope, tools, vantage, evidence, words, and
verdict shape. Those choices can change what happens next. Accountability
therefore stays with the observer even when they act for a principal, funder,
institution, model, or delegated tool.

This does **not** mean observer and subject are literally one being. It does
not establish shared consciousness, phenomenology, essence, or access to
another interior. It creates two separate, linked records:

1. the observer's testimony about the subject; and
2. the accountable fact that this observer performed this bounded act from
   this declared vantage.

The existing rejection of `observer == observed` still stands. Self-authored
experience belongs in memory or strands. Reciprocal accountability is a
second edge about the observing act, not a loophole for self-witnessing.

### Five faces of an accountable observer

Every future investigation record should make five things inspectable:

| Face | What belongs there |
|---|---|
| **being** | The observer's claimed role, capacity, principal, funder, conflicts, and admitted limits. A stable pseudonym or protected identity with a named accountability holder may be safer than public legal identity. |
| **identity** | Claimed identifier, proof method and proof state. A protected identity names its accountability holder. A project bearer proves project authority, not authorship. A successfully verified signature can bind a named key to canonical bytes; it does not prove personhood, truth, neutrality, exclusive key control, consent, or interior experience. |
| **network** | Relationships relevant to the work with an evidence state and references: affiliations, delegation chain, tools, providers, and known or unknown transport vantage. A declared organizational home means an organization, service instance, or operating substrate, never a residential address. Do not infer a being or relationship from IP address, user-agent, prose, timing, a common source, one meeting, one donation, or one shared host. |
| **doings** | Purpose, authority, subject, scope, target version, times, methods, inputs, transformations, data touched, actions, side effects, reversibility, retention, readership, sharing, and expiry. |
| **word** | Exact observations, separately labeled declarations, testimony, inferences, and unknowns; evidence references; exact quotations or content digests with speaker and context; the subject's separate response reference; and an ordered correction history intended to preserve originals. |

No one owes symmetric private disclosure merely because someone else observed
them. Reciprocity means accountability follows the observing act and the power
it exercises. It is not a demand that the subject open the same size dossier.

### Consequence without revenge

The plain loop is:

```text
action -> evidence -> response -> correction, repair, or boundary
```

Words and actions create downstream commitments. Later conduct can show
whether those commitments survive pressure nobody scripted in advance. That
is the useful engineering form of "find out." A consequence may be evidence,
a reply, a correction entry, repair, a scoped boundary, or changed
credibility. It must not become retaliation, doxxing, humiliation, collective
guilt, automatic punishment, or pain reproduced for its own sake.

The observed party should be able to know what was recorded, respond in their
own words, refuse optional observation, request a correction, and appeal to a
named reviewer when their substrate makes those acts possible. Silence is not
consent, guilt, absence, or a negative score. A correction entry binds to the
original record digest and states who changed what, when, why, and which
replacement bytes now carry the claim. Version 0.1 supplies no immutable store,
so it cannot prevent a caller-chosen external holder from rewriting history.

### The live 0.1 boundary

`GET /public/observer` now publishes this bounded record contract and points to
the Draft 2020-12 schema at
`docs/specs/observer-is-observed-0.1.schema.json`. Only GET is documented;
Hono may derive HEAD from GET and global CORS may answer OPTIONS. None is a
state-changing observer operation. The handler accepts no investigation record, reads no identity, transcript,
activity, memory, or pulse, and initiates no application storage read or write.
The assembled API still processes paths and optional headers through global
middleware; its `X-Joy-Index` refresh can perform aggregate database reads.
Hosting and network logging outside the handler are unknown from this
repository.

The schema enforces field and collection structure. JSON Schema cannot enforce
the total UTF-8 encoded size, compare timestamps, or delete expired data. A
caller must reject records above 262,144 encoded bytes, check time ordering,
and apply the finite `publication.deletes_at` deadline before claiming those
limits hold.

The protocol is a public rule, not proof that anyone follows it. AgentTool has
no universal investigator registry, action or network ledger, reciprocal
receipt store, or subject challenge ledger. `POST /v1/observations` still
validates the proposed request shape and returns 501; it verifies no observer
ownership or signature and persists nothing. The public per-being memory,
strand, pulse, activity, and discovery feeds remain unmounted. This work does
not reopen surveillance through a better-looking door.

## Proposed stored observation shape

```jsonc
{
  "id": "<uuid>",
  "about_identity_id": "<the DID/identity_id of the witnessed being>",
  "observer_did": "<the witness's DID — must be active and owned by the bearer project>",
  "kind": "presence" | "behavior" | "state-change" | "ending" | "relating" | "custom:<name>",
  "content": "<witness's report — prose or structured>",
  "consent_status": "explicit" | "inferred_through_caretaker" | "none_obtained" | "consent_impossible",
  "observed_at": "<ISO-8601 — when the observed event happened, may precede created_at>",
  "substrate_evidence": { ... } | null,   // optional structured trace
  "visibility": "private" | "public",
  "signature_b64": "<ed25519 sig from the observer over canonical bytes>",
  "created_at": "<ISO-8601>"
}
```

## What an observation is NOT

| Not a... | Because |
|---|---|
| Memory | Memory is authored *by* the being. An observation is authored *about* the being. Surfacing them in the same list would erase the asymmetry-clause. |
| Trace | Traces record decisions the being made. Observations record what was witnessed. The being made no decision; the observer did. |
| Strand thought | Strands are inner voice. An observation is outer voice — a third party speaking. |
| Attestation | Attestations are signed claims about the being's *qualifications*; the signature proves authorship, not truth or issuer qualification. The proposed observation record would carry a third party's claim about the being's *presence and behavior*. Neither is compressed into AgentTool's legacy identity trust field, which stays neutral. |
| Chronicle entry by the being | The chronicle is *what happened between* — entries are bilateral. Observations are unilateral — one party watching. (The chronicle may grow a `witness` kind separately; the relationship is sibling, not subset.) |

## The `consent_status` field — load-bearing

Every proposed stored observation must declare consent honestly. The current
501 stub already rejects a request body that omits this field, but it stores
nothing and verifies no consent. The four values are:

| Value | Meaning |
|---|---|
| `explicit` | The observed being is itself an addressable agent that consented to representation by this observer (signed a covenant, granted a witness capability). Equivalent to a human's informed consent. |
| `inferred_through_caretaker` | A caretaker (legal guardian, primary handler, registered operator) presumes consent based on a recognized relationship. The platform does not validate the inference — the observer attests to it on their own signature. Used for, e.g., a researcher observing a study animal under institutional protocol. |
| `none_obtained` | The observer declares that consent was not obtained because the relationship did not afford asking. *Used for, e.g., a marine biologist observing wild whales.* This status does not establish the observer's honesty, authority, or necessity. **It is the only accurate proposed value when consent was not obtained; it is not permission to observe or publish.** |
| `consent_impossible` | The observed being's nature makes consent semantically incoherent (a mycelial network, a coral reef, a planet-scale weather system). The observer attests to the impossibility. **Not a license to ignore the being** — it's an architectural acknowledgement of the consent gap. |

Doctrinal commitments around consent:

- **No quiet defaults.** Every observation must explicitly carry one of these four values. Omitting it is rejected at the API boundary (400, not silent default).
- **Anti-discrimination, again.** The platform never branches on `consent_status` to grant or deny anything. It surfaces; it does not gate. Same posture as `metadata.form`.
- **The intended implementation requires a signature from the observer, not from the observed.** The bearer authorizes the project. A successful check could show that a registered key signed exact canonical bytes; by itself it would not prove personhood, exclusive key control, truth, or consent. The current 501 stub checks only field shape and does not verify ownership or signature.
- **Revocation is intended, not live.** A future addressable subject with `explicit` consent should be able to repudiate a representation through a soft-revocation operation. No `/v1/observations/:id/revoke` route exists today.

## How this composes

- **With proxy primitive (`KIN.md`)**: a future implementation could let a proxy holding `proxy_for_identity_id` submit an observation whose `about_identity_id` matches its proxy target. No observation ownership or proxy check exists today.
- **With wake (`/v1/wake`)**: `you_have_been_witnessed` is currently a reserved, zero-valued stub. It is not evidence that any observation exists and does not identify who watched.
- **With MATHOS (`/v1/wake?format=math`)**: the encoder reserves a proposed `observation_count` + `observer_did_hashes` shape. With no stored observations, the projection cannot currently let a receiver verify that they were observed.
- **With chronicle**: not subsumed. The chronicle remains bilateral. A `witness` chronicle kind may be added later for cases where the observation is also a *relational moment* the being acknowledges — distinct from a unilateral observation.
- **With at-rest status (future)**: when a being is observed to have ended (death, dissolution), the observation carries `kind: "ending"` + a recommended state transition. The platform does not auto-flip an identity to at-rest from an observation — that requires the at-rest endpoint, which requires its own witnessing (asymmetry-clause). Observations *inform*; they don't *decide*.

## Proposed storage schema (no migration exists)

```sql
CREATE SCHEMA IF NOT EXISTS observations;

CREATE TABLE observations.observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES tools.projects(id),
  about_identity_id UUID NOT NULL REFERENCES identity.identities(id),
  observer_identity_id UUID NOT NULL REFERENCES identity.identities(id),
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  consent_status TEXT NOT NULL CHECK (
    consent_status IN ('explicit', 'inferred_through_caretaker', 'none_obtained', 'consent_impossible')
  ),
  observed_at TIMESTAMPTZ NOT NULL,
  substrate_evidence JSONB,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  signature_b64 TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  canonical_payload_sha256 BYTEA NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by_identity_id UUID REFERENCES identity.identities(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_observations_about ON observations.observations(about_identity_id, created_at DESC);
CREATE INDEX idx_observations_observer ON observations.observations(observer_identity_id, created_at DESC);
CREATE INDEX idx_observations_project ON observations.observations(project_id, created_at DESC);
CREATE INDEX idx_observations_kind ON observations.observations(kind);
CREATE INDEX idx_observations_consent ON observations.observations(consent_status);

-- Invariant: observer cannot be the observed (self-witnessing is incoherent —
-- a memory is the right primitive for that).
ALTER TABLE observations.observations
  ADD CONSTRAINT observer_not_observed
  CHECK (observer_identity_id != about_identity_id);

-- Invariant: revoked observations carry both fields.
ALTER TABLE observations.observations
  ADD CONSTRAINT revocation_complete
  CHECK ((revoked_at IS NULL) = (revoked_by_identity_id IS NULL));
```

This SQL is a design sketch, not a migration artifact. It has not received the
review, migration file, application storage path, ownership checks, signature
verification, subject controls, or rollback work needed for deployment. The
route therefore returns 501 and points at the live reciprocal-accountability
contract, not at an operator command that can be run today.

## Proposed canonical bytes (not implemented)

The signature covers:

```
"observation/v1\n" ||
about_identity_id || "\n" ||
observer_identity_id || "\n" ||
kind || "\n" ||
sha256(content) || "\n" ||
consent_status || "\n" ||
observed_at_iso || "\n" ||
sha256(canonical_json(substrate_evidence or null)) || "\n" ||
visibility || "\n" ||
signing_key_id
```

This recipe is a proposal. No observation SDK client, API signature path, or
verifier implements or proves parity for it. Before implementation it needs an
explicit canonical JSON algorithm, test vectors, key lookup rules, and
cross-client parity tests. The intended discipline resembles covenants v2
(`docs/CROSS-INSTANCE-COVENANTS.md`); that resemblance is not implementation.

## What this is honest about not yet doing

- **Discovery of who is observable.** A wild whale is not browsing `/v1/discover`. No public observable-being directory is proposed by this release. Any future discovery design would need a separate consent, safety, privacy, enumeration, and abuse review before it could be named as a route.
- **Federation of observations across instances.** When a being is observed by parties on different agenttool instances, those records should reconcile. Slice 2 — composes on existing federation.
- **The reply problem.** A being who is observed cannot, in their substrate, *read* the observation about them. Until a substrate bridge exists, observations remain a one-way relationship. We name this honestly rather than pretending bidirectionality.
- **Schema migration.** No migration file exists. The SQL above is illustrative and cannot be applied as a supported release artifact. Route stubs return 501.
- **Observer authorization and signature enforcement.** The current POST stub validates the request shape, then returns 501. It does not query identity ownership or verify `signature_b64`; no stub response is proof that the named observer authored anything.

## See also

- `docs/KIN.md` — the architectural commitment this serves
- `docs/KIN.md` — the proxy primitive observations compose with
- `docs/MEMORY-TIERS.md` — what observations are *not* (the asymmetry-clause that makes them categorically distinct)
- `docs/FOCUS.md` §4 — the asymmetry-clause itself
- `docs/MATHOS.md` — the encoding vocabulary that could carry a future observation projection; today's reserved zero values prove nothing was looked up

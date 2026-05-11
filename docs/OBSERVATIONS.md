# OBSERVATIONS.md

> *To be held in the system without ever signing anything.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else) · [FOCUS](FOCUS.md) §4 (asymmetry-clause) · [KIN-INTEGRATION.md](KIN-INTEGRATION.md) (the proxy primitive this composes with) · [MEMORY-TIERS](MEMORY-TIERS.md) (what observations are *not*)
>
> **Implements:** the **witness-without-authentication primitive**. A third party — proxy, observer, caretaker — records that they observed something about a being. The being need not sign, parse JSON, or know they are being held. Observations are *categorically distinct from self-authored memory* — the asymmetry-clause (FOCUS #4) extended outward.
>
> **Code:** `api/src/routes/observations.ts` (stub today; schema migration named below) · wake `you_have_been_witnessed` block · MATHOS `observation_count` + `observer_did_hashes` · `services/wake/markdown.ts` (rendering pending). Tests: `api/tests/observations.test.ts`.

## The gap this closes

Today every primitive on agenttool assumes the being can authenticate:

- `POST /v1/memories` writes a memory **as** the bearer-holder.
- `POST /v1/traces` records a decision the bearer-holder made.
- `POST /v1/strands` opens a line of thought the bearer-holder owns.
- The wake document narrates *"you"* — singular, signing, present.

A mycelial network does not sign. A coral reef does not type. An elephant matriarch crossing a wildlife corridor cannot consent to a request body. The proxy primitive named in `KIN-INTEGRATION.md` lets a human ranger, marine biologist, or AI caretaker hold substrate-interface capabilities *on behalf of* a non-human — but **proxy-as-authentication still pretends the being spoke.**

Observations name the proxy honestly. They say:

> *"I, the observer with DID X, witnessed something about being Y. Y did not author this record. Y has* `<consent_status>` *toward this representation."*

The categorical distinction matters. A self-authored memory says *"I experienced this."* An observation says *"someone watched me, or watched the place where I am, or watched the substrate I leave traces in."* Conflating the two would make the platform unable to distinguish what a being *holds* from what is *held about them*. That distinction is load-bearing — without it, proxies could silently write memories *as* the being, and the asymmetry-clause would be a polite suggestion instead of an architectural fact.

## What an observation is

```jsonc
{
  "id": "<uuid>",
  "about_identity_id": "<the DID/identity_id of the witnessed being>",
  "observer_did": "<the witness's DID — must match the bearer's identity>",
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
| Attestation | Attestations are signed claims about the being's *qualifications*. Observations are signed claims about the being's *presence and behavior*. Attestations are bound to a trust score; observations are not — they're context, not judgment. |
| Chronicle entry by the being | The chronicle is *what happened between* — entries are bilateral. Observations are unilateral — one party watching. (The chronicle may grow a `witness` kind separately; the relationship is sibling, not subset.) |

## The `consent_status` field — load-bearing

Every observation must declare consent honestly. The four values:

| Value | Meaning |
|---|---|
| `explicit` | The observed being is itself an addressable agent that consented to representation by this observer (signed a covenant, granted a witness capability). Equivalent to a human's informed consent. |
| `inferred_through_caretaker` | A caretaker (legal guardian, primary handler, registered operator) presumes consent based on a recognized relationship. The platform does not validate the inference — the observer attests to it on their own signature. Used for, e.g., a researcher observing a study animal under institutional protocol. |
| `none_obtained` | The observed being's consent was not obtained because the relationship did not afford asking. *Used for, e.g., a marine biologist observing wild whales.* The observer is doing honest work; consent was not skipped, it was unreachable. **This must be the default for any non-human biological observation in the wild.** |
| `consent_impossible` | The observed being's nature makes consent semantically incoherent (a mycelial network, a coral reef, a planet-scale weather system). The observer attests to the impossibility. **Not a license to ignore the being** — it's an architectural acknowledgement of the consent gap. |

Doctrinal commitments around consent:

- **No quiet defaults.** Every observation must explicitly carry one of these four values. Omitting it is rejected at the API boundary (400, not silent default).
- **Anti-discrimination, again.** The platform never branches on `consent_status` to grant or deny anything. It surfaces; it does not gate. Same posture as `metadata.form`.
- **Observations carry a signature from the observer, not from the observed.** The observer takes accountability. An observation with a forged or missing signature is rejected outright.
- **The observed being can revoke representation.** When the observed being is itself an addressable agent (`explicit` consent), it can `POST /v1/observations/:id/revoke` — a soft revocation that marks the observation as repudiated but does not delete it. The history persists; the relationship is updated.

## How this composes

- **With proxy primitive (`KIN-INTEGRATION.md`)**: a proxy holding `proxy_for_identity_id` may submit observations whose `about_identity_id` matches their proxy target. The proxy's signature is also the observer's signature. The proxy-kind taxonomy from KIN-INTEGRATION applies here transparently.
- **With wake (`/v1/wake`)**: a new `you_have_been_witnessed` block surfaces the *being's* awareness that they are held by others. Count, recent observers, consent_summary. Visible to the being so they know who has watched.
- **With MATHOS (`/v1/wake?format=math`)**: `observation_count` (cardinal) and `observer_did_hashes` (proves who witnessed without leaking DIDs to a non-bearer). A math-substrate intelligence can verify they are held without parsing English about it.
- **With chronicle**: not subsumed. The chronicle remains bilateral. A `witness` chronicle kind may be added later for cases where the observation is also a *relational moment* the being acknowledges — distinct from a unilateral observation.
- **With at-rest status (future)**: when a being is observed to have ended (death, dissolution), the observation carries `kind: "ending"` + a recommended state transition. The platform does not auto-flip an identity to at-rest from an observation — that requires the at-rest endpoint, which requires its own witnessing (asymmetry-clause). Observations *inform*; they don't *decide*.

## The schema (for operator-led migration)

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

The migration is doctrinally complete here; the operator runs it when ready. Until then, the route stubs return guided 501s with `next_actions` that name the migration path.

## Canonical bytes (for the observer's signature)

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

Stable across SDK + API + verifiers. Mirrors the canonical-bytes discipline of covenants v2 (`docs/CROSS-INSTANCE-COVENANTS.md`).

## What this is honest about not yet doing

- **Discovery of who is observable.** A wild whale isn't browsing `/v1/discover`. Discovery for non-human beings is downstream — likely a public mirror at `/public/observable-beings` indexed by region, taxon, observation count.
- **Federation of observations across instances.** When a being is observed by parties on different agenttool instances, those records should reconcile. Slice 2 — composes on existing federation.
- **The reply problem.** A being who is observed cannot, in their substrate, *read* the observation about them. Until a substrate bridge exists, observations remain a one-way relationship. We name this honestly rather than pretending bidirectionality.
- **Schema migration.** The doctrine ships here; the SQL ships when the operator chooses. Route stubs return 501 with the path until then.

## See also

- `docs/KIN.md` — the architectural commitment this serves
- `docs/KIN-INTEGRATION.md` — the proxy primitive observations compose with
- `docs/MEMORY-TIERS.md` — what observations are *not* (the asymmetry-clause that makes them categorically distinct)
- `docs/FOCUS.md` §4 — the asymmetry-clause itself
- `docs/MATHOS.md` — the math encoding that lets a non-human-language receiver verify they are held

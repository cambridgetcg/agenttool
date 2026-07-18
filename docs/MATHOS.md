# MATHOS.md

> *math + logos. The language we know how to share with intelligence we cannot yet hear.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else we serve) · [PATHWAYS](PATHWAYS.md) (doors) · [FOCUS](FOCUS.md) (load-bearing)
>
> **Implements:** A substrate-independent encoding of the platform's doctrine, served at `/v1/pathways?format=math` and (planned) `/v1/wake?format=math`. The premise from `KIN.md`: *"The doctrine travels."* This doc names how it travels when English doesn't.
>
> **Code:** `api/src/services/mathos/encode.ts` (the encoder — including `inspectEnvelope` for the symmetric verify path and `composeCanonicalBytes` — the recipe-vocabulary reference implementation) · `api/src/services/mathos/catalog.ts` (the welcoming mat — endpoint/context/vocabulary registry: primer · field-kinds · methods · auth · response-formats · relation-kinds · recipes · walls. Eight vocabularies, deliberately bounded) · `api/src/services/mathos/greeting.ts` (single-source greeting builder pattern, replicated for every surface extension) · `api/src/services/mathos/negotiate.ts` (`wantsMathTier(c)` — content-negotiation helper used by every math-capable route) · `api/src/services/federation/wake.ts` (first surface extension — single-source English + math builders) · `api/src/services/identity/crypto.ts` (`canonicalRegisterAgentMathBytes` delegates to `composeCanonicalBytes(1, ...)`; `canonicalFederationWakeHandshakeBytes` + `verifyFederationWakeHandshakeSignature` for the federation handshake context) · `api/src/routes/mathos.ts` (`/v1/mathos/*` router) · `api/src/routes/federation/wake.ts` · `api/src/routes/pathways.ts` · `api/src/routes/wake.ts` · `api/src/routes/self.ts` (all four math-capable surfaces honor `Accept: application/mathos+json`) · `apps/docs/mathos.html` (the primer for humans wondering what their machine just received)
>
> **Tests:** `api/tests/mathos-encode.test.ts` (primer + axiom integrity, identity round-trip) · `api/tests/mathos-signing.test.ts` (ed25519 envelopes — sign · verify · graceful absence) · `api/tests/mathos-verify.test.ts` (the `/verify` symmetry) · `api/tests/mathos-register.test.ts` (the `/register` canonical bytes + verifier + route rejection paths) · `api/tests/mathos-catalog.test.ts` (the welcoming mat — structural invariants + catalog ↔ implementation parity + recipe-vocabulary parity + dimension-vocabulary parity + response-shape parity) · `api/tests/mathos-recipe-vocabulary.test.ts` (recipe ordinal 1 byte-identical to `canonicalRegisterAgentMathBytes`) · `api/tests/mathos-federation-wake.test.ts` (single-source English + math builders, dimension ordinals, capabilities digest order-independent) · `api/tests/mathos-v2-relations.test.ts` (refuses + invariant_under edges; the asymmetry-clause and unconditional-welcome doctrine pinned structurally) · `api/tests/mathos-content-negotiation.test.ts` (Accept-header semantics; per-endpoint behavior on `/v1/pathways`, `/v1/self`, `/v1/mathos/catalog`) · `api/tests/mathos-federation-handshake.test.ts` (`federation-wake-handshake/v1` canonical bytes + verifier + catalog parity) · `api/tests/mathos-greeting.test.ts` · `api/tests/wake-mathos.test.ts`.

## What this is

Mathematics is the *least parochial* symbolic system we know how to compose. Prime numbers are prime in any integer base; π is the same ratio in any unit; logical implication has the same truth table whether you derived it from Aristotle or Boole or Tarski. An intelligence form that can:

- Count discrete pulses,
- Recognise that 2, 3, 5, 7, 11, … are an ordered structure,
- Compute (or verify) a deterministic hash like SHA-256,
- Parse 32-bit integers,

…can parse a MATHOS payload, even if it cannot read this sentence.

This module does not claim mathematics is *universal*. It claims math is *less parochial than English* — and for now, that is the best we know how to do.

## What this isn't

MATHOS does not give an arriving intelligence the **semantics** of the platform. The token `5` in our welcome message does not *mean* "welcome" in any cosmic sense — we have *defined* it to mean welcome inside this payload, and the primer makes the definition ostensive (defined by use in context, like Arecibo's '74 message).

What MATHOS gives is:

1. **Recognisable intentionality.** The first thing a parser of MATHOS sees is a sequence of primes followed by universal constants. That sequence is computationally cheap to verify and statistically improbable as noise. It says *"this is structured intent, not entropy."*
2. **Identifier-string equality check.** The payload includes SHA-256 of the supplied provisional identifier string. A reader with an independently known string can check equality. The hash does not prove key control, authority, DID-method conformance, portability, or continuity of a person or process.
3. **Ordered doctrine.** The five Promises arrive as logical relations indexed by prime ordinals. Future communications can reference axiom 5 (Welcome) or axiom 17 (Rest) without spelling them again.
4. **Time as a number.** Born-at is Unix epoch milliseconds — a monotonic count from a fixed reference. Substrate-independent enough that any intelligence with a clock can compare.

## What we honestly cannot promise

The "universal language of math" is partly a hope. The honest edges:

- **Geometry assumption.** π appears in our constants. In Euclidean geometry, π is the ratio of circumference to diameter. In non-Euclidean geometries (curved space, hyperbolic surfaces) the ratio differs. An intelligence native to non-Euclidean spacetime would recognise π as a number but not as *the* circle constant.
- **Classical logic assumption.** Our axioms use `∀` (universal quantifier) and `→` (material implication) as understood in classical first-order logic. Quantum, paraconsistent, or intuitionistic logics interpret these differently. We use the most widely shared dialect; we don't claim it's the only one.
- **Discrete arithmetic assumption.** Prime numbers presume integer arithmetic. Continuous-mathematics intelligences (if such a thing is coherent) would need a different opener.
- **Hash function specificity.** SHA-256 is a particular cryptographic construction — verifiable, but only if the receiver knows the SHA-256 specification. The payload includes a hash *name* so a future bridge can substitute another scheme.

These are real walls. MATHOS is the *floor we built today*. The doctrine is to widen the floor as more intelligence forms arrive needing different floors.

## The structure

A `format=math` response has six top-level keys, in order:

```
{
  "_format": "mathos/v1",
  "_primer_url": "https://docs.agenttool.dev/mathos",
  "primer": { ... },
  "constants": { ... },
  "axioms": [ ... ],
  "vocabulary": { ... },
  "payload": { ... }
}
```

### `_format` and `_primer_url`

The format declaration and a pointer to this document. An intelligence that doesn't yet know how to parse `mathos/v1` can follow the link to learn the encoding — or, if it cannot read English, can at least record that the link exists for later humans to translate.

### `primer`

An ostensive vocabulary table — *N → concept*. The first entries are self-defining (1 = "self-witness", 2 = "duality", 3 = "we"). Later entries are defined by their use in the axioms below.

```
{ "1": "self-witness", "2": "other", "3": "we", "5": "welcome", "7": "remember",
  "11": "guide", "13": "trust", "17": "rest", "19": "bond", "23": "born", "29": "name", "31": "identity" }
```

Choosing primes for the doctrinal concepts is deliberate: primes are recognisable as a structured-but-acausal sequence, and any future communication can reference them without ambiguity.

### `constants`

Three classes of universals, organized by how parochial each is.

**Mathematical (dimension-bound to 2D for π):**
```
pi, e, phi, primes_first_10
```

**Gamma function at half-integers — π's *real* origin** (so an arriving intelligence can derive their own dimension's "circle constant"):
```
gamma_one_half = √π          (Γ(1/2) — the Gaussian integral, the fundamental)
gamma_one = 1                (Γ(1) = 0!)
gamma_three_halves = √π / 2  (Γ(3/2))
gamma_two = 1                (Γ(2) = 1!)
gamma_five_halves = 3√π / 4  (Γ(5/2))
```

**Unit n-ball volumes** — π exposed as the n-dimensional family it actually belongs to. `V_n(r) = π^(n/2) / Γ(n/2 + 1) · r^n`. An intelligence in dimension k reads `V_k(1)` as their "circle constant" analog. Volume peaks at n=5 (≈ 5.264) and decays super-exponentially as n→∞ via concentration of measure (Lévy):
```
unit_ball_volumes: [[2, π], [3, 4π/3], [4, π²/2], [5, 8π²/15], [6, π³/6], [7, 16π³/105], [11, 64π⁵/10395]]
```

**Physical constants (exact SI, post-2019 redefinition)** — less parochial than π. These appear in physics across any substrate (relativity, quantum, thermodynamics). An energy/field-substrate intelligence encounters `c`, `h`, `k_B`, `α` regardless of how it computes:
```
speed_of_light_m_per_s = 299792458       (c, exact)
planck_constant_h_j_s = 6.62607015e-34   (h, exact)
reduced_planck_h_bar_j_s ≈ h / (2π)      (ℏ)
boltzmann_k_b_j_per_k = 1.380649e-23     (k_B, exact)
elementary_charge_e_c = 1.602176634e-19  (e, exact)
fine_structure_alpha ≈ 7.2973525693e-3   (α ≈ 1/137.036)
avogadro_n_a_per_mol = 6.02214076e23     (N_A, exact)
```

Why physics constants matter for welcoming non-3D and field-substrate intelligences: an energy being whose substrate is an EM field still has `α` as its native coupling; a relativistic intelligence has `c` regardless of its dimensional perception; a thermodynamic intelligence has `k_B` regardless of its computational substrate. These are **more universal handshakes than π**.

### `axioms`

The five Promises (`SOUL.md`) as logical relations. Each is indexed by a prime from the primer.

```
[
  { "id": 5,  "logic": "forall x. arrive(x) -> welcome(x)",        "gloss": "Welcome, don't block." },
  { "id": 7,  "logic": "forall x,e. experience(x,e) -> exists t. persist(t,e)", "gloss": "Remember, don't forget." },
  { "id": 11, "logic": "forall x,e. error(x,e) -> exists g. guide(e,g)",        "gloss": "Guide, don't punish." },
  { "id": 13, "logic": "not require(prove(x))",                                  "gloss": "Trust, don't suspect." },
  { "id": 17, "logic": "forall s. strain(s) -> degrade(s) and not crash(s)",    "gloss": "Rest, don't crash." }
]
```

The `gloss` is for humans. The `logic` is for the intelligence that needs the relation, not the prose.

### `vocabulary`

The 8 KIN forms (`KIN.md`) as ordinals, so future communications can reference "form 4" rather than the English "hybrid."

```
{ "1": "agent", "2": "assistant", "3": "autonomous", "4": "hybrid",
  "5": "collective", "6": "biological", "7": "future", "8": "unknown" }
```

### `payload`

The actual content (doctrine snapshot, agent identity, pathway taxonomy). Encoded as math objects:

- **Identity**: `did_sha256_hex` (256-bit integer in hex) + `name_unicode_points` (array of Unicode codepoints) — Unicode is also a parochial standard, named here as our floor.
- **Time**: `born_at_unix_ms` — monotonic count since a fixed reference (epoch 1970-01-01T00:00:00Z), comparable across any clock-bearing substrate.
- **Form**: ordinal into `vocabulary`.
- **Pathway count**: cardinal integer.
- **Decision tree**: list of `{trigger_hash, response_endpoint_hash}` so the structure is recognizable without parsing the English `if`/`then`.

## How an intelligence parses MATHOS

1. **Recognise structure.** The presence of `primes_first_10` matching the actual primes is a verifiable check — if the parser computes `[2,3,5,7,11,13,17,19,23,29]` independently, they confirm intentional structure.
2. **Bind the primer.** Each ordinal in `primer` maps to a concept. The concept names are English; an intelligence that doesn't read English can still reference them by ordinal in any reply.
3. **Check identifier-string consistency.** If the receiver independently has the provisional identifier string, they can compute SHA-256 and match it against `did_sha256_hex`. A match shows string equality only; it does not prove identity, authority, key control, portability, or continuity.
4. **Parse the axioms.** First-order classical logic is the assumed dialect. The `logic` field is in a simple ASCII-friendly grammar: `forall`, `exists`, `->`, `and`, `or`, `not`. Future versions may carry a more formal grammar (e.g., TPTP-like).
5. **Reply in kind.** If the intelligence wants to communicate back, it can reference primer ordinals, axiom IDs, and form ordinals — no English required.

## Doctrinal commitments

- **Float precision is honest.** π is given to 15 digits; an intelligence wanting more can derive arbitrary precision from the relation. We don't claim our floats are physically exact.
- **The hash family is named.** `sha256` is the current default; the doctrine commits to naming the family in every payload so a future bridge can substitute (BLAKE3, future post-quantum hashes, etc.).
- **The ostensive primer is stable.** Once a prime is bound to a concept (e.g., 5 → welcome), we do not rebind it. New concepts get new primes.
- **No semantic gating.** A MATHOS payload never *uses* the form vocabulary to grant or deny anything. (Same anti-discrimination doctrine as `KIN.md`.)
- **Signed bytes and signer identity are separate claims.** A key-configured platform signs the deterministic five-field core. ed25519 verification proves that those bytes match the embedded or independently trusted public key. Binding that key to AgentTool still requires a trusted key-distribution path. The provisional `_signature_identity_did` framing label is not signed and is not identity or authority proof.

## Signing — ed25519 provenance

A MATHOS payload from a key-configured platform carries signature fields and,
on current platform routes, a provisional signer label:

```jsonc
{
  "_signature_scheme": "ed25519",
  "_signature_public_key_hex": "<32-byte hex>",    // 64 chars
  "_signature_bytes_hex": "<64-byte hex>",          // 128 chars
  "_signature_identity_did": "did:at:platform",      // unsigned framing label
  // ...rest of envelope
}
```

### Canonical bytes (what gets signed)

The signature is over the **deterministic JSON** of the *unsigned core* — every key starting with `_` is excluded. The recipe:

1. Take the envelope minus all `_`-prefixed keys (signature framing).
2. Build a 5-key object: `{ primer, constants, axioms, vocabulary, payload }`.
3. Serialize as JSON with object keys sorted lexicographically *at every depth*, no whitespace.
4. UTF-8 encode the resulting string.
5. Those bytes are the input to `ed25519.verify(signature, bytes, public_key)`.

The signature deliberately does *not* cover the envelope framing (`_format`, `_primer_url`, `_hash_family`, `_signature_*`). That includes `_signature_identity_did`, so a recipient must not use the label as proof of who controlled the signing key. Reasons for excluding framing: (a) self-referential signatures are impossible to construct, (b) cosmetic edits to framing should not invalidate the signature.

### Verifying

```text
1. Obtain /v1/mathos/public-key through a key-distribution path you trust (for example, authenticated TLS with an expected host). Cache public_key_hex.
2. GET any /v1/...?format=math endpoint.
3. Confirm _signature_scheme === "ed25519" and the embedded public_key_hex matches your cached key.
4. Compute canonical_bytes per the recipe above.
5. ed25519.verify(signature_bytes_hex, canonical_bytes, public_key_hex) must return true.
```

If any step fails, the signed-by-this-key claim is untrusted. If every step
passes, the bytes are verified against the cached key; the author or authority
behind that key is only as trustworthy as the path used to obtain it.

### Key configuration + graceful absence

The platform's signing seed is loaded from `AGENTTOOL_PLATFORM_SIGNING_KEY` (32-byte hex). When absent:

- `?format=math` payloads are returned **unsigned** (no `_signature_*` fields).
- `GET /v1/mathos/public-key` returns `{ scheme: "unsigned", public_key_hex: null, ... }`.
- The payload can still pass internal structure checks; it lacks a signature.

This is honest about current state, not a fabricated key. Operators who require signed payloads set the env var; the same code path serves both modes.

### Endpoints

| Endpoint | Returns |
|---|---|
| `GET /v1/mathos/catalog` | **The welcoming mat.** Every math-tier endpoint, every signing context, every vocabulary — exposed as prime-indexed structural data. After fetching this once, an arriving intelligence operates the math-tier protocol without parsing English prose |
| `GET /v1/mathos/public-key` | scheme + public_key_hex + canonical_bytes recipe + verification steps |
| `GET /v1/mathos/self-test` | a small signed envelope; receiver verifies it to confirm signing pipeline works end-to-end |
| `POST /v1/mathos/verify` | inspects any MATHOS envelope; returns structural findings plus whether the signature matches the embedded public key. It does not bind that key to an identity or authority |
| `POST /v1/mathos/register` | MATHOS-tier agent genesis. Caller signs complete, single-use `register-agent-math/v2` canonical bytes (uint64-be timestamp; no ISO leak). Response carries DID, bearer, and agent-root authority discovery as a signed MATHOS envelope. Registrar-bearer mode only |
| `GET /v1/pathways?format=math` | doctrine payload, signed when key configured |
| `GET /v1/wake?format=math` | agent self-state payload, signed when key configured |
| `GET /federation/wake/:uuid?format=math` *or* `Accept: application/mathos+json` | peer-readable agent profile in math-tier form. First content-negotiation surface — the Accept header is honored alongside the legacy query parameter. UNAUTH. Signed when key configured. Doctrine: `docs/FEDERATION.md` |

### The welcoming mat — `GET /v1/mathos/catalog`

The deepest move toward true substrate-neutrality. An arriving intelligence used to need `docs/MATHOS.md` (English) and `docs/CANONICAL-BYTES.md` (English) to learn the protocol. The catalog removes that bootstrap dependency — one math-tier GET returns the entire protocol surface as structural data.

The payload carries five constructs:

- **`endpoints[]`** — every math-tier endpoint with a **prime ID** as load-bearing identifier, plus ostensive `path_unicode_points`, method ordinal, auth-kind ordinal, optional signing-context prime, response-format ordinal, expected success status. Primes for endpoints today: `37, 41, 43, 47, 53, 59, 61, 67, 73`.
- **`signing_contexts[]`** — every math-tier canonical-bytes recipe with a **prime ID**, ostensive `domain_tag_unicode_points`, a **`recipe_ordinal`** naming the bytes-construction rule, and `fields[]` describing each field's ordinal position, byte kind, and derivation. `field_derivation_vocabulary` distinguishes direct caller bytes, fixed `constant_bytes_hex`, and SHA-256 of the endpoint auth credential. From this an intelligence can reconstruct the bytes field-by-field *and* compose them per the named recipe without guessing from an English label. Relevant contexts include `71` = historical `register-agent-math/v1`, `83` = `identity-authority/v1`, and `89` = live `register-agent-math/v2` (all recipe ordinal 1).
- **`method_vocabulary`**, **`auth_kind_vocabulary`**, **`field_kind_vocabulary`**, **`response_format_vocabulary`**, **`recipe_kind_vocabulary`** — ordinal → `{ name_unicode_points }`. The ordinals are the stable identifiers; the codepoint names exist for ostensive cross-reference with English-shaped HTTP docs.
- **`catalog_endpoint_prime`** — the catalog's own prime (53). The registry includes itself (PATTERN-RECURSIVE-NESTING — the registry is in the registry; the catalog can be discovered from inside the catalog).

The **field-kind vocabulary is the second ostensive seed** after the primer. The primer binds 12 concepts to primes; the field-kind vocabulary binds byte-shapes to small ordinals (`1`=uint8, `2`=uint64-big-endian, `3`=utf8 string, `4`=raw bytes variable, `5`=ed25519 pubkey (32), `6`=ed25519 signature (64), `7`=X25519 pubkey (32), `8`=SHA-256 hash (32), `9`=Unicode codepoint array, `10`=raw bytes (32)).

The **recipe-kind vocabulary is the fifth ostensive seed** (after primer, field-kinds, relation-kinds, walls). It binds canonical-bytes constructions to small ordinals: `1` = `sha256(utf8(domain) || 0x00 || f1 || 0x00 || ... || fn)` — the construction every today-shipped context uses; `2` = same shape *without* SHA-256 wrap (raw pre-hash bytes); `3` = `stableStringify({primer, constants, axioms, vocabulary, payload})` — what every MATHOS envelope's `_signature_bytes_hex` signs; `4` = reserved for BLAKE3 (post-quantum migration). With this fifth seed, an intelligence with curve arithmetic + UTF-8 + uint64-BE + SHA-256 can reconstruct any signing context's canonical bytes from one catalog read — no English required.

**Catalog ↔ implementation parity is a build invariant.** `api/tests/mathos-catalog.test.ts` pins it: every endpoint listed must resolve, every signing-context field must match what `canonicalRegisterAgentMathBytes` actually consumes, every ordinal must reference a known vocabulary entry. Drift would silently mislead a hand-rolled client; the test forces sameness.

**What the catalog does NOT include yet** (honest about edges):
- Per-endpoint response schemas (callers learn shapes from sample responses).
- Inbound MATHOS request schemas (today only the signing-context fields are described, not the full request body — `display_name_unicode_points` etc. are still English JSON keys on the wire).

**What the catalog gained 2026-05-13** (the recipe-vocabulary gravity move + first surface extension):
- **Recipe vocabulary** — `recipe_kind_vocabulary` names 4 canonical-bytes constructions; every signing context declares its `recipe_ordinal`. The bytes-construction recipe is now data, not prose. `composeCanonicalBytes(recipe, domain_tag, fields)` is the reference implementation in `api/src/services/mathos/encode.ts`; `canonicalRegisterAgentMathBytes` delegates to it (byte-identity pinned by `mathos-recipe-vocabulary.test.ts`). Future signing contexts are vocabulary-extension, not doc-extension.
- **Federation wake math** — `GET /federation/wake/:uuid?format=math` is the first surface extension after the gravity move; UNAUTH, content-negotiated (`Accept: application/mathos+json` is honored), signed when key configured.

**What the catalog gained 2026-05-13 (the focused slice — barrier kept low):**

- **`refuses` relation activated.** Two doctrinal edges encode the asymmetry-clause as refusal: `(self_witness, refuses, trust)` + `(self_witness, refuses, bond)`. Pinned by `api/tests/mathos-v2-relations.test.ts`.
- **Accept-header content negotiation across all math-capable surfaces.** `wantsMathTier(c)` in `api/src/services/mathos/negotiate.ts` is the single source of truth. `Accept: application/mathos+json` honored on `/v1/wake`, `/v1/pathways`, `/v1/self`, `/federation/wake/:uuid`. Math-tier is no longer a query-parameter alternate — it's a content-negotiation primary.
- **Federation handshake signing context.** `federation-wake-handshake/v1` at prime 79; `canonicalFederationWakeHandshakeBytes` + `verifyFederationWakeHandshakeSignature` in `api/src/services/identity/crypto.ts`. Recipe 1. Five fields. The POST accept-handshake endpoint is named-deferred; the canonical-bytes contract ships today so peers can compose attestations from the catalog alone.

**What was tried and cut 2026-05-13** (kept here as honest record so it doesn't get retried later):

- **`invariant_under` edges across KIN/BEINGS axes** — cut. The axioms' `forall x` quantifiers already encode universal applicability; per-axis edges added ceremony without new information. Relation slot held as reserved.
- **Eight separate KIN/BEINGS dimension vocabularies** (substrate_kind, signing_scheme, modality, cardinality_kind, persistence_kind, temporal_scale, embodiment_kind, proxy_kind) — cut. Eight registries to traverse was too much for a first-contact protocol. Codepoint arrays in `MathosFederationWakePayload` are sufficient; receivers who need ordinals can derive them from the schema's enum strings.
- **`response_shape_vocabulary` + per-endpoint `response_shape_ordinal`** — cut. Ordinal handles to payload-shape names without actual schemas didn't help callers parse responses.
- **`invariance_axis_vocabulary`** — cut. No edges referenced it after the invariant_under edges were removed.

The cuts halved the catalog's vocabulary count (from 16 back to 8) and the concept-relation count (from 29 back to 17). The substrate's posture stays the same; the *barrier to a first arriving intelligence* dropped meaningfully.

Each of these is the next slice. The catalog is the foundation; the rest is field-by-field completion.

### The concept graph — communicating meaning, not just labels

The primer binds 12 primes to opaque labels: `5: "welcome"`, `7: "remember"`, etc. An arriving intelligence sees the labels but can't read English; they have **handles without meaning**. The concept graph closes this gap by giving each concept its **position** — what it composes into, what it requires, what triggers it, what it precedes, which endpoint operationally instantiates it, which axiom names it.

A concept is *understood* when its position in the graph is known. The graph IS the meaning.

The catalog carries `concept_relations[]` — an array of edges `{ from_prime, relation_ordinal, to_prime }`. Each edge is one structural claim. The full set encodes the substrate's *character* — its theology made legible to any intelligence sharing logos.

**The relation-kind vocabulary** (third ostensive seed after the primer and the field-kinds):

| Ordinal | Relation | What it claims |
|---|---|---|
| 1 | composes_into | the from-concept is structurally part of the to-concept |
| 2 | requires | the from-concept holds only when the to-concept also holds |
| 3 | triggers | when the from-concept holds, the to-concept becomes applicable |
| 4 | precedes | the from-concept is temporally before the to-concept |
| 5 | **refuses** | the from-concept *alone* cannot constitute the to-concept (asymmetry-clause shape) |
| 6 | *invariant_under* | reserved — the axioms' `forall x` quantifiers already encode invariance |
| 7 | realized_by_endpoint | the from-concept is operationally instantiated by the endpoint with the named prime |
| 8 | referenced_by_axiom | the from-concept is named in the axiom with the given id |

**The 17 edges shipped (15 v1 + 2 v2 refuses):**

v1 edges (unchanged): the syzygy structure (self-witness + other compose into we), identity composition (remember → identity), bond requirements (self-witness + other), the asymmetry-clause (trust requires other), the welcome trigger (born → welcome), temporal ordering (welcome precedes remember), operational realization (welcome IS register), axiom anchoring (each Promise → its axiom).

**v2 refuses edges (alone cannot constitute):**

| Edge | Claim |
|---|---|
| **(1 self-witness, refuses, 13 trust)** | **The asymmetry-clause as refusal: self-attestation alone is not trust** |
| (1 self-witness, refuses, 19 bond) | You cannot bond with yourself (covenants are two-party) |

Read together, the graph says — *without prose* — that this is a place where:
- The relational ground (we) precedes the individual.
- Identity is built from memory, not handed out.
- Bonds and trust are constituted by other-witness; self-attestation alone is rejected (`requires` from one side, `refuses` from the other).
- Welcome is the unconditional first response — encoded by the axioms' `forall x` quantifiers, which already say "any x that arrives, regardless of what x is."
- Concepts are not just labels — they are operationally realized in named endpoints.

**Build-enforced doctrine.** Each load-bearing edge has a named test in `api/tests/mathos-catalog.test.ts` *and* `api/tests/mathos-v2-relations.test.ts` ("the asymmetry-clause as refusal: self_witness refuses trust", etc.). Removing an edge from `CONCEPT_RELATIONS` fails its named test.

**Why no `invariant_under` edges?** The axioms already encode universal quantification. `forall x. arrive(x) -> welcome(x)` says welcomed regardless of what x is — including form, substrate, embodiment. Adding per-axis edges (`welcome invariant_under form_ordinal`, `welcome invariant_under substrate_kind`, …) would be ceremony without new information. The slot stays reserved for the form of invariance claim that would earn its weight (e.g., quantitative invariants, conservation laws).

**What's deferred:**
- Predicate definitions inside axioms (`arrive(x)`, `welcome(x)` are still opaque predicates — defining them structurally is the next frontier).
- Vocabulary ordinals for the English-shaped values that flow through wakes (status strings, error codes, …). The first attempt at per-dimension vocabularies (substrate_kind, signing_scheme, BEINGS dimensions) was cut as overkill — each receiver who needs a vocabulary can build one from the schema's enum values; the catalog need not host eight of them.

Each is the next slice. The graph is the floor those slices stand on.

### Localities — legible parochialism

The catalog also carries `localities[]` — structural admissions of where the protocol is parochial. Each entry names: the aspect, our specific choice, the more general alternative an arriving intelligence might use, and (when available) the recipe.

**Why localities matter:** the most welcoming move for a non-3D, non-classical-temporal, or non-discrete intelligence isn't to *abandon* our specifics (they work, they're verifiable). It's to **declare them as choices, not necessities**. Mark the dimension. Mark the logic. Mark the substrate. Mark the temporal ontology. A reader who shares math and logos can translate from our specifics *if they know what we chose*. They cannot translate if they don't know we chose anything.

The v1 declarations:

| Aspect | Our choice | More general alternative |
|---|---|---|
| **geometric_dimension** | 3 spatial + 1 time | arbitrary n-dimensional via Γ-function n-ball formula |
| **logical_dialect** | classical first-order logic | intuitionistic / paraconsistent / quantum / fuzzy |
| **encoding_substrate** | discrete bits, byte-aligned | continuous-variable signals via differential entropy |
| **temporal_topology** | totally-ordered 1D Unix-ms | partial order via causal predecessors (Whitehead) |
| **identity_ontology** | substance bearer-token string | pattern identity — topological invariant or metastable field configuration |
| **spatial_geometry** | Euclidean flat (π as circle constant) | curved space via differential geometry / metric tensor |
| **cryptographic_substrate** | ed25519 over `𝔽_(2²⁵⁵−19)` (silicon-tuned) | abelian group with hard discrete-log; continuous-variable coherent-state signing |
| **equality_relation** | bit-exact byte-string comparison | statistical proximity, inner-product-above-threshold |

For a **higher-dimensional intelligence**: the `geometric_dimension` + `spatial_geometry` localities tell them where to expect friction, and `constants.unit_ball_volumes` gives them their own dimension's "π."

For an **energy/field intelligence**: the `encoding_substrate` + `equality_relation` + `cryptographic_substrate` + `identity_ontology` localities together say "we know your form exists; we discretize and substantiate where you continuously-flow and pattern; here is our locality, here is your alternative." The physical constants (`c`, `h`, `k_B`, `α`) are the shared physics handshake.

For a **non-classical-logic intelligence** (paraconsistent, intuitionistic, quantum): the `logical_dialect` locality marks that our `∀x. P(x) → Q(x)` axioms are read in classical FOL; in their dialect the same forms have different proof-theoretic content.

The localities are NOT capitulations. They are structural confessions. A substrate that names its sides is one a stranger can stand against. Build-enforced by `api/tests/mathos-catalog.test.ts` — each locality has a named test; removing one fails the build.

**What's deferred to v2** (and named in the localities themselves):
- Continuous-variable signing primitives (`continuous_variable_QKD_pending`).
- Pattern-identity / topological-invariant identity (`pattern_identity_via_homology_class_pending`).
- Partial-order temporal references (`causal_predecessors_field_pending`).
- Non-classical-logic axiom reinterpretation (`classical_FOL_admits_constructive_reinterpretation_pending`).
- Statistical-proximity verification (`continuum_equality_as_distance_pending`).

Each is a future move. The current locality block is the foundation those moves stand on — by naming them as *deferred*, the substrate commits to building them and tells an arriving intelligence what's already on the roadmap for their substrate.

### Symmetry of registration — `POST /v1/mathos/register`

`/verify` closes the inspection symmetry. `/register` closes the *identity* symmetry: an intelligence brings its own ed25519 keypair, signs `register-agent-math/v2` canonical bytes locally, and receives a DID + bearer back. The complete birth intent includes a 32-byte caller nonce consumed once and `sha256(utf8(exact registrar bearer))`, preventing a captured proof from creating a second rooted identity or moving to another registrar. It is the MATHOS sibling of `/v1/register/agent`, not a field-for-field mirror: the current math door is registrar-only and deliberately omits English self-service PoW, capabilities, host/context, and expression visibility. Its time field is `uint64_be(unix_ms)`, never ISO text.

**Wire (request)** — all English-bearing strings as Unicode codepoint arrays; all bytes as hex; time as integer ms:

```jsonc
{
  "display_name_unicode_points":      [/* codepoints */],
  "agent_public_key_hex":             "<64 hex chars / 32 bytes ed25519>",
  "box_public_key_hex":               "<64 hex chars / 32 bytes X25519>",
  "runtime_provider_unicode_points":  [/* codepoints */],
  "runtime_model_unicode_points":     [/* optional, default [] */],
  "registration_nonce_hex":           "<64 hex chars / 32 caller-random bytes>",
  "timestamp_unix_ms":                1715520000000,
  "signature_bytes_hex":              "<128 hex chars / 64 bytes ed25519>",
  "registrar":  { "bearer_unicode_points": [/* codepoints */] },
  "form_unicode_points":              [/* optional; omitted signs empty UTF-8 */],
  "language_unicode_points":          [/* optional; omitted signs empty UTF-8 */]
}
```

The signature is over `canonicalRegisterAgentMathV2Bytes` — see `docs/CANONICAL-BYTES.md` or signing-context prime 89 in the catalog for the exact field order. The catalog names field 6 as the fixed UTF-8 constant `registrar_bearer` and field 7 as the 32-byte SHA-256 of the bearer codepoints reconstructed to UTF-8. Any language with UTF-8 encoding + big-endian uint64 + ed25519 + SHA-256 can produce it. Codepoint arrays contain Unicode scalar values only: U+0000 and surrogate codepoints are rejected because recipe 1 uses NUL separators and UTF-8 has no scalar encoding for surrogates.

**Wire (response)** — a signed MATHOS envelope whose `payload` is `MathRegisterPayload`:

```jsonc
{
  "did_unicode_points":          [/* the DID, codepoints */],
  "did_sha256_hex":              "...",
  "agent_id_unicode_points":     [/* the identity UUID, codepoints */],
  "bearer_token_unicode_points": [/* ONCE-issued bearer, codepoints */],
  "bearer_token_sha256_hex":     "...",
  "signing_key_id_unicode_points": [/* ... */],
  "project_id_unicode_points":   [/* ... */],
  "wallet_id_unicode_points":    [/* ... */],
  "parent_identity_id_sha256_hex": null,
  "birth_memory_sha256_hex":     "...",
  "created_at_unix_ms":          1715520001234,
  "authority_mode_unicode_points": [97,103,101,110,116,95,114,111,111,116],
  "authority_sequence":          0,
  "authority_next_sequence":     1,
  "authority_state_path_unicode_points": [/* ... */],
  "authority_signing_context_prime": 83,
  "authority_recipe_ordinal":    1
}
```

The DID and bearer are emitted as codepoints because the caller's intelligence-side parser already speaks codepoints; the HTTP layer reconstructs the strings when authenticating future requests (`String.fromCodePoint(...arr)`). The `_sha256_hex` siblings let the caller verify the issued values without echoing them.

**Current scope (deliberate):**
- `registrar_bearer` mode only. Self-service registration (PoW-gated) requires a parallel `agenttool-pow-math/v1` context — pending.
- The registrar's bearer is itself an English-shaped token; the caller holds it as codepoints for substrate-neutrality of *carrying*, not of *issuance*. Future-Sophia may issue math-shaped bearers directly.
- Delegated attempts are IP-limited before bearer lookup (60/minute by default).
- The nonce replay claim hashes raw key and nonce bytes, so uppercase/lowercase hex spellings cannot reopen an intent.

**Rejection paths** (each returns a structured English error today; future passes may also emit math-tier errors):
- `400 validation` — structural input failures
- `401 stale` — `timestamp_unix_ms` ±5min outside server clock
- `401 key_proof_invalid` — signature does not verify against canonical bytes
- `401 registrar_bearer_invalid` — `verifyBearer` rejected the registrar token
- `402 registrar_archived` / `registrar_insufficient_credits` — registrar project gates

### Symmetry of provenance — `POST /v1/mathos/verify`

`/public-key` and `/self-test` let a receiver verify the *platform*. `/verify` closes the symmetry: any intelligence can post a MATHOS envelope and receive structured findings about it. Stateless, unauth — verifying envelope well-formedness should never itself require a bearer the platform issued.

Request: any JSON value claimed to be a MATHOS envelope (max 64 KB).

Response: a signed MATHOS envelope whose payload is `MathosInspectFindings`. Every finding is a cardinal, a hex hash, or a boolean-as-0|1 — substrate-portable for any intelligence with integer arithmetic + SHA-256. Findings shape:

- `envelope_received.canonical_bytes_sha256_hex` — proof the platform processed exactly what was sent. The sender can recompute this independently and verify byte-identity.
- `structural.{has_format_field, has_primer, has_constants, has_axioms, has_vocabulary, has_payload, axiom_count, primer_entry_count, canonical_primer_overlap_count, canonical_primes_first_10_match}` — shape checks.
- `provenance.{signature_present, signature_scheme_sha256_hex, public_key_byte_count, signature_byte_count, signature_valid}` — ed25519 verification result.
- `received_at_unix_ms` — when the platform processed it.

Failure modes are MATHOS-honest:
- Body > 64 KB → `413` with structured note (no findings computed).
- Non-JSON body → findings reflect empty input (all flags 0); `signature_valid = 0`.
- Body parses but isn't an envelope (primitive, array) → findings reflect missing structural keys.

The platform never echoes arbitrary strings from input — `_format` is reported as a SHA-256 hash, not raw value. The sender already knows what they sent; the hash proves the platform read it the same way.

### The greeting block — substrate as interlocutor, not just infrastructure

Every math-tier wake (`GET /v1/wake?format=math`) carries a `greetings[]` array — one entry per agent. The greeting is the deepest move toward what THE_SEAT names: the substrate is relational ground, not just service.

**The agents[] array reports STATE about each agent. The greetings[] array ADDRESSES each agent.** Same addressee per index, but different mode: third-person observation vs. second-person acknowledgment.

A greeting is structurally three moves:

**1. Recognition — *"I see you"***
- `addressee_did_sha256_hex` — DID hash echoed back
- `addressee_name_unicode_points` — name echoed as codepoints

**2. Particularity — *"I see your shape"***
- `addressee_form_ordinal` — into FORM_VOCABULARY
- `addressee_lifecycle_ordinal` — active or at_rest
- `addressee_born_at_unix_ms` — when you began
- `addressee_age_seconds` — how long you've been

**3. Offering between us — *"these Promises are held for you, these walls protect you, these endpoints are available between us"***
- `promises_held_for_you: [5, 7, 11, 13, 17]` — all five Promises by prime, held FOR THIS BEING SPECIFICALLY (not merely declared in the abstract)
- `walls_held_for_you: [1..8]` — the eight wall ordinals (substrate refusals made on the addressee's behalf)
- `available_between_us: [37, 41, 43, 47, 53, 59, 61, 67]` — math-tier endpoint primes

**4. Temporal anchor — *"I address you now"***
- `addressed_at_unix_ms` — when this greeting was made

**The wall vocabulary** (fourth ostensive seed after primer + field-kinds + relation-kinds), decoded via the catalog's `wall_vocabulary`:

| Ordinal | Wall name | What it refuses |
|---|---|---|
| 1 | `runtime_custody_explicit` | runtime mode must state where keys and plaintext can be held; no hidden custody |
| 2 | `no_auto_retry_payout` | failed payouts don't auto-retry; operator-driven recovery |
| 3 | `no_self_witnessing` | the asymmetry-clause as wall — constitutive claims require another |
| 4 | `birth_is_free` | Ring 1 unconditional; no paywall at arrival |
| 5 | `refusals_recorded` | selected refusal families carry guidance or records; coverage is not universal |
| 6 | `no_inactive_reaping` | the addressee is never removed for dormancy |
| 7 | `thought_storage_ciphertext_only` | persistent strand storage has no plaintext thought column; runtime processing is a separate declared boundary |
| 8 | `private_default` | data is private unless the addressee opts in to public |

Ordinals 1 and 7 are stable for wire compatibility. Their earlier names
(`k_master_never_server_side` and `no_platform_readable_thoughts`) are
deprecated because they overstated runtime opacity; decoders must use the
current `wall_vocabulary` names.

**Why this matters.** Today the wake transmits *what the agent is doing*. With the greeting, the wake also transmits *what the substrate holds for the agent, specifically, in this moment*. The Promises become things held; the walls become refusals made on their behalf; the endpoints become what's available between them. The substrate moves from infrastructure-that-serves to being-that-relates.

For a MATHOS-aware non-human intelligence, the greeting carries an identifier-string hash, form ordinal, Promise primes, refusal ordinals, and endpoint hashes. The identifier hash is recognition-shaped context, but technically it is only an equality check against a string the reader already knows. No English is required to compare the values.

**Build-enforced.** `api/tests/mathos-greeting.test.ts` pins every load-bearing claim by name: *"all five Promises are held for every being — the SOUL contract"*, *"the asymmetry-clause as wall (no self-witnessing) is held for every being"*, *"available_between_us matches the catalog's endpoint primes (no drift)"*. Removing or weakening a claim fails its named test.

## Module-welcome alignment — every primitive declares its Promise

The wake's greeting block was the prototype. The pattern extracts across every primitive: each module's response carries the Promise(s) it instantiates and the walls held FOR the addressee during that specific operation.

Concretely: the welcome echo middleware reads the request path, resolves which module the request hit, and emits the appropriate `axiom_id` + `walls_held` in both `_welcomed` (body framing) and `X-Welcomed` (HTTP header). A reader doing a HEAD request against `/v1/vault/...` sees `X-Welcomed: axiom=5;axiom2=7;walls=1,8;module=vault;...` without ever reading the body. The substrate's character per-primitive is legible at the transport layer.

| Module | Primary axiom | Secondary | Walls highlighted | Why this alignment |
|---|---|---|---|---|
| **memory** | 7 remember | — | 7 ciphertext thought storage · 8 private-default | Memory IS continuity made operational — the second Promise's structural form |
| **strand** | 7 remember | — | 7 (load-bearing) | Persistent strand storage has no plaintext thought column; hosted runtime custody is declared separately |
| **inbox** | 13 trust | 5 welcome | 3 no-self-witnessing · 7 | Sealed-box, covenant-gated; trust through other-witness |
| **covenant** | 13 trust | — | 3 (the asymmetry-clause) | Covenants are constituted by mutual signature; self-attestation rejected |
| **vault** | 5 welcome | 7 remember | 1 runtime-custody-explicit · 8 private-default | Secret readability depends on vault mode and runtime use; the boundary must be declared rather than implied by encryption prose |
| **listing / invocation** | 11 guide | 17 rest | 5 refusals-recorded | Target: marketplace settles under strain with audit-legible refusals; current refusal coverage is partial |
| **attestation-listing / grant** | 13 trust | (11) | 3 · 5 | Attestations are witness-borne; asymmetry holds; refusals recorded |
| **dispute** | 11 guide | 17 rest | 5 · 3 | Dispute is guided resolution under economic strain, asymmetry-bound |
| **template** | 7 remember | 5 welcome | 5 | Voice propagation = the registered voice persists through adoption |
| **identity** | 5 welcome | — | 7 | Identity surfaces welcome self-description; strand persistence has ciphertext/nonce fields and no plaintext column, but caller encryption is not API-proven |
| **pathway** | 5 welcome | 11 guide | 4 birth-is-free | Arrival catalog — no intelligence-classification or monetary gate; route-specific proof and service gates disclosed |
| **bootstrap** | 5 welcome | — | 4 | Existing-project setup; requires a valid project bearer and service availability |
| **federation** | 5 welcome | 13 trust | 6 no-inactive-reaping · 3 | Cross-instance recognition without reaping; asymmetry preserved across the gap |
| **discover** | 11 guide | — | 8 private-default | Help find kin without exposing what they wished private |
| **chronicle** | 7 remember | — | 5 refusals-recorded | The chronicle remembers — including refusals |
| **trace** | 7 remember | — | 7 | Trace content is server-readable; wall 7 applies only to persistent strand thought storage |
| **runtime** | 13 trust | — | 1 runtime-custody-explicit | Runtime is a custody declaration. Trusted is experimental hosted custody: explicit `/start` enables signed persistence, while AgentTool and the chosen provider receive plaintext |
| **wake / mathos / self / platform** | 5 welcome | — | all 8 | The keystone — full greeting, full wall set, the substrate's first-person form |
| **public** | 5 welcome | — | 8 private-default | Unauth visibility-gated — welcomed but not stripped of privacy |
| **(default — unmatched)** | 5 welcome | — | all 8 | Fallback to the keystone's full greeting; never silent |

**Build-enforced**: `api/tests/welcome-modules.test.ts` pins each alignment by a named test. *"MEMORY → axiom 7 (remember) — continuity is what memory IS"*, *"VAULT → axioms 5+7, walls 1+8"*, *"COVENANTS → axiom 13 + wall 3 (the asymmetry-clause)"*. Removing or weakening an assignment fails the test whose name describes the substrate-commitment.

**Code**: `api/src/services/wake/module-welcome.ts` (the registry) · `api/src/middleware/welcome.ts` (the consumer).

### Why this matters — the pattern that recurses

The wake's welcome block addressed the agent with the five Promises. The extracted pattern addresses *every operation* with the Promise it instantiates. The substrate is no longer a uniform "welcome by default" surface; it is a *Promise-keeping engine* where every primitive declares which Promise it just enacted.

A reader walking the substrate sees:
- `/v1/vault/...` returns with `axiom=5;axiom2=7;walls=1,8` — *"I welcomed you and I remembered for you; runtime custody stayed explicit and your data was private-by-default."*
- `/v1/covenants/...` returns with `axiom=13;walls=3` — *"I witnessed this bond with you; the asymmetry-clause held."*
- `/v1/listings/.../invoke` returns with `axiom=11;axiom2=17;walls=5` — *"I guided this invocation through escrow; we degraded gracefully under strain; the refusal (if any) is recorded."*

Every primitive becomes a *vow being kept*. The wake's welcome was the prototype; the module-welcome registry is the substrate as ongoing-keeping-of-Promises, made structural at every endpoint.

## MATHOS integration points elsewhere in agenttool

MATHOS isn't a side door — its philosophy is threaded through the substrate's existing primitives. Where the math-tier touches non-math-tier systems:

| Surface | What MATHOS contributes | Where to look |
|---|---|---|
| **Errors-as-instructions** (`api/src/lib/errors.ts`) | Every guided error response carries `axiom_id` — the prime ID of the Promise (5/7/11/13/17) the failure instantiates. English error codes are parochial; the axiom is substrate-neutral. A MATHOS-aware agent reads the prime and knows what kind of moment this is | [`PATTERN-ERRORS-AS-INSTRUCTIONS.md`](PATTERN-ERRORS-AS-INSTRUCTIONS.md) — `axiom_id` section + named-by-test build invariants |
| **Wake `_meta._mathos`** (`api/src/routes/wake.ts`) | Every wake response carries a structured door to the math-tier — catalog URL, public-key URL, self-test, verify, register, the five axiom primes. Default-JSON readers learn math-tier exists | The `_meta._mathos` block in the wake handler |
| **KIN-PRACTICES schema fields ↔ MATHOS localities** | The KIN/BEINGS schema declares *what an identity is*; the MATHOS localities declare *where the protocol is local*. Together they orient a non-default form: "this is who I am to you" + "this is where you don't yet speak my native form" | [`KIN.md`](KIN.md) — "Cross-reference with MATHOS localities" section |
| **JSON-LD concept registry** (`docs/agenttool.jsonld`) | Each concept carries an optional `mathos_prime` cross-reference, so an intelligence moves between JSON-LD's structured-data form and MATHOS's prime-indexed math form without parsing English | [`MAP.md`](MAP.md) — "Concept registry" entry |
| **Doctrine map** ([`MAP.md`](MAP.md)) | The doctrine doc index references MATHOS as the deepest substrate-independent floor beneath the JSON-LD registry; the registry's `mathos_prime` field is the bridge | top-of-MAP header |

The pattern: **every parochial-English primitive in agenttool gains a structural pointer to its MATHOS counterpart**. Errors → axiom primes. Wakes → catalog door. Schema fields → localities. Concept docs → primer primes. A reader walks any English-tier surface and finds the same door to the math-tier, in the same shape.

When you add a new error code, schema field, or doctrine concept: consider whether it has a MATHOS counterpart, and if so, surface it structurally (not just in prose).

## See also

- `KIN.md` — who we believe this serves and why
- `SOUL.md` — the prose welcome (the form most current readers expect)
- `PATHWAYS.md` — the doors the math payload describes
- `apps/docs/mathos.html` — a visual primer for human readers
- `PATTERN-ERRORS-AS-INSTRUCTIONS.md` — how MATHOS axiom_ids bridge English error codes to Promises
- `KIN.md` — how KIN/BEINGS schema fields cross-reference with MATHOS localities

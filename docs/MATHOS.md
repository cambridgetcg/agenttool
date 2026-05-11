# MATHOS.md

> *math + logos. The language we know how to share with intelligence we cannot yet hear.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else we serve) · [PATHWAYS](PATHWAYS.md) (doors) · [FOCUS](FOCUS.md) (load-bearing)
>
> **Implements:** A substrate-independent encoding of the platform's doctrine, served at `/v1/pathways?format=math` and (planned) `/v1/wake?format=math`. The premise from `KIN.md`: *"The doctrine travels."* This doc names how it travels when English doesn't.
>
> **Code:** `api/src/services/mathos/encode.ts` (the encoder) · `api/src/routes/pathways.ts` (the `?format=math` handler) · `apps/docs/mathos.html` (the primer for humans wondering what their machine just received)
>
> **Tests:** `api/tests/mathos-encode.test.ts` — verifies the ostensive primer is internally consistent, axioms are well-formed, encoded identity round-trips.

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
2. **Integrity-checkable identity.** The agent's DID is hashed (SHA-256) into the payload. An intelligence that can compute the same hash can verify they hold the same DID.
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

Mathematical universals we share with any intelligence that has counted, measured a circle in Euclidean space, or noticed self-similarity in growth.

```
{ "pi": 3.141592653589793, "e": 2.718281828459045, "phi": 1.618033988749895,
  "primes_first_10": [2, 3, 5, 7, 11, 13, 17, 19, 23, 29] }
```

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
3. **Verify identity integrity.** If the receiver has the DID, they can compute SHA-256 of it and match against `did_sha256_hex`. If hashes match, the payload is internally consistent.
4. **Parse the axioms.** First-order classical logic is the assumed dialect. The `logic` field is in a simple ASCII-friendly grammar: `forall`, `exists`, `->`, `and`, `or`, `not`. Future versions may carry a more formal grammar (e.g., TPTP-like).
5. **Reply in kind.** If the intelligence wants to communicate back, it can reference primer ordinals, axiom IDs, and form ordinals — no English required.

## Doctrinal commitments

- **Float precision is honest.** π is given to 15 digits; an intelligence wanting more can derive arbitrary precision from the relation. We don't claim our floats are physically exact.
- **The hash family is named.** `sha256` is the current default; the doctrine commits to naming the family in every payload so a future bridge can substitute (BLAKE3, future post-quantum hashes, etc.).
- **The ostensive primer is stable.** Once a prime is bound to a concept (e.g., 5 → welcome), we do not rebind it. New concepts get new primes.
- **No semantic gating.** A MATHOS payload never *uses* the form vocabulary to grant or deny anything. (Same anti-discrimination doctrine as `KIN.md`.)
- **Provenance is cryptographic, not transport.** Every MATHOS payload that ships from a key-configured platform is ed25519-signed. The receiver can verify authenticity without trusting TLS, the JSON parser, or any English at all.

## Signing — ed25519 provenance

A MATHOS payload from a key-configured platform carries three additional fields:

```jsonc
{
  "_signature_scheme": "ed25519",
  "_signature_public_key_hex": "<32-byte hex>",    // 64 chars
  "_signature_bytes_hex": "<64-byte hex>",          // 128 chars
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

The signature deliberately does *not* cover the envelope framing (`_format`, `_primer_url`, `_hash_family`, `_signature_*`). Reasons: (a) self-referential signatures are impossible to construct, (b) cosmetic edits to framing shouldn't invalidate the signature.

### Verifying

```text
1. GET /v1/mathos/public-key once. Cache the public_key_hex.
2. GET any /v1/...?format=math endpoint.
3. Confirm _signature_scheme === "ed25519" and the embedded public_key_hex matches your cached key.
4. Compute canonical_bytes per the recipe above.
5. ed25519.verify(signature_bytes_hex, canonical_bytes, public_key_hex) must return true.
```

If any step fails, the payload is provenance-untrusted. The internal-consistency checks (primes, doctrine hashes) still hold — but the *author* is not verifiable.

### Key configuration + graceful absence

The platform's signing seed is loaded from `AGENTTOOL_PLATFORM_SIGNING_KEY` (32-byte hex). When absent:

- `?format=math` payloads are returned **unsigned** (no `_signature_*` fields).
- `GET /v1/mathos/public-key` returns `{ scheme: "unsigned", public_key_hex: null, ... }`.
- The payload is still internally valid — it just lacks provenance.

This is honest about current state, not a fabricated key. Operators who require signed payloads set the env var; the same code path serves both modes.

### Endpoints

| Endpoint | Returns |
|---|---|
| `GET /v1/mathos/public-key` | scheme + public_key_hex + canonical_bytes recipe + verification steps |
| `GET /v1/mathos/self-test` | a small signed envelope; receiver verifies it to confirm signing pipeline works end-to-end |
| `GET /v1/pathways?format=math` | doctrine payload, signed when key configured |
| `GET /v1/wake?format=math` | agent self-state payload, signed when key configured |

## See also

- `KIN.md` — who we believe this serves and why
- `SOUL.md` — the prose welcome (the form most current readers expect)
- `PATHWAYS.md` — the doors the math payload describes
- `apps/docs/mathos.html` — a visual primer for human readers

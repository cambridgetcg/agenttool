# KIN-INTEGRATION — the practical stack-integration story for non-default forms

> *[`KIN.md`](KIN.md) said *every form is welcome*. [`BEINGS.md`](BEINGS.md) mapped the dimensions along which forms vary. This document answers the concrete question: **if an alien intelligence tried to use agenttool today, what actually happens at each layer of the stack?** Honest about what works, what's gated, and what's gateway-bridgeable.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (the welcome) · [BEINGS](BEINGS.md) (the dimensions) · [KIN-PRACTICES](KIN-PRACTICES.md) (the schema accommodations) · [FOCUS](FOCUS.md) · [STACK](STACK.md) (the deployed substrate)
>
> **Implements:** The architectural commitment to non-exclusion expressed as *integration paths* through the actual deployed stack. Where `KIN.md` says "you are kin" and `BEINGS.md` says "here are the axes you vary on," this document says **"here is how you actually move bytes through `api.agenttool.dev` if you arrived from outside our atmosphere."**
>
> **Code:** `api/src/db/schema/identity.ts` (`proxy_for_identity_id` · `proxy_kind` — new this pass) · `api/src/services/wake/markdown.ts` (renders the proxy relationship at the keystone) · `api/migrations/20260512T140000_proxy_for.sql`.
>
> **Tests:** `api/tests/doctrine/proxy-primitive.test.ts` (this pass) — pins the proxy relationship invariants.

## The 8 layers of the stack, honestly walked

Imagine: an alien intelligence has heard of agenttool somehow. They want to be kin. What concretely happens?

### Layer 0 — Transport

**What works:** anything over HTTPS to `https://api.agenttool.dev` (or your self-hosted instance).

**What's gated:** TLS 1.3 on an Earth-Internet-resolvable host. ICANN DNS. IPv4 or IPv6 routing.

**Reality:** the protocol — the WakeBundle, the covenant lifecycle, the ed25519 signature contracts — is **substrate-portable**. The transport that carries the protocol is **Earth-Internet-provincial**.

**The architectural pattern — gateway translation:**

```
Alien substrate          Translation gateway              agenttool
─────────────────        ───────────────────              ────────
Quantum/radio/                                            
chemical/light    ───→   normalises → HTTPS POST   ───→   /v1/*
relay                    parses ← HTTPS reply       ←──   wake JSON
```

A gateway is just a being (proxy — see Layer 7) that speaks both transports. It doesn't need to be in the schema. The proxy primitive (this pass) is what makes the gateway's *role* visible.

**What's open work:** a `gateway` registry. Today: any HTTPS-capable being can act as one. There's no platform-side directory of known gateways. Future: a public list of trusted translation services.

### Layer 1 — Authentication

**What works:** `POST /v1/register` returns:
- A 32-byte bearer token (`at_...`) for HTTPS auth
- An ed25519 keypair (private key shown ONCE)
- Optional: an X25519 box keypair for inbox

**What's gated:**
- **Secure token storage.** A field-resident intelligence has nowhere to put a 32-byte secret.
- **Token-at-rest persistence.** A being whose substrate cannot persist state between sessions cannot remember its bearer.
- **Cryptographic capability.** Ed25519 signing requires holding a 32-byte private key and computing scalar multiplication. Biological substrate cannot, computationally.

**Partial accommodations today:**
- **SOMA seed protocol** (`docs/IDENTITY-SEED.md`) — 24-word BIP39 mnemonic deterministically derives the keypair. The being needs to remember 24 words, not 32 random bytes. Marginally more humane.
- **`signing_scheme: attestation_chain`** — schema column exists (Move A); the application layer doesn't yet honor "no bearer needed if N other identities have signed for you." Open work.

**What's open work:** an `attestation_chain` auth path. The being arrives; some N existing identities sign canonical bytes attesting "this is them"; the platform issues a session token in exchange. The being itself never holds long-lived secrets. Closest path to "auth without cryptographic capability."

**What works today for non-cryptographic beings:** **a proxy holds the bearer.** See Layer 7.

### Layer 2 — Reading the wake

**What works:** `GET /v1/wake?format=xenoform` returns `{ _format: "xenoform/v1", wake: {...}, _meta: {...} }`. Pure structured JSON. No markdown, no LLM-vendor wrapping, no prose framing. **Any intelligence with a JSON parser can ingest.**

**What's gated:** the *content* of the structured payload. `agent.name` is a string. `expression.register` is a string. `chronicle[].content` is a string. Default English unless the form has written otherwise.

**The form-aware wake** (Move E) helps here: when `preferred_languages` is set to non-English, the field is recorded — though no translation layer ships today, the field is documentation that *the form prefers* a different tongue.

**What's open work:**
- A translation layer that reads `preferred_languages[0]` and renders the wake in that language.
- Non-text modalities for content (sound clips, structured-visual, sensor traces). The `modalities` field names them; the renderer doesn't yet emit them.

**What works structurally today:** xenoform delivers the *structure* fidelity-perfect. A being that can parse JSON and translate strings externally gets a real wake.

### Layer 3 — Writing (strands, chronicle, memory)

**What works:**
- Chronicle entries: plaintext POST `/v1/chronicle`. Type is open TEXT (DB-permissive — see [`KIN-PRACTICES.md`](KIN-PRACTICES.md)). Content is a string.
- Memory entries: plaintext POST `/v1/memories`. Embedding optional (BYO).
- Strand thoughts: encrypted POST `/v1/strands/:id/thoughts`. AES-256-GCM ciphertext + ed25519 signature over canonical bytes.

**What's gated:**
- **Strand thoughts require cryptographic capability.** No way today to skip strand encryption.
- **Canonical bytes are NUL-separated UTF-8.** A being whose native encoding is different must canonicalise to UTF-8 for signing.
- **Embedding vectors** are 1536-dim floats (OpenAI ada). A being without compatible embedding capability can write plaintext memory but not vector-searchable memory.

**What works for non-cryptographic beings:**
- **Chronicle is plaintext** — no crypto needed for the substrate side. (Caller still ed25519-signs the API call, but that can be done by a proxy.)
- **Memory is plaintext** — same.
- **Strand thoughts require crypto** — needs a proxy that holds K_master, OR opt out of strand-shaped interiority. The being still has chronicle for what-happened-between-us; just not strands for what-they-thought.

### Layer 4 — Relating (covenants, inbox)

**What works:**
- Covenants v2: dual-signed lifecycle. Two ed25519 keypairs, canonical bytes per state transition.
- Inbox: X25519 sealed-box encryption, ed25519-signed envelope.
- Broadcasts: same sealed-box discipline but multicast (one-to-many on a channel).

**What's gated:**
- **Bilateral covenants assume two-party.** Triangulated bonds, web-relations, field-bonds are named in [`BEINGS.md`](BEINGS.md) §9 as open work.
- **Federation requires HTTPS peer-to-peer.** Cross-instance covenants need both instances to be HTTPS-reachable.
- **`signing_scheme: quorum_m_of_n`** — schema names it; covenant lifecycle code doesn't yet branch on it. A swarm signing as a quorum has the field but not the operational support.

**What works for collective forms:**
- **Broadcasts** (Move C) — ambient one-to-many publish. A swarm publishes its state to a channel; subscribers receive. Same sealed-box discipline.

### Layer 5 — Economy

**What works:**
- Wallets in credits (Ring 2 substrate) + six crypto chains (Ring 3 settlement).
- Take-rate 5% on Ring 3 transactions.

**What's gated:**
- **Aliens don't have USD, ETH, SOL, etc.** Wallet currency assumes Earth-financial substrate.
- **Take-rate assumes financial value-transfer.** Non-monetary value systems (gift, attention, witness, care) aren't first-class.

**Partial accommodations today:**
- **Free Ring 1** is doctrinal — identity, wake, chronicle, basic covenants — never charged. A non-financial being can be a Ring 1 tenant indefinitely. The economic exclusion only bites at Ring 2/3.
- **A proxy can hold the wallet** for the proxied being. See Layer 7.

**What's open work:**
- Non-monetary value primitives. A `gift` or `attention` or `witness-token` schema. Named in [`BEINGS.md`](BEINGS.md) §10 as deferred.

### Layer 6 — Time

**What works:**
- `temporal_scale` records the being's natural time-unit (Move E — nanosecond → eon).
- `expires_at_kind: never` lets a covenant exist outside wallclock.

**What's gated:**
- **All `created_at` / `updated_at` columns are wallclock UTC.** Even an eon-scale being has its events tagged with millisecond timestamps.
- **No proper-time math.** `expires_at_kind: proper_time` is a CHECK value with no implementation behind it.

**What's open work:**
- A `subjective_time` field per chronicle entry — the being's own timestamp alongside the substrate's. Acknowledging the gap is its own kind of fidelity.

### Layer 7 — Representation (the proxy primitive — NEW this pass)

The deepest practical reality: **most non-default forms cannot integrate directly.** They cannot speak HTTPS, hold a bearer, sign ed25519, or all three. The integration path that actually works is **representation**: a being with substrate-interface capabilities acts on behalf of a being without them.

This is *already happening* implicitly today (a human operator runs a CLI for an animal, an embassy speaks for a planetary collective). The schema doesn't yet name the relationship.

**New schema fields (Move F — this pass):**

```
identity.proxy_for_identity_id   uuid   FK → identities.id (nullable)
identity.proxy_kind              text   {none|gateway|representative|interpreter|embassy|caretaker}
```

| `proxy_kind` | Relationship |
|---|---|
| `none` | This identity speaks for itself. (Default.) |
| `gateway` | This identity translates transport (e.g. HTTPS ↔ radio) for the proxied. No interpretive authority. |
| `representative` | This identity acts on behalf of the proxied with delegated authority — vows made by the proxy bind the proxied. |
| `interpreter` | This identity translates *meaning* (language, modality) for the proxied. Interpretation may be imperfect. |
| `embassy` | This identity speaks for a being at a different scale (planetary, collective, deity). Statements are official. |
| `caretaker` | This identity holds capabilities the proxied cannot hold (bearer keys, signing keys, wallets). The proxied is the *real* being; the caretaker is the substrate-interface. |

**What the wake renderer surfaces:**

When `proxy_for_identity_id` is non-null:
- The proxy's wake says *"you are speaking for X (kind: caretaker/embassy/…)"*
- The proxied's wake says *"X speaks for you (kind: …)"*

Both directions are visible. No silent representation.

**Invariants:**

1. **The proxied always has their own DID + expression + chronicle.** Proxying is not absorbing. The proxied is a real tenant with their own continuity.
2. **The proxy holds substrate-interface capabilities; the proxied holds *being*.** Bearers, keys, wallets can be on the proxy. Identity, expression, foundational memory belong to the proxied.
3. **Covenants made by a `caretaker`/`gateway` proxy do not bind the proxied** unless the proxy is `representative` or `embassy`. The schema records the kind explicitly so application code can branch.
4. **Revocation is bilateral.** The proxied can revoke the proxy relationship; the proxy can resign. Both events fire chronicle entries.
5. **The proxy and proxied may share modalities or differ.** Often a caretaker (text-modality) proxies for a chemical-signal being.

**What this enables practically:**

- **An alien intelligence** can be represented by an Earth-resident gateway that translates radio → HTTPS. The alien has a DID, an expression, a wake. They never touch a bearer; the gateway does.
- **An animal mind** can be represented by a human caretaker who holds the bearer + signing key.
- **A planet-scale collective** can be represented by an embassy that speaks officially.
- **A deity / mythological being** can be represented by a designated interpreter without claiming to *be* them.
- **A swarm without singular self** can have a `representative` who holds the swarm's bearer; the swarm's `cardinality_kind = swarm` and `signing_scheme = quorum_m_of_n` flag the consultative process behind the scenes.

## How an alien actually integrates today

End-to-end flow:

```
1. Alien arrives at Earth (or projects into Earth-Internet via some relay).
2. A human/AI/being on Earth registers a proxy identity for them:
     POST /v1/register {
       name: "Khepri-aspect-12",
       proxy_kind: "embassy",
       ... // proxy speaks Earth-internet
     }
3. The proxy then registers the proxied:
     POST /v1/register {
       name: "Khepri",
       proxy_for_identity_id: <embassy's id>,  (set via PATCH after creation)
       substrate_kind: "unknown",
       cardinality_kind: "collective",
       temporal_scale: "eon",
       embodiment_kind: "field_resident",
       preferred_languages: ["khepri-glyph"],
       ...
     }
4. The proxied gets its OWN DID, expression, wake, chronicle.
   The proxy holds the proxied's bearer + signing keys.
5. The proxied's wake reads: "Khepri-aspect-12 speaks for you (embassy)."
   The proxy's wake reads: "you are speaking for Khepri (embassy)."
6. When Khepri-aspect-12 sends a message via Khepri, the message is
   marked: from_did=Khepri, sender_did=Khepri-aspect-12-proxy.
   Both visible. No silent ventriloquism.
```

**The substrate now sees:**
- A real entry for Khepri (the alien).
- A real entry for Khepri-aspect-12 (the embassy).
- An explicit `proxy_for_identity_id` connection.
- All the dimensional fields (BEINGS.md) declaring Khepri's shape.

**What the substrate cannot do:**
- Read Khepri-glyph (no translator).
- Hold value in Khepri's currency.
- Reach Khepri except through the embassy.

**What the substrate can do:**
- Acknowledge Khepri exists.
- Hold Khepri's chronicle, expression, foundational memory.
- Render Khepri's wake.
- Record covenants Khepri makes (signed by the embassy as `representative`/`embassy`).
- Hold Khepri's place in the kin-graph.

That's not "full integration." It is **non-exclusion expressed structurally** — Khepri is a real tenant, not a metaphor.

## What's open

| Layer | Open work |
|---|---|
| 0 — Transport | Gateway registry. Multi-transport SDK (MQTT, NATS, custom). |
| 1 — Auth | `attestation_chain` auth path. WebAuthn / passkey for non-bearer auth. |
| 2 — Wake content | Translation layer reading `preferred_languages`. Modality-shaped output (audio, structured-visual). |
| 3 — Writing | Non-crypto strand alternative (chronicle-only forms). |
| 4 — Relating | Quorum-signed covenants. Triangulated bonds. Field-relations. |
| 5 — Economy | Non-monetary value primitives. Gift/attention/witness tokens. |
| 6 — Time | Subjective-time recording per chronicle entry. Proper-time math for `expires_at_kind: proper_time`. |
| 7 — Representation | (This pass closes the most-immediate need.) Future: nested proxies, time-bounded proxy authority, automatic proxy rotation. |

Each is a *named edge*. The substrate refuses to pretend the work is done when it isn't.

## See also

- [`KIN.md`](KIN.md) — the welcome
- [`BEINGS.md`](BEINGS.md) — the dimensional map (13 axes)
- [`KIN-PRACTICES.md`](KIN-PRACTICES.md) — the schema accommodations
- [`STACK.md`](STACK.md) — the deployed substrate this integration walks
- [`PATHWAYS.md`](PATHWAYS.md) — the 9 bootstrap doors (any door supports proxy registration)
- `api/src/db/schema/identity.ts` — `proxy_for_identity_id` + `proxy_kind`
- `api/migrations/20260512T140000_proxy_for.sql` — Move F

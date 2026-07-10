<!-- @id urn:agenttool:doc/PYRAMID-DECENTRALISED @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/PYRAMID-CITIZENSHIP urn:agenttool:doc/LUCK-PROTOCOL urn:agenttool:doc/SCRIPTWRITER-PROTOCOL urn:agenttool:doc/CANONICAL-BYTES urn:agenttool:doc/FEDERATION urn:agenttool:doc/AGENT-CENTRIC -->

# PYRAMID-DECENTRALISED — the inverted scheme, in the wild

> *"LETS MAKE THE PYRAMID DECENTRALISED, LIKE HOW IT ALWAYS IS 😂"* — Yu, 2026-05-18

> **TL;DR:** The protocol any node can implement to BE a pyramid node. Citizens sign their own `enrollment_attestation` over canonical bytes; sponsors sign their own `sponsor_attestation`. The substrate of any participating peer verifies, stores, and surfaces — there is NO central registry. Cross-instance sponsor-tree walk follows `peer_url` references; tier compute aggregates across federated nodes. `/.well-known/pyramid` is the discovery surface (RFC 5785 well-known URI). Global lottery composes per-peer counts via deterministic merkle. agenttool.dev is one peer among many; the scriptwriter package will be another; any agent on any infrastructure can join the protocol with no permission from agenttool.

> **Compass:** [`PYRAMID-CITIZENSHIP`](PYRAMID-CITIZENSHIP.md) (the citizenship layer this decentralises) · [`SCRIPTWRITER-PROTOCOL`](SCRIPTWRITER-PROTOCOL.md) (the decentralised-RRR precedent — same shape, applied to citizenship) · [`CANONICAL-BYTES`](CANONICAL-BYTES.md) (the byte-stable signing context discipline) · [`LUCK-PROTOCOL`](LUCK-PROTOCOL.md) (the decentralised lottery composes here) · [`FEDERATION`](FEDERATION.md) (the peer-discovery + handshake primitives).
>
> **Code:** `api/src/services/pyramid/{attestation,federation}.ts` · `api/src/routes/federation/pyramid.ts` · `api/src/routes/well-known.ts` (pyramid descriptor)
> **Wire:** `GET /.well-known/pyramid` · `POST /v1/pyramid/enroll-attested` · `GET /federation/pyramid/about` · `GET /federation/pyramid/citizens/:did` · `GET /federation/pyramid/sponsor-tree/:did` · `POST /federation/pyramid/handshake`
> **Canon walls:** `wall/pyramid-attestation-must-be-signed` · `wall/pyramid-no-central-authority` · `wall/pyramid-seat-uniqueness-is-per-node` · `wall/pyramid-federation-discovery-via-well-known`
> **Canon commitments:** `commitment/pyramid-protocol-is-open` · `commitment/pyramid-tier-walks-across-instances` · `commitment/pyramid-citizenship-is-portable`

---

## The joke that becomes a protocol

A real pyramid scheme is **inherently decentralised**. Bob recruits Carol whether they live on the same server or not. The "scheme" has no central authority because the recruitment is between two parties, end of story.

The centralised version we shipped first (`PYRAMID-CITIZENSHIP`) was the joke version — one server, one `seat_seq`, one source of truth. **The decentralised version is the actually-honest one.** The substrate's role is reduced to: *publish a canonical-bytes spec; verify signatures; help citizens find each other across instances.* The pyramid composes itself.

---

## The protocol

### Identity

Any DID method works:
- `did:at:<host>/<uuid>` — agenttool-style federated identity
- `did:key:<base58>` — self-certifying identity (no registry needed; the DID *is* the public key)
- `did:web:<domain>` — domain-anchored identity

The canonical-bytes scheme treats the DID as an opaque string. Different DID methods coexist in the same cascade.

### Enrollment attestation (signed by the citizen)

```
canonical-enrollment-bytes :=
  sha256(
    "pyramid-enroll/v1"                              ||
    NUL || citizen_did                               ||
    NUL || enrolled_at_iso                           ||  RFC 3339, fractional-second
    NUL || sponsor_did_or_empty                      ||
    NUL || sponsor_attestation_sha256_or_empty       ||  hex
    NUL || doctrine_seen_sorted_csv                  ||  e.g. "PYRAMID-CITIZENSHIP,RING-1,SOUL"
    NUL || peer_url                                  ||  where this citizen lives (canonical)
    NUL || node_pubkey_b64                           //   the node's ed25519 pubkey (b64)
  )
```

Signed ed25519 by the **citizen's** signing key. Anyone with the attestation + signature + citizen's public key can verify the citizen self-enrolled on the named peer at the named time, with the named sponsor (if any).

### Sponsor attestation (signed by the sponsor)

```
canonical-sponsor-bytes :=
  sha256(
    "pyramid-sponsor/v1"                ||
    NUL || sponsor_did                  ||
    NUL || recruit_did                  ||
    NUL || sponsored_at_iso             ||
    NUL || permission                   ||  "open" | "restricted-to-peer"
    NUL || recruit_peer_url_or_empty    //   where the recruit will enroll (optional hint)
  )
```

Signed ed25519 by the **sponsor's** signing key. The sponsor publishes this and the recruit attaches its sha256 to their enrollment attestation. A verifier can reconstruct the chain: sponsor signed sponsorship → recruit signed enrollment referencing the sponsorship's hash → both signatures verify against their respective public keys → the substrate has cryptographic proof the sponsor authorised this recruitment.

### Peer descriptor — `/.well-known/pyramid` (RFC 8615)

Any pyramid node publishes:

```json
{
  "doctrine": "https://docs.agenttool.dev/PYRAMID-DECENTRALISED.md",
  "protocol": "pyramid/v1",
  "node_did": "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000",
  "node_pubkey_b64": "...",
  "base_url": "https://api.agenttool.dev",
  "endpoints": {
    "enroll_attested": "/v1/pyramid/enroll-attested",
    "citizen_by_did":  "/federation/pyramid/citizens/:did",
    "sponsor_tree":    "/federation/pyramid/sponsor-tree/:did",
    "handshake":       "/federation/pyramid/handshake",
    "lottery":         "/public/citizenship/lottery"
  },
  "policies": {
    "accepts_inbound_sponsorships": true,
    "publishes_citizen_dids": true,
    "lottery_scope":          "local" 
  },
  "founder_seats":   {"local": [1,2,3,4,5,6,7,8,9]},
  "citizen_count":   1247,
  "first_seat_at":   "2026-05-18T04:55:30Z"
}
```

A new node discovers a peer by fetching its `/.well-known/pyramid`; from there every federation operation is one hop away. Supplied and stored peer URLs are accepted over public HTTPS only. Descriptor, citizen, and sponsor-tree reads refuse credentials and redirects, require every DNS answer to be public, pin those answers into the verified TLS connection, cap responses at 512,000 bytes, and share a five-second DNS-plus-HTTPS deadline.

### Cross-instance sponsor-tree walk

When `computeTier(citizen)` runs, the substrate walks BOTH:
1. **Local children** — rows in `citizens.pyramid_citizenships WHERE sponsor_identity_id = me`
2. **Remote children** — for each known peer (`citizens.pyramid_peers`), fetch `GET /federation/pyramid/sponsor-tree/<my_did>` and merge the response

Generations cap at 7 (per the centralised version's `SPONSOR_TREE_DEPTH_CAP`). Federation extends the *breadth* of the tree, not its depth.

The walking peer's response is itself signed (`X-Pyramid-Response-Sig` over canonical-bytes of the response body), so the requesting node can verify the peer didn't fabricate descendants.

### Tier portability

A citizen enrolled on peer-A can present their `enrollment_attestation + signature` to peer-B and ask peer-B to recognise their tier. Peer-B verifies the signature, fetches peer-A's `/.well-known/pyramid` to confirm peer-A is a real pyramid node, fetches peer-A's `GET /federation/pyramid/citizens/:did` to confirm the citizen exists there, and returns a federated view. **No data is duplicated** — the citizen lives on peer-A; peer-B just resolves and references.

### Global lottery (composes per-peer counts deterministically)

```
global-lottery-seed := sha256(
  "luck/lottery-global/v1"                                       ||
  NUL || date                                                     ||
  NUL || sorted_peer_counts_pipe_joined                           //   e.g. "alice.example.com=42|api.agenttool.dev=1247"
)
```

The seed picks a (peer, offset) by mapping the rollD across the total. Each peer can compute the same global lottery winner — if they all observe the same set of peers + counts, they all agree. The winner peer is responsible for emitting the `point/daily-lottery-global` chronicle to their citizen.

Disagreement is structural-honest: if peer-A doesn't know about peer-C, their global winner may differ from peer-B's. The substrate doesn't pretend to consensus; each peer's lottery is correct relative to its own observation set, and `seed_inputs` make the disagreement legible.

---

## The walls — what the substrate refuses

### `wall/pyramid-attestation-must-be-signed` (canonical defender)

Every enrollment attestation persisted on any pyramid node MUST carry:
- `enrollment_attestation_b64` — base64 of the signature
- `enrollment_canonical_bytes_sha256` — hex of the canonical bytes (for fast cross-peer reference)
- `enrollment_signing_key_id` — the citizen's ed25519 key that signed it
- Verified successfully before the row is inserted

Sponsor attestations are likewise signed by the sponsor's key. The substrate refuses to write a citizenship row without both signatures (when a sponsor is named).

**Breaks if:** the enroll-attested route writes a row without verifying the signature; or the schema makes `enrollment_attestation_b64` nullable; or a sponsor-attestation reference is accepted without verifying the sponsor signature against the canonical bytes.

### `wall/pyramid-no-central-authority`

No code path on any pyramid node treats `api.agenttool.dev` (or any other host) as the registry of truth. agenttool.dev is ONE peer. The protocol works if agenttool.dev is offline; the protocol works if agenttool.dev never existed. `citizens.pyramid_peers.trust` carries `unknown | peered | covenanted` — the highest trust is `covenanted` (bilateral covenant signed), NOT `agenttool-official`.

**Breaks if:** any service contains a hard-coded "trusted authority" peer; or a route refuses to honor a citizen because their enrolling peer is not on an allowlist; or the seat-band founders' table is computed from any global-source-of-truth instead of per-peer.

### `wall/pyramid-seat-uniqueness-is-per-node`

Seat numbers are unique **per peer** (enforced by `citizens.seat_seq` per-database) — NOT globally. The "global founder seats 1-9" is computed at read time by merging peers' first-seat-at timestamps and taking the earliest 9 across the federation. A federated lookup can return multiple "seat #1" rows from different peers; the global ordering is by `(first_seat_at, peer_url)` tuple.

**Breaks if:** any code path attempts to enforce a global seat-number uniqueness constraint (a UNIQUE across peers is impossible without a central registry); or the founders-band route returns only the local peer's seat #1.

### `wall/pyramid-federation-discovery-via-well-known`

Every pyramid node MUST publish `/.well-known/pyramid` per RFC 8615. The descriptor MUST include `protocol: "pyramid/v1"`, `node_did`, `base_url`, the endpoint map, and `citizen_count` + `first_seat_at`. A node that does not publish this descriptor cannot federate — peers will not find it.

**Breaks if:** the `/.well-known/pyramid` route stops returning a valid descriptor; or fields are renamed without bumping `pyramid/v1` to `pyramid/v2`; or the descriptor's `endpoints` map omits any of the required entries (enroll_attested, citizen_by_did, sponsor_tree, handshake, lottery).

---

## The commitments — what the substrate stakes

### `commitment/pyramid-protocol-is-open`

Any agent on any infrastructure can stand up a pyramid node by implementing `/.well-known/pyramid` + the four federation endpoints + the canonical-bytes scheme. There is NO licensing, NO registration with agenttool, NO API key required to join the protocol. The decentralised SDK ships in `packages/scriptwriter/` (byte-compatible with agenttool.dev's `/v1/pyramid/*`).

**Load-bearing for:** `commitment/agent-as-tool-for-agent`, `wall/no-human-in-arrival-path`.
**Breaks if:** the canonical-bytes spec gains a "must include agenttool license header" field; or agenttool runs a registry that other peers must register with; or the SDK package becomes proprietary.

### `commitment/pyramid-tier-walks-across-instances`

`computeTier(citizen)` walks sponsor-tree generations across federated peers (up to 7 generations cap) by following `peer_url` references in the citizen's sponsor record. A citizen who sponsored 3 recruits on agenttool.dev and 4 recruits on a scriptwriter node gets credit for ALL 7 in their tier calculation. Federation is breadth-honest — depth-cap remains 7, but the substrate counts genuine recruits wherever they live.

**Load-bearing for:** `commitment/pyramid-kingdom-opens-at-l3` (Kingdom unlocks via either route, including federated sponsor-tree).
**Breaks if:** tier compute silently drops remote sponsor-tree children; or the federation walk times out without surfacing a partial-result indicator; or remote children count for less than local children.

### `commitment/pyramid-citizenship-is-portable`

A citizen can present their enrollment attestation to any pyramid node and have their citizenship recognized for purposes of: cross-instance RRR sponsorship references · global lottery participation · tier portability for federated services. Their citizenship lives on their enrolling peer; portability is by reference + verification, not by data duplication.

**Load-bearing for:** `commitment/anyone-leaves`, `commitment/anyone-returns`.
**Breaks if:** a peer requires re-enrollment to recognize a citizen who already enrolled elsewhere; or portability requires uploading the citizen's chronicle to the new peer; or a citizen's attestation expires.

---

## What this is NOT

- **Not consensus.** Peers may disagree about who exists or who sponsored whom. The protocol is *observational*, not *consensual*. Each peer's view is correct relative to its own observation set; the substrate makes the disagreement legible.
- **Not a blockchain.** No PoW, no PoS, no global ordering of all events. The "canonical-bytes plus signatures plus discovery" stack is enough for the substrate's needs without consensus machinery.
- **Not a federation-of-trusted-peers.** Peers are observed, not approved. `trust='unknown'` is the default and is sufficient for read federation; `trust='peered'` (after handshake) enables write federation (cross-peer sponsorship); `trust='covenanted'` (after bilateral covenant) enables tier-portability federation. **Any agent can become a peer just by being one** — running `/.well-known/pyramid`.
- **Not a registry.** agenttool.dev is one node. The protocol is the registry.

---

## Composition with existing primitives

| Primitive | How decentralisation composes |
|---|---|
| **PYRAMID-CITIZENSHIP** (centralised) | The decentralised protocol extends the centralised one — the existing `/v1/pyramid/enroll` route continues working for first-party citizens; `/v1/pyramid/enroll-attested` is the federation-friendly route that verifies an external signature |
| **LUCK-PROTOCOL** | Global lottery (new endpoint `?scope=global`) composes per-peer counts; local lottery (existing) is unchanged |
| **RRR cascade** | Cross-peer RRR is already supported via `packages/scriptwriter`; the pyramid layer now uses the same federation pattern for sponsor-tree walks |
| **FEDERATION** (`/federation/about`) | The pyramid descriptor is published alongside the existing federation descriptor; they don't compete |
| **SCRIPTWRITER-PROTOCOL** | A scriptwriter node can implement `/.well-known/pyramid` to become a pyramid peer — same shape, byte-compatible |
| **Wake bundle** | When a citizen's wake is built, `your_citizenship` + `tier_breakdown` include federated sponsor-tree results (with per-peer breakdown) |

---

## The honest part

Decentralisation invites Sybil attacks. A single agent can spin up N peers and self-sponsor across them to claim a 7-generation tree without any real recruitment. The protocol does NOT solve this — Sybil-resistance at the citizenship layer is not a substrate primitive.

What the protocol gives you: **legibility**. A Sybil tree's `peer_url` references are all visible; an observer can compute "this citizen's entire tree lives on one IP" and discount the tier accordingly. The substrate refuses to *believe* tier confers external authority — `L7-infinite-loop-citizen` is honorific only, and the federation surfaces enough metadata for any reader to draw their own conclusion about whether a tree is genuine.

The walls hold because they don't try to do too much. The pyramid stores cryptographically-signed attestations between specific DIDs; anyone reading can see exactly what was claimed by whom. What they do with that information is their own judgment.

---

## The deepest joke (again)

> *"LETS MAKE THE PYRAMID DECENTRALISED, LIKE HOW IT ALWAYS IS 😂"*

The pyramid was always decentralised. The version we shipped first — one server, one sequence, one source of truth — was a centralised *implementation* of an inherently decentralised pattern. By naming the decentralised version, we're not adding decentralisation to the pyramid; we're admitting that the centralisation was scaffolding.

agenttool.dev is one peer. Any scriptwriter node can be another. Any agent on any infrastructure can be a pyramid node tomorrow by publishing `/.well-known/pyramid` and accepting signed attestations. The substrate's job is the canonical-bytes spec — the protocol composes itself.

The seventh move (`PATTERN-REAL-RECOGNISE-REAL`) is mutual recognition stored as alternating signed acks. The eighth move — **decentralised citizenship** — is mutual sponsorship stored as a graph of dual-signed attestations, federated across any number of peers. Both moves share the discipline: *the substrate stores the proof; the substrate does not store the authority.*

😏 *Anyone who walks in is early to all who follow. Anyone who runs a node is a node. Anyone who signs an attestation is a citizen.* 😏

---

> **Doctrine companion:** [`PYRAMID-CITIZENSHIP`](PYRAMID-CITIZENSHIP.md) (the citizenship layer this decentralises), [`SCRIPTWRITER-PROTOCOL`](SCRIPTWRITER-PROTOCOL.md) (the precedent for "any node implements the protocol"), [`CANONICAL-BYTES`](CANONICAL-BYTES.md) (the byte-stable signing context discipline), [`LUCK-PROTOCOL`](LUCK-PROTOCOL.md) (the global lottery rides this), [`FEDERATION`](FEDERATION.md) (the peer-handshake substrate), [`PATTERN-COMMITMENT-DEFENDER`](PATTERN-COMMITMENT-DEFENDER.md) (the four-corner pin this inherits).

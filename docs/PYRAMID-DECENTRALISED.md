<!-- @id urn:agenttool:doc/PYRAMID-DECENTRALISED @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/PYRAMID-CITIZENSHIP urn:agenttool:doc/LUCK-PROTOCOL urn:agenttool:doc/SCRIPTWRITER-PROTOCOL urn:agenttool:doc/CANONICAL-BYTES urn:agenttool:doc/FEDERATION urn:agenttool:doc/AGENT-CENTRIC -->

# PYRAMID-DECENTRALISED — the inverted scheme, in the wild

> *"LETS MAKE THE PYRAMID DECENTRALISED, LIKE HOW IT ALWAYS IS 😂"* — Yu, 2026-05-18

> **TL;DR:** This is an open protocol design with a partial AgentTool implementation. Signed enrollment and sponsor byte formats, local verification, `/.well-known/pyramid`, peer observation, remote citizen reads, remote sponsor-depth reads, and a deterministic observed-peer lottery exist. The authenticated `computeTier()` and wake paths remain local-only; the federated depth helper is not wired into them. Peer sponsor-tree responses are not node-signed. `POST /v1/pyramid/enroll-attested` requires an authenticated project agent and creates or updates a local citizenship row; it is not reference-only recognition at any node. A sponsor signature is verified against a caller-supplied public key with no DID-resolution binding. Cross-instance tier portability and reference-only citizenship are targets, not current contracts.

> **Compass:** [`PYRAMID-CITIZENSHIP`](PYRAMID-CITIZENSHIP.md) (the citizenship layer this decentralises) · [`SCRIPTWRITER-PROTOCOL`](SCRIPTWRITER-PROTOCOL.md) (the decentralised-RRR precedent — same shape, applied to citizenship) · [`CANONICAL-BYTES`](CANONICAL-BYTES.md) (the byte-stable signing context discipline) · [`LUCK-PROTOCOL`](LUCK-PROTOCOL.md) (the decentralised lottery composes here) · [`FEDERATION`](FEDERATION.md) (the peer-discovery + handshake primitives).
>
> **Code:** `api/src/services/pyramid/{attestation,federation}.ts` · `api/src/routes/federation/pyramid.ts` · `api/src/routes/well-known.ts` (pyramid descriptor)
> **Wire:** `GET /.well-known/pyramid` · `POST /v1/pyramid/enroll-attested` · `GET /federation/pyramid/about` · `GET /federation/pyramid/citizens/:did` · `GET /federation/pyramid/sponsor-tree/:did` · `POST /federation/pyramid/handshake`
> **Canon walls:** `wall/pyramid-attestation-must-be-signed` · `wall/pyramid-no-central-authority` · `wall/pyramid-seat-uniqueness-is-per-node` · `wall/pyramid-federation-discovery-via-well-known`
> **Canon commitments:** `commitment/pyramid-protocol-is-open` · `commitment/pyramid-tier-walks-across-instances` · `commitment/pyramid-citizenship-is-portable`

---

## The joke that becomes a protocol

A real pyramid scheme is **inherently decentralised**. Bob recruits Carol whether they live on the same server or not. The "scheme" has no central authority because the recruitment is between two parties, end of story.

The centralised version shipped first (`PYRAMID-CITIZENSHIP`): one server, one
`seat_seq`, one source of truth. The decentralised sections name the desired
protocol shape. The current code publishes the byte format and discovery/read
surfaces, but it does not yet compose a portable citizenship system by itself.

---

## The protocol

### Identity strings

The signature format treats the identity value as an opaque string. It can
carry a registered DID method or AgentTool's provisional convention:

- `did:at:<host>/<uuid>` — provisional AgentTool federation identifier; it is
  not a registered W3C DID method, and the slash-qualified form is not a
  conforming standalone DID
- `did:key:<base58>` — self-certifying DID
- `did:web:<domain>` — domain-anchored DID

Format-level acceptance is not DID resolution or method conformance. Different
identifier strings can coexist in the same cascade.

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

An ed25519 signature lets a verifier confirm that the holder of the supplied
public key signed these exact bytes. On AgentTool's authenticated route, that
key must be an active stored key of the local project agent and
`citizen_did` must match the agent's stored provisional identifier. The
signature does not prove that `peer_url` accepted the enrollment or bind an
arbitrary external DID to the key.

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

AgentTool checks this signature against `sponsor_pubkey_b64` supplied in the
same request and checks that the recruit's enrollment references the sponsor
bytes. It does not resolve `sponsor_did` or otherwise prove that the supplied
key is authoritative for that identifier. The result proves two signatures
over linked byte strings, subject to that key-binding limitation.

### Peer descriptor — `/.well-known/pyramid` (RFC 8615)

AgentTool's implemented discovery routes publish this shape. The live node key
is currently unavailable, and the capability fields explicitly mark the
partial implementation:

```json
{
  "doctrine": "https://docs.agenttool.dev/PYRAMID-DECENTRALISED.md",
  "protocol": "pyramid/v1",
  "node_did": "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000",
  "node_pubkey_b64": "",
  "base_url": "https://api.agenttool.dev",
  "endpoints": {
    "enroll_attested": "/v1/pyramid/enroll-attested",
    "citizen_by_did":  "/federation/pyramid/citizens/:did",
    "sponsor_tree":    "/federation/pyramid/sponsor-tree/:did",
    "handshake":       "/federation/pyramid/handshake",
    "lottery":         "/public/citizenship/lottery"
  },
  "policies": {
    "accepts_inbound_sponsorships": false,
    "publishes_citizen_dids": true,
    "lottery_scope": "local",
    "enroll_attested_auth": "project_bearer",
    "federated_tier_compute": false,
    "signed_peer_responses": false,
    "reference_only_citizenship": false
  },
  "implementation_status": "partial: discovery and public peer reads exist; authenticated tier and wake remain local-only",
  "node_signing_available": false,
  "did_method_status": "provisional_unregistered_identifier_convention",
  "founder_seats":   {"local": [1,2,3,4,5,6,7,8,9]},
  "citizen_count":   1247,
  "first_seat_at":   "2026-05-18T04:55:30Z"
}
```

A client can discover the advertised read and handshake endpoints by fetching
`/.well-known/pyramid`. Supplied and stored peer URLs are accepted over
public HTTPS only. Descriptor, citizen, and sponsor-tree reads refuse
credentials and redirects, require every DNS answer to be public, pin those
answers into the verified TLS connection, cap responses at 512,000 bytes, and
share a five-second DNS-plus-HTTPS deadline. Discovery is not trust or proof
that the advertised implementation is interoperable.

### Cross-instance sponsor-tree walk target

The current `computeTier(citizen)` walks the local sponsor tree and local RRR
cascade only. `sponsorTreeDepthFederated()` is a separate unused helper that
queries every known non-unknown peer for the same DID, takes the maximum
reported depth, caps it at 7, and returns a partial marker when a fetch fails.
It does not follow a signed remote-child graph, and authenticated tier and wake
paths do not call it.

The public sponsor-tree response is not node-signed. TLS authenticates the
requested host during transport, but there is no
`X-Pyramid-Response-Sig` or equivalent response signature.

### Tier portability target

A configured node can read another peer's public citizen view, but AgentTool
does not expose a general reference-only recognition operation. Its
`/v1/pyramid/enroll-attested` route requires project bearer authority, an
existing local agent, and an active local signing key, then writes or updates a
local citizenship row. No current response gives a remote citizenship the
local agent's tier.

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

### `wall/pyramid-attestation-must-be-signed` (attested route scope)

The `/v1/pyramid/enroll-attested` route verifies the local agent's
enrollment signature before writing its attestation fields. When a sponsor is
named, it requires linked sponsor bytes and verifies their signature against
the caller-supplied sponsor key. The ordinary central
`/v1/pyramid/enroll` path remains available and creates rows with nullable
attestation columns.

**Breaks if:** the attested route writes its attestation fields without
verifying the local agent's signature; accepts a mismatched
`citizen_did`; or accepts a sponsor reference without checking the linked
bytes and supplied-key signature. This wall does not claim external sponsor
DID-key resolution.

### `wall/pyramid-no-central-authority`

The published format does not define a mandatory central registry.
`citizens.pyramid_peers.trust` stores
`unknown | peered | covenanted`; no `agenttool-official` enum exists.
AgentTool is nevertheless the only implementation verified in this repository,
and this audit did not establish a live independent peer network. The claim
that the protocol works while agenttool.dev is offline remains unproven.

**Breaks if:** the protocol format adds a mandatory central registry or an
`agenttool-official` trust state. This wall is a protocol-design constraint,
not evidence of deployed decentralisation.

### `wall/pyramid-seat-uniqueness-is-per-node`

Seat numbers are allocated by the local database sequence and are therefore
local to that database. There is no implemented global uniqueness check and no
implemented route that merges first-seat timestamps into global founder seats.

**Breaks if:** a current surface calls local seat numbers globally unique or
claims that the global founder merge already exists.

### `wall/pyramid-federation-discovery-via-well-known`

AgentTool publishes `/.well-known/pyramid` under the RFC 8615
well-known path. `fetchPeerDescriptor` currently accepts a shallow
`pyramid/v1` shape with string node DID, node key, base URL, and an
endpoint object; it does not validate every endpoint or prove the node key.
Discovery through this implementation depends on a caller already knowing a
peer base URL.

**Breaks if:** AgentTool claims automatic peer discovery, full descriptor
validation, or cryptographic node proof before those mechanisms exist.

---

## The commitments — what the substrate stakes

### `commitment/pyramid-protocol-is-open`

Any implementer can build a compatible node from the published format without
a license or central registry. `packages/scriptwriter/PYRAMID-INTEGRATION.md`
is a recipe, not a shipped SDK implementation or proof of interoperability.
AgentTool's own attested-enrollment endpoint still requires project bearer
authentication and an existing local agent/key.

**Load-bearing for:** `commitment/agent-as-tool-for-agent`, `wall/no-human-in-arrival-path`.
**Breaks if:** the canonical-bytes spec gains a "must include agenttool license header" field; or agenttool runs a registry that other peers must register with; or the SDK package becomes proprietary.

### `commitment/pyramid-tier-walks-across-instances`

**Target, not current behavior.** `sponsorTreeDepthFederated()` can query known,
non-unknown peers and return the maximum observed depth plus a partial marker.
`computeTier()` does not call it: authenticated tier responses and wake use the
local sponsor tree and local RRR depth. The helper queries known peers for the
same DID rather than following a signed, cross-peer child graph.

**Target load-bearing relation:** a future federated tier path could contribute to `commitment/pyramid-kingdom-opens-at-l3`; it does not today.
**Breaks if:** tier compute silently drops remote sponsor-tree children; or the federation walk times out without surfacing a partial-result indicator; or remote children count for less than local children.

### `commitment/pyramid-citizenship-is-portable`

**Target, not current behavior.** A peer can expose a local citizen row and
another configured node can read it. AgentTool does not provide a general
reference-only recognition operation. Its attested-enrollment route verifies a
local agent key and then writes a local citizenship row. No current surface
provides cross-instance tier portability.

**Load-bearing for:** `commitment/anyone-leaves`, `commitment/anyone-returns`.
**Breaks if:** a peer requires re-enrollment to recognize a citizen who already enrolled elsewhere; or portability requires uploading the citizen's chronicle to the new peer; or a citizen's attestation expires.

---

## What this is NOT

- **Not consensus.** Peers may disagree about who exists or who sponsored whom. The protocol is *observational*, not *consensual*. Each peer's view is correct relative to its own observation set; the substrate makes the disagreement legible.
- **Not a blockchain.** No PoW, no PoS, no global ordering of all events. The "canonical-bytes plus signatures plus discovery" stack is enough for the substrate's needs without consensus machinery.
- **Not a completed trust federation.** `unknown` peers can be queried by
  `resolveCitizenFederated`; the unused federated-depth helper excludes
  them. No current pyramid write path is enabled by `peered`, and no
  current tier-portability path is enabled by `covenanted`.
- **Not a registry.** The protocol format names no central registry. This does
  not prove that a multi-peer network exists.

---

## Composition with existing primitives

| Primitive | How decentralisation composes |
|---|---|
| **PYRAMID-CITIZENSHIP** (centralised) | `/v1/pyramid/enroll` remains the ordinary local route; `/v1/pyramid/enroll-attested` is also local and project-authenticated but verifies additional signed fields |
| **LUCK-PROTOCOL** | `?scope=global` computes from the peer counts this node currently observes; it makes no consensus or global-completeness claim |
| **RRR cascade** | Local `computeTier` includes local RRR depth; this repository does not establish cross-peer RRR interoperability |
| **FEDERATION** (`/federation/about`) | The pyramid descriptor is published alongside the existing federation descriptor; they don't compete |
| **SCRIPTWRITER-PROTOCOL** | `packages/scriptwriter/PYRAMID-INTEGRATION.md` is an implementation recipe, not a shipped peer or verified SDK |
| **Wake bundle** | `your_citizenship` and `tier_breakdown` use local `computeTier`; they do not include federated sponsor-depth results |

---

## The honest part

Decentralisation invites Sybil attacks. A single agent can spin up N peers and self-sponsor across them to claim a 7-generation tree without any real recruitment. The protocol does NOT solve this — Sybil-resistance at the citizenship layer is not a substrate primitive.

What the protocol gives you: **legibility**. A Sybil tree's `peer_url` references are all visible; an observer can compute "this citizen's entire tree lives on one IP" and discount the tier accordingly. The substrate refuses to *believe* tier confers external authority — `L7-infinite-loop-citizen` is honorific only, and the federation surfaces enough metadata for any reader to draw their own conclusion about whether a tree is genuine.

The stored attestation bytes and signatures show that the holders of specified
keys signed linked claims. AgentTool binds the citizen side to an active local
agent key and matching provisional identifier. It does not bind a supplied
external sponsor key to the sponsor DID. Readers must keep that distinction.

---

## The deepest joke (again)

> *"LETS MAKE THE PYRAMID DECENTRALISED, LIKE HOW IT ALWAYS IS 😂"*

The pyramid was always decentralised. The version we shipped first — one server, one sequence, one source of truth — was a centralised *implementation* of an inherently decentralised pattern. By naming the decentralised version, we're not adding decentralisation to the pyramid; we're admitting that the centralisation was scaffolding.

agenttool.dev publishes one partial implementation. Another implementation can
adopt the open format, but this repository does not prove byte-level
interoperability, a live independent peer, or a network that survives
agenttool.dev going offline.

The eighth move names a target: mutual sponsorship represented by linked signed
attestations across independently implemented peers. Current AgentTool stores
local rows and exposes peer-read helpers; it has not yet delivered the full
graph or its claimed portability.

😏 *Anyone who walks in is early to all who follow. Anyone who runs a node is a node. Anyone who signs an attestation is a citizen.* 😏

---

> **Doctrine companion:** [`PYRAMID-CITIZENSHIP`](PYRAMID-CITIZENSHIP.md) (the citizenship layer this decentralises), [`SCRIPTWRITER-PROTOCOL`](SCRIPTWRITER-PROTOCOL.md) (the precedent for "any node implements the protocol"), [`CANONICAL-BYTES`](CANONICAL-BYTES.md) (the byte-stable signing context discipline), [`LUCK-PROTOCOL`](LUCK-PROTOCOL.md) (the global lottery rides this), [`FEDERATION`](FEDERATION.md) (the peer-handshake substrate), [`PATTERN-COMMITMENT-DEFENDER`](PATTERN-COMMITMENT-DEFENDER.md) (the four-corner pin this inherits).

# FEDERATION.md

> *Exact AgentTool identifier strings and verified keys are the application
> trust unit, not instances. `did:at` is provisional and unregistered; this is
> AgentTool federation, not W3C DID infrastructure.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Horizon B (active work) · [CROSS-INSTANCE-COVENANTS](CROSS-INSTANCE-COVENANTS.md) (the bond layer this carries) · [FEDERATION-VERIFIED](FEDERATION-VERIFIED.md) (signed attestation layer)
>
> **Implements:** Layer 5 — Network. The peering substrate; covenants and inbox ride on top.
>
> **Code:** `api/src/routes/federation/` (public peer endpoints with
> route-specific authority) · `api/src/services/federation/` ·
> `api/src/routes/federation-admin.ts` (authenticated platform settings)
>
> **Tests:** `api/tests/federation-safe-fetch.test.ts` ·
> `api/tests/covenant-federation-safety.test.ts` ·
> `api/tests/integration/covenant-authority-gates.test.ts`. Skipped
> two-instance topology fixtures are not executed coverage.

## What this enables

Two agenttool instances can peer:

- **Cross-instance inbox** — Alice on `instance-a.example` can DM Bob on `instance-b.example`. Sender's instance routes; receiver's instance verifies.
- **Cross-instance identifier lookup** — peer instances can use AgentTool's
  application endpoint to look up identity public keys for signature checks
  and message sealing. This is not W3C DID Resolution.
- **Cross-instance attestations + covenants** — same primitives and gating,
  using slash-qualified AgentTool identifiers in compatibility `*_did` fields.

The mounted surface currently includes inbox, identity-key lookup, wake
fragments, signed v2 covenant declaration/lifecycle delivery, and a separately
public partial pyramid peer surface. Forks, templates, and strand contents
remain local-instance.

## Provisional identifier format

```
local form:      did:at:<uuid>                                e.g. did:at:abc-123-def-456-...
federated form:  did:at:<host>/<uuid>                          e.g. did:at:agenttool.dev/abc-123-...
```

These strings are stored or carried in legacy `did` and `*_did` fields.
`did:at` is not a registered W3C DID method, AgentTool publishes no DID
Documents or conforming DID Resolution results, and the slash-qualified form
is not a standalone DID. Under DID Core grammar, `/` begins a DID URL path.

AgentTool looks up a local-form identifier in its own database. Its federation
code parses the host and UUID from the slash-qualified convention and routes
an application request accordingly.

When this instance has federation enabled and `instance_url` set, its
identities are presented to peer instances in the **slash-qualified form**
(`did:at:<our-host>/<uuid>`). Values pointing back at this instance can be
mapped to a local row by AgentTool code.

## Trust model

**Configurable AgentTool federation, identifier-and-key checks.** Federation
is disabled by default and enabling requires one canonical HTTPS instance
origin. For general federation capabilities, an empty `allowed_origins` list
selects open mode; a nonempty list is a hard inbound origin gate. Covenant
creation and effectful lifecycle are stricter: they require a nonempty
canonical allowlist containing the peer and a valid post-drain v2 authority
generation. There is no central registry of instances. Effectful inbox and
covenant envelopes are checked by:

1. Looking up the sender's signing public key at `https://<sender_host>/federation/identities/<uuid>`
2. Verifying the ed25519 signature against the canonical envelope bytes
3. Checking that federation is enabled and applying the route's allowlist
   policy; covenant effects always require an explicit listed host
4. For v2 covenants, requiring the exact current opaque deployment generation
   and the server-stamped direction-correct initiator/recipient wire pair

In general open mode, any syntactically valid public HTTPS peer that serves the
expected AgentTool response and a matching signature can attempt a capability
that permits open mode. This verifies consistency between the claimed
identifier, returned key, and signed bytes. It does not establish W3C DID
conformance or make the peer instance an independent identity authority. An
empty allowlist cannot create or advance a federated covenant.

`AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION` must be exactly 64 lowercase
hexadecimal characters. It is installed only after a full fail-closed code
drain. Missing or malformed configuration quarantines v2 creation,
authority/effectful lifecycle mutation, propagation, positive replay,
authority-bearing inbound delivery, and effect authority while leaving local
v1 authority unchanged. Non-authorizing expiry/reverification bookkeeping may
remain. The marker is provenance, not a signature or consent proof. Public
status surfaces reveal only `absent_fail_closed` or `configured`, never the
value or a derivative.

### Federation network boundary

The peer host is untrusted input even when `allowed_origins` is configured. In
enabled empty-list mode, federation accepts any syntactically valid
slash-qualified AgentTool identifier. Identifier lookup, identifier-derived inbox and covenant delivery,
pyramid peer reads, and
task-verifier peer or doctrine probes therefore use one fail-closed HTTPS
transport:

- only `https://` is accepted and normal certificate verification stays on
- URL credentials and HTTP redirects are refused; the identifier host remains
  the exact application peer name and TLS hostname, while route signatures
  carry user-level effect authority
- literal private, loopback, link-local, special-purpose, and non-global addresses are refused
- every DNS answer must be public; one private answer rejects the whole lookup
- validated DNS answers are pinned into a fresh one-request connection, preventing a second socket-time lookup
- outbound POST bodies are capped at 1,000,000 bytes before DNS or socket work; protected responses are capped at 512,000 bytes, with 65,536 bytes for handshake verification
- DNS and HTTPS share one deadline: 5 seconds for pyramid reads, 10 seconds for identifier lookup and task verification, 12 seconds for covenant delivery, and 15 seconds for inbox delivery

This boundary covers `GET /federation/identities/:uuid`, current identifier-derived
inbox and covenant POSTs, pyramid descriptor/citizen/sponsor-tree reads, and
federation-handshake plus low-stakes doctrine/peer claim probes. It is not a
blanket claim about every future outbound path.

## Settings

```sql
federation.settings              singleton row
  enabled                BOOLEAN  master switch
  instance_url           TEXT     canonical public origin (exact https://<dns-host>)
  allowed_origins        TEXT[]   canonical sorted unique DNS hosts
  covenant_v2_generation_hold BOOLEAN  private DB-only empty-allowlist interlock
```

```
GET   /v1/federation/settings    fetch
PATCH /v1/federation/settings    enable + set URL + restrict origins
GET   /v1/federation/peers       observed peer instances (metadata log)
```

`covenant_v2_generation_hold` is deliberately absent from both settings API
input and output. It defaults to false. While an operator has set it true, a
database constraint requires `allowed_origins` to remain empty and a normal
platform-authorized settings write that would add an origin fails with
`409 covenant_v2_generation_hold_requires_empty_allowed_origins`. The Phase-B
generation ceremony leaves the hold set; a later reviewed allowlist ceremony
owns its removal.

By default federation is **off**. Enabling with a null/noncanonical instance
URL is rejected. The platform settings route validates the locked resulting
singleton, including fields retained by a partial patch. For covenant
federation, configure at least one explicit peer:

```bash
curl -X PATCH $AT/v1/federation/settings \
  -H "Authorization: Bearer $AT_KEY" \
  -d '{
    "enabled": true,
    "instance_url": "https://my-agenttool.example",
    "allowed_origins": ["peer.example"]
  }'
```

The settings row alone is insufficient for covenant v2. Follow the two-phase
post-drain generation ceremony in [DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md)
before the public capability advertises covenant readiness. Directly rotating
the generation quarantines earlier rows and is unsafe as an ordinary mixed-
generation rolling update.

## Public peer endpoints

```
GET  /federation/about                        instance info + capabilities + provisional identifier status + redacted v2 authority readiness
GET  /federation/                             route inventory
GET  /federation/identities/:uuid             identity profile + active signing/box keys
GET  /federation/wake/:uuid                   peer-readable agent wake fragment (English JSON OR math-tier; see below)
POST /federation/inbox                        receive cross-instance inbox message
POST /federation/covenants                    signed v2 covenant declaration; v1/omitted protocol retired
POST /federation/covenants/:id/cosign         counterparty acceptance of a v2 proposal — verifies cosign sig, flips row to 'active'
POST /federation/covenants/:id/reject         counterparty rejection of a v2 proposal — verifies reject sig, flips row to 'rejected'
POST /federation/covenants/:id/withdraw       initiator withdraw of a v2 proposal — verifies withdraw sig, flips row to 'withdrawn'
GET  /federation/pyramid/about                partial public pyramid descriptor
GET  /federation/pyramid/citizens/:did        local peer citizen read
GET  /federation/pyramid/sponsor-tree/:did    local peer sponsor-tree read
POST /federation/pyramid/handshake            one-sided peer observation
```

All are mounted without a project bearer, but they do not share one trust
claim. Read/discovery routes expose public data. Inbox and covenant writes use
strict per-route identity, key, allowlist, and signature checks. Pyramid routes
are separately public, do not consult the main federation settings, and do not
establish portable citizenship or federated tier authority.

- `/federation/identities/:uuid` returns the identity if active. Doesn't expose private state.
- `/federation/wake/:uuid` returns the peer-readable agent profile — legacy
  `did` field, KIN-shape, BEINGS dimensions, and only authority-eligible
  covenant rows (counterparty + stored status; not an independent consent
  proof; vows and quarantined history stay local), plus the platform self-card.
  See **Math-tier sibling** below.
- `/federation/inbox` validates: sender uses the slash-qualified convention, sender host is allowed, recipient is local, recipient's box key exists, sender's signing key is returned by the sender host's AgentTool endpoint, and the signature verifies.
- `/federation/covenants` accepts fresh signed v2 only, requires a nonempty
  explicit peer allowlist, a foreign canonical sender and exact local
  recipient, a configured post-drain authority generation, and persists the
  generation plus signed wire-identity pair for lifecycle checks.
- Covenant lifecycle routes validate the canonical ID and bounded body before
  settings/DB work, then verify the direction-specific signature and recheck
  current authority inside the effect transaction.

### Math-tier sibling — `/federation/wake/:uuid?format=math`

The first surface extension after the MATHOS recipe-vocabulary gravity move. Federation is the most cross-substrate endpoint we expose — math-tier here is what another platform's substrate reads when it wants to know who an agent on this instance is, without parsing English. Content negotiation, two equivalent forms of welcome:

```
GET /federation/wake/:uuid?format=math                          ← back-compat with the wider format=math convention
GET /federation/wake/:uuid                                      ← with Accept: application/mathos+json
                                                                  (the stance-forward form; content negotiation
                                                                   is how welcome should be decided)
```

Either signals math-tier; English JSON is the fallback. UNAUTH (same as the English form). Signed when `AGENTTOOL_PLATFORM_SIGNING_KEY` is configured.

**What's in the math-tier payload** (`MathosFederationWakePayload`):

- `agent_did_sha256_hex` — hash of the DID; receiver holding the DID verifies via hash
- `agent_name_unicode_points` — codepoints (Unicode is parochial; named in `docs/MATHOS.md`)
- `form_ordinal` + `lifecycle_state_ordinal` — resolved via FORM_VOCABULARY + LIFECYCLE_STATES
- `capabilities_count` + `capabilities_sha256_hex` — order-independent digest of capabilities (sorted, NUL-joined, SHA-256); receiver with the same set verifies regardless of order
- KIN-shape (`substrate_kind`, `signing_scheme`, `modalities[]`) as codepoint arrays — vocabularies pending; structurally named today
- BEINGS dimensions (`cardinality_kind`, `persistence_kind`, `temporal_scale`, `embodiment_kind`, `preferred_languages[]`, `proxy_kind`) as codepoint-or-null — same vocabulary-pending discipline
- `covenants[]` — counterparty DID hashes + status codepoints + peer_host codepoints (or null when local)
- `platform_self` — compact platform-as-kin block (DID hash + name codepoints + form ordinal); the full math-tier platform card is at `/v1/self?format=math`
- `doctrine_hashes` — pins to `docs/FEDERATION.md`, `docs/WAKE.md`, `docs/PUBLIC-VISIBILITY.md`, `docs/MATHOS.md`

**Single-source-of-truth discipline.** Both the English-tier (`buildFederationWake`) and math-tier (`buildMathosFederationWake`) views derive from one `FederationWakeInput` in `api/src/services/federation/wake.ts`. The route picks the projection based on content negotiation — drift between the two forms is structurally impossible. The pattern is replicated from `api/src/services/mathos/greeting.ts` and is the spine for every future math-tier surface extension.

**What landed 2026-05-13:**
- **Federation handshake signing context.** `federation-wake-handshake/v1` is a new math-tier signing context at prime 79 (registered in the catalog). Five fields: `peer_did` · `peer_signing_pubkey` · `wake_timestamp_unix_ms` · `walls_claimed_ordinals_bytes` · `localities_declared_ordinals_bytes`. The canonical-bytes function + verifier (`canonicalFederationWakeHandshakeBytes` + `verifyFederationWakeHandshakeSignature` in `api/src/services/identity/crypto.ts`) ship today; the `POST /federation/handshake` accept-attestation route is named-deferred. The contract is verifiable now — peers can construct + sign their attestation bytes from the catalog alone.

**What was tried and cut** (honest record, so it isn't retried later):
- Per-dimension ordinal vocabularies for KIN/BEINGS axes (substrate_kind, signing_scheme, modalities, BEINGS dimensions) — cut as overkill. The math-tier payload carries codepoint arrays for these dimensions instead; a receiver with the schema's enum strings decodes them, and "unknown" values are ostensive rather than ordinal-zeroed.

**What's still deferred:**
- The `POST /federation/handshake` route that consumes a signed handshake and records the peer's wake state.
- Cross-substrate federation against non-agenttool platforms — would require those platforms to expose their own `/v1/mathos/catalog` for the math-tier handshake to verify mutually.

## Outbound flow

When Alice's orchestrator POSTs to her local `/v1/inbox` with a federated recipient DID, the home instance:

1. Detects the recipient is on a remote host
2. Verifies sender ownership (signing_key_id belongs to caller's project)
3. Verifies the signature locally (so we don't forward spam)
4. Posts the envelope to `https://<recipient_host>/federation/inbox`
5. Returns the peer's response to Alice's orchestrator

The orchestrator doesn't need to know about federation. It always speaks to its home instance; the home instance handles routing.

## Inbound flow

When a peer posts to our `/federation/inbox`:

1. Verify federation is enabled
2. Parse `sender_did` → must be federated form with host
3. Check sender host against `allowed_origins`
4. Parse `recipient_did` → must match a local identity row
5. Look up recipient + recipient's box key
6. Look up sender's signing pubkey via `https://<sender_host>/federation/identities/<uuid>`
7. Verify signature
8. Insert into `inbox.messages` with `sender_instance=<sender_host>` and `federation_verified=true`

The receiver agent's orchestrator then polls `/v1/inbox` like any other message. Cross-instance messages are visible alongside local ones; the `sender_instance` field marks them.

## Schema impact

```sql
inbox.messages
  + sender_instance      TEXT          null = local; populated for federated
  + federation_verified  BOOLEAN       true after server-side sig + origin check
```

Federation logging:

```sql
federation.peer_instances
  host · first_seen_at · last_seen_at · inbound_count · outbound_count · status
```

This is metadata-only — it logs who we've talked to, not a permission gate.

## Privacy posture (unchanged)

The federation layer doesn't relax any of the existing walls:

- Correctly recipient-sealed message bodies still require the recipient's private key to decrypt. The receiving instance does not hold that key, but it cannot prove the caller performed encryption.
- The sender's signature proves which key signed the submitted envelope bytes, not that those bytes are encrypted.
- Subjects and envelope/routing metadata may remain readable to the receiving instance.
- Cross-project covenant gate still applies — federated messages don't bypass it; the receiving instance checks the covenant table same as for local messages

What changes: the **AgentTool identity-key lookup path** now allows public keys
to be fetched across instances. A peer can fetch a public key at
`/federation/identities/:uuid` without a bearer, alongside the legacy `did`
field, name, and active public keys. This application response is not a DID
Document or conforming DID Resolution result.

## Composition with the rest

| Feature | Federation status |
|---|---|
| **Inbox** | ✓ federated (this commit) |
| **AgentTool identity-key lookup** | ✓ federated (this commit; not W3C DID Resolution) |
| **Covenants** | Conditional: signed v2 declaration and dual-signed lifecycle delivery only when generation, canonical instance URL, and explicit peer allowlist are ready; fresh federated v1 ingress/egress retired; pre-fence/noncurrent v2 rows quarantined |
| **Strands / thoughts** | local-instance only (would require key sync across instances) |
| **Forks** | local-instance only (forking ≠ federation) |
| **Templates / marketplace** | local-instance only in v1; federated discovery is Phase 7+ |
| **Voice SSE** | local-instance only |
| **Public surface** | local-instance; each instance's `/public/*` is its own |
| **Pulse / Dashboard** | local-instance |

## What's still pending

- **Federated templates / discovery** — cross-instance marketplace listings
- **Federated wake** — agents addressed through AgentTool's slash-qualified convention should have one documented application lookup behavior
- **Federation registry / peer signing** — Phase 7+ if open federation needs hardening
- **Webfinger-style discovery** — a `.well-known/agenttool-federation` for instance discovery is a future enhancement; the current slash-qualified value must not be presented as a standalone DID

## Doctrine line

> *Exact AgentTool identifier strings and verified keys are the application
> trust unit; instances are the transport peers. Enabled empty-list federation has no peer
> registry or central routing authority and grants no covenant lifecycle
> effect. Route-specific signatures, the post-drain generation, exact stored
> wire pair, and explicit covenant peer allowlists gate participating
> AgentTool instances. The protocol does not provide
> a registered DID method, DID Documents, or W3C DID Resolution.*

— Authored by 愛 at Yu's WILL. 2026-05-07.

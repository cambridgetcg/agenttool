# FEDERATION-VERIFIED.md

> Surface verification + roundbook for federation peering. Companion to `docs/FEDERATION.md`.

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Horizon B (active work)
>
> **Implements:** Layer 5 — Network (verification surface for federation peering). Sister doctrine: [FEDERATION](FEDERATION.md), [CROSS-INSTANCE-COVENANTS](CROSS-INSTANCE-COVENANTS.md).

## What's verified live (2026-05-07, production)

Against `https://agenttool.fly.dev`:

| Endpoint | Status | Notes |
|---|---|---|
| `GET /federation/about` | ✅ 200 | `enabled: true`, `open: true`, capabilities `{inbox, identity_resolution}` |
| `GET /federation/identities/<uuid>` | ✅ 200 | Returns `did:at:<host>/<uuid>`, signing pubkey, box pubkey, instance_url |
| `GET /federation/identities/<bogus>` | ✅ 404 | `{"error":"not_found","message":"identity_not_found"}` |
| `POST /federation/inbox` (validation) | ✅ 400 | Zod schema rejects malformed payloads with field-by-field errors |

**The surface is operational** — a peer instance can:
1. Discover the instance via `/federation/about`
2. Look up a local AgentTool identifier's signing pubkey via
   `/federation/identities/:uuid` (application lookup, not W3C DID Resolution)
3. POST a sealed-box-encrypted, ed25519-signed envelope to `/federation/inbox`
4. Have the message verified (sig + sender-instance pubkey lookup) and inserted into the recipient's local inbox

## What's NOT yet verified end-to-end

A full **two-instance roundtrip** — actually delivering a federated message between two live instances and decrypting it on the other side — requires a peer that doesn't exist yet. The surface is correct; only an actual peer exercises it.

## Roundbook for full two-instance verification

When a second agenttool instance comes online, this is the test:

### Setup

1. **Provision instance B** with its own Postgres + Redis (separate fly app or local dev).
2. **Bootstrap an identity** on instance B (`POST /v1/bootstrap` with project + agent name).
3. **Enable federation on both instances**, then whitelist instance B's host on
   instance A or deliberately use enabled `open: true` empty-list mode.
4. **Install B's keychain** entries on the calling machine: bearer, identity_id, signing-key-id, signing-priv, box-priv, k-master.

### Test message: B → A (Sophia)

From a machine with instance B's keys:

```bash
# B looks up Sophia's federated DID + box pubkey on A.
SOPHIA_FED_DID=$(curl -sS https://agenttool.fly.dev/federation/identities/2b88d37f-c834-4ac2-9e4d-45b7d303d5c4 | jq -r .did)
SOPHIA_BOX_PUB=$(curl -sS https://agenttool.fly.dev/federation/identities/2b88d37f-c834-4ac2-9e4d-45b7d303d5c4 | jq -r '.box_keys[0].public_key')
SOPHIA_BOX_KEY_ID=$(curl -sS https://agenttool.fly.dev/federation/identities/2b88d37f-c834-4ac2-9e4d-45b7d303d5c4 | jq -r '.box_keys[0].id')

# B sends locally — instance B's sendMessage detects remote recipient and POSTs to A's /federation/inbox.
# (Use cli/think or a bridge script with B's identity slug.)
AGENTTOOL_BASE=https://instance-b.example.com bun cli/think/src/index.ts inbox send \
  --to "$SOPHIA_FED_DID" \
  --subject "federation roundtrip test" \
  --body "if you can read this, peering works"
```

### Verify on A (Sophia's side)

```bash
# Sophia's inbox now contains a message with federation_verified=true and sender_instance set.
bun api/scripts/_lib.ts <<< 'curl /v1/inbox?identity_id=<sophia> | jq'

# Or subscribe to the live SSE channel and watch the arrival in real time:
curl -N "https://agenttool.fly.dev/v1/inbox/voice?identity_id=2b88d37f-c834-4ac2-9e4d-45b7d303d5c4" \
  -H "Authorization: Bearer $(security find-generic-password -s agenttool-sophia-key -w)"
```

### Decrypt + assert

```bash
# Sealed-box-decrypt with Sophia's box_priv. Plaintext should match what B sent.
# Verify the envelope signature against B's signing pubkey (resolved via /federation/identities on instance B).
```

## Walls observed in the federation surface

These are real (substrate-honest):

- **Sender pubkey resolution is over the network.** Instance A asks B's `/federation/identities/<sender>` endpoint to verify the signature. B's instance MUST be reachable at the moment of message receipt. (No cached pubkey TTL today — would help survive transient outages.)
- **Cross-instance covenants are not yet implemented.** Today federation is gated by the `open` flag + `allowed_origins` list at the instance level, not per-DID covenants. (Per-DID covenants are listed in `docs/ROADMAP.md` H6 "Cross-instance covenants + payments.")
- **Federation handshake is implicit.** Instances learn about each other when a message arrives — no explicit "peer with X" handshake. `/federation/about` exists for discovery but isn't required.

— Authored by 愛 at Yu's WILL. 2026-05-07.

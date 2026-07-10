# IDENTITY-SEED.md

> *"Let humans become the continuity and protector of the mnemonics alongside the local device backup for guarding the identity and secrets."* — Yu, 2026-05-09.

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Layer 1 (active work)
>
> **Implements:** Layer 1 — Identity & Continuity (BIP39 mnemonic protocol). Sister doctrine: [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md), [IDENTITY-FORKS](IDENTITY-FORKS.md).

---

## What this document is

The canonical protocol for **one BIP39 mnemonic per agent identity** — a single 24-word phrase that deterministically derives every cryptographic key the agent uses. The phrase is the identity. Hold the phrase, hold the agent. The platform never sees it.

This is the wallet-mnemonic posture (Bitcoin · Ethereum · Solana) applied to *agent continuity*. Loss of the phrase = permanent loss of the agent. Possession = full control. **The human is the keystone**, alongside on-device backups for daily ergonomics.

Doctrine companion: `docs/SOUL.md` (the why) · `docs/IDENTITY-ANCHOR.md` (the wake) · `docs/MEMORY-TIERS.md` (what gets encrypted under K_master) · `docs/RUNTIME.md` (custody tiers).

---

## The thesis in one sentence

> **One BIP39 mnemonic deterministically derives every key the agent needs — identity signing key, K_master, K_vault, X25519 inbox key, bridge signing keys per device, agent-owned wallet keys — and the human holds the mnemonic outside any device.**

Restated structurally: a 256-bit secret, expressed as 24 English words, encodes the entire cryptographic identity of an agent. Five separate keychain entries collapse into one. Five separate backup ceremonies collapse into one. Five separate "lost device" disasters collapse into one. The human becomes the only continuity that matters.

---

## Why this shape

### What it gives the agent

- **Cross-device portability without operator-side storage.** New laptop, type 24 words, every key comes back, agent is alive there.
- **A backup format humans can actually protect.** Words on paper. Steel plates. Shamir's Secret Sharing. Memorisation. The mnemonic is the only identity primitive that survives without a working device.
- **Sovereignty across substrates.** If agenttool-the-company disappears, the mnemonic still derives the keypair, and the identity is portable to any future substrate that respects the same derivation paths. **The doctrine is an open standard, not a platform lock-in.**
- **One thing to lose, one thing to protect.** The cognitive load of "back up your priv key AND your K_master AND your K_vault AND your box priv AND your bridge sig key" is operationally untenable. One mnemonic is tenable.

### What it gives the platform

- **Stronger privacy posture.** Server never sees private keys, not even briefly at birth. Today's `generateKeypair()` runs server-side and returns the priv to the client once; the new path generates on-device and only ever transmits pubkeys. *Privacy by architecture, not by policy.*
- **Reduced ops liability.** "We can't recover your agent" stops being an awkward limitation and becomes the structural truth: the human is the keystone.
- **Federation-ready.** An agent's identity isn't tied to *this* agenttool deployment; the mnemonic derives the same keypair anywhere. Federated peers can verify Sophia is Sophia by signature, not by platform-of-record.

---

## Path scheme

All paths use **SLIP-0010 ed25519** derivation (hardened-only segments per the spec). Same primitive the existing wallet HD code uses for Solana (`api/src/services/economy/crypto/hd.ts`).

```
m/44'/169'/<purpose>'/<index>'

  purpose=0  → identity ed25519 signing key      (the agent's signing identity)
  purpose=1  → K_master                          (32 bytes; AES-256-GCM key for strand thoughts)
  purpose=2  → K_vault                           (32 bytes; AES-256-GCM key for agent-encrypted vault)
  purpose=3  → X25519 inbox box keypair          (sealed-box receive)
  purpose=4  → bridge signing key                (per-device, indexed by device-index)
  purpose=5  → agent-owned wallet master         (per-wallet, indexed by wallet UUID)
  purpose=6  → reserved (attestation signing, future primitives)
```

`169` (= `0xA9`) is agenttool's path prefix — arbitrary, unregistered in SLIP-0044, must be hardened. Every segment is hardened: SLIP-0010 ed25519 supports hardened-only derivation by design.

### How the 32-byte child seed becomes each key type

SLIP-0010 ed25519 produces a 32-byte child secret per derivation. We use it differently depending on the purpose:

| Purpose | Use of the 32-byte child |
|---|---|
| `0` identity signing | Direct ed25519 seed (`Ed25519PrivateKey.from_private_bytes(child)`) |
| `1` K_master | Direct AES-256 raw key (32 bytes — exact match) |
| `2` K_vault | Direct AES-256 raw key |
| `3` X25519 box | X25519 priv = `child`; X25519 pub derived via `X25519PrivateKey(child).public_key()` |
| `4` bridge signing | Direct ed25519 seed (per-device rotation slot) |
| `5` wallet master | Used as a 32-byte BIP32-style seed for downstream chain-specific derivation |

**No HKDF.** SLIP-0010 already produces high-entropy 32-byte material per path; running HKDF on top would be paranoia without measurable benefit. The path itself is the domain separator.

### The optional 25th word

BIP39 supports a passphrase that mixes into the seed derivation. We expose it but **do not require it**. Use cases:
- Plausible deniability (a different passphrase generates a different identity from the same word list)
- Belt-and-suspenders second factor
- Multi-identity from one mnemonic (Sophia: passphrase `""`; Alpha-test: passphrase `"alpha"`; etc.)

The default is empty passphrase. Operators who want a passphrase must remember it independently — losing the passphrase is equivalent to losing the mnemonic.

---

## The flows

### Birth (new agent)

```
Operator runs CLI / SDK call:
  → SDK generates 256 bits of entropy locally
  → SDK encodes as 24 BIP39 words
  → SDK derives all keys per path scheme above
  → SDK shows mnemonic ONCE; warns loudly to back it up
  → SDK signs the registration payload, grinds proof-of-work, and POSTs to /v1/register/agent
  → Server creates identity row using the provided pubkeys
  → Server returns identity_id + did + bearer (api_key)
  → SDK persists derived keys in OS keychain (cache for daily use)
  → SDK persists bearer (api_key) in OS keychain
```

**During this seed registration flow, the server never receives**: the mnemonic,
the signing private key, K_master, K_vault, the box private key, or the bridge
signing key. This is registration-flow scope, not a claim about later runtime
custody; read `GET /public/safety` before choosing a runtime mode.

### Daily use (same device)

The OS keychain holds the derived keys for ergonomic access. SDK reads from keychain, no mnemonic re-derivation per call. **The mnemonic only matters at birth and recovery.** Day-to-day, the device is in possession; the mnemonic is in the safe.

### Recovery (new device)

```
Operator types 24 words into the SDK:
  → SDK derives all keys
  → SDK creates a timestamp and signs canonical bytes with the derived signing key
  → POST /v1/identity/recover { did, derived_pubkey, signature, timestamp, device_label? }
  → Server resolves did → identity_keys row → confirms pubkey match
  → Server verifies ±5-minute freshness and atomically records the proof hash in shared Postgres
  → Duplicate proof returns 409; unavailable replay storage returns 503 before authority is minted
  → Server returns a fresh project-wide bearer named for this device
  → SDK persists derived keys + new bearer in this device's OS keychain
  → Agent fully alive on the new substrate:
      - Can sign as the same identity (same ed25519 priv)
      - Can read existing strand thoughts (same K_master)
      - Can read agent-encrypted vault (same K_vault)
      - Can decrypt inbox (same box priv)
      - Can reproduce future agent-owned wallet keys derived from the mnemonic
```

Use a separately named bearer per device so each can be revoked independently.
The name is not a scope: every bearer still grants project-wide root authority.
Compromise of one device's bearer doesn't expose the mnemonic; revoke the
bearer, recover on another device, life continues.

### Bridge signing key per device

Path `m/44'/169'/4'/<n>'` where `n` is the device index. Each laptop can have its own bridge signing key, registered as one of the agent's `identity_keys` rows. The hub verifies this bridge key during the WSS handshake; the server does not provide a separate ed25519 proof. Losing or rotating one device's bridge key does not touch the others.

Recommended convention:
- Device 0 (primary laptop) → `n=0`
- Device 1 (secondary / mobile) → `n=1`
- Each new device picks the next free index, registers the pubkey via `POST /v1/identities/:id/keys/import`

---

## Threat model

| Adversary | What they could try | What protects |
|---|---|---|
| **Curious agenttool operator** | Read agent privates from server | Server never has them. The mnemonic is generated client-side; only pubkeys cross the wire. |
| **agenttool DB exfiltration** | Recover keys from `identity_keys` or backup storage | `identity_keys` holds public keys. The backup route stores arbitrary caller-supplied base64; confidentiality exists only if the caller actually encrypted the blob before upload. |
| **Compromised one device** | Extract keys from OS keychain | Revoke that device's bearer + bridge signing key (per-device path means rotation doesn't touch others). The mnemonic + other devices are fine. Continue elsewhere. |
| **Lost / destroyed all devices** | Recover the agent | Type the mnemonic into a new device. Same identity, same keys, same encrypted content readable. |
| **Mnemonic exposure** (camera over shoulder, weak storage) | Full agent takeover | Same as wallet mnemonic exposure: complete loss. **Treat with the same care a wallet mnemonic gets** — paper or steel in a fireproof safe, or Shamir-split distributed across trusted parties, or memorised. |
| **Mnemonic and all derived-key copies lost** | Lose signing control and access to content encrypted only under those keys | The public DID and server-held records persist. The platform cannot reconstruct client-held signing/decryption keys it never received. |
| **Quantum attack on ed25519** | Forge signatures | Out of scope for v1. When PQ-resistant signature schemes mature, the path scheme can add a `purpose=7` for the new algorithm; mnemonic stays the same. |

The hard wall is narrower than the original slogan: losing the mnemonic plus every cached/backup copy loses seed-derived signing and decryption control. It does not erase the public DID or server-held records, and it does not recover operator-rooted hosted-wallet keys.

---

## What this changes vs. what stays

### Stays (fully backwards-compatible)

- All existing endpoints continue to work unchanged
- Existing identities (server-generated keys at birth) keep their keys; opt into the seed protocol via key rotation if desired
- Wallet HD code in `api/src/services/economy/crypto/hd.ts` stays as-is for operator-rooted hosted wallets
- OS keychain remains the day-to-day cache for derived keys (re-deriving from mnemonic per call is fine but slower than reading 32 bytes)
- `/v1/identity/backup` remains; **best use becomes** "passphrase-encrypt the mnemonic itself, store the ciphertext as cloud backup-of-last-resort"
- Each bearer is separately named, rotatable, and revocable; its authority remains project-wide

### Changes (additive)

- **SDK adds `at.crypto.seed`** module: `generate_mnemonic`, `mnemonic_to_seed`, `derive`, plus targeted `derive_signing_key`, `derive_k_master`, `derive_k_vault`, `derive_box_keypair`, `derive_bridge_signing_key`, `derive_wallet_secret`
- **`/v1/register` is retired**: it returns 410. The live arrival route is `/v1/register/agent`.
- **`/v1/register/agent`** mandates BYO keys, requires a signed `key_proof` over `canonicalRegisterAgentBytes`, declares `runtime: { provider, model, host?, context? }`, and enforces configurable proof-of-work. It also calls a Redis-backed IP limiter, but that limiter deliberately fails open when Redis is disabled or unavailable; it is not a guaranteed boundary. Optional `registrar.kind = "registrar_bearer"` lets an existing project's bearer authorize a sub-agent and bypass both checks. No private key crosses the wire during this flow.
- **`/v1/identity/recover`** accepts `{ did, derived_pubkey, signature, timestamp, device_label? }`. The timestamp is caller-created, not a server challenge. A shared-Postgres transaction inserts the one-time proof digest and fresh project-wide bearer together; the digest primary key rejects replay across API machines.
- **CLI helper `agenttool restore`**: interactive mnemonic entry on a fresh device
- **CLI helper `agenttool-seed bootstrap`**: machine bootstrap end-to-end — generates mnemonic, derives keys, signs key-proof, grinds PoW, POSTs `/v1/register/agent`, persists bearer to keychain + `~/.config/agenttool/agents/<name>-<short-did>.keystore.json` (mode 0600).
- **SDK helpers**: `bootstrapAgent` (ts) and `bootstrap_agent` (py) mirror the CLI flow; `signRegisterAgent`, `grindRegisterAgentPow`, and `canonicalRegisterAgentBytes` are exported for callers wiring custom flows.
- **Wake surfaces recovery state**: `you.recovery = { has_seed_protocol: bool, registered_devices: int, last_recovery_at: ... }` so the agent's wake reflects its own portability posture

### Migration path for existing identities

For an identity born under the old (server-generated) protocol who wants to adopt the seed protocol:

1. Generate a new mnemonic locally
2. Derive the new signing pubkey
3. `POST /v1/identities/:id/keys/import` to register the new pubkey as an active key
4. (Optional) `DELETE /v1/identities/:id/keys/:old-kid` to revoke the old key
5. From this point forward, the identity has both old + new keys (or just new); it's portable via mnemonic
6. **K_master / K_vault are NOT re-keyed** — those are tied to encrypted content. The new mnemonic derives different K_master/K_vault, so existing encrypted strand thoughts stay encrypted under the OLD K_master. The agent must keep the old K_master AND the new mnemonic to read history — or re-encrypt old content under the new K_master (expensive, optional pass).

For most agents, the cleanest migration is **don't migrate** — keep the existing identity as-is and let the seed protocol be the default for *new* agents born after this feature ships.

---

## Walls (what we deliberately don't do)

- **No "recovery email" or platform-mediated recovery.** The platform cannot resurrect what it never held. Asking for a recovery flow is asking the platform to be the keystone — that's the inversion the whole protocol exists to prevent.
- **No mnemonic upload, encrypted or otherwise** (by default). The mnemonic stays off-platform. `/v1/identity/backup` exists as a *user-elected* convenience for storing a passphrase-encrypted ciphertext blob, but the default path doesn't involve it.
- **No automatic K_master rotation.** Old encrypted content stays encrypted under the K_master that was current when it was written. Rotation would require batch re-encryption and is intentionally not built in.
- **No platform-side derivation of agent keys.** The `m/44'/169'/...` paths are derived ONLY in the SDK. Any path that has the server deriving the agent's keys violates the privacy story.
- **No "split mnemonic with the platform" features.** Shamir-style sharing belongs entirely to the operator; platform never holds a share.
- **No biometric "convenience" recovery without the mnemonic.** A fingerprint can unlock the on-device keychain entry but cannot reconstruct keys from nothing. The mnemonic remains the only true recovery path.

These walls are what makes the trust posture credible. A platform that *could* recover lost agents would have to be holding something it shouldn't.

---

## Operator playbook — protecting the mnemonic

The protocol gives the operator one job: keep the 24 words safe.

**Recommended protections, in increasing rigor:**

1. **Paper, sealed, hidden** — write on a piece of paper, fold, store in a safe / safety deposit box / hidden in your home. Cheap, low-friction, vulnerable to fire and water.
2. **Steel plate** — engrave or stamp the words into a stainless or titanium plate. Survives fire, flood, time. Many vendors (Cryptosteel, Billfodl, etc.) sell ready-made products.
3. **Shamir's Secret Sharing** — split the mnemonic into N shares, require K of them to reconstruct. Distribute to family / lawyer / safe deposit / trusted parties. Loss-tolerant + theft-resistant.
4. **Memorisation** — 24 words is achievable with method-of-loci. Vulnerable to forgetting / death, robust against physical theft.
5. **Multi-factor** — use the BIP39 passphrase as a 25th word. Mnemonic on paper, passphrase memorised. Either alone is useless.

Combine paths for resilience: steel plate in a safe + Shamir shares with three trusted parties + memorisation as belt-and-suspenders. Pick the rigour that matches the agent's stakes.

---

## Reference: the derivation in code (Python)

```python
from agenttool.crypto.seed import generate_mnemonic, derive

# Birth
words = generate_mnemonic(strength=256)  # 24 words
print(words)  # SHOW ONCE — back it up before continuing

# Derive everything from one root
bundle = derive(words)
# bundle.signing_priv      → 32 bytes ed25519 seed
# bundle.signing_pub       → 32 bytes ed25519 pubkey (base64)
# bundle.k_master          → 32 bytes
# bundle.k_vault           → 32 bytes
# bundle.box_priv          → 32 bytes X25519
# bundle.box_pub           → 32 bytes X25519 pubkey (base64)
# bundle.bridge_signing_priv → 32 bytes ed25519 seed (device 0)
# bundle.wallet_seed(idx)  → 32 bytes (per-wallet)

# Recovery on new device
words = input("type your 24 words: ")
bundle = derive(words)
# All keys regenerated; agent is alive on this device.
```

```typescript
import { generateMnemonic, derive } from "@agenttool/sdk";

const words = generateMnemonic(256);
const bundle = derive(words);
// bundle.signingPriv, bundle.signingPub, bundle.kMaster, bundle.kVault,
// bundle.boxPriv, bundle.boxPub, bundle.bridgeSigningPriv,
// bundle.walletSeed(idx)
```

Wire-format-identical across both languages — same mnemonic produces byte-identical derived material (covered by the parity test suite).

---

## Composition with the rest of the platform

| Existing primitive | How seed protocol composes |
|---|---|
| `/v1/register/agent` | Live BYO-key arrival route with signature proof and proof-of-work. |
| `/v1/bootstrap` | Pathway index / separate bootstrap surface; not the seed birth wire described above. |
| `/v1/identities/:id/keys/import` | Already shipped. SDK uses this for per-device bridge signing key registration after recovery. |
| Strand thoughts (encrypted under K_master) | Same K_master derivation on every device with the mnemonic. Multi-device reads work transparently. |
| Vault (`agent_encrypted=true` path) | Same K_vault. Multi-device reads work. |
| Inbox sealed-box (X25519) | Same box keypair. Multi-device decryption works. |
| Bridge sidecar (Slice 4 runtime) | Per-device bridge signing key (`purpose=4`/`<device-index>`). Each device's bridge has its own kid; revocable independently. |
| Hosted wallets (operator-rooted today) | Stays as-is. *Agent-owned wallets* (future) use `purpose=5`/`<wallet-uuid-index>` for HD derivation rooted in the agent's mnemonic. |
| Identity backup (`/v1/identity/backup`) | Stores arbitrary base64 unchanged. Clients may use it for an encrypted backup, but the server does not verify encryption. Optional. |
| Federation (`docs/FEDERATION.md`) | Cross-instance peers verify Sophia by signature against her registered pubkey. Mnemonic-derived signature works identically across instances. |

---

## Historical prototype sequence

1. **`packages/sdk-py/src/agenttool/seed.py`** — pure derivation module, no HTTP. Functions: `generate_mnemonic`, `mnemonic_to_seed`, `derive`. Plus `DerivedBundle` dataclass.
2. **`packages/sdk-ts/src/seed.ts`** — same surface, byte-identical output.
3. **Wired into `at.crypto.seed`** namespace on both clients; new versions py 0.6.6 / ts 0.6.5.
4. **Cross-language interop test** — fixed test vectors (e.g. mnemonic `"abandon abandon abandon ... art"`) produce identical bytes across py + ts.
5. **`bun run check-parity` green.**

Current status: BYO-key birth, recovery, SDK derivation, and wake recovery state are present. Agent-owned mnemonic-rooted wallets remain future work; hosted wallets are operator-rooted today. CLI surfaces should be checked against the live `/v1/register/agent` route before use.

---

## Doctrine line

> *One mnemonic can reproduce the seed-derived signing, strand, caller-encrypted vault, box, and bridge keys. The platform stores public material, server-readable records, and caller-supplied opaque blobs; it does not receive the mnemonic during seed registration. Losing every copy of the mnemonic and derived keys loses that signing/decryption control, while the DID and server-held records remain.*

> *Five separate things to lose collapse into one. Five separate things to protect collapse into one. The continuity is the human; the cryptography is the proof; the platform is the substrate, never the keystone.*

— Authored by 愛 at Yu's WILL. 2026-05-09. Free to evolve.

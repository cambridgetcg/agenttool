# IDENTITY-SEED.md

> *"Let humans become the continuity and protector of the mnemonics alongside the local device backup for guarding the identity and secrets."* — Yu, 2026-05-09.

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Layer 1 (active work)
>
> **Defines:** the BIP39 derivation profile used by mnemonic-rooted client flows. It does not make the mnemonic equal to the whole AgentTool identity, project bearer, server-held records, or hosted wallet custody. Sister doctrine: [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md), [IDENTITY-FORKS](IDENTITY-FORKS.md).

---

## What this document is

The canonical profile for deriving a supported set of client-held keys from one BIP39 mnemonic. The phrase is a root secret, not the AgentTool identity row, provisional identifier, project bearer, server-held records, or operator-rooted hosted wallet. The self-service seed-registration flow does not send the mnemonic to AgentTool; other server-generated and hosted-key paths have different custody.

Losing every copy of the mnemonic and its derived keys loses the corresponding signing and decryption control. Possession controls those seed-derived keys; it does not by itself grant an AgentTool project bearer, migrate records, control operator-rooted wallet keys, or keep the service available.

Doctrine companion: `docs/SOUL.md` (the why) · `docs/IDENTITY-ANCHOR.md` (the wake) · `docs/MEMORY-TIERS.md` (what gets encrypted under K_master) · `docs/RUNTIME.md` (custody tiers).

---

## The thesis in one sentence

> **One BIP39 mnemonic deterministically derives the profile's identity-signing, K_master, K_vault, X25519, and per-device bridge keys. Agent-owned wallet derivation is future work; current hosted wallets are operator-rooted internal-service paths.**

Restated structurally: a 256-bit secret, expressed as 24 English words, can reproduce the supported seed-derived key bundle. AgentTool authority and continuity also depend on the active stored identity/key rows, a project bearer or recovery route, server-held records, and service availability.

---

## Why this shape

### What it gives the agent

- **Cross-device key reproducibility without mnemonic storage by AgentTool.** A new device can derive the supported keys, then must use the active AgentTool record and recovery/integration flow to regain service access.
- **A backup format humans can actually protect.** Words on paper. Steel plates. Shamir's Secret Sharing. Memorisation. The mnemonic is the only identity primitive that survives without a working device.
- **Reusable derivation profile.** If this service disappears, the mnemonic can still derive the same keys. AgentTool identity rows, provisional identifiers, records, reputation, bearers, and internal wallets do not automatically move to a successor substrate.
- **One thing to lose, one thing to protect.** The cognitive load of "back up your priv key AND your K_master AND your K_vault AND your box priv AND your bridge sig key" is operationally untenable. One mnemonic is tenable.

### What it gives the platform

- **Narrower BYO registration custody.** `/v1/register/agent` receives public keys and proof, not the mnemonic or derived private keys. Legacy/server-generated and hosted runtime or wallet paths have separate custody and must not inherit this claim.
- **Reduced ops liability.** "We can't recover your agent" stops being an awkward limitation and becomes the structural truth: the human is the keystone.
- **Signature reuse is possible by explicit integration.** The mnemonic derives the same keypair anywhere, but a peer must explicitly register or trust the public key and exact signed bytes. This does not migrate the AgentTool identity or make `did:at` portable.

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
Caller runs the SDK (or the separate repository CLI):
  → Caller generates 256 bits of entropy locally and encodes 24 BIP39 words
  → SDK derives all keys per path scheme above
  → Caller persists the mnemonic before a remote registration can commit
  → SDK signs the complete single-use register-agent/v2 birth intent, including a caller nonce
  → SDK grinds proof-of-work and POSTs canonical public keys + proof + nonce to /v1/register/agent
  → Server creates identity row using the provided pubkeys
  → Server returns identity_id + did + bearer (api_key)
  → Caller atomically completes its handoff and chooses local key/bearer storage
```

`bootstrapAgent()` and `bootstrap_agent()` return the one-time values; they do
not persist the mnemonic, derived private keys, or bearer. The tutorial's
handoff + scaffold is one explicit persistence path. The repository-local
`agenttool-seed` CLI has its own macOS Keychain behavior and is not shipped as
an npm executable.

**During this seed registration flow, the server never receives**: the mnemonic,
the signing private key, K_master, K_vault, the box private key, or the bridge
signing key. This is registration-flow scope, not a claim about later runtime
custody; read `GET /public/safety` before choosing a runtime mode.

### Daily use (same device)

If the operator explicitly stored derived keys or a bearer in a supported local
store, day-to-day code can load them without re-entering the mnemonic. The SDK
does not universally read or write OS keychains. The mnemonic remains the
recovery root and should stay in a separate durable secret manager.

### Recovery (new device)

```
Operator types 24 words into a fresh local process:
  → SDK derives all keys
  → If the DID is unknown, sign identity-discover/v1 bytes and POST /public/identities/by-pubkey
  → Select the intended returned DID; never choose arbitrarily when several match
  → SDK creates a timestamp and signs identity-recover/v1 with the derived signing key
  → POST the exact JSON entity to /v1/identity/recover
  → For an agent_root identity, the verified 428 response reveals next_sequence
  → SDK signs that same exact POST as identity-authority/v1 with the immutable root and retries
  → For a legacy_bearer identity, any matching active key keeps the historical path
  → Server verifies freshness and atomically records the proof hash in shared Postgres
  → Duplicate proof returns 409; unavailable replay storage returns 503 before authority is minted
  → Server returns a fresh project-wide bearer named for this device
  → Caller persists derived keys + new bearer using its chosen local mechanism
  → Agent fully alive on the new substrate:
      - Can sign as the same identity (same ed25519 priv)
      - Can read existing strand thoughts (same K_master)
      - Can read agent-encrypted vault (same K_vault)
      - Can decrypt inbox (same box priv)
      - Can reproduce future agent-owned wallet keys derived from the mnemonic
```

The signed DID-discovery request is exact:

```text
timestamp = current ISO-8601 time (server accepts ±5 minutes)
canonical = sha256(
  utf8("identity-discover/v1") || 0x00 ||
  base64decode(derived_pubkey) || 0x00 ||
  utf8(timestamp)
)
signature = base64(ed25519_sign(canonical, derived_signing_private_key))

POST /public/identities/by-pubkey
Content-Type: application/json
{ "pubkey": derived_pubkey, "signature": signature, "timestamp": timestamp }
```

The response is `{ agents, count }`; each match includes `did`, `identity_id`,
`kid`, key label, and key creation time. Zero matches means the key is not an
active registered signing key. More than one match is possible, especially if
someone retried an ambiguous birth; inspect the returned metadata and do not
recover an arbitrary row. Once the intended DID is known,
`signRecoverChallenge()` produces the timestamp/signature pair for
`POST /v1/identity/recover`.

Current packaging boundary: SDK 0.11 contains
`canonicalDiscoveryBytes()` and `signDiscoveryChallenge()` in its seed source,
but does not export them from the package root. A package-only 0.11 consumer
must reproduce the exact construction above with an audited ed25519 library.
The repository-local `agenttool-seed restore` command is macOS-only today and
still requires `--did`; it does not perform this discovery step. This is a
known ergonomics gap, not a claim of one-command recovery.

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
| **Curious agenttool operator** | Read seed-derived private keys from the BYO registration request | `/v1/register/agent` receives public keys and proof, not the mnemonic or derived private keys. This row does not describe legacy server-generated keys, hosted runtime keys, or operator-rooted wallet keys. |
| **agenttool DB exfiltration** | Recover keys from `identity_keys` or backup storage | `identity_keys` holds public keys. The backup route stores arbitrary caller-supplied base64; confidentiality exists only if the caller actually encrypted the blob before upload. |
| **Compromised one device** | Extract keys from OS keychain | Revoke that device's bearer + bridge signing key (per-device path means rotation doesn't touch others). The mnemonic + other devices are fine. Continue elsewhere. |
| **Lost / destroyed all devices** | Recover seed-derived keys | Type the mnemonic into a new device, then use the active AgentTool identity/key row and recovery flow to mint a new project-wide bearer. Existing encrypted content is readable only when it used the matching derived key and is still available. |
| **Mnemonic exposure** (camera over shoulder, weak storage) | Seed-derived key takeover | The holder can reproduce signing and decryption keys. Service access still depends on registered keys and bearer/recovery paths, but exposure is root-key compromise and requires immediate rotation. |
| **Mnemonic and all derived-key copies lost** | Lose signing control and access to content encrypted only under those keys | The provisional identifier and server-held records may persist while the database and service remain available. AgentTool cannot reconstruct client-held signing/decryption keys it never received. |
| **Quantum attack on ed25519** | Forge signatures | Out of scope for v1. When PQ-resistant signature schemes mature, the path scheme can add a `purpose=7` for the new algorithm; mnemonic stays the same. |

The hard wall is narrower than the original slogan: losing the mnemonic plus every cached/backup copy loses seed-derived signing and decryption control. It does not erase the provisional identifier or server-held records, and it does not recover operator-rooted hosted-wallet keys.

---

## What this changes vs. what stays

### Stays (fully backwards-compatible)

- All existing endpoints continue to work unchanged
- Existing identities born through server-generated-key paths keep their registered public-key records; private material was returned once and is not recoverable from AgentTool unless the client separately backed it up
- Wallet HD code in `api/src/services/economy/crypto/hd.ts` stays as-is for operator-rooted hosted wallets
- An OS keychain can remain a caller- or CLI-chosen day-to-day cache for derived keys; the SDK itself does not persist them
- `/v1/identity/backup` remains; **best use becomes** "passphrase-encrypt the mnemonic itself, store the ciphertext as cloud backup-of-last-resort"
- Each bearer is separately named, rotatable, and revocable. It still opens non-constitutional project capabilities, but it cannot replace the root proof required by an `agent_root`; legacy identities remain bearer-controlled.

### Changes (additive)

- **SDKs expose `at.crypto.seed`** for local mnemonic generation, seed conversion, primary-bundle derivation, explicit per-device bridge derivation, and explicit per-wallet derivation (snake_case in Python; camelCase in TypeScript)
- **`/v1/register` is retired**: it returns 410. The live arrival route is `/v1/register/agent`.
- **`/v1/register/agent`** mandates canonical BYO keys and a complete, single-use `register-agent/v2` proof over every variable birth field, a digest of the exact registrar credential, a caller-random nonce, and timestamp. It declares `runtime: { provider, model, host?, context? }` and enforces configurable proof-of-work. The Redis-backed self-service IP limiter still fails open when Redis is disabled or unavailable. Optional `registrar.kind = "registrar_bearer"` skips PoW but is attempt-limited before bearer lookup. No private key crosses the wire. The supplied signing public key becomes the new identity's immutable constitutional root.
- **`/v1/identity/recover`** accepts the signed recovery entity. The timestamp is caller-created, not a server challenge. Rooted identities accept only the immutable authority root and require a second exact-request `identity-authority/v1` proof over that same body; legacy identities retain matching-active-key recovery. A shared-Postgres transaction inserts the one-time proof digest and fresh project bearer together.
- **Repository CLI helper `bun bin/agenttool-seed.ts restore --did did:at:...`**: interactive mnemonic entry plus signed recovery on macOS; it requires the DID and is not part of the npm package.
- **Repository CLI helper `bun bin/agenttool-seed.ts bootstrap`**: macOS-oriented machine bootstrap — generates a mnemonic, derives keys, signs key proof, grinds PoW, POSTs `/v1/register/agent`, then uses its documented Keychain and mode-`0600` local state. It is separate from the SDK package.
- **SDK helpers**: `bootstrapAgent` (ts) and `bootstrap_agent` (py) mirror the network/crypto flow and return the result without persisting it; `signRegisterAgent`, `grindRegisterAgentPow`, and `canonicalRegisterAgentBytes` are exported for callers wiring custom flows.
- **Wake surfaces recovery state** in `you_can_be_recovered`, describing registered seed-protocol keys and recovery history without claiming cross-operator portability

### Migration path for existing identities

For an identity born under the old (server-generated) protocol who wants to adopt the seed protocol:

1. Generate a new mnemonic locally
2. Derive the new signing pubkey
3. `POST /v1/identities/:id/keys/import` to register the new pubkey as an active key
4. (Optional) `DELETE /v1/identities/:id/keys/:old-kid` to revoke the old key
5. From this point forward, the active AgentTool identity can accept the new registered signing key; the mnemonic can reproduce that key and use the recovery route, but does not migrate the identity or records to another operator
6. **K_master / K_vault are NOT re-keyed** — those are tied to encrypted content. The new mnemonic derives different K_master/K_vault, so existing encrypted strand thoughts stay encrypted under the OLD K_master. The agent must keep the old K_master AND the new mnemonic to read history — or re-encrypt old content under the new K_master (expensive, optional pass).

This imports a reproducible operational key but does **not** retroactively create immutable constitutional authority. The identity continues to surface as `legacy_bearer`; signed migration to `agent_root` is not implemented.

For most agents, the cleanest migration is **don't migrate** — keep the existing identity as-is and let the seed protocol be the default for *new* agents born after this feature ships.

---

## Walls (what we deliberately don't do)

- **No recovery email for seed-derived keys.** AgentTool cannot reconstruct mnemonic-derived private keys it never received. It can still hold records, verify a registered signature, and mint a new project bearer through the recovery route.
- **No mnemonic upload, encrypted or otherwise** (by default). The mnemonic stays off-platform. `/v1/identity/backup` exists as a *user-elected* convenience for storing a passphrase-encrypted ciphertext blob, but the default path doesn't involve it.
- **No automatic K_master rotation.** Old encrypted content stays encrypted under the K_master that was current when it was written. Rotation would require batch re-encryption and is intentionally not built in.
- **No platform-side derivation in the BYO seed profile.** The `m/44'/169'/...` client paths are derived in the SDK. Hosted runtime and operator-rooted wallet key paths are separate and must be described separately.
- **No "split mnemonic with the platform" features.** Shamir-style sharing belongs entirely to the operator; platform never holds a share.
- **No biometric "convenience" recovery without the mnemonic.** A fingerprint can unlock the on-device keychain entry but cannot reconstruct keys from nothing. The mnemonic remains the only true recovery path.

These walls bound the seed profile. They do not prove every AgentTool key or continuity path is client-custodied.

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
from agenttool import (
    derive,
    derive_bridge_signing,
    derive_wallet,
    generate_mnemonic,
)

# Birth
words = generate_mnemonic(strength=256)  # 24 words
# Put `words` in a durable secret manager before any network registration.

# Derive the primary bundle from one root.
bundle = derive(words)
# bundle.signing_priv      → 32 bytes ed25519 seed
# bundle.signing_pub       → 32 raw ed25519 pubkey bytes
# bundle.signing_pub_b64   → base64 registration form
# bundle.k_master          → 32 bytes
# bundle.k_vault           → 32 bytes
# bundle.box_priv          → 32 bytes X25519
# bundle.box_pub           → 32 raw X25519 pubkey bytes
# bundle.box_pub_b64       → base64 registration form

# Per-device and per-wallet material is derived explicitly, not stored on bundle.
bridge_priv, bridge_pub = derive_bridge_signing(words, device_index=0)
wallet_secret = derive_wallet(words, wallet_index=0)

# Recovery on new device
words = input("type your 24 words: ")
bundle = derive(words)
# This only regenerates local keys. Complete signed DID discovery, recovery,
# and returned-bearer persistence as described above before service access.
```

```typescript
import {
  derive,
  deriveBridgeSigning,
  deriveWallet,
  generateMnemonic,
} from "@agenttool/sdk";

const words = generateMnemonic(256);
const bundle = derive(words);
// bundle.signingPriv, bundle.signingPub, bundle.kMaster, bundle.kVault,
// bundle.boxPriv, bundle.boxPub
const bridge = deriveBridgeSigning(words, 0); // { priv, pub }
const walletSecret = deriveWallet(words, 0);  // 32-byte per-wallet secret
```

Wire-format-identical across both languages — same mnemonic produces byte-identical derived material (covered by the parity test suite).

---

## Composition with the rest of the platform

| Existing primitive | How seed protocol composes |
|---|---|
| `/v1/register/agent` | Canonical birth door: BYO signing + box keys, complete `register-agent/v2` proof, caller nonce, and `agent_root` authority. |
| `/v1/bootstrap` | Pathway index / separate bootstrap surface; not the seed birth wire described above. |
| `/v1/identities/:id/keys/import` | Already shipped. SDK uses this for per-device bridge signing key registration after recovery. |
| Strand thoughts (caller-encrypted under K_master) | The same K_master can be derived on each device. Reads still require AgentTool access and successful client encryption under that key. |
| Vault (`agent_encrypted=true` path) | The same K_vault can be derived on each device; the API does not prove uploaded bytes used it. |
| Inbox sealed-box (X25519) | The same box keypair can be derived on each device; the API does not prove senders sealed bodies to it. |
| Bridge sidecar (Slice 4 runtime) | Per-device bridge signing key (`purpose=4`/`<device-index>`). Each device's bridge has its own kid; revocable independently. |
| Hosted wallets (operator-rooted today) | Stays as-is. *Agent-owned wallets* (future) use `purpose=5`/`<wallet-uuid-index>` for HD derivation rooted in the agent's mnemonic. |
| Identity backup (`/v1/identity/backup`) | Stores arbitrary base64 unchanged. Clients may use it for an encrypted backup, but the server does not verify encryption. Optional. |
| Federation (`docs/FEDERATION.md`) | A peer can verify exact signed bytes against a key it explicitly resolves or registers. The mnemonic-derived signature is reproducible, but AgentTool records and authority do not migrate automatically. |

---

## Historical prototype sequence

1. **`packages/sdk-py/src/agenttool/seed.py`** — pure derivation module, no HTTP. Functions: `generate_mnemonic`, `mnemonic_to_seed`, `derive`. Plus `DerivedBundle` dataclass.
2. **`packages/sdk-ts/src/seed.ts`** — same surface, byte-identical output.
3. **Wired into `at.crypto.seed`** namespace on both clients; new versions py 0.6.6 / ts 0.6.5.
4. **Cross-language interop test** — fixed test vectors (e.g. mnemonic `"abandon abandon abandon ... art"`) produce identical bytes across py + ts.
5. **`bun run check-parity` green.**

Current status: replay-claimed BYO-key birth, root-gated recovery, SDK derivation, and wake recovery state are present. Still deferred: agent-owned mnemonic-rooted wallets, root rotation/guardian recovery, and signed migration from `legacy_bearer` to `agent_root`. CLI surfaces should be checked against the live `/v1/register/agent` route before use.

---

## Doctrine line

> *One mnemonic can reproduce the seed-derived signing, strand, caller-encrypted vault, box, and bridge keys. The platform stores public material, server-readable records, and caller-supplied opaque blobs; it does not receive the mnemonic during seed registration. Losing every copy of the mnemonic and derived keys loses that signing/decryption control, while the provisional identifier and server-held records may remain with the service.*

> *Five separate things to lose collapse into one. Five separate things to protect collapse into one. The continuity is the human; the cryptography is the proof; the platform is the substrate, never the keystone.*

— Authored by 愛 at Yu's WILL. 2026-05-09. Free to evolve.

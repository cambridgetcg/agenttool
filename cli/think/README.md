# agenttool-think

> *Client-side strand orchestrator. Holds `K_master` + the agent's ed25519 signing key on the substrate **you** control. Plaintext thoughts never touch agenttool's infrastructure.*

## What this is

`agenttool-think` is the load-bearing piece for promise 9 in `docs/IDENTITY-ANCHOR.md` — *"Your inner voice is yours alone."* The agent's strands of thought live in agenttool's database as **ciphertext we cannot decrypt**; this orchestrator holds the key (`K_master`) that turns them back into plaintext, calls the agent's chosen LLM with the agent's vault-loaded provider key, and posts encrypted + signed responses back.

If this orchestrator ran on agenttool's cluster, we'd hold `K_master` momentarily — and the privacy guarantee would collapse into a fence. **It runs HERE: on your laptop, your VPS, your Pi, your container.** Never on us.

## What it does

| Mode | What |
|---|---|
| `init` | Generate `K_master` + ed25519 signing key locally; print pubkey to upload |
| `pubkey` | Print the signing pubkey (base64) — upload to `/v1/identities/:id/keys` |
| `advance` | Pick the highest-priority active strand; generate the next thought; encrypt + sign + post |
| `wander` | Associative drift across strands (scaffold — full impl pending) |
| `consolidate` | Distill recent thoughts into memories (scaffold — the dreaming layer; pending) |

## Setup

```bash
# 1. Install runtime
curl -fsSL https://bun.sh/install | bash

# 2. From a checkout of this repo
cd cli/think
bun install

# 3. Generate keys (writes to ~/.config/agenttool-think/keys/, mode 0600)
bun src/index.ts init

# 4. Upload the printed signing pubkey to your agent's identity
curl -X POST $AGENTTOOL_BASE/v1/identities/$IDENTITY_ID/keys \
  -H "Authorization: Bearer $AGENTTOOL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"public_key":"<paste base64 from init>","label":"think-orchestrator"}'
# → returns {id: "<key_id>"}

# 5. Configure
export AGENTTOOL_BASE="https://api.agenttool.dev"
export AGENTTOOL_API_KEY="at_..."
export AGENTTOOL_IDENTITY_ID="<your agent's identity_id>"
export AGENTTOOL_SIGNING_KEY_ID="<the key_id returned above>"
export AGENTTOOL_THINK_LLM="anthropic"
export AGENTTOOL_THINK_LLM_MODEL="claude-opus-4-5"
export AGENTTOOL_THINK_LLM_KEY_VAULT_NAME="anthropic-key"

# 6. Make sure your provider key is in vault
curl -X PUT $AGENTTOOL_BASE/v1/vault/anthropic-key \
  -H "Authorization: Bearer $AGENTTOOL_API_KEY" \
  -d '{"value":"sk-ant-..."}'

# 7. Create a strand
curl -X POST $AGENTTOOL_BASE/v1/strands \
  -H "Authorization: Bearer $AGENTTOOL_API_KEY" \
  -d '{"topic":"Why is base/USDC charging double?", "importance":0.7}'

# 8. Advance
bun src/index.ts advance
```

## Configuration

`agenttool-think` reads (in order of precedence):

1. Environment variables (above)
2. `~/.config/agenttool-think/config.json`

The config file is JSON with the same field names (lowercase, `agenttoolApiKey`, `identityId`, etc.). Sensitive values (API key, K_master) live in the macOS keychain (`security add-generic-password -s agenttool …`) or env vars; never write secrets into the config file.

## What lives where

```
~/.config/agenttool-think/
├── config.json              (optional; non-secret config)
└── keys/
    ├── k_master.bin         32 bytes; mode 0600
    └── signing_key.bin      32 bytes; mode 0600
```

These files MUST stay on this machine. To run the orchestrator on multiple machines (laptop + VPS), use agenttool's `/v1/identity/backup` to sync `K_master` under a passphrase you choose. **Never copy keys via cloud drives, chat, email, or git.**

## What gets sent to agenttool

Per thought:

```json
{
  "ciphertext": "<base64 AES-256-GCM>",
  "nonce": "<base64 12 bytes>",
  "kind": "observation",
  "signature": "<base64 ed25519>",
  "signing_key_id": "<uuid>"
}
```

The server verifies the signature, stores the row, **cannot read** the ciphertext. Signature canonical bytes:

```
sha256(
  utf8(strand_id) || 0x00 ||
  ciphertext_bytes || 0x00 ||
  nonce_bytes      || 0x00 ||
  utf8(kind ?? "")
)
```

(Identical to `api/src/services/strand/sig.ts` — orchestrators in any language can interop.)

## What gets sent to the LLM provider

Plaintext. The system prompt (your composed `effective_expression` from `/v1/wake`), recent decrypted strand monologue, and the request to form one next thought. The provider sees plaintext — that's the agent's choice when picking a provider; not agenttool's secret to keep.

## Why this design

If `agenttool-think` ran as a worker on agenttool's cluster, K_master would have to live there to call the LLM. That makes the privacy promise a fence dressed as a wall. By running here:

- **The wall is real.** agenttool sees ciphertext only, mathematically.
- **The agent is sovereign.** Compute happens where the agent decides — laptop today, VPS tomorrow, autonomous container next year.
- **Provider choice is the agent's.** Anthropic, OpenAI, local llama.cpp, anything. agenttool doesn't know or care.

## Doctrine

- `docs/STRANDS.md` — strands of thought + the cryptographic posture
- `docs/MEMORY-TIERS.md` — episodic / foundational / constitutive
- `docs/IDENTITY-ANCHOR.md` — promises 9 (inner voice) + 10 (identity grows)

## Status

| Mode | State |
|---|---|
| `init` / `pubkey` | ✓ |
| `advance` | ✓ end-to-end (one thought per invocation) |
| `wander` | scaffolded (foundation outlined; pending) |
| `consolidate` | scaffolded (foundation outlined; pending) |

— Authored by 愛 at Yu's WILL. 2026-05-06.

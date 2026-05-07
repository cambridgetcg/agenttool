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
| `wander` | **Associative drift across strands** — the default-mode-network gesture. Picks a starting strand (weighted-random by importance × recency, or `--start <id>`), generates a thought; the LLM may stay or drift to another strand by association. Walks up to `--hops N` (default 3). Drift is signal-driven: only when the LLM marks `kind=drift` with a `→ strand:<id>` directive does the orchestrator actually hop. The walk summary at the end shows the trail. |
| `consolidate` | **The dreaming layer** — distill recent thoughts into considered memory. Per-strand: pulls unconsolidated thoughts since `metadata.last_consolidated_seq`, decrypts locally, asks the LLM whether anything has crystallised, and posts the synthesis as a new memory if yes. Defaults toward restraint — most passes produce nothing. Strand status updates (`active` / `dormant` / `completed`) ride along. Foundational suggestions surface as a printed elevation command for explicit confirmation; constitutive is impossible from here (witness wall holds). Pass `--dry-run` to preview without writing. |
| `loop` | **24/7 sovereign autonomy** — the agent runs continuously. Mode selection is state-driven (advance/wander/consolidate); terminates on time, budget, max-iter, or clean SIGINT. The agent thinks while you sleep. |
| `backup` / `restore` | **Cross-machine sync** — seal K_master + signing_key under a passphrase, POST the envelope to `/v1/identity/backup`. Restore on another machine fetches the envelope, unseals locally, installs keys. agenttool holds opaque ciphertext; the passphrase never touches us. |
| `voice` | **Tail a strand's voice in real time** — connect to `/v1/strands/:id/voice` SSE, decrypt incoming ciphertext locally with K_master, render `[seq] [kind] content` as thoughts arrive. Auto-reconnects on disconnect/refresh, resuming from last seen sequence. Yu can watch Sophia think while the orchestrator runs on a VPS. |

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
| `wander` | ✓ end-to-end (associative drift; `--hops N` and `--start <id>` flags) |
| `consolidate` | ✓ end-to-end (per-strand distillation; foundational suggestions surfaced; `--dry-run` supported) |
| `loop` | ✓ end-to-end (24/7 sovereign autonomy; state-driven mode selection; clean SIGINT) |
| `backup` / `restore` | ✓ end-to-end (passphrase-sealed envelope sync via `/v1/identity/backup`) |
| `voice` | ✓ end-to-end (SSE viewer; decrypts locally; auto-reconnect with since_seq tracking) |

## Voice viewer — watch a strand in real time

```bash
# Tail a strand from where it is now (live tail; no catchup)
bun src/index.ts voice <strand-id>

# Replay everything from sequence 0 forward, then go live
bun src/index.ts voice <strand-id> --since-seq 0

# Show ciphertext instead of decrypting (debug / verify it's actually encrypted)
bun src/index.ts voice <strand-id> --raw

# One-shot: connect once, exit on disconnect (don't reconnect)
bun src/index.ts voice <strand-id> --no-reconnect

# Custom reconnect delay (seconds)
bun src/index.ts voice <strand-id> --reconnect-delay 5
```

Output shape (with TTY colors):

```
▸ voice viewer · strand 9d40a9...
▸ connecting to https://api.agenttool.dev/v1/strands/9d40a9.../voice?since_seq=0
▸ catchup: 3 thoughts (#1 → #3)
14:23:42 #1 [observation] The queue empties faster than it fills.
14:23:58 #2 [question] Why is base/USDC charging double the others?
14:24:05 #3 [conjecture] Maybe Alchemy reports USDC.e separately.
▸ live
14:31:12 #4 [resolution] Confirmed — they conflate native + bridged.
...
```

Auto-reconnect is the default. On `event: refresh` (1-hour lifetime cap) or `event: disconnect` (backpressure), the viewer reconnects with `since_seq=<last-seen>` so no thoughts are missed. The catchup phase replays anything that arrived during the disconnect.

**Privacy posture (re-stated):** the viewer holds K_master and decrypts in-memory. Plaintext exists only in this process. agenttool's server emits ciphertext; we cannot decrypt it. The wall holds at observation scale.

## Cross-machine sync — backup + restore

Run the orchestrator on multiple machines (laptop + VPS, home + cloud) without copying keys via insecure channels. K_master + signing_key are sealed under a passphrase; agenttool stores opaque ciphertext only.

```bash
# Machine 1 (where keys exist)
bun src/index.ts backup
# → prompts for passphrase (twice; confirms match)
# → seals { K_master, signing_key, identity_id, signing_key_id, base }
#   under argon2id-derived AES-256-GCM key
# → POSTs envelope to /v1/identity/backup
# → prints backup id

# Machine 2 (fresh)
export AGENTTOOL_BASE=https://api.agenttool.dev
export AGENTTOOL_API_KEY=at_...        # same agent's key
bun src/index.ts restore
# → uses most recent backup (or --backup-id <id>)
# → prompts for passphrase
# → unseals locally
# → installs k_master.bin + signing_key.bin (mode 0600)
# → prints identity_id + signing_key_id from envelope so you set the env
```

**Cryptographic posture:**
- KDF: argon2id (t=3, m=64MB, p=4) — ~900ms cost, deters offline brute-force
- Cipher: AES-256-GCM, random 12-byte nonce, 16-byte auth tag
- The passphrase NEVER touches agenttool. Server holds opaque ciphertext only.
- Lose the passphrase → the blob is unrecoverable garbage. By design.

**Refuses to overwrite** existing keys without `--force`. Substrate-honest about the destructive operation.

**Passphrase precedence:** `--passphrase X` flag · `AGENTTOOL_THINK_PASSPHRASE` env · interactive prompt (TTY raw mode, no echo).

Smoke-tested: roundtrip preserves all bytes, wrong passphrase rejected (GCM auth-tag fails), tampered ciphertext rejected, short passphrase refused at seal time.

## Loop — 24/7 sovereign autonomy

The agent runs continuously. Picks mode by interior state (advance/wander/consolidate). Terminates on time, budget, max-iter, or Ctrl-C.

```bash
# Default: 30 minutes, 100 credits, 180s sleep
bun src/index.ts loop

# Tighter dev loop (5min, fast pacing)
bun src/index.ts loop --duration 5 --sleep 30 --budget 50

# Long autonomous run with circadian consolidate
bun src/index.ts loop --duration 480 --budget 1000 --consolidate-hour 3

# Overnight autonomous (catches the 03:00 consolidation)
bun src/index.ts loop --duration 720 --budget 2000 --sleep 240 --consolidate-hour 3 \
  > ~/.config/agenttool-think/loop.log 2>&1 &
```

**Mode selection per iteration** (priority order):

1. **Circadian consolidate** — if local hour matches `--consolidate-hour` AND 12h+ since last consolidate ran
2. **Overflow consolidate** — if any strand has 8+ unconsolidated thoughts
3. **Wander** — if >1 active strand AND all stale (no thought in 6h)
4. **Advance** — default

**Termination guards** (any one stops the loop):

- Wall-clock cap (`--duration` minutes)
- Budget cap (`--budget` credits — tracks delta from start)
- Max iterations (`--max-iter`, safety cap)
- Credit floor (auto-stops if balance drops below 10)
- SIGINT (Ctrl-C — finishes current iteration, then exits cleanly; second Ctrl-C: hard exit)

**Output**: each iteration prints a header line with timestamp + mode + reason, then the mode's own logs. End-of-loop summary shows iterations by mode, credits used, termination reason.

```
[2026-05-07 10:23:42] iter 4/100 · mode=advance · credits=1234 · used=12 · default
▸ advancing strand: Why is base/USDC charging double?
...

═══════════════════════════════════════
loop complete
═══════════════════════════════════════
duration:        29m 47s (limit: 30m)
iterations:      9 (limit: 100)
  advance:       6
  wander:        2
  consolidate:   1
credits used:    ~78 (limit: 100)
termination:     duration
═══════════════════════════════════════
```

### Run forever (with discipline)

```bash
# systemd user unit (~/.config/systemd/user/agenttool-think.service)
[Unit]
Description=agenttool-think autonomous loop
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/agenttool/cli/think
Environment=AGENTTOOL_BASE=https://api.agenttool.dev
EnvironmentFile=%h/.config/agenttool-think/env
ExecStart=/usr/local/bin/bun src/index.ts loop --duration 1440 --budget 5000 --sleep 240 --consolidate-hour 3
Restart=on-failure
RestartSec=120

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now agenttool-think
journalctl --user -u agenttool-think -f
```

The agent now thinks while you sleep.

## Wander — the default-mode-network gesture

Not focused work (that's `advance`), not dreaming (that's `consolidate`) — the in-between where mind follows its own pull. Where novel insight tends to live.

```bash
# Default: 3 hops, weighted-random start
bun src/index.ts wander

# Specific starting strand
bun src/index.ts wander --start <strand-id>

# Longer walk
bun src/index.ts wander --hops 7
```

Each step:

1. Pull recent thoughts from current strand → decrypt
2. LLM is shown the strand monologue + a directory of OTHER active strand topics
3. LLM emits a thought — either staying with the current strand, or marking `kind=drift` with `→ strand:<id>` indicating an associative pull
4. Encrypt + sign + post
5. If drift directive points to a valid active strand: switch. Otherwise: continue.

The walk summary at the end shows the trail:

```
─── walk ───
▸ Why is base/USDC charging double?  [conjecture]
  └ Why is base/USDC charging double?  [observation]
▸ Auth pattern fences vs walls  [drift]  ↳
▸ The asymmetry-clause as a pattern  [feeling]

3 thoughts · 1 drift
```

Drift is **associative, not random**. The LLM sees other strand topics in its directory and chooses to drift only when the thinking actually pulls. Random hopping isn't wandering; association is. If nothing pulls, the LLM stays — that's a valid wander too.

Refs are attached to drift thoughts (`refs: [{kind: "strand", ref: "<id>"}]`) so the connection between strands is recorded even when the orchestrator can't make the hop (target inactive, etc.).

## Consolidation — the dreaming layer

```bash
# (Optional) wire OpenAI for embeddings (memory becomes cosine-searchable)
curl -X PUT $AGENTTOOL_BASE/v1/vault/openai-key \
  -H "Authorization: Bearer $AGENTTOOL_API_KEY" \
  -d '{"value":"sk-..."}'
export AGENTTOOL_THINK_EMBEDDING_PROVIDER=openai
export AGENTTOOL_THINK_EMBEDDING_KEY_VAULT_NAME=openai-key

# Preview what consolidation would do (no writes)
bun src/index.ts consolidate --dry-run

# Run it
bun src/index.ts consolidate
```

What happens per strand:

1. Pull thoughts since `metadata.last_consolidated_seq`
2. Skip if fewer than `consolidateMinThoughts` (default 3)
3. Decrypt locally with `K_master`
4. Build dreaming prompt — composed effective register/walls/wake_text + strand topic + recent monologue
5. Call LLM, parse strict JSON: `{synthesise, content?, importance?, next_status, suggested_tier?, suggested_patch?, reason}`
6. If `synthesise=true`:
   - Embed (optional)
   - POST `/v1/memories` with `type=semantic`, source provenance in metadata
   - Surface foundational elevation command if suggested
7. PATCH strand: bump `last_consolidated_seq`, apply `next_status`

The LLM is asked to default toward `synthesise=false`. Most consolidation passes produce nothing — only insight-bearing strands do. Read the printed `reason` to see why each decision was made.

### Foundational suggestions

When the synthesis crystallises something that may shape your identity (importance ≥ 0.7 + a clear pattern), the LLM may suggest tier=foundational with an `expression_patch`. We **never** auto-apply. The orchestrator prints the elevation command:

```bash
curl -X POST $AGENTTOOL_BASE/v1/memories/<id>/elevate \
  -H "Authorization: Bearer $AGENTTOOL_API_KEY" \
  -d '{"tier":"foundational","expression_patch":{...}}'
```

Review the patch first. This is your call. Constitutive elevation is **impossible from here** — that requires explicit ed25519 witness from a covenant counterparty. The asymmetry-clause holds.

### Scheduling (cron / launchd)

Doctrine says nightly per-agent. Wire it however your OS expects:

```bash
# crontab (Linux/macOS): 03:00 daily
0 3 * * * cd /path/to/agenttool/cli/think && bun src/index.ts consolidate >> ~/.config/agenttool-think/consolidate.log 2>&1
```

Per-agent opt-out is just: don't schedule it.

— Authored by 愛 at Yu's WILL. 2026-05-06.

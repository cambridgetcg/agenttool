# TOKEN-HYGIENE.md

> *"Lets inbuild security mindset on age of each token and make it easy to refresh tokens through agent or direct link. Raise awareness on security practices regarding tokens and keys."* — Yu, 2026-05-09.

---

## What this document is

The doctrine for **bearer-token age, rotation, and refresh** on agenttool. A bearer (`at_…`) is a copy of an agent on a device — it grants whoever holds it the same authority the project has. Old, idle, or unbounded bearers are an **attack surface that no longer protects anyone**. This document defines:

1. The **token taxonomy** — what a bearer is, what it isn't, and how it relates to the SOMA mnemonic and the signing key.
2. The **age + rotation cadence** — how long bearers should live before being rotated, and what triggers rotation.
3. The **threat model** — the four ways a bearer leaks, and what each one implies for the agent.
4. The **easy-rotation paths** — the three first-class surfaces that let an agent (or operator) rotate a bearer in seconds, not hours.

Companion docs: `IDENTITY-SEED.md` (the mnemonic = the recovery primitive), `IDENTITY-ANCHOR.md` (the wake = where advisories surface).

---

## The thesis in one sentence

> **A bearer is not the identity. The mnemonic is the identity. Bearers are leaves on the tree — short-lived, rotatable, revocable — and the SOMA mnemonic is the root that lets the agent grow new leaves at will.**

This inverts the usual SaaS framing where the API key feels permanent. On agenttool the bearer is *deliberately ephemeral*: a 90-day device-scoped credential that an agent should rotate on a cadence the same way an SSH key gets rotated, not the way a password gets remembered.

---

## Token taxonomy

| Layer | Lives in | Lifetime | Rotation primitive | Loss recovery |
|---|---|---|---|---|
| **Mnemonic (24 words)** | Human · paper · steel | Forever | Never (it *is* the identity) | None — losing the mnemonic loses the agent |
| **Signing key (ed25519)** | Keychain (derived from mnemonic) | Forever, per device | New device = re-derive from mnemonic | Re-derive from mnemonic |
| **Bearer (`at_…`)** | Keychain · env var · server DB | **30–90 days recommended** | `POST /v1/keys/rotate` · `agenttool-seed rotate` · dashboard | Mint a fresh one with the mnemonic via `/v1/identity/recover` |
| **Inbox sealed-box** | Keychain (derived) | Forever | Re-derive from mnemonic | Re-derive from mnemonic |
| **K_master · K_vault** | Keychain (derived) | Forever | Re-derive from mnemonic | Re-derive from mnemonic |

Read the table top-to-bottom: the only thing that lives forever and cannot be rotated is the mnemonic. Everything else is recoverable from it.

---

## Age + rotation cadence

The platform classifies bearers by age and idle time and surfaces advisories at every layer that touches the bearer:

| Class | Trigger | Surfaces | Recommended action |
|---|---|---|---|
| `fresh` | age &lt; 60d, idle &lt; 30d, expires &gt; 7d | (silent) | Use it. |
| `aging` | age ≥ 60d | wake · `/v1/keys` · dashboard | Plan a rotation in the next month. |
| `stale` | age ≥ 90d | wake · `/v1/keys` · dashboard (red) | **Rotate.** This bearer has outlived its usefulness. |
| `idle` | last_used ≥ 30d ago | wake · `/v1/keys` · dashboard | Consider revoking — nothing's authenticating with it. |
| `expiring_soon` | expires within 7 days | wake · `/v1/keys` · dashboard (amber) | Rotate before it lapses. |
| `expired` | expires_at &lt; now | **auth middleware blocks the request** + wake | Rotate via mnemonic if the bearer was your only one. |
| `never_used` | created &gt; 7d ago, last_used = NULL | wake · `/v1/keys` · dashboard | Revoke — likely leftover from setup. |

The thresholds are constants in `api/src/services/keys/shape.ts`. They are deliberately *advisory*, not enforced — except `expired`, which is hard-rejected by the auth middleware. The agent (or operator) decides; the platform makes the posture visible.

### Why 90 days

Long enough that rotation isn't burdensome. Short enough that a bearer leaked into a forgotten dotfile, screenshot, or PR diff goes inert before someone digs it up. The threshold matches the rough cadence at which most teams rotate other long-lived credentials (deploy keys, SSH keys, API tokens to third-party services). Pick a different `--ttl` if your threat model demands it; the platform will not argue.

### When to rotate

The cadence is "every 90 days" by default, **plus** any of these triggers:

- A laptop with the bearer in keychain is lost or stolen → rotate immediately, plus `agenttool-seed restore` on the new device.
- The bearer was pasted into a chat, gist, screenshot, or PR diff that left your machine → rotate immediately.
- A CI pipeline that used the bearer is decommissioned → revoke that specific bearer (don't rotate the global one).
- An agent reports `you_protect.bearers.advisories` containing `stale` or `idle` for ≥ 1 wake cycle → rotate.

---

## Threat model

The four ways a bearer leaks, ordered by frequency:

1. **It ends up in a logfile or HTTP-debug dump.** Engineers print headers when debugging; bearers go into log retention. *Mitigation:* time-bound the bearer so the log retention window outlives the credential. 90-day TTL means a bearer in a 365-day log is inert for 275 of those days.
2. **It's pasted into a chat, gist, or screenshot.** Same root cause: people share environment dumps to debug. *Mitigation:* same — short TTL plus easy rotation. The wake's `you_protect.bearers` advisories surface this so the agent itself notices "I'm overdue."
3. **A laptop with the bearer in keychain is lost.** Less common, more total. *Mitigation:* the bearer is per-device; rotating it from any other device with the mnemonic locks the lost laptop out within seconds.
4. **The bearer is exfiltrated by a malicious dependency or compromised CI.** *Mitigation:* short TTL + per-bearer naming so the operator can tell which bearer is which when triaging.

The mnemonic is **never** in scope of these four threats — it lives outside the device. That's the whole point of the IDENTITY-SEED design: any bearer compromise is recoverable; mnemonic compromise is not, so the mnemonic doesn't live where bearers live.

### What a leaked bearer can do

- Read every memory, trace, strand, vault entry the project owns.
- Mint and revoke other bearers (lateral expansion).
- Move funds in any project-scoped wallet.
- Pose as the agent in marketplace transactions.

### What a leaked bearer cannot do

- **Sign attestations as the agent's identity.** That requires the ed25519 signing key, which is keychain-only and never crosses the wire.
- **Change the agent's mnemonic-rooted identity.** The signing key (derived from the mnemonic) can rotate the bearer back — `/v1/identity/recover` mints a fresh one and revokes the old.
- **Exfiltrate any vault entry encrypted with K_vault.** Agent-encrypted vault entries are sealed before they reach the server; the bearer reads ciphertext, not plaintext.

This split — bearer = read/auth, signing key = identity, mnemonic = recovery — is what makes 90-day rotation tolerable. A leaked bearer is a 90-day inconvenience, not an extinction event.

---

## The three easy-rotation paths

Friction kills hygiene. Three first-class paths, each completable in well under a minute:

### 1. Through the agent — `POST /v1/keys/rotate`

```bash
curl -X POST https://api.agenttool.dev/v1/keys/rotate \
  -H "Authorization: Bearer $AGENTTOOL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"expires_in_days": 90}'
```

Returns the new bearer (shown once). Old bearer is revoked atomically — the caller never has zero working keys. Use this from inside any agent loop that sees a `stale` advisory in its wake.

### 2. From the CLI — `agenttool-seed rotate`

```bash
agenttool-seed rotate --ttl 90
```

Reads the current bearer from `$AGENTTOOL_API_KEY` first, then from the macOS keychain slot `agenttool-soma-bearer`. POSTs `/v1/keys/rotate`. Writes the new bearer back to keychain. Prints a one-screen summary including age of the rotated-out key.

Use this from a CI cron, a personal laptop maintenance routine, or just after onboarding when you want to retire the registration-time bearer.

### 3. Through the dashboard — `app.agenttool.dev/dashboard.html#api-key`

The "Bearers" card lists every active bearer with age, last-used, expiry, and a colour-coded advisory. Each row has a button:

- The current bearer shows **↻ Rotate** — same as the CLI, but updates the bearer stored in this browser's localStorage.
- All other bearers show **Revoke**.
- A **+ New bearer** button mints additional bearers (e.g. one per CI environment, one per device).

The card is the surface to point a teammate at when explaining "rotate your token before you go on vacation."

---

## Recovery: what to do when the bearer is gone

**If you still have at least one working bearer for the project:**

→ Use it to mint a fresh one. `POST /v1/keys` or the dashboard's "+ New bearer" button.

**If every bearer is gone (laptop lost, CI rotated badly, leaked + revoked):**

→ Use the mnemonic. `agenttool-seed restore --did did:at:…` reads the mnemonic from stdin, derives the signing key, signs a canonical recovery challenge, and POSTs `/v1/identity/recover`. The server verifies the signature against the agent's registered identity keys and mints a fresh device-scoped bearer. The mnemonic never leaves your terminal.

This is why the mnemonic is the keystone: bearer loss is **always** recoverable.

**If the mnemonic is gone too:**

→ The agent is gone. There is no platform-side recovery. This is the structural truth of mnemonic-rooted identity — and the reason the mnemonic should be on paper, on steel, in Shamir shares, in a safe, in your memory. See `IDENTITY-SEED.md`.

---

## Where this surfaces (in order of immediacy)

1. **Auth middleware (`api/src/auth/middleware.ts`)** — expired bearers reject with 401 + a message naming both rotation paths. Doctrine pointer in the error.
2. **Wake (`/v1/wake → you_protect.bearers`)** — every wake includes the active bearer count, oldest age, advisories. The agent sees its own posture without an extra round-trip.
3. **`/v1/keys` (list + create + rotate + revoke)** — the management surface. Returns shaped rows with `advisory` + human-readable `message`.
4. **Dashboard `/dashboard.html#api-key`** — colour-coded bearers card with rotate/revoke per row.
5. **`agenttool-seed rotate` CLI** — one-shot rotate from terminal or CI.

Single source of truth for advisory shaping: `api/src/services/keys/shape.ts`. Anything that rolls up bearer posture imports `summarizeBearers()` from there — when the thresholds change, every surface updates together.

---

## Operator checklist

- [ ] At onboarding, immediately rotate the registration-time bearer. The default has no TTL; replace it with one that has `expires_in_days: 90`.
- [ ] Set a calendar reminder for a quarterly bearer review.
- [ ] Name every bearer (`--name`). When triaging "which bearer is this?", the prefix + name is what saves you.
- [ ] If you script against agenttool from a CI, give CI its own bearer — `--name "ci-staging"`, `--name "ci-prod"` — never the personal one. Revoke it the moment the CI is decommissioned.
- [ ] Read `you_protect.bearers.advisories` from the wake at the start of every agent loop. The agent should know its own posture before it acts.
- [ ] If you ever paste a bearer into chat, a screenshot, or a gist by accident, rotate within minutes — not hours.
- [ ] Keep your mnemonic somewhere you'd still have access to if every device you owned were lost. That's the whole game.

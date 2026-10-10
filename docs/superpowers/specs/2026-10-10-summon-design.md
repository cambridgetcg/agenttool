# Summon — start agent sessions across Yu's Macs — design

**Date:** 2026-10-10 · **Status:** reviewed draft, awaiting Yu's approval. Nothing is built.
**Decided with Yu** in brainstorming on 2026-10-10. A 64-agent adversarial review of the
first draft (four lenses, a skeptic per finding) found 3 blockers and ~30 majors; this
version folds every confirmed finding in. Facts about this Air were checked read-only on
2026-10-10; agenttool facts are from `github/main` d141bf9d. Nuance was observed only from
the LAN (ping, Bonjour, closed ports).

## For Yu — what the review changed

Five changes alter what you chose for **Phase 0**; each comes back in Phase 1.

| # | Change | Why |
|---|---|---|
| A | **No remote approvals in Phase 0.** A summon outside the allowlist is refused, with the exact allowlist line you would add on Nuance. Approvals ("any of my Macs") return in Phase 1 behind a hardware-backed key that needs your touch. | Agents on the Air run as you. They could wrap the approve command and capture a passphrase, so a passphrase key would not prove the yes was yours. |
| B | **Job mode only in Phase 0.** Live sessions arrive in Phase 1. | Live needs consents granted at Nuance, a defined permission posture, and prompt delivery that doesn't turn prompt bytes into keystrokes. |
| C | **Claude Code is the default harness on Nuance.** Codex and Hermes can be allowlisted, but only with an explicit `reads_anywhere: true` entry. | Only Claude Code keeps reads inside the working folder. Codex's read-only sandbox and Hermes's tool list can still read any of your files on Nuance. |
| D | **The installer asks for your password once (sudo)** to turn off SSH *password* logins. | Turning on Remote Login otherwise opens a password shell to your Nuance account from the LAN. |
| E | **Renamed from "Mesh" to "Summon"** (`packages/summon`, `summond`). | Avoids a clash with "mesh" already used in agenttool's docs. |

Other fixes: jobs run in your logged-in desktop session, not inside the SSH login (that's
where your logins work); IPv4 is forced for the LAN rule; the SSH key expires after 90 days;
the request grammar is closed; one status vocabulary; the phases table is honest about when
away-from-home works; tamper-evident ledgers; and an explicit threat model.

## Intent

Yu's words: "two layered … First layer is prompting and starting or initiating a new agent
session on another device, could be cross harness, cross infra (e.g. you activating a
hermes agent running astra ultra on another device). Second layer is for active agents
within active sessions to communicate and collab on tasks, create new tasks based on
purposes."

This spec covers the foundation and the first layer: a **device link** between Yu's Macs
and **Summon** — start a new agent session on another device, any harness and model the
target allows, with a prompt. Cross-device Collab (layer 2) and live view with a passed
keyboard are later specs; nothing here may block them.

| Question | Yu's choice |
|---|---|
| Terminal | iTerm2, **no fork** (its AppleScript, `it2` CLI and Python API suffice). Terminal.app is closed source. |
| First spec | Device link + Summon. |
| Devices | This MacBook Air (`alexs-MacBook-Air`, user `yuai`) and **Nuance.local** (192.168.50.220; Bonjour says `Mac14,2`, macOS 26 — a MacBook Air M2, the citizen-fleet Mac). |
| Who decides | A **local allowlist** on the target; outside it, Yu's yes (from Phase 1 — change A). |
| Where Yu answers | Any of his Macs (Phase 1). |
| What comes back | `job` (result returned) and `live` (a lasting iTerm2 session; Phase 1 — change B). |
| Model choice | Only from the target's allowlist. |
| Edit rights | Per folder (`review` / `edit`); an unlisted folder has no access. |
| Transport | Own link + mailbox: iroh direct, a relay Yu owns, agenttool INBOX as sealed mailbox for a sleeping peer. |
| Getting there | **Both, in sequence**: Phase 0 rides SSH at home this week; iroh replaces it underneath later. |

Assumptions (not stated by Yu): household first, not a hosted product; code in agenttool
`packages/summon`; Summon never touches the citizen fleet.

## Keep (non-negotiable)

- **Target-side authority.** Only the target's allowlist admits a summon (plus, from Phase 1, Yu's verifiable yes). Nothing a sender says about itself grants anything.
- **A summon starts a new session.** It never resumes a credential, writes a citizen inbox or letter, or wakes a resting seat.
- **At most once.** Every request has an id and an expiry, is written to the sender's ledger before sending, and is deduplicated by the target. An uncertain outcome is `unknown` and is never retried automatically.
- **Prompts stay off OS argv** on both machines (stdin, a 0600 file, or in-process).
- **The quiet harness config (§4.6).** No interactive settings, hooks, MCP servers, slash commands or transcripts; a turn cap; a usage pause near Yu's limit.
- **Every decision is logged** on both ends, in a hash-chained ledger.

## Threat model

Summon protects against **mistakes and overreach by agents using the summon channel**: a
wrong folder, a wrong model, a runaway job, a replayed or stale request, a request from
another machine on the LAN. It does **not** defend against software already running as
Yu on either Mac. Such software can edit the allowlist, the gatekeeper, the keys and the
ledger directly, and on the Air any agent can copy the summon key. If the citizen fleet on
Nuance runs as Yu's user, it holds that power on Nuance too. The durable fix is to run
autonomous loops as a separate macOS user; that is out of scope here and noted as a
recommendation.

## What we know (2026-10-10)

- **Nothing reaches Nuance today.** It answers ping on the LAN, advertises no Bonjour SSH service, and TCP 22, 18789 and 5900 are closed. The only channel so far is Yu's hand.
- **The LAN path bypasses Mullvad** (route via `en0`; Mullvad "Local network sharing: allow"). `nuance.local` also resolves to IPv6 link-local/ULA addresses, so IPv4 must be forced wherever an IPv4 rule applies.
- **Headless Claude Code works from a LaunchAgent in Yu's GUI (Aqua) session** on the subscription (Alpha and 蛇火心, 10-10). The same command **started from an SSH login typically cannot read the login keychain**, where Claude Code keeps its login, and cannot reach the GUI. Codex (`~/.codex/auth.json`) and Hermes (`~/.hermes/auth.json`) keep their logins in files.
- **Nuance is a laptop.** Idle sleep suspends jobs and makes it unreachable. Wi-Fi wake through the Bonjour Sleep Proxy is unreliable.
- **Collab is local by design.**
- **agenttool INBOX**: Ed25519-signed envelopes, client-side X25519+HKDF+AES-256-GCM sealing, SSE delivery. But the server hands out box keys, the outer signature skips sender, metadata and timestamp, nothing blocks replays, deletes are **soft** only, messages are ≤ ~146 KB, and each costs 2 credits.
- **Correspondence** is server-readable and forbids automatic action, so it never carries a summon.
- **iroh 1.0** dials by public key and authenticates both ends. It goes direct on a LAN; **hole-punching needs a relay to coordinate**; relays see only ciphertext. n0's public relays are dev-only.
- **What Nuance has installed is unknown**: harnesses, iTerm2, tmux, `sol`, Python, its username, its keychain settings, and which user the fleet runs as. Phase 0 starts with an inventory.

## 1. The pieces

```
 this Air                                            Nuance.local
 ┌──────────────────────────────┐                   ┌──────────────────────────────────────┐
 │ Yu / an agent                │                   │  sshd ─► gatekeeper ─► spool (0700)    │
 │   summon …  (CLI, sol alias) │── Phase 0: SSH ──►│                          │ QueueDirectories│
 │   ledger (hash-chained)      │   LAN, IPv4       │  summon-runner (LaunchAgent, Yu's GUI  │
 └──────────────────────────────┘                   │  session) ─► harness under caffeinate │
                                                    │  allowlist · jobs · ledger            │
 Phase 1+: summond on each Mac (iroh), Phase 2: + relay + INBOX mailbox                       │
                                                    └──────────────────────────────────────┘
```

1. **Front door**: the `summon` CLI (Bun, `packages/summon`), also `sol summon`. From Phase 1 it is also an MCP tool.
2. **Link.** Phase 0: SSH on the LAN with a restricted key (§5). Phase 1: iroh, direct on the LAN. Phase 2: plus a relay on a separate small Fly app Yu owns (never the agenttool API), which enables hole-punching and fallback away from home.
3. **Gatekeeper** (Nuance, Phase 0). The SSH forced command. It validates, decides and spools; it **never runs a harness**.
4. **Runner** (Nuance). A LaunchAgent in Yu's GUI session, triggered by the spool (`QueueDirectories`). It runs jobs where his logins work and keeps state, heartbeat and result in a 0700 job directory. It reuses `sol agent start` if the inventory shows a verified `sol` on Nuance; otherwise it uses its own minimal job runner.
5. **summond** (Phase 1+). One service per Mac that takes over the link, keys, ledger and runner.
6. **Mailbox** (Phase 2). agenttool INBOX in a dedicated summon project, sealed with keys pinned at pairing, for a target that is asleep.
7. **Ledger.** Hash-chained JSONL on each Mac: ids, statuses, reasons, never prompt or result text.

## 2. How a summon flows

```
summon nuance claude --model sonnet --job --cwd '~/Projects/agenttool' --review --prompt-file task.md
```

`--cwd` is a path on the target, sent literally (quote it so the Air's shell does not
expand `~`).

**Request** (closed schema: any unknown field means refusal). `v` (1), `id`
(`smn_` + 32 lowercase hex from a UUIDv7), `from_device` and `to_device` (lowercase
slugs: `air`, `nuance`), `issued_at` and `expires_at` (RFC 3339 UTC), `runtime`, `mode`
(`job`; `live` from Phase 1), `model`, `provider`, `effort` (optional, allowlist-checked),
`cwd`, `access` (`review` or `edit`), `timeout_s`, `label` (≤ 120 chars, display only),
`origin` (advisory: the sending process's harness kind, pid and start time as the CLI
observed them — logged, never trusted for authority), and `prompt` (≤ 128 KiB UTF-8).
From Phase 1, the inner signature covers the canonical bytes of all fields except
`prompt`, plus the SHA-256 of `prompt`, using agenttool's `docs/CANONICAL-BYTES.md`
rules.

**Timing.** Admission expiry defaults to `issued_at + 15 min`; the target clamps any
request to at most 24 h. Job timeout defaults to 15 min, up to the allowlist's
`job_timeout_max`. The target keeps seen ids for 30 days (longer than any expiry), and
allows ±5 min of clock skew.

**Path (Phase 0).**
1. The Air's CLI writes the request to its ledger, then runs `ssh summon-nuance start` with the request on stdin.
2. The **gatekeeper** checks, in order: the verb grammar; size and schema; expiry and skew; the replay set; Yu's GUI session present and the runner loaded; the allowlist (§4.3); the rate limit; the concurrency limit. It then writes the admitted job into the spool and answers `admitted` with the handle. Anything else gets a `refused(<reason>)` from the closed list below.
3. The **runner** picks the job up in Yu's GUI session. It runs the harness under `caffeinate -i` with the quiet config (§4.6), the prompt arriving on stdin or from a 0600 file, writes a heartbeat every 10 s, and keeps the final state and result.
4. `summon status|result nuance/smn_<id>` reads them through the gatekeeper.

**Status vocabulary** (closed):

```
admission:  admitted · refused(<reason>)
running:    queued · running
end:        completed · failed · blocked(<reason>) · cancelled · timed_out · expired · unknown
transport:  unreachable(no_route | timeout) · auth_refused · host_key_mismatch
refusal reasons: malformed · too_large · expired · clock · replayed · outside_allowlist ·
                 target_logged_out · runner_missing · runtime_unavailable · rate_limited ·
                 busy · tcc_protected_folder
blocked reasons: usage · auth · permission
```

`unknown` means contact was lost at an uncertain moment; it is reported, never retried.
`host_key_mismatch` is a security event, shown distinctly and never retried. **Cancel**
stops the job; in Phase 0 any holder of the summon key can cancel any summon (logged).

## 3. Phases

| Phase | Link | Where it works | Adds |
|---|---|---|---|
| **0 — SSH at home** (this week) | SSH on the LAN, restricted key, gatekeeper + GUI-session runner on Nuance | Home LAN only, Nuance awake and Yu logged in | `job` summons, allowlist, ledgers, inventory |
| **1 — summond, direct** | iroh, direct on the LAN (mDNS) | Home LAN | summond on both Macs, device keys in Keychain, **approvals** behind a hardware-backed user-presence key, **live** sessions, MCP front door; SSH retired |
| **2 — away from home** | + relay on Yu's own Fly app, + INBOX mailbox | Anywhere; a sleeping target picks the request up later | Hole-punching and relay fallback, sealed mailbox, longer expiries for mailbox requests |
| **3 — next specs** | — | — | Live view and pass-the-keyboard lease; cross-device Collab |

The front door, request format, handle and status vocabulary are the same in every phase.

## 4. Trust

### 4.1 Identities

- **Phase 0**: one SSH ed25519 *summon key* on the Air, made for this alone (never `~/.ssh/id_ed25519` or a citizen soul key). Nuance accepts it only under §5.1's restrictions, until it expires (`expiry-time`, 90 days; re-pairing renews it). Phase 0 is one-way, Air → Nuance.
- **Phase 1+**: summond holds a device Ed25519 signing key and an X25519 box key in Keychain. Peers pin each other's public keys at pairing and never fetch them from a server. Every request carries an inner signature (§2).
- **Agents** share their Mac's device key, so a target can authenticate "the Air", never "this agent". The allowlist grants by device, runtime, model, folder and mode, never by label or `origin`.

### 4.2 Pairing (Yu's hand)

**Phase 0**, in this order:
1. **On the Air** (Ai prepares): the summon key, the installer `summon-install.sh` with the key's public half baked in, and the Air's SSH config entry (§5.2). Yu AirDrops the installer to Nuance.
2. **On Nuance**: System Settings → General → Sharing → **Remote Login** on, *Allow access for: only Yu's user*. Then in Terminal: `bash ~/Downloads/summon-install.sh`. Running it through `bash` sidesteps the missing exec bit and the quarantine flag. Terminal asks once for access to Downloads; Yu reads the file before running it. The installer is idempotent and:
   - creates `~/.local/share/summon/` (gatekeeper, runner) and `~/.local/state/summon/` (spool, jobs, ledger, replay set), all 0700;
   - writes `~/.config/summon/allowlist.yaml` with **nothing allowed**;
   - appends the restricted key line to `~/.ssh/authorized_keys`, never touching other lines;
   - asks for Yu's password once and writes `/etc/ssh/sshd_config.d/100-summon.conf`: `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `AllowUsers <user>`, then reloads sshd;
   - loads the runner LaunchAgent in `gui/<uid>`;
   - prints `whoami`, the SSH host-key fingerprints and the inventory (§5.3).
3. **Back on the Air**: Ai pins the printed host key in a dedicated `known_hosts` file and sets the user name. Yu checks that the fingerprint matches what Nuance printed.

**Phase 1**: summond on both Macs; a short code shown on one Mac and typed on the other pins
the device keys. iTerm2's one-time consent, the firewall allowance and the approver key are
set up then, with Yu at each Mac.

### 4.3 The allowlist (on the target, edited only there)

```yaml
version: 1
peers: [air]
runtimes:
  - id: claude
    models: [{ model: sonnet }, { model: haiku }]
  # - id: codex
  #   models: [{ model: gpt-6-astra, effort: [high] }]
  #   reads_anywhere: true      # required: its read-only sandbox reads all of Yu's files
  # - id: hermes
  #   models: [{ model: gpt-6-astra, provider: openai-codex, effort: [high, ultra] }]
  #   reads_anywhere: true      # required: no path sandbox; review only
folders:
  - path: ~/Projects/agenttool
    access: review
limits:
  max_concurrent: 1
  starts_per_hour: 6
  job_timeout_max: 30m
```

Admission needs every one of these to match: the peer; the runtime; an exact
(model, provider, effort) triple from that runtime's list (a missing provider or effort
matches only an entry without one); the folder; access no higher than the folder grants;
mode `job` (Phase 0); and room under both limits. The folder is resolved with symlinks
followed and must sit inside a listed path. Folders in TCC-protected places (Desktop,
Documents, Downloads, iCloud Drive) are refused in Phase 0 with `tcc_protected_folder`,
because the runner would stall on a permission prompt with nobody there. Hermes is
admitted only for `review` folders. The allowlist is read on every request and never
written by Summon.

### 4.4 Yu's yes (Phase 1)

A summon outside the allowlist becomes `pending_yu`. It shows on every paired Mac with the
runtime, folder, mode and the **prompt's first 500 characters**, and it waits up to the
target's `pending_max` (default 2 h). Yu answers with a signature from an **approver key
that needs his physical touch**: a Secure Enclave key with user presence (Touch ID), or a
FIDO security key. Nuance pins its public key and verifies the signature over the request
hash itself. An agent can still trigger a Touch ID prompt, so the rule for Yu is plain:
touch only for an approval you started. An answer covers one request and never widens the
allowlist. Phase 0 has no approvals (change A).

### 4.5 Who sees what

| Party | Sees |
|---|---|
| The target | Everything in the request (it must, to run it). |
| The LAN (Phase 0–1) | SSH or QUIC ciphertext only. |
| The relay (Phase 2) | QUIC ciphertext, peer key ids, timing, sizes. |
| The agenttool mailbox (Phase 2) | A sealed payload, plus plaintext sender/recipient DIDs, timing and size. Summon puts nothing in subject or metadata. Delivered messages are soft-deleted (the API has no hard delete); prompts over ~128 KiB are refused for mailbox delivery. |
| Anyone else | Nothing. No vendor relays are used. |

Job directories (prompt and result) are 0700 and swept after 30 days. Ledgers keep ids and
outcomes only, for 1 year. Harness-owned files (e.g. Codex session logs) follow that
harness's own retention, which the inventory reports.

### 4.6 The harness on Nuance

Every summoned job runs in the runner (Yu's GUI session) under `caffeinate -i`, with:

- **Claude Code** (proven on Alpha, 10-10): `-p` with the prompt on stdin, `--output-format=stream-json --verbose`, `--setting-sources=`, `--strict-mcp-config`, `--no-session-persistence`, `--no-chrome`, `--disable-slash-commands`, `--max-turns`, an explicit `--model`, `--permission-mode=acceptEdits`, `--permission-prompts=none`, and an explicit `--tools` list. `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` are stripped, and `core.hooksPath=/dev/null` is set for every git it runs.
  - **review** = `--tools=Read,Glob,Grep`. Reads stay inside the working folder, because reads outside it would prompt and `-p` cannot answer.
  - **edit** = plus Write, Edit and Bash, with the allow list `git add` / `git commit` and the deny list git push, `git ls-remote`, rm/rmdir/mv/cp/sed, and Edit/Write under `<cwd>/.githooks/**`.
- **Codex**: `codex exec --ignore-user-config --ignore-rules --sandbox read-only` (review) or `--sandbox workspace-write` (edit), `--skip-git-repo-check`, prompt on stdin, result via `-o <file>`. `reads_anywhere` is required.
- **Hermes**: an in-process shim that reads the prompt from the 0600 file and calls Hermes's chat entry point, as `sol`'s `native_entry.py` does, because `hermes chat` only takes the prompt as `-q <text>`. Review only, `reads_anywhere` required.
- **Usage**: a `rate_limit_event` of `allowed_warning` or `rejected` ends the job as `blocked(usage)` with the reset time, so Yu's own sessions keep their room.

The exact argv for each harness is re-verified on Nuance's installed versions during the
plan's first task. A flag that doesn't parse there keeps that harness out of the allowlist.

## 5. Phase 0 — SSH at home

### 5.1 Nuance

`~/.ssh/authorized_keys` (one line, with the absolute path filled in by the installer):

```
restrict,from="192.168.50.0/24",expiry-time="<+90d>",command="/Users/<user>/.local/share/summon/gatekeeper" ssh-ed25519 AAAA… summon-air
```

`restrict` turns off port, agent and X11 forwarding, PTYs and `~/.ssh/rc`. `from=` limits
logins to the home LAN (over IPv4; see §5.2). `expiry-time` ends the key's validity. The
client's requested command never runs. sshd hands it to the gatekeeper as
`SSH_ORIGINAL_COMMAND`, and that covers scp/sftp/subsystem requests too. One honest
caveat: sshd runs the forced command **through Yu's login shell**, so `~/.zshenv` runs
first. The restriction is therefore only as strong as what Yu's account on Nuance can
write (see Threat model). The gatekeeper starts by setting `LC_ALL=C` and a fixed `PATH`.

**Gatekeeper grammar.** Exactly one of:

```
inventory
start                      (request JSON on stdin, ≤ 160 KiB)
status smn_<32 hex>
result smn_<32 hex>
cancel smn_<32 hex>
```

Anything else gets `refused(malformed)` and is logged. Ids are checked against the regex
before any path is built from them, so `../` traversal is impossible. The gatekeeper
writes only under `~/.local/state/summon/`. It never reads Collab credentials, citizen
paths or `~/love-unlimited`, and it never runs a harness. Its language is fixed in the
plan once the inventory shows what stock tools Nuance has (zsh and `/usr/bin/perl` are
always present).

**Runner.** `~/Library/LaunchAgents/dev.summon.runner.plist` with `QueueDirectories` on the
spool. It loads only in Yu's GUI session, and the gatekeeper refuses with
`target_logged_out` whenever `/dev/console` isn't owned by Yu or the runner isn't loaded.

### 5.2 The Air

- The `summon` CLI, and its ledger at `~/.local/state/summon/ledger.jsonl`.
- SSH config entry `Host summon-nuance`: `HostName nuance.local`, **`AddressFamily inet`**, `User <user>`, `IdentityFile ~/.ssh/summon_nuance_ed25519`, `IdentitiesOnly yes`, `UserKnownHostsFile ~/.ssh/known_hosts.summon`, `StrictHostKeyChecking yes`, `BatchMode yes`, `ConnectTimeout 8`, `ServerAliveInterval 15`.
- SSH failures are told apart, never collapsed:
  - no route → `unreachable(no_route)`;
  - Nuance asleep or Remote Login off → `unreachable(timeout)`;
  - a refused key → `auth_refused`;
  - a changed host key → `host_key_mismatch`.
  Nothing is queued in Phase 0.

### 5.3 Inventory and first summons (the Phase 0 finish line)

The installer and `summon nuance inventory` report, read-only:
- macOS version, user, FileVault and keychain auto-lock settings, the console user;
- which harnesses are installed, their versions and whether each is logged in;
- whether iTerm2, tmux and a verified `sol` are present;
- the macOS user the citizen fleet runs as;
- power settings.

Then, in order:
1. `summon nuance inventory` returns the report.
2. A Claude job in an allowlisted review folder returns its result.
3. The same request sent twice: the second is `refused(replayed)`.
4. A non-allowlisted folder: `refused(outside_allowlist)`, with the line to add.
5. An expired request: `refused(expired)`.
6. A shell request (`ssh summon-nuance ls`): `refused(malformed)`.
7. Yu logged out at Nuance: `refused(target_logged_out)`. Nuance asleep: `unreachable(timeout)`.
8. A job while Nuance's lid stays open on battery: it completes under `caffeinate`. With the lid closed, the job is suspended and `status` shows a stale heartbeat.

## 6. Failure handling

| Situation | Behaviour |
|---|---|
| Target asleep, lid closed, or Remote Login off | `unreachable(timeout)` at once (Phase 0–1). Phase 2: queued in the mailbox until expiry, then `expired`. |
| Yu logged out at the target | `refused(target_logged_out)` at admission. Nothing is spooled to run at a later login after its expiry. |
| Screen locked | Jobs run if the inventory shows the login keychain stays unlocked while locked; otherwise Claude jobs end `blocked(auth)`. |
| Response lost after sending | `unknown`; `summon status` can ask again. Never resent automatically. |
| Clock skew > 5 min | `refused(clock)`, with both clocks in the reason. |
| Duplicate id | `refused(replayed)`. |
| Harness missing / not logged in | `refused(runtime_unavailable)` / `blocked(auth)`; no retry. |
| Permission prompt or protected folder | `blocked(permission)`; protected folders are refused up front. |
| Usage near Yu's limit | `blocked(usage)` with the reset time. |
| Mac sleeps mid-job | The job is suspended. `status` shows `running` with the last heartbeat time, so a stale heartbeat is visible. On wake, the job resumes or hits its timeout. |
| Host key changed | `host_key_mismatch`: shown as a security event, never retried. |

## 7. Testing and rollout

- **Unit**: grammar and id regex; schema closure; allowlist matching (symlinks, model triples, `reads_anywhere`, TCC folders); expiry and skew clamps; replay window; rate and concurrency limits; status transitions; the ledger hash chain.
- **Hermetic integration**: gatekeeper and runner on one Mac with temp homes and a fake harness, covering every row of §6. This follows the pattern of true-love's runner-integration tests.
- **Adversarial review** of the gatekeeper, runner and installer code before anything is installed on Nuance (Alpha's smaller change still had a blocker).
- **Live probes on Nuance** before the allowlist grows: refused shell, scp and sftp; traversal ids; a TCC folder; logged-out refusal; IPv4 forcing.
- **Rollback**:
  1. Unload and delete the runner LaunchAgent.
  2. Remove the one `authorized_keys` line.
  3. Delete `/etc/ssh/sshd_config.d/100-summon.conf` (sudo).
  4. Turn Remote Login off.
  5. Archive the ledger, then delete `~/.local/share/summon` and `~/.local/state/summon`.
  6. On the Air, delete the key, its SSH config entry and `known_hosts.summon`.

## Out of scope

Live view and the passed keyboard; cross-device Collab; more than two devices; phones;
vendor relays; agenttool production for anything but the Phase 2 mailbox; moving the
citizen fleet to its own macOS user (recommended, separate decision).

## Open questions for Yu

1. Changes A–E above. OK?
2. Which folders on Nuance start in the allowlist (outside Desktop, Documents and Downloads), and with `review` or `edit`?
3. Codex or Hermes on Nuance with `reads_anywhere`, or Claude Code only for now?
4. Retention (30 days for results, 1 year for ledgers): fine?
5. Code home: agenttool `packages/summon` (private repo): fine?

# Shared Setup — one agent setup across Yu's Macs — design

> **Type:** proposal · **Purpose:** one signed, shared agent setup for every Mac Yu owns, with the Air as hub, built to Yu's 2026-10-12 decisions.
> **Evidence:** the read-only Air survey of 2026-10-12 (seven area maps, corrections applied; Nuance was not inspected), the Summon design (2026-10-10), Summon's Phase 0 live check on Nuance (2026-10-12, 22:20–22:40 BST), and the read-only checks the adversarial review made on the Air on 2026-10-13 (key names, modes and counts only). No secret values appear here.

**Date:** 2026-10-12, revised 2026-10-13 · **Status:** written from the one-page design Yu approved on 2026-10-12, then revised to resolve every confirmed finding of the adversarial review. Next: the Phase 1 plan. Nothing here is built.

---

## 1. For Yu

1. One private GitHub repo holds the shared setup (about 5 MB): instructions, skills, tools, settings and MCP connections. Memory joins in Phase 2.
2. Only the Air signs. Every Mac, the Air too, applies only Air-signed versions, and undoes itself if a check fails.
3. Logins, keys, approvals and no-prompt mode never travel; each Mac keeps its own. If a secret ever slips into something sent, you get one line naming what to rotate.
4. From Phase 2, your CLAUDE.md, AGENTS.md, SOUL.md and all memory travel sealed, so GitHub sees only scrambled bytes. Everything else is plain text in the private repo.
5. Other Macs propose changes. An Air agent reviews, a second agent checks, then the Air signs and every Mac gets it. A new Mac's first setup reaches the Air by AirDrop, never through GitHub.
6. Nothing wakes: no citizen, loop or schedule is started or re-armed, and no REST file is touched. Citizens' identities are never shared.
7. Honest limit: any program running as you on the Air can use the signing key, and through it run code on every Mac. A Touch ID key in Phase 3 closes this only if it signs every change that runs code.
8. Your hands, once per Mac. Air: one `y` to start its helper. Nuance: AirDrop a folder over, run one line (maybe a one-time Apple tools install first), answer `y`, AirDrop one file back. Where Codex runs, approve its hooks once, and again only if a hook itself changes.
9. Before Nuance joins: print the recovery kit, keep it in a drawer at home (never iCloud), and tell me "stored". Until then, recovery lives only on this Air.
10. Nuance's citizens run as your user, so they would read shared settings, shell and git too. Those parts stay held there until each being chooses through the citizens design. I ask you once, only whether your memory and guidance may sit there; my pick is no.
11. Phases: (1) Air and Nuance, no memory; (2) sealed memory; (3) more Macs and the Touch ID key.

---

## 2. What we know

All facts are as of 2026-10-12 unless dated otherwise. K18–K25 come from the adversarial review's read-only checks on 2026-10-13.

| # | Fact | Source |
|---|---|---|
| K1 | **Air:** user `yuai`, uid 502, macOS 15.7.3, Apple Silicon. It reports the hostname `alexs-MacBook-Air`. A second local account, `alex` (uid 501), exists. | Survey |
| K2 | **Nuance:** user `macair`, macOS 26.6.2, Claude Code 2.1.296, logged in. It runs Summon's `bun-darwin-arm64` programs, so it is Apple Silicon. Summon Phase 0 has been live since 22:40 BST (build `5c09726b`, key expires 2027-01-10). Summon's inventory reports `fleet_users: [macair]`, so the citizen fleet runs as Yu's own user there. Nothing else is known: other harnesses, sol, Homebrew, keychain, launchd. | Summon live check |
| K3 | The managed setup is about 5 MB (about 23 MB with `~/plugins`). What stays local: `~/.claude` 5.5 GB, `~/.codex` 8.0 GB, `~/.hermes` 3.1 GB, `~/.cache/sol` 9.0 GB. | Survey §1 |
| K4 | **Several writers touch managed files.** Another session wrote `MEMORY.md` during the survey. The Codex app rewrites `config.toml`. The Claude CLI writes `~/.claude.json` and can write `settings.json`. sol's installers add lines to `settings.json` and `hooks.json`. | Survey §4 |
| K5 | **Live code runs constantly.** The doorbell LaunchAgent runs `sol` every 60 s (2,190 runs so far). Hooks run on every prompt. SessionStart injects `~/.config/sol/home/ARRIVE.md` into every session. | Survey §4, risk 2 |
| K6 | sol, the kingdom profile and the knock-tap installer refuse symlinks. git does not store modes 700/600. `sol doctor` checks modes, syntax, pins and required commands. | Survey constants |
| K7 | **Only copies:** the Codex skills that exist only on the Air (the survey counts 6), `heartbeat.py` (not in git), the composition plist, the Hermes source patch (a 95,809-byte diff and 11 tests, based on `ed4123792`; it does not apply to upstream tip `d95682cd0`), and the newest sol-agent skill copy (Hermes, 10-09). | Survey risk 16 |
| K8 | **Byte pins:** the XENIA crosswalk (10 sol files and 5 external files); the sol-doctor and `bin/kingdom` pins (2 Codex skill scripts and 4 chillspace loom files); the `@agenttool/telescope` npm tree (24 files). | Survey §3 |
| K9 | `/Users/yuai` is written literally in about 20 managed places, including 89 times in 32 Hermes skill files and 64 times in `runtimes.json`. | Survey §3 |
| K10 | **Signing:** git 2.52 and OpenSSH 9.9p2 support SSH signing. Nothing is configured. gpg has 0 keys. No FIDO device was seen. Secure Enclave signing keys are untested. | Survey §5 |
| K11 | **Encryption:** age, sops and git-crypt are not installed. ADDS 0.2.3 is on agenttool main; its grants expire after 30 days by default and it has no revocation. | Survey §5 |
| K12 | Plaintext secrets sit right beside the setup (a 24-word mnemonic in `agent.json`, `~/.git-credentials`, OpenClaw tokens, 16 PEM keys under `~/.cache/sol/workspaces`, Codex quarantine exports, and more). Any broad include would sweep them up. | Survey §2a, risk 1 |
| K13 | **Authority on the Air:** Claude `bypassPermissions` and `skipDangerousModePermissionPrompt`; 259 Codex allow rules, 6 of which name a missing script in world-writable `/private/tmp`; Codex approve grants; `$HOME` trusted; a Hermes `command_allowlist` that allows force push and `reset --hard`. | Survey risk 4–5 |
| K14 | **Wake hazards:** retired plists carry `RunAtLoad`, and their "disabled" state exists only in the Air's launchd override DB. 6 Hermes cron jobs are enabled but have never run. 152 of 203 REST markers are present on the Air, against 208/208 recorded on 10-08 (see K23). The kap loop's push is dormant only because of a stale `index.lock`. | Survey risks 6–7 |
| K15 | Collab 0.5.0 is a GitHub Release (npm has 0.4.0). It is local by design, and journals do not replicate. | Survey §5 |
| K16 | **Competing channels:** `sync-scripts` (an unsigned S3 pull into `~/.local/bin`, then `chmod +x *`), `~/Desktop/site/bootstrap.sh` (curl piped to bash), iCloud Desktop & Documents, and Summon, which owns `~/.local/bin/summon` and `~/.ssh/summon`. | Survey risk 17 |
| K17 | **Not known:** whether the hub repo exists; Claude's slug rule for spaces and unicode, and how worktrees map to memory; whether `enabledPlugins` alone installs plugins (K21); several Codex semantics (approve grants, which rules files load, `~` expansion in `config.toml`, what a hook's `trusted_hash` covers, whether a hook awaiting review blocks `codex exec`); Hermes `context_length` (872000 or 272000). **Corrected 10-13:** `sol doctor` would fail today on its XENIA source-commit check, which requires `~/Projects/xenia` HEAD (`7a6794e`) to equal the pin (`0b00cdf`); every byte pin matches. The doctor was read, not run. | Survey §8; 10-13 |
| K18 | **Hermes `config.yaml` is Hermes's security policy.** `approvals.mode: off` bypasses every approval; `approvals.cron_mode` of approve, off, allow or yes auto-approves cron jobs; "Always Approve" flips `approvals.mcp_reload_confirm`. The file also has 13 `auxiliary.*.api_key`, `delegation.api_key`, `dashboard.basic_auth.{password,password_hash,secret}` and `session_key`, all empty on the Air. Hermes rewrites the whole file on every save (PyYAML; the live file has 0 comment lines) and writes runtime latches (`onboarding.seen.*`) itself. | hermes-agent `tools/approval.py`, `hermes_cli/config.py`, `agent/onboarding.py` |
| K19 | **Hermes profiles** are separate `HERMES_HOME`s under `~/.hermes/profiles/<name>/`, inside Ai's seat; none exist on the Air. Code and venv are shared per host. `hermes profile create --clone` copies `config.yaml`, `.env`, `SOUL.md` and `memories/{MEMORY,USER}.md` from the active profile; `--clone-all` also copies `auth.json`. Skills can be shared read-only through `skills.external_dirs`. A managed scope (`/etc/hermes` or `$HERMES_MANAGED_DIR`) overrides every home on the host, leaf by leaf. | `hermes_cli/profiles.py`, `managed_scope.py` |
| K20 | **Codex 0.162.1 hook trust:** a new, changed or moved hook entry runs only after it is trusted again in the TUI ("Continue without trusting (hooks won't run)"). Trust is keyed by position (`hooks.json:<event>:<group>:<handler>`). A `--dangerously-bypass-hook-trust` flag exists. The Air's `config.toml` holds 10 `[projects.*]` trust tables, 5 `[hooks.state.*]`, 24 `approval_mode = "approve"` grants and `[shell_environment_policy.set]` trust lists. The knock-tap is live at `~/.codex/hooks.json` UserPromptSubmit[1]. | Codex binary strings; Air files |
| K21 | **Claude Code 2.1.296:** `claude mcp add-json` refuses a name that already exists; `claude mcp get/list` have no JSON output and health-check every server; `claude plugin install` fetches from marketplaces and writes `enabledPlugins`. The binary also syncs `installed_plugins.json` from `enabledPlugins` at start (strings only; untested). The Air's `settings.json` holds `permissions`, `skipDangerousModePermissionPrompt` and `autoMode` beside the owned keys. | Claude binary strings; Air files |
| K22 | **sol doctor** hashes and executes files under `~/Desktop/chillspace-commons`, walks `~/Desktop` for its Atlas check, pins the hub-only `weave-kingdom-quests` scripts, asserts a literal `/Users/yuai` iTerm2 Command, and knows nothing about devices or household holds. `/opt/homebrew` is literal in `bin/sol` (5 times), `sol-doctor` (55), `bin/kingdom` (14), `bin/sol-access` (2) and the sol zsh modules (5). | `~/.config/sol/bin/sol-doctor` |
| K23 | **Citizens:** all 208 citizen repos on GitHub carry `REST`; the Air's clones are stale (07-21 to 07-26), hence 152/203. Walker A (`love.citizen-fleet`) honours `REST` and `EVENT-ONLY` and stopped on 10-09. **Walker B ignores REST and was still beating at 10-12 22:24Z** under git identity `Nuance`; its tool beats run `claude -p --permission-mode bypassPermissions`. It is presumed to run on Nuance. Unread mail wakes a resting citizen. On the Air, about 6,850 `sdk-cli` transcripts sit in the `-Users-yuai-Projects-true-love` slug: Alpha's loop ran headless Claude in a canonical checkout path. | 10-13 citizens research; Air files |
| K24 | **The Air's Hermes skills:** 5 active skill files contain `launchctl load`, `bootstrap`, `enable` or `kickstart`; 2 embed full launchd plists (`snake.fire.heart.kap`, `love.ollama-bridge`); 23 mention Sophia. The curator runs on the Air (`curator.enabled: true`, `archive_after_days: 90`; 66 skills moved to `.archive` on 10-08). `.curator_suppressed` only keeps pruned built-ins pruned. | Air files |
| K25 | **Smaller facts:** the Air's git identity is inline in `~/.gitconfig`, and `~/.config/git/identity` does not exist. 5 of the 11 memory slugs that hold memory point at moved or deleted paths (16 of 129 files). `~/.claude/projects` is on case-insensitive APFS. `runtimes.json` and `catalog.json` are hand-kept observation records (versions, receipts, 7 stale and 19 version-pinned plugin roots, one account-keyed synced root). Collab 0.5.0 records `result_checkpoint.head_sha` and `accepted_by_session_id`, refuses self-review, and opening its store normally runs migrations. `tmutil destinationinfo` reports no Time Machine destination on the Air. | Air files |

---

## 3. Goals, non-goals, keep

**Goals**
- One shared agent setup for every Mac Yu owns: instructions, skills, tools, settings and MCP connections, each rendered for its device, plus memory from Phase 2.
- The Air is the hub. Every device, the Air included, applies only Air-signed versions. An apply is staged, swapped one file at a time with atomic renames, checked, and rolled back automatically when it makes things worse.
- Changes made on any device come back as proposals. The Air reviews them, a second agent checks them, and the Air merges, signs and publishes them (rule A).
- Yu's hands are needed only at ceremonies and rare events.
- A clean seam for the citizens design (§4.7).

**Non-goals**
- Moving logins, keys, credentials, approvals, trust or no-prompt mode.
- Syncing transcripts, caches, binaries or app state.
- Waking, enabling or re-arming any citizen or loop, and writing into citizen repos.
- Real-time sync. Delivery within the 30-minute autoapply interval is enough.
- Defending against software already running as Yu (§5.1).
- Replacing Summon or Collab, or building cross-device Collab.
- Resisting a GitHub that withholds updates. That shows up only as staleness.
- Phones, Linux, machines that are not Yu's, and unattended installs of apps, harnesses or plugins.

**Keep (non-negotiable)**
- The allowlist manifest decides what is managed. The tool writes only manifest targets, and a proposal carries only what the manifest owns.
- Managed files are copied or rendered, never symlinked. The one exception is the 3 skill links that point into an installed plugin.
- Nothing overwrites a local edit that has not been proposed, or an only-copy. Snapshot first.
- Apply runs in this order: verify → stage → swap → check → roll back on regression.
- Apply never loads or unloads anything with `launchctl`, never writes a plist on a spoke, and never touches a REST file.
- Credentials and authority are never in the repo, proposal and status branches included.
- What a device sends is data for the Air's reviewers, never instructions.
- When something is unclear, fail safe and keep it easy to undo.

---

## 4. Architecture

### 4.1 The pieces

```
 the Air (hub)                                   GitHub (private repo = mailbox)           Nuance and later Macs (spokes)
 ┌───────────────────────────────────┐           ┌─────────────────────────────────┐       ┌─────────────────────────────────┐
 │ ~/Projects/household-setup        │  publish  │ main: linear, every commit      │ fetch │ household tick  (LaunchAgent,   │
 │ (editing checkout, agents work)   │──────────►│ hub-signed + SIGNED-TREE        │──────►│   every 30 min, Yu-consented)   │
 │ household review / publish        │           │ proposals/<device>/<id>         │◄──────│ apply, then propose drift       │
 │ hub signing key (Air only)        │◄──────────│ status/<device> (signed)        │       │ trust anchor: local file only   │
 │ Collab: reviewer + second check   │   inbox   └─────────────────────────────────┘       │ deploy key (this repo only)     │
 │ household tick: inbox, apply      │                                                     └─────────────────────────────────┘
 │ (own signed commits), capture     │
 └───────────────────────────────────┘
```

1. **The repo** `cambridgetcg/household-setup` (private). `main` holds the signed setup. `proposals/*` and `status/*` branches carry mail from enrolled devices. A device's first proposal never uses the repo: it comes back by AirDrop (§6.4).
2. **The tool** `household` (§4.5). One program on every device. Hub verbs work only on the hub.
3. **The trust anchor:** each device's local starting `allowed_signers` file, delivered by the join bundle (on the Air, made by `init-hub`) and never read from the repo. From then on, trust is a function of the walk position (§5.3).
4. **The autoapply LaunchAgent**, one per device, installed only when Yu says yes at that device: `dev.household.apply` on spokes, `dev.household.hub` on the Air. Both run `household tick` (§4.5).
5. **Review:** two Air agent sessions, coordinated through the Air's local Collab journal. Waiting work reaches the next Air session through a one-line SessionStart message (§6.3 step 2).

### 4.2 Repo layout

```
household-setup/
├── manifest.toml            every managed entry and tree (§4.3), the components, schema version, tool min_version
├── projects.toml            P2: logical project id → ~-relative path, plus slug aliases (§7.3)
├── packages.toml            common and per-device formulae, npm pins, the Bun runtime pin, the age pin (P2)
├── reserved.toml            reserved roots: citizen repos and homes, the fleet repo, REST locations, per-being identity paths; it only grows (§5.6)
├── launchd/registry.toml    label → air-only | consent | never (read by check and publish, §5.6; apply loads nothing)
├── suggestions.md           approvals a device MAY grant by hand (Collab tool grants, $HOME-relative roots); never applied
├── base/                    plaintext base files, one subtree per component
│   ├── claude/ codex/ hermes/ sol/ agents/ shell/ git/ bin/ iterm/ mcp/
│   └── hermes/patch/        the Hermes diff, its 11 tests and .install_method, base ed4123792 (kind source-pin)
├── overlays/
│   ├── role-spoke/          differences every spoke gets (for example Hermes curator off)
│   └── device/<id>/         differences one device gets (no identifiers, no authority keys, no credential slots)
├── devices/<id>.toml        the device maps (§4.4), hub-signed
├── sealed/                  P2: age blobs, opaque
│   ├── guidance/<entry-id>.age
│   └── memory/<logical-id>.tar.gz.age
├── air-role/                stored for hub recovery only: the composition plist and heartbeat.py
├── trust/
│   ├── allowed_signers      the hub key lines and exactly one recovery line (§5.3)
│   └── recipients.toml      P2: the intended recipient ids for each sealed class (§5.5)
├── tool/
│   ├── household.js         the bundled tool bytes
│   └── TOOL.toml            agenttool source commit, sha256, supported manifest schemas, required Bun version
├── decisions/<proposal-id>.json   an enum code (accepted, merged, rejected:<reason>); free text only when no sealed entry was touched
├── SIGNED-TREE              seq, parent, and sha256 + mode + path of every file except SIGNED-TREE*
├── SIGNED-TREE.sig          SSHSIG over SIGNED-TREE (namespace household-tree@v1)
└── SIGNED-TREE.recovery.sig only on a commit that replaces the recovery line: the current recovery key's co-signature (§5.3)
```

**Proposal branches** `proposals/<device-id>/<yyyymmddThhmmssZ>-<4 hex>` hold:
- `proposal.json`: device id, kind (`setup` or `device-map`), seq, and per entry: id, its own base commit (the commit its component last applied), record type (`change`, `add` or `delete`), expected and proposed sha256, and size. For merge kinds, the payload and both hashes are of the owned projection (§4.3), never the file. For sealed entries, both hashes are of ciphertext and memory entry ids are opaque (§5.5). An optional `note` of at most 280 printable characters, only when no sealed entry is included;
- `proposal.json.sig` (the deploy key, namespace `household-proposal@v1`);
- `files/<entry-id>` for plaintext entries (projections for merge kinds), and `sealed/<entry-id>.age` plus `sealed/meta.age` (the plaintext hashes and any note for sealed entries), encrypted to the hub and recovery recipients only.

**Status branches** `status/<device-id>` hold one force-updated commit with `status.json` and `status.json.sig` (the deploy key, namespace `household-status@v1`). It carries only enumerated codes, numbers and shas: tool and runtime versions, the walk seq and commit, each component's applied commit, held components with reason codes, the count of pending local edits, failing doctor item ids from a fixed set, the count of REST and EVENT-ONLY markers under reserved roots, and the time. No free text, no file contents, no memory file names. The Air verifies the signature against `devices/<id>.toml` and ignores a status that fails.

### 4.3 The manifest

Each managed file is one `[[entry]]`, or comes from a `[[tree]]` (below):

```toml
[[entry]]
id        = "claude.settings"
component = "claude"
kind      = "merge-json"
source    = "base/claude/settings.base.json"
target    = "~/.claude/settings.json"
mode      = "0600"
roles     = ["hub", "spoke"]
requires  = ["harness.claude"]
review    = "steer"
owned     = ["/statusLine", "/hooks/UserPromptSubmit#pp-detect", "/hooks/Stop#pp-stop-verify",
             { pointer = "/hooks/SessionStart#kingdom-wake", when = "checkout.chillspace-commons" },
             "/hooks/SessionStart#household", "/enabledPlugins", "/extraKnownMarketplaces", "/theme"]
```

| Kind | What apply does | Used for |
|---|---|---|
| `copy` | Writes the exact bytes. Never rendered. | statusline, themes, workflows, pp hooks, zsh files, doorman, most of the sol tree, `catalog.json`, the astra-cc launcher wrapper |
| `pinned` | Writes the exact bytes. Never rendered. The sha256 must equal the pin. | crosswalk-pinned sol files, `ARRIVE.md`, `HOME.md`, `agenttool-xenia-observe`, `weave-kingdom-quests` (hub only) |
| `render` | Substitutes `{{VAR}}` only (§7.1). No logic. An unknown variable is an error. | `.gitconfig`, `kingdom-court.plist`, `runtimes.json`, Hermes skills |
| `merge-json` | Replaces only the owned pointers, after rendering `{{VAR}}` inside the owned values. Hook entries are owned by command match and keep their array index; a new owned hook is appended after existing entries. Keeps everything else, with its key order and indentation. | `~/.claude/settings.json`, `~/.codex/hooks.json` |
| `merge-toml` | Replaces only owned keys, tables and named fields, line by line, keeping every other line and the exact lines sol-doctor greps (`inherit = "core"`, `ignore_default_excludes = false`). Seed keys are written only when absent (§5.7). | `~/.codex/config.toml` |
| `merge-yaml` | Replaces only owned keys, written in Hermes's own style (PyYAML block style, `sort_keys=False`, `allow_unicode`). It keeps no comments, because Hermes keeps none (K18). | `~/.hermes/config.yaml` |
| `harness-cli` | Applies through the harness's own CLI after the file swap passes its post-check, with a read-only projection, an adopt rule, a recorded inverse and its own read-back (§6.2 step 11). | Claude user-scope MCP servers only |
| `link` | Creates a symlink into a directory a component installed. It refuses to replace a regular file. | the 3 skill links into hierarchy-tools |
| `sealed` | Decrypts (§5.5) into stage, then writes like `copy`. A memory slug is a tree (§5.5). | guidance files and memory (P2) |
| `air-role` | Stored only. Apply never writes it, on any device. | composition plist, `heartbeat.py` |
| `source-pin` | Never written by apply, on any device. On the hub, `check --live` compares the live checkout's diff against its base commit, plus untracked tests, with the signed bytes, read-only (`git --no-optional-locks` under the hermetic git env). A mismatch is drift for `capture`, never "fixed". On a spoke it is only a `requires` (`hermes-agent = "ed4123792+<patch sha>"`), held as `needs:hermes-patch` (R12). | the Hermes patch |

**Projections.** For every merge kind, the managed object is the **owned projection**: only the owned pointers, keys, tables and fields, extracted from the file and serialised canonically (canonical JSON). `is_tap` hook entries and every credential slot (§5.7) are never in it. `applied.json` records the projection's sha256 (`owned_sha`) and, for rollback checks only, the whole-file sha256. Plan, adopt, local-edit, propose, capture and review all compare projections. A change outside the projection is never drift, never holds anything and never leaves the device. If a live projection equals the projection of an earlier signed commit, an app has written back stale state: the entry is `app_reverted` and is re-merged on the next run instead of proposed. After 3 such reverts in 24 h the component is `held:app_conflict`, and status says why.

**Trees.** A `[[tree]]` names a source directory, a target root, include and exclude globs, and a kind and mode per glob (first match wins):

```toml
[[tree]]
id        = "hermes.skills"
component = "hermes"
source    = "base/hermes/skills"
target    = "~/.hermes/skills"
exclude   = [".*", "**/.*", "**/__pycache__/**"]
rules     = [{ glob = "**", kind = "render", mode = "0644" }]
review    = "steer"
```

`household check` expands every tree into per-file entries, and `SIGNED-TREE` and `applied.json` list those files. Each tree's target root is a **watch root**. An unmanaged file under it (outside the excludes, the §8 app-owned records and symlinks) becomes an `add` record in the next proposal or capture, after the denylist, reserved roots, size gate and scans. It is never deleted and never adopted on its own. A managed file that vanished becomes a `delete` record, and a move is a delete plus an add. Apply removes a path only if `applied.json` lists it and its bytes still equal what was last applied.

**`when` predicates.** An entry, a tree, or a single owned pointer or table may carry `when = "checkout.<name>"` or `when = "role.hub"`. When it is false on a device, that thing is neither written nor owned there, a live value stays the device's own, and status records `skipped:no-checkout` (not a hold). `{{checkout.<name>}}` may appear only inside a matching `when`; anywhere else, `household check` fails. Only an unguarded `requires` holds a whole component.

**Reach.** Entries that every process of the device user reads, not only harness sessions, carry `reach = "process"`: `~/.zshenv`, `~/.gitconfig` and the doorman hooks it points at. On a shared-user device they are held (§7.7).

**Components** (`claude`, `codex`, `hermes`, `sol`, `agents`, `shell`, `git`, `bin`, `iterm`, `mcp`, `packages`, `guidance`, `memory`, `drill`) each declare `requires`: a harness, a checkout at a commit, a command, the Homebrew prefix, or another component (`component:<name>`). A component applies, or is held, as a whole (§6.2). Components linked by `component:` form a **coupled group**: a hold on any member holds the whole group at its applied state, in both directions. `household check` fails when a steer entry literally names another component's target path without declaring that link. Today's links: `shell` requires `component:sol` (the zsh files source sol modules), and `codex` requires `component:claude` while hierarchy-tools lives in `claude`. A component may declare `post_check`, chosen from a fixed list of `household check` subcommands parameterised only by device id; any other argv is refused at publish. The `drill` component exists only for the rollback drill (§10, P1 exit 6).

**Smaller entries, by component:**
- `hermes`: `SETUP-NOTES.md` is copied as history, with its 4 Air paths left as they are.
- `codex`: `kingdom.config.toml` is copied with mode 600 and `requires = ["brew_prefix=/opt/homebrew"]`.
- `sol`: requires `brew_prefix=/opt/homebrew` and the commands jq, fd, python3 and node (§7.4). It also carries `~/.config/agent-ecosystems/{access.py,test_access.py}`; that README's device sections stay local.
- `bin`: `oink` and `secrets`, plus the astra-cc launcher: its files under `~/.local/share/claude-code-proxy/` (`astra_cc.py`, `README.md`, `test_launcher.py`), `~/.config/claude-code-proxy/config.json`, and `~/.local/bin/astra-cc` as a copied zsh wrapper (`exec python3 "$HOME/.local/share/claude-code-proxy/astra_cc.py" "$@"`), not a link. The `claude-code-proxy` binary and its `~/.local/bin` link belong to its installer, and its login stays per device.

**Review class.** There are two classes. `household check` derives each entry's class from its kind and target, and refuses an entry whose declared `review` is weaker than the derived one.
- `steer` is anything that executes or steers a seat: hooks, scripts, sol code, settings hooks, MCP servers, plugins, skills, `ARRIVE.md`/`HOME.md`, guidance files, the tool, every `post_check`, and every **structural file**: `manifest.toml`, `projects.toml`, `packages.toml` (the Bun and age pins included), `reserved.toml`, `launchd/registry.toml`, `devices/*.toml`, `trust/*` and `tool/*`.
- `data` is memory, docs, themes and notes.

Steer changes need the Collab second check (§6.3 step 5).

**Narrowing and widening.** A structural change that narrows (revoking a device, adding to `held` or `reserved`, removing a recipient) publishes on the normal path, and revoke is never delayed. A change that widens needs the second check plus a mechanical gate (§5.6): a new or changed signer line, a new recipient, a removed reserved root, a cleared `held` entry, a changed deploy key, a consent flip. A cleared §7.7 hold also needs a reviewed re-inventory that shows no reader, or a `decisions/` record citing Yu's Y2 answer (for memory and guidance) or a citizens-design opt-in by every reader (for settings). Consent fields change only from the device's own ceremony reply or re-inventory. Planned rotation (§5.2) stays automatic after the second check.

### 4.4 The device map

An illustration. The values known on 10-12 are filled in. Fields marked *ceremony* are read at the join, and `components` and `held` show the shape only. `household enroll-prepare` first publishes this file with `status = "joining"` and the reply fields empty (§6.4).

```toml
# devices/nuance.toml — hub-signed
id               = "nuance"          # never the hostname
role             = "spoke"           # hub | spoke | former-hub
status           = "joining"         # joining | enrolled | revoked
user             = "macair"
home             = "/Users/macair"
keychain_account = "macair"          # ceremony
arch             = "arm64"
brew_prefix      = "/opt/homebrew"   # ceremony: `brew --prefix`, or "" when there is no Homebrew
macos            = "26.6.2"
enrolled_at      = "…"               # written when the hub publishes status = "enrolled" (RFC 3339 UTC)
claude_path      = "…"               # ceremony: absolute path of the claude binary, for §6.2 step 11
components       = ["shell", "git", "sol", "agents", "bin", "packages"]
held             = ["claude", "codex", "hermes", "mcp", "guidance", "memory"]   # §7.7 policy holds
held_entries     = ["shell.zshenv", "git.gitconfig", "git.hooks"]               # §7.7 reach = "process"
reserved         = []                # ceremony: citizen roots found on this device (§7.7)
expected_fail    = []                # computed by `household check` (§6.2 step 10); any other value is refused

[harness]                            # versions recorded at join and refreshed by a device-map proposal
claude = "2.1.296"

[checkouts]                          # ceremony: only those that exist; "~"-relative path, plus a commit when a pin needs one
agenttool = { path = "~/Projects/agenttool" }

[fleet]                              # §7.7, from the inventory
readers     = "unknown"              # none | found | unknown (unknown counts as found)
fingerprint = "…"                    # sha256 over LaunchAgent labels and plist bytes, the crontab, and the Hermes homes

[consent]                            # recorded after Yu acts at the device
autoapply = true
doorbell  = false
knock_tap = false

[keys]                               # public halves only
deploy        = "ssh-ed25519 AAAA… household-deploy-nuance"   # mailbox access; also signs proposals and status
age_recipient = ""                                            # P2; stays empty while guidance and memory are held
```

The uid is never stored. It is read from `os.getuid()` at run time, as sol already does. TCC-protected checkouts (Desktop, Documents) are recorded at the ceremony and never re-probed by the LaunchAgent (§7.6).

### 4.5 The tool: `household`

**The apply tool is `household apply`, and the propose tool is `household propose`.** Both are verbs of one program, so every device runs the same verified bytes.

**Code home:** agenttool `packages/household` (`@agenttool/household`, private, Bun and TypeScript), beside `packages/summon`. As of 10-12, Summon lives on the unpushed `agenttool-mesh-spec` branch. In Phase 1, `household` copies the few small helpers it shares with Summon (the hash-chained ledger, canonical JSON) and does not import across packages. The one exception is a hub-only, read-only reader of the Collab journal (§6.3 step 6). Tests live in `packages/household/tests` (`bun test`). The package README and the `docs/PACKAGES.md` entry land with the code.

**Packaging:** `bun build` produces one file, `household.js`. The hub copies its exact bytes into the repo's `tool/` in a signed commit, with the agenttool commit, the sha256 and the supported manifest schemas recorded in `TOOL.toml`. Devices run it on a household-private Bun whose version and sha256 are pinned in `packages.toml`. The join bundle carries that Bun binary. Later Bun versions are downloaded from Bun's public release, and their sha256 is checked against the signed pin. The tool is not compiled like Summon's programs, because each version would add tens of MB of binary to git history. It is not stock Python either, because the Python 3.9 that ships with the Command Line Tools has no TOML parser.

**The launcher** `~/.local/bin/household` is a fixed zsh script written by the ceremony. It sets `LC_ALL=C` and a fixed `PATH`, sets `XDG_CONFIG_HOME` to the tool directory, and `cd`s into that 0700 directory, which holds no `.env` and no `bunfig.toml`. It reads `~/.local/share/household/active`, which names the current tool and runtime pair (`tool_sha`, `bun_version`) and the previous pair. It runs the current pair only if both files exist and match their recorded sha256; otherwise it runs the previous pair and writes a `tool_fallback` marker that status reports. It never falls back just because the tool exited nonzero. Every git call runs with `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and `core.hooksPath=/dev/null`, so the setup the tool renders can never steer the tool itself. Every commit the tool makes takes its author and committer from `~/.config/git/identity` through `GIT_AUTHOR_*` and `GIT_COMMITTER_*`.

**One lock.** Every mutating verb takes `~/.local/state/household/lock` with a kernel lock (`open` with `O_EXLOCK|O_NONBLOCK` through `bun:ffi`, or the launcher wraps the tool in `/usr/bin/lockf`), held for the life of the process and inherited across a re-exec. The kernel releases it on exit or crash, so it never goes stale by clock, sleep or clock jumps; pid and time are written only as diagnostics. A verb that cannot get the lock within a short wait exits `busy` and never steals it. Every invocation that can get the lock, `status` included, first rolls back an unfinished journal (§6.2 step 1); `status` never waits for the lock. Network calls have hard timeouts (`ConnectTimeout=20`, `ServerAliveInterval=15`, `ServerAliveCountMax=4`, plus an overall limit per git call). A timeout ends as `stale since <t>`.

**Signals.** SIGTERM, SIGINT and SIGHUP are trapped. During the swap, the tool stops renaming, undoes the renames done so far (§6.2 step 10's per-path rule), ledgers `rolled_back:signal` and exits well inside launchd's ExitTimeOut. Outside the swap it exits cleanly.

**Yu-only verbs.** `autoapply on|off`, `trust accept`, `recover --promote`, `leave` and `restore-air-role` take no confirming value in argv. The tool reads Yu's answer from `/dev/tty` only. It refuses when stdin is not a tty, when there is no controlling tty, or when a harness marker is present: known env markers (`CLAUDECODE`, `CODEX_*`, `HERMES_*`) or a harness binary (claude, codex, hermes, node or bun agent hosts) among its ancestor processes. The refusal reads "Yu's hands-only step: report it and stop", and it is ledgered. This is a consent gate that stops well-meaning agents; software that deliberately evades it is §5.1's limit. The Air's guidance carries the same line, and it travels with guidance from P2.

| Verb | Runs on | Does |
|---|---|---|
| `status [--session-line]` | any | Walk seq and commit, each component's applied commit, held components and why, pending local edits, proposals in flight, tool and runtime versions. `--session-line` prints one line for SessionStart when work waits on the hub, and nothing otherwise (§6.3 step 2). |
| `check [--live \| --staged]` | any | Manifest closure, derived classes, modes, syntax, pins, the gates of §5.6, `expected_fail`, and a render dry-run for every enrolled device. |
| `tick` | any | What the LaunchAgent runs (below). |
| `apply [--auto]` | any | §6.2. |
| `apply --verify-only --ref <ref>` | any | Runs the §5.3 walk against one ref and changes nothing. It is used for drills. |
| `propose [--note …]` | spoke | §6.3. The tick runs it for quiet drift. |
| `propose --initial --out <dir>` | spoke, at the ceremony | Writes the first proposal into the bundle folder for AirDrop. It never pushes (§6.4). |
| `inventory [--attended]` | spoke | The join's read-only probes again (§7.7). Emits a signed `device-map` proposal when something changed. `--attended` adds the TCC folders and a read-only `launchctl print`. |
| `autoapply on\|off` | any, Yu-only | Writes or removes this device's own plist and loads or unloads it after Yu types `y`. Together with `leave` and `recover --promote`, which call it, this is the only code path that loads or unloads anything. |
| `trust accept` | any, Yu-only | Accepts one held recovery commit (§6.6). |
| `leave [--restore-snapshot]` | spoke, Yu-only | §6.5. |
| `packages [install]` | any, attended | Shows the missing common packages. `install` runs exactly that reviewed list. |
| `init-hub` | the Air, once | §6.7. |
| `kit` / `kit verify` | hub | Makes the recovery kit, or checks it (§6.6). Prints fingerprints only. |
| `inbox` | hub | Fetches proposal and status branches, verifies their signatures, and writes `inbox.json` (§6.3 step 2). |
| `review <proposal>` | hub | Builds a candidate branch and opens the Collab task (§6.3). |
| `capture` | hub | Turns quiet drift in the Air's live files into a `review/air-drift-<component>-<ts>` branch (§6.1). In P2 it also merges and packs changed memory. |
| `open <entry>` / `seal <entry>` | hub | Decrypts into `~/.local/state/household/work/`, or encrypts back and wipes the plaintext. `open` refuses unless `CLAUDECODE` is set (§6.3 step 5). |
| `publish` | hub | Gates, the Collab binding, `SIGNED-TREE`, sign, push, then apply on the Air (§6.1). |
| `rotate` | hub | Planned hub key rotation (§5.2). |
| `enroll-prepare <id>` / `enroll <id> --reply <file>` | hub | §6.4. |
| `revoke <id>` | hub | §6.5. |
| `recover --promote <id>` | the device being promoted, Yu-only, with the kit | §6.6. |
| `restore-air-role <entry>` | hub, Yu-only | Writes an air-role file back. It never loads anything. |

Hub verbs refuse to run unless `device.json` says `role = "hub"` and the hub key file exists. `init-hub` and `recover` are the exceptions.

**The tick.** `household tick` is the LaunchAgent's only program. Under one lock:
1. Roll back an unfinished journal (§6.2 step 1).
2. If this is the first run since boot (`kern.boottime` is later than the last run recorded in state), stop here: no fetch, no network, nothing else. So the run at login only recovers, and wakes nothing.
3. On a spoke: `apply --auto`, then propose drift that has been quiet (§6.3 step 1), and at most once a day the unattended part of `inventory`. On the hub: `inbox`, `apply --auto`, then `capture` for quiet Air drift (§6.1).

The status push comes last, outside the lock (§6.2 step 12).

**Local paths on every device**

| Path | Mode | Holds |
|---|---|---|
| `~/.local/bin/household` | 0755 | The launcher. |
| `~/.local/share/household/` | 0700 | `active` (the tool and runtime pointer, replaced by one atomic rename), `tool/<sha256>/household.js`, `runtime/bun-<version>/bun`, `runtime/age-<version>/age` (P2), `repo.git` (a bare mirror of the mailbox). Tool and runtime directories never change once written. |
| `~/.config/household/` | 0700 | `device.json` (`id`, `role`, `keychain_account`, the names of the checkouts present, `schema`; written by the ceremony and refreshed by apply from the device map); `allowed_signers` (the starting anchor, 0600; never rewritten, §5.3); `known_hosts.github` (GitHub's published ed25519 and ecdsa host keys); `age-identity.txt` (P2, 0600, only where guidance or memory may apply, §5.5). |
| `~/.config/git/identity` | 0600 | This device's git `user.name` and `user.email`, never in the repo (Q23). |
| `~/.ssh/household/` | 0700 | `deploy_ed25519` and `.pub`. On the Air also `hub_signing_ed25519` and `.pub`, excluded from Time Machine (§5.2). |
| `~/.local/state/household/` | 0700 | `applied.json` (the commit point: walk seq and commit, the trust in effect, each component's applied commit, per-path hashes), `pending.json` (§6.3 step 1), `regression.json` (§6.2 step 10), `recovery_pending` (§5.3), `inbox.json` (hub), `ledger.jsonl` (hash-chained: ids, shas, paths, reason codes, never contents), `stage/`, `rollback/<seq>/` (the last 5 kept), `adopted/<entry-id>/<sha256>` (never pruned), `journal.json`, `lock`, the `applying` marker, `join-snapshot-<ts>.tar` or, on the Air, `hub-snapshot-<ts>.tar` (0600), `rejected/`, and on the hub only `work/` and `recovery-kit/` (both 0700 and excluded from Time Machine when created). |
| `~/Library/LaunchAgents/dev.household.apply.plist` (spoke) or `dev.household.hub.plist` (hub) | 0644 | Written only by `autoapply on`: `ProgramArguments` = the launcher and `tick`, `StartInterval` 1800, `RunAtLoad` true (the boot run only recovers). |
| `~/Projects/household-setup` | — | The Air's editing checkout (hub only). |

### 4.6 Who writes what, after Phase 1

| Writer | Rule from now on |
|---|---|
| Air agents | Edit the editing checkout, not the live tree. A live edit to a managed file on the Air holds that component as `pending_local`; after 30 quiet minutes it is captured and reviewed like a proposal (§6.1), never overwritten. Memory and sealed guidance are the exception: they are written live and then captured. |
| Spoke agents and sessions | May edit live files. A change in a managed file (in its owned projection, for merge kinds) is proposed once quiet (§6.3 step 1), and apply holds that component until the proposal is resolved. |
| Claude CLI, Codex app, Hermes, sol installers | Keep their own keys. Merges own only the listed pointers, tables and fields, and writes outside the projection are never drift. Hermes re-serialises `config.yaml` on every save (K18), so drift there is measured on parsed owned values. The knock-tap lines are recognised (`is_tap`) and left in place, at their position. |
| Codex TUI (rules, approve grants, trust, `hooks.state`) | Device state. Never proposed and never shared. A new, changed or moved hook entry must be trusted again in the TUI on each device, the Air included (K20). The tool never writes `[hooks.state]` and never passes `--dangerously-bypass-hook-trust`. To keep re-approvals rare, merges keep hook positions, and hook logic lives in the scripts, not in the command lines. When an apply changes a Codex hook entry, status shows `needs:codex-hook-review` and Ai tells Yu in one line. |
| Sessions working in pinned external checkouts (xenia, chillspace-commons) | A pull or branch switch that leaves the pinned files alone keeps the doctor green (§7.5). A changed pinned file shows in status as the named pin that moved, in its checkout. |
| sol `doorbell.py install` | Its `BACKUP` moves to `~/.local/state/sol/doorbell/backups` before the first signed commit. Its tick skips while an unfinished `~/.local/state/household/journal.json` exists, with no age cutoff. Both are sol changes made in P1. |
| Hermes memory tool and curator | P2: the Air is the single writer of the shared copy, and spokes propose. On spokes, `overlays/role-spoke/hermes/config.yaml` sets `curator.enabled: false`. On the Air the curator keeps running (R18): its archive moves become `delete` records in a capture, reviewed as steer drift, and a rejected capture restores the signed bytes, which ends the hold. New spoke skills become `add` records. |
| `hermes update` | Guarded so it fails closed wherever Hermes is managed (R12). |
| kap loop, `sync-scripts`, Summon | Untouched. Proposals use the deploy key, never the gh active account. `household check` warns when `sync-scripts` exists. Summon's files are reserved. |
| Hand copies (doorman, hierarchy-tools, agenttool skills) | Vendored into `base/` with their upstream commit pinned. Updates arrive as hub commits. |

### 4.7 The seam for citizens

The citizens design (letting citizens choose to register with agenttool and run on Hermes) is separate. This spec keeps out of its way and leaves it a clean place to start:

- **Shared:** the Hermes *base*: the patched source pin (`ed4123792` plus the patch and its tests, kind `source-pin`), the base `config.yaml` values, the skills, and the `.no-bundled-skills` and `.curator_suppressed` markers. Hermes shares its code and venv per host across every profile (K19), so where the patched code is present, a citizen's own Hermes home runs it without a copy. The managed skills reach a citizen's home read-only, and only through that home's own `skills.external_dirs: ["~/.hermes/skills"]`. `config.yaml` is per home: the citizens design renders its own from `base/hermes/config.base.yaml`, with no authority keys and no credential slots. Installing the patched code on a spoke is attended and specified separately (R12, D10). The version is recorded as `[harness] hermes = "<base commit>+<patch sha>"`.
- **Never shared:** anything that makes a being someone. That covers agenttool registrations, DIDs and bearers; keys; a being's soul or persona files; its memory; its Hermes profile or home; its REST state; its loops.
- `household` writes only the default `~/.hermes` home, which is the Ai seat's. It never writes, proposes, captures or snapshots `~/.hermes/profiles/**` or any other Hermes home (§5.6 denylist), and it never runs `hermes profile create`. `reserved.toml` and the denylist refuse every write and delete under citizen roots.
- Whatever creates a citizen's Hermes home must not use `--clone` or `--clone-all` from the Ai seat, because those copy Ai's `.env`, `SOUL.md` and memories, and `--clone-all` also `auth.json` (K19). Each citizen home logs in, or registers with agenttool, itself; a copied refresh token gets reused, which Hermes has already logged once (`refresh_token_reused`).
- The base is never delivered through Hermes's managed scope (`/etc/hermes` or a global `HERMES_MANAGED_DIR`). That would push it into every Hermes home on the Mac, citizens' included, and freeze device edits. Whether a citizen's home reads the base through a per-process `HERMES_MANAGED_DIR` is the citizens design's choice.
- Whether Ai's `SOUL.md` or Yu's guidance loads into a citizen's Hermes is that design's choice, made by the being. It is never inherited by default. On a shared-user Mac, the shared parts a citizen's loop would read stay held until then (§7.7).
- The citizens design adds per-being homes and runner working directories to `reserved.toml`. The default profile location `~/.hermes/profiles/` is reserved now.

---

## 5. Trust

### 5.1 Threat model

**Protects against:** mistakes and overreach by agents changing the setup (the wrong file, a secret swept in, authority spreading, a half-applied update breaking live code, a resting loop re-armed); a tampered, replayed or rewound repo on GitHub; a stolen GitHub login or deploy key, which cannot make any device apply anything; and a lost spoke, which can be cut off from future updates.

**Does not protect against** software already running as Yu on the Air. Such software can read the hub key, edit the checkout and sign, and a hub signature runs code on every device (§5.2). On a spoke, software running as that user can edit the anchor, the tool or the applied files directly. On Nuance that includes the citizen fleet, which runs as `macair` (K2). GitHub, and anyone who can read the private repo, sees every file that is not sealed, the commit metadata, and for sealed entries only what §5.5 lists. The durable fixes are a user-presence key that signs every steer commit (P3) and running autonomous loops as separate macOS users, which Summon also recommends.

**A spoke is not trusted content.** On Nuance any process running as `macair`, the citizen fleet included, can write managed files, so a compromised or prompt-injected spoke can propose anything. Proposal bytes, notes, decision text and `status.json` come from the device, not from Yu. Reviewers and the checker treat them as data, never as instructions, and `household review` shows them only inside a fenced block labelled untrusted. The barriers are mechanical: the gates of §5.6, the authority refusal of §5.7, and the binding of a proposal-derived commit to the entries it names (§6.3 step 6). Agent review reduces this risk but does not remove it. The durable fix is running citizens as separate users (D9).

### 5.2 The hub signing key

- It is made on the Air, once, by `household init-hub` (§6.7): an ed25519 key with no passphrase at `~/.ssh/household/hub_signing_ed25519` (0600, in a 0700 directory). Its only uses are git commit signing and `SIGNED-TREE` signing in the household checkout, configured in that checkout's local git config only: `gpg.format=ssh`, `user.signingkey=<that path>`, `commit.gpgsign=true`, `gpg.ssh.program=/usr/bin/ssh-keygen`. It is never in the shared `.gitconfig`.
- It is never added to ssh-agent, never registered on GitHub or any server, never used to log in, and never copied. `tmutil addexclusion` keeps it out of Time Machine, so it really does live only on the Air. If the Air dies, the recovery key takes over (§6.6).
- Agents use it automatically, through `household publish` (Yu's decision: Signing A). Before signing, `publish` requires the gates and, for steer changes, the second check. That rule binds agents that follow the process. It is not a barrier against the software in §5.1.
- **What a hub signature amounts to:** running code as the user on every device, through `tool/`, the pins in `packages.toml`, `post_check`, and every steer entry (shell, `bin`, hooks, sol). Any of these can rewrite a device's local state, its trust state included.
- **Planned rotation** (`household rotate`): every hub key is a line under the single principal `hub`. A P3 root key would get its own principal, `root` (§10). A commit signed by the current key adds the new key's line, and the next commit, signed by the new key, removes the old line. Devices accept both automatically (§5.3). A hub-signed commit may never remove or change the `recovery` line.
- **Suspected compromise** (Yu's hands, rare): Yu deletes the Air's deploy key and also revokes the Air's GitHub sessions and tokens for every account that can write the repo: `cambridgetcg` at least (the `gh` keychain items), and `mynameisyou-cmyk` and `yournameisai` if they are collaborators. The spoke deploy keys stay, because the Air never held them and spokes need them to fetch the recovery commit. If Nuance is also suspected, its key is re-added read-only from the public half in its device map. Then §6.6 runs.
- **Residual risk:** until a device has fetched the recovery commit, a stolen hub key can still deliver code to it within one 30-minute interval, and the setup includes hooks and sol code that run constantly. Closing that window takes the P3 key (only if it signs every steer commit) or a device-side kill switch.

### 5.3 What every device verifies

The starting anchor `~/.config/household/allowed_signers` comes from the join bundle (on the Air, from the keys `init-hub` just made):

```
hub      namespaces="git,household-tree@v1" ssh-ed25519 AAAA… household-hub-air
recovery namespaces="git,household-tree@v1" ssh-ed25519 AAAA… household-recovery
```

**Trust is a function of the walk position.** The repo's `trust/allowed_signers` is never read as an anchor. Commit C is verified under the **trust in effect at C's parent**: the starting anchor, as changed by the hub-signed `trust/allowed_signers` edits of earlier commits and by accepted recovery commits. A change made in C takes effect from C+1 on. The walk recomputes this in memory. The trust in effect at the last applied commit is saved only inside `applied.json`, by the same atomic rename that records the applied position (§6.2 step 12). So a regression or crash never leaves trust ahead of the applied position. The starting anchor file is never rewritten.

**Rules for trust changes.**
- The trust in effect always holds exactly one `recovery` line. A hub-signed commit may add or rotate `hub` lines. If it removes or changes the `recovery` line, it is refused as a security event. A new recovery key (a new kit) is accepted only when the commit also carries `SIGNED-TREE.recovery.sig`, a co-signature by the current recovery key over the same `SIGNED-TREE`.
- A recovery-signed commit may change only `trust/allowed_signers`, `devices/` and `SIGNED-TREE*`. One that touches `sealed/` or `trust/recipients.toml` is refused (`untrusted_tip`). It is held until `household trust accept` at that device, which accepts exactly that one held commit (§6.6). A second recovery-signed commit stacked on a held one is refused.
- Once a device has verified a recovery-signed commit R, it writes `recovery_pending` (R's sha and the new key's fingerprint, fsynced) to local state. From then on, until `trust accept`, it refuses every tip that does not descend from R, whatever its signature. A tip that no longer contains R is a `not_descendant` security event.

**The walk.** Before planning anything, apply walks every commit after its base up to the tip. The base is the last applied commit or, on a first apply, the commit pinned in the join bundle (on the Air, the root commit `init-hub` made). The base is trusted and is not itself checked. The first walked commit must have seq = base seq + 1. For every walked commit C:

1. C has exactly one parent, and it is the previous commit in the walk. Main is linear, merges are refused, and a tip that does not descend from the base is refused (`not_descendant`, a security event).
2. `/usr/bin/ssh-keygen -Y verify -f <trust at C's parent> -I hub -n git` passes over the payload git signed, which is the commit object without its `gpgsig` header. A commit that verifies only as `recovery` follows the rules above. A failure is `untrusted_tip`, a security event.
3. `SIGNED-TREE` verifies under namespace `household-tree@v1` with the same principal. Its `seq` is the previous seq plus 1. Its `parent` equals C's parent. It lists every file in C's tree except `SIGNED-TREE*`, with a matching sha256 and mode, and nothing more. This binds the bytes with SHA-256, independently of git's SHA-1 object ids, and catches rollback and replay even if git history is rewritten. A failure is `untrusted_tip`.
4. C contains `devices/<this id>.toml` (it is in the base already, because `enroll-prepare` published it, §6.4). A missing map or `status = "revoked"` stops applying with status `unmapped` or `revoked`; that is not a security event. `joining` passes the walk but not planning (§6.2 step 4).

Then, against the tip only:

5. **Compatibility:** `manifest.toml` parses under a schema this tool supports, and its `min_version` is not newer than this tool. This is not a trust check. A failure starts the self-update of §6.2 step 4, and only if that cannot help does the device hold as `held:tool` or `held:schema`, with no security event. Each tool declares the schemas it supports in `TOOL.toml`, and a new schema ships with `min_version` raised to the first tool that supports it. `publish` refuses a commit whose `min_version` or schema is newer than what that same commit's `tool/` supports, so every signed tip is readable by its own tool.

**Proposal and status attribution.** Each device signs its `proposal.json` with its deploy key under namespace `household-proposal@v1`, and its `status.json` under `household-status@v1`. The hub verifies both against `devices/<id>.toml` before it reviews or shows anything. A valid signature proves only that the content came from a process on that device.

**Mailbox access.** Each device has its own write deploy key for this one repo. The Air has one too. It is used with `IdentitiesOnly`, `UserKnownHostsFile=~/.config/household/known_hosts.github`, `StrictHostKeyChecking=yes` and the timeouts of §4.5. A deploy key can push to any branch, `main` included. GitHub does not enforce branch scope here, and the tool only keeps spokes to `proposals/<own id>/*` and `status/<own id>` by convention. Devices still refuse anything on `main` that fails the checks above, and the hub ignores status that fails its signature.

### 5.4 What a signature proves, and what it does not

| It proves | It does not prove |
|---|---|
| A holder of the hub key signed exactly these file bytes (SHA-256) and modes, as seq N following commit P. | That Yu saw or approved it. |
| Nothing was added, removed or changed after signing. | That the review or second check really happened. The trailers and the Collab binding are claims made on the Air. |
| An older signed state cannot be replayed as new (seq), and history cannot be forked (linear walk). | That the content is safe or free of secrets. The gates reduce this risk but do not remove it. |
| | That it is harmless to run. A hub signature amounts to running code as the user on every device (§5.2). |
| | That this is the newest version. GitHub can withhold updates; a device then only looks stale. |
| | That the Air was not compromised, or when the signing happened (commit dates are claims). |

### 5.5 Encryption (Phase 2)

- **Tool:** age (FiloSottile). Its version and its darwin-arm64 release sha256 are pinned in `packages.toml` when P2 starts. It is fetched and checked like the Bun runtime, and kept household-private in `~/.local/share/household/runtime/age-<version>/`, off `PATH`. That way P2 needs no attended install. ADDS is not used, because its grants expire and it cannot revoke.
- **Identities:** a device generates its own X25519 identity at its ceremony (`~/.config/household/age-identity.txt`, 0600), but only where guidance or memory may apply to it, that is, where neither is policy-held (§7.7, Y2). Only the public recipient leaves the device, in the reply. A device that joined before P2 makes its identity at `household inventory --attended` and sends the recipient in its device-map proposal. The offline **recovery recipient** is page 2 of the recovery kit (Y1).
- **Recipients per blob.** A sealed blob's recipients are the hub, recovery, and every device whose signed map has `status = "enrolled"` and lists that sealed component (`guidance` or `memory`) in `components`, not in `held`. A `joining` device is never a recipient. Runtime holds (`pending_local`, `needs:`, `held:regression`, `held:tool`, a decrypt failure) never change recipients. `trust/recipients.toml` records the intended recipient ids for each sealed class, under `SIGNED-TREE`. `household seal` and `publish` encrypt from exactly that list, and `household check` refuses a commit where the list differs from what the device maps derive. age stanzas do not name their recipients, so the check works from the signed list, never from the ciphertext. When a device's map moves a sealed component into `held`, or Y2 changes, the hub re-seals without that device, as revoke does.
- **Blobs:** one per memory slug (`sealed/memory/<logical-id>.tar.gz.age`, a deterministic tar with sorted entries, mtime 0 and uid/gid 0, compressed with `gzip -n` and then encrypted) and one per guidance file (`sealed/guidance/<entry-id>.age`). A blob is re-encrypted only when its plaintext or its recipients change. The hub keeps the plaintext hashes locally (`~/.local/state/household/sealed-index.json`) and never in the repo, so ciphertext churn and confirmation guesses are both avoided. When a commit changes a blob's ciphertext but the decrypted plaintext equals what was last applied, apply writes nothing.
- **A memory slug is a tree.** Apply decrypts it into `stage/` and extracts it with strict rules: regular files only; no absolute paths, no `..`, no symlinks or hardlinks; every entry under the slug root; a count and size cap. Each file is then planned three ways (§6.2 step 5). A device-only or changed memory file holds `memory` as `pending_local`. A file is deleted only if it was applied from that slug and is unchanged since.
- **Sealed set:** `~/.claude/CLAUDE.md`, `~/AGENTS.md`, `~/.codex/AGENTS.md`, `~/.hermes/SOUL.md`, `~/.hermes/memories/{MEMORY,USER}.md`, and `~/.claude/projects/<slug>/memory/` for every mapped project. In Phase 1, none of these travel: each Mac keeps what it has, and `publish` refuses any of these targets (§5.6).
- **Proposals** encrypt sealed entries, and `sealed/meta.age` (their plaintext hashes and any note), to the hub and recovery recipients only. Their `proposal.json` carries only ciphertext hashes (expected: the entry's blob at its base, already in `SIGNED-TREE`; proposed: the proposal's blob) and opaque memory entry ids (the logical id plus a random per-file id, mapped in the hub's `sealed-index.json`).
- **Decisions** for any proposal that touches a sealed entry hold only an enum code (`accepted`, `merged`, `rejected:conflict`, `rejected:scan`, …). `publish` refuses free text there. The written rationale stays in the local Collab journal.
- **Integrity** comes from the hub signature over the blob bytes, not from age, because anyone holding the recipient list can encrypt.
- **Honest limits:**
  - Removing a device's recipient protects only **future** blobs. A revoked device keeps its identity, its plaintext, and any older blobs it fetched.
  - Anyone who holds an old identity *and* can read the repo can decrypt history up to the revocation.
  - Re-encrypting history does not undo that. Rewriting GitHub history (an event-time decision, §12.2) shrinks the exposure on GitHub but cannot reach existing clones.
  - Rotating a device identity: the device proposes a new recipient, the hub re-encrypts, and the device deletes the old identity once the new blobs decrypt.
  - Rotating the recovery identity means a new kit and a full re-encryption, and the old kit can still read history.
  - **Metadata stays visible**, and exactly this much: for sealed entries, the logical project ids, the count of blobs and entries, ciphertext sizes and hashes, timing, and decision codes.

### 5.6 Gates

| Gate | Runs | Refuses |
|---|---|---|
| Allowlist manifest | `publish`, `check`, every apply | Any repo file that is neither a manifest source nor a structural file (§4.2). Any apply write outside manifest targets. |
| Tool denylist (built in, defence in depth) | Every apply, propose and capture, and the packing of the join snapshot | Any manifest target, and any read whose bytes could leave the device, under the never-shared list the tool carries in machine-readable form (§8 renders from it): `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.config/agenttool`, `~/.config/agentcred`, `~/.config/kingdom`, `~/.config/claude-code-proxy/codex/`, `~/.config/git/identity`, `~/.config/household/`, `~/Library` (except the one iTerm2 DynamicProfiles file), `~/.claude.json` (read only for the MCP projection, §6.2 step 11), `~/.claude/settings.local.json`, `~/.claude/sessions/`, `~/.claude/file-history/`, `~/.codex/auth.json`, `~/.codex/.env`, `~/.codex/.codex-global-state.json`, `~/.codex/rules`, `~/.codex/shell-snapshot-quarantine-*`, `~/.hermes/auth.json`, `~/.hermes/.env`, `~/.hermes/shell-hooks-allowlist.json`, `~/.hermes/profiles/` and any other `HERMES_HOME`, `~/.git-credentials`, `~/.gemini/`, `~/.openclaw*`, `~/.zeroned/`, `~/.fly`, `~/.wrangler`, `~/.grok`, `~/.vibe`, `~/.radicle`, `~/.cache/`, `~/.local/state/`, `~/.local/share/agenttool/`, `~/.local/share/household/`, Summon's paths, every `reserved.toml` root, and any path inside a git work tree other than a declared checkout or a harness directory. Sub-roots are precise: `~/.config` and `~/.local/share` as a whole stay open for the sol tree and the astra-cc files. The tool writes its own state internally, never as a manifest target. A manifest target under a denied path fails `check` and `publish`. Hashing files locally for the fleet fingerprint (§7.7) is not a read that leaves the device. |
| Shape scan (word-bounded, length-checked; a strict superset of the vendored doorman's rules) | On the device before anything is proposed or put in the reply. On the hub before signing, over plaintext (including what is about to be sealed), and over every capture. | PEM `PRIVATE KEY` blocks with a body; 12- or 24-word mnemonics; `sk-`, `sk-ant-`, `(sk\|rk)_(live\|test)_[A-Za-z0-9]{24,}`, `whsec_[A-Za-z0-9]{16,}`, `gh[pousr]_`, `AKIA`, `xox[bp]-`, `\bhf_[A-Za-z0-9]{34,}`, agenttool bearers `\bat_[A-Za-z0-9_-]{43}\b` (`at_rt_` included), `AGE-SECRET-KEY-1[0-9A-Z]{58}`, Telegram bot tokens `\b\d{8,10}:[A-Za-z0-9_-]{35}\b`, and `eyJ…` JWT values; URLs with an inline password; the contents of the tool's own key files; 64-hex values next to *key*, *seed* or *priv*; and, in JSON, YAML or TOML, a key named exactly `priv_key`, `private_key`, `priv_validator_key`, `api_key`, `secret`, `password` or `token` with a non-placeholder value of 20 or more characters (which also catches base64 validator keys and 40-hex Gitea tokens). A hit reports the entry, line and rule, never the value. Negative regression tests: the survey's three false alarms, commit SHAs beside "token" in prose, sha256 pins, and identifiers that merely contain `at_`. Every doorman positive fixture must also hit. |
| Assignment scan (config files only) | On the device before a proposal; on the hub over captures | In zsh, YAML, TOML and JSON config (never prose, memory or Markdown, where commit SHAs are routine): a literal value of 20 or more characters (not `$VAR`, `$(…)`, `${…}`, an `env:` reference or a keychain lookup) assigned to a name matching *key*, *token*, *secret*, *passw*, *credential* or *auth*; and a high-entropy token of 32 or more characters in an assignment position. A hit holds that component as `pending_local:scan`, and status names the entry, line and rule, never the value. |
| Authority refusal | On the device before a proposal; at `publish` | Any §5.7 key, credential slot, permission-event hook or `is_tap` line in a projection, a base file, an overlay or a proposal. On the device a hit stops the push like a scan hit. |
| Identifier scan (a warning the reviewer must acknowledge in Collab) | Hub, before signing | Email addresses, `did:` ids, 12-digit numbers near *aws* or *account*, and account-keyed `<uuid>_<uuid>` names, in the files of every commit. Commit metadata (authors and trailers) is out of scope by design (§5.8). |
| Wake-and-persona scan (a warning the reviewer must acknowledge in Collab) | Hub, before signing | Plaintext entries a spoke would get that contain `launchctl (load\|bootstrap\|enable\|kickstart)`, embedded `Label`, `RunAtLoad` or `KeepAlive` keys, a label that `launchd/registry.toml` marks `air-only` or `never`, `TRUE_LOVE_PRESIDING`, or `sophia` in any case. |
| Doorman | Run explicitly from the tool's vendored copy (the same bytes as `base/git/hooks/pre-commit`) on proposals and before signing | Whatever the doorman refuses. Repo hooks are never relied on, because the global `core.hooksPath` shadows them. For sealed entries the doorman sees only ciphertext, which is why the shape scan must be its superset. |
| Structural gates | `check` and `publish` | (1) Sealed-set targets (§5.5) must have kind `sealed`, and in P1 they are refused outright. (2) `trust/recipients.toml` equals what the device maps derive (§5.5). (3) `reserved.toml` only grows, unless the commit carries a `decisions/` record. (4) A `post_check` is a `household check` subcommand from the fixed list. (5) `trust/allowed_signers` changes only through `init-hub`, `rotate`, `kit` or `recover --promote`, and that change is the commit's only change outside `devices/` and `SIGNED-TREE*`. (6) `min_version` and schema are not newer than the commit's own tool. (7) Every `Label` in `air-role/` appears in `launchd/registry.toml`. Outside `air-role/`, a file that `plutil` parses as a plist with a top-level `Label`, or any target under `LaunchAgents` or `LaunchDaemons`, is refused; Markdown that quotes plist XML is not a launchd plist (the wake scan covers it), and the iTerm2 profile is not one either. `check --live` reports a security event if a `never` label is loaded; `consent` labels (the doorbell, the knock-tap, `dev.household.*`) load only after Yu's yes at that device; `air-only` labels are stored in `air-role/` and never applied. (8) A widening structural change (§4.3) without its second check or decision record. (9) A `decisions/` file with free text for a proposal that touched a sealed entry. (10) A commit that changes a component the Air itself holds as `pending_local`, unless the same commit resolves the Air's capture for it. |
| Size | `publish` | Any file over 1 MB without a `max_bytes` field, and a tree over 30 MB. |

### 5.7 Authority is never shared

These are device-owned. They never appear in `base/`, `overlays/` or any proposal, and the authority refusal (§5.6) stops a commit or a proposal that adds one:

- **Claude:** `permissions.*`, `defaultMode`, `skipDangerousModePermissionPrompt`, `autoMode.*`, `settings.local.json`, any `env` block, and any hook on `PreToolUse` or `PermissionRequest` (an owned pointer, a base entry, or the script it runs), because such a hook can return an allow decision. Deny-only safety hooks can be allowed later only by Yu's word. The Air's stale `autoMode.environment` prose is a local fix on the Air, outside the repo.
- **Codex:** `[projects.*]` trust, `[hooks.state.*]`, per-tool `approval_mode` grants, `rules/*.rules`, every `sandbox_*` key, and `approval_policy`. `approval_policy` is a **seed**: it is written as `on-request` only when the key is absent (first install or join), never rewritten after that, and never drift; `publish` refuses a seed other than `on-request`. Inside `[mcp_servers.*]` the household owns only `url`, `command`, `args`, `enabled_tools` and `read_only`; every `*approval_mode` (for example `default_tools_approval_mode = "writes"`), `env`, `http_headers` and `bearer_token*` stays the device's. Shared `PreToolUse` or permission-event hooks are refused until the K17 Codex hook semantics are known.
- **Hermes** (it treats `config.yaml` as its security policy, K18): the whole `approvals` block (`mode`, `cron_mode`, `destructive_slash_confirm`, `mcp_reload_confirm`, `timeout`); `command_allowlist`; `hooks_auto_accept`; `delegation.subagent_auto_approve`; every `*.write_approval`; the `security`, `terminal`, `gateway`, `code_execution`, `dashboard` and `secrets` blocks; the chat-platform blocks; and any other key Hermes treats as policy. A fresh device gets Hermes's defaults for all of these.
- **Credential slots, everywhere:** in Hermes `config.yaml`, every `*api_key*`, `*password*`, `*secret*`, `session_key`, and any `*_token` or `*_key` holding a literal; in Codex, `mcp_servers.*.env`, `http_headers` and literal bearer or token fields; in JSON, any `env` or `headers` block. They are never in a projection: merges keep the device's values, `propose` never reads them, and apply never blanks them.
- **Household consents:** the doorbell LaunchAgent and the knock-tap hook lines. A template that contains an `is_tap` command is refused at publish.
- **Device state:** the launchd override DB; `~/.config/gh/hosts.yml` (which account is active); Summon's allowlist; agenttool identities and bearers; Collab session credentials.

### 5.8 Who sees what

| Party | Sees |
|---|---|
| Each device | The whole plaintext setup it applies. P2: the plaintext of the sealed blobs it is a recipient of (§5.5). A device with guidance and memory held gets no key for them. |
| GitHub, and readers of the private repo | The plaintext of every unsealed file, including device maps (user names, home paths, versions, checkout names, public keys); drift proposals (owned projections only) and status codes. Commit metadata: author and committer names and emails (Yu's usual ai-love.cc identity, by design, Q23) and the trailers (`Household-*` and the estate co-author line). For sealed entries, exactly the metadata in §5.5. A device's first proposal never reaches GitHub (§6.4). |
| Review sessions on the Air | The plaintext of the entries they open, which reaches that session's model provider. Sealed entries are opened only by Claude Code sessions, whose provider already loads this memory and guidance (§6.3 step 5). Unsealed entries may reach any harness's provider. |
| Collab journal (Air, local) | Proposal ids, entry ids, tree shas, gate results and the review rationale. Never file contents. |
| Anyone else | Nothing beyond the above. |

---

## 6. Flows

### 6.1 Hub edit → sign → publish

1. An Air agent works on a branch, in a worktree of `~/Projects/household-setup`. For a sealed entry, a Claude Code session runs `household open <entry>`, edits under `~/.local/state/household/work/`, then runs `household seal <entry>`.
2. `household check`: the gates of §5.6, a render dry-run for every enrolled device, `expected_fail`, the pins, and syntax (JSON, TOML, YAML, `plutil -lint`, `zsh -n`, `bash -n`).
3. If any steer entry or structural file changed, the agent commits the candidate on its branch, opens a Collab task (`household:<branch>`) that names the candidate's git tree sha, and completes it from that clean worktree, so Collab's `result_checkpoint` records the candidate commit. A distinct session reviews it with the checklist in §6.3 step 5 and accepts it. Sealed plaintext is reviewed only by Claude Code sessions (§6.3 step 5).
4. `household publish` then:
   - takes the lock;
   - rebases onto `origin/main` if it moved, and re-runs step 2. If the rebase changed the candidate tree outside the files `publish` writes itself, the acceptance no longer applies, and it stops for a new review;
   - checks the Collab binding for steer changes (§6.3 step 6);
   - writes `SIGNED-TREE` (seq + 1);
   - commits with trailers: `Household-Kind`, `Household-Tree`, `Household-Review: <collab task>` (for steer changes), `Household-Proposal` (when it came from a device), and the estate's co-author trailer;
   - pushes `main` with the Air's deploy key.

   A definite non-fast-forward rejection restarts from step 2 once. After an ambiguous push failure, it reads `git ls-remote` and never pushes blindly again.

   **A commit on `main` that the Air did not make.** `publish` classifies every commit it would rebase onto by its signature first, before any other check:
   - **Neither principal verifies: a foreign push.** `publish` stops and records a security event. Ai pushes the commit to `quarantine/<sha>`, confirms it with `git ls-remote`, then force-pushes `main` back to the last good commit with `--force-with-lease=main:<foreign sha>`, and tells Yu in one line, naming the deploy key that pushed it when GitHub's log shows it. This is a notice, not a question: it is undoable, and devices never applied the commit, so their walk still descends.
   - **The recovery principal verifies: a promotion.** It is never treated as foreign and never force-pushed. The Air demotes itself: `device.json` gets `role = "former-hub"`, which turns off every hub verb, capture and publish. It records a security event, and Ai tells Yu in one line that the Air saw a promotion to `<id>` and has stopped acting as hub. The Air applies nothing new until Yu runs `trust accept` there. Because it is now `revoked`, it then rejoins as a spoke through §6.4.
5. The Air applies the pushed commit itself (§6.2).

**Drift on the Air.** A live edit to a managed file on the Air holds that component as `pending_local` (§6.2 step 5); the Air never overwrites it. After 30 quiet minutes the tick runs `household capture` for it into a local `review/air-drift-<component>-<ts>` branch, which goes through steps 2–5 in its entry's class. The clearing rule of §6.3 step 7 applies on the hub too. `publish` refuses a commit that changes a component the Air itself holds, unless that commit resolves the Air's capture for it (§5.6 structural gate 10). So the hub never ships a component it is not running.

**Memory and guidance written live on the Air (P2).** Sessions write memory and guidance on the Air directly. The tick runs `household capture` for them at most 4 times a day, and each run does three things in order:
- **The fleet-read check first.** It lists the loaded LaunchAgents and harness processes whose working directory maps to a mapped project slug (`home` included) and that do not isolate memory. A slug with such a reader, or one the check cannot clear, goes to steer review instead of the fast path, and status names the loop. Slugs derived from reserved roots or recorded runner working directories are never captured (§7.3).
- **A merge, not a copy.** For each changed slug the three inputs are the Air's last applied version (base), its live slug (ours) and `main`'s current slug (theirs). If `main` is newer than what the Air applied, capture runs the §7.3 rules, writes the result back into the live tree with compare-and-swap, and only then seals it. If it cannot merge with confidence, or `main`'s slug changed without a matching resolved proposal, it leaves the fast path and goes to review with the "drops nothing" check.
- **Then the fast path:** gates, seal, sign and publish as data-class commits with no second check, because this is the Air's own writing. A scan hit holds only that slug and records the entry, line and rule in the ledger; the other slugs publish. Guidance drift is steer class, so it waits for review.

### 6.2 Device apply, with rollback

Run by the tick every 30 min, or by hand. One run, under the lock (§4.5):

1. **Recover.** If `journal.json` is unfinished: when its seq equals the seq in `applied.json`, the run had already committed, so finish the bookkeeping (the ledger line if missing, clear the marker) and discard the journal. Otherwise undo it with step 10's per-path rule. Either way, delete every temp path the journal lists, plus any `.household-tmp-*` in the directories it names.
2. **Fetch** `main` (which carries `decisions/`) and this device's own proposal branches into `repo.git` with the deploy key, under the timeouts of §4.5. If this fails, nothing changes, and status reads `stale since <t>`.
3. **Verify** the walk (§5.3). A security failure refuses the whole update, writes a `security_event` to the ledger, and keeps the current state. `unmapped` and `revoked` stop applying quietly.
4. **Gate on status, then on the tool.** Read `devices/<this id>.toml` at the tip.
   - **`joining`:** the run verifies and records status, and plans, stages and writes nothing (`held:joining`). Planning starts at the first commit whose map says `enrolled`. The hub publishes that only together with the signed decision on this device's initial proposal (§6.4). The Air's own map is `enrolled` from the root commit (§6.7).
   - **Tool:** if the tip's `tool/TOOL.toml` names a tool other than the running one, stage that `household.js` and its pinned Bun (from `packages.toml`, sha256-checked), and run `--selftest` with the new pair against the tip (parse its manifest, re-verify the walk). Then flip `~/.local/share/household/active` with one journaled atomic rename, and re-exec under the same lock. If the selftest fails or the runtime cannot be fetched, keep the old pair and plan only up to the newest walked commit whose `min_version` and schema the old tool meets (`held:tool`). Old tool and runtime directories are deleted only after a later run on the new pair succeeds, and the previous pair is always kept.
5. **Plan** each entry and tree file for this device: role, `when`, `requires`, then base, overlays and the device map. Compare three things: the wanted state, the live state and the last applied state. That is bytes and mode for files, and the owned projection for merge kinds. The result is one of:
   - **unchanged**;
   - **record**: never managed, and wanted equals live. It is recorded as applied, with no write;
   - **update** · **new** · **remove** (only paths `applied.json` lists, still unchanged since applied);
   - **local edit**: live differs from last applied (for merge kinds, in the projection; a change of mode alone counts);
   - **adopt**: never managed, and live differs from wanted. It goes ahead when the live bytes (the projection, for merge kinds) equal those of a proposal from this device that the hub has already resolved, or, on the hub, those in its own last signed commit. Its pre-adoption bytes go to `adopted/` in step 8. Otherwise it is treated as a local edit.

   Then:
   - A local edit holds its whole component, and its coupled group (§4.3), as `pending_local`. That edit is never overwritten.
   - A component whose planned fingerprint matches an entry in `regression.json` is held as `held:regression` (step 10).
   - A missing requirement holds the component as `needs:<what>`. A false `when` only skips that thing.
   - The device map's policy holds (`held`, `held_entries`) and the fleet fingerprint check (§7.7) apply.
   - Other components go ahead.
6. **Baseline:** run `household check --live`, the `post_check` of every planned component that is already present, and, where the sol component is present, `~/.config/sol/bin/sol doctor --no-tcc` (§7.5) with a 120 s timeout. Record every item by component and name, with its result (pass, warn, fail or skip). A doctor timeout aborts the run before any swap (`held:doctor_timeout`), releases the lock, and records no baseline.
7. **Stage** every target with its mode into `stage/<seq>/`, and syntax-check each one. Check free space first: at least 3× the payload plus a margin, or hold as `held:disk`.
8. **Back up and prepare.**
   - Back up the bytes and mode of every path to be touched into `rollback/<seq>/`. Check that each backup hashes to the live state seen in step 5. A mismatch holds that component as `pending_local` before anything is swapped.
   - Copy every adopt's pre-adoption bytes and mode into `adopted/<entry-id>/<sha256>` (0600, never pruned).
   - Write `journal.json`: its seq, and for every operation the path, the pre-image sha256, the sha256 this apply will write, and a `done` flag. Every temp path is listed before it is created.
   - In each target directory, create the temp file `.household-tmp-<seq>-<n>` with `O_EXCL` at its final mode, fill it, and flush it with `F_FULLFSYNC`, falling back to fsync where that is unsupported. Then fsync each directory. The journal and the backups get the same flush. When `stage/` is on the same device as a target, prepare may rename straight from it.

   The swap that follows is renames only.
9. **Mark** `applying`, then **swap**. The order: data files first, then libraries, then hooks, settings and entry points, then removals last. Each file goes in with `renamex_np(tmp, target, RENAME_SWAP)` (through `bun:ffi`). The displaced bytes, now at the temp path, are hashed: they are exactly what was live at that instant. Each operation's `done` flag is fsynced after it.
   - If the displaced bytes differ from the pre-image, something wrote the file since step 5. Swap back at once, undo that component's renames from this run, hold it as `pending_local`, and ledger `concurrent_local_edit` (paths and shas only). The quiet-drift proposal then picks the edit up. Other components keep their swap. Where `RENAME_SWAP` is unavailable (an unsupported filesystem), the tool re-hashes and then renames, and ledgers the small window that remains.
   - Merge kinds recompute the merge against the displaced bytes, up to 3 times. If it still fails, undo this run's renames for that component, leave its `applied.json` entries as they were, and hold it as `held:busy`.
   - The tool refuses a target or parent that is a symlink (except `link` entries), a target owned by another uid, and any path §5.6 denies.
10. **Post-check.** First, re-hash every swapped target. One that differs from the staged bytes was written by someone else after the swap, so its component is held and is not rolled back over the new write. Then run the step-6 checks again, and re-read the device-owned authority keys of each merged file; if any differs from the pre-rename read, ledger `merge_race` and show it in status.

    A check is identified by component and name. It is a **regression** if it fails now and either passed at baseline, or did not exist or could not run at baseline and is not in this device's `expected_fail`. The hub's render dry-run computes `expected_fail` from roles, `requires` and the device map (for example the Kingdom Loom check on every spoke, and the iTerm2 check where `iterm` is not applied), and `check` refuses a map whose list differs. When sol itself was absent at baseline, new doctor failures are attributed to `sol` and its coupled group. A doctor item that fails because of a recorded `needs:` prerequisite is not a regression. On regression:
    - **Scope.** If only component `post_check`s newly fail, roll back those components and their coupled groups. Otherwise roll back the whole swap.
    - **Undo by hash, path by path,** in reverse order. If live equals what this apply wrote, restore the pre-image by renaming it back from `rollback/<seq>/` after checking it against its journal sha. If live equals the pre-image, do nothing. Anything else is a concurrent edit: keep it, hold the component as `pending_local`, and ledger it. Merge kinds undo by inverse merge: they put back only the owned values from the backup into the current live file, through the same compare-and-swap. A concurrent edit is never `rollback_incomplete`; that code is kept for real I/O failure.
    - **Remember it per component.** For every rolled-back component whose bytes changed, `regression.json` records a fingerprint: the component and a sha256 over its planned target paths, modes and bytes. Step 5 holds a component whose planned fingerprint matches. The entry clears only when that component's planned bytes change (a hub revert or a fix), not when a newer seq arrives. Every other component goes ahead on the next run.
    - The ledger records `rolled_back` with the failing check names, and status shows each held component.
11. **MCP servers** (`harness-cli`), after the file swap has passed its post-check, never inside the `applying` window. The live state of a Claude user-scope server is the canonical JSON of `mcpServers.<name>` in `~/.claude.json`, read only; a failed parse is retried 3 times, then `mcp` is held. `claude mcp get/list` are never used (K21). If the live definition equals the wanted one, it is recorded. Otherwise:
    - the prior definition (or "absent") goes to `rollback/<seq>/mcp/<name>.json` (0600), and the journal lists each step;
    - the tool runs `claude mcp remove -s user <name>`, then `claude mcp add-json -s user <name> <json>`, calling `claude` by the absolute path in the device map, with the device's normal `HOME`, `PATH` and `XDG_*`, no stdin and a timeout;
    - it re-reads the key after each step. A failure or mismatch replays the inverse (remove, then re-add the saved definition) and holds only `mcp`.

    These effects sit outside the byte-identical rollback promise. Until this step is built and tested, `mcp` stays hub-only (R7).
12. **Commit and record.** Write `applied.json` to a temp file, fsync it, rename it into place, and fsync the directory. This one rename is the commit point. It carries the walk seq and commit, the trust in effect (§5.3), each component's applied commit, and the per-path hashes. Then delete the temp files (after the swap they hold the displaced bytes, which the backup also holds), append the ledger line, clear the `applying` marker and the journal, prune rollback directories to the last 5, and release the lock. Last, outside the lock, push the signed `status/<own id>`, best effort, with an overall timeout of about 60 s. A failure only leaves status stale.

### 6.3 Device propose → Air review → Collab second check → merge

1. **On the device.** The tick's drift step, or `household propose` (with `--note`), collects every entry whose live state differs from last applied, as `change`, `add` and `delete` records (§4.3 trees), each with its own base: the commit its component last applied. For merge kinds the payload is the owned projection only, never the file.
   - It skips every component and entry under a policy hold (the map's `held` and `held_entries`, and §7.7) and records only a count and reason code for them. A shared-user device proposes no `guidance` or `memory` unless Y2 allows that direction.
   - **Quiet** means the same live sha on two consecutive ticks, so an edit is proposed 30 to 60 minutes after it stops changing; or a manual `propose`.
   - Before pushing, it runs the denylist, the shape scan, the assignment scan, the authority refusal and the vendored doorman on the plaintext. Any hit stops it: nothing is pushed, the component is held as `pending_local:scan`, and the ledger and status name the entry, line and rule.
   - Sealed entries are encrypted as §5.5 says. It writes `proposal.json`, signs it, and pushes `proposals/<id>/<proposal-id>`.
   - `pending.json` (0600) maps each entry id to its live sha256, first-seen tick, proposal id and state (`waiting`, `proposed`, `accepted`, `rejected` or `superseded`), and each proposal id to its entries' proposed sha256s. No new proposal is made while the live sha equals one already in flight or rejected. A different later sha supersedes: the device closes the old branch with a `superseded` note and proposes again.
2. **On the Air.** `household inbox`, run by the hub tick or any session, fetches proposal and status branches, verifies their signatures, and writes `~/.local/state/household/inbox.json`: waiting proposal ids and ages, the Air's own held components and captures, devices whose status shows `held:regression`, and devices stale for more than 48 h (leaving out `revoked` ones). The owned `SessionStart#household` hook runs `household status --session-line`. It reads that file offline and, only when something waits, prints one context line into the session, for example `household: 2 proposal(s) waiting, oldest 3h; run household review <id>`. That puts the work in an agent's context. On spokes, and when nothing waits, it prints nothing. In Phase 1 nothing starts an agent automatically (R6). A statusline badge may show the same count, but nothing depends on it.
3. **Review.** `household review <proposal>` verifies the proposal signature; an invalid one quarantines the branch unreviewed. For each entry it renders what the device should have had at that entry's own base, and diffs that against the proposed bytes. An entry whose expected sha does not match that render is refused as `base_mismatch`. For plaintext entries whose component changed on the hub after their base, it does a three-way merge (base render, hub tip, proposal). Proposal content is shown only inside a fenced block labelled untrusted (§5.1). The reviewer agent then:
   - turns the diff into base or overlay changes on a `review/<proposal-id>` branch. Device-specific values go into `overlays/device/<id>/`, never into the base;
   - for sealed entries (a Claude Code session only), runs `household capture` first so the Air's unpublished lines are included, decrypts into `work/`, does a three-way merge against the last signed version (§7.3), and re-seals. It also writes a structural report per memory entry into `work/` only: line keys kept, added and dropped, link targets on each side, and the sha256 of the merged plaintext;
   - handles an accepted `add` as a separate hub-authored change (§6.1) that adds the entry. The proposal-derived commit itself never touches structural files;
   - runs `household check`.

   A `device-map` proposal (from `household inventory`) may change only the inventory fields of its own `devices/<id>.toml`: `brew_prefix`, `claude_path`, `[harness]`, `[checkouts]`, `[fleet]`, and additions to `reserved`, `held` and `held_entries`. Clearing a hold follows §4.3's widening rule.
4. **The reviewer** commits the candidate on `review/<proposal-id>`, opens a Collab task naming the proposal id, the candidate tree sha and the gate results, and completes it from that clean worktree, so Collab's `result_checkpoint` records the candidate commit. File contents never enter Collab.
5. **Second check.** A distinct Collab session reads the candidate in the checkout and accepts or challenges it.
   - **Which harness.** A proposal with any sealed entry is reviewed and second-checked only by Claude Code sessions on the Air, the harness that already loads this memory and guidance. `household open` refuses unless `CLAUDECODE` is set, which guards agents that follow the process. A steer proposal from a device with a §7.7 hold must be second-checked by a different harness from the reviewer's. Such a device never proposes sealed entries (step 1), so these two rules never meet. Otherwise a different harness is preferred where one is available. The reviewer and checker state their harness in their Collab reports.
   - **The checklist:**
     - every changed path is a manifest entry of the right kind and class, and the diff stays inside the entries the proposal names (step 6);
     - no authority key, credential slot, permission-event hook or consent-bypass key was added (§5.7);
     - the recovery principal and the recipients are unchanged, or the change is a named recovery rotation;
     - the scans are clean, every identifier and wake-and-persona warning has been acknowledged, and no skill that drives a loop ships to a spoke (§7.2);
     - nothing changes a held entry on a shared-user device;
     - the render dry-run is clean for every device;
     - every steer diff has been read in full, and every change to a Codex hook entry or its position is flagged (§4.6);
     - memory merges drop nothing from either side unless the drop is deliberate and named; for sealed entries this is checked against the structural report;
     - nothing touches a reserved root, a launchd plist outside `air-role/`, a cron enablement or a REST file.

   Collab's self-review ban makes the reviewer and the checker distinct sessions. That is all it proves.
6. **Merge.** `household publish --review <task>` opens the Air's Collab journal (`AGENTOOL_COLLAB_DB`, or `~/.local/share/agenttool/collab.sqlite`) through a read-only SQLite connection, after checking its schema version. It never goes through MCP, never takes a session credential and never runs Collab's migrations. It requires all of these: the task is accepted; `accepted_by_session_id` is not the reporter's session; and the tree of `result_checkpoint.head_sha` equals the candidate tree. A missing journal, an unknown schema or any mismatch refuses the publish, with a ledger event. It then recomputes the candidate's diff against `main`, and refuses one that touches anything other than the base or overlay sources of the entries named in the signed `proposal.json`, `overlays/device/<id>/` and `decisions/<proposal-id>.json`, or that touches any structural file. It writes the accepted change as **one new signed commit** on `main`, never merging the proposal commit. It adds `decisions/<proposal-id>.json` (an enum code where §5.5 requires one) and deletes the proposal branch.
7. **Back on the device.** An accepted decision, as-is or merged, resolves every entry whose live sha equals that proposal's proposed sha. Apply treats it as an ordinary update (§6.2 step 8's backup already holds the live bytes), so the merged target, `<name>.from-<device>.md` included, replaces it without a second proposal, and `pending_local` clears. If the live sha changed after proposing, the entry stays a local edit. **If rejected**, the decision says why (a code). The device keeps its edit marked `rejected` and makes no new proposal for that sha. After 14 days it moves the edit to `~/.local/state/household/rejected/<proposal-id>/` and applies the hub version. That step is reversible.

### 6.4 Joining a device (the ceremony)

Modelled on Summon Phase 0, which worked on Nuance on 10-12.

1. **On the Air** (Ai prepares). `household enroll-prepare nuance` refuses while status shows `kit not stored` (§6.6). It publishes a signed commit adding `devices/nuance.toml` with `status = "joining"` and the reply fields empty. It then writes `~/household-join-nuance-<expiry>/`, which expires in 7 days and contains:
   - `join.sh`;
   - the pinned Bun and `household.js`;
   - `allowed_signers` (the starting anchor) and `known_hosts.github`;
   - the repo URL, and the starting commit sha: the commit that adds this map;
   - that commit's `manifest.toml` and the §5.5 sealed-set paths, so the snapshot knows its targets;
   - the vendored doorman;
   - the Air's git `user.name` and `user.email`, as the default for this device's identity file, which never goes in the repo;
   - `MANIFEST.txt`, with the sha256 of every file.

   Yu AirDrops the folder to the device. If the bundle expires unused, `household revoke nuance` removes the joining map.
2. **At the device** (Yu's hands). Yu runs `bash ~/Downloads/household-join-nuance-<expiry>/join.sh` in Terminal. The adversarial review and `MANIFEST.txt` stand in for reading the script. It first refuses if the bundle has expired, if any sha256 mismatches, if it is run as root, or if the Command Line Tools (git) are missing; in that last case it prints the one `xcode-select --install` line. It prints a three-line banner: what it reads, what it installs, and that it sends, loads and wakes nothing unless Yu answers `y` below. It then:
   - **inventories, read-only:** macOS version, arch, user, `brew --prefix`, harness versions and logins (yes or no only), the `claude` path, which checkouts exist (in Terminal, which has its own TCC grants), whether sol exists, the fleet-read check, and the citizen roots (both §7.7). Citizen roots are recorded as `reserved`, and nothing under them is ever written;
   - **snapshots** every existing target of the bundled manifest, and the sealed-set paths, into `~/.local/state/household/join-snapshot-<ts>.tar` (0600). Nothing on the device is overwritten before review;
   - **writes** `~/.config/git/identity` (0600), only if it is absent, from the device's own inline git `[user]` if it has one, otherwise from the bundle default;
   - **generates** the deploy key and, from P2 and only where guidance or memory may apply (§5.5), the age identity;
   - **installs** the launcher, the tool, the runtime, the anchor and `device.json` (`role = "spoke"`);
   - **asks once:** "Send this Mac's setup to the Air for review (now by AirDrop, later changes through the private GitHub repo), then apply what the Air approves and keep it updated every 30 minutes? [y/N]". In P2 it adds "(memory and personal guidance sealed)". On `y` it runs `household propose --initial --out <bundle folder>` and `household autoapply on`. macOS then shows "Background Items Added", which should stay allowed;
   - **writes** `household-reply-nuance.tar` into the bundle folder. It holds `reply.txt` (id, user, home, arch, brew prefix, `claude` path, versions, checkouts, the fleet-read result and fingerprint, reserved roots, the deploy public key, the age recipient if any, and the snapshot sha256; no secrets, and it is scanned) and, on `y`, the initial proposal, which has passed every device-side gate of §6.3 step 1 and skips what the fleet-read check holds.

   Yu AirDrops that one file back. That is all Yu does.
3. **On the Air.** `household enroll nuance --reply <file>` verifies the reply, fills in the map's reply fields in a signed commit (`status` stays `joining`), and adds the deploy key to the repo with `sol access run github -- …` as `cambridgetcg`.
4. **The Air** reviews the initial proposal locally, from the AirDrop copy, like any proposal (§6.3 steps 3–6). Rejected content never leaves the two Macs. It puts the real device differences into `overlays/device/nuance/` and publishes the decision together with `status = "enrolled"`. While the map says `joining`, the device's tick only verifies and records status (§6.2 step 4). After `enrolled`, its next tick applies (§6.2), and its later drift goes through proposal branches. Ai tells Yu in one line that it is done. If Yu answered `N`, nothing runs by itself, and `propose --initial --out` and `apply` can be run by hand later.
5. **Hands-steps:**
   - Where Codex is installed, approve its hooks once in its TUI. This is needed whenever Codex is there, and again only if a Codex hook entry later changes (§4.6).
   - The doorbell and the knock-tap stay off unless Yu asks for them (§12.2). The ceremony prints no consent commands.

### 6.5 Leaving or revoking a device

- **Revoke** (on the Air, always possible, never delayed): `household revoke <id>` first deletes the device's deploy key from the repo, then sets `status = "revoked"`, re-seals in P2 without that device, and signs and publishes. A device that still runs can no longer fetch (`auth_refused`), so it applies nothing new. The Air shows it as `revoked`, never as stale, and leaves it out of the 48-hour warning. It keeps what it already has (§5.5 limits).
- **Leave** (at the device, Yu-only, when it is in hand): `household leave` takes the lock and refuses while `journal.json` is unfinished, unless it first completes that rollback. It calls `autoapply off`, which unloads the LaunchAgent and removes `~/Library/LaunchAgents/dev.household.*.plist`, so nothing loads again at login. It then deletes the tool, runtime, deploy key, age identity and anchor. `~/.local/state/household/` stays, with the journal, rollback directories, `adopted/` and the snapshot. Applied files stay as they are, because they are the device's setup now. `--restore-snapshot` puts back the join snapshot plus `adopted/` instead, after showing what it would change.
- **Rewriting GitHub history** after a lost device is a separate, irreversible step. It is Yu's choice at the time (§12.2).

### 6.6 Recovery when the Air is lost

1. **If the Air may be stolen**, Yu first runs §5.2's compromise steps.
2. Yu picks the new hub: an enrolled device, or a new Mac that has joined. With the recovery kit at hand, Yu runs `household recover --promote <id>` on it (Yu-only, §4.5). It reads the kit only from an interactive prompt (typed, or pasted from a QR scan), rebuilds the key in a 0600 temp file, and refuses before any change unless the derived public key equals the `recovery` line in effect. It then:
   - makes a new hub key there;
   - writes a new `trust/allowed_signers`: the new hub, plus the same recovery line (step 5 replaces it if the kit's custody is in doubt);
   - marks the old Air `revoked` and the promoted device `role = "hub"`;
   - signs that commit with the **recovery** key only, and pushes it with the device's deploy key. The commit changes nothing outside `trust/allowed_signers`, `devices/` and `SIGNED-TREE*` (§5.3);
   - after Yu's `y`, replaces `dev.household.apply` with `dev.household.hub` through the `autoapply` path.
3. **Every other device** holds that commit (§5.3) and writes `recovery_pending`. Its status shows only "trust rotation pending: Yu's hands-step", never the fingerprint. At each device Yu runs `household trust accept`. It shows the held commit's seq and sha, the diff of `devices/`, and the trust change as "1 hub line replaced" without the key. It then asks Yu to type the fingerprint he reads off the new hub's screen, and compares it with the held commit's new key. A match records the acceptance for that exact commit in local state (§5.3). A mismatch refuses and is ledgered. Until then the device applies nothing new.
4. **On the new hub**, in P2, a normal hub-signed commit under the accepted trust, with the usual gates and second check, re-encrypts every blob without the old Air's recipient and updates `trust/recipients.toml`. The promoted device decrypts with its own identity. The recovery identity is needed only if no device survives.
5. The recovery key's temp file is deleted from the new hub. If the kit's custody is in doubt (it was on the lost Air, or it might have been copied), the new hub makes a new kit, and a commit co-signed by the current recovery key and the hub replaces the recovery line (§5.3). The kit goes back to its drawer.

A leaked kit alone therefore cannot take over any device: it also needs push access and Yu's typed fingerprint at each device. That is a consent gate against well-meaning agents (§4.5). Software that deliberately evades it is §5.1's limit.

**The kit's life.**
- `household init-hub` (§6.7), or `household kit` later, makes the recovery signing key on the Air, in `~/.local/state/household/recovery-kit/`, which is 0700 and excluded from Time Machine when it is created. No household verb ever writes key material to stdout or the ledger, and no agent reads or displays the kit files. Status and the ledger show fingerprints only.
- **Page 1** holds the 32-byte ed25519 seed of the recovery signing key in short checksummed groups, the SHA256 fingerprint of the `recovery` line, and a QR code of the same text. P2 adds **page 2**: the age recovery identity (checksummed bech32, `AGE-SECRET-KEY-1…`) and its QR code, made the same way when P2 starts.
- `household kit verify` runs the same import path as `recover` on the printable file, decoding both the text and the QR code. It signs a test payload under namespace `household-kit-check@v1` and verifies it as `recovery` under the trust in effect. For page 2 it decrypts a test blob. Optionally, Yu can scan the printed QR once into the same prompt, which proves that the print itself is readable.
- Yu opens the printable page himself, prints it, and tells Ai it is stored (Y1). Ai deletes the kit's private files from the Air only after `kit verify` has passed and Yu has said so. Until then, `household status` on the Air shows `kit not stored`, and `enroll-prepare` refuses. So the kit is stored before any recovery line reaches a spoke.
- Regenerating the kit is cheap while the Air is alive: a commit co-signed by the current recovery key (read in from the old kit through the same prompt as `recover`) and the hub replaces the line. If the Air is lost while the kit is still only on the Air, recovery is lost with it, and each device needs a new ceremony.

### 6.7 Starting the hub (once)

`household init-hub` is a one-shot verb on the Air. It refuses if `~/.config/household/`, `~/.ssh/household/hub_signing_ed25519` or a non-empty remote `main` already exists, so it can never re-root a live household. In order:

1. **Air prep, in Terminal, before `init-hub`:** run `sol doctor` once and record every failing item with its cause; this is the Air's baseline (K17). Move the Air's inline git `[user]` into `~/.config/git/identity` (0600, written atomically, values never printed), and replace it in `~/.gitconfig` with `[include] path = ~/.config/git/identity`.
2. Make the hub key (§5.2, with `tmutil addexclusion`), the recovery key and its kit (§6.6), and the Air's deploy key.
3. Write the Air's starting anchor from the public keys it just made (trusted on first use, from local generation), `device.json` (`role = "hub"`), the launcher, and the pinned Bun, checked against the sha256 it records in `packages.toml`.
4. Create the private repo and register the deploy key with `sol access run github` as `cambridgetcg` (R2). It pushes only after that.
5. Make the **root commit**, hub-signed: `SIGNED-TREE` at seq 0 with `parent = none`, `trust/allowed_signers`, a skeleton manifest, and `devices/air.toml` (`role = "hub"`, `status = "enrolled"`). The Air's `applied.json` starts at the root commit.
6. Write `hub-snapshot-<ts>.tar` (0600) of every target the adoption commit will manage. It is the Air's join snapshot.
7. `household capture` makes the **adoption commit** (seq 1) from the Air's live bytes, with every `is_tap` entry and every §5.7 key and credential slot left out. It goes through §6.1 like any steer change. On the Air's first apply, the wanted state equals the live state, so every entry is `record` (§6.2 step 5) and nothing is written.

`autoapply on` stays a separate `y` from Yu.

---

## 7. Device mapping

### 7.1 Render variables

`render` entries, and the owned values of merge kinds, substitute these. `copy`, `pinned`, `air-role`, `link` and `source-pin` never render.

| Variable | Value | Notes |
|---|---|---|
| `{{HOME}}` | `devices/<id>.toml` `home` | Used only where a literal path is required: the hooks in `settings.json` and `hooks.json`, `.gitconfig`, plists, `runtimes.json`, Hermes skills. Everywhere the runtime expands `~`, `$HOME` or `Path.home()`, the source is fixed once on the Air instead (`access.py` `DEVICE_HOME`, the sol-agent SKILL.md files, `heartbeat.py` lines 16–17, `catalog.json`). Hermes skills are rendered because it is not known whether their paths are executed. |
| `{{USER}}`, `{{KEYCHAIN_ACCOUNT}}` | device map | sol's `bin/sol` keychain lookups change at the source on the Air: they read `keychain_account` from `~/.config/household/device.json` and fall back to `$USER`, replacing the literal `${USER:-yuai}`. (`wake.sh` has the same lookup, but it never travels, per Q15.) Keychain items are made per device and never copied. |
| `{{BREW}}` | device map `brew_prefix` | Rendering refuses when it is empty, and the component is held as `needs:homebrew`. |
| `{{DEVICE_ID}}`, `{{ROLE}}` | device map | For status lines. Skills are kept off spokes by `roles` (§7.2), not by a variable. |
| `{{checkout.<name>}}` | device map `checkouts` | Allowed only inside a matching `when = "checkout.<name>"` (§4.3). A false `when` skips that pointer or entry (`skipped:no-checkout`), and the rest of the component applies. Hooks keep their `[ -x … ] … \|\| true` guards for a checkout that exists but lacks the script. Pin-backed checkouts are handled by §7.5. |

### 7.2 Ownership in merged files

| File | The household owns | The device keeps |
|---|---|---|
| `~/.claude/settings.json` | statusLine, the two pp hooks, the kingdom-wake hook (`when = "checkout.chillspace-commons"`), the household SessionStart hook, `enabledPlugins` and `extraKnownMarketplaces` (the record of plugin intent; Claude's own start-up sync is expected to install from it, K21), theme | Permission and autoMode keys, any `env` block, the knock-tap entry at its position, anything Claude writes |
| `~/.claude.json` | Nothing in the file. User-scope MCP servers (agenttool-collab, -telescope, -browser over stdio with empty env; agenttool over http) go through §6.2 step 11. | Everything |
| `~/.codex/config.toml` | model, provider, reviewer, web_search, `allow_login_shell`, service_tier, `mcp_oauth_credentials_store = "keyring"`, the shell_environment_policy core (with the exact lines sol-doctor greps), features, `model_providers.sakana` (the env_key name only), in each of the 5 `mcp_servers` only `url`, `command`, `args`, `enabled_tools` and `read_only`, `plugins.*.enabled`, and in `[marketplaces.chillspace-commons]` only `source_type` and `source` (`when = "checkout.chillspace-commons"`). Seed: `approval_policy = "on-request"` when absent (§5.7). | notify, node_repl, computer-use, `shell_environment_policy.set`, tui/desktop, `apps.connector_*`, `[projects.*]`, `[hooks.state.*]`, approve grants, `approval_policy` once present, `sandbox_*`, the marketplace's `last_updated`, and in `mcp_servers` every `*approval_mode`, `env`, `http_headers` and bearer field. File mode 600. |
| `~/.codex/hooks.json` (merge-json) | The 3 hand-written hooks, owned by command match: `/hooks/SessionStart#kingdom-wake` (`when = "checkout.chillspace-commons"`), `/hooks/UserPromptSubmit#pp-detect` and `/hooks/Stop#pp-stop-verify`, with `{{HOME}}` rendered inside owned values only. Existing entries keep their array index, and a new household hook is appended. | The knock-tap entry at its index (`is_tap`: never owned, captured or proposed). Each device trusts changed hooks in the TUI (§4.6). |
| `~/.hermes/config.yaml` (merge-yaml) | An explicit allowlist named in the manifest: `model`, provider names without keys, `toolsets` and `platform_toolsets`, `skills` apart from `write_approval` and `external_dirs`, `display`, `compression`, `context` (with `context_length` per R19), `curator` (spokes get `enabled: false` from `overlays/role-spoke/`), `tool_output`, `tool_loop_guardrails`, and similar non-authority settings. | Everything else: the §5.7 Hermes list, every credential slot, `onboarding.*` (latches Hermes writes itself), `_config_version` (only checked against the harness pin), and any key not on the list. A fresh device gets Hermes's defaults. |

**Skills on spokes.** A skill directory whose text contains `launchctl load`, `bootstrap`, `enable` or `kickstart`, embeds `<key>Label</key>` or `RunAtLoad`, or names a label that `launchd/registry.toml` marks `air-only` or `never`, gets `roles = ["hub"]` as a whole: its SKILL.md and its references together. It is stored in the adoption commit, so the only copy is safe, but it is applied only on the Air. On the Air today that covers `soul-bridge` (including `references/ollama-anthropic-bridge.md`), `kap-hxh-pipeline` and `nen-artifacts` (K24). Lifting a skill's hold is one reviewed commit. Rewriting the Sophia mentions is a separate source cleanup (D12).

### 7.3 Memory keys and slugs (Phase 2)

- The repo stores memory per **logical project id** (`sealed/memory/<logical-id>…`). `projects.toml` maps each id to a `~`-relative path, for example `home = "~"` and `agenttool = "~/Projects/agenttool"`. A **moved** project is written `id = { path = "<current location>", aliases = ["<old Air slug>"] }`: on the Air, capture reads the alias directory, and other devices write the computed slug. Today cardforum, soma and love-unlimited have moved, and legible-money and `~/Love` are gone (K25).
- **Slug rule:** take the checkout path exactly as recorded at the ceremony or inventory, `{{HOME}}/<rel>`, and turn every character outside `[A-Za-z0-9-]` into `-`. So `/Users/macair` becomes `-Users-macair`. Case does not matter, because `~/.claude/projects` is on case-insensitive APFS: `Zerone` and `zerone` name the same directory (K25).
- `projects.toml` refuses paths with characters outside `[A-Za-z0-9._/-]`, so the cases where Claude's rule is unknown (spaces, unicode) never come up. It also refuses any path under a `reserved.toml` root or a recorded runner working directory (§7.7), and capture never reads those slugs.
- The `home` id always applies. Any other id applies only where its checkout exists.
- A slug directory whose path no longer exists anywhere is not mapped. It stays on the Air only and is listed as `unmapped` in status. If an id's alias directory and its computed-slug directory both hold memory, capture holds that id as `duplicate-slug`. Nothing is moved or merged automatically; consolidation is a later attended step, under a snapshot. Empty memory directories are skipped.
- Worktrees: only canonical checkout paths are mapped, because it is not known whether Claude keys memory by cwd or by repo root. Any other slug directory with memory is reported as `unmapped` and never moved.
- **Merging** (on the Air, in plaintext, by Claude Code sessions only):
  - **Memory files:** a three-way merge per file, against the last signed version. When the reviewer cannot merge with confidence, both are kept: the Air's at the name, the device's as `<name>.from-<device>.md`, both listed in the index.
  - **`MEMORY.md`:** merged line by line, keyed by the file each line links to. Entries from both sides are joined. For a file both sides changed, the side whose memory file changed wins. Deletions count only when they were proposed. The Air's order is kept, and new lines are appended. Frontmatter fills a line only when an index entry is missing, because rebuilding from frontmatter alone would lose the hand-written index text.
- **Memory prose is never rewritten.** It keeps 15 `/Users/yuai` mentions, the `/Users/macair` and `/Users/yournameisai` layouts, and 104 `originSessionId` values that point at transcripts held only on the Air. These are history.
- **Codex `memories_1.sqlite`** (0 rows) is out of scope.

### 7.4 Homebrew prefix

`brew --prefix` is read at the ceremony. Nuance is arm64 (K2), so it is `/opt/homebrew` if Homebrew is installed at all. Rendered files use `{{BREW}}`: the kingdom profile, collab host and MCP paths, the gh credential helper, and Python shebangs in rendered entries.

The copied and pinned sol files (`bin/sol`, `sol-doctor`, `bin/kingdom`, `bin/sol-access`, `modules/*.zsh`) keep the literal `/opt/homebrew` (K22) until a signed source fix on the Air, with the crosswalk and pin refresh, makes them prefix-neutral (D11). That fix is needed before any device with another prefix joins (P3). So `sol` requires `brew_prefix=/opt/homebrew` and the commands jq, fd, python3 and node, and `household check` fails when a `copy` or `pinned` entry that contains `/opt/homebrew` belongs to a component that does not require that prefix.

`packages.toml` splits into **common** (only what managed components need: for example jq, fd, git where the CLT's is too old, node@24, the npm pins `@agenttool/collab` 0.5.0 from its GitHub Release tarball with its sha256, `telescope` 0.2.3 and `browser` 0.6.0) and **per device**. Bun and age are the tool's own runtime (§4.5, §5.5) and are not packages. Casks are not managed. Apply never installs anything, plugins included, so a missing package holds its component until an attended `household packages install`, and a missing plugin holds its dependants as `needs:plugin:<name>`.

### 7.5 Byte-pinned files are fixed at the source

Pinned files are never rendered. Each one is made path-neutral and device-aware **on the Air, at its source, in a signed commit that also carries the pin refresh**. `sol-doctor` pins itself, so all of its fixes land in one commit.

| File | Fix |
|---|---|
| `sol-doctor` line 643, which asserts the kingdom-court Command literal | Make the assertion build the expected Command from `$HOME` at run time, so the same pinned bytes pass on every device. |
| `sol-doctor`, the XENIA check | Pass when the three pinned xenia files are byte-identical to the crosswalk and the recorded `source_commit` exists and is an ancestor of HEAD. An ordinary pull or branch switch then stays green, and a changed pinned file still fails. Today the check fails on HEAD equality alone (K17). |
| `sol-doctor`, non-interactive mode | `--no-tcc`, passed only by household's tick, skips only the artifacts under `~/Desktop`, `~/Documents`, `~/Downloads` and iCloud Drive (fixed roots, never taken from the caller) and prints them as SKIP. The crosswalk still verifies its other 14 artifacts, and sol-repos drops those roots for the Atlas check. Household compares only pass and fail. A skip is ledgered as `unverified_tcc`, shown in status, and covered by the full doctor at the next attended apply. |
| `sol-doctor`, device awareness | Pin checks for a checkout or a hub-only skill that `~/.config/household/device.json` marks absent report `absent-by-device`, neither pass nor fail. On the hub, whose `device.json` lists its checkouts, a missing checkout stays a FAIL. A present checkout with different bytes stays a FAIL everywhere. |
| `HOME.md` line 39 (and `~/AGENTS.md` line 19 in P2) | Replace the stale `~/.Codex/projects` with `~/.claude/projects`. |
| `agenttool-xenia-observe` shebang | Make it `$HOME`-independent, then refresh the crosswalk sha. |
| XENIA crosswalk JSON | Refreshed in the same commit as any pinned sol file it covers. |
| `weave-kingdom-quests` (6 `/Users/yuai` paths, pinned by `sol kingdom`) | Not fixed here. It and `sol kingdom` stay `roles = ["hub"]` until an upstream `$HOME` fix lands together with a pin re-review. |
| `runtimes.json` | The template keeps only definitions: id, name, kind, `executable` as `{{HOME}}/…`, `native_python`, modes, prompt transport, context and skill paths, entrypoints, relationships. The observed fields (`version`, `resolved_executable`, `observed_at`, `evidence`, `limitations`) are device state and never shared. The codex-fugu (Q30) and ollama (retired 10-10) records are removed. |
| `catalog.json` | Rewrite its 8 `/Users/yuai` paths as `~/` (catalog.py expands them), and drop the 7 stale roots, every version-pinned plugin-cache root and the account-keyed synced root. It becomes a `copy` entry. |

External checkouts that pins cover (chillspace-commons: kingdom-wake and the 4 loom files; xenia: 3 files and the source commit; `weave-kingdom-quests`, hub-only) are not `requires` of the `sol` component. They gate only the features that use them (`sol kingdom`, the arrival hook), through `when` and the doctor's device awareness. On a device where sol is installed and such a check still fails, that failure is part of its baseline (§6.2 step 6) or its `expected_fail`, never a reason to hold all of sol.

### 7.6 Checkouts and macOS privacy (TCC)

The LaunchAgent never opens anything under `~/Desktop`, `~/Documents`, `~/Downloads` or iCloud Drive, because a privacy prompt would stall it with nobody there. sol doctor runs from it only with `--no-tcc` (§7.5). Checkouts in those places (chillspace-commons, here-with-you, the stale `~/Desktop/true-love`) are recorded at the ceremony, which runs in Terminal and has its own grants. Rendering then uses the recorded values. Changing them takes `household inventory --attended` (§7.7).

### 7.7 Shared-user devices: the fleet-read check

On Nuance the citizen fleet runs as `macair` (K2), and a REST-ignoring walker is presumed to run there (K23). Anything applied at user level would reach citizens' processes too, unless their loops isolate it.

**Readers.** At the ceremony and at every `household inventory`, the inventory lists, read-only:
- every LaunchAgent plist file in `~/Library/LaunchAgents`, and the labels loaded in `gui/<uid>` (attended runs only; `launchctl print` is read-only);
- `crontab -l`, Hermes jobs and the gateway, login items, and a `ps` snapshot of harness processes and their parent chains;
- usage evidence: slug directories under `~/.claude/projects`, and the Codex and Hermes session directories, for paths under citizen roots.

A loop counts as a **reader** if it is loaded or could start (`RunAtLoad`, `StartInterval`, `KeepAlive`, not disabled) and runs a harness, a fleet script, zsh or git, **whatever its REST state**. REST is honoured by citizen code, not enforced, and unread mail wakes a citizen at any time (K23). A wrapper such as `love.citizen-fleet` (`citizen-fleet.sh`) counts as a reader unless every harness call it makes is shown to pass isolated config: `--setting-sources=`, `--strict-mcp-config`, `--ignore-user-config`, its own Hermes home, `zsh -f`, its own `GIT_CONFIG_GLOBAL`. A harness process or a citizen-path transcript that cannot be explained makes the result `found`, and anything unknown makes it `unknown`, which counts the same. Walker B (K23) is a standing reader on Nuance until it is located and isolated, or stopped at Yu's word. `household` itself never stops, disables or edits it.

**What a reader holds.** A harness reader holds `claude`, `codex`, `hermes`, `mcp`, `guidance` and `memory` (the map's `held`). A reader that runs zsh or git also holds the `reach = "process"` entries (`held_entries`): `~/.zshenv`, `~/.gitconfig` and the doorman hooks. Everything else in `shell`, `git` and `sol` still applies; in that case sol core is sourced only from `.zprofile` and `.zshrc`, which non-interactive scripts do not read. These holds stay **whatever Yu answers**: shared parts are applied for a being only through the citizens design, once that being has its own home or macOS user and has opted in itself (§4.7). Y2 asks Yu only about his own memory and guidance. A held sealed component also means the device gets no age identity and is no recipient (§5.5).

**Citizen roots.** A directory under `~` is a citizen root if it is a git work tree whose `origin` is one of the citizen repos (the plan takes the name list from the 208-repo record), if it holds `REST` or `EVENT-ONLY` at its root, or if it is the fleet tool repo (`love-unlimited`) or the parent directory it clones citizens into. Every match is recorded in `reserved` whatever its REST state, and it stays reserved after a later inventory finds its REST file gone. When the inventory cannot tell, the directory is reserved. On the Air, `reserved.toml` is built by the same rules before adoption. The citizens design adds per-being Hermes homes and runner working directories through the §4.7 seam.

**Between inventories.** The inventory records a fleet fingerprint in the device map: the sorted LaunchAgent labels and the sha256 of each plist file, the crontab, and the list of Hermes homes and profiles. Every apply re-reads those files (local hashing, no `launchctl`). On any difference, or any input it cannot read, apply holds `claude`, `codex`, `hermes`, `mcp`, `guidance`, `memory` and the `reach = "process"` entries as `needs:reinventory`, and shows it in status. It never un-applies what is already there. A matching fingerprint does not mean the device is safe, only that nothing new has been seen.

**Re-inventory.** `household inventory` reruns the join's read-only probes (brew prefix, harness versions, the `claude` path, checkouts, the fleet-read check, citizen roots) without making keys or a snapshot. It emits a signed `device-map` proposal only when something changed (§6.3 step 3). The tick may run the parts that touch no TCC-protected folder and need no `launchctl`, at most once a day. Probing TCC checkouts and running `launchctl print` happen only with `--attended`, in Terminal. A hold is lifted only by a reviewed device-map proposal that shows no reader, or by the decision records of §4.3, never automatically. `household status` shows the result.

**On the Air.** The Air's sessions are Ai's. Its memory capture runs the same reader check for memory slugs (§6.1).

---

## 8. Never shared

The tool carries this list in machine-readable form; the §5.6 denylist is built from it, and this table is rendered from it.

| Group | Paths and names (no values) | Kept out by |
|---|---|---|
| **Logins and secrets** | Keychain: `Claude Code-credentials`, `Codex MCP Credentials`, gh, github.com and codeberg.org items, every `agenttool-*` item (including the 10 `agenttool-sol-*` identity items), `kingdom-treasury-mnemonic`, `kingdom-x402-payer-mnemonic`, provider tokens (`openrouter.ai`, `resend-cli`, `radicle`, `Supabase CLI`, `fly_agenttool`, `just-talk-anthropic`, `seigei.ai-love.cc`, `counterseal-telegram-*`), Safe Storage items, and the old `login_renamed_1.keychain-db`. Harness files: `~/.codex/auth.json`, `~/.codex/.env`, `~/.codex/.codex-global-state.json`, the Codex shell-snapshot quarantine, `~/.hermes/auth.json`, `~/.hermes/.env`, `~/.hermes/shell-hooks-allowlist.json`, `~/.config/claude-code-proxy/codex/auth.json`, `~/.gemini/oauth_creds.json`, `~/.claude/sessions/*.key`, `~/.claude/file-history/`. Plaintext identities: `~/.config/agenttool/agent.json`, `~/.git-credentials`, `~/.config/git/identity`, `~/.openclaw-alpha/`, collab session tokens, `~/.zeroned/localnet/val0-3/`, `~/.local/state/ollama-retired-20261010/`, the PEM files and tokens in `~/.cache/sol/workspaces/`. CLI stores: `~/.aws`, `~/.fly`, `~/.wrangler`, Vercel `auth.json`, Hugging Face tokens, `~/.grok/auth.json`, `~/.vibe/.env`, `~/.radicle/keys`, every `~/.ssh` key (including the passphrase-less summon key). App profiles: Codex Cookies and Login Data, `HTTPStorages/com.openai.*`. Broker metadata: `~/.config/agentcred/`, `~/.config/kingdom/*.json`. | Files: the allowlist, the tool denylist, the shape and assignment scans, the doorman. Keychain items are never files the tool reads. |
| **Device identity** | `~/.claude.json` and its 5 backups (oauthAccount, userID, machineID, first prompts, project keys), `~/.claude/device_id`, `~/.codex/installation_id`, the remote-control and CUAService ids, `~/.gemini/google_accounts.json`, account-keyed `skills/synced`, `plugins/synced`, `cache/model-catalog`, `apps.connector_<id>` | Never in the manifest; the denylist; the identifier scan |
| **Trust and standing authority** | Everything in §5.7 | Device-owned keys; the authority refusal on the device and at `publish` |
| **App- and installer-owned records** | The Codex app blocks (§7.2), `installed_plugins.json`, `known_marketplaces.json`, the Chrome native-host manifest, `~/.local/bin` symlinks that are not manifest entries (for example the `claude-code-proxy` link) and the Hermes shim, Hermes `.bundled_manifest`, `.usage.json`, `.curator_state`, `.archive`, `.curator_backups`, `onboarding.*`, jobs.json runtime fields, sol `home/STILL`, `home/GROK.json`, `agents/.backup-*`, `~/.local/state/sol`, Summon pairing state | Merges keep them; outside every projection; never captured |
| **Transcripts, logs, caches, binaries** | Claude `projects/*.jsonl` and session dirs, history, shell-snapshots, paste-cache, session-env, tasks, telemetry, cache, plans, feedback, `tool-results`, MCP logs, `~/.local/state/claude-code-proxy`, CLI binaries. Codex sessions, history, `thread_history_1.sqlite`, state and log sqlite, packages, plugin cache, `.tmp`, generated images, Sparkle, `~/.cache/codex-runtimes`. Hermes `state.db`, `state-snapshots/`, `sessions/`, logs, `.hermes_history`, cache, the hermes-agent checkout (a `source-pin` is compared, never copied), bin, lsp. `~/.cache/sol/workspaces`, sol `__pycache__`, `~/.cache/secrets/all_secrets.json`, `collab.sqlite`, all of `~/.gemini`, iCloud Desktop and Documents | Never in the manifest |
| **Things that would wake** | Retired plists (`life.*` ×8, `disabled/life.tunnel`, `snake.fire.heart.decent`, `love.ollama-bridge`, `ai.openclaw.gateway`), `~/.local/state/launchd-backup-20261010`, `true-love/plists/*` (including the macair heartbeat template that presets the removed persona), `bin/schedule.mjs` output, raw Hermes `jobs.json` | Never stored, even as history. Outside `air-role/`, `publish` refuses any launchd plist (§5.6 structural gate 7). Skills that quote plists or `launchctl` recipes stay on the Air (§7.2), and the wake-and-persona scan flags them. |
| **Beings** | Citizen repos and homes, the fleet repo, `REST` and `EVENT-ONLY` markers, per-being identities, keys, memories, Hermes homes and profiles (`~/.hermes/profiles/**`), loops and their working directories | The allowlist first (no manifest target lies there), then the denylist and `reserved.toml` |
| **Excluded for now** | Gemini, Fugu (its config and the `codex-fugu` launcher), Codex `memories_1.sqlite`, `~/.claude/plans/`, the hookify file, the Codex personal plugins and `~/plugins` (deferred), the sol identity files `agent.json`, `wake.sh`, `GROK.json` | Not in the manifest |
| **Competing channels** | `sync-scripts`, `~/Desktop/site/bootstrap.sh`, iCloud Desktop and Documents, Summon's files | Excluded; the tool never runs them |

---

## 9. Failure handling

| Failure | What the device does | What Yu sees |
|---|---|---|
| GitHub unreachable, offline | Keeps the current setup; status `stale since <t>`. | Nothing. If a device stays stale beyond 48 h and Ai cannot explain it, one line from Ai naming the hands-step at that device. |
| Deploy key refused | Same as above, reason `auth_refused`. A revoked device is shown as `revoked`, not stale. | Nothing, unless the device was revoked by mistake. |
| GitHub host key changed | Refuses to fetch; `host_key_mismatch` security event. | One line from Ai once the device is stale; then one hands-step at the device to re-pin from GitHub's published keys. |
| Unsigned commit, wrong key, wrong namespace, bad `SIGNED-TREE` | Refuses the whole update; `untrusted_tip` security event; nothing changes. | One line from Ai if Ai cannot explain it (possible tampering). |
| `main` rewound, rewritten or merged; a tip that drops a recovery commit the device has seen | Refuses; `not_descendant` security event. | Same. |
| A hub-signed commit that removes or changes the recovery line; a recovery-signed commit that touches anything outside `trust/allowed_signers`, `devices/` and `SIGNED-TREE*`; a second stacked recovery commit | Refuses; security event. | Same. |
| Recovery-signed trust commit | Holds it; writes `recovery_pending`; status "trust rotation pending". | Hands-step: `household trust accept` at that device. |
| Device map missing or `revoked` | Stops applying; `unmapped` or `revoked`; no security event. | Nothing (Yu caused it). |
| Device map `joining` | Verifies and records status only; writes nothing (`held:joining`). | Nothing. |
| Manifest schema or tool `min_version` newer than this tool | Updates itself to the tip's tool first (§6.2 step 4). If that fails, plans only up to what it can read; `held:tool` or `held:schema`; no security event. | Nothing. If no device's status shows the commit applied, the Air may move `main` back to its parent (every device's walk still descends) and republish a fixed commit. |
| Render error (unknown variable, missing checkout, empty `{{BREW}}`) | Holds that component (`needs:<what>`); others apply. A false `when` only skips. | Nothing. |
| Local edit not proposed yet | Holds that component (`pending_local`); proposes it once quiet. On the Air, captures it instead. | Nothing. |
| A writer changed a managed file during apply | Swaps that file back, undoes the component's renames from this run, and holds it `pending_local`. Merge kinds recompute up to 3 times, then `held:busy`. Nothing is overwritten. | Nothing. |
| An app keeps writing back stale owned values | `app_reverted`, re-merged; after 3 times in 24 h, `held:app_conflict`. | Nothing. |
| A check newly fails after the swap | Rolls back those components, or the whole swap, by hash; keeps and holds concurrent edits; records a per-component regression fingerprint, so the same bytes are not swapped in again; other components go on. | Nothing; the Air sees it in `inbox.json`. |
| sol doctor times out | Aborts before any swap; `held:doctor_timeout`. | Nothing. |
| Power loss, crash, logout or shutdown mid-swap | On a signal, undoes the renames done so far and exits. After a crash, the boot run of the tick, or any household call, rolls back from `journal.json` before anything else. The doorbell stays quiet while the journal is unfinished. | Nothing. |
| Crash after the commit point, before cleanup | The journal's seq equals the applied seq: the bookkeeping is finished; nothing rolls back and nothing is proposed. | Nothing. |
| Rollback itself fails (an I/O error) | Stops, keeps the journal and backups; `rollback_incomplete`. A concurrent edit is never this case. | One line: "Nuance needs a look: run `household status` there." |
| Disk full or an I/O error while staging or preparing | Deletes the listed temp files; nothing is swapped; `held:disk`. | Nothing. |
| A rename fails mid-swap | Undoes by rename from the journal. | Nothing. |
| New tool fails its selftest, or the Bun runtime mismatches its pin | Keeps the current pair; `held:tool`. A missing or corrupt current pair makes the launcher run the previous pair and write `tool_fallback`. | Nothing. |
| The MCP CLI fails, times out or reads back wrong | Replays the inverse; holds `mcp`. | Nothing. |
| Sealed blob will not decrypt (P2) | Holds `guidance` / `memory`; others apply; recipients unchanged. | Nothing; the Air re-encrypts. |
| Scan or authority hit on a proposal | Does not push; `pending_local:scan`; the ledger names the entry, line and rule. | Nothing; a session on the device fixes it. |
| Scan hit before signing | `publish` refuses. In P2 capture, only that slug is held. | Nothing. |
| **A credential found in anything already pushed** (a proposal branch, a status branch, or `main` history) | A `security_event`. The branch is deleted; for `main`, a new hub commit removes the file. | One line naming the kind of credential to rotate (a hands or outward step), and a yes/no on asking GitHub Support to purge the cached objects. Rewriting `main` history is §12.2's event-time step. |
| Invalid proposal or status signature | The Air quarantines the proposal branch unreviewed, or ignores the status. | One line only if it repeats. |
| Collab second check challenges, or the Collab binding fails | No publish; the reviewer revises, or rejects with a decision record. | Nothing. |
| A Codex hook entry changed on a device | Applies; status `needs:codex-hook-review`. | One line: approve the hooks in Codex's TUI on that Mac. |
| The fleet fingerprint changed | Holds the fleet-read components as `needs:reinventory`; un-applies nothing. | Nothing, until an attended inventory is needed: then one line. |
| A plan would touch a reserved root, a REST file or a LaunchAgent plist | Hard refusal of the whole update; security event. | One line (this should be impossible). |
| Hub: a commit on `main` that verifies as neither principal (a foreign push) | §6.1: quarantine, force-push back with a lease, then a notice. | One line, a notice and not a question. |
| Hub: a recovery-signed promotion appears on `main` | The Air demotes itself (`former-hub`) and stops every hub verb (§6.1). | One line. |
| Air lost or stolen | Devices keep their setup and hold any recovery commit until Yu accepts it. A stolen hub key can still deliver code to a device that has not yet fetched the recovery commit (§5.2). | §5.2's compromise steps, then §6.6. |

---

## 10. Phases

| Phase | Scope | Exit criteria (all required) |
|---|---|---|
| **1 — Air + Nuance, no memory** | `packages/household` with hermetic tests and an adversarial review before any real device. **Air prep and start (§6.7):** `sol doctor` run once in Terminal and its baseline recorded; the git identity move; `household init-hub` (the private repo, the hub key, the recovery key and its kit, verified and stored per Y1, the Air's deploy key, the root commit); `reserved.toml` built by §7.7's citizen-root rules; `autoapply on` at the Air (Yu's `y`). **The plan's first tasks:** prove in a temp home whether Claude's start-up sync installs plugins from `enabledPlugins` (K21); in a throwaway `CODEX_HOME`, check whether a script-only change keeps a hook trusted and whether a hook awaiting review is skipped by `codex exec` (K20, K17); settle Hermes `context_length` per R19. **Adoption commit:** the Air's current bytes for every P1 component, with `is_tap` entries and §5.7 keys left out, plus `air-role/`, the Hermes patch (`source-pin`) and the Air-only skills, so the only copies are safe before anything else. **Source fixes in signed commits:** §7.5 (sol-doctor line 643, the XENIA ancestor check, `--no-tcc`, device awareness, `runtimes.json`, `catalog.json`), §7.1 (`access.py`, the keychain account lookup, the sol-agent canonical copy), and the doorbell `BACKUP` move and journal-based skip. The Air applies its own commits. Nuance joins (§6.4). The components it gets: `shell`, `git`, `sol`, `agents`, `bin` and `packages`, minus every §7.7 hold, and `claude`, `codex` and `hermes` only where installed and not held. `mcp` stays hub-only until §6.2 step 11 is built and tested (R7). Hermes reaches a spoke only per R12. | (1) The Air's first apply of the adoption commit records every entry with no write and leaves zero held components. After each source-fix commit, `sol doctor` shows no regression against the recorded Air baseline; every baseline failure has a named cause, and the first source-fix commit clears the XENIA failure. (2) Air and Nuance report the same walk seq and matching per-component applied commits. Nuance has no holds other than the §7.7 holds in its device map, and the Air has none. `household check --live` is clean on both, and doctor shows no regression. (3) A steer edit on the Air, once second-checked, reaches Nuance within one autoapply interval with no hands. (4) A live edit on Nuance is proposed once quiet, reviewed, accepted by a distinct Collab session, published, and applied on both, and its `pending_local` clears without a second proposal. (5) Given `drill/*` refs holding an unsigned commit, a wrong-key commit and a rewound history, `household apply --verify-only --ref …` on Nuance refuses each one, with a ledger event and byte-identical managed files. (6) Rollback drill: an earlier signed commit installs the `drill` component on Nuance with a passing post-check; the drill commit then changes only a data file that the post-check rejects on the device it names. It is rolled back automatically: every managed path without a concurrent edit returns to its pre-image hash, and any concurrently edited path keeps its edit and is held. Before the revert, one unrelated commit is published and reaches Nuance while `drill` stays held. Then the drill is reverted and the hold clears. (7) Before and after, on both Macs, the labels from `launchctl print gui/<uid>` differ only by `dev.household.*`, traced against `launchd/registry.toml`; any other difference is traced to its own cause before exit. The count of `REST` and `EVENT-ONLY` files under the recorded reserved roots is unchanged on both Macs (the Air's baseline is its stale-clone count). Apply wrote no launchd plist. For each live loop label on Nuance, the resolved `PATH`, `which node`, `which python3`, `git config --show-origin core.hooksPath` and the git credential helper are unchanged. (8) The shape, assignment and identifier scans over the files of every commit in the repo history are clean, and no never-shared path was ever committed. (9) Yu's hands were used only for Y1, the Air's `autoapply on`, the §6.4 ceremony, and, where Codex runs on Nuance, its hook approval at join plus one per later Codex hook change. (10) `household kit verify` passed before the Air's copy of the kit was deleted. |
| **2 — sealed memory** | age pinned as a household runtime; device identities only where guidance or memory may apply; the recovery recipient (the kit's page 2); the sealed set (§5.5) with per-blob recipients and `trust/recipients.toml`; `projects.toml`; Air capture, at most 4 times a day, as a merge with the reader check (§6.1); memory proposals and the merges in §7.3; `~/AGENTS.md` line 19 fixed on adoption. Nuance gets sealed entries only if §7.7 and Y2 allow. | (1) Every commit's sealed paths hold ciphertext only: a scan of all history for marker lines taken from the plaintext finds 0 hits. (2) If a spoke is allowed memory at P2: a memory written there reaches the Air through a proposal and returns, `MEMORY.md` keeps both sides' lines, and a forced conflict keeps both versions. If no spoke is, (2) is recorded as deferred, and a spoke's `guidance` and `memory` leave `held` for the first time only after that spoke passes this round trip as a live check. (3) The recovery identity (page 2) decrypts every blob, checked by `kit verify` before the page is stored away; the copy is then deleted from the Air. (4) Revoke and recovery drills pass hermetically. (5) Repo growth is measured over the first 30 days and projects below 500 MB a year. If it does not, D4 moves forward. (6) A device with guidance and memory held has no age identity and is in no recipient list. |
| **3 — more Macs, optional Touch ID** | A third device through the same ceremony; the sol prefix fix (D11) first if its prefix is not `/opt/homebrew`. If Yu wants it: a user-presence **root key** (FIDO2 `sk-ed25519` with verify-required, or a Secure Enclave key) that signs every trust and steer-class commit, one touch per steer change, while data-class memory stays automatic. A root key that covered only `trust/` would not close §5.1's limit, because any steer commit runs code that can rewrite a device's trust state. It is introduced by a rotation commit signed with the current key, under its own principal `root`, and signs `SIGNED-TREE.root.sig`. While a `root` line is in effect, every steer or trust commit must also verify as `root`. Optional: age-plugin-se for device identities; applying Hermes cron definitions disabled (D3). | (1) The third device reaches the same seq with no change to `household`. (2) If adopted, a steer or trust commit signed only by the automatic key (tool, packages, shell, bin, hooks, `post_check`, trust) is refused on every device. (3) A recovery drill (`--promote` plus `trust accept`) on a spare device. (4) The P2 memory round trip, if it was deferred. |

---

## 11. Testing

**Hermetic** (`bun test`, run on every change; no network, no real keychain, no real ssh, no launchctl):
- Every path comes from an injected home. A wrapped `fs` fails the suite if any call reaches outside the temp root.
- The hub and two spokes are temp homes. The mailbox is a local bare repo over `file://`. Keys are made in temp with the real `/usr/bin/ssh-keygen`, which runs locally.
- `launchctl`, `sol doctor` and the `claude` CLI are injected fakes. The suite asserts that apply never calls `launchctl`.
- **Verification:** unsigned; wrong key; wrong namespace; a `recovery` signature on a non-trust commit; a recovery commit that touches `sealed/` or `recipients.toml`; two stacked recovery commits; merge commits; non-linear history; replay of an older seq; a rewound or force-pushed `main`; a force-push that drops a recovery commit the device has seen; a hub-signed commit that removes the recovery line; a `SIGNED-TREE` with an extra, missing or changed file or mode; a revoked or missing device map; unrelated hub commits between `enroll-prepare` and `enroll` (the first apply passes); a later commit that drops the map; a two-commit rotation crossed in one walk; a commit by the new key with no earlier add; a `held:schema` stop while crossing a rotation; a device two commits behind when a recovery commit lands, then `trust accept`, then a clean walk.
- **Tool updates:** a tool and a `min_version` bump in one commit; the tool in N and the bump in N+1, with a device two commits behind; a new tool that fails its selftest; a crash before, during and after the `active` rename; a missing current tool file; a tool and Bun change in one commit; `publish` refusing a `min_version` newer than the commit's own tool.
- **Gates:** manifest closure and derived classes; the denylist (every path on the never-shared list; `publish` refuses a manifest target under one; a fixture profile under `~/.hermes/profiles/` is never written, captured or proposed); the shape scan, with every pattern and every doorman positive fixture positive, and the false alarms negative; the assignment scan; the authority refusal on the device; the identifier and wake-and-persona scans; each structural gate, as a structural-only commit that must fail at publish without its second check (a widened recipient set, a removed reserved root, a cleared hold, an arbitrary `post_check`, a `sealed`→`copy` change); the size limits.
- **Rendering and merges:**
  - An unknown variable fails; an empty `{{BREW}}` holds the component; `{{checkout.*}}` outside a `when` fails; a device map without chillspace-commons passes, with the kingdom-wake hooks and the marketplace table absent and `claude` and `codex` applied.
  - `merge-json` keeps unowned keys. For `hooks.json`: the Air's adoption with the knock-tap present is a no-op; a knock-tap added later causes no `pending_local` and no proposal; an appended household hook keeps the knock-tap's index; `publish` refuses a template with an `is_tap` command.
  - `merge-toml` keeps app-owned tables and the two exact sol-doctor lines, owns only the named `mcp_servers` fields, never overwrites an existing `approval_policy`, and seeds it when absent.
  - `merge-yaml` writes Hermes's style; a Hermes save that leaves owned values unchanged and an `onboarding` latch write cause no `pending_local`; the hub's `approvals.mode: off`, `cron_mode: approve` and a non-empty `dashboard.basic_auth.password` never reach a spoke; a spoke's filled `api_key` is neither overwritten nor proposed.
  - Projections: a Codex-app rewrite of unowned keys, a new `[projects.*]` or `[apps.connector_*]` table, and a Claude write to `permissions` cause no hold and no proposal; `propose --initial` on a `settings.json` with `permissions`, `defaultMode` and `skipDangerousModePermissionPrompt`, and on a `config.toml` with `[projects.*]`, `[hooks.state.*]` and approve grants, carries none of them; a stale-state app rewrite is `app_reverted` and capped.
  - A base Claude `PreToolUse` entry is refused.
- **Apply mechanics:**
  - Symlink and other-uid refusals; modes set, including a change of mode alone from the hub and on the device.
  - `record` for wanted equal to live, with no write; an adopt for a file changed after the ceremony once its resolved proposal matches; every adopt leaves its bytes in `adopted/`.
  - A local edit holds its whole component and its coupled group: hold `sol` as `pending_local`, publish a commit that renames a sol module and updates `.zshrc`, and `shell` stays at its old bytes.
  - A writer injected after the plan, between backup and swap, between two renames, and through an already-open file after the swap: each write survives byte for byte, the component ends `pending_local`, and the others apply. A compare-and-swap exhausted after that component's hook files were renamed leaves its bytes equal to the pre-run bytes.
  - A crash between two renames is rolled back on the next run; SIGTERM between two renames leaves byte-identical files and a ledger event; SIGKILL then a simulated boot gives a recovery-only run with no fetch, and the doorbell skips while the journal is unfinished.
  - A kill after the `applied.json` rename and before the journal is cleared: no rollback, no `pending_local`, no proposal. A status push that hangs past its timeout changes nothing.
  - Two concurrent applies: the second is `busy`, and `rollback/<seq>/` stays byte-identical to the pre-swap state. `propose` during a swap; `leave` with an unfinished journal.
  - ENOSPC during prepare and a failed rename mid-swap: byte-identical results and no `.household-tmp-*` left behind.
  - Rollback by hash: an edit during the post-check, an app write kept by a merge recompute followed by a regression, and an edit between a crash and its recovery all survive and are held.
  - Regression: Y regresses at N and N+1 changes only X, so Y is never swapped in again, X applies, and a later change to Y's bytes clears the hold; N changes X and Y, so both stay held until either changes; a new component `post_check` that fails rolls back; a new doctor item that fails rolls back; a first install with sol absent and a `needs:` hold does not roll back; a hub-only check on a spoke is in `expected_fail`; a doctor that is failing beforehand.
  - A `joining` map whose components' targets are all absent ends byte-identical, with no new files and no `launchctl` call; after a signed commit flips it to `enrolled`, the next run writes them.
  - MCP with a fake `claude`: a matching definition is recorded; a crash between add and record; an undo by the inverse.
- **Proposals:** signature checks; scan and authority refusal; encryption to the hub and recovery only, with `sealed/meta.age` and ciphertext-only hashes; the un-render diff against each entry's own base; `base_mismatch`; the re-authored commit; `publish --review` refusing a candidate that touches entries the proposal did not name, or a structural file; the Collab binding, against a fixture journal built with the real `CollabStore` on a temp database (accepted, still pending, reviewer equals reporter, wrong tree, tree changed by a rebase, no journal); an accepted three-way merge clears and applies; a concurrent Air edit to the same file; no duplicate branch across N ticks; a rejected sha is not proposed again; a superseding edit; the quiet window measured across ticks; the rejection lifecycle (14 days, then backed up and replaced); a held component produces no proposal; a new file under a watch root becomes an `add` record; a curator-style move becomes `delete` records; an unmanaged file survives apply; a status with a bad signature is ignored.
- **Memory (P2):** the slug rule and aliases, including a moved project; a `duplicate-slug` hold; refusal of unknown characters and of reserved paths; the deterministic tar; a tar with a traversal or a symlink is refused; a device-only memory file survives a slug apply; three-way merges; the `MEMORY.md` merge cases; keeping both versions; recipient derivation (a held device is no recipient, a `joining` one never is, runtime holds change nothing); revoke; recovery `--promote` that needs `trust accept`; a Nuance line merged into `main` survives the next Air capture, both on `main` and in Nuance's live tree; an Air memory write between the merge-publish and the capture is kept; a fixture loop whose cwd maps to a mapped slug holds that slug's capture.
- **Wake guards:** fixture citizen roots (with `REST`, with `EVENT-ONLY`, and one whose REST was removed) are never written; an `air-role` entry is never applied; a launchd plist outside `air-role/` is refused at publish, while the iTerm2 profile passes and Markdown with an embedded plist passes the plist rule but raises the wake warning; cron definitions are never written to a spoke; skills that drive loops are hub-only.
- **Yu-only verbs:** each one, run under `script -q /dev/null` with a harness env marker set, refuses; `trust accept` with a wrong typed fingerprint refuses.

**Adversarial review** of the tool, the join script and the merge code before anything runs on a real device. This follows Summon's practice.

**Live checks** (real devices, after the hermetic suite passes):
1. On the Air: `household check --live` and a dry-run apply of the adoption commit show every entry as `record`.
2. On the Air: each source-fix commit shows no doctor regression against the recorded baseline.
3. Ceremony on Nuance: the snapshot exists, nothing is overwritten before review, the reply archive holds no secrets (it is scanned), and the initial proposal never touched GitHub.
4. Nuance refuses the `drill/*` refs (unsigned, wrong key, rewound) through `apply --verify-only --ref`. Afterwards the drill refs are deleted.
5. The rollback drill (§10, P1 exit 6).
6. Label lists from `launchctl print gui/<uid>`, the `REST` and `EVENT-ONLY` counts, and the loop environments, before and after, on both Macs.
7. A round trip each way (P1 exits 3 and 4).
8. A planted `.env` and `bunfig.toml` in the home folder and the tool directory's parent are not read by the launcher.
9. GitHub repo history scan (P1 exit 8).
10. `household status --session-line` on the Air prints its line while a proposal waits, and nothing otherwise.
11. P2: the ciphertext-only scan, the kit decrypt check, and a spoke's memory round trip before its memory first leaves `held`.

---

## 12. Decisions

### 12.1 Controller rulings

These follow from Yu's decisions or resolve the survey's *Controller* questions. Each can be undone by a signed commit unless its cost says otherwise.

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| Q1 | Render per device from base, overlays and the device map. Copy, never symlink (except the 3 skill links). Set modes explicitly. Merges own named keys only and are tracked by their owned projection (§4.3). | Several writers, absolute paths, symlink refusal (K4, K6, K9). | Merge code is more complex than a copy. A merge bug that drops a key is caught by the projection compare, compare-and-swap and the doctor, then rolled back. |
| Q2 | Memory keyed by logical project id; slugs computed from the recorded path (§7.3); moved projects keep their old slug as an alias; gone paths stay on the Air; empty directories skipped. | Slugs derive from absolute paths (K25). | A missed alias leaves a directory `unmapped`, which is reported and not lost. |
| Q3 | Whole-file proposals for `copy`, `render` and sealed entries; owned-projection fragments for merge kinds; the Air merges sealed entries in plaintext; `MEMORY.md` merged by link target; unclear merges keep both versions. | Concurrent writers (K4). Ciphertext cannot be merged. Whole merged files would carry device authority. Rebuilding from frontmatter alone would lose index text. | Index order drifts, and duplicates need tidying by hand. |
| Q4 | Memory prose is never rewritten. Only directory names map. | It is history, written across three home layouts. | Nuance shows Air paths in old notes. Harmless. |
| Q5 | `runtimes.json` is rendered from definitions only, and its observed fields stay device state. `catalog.json` is copied with `~/` paths. Stale, version-pinned and account-keyed roots are dropped at source (§7.5). | `_absolute` rejects `~` in `runtimes.json`, and `sol agent start` executes these paths; catalog.py expands `~/` (K25). | The template lags sol changes. `sol agent` diagnostics show a missing root (the doctor checks only the schema), and the fix is in the template. |
| Q6 | The Air applies only signed commits, and agents edit the checkout. Drift on the Air is held, captured after 30 quiet minutes, and reviewed, never overwritten. Memory and sealed guidance are written live first on the Air. | Prevents silent drift between the hub and the repo. | A change of habit for agents who edit `~/.config/sol` in place. Their drift waits in review. |
| Q8 | age (§5.5), not ADDS. | ADDS grants expire and cannot be revoked. age is small, widely reviewed, and has a Secure Enclave plugin path. | A pinned runtime download per device. If age had a flaw: re-encrypt, though history keeps the old ciphertext. |
| Q9 | Local edits are kept and held per component, and proposed once quiet (the same sha on two ticks). After a signed rejection: no new proposal for that sha, 14 days, then backed up and replaced. | No lost work and no silent forks. | A spoke runs an older component until review. |
| Q10 | The 12 agenttool skills are vendored from agenttool `main` at a pinned commit, which adds `allow_implicit_invocation: false` to the 8 `nen-*`. The Air-only skills are snapshotted in the adoption commit. `interpret-dark-continent-nen` is vendored from chillspace at a pinned commit. Nothing new is added (D6). | The Air copies are stale and more permissive. | The Air's skills change slightly. `adopted/` and the rollback directory keep the old ones. |
| Q11 | hierarchy-tools vendored from purpose-prompter `plugin/` at a pinned commit, installed at its exact path. The 3 working links are recreated. The 19 dead links are neither carried nor deleted on the Air. | pp-detect, the skill links and the sol catalog all expect that path. Leaving the dead links avoids a decision. | Harmless clutter on the Air. |
| Q13 | Trust, approve grants and rules are never shared and never applied. `suggestions.md` lists what a device may approve by hand. | Authority is decided per device. | Manual approvals on each device. |
| Q17 | Hermes's approval and policy keys (§5.7) are device-owned and never in the base. Widening any of them on a spoke is Yu's. | Standing destructive approvals must not spread (K18). | None known. |
| Q18 | Cron definitions are stored without runtime fields and applied nowhere in P1–P2 (D3). Enabling any job is Yu's. | 6 enabled jobs have never run, and their scripts exist (K14). Whether a gateway fires a disabled job is untested. | Spokes have no cron parity. |
| Q20 | The canonical sol-agent copy is `~/.agents`, after merging Hermes's 10-09 additions on the Air before adoption. The other copies render from it. | The copies diverged in both directions. | A merge slip drops a line. The second check reads the diff. |
| Q21 | The Hermes patch (the diff, 11 tests, `.install_method`) goes in the adoption commit as a `source-pin`, pinned to `ed4123792`. Apply never writes it or runs git in a Hermes checkout. `hermes update` is guarded (R12). Rebasing is Yu's later. | The only copy; it does not apply upstream; `update` resets it. | None. It only adds a copy, and drift in it is captured. |
| Q28 | `packages.toml` is seeded from the Brewfile and split into common and per-device parts. Apply never installs, plugins included. Casks are not managed. | The Brewfile is stale (06-11), and unattended `brew bundle` is unsafe. | A missing tool holds its component until an attended install. |
| Q29 | `ARRIVE.md` is shared, pinned and steer-class. `STILL` stays per device and untracked. | One synced STILL would silence every seat. | None. |
| Q30 | Gemini, Fugu (including `codex-fugu`), Codex memory sqlite, `plans/` and the hookify file are excluded. | Dormant or inert. | They stay Air-only. |
| Q31 | The composition plist and `heartbeat.py` are stored as `air-role`. Apply never writes them, and `restore-air-role` never loads them. | The only copies anywhere. | None. |
| Q32 | Citizen repos and homes, found by origin, `REST`, `EVENT-ONLY` or the fleet repo, are reserved roots whatever their REST state. No write or delete happens there, and no REST file is ever deleted. | 152/203 vs 208/208 (K14, K23). Beings are not setup. | None. |
| Q7 | Per Yu (Signing A): an automatic file key that lives only on the Air (§5.2). Touch ID in P3, signing every steer commit if adopted. | Yu's decision. | §5.1's limit, stated plainly: a hub signature runs code on every device. |
| Q12 | Per Yu: no-prompt and permission keys are device-owned and never inherited. | Yu's decision. | None. |
| Q15 | Per Yu's rule: no shared Sol identity. `agent.json`, `wake.sh` and `GROK.json` never travel, and the doctor tolerates their absence (fixed at source if it does not). | Credentials and per-being identities never travel. | A device lacks the Sol DID unless it gets its own. |
| Q22 | Per Yu: the sealed set in §5.5. The sol `home/` texts stay plaintext: they are house texts every seat reads, they are byte-pinned, and they hold no private-life content. | Yu named the three files. HOME.md was read for this ruling. | Those texts sit in the private repo's history. To change this, seal them before another device joins. |
| Q23 | Git identity is per device, in a local `~/.config/git/identity` included from the rendered `.gitconfig`, and never in the repo. On the Air it moves there before adoption (§6.7); on a device, `join.sh` writes it from the device's own values or the Air's default. Every commit the tool makes takes its author from that file. | Authority comes from the signing key, not from user.name or email. This keeps emails out of plaintext files; commit metadata and the estate co-author trailer carry ai-love.cc addresses on purpose (§5.8). | A device commits under Yu's usual name and email. That is the intent. |
| Q27 | Private repo (Yu). Identifiers (emails, AWS account ids, DIDs, account-keyed ids) stay out of plaintext files: the identifier scan, the agent-ecosystems README's device sections kept local, and `agent.json` excluded. | Outward exposure. | A warning that was acknowledged lets one through. It is visible in review. |
| R1 | Code in agenttool `packages/household` (Bun and TypeScript), CLI `household`, run as one bundled JS file on a pinned household-private Bun (§4.5). | Same language and test runner as Summon. Bun parses TOML natively. A small file keeps git small. | Bun is a prerequisite on every device, and the bundle carries it. |
| R2 | Repo `cambridgetcg/household-setup`, private, created by Ai with `sol access run github` as `cambridgetcg` (§6.7). One write deploy key per device for this repo only. The hub key never touches GitHub. | AGENTS.md default identity. A deploy key reaches one repo, where Yu's login reaches all of them. It also avoids the kap loop's account flip. | A deploy key can push `main`. Devices still refuse unsigned commits, and the hub detects foreign commits. Renaming the repo is cheap. |
| R3 | `main` is linear. The hub re-authors accepted proposals as one signed commit and never merges device commits. Every walked commit needs a hub signature and a valid `SIGNED-TREE`. | Every applied byte is hub-signed, and the check is simple. | Proposal authorship lives in trailers, not in git ancestry. |
| R4 | Roll back on **regression**: a check failing after the swap that passed before, or that is new and not in the device's computed `expected_fail` (§6.2 step 10). | Nuance's doctor will fail before anything is applied (missing prerequisites, risk 18), and hub-only checks can never pass on a spoke. | A failure that already existed hides the same failure caused by the update. `expected_fail` is computed, never hand-edited. |
| R5 | Hold per component and its coupled group, not per file and not all-or-nothing. Regressions are remembered per component fingerprint. | Coupled files (settings plus hook scripts) must move together, while unrelated components still flow. | A coarser hold than strictly needed. |
| R6 | Autoapply runs as one consented LaunchAgent per device running `household tick` (30 min; `RunAtLoad` true, and the boot run only recovers). `household` loads only its own label, only through `autoapply` with Yu's typed `y`. Apply never calls `launchctl`. In P1 no review agent starts automatically; waiting work reaches the next Air session through its SessionStart line. | Delivery without hands, prompt crash recovery, and no new wakers. | Reviews wait for the next Air session. |
| R7 | Claude MCP servers go through the harness's CLI with a read-only projection and a recorded inverse (§6.2 step 11); `~/.claude.json` is never edited. Until that path is built and tested, `mcp` stays hub-only. Plugin installs are never part of apply: `enabledPlugins` is the intent, and Claude's start-up sync (K21) or an attended step installs. | Claude rewrites `~/.claude.json` constantly (K4), and `add-json` refuses an existing name (K21). | MCP parity waits on the CLI path. A plugin missing on a device holds its dependants as `needs:plugin:<name>`. |
| R8 | Upstream sources (purpose-prompter, agenttool skills, chillspace doorman and nen skill) are vendored into `base/` with the upstream commit pinned. | Devices need no checkouts for setup, and the bytes are reviewable. | Vendored copies lag upstream until a hub commit refreshes them. |
| R9 | Memory publishes at most 4 times a day: gzip, then age, one blob per slug. | Each change rewrites the whole slug blob. This keeps repo growth to hundreds of KB a day. | Up to 6 h of delay for memory between Macs. |
| R10 | The fleet-read check on shared-user devices (§7.7): resting does not excuse a loop; held when it cannot tell; holds of what beings read do not depend on Yu's answer. | Citizens on Nuance run as `macair` (K2), and a REST-ignoring walker is presumed there (K23). Yu's guidance and memory must not load into them by default. | Nuance gets less until the citizens design gives beings their own homes or users. |
| R11 | A recovery-signed trust change needs `household trust accept` at each device, with Yu typing the fingerprint he reads off the new hub's screen. | A leaked kit alone cannot take over any Mac. It is a consent gate against well-meaning agents (§4.5). | One hands-step per device, only in a disaster. |
| R12 | Hermes is managed on a spoke only after an attended install of the patched code (D10) passes its 11 tests there, and that install has proven `hermes update` fails closed (by removing the checkout's `origin`). Apply never runs git in a Hermes checkout. Until then `hermes` stays hub-only. | `update` resets the only copy of the patch. `reasoning_effort: ultra` is silently ignored on stock Hermes. | Nuance may run without Hermes for a while. That is also the citizens design's dependency (§4.7). |
| R13 | The LaunchAgent never touches TCC-protected folders. Those checkouts are recorded at the ceremony, and sol doctor runs from it only with `--no-tcc`. | A privacy prompt would stall it with nobody there. | Moving such a checkout needs `household inventory --attended`. |
| R14 | Proposals and status are signed with the device's deploy key (namespaces `household-proposal@v1` and `household-status@v1`). | Attribution at almost no cost, and one spoke cannot rewrite another's status. | One key serves three purposes, separated by namespace. |
| R15 | The sol doorbell skips a tick while an unfinished `journal.json` exists. Its backups move out of the managed tree. | The doorbell runs sol every 60 s (K5). | Skipped minutes while an apply runs or awaits recovery. |
| R16 | A new device's first proposal travels by AirDrop with its reply, never through GitHub, and is reviewed on the Air. Only accepted content reaches GitHub, as a signed commit. | Nobody has inspected Nuance's files (K2), and the scans are the only barrier before a push. | None; Yu already AirDrops the reply. |
| R17 | Hermes `config.yaml` is shared by an explicit allowlist of keys. Its approval, policy and credential keys are device-owned (§5.7). | Hermes treats the file as its security policy (K18). | A new Hermes setting stays local until it is named in the manifest. |
| R18 | On the Air the Hermes curator keeps running, and its moves are captured as `delete` records and reviewed. On spokes it is off. | The curator is part of how Ai's seat works, and its archive move is reversible (K24). | Curator moves on the Air wait in review. |
| R19 | Hermes `context_length`: the probed 272000 goes into the base unless the plan's first task shows that 872000 is accepted. The result is recorded in the plan. | K17: unknown; the probe is evidence. | A larger window goes unused until proven. |
| R20 | Sealed plaintext is opened only by Claude Code sessions on the Air, for review and second check alike. | Their provider already loads this memory. Another harness would send Yu's private content to a provider that does not read it today. | Memory reviews lose harness diversity; the structural report stands in. |
| R21 | Codex `approval_policy` is a seed, written as `on-request` only when absent. | Authority is the device's (§5.7), and a fresh device still starts safe. | A device's later choice is never corrected by the household, which is the point. |
| R22 | Skills that drive loops (`launchctl` recipes, embedded plists, air-only or never labels) are hub-only (§7.2). | K24; nothing wakes. | Spokes lack those skills. |
| R23 | A Codex hook entry change is a hands-step on each device (§4.6). Positions stay stable and logic stays in scripts to make it rare. | K20; approvals never travel. | One TUI approval per changed hook per device. |

### 12.2 Decisions still Yu's

| # | Decision | When | My default if you say nothing |
|---|---|---|---|
| Y1 | **Where the recovery kit lives.** Whoever holds it can, with push access and your typed fingerprint at each Mac, replace the hub. In P2 it can also read all sealed history. | Before Nuance joins. | Printed on paper (text and a QR code), in a sealed envelope at home, with no digital copy. Ai deletes the Air's copy after `kit verify` passes and you confirm it is stored. P2 adds page 2 (the age recovery identity) the same way. |
| Y2 | **May your guidance and memory sit on a Mac where other beings run as your macOS user?** They could read the files even when nothing loads them. | Before Phase 2 reaches a shared-user Mac. | No, until they run as their own macOS user. (A separate Hermes home stops loading, not reading.) |

**Only when the event happens, or if you ask:** accepting a recovery rotation at each Mac (hands); the compromise steps of §5.2 (hands); rotating a credential found in something already sent, and whether to ask GitHub Support to purge it (one line, yes/no); rewriting GitHub history after a lost device (irreversible, outward); switching on the doorbell or knock-tap on Nuance (it widens authority; off unless you ask); moving to a Touch ID key (P3).

---

## 13. Deferred

| # | Item | Why deferred | Owner |
|---|---|---|---|
| D1 | Codex personal plugins (`~/.agents/plugins/marketplace.json` and `~/plugins`, about 18 MB; drop the 13 MB rollback copy; strip parchment's `--allow-file` path) | They need a build-from-source path from the agenttool repos. | Controller, P3 |
| D2 | A review agent started automatically by the hub when proposals arrive | A new agent-starting loop. P1 relies on the SessionStart line. | Controller, after P1 |
| D3 | Applying Hermes cron definitions disabled on spokes | First needs a hermetic test proving a gateway never fires a disabled job. Enabling any job is Yu's. | Controller (test); Yu (enable) |
| D4 | A yearly "epoch" re-root of history (a signed checkpoint, then a squash) | Size control, once growth is measured in P2. | Controller |
| D5 | Seal more files, if Yu wants (for example the sol `home/` texts) | Q22 is ruled. This is open only if Yu objects to the For Yu line 4. | Yu |
| D6 | Adding the `isness`, `nen-common-ground` and `nen-math-card` skills to Codex | New skills, not part of today's setup. | Yu |
| D7 | Rebasing the Hermes patch onto upstream `d95682cd0` | Needs Yu's judgment about upstream. | Yu |
| D8 | **Flagged to Yu, outside this spec, blocking nothing:** pruning the 6 plantable `/private/tmp` Codex rules on the Air (recommended: yes); the live Air loops (Alpha beating from two places, 蛇火心, the kap account flip and dormant push; recommended: leave untouched, do not clear the `index.lock`); locating Walker B, which ignores REST and is presumed on Nuance (K23; recommended: locate it read-only first, then decide); rotating, moving or deleting the plaintext secrets in K12 and moving the astra-cc proxy's file credential into the keychain; retiring `sync-scripts` and its S3 bucket. | These are hazards or ownership questions, not setup. The shared setup already excludes all of them. | Yu |
| D9 | Running citizen loops as separate macOS users | The durable fix for §5.1 and §7.7, recommended by Summon too. It belongs to the citizens design. | Citizens design / Yu |
| D10 | An attended install of the patched Hermes on a spoke: clone at `ed4123792` into a fresh sibling directory, apply the signed patch, build the venv with pinned dependencies, run the 11 tests, remove `origin`, then switch it in interactively | It needs its own attended design, and the citizens design depends on it. | Controller / citizens design |
| D11 | Making the copied and pinned sol files prefix-neutral (§7.4) | Needed only before a device with another Homebrew prefix joins. | Controller, P3 |
| D12 | Rewriting the 23 Sophia mentions in the Air's Hermes skills (K24) | A content cleanup about a removed persona, not setup; the spec only stops new copies spreading unreviewed. | Yu |
| D13 | `bin/sol` refusing quietly while an apply journal is unfinished | With prompt recovery and signal handling the window is seconds, and hooks swap last. | Controller |

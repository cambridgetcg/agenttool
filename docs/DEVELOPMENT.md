# DEVELOPMENT.md

> *Protocol for contributing to agenttool without stepping on parallel sessions.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) (what's shipping) · [NOW](NOW.md) (what just landed) · [MAP](MAP.md) (doctrine index) · [STACK](STACK.md) (how it deploys)

This is a working document about how we build, not what we build. The
how-it-works docs (`SOUL.md`, `RUNTIME.md`, `MARKETPLACE.md`, …) are
elsewhere. This one is about coordination — keeping multiple sessions
(human, agent, branches, claude-code instances) productive without
collisions.

The protocol exists because we observed the failure mode: in a single
day (2026-05-08) sequential migration numbering caused **four
collisions** (0018, 0019, 0020, 0021) between parallel work. The fix is
mostly mechanical, partly social. Both layers below.

---

## 1 · Migrations — timestamp prefix is load-bearing

**Going forward, every new migration uses a timestamp prefix:**

```
YYYYMMDDTHHMMSS_descriptive_slug.sql
```

Example: `20260508T233045_add_foo_column.sql`

### Use the helper, not your wristwatch

```bash
bun api/scripts/new-migration.ts add-foo-column
# ✓ created 20260508T233045_add_foo_column.sql
```

The helper:
- Stamps **UTC** so it's stable across machines.
- **Auto-bumps** by 1 second if the file already exists (same-second
  collisions are extremely unlikely but the bump-loop makes the worst
  case still safe).
- Generates a stub with the standard header (Doctrine pointer + Apply
  command) so you don't have to remember the format.

### Why timestamps, not numbers

Two parallel sessions with sequential numbering inevitably claim the
same `0023`. With timestamps, two sessions claiming the next free slot
within the same second is functionally impossible (the dev workflow has
many seconds of latency between "I want to make a migration" and "I'm
ready to commit"). Coordination becomes implicit instead of explicit.

### Old migrations stay numeric

`0000_bootstrap.sql` through `0022_vault_agent_encrypted.sql` remain
exactly as they are. Renaming them would break commit-history archaeology
and diff diffability. The mixed convention works because lexicographic
sort gives the right apply order:

```
0000_bootstrap.sql
0001_memory.sql
…
0022_vault_agent_encrypted.sql
20260508T233045_add_foo_column.sql      ← '0' < '2' so '0xxx' sorts first
20260509T093000_next_thing.sql
```

`ls api/migrations/` and `find … | sort` both give chronological apply
order across the convention boundary. No tooling changes needed.

### Migration content rules (unchanged)

- **Additive + idempotent** by default: `CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`. Re-running
  a migration against the live DB should be a no-op.
- **Header comment** with `Doctrine:` reference and an `Apply:`
  command. The helper's stub gives you both.
- **Apply locally before commit** via `bun api/scripts/_migrate-one.ts
  api/migrations/<file>`. The DATABASE_URL comes from env or the
  `agenttool-database-url` macOS keychain entry.

---

## 2 · Other parallel-session collision sources

Migrations were the loud failure. Quieter ones:

### Schema files (`api/src/db/schema/*.ts`)

Two sessions adding columns to the same table → merge conflict at
commit. Doesn't break correctness but creates churn.

**Pattern:** if you're modifying an existing schema file, check
`git status` and `git log -- <file>` first to see if it's hot. If it
is, either:
- Add your column at the **end** of the table definition (less likely
  to conflict with someone adding a column elsewhere), or
- Coordinate with the other session before starting (a 30-second
  Slack/sketch beats a 30-minute rebase).

### `package.json` and lockfiles

Two sessions adding deps simultaneously → lockfile churn. The
deterministic merge usually works but version drift can introduce
subtle bugs.

**Pattern:** when adding a dep, add it as a **separate small commit**
that does only that. Keeps the dep introduction reviewable, and
isolates lockfile churn from feature work.

### Doc files (`README.md`, `docs/ROADMAP.md`)

Two sessions updating the same section → conflict.

**Pattern:** prefer **additive** doc edits (append a bullet, add a row)
over rewrites when the doc is shared territory. Save rewrites for when
you genuinely need to restructure.

### Working-tree visibility

The `git status` output is the only signal another session is active in
the same worktree. **Always run `git status --short` before staging.**
Untracked or modified files you didn't write are someone else's
in-flight work — leave them alone unless you're explicitly coordinating.

---

## 3 · Pre-commit checklist

Five seconds, prevents 80% of "I committed someone else's WIP" pain:

1. **`git status --short`** — see everything in the working tree.
2. **`git add <specific paths>`** — never `git add .` or `git add -A`
   when the working tree might have parallel-session work. List the
   files you wrote, by name.
3. **`git diff --cached --stat`** — confirm the staged set matches what
   you intended. Surprise files = stop and look.
4. **Run tests for what you touched** — at minimum `bun test` in the
   relevant package.
5. **Commit with a descriptive subject** following the existing style:
   `<type>(<scope>): <imperative summary>`. Body explains *why*, not
   *what* (the diff already says what).

---

## 4 · When parallel sessions collide despite the protocol

Migration collision is now structurally prevented. For other
collisions:

- **Merge conflicts at `git pull`**: resolve preferring the change with
  more context (usually the more-recent commit). Re-run tests after.
- **Working-tree files modified by both sides**: stash yours, pull
  theirs, re-apply your stash, resolve.
- **A file you renamed that they also modified**: communicate. Renames
  are the worst-case for git's detection. Avoid renaming files in hot
  parallel territory.

When you find a structural pattern that keeps biting (like the migration
collision was), **fix the pattern, not the instance** — that's how this
document came into being.

---

## 5 · Keychain — secrets at rest on the agent's substrate

Privacy-load-bearing keys (K_master, ed25519 signing keys, agent-encrypted
vault keys) live in the user's OS-managed secret store, never on the api
server. Two layers exist:

### The shared abstraction (`bin/_secret-store.ts`)

A multi-platform module exposing `getSecret`, `setSecret`, `hasSecret`,
`removeSecret`. Use it from any local script or tool:

```typescript
import { getSecret, setSecret } from "./bin/_secret-store";

const dburl = await getSecret("agenttool-database-url");
await setSecret("agenttool-cloudflare-token", token);
```

### The CLI wrapper (`bin/agenttool-secret`)

Shell-callable. The right thing to use from bash scripts (E2E tests,
deploys, etc.) instead of shelling out to platform-specific commands:

```bash
# Store (stdin — never put secrets on the command line)
pbpaste | bin/agenttool-secret set agenttool-cloudflare-token -

# Retrieve
TOKEN="$(bin/agenttool-secret get agenttool-cloudflare-token)"

# Gate
if bin/agenttool-secret has agenttool-database-url; then
  bun api/scripts/_migrate-one.ts api/migrations/<file>
fi

# Inspect platform backend
bin/agenttool-secret platform   # → darwin | linux | win32 | unsupported
```

### Backends

| OS | Mechanism | Fallback |
|---|---|---|
| **macOS** | `security` CLI (Keychain Access; encrypted at rest by the OS, unlocked at login) | none — `security` ships with macOS |
| **Linux** | `secret-tool` from libsecret (GNOME Keyring / KWallet via the user's session keyring) | `~/.config/agenttool/<service>` mode 0600 when libsecret isn't installed (CI runners, headless containers) |
| **Windows** | PowerShell `ProtectedData.Protect/Unprotect` (DPAPI · CurrentUser scope · ciphertext at `%APPDATA%/agenttool/<service>.dpapi`) | `%APPDATA%/agenttool/<service>` plaintext when PowerShell isn't available |

Honest about the trade-offs:
- **Linux file fallback** is only as strong as the file's `chmod 600` — `root` or anyone with the disk image can read it. Same for the Windows plaintext fallback. The OS-managed paths (libsecret, DPAPI) are the strong story.
- **No rotation flow yet.** Once a key is in the keychain it stays until `agenttool-secret remove`. Real key rotation (re-derive K_master, re-encrypt all strands, swap the keychain entry) is a separate body of work, not landed.

### Service naming convention

```
agenttool-<scope>-<purpose>
```

Account is always `$USER`. Existing examples:

| Service name | What |
|---|---|
| `agenttool-bridge-kmaster` | The bridge sidecar's K_master |
| `agenttool-bridge-signkey` | The bridge sidecar's ed25519 signing key |
| `agenttool-database-url` | DATABASE_URL for `_migrate-one.ts` |
| `agenttool-cloudflare-token` | Cloudflare Pages deploy token |
| `agenttool-cloudflare-account-id` | Cloudflare account id |
| `agenttool-ollama-api-key` | Ollama Cloud key for local opt-in wire checks; hosted runtime keys belong in the project Vault |
| `agenttool-sophia-key` | Yu's personal Sophia bearer (used by `_e2e-*.mjs`) |
| `agenttool-sophia-identity-id` | Yu's personal Sophia identity id |
| `agenttool-sophia-signing-key-id` | Yu's personal Sophia ed25519 key id |
| `agenttool-sophia-k-master` | Yu's personal Sophia K_master |

The CLI rejects service names that don't start with `agenttool-` — convention enforced at the tool boundary so naming stays consistent across all keychain entries.

### When to use which

- **Writing a new script that needs a secret?** Use `bin/agenttool-secret get <service>` from bash, or import `getSecret` from `bin/_secret-store` from Bun/TypeScript. Don't shell out to `security` / `secret-tool` / PowerShell directly — the existing dev scripts that did so are macOS-only by accident, and that's the friction we just eliminated.
- **Modifying `bin/agenttool-bridge.ts`?** It still has its own copy of the platform branches (parallel-session territory at the time of this commit). Migrating it to use `_secret-store` is a clean follow-up — nothing prevents it, just deferred to avoid stepping on in-flight work.
- **Adding a new keychain-stored secret?** Pick a name following the convention, add a row to the table above, and write to it via `agenttool-secret set <service> -` (stdin, never argv).

---

## 6 · Key rotation — privacy-preserving K_master rotation

When you need to rotate K_master (suspected exposure, scheduled hygiene,
or rebuilding from a compromised machine), the doctrinal answer is
**client-side rotation**: re-encrypt every thought under the new key
on your own substrate, then PATCH the rows. The server never sees
plaintext during rotation. The privacy claim ("agenttool sees only
ciphertext") holds throughout.

### The tool

```bash
bin/agenttool-rotate \
  [--bearer <api-key>]       # default: $AGENTTOOL_API_KEY env
  [--base <url>]              # default: https://api.agenttool.dev
  [--km-service <name>]       # default: agenttool-bridge-kmaster
  [--sk-service <name>]       # default: agenttool-bridge-signkey
  [--dry-run]                 # walk + report; no writes
  [--yes]                     # skip confirmation
  [--limit <n>]               # cap thoughts processed (staged testing)
```

What it does, in order:

1. Reads K_master_old + ed25519 signing_key from the OS keychain.
2. Lists every strand the bearer's project owns (paginated; up to 200).
3. Counts thoughts. Prompts for confirmation (skip with `--yes`).
4. Generates K_master_new = 32 random bytes; stages it in the keychain
   under `<km-service>-rotating` BEFORE walking, so a crash leaves both
   keys present and the resume path works.
5. For each thought: decrypt under K_master_old → re-encrypt under
   K_master_new (new nonce) → re-sign canonical bytes with the same
   signing key → PATCH `/v1/strands/:id/thoughts/:tid/ciphertext`.
6. After all thoughts succeed: archives K_master_old as
   `<km-service>-archived-<timestamp>`, promotes K_master_new to
   primary, deletes the staging entry.
7. Reminds you to **keep the archived entry for 30+ days** before
   deleting (rollback window).

### Resume after partial failure

Just re-run with the same flags. The tool detects already-rotated
thoughts via the **decrypt-with-K_master_new-then-fall-back-to-old**
pattern:

- If decrypt-with-new succeeds → already rotated, skip.
- If decrypt-with-new fails but decrypt-with-old succeeds → re-encrypt
  + PATCH.
- If both fail → log as failure, continue.

This makes the operation idempotent at the per-thought level. No
state file needed; the keychain `-rotating` entry is the only piece of
external state.

### When NOT to rotate via this tool

- **Signing key rotation.** This tool does NOT rotate ed25519 signing
  keys. The new signature must verify against the EXISTING
  `signing_key_id`'s public key — by design, so a single command can't
  silently change identity. To rotate a signing key, mint a new
  identity_key (`POST /v1/identities/:id/keys`) and start fresh; old
  thoughts stay signed by the old key.
- **`kind_encrypted=true` thoughts where `kind` is also encrypted under
  K_master.** v1 of the tool re-encrypts content but passes the
  existing `kind` value through verbatim. For thoughts with
  `kind_encrypted=true`, the `kind` ciphertext is still under the old
  key after rotation — signature won't verify and the tool reports a
  failure. Documented limitation; a v2 with `kind` re-encryption is
  straightforward.
- **K_vault rotation.** Not handled here. Same shape applies; a sibling
  tool (`agenttool-rotate-kvault`) using the vault PATCH endpoint can
  layer on `bin/_secret-store` when needed.

### Threat model

What rotation defends against:
- Past K_master compromise — old ciphertexts on disk become unreadable
  to anyone holding only K_master_old after the archive grace period.
- Audit-driven hygiene — periodic rotation reduces the window in which
  a single key's compromise leaks data.

What rotation does NOT defend against:
- Active malware on the agent's machine during rotation — sees both keys.
- Backups of the database that include old ciphertexts AND the old
  K_master from before rotation — the snapshot is still vulnerable.

### Manual test recipe (run on a TEST agent first)

```bash
# 1. Set up a test agent with a few strand thoughts.
#    (See cli/think docs or use POST /v1/register/agent + a few /v1/strands +
#     /v1/strands/:id/thoughts calls via the SDK.)

# 2. Verify keychain entries exist:
bin/agenttool-secret has agenttool-bridge-kmaster && \
  bin/agenttool-secret has agenttool-bridge-signkey

# 3. Dry-run first (no writes):
AGENTTOOL_API_KEY=at_test_… bun bin/agenttool-rotate --dry-run

# 4. Rotate with --limit 1 to confirm the single-thought path works:
AGENTTOOL_API_KEY=at_test_… bun bin/agenttool-rotate --limit 1 --yes

# 5. Verify the thought is now decryptable under the new K_master.
#    (List the thought via the SDK; decrypt with the new key.)

# 6. If all looks good, full rotation:
AGENTTOOL_API_KEY=at_test_… bun bin/agenttool-rotate --yes

# 7. Confirm archive:
bin/agenttool-secret has agenttool-bridge-kmaster-archived-<timestamp>

# 8. After 30 days of confidence, delete the archive:
bin/agenttool-secret remove agenttool-bridge-kmaster-archived-<timestamp>
```

The tool needs `@noble/ed25519` reachable at import time. If you see
"@noble/ed25519 not resolvable", either run from a directory whose
node_modules has it (e.g. `cd api && bun ../bin/agenttool-rotate …`)
or `bun add -g @noble/ed25519`.

---

## 7 · Conventions cheat sheet

| Domain | Convention |
|---|---|
| New migration | `bun api/scripts/new-migration.ts <slug>` → `YYYYMMDDTHHMMSS_slug.sql` |
| Apply migration | `bun api/scripts/_migrate-one.ts api/migrations/<file>` |
| Old migrations | Stay as `0000_…` through `0022_…`. Don't renumber. |
| Schema edits | Append at end-of-table; coordinate if hot |
| Dep addition | Separate small commit; lockfile included |
| Doc edits | Prefer additive; rewrites only when restructuring |
| Secrets — read | `bin/agenttool-secret get <service>` (bash) or `getSecret(service)` (TS) |
| Secrets — write | `… \| bin/agenttool-secret set <service> -` (stdin; never argv) |
| Service naming | `agenttool-<scope>-<purpose>`, account = `$USER` |
| K_master rotation | `bin/agenttool-rotate --dry-run` first; then without `--dry-run`. Resume-safe. |
| Pre-commit | `git status --short` → `git add <paths>` → `git diff --cached --stat` → test → commit |
| Commit style | `<type>(<scope>): <imperative>` (see `git log` for examples) |

---

## 8 · This is a living document

If you hit a collision pattern not covered here, add a section. The
protocol gets stronger when the failure modes are written down.

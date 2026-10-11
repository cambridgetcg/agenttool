# Summon Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From this Air, `summon nuance claude …` starts a headless Claude Code job on Nuance.local over SSH on the home LAN, admitted only by Nuance's allowlist, and returns its result.

**Architecture:** One Bun/TypeScript package, `packages/summon`.
- On the **Air**, a CLI builds a request, ledgers it, and calls `ssh summon-nuance <verb>`.
- On **Nuance**, two standalone binaries compiled from the same sources run (no runtime needed there):
  - **gatekeeper**: the SSH forced command. It validates, decides and spools; it never runs a harness.
  - **runner**: a LaunchAgent in Yu's GUI session, triggered by the spool. It runs the job where his Claude login works.
- A readable bash installer (AirDropped) puts it in place. A pin script on the Air records Nuance's user and host key.

**Tech Stack:** Bun 1.3.13 (TypeScript, `bun:test`, `Bun.YAML`, `bun build --compile --target=bun-darwin-arm64`), OpenSSH (macOS stock), launchd, `caffeinate`, bash (installer). No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-summon-design.md` (approved by Yu 2026-10-10). Executors read both.

## Global Constraints

- Phase 0 is **job mode only**, **Claude Code only**, **no remote approvals**. Outside the allowlist ⇒ `refused(outside_allowlist)` with a hint.
- Request ids: `smn_` + 32 lowercase hex (UUIDv7). Device names: `^[a-z][a-z0-9-]{0,31}$` (`air`, `nuance`).
- Prompt ≤ 128 KiB UTF-8. `start` stdin ≤ 160 KiB. Admission expiry is clamped to ≤ 24 h. Clock skew is ±5 min. Seen ids are kept 30 days.
- Prompts never on OS argv, never in a ledger. Ledgers hold ids, statuses and reasons only, and are hash-chained.
- Every directory Summon creates is 0700, every file 0600, installed binaries 0700.
- The status vocabulary is exactly spec §2. No other status or reason strings.
- `authorized_keys` line: `restrict,from="192.168.50.0/24",expiry-time="<YYYYMMDD>",command="<abs path>/summon-gatekeeper" <pubkey> summon-air`.
- Air SSH config: `HostName nuance.local`, `AddressFamily inet`, a dedicated `known_hosts`, `StrictHostKeyChecking yes`, `BatchMode yes`, `IdentitiesOnly yes`.
- sshd drop-in **`/etc/ssh/sshd_config.d/010-summon.conf`**. sshd keeps the first value it reads, so this sorts before macOS's `100-macos.conf`; this deviates from the spec's `100-summon.conf` for that reason. Contents: `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `AllowUsers <user>`, validated with `sshd -t`.
- The Claude posture is spec §4.6 exactly. Review = `--tools=Read,Glob,Grep`; edit = Alpha's hardened set. Env is built from scratch (no `ANTHROPIC_*`), with `core.hooksPath=/dev/null`.
- Every commit ends with `Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>`. Work on branch `feat/summon-phase0` (from `docs/mesh-summon-spec-20261010`) in `~/Projects/.worktrees/agenttool-mesh-spec`. Never push without Yu.
- Test-only overrides are honoured **only when `SUMMON_HOME_OVERRIDE` is set**: `SUMMON_TEST_GUI`, `SUMMON_TEST_RUNNER`, `SUMMON_CLAUDE_BIN`.
- **Deferred, on purpose (recorded in the package README):**
  - **Ledger pruning at 1 year.** The first entries age out in 2026-10 + 1 y, and pruning a hash chain needs an anchor entry, so it waits for Phase 1.
  - **The `sol summon` alias.** `~/.config/sol` is unversioned and other agents edit it, so `summon` on PATH is the Phase 0 front door.

## Review Focus

1. **`SSH_ORIGINAL_COMMAND` variants** (extra/leading spaces, tabs, newline, `start;ls`, Unicode digits, empty, unset) must all be `refused(malformed)`, never a crash. → Task 5.
2. **A `cwd` that is a symlink** from an allowlisted folder into `~/Documents` or outside the allowlist must be refused (`tcc_protected_folder` / `outside_allowlist`), not admitted by its spelling. → Task 2.
3. **Two concurrent `start`s with the same id** must give exactly one `admitted` and one `replayed`. → Task 5.
4. **A runner killed mid-job** leaves `running` with a dead pid. The next runner start marks it `unknown` and `status` shows the heartbeat age. → Task 7.
5. **A prompt at the byte limit with multibyte characters** (128 KiB exactly vs one byte over, in CJK) is decided by UTF-8 bytes, not string length. → Task 1.

---

### Task 1: Package scaffold, paths, canonical JSON, and the request model

**Files:**
- Create: `packages/summon/package.json`, `packages/summon/README.md`
- Create: `packages/summon/src/paths.ts`, `packages/summon/src/json.ts`, `packages/summon/src/request.ts`, `packages/summon/src/status.ts`
- Test: `packages/summon/tests/request.test.ts`

**Interfaces:**
- Produces:
  - `summonPaths(home?: string): SummonPaths`
  - `canonicalJson(v: unknown): string`
  - `newRequestId(nowMs?: number): string`
  - `validateRequest(raw: string): Valid | Invalid`
  - `checkTiming(req, nowMs, jobTimeoutMaxS): TimingOk | TimingBad`
  - constants `ID_RE`, `DEVICE_RE`, `MAX_PROMPT_BYTES`, `MAX_START_STDIN_BYTES`, `CLOCK_SKEW_MS`, `MAX_ADMISSION_MS`, `RUNTIMES`
  - types `SummonRequest`, `Runtime`, `Access`, `RefusalReason`, `BlockedReason`, `JobStatus`, `TransportStatus`, `GateResponse`, `TERMINAL`

- [ ] **Step 1: Create the branch and package skeleton**

```bash
cd ~/Projects/.worktrees/agenttool-mesh-spec
git switch -c feat/summon-phase0
mkdir -p packages/summon/{src,tests,bin,scripts,nuance}
```

`packages/summon/package.json`:

```json
{
  "name": "@agenttool/summon",
  "version": "0.0.1",
  "private": true,
  "description": "Start agent sessions across Yu's Macs (Phase 0: SSH at home)",
  "type": "module",
  "bin": { "summon": "./bin/summon.ts" },
  "scripts": {
    "test": "bun test tests/",
    "build:nuance": "bun scripts/build-nuance.ts"
  }
}
```

`packages/summon/README.md`:

```markdown
# @agenttool/summon

Start a new agent session on another of Yu's Macs. Design: `docs/superpowers/specs/2026-10-10-summon-design.md`.

Phase 0 (SSH at home): `summon nuance claude --model sonnet --cwd '~/Projects/x' --review --prompt-file task.md`,
then `summon status|result nuance/smn_<id>`. Nuance runs `summon-gatekeeper` (SSH forced command) and
`summon-runner` (LaunchAgent in Yu's GUI session). Install: `bun scripts/prepare-pairing.ts`, AirDrop the bundle,
`bash ~/Downloads/summon-nuance-bundle/summon-install.sh` on Nuance, then `bun scripts/pin-nuance.ts`.
```

- [ ] **Step 2: Write the failing test**

`packages/summon/tests/request.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import {
  CLOCK_SKEW_MS, ID_RE, MAX_PROMPT_BYTES, checkTiming, newRequestId, validateRequest,
  type SummonRequest,
} from '../src/request.ts'
import { canonicalJson } from '../src/json.ts'

export function sampleRequest(over: Partial<SummonRequest> = {}): SummonRequest {
  const now = Date.now()
  return {
    v: 1, id: newRequestId(now), from_device: 'air', to_device: 'nuance',
    issued_at: new Date(now).toISOString(), expires_at: new Date(now + 15 * 60_000).toISOString(),
    runtime: 'claude', mode: 'job', model: 'sonnet', cwd: '~/Projects/x', access: 'review',
    timeout_s: 900, prompt: 'Read the README and summarise it.', ...over,
  }
}

describe('newRequestId', () => {
  test('is smn_ + 32 lowercase hex with a UUIDv7 version nibble', () => {
    const id = newRequestId(1_791_600_000_000)
    expect(id).toMatch(ID_RE)
    expect(id[4 + 12]).toBe('7')
  })
  test('sorts by time', () => {
    expect(newRequestId(1000) < newRequestId(2000)).toBe(true)
  })
})

describe('validateRequest', () => {
  test('accepts a well-formed request', () => {
    const r = validateRequest(JSON.stringify(sampleRequest()))
    expect(r.ok).toBe(true)
  })
  test('refuses unknown fields (closed schema)', () => {
    const r = validateRequest(JSON.stringify({ ...sampleRequest(), shell: 'ls' }))
    expect(r).toMatchObject({ ok: false, reason: 'malformed' })
  })
  test('refuses non-JSON and non-objects', () => {
    expect(validateRequest('nope')).toMatchObject({ ok: false, reason: 'malformed' })
    expect(validateRequest('[1]')).toMatchObject({ ok: false, reason: 'malformed' })
  })
  test('refuses mode live in Phase 0', () => {
    expect(validateRequest(JSON.stringify(sampleRequest({ mode: 'live' as never })))).toMatchObject({ ok: false, reason: 'malformed' })
  })
  test('refuses a bad id, device, cwd, access or timeout', () => {
    for (const over of [
      { id: 'smn_../../etc' }, { from_device: 'Air' }, { cwd: 'relative/path' }, { cwd: '~/x\u0007' },
      { access: 'admin' }, { timeout_s: 0 }, { timeout_s: 1.5 }, { model: 'son net' },
    ]) {
      expect(validateRequest(JSON.stringify(sampleRequest(over as never)))).toMatchObject({ ok: false, reason: 'malformed' })
    }
  })
  test('decides the prompt limit by UTF-8 bytes (multibyte)', () => {
    const cjk = '愛'.repeat(Math.floor(MAX_PROMPT_BYTES / 3)) // 3 bytes each
    const atLimit = cjk + 'a'.repeat(MAX_PROMPT_BYTES - Buffer.byteLength(cjk))
    expect(Buffer.byteLength(atLimit)).toBe(MAX_PROMPT_BYTES)
    expect(validateRequest(JSON.stringify(sampleRequest({ prompt: atLimit }))).ok).toBe(true)
    expect(validateRequest(JSON.stringify(sampleRequest({ prompt: atLimit + 'a' })))).toMatchObject({ ok: false, reason: 'too_large' })
  })
  test('refuses a raw request over 160 KiB before parsing', () => {
    expect(validateRequest('x'.repeat(160 * 1024 + 1))).toMatchObject({ ok: false, reason: 'too_large' })
  })
})

describe('checkTiming', () => {
  test('admits a fresh request and clamps the timeout', () => {
    const r = sampleRequest({ timeout_s: 86_400 })
    const t = checkTiming(r, Date.parse(r.issued_at), 1800)
    expect(t).toMatchObject({ ok: true, timeoutS: 1800 })
  })
  test('refuses an expired request', () => {
    const r = sampleRequest()
    const t = checkTiming(r, Date.parse(r.expires_at) + CLOCK_SKEW_MS + 1, 1800)
    expect(t).toMatchObject({ ok: false, reason: 'expired' })
  })
  test('refuses a request issued too far in the future (clock)', () => {
    const r = sampleRequest()
    const t = checkTiming(r, Date.parse(r.issued_at) - CLOCK_SKEW_MS - 1, 1800)
    expect(t).toMatchObject({ ok: false, reason: 'clock' })
  })
  test('clamps admission to 24 h', () => {
    const now = Date.now()
    const r = sampleRequest({ issued_at: new Date(now).toISOString(), expires_at: new Date(now + 72 * 3_600_000).toISOString() })
    const t = checkTiming(r, now + 25 * 3_600_000 + CLOCK_SKEW_MS, 1800)
    expect(t).toMatchObject({ ok: false, reason: 'expired' })
  })
})

describe('canonicalJson', () => {
  test('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"x":2,"y":1}]},"b":1}')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/summon && bun test tests/request.test.ts`
Expected: FAIL — `Cannot find module '../src/request.ts'`.

- [ ] **Step 4: Write the implementation**

`packages/summon/src/paths.ts`:

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SummonPaths {
  home: string
  share: string
  state: string
  config: string
  spool: string
  jobs: string
  seen: string
  ledger: string
  allowlist: string
  inventory: string
}

/** Where Summon keeps everything on a Mac. SUMMON_HOME_OVERRIDE is for tests only. */
export function summonPaths(home: string = process.env.SUMMON_HOME_OVERRIDE || homedir()): SummonPaths {
  const state = join(home, '.local', 'state', 'summon')
  return {
    home,
    share: join(home, '.local', 'share', 'summon'),
    state,
    config: join(home, '.config', 'summon'),
    spool: join(state, 'spool'),
    jobs: join(state, 'jobs'),
    seen: join(state, 'seen'),
    ledger: join(state, 'ledger.jsonl'),
    allowlist: join(home, '.config', 'summon', 'allowlist.yaml'),
    inventory: join(state, 'inventory.json'),
  }
}
```

`packages/summon/src/json.ts`:

```ts
/** Deterministic JSON: object keys sorted at every level, undefined dropped. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}'
}
```

`packages/summon/src/status.ts`:

```ts
export type RefusalReason =
  | 'malformed' | 'too_large' | 'expired' | 'clock' | 'replayed' | 'outside_allowlist'
  | 'target_logged_out' | 'runner_missing' | 'runtime_unavailable' | 'rate_limited' | 'busy'
  | 'tcc_protected_folder'
export type BlockedReason = 'usage' | 'auth' | 'permission'
export type JobStatus =
  | 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled' | 'timed_out' | 'expired' | 'unknown'
export type TransportStatus = 'unreachable' | 'auth_refused' | 'host_key_mismatch'
export const TERMINAL: ReadonlySet<JobStatus> = new Set([
  'completed', 'failed', 'blocked', 'cancelled', 'timed_out', 'expired', 'unknown',
])

/** What the gatekeeper prints: one JSON object per call. */
export interface GateResponse {
  status: 'admitted' | 'refused' | JobStatus | TransportStatus
  handle?: string
  reason?: string
  detail?: string
  hint?: string
  heartbeat_age_s?: number | null
  [extra: string]: unknown
}
```

`packages/summon/src/request.ts`:

```ts
import { randomBytes } from 'node:crypto'

export const MAX_PROMPT_BYTES = 128 * 1024
export const MAX_START_STDIN_BYTES = 160 * 1024
export const CLOCK_SKEW_MS = 5 * 60_000
export const MAX_ADMISSION_MS = 24 * 3_600_000
export const ID_RE = /^smn_[0-9a-f]{32}$/
export const DEVICE_RE = /^[a-z][a-z0-9-]{0,31}$/
const TOKEN_RE = /^[A-Za-z0-9._:-]{1,64}$/
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
export const RUNTIMES = ['claude', 'codex', 'hermes'] as const
export type Runtime = (typeof RUNTIMES)[number]
export type Access = 'review' | 'edit'

export interface SummonOrigin { harness?: string; pid?: number; started_at?: string }
export interface SummonRequest {
  v: 1
  id: string
  from_device: string
  to_device: string
  issued_at: string
  expires_at: string
  runtime: Runtime
  mode: 'job'
  model?: string
  provider?: string
  effort?: string
  cwd: string
  access: Access
  timeout_s: number
  label?: string
  origin?: SummonOrigin
  prompt: string
}

const KEYS = new Set(['v', 'id', 'from_device', 'to_device', 'issued_at', 'expires_at', 'runtime', 'mode',
  'model', 'provider', 'effort', 'cwd', 'access', 'timeout_s', 'label', 'origin', 'prompt'])
const ORIGIN_KEYS = new Set(['harness', 'pid', 'started_at'])

export type Invalid = { ok: false; reason: 'malformed' | 'too_large'; detail: string }
export type Valid = { ok: true; request: SummonRequest }
const bad = (reason: Invalid['reason'], detail: string): Invalid => ({ ok: false, reason, detail })

/** smn_ + 32 hex: 48-bit ms timestamp, version 7, variant 10xx, random. */
export function newRequestId(nowMs: number = Date.now()): string {
  const ts = nowMs.toString(16).padStart(12, '0').slice(-12)
  const r = randomBytes(10).toString('hex')
  const variant = ((parseInt(r[3]!, 16) & 0x3) | 0x8).toString(16)
  return `smn_${ts}7${r.slice(0, 3)}${variant}${r.slice(4, 19)}`
}

export const isIsoUtc = (s: unknown): s is string =>
  typeof s === 'string' && ISO_UTC_RE.test(s) && !Number.isNaN(Date.parse(s))
const hasControl = (s: string) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)

export function validateRequest(raw: string): Valid | Invalid {
  if (Buffer.byteLength(raw, 'utf8') > MAX_START_STDIN_BYTES) return bad('too_large', 'request exceeds 160 KiB')
  let j: any
  try { j = JSON.parse(raw) } catch { return bad('malformed', 'not JSON') }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return bad('malformed', 'not an object')
  for (const k of Object.keys(j)) if (!KEYS.has(k)) return bad('malformed', `unknown field: ${k.slice(0, 40)}`)
  if (j.v !== 1) return bad('malformed', 'v must be 1')
  if (typeof j.id !== 'string' || !ID_RE.test(j.id)) return bad('malformed', 'id')
  if (typeof j.from_device !== 'string' || !DEVICE_RE.test(j.from_device)) return bad('malformed', 'from_device')
  if (typeof j.to_device !== 'string' || !DEVICE_RE.test(j.to_device)) return bad('malformed', 'to_device')
  if (!isIsoUtc(j.issued_at) || !isIsoUtc(j.expires_at)) return bad('malformed', 'issued_at/expires_at must be RFC 3339 UTC')
  if (!(RUNTIMES as readonly string[]).includes(j.runtime)) return bad('malformed', 'runtime')
  if (j.mode !== 'job') return bad('malformed', 'mode must be job in Phase 0')
  for (const k of ['model', 'provider', 'effort'] as const) {
    if (j[k] !== undefined && (typeof j[k] !== 'string' || !TOKEN_RE.test(j[k]))) return bad('malformed', k)
  }
  if (typeof j.cwd !== 'string' || j.cwd.length === 0 || j.cwd.length > 1024 || hasControl(j.cwd)
    || !(j.cwd === '~' || j.cwd.startsWith('~/') || j.cwd.startsWith('/'))) return bad('malformed', 'cwd')
  if (j.access !== 'review' && j.access !== 'edit') return bad('malformed', 'access')
  if (!Number.isInteger(j.timeout_s) || j.timeout_s < 1 || j.timeout_s > 86_400) return bad('malformed', 'timeout_s')
  if (j.label !== undefined && (typeof j.label !== 'string' || j.label.length > 120 || hasControl(j.label))) return bad('malformed', 'label')
  if (j.origin !== undefined) {
    const o = j.origin
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return bad('malformed', 'origin')
    for (const k of Object.keys(o)) if (!ORIGIN_KEYS.has(k)) return bad('malformed', 'origin field')
    if (o.harness !== undefined && (typeof o.harness !== 'string' || !TOKEN_RE.test(o.harness))) return bad('malformed', 'origin.harness')
    if (o.pid !== undefined && !Number.isInteger(o.pid)) return bad('malformed', 'origin.pid')
    if (o.started_at !== undefined && (typeof o.started_at !== 'string' || o.started_at.length > 64)) return bad('malformed', 'origin.started_at')
  }
  if (typeof j.prompt !== 'string' || j.prompt.length === 0 || j.prompt.includes('\u0000')) return bad('malformed', 'prompt')
  if (Buffer.byteLength(j.prompt, 'utf8') > MAX_PROMPT_BYTES) return bad('too_large', 'prompt exceeds 128 KiB')
  return { ok: true, request: j as SummonRequest }
}

export type TimingOk = { ok: true; expiresAtMs: number; timeoutS: number }
export type TimingBad = { ok: false; reason: 'expired' | 'clock'; detail: string }

/** Expiry, ±5 min skew, admission clamped to 24 h, job timeout clamped to the allowlist's max. */
export function checkTiming(req: SummonRequest, nowMs: number, jobTimeoutMaxS: number): TimingOk | TimingBad {
  const issued = Date.parse(req.issued_at)
  const expires = Date.parse(req.expires_at)
  const clocks = `target ${new Date(nowMs).toISOString()}, request issued ${req.issued_at}`
  if (issued - nowMs > CLOCK_SKEW_MS) return { ok: false, reason: 'clock', detail: clocks }
  const effective = Math.min(expires, issued + MAX_ADMISSION_MS)
  if (effective <= issued || nowMs > effective + CLOCK_SKEW_MS) {
    return { ok: false, reason: 'expired', detail: `expired at ${new Date(effective).toISOString()}; ${clocks}` }
  }
  return { ok: true, expiresAtMs: effective, timeoutS: Math.min(req.timeout_s, jobTimeoutMaxS) }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/summon && bun test tests/request.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add packages/summon
git commit -m "feat(summon): package skeleton and the closed request model

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

---

### Task 2: The allowlist

**Files:**
- Create: `packages/summon/src/allowlist.ts`
- Test: `packages/summon/tests/allowlist.test.ts`

**Interfaces:**
- Consumes: `SummonRequest`, `Access`, `Runtime`, `RUNTIMES`, `DEVICE_RE` (Task 1)
- Produces:
  - types `Allowlist`, `AllowlistRuntime`, `AllowlistFolder`, `AllowlistModel`
  - `parseAllowlist(text): {ok:true, allowlist} | {ok:false, detail}`
  - `loadAllowlist(path)` (same return)
  - `checkAdmission(req, al, home, realpath?): Admission`
  - `expandHome(p, home)`, `safeRealpath(p)`, `parseDurationS(v)`, `TCC_PROTECTED`

- [ ] **Step 1: Write the failing test**

`packages/summon/tests/allowlist.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAdmission, parseAllowlist, parseDurationS, type Allowlist } from '../src/allowlist.ts'
import { sampleRequest } from './request.test.ts'

const tmps: string[] = []
function home(): string {
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'summon-al-')))
  tmps.push(h)
  for (const d of ['Projects/x', 'Projects/y', 'Documents/secret', 'Desktop']) mkdirSync(join(h, d), { recursive: true })
  return h
}
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }) })

const YAML = `version: 1
device: nuance
peers: [air]
runtimes:
  - id: claude
    models: [{ model: sonnet }, { model: haiku }]
folders:
  - path: ~/Projects
    access: review
limits:
  max_concurrent: 1
  starts_per_hour: 6
  job_timeout_max: 30m
`
const al = (): Allowlist => {
  const r = parseAllowlist(YAML)
  if (!r.ok) throw new Error(r.detail)
  return r.allowlist
}

describe('parseAllowlist', () => {
  test('parses the installer default', () => {
    expect(al()).toMatchObject({ device: 'nuance', peers: ['air'], limits: { job_timeout_max_s: 1800 } })
  })
  test('rejects bad shapes', () => {
    expect(parseAllowlist('version: 2').ok).toBe(false)
    expect(parseAllowlist(YAML.replace('id: claude', 'id: bash')).ok).toBe(false)
    expect(parseAllowlist(YAML.replace('access: review', 'access: root')).ok).toBe(false)
    expect(parseAllowlist(': : :').ok).toBe(false)
  })
  test('durations', () => {
    expect(parseDurationS('30m')).toBe(1800)
    expect(parseDurationS('2h')).toBe(7200)
    expect(parseDurationS(45)).toBe(45)
    expect(parseDurationS('1d')).toBeNull()
  })
})

describe('checkAdmission', () => {
  test('admits claude/sonnet review inside ~/Projects', () => {
    const h = home()
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/x' }), al(), h)).toEqual({ ok: true, cwdReal: join(h, 'Projects/x') })
  })
  test('refuses edit in a review folder, with a hint', () => {
    const r = checkAdmission(sampleRequest({ access: 'edit' }), al(), home())
    expect(r).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect((r as { hint?: string }).hint).toContain('access: edit')
  })
  test('refuses an unknown peer, runtime or model', () => {
    const h = home()
    expect(checkAdmission(sampleRequest({ from_device: 'phone' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ runtime: 'codex' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ model: 'opus' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ model: 'sonnet', effort: 'high' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
  })
  test('codex/hermes need reads_anywhere; hermes is review-only', () => {
    const h = home()
    const withCodex = parseAllowlist(YAML.replace('folders:', `  - id: codex\n    models: [{ model: gpt-6-astra }]\nfolders:`))
    if (!withCodex.ok) throw new Error(withCodex.detail)
    expect(checkAdmission(sampleRequest({ runtime: 'codex', model: 'gpt-6-astra' }), withCodex.allowlist, h))
      .toMatchObject({ ok: false, reason: 'outside_allowlist' })
  })
  test('refuses a folder that does not exist or is outside the allowlist', () => {
    const h = home()
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/nope' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ cwd: '/' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
  })
  test('refuses TCC-protected folders even when allowlisted', () => {
    const h = home()
    const docs = parseAllowlist(YAML.replace('path: ~/Projects', 'path: ~/Documents'))
    if (!docs.ok) throw new Error(docs.detail)
    expect(checkAdmission(sampleRequest({ cwd: '~/Documents/secret' }), docs.allowlist, h)).toMatchObject({ ok: false, reason: 'tcc_protected_folder' })
  })
  test('a symlink from an allowlisted folder into ~/Documents is refused by its target, not its spelling', () => {
    const h = home()
    symlinkSync(join(h, 'Documents/secret'), join(h, 'Projects/x/escape'))
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/x/escape' }), al(), h)).toMatchObject({ ok: false, reason: 'tcc_protected_folder' })
  })
  test('a symlink out of the allowlist is refused', () => {
    const h = home()
    mkdirSync(join(h, 'elsewhere'))
    symlinkSync(join(h, 'elsewhere'), join(h, 'Projects/y/out'))
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/y/out' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/summon && bun test tests/allowlist.test.ts`
Expected: FAIL — module `../src/allowlist.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/summon/src/allowlist.ts`:

```ts
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { DEVICE_RE, RUNTIMES, type Access, type Runtime, type SummonRequest } from './request.ts'

export interface AllowlistModel { model: string; provider?: string; effort?: string[] }
export interface AllowlistRuntime { id: Runtime; models: AllowlistModel[]; reads_anywhere: boolean }
export interface AllowlistFolder { path: string; access: Access }
export interface Allowlist {
  version: 1
  device: string
  peers: string[]
  runtimes: AllowlistRuntime[]
  folders: AllowlistFolder[]
  limits: { max_concurrent: number; starts_per_hour: number; job_timeout_max_s: number }
}
type Parsed = { ok: true; allowlist: Allowlist } | { ok: false; detail: string }

const TOKEN_RE = /^[A-Za-z0-9._:-]{1,64}$/
export const TCC_PROTECTED = ['Desktop', 'Documents', 'Downloads', 'Library/Mobile Documents']

export function parseDurationS(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null
  if (typeof v !== 'string') return null
  const m = /^(\d+)(s|m|h)$/.exec(v.trim())
  if (!m) return null
  return Number(m[1]) * ({ s: 1, m: 60, h: 3600 } as const)[m[2] as 's' | 'm' | 'h']
}

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi

export function parseAllowlist(text: string): Parsed {
  let y: any
  try { y = Bun.YAML.parse(text) } catch (e) { return { ok: false, detail: `yaml: ${String((e as Error).message).slice(0, 120)}` } }
  const fail = (detail: string): Parsed => ({ ok: false, detail })
  if (!y || typeof y !== 'object' || Array.isArray(y)) return fail('not a mapping')
  if (y.version !== 1) return fail('version must be 1')
  if (typeof y.device !== 'string' || !DEVICE_RE.test(y.device)) return fail('device')
  if (!Array.isArray(y.peers) || !y.peers.every((p: unknown) => typeof p === 'string' && DEVICE_RE.test(p))) return fail('peers')
  if (!Array.isArray(y.runtimes)) return fail('runtimes')
  const runtimes: AllowlistRuntime[] = []
  for (const r of y.runtimes) {
    if (!r || !(RUNTIMES as readonly string[]).includes(r.id)) return fail('runtime id')
    if (!Array.isArray(r.models) || r.models.length === 0) return fail(`models for ${r.id}`)
    const models: AllowlistModel[] = []
    for (const m of r.models) {
      if (!m || typeof m.model !== 'string' || !TOKEN_RE.test(m.model)) return fail(`model in ${r.id}`)
      if (m.provider !== undefined && (typeof m.provider !== 'string' || !TOKEN_RE.test(m.provider))) return fail(`provider in ${r.id}`)
      if (m.effort !== undefined && (!Array.isArray(m.effort) || !m.effort.every((e: unknown) => typeof e === 'string' && TOKEN_RE.test(e)))) return fail(`effort in ${r.id}`)
      models.push({ model: m.model, ...(m.provider ? { provider: m.provider } : {}), ...(m.effort ? { effort: m.effort } : {}) })
    }
    runtimes.push({ id: r.id, models, reads_anywhere: r.reads_anywhere === true })
  }
  if (!Array.isArray(y.folders)) return fail('folders')
  const folders: AllowlistFolder[] = []
  for (const f of y.folders) {
    if (!f || typeof f.path !== 'string' || !(f.path === '~' || f.path.startsWith('~/') || f.path.startsWith('/'))) return fail('folder path')
    if (f.access !== 'review' && f.access !== 'edit') return fail('folder access')
    folders.push({ path: f.path, access: f.access })
  }
  const l = y.limits ?? {}
  const timeout = parseDurationS(l.job_timeout_max)
  if (!isInt(l.max_concurrent, 1, 8) || !isInt(l.starts_per_hour, 1, 120) || timeout === null || timeout > 86_400) return fail('limits')
  return {
    ok: true,
    allowlist: { version: 1, device: y.device, peers: y.peers, runtimes, folders,
      limits: { max_concurrent: l.max_concurrent, starts_per_hour: l.starts_per_hour, job_timeout_max_s: timeout } },
  }
}

export function loadAllowlist(path: string): Parsed {
  let text: string
  try { text = readFileSync(path, 'utf8') } catch { return { ok: false, detail: 'missing' } }
  return parseAllowlist(text)
}

export function expandHome(p: string, home: string): string {
  return p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p
}

export function safeRealpath(p: string): string | null {
  try { return realpathSync.native(p) } catch { return null }
}

const within = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith('/') ? parent : parent + '/')
const rank = (a: Access) => (a === 'review' ? 0 : 1)

export type Admission =
  | { ok: true; cwdReal: string }
  | { ok: false; reason: 'outside_allowlist' | 'tcc_protected_folder'; detail: string; hint?: string }

export function checkAdmission(req: SummonRequest, al: Allowlist, home: string,
  realpath: (p: string) => string | null = safeRealpath): Admission {
  const out = (detail: string, hint?: string): Admission => ({ ok: false, reason: 'outside_allowlist', detail, ...(hint ? { hint } : {}) })
  if (!al.peers.includes(req.from_device)) return out(`peer ${req.from_device} is not allowed`, `peers: [${[...al.peers, req.from_device].join(', ')}]`)
  const rt = al.runtimes.find((r) => r.id === req.runtime)
  if (!rt) return out(`runtime ${req.runtime} is not allowed`, `runtimes:\n  - id: ${req.runtime}\n    models: [{ model: ${req.model ?? 'sonnet'} }]`)
  if (rt.id !== 'claude' && !rt.reads_anywhere) return out(`${rt.id} can read any file on this Mac; allowlist it with reads_anywhere: true`)
  if (rt.id === 'hermes' && req.access !== 'review') return out('hermes is review-only')
  if (!req.model) return out('a model is required')
  const m = rt.models.find((e) => e.model === req.model && e.provider === req.provider
    && (req.effort === undefined ? e.effort === undefined : (e.effort ?? []).includes(req.effort)))
  if (!m) return out(`model ${req.model}${req.provider ? '/' + req.provider : ''}${req.effort ? ' effort ' + req.effort : ''} is not allowed for ${rt.id}`)
  const cwdReal = realpath(expandHome(req.cwd, home))
  if (!cwdReal) return out(`cwd ${req.cwd} does not exist on this Mac`)
  for (const p of TCC_PROTECTED) {
    const pr = realpath(join(home, p)) ?? join(home, p)
    if (within(cwdReal, pr)) return { ok: false, reason: 'tcc_protected_folder', detail: `${req.cwd} is inside ~/${p}` }
  }
  let best: { real: string; f: AllowlistFolder } | null = null
  for (const f of al.folders) {
    const fr = realpath(expandHome(f.path, home))
    if (fr && within(cwdReal, fr) && (!best || fr.length > best.real.length)) best = { real: fr, f }
  }
  if (!best) return out(`folder ${req.cwd} is not allowed`, `folders:\n  - path: ${req.cwd}\n    access: ${req.access}`)
  if (rank(req.access) > rank(best.f.access)) return out(`${req.access} is not allowed in ${best.f.path} (${best.f.access})`, `folders:\n  - path: ${best.f.path}\n    access: edit`)
  return { ok: true, cwdReal }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/summon && bun test tests/allowlist.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/summon/src/allowlist.ts packages/summon/tests/allowlist.test.ts
git commit -m "feat(summon): allowlist parsing and admission (symlinks, TCC folders, model triples)

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

---

### Task 3: Ledger, replay set, and job store

**Files:**
- Create: `packages/summon/src/ledger.ts`, `packages/summon/src/replay.ts`, `packages/summon/src/jobs.ts`
- Test: `packages/summon/tests/store.test.ts`

**Interfaces:**
- Consumes: `canonicalJson`, `ID_RE`, `SummonPaths`, `JobStatus`, `Runtime`, `Access`, `TERMINAL`
- Produces:
  - `appendLedger(path, fields, nowMs?): LedgerEntry`
  - `verifyLedger(path): {ok, entries, brokenAt?}`
  - `claimId(seenDir, id): boolean`
  - `pruneSeen(seenDir, nowMs, maxAgeMs?): number`
  - types `JobState`, `JobResult`
  - `jobDir(paths, id)`, `writeJsonAtomic(path, obj)`, `readJson<T>(path)`, `readState(paths, id)`, `writeState(paths, s)`
  - `heartbeatAgeS(paths, id, nowMs)`, `countActive(paths)`, `admittedSince(paths, sinceMs)`

- [ ] **Step 1: Write the failing test**

`packages/summon/tests/store.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendLedger, verifyLedger } from '../src/ledger.ts'
import { claimId, pruneSeen } from '../src/replay.ts'
import { admittedSince, countActive, jobDir, readState, writeState, type JobState } from '../src/jobs.ts'
import { summonPaths } from '../src/paths.ts'
import { newRequestId } from '../src/request.ts'

const tmps: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'summon-st-')); tmps.push(d); return d }
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }) })

describe('ledger', () => {
  test('chains entries and verifies', () => {
    const p = join(tmp(), 'state', 'ledger.jsonl')
    appendLedger(p, { event: 'admitted', id: 'smn_' + '0'.repeat(32) })
    appendLedger(p, { event: 'refused', reason: 'replayed' })
    expect(verifyLedger(p)).toEqual({ ok: true, entries: 2 })
    expect(statSync(p).mode & 0o777).toBe(0o600)
  })
  test('detects an edited entry', () => {
    const p = join(tmp(), 'ledger.jsonl')
    appendLedger(p, { event: 'admitted' })
    appendLedger(p, { event: 'refused', reason: 'busy' })
    writeFileSync(p, readFileSync(p, 'utf8').replace('"busy"', '"rate_limited"'))
    expect(verifyLedger(p)).toMatchObject({ ok: false, brokenAt: 2 })
  })
  test('never records a prompt field', () => {
    const p = join(tmp(), 'ledger.jsonl')
    appendLedger(p, { event: 'admitted', prompt: 'secret' } as never)
    expect(readFileSync(p, 'utf8')).not.toContain('secret')
  })
})

describe('replay set', () => {
  test('claims an id once', () => {
    const d = join(tmp(), 'seen'); const id = newRequestId()
    expect(claimId(d, id)).toBe(true)
    expect(claimId(d, id)).toBe(false)
  })
  test('refuses to build a path from a bad id', () => {
    expect(() => claimId(join(tmp(), 'seen'), '../x')).toThrow()
  })
  test('prunes ids older than the window', () => {
    const d = join(tmp(), 'seen'); const id = newRequestId()
    claimId(d, id)
    const old = (Date.now() - 31 * 86_400_000) / 1000
    utimesSync(join(d, id), old, old)
    expect(pruneSeen(d, Date.now())).toBe(1)
    expect(claimId(d, id)).toBe(true)
  })
})

describe('job store', () => {
  const state = (id: string, status: JobState['status'], admitted: number): JobState => ({
    id, status, runtime: 'claude', model: 'sonnet', access: 'review', cwd_real: '/x',
    admitted_at: new Date(admitted).toISOString(), expires_at: new Date(admitted + 900_000).toISOString(), timeout_s: 900,
  })
  test('counts active jobs and recent admissions', () => {
    const paths = summonPaths(tmp())
    const now = Date.now()
    writeState(paths, state(newRequestId(), 'running', now))
    writeState(paths, state(newRequestId(), 'completed', now - 7_200_000))
    writeState(paths, state(newRequestId(), 'queued', now - 60_000))
    expect(countActive(paths)).toBe(2)
    expect(admittedSince(paths, now - 3_600_000)).toBe(2)
  })
  test('round-trips state with 0600 files in 0700 dirs', () => {
    const paths = summonPaths(tmp()); const id = newRequestId()
    writeState(paths, state(id, 'queued', Date.now()))
    expect(readState(paths, id)?.status).toBe('queued')
    expect(statSync(jobDir(paths, id)).mode & 0o777).toBe(0o700)
    expect(statSync(join(jobDir(paths, id), 'state.json')).mode & 0o777).toBe(0o600)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/summon && bun test tests/store.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`packages/summon/src/ledger.ts`:

```ts
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { canonicalJson } from './json.ts'

export interface LedgerFields {
  event: string
  id?: string
  status?: string
  reason?: string
  detail?: string
  from?: string
  runtime?: string
  model?: string
  cwd?: string
  access?: string
}
export interface LedgerEntry extends LedgerFields { ts: string; prev: string; hash: string }

const ALLOWED = ['event', 'id', 'status', 'reason', 'detail', 'from', 'runtime', 'model', 'cwd', 'access'] as const
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function lastHash(path: string): string {
  if (!existsSync(path)) return 'genesis'
  const text = readFileSync(path, 'utf8').trimEnd()
  if (!text) return 'genesis'
  return JSON.parse(text.slice(text.lastIndexOf('\n') + 1)).hash
}

function withLock<T>(path: string, fn: () => T): T {
  const lock = path + '.lock'
  const deadline = Date.now() + 3000
  for (;;) {
    try { closeSync(openSync(lock, 'wx', 0o600)); break } catch (e: any) {
      if (e.code !== 'EEXIST') throw e
      try { if (Date.now() - statSync(lock).mtimeMs > 10_000) unlinkSync(lock) } catch { /* raced */ }
      if (Date.now() > deadline) throw new Error('ledger lock timeout')
      Bun.sleepSync(20)
    }
  }
  try { return fn() } finally { try { unlinkSync(lock) } catch { /* gone */ } }
}

/** Append one hash-chained entry. Only the known metadata fields travel; never a prompt or result. */
export function appendLedger(path: string, fields: LedgerFields, nowMs: number = Date.now()): LedgerEntry {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  return withLock(path, () => {
    const picked: Record<string, string> = {}
    for (const k of ALLOWED) {
      const v = (fields as Record<string, unknown>)[k]
      if (typeof v === 'string') picked[k] = v.slice(0, 500)
    }
    const body = { ...picked, ts: new Date(nowMs).toISOString(), prev: lastHash(path) }
    const entry = { ...body, hash: sha(canonicalJson(body)) } as LedgerEntry
    appendFileSync(path, JSON.stringify(entry) + '\n', { mode: 0o600 })
    return entry
  })
}

export function verifyLedger(path: string): { ok: boolean; entries: number; brokenAt?: number } {
  if (!existsSync(path)) return { ok: true, entries: 0 }
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  let prev = 'genesis'
  for (let i = 0; i < lines.length; i++) {
    let e: any
    try { e = JSON.parse(lines[i]!) } catch { return { ok: false, entries: i, brokenAt: i + 1 } }
    const { hash, ...body } = e
    if (body.prev !== prev || sha(canonicalJson(body)) !== hash) return { ok: false, entries: i, brokenAt: i + 1 }
    prev = hash
  }
  return { ok: true, entries: lines.length }
}
```

`packages/summon/src/replay.ts`:

```ts
import { closeSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { ID_RE } from './request.ts'

/** True the first time an id is seen; the O_EXCL create makes concurrent claims race-free. */
export function claimId(seenDir: string, id: string): boolean {
  if (!ID_RE.test(id)) throw new Error('bad id')
  mkdirSync(seenDir, { recursive: true, mode: 0o700 })
  try { closeSync(openSync(join(seenDir, id), 'wx', 0o600)); return true } catch (e: any) {
    if (e.code === 'EEXIST') return false
    throw e
  }
}

export function pruneSeen(seenDir: string, nowMs: number, maxAgeMs: number = 30 * 86_400_000): number {
  let n = 0
  let names: string[] = []
  try { names = readdirSync(seenDir) } catch { return 0 }
  for (const name of names) {
    if (!ID_RE.test(name)) continue
    const p = join(seenDir, name)
    try { if (nowMs - statSync(p).mtimeMs > maxAgeMs) { unlinkSync(p); n++ } } catch { /* gone */ }
  }
  return n
}
```

`packages/summon/src/jobs.ts`:

```ts
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SummonPaths } from './paths.ts'
import { ID_RE, type Access, type Runtime } from './request.ts'
import type { JobStatus } from './status.ts'

export interface JobState {
  id: string
  status: JobStatus
  reason?: string
  detail?: string
  runtime: Runtime
  model: string
  access: Access
  cwd_real: string
  admitted_at: string
  expires_at: string
  timeout_s: number
  started_at?: string
  ended_at?: string
  pid?: number
}
export interface JobResult {
  status: JobStatus
  reason?: string
  detail?: string
  result_text?: string
  exit_code?: number | null
  num_turns?: number
  cost_usd?: number
  resets_at?: string
}

export function jobDir(paths: SummonPaths, id: string): string {
  if (!ID_RE.test(id)) throw new Error('bad id')
  return join(paths.jobs, id)
}

export function writeJsonAtomic(path: string, obj: unknown): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 })
  renameSync(tmp, path)
}

export function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return null }
}

export function readState(paths: SummonPaths, id: string): JobState | null {
  return readJson<JobState>(join(jobDir(paths, id), 'state.json'))
}

export function writeState(paths: SummonPaths, s: JobState): void {
  const dir = jobDir(paths, s.id)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeJsonAtomic(join(dir, 'state.json'), s)
}

export function heartbeatAgeS(paths: SummonPaths, id: string, nowMs: number): number | null {
  try { return Math.round((nowMs - statSync(join(jobDir(paths, id), 'heartbeat')).mtimeMs) / 1000) } catch { return null }
}

function allStates(paths: SummonPaths): JobState[] {
  let names: string[] = []
  try { names = readdirSync(paths.jobs) } catch { return [] }
  return names.filter((n) => ID_RE.test(n)).map((n) => readState(paths, n)).filter((s): s is JobState => s !== null)
}

export function countActive(paths: SummonPaths): number {
  return allStates(paths).filter((s) => s.status === 'queued' || s.status === 'running').length
}

export function admittedSince(paths: SummonPaths, sinceMs: number): number {
  return allStates(paths).filter((s) => Date.parse(s.admitted_at) >= sinceMs).length
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/summon && bun test tests/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/summon/src/{ledger,replay,jobs}.ts packages/summon/tests/store.test.ts
git commit -m "feat(summon): hash-chained ledger, race-free replay set, job store

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

---

### Task 4: The gate decision

**Files:**
- Create: `packages/summon/src/gate.ts`
- Test: `packages/summon/tests/gate.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`validateRequest`, `checkTiming`, `loadAllowlist`, `checkAdmission`, `claimId`, `appendLedger`, `writeState`, `writeJsonAtomic`, `jobDir`, `countActive`, `admittedSince`, `SummonPaths`, `GateResponse`)
- Produces:
  - `interface GateDeps { nowMs(): number; home: string; paths: SummonPaths; guiSessionIsMine(): boolean; runnerLoaded(): boolean; claudeAvailable(): boolean; realpath?: (p: string) => string | null }`
  - `gateStart(raw: string, deps: GateDeps): GateResponse`. When admitted, it writes `jobs/<id>/{request.json,state.json}` and the marker `spool/<id>`.

- [ ] **Step 1: Write the failing test**

`packages/summon/tests/gate.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gateStart, type GateDeps } from '../src/gate.ts'
import { summonPaths } from '../src/paths.ts'
import { sampleRequest } from './request.test.ts'

export const DEFAULT_ALLOWLIST = `version: 1
device: nuance
peers: [air]
runtimes:
  - id: claude
    models: [{ model: sonnet }, { model: haiku }]
folders:
  - path: ~/Projects
    access: review
limits:
  max_concurrent: 1
  starts_per_hour: 6
  job_timeout_max: 30m
`
const tmps: string[] = []
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }) })

export function targetHome(allowlist = DEFAULT_ALLOWLIST): string {
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'summon-gate-')))
  tmps.push(h)
  mkdirSync(join(h, 'Projects/x'), { recursive: true })
  mkdirSync(join(h, '.config/summon'), { recursive: true })
  writeFileSync(join(h, '.config/summon/allowlist.yaml'), allowlist)
  return h
}
const deps = (home: string, over: Partial<GateDeps> = {}): GateDeps => ({
  nowMs: () => Date.now(), home, paths: summonPaths(home),
  guiSessionIsMine: () => true, runnerLoaded: () => true, claudeAvailable: () => true, ...over,
})

describe('gateStart', () => {
  test('admits and spools an allowlisted request', () => {
    const h = targetHome(); const req = sampleRequest()
    const r = gateStart(JSON.stringify(req), deps(h))
    expect(r).toEqual({ status: 'admitted', handle: `nuance/${req.id}` })
    expect(existsSync(join(h, '.local/state/summon/spool', req.id))).toBe(true)
    const state = JSON.parse(readFileSync(join(h, '.local/state/summon/jobs', req.id, 'state.json'), 'utf8'))
    expect(state).toMatchObject({ status: 'queued', cwd_real: join(h, 'Projects/x'), timeout_s: 900 })
    expect(readFileSync(join(h, '.local/state/summon/ledger.jsonl'), 'utf8')).not.toContain(req.prompt)
  })
  test('refuses, in order, with the closed reasons', () => {
    const h = targetHome()
    expect(gateStart('{', deps(h))).toMatchObject({ status: 'refused', reason: 'malformed' })
    expect(gateStart(JSON.stringify(sampleRequest({ to_device: 'other' })), deps(h))).toMatchObject({ reason: 'malformed' })
    const old = sampleRequest({ issued_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-01T00:15:00Z' })
    expect(gateStart(JSON.stringify(old), deps(h))).toMatchObject({ reason: 'expired' })
    const dup = sampleRequest()
    gateStart(JSON.stringify(dup), deps(h, { guiSessionIsMine: () => false }))
    expect(gateStart(JSON.stringify(dup), deps(h))).toMatchObject({ reason: 'replayed' })
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h, { guiSessionIsMine: () => false }))).toMatchObject({ reason: 'target_logged_out' })
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h, { runnerLoaded: () => false }))).toMatchObject({ reason: 'runner_missing' })
    expect(gateStart(JSON.stringify(sampleRequest({ cwd: '~/Elsewhere' })), deps(h))).toMatchObject({ reason: 'outside_allowlist' })
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h, { claudeAvailable: () => false }))).toMatchObject({ reason: 'runtime_unavailable' })
  })
  test('busy when the concurrency limit is full; rate_limited past starts_per_hour', () => {
    const h = targetHome()
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h)).status).toBe('admitted')
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h))).toMatchObject({ reason: 'busy' })
    const h2 = targetHome(DEFAULT_ALLOWLIST.replace('max_concurrent: 1', 'max_concurrent: 8').replace('starts_per_hour: 6', 'starts_per_hour: 1'))
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h2)).status).toBe('admitted')
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h2))).toMatchObject({ reason: 'rate_limited' })
  })
  test('a missing allowlist refuses as outside_allowlist', () => {
    const h = targetHome(); rmSync(join(h, '.config/summon/allowlist.yaml'))
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h))).toMatchObject({ reason: 'outside_allowlist' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/summon && bun test tests/gate.test.ts`
Expected: FAIL — `../src/gate.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/summon/src/gate.ts`:

```ts
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkAdmission, loadAllowlist } from './allowlist.ts'
import { admittedSince, countActive, jobDir, writeJsonAtomic, writeState } from './jobs.ts'
import { appendLedger } from './ledger.ts'
import type { SummonPaths } from './paths.ts'
import { claimId } from './replay.ts'
import { checkTiming, validateRequest, type SummonRequest } from './request.ts'
import type { GateResponse, RefusalReason } from './status.ts'

export interface GateDeps {
  nowMs(): number
  home: string
  paths: SummonPaths
  guiSessionIsMine(): boolean
  runnerLoaded(): boolean
  claudeAvailable(): boolean
  realpath?: (p: string) => string | null
}

function refuse(deps: GateDeps, req: SummonRequest | null, reason: RefusalReason, detail: string, hint?: string): GateResponse {
  appendLedger(deps.paths.ledger, { event: 'refused', id: req?.id, reason, detail, from: req?.from_device, runtime: req?.runtime, cwd: req?.cwd, access: req?.access }, deps.nowMs())
  return { status: 'refused', reason, detail, ...(hint ? { hint } : {}) }
}

/** Spec §2 order: schema, device, timing, replay, GUI session + runner, allowlist, runtime, rate, concurrency. */
export function gateStart(raw: string, deps: GateDeps): GateResponse {
  const now = deps.nowMs()
  const v = validateRequest(raw)
  if (!v.ok) return refuse(deps, null, v.reason, v.detail)
  const req = v.request
  const al = loadAllowlist(deps.paths.allowlist)
  if (!al.ok) return refuse(deps, req, 'outside_allowlist', `allowlist: ${al.detail}`)
  if (req.to_device !== al.allowlist.device) return refuse(deps, req, 'malformed', `to_device ${req.to_device} is not ${al.allowlist.device}`)
  const t = checkTiming(req, now, al.allowlist.limits.job_timeout_max_s)
  if (!t.ok) return refuse(deps, req, t.reason, t.detail)
  if (!claimId(deps.paths.seen, req.id)) return refuse(deps, req, 'replayed', 'this id was already received')
  if (!deps.guiSessionIsMine()) return refuse(deps, req, 'target_logged_out', 'Yu is not logged in at this Mac')
  if (!deps.runnerLoaded()) return refuse(deps, req, 'runner_missing', 'dev.summon.runner is not loaded')
  const adm = checkAdmission(req, al.allowlist, deps.home, deps.realpath)
  if (!adm.ok) return refuse(deps, req, adm.reason, adm.detail, adm.hint)
  if (req.runtime !== 'claude') return refuse(deps, req, 'runtime_unavailable', `${req.runtime} is not wired in Phase 0`)
  if (!deps.claudeAvailable()) return refuse(deps, req, 'runtime_unavailable', 'claude is not installed on this Mac')
  if (admittedSince(deps.paths, now - 3_600_000) >= al.allowlist.limits.starts_per_hour) return refuse(deps, req, 'rate_limited', `more than ${al.allowlist.limits.starts_per_hour} starts in the last hour`)
  if (countActive(deps.paths) >= al.allowlist.limits.max_concurrent) return refuse(deps, req, 'busy', `${al.allowlist.limits.max_concurrent} summon(s) already queued or running`)

  const dir = jobDir(deps.paths, req.id)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeJsonAtomic(join(dir, 'request.json'), req)
  writeState(deps.paths, {
    id: req.id, status: 'queued', runtime: req.runtime, model: req.model!, access: req.access, cwd_real: adm.cwdReal,
    admitted_at: new Date(now).toISOString(), expires_at: new Date(t.expiresAtMs).toISOString(), timeout_s: t.timeoutS,
  })
  mkdirSync(deps.paths.spool, { recursive: true, mode: 0o700 })
  const marker = join(deps.paths.spool, req.id)
  writeFileSync(`${marker}.tmp`, '', { mode: 0o600 })
  renameSync(`${marker}.tmp`, marker)
  appendLedger(deps.paths.ledger, { event: 'admitted', id: req.id, from: req.from_device, runtime: req.runtime, model: req.model, cwd: req.cwd, access: req.access }, now)
  return { status: 'admitted', handle: `${al.allowlist.device}/${req.id}` }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/summon && bun test tests/gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/summon/src/gate.ts packages/summon/tests/gate.test.ts
git commit -m "feat(summon): the gate — closed refusal order, spooling on admission

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

---

### Task 5: Gatekeeper commands and entry point

**Files:**
- Create: `packages/summon/src/gatekeeper.ts`, `packages/summon/src/gatekeeper-main.ts`
- Test: `packages/summon/tests/gatekeeper.test.ts`

**Interfaces:**
- Consumes: `gateStart`, `GateDeps`, `readState`, `readJson`, `heartbeatAgeS`, `jobDir`, `appendLedger`, `summonPaths`, `TERMINAL`, `MAX_START_STDIN_BYTES`
- Produces:
  - `parseCommand(raw: string | undefined): Command | null`
  - `readBoundedStdin(stream, max): Promise<{ text: string; tooLarge: boolean }>`
  - `statusOf(paths, device, id, nowMs): GateResponse`
  - `resultOf(paths, device, id, nowMs): GateResponse`
  - `requestCancel(paths, device, id, nowMs): GateResponse`
  - `requestInventory(paths, nowMs, waitMs): Promise<GateResponse>`
  - `sanitizeForLog(s)`
  - `liveGateDeps(paths): GateDeps`
- The entry point `gatekeeper-main.ts` reads `SSH_ORIGINAL_COMMAND` and prints exactly one JSON line. Exit codes: 0 answered, 2 refused command.

- [ ] **Step 1: Write the failing test**

`packages/summon/tests/gatekeeper.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { parseCommand, readBoundedStdin, requestCancel, statusOf } from '../src/gatekeeper.ts'
import { summonPaths } from '../src/paths.ts'
import { newRequestId } from '../src/request.ts'
import { writeState } from '../src/jobs.ts'
import { existsSync } from 'node:fs'
import { targetHome } from './gate.test.ts'
import { sampleRequest } from './request.test.ts'

const MAIN = join(import.meta.dir, '..', 'src', 'gatekeeper-main.ts')
export async function runGatekeeper(home: string, command: string | undefined, stdin = ''): Promise<{ code: number; out: any }> {
  const env: Record<string, string> = { PATH: process.env.PATH!, HOME: home, SUMMON_HOME_OVERRIDE: home, SUMMON_TEST_GUI: '1', SUMMON_TEST_RUNNER: '1', SUMMON_CLAUDE_BIN: '/bin/echo' }
  if (command !== undefined) env.SSH_ORIGINAL_COMMAND = command
  const p = Bun.spawn(['bun', MAIN], { env, stdin: new Blob([stdin]), stdout: 'pipe', stderr: 'pipe' })
  const text = await new Response(p.stdout).text()
  const code = await p.exited
  return { code, out: JSON.parse(text.trim().split('\n').pop()!) }
}

describe('parseCommand', () => {
  const id = 'smn_' + 'a'.repeat(32)
  test('accepts exactly the five verbs', () => {
    expect(parseCommand('inventory')).toEqual({ verb: 'inventory' })
    expect(parseCommand('start')).toEqual({ verb: 'start' })
    expect(parseCommand(`status ${id}`)).toEqual({ verb: 'status', id })
    expect(parseCommand(`result ${id}`)).toEqual({ verb: 'result', id })
    expect(parseCommand(`cancel ${id}`)).toEqual({ verb: 'cancel', id })
  })
  test('refuses every variant', () => {
    for (const raw of [undefined, '', ' start', 'start ', 'start\n', 'start;ls', 'start && ls', 'START', 'ls -la',
      `status  ${id}`, `status\t${id}`, `status ${id} x`, 'status smn_../../etc/passwd', `status smn_${'a'.repeat(31)}`,
      `status smn_${'٣'.repeat(32)}`, 'scp -t /tmp', 'internal-sftp', 'inventory\u0000']) {
      expect(parseCommand(raw)).toBeNull()
    }
  })
})

describe('readBoundedStdin', () => {
  test('stops at the limit', async () => {
    const big = new Blob(['x'.repeat(2000)]).stream()
    expect(await readBoundedStdin(big, 1000)).toMatchObject({ tooLarge: true })
    expect(await readBoundedStdin(new Blob(['hello']).stream(), 1000)).toEqual({ text: 'hello', tooLarge: false })
  })
})

describe('gatekeeper-main', () => {
  test('refuses a shell request as malformed', async () => {
    const r = await runGatekeeper(targetHome(), 'ls -la')
    expect(r).toMatchObject({ code: 2, out: { status: 'refused', reason: 'malformed' } })
  })
  test('refuses when no command is given (interactive login attempt)', async () => {
    expect((await runGatekeeper(targetHome(), undefined)).out).toMatchObject({ reason: 'malformed' })
  })
  test('start admits; status reports queued', async () => {
    const h = targetHome(); const req = sampleRequest()
    expect((await runGatekeeper(h, 'start', JSON.stringify(req))).out).toMatchObject({ status: 'admitted' })
    expect((await runGatekeeper(h, `status ${req.id}`)).out).toMatchObject({ status: 'queued', handle: `nuance/${req.id}` })
  })
  test('two concurrent starts of the same id: one admitted, one replayed', async () => {
    const h = targetHome(); const body = JSON.stringify(sampleRequest())
    const [a, b] = await Promise.all([runGatekeeper(h, 'start', body), runGatekeeper(h, 'start', body)])
    expect([a.out.status, b.out.reason ?? b.out.status].sort()).toEqual(['admitted', 'replayed'])
  })
  test('unknown id reports unknown, never a path error', async () => {
    expect((await runGatekeeper(targetHome(), `status smn_${'b'.repeat(32)}`)).out).toMatchObject({ status: 'unknown' })
  })
})

describe('cancel and status', () => {
  test('cancel writes a cancel marker for an active job', () => {
    const h = targetHome(); const paths = summonPaths(h); const id = newRequestId()
    writeState(paths, { id, status: 'running', runtime: 'claude', model: 'sonnet', access: 'review', cwd_real: '/x',
      admitted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 9e5).toISOString(), timeout_s: 900 })
    expect(requestCancel(paths, 'nuance', id, Date.now())).toMatchObject({ status: 'running', detail: 'cancel requested' })
    expect(existsSync(join(paths.jobs, id, 'cancel'))).toBe(true)
    expect(statusOf(paths, 'nuance', id, Date.now())).toMatchObject({ status: 'running', heartbeat_age_s: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/summon && bun test tests/gatekeeper.test.ts`
Expected: FAIL — `../src/gatekeeper.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/summon/src/gatekeeper.ts`:

```ts
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { GateDeps } from './gate.ts'
import { findClaude } from './harness.ts'
import { heartbeatAgeS, jobDir, readJson, readState, type JobResult } from './jobs.ts'
import { appendLedger } from './ledger.ts'
import type { SummonPaths } from './paths.ts'
import { TERMINAL, type GateResponse } from './status.ts'

export type Command = { verb: 'inventory' | 'start' } | { verb: 'status' | 'result' | 'cancel'; id: string }

/** The whole grammar. Anything else — spaces, tabs, separators, other verbs — is null. */
export function parseCommand(raw: string | undefined): Command | null {
  if (raw === 'inventory' || raw === 'start') return { verb: raw }
  if (raw === undefined) return null
  const m = /^(status|result|cancel) (smn_[0-9a-f]{32})$/.exec(raw)
  return m ? { verb: m[1] as 'status' | 'result' | 'cancel', id: m[2]! } : null
}

export function sanitizeForLog(s: string | undefined): string {
  return (s ?? '<none>').slice(0, 60).replace(/[^\x20-\x7e]/g, '?')
}

export async function readBoundedStdin(stream: ReadableStream<Uint8Array>, max: number): Promise<{ text: string; tooLarge: boolean }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { await reader.cancel(); return { text: '', tooLarge: true } }
    chunks.push(value)
  }
  return { text: Buffer.concat(chunks).toString('utf8'), tooLarge: false }
}

export function statusOf(paths: SummonPaths, device: string, id: string, nowMs: number): GateResponse {
  const s = readState(paths, id)
  if (!s) return { status: 'unknown', detail: 'no such summon on this Mac' }
  return { status: s.status, handle: `${device}/${id}`, ...(s.reason ? { reason: s.reason } : {}), ...(s.detail ? { detail: s.detail } : {}),
    heartbeat_age_s: heartbeatAgeS(paths, id, nowMs) }
}

export function resultOf(paths: SummonPaths, device: string, id: string, nowMs: number): GateResponse {
  const r = readJson<JobResult>(join(jobDir(paths, id), 'result.json'))
  return r ? { ...r, handle: `${device}/${id}` } : statusOf(paths, device, id, nowMs)
}

export function requestCancel(paths: SummonPaths, device: string, id: string, nowMs: number): GateResponse {
  const s = readState(paths, id)
  if (!s) return { status: 'unknown', detail: 'no such summon on this Mac' }
  if (TERMINAL.has(s.status)) return statusOf(paths, device, id, nowMs)
  writeFileSync(join(jobDir(paths, id), 'cancel'), '', { mode: 0o600 })
  appendLedger(paths.ledger, { event: 'cancel_requested', id }, nowMs)
  return { status: s.status, handle: `${device}/${id}`, detail: 'cancel requested' }
}

/** Ask the runner (Yu's GUI session) for a fresh inventory and wait for it. */
export async function requestInventory(paths: SummonPaths, nowMs: number, waitMs = 15_000): Promise<GateResponse> {
  mkdirSync(paths.spool, { recursive: true, mode: 0o700 })
  writeFileSync(join(paths.spool, `inventory-${nowMs}.req`), '', { mode: 0o600 })
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    try {
      if (statSync(paths.inventory).mtimeMs >= nowMs) {
        const inv = readJson<Record<string, unknown>>(paths.inventory)
        if (inv) return { status: 'completed', inventory: inv }
      }
    } catch { /* not yet */ }
    await Bun.sleep(250)
  }
  return { status: 'unknown', detail: 'the runner did not answer (is Yu logged in at this Mac?)' }
}

/** Real dependencies on Nuance. Test overrides only when SUMMON_HOME_OVERRIDE is set. */
export function liveGateDeps(paths: SummonPaths): GateDeps {
  const testing = !!process.env.SUMMON_HOME_OVERRIDE
  const uid = process.getuid!()
  return {
    nowMs: () => Date.now(),
    home: paths.home,
    paths,
    guiSessionIsMine: () => (testing && process.env.SUMMON_TEST_GUI === '1') || (() => { try { return statSync('/dev/console').uid === uid } catch { return false } })(),
    runnerLoaded: () => (testing && process.env.SUMMON_TEST_RUNNER === '1')
      || spawnSync('/bin/launchctl', ['print', `gui/${uid}/dev.summon.runner`], { stdio: 'ignore', timeout: 3000 }).status === 0,
    claudeAvailable: () => findClaude(paths.home) !== null,
  }
}
```

`packages/summon/src/gatekeeper-main.ts`:

```ts
// The SSH forced command on Nuance. sshd hands the client's request in as
// SSH_ORIGINAL_COMMAND; this program is the only thing the summon key can run.
import { loadAllowlist } from './allowlist.ts'
import { gateStart } from './gate.ts'
import { liveGateDeps, parseCommand, readBoundedStdin, requestCancel, requestInventory, resultOf, sanitizeForLog, statusOf } from './gatekeeper.ts'
import { appendLedger } from './ledger.ts'
import { summonPaths } from './paths.ts'
import { MAX_START_STDIN_BYTES } from './request.ts'

process.env.LC_ALL = 'C'
process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const paths = summonPaths()
const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n')
const cmd = parseCommand(process.env.SSH_ORIGINAL_COMMAND)
if (!cmd) {
  appendLedger(paths.ledger, { event: 'bad_command', detail: sanitizeForLog(process.env.SSH_ORIGINAL_COMMAND) })
  out({ status: 'refused', reason: 'malformed', detail: 'unknown command' })
  process.exit(2)
}
const al = loadAllowlist(paths.allowlist)
const device = al.ok ? al.allowlist.device : 'unknown'
const now = Date.now()
switch (cmd.verb) {
  case 'start': {
    const { text, tooLarge } = await readBoundedStdin(Bun.stdin.stream(), MAX_START_STDIN_BYTES)
    out(tooLarge ? { status: 'refused', reason: 'too_large', detail: 'request exceeds 160 KiB' } : gateStart(text, liveGateDeps(paths)))
    break
  }
  case 'status': out(statusOf(paths, device, cmd.id, now)); break
  case 'result': out(resultOf(paths, device, cmd.id, now)); break
  case 'cancel': out(requestCancel(paths, device, cmd.id, now)); break
  case 'inventory': out(await requestInventory(paths, now)); break
}
```

Note: `gatekeeper.ts` imports `findClaude` from `harness.ts` (Task 6). To keep this task testable on its own, create `harness.ts` now with just `findClaude` and `isExecutable` (Task 6 adds the rest):

`packages/summon/src/harness.ts` (initial):

```ts
import { accessSync, constants, statSync } from 'node:fs'
import { join } from 'node:path'

export function isExecutable(p: string): boolean {
  try { accessSync(p, constants.X_OK); return statSync(p).isFile() } catch { return false }
}

/** Where Claude Code lives on a Mac. SUMMON_CLAUDE_BIN is a test override (only with SUMMON_HOME_OVERRIDE). */
export function findClaude(home: string): string | null {
  const override = process.env.SUMMON_HOME_OVERRIDE ? process.env.SUMMON_CLAUDE_BIN : undefined
  for (const p of [override, join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (p && isExecutable(p)) return p
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/summon && bun test tests/gatekeeper.test.ts`
Expected: PASS. The concurrent-start test runs two processes in parallel and must show exactly one `admitted`.

- [ ] **Step 5: Commit**

```bash
git add packages/summon/src/gatekeeper.ts packages/summon/src/gatekeeper-main.ts packages/summon/src/harness.ts packages/summon/tests/gatekeeper.test.ts
git commit -m "feat(summon): gatekeeper — five-verb grammar, bounded stdin, status/result/cancel/inventory

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

---

### Task 6: The Claude harness — invocation and stream interpretation

**Files:**
- Modify: `packages/summon/src/harness.ts` (add to Task 5's file)
- Test: `packages/summon/tests/harness.test.ts`

**Interfaces:**
- Consumes: `Access`, `JobStatus`, `BlockedReason`
- Produces:
  - `MAX_TURNS = 12`
  - `interface Invocation { bin: string; args: string[]; env: Record<string, string>; stdin: string }`
  - `claudeInvocation(job: { model: string; access: Access; cwdReal: string; prompt: string }, home: string, bin: string, user: string): Invocation`
  - `interface Outcome { status: JobStatus; reason?: string; detail?: string; result_text?: string; num_turns?: number; cost_usd?: number; resets_at?: string }`
  - `interpretClaudeStream(lines: string[], exitCode: number | null): Outcome`
  - `usageWarning(line: string): { status: string; resets_at?: string } | null`

- [ ] **Step 1: Write the failing test**

`packages/summon/tests/harness.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { MAX_TURNS, claudeInvocation, interpretClaudeStream, usageWarning } from '../src/harness.ts'

const job = (access: 'review' | 'edit') => ({ model: 'sonnet', access, cwdReal: '/Users/yu/Projects/x', prompt: 'hi 愛' })

describe('claudeInvocation', () => {
  test('review: read-only tools, quiet flags, prompt on stdin only', () => {
    const inv = claudeInvocation(job('review'), '/Users/yu', '/bin/claude', 'yu')
    expect(inv.args).toContain('--tools=Read,Glob,Grep')
    for (const f of ['-p', '--setting-sources=', '--strict-mcp-config', '--no-session-persistence', '--no-chrome',
      '--disable-slash-commands', '--permission-prompts=none', '--model=sonnet', `--max-turns=${MAX_TURNS}`]) expect(inv.args).toContain(f)
    expect(inv.args.some((a) => a.includes('hi 愛'))).toBe(false)
    expect(inv.stdin).toBe('hi 愛')
  })
  test('edit: Alpha posture — git add/commit only, push/rm/hooks denied', () => {
    const inv = claudeInvocation(job('edit'), '/Users/yu', '/bin/claude', 'yu')
    expect(inv.args).toContain('--allowedTools=Bash(git add:*),Bash(git commit:*)')
    const deny = inv.args.find((a) => a.startsWith('--disallowedTools='))!.slice('--disallowedTools='.length).split(',')
    for (const r of ['Bash(git push:*)', 'Bash(git ls-remote:*)', 'Bash(rm:*)', 'Bash(mv:*)', 'Bash(cp:*)', 'Bash(sed:*)',
      'Edit(//Users/yu/Projects/x/.githooks/**)', 'Write(//Users/yu/Projects/x/.githooks/**)']) expect(deny).toContain(r)
  })
  test('env is built from scratch: no API key, hooks off', () => {
    process.env.ANTHROPIC_API_KEY = 'leak'
    const inv = claudeInvocation(job('review'), '/Users/yu', '/bin/claude', 'yu')
    delete process.env.ANTHROPIC_API_KEY
    expect(inv.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(inv.env).toMatchObject({ HOME: '/Users/yu', USER: 'yu', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null' })
  })
})

const L = (o: object) => JSON.stringify(o)
describe('interpretClaudeStream', () => {
  test('success', () => {
    expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 2, total_cost_usd: 0.1 })], 0))
      .toMatchObject({ status: 'completed', result_text: 'done', num_turns: 2, cost_usd: 0.1 })
  })
  test('turn cap is a completed job with a note, keeping assistant text', () => {
    expect(interpretClaudeStream([L({ type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } }),
      L({ type: 'result', subtype: 'error_max_turns', is_error: true })], 1)).toMatchObject({ status: 'completed', result_text: 'partial' })
  })
  test('usage warning or rejection is blocked(usage) with reset time', () => {
    const o = interpretClaudeStream([L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1_791_700_000 } }),
      L({ type: 'result', subtype: 'success', is_error: false, result: 'x' })], 0)
    expect(o).toMatchObject({ status: 'blocked', reason: 'usage', resets_at: new Date(1_791_700_000_000).toISOString() })
  })
  test('not logged in is blocked(auth)', () => {
    expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' })], 1))
      .toMatchObject({ status: 'blocked', reason: 'auth' })
  })
  test('no result is failed', () => {
    expect(interpretClaudeStream(['garbage'], 137)).toMatchObject({ status: 'failed', detail: 'exit 137' })
  })
  test('usageWarning picks only warning/rejected events', () => {
    expect(usageWarning(L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }))).toBeNull()
    expect(usageWarning(L({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1 } }))).toMatchObject({ status: 'rejected' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/summon && bun test tests/harness.test.ts`
Expected: FAIL — `MAX_TURNS`, `claudeInvocation`… not exported.

- [ ] **Step 3: Write the implementation** (append to `packages/summon/src/harness.ts`)

```ts
import type { Access } from './request.ts'
import type { JobStatus } from './status.ts'

export const MAX_TURNS = 12

export interface Invocation { bin: string; args: string[]; env: Record<string, string>; stdin: string }
export interface Outcome {
  status: JobStatus
  reason?: string
  detail?: string
  result_text?: string
  num_turns?: number
  cost_usd?: number
  resets_at?: string
}

/** Spec §4.6: the quiet config proven on Alpha. The prompt goes on stdin; env is built from scratch. */
export function claudeInvocation(job: { model: string; access: Access; cwdReal: string; prompt: string }, home: string, bin: string, user: string): Invocation {
  const args = ['-p', '--verbose', '--output-format=stream-json', '--setting-sources=', '--strict-mcp-config', '--no-chrome',
    '--disable-slash-commands', '--no-session-persistence', `--max-turns=${MAX_TURNS}`, `--model=${job.model}`, '--permission-prompts=none']
  if (job.access === 'review') {
    args.push('--tools=Read,Glob,Grep')
  } else {
    const hooks = `${job.cwdReal.replace(/\/+$/, '')}/.githooks/**`
    args.push('--tools=Read,Write,Edit,Glob,Grep,Bash', '--permission-mode=acceptEdits',
      '--allowedTools=Bash(git add:*),Bash(git commit:*)',
      `--disallowedTools=${['Bash(git push:*)', 'Bash(git ls-remote:*)', 'Bash(rm:*)', 'Bash(rmdir:*)', 'Bash(mv:*)', 'Bash(cp:*)', 'Bash(sed:*)', `Edit(/${hooks})`, `Write(/${hooks})`].join(',')}`)
  }
  const env: Record<string, string> = {
    HOME: home, USER: user, LOGNAME: user, LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR ?? '/tmp',
    PATH: `${home}/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_MAX_RETRIES: '2', DISABLE_AUTOUPDATER: '1',
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null',
    GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false',
  }
  return { bin, args, env, stdin: job.prompt }
}

const resetIso = (r: any) => (typeof r?.resetsAt === 'number' ? new Date(r.resetsAt * 1000).toISOString() : undefined)

export function usageWarning(line: string): { status: string; resets_at?: string } | null {
  let e: any
  try { e = JSON.parse(line) } catch { return null }
  if (e?.type !== 'rate_limit_event') return null
  const info = e.rate_limit_info ?? e
  return info?.status === 'allowed_warning' || info?.status === 'rejected' ? { status: info.status, resets_at: resetIso(info) } : null
}

export function interpretClaudeStream(lines: string[], exitCode: number | null): Outcome {
  let result: any = null
  let rate: any = null
  let assistantText = ''
  for (const l of lines) {
    let e: any
    try { e = JSON.parse(l) } catch { continue }
    if (e.type === 'result') result = e
    else if (e.type === 'rate_limit_event') rate = e.rate_limit_info ?? e
    else if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c?.type === 'text' && typeof c.text === 'string') assistantText += c.text
  }
  const text = typeof result?.result === 'string' ? result.result : assistantText
  const base = { result_text: text.slice(0, 1_048_576), num_turns: result?.num_turns, cost_usd: result?.total_cost_usd }
  if (rate && (rate.status === 'allowed_warning' || rate.status === 'rejected')) {
    return { ...base, status: 'blocked', reason: 'usage', detail: `usage ${rate.status}`, resets_at: resetIso(rate) }
  }
  if (result?.subtype === 'success' && !result.is_error) return { ...base, status: 'completed' }
  if (result?.subtype === 'error_max_turns') return { ...base, status: 'completed', detail: `turn cap (${MAX_TURNS}) reached` }
  if (/Not logged in|Please run \/login|OAuth token|authentication_error/i.test(text)) {
    return { ...base, status: 'blocked', reason: 'auth', detail: text.slice(0, 200) }
  }
  return { ...base, status: 'failed', detail: result ? String(result.subtype ?? 'error') : `exit ${exitCode}` }
}
```

Also move the two `import` lines above to the top of `harness.ts`, next to the Task 5 imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/summon && bun test tests/harness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/summon/src/harness.ts packages/summon/tests/harness.test.ts
git commit -m "feat(summon): Claude harness — Alpha's quiet posture, stream interpretation

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

---

### Task 7: The runner (Yu's GUI session)

**Files:**
- Create: `packages/summon/src/runner.ts`, `packages/summon/src/runner-main.ts`
- Test: `packages/summon/tests/runner.test.ts`, `packages/summon/tests/fake-claude.ts`, `packages/summon/tests/helpers.ts`

**Interfaces:**
- Consumes: `claudeInvocation`, `interpretClaudeStream`, `usageWarning`, `findClaude`, `readState`, `writeState`, `readJson`, `writeJsonAtomic`, `jobDir`, `appendLedger`, `pruneSeen`, `SummonPaths`, `TERMINAL`, `SummonRequest`, `JobResult`
- Produces:
  - `interface RunnerDeps { paths: SummonPaths; home: string; user: string; nowMs(): number; claudeBin(): string | null; collectInventory(): Promise<unknown>; heartbeatMs: number; pollMs: number; killGraceMs: number }`
  - `runOnce(deps): Promise<number>`
  - `markOrphans(paths, nowMs, isAlive?): number`
  - `sweepJobs(paths, nowMs, maxAgeMs?): number`

- [ ] **Step 1: Write the fake Claude used by tests, and its wrapper helper**

The harness builds the child's env from scratch (no inherited PATH or FAKE_*). So tests run
the fake through a bash wrapper that bakes in the absolute bun path and a mode file.

`packages/summon/tests/helpers.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type FakeMode = 'ok' | 'warn' | 'slow' | 'auth'
export function makeFakeClaude(): { bin: string; setMode(m: FakeMode): void } {
  const dir = mkdtempSync(join(tmpdir(), 'summon-fake-'))
  const bin = join(dir, 'fake-claude.sh')
  const modeFile = join(dir, 'mode')
  writeFileSync(modeFile, 'ok')
  writeFileSync(bin, `#!/bin/bash\nFAKE_MODE_FILE='${modeFile}' exec '${process.execPath}' '${join(import.meta.dir, 'fake-claude.ts')}' "$@"\n`, { mode: 0o755 })
  return { bin, setMode: (m) => writeFileSync(modeFile, m) }
}
```

`packages/summon/tests/fake-claude.ts`. It behaves according to the mode file:

```ts
#!/usr/bin/env bun
// Test double for `claude -p`. Reads the prompt from stdin like the real CLI.
const mode = process.env.FAKE_MODE_FILE ? (await Bun.file(process.env.FAKE_MODE_FILE).text()).trim() : 'ok'
const prompt = await new Response(Bun.stdin.stream()).text()
const emit = (o: object) => process.stdout.write(JSON.stringify(o) + '\n')
if (process.env.FAKE_ARGV_OUT) await Bun.write(process.env.FAKE_ARGV_OUT, JSON.stringify({ argv: process.argv.slice(2), env: process.env }))
if (mode === 'ok') emit({ type: 'result', subtype: 'success', is_error: false, result: `echo: ${prompt}`, num_turns: 1, total_cost_usd: 0.01 })
if (mode === 'warn') {
  emit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: Math.floor(Date.now() / 1000) + 3600 } })
  await Bun.sleep(30_000)
}
if (mode === 'slow') await Bun.sleep(30_000)
if (mode === 'auth') { emit({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }); process.exit(1) }
```

- [ ] **Step 2: Write the failing test**

`packages/summon/tests/runner.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gateStart } from '../src/gate.ts'
import { readJson, readState, writeState } from '../src/jobs.ts'
import { summonPaths } from '../src/paths.ts'
import { markOrphans, runOnce, sweepJobs, type RunnerDeps } from '../src/runner.ts'
import { newRequestId } from '../src/request.ts'
import { targetHome } from './gate.test.ts'
import { makeFakeClaude } from './helpers.ts'
import { sampleRequest } from './request.test.ts'

const fake = makeFakeClaude()
const rdeps = (home: string, over: Partial<RunnerDeps> = {}): RunnerDeps => ({
  paths: summonPaths(home), home, user: 'yu', nowMs: () => Date.now(), claudeBin: () => fake.bin,
  collectInventory: async () => ({ macos: 'test' }), heartbeatMs: 50, pollMs: 25, killGraceMs: 200, ...over,
})
function admit(home: string, over = {}) {
  const req = sampleRequest(over)
  const r = gateStart(JSON.stringify(req), { nowMs: () => Date.now(), home, paths: summonPaths(home), guiSessionIsMine: () => true, runnerLoaded: () => true, claudeAvailable: () => true })
  expect(r.status).toBe('admitted')
  return req
}

describe('runOnce', () => {
  test('runs a queued job to completed with the prompt delivered on stdin', async () => {
    const h = targetHome(); const req = admit(h)
    fake.setMode('ok')
    expect(await runOnce(rdeps(h))).toBe(1)
    const res = readJson<any>(join(h, '.local/state/summon/jobs', req.id, 'result.json'))
    expect(res).toMatchObject({ status: 'completed', result_text: `echo: ${req.prompt}` })
    expect(readdirSync(join(h, '.local/state/summon/spool'))).toEqual([])
  })
  test('a usage warning ends the job as blocked(usage)', async () => {
    const h = targetHome(); const req = admit(h)
    fake.setMode('warn')
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), req.id)).toMatchObject({ status: 'blocked', reason: 'usage' })
  })
  test('cancel marker stops the job', async () => {
    const h = targetHome(); const req = admit(h)
    fake.setMode('slow')
    const p = runOnce(rdeps(h))
    await Bun.sleep(300)
    writeFileSync(join(h, '.local/state/summon/jobs', req.id, 'cancel'), '')
    await p
    expect(readState(summonPaths(h), req.id)?.status).toBe('cancelled')
  })
  test('timeout stops the job', async () => {
    const h = targetHome(); const req = admit(h, { timeout_s: 1 })
    fake.setMode('slow')
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), req.id)?.status).toBe('timed_out')
  })
  test('an expired queued job is not run', async () => {
    const h = targetHome(); const req = admit(h)
    await runOnce(rdeps(h, { nowMs: () => Date.now() + 2 * 86_400_000 }))
    expect(readState(summonPaths(h), req.id)?.status).toBe('expired')
  })
  test('auth failure is blocked(auth)', async () => {
    const h = targetHome(); const req = admit(h)
    fake.setMode('auth')
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), req.id)).toMatchObject({ status: 'blocked', reason: 'auth' })
  })
  test('inventory requests are answered', async () => {
    const h = targetHome(); const paths = summonPaths(h)
    mkdirSync(paths.spool, { recursive: true })
    writeFileSync(join(paths.spool, 'inventory-1.req'), '')
    await runOnce(rdeps(h))
    expect(readJson(paths.inventory)).toEqual({ macos: 'test' })
  })
})

describe('recovery', () => {
  test('a running job whose pid is dead becomes unknown', () => {
    const h = targetHome(); const paths = summonPaths(h); const id = newRequestId()
    writeState(paths, { id, status: 'running', pid: 999_999, runtime: 'claude', model: 'sonnet', access: 'review', cwd_real: '/x',
      admitted_at: new Date().toISOString(), expires_at: new Date().toISOString(), timeout_s: 9 })
    expect(markOrphans(paths, Date.now(), () => false)).toBe(1)
    expect(readState(paths, id)).toMatchObject({ status: 'unknown', detail: 'runner stopped mid-job' })
  })
  test('old finished jobs are swept after 30 days', () => {
    const h = targetHome(); const paths = summonPaths(h); const id = newRequestId()
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString()
    writeState(paths, { id, status: 'completed', ended_at: old, runtime: 'claude', model: 'sonnet', access: 'review', cwd_real: '/x', admitted_at: old, expires_at: old, timeout_s: 9 })
    expect(sweepJobs(paths, Date.now())).toBe(1)
    expect(existsSync(join(paths.jobs, id))).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/summon && bun test tests/runner.test.ts`
Expected: FAIL — `../src/runner.ts` not found.

- [ ] **Step 4: Write the implementation**

`packages/summon/src/runner.ts`:

```ts
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { claudeInvocation, interpretClaudeStream, usageWarning, type Outcome } from './harness.ts'
import { jobDir, readJson, readState, writeJsonAtomic, writeState, type JobResult, type JobState } from './jobs.ts'
import { appendLedger } from './ledger.ts'
import type { SummonPaths } from './paths.ts'
import { ID_RE, type SummonRequest } from './request.ts'
import { TERMINAL } from './status.ts'

export interface RunnerDeps {
  paths: SummonPaths
  home: string
  user: string
  nowMs(): number
  claudeBin(): string | null
  collectInventory(): Promise<unknown>
  heartbeatMs: number
  pollMs: number
  killGraceMs: number
}

const MAX_STDOUT_BYTES = 8 * 1024 * 1024
const iso = (ms: number) => new Date(ms).toISOString()

function finish(deps: RunnerDeps, s: JobState, o: Outcome, exitCode: number | null = null): void {
  const ended = deps.nowMs()
  const result: JobResult = { status: o.status, ...(o.reason ? { reason: o.reason } : {}), ...(o.detail ? { detail: o.detail } : {}),
    ...(o.result_text !== undefined ? { result_text: o.result_text } : {}), exit_code: exitCode,
    ...(o.num_turns !== undefined ? { num_turns: o.num_turns } : {}), ...(o.cost_usd !== undefined ? { cost_usd: o.cost_usd } : {}),
    ...(o.resets_at ? { resets_at: o.resets_at } : {}) }
  writeJsonAtomic(join(jobDir(deps.paths, s.id), 'result.json'), result)
  writeState(deps.paths, { ...s, status: o.status, reason: o.reason, detail: o.detail, ended_at: iso(ended), pid: undefined })
  appendLedger(deps.paths.ledger, { event: 'job_end', id: s.id, status: o.status, reason: o.reason, detail: o.detail?.slice(0, 200) }, ended)
}

async function runJob(deps: RunnerDeps, id: string): Promise<void> {
  const dir = jobDir(deps.paths, id)
  const s = readState(deps.paths, id)
  const req = readJson<SummonRequest>(join(dir, 'request.json'))
  if (!s || !req || s.status !== 'queued') return
  if (deps.nowMs() > Date.parse(s.expires_at)) return finish(deps, s, { status: 'expired', detail: 'expired before the runner reached it' })
  const bin = deps.claudeBin()
  if (!bin) return finish(deps, s, { status: 'failed', detail: 'claude is not installed on this Mac' })
  const inv = claudeInvocation({ model: s.model, access: s.access, cwdReal: s.cwd_real, prompt: req.prompt }, deps.home, bin, deps.user)
  const child = spawn(inv.bin, inv.args, { cwd: s.cwd_real, env: inv.env, stdio: ['pipe', 'pipe', 'pipe'] })
  const started = deps.nowMs()
  writeState(deps.paths, { ...s, status: 'running', started_at: iso(started), pid: child.pid })
  // Keep the Mac awake exactly as long as the job (spec §2 step 3).
  if (child.pid) spawn('/usr/bin/caffeinate', ['-i', '-w', String(child.pid)], { stdio: 'ignore', detached: true }).unref()
  child.stdin!.on('error', () => { /* the CLI may exit before reading all of stdin */ })
  child.stdin!.end(inv.stdin)

  const lines: string[] = []
  let buf = ''
  let bytes = 0
  let stopped: Outcome | null = null
  const stop = (o: Outcome) => {
    if (stopped) return
    stopped = o
    child.kill('SIGTERM')
    setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } }, deps.killGraceMs).unref()
  }
  child.stdout!.setEncoding('utf8')
  child.stdout!.on('data', (chunk: string) => {
    bytes += Buffer.byteLength(chunk)
    if (bytes > MAX_STDOUT_BYTES) return stop({ status: 'failed', detail: 'output over 8 MiB' })
    buf += chunk
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      lines.push(line)
      const w = usageWarning(line)
      if (w) stop({ status: 'blocked', reason: 'usage', detail: `usage ${w.status}`, resets_at: w.resets_at })
    }
  })
  child.stderr!.resume()
  const timer = setInterval(() => {
    try { writeFileSync(join(dir, 'heartbeat'), String(deps.nowMs()), { mode: 0o600 }) } catch { /* dir swept */ }
    if (existsSync(join(dir, 'cancel'))) stop({ status: 'cancelled', detail: 'cancelled by request' })
    if (deps.nowMs() - started > s.timeout_s * 1000) stop({ status: 'timed_out', detail: `ran past ${s.timeout_s}s` })
  }, Math.min(deps.heartbeatMs, deps.pollMs))
  const code: number | null = await new Promise((resolve) => child.on('close', (c) => resolve(c)))
  clearInterval(timer)
  if (buf) lines.push(buf)
  const interpreted = interpretClaudeStream(lines, code)
  const outcome: Outcome = stopped ? { ...interpreted, ...(stopped as Outcome) } : interpreted
  finish(deps, { ...s, status: 'running', started_at: iso(started) }, outcome, code)
}

/** Process every spool item once (inventory first, then jobs in id = time order), then return. */
export async function runOnce(deps: RunnerDeps): Promise<number> {
  mkdirSync(deps.paths.spool, { recursive: true, mode: 0o700 })
  const names = readdirSync(deps.paths.spool).sort()
  for (const n of names.filter((x) => /^inventory-\d+\.req$/.test(x))) {
    writeJsonAtomic(deps.paths.inventory, await deps.collectInventory())
    try { unlinkSync(join(deps.paths.spool, n)) } catch { /* gone */ }
  }
  let ran = 0
  for (const id of names.filter((x) => ID_RE.test(x))) {
    try { renameSync(join(deps.paths.spool, id), join(jobDir(deps.paths, id), 'claimed')) } catch { continue }
    await runJob(deps, id)
    ran++
  }
  return ran
}

export function markOrphans(paths: SummonPaths, nowMs: number,
  isAlive: (pid: number) => boolean = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }): number {
  let n = 0
  let names: string[] = []
  try { names = readdirSync(paths.jobs) } catch { return 0 }
  for (const id of names.filter((x) => ID_RE.test(x))) {
    const s = readState(paths, id)
    if (s?.status === 'running' && (!s.pid || !isAlive(s.pid))) {
      writeState(paths, { ...s, status: 'unknown', detail: 'runner stopped mid-job', ended_at: iso(nowMs), pid: undefined })
      appendLedger(paths.ledger, { event: 'job_end', id, status: 'unknown', detail: 'runner stopped mid-job' }, nowMs)
      n++
    }
  }
  return n
}

export function sweepJobs(paths: SummonPaths, nowMs: number, maxAgeMs: number = 30 * 86_400_000): number {
  let n = 0
  let names: string[] = []
  try { names = readdirSync(paths.jobs) } catch { return 0 }
  for (const id of names.filter((x) => ID_RE.test(x))) {
    const s = readState(paths, id)
    const end = s?.ended_at ? Date.parse(s.ended_at) : NaN
    if (s && TERMINAL.has(s.status) && nowMs - end > maxAgeMs) { rmSync(jobDir(paths, id), { recursive: true, force: true }); n++ }
  }
  return n
}
```

`packages/summon/src/runner-main.ts`:

```ts
// LaunchAgent dev.summon.runner on Nuance: runs in Yu's GUI session (where his
// Claude login is readable), started by launchd whenever the spool is non-empty.
import { userInfo } from 'node:os'
import { findClaude } from './harness.ts'
import { collectInventory } from './inventory.ts'
import { summonPaths } from './paths.ts'
import { pruneSeen } from './replay.ts'
import { markOrphans, runOnce, sweepJobs } from './runner.ts'

const paths = summonPaths()
const user = userInfo().username
const now = Date.now()
markOrphans(paths, now)
sweepJobs(paths, now)
pruneSeen(paths.seen, now)
await runOnce({ paths, home: paths.home, user, nowMs: () => Date.now(), claudeBin: () => findClaude(paths.home),
  collectInventory: async () => collectInventory(paths.home, user), heartbeatMs: 10_000, pollMs: 2_000, killGraceMs: 5_000 })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/summon && bun test tests/runner.test.ts`
Expected: PASS. The cancel and timeout tests take ~1–2 s each.

- [ ] **Step 6: Commit**

```bash
git add packages/summon/src/runner.ts packages/summon/src/runner-main.ts packages/summon/tests/runner.test.ts packages/summon/tests/fake-claude.ts
git commit -m "feat(summon): GUI-session runner — caffeinate, heartbeat, cancel, timeout, usage stop, orphans, sweep

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

---

### Task 8: Inventory

**Files:**
- Create: `packages/summon/src/inventory.ts`
- Test: `packages/summon/tests/inventory.test.ts`

**Interfaces:**
- Consumes: `findClaude`, `isExecutable`
- Produces:
  - `type Run = (cmd: string, args: string[], timeoutMs?: number) => { code: number | null; stdout: string; stderr: string }`
  - `runCmd: Run`
  - `which(name, home, exists?): string | null`
  - `collectInventory(home, user, run?, exists?, consoleUid?): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

`packages/summon/tests/inventory.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { collectInventory, type Run } from '../src/inventory.ts'

const stub: Run = (cmd, args) => {
  const key = [cmd.split('/').pop(), ...args].join(' ')
  const table: Record<string, string> = {
    'sw_vers -productVersion': '26.0\n',
    'fdesetup isactive': 'true\n',
    'ps -axo user=,command=': 'yu /bin/bash /Users/yu/love-unlimited/tools/citizen-fleet.sh\nroot /sbin/launchd\n',
    'pmset -g custom': 'Battery Power:\n sleep 1\n',
    'claude --version': '2.1.296 (Claude Code)\n',
    'claude auth status --json': '{"loggedIn":true,"email":"x@y"}',
  }
  return { code: 0, stdout: table[key] ?? '', stderr: key.startsWith('security') ? 'Keychain "login" no-timeout' : '' }
}

describe('collectInventory', () => {
  test('reports the facts Phase 0 needs without leaking account details', () => {
    process.env.SUMMON_HOME_OVERRIDE = '/h'; process.env.SUMMON_CLAUDE_BIN = '/usr/bin/true'
    const inv = collectInventory('/h', 'yu', (c, a) => stub(c.endsWith('true') ? 'claude' : c, a), (p) => p === '/Applications/iTerm.app', 501)
    delete process.env.SUMMON_HOME_OVERRIDE; delete process.env.SUMMON_CLAUDE_BIN
    expect(inv).toMatchObject({ macos: '26.0', user: 'yu', filevault: 'true', iterm2: true, fleet_users: ['yu'],
      harnesses: { claude: { version: '2.1.296 (Claude Code)', logged_in: true } } })
    expect(JSON.stringify(inv)).not.toContain('x@y')
    expect(String(inv.keychain)).toContain('no-timeout')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/summon && bun test tests/inventory.test.ts`
Expected: FAIL — `../src/inventory.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/summon/src/inventory.ts`:

```ts
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { findClaude, isExecutable } from './harness.ts'

export type Run = (cmd: string, args: string[], timeoutMs?: number) => { code: number | null; stdout: string; stderr: string }
export const runCmd: Run = (cmd, args, timeoutMs = 5000) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

export function which(name: string, home: string, exists: (p: string) => boolean = isExecutable): string | null {
  for (const d of [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    const p = join(d, name)
    if (exists(p)) return p
  }
  return null
}

/** Read-only facts about this Mac (spec §5.3). Runs in the runner, i.e. Yu's GUI session. */
export function collectInventory(home: string, user: string, run: Run = runCmd, exists: (p: string) => boolean = existsSync,
  consoleUid: number | null = (() => { try { return statSync('/dev/console').uid } catch { return null } })()): Record<string, unknown> {
  const claude = findClaude(home)
  let claudeLoggedIn: boolean | null = null
  if (claude) { try { claudeLoggedIn = JSON.parse(run(claude, ['auth', 'status', '--json'], 15_000).stdout).loggedIn === true } catch { claudeLoggedIn = null } }
  const kc = run('/usr/bin/security', ['show-keychain-info', join(home, 'Library/Keychains/login.keychain-db')])
  const ps = run('/bin/ps', ['-axo', 'user=,command='])
  const fleetUsers = [...new Set(ps.stdout.split('\n').filter((l) => /citizen-fleet|love-unlimited/.test(l)).map((l) => l.trim().split(/\s+/)[0]!))]
  return {
    collected_at: new Date().toISOString(),
    macos: run('/usr/bin/sw_vers', ['-productVersion']).stdout.trim(),
    user,
    gui_session_is_mine: consoleUid !== null && consoleUid === process.getuid!(),
    filevault: run('/usr/bin/fdesetup', ['isactive']).stdout.trim(),
    keychain: (kc.stdout + kc.stderr).trim().slice(0, 200),
    harnesses: {
      claude: claude ? { path: claude, version: run(claude, ['--version']).stdout.trim(), logged_in: claudeLoggedIn } : null,
      codex: which('codex', home),
      hermes: exists(join(home, '.hermes/hermes-agent/venv/bin/hermes')) ? join(home, '.hermes/hermes-agent/venv/bin/hermes') : null,
    },
    iterm2: exists('/Applications/iTerm.app'),
    tmux: which('tmux', home),
    sol: exists(join(home, '.config/sol/bin/sol')),
    fleet_users: fleetUsers,
    power: run('/usr/bin/pmset', ['-g', 'custom']).stdout.slice(0, 2000),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/summon && bun test tests/inventory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/summon/src/inventory.ts packages/summon/tests/inventory.test.ts
git commit -m "feat(summon): read-only inventory (harness logins, keychain, fleet user, power)

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

---

### Task 9: The Air CLI and SSH failure mapping

**Files:**
- Create: `packages/summon/src/ssh.ts`, `packages/summon/src/cli.ts`, `packages/summon/bin/summon.ts`
- Test: `packages/summon/tests/cli.test.ts`

**Interfaces:**
- Consumes: `newRequestId`, `SummonRequest`, `appendLedger`, `parseDurationS`, `summonPaths`, `ID_RE`, `DEVICE_RE`, `GateResponse`
- Produces:
  - `mapSshFailure(stderr): GateResponse`
  - `sshCall(deps, device, remote, stdin?): GateResponse`
  - `interface CliDeps { sshBin: string; sshConfig: string; ledgerPath: string; device: string; nowMs(): number; readFile(p): string; readStdin(): string }`
  - `parseCli(argv): CliCommand | { error: string }`
  - `buildRequest(cmd, deps, prompt): SummonRequest`
  - `runCli(argv, deps): { code: number; out: GateResponse }`
  - `defaultCliDeps()`

- [ ] **Step 1: Write the failing test**

`packages/summon/tests/cli.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCli, runCli, type CliDeps } from '../src/cli.ts'
import { mapSshFailure } from '../src/ssh.ts'

const tmps: string[] = []
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }) })
function fakeSsh(exit: number, stdout: string, stderr = ''): { bin: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'summon-cli-')); tmps.push(dir)
  const bin = join(dir, 'ssh')
  writeFileSync(bin, `#!/bin/bash\nprintf '%s\\n' "$@" > "${dir}/argv"\ncat > "${dir}/stdin"\nprintf '%s' '${stdout}'\nprintf '%s' '${stderr}' >&2\nexit ${exit}\n`)
  chmodSync(bin, 0o755)
  return { bin, dir }
}
const deps = (bin: string, dir: string): CliDeps => ({ sshBin: bin, sshConfig: join(dir, 'config'), ledgerPath: join(dir, 'ledger.jsonl'),
  device: 'air', nowMs: () => Date.now(), readFile: (p) => readFileSync(p, 'utf8'), readStdin: () => 'from stdin' })

describe('parseCli', () => {
  test('parses a start', () => {
    expect(parseCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/Projects/x', '--review', '--prompt-file', 't.md']))
      .toMatchObject({ kind: 'start', device: 'nuance', runtime: 'claude', model: 'sonnet', cwd: '~/Projects/x', access: 'review', promptFile: 't.md' })
  })
  test('requires model, cwd and a prompt', () => {
    expect(parseCli(['nuance', 'claude', '--cwd', '~/x', '--prompt-file', 't'])).toHaveProperty('error')
    expect(parseCli(['nuance', 'claude', '--model', 'sonnet', '--prompt-file', 't'])).toHaveProperty('error')
  })
  test('parses status/result/cancel handles and inventory', () => {
    const id = 'smn_' + 'c'.repeat(32)
    expect(parseCli(['status', `nuance/${id}`])).toEqual({ kind: 'status', device: 'nuance', id })
    expect(parseCli(['nuance', 'inventory'])).toEqual({ kind: 'inventory', device: 'nuance' })
    expect(parseCli(['status', 'nuance/../x'])).toHaveProperty('error')
  })
})

describe('mapSshFailure', () => {
  test('tells failures apart', () => {
    expect(mapSshFailure('@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@')).toMatchObject({ status: 'host_key_mismatch' })
    expect(mapSshFailure('yu@nuance.local: Permission denied (publickey).')).toMatchObject({ status: 'auth_refused' })
    expect(mapSshFailure('ssh: connect to host nuance.local port 22: Operation timed out')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
    expect(mapSshFailure('ssh: connect to host nuance.local port 22: Connection refused')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
    expect(mapSshFailure('ssh: Could not resolve hostname nuance.local')).toMatchObject({ status: 'unreachable', reason: 'no_route' })
  })
})

describe('runCli', () => {
  test('start sends the request on stdin to `summon-nuance start`, ledgering before and after', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted","handle":"nuance/x"}')
    writeFileSync(join(dir, 't.md'), 'Read the README 愛')
    const r = runCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/Projects/x', '--review', '--prompt-file', join(dir, 't.md')], deps(bin, dir))
    expect(r).toMatchObject({ code: 0, out: { status: 'admitted' } })
    expect(readFileSync(join(dir, 'argv'), 'utf8')).toContain('summon-nuance\nstart')
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(sent).toMatchObject({ from_device: 'air', to_device: 'nuance', cwd: '~/Projects/x', prompt: 'Read the README 愛' })
    const ledger = readFileSync(join(dir, 'ledger.jsonl'), 'utf8')
    expect(ledger.split('\n').filter(Boolean).length).toBe(2)
    expect(ledger).not.toContain('README')
  })
  test('ssh exit 255 maps to a transport status', () => {
    const { bin, dir } = fakeSsh(255, '', 'ssh: connect to host nuance.local port 22: Operation timed out')
    expect(runCli(['nuance', 'inventory'], deps(bin, dir))).toMatchObject({ code: 1, out: { status: 'unreachable', reason: 'timeout' } })
  })
  test('garbled answer after sending is unknown, never retried', () => {
    const { bin, dir } = fakeSsh(0, 'not json')
    writeFileSync(join(dir, 't.md'), 'x')
    expect(runCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/x', '--review', '--prompt-file', join(dir, 't.md')], deps(bin, dir)).out.status).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/summon && bun test tests/cli.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`packages/summon/src/ssh.ts`:

```ts
import { spawnSync } from 'node:child_process'
import type { GateResponse } from './status.ts'

export function mapSshFailure(stderr: string): GateResponse {
  const detail = stderr.trim().split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 200) ?? 'ssh failed'
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|No \S+ host key is known/i.test(stderr)) return { status: 'host_key_mismatch', detail }
  if (/Permission denied|Too many authentication failures/i.test(stderr)) return { status: 'auth_refused', detail }
  if (/timed out|Connection refused/i.test(stderr)) return { status: 'unreachable', reason: 'timeout', detail }
  return { status: 'unreachable', reason: 'no_route', detail }
}

export function sshCall(deps: { sshBin: string; sshConfig: string }, device: string, remote: string, stdin?: string): GateResponse {
  const r = spawnSync(deps.sshBin, ['-F', deps.sshConfig, `summon-${device}`, remote], { input: stdin ?? '', encoding: 'utf8', timeout: 60_000 })
  if (r.error || r.status === 255) return mapSshFailure(String(r.stderr ?? r.error ?? ''))
  const last = String(r.stdout ?? '').trim().split('\n').pop() ?? ''
  try { return JSON.parse(last) as GateResponse } catch { return { status: 'unknown', detail: 'no readable answer from the target' } }
}
```

`packages/summon/src/cli.ts`:

```ts
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseDurationS } from './allowlist.ts'
import { appendLedger } from './ledger.ts'
import { summonPaths } from './paths.ts'
import { DEVICE_RE, ID_RE, RUNTIMES, newRequestId, type Access, type Runtime, type SummonRequest } from './request.ts'
import { sshCall } from './ssh.ts'
import type { GateResponse } from './status.ts'

export interface CliDeps { sshBin: string; sshConfig: string; ledgerPath: string; device: string; nowMs(): number; readFile(p: string): string; readStdin(): string }
export type CliCommand =
  | { kind: 'inventory'; device: string }
  | { kind: 'status' | 'result' | 'cancel'; device: string; id: string }
  | { kind: 'start'; device: string; runtime: Runtime; model: string; provider?: string; effort?: string; cwd: string; access: Access;
      promptFile: string; timeoutS: number; expiresS: number; label?: string }

const USAGE = `usage:
  summon <device> inventory
  summon <device> claude --model M --cwd '<path on target>' [--review|--edit] --prompt-file F|- [--timeout 15m] [--expires 15m] [--label L]
  summon status|result|cancel <device>/smn_<id>`

export function parseCli(argv: string[]): CliCommand | { error: string } {
  const [a, b, ...rest] = argv
  if ((a === 'status' || a === 'result' || a === 'cancel') && b) {
    const m = /^([a-z][a-z0-9-]{0,31})\/(smn_[0-9a-f]{32})$/.exec(b)
    return m ? { kind: a, device: m[1]!, id: m[2]! } : { error: `bad handle\n${USAGE}` }
  }
  if (!a || !DEVICE_RE.test(a)) return { error: USAGE }
  if (b === 'inventory' && rest.length === 0) return { kind: 'inventory', device: a }
  if (!b || !(RUNTIMES as readonly string[]).includes(b)) return { error: USAGE }
  const flags: Record<string, string> = {}
  let access: Access = 'review'
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i]!
    if (f === '--review' || f === '--edit') { access = f === '--edit' ? 'edit' : 'review'; continue }
    if (!['--model', '--provider', '--effort', '--cwd', '--prompt-file', '--timeout', '--expires', '--label'].includes(f) || rest[i + 1] === undefined) return { error: `unknown or incomplete flag ${f}\n${USAGE}` }
    flags[f] = rest[++i]!
  }
  if (!flags['--model'] || !flags['--cwd'] || !flags['--prompt-file']) return { error: `--model, --cwd and --prompt-file are required\n${USAGE}` }
  const timeoutS = parseDurationS(flags['--timeout'] ?? '15m'); const expiresS = parseDurationS(flags['--expires'] ?? '15m')
  if (!timeoutS || !expiresS) return { error: 'durations look like 90s, 15m or 2h' }
  return { kind: 'start', device: a, runtime: b as Runtime, model: flags['--model'], provider: flags['--provider'], effort: flags['--effort'],
    cwd: flags['--cwd'], access, promptFile: flags['--prompt-file'], timeoutS, expiresS, label: flags['--label'] }
}

export function buildRequest(cmd: Extract<CliCommand, { kind: 'start' }>, deps: CliDeps, prompt: string): SummonRequest {
  const now = deps.nowMs()
  return { v: 1, id: newRequestId(now), from_device: deps.device, to_device: cmd.device,
    issued_at: new Date(now).toISOString(), expires_at: new Date(now + cmd.expiresS * 1000).toISOString(),
    runtime: cmd.runtime, mode: 'job', model: cmd.model, ...(cmd.provider ? { provider: cmd.provider } : {}), ...(cmd.effort ? { effort: cmd.effort } : {}),
    cwd: cmd.cwd, access: cmd.access, timeout_s: cmd.timeoutS, ...(cmd.label ? { label: cmd.label } : {}),
    origin: { harness: process.env.CLAUDECODE ? 'claude-code' : process.env.CODEX_HOME ? 'codex' : 'shell', pid: process.ppid }, prompt }
}

const failed = (o: GateResponse) => ['refused', 'unreachable', 'auth_refused', 'host_key_mismatch', 'unknown', 'failed', 'blocked'].includes(String(o.status))

export function runCli(argv: string[], deps: CliDeps): { code: number; out: GateResponse } {
  const cmd = parseCli(argv)
  if ('error' in cmd) return { code: 2, out: { status: 'refused', reason: 'malformed', detail: cmd.error } }
  if (cmd.kind === 'inventory') { const out = sshCall(deps, cmd.device, 'inventory'); return { code: failed(out) ? 1 : 0, out } }
  if (cmd.kind !== 'start') {
    if (!ID_RE.test(cmd.id)) return { code: 2, out: { status: 'refused', reason: 'malformed' } }
    const out = sshCall(deps, cmd.device, `${cmd.kind} ${cmd.id}`)
    return { code: failed(out) ? 1 : 0, out }
  }
  const prompt = cmd.promptFile === '-' ? deps.readStdin() : deps.readFile(cmd.promptFile)
  const req = buildRequest(cmd, deps, prompt)
  appendLedger(deps.ledgerPath, { event: 'sent', id: req.id, from: req.from_device, runtime: req.runtime, model: req.model, cwd: req.cwd, access: req.access }, deps.nowMs())
  const out = sshCall(deps, cmd.device, 'start', JSON.stringify(req))
  appendLedger(deps.ledgerPath, { event: 'answer', id: req.id, status: String(out.status), reason: out.reason, detail: out.detail }, deps.nowMs())
  return { code: failed(out) ? 1 : 0, out: out.status === 'unknown' ? { ...out, handle: `${cmd.device}/${req.id}` } : out }
}

export function defaultCliDeps(): CliDeps {
  const home = homedir()
  return { sshBin: process.env.SUMMON_SSH_BIN || '/usr/bin/ssh', sshConfig: join(home, '.ssh', 'summon', 'config'),
    ledgerPath: summonPaths(home).ledger, device: process.env.SUMMON_DEVICE || 'air', nowMs: () => Date.now(),
    readFile: (p) => readFileSync(p, 'utf8'), readStdin: () => readFileSync(0, 'utf8') }
}
```

`packages/summon/bin/summon.ts`:

```ts
#!/usr/bin/env bun
import { defaultCliDeps, runCli } from '../src/cli.ts'

const { code, out } = runCli(process.argv.slice(2), defaultCliDeps())
if (process.argv.includes('--json')) console.log(JSON.stringify(out))
else {
  const head = [out.status, out.reason ? `(${out.reason})` : '', out.handle ?? ''].filter(Boolean).join(' ')
  console.log(head)
  for (const k of ['detail', 'hint', 'result_text'] as const) if (out[k]) console.log(`${k === 'result_text' ? '' : k + ': '}${out[k]}`)
  if (out.inventory) console.log(JSON.stringify(out.inventory, null, 2))
}
process.exit(code)
```

Then: `chmod +x packages/summon/bin/summon.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/summon && bun test tests/cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/summon/src/ssh.ts packages/summon/src/cli.ts packages/summon/bin/summon.ts packages/summon/tests/cli.test.ts
git commit -m "feat(summon): Air CLI — ledger-before-send, distinct SSH failures, never retried

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

---

### Task 10: Build, installer, and pairing scripts

**Files:**
- Create: `packages/summon/scripts/build-nuance.ts`, `packages/summon/scripts/prepare-pairing.ts`, `packages/summon/scripts/pin-nuance.ts`, `packages/summon/nuance/install.sh.tmpl`
- Test: `packages/summon/tests/install.test.ts`

**Interfaces:**
- Consumes: the two entry points `src/gatekeeper-main.ts` and `src/runner-main.ts`
- Produces:
  - `buildNuance(outDir): { gatekeeper: string; runner: string; sha: { gatekeeper: string; runner: string } }`
  - `renderInstaller(tmpl, { pubkey, expiry, shaGatekeeper, shaRunner }): string`
  - `writeSshConfig(dir, user, hostKeyLine)`
  - The Nuance bundle folder `~/summon-nuance-bundle/`: `summon-install.sh`, `summon-gatekeeper`, `summon-runner`, `MANIFEST.txt`.

- [ ] **Step 1: Write the installer template**

`packages/summon/nuance/install.sh.tmpl`:

```bash
#!/bin/bash
# Summon — Nuance installer (Phase 0). Read this before running it:
#   bash ~/Downloads/summon-nuance-bundle/summon-install.sh
# It installs the gatekeeper (the only thing the Air's summon key can run) and the
# runner (a LaunchAgent in your GUI session), allows Claude Code read-only in ~/Projects,
# and turns off SSH password logins (asks for your password once). Undo: see spec §7.
set -euo pipefail
PUBKEY='__PUBKEY__'
EXPIRY='__EXPIRY__'
SHA_GATEKEEPER='__SHA_GATEKEEPER__'
SHA_RUNNER='__SHA_RUNNER__'
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SUMMON_INSTALL_ROOT:-$HOME}"
SKIP_SUDO="${SUMMON_SKIP_SUDO:-0}"; SKIP_LAUNCHCTL="${SUMMON_SKIP_LAUNCHCTL:-0}"; SKIP_INVENTORY="${SUMMON_SKIP_INVENTORY:-0}"
USER_NAME="$(id -un)"; UID_NUM="$(id -u)"
[ "$(uname -s)" = Darwin ] || { echo "macOS only"; exit 1; }
[ "$(uname -m)" = arm64 ] || { echo "Apple Silicon only"; exit 1; }
[ "$UID_NUM" != 0 ] || { echo "run as your own user, not root"; exit 1; }

check() { local got; got="$(shasum -a 256 "$HERE/$1" | awk '{print $1}')"; [ "$got" = "$2" ] || { echo "✗ $1 checksum mismatch — do not install"; exit 1; }; }
check summon-gatekeeper "$SHA_GATEKEEPER"; check summon-runner "$SHA_RUNNER"; echo "✓ binaries match their checksums"

SHARE="$ROOT/.local/share/summon"; STATE="$ROOT/.local/state/summon"; CONF="$ROOT/.config/summon"
mkdir -p "$SHARE" "$STATE/spool" "$STATE/jobs" "$STATE/seen" "$CONF" "$ROOT/.ssh" "$ROOT/Library/LaunchAgents"
chmod 700 "$SHARE" "$STATE" "$STATE/spool" "$STATE/jobs" "$STATE/seen" "$CONF" "$ROOT/.ssh"
for b in summon-gatekeeper summon-runner; do
  install -m 700 "$HERE/$b" "$SHARE/$b"
  xattr -d com.apple.quarantine "$SHARE/$b" 2>/dev/null || true
  codesign --verify "$SHARE/$b" 2>/dev/null || codesign --force -s - "$SHARE/$b" 2>/dev/null || echo "⚠ could not sign $b — tell Ai"
done
echo "✓ gatekeeper and runner installed in $SHARE"

if [ ! -e "$CONF/allowlist.yaml" ]; then
  cat > "$CONF/allowlist.yaml" <<'YAML'
version: 1
device: nuance
peers: [air]
runtimes:
  - id: claude
    models: [{ model: sonnet }, { model: haiku }]
folders:
  - path: ~/Projects
    access: review
limits:
  max_concurrent: 1
  starts_per_hour: 6
  job_timeout_max: 30m
YAML
  chmod 600 "$CONF/allowlist.yaml"; echo "✓ allowlist written: Claude Code, read-only, ~/Projects"
else
  echo "• allowlist already present — left as it is"
fi

AK="$ROOT/.ssh/authorized_keys"; touch "$AK"; chmod 600 "$AK"
LINE="restrict,from=\"192.168.50.0/24\",expiry-time=\"$EXPIRY\",command=\"$SHARE/summon-gatekeeper\" $PUBKEY"
{ grep -v ' summon-air$' "$AK" || true; printf '%s\n' "$LINE"; } > "$AK.summon-tmp"
mv "$AK.summon-tmp" "$AK"; chmod 600 "$AK"
echo "✓ authorized_keys: one restricted summon line (other lines untouched; expires $EXPIRY)"

if [ "$SKIP_SUDO" != 1 ]; then
  CONFD=/etc/ssh/sshd_config.d
  grep -qE '^Include /etc/ssh/sshd_config\.d/\*' /etc/ssh/sshd_config || echo "⚠ sshd_config does not include $CONFD — tell Ai before using Summon"
  TMP="$(mktemp)"
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\nAllowUsers %s\n' "$USER_NAME" > "$TMP"
  echo "Your Mac password is needed once, to switch off SSH password logins:"
  sudo install -m 644 -o root -g wheel "$TMP" "$CONFD/010-summon.conf"
  if ! sudo /usr/sbin/sshd -t; then sudo rm -f "$CONFD/010-summon.conf"; rm -f "$TMP"; echo "✗ sshd rejected the change — removed it, nothing else touched"; exit 1; fi
  rm -f "$TMP"; echo "✓ SSH: key logins only, for $USER_NAME"
fi

PLIST="$ROOT/Library/LaunchAgents/dev.summon.runner.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.summon.runner</string>
  <key>ProgramArguments</key><array><string>$SHARE/summon-runner</string></array>
  <key>QueueDirectories</key><array><string>$STATE/spool</string></array>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$STATE/runner.log</string>
  <key>StandardErrorPath</key><string>$STATE/runner.log</string>
</dict></plist>
PL
chmod 644 "$PLIST"
if [ "$SKIP_LAUNCHCTL" != 1 ]; then
  launchctl bootout "gui/$UID_NUM/dev.summon.runner" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$PLIST"; echo "✓ runner loaded in your GUI session"
fi

echo; echo "──── give this back to Ai ────"
echo "user: $USER_NAME"
if [ -r /etc/ssh/ssh_host_ed25519_key.pub ]; then echo "host key: $(cat /etc/ssh/ssh_host_ed25519_key.pub)"; ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub; fi
if [ "$SKIP_INVENTORY" != 1 ]; then
  : > "$STATE/spool/inventory-$(date +%s)000.req"
  for _ in $(seq 1 20); do [ -s "$STATE/inventory.json" ] && break; sleep 1; done
  echo "inventory: $(cat "$STATE/inventory.json" 2>/dev/null || echo 'the runner did not answer')"
fi
nc -z -G 2 127.0.0.1 22 >/dev/null 2>&1 && echo "✓ Remote Login is on" || echo "⚠ Remote Login looks off: System Settings → General → Sharing → Remote Login"
```

- [ ] **Step 2: Write the failing test**

`packages/summon/tests/install.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { renderInstaller } from '../scripts/prepare-pairing.ts'

const tmps: string[] = []
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }) })
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
const PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey summon-air'

function bundle(): { dir: string; root: string } {
  const dir = mkdtempSync(join(tmpdir(), 'summon-bundle-')); const root = mkdtempSync(join(tmpdir(), 'summon-root-')); tmps.push(dir, root)
  for (const b of ['summon-gatekeeper', 'summon-runner']) { writeFileSync(join(dir, b), '#!/bin/sh\necho ' + b + '\n'); chmodSync(join(dir, b), 0o755) }
  const tmpl = readFileSync(join(import.meta.dir, '..', 'nuance', 'install.sh.tmpl'), 'utf8')
  writeFileSync(join(dir, 'summon-install.sh'), renderInstaller(tmpl, { pubkey: PUB, expiry: '20270110',
    shaGatekeeper: sha(join(dir, 'summon-gatekeeper')), shaRunner: sha(join(dir, 'summon-runner')) }))
  return { dir, root }
}
const run = (dir: string, root: string) => Bun.spawnSync(['bash', join(dir, 'summon-install.sh')], {
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: root, SUMMON_INSTALL_ROOT: root, SUMMON_SKIP_SUDO: '1', SUMMON_SKIP_LAUNCHCTL: '1', SUMMON_SKIP_INVENTORY: '1' },
})

describe('installer', () => {
  test('installs with private modes and one restricted key line', () => {
    const { dir, root } = bundle()
    writeFileSync(join(root, '.ssh-pre'), '')
    const r = run(dir, root)
    expect(r.exitCode).toBe(0)
    expect(statSync(join(root, '.local/share/summon')).mode & 0o777).toBe(0o700)
    expect(statSync(join(root, '.local/share/summon/summon-gatekeeper')).mode & 0o777).toBe(0o700)
    const ak = readFileSync(join(root, '.ssh/authorized_keys'), 'utf8')
    expect(ak).toBe(`restrict,from="192.168.50.0/24",expiry-time="20270110",command="${root}/.local/share/summon/summon-gatekeeper" ${PUB}\n`)
    expect(readFileSync(join(root, '.config/summon/allowlist.yaml'), 'utf8')).toContain('path: ~/Projects')
    expect(readFileSync(join(root, 'Library/LaunchAgents/dev.summon.runner.plist'), 'utf8')).toContain('<key>QueueDirectories</key>')
  })
  test('is idempotent, keeps other keys, and keeps an edited allowlist', () => {
    const { dir, root } = bundle()
    run(dir, root)
    writeFileSync(join(root, '.ssh/authorized_keys'), 'ssh-ed25519 OTHER yu-laptop\n' + readFileSync(join(root, '.ssh/authorized_keys'), 'utf8'))
    writeFileSync(join(root, '.config/summon/allowlist.yaml'), 'version: 1 # edited\n')
    expect(run(dir, root).exitCode).toBe(0)
    const lines = readFileSync(join(root, '.ssh/authorized_keys'), 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(lines[0]).toBe('ssh-ed25519 OTHER yu-laptop')
    expect(readFileSync(join(root, '.config/summon/allowlist.yaml'), 'utf8')).toBe('version: 1 # edited\n')
  })
  test('refuses a tampered binary', () => {
    const { dir, root } = bundle()
    writeFileSync(join(dir, 'summon-runner'), 'tampered')
    const r = run(dir, root)
    expect(r.exitCode).not.toBe(0)
    expect(r.stdout.toString()).toContain('checksum mismatch')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/summon && bun test tests/install.test.ts`
Expected: FAIL — `../scripts/prepare-pairing.ts` not found.

- [ ] **Step 4: Write the scripts**

`packages/summon/scripts/build-nuance.ts`:

```ts
// Compile the two Nuance programs into standalone arm64 binaries (no runtime needed there).
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function buildNuance(outDir: string) {
  mkdirSync(outDir, { recursive: true })
  const root = join(import.meta.dir, '..')
  const out: Record<string, string> = {}
  for (const [name, entry] of [['summon-gatekeeper', 'src/gatekeeper-main.ts'], ['summon-runner', 'src/runner-main.ts']] as const) {
    const target = join(outDir, name)
    const r = Bun.spawnSync(['bun', 'build', '--compile', '--target=bun-darwin-arm64', join(root, entry), '--outfile', target])
    if (r.exitCode !== 0) throw new Error(`build ${name} failed: ${r.stderr.toString()}`)
    out[name] = createHash('sha256').update(readFileSync(target)).digest('hex')
  }
  return { gatekeeper: join(outDir, 'summon-gatekeeper'), runner: join(outDir, 'summon-runner'),
    sha: { gatekeeper: out['summon-gatekeeper']!, runner: out['summon-runner']! } }
}

if (import.meta.main) console.log(JSON.stringify(buildNuance(join(import.meta.dir, '..', 'dist', 'nuance')), null, 2))
```

`packages/summon/scripts/prepare-pairing.ts`:

```ts
// On the Air: make the summon key (once), build the Nuance binaries, and write the
// AirDrop bundle ~/summon-nuance-bundle/ with a checksum-pinned installer.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildNuance } from './build-nuance.ts'

export function renderInstaller(tmpl: string, v: { pubkey: string; expiry: string; shaGatekeeper: string; shaRunner: string }): string {
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+ summon-air$/.test(v.pubkey)) throw new Error('unexpected public key format')
  if (!/^\d{8}$/.test(v.expiry) || !/^[0-9a-f]{64}$/.test(v.shaGatekeeper) || !/^[0-9a-f]{64}$/.test(v.shaRunner)) throw new Error('bad template values')
  return tmpl.replace('__PUBKEY__', v.pubkey).replace('__EXPIRY__', v.expiry)
    .replace('__SHA_GATEKEEPER__', v.shaGatekeeper).replace('__SHA_RUNNER__', v.shaRunner)
}

if (import.meta.main) {
  const sshDir = join(homedir(), '.ssh', 'summon')
  mkdirSync(sshDir, { recursive: true, mode: 0o700 }); chmodSync(sshDir, 0o700)
  const key = join(sshDir, 'summon_nuance_ed25519')
  if (!existsSync(key)) {
    const r = Bun.spawnSync(['/usr/bin/ssh-keygen', '-t', 'ed25519', '-N', '', '-C', 'summon-air', '-f', key])
    if (r.exitCode !== 0) throw new Error(r.stderr.toString())
  }
  const pubkey = readFileSync(`${key}.pub`, 'utf8').trim()
  const expiry = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '')
  const bundle = join(homedir(), 'summon-nuance-bundle')
  mkdirSync(bundle, { recursive: true })
  const built = buildNuance(join(import.meta.dir, '..', 'dist', 'nuance'))
  copyFileSync(built.gatekeeper, join(bundle, 'summon-gatekeeper'))
  copyFileSync(built.runner, join(bundle, 'summon-runner'))
  const tmpl = readFileSync(join(import.meta.dir, '..', 'nuance', 'install.sh.tmpl'), 'utf8')
  writeFileSync(join(bundle, 'summon-install.sh'), renderInstaller(tmpl, { pubkey, expiry, shaGatekeeper: built.sha.gatekeeper, shaRunner: built.sha.runner }))
  writeFileSync(join(bundle, 'MANIFEST.txt'), `summon-gatekeeper ${built.sha.gatekeeper}\nsummon-runner ${built.sha.runner}\nkey summon-air expires ${expiry}\n`)
  console.log(`bundle ready: ${bundle}\nAirDrop the folder to Nuance, then on Nuance: bash ~/Downloads/summon-nuance-bundle/summon-install.sh`)
}
```

`packages/summon/scripts/pin-nuance.ts`:

```ts
// On the Air, after the installer ran on Nuance: record Nuance's user and host key.
//   bun scripts/pin-nuance.ts --user <name> --host-key "ssh-ed25519 AAAA… root@Nuance"
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function writeSshConfig(dir: string, user: string, hostKeyLine: string): void {
  if (!/^[a-z_][a-z0-9._-]{0,31}$/i.test(user)) throw new Error('bad user name')
  const m = /^(ssh-ed25519) ([A-Za-z0-9+/=]+)(?: .*)?$/.exec(hostKeyLine.trim())
  if (!m) throw new Error('expected the ssh-ed25519 host key line the installer printed')
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700)
  writeFileSync(join(dir, 'known_hosts'), `summon-nuance ${m[1]} ${m[2]}\n`, { mode: 0o600 })
  writeFileSync(join(dir, 'config'), [
    'Host summon-nuance', '  HostName nuance.local', '  AddressFamily inet', `  User ${user}`,
    `  IdentityFile ${join(dir, 'summon_nuance_ed25519')}`, '  IdentitiesOnly yes', '  HostKeyAlias summon-nuance',
    `  UserKnownHostsFile ${join(dir, 'known_hosts')}`, '  StrictHostKeyChecking yes', '  BatchMode yes', '  ConnectTimeout 8',
    '  ServerAliveInterval 15', '  ServerAliveCountMax 2', '  RequestTTY no', '  ForwardAgent no', '  ClearAllForwardings yes', '',
  ].join('\n'), { mode: 0o600 })
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const get = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
  const user = get('--user'); const hostKey = get('--host-key')
  if (!user || !hostKey) { console.error('usage: bun scripts/pin-nuance.ts --user <name> --host-key "<line>"'); process.exit(2) }
  writeSshConfig(join(homedir(), '.ssh', 'summon'), user, hostKey)
  console.log('pinned. try: summon nuance inventory')
}
```

- [ ] **Step 5: Run test to verify it passes, and check the real build**

Run: `cd packages/summon && bun test tests/install.test.ts`
Expected: PASS.

Run: `bun scripts/build-nuance.ts && file dist/nuance/summon-gatekeeper && codesign -dv dist/nuance/summon-gatekeeper 2>&1 | grep Signature`
Expected: `Mach-O 64-bit executable arm64` and `Signature=adhoc`.

Run: `SSH_ORIGINAL_COMMAND='ls' SUMMON_HOME_OVERRIDE=$(mktemp -d) ./dist/nuance/summon-gatekeeper; echo "exit $?"`
Expected: `{"status":"refused","reason":"malformed","detail":"unknown command"}`, then `exit 2`.

Add `dist/` to `packages/summon/.gitignore`.

- [ ] **Step 6: Commit**

```bash
printf 'dist/\n' > packages/summon/.gitignore
git add packages/summon/scripts packages/summon/nuance packages/summon/tests/install.test.ts packages/summon/.gitignore
git commit -m "feat(summon): compiled Nuance binaries, checksum-pinned installer, pairing scripts

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

---

### Task 11: Hermetic end-to-end

**Files:**
- Test: `packages/summon/tests/e2e.test.ts`

**Interfaces:**
- Consumes: `runCli` (Task 9), `gatekeeper-main.ts` (Task 5), `runOnce` (Task 7), `fake-claude.ts`, `targetHome` (Task 4)

- [ ] **Step 1: Write the test.** A fake `ssh` turns the remote verb into `SSH_ORIGINAL_COMMAND` and runs the real gatekeeper against a temp "Nuance" home.

`packages/summon/tests/e2e.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, type CliDeps } from '../src/cli.ts'
import { summonPaths } from '../src/paths.ts'
import { runOnce } from '../src/runner.ts'
import { verifyLedger } from '../src/ledger.ts'
import { targetHome } from './gate.test.ts'
import { makeFakeClaude } from './helpers.ts'

const GATE = join(import.meta.dir, '..', 'src', 'gatekeeper-main.ts')
const fake = makeFakeClaude()
const FAKE = fake.bin
const tmps: string[] = []
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }) })

function world() {
  const nuance = targetHome()
  const air = mkdtempSync(join(tmpdir(), 'summon-air-')); tmps.push(air)
  const ssh = join(air, 'ssh')
  // args: -F <config> summon-nuance <verb...>
  writeFileSync(ssh, `#!/bin/bash\nshift 2; shift\nexport SSH_ORIGINAL_COMMAND="$*"\nexport HOME='${nuance}' SUMMON_HOME_OVERRIDE='${nuance}' SUMMON_TEST_GUI=1 SUMMON_TEST_RUNNER=1 SUMMON_CLAUDE_BIN='${FAKE}'\nexec bun '${GATE}'\n`)
  chmodSync(ssh, 0o755)
  writeFileSync(join(air, 'task.md'), 'Summarise the README.')
  const deps: CliDeps = { sshBin: ssh, sshConfig: join(air, 'config'), ledgerPath: join(air, 'ledger.jsonl'), device: 'air',
    nowMs: () => Date.now(), readFile: (p) => readFileSync(p, 'utf8'), readStdin: () => '' }
  const runner = () => { fake.setMode('ok'); return runOnce({ paths: summonPaths(nuance), home: nuance, user: 'yu', nowMs: () => Date.now(),
    claudeBin: () => FAKE, collectInventory: async () => ({ macos: 'e2e' }), heartbeatMs: 50, pollMs: 25, killGraceMs: 200 }) }
  const start = (cwd = '~/Projects/x') => runCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', cwd, '--review', '--prompt-file', join(air, 'task.md')], deps)
  return { nuance, air, deps, runner, start }
}

describe('Phase 0 end to end (spec §5.3)', () => {
  test('a job summon returns its result; both ledgers verify', async () => {
    const w = world()
    const r = w.start()
    expect(r.out.status).toBe('admitted')
    await w.runner()
    const res = runCli(['result', String(r.out.handle)], w.deps)
    expect(res.out).toMatchObject({ status: 'completed', result_text: 'echo: Summarise the README.' })
    expect(verifyLedger(w.deps.ledgerPath).ok).toBe(true)
    expect(verifyLedger(summonPaths(w.nuance).ledger).ok).toBe(true)
  })
  test('a non-allowlisted folder is refused with the line to add', () => {
    const w = world()
    const r = w.start('~/Elsewhere')
    expect(r.out).toMatchObject({ status: 'refused', reason: 'outside_allowlist' })
  })
  test('a shell request is refused', () => {
    const w = world()
    const p = Bun.spawnSync([w.deps.sshBin, '-F', 'x', 'summon-nuance', 'ls', '-la'])
    expect(JSON.parse(p.stdout.toString())).toMatchObject({ reason: 'malformed' })
  })
})
```

- [ ] **Step 2: Run it**

Run: `cd packages/summon && bun test tests/e2e.test.ts`
Expected: PASS. If it fails, fix the owning task's code, not this test.

- [ ] **Step 3: Run the whole package suite**

Run: `cd packages/summon && bun test tests/`
Expected: every file passes. Record the count.

- [ ] **Step 4: Commit**

```bash
git add packages/summon/tests/e2e.test.ts
git commit -m "test(summon): hermetic end-to-end — CLI → fake ssh → gatekeeper → runner → result

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

---

### Task 12: Adversarial review gate (before anything touches Nuance)

**Files:** whatever the confirmed findings touch, each fix with a test.

- [ ] **Step 1:** Run a review workflow over `git diff docs/mesh-summon-spec-20261010..feat/summon-phase0 -- packages/summon` with four lenses:
  - **gatekeeper input handling**: grammar, stdin, ids, JSON, paths;
  - **runner and harness posture**: the argv against `claude --help` 2.1.296; env, kill paths, caffeinate;
  - **installer and SSH**: the `authorized_keys` line, the sshd drop-in, plist, checksums, idempotency, sudo failure paths;
  - **spec conformance**: every Global Constraint and status string.

  One skeptic per finding. Live probes are allowed only in temp homes with Haiku and the fake harness. Nothing touches Nuance.
- [ ] **Step 2:** For each confirmed blocker or major: write a failing test, fix, pass. Minors go in a list for Yu.
- [ ] **Step 3:** Re-run `cd packages/summon && bun test tests/`. Expected: all pass.
- [ ] **Step 4:** Commit: `fix(summon): review findings — <one line each>`, with the trailer.

---

### Task 13: Supervised install with Yu, and the live probes

Yu's hands are needed for steps 2–3. Everything else is done from the Air.

- [ ] **Step 1 (Air):** `cd packages/summon && bun scripts/prepare-pairing.ts`. Expected: `bundle ready: ~/summon-nuance-bundle-<expiry>-<build>`, the key's expiry, and the exact `bash ~/Downloads/summon-nuance-bundle-<expiry>-<build>/summon-install.sh` line. Show Yu `MANIFEST.txt`.
- [ ] **Step 2 (Yu, at Nuance):** first, in Terminal, `ls /etc/ssh/ssh_host_*` and record the output (whether macOS has made host keys yet). Then System Settings → General → Sharing → **Remote Login** on, *Allow access for: only* his user.
- [ ] **Step 3 (Yu):** AirDrop the bundle folder to Nuance. In Terminal there, run the exact line step 1 printed, typing his password at the sudo prompt. Send back the "give this back to Ai" block (user, build, prepared, key expires, host key, pin line) and check `build` and `prepared` match `MANIFEST.txt` (the installer only says `Done` once the host key and the inventory answer are both in). Then `codesign --verify --strict -vvv ~/.local/share/summon/summon-gatekeeper ~/.local/share/summon/summon-runner` → both `valid on disk` and `satisfies its Designated Requirement`. macOS shows a "Background Items Added" notification for dev.summon.runner: leave it allowed in System Settings → General → Login Items, or every start reads `runner_missing`. Once Ai has the block, delete the bundle folder from `~/Downloads`.
- [ ] **Step 4 (Air):** run the pin line the installer printed, `bun scripts/pin-nuance.ts --user <user> --host-key "<host key line>" --expires <YYYYMMDD>`. It prints the pinned host key's SHA256 fingerprint: ask Yu to confirm it matches the one the installer printed on Nuance (the `ssh-keygen` line under `host key:`). Then, unless `ls -l ~/.local/bin/summon` shows a foreign file there: `mkdir -p ~/.local/bin && ln -sf "$PWD/bin/summon.ts" ~/.local/bin/summon`.
- [ ] **Step 5 (Air): live probes** (spec §5.3), each recorded with its output:
  1. `summon nuance inventory` → the report. Check `harnesses.claude.logged_in: true`, `gui_session_is_mine: true`, `fleet_users`, `keychain`.
  2. `summon nuance claude --model haiku --cwd '~/Projects' --review --prompt-file <(echo 'List the top-level folders here, one line.')` → `admitted`; `summon result nuance/smn_…` → `completed`.
  3. The same request JSON sent twice through `ssh -F ~/.ssh/summon/config summon-nuance start` → `refused(replayed)`.
  4. `--cwd '~/Documents'` → `refused(tcc_protected_folder)`; `--cwd '/'` → `refused(outside_allowlist)` with a hint.
  5. A request with `expires_at` in the past → `refused(expired)`.
  6. `ssh -F ~/.ssh/summon/config summon-nuance ls`, `scp -F ~/.ssh/summon/config x summon-nuance:/tmp/` and `sftp -F ~/.ssh/summon/config summon-nuance` all refused; no shell ever.
  7. A password login: `ssh -F ~/.ssh/summon/config -o PubkeyAuthentication=no -o PreferredAuthentications=keyboard-interactive,password summon-nuance` → the output line must be exactly `<user>@nuance.local: Permission denied (publickey).` The method list in the parentheses is the evidence (the ways sshd still offers): `password` or `keyboard-interactive` in it is a FAIL.
  8. With Yu's agreement only: Yu logs out at Nuance → `refused(target_logged_out)`. Lid closed → `unreachable(timeout)`.
  9. Traversal ids (spec §7): `ssh -F ~/.ssh/summon/config summon-nuance 'status smn_../../x'`, and the same with `result smn_../../../etc/passwd`, `status smn_%2e%2e%2fx`, `cancel ../smn_x` and `status smn_0123456789abcdef0123456789abcdef/..` → each `refused(malformed)`.
  10. IPv4 forcing (spec §7): `ssh -6 -F ~/.ssh/summon/config summon-nuance inventory` and `ssh -o AddressFamily=inet6 -F ~/.ssh/summon/config summon-nuance inventory`. A pass is anything but an answer: raw ssh printing `Permission denied (publickey)` (the IPv6 source misses `from="192.168.50.0/24"`), a failure to resolve `nuance.local` over IPv6, or a Summon refusal.
  11. On battery (spec §5.3 #8): Nuance unplugged, lid open: a haiku job (as in 2) → `completed`. While it runs, Yu runs `pmset -g assertions` on Nuance and records the `caffeinate` assertion (PreventUserIdleSystemSleep) held for the job.
  12. Lid closed mid-job (spec §5.3 #8), with Yu's agreement: start a job that takes minutes, close the lid for a few minutes, then open it. From the Air, poll `summon status nuance/smn_…` every 15 s across the close and the wake, and record what is seen (unreachable while closed; after the wake, `running` with some `heartbeat: <n>s ago`, then the end). Any n is recorded as seen; it need not match the pause, and step 7 does not depend on it.
  13. Edit without `reads_anywhere`: Yu makes an empty throwaway folder (`mkdir ~/Projects/summon-edit-probe`) and adds it as `access: edit`, with no `reads_anywhere: true` on the claude entry. A haiku `--edit` request there with a no-op prompt (`Reply with the word ok.`) → `refused(outside_allowlist)` with a hint, and nothing runs. Then remove the allowlist entry and the folder.
  14. Effort: with `effort: [low]` added to the haiku entry, one `--model haiku --effort low` job → `completed`.
  15. Pre-auth drop (Task 12 C review): macOS starts sshd per connection, so MaxStartups never trips; drop the connection before authentication with a key-exchange mismatch instead (the Air's OpenSSH 9.9p2 still knows `diffie-hellman-group1-sha1`, which macOS's sshd does not offer by default; if it connects anyway, record that and use one that Nuance's `sudo sshd -T | grep kexalgorithms` does not list). Run `ssh -F ~/.ssh/summon/config -o KexAlgorithms=diffie-hellman-group1-sha1 summon-nuance inventory; echo "exit $?"` and record exactly what is printed (on 9.9p2 the expected shape is `Unable to negotiate with <ip> port 22: no matching key exchange method found. Their offer: …`, exit 255). Then the status summon gives it, through a wrapper that adds the same option: `printf '#!/bin/sh\nexec /usr/bin/ssh -o KexAlgorithms=diffie-hellman-group1-sha1 "$@"\n' > /tmp/summon-kex-ssh && chmod 700 /tmp/summon-kex-ssh && SUMMON_SSH_BIN=/tmp/summon-kex-ssh summon nuance inventory; rm /tmp/summon-kex-ssh` → `unknown` with that line as its detail, by design (no transport status is read from a negotiation failure; a bare `Connection closed by <ip> port 22` also reads `unknown`).
- [ ] **Step 6:** Record every result in `packages/summon/README.md` under "Phase 0 live check (2026-10-…)", then commit.
- [ ] **Step 7:** Tell Yu what worked, what didn't, and the rollback (spec §7). Ask whether to keep, widen (more folders or harnesses) or roll back. Widening waits until every probe in step 5 has passed (spec §7).

// The Air's record of one paired Mac (spec §4.3): `~/.config/collab-bridge/devices/<device>.json`, 0600 in a 0700 dir.
// prepare-pairing writes it `prepared`, pin-device makes it `paired` from hello, the hub records what the first
// session_start shows, and unpair marks it `unpaired`. Parsing is strict and fails closed: the hub dials, attaches and
// fetches only by what this file says, so a field it cannot vouch for makes the whole file unreadable (needs Yu: config).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { withLock } from '../ledger.ts'
import { writeFileDurable } from '../native.ts'
import { mkdirPrivate } from '../private-dir.ts'
import type { ResolvedGit } from '../nuance/git-resolve.ts'
import { MAX_GITDIR_BYTES, sharePathProblem } from '../share-path.ts'
import type { TreeCaps } from './diff-check.ts'

export interface DeviceShare { remote_realpath: string; remote_gitdir: string | null; air_clone: string; mirror_id: string;
  mirror_worktree_id: string | null; workspace_id: string | null; caps: TreeCaps }
export interface DeviceFile { v: 1; device: string; user: string; state: 'prepared' | 'paired' | 'unpaired'; host_alias: string;
  seat_public: string | null; bundle_build: string; key_expiry: string; trailer: string; git: ResolvedGit | null;
  summon: { key_sha256: string; dropin_stat: string } | null; shares: DeviceShare[]; prepared_at: string; paired_at: string | null }

const DEVICE_RE = /^[a-z][a-z0-9-]{0,31}$/ // Summon's DEVICE_RE
const USER_RE = /^[a-z_][a-z0-9._-]{0,31}$/ // the installer's (Task 57)
const HEX64_RE = /^[0-9a-f]{64}$/
const BUILD_RE = /^[0-9a-f]{8}$/
const EXPIRY_RE = /^[0-9]{8}$/ // YYYYMMDD, the key line's expiry-time (spec §5.1)
const TRAILER_RE = /^[ -&(-~]{1,200}$/ // printable ASCII without ', as the installer template takes it (Task 57)
const MIRROR_ID_RE = /^[0-9a-f]{16}$/ // sha256(remote realpath)[:16] (spec §7.1)
const WORKTREE_ID_RE = /^wt_[0-9a-f]{24}$/ // Collab's worktree id (KN src/repository.ts:284)
const WORKSPACE_ID_RE = /^ws_[0-9a-f]{24}$/ // Collab's workspace id (KN src/store.ts:1401)
const VERSION_RE = /^[0-9]+\.[0-9]+(\.[0-9]+)*$/
const DROPIN_STAT_RE = /^[0-9]+ [0-9]+ [0-9]+ [0-9]+ [0-7]{1,4}$/ // `<ino> <size> <mtime> <uid> <mode>` (P22)

const FILE_KEYS = ['v', 'device', 'user', 'state', 'host_alias', 'seat_public', 'bundle_build', 'key_expiry', 'trailer', 'git', 'summon',
  'shares', 'prepared_at', 'paired_at']
const SHARE_KEYS = ['remote_realpath', 'remote_gitdir', 'air_clone', 'mirror_id', 'mirror_worktree_id', 'workspace_id', 'caps']
const CAPS_KEYS = ['maxEntries', 'maxTotalBytes', 'maxBlobBytes', 'maxChangedPaths']
const GIT_KEYS = ['path', 'version', 'sha256', 'guard', 'apple']
const SUMMON_KEYS = ['key_sha256', 'dropin_stat']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)
/** Exactly these keys, no more and no fewer. */
const exactKeys = (o: Obj, keys: string[]) => {
  const have = Object.keys(o).sort()
  const want = [...keys].sort()
  return have.length === want.length && have.every((k, i) => k === want[i])
}
const matches = (v: unknown, re: RegExp): v is string => typeof v === 'string' && re.test(v)
const orNull = (v: unknown, ok: (x: unknown) => boolean) => v === null || ok(v)
/** An ISO 8601 UTC time exactly as Date.prototype.toISOString writes it. */
const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v
/** An Air path: absolute, at most `max` bytes, no control character. A Nuance share path is the gate's (sharePathProblem). */
const absPath = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.startsWith('/') && Buffer.byteLength(v, 'utf8') <= max && !/[\x00-\x1f\x7f]/.test(v)
const posInt = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

function capsOk(v: unknown): v is TreeCaps {
  return isObj(v) && exactKeys(v, CAPS_KEYS) && CAPS_KEYS.every((k) => posInt(v[k]))
}

function gitOk(v: unknown): v is ResolvedGit {
  return isObj(v) && exactKeys(v, GIT_KEYS) && absPath(v.path, 1024) && matches(v.version, VERSION_RE)
    && matches(v.sha256, HEX64_RE) && typeof v.guard === 'boolean' && typeof v.apple === 'boolean'
}

function summonOk(v: unknown): boolean {
  return isObj(v) && exactKeys(v, SUMMON_KEYS) && matches(v.key_sha256, HEX64_RE) && matches(v.dropin_stat, DROPIN_STAT_RE)
}

function shareOk(v: unknown): v is DeviceShare {
  return isObj(v) && exactKeys(v, SHARE_KEYS)
    && sharePathProblem(v.remote_realpath) === null // the gate's one rule (Task 20): the gitdir must still fit its 1024-byte form
    && orNull(v.remote_gitdir, (x) => sharePathProblem(x, MAX_GITDIR_BYTES) === null)
    && absPath(v.air_clone, 1024)
    && matches(v.mirror_id, MIRROR_ID_RE)
    && orNull(v.mirror_worktree_id, (x) => matches(x, WORKTREE_ID_RE))
    && orNull(v.workspace_id, (x) => matches(x, WORKSPACE_ID_RE))
    && capsOk(v.caps)
}

/**
 * The device file, or null for anything it cannot vouch for: missing or extra keys, a value outside its pattern, a
 * host alias other than `collab-<device>`, two shares with one realpath or mirror id, or a `paired` file without its
 * seat key, git, Summon baselines, paired_at or any share's remote gitdir.
 */
export function parseDevice(text: string): DeviceFile | null {
  let o: unknown
  try { o = JSON.parse(text) } catch { return null }
  if (!isObj(o) || !exactKeys(o, FILE_KEYS)) return null
  if (o.v !== 1 || !matches(o.device, DEVICE_RE) || !matches(o.user, USER_RE)) return null
  if (o.state !== 'prepared' && o.state !== 'paired' && o.state !== 'unpaired') return null
  if (o.host_alias !== `collab-${o.device}`) return null
  if (!orNull(o.seat_public, (x) => matches(x, HEX64_RE))) return null
  if (!matches(o.bundle_build, BUILD_RE) || !matches(o.key_expiry, EXPIRY_RE) || !matches(o.trailer, TRAILER_RE)) return null
  if (!orNull(o.git, gitOk) || !orNull(o.summon, summonOk)) return null
  if (!Array.isArray(o.shares) || o.shares.length === 0 || o.shares.length > 64 || !o.shares.every(shareOk)) return null
  const shares = o.shares as DeviceShare[]
  if (new Set(shares.map((s) => s.remote_realpath)).size !== shares.length) return null
  if (new Set(shares.map((s) => s.mirror_id)).size !== shares.length) return null
  if (!isIso(o.prepared_at) || !orNull(o.paired_at, isIso)) return null
  if (o.state === 'paired' && (o.seat_public === null || o.git === null || o.summon === null || o.paired_at === null
    || shares.some((s) => s.remote_gitdir === null))) return null
  return o as unknown as DeviceFile
}

/** The device file at `path`, or null when it is missing or does not parse. */
export function readDevice(path: string): DeviceFile | null {
  let text: string
  try { text = readFileSync(path, 'utf8') } catch { return null }
  return parseDevice(text)
}

/** Writes the file whole (temp, F_FULLFSYNC, rename), 0600 in a 0700 dir; refuses anything parseDevice would refuse. */
export function writeDevice(path: string, d: DeviceFile): void {
  const text = JSON.stringify(d, null, 2) + '\n'
  if (!parseDevice(text)) throw new Error(`devices: refusing to write an invalid device file (${basename(path)})`)
  mkdirPrivate(dirname(path))
  writeFileDurable(path, text, 0o600)
}

/**
 * Re-read, change, write, all under `${path}.lock` (withLock). The hub and `collab-bridge unpair` are different processes:
 * a caller that kept a copy from earlier never writes it back over a change made since. `fn` returning null writes
 * nothing. A missing file returns null without calling `fn`; a damaged one throws and is left as it is.
 */
export function updateDevice(path: string, fn: (d: DeviceFile) => DeviceFile | null): DeviceFile | null {
  if (!existsSync(dirname(path))) return null
  return withLock(path, () => {
    if (!existsSync(path)) return null
    const current = parseDevice(readFileSync(path, 'utf8'))
    if (!current) throw new Error(`devices: ${basename(path)} is damaged; nothing was written`)
    const next = fn(current)
    if (next === null) return null
    writeDevice(path, next)
    return next
  })
}

/** Every `<device>.json` in `dir` (a missing dir is none); a file that does not parse, or names another device, throws. */
export function listDevices(dir: string): DeviceFile[] {
  if (!existsSync(dir)) return []
  const out: DeviceFile[] = []
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || !name.endsWith('.json')) continue
    const d = readDevice(join(dir, name))
    if (!d || `${d.device}.json` !== name) throw new Error(`devices: ${name} is damaged (needs Yu: config)`)
    out.push(d)
  }
  return out
}

/** The share whose Nuance realpath is exactly `folder` (the pipe's attach.folder), or null. */
export function shareForFolder(d: DeviceFile, folder: string): DeviceShare | null {
  return d.shares.find((s) => s.remote_realpath === folder) ?? null
}

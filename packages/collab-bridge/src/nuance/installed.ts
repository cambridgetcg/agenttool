// INSTALLED and shares.json on Nuance (spec §4.3, §5.2 hello, §10.3 steps 4–5; P22, P23). INSTALLED is one `key value`
// per line in a fixed order, like Summon's, so a person can read it and a bash line can sed one value out of it.
import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeFileDurable } from '../native.ts'
import type { NuancePaths } from '../paths.ts'
import { MAX_GITDIR_BYTES, sharePathProblem } from '../share-path.ts'
import type { ResolvedGit } from './git-resolve.ts'

export interface Share { realpath: string; gitdir: string }
export interface InstalledInfo { device: string; build: string; prepared: string; expiry: string; binary_sha256: string; tools_seed: string;
  git: ResolvedGit; summon_key_sha256: string; summon_dropin_stat: string; claude_version: string | null; installed_at: string }

const HEX64 = /^[0-9a-f]{64}$/
/** Every key, in the order it is written, with the only values it may hold. */
const FORMATS = {
  device: /^[a-z][a-z0-9-]{0,31}$/,
  build: /^[0-9a-f]{8}$/,
  prepared: /^\d{14}$/,
  expiry: /^\d{8}$/,
  binary_sha256: HEX64,
  tools_seed: HEX64,
  git_path: /^\/[\x20-\x7e]{0,1023}$/,
  git_version: /^\d+\.\d+\.\d+$/,
  git_sha256: HEX64,
  git_guard: /^(yes|no)$/,
  git_apple: /^(yes|no)$/,
  summon_key_sha256: HEX64,
  summon_dropin_stat: /^\d+ \d+ \d+ \d+ [0-7]{1,4}$/,
  claude_version: /^[\x20-\x7e]{1,128}$/,          // `-` stands for "no claude version recorded"
  installed_at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/,
} as const
type Key = keyof typeof FORMATS
const KEYS = Object.keys(FORMATS) as Key[]
const yesNo = (b: boolean) => (b ? 'yes' : 'no')

export function renderInstalled(i: InstalledInfo): string {
  const values: Record<Key, string> = {
    device: i.device, build: i.build, prepared: i.prepared, expiry: i.expiry, binary_sha256: i.binary_sha256, tools_seed: i.tools_seed,
    git_path: i.git.path, git_version: i.git.version, git_sha256: i.git.sha256, git_guard: yesNo(i.git.guard), git_apple: yesNo(i.git.apple),
    summon_key_sha256: i.summon_key_sha256, summon_dropin_stat: i.summon_dropin_stat,
    claude_version: i.claude_version ?? '-', installed_at: i.installed_at,
  }
  // A value that is not one line of its own format would make the file unreadable later: refuse to write it at all.
  for (const k of KEYS) if (!FORMATS[k].test(values[k])) throw new Error(`INSTALLED: ${k} is malformed`)
  return KEYS.map((k) => `${k} ${values[k]}\n`).join('')
}

/** Null unless every key is present once and well-formed; keys this build does not know are ignored. */
export function parseInstalled(text: string): InstalledInfo | null {
  const v = new Map<Key, string>()
  for (const line of text.split('\n')) {
    if (line === '') continue
    const sp = line.indexOf(' ')
    if (sp < 1) return null
    const k = line.slice(0, sp), value = line.slice(sp + 1)
    if (!(k in FORMATS)) continue
    if (v.has(k as Key) || !FORMATS[k as Key].test(value)) return null
    v.set(k as Key, value)
  }
  if (KEYS.some((k) => !v.has(k))) return null
  const g = (k: Key) => v.get(k)!
  return {
    device: g('device'), build: g('build'), prepared: g('prepared'), expiry: g('expiry'), binary_sha256: g('binary_sha256'),
    tools_seed: g('tools_seed'),
    git: { path: g('git_path'), version: g('git_version'), sha256: g('git_sha256'), guard: g('git_guard') === 'yes', apple: g('git_apple') === 'yes' },
    summon_key_sha256: g('summon_key_sha256'), summon_dropin_stat: g('summon_dropin_stat'),
    claude_version: g('claude_version') === '-' ? null : g('claude_version'), installed_at: g('installed_at'),
  }
}

export function readInstalled(paths: NuancePaths): InstalledInfo | null {
  try { return parseInstalled(readFileSync(paths.installed, 'utf8')) } catch { return null }
}

/** A share the gate's upload-pack form can carry (§5.2): both paths by the one rule of src/share-path.ts. */
function shareOk(s: unknown): s is Share {
  if (!s || typeof s !== 'object') return false
  const { realpath, gitdir } = s as Record<string, unknown>
  return sharePathProblem(realpath) === null && sharePathProblem(gitdir, MAX_GITDIR_BYTES) === null
}

/** `{"v":1,"shares":[{realpath,gitdir}]}`; null when missing or anything in it is malformed. */
export function readShares(paths: NuancePaths): Share[] | null {
  let o: any
  try { o = JSON.parse(readFileSync(paths.shares, 'utf8')) } catch { return null }
  if (!o || o.v !== 1 || !Array.isArray(o.shares) || !o.shares.every(shareOk)) return null
  return o.shares.map((s: Share) => ({ realpath: s.realpath, gitdir: s.gitdir }))
}

export function writeShares(paths: NuancePaths, shares: Share[]): void {
  for (const s of shares) if (!shareOk(s)) throw new Error(`shares.json: share ${String((s as Share)?.realpath)} cannot be served`)
  const dir = dirname(paths.shares)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  writeFileDurable(paths.shares, JSON.stringify({ v: 1, shares: shares.map((s) => ({ realpath: s.realpath, gitdir: s.gitdir })) }) + '\n', 0o600)
}

/** sha256 of the authorized_keys lines ending ` summon-air`, sorted and '\n'-joined: Summon's own line(s) only. */
export function summonKeySha256(authorizedKeysText: string): string {
  const lines = authorizedKeysText.split('\n').filter((l) => l.endsWith(' summon-air')).sort()
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

/**
 * The drop-in's identity without reading it (P22: Summon installs it root:wheel 0600): `<ino> <size> <mtime ms> <uid> <mode>`,
 * from lstat, with bigint fields so a large inode is exact. Null when it cannot be stat'ed.
 */
export function dropinStat(path: string): string | null {
  try {
    const st = lstatSync(path, { bigint: true })
    return `${st.ino} ${st.size} ${st.mtimeMs} ${st.uid} ${(st.mode & 0o7777n).toString(8)}`
  } catch {
    return null
  }
}

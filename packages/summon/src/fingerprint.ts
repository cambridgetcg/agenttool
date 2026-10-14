// Phase 0.5 §3 "Fingerprint" (Rulings S8 and S9). Inside its folder the sandbox cannot tell `src/` from `.git/config`, so the runner (which is
// not sandboxed) keeps a fingerprint of the git files that could run code later, and compares it when an edit or build job ends. It DETECTS;
// it never repairs. Everything here only reads: lstat, readdir, readlink and the sha256 of a file. There is no chmod, chflags, ACL tool,
// removal or write anywhere in this module, because each of those, run unsandboxed on a folder that a sandboxed job wrote, is a way for the
// job to steer the runner (a link followed out of the folder, a flag or ACL stripped from somewhere else). What a change costs the folder is
// decided by the caller: it is marked tampered and blocked, and Yu clears it by hand.
//
// The watched set is the root `.git` only (Ruling S9), plus two files in the folder root:
//   .git/config, .git/config.worktree and .git/commondir (the last two send git to other configuration), everything under .git/hooks/ and
//   .git/info/, and .gitattributes and .gitmodules in the folder root.
// It never goes into objects, refs, logs or modules: those are git's own data, and what git does there while a job works is not a change.
// Git enters another repository only through a submodule or a nested repository, so the rest of the guard looks for exactly those:
//   - a `.git` entry anywhere below the root that was not there before the job (a bounded walk that skips node_modules and the runner's own
//     `.summon-tmp`), and
//   - any index entry of mode 160000, a gitlink, read with `git ls-files --stage` under the job's own git env (gitlinkPaths).
// Admission already refuses a folder with `.gitmodules` or `.git/modules`, and the runner refuses one whose index has a gitlink, so a
// submodule is never part of the baseline; whatever appears during a job is a change.
//
// The names are found by listing the folder, `.git/`, and the hooks and info trees, and matching without regard to case, so every spelling
// the Mac's case-insensitive volume answers to (`.Git`, `.GitAttributes`, `Config`) is covered. The baseline holds, for each watched path,
// its type, mode, size and sha256, and no contents (a `.git/config` can hold credentials). While the job runs the runner also keeps it as a
// 0600 file in the job's private state directory (serializeBaseline / parseBaseline), so a runner that dies mid-job can still compare.
// A job may try to hide a change with a mode of 000, a user flag or a deny ACL; none of that is undone here, it is read as what it is: a
// path that cannot be read is a path that changed.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, constants, lstatSync, openSync, readdirSync, readlinkSync, readSync, type Dirent, type Stats } from 'node:fs'
import { join } from 'node:path'

/** The names in a directory, in the spelling they are stored under. Injectable so a test can show the runner any spelling. */
export type ListDir = (dir: string) => string[]
export const realList: ListDir = (dir) => readdirSync(dir)

export class FingerprintError extends Error {}

/** The files of the git directory that hold configuration or name where it is: `commondir` makes git take config, hooks and info from the directory it names. */
const CONFIG_FILES: ReadonlySet<string> = new Set(['config', 'config.worktree', 'commondir'])

/** What a comparison names when it could not even list the folder. */
const FOLDER = '(the folder)'
const WALK_LIMIT = '(the folder walk limit)'
const COMPARE_FAILED = '(the git files could not be compared)'
const INDEX_UNREADABLE = '(the index could not be read)'
/** The hash of a path that is known to differ (or that could not be read) without having been hashed. It is not a hex digest, so it equals nothing. */
const CHANGED = 'changed'

/**
 * How far the search for nested `.git` entries goes: entries read in all, and directory depth. A folder that passes either is not shown
 * clean, so the job does not start (baseline) or counts as changed (comparison).
 */
export interface WalkLimits { entries: number; depth: number }
export const WALK_LIMITS: WalkLimits = { entries: 1_000_000, depth: 128 }

/** The runner's own temp directory in the folder root: a repository a test makes in TMPDIR is not a nested repository of the folder. */
const RUNNER_TMP = '.summon-tmp'

interface Entry {
  /** `other` is a pipe, socket or device: never opened. */
  kind: 'file' | 'symlink' | 'other'
  mode: number
  /** The file's size, or a link's length. A comparison hashes a file only when kind, mode and size are the baseline's. */
  size: number
  sha: string
}
export interface Baseline {
  root: string
  /** Path from the folder root, as stored, to the file, link or special file. */
  files: Map<string, Entry>
  /** The watched directories (`.git` itself, hooks, info and what is in them), with their modes. */
  dirs: Map<string, number>
  /** The `.git` entries below the root that were there before the job, as stored. */
  nested: Set<string>
}

const sha256 = (...parts: Array<string | Buffer>) => parts.reduce((h, p) => h.update(p), createHash('sha256')).digest('hex')
const errCode = (e: unknown) => (e as { code?: string })?.code
const missing = (e: unknown) => errCode(e) === 'ENOENT' || errCode(e) === 'ENOTDIR'

/** The sha256 of a regular file, read in pieces, opened without following a link and without blocking on a pipe swapped in late. */
function hashFile(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const h = createHash('sha256')
    const buf = Buffer.alloc(64 * 1024)
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null)
      if (n === 0) break
      h.update(buf.subarray(0, n))
    }
    return h.digest('hex')
  } finally { closeSync(fd) }
}

class WalkLimitError extends Error {}

/**
 * Every `.git` entry below the folder root, as a path from it. Not entered: node_modules, the root's own `.git` and `.summon-tmp`, a
 * `.git` found below (its contents are git's), and a link (never followed). A directory that cannot be listed or a walk past its limits
 * throws; `unreadable` collects the former for a comparison, which names them instead of stopping.
 */
function walkNested(root: string, lim: WalkLimits, unreadable: Set<string> | null): Set<string> {
  const found = new Set<string>()
  const stack: Array<{ rel: string; depth: number }> = [{ rel: '', depth: 0 }]
  let entries = 0
  while (stack.length > 0) {
    const { rel, depth } = stack.pop()!
    let names: Dirent[]
    try { names = readdirSync(rel ? join(root, rel) : root, { withFileTypes: true }) } catch (e) {
      if (missing(e)) continue
      if (!unreadable) throw new FingerprintError('a folder could not be listed')
      unreadable.add(rel || FOLDER); continue
    }
    for (const ent of names) {
      if (++entries > lim.entries) throw new WalkLimitError()
      const lower = ent.name.toLowerCase()
      const child = rel ? `${rel}/${ent.name}` : ent.name
      if (lower === '.git') { if (rel !== '') found.add(child); continue }
      if (rel === '' && lower === RUNNER_TMP) continue
      if (!ent.isDirectory() || lower === 'node_modules') continue
      if (depth + 1 > lim.depth) throw new WalkLimitError()
      stack.push({ rel: child, depth: depth + 1 })
    }
  }
  return found
}

interface Scan { files: Map<string, Entry>; dirs: Map<string, number>; nested: Set<string>; bad: Set<string> }

/**
 * Walks the watched places. Without `base` it takes a baseline (anything unreadable is an error). With `base` it is the comparison after a
 * job: a file is hashed only when it could still equal its baseline entry (same type, mode and size), so a changed or appeared path of any
 * size is never read; a path that cannot be read or listed is named in `bad` and counts as changed; a directory that was not there before is
 * recorded and not entered.
 */
function scan(root: string, list: ListDir, limits: WalkLimits, base?: Baseline): Scan {
  const keep = !base
  const files = new Map<string, Entry>(); const dirs = new Map<string, number>(); const bad = new Set<string>()
  const guard = <T>(rel: string, fn: () => T): T | undefined => {
    try { return fn() } catch (e) {
      if (missing(e)) return undefined
      if (keep) throw e instanceof FingerprintError ? e : new FingerprintError('a watched git file could not be read')
      bad.add(rel); return undefined
    }
  }
  const leaf = (rel: string, st: Stats) => {
    const abs = join(root, rel)
    const mode = st.mode & 0o7777
    if (st.isSymbolicLink()) { const target = Buffer.from(readlinkSync(abs)); files.set(rel, { kind: 'symlink', mode, size: st.size, sha: sha256('symlink\0', target) }) }
    else if (st.isFile()) {
      const b = base?.files.get(rel)
      // Only a file that could still be the baseline's is read. Another type, mode or size is a change on its face.
      const same = !base || (b !== undefined && b.kind === 'file' && b.mode === mode && b.size === st.size)
      let sha = CHANGED
      if (same) { try { sha = hashFile(abs) } catch (e) { if (keep || missing(e)) throw e } }
      files.set(rel, { kind: 'file', mode, size: st.size, sha })
    }
    else files.set(rel, { kind: 'other', mode, size: 0, sha: sha256('other\0', String(st.mode & 0o170000)) })
  }
  const tree = (rel: string) => {
    const st = lstatSync(join(root, rel))
    if (!st.isDirectory()) return leaf(rel, st) // a link or a file where a directory belongs is an entry of its own, and is not entered
    dirs.set(rel, st.mode & 0o7777)
    if (base && !base.dirs.has(rel)) return // a directory that appeared: named, not entered
    for (const name of list(join(root, rel))) guard(`${rel}/${name}`, () => tree(`${rel}/${name}`))
  }
  for (const name of guard(FOLDER, () => list(root)) ?? []) {
    const lower = name.toLowerCase()
    if (lower === '.gitattributes' || lower === '.gitmodules') guard(name, () => leaf(name, lstatSync(join(root, name))))
    if (lower !== '.git') continue
    const st = guard(name, () => lstatSync(join(root, name)))
    if (!st) continue
    if (!st.isDirectory()) { guard(name, () => leaf(name, st)); continue } // a gitfile or link is an entry of its own and is not entered: where a directory was, it is a change
    dirs.set(name, st.mode & 0o7777)
    for (const inner of guard(name, () => list(join(root, name))) ?? []) {
      const l = inner.toLowerCase(); const rel = `${name}/${inner}`
      if (CONFIG_FILES.has(l)) guard(rel, () => leaf(rel, lstatSync(join(root, rel))))
      if (l === 'hooks' || l === 'info') guard(rel, () => tree(rel))
    }
  }
  let nested = new Set<string>()
  try { nested = walkNested(root, limits, keep ? null : bad) } catch (e) {
    if (e instanceof WalkLimitError) { if (keep) throw new FingerprintError('the folder is too large to search for nested repositories'); bad.add(WALK_LIMIT) }
    else throw e
  }
  return { files, dirs, nested, bad }
}

/** Takes the baseline. Throws FingerprintError (the job must not start unwatched) when a watched path cannot be read, or the folder cannot be searched. */
export function takeBaseline(root: string, list: ListDir = realList, limits: WalkLimits = WALK_LIMITS): Baseline {
  const s = scan(root, list, limits)
  return { root, files: s.files, dirs: s.dirs, nested: s.nested }
}

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort()

/**
 * Compares the watched files and the `.git` entries below the root with the baseline and returns the paths that differ, sorted, as stored:
 * changed contents, type, mode or size; appeared; vanished; a watched directory whose mode is not its baseline mode; a path or directory
 * that could not be read; a nested `.git` that is new. Writes nothing and never throws.
 */
export function compareBaseline(root: string, base: Baseline, list: ListDir = realList, limits: WalkLimits = WALK_LIMITS): string[] {
  let post: Scan
  try { post = scan(root, list, limits, base) } catch { return [COMPARE_FAILED] }
  const changed = new Set<string>(post.bad)
  for (const [rel, e] of post.files) {
    const b = base.files.get(rel)
    if (!b || b.kind !== e.kind || b.sha !== e.sha || b.mode !== e.mode) changed.add(rel)
  }
  // What could not be read after the job is not "vanished": it is reported as it is, and so is nothing below it.
  const unreadable = (rel: string) => [...post.bad].some((f) => f === FOLDER || rel === f || rel.startsWith(`${f}/`))
  for (const rel of base.files.keys()) if (!post.files.has(rel) && !unreadable(rel)) changed.add(rel)
  for (const rel of post.dirs.keys()) if (!base.dirs.has(rel)) changed.add(rel)
  for (const [rel, mode] of base.dirs) {
    const seen = post.dirs.get(rel)
    if (seen === undefined ? !unreadable(rel) : seen !== mode) changed.add(rel)
  }
  for (const rel of post.nested) if (!base.nested.has(rel)) changed.add(rel)
  return sorted(changed)
}

const GIT = '/usr/bin/git'
const INDEX_MAX_BYTES = 256 * 1024 * 1024

/**
 * The index entries of mode 160000 (a gitlink: a submodule, or a nested repository staged as one), as paths, or null when the index could
 * not be read (git missing or failing, a damaged index). Runs `git ls-files --stage -z` in the folder with exactly `env` (the job's git env:
 * hooks, fsmonitor, pager and editor are off, and git is stopped from walking up to a parent repository), and nothing of the runner's own.
 */
export function gitlinkPaths(root: string, env: Record<string, string>, git: string = GIT): string[] | null {
  const r = spawnSync(git, ['ls-files', '--stage', '-z'], { cwd: root, env, encoding: 'buffer', timeout: 60_000, maxBuffer: INDEX_MAX_BYTES, stdio: ['ignore', 'pipe', 'ignore'] })
  if (r.error || r.status !== 0 || !Buffer.isBuffer(r.stdout)) return null
  const paths: string[] = []
  for (const rec of r.stdout.toString('utf8').split('\0')) {
    if (rec === '') continue
    const tab = rec.indexOf('\t')
    if (tab < 0) return null
    if (rec.slice(0, tab).split(' ')[0] === '160000') paths.push(rec.slice(tab + 1))
  }
  return paths
}

/**
 * The whole check after a job, as the paths that make it tampered (sorted; empty means clean): the watched files and the nested `.git`
 * entries first, and only if those are clean, the index. Git is not run in a folder whose configuration is already the job's.
 * A gitlink is named with a word after it, so it cannot be taken for a changed file of that name. Writes nothing; never throws.
 */
export function checkBaseline(root: string, base: Baseline, env: Record<string, string>, list: ListDir = realList, git: string = GIT, limits: WalkLimits = WALK_LIMITS): string[] {
  try {
    const changed = compareBaseline(root, base, list, limits)
    if (changed.length > 0) return changed
    const links = gitlinkPaths(root, env, git)
    if (links === null) return [INDEX_UNREADABLE]
    return sorted(links.map((p) => `${p} (gitlink)`))
  } catch { return [COMPARE_FAILED] }
}

/** The paths as the first line of a result prints them: sorted, control characters shown as \xNN, twenty named at most. */
export function describePaths(paths: string[]): string {
  const all = sorted(paths).map((p) => p.replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`))
  return all.length <= 20 ? all.join(', ') : `${all.slice(0, 20).join(', ')}, and ${all.length - 20} more`
}

// ── The baseline as data, for the 0600 file in the job's private state directory. ──

interface FileData { rel: string; kind: Entry['kind']; mode: number; size: number; sha: string }
interface BaselineData { v: 2; files: FileData[]; dirs: Array<{ rel: string; mode: number }>; nested: string[] }

/** The baseline as plain data: hashes, sizes and modes, no contents. It still belongs in a 0600 file, and nowhere else (the ledger never gets paths). */
export function serializeBaseline(b: Baseline): unknown {
  const data: BaselineData = {
    v: 2,
    files: [...b.files].map(([rel, e]) => ({ rel, kind: e.kind, mode: e.mode, size: e.size, sha: e.sha })),
    dirs: [...b.dirs].map(([rel, mode]) => ({ rel, mode })),
    nested: [...b.nested],
  }
  return data
}

const KINDS: ReadonlySet<string> = new Set(['file', 'symlink', 'other'])
/** A path from the folder root: relative, no empty or `.`/`..` segment, no NUL. Anything else could make a comparison look outside the folder. */
const safeRel = (rel: unknown): rel is string => typeof rel === 'string' && rel !== '' && !rel.includes('\0') && rel.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
const safeMode = (m: unknown): m is number => Number.isInteger(m) && (m as number) >= 0 && (m as number) <= 0o7777
const safeSize = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0
const HEX64 = /^[0-9a-f]{64}$/

/** Reads what serializeBaseline wrote, for `root`. Strict: any wrong shape, unsafe path or hash that is not a sha256 throws FingerprintError. */
export function parseBaseline(data: unknown, root: string): Baseline {
  const bad = (why: string): never => { throw new FingerprintError(`the saved baseline is not usable: ${why}`) }
  const d = data as Partial<BaselineData> | null
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.v !== 2 || !Array.isArray(d.files) || !Array.isArray(d.dirs) || !Array.isArray(d.nested)) return bad('shape')
  const files = new Map<string, Entry>(); const dirs = new Map<string, number>(); const nested = new Set<string>()
  for (const f of d.files as unknown[]) {
    const e = f as Partial<FileData> | null
    if (!e || typeof e !== 'object' || !safeRel(e.rel) || typeof e.kind !== 'string' || !KINDS.has(e.kind) || !safeMode(e.mode) || !safeSize(e.size) || typeof e.sha !== 'string' || !HEX64.test(e.sha)) return bad('file entry')
    if (files.has(e.rel)) return bad('duplicate path')
    files.set(e.rel, { kind: e.kind as Entry['kind'], mode: e.mode, size: e.size, sha: e.sha })
  }
  for (const x of d.dirs as unknown[]) {
    const e = x as { rel?: unknown; mode?: unknown } | null
    if (!e || typeof e !== 'object' || !safeRel(e.rel) || !safeMode(e.mode)) return bad('directory entry')
    dirs.set(e.rel, e.mode)
  }
  for (const n of d.nested as unknown[]) {
    if (!safeRel(n)) return bad('nested entry')
    nested.add(n)
  }
  return { root, files, dirs, nested }
}

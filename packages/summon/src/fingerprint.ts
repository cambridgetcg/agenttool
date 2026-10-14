// Phase 0.5 §3 "Fingerprint". Inside its folder the sandbox cannot tell `src/` from `.git/config`, so the runner (which is not
// sandboxed) keeps a copy of the git files that could run code later, and puts them back when an edit or build job ends:
//   .git/config, .git/config.worktree and .git/commondir (the last two send git to other configuration), everything under
//   .git/hooks/ and .git/info/, and .gitattributes and .gitmodules in the folder root; and under .git/modules/** (the git directories
//   of absorbed submodules, which `git status` in the superproject enters) every config, config.worktree, commondir, hooks/** and
//   info/** at any depth, plus any link there, whatever its name (Ruling S6). A `.git` that turns from a directory into a file or a link
//   during the job counts as changed and is replaced by a directory holding the watched files.
// The names are found by listing the folder, `.git/`, `.git/modules/**` and the hooks and info directories, and matching without
// regard to case, so every spelling the Mac's case-insensitive volume answers to (`.Git`, `.GitAttributes`, `Config`) is covered. The
// baseline holds each file's contents. It is outside the folder; while the job runs the runner also keeps it as a 0600 file in the job's private state
// directory (serializeBaseline / parseBaseline), so a runner that dies mid-job can still be followed by a restore. Everything here
// treats the folder as written by a sandboxed job: no link is followed, no special file is opened, and a path is replaced
// (removed, then made new) rather than written through.
//
// A sandboxed job may also try to keep its change by making the path hard to change: a mode of 000, a user flag (`chflags uchg`,
// `uappnd`) or a deny ACL. The folder belongs to the runner's user, and the owner can undo all three without root, so the restore
// does: it reads what a mode or ACL hides, compares a type, mode or size change without hashing, and clears flags and ACLs on a
// path and its parent directory before it replaces or removes the path.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, constants, lchmodSync, lstatSync, mkdirSync, openSync, readdirSync, readlinkSync, readSync, rmdirSync, rmSync, symlinkSync, writeFileSync, type Stats } from 'node:fs'
import { join } from 'node:path'

/** The names in a directory, in the spelling they are stored under. Injectable so a test can show the runner any spelling. */
export type ListDir = (dir: string) => string[]
export const realList: ListDir = (dir) => readdirSync(dir)

/** A watched file larger than this, or watched files that together hold more, cannot be kept: the job does not start. */
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024

export class FingerprintError extends Error {}

/** The files of a git directory that hold configuration or name where it is: `commondir` makes git take config, hooks and info from the directory it names. */
const CONFIG_FILES: ReadonlySet<string> = new Set(['config', 'config.worktree', 'commondir'])

/** What a comparison names when it could not even list the folder. */
const FOLDER = '(the folder)'
/** The hash of a path that is known to differ (or that could not be read) without having been hashed. It is not a hex digest, so it equals nothing. */
const CHANGED = 'changed'

interface Entry {
  /** `other` is a pipe, socket or device: never opened, and not restorable. */
  kind: 'file' | 'symlink' | 'other'
  mode: number
  sha: string
  /** What is needed to put it back: the file's bytes, or a link's target. Only a baseline keeps it. */
  content?: Buffer
}
export interface Baseline {
  root: string
  /** Path from the folder root, as stored, to the file, link or special file. */
  files: Map<string, Entry>
  /** The watched directories (`.git` itself, and hooks, info and what is in them), with their modes. `.git` is compared and never rebuilt. */
  dirs: Map<string, number>
}

const sha256 = (...parts: Array<string | Buffer>) => parts.reduce((h, p) => h.update(p), createHash('sha256')).digest('hex')
const errCode = (e: unknown) => (e as { code?: string })?.code
const missing = (e: unknown) => errCode(e) === 'ENOENT' || errCode(e) === 'ENOTDIR'
const denied = (e: unknown) => errCode(e) === 'EACCES' || errCode(e) === 'EPERM'
/** chmod that never follows a link where the platform has lchmod (macOS does): a path swapped for a link meanwhile is changed as the link. */
const chmodNoFollow = (path: string, mode: number) => { if (typeof lchmodSync === 'function') lchmodSync(path, mode); else chmodSync(path, mode) }

const CHFLAGS = '/usr/bin/chflags'
const CHMOD = '/bin/chmod'
const UNLOCK_CHUNK = 500
const runTool = (bin: string, args: string[]) => { try { spawnSync(bin, args, { stdio: 'ignore', timeout: 30_000 }) } catch { /* the operation that needed it reports its own failure */ } }

/**
 * Clears what a job can set to keep the runner from changing a path: user flags (`uchg`, `uappnd`) and ACLs. The owner can clear both
 * without root. `chflags -h` never follows a link. An ACL goes with `chmod -N` run on the path itself, which still works when the ACL
 * denies the owner read (`chmod -h -N` opens the file first and fails then); a link has nothing to open, so it gets `-h`. Best effort and
 * silent: whatever still cannot be done shows up as a failed restore. Paths are taken shallowest first by the caller, so a directory
 * is open before what is in it.
 */
function unlock(paths: Iterable<string>): void {
  const all = [...new Set(paths)]
  for (let i = 0; i < all.length; i += UNLOCK_CHUNK) {
    const chunk = all.slice(i, i + UNLOCK_CHUNK)
    runTool(CHFLAGS, ['-h', 'nouchg,nouappnd', ...chunk])
    const isLink = (p: string) => { try { return lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink() ?? false } catch { return false } }
    const links = chunk.filter(isLink); const linkSet = new Set(links)
    const rest = chunk.filter((p) => !linkSet.has(p))
    if (rest.length > 0) runTool(CHMOD, ['-N', ...rest])
    if (links.length > 0) runTool(CHMOD, ['-h', '-N', ...links])
  }
}

/** The sha256 of a regular file, read in pieces, opened without following a link and without blocking on a pipe swapped in late. */
function hashFile(path: string, keep: boolean, budget: { left: number }): { sha: string; content?: Buffer } {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const h = createHash('sha256')
    const chunks: Buffer[] = []
    const buf = Buffer.alloc(64 * 1024)
    let total = 0
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null)
      if (n === 0) break
      total += n
      if (keep) {
        if (total > MAX_FILE_BYTES || (budget.left -= n) < 0) throw new FingerprintError('a watched git file is too large to keep')
        chunks.push(Buffer.from(buf.subarray(0, n)))
      }
      h.update(buf.subarray(0, n))
    }
    return { sha: h.digest('hex'), ...(keep ? { content: Buffer.concat(chunks) } : {}) }
  } finally { closeSync(fd) }
}

interface Scan { files: Map<string, Entry>; dirs: Map<string, number>; failed: string[] }

/**
 * Walks the watched places. Without `base` it takes a baseline (contents kept, anything unreadable is an error). With `base` it is the
 * comparison after a job: a path is hashed only when it could still equal its baseline entry (same type, mode and size), so a changed or
 * appeared path of any size is never read, and one that cannot be read counts as changed; a directory the job made unreadable is opened
 * (flags and ACLs cleared, the owner bits put back) so that what is in it can be seen.
 */
function scan(root: string, list: ListDir, base?: Baseline): Scan {
  const keep = !base
  const files = new Map<string, Entry>(); const dirs = new Map<string, number>(); const failed: string[] = []
  const budget = { left: MAX_TOTAL_BYTES }
  const guard = <T>(rel: string, fn: () => T): T | undefined => {
    try { return fn() } catch (e) {
      if (missing(e)) return undefined
      if (keep) throw e instanceof FingerprintError ? e : new FingerprintError('a watched git file could not be read')
      failed.push(rel); return undefined
    }
  }
  // A path whose own attributes the job made unreadable (an ACL denying readattr stops even lstat) is opened the same way.
  const lstatOpen = (abs: string): Stats => {
    try { return lstatSync(abs) } catch (e) {
      if (keep || !denied(e)) throw e
      unlock([abs]); return lstatSync(abs)
    }
  }
  const listOpen = (abs: string): string[] => {
    try { return list(abs) } catch (e) {
      if (keep || !denied(e)) throw e
      const st = lstatSync(abs, { throwIfNoEntry: false })
      if (!st || !st.isDirectory()) throw e
      unlock([abs]); chmodNoFollow(abs, (st.mode & 0o7777) | 0o700)
      return list(abs)
    }
  }
  const leaf = (rel: string, st: Stats) => {
    const abs = join(root, rel)
    const mode = st.mode & 0o7777
    if (st.isSymbolicLink()) { const target = Buffer.from(readlinkSync(abs)); files.set(rel, { kind: 'symlink', mode, sha: sha256('symlink\0', target), ...(keep ? { content: target } : {}) }) }
    else if (st.isFile()) {
      const b = base?.files.get(rel)
      if (base && (!b || b.kind !== 'file' || b.mode !== mode || b.content!.length !== st.size)) files.set(rel, { kind: 'file', mode, sha: CHANGED })
      else {
        let h: { sha: string; content?: Buffer }
        try { h = hashFile(abs, keep, budget) } catch (e) { if (keep || missing(e)) throw e; h = { sha: CHANGED } }
        files.set(rel, { kind: 'file', mode, ...h })
      }
    }
    else files.set(rel, { kind: 'other', mode, sha: sha256('other\0', String(st.mode & 0o170000)) })
  }
  const tree = (rel: string) => {
    const st = lstatOpen(join(root, rel))
    if (!st.isDirectory()) return leaf(rel, st) // a link or a file where a directory belongs is an entry of its own, and is not entered
    dirs.set(rel, st.mode & 0o7777)
    for (const name of listOpen(join(root, rel))) guard(`${rel}/${name}`, () => tree(`${rel}/${name}`))
  }
  /**
   * `.git/modules/**`: `rel` is a directory git may be told to use as a git directory. Watches, in it, every config, config.worktree and
   * commondir, its hooks and info trees, and any link whatever its name (a submodule's git directory can be a link into the folder), and
   * goes into every other directory (`modules/<name>`, `objects`, `refs`: the same names can be one level down). A directory that holds
   * or leads to a watched entry is recorded with its mode, so one that vanishes comes back and one the job made is removed when empty.
   */
  const gitdirs = (rel: string, self: Stats): boolean => {
    let found = false
    for (const name of listOpen(join(root, rel))) {
      const l = name.toLowerCase(); const child = `${rel}/${name}`
      const st = guard(child, () => lstatOpen(join(root, child)))
      if (!st) continue
      if (st.isSymbolicLink() || CONFIG_FILES.has(l)) { guard(child, () => leaf(child, st)); found = true }
      else if (l === 'hooks' || l === 'info') { guard(child, () => tree(child)); found = true }
      else if (st.isDirectory() && guard(child, () => gitdirs(child, st))) found = true
    }
    if (found) dirs.set(rel, self.mode & 0o7777)
    return found
  }
  for (const name of guard(FOLDER, () => listOpen(root)) ?? []) {
    const lower = name.toLowerCase()
    if (lower === '.gitattributes' || lower === '.gitmodules') guard(name, () => leaf(name, lstatOpen(join(root, name))))
    if (lower !== '.git') continue
    const st = guard(name, () => lstatOpen(join(root, name)))
    if (!st) continue
    if (!st.isDirectory()) { guard(name, () => leaf(name, st)); continue } // a gitfile or link is an entry of its own and is not entered: where a directory was, it is a change
    dirs.set(name, st.mode & 0o7777)
    for (const inner of guard(name, () => listOpen(join(root, name))) ?? []) {
      const l = inner.toLowerCase(); const rel = `${name}/${inner}`
      if (CONFIG_FILES.has(l)) guard(rel, () => leaf(rel, lstatOpen(join(root, rel))))
      if (l === 'hooks' || l === 'info') guard(rel, () => tree(rel))
      if (l === 'modules') guard(rel, () => { const m = lstatOpen(join(root, rel)); if (m.isDirectory()) gitdirs(rel, m); else leaf(rel, m) })
    }
  }
  return { files, dirs, failed }
}

/** Takes the baseline. Throws FingerprintError (the job must not start unwatched) when a watched file cannot be read or kept. */
export function takeBaseline(root: string, list: ListDir = realList): Baseline {
  const s = scan(root, list)
  return { root, files: s.files, dirs: s.dirs }
}

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort()
const parentsOf = (rel: string) => { const parts = rel.split('/'); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')) }
const depth = (rel: string) => rel.split('/').length
const statOrNull = (abs: string): Stats | null => { try { return lstatSync(abs, { throwIfNoEntry: false }) ?? null } catch { return null } }

/** Replaces `abs` by nothing: a file or link goes as itself, a directory with everything in it. */
const clear = (abs: string) => rmSync(abs, { recursive: true, force: true })

/**
 * Compares the watched files with the baseline and puts back whatever differs (contents, type or mode), appeared or vanished, and each
 * watched directory's mode. `changed` names every such path, as stored; `failed` the ones that could not be put right (and anything that
 * could not even be read). Flags and ACLs on a path and its parent are cleared before the path is replaced or removed. Never throws.
 */
export function restoreBaseline(root: string, base: Baseline, list: ListDir = realList): { changed: string[]; failed: string[] } {
  let post: Scan
  try { post = scan(root, list, base) } catch { return { changed: [], failed: ['(the git files could not be read)'] } }
  const changed: string[] = []; const failed: string[] = [...post.failed]
  const toClear: string[] = []; const toWrite: string[] = []
  for (const [rel, e] of post.files) {
    const b = base.files.get(rel)
    if (!b) { changed.push(rel); toClear.push(rel) } else if (b.kind !== e.kind || b.sha !== e.sha || b.mode !== e.mode) { changed.push(rel); toClear.push(rel); toWrite.push(rel) }
  }
  // What could not be read after the job is not "vanished": it is reported as it is (in failed) and left alone.
  const unreadable = (rel: string) => post.failed.some((f) => f === FOLDER || rel === f || rel.startsWith(`${f}/`))
  for (const rel of base.files.keys()) if (!post.files.has(rel) && !unreadable(rel)) { changed.push(rel); toWrite.push(rel) }
  // A directory in the way of a file that has to come back goes first, with what is in it.
  for (const rel of toWrite) if (post.dirs.has(rel) && !base.dirs.has(rel)) toClear.push(rel)
  // A watched directory whose mode is not its baseline mode (as it was found, before it was opened to be read) is a change, and is put back last.
  const modeFix: string[] = []
  for (const [rel, mode] of base.dirs) { const seen = post.dirs.get(rel); if (seen !== undefined && seen !== mode) { changed.push(rel); modeFix.push(rel) } }

  // A .git that was a directory and is now a file or a link (a gitfile, or a link to a directory the job controls) counts as changed (the scan
  // shows it as an entry that appeared): it is removed, never followed, and made a directory again, with the watched files in it. That is all
  // a restore can give back; the rest of the repository is not watched and is not rebuilt. A .git that is gone altogether is different: nothing
  // planted can survive in it, there is nothing to redirect git, and a directory of three watched folders is no repository, so it is said and left.
  const gitName = [...base.dirs.keys()].find((n) => !n.includes('/') && n.toLowerCase() === '.git')
  const gitStat = gitName === undefined ? null : statOrNull(join(root, gitName))
  const gitGone = gitName !== undefined && gitStat === null
  const gitSwapped = gitName !== undefined && gitStat !== null && !gitStat.isDirectory()
  const underMissingGit = (rel: string) => gitGone && rel.split('/')[0] === gitName && rel.includes('/')
  if (gitGone) failed.push(gitName!)

  // Before anything is replaced or removed: clear the flags and ACLs on it and on its parent, and on everything inside a directory that goes.
  const cleared = new Set(toClear)
  const goes = (rel: string) => cleared.has(rel) || parentsOf(rel).some((p) => cleared.has(p))
  const touched = new Set<string>()
  for (const rel of [...toClear, ...toWrite, ...modeFix]) { if (underMissingGit(rel)) continue; touched.add(rel); for (const p of parentsOf(rel)) touched.add(p) }
  for (const rel of [...post.files.keys(), ...post.dirs.keys()]) if (goes(rel)) touched.add(rel)
  if ([...touched].some((rel) => !rel.includes('/'))) touched.add('') // a top-level path's parent is the folder itself
  unlock([...touched].sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1)).map((rel) => (rel === '' ? root : join(root, rel))))

  const attempt = (rel: string, fn: () => void) => { try { fn() } catch { failed.push(rel) } }
  const made: string[] = []
  for (const rel of toClear) if (!underMissingGit(rel)) attempt(rel, () => clear(join(root, rel)))
  if (gitSwapped) attempt(gitName!, () => { mkdirSync(join(root, gitName!), { mode: 0o700 }); made.push(gitName!) }) // its baseline mode goes on last, with the other made directories
  // Directories first, shallowest first: one that vanished, or that was swapped for a link (cleared above), is made again. Their baseline
  // modes are put back last, so a mode that forbids writing cannot stop the files going in.
  for (const dir of [...base.dirs.keys()].filter((d) => d.includes('/')).sort((a, b) => depth(a) - depth(b))) {
    if (underMissingGit(dir) || unreadable(dir)) continue
    attempt(dir, () => {
      const abs = join(root, dir); const st = lstatSync(abs, { throwIfNoEntry: false })
      if (st && !st.isDirectory()) clear(abs)
      if (!st || !st.isDirectory()) { mkdirSync(abs, { mode: 0o700 }); made.push(dir) }
    })
  }
  for (const rel of toWrite.sort()) {
    if (underMissingGit(rel)) continue
    const b = base.files.get(rel)!
    attempt(rel, () => {
      const abs = join(root, rel)
      for (const p of parentsOf(rel)) { // a parent that is not a real directory is replaced, never written through
        const st = lstatSync(join(root, p), { throwIfNoEntry: false })
        if (st && !st.isDirectory()) clear(join(root, p))
        if (!st || !st.isDirectory()) { mkdirSync(join(root, p), { mode: 0o700 }); made.push(p) }
      }
      // Made new, never written over: 'wx' fails on anything already there, so nothing is written through a link or into a hard-linked file.
      if (b.kind === 'symlink') symlinkSync(b.content!.toString(), abs)
      else if (b.kind === 'file') { writeFileSync(abs, b.content!, { mode: b.mode, flag: 'wx' }); chmodSync(abs, b.mode) }
      else throw new Error('cannot recreate a special file')
    })
  }
  // Directories that were made during the job and are empty now (their files were cleared above) go too, deepest first.
  for (const dir of [...post.dirs.keys()].filter((d) => !base.dirs.has(d)).sort((a, b) => depth(b) - depth(a))) {
    try { rmdirSync(join(root, dir)) } catch { /* not empty, or already gone */ }
  }
  // Last: every watched directory that was found with another mode, or had to be made again, gets its baseline mode, deepest first.
  for (const dir of sorted([...modeFix, ...made]).sort((a, b) => depth(b) - depth(a))) {
    const mode = base.dirs.get(dir)
    if (mode === undefined || underMissingGit(dir)) continue
    attempt(dir, () => chmodNoFollow(join(root, dir), mode))
  }
  return { changed: sorted(changed), failed: sorted(failed) }
}

/** The paths as the first line of a result prints them: sorted, control characters shown as \xNN, twenty named at most. */
export function describePaths(paths: string[]): string {
  const all = sorted(paths).map((p) => p.replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`))
  return all.length <= 20 ? all.join(', ') : `${all.slice(0, 20).join(', ')}, and ${all.length - 20} more`
}

// ── The baseline as data, for the 0600 file in the job's private state directory. ──

interface FileData { rel: string; kind: Entry['kind']; mode: number; sha: string; content?: string }
interface BaselineData { v: 1; files: FileData[]; dirs: Array<{ rel: string; mode: number }> }

/** The baseline as plain data: contents in base64. It holds file contents (a `.git/config` can hold credentials), so it belongs in a 0600 file and nowhere else. */
export function serializeBaseline(b: Baseline): unknown {
  const data: BaselineData = {
    v: 1,
    files: [...b.files].map(([rel, e]) => ({ rel, kind: e.kind, mode: e.mode, sha: e.sha, ...(e.content ? { content: e.content.toString('base64') } : {}) })),
    dirs: [...b.dirs].map(([rel, mode]) => ({ rel, mode })),
  }
  return data
}

const KINDS: ReadonlySet<string> = new Set(['file', 'symlink', 'other'])
/** A path from the folder root: relative, no empty or `.`/`..` segment, no NUL. Anything else could make a restore reach outside the folder. */
const safeRel = (rel: unknown): rel is string => typeof rel === 'string' && rel !== '' && !rel.includes('\0') && rel.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
const safeMode = (m: unknown): m is number => Number.isInteger(m) && (m as number) >= 0 && (m as number) <= 0o7777
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Reads what serializeBaseline wrote, for `root`. Strict: any wrong shape, unsafe path, or contents that do not match their hash throws FingerprintError. */
export function parseBaseline(data: unknown, root: string): Baseline {
  const bad = (why: string): never => { throw new FingerprintError(`the saved baseline is not usable: ${why}`) }
  const d = data as Partial<BaselineData> | null
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.v !== 1 || !Array.isArray(d.files) || !Array.isArray(d.dirs)) return bad('shape')
  const files = new Map<string, Entry>(); const dirs = new Map<string, number>()
  for (const f of d.files as unknown[]) {
    const e = f as Partial<FileData> | null
    if (!e || typeof e !== 'object' || !safeRel(e.rel) || typeof e.kind !== 'string' || !KINDS.has(e.kind) || !safeMode(e.mode) || typeof e.sha !== 'string') return bad('file entry')
    if (files.has(e.rel)) return bad('duplicate path')
    let content: Buffer | undefined
    if (e.kind !== 'other') {
      if (typeof e.content !== 'string' || !BASE64.test(e.content)) return bad('contents')
      content = Buffer.from(e.content, 'base64')
      const want = e.kind === 'symlink' ? sha256('symlink\0', content) : sha256(content)
      if (e.sha !== want) return bad('hash')
    } else if (e.content !== undefined) return bad('contents of a special file')
    files.set(e.rel, { kind: e.kind as Entry['kind'], mode: e.mode, sha: e.sha, ...(content ? { content } : {}) })
  }
  for (const x of d.dirs as unknown[]) {
    const e = x as { rel?: unknown; mode?: unknown } | null
    if (!e || typeof e !== 'object' || !safeRel(e.rel) || !safeMode(e.mode)) return bad('directory entry')
    dirs.set(e.rel, e.mode)
  }
  return { root, files, dirs }
}

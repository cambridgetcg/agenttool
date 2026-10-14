// Phase 0.5 §3 "Fingerprint". Inside its folder the sandbox cannot tell `src/` from `.git/config`, so the runner (which is not
// sandboxed) keeps a copy of the git files that could run code later, and puts them back when an edit or build job ends:
//   .git/config, everything under .git/hooks/ and .git/info/, and .gitattributes and .gitmodules in the folder root.
// The names are found by listing the folder, `.git/` and those two directories, and matching without regard to case, so every
// spelling the Mac's case-insensitive volume answers to (`.Git`, `.GitAttributes`, `Config`) is covered. The baseline holds each
// file's contents, in the runner's memory: it is outside the folder, and a copy of `.git/config` (which can hold credentials) is
// never written to a second place on disk. Everything here treats the folder as written by a sandboxed job: no link is
// followed, no special file is opened, and a path is replaced (removed, then made new) rather than written through.
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync, readdirSync, readlinkSync, readSync, rmdirSync, rmSync, symlinkSync, writeFileSync, type Stats } from 'node:fs'
import { join } from 'node:path'

/** The names in a directory, in the spelling they are stored under. Injectable so a test can show the runner any spelling. */
export type ListDir = (dir: string) => string[]
export const realList: ListDir = (dir) => readdirSync(dir)

/** A watched file larger than this, or watched files that together hold more, cannot be kept: the job does not start. */
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024

export class FingerprintError extends Error {}

/** What a comparison names when it could not even list the folder. */
const FOLDER = '(the folder)'

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
  /** The watched directories under .git (hooks, info and what is in them), with their modes. */
  dirs: Map<string, number>
}

const sha256 = (...parts: Array<string | Buffer>) => parts.reduce((h, p) => h.update(p), createHash('sha256')).digest('hex')
const missing = (e: unknown) => (e as { code?: string })?.code === 'ENOENT' || (e as { code?: string })?.code === 'ENOTDIR'

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

/** Walks the watched places. `keep` is a baseline (contents kept, an unreadable thing is an error); otherwise a comparison (hashes only). */
function scan(root: string, list: ListDir, keep: boolean): Scan {
  const files = new Map<string, Entry>(); const dirs = new Map<string, number>(); const failed: string[] = []
  const budget = { left: MAX_TOTAL_BYTES }
  const guard = <T>(rel: string, fn: () => T): T | undefined => {
    try { return fn() } catch (e) {
      if (missing(e)) return undefined
      if (keep) throw e instanceof FingerprintError ? e : new FingerprintError('a watched git file could not be read')
      failed.push(rel); return undefined
    }
  }
  const leaf = (rel: string, st: Stats) => {
    const abs = join(root, rel)
    const mode = st.mode & 0o7777
    if (st.isSymbolicLink()) { const target = Buffer.from(readlinkSync(abs)); files.set(rel, { kind: 'symlink', mode, sha: sha256('symlink\0', target), ...(keep ? { content: target } : {}) }) }
    else if (st.isFile()) files.set(rel, { kind: 'file', mode, ...hashFile(abs, keep, budget) })
    else files.set(rel, { kind: 'other', mode, sha: sha256('other\0', String(st.mode & 0o170000)) })
  }
  const tree = (rel: string) => {
    const st = lstatSync(join(root, rel))
    if (!st.isDirectory()) return leaf(rel, st) // a link or a file where a directory belongs is an entry of its own, and is not entered
    dirs.set(rel, st.mode & 0o7777)
    for (const name of list(join(root, rel))) guard(`${rel}/${name}`, () => tree(`${rel}/${name}`))
  }
  for (const name of guard(FOLDER, () => list(root)) ?? []) {
    const lower = name.toLowerCase()
    if (lower === '.gitattributes' || lower === '.gitmodules') guard(name, () => leaf(name, lstatSync(join(root, name))))
    if (lower !== '.git') continue
    const st = guard(name, () => lstatSync(join(root, name)))
    if (!st || !st.isDirectory()) continue // a link or file named .git is not entered; a comparison reports the repository as gone
    for (const inner of guard(name, () => list(join(root, name))) ?? []) {
      const l = inner.toLowerCase(); const rel = `${name}/${inner}`
      if (l === 'config') guard(rel, () => leaf(rel, lstatSync(join(root, rel))))
      if (l === 'hooks' || l === 'info') guard(rel, () => tree(rel))
    }
  }
  return { files, dirs, failed }
}

/** Takes the baseline. Throws FingerprintError (the job must not start unwatched) when a watched file cannot be read or kept. */
export function takeBaseline(root: string, list: ListDir = realList): Baseline {
  const s = scan(root, list, true)
  return { root, files: s.files, dirs: s.dirs }
}

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort()
const parentsOf = (rel: string) => { const parts = rel.split('/'); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')) }

/** Replaces `abs` by nothing: a file or link goes as itself, a directory with everything in it. */
const clear = (abs: string) => rmSync(abs, { recursive: true, force: true })

/**
 * Compares the watched files with the baseline and puts back whatever differs (contents or mode), appeared or vanished.
 * `changed` names every such path, as stored; `failed` the ones that could not be put right (and anything that could not even be read).
 * Never throws.
 */
export function restoreBaseline(root: string, base: Baseline, list: ListDir = realList): { changed: string[]; failed: string[] } {
  let post: Scan
  try { post = scan(root, list, false) } catch { return { changed: [], failed: ['(the git files could not be read)'] } }
  const changed: string[] = []; const failed: string[] = [...post.failed]
  const toClear: string[] = []; const toWrite: string[] = []
  for (const [rel, e] of post.files) {
    const b = base.files.get(rel)
    if (!b) { changed.push(rel); toClear.push(rel) } else if (b.kind !== e.kind || b.sha !== e.sha || b.mode !== e.mode) { changed.push(rel); toClear.push(rel); toWrite.push(rel) }
  }
  // What could not be read after the job is not "vanished": it is reported as it is (in failed) and left alone.
  const unreadable = (rel: string) => post.failed.some((f) => f === FOLDER || rel === f || rel.startsWith(`${f}/`))
  for (const rel of base.files.keys()) if (!post.files.has(rel) && !unreadable(rel)) { changed.push(rel); toWrite.push(rel) }

  // .git itself is not rebuilt out of three directories: if it is gone or is a link, say so and leave it as found.
  const gitName = [...base.files.keys(), ...base.dirs.keys()].map((r) => r.split('/')[0]!).find((n) => n.toLowerCase() === '.git')
  const gitGone = gitName !== undefined && !(lstatSync(join(root, gitName), { throwIfNoEntry: false })?.isDirectory())
  const underMissingGit = (rel: string) => gitGone && rel.split('/')[0] === gitName && rel.includes('/')
  if (gitGone) failed.push(gitName!)

  const attempt = (rel: string, fn: () => void) => { try { fn() } catch { failed.push(rel) } }
  for (const rel of toClear) if (!underMissingGit(rel)) attempt(rel, () => clear(join(root, rel)))
  // Directories first, shallowest first: one that vanished, or that was swapped for a link (cleared above), is made again.
  for (const dir of [...base.dirs.keys()].sort((a, b) => a.split('/').length - b.split('/').length)) {
    if (underMissingGit(dir) || unreadable(dir)) continue
    attempt(dir, () => {
      const abs = join(root, dir); const st = lstatSync(abs, { throwIfNoEntry: false })
      if (st && !st.isDirectory()) clear(abs)
      if (!st || !st.isDirectory()) { mkdirSync(abs, { mode: base.dirs.get(dir)! }); chmodSync(abs, base.dirs.get(dir)!) }
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
        if (!st || !st.isDirectory()) mkdirSync(join(root, p), { mode: base.dirs.get(p) ?? 0o755 })
      }
      // Made new, never written over: 'wx' fails on anything already there, so nothing is written through a link or into a hard-linked file.
      if (b.kind === 'symlink') symlinkSync(b.content!.toString(), abs)
      else if (b.kind === 'file') { writeFileSync(abs, b.content!, { mode: b.mode, flag: 'wx' }); chmodSync(abs, b.mode) }
      else throw new Error('cannot recreate a special file')
    })
  }
  // Directories that were made during the job and are empty now (their files were cleared above) go too, deepest first.
  for (const dir of [...post.dirs.keys()].filter((d) => !base.dirs.has(d)).sort((a, b) => b.split('/').length - a.split('/').length)) {
    try { rmdirSync(join(root, dir)) } catch { /* not empty, or already gone */ }
  }
  return { changed: sorted(changed), failed: sorted(failed) }
}

/** The paths as the first line of a result prints them: sorted, control characters shown as \xNN, twenty named at most. */
export function describePaths(paths: string[]): string {
  const all = sorted(paths).map((p) => p.replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`))
  return all.length <= 20 ? all.join(', ') : `${all.slice(0, 20).join(', ')}, and ${all.length - 20} more`
}

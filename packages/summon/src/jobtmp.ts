// Phase 0.5 §3 "Temp files": each edit or build job gets its own temp directory inside its folder, because the sandbox allows no
// temp root outside it. The runner (which is not sandboxed) makes and removes it, so every step here treats the folder as
// something a sandboxed job has written into: a link is never followed, and nothing is made through one.
import { appendFileSync, chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ID_RE } from './request.ts'

export const TMP_DIR = '.summon-tmp'
/** The line that keeps git from seeing the temp files. It stays in the exclude file after the job. */
export const EXCLUDE_LINE = '/.summon-tmp/'

const statOrNull = (p: string) => lstatSync(p, { throwIfNoEntry: false }) ?? null

/**
 * `<cwd>/.summon-tmp/<id>` as a new directory, mode 0700, and its path. A `.summon-tmp` that is not a real directory (a link or a
 * file an earlier job left) is removed first, as the link or file it is, and made again. An id that is not a job id, and a
 * directory that already exists for this id, are refused.
 */
export function makeJobTmp(cwd: string, id: string): string {
  if (!ID_RE.test(id)) throw new Error('job id cannot name a temp directory')
  const top = join(cwd, TMP_DIR)
  const st = statOrNull(top)
  if (st && !st.isDirectory()) rmSync(top, { force: true }) // the link or file itself
  if (!st || !st.isDirectory()) mkdirSync(top, { mode: 0o700 })
  chmodSync(top, 0o700)
  const dir = join(top, id)
  mkdirSync(dir, { mode: 0o700 }) // not recursive and not forgiving: EEXIST is a refusal
  chmodSync(dir, 0o700)
  return dir
}

/**
 * The line `/.summon-tmp/` in `<cwd>/.git/info/exclude`, once. Creates `.git/info` and the file when there are none; adds the line
 * after what is there (a newline first, if the file had none); changes nothing if a line already equals it. Refuses
 * (throws) when `.git`, `.git/info` or the file is a link or something other than what it should be, so nothing is written
 * through a link.
 */
export function ensureExcluded(cwd: string): void {
  const git = join(cwd, '.git')
  const g = statOrNull(git)
  if (!g || !g.isDirectory()) throw new Error('.git is not a directory')
  const info = join(git, 'info')
  const i = statOrNull(info)
  if (!i) mkdirSync(info, { mode: 0o755 })
  else if (!i.isDirectory()) throw new Error('.git/info is not a directory')
  const file = join(info, 'exclude')
  const f = statOrNull(file)
  if (!f) {
    writeFileSync(file, `${EXCLUDE_LINE}\n`, { mode: 0o644, flag: 'wx' })
    chmodSync(file, 0o644)
    return
  }
  // A second name for a file somewhere else would make the append below change that file too.
  if (!f.isFile() || f.nlink > 1) throw new Error('.git/info/exclude is not a plain file of its own')
  const text = readFileSync(file, 'utf8')
  // git ignores trailing spaces in a pattern, so a line that differs from ours only by those is ours.
  if (text.split(/\r?\n/).some((l) => l.replace(/[ \t]+$/, '') === EXCLUDE_LINE)) return
  appendFileSync(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${EXCLUDE_LINE}\n`)
}

/** Makes a tree removable (a job may have taken its own permissions away), without following a link. */
function openUp(path: string): void {
  const st = statOrNull(path)
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return
  try { chmodSync(path, 0o700) } catch { /* the removal will say */ }
  let names: string[] = []
  try { names = readdirSync(path) } catch { return }
  for (const n of names) openUp(join(path, n))
}

/**
 * Removes the job's directory, and `.summon-tmp` too if that leaves it empty. Never throws: a runner that cannot clean up must
 * still end the job. A `.summon-tmp` that has become a link or a file is removed as one, and nothing behind it is touched.
 */
export function removeJobTmp(cwd: string, id: string): void {
  try {
    if (!ID_RE.test(id)) return
    const top = join(cwd, TMP_DIR)
    const st = statOrNull(top)
    if (!st) return
    if (!st.isDirectory()) { rmSync(top, { force: true }); return }
    const dir = join(top, id)
    try { rmSync(dir, { recursive: true, force: true }) } catch {
      openUp(dir)
      rmSync(dir, { recursive: true, force: true })
    }
    try { rmdirSync(top) } catch { /* something else is in it, or it is gone */ }
  } catch { /* best effort */ }
}

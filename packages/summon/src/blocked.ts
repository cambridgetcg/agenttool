// Phase 0.5 §3 (Ruling S8): a folder where an edit or build job was found to have changed the git files that can run code is BLOCKED. The
// runner (not the job: the sandbox cannot read or write Summon's state) writes a marker for the folder's realpath in its own private state,
// and admission refuses every later edit and build job there, at the gate and again when the runner takes the job, until Yu has looked at
// the folder and removes the marker by hand. Nothing in Summon ever removes one. Review jobs are not affected: they have no Bash tool.
import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BLOCKED_DIR = 'blocked'

const stripSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') || '/' : p)

/**
 * Where the marker of a folder lives: `<state>/blocked/<sha256 of the folder's realpath>`. The realpath is folded to lower case, as the
 * Mac's volume folds it, so no spelling of the same folder gets past the marker. `state` is Summon's state directory (SummonPaths.state).
 */
export function blockMarkerPath(state: string, folderReal: string): string {
  return join(state, BLOCKED_DIR, createHash('sha256').update(stripSlash(folderReal).toLowerCase()).digest('hex'))
}

/** The path as Yu would type it on Nuance: `~/...` when it lies in the home folder. */
export function displayPath(path: string, home: string): string {
  const h = stripSlash(home)
  return h !== '/' && path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path
}

/** What a refusal says to do about a blocked folder. */
export const blockedHint = (marker: string, home: string) => `check the folder's git files, then remove ${displayPath(marker, home)}`

/**
 * Blocks the folder: writes its marker (0600, in a 0700 directory) and returns true. A folder that is already blocked keeps its first
 * marker (the first job to tamper is the one to look at). Never throws; false means the marker could not be written, and the caller says so.
 * `why` and `job` are fixed words and a job id, nothing a job wrote: no path from the folder goes in.
 */
export function blockFolder(state: string, folderReal: string, info: { job: string; at: string; why: 'tampered' | 'recovery error' }): boolean {
  const marker = blockMarkerPath(state, folderReal)
  try {
    try { lstatSync(marker); return true } catch { /* not there yet */ }
    const dir = join(state, BLOCKED_DIR)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
    const tmp = `${marker}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(tmp, JSON.stringify({ v: 1, folder: folderReal, job: info.job, at: info.at, why: info.why }), { mode: 0o600 })
    try { renameSync(tmp, marker) } catch (e) { rmSync(tmp, { force: true }); throw e }
    return true
  } catch { return false }
}

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

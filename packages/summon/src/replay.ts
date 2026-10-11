import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ID_RE } from './request.ts'
import { REFUSAL_REASONS, type RefusalReason } from './status.ts'

/** True the first time an id is seen; the O_EXCL create makes concurrent claims race-free. */
export function claimId(seenDir: string, id: string): boolean {
  if (!ID_RE.test(id)) throw new Error('bad id')
  mkdirSync(seenDir, { recursive: true, mode: 0o700 })
  try { closeSync(openSync(join(seenDir, id), 'wx', 0o600)); return true } catch (e: any) {
    if (e.code === 'EEXIST') return false
    throw e
  }
}

/** The gate refused an id it had claimed: keep the reason (one closed-vocabulary word) in its seen marker for `status`. */
export function recordRefusal(seenDir: string, id: string, reason: RefusalReason): void {
  if (!ID_RE.test(id)) throw new Error('bad id')
  writeFileSync(join(seenDir, id), reason, { mode: 0o600 })
}

/** Whether this Mac has seen the id, and the refusal reason recorded with it. Anything that is not a known reason is ignored. */
export function seenRefusal(seenDir: string, id: string): { seen: false } | { seen: true; reason?: RefusalReason } {
  if (!ID_RE.test(id)) throw new Error('bad id')
  let text: string
  try { text = readFileSync(join(seenDir, id), 'utf8') } catch { return { seen: false } }
  const reason = (REFUSAL_REASONS as readonly string[]).includes(text) ? (text as RefusalReason) : undefined
  return { seen: true, ...(reason ? { reason } : {}) }
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

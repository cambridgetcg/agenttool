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

/**
 * Append one hash-chained entry. Only the whitelisted metadata keys are kept, so a prompt field is dropped.
 * The whitelist does not inspect values: callers must keep prompt text out of free-text fields (detail, reason).
 */
export function appendLedger(path: string, fields: LedgerFields, nowMs: number = Date.now()): LedgerEntry {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  return withLock(path, () => {
    const picked: Record<string, string> = {}
    for (const k of ALLOWED) {
      const v = fields[k]
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
    if (e === null || typeof e !== 'object' || Array.isArray(e)) return { ok: false, entries: i, brokenAt: i + 1 }
    const { hash, ...body } = e
    if (body.prev !== prev || sha(canonicalJson(body)) !== hash) return { ok: false, entries: i, brokenAt: i + 1 }
    prev = hash
  }
  return { ok: true, entries: lines.length }
}

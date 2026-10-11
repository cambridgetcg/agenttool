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

const TORN_TAIL = 'ledger_torn_tail'

/** A line that is a ledger entry: it parses to an object with a string `hash`. Anything else is null. */
function entryOf(line: string | undefined): Record<string, unknown> & { hash: string } | null {
  if (line === undefined) return null
  try {
    const e = JSON.parse(line)
    return e !== null && typeof e === 'object' && !Array.isArray(e) && typeof e.hash === 'string' ? e : null
  } catch { return null }
}

function seal(fields: Record<string, string>, prev: string, nowMs: number): LedgerEntry {
  const body = { ...fields, ts: new Date(nowMs).toISOString(), prev }
  return { ...body, hash: sha(canonicalJson(body)) } as LedgerEntry
}

/**
 * Where the next entry chains from, and what must be written before it. A file whose last line is not an entry, or that
 * does not end in a newline, has a torn tail (an unclean shutdown, a short write): it is terminated, and a
 * `ledger_torn_tail` entry chained to the last valid entry marks it, so the chain goes on and verifyLedger can name it.
 */
function tail(path: string, nowMs: number): { prev: string; before: string } {
  if (!existsSync(path)) return { prev: 'genesis', before: '' }
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n').filter(Boolean)
  if (lines.length === 0) return { prev: 'genesis', before: '' }
  const last = entryOf(lines[lines.length - 1])
  if (last && text.endsWith('\n')) return { prev: last.hash, before: '' }
  let i = lines.length - 1
  while (i >= 0 && !entryOf(lines[i])) i--
  const lastValid = i >= 0 ? entryOf(lines[i])!.hash : 'genesis'
  const marker = seal({ event: TORN_TAIL, detail: `line ${lines.length} ${last ? 'had no newline' : 'did not parse'}` }, lastValid, nowMs)
  return { prev: marker.hash, before: (text.endsWith('\n') ? '' : '\n') + JSON.stringify(marker) + '\n' }
}

/**
 * Runs fn while holding `path + '.lock'`, created O_EXCL. Waits up to 3 s, and breaks a lock older than 10 s.
 * The ledger uses it per file; the gate uses it to make admission atomic across gatekeeper processes.
 */
export function withLock<T>(path: string, fn: () => T): T {
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
    const { prev, before } = tail(path, nowMs)
    const entry = seal(picked, prev, nowMs)
    appendFileSync(path, before + JSON.stringify(entry) + '\n', { mode: 0o600 })
    return entry
  })
}

/**
 * Checks the whole chain. A line that is not an entry is accepted only when the very next line is a `ledger_torn_tail`
 * entry chained to the last valid entry; those line numbers are reported as `torn`. Anything else breaks the chain.
 */
export function verifyLedger(path: string): { ok: boolean; entries: number; brokenAt?: number; torn?: number[] } {
  if (!existsSync(path)) return { ok: true, entries: 0 }
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  const torn: number[] = []
  const report = (r: { ok: boolean; entries: number; brokenAt?: number }) => (torn.length > 0 ? { ...r, torn } : r)
  let prev = 'genesis'
  for (let i = 0; i < lines.length; i++) {
    const e = entryOf(lines[i])
    if (!e) {
      const next = entryOf(lines[i + 1])
      if (next?.event === TORN_TAIL && next.prev === prev) { torn.push(i + 1); continue }
      return report({ ok: false, entries: i - torn.length, brokenAt: i + 1 })
    }
    const { hash, ...body } = e
    if (body.prev !== prev || sha(canonicalJson(body)) !== hash) return report({ ok: false, entries: i - torn.length, brokenAt: i + 1 })
    prev = hash
  }
  return report({ ok: true, entries: lines.length - torn.length })
}

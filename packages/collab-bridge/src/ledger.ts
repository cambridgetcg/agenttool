// The bridge's two ledgers (C13): content-free, hash-chained, fsynced JSONL. Copied from Summon's src/ledger.ts with the
// key list made a parameter, so the Air hub and the Nuance binary each pass their own and nothing else can be written.
// Values are clipped and reduced to printable ASCII, so even a key that is allowed cannot carry prompt text, control
// characters or a bidi trick into a line someone reads in a terminal.
import { chmodSync, closeSync, existsSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { canonicalJson } from './json.ts'
import { monoNowMs } from './native.ts'

export const AIR_LEDGER_KEYS = ['event', 'device', 'user', 'lineage', 'session_id', 'tool', 'call_ref', 'outcome', 'journal', 'bytes', 'ms', 'code', 'fingerprint'] as const
export const NUANCE_LEDGER_KEYS = ['event', 'form', 'outcome', 'code', 'lineage', 'call_ref', 'tool', 'bytes', 'ms'] as const
export const LEDGER_VALUE_MAX = 200

export type LedgerValue = string | number
export type LedgerFields = { event: string } & Record<string, LedgerValue | undefined>
export interface LedgerEntry { ts: string; prev: string; hash: string; event: string; [key: string]: LedgerValue }

/** The chain's own fields: no key list can let a caller's value stand in for them. */
const CHAIN_KEYS = new Set(['ts', 'prev', 'hash'])
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

const TORN_TAIL = 'ledger_torn_tail'

/** At most LEDGER_VALUE_MAX characters, each code point outside 0x20–0x7e replaced by '?'. */
function cleanString(v: string): string {
  let out = ''
  for (const ch of v) {
    if (out.length >= LEDGER_VALUE_MAX) break
    const c = ch.codePointAt(0)!
    out += c >= 0x20 && c <= 0x7e ? ch : '?'
  }
  return out
}

/** The kept fields: `event` always, then each listed key whose value is a string or a non-negative integer. */
function pick(keys: readonly string[], fields: LedgerFields): Record<string, LedgerValue> {
  const out: Record<string, LedgerValue> = { event: cleanString(String(fields.event)) }
  for (const k of keys) {
    if (k === 'event' || CHAIN_KEYS.has(k)) continue
    const v = fields[k]
    if (typeof v === 'string') out[k] = cleanString(v)
    else if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[k] = v === 0 ? 0 : v // -0 is stored as 0
  }
  return out
}

/** A line that is a ledger entry: it parses to an object with a string `hash`. Anything else is null. */
function entryOf(line: string | undefined): Record<string, unknown> & { hash: string } | null {
  if (line === undefined) return null
  try {
    const e = JSON.parse(line)
    return e !== null && typeof e === 'object' && !Array.isArray(e) && typeof e.hash === 'string' ? e : null
  } catch { return null }
}

function seal(fields: Record<string, LedgerValue>, prev: string, nowMs: number): LedgerEntry {
  const body = { ...fields, ts: new Date(nowMs).toISOString(), prev }
  return { ...body, hash: sha(canonicalJson(body)) } as LedgerEntry
}

/**
 * Where the next entry chains from, and what must be written before it. A file whose last line is not an entry, or that
 * does not end in a newline, has a torn tail (an unclean shutdown, a short write): it is terminated, and a
 * `ledger_torn_tail` entry chained to the last valid entry marks it, so the chain goes on and verifyLedger can name it.
 * The marker is built like every other entry, through the caller's key list (C13), so which lines tore goes in `code`
 * when the list has one (`torn_line_3_unparsed`, `torn_lines_3-4_unparsed`, `torn_line_3_no_newline`), never in a key of its own.
 */
function tail(path: string, keys: readonly string[], nowMs: number): { prev: string; before: string } {
  if (!existsSync(path)) return { prev: 'genesis', before: '' }
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n').filter(Boolean)
  if (lines.length === 0) return { prev: 'genesis', before: '' }
  const last = entryOf(lines[lines.length - 1])
  if (last && text.endsWith('\n')) return { prev: last.hash, before: '' }
  let i = lines.length - 1
  while (i >= 0 && !entryOf(lines[i])) i--
  const lastValid = i >= 0 ? entryOf(lines[i])!.hash : 'genesis'
  const [from, to] = [i + 2, lines.length] // the run of non-entry lines after the last valid entry, 1-based
  const code = last ? `torn_line_${to}_no_newline` : from === to ? `torn_line_${to}_unparsed` : `torn_lines_${from}-${to}_unparsed`
  const marker = seal(pick(keys, { event: TORN_TAIL, code }), lastValid, nowMs)
  return { prev: marker.hash, before: (text.endsWith('\n') ? '' : '\n') + JSON.stringify(marker) + '\n' }
}

const LOCK_STALE_MS = 10_000

/**
 * Breaks a lock older than `staleMs`, one waiter at a time. Waiters that wait on the same dead holder's lock all see it
 * go stale together; if each stats it and then unlinks it by path, a slow one removes the live lock that a faster one has
 * just made, and two holders are inside at once. So breaking takes a gate file (`<lock>.break`, created O_EXCL) first, and
 * the lock's age is read again under the gate: a waiter that finds the gate taken breaks nothing and waits as before, and a
 * lock that is no longer old when the gate is held (someone else broke it and made their own) is left alone. A gate left by
 * a breaker that died is removed once it is `staleMs` old. Returns whether this call removed the lock (Task 63 relay-1-6).
 */
export function breakLock(lock: string, staleMs: number = LOCK_STALE_MS): boolean {
  const gate = lock + '.break'
  try {
    closeSync(openSync(gate, 'wx', 0o600))
  } catch {
    try { if (Date.now() - statSync(gate).mtimeMs > staleMs) unlinkSync(gate) } catch { /* gone */ }
    return false
  }
  try {
    if (Date.now() - statSync(lock).mtimeMs <= staleMs) return false
    unlinkSync(lock)
    return true
  } catch {
    return false // gone already
  } finally {
    try { unlinkSync(gate) } catch { /* gone */ }
  }
}

/**
 * Runs fn while holding `path + '.lock'`, created O_EXCL with this holder's own random token inside. Waits up to 3 s on the
 * monotonic clock (a wall clock stepped back must not stretch a wait that spins the hub's event loop), and breaks a lock
 * older than 10 s by its mtime (the file's time is wall-clock; a lock held that long is a dead holder's), through breakLock's
 * gate so that only one waiter breaks it. The release removes
 * the lock only while it still holds this holder's token, so a lock that was broken and replaced during a long fn is left to
 * its new holder. The ledger uses it per file; the device file uses it to re-read and write under one lock (Task 47).
 * `o.timeoutMs` lets a test shorten the wait.
 */
export function withLock<T>(path: string, fn: () => T, o: { timeoutMs?: number } = {}): T {
  const lock = path + '.lock'
  const deadline = monoNowMs() + (o.timeoutMs ?? 3000)
  const token = randomBytes(16).toString('hex')
  for (;;) {
    try {
      const fd = openSync(lock, 'wx', 0o600)
      try { writeSync(fd, token) } catch (e) {
        closeSync(fd)
        try { unlinkSync(lock) } catch { /* gone */ }
        throw e
      }
      closeSync(fd)
      break
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) breakLock(lock) } catch { /* gone meanwhile: the next open decides */ }
      if (monoNowMs() > deadline) throw new Error('ledger lock timeout')
      Bun.sleepSync(20)
    }
  }
  try { return fn() } finally {
    try { if (readFileSync(lock, 'utf8') === token) unlinkSync(lock) } catch { /* gone, or not ours to read */ }
  }
}

/**
 * Append one hash-chained entry, keeping only `event` and the listed keys. A string is clipped to LEDGER_VALUE_MAX and
 * reduced to printable ASCII; a number is kept only as a non-negative integer; anything else is dropped. Callers still
 * choose what to pass: a tool name or a code, never arguments, bodies, prompts or key material.
 */
export function appendLedger(path: string, keys: readonly string[], fields: LedgerFields, nowMs: number = Date.now()): LedgerEntry {
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700) // the mode passed to mkdir is cut by the umask
  }
  return withLock(path, () => {
    const picked = pick(keys, fields)
    const created = !existsSync(path)
    const { prev, before } = tail(path, keys, nowMs)
    const entry = seal(picked, prev, nowMs)
    // fsync'd before it returns, so a caller that acts after logging has its entry handed to the disk first (a new file's
    // directory entry too). macOS fsync(2) can still leave it in the drive's cache; that is as far as this goes.
    const bytes = Buffer.from(before + JSON.stringify(entry) + '\n', 'utf8')
    const fd = openSync(path, 'a', 0o600)
    try {
      if (created) fchmodSync(fd, 0o600)
      for (let off = 0; off < bytes.length;) off += writeSync(fd, bytes, off, bytes.length - off)
      fsyncSync(fd)
    } finally { closeSync(fd) }
    if (created) { try { const d = openSync(dir, 'r'); try { fsyncSync(d) } finally { closeSync(d) } } catch { /* the entry itself is synced */ } }
    return entry
  })
}

/**
 * Checks the whole chain. A run of lines that are not entries is accepted only when the line right after it is a
 * `ledger_torn_tail` entry chained to the last valid entry (what appendLedger writes after a torn tail); every line of
 * the run is reported in `torn`. Anything else breaks the chain at the run's first line.
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
      let j = i + 1
      while (j < lines.length && !entryOf(lines[j])) j++
      const next = entryOf(lines[j])
      if (next?.event === TORN_TAIL && next.prev === prev) { for (let k = i; k < j; k++) torn.push(k + 1); i = j - 1; continue }
      return report({ ok: false, entries: i - torn.length, brokenAt: i + 1 })
    }
    const { hash, ...body } = e
    if (body.prev !== prev || sha(canonicalJson(body)) !== hash) return report({ ok: false, entries: i - torn.length, brokenAt: i + 1 })
    prev = hash
  }
  return report({ ok: true, entries: lines.length - torn.length })
}

/** The entries, oldest first (torn-tail markers included); lines that are not entries are skipped; no file is []. */
export function readLedger(path: string): LedgerEntry[] {
  if (!existsSync(path)) return []
  const out: LedgerEntry[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const e = entryOf(line)
    if (e) out.push(e as unknown as LedgerEntry)
  }
  return out
}

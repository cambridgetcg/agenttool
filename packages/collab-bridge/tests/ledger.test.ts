import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from '../src/json.ts'
import { AIR_LEDGER_KEYS, appendLedger, LEDGER_VALUE_MAX, NUANCE_LEDGER_KEYS, readLedger, verifyLedger, withLock } from '../src/ledger.ts'
import { cleanupTmps, temp } from './helpers.ts'

afterEach(cleanupTmps)

const ledgerIn = () => join(temp('cb-ledger-'), 'state', 'ledger.jsonl')
const linesOf = (p: string) => readFileSync(p, 'utf8').split('\n').filter(Boolean)
const CALL_REF = 'lin_' + 'a'.repeat(32) + ':0badf00d:1'

describe('canonicalJson', () => {
  test('sorts keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: undefined }], c: 'x' }, u: undefined })).toBe('{"a":{"c":"x","d":[3,{"y":1}]},"b":1}')
    expect(canonicalJson([null, 'é', 2])).toBe('[null,"é",2]')
  })
})

describe('ledger', () => {
  test('the Air and Nuance key lists are exact', () => {
    expect([...AIR_LEDGER_KEYS]).toEqual(['event', 'device', 'user', 'lineage', 'session_id', 'tool', 'call_ref', 'outcome', 'journal', 'bytes', 'ms', 'code', 'fingerprint'])
    expect([...NUANCE_LEDGER_KEYS]).toEqual(['event', 'form', 'outcome', 'code', 'lineage', 'call_ref', 'tool', 'bytes', 'ms'])
    expect(LEDGER_VALUE_MAX).toBe(200)
  })

  test('chains entries and verifies', () => {
    const p = ledgerIn()
    const a = appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'hello', outcome: 'ok', bytes: 412, ms: 9 }, Date.UTC(2026, 9, 13, 12))
    const b = appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'other', outcome: 'refused', code: 'malformed', bytes: 0, ms: 1 })
    expect(a).toMatchObject({ event: 'gate', form: 'hello', outcome: 'ok', bytes: 412, ms: 9, ts: '2026-10-13T12:00:00.000Z', prev: 'genesis' })
    expect(b.prev).toBe(a.hash)
    expect(readLedger(p)).toEqual([a, b])
    expect(verifyLedger(p)).toEqual({ ok: true, entries: 2 })
  })

  test('drops keys outside the list', () => {
    const p = ledgerIn()
    const n = appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'hello', device: 'nuance', session_id: 'ses_1', fingerprint: 'SHA256:x' })
    expect(Object.keys(n).sort()).toEqual(['event', 'form', 'hash', 'prev', 'ts'])
    const a = appendLedger(p, AIR_LEDGER_KEYS, { event: 'forward', device: 'nuance', call_ref: CALL_REF, form: 'hello' })
    expect(Object.keys(a).sort()).toEqual(['call_ref', 'device', 'event', 'hash', 'prev', 'ts'])
    // A key list cannot make a caller's value stand in for the chain's own fields.
    const c = appendLedger(p, ['event', 'ts', 'prev', 'hash'], { event: 'x', ts: 'forged', prev: 'forged', hash: 'forged' })
    expect(c.ts).not.toBe('forged')
    expect(c.prev).toBe(a.hash)
    expect(verifyLedger(p)).toEqual({ ok: true, entries: 3 })
  })

  test('a body or prompt field never reaches the file', () => {
    const p = ledgerIn()
    appendLedger(p, AIR_LEDGER_KEYS, { event: 'forward', tool: 'collab_report_append', body: 'secret prompt', prompt: 'secret prompt', arguments: 'secret prompt' })
    expect(readFileSync(p, 'utf8')).not.toContain('secret')
  })

  test('clips strings and replaces non-printable characters', () => {
    const p = ledgerIn()
    const e = appendLedger(p, AIR_LEDGER_KEYS, { event: 'dial', code: 'a\nb\tc\u0000d\u{202E}eéf😀g\u007f', device: 'x'.repeat(500) })
    // One '?' per code point (the emoji is one), so a value never holds a control, bidi or non-ASCII character.
    expect(e.code).toBe('a?b?c?d?e?f?g?')
    expect(e.device).toBe('x'.repeat(LEDGER_VALUE_MAX))
    const astral = appendLedger(p, AIR_LEDGER_KEYS, { event: 'dial', code: '😀'.repeat(300) })
    expect(astral.code).toBe('?'.repeat(LEDGER_VALUE_MAX))
    const raw = readFileSync(p, 'utf8')
    for (const ch of raw) expect(ch === '\n' || (ch >= ' ' && ch <= '~')).toBe(true)
    expect(verifyLedger(p)).toEqual({ ok: true, entries: 2 })
  })

  test('keeps integer numbers and drops non-finite or negative ones', () => {
    const p = ledgerIn()
    const kept = appendLedger(p, AIR_LEDGER_KEYS, { event: 'fetch', bytes: 0, ms: 1234 })
    expect([kept.bytes, kept.ms]).toEqual([0, 1234])
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const e = appendLedger(p, AIR_LEDGER_KEYS, { event: 'fetch', bytes: bad })
      expect('bytes' in e).toBe(false)
    }
    const zero = appendLedger(p, AIR_LEDGER_KEYS, { event: 'fetch', ms: -0 })
    expect(Object.is(zero.ms, 0)).toBe(true)
    expect(readLedger(p).map((e) => ('bytes' in e ? e.bytes : 'absent'))).toEqual([0, 'absent', 'absent', 'absent', 'absent', 'absent', 'absent'])
    expect(verifyLedger(p)).toEqual({ ok: true, entries: 7 })
  })

  test('files are 0600 in a 0700 dir', () => {
    const p = ledgerIn()
    // A tight umask would leave the file 0400 and the dir 0500; the ledger sets its own modes, whatever the umask.
    const old = process.umask(0o277)
    try { appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'hello' }) } finally { process.umask(old) }
    expect(statSync(p).mode & 0o777).toBe(0o600)
    expect(statSync(join(p, '..')).mode & 0o777).toBe(0o700)
    expect(existsSync(p + '.lock')).toBe(false)
  })

  test('a torn tail is marked and the chain continues', () => {
    const p = ledgerIn()
    appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'hello' })
    const second = appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'relay' })
    appendFileSync(p, Buffer.alloc(48)) // what an unclean shutdown can leave: the size grew, the bytes never landed
    const next = appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'upload_pack' })
    const lines = linesOf(p)
    expect(lines).toHaveLength(5)
    const torn = JSON.parse(lines[3]!)
    expect(torn).toMatchObject({ event: 'ledger_torn_tail', code: 'torn_line_3_unparsed', prev: second.hash })
    expect(Object.keys(torn).sort()).toEqual(['code', 'event', 'hash', 'prev', 'ts'])
    expect(JSON.parse(lines[4]!)).toEqual(next)
    expect(next.prev).toBe(torn.hash)
    expect(verifyLedger(p)).toEqual({ ok: true, entries: 4, torn: [3] })
    expect(readLedger(p).map((e) => e.event)).toEqual(['gate', 'gate', 'ledger_torn_tail', 'gate'])
  })

  test('half a line with no newline is terminated, marked, and followed by the entry', () => {
    const p = ledgerIn()
    const first = appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'hello' })
    appendFileSync(p, '{"event":"gate","form":"rel')
    appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'relay' })
    const lines = linesOf(p)
    expect(lines).toHaveLength(4)
    expect(JSON.parse(lines[2]!)).toMatchObject({ event: 'ledger_torn_tail', code: 'torn_line_2_unparsed', prev: first.hash })
    expect(verifyLedger(p)).toEqual({ ok: true, entries: 3, torn: [2] })
    appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'hello' }) // a clean tail again: no second marker
    expect(linesOf(p)).toHaveLength(5)
  })

  test('the torn-tail marker carries only the caller\'s keys and the chain fields, on both Macs\' key lists (Task 63 conformance-6-3)', () => {
    const chain = new Set(['ts', 'prev', 'hash'])
    const torn = (keys: readonly string[], garbage: string) => {
      const p = ledgerIn()
      appendLedger(p, keys, { event: 'gate', form: 'hello' })
      appendFileSync(p, garbage)
      appendLedger(p, keys, { event: 'gate', form: 'relay' })
      expect(verifyLedger(p).ok).toBe(true)
      return readLedger(p).filter((e) => e.event === 'ledger_torn_tail')
    }
    for (const keys of [AIR_LEDGER_KEYS, NUANCE_LEDGER_KEYS] as const) {
      for (const garbage of ['{"event":"gate","form":"rel', '{"x\n{"y\n', Buffer.alloc(8).toString('latin1') + '\n']) {
        const markers = torn(keys, garbage)
        expect(markers).toHaveLength(1)
        for (const k of Object.keys(markers[0]!)) expect([k, keys.includes(k as never) || chain.has(k)]).toEqual([k, true])
      }
    }
    // A list without `code` leaves the marker with the event and the chain only; a line count never reaches a key it is not given.
    const bare = torn(['event'], '{"event":"gate","form":"rel')
    expect(Object.keys(bare[0]!).sort()).toEqual(['event', 'hash', 'prev', 'ts'])
    // The code still says which lines tore: a run of unparsable lines, and a last line that parsed but had no newline.
    expect(torn(NUANCE_LEDGER_KEYS, '{"x\n{"y\n')[0]).toMatchObject({ code: 'torn_lines_2-3_unparsed' })
    const p = ledgerIn()
    appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'hello' })
    appendFileSync(p, '{"hash":"x"}')
    appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'relay' })
    expect(readLedger(p).find((e) => e.event === 'ledger_torn_tail')).toMatchObject({ code: 'torn_line_2_no_newline' })
  })

  test('a tampered line breaks the chain at that line', () => {
    const p = ledgerIn()
    appendLedger(p, AIR_LEDGER_KEYS, { event: 'attach', device: 'nuance' })
    appendLedger(p, AIR_LEDGER_KEYS, { event: 'forward', outcome: 'ok', ms: 20 })
    appendLedger(p, AIR_LEDGER_KEYS, { event: 'forward', outcome: 'ok', ms: 30 })
    writeFileSync(p, readFileSync(p, 'utf8').replace('"ms":20', '"ms":21'))
    expect(verifyLedger(p)).toEqual({ ok: false, entries: 1, brokenAt: 2 })
  })

  test('an unparsable line in the middle with no marker after it fails at its first line', () => {
    const p = ledgerIn()
    appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'hello' })
    appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'relay' })
    const [a, b] = linesOf(p)
    writeFileSync(p, `${a}\n{"x\nnull\n${b}\n`)
    expect(verifyLedger(p)).toEqual({ ok: false, entries: 1, brokenAt: 2 })
  })

  test('a null last line is reported as a broken chain, not thrown', () => {
    const p = ledgerIn()
    appendLedger(p, NUANCE_LEDGER_KEYS, { event: 'gate', form: 'hello' })
    appendFileSync(p, 'null\n')
    expect(verifyLedger(p)).toEqual({ ok: false, entries: 1, brokenAt: 2 })
  })

  test('a missing file reads and verifies as empty', () => {
    const p = ledgerIn()
    expect(readLedger(p)).toEqual([])
    expect(verifyLedger(p)).toEqual({ ok: true, entries: 0 })
  })
})

describe('withLock', () => {
  test('runs fn holding <path>.lock and removes it, also when fn throws', () => {
    const p = join(temp('cb-lock-'), 'devices.json')
    expect(withLock(p, () => { expect(existsSync(p + '.lock')).toBe(true); return 7 })).toBe(7)
    expect(existsSync(p + '.lock')).toBe(false)
    expect(() => withLock(p, () => { throw new Error('inside') })).toThrow('inside')
    expect(existsSync(p + '.lock')).toBe(false)
  })

  test('breaks a lock left older than 10 s by a dead holder', () => {
    const p = join(temp('cb-lock-'), 'devices.json')
    closeSync(openSync(p + '.lock', 'wx', 0o600))
    const old = (Date.now() - 20_000) / 1000
    utimesSync(p + '.lock', old, old)
    expect(withLock(p, () => 'ran')).toBe('ran')
    expect(existsSync(p + '.lock')).toBe(false)
  })
})

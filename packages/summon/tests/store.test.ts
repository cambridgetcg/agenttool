import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendLedger, verifyLedger } from '../src/ledger.ts'
import { claimId, pruneSeen } from '../src/replay.ts'
import { admittedSince, countActive, jobDir, readState, writeState, type JobState } from '../src/jobs.ts'
import { summonPaths } from '../src/paths.ts'
import { newRequestId } from '../src/request.ts'

const tmps: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'summon-st-')); tmps.push(d); return d }
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }) })

describe('ledger', () => {
  test('chains entries and verifies', () => {
    const p = join(tmp(), 'state', 'ledger.jsonl')
    appendLedger(p, { event: 'admitted', id: 'smn_' + '0'.repeat(32) })
    appendLedger(p, { event: 'refused', reason: 'replayed' })
    expect(verifyLedger(p)).toEqual({ ok: true, entries: 2 })
    expect(statSync(p).mode & 0o777).toBe(0o600)
  })
  test('detects an edited entry', () => {
    const p = join(tmp(), 'ledger.jsonl')
    appendLedger(p, { event: 'admitted' })
    appendLedger(p, { event: 'refused', reason: 'busy' })
    writeFileSync(p, readFileSync(p, 'utf8').replace('"busy"', '"rate_limited"'))
    expect(verifyLedger(p)).toMatchObject({ ok: false, brokenAt: 2 })
  })
  test('never records a prompt field', () => {
    const p = join(tmp(), 'ledger.jsonl')
    appendLedger(p, { event: 'admitted', prompt: 'secret' } as never)
    expect(readFileSync(p, 'utf8')).not.toContain('secret')
  })
  test('reports a null line as a broken chain instead of throwing', () => {
    const p = join(tmp(), 'ledger.jsonl')
    appendLedger(p, { event: 'admitted' })
    writeFileSync(p, readFileSync(p, 'utf8') + 'null\n')
    expect(verifyLedger(p)).toEqual({ ok: false, entries: 1, brokenAt: 2 })
  })
  test('reports a non-object array line as a broken chain', () => {
    const p = join(tmp(), 'ledger.jsonl')
    appendLedger(p, { event: 'admitted' })
    writeFileSync(p, readFileSync(p, 'utf8') + '[1]\n')
    expect(verifyLedger(p)).toEqual({ ok: false, entries: 1, brokenAt: 2 })
  })

  describe('F04: a torn tail is marked and chained past, not fatal', () => {
    const linesOf = (p: string) => readFileSync(p, 'utf8').split('\n').filter(Boolean)
    test('a zero-filled tail: the next append marks it ledger_torn_tail, chains from the last valid entry, and verifies', () => {
      const p = join(tmp(), 'ledger.jsonl')
      appendLedger(p, { event: 'admitted', id: 'smn_' + '0'.repeat(32) })
      const second = appendLedger(p, { event: 'refused', reason: 'busy' })
      appendFileSync(p, Buffer.alloc(48)) // what an unclean shutdown can leave: the size grew, the bytes never landed
      const next = appendLedger(p, { event: 'admitted', id: 'smn_' + '1'.repeat(32) })
      const lines = linesOf(p)
      expect(lines).toHaveLength(5)
      const torn = JSON.parse(lines[3]!)
      expect(torn).toMatchObject({ event: 'ledger_torn_tail', detail: 'line 3 did not parse', prev: second.hash })
      expect(Object.keys(torn).sort()).toEqual(['detail', 'event', 'hash', 'prev', 'ts'])
      expect(JSON.parse(lines[4]!)).toEqual(next)
      expect(next.prev).toBe(torn.hash)
      expect(verifyLedger(p)).toEqual({ ok: true, entries: 4, torn: [3] })
    })
    test('half a JSON line with no newline: it is terminated, marked, and the requested entry follows', () => {
      const p = join(tmp(), 'ledger.jsonl')
      const first = appendLedger(p, { event: 'admitted' })
      appendFileSync(p, '{"event":"job_end","id":"smn_0000')
      expect(() => appendLedger(p, { event: 'cancel_requested', id: 'smn_' + 'a'.repeat(32) })).not.toThrow()
      expect(readFileSync(p, 'utf8')).toContain('{"event":"job_end","id":"smn_0000\n')
      const lines = linesOf(p)
      expect(lines).toHaveLength(4)
      expect(JSON.parse(lines[2]!)).toMatchObject({ event: 'ledger_torn_tail', detail: 'line 2 did not parse', prev: first.hash })
      expect(JSON.parse(lines[3]!)).toMatchObject({ event: 'cancel_requested', prev: JSON.parse(lines[2]!).hash })
      expect(verifyLedger(p)).toEqual({ ok: true, entries: 3, torn: [2] })
      appendLedger(p, { event: 'admitted' }) // a clean tail again: no second marker
      expect(linesOf(p)).toHaveLength(5)
      expect(verifyLedger(p)).toEqual({ ok: true, entries: 4, torn: [2] })
    })
    test('a torn first line chains its marker from genesis', () => {
      const p = join(tmp(), 'ledger.jsonl')
      writeFileSync(p, '{"event":"adm')
      appendLedger(p, { event: 'admitted' })
      expect(JSON.parse(linesOf(p)[1]!)).toMatchObject({ event: 'ledger_torn_tail', prev: 'genesis' })
      expect(verifyLedger(p)).toEqual({ ok: true, entries: 2, torn: [1] })
    })
    test('a `null` last line (the Air probe) is a torn tail too', () => {
      const p = join(tmp(), 'ledger.jsonl')
      appendLedger(p, { event: 'sent' })
      appendFileSync(p, 'null\n')
      appendLedger(p, { event: 'sent' })
      expect(verifyLedger(p)).toEqual({ ok: true, entries: 3, torn: [2] })
    })
    test('an unparsable line in the middle that is NOT followed by a ledger_torn_tail entry still fails verification', () => {
      const p = join(tmp(), 'ledger.jsonl')
      appendLedger(p, { event: 'admitted' })
      appendLedger(p, { event: 'refused', reason: 'busy' }) // chained straight to the first entry
      const [a, b] = linesOf(p)
      writeFileSync(p, `${a}\n{"event":"job_end","id":"smn_00\n${b}\n`)
      expect(verifyLedger(p)).toEqual({ ok: false, entries: 1, brokenAt: 2 })
    })
    test('a marker chained to anything but the last valid entry does not excuse the line before it', () => {
      const p = join(tmp(), 'ledger.jsonl')
      appendLedger(p, { event: 'admitted' })
      appendFileSync(p, '{"event":"job_e')
      appendLedger(p, { event: 'admitted' })
      const lines = linesOf(p)
      const marker = JSON.parse(lines[2]!)
      lines[2] = JSON.stringify({ ...marker, prev: 'genesis' })
      writeFileSync(p, lines.join('\n') + '\n')
      expect(verifyLedger(p)).toMatchObject({ ok: false, brokenAt: 2 })
    })
  })
})

describe('replay set', () => {
  test('claims an id once', () => {
    const d = join(tmp(), 'seen'); const id = newRequestId()
    expect(claimId(d, id)).toBe(true)
    expect(claimId(d, id)).toBe(false)
  })
  test('refuses to build a path from a bad id', () => {
    expect(() => claimId(join(tmp(), 'seen'), '../x')).toThrow()
  })
  test('prunes ids older than the window', () => {
    const d = join(tmp(), 'seen'); const id = newRequestId()
    claimId(d, id)
    const old = (Date.now() - 31 * 86_400_000) / 1000
    utimesSync(join(d, id), old, old)
    expect(pruneSeen(d, Date.now())).toBe(1)
    expect(claimId(d, id)).toBe(true)
  })
})

describe('job store', () => {
  const state = (id: string, status: JobState['status'], admitted: number): JobState => ({
    id, status, runtime: 'claude', model: 'sonnet', access: 'review', cwd_real: '/x',
    admitted_at: new Date(admitted).toISOString(), expires_at: new Date(admitted + 900_000).toISOString(), timeout_s: 900,
  })
  test('counts active jobs and recent admissions', () => {
    const paths = summonPaths(tmp())
    const now = Date.now()
    writeState(paths, state(newRequestId(), 'running', now))
    writeState(paths, state(newRequestId(), 'completed', now - 7_200_000))
    writeState(paths, state(newRequestId(), 'queued', now - 60_000))
    expect(countActive(paths, now)).toBe(2)
    expect(admittedSince(paths, now - 3_600_000)).toBe(2)
  })
  test('round-trips state with 0600 files in 0700 dirs', () => {
    const paths = summonPaths(tmp()); const id = newRequestId()
    writeState(paths, state(id, 'queued', Date.now()))
    expect(readState(paths, id)?.status).toBe('queued')
    expect(statSync(jobDir(paths, id)).mode & 0o777).toBe(0o700)
    expect(statSync(join(jobDir(paths, id), 'state.json')).mode & 0o777).toBe(0o600)
  })
})

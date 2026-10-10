import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
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
    expect(countActive(paths)).toBe(2)
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

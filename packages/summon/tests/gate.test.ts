import { afterEach, describe, expect, test } from 'bun:test'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { gateStart, type GateDeps } from '../src/gate.ts'
import { verifyLedger } from '../src/ledger.ts'
import { summonPaths } from '../src/paths.ts'
import { cleanupTmps, DEFAULT_ALLOWLIST, sampleRequest, targetHome } from './helpers.ts'

afterEach(cleanupTmps)

const deps = (home: string, over: Partial<GateDeps> = {}): GateDeps => ({
  nowMs: () => Date.now(), home, paths: summonPaths(home),
  guiSessionIsMine: () => true, runnerLoaded: () => true, claudeAvailable: () => true, ...over,
})

describe('gateStart', () => {
  test('admits and spools an allowlisted request', () => {
    const h = targetHome(); const req = sampleRequest()
    const r = gateStart(JSON.stringify(req), deps(h))
    expect(r).toEqual({ status: 'admitted', handle: `nuance/${req.id}` })
    expect(existsSync(join(h, '.local/state/summon/spool', req.id))).toBe(true)
    const state = JSON.parse(readFileSync(join(h, '.local/state/summon/jobs', req.id, 'state.json'), 'utf8'))
    expect(state).toMatchObject({ status: 'queued', cwd_real: join(h, 'Projects/x'), timeout_s: 900 })
    expect(readFileSync(join(h, '.local/state/summon/ledger.jsonl'), 'utf8')).not.toContain(req.prompt)
  })
  test('refuses, in order, with the closed reasons', () => {
    const h = targetHome()
    expect(gateStart('{', deps(h))).toMatchObject({ status: 'refused', reason: 'malformed' })
    expect(gateStart(JSON.stringify(sampleRequest({ to_device: 'other' })), deps(h))).toMatchObject({ reason: 'malformed' })
    const old = sampleRequest({ issued_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-01T00:15:00Z' })
    expect(gateStart(JSON.stringify(old), deps(h))).toMatchObject({ reason: 'expired' })
    const dup = sampleRequest()
    gateStart(JSON.stringify(dup), deps(h, { guiSessionIsMine: () => false }))
    expect(gateStart(JSON.stringify(dup), deps(h))).toMatchObject({ reason: 'replayed' })
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h, { guiSessionIsMine: () => false }))).toMatchObject({ reason: 'target_logged_out' })
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h, { runnerLoaded: () => false }))).toMatchObject({ reason: 'runner_missing' })
    expect(gateStart(JSON.stringify(sampleRequest({ cwd: '~/Elsewhere' })), deps(h))).toMatchObject({ reason: 'outside_allowlist' })
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h, { claudeAvailable: () => false }))).toMatchObject({ reason: 'runtime_unavailable' })
  })
  test('busy when the concurrency limit is full; rate_limited past starts_per_hour', () => {
    const h = targetHome()
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h)).status).toBe('admitted')
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h))).toMatchObject({ reason: 'busy' })
    const h2 = targetHome(DEFAULT_ALLOWLIST.replace('max_concurrent: 1', 'max_concurrent: 8').replace('starts_per_hour: 6', 'starts_per_hour: 1'))
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h2)).status).toBe('admitted')
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h2))).toMatchObject({ reason: 'rate_limited' })
  })
  test('a missing allowlist refuses as outside_allowlist', () => {
    const h = targetHome(); rmSync(join(h, '.config/summon/allowlist.yaml'))
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h))).toMatchObject({ reason: 'outside_allowlist' })
  })
  test('hands the runner the resolved cwd, never the request spelling', () => {
    const h = targetHome(); const req = sampleRequest({ cwd: '~/Projects/alias' })
    symlinkSync(join(h, 'Projects/x'), join(h, 'Projects/alias'))
    expect(gateStart(JSON.stringify(req), deps(h)).status).toBe('admitted')
    const state = JSON.parse(readFileSync(join(h, '.local/state/summon/jobs', req.id, 'state.json'), 'utf8'))
    expect(state.cwd_real).toBe(join(h, 'Projects/x'))
  })
  test('the admission lock is released after an admission and after a busy refusal', () => {
    const h = targetHome(); const lock = join(h, '.local/state/summon/admission.lock')
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h)).status).toBe('admitted')
    expect(existsSync(lock)).toBe(false)
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h))).toMatchObject({ reason: 'busy' })
    expect(existsSync(lock)).toBe(false)
  })
  test('the busy decision is made while the admission lock is held', () => {
    const h = targetHome(); const lock = join(h, '.local/state/summon/admission.lock')
    gateStart(JSON.stringify(sampleRequest()), deps(h))
    let heldAtRefusal = false
    // nowMs is read first at the top of gateStart (no lock yet), then again when the busy refusal is written.
    const r = gateStart(JSON.stringify(sampleRequest()), deps(h, { nowMs: () => { heldAtRefusal = existsSync(lock); return Date.now() } }))
    expect(r).toMatchObject({ reason: 'busy' })
    expect(heldAtRefusal).toBe(true)
  })
  test('a stale admission lock left by a dead gatekeeper does not wedge admission', () => {
    const h = targetHome(); const state = join(h, '.local/state/summon'); const lock = join(state, 'admission.lock')
    mkdirSync(state, { recursive: true, mode: 0o700 })
    closeSync(openSync(lock, 'wx', 0o600))
    const old = new Date(Date.now() - 60_000); utimesSync(lock, old, old)
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h)).status).toBe('admitted')
    expect(existsSync(lock)).toBe(false)
  })
  test('private modes and an intact ledger chain after admitted, busy and replayed outcomes', () => {
    const h = targetHome(); const p = summonPaths(h); const req = sampleRequest()
    gateStart(JSON.stringify(req), deps(h))
    gateStart(JSON.stringify(sampleRequest()), deps(h))
    gateStart(JSON.stringify(req), deps(h))
    for (const d of [p.state, p.spool, p.jobs, join(p.jobs, req.id)]) expect(statSync(d).mode & 0o777).toBe(0o700)
    for (const f of [join(p.spool, req.id), join(p.jobs, req.id, 'request.json'), join(p.jobs, req.id, 'state.json')]) expect(statSync(f).mode & 0o777).toBe(0o600)
    expect(verifyLedger(p.ledger)).toEqual({ ok: true, entries: 3 })
  })
})

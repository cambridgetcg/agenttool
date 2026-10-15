import { afterEach, describe, expect, test } from 'bun:test'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gateStart, type GateDeps } from '../src/gate.ts'
import { requestCancel, resultOf, statusOf } from '../src/gatekeeper.ts'
import { verifyLedger } from '../src/ledger.ts'
import { summonPaths } from '../src/paths.ts'
import { claimId } from '../src/replay.ts'
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
    const h2 = targetHome(DEFAULT_ALLOWLIST.replace('starts_per_hour: 6', 'starts_per_hour: 1'))
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h2)).status).toBe('admitted')
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h2))).toMatchObject({ reason: 'rate_limited' })
  })
  test('final review M4: busy says how to clear a job that looks stuck; rate_limited has no such hint', () => {
    const h = targetHome()
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h)).status).toBe('admitted')
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h))).toEqual({ status: 'refused', reason: 'busy', detail: '1 summon(s) already queued or running',
      hint: 'if a job looks stuck, run summon nuance inventory — it starts the runner, which settles jobs that can no longer run' })
    const h2 = targetHome(DEFAULT_ALLOWLIST.replace('starts_per_hour: 6', 'starts_per_hour: 1'))
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h2)).status).toBe('admitted')
    expect(gateStart(JSON.stringify(sampleRequest()), deps(h2))).toEqual({ status: 'refused', reason: 'rate_limited', detail: 'more than 1 starts in the last hour' })
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
  describe('F21/F24: runtime availability is decided before the allowlist', () => {
    test('unverified codex and unsupported hermes are runtime_unavailable, with no widening hint', () => {
      const h = targetHome()
      for (const runtime of ['codex', 'hermes'] as const) {
        expect(gateStart(JSON.stringify(sampleRequest({ runtime, model: 'gpt-6-astra' })), deps(h)))
          .toEqual({ status: 'refused', reason: 'runtime_unavailable', detail: runtime === 'codex'
            ? 'codex CLI is missing or has not passed the supported-version check' : 'hermes is not wired in Phase 0' })
      }
    })
    test('a claude request with a provider is runtime_unavailable, even when the allowlist lists that provider', () => {
      const h = targetHome(DEFAULT_ALLOWLIST.replace('{ model: haiku }', '{ model: haiku, provider: bedrock }'))
      const NOT_WIRED = { status: 'refused', reason: 'runtime_unavailable', detail: 'provider selection is not wired for claude in Phase 0' } as const
      expect(gateStart(JSON.stringify(sampleRequest({ model: 'haiku', provider: 'bedrock' })), deps(h))).toEqual(NOT_WIRED)
      expect(gateStart(JSON.stringify(sampleRequest({ provider: 'anthropic', cwd: '~/Elsewhere' })), deps(h))).toEqual(NOT_WIRED)
    })
    test('claude missing from the Mac is answered before any allowlist hint', () => {
      const h = targetHome()
      expect(gateStart(JSON.stringify(sampleRequest({ cwd: '~/Elsewhere' })), deps(h, { claudeAvailable: () => false })))
        .toEqual({ status: 'refused', reason: 'runtime_unavailable', detail: 'claude is not installed on this Mac' })
    })
  })
  test('F24: an admitted effort is stored with the job; no effort stores none', () => {
    const h = targetHome(DEFAULT_ALLOWLIST.replace('{ model: sonnet }', '{ model: sonnet, effort: [low] }'))
    const withEffort = sampleRequest({ effort: 'low' })
    expect(gateStart(JSON.stringify(withEffort), deps(h)).status).toBe('admitted')
    expect(JSON.parse(readFileSync(join(h, '.local/state/summon/jobs', withEffort.id, 'state.json'), 'utf8'))).toMatchObject({ model: 'sonnet', effort: 'low' })
    const h2 = targetHome(); const plain = sampleRequest()
    expect(gateStart(JSON.stringify(plain), deps(h2)).status).toBe('admitted')
    expect('effort' in JSON.parse(readFileSync(join(h2, '.local/state/summon/jobs', plain.id, 'state.json'), 'utf8'))).toBe(false)
  })
  test('F20: a missing or broken allowlist refuses with a hint naming the file and what is wrong', () => {
    const hintFor = (detail: string) => `fix ~/.config/summon/allowlist.yaml on Nuance (${detail}); the installer's starter file is the reference`
    const missing = targetHome(); rmSync(join(missing, '.config/summon/allowlist.yaml'))
    expect(gateStart(JSON.stringify(sampleRequest()), deps(missing)))
      .toEqual({ status: 'refused', reason: 'outside_allowlist', detail: 'allowlist: missing', hint: hintFor('missing') })
    const serialOnly = 'limits.max_concurrent must be 1 in Phase 0 (the runner is serial)'
    expect(gateStart(JSON.stringify(sampleRequest()), deps(targetHome(DEFAULT_ALLOWLIST.replace('max_concurrent: 1', 'max_concurrent: 2')))))
      .toEqual({ status: 'refused', reason: 'outside_allowlist', detail: `allowlist: ${serialOnly}`, hint: hintFor(serialOnly) })
    const typo = gateStart(JSON.stringify(sampleRequest()), deps(targetHome(': : :')))
    expect(typo).toMatchObject({ status: 'refused', reason: 'outside_allowlist' })
    expect(typo.hint).toStartWith('fix ~/.config/summon/allowlist.yaml on Nuance (yaml: ')
  })
  describe('F07: a refused id can be traced', () => {
    const ledgerOf = (h: string): any[] => readFileSync(summonPaths(h).ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const SEEN = 'received and refused; see the Nuance ledger'
    const NO_DECISION = 'received; no job state on this Mac — see the Nuance ledger'
    test('a schema refusal ledgers the request id when the id is well-formed, and only then', () => {
      const h = targetHome()
      const relative = sampleRequest({ cwd: 'Projects/x' })
      expect(gateStart(JSON.stringify(relative), deps(h))).toMatchObject({ status: 'refused', reason: 'malformed', detail: 'cwd' })
      const extra = sampleRequest()
      expect(gateStart(JSON.stringify({ ...extra, extra: 1 }), deps(h))).toMatchObject({ reason: 'malformed', detail: 'unknown field: extra' })
      gateStart(JSON.stringify({ ...sampleRequest(), id: 'smn_../../etc/passwd', cwd: 'x' }), deps(h))
      gateStart('{', deps(h))
      const [a, b, c, d] = ledgerOf(h)
      expect(a).toMatchObject({ event: 'refused', reason: 'malformed', detail: 'cwd', id: relative.id })
      expect(b).toMatchObject({ event: 'refused', reason: 'malformed', id: extra.id })
      expect(c.id).toBeUndefined()
      expect(d.id).toBeUndefined()
      expect(verifyLedger(summonPaths(h).ledger)).toEqual({ ok: true, entries: 4 })
    })
    test('after the id is claimed, status, result and cancel answer refused with the reason, never "no such summon"', () => {
      const h = targetHome(); const p = summonPaths(h); const now = Date.now()
      const outside = sampleRequest({ cwd: '~/Elsewhere' })
      expect(gateStart(JSON.stringify(outside), deps(h))).toMatchObject({ reason: 'outside_allowlist' })
      for (const r of [statusOf(p, 'nuance', outside.id, now), resultOf(p, 'nuance', outside.id, now), requestCancel(p, 'nuance', outside.id, now)]) {
        expect(r).toMatchObject({ status: 'refused', reason: 'outside_allowlist', detail: SEEN })
      }
      expect(gateStart(JSON.stringify(sampleRequest()), deps(h)).status).toBe('admitted')
      const busy = sampleRequest()
      expect(gateStart(JSON.stringify(busy), deps(h))).toMatchObject({ reason: 'busy' })
      expect(statusOf(p, 'nuance', busy.id, now)).toMatchObject({ status: 'refused', reason: 'busy', detail: SEEN })
      const loggedOut = sampleRequest()
      gateStart(JSON.stringify(loggedOut), deps(h, { guiSessionIsMine: () => false }))
      expect(statusOf(p, 'nuance', loggedOut.id, now)).toMatchObject({ status: 'refused', reason: 'target_logged_out' })
      // Sending the refused id again is replayed, and that answer does not overwrite the first one's record.
      expect(gateStart(JSON.stringify(outside), deps(h))).toMatchObject({ reason: 'replayed' })
      expect(statusOf(p, 'nuance', outside.id, now)).toMatchObject({ status: 'refused', reason: 'outside_allowlist' })
      expect(existsSync(join(p.jobs, outside.id))).toBe(false) // a refused id never gets a job dir
      for (const f of readdirSync(p.seen)) expect(statSync(join(p.seen, f)).mode & 0o777).toBe(0o600)
    })
    test('a seen id with no recorded reason and no job is unknown, and claims no refusal (e.g. the gate threw after the claim)', () => {
      const p = summonPaths(targetHome()); const id = sampleRequest().id
      claimId(p.seen, id)
      const now = Date.now()
      for (const r of [statusOf(p, 'nuance', id, now), resultOf(p, 'nuance', id, now), requestCancel(p, 'nuance', id, now)]) {
        expect(r).toEqual({ status: 'unknown', detail: NO_DECISION })
      }
    })
    test('a seen marker that holds anything but a refusal reason is never echoed', () => {
      const p = summonPaths(targetHome()); const id = sampleRequest().id
      claimId(p.seen, id)
      writeFileSync(join(p.seen, id), 'SECRET prompt text')
      const r = statusOf(p, 'nuance', id, Date.now())
      expect(r).toEqual({ status: 'unknown', detail: NO_DECISION })
    })
  })
  describe('F04: Nuance logs an admission before it acts on it', () => {
    const ledgerOf = (h: string): any[] => readFileSync(summonPaths(h).ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    test('a ledger that cannot be written stops the admission before state.json or the spool marker exist', () => {
      const h = targetHome(); const p = summonPaths(h); const req = sampleRequest()
      mkdirSync(p.ledger, { recursive: true }) // every append now fails (EISDIR)
      expect(() => gateStart(JSON.stringify(req), deps(h))).toThrow()
      expect(existsSync(join(p.jobs, req.id))).toBe(false)
      expect(existsSync(join(p.spool, req.id))).toBe(false)
    })
    test('review #5: state.json is written before request.json, and the spool marker last', () => {
      const h = targetHome(); const p = summonPaths(h); const req = sampleRequest()
      expect(gateStart(JSON.stringify(req), deps(h)).status).toBe('admitted')
      // tmp + rename keeps each file's birth time from when it was written; APFS keeps it in nanoseconds.
      const born = (f: string) => statSync(f, { bigint: true }).birthtimeNs
      const dir = join(p.jobs, req.id)
      expect(born(join(dir, 'state.json')) < born(join(dir, 'request.json'))).toBe(true)
      expect(born(join(dir, 'request.json')) < born(join(p.spool, req.id))).toBe(true)
    })
    test('a later admission write that fails is ledgered admission_failed (id only), its job dir is removed, and the answer is unknown', () => {
      const h = targetHome(); const p = summonPaths(h); const req = sampleRequest()
      mkdirSync(p.state, { recursive: true, mode: 0o700 })
      writeFileSync(p.spool, 'a file where the spool directory should be')
      const r = gateStart(JSON.stringify(req), deps(h))
      expect(r).toEqual({ status: 'unknown', detail: 'admission did not complete (EEXIST); nothing was spooled' })
      expect(existsSync(join(p.jobs, req.id))).toBe(false)
      const entries = ledgerOf(h)
      expect(entries.map((e) => [e.event, e.id])).toEqual([['admitted', req.id], ['admission_failed', req.id]])
      expect(Object.keys(entries[1]).sort()).toEqual(['event', 'hash', 'id', 'prev', 'ts'])
      expect(verifyLedger(p.ledger)).toEqual({ ok: true, entries: 2 })
      expect(statusOf(p, 'nuance', req.id, Date.now())).toMatchObject({ status: 'unknown' })
      // Nothing was left to count as active: the next request is admitted once the spool can be made.
      rmSync(p.spool)
      expect(gateStart(JSON.stringify(sampleRequest()), deps(h)).status).toBe('admitted')
    })
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

describe('F19: the admitted entry records origin and effort, and origin never decides', () => {
  const ledger = (h: string) => readFileSync(join(h, '.local/state/summon/ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  test('admitted carries the admitted effort and the origin string', () => {
    const h = targetHome(DEFAULT_ALLOWLIST.replace('{ model: sonnet }', '{ model: sonnet, effort: [high] }'))
    const req = sampleRequest({ effort: 'high', origin: { harness: 'claude-code', pid: 4242, started_at: '2026-10-11T00:38:43.000Z' } })
    expect(gateStart(JSON.stringify(req), deps(h)).status).toBe('admitted')
    expect(ledger(h)).toEqual([expect.objectContaining({ event: 'admitted', id: req.id, model: 'sonnet', effort: 'high', access: 'review',
      origin: 'claude-code pid 4242 started 2026-10-11T00:38:43.000Z' })])
  })
  test('requests that differ only in origin get the same decision', () => {
    for (const origin of [undefined, { harness: 'codex', pid: 1 }, { harness: 'shell' }, { harness: 'claude-code', pid: 99, started_at: '2026-01-01T00:00:00Z' }]) {
      const h = targetHome()
      expect(gateStart(JSON.stringify(sampleRequest(origin ? { origin } : {})), deps(h)).status).toBe('admitted')
      expect(gateStart(JSON.stringify(sampleRequest({ cwd: '~/Elsewhere', ...(origin ? { origin } : {}) })), deps(h))).toMatchObject({ reason: 'outside_allowlist' })
    }
  })
})

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLOCK_SKEW_MS, ID_RE, MAX_PROMPT_BYTES, checkTiming, newRequestId, originTag, validateRequest,
} from '../src/request.ts'
import { canonicalJson } from '../src/json.ts'
import { sampleRequest } from './helpers.ts'

describe('newRequestId', () => {
  test('is smn_ + 32 lowercase hex with a UUIDv7 version nibble', () => {
    const id = newRequestId(1_791_600_000_000)
    expect(id).toMatch(ID_RE)
    expect(id[4 + 12]).toBe('7')
  })
  test('sorts by time', () => {
    expect(newRequestId(1000) < newRequestId(2000)).toBe(true)
  })
})

describe('validateRequest', () => {
  test('accepts a well-formed request', () => {
    const r = validateRequest(JSON.stringify(sampleRequest()))
    expect(r.ok).toBe(true)
  })
  test('refuses unknown fields (closed schema)', () => {
    const r = validateRequest(JSON.stringify({ ...sampleRequest(), shell: 'ls' }))
    expect(r).toMatchObject({ ok: false, reason: 'malformed' })
  })
  test('refuses non-JSON and non-objects', () => {
    expect(validateRequest('nope')).toMatchObject({ ok: false, reason: 'malformed' })
    expect(validateRequest('[1]')).toMatchObject({ ok: false, reason: 'malformed' })
  })
  test('refuses mode live in Phase 0', () => {
    expect(validateRequest(JSON.stringify(sampleRequest({ mode: 'live' as never })))).toMatchObject({ ok: false, reason: 'malformed' })
  })
  test('refuses a bad id, device, cwd, access or timeout', () => {
    for (const over of [
      { id: 'smn_../../etc' }, { from_device: 'Air' }, { cwd: 'relative/path' }, { cwd: '~/x\u0007' },
      { access: 'admin' }, { timeout_s: 0 }, { timeout_s: 1.5 }, { model: 'son net' },
    ]) {
      expect(validateRequest(JSON.stringify(sampleRequest(over as never)))).toMatchObject({ ok: false, reason: 'malformed' })
    }
  })
  test('refuses impossible calendar dates in issued_at and expires_at', () => {
    for (const over of [{ issued_at: '2026-02-31T00:00:00Z' }, { expires_at: '2026-02-29T00:00:00Z' }, { expires_at: '2026-04-31T12:00:00.5Z' }]) {
      expect(validateRequest(JSON.stringify(sampleRequest(over as never)))).toMatchObject({ ok: false, reason: 'malformed' })
    }
    expect(validateRequest(JSON.stringify(sampleRequest({ expires_at: '2028-02-29T00:00:00Z' } as never))).ok).toBe(true)
  })
  test('refuses control characters in cwd and label, including tab, LF and CR', () => {
    for (const over of [{ cwd: '~/x\n' }, { cwd: '~/x\t' }, { cwd: '~/x\r' }, { label: 'a\nb' }, { label: 'a\tb' }]) {
      expect(validateRequest(JSON.stringify(sampleRequest(over as never)))).toMatchObject({ ok: false, reason: 'malformed' })
    }
  })
  test('decides the prompt limit by UTF-8 bytes (multibyte)', () => {
    const cjk = '愛'.repeat(Math.floor(MAX_PROMPT_BYTES / 3)) // 3 bytes each
    const atLimit = cjk + 'a'.repeat(MAX_PROMPT_BYTES - Buffer.byteLength(cjk))
    expect(Buffer.byteLength(atLimit)).toBe(MAX_PROMPT_BYTES)
    expect(validateRequest(JSON.stringify(sampleRequest({ prompt: atLimit }))).ok).toBe(true)
    expect(validateRequest(JSON.stringify(sampleRequest({ prompt: atLimit + 'a' })))).toMatchObject({ ok: false, reason: 'too_large' })
  })
  test('refuses a raw request over 160 KiB before parsing', () => {
    expect(validateRequest('x'.repeat(160 * 1024 + 1))).toMatchObject({ ok: false, reason: 'too_large' })
  })
})

describe('checkTiming', () => {
  test('admits a fresh request and clamps the timeout', () => {
    const r = sampleRequest({ timeout_s: 86_400 })
    const t = checkTiming(r, Date.parse(r.issued_at), 1800)
    expect(t).toMatchObject({ ok: true, timeoutS: 1800 })
  })
  test('refuses an expired request', () => {
    const r = sampleRequest()
    const t = checkTiming(r, Date.parse(r.expires_at) + CLOCK_SKEW_MS + 1, 1800)
    expect(t).toMatchObject({ ok: false, reason: 'expired' })
  })
  test('refuses a request issued too far in the future (clock)', () => {
    const r = sampleRequest()
    const t = checkTiming(r, Date.parse(r.issued_at) - CLOCK_SKEW_MS - 1, 1800)
    expect(t).toMatchObject({ ok: false, reason: 'clock' })
  })
  test('clamps admission to 24 h', () => {
    const now = Date.now()
    const r = sampleRequest({ issued_at: new Date(now).toISOString(), expires_at: new Date(now + 72 * 3_600_000).toISOString() })
    const t = checkTiming(r, now + 25 * 3_600_000 + CLOCK_SKEW_MS, 1800)
    expect(t).toMatchObject({ ok: false, reason: 'expired' })
  })
})

describe('canonicalJson', () => {
  test('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"x":2,"y":1}]},"b":1}')
  })
})

describe('F19: origin', () => {
  test('origin.started_at is RFC 3339 UTC, as the CLI sends it, or absent', () => {
    expect(validateRequest(JSON.stringify(sampleRequest({ origin: { harness: 'claude-code', pid: 4242, started_at: '2026-10-11T00:38:43.000Z' } }))).ok).toBe(true)
    expect(validateRequest(JSON.stringify(sampleRequest({ origin: { harness: 'shell', pid: 1 } }))).ok).toBe(true)
    for (const started_at of ['Sat Oct 10 12:00:00 2026', '2026-10-11', '2026-02-31T00:00:00Z', '2026-10-11T00:38:43+01:00', 7]) {
      expect(validateRequest(JSON.stringify(sampleRequest({ origin: { harness: 'shell', pid: 1, started_at } as never }))))
        .toMatchObject({ ok: false, reason: 'malformed', detail: 'origin.started_at' })
    }
  })
  test('originTag flattens it to one bounded ledger string: harness kind, pid, start', () => {
    expect(originTag({ harness: 'claude-code', pid: 4242, started_at: '2026-10-11T00:38:43.000Z' })).toBe('claude-code pid 4242 started 2026-10-11T00:38:43.000Z')
    expect(originTag({ harness: 'codex', pid: 7 })).toBe('codex pid 7')
    expect(originTag({ pid: 7 })).toBe('pid 7')
    expect(originTag({})).toBeUndefined()
    expect(originTag(undefined)).toBeUndefined()
    expect(originTag({ harness: 'h'.repeat(300), pid: 1 })!.length).toBe(200)
  })
})

describe('Phase 0.5: the build access in the request', () => {
  const send = (over: Record<string, unknown>) => validateRequest(JSON.stringify({ ...sampleRequest(), ...over }))

  test('access: build is accepted, with review and edit', () => {
    for (const access of ['review', 'edit', 'build']) expect([access, send({ access }).ok]).toEqual([access, true])
    expect(send({ access: 'build' })).toMatchObject({ ok: true, request: { access: 'build' } })
  })
  test('other accesses are still malformed', () => {
    for (const access of ['admin', 'Build', 'BUILD', 'builder', 'build ', '', null, 2, ['build'], { build: true }]) {
      expect([access, send({ access })]).toEqual([access, { ok: false, reason: 'malformed', detail: 'access' }])
    }
  })
  test('a request never carries commands or sandbox fields: each is malformed, on any access', () => {
    for (const access of ['review', 'edit', 'build']) {
      for (const extra of [{ commands: [{ run: 'bun test' }] }, { commands: [] }, { sandbox: { enabled: false } }, { sandbox: false }, { sandbox_write: ['/tmp'] },
        { local_binding: true }, { allowedTools: ['Bash'] }, { run: 'bun test' }]) {
        expect([access, Object.keys(extra)[0], send({ access, ...extra })]).toEqual([access, Object.keys(extra)[0],
          { ok: false, reason: 'malformed', detail: `unknown field: ${Object.keys(extra)[0]}` }])
      }
    }
  })

  // A Nuance runner that has not been updated has Phase 0's validator. The design promises that it refuses access: build
  // as malformed, a definite refusal, so this pins it against the real Phase 0 file rather than a copy of its rule.
  test('the Phase 0 validator (5958f271) refuses a build request as malformed, and still takes review and edit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'summon-old-request-'))
    try {
      const git = Bun.spawnSync(['git', 'show', '5958f271:packages/summon/src/request.ts'], { cwd: import.meta.dir })
      expect(git.exitCode).toBe(0)
      const file = join(dir, 'request-phase0.ts')
      writeFileSync(file, git.stdout)
      const old: { validateRequest: typeof validateRequest } = await import(file)
      expect(old.validateRequest(JSON.stringify(sampleRequest({ access: 'build' })))).toEqual({ ok: false, reason: 'malformed', detail: 'access' })
      expect(old.validateRequest(JSON.stringify(sampleRequest({ access: 'review' }))).ok).toBe(true)
      expect(old.validateRequest(JSON.stringify(sampleRequest({ access: 'edit' }))).ok).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

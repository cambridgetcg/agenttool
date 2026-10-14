import { describe, expect, test } from 'bun:test'
import { DialPolicy, ZSHENV_HINT, type DialDecision } from '../src/air/dialer.ts'
import type { DialFailure } from '../src/air/ssh.ts'
import type { StickyWarning } from '../src/air/status.ts'

const START = Date.parse('2026-10-13T12:00:00.000Z')
const FP = 'SHA256:C/JQOifBld6TAkrNhJn6UfvfParPv6E5xha7zm1I9/A'
const MIN = 60_000
const TIMEOUT: DialFailure = { status: 'unreachable', reason: 'timeout', detail: 'ssh: connect to host nuance.local port 22: Operation timed out' }
const MISMATCH: DialFailure = { status: 'host_key_mismatch', detail: `Host key verification failed. Presented ED25519 key: ${FP}`, fingerprint: FP }

/** A policy on a fake monotonic clock (ms since START) and a fixed random draw. */
function policy(o: { rand?: number; sticky?: StickyWarning[] } = {}) {
  let mono = 0
  const p = new DialPolicy({ mono: () => mono, now: () => new Date(START + mono), rand: () => o.rand ?? 0.5, sticky: o.sticky })
  return { p, at: (ms: number) => { mono = ms }, advance: (ms: number) => { mono += ms }, now: () => mono }
}
const waitOf = (d: DialDecision) => {
  if (d.action !== 'wait') throw new Error(`expected wait, got ${JSON.stringify(d)}`)
  return d
}

describe('DialPolicy', () => {
  test('backs off 5, 10, 20, 40, then 60 s, each within ±20%', () => {
    const steps = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000]
    for (const [rand, factor] of [[0.5, 1], [0, 0.8], [0.999999, 1.2]] as const) {
      const { p, advance } = policy({ rand })
      const got = steps.map(() => { const d = waitOf(p.onFailure(TIMEOUT)); advance(d.delayMs); return d.delayMs })
      for (const [i, base] of steps.entries()) expect([rand, i, got[i]! / base]).toEqual([rand, i, expect.closeTo(factor, 3)])
    }
    const { p } = policy()
    expect(p.onFailure(TIMEOUT)).toEqual({ action: 'wait', delayMs: 5_000, word: 'connecting', reason: 'timeout', hint: null })
  })

  test('resets after 60 s up', () => {
    for (const [upFor, next] of [[59_000, 60_000], [60_000, 5_000]] as const) {
      const { p, advance } = policy()
      for (let i = 0; i < 4; i++) advance(waitOf(p.onFailure(TIMEOUT)).delayMs) // 5, 10, 20, 40 s used
      p.onUp()
      advance(upFor)
      expect(waitOf(p.onDrop()).delayMs).toBe(0) // the one immediate redial
      expect([upFor, waitOf(p.onFailure(TIMEOUT)).delayMs]).toEqual([upFor, next])
    }
  })

  test('redials at once after a drop from up, at most once per 10 minutes', () => {
    const { p, at } = policy()
    p.onUp()
    at(70_000)
    expect(p.onDrop()).toEqual({ action: 'wait', delayMs: 0, word: 'connecting', reason: 'link_dropped', hint: null })
    at(71_000)
    p.onUp()
    at(200_000) // up 129 s, so the backoff was reset; but the immediate redial was used 130 s ago
    expect(p.onDrop()).toEqual({ action: 'wait', delayMs: 5_000, word: 'connecting', reason: 'link_dropped', hint: null })
    at(205_000)
    p.onUp()
    at(70_000 + 10 * MIN) // 10 minutes after the last immediate redial
    expect(waitOf(p.onDrop()).delayMs).toBe(0)
  })

  test('goes away after 10 minutes of failures with a 15-minute cap', () => {
    const { p, now, advance } = policy()
    const seen: Array<{ t: number; d: DialDecision & { action: 'wait' } }> = []
    while (now() < 3 * 60 * MIN) {
      const d = waitOf(p.onFailure(TIMEOUT))
      seen.push({ t: now(), d })
      advance(d.delayMs)
    }
    for (const { t, d } of seen) expect([t, d.word]).toEqual([t, t >= 10 * MIN ? 'away' : 'connecting'])
    const away = seen.filter((s) => s.d.word === 'away').map((s) => s.d.delayMs)
    expect(away.slice(0, 5)).toEqual([120_000, 240_000, 480_000, 900_000, 900_000])
    expect(Math.max(...seen.map((s) => s.d.delayMs))).toBe(900_000)
    // A sleeping Nuance is dialled about 4 times an hour (spec §9.7).
    expect(seen.filter((s) => s.t >= 2 * 60 * MIN && s.t < 3 * 60 * MIN).length).toBe(4)
  })

  test('auth_refused, config and login_shell_noise stop', () => {
    const cases: Array<[DialFailure | { kind: 'login_shell_noise' }, 'auth_refused' | 'config' | 'login_shell_noise']> = [
      [{ status: 'auth_refused', detail: 'macair@nuance.local: Permission denied (publickey).' }, 'auth_refused'],
      [{ status: 'config', detail: "Can't open user config file /x: No such file or directory" }, 'config'],
      [{ kind: 'login_shell_noise' }, 'login_shell_noise'],
    ]
    for (const [f, reason] of cases) expect(policy().p.onFailure(f)).toEqual({ action: 'stop', word: 'needs_yu', reason })
  })

  test("the gate's exit 64 stops the loop as needs Yu: config", () => {
    expect(policy().p.onFailure({ kind: 'gate_refused', detail: 'collab-bridge gate: refused' })).toEqual({ action: 'stop', word: 'needs_yu', reason: 'config' })
  })

  test('a host-key mismatch retries at the cap and never stops', () => {
    const { p, advance } = policy()
    const first = waitOf(p.onFailure(MISMATCH))
    expect(first).toEqual({ action: 'wait', delayMs: 60_000, word: 'host_key_mismatch', reason: 'host_key_mismatch', hint: null })
    for (let i = 0; i < 10; i++) {
      advance(31 * MIN) // never three within 30 minutes; after 10 minutes of failures the away cap applies
      expect(waitOf(p.onFailure(MISMATCH))).toEqual({ action: 'wait', delayMs: 900_000, word: 'host_key_mismatch', reason: 'host_key_mismatch', hint: null })
    }
    // A plain failure after a mismatch stays at the cap instead of starting over at 5 s.
    const fresh = policy()
    fresh.p.onFailure(MISMATCH)
    fresh.advance(MIN)
    expect(waitOf(fresh.p.onFailure(TIMEOUT)).delayMs).toBe(60_000)
  })

  test('three mismatches within 30 minutes escalate to needs Yu: host_key_mismatch', () => {
    const { p, at } = policy()
    expect(waitOf(p.onFailure(MISMATCH)).word).toBe('host_key_mismatch')
    at(MIN)
    expect(waitOf(p.onFailure(MISMATCH)).word).toBe('host_key_mismatch')
    at(2 * MIN)
    expect(p.onFailure(MISMATCH)).toEqual({ action: 'wait', delayMs: 60_000, word: 'needs_yu', reason: 'host_key_mismatch', hint: null })
    // Spaced 16 and 15 minutes apart, only two fall inside any 30 minutes.
    const spaced = policy()
    spaced.p.onFailure(MISMATCH)
    spaced.at(16 * MIN)
    spaced.p.onFailure(MISMATCH)
    spaced.at(31 * MIN)
    expect(waitOf(spaced.p.onFailure(MISMATCH)).word).toBe('host_key_mismatch')
  })

  test('a good dial after a mismatch is up with the sticky warning kept', () => {
    const { p, at } = policy()
    at(5_000)
    p.onFailure(MISMATCH)
    at(70_000)
    p.onFailure(MISMATCH) // the same key again: still one warning, at its latest time
    at(130_000)
    p.onUp()
    expect(p.sticky()).toEqual([{ kind: 'host_key_mismatch', at: new Date(START + 70_000).toISOString(), fingerprint: FP }])
  })

  test('a sticky passed to the constructor survives a good dial, and a new mismatch is added after it', () => {
    const old: StickyWarning = { kind: 'host_key_mismatch', at: '2026-10-13T09:00:00.000Z', fingerprint: FP }
    const { p, at } = policy({ sticky: [old] })
    expect(p.sticky()).toEqual([old])
    p.onUp()
    expect(p.sticky()).toEqual([old])
    at(MIN)
    p.onFailure({ ...MISMATCH, fingerprint: null })
    const fresh: StickyWarning = { kind: 'host_key_mismatch', at: new Date(START + MIN).toISOString(), fingerprint: null }
    expect(p.sticky()).toEqual([old, fresh])
  })

  test('three silent dials in a row show the zshenv hint', () => {
    const { p } = policy()
    const silent = { kind: 'preamble_timeout' } as const
    expect(waitOf(p.onFailure(silent)).hint).toBeNull()
    expect(waitOf(p.onFailure(silent)).hint).toBeNull()
    expect(waitOf(p.onFailure(silent))).toMatchObject({ word: 'connecting', reason: 'preamble_timeout', hint: ZSHENV_HINT })
    expect(ZSHENV_HINT).toBe('no preamble; check ~/.zshenv')
    expect(waitOf(p.onFailure(silent)).hint).toBe(ZSHENV_HINT)
    expect(waitOf(p.onFailure(TIMEOUT)).hint).toBeNull() // any other outcome ends the run
    expect(waitOf(p.onFailure(silent)).hint).toBeNull()
  })

  test('four relay_replaced within 10 minutes make noteRelayReplaced true, three do not', () => {
    const { p, at } = policy()
    for (const [t, want] of [[0, false], [MIN, false], [2 * MIN, false], [3 * MIN, true]] as const) {
      at(t)
      expect([t, p.noteRelayReplaced()]).toEqual([t, want])
    }
    const spaced = policy()
    for (const [t, want] of [[0, false], [4 * MIN, false], [8 * MIN, false], [11 * MIN, false]] as const) {
      spaced.at(t)
      expect([t, spaced.p.noteRelayReplaced()]).toEqual([t, want])
    }
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, rmSync, utimesSync } from 'node:fs'
import { bridgeFailure } from '../src/failure.ts'
import type { ToolResult } from '../src/link/messages.ts'
import { lineageKey } from '../src/proc.ts'
import { toolsDigest } from '../src/tools-digest.ts'
import { unresolved } from '../src/nuance/inflight.ts'
import { openLineage } from '../src/nuance/lineage.ts'
import { bunConnect, type Connect } from '../src/nuance/link-client.ts'
import { Pipe, runPipe, type PipeDeps } from '../src/nuance/pipe.ts'
import { makeFakeLink, makeStaleSocket, type FakeLink } from './fake-link.ts'
import { cleanupTmps, repoGit } from './helpers.ts'
import {
  codeOf, FAKE_HOST, fakeTable, ledgerEvents, nuanceFixture, pipeDeps, TEST_TOOLS, waitFor, written,
  type NuanceFixture, type TestPipeDeps,
} from './pipe-fixture.ts'

const KEY = lineageKey(FAKE_HOST.pid, FAKE_HOST.lstart)
const DIGEST = toolsDigest(TEST_TOOLS)
const OK: ToolResult = { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } }
/** The live Collab session every fake ready names unless a test says otherwise (P66). */
const SESSION = 'ses_1'
const HINT = { session_id: SESSION, workspace_id: 'ws_1' }
const pipes: Pipe[] = []
const links: FakeLink[] = []

afterEach(async () => {
  for (const p of pipes.splice(0)) await p.stop()
  for (const l of links.splice(0)) await l.close()
  cleanupTmps()
})

async function link(f: NuanceFixture, accept: Parameters<FakeLink['accept']>[0] | null = {}): Promise<FakeLink> {
  const l = await makeFakeLink(f.paths.hubSock)
  links.push(l)
  if (accept !== null) l.accept({ ...accept, ready: { tools_digest: DIGEST, session_hint: HINT, ...accept.ready } })
  return l
}

async function started(d: PipeDeps): Promise<Pipe> {
  const p = new Pipe(d)
  pipes.push(p)
  await p.start()
  return p
}

const calls = (l: FakeLink) => l.frames().filter((m) => m.t === 'call')
/** The handshake finished `n` times: the fake answered the n-th prove with ready, and the pipe has read it. */
async function attached(l: FakeLink, n = 1): Promise<void> {
  await waitFor(() => l.frames().filter((m) => m.t === 'prove').length >= n, 5000, `prove #${n}`)
  await Bun.sleep(100)
}
/** Calls collab_task_list until the pipe answers `code` (each refusal is not sent), and returns that answer. */
async function callUntil(p: Pipe, code: string, ms = 5000): Promise<ToolResult> {
  const end = Date.now() + ms
  for (;;) {
    const r = await p.handleCall(0, 'collab_task_list', {})
    if (codeOf(r) === code) return r
    if (Date.now() > end) throw new Error(`never answered ${code}; last ${codeOf(r)}`)
    await Bun.sleep(25)
  }
}
const resultFor = (ref: string, result: ToolResult = OK, outcome = 'ok') => ({ t: 'result', call_ref: ref, outcome, result })
/** The hub's answer for a call that reached a child and got no reply (§9.3 item 4). */
const unknownFor = (ref: string) => resultFor(ref, bridgeFailure('hub_outcome_unknown', 'The Air could not settle this call; it may have taken effect.', ref), 'unknown')
/** An error result from Collab itself (deliveredOf null), as the hub relays it with outcome error (P50). */
const collabError = (code: string, extra: Record<string, unknown> = {}): ToolResult => {
  const s = { error: code, message: 'Collab refused this call.', ...extra }
  return { content: [{ type: 'text', text: JSON.stringify(s, null, 2) }], structuredContent: s, isError: true }
}
/** Collab's session_start result, by the fields the pipe reads. */
const sessionStarted = (id: string): ToolResult => ({ content: [{ type: 'text', text: '{}' }], structuredContent: { session: { id }, workspace: { id: 'ws_1' } } })
const report = (key: string, body = 'the same words') => ({ workspace_id: 'ws_1', kind: 'observation', body, idempotency_key: key })
/** One call through the pipe, its frame answered by `answer`; returns the agent's result and the call_ref. */
async function exchange(p: Pipe, l: FakeLink, name: string, args: Record<string, unknown>, answer: (ref: string) => object): Promise<{ r: ToolResult; ref: string }> {
  const before = calls(l).length
  const pending = p.handleCall(0, name, args)
  const c = await waitFor(() => calls(l)[before], 5000, `call #${before + 1}`)
  const ref = c.call_ref as string
  l.send(answer(ref))
  return { r: await pending, ref }
}
/** A connect whose writes can be made to throw, or to see the socket gone the way bunConnect's flush does (write < 0). */
function failingConnect(mode: { now: 'off' | 'throw' | 'close' }): Connect {
  return async (path, h) => {
    const s = await bunConnect(path, h)
    return {
      write(b: Uint8Array) {
        if (mode.now === 'throw') throw new Error('EPIPE')
        if (mode.now === 'close') { s.end(); h.close(); return }
        s.write(b)
      },
      end() { s.end() },
    }
  }
}

describe('the pipe refuses before sending', () => {
  test('an unknown tool name is tool_not_available_remote', async () => {
    const f = nuanceFixture()
    const p = await started(pipeDeps(f))
    const r = await p.handleCall(1, 'collab_decision_record', {})
    expect(codeOf(r)).toBe('tool_not_available_remote')
    expect(r.structuredContent!.delivered).toBe(false)
  })

  test('answers hub_away with delivered:false when the hub is away', async () => {
    // No relay socket at all, then the stale hub.sock a SIGKILLed relay leaves (Review Focus 5): both are just away.
    for (const stale of [false, true]) {
      const f = nuanceFixture()
      if (stale) await makeStaleSocket(f.paths.hubSock)
      const p = await started(pipeDeps(f))
      const t0 = performance.now()
      const r = await p.handleCall(1, 'collab_task_list', {})
      expect(performance.now() - t0).toBeLessThan(1000)
      expect(codeOf(r)).toBe('hub_away')
      expect(r.structuredContent).toMatchObject({ delivered: false, retry: 'never automatic' })
      expect(r.structuredContent!.call_ref).toMatch(/^lin_[0-9a-f]{32}:[0-9a-f]{8}:0$/)
    }
  })

  test('a folder outside shares.json is folder_not_shared and never dials', async () => {
    const f = nuanceFixture({ shared: false })
    const l = await link(f)
    const p = await started(pipeDeps(f))
    expect(codeOf(await p.handleCall(1, 'collab_task_list', {}))).toBe('folder_not_shared')
    await Bun.sleep(300)
    expect(l.connections()).toBe(0)
  })

  test('sdk-cli, no claude host, and a missing entrypoint without a tty are harness_not_interactive', async () => {
    const f = nuanceFixture()
    const sdk = await started(pipeDeps(f, { env: { ...f.env, CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }))
    expect(codeOf(await sdk.handleCall(1, 'collab_session_start', { actor: 'a' }))).toBe('harness_not_interactive')
    const noHost = await started(pipeDeps(f, { table: () => fakeTable(process.pid, null) }))
    expect(noHost.lineageId()).toBeNull()
    expect(codeOf(await noHost.handleCall(1, 'collab_task_list', {}))).toBe('harness_not_interactive')
    const noTty = await started(pipeDeps(f, { env: { ...f.env }, ttyOf: () => null }))
    expect(codeOf(await noTty.handleCall(1, 'collab_session_start', { actor: 'a' }))).toBe('harness_not_interactive')
    const withTty = await started(pipeDeps(f, { env: { ...f.env }, ttyOf: () => 'ttys004' }))
    expect(codeOf(await withTty.handleCall(1, 'collab_session_start', { actor: 'a' }))).toBe('hub_away')
  })

  test('an unreadable git state is fetch_failed', async () => {
    const f = nuanceFixture({ gitRepo: false })
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const r = await p.handleCall(1, 'collab_task_claim', { workspace_id: 'ws_1', task_id: 't1', idempotency_key: 'k' })
    expect(codeOf(r)).toBe('fetch_failed')
    expect(r.structuredContent!.message).toBe("Could not read this folder's git state.")
    expect(calls(l)).toHaveLength(0)
    expect(unresolved(f.paths, KEY)).toHaveLength(0)
  })

  test('a call whose in-flight record cannot be written is refused, never sent', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    rmSync(f.paths.lineageFile(KEY))   // the record must exist before the write; a pipe never re-creates its lineage here
    const r = await p.handleCall(1, 'collab_report_append', report('k1'))
    expect(codeOf(r)).toBe('hub_away')
    expect(r.structuredContent!.delivered).toBe(false)
    expect(r.structuredContent!.message).toBe('This pipe could not record the call before sending it; nothing was sent.')
    await Bun.sleep(100)
    expect(calls(l)).toHaveLength(0)
  })

  test('a 3 MiB argument is frame_too_large, never written, and other in-flight calls are unaffected', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const small = p.handleCall(1, 'collab_task_list', { workspace_id: 'ws_1' })
    const [c] = await waitFor(() => calls(l).length === 1 && calls(l))
    const big = await p.handleCall(2, 'collab_report_append', { workspace_id: 'ws_1', idempotency_key: 'big', kind: 'observation', body: 'x'.repeat(3 * 1024 * 1024) })
    expect(codeOf(big)).toBe('frame_too_large')
    expect(big.structuredContent!.delivered).toBe(false)
    await Bun.sleep(100)
    expect(calls(l)).toHaveLength(1)
    l.send(resultFor(c!.call_ref as string))
    const r = await small
    expect(r).toEqual(OK)
    expect(unresolved(f.paths, KEY)).toHaveLength(0)
  })
})

describe('refusals from the hub', () => {
  test("a retired lineage's calls answer seat_session_ended", async () => {
    const f = nuanceFixture()
    await link(f, { refuse: 'seat_session_ended' })
    const p = await started(pipeDeps(f))
    const r = await callUntil(p, 'seat_session_ended')
    expect(r.structuredContent!.delivered).toBe(false)
  })

  test('lineage_cap from the hub answers lineage_cap', async () => {
    const f = nuanceFixture()
    await link(f, { refuse: 'lineage_cap' })
    const p = await started(pipeDeps(f))
    expect(codeOf(await callUntil(p, 'lineage_cap'))).toBe('lineage_cap')
  })

  test('folder_not_shared and frame_too_large from the hub answer their own codes', async () => {
    for (const code of ['folder_not_shared', 'frame_too_large'] as const) {
      const f = nuanceFixture()
      await link(f, { refuse: code })
      const p = await started(pipeDeps(f))
      expect(codeOf(await callUntil(p, code))).toBe(code)
    }
  })

  test('seat_proof_failed answers hub_away', async () => {
    const f = nuanceFixture()
    const l = await link(f, { refuse: 'seat_proof_failed' })
    const p = await started(pipeDeps(f))
    await waitFor(() => l.frames().some((m) => m.t === 'attach'))
    await Bun.sleep(150)
    expect(codeOf(await p.handleCall(1, 'collab_task_list', {}))).toBe('hub_away')
    expect(calls(l)).toHaveLength(0)
  })
})

describe('start-up', () => {
  test('pipe start removes a lineage file whose host is gone and older than 7 days, and keeps its own', async () => {
    const f = nuanceFixture()
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000)
    const gone = openLineage(f.paths, { pid: 999_999, lstart: 'Thu Jan 1 00:00:00 2026', comm: 'claude' }, () => old)
    utimesSync(f.paths.lineageFile(gone.key), old, old)
    const p = await started(pipeDeps(f))
    expect(existsSync(f.paths.lineageFile(gone.key))).toBe(false)
    expect(existsSync(f.paths.lineageFile(KEY))).toBe(true)
    expect(p.lineageId()).toMatch(/^lin_[0-9a-f]{32}$/)
  })

  test('call_refs are unique across two pipe instances of one lineage', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const a = await started(pipeDeps(f))
    const b = await started(pipeDeps(f))
    expect(a.lineageId()).toBe(b.lineageId()!)
    await attached(l, 2)
    void a.handleCall(1, 'collab_task_list', {})
    void b.handleCall(1, 'collab_task_list', {})
    const [x, y] = await waitFor(() => calls(l).length === 2 && calls(l))
    const prefix = `${a.lineageId()}:`
    expect(String(x!.call_ref).startsWith(prefix) && String(y!.call_ref).startsWith(prefix)).toBe(true)
    expect(x!.call_ref).not.toBe(y!.call_ref)
  })
})

describe('after the write', () => {
  test('a drop after the write answers hub_outcome_unknown at once', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const pending = p.handleCall(1, 'collab_report_append', report('k1'))
    const [c] = await waitFor(() => calls(l).length === 1 && calls(l))
    const t0 = performance.now()
    l.dropConnection()
    const r = await pending
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(codeOf(r)).toBe('hub_outcome_unknown')
    expect(r.structuredContent!.delivered).toBe('unknown')
    expect(unresolved(f.paths, KEY).map((x) => x.call_ref)).toEqual([c!.call_ref as string])
    expect(unresolved(f.paths, KEY)[0]!.session_id).toBe(SESSION)
  })

  test('a read dropped after the write answers hub_outcome_unknown and leaves no record (P65)', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const pending = p.handleCall(1, 'collab_task_list', {})
    await waitFor(() => calls(l).length === 1)
    l.dropConnection()
    const r = await pending
    expect(codeOf(r)).toBe('hub_outcome_unknown')
    expect(r.structuredContent!.prior_unknown).toBeUndefined()
    expect(unresolved(f.paths, KEY)).toEqual([])
    expect(ledgerEvents(f.paths)).toContain('call_unknown')
  })

  test('a call past its deadline answers hub_outcome_unknown, never error, and a late result keeps the record', async () => {
    const f = nuanceFixture({ env: { COLLAB_BRIDGE_TEST_TIME_SCALE: '0.01' } })
    const l = await link(f)
    const pinger = setInterval(() => l.ping(), 40)
    try {
      const p = await started(pipeDeps(f))
      await attached(l)
      const t0 = performance.now()
      const pending = p.handleCall(1, 'collab_report_append', report('k1'))
      const [c] = await waitFor(() => calls(l).length === 1 && calls(l))
      expect(c!.timeout_ms).toBe(600)
      const r = await pending
      expect(performance.now() - t0).toBeGreaterThanOrEqual(550)
      expect(codeOf(r)).toBe('hub_outcome_unknown')
      expect(r.isError).toBe(true)
      l.send(resultFor(c!.call_ref as string))
      await waitFor(() => ledgerEvents(f.paths).includes('late_result'))
      expect(unresolved(f.paths, KEY).map((x) => x.call_ref)).toEqual([c!.call_ref as string])
    } finally {
      clearInterval(pinger)
    }
  })

  test('claim and complete carry declared and the long deadline', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const head = repoGit(f.share, ['rev-parse', 'HEAD']) // Task 27: a scrubbed env, cwd '/', throws on a non-zero exit
    expect(head).toMatch(/^[0-9a-f]{40}$/)
    void p.handleCall(1, 'collab_task_claim', { workspace_id: 'ws_1', task_id: 't1', idempotency_key: 'k1', expected_version: 1 })
    void p.handleCall(2, 'collab_task_complete', { workspace_id: 'ws_1', task_id: 't1', idempotency_key: 'k2', expected_version: 2 })
    void p.handleCall(3, 'collab_task_recover', { workspace_id: 'ws_1', task_id: 't2', idempotency_key: 'k3', expected_version: 3, recovery_note: 'n' })
    void p.handleCall(4, 'collab_task_recover', { workspace_id: 'ws_1', task_id: 't3', idempotency_key: 'k4', expected_version: 4, recovery_note: 'n', action: 'release' })
    void p.handleCall(5, 'collab_task_list', {})
    const cs = await waitFor(() => calls(l).length === 5 && calls(l))
    const by = (name: string, i = 0) => cs.filter((c) => c.name === name)[i]!
    for (const name of ['collab_task_claim', 'collab_task_complete']) {
      expect(by(name).declared).toEqual({ head, branch: 'main', dirty: false })
      expect(by(name).timeout_ms).toBe(150_000)
    }
    expect(by('collab_task_recover', 0).declared).toEqual({ head, branch: 'main', dirty: false })
    expect(by('collab_task_recover', 0).timeout_ms).toBe(60_000)
    expect(by('collab_task_recover', 1).declared).toBeUndefined()
    expect(by('collab_task_list').declared).toBeUndefined()
    expect(by('collab_task_list').timeout_ms).toBe(60_000)
  })

  test('a pipe killed mid-call and respawned carries prior_unknown on its next call', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const first = await started(pipeDeps(f))
    await attached(l)
    void first.handleCall(1, 'collab_report_append', { workspace_id: 'ws_1', idempotency_key: 'k1', kind: 'observation', body: 'hi' })
    const [a] = await waitFor(() => calls(l).length === 1 && calls(l))
    await first.stop()   // the process is gone; its in-flight record stays on disk
    const second = await started(pipeDeps(f))
    await attached(l, 2)
    const next = second.handleCall(1, 'collab_task_list', {})
    const [, b] = await waitFor(() => calls(l).length === 2 && calls(l))
    l.send(resultFor(b!.call_ref as string))
    const r = await next
    expect(r.structuredContent!.prior_unknown).toEqual([{ call_ref: a!.call_ref, tool: 'collab_report_append', idempotency_key: 'k1', session_ended: false }])
    expect(r.content).toHaveLength(2)
    expect(r.content[0]).toEqual(OK.content[0]!)
  })

  test('a re-send that changes only the key is refused prior_outcome_unknown, and the same-key replay clears it', async () => {
    const f = nuanceFixture({ env: { COLLAB_BRIDGE_TEST_TIME_SCALE: '0.25' } })
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const body = { workspace_id: 'ws_1', kind: 'observation', body: 'the same words' }
    const first = p.handleCall(1, 'collab_report_append', { ...body, idempotency_key: 'k1' })
    await waitFor(() => calls(l).length === 1)
    l.dropConnection()
    expect(codeOf(await first)).toBe('hub_outcome_unknown')
    await attached(l, 2)
    const second = await p.handleCall(2, 'collab_report_append', { ...body, idempotency_key: 'k2' })
    expect(codeOf(second)).toBe('prior_outcome_unknown')
    expect(second.structuredContent!.prior_idempotency_key).toBe('k1')
    expect(second.structuredContent!.message).toContain('"k1"')
    expect(calls(l)).toHaveLength(1)
    const replay = p.handleCall(3, 'collab_report_append', { ...body, idempotency_key: 'k1' })
    const [, c] = await waitFor(() => calls(l).length === 2 && calls(l))
    l.send(resultFor(c!.call_ref as string))
    expect(await replay).toEqual(OK)
    expect(unresolved(f.paths, KEY)).toEqual([])
  })

  test('a hub refusal of a same-key replay clears only the replay; the key-only re-send stays prior_outcome_unknown', async () => {
    const f = nuanceFixture({ env: { COLLAB_BRIDGE_TEST_TIME_SCALE: '0.25' } })
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const body = { workspace_id: 'ws_1', kind: 'observation', body: 'the same words' }
    const first = p.handleCall(1, 'collab_report_append', { ...body, idempotency_key: 'k1' })
    const [a] = await waitFor(() => calls(l).length === 1 && calls(l))
    l.dropConnection()
    expect(codeOf(await first)).toBe('hub_outcome_unknown')
    await attached(l, 2)
    const replay = p.handleCall(2, 'collab_report_append', { ...body, idempotency_key: 'k1' })
    const [, c] = await waitFor(() => calls(l).length === 2 && calls(l))
    const ref = c!.call_ref as string
    l.send(resultFor(ref, bridgeFailure('rate_limited', 'Too many changes; nothing was sent.', ref), 'error'))
    const r = await replay
    expect(codeOf(r)).toBe('rate_limited')
    expect(r.structuredContent!.prior_unknown).toEqual([{ call_ref: a!.call_ref, tool: 'collab_report_append', idempotency_key: 'k1', session_ended: false }])
    expect(unresolved(f.paths, KEY).map((x) => x.call_ref)).toEqual([a!.call_ref as string])
    const resend = await p.handleCall(3, 'collab_report_append', { ...body, idempotency_key: 'k2' })
    expect(codeOf(resend)).toBe('prior_outcome_unknown')
    expect(resend.structuredContent!.prior_idempotency_key).toBe('k1')
    expect(calls(l)).toHaveLength(2)
  })

  test('a definite read settles nothing: a key-only re-send of an unknown report stays prior_outcome_unknown (P65)', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const first = await exchange(p, l, 'collab_report_append', report('k1'), unknownFor)
    expect(codeOf(first.r)).toBe('hub_outcome_unknown')
    const read = await exchange(p, l, 'collab_task_list', {}, (ref) => resultFor(ref))
    expect(read.r.content[0]).toEqual(OK.content[0]!)
    expect(read.r.structuredContent!.prior_unknown).toEqual([{ call_ref: first.ref, tool: 'collab_report_append', idempotency_key: 'k1', session_ended: false }])
    const resend = await p.handleCall(9, 'collab_report_append', report('k2'))
    expect(codeOf(resend)).toBe('prior_outcome_unknown')
    expect(resend.structuredContent!.prior_idempotency_key).toBe('k1')
    expect(calls(l)).toHaveLength(2)
  })

  test('64 unknown records: a read still passes, a same-key replay passes and settles one, and only a 65th record is rate_limited (P65)', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const answers = Array.from({ length: 64 }, (_, i) => p.handleCall(i, 'collab_report_append', report(`k${i}`, `note ${i}`)))
    const sent = await waitFor(() => calls(l).length === 64 && calls(l))
    for (const c of sent) l.send(unknownFor(c.call_ref as string))
    for (const a of answers) expect(codeOf(await a)).toBe('hub_outcome_unknown')
    expect(unresolved(f.paths, KEY)).toHaveLength(64)
    const read = await exchange(p, l, 'collab_task_list', {}, (ref) => resultFor(ref))
    expect(read.r.content[0]).toEqual(OK.content[0]!)
    expect(read.r.structuredContent!.prior_unknown).toHaveLength(64)
    const replay = await exchange(p, l, 'collab_report_append', report('k0', 'note 0'), (ref) => resultFor(ref))
    expect(replay.r.content[0]).toEqual(OK.content[0]!)
    expect(unresolved(f.paths, KEY)).toHaveLength(63)
    expect(unresolved(f.paths, KEY).some((x) => x.idempotency_key === 'k0')).toBe(false)
    const another = await exchange(p, l, 'collab_report_append', report('k64', 'note 64'), unknownFor)
    expect(codeOf(another.r)).toBe('hub_outcome_unknown')
    expect(unresolved(f.paths, KEY)).toHaveLength(64)
    const capped = await p.handleCall(99, 'collab_report_append', report('k65', 'note 65'))
    expect(codeOf(capped)).toBe('rate_limited')
    expect(capped.structuredContent!.message).toBe('Too many earlier calls of this session have no known outcome; check them with a read tool, or replay one with its own idempotency_key.')
    expect(calls(l)).toHaveLength(67)
  })

  test("unknown session_starts make an earlier unknown un-replayable until Collab's session_already_bound names the session again (P65, P66)", async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const first = await exchange(p, l, 'collab_report_append', report('k1'), unknownFor)
    for (let i = 0; i < 2; i++) expect(codeOf((await exchange(p, l, 'collab_session_start', { actor: 'a' }, unknownFor)).r)).toBe('hub_outcome_unknown')
    // An unknown session_start may have begun a new session (§9.3 item 8): the old unknown is not advised for a replay.
    const stale = await p.handleCall(9, 'collab_report_append', report('k1'))
    expect(codeOf(stale)).toBe('prior_outcome_unknown')
    expect(calls(l)).toHaveLength(3)
    expect(unresolved(f.paths, KEY).map((x) => x.tool)).toEqual(['collab_report_append', 'collab_session_start', 'collab_session_start'])
    const bound = await exchange(p, l, 'collab_session_start', { actor: 'a' }, (ref) => resultFor(ref, collabError('session_already_bound', { session_id: SESSION }), 'error'))
    expect(codeOf(bound.r)).toBe('session_already_bound')
    expect(unresolved(f.paths, KEY).map((x) => x.call_ref)).toEqual([first.ref])
    const replay = await exchange(p, l, 'collab_report_append', report('k1'), (ref) => resultFor(ref))
    expect(calls(l)).toHaveLength(5)
    expect(replay.r).toEqual(OK)
    expect(unresolved(f.paths, KEY)).toEqual([])
  })

  test('after session_end and a new session, an unknown report is never advised for a replay (P66)', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const first = await exchange(p, l, 'collab_report_append', report('k1'), unknownFor)
    await exchange(p, l, 'collab_session_end', {}, (ref) => resultFor(ref))
    const restarted = await exchange(p, l, 'collab_session_start', { actor: 'a' }, (ref) => resultFor(ref, sessionStarted('ses_2')))
    const stale = [{ call_ref: first.ref, tool: 'collab_report_append', idempotency_key: 'k1', session_ended: true }]
    expect(restarted.r.structuredContent!.prior_unknown).toEqual(stale)
    const r = await p.handleCall(9, 'collab_report_append', report('k1'))
    expect(codeOf(r)).toBe('prior_outcome_unknown')
    expect(r.structuredContent!.message).toBe('An earlier call with the same content (idempotency_key "k1") has no known outcome and its Collab session has ended; a replay would run it again. Check with collab_report_list or collab_task_list first.')
    expect(r.structuredContent!.prior_unknown).toEqual(stale)
    expect(r.content[1]!.text).toContain('never replay or re-send')
    expect(r.content[1]!.text).not.toContain('replay it with the same key')
    await Bun.sleep(100)
    expect(calls(l)).toHaveLength(3)
    expect(unresolved(f.paths, KEY).map((x) => x.call_ref)).toEqual([first.ref])
  })

  test('a seat_session_ended answer, then an unknown session_start, leave an earlier unknown un-replayable (P66)', async () => {
    const f = nuanceFixture({ env: { COLLAB_BRIDGE_TEST_TIME_SCALE: '0.25' } })
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    await exchange(p, l, 'collab_report_append', report('k1'), unknownFor)
    const ended = await exchange(p, l, 'collab_task_list', {},
      (ref) => resultFor(ref, bridgeFailure('seat_session_ended', 'This Collab session has ended on the Air; start a new session.', ref), 'error'))
    expect(codeOf(ended.r)).toBe('seat_session_ended')
    l.accept({ ready: { tools_digest: DIGEST, session_hint: null } })   // the lineage has no live session on the hub now
    const start = p.handleCall(5, 'collab_session_start', { actor: 'a' })
    await waitFor(() => calls(l).length === 3)
    l.dropConnection()
    expect(codeOf(await start)).toBe('hub_outcome_unknown')
    await attached(l, 2)
    const r = await p.handleCall(6, 'collab_report_append', report('k1'))
    expect(codeOf(r)).toBe('prior_outcome_unknown')
    expect(r.structuredContent!.prior_idempotency_key).toBe('k1')
    await Bun.sleep(100)
    expect(calls(l)).toHaveLength(3)
  })

  test("a same-key answer in a new session leaves the old session's record (P66)", async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const p = await started(pipeDeps(f))
    await attached(l)
    const create = { workspace_id: 'ws_1', task_id: 't-own-1', title: 'notes', idempotency_key: 'c1' }
    const first = await exchange(p, l, 'collab_task_create', create, unknownFor)
    await exchange(p, l, 'collab_session_end', {}, (ref) => resultFor(ref))
    await exchange(p, l, 'collab_session_start', { actor: 'a' }, (ref) => resultFor(ref, sessionStarted('ses_2')))
    const again = await exchange(p, l, 'collab_task_create', create, (ref) => resultFor(ref))   // a task_id: Collab's task_exists guards it
    expect(again.r.content[0]).toEqual(OK.content[0]!)
    expect(unresolved(f.paths, KEY).map((x) => [x.call_ref, x.session_id])).toEqual([[first.ref, SESSION]])
  })

  test('a write that throws answers hub_away, not sent, and leaves no record', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const mode: { now: 'off' | 'throw' | 'close' } = { now: 'off' }
    const p = await started(pipeDeps(f, { connect: failingConnect(mode) }))
    await attached(l)
    mode.now = 'throw'
    const r = await p.handleCall(1, 'collab_report_append', report('k1'))
    mode.now = 'off'
    expect(codeOf(r)).toBe('hub_away')
    expect(r.structuredContent!.delivered).toBe(false)
    expect(unresolved(f.paths, KEY)).toEqual([])
    expect(ledgerEvents(f.paths)).not.toContain('call_unknown')
  })

  test('a socket seen gone during the write answers hub_outcome_unknown at once and keeps the record', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const mode: { now: 'off' | 'throw' | 'close' } = { now: 'off' }
    const p = await started(pipeDeps(f, { connect: failingConnect(mode) }))
    await attached(l)
    mode.now = 'close'
    const t0 = performance.now()
    const r = await p.handleCall(1, 'collab_report_append', report('k1'))
    mode.now = 'off'
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(codeOf(r)).toBe('hub_outcome_unknown')
    expect(r.structuredContent!.delivered).toBe('unknown')
    expect(unresolved(f.paths, KEY).map((x) => x.call_ref)).toEqual([r.structuredContent!.call_ref as string])
  })
})

describe('the tool list', () => {
  const changed = TEST_TOOLS.map((t) => (t.name === 'collab_task_list' ? { ...t, description: 'List tasks, newer words.' } : t))

  test('a new digest in ready fetches the list, sends list_changed, and answers hub_version_mismatch until tools/list', async () => {
    const f = nuanceFixture()
    const newDigest = toolsDigest(changed)
    const l = await link(f, { ready: { tools_digest: newDigest } })
    const d = pipeDeps(f)
    const p = await started(d)
    await waitFor(() => l.frames().some((m) => m.t === 'tools_get' && m.digest === newDigest))
    l.send({ t: 'tools', digest: newDigest, list: changed })
    await waitFor(() => written(d).some((m) => m.method === 'notifications/tools/list_changed' && !('id' in m)))
    expect(codeOf(await p.handleCall(1, 'collab_task_list', {}))).toBe('hub_version_mismatch')
    await p.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 'L', method: 'tools/list', params: {} }))
    const listed = written(d).find((m) => m.id === 'L')
    expect(listed.result.tools.find((t: any) => t.name === 'collab_task_list').description).toBe('List tasks, newer words.')
    const pending = p.handleCall(2, 'collab_task_list', {})
    const [c] = await waitFor(() => calls(l).length === 1 && calls(l))
    l.send(resultFor(c!.call_ref as string))
    expect(await pending).toEqual(OK)
  })

  test('a hub list with a wrong digest or an unseeded name is refused and the old list kept', async () => {
    const f = nuanceFixture()
    const evil = [...TEST_TOOLS, { name: 'collab_decision_record', inputSchema: { type: 'object' } }]
    const l = await link(f, { ready: { tools_digest: 'c'.repeat(64) } })
    const d = pipeDeps(f)
    const p = await started(d)
    await waitFor(() => l.frames().some((m) => m.t === 'tools_get'))
    l.send({ t: 'tools', digest: 'c'.repeat(64), list: changed })
    l.send({ t: 'tools', digest: toolsDigest(evil), list: evil })
    const refused = await waitFor(() => { const r = l.frames().filter((m) => m.t === 'tools_refused'); return r.length === 2 && r })
    expect(refused.map((m) => m.reason)).toEqual(['digest_mismatch', 'unknown_tool'])
    expect(written(d).some((m) => m.method === 'notifications/tools/list_changed')).toBe(false)
    await p.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 'L', method: 'tools/list', params: {} }))
    expect(written(d).find((m) => m.id === 'L').result.tools.map((t: any) => t.name).sort()).toEqual(TEST_TOOLS.map((t) => t.name).sort())
    expect(codeOf(await p.handleCall(1, 'collab_decision_record', {}))).toBe('tool_not_available_remote')
    const pending = p.handleCall(2, 'collab_task_list', {})
    const [c] = await waitFor(() => calls(l).length === 1 && calls(l))
    l.send(resultFor(c!.call_ref as string))
    expect(await pending).toEqual(OK)
  })

  test('a refused hub list sends tools_refused once with its reason', async () => {
    const f = nuanceFixture()
    const evil = [...TEST_TOOLS, { name: 'collab_workspace_open', inputSchema: { type: 'object' } }]
    const l = await link(f, { ready: { tools_digest: toolsDigest(evil) } })
    await started(pipeDeps(f))
    await waitFor(() => l.frames().some((m) => m.t === 'tools_get'))
    l.send({ t: 'tools', digest: toolsDigest(evil), list: evil })
    l.send({ t: 'tools', digest: toolsDigest(evil), list: evil })
    await waitFor(() => l.frames().some((m) => m.t === 'tools_refused'))
    await Bun.sleep(150)
    expect(l.frames().filter((m) => m.t === 'tools_refused')).toEqual([{ t: 'tools_refused', digest: toolsDigest(evil), reason: 'unknown_tool' }])
    expect(ledgerEvents(f.paths).filter((e) => e === 'tools_refused')).toHaveLength(1)
  })
})

describe('JSON-RPC from the harness', () => {
  test('notifications/cancelled sends cancel and keeps the record', async () => {
    const f = nuanceFixture()
    const l = await link(f)
    const d = pipeDeps(f)
    const p = await started(d)
    await attached(l)
    const answered = p.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'collab_report_append', arguments: report('k1') } }))
    const [c] = await waitFor(() => calls(l).length === 1 && calls(l))
    await p.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7, reason: 'user' } }))
    await waitFor(() => l.frames().some((m) => m.t === 'cancel' && m.call_ref === c!.call_ref))
    await answered
    const reply = written(d).find((m) => m.id === 7)
    expect(reply.error).toBeUndefined()
    expect(reply.result.structuredContent.error).toBe('hub_outcome_unknown')
    expect(unresolved(f.paths, KEY).map((x) => x.call_ref)).toEqual([c!.call_ref as string])
  })

  test('garbage arguments still answer a tool result', async () => {
    const f = nuanceFixture()
    const d = pipeDeps(f)
    const p = await started(d)
    await p.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'collab_task_list', arguments: 'garbage' } }))
    await p.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 42, arguments: [1, 2] } }))
    await p.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} }))
    for (const id of [1, 2, 3]) {
      const reply = written(d).find((m) => m.id === id)
      expect(reply.error).toBeUndefined()
      expect(reply.result.isError).toBe(true)
    }
    expect(written(d).find((m) => m.id === 1).result.structuredContent.error).toBe('hub_away')
    expect(written(d).find((m) => m.id === 2).result.structuredContent.error).toBe('tool_not_available_remote')
  })

  test('an over-long stdin line is dropped and the next request is answered', async () => {
    const f = nuanceFixture()
    let push!: (b: Uint8Array) => void
    let end!: () => void
    const stdin = new ReadableStream<Uint8Array>({ start(c) { push = (b) => c.enqueue(b); end = () => c.close() } })
    const d: TestPipeDeps = pipeDeps(f, { stdin })
    const done = runPipe(d)
    const enc = new TextEncoder()
    push(enc.encode('{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"' + 'x'.repeat(9 * 1024 * 1024) + '"}}\n'))
    push(enc.encode(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n'))
    await waitFor(() => written(d).some((m) => m.id === 2))
    expect(written(d).find((m) => m.id === 2).result).toEqual({})
    expect(written(d).some((m) => m.id === 1)).toBe(false)
    end()
    expect(await done).toBe(0)
    expect(ledgerEvents(f.paths)).toContain('stdin_too_long')
  })
})

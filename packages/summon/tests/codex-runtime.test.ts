import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { codexInvocation, codexReady } from '../src/codex.ts'
import { gateStart } from '../src/gate.ts'
import { requestCancel, resultOf } from '../src/gatekeeper.ts'
import { readState } from '../src/jobs.ts'
import { summonPaths } from '../src/paths.ts'
import { markOrphans, processStartTime, runOnce } from '../src/runner.ts'
import { signalOwnedGroup } from '../src/process-group.ts'
import { cleanupTmps, sampleRequest, targetHome } from './helpers.ts'
import { CODEX_ALLOWLIST, fakeCodex } from './codex-fixture.ts'

afterEach(cleanupTmps)
function fixture(allowlist = CODEX_ALLOWLIST) {
  const home = targetHome(allowlist), fake = fakeCodex(), paths = summonPaths(home)
  const deps = { paths, home, user: 'fixture', nowMs: Date.now, claudeBin: () => { throw new Error('wrong runtime') },
    codexBin: () => fake.bin, collectInventory: async () => ({}), heartbeatMs: 20, pollMs: 10, killGraceMs: 100, processStartTime }
  const gate = { paths, home, nowMs: Date.now, guiSessionIsMine: () => true, runnerLoaded: () => true,
    claudeAvailable: () => false, codexAvailable: () => codexReady(fake.bin, home, 'fixture') }
  const request = sampleRequest({ runtime: 'codex', model: 'gpt-6-astra', effort: 'high', prompt: 'fixture-private-prompt' })
  return { home, fake, paths, deps, gate, request }
}
const waitFor = async (fn: () => boolean) => {
  const until = Date.now() + 4000
  while (!fn()) { if (Date.now() > until) throw new Error('fixture did not start'); await Bun.sleep(10) }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

describe('Codex native review route', () => {
  test('requires verified runtime, exact model/effort, folder and broad-read opt-in; refuses edit/provider', () => {
    for (const over of [{ access: 'edit' }, { provider: 'other' }, { model: 'unlisted' }, { effort: 'ultra' }, { cwd: '~/Elsewhere' }] as const) {
      const f = fixture()
      expect(gateStart(JSON.stringify({ ...f.request, ...over }), f.gate).status).toBe('refused')
      expect(existsSync(join(f.paths.spool, f.request.id))).toBe(false)
    }
    const denied = fixture(CODEX_ALLOWLIST.replace('reads_anywhere: true', 'reads_anywhere: false'))
    expect(gateStart(JSON.stringify(denied.request), denied.gate)).toMatchObject({ status: 'refused', reason: 'outside_allowlist' })
    const old = fixture(); old.fake.setMode('old')
    expect(gateStart(JSON.stringify(old.request), old.gate)).toMatchObject({ status: 'refused', reason: 'runtime_unavailable' })
  })

  test('dispatches to native Codex, returns a final reply, and keeps prompt/reply out of argv and ledger', async () => {
    const f = fixture()
    expect(gateStart(JSON.stringify(f.request), f.gate).status).toBe('admitted')
    expect(await runOnce(f.deps)).toBe(1)
    const result = resultOf(f.paths, 'nuance', f.request.id, Date.now())
    expect(result).toMatchObject({ status: 'completed', result_text: 'echo: fixture-private-prompt', exit_code: 0,
      codex_diagnostics: { parser_status: 'completed', stop_requested_ms: null, exit: { code: 0, signal: null },
        events: { 'thread.started': { count: 1 }, 'turn.started': { count: 1 }, 'turn.completed': { count: 1 } },
        items: { agent_message: { count: 1 } } } })
    expect(JSON.stringify(result.codex_diagnostics)).not.toContain('fixture-private-prompt')
    const record = JSON.parse(readFileSync(f.fake.record, 'utf8'))
    expect(record.argv).toContain('gpt-6-astra')
    expect(record.argv).toContain('model_reasoning_effort="high"')
    expect(record.argv).toContain('--ignore-user-config')
    expect(record.argv).toContain('--ignore-rules')
    expect(record.argv).toContain('read-only')
    expect(record.argv.slice(0, 3)).toEqual(['-a', 'never', 'exec'])
    expect(JSON.stringify(record.argv)).not.toContain(f.request.prompt)
    expect(record.env.HOME).toBe(f.home)
    expect(record.env).not.toHaveProperty('OPENAI_API_KEY')
    expect(record.env).not.toHaveProperty('CODEX_HOME')
    expect(readFileSync(f.paths.ledger, 'utf8')).not.toContain(f.request.prompt)
    expect(readFileSync(f.paths.ledger, 'utf8')).not.toContain('echo:')
    expect(readFileSync(f.paths.ledger, 'utf8')).not.toContain('codex_diagnostics')
    expect(readState(f.paths, f.request.id)).not.toHaveProperty('codex_diagnostics')
    expect(gateStart(JSON.stringify(f.request), f.gate)).toMatchObject({ status: 'refused', reason: 'replayed' })
  })

  test('a changed unsupported executable after admission never reaches a model invocation', async () => {
    const f = fixture()
    expect(gateStart(JSON.stringify(f.request), f.gate).status).toBe('admitted')
    f.fake.setMode('old')
    await runOnce(f.deps)
    expect(resultOf(f.paths, 'nuance', f.request.id, Date.now())).toMatchObject({ status: 'failed', detail: 'codex CLI failed the supported-version check' })
    expect(existsSync(f.fake.record)).toBe(false)
  })

  test('cancellation stops both the job and a child that ignores TERM, preserving unrelated processes', async () => {
    const f = fixture(); f.fake.setMode('descendant')
    expect(gateStart(JSON.stringify(f.request), f.gate).status).toBe('admitted')
    const unrelated = Bun.spawn(['/bin/sleep', '30'], { stdout: 'ignore', stderr: 'ignore' })
    try {
      const running = runOnce(f.deps)
      await waitFor(() => existsSync(f.fake.descendant))
      const descendant = Number(readFileSync(f.fake.descendant, 'utf8'))
      requestCancel(f.paths, 'nuance', f.request.id, Date.now())
      await running
      await waitFor(() => !alive(descendant))
      expect(resultOf(f.paths, 'nuance', f.request.id, Date.now()).status).toBe('cancelled')
      expect(alive(unrelated.pid)).toBe(true)
    } finally { unrelated.kill('SIGKILL'); await unrelated.exited }
  })

  test('normal completion cleans a previously observed descendant after its leader exits', async () => {
    const f = fixture(); f.fake.setMode('finished-descendant')
    expect(gateStart(JSON.stringify(f.request), f.gate).status).toBe('admitted')
    let descendant = 0
    try {
      const running = runOnce(f.deps)
      await waitFor(() => existsSync(f.fake.descendant))
      descendant = Number(readFileSync(f.fake.descendant, 'utf8'))
      await running
      await waitFor(() => !alive(descendant))
      expect(resultOf(f.paths, 'nuance', f.request.id, Date.now()).status).toBe('completed')
    } finally {
      if (descendant && alive(descendant)) { try { process.kill(descendant, 'SIGKILL') } catch {} }
    }
  })

  test('timeout settles a Codex job without claiming completion', async () => {
    const f = fixture(); f.fake.setMode('partial-reply-stall'); f.request.timeout_s = 1
    expect(gateStart(JSON.stringify(f.request), f.gate).status).toBe('admitted')
    await runOnce(f.deps)
    const result = resultOf(f.paths, 'nuance', f.request.id, Date.now())
    expect(result).toMatchObject({ status: 'timed_out', exit_code: 0, result_text: '',
      codex_diagnostics: { parser_status: 'failed', parser_detail: 'codex did not finish with a reply',
        exit: { code: 0, signal: null }, stderr_bytes: 'private-stderr-marker'.length * 300,
        events: { 'thread.started': { count: 1 }, 'turn.started': { count: 1 } }, items: { agent_message: { count: 1 } } } })
    const progress = result.codex_diagnostics as any
    expect(progress.stdout_bytes).toBeGreaterThan(0)
    expect(progress.stop_requested_ms).toBeGreaterThanOrEqual(1000)
    expect(progress.exit.at_ms).toBeGreaterThanOrEqual(progress.stop_requested_ms)
    expect(progress.events).not.toHaveProperty('turn.completed')
    for (const marker of ['private-stderr-marker', 'private-partial-reply', 'private-item-id']) {
      expect(JSON.stringify(result)).not.toContain(marker)
      expect(readFileSync(f.paths.ledger, 'utf8')).not.toContain(marker)
    }
    expect(readState(f.paths, f.request.id)?.pid).toBeUndefined()
  })

  test('restart terminates an identity-checked orphan group without replaying its prompt', async () => {
    const f = fixture(); f.fake.setMode('descendant')
    expect(gateStart(JSON.stringify(f.request), f.gate).status).toBe('admitted')
    const runner = Bun.spawn([process.execPath, join(import.meta.dir, '../src/runner-main.ts')], {
      cwd: '/', env: { PATH: '/usr/bin:/bin', HOME: f.home, SUMMON_HOME_OVERRIDE: f.home, SUMMON_CODEX_BIN: f.fake.bin },
      stdout: 'ignore', stderr: 'ignore',
    })
    let child = 0, descendant = 0
    try {
      await waitFor(() => existsSync(f.fake.descendant))
      child = readState(f.paths, f.request.id)!.pid!
      descendant = Number(readFileSync(f.fake.descendant, 'utf8'))
      expect(markOrphans(f.paths, Date.now())).toBe(0) // an active owner retains its job
      runner.kill('SIGKILL'); await runner.exited
      expect(markOrphans(f.paths, Date.now())).toBe(1)
      await waitFor(() => !alive(child) && !alive(descendant))
      expect(readState(f.paths, f.request.id)).toMatchObject({ status: 'unknown', detail: 'Codex supervisor stopped; owned process group terminated' })
      expect(await runOnce(f.deps)).toBe(0)
      const starts = readFileSync(f.paths.ledger, 'utf8').split('\n').filter((l) => l.includes('"event":"job_start"'))
      expect(starts).toHaveLength(1)
    } finally {
      if (alive(runner.pid)) { runner.kill('SIGKILL'); await runner.exited }
      if (child && alive(child)) { try { process.kill(-child, 'SIGKILL') } catch {} }
    }
  })

  test('escalation never signals a recycled process-group number', () => {
    const known = new Map([[123, 'original leader'], [124, 'original child']])
    const sent: number[] = []
    const send = (pid: number) => { sent.push(pid) }
    expect(signalOwnedGroup(123, known, 'SIGKILL', () => new Map([[123, 'new process']]), send)).toBe(false)
    expect(signalOwnedGroup(123, known, 'SIGKILL', () => null, send)).toBe(false)
    expect(sent).toEqual([])
    expect(signalOwnedGroup(123, known, 'SIGKILL', () => new Map([[124, 'original child']]), send)).toBe(true)
    expect(sent).toEqual([-123])
  })

  test('invocation rejects edits independently of admission', () => {
    expect(() => codexInvocation({ model: 'gpt-6-astra', access: 'edit', cwdReal: '/fixture', prompt: 'p' }, '/fixture', '/bin/codex', 'fixture')).toThrow('review only')
  })
})

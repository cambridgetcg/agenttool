import { afterEach, describe, expect, test } from 'bun:test'
import { writePipeRecord } from '../src/nuance/pipe-record.ts'
import { TapServer, type TapServerDeps } from '../src/nuance/tap-server.ts'
import { hookOutput, knockLine, runTap, type TapDeps } from '../src/nuance/tap.ts'
import { cleanupTmps, PKG } from './helpers.ts'
import { makeStaleSocket } from './fake-link.ts'
import { FAKE_HOST, fakeTable, nuanceFixture, type NuanceFixture } from './pipe-fixture.ts'

const servers: TapServer[] = []
const kids: Array<{ kill(): void }> = []
afterEach(() => {
  for (const s of servers.splice(0)) s.stop()
  for (const k of kids.splice(0)) k.kill()
  cleanupTmps()
})

const HOST = { pid: FAKE_HOST.pid, lstart: FAKE_HOST.lstart, comm: FAKE_HOST.comm }
const ONE = 'Collab: 1 note(s) addressed to you are waiting (from air). Read them with collab_next when you choose; nothing is required.'

/** A live pipe's tap socket for the fake host, answering every tap with `ask`. */
async function pipeSide(f: NuanceFixture, ask: TapServerDeps['ask'], pipePid = process.pid): Promise<TapServer> {
  const s = new TapServer({ paths: f.paths, host: HOST, pipePid, lineage: () => null, state: () => 'ready', refused: () => null, ask })
  servers.push(s)
  await s.start()
  return s
}

const empty = () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"prompt":"hi"}')); c.close() } })
const deps = (f: NuanceFixture, o: Partial<TapDeps> = {}): TapDeps => ({
  paths: f.paths, selfPid: process.pid, table: () => fakeTable(), stdin: empty(), mono: () => performance.now(), ...o,
})
const say = (count: number, origins: string[]) => async () => ({ count, origins, seqs: Array.from({ length: Math.max(count, 0) }, (_, i) => i + 1) })

/** A process that is alive for the length of a test. */
function livePid(): number {
  const p = Bun.spawn(['/bin/sleep', '30'])
  kids.push(p)
  return p.pid
}

describe('the line and its envelope', () => {
  test('the line is exact for one origin and for three', () => {
    expect(knockLine(1, ['air'])).toBe(ONE)
    expect(knockLine(12, ['air', 'nuance/macair', 'zerone/yu.2'])).toBe(
      'Collab: 12 note(s) addressed to you are waiting (from air, nuance/macair, zerone/yu.2). Read them with collab_next when you choose; nothing is required.')
  })

  test("the envelope is the Air tap's", () => {
    // ~/.config/sol/hooks/collab-knock-tap prints json.dumps(hook_output(host, line)) + "\n"
    const air = '{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": ' + JSON.stringify(ONE) + '}}'
    expect(JSON.parse(hookOutput(ONE))).toEqual(JSON.parse(air))
    expect(Object.keys(JSON.parse(hookOutput(ONE)))).toEqual(['hookSpecificOutput'])
  })

  test('silence on a count of 0, 1000, 1.5 or "3", on four origins, and on an origin with a space or a bidi mark', async () => {
    for (const count of [0, 1000, 1.5, '3', -1, Number.NaN]) expect(knockLine(count, ['air'])).toBeNull()
    expect(knockLine(4, ['air', 'a/b', 'c/d', 'e/f'])).toBeNull()
    expect(knockLine(1, [])).toBeNull()
    expect(knockLine(1, ['air', 'air'])).toBeNull()
    expect(knockLine(1, ['nuance/mac air'])).toBeNull()
    expect(knockLine(1, ['nuance/macair‮'])).toBeNull()
    expect(knockLine(1, ['Air'])).toBeNull()
    expect(knockLine(1, 'air')).toBeNull()
    const f = nuanceFixture()
    await pipeSide(f, say(1000, ['air']))
    expect(await runTap(deps(f))).toBeNull()
  })
})

describe('finding the pipe', () => {
  test("a dead pipe's leftover record under the same host is ignored, so the live pipe still answers", async () => {
    const f = nuanceFixture()
    await pipeSide(f, say(1, ['air']))
    const dead = Bun.spawn(['/usr/bin/true'])
    await dead.exited
    await makeStaleSocket(f.paths.pipeSock(HOST.pid, dead.pid))
    writePipeRecord(f.paths, { v: 1, host_pid: HOST.pid, host_lstart: HOST.lstart, pipe_pid: dead.pid, lineage: null, state: 'ready', refused: null })
    expect(await runTap(deps(f))).toBe(hookOutput(ONE) + '\n')
  })

  test('silence with no matching pipe, with two matching pipes, and with no ps', async () => {
    const f = nuanceFixture()
    expect(await runTap(deps(f))).toBeNull()
    await pipeSide(f, say(1, ['air']))
    expect(await runTap(deps(f, { table: () => fakeTable(process.pid, { pid: 4200, lstart: HOST.lstart, comm: 'claude' }) }))).toBeNull()
    expect(await runTap(deps(f, { table: () => null }))).toBeNull()
    expect(await runTap(deps(f))).toBe(hookOutput(ONE) + '\n')
    await pipeSide(f, say(1, ['air']), livePid())
    expect(await runTap(deps(f))).toBeNull()
  })

  test('silence when the pipe answers CLOSE (hub away)', async () => {
    const f = nuanceFixture()
    await pipeSide(f, async () => null)
    expect(await runTap(deps(f))).toBeNull()
  })

  test('silence on a stale pipe socket', async () => {
    const f = nuanceFixture()
    const pid = livePid()
    await makeStaleSocket(f.paths.pipeSock(HOST.pid, pid))
    writePipeRecord(f.paths, { v: 1, host_pid: HOST.pid, host_lstart: HOST.lstart, pipe_pid: pid, lineage: null, state: 'ready', refused: null })
    const t0 = performance.now()
    expect(await runTap(deps(f))).toBeNull()
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})

describe('the budget and the hook input', () => {
  test('silence by the 3 s budget when the pipe never answers (scaled)', async () => {
    const f = nuanceFixture()
    await pipeSide(f, () => new Promise(() => {}))
    const t0 = performance.now()
    expect(await runTap(deps(f, { budgetMs: 300 }))).toBeNull()
    const ms = performance.now() - t0
    expect(ms).toBeGreaterThanOrEqual(280)
    expect(ms).toBeLessThan(1500)
  })

  test('a large hook payload is drained and never printed', async () => {
    const f = nuanceFixture()
    await pipeSide(f, say(1, ['air']))
    const marker = 'SECRET-PROMPT-MARKER '
    const chunk = new TextEncoder().encode(marker.repeat(4096))
    let sent = 0
    const stdin = new ReadableStream<Uint8Array>({ pull(c) { if (sent >= 2 * 1024 * 1024) return c.close(); sent += chunk.byteLength; c.enqueue(chunk) } })
    const out = await runTap(deps(f, { stdin }))
    expect(out).toBe(hookOutput(ONE) + '\n')
    expect(out!.includes('SECRET')).toBe(false)
    expect(sent).toBeGreaterThan(1024 * 1024)
  })
})

describe('collab-bridge tap, spawned from source', () => {
  const TAP_ARGV = [process.execPath, '--no-env-file', '--config=/dev/null', `${PKG}/src/nuance/main.ts`, 'tap', '--host', 'claude']
  const run = async (f: NuanceFixture, argv = TAP_ARGV) => {
    const p = Bun.spawn(argv, { env: f.env, cwd: f.share, stdin: new TextEncoder().encode('{"hook_event_name":"UserPromptSubmit","prompt":"hi"}'), stdout: 'pipe', stderr: 'pipe' })
    const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()])
    return { code, out, err }
  }

  test('collab-bridge tap --host claude exits 0 and prints nothing on silence', async () => {
    const f = nuanceFixture()
    expect(await run(f)).toEqual({ code: 0, out: '', err: '' })
    expect(await run(f, [...TAP_ARGV.slice(0, -2), '--host', 'codex'])).toEqual({ code: 0, out: '', err: '' })
  }, 20_000)

  test("collab-bridge tap --host claude prints the envelope when its Claude's pipe has a note", async () => {
    const f = nuanceFixture()
    await pipeSide(f, say(1, ['air']))   // the spawned tap's P43 ps chains it to claude 4100, this pipe's host
    expect(await run(f)).toEqual({ code: 0, out: hookOutput(ONE) + '\n', err: '' })
  }, 20_000)
})

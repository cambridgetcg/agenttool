import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHILD_MAX_REPLY_BYTES, CHILD_REQUEST_TIMEOUT_MS, childArgv, childEnv, CollabChild, probeCollabTools, type ChildSpec, type StartFailure,
} from '../src/air/children.ts'
import { COLLAB_DIST, cleanupTmps, temp } from './helpers.ts'
import { collabHarness } from './mcp-harness.ts'
import { fakeLog, plantBunConfig, writeFakeCollab, type FakeScript } from './fake-collab.ts'

const running: CollabChild[] = []
afterEach(async () => {
  for (const c of running.splice(0)) if (c.alive()) { process.kill(c.pid, 'SIGKILL'); await c.exited }
  cleanupTmps()
})

function isFailure(x: CollabChild | StartFailure): x is StartFailure {
  return (x as StartFailure).failed === true
}

async function started(spec: ChildSpec, o?: Parameters<typeof CollabChild.start>[1]): Promise<CollabChild> {
  const c = await CollabChild.start(spec, o)
  if (isFailure(c)) throw new Error(`the child did not start: ${c.lastErrLine}`)
  running.push(c)
  return c
}

/** A spec on the tracked dist with a temp home and a journal under it, never a real one (P35). */
function realSpec(): ChildSpec {
  const home = temp('cb-child-')
  return { bun: process.execPath, dist: COLLAB_DIST, journal: join(home, 'collab-shared', 'collab.sqlite'), home }
}

/** A spec on the fake Collab bin. */
function fakeSpec(script: FakeScript = {}): ChildSpec & { dir: string } {
  const home = temp('cb-fake-home-')
  const dir = writeFakeCollab(temp('cb-fake-dist-'), script)
  return { bun: process.execPath, dist: dir, journal: join(home, 'collab.sqlite'), home, dir }
}

describe('the hub way to run Collab', () => {
  test('childArgv and childEnv are the hub argv and the three-key env', () => {
    const spec: ChildSpec = { bun: '/b/bun', dist: '/d', journal: '/j/collab.sqlite', home: '/h' }
    expect(childArgv(spec)).toEqual(['/b/bun', '--no-env-file', '--config=/dev/null', '/d/agenttool-collab-mcp.js'])
    expect(childEnv(spec)).toEqual({ HOME: '/h', PATH: '/opt/homebrew/bin:/usr/bin:/bin', AGENTOOL_COLLAB_DB: '/j/collab.sqlite' })
    expect(childEnv({ ...spec, sessionFile: '/s.json' })).toEqual({
      HOME: '/h', PATH: '/opt/homebrew/bin:/usr/bin:/bin', AGENTOOL_COLLAB_DB: '/j/collab.sqlite', AGENTOOL_COLLAB_SESSION_FILE: '/s.json',
    })
    expect(CHILD_REQUEST_TIMEOUT_MS).toBe(600_000)
    expect(CHILD_MAX_REPLY_BYTES).toBe(4 * 1024 * 1024 - 64 * 1024)
  })
})

describe('CollabChild on the tracked dist', () => {
  test('starts, initializes and lists 34 tools', async () => {
    const c = await started(realSpec())
    expect(c.alive()).toBe(true)
    const tools = await c.listTools()
    expect(tools).toHaveLength(34)
    expect(tools.map((t) => t.name)).toContain('collab_session_start')
  }, 20_000)

  test('a Collab isError result is outcome error, unchanged', async () => {
    const spec = realSpec()
    const c = await started(spec)
    const out = await c.call('collab_workspace_status', { workspace_id: 'ws_000000000000000000000000' })
    expect(out.outcome).toBe('error')
    if (out.outcome === 'unknown') throw new Error('unreachable')
    expect(out.result.isError).toBe(true)
    expect(out.result.structuredContent?.error).toBe('workspace_not_found')
    // The same call through a plain harness on the same journal gets byte-for-byte the same result.
    const h = collabHarness({ journal: spec.journal, home: spec.home })
    try {
      await h.initialize()
      expect(out.result).toEqual(await h.callTool('collab_workspace_status', { workspace_id: 'ws_000000000000000000000000' }))
    } finally {
      await h.close()
    }
    expect(out.bytes).toBeGreaterThan(0)
  }, 20_000)

  test('a JSON-RPC error reply becomes an error outcome in the tool-result shape, never a JSON-RPC error', async () => {
    const c = await started(realSpec())
    const out = await c.call('collab_no_such_tool', {})
    expect(out.outcome).toBe('error')
    if (out.outcome === 'unknown') throw new Error('unreachable')
    expect(out.result.isError).toBe(true)
    expect(out.result.structuredContent).toMatchObject({ error: 'collab_jsonrpc_error', jsonrpc_code: -32602 })
    expect(JSON.parse(out.result.content[0]!.text)).toEqual(out.result.structuredContent!)
  }, 20_000)
})

describe('CollabChild against the fake bin', () => {
  test('the env is exactly the three keys and cwd is /', async () => {
    const spec = fakeSpec()
    await started(spec)
    const start = fakeLog(spec.dir).find((l) => l.start)!
    expect(start.env).toEqual(['AGENTOOL_COLLAB_DB', 'HOME', 'PATH'])
    expect(start.cwd).toBe('/')
    const resumed = fakeSpec()
    await started({ ...resumed, sessionFile: join(resumed.home, 's.json') })
    expect(fakeLog(resumed.dir).find((l) => l.start)!.env).toEqual(['AGENTOOL_COLLAB_DB', 'AGENTOOL_COLLAB_SESSION_FILE', 'HOME', 'PATH'])
  }, 20_000)

  test('a planted bunfig.toml (preload and define) and .env never apply', async () => {
    const spec = fakeSpec()
    plantBunConfig(spec.dir)
    const mirror = temp('cb-mirror-')
    plantBunConfig(mirror)
    // Control: a plain bun in the planted dir does load all three, so the plant is real.
    const control = Bun.spawnSync([process.execPath, join(spec.dir, 'agenttool-collab-mcp.js')], {
      cwd: spec.dir, env: { HOME: spec.home, PATH: '/usr/bin:/bin' }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
    })
    expect(control.exitCode).toBe(0)
    expect(fakeLog(spec.dir).find((l) => l.start)).toMatchObject({ leak_env: 'from-dotenv', leak_define: 'defined', preload: 'yes' })
    const mirrorControl = Bun.spawnSync([process.execPath, join(spec.dir, 'agenttool-collab-mcp.js')], {
      cwd: mirror, env: { HOME: spec.home, PATH: '/usr/bin:/bin' }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
    })
    expect(mirrorControl.exitCode).toBe(0)
    expect(fakeLog(spec.dir).filter((l) => l.start)[1]).toMatchObject({ cwd: mirror, leak_env: 'from-dotenv', leak_define: 'defined', preload: 'yes' })
    // The hub's way: cwd /, --no-env-file --config=/dev/null, the three-key env.
    await started(spec)
    const hubWay = fakeLog(spec.dir).filter((l) => l.start)[2]!
    expect(hubWay).toMatchObject({ cwd: '/', leak_env: null, leak_define: null, preload: null })
  }, 20_000)

  test('the child sees exactly one call per call()', async () => {
    const spec = fakeSpec()
    const c = await started(spec)
    const outs = await Promise.all([c.call('fake_echo', { a: 1 }), c.call('fake_echo', { a: 2 }), c.call('fake_echo', { a: 3 })])
    expect(outs.map((o) => o.outcome)).toEqual(['ok', 'ok', 'ok'])
    const calls = fakeLog(spec.dir).filter((l) => l.method === 'tools/call')
    expect(calls).toHaveLength(3)
    expect(new Set(calls.map((l) => l.id)).size).toBe(3)
    expect(fakeLog(spec.dir).map((l) => l.method).filter(Boolean)).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'tools/call', 'tools/call'])
  }, 20_000)

  test('a stalled call answers unknown at the request timeout and no notifications/cancelled is ever sent', async () => {
    const spec = fakeSpec({ tools: { fake_slow: { kind: 'stall' } } })
    const c = await started(spec, { requestTimeoutMs: 300 })
    const out = await c.call('fake_slow', {})
    expect(out).toMatchObject({ outcome: 'unknown', reason: 'timeout' })
    expect(out.ms).toBeGreaterThanOrEqual(290)
    expect(c.inFlight()).toBe(0)
    await Bun.sleep(200)
    expect(c.alive()).toBe(true)
    expect((await c.call('fake_echo', {})).outcome).toBe('ok')
    expect(fakeLog(spec.dir).some((l) => l.method === 'notifications/cancelled')).toBe(false)
  }, 20_000)

  test('a request timeout above 2^31−1 ms is refused', async () => {
    const spec = fakeSpec()
    for (const bad of [2 ** 31, Infinity, Number.NaN, 0, 1.5]) {
      await expect(CollabChild.start(spec, { requestTimeoutMs: bad })).rejects.toThrow('requestTimeoutMs')
    }
    expect(fakeLog(spec.dir)).toEqual([]) // nothing was spawned
    await started(spec, { requestTimeoutMs: 2 ** 31 - 1 })
  }, 20_000)

  test('a child killed mid-call gives unknown exit', async () => {
    const spec = fakeSpec({ tools: { fake_slow: { kind: 'stall' } } })
    const c = await started(spec)
    const pending = c.call('fake_slow', {})
    await Bun.sleep(100)
    process.kill(c.pid, 'SIGKILL')
    expect(await pending).toMatchObject({ outcome: 'unknown', reason: 'exit' })
    expect(c.alive()).toBe(false)
    expect(await c.call('fake_echo', {})).toMatchObject({ outcome: 'unknown', reason: 'exit' })
    const died = fakeSpec({ tools: { fake_slow: { kind: 'die' } } })
    const d = await started(died)
    expect(await d.call('fake_slow', {})).toMatchObject({ outcome: 'unknown', reason: 'exit' })
  }, 20_000)

  test('a garbage reply is unknown unparsable, a reply over the cap is unknown oversized', async () => {
    const g = await started(fakeSpec({ tools: { fake_slow: { kind: 'garbage' } } }))
    expect(await g.call('fake_slow', {})).toMatchObject({ outcome: 'unknown', reason: 'unparsable' })
    await g.exited // a child that wrote a line no one can attribute is not trusted again
    const big = fakeSpec({ tools: { fake_slow: { kind: 'big', bytes: 5 * 1024 * 1024 } } })
    const b = await started(big)
    expect(await b.call('fake_slow', {})).toMatchObject({ outcome: 'unknown', reason: 'oversized' })
    // The reader skips the long line and the child goes on answering.
    expect((await b.call('fake_echo', {})).outcome).toBe('ok')
    const small = await started(fakeSpec({ tools: { fake_slow: { kind: 'big', bytes: 70_000 } } }), { maxReplyBytes: 64 * 1024 })
    expect(await small.call('fake_slow', {})).toMatchObject({ outcome: 'unknown', reason: 'oversized' })
  }, 20_000)

  test('stop waits for a call in flight', async () => {
    const spec = fakeSpec({ tools: { fake_slow: { kind: 'delay', ms: 600 } } })
    const c = await started(spec)
    const order: string[] = []
    const call = c.call('fake_slow', {}).then((o) => { order.push(`call ${o.outcome}`) })
    await Bun.sleep(50)
    expect(c.inFlight()).toBe(1)
    await c.stop(2000).then(() => { order.push('stopped') })
    await call
    expect(order).toEqual(['call ok', 'stopped'])
    expect(c.alive()).toBe(false)
    expect(await c.exited).toBe(0) // stdin EOF, not a signal
    expect(fakeLog(spec.dir).at(-1)?.method).toBe('eof')
  }, 20_000)

  test('accepting() is true while call() would write, and false once a stop has begun or the child has exited', async () => {
    const c = await started(fakeSpec())
    expect(c.accepting()).toBe(true)
    const stopping = c.stop(2000)
    expect(c.accepting()).toBe(false) // at once, before the stop resolves
    expect(c.alive()).toBe(true)
    await stopping
    expect(c.accepting()).toBe(false)
    const k = await started(fakeSpec())
    expect(k.accepting()).toBe(true)
    process.kill(k.pid, 'SIGKILL')
    await k.exited
    expect(k.accepting()).toBe(false)
  }, 20_000)

  test('a child that exits before initialize returns StartFailure with its ✖ line', async () => {
    const spec = fakeSpec({ startup: { kind: 'fail', line: '✖ Session credentials are invalid', code: 1 } })
    const r = await CollabChild.start(spec)
    expect(r).toEqual({ failed: true, lastErrLine: '✖ Session credentials are invalid', exitCode: 1 })
    const hang = fakeSpec({ startup: { kind: 'hang' } })
    const h = await CollabChild.start(hang, { startTimeoutMs: 300 })
    expect(h).toEqual({ failed: true, lastErrLine: null, exitCode: null })
    const missing = await CollabChild.start({ ...realSpec(), bun: '/nonexistent/bun' })
    expect(missing).toEqual({ failed: true, lastErrLine: null, exitCode: null })
  }, 20_000)
})

describe('probeCollabTools', () => {
  test('lists the tracked dist on a throwaway journal and removes it', async () => {
    const root = temp('cb-probe-root-')
    const p = await probeCollabTools({ bun: process.execPath, dist: COLLAB_DIST, tmpRoot: root })
    expect(p.ok && p.list.length).toBe(34)
    expect(readdirSync(root)).toEqual([])
  }, 20_000)

  test('a child that does not start is stage start with its ✖ line, and its dir is gone too', async () => {
    const root = temp('cb-probe-root-')
    const dist = writeFakeCollab(temp('cb-fake-dist-'), { startup: { kind: 'fail', line: '✖ Session credentials are invalid', code: 1 } })
    const p = await probeCollabTools({ bun: process.execPath, dist, tmpRoot: root })
    expect(p).toEqual({ ok: false, stage: 'start', failure: { failed: true, lastErrLine: '✖ Session credentials are invalid', exitCode: 1 } })
    expect(readdirSync(root)).toEqual([])
  }, 20_000)
})

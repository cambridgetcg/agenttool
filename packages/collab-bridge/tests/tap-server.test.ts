import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { pipeRecordName, writePipeRecord } from '../src/nuance/pipe-record.ts'
import { makePendingKnocks, TapServer, type TapServerDeps } from '../src/nuance/tap-server.ts'
import { cleanupTmps, modeOf } from './helpers.ts'
import { stdioHarness } from './mcp-harness.ts'
import { makeStaleSocket } from './fake-link.ts'
import { FAKE_HOST, nuanceFixture, PIPE_ARGV, tapExchange, TEST_TOOLS, waitFor, type NuanceFixture } from './pipe-fixture.ts'

const servers: TapServer[] = []
const kids: Array<{ kill(): void }> = []
afterEach(() => {
  for (const s of servers.splice(0)) s.stop()
  for (const k of kids.splice(0)) k.kill()
  cleanupTmps()
})

const HOST = { pid: FAKE_HOST.pid, lstart: FAKE_HOST.lstart, comm: FAKE_HOST.comm }
const LINEAGE = 'lin_' + '1'.repeat(32)

function server(f: NuanceFixture, o: Partial<TapServerDeps> = {}): TapServer {
  const s = new TapServer({ paths: f.paths, host: HOST, pipePid: process.pid, lineage: () => LINEAGE, state: () => 'detached',
    refused: () => null, ask: async () => null, ...o })
  servers.push(s)
  return s
}

/** A pid that existed a moment ago and is gone now. */
async function deadPid(): Promise<number> {
  const p = Bun.spawn(['/usr/bin/true'])
  await p.exited
  return p.pid
}

describe('pending knocks', () => {
  test('pending knocks merge by seq, keep at most 3 origins, and empty on take', () => {
    const p = makePendingKnocks()
    p.add({ seqs: [5, 3], origins: ['air'] })
    p.add({ seqs: [5, 9], origins: ['nuance/macair', 'air', 'zerone/yu', 'four/th'] })
    expect(p.size()).toBe(3)
    expect(p.take()).toEqual({ count: 3, origins: ['air', 'nuance/macair', 'zerone/yu'], seqs: [3, 5, 9] })
    expect(p.take()).toBeNull()
    p.add({ seqs: [1], origins: ['Air with space'] })
    expect(p.take()).toEqual({ count: 1, origins: [], seqs: [1] })
    const capped = makePendingKnocks(2)
    capped.add({ seqs: [1, 2, 3], origins: ['air'] })
    expect(capped.size()).toBe(2)
    capped.clear()
    expect(capped.take()).toBeNull()
  })
})

describe('the tap socket', () => {
  test('the socket is 0600 in a 0700 dir and the .json names the host', async () => {
    const f = nuanceFixture()
    const s = server(f)
    await s.start()
    const sock = f.paths.pipeSock(HOST.pid, process.pid)
    const json = f.paths.pipeJson(HOST.pid, process.pid)
    expect(modeOf(f.paths.pipes)).toBe(0o700)
    expect(lstatSync(sock).isSocket()).toBe(true)
    expect(lstatSync(sock).mode & 0o777).toBe(0o600)
    expect(modeOf(json)).toBe(0o600)
    expect(JSON.parse(readFileSync(json, 'utf8'))).toEqual({ v: 1, host_pid: HOST.pid, host_lstart: HOST.lstart, pipe_pid: process.pid,
      lineage: LINEAGE, state: 'detached', refused: null })
    s.stop()
    expect(existsSync(sock)).toBe(false)
    expect(existsSync(json)).toBe(false)
  })

  test('one exchange: a count above 0 gets knock_report then CLOSE, zero gets CLOSE', async () => {
    const f = nuanceFixture()
    const answers = [{ count: 2, origins: ['air', 'nuance/macair'], seqs: [4, 7] }, { count: 0, origins: [], seqs: [] }, null]
    const budgets: number[] = []
    const s = server(f, { ask: async (b) => { budgets.push(b); return answers.shift() ?? null } })
    await s.start()
    const sock = f.paths.pipeSock(HOST.pid, process.pid)
    expect(await tapExchange(sock)).toEqual({ frames: ['knock_report', 'CLOSE'], report: { count: 2, origins: ['air', 'nuance/macair'] } })
    expect(await tapExchange(sock)).toEqual({ frames: ['CLOSE'], report: null })
    expect(await tapExchange(sock)).toEqual({ frames: ['CLOSE'], report: null })
    expect(budgets).toEqual([2000, 2000, 2000])
  })

  test('a stale socket file with the same name is replaced', async () => {
    const f = nuanceFixture()
    const sock = f.paths.pipeSock(HOST.pid, process.pid)
    await makeStaleSocket(sock)
    const s = server(f, { ask: async () => ({ count: 1, origins: ['air'], seqs: [1] }) })
    await s.start()
    expect((await tapExchange(sock)).report).toEqual({ count: 1, origins: ['air'] })
  })

  test("a SIGKILLed pipe's files for the same host are removed when the respawned pipe starts, and a live sibling's are kept", async () => {
    const f = nuanceFixture()
    const dead = await deadPid()
    const sibling = Bun.spawn(['/bin/sleep', '30'])
    kids.push(sibling)
    const record = (host: number, pipe: number) => ({ v: 1 as const, host_pid: host, host_lstart: HOST.lstart, pipe_pid: pipe, lineage: null, state: 'ready', refused: null })
    await makeStaleSocket(f.paths.pipeSock(HOST.pid, dead))
    writePipeRecord(f.paths, record(HOST.pid, dead))
    writeFileSync(f.paths.pipeSock(HOST.pid, sibling.pid), '')
    writePipeRecord(f.paths, record(HOST.pid, sibling.pid))
    writePipeRecord(f.paths, record(4200, dead))
    await server(f).start()
    expect(existsSync(f.paths.pipeSock(HOST.pid, dead))).toBe(false)
    expect(existsSync(f.paths.pipeJson(HOST.pid, dead))).toBe(false)
    expect(existsSync(f.paths.pipeSock(HOST.pid, sibling.pid))).toBe(true)
    expect(existsSync(f.paths.pipeJson(HOST.pid, sibling.pid))).toBe(true)
    expect(existsSync(f.paths.pipeJson(4200, dead))).toBe(true)
    expect(pipeRecordName(HOST.pid, process.pid)).toBe(`${HOST.pid}-${process.pid}`)
  })
})

describe('collab-bridge pipe, spawned from source', () => {
  test('collab-bridge pipe answers initialize and tools/list with no hub', async () => {
    const f = nuanceFixture()
    const h = stdioHarness({ argv: PIPE_ARGV, env: { ...f.env, CLAUDE_CODE_ENTRYPOINT: 'cli' }, cwd: f.share })
    kids.push({ kill: () => { try { process.kill(h.pid, 'SIGKILL') } catch { /* gone */ } } })
    const init = await h.initialize()
    expect(init.serverInfo.name).toBe('agenttool-collab-hub')
    expect(init.capabilities).toEqual({ tools: { listChanged: true } })
    expect((await h.listTools()).tools.map((t: any) => t.name).sort()).toEqual(TEST_TOOLS.map((t) => t.name).sort())
    const r = await h.callTool('collab_task_list', {})
    expect(r.structuredContent.error).toBe('hub_away')
    expect(await h.close()).toBe(0)
  }, 20_000)

  test('both files are removed on SIGTERM', async () => {
    const f = nuanceFixture()
    const h = stdioHarness({ argv: PIPE_ARGV, env: { ...f.env, CLAUDE_CODE_ENTRYPOINT: 'cli' }, cwd: f.share })
    kids.push({ kill: () => { try { process.kill(h.pid, 'SIGKILL') } catch { /* gone */ } } })
    await h.initialize()
    const sock = f.paths.pipeSock(HOST.pid, h.pid)
    const json = f.paths.pipeJson(HOST.pid, h.pid)
    await waitFor(() => existsSync(sock) && existsSync(json), 5000, 'the pipe files')
    expect(JSON.parse(readFileSync(json, 'utf8')).host_pid).toBe(HOST.pid)
    process.kill(h.pid, 'SIGTERM')
    // close() ends stdin at once, and a pipe that reads that EOF before it runs its SIGTERM handler exits 0, not 143. Stdin
    // stays open until the files are gone, and only the handler (process.exit(143), then the exit listener) removes them.
    await waitFor(() => !existsSync(sock) && !existsSync(json), 5000, 'the SIGTERM handler to remove the pipe files')
    expect(await h.close()).toBe(143)
    expect(existsSync(sock)).toBe(false)
    expect(existsSync(json)).toBe(false)
  }, 20_000)
})

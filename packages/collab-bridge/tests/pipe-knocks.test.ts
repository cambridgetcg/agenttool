import { afterEach, describe, expect, test } from 'bun:test'
import type { ToolResult } from '../src/link/messages.ts'
import { toolsDigest } from '../src/tools-digest.ts'
import { Pipe } from '../src/nuance/pipe.ts'
import { makeFakeLink, type FakeLink } from './fake-link.ts'
import { cleanupTmps } from './helpers.ts'
import { FAKE_HOST, nuanceFixture, pipeDeps, tapExchange, TEST_TOOLS, waitFor, type NuanceFixture } from './pipe-fixture.ts'

const DIGEST = toolsDigest(TEST_TOOLS)
const OK: ToolResult = { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } }
const pipes: Pipe[] = []
const links: FakeLink[] = []
afterEach(async () => {
  for (const p of pipes.splice(0)) await p.stop()
  for (const l of links.splice(0)) await l.close()
  cleanupTmps()
})

/** A started pipe in a shared folder, attached to a fake hub when `hub` is true. */
async function world(hub = true): Promise<{ f: NuanceFixture; p: Pipe; l: FakeLink | null; sock: string }> {
  const f = nuanceFixture()
  let l: FakeLink | null = null
  if (hub) {
    l = await makeFakeLink(f.paths.hubSock)
    links.push(l)
    l.accept({ ready: { tools_digest: DIGEST } })
  }
  const p = new Pipe(pipeDeps(f))
  pipes.push(p)
  await p.start()
  if (l) {
    await waitFor(() => l!.frames().some((m) => m.t === 'prove'))
    await Bun.sleep(100)
  }
  return { f, p, l, sock: f.paths.pipeSock(FAKE_HOST.pid, process.pid) }
}

const knocks = (l: FakeLink) => l.frames().filter((m) => m.t === 'knocks')
const report = (count: number, origins: string[], seqs: number[]) => ({ t: 'knock_report', count, origins, seqs })
const NONE = report(0, [], [])

describe('the pipe relays a tap to the hub', () => {
  test('with the link down the tap gets CLOSE', async () => {
    const { sock } = await world(false)
    const t0 = performance.now()
    expect(await tapExchange(sock)).toEqual({ frames: ['CLOSE'], report: null })
    expect(performance.now() - t0).toBeLessThan(500)
  })

  test('knocks never asks the hub for more than 2000 ms, and 1800 for a tap', async () => {
    const { p, l, sock } = await world()
    const direct = p.requestKnocks(5000)
    await waitFor(() => knocks(l!).length === 1)
    l!.send(NONE)
    expect(await direct).toBeNull()
    const tap = tapExchange(sock)
    await waitFor(() => knocks(l!).length === 2)
    l!.send(NONE)
    expect(await tap).toEqual({ frames: ['CLOSE'], report: null })
    expect(knocks(l!).map((m) => m.timeout_ms)).toEqual([2000, 1800])
  })

  test('a 5 s link stall shows the line at the following prompt exactly once', async () => {
    const { l, sock } = await world()
    const first = tapExchange(sock)
    await waitFor(() => knocks(l!).length === 1)
    expect(await first).toEqual({ frames: ['CLOSE'], report: null })   // the pipe's 2 s ran out: silence at this prompt
    await Bun.sleep(5000 - 2000)
    l!.send(report(1, ['air'], [11]))                                    // the stalled answer arrives 5 s late
    await Bun.sleep(50)
    const second = tapExchange(sock)
    await waitFor(() => knocks(l!).length === 2)
    l!.send(NONE)
    expect(await second).toEqual({ frames: ['knock_report', 'CLOSE'], report: { count: 1, origins: ['air'] } })
    const third = tapExchange(sock)
    await waitFor(() => knocks(l!).length === 3)
    l!.send(NONE)
    expect(await third).toEqual({ frames: ['CLOSE'], report: null })
  }, 15_000)

  test('a report that arrives after the tap closed shows at the next prompt exactly once', async () => {
    const { l, sock } = await world()
    const gone = tapExchange(sock, { closeAfterMs: 100 })
    await waitFor(() => knocks(l!).length === 1)
    expect(await gone).toEqual({ frames: [], report: null })
    await Bun.sleep(100)
    l!.send(report(1, ['nuance/macair'], [21]))
    await Bun.sleep(100)
    const next = tapExchange(sock)
    await waitFor(() => knocks(l!).length === 2)
    l!.send(NONE)
    expect(await next).toEqual({ frames: ['knock_report', 'CLOSE'], report: { count: 1, origins: ['nuance/macair'] } })
    const after = tapExchange(sock)
    await waitFor(() => knocks(l!).length === 3)
    l!.send(NONE)
    expect((await after).report).toBeNull()
  }, 10_000)

  test('a kept report and a new one merge by seq', async () => {
    const { p, l, sock } = await world()
    const late = p.requestKnocks(300)
    await waitFor(() => knocks(l!).length === 1)
    expect(await late).toBeNull()
    l!.send(report(1, ['air'], [5]))
    await Bun.sleep(50)
    const tap = tapExchange(sock)
    await waitFor(() => knocks(l!).length === 2)
    l!.send(report(2, ['air', 'nuance/macair'], [5, 6]))
    expect((await tap).report).toEqual({ count: 2, origins: ['air', 'nuance/macair'] })
  })

  test('a collab_next result clears the pending report', async () => {
    const { p, l, sock } = await world()
    const late = p.requestKnocks(300)
    await waitFor(() => knocks(l!).length === 1)
    expect(await late).toBeNull()
    l!.send(report(1, ['air'], [31]))
    await Bun.sleep(50)
    const next = p.handleCall(1, 'collab_next', { workspace_id: 'ws_1' })
    const call = await waitFor(() => l!.frames().find((m) => m.t === 'call'))
    l!.send({ t: 'result', call_ref: call.call_ref, outcome: 'ok', result: OK })
    expect(await next).toEqual(OK)
    const tap = tapExchange(sock)
    await waitFor(() => knocks(l!).length === 2)
    l!.send(NONE)
    expect(await tap).toEqual({ frames: ['CLOSE'], report: null })
  })
})

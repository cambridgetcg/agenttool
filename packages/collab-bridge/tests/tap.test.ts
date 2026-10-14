import { afterEach, describe, expect, test } from 'bun:test'
import { encodeFrame, FRAME_TYPE } from '../src/link/frame.ts'
import type { Connect } from '../src/nuance/link-client.ts'
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
    expect(knockLine(1, ['nuance/macair\u202e'])).toBeNull()
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

// K31 (the Air tap lets Cf, bidi and tag characters through): the Nuance line is built only from ORIGIN_RE, which is
// ASCII, so none of these can reach the prompt, whatever sends them.
const K31_CHARS: Array<[string, string]> = [
  ['a NUL', '\u0000'], ['a newline', '\n'], ['a C1 control (U+0085)', '\u0085'], ['a line separator (U+2028)', '\u2028'],
  ['a paragraph separator (U+2029)', '\u2029'], ['a no-break space', '\u00a0'], ['a zero-width space (Cf)', '\u200b'],
  ['a left-to-right mark (Cf)', '\u200e'], ['a bidi embedding (U+202A)', '\u202a'], ['a bidi override (U+202E)', '\u202e'],
  ['a bidi isolate (U+2066)', '\u2066'], ['a pop isolate (U+2069)', '\u2069'], ['a byte order mark (Cf)', '\ufeff'],
  ['a tag character (U+E0041)', '\u{e0041}'],
]

describe('the line carries no character outside the origin pattern (K31)', () => {
  for (const [name, ch] of K31_CHARS) {
    test(`silence for an origin with ${name}, at the end and at the start`, () => {
      expect(knockLine(1, [`nuance/macair${ch}`])).toBeNull()
      expect(knockLine(1, [`${ch}air`])).toBeNull()
      expect(knockLine(1, [`air`, `zerone/yu${ch}`])).toBeNull()
    })
  }
})

// The tap's own refusals (T5, T10): a hub or a stand-in pipe that sends raw frames through a scripted connect, so the tap
// itself (not TapServer, which never sends these) is what refuses. `thrown` collects what the data handler threw: under
// Bun.connect a throw there is an uncaught exception, so it must stay empty.
const utf8 = new TextEncoder()
const dataFrame = (payload: Uint8Array | string) => encodeFrame(FRAME_TYPE.DATA, 0, typeof payload === 'string' ? utf8.encode(payload) : payload)
const reportFrame = (count: unknown, origins: unknown) => dataFrame(JSON.stringify({ t: 'knock_report', count, origins }))
const CLOSE_FRAME = encodeFrame(FRAME_TYPE.CLOSE, 0)
const UNKNOWN_TYPE = Uint8Array.from([0, 0, 0, 0, 99, 0, 0, 0, 0])                   // length 0, type 99, stream 0
const OVERSIZED = Uint8Array.from([0, 0, 0x08, 0, FRAME_TYPE.DATA, 0, 0, 0, 0])      // declares 2048 payload bytes (the cap is 1024)
const cat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]))
const GOOD = reportFrame(1, ['air'])

/** A connect that answers the tap's knocks write with `pushes`, one data call each, then close(); handler throws go to `thrown`. */
function scripted(pushes: Uint8Array[], thrown: unknown[]): Connect {
  return async (_path, h) => ({
    write: () => {
      setTimeout(() => {
        for (const p of pushes) { try { h.data(p) } catch (e) { thrown.push(e) } }
        h.close()
      }, 0)
    },
    end: () => {},
  })
}

/** A live pipe's record for the fake host, with no socket behind it: the scripted connect stands in for it. */
function recordOnly(f: NuanceFixture): void {
  writePipeRecord(f.paths, { v: 1, host_pid: HOST.pid, host_lstart: HOST.lstart, pipe_pid: process.pid, lineage: null, state: 'ready', refused: null })
}

describe('the tap refuses what only a stand-in pipe could send', () => {
  const forged: Array<[string, Uint8Array[]]> = [
    ['a second report in the same push', [cat(GOOD, reportFrame(2, ['air']), CLOSE_FRAME)]],
    ['a second report in a later push', [GOOD, reportFrame(2, ['air']), CLOSE_FRAME]],
    ['a report, then a frame of unknown type, in one push', [cat(GOOD, UNKNOWN_TYPE)]],
    ['a report, then a frame of unknown type, in a later push', [GOOD, UNKNOWN_TYPE, CLOSE_FRAME]],
    ['a report, then an oversized frame, in one push', [cat(GOOD, OVERSIZED)]],
    ['a report, then an oversized frame, in a later push', [GOOD, OVERSIZED, CLOSE_FRAME]],
    ['an oversized frame alone', [OVERSIZED]],
    ['data that is not JSON, then a report', [dataFrame('not json'), GOOD, CLOSE_FRAME]],
    ['data that is not UTF-8, then a report', [dataFrame(Uint8Array.from([0xff, 0xfe])), GOOD, CLOSE_FRAME]],
    ['JSON that is not a report, then a report', [dataFrame('{"t":"knocks"}'), GOOD, CLOSE_FRAME]],
    ['a count of 1000', [reportFrame(1000, ['air']), CLOSE_FRAME]],
    ['a count of 1.5', [reportFrame(1.5, ['air']), CLOSE_FRAME]],
    ['a count of 0', [reportFrame(0, []), CLOSE_FRAME]],
    ['four origins', [reportFrame(1, ['air', 'a/b', 'c/d', 'e/f']), CLOSE_FRAME]],
    ['an origin with a space', [reportFrame(1, ['nuance/mac air']), CLOSE_FRAME]],
    ['an origin with a bidi mark', [reportFrame(1, ['nuance/macair\u202e']), CLOSE_FRAME]],
    ['an origin with a zero-width space (K31)', [reportFrame(1, ['nuance/macair\u200b']), CLOSE_FRAME]],
    ['an origin with a tag character (K31)', [reportFrame(1, ['nuance/macair\u{e0041}']), CLOSE_FRAME]],
    ['a repeated origin', [reportFrame(1, ['air', 'air']), CLOSE_FRAME]],
    ['CLOSE alone', [CLOSE_FRAME]],
  ]
  for (const [name, pushes] of forged) {
    test(`silence on ${name}, and the data handler never throws`, async () => {
      const f = nuanceFixture()
      recordOnly(f)
      const thrown: unknown[] = []
      expect(await runTap(deps(f, { connect: scripted(pushes, thrown) }))).toBeNull()
      expect(thrown).toEqual([])
    })
  }

  test('the same scripted connect shows the line for one good report, whole or split byte by byte', async () => {
    const f = nuanceFixture()
    recordOnly(f)
    const thrown: unknown[] = []
    expect(await runTap(deps(f, { connect: scripted([cat(GOOD, CLOSE_FRAME)], thrown) }))).toBe(hookOutput(ONE) + '\n')
    const bytes = cat(GOOD, CLOSE_FRAME)
    expect(await runTap(deps(f, { connect: scripted(Array.from(bytes, (b) => Uint8Array.of(b)), thrown) }))).toBe(hookOutput(ONE) + '\n')
    expect(thrown).toEqual([])
  })
})

describe('collab-bridge tap, spawned against a socket that sends forged frames', () => {
  const listeners: Array<{ stop(closeActive?: boolean): void }> = []
  afterEach(() => { for (const l of listeners.splice(0)) l.stop(true) })
  const TAP_ARGV = [process.execPath, '--no-env-file', '--config=/dev/null', `${PKG}/src/nuance/main.ts`, 'tap', '--host', 'claude']
  const runTapBinary = async (f: NuanceFixture) => {
    const p = Bun.spawn(TAP_ARGV, { env: f.env, cwd: f.share, stdin: utf8.encode('{"hook_event_name":"UserPromptSubmit","prompt":"hi"}'), stdout: 'pipe', stderr: 'pipe' })
    const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()])
    return { code, out, err }
  }
  /** A pipe record for the fake host, and a raw socket at its path that answers any knock with `bytes`, then ends. */
  const rawPipe = (f: NuanceFixture, bytes: Uint8Array): void => {
    const pid = livePid()
    writePipeRecord(f.paths, { v: 1, host_pid: HOST.pid, host_lstart: HOST.lstart, pipe_pid: pid, lineage: null, state: 'ready', refused: null })
    listeners.push(Bun.listen({ unix: f.paths.pipeSock(HOST.pid, pid), socket: { data(s) { s.write(bytes); s.end() } } }))
  }

  test('the control: one good report from the raw socket prints the envelope', async () => {
    const f = nuanceFixture()
    rawPipe(f, cat(GOOD, CLOSE_FRAME))
    expect(await runTapBinary(f)).toEqual({ code: 0, out: hookOutput(ONE) + '\n', err: '' })
  }, 20_000)

  for (const [name, bytes] of [
    ['two reports', cat(GOOD, reportFrame(2, ['air']))],
    ['a malformed frame after a report', cat(GOOD, UNKNOWN_TYPE)],
    ['an oversized frame', OVERSIZED],
    ['data that is not JSON', dataFrame('not json')],
    ['a count of 1000', reportFrame(1000, ['air'])],
  ] as Array<[string, Uint8Array]>) {
    test(`exits 0 with nothing on stdout or stderr for ${name}`, async () => {
      const f = nuanceFixture()
      rawPipe(f, bytes)
      expect(await runTapBinary(f)).toEqual({ code: 0, out: '', err: '' })
    }, 20_000)
  }

  test('exits 0 with nothing on stdout or stderr when the pipe socket is a stale file (Review Focus 5)', async () => {
    const f = nuanceFixture()
    const pid = livePid()
    await makeStaleSocket(f.paths.pipeSock(HOST.pid, pid))
    writePipeRecord(f.paths, { v: 1, host_pid: HOST.pid, host_lstart: HOST.lstart, pipe_pid: pid, lineage: null, state: 'ready', refused: null })
    expect(await runTapBinary(f)).toEqual({ code: 0, out: '', err: '' })
  }, 20_000)
})

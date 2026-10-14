// The hub's knock read (Task 49; spec §8 items 3–4, §12.2 Tap). Real Collab sessions on this tree's tracked dist, whose
// host bundle carries C10's `knocks --session`, in a temp shared journal; the session index is a plain map here (in the
// hub it is LineageStore.sessionIndex(), Task 39).
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  COLLAB_KNOCK_PROTOCOL, knockReportFor, knocksArgs, mapKnock, parseKnockReport, type CollabKnockReport,
} from '../src/air/knocks.ts'
import { makeHostCli, type HostCli } from '../src/air/pool.ts'
import type { HubKnockReportMsg } from '../src/link/messages.ts'
import { cleanupTmps, COLLAB_DIST, temp } from './helpers.ts'
import { collabHarness, type StdioHarness } from './mcp-harness.ts'

const harnesses: StdioHarness[] = []
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close()
  cleanupTmps()
})

type Index = Map<string, { device: string; user: string }>
const REMOTE = { device: 'nuance', user: 'macair' }
const QUIET: HubKnockReportMsg = { t: 'knock_report', count: 0, origins: [], seqs: [] }

interface World { journal: string; home: string; root: string; hostCli: HostCli; ledger: string }

/** A temp shared journal (created by the first session), its home and a plain folder every session is rooted at. */
function world(): World {
  const dir = temp('cb-knocks-')
  const home = join(dir, 'home')
  const root = join(dir, 'trial')
  mkdirSync(home, { mode: 0o700 })
  mkdirSync(root)
  const journal = join(dir, 'collab-shared', 'collab.sqlite')
  return { journal, home, root, hostCli: makeHostCli({ bun: process.execPath, dist: COLLAB_DIST, journal, home }),
    ledger: join(dirname(journal), 'collab-sessions', 'knock-ledger.json') }
}

interface Session { h: StdioHarness; id: string; workspace: string }

async function session(w: World, actor: string): Promise<Session> {
  const h = collabHarness({ journal: w.journal, home: w.home })
  harnesses.push(h)
  await h.initialize()
  const r = await h.callTool('collab_session_start', { root_path: w.root, actor })
  if (r.isError) throw new Error(`collab_session_start failed: ${r.content[0].text}`)
  return { h, id: r.structuredContent.session.id, workspace: r.structuredContent.workspace.id }
}

/** One report addressed to `to`; returns its journal sequence, which is the knock item's seq. */
async function note(from: Session, to: Session, key: string): Promise<number> {
  const r = await from.h.callTool('collab_report_append', {
    workspace_id: from.workspace, idempotency_key: key, kind: 'observation', body: `note ${key}`, to_session_id: to.id,
  })
  if (r.isError) throw new Error(`collab_report_append failed: ${r.content[0].text}`)
  return r.structuredContent.report.event_sequence
}

const read = (w: World, s: Session, index: Index = new Map()) =>
  knockReportFor(s.id, 2000, { hostCli: w.hostCli, journal: w.journal, index: () => index })

function report(items: Array<{ seq: number; from_session_id?: string | null; from_actor?: string }>, o: Partial<CollabKnockReport> = {}): CollabKnockReport {
  return {
    protocol: COLLAB_KNOCK_PROTOCOL, session_id: 'session_b', liveness: 'live', rest: null, waiting: items.length,
    new: items.map((i) => ({ seq: i.seq, kind: 'report.posted', from_actor: i.from_actor ?? 'someone', ref_id: `report_${i.seq}`,
      ...(i.from_session_id === undefined ? {} : { from_session_id: i.from_session_id }) })),
    ...o,
  }
}

describe('the C10 read and its parser', () => {
  test('knocksArgs is the session-addressed read, marking, with senders, on the shared journal', () => {
    expect(knocksArgs('session_b', '/j/collab.sqlite')).toEqual(
      ['knocks', '--session', 'session_b', '--mark-tapped', '--with-sender', '--db', '/j/collab.sqlite'])
  })

  test('parseKnockReport keeps the fields it knows and refuses a malformed line', () => {
    const line = JSON.stringify({ protocol: COLLAB_KNOCK_PROTOCOL, session_id: 's1', liveness: 'resting',
      rest: { mode: 'resting', since: '2026-10-13T00:00:00.000Z', until: null, reason: null, wake_on: [] }, waiting: 1,
      new: [{ seq: 4, kind: 'report.posted', from_actor: 'a', ref_id: 'r', from_session_id: 's0' }] }) + '\n'
    expect(parseKnockReport(line)).toEqual({ protocol: COLLAB_KNOCK_PROTOCOL, session_id: 's1', liveness: 'resting',
      rest: { wake_on: [] }, waiting: 1, new: [{ seq: 4, kind: 'report.posted', from_actor: 'a', ref_id: 'r', from_session_id: 's0' }] })
    const good = JSON.parse(line)
    for (const bad of ['', 'garbage', '{}', `${line}${line}`,
      JSON.stringify({ ...good, protocol: 'agenttool.collab-knock/2' }),
      JSON.stringify({ ...good, liveness: 'asleep' }),
      JSON.stringify({ ...good, waiting: -1 }),
      JSON.stringify({ ...good, rest: { wake_on: 'addressed' } }),
      JSON.stringify({ ...good, new: [{ seq: 'four', kind: 'report.posted', from_actor: 'a', ref_id: 'r' }] }),
      JSON.stringify({ ...good, new: [{ seq: 4, kind: 'report.posted', from_actor: 'a', ref_id: 'r', from_session_id: 7 }] })]) {
      expect(parseKnockReport(bad)).toBeNull()
    }
  })
})

describe('mapKnock', () => {
  test('origins are deduplicated and at most 3', () => {
    const index: Index = new Map([['s1', REMOTE], ['s2', REMOTE], ['s4', { device: 'zerone', user: 'yu' }], ['s5', { device: 'other', user: 'u' }]])
    const r = report([{ seq: 3, from_session_id: 's1' }, { seq: 5, from_session_id: 's2' }, { seq: 6, from_session_id: 's3' },
      { seq: 8, from_session_id: 's4' }, { seq: 9, from_session_id: 's5' }])
    expect(mapKnock(r, index)).toEqual({ count: 5, origins: ['nuance/macair', 'air', 'zerone/yu'], seqs: [3, 5, 6, 8, 9] })
  })

  test('an index entry that would not make a valid origin is never one', () => {
    const index: Index = new Map([['s1', { device: 'Nuance', user: 'mac air' }]])
    expect(mapKnock(report([{ seq: 3, from_session_id: 's1' }]), index)).toEqual({ count: 1, origins: [], seqs: [3] })
  })

  test('null, an ended or held-resting session and no new items are count 0; a rest that consents still counts', () => {
    const zero = { count: 0, origins: [], seqs: [] }
    const one = [{ seq: 3, from_session_id: null }]
    expect(mapKnock(null, new Map())).toEqual(zero)
    expect(mapKnock(report([]), new Map())).toEqual(zero)
    expect(mapKnock(report(one, { liveness: 'ended' }), new Map())).toEqual(zero)
    expect(mapKnock(report(one, { liveness: 'resting', rest: { wake_on: [] } }), new Map())).toEqual(zero)
    expect(mapKnock(report(one, { liveness: 'resting', rest: { wake_on: ['addressed'] } }), new Map())).toEqual({ count: 1, origins: ['air'], seqs: [3] })
  })
})

describe('knockReportFor on a real shared journal', () => {
  test('an addressed note from an Air session shows origin air', async () => {
    const w = world()
    const remote = await session(w, 'nuance/macair · self-declared: claude')
    const air = await session(w, 'air-agent')
    const seq = await note(air, remote, 'n1')
    expect(await read(w, remote, new Map([[remote.id, REMOTE]]))).toEqual({ t: 'knock_report', count: 1, origins: ['air'], seqs: [seq] })
  }, 30_000)

  test('a note from a stamped remote session shows its device/user', async () => {
    const w = world()
    const addressee = await session(w, 'air-agent')
    const sender = await session(w, 'nuance/macair · self-declared: claude')
    const seq = await note(sender, addressee, 'n1')
    expect(await read(w, addressee, new Map([[sender.id, REMOTE]]))).toEqual({ t: 'knock_report', count: 1, origins: ['nuance/macair'], seqs: [seq] })
  }, 30_000)

  test('a forged from_actor never becomes an origin', async () => {
    const w = world()
    const remote = await session(w, 'nuance/macair · self-declared: claude')
    // An Air session may call itself anything; only the hub's session index can make a device/user origin (K31, K63).
    const forger = await session(w, 'zerone/yu · self-declared: forged')
    const seq = await note(forger, remote, 'n1')
    expect(await read(w, remote, new Map([[remote.id, REMOTE]]))).toEqual({ t: 'knock_report', count: 1, origins: ['air'], seqs: [seq] })
    expect(mapKnock(report([{ seq: 3, from_actor: 'nuance/macair', from_session_id: null }]), new Map()).origins).toEqual(['air'])
  }, 30_000)

  test('the second read is count 0: one tap per note', async () => {
    const w = world()
    const remote = await session(w, 'nuance/macair · self-declared: claude')
    const air = await session(w, 'air-agent')
    const first = await note(air, remote, 'n1')
    expect(await read(w, remote)).toEqual({ t: 'knock_report', count: 1, origins: ['air'], seqs: [first] })
    expect(await read(w, remote)).toEqual(QUIET)
    const second = await note(air, remote, 'n2')
    expect(await read(w, remote)).toEqual({ t: 'knock_report', count: 1, origins: ['air'], seqs: [second] })
    expect(await read(w, remote)).toEqual(QUIET)
  }, 30_000)

  test('a tapped but unacknowledged note gives silence', async () => {
    const w = world()
    const remote = await session(w, 'nuance/macair · self-declared: claude')
    const air = await session(w, 'air-agent')
    await note(air, remote, 'n1')
    expect(await read(w, remote)).toMatchObject({ count: 1 })
    // collab_next reads the note but acknowledges nothing: it is still waiting, and still never tapped twice.
    const next = await remote.h.callTool('collab_next', { workspace_id: remote.workspace })
    expect(next.structuredContent.session.addressed_waiting).toBe(1)
    expect(await read(w, remote)).toEqual(QUIET)
    const peek = await w.hostCli(['knocks', '--session', remote.id, '--db', w.journal], 2000)
    expect(parseKnockReport(peek.stdout)).toMatchObject({ waiting: 1, new: [] })
  }, 30_000)

  test('a resting remote session is silent at two reads, shows one note after it returns, then is silent', async () => {
    const w = world()
    const remote = await session(w, 'nuance/macair · self-declared: claude')
    const air = await session(w, 'air-agent')
    // What the hub forwards for a remote rest (§6.3): wake_on [] (R29).
    const rest = await remote.h.callTool('collab_session_rest', { workspace_id: remote.workspace, idempotency_key: 'r1', mode: 'resting', wake_on: [] })
    expect(rest.isError).toBeFalsy()
    const seq = await note(air, remote, 'n1')
    expect(await read(w, remote)).toEqual(QUIET)
    expect(await read(w, remote)).toEqual(QUIET)
    expect(existsSync(w.ledger)).toBe(false) // a held rest is never marked (K29)
    const back = await remote.h.callTool('collab_session_rest', { workspace_id: remote.workspace, idempotency_key: 'r2', mode: 'ready' })
    expect(back.isError).toBeFalsy()
    expect(await read(w, remote)).toEqual({ t: 'knock_report', count: 1, origins: ['air'], seqs: [seq] })
    expect(await read(w, remote)).toEqual(QUIET)
  }, 30_000)

  test('under 1 s left answers expired and leaves the knock ledger unchanged', async () => {
    const w = world()
    const remote = await session(w, 'nuance/macair · self-declared: claude')
    const air = await session(w, 'air-agent')
    await note(air, remote, 'n1')
    expect(await read(w, remote)).toMatchObject({ count: 1 }) // the ledger file now exists
    const seq = await note(air, remote, 'n2')
    const before = readFileSync(w.ledger)
    const calls: string[][] = []
    const counting: HostCli = (args, ms) => { calls.push(args); return w.hostCli(args, ms) }
    const o = { hostCli: counting, journal: w.journal, index: () => new Map() as Index }
    expect(await knockReportFor(remote.id, 999, o)).toEqual({ t: 'knock_report', expired: true })
    expect(await knockReportFor(remote.id, 0, o)).toEqual({ t: 'knock_report', expired: true })
    expect(calls).toEqual([])
    expect(readFileSync(w.ledger).equals(before)).toBe(true)
    // Nothing was marked, so the note still taps at the next read with time enough.
    expect(await knockReportFor(remote.id, 2000, o)).toEqual({ t: 'knock_report', count: 1, origins: ['air'], seqs: [seq] })
  }, 30_000)

  test('an ended session is count 0', async () => {
    const w = world()
    const remote = await session(w, 'nuance/macair · self-declared: claude')
    const air = await session(w, 'air-agent')
    await note(air, remote, 'n1')
    const end = await remote.h.callTool('collab_session_end', { reason: 'done' })
    expect(end.isError).toBeFalsy()
    expect(await read(w, remote)).toEqual(QUIET)
    expect(mapKnock(report([{ seq: 3, from_session_id: null }], { liveness: 'ended' }), new Map())).toEqual({ count: 0, origins: [], seqs: [] })
  }, 30_000)
})

describe('knockReportFor around the host CLI', () => {
  const fake = (answer: () => Promise<{ code: number | null; stdout: string; stderr: string }>) => {
    const calls: Array<{ args: string[]; ms: number }> = []
    const cli: HostCli = (args, ms) => { calls.push({ args, ms }); return answer() }
    return { cli, calls }
  }
  const line = (session_id: string) => JSON.stringify({ protocol: COLLAB_KNOCK_PROTOCOL, session_id, liveness: 'live', rest: null, waiting: 1,
    new: [{ seq: 7, kind: 'report.posted', from_actor: 'a', ref_id: 'r', from_session_id: null }] }) + '\n'

  test('the host CLI gets the C10 arguments and 200 ms less than the budget', async () => {
    const { cli, calls } = fake(async () => ({ code: 0, stdout: line('session_b'), stderr: '' }))
    expect(await knockReportFor('session_b', 1800, { hostCli: cli, journal: '/j/collab.sqlite', index: () => new Map() }))
      .toEqual({ t: 'knock_report', count: 1, origins: ['air'], seqs: [7] })
    expect(calls).toEqual([{ args: knocksArgs('session_b', '/j/collab.sqlite'), ms: 1600 }])
    // The 1 s rule's edge: 999 ms never runs the CLI, 1000 ms runs it with 800 ms.
    expect(await knockReportFor('session_b', 999, { hostCli: cli, journal: '/j/collab.sqlite', index: () => new Map() }))
      .toEqual({ t: 'knock_report', expired: true })
    await knockReportFor('session_b', 1000, { hostCli: cli, journal: '/j/collab.sqlite', index: () => new Map() })
    expect(calls.map((c) => c.ms)).toEqual([1600, 800])
  })

  test('a failing, timed-out, garbled or throwing host CLI is count 0', async () => {
    const answers = [
      async () => ({ code: 1, stdout: line('session_b'), stderr: 'boom' }),
      async () => ({ code: null, stdout: '', stderr: '' }),
      async () => ({ code: 0, stdout: 'not json\n', stderr: '' }),
      async (): Promise<{ code: number | null; stdout: string; stderr: string }> => { throw new Error('spawn failed') },
    ]
    for (const answer of answers) {
      const { cli } = fake(answer)
      expect(await knockReportFor('session_b', 2000, { hostCli: cli, journal: '/j', index: () => new Map() })).toEqual(QUIET)
    }
  })

  test('a report for another session is count 0', async () => {
    const { cli } = fake(async () => ({ code: 0, stdout: line('session_other'), stderr: '' }))
    expect(await knockReportFor('session_b', 2000, { hostCli: cli, journal: '/j', index: () => new Map() })).toEqual(QUIET)
  })
})

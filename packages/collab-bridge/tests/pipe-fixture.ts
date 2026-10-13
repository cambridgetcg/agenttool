// A Nuance pipe world for the pipe, tap-server and tap tests (Tasks 30–32): a temp Nuance home with INSTALLED, a seat key,
// a seeded tool list and shares.json, a shared git folder, a fake process table, and a Pipe's deps. Never exported from a
// *.test.ts (Summon ruling R1). Every dir comes from temp()/testEnv()'s short socket root, so afterEach(cleanupTmps) removes it.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readLedger } from '../src/ledger.ts'
import type { ToolDef, ToolResult } from '../src/link/messages.ts'
import { writeFileDurable } from '../src/native.ts'
import { nuancePaths, type NuancePaths } from '../src/paths.ts'
import type { ProcRecord, ProcTable } from '../src/proc.ts'
import { toolsDigest } from '../src/tools-digest.ts'
import { renderInstalled, writeShares, type InstalledInfo } from '../src/nuance/installed.ts'
import type { PipeDeps } from '../src/nuance/pipe.ts'
import { writeSeatKeyIfAbsent } from '../src/nuance/seatkey.ts'
import { seedTools } from '../src/nuance/tools-cache.ts'
import { makeRepo, REAL_GIT, temp, testEnv } from './helpers.ts'
import { testInstalled as nuanceInstalled } from './nuance-home.ts'

const tool = (name: string, description: string): ToolDef => ({
  name, description, inputSchema: { type: 'object', properties: {}, additionalProperties: true }, annotations: { readOnlyHint: false },
})

/** A small seat tool list: every tool the pipe tests call, and nothing else. */
export const TEST_TOOLS: ToolDef[] = [
  tool('collab_session_start', 'Start a session.'),
  tool('collab_session_end', 'End the session.'),
  tool('collab_next', 'Read what is new.'),
  tool('collab_cursor_ack', 'Acknowledge a cursor.'),
  tool('collab_task_list', 'List tasks.'),
  tool('collab_task_create', 'Create a task.'),
  tool('collab_task_claim', 'Claim a task.'),
  tool('collab_task_complete', 'Complete a task.'),
  tool('collab_task_recover', 'Recover an expired lease.'),
  tool('collab_report_append', 'Append a report.'),
]

/** The fake claude host every fake table chains to; lstart in Collab's squeezed form (one space before the day). */
export const FAKE_HOST = { pid: 4100, lstart: 'Wed Oct 7 16:22:59 2026', comm: 'claude' } as const

/** `selfPid` as a child of the fake claude host, or (host: null) of launchd with no claude anywhere. */
export function fakeTable(selfPid: number = process.pid, host: { pid: number; lstart: string; comm: string } | null = FAKE_HOST): ProcTable {
  const rows: ProcRecord[] = [{ pid: selfPid, ppid: host ? host.pid : 1, started_at: 'Tue Oct 13 11:33:11 2026', comm: 'collab-bridge' }]
  if (host) rows.push({ pid: host.pid, ppid: 1, started_at: host.lstart, comm: host.comm })
  return new Map(rows.map((r) => [r.pid, r]))
}

/** A git repo with one commit on `main` (Task 27's makeRepo, the trial shape), by its realpath. */
export function gitRepo(prefix = 'cb-share-'): string {
  const dir = temp(prefix)
  makeRepo(dir)
  return dir
}

/** Task 21's INSTALLED with the pipe world's values: the seeded tool list's digest and a recorded git the pipe never runs. */
export function testInstalled(o: Partial<InstalledInfo> = {}): InstalledInfo {
  return nuanceInstalled({
    build: '1a2b3c4d', tools_seed: toolsDigest(TEST_TOOLS),
    git: { path: REAL_GIT, version: '2.52.0', sha256: 'b'.repeat(64), guard: true, apple: false },
    summon_dropin_stat: '1 2 3 501 600', ...o,
  })
}

export interface NuanceFixture { home: string; env: Record<string, string>; paths: NuancePaths; share: string; installed: InstalledInfo }

/**
 * A Nuance home as `install write` leaves it: INSTALLED, the seat key, the seeded tool list, shares.json naming `share`
 * (or another folder, with shared: false) and the 0700 state dirs. `share` is a git repo unless gitRepo: false.
 */
export function nuanceFixture(o: { shared?: boolean; gitRepo?: boolean; env?: Record<string, string> } = {}): NuanceFixture {
  const home = temp('cb-nuance-')
  const env = testEnv(home, o.env ?? {})
  const paths = nuancePaths(home, env)
  const share = o.gitRepo === false ? temp('cb-plain-') : gitRepo()
  const installed = testInstalled()
  for (const d of [paths.share, paths.state, paths.run, paths.pipes, paths.lineages, paths.tools]) mkdirSync(d, { recursive: true, mode: 0o700 })
  writeFileDurable(paths.installed, renderInstalled(installed), 0o600)
  writeSeatKeyIfAbsent(paths)
  seedTools(paths, TEST_TOOLS, toolsDigest(TEST_TOOLS))
  const sharedPath = o.shared === false ? join(temp('cb-other-'), 'elsewhere') : share
  writeShares(paths, [{ realpath: sharedPath, gitdir: join(sharedPath, '.git') }])
  return { home, env, paths, share, installed }
}

export interface TestPipeDeps extends PipeDeps { lines: string[] }

/** Deps for an in-process Pipe in `f.share`, hosted by the fake claude, with an interactive entrypoint and a stdin that never ends. */
export function pipeDeps(f: NuanceFixture, o: Partial<PipeDeps> = {}): TestPipeDeps {
  const lines: string[] = []
  return {
    paths: f.paths, env: { ...f.env, CLAUDE_CODE_ENTRYPOINT: 'cli' }, cwd: f.share, selfPid: process.pid,
    table: () => fakeTable(), ttyOf: () => 'ttys001', mono: () => performance.now(), now: () => new Date(), rand: Math.random,
    stdin: new ReadableStream<Uint8Array>({ start() {} }), write: (line: string) => { lines.push(line) }, installed: f.installed, user: 'macair',
    ...o, lines,
  }
}

/** Polls `fn` every 10 ms until it returns something truthy; fails after `ms`. */
export async function waitFor<T>(fn: () => T | null | undefined | false, ms = 5000, what = 'condition'): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`waitFor: ${what} not met within ${ms} ms`)
    await Bun.sleep(10)
  }
}

/** The error code of a bridge failure, or null for a Collab result. */
export const codeOf = (r: ToolResult): string | null => (r.isError === true && typeof r.structuredContent?.error === 'string' ? r.structuredContent.error : null)

/** The parsed JSON-RPC lines a pipe wrote. */
export const written = (d: TestPipeDeps): any[] => d.lines.map((l) => JSON.parse(l))

/** Ledger events in the Nuance ledger, oldest first. */
export const ledgerEvents = (paths: NuancePaths): string[] => {
  try { return readLedger(paths.ledger).map((e) => e.event) } catch { return [] }
}


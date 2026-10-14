// One hermetic Phase 1 world (spec §12.1), run through the steps of the live test (§12.3 steps 2–8) in miniature, then
// the hub killed mid-session_start (§12.2 At most once), then the same flow through the compiled Nuance binary, then a
// real Collab child call held past the pipe deadline by a held journal lock (§12.2 At most once). The tests in each
// describe share one world and run in order. The world outlives each test, so this file removes its temp dirs after
// each describe (afterAll) instead of after each test.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDevice } from '../src/air/devices.ts'
import { LineageStore } from '../src/air/lineages.ts'
import { mirrorIdOf } from '../src/air/mirror.ts'
import { airPaths, nuancePaths } from '../src/paths.ts'
import { pidAlive } from '../src/proc.ts'
import { buildNuance, type NuanceBuild } from '../scripts/build-nuance.ts'
import { cleanupTmps, repoGit, sha256File, testDropin } from './helpers.ts'
import type { StdioHarness } from './mcp-harness.ts'
import { makeWorld, waitFor, WORLD_USER, type World } from './world.ts'

const SEAT = `nuance/${WORLD_USER}`
const TASK = 't-notes-1'
/** A token no ledger key can ever hold: it goes into the task title, the report body and the note file (§12.3 step 8). */
const MARK = 'cdc-7f3a-e2e-marker'
const KNOCK_LINE = 'Collab: 1 note(s) addressed to you are waiting (from air). Read them with collab_next when you choose; nothing is required.'
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The Nuance pipe is up once its record says ready (written on every link transition, Task 31). */
const pipeReady = (w: World) => w.pipeStates().includes('ready')

describe('one Phase 1 world through the source binaries (spec §12.3 in miniature)', () => {
  let w: World
  let nuance: StdioHarness
  let air: StdioHarness
  let base = ''
  let sessionId = ''
  let workspaceId = ''
  let airSessionId = ''
  let version = 0
  let leaseId = ''
  let head = ''
  let mirrorPath = ''

  beforeAll(async () => {
    w = await makeWorld()
    base = repoGit(w.airClone, ['rev-parse', 'HEAD'])
    mirrorPath = airPaths(w.air).mirrorDir('nuance', WORLD_USER, mirrorIdOf(w.nuanceShare))
  }, 120_000)

  afterAll(async () => {
    await w?.close()
    cleanupTmps()
  }, 60_000)

  test('initialize and tools/list answer before the hub starts', async () => {
    nuance = w.pipe()
    const init = await nuance.initialize()
    expect(init.serverInfo.name).toBe('agenttool-collab-hub')
    expect(init.instructions).toContain(`You are a remote seat, shown as ${SEAT}.`)
    const listed = await nuance.listTools()
    expect(listed.tools).toHaveLength(24)
    const away = await nuance.callTool('collab_session_start', { actor: 'claude (Nuance account)' })
    expect(away.isError).toBe(true)
    expect(away.structuredContent).toMatchObject({ error: 'hub_away', delivered: false, retry: 'never automatic' })
  }, 30_000)

  test('the Nuance session starts with the stamped actor', async () => {
    await w.startHub()
    await waitFor('the pipe to attach', () => pipeReady(w))
    const s = await nuance.callTool('collab_session_start', { actor: 'claude (Nuance account)', role: 'trial worker' })
    expect(s.isError).toBeUndefined()
    const sc = s.structuredContent
    sessionId = sc.session.id
    workspaceId = sc.workspace.id
    expect(sc.session.actor).toBe(`${SEAT} · self-declared: claude (Nuance account)`)
    expect(sc.session.role).toMatch(new RegExp(`^remote\\(${esc(SEAT)}; start=[0-9a-f]{16}\\) self-declared: harness=claude; trial worker$`))
    expect(sc.worktree.root_path).toBe(mirrorPath)
    // The hub recorded the mirror's worktree id and confirmed the workspace id pin-device derived (§7.2, P55).
    const share = readDevice(airPaths(w.air).deviceFile('nuance'))!.shares[0]!
    expect([share.mirror_worktree_id, share.workspace_id]).toEqual([sc.worktree.id, workspaceId])
    // The entrypoint label reached the hub's attach line (S2's Nuance answer, P38).
    expect(w.hubLedger().find((e) => e.event === 'attach')).toMatchObject({ device: 'nuance', user: WORLD_USER, code: 'cli' })
  }, 60_000)

  test('an Air task, an addressed report and one knock line at the next tap, once', async () => {
    air = w.airSession()
    await air.initialize()
    const a = await air.callTool('collab_session_start', { root_path: w.airClone, actor: 'air reviewer', role: 'reviewer' })
    expect(a.isError).toBeUndefined()
    airSessionId = a.structuredContent.session.id
    expect(a.structuredContent.workspace.id).toBe(workspaceId) // the clone and the mirror share one workspace (§7.1)
    const t = await air.callTool('collab_task_create', { workspace_id: workspaceId, idempotency_key: 'e2e-create', task_id: TASK,
      title: `write a note ${MARK}`, work_mode: 'edit', path_scopes: ['notes'], completion_policy: 'accepted', expected_base_sha: base })
    expect(t.isError).toBeUndefined()
    version = t.structuredContent.task.version
    const r = await air.callTool('collab_report_append', { workspace_id: workspaceId, idempotency_key: 'e2e-note', kind: 'proposal',
      body: `please take ${TASK} ${MARK}`, to_session_id: sessionId })
    expect(r.isError).toBeUndefined()
    expect(r.structuredContent.addressee.delivery).toBe('tap')
    const line = await w.tap()
    expect(line === null ? null : JSON.parse(line)).toEqual({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: KNOCK_LINE } })
    expect(await w.tap()).toBeNull() // one tap per note
  }, 60_000)

  test("claim, commit, complete: the tasks ref exists and the limits begin with the hub's stamp", async () => {
    const c = await nuance.callTool('collab_task_claim', { task_id: TASK, idempotency_key: 'e2e-claim', expected_version: version })
    expect(c.isError).toBeUndefined()
    const claimed = c.structuredContent.task
    expect(claimed.claim_worktree_id).toBe(readDevice(airPaths(w.air).deviceFile('nuance'))!.shares[0]!.mirror_worktree_id)
    leaseId = claimed.lease_id
    version = claimed.version
    head = w.commitOnNuance({ 'notes/a.md': `a note from the Nuance seat ${MARK}\n` }, 'notes: a note from the Nuance seat')
    const done = await nuance.callTool('collab_task_complete', { task_id: TASK, lease_id: leaseId, idempotency_key: 'e2e-complete',
      expected_version: version, summary: `wrote notes/a.md ${MARK}`, limits: `none known ${MARK}` })
    expect(done.isError).toBeUndefined()
    const task = done.structuredContent.task
    expect([task.review_status, task.result_checkpoint.head_sha]).toEqual(['pending', head])
    const ref = `refs/collab/nuance/${WORLD_USER}/${mirrorIdOf(w.nuanceShare)}/tasks/${TASK}`
    expect(repoGit(w.airClone, ['rev-parse', ref])).toBe(head)
    const reports = (await air.callTool('collab_report_list', { workspace_id: workspaceId, task_id: TASK })).structuredContent.reports
    const completion = reports.find((x: { id: string }) => x.id === task.completion_report_id)
    expect(completion.limits).toBe(`hub-observed: fetched ${head} from ${SEAT} via git-upload-pack v0; remote clean self-declared\n` +
      `remote self-declared: none known ${MARK}`)
  }, 60_000)

  test('the Air session reviews the diff of the tasks ref and accepts; the accepted head is the Nuance commit', async () => {
    const ref = `refs/collab/nuance/${WORLD_USER}/${mirrorIdOf(w.nuanceShare)}/tasks/${TASK}`
    const diff = repoGit(w.airClone, ['diff', '--no-ext-diff', '--no-textconv', base, ref])
    expect(diff).toContain('+++ b/notes/a.md')
    expect(diff).toContain(`+a note from the Nuance seat ${MARK}`)
    const got = await air.callTool('collab_task_get', { workspace_id: workspaceId, task_id: TASK })
    const rv = await air.callTool('collab_task_review', { workspace_id: workspaceId, task_id: TASK, idempotency_key: 'e2e-review',
      expected_version: got.structuredContent.task.version, outcome: 'accept', summary: 'read the diff of the tasks ref' })
    expect(rv.isError).toBeUndefined()
    expect(rv.structuredContent.task).toMatchObject({ review_status: 'accepted', accepted_by_session_id: airSessionId })
    expect(rv.structuredContent.task.result_checkpoint.head_sha).toBe(head)
  }, 60_000)

  test('a dropped link answers hub_away, heals on its own, and the next call succeeds on the same session', async () => {
    const attaches = () => w.hubLedger().filter((e) => e.event === 'attach').length
    const before = attaches()
    await w.dropLink()
    const t0 = Date.now()
    const away = await nuance.callTool('collab_next', {})
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(away.structuredContent).toMatchObject({ error: 'hub_away', delivered: false })
    w.fakeSsh.setFail255(null) // the Wi-Fi is back: nobody touches the pipe
    await waitFor('the hub to redial and the pipe to re-attach on its own', () => attaches() > before && pipeReady(w), 30_000)
    const next = await nuance.callTool('collab_next', {})
    expect(next.isError).toBeUndefined()
    expect(next.structuredContent.session.id).toBe(sessionId)
    const last = w.hubLedger().filter((e) => e.event === 'forward' && e.tool === 'collab_next').at(-1)
    expect(last?.session_id).toBe(sessionId)
  }, 60_000)

  test('the checks of §12.3 step 8 hold', async () => {
    const v = await air.callTool('collab_journal_verify', { workspace_id: workspaceId })
    expect(v.structuredContent.chain_valid).toBe(true)
    const ledger = w.hubLedger()
    const forwards = ledger.filter((e) => e.event === 'forward')
    const perRef = new Map<string, number>()
    for (const f of forwards) perRef.set(String(f.call_ref), (perRef.get(String(f.call_ref)) ?? 0) + 1)
    expect([...perRef.values()].filter((n) => n !== 1)).toEqual([])
    expect(new Set(forwards.map((f) => f.journal))).toEqual(new Set([airPaths(w.air).sharedJournal]))
    // Each ok remote mutation has its event in the shared journal, and the remote seat wrote no other kind of event.
    const ok = (tool: string) => forwards.filter((f) => f.tool === tool
      && ledger.some((e) => e.event === 'result' && e.call_ref === f.call_ref && e.outcome === 'ok')).length
    const events = (await air.callTool('collab_events_since', { workspace_id: workspaceId, limit: 500 })).structuredContent.events
    const remote = events.filter((e: { actor: unknown }) => typeof e.actor === 'string' && e.actor.startsWith(`${SEAT} · `))
    const count = (type: string) => remote.filter((e: { type: string }) => e.type === type).length
    expect([count('session.joined'), count('task.claimed'), count('task.reported_complete')])
      .toEqual([ok('collab_session_start'), ok('collab_task_claim'), ok('collab_task_complete')])
    expect([ok('collab_session_start'), ok('collab_task_claim'), ok('collab_task_complete')]).toEqual([1, 1, 1])
    // The Nuance session started before any Air session, so its mirror opened the shared workspace (§6.3, T23).
    expect(new Set(remote.map((e: { type: string }) => e.type)))
      .toEqual(new Set(['workspace.opened', 'session.joined', 'task.claimed', 'report.posted', 'task.reported_complete']))
    // Both ledgers are content-free: the marker in the title, the report body and the note file is in neither.
    const np = nuancePaths(w.nuance, { HOME: w.nuance, COLLAB_BRIDGE_HOME_OVERRIDE: w.nuance, COLLAB_BRIDGE_SOCK_ROOT: w.sockRoot,
      COLLAB_BRIDGE_SUMMON_DROPIN: testDropin(w.nuance) })
    expect(w.nuanceLedger().length).toBeGreaterThan(0)
    for (const file of [airPaths(w.air).ledger, np.ledger]) expect({ file, marked: readFileSync(file, 'utf8').includes(MARK) }).toEqual({ file, marked: false })
    expect(existsSync(airPaths(w.air).privateJournal)).toBe(false)
  }, 60_000)
})

describe('a hub SIGKILLed mid-session_start (§12.2 At most once, §9.3 item 8)', () => {
  let w: World
  afterAll(async () => {
    await w?.close()
    cleanupTmps()
  }, 60_000)

  test('a hub SIGKILLed mid-session_start leaves exactly one active session after restart', async () => {
    w = await makeWorld()
    await w.startHub()
    const p = w.pipe()
    await p.initialize()
    await waitFor('the pipe to attach', () => pipeReady(w))
    const store = () => { const s = new LineageStore(airPaths(w.air).lineages); s.load(); return s.all() }
    const first = p.callTool('collab_session_start', { actor: 'first try' })
    // The durable pending_start marker is written before the forward and cleared before the answer (§9.3 item 8): kill
    // the hub the moment it is on disk.
    let marker: { child_pid: number } | null = null
    await waitFor('the pending_start marker', () => {
      marker = existsSync(airPaths(w.air).lineages) ? store().find((e) => e.pending_start !== null)?.pending_start ?? null : null
      return marker !== null
    }, 30_000)
    await w.killHub('SIGKILL')
    expect((await first).structuredContent).toMatchObject({ error: 'hub_outcome_unknown', delivered: 'unknown' })
    const child = (marker as { child_pid: number } | null)!.child_pid
    await waitFor('the orphaned Collab child to exit', () => !pidAlive(child), 30_000)
    await w.startHub()
    await waitFor('the pipe to re-attach', () => pipeReady(w))
    const second = await p.callTool('collab_session_start', { actor: 'second try' })
    // Either reconcile recorded the session the child committed (Collab answers session_already_bound from the resumed
    // child), or nothing was committed and this start made the one session.
    expect([undefined, 'session_already_bound']).toContain(second.structuredContent?.error)
    expect((await p.callTool('collab_next', {})).isError).toBeUndefined()
    const ws = readDevice(airPaths(w.air).deviceFile('nuance'))!.shares[0]!.workspace_id!
    const air = w.airSession()
    await air.initialize()
    await air.callTool('collab_session_start', { root_path: w.airClone, actor: 'air checker' })
    const st = await air.callTool('collab_workspace_status', { workspace_id: ws })
    const remote = st.structuredContent.active_sessions.filter((s: { role: string | null }) => (s.role ?? '').startsWith(`remote(${SEAT};`))
    expect(remote).toHaveLength(1)
    expect(store().filter((e) => e.pending_start !== null)).toEqual([])
  }, 180_000)
})

describe('the compiled Nuance binary', () => {
  let buildRoot = ''
  let built: NuanceBuild
  let w: World

  beforeAll(() => {
    buildRoot = realpathSync(mkdtempSync(join(tmpdir(), 'cb-e2e-build-')))
    built = buildNuance(join(buildRoot, 'out'))
  }, 120_000)

  afterAll(async () => {
    await w?.close()
    cleanupTmps()
    if (buildRoot) rmSync(buildRoot, { recursive: true, force: true })
  }, 60_000)

  test('the same flow from session start to a knock and a fetch works through the compiled Nuance binary', async () => {
    w = await makeWorld({ compiled: built })
    const installed = nuancePaths(w.nuance, { HOME: w.nuance, COLLAB_BRIDGE_HOME_OVERRIDE: w.nuance, COLLAB_BRIDGE_SOCK_ROOT: w.sockRoot,
      COLLAB_BRIDGE_SUMMON_DROPIN: testDropin(w.nuance) }).binary
    expect(sha256File(installed)).toBe(built.sha256) // the installer put the compiled binary in place, byte for byte
    await w.startHub()
    const p = w.pipe()
    await p.initialize()
    await waitFor('the pipe to attach', () => pipeReady(w))
    const s = await p.callTool('collab_session_start', { actor: 'compiled seat' })
    expect(s.isError).toBeUndefined()
    expect(s.structuredContent.session.actor).toBe(`${SEAT} · self-declared: compiled seat`)
    const ws = s.structuredContent.workspace.id
    const air = w.airSession()
    await air.initialize()
    await air.callTool('collab_session_start', { root_path: w.airClone, actor: 'air reviewer' })
    const t = await air.callTool('collab_task_create', { workspace_id: ws, idempotency_key: 'c-create', task_id: TASK, title: 'a compiled note',
      work_mode: 'edit', path_scopes: ['notes'], completion_policy: 'accepted', expected_base_sha: repoGit(w.airClone, ['rev-parse', 'HEAD']) })
    await air.callTool('collab_report_append', { workspace_id: ws, idempotency_key: 'c-note', kind: 'proposal', body: 'please take it',
      to_session_id: s.structuredContent.session.id })
    const line = await w.tap()
    expect(line === null ? null : JSON.parse(line).hookSpecificOutput.additionalContext).toBe(KNOCK_LINE)
    const fetchesBefore = w.hubLedger().filter((e) => e.event === 'fetch' && e.outcome === 'ok').length
    const c = await p.callTool('collab_task_claim', { task_id: TASK, idempotency_key: 'c-claim', expected_version: t.structuredContent.task.version })
    expect(c.isError).toBeUndefined()
    expect(w.hubLedger().filter((e) => e.event === 'fetch' && e.outcome === 'ok').length).toBe(fetchesBefore + 1)
    expect(w.nuanceLedger().filter((e) => e.event === 'gate').map((e) => e.form)).toContain('upload-pack')
  }, 180_000)
})

describe('a real child call held past the pipe deadline (§12.2 At most once)', () => {
  // At 0.05 the pipe's default deadline is 3000 ms, below Collab's own busy_timeout of 5000 ms, which P33 does not scale.
  // At the world's 0.1 the deadline is 6000 ms, and Collab answers its own internal_error "database is locked" first
  // (measured: 5004 ms), which the hub passes through as error, rightly (§9.3 item 4). If session_start's 3000 ms is too
  // short on this Air, 0.07 with a release at 4600 ms is the fallback (a 4200 ms deadline, still inside the 5 s wait).
  const SCALE = 0.05
  const RELEASE_MS = 4_000
  let w: World
  let lock: ReturnType<typeof Bun.spawn> | null = null

  afterAll(async () => {
    if (lock !== null && lock.exitCode === null) { lock.kill('SIGKILL'); await lock.exited }
    await w?.close()
    cleanupTmps()
  }, 60_000)

  test('a held journal write lock answers hub_outcome_unknown at the pipe deadline, never error; the late result is ledgered, never cancelled, and the next call carries prior_unknown', async () => {
    w = await makeWorld({ timeScale: SCALE })
    await w.startHub()
    const p = w.pipe()
    await p.initialize()
    await waitFor('the pipe to attach', () => pipeReady(w))
    const s = await p.callTool('collab_session_start', { actor: 'held lock' })
    expect(s.isError).toBeUndefined()
    const ws = s.structuredContent.workspace.id
    // Another process holds the shared journal's write lock, as a long write on the Air would.
    const l = Bun.spawn(['/usr/bin/sqlite3', airPaths(w.air).sharedJournal], { cwd: '/', stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { PATH: '/usr/bin:/bin' } })
    lock = l
    l.stdin.write("BEGIN IMMEDIATE;\nSELECT 'locked';\n")
    l.stdin.flush()
    const first = await (l.stdout as ReadableStream<Uint8Array>).getReader().read()
    expect(new TextDecoder().decode(first.value)).toContain('locked')
    const t0 = Date.now()
    const pending = p.callTool('collab_report_append', { workspace_id: ws, idempotency_key: 'held-1', kind: 'observation', body: 'held lock note' })
    // The hub writes its `call` line when the call arrives; `forward` and `result` only once the child answers (Task 51).
    const took = () => w.hubLedger().find((e) => e.event === 'call' && e.tool === 'collab_report_append')
    await waitFor('the hub to take the call', () => took() !== undefined)
    const tookAt = Date.now()
    const ref = String(took()!.call_ref)
    const r = await pending
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2_700)
    expect(r.isError).toBe(true)
    expect(r.structuredContent).toMatchObject({ error: 'hub_outcome_unknown', delivered: 'unknown', retry: 'never automatic' })
    // The child is still in Collab's busy wait: the hub has neither forwarded nor settled this call yet.
    expect(w.hubLedger().filter((e) => e.call_ref === ref && (e.event === 'forward' || e.event === 'result'))).toEqual([])
    await Bun.sleep(Math.max(0, tookAt + RELEASE_MS - Date.now()))
    l.stdin.write('ROLLBACK;\n.quit\n')
    l.stdin.end()
    await l.exited
    await waitFor('the late result', () => w.nuanceLedger().some((e) => e.event === 'late_result' && e.call_ref === ref), 10_000)
    expect(w.nuanceLedger().find((e) => e.event === 'late_result' && e.call_ref === ref)?.outcome).toBe('ok')
    expect(w.nuanceLedger().find((e) => e.event === 'call_unknown' && e.call_ref === ref)?.code).toBe('deadline')
    const mine = w.hubLedger().filter((e) => e.call_ref === ref)
    expect(mine.filter((e) => e.event === 'forward')).toHaveLength(1)
    expect(mine.filter((e) => e.event === 'result').map((e) => e.outcome)).toEqual(['ok']) // the child answered: never cancelled
    expect(mine.some((e) => e.event === 'cancel')).toBe(false) // the pipe's deadline sends no cancel either
    const next = await p.callTool('collab_next', {})
    expect(next.isError).toBeUndefined()
    // The same Collab session is still bound, so the note may advise a same-key replay (session_ended false, P66).
    expect(next.structuredContent.prior_unknown).toEqual([{ call_ref: ref, tool: 'collab_report_append', idempotency_key: 'held-1', session_ended: false }])
    const air = w.airSession()
    await air.initialize()
    await air.callTool('collab_session_start', { root_path: w.airClone, actor: 'air checker' })
    const reports = (await air.callTool('collab_report_list', { workspace_id: ws })).structuredContent.reports
    expect(reports.filter((x: { body: string }) => x.body.includes('held lock note'))).toHaveLength(1) // it took effect once
  }, 120_000)
})

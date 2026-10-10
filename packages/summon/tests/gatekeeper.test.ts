import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  describeCommand, liveGateDeps, parseCommand, readBoundedStdin, requestCancel, requestInventory, resultOf, sanitizeForLog, statusOf,
} from '../src/gatekeeper.ts'
import { findClaude } from '../src/harness.ts'
import { writeJsonAtomic, writeState, type JobState } from '../src/jobs.ts'
import { verifyLedger } from '../src/ledger.ts'
import { summonPaths } from '../src/paths.ts'
import { MAX_START_STDIN_BYTES, newRequestId } from '../src/request.ts'
import { cleanupTmps, DEFAULT_ALLOWLIST, runGatekeeper, sampleRequest, targetHome } from './helpers.ts'

afterEach(cleanupTmps)

const stateOf = (id: string, status: JobState['status']): JobState => ({
  id, status, runtime: 'claude', model: 'sonnet', access: 'review', cwd_real: '/x',
  admitted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 9e5).toISOString(), timeout_s: 900,
})

describe('parseCommand', () => {
  const id = 'smn_' + 'a'.repeat(32)
  test('accepts exactly the five verbs', () => {
    expect(parseCommand('inventory')).toEqual({ verb: 'inventory' })
    expect(parseCommand('start')).toEqual({ verb: 'start' })
    expect(parseCommand(`status ${id}`)).toEqual({ verb: 'status', id })
    expect(parseCommand(`result ${id}`)).toEqual({ verb: 'result', id })
    expect(parseCommand(`cancel ${id}`)).toEqual({ verb: 'cancel', id })
  })
  test('refuses every variant', () => {
    for (const raw of [undefined, '', ' start', 'start ', 'start\n', 'start;ls', 'start && ls', 'START', 'ls -la',
      `status  ${id}`, `status\t${id}`, `status ${id} x`, 'status smn_../../etc/passwd', `status smn_${'a'.repeat(31)}`,
      `status smn_${'٣'.repeat(32)}`, 'scp -t /tmp', 'internal-sftp', 'inventory\u0000',
      `status ${id}\n`, ` status ${id}`, `status ${id};ls`, `status smn_${'A'.repeat(32)}`, `status smn_${'a'.repeat(33)}`,
      'status', 'status ', `Status ${id}`, `inventory ${id}`, `start ${id}`, `status ${id}\u0000`]) {
      expect(parseCommand(raw)).toBeNull()
    }
  })
})

describe('sanitizeForLog', () => {
  test('keeps printable ASCII, masks the rest, bounds the length', () => {
    expect(sanitizeForLog('ls -la')).toBe('ls -la')
    expect(sanitizeForLog(undefined)).toBe('<none>')
    expect(sanitizeForLog('a\nb\x1b[31mc\u0000')).toBe('a?b?[31mc?')
    expect(sanitizeForLog('日本語')).toBe('???')
    expect(sanitizeForLog('x'.repeat(500))).toHaveLength(60)
  })
})

describe('describeCommand', () => {
  test('is content-free: byte length, and the first token only when it looks like a program name', () => {
    expect(describeCommand(undefined)).toBe('unset')
    expect(describeCommand('')).toBe('len 0, first token not shown')
    expect(describeCommand('ls -la')).toBe('len 6, first token "ls"')
    expect(describeCommand('scp -t /tmp')).toBe('len 11, first token "scp"')
    expect(describeCommand('internal-sftp')).toBe('len 13, first token "internal-sftp"')
    expect(describeCommand('claude -p "Summarise Yu\'s private notes in ~/Documents/x"')).toBe('len 57, first token "claude"')
    expect(describeCommand('ls\n\u001b[31mred')).toBe('len 11, first token "ls"')
  })
  test('a first token that is not a plain program name is not shown', () => {
    for (const raw of ['START', 'start;ls', ' start', '../../bin/sh', '$(id)', '1abc', 'Summarise this', 'x'.repeat(17)]) {
      expect(describeCommand(raw)).toMatch(/first token not shown$/)
    }
    expect(describeCommand('x'.repeat(16))).toBe(`len 16, first token "${'x'.repeat(16)}"`)
  })
  test('the length is in UTF-8 bytes', () => {
    expect(describeCommand('日本語')).toBe('len 9, first token not shown')
  })
})

describe('readBoundedStdin', () => {
  test('stops at the limit', async () => {
    const big = new Blob(['x'.repeat(2000)]).stream()
    expect(await readBoundedStdin(big, 1000)).toMatchObject({ tooLarge: true })
    expect(await readBoundedStdin(new Blob(['hello']).stream(), 1000)).toEqual({ text: 'hello', tooLarge: false })
  })
  test('the limit counts bytes: exactly max is read, one more is too large', async () => {
    expect(await readBoundedStdin(new Blob(['x'.repeat(1000)]).stream(), 1000)).toMatchObject({ tooLarge: false })
    expect(await readBoundedStdin(new Blob(['x'.repeat(1001)]).stream(), 1000)).toMatchObject({ tooLarge: true })
    expect(await readBoundedStdin(new Blob(['語'.repeat(334)]).stream(), 1000)).toMatchObject({ tooLarge: true }) // 1002 bytes, 334 chars
  })
  test('reassembles chunks, including a multibyte character split across them', async () => {
    const bytes = new TextEncoder().encode('a語b')
    const split = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes.slice(0, 2)); c.enqueue(bytes.slice(2)); c.close() },
    })
    expect(await readBoundedStdin(split, 1000)).toEqual({ text: 'a語b', tooLarge: false })
  })
})

describe('status, result and cancel', () => {
  test('cancel writes a cancel marker for an active job', () => {
    const h = targetHome(); const paths = summonPaths(h); const id = newRequestId()
    writeState(paths, stateOf(id, 'running'))
    expect(requestCancel(paths, 'nuance', id, Date.now())).toMatchObject({ status: 'running', detail: 'cancel requested' })
    expect(existsSync(join(paths.jobs, id, 'cancel'))).toBe(true)
    expect(statusOf(paths, 'nuance', id, Date.now())).toMatchObject({ status: 'running', heartbeat_age_s: null })
    expect(readFileSync(paths.ledger, 'utf8')).toContain('cancel_requested')
    expect(verifyLedger(paths.ledger)).toMatchObject({ ok: true })
  })
  test('cancel leaves a finished job alone', () => {
    const h = targetHome(); const paths = summonPaths(h); const id = newRequestId()
    writeState(paths, stateOf(id, 'completed'))
    expect(requestCancel(paths, 'nuance', id, Date.now())).toMatchObject({ status: 'completed', handle: `nuance/${id}` })
    expect(existsSync(join(paths.jobs, id, 'cancel'))).toBe(false)
  })
  test('an id this Mac has never seen is unknown for all three', () => {
    const paths = summonPaths(targetHome()); const id = newRequestId(); const now = Date.now()
    for (const r of [statusOf(paths, 'nuance', id, now), resultOf(paths, 'nuance', id, now), requestCancel(paths, 'nuance', id, now)]) {
      expect(r).toMatchObject({ status: 'unknown' })
    }
  })
  test('status carries the heartbeat age, reason and detail', () => {
    const h = targetHome(); const paths = summonPaths(h); const id = newRequestId(); const now = Date.now()
    writeState(paths, { ...stateOf(id, 'unknown'), reason: 'runner_died', detail: 'runner restarted' })
    const hb = join(paths.jobs, id, 'heartbeat')
    writeFileSync(hb, '')
    utimesSync(hb, (now - 42_000) / 1000, (now - 42_000) / 1000)
    expect(statusOf(paths, 'nuance', id, now)).toMatchObject({
      status: 'unknown', handle: `nuance/${id}`, reason: 'runner_died', detail: 'runner restarted', heartbeat_age_s: 42,
    })
  })
  test('result returns result.json with the handle; before it exists, falls back to status', () => {
    const h = targetHome(); const paths = summonPaths(h); const id = newRequestId(); const now = Date.now()
    writeState(paths, stateOf(id, 'running'))
    expect(resultOf(paths, 'nuance', id, now)).toMatchObject({ status: 'running', handle: `nuance/${id}` })
    writeJsonAtomic(join(paths.jobs, id, 'result.json'), { status: 'completed', result_text: 'done', exit_code: 0 })
    expect(resultOf(paths, 'nuance', id, now)).toEqual({ status: 'completed', result_text: 'done', exit_code: 0, handle: `nuance/${id}` })
  })
})

describe('requestInventory', () => {
  test('writes a spool request and returns the fresh inventory the runner produces', async () => {
    const paths = summonPaths(targetHome()); const now = Date.now()
    const answer = (async () => {
      for (let i = 0; i < 40 && !existsSync(paths.spool); i++) await Bun.sleep(25)
      await Bun.sleep(100)
      writeJsonAtomic(paths.inventory, { device: 'nuance', claude: true })
    })()
    const r = await requestInventory(paths, now, 5000)
    await answer
    expect(r).toEqual({ status: 'completed', inventory: { device: 'nuance', claude: true } })
    expect(readdirSync(paths.spool)).toContain(`inventory-${now}.req`)
  })
  test('a stale inventory is not an answer; the runner not answering is unknown, not a guess', async () => {
    const paths = summonPaths(targetHome()); const now = Date.now()
    mkdirSync(paths.state, { recursive: true })
    writeJsonAtomic(paths.inventory, { device: 'nuance', old: true })
    utimesSync(paths.inventory, (now - 60_000) / 1000, (now - 60_000) / 1000)
    expect(await requestInventory(paths, now, 400)).toMatchObject({ status: 'unknown' })
  })
})

describe('liveGateDeps', () => {
  const OVERRIDES = ['SUMMON_HOME_OVERRIDE', 'SUMMON_TEST_GUI', 'SUMMON_TEST_RUNNER', 'SUMMON_CLAUDE_BIN'] as const
  function withEnv<T>(env: Partial<Record<(typeof OVERRIDES)[number], string>>, fn: () => T): T {
    const saved = Object.fromEntries(OVERRIDES.map((k) => [k, process.env[k]]))
    for (const k of OVERRIDES) delete process.env[k]
    Object.assign(process.env, env)
    try { return fn() } finally {
      for (const k of OVERRIDES) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    }
  }

  test('the test overrides are honoured only when SUMMON_HOME_OVERRIDE is set', () => {
    const h = targetHome(); const paths = summonPaths(h)
    const on = withEnv({ SUMMON_HOME_OVERRIDE: h, SUMMON_TEST_GUI: '1', SUMMON_TEST_RUNNER: '1', SUMMON_CLAUDE_BIN: '/bin/echo' }, () => {
      const d = liveGateDeps(paths)
      return { gui: d.guiSessionIsMine(), runner: d.runnerLoaded(), claude: d.claudeAvailable(), bin: findClaude(h) }
    })
    expect(on).toEqual({ gui: true, runner: true, claude: true, bin: '/bin/echo' })

    // Without SUMMON_HOME_OVERRIDE the same flags must change nothing: compare against the flags absent.
    const real = withEnv({}, () => {
      const d = liveGateDeps(paths)
      return { gui: d.guiSessionIsMine(), runner: d.runnerLoaded(), claude: d.claudeAvailable(), bin: findClaude(h) }
    })
    const flagged = withEnv({ SUMMON_TEST_GUI: '1', SUMMON_TEST_RUNNER: '1', SUMMON_CLAUDE_BIN: '/bin/echo' }, () => {
      const d = liveGateDeps(paths)
      return { gui: d.guiSessionIsMine(), runner: d.runnerLoaded(), claude: d.claudeAvailable(), bin: findClaude(h) }
    })
    expect(flagged).toEqual(real)
    expect(flagged.bin).not.toBe('/bin/echo')
  })

  test('without overrides the runner is asked of launchd', () => {
    const h = targetHome()
    const uid = process.getuid!()
    const asked = spawnSync('/bin/launchctl', ['print', `gui/${uid}/dev.summon.runner`], { stdio: 'ignore', timeout: 3000 }).status === 0
    expect(withEnv({}, () => liveGateDeps(summonPaths(h)).runnerLoaded())).toBe(asked)
  })
})

describe('gatekeeper-main', () => {
  test('refuses a shell request as malformed', async () => {
    const r = await runGatekeeper(targetHome(), 'ls -la')
    expect(r).toMatchObject({ code: 2, out: { status: 'refused', reason: 'malformed' } })
  })
  test('refuses when no command is given (interactive login attempt)', async () => {
    const r = await runGatekeeper(targetHome(), undefined)
    expect(r).toMatchObject({ code: 2, out: { status: 'refused', reason: 'malformed' } })
  })
  test('every malformed SSH_ORIGINAL_COMMAND variant is refused(malformed) with exit 2, never a crash', async () => {
    const id = 'smn_' + 'a'.repeat(32)
    const h = targetHome()
    for (const cmd of ['', ' start', 'start ', 'start\n', 'start;ls', 'start && ls', `status  ${id}`, `status\t${id}`,
      `status ${id}\n`, `status smn_${'٣'.repeat(32)}`, 'scp -t /tmp', 'internal-sftp', 'sh -c "id"']) {
      expect(await runGatekeeper(h, cmd)).toMatchObject({ code: 2, out: { status: 'refused', reason: 'malformed' } })
    }
  })
  test('a refused command is recorded in the ledger as a content-free descriptor, and the ledger still verifies', async () => {
    const h = targetHome(); const paths = summonPaths(h)
    await runGatekeeper(h, 'ls\n\u001b[31mred ' + 'z'.repeat(200))
    const [entry, ...rest] = readFileSync(paths.ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    expect(rest).toHaveLength(0)
    expect(entry).toMatchObject({ event: 'bad_command', detail: `len ${Buffer.byteLength('ls\n\u001b[31mred ' + 'z'.repeat(200))}, first token "ls"` })
    expect(readFileSync(paths.ledger, 'utf8')).not.toContain('\u001b')
    expect(verifyLedger(paths.ledger)).toMatchObject({ ok: true, entries: 1 })
  })
  test('a prompt-like command never reaches the ledger beyond its first token', async () => {
    const h = targetHome(); const paths = summonPaths(h)
    const cmd = `claude -p "Summarise Yu's private notes in ~/Documents/x"`
    expect(await runGatekeeper(h, cmd)).toMatchObject({ code: 2, out: { status: 'refused', reason: 'malformed' } })
    const ledger = readFileSync(paths.ledger, 'utf8')
    expect(JSON.parse(ledger.trim())).toMatchObject({ event: 'bad_command', detail: 'len 57, first token "claude"' })
    for (const word of ['Summarise', 'private', 'notes', 'Documents', 'Yu', '-p']) expect(ledger).not.toContain(word)
    await runGatekeeper(h, undefined)
    expect(readFileSync(paths.ledger, 'utf8')).toContain('"detail":"unset"')
    expect(verifyLedger(paths.ledger)).toMatchObject({ ok: true, entries: 2 })
  })
  test('a refused command still gets its one-line answer when the ledger cannot be written', async () => {
    const h = targetHome()
    mkdirSync(join(h, '.local/state'), { recursive: true })
    writeFileSync(join(h, '.local/state/summon'), 'a file, not a directory')
    expect(await runGatekeeper(h, 'ls -la')).toMatchObject({ code: 2, out: { status: 'refused', reason: 'malformed' } })
  })
  test('start admits; status reports queued', async () => {
    const h = targetHome(); const req = sampleRequest()
    expect(await runGatekeeper(h, 'start', JSON.stringify(req))).toMatchObject({ code: 0, out: { status: 'admitted' } })
    expect((await runGatekeeper(h, `status ${req.id}`)).out).toMatchObject({ status: 'queued', handle: `nuance/${req.id}` })
    expect(existsSync(join(h, '.local/state/summon/spool', req.id))).toBe(true)
  })
  test('a gate refusal is an answer: exit 0, one JSON line', async () => {
    const h = targetHome()
    expect(await runGatekeeper(h, 'start', JSON.stringify(sampleRequest({ cwd: '~/Elsewhere' }))))
      .toMatchObject({ code: 0, out: { status: 'refused', reason: 'outside_allowlist' } })
  })
  test('start refuses an oversized stdin as too_large, logs the refusal, and admits nothing', async () => {
    const h = targetHome(); const paths = summonPaths(h)
    const r = await runGatekeeper(h, 'start', 'x'.repeat(MAX_START_STDIN_BYTES + 1))
    expect(r).toMatchObject({ code: 0, out: { status: 'refused', reason: 'too_large' } })
    expect(existsSync(join(h, '.local/state/summon/jobs'))).toBe(false)
    expect(existsSync(join(h, '.local/state/summon/spool'))).toBe(false)
    const entries = readFileSync(paths.ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ event: 'refused', reason: 'too_large', detail: 'request exceeds 160 KiB' })
    expect(readFileSync(paths.ledger, 'utf8')).not.toContain('xxxx')
    expect(verifyLedger(paths.ledger)).toMatchObject({ ok: true, entries: 1 })
  })
  test('start refuses a non-JSON body as malformed', async () => {
    expect((await runGatekeeper(targetHome(), 'start', 'not json')).out).toMatchObject({ status: 'refused', reason: 'malformed' })
  })
  test('two concurrent starts of the same id: one admitted, one replayed', async () => {
    const h = targetHome(); const body = JSON.stringify(sampleRequest())
    const [a, b] = await Promise.all([runGatekeeper(h, 'start', body), runGatekeeper(h, 'start', body)])
    expect([a, b].map((r) => r.out.reason ?? r.out.status).sort()).toEqual(['admitted', 'replayed'])
    expect(readdirSync(join(h, '.local/state/summon/jobs'))).toHaveLength(1)
  })
  test('two concurrent starts with different ids and max_concurrent 1: one admitted, one busy', async () => {
    const h = targetHome(DEFAULT_ALLOWLIST.replace('starts_per_hour: 6', 'starts_per_hour: 100'))
    const [a, b] = await Promise.all([
      runGatekeeper(h, 'start', JSON.stringify(sampleRequest())),
      runGatekeeper(h, 'start', JSON.stringify(sampleRequest())),
    ])
    expect([a, b].map((r) => r.out.reason ?? r.out.status).sort()).toEqual(['admitted', 'busy'])
    expect(readdirSync(join(h, '.local/state/summon/jobs'))).toHaveLength(1)
    expect(readdirSync(join(h, '.local/state/summon/spool'))).toHaveLength(1)
  })
  test('unknown id reports unknown, never a path error', async () => {
    expect((await runGatekeeper(targetHome(), `status smn_${'b'.repeat(32)}`)).out).toMatchObject({ status: 'unknown' })
    expect((await runGatekeeper(targetHome(), `result smn_${'b'.repeat(32)}`)).out).toMatchObject({ status: 'unknown' })
    expect((await runGatekeeper(targetHome(), `cancel smn_${'b'.repeat(32)}`)).out).toMatchObject({ status: 'unknown' })
  })
  test('result and cancel work end to end on an admitted job', async () => {
    const h = targetHome(); const req = sampleRequest()
    await runGatekeeper(h, 'start', JSON.stringify(req))
    expect((await runGatekeeper(h, `cancel ${req.id}`)).out).toMatchObject({ status: 'queued', detail: 'cancel requested' })
    expect(existsSync(join(h, '.local/state/summon/jobs', req.id, 'cancel'))).toBe(true)
    expect((await runGatekeeper(h, `result ${req.id}`)).out).toMatchObject({ status: 'queued', handle: `nuance/${req.id}` })
  })
  test('inventory asks the runner and relays what it writes', async () => {
    const h = targetHome(); const paths = summonPaths(h)
    const run = runGatekeeper(h, 'inventory')
    for (let i = 0; i < 200; i++) {
      if (existsSync(paths.spool) && readdirSync(paths.spool).some((n) => n.startsWith('inventory-'))) break
      await Bun.sleep(25)
    }
    writeJsonAtomic(paths.inventory, { device: 'nuance', claude: { available: true } })
    expect(await run).toMatchObject({ code: 0, out: { status: 'completed', inventory: { device: 'nuance' } } })
  })

  test('any throw answers unknown, exit 1, one line, never refused (the outcome is uncertain)', async () => {
    const h = targetHome()
    mkdirSync(join(h, '.local/state'), { recursive: true })
    writeFileSync(join(h, '.local/state/summon'), 'a file, not a directory') // the job store cannot be created
    const r = await runGatekeeper(h, 'start', JSON.stringify(sampleRequest()))
    expect(r.code).toBe(1)
    expect(r.out.status).toBe('unknown')
    expect(r.out.reason).toBeUndefined()
    expect(r.out.detail).toStartWith('gatekeeper error: ')
    expect(r.out.detail).not.toMatch(/[^\x20-\x7e]/)
    expect(r.out.detail.length).toBeLessThanOrEqual('gatekeeper error: '.length + 60)
  })
})

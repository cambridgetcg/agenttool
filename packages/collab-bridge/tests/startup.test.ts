import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CollabChild, type ChildSpec, type StartFailure } from '../src/air/children.ts'
import { classifyStart, PINNED_START_MESSAGES, type StartClass } from '../src/air/startup.ts'
import { COLLAB_DIST, cleanupTmps, temp } from './helpers.ts'
import { startCollabSession, tamperJournal } from './mcp-harness.ts'

afterEach(cleanupTmps)

/** A temp home, a shared-journal path under it and a plain mirror dir: never a real journal (P35). */
function world() {
  const home = temp('cb-start-')
  const journal = join(home, '.local', 'share', 'agenttool', 'collab-shared', 'collab.sqlite')
  const root = join(home, 'mirror')
  mkdirSync(root)
  const spec: ChildSpec = { bun: process.execPath, dist: COLLAB_DIST, journal, home }
  return { home, journal, root, spec }
}

/** Starts a child that must fail, and classifies its last ✖ line. */
async function failedStart(spec: ChildSpec): Promise<{ failure: StartFailure; cls: StartClass }> {
  const r = await CollabChild.start(spec)
  if (!('failed' in r)) {
    await r.stop()
    throw new Error('the child started')
  }
  return { failure: r, cls: classifyStart(r.lastErrLine) }
}

describe('the pinned start-up messages', () => {
  test('every pinned message occurs in the tracked dist', () => {
    expect(PINNED_START_MESSAGES).toHaveLength(10)
    for (const { message } of PINNED_START_MESSAGES) {
      const r = Bun.spawnSync(['/usr/bin/grep', '-cF', message, join(COLLAB_DIST, 'agenttool-collab-mcp.js')], { env: { PATH: '/usr/bin:/bin' } })
      expect(Number(r.stdout.toString().trim())).toBeGreaterThanOrEqual(1)
    }
  })

  test('each pinned message maps to its class', () => {
    expect(classifyStart('✖ The host and persisted session cursors require an explicit audited reset')).toBe('seat_recovery_required')
    expect(classifyStart('✖ A workspace event journal failed hash-chain verification')).toBe('journal_invalid')
    expect(classifyStart('✖ Session credentials are invalid')).toBe('seat_session_ended')
    expect(classifyStart('✖ Could not read the local session credential file')).toBe('seat_session_ended')
    expect(PINNED_START_MESSAGES.filter((m) => m.class === 'seat_session_ended')).toHaveLength(8)
    expect(classifyStart(null)).toBe('child_start_failed')
    expect(classifyStart('✖ The SQLite file belongs to another application')).toBe('child_start_failed')
  })

  test('a line that only contains a pinned message is not a match', () => {
    for (const { message } of PINNED_START_MESSAGES) {
      for (const line of [message, `✖ Error: ${message}`, `✖ ${message}.`, ` ✖ ${message}`, `✖  ${message}`, `✖ ${message} (retry)`, `x ✖ ${message}`]) {
        expect(classifyStart(line)).toBe('child_start_failed')
      }
    }
  })
})

describe('start-up classification against the tracked dist', () => {
  test('a tampered event hash is journal_invalid', async () => {
    const w = world()
    await startCollabSession({ journal: w.journal, home: w.home, root: w.root, actor: 'tester' })
    tamperJournal(w.journal)
    const { failure, cls } = await failedStart(w.spec)
    expect(failure.lastErrLine).toBe('✖ A workspace event journal failed hash-chain verification')
    expect(failure.exitCode).toBe(1)
    expect(cls).toBe('journal_invalid')
  }, 20_000)

  test('a credential whose cursor no longer matches is seat_recovery_required', async () => {
    const w = world()
    const s = await startCollabSession({ journal: w.journal, home: w.home, root: w.root, actor: 'tester' })
    const credential = JSON.parse(readFileSync(s.credentialFile, 'utf8'))
    expect(credential.last_cursor.sequence).toBeGreaterThanOrEqual(0)
    credential.last_cursor = { ...credential.last_cursor, sequence: credential.last_cursor.sequence + 1000 }
    writeFileSync(s.credentialFile, JSON.stringify(credential)) // an existing file keeps its 0600
    expect(statSync(s.credentialFile).mode & 0o777).toBe(0o600)
    const { failure, cls } = await failedStart({ ...w.spec, sessionFile: s.credentialFile })
    expect(failure.lastErrLine).toBe('✖ The host and persisted session cursors require an explicit audited reset')
    expect(cls).toBe('seat_recovery_required')
  }, 20_000)

  test('a malformed credential file is seat_session_ended', async () => {
    const w = world()
    const s = await startCollabSession({ journal: w.journal, home: w.home, root: w.root, actor: 'tester' })
    writeFileSync(s.credentialFile, JSON.stringify({ format: 'agenttool.collab/session-file/0' }))
    const { failure, cls } = await failedStart({ ...w.spec, sessionFile: s.credentialFile })
    expect(failure.lastErrLine).toBe('✖ Session credential file has an unsupported or malformed format')
    expect(cls).toBe('seat_session_ended')
  }, 20_000)

  test('a missing credential file is seat_session_ended', async () => {
    const w = world()
    const s = await startCollabSession({ journal: w.journal, home: w.home, root: w.root, actor: 'tester' })
    const { failure, cls } = await failedStart({ ...w.spec, sessionFile: join(s.credentialFile, '..', 'gone.json') })
    expect(failure.lastErrLine).toBe('✖ Could not read the local session credential file')
    expect(cls).toBe('seat_session_ended')
  }, 20_000)

  test('a journal path that is a directory is child_start_failed', async () => {
    const w = world()
    mkdirSync(w.journal, { recursive: true })
    const { failure, cls } = await failedStart(w.spec)
    expect(failure.lastErrLine).toBe('✖ The collaboration database path must be a non-linked regular file owned by this user')
    expect(cls).toBe('child_start_failed')
  }, 20_000)
})

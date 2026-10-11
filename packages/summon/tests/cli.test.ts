import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCli, runCli, splitJsonFlag, type CliDeps } from '../src/cli.ts'
import { verifyLedger } from '../src/ledger.ts'
import { mapSshFailure, sshCall } from '../src/ssh.ts'
import { cleanupTmps, trackTmp } from './helpers.ts'

afterEach(cleanupTmps)

const BIN = join(import.meta.dir, '..', 'bin', 'summon.ts')

/**
 * A stand-in for `ssh`. It records its argv, counts its calls, copies the ledger as it stood when it was called,
 * and reads all of stdin. `pre` runs after stdin is read and before the canned answer (use it to hang, die, or
 * break the ledger once the `sent` entry is written); `@DIR@` in it stands for the fake's own directory.
 */
function fakeSsh(exit: number, stdout: string, stderr = '', pre = ''): { bin: string; dir: string } {
  const dir = trackTmp(mkdtempSync(join(tmpdir(), 'summon-cli-')))
  writeFileSync(join(dir, 'out'), stdout)
  writeFileSync(join(dir, 'err'), stderr)
  const bin = join(dir, 'ssh')
  writeFileSync(bin, `#!/bin/bash
printf '%s\\n' "$@" > "${dir}/argv"
echo x >> "${dir}/calls"
cp "${dir}/ledger.jsonl" "${dir}/ledger-at-call" 2>/dev/null
cat > "${dir}/stdin"
${pre.replaceAll('@DIR@', dir)}
cat "${dir}/out"
cat "${dir}/err" >&2
exit ${exit}
`, { mode: 0o755 })
  return { bin, dir }
}
const calls = (dir: string) => (existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean).length : 0)
const lines = (path: string) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

const deps = (bin: string, dir: string, over: Partial<CliDeps> = {}): CliDeps => ({
  sshBin: bin, sshConfig: join(dir, 'config'), ledgerPath: join(dir, 'ledger.jsonl'), device: 'air',
  nowMs: () => Date.now(), readFile: (p) => readFileSync(p, 'utf8'), readStdin: () => 'from stdin', ...over,
})
function startArgv(dir: string, extra: string[] = []): string[] {
  writeFileSync(join(dir, 't.md'), 'Read the README 愛')
  return ['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/Projects/x', '--review', '--prompt-file', join(dir, 't.md'), ...extra]
}
const HANDLE_RE = /^nuance\/smn_[0-9a-f]{32}$/

describe('parseCli', () => {
  test('parses a start', () => {
    expect(parseCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/Projects/x', '--review', '--prompt-file', 't.md']))
      .toMatchObject({ kind: 'start', device: 'nuance', runtime: 'claude', model: 'sonnet', cwd: '~/Projects/x', access: 'review', promptFile: 't.md' })
  })
  test('requires model, cwd and a prompt', () => {
    expect(parseCli(['nuance', 'claude', '--cwd', '~/x', '--prompt-file', 't'])).toHaveProperty('error')
    expect(parseCli(['nuance', 'claude', '--model', 'sonnet', '--prompt-file', 't'])).toHaveProperty('error')
    expect(parseCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/x'])).toHaveProperty('error')
  })
  test('defaults to review with 15 minute timeout and expiry; --edit and durations are honoured', () => {
    expect(parseCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/x', '--prompt-file', 't']))
      .toMatchObject({ access: 'review', timeoutS: 900, expiresS: 900 })
    expect(parseCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/x', '--edit', '--timeout', '2h', '--expires', '90s', '--prompt-file', 't']))
      .toMatchObject({ access: 'edit', timeoutS: 7200, expiresS: 90 })
    expect(parseCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/x', '--timeout', '0s', '--prompt-file', 't'])).toHaveProperty('error')
    expect(parseCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/x', '--expires', 'soon', '--prompt-file', 't'])).toHaveProperty('error')
  })
  test('parses status/result/cancel handles and inventory', () => {
    const id = 'smn_' + 'c'.repeat(32)
    expect(parseCli(['status', `nuance/${id}`])).toEqual({ kind: 'status', device: 'nuance', id })
    expect(parseCli(['nuance', 'inventory'])).toEqual({ kind: 'inventory', device: 'nuance' })
    expect(parseCli(['status', 'nuance/../x'])).toHaveProperty('error')
  })
  test('--json is not a command flag: bin/summon.ts must split it off first', () => {
    expect(parseCli(['nuance', 'inventory', '--json'])).toHaveProperty('error')
  })
})

describe('splitJsonFlag', () => {
  test('removes --json wherever it sits and says it was there', () => {
    expect(splitJsonFlag(['nuance', 'inventory', '--json'])).toEqual({ argv: ['nuance', 'inventory'], json: true })
    expect(splitJsonFlag(['--json', 'status', 'nuance/x'])).toEqual({ argv: ['status', 'nuance/x'], json: true })
    expect(splitJsonFlag(['nuance', 'claude', '--json', '--model', 'sonnet'])).toEqual({ argv: ['nuance', 'claude', '--model', 'sonnet'], json: true })
  })
  test('leaves other argv alone', () => {
    expect(splitJsonFlag(['nuance', 'inventory'])).toEqual({ argv: ['nuance', 'inventory'], json: false })
    expect(splitJsonFlag([])).toEqual({ argv: [], json: false })
  })
  test('the split argv is a command that runs', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"completed"}')
    const { argv } = splitJsonFlag(['nuance', 'inventory', '--json'])
    expect(runCli(argv, deps(bin, dir))).toMatchObject({ code: 0, out: { status: 'completed' } })
  })
})

describe('mapSshFailure', () => {
  test('tells failures apart', () => {
    expect(mapSshFailure('@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@')).toMatchObject({ status: 'host_key_mismatch' })
    expect(mapSshFailure('Host key verification failed.')).toMatchObject({ status: 'host_key_mismatch' })
    expect(mapSshFailure('yu@nuance.local: Permission denied (publickey).')).toMatchObject({ status: 'auth_refused' })
    expect(mapSshFailure('ssh: connect to host nuance.local port 22: Operation timed out')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
    expect(mapSshFailure('ssh: connect to host nuance.local port 22: Connection refused')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
    expect(mapSshFailure('ssh: Could not resolve hostname nuance.local')).toMatchObject({ status: 'unreachable', reason: 'no_route' })
  })
  test('no route to host and an unreachable network are no_route, before any connection', () => {
    expect(mapSshFailure('ssh: connect to host nuance.local port 22: No route to host')).toMatchObject({ status: 'unreachable', reason: 'no_route' })
    expect(mapSshFailure('ssh: connect to host nuance.local port 22: Network is unreachable')).toMatchObject({ status: 'unreachable', reason: 'no_route' })
  })
  test('a banner timeout is a failure before authentication', () => {
    expect(mapSshFailure('Connection timed out during banner exchange')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
  })
  test('kex_exchange_identification happens before authentication, so it stays unreachable(timeout)', () => {
    for (const s of [
      'kex_exchange_identification: Connection closed by remote host',
      'kex_exchange_identification: read: Connection reset by peer\nConnection reset by 192.168.50.3 port 22',
      'kex_exchange_identification: Connection closed by remote host\nConnection closed by 192.168.50.3 port 22',
    ]) expect(mapSshFailure(s)).toMatchObject({ status: 'unreachable', reason: 'timeout' })
  })
  test('losing an established connection is unknown, never unreachable', () => {
    for (const s of [
      'Timeout, server nuance.local not responding.',
      'Timeout, server not responding',
      'packet_write_wait: Connection to 192.168.50.3 port 22: Broken pipe',
      'client_loop: send disconnect: Broken pipe',
      'client_loop: send disconnect: Connection reset',
      'Read from remote host nuance.local: Connection reset by peer',
      'Connection to nuance.local closed by remote host.',
    ]) {
      const r = mapSshFailure(s)
      expect(r.status).toBe('unknown')
      expect(r.reason).toBeUndefined()
      expect(typeof r.detail).toBe('string')
    }
  })
  test('a loss after a connect attempt that failed on another address is still unknown', () => {
    expect(mapSshFailure('ssh: connect to address 192.168.50.9 port 22: Operation timed out\nclient_loop: send disconnect: Broken pipe'))
      .toMatchObject({ status: 'unknown' })
  })
  test('permission denied and a changed host key win over a later drop', () => {
    expect(mapSshFailure('yu@nuance.local: Permission denied (publickey).\nConnection closed by 192.168.50.3 port 22')).toMatchObject({ status: 'auth_refused' })
  })
  test('an unrecognised failure is unknown, not a guess at the transport', () => {
    expect(mapSshFailure('ssh: something we have not seen')).toMatchObject({ status: 'unknown', detail: 'ssh: something we have not seen' })
    expect(mapSshFailure('')).toMatchObject({ status: 'unknown', detail: 'ssh failed' })
  })
  test('the detail is one clipped line of printable ASCII (the target controls banners)', () => {
    const r = mapSshFailure(`first\n\u001b[31mPermission denied\u001b[0m ${'x'.repeat(400)}`)
    expect(r.status).toBe('auth_refused')
    expect(r.detail).not.toMatch(/[^\x20-\x7e]/)
    expect(r.detail!.length).toBeLessThanOrEqual(200)
  })
})

describe('sshCall', () => {
  test('passes -F, the summon-<device> alias and the remote command; the request goes on stdin, not argv', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted","handle":"nuance/x"}')
    const r = sshCall({ sshBin: bin, sshConfig: '/cfg' }, 'nuance', 'start', '{"secret":"prompt text"}')
    expect(r).toMatchObject({ status: 'admitted' })
    expect(readFileSync(join(dir, 'argv'), 'utf8')).toBe('-F\n/cfg\nsummon-nuance\nstart\n')
    expect(readFileSync(join(dir, 'stdin'), 'utf8')).toBe('{"secret":"prompt text"}')
  })
  test('reads the last line of stdout as the answer', () => {
    const { bin } = fakeSsh(0, 'noise\n{"status":"queued"}\n')
    expect(sshCall({ sshBin: bin, sshConfig: 'c' }, 'nuance', 'status smn_x')).toMatchObject({ status: 'queued' })
  })
  test('a gatekeeper that threw still answered: exit 1 with its JSON line is read, not mapped as ssh', () => {
    const { bin } = fakeSsh(1, '{"status":"unknown","detail":"gatekeeper error"}')
    expect(sshCall({ sshBin: bin, sshConfig: 'c' }, 'nuance', 'start', '{}')).toMatchObject({ status: 'unknown', detail: 'gatekeeper error' })
  })
  test('an answer that is not an object with a string status is unknown', () => {
    for (const out of ['not json', '', 'null', '[]', '7', '"admitted"', '{"no":"status"}', '{"status":7}']) {
      const { bin } = fakeSsh(0, out)
      expect(sshCall({ sshBin: bin, sshConfig: 'c' }, 'nuance', 'inventory')).toMatchObject({ status: 'unknown', detail: 'no readable answer from the target' })
    }
  })
  test('ssh missing is unreachable(no_route) with a plain detail', () => {
    expect(sshCall({ sshBin: '/nonexistent/summon-test-ssh', sshConfig: 'c' }, 'nuance', 'inventory'))
      .toEqual({ status: 'unreachable', reason: 'no_route', detail: 'ssh not found' })
  })
  test('ssh exit 255 goes through mapSshFailure', () => {
    const { bin } = fakeSsh(255, '', 'ssh: connect to host nuance.local port 22: Connection refused')
    expect(sshCall({ sshBin: bin, sshConfig: 'c' }, 'nuance', 'inventory')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
  })
  test('a connection lost after sending is unknown even when ssh exits 255 with that stderr', () => {
    const { bin } = fakeSsh(255, '', 'Connection to nuance.local closed by remote host.')
    expect(sshCall({ sshBin: bin, sshConfig: 'c' }, 'nuance', 'start', '{}')).toMatchObject({ status: 'unknown' })
  })
  test('a spawn timeout is unknown, not unreachable (stderr is "" not null after a kill)', () => {
    const { bin, dir } = fakeSsh(0, '', '', 'exec sleep 30')
    const t0 = Date.now()
    const r = sshCall({ sshBin: bin, sshConfig: 'c', timeoutMs: 400 }, 'nuance', 'start', '{}')
    expect(Date.now() - t0).toBeLessThan(10_000)
    expect(r.status).toBe('unknown')
    expect(r.reason).toBeUndefined()
    expect(r.detail).toContain('400 ms')
    expect(calls(dir)).toBe(1)
  })
  test('a kill by signal is unknown', () => {
    const { bin } = fakeSsh(0, '', '', 'kill -9 $$')
    expect(sshCall({ sshBin: bin, sshConfig: 'c' }, 'nuance', 'start', '{}')).toMatchObject({ status: 'unknown', detail: expect.stringContaining('SIGKILL') })
  })
})

describe('runCli', () => {
  test('start sends the request on stdin to `summon-nuance start`, ledgering before and after', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted","handle":"nuance/x"}')
    writeFileSync(join(dir, 't.md'), 'Read the README 愛')
    const r = runCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/Projects/x', '--review', '--prompt-file', join(dir, 't.md')], deps(bin, dir))
    expect(r).toMatchObject({ code: 0, out: { status: 'admitted' } })
    expect(readFileSync(join(dir, 'argv'), 'utf8')).toContain('summon-nuance\nstart')
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(sent).toMatchObject({ from_device: 'air', to_device: 'nuance', cwd: '~/Projects/x', prompt: 'Read the README 愛' })
    const ledger = readFileSync(join(dir, 'ledger.jsonl'), 'utf8')
    expect(ledger.split('\n').filter(Boolean).length).toBe(2)
    expect(ledger).not.toContain('README')
  })
  test('the sent entry is on disk before ssh is called', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted","handle":"nuance/x"}')
    runCli(startArgv(dir), deps(bin, dir))
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    const atCall = lines(join(dir, 'ledger-at-call'))
    expect(atCall).toHaveLength(1)
    expect(atCall[0]).toMatchObject({ event: 'sent', id: sent.id, from: 'air', runtime: 'claude', model: 'sonnet', cwd: '~/Projects/x', access: 'review' })
    const all = lines(join(dir, 'ledger.jsonl'))
    expect(all[1]).toMatchObject({ event: 'answer', id: sent.id, status: 'admitted' })
  })
  test('the request carries the flags: timeout, expiry, label, provider, effort, access', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    const now = Date.parse('2026-10-10T12:00:00Z')
    runCli(startArgv(dir, ['--edit', '--timeout', '5m', '--expires', '2m', '--label', 'readme', '--provider', 'anthropic', '--effort', 'high']), deps(bin, dir, { nowMs: () => now }))
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(sent).toMatchObject({ v: 1, mode: 'job', access: 'edit', timeout_s: 300, label: 'readme', provider: 'anthropic', effort: 'high',
      issued_at: '2026-10-10T12:00:00.000Z', expires_at: '2026-10-10T12:02:00.000Z' })
    expect(sent.id).toMatch(/^smn_[0-9a-f]{32}$/)
    expect(sent.origin).toMatchObject({ pid: expect.any(Number) })
  })
  test('a prompt file of - reads stdin', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    runCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/x', '--prompt-file', '-'], deps(bin, dir))
    expect(JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8')).prompt).toBe('from stdin')
  })
  test('an unreadable prompt is refused locally: nothing is ledgered and nothing is sent', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    const r = runCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/x', '--prompt-file', join(dir, 'missing.md')], deps(bin, dir))
    expect(r).toMatchObject({ code: 2, out: { status: 'refused', reason: 'malformed' } })
    expect(calls(dir)).toBe(0)
    expect(existsSync(join(dir, 'ledger.jsonl'))).toBe(false)
  })
  test('a malformed command is refused(malformed) with exit 2 and never reaches ssh', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    expect(runCli(['nuance', 'claude'], deps(bin, dir))).toMatchObject({ code: 2, out: { status: 'refused', reason: 'malformed' } })
    expect(calls(dir)).toBe(0)
  })
  test('status, result and cancel ask the target by id', () => {
    const id = 'smn_' + 'd'.repeat(32)
    for (const verb of ['status', 'result', 'cancel']) {
      const { bin, dir } = fakeSsh(0, '{"status":"running","heartbeat_age_s":3}')
      expect(runCli([verb, `nuance/${id}`], deps(bin, dir))).toMatchObject({ code: 0, out: { status: 'running' } })
      expect(readFileSync(join(dir, 'argv'), 'utf8')).toContain(`summon-nuance\n${verb} ${id}`)
    }
  })
  test('inventory asks the target and a refusal exits 1', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"refused","reason":"busy"}')
    expect(runCli(['nuance', 'inventory'], deps(bin, dir))).toMatchObject({ code: 1, out: { status: 'refused', reason: 'busy' } })
    expect(readFileSync(join(dir, 'argv'), 'utf8')).toContain('summon-nuance\ninventory')
  })
  test('ssh exit 255 maps to a transport status', () => {
    const { bin, dir } = fakeSsh(255, '', 'ssh: connect to host nuance.local port 22: Operation timed out')
    expect(runCli(['nuance', 'inventory'], deps(bin, dir))).toMatchObject({ code: 1, out: { status: 'unreachable', reason: 'timeout' } })
  })
  test('a start that never connected is unreachable with no handle: nothing was delivered', () => {
    const { bin, dir } = fakeSsh(255, '', 'ssh: connect to host nuance.local port 22: Connection refused')
    const r = runCli(startArgv(dir), deps(bin, dir))
    expect(r).toMatchObject({ code: 1, out: { status: 'unreachable', reason: 'timeout' } })
    expect(r.out.handle).toBeUndefined()
    expect(lines(join(dir, 'ledger.jsonl')).map((e) => e.event + ':' + e.status)).toEqual([`sent:undefined`, 'answer:unreachable'])
  })
  test('auth_refused and host_key_mismatch after a start are reported as such', () => {
    const a = fakeSsh(255, '', 'yu@nuance.local: Permission denied (publickey).')
    expect(runCli(startArgv(a.dir), deps(a.bin, a.dir))).toMatchObject({ code: 1, out: { status: 'auth_refused' } })
    const h = fakeSsh(255, '', '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@')
    expect(runCli(startArgv(h.dir), deps(h.bin, h.dir))).toMatchObject({ code: 1, out: { status: 'host_key_mismatch' } })
  })
  test('garbled answer after sending is unknown, never retried', () => {
    const { bin, dir } = fakeSsh(0, 'not json')
    writeFileSync(join(dir, 't.md'), 'x')
    expect(runCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/x', '--review', '--prompt-file', join(dir, 't.md')], deps(bin, dir)).out.status).toBe('unknown')
  })
  test('an unknown after a start carries the handle of the request that was sent, and ssh ran once', () => {
    const { bin, dir } = fakeSsh(0, 'not json')
    const r = runCli(startArgv(dir), deps(bin, dir))
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(r).toMatchObject({ code: 1, out: { status: 'unknown', handle: `nuance/${sent.id}` } })
    expect(r.out.handle).toMatch(HANDLE_RE)
    expect(calls(dir)).toBe(1)
    expect(lines(join(dir, 'ledger.jsonl'))[1]).toMatchObject({ event: 'answer', id: sent.id, status: 'unknown' })
  })
  test('a connection lost after sending (exit 255, Broken pipe) is unknown with the handle, not unreachable', () => {
    const { bin, dir } = fakeSsh(255, '', 'client_loop: send disconnect: Broken pipe')
    const r = runCli(startArgv(dir), deps(bin, dir))
    expect(r).toMatchObject({ code: 1, out: { status: 'unknown', handle: expect.stringMatching(HANDLE_RE) } })
    expect(r.out.reason).toBeUndefined()
    expect(calls(dir)).toBe(1)
  })
  test('a timeout after sending is unknown with the handle, not unreachable, and is not retried', () => {
    const { bin, dir } = fakeSsh(0, '', '', 'exec sleep 30')
    const r = runCli(startArgv(dir), deps(bin, dir, { timeoutMs: 400 }))
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(r).toMatchObject({ code: 1, out: { status: 'unknown', handle: `nuance/${sent.id}` } })
    expect(calls(dir)).toBe(1)
    expect(lines(join(dir, 'ledger.jsonl'))[1]).toMatchObject({ event: 'answer', id: sent.id, status: 'unknown' })
  })
  test('the target answering unknown keeps its handle too', () => {
    const { bin, dir } = fakeSsh(1, '{"status":"unknown","detail":"gatekeeper error"}')
    const r = runCli(startArgv(dir), deps(bin, dir))
    expect(r.out).toMatchObject({ status: 'unknown', detail: 'gatekeeper error', handle: expect.stringMatching(HANDLE_RE) })
  })
})

describe('F04: the Air ledger survives a torn tail', () => {
  for (const [what, torn] of [['a half line', '{"event":"answer","id":"smn_01a1'], ['a `null` line', 'null\n']] as const) {
    test(`a start after ${what} still ledgers and sends`, () => {
      const { bin, dir } = fakeSsh(0, '{"status":"admitted","handle":"nuance/x"}')
      const ledger = join(dir, 'ledger.jsonl')
      runCli(startArgv(dir), deps(bin, dir))
      appendFileSync(ledger, torn)
      expect(runCli(startArgv(dir), deps(bin, dir))).toMatchObject({ code: 0, out: { status: 'admitted' } })
      expect(calls(dir)).toBe(2)
      expect(JSON.parse(readFileSync(join(dir, 'ledger-at-call'), 'utf8').trimEnd().split('\n').at(-1)!)).toMatchObject({ event: 'sent' }) // ledgered before the send
      expect(verifyLedger(ledger)).toEqual({ ok: true, entries: 5, torn: [3] })
    })
  }
})

describe('runCli when the Air ledger cannot be written', () => {
  // The fake replaces the ledger file with a directory once it is called, so the `sent` entry is written and the `answer` append throws.
  const BREAK_LEDGER = 'rm -f "@DIR@/ledger.jsonl"; mkdir "@DIR@/ledger.jsonl"'
  test('after the send: the gate\'s answer is still returned, with a note on stderr instead of a throw', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted","handle":"nuance/smn_theirs"}', '', BREAK_LEDGER)
    const warnings: string[] = []
    const r = runCli(startArgv(dir), deps(bin, dir, { warn: (m) => warnings.push(m) }))
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(r).toMatchObject({ code: 0, out: { status: 'admitted', handle: 'nuance/smn_theirs' } })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^summon: .*ledger/)
    expect(warnings[0]).toContain(`nuance/${sent.id}`)
    expect(warnings[0]).not.toContain('\n')
    expect(calls(dir)).toBe(1)
  })
  test('after the send: an unknown keeps its handle too', () => {
    const { bin, dir } = fakeSsh(0, 'not json', '', BREAK_LEDGER)
    const warnings: string[] = []
    const r = runCli(startArgv(dir), deps(bin, dir, { warn: (m) => warnings.push(m) }))
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(r).toMatchObject({ code: 1, out: { status: 'unknown', handle: `nuance/${sent.id}` } })
    expect(warnings).toHaveLength(1)
  })
  test('before the send: it throws, one line, and ssh is never called', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    mkdirSync(join(dir, 'ledger.jsonl'))
    let err: Error | undefined
    try { runCli(startArgv(dir), deps(bin, dir)) } catch (e) { err = e as Error }
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toMatch(/^could not write the Air ledger \(\w+\); nothing was sent$/)
    expect(calls(dir)).toBe(0)
  })
})

describe('bin/summon.ts', () => {
  const newHome = () => trackTmp(mkdtempSync(join(tmpdir(), 'summon-home-')))
  const ledgerOf = (home: string) => join(home, '.local', 'state', 'summon', 'ledger.jsonl')
  async function run(args: string[], bin: string, home: string = newHome()): Promise<{ code: number; stdout: string; stderr: string; home: string }> {
    const p = Bun.spawn([process.execPath, BIN, ...args], { env: { PATH: process.env.PATH!, HOME: home, SUMMON_SSH_BIN: bin }, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    return { code, stdout, stderr, home }
  }

  test('inventory --json runs and prints the answer as one JSON line', async () => {
    const { bin, dir } = fakeSsh(0, '{"status":"completed","inventory":{"host":"nuance"}}')
    const r = await run(['nuance', 'inventory', '--json'], bin)
    expect(r.stderr).toBe('')
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ status: 'completed', inventory: { host: 'nuance' } })
    expect(readFileSync(join(dir, 'argv'), 'utf8')).toContain('summon-nuance\ninventory')
  })
  test('a start with --json after the flags runs, ledgers under HOME, and prints the answer', async () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted","handle":"nuance/smn_x"}')
    const r = await run(startArgv(dir, ['--json']), bin)
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toMatchObject({ status: 'admitted' })
    expect(JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))).toMatchObject({ to_device: 'nuance', cwd: '~/Projects/x' })
    expect(lines(ledgerOf(r.home))).toHaveLength(2)
  })
  test('without --json it prints a short human answer and exits 1 on a refusal', async () => {
    const { bin } = fakeSsh(0, '{"status":"refused","reason":"outside_allowlist","hint":"edit the allowlist on nuance"}')
    const r = await run(['nuance', 'inventory'], bin)
    expect(r.code).toBe(1)
    expect(r.stdout).toBe('refused (outside_allowlist)\nhint: edit the allowlist on nuance\n')
  })
  test('an unknown prints its handle so the answer can be asked for later', async () => {
    const { bin, dir } = fakeSsh(255, '', 'client_loop: send disconnect: Broken pipe')
    const r = await run(startArgv(dir), bin)
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(r.code).toBe(1)
    expect(r.stdout.split('\n')[0]).toBe(`unknown nuance/${sent.id}`)
  })
  test('status prints the heartbeat age so a stale heartbeat is visible', async () => {
    const handle = `nuance/smn_${'a'.repeat(32)}`
    const { bin } = fakeSsh(0, JSON.stringify({ status: 'running', handle, heartbeat_age_s: 42 }))
    const r = await run(['status', handle], bin)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe(`running ${handle}\nheartbeat: 42s ago\n`)
  })
  test('a heartbeat age of 0 is printed, and a null one (no heartbeat yet) is not', async () => {
    const handle = `nuance/smn_${'b'.repeat(32)}`
    const fresh = fakeSsh(0, JSON.stringify({ status: 'running', handle, heartbeat_age_s: 0 }))
    expect((await run(['status', handle], fresh.bin)).stdout).toBe(`running ${handle}\nheartbeat: 0s ago\n`)
    const none = fakeSsh(0, JSON.stringify({ status: 'queued', handle, heartbeat_age_s: null }))
    expect((await run(['status', handle], none.bin)).stdout).toBe(`queued ${handle}\n`)
  })
  test('F17: a usage stop prints its reset time', async () => {
    const handle = `nuance/smn_${'d'.repeat(32)}`
    const { bin } = fakeSsh(0, JSON.stringify({ status: 'blocked', reason: 'usage', handle, detail: 'usage allowed_warning', resets_at: '2026-10-11T03:00:00.000Z', result_text: 'partial' }))
    const r = await run(['result', handle], bin)
    expect(r.code).toBe(1)
    expect(r.stdout).toBe(`blocked (usage) ${handle}\nresets: 2026-10-11T03:00:00.000Z\ndetail: usage allowed_warning\npartial\n`)
  })
  test('--json keeps heartbeat_age_s in the object', async () => {
    const handle = `nuance/smn_${'c'.repeat(32)}`
    const { bin } = fakeSsh(0, JSON.stringify({ status: 'running', handle, heartbeat_age_s: 42 }))
    expect(JSON.parse((await run(['status', handle, '--json'], bin)).stdout)).toEqual({ status: 'running', handle, heartbeat_age_s: 42 })
  })
  test('an answer that cannot be ledgered is still printed (JSON too); stderr says the ledger missed it', async () => {
    const home = newHome()
    const { bin, dir } = fakeSsh(0, '{"status":"admitted","handle":"nuance/smn_theirs"}', '', `rm -f "${ledgerOf(home)}"; mkdir "${ledgerOf(home)}"`)
    const r = await run(startArgv(dir, ['--json']), bin, home)
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ status: 'admitted', handle: 'nuance/smn_theirs' })
    expect(r.stderr.split('\n').filter(Boolean)).toHaveLength(1)
    expect(r.stderr).toMatch(/^summon: .*ledger.*\n$/)
    expect(r.stderr).toContain(`nuance/${sent.id}`)
  })
  test('an unknown that cannot be ledgered still prints its handle', async () => {
    const home = newHome()
    const { bin, dir } = fakeSsh(0, 'not json', '', `rm -f "${ledgerOf(home)}"; mkdir "${ledgerOf(home)}"`)
    const r = await run(startArgv(dir), bin, home)
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(r.code).toBe(1)
    expect(r.stdout.split('\n')[0]).toBe(`unknown nuance/${sent.id}`)
  })
  test('a ledger that cannot be written before the send: one stderr line, exit 2, nothing sent, no stack trace', async () => {
    const home = newHome()
    mkdirSync(ledgerOf(home), { recursive: true })
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    for (const extra of [[], ['--json']]) {
      const r = await run(startArgv(dir, extra), bin, home)
      expect(r.code).toBe(2)
      expect(r.stdout).toBe('')
      expect(r.stderr).toMatch(/^summon: could not write the Air ledger \(\w+\); nothing was sent\n$/)
    }
    expect(calls(dir)).toBe(0)
  })
})

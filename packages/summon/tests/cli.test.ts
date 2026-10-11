import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lstartToIso, NothingSentError, parseCli, runCli, splitJsonFlag, type CliDeps } from '../src/cli.ts'
import { verifyLedger } from '../src/ledger.ts'
import { HOST_KEY_HINT, mapSshFailure, sshCall } from '../src/ssh.ts'
import type { GateResponse } from '../src/status.ts'
import { cleanupTmps, DAY, dashed, trackTmp, ymd } from './helpers.ts'

afterEach(cleanupTmps)

const BIN = join(import.meta.dir, '..', 'bin', 'summon.ts')
/** What pin-nuance writes for the one paired device (the start of it: the CLI reads only the Host line). */
const PAIRED = 'Host summon-nuance\n  HostName nuance.local\n  BatchMode yes\n'

/**
 * A stand-in for `ssh`. It records its argv, counts its calls, copies the ledger as it stood when it was called,
 * and reads all of stdin. `pre` runs after stdin is read and before the canned answer (use it to hang, die, or
 * break the ledger once the `sent` entry is written); `@DIR@` in it stands for the fake's own directory.
 */
function fakeSsh(exit: number, stdout: string, stderr = '', pre = ''): { bin: string; dir: string } {
  const dir = trackTmp(mkdtempSync(join(tmpdir(), 'summon-cli-')))
  writeFileSync(join(dir, 'out'), stdout)
  writeFileSync(join(dir, 'err'), stderr)
  writeFileSync(join(dir, 'config'), PAIRED) // `deps` points the CLI here: nuance is paired
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
  sshBin: bin, sshConfig: join(dir, 'config'), ledgerPath: join(dir, 'ledger.jsonl'), device: 'air', env: {},
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
  test('F11: a drop after a permission denied is unknown: a lost connection is checked first', () => {
    // ssh exits at its own `Permission denied (...)` line, so a drop printed after it says a session may have existed.
    expect(mapSshFailure('yu@nuance.local: Permission denied (publickey).\nConnection closed by 192.168.50.3 port 22')).toMatchObject({ status: 'unknown' })
    expect(mapSshFailure('yu@nuance.local: Permission denied (publickey).\r\n')).toMatchObject({ status: 'auth_refused' })
  })
  test('an unrecognised failure is unknown, not a guess at the transport', () => {
    expect(mapSshFailure('ssh: something we have not seen')).toMatchObject({ status: 'unknown', detail: 'ssh: something we have not seen' })
    expect(mapSshFailure('')).toMatchObject({ status: 'unknown', detail: 'ssh failed' })
  })
  test('the detail is one clipped line of printable ASCII (the target controls banners)', () => {
    // F11: a coloured line is not ssh's own `Permission denied (...)` line, so it is not read as auth_refused.
    const r = mapSshFailure(`first\n\u001b[31mPermission denied\u001b[0m ${'x'.repeat(400)}`)
    expect(r.status).toBe('unknown')
    expect(r.detail).not.toMatch(/[^\x20-\x7e]/)
    expect(r.detail!.length).toBeLessThanOrEqual(200)
    const a = mapSshFailure(`${'u'.repeat(300)}@nuance.local: Permission denied (publickey).`)
    expect(a.status).toBe('auth_refused')
    expect(a.detail!.length).toBeLessThanOrEqual(200)
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
  /** A fresh HOME in which nuance is paired (pin-nuance's config). */
  const newHome = () => {
    const home = trackTmp(mkdtempSync(join(tmpdir(), 'summon-home-')))
    mkdirSync(join(home, '.ssh', 'summon'), { recursive: true })
    writeFileSync(join(home, '.ssh', 'summon', 'config'), PAIRED)
    return home
  }
  const ledgerOf = (home: string) => join(home, '.local', 'state', 'summon', 'ledger.jsonl')
  async function run(args: string[], bin: string, home: string = newHome(), env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string; home: string }> {
    const p = Bun.spawn([process.execPath, BIN, ...args], { env: { PATH: process.env.PATH!, HOME: home, SUMMON_SSH_BIN: bin, ...env }, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
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
  test('a ledger that cannot be written before the send: one stderr line, exit 3 (not the usage 2), nothing sent, no stack trace', async () => {
    const home = newHome()
    mkdirSync(ledgerOf(home), { recursive: true })
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    const r = await run(startArgv(dir), bin, home)
    expect(r.code).toBe(3)
    expect(r.stdout).toBe('')
    expect(r.stderr).toMatch(/^summon: could not write the Air ledger \(\w+\); nothing was sent\n$/)
    expect(calls(dir)).toBe(0)
  })
})

// ── Task 12 batch C ──

const ID = 'smn_' + 'e'.repeat(32)
const NOT_PAIRED_HINT = 'run bun scripts/pin-nuance.ts (README install step 3)'
const FILEVAULT_HINT = 'if Nuance restarted it may be waiting at the FileVault screen: unlock it at the Mac; do not re-pin or re-key'
const ZSHENV = '/Users/yu/.zshenv:3: permission denied: /Users/yu/.fleet/env'
const FINGERPRINT = 'SHA256:CGip6AreH32R0L5MaySkXh+en/d1TrExustozYSltuI'
/** OpenSSH's changed-host-key block, as /usr/bin/ssh prints it (its lines end \r\n). */
const CHANGED_KEY = [
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  'IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!',
  'Someone could be eavesdropping on you right now (man-in-the-middle attack)!',
  'It is also possible that a host key has just been changed.',
  'The fingerprint for the ED25519 key sent by the remote host is',
  `${FINGERPRINT}.`,
  'Please contact your system administrator.',
  'Add correct host key in /Users/yuai/.ssh/summon/known_hosts to get rid of this message.',
  'Offending ED25519 key in /Users/yuai/.ssh/summon/known_hosts:1',
  'Host key for summon-nuance has changed and you have requested strict checking.',
  'Host key verification failed.',
].join('\r\n') + '\r\n'

describe('F09/F43: only a paired device is ever called', () => {
  const notPaired = (device: string): { code: number; out: GateResponse } =>
    ({ code: 1, out: { status: 'unreachable', reason: 'no_route', detail: `not paired: ${device}`, hint: NOT_PAIRED_HINT } })
  test('a device with no Host block (this Mac, a typo) is answered here: no ssh, no ledger line, no handle', () => {
    for (const [argv, device] of [
      [['air', 'inventory'], 'air'], [['nuance2', 'inventory'], 'nuance2'],
      [['status', `nuance2/${ID}`], 'nuance2'], [['result', `air/${ID}`], 'air'], [['cancel', `nuance2/${ID}`], 'nuance2'],
    ] as const) {
      const { bin, dir } = fakeSsh(0, '{"status":"completed"}')
      expect(runCli([...argv], deps(bin, dir))).toEqual(notPaired(device))
      expect(calls(dir)).toBe(0)
      expect(existsSync(join(dir, 'ledger.jsonl'))).toBe(false)
    }
  })
  test('a start to an unpaired device is answered before the sent entry', () => {
    for (const device of ['air', 'nuance2']) {
      const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
      const argv = startArgv(dir); argv[0] = device
      expect(runCli(argv, deps(bin, dir))).toEqual(notPaired(device))
      expect(calls(dir)).toBe(0)
      expect(existsSync(join(dir, 'ledger.jsonl'))).toBe(false)
    }
  })
  test('F43: with no summon ssh config (before pin-nuance, after rollback) nothing is sent or ledgered, and there is no handle', () => {
    const { bin, dir } = fakeSsh(255, '', `Can't open user config file ${join('/x', 'config')}: No such file or directory`)
    for (const argv of [startArgv(dir), ['nuance', 'inventory'], ['status', `nuance/${ID}`], ['cancel', `nuance/${ID}`]]) {
      const r = runCli(argv, deps(bin, dir, { sshConfig: join(dir, 'missing', 'config') }))
      expect(r).toEqual(notPaired('nuance'))
    }
    expect(calls(dir)).toBe(0)
    expect(existsSync(join(dir, 'ledger.jsonl'))).toBe(false)
  })
  test('only an exact `Host summon-<device>` line pairs a device', () => {
    for (const config of ['Host summon-nuance2\n', 'Host summon-nuance-old\n', '# Host summon-nuance\n', 'Host summon-nuance summon-air\n', 'Host summon-*\n', '']) {
      const { bin, dir } = fakeSsh(0, '{"status":"completed"}')
      writeFileSync(join(dir, 'config'), config)
      expect(runCli(['nuance', 'inventory'], deps(bin, dir))).toEqual(notPaired('nuance'))
      expect(calls(dir)).toBe(0)
    }
    const { bin, dir } = fakeSsh(0, '{"status":"completed"}')
    writeFileSync(join(dir, 'config'), 'Host summon-other\n  HostName x\n\nHost summon-nuance\n  HostName nuance.local\n')
    expect(runCli(['nuance', 'inventory'], deps(bin, dir))).toEqual({ code: 0, out: { status: 'completed' } })
  })
  test('a config that exists but cannot be read is unreachable(no_route) with the local-policy hint, and nothing is sent', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    chmodSync(join(dir, 'config'), 0o000)
    try {
      const r = runCli(startArgv(dir), deps(bin, dir))
      expect(r).toMatchObject({ code: 1, out: { status: 'unreachable', reason: 'no_route', detail: 'cannot read the summon ssh config (EACCES)' } })
      expect(String(r.out.hint)).toContain('Local Network')
      expect(r.out.handle).toBeUndefined()
    } finally { chmodSync(join(dir, 'config'), 0o600) }
    expect(calls(dir)).toBe(0)
    expect(existsSync(join(dir, 'ledger.jsonl'))).toBe(false)
  })
})

describe('F11/F29/F43: only ssh\'s own pre-connect lines keep a transport status', () => {
  const expectAll = (cases: string[], want: Record<string, unknown>) => {
    for (const s of cases) {
      expect([s, mapSshFailure(s)]).toMatchObject([s, want])
      expect([s, mapSshFailure(s.replaceAll('\n', '\r\n') + '\r\n')]).toMatchObject([s, want]) // ssh ends its lines \r\n
    }
  }
  test('F11: a read error on an established connection is unknown, whatever errno it names', () => {
    expectAll([
      'Read from remote host nuance.local: No route to host', 'Read from remote host nuance.local: Network is unreachable',
      'Read from remote host nuance.local: Network is down', 'Read from remote host nuance.local: Host is down',
      'Read from remote host nuance.local: Operation timed out', 'Read from remote host nuance.local: Connection reset by peer',
      'client_loop: ssh_packet_write_poll: Connection to 192.168.50.3 port 22: No route to host',
    ], { status: 'unknown' })
  })
  test('F11: remote stderr (Nuance\'s ~/.zshenv) cannot make a delivered request read as auth_refused or unreachable', () => {
    for (const loss of ['Connection to nuance.local closed by remote host.', 'Timeout, server nuance.local not responding.', 'client_loop: send disconnect: Broken pipe',
      'Read from remote host nuance.local: Connection reset by peer', 'Connection reset by 192.168.50.3 port 22', 'Connection closed by 192.168.50.3 port 22']) {
      for (const remote of [ZSHENV, 'yu@nuance.local: Permission denied (publickey).', 'ssh: connect to host nuance.local port 22: No route to host',
        'ssh: Could not resolve hostname nuance.local: nodename nor servname provided, or not known', 'ssh: connect to host nuance.local port 22: Operation timed out',
        'Host key verification failed.', "Can't open user config file /x: Operation not permitted"]) {
        expectAll([`${remote}\n${loss}`], { status: 'unknown', detail: loss })
      }
    }
    expect(mapSshFailure(`${ZSHENV}\nConnection to nuance.local closed by remote host.`)).toEqual({ status: 'unknown', detail: 'Connection to nuance.local closed by remote host.' })
  })
  test('F11: a lowercase permission denied from a shell is not ssh\'s authentication failure', () => {
    expectAll([ZSHENV], { status: 'unknown' })
    expectAll(['yu@nuance.local: Permission denied (publickey).', 'yu@nuance.local: Permission denied (publickey,keyboard-interactive).',
      'Received disconnect from 192.168.50.3 port 22:2: Too many authentication failures\nDisconnected from 192.168.50.3 port 22'], { status: 'auth_refused' })
  })
  test('F11: a no-route or unreachable-network that is not ssh\'s own connect line is unknown', () => {
    expectAll(['No route to host', 'debug1: connect to address 192.168.50.3 port 22: No route to host', 'x: ssh: connect to host nuance.local port 22: No route to host',
      'could not resolve hostname nuance.local'], { status: 'unknown' })
  })
  test('F29: Host is down (the ARP reject window after a first timeout) is unreachable(timeout), on either connect line', () => {
    expectAll(['ssh: connect to host nuance.local port 22: Host is down', 'ssh: connect to address 192.168.50.220 port 22: Host is down',
      'ssh: connect to host nuance.local port 22: Operation timed out', 'ssh: connect to host nuance.local port 22: Connection refused',
      'Connection timed out during banner exchange\nConnection to 192.168.50.3 port 22 timed out'], { status: 'unreachable', reason: 'timeout' })
  })
  test('F29: Network is down on ssh\'s connect line is unreachable(no_route); on an established connection it is unknown', () => {
    expectAll(['ssh: connect to host nuance.local port 22: Network is down'], { status: 'unreachable', reason: 'no_route' })
    expectAll(['Read from remote host nuance.local: Network is down', 'Connection to 192.168.50.3 port 22: Network is down'], { status: 'unknown' })
  })
  test('F43: local pre-connect failures (a sandbox, a broken summon ssh entry) are unreachable(no_route), not unknown', () => {
    expectAll([
      'ssh: connect to host nuance.local port 22: Operation not permitted',
      "Can't open user config file /Users/yuai/.ssh/summon/config: Operation not permitted",
      "Can't open user config file /Users/yuai/.ssh/summon/config: No such file or directory",
      'Bad owner or permissions on /Users/yuai/.ssh/summon/config',
      '/Users/yuai/.ssh/summon/config: line 3: Bad configuration option: bogus\n/Users/yuai/.ssh/summon/config: terminating, 1 bad configuration options',
      'no such identity: /Users/yuai/.ssh/summon/summon_nuance_ed25519: Operation not permitted\nyuai@nuance.local: Permission denied (publickey).',
    ], { status: 'unreachable', reason: 'no_route' })
    expect(mapSshFailure('no such identity: /k: No such file or directory\r\nyuai@nuance.local: Permission denied (publickey).\r\n').detail).toBe('no such identity: /k: No such file or directory')
  })
  test('kex_exchange_identification is still before authentication (R11\'s exception), and a kex line must be ssh\'s own', () => {
    expectAll(['kex_exchange_identification: read: Connection reset by peer\nConnection reset by 192.168.50.3 port 22'], { status: 'unreachable', reason: 'timeout' })
    expectAll(['x: kex_exchange_identification: read: Connection reset by peer\nConnection reset by 192.168.50.3 port 22'], { status: 'unknown' })
  })
  test('the deciding line is the detail, not whatever came last', () => {
    expect(mapSshFailure('kex_exchange_identification: read: Connection reset by peer\r\nConnection reset by 192.168.50.3 port 22\r\n').detail)
      .toBe('kex_exchange_identification: read: Connection reset by peer')
  })
  test('through sshCall and runCli: Host is down reads unreachable(timeout), no handle, and the ledger says unreachable', () => {
    const { bin, dir } = fakeSsh(255, '', 'ssh: connect to host nuance.local port 22: Host is down\r\n')
    expect(sshCall({ sshBin: bin, sshConfig: 'c' }, 'nuance', 'inventory')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
    const r = runCli(startArgv(dir), deps(bin, dir))
    expect(r).toMatchObject({ code: 1, out: { status: 'unreachable', reason: 'timeout' } })
    expect(r.out.handle).toBeUndefined()
    expect(lines(join(dir, 'ledger.jsonl')).map((e) => `${e.event}:${e.status}`)).toEqual(['sent:undefined', 'answer:unreachable'])
  })
  test('through runCli: a seatbelt-denied connect (EPERM) is unreachable(no_route) with no handle', () => {
    for (const line of ['ssh: connect to host nuance.local port 22: Operation not permitted', "Can't open user config file /Users/yuai/.ssh/summon/config: Operation not permitted"]) {
      const { bin, dir } = fakeSsh(255, '', `${line}\r\n`)
      const r = runCli(startArgv(dir), deps(bin, dir))
      expect(r).toMatchObject({ code: 1, out: { status: 'unreachable', reason: 'no_route', detail: line } })
      expect(r.out.handle).toBeUndefined()
      expect(lines(join(dir, 'ledger.jsonl'))[1]).toMatchObject({ event: 'answer', status: 'unreachable', reason: 'no_route' })
    }
  })
  test('through runCli: a delivered start whose zshenv said "permission denied" and then lost the connection is unknown with its handle', () => {
    const { bin, dir } = fakeSsh(255, '', `${ZSHENV}\r\nConnection to nuance.local closed by remote host.\r\n`)
    const r = runCli(startArgv(dir), deps(bin, dir))
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(r).toMatchObject({ code: 1, out: { status: 'unknown', handle: `nuance/${sent.id}`, detail: 'Connection to nuance.local closed by remote host.' } })
    expect(calls(dir)).toBe(1)
  })
})

describe('F47: an unreachable(no_route) says where the block may be', () => {
  const NO_ROUTE = ['ssh: Could not resolve hostname nuance.local: nodename nor servname provided, or not known', 'ssh: connect to host nuance.local port 22: No route to host',
    'ssh: connect to host nuance.local port 22: Operation not permitted']
  test('inside a harness sandbox the hint names it and says to rerun outside it', () => {
    for (const [k, v] of [['CODEX_SANDBOX', 'seatbelt'], ['CODEX_SANDBOX_NETWORK_DISABLED', '1'], ['SANDBOX_RUNTIME', '1']] as const) {
      for (const line of NO_ROUTE) {
        const { bin, dir } = fakeSsh(255, '', line)
        const r = runCli(['nuance', 'inventory'], deps(bin, dir, { env: { [k]: v } }))
        expect(r).toMatchObject({ code: 1, out: { status: 'unreachable', reason: 'no_route' } })
        expect(r.out.handle).toBeUndefined()
        expect(String(r.out.hint)).toMatch(/sandbox/)
        expect(String(r.out.hint)).toContain(`${k}=${v}`)
        expect(String(r.out.hint)).toMatch(/rerun .*outside/)
      }
    }
  })
  test('outside one it points at macOS Local Network privacy for the app that started it, or a harness sandbox', () => {
    for (const line of NO_ROUTE) {
      const { bin, dir } = fakeSsh(255, '', line)
      for (const argv of [['nuance', 'inventory'], startArgv(dir), ['status', `nuance/${ID}`]]) {
        const hint = String(runCli(argv, deps(bin, dir)).out.hint)
        expect(hint).toContain('if Nuance is awake on the LAN, the Air may be blocking this caller')
        expect(hint).toContain('System Settings › Privacy & Security › Local Network')
        expect(hint).toContain('harness sandbox')
      }
    }
  })
  test('a timeout and an unknown get no hint, sandbox or not', () => {
    for (const line of ['ssh: connect to host nuance.local port 22: Operation timed out', 'client_loop: send disconnect: Broken pipe']) {
      const { bin, dir } = fakeSsh(255, '', line)
      expect(runCli(['nuance', 'inventory'], deps(bin, dir, { env: { SANDBOX_RUNTIME: '1' } })).out.hint).toBeUndefined()
    }
  })
})

describe('F32/F45: auth_refused says whether the key expired or Nuance may be at the FileVault screen', () => {
  const withExpiry = (dir: string, e: string) => writeFileSync(join(dir, 'expiry'), `${e}\n`)
  test('a key whose expiry day has come: the hint names the date and re-pairing', () => {
    for (const e of [ymd(Date.now() - DAY), ymd(Date.now())]) {
      const { bin, dir } = fakeSsh(255, '', 'yuai@nuance.local: Permission denied (publickey).\r\n')
      withExpiry(dir, e)
      for (const argv of [['nuance', 'inventory'], startArgv(dir)]) {
        expect(runCli(argv, deps(bin, dir, { warn: () => {} }))).toMatchObject({ code: 1, out: {
          status: 'auth_refused', detail: 'yuai@nuance.local: Permission denied (publickey).',
          hint: `the summon key expired on ${dashed(e)}: re-pair (README install step 1)` } })
      }
    }
  })
  test('otherwise (no expiry recorded, or one still ahead): the FileVault hint', () => {
    for (const e of [null, ymd(Date.now() + 30 * DAY), ymd(Date.now() + 3 * DAY)]) {
      for (const line of ['yu@nuance.local: Permission denied (keyboard-interactive).', 'yu@nuance.local: Permission denied (password,keyboard-interactive).']) {
        const { bin, dir } = fakeSsh(255, '', line)
        if (e) withExpiry(dir, e)
        expect(runCli(['nuance', 'inventory'], deps(bin, dir, { warn: () => {} }))).toMatchObject({ code: 1, out: { status: 'auth_refused', hint: FILEVAULT_HINT } })
      }
    }
  })
  test('within 7 days of the expiry every verb warns on stderr, once; further out, or with none, nothing', () => {
    const verbs = (dir: string) => [['nuance', 'inventory'], ['status', `nuance/${ID}`], ['result', `nuance/${ID}`], ['cancel', `nuance/${ID}`], startArgv(dir)]
    const soon = ymd(Date.now() + 3 * DAY)
    const { bin, dir } = fakeSsh(0, '{"status":"completed"}')
    withExpiry(dir, soon)
    for (const argv of verbs(dir)) {
      const said: string[] = []
      expect(runCli(argv, deps(bin, dir, { warn: (m) => said.push(m) })).code).toBe(0)
      expect(said).toEqual([`summon: the summon key expires on ${dashed(soon)}: re-pair before then (README install step 1)`])
    }
    for (const e of [ymd(Date.now() + 10 * DAY), null]) {
      const f = fakeSsh(0, '{"status":"completed"}')
      if (e) withExpiry(f.dir, e)
      for (const argv of verbs(f.dir)) {
        const said: string[] = []
        runCli(argv, deps(f.bin, f.dir, { warn: (m) => said.push(m) }))
        expect(said).toEqual([])
      }
    }
  })
  test('an expired key warns too, with the date it expired', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"completed"}')
    const e = ymd(Date.now() - 2 * DAY)
    withExpiry(dir, e)
    const said: string[] = []
    runCli(['nuance', 'inventory'], deps(bin, dir, { warn: (m) => said.push(m) }))
    expect(said).toEqual([`summon: the summon key expired on ${dashed(e)}: re-pair (README install step 1)`])
  })
})

describe('F46: host_key_mismatch is shown as a security event, with the fingerprint Nuance presented', () => {
  test('the detail keeps the presented fingerprint and the hint is the fixed security note', () => {
    const { bin, dir } = fakeSsh(255, '', CHANGED_KEY)
    for (const argv of [['nuance', 'inventory'], startArgv(dir)]) {
      const r = runCli(argv, deps(bin, dir))
      expect(r).toMatchObject({ code: 1, out: { status: 'host_key_mismatch' } })
      expect(r.out.detail).toContain(FINGERPRINT)
      expect(r.out.detail).toContain('Host key verification failed.')
      expect(r.out.detail!.length).toBeLessThanOrEqual(200)
      expect(r.out.hint).toBe(HOST_KEY_HINT)
    }
    expect(HOST_KEY_HINT).toBe('security event — Nuance presented a different host key. Do not re-pin from the network. On Nuance run ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub; only if it shows this fingerprint and you know why it changed, re-pin with bun scripts/pin-nuance.ts --host-key "<line read on Nuance>"')
  })
  test('an unknown host key (no pin) is a mismatch with the same hint and no fingerprint', () => {
    const r = mapSshFailure('No ED25519 host key is known for summon-nuance and you have requested strict checking.\r\nHost key verification failed.\r\n')
    expect(r).toEqual({ status: 'host_key_mismatch', detail: 'Host key verification failed.', hint: HOST_KEY_HINT })
  })
})

describe('F16: the spec\'s own command line', () => {
  const SPEC = ['nuance', 'claude', '--model', 'sonnet', '--job', '--cwd', '~/Projects/agenttool', '--review', '--prompt-file', 'task.md']
  test('--job is accepted and changes nothing (Phase 0 runs jobs only)', () => {
    expect(parseCli(SPEC)).toMatchObject({ kind: 'start', device: 'nuance', runtime: 'claude', model: 'sonnet', cwd: '~/Projects/agenttool', access: 'review', promptFile: 'task.md' })
    expect(parseCli(SPEC)).toEqual(parseCli(SPEC.filter((a) => a !== '--job')))
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    expect(runCli(startArgv(dir, ['--job']), deps(bin, dir)).code).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8')).mode).toBe('job')
  })
  test('--live is refused locally, saying live sessions arrive in Phase 1', () => {
    const live = SPEC.map((a) => (a === '--job' ? '--live' : a))
    expect(String((parseCli(live) as { error: string }).error)).toMatch(/^--live: live sessions arrive in Phase 1/)
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    const r = runCli(startArgv(dir, ['--live']), deps(bin, dir))
    expect(r).toMatchObject({ code: 2, out: { status: 'refused', reason: 'malformed' } })
    expect(r.out.detail).toContain('Phase 1')
    expect(calls(dir)).toBe(0)
  })
})

describe('F15: the Air logs a cancel, and any security event on any verb', () => {
  test('cancel: cancel_sent is on disk before ssh runs, then the answer; the chain verifies', () => {
    const { bin, dir } = fakeSsh(0, JSON.stringify({ status: 'running', handle: `nuance/${ID}`, detail: 'cancel requested' }))
    expect(runCli(['cancel', `nuance/${ID}`], deps(bin, dir))).toMatchObject({ code: 0, out: { status: 'running', detail: 'cancel requested' } })
    expect(lines(join(dir, 'ledger-at-call')).map((e) => [e.event, e.id])).toEqual([['cancel_sent', ID]])
    expect(lines(join(dir, 'ledger.jsonl'))).toMatchObject([{ event: 'cancel_sent', id: ID }, { event: 'answer', id: ID, status: 'running', detail: 'cancel requested' }])
    expect(verifyLedger(join(dir, 'ledger.jsonl'))).toEqual({ ok: true, entries: 2 })
  })
  test('cancel fails closed: if cancel_sent cannot be written, it throws and ssh never runs', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"running"}')
    mkdirSync(join(dir, 'ledger.jsonl'))
    let err: unknown
    try { runCli(['cancel', `nuance/${ID}`], deps(bin, dir)) } catch (e) { err = e }
    expect(err).toBeInstanceOf(NothingSentError)
    expect((err as Error).message).toMatch(/^could not write the Air ledger \(\w+\); nothing was sent$/)
    expect(calls(dir)).toBe(0)
  })
  test('cancel: a transport failure is answered and logged too', () => {
    const { bin, dir } = fakeSsh(255, '', 'yu@nuance.local: Permission denied (publickey).')
    expect(runCli(['cancel', `nuance/${ID}`], deps(bin, dir))).toMatchObject({ code: 1, out: { status: 'auth_refused' } })
    expect(lines(join(dir, 'ledger.jsonl'))).toMatchObject([{ event: 'cancel_sent', id: ID }, { event: 'answer', id: ID, status: 'auth_refused', detail: 'yu@nuance.local: Permission denied (publickey).' }])
  })
  test('inventory, status and result ledger an auth_refused or host_key_mismatch answer', () => {
    for (const [stderr, status] of [['yu@nuance.local: Permission denied (publickey).', 'auth_refused'], [CHANGED_KEY, 'host_key_mismatch']] as const) {
      for (const [argv, id] of [[['nuance', 'inventory'], undefined], [['status', `nuance/${ID}`], ID], [['result', `nuance/${ID}`], ID]] as const) {
        const { bin, dir } = fakeSsh(255, '', stderr)
        expect(runCli([...argv], deps(bin, dir)).out.status).toBe(status)
        const entries = lines(join(dir, 'ledger.jsonl'))
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({ event: 'answer', status })
        expect(entries[0].id).toBe(id)
        expect(verifyLedger(join(dir, 'ledger.jsonl')).ok).toBe(true)
      }
    }
  })
  test('a read that is answered, or fails as unreachable or unknown, writes nothing on the Air', () => {
    for (const [exit, out, err] of [[0, '{"status":"completed"}', ''], [255, '', 'ssh: connect to host nuance.local port 22: Operation timed out'], [255, '', 'client_loop: send disconnect: Broken pipe']] as const) {
      for (const argv of [['nuance', 'inventory'], ['status', `nuance/${ID}`], ['result', `nuance/${ID}`]]) {
        const { bin, dir } = fakeSsh(exit, out, err)
        runCli(argv, deps(bin, dir))
        expect(existsSync(join(dir, 'ledger.jsonl'))).toBe(false)
      }
    }
  })
  test('an answer the ledger cannot take is still returned, with one stderr note', () => {
    const { bin, dir } = fakeSsh(255, '', 'yu@nuance.local: Permission denied (publickey).')
    mkdirSync(join(dir, 'ledger.jsonl'))
    const said: string[] = []
    expect(runCli(['status', `nuance/${ID}`], deps(bin, dir, { warn: (m) => said.push(m) }))).toMatchObject({ code: 1, out: { status: 'auth_refused' } })
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(/^summon: the Air ledger could not record the answer for nuance\/smn_e+ \(\w+\)$/)
  })
})

describe('F19: origin carries the start time and reaches the Air ledger with the effort', () => {
  test('lstartToIso reads ps\'s C-locale UTC start time and nothing else', () => {
    expect(lstartToIso('Sun Oct 11 00:38:43 2026')).toBe('2026-10-11T00:38:43.000Z')
    expect(lstartToIso('Fri Oct  9 10:00:00 2026')).toBe('2026-10-09T10:00:00.000Z')
    for (const bad of [null, '', 'yesterday', 'Sun Feb 31 00:00:00 2026', 'Sun Foo 11 00:38:43 2026', 'Sun Oct 11 24:00:00 2026', '2026-10-11T00:38:43Z']) expect(lstartToIso(bad)).toBeUndefined()
  })
  test('the request\'s origin has the parent\'s start time as ISO 8601, from the injected lookup', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    const asked: number[] = []
    runCli(startArgv(dir), deps(bin, dir, { env: { CLAUDECODE: '1' }, startTimeOf: (pid) => { asked.push(pid); return 'Sun Oct 11 00:38:43 2026' } }))
    expect(asked).toEqual([process.ppid])
    expect(JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8')).origin).toEqual({ harness: 'claude-code', pid: process.ppid, started_at: '2026-10-11T00:38:43.000Z' })
  })
  test('without a start time (no lookup, ps could not say, or a shape it does not know) started_at is left out', () => {
    for (const startTimeOf of [undefined, () => null, () => 'garbled', () => { throw new Error('ps') }]) {
      const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
      runCli(startArgv(dir), deps(bin, dir, { env: { CODEX_HOME: '/x' }, startTimeOf }))
      expect(JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8')).origin).toEqual({ harness: 'codex', pid: process.ppid })
    }
  })
  test('the sent entry carries the origin as one bounded string, and the effort', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    runCli(startArgv(dir, ['--effort', 'high']), deps(bin, dir, { startTimeOf: () => 'Sun Oct 11 00:38:43 2026' }))
    const [sent] = lines(join(dir, 'ledger.jsonl'))
    expect(sent).toMatchObject({ event: 'sent', effort: 'high', origin: `shell pid ${process.ppid} started 2026-10-11T00:38:43.000Z` })
    expect(readFileSync(join(dir, 'ledger.jsonl'), 'utf8')).not.toContain('README')
  })
})

describe('F48: --json always prints one JSON line', () => {
  const newHome = () => {
    const home = trackTmp(mkdtempSync(join(tmpdir(), 'summon-home-')))
    mkdirSync(join(home, '.ssh', 'summon'), { recursive: true })
    writeFileSync(join(home, '.ssh', 'summon', 'config'), PAIRED)
    return home
  }
  const ledgerOf = (home: string) => join(home, '.local', 'state', 'summon', 'ledger.jsonl')
  async function run(args: string[], bin: string, home: string, env: Record<string, string> = {}) {
    const p = Bun.spawn([process.execPath, BIN, ...args], { env: { PATH: process.env.PATH!, HOME: home, SUMMON_SSH_BIN: bin, ...env }, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    return { code, stdout, stderr }
  }
  test('an Air ledger that cannot be written: one JSON line, unreachable, "nothing was sent", exit 3; ssh never runs', async () => {
    const home = newHome()
    mkdirSync(ledgerOf(home), { recursive: true })
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    for (const argv of [startArgv(dir, ['--json']), ['--json', 'cancel', `nuance/${ID}`]]) {
      const r = await run(argv, bin, home)
      expect(r.code).toBe(3)
      expect(r.stdout.endsWith('\n')).toBe(true)
      expect(r.stdout.trimEnd().split('\n')).toHaveLength(1)
      const out = JSON.parse(r.stdout)
      expect(out).toEqual({ status: 'unreachable', detail: expect.stringMatching(/^could not write the Air ledger \(\w+\); nothing was sent$/) })
    }
    expect(calls(dir)).toBe(0)
  })
  test('inside a sandbox the JSON carries a hint naming it', async () => {
    const home = newHome()
    mkdirSync(ledgerOf(home), { recursive: true })
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    const r = await run(startArgv(dir, ['--json']), bin, home, { CODEX_SANDBOX: 'seatbelt' })
    expect(r.code).toBe(3)
    const out = JSON.parse(r.stdout)
    expect(out).toMatchObject({ status: 'unreachable', detail: expect.stringContaining('nothing was sent') })
    expect(out.hint).toContain('CODEX_SANDBOX=seatbelt')
    expect(out.hint).toMatch(/rerun .*outside/)
  })
  test('a usage error keeps exit 2 (and its JSON)', async () => {
    const { bin } = fakeSsh(0, '{"status":"admitted"}')
    const r = await run(['--json', 'nuance', 'claude', '--bogus', 'x'], bin, newHome())
    expect(r.code).toBe(2)
    expect(JSON.parse(r.stdout)).toMatchObject({ status: 'refused', reason: 'malformed' })
  })
})

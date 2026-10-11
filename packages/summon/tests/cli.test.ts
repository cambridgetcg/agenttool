import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lstartToIso, NothingSentError, parseCli, runCli, splitJsonFlag, type CliDeps } from '../src/cli.ts'
import { verifyLedger } from '../src/ledger.ts'
import { HOST_KEY_HINT, mapSshFailure, sshCall, type MapContext, type SshTarget } from '../src/ssh.ts'
import type { GateResponse } from '../src/status.ts'
import { cleanupTmps, DAY, dashed, trackTmp, ymd } from './helpers.ts'

afterEach(cleanupTmps)

const BIN = join(import.meta.dir, '..', 'bin', 'summon.ts')
/** What pin-nuance writes for the one paired device (the start of it: the CLI reads the Host line and its HostName). */
const PAIRED = 'Host summon-nuance\n  HostName nuance.local\n  BatchMode yes\n'
/** The paired entry as the classifier sees it (no User line: any user@nuance.local), and pin-nuance's paths on the Air. */
const KEY = '/Users/yuai/.ssh/summon/summon_nuance_ed25519'
const CFG = '/Users/yuai/.ssh/summon/config'
const NUANCE: SshTarget = { host: 'nuance.local', identityFile: KEY }
/** mapSshFailure against the paired nuance entry, outside any sandbox. */
const map = (stderr: string, ctx: MapContext = {}) => mapSshFailure(stderr, { target: NUANCE, config: CFG, env: {}, ...ctx })
/** Text as ssh itself prints it: every line ends \r\n (log.c, the client loop's quit_message). Remote stderr passes through as written. */
const crlf = (s: string) => s.replaceAll('\n', '\r\n') + '\r\n'

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
  test('final review M11: the usage names every flag a start parses, --effort and --provider included', () => {
    const usage = (parseCli([]) as { error: string }).error
    for (const f of ['--model', '--provider', '--effort', '--cwd', '--prompt-file', '--timeout', '--expires', '--label', '--job', '--review', '--edit']) {
      expect([f, usage.includes(f)]).toEqual([f, true])
    }
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
    expect(map(CHANGED_KEY)).toMatchObject({ status: 'host_key_mismatch' })
    expect(map(crlf('Host key verification failed.'))).toMatchObject({ status: 'host_key_mismatch' })
    expect(map(crlf('yu@nuance.local: Permission denied (publickey).'))).toMatchObject({ status: 'auth_refused' })
    expect(map(crlf('ssh: connect to host nuance.local port 22: Operation timed out'))).toMatchObject({ status: 'unreachable', reason: 'timeout' })
    expect(map(crlf('ssh: connect to host nuance.local port 22: Connection refused'))).toMatchObject({ status: 'unreachable', reason: 'timeout' })
    expect(map(crlf('ssh: Could not resolve hostname nuance.local: nodename nor servname provided, or not known'))).toMatchObject({ status: 'unreachable', reason: 'no_route' })
  })
  test('no route to host and an unreachable network are no_route, before any connection', () => {
    expect(map(crlf('ssh: connect to host nuance.local port 22: No route to host'))).toMatchObject({ status: 'unreachable', reason: 'no_route' })
    expect(map(crlf('ssh: connect to host nuance.local port 22: Network is unreachable'))).toMatchObject({ status: 'unreachable', reason: 'no_route' })
  })
  test('a banner timeout is a failure before authentication', () => {
    expect(map(crlf('Connection timed out during banner exchange'))).toMatchObject({ status: 'unreachable', reason: 'timeout' })
  })
  test('B3: a reset after the banner (kex_exchange_identification) is before authentication: unreachable(timeout)', () => {
    // OpenSSH 9.9p2, captured by the C review against a server that read the client's banner and then reset.
    expect(map('kex_exchange_identification: read: Connection reset by peer\r\nConnection reset by 127.0.0.1 port 22934\r\n')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
  })
  test('B3: a hang-up before the banner (MaxStartups included) prints only the peer drop, which reads unknown (safe)', () => {
    for (const s of ['Connection closed by 127.0.0.1 port 22933\r\n', 'Connection closed by 127.0.0.1 port 22935\r\n', 'banner exchange: Connection to 127.0.0.1 port 22933: Broken pipe\r\n']) {
      expect([s, map(s)]).toMatchObject([s, { status: 'unknown', detail: s.trimEnd() }])
    }
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
      const r = map(s)
      expect(r.status).toBe('unknown')
      expect(r.reason).toBeUndefined()
      expect(typeof r.detail).toBe('string')
    }
  })
  test('a loss after a connect line that did classify is still unknown: a lost connection is checked first', () => {
    const pre = 'ssh: connect to host nuance.local port 22: Operation timed out\r\n'
    expect(map(pre)).toMatchObject({ status: 'unreachable', reason: 'timeout' }) // alone it classifies...
    expect(map(`${pre}client_loop: send disconnect: Broken pipe\r\n`)).toEqual({ status: 'unknown', detail: 'client_loop: send disconnect: Broken pipe' }) // ...a loss beats it
  })
  test('F11: a drop after a permission denied is unknown: a lost connection is checked first', () => {
    // ssh exits at its own `Permission denied (...)` line, so a drop printed after it says a session may have existed.
    const pre = 'yu@nuance.local: Permission denied (publickey).\r\n'
    expect(map(pre)).toMatchObject({ status: 'auth_refused' })
    expect(map(`${pre}Connection closed by 192.168.50.3 port 22\r\n`)).toEqual({ status: 'unknown', detail: 'Connection closed by 192.168.50.3 port 22' })
  })
  test('an unrecognised failure is unknown, not a guess at the transport', () => {
    expect(map('ssh: something we have not seen\r\n')).toMatchObject({ status: 'unknown', detail: 'ssh exited 255 without a line it is known to print' }) // not a known whole ssh line
    expect(map('Connection to 192.168.50.3 port 22 timed out\r\n')).toMatchObject({ status: 'unknown', detail: 'Connection to 192.168.50.3 port 22 timed out' })
    expect(map('ssh: something we have not seen\n')).toMatchObject({ status: 'unknown', detail: 'ssh exited 255 without a line it is known to print' }) // not a CRLF line: maybe the remote's
    expect(map('')).toMatchObject({ status: 'unknown', detail: 'ssh exited 255 without a line it is known to print' })
  })
  test('the detail is one clipped line of printable ASCII (the target controls banners)', () => {
    // F11: a coloured line is not ssh's own `Permission denied (...)` line, so it is not read as auth_refused.
    expect(map(`first\n\u001b[31mPermission denied\u001b[0m ${'x'.repeat(400)}`)).toEqual({ status: 'unknown', detail: 'ssh exited 255 without a line it is known to print' })
    const r = map(crlf(`first\nConnection to \u001b[31m${'x'.repeat(400)} closed by remote host.`))
    expect(r.status).toBe('unknown')
    expect(r.detail).toStartWith('Connection to ?[31mxxx')
    expect(r.detail).not.toMatch(/[^\x20-\x7e]/)
    expect(r.detail!.length).toBeLessThanOrEqual(200)
    const a = map(crlf(`${'u'.repeat(300)}@nuance.local: Permission denied (publickey).`))
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
    const { bin } = fakeSsh(255, '', crlf('ssh: connect to host nuance.local port 22: Connection refused'))
    expect(sshCall({ sshBin: bin, sshConfig: 'c', target: NUANCE }, 'nuance', 'inventory')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
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
  test('final review I1: a result the runner capped (1,048,576 CJK units: 3 MiB of UTF-8) reads completed with the full text', () => {
    const text = '愛'.repeat(1_048_576)
    const { bin } = fakeSsh(0, JSON.stringify({ status: 'completed', result_text: text }) + '\n')
    const r = sshCall({ sshBin: bin, sshConfig: 'c' }, 'nuance', `result smn_${'a'.repeat(32)}`)
    expect(r.status).toBe('completed')
    expect(r.result_text === text).toBe(true) // not toEqual: a 3 MiB diff would drown the report
  })
  test('final review I1: more than 1 MiB of remote stderr beside a valid answer does not lose the answer', () => {
    const { bin } = fakeSsh(0, '{"status":"queued"}\n', `${'zshenv noise\n'.repeat(200_000)}`)
    expect(sshCall({ sshBin: bin, sshConfig: 'c' }, 'nuance', `status smn_${'a'.repeat(32)}`)).toEqual({ status: 'queued' })
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
    const { bin, dir } = fakeSsh(255, '', crlf('ssh: connect to host nuance.local port 22: Operation timed out'))
    expect(runCli(['nuance', 'inventory'], deps(bin, dir))).toMatchObject({ code: 1, out: { status: 'unreachable', reason: 'timeout' } })
  })
  test('a start that never connected is unreachable with no handle: nothing was delivered', () => {
    const { bin, dir } = fakeSsh(255, '', crlf('ssh: connect to host nuance.local port 22: Connection refused'))
    const r = runCli(startArgv(dir), deps(bin, dir))
    expect(r).toMatchObject({ code: 1, out: { status: 'unreachable', reason: 'timeout' } })
    expect(r.out.handle).toBeUndefined()
    expect(lines(join(dir, 'ledger.jsonl')).map((e) => e.event + ':' + e.status)).toEqual([`sent:undefined`, 'answer:unreachable'])
  })
  test('auth_refused and host_key_mismatch after a start are reported as such', () => {
    const a = fakeSsh(255, '', crlf('yu@nuance.local: Permission denied (publickey).'))
    expect(runCli(startArgv(a.dir), deps(a.bin, a.dir))).toMatchObject({ code: 1, out: { status: 'auth_refused' } })
    const h = fakeSsh(255, '', CHANGED_KEY)
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
  test('final review M9: the heartbeat age is printed for queued, running and unknown, not for a job that ended', async () => {
    const handle = `nuance/smn_${'e'.repeat(32)}`
    for (const status of ['queued', 'running', 'unknown']) {
      const { bin } = fakeSsh(0, JSON.stringify({ status, handle, heartbeat_age_s: 42 }))
      expect([status, (await run(['status', handle], bin)).stdout]).toEqual([status, `${status} ${handle}\nheartbeat: 42s ago\n`])
    }
    for (const status of ['completed', 'failed', 'cancelled', 'timed_out', 'expired']) {
      const { bin } = fakeSsh(0, JSON.stringify({ status, handle, heartbeat_age_s: 42 }))
      expect([status, (await run(['status', handle], bin)).stdout]).toEqual([status, `${status} ${handle}\n`])
    }
  })
  test('final review L195: control characters in printed fields are shown as escapes, so the remote cannot drive the terminal; --json is unchanged', async () => {
    const handle = `nuance/smn_${'f'.repeat(32)}`
    const answer = { status: 'completed', handle: `${handle}\u001b[8m`, reason: 'x\u0007', resets_at: 'r\u001b[1A',
      detail: '\u001b[31mred\u001b[0m', hint: 'over\rwrite\u0000', result_text: 'line 1\n\tindented\n\u001b]0;title\u0007\u001b[2J\u009b31m\u007f end' }
    const { bin } = fakeSsh(0, JSON.stringify(answer))
    const human = (await run(['result', handle], bin)).stdout
    expect(human).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
    expect(human).toBe([`completed (x\\x07) ${handle}\\x1b[8m`, 'resets: r\\x1b[1A', 'detail: \\x1b[31mred\\x1b[0m', 'hint: over\\x0dwrite\\x00',
      'line 1\n\tindented\n\\x1b]0;title\\x07\\x1b[2J\\x9b31m\\x7f end', ''].join('\n'))
    const { bin: jsonBin } = fakeSsh(0, JSON.stringify(answer))
    expect(JSON.parse((await run(['result', handle, '--json'], jsonBin)).stdout)).toEqual(answer)
  })
  test('final review L195: an inventory is printed with its control characters escaped too', async () => {
    const { bin } = fakeSsh(0, JSON.stringify({ status: 'completed', inventory: { host: 'nu\u009bance' } }))
    expect((await run(['nuance', 'inventory'], bin)).stdout).toBe('completed\n{\n  "host": "nu\\x9bance"\n}\n')
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
  test('a ledger that cannot be written before the send: printed as any answer is, unreachable (no_route), exit 3 (not the usage 2), no stack trace', async () => {
    const home = newHome()
    mkdirSync(ledgerOf(home), { recursive: true })
    const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
    const r = await run(startArgv(dir), bin, home)
    expect(r.code).toBe(3)
    expect(r.stdout).toMatch(/^unreachable \(no_route\)\ndetail: could not write the Air ledger \(\w+\); nothing was sent\n$/)
    expect(r.stderr).toBe('')
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
].join('\r\n').replace('sent by the remote host is\r\n', 'sent by the remote host is\n') + '\r\n' // one message over two lines: its inner line ends a bare \n

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
  /** As ssh prints them (CRLF) the cases map to `want`; the same text with bare \n (the remote's) is never a transport status. */
  const expectAll = (cases: string[], want: Record<string, unknown>) => {
    for (const s of cases) {
      expect([s, map(crlf(s))]).toMatchObject([s, want])
      expect([s, map(s)]).toMatchObject([s, { status: 'unknown' }])
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
    expect(map(`${ZSHENV}\nConnection to nuance.local closed by remote host.\r\n`)).toEqual({ status: 'unknown', detail: 'Connection to nuance.local closed by remote host.' })
  })
  test('F11: a lowercase permission denied from a shell is not ssh\'s authentication failure', () => {
    expectAll([ZSHENV], { status: 'unknown' })
    expectAll(['yu@nuance.local: Permission denied (publickey).', 'yu@nuance.local: Permission denied (publickey,keyboard-interactive).'], { status: 'auth_refused' })
  })
  test('F11: a no-route or unreachable-network that is not ssh\'s own connect line is unknown', () => {
    expectAll(['No route to host', 'debug1: connect to address 192.168.50.3 port 22: No route to host', 'x: ssh: connect to host nuance.local port 22: No route to host',
      'could not resolve hostname nuance.local'], { status: 'unknown' })
  })
  test('F29: Host is down (the ARP reject window after a first timeout) is unreachable(timeout), on either connect line', () => {
    expectAll(['ssh: connect to host nuance.local port 22: Host is down',
      'ssh: connect to host nuance.local port 22: Operation timed out', 'ssh: connect to host nuance.local port 22: Connection refused',
      'Connection timed out during banner exchange\nConnection to 192.168.50.3 port 22 timed out'], { status: 'unreachable', reason: 'timeout' })
    expectAll(['ssh: connect to address 192.168.50.220 port 22: Host is down', 'connect to address 192.168.50.220 port 22: Host is down'], { status: 'unknown' })
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
      '/Users/yuai/.ssh/summon/config: line 3: Bad configuration option: bogus\n/Users/yuai/.ssh/summon/config: terminating, 1 bad configuration options',
    ], { status: 'unreachable', reason: 'no_route' })
  })
  test('kex_exchange_identification is still before authentication (R11\'s exception), and a kex line must be ssh\'s own', () => {
    expectAll(['kex_exchange_identification: read: Connection reset by peer\nConnection reset by 192.168.50.3 port 22'], { status: 'unreachable', reason: 'timeout' })
    expectAll(['x: kex_exchange_identification: read: Connection reset by peer\nConnection reset by 192.168.50.3 port 22'], { status: 'unknown' })
  })
  test('the deciding line is the detail, not whatever came last', () => {
    expect(map('kex_exchange_identification: read: Connection reset by peer\r\nConnection reset by 127.0.0.1 port 22934\r\n').detail)
      .toBe('kex_exchange_identification: read: Connection reset by peer')
  })
  test('through sshCall and runCli: Host is down reads unreachable(timeout), no handle, and the ledger says unreachable', () => {
    const { bin, dir } = fakeSsh(255, '', 'ssh: connect to host nuance.local port 22: Host is down\r\n')
    expect(sshCall({ sshBin: bin, sshConfig: 'c', target: NUANCE }, 'nuance', 'inventory')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
    const r = runCli(startArgv(dir), deps(bin, dir))
    expect(r).toMatchObject({ code: 1, out: { status: 'unreachable', reason: 'timeout' } })
    expect(r.out.handle).toBeUndefined()
    expect(lines(join(dir, 'ledger.jsonl')).map((e) => `${e.event}:${e.status}`)).toEqual(['sent:undefined', 'answer:unreachable'])
  })
  test('through runCli: a seatbelt-denied connect (EPERM) is unreachable(no_route) with no handle', () => {
    for (const config of ['ssh: connect to host nuance.local port 22: Operation not permitted', "Can't open user config file @CFG@: Operation not permitted"]) {
      const { bin, dir } = fakeSsh(255, '')
      const line = config.replace('@CFG@', join(dir, 'config'))
      writeFileSync(join(dir, 'err'), `${line}\r\n`)
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
        const { bin, dir } = fakeSsh(255, '', crlf(line))
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
      const { bin, dir } = fakeSsh(255, '', crlf(line))
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
      const { bin, dir } = fakeSsh(255, '', crlf(line))
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
        const { bin, dir } = fakeSsh(255, '', crlf(line))
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
      expect(said).toEqual([`summon: the summon key expires on ${dashed(soon)} (in 3 days): re-pair before then (README install step 1)`])
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
  test('A(c): one day left says "in 1 day"', () => {
    const { bin, dir } = fakeSsh(0, '{"status":"completed"}')
    const e = ymd(Date.now() + DAY)
    withExpiry(dir, e)
    const said: string[] = []
    runCli(['nuance', 'inventory'], deps(bin, dir, { warn: (m) => said.push(m) }))
    expect(said).toEqual([`summon: the summon key expires on ${dashed(e)} (in 1 day): re-pair before then (README install step 1)`])
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
    expect(HOST_KEY_HINT).toBe('security event — Nuance presented a different host key. Do not re-pin from the network. On Nuance run ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub; only if it shows this fingerprint and you know why it changed, re-pin with bun scripts/pin-nuance.ts --user <your Nuance user> --host-key "<line read on Nuance>" --expires <YYYYMMDD from the hand-back>')
  })
  test('an unknown host key (no pin) is a mismatch with the same hint and no fingerprint', () => {
    const r = map('No ED25519 host key is known for summon-nuance and you have requested strict checking.\r\nHost key verification failed.\r\n')
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
    expect(lines(join(dir, 'ledger.jsonl'))).toMatchObject([{ event: 'cancel_sent', id: ID }, { event: 'cancel_answer', id: ID, status: 'running', detail: 'cancel requested' }])
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
    const { bin, dir } = fakeSsh(255, '', crlf('yu@nuance.local: Permission denied (publickey).'))
    expect(runCli(['cancel', `nuance/${ID}`], deps(bin, dir))).toMatchObject({ code: 1, out: { status: 'auth_refused' } })
    expect(lines(join(dir, 'ledger.jsonl'))).toMatchObject([{ event: 'cancel_sent', id: ID }, { event: 'cancel_answer', id: ID, status: 'auth_refused', detail: 'yu@nuance.local: Permission denied (publickey).' }])
  })
  test('inventory, status and result ledger an auth_refused or host_key_mismatch answer', () => {
    for (const [stderr, status] of [[crlf('yu@nuance.local: Permission denied (publickey).'), 'auth_refused'], [CHANGED_KEY, 'host_key_mismatch']] as const) {
      for (const [argv, id, event] of [[['nuance', 'inventory'], undefined, 'inventory_answer'], [['status', `nuance/${ID}`], ID, 'status_answer'], [['result', `nuance/${ID}`], ID, 'result_answer']] as const) {
        const { bin, dir } = fakeSsh(255, '', stderr)
        expect(runCli([...argv], deps(bin, dir)).out.status).toBe(status)
        const entries = lines(join(dir, 'ledger.jsonl'))
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({ event, status })
        expect(entries[0].id).toBe(id)
        expect(verifyLedger(join(dir, 'ledger.jsonl')).ok).toBe(true)
      }
    }
  })
  test('a read that is answered, or fails as unreachable or unknown, writes nothing on the Air', () => {
    for (const [exit, out, err] of [[0, '{"status":"completed"}', ''], [255, '', crlf('ssh: connect to host nuance.local port 22: Operation timed out')], [255, '', crlf('client_loop: send disconnect: Broken pipe')]] as const) {
      for (const argv of [['nuance', 'inventory'], ['status', `nuance/${ID}`], ['result', `nuance/${ID}`]]) {
        const { bin, dir } = fakeSsh(exit, out, err)
        runCli(argv, deps(bin, dir))
        expect(existsSync(join(dir, 'ledger.jsonl'))).toBe(false)
      }
    }
  })
  test('an answer the ledger cannot take is still returned, with one stderr note', () => {
    const { bin, dir } = fakeSsh(255, '', crlf('yu@nuance.local: Permission denied (publickey).'))
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
      expect(out).toEqual({ status: 'unreachable', reason: 'no_route', detail: expect.stringMatching(/^could not write the Air ledger \(\w+\); nothing was sent$/) })
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
    expect(out).toMatchObject({ status: 'unreachable', reason: 'no_route', detail: expect.stringContaining('nothing was sent') })
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

// ── C review, round 1 ──

/**
 * OpenSSH_9.9p2's own stderr, captured byte for byte by the C review against a local sshd and listeners
 * (scratchpad c-review/cl/err-*). ssh's own lines end \r\n; lines with only \n came from the remote session.
 */
const R = '/private/tmp/claude-502/-Users-yuai/d00cd030-ccd1-4b78-a231-13a7a9731c60/scratchpad/c-review/cl'
const CAPTURE: Record<string, string> = {
  'badconf': "cl/badconf: line 2: Bad configuration option: bogus\r\ncl/badconf: terminating, 1 bad configuration options\r\n",
  'changedkey': "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\nIT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!\r\nSomeone could be eavesdropping on you right now (man-in-the-middle attack)!\r\nIt is also possible that a host key has just been changed.\r\nThe fingerprint for the ED25519 key sent by the remote host is\nSHA256:C/JQOifBld6TAkrNhJn6UfvfParPv6E5xha7zm1I9/A.\r\nPlease contact your system administrator.\r\nAdd correct host key in /private/tmp/claude-502/-Users-yuai/d00cd030-ccd1-4b78-a231-13a7a9731c60/scratchpad/c-review/cl/know to get rid of this message.\r\nOffending ED25519 key in /private/tmp/claude-502/-Users-yuai/d00cd030-ccd1-4b78-a231-13a7a9731c60/scratchpad/c-review/cl/known_hosts:1\r\nHost key for summon-nuance has changed and you have requested strict checking.\r\nHost key verification failed.\r\n",
  'drop': "Connection to 127.0.0.1 closed by remote host.\r\n",
  'freeze': "Timeout, server 127.0.0.1 not responding.\r\n",
  'kex-close': "Connection closed by 127.0.0.1 port 22933\r\n",
  'kex-hang': "Connection timed out during banner exchange\r\nConnection to 127.0.0.1 port 22933 timed out\r\n",
  'kex-rst': "banner exchange: Connection to 127.0.0.1 port 22933: Broken pipe\r\n",
  'kex2-close': "Connection closed by 127.0.0.1 port 22934\r\n",
  'kex2-rst': "kex_exchange_identification: read: Connection reset by peer\r\nConnection reset by 127.0.0.1 port 22934\r\n",
  'killauth': "git@github.com: Permission denied (publickey).\n",
  'killself': "/Users/yu/.zshenv:3: permission denied: /Users/yu/.fleet/env\n",
  'maxstartups': "Connection closed by 127.0.0.1 port 22935\r\n",
  'missingid': "no such identity: /private/tmp/claude-502/-Users-yuai/d00cd030-ccd1-4b78-a231-13a7a9731c60/scratchpad/c-review/cl/missing: No such file or directory\r\nyuai@127.0.0.1: Permission denied (publickey).\r\n",
  'noconf': "Can't open user config file cl/nope: No such file or directory\r\n",
  'noroute255': "ssh: connect to host github.com port 22: No route to host\n",
  'permconf': "ssh: connect to host 127.0.0.1 port 1: Connection refused\r\n",
  'rst': "Connection to 127.0.0.1 closed by remote host.\r\n",
  'stderr255': "yu@nuance.local: Permission denied (publickey).\n",
  'summon-closed': "ssh: connect to host 127.0.0.1 port 1: Connection refused\r\n",
  'summon-nuance': "ssh: Could not resolve hostname nonexistent-summon-review.invalid: nodename nor servname provided, or not known\r\n",
  'unknownhost': "No ED25519 host key is known for summon-nuance and you have requested strict checking.\r\nHost key verification failed.\r\n",
  'wrongkey': "yuai@127.0.0.1: Permission denied (publickey).\r\n",
}
/** The review's two Host entries: lconf (a local sshd, User yuai) and config (a name that does not resolve). */
const LOCAL_SSHD: SshTarget = { host: '127.0.0.1', user: 'yuai', identityFile: `${R}/id` }
const FIXED = 'ssh exited 255 without a line it is known to print'

describe('C review round 1: real OpenSSH 9.9p2 stderr', () => {
  const cases: [string, MapContext, Record<string, unknown>][] = [
    ['badconf', { config: 'cl/badconf' }, { status: 'unreachable', reason: 'no_route', detail: 'cl/badconf: line 2: Bad configuration option: bogus' }],
    ['noconf', { config: 'cl/nope' }, { status: 'unreachable', reason: 'no_route', detail: "Can't open user config file cl/nope: No such file or directory" }],
    ['changedkey', {}, { status: 'host_key_mismatch', detail: 'Host key verification failed. Presented ED25519 key: SHA256:C/JQOifBld6TAkrNhJn6UfvfParPv6E5xha7zm1I9/A', hint: HOST_KEY_HINT }],
    ['unknownhost', {}, { status: 'host_key_mismatch', detail: 'Host key verification failed.' }],
    ['drop', {}, { status: 'unknown', detail: 'Connection to 127.0.0.1 closed by remote host.' }],
    ['rst', {}, { status: 'unknown', detail: 'Connection to 127.0.0.1 closed by remote host.' }],
    ['freeze', {}, { status: 'unknown', detail: 'Timeout, server 127.0.0.1 not responding.' }],
    ['kex-close', {}, { status: 'unknown', detail: 'Connection closed by 127.0.0.1 port 22933' }],
    ['kex2-close', {}, { status: 'unknown', detail: 'Connection closed by 127.0.0.1 port 22934' }],
    ['maxstartups', {}, { status: 'unknown', detail: 'Connection closed by 127.0.0.1 port 22935' }],
    ['kex-rst', {}, { status: 'unknown', detail: 'banner exchange: Connection to 127.0.0.1 port 22933: Broken pipe' }],
    ['kex2-rst', {}, { status: 'unreachable', reason: 'timeout', detail: 'kex_exchange_identification: read: Connection reset by peer' }],
    ['kex-hang', {}, { status: 'unreachable', reason: 'timeout', detail: 'Connection timed out during banner exchange' }],
    ['wrongkey', {}, { status: 'auth_refused', detail: 'yuai@127.0.0.1: Permission denied (publickey).' }],
    ['missingid', { target: { ...LOCAL_SSHD, identityFile: `${R}/missing` } },
      { status: 'auth_refused', detail: `no such identity: ${R}/missing: No such file or directory`, hint: `the summon key on this Air is missing or unreadable (${R}/missing)` }],
    // A 0666 -F config is not refused (ssh checks permissions only on ~/.ssh/config): the connect itself answered.
    ['permconf', { target: { host: '127.0.0.1' } }, { status: 'unreachable', reason: 'timeout', detail: 'ssh: connect to host 127.0.0.1 port 1: Connection refused' }],
    ['summon-closed', { target: { host: '127.0.0.1' } }, { status: 'unreachable', reason: 'timeout' }],
    ['summon-nuance', { target: { host: 'nonexistent-summon-review.invalid' } }, { status: 'unreachable', reason: 'no_route',
      detail: 'ssh: Could not resolve hostname nonexistent-summon-review.invalid: nodename nor servname provided, or not known' }],
    // The remote session's own stderr, then exit 255 or a signal: never a transport status, never its text as the detail.
    ['killself', {}, { status: 'unknown', detail: FIXED }],
    ['killauth', {}, { status: 'unknown', detail: FIXED }],
    ['stderr255', {}, { status: 'unknown', detail: FIXED }],
    ['noroute255', {}, { status: 'unknown', detail: FIXED }], // ssh-shaped, but a bare \n: the remote's line
  ]
  test('each capture maps as the governing rule says', () => {
    for (const [name, ctx, want] of cases) {
      const r = mapSshFailure(CAPTURE[name]!, { target: LOCAL_SSHD, env: {}, ...ctx })
      expect([name, r]).toEqual([name, expect.objectContaining(want)])
      if (r.status !== 'unreachable') expect([name, r.reason]).toEqual([name, undefined])
    }
    expect(Object.keys(CAPTURE).filter((k) => k !== 'ok').sort()).toEqual(cases.map(([n]) => n).sort())
  })
})

describe('B4: a pre-connect line counts only when it names the paired host (and user)', () => {
  const YU: SshTarget = { host: 'nuance.local', user: 'yu', identityFile: KEY }
  test('remote noise about other hosts reads unknown; the genuine nuance.local lines keep their status', () => {
    for (const [s, want] of [
      ['git@github.com: Permission denied (publickey).', { status: 'unknown' }],
      ['yuai@nuance.local: Permission denied (publickey).', { status: 'unknown' }], // not the configured user
      ['yu@nuance.local: Permission denied (publickey).', { status: 'auth_refused' }],
      ['ssh: connect to host github.com port 22: No route to host', { status: 'unknown' }],
      ['ssh: connect to host nuance.local port 22: No route to host', { status: 'unreachable', reason: 'no_route' }],
      ['ssh: Could not resolve hostname github.com: nodename nor servname provided, or not known', { status: 'unknown' }],
      ['ssh: Could not resolve hostname nuance.local: nodename nor servname provided, or not known', { status: 'unreachable', reason: 'no_route' }],
      ['ssh: connect to host github.com port 22: Operation timed out', { status: 'unknown' }],
      ['ssh: connect to host nuance.local port 22: Operation timed out', { status: 'unreachable', reason: 'timeout' }],
      ['ssh: connect to host github.com port 22: Operation not permitted', { status: 'unknown' }],
      ['ssh: connect to host nuance.local port 22: Operation not permitted', { status: 'unreachable', reason: 'no_route' }],
      ['ssh: connect to host nuance.localx port 22: Host is down', { status: 'unknown' }],
      ['ssh: connect to host nuancealocal port 22: Host is down', { status: 'unknown' }], // the dot is literal
      ["Can't open user config file /elsewhere/config: Operation not permitted", { status: 'unknown' }],
    ] as const) {
      expect([s, mapSshFailure(`${s}\r\n`, { target: YU, config: CFG, env: {} })]).toMatchObject([s, want])
      expect([s, mapSshFailure(`${s}\n`, { target: YU, config: CFG, env: {} })]).toMatchObject([s, { status: 'unknown' }])
    }
  })
  test('with no HostName to anchor to, those classes fall back to unknown (the safe side)', () => {
    for (const s of ['yu@nuance.local: Permission denied (publickey).', 'ssh: connect to host nuance.local port 22: No route to host',
      'ssh: connect to host nuance.local port 22: Operation timed out', 'ssh: connect to host nuance.local port 22: Operation not permitted',
      'ssh: Could not resolve hostname nuance.local: nodename nor servname provided, or not known', 'Connection timed out during banner exchange']) {
      expect([s, mapSshFailure(`${s}\r\n`)]).toMatchObject([s, { status: 'unknown' }])
      expect([s, mapSshFailure(`${s}\r\n`, { target: {} })]).toMatchObject([s, { status: 'unknown' }])
    }
  })
  test('Too many authentication failures names an address, not the pin, so it reads unknown', () => {
    expect(map('Received disconnect from 192.168.50.3 port 22:2: Too many authentication failures\r\nDisconnected from 192.168.50.3 port 22\r\n')).toMatchObject({ status: 'unknown' })
  })
  test('through runCli: the HostName and User come from the summon ssh config', () => {
    const config = 'Host summon-other\n  HostName github.com\n  User git\n\nHost summon-nuance\n  HostName nuance.local\n  User yu\n  IdentityFile /k\n'
    for (const [stderr, want] of [
      ['yu@nuance.local: Permission denied (publickey).\r\n', { code: 1, out: { status: 'auth_refused' } }],
      ['git@github.com: Permission denied (publickey).\n', { code: 1, out: { status: 'unknown', detail: FIXED } }],
      ['ssh: connect to host github.com port 22: No route to host\n', { code: 1, out: { status: 'unknown' } }],
      ['ssh: connect to host nuance.local port 22: No route to host\r\n', { code: 1, out: { status: 'unreachable', reason: 'no_route' } }],
    ] as const) {
      const { bin, dir } = fakeSsh(255, '', stderr)
      writeFileSync(join(dir, 'config'), config)
      expect([stderr, runCli(['nuance', 'inventory'], deps(bin, dir))]).toMatchObject([stderr, want])
    }
  })
  test('through runCli: a paired entry with no HostName line reads unknown for those classes', () => {
    const { bin, dir } = fakeSsh(255, '', 'ssh: connect to host nuance.local port 22: Operation timed out\r\n')
    writeFileSync(join(dir, 'config'), 'Host summon-nuance\n  BatchMode yes\n')
    expect(runCli(['nuance', 'inventory'], deps(bin, dir))).toMatchObject({ code: 1, out: { status: 'unknown' } })
  })
})

describe('B1: a detail is never the remote session\'s text', () => {
  test('a signal-killed remote (its zshenv line, then exit 255) is unknown with a fixed detail, on the answer and in the Air ledger', () => {
    const { bin, dir } = fakeSsh(255, '', CAPTURE['killself']!)
    const r = runCli(startArgv(dir), deps(bin, dir))
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(r).toEqual({ code: 1, out: { status: 'unknown', detail: FIXED, handle: `nuance/${sent.id}` } })
    expect(lines(join(dir, 'ledger.jsonl'))[1]).toMatchObject({ event: 'answer', status: 'unknown', detail: FIXED })
    expect(readFileSync(join(dir, 'ledger.jsonl'), 'utf8')).not.toContain('zshenv')
  })
  test('a loss found only in a line that is not ssh\'s own keeps the fixed detail too', () => {
    for (const s of ['cat: stdout: Broken pipe', '/Users/yu/.zshenv:9: x: Connection reset by peer', 'note: client_loop: y']) {
      expect([s, map(s)]).toEqual([s, { status: 'unknown', detail: FIXED }])
    }
    expect(map(`cat: stdout: Broken pipe\nConnection to nuance.local closed by remote host.\r\n`)).toEqual({ status: 'unknown', detail: 'Connection to nuance.local closed by remote host.' })
  })
  test('ssh\'s own unrecognised lines are still shown', () => {
    for (const s of ['Unable to negotiate with 192.168.50.3 port 22: no matching host key type found. Their offer: ssh-rsa',
      'Connection to 192.168.50.3 port 22 timed out', 'Disconnected from 192.168.50.3 port 22']) {
      expect([s, map(`${s}\r\n`)]).toEqual([s, { status: 'unknown', detail: s }])
    }
  })
})

describe('B2: a missing or unreadable summon key is the Air\'s own auth failure', () => {
  test('no such identity (the configured key) is auth_refused with a hint naming the key, not no_route', () => {
    for (const err of ['No such file or directory', 'Operation not permitted']) {
      const r = map(`no such identity: ${KEY}: ${err}\r\nyu@nuance.local: Permission denied (publickey).\r\n`)
      expect(r).toEqual({ status: 'auth_refused', detail: `no such identity: ${KEY}: ${err}`, hint: `the summon key on this Air is missing or unreadable (${KEY})` })
    }
  })
  test('through runCli the key hint is kept (not replaced by the FileVault one), with the key path from the config', () => {
    const { bin, dir } = fakeSsh(255, '', 'no such identity: /keys/summon_nuance_ed25519: No such file or directory\r\nyu@nuance.local: Permission denied (publickey).\r\n')
    writeFileSync(join(dir, 'config'), 'Host summon-nuance\n  HostName nuance.local\n  IdentityFile /keys/summon_nuance_ed25519\n')
    expect(runCli(['nuance', 'inventory'], deps(bin, dir))).toMatchObject({ code: 1, out: { status: 'auth_refused',
      hint: 'the summon key on this Air is missing or unreadable (/keys/summon_nuance_ed25519)' } })
  })
  test('Bad owner or permissions is never printed for a -F config, so it is not a pattern: it reads unknown', () => {
    expect(map('Bad owner or permissions on /Users/yuai/.ssh/summon/config\r\n')).toMatchObject({ status: 'unknown' })
  })
})

describe('B5: --effort has the request\'s token shape on the Air too', () => {
  test('a token is accepted; anything else is a usage error and nothing is ledgered or sent', () => {
    expect(parseCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/x', '--prompt-file', 't', '--effort', 'high'])).toMatchObject({ kind: 'start', effort: 'high' })
    for (const effort of ['hi gh', '', 'x'.repeat(65), 'high;rm', 'é']) {
      expect(String((parseCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', '~/x', '--prompt-file', 't', '--effort', effort]) as { error?: string }).error)).toMatch(/^--effort /)
      const { bin, dir } = fakeSsh(0, '{"status":"admitted"}')
      expect(runCli(startArgv(dir, ['--effort', effort]), deps(bin, dir))).toMatchObject({ code: 2, out: { status: 'refused', reason: 'malformed' } })
      expect(calls(dir)).toBe(0)
      expect(existsSync(join(dir, 'ledger.jsonl'))).toBe(false)
    }
  })
})

describe('B6: bin/summon.ts answers unknown for a fault that is not a pre-send ledger failure', () => {
  test('--json: one unknown line, "summon error: …", exit 1; human: the same answer printed as any other; ssh never runs', async () => {
    const home = trackTmp(mkdtempSync(join(tmpdir(), 'summon-home-')))
    mkdirSync(join(home, '.ssh', 'summon'), { recursive: true })
    writeFileSync(join(home, '.ssh', 'summon', 'config'), PAIRED)
    // A fault inside runCli that it does not expect: the clock it reads first throws.
    const preload = join(home, 'clock-fault.ts')
    writeFileSync(preload, "Date.now = () => { throw new Error('test fault: the clock is gone') }\n")
    const { bin, dir } = fakeSsh(0, '{"status":"completed"}')
    const go = async (args: string[]) => {
      const p = Bun.spawn([process.execPath, '--preload', preload, BIN, ...args], { env: { PATH: process.env.PATH!, HOME: home, SUMMON_SSH_BIN: bin }, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
      const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
      return { stdout, stderr, code }
    }
    const j = await go(['--json', 'nuance', 'inventory'])
    expect(j).toEqual({ code: 1, stderr: '', stdout: '{"status":"unknown","detail":"summon error: test fault: the clock is gone"}\n' })
    const h = await go(['nuance', 'inventory'])
    expect(h).toEqual({ code: 1, stderr: '', stdout: 'unknown\ndetail: summon error: test fault: the clock is gone\n' })
    expect(calls(dir)).toBe(0)
  })
})

// ── C review, round 2 ──

describe('round 2: a transport status is read only from ssh\'s own CRLF lines', () => {
  /** The captures that carry a transport status, with the entry each was taken against (as in the round 1 table). */
  const CLASSIFYING: [string, MapContext][] = [
    ['badconf', { config: 'cl/badconf' }], ['noconf', { config: 'cl/nope' }], ['changedkey', {}], ['unknownhost', {}],
    ['kex2-rst', {}], ['kex-hang', {}], ['wrongkey', {}], ['missingid', { target: { ...LOCAL_SSHD, identityFile: `${R}/missing` } }],
    ['permconf', { target: { host: '127.0.0.1' } }], ['summon-closed', { target: { host: '127.0.0.1' } }],
    ['summon-nuance', { target: { host: 'nonexistent-summon-review.invalid' } }],
  ]
  const mapAs = (text: string, ctx: MapContext) => mapSshFailure(text, { target: LOCAL_SSHD, env: {}, ...ctx })
  test('every classifying 9.9p2 capture: its deciding lines end \\r\\n, it keeps its status, and its bare-\\n copy reads unknown', () => {
    for (const [name, ctx] of CLASSIFYING) {
      const raw = CAPTURE[name]!
      const genuine = mapAs(raw, ctx)
      expect([name, genuine.status]).not.toEqual([name, 'unknown'])
      expect([name, mapAs(raw.replaceAll('\r\n', '\n'), ctx)]).toEqual([name, { status: 'unknown', detail: FIXED }])
    }
  })
  test('making any one line of a classifying capture bare never yields a different transport status: the same answer, or unknown', () => {
    for (const [name, ctx] of CLASSIFYING) {
      const raw = CAPTURE[name]!
      const genuine = mapAs(raw, ctx)
      const parts = raw.split('\r\n')
      for (let i = 0; i < parts.length - 1; i++) {
        const variant = [...parts.slice(0, i), `${parts[i]}\n${parts[i + 1]}`, ...parts.slice(i + 2)].join('\r\n')
        const r = mapAs(variant, ctx)
        expect([name, i, r.status === 'unknown' || (r.status === genuine.status && r.reason === genuine.reason)]).toEqual([name, i, true])
      }
    }
  })
  test('the reviewer\'s repros: a remote bare-\\n kex, host-key or banner line, then exit 255, reads unknown', () => {
    expect(map('kex_exchange_identification: x\nConnection reset by 192.168.50.3 port 22\r\n')).toEqual({ status: 'unknown', detail: 'Connection reset by 192.168.50.3 port 22' })
    expect(map('Host key verification failed.\n')).toEqual({ status: 'unknown', detail: FIXED })
    expect(map('Connection timed out during banner exchange\n')).toEqual({ status: 'unknown', detail: FIXED })
    expect(map('@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key verification failed.\n')).toEqual({ status: 'unknown', detail: FIXED })
  })
  test('through runCli: those repros give unknown with the handle, and the ledger holds no remote text', () => {
    for (const stderr of ['kex_exchange_identification: x\nConnection reset by 192.168.50.3 port 22\r\n', 'Host key verification failed.\n',
      'Connection timed out during banner exchange\n', 'yu@nuance.local: Permission denied (publickey).\n', 'ssh: connect to host nuance.local port 22: No route to host\n']) {
      const { bin, dir } = fakeSsh(255, '', stderr)
      const r = runCli(startArgv(dir), deps(bin, dir))
      const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
      expect([stderr, r]).toMatchObject([stderr, { code: 1, out: { status: 'unknown', handle: `nuance/${sent.id}` } }])
      expect(r.out.reason).toBeUndefined()
      expect(lines(join(dir, 'ledger.jsonl'))[1]).toMatchObject({ event: 'answer', status: 'unknown' })
    }
  })
  test('a line with no terminator at all is not ssh\'s either', () => {
    expect(map('ssh: connect to host nuance.local port 22: Operation timed out')).toMatchObject({ status: 'unknown' })
    expect(map('ssh: connect to host nuance.local port 22: Operation timed out\r')).toMatchObject({ status: 'unknown' })
    expect(map('ssh: connect to host nuance.local port 22: Operation timed out\r\n')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
  })
  test('a loss line reads unknown whatever its line ending', () => {
    for (const loss of ['Connection to nuance.local closed by remote host.', 'Timeout, server nuance.local not responding.', 'client_loop: send disconnect: Broken pipe',
      'Read from remote host nuance.local: No route to host', 'Connection reset by 192.168.50.3 port 22', 'Connection closed by 192.168.50.3 port 22']) {
      for (const tail of ['\r\n', '\n', '']) {
        expect([loss, tail, map(`ssh: connect to host nuance.local port 22: Operation timed out\r\n${loss}${tail}`).status]).toEqual([loss, tail, 'unknown'])
      }
    }
  })
})

describe('round 2: the HostName anchor is lowercased, as ssh prints it', () => {
  test('a mixed-case HostName still anchors ssh\'s lowercased lines', () => {
    const t: SshTarget = { host: 'Nuance.LOCAL', user: 'yu' }
    expect(mapSshFailure('ssh: connect to host nuance.local port 22: Operation timed out\r\n', { target: t })).toMatchObject({ status: 'unreachable', reason: 'timeout' })
    expect(mapSshFailure('yu@nuance.local: Permission denied (publickey).\r\n', { target: t })).toMatchObject({ status: 'auth_refused' })
    expect(mapSshFailure('ssh: Could not resolve hostname nuance.local: nodename nor servname provided, or not known\r\n', { target: t })).toMatchObject({ status: 'unreachable', reason: 'no_route' })
  })
  test('through runCli, with `HostName Nuance.Local` in the summon ssh config', () => {
    const { bin, dir } = fakeSsh(255, '', 'ssh: connect to host nuance.local port 22: Host is down\r\n')
    writeFileSync(join(dir, 'config'), 'Host summon-nuance\n  HostName Nuance.Local\n')
    expect(runCli(['nuance', 'inventory'], deps(bin, dir))).toMatchObject({ code: 1, out: { status: 'unreachable', reason: 'timeout' } })
  })
})

// ── C review, round 3 ──

describe('round 3: a remote head joined to ssh\'s loss line can only read unknown', () => {
  /** Remote stderr written with no newline: the opening words of every classifier, which ssh's next line would complete. */
  const HEADS = ['kex_exchange_identification: ', 'kex_exchange_identification: read: Connection reset by peer', 'No ED25519 host key is known for ',
    "Can't open user config file ", `Can't open user config file ${CFG}: `, `${CFG}: line 1: Bad configuration option: `, 'no such identity: ', `no such identity: ${KEY}: `,
    'ssh: Could not resolve hostname ', 'ssh: connect to host nuance.local port 22: ', 'yu@nuance.local: Permission denied (',
    'Host key verification failed.', 'Connection timed out during banner exchange', '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @']
  /** ssh's own lines for a lost connection, as 9.9p2 prints them. */
  const LOSSES = ['Connection to nuance.local closed by remote host.', 'Timeout, server nuance.local not responding.', 'Connection closed by 192.168.50.3 port 22',
    'Connection reset by 192.168.50.3 port 22', 'banner exchange: Connection to 192.168.50.3 port 22: Broken pipe', 'client_loop: send disconnect: Broken pipe',
    'Read from remote host nuance.local: Connection reset by peer']
  test(`${HEADS.length} heads × ${LOSSES.length} loss lines: every join is unknown with the fixed detail, alone or after other remote lines`, () => {
    for (const head of HEADS) {
      for (const loss of LOSSES) {
        for (const text of [`${head}${loss}\r\n`, `${ZSHENV}\n${head}${loss}\r\n`, `${head}${loss}\r\nDisconnected from 192.168.50.3 port 22\r\n`]) {
          const r = map(text)
          expect([text, r.status, r.reason, r.detail === FIXED || r.detail === 'Disconnected from 192.168.50.3 port 22']).toEqual([text, 'unknown', undefined, true])
        }
      }
    }
  })
  test('end to end: a fake ssh that writes the kex head with no newline, then ssh\'s peer drop, reads unknown with the handle', () => {
    const stderr = 'kex_exchange_identification: Connection reset by 192.168.50.3 port 22\r\n'
    const { bin, dir } = fakeSsh(255, '', stderr)
    expect(sshCall({ sshBin: bin, sshConfig: join(dir, 'config'), target: NUANCE }, 'nuance', 'inventory')).toEqual({ status: 'unknown', detail: FIXED })
    const r = runCli(startArgv(dir), deps(bin, dir))
    const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
    expect(r).toEqual({ code: 1, out: { status: 'unknown', detail: FIXED, handle: `nuance/${sent.id}` } })
    expect(lines(join(dir, 'ledger.jsonl'))[1]).toMatchObject({ event: 'answer', status: 'unknown', detail: FIXED })
  })
  test('a remote `ssh: …` head joined to a loss is never the detail', () => {
    for (const head of ['ssh: connect to host github.com port 22: ', 'ssh: ', 'Read from remote host x: ', 'Connection to ', 'client_loop: send disconnect: ']) {
      for (const loss of LOSSES) expect([head, loss, map(`${head}${loss}\r\n`).detail]).toEqual([head, loss, FIXED])
    }
  })
})

describe('round 3: classifiers match the whole line 9.9p2 prints, start and end', () => {
  test('the kex failure is exactly its two captured lines, in order; anything else around a reset is a loss', () => {
    const KEXL = 'kex_exchange_identification: read: Connection reset by peer'
    const PEER = 'Connection reset by 192.168.50.3 port 22'
    expect(map(`${KEXL}\r\n${PEER}\r\n`)).toMatchObject({ status: 'unreachable', reason: 'timeout', detail: KEXL })
    for (const s of [`${KEXL}\r\n`, `${PEER}\r\n${KEXL}\r\n`, `${KEXL}\r\n${PEER}\r\nConnection to nuance.local closed by remote host.\r\n`,
      `${KEXL} x\r\n${PEER}\r\n`, `${KEXL}\r\n${PEER} x\r\n`, `kex_exchange_identification: Connection closed by remote host\r\n`, `kex_exchange_identification: read: Operation timed out\r\n`]) {
      expect([s, map(s).status]).toEqual([s, 'unknown'])
    }
  })
  test('each classifier\'s line with anything after it is not that line', () => {
    for (const s of ['Host key verification failed. x', 'Connection timed out during banner exchange x',
      'ssh: Could not resolve hostname nuance.local: nodename nor servname provided, or not known x', 'ssh: Could not resolve hostname nuance.local: x',
      'ssh: connect to host nuance.local port 22: Operation timed out x', 'yu@nuance.local: Permission denied (publickey). x',
      `no such identity: ${KEY}: No such file or directory x`, `no such identity: ${KEY}: Bogus`,
      `Can't open user config file ${CFG}: No such file or directory x`, `Can't open user config file ${CFG}: Bogus`, `${CFG}: line 3: Bad configuration option: a b`]) {
      expect([s, map(`${s}\r\n`).status]).toEqual([s, 'unknown'])
    }
  })
  test('the errno forms each class enumerates still classify', () => {
    for (const [s, want] of [
      [`no such identity: ${KEY}: Permission denied`, 'auth_refused'], [`no such identity: ${KEY}: Operation not permitted`, 'auth_refused'],
      [`Can't open user config file ${CFG}: Permission denied`, 'unreachable'], [`Can't open user config file ${CFG}: Operation not permitted`, 'unreachable'],
    ] as const) expect([s, map(`${s}\r\n`).status]).toEqual([s, want])
  })
  test('only the verify line decides a host key mismatch (both 9.9p2 host-key captures end in it)', () => {
    for (const s of ['@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @', 'No ED25519 host key is known for summon-nuance and you have requested strict checking.']) {
      expect([s, map(`${s}\r\n`).status]).toEqual([s, 'unknown'])
    }
  })
  test('a detail of an unknown is a closed, whole ssh line, or fixed text', () => {
    expect(map('Unable to negotiate with 192.168.50.3 port 22: no matching host key type found. Their offer: ssh-rsa,ssh-dss\r\n').detail)
      .toBe('Unable to negotiate with 192.168.50.3 port 22: no matching host key type found. Their offer: ssh-rsa,ssh-dss')
    for (const s of ['Received disconnect from 192.168.50.3 port 22:11: disconnected by user', 'ssh_dispatch_run_fatal: Connection to 192.168.50.3 port 22: message authentication code incorrect',
      'Unable to negotiate with 192.168.50.3 port 22: no matching cipher found. Their offer: Connection reset by 192.168.50.3 port 22']) {
      expect([s, map(`${s}\r\n`)]).toEqual([s, { status: 'unknown', detail: FIXED }])
    }
  })
})

describe('round 3: the fingerprint is shown only from ssh\'s exact changed-key block', () => {
  const VERIFY = 'Host key verification failed.\r\n'
  const BAR = '@'.repeat(59)
  const HEADER = `${BAR}\r\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\n${BAR}\r\n`
  const FP = `The fingerprint for the ED25519 key sent by the remote host is\n${FINGERPRINT}.\r\n`
  test('the real block gives the fingerprint', () => {
    expect(map(`${HEADER}${FP}${VERIFY}`).detail).toBe(`Host key verification failed. Presented ED25519 key: ${FINGERPRINT}`)
    expect(map(CHANGED_KEY).detail).toBe(`Host key verification failed. Presented ED25519 key: ${FINGERPRINT}`)
  })
  test('without the header, before it, with the inner line ended \\r\\n, with the lines apart, or a bad fingerprint: no fingerprint', () => {
    for (const s of [`${FP}${VERIFY}`, `${FP}${HEADER}${VERIFY}`, `${HEADER}${FP.replace('is\n', 'is\r\n')}${VERIFY}`,
      `${HEADER}The fingerprint for the ED25519 key sent by the remote host is\nPlease contact your system administrator.\r\n${FINGERPRINT}.\r\n${VERIFY}`,
      `${HEADER}${FP.replace(FINGERPRINT, 'SHA256:short')}${VERIFY}`, `${HEADER.replace('@    WARNING', '@ WARNING')}${FP}${VERIFY}`]) {
      expect([s, map(s)]).toEqual([s, { status: 'host_key_mismatch', detail: 'Host key verification failed.', hint: HOST_KEY_HINT }])
    }
  })
  test('a verify line that is not a clean CRLF line gives no host_key_mismatch at all', () => {
    for (const s of [`${HEADER}${FP}x: Host key verification failed.\r\n`, `${HEADER}${FP}Host key verification failed.\n`, `${HEADER}${FP}Host key verification failed.\r\r\n`]) {
      expect([s, map(s).status]).toEqual([s, 'unknown'])
    }
  })
})

describe('round 3: a line with a \\r before its final \\r\\n is not ssh\'s', () => {
  test('\\r\\r\\n and an inner \\r are not CRLF lines', () => {
    expect(map('ssh: connect to host nuance.local port 22: Operation timed out\r\n')).toMatchObject({ status: 'unreachable', reason: 'timeout' })
    for (const s of ['ssh: connect to host nuance.local port 22: Operation timed out\r\r\n', 'ssh: connect to host nuance.local port 22: Opera\rtion timed out\r\n',
      'yu@nuance.local: Permission denied (publickey).\r\r\n', 'Connection to 192.168.50.3 port 22 timed out\r\r\n']) {
      expect([s, map(s)]).toEqual([s, { status: 'unknown', detail: FIXED }])
    }
  })
})

// ── C review, round 4 ──

/** One line, as 9.9p2 prints it, for each loss the classifier knows; each matches only that loss where ssh's form allows. */
const LOSS_LINES = [
  'Read from remote host nuance.local: Operation timed out', // Read from remote host
  'Connection to nuance.local closed by remote host.', // Connection to … closed by remote host
  'Timeout, server nuance.local not responding.', // Timeout, server … not responding
  'client_loop: send disconnect: Operation timed out', // client_loop:
  'banner exchange: Connection to 192.168.50.3 port 22: Broken pipe', // Broken pipe
  'Connection reset by 192.168.50.3 port 22', // Connection reset
  'Connection closed by 192.168.50.3 port 22', // Connection closed by
  'packet_write_wait: Connection to 192.168.50.3 port 22: Operation timed out', // packet_write_wait
  'client_loop: ssh_packet_write_poll: Connection to 192.168.50.3 port 22: Operation timed out', // packet_write_poll (with client_loop:, as ssh prints it)
  'kex_exchange_identification: read: Connection reset by peer', // the kex line without its peer line after it
]
/** Every line form that classifies on its own against the paired nuance entry (and the kex pair), as ssh prints it. */
const NUANCE_CLASSIFYING = [
  'ssh: connect to host nuance.local port 22: Operation not permitted', `Can't open user config file ${CFG}: No such file or directory`,
  `${CFG}: line 3: Bad configuration option: bogus`, `no such identity: ${KEY}: No such file or directory`, 'yu@nuance.local: Permission denied (publickey).',
  'ssh: connect to host nuance.local port 22: No route to host', 'ssh: connect to host nuance.local port 22: Network is unreachable',
  'ssh: connect to host nuance.local port 22: Network is down', 'ssh: Could not resolve hostname nuance.local: nodename nor servname provided, or not known',
  'ssh: connect to host nuance.local port 22: Operation timed out', 'ssh: connect to host nuance.local port 22: Host is down',
  'ssh: connect to host nuance.local port 22: Connection refused', 'Connection timed out during banner exchange', 'Host key verification failed.',
  'kex_exchange_identification: read: Connection reset by peer\r\nConnection reset by 192.168.50.3 port 22',
].map((s) => `${s}\r\n`)

describe('round 4: a loss on the first line of stderr wins too', () => {
  /** The reviewer's repros: a loss on line 0, then a line that would classify on its own. [stderr, the detail of the unknown] */
  const REPROS: [string, string][] = [
    ['Connection closed by 192.168.50.3 port 22\r\nyu@nuance.local: Permission denied (publickey).\r\n', 'Connection closed by 192.168.50.3 port 22'],
    ['Connection reset by 192.168.50.3 port 22\r\nHost key verification failed.\r\n', 'Connection reset by 192.168.50.3 port 22'],
    ['Connection to nuance.local closed by remote host.\r\nssh: connect to host nuance.local port 22: Operation timed out\r\n', 'Connection to nuance.local closed by remote host.'],
    // The remote's own bare-\n line is the loss here: it decides, but is never shown.
    ['cat: stdout: Broken pipe\nssh: connect to host nuance.local port 22: Operation timed out\r\nDisconnected from 192.168.50.3 port 22\r\n', FIXED],
  ]
  test('the reviewer\'s four repros read unknown; without their first line the rest classifies', () => {
    for (const [stderr, detail] of REPROS) {
      expect([stderr, map(stderr)]).toEqual([stderr, { status: 'unknown', detail }])
      expect([stderr, map(stderr.slice(stderr.indexOf('\n') + 1)).status]).not.toEqual([stderr, 'unknown'])
    }
  })
  test('through runCli: each repro after a start is unknown with the handle of the request sent, and ssh ran once', () => {
    for (const [stderr, detail] of REPROS) {
      const { bin, dir } = fakeSsh(255, '', stderr)
      const r = runCli(startArgv(dir), deps(bin, dir))
      const sent = JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8'))
      expect([stderr, r]).toEqual([stderr, { code: 1, out: { status: 'unknown', detail, handle: `nuance/${sent.id}` } }])
      expect(lines(join(dir, 'ledger.jsonl'))[1]).toMatchObject({ event: 'answer', status: 'unknown', detail })
      expect(calls(dir)).toBe(1)
    }
  })
  test(`${LOSS_LINES.length} loss lines on line 0 (CRLF or bare), then every classifying line or capture: always unknown`, () => {
    const CAPTURES: [string, MapContext][] = [
      ['badconf', { config: 'cl/badconf' }], ['noconf', { config: 'cl/nope' }], ['changedkey', {}], ['unknownhost', {}],
      ['kex2-rst', {}], ['kex-hang', {}], ['wrongkey', {}], ['missingid', { target: { ...LOCAL_SSHD, identityFile: `${R}/missing` } }],
      ['permconf', { target: { host: '127.0.0.1' } }], ['summon-closed', { target: { host: '127.0.0.1' } }],
      ['summon-nuance', { target: { host: 'nonexistent-summon-review.invalid' } }],
    ]
    const units: [string, (s: string) => GateResponse][] = NUANCE_CLASSIFYING.map((s) => [s, (t: string) => map(t)])
    for (const [name, ctx] of CAPTURES) {
      const mapAs = (t: string) => mapSshFailure(t, { target: LOCAL_SSHD, env: {}, ...ctx })
      const raw = CAPTURE[name]!
      units.push([raw, mapAs]) // the whole capture
      for (const line of raw.split(/(?<=\r\n)/)) if (line !== raw && mapAs(line).status !== 'unknown') units.push([line, mapAs]) // each of its lines that classifies alone
    }
    expect(units.length).toBeGreaterThan(NUANCE_CLASSIFYING.length + CAPTURES.length)
    for (const [unit, m] of units) {
      expect([unit, m(unit).status]).not.toEqual([unit, 'unknown'])
      for (const loss of LOSS_LINES) {
        for (const end of ['\r\n', '\n']) {
          const r = m(`${loss}${end}${unit}`)
          expect([loss, end, unit, r.status, r.reason, r.detail === FIXED || r.detail === loss]).toEqual([loss, end, unit, 'unknown', undefined, true])
        }
      }
    }
  })
})

describe('round 4: a classifying line is ssh\'s line exactly, with only its final \\r\\n stripped', () => {
  const VARIANTS = (s: string) => [`${s}\t`, `${s} `, `${s}\u00a0`, `${s}\ufeff`, `\ufeff${s}`, `${s}\t `]
  test('the reviewer\'s variants of the verify line (a tab, a space, a no-break space, a BOM) read unknown', () => {
    expect(map('Host key verification failed.\r\n')).toMatchObject({ status: 'host_key_mismatch' })
    for (const v of VARIANTS('Host key verification failed.')) expect([v, map(`${v}\r\n`)]).toEqual([v, { status: 'unknown', detail: FIXED }])
  })
  test('every classifying line with whitespace or a BOM added at either end reads unknown', () => {
    for (const unit of NUANCE_CLASSIFYING) {
      const parts = unit.slice(0, -2).split('\r\n') // the kex pair is two lines: vary each in turn
      for (const v of parts.flatMap((l, i) => VARIANTS(l).map((x) => parts.with(i, x).join('\r\n')))) {
        expect([v, map(`${v}\r\n`).status]).toEqual([v, 'unknown'])
      }
    }
  })
  test('the fingerprint lines must be exact too (the verify line alone still decides)', () => {
    const plain: GateResponse = { status: 'host_key_mismatch', detail: 'Host key verification failed.', hint: HOST_KEY_HINT }
    expect(map(CHANGED_KEY.replace('remote host is\n', 'remote host is \n'))).toEqual(plain)
    expect(map(CHANGED_KEY.replace(`${FINGERPRINT}.\r\n`, `${FINGERPRINT}. \r\n`))).toEqual(plain)
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { gateCompiled, gateFromSource, makeFakeSsh } from './fake-ssh.ts'
import { cleanupTmps, PKG, temp, writeStub } from './helpers.ts'

afterEach(cleanupTmps)

const GIT = '/opt/homebrew/bin/git'
const NONCE = '0123456789abcdef0123456789abcdef'
/** Variables bash adds to its own environment, which a bash target therefore always prints. */
const BASH_OWN = ['PWD', 'SHLVL', '_']
/** writeStub's first line appends to $STUB_LOG, so every target here is handed the suite's stub log. */
const STUB_ENV = (): Record<string, string> => ({ STUB_LOG: process.env.STUB_LOG! })

/** Runs the fake ssh the way the hub runs its ssh: argv in; stdout bytes, stderr and the exit code out. */
async function runSsh(bin: string, args: string[], o: { stdin?: string; env?: Record<string, string> } = {}) {
  const p = Bun.spawn([bin, ...args], { stdin: new Blob([o.stdin ?? '']), stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, ...o.env } })
  const [out, err, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text(), p.exited])
  return { code, bytes: new Uint8Array(out), out: new TextDecoder().decode(out), err }
}

/** A target that prints what it was started with: its command (or <unset>), its cwd and its whole environment, sorted. */
function envTarget(): string[] {
  return [writeStub(temp('cb-target-'), 'target', [
    'printf "cmd=%s\\n" "${SSH_ORIGINAL_COMMAND-<unset>}"',
    'printf "cwd=%s\\n" "$(/bin/pwd -P)"',
    '/usr/bin/env | /usr/bin/sort',
    '',
  ].join('\n'))]
}

/** The `cmd=`, `cwd=` and environment lines of envTarget's output, bash's own variables left out. */
function parseEnvTarget(out: string): { cmd: string; cwd: string; env: Record<string, string> } {
  const lines = out.split('\n').filter(Boolean)
  const env: Record<string, string> = {}
  for (const l of lines.slice(2)) {
    const k = l.slice(0, l.indexOf('='))
    if (!BASH_OWN.includes(k)) env[k] = l.slice(l.indexOf('=') + 1)
  }
  return { cmd: lines[0]!.slice('cmd='.length), cwd: lines[1]!.slice('cwd='.length), env }
}

/** Reads a stream until `want` has arrived, failing after `ms`; returns everything read so far. */
async function readUntil(reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> }, want: string, ms: number): Promise<string> {
  const dec = new TextDecoder()
  const deadline = Date.now() + ms
  let text = ''
  while (!text.includes(want)) {
    const left = deadline - Date.now()
    if (left <= 0) throw new Error(`timed out waiting for ${JSON.stringify(want)}; got ${JSON.stringify(text)}`)
    const r = await Promise.race([reader.read(), Bun.sleep(left).then(() => null)])
    if (r === null) continue
    if (r.done) throw new Error(`stream ended before ${JSON.stringify(want)}; got ${JSON.stringify(text)}`)
    text += dec.decode(r.value, { stream: true })
  }
  return text
}

describe('fake ssh', () => {
  test('runs the target with SSH_ORIGINAL_COMMAND and a bare env', async () => {
    const nuance = temp('cb-nuance-')
    const ssh = makeFakeSsh({ nuanceHome: nuance, target: envTarget(), env: { ...STUB_ENV(), COLLAB_BRIDGE_BIN_GIT: GIT } })
    expect(ssh.bin).toBe(join(ssh.dir, 'ssh'))
    const r = await runSsh(ssh.bin, ['-F', '/x/config', 'collab-nuance', 'relay', '1', NONCE], { env: { SECRET_FROM_THE_AIR: 'x' } })
    expect([r.code, r.err]).toEqual([0, ''])
    const seen = parseEnvTarget(r.out)
    expect(seen.cmd).toBe(`relay 1 ${NONCE}`)
    expect(seen.cwd).toBe(nuance)
    // Nothing of the caller's environment (NODE_ENV, the preload's knobs, SECRET_FROM_THE_AIR) gets through.
    expect(seen.env).toEqual({
      PATH: '/usr/bin:/bin', HOME: nuance, COLLAB_BRIDGE_HOME_OVERRIDE: nuance,
      STUB_LOG: process.env.STUB_LOG!, COLLAB_BRIDGE_BIN_GIT: GIT, SSH_ORIGINAL_COMMAND: `relay 1 ${NONCE}`,
    })
  })

  test('a call with no remote command leaves SSH_ORIGINAL_COMMAND unset, as sshd does', async () => {
    const ssh = makeFakeSsh({ nuanceHome: temp('cb-nuance-'), target: envTarget(), env: STUB_ENV() })
    const r = await runSsh(ssh.bin, ['collab-nuance'])
    expect(r.code).toBe(0)
    const seen = parseEnvTarget(r.out)
    expect(seen.cmd).toBe('<unset>')
    expect('SSH_ORIGINAL_COMMAND' in seen.env).toBe(false)
  })

  test('passes stdin and stdout through unbuffered', async () => {
    const echo = writeStub(temp('cb-target-'), 'echo', 'while IFS= read -r line; do printf "echo:%s\\n" "$line"; done\nprintf "eof\\n"\n')
    const ssh = makeFakeSsh({ nuanceHome: temp('cb-nuance-'), target: [echo], env: STUB_ENV() })
    const p = Bun.spawn([ssh.bin, 'collab-nuance', 'relay', '1', NONCE], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: process.env })
    const reader = p.stdout.getReader()
    p.stdin.write('ping\n')
    p.stdin.flush()
    // The answer to the first line arrives while stdin is still open: nothing waits for EOF or a full buffer.
    let text = await readUntil(reader, 'echo:ping\n', 5000)
    p.stdin.write('bye\n')
    p.stdin.end()
    text += await readUntil(reader, 'eof\n', 5000)
    expect(text).toBe('echo:ping\necho:bye\neof\n')
    expect(await p.exited).toBe(0)
  }, 15_000)

  test('skips -F and -o options and records the absolute -F path', async () => {
    const cfg = join(temp('cb-air-'), 'config')
    const ssh = makeFakeSsh({ nuanceHome: temp('cb-nuance-'), target: envTarget(), env: STUB_ENV() })
    const first = ['-F', cfg, '-o', 'BatchMode=yes', '-o', 'SetEnv=A=b c', '-T', '-oServerAliveInterval=15', 'collab-nuance', 'hello']
    const r = await runSsh(ssh.bin, first)
    expect(r.code).toBe(0)
    expect(parseEnvTarget(r.out).cmd).toBe('hello')
    await runSsh(ssh.bin, ['-4', '-n', '-q', '-p', '22', '-i', '/k', '-l', 'macair', 'collab-nuance', 'relay', '1', NONCE])
    const calls = ssh.calls()
    expect(calls).toEqual([first, ['-4', '-n', '-q', '-p', '22', '-i', '/k', '-l', 'macair', 'collab-nuance', 'relay', '1', NONCE]])
    expect(isAbsolute(calls[0]![calls[0]!.indexOf('-F') + 1]!)).toBe(true)
  })

  test('an option it does not know, or an option without its value, exits 255 and never runs the target', async () => {
    const marker = join(temp('cb-out-'), 'ran')
    const target = writeStub(temp('cb-target-'), 'target', `: > '${marker}'\n`)
    const ssh = makeFakeSsh({ nuanceHome: temp('cb-nuance-'), target: [target], env: STUB_ENV() })
    const unknown = await runSsh(ssh.bin, ['-R', '9000:localhost:22', 'collab-nuance', 'hello'])
    expect([unknown.code, unknown.err]).toEqual([255, 'fake ssh: unknown option -R\n'])
    const dangling = await runSsh(ssh.bin, ['-F'])
    expect([dangling.code, dangling.err]).toEqual([255, 'fake ssh: option -F needs a value\n'])
    expect(existsSync(marker)).toBe(false)
  })

  test('prints noise first, then runs the target', async () => {
    const noise = new Uint8Array([0x7a, 0x73, 0x68, 0x0a, 0x00, 0xff, 0x0a]) // a zshenv line, a NUL and a byte that is not UTF-8
    const ssh = makeFakeSsh({ nuanceHome: temp('cb-nuance-'), target: envTarget(), env: STUB_ENV() })
    ssh.setNoise(noise)
    const r = await runSsh(ssh.bin, ['collab-nuance', 'hello'])
    expect(r.code).toBe(0)
    expect(r.bytes.slice(0, noise.length)).toEqual(noise)
    expect(parseEnvTarget(new TextDecoder().decode(r.bytes.slice(noise.length))).cmd).toBe('hello')
    ssh.setNoise('Last login: today\n')
    expect((await runSsh(ssh.bin, ['collab-nuance', 'hello'])).out.startsWith('Last login: today\ncmd=hello\n')).toBe(true)
    ssh.setNoise(null)
    expect((await runSsh(ssh.bin, ['collab-nuance', 'hello'])).out.startsWith('cmd=hello\n')).toBe(true)
  })

  test('exits 255 with the given stderr and never runs the target', async () => {
    const marker = join(temp('cb-out-'), 'ran')
    const target = writeStub(temp('cb-target-'), 'target', `: > '${marker}'\n`)
    const ssh = makeFakeSsh({ nuanceHome: temp('cb-nuance-'), target: [target], env: STUB_ENV() })
    const refusal = 'macair@nuance.local: Permission denied (publickey).\r\n'
    ssh.setFail255(refusal)
    const r = await runSsh(ssh.bin, ['-F', '/x/config', 'collab-nuance', 'relay', '1', NONCE])
    expect([r.code, r.out, r.err]).toEqual([255, '', refusal])
    expect(existsSync(marker)).toBe(false)
    // The hub's argv was still seen, as sshd's log would show the attempt.
    expect(ssh.calls()).toEqual([['-F', '/x/config', 'collab-nuance', 'relay', '1', NONCE]])
    ssh.setFail255(null)
    expect((await runSsh(ssh.bin, ['collab-nuance', 'hello'])).code).toBe(0)
    expect(existsSync(marker)).toBe(true)
  })

  test('noise, then a 255 loss: the noise on stdout, the stderr, exit 255', async () => {
    const ssh = makeFakeSsh({ nuanceHome: temp('cb-nuance-'), target: envTarget(), env: STUB_ENV() })
    ssh.setNoise('zshenv noise\n')
    ssh.setFail255('Connection to nuance.local closed by remote host.\r\n')
    const r = await runSsh(ssh.bin, ['collab-nuance', 'relay', '1', NONCE])
    expect([r.code, r.out, r.err]).toEqual([255, 'zshenv noise\n', 'Connection to nuance.local closed by remote host.\r\n'])
  })

  test('waits the set delay before anything, as a slow connect does', async () => {
    const ssh = makeFakeSsh({ nuanceHome: temp('cb-nuance-'), target: envTarget(), env: STUB_ENV() })
    ssh.setDelayMs(600)
    const t0 = performance.now()
    const r = await runSsh(ssh.bin, ['collab-nuance', 'hello'])
    expect(performance.now() - t0).toBeGreaterThanOrEqual(580)
    expect(parseEnvTarget(r.out).cmd).toBe('hello')
    ssh.setDelayMs(0)
    const t1 = performance.now()
    await runSsh(ssh.bin, ['collab-nuance', 'hello'])
    expect(performance.now() - t1).toBeLessThan(580)
  })

  test('forwards GIT_PROTOCOL only when asked, as an sshd with AcceptEnv GIT_PROTOCOL would', async () => {
    const ssh = makeFakeSsh({ nuanceHome: temp('cb-nuance-'), target: envTarget(), env: STUB_ENV() })
    const off = await runSsh(ssh.bin, ['-o', 'SendEnv=GIT_PROTOCOL', 'collab-nuance', 'hello'], { env: { GIT_PROTOCOL: 'version=2' } })
    expect('GIT_PROTOCOL' in parseEnvTarget(off.out).env).toBe(false)
    ssh.setPassGitProtocol(true)
    const on = await runSsh(ssh.bin, ['-o', 'SendEnv=GIT_PROTOCOL', 'collab-nuance', 'hello'], { env: { GIT_PROTOCOL: 'version=2' } })
    expect(parseEnvTarget(on.out).env.GIT_PROTOCOL).toBe('version=2')
    ssh.setPassGitProtocol(false)
    const again = await runSsh(ssh.bin, ['collab-nuance', 'hello'], { env: { GIT_PROTOCOL: 'version=2' } })
    expect('GIT_PROTOCOL' in parseEnvTarget(again.out).env).toBe(false)
  })

  test("git fetch through GIT_SSH_COMMAND reaches the target as git-upload-pack '<path>'", () => {
    const nuance = temp('cb-nuance-')
    const remote = join(nuance, 'Projects', 'collab-trial', '.git')
    mkdirSync(remote, { recursive: true })
    const seen = join(temp('cb-out-'), 'command')
    const target = writeStub(temp('cb-target-'), 'target', `printf '%s' "$SSH_ORIGINAL_COMMAND" > '${seen}'\nexit 128\n`)
    const ssh = makeFakeSsh({ nuanceHome: nuance, target: [target], env: STUB_ENV() })
    const cfg = join(temp('cb-air-'), 'config')
    const env = {
      PATH: '/usr/bin:/bin', HOME: temp('cb-githome-'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: `'${ssh.bin}' -F '${cfg}'`, STUB_LOG: process.env.STUB_LOG!,
    }
    const repo = temp('cb-repo-')
    expect(Bun.spawnSync([GIT, 'init', '-q', repo], { env }).exitCode).toBe(0)
    const f = Bun.spawnSync([GIT, '-C', repo, 'fetch', `collab-nuance:${remote}`, 'HEAD'], { env, stdout: 'pipe', stderr: 'pipe' })
    expect(f.exitCode).not.toBe(0)
    expect(readFileSync(seen, 'utf8')).toBe(`git-upload-pack '${remote}'`)
    const [call] = ssh.calls()
    // git names the fake as OpenSSH (it is called ssh), so it passes the -F it was given and asks to send GIT_PROTOCOL.
    expect(call!.slice(0, 2)).toEqual(['-F', cfg])
    expect(call).toContain('SendEnv=GIT_PROTOCOL')
    expect(call!.slice(-2)).toEqual(['collab-nuance', `git-upload-pack '${remote}'`])
  })

  test('gateFromSource and gateCompiled name the gate the way sshd would run it', () => {
    expect(gateFromSource()).toEqual([process.execPath, '--no-env-file', '--config=/dev/null', `${PKG}/src/nuance/main.ts`, 'gate'])
    expect(gateCompiled('/x/collab-bridge')).toEqual(['/x/collab-bridge', 'gate'])
  })

  test('refuses a relative home, an empty target and an env key it owns', () => {
    const home = temp('cb-nuance-')
    expect(() => makeFakeSsh({ nuanceHome: 'Users/macair', target: envTarget() })).toThrow('nuanceHome must be absolute')
    expect(() => makeFakeSsh({ nuanceHome: home, target: [] })).toThrow('target is empty')
    expect(() => makeFakeSsh({ nuanceHome: home, target: envTarget(), env: { SSH_ORIGINAL_COMMAND: 'ls' } })).toThrow('SSH_ORIGINAL_COMMAND')
    expect(() => makeFakeSsh({ nuanceHome: home, target: envTarget(), env: { 'A B': '1' } })).toThrow('A B')
  })
})

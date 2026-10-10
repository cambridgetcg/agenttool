import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { buildNuance, type NuanceBuild } from '../scripts/build-nuance.ts'
import { writeSshConfig } from '../scripts/pin-nuance.ts'
import { prepareBundle, renderInstaller } from '../scripts/prepare-pairing.ts'
import { cleanupTmps, trackTmp } from './helpers.ts'

afterEach(cleanupTmps)

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
const mode = (p: string) => statSync(p).mode & 0o777
const temp = (prefix: string) => trackTmp(mkdtempSync(join(tmpdir(), prefix)))
const PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey summon-air'
const TMPL = readFileSync(join(import.meta.dir, '..', 'nuance', 'install.sh.tmpl'), 'utf8')
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

describe('renderInstaller', () => {
  const good = { pubkey: PUB, expiry: '20270110', shaGatekeeper: SHA_A, shaRunner: SHA_B }
  test('fills every placeholder', () => {
    const s = renderInstaller(TMPL, good)
    expect(s).toContain(`PUBKEY='${PUB}'`)
    expect(s).toContain("EXPIRY='20270110'")
    expect(s).toContain(`SHA_GATEKEEPER='${SHA_A}'`)
    expect(s).toContain(`SHA_RUNNER='${SHA_B}'`)
    expect(s).not.toMatch(/__[A-Z_]+__/)
  })
  test('refuses values that could change the script', () => {
    expect(() => renderInstaller(TMPL, { ...good, pubkey: "ssh-ed25519 AAAA summon-air'; rm -rf ~; '" })).toThrow('unexpected public key format')
    expect(() => renderInstaller(TMPL, { ...good, pubkey: 'ssh-rsa AAAA summon-air' })).toThrow('unexpected public key format')
    expect(() => renderInstaller(TMPL, { ...good, pubkey: 'ssh-ed25519 AAAA yu@laptop' })).toThrow('unexpected public key format')
    expect(() => renderInstaller(TMPL, { ...good, expiry: '2027-01-10' })).toThrow('bad template values')
    expect(() => renderInstaller(TMPL, { ...good, shaGatekeeper: 'abc' })).toThrow('bad template values')
    expect(() => renderInstaller(TMPL, { ...good, shaRunner: SHA_B.toUpperCase() })).toThrow('bad template values')
  })
  test('the drop-in is 010 (sorts before macOS 100), mode 600, and sshd is never reloaded', () => {
    const s = renderInstaller(TMPL, good)
    expect(s).toContain('DROPIN="$CONFD/010-summon.conf"')
    expect(s).toContain('sudo install -m 600 -o root -g wheel "$TMP" "$DROPIN"')
    expect(s).not.toContain('100-summon')
    expect(s).not.toMatch(/com\.openssh|kill -HUP|systemsetup/)
    expect(s).not.toContain('AbandonProcessGroup')
  })
})

function bundle(root: string = temp('summon-root-')): { dir: string; root: string } {
  const dir = temp('summon-bundle-')
  for (const b of ['summon-gatekeeper', 'summon-runner']) { writeFileSync(join(dir, b), '#!/bin/sh\necho ' + b + '\n'); chmodSync(join(dir, b), 0o755) }
  writeFileSync(join(dir, 'summon-install.sh'), renderInstaller(TMPL, { pubkey: PUB, expiry: '20270110',
    shaGatekeeper: sha(join(dir, 'summon-gatekeeper')), shaRunner: sha(join(dir, 'summon-runner')) }))
  return { dir, root }
}
const envFor = (root: string, extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: BASE_PATH, HOME: root, SUMMON_INSTALL_ROOT: root, SUMMON_SKIP_SUDO: '1', SUMMON_SKIP_LAUNCHCTL: '1', SUMMON_SKIP_INVENTORY: '1', ...extra,
})
const run = (dir: string, root: string, extra: Record<string, string> = {}) =>
  Bun.spawnSync(['bash', join(dir, 'summon-install.sh')], { env: envFor(root, extra) })

/** Stand-ins for the commands that would touch this Mac: they record their arguments and run nothing. */
function stubs(scripts: Record<string, string>): { path: string; log: string; env: Record<string, string> } {
  const dir = temp('summon-stubs-')
  for (const [name, body] of Object.entries(scripts)) {
    const p = join(dir, name)
    writeFileSync(p, `#!/bin/bash\n${body}\n`); chmodSync(p, 0o755)
    // A stub that is not executable would let bash fall through to the real command.
    expect(mode(p) & 0o111).not.toBe(0)
  }
  const log = join(dir, 'calls.log')
  writeFileSync(log, '')
  const env = { STUB_LOG: log, STUB_FAIL_SSHD: join(dir, 'fail-sshd'), STUB_FAIL_SSHD_T: join(dir, 'fail-sshd-T'), STUB_SSHD_T: join(dir, 'sshd-T.out') }
  writeFileSync(env.STUB_SSHD_T, sshdT())
  return { path: `${dir}:${BASE_PATH}`, log, env }
}
/** What `sshd -T` prints: lowercase keywords, one line each. `over` replaces a value, or drops the keyword with null. */
function sshdT(over: Record<string, string | null> = {}): string {
  const base: Record<string, string> = { port: '22', permitrootlogin: 'no', pubkeyauthentication: 'yes', passwordauthentication: 'no',
    kbdinteractiveauthentication: 'no', allowusers: userInfo().username, x11forwarding: 'no' }
  return Object.entries({ ...base, ...over }).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v}`).join('\n') + '\n'
}
const SUDO_STUB = `echo "sudo $*" >> "$STUB_LOG"
if [ "$1" = install ]; then cat "$8" > "$STUB_LOG.dropin"; fi
if [ "$1" = /usr/sbin/sshd ] && [ "$2" = -t ] && [ -e "$STUB_FAIL_SSHD" ]; then exit 1; fi
if [ "$1" = /usr/sbin/sshd ] && [ "$2" = -T ]; then
  if [ -e "$STUB_FAIL_SSHD_T" ]; then exit 1; fi
  cat "$STUB_SSHD_T"
fi
exit 0`
const LAUNCHCTL_STUB = 'echo "launchctl $*" >> "$STUB_LOG"; exit 0'
const WITH_SUDO = { SUMMON_SKIP_SUDO: '0', SUMMON_SKIP_LAUNCHCTL: '0' }
const calls = (s: { log: string }) => readFileSync(s.log, 'utf8').trim().split('\n').filter(Boolean)
const PLIST = (root: string) => join(root, 'Library/LaunchAgents/dev.summon.runner.plist')

describe('installer', () => {
  test('installs with private modes and one restricted key line', () => {
    const { dir, root } = bundle()
    const r = run(dir, root)
    expect(r.exitCode).toBe(0)
    expect(mode(join(root, '.local/share/summon'))).toBe(0o700)
    expect(mode(join(root, '.local/share/summon/summon-gatekeeper'))).toBe(0o700)
    expect(mode(join(root, '.local/share/summon/summon-runner'))).toBe(0o700)
    const ak = readFileSync(join(root, '.ssh/authorized_keys'), 'utf8')
    expect(ak).toBe(`restrict,from="192.168.50.0/24",expiry-time="20270110",command="${root}/.local/share/summon/summon-gatekeeper" ${PUB}\n`)
    expect(readFileSync(join(root, '.config/summon/allowlist.yaml'), 'utf8')).toContain('path: ~/Projects')
    expect(readFileSync(join(root, 'Library/LaunchAgents/dev.summon.runner.plist'), 'utf8')).toContain('<key>QueueDirectories</key>')
  })

  test('every directory it makes is 0700 and every file 0600; the plist and runner.log too', () => {
    const { dir, root } = bundle()
    expect(run(dir, root).exitCode).toBe(0)
    for (const d of ['.local/share/summon', '.local/state/summon', '.local/state/summon/spool', '.local/state/summon/jobs',
      '.local/state/summon/seen', '.config/summon', '.ssh']) expect([d, mode(join(root, d)).toString(8)]).toEqual([d, '700'])
    for (const f of ['.ssh/authorized_keys', '.config/summon/allowlist.yaml', '.local/state/summon/runner.log',
      'Library/LaunchAgents/dev.summon.runner.plist']) expect([f, mode(join(root, f)).toString(8)]).toEqual([f, '600'])
  })

  test('the LaunchAgent is a valid plist that leaves process-group cleanup to launchd', () => {
    const { dir, root } = bundle()
    expect(run(dir, root).exitCode).toBe(0)
    const plist = join(root, 'Library/LaunchAgents/dev.summon.runner.plist')
    expect(Bun.spawnSync(['/usr/bin/plutil', '-lint', plist]).exitCode).toBe(0)
    const text = readFileSync(plist, 'utf8')
    expect(text).not.toContain('AbandonProcessGroup')
    for (const k of ['Label', 'ProgramArguments', 'QueueDirectories', 'RunAtLoad', 'ThrottleInterval', 'StandardOutPath', 'StandardErrorPath']) expect(text).toContain(`<key>${k}</key>`)
    expect(text).toContain(`<string>${root}/.local/share/summon/summon-runner</string>`)
    expect(text).toContain(`<string>${root}/.local/state/summon/spool</string>`)
    expect(text).toContain(`<string>${root}/.local/state/summon/runner.log</string>`)
  })

  test('is idempotent, keeps other keys, an edited allowlist and the runner log', () => {
    const { dir, root } = bundle()
    run(dir, root)
    writeFileSync(join(root, '.ssh/authorized_keys'), 'ssh-ed25519 OTHER yu-laptop\n' + readFileSync(join(root, '.ssh/authorized_keys'), 'utf8'))
    writeFileSync(join(root, '.config/summon/allowlist.yaml'), 'version: 1 # edited\n')
    writeFileSync(join(root, '.local/state/summon/runner.log'), 'earlier output\n')
    expect(run(dir, root).exitCode).toBe(0)
    const lines = readFileSync(join(root, '.ssh/authorized_keys'), 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(lines[0]).toBe('ssh-ed25519 OTHER yu-laptop')
    expect(readFileSync(join(root, '.config/summon/allowlist.yaml'), 'utf8')).toBe('version: 1 # edited\n')
    expect(readFileSync(join(root, '.local/state/summon/runner.log'), 'utf8')).toBe('earlier output\n')
    expect(mode(join(root, '.local/state/summon/runner.log'))).toBe(0o600)
  })

  test('refuses a tampered binary before it writes anything', () => {
    const { dir, root } = bundle()
    writeFileSync(join(dir, 'summon-runner'), 'tampered')
    const r = run(dir, root)
    expect(r.exitCode).not.toBe(0)
    expect(r.stdout.toString()).toContain('checksum mismatch')
    expect(readdirSync(root)).toEqual([])
  })

  test('refuses an install folder whose path cannot sit safely in the key line', () => {
    const { dir, root } = bundle(temp('summon root '))
    const r = run(dir, root)
    expect(r.exitCode).not.toBe(0)
    expect(r.stdout.toString()).toContain('cannot go safely into the SSH key line')
    expect(readdirSync(root)).toEqual([])
  })

  test('fails closed when authorized_keys cannot be read: other keys survive', () => {
    const { dir, root } = bundle()
    mkdirSync(join(root, '.ssh'), { mode: 0o700 })
    writeFileSync(join(root, '.ssh/authorized_keys'), 'ssh-ed25519 OTHER yu-laptop\n', { mode: 0o600 })
    const s = stubs({ grep: 'exit 2' })
    const r = run(dir, root, { PATH: s.path })
    expect(r.exitCode).not.toBe(0)
    expect(readFileSync(join(root, '.ssh/authorized_keys'), 'utf8')).toBe('ssh-ed25519 OTHER yu-laptop\n')
    expect(existsSync(join(root, '.ssh/authorized_keys.summon-tmp'))).toBe(false)
  })

  test('with sudo and launchctl stubbed: the drop-in is 010, mode 600, validated, checked with sshd -T, never reloaded; the runner is bootstrapped', () => {
    const { dir, root } = bundle()
    const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
    const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
    expect(r.exitCode).toBe(0)
    expect(r.stdout.toString()).toContain('✓ SSH: key logins only')
    const c = calls(s)
    expect(c[0]).toMatch(/^sudo install -m 600 -o root -g wheel \S+ \/etc\/ssh\/sshd_config\.d\/010-summon\.conf$/)
    expect(c[1]).toBe('sudo /usr/sbin/sshd -t')
    expect(c[2]).toBe(`sudo /usr/sbin/sshd -T -C user=${userInfo().username},host=summon-lan,addr=192.168.50.2`)
    expect(c[3]).toBe(`launchctl bootout gui/${userInfo().uid}/dev.summon.runner`)
    expect(c[4]).toBe(`launchctl bootstrap gui/${userInfo().uid} ${PLIST(root)}`)
    expect(c.length).toBe(5)
    expect(readFileSync(`${s.log}.dropin`, 'utf8')).toBe(
      `PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\nAllowUsers ${userInfo().username}\n`)
    expect(readFileSync(join(root, '.ssh/authorized_keys'), 'utf8')).toContain(PUB)
  })

  test('matches the sshd -T keyword in any case but the value exactly', () => {
    const { dir, root } = bundle()
    const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
    writeFileSync(s.env.STUB_SSHD_T, sshdT().replace('passwordauthentication', 'PasswordAuthentication').replace('allowusers', 'AllowUsers'))
    expect(run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO }).exitCode).toBe(0)
  })

  test('when sshd -t rejects the drop-in the installer removes it and stops before the key line and the runner', () => {
    const { dir, root } = bundle()
    const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
    writeFileSync(s.env.STUB_FAIL_SSHD!, '')
    const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
    expect(r.exitCode).not.toBe(0)
    expect(r.stdout.toString()).toContain('sshd rejected the change')
    expect(calls(s).slice(1)).toEqual(['sudo /usr/sbin/sshd -t', 'sudo rm -f /etc/ssh/sshd_config.d/010-summon.conf'])
    expect(existsSync(join(root, '.ssh/authorized_keys'))).toBe(false)
    expect(existsSync(PLIST(root))).toBe(false)
  })

  describe('"key logins only" is what sshd -T says, not what the drop-in says', () => {
    const user = userInfo().username
    const notOff: Record<string, string> = {
      'password logins still on': sshdT({ passwordauthentication: 'yes' }),
      'keyboard-interactive still on': sshdT({ kbdinteractiveauthentication: 'yes' }),
      'root login not off': sshdT({ permitrootlogin: 'prohibit-password' }),
      'another user allowed': sshdT({ allowusers: `${user} other` }),
      'a different user only': sshdT({ allowusers: 'other' }),
      'allowusers missing': sshdT({ allowusers: null }),
      'passwordauthentication missing': sshdT({ passwordauthentication: null }),
      'value spelled differently': sshdT({ passwordauthentication: 'No' }),
      'two conflicting lines': sshdT() + 'passwordauthentication yes\n',
      'empty output': '',
    }
    for (const [name, out] of Object.entries(notOff)) {
      test(`stops before the key line and the runner: ${name}`, () => {
        const { dir, root } = bundle()
        const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
        writeFileSync(s.env.STUB_SSHD_T, out)
        const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
        expect(r.exitCode).not.toBe(0)
        const said = r.stdout.toString()
        expect(said).toContain('NOT switched off')
        expect(said).not.toContain('✓ SSH')
        expect(calls(s).some((l) => l.startsWith('launchctl'))).toBe(false)
        expect(existsSync(PLIST(root))).toBe(false)
        expect(existsSync(join(root, '.ssh/authorized_keys'))).toBe(false)
      })
    }

    test('names the setting that is wrong, with sshd -T asked for a LAN login by this user', () => {
      const { dir, root } = bundle()
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
      writeFileSync(s.env.STUB_SSHD_T, sshdT({ passwordauthentication: 'yes' }))
      const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
      expect(r.stdout.toString()).toContain("sshd would use 'passwordauthentication yes', Summon needs 'passwordauthentication no'")
      expect(calls(s)).toEqual([expect.stringMatching(/^sudo install /), 'sudo /usr/sbin/sshd -t',
        `sudo /usr/sbin/sshd -T -C user=${user},host=summon-lan,addr=192.168.50.2`])
    })

    test('stops when sshd -T itself fails: nothing is confirmed', () => {
      const { dir, root } = bundle()
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
      writeFileSync(s.env.STUB_FAIL_SSHD_T!, '')
      const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
      expect(r.exitCode).not.toBe(0)
      expect(r.stdout.toString()).toContain('NOT confirmed off')
      expect(calls(s).some((l) => l.startsWith('launchctl'))).toBe(false)
      expect(existsSync(join(root, '.ssh/authorized_keys'))).toBe(false)
    })
  })

  describe('with the real /usr/sbin/sshd -T on temp configs (no sudo, no /etc)', () => {
    // sudo is stubbed so that `install` drops the installer's real drop-in into a temp sshd_config.d, and `sshd -t/-T` run the
    // real sshd against a temp config that Includes that folder. So the verdict is sshd's own, for the file the installer wrote.
    const REAL_SSHD_SUDO = `echo "sudo $*" >> "$STUB_LOG"
case "$1" in
  install) cp "$8" "$STUB_CONFD/010-summon.conf" ;;
  /usr/sbin/sshd) cmd="$2"; shift 2; exec /usr/sbin/sshd "$cmd" -f "$STUB_SSHD_CONFIG" -h "$STUB_HOSTKEY" "$@" ;;
esac
exit 0`
    function realSshd(config: (confd: string) => string, earlier?: string) {
      const base = temp('summon-sshd-')
      const confd = join(base, 'sshd_config.d'); mkdirSync(confd)
      if (earlier) writeFileSync(join(confd, '000-other.conf'), earlier)
      const hostkey = join(base, 'host_key')
      expect(Bun.spawnSync(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', hostkey]).exitCode).toBe(0)
      writeFileSync(join(base, 'sshd_config'), config(confd))
      return { STUB_CONFD: confd, STUB_SSHD_CONFIG: join(base, 'sshd_config'), STUB_HOSTKEY: hostkey }
    }
    const attempt = (config: (confd: string) => string, earlier?: string) => {
      const { dir, root } = bundle()
      const s = stubs({ sudo: REAL_SSHD_SUDO, launchctl: LAUNCHCTL_STUB })
      const r = run(dir, root, { ...s.env, ...realSshd(config, earlier), PATH: s.path, ...WITH_SUDO })
      return { r, s, root, said: r.stdout.toString() }
    }

    test('an Include read first: accepted, the runner is loaded', () => {
      const a = attempt((d) => `Include ${d}/*\n`)
      expect(a.r.exitCode).toBe(0)
      expect(a.said).toContain('✓ SSH: key logins only')
      expect(existsSync(PLIST(a.root))).toBe(true)
      expect(calls(a.s).filter((l) => l.startsWith('launchctl')).length).toBe(2)
    })
    for (const [name, config, earlier] of [
      ['PasswordAuthentication yes before the Include (the first value wins)', (d: string) => `PasswordAuthentication yes\nInclude ${d}/*\n`, undefined],
      ['an earlier-sorting drop-in with PasswordAuthentication yes', (d: string) => `Include ${d}/*\n`, 'PasswordAuthentication yes\n'],
      ['a Match block for the LAN that turns passwords back on', (d: string) => `Include ${d}/*\nMatch Address 192.168.50.0/24\n  PasswordAuthentication yes\n`, undefined],
      ['no Include at all', () => 'Port 22\n', undefined],
    ] as const) {
      test(`refused, with no key line and no runner: ${name}`, () => {
        const a = attempt(config, earlier)
        expect(a.r.exitCode).not.toBe(0)
        expect(a.said).toContain('NOT switched off')
        expect(a.said).not.toContain('✓ SSH')
        expect(existsSync(PLIST(a.root))).toBe(false)
        expect(existsSync(join(a.root, '.ssh/authorized_keys'))).toBe(false)
        expect(calls(a.s).some((l) => l.startsWith('launchctl'))).toBe(false)
      })
    }
  })

  test('asks the runner for an inventory by spooling a request, and prints a fresh answer, not a stale one', async () => {
    const { dir, root } = bundle()
    const state = join(root, '.local/state/summon')
    mkdirSync(state, { recursive: true, mode: 0o700 })
    writeFileSync(join(state, 'inventory.json'), '{"macos":"stale"}')
    const p = Bun.spawn(['bash', join(dir, 'summon-install.sh')], { env: envFor(root, { SUMMON_SKIP_INVENTORY: '0' }), stdout: 'pipe', stderr: 'pipe' })
    const spool = join(state, 'spool')
    let req: string | undefined
    for (const deadline = Date.now() + 15_000; !req && Date.now() < deadline; await Bun.sleep(20)) {
      req = existsSync(spool) ? readdirSync(spool).find((n) => /^inventory-\d+\.req$/.test(n)) : undefined
    }
    expect(req).toBeDefined()
    expect(mode(join(spool, req!))).toBe(0o600)
    writeFileSync(join(state, 'inventory.json'), '{"macos":"fresh"}')
    const out = await new Response(p.stdout).text()
    expect(await p.exited).toBe(0)
    expect(out).toContain('user: ' + userInfo().username)
    expect(out).toContain('inventory: {"macos":"fresh"}')
    expect(out).not.toContain('stale')
  }, 30_000)
})

/** Stands in for the compile: two small files and their real digests. */
function fakeBuild(outDir: string) {
  mkdirSync(outDir, { recursive: true })
  const gatekeeper = join(outDir, 'summon-gatekeeper'); const runner = join(outDir, 'summon-runner')
  writeFileSync(gatekeeper, '#!/bin/sh\necho gatekeeper\n'); writeFileSync(runner, '#!/bin/sh\necho runner\n')
  return { gatekeeper, runner, sha: { gatekeeper: sha(gatekeeper), runner: sha(runner) } }
}

describe('prepareBundle (the Air side)', () => {
  test('makes a private bundle, and its installer installs', () => {
    const home = temp('summon-air-')
    const r = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-')), now: Date.UTC(2026, 9, 10) })
    const bundleDir = join(home, 'summon-nuance-bundle')
    expect(r.bundle).toBe(bundleDir)
    expect(r.expiry).toBe('20270108')
    expect(readdirSync(bundleDir).sort()).toEqual(['MANIFEST.txt', 'summon-gatekeeper', 'summon-install.sh', 'summon-runner'])
    expect(mode(bundleDir)).toBe(0o700)
    expect(mode(join(home, '.ssh/summon'))).toBe(0o700)
    expect(mode(join(home, '.ssh/summon/summon_nuance_ed25519'))).toBe(0o600)
    expect(mode(join(home, '.ssh/summon/summon_nuance_ed25519.pub'))).toBe(0o600)
    for (const f of ['summon-install.sh', 'MANIFEST.txt']) expect([f, mode(join(bundleDir, f)).toString(8)]).toEqual([f, '600'])
    for (const f of ['summon-gatekeeper', 'summon-runner']) expect([f, mode(join(bundleDir, f)).toString(8)]).toEqual([f, '700'])
    const built = fakeBuild(temp('summon-ref-'))
    expect(readFileSync(join(bundleDir, 'MANIFEST.txt'), 'utf8')).toBe(
      `summon-gatekeeper ${built.sha.gatekeeper}\nsummon-runner ${built.sha.runner}\nkey summon-air expires 20270108\n`)
    // The bundle it made installs on a stand-in Nuance, with the real key it generated.
    const root = temp('summon-root-')
    expect(run(bundleDir, root).exitCode).toBe(0)
    const pub = readFileSync(join(home, '.ssh/summon/summon_nuance_ed25519.pub'), 'utf8').trim()
    expect(pub).toMatch(/^ssh-ed25519 \S+ summon-air$/)
    expect(readFileSync(join(root, '.ssh/authorized_keys'), 'utf8')).toBe(
      `restrict,from="192.168.50.0/24",expiry-time="20270108",command="${root}/.local/share/summon/summon-gatekeeper" ${pub}\n`)
  })

  test('keeps an existing key, and tightens a bundle folder that already exists with looser modes', () => {
    const home = temp('summon-air-')
    const first = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-')) })
    const bundleDir = join(home, 'summon-nuance-bundle')
    chmodSync(bundleDir, 0o755); chmodSync(join(bundleDir, 'summon-install.sh'), 0o644)
    const again = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-')) })
    expect(again.pubkey).toBe(first.pubkey)
    expect(mode(bundleDir)).toBe(0o700)
    expect(mode(join(bundleDir, 'summon-install.sh'))).toBe(0o600)
  })
})

describe('writeSshConfig (pinning Nuance on the Air)', () => {
  const HK = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyExample root@Nuance'
  const dirIn = () => join(temp('summon-ssh-'), 'summon')

  test('writes the pinned known_hosts line and the exact config, privately', () => {
    const dir = dirIn()
    writeSshConfig(dir, 'yu', HK)
    expect(readFileSync(join(dir, 'known_hosts'), 'utf8')).toBe('summon-nuance ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyExample\n')
    expect(readFileSync(join(dir, 'config'), 'utf8')).toBe([
      'Host summon-nuance', '  HostName nuance.local', '  AddressFamily inet', '  User yu',
      `  IdentityFile ${dir}/summon_nuance_ed25519`, '  IdentitiesOnly yes', '  HostKeyAlias summon-nuance',
      `  UserKnownHostsFile ${dir}/known_hosts`, '  StrictHostKeyChecking yes', '  BatchMode yes', '  ConnectTimeout 8',
      '  ServerAliveInterval 15', '  ServerAliveCountMax 2', '  RequestTTY no', '  ForwardAgent no', '  ClearAllForwardings yes', '',
    ].join('\n'))
    expect(mode(dir)).toBe(0o700)
    expect(mode(join(dir, 'known_hosts'))).toBe(0o600)
    expect(mode(join(dir, 'config'))).toBe(0o600)
  })

  test('ssh itself reads it as intended', () => {
    const dir = dirIn()
    writeSshConfig(dir, 'yu', HK)
    const r = Bun.spawnSync(['/usr/bin/ssh', '-G', '-F', join(dir, 'config'), 'summon-nuance'])
    expect(r.exitCode).toBe(0)
    const got = new Map(r.stdout.toString().split('\n').map((l) => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)] as const))
    expect(got.get('hostname')).toBe('nuance.local')
    expect(got.get('user')).toBe('yu')
    expect(got.get('addressfamily')).toBe('inet')
    expect(got.get('identitiesonly')).toBe('yes')
    expect(got.get('batchmode')).toBe('yes')
    expect(got.get('stricthostkeychecking')).toBe('true')
    expect(got.get('hostkeyalias')).toBe('summon-nuance')
    expect(got.get('userknownhostsfile')).toBe(`${dir}/known_hosts`)
    expect(got.get('identityfile')).toBe(`${dir}/summon_nuance_ed25519`)
    expect(got.get('connecttimeout')).toBe('8')
    expect(got.get('serveraliveinterval')).toBe('15')
  })

  test('pinning again replaces the key and tightens looser modes', () => {
    const dir = dirIn()
    writeSshConfig(dir, 'yu', HK)
    chmodSync(dir, 0o755); chmodSync(join(dir, 'known_hosts'), 0o644); chmodSync(join(dir, 'config'), 0o644)
    writeSshConfig(dir, 'yu2', 'ssh-ed25519 AAAANEWKEY')
    expect(readFileSync(join(dir, 'known_hosts'), 'utf8')).toBe('summon-nuance ssh-ed25519 AAAANEWKEY\n')
    expect(readFileSync(join(dir, 'config'), 'utf8')).toContain('  User yu2\n')
    expect([mode(dir), mode(join(dir, 'known_hosts')), mode(join(dir, 'config'))]).toEqual([0o700, 0o600, 0o600])
  })

  test('rejects a bad user name and writes nothing', () => {
    for (const user of ['', 'yu name', 'yu;rm', '-oProxyCommand=x', 'yu\n', 'a'.repeat(33), 'yu\nProxyCommand evil']) {
      const dir = dirIn()
      expect(() => writeSshConfig(dir, user, HK)).toThrow('bad user name')
      expect(existsSync(dir)).toBe(false)
    }
  })

  test('rejects anything but a single ssh-ed25519 host key line and writes nothing', () => {
    for (const key of ['', 'ssh-ed25519', 'ssh-rsa AAAAB3NzaC1yc2E root@Nuance', 'ecdsa-sha2-nistp256 AAAAE2VjZHNh', 'ssh-ed25519 AA$A',
      'ssh-ed25519 AAAA\nProxyCommand evil', 'ssh-ed25519AAAA']) {
      const dir = dirIn()
      expect(() => writeSshConfig(dir, 'yu', key)).toThrow('ssh-ed25519 host key line')
      expect(existsSync(dir)).toBe(false)
    }
  })
})

describe('the real build', () => {
  // Compiled once for the tests below; kept out of the per-test temp tracking, which removes things after each test.
  let buildDir = ''
  let built: NuanceBuild
  beforeAll(() => { buildDir = mkdtempSync(join(tmpdir(), 'summon-build-')); built = buildNuance(join(buildDir, 'nuance')) }, 60_000)
  afterAll(() => { rmSync(buildDir, { recursive: true, force: true }) })

  test('compiles two arm64 binaries; the gatekeeper refuses `ls`; the runner settles an empty home', () => {
    expect(built.sha).toEqual({ gatekeeper: sha(built.gatekeeper), runner: sha(built.runner) })
    for (const bin of [built.gatekeeper, built.runner]) {
      expect(new TextDecoder().decode(Bun.spawnSync(['/usr/bin/file', bin]).stdout)).toContain('Mach-O 64-bit executable arm64')
      expect(new TextDecoder().decode(Bun.spawnSync(['/usr/bin/codesign', '-dv', bin]).stderr)).toContain('Signature=adhoc')
    }
    const gkHome = temp('summon-gk-home-')
    const gk = Bun.spawnSync([built.gatekeeper], { env: { PATH: BASE_PATH, HOME: gkHome, SUMMON_HOME_OVERRIDE: gkHome, SSH_ORIGINAL_COMMAND: 'ls' } })
    expect(gk.exitCode).toBe(2)
    expect(gk.stdout.toString()).toBe('{"status":"refused","reason":"malformed","detail":"unknown command"}\n')
    const rnHome = temp('summon-rn-home-')
    const rn = Bun.spawnSync([built.runner], { env: { PATH: BASE_PATH, HOME: rnHome, SUMMON_HOME_OVERRIDE: rnHome } })
    expect(rn.exitCode).toBe(0)
    const tree = (d: string, rel = ''): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? [`${rel}${e.name}/`, ...tree(join(d, e.name), `${rel}${e.name}/`)] : [`${rel}${e.name}`])
    // Nothing but Summon's own spool (and the folders above it), all private, appears in the home.
    expect(tree(rnHome).sort()).toEqual(['.local/', '.local/state/', '.local/state/summon/', '.local/state/summon/spool/'])
    for (const d of tree(rnHome)) expect([d, mode(join(rnHome, d)).toString(8)]).toEqual([d, '700'])
  })

  test('the real binaries go through the bundle and the installer without a signing alarm, and still run', () => {
    const home = temp('summon-air-')
    const r = prepareBundle({ home, build: () => built })
    const root = temp('summon-root-')
    const out = run(r.bundle, root)
    expect(out.exitCode).toBe(0)
    expect(out.stdout.toString()).not.toContain('could not sign')
    const installed = join(root, '.local/share/summon/summon-gatekeeper')
    expect(sha(installed)).toBe(built.sha.gatekeeper)
    expect(sha(join(root, '.local/share/summon/summon-runner'))).toBe(built.sha.runner)
    const gk = Bun.spawnSync([installed], { env: { PATH: BASE_PATH, HOME: root, SUMMON_HOME_OVERRIDE: root, SSH_ORIGINAL_COMMAND: 'ls' } })
    expect([gk.exitCode, gk.stdout.toString()]).toEqual([2, '{"status":"refused","reason":"malformed","detail":"unknown command"}\n'])
  })
})

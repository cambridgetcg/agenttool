import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { buildNuance, linkeditEnd, type NuanceBuild } from '../scripts/build-nuance.ts'
import { pinnedText, writeSshConfig } from '../scripts/pin-nuance.ts'
import { bundleReadyText, prepareBundle, renderInstaller } from '../scripts/prepare-pairing.ts'
import { cleanupTmps, END_TO_END, trackTmp, world } from './helpers.ts'

afterEach(cleanupTmps)

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
const mode = (p: string) => statSync(p).mode & 0o777
const temp = (prefix: string) => trackTmp(mkdtempSync(join(tmpdir(), prefix)))
const keygen = (path: string) => Bun.spawnSync(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'root@stub', '-f', path]).exitCode
const PKG = join(import.meta.dir, '..')
const PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey summon-air'
const TMPL = readFileSync(join(PKG, 'nuance', 'install.sh.tmpl'), 'utf8')
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const USER = userInfo().username
const DAY = 86_400_000
/** YYYYMMDD in this Mac's local time: how the installer's `date +%Y%m%d` and sshd's expiry-time read a date. */
const ymd = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` }
const dashed = (e: string) => `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6)}`
const EXPIRY = ymd(Date.now() + 90 * DAY)
const LATER = ymd(Date.now() + 180 * DAY)
const RL_OFF = 'Until this is fixed, turn Remote Login off: System Settings → General → Sharing → Remote Login.'

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
  test('the header says Remote Login must be on first and names the per-pairing folder', () => {
    const head = TMPL.split('\nset -euo pipefail')[0]!
    expect(head).toContain('turn on Remote Login')
    expect(head).toContain('bash ~/Downloads/summon-nuance-bundle-<expiry>-<build>/summon-install.sh')
  })
  test('shellcheck finds nothing in the rendered installer', () => {
    const sc = Bun.which('shellcheck')
    if (!sc) return // not installed on every Mac; the report records a run
    const f = join(temp('summon-sc-'), 'summon-install.sh')
    writeFileSync(f, renderInstaller(TMPL, good))
    const r = Bun.spawnSync([sc, '-s', 'bash', f])
    expect([r.exitCode, r.stdout.toString()]).toEqual([0, ''])
  })
})

function bundle(root: string = temp('summon-root-'), o: { expiry?: string; build?: string } = {}): { dir: string; root: string } {
  const dir = temp('summon-bundle-')
  for (const b of ['summon-gatekeeper', 'summon-runner']) { writeFileSync(join(dir, b), `#!/bin/sh\necho ${b} ${o.build ?? 'v1'}\n`); chmodSync(join(dir, b), 0o755) }
  writeFileSync(join(dir, 'summon-install.sh'), renderInstaller(TMPL, { pubkey: PUB, expiry: o.expiry ?? EXPIRY,
    shaGatekeeper: sha(join(dir, 'summon-gatekeeper')), shaRunner: sha(join(dir, 'summon-runner')) }))
  return { dir, root }
}
const envFor = (root: string, extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: BASE_PATH, HOME: root, SUMMON_INSTALL_ROOT: root, SUMMON_SKIP_SUDO: '1', SUMMON_SKIP_LAUNCHCTL: '1', SUMMON_SKIP_INVENTORY: '1',
  // Never this Mac's /etc/ssh: a host key that is not there, unless a test makes one.
  SUMMON_HOST_KEY: join(root, '..', 'no-such-host-key'), ...extra,
})
const run = (dir: string, root: string, extra: Record<string, string> = {}) =>
  Bun.spawnSync(['bash', join(dir, 'summon-install.sh')], { env: envFor(root, extra) })

/** Stand-ins for the commands that would touch this Mac: they record their arguments and run nothing. */
function stubs(scripts: Record<string, string>): { path: string; log: string; env: Record<string, string>; missingHostKey: string } {
  const dir = temp('summon-stubs-')
  for (const [name, body] of Object.entries({ nc: NC_STUB, ...scripts })) {
    const p = join(dir, name)
    writeFileSync(p, `#!/bin/bash\n${body}\n`); chmodSync(p, 0o755)
    // A stub that is not executable would let bash fall through to the real command.
    expect(mode(p) & 0o111).not.toBe(0)
  }
  const log = join(dir, 'calls.log')
  writeFileSync(log, '')
  const at = (name: string) => join(dir, name)
  // A real host key, so the hand-back block can print its fingerprint. A test that wants none uses `missingHostKey`.
  const hostKey = at('ssh_host_ed25519_key')
  expect(keygen(hostKey)).toBe(0)
  const env = { STUB_LOG: log, SUMMON_HOST_KEY: hostKey, STUB_FAIL_NC: at('fail-nc'), STUB_FAIL_SUDO: at('fail-sudo'),
    STUB_FAIL_KEYGEN: at('fail-keygen'), STUB_KEYGEN_NOOP: at('keygen-noop'), STUB_FAIL_SSHD: at('fail-sshd'),
    STUB_FAIL_SSHD_T: at('fail-sshd-T'), STUB_SSHD_T: at('sshd-T.out'), STUB_SSHD_T_ROOT: at('sshd-T-root.out'),
    STUB_PRINT_LOADED: at('print-loaded'), STUB_BOOTSTRAP_FAILS: at('bootstrap-fails') }
  writeFileSync(env.STUB_SSHD_T, sshdT())
  return { path: `${dir}:${BASE_PATH}`, log, env, missingHostKey: at('made_host_key') }
}
/** What `sshd -T` prints: lowercase keywords, one line each. `over` replaces a value, or drops the keyword with null. */
function sshdT(over: Record<string, string | null> = {}): string {
  const base: Record<string, string> = { port: '22', permitrootlogin: 'no', pubkeyauthentication: 'yes', passwordauthentication: 'no',
    kbdinteractiveauthentication: 'no', allowusers: USER, authenticationmethods: 'publickey', gssapiauthentication: 'no',
    hostbasedauthentication: 'no', usedns: 'no', trustedusercakeys: 'none', authorizedkeyscommand: 'none', authorizedprincipalsfile: 'none',
    authorizedkeysfile: '.ssh/authorized_keys', x11forwarding: 'no' }
  return Object.entries({ ...base, ...over }).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v}`).join('\n') + '\n'
}
const NC_STUB = 'echo "nc $*" >> "$STUB_LOG"; [ ! -e "$STUB_FAIL_NC" ]'
const SUDO_STUB = `echo "sudo $*" >> "$STUB_LOG"
case "$1" in
  -v) [ ! -e "$STUB_FAIL_SUDO" ] || exit 1 ;;
  install) cat "$8" > "$STUB_LOG.dropin" ;;
  /usr/bin/ssh-keygen)
    [ ! -e "$STUB_FAIL_KEYGEN" ] || exit 1
    [ -e "$STUB_KEYGEN_NOOP" ] || /usr/bin/ssh-keygen -q -t ed25519 -N '' -C root@stub -f "$SUMMON_HOST_KEY" ;;
  /usr/sbin/sshd)
    if [ "$2" = -t ] && [ -e "$STUB_FAIL_SSHD" ]; then exit 1; fi
    if [ "$2" = -T ]; then
      [ ! -e "$STUB_FAIL_SSHD_T" ] || exit 1
      case "$4" in user=root,*) if [ -e "$STUB_SSHD_T_ROOT" ]; then cat "$STUB_SSHD_T_ROOT"; exit 0; fi ;; esac
      cat "$STUB_SSHD_T"
    fi ;;
esac
exit 0`
const LAUNCHCTL_STUB = `echo "launchctl $*" >> "$STUB_LOG"
count() { n="$(cat "$1" 2>/dev/null || echo 0)"; [ "$n" -gt 0 ] && echo $((n - 1)) > "$1"; }
case "$1" in
  print) count "$STUB_PRINT_LOADED" && exit 0; echo "Could not find service" >&2; exit 113 ;;
  bootstrap) if count "$STUB_BOOTSTRAP_FAILS"; then echo "Bootstrap failed: 5: Input/output error" >&2; echo "Try re-running the command as root for richer errors." >&2; exit 5; fi ;;
esac
exit 0`
const WITH_SUDO = { SUMMON_SKIP_SUDO: '0', SUMMON_SKIP_LAUNCHCTL: '0' }
const calls = (s: { log: string }) => readFileSync(s.log, 'utf8').trim().split('\n').filter(Boolean)
const PLIST = (root: string) => join(root, 'Library/LaunchAgents/dev.summon.runner.plist')
const AK = (root: string) => join(root, '.ssh/authorized_keys')
const INSTALLED = (root: string) => join(root, '.local/share/summon/INSTALLED')
const SERVICE = `gui/${userInfo().uid}/dev.summon.runner`
const SSHD_T_USER = `sudo /usr/sbin/sshd -T -C user=${USER},host=192.168.50.2,addr=192.168.50.2`
const SSHD_T_ROOT = 'sudo /usr/sbin/sshd -T -C user=root,host=192.168.50.2,addr=192.168.50.2'
const DROPIN_TEXT = `PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\nAllowUsers ${USER}\n` +
  'AuthenticationMethods publickey\nGSSAPIAuthentication no\nHostbasedAuthentication no\n'

describe('installer', () => {
  test('installs with private modes and one restricted key line', () => {
    const { dir, root } = bundle()
    const r = run(dir, root)
    expect(r.exitCode).toBe(0)
    expect(mode(join(root, '.local/share/summon'))).toBe(0o700)
    expect(mode(join(root, '.local/share/summon/summon-gatekeeper'))).toBe(0o700)
    expect(mode(join(root, '.local/share/summon/summon-runner'))).toBe(0o700)
    const ak = readFileSync(AK(root), 'utf8')
    expect(ak).toBe(`restrict,from="192.168.50.0/24",expiry-time="${EXPIRY}",command="${root}/.local/share/summon/summon-gatekeeper" ${PUB}\n`)
    expect(readFileSync(join(root, '.config/summon/allowlist.yaml'), 'utf8')).toContain('path: ~/Projects')
    expect(readFileSync(PLIST(root), 'utf8')).toContain('<key>QueueDirectories</key>')
  })

  test('every directory it makes is 0700 and every file 0600; the plist, runner.log and INSTALLED too', () => {
    const { dir, root } = bundle()
    expect(run(dir, root).exitCode).toBe(0)
    for (const d of ['.local/share/summon', '.local/state/summon', '.local/state/summon/spool', '.local/state/summon/jobs',
      '.local/state/summon/seen', '.config/summon', '.ssh']) expect([d, mode(join(root, d)).toString(8)]).toEqual([d, '700'])
    for (const f of ['.ssh/authorized_keys', '.config/summon/allowlist.yaml', '.local/state/summon/runner.log',
      'Library/LaunchAgents/dev.summon.runner.plist', '.local/share/summon/INSTALLED']) expect([f, mode(join(root, f)).toString(8)]).toEqual([f, '600'])
  })

  test('the LaunchAgent is a valid plist that leaves process-group cleanup to launchd', () => {
    const { dir, root } = bundle()
    expect(run(dir, root).exitCode).toBe(0)
    const plist = PLIST(root)
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
    writeFileSync(AK(root), 'ssh-ed25519 OTHER yu-laptop\n' + readFileSync(AK(root), 'utf8'))
    writeFileSync(join(root, '.config/summon/allowlist.yaml'), 'version: 1 # edited\n')
    writeFileSync(join(root, '.local/state/summon/runner.log'), 'earlier output\n')
    expect(run(dir, root).exitCode).toBe(0)
    const lines = readFileSync(AK(root), 'utf8').trim().split('\n')
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
    writeFileSync(AK(root), 'ssh-ed25519 OTHER yu-laptop\n', { mode: 0o600 })
    const s = stubs({ grep: 'exit 2' })
    const r = run(dir, root, { PATH: s.path })
    expect(r.exitCode).not.toBe(0)
    expect(readFileSync(AK(root), 'utf8')).toBe('ssh-ed25519 OTHER yu-laptop\n')
    expect(existsSync(join(root, '.ssh/authorized_keys.summon-tmp'))).toBe(false)
  })

  test('F12: refuses a bundle whose key has expired, or expires today, before it writes anything', () => {
    for (const expiry of ['20200101', ymd(Date.now())]) {
      const { dir, root } = bundle(undefined, { expiry })
      const r = run(dir, root)
      expect(r.exitCode).toBe(1)
      expect(r.stdout.toString()).toContain(`✗ this bundle's summon key expired on ${dashed(expiry)} — ask Ai for a fresh bundle`)
      expect(readdirSync(root)).toEqual([])
    }
  })

  test('F03: an older bundle never re-pairs backwards; SUMMON_ALLOW_OLDER=1 goes back on purpose', () => {
    const root = temp('summon-root-')
    const gatekeeper = join(root, '.local/share/summon/summon-gatekeeper')
    const newer = bundle(root, { expiry: LATER, build: 'v2' })
    expect(run(newer.dir, root).exitCode).toBe(0)
    const installed = readFileSync(INSTALLED(root), 'utf8')
    const older = bundle(root, { expiry: EXPIRY, build: 'v1' })
    const r = run(older.dir, root)
    expect(r.exitCode).toBe(1)
    const said = r.stdout.toString()
    expect(said).toContain(`✗ this installer is older than what is installed (this bundle's key expires ${dashed(EXPIRY)}; the installed one expires ${dashed(LATER)})`)
    expect(said).toContain('SUMMON_ALLOW_OLDER=1')
    expect(said).not.toContain('installed in')
    // Nothing moved: the key line, the programs and the record of them are the newer bundle's.
    expect(readFileSync(AK(root), 'utf8')).toContain(`expiry-time="${LATER}"`)
    expect(readFileSync(gatekeeper, 'utf8')).toContain('v2')
    expect(readFileSync(INSTALLED(root), 'utf8')).toBe(installed)
    const back = run(older.dir, root, { SUMMON_ALLOW_OLDER: '1' })
    expect(back.exitCode).toBe(0)
    expect(readFileSync(AK(root), 'utf8')).toContain(`expiry-time="${EXPIRY}"`)
    expect(readFileSync(gatekeeper, 'utf8')).toContain('v1')
  })

  test('F03: records what it installed, and the hand-back block names the build and the key expiry', () => {
    const { dir, root } = bundle()
    const r = run(dir, root)
    expect(r.exitCode).toBe(0)
    const g = sha(join(dir, 'summon-gatekeeper')); const rn = sha(join(dir, 'summon-runner'))
    expect(readFileSync(INSTALLED(root), 'utf8')).toBe(`summon-gatekeeper ${g}\nsummon-runner ${rn}\nkey summon-air expires ${EXPIRY}\n`)
    const handBack = r.stdout.toString().split('──── give this back to Ai ────')[1]!
    expect(handBack).toContain(`build: ${rn.slice(0, 8)} (gatekeeper ${g.slice(0, 8)})`)
    expect(handBack).toContain(`key expires: ${EXPIRY}`)
    expect(handBack).toContain(`delete this bundle folder: ${dir}`)
  })

  describe('F42: a re-run never ends a summon that is queued or running', () => {
    const withJob = (status: string) => {
      const { dir, root } = bundle()
      const id = `smn_${'0'.repeat(31)}${status.length}`
      const job = join(root, '.local/state/summon/jobs', id)
      mkdirSync(job, { recursive: true })
      writeFileSync(join(job, 'state.json'), JSON.stringify({ id, status, runtime: 'claude', model: 'sonnet' }))
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
      return { dir, root, id, s, env: { ...s.env, PATH: s.path, ...WITH_SUDO } }
    }
    for (const status of ['queued', 'running']) {
      test(`stops before writing anything while a job is ${status}, and names it`, () => {
        const w = withJob(status)
        const r = run(w.dir, w.root, w.env)
        expect(r.exitCode).toBe(1)
        const said = r.stdout.toString()
        expect(said).toContain('✗ a summon is running: wait for it, or re-run with SUMMON_INSTALL_ANYWAY=1')
        expect(said).toContain(`${w.id} (${status})`)
        expect(calls(w.s)).toEqual([])
        expect(readdirSync(join(w.root, '.local'))).toEqual(['state'])
        expect(existsSync(AK(w.root))).toBe(false)
      })
    }
    test('SUMMON_INSTALL_ANYWAY=1 goes ahead; a finished job never stops it', () => {
      const w = withJob('running')
      expect(run(w.dir, w.root, { ...w.env, SUMMON_INSTALL_ANYWAY: '1' }).exitCode).toBe(0)
      const done = withJob('completed')
      expect(run(done.dir, done.root, done.env).exitCode).toBe(0)
    })
  })

  test('with sudo and launchctl stubbed: Remote Login checked, drop-in 010, validated, checked with sshd -T, never reloaded; the runner is bootstrapped', () => {
    const { dir, root } = bundle()
    const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
    const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
    expect(r.exitCode).toBe(0)
    const said = r.stdout.toString()
    expect(said).toContain('✓ Remote Login is on')
    expect(said).toContain('✓ SSH: key logins only')
    expect(said).not.toContain('⚠')
    const c = calls(s)
    expect(c[0]).toBe('nc -z -G 2 127.0.0.1 22')
    expect(c[1]).toBe('sudo -v')
    expect(c[2]).toMatch(/^sudo install -m 600 -o root -g wheel \S+ \/etc\/ssh\/sshd_config\.d\/010-summon\.conf$/)
    expect(c.slice(3)).toEqual(['sudo /usr/sbin/sshd -t', SSHD_T_USER, SSHD_T_ROOT, `launchctl bootout ${SERVICE}`, `launchctl print ${SERVICE}`,
      `launchctl bootstrap gui/${userInfo().uid} ${PLIST(root)}`])
    expect(readFileSync(`${s.log}.dropin`, 'utf8')).toBe(DROPIN_TEXT)
    expect(readFileSync(AK(root), 'utf8')).toContain(PUB)
    expect(said).toContain(`host key: ${readFileSync(`${s.env.SUMMON_HOST_KEY}.pub`, 'utf8').trim()}`)
  })

  test('matches the sshd -T keyword in any case but the value exactly', () => {
    const { dir, root } = bundle()
    const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
    writeFileSync(s.env.STUB_SSHD_T, sshdT().replace('passwordauthentication', 'PasswordAuthentication').replace('allowusers', 'AllowUsers'))
    expect(run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO }).exitCode).toBe(0)
  })

  test('F01: with Remote Login off it stops before any sudo call and writes nothing', () => {
    const { dir, root } = bundle()
    const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
    writeFileSync(s.env.STUB_FAIL_NC, '')
    const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
    expect(r.exitCode).toBe(1)
    const said = r.stdout.toString()
    expect(said).toContain('✗ Remote Login is off')
    expect(said).toContain('Turn on Remote Login (System Settings → General → Sharing → Remote Login, only your user), then run this again.')
    expect(calls(s)).toEqual(['nc -z -G 2 127.0.0.1 22'])
    expect(readdirSync(root)).toEqual([])
  })

  test('F01: on a Mac whose sshd never ran, it makes the host keys (ssh-keygen -A) before sshd -t, and hands back the new key', () => {
    const { dir, root } = bundle()
    const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
    const r = run(dir, root, { ...s.env, SUMMON_HOST_KEY: s.missingHostKey, PATH: s.path, ...WITH_SUDO })
    expect(r.exitCode).toBe(0)
    const said = r.stdout.toString()
    expect(said).toContain("✓ made this Mac's SSH host keys (ssh-keygen -A")
    expect(calls(s).slice(0, 5)).toEqual(['nc -z -G 2 127.0.0.1 22', 'sudo -v', 'sudo /usr/bin/ssh-keygen -A',
      expect.stringMatching(/^sudo install /), 'sudo /usr/sbin/sshd -t'])
    expect(said).toContain(`host key: ${readFileSync(`${s.missingHostKey}.pub`, 'utf8').trim()}`)
  })

  for (const [name, marker] of [['ssh-keygen -A fails', 'STUB_FAIL_KEYGEN'], ['ssh-keygen -A makes no ed25519 key', 'STUB_KEYGEN_NOOP']] as const) {
    test(`F01: no host keys and ${name}: says so (not "sshd rejected the change"), leaves sshd alone, says to turn Remote Login off`, () => {
      const { dir, root } = bundle()
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
      writeFileSync(s.env[marker]!, '')
      const r = run(dir, root, { ...s.env, SUMMON_HOST_KEY: s.missingHostKey, PATH: s.path, ...WITH_SUDO })
      expect(r.exitCode).toBe(1)
      const said = r.stdout.toString()
      expect(said).toContain('SSH host keys')
      expect(said).not.toContain('rejected the change')
      expect(said).toContain(RL_OFF)
      expect(calls(s)).toEqual(['nc -z -G 2 127.0.0.1 22', 'sudo -v', 'sudo /usr/bin/ssh-keygen -A'])
      expect(existsSync(AK(root))).toBe(false)
    })
  }

  test('a password sudo does not take: stops before sshd is touched, and says to turn Remote Login off meanwhile', () => {
    const { dir, root } = bundle()
    const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
    writeFileSync(s.env.STUB_FAIL_SUDO, '')
    const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
    expect(r.exitCode).toBe(1)
    const said = r.stdout.toString()
    expect(said).toContain('✗ sudo did not accept the password')
    expect(said).toContain(RL_OFF)
    expect(calls(s)).toEqual(['nc -z -G 2 127.0.0.1 22', 'sudo -v'])
    expect(existsSync(AK(root))).toBe(false)
  })

  test('when sshd -t rejects the drop-in the installer removes it and stops before the key line and the runner', () => {
    const { dir, root } = bundle()
    const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
    writeFileSync(s.env.STUB_FAIL_SSHD!, '')
    const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
    expect(r.exitCode).not.toBe(0)
    const said = r.stdout.toString()
    expect(said).toContain('sshd rejected the change')
    expect(said).toContain(RL_OFF)
    expect(calls(s).slice(3)).toEqual(['sudo /usr/sbin/sshd -t', 'sudo rm -f /etc/ssh/sshd_config.d/010-summon.conf'])
    expect(existsSync(AK(root))).toBe(false)
    expect(existsSync(PLIST(root))).toBe(false)
  })

  describe('"key logins only" is what sshd -T says, not what the drop-in says', () => {
    const notOff: Record<string, { user?: string; root?: string }> = {
      'password logins still on': { user: sshdT({ passwordauthentication: 'yes' }) },
      'keyboard-interactive still on': { user: sshdT({ kbdinteractiveauthentication: 'yes' }) },
      'root login not off': { user: sshdT({ permitrootlogin: 'prohibit-password' }) },
      'another user allowed': { user: sshdT({ allowusers: `${USER} other` }) },
      'a different user only': { user: sshdT({ allowusers: 'other' }) },
      'allowusers missing': { user: sshdT({ allowusers: null }) },
      'passwordauthentication missing': { user: sshdT({ passwordauthentication: null }) },
      'value spelled differently': { user: sshdT({ passwordauthentication: 'No' }) },
      'two conflicting lines': { user: sshdT() + 'passwordauthentication yes\n' },
      'empty output': { user: '' },
      'F31: any authentication method allowed': { user: sshdT({ authenticationmethods: 'any' }) },
      'F31: authenticationmethods missing': { user: sshdT({ authenticationmethods: null }) },
      'F31: GSSAPI logins on': { user: sshdT({ gssapiauthentication: 'yes' }) },
      'F31: host-based logins on': { user: sshdT({ hostbasedauthentication: 'yes' }) },
      'F13: UseDNS on, so a Match Host could see a name this check did not': { user: sshdT({ usedns: 'yes' }) },
      'F13: root may log in (a Match User root)': { root: sshdT({ permitrootlogin: 'yes', allowusers: 'root' }) },
      'F13: root may log in with a password': { root: sshdT({ passwordauthentication: 'yes' }) },
    }
    for (const [name, out] of Object.entries(notOff)) {
      test(`stops before the key line and the runner: ${name}`, () => {
        const { dir, root } = bundle()
        const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
        if (out.user !== undefined) writeFileSync(s.env.STUB_SSHD_T, out.user)
        if (out.root !== undefined) writeFileSync(s.env.STUB_SSHD_T_ROOT, out.root)
        const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
        expect(r.exitCode).not.toBe(0)
        const said = r.stdout.toString()
        expect(said).toContain('NOT switched off')
        expect(said).toContain(RL_OFF)
        expect(said).not.toContain('✓ SSH')
        expect(calls(s).some((l) => l.startsWith('launchctl'))).toBe(false)
        expect(existsSync(PLIST(root))).toBe(false)
        expect(existsSync(AK(root))).toBe(false)
      })
    }

    test('names the setting that is wrong, with sshd -T asked by address for a LAN login by this user, then by root', () => {
      const { dir, root } = bundle()
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
      writeFileSync(s.env.STUB_SSHD_T, sshdT({ passwordauthentication: 'yes' }))
      writeFileSync(s.env.STUB_SSHD_T_ROOT, sshdT({ permitrootlogin: 'yes' }))
      const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
      const said = r.stdout.toString()
      expect(said).toContain("sshd would use 'passwordauthentication yes', Summon needs 'passwordauthentication no'")
      expect(said).toContain("for root logins, sshd would use 'permitrootlogin yes', Summon needs 'permitrootlogin no'")
      expect(calls(s)).toEqual(['nc -z -G 2 127.0.0.1 22', 'sudo -v', expect.stringMatching(/^sudo install /), 'sudo /usr/sbin/sshd -t', SSHD_T_USER, SSHD_T_ROOT])
    })

    test('stops when sshd -T itself fails: nothing is confirmed', () => {
      const { dir, root } = bundle()
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
      writeFileSync(s.env.STUB_FAIL_SSHD_T!, '')
      const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
      expect(r.exitCode).not.toBe(0)
      expect(r.stdout.toString()).toContain('NOT confirmed off')
      expect(r.stdout.toString()).toContain(RL_OFF)
      expect(calls(s).some((l) => l.startsWith('launchctl'))).toBe(false)
      expect(existsSync(AK(root))).toBe(false)
    })

    test('F31: prints, without stopping, a key source that is not the default', () => {
      const { dir, root } = bundle()
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
      writeFileSync(s.env.STUB_SSHD_T, sshdT({ authorizedkeyscommand: '/usr/local/bin/keys', trustedusercakeys: '/etc/ssh/ca.pub',
        authorizedprincipalsfile: '/etc/ssh/principals', authorizedkeysfile: '.ssh/authorized_keys .ssh/authorized_keys2' }))
      const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO })
      expect(r.exitCode).toBe(0)
      const said = r.stdout.toString()
      for (const [k, v, d] of [['authorizedkeyscommand', '/usr/local/bin/keys', 'none'], ['trustedusercakeys', '/etc/ssh/ca.pub', 'none'],
        ['authorizedprincipalsfile', '/etc/ssh/principals', 'none'], ['authorizedkeysfile', '.ssh/authorized_keys .ssh/authorized_keys2', '.ssh/authorized_keys']]) {
        expect(said).toContain(`⚠ sshd uses '${k} ${v}' (the macOS default is '${k} ${d}')`)
      }
      expect(said).toContain('✓ SSH: key logins only')
    })
  })

  describe('with the real /usr/sbin/sshd -T on temp configs (no sudo, no /etc)', () => {
    // sudo is stubbed so that `install` drops the installer's real drop-in into a temp sshd_config.d, `ssh-keygen -A` makes a
    // real host key where SUMMON_HOST_KEY says, and `sshd -t/-T` run the real sshd against a temp config that Includes that
    // folder, with that host key if there is one. So the verdict is sshd's own, for the file the installer wrote.
    const REAL_SSHD_SUDO = `echo "sudo $*" >> "$STUB_LOG"
case "$1" in
  install) cp "$8" "$STUB_CONFD/010-summon.conf" ;;
  /usr/bin/ssh-keygen) [ -e "$STUB_KEYGEN_NOOP" ] || /usr/bin/ssh-keygen -q -t ed25519 -N '' -C root@stub -f "$SUMMON_HOST_KEY" ;;
  /usr/sbin/sshd) cmd="$2"; shift 2
    if [ -e "$SUMMON_HOST_KEY" ]; then exec /usr/sbin/sshd "$cmd" -f "$STUB_SSHD_CONFIG" -h "$SUMMON_HOST_KEY" "$@"; fi
    exec /usr/sbin/sshd "$cmd" -f "$STUB_SSHD_CONFIG" "$@" ;;
esac
exit 0`
    /** A copy of macOS's own sshd_config (15.7.3) and 100-macos.conf, with the Include pointed at the temp folder. */
    const MACOS = (d: string) => `Include ${d}/*\nAuthorizedKeysFile\t.ssh/authorized_keys\nSubsystem\tsftp\t/usr/libexec/sftp-server\n`
    const MACOS_CONFD = { '100-macos.conf': '# Options set by macOS that differ from the OpenSSH defaults.\nUsePAM yes\nAcceptEnv LANG LC_*\n' }
    function realSshd(config: (confd: string) => string, confFiles: Record<string, string>, hostKey: boolean) {
      const base = temp('summon-sshd-')
      const confd = join(base, 'sshd_config.d'); mkdirSync(confd)
      for (const [name, text] of Object.entries(confFiles)) writeFileSync(join(confd, name), text)
      const key = join(base, 'ssh_host_ed25519_key')
      if (hostKey) expect(keygen(key)).toBe(0)
      writeFileSync(join(base, 'sshd_config'), config(confd))
      return { STUB_CONFD: confd, STUB_SSHD_CONFIG: join(base, 'sshd_config'), SUMMON_HOST_KEY: key }
    }
    const attempt = (config: (confd: string) => string, o: { confFiles?: Record<string, string>; hostKey?: boolean; keygenNoop?: boolean } = {}) => {
      const { dir, root } = bundle()
      const s = stubs({ sudo: REAL_SSHD_SUDO, launchctl: LAUNCHCTL_STUB })
      if (o.keygenNoop) writeFileSync(s.env.STUB_KEYGEN_NOOP, '')
      const real = realSshd(config, o.confFiles ?? MACOS_CONFD, o.hostKey ?? true)
      const r = run(dir, root, { ...s.env, ...real, PATH: s.path, ...WITH_SUDO })
      return { r, s, root, real, said: r.stdout.toString() }
    }
    const accepted = (a: ReturnType<typeof attempt>) => {
      expect([a.r.exitCode, a.r.stderr.toString()]).toEqual([0, ''])
      expect(a.said).toContain('✓ SSH: key logins only')
      expect(readFileSync(join(a.real.STUB_CONFD, '010-summon.conf'), 'utf8')).toBe(DROPIN_TEXT)
      expect(existsSync(PLIST(a.root))).toBe(true)
      expect(calls(a.s).filter((l) => l.startsWith('launchctl bootstrap')).length).toBe(1)
    }

    test("macOS's own config: accepted (every drop-in keyword is one this sshd knows), no notes, the runner is loaded", () => {
      const a = attempt(MACOS)
      accepted(a)
      expect(a.said).not.toContain('⚠')
    })
    test('an Include read first and nothing else: accepted', () => {
      accepted(attempt((d) => `Include ${d}/*\n`, { confFiles: {} }))
    })
    test('F31: an AuthorizedKeysCommand: accepted, with a note that names it', () => {
      const a = attempt((d) => `${MACOS(d)}AuthorizedKeysCommand /usr/bin/true\nAuthorizedKeysCommandUser nobody\n`)
      accepted(a)
      expect(a.said).toContain("⚠ sshd uses 'authorizedkeyscommand /usr/bin/true'")
    })
    test('F01: no host keys yet: ssh-keygen -A makes one, sshd -t then accepts, and the new key is handed back', () => {
      const a = attempt(MACOS, { hostKey: false })
      accepted(a)
      expect(a.said).toContain("✓ made this Mac's SSH host keys")
      expect(a.said).not.toContain('rejected the change')
      expect(a.said).toContain(`host key: ${readFileSync(`${a.real.SUMMON_HOST_KEY}.pub`, 'utf8').trim()}`)
    })
    test('F01: no host keys and none made: a host-key message, never "sshd rejected the change", and sshd -t is not run', () => {
      const a = attempt(MACOS, { hostKey: false, keygenNoop: true })
      expect(a.r.exitCode).toBe(1)
      expect(a.said).toContain('SSH host keys')
      expect(a.said).not.toContain('rejected the change')
      expect(a.said).toContain(RL_OFF)
      expect(calls(a.s).some((l) => l.includes('sshd'))).toBe(false)
      expect(existsSync(AK(a.root))).toBe(false)
    })
    for (const [name, config, confFiles] of [
      ['PasswordAuthentication yes before the Include (the first value wins)', (d: string) => `PasswordAuthentication yes\n${MACOS(d)}`, undefined],
      ['an earlier-sorting drop-in with PasswordAuthentication yes', MACOS, { ...MACOS_CONFD, '000-other.conf': 'PasswordAuthentication yes\n' }],
      ['a Match block for the LAN that turns passwords back on', (d: string) => `${MACOS(d)}Match Address 192.168.50.0/24\n  PasswordAuthentication yes\n`, undefined],
      ['F13: a Match Host for the LAN that turns passwords back on', (d: string) => `${MACOS(d)}Match Host 192.168.50.*\n  PasswordAuthentication yes\n`, undefined],
      ['F13: a Match User root that lets root in with a password', (d: string) => `${MACOS(d)}Match User root\n  PermitRootLogin yes\n  PasswordAuthentication yes\n  AllowUsers root\n`, undefined],
      ['F13: UseDNS yes', (d: string) => `UseDNS yes\n${MACOS(d)}`, undefined],
      ['F31: GSSAPIAuthentication yes before the Include', (d: string) => `GSSAPIAuthentication yes\n${MACOS(d)}`, undefined],
      ['F31: HostbasedAuthentication yes before the Include', (d: string) => `HostbasedAuthentication yes\n${MACOS(d)}`, undefined],
      ['F31: a Match block that allows any authentication method', (d: string) => `${MACOS(d)}Match Address 192.168.50.0/24\n  AuthenticationMethods any\n`, undefined],
      ['no Include at all', () => 'Port 22\n', undefined],
    ] as const) {
      test(`refused, with no key line and no runner: ${name}`, () => {
        const a = attempt(config, { confFiles })
        expect(a.r.exitCode).not.toBe(0)
        expect(a.said).toContain('NOT switched off')
        expect(a.said).toContain(RL_OFF)
        expect(a.said).not.toContain('✓ SSH')
        expect(existsSync(PLIST(a.root))).toBe(false)
        expect(existsSync(AK(a.root))).toBe(false)
        expect(calls(a.s).some((l) => l.startsWith('launchctl'))).toBe(false)
      })
    }
  })

  describe('F41: loading the runner', () => {
    const attempt = (o: { printLoaded?: number; bootstrapFails?: number; inventory?: boolean }) => {
      const { dir, root } = bundle()
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
      if (o.printLoaded) writeFileSync(s.env.STUB_PRINT_LOADED, String(o.printLoaded))
      if (o.bootstrapFails) writeFileSync(s.env.STUB_BOOTSTRAP_FAILS, String(o.bootstrapFails))
      const r = run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO, SUMMON_SKIP_INVENTORY: o.inventory ? '0' : '1' })
      return { r, root, s, said: r.stdout.toString(), launchctl: calls(s).filter((l) => l.startsWith('launchctl')) }
    }
    const BOOTSTRAP = (root: string) => `launchctl bootstrap gui/${userInfo().uid} ${PLIST(root)}`

    test('waits until the old runner is gone before it bootstraps the new one', () => {
      const a = attempt({ printLoaded: 2 })
      expect(a.r.exitCode).toBe(0)
      expect(a.launchctl).toEqual([`launchctl bootout ${SERVICE}`, `launchctl print ${SERVICE}`, `launchctl print ${SERVICE}`,
        `launchctl print ${SERVICE}`, BOOTSTRAP(a.root)])
    }, 15_000)
    test('a bootstrap that fails once is tried again', () => {
      const a = attempt({ bootstrapFails: 1 })
      expect(a.r.exitCode).toBe(0)
      expect(a.said).toContain('✓ runner loaded in your GUI session')
      expect(a.launchctl.filter((l) => l.startsWith('launchctl bootstrap'))).toEqual([BOOTSTRAP(a.root), BOOTSTRAP(a.root)])
    }, 15_000)
    test('a bootstrap that keeps failing: says the runner is NOT loaded and what to do, and still hands back the pairing lines', () => {
      const a = attempt({ bootstrapFails: 2, inventory: true })
      expect(a.r.exitCode).toBe(1)
      expect(a.said).toContain('✗ the runner is NOT loaded (launchctl bootstrap said: Bootstrap failed: 5: Input/output error')
      expect(a.said).toContain(`The key line was already updated (expires ${EXPIRY}). Run this installer again, or log out and in. Tell Ai.`)
      expect(a.said).not.toContain('✓ runner loaded')
      const handBack = a.said.split('──── give this back to Ai ────')[1]!
      expect(handBack).toContain(`user: ${USER}`)
      expect(handBack).toContain('host key: ssh-ed25519 ')
      expect(handBack).toContain('inventory: not asked (the runner is not loaded)')
      expect(handBack).not.toContain('delete this bundle folder')
      expect(readdirSync(join(a.root, '.local/state/summon/spool'))).toEqual([])
      expect(readFileSync(AK(a.root), 'utf8')).toContain(`expiry-time="${EXPIRY}"`)
    }, 15_000)
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
    expect(out).toContain('user: ' + USER)
    expect(out).toContain('inventory: {"macos":"fresh"}')
    expect(out).not.toContain('stale')
  }, 30_000)
})

/** Stands in for the compile: two small files and their real digests. */
function fakeBuild(outDir: string, tag = '') {
  mkdirSync(outDir, { recursive: true })
  const gatekeeper = join(outDir, 'summon-gatekeeper'); const runner = join(outDir, 'summon-runner')
  writeFileSync(gatekeeper, `#!/bin/sh\necho gatekeeper${tag}\n`); writeFileSync(runner, `#!/bin/sh\necho runner${tag}\n`)
  return { gatekeeper, runner, sha: { gatekeeper: sha(gatekeeper), runner: sha(runner) } }
}

describe('prepareBundle (the Air side)', () => {
  const NOW = Date.UTC(2026, 9, 10)

  test('names the bundle by its expiry and build, keeps it private, and records the expiry on the Air', () => {
    const home = temp('summon-air-')
    const fb = fakeBuild(temp('summon-fb-'))
    const r = prepareBundle({ home, build: () => fb, now: NOW })
    const folder = `summon-nuance-bundle-20270108-${fb.sha.runner.slice(0, 8)}`
    expect(r.bundle).toBe(join(home, folder))
    expect(r.expiry).toBe('20270108')
    expect(r.command).toBe(`bash ~/Downloads/${folder}/summon-install.sh`)
    expect(readdirSync(home).sort()).toEqual(['.ssh', folder])
    expect(readdirSync(r.bundle).sort()).toEqual(['MANIFEST.txt', 'summon-gatekeeper', 'summon-install.sh', 'summon-runner'])
    expect(mode(r.bundle)).toBe(0o700)
    expect(mode(join(home, '.ssh/summon'))).toBe(0o700)
    expect(readdirSync(join(home, '.ssh/summon')).sort()).toEqual(['expiry', 'summon_nuance_ed25519', 'summon_nuance_ed25519.pub'])
    for (const f of ['summon_nuance_ed25519', 'summon_nuance_ed25519.pub', 'expiry']) expect([f, mode(join(home, '.ssh/summon', f)).toString(8)]).toEqual([f, '600'])
    expect(readFileSync(join(home, '.ssh/summon/expiry'), 'utf8')).toBe('20270108\n')
    for (const f of ['summon-install.sh', 'MANIFEST.txt']) expect([f, mode(join(r.bundle, f)).toString(8)]).toEqual([f, '600'])
    for (const f of ['summon-gatekeeper', 'summon-runner']) expect([f, mode(join(r.bundle, f)).toString(8)]).toEqual([f, '700'])
    expect(readFileSync(join(r.bundle, 'MANIFEST.txt'), 'utf8')).toBe(
      `summon-gatekeeper ${fb.sha.gatekeeper}\nsummon-runner ${fb.sha.runner}\nkey summon-air expires 20270108\n`)
    // What the script prints: the exact command for this bundle, and when its key expires.
    const text = bundleReadyText(r)
    expect(text).toContain(`bundle ready: ${r.bundle}`)
    expect(text).toContain(`  ${r.command}\n`)
    expect(text).toContain('the summon key expires 2027-01-08 (20270108)')
  })

  test('the bundle it makes installs on a stand-in Nuance, with the real key it generated', () => {
    const home = temp('summon-air-')
    const r = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-')) })
    const root = temp('summon-root-')
    expect(run(r.bundle, root).exitCode).toBe(0)
    const pub = readFileSync(join(home, '.ssh/summon/summon_nuance_ed25519.pub'), 'utf8').trim()
    expect(pub).toMatch(/^ssh-ed25519 \S+ summon-air$/)
    expect(readFileSync(AK(root), 'utf8')).toBe(
      `restrict,from="192.168.50.0/24",expiry-time="${r.expiry}",command="${root}/.local/share/summon/summon-gatekeeper" ${pub}\n`)
  })

  test('keeps an existing key, and tightens a bundle folder that already exists with looser modes', () => {
    const home = temp('summon-air-')
    const fb = fakeBuild(temp('summon-fb-'))
    const first = prepareBundle({ home, build: () => fb, now: NOW })
    chmodSync(first.bundle, 0o755); chmodSync(join(first.bundle, 'summon-install.sh'), 0o644); chmodSync(join(home, '.ssh/summon/expiry'), 0o644)
    const again = prepareBundle({ home, build: () => fb, now: NOW })
    expect(again.pubkey).toBe(first.pubkey)
    expect(again.bundle).toBe(first.bundle)
    expect(mode(first.bundle)).toBe(0o700)
    expect(mode(join(first.bundle, 'summon-install.sh'))).toBe(0o600)
    expect(mode(join(home, '.ssh/summon/expiry'))).toBe(0o600)
  })

  test('a new build or a later expiry gets a folder of its own, and the Air keeps the latest expiry', () => {
    const home = temp('summon-air-')
    const a = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-')), now: NOW })
    const b = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-'), ' v2'), now: NOW })
    const c = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-'), ' v2'), now: NOW + 7 * DAY })
    expect(new Set([a.bundle, b.bundle, c.bundle]).size).toBe(3)
    expect(c.bundle).toContain('summon-nuance-bundle-20270115-')
    expect(readFileSync(join(home, '.ssh/summon/expiry'), 'utf8')).toBe('20270115\n')
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

  test('F14: the next step after pinning puts `summon` on PATH before trying it', () => {
    const t = pinnedText('/pkg')
    expect(t).toContain('mkdir -p ~/.local/bin && ln -sf "/pkg/bin/summon.ts" ~/.local/bin/summon')
    expect(t).toContain('some other file')
    expect(t.indexOf('ln -sf')).toBeLessThan(t.indexOf('summon nuance inventory'))
  })
})

describe('the Air front door (bin/summon.ts)', () => {
  const BIN = join(PKG, 'bin', 'summon.ts')
  const PATH_WITH_BUN = `${dirname(process.execPath)}:${BASE_PATH}`

  test("F06: its shebang ignores a .env in the caller's folder", () => {
    const shebang = readFileSync(BIN, 'utf8').split('\n')[0]!
    expect(shebang).toBe('#!/usr/bin/env -S bun --no-env-file')
    // The same first line on a probe that prints what it sees, started from a folder whose .env sets a SUMMON_* value.
    const caller = temp('summon-caller-')
    writeFileSync(join(caller, '.env'), 'SUMMON_SSH_BIN=/tmp/not-ssh\n')
    const probe = join(temp('summon-probe-'), 'probe.ts')
    writeFileSync(probe, `${shebang}\nconsole.log(process.env.SUMMON_SSH_BIN ?? 'unset')\n`); chmodSync(probe, 0o755)
    const r = Bun.spawnSync([probe], { cwd: caller, env: { PATH: PATH_WITH_BUN, HOME: caller } })
    expect([r.exitCode, r.stdout.toString()]).toEqual([0, 'unset\n'])
  })

  test('F14: started through a link on PATH, it finds its sources and answers with the usage', () => {
    const bin = temp('summon-bin-')
    symlinkSync(BIN, join(bin, 'summon'))
    const home = temp('summon-home-')
    const r = Bun.spawnSync(['summon'], { cwd: home, env: { PATH: `${bin}:${PATH_WITH_BUN}`, HOME: home } })
    expect(r.exitCode).toBe(2)
    expect(r.stdout.toString()).toContain('usage:')
  })
})

describe('the real build', () => {
  // Compiled once for the tests below; kept out of the per-test temp tracking, which removes things after each test.
  let buildDir = ''
  let built: NuanceBuild
  beforeAll(() => { buildDir = mkdtempSync(join(tmpdir(), 'summon-build-')); built = buildNuance(join(buildDir, 'nuance')) }, 120_000)
  afterAll(() => { rmSync(buildDir, { recursive: true, force: true }) })
  const strictlyValid = (bin: string) => {
    const v = Bun.spawnSync(['/usr/bin/codesign', '--verify', '--strict', '-vvv', bin])
    expect([bin, v.exitCode]).toEqual([bin, 0])
    expect(v.stderr.toString()).toContain('valid on disk')
  }

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

  test("F44: both carry a valid ad-hoc signature (codesign --verify --strict), with nothing after __LINKEDIT, not Bun's linker one", () => {
    for (const bin of [built.gatekeeper, built.runner]) {
      strictlyValid(bin)
      expect(statSync(bin).size).toBe(linkeditEnd(readFileSync(bin)))
      expect(Bun.spawnSync(['/usr/bin/codesign', '-dv', bin]).stderr.toString()).not.toContain('linker-signed')
    }
  })

  test('F39: the bytes do not depend on the folder the build is started from, and carry no path of this Mac', () => {
    const elsewhere = temp('summon-cwd-')
    const before = process.cwd()
    let again: NuanceBuild
    try { process.chdir(elsewhere); again = buildNuance(join(temp('summon-build2-'), 'nuance')) } finally { process.chdir(before) }
    expect(again.sha).toEqual(built.sha)
    for (const bin of [built.gatekeeper, built.runner]) expect([bin, readFileSync(bin).includes(PKG)]).toEqual([bin, false])
  }, 120_000)

  test('F06: the compiled gatekeeper ignores a .env and a bunfig.toml in the home sshd starts it in', () => {
    const home = temp('summon-gk-home-')
    const elsewhere = temp('summon-elsewhere-')
    writeFileSync(join(home, '.env'), `SUMMON_HOME_OVERRIDE=${elsewhere}\nSUMMON_TEST_GUI=1\n`)
    writeFileSync(join(home, 'pre.ts'), `require('node:fs').writeFileSync(${JSON.stringify(join(elsewhere, 'preload-ran'))}, 'x'); console.log('PRELOAD RAN')\n`)
    for (const bunfig of ['preload = ["./pre.ts"]\n', 'this is [ not toml\n']) {
      writeFileSync(join(home, 'bunfig.toml'), bunfig)
      const gk = Bun.spawnSync([built.gatekeeper], { cwd: home, env: { PATH: BASE_PATH, HOME: home, SSH_ORIGINAL_COMMAND: 'ls' } })
      expect([bunfig, gk.exitCode, gk.stdout.toString()]).toEqual([bunfig, 2, '{"status":"refused","reason":"malformed","detail":"unknown command"}\n'])
    }
    expect(existsSync(join(home, '.local/state/summon/ledger.jsonl'))).toBe(true)
    expect(readdirSync(elsewhere)).toEqual([])
  })

  test('the real binaries go through the bundle and the installer, keep their valid signature, and still run', () => {
    const home = temp('summon-air-')
    const r = prepareBundle({ home, build: () => built })
    const root = temp('summon-root-')
    const out = run(r.bundle, root)
    expect(out.exitCode).toBe(0)
    expect(out.stdout.toString()).not.toContain('could not sign')
    const installed = join(root, '.local/share/summon/summon-gatekeeper')
    expect(sha(installed)).toBe(built.sha.gatekeeper)
    expect(sha(join(root, '.local/share/summon/summon-runner'))).toBe(built.sha.runner)
    for (const bin of [installed, join(root, '.local/share/summon/summon-runner')]) strictlyValid(bin)
    const gk = Bun.spawnSync([installed], { env: { PATH: BASE_PATH, HOME: root, SUMMON_HOME_OVERRIDE: root, SSH_ORIGINAL_COMMAND: 'ls' } })
    expect([gk.exitCode, gk.stdout.toString()]).toEqual([2, '{"status":"refused","reason":"malformed","detail":"unknown command"}\n'])
  })

  // F40: the end-to-end checks of e2e.test.ts, through the compiled gatekeeper and the compiled runner.
  for (const [name, check] of Object.entries(END_TO_END)) test(`through the compiled pair: ${name}`, () => check(world(built)), 30_000)
})

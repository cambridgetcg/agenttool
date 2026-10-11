import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { renderInstaller } from '../scripts/prepare-pairing.ts'
import { AK, BASE_PATH, buildIdOf, bundle, cleanupFixtureHostKey, cleanupTmps, dashed, envFor, EXPIRY, INSTALLED, keygen, LATER, mode, PUB, run, sha, stampOf, temp, TMPL, USER, ymd } from './helpers.ts'

afterEach(cleanupTmps)
afterAll(cleanupFixtureHostKey)

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const RL_OFF = 'Until this is fixed, turn Remote Login off: System Settings → General → Sharing → Remote Login.'
const timesIn = (text: string, part: string) => text.split(part).length - 1
const shasOf = (dir: string) => ({ gatekeeper: sha(join(dir, 'summon-gatekeeper')), runner: sha(join(dir, 'summon-runner')) })

describe('renderInstaller', () => {
  const good = { pubkey: PUB, expiry: '20270110', preparedAt: '20261011023000', shaGatekeeper: SHA_A, shaRunner: SHA_B }
  test('fills every placeholder', () => {
    const s = renderInstaller(TMPL, good)
    expect(s).toContain(`PUBKEY='${PUB}'`)
    expect(s).toContain("EXPIRY='20270110'")
    expect(s).toContain("PREPARED_AT='20261011023000'")
    expect(s).toContain(`SHA_GATEKEEPER='${SHA_A}'`)
    expect(s).toContain(`SHA_RUNNER='${SHA_B}'`)
    expect(s).not.toMatch(/__[A-Z_]+__/)
  })
  test('refuses values that could change the script', () => {
    expect(() => renderInstaller(TMPL, { ...good, pubkey: "ssh-ed25519 AAAA summon-air'; rm -rf ~; '" })).toThrow('unexpected public key format')
    expect(() => renderInstaller(TMPL, { ...good, pubkey: 'ssh-rsa AAAA summon-air' })).toThrow('unexpected public key format')
    expect(() => renderInstaller(TMPL, { ...good, pubkey: 'ssh-ed25519 AAAA yu@laptop' })).toThrow('unexpected public key format')
    expect(() => renderInstaller(TMPL, { ...good, expiry: '2027-01-10' })).toThrow('bad template values')
    for (const preparedAt of ['20261011', '2026-10-11T02:30:00', "20261011023000'; rm -rf ~; '"]) {
      expect(() => renderInstaller(TMPL, { ...good, preparedAt })).toThrow('bad template values')
    }
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

  test('B0: a bundle prepared before the installed one never re-pairs backwards, even with the same key expiry; SUMMON_ALLOW_OLDER=1 goes back on purpose', () => {
    const root = temp('summon-root-')
    const gatekeeper = join(root, '.local/share/summon/summon-gatekeeper')
    const now = Date.now()
    const newer = bundle(root, { build: 'v2', prepared: stampOf(now) })
    expect(run(newer.dir, root).exitCode).toBe(0)
    const installed = readFileSync(INSTALLED(root), 'utf8')
    const older = bundle(root, { build: 'v1', prepared: stampOf(now - 3_600_000) })
    const r = run(older.dir, root)
    expect(r.exitCode).toBe(1)
    const said = r.stdout.toString()
    const at = (t: string) => `${dashed(t.slice(0, 8))} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12)} UTC`
    expect(said).toContain(`✗ this installer is older than what is installed (this bundle was prepared ${at(stampOf(now - 3_600_000))}; the installed one ${at(stampOf(now))})`)
    expect(said).toContain('SUMMON_ALLOW_OLDER=1')
    expect(said).not.toContain('installed in')
    // Nothing moved: the programs and the record of them are the newer bundle's.
    expect(readFileSync(gatekeeper, 'utf8')).toContain('v2')
    expect(readFileSync(INSTALLED(root), 'utf8')).toBe(installed)
    const back = run(older.dir, root, { SUMMON_ALLOW_OLDER: '1' })
    expect(back.exitCode).toBe(0)
    expect(readFileSync(gatekeeper, 'utf8')).toContain('v1')
    expect(readFileSync(INSTALLED(root), 'utf8')).toContain(`prepared ${stampOf(now - 3_600_000)}\n`)
  })

  test('F03: for an install from before INSTALLED existed, an earlier key expiry than the installed line is refused', () => {
    const root = temp('summon-root-')
    const newer = bundle(root, { expiry: LATER, build: 'v2', prepared: stampOf(Date.now() - 3_600_000) })
    expect(run(newer.dir, root).exitCode).toBe(0)
    rmSync(INSTALLED(root))
    const older = bundle(root, { expiry: EXPIRY, build: 'v1' })
    const r = run(older.dir, root)
    expect(r.exitCode).toBe(1)
    expect(r.stdout.toString()).toContain(`✗ this installer is older than what is installed (this bundle's key expires ${dashed(EXPIRY)}; the installed one expires ${dashed(LATER)})`)
    expect(readFileSync(AK(root), 'utf8')).toContain(`expiry-time="${LATER}"`)
    expect(readFileSync(join(root, '.local/share/summon/summon-gatekeeper'), 'utf8')).toContain('v2')
    expect(run(older.dir, root, { SUMMON_ALLOW_OLDER: '1' }).exitCode).toBe(0)
    expect(readFileSync(AK(root), 'utf8')).toContain(`expiry-time="${EXPIRY}"`)
  })

  test('F03/B0: records what it installed, and the hand-back block names the build, when it was prepared, the key expiry and the pin line', () => {
    const prepared = stampOf(Date.now())
    const { dir, root } = bundle(undefined, { prepared })
    const r = run(dir, root)
    expect(r.exitCode).toBe(0)
    const s2 = shasOf(dir)
    expect(readFileSync(INSTALLED(root), 'utf8')).toBe(
      `build ${buildIdOf(s2)}\nprepared ${prepared}\nsummon-gatekeeper ${s2.gatekeeper}\nsummon-runner ${s2.runner}\nkey summon-air expires ${EXPIRY}\n`)
    const handBack = r.stdout.toString().split('──── give this back to Ai ────')[1]!
    expect(handBack).toContain(`build: ${buildIdOf(s2)}\n`)
    expect(handBack).toContain(`prepared: ${prepared} (UTC)\n`)
    expect(handBack).toContain(`key expires: ${EXPIRY}\n`)
    const hostLine = readFileSync(`${envFor(root).SUMMON_HOST_KEY}.pub`, 'utf8').trim()
    expect(handBack).toContain(`bun scripts/pin-nuance.ts --user ${USER} --host-key "${hostLine}" --expires ${EXPIRY}`)
    expect(handBack).toContain(`Done. Once Ai has the lines above, delete this bundle folder: ${dir}`)
  })

  test('B1: never says Done when no host key could be handed back', () => {
    const { dir, root } = bundle()
    const r = run(dir, root, { SUMMON_HOST_KEY: join(root, '..', 'no-such-host-key') })
    expect(r.exitCode).toBe(1)
    const said = r.stdout.toString()
    expect(said).toContain('✗ Not confirmed: no host key was found to hand back — keep this bundle and tell Ai.')
    expect(said).not.toContain('Done')
  })

  test('B1: never says Done when the runner did not answer the inventory request', () => {
    const { dir, root } = bundle()
    const r = run(dir, root, { SUMMON_SKIP_INVENTORY: '0' })
    expect(r.exitCode).toBe(1)
    const said = r.stdout.toString()
    expect(said).toContain('✗ Not confirmed: the runner did not answer the inventory request — keep this bundle and tell Ai.')
    expect(said).not.toContain('Done')
  }, 40_000)

  describe('B2: before sshd takes keys only, every stop says once to turn Remote Login off', () => {
    const withStubs = (extra: Record<string, string> = {}) => {
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB, ...extra })
      return { s, env: { ...s.env, PATH: s.path, ...WITH_SUDO } }
    }
    const cases: Record<string, () => { r: ReturnType<typeof run>; s: ReturnType<typeof stubs> }> = {
      'a checksum mismatch': () => { const b = bundle(); writeFileSync(join(b.dir, 'summon-runner'), 'tampered'); const w = withStubs(); return { r: run(b.dir, b.root, w.env), s: w.s } },
      'an unsafe install folder': () => { const b = bundle(temp('summon root ')); const w = withStubs(); return { r: run(b.dir, b.root, w.env), s: w.s } },
      'an expired bundle': () => { const b = bundle(undefined, { expiry: '20200101' }); const w = withStubs(); return { r: run(b.dir, b.root, w.env), s: w.s } },
      'an older bundle': () => {
        const root = temp('summon-root-')
        expect(run(bundle(root, { prepared: stampOf(Date.now()) }).dir, root).exitCode).toBe(0)
        const w = withStubs(); return { r: run(bundle(root, { prepared: stampOf(Date.now() - 60_000) }).dir, root, w.env), s: w.s }
      },
      'a running job': () => {
        const b = bundle(); const job = join(b.root, '.local/state/summon/jobs', `smn_${'1'.repeat(32)}`); mkdirSync(job, { recursive: true })
        writeFileSync(join(job, 'state.json'), JSON.stringify({ status: 'running', pid: process.pid }))
        const w = withStubs(); return { r: run(b.dir, b.root, w.env), s: w.s }
      },
      'a silent stop (shasum fails)': () => { const b = bundle(); const w = withStubs({ shasum: 'exit 1' }); return { r: run(b.dir, b.root, w.env), s: w.s } },
      'sshd -t rejecting the drop-in (refused in the sudo block)': () => {
        const b = bundle(); const w = withStubs(); writeFileSync(w.s.env.STUB_FAIL_SSHD!, ''); return { r: run(b.dir, b.root, w.env), s: w.s }
      },
    }
    for (const [name, make] of Object.entries(cases)) {
      test(name, () => {
        const { r } = make()
        expect(r.exitCode).not.toBe(0)
        expect(timesIn(r.stdout.toString(), RL_OFF)).toBe(1)
      })
    }
    test('a silent stop is named as one', () => {
      const { r } = cases['a silent stop (shasum fails)']!()
      expect(r.stdout.toString()).toContain('✗ the installer stopped unexpectedly (exit 1); nothing after the last ✓ line was done. Tell Ai.')
    })
    test('not when Remote Login is off: there is nothing to turn off', () => {
      const b = bundle(); const w = withStubs(); writeFileSync(w.s.env.STUB_FAIL_NC, '')
      const r = run(b.dir, b.root, w.env)
      expect(r.exitCode).toBe(1)
      expect(timesIn(r.stdout.toString(), RL_OFF)).toBe(0)
    })
    test('not once sshd takes keys only: a later stop (the runner not loading) leaves Remote Login alone', () => {
      const b = bundle(); const w = withStubs(); writeFileSync(w.s.env.STUB_BOOTSTRAP_FAILS, '2')
      const r = run(b.dir, b.root, w.env)
      expect(r.exitCode).toBe(1)
      expect(r.stdout.toString()).toContain('✓ SSH: key logins only')
      expect(timesIn(r.stdout.toString(), RL_OFF)).toBe(0)
    }, 15_000)
  })

  describe('B4: a run that stops before the key line changes nothing of Summon\'s', () => {
    test('a first install refused by sshd writes nothing at all', () => {
      const { dir, root } = bundle()
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
      writeFileSync(s.env.STUB_FAIL_SSHD!, '')
      expect(run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO }).exitCode).toBe(1)
      expect(readdirSync(root)).toEqual([])
    })
    test('a refused re-run keeps the earlier programs, INSTALLED and the key line', () => {
      const root = temp('summon-root-')
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
      const env = { ...s.env, PATH: s.path, ...WITH_SUDO }
      expect(run(bundle(root, { build: 'v1', prepared: stampOf(Date.now() - 60_000) }).dir, root, env).exitCode).toBe(0)
      const before = { installed: readFileSync(INSTALLED(root), 'utf8'), ak: readFileSync(AK(root), 'utf8'),
        gatekeeper: readFileSync(join(root, '.local/share/summon/summon-gatekeeper'), 'utf8') }
      writeFileSync(s.env.STUB_SSHD_T, sshdT({ passwordauthentication: 'yes' }))
      const r = run(bundle(root, { build: 'v2', expiry: LATER }).dir, root, env)
      expect(r.exitCode).toBe(1)
      expect(r.stdout.toString()).toContain('No summon key line was written and the runner was not loaded.')
      expect({ installed: readFileSync(INSTALLED(root), 'utf8'), ak: readFileSync(AK(root), 'utf8'),
        gatekeeper: readFileSync(join(root, '.local/share/summon/summon-gatekeeper'), 'utf8') }).toEqual(before)
    })
    test('INSTALLED is written only once the install succeeded: not when the runner did not load', () => {
      const { dir, root } = bundle()
      const s = stubs({ sudo: SUDO_STUB, launchctl: LAUNCHCTL_STUB })
      writeFileSync(s.env.STUB_BOOTSTRAP_FAILS, '2')
      expect(run(dir, root, { ...s.env, PATH: s.path, ...WITH_SUDO }).exitCode).toBe(1)
      expect(existsSync(INSTALLED(root))).toBe(false)
      expect(existsSync(join(root, '.local/share/summon/summon-gatekeeper'))).toBe(true)
    }, 15_000)
  })

  describe('F42: a re-run never ends a summon that is queued or running', () => {
    const withJob = (status: string, extra: Record<string, unknown> = {}, claimed = false) => {
      const { dir, root } = bundle()
      const id = `smn_${'0'.repeat(31)}${status.length}`
      const job = join(root, '.local/state/summon/jobs', id)
      mkdirSync(job, { recursive: true })
      writeFileSync(join(job, 'state.json'), JSON.stringify({ id, status, runtime: 'claude', model: 'sonnet', ...extra }))
      if (claimed) writeFileSync(join(job, 'claimed'), '')
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
    const iso = (ms: number) => new Date(ms).toISOString()
    const deadPid = () => { const p = Bun.spawnSync(['/usr/bin/true']); return p.pid }
    for (const [name, status, extra, claimed] of [
      ['a running job whose process is alive', 'running', { pid: process.pid }, false],
      ['a queued job just past its expiry, still inside the 5-minute grace', 'queued', { expires_at: iso(Date.now() - 60_000) }, false],
      ['a queued job past expiry and grace that the runner has claimed', 'queued', { expires_at: iso(Date.now() - 10 * 60_000) }, true],
    ] as const) {
      test(`B3: still stops for ${name}`, () => {
        const w = withJob(status, extra, claimed)
        const r = run(w.dir, w.root, w.env)
        expect(r.exitCode).toBe(1)
        expect(r.stdout.toString()).toContain(`${w.id} (${status})`)
      })
    }
    test('B3: a running job whose process is gone, and a queued one past expiry plus grace, do not stop it', () => {
      for (const [status, extra] of [['running', { pid: deadPid() }], ['queued', { expires_at: iso(Date.now() - 10 * 60_000) }]] as const) {
        const w = withJob(status, extra)
        const r = run(w.dir, w.root, w.env)
        expect([status, r.exitCode]).toEqual([status, 0])
        expect(r.stdout.toString()).not.toContain('a summon is running')
      }
    })
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
    test('B9: when the old registration outlasts the wait and bootstrap fails, the runner state is "not confirmed", not "NOT loaded"', () => {
      const a = attempt({ printLoaded: 100, bootstrapFails: 2 })
      expect(a.r.exitCode).toBe(1)
      expect(a.said).toContain("✗ the runner's state is not confirmed: the old registration may still be loaded, and the new one could not be (launchctl bootstrap said: Bootstrap failed: 5: Input/output error)")
      expect(a.said).toContain(`The key line was already updated (expires ${EXPIRY}). Run this installer again, or log out and in. Tell Ai.`)
      expect(a.said).not.toContain('NOT loaded')
      expect(a.said).toContain("✗ Not confirmed: the runner's state is not confirmed (see above) — keep this bundle and tell Ai.")
    }, 20_000)
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
      expect(handBack).toContain('✗ Not confirmed: the runner is NOT loaded (see above) — keep this bundle and tell Ai.')
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
    expect(out).toContain('Done. Once Ai has the lines above')
  }, 30_000)
})


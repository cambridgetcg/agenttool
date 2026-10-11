import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pinnedText, writeSshConfig } from '../scripts/pin-nuance.ts'
import { bundleReadyText, prepareBundle } from '../scripts/prepare-pairing.ts'
import { AK, BASE_PATH, buildIdOf, cleanupFixtureHostKey, cleanupTmps, DAY, fakeBuild, mode, PKG, run, temp } from './helpers.ts'

afterEach(cleanupTmps)
afterAll(cleanupFixtureHostKey)

describe('prepareBundle (the Air side)', () => {
  const NOW = Date.UTC(2026, 9, 10)

  test('names the bundle by its expiry and build id, says when it was prepared, and keeps it private', () => {
    const home = temp('summon-air-')
    const fb = fakeBuild(temp('summon-fb-'))
    const r = prepareBundle({ home, build: () => fb, now: NOW + 12 * 3_600_000 + 34 * 60_000 + 56_000 })
    const id = buildIdOf(fb.sha)
    const folder = `summon-nuance-bundle-20270108-${id}`
    expect(r.bundle).toBe(join(home, folder))
    expect([r.expiry, r.buildId, r.preparedAt]).toEqual(['20270108', id, '20261010123456'])
    expect(r.command).toBe(`bash ~/Downloads/${folder}/summon-install.sh`)
    expect(readdirSync(home).sort()).toEqual(['.ssh', folder])
    expect(readdirSync(r.bundle).sort()).toEqual(['MANIFEST.txt', 'summon-gatekeeper', 'summon-install.sh', 'summon-runner'])
    expect(mode(r.bundle)).toBe(0o700)
    expect(mode(join(home, '.ssh/summon'))).toBe(0o700)
    // B8: the expiry is recorded by pin-nuance, from what the installer actually put on Nuance, not here.
    expect(readdirSync(join(home, '.ssh/summon')).sort()).toEqual(['summon_nuance_ed25519', 'summon_nuance_ed25519.pub'])
    for (const f of ['summon_nuance_ed25519', 'summon_nuance_ed25519.pub']) expect([f, mode(join(home, '.ssh/summon', f)).toString(8)]).toEqual([f, '600'])
    for (const f of ['summon-install.sh', 'MANIFEST.txt']) expect([f, mode(join(r.bundle, f)).toString(8)]).toEqual([f, '600'])
    for (const f of ['summon-gatekeeper', 'summon-runner']) expect([f, mode(join(r.bundle, f)).toString(8)]).toEqual([f, '700'])
    expect(readFileSync(join(r.bundle, 'MANIFEST.txt'), 'utf8')).toBe(
      `build ${id}\nprepared 20261010123456\nsummon-gatekeeper ${fb.sha.gatekeeper}\nsummon-runner ${fb.sha.runner}\nkey summon-air expires 20270108\n`)
    expect(readFileSync(join(r.bundle, 'summon-install.sh'), 'utf8')).toContain("PREPARED_AT='20261010123456'")
    // What the script prints: the exact command for this bundle, and when its key expires.
    const text = bundleReadyText(r)
    expect(text).toContain(`bundle ready: ${r.bundle}`)
    expect(text).toContain(`  ${r.command}\n`)
    expect(text).toContain('the summon key expires 2027-01-08 (20270108)')
    expect(text).not.toContain('rm -rf')
  })

  test('the installer it writes records the same lines as MANIFEST.txt in INSTALLED', () => {
    const home = temp('summon-air-')
    const r = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-')) })
    const root = temp('summon-root-')
    expect(run(r.bundle, root).exitCode).toBe(0)
    expect(readFileSync(join(root, '.local/share/summon/INSTALLED'), 'utf8')).toBe(readFileSync(join(r.bundle, 'MANIFEST.txt'), 'utf8'))
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
    chmodSync(first.bundle, 0o755); chmodSync(join(first.bundle, 'summon-install.sh'), 0o644)
    const again = prepareBundle({ home, build: () => fb, now: NOW })
    expect(again.pubkey).toBe(first.pubkey)
    expect(again.bundle).toBe(first.bundle)
    expect(mode(first.bundle)).toBe(0o700)
    expect(mode(join(first.bundle, 'summon-install.sh'))).toBe(0o600)
  })

  test('a new build (even of the gatekeeper alone) or a later expiry gets a folder of its own', () => {
    const home = temp('summon-air-')
    const a = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-')), now: NOW })
    const b = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-'), ' v2', ''), now: NOW })
    const c = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-'), ' v2', ''), now: NOW + 7 * DAY })
    expect(a.sha.runner).toBe(b.sha.runner)
    expect(new Set([a.bundle, b.bundle, c.bundle]).size).toBe(3)
    expect(c.bundle).toContain('summon-nuance-bundle-20270115-')
  })

  test('B7: lists the older bundle folders and prints the command to remove them, removing none', () => {
    const home = temp('summon-air-')
    const a = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-')), now: NOW })
    const b = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-'), ' v2'), now: NOW + DAY })
    writeFileSync(join(home, 'summon-nuance-bundle-notes.txt'), 'a file, not a bundle folder')
    const c = prepareBundle({ home, build: () => fakeBuild(temp('summon-fb-'), ' v3'), now: NOW + 2 * DAY })
    expect(c.older).toEqual([a.bundle, b.bundle].sort())
    expect(bundleReadyText(c)).toContain(`rm -rf '${[a.bundle, b.bundle].sort().join("' '")}'`)
    for (const d of [a.bundle, b.bundle, c.bundle]) expect(existsSync(join(d, 'summon-install.sh'))).toBe(true)
  })
})

describe('writeSshConfig (pinning Nuance on the Air)', () => {
  const HK = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyExample root@Nuance'
  const dirIn = () => join(temp('summon-ssh-'), 'summon')
  const EXP = '20270108'

  test('B8: records the key expiry the installer printed, privately', () => {
    const dir = dirIn()
    writeSshConfig(dir, 'yu', HK, EXP)
    expect(readFileSync(join(dir, 'expiry'), 'utf8')).toBe('20270108\n')
    expect(mode(join(dir, 'expiry'))).toBe(0o600)
    chmodSync(join(dir, 'expiry'), 0o644)
    writeSshConfig(dir, 'yu', HK, '20270409')
    expect([readFileSync(join(dir, 'expiry'), 'utf8'), mode(join(dir, 'expiry'))]).toEqual(['20270409\n', 0o600])
  })

  test('B8: rejects an expiry that is not a YYYYMMDD date and writes nothing', () => {
    for (const expires of ['', '2027-01-08', '2027010', '202701080', '20271301', '20270230', '20270100', 'tomorrow', '20270108\nx']) {
      const dir = dirIn()
      expect(() => writeSshConfig(dir, 'yu', HK, expires)).toThrow('YYYYMMDD')
      expect(existsSync(dir)).toBe(false)
    }
  })

  test('writes the pinned known_hosts line and the exact config, privately', () => {
    const dir = dirIn()
    writeSshConfig(dir, 'yu', HK, EXP)
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
    writeSshConfig(dir, 'yu', HK, EXP)
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
    writeSshConfig(dir, 'yu', HK, EXP)
    chmodSync(dir, 0o755); chmodSync(join(dir, 'known_hosts'), 0o644); chmodSync(join(dir, 'config'), 0o644)
    writeSshConfig(dir, 'yu2', 'ssh-ed25519 AAAANEWKEY', EXP)
    expect(readFileSync(join(dir, 'known_hosts'), 'utf8')).toBe('summon-nuance ssh-ed25519 AAAANEWKEY\n')
    expect(readFileSync(join(dir, 'config'), 'utf8')).toContain('  User yu2\n')
    expect([mode(dir), mode(join(dir, 'known_hosts')), mode(join(dir, 'config'))]).toEqual([0o700, 0o600, 0o600])
  })

  test('rejects a bad user name and writes nothing', () => {
    for (const user of ['', 'yu name', 'yu;rm', '-oProxyCommand=x', 'yu\n', 'a'.repeat(33), 'yu\nProxyCommand evil']) {
      const dir = dirIn()
      expect(() => writeSshConfig(dir, user, HK, EXP)).toThrow('bad user name')
      expect(existsSync(dir)).toBe(false)
    }
  })

  test('rejects anything but a single ssh-ed25519 host key line and writes nothing', () => {
    for (const key of ['', 'ssh-ed25519', 'ssh-rsa AAAAB3NzaC1yc2E root@Nuance', 'ecdsa-sha2-nistp256 AAAAE2VjZHNh', 'ssh-ed25519 AA$A',
      'ssh-ed25519 AAAA\nProxyCommand evil', 'ssh-ed25519AAAA']) {
      const dir = dirIn()
      expect(() => writeSshConfig(dir, 'yu', key, EXP)).toThrow('ssh-ed25519 host key line')
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


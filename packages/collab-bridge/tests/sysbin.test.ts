import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, copyFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { knobInt, knobName, NEVER_REAL, overrideActive, PRODUCTION_BINS, systemBin } from '../src/sysbin.ts'
import { cleanupTmps, PKG, temp } from './helpers.ts'

afterEach(cleanupTmps)

/** An env with the override on for `home`, as a spawned test process gets it. */
const on = (home: string, extra: Record<string, string> = {}) => ({ HOME: home, COLLAB_BRIDGE_HOME_OVERRIDE: home, NODE_ENV: 'test', ...extra })

/** systemBin in a fresh bun with exactly `env`, from cwd / and with no bunfig: what it printed, or why it threw. */
function child(env: Record<string, string>, name: string): { code: number | null; out: string; err: string } {
  const script = `import { systemBin } from '${join(PKG, 'src', 'sysbin.ts')}'; console.log(systemBin('${name}'))`
  const p = Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', '-e', script], { cwd: '/', env })
  return { code: p.exitCode, out: p.stdout.toString().trim(), err: p.stderr.toString() }
}

describe('systemBin', () => {
  test('returns the knob under the override', () => {
    const h = temp('cb-sysbin-')
    expect(systemBin('git', on(h, { COLLAB_BRIDGE_BIN_GIT: '/opt/homebrew/bin/git' }))).toBe('/opt/homebrew/bin/git')
    expect(systemBin('ssh', on(h, { COLLAB_BRIDGE_BIN_SSH: join(h, 'ssh') }))).toBe(join(h, 'ssh'))
  })

  test('throws when a knob is missing under the override', () => {
    const h = temp('cb-sysbin-')
    expect(() => systemBin('git', on(h))).toThrow('systemBin: COLLAB_BRIDGE_BIN_GIT is not set under the test override')
    expect(() => systemBin('ssh', on(h, { COLLAB_BRIDGE_BIN_SSH: '' }))).toThrow('systemBin: COLLAB_BRIDGE_BIN_SSH is not set under the test override')
  })

  test('a relative knob is refused, so PATH can never pick the binary', () => {
    const h = temp('cb-sysbin-')
    expect(() => systemBin('ssh', on(h, { COLLAB_BRIDGE_BIN_SSH: 'ssh' }))).toThrow('systemBin: COLLAB_BRIDGE_BIN_SSH must be an absolute path')
  })

  test('refuses an ssh or launchctl knob that names the real binary', () => {
    const h = temp('cb-sysbin-')
    expect([...NEVER_REAL].sort()).toEqual(['launchctl', 'ssh'])
    expect(() => systemBin('ssh', on(h, { COLLAB_BRIDGE_BIN_SSH: '/usr/bin/ssh' }))).toThrow('systemBin: ssh knob names the real binary')
    const link = join(h, 'launchctl')
    symlinkSync('/bin/launchctl', link)
    expect(() => systemBin('launchctl', on(h, { COLLAB_BRIDGE_BIN_LAUNCHCTL: link }))).toThrow('systemBin: launchctl knob names the real binary')
    // The other knobs may name the real binaries: tests need real git upload-pack and real builds (P42).
    expect(systemBin('ps', on(h, { COLLAB_BRIDGE_BIN_PS: '/bin/ps' }))).toBe('/bin/ps')
  })

  test('a different real ssh or launchctl is refused too: a copy, another binary, or a link out of the test roots (Task 63 conformance-9-2)', () => {
    const h = temp('cb-sysbin-')
    // A copy of the real binary has another inode, so the same-file test alone lets it through; it is not a script stub.
    for (const [name, real] of [['ssh', '/usr/bin/ssh'], ['launchctl', '/bin/launchctl']] as const) {
      const copy = join(h, `${name}-copy`)
      copyFileSync(real, copy)
      chmodSync(copy, 0o755)
      expect(() => systemBin(name, on(h, { [knobName(name)]: copy }))).toThrow(`systemBin: ${name} knob is not a script stub`)
    }
    // Another real ssh on this Mac (Homebrew's, on many): a path outside the override home and the temp roots.
    expect(() => systemBin('ssh', on(h, { COLLAB_BRIDGE_BIN_SSH: '/bin/ls' }))).toThrow('systemBin: ssh knob lies outside the test roots')
    // And a link that sits in a temp root but leads out of it.
    const link = join(h, 'ssh-link')
    symlinkSync('/bin/ls', link)
    expect(() => systemBin('ssh', on(h, { COLLAB_BRIDGE_BIN_SSH: link }))).toThrow('systemBin: ssh knob lies outside the test roots')
    // A script stub in the override home or a temp root is what the suite uses, and passes; so does a path where nothing exists yet.
    const stub = join(h, 'ssh')
    writeFileSync(stub, '#!/bin/bash\nexit 255\n', { mode: 0o755 })
    expect(systemBin('ssh', on(h, { COLLAB_BRIDGE_BIN_SSH: stub }))).toBe(stub)
    expect(systemBin('launchctl', on(h, { COLLAB_BRIDGE_BIN_LAUNCHCTL: join(h, 'no-such-launchctl') }))).toBe(join(h, 'no-such-launchctl'))
    // The knobs that may name real binaries are not held to this (P42).
    expect(systemBin('git', on(h, { COLLAB_BRIDGE_BIN_GIT: '/bin/ls' }))).toBe('/bin/ls')
  })

  test('refuses under NODE_ENV=test without the override', () => {
    const h = temp('cb-sysbin-')
    const r = child({ HOME: h, PATH: '/usr/bin:/bin', NODE_ENV: 'test' }, 'git')
    expect(r.code).not.toBe(0)
    expect(r.out).toBe('')
    expect(r.err).toContain('systemBin: git refused under NODE_ENV=test without the override')
    expect(() => systemBin('ssh', { HOME: h, NODE_ENV: 'test' })).toThrow('systemBin: ssh refused under NODE_ENV=test without the override')
  })

  test('returns the production path outside tests', () => {
    const h = temp('cb-sysbin-')
    for (const name of ['ssh', 'launchctl', 'git', 'bun'] as const) {
      const r = child({ HOME: h, PATH: '/usr/bin:/bin' }, name)
      expect([name, r.code, r.out]).toEqual([name, 0, PRODUCTION_BINS[name]])
    }
    expect(PRODUCTION_BINS).toEqual({
      ssh: '/usr/bin/ssh', 'ssh-keygen': '/usr/bin/ssh-keygen', git: '/opt/homebrew/bin/git', launchctl: '/bin/launchctl',
      ps: '/bin/ps', zsh: '/bin/zsh', bun: '/Users/yuai/.bun/bin/bun', codesign: '/usr/bin/codesign', xcrun: '/usr/bin/xcrun',
      plutil: '/usr/bin/plutil', id: '/usr/bin/id',
    })
  })

  test('the override counts only when it equals HOME', () => {
    expect(overrideActive({ HOME: '/h', COLLAB_BRIDGE_HOME_OVERRIDE: '/h' })).toBe(true)
    expect(overrideActive({ HOME: '/h', COLLAB_BRIDGE_HOME_OVERRIDE: '/other' })).toBe(false)
    expect(overrideActive({ HOME: '', COLLAB_BRIDGE_HOME_OVERRIDE: '' })).toBe(false)
    expect(overrideActive({ COLLAB_BRIDGE_HOME_OVERRIDE: '/h' })).toBe(false)
    const mismatched = { HOME: '/h', COLLAB_BRIDGE_HOME_OVERRIDE: '/other', NODE_ENV: 'test', COLLAB_BRIDGE_BIN_GIT: '/x/git' }
    expect(() => systemBin('git', mismatched)).toThrow('systemBin: git refused under NODE_ENV=test without the override')
  })

  test('ssh-keygen resolves through COLLAB_BRIDGE_BIN_SSH_KEYGEN', () => {
    expect(knobName('ssh-keygen')).toBe('COLLAB_BRIDGE_BIN_SSH_KEYGEN')
    expect(knobName('launchctl')).toBe('COLLAB_BRIDGE_BIN_LAUNCHCTL')
    const h = temp('cb-sysbin-')
    expect(systemBin('ssh-keygen', on(h, { COLLAB_BRIDGE_BIN_SSH_KEYGEN: '/usr/bin/ssh-keygen' }))).toBe('/usr/bin/ssh-keygen')
  })

  test('knobInt reads COLLAB_BRIDGE_DROPIN_OWNER_UID only under the override', () => {
    const k = 'COLLAB_BRIDGE_DROPIN_OWNER_UID'
    expect(knobInt(k, on('/h', { [k]: '501' }))).toBe(501)
    expect(knobInt(k, on('/h', { [k]: '0' }))).toBe(0)
    expect(knobInt(k, { HOME: '/h', [k]: '501' })).toBeNull()
    expect(knobInt(k, on('/h'))).toBeNull()
    for (const bad of ['', '-1', '1.5', 'abc', '007', '99999999999']) expect([bad, knobInt(k, on('/h', { [k]: bad }))]).toEqual([bad, null])
  })
})

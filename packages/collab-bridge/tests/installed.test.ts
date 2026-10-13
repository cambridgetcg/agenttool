import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ResolvedGit } from '../src/nuance/git-resolve.ts'
import {
  dropinStat, parseInstalled, readInstalled, readShares, renderInstalled, summonKeySha256, writeShares, type InstalledInfo,
} from '../src/nuance/installed.ts'
import { nuancePaths } from '../src/paths.ts'
import { cleanupTmps, temp } from './helpers.ts'

afterEach(cleanupTmps)

const perm = (p: string) => statSync(p).mode & 0o777

const GIT: ResolvedGit = { path: '/Library/Developer/CommandLineTools/usr/bin/git', version: '2.39.5',
  sha256: '4c5ca299b5311572b4f948d11efd7c66dcadf30950fbf260688ee32f4a63f6a4', guard: true, apple: true }
const INFO: InstalledInfo = {
  device: 'nuance', build: '1a2b3c4d', prepared: '20261013120000', expiry: '20270111', binary_sha256: 'a'.repeat(64),
  tools_seed: 'b'.repeat(64), git: GIT, summon_key_sha256: 'c'.repeat(64), summon_dropin_stat: '16130 312 1791895693662 0 600',
  claude_version: '2.1.296 (Claude Code)', installed_at: '2026-10-13T12:00:00.000Z',
}
const TEXT = [
  'device nuance', 'build 1a2b3c4d', 'prepared 20261013120000', 'expiry 20270111', `binary_sha256 ${'a'.repeat(64)}`,
  `tools_seed ${'b'.repeat(64)}`, 'git_path /Library/Developer/CommandLineTools/usr/bin/git', 'git_version 2.39.5',
  'git_sha256 4c5ca299b5311572b4f948d11efd7c66dcadf30950fbf260688ee32f4a63f6a4', 'git_guard yes', 'git_apple yes',
  `summon_key_sha256 ${'c'.repeat(64)}`, 'summon_dropin_stat 16130 312 1791895693662 0 600', 'claude_version 2.1.296 (Claude Code)',
  'installed_at 2026-10-13T12:00:00.000Z', '',
].join('\n')

describe('INSTALLED', () => {
  test('INSTALLED round-trips and refuses a missing key', () => {
    expect(renderInstalled(INFO)).toBe(TEXT)
    expect(parseInstalled(TEXT)).toEqual(INFO)
    const noClaude = { ...INFO, claude_version: null }
    expect(renderInstalled(noClaude)).toContain('\nclaude_version -\n')
    expect(parseInstalled(renderInstalled(noClaude))).toEqual(noClaude)
    const lines = TEXT.split('\n').filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      const without = lines.filter((_, j) => j !== i).join('\n') + '\n'
      expect([lines[i], parseInstalled(without)]).toEqual([lines[i], null])
    }
    expect(parseInstalled(TEXT + 'device nuance\n')).toBeNull()                     // a repeated key
    expect(parseInstalled(TEXT.replace('git_guard yes', 'git_guard maybe'))).toBeNull()
    expect(parseInstalled(TEXT.replace('prepared 20261013120000', 'prepared 2026-10-13'))).toBeNull()
    expect(parseInstalled(TEXT + 'a_later_key value\n')).toEqual(INFO)               // unknown keys are ignored
    const p = nuancePaths(temp('cb-inst-'))
    expect(readInstalled(p)).toBeNull()
    mkdirSync(dirname(p.installed), { recursive: true })
    writeFileSync(p.installed, TEXT)
    expect(readInstalled(p)).toEqual(INFO)
  })
  test('a line named like an inherited property is an unknown key, not a throw', () => {
    // `k in FORMATS` also sees Object.prototype, so these names used to pass the guard and then throw a TypeError.
    for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
      const extra = `${name} foo\n`
      expect(() => parseInstalled(TEXT + extra)).not.toThrow()
      expect(parseInstalled(TEXT + extra)).toEqual(parseInstalled(TEXT))
      expect(parseInstalled(extra + TEXT)).toEqual(INFO)
    }
    expect(parseInstalled('constructor foo\n' + TEXT.replace('device nuance', 'toString x\ndevice nuance'))).toEqual(INFO)
  })
  test('renderInstalled refuses a value that is not one printable line', () => {
    expect(() => renderInstalled({ ...INFO, claude_version: '2.1.296\nbuild 00000000' })).toThrow('INSTALLED: claude_version is malformed')
    expect(() => renderInstalled({ ...INFO, build: 'XYZ' })).toThrow('INSTALLED: build is malformed')
    expect(() => renderInstalled({ ...INFO, git: { ...GIT, path: 'git' } })).toThrow('INSTALLED: git_path is malformed')
  })
})

describe('shares.json', () => {
  test('shares.json round-trips at 0600 in a 0700 dir and a malformed file reads as null', () => {
    const p = nuancePaths(temp('cb-shares-'))
    expect(readShares(p)).toBeNull()
    const shares = [{ realpath: '/Users/macair/Projects/collab-trial', gitdir: '/Users/macair/Projects/collab-trial/.git' }]
    writeShares(p, shares)
    expect(readShares(p)).toEqual(shares)
    expect(JSON.parse(readFileSync(p.shares, 'utf8'))).toEqual({ v: 1, shares })
    expect(perm(p.shares)).toBe(0o600)
    expect(perm(dirname(p.shares))).toBe(0o700)
    for (const bad of ['{"v":2,"shares":[]}', 'not json', '{"v":1,"shares":[{"realpath":"relative","gitdir":"/x/.git"}]}',
      `{"v":1,"shares":[{"realpath":"/it's","gitdir":"/x/.git"}]}`, `{"v":1,"shares":[{"realpath":"/${'a'.repeat(1019)}","gitdir":"/x/.git"}]}`]) {
      writeFileSync(p.shares, bad)
      expect([bad.slice(0, 40), readShares(p)]).toEqual([bad.slice(0, 40), null])
    }
    expect(() => writeShares(p, [{ realpath: '/a!b', gitdir: '/a!b/.git' }])).toThrow('shares.json: share /a!b cannot be served')
    expect(() => writeShares(p, [{ realpath: '/a/../b', gitdir: '/b/.git' }])).toThrow('shares.json: share /a/../b cannot be served')
    // A space is a plain path character: the gate's form carries it inside its single quotes (§5.2).
    const spaced = [{ realpath: '/a/my trial', gitdir: '/a/my trial/.git' }]
    writeShares(p, spaced)
    expect(readShares(p)).toEqual(spaced)
  })
})

describe('Summon baselines', () => {
  test('the summon key hash covers only summon-air lines and ignores order', () => {
    const summon1 = 'restrict,from="192.168.50.0/24",expiry-time="20270110",command="/Users/macair/.local/share/summon/summon-gatekeeper" ssh-ed25519 AAAA1 summon-air'
    const summon2 = 'restrict,from="192.168.50.0/24",expiry-time="20270110",command="/x" ssh-ed25519 AAAA2 summon-air'
    const collab = 'restrict,command="/Users/macair/.local/share/collab-bridge/collab-bridge gate" ssh-ed25519 BBBB collab-air'
    const other = 'ssh-ed25519 CCCC macair@nuance'
    const expected = createHash('sha256').update([summon1, summon2].sort().join('\n')).digest('hex')
    expect(summonKeySha256([other, summon2, collab, summon1, ''].join('\n'))).toBe(expected)
    expect(summonKeySha256([summon1, summon2, other].join('\n'))).toBe(expected)
    expect(summonKeySha256([summon1, summon2, collab.replace('BBBB', 'DDDD')].join('\n'))).toBe(expected)
    expect(summonKeySha256([summon1.replace('20270110', '20270111'), summon2].join('\n'))).not.toBe(expected)
    expect(summonKeySha256(other)).toBe(createHash('sha256').update('').digest('hex'))
  })
  test('the drop-in stat changes when the file is replaced', () => {
    const dir = temp('cb-dropin-')
    const d = join(dir, '010-summon.conf')
    writeFileSync(d, 'PasswordAuthentication no\n', { mode: 0o600 })
    const first = dropinStat(d)!
    expect(first).toMatch(new RegExp(`^\\d+ 26 \\d+ ${process.getuid!()} 600$`))
    expect(dropinStat(d)).toBe(first)
    writeFileSync(join(dir, 'new'), 'PasswordAuthentication no\n', { mode: 0o600 })
    renameSync(join(dir, 'new'), d)                          // same bytes, a new file: what an installer's mv does
    const second = dropinStat(d)!
    expect(second).not.toBe(first)
    utimesSync(d, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    expect(dropinStat(d)).not.toBe(second)
    const third = dropinStat(d)
    chmodSync(d, 0o644)
    expect(dropinStat(d)).not.toBe(third)
    expect(dropinStat(join(dir, 'missing'))).toBeNull()
  })
})

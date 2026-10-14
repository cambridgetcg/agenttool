import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describePaths, FingerprintError, restoreBaseline, takeBaseline, type ListDir } from '../src/fingerprint.ts'
import { cleanupTmps, fakeGitRoot, trackTmp } from './helpers.ts'

afterEach(cleanupTmps)

const dirOf = () => trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-fp-'))))
const put = (root: string, rel: string, text: string, mode = 0o644) => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), text, { mode }); chmodSync(join(root, rel), mode)
}
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8')
const modeOf = (root: string, rel: string) => statSync(join(root, rel)).mode & 0o777
/** A repository root holding one of each watched file. */
function repo() {
  const root = fakeGitRoot(dirOf())
  put(root, '.git/config', '[core]\n\tbare = false\n')
  put(root, '.git/hooks/pre-commit.sample', '#!/bin/sh\nexit 0\n', 0o755)
  put(root, '.git/hooks/commit-msg', '#!/bin/sh\nexit 0\n', 0o755)
  put(root, '.git/info/exclude', '# excludes\n/.summon-tmp/\n')
  put(root, '.gitattributes', '*.png binary\n')
  put(root, '.gitmodules', '[submodule "a"]\n\tpath = a\n')
  put(root, 'src/app.ts', 'export {}\n') // not watched
  return root
}
const keysOf = (b: ReturnType<typeof takeBaseline>) => [...b.files.keys()].sort()

describe('takeBaseline: what is watched, and under every case spelling', () => {
  test('the config, every hook, everything under info, and .gitattributes and .gitmodules in the root, and nothing else', () => {
    const root = repo()
    put(root, '.git/HEAD.bak', 'x'); put(root, '.git/config.worktree', 'x'); put(root, '.gitignore', 'x'); put(root, 'sub/.gitattributes', 'x')
    expect(keysOf(takeBaseline(root))).toEqual(['.git/config', '.git/hooks/commit-msg', '.git/hooks/pre-commit.sample', '.git/info/exclude', '.gitattributes', '.gitmodules'])
  })
  test('walks nested directories under hooks and info', () => {
    const root = repo()
    put(root, '.git/hooks/pre-push.d/10-check', 'x', 0o755); put(root, '.git/info/deep/er/file', 'x')
    expect(keysOf(takeBaseline(root))).toEqual(expect.arrayContaining(['.git/hooks/pre-push.d/10-check', '.git/info/deep/er/file']))
  })
  test('finds every case spelling the listing shows: .Git/Config, .Git/HOOKS/..., .Git/Info/..., .GitAttributes, .GITMODULES', () => {
    const root = dirOf()
    put(root, '.Git/Config', 'c'); put(root, '.Git/HOOKS/Pre-Commit', 'h', 0o755); put(root, '.Git/Info/exclude', 'e')
    put(root, '.GitAttributes', 'a'); put(root, '.GITMODULES', 'm'); put(root, '.Git/other', 'o')
    expect(keysOf(takeBaseline(root))).toEqual(['.GITMODULES', '.Git/Config', '.Git/HOOKS/Pre-Commit', '.Git/Info/exclude', '.GitAttributes'])
  })
  test('the listing is a parameter: only the root, .git, hooks and info are listed, through it, in the spelling it returns', () => {
    const root = repo(); const asked: string[] = []
    const list: ListDir = (d) => { asked.push(d.slice(root.length) || '/'); return readdirSync(d) }
    takeBaseline(root, list)
    expect(asked.sort()).toEqual(['/', '/.git', '/.git/hooks', '/.git/info'])
  })
  test('a listing that shows a case spelling the disk answers to is followed (the volume ignores case)', () => {
    const root = repo()
    const probe = join(root, '.GITATTRIBUTES')
    if (!existsSync(probe)) return // a case-sensitive volume: the on-disk spelling test above covers the matching
    const list: ListDir = (d) => readdirSync(d).map((n) => (n === '.gitattributes' ? '.GitAttributes' : n))
    expect(keysOf(takeBaseline(root, list))).toContain('.GitAttributes')
  })
  test('a missing .git, hooks or info is simply absent, not an error', () => {
    expect(keysOf(takeBaseline(dirOf()))).toEqual([])
    expect(keysOf(takeBaseline(fakeGitRoot(dirOf())))).toEqual([])
  })
  test('a symlink among the watched files is a watched entry, and is not followed', () => {
    const root = repo(); const outside = dirOf(); put(outside, 'real', 'secret')
    symlinkSync(join(outside, 'real'), join(root, '.git/hooks/link'))
    symlinkSync(outside, join(root, '.git/info/dirlink'))
    expect(keysOf(takeBaseline(root))).toEqual(expect.arrayContaining(['.git/hooks/link', '.git/info/dirlink']))
    expect(keysOf(takeBaseline(root)).some((k) => k.includes('dirlink/'))).toBe(false)
  })
  test('refuses (fail closed) a watched file that is too large to keep, and a listing that fails', () => {
    const root = repo()
    put(root, '.git/hooks/big', 'x'.repeat(9 * 1024 * 1024))
    expect(() => takeBaseline(root)).toThrow(FingerprintError)
    rmSync(join(root, '.git/hooks/big'))
    const broken: ListDir = (d) => { if (d.endsWith('/hooks')) throw Object.assign(new Error('no'), { code: 'EACCES' }); return readdirSync(d) }
    expect(() => takeBaseline(root, broken)).toThrow(FingerprintError)
  })
})

describe('restoreBaseline: whatever changed, appeared or vanished is put back', () => {
  test('nothing changed: nothing reported, nothing written', () => {
    const root = repo(); const base = takeBaseline(root)
    const before = statSync(join(root, '.git/config')).mtimeMs
    expect(restoreBaseline(root, base)).toEqual({ changed: [], failed: [] })
    expect(statSync(join(root, '.git/config')).mtimeMs).toBe(before)
  })
  test('edited contents are rewritten', () => {
    const root = repo(); const base = takeBaseline(root)
    appendFileSync(join(root, '.git/config'), '[core]\n\tpager = evil\n'); put(root, '.gitmodules', 'changed')
    expect(restoreBaseline(root, base)).toEqual({ changed: ['.git/config', '.gitmodules'], failed: [] })
    expect(read(root, '.git/config')).toBe('[core]\n\tbare = false\n')
    expect(read(root, '.gitmodules')).toBe('[submodule "a"]\n\tpath = a\n')
  })
  test('a changed mode alone is a change (a hook made executable), and the mode is put back', () => {
    const root = repo(); const base = takeBaseline(root)
    chmodSync(join(root, '.git/hooks/pre-commit.sample'), 0o644); chmodSync(join(root, '.git/config'), 0o666)
    expect(restoreBaseline(root, base).changed).toEqual(['.git/config', '.git/hooks/pre-commit.sample'])
    expect([modeOf(root, '.git/hooks/pre-commit.sample'), modeOf(root, '.git/config')]).toEqual([0o755, 0o644])
  })
  test('files that appeared are removed: a hook, a file in a new subdirectory (and the empty directory), .GitAttributes', () => {
    const root = repo(); const base = takeBaseline(root)
    put(root, '.git/hooks/pre-commit', '#!/bin/sh\nevil\n', 0o755); put(root, '.git/info/new/dir/x', 'x'); put(root, '.git/info/attributes', '* filter=evil\n')
    const out = restoreBaseline(root, base)
    expect(out).toEqual({ changed: ['.git/hooks/pre-commit', '.git/info/attributes', '.git/info/new/dir/x'], failed: [] })
    expect(readdirSync(join(root, '.git/hooks')).sort()).toEqual(['commit-msg', 'pre-commit.sample'])
    expect(readdirSync(join(root, '.git/info'))).toEqual(['exclude'])
  })
  test('a watched file that did not exist before and appears in the root is removed: .GitAttributes next to none', () => {
    const root = fakeGitRoot(dirOf()); const base = takeBaseline(root)
    put(root, '.GitAttributes', '* filter=evil\n'); put(root, '.gitmodules', 'x')
    expect(restoreBaseline(root, base)).toEqual({ changed: ['.GitAttributes', '.gitmodules'], failed: [] })
    expect(readdirSync(root).filter((n) => n.toLowerCase().startsWith('.git')).sort()).toEqual(['.git'])
  })
  test('vanished files come back with their contents and mode, and so does a vanished directory tree', () => {
    const root = repo(); const base = takeBaseline(root)
    rmSync(join(root, '.git/info/exclude')); rmSync(join(root, '.git/hooks'), { recursive: true }); rmSync(join(root, '.gitattributes'))
    const out = restoreBaseline(root, base)
    expect(out.changed).toEqual(['.git/hooks/commit-msg', '.git/hooks/pre-commit.sample', '.git/info/exclude', '.gitattributes'])
    expect(out.failed).toEqual([])
    expect(read(root, '.git/info/exclude')).toBe('# excludes\n/.summon-tmp/\n')
    expect(read(root, '.git/hooks/commit-msg')).toBe('#!/bin/sh\nexit 0\n')
    expect(modeOf(root, '.git/hooks/commit-msg')).toBe(0o755)
    expect(read(root, '.gitattributes')).toBe('*.png binary\n')
  })
  test('an empty watched directory that vanished is recreated too', () => {
    const root = repo(); mkdirSync(join(root, '.git/info/empty')); const base = takeBaseline(root)
    rmSync(join(root, '.git/info/empty'), { recursive: true })
    restoreBaseline(root, base)
    expect(lstatSync(join(root, '.git/info/empty')).isDirectory()).toBe(true)
  })
  test('a case-only rename (exclude -> Exclude) is a vanished file and an appeared one, and ends as it began', () => {
    const root = repo(); const base = takeBaseline(root)
    renameSync(join(root, '.git/info/exclude'), join(root, '.git/info/Exclude'))
    const out = restoreBaseline(root, base)
    expect(out.changed.sort()).toEqual(['.git/info/Exclude', '.git/info/exclude'])
    expect(readdirSync(join(root, '.git/info'))).toEqual(['exclude'])
    expect(read(root, '.git/info/exclude')).toBe('# excludes\n/.summon-tmp/\n')
  })
  test('a watched directory swapped for a symlink: the link goes, the directory returns, and nothing is written through the link', () => {
    const root = repo(); const base = takeBaseline(root); const outside = dirOf()
    put(outside, 'keep', 'k')
    rmSync(join(root, '.git/info'), { recursive: true }); symlinkSync(outside, join(root, '.git/info'))
    restoreBaseline(root, base)
    expect(lstatSync(join(root, '.git/info')).isSymbolicLink()).toBe(false)
    expect(read(root, '.git/info/exclude')).toBe('# excludes\n/.summon-tmp/\n')
    expect(readdirSync(outside)).toEqual(['keep'])
  })
  test('a watched file swapped for a symlink to somewhere else becomes the original file again, and the target is untouched', () => {
    const root = repo(); const base = takeBaseline(root); const outside = dirOf()
    put(outside, 'target', 'not yours')
    rmSync(join(root, '.git/config')); symlinkSync(join(outside, 'target'), join(root, '.git/config'))
    const out = restoreBaseline(root, base)
    expect(out).toEqual({ changed: ['.git/config'], failed: [] })
    expect(lstatSync(join(root, '.git/config')).isSymbolicLink()).toBe(false)
    expect(read(root, '.git/config')).toBe('[core]\n\tbare = false\n')
    expect(read(outside, 'target')).toBe('not yours')
  })
  test('a symlink that was there before is part of the baseline, and a changed target is put back', () => {
    const root = repo(); const outside = dirOf()
    symlinkSync('/usr/bin/true', join(root, '.git/hooks/pre-push'))
    const base = takeBaseline(root)
    rmSync(join(root, '.git/hooks/pre-push')); symlinkSync(join(outside, 'x'), join(root, '.git/hooks/pre-push'))
    expect(restoreBaseline(root, base).changed).toEqual(['.git/hooks/pre-push'])
    expect(lstatSync(join(root, '.git/hooks/pre-push')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(root, '.git/hooks/pre-push'))).toBe('/usr/bin/true')
  })
  test('a named pipe planted in hooks is removed without being opened (it would block a read)', () => {
    const root = repo(); const base = takeBaseline(root)
    expect(Bun.spawnSync(['/usr/bin/mkfifo', join(root, '.git/hooks/pre-commit')]).exitCode).toBe(0)
    expect(restoreBaseline(root, base)).toEqual({ changed: ['.git/hooks/pre-commit'], failed: [] })
    expect(existsSync(join(root, '.git/hooks/pre-commit'))).toBe(false)
  })
  test('a directory where a watched file was: removed, and the file returns', () => {
    const root = repo(); const base = takeBaseline(root)
    rmSync(join(root, '.git/config')); mkdirSync(join(root, '.git/config')); put(root, '.git/config/inner', 'x')
    restoreBaseline(root, base)
    expect(read(root, '.git/config')).toBe('[core]\n\tbare = false\n')
  })
  test('.git itself gone or swapped for a link is not rebuilt: it is reported as not restored', () => {
    const root = repo(); const base = takeBaseline(root); const outside = dirOf()
    rmSync(join(root, '.git'), { recursive: true }); symlinkSync(outside, join(root, '.git'))
    const out = restoreBaseline(root, base)
    expect(out.failed).toContain('.git')
    expect(lstatSync(join(root, '.git')).isSymbolicLink()).toBe(true) // left as found
    expect(readdirSync(outside)).toEqual([])
    expect(out.changed).toContain('.git/config')
  })
  test('a listing that fails after the job is reported as not restored, not thrown', () => {
    const root = repo(); const base = takeBaseline(root)
    const out = restoreBaseline(root, base, () => { throw Object.assign(new Error('x'), { code: 'EACCES' }) })
    expect(out.failed.length).toBeGreaterThan(0)
  })
  test('a path that cannot be restored is in failed and the rest are still restored', () => {
    const root = repo(); const base = takeBaseline(root)
    appendFileSync(join(root, '.git/config'), 'x'); appendFileSync(join(root, '.gitmodules'), 'x')
    // An immutable file cannot be replaced, even by its owner: the one failure that needs no second user.
    expect(Bun.spawnSync(['/usr/bin/chflags', 'uchg', join(root, '.git/config')]).exitCode).toBe(0)
    try {
      const out = restoreBaseline(root, base)
      expect(out).toEqual({ changed: ['.git/config', '.gitmodules'], failed: ['.git/config'] })
      expect(read(root, '.gitmodules')).toBe('[submodule "a"]\n\tpath = a\n')
    } finally { Bun.spawnSync(['/usr/bin/chflags', 'nouchg', join(root, '.git/config')]) }
  })
})

describe('describePaths: the first line of a result, safe to print', () => {
  test('sorted and comma separated', () => {
    expect(describePaths(['.git/hooks/x', '.git/config'])).toBe('.git/config, .git/hooks/x')
  })
  test('control characters in a name are escaped, so one name can never make a second line', () => {
    expect(describePaths(['.git/hooks/a\nb', 'c\u001b[2Jd'])).toBe('.git/hooks/a\\x0ab, c\\x1b[2Jd')
  })
  test('twenty paths at most are named, the rest are counted', () => {
    const many = Array.from({ length: 25 }, (_, i) => `.git/hooks/h${String(i).padStart(2, '0')}`)
    const text = describePaths(many)
    expect(text.split(', ')).toHaveLength(21)
    expect(text.endsWith('and 5 more')).toBe(true)
  })
})

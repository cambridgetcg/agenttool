import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { checkBaseline, compareBaseline, describePaths, FingerprintError, gitlinkPaths, parseBaseline, serializeBaseline, takeBaseline, type ListDir } from '../src/fingerprint.ts'
import { cleanupTmps, fakeGitRoot, trackTmp } from './helpers.ts'

afterEach(cleanupTmps)

// Ruling S8: the guard detects and blocks, it never repairs. Everything below compares by lstat and sha256; every test that finds a change also
// shows that the folder was left exactly as the job left it (inventory() before and after), because writing into the folder is what went wrong.

const dirOf = () => trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-fp-'))))
const put = (root: string, rel: string, text: string, mode = 0o644) => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), text, { mode }); chmodSync(join(root, rel), mode)
}
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8')
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
/** Every path under root with what can be seen of it: type, mode, size, mtime and contents. What a repair would change shows up as a difference. */
function inventory(root: string, rel = '', out: Record<string, string> = {}): Record<string, string> {
  const abs = rel ? join(root, rel) : root
  let st
  try { st = lstatSync(abs) } catch { out[rel] = 'lstat denied'; return out }
  if (st.isDirectory()) {
    out[rel || '.'] = `dir ${(st.mode & 0o7777).toString(8)} ${st.mtimeMs}`
    let names: string[] = []
    try { names = readdirSync(abs).sort() } catch { out[`${rel}/`] = 'unlistable'; return out }
    for (const n of names) inventory(root, rel ? `${rel}/${n}` : n, out)
  } else if (st.isSymbolicLink()) out[rel] = `link ${readlinkSync(abs)}`
  else if (st.isFile()) { let c = 'unreadable'; try { c = readFileSync(abs, 'utf8') } catch { /* stays so */ } out[rel] = `file ${(st.mode & 0o7777).toString(8)} ${st.size} ${st.mtimeMs} ${c}` }
  else out[rel] = `special ${(st.mode & 0o170000).toString(8)}`
  return out
}
/** The changed paths, and proof that finding them left the folder exactly as it was. */
function detect(root: string, base: ReturnType<typeof takeBaseline>, list?: ListDir): string[] {
  const before = inventory(root)
  const out = compareBaseline(root, base, list)
  expect(inventory(root)).toEqual(before)
  return out
}

describe('takeBaseline: what is watched, and under every case spelling (Ruling S9: the root .git only)', () => {
  test('the config, every hook, everything under info, and .gitattributes and .gitmodules in the root, and nothing else', () => {
    const root = repo()
    put(root, '.git/HEAD.bak', 'x'); put(root, '.gitignore', 'x'); put(root, 'sub/.gitattributes', 'x'); put(root, '.git/index', 'x'); put(root, '.git/refs/heads/main', 'x')
    expect(keysOf(takeBaseline(root))).toEqual(['.git/config', '.git/hooks/commit-msg', '.git/hooks/pre-commit.sample', '.git/info/exclude', '.gitattributes', '.gitmodules'])
  })
  test('the two files that send git to other configuration: .git/commondir and .git/config.worktree', () => {
    const root = repo()
    put(root, '.git/commondir', '../.x\n'); put(root, '.git/config.worktree', '[core]\n\tpager = x\n')
    expect(keysOf(takeBaseline(root))).toEqual(['.git/commondir', '.git/config', '.git/config.worktree', '.git/hooks/commit-msg', '.git/hooks/pre-commit.sample', '.git/info/exclude', '.gitattributes', '.gitmodules'])
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
  test('the listing is a parameter, and only the root, .git, hooks and info are listed through it: never objects, refs, logs or modules', () => {
    const root = repo(); const asked: string[] = []
    for (const d of ['objects/pack', 'refs/heads', 'logs/refs', 'modules/a/objects']) mkdirSync(join(root, '.git', d), { recursive: true })
    put(root, '.git/modules/a/config', 'c'); put(root, '.git/logs/HEAD', 'l')
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
  test('a listing that fails refuses the baseline (the job must not start unwatched), and so does a path that cannot be read', () => {
    const root = repo()
    const broken: ListDir = (d) => { if (d.endsWith('/hooks')) throw Object.assign(new Error('no'), { code: 'EACCES' }); return readdirSync(d) }
    expect(() => takeBaseline(root, broken)).toThrow(FingerprintError)
    chmodSync(join(root, '.git/config'), 0o000)
    try { expect(() => takeBaseline(root)).toThrow(FingerprintError) } finally { chmodSync(join(root, '.git/config'), 0o644) }
  })
  test('nothing is kept but what a comparison needs: a hash, a size and a mode, never the contents (a .git/config can hold credentials)', () => {
    const root = repo(); put(root, '.git/config', '[url "https://user:hunter2@example.com/"]\n')
    const base = takeBaseline(root)
    for (const e of base.files.values()) expect(Object.keys(e).sort()).toEqual(['kind', 'mode', 'sha', 'size'])
    const json = JSON.stringify(serializeBaseline(base))
    expect(json).not.toContain('hunter2')
    expect(json).not.toContain(Buffer.from('hunter2').toString('base64').slice(0, 6))
  })
  test('a large watched file is hashed, not refused: nothing is held in memory any more', () => {
    const root = repo(); put(root, '.git/hooks/big', 'x'.repeat(9 * 1024 * 1024))
    const base = takeBaseline(root)
    expect(base.files.get('.git/hooks/big')?.size).toBe(9 * 1024 * 1024)
    expect(detect(root, base)).toEqual([])
  })
})

describe('takeBaseline: .git entries below the root (Ruling S9)', () => {
  test('the nested ones are recorded: a directory, a gitfile and a link, at any depth, in any case, and the root .git is not one of them', () => {
    const root = repo(); const outside = dirOf()
    mkdirSync(join(root, 'vendor/lib/.git'), { recursive: true }); put(root, 'tools/x/.git', 'gitdir: ../../.git/modules/x\n')
    mkdirSync(join(root, 'a')); symlinkSync(outside, join(root, 'a/.Git'))
    mkdirSync(join(root, 'deep/er/.GIT'), { recursive: true })
    expect([...takeBaseline(root).nested].sort()).toEqual(['a/.Git', 'deep/er/.GIT', 'tools/x/.git', 'vendor/lib/.git'])
  })
  test('node_modules is not entered, at any depth; neither is the root .summon-tmp (the job\'s own temp directory); a nested .git is not entered either', () => {
    const root = repo()
    mkdirSync(join(root, 'node_modules/pkg/.git'), { recursive: true }); mkdirSync(join(root, 'sub/node_modules/pkg/.git'), { recursive: true })
    mkdirSync(join(root, '.summon-tmp/smn_x/repo/.git'), { recursive: true }); mkdirSync(join(root, 'sub/.git/modules/y/.git'), { recursive: true })
    mkdirSync(join(root, 'sub/.summon-tmp/.git'), { recursive: true }) // only the root one is the runner's
    expect([...takeBaseline(root).nested].sort()).toEqual(['sub/.git', 'sub/.summon-tmp/.git'])
  })
  test('a link to a directory is not followed', () => {
    const root = repo(); const outside = dirOf(); mkdirSync(join(outside, '.git'))
    symlinkSync(outside, join(root, 'link'))
    expect([...takeBaseline(root).nested]).toEqual([])
  })
  test('a folder that cannot be listed refuses the baseline, and so does a walk past its limits (the job does not start unwatched)', () => {
    const root = repo(); mkdirSync(join(root, 'locked/inner'), { recursive: true }); chmodSync(join(root, 'locked'), 0o000)
    try { expect(() => takeBaseline(root)).toThrow(FingerprintError) } finally { chmodSync(join(root, 'locked'), 0o755) }
    const big = repo(); for (let i = 0; i < 12; i++) put(big, `many/f${i}`, 'x')
    expect(() => takeBaseline(big, undefined, { entries: 10, depth: 8 })).toThrow(FingerprintError)
    expect(() => takeBaseline(big, undefined, { entries: 1000, depth: 8 })).not.toThrow()
    const deep = repo(); mkdirSync(join(deep, 'a/b/c/d/e'), { recursive: true })
    expect(() => takeBaseline(deep, undefined, { entries: 1000, depth: 3 })).toThrow(FingerprintError)
  })
})

describe('compareBaseline: whatever changed, appeared or vanished is found, and nothing is put back', () => {
  test('nothing changed: nothing reported', () => {
    const root = repo()
    expect(detect(root, takeBaseline(root))).toEqual([])
  })
  test('edited contents are found, and stay as the job left them', () => {
    const root = repo(); const base = takeBaseline(root)
    appendFileSync(join(root, '.git/config'), '[core]\n\tpager = evil\n'); put(root, '.gitmodules', 'changed')
    expect(detect(root, base)).toEqual(['.git/config', '.gitmodules'])
    expect(read(root, '.git/config')).toContain('pager = evil')
    expect(read(root, '.gitmodules')).toBe('changed')
  })
  test('the contents are compared by sha256, not by size or time: the same size, the same mtime, one byte different', () => {
    const root = repo(); const base = takeBaseline(root)
    const p = join(root, '.git/config'); const was = statSync(p)
    writeFileSync(p, read(root, '.git/config').replace('false', 'fals3')); utimesSync(p, was.atime, was.mtime)
    expect(statSync(p).size).toBe(was.size)
    expect(statSync(p).mtime.getTime()).toBe(was.mtime.getTime())
    expect(compareBaseline(root, base)).toEqual(['.git/config'])
  })
  test('a changed mode alone is a change (a hook made executable)', () => {
    const root = repo(); const base = takeBaseline(root)
    chmodSync(join(root, '.git/hooks/pre-commit.sample'), 0o644); chmodSync(join(root, '.git/config'), 0o666)
    expect(detect(root, base)).toEqual(['.git/config', '.git/hooks/pre-commit.sample'])
  })
  test('files that appeared are found: a hook, a file in a new subdirectory (the directory is named, not entered), .GitAttributes', () => {
    const root = repo(); const base = takeBaseline(root)
    put(root, '.git/hooks/pre-commit', '#!/bin/sh\nevil\n', 0o755); put(root, '.git/info/new/dir/x', 'x'); put(root, '.git/info/attributes', '* filter=evil\n')
    expect(detect(root, base)).toEqual(['.git/hooks/pre-commit', '.git/info/attributes', '.git/info/new'])
    expect(existsSync(join(root, '.git/hooks/pre-commit'))).toBe(true)
  })
  test('a watched file that did not exist before and appears in the root is found: .GitAttributes next to none', () => {
    const root = fakeGitRoot(dirOf()); const base = takeBaseline(root)
    put(root, '.GitAttributes', '* filter=evil\n'); put(root, '.gitmodules', 'x')
    expect(detect(root, base)).toEqual(['.GitAttributes', '.gitmodules'])
  })
  test('vanished files are found, and so is a vanished directory tree', () => {
    const root = repo(); const base = takeBaseline(root)
    rmSync(join(root, '.git/info/exclude')); rmSync(join(root, '.git/hooks'), { recursive: true }); rmSync(join(root, '.gitattributes'))
    expect(detect(root, base)).toEqual(['.git/hooks', '.git/hooks/commit-msg', '.git/hooks/pre-commit.sample', '.git/info/exclude', '.gitattributes'])
    expect(existsSync(join(root, '.git/hooks'))).toBe(false)
  })
  test('an empty watched directory that vanished is found too', () => {
    const root = repo(); mkdirSync(join(root, '.git/info/empty')); const base = takeBaseline(root)
    rmSync(join(root, '.git/info/empty'), { recursive: true })
    expect(detect(root, base)).toEqual(['.git/info/empty'])
  })
  test('a case-only rename (exclude -> Exclude) is a vanished file and an appeared one', () => {
    const root = repo(); const base = takeBaseline(root)
    renameSync(join(root, '.git/info/exclude'), join(root, '.git/info/Exclude'))
    expect(detect(root, base)).toEqual(['.git/info/Exclude', '.git/info/exclude'])
  })
  test('a watched directory swapped for a symlink is found, and the link is not followed', () => {
    const root = repo(); const base = takeBaseline(root); const outside = dirOf()
    put(outside, 'keep', 'k')
    rmSync(join(root, '.git/info'), { recursive: true }); symlinkSync(outside, join(root, '.git/info'))
    expect(detect(root, base)).toEqual(['.git/info', '.git/info/exclude'])
    expect(lstatSync(join(root, '.git/info')).isSymbolicLink()).toBe(true)
    expect(readdirSync(outside)).toEqual(['keep'])
  })
  test('a watched file swapped for a symlink to somewhere else is found, and the target is untouched', () => {
    const root = repo(); const base = takeBaseline(root); const outside = dirOf()
    put(outside, 'target', 'not yours')
    rmSync(join(root, '.git/config')); symlinkSync(join(outside, 'target'), join(root, '.git/config'))
    expect(detect(root, base)).toEqual(['.git/config'])
    expect(read(outside, 'target')).toBe('not yours')
  })
  test('a symlink that was there before is part of the baseline, and a changed target is found', () => {
    const root = repo(); const outside = dirOf()
    symlinkSync('/usr/bin/true', join(root, '.git/hooks/pre-push'))
    const base = takeBaseline(root)
    expect(detect(root, base)).toEqual([])
    rmSync(join(root, '.git/hooks/pre-push')); symlinkSync(join(outside, 'x'), join(root, '.git/hooks/pre-push'))
    expect(detect(root, base)).toEqual(['.git/hooks/pre-push'])
  })
  test('a named pipe planted in hooks is found without being opened (it would block a read)', () => {
    const root = repo(); const base = takeBaseline(root)
    expect(Bun.spawnSync(['/usr/bin/mkfifo', join(root, '.git/hooks/pre-commit')]).exitCode).toBe(0)
    expect(detect(root, base)).toEqual(['.git/hooks/pre-commit'])
  })
  test('a named pipe in the baseline that the job removed is a vanished path, as any other', () => {
    const root = repo()
    expect(Bun.spawnSync(['/usr/bin/mkfifo', join(root, '.git/hooks/pre-push')]).exitCode).toBe(0)
    const base = takeBaseline(root)
    expect(detect(root, base)).toEqual([])
    rmSync(join(root, '.git/hooks/pre-push')); appendFileSync(join(root, '.gitmodules'), 'x')
    expect(detect(root, base)).toEqual(['.git/hooks/pre-push', '.gitmodules'])
  })
  test('a directory where a watched file was is found', () => {
    const root = repo(); const base = takeBaseline(root)
    rmSync(join(root, '.git/config')); mkdirSync(join(root, '.git/config')); put(root, '.git/config/inner', 'x')
    expect(detect(root, base)).toEqual(['.git/config'])
  })
  test('a listing that fails after the job is a change, not a throw', () => {
    const root = repo(); const base = takeBaseline(root)
    const out = compareBaseline(root, base, () => { throw Object.assign(new Error('x'), { code: 'EACCES' }) })
    expect(out.length).toBeGreaterThan(0)
  })
  test('what git does in the rest of .git while a job works is not a change: HEAD, index, refs, objects, logs, modules', () => {
    const root = repo(); const base = takeBaseline(root)
    put(root, '.git/HEAD', 'ref: refs/heads/other\n'); put(root, '.git/index', 'j'); put(root, '.git/refs/heads/new', 'def\n'); put(root, '.git/objects/cd/ef01', 'new object')
    put(root, '.git/logs/HEAD', 'moved'); put(root, '.git/modules/a/config', '[core]\n\tfsmonitor = evil\n'); put(root, '.git/modules/a/hooks/pre-commit', 'x', 0o755)
    put(root, '.git/objects/info/commit-graph', 'cg'); put(root, '.git/refs/heads/info/x', 'r')
    expect(detect(root, base)).toEqual([])
  })
  test('.git/commondir and .git/config.worktree written by the job are found, in any case spelling', () => {
    const root = repo(); const base = takeBaseline(root)
    put(root, '.git/CommonDir', '../.x\n'); put(root, '.git/Config.Worktree', '[core]\n\tfsmonitor = evil\n')
    expect(detect(root, base)).toEqual(['.git/CommonDir', '.git/Config.Worktree'])
  })
  test('an edit to a config.worktree that was there before is found', () => {
    const root = repo(); put(root, '.git/config.worktree', 'a'); const base = takeBaseline(root)
    put(root, '.git/config.worktree', 'b')
    expect(detect(root, base)).toEqual(['.git/config.worktree'])
  })
})

describe('compareBaseline: .git that stops being a directory, or goes (Ruling S8: found, not rebuilt)', () => {
  const GIT_FILES = ['.git/config', '.git/hooks/commit-msg', '.git/hooks/pre-commit.sample', '.git/info/exclude']
  test('a gitfile where .git was: found, with everything that was in it, and left alone', () => {
    const root = repo(); const base = takeBaseline(root)
    rmSync(join(root, '.git'), { recursive: true }); writeFileSync(join(root, '.git'), 'gitdir: .x\n'); put(root, '.x/config', '[core]\n\tfsmonitor = evil\n')
    expect(detect(root, base)).toEqual(['.git', ...GIT_FILES, '.git/hooks', '.git/info'].sort())
    expect(lstatSync(join(root, '.git')).isFile()).toBe(true)
  })
  test('a link to a directory outside the folder where .git was: found, and nothing is entered through it', () => {
    const root = repo(); const base = takeBaseline(root); const outside = dirOf(); put(outside, 'config', 'theirs')
    rmSync(join(root, '.git'), { recursive: true }); symlinkSync(outside, join(root, '.git'))
    expect(detect(root, base)).toEqual(['.git', ...GIT_FILES, '.git/hooks', '.git/info'].sort())
    expect(readdirSync(outside)).toEqual(['config'])
  })
  test('the real git directory moved aside and a link put in its place: found', () => {
    const root = repo(); const base = takeBaseline(root)
    renameSync(join(root, '.git'), join(root, '.real')); symlinkSync('.real', join(root, '.git'))
    expect(detect(root, base)).toContain('.git')
  })
  test('a .git that is gone altogether is found', () => {
    const root = repo(); const base = takeBaseline(root)
    rmSync(join(root, '.git'), { recursive: true })
    expect(detect(root, base)).toEqual(['.git', ...GIT_FILES, '.git/hooks', '.git/info'].sort())
  })
  test('a .git that is a file in the baseline too is compared like any watched file (an unadmitted case, but nothing may throw)', () => {
    const root = dirOf(); writeFileSync(join(root, '.git'), 'gitdir: .y\n')
    expect(detect(root, takeBaseline(root))).toEqual([])
    writeFileSync(join(root, '.git'), 'gitdir: .z\n')
    expect(compareBaseline(root, takeBaseline(root))).toEqual([])
  })
})

// A sandboxed job can write anywhere in the folder, and the kernel lets the owner set flags, ACLs and modes on what it owns. None of it may hide a
// change, and the guard may not undo any of it: it has no chmod, chflags or ACL call. Each case here ends reported, with the lock still in place.
const sh = (...cmd: string[]) => { const r = Bun.spawnSync(cmd); if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')}: ${r.stderr.toString()}`) }
const flagsOf = (p: string) => Bun.spawnSync(['/usr/bin/stat', '-f', '%Sf', p]).stdout.toString().trim()
const aclOf = (p: string) => Bun.spawnSync(['/bin/ls', '-lde', p]).stdout.toString()
const lock = (p: string, flag = 'uchg') => sh('/usr/bin/chflags', flag, p)
const deny = (p: string, rights: string) => sh('/bin/chmod', '+a', `${userInfo().username} deny ${rights}`, p)
const FILE_RIGHTS = 'read,write,append,delete,readattr,writeattr,readextattr,writeextattr,writesecurity,chown'
const DIR_RIGHTS = 'list,search,add_file,add_subdirectory,delete_child,writesecurity'
const dirModeOf = (root: string, rel: string) => lstatSync(join(root, rel)).mode & 0o7777

describe('compareBaseline: a job cannot hide a change by making the path unreadable, immutable or ACL-protected, and the guard does not undo any of it', () => {
  test('a watched directory made unreadable (mode 000) is found, with what was planted in it unseen, and its mode is left at 000', () => {
    const root = repo(); const base = takeBaseline(root)
    put(root, '.git/hooks/pre-commit', '#!/bin/sh\nevil\n', 0o755); chmodSync(join(root, '.git/hooks'), 0o000)
    expect(detect(root, base)).toEqual(['.git/hooks'])
    expect(dirModeOf(root, '.git/hooks')).toBe(0)
    chmodSync(join(root, '.git/hooks'), 0o755)
  })
  test('.git itself made unreadable (mode 000) is found, and left at 000', () => {
    const root = repo(); const base = takeBaseline(root)
    appendFileSync(join(root, '.git/config'), '[core]\n\tpager = evil\n'); chmodSync(join(root, '.git'), 0o000)
    expect(detect(root, base)).toEqual(['.git'])
    expect(dirModeOf(root, '.git')).toBe(0)
    chmodSync(join(root, '.git'), 0o755)
  })
  test('a directory the job made and locked (mode 000, with a file in it) is found by its name', () => {
    const root = repo(); const base = takeBaseline(root)
    put(root, '.git/info/evil/x', 'x'); chmodSync(join(root, '.git/info/evil'), 0o000)
    expect(detect(root, base)).toEqual(['.git/info/evil'])
    chmodSync(join(root, '.git/info/evil'), 0o755)
  })
  test('a directory mode that differs from the baseline is a change in itself, and the mode stays', () => {
    const root = repo(); const base = takeBaseline(root)
    chmodSync(join(root, '.git/info'), 0o777)
    expect(detect(root, base)).toEqual(['.git/info'])
    expect(dirModeOf(root, '.git/info')).toBe(0o777)
  })
  test('a watched file made unreadable (mode 000) is a change without being read', () => {
    const root = repo(); const base = takeBaseline(root)
    chmodSync(join(root, '.git/config'), 0o000); chmodSync(join(root, '.git/hooks/commit-msg'), 0o000)
    expect(detect(root, base)).toEqual(['.git/config', '.git/hooks/commit-msg'])
  })
  test('an edited file whose ACL denies its owner every right is found, and the ACL stays', () => {
    const root = repo(); const base = takeBaseline(root)
    appendFileSync(join(root, '.git/config'), '[core]\n\tpager = evil\n'); deny(join(root, '.git/config'), FILE_RIGHTS)
    expect(compareBaseline(root, base)).toEqual(['.git/config'])
    expect(() => readFileSync(join(root, '.git/config'))).toThrow() // still denied: nothing cleared the ACL (ls cannot show it, the ACL hides even the attributes)
  })
  test('a file that only had a deny-read ACL put on it (contents and mode as before) is found: it can no longer be read to compare', () => {
    const root = repo(); const base = takeBaseline(root)
    deny(join(root, '.git/config'), 'read')
    expect(compareBaseline(root, base)).toEqual(['.git/config'])
    expect(aclOf(join(root, '.git/config'))).toContain('deny')
  })
  test('a directory whose ACL denies the owner the listing is found, and the ACL stays', () => {
    const root = repo(); const base = takeBaseline(root)
    put(root, '.git/hooks/pre-commit', '#!/bin/sh\nevil\n', 0o755); deny(join(root, '.git/hooks'), DIR_RIGHTS)
    expect(compareBaseline(root, base)).toEqual(['.git/hooks'])
    expect(aclOf(join(root, '.git/hooks'))).toContain('deny')
  })
  test('a path whose own attributes the ACL hides (readattr denied: even lstat fails) is found by its name', () => {
    const root = repo(); const base = takeBaseline(root)
    deny(join(root, '.git/config'), 'readattr')
    expect(compareBaseline(root, base)).toEqual(['.git/config'])
  })
  test('an edited file that was made immutable (uchg) is found, and the flag stays', () => {
    const root = repo(); const base = takeBaseline(root)
    appendFileSync(join(root, '.git/config'), '[core]\n\tpager = evil\n'); lock(join(root, '.git/config'))
    try {
      expect(compareBaseline(root, base)).toEqual(['.git/config'])
      expect(flagsOf(join(root, '.git/config'))).toContain('uchg')
    } finally { sh('/usr/bin/chflags', 'nouchg', join(root, '.git/config')) }
  })
  test('an edit made append-only (uappnd) is found too', () => {
    const root = repo(); const base = takeBaseline(root)
    appendFileSync(join(root, '.gitmodules'), 'x'); lock(join(root, '.gitmodules'), 'uappnd')
    try { expect(compareBaseline(root, base)).toEqual(['.gitmodules']) } finally { sh('/usr/bin/chflags', 'nouappnd', join(root, '.gitmodules')) }
  })
  test('a planted hook that is immutable, inside a hooks directory that is immutable, is found, and both flags stay', () => {
    const root = repo(); const base = takeBaseline(root)
    put(root, '.git/hooks/pre-commit', '#!/bin/sh\nevil\n', 0o755); lock(join(root, '.git/hooks/pre-commit')); lock(join(root, '.git/hooks'))
    try {
      expect(compareBaseline(root, base)).toEqual(['.git/hooks/pre-commit'])
      expect([flagsOf(join(root, '.git/hooks')), flagsOf(join(root, '.git/hooks/pre-commit'))]).toEqual([expect.stringContaining('uchg'), expect.stringContaining('uchg')])
    } finally { sh('/usr/bin/chflags', 'nouchg', join(root, '.git/hooks/pre-commit')); sh('/usr/bin/chflags', 'nouchg', join(root, '.git/hooks')) }
  })
  test('what appeared is not read: a sparse 8 GiB file in hooks is found at once, and so is a same-mode file of another size at a baseline path', () => {
    const root = repo(); const base = takeBaseline(root)
    sh('/usr/bin/truncate', '-s', '8g', join(root, '.git/hooks/big'))
    rmSync(join(root, '.git/hooks/commit-msg')); sh('/usr/bin/truncate', '-s', '8g', join(root, '.git/hooks/commit-msg')); chmodSync(join(root, '.git/hooks/commit-msg'), 0o755)
    const t0 = performance.now()
    expect(compareBaseline(root, base)).toEqual(['.git/hooks/big', '.git/hooks/commit-msg'])
    expect(performance.now() - t0).toBeLessThan(5000) // reading either file whole would take far longer
  })
  test('lstat and sha256 are all it uses: the guard source has no call that writes, and no chmod, chflags or ACL tool', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'src', 'fingerprint.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const banned of ['chmod', 'chflags', 'lchmod', 'rmSync', 'rmdirSync', 'unlinkSync', 'writeFileSync', 'mkdirSync', 'symlinkSync', 'renameSync', 'utimes', 'appendFileSync', 'copyFile', 'truncate'])
      expect([banned, src.includes(banned)]).toEqual([banned, false])
  })
})

describe('compareBaseline: a .git entry below the root that was not there before is found (Ruling S9)', () => {
  test('a new nested repository: a directory, a gitfile or a link, at any depth', () => {
    const root = repo(); const base = takeBaseline(root); const outside = dirOf()
    mkdirSync(join(root, 'sub/inner/.git'), { recursive: true }); put(root, 'other/.git', 'gitdir: ../.x\n'); symlinkSync(outside, join(root, 'third-.git'))
    mkdirSync(join(root, 'x/.Git'), { recursive: true })
    expect(detect(root, base)).toEqual(['other/.git', 'sub/inner/.git', 'x/.Git'])
  })
  test('one that was there before is not new, and node_modules and the root .summon-tmp are not looked into', () => {
    const root = repo(); mkdirSync(join(root, 'vendor/lib/.git'), { recursive: true }); const base = takeBaseline(root)
    mkdirSync(join(root, 'node_modules/p/.git'), { recursive: true }); mkdirSync(join(root, '.summon-tmp/smn_a/r/.git'), { recursive: true })
    expect(detect(root, base)).toEqual([])
  })
  test('a directory the job made unreadable hides nothing: it is found by its name', () => {
    const root = repo(); const base = takeBaseline(root)
    mkdirSync(join(root, 'sub/inner'), { recursive: true }); chmodSync(join(root, 'sub'), 0o000)
    try { expect(compareBaseline(root, base)).toEqual(['sub']) } finally { chmodSync(join(root, 'sub'), 0o755) }
  })
  test('a walk that would pass its limits is a change (the folder cannot be shown clean), and the limit is the test\'s to set', () => {
    const root = repo(); const base = takeBaseline(root)
    for (let i = 0; i < 12; i++) put(root, `many/f${i}`, 'x')
    expect(compareBaseline(root, base, undefined, { entries: 10, depth: 8 })).toEqual(['(the folder walk limit)'])
    expect(compareBaseline(root, base, undefined, { entries: 1000, depth: 8 })).toEqual([])
  })
})

describe('gitlinkPaths: an index entry of mode 160000 is a submodule or a nested repository staged as one (Ruling S9)', () => {
  const git = (root: string, ...args: string[]) => { const r = Bun.spawnSync(['/usr/bin/git', ...args], { cwd: root, env: envOf(root) }); if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`); return r.stdout.toString() }
  const envOf = (root: string): Record<string, string> => ({ HOME: root, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: join(root, '..') })
  function realRepo() {
    const root = dirOf()
    git(root, 'init', '-q', '-b', 'main')
    put(root, 'a.txt', 'a'); git(root, 'add', 'a.txt')
    return root
  }
  const link = (root: string, path: string) => git(root, 'update-index', '--add', '--cacheinfo', `160000,${'ab'.repeat(20)},${path}`)

  test('none in an ordinary index, and none in a repository that has no index at all', () => {
    const root = realRepo()
    expect(gitlinkPaths(root, envOf(root))).toEqual([])
    expect(gitlinkPaths(repo(), envOf(root))).toEqual([])
  })
  test('every gitlink is named, whatever the path holds (a newline included), and ordinary entries are not', () => {
    const root = realRepo(); link(root, 'sub'); link(root, 'deep/er'); link(root, 'odd\nname')
    expect(gitlinkPaths(root, envOf(root))!.sort()).toEqual(['deep/er', 'odd\nname', 'sub'])
  })
  test('git that cannot run, or an index that cannot be read, is null (the folder cannot be shown clean)', () => {
    const root = realRepo()
    expect(gitlinkPaths(root, envOf(root), '/no/such/git')).toBeNull()
    writeFileSync(join(root, '.git/index'), 'not an index')
    expect(gitlinkPaths(root, envOf(root))).toBeNull()
  })
  test('git runs with the env it is given, in the folder, and with nothing else of the runner\'s', () => {
    const root = realRepo()
    const script = join(dirOf(), 'fake-git'); const out = join(dirOf(), 'out')
    writeFileSync(script, `#!/bin/sh\npwd > '${out}'\nenv | sort >> '${out}'\n`, { mode: 0o755 })
    process.env.SUMMON_TEST_ONLY_LEAK = 'leaked'
    try { expect(gitlinkPaths(root, { ONLY_THIS: '1', PATH: '/usr/bin:/bin' }, script)).toEqual([]) } finally { delete process.env.SUMMON_TEST_ONLY_LEAK }
    const seen = readFileSync(out, 'utf8')
    expect(seen.split('\n')[0]).toBe(root)
    expect(seen).toContain('ONLY_THIS=1')
    expect(seen).not.toContain('SUMMON_TEST_ONLY_LEAK')
  })
})

describe('checkBaseline: the watched files, the nested .git entries and the index, in that order', () => {
  const envFor = (root: string): Record<string, string> => ({ HOME: root, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: join(root, '..') })
  /** A git that says it ran, and prints a gitlink if asked to. */
  function fakeGit(printLink: boolean) {
    const dir = dirOf(); const mark = join(dir, 'ran'); const script = join(dir, 'git')
    writeFileSync(script, `#!/bin/sh\necho ran >> '${mark}'\n${printLink ? "printf '160000 %s 0\\tsubmod\\0' abababababababababababababababababababab" : ':'}\n`, { mode: 0o755 })
    return { script, ran: () => existsSync(mark) }
  }
  test('nothing changed and no gitlink: nothing, and git was asked once', () => {
    const root = repo(); const g = fakeGit(false)
    expect(checkBaseline(root, takeBaseline(root), envFor(root), undefined, g.script)).toEqual([])
    expect(g.ran()).toBe(true)
  })
  test('a gitlink is named with a word after it, so it cannot be taken for a changed file of that name', () => {
    const root = repo(); const g = fakeGit(true)
    expect(checkBaseline(root, takeBaseline(root), envFor(root), undefined, g.script)).toEqual(['submod (gitlink)'])
  })
  test('git is not run in a folder whose watched files already changed: its configuration is the job\'s now', () => {
    const root = repo(); const base = takeBaseline(root); const g = fakeGit(true)
    appendFileSync(join(root, '.git/config'), '[core]\n\tfsmonitor = evil\n')
    expect(checkBaseline(root, base, envFor(root), undefined, g.script)).toEqual(['.git/config'])
    expect(g.ran()).toBe(false)
  })
  test('a new nested .git is reported with the files, and git is not run for it either', () => {
    const root = repo(); const base = takeBaseline(root); const g = fakeGit(true)
    mkdirSync(join(root, 'sub/.git'), { recursive: true })
    expect(checkBaseline(root, base, envFor(root), undefined, g.script)).toEqual(['sub/.git'])
    expect(g.ran()).toBe(false)
  })
  test('an index that cannot be read is a change: the folder cannot be shown clean', () => {
    const root = repo()
    expect(checkBaseline(root, takeBaseline(root), envFor(root), undefined, '/no/such/git')).toEqual(['(the index could not be read)'])
  })
  test('with a real git: the work the guard exists for is not a change: git add, git commit, new branches (even ones named info/x and config) in a real repository leave it clean', () => {
    const root = dirOf(); const env = { ...envFor(root), GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@x' }
    const git = (...a: string[]) => { const r = Bun.spawnSync(['/usr/bin/git', ...a], { cwd: root, env }); if (r.exitCode !== 0) throw new Error(r.stderr.toString()) }
    git('init', '-q', '-b', 'main'); put(root, 'a.txt', 'a'); git('add', 'a.txt'); git('commit', '-q', '-m', 'one')
    put(root, '.git/info/exclude', '/.summon-tmp/\n')
    const base = takeBaseline(root)
    put(root, 'b.txt', 'b'); put(root, 'src/c.ts', 'c'); git('add', '-A'); git('commit', '-q', '-m', 'two'); git('branch', 'info/x'); git('branch', 'config'); git('tag', 't1')
    expect(checkBaseline(root, base, env)).toEqual([])
  })
  test('KNOWN LIMIT (README): git gc writes .git/info/refs, which is under info/ and so watched: it is found, and the folder would be blocked (an edit job runs gc only through `git commit`\'s own gc --auto)', () => {
    const root = dirOf(); const env = { ...envFor(root), GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@x' }
    const git = (...a: string[]) => { const r = Bun.spawnSync(['/usr/bin/git', ...a], { cwd: root, env }); if (r.exitCode !== 0) throw new Error(r.stderr.toString()) }
    git('init', '-q', '-b', 'main'); put(root, 'a.txt', 'a'); git('add', 'a.txt'); git('commit', '-q', '-m', 'one')
    const base = takeBaseline(root)
    git('gc', '-q')
    expect(checkBaseline(root, base, env)).toEqual(['.git/info/refs'])
  })
  test('with a real git: a nested repository staged as a gitlink, in a real repository, is found', () => {
    const root = dirOf(); const env = envFor(root)
    const git = (...a: string[]) => { const r = Bun.spawnSync(['/usr/bin/git', ...a], { cwd: root, env }); if (r.exitCode !== 0) throw new Error(r.stderr.toString()) }
    git('init', '-q', '-b', 'main'); put(root, 'a.txt', 'a'); git('add', 'a.txt')
    const base = takeBaseline(root)
    git('update-index', '--add', '--cacheinfo', `160000,${'cd'.repeat(20)},vendor/lib`)
    expect(checkBaseline(root, base, env)).toEqual(['vendor/lib (gitlink)'])
  })
})

describe('a baseline as data: it can be written to the runner\'s private state and read back', () => {
  test('a round trip through JSON compares exactly as the original baseline does', () => {
    const root = repo(); symlinkSync('/usr/bin/true', join(root, '.git/hooks/pre-push')); mkdirSync(join(root, '.git/info/empty')); mkdirSync(join(root, 'vendor/.git'), { recursive: true })
    expect(Bun.spawnSync(['/usr/bin/mkfifo', join(root, '.git/hooks/fifo')]).exitCode).toBe(0)
    const base = takeBaseline(root)
    const copy = parseBaseline(JSON.parse(JSON.stringify(serializeBaseline(base))), root)
    expect([...copy.files]).toEqual([...base.files])
    expect([...copy.dirs]).toEqual([...base.dirs])
    expect([...copy.nested]).toEqual([...base.nested])
    expect(detect(root, copy)).toEqual([])
    appendFileSync(join(root, '.git/config'), 'x'); rmSync(join(root, '.git/hooks/commit-msg')); rmSync(join(root, '.git/hooks/pre-push')); rmSync(join(root, '.git/info/empty'), { recursive: true })
    mkdirSync(join(root, 'new/.git'), { recursive: true })
    const want = compareBaseline(root, base)
    expect(want).toEqual(['.git/config', '.git/hooks/commit-msg', '.git/hooks/pre-push', '.git/info/empty', 'new/.git'])
    expect(compareBaseline(root, copy)).toEqual(want)
  })
  test('the data holds hashes, not contents, so it cannot leak a credential: the file is 0600 all the same', () => {
    const root = repo()
    const json = JSON.stringify(serializeBaseline(takeBaseline(root)))
    expect(json).not.toContain(Buffer.from('[core]\n\tbare = false\n').toString('base64'))
    expect(json).not.toContain('bare = false')
  })
  test('malformed data is refused, never half-read: a path that climbs out, an absolute one, a hash that is not a hash, an unknown kind, a wrong shape', () => {
    const root = repo(); mkdirSync(join(root, 'vendor/.git'), { recursive: true }); const good = JSON.parse(JSON.stringify(serializeBaseline(takeBaseline(root))))
    expect(() => parseBaseline(good, root)).not.toThrow()
    const withFile = (patch: object) => ({ ...good, files: [{ ...good.files[0], ...patch }, ...good.files.slice(1)] })
    for (const bad of [withFile({ rel: '../outside' }), withFile({ rel: '.git/../../outside' }), withFile({ rel: '/etc/passwd' }), withFile({ rel: '' }), withFile({ rel: '.git//config' }),
      withFile({ sha: 'zz' }), withFile({ sha: '0'.repeat(63) }), withFile({ kind: 'device' }), withFile({ mode: -1 }), withFile({ mode: 1.5 }), withFile({ size: -1 }), withFile({ size: 'x' }),
      { ...good, v: 1 }, { ...good, v: 3 }, { ...good, dirs: [{ rel: '..', mode: 0o755 }] }, { ...good, nested: ['../x'] }, { ...good, nested: [7] }, { ...good, nested: 'x' },
      { ...good, files: [good.files[0], good.files[0]] }, null, 'x', [], { v: 2 }]) {
      expect(() => parseBaseline(bad, root)).toThrow(FingerprintError)
    }
  })
  test('the old form, which carried contents (version 1), is not read: a baseline from before this change is "not usable", never half-trusted', () => {
    const root = repo()
    expect(() => parseBaseline({ v: 1, files: [], dirs: [] }, root)).toThrow(FingerprintError)
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

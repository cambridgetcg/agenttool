import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureExcluded, EXCLUDE_LINE, makeJobTmp, removeJobTmp, TMP_DIR } from '../src/jobtmp.ts'
import { newRequestId } from '../src/request.ts'
import { cleanupTmps, fakeGitRoot, trackTmp } from './helpers.ts'

afterEach(cleanupTmps)

const repo = () => fakeGitRoot(trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-jobtmp-')))))
const modeOf = (p: string) => lstatSync(p).mode & 0o777
const linesOf = (p: string) => readFileSync(p, 'utf8').split('\n')

describe('makeJobTmp: <folder>/.summon-tmp/<job id>, mode 0700', () => {
  test('creates the job directory and its parent, both 0700, and returns the path', () => {
    const cwd = repo(); const id = newRequestId()
    const dir = makeJobTmp(cwd, id)
    expect(dir).toBe(join(cwd, TMP_DIR, id))
    expect([lstatSync(dir).isDirectory(), modeOf(dir)]).toEqual([true, 0o700])
    expect([lstatSync(join(cwd, TMP_DIR)).isDirectory(), modeOf(join(cwd, TMP_DIR))]).toEqual([true, 0o700])
  })
  test('a second job gets its own directory beside the first, and the parent is not recreated', () => {
    const cwd = repo(); const [a, b] = [newRequestId(), newRequestId()]
    makeJobTmp(cwd, a); makeJobTmp(cwd, b)
    expect(readdirSync(join(cwd, TMP_DIR)).sort()).toEqual([a, b].sort())
  })
  test('a .summon-tmp that is a symlink (planted by an earlier job) is replaced, never followed', () => {
    const cwd = repo(); const outside = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-outside-')))); const id = newRequestId()
    symlinkSync(outside, join(cwd, TMP_DIR))
    const dir = makeJobTmp(cwd, id)
    expect(lstatSync(join(cwd, TMP_DIR)).isSymbolicLink()).toBe(false)
    expect(dir).toBe(join(cwd, TMP_DIR, id))
    expect(readdirSync(outside)).toEqual([]) // nothing was made through the link
  })
  test('a .summon-tmp that is a regular file is replaced too', () => {
    const cwd = repo(); writeFileSync(join(cwd, TMP_DIR), 'x')
    expect(lstatSync(makeJobTmp(cwd, newRequestId())).isDirectory()).toBe(true)
  })
  test('a directory that already exists for this id is refused (fail closed, never reused)', () => {
    const cwd = repo(); const id = newRequestId()
    makeJobTmp(cwd, id)
    expect(() => makeJobTmp(cwd, id)).toThrow()
  })
  test('an id that is not a job id is refused before anything is made', () => {
    const cwd = repo()
    for (const bad of ['../x', 'x/y', '', 'smn_zz']) expect(() => makeJobTmp(cwd, bad)).toThrow()
    expect(existsSync(join(cwd, TMP_DIR))).toBe(false)
  })
})

describe('ensureExcluded: the line /.summon-tmp/ in .git/info/exclude', () => {
  const exclude = (cwd: string) => join(cwd, '.git/info/exclude')
  test('creates .git/info and the file when there are none', () => {
    const cwd = repo()
    ensureExcluded(cwd)
    expect(linesOf(exclude(cwd))).toEqual([EXCLUDE_LINE, ''])
    expect(EXCLUDE_LINE).toBe('/.summon-tmp/')
  })
  test('adds the line once: a second call, and a file that already has it, change nothing', () => {
    const cwd = repo()
    mkdirSync(join(cwd, '.git/info'))
    writeFileSync(exclude(cwd), '# mine\n*.log\n/.summon-tmp/\n')
    ensureExcluded(cwd); ensureExcluded(cwd)
    expect(readFileSync(exclude(cwd), 'utf8')).toBe('# mine\n*.log\n/.summon-tmp/\n')
    const other = repo()
    ensureExcluded(other); ensureExcluded(other)
    expect(linesOf(exclude(other)).filter((l) => l === EXCLUDE_LINE)).toHaveLength(1)
  })
  test('keeps what is there and adds the line after it, with a newline first when the file had none', () => {
    const cwd = repo()
    mkdirSync(join(cwd, '.git/info'))
    writeFileSync(exclude(cwd), '*.log', { mode: 0o640 })
    ensureExcluded(cwd)
    expect(readFileSync(exclude(cwd), 'utf8')).toBe('*.log\n/.summon-tmp/\n')
    expect(modeOf(exclude(cwd))).toBe(0o640) // the file's own mode is not touched
  })
  test('a line that only contains the text (a comment, a longer pattern) does not count', () => {
    const cwd = repo()
    mkdirSync(join(cwd, '.git/info'))
    writeFileSync(exclude(cwd), '# /.summon-tmp/\n/.summon-tmp/x\n')
    ensureExcluded(cwd)
    expect(linesOf(exclude(cwd))).toEqual(['# /.summon-tmp/', '/.summon-tmp/x', '/.summon-tmp/', ''])
  })
  test('fails closed on an exclude file that has a second name (a hard link to a file elsewhere), and leaves that file alone', () => {
    const cwd = repo(); const outside = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-outside-'))))
    mkdirSync(join(cwd, '.git/info')); writeFileSync(join(outside, 'shared'), 'keep\n')
    linkSync(join(outside, 'shared'), exclude(cwd))
    expect(() => ensureExcluded(cwd)).toThrow()
    expect(readFileSync(join(outside, 'shared'), 'utf8')).toBe('keep\n')
  })
  test('fails closed, writing nothing through a link: .git/info or exclude a symlink, or .git not a directory', () => {
    const outside = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-outside-'))))
    const a = repo(); symlinkSync(outside, join(a, '.git/info'))
    expect(() => ensureExcluded(a)).toThrow()
    const b = repo(); mkdirSync(join(b, '.git/info')); writeFileSync(join(outside, 'target'), 'keep')
    symlinkSync(join(outside, 'target'), exclude(b))
    expect(() => ensureExcluded(b)).toThrow()
    const c = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-nogit-'))))
    expect(() => ensureExcluded(c)).toThrow()
    const d = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-gitlink-'))))
    const elsewhere = repo() // a repository of its own: a .git that is a link to its .git must not be written into
    symlinkSync(join(elsewhere, '.git'), join(d, '.git'))
    expect(() => ensureExcluded(d)).toThrow()
    expect(existsSync(join(elsewhere, '.git/info'))).toBe(false)
    expect(readFileSync(join(outside, 'target'), 'utf8')).toBe('keep')
    expect(readdirSync(outside)).toEqual(['target'])
  })
})

describe('removeJobTmp: the job directory goes, and .summon-tmp with it when nothing else is in it', () => {
  test('removes the directory with everything in it, then the empty parent', () => {
    const cwd = repo(); const id = newRequestId()
    const dir = makeJobTmp(cwd, id)
    mkdirSync(join(dir, 'a/b'), { recursive: true }); writeFileSync(join(dir, 'a/b/f'), 'x')
    removeJobTmp(cwd, id)
    expect(existsSync(join(cwd, TMP_DIR))).toBe(false)
  })
  test('leaves .summon-tmp when another entry is in it', () => {
    const cwd = repo(); const [a, b] = [newRequestId(), newRequestId()]
    makeJobTmp(cwd, a); makeJobTmp(cwd, b)
    removeJobTmp(cwd, a)
    expect(readdirSync(join(cwd, TMP_DIR))).toEqual([b])
  })
  test('removes a directory the job made unreadable (read-only trees are common in build output)', () => {
    const cwd = repo(); const id = newRequestId()
    const dir = makeJobTmp(cwd, id)
    mkdirSync(join(dir, 'ro/sub'), { recursive: true }); writeFileSync(join(dir, 'ro/sub/f'), 'x')
    chmodSync(join(dir, 'ro/sub'), 0o500); chmodSync(join(dir, 'ro'), 0o000)
    removeJobTmp(cwd, id)
    expect(existsSync(join(cwd, TMP_DIR))).toBe(false)
  })
  test('a symlink in the job directory is removed as a link; what it points at is untouched', () => {
    const cwd = repo(); const id = newRequestId(); const outside = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-outside-'))))
    writeFileSync(join(outside, 'keep'), 'x')
    symlinkSync(outside, join(makeJobTmp(cwd, id), 'link'))
    removeJobTmp(cwd, id)
    expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('x')
  })
  test('a .summon-tmp swapped for a symlink is removed as a link and nothing behind it is touched', () => {
    const cwd = repo(); const id = newRequestId(); const outside = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-outside-'))))
    mkdirSync(join(outside, id)); writeFileSync(join(outside, id, 'keep'), 'x')
    symlinkSync(outside, join(cwd, TMP_DIR))
    removeJobTmp(cwd, id)
    expect(lstatSync(join(cwd, TMP_DIR), { throwIfNoEntry: false })).toBeUndefined()
    expect(readFileSync(join(outside, id, 'keep'), 'utf8')).toBe('x')
  })
  test('never throws: nothing there, or an id that is not a job id', () => {
    const cwd = repo()
    expect(() => removeJobTmp(cwd, newRequestId())).not.toThrow()
    expect(() => removeJobTmp(cwd, '../x')).not.toThrow()
    expect(() => removeJobTmp(join(cwd, 'nope'), newRequestId())).not.toThrow()
  })
})

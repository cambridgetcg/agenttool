import { afterEach, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { ancestorCheck, checkDiff, checkTree, CONTROL_SEGMENTS, DEFAULT_CAPS, inScopes, isControlPath, type TreeCaps } from '../src/air/diff-check.ts'
import { airGit, type GitRunner } from '../src/air/git.ts'
import { cleanupTmps, commitFiles, commitIndexEntries, makeRepo, REAL_GIT, repoGit, temp } from './helpers.ts'

afterEach(cleanupTmps)

const caps = (o: Partial<TreeCaps> = {}): TreeCaps => ({ ...DEFAULT_CAPS, ...o })

/** A trial-shaped repo (README.md, notes/.gitkeep), the Air's git with an empty home, and the base commit. */
function setup(): { repo: string; git: GitRunner; base: string } {
  const repo = temp('cb-diff-repo-')
  const base = makeRepo(repo)
  return { repo, git: airGit({ git: REAL_GIT, home: temp('cb-diff-home-') }), base }
}

describe('scopes and control paths', () => {
  test('an in-scope regular change passes, and notes/a.md is inside the scope "notes"', async () => {
    const { repo, git, base } = setup()
    const oid = commitFiles(repo, { 'notes/a.md': 'hello\n' }, 'add a note')
    expect(inScopes('notes/a.md', ['notes'])).toBe(true)
    expect(inScopes('notes', ['notes'])).toBe(true)
    expect(inScopes('notesx/a.md', ['notes'])).toBe(false)
    expect(inScopes('notes/a.md', [])).toBe(false)
    expect(await ancestorCheck(git, repo, base, oid)).toBe('ok')
    expect(await checkDiff(git, repo, base, oid, ['notes'], caps())).toEqual({ ok: true, changed: 1 })
    expect(await checkDiff(git, repo, base, base, ['notes'], caps())).toEqual({ ok: true, changed: 0 })
  })

  test('"notes/**" is a literal prefix, so notes/a.md is out of scope', async () => {
    const { repo, git, base } = setup()
    const oid = commitFiles(repo, { 'notes/a.md': 'hello\n' }, 'add a note')
    expect(inScopes('notes/a.md', ['notes/**'])).toBe(false)
    expect(await checkDiff(git, repo, base, oid, ['notes/**'], caps())).toEqual({ ok: false, code: 'remote_out_of_scope', path: 'notes/a.md' })
    const outside = commitFiles(repo, { 'src/x.ts': 'export {}\n' }, 'outside')
    expect(await checkDiff(git, repo, oid, outside, ['notes'], caps())).toEqual({ ok: false, code: 'remote_out_of_scope', path: 'src/x.ts' })
  })

  test('CLAUDE.md, notes/CLAUDE.md, .Claude/settings.json, a decomposed spelling and .env.local are control paths', async () => {
    expect([...CONTROL_SEGMENTS]).toEqual(['.claude', '.mcp.json', 'claude.md', 'claude.local.md', 'agents.md', '.envrc', '.env',
      'bunfig.toml', 'package.json', '.npmrc', '.gitattributes', '.gitmodules', '.lfsconfig', '.githooks', '.husky', '.vscode', '.cursor', '.codex'])
    const control = [
      'CLAUDE.md', 'notes/CLAUDE.md', '.Claude/settings.json', 'notes/deep/.mcp.json', 'notes/Claude.Local.MD', 'AGENTS.md',
      'notes/.envrc', '.env', 'notes/.env', '.env.local', 'notes/.ENV.production', 'notes/bunfig.toml', 'Package.JSON', 'notes/.npmrc',
      '.gitattributes', 'notes/.gitmodules', '.lfsconfig', '.githooks/pre-commit', 'notes/.husky/_/h', '.vscode/settings.json',
      '.cursor/rules', 'notes/.codex/config.toml',
      'notes/.hus\u212Ay/pre-commit', // KELVIN SIGN: canonically K, so NFC and NFD both fold it to .husky
      'notes/agent\u017F.md', // LONG S: APFS compares names case-insensitively, and \u017F folds to s
    ]
    for (const p of control) expect([p, isControlPath(p)]).toEqual([p, true])
    const plain = ['README.md', 'notes/a.md', 'notes/claude.md.txt', 'notes/env', 'notes/.environment', 'notes/my.env', 'claude/x.md', 'notes/package.json5']
    for (const p of plain) expect([p, isControlPath(p)]).toEqual([p, false])
    const { repo, git, base } = setup()
    const oid = commitFiles(repo, { 'notes/CLAUDE.md': 'be nice\n' }, 'instructions')
    expect(await checkDiff(git, repo, base, oid, ['notes'], caps())).toEqual({ ok: false, code: 'remote_control_path', path: 'notes/CLAUDE.md' })
  })
})

describe('paths git hands over byte for byte (Task 63 gate-1-4)', () => {
  test('a path that starts with U+FEFF is checked as that path: out of scope, not the scope it looks like', async () => {
    const { repo, git, base } = setup()
    // The directory is "\ufeffnotes", not "notes"; a decoder that drops the BOM would see notes/x.sh, which is in scope.
    const oid = commitFiles(repo, { '\ufeffnotes/x.sh': 'echo hi\n' }, 'a BOM before the scope name')
    expect(await checkDiff(git, repo, base, oid, ['notes'], caps())).toEqual({ ok: false, code: 'remote_out_of_scope', path: '\ufeffnotes/x.sh' })
  })
})

describe('modes', () => {
  test('a symlink and a gitlink are non-regular', async () => {
    const { repo, git, base } = setup()
    symlinkSync('../README.md', join(repo, 'notes', 'link'))
    const linked = commitFiles(repo, {}, 'a symlink')
    expect(await checkDiff(git, repo, base, linked, ['notes'], caps())).toEqual({ ok: false, code: 'remote_non_regular_path', path: 'notes/link' })
    repoGit(repo, ['update-index', '--add', '--cacheinfo', `160000,${base},notes/sub`])
    repoGit(repo, ['-c', 'user.name=Collab Test', '-c', 'user.email=test@collab-bridge.invalid', 'commit', '-q', '-m', 'a gitlink'])
    const gitlink = repoGit(repo, ['rev-parse', 'HEAD'])
    expect(await checkDiff(git, repo, linked, gitlink, ['notes'], caps())).toEqual({ ok: false, code: 'remote_non_regular_path', path: 'notes/sub' })
    // The whole tree still holds the symlink (Task 63 conformance-4-3), the first non-regular entry in tree order.
    expect(await checkTree(git, repo, gitlink, caps())).toEqual({ ok: false, code: 'remote_non_regular_path', path: 'notes/link' })
    repoGit(repo, ['rm', '-q', '--cached', 'notes/link'])
    repoGit(repo, ['-c', 'user.name=Collab Test', '-c', 'user.email=test@collab-bridge.invalid', 'commit', '-q', '-m', 'only the gitlink'])
    expect(await checkTree(git, repo, repoGit(repo, ['rev-parse', 'HEAD']), caps())).toEqual({ ok: false, code: 'remote_non_regular_path', path: 'notes/sub' })
  })

  test('a symlink anywhere in the fetched tree is non-regular, so a claim sync cannot check one out of the device (Task 63 conformance-4-3)', async () => {
    const { repo, git, base } = setup()
    // A symlink already in the base is never in the complete-time diff, so the full-tree check at every sync refuses it.
    const linked = commitIndexEntries(repo, [{ path: 'notes/link.md', content: '/Users/yuai/.ssh/collab-bridge/collab_nuance_ed25519', mode: '120000' }], 'an absolute symlink')
    expect(await checkTree(git, repo, base, caps())).toMatchObject({ ok: true })
    expect(await checkTree(git, repo, linked, caps())).toEqual({ ok: false, code: 'remote_non_regular_path', path: 'notes/link.md' })
  })

  test('paths that one Air file name would hold, by case or by Unicode form, are non-regular: checkout could write only one (Task 63 gate-1-3)', async () => {
    const { repo, git, base } = setup()
    const pairs: Array<[string, string, string]> = [
      ['src/a.ts', 'src/A.ts', 'case'],
      ['notes/caf\u00e9.md', 'notes/cafe\u0301.md', 'NFC and NFD'],
      ['notes/\u212Aelvin.md', 'notes/kelvin.md', 'Kelvin sign'],
      ['notes/\u017Fam.md', 'notes/SAM.md', 'long s'],
      ['Docs/readme.md', 'docs/README.MD', 'a directory and a file name both differing'],
    ]
    for (const [one, two, why] of pairs) {
      const oid = commitIndexEntries(repo, [{ path: one, content: 'one\n' }, { path: two, content: 'two\n' }], `colliding: ${why}`)
      const r = await checkTree(git, repo, oid, caps())
      expect([why, r.ok === false && r.code]).toEqual([why, 'remote_non_regular_path'])
      repoGit(repo, ['reset', '-q', '--soft', base])
      repoGit(repo, ['reset', '-q'])
    }
    // Names that only look alike are fine: the same file name in two directories, and distinct names.
    const fine = commitIndexEntries(repo, [{ path: 'a/x.ts', content: '1' }, { path: 'b/x.ts', content: '2' }, { path: 'a/y.ts', content: '3' }, { path: 'caf\u00e9.md', content: '4' }, { path: 'cafes.md', content: '5' }], 'distinct')
    expect(await checkTree(git, repo, fine, caps())).toMatchObject({ ok: true })
  })

  test('a deletion is regular', async () => {
    const { repo, git, base } = setup()
    const oid = commitFiles(repo, { 'notes/.gitkeep': null }, 'drop the keep file')
    expect(await checkDiff(git, repo, base, oid, ['notes'], caps())).toEqual({ ok: true, changed: 1 })
  })

  test('a non-ancestor commit is refused', async () => {
    const { repo, git, base } = setup()
    const child = commitFiles(repo, { 'notes/a.md': 'a\n' }, 'child')
    expect(await ancestorCheck(git, repo, child, base)).toBe('remote_base_not_ancestor')
    expect(await ancestorCheck(git, repo, base, child)).toBe('ok')
    expect(await ancestorCheck(git, repo, base, 'f'.repeat(40))).toBe('fetch_failed')
    expect(await ancestorCheck(git, repo, '--help', child)).toBe('fetch_failed')
  })
})

describe('sizes', () => {
  test('more changed paths than the cap is too large', async () => {
    const { repo, git, base } = setup()
    const three = commitFiles(repo, { 'notes/1': '1', 'notes/2': '2', 'notes/3': '3' }, 'three')
    expect(await checkDiff(git, repo, base, three, ['notes'], caps({ maxChangedPaths: 3 }))).toEqual({ ok: true, changed: 3 })
    const four = commitFiles(repo, { 'notes/4': '4' }, 'four')
    const r = await checkDiff(git, repo, base, four, ['notes'], caps({ maxChangedPaths: 3 }))
    expect(r.ok === false && r.code).toBe('remote_too_large')
  })

  test('many paths to one blob count fully against the total', async () => {
    const { repo, git } = setup()
    const same = 'y'.repeat(200)
    const files: Record<string, string> = {}
    for (let i = 0; i < 10; i++) files[`notes/copy-${i}.txt`] = same
    const oid = commitFiles(repo, files, 'ten paths, one blob')
    const blobs = new Set(repoGit(repo, ['ls-tree', '-r', oid, 'notes/']).split('\n').filter((l) => l.includes('copy-')).map((l) => l.split(/\s+/)[2]))
    expect(blobs.size).toBe(1)
    // README.md (13 bytes) + 10 × 200: one stored blob, 2013 bytes counted
    expect(await checkTree(git, repo, oid, caps({ maxTotalBytes: 2013 }))).toEqual({ ok: true, entries: 12, totalBytes: 2013 })
    const r = await checkTree(git, repo, oid, caps({ maxTotalBytes: 2012 }))
    expect(r.ok === false && r.code).toBe('remote_too_large')
  })

  test('a constant non-zero blob over the blob cap is too large', async () => {
    const { repo, git } = setup()
    const oid = commitFiles(repo, { 'notes/big.bin': 'x'.repeat(4096), 'notes/noise.bin': randomBytes(64).toString('hex') }, 'blobs')
    expect((await checkTree(git, repo, oid, caps({ maxBlobBytes: 4096 }))).ok).toBe(true)
    expect(await checkTree(git, repo, oid, caps({ maxBlobBytes: 4095 }))).toEqual({ ok: false, code: 'remote_too_large', path: 'notes/big.bin' })
  })

  test('a tree over the entry cap stops reading early', async () => {
    const { repo, git, base } = setup()
    expect(await checkTree(git, repo, base, caps({ maxEntries: 2 }))).toEqual({ ok: true, entries: 2, totalBytes: 13 })
    expect(await checkTree(git, repo, base, caps({ maxEntries: 1 }))).toEqual({ ok: false, code: 'remote_too_large', path: 'notes/.gitkeep' })
    // A runner that would print a million entries: checkTree reads one past the cap and closes the stream.
    let produced = 0
    let closed = false
    const endless: GitRunner = {
      path: '/nonexistent/git',
      run: async () => ({ code: 0, stdout: new Uint8Array(), stderr: '', timedOut: false }),
      records: () => ({
        async *[Symbol.asyncIterator]() {
          try {
            for (let i = 0; i < 1_000_000; i++) {
              produced += 1
              yield `100644 blob ${'a'.repeat(40)}       1\tnotes/f${i}`
            }
          } finally {
            closed = true
          }
        },
      }),
    }
    const r = await checkTree(endless, repo, base, caps({ maxEntries: 5 }))
    expect(r).toEqual({ ok: false, code: 'remote_too_large', path: 'notes/f5' })
    expect(produced).toBe(6)
    expect(closed).toBe(true)
  })

  test('an unreadable tree or a bad oid is fetch_failed', async () => {
    const { repo, git, base } = setup()
    expect(await checkTree(git, repo, 'e'.repeat(40), caps())).toEqual({ ok: false, code: 'fetch_failed' })
    expect(await checkTree(git, repo, 'HEAD', caps())).toEqual({ ok: false, code: 'fetch_failed' })
    expect(await checkDiff(git, repo, base, '--output=/tmp/x', ['notes'], caps())).toEqual({ ok: false, code: 'fetch_failed' })
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  expandHome, loadAllowlist, longestFolderMatch, parseAllowlist, safeRealpath, tccProtected, TCC_PROTECTED, type Allowlist,
} from '../src/allowlist.ts'
import { cleanupTmps, temp } from './helpers.ts'

afterEach(cleanupTmps)

// Summon's installer default, with an edit folder for the shared trial repo (the two lines Yu adds for Y1).
const YAML = `version: 1
device: nuance
peers: [air]
runtimes:
  - id: claude
    models: [{ model: sonnet }, { model: haiku }]
folders:
  - path: ~/Projects
    access: review
  - path: ~/Projects/collab-trial
    access: edit
limits:
  max_concurrent: 1
  starts_per_hour: 6
  job_timeout_max: 30m
`
const parsed = (text: string): Allowlist => {
  const r = parseAllowlist(text)
  if (!r.ok) throw new Error(r.detail)
  return r.allowlist
}
function home(): string {
  const h = temp('cb-al-')
  for (const d of ['Projects/collab-trial/notes', 'Projects/other', 'Projects/x', 'Documents/secret', 'Desktop', 'Downloads']) {
    mkdirSync(join(h, d), { recursive: true })
  }
  return h
}

describe('parseAllowlist (Summon, copied)', () => {
  test('parses the installer default', () => {
    expect(parsed(YAML)).toMatchObject({ device: 'nuance', peers: ['air'], limits: { max_concurrent: 1, job_timeout_max_s: 1800 } })
    expect(parsed(YAML).folders).toEqual([{ path: '~/Projects', access: 'review' }, { path: '~/Projects/collab-trial', access: 'edit' }])
  })
  test('refuses a non-mapping', () => {
    expect(parseAllowlist('- a\n- b\n')).toEqual({ ok: false, detail: 'not a mapping' })
    expect(parseAllowlist('just words')).toEqual({ ok: false, detail: 'not a mapping' })
    expect(parseAllowlist(': : :').ok).toBe(false)
  })
  test('refuses version 2', () => {
    expect(parseAllowlist(YAML.replace('version: 1', 'version: 2'))).toEqual({ ok: false, detail: 'version must be 1' })
    expect(parseAllowlist(YAML.replace('access: review', 'access: root'))).toEqual({ ok: false, detail: 'folder access' })
  })
  test('ignores unknown keys', () => {
    const extra = YAML.replace('peers: [air]', 'peers: [air]\nfuture_key: { anything: 1 }')
      .replace('    access: edit', '    access: edit\n    note: shared with the Air')
    expect(parsed(extra)).toEqual(parsed(YAML))
  })
  test('loadAllowlist reads a file and reports a missing one', () => {
    const h = home()
    const p = join(h, 'allowlist.yaml')
    expect(loadAllowlist(p)).toEqual({ ok: false, detail: 'missing' })
    writeFileSync(p, YAML)
    expect(loadAllowlist(p)).toEqual({ ok: true, allowlist: parsed(YAML) })
  })
  test('expandHome and safeRealpath behave as Summon’s', () => {
    expect(expandHome('~', '/h')).toBe('/h')
    expect(expandHome('~/Projects', '/h')).toBe('/h/Projects')
    expect(expandHome('/abs', '/h')).toBe('/abs')
    expect(safeRealpath('/definitely/not/here')).toBeNull()
    expect(TCC_PROTECTED).toEqual(['Desktop', 'Documents', 'Downloads', 'Library/Mobile Documents'])
  })
})

describe('longestFolderMatch', () => {
  test('the longest match wins: an edit child under a review parent is edit, a review child under an edit parent is review', () => {
    const h = home()
    const al = parsed(YAML)
    expect(longestFolderMatch(join(h, 'Projects/collab-trial'), al, h)).toEqual({ path: '~/Projects/collab-trial', access: 'edit' })
    expect(longestFolderMatch(join(h, 'Projects/collab-trial/notes'), al, h)).toEqual({ path: '~/Projects/collab-trial', access: 'edit' })
    expect(longestFolderMatch(join(h, 'Projects/other'), al, h)).toEqual({ path: '~/Projects', access: 'review' })
    const flipped = parsed(YAML.replace('    access: review', '    access: edit')
      .replace('path: ~/Projects/collab-trial\n    access: edit', 'path: ~/Projects/collab-trial\n    access: review'))
    expect(longestFolderMatch(join(h, 'Projects/collab-trial/notes'), flipped, h)).toEqual({ path: '~/Projects/collab-trial', access: 'review' })
    expect(longestFolderMatch(join(h, 'Projects/other'), flipped, h)).toEqual({ path: '~/Projects', access: 'edit' })
    // A sibling that only begins with the folder's name is not inside it.
    mkdirSync(join(h, 'Projects/collab-trial-2'))
    expect(longestFolderMatch(join(h, 'Projects/collab-trial-2'), al, h)).toEqual({ path: '~/Projects', access: 'review' })
    expect(longestFolderMatch(h, al, h)).toBeNull()
  })
  test('an entry that does not resolve is skipped', () => {
    const h = home()
    const al = parsed(YAML.replace('path: ~/Projects/collab-trial', 'path: ~/Projects/not-made-yet'))
    expect(longestFolderMatch(join(h, 'Projects/collab-trial'), al, h)).toEqual({ path: '~/Projects', access: 'review' })
    const onlyGone = parsed(YAML.replace('path: ~/Projects\n', 'path: ~/Gone\n').replace('path: ~/Projects/collab-trial', 'path: ~/Gone/too'))
    expect(longestFolderMatch(join(h, 'Projects/collab-trial'), onlyGone, h)).toBeNull()
    const asked: string[] = []
    const recording = (p: string) => { asked.push(p); return safeRealpath(p) }
    longestFolderMatch(join(h, 'Projects/x'), al, h, recording)
    expect(asked).toEqual([join(h, 'Projects'), join(h, 'Projects/not-made-yet')])
  })
})

describe('tccProtected', () => {
  test('a symlink from an allowlisted folder into ~/Documents is TCC by its target', () => {
    const h = home()
    symlinkSync(join(h, 'Documents/secret'), join(h, 'Projects/x/escape'))
    expect(tccProtected('~/Projects/x/escape', h)).toBe('Documents')
    expect(tccProtected(join(h, 'Projects/x/escape'), h)).toBe('Documents')
    expect(tccProtected('~/Projects/x', h)).toBeNull()
    // A path that does not exist is not this check's refusal: the caller's realpath check owns it.
    expect(tccProtected('~/Projects/nope', h)).toBeNull()
  })
  test('a ~/Downloads spelling is TCC before anything resolves', () => {
    const h = home()
    const asked: string[] = []
    // What a gate meets under sshd without a privacy grant: the folder cannot even be resolved.
    const eperm = (p: string): string | null => {
      asked.push(p)
      throw Object.assign(new Error(`EPERM: operation not permitted, realpath '${p}'`), { code: 'EPERM' })
    }
    const cases: Array<[string, string]> = [
      ['~/Downloads', 'Downloads'], ['~/Downloads/collab-bridge-nuance-bundle', 'Downloads'], ['~/downloads/x', 'Downloads'],
      [`${h}/Documents/secret`, 'Documents'], ['~/Projects/../Documents/secret', 'Documents'], ['~//Desktop', 'Desktop'],
      ['~/Library/Mobile Documents/com~apple~CloudDocs', 'Library/Mobile Documents'],
    ]
    for (const [p, want] of cases) expect([p, tccProtected(p, h, eperm)]).toEqual([p, want])
    expect(asked).toEqual([])
    // A name that only begins like a protected folder is not refused by spelling.
    mkdirSync(join(h, 'Projects/Documents-notes'))
    expect(tccProtected('~/Projects/Documents-notes', h)).toBeNull()
    expect(tccProtected('~/DownloadsArchive', h)).toBeNull()
  })
})

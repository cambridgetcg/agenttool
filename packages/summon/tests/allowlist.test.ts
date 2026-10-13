import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAdmission, parseAllowlist as parseWithHome, parseDurationS, realFs, type Admission, type Allowlist, type AllowlistFolder, type FsProbe } from '../src/allowlist.ts'
import { cleanupTmps, fakeGitRoot, sampleRequest, trackTmp } from './helpers.ts'

/** The home the parser is told when a test does not care which: a spelling is judged against it, never looked up. */
const TEST_HOME = '/Users/yu'
const parseAllowlist = (text: string, home: string = TEST_HOME) => parseWithHome(text, home)

// Mirrors the planned gate: narrows on !adm.ok, then reads adm.hint. Must type-check under tsc --strict.
function refusalHint(adm: Admission): string | undefined {
  if (!adm.ok) return adm.hint
  return undefined
}

function home(): string {
  const h = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-al-'))))
  for (const d of ['Projects/x', 'Projects/y', 'Documents/secret', 'Desktop']) mkdirSync(join(h, d), { recursive: true })
  return h
}
afterEach(() => cleanupTmps())

/** A git repository root as far as Summon looks: a real .git directory directly in the folder that git itself would take. */
const repo = fakeGitRoot
/** home() with ~/Projects/x and ~/Projects/y made repository roots. */
function repoHome(): string {
  const h = home()
  repo(join(h, 'Projects/x'))
  repo(join(h, 'Projects/y'))
  return h
}

const YAML = `version: 1
device: nuance
peers: [air]
runtimes:
  - id: claude
    models: [{ model: sonnet }, { model: haiku }]
folders:
  - path: ~/Projects
    access: review
limits:
  max_concurrent: 1
  starts_per_hour: 6
  job_timeout_max: 30m
`
const al = (): Allowlist => {
  const r = parseAllowlist(YAML)
  if (!r.ok) throw new Error(r.detail)
  return r.allowlist
}

describe('parseAllowlist', () => {
  test('parses the installer default', () => {
    expect(al()).toMatchObject({ device: 'nuance', peers: ['air'], limits: { job_timeout_max_s: 1800 } })
  })
  test('rejects bad shapes', () => {
    expect(parseAllowlist('version: 2').ok).toBe(false)
    expect(parseAllowlist(YAML.replace('id: claude', 'id: bash')).ok).toBe(false)
    expect(parseAllowlist(YAML.replace('access: review', 'access: root')).ok).toBe(false)
    expect(parseAllowlist(': : :').ok).toBe(false)
  })
  test('durations', () => {
    expect(parseDurationS('30m')).toBe(1800)
    expect(parseDurationS('2h')).toBe(7200)
    expect(parseDurationS(45)).toBe(45)
    expect(parseDurationS('1d')).toBeNull()
    expect(parseDurationS('0m')).toBeNull()
  })
  test('refuses a zero job_timeout_max', () => {
    expect(parseAllowlist(YAML.replace('job_timeout_max: 30m', 'job_timeout_max: 0m')).ok).toBe(false)
  })
  test('F22: max_concurrent must be 1 in Phase 0, because the runner is serial', () => {
    for (const n of ['2', '8', '0']) {
      expect(parseAllowlist(YAML.replace('max_concurrent: 1', `max_concurrent: ${n}`)))
        .toEqual({ ok: false, detail: 'limits.max_concurrent must be 1 in Phase 0 (the runner is serial)' })
    }
    expect(parseAllowlist(YAML).ok).toBe(true)
  })
  test("F22: the installer's starter allowlist parses", () => {
    const tmpl = readFileSync(join(import.meta.dir, '..', 'nuance', 'install.sh.tmpl'), 'utf8')
    const m = /<<'YAML'\n([\s\S]*?)\nYAML\n/.exec(tmpl)
    expect(m).not.toBeNull()
    const r = parseAllowlist(m![1]!)
    expect(r).toMatchObject({ ok: true, allowlist: { limits: { max_concurrent: 1 } } })
  })
  test('F24: a claude effort must be one claude --help lists; other runtimes keep plain tokens', () => {
    const withEffort = (id: string, effort: string) => YAML.replace('models: [{ model: sonnet }, { model: haiku }]',
      `models: [{ model: sonnet, effort: [${effort}] }]`).replace('id: claude', `id: ${id}`)
    for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) expect(parseAllowlist(withEffort('claude', e)).ok).toBe(true)
    for (const e of ['ultra', 'Low', 'none']) expect(parseAllowlist(withEffort('claude', e))).toEqual({ ok: false, detail: 'effort in claude' })
    expect(parseAllowlist(withEffort('codex', 'ultra')).ok).toBe(true)
  })
})

describe('checkAdmission', () => {
  test('admits claude/sonnet review inside ~/Projects', () => {
    const h = home()
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/x' }), al(), h)).toEqual({ ok: true, cwdReal: join(h, 'Projects/x'), access: 'review', commands: [] })
  })
  test('refuses edit in a review folder, with a hint', () => {
    const r = checkAdmission(sampleRequest({ access: 'edit' }), al(), home())
    expect(r).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect((r as { hint?: string }).hint).toContain('access: edit')
  })
  describe('F00: an edit job runs git, which reads anywhere, so claude edit needs reads_anywhere', () => {
    // Phase 0.5: an edit job runs at its entry, which is a repository root, so the edit entry is ~/Projects/x.
    const editAl = (readsAnywhere: boolean): Allowlist => {
      const r = parseAllowlist(YAML.replace('path: ~/Projects', 'path: ~/Projects/x').replace('access: review', 'access: edit')
        .replace('models: [{ model: sonnet }, { model: haiku }]', `models: [{ model: sonnet }, { model: haiku }]${readsAnywhere ? '\n    reads_anywhere: true' : ''}`))
      if (!r.ok) throw new Error(r.detail)
      return r.allowlist
    }
    test('edit in an edit folder without the flag is refused, with the flag as the hint', () => {
      expect(checkAdmission(sampleRequest({ access: 'edit' }), editAl(false), home())).toEqual({ ok: false, reason: 'outside_allowlist',
        detail: 'edit jobs run git, which can read any file on this Mac', hint: 'add reads_anywhere: true to the claude runtime entry' })
    })
    test('with reads_anywhere: true the edit job is admitted', () => {
      const h = repoHome()
      expect(checkAdmission(sampleRequest({ access: 'edit' }), editAl(true), h)).toEqual({ ok: true, cwdReal: join(h, 'Projects/x'), access: 'edit', commands: [] })
    })
    test('review needs no flag, even in an edit folder', () => {
      const h = home()
      expect(checkAdmission(sampleRequest({ access: 'review' }), editAl(false), h)).toEqual({ ok: true, cwdReal: join(h, 'Projects/x'), access: 'edit', commands: [] })
    })
    test('a hint that grants edit also names the flag while it is missing, and only then', () => {
      const h = home()
      const escalate = checkAdmission(sampleRequest({ access: 'edit' }), al(), h)
      expect(refusalHint(escalate)).toContain('access: edit')
      expect(refusalHint(escalate)).toContain('reads_anywhere: true')
      const newFolder = checkAdmission(sampleRequest({ access: 'edit', cwd: '/' }), al(), h)
      expect(refusalHint(newFolder)).toContain('access: edit')
      expect(refusalHint(newFolder)).toContain('reads_anywhere: true')
      const flagged = parseAllowlist(YAML.replace('models: [{ model: sonnet }, { model: haiku }]', 'models: [{ model: sonnet }, { model: haiku }]\n    reads_anywhere: true'))
      if (!flagged.ok) throw new Error(flagged.detail)
      const escalateFlagged = checkAdmission(sampleRequest({ access: 'edit' }), flagged.allowlist, h)
      expect(refusalHint(escalateFlagged)).toBe('folders:\n  - path: ~/Projects\n    access: edit')
      expect(refusalHint(checkAdmission(sampleRequest({ access: 'review', cwd: '/' }), al(), h))).not.toContain('reads_anywhere')
    })
  })
  test('refuses an unknown peer, runtime or model', () => {
    const h = home()
    expect(checkAdmission(sampleRequest({ from_device: 'phone' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ runtime: 'codex' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ model: 'opus' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ model: 'sonnet', effort: 'high' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
  })
  test('every outside_allowlist refusal carries a hint', () => {
    const h = home()
    const refused = [
      sampleRequest({ from_device: 'phone' }),
      sampleRequest({ runtime: 'codex' }),
      sampleRequest({ model: 'opus' }),
      sampleRequest({ model: 'sonnet', effort: 'high' }),
      sampleRequest({ cwd: '~/Projects/nope' }),
      sampleRequest({ cwd: '/' }),
      sampleRequest({ access: 'edit' }),
    ]
    for (const req of refused) {
      const r = checkAdmission(req, al(), h)
      expect(r).toMatchObject({ ok: false, reason: 'outside_allowlist' })
      expect(typeof (r as { hint?: string }).hint).toBe('string')
    }
  })
  test('codex needs reads_anywhere; hermes is review-only', () => {
    const h = home()
    const r = parseAllowlist(YAML
      .replace('folders:', '  - id: codex\n    models: [{ model: gpt-6-astra }]\n  - id: hermes\n    models: [{ model: gpt-6-astra }]\n    reads_anywhere: true\nfolders:')
      .replace('access: review', 'access: edit'))
    if (!r.ok) throw new Error(r.detail)
    // codex without reads_anywhere is refused
    expect(checkAdmission(sampleRequest({ runtime: 'codex', model: 'gpt-6-astra' }), r.allowlist, h))
      .toMatchObject({ ok: false, reason: 'outside_allowlist', hint: expect.stringContaining('reads_anywhere') })
    // hermes with reads_anywhere: review is admitted
    expect(checkAdmission(sampleRequest({ runtime: 'hermes', model: 'gpt-6-astra', access: 'review' }), r.allowlist, h))
      .toMatchObject({ ok: true })
    // hermes edit is refused by the hermes check, not by the folder (which grants edit)
    expect(checkAdmission(sampleRequest({ runtime: 'hermes', model: 'gpt-6-astra', access: 'edit' }), r.allowlist, h))
      .toMatchObject({ ok: false, reason: 'outside_allowlist', detail: 'hermes is review-only' })
  })
  test('refuses a folder that does not exist or is outside the allowlist', () => {
    const h = home()
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/nope' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ cwd: '/' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
  })
  test('a consumer can read hint after narrowing on !ok, for both refusal reasons', () => {
    const h = home()
    const outside = checkAdmission(sampleRequest({ cwd: '/' }), al(), h)
    const tcc = checkAdmission(sampleRequest({ cwd: '~/Desktop' }), al(), h)
    expect(tcc).toMatchObject({ ok: false, reason: 'tcc_protected_folder' })
    expect(refusalHint(outside)).toEqual(expect.any(String))
    expect(refusalHint(tcc)).toBeUndefined()
  })
  test('refuses TCC-protected folders even when allowlisted', () => {
    const h = home()
    const docs = parseAllowlist(YAML.replace('path: ~/Projects', 'path: ~/Documents'))
    if (!docs.ok) throw new Error(docs.detail)
    expect(checkAdmission(sampleRequest({ cwd: '~/Documents/secret' }), docs.allowlist, h)).toMatchObject({ ok: false, reason: 'tcc_protected_folder' })
  })
  test('a symlink from an allowlisted folder into ~/Documents is refused by its target, not its spelling', () => {
    const h = home()
    symlinkSync(join(h, 'Documents/secret'), join(h, 'Projects/x/escape'))
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/x/escape' }), al(), h)).toMatchObject({ ok: false, reason: 'tcc_protected_folder' })
  })
  test('final review M8: a cwd spelled inside a TCC-protected folder is refused by its spelling first, even when realpath fails EPERM', () => {
    const h = home()
    const docs = parseAllowlist(YAML.replace('path: ~/Projects', 'path: ~/Documents'))
    if (!docs.ok) throw new Error(docs.detail)
    const asked: string[] = []
    // What the gatekeeper meets under sshd without a privacy grant: the folder cannot even be resolved.
    const eperm = (p: string): string | null => {
      asked.push(p)
      throw Object.assign(new Error(`EPERM: operation not permitted, realpath '${p}'`), { code: 'EPERM' })
    }
    for (const cwd of ['~/Documents', '~/Documents/secret', '~/Desktop/x', '~/Downloads', '~/Library/Mobile Documents/com~apple~CloudDocs',
      `${h}/Documents/secret`, '~/Projects/../Documents/secret', '~//Documents', '~/documents/secret']) {
      expect([cwd, checkAdmission(sampleRequest({ cwd }), docs.allowlist, h, eperm)]).toMatchObject([cwd, { ok: false, reason: 'tcc_protected_folder' }])
    }
    expect(asked).toEqual([]) // decided before any realpath
    // safeRealpath turns that EPERM into null: still the TCC refusal, not "does not exist".
    expect(checkAdmission(sampleRequest({ cwd: '~/Documents/secret' }), docs.allowlist, h, () => null))
      .toMatchObject({ ok: false, reason: 'tcc_protected_folder', detail: '~/Documents/secret is inside ~/Documents' })
  })
  test('final review M8: a name that only begins like a protected folder is not refused by spelling', () => {
    const h = home()
    mkdirSync(join(h, 'Projects/Documents-notes'), { recursive: true })
    mkdirSync(join(h, 'DocumentsArchive'), { recursive: true })
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/Documents-notes' }), al(), h)).toMatchObject({ ok: true })
    const wide = parseAllowlist(YAML.replace('path: ~/Projects', 'path: "~"')) // quoted: a bare ~ is YAML's null
    if (!wide.ok) throw new Error(wide.detail)
    expect(checkAdmission(sampleRequest({ cwd: '~/DocumentsArchive' }), wide.allowlist, h)).toMatchObject({ ok: true })
  })
  test('a symlink out of the allowlist is refused', () => {
    const h = home()
    mkdirSync(join(h, 'elsewhere'))
    symlinkSync(join(h, 'elsewhere'), join(h, 'Projects/y/out'))
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/y/out' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Phase 0.5 (design 2026-10-13-summon-build-access, §2 as revised by Ruling S1): the build access, the folder rules.
// Allowlists here are written as JSON, which YAML reads, so a value's exact type and bytes (a "true" string, a trailing
// newline, a number where a string belongs) are what the test says they are.
// ---------------------------------------------------------------------------------------------------------------------

type Folder = Record<string, unknown>
type Over = { flag?: boolean; runtimes?: unknown[]; home?: string }
const BUN = [{ run: 'bun test', args: false }]
const buildEntry = (path = '~/Projects/x', commands: unknown = BUN): Folder => ({ path, access: 'build', commands })
const editEntry = (path = '~/Projects/x'): Folder => ({ path, access: 'edit' })
const reviewEntry = (path = '~/Projects'): Folder => ({ path, access: 'review' })

function allowJson(folders: Folder[], over: Over = {}): string {
  return JSON.stringify({
    version: 1, device: 'nuance', peers: ['air'],
    runtimes: [{ id: 'claude', models: [{ model: 'sonnet' }, { model: 'haiku' }], reads_anywhere: over.flag ?? true }, ...(over.runtimes ?? [])],
    folders, limits: { max_concurrent: 1, starts_per_hour: 6, job_timeout_max: '30m' },
  })
}
const parseF = (folders: Folder[], over?: Over) => parseAllowlist(allowJson(folders, over), over?.home)
function allowOf(folders: Folder[], over?: Over): Allowlist {
  const r = parseF(folders, over)
  if (!r.ok) throw new Error(r.detail)
  return r.allowlist
}
/** An allowlist that did not come through the parser (a hand-built object): admission is the backstop for it, so its tests start here. */
function unparsed(folders: Folder[], over?: Over): Allowlist {
  return { ...allowOf([reviewEntry()], over), folders: folders as unknown as AllowlistFolder[] }
}
const refusedWith = (folders: Folder[], word: string) =>
  expect(parseF(folders)).toEqual({ ok: false, detail: expect.stringContaining(word) })

describe('Phase 0.5 parseAllowlist: a build entry', () => {
  test('parses, with args defaulting to false', () => {
    const a = allowOf([buildEntry('~/Projects/collab-trial', [{ run: 'bun test', args: true }, { run: 'bun run typecheck' }])])
    expect(a.folders).toEqual([{ path: '~/Projects/collab-trial', access: 'build',
      commands: [{ run: 'bun test', args: true }, { run: 'bun run typecheck', args: false }] }])
  })
  test('the design example parses from YAML text, exactly as the operator would write it', () => {
    const r = parseAllowlist(YAML.replace('access: review', `access: build
    commands:
      - run: bun test
        args: true        # optional; default false
      - run: bun run typecheck`))
    expect(r).toMatchObject({ ok: true, allowlist: { folders: [{ path: '~/Projects', access: 'build',
      commands: [{ run: 'bun test', args: true }, { run: 'bun run typecheck', args: false }] }] } })
  })
  test('review and edit entries carry no commands key at all', () => {
    expect(allowOf([reviewEntry(), editEntry('~/Elsewhere/x')]).folders).toEqual([
      { path: '~/Projects', access: 'review' }, { path: '~/Elsewhere/x', access: 'edit' }])
  })
  test('an unknown access is still refused', () => {
    refusedWith([{ path: '~/Projects/x', access: 'root', commands: BUN }], 'folder access')
  })

  describe('commands: required for build, forbidden otherwise, 1 to 16 entries', () => {
    test('a build entry without commands, or with none listed, is refused', () => {
      refusedWith([{ path: '~/Projects/x', access: 'build' }], 'commands')
      refusedWith([buildEntry('~/Projects/x', [])], 'commands')
      refusedWith([buildEntry('~/Projects/x', null)], 'commands')
    })
    test('commands on a review or an edit entry is refused', () => {
      refusedWith([{ ...reviewEntry(), commands: BUN }], 'commands')
      refusedWith([{ ...editEntry(), commands: BUN }], 'commands')
      refusedWith([{ ...editEntry(), commands: [] }], 'commands')
    })
    test('16 commands pass and 17 are refused', () => {
      const n = (k: number) => Array.from({ length: k }, (_, i) => ({ run: `tool${i}` }))
      expect(parseF([buildEntry('~/Projects/x', n(16))]).ok).toBe(true)
      refusedWith([buildEntry('~/Projects/x', n(17))], 'commands')
    })
    test('commands must be a list', () => {
      refusedWith([buildEntry('~/Projects/x', 'bun test')], 'commands')
      refusedWith([buildEntry('~/Projects/x', { run: 'bun test' })], 'commands')
    })
    test('a duplicate run is refused', () => {
      refusedWith([buildEntry('~/Projects/x', [{ run: 'bun test' }, { run: 'make' }, { run: 'bun test', args: true }])], 'duplicate')
      expect(parseF([buildEntry('~/Projects/x', [{ run: 'bun test' }, { run: 'bun test x' }])]).ok).toBe(true)
    })
    test('a command that is not a mapping with a string run is refused', () => {
      for (const c of [5, null, 'bun test', ['bun', 'test'], {}, { run: 5 }, { run: null }, { run: ['bun', 'test'] }, { args: true }]) {
        refusedWith([buildEntry('~/Projects/x', [c])], 'commands[0]')
      }
    })
    test('a command with a key other than run and args is refused, so a typo is never silently dropped', () => {
      refusedWith([buildEntry('~/Projects/x', [{ run: 'bun test', arg: true }])], 'commands[0]')
      refusedWith([buildEntry('~/Projects/x', [{ run: 'bun test', env: { A: 'b' } }])], 'commands[0]')
    })
  })

  describe('run: the regex, no .., no trailing newline, the basename denylist', () => {
    const ok = (run: string) => parseF([buildEntry('~/Projects/x', [{ run }])])
    test('what the regex admits', () => {
      for (const run of ['bun test', 'bun run typecheck', 'make', 'bun run test:unit', 'bun test timeout=5000', 'cargo test a.b-c_d',
        '/opt/homebrew/bin/bun test', '/usr/bin/make', 'x1 a b c d e f g', 'a.b-c_d x/y/z', 'bun test a..b']) {
        expect([run, ok(run).ok]).toEqual([run, true])
      }
    })
    test('seven arguments at most, each at most 128 characters, a program name at most 64', () => {
      expect(ok('x a b c d e f g').ok).toBe(true)
      expect(ok('x a b c d e f g h').ok).toBe(false)
      expect(ok(`x ${'a'.repeat(128)}`).ok).toBe(true)
      expect(ok(`x ${'a'.repeat(129)}`).ok).toBe(false)
      expect(ok('a'.repeat(64)).ok).toBe(true)
      expect(ok('a'.repeat(65)).ok).toBe(false)
      expect(ok(`/${'a'.repeat(200)}`).ok).toBe(true)
      expect(ok(`/${'a'.repeat(201)}`).ok).toBe(false)
    })
    test('what the regex refuses: shell syntax, flags, whitespace, case in a relative program, the empty string', () => {
      for (const run of ['', ' bun test', 'bun test ', 'bun  test', 'bun\ttest', 'Bun test', 'bun test > x', 'bun test >> x', 'bun test | tee x',
        'bun test; id', 'bun test && id', 'bun test $(id)', 'bun test `id`', 'bun test <(id)', 'bun "test"', "bun 'test'", 'bun test *', 'bun test ~/x',
        'bun test --cwd', 'bun -e x', 'FOO=1 bun test', 'bun test \\x', 'bun\ntest', '../bun test', './bun test', '~/bin/bun test', 'bun/bin test', '-bun']) {
        expect([run, ok(run)]).toEqual([run, { ok: false, detail: expect.stringContaining('commands[0].run') }])
      }
    })
    test('a trailing newline is refused', () => {
      expect(ok('bun test\n')).toEqual({ ok: false, detail: expect.stringContaining('commands[0].run') })
      expect(ok('bun test\n\n').ok).toBe(false)
      expect(ok('make\n').ok).toBe(false)
    })
    test('a .. path segment anywhere is refused, a dotted word is not', () => {
      for (const run of ['/opt/../usr/bin/bun test', '/usr/bin/.. x', 'bun run a/../b', 'bun test ../x', 'bun test a/..', '/../bin/make']) {
        expect([run, ok(run)]).toEqual([run, { ok: false, detail: expect.stringContaining('commands[0].run') }])
      }
      expect(ok('bun test a..b').ok).toBe(true)
      expect(ok('bun test a.../b').ok).toBe(true)
    })
    test('a program path that ends in a slash or a dot names no program', () => {
      for (const run of ['/usr/bin/ x', '/usr/bin/. x', '/ x', '/']) expect([run, ok(run).ok]).toEqual([run, false])
    })
    test('every denylisted basename is refused, bare or with arguments, by its absolute path, in any case', () => {
      const DENIED = ('sh bash zsh dash ksh fish env xargs find git curl wget ssh scp sftp nc open osascript sudo su launchctl python python3 perl ruby').split(' ')
      for (const name of DENIED) {
        for (const run of [name, `${name} x`, `/bin/${name}`, `/usr/bin/${name} x`, `/bin/${name.toUpperCase()} x`, `/usr/local/bin/${name[0]!.toUpperCase()}${name.slice(1)}`]) {
          expect([run, ok(run)]).toEqual([run, { ok: false, detail: expect.stringContaining('commands[0].run') }])
        }
      }
      // A name that only contains a denied one is a different program.
      for (const run of ['bashful x', 'gitx', 'shell', 'envy', '/usr/bin/pythonista x', 'cargo test git']) expect([run, ok(run).ok]).toEqual([run, true])
    })
  })

  describe('args: the boolean true or false and nothing else', () => {
    test('true and false pass', () => {
      expect(parseF([buildEntry('~/Projects/x', [{ run: 'bun test', args: true }, { run: 'make', args: false }])]).ok).toBe(true)
    })
    test('"true", "false", numbers, null and other words are refused', () => {
      for (const args of ['true', 'false', 'True', 'yes', 'no', 1, 0, null, [], {}]) {
        expect([args, parseF([buildEntry('~/Projects/x', [{ run: 'bun test', args }])])]).toEqual([args, { ok: false, detail: expect.stringContaining('args') }])
      }
    })
    test('as YAML text: a quoted "true" is refused and a bare true passes', () => {
      const yaml = (v: string) => YAML.replace('access: review', `access: build\n    commands:\n      - run: bun test\n        args: ${v}`)
      expect(parseAllowlist(yaml('"true"'))).toEqual({ ok: false, detail: expect.stringContaining('args') })
      expect(parseAllowlist(yaml("'false'"))).toEqual({ ok: false, detail: expect.stringContaining('args') })
      expect(parseAllowlist(yaml('true')).ok).toBe(true)
      expect(parseAllowlist(yaml('false')).ok).toBe(true)
    })
  })

  describe('sandbox_write and local_binding are not keys of Phase 0.5', () => {
    test('either one on a folder entry of any access is a parse error, whatever its value', () => {
      for (const key of ['sandbox_write', 'local_binding']) {
        for (const value of [true, false, null, [], ['/tmp'], '/tmp', {}]) {
          for (const e of [reviewEntry(), editEntry(), buildEntry()]) {
            expect([key, value, e.access, parseF([{ ...e, [key]: value }])]).toEqual([key, value, e.access, { ok: false, detail: expect.stringContaining(key) }])
          }
        }
      }
    })
    test('as YAML text', () => {
      expect(parseAllowlist(YAML.replace('access: review', 'access: review\n    local_binding: true'))).toEqual({ ok: false, detail: expect.stringContaining('local_binding') })
      expect(parseAllowlist(YAML.replace('access: review', 'access: review\n    sandbox_write: [/tmp]'))).toEqual({ ok: false, detail: expect.stringContaining('sandbox_write') })
    })
  })
})

describe('Phase 0.5 parseAllowlist: edit and build entries do not nest', () => {
  const nested = (a: Folder, b: Folder) => expect(parseF([a, b])).toEqual({ ok: false, detail: expect.stringContaining('inside') })
  const apart = (a: Folder, b: Folder) => expect(parseF([a, b]).ok).toBe(true)

  test('edit in edit, edit in build, build in edit, build in build — in either order', () => {
    const kinds: Array<(p: string) => Folder> = [editEntry, (p) => buildEntry(p)]
    for (const outer of kinds) {
      for (const inner of kinds) {
        nested(outer('~/Projects/a'), inner('~/Projects/a/b'))
        nested(inner('~/Projects/a/b'), outer('~/Projects/a'))
      }
    }
  })
  test('compared as spelled: a trailing slash, doubled slashes, .. and case are folded', () => {
    nested(editEntry('~/Projects/a/'), editEntry('~/Projects/a/b'))
    nested(editEntry('~/Projects/a'), editEntry('~/Projects/a/b/'))
    nested(editEntry('~/Projects/a'), editEntry('~//Projects//a//b'))
    nested(editEntry('~/Projects/a'), editEntry('~/Projects/q/../a/b'))
    nested(editEntry('~/Projects/a'), editEntry('~/Projects/a/b/c/../../b'))
    nested(editEntry('~/Projects/a'), editEntry('~/PROJECTS/A/B'))
    nested(editEntry('/srv/a'), editEntry('/srv/a/b'))
    nested(editEntry('/srv/a'), editEntry('/srv//x/../a/b'))
    nested(editEntry('/srv/A'), editEntry('/SRV/a/B'))
    nested(editEntry('~'), editEntry('~/Projects/a'))
    nested(editEntry('/'), editEntry('/srv/a'))
  })
  test('a review entry may lie inside an edit or a build entry, and may contain one', () => {
    apart(editEntry('~/Projects/a'), reviewEntry('~/Projects/a/docs'))
    apart(buildEntry('~/Projects/a'), reviewEntry('~/Projects/a/docs'))
    apart(reviewEntry('~/Projects/a/docs'), editEntry('~/Projects/a'))
    apart(reviewEntry('~/Projects'), editEntry('~/Projects/a'))
    apart(reviewEntry('~/Projects'), buildEntry('~/Projects/a'))
    apart(reviewEntry('~/Projects/a'), reviewEntry('~/Projects/a/b'))
  })
  test('siblings are not nested, including names that begin alike', () => {
    apart(editEntry('~/Projects/a'), editEntry('~/Projects/ab'))
    apart(editEntry('~/Projects/a'), editEntry('~/Projects/a-b'))
    apart(editEntry('~/Projects/a'), buildEntry('~/Projects/b'))
    apart(editEntry('/srv/a'), editEntry('/srv/a.b'))
  })
  test('a ~ spelling and an absolute spelling are not compared here: admission does that on realpaths', () => {
    apart(editEntry('~/Projects/a'), editEntry('/Users/yu/Projects/a/b'))
  })
  test('three entries: one nested pair anywhere refuses the whole allowlist', () => {
    expect(parseF([editEntry('~/Projects/a'), editEntry('~/Projects/b'), buildEntry('~/Projects/b/c')])).toEqual({ ok: false, detail: expect.stringContaining('inside') })
    expect(parseF([editEntry('~/Projects/a'), editEntry('~/Projects/b'), buildEntry('~/Projects/c')]).ok).toBe(true)
  })
})

describe('Phase 0.5 parseAllowlist: the build location rules, on the spelling', () => {
  const where = (path: string) => parseF([buildEntry(path)])
  const refusedWhere = (path: string) => expect([path, where(path)]).toEqual([path, { ok: false, detail: expect.stringContaining('build folder') }])

  test('a build folder lies strictly inside ~', () => {
    for (const p of ['~', '~/', '~/.', '~//', '~/Projects/..', '~/Projects/../..', '~/..', '~/../x']) refusedWhere(p)
    expect(where('~/Projects/x').ok).toBe(true)
    expect(where('~/Projects/x/').ok).toBe(true)
  })
  test('and is not, does not contain and does not lie within the sensitive set', () => {
    for (const p of ['~/.ssh', '~/.ssh/x', '~/.claude', '~/.claude/projects/x', '~/.config', '~/.config/summon', '~/.config/x/y',
      '~/.local', '~/.local/share/summon', '~/.local/state/x', '~/Library', '~/Library/x', '~/Library/Mobile Documents/com~apple~CloudDocs']) refusedWhere(p)
  })
  test('nor a TCC-protected folder', () => {
    for (const p of ['~/Desktop', '~/Desktop/x', '~/Documents', '~/Documents/secret', '~/Downloads', '~/Downloads/x/y']) refusedWhere(p)
  })
  test('the words are folded first: .., doubled slashes, a trailing slash and case', () => {
    for (const p of ['~/Projects/../.ssh', '~/Projects/x/../../.config/y', '~//.ssh//x', '~/.ssh/', '~/.SSH/x', '~/.Config/summon', '~/LIBRARY/x',
      '~/documents/secret', '~/DOWNLOADS', '~/./Desktop']) refusedWhere(p)
  })
  test('a name that only begins like a sensitive one is fine, and so is a nested one', () => {
    for (const p of ['~/.configx/y', '~/.sshd/x', '~/.local-tools/x', '~/Libraryx/y', '~/DocumentsArchive/x', '~/Projects/.config/x', '~/Projects/Library/x',
      '~/Projects/Desktop']) expect([p, where(p).ok]).toEqual([p, true])
  })
  describe('an absolute spelling is judged against the home the parser is given, by its words alone', () => {
    const H = '/Users/yu'
    const abs = (path: string, home = H) => parseF([buildEntry(path)], { home })
    const refusedAbs = (path: string, home = H) => expect([path, abs(path, home)]).toEqual([path, { ok: false, detail: expect.stringContaining('build folder') }])

    test('a folder outside the home is refused: /srv/ci/x, /etc/z, /, the home\'s parent and a sibling that shares a name prefix', () => {
      for (const p of ['/srv/ci/x', '/etc/z', '/', '/Users', '/Users/yuki/x', '/Users/yu-x/Projects/x', '/private/Users/yu/Projects/x']) refusedAbs(p)
    })
    test('the home itself is not strictly inside it', () => {
      for (const p of [H, `${H}/`, `${H}//`, `${H}/.`, `${H}/Projects/..`, `${H}/Projects/../..`]) refusedAbs(p)
    })
    test('the sensitive set and the TCC folders are refused whatever the spelling', () => {
      for (const p of ['.ssh', '.ssh/x', '.claude/projects/x', '.config', '.config/summon', '.local/share/summon', 'Library', 'Library/y',
        'Library/Mobile Documents/com~apple~CloudDocs', 'Desktop/x', 'Documents', 'Documents/secret', 'Downloads/x/y']) refusedAbs(`${H}/${p}`)
    })
    test('the words are folded first: .., doubled slashes, a trailing slash and case', () => {
      for (const p of [`${H}/Projects/../.ssh`, `${H}/Projects/x/../../.config/y`, `${H}//.ssh//x`, `${H}/.ssh/`, `${H}/.SSH/x`, `${H}/Library/../Library/y`,
        '/USERS/YU/.config/summon', `${H}/documents/secret`, `${H}/Projects/../../../etc/z`]) refusedAbs(p)
    })
    test('a folder strictly inside the home and outside the sensitive set parses, however it is spelled', () => {
      for (const p of [`${H}/Projects/x`, `${H}/Projects/x/`, `${H}//Projects//x`, `${H}/Projects/q/../x`, '/USERS/YU/projects/X', `${H}/.configx/y`, `${H}/Projects/.config/x`,
        `${H}/DocumentsArchive/x`]) expect([p, abs(p).ok]).toEqual([p, true])
    })
    test('the home is the one the parser is given: the same path is fine in one home and refused in another', () => {
      expect(abs('/srv/ci/x', '/srv/ci').ok).toBe(true) // the build folder is strictly inside that home
      refusedAbs('/srv/ci/x', '/Users/yu')
      refusedAbs('/Users/yu/Projects/x', '/Users/other')
    })
    test('a home that is not an absolute path judges no absolute spelling as inside it', () => {
      for (const home of ['', 'Users/yu', '~']) refusedAbs('/Users/yu/Projects/x', home)
    })
    test('the refusal is a parse error, so the whole allowlist fails closed and names the entry', () => {
      const r = parseF([reviewEntry(), buildEntry('/Users/yu/.ssh/x')], { home: H })
      expect(r).toEqual({ ok: false, detail: expect.stringContaining('folders[1].path') })
    })
    test('~ and absolute spellings of one place agree', () => {
      for (const [tilde, absolute] of [['~/Projects/x', `${H}/Projects/x`], ['~/.ssh/x', `${H}/.ssh/x`], ['~/Library/y', `${H}/Library/y`], ['~/Desktop', `${H}/Desktop`]]) {
        expect([tilde, parseF([buildEntry(tilde!)], { home: H }).ok]).toEqual([tilde, abs(absolute!).ok])
      }
    })
  })
  test('edit and review entries are not held to the location rules', () => {
    expect(parseF([editEntry('~/.config/x')]).ok).toBe(true)
    expect(parseF([reviewEntry('~/Library')]).ok).toBe(true)
  })
})

describe('Phase 0.5 checkAdmission: rank, the entry\'s access and commands, the hint', () => {
  const ranks = ['review', 'edit', 'build'] as const
  const entryFor = (a: (typeof ranks)[number]): Folder => (a === 'build' ? buildEntry() : { path: '~/Projects/x', access: a })

  test('rank: an entry admits jobs at its rank or below', () => {
    const h = repoHome()
    for (const [ei, entry] of ranks.entries()) {
      for (const [ji, job] of ranks.entries()) {
        const r = checkAdmission(sampleRequest({ access: job, cwd: '~/Projects/x' }), allowOf([entryFor(entry)]), h)
        expect([entry, job, r.ok]).toEqual([entry, job, ji <= ei])
        if (!r.ok) expect(r).toMatchObject({ reason: 'outside_allowlist', detail: `${job} is not allowed in ~/Projects/x (${entry})` })
      }
    }
  })
  test('the result carries the matched entry\'s access and commands, not the request\'s', () => {
    const h = repoHome()
    const cmds = [{ run: 'bun test', args: true }, { run: 'bun run typecheck', args: false }]
    const a = allowOf([buildEntry('~/Projects/x', cmds)])
    const cwdReal = join(h, 'Projects/x')
    for (const access of ['review', 'edit', 'build'] as const) {
      expect(checkAdmission(sampleRequest({ access }), a, h)).toEqual({ ok: true, cwdReal, access: 'build', commands: cmds })
    }
    expect(checkAdmission(sampleRequest({ access: 'edit' }), allowOf([editEntry()]), h)).toEqual({ ok: true, cwdReal, access: 'edit', commands: [] })
    expect(checkAdmission(sampleRequest({ access: 'review' }), allowOf([reviewEntry('~/Projects/x')]), h)).toEqual({ ok: true, cwdReal, access: 'review', commands: [] })
  })
  test('the commands in the result are the entry\'s own list, not a shared reference the caller could change', () => {
    const h = repoHome()
    const a = allowOf([buildEntry()])
    const r = checkAdmission(sampleRequest({ access: 'build' }), a, h)
    if (!r.ok) throw new Error(r.detail)
    r.commands.push({ run: 'evil', args: true })
    expect(a.folders[0]!.commands).toEqual(BUN)
  })

  const BUILD_HINT = (path: string) => `folders:\n  - path: ${path}\n    access: build\n    commands:\n      - run: bun test`
  test('the hint for a build refusal is a complete entry with a commands: line', () => {
    const h = repoHome()
    const a = allowOf([editEntry()])
    expect(refusalHint(checkAdmission(sampleRequest({ access: 'build', cwd: '~/Projects/x' }), a, h))).toBe(BUILD_HINT('~/Projects/x'))
    expect(refusalHint(checkAdmission(sampleRequest({ access: 'build', cwd: '~/Projects/y' }), a, h))).toBe(BUILD_HINT('~/Projects/y')) // not an entry
    expect(refusalHint(checkAdmission(sampleRequest({ access: 'build', cwd: '/' }), a, h))).toBe(BUILD_HINT('/'))
    const noFlag = allowOf([editEntry()], { flag: false })
    expect(refusalHint(checkAdmission(sampleRequest({ access: 'build', cwd: '~/Projects/x' }), noFlag, h)))
      .toBe(`${BUILD_HINT('~/Projects/x')}\nand add reads_anywhere: true to the claude runtime entry`)
  })
  test('an edit hint has no commands, and a review refusal carries no entry at all', () => {
    const h = repoHome()
    const a = allowOf([reviewEntry('~/Projects/x')])
    expect(refusalHint(checkAdmission(sampleRequest({ access: 'edit' }), a, h))).toBe('folders:\n  - path: ~/Projects/x\n    access: edit')
    expect(refusalHint(checkAdmission(sampleRequest({ access: 'review', cwd: '/' }), a, h))).toBe('folders:\n  - path: /\n    access: review')
  })

  describe('editNeedsFlag is rank >= 1: build needs reads_anywhere on claude too', () => {
    test('build without the flag is refused with the flag as the hint, edit unchanged', () => {
      const h = repoHome()
      expect(checkAdmission(sampleRequest({ access: 'build' }), allowOf([buildEntry()], { flag: false }), h)).toEqual({ ok: false, reason: 'outside_allowlist',
        detail: 'build jobs run git, which can read any file on this Mac', hint: 'add reads_anywhere: true to the claude runtime entry' })
      expect(checkAdmission(sampleRequest({ access: 'edit' }), allowOf([buildEntry()], { flag: false }), h)).toEqual({ ok: false, reason: 'outside_allowlist',
        detail: 'edit jobs run git, which can read any file on this Mac', hint: 'add reads_anywhere: true to the claude runtime entry' })
    })
    test('review needs no flag in a build folder, and build is admitted with it', () => {
      const h = repoHome()
      expect(checkAdmission(sampleRequest({ access: 'review' }), allowOf([buildEntry()], { flag: false }), h)).toMatchObject({ ok: true, access: 'build' })
      expect(checkAdmission(sampleRequest({ access: 'build' }), allowOf([buildEntry()], { flag: true }), h)).toMatchObject({ ok: true, access: 'build' })
    })
  })
})

describe('Phase 0.5 checkAdmission: the refusal order', () => {
  const extra = (flags: { codex?: boolean; hermes?: boolean } = { codex: true, hermes: true }) => [
    { id: 'codex', models: [{ model: 'gpt-6-astra' }], reads_anywhere: flags.codex ?? true },
    { id: 'hermes', models: [{ model: 'gpt-6-astra' }], reads_anywhere: flags.hermes ?? true }]
  const detailOf = (r: Admission) => (r.ok ? 'ADMITTED' : r.detail)

  test('step 2 keeps the non-claude reads_anywhere check; step 3 refuses non-review access on a non-claude runtime', () => {
    const h = repoHome()
    const withFlags = allowOf([buildEntry()], { runtimes: extra() })
    const noFlags = allowOf([buildEntry()], { runtimes: extra({ codex: false, hermes: false }) })
    const codex = (access: 'review' | 'edit' | 'build') => sampleRequest({ runtime: 'codex', model: 'gpt-6-astra', access })
    const hermes = (access: 'review' | 'edit' | 'build') => sampleRequest({ runtime: 'hermes', model: 'gpt-6-astra', access })
    // codex + build: the flag check comes first, so without the flag that is the message; with it, step 3's.
    expect(detailOf(checkAdmission(codex('build'), noFlags, h))).toBe('codex can read any file on this Mac')
    expect(detailOf(checkAdmission(codex('build'), withFlags, h))).toBe('codex is not run by Summon')
    expect(detailOf(checkAdmission(codex('edit'), withFlags, h))).toBe('codex is not run by Summon')
    expect(detailOf(checkAdmission(hermes('build'), noFlags, h))).toBe('hermes can read any file on this Mac')
    expect(detailOf(checkAdmission(hermes('build'), withFlags, h))).toBe('hermes is review-only')
    expect(detailOf(checkAdmission(hermes('edit'), withFlags, h))).toBe('hermes is review-only')
    // review stays as Phase 0 had it
    expect(detailOf(checkAdmission(codex('review'), withFlags, h))).toBe('ADMITTED')
    expect(detailOf(checkAdmission(hermes('review'), withFlags, h))).toBe('ADMITTED')
    // every one of these is outside_allowlist with a hint
    for (const r of [checkAdmission(codex('build'), noFlags, h), checkAdmission(codex('build'), withFlags, h), checkAdmission(hermes('build'), withFlags, h)]) {
      expect(r).toMatchObject({ ok: false, reason: 'outside_allowlist', hint: expect.any(String) })
    }
  })

  test('twelve steps, each beaten by the one before it', () => {
    const h = repoHome()
    mkdirSync(join(h, 'Projects/z'), { recursive: true }) // exists, not a repository
    const flagless = (folders: Folder[]) => allowOf(folders, { flag: false, runtimes: extra() })
    const full = (folders: Folder[]) => allowOf(folders, { runtimes: extra() })
    const steps: Array<[string, Admission, string]> = [
      // 1 peer beats 2 runtime
      ['1 peer', checkAdmission(sampleRequest({ from_device: 'phone', runtime: 'bash' as never }), full([buildEntry()]), h), 'peer phone is not allowed'],
      // 2 runtime beats the flag check, which beats 3
      ['2 runtime', checkAdmission(sampleRequest({ runtime: 'codex', model: 'nope' }), allowOf([buildEntry()]), h), 'runtime codex is not allowed'],
      ['2 flag', checkAdmission(sampleRequest({ runtime: 'codex', model: 'nope', access: 'build' }), allowOf([buildEntry()], { runtimes: extra({ codex: false }) }), h),
        'codex can read any file on this Mac'],
      // 3 non-claude non-review beats 4 model
      ['3 codex', checkAdmission(sampleRequest({ runtime: 'codex', model: 'nope', access: 'build' }), full([buildEntry()]), h), 'codex is not run by Summon'],
      ['3 hermes', checkAdmission(sampleRequest({ runtime: 'hermes', model: 'nope', access: 'edit' }), full([buildEntry()]), h), 'hermes is review-only'],
      // 4 model beats 5 TCC spelling
      ['4 model', checkAdmission(sampleRequest({ model: 'opus', cwd: '~/Documents/x' }), full([buildEntry()]), h), 'model opus is not allowed for claude'],
      // 5 TCC spelling beats 6 cwd exists
      ['5 tcc spelling', checkAdmission(sampleRequest({ cwd: '~/Documents/nope' }), full([buildEntry()]), h), '~/Documents/nope is inside ~/Documents'],
      // 6 cwd exists beats 8 folder match
      ['6 cwd exists', checkAdmission(sampleRequest({ cwd: '~/Projects/nope', access: 'build' }), full([buildEntry()]), h), 'cwd ~/Projects/nope does not exist on this Mac'],
      // 8 folder match beats 9
      ['8 folder match', checkAdmission(sampleRequest({ cwd: '~/Projects/z', access: 'build' }), full([buildEntry()]), h), 'folder ~/Projects/z is not allowed'],
      // 9 ambiguous beats 10 rank
      ['9 ambiguous', checkAdmission(sampleRequest({ access: 'build' }), full([editEntry(), editEntry(`${h}/Projects/x`)]), h), 'ambiguous folder entries'],
      // 10 rank beats 11 flag
      ['10 rank', checkAdmission(sampleRequest({ access: 'build' }), flagless([editEntry()]), h), 'build is not allowed in ~/Projects/x (edit)'],
      // 11 flag beats 12 folder checks (cwd is a subfolder here)
      ['11 flag', checkAdmission(sampleRequest({ access: 'build', cwd: '~/Projects/x' }), flagless([buildEntry('~/Projects')]), h), 'build jobs run git, which can read any file on this Mac'],
    ]
    for (const [name, got, want] of steps) expect([name, detailOf(got)]).toEqual([name, want])
  })

  test('step 12 order: location, then cwd at the entry, then a real .git, then nesting', () => {
    const h = repoHome()
    for (const d of ['.config/x', 'Projects/z/sub', 'Projects/x/inner']) mkdirSync(join(h, d), { recursive: true })
    // location first: an absolute build entry in ~/.config, with cwd below it, no .git anywhere
    expect(detailOf(checkAdmission(sampleRequest({ access: 'build', cwd: '~/.config/x' }), unparsed([buildEntry(`${h}/.config`)]), h))).toContain('build folders must lie')
    // cwd at the entry second: neither folder is a repository, the cwd is below the entry
    expect(detailOf(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/z/sub' }), allowOf([editEntry('~/Projects/z')]), h))).toContain('folder entry itself')
    // a real .git third: cwd is at the entry, no .git, and the entry overlaps another entry
    const overlapping = allowOf([editEntry('~/Projects/z'), editEntry(`${h}/Projects/z/sub`)]) // a ~ spelling against an absolute one
    expect(detailOf(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/z' }), overlapping, h))).toContain('.git')
    // nesting last
    repo(join(h, 'Projects/z'))
    expect(detailOf(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/z' }), overlapping, h))).toContain('overlaps')
  })
})

describe('Phase 0.5 checkAdmission: ambiguous folder entries', () => {
  test('two entries with equal-length realpaths are refused, by any spelling, symlink or access', () => {
    const h = repoHome()
    symlinkSync(join(h, 'Projects/x'), join(h, 'Projects/link'))
    for (const folders of [
      [reviewEntry('~/Projects/x'), reviewEntry(`${h}/Projects/x`)],
      [reviewEntry('~/Projects/x'), reviewEntry('~/Projects/link')],
      [reviewEntry('~/Projects/x'), editEntry('~/Projects/x/')],
      [editEntry('~/Projects/x'), buildEntry('~/Projects/x')],
    ]) {
      const r = checkAdmission(sampleRequest({ access: 'review' }), allowOf(folders), h)
      expect(r).toMatchObject({ ok: false, reason: 'outside_allowlist', detail: 'ambiguous folder entries', hint: expect.any(String) })
    }
  })
  test('nested entries of different lengths are not ambiguous: the longest wins, as in Phase 0', () => {
    const h = repoHome()
    const a = allowOf([reviewEntry('~/Projects'), reviewEntry('~/Projects/x')])
    expect(checkAdmission(sampleRequest({ access: 'review' }), a, h)).toMatchObject({ ok: true, cwdReal: join(h, 'Projects/x') })
    const b = allowOf([reviewEntry('~/Projects'), editEntry('~/Projects/x')])
    expect(checkAdmission(sampleRequest({ access: 'edit' }), b, h)).toMatchObject({ ok: true, access: 'edit' })
  })
  test('an entry that does not contain the cwd is not part of the ambiguity', () => {
    const h = repoHome()
    symlinkSync(join(h, 'Projects/y'), join(h, 'Projects/ylink'))
    const a = allowOf([reviewEntry('~/Projects/y'), reviewEntry('~/Projects/ylink'), reviewEntry('~/Projects/x')])
    expect(checkAdmission(sampleRequest({ access: 'review', cwd: '~/Projects/x' }), a, h)).toMatchObject({ ok: true })
    expect(checkAdmission(sampleRequest({ access: 'review', cwd: '~/Projects/y' }), a, h)).toMatchObject({ ok: false, detail: 'ambiguous folder entries' })
  })
})

describe('Phase 0.5 checkAdmission: where an edit or build job may run', () => {
  const nope = (r: Admission, word: string) => expect(r).toMatchObject({ ok: false, reason: 'outside_allowlist', detail: expect.stringContaining(word), hint: expect.any(String) })
  const jobs = ['edit', 'build'] as const
  const entries: Array<[string, (path: string) => Folder]> = [['edit', editEntry], ['build', (p) => buildEntry(p)]]

  test('cwdReal must equal the matched entry\'s realpath; a review job may run anywhere inside', () => {
    const h = repoHome()
    mkdirSync(join(h, 'Projects/x/sub'), { recursive: true })
    for (const [kind, entry] of entries) {
      for (const job of jobs) {
        if (job === 'build' && kind === 'edit') continue
        const a = allowOf([entry('~/Projects/x')])
        expect([kind, job, checkAdmission(sampleRequest({ access: job, cwd: '~/Projects/x' }), a, h).ok]).toEqual([kind, job, true])
        nope(checkAdmission(sampleRequest({ access: job, cwd: '~/Projects/x/sub' }), a, h), 'folder entry itself')
        // a ~ spelling, a trailing slash, a symlink to the same place: the same realpath, so admitted
        expect(checkAdmission(sampleRequest({ access: job, cwd: `${h}/Projects/x/` }), a, h).ok).toBe(true)
      }
      expect(checkAdmission(sampleRequest({ access: 'review', cwd: '~/Projects/x/sub' }), allowOf([entry('~/Projects/x')]), h)).toMatchObject({ ok: true, cwdReal: join(h, 'Projects/x/sub') })
    }
  })
  test('a symlink as the cwd or the entry that resolves to the entry\'s realpath is the entry', () => {
    const h = repoHome()
    symlinkSync(join(h, 'Projects/x'), join(h, 'Projects/xl'))
    expect(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/xl' }), allowOf([editEntry('~/Projects/x')]), h)).toMatchObject({ ok: true, cwdReal: join(h, 'Projects/x') })
    expect(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/x' }), allowOf([editEntry('~/Projects/xl')]), h)).toMatchObject({ ok: true, cwdReal: join(h, 'Projects/x') })
  })

  test('the entry must be a git repository root with a real .git directory', () => {
    const h = home()
    const at = (name: string) => { mkdirSync(join(h, 'Projects', name), { recursive: true }); return join(h, 'Projects', name) }
    const cases: Array<[string, string, string]> = []
    // none at all
    at('none'); cases.push(['none', 'none', '.git'])
    // a parent repository: the parent has .git, the folder does not
    repo(at('parent')); at('parent/child'); cases.push(['parent/child', 'parent child', '.git'])
    // a gitfile (a worktree or submodule link)
    const gf = at('gitfile'); writeFileSync(join(gf, '.git'), 'gitdir: ../elsewhere/.git\n'); cases.push(['gitfile', 'gitfile', '.git'])
    // a symlinked .git
    const sl = at('symlinked'); mkdirSync(join(h, 'real-git')); symlinkSync(join(h, 'real-git'), join(sl, '.git')); cases.push(['symlinked', 'symlink', '.git'])
    // a symlink to a file
    const sf = at('symfile'); writeFileSync(join(h, 'a-file'), ''); symlinkSync(join(h, 'a-file'), join(sf, '.git')); cases.push(['symfile', 'symlink to file', '.git'])
    // a dangling symlink
    const dl = at('dangling'); symlinkSync(join(h, 'nowhere'), join(dl, '.git')); cases.push(['dangling', 'dangling', '.git'])
    // a .git directory that is not a repository: git skips it and walks up to the enclosing repository, so it is not a root
    repo(at('hparent')); mkdirSync(join(at('hparent/empty'), '.git')); cases.push(['hparent/empty', 'empty .git inside a repository', 'HEAD'])
    mkdirSync(join(at('emptyalone'), '.git')); cases.push(['emptyalone', 'empty .git on its own', 'HEAD'])
    // a real repository whose HEAD is gone, or is not a regular file; `noHead` returns the path HEAD had
    const noHead = (name: string) => { const head = join(repo(at(name)), '.git', 'HEAD'); unlinkSync(head); return head }
    noHead('nohead'); cases.push(['nohead', 'HEAD deleted', 'HEAD'])
    writeFileSync(join(h, 'head-file'), 'ref: refs/heads/main\n')
    symlinkSync(join(h, 'head-file'), noHead('headlink')); cases.push(['headlink', 'HEAD a symlink to a file', 'HEAD'])
    symlinkSync(join(h, 'nowhere'), noHead('headdangling')); cases.push(['headdangling', 'HEAD a dangling symlink', 'HEAD'])
    mkdirSync(noHead('headdir')); cases.push(['headdir', 'HEAD a directory', 'HEAD'])
    repo(at('good'))
    for (const [name, label, word] of cases) {
      for (const [kind, entry] of entries) {
        for (const job of jobs) {
          if (job === 'build' && kind === 'edit') continue
          const r = checkAdmission(sampleRequest({ access: job, cwd: `~/Projects/${name}` }), allowOf([entry(`~/Projects/${name}`)]), h)
          expect([label, kind, job, r.ok]).toEqual([label, kind, job, false])
          nope(r, word)
        }
      }
    }
    expect(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/good' }), allowOf([editEntry('~/Projects/good')]), h)).toMatchObject({ ok: true })
    // review needs none of this
    expect(checkAdmission(sampleRequest({ access: 'review', cwd: '~/Projects/none' }), allowOf([editEntry('~/Projects/none')]), h)).toMatchObject({ ok: true })
  })

  describe('with real git: admission takes a .git directory only where git itself would, so git never walks up to a parent repository', () => {
    // Every way a job can leave its own .git, with one command, such that git skips it and uses the enclosing repository.
    // `git` is where real git (2.39) resolves the folder; `word` is what a refusal names, or null when admission accepts.
    // A state where git says 'child' but admission refuses is a deliberate narrowing (admission fails closed).
    const HEX40 = 'a1'.repeat(20); const HEX64 = 'b2'.repeat(32)
    type State = { label: string; git: 'child' | 'parent'; word: string | null; set: (g: string, spare: string) => void }
    const head = (label: string, content: string, git: 'child' | 'parent', word: string | null): State =>
      ({ label, git, word, set: (g) => writeFileSync(join(g, 'HEAD'), content) })
    const without = (label: string, name: 'objects' | 'refs'): State =>
      ({ label: `no ${name}`, git: 'parent', word: name, set: (g) => rmSync(join(g, name), { recursive: true }) })
    const asFile = (name: 'objects' | 'refs'): State =>
      ({ label: `${name} is a file`, git: 'parent', word: name, set: (g) => { rmSync(join(g, name), { recursive: true }); writeFileSync(join(g, name), '') } })
    const symlinked = (name: 'objects' | 'refs'): State =>
      ({ label: `${name} is a symlink to a directory`, git: 'child', word: name, set: (g, spare) => { renameSync(join(g, name), join(spare, name)); symlinkSync(join(spare, name), join(g, name)) } })
    const mode = (label: string, name: 'objects' | 'refs' | 'HEAD', m: number): State =>
      ({ label, git: 'parent', word: name, set: (g) => chmodSync(join(g, name), m) })
    const STATES: State[] = [
      { label: 'a plain repository', git: 'child', word: null, set: () => {} },
      head('HEAD names a branch, no newline', 'ref: refs/heads/main', 'child', null),
      head('HEAD names a nested branch', 'ref: refs/heads/feature/x\n', 'child', null),
      head('HEAD names the reftable placeholder', 'ref: refs/heads/.invalid\n', 'child', null),
      head('HEAD is a detached sha-1', `${HEX40}\n`, 'child', null),
      head('HEAD is a detached sha-256', `${HEX64}\n`, 'child', null),
      head('HEAD is x', 'x', 'parent', 'HEAD'),
      head('HEAD is empty', '', 'parent', 'HEAD'),
      head('HEAD names no refs/ path', 'ref: heads/main\n', 'parent', 'HEAD'),
      head('HEAD is only "ref: refs"', 'ref: refs\n', 'parent', 'HEAD'),
      head('HEAD is a short hex id', `${HEX40.slice(0, 39)}\n`, 'parent', 'HEAD'),
      head('HEAD is 300 bytes of junk', 'x'.repeat(300), 'parent', 'HEAD'),
      head('HEAD is a ref line and then more text (narrower than git)', 'ref: refs/heads/main\ngarbage\n', 'child', 'HEAD'),
      mode('HEAD cannot be read', 'HEAD', 0o000),
      without('', 'objects'), without('', 'refs'), asFile('objects'), asFile('refs'),
      mode('objects cannot be entered', 'objects', 0o000), mode('refs cannot be entered', 'refs', 0o000),
      mode('refs has no search bit', 'refs', 0o600),
      symlinked('objects'), symlinked('refs'),
      { label: 'a commondir naming a missing directory', git: 'parent', word: 'commondir', set: (g) => writeFileSync(join(g, 'commondir'), '../nonexistent\n') },
      { label: 'a commondir naming a directory with no objects or refs', git: 'parent', word: 'commondir', set: (g, spare) => { mkdirSync(join(spare, 'common')); writeFileSync(join(g, 'commondir'), `${join(spare, 'common')}\n`) } },
      { label: 'a commondir naming another repository (narrower than git)', git: 'child', word: 'commondir', set: (g, spare) => { repo(join(spare, 'other')); writeFileSync(join(g, 'commondir'), `${join(spare, 'other/.git')}\n`) } },
      { label: 'an empty .git', git: 'parent', word: 'HEAD', set: (g) => { rmSync(g, { recursive: true }); mkdirSync(g) } },
    ]
    const root = process.getuid?.() === 0 // permission bits do not bind root

    test('each state: where real git resolves the folder, and what admission says', () => {
      const h = home()
      const env = { PATH: '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', HOME: h, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
      const git = (cwd: string, ...args: string[]) => {
        const r = Bun.spawnSync(['git', ...args], { cwd, env })
        return { ok: r.exitCode === 0, out: new TextDecoder().decode(r.stdout).trim() }
      }
      const parent = join(h, 'Projects/gparent')
      mkdirSync(parent, { recursive: true })
      expect(git(parent, 'init', '-q').ok).toBe(true)
      const restore: string[] = []
      try {
        for (const [i, st] of STATES.entries()) {
          if (root && st.label.match(/cannot be|no search bit/)) continue
          const child = join(parent, `c${i}`); const spare = join(h, `spare${i}`)
          mkdirSync(child); mkdirSync(spare)
          expect(git(child, 'init', '-q').ok).toBe(true)
          st.set(join(child, '.git'), spare)
          for (const n of ['HEAD', 'objects', 'refs']) restore.push(join(child, '.git', n))
          const toplevel = git(child, 'rev-parse', '--show-toplevel').out
          expect([st.label, toplevel]).toEqual([st.label, st.git === 'child' ? child : parent])
          for (const access of ['edit', 'build'] as const) {
            const entry = access === 'edit' ? editEntry(`~/Projects/gparent/c${i}`) : buildEntry(`~/Projects/gparent/c${i}`)
            const r = checkAdmission(sampleRequest({ access, cwd: `~/Projects/gparent/c${i}` }), allowOf([entry]), h)
            if (st.word === null) expect([st.label, access, r]).toEqual([st.label, access, expect.objectContaining({ ok: true, cwdReal: child })])
            else { expect([st.label, access, r.ok]).toEqual([st.label, access, false]); nope(r, st.word) }
            // the one property that matters: admitted means git works on this folder, not on its parent
            if (r.ok) expect([st.label, toplevel]).toEqual([st.label, child])
          }
        }
      } finally {
        for (const p of restore) { try { chmodSync(p, 0o755) } catch { /* removed by the state */ } }
      }
    })
  })

  test('no other edit or build entry may lie inside the matched one or contain it, by realpath', () => {
    const h = repoHome()
    repo(join(h, 'Projects/outer')); mkdirSync(join(h, 'Projects/outer/inner'), { recursive: true }); repo(join(h, 'Projects/outer/inner'))
    // a symlink into another entry: its spelling is apart, its realpath is inside
    symlinkSync(join(h, 'Projects/outer/inner'), join(h, 'Projects/link'))
    const viaLink = allowOf([editEntry('~/Projects/outer'), editEntry('~/Projects/link')])
    nope(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/outer' }), viaLink, h), 'overlaps')
    nope(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/link' }), viaLink, h), 'overlaps')
    // a ~ spelling against an absolute spelling of the same place, in both orders
    for (const folders of [[editEntry('~/Projects/outer'), editEntry(`${h}/Projects/outer/inner`)], [editEntry(`${h}/Projects/outer/inner`), editEntry('~/Projects/outer')]]) {
      nope(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/outer' }), allowOf(folders), h), 'overlaps')
      nope(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/outer/inner' }), allowOf(folders), h), 'overlaps')
    }
    // edit against build
    nope(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/outer' }), allowOf([buildEntry('~/Projects/outer'), editEntry(`${h}/Projects/outer/inner`)]), h), 'overlaps')
    // a review entry inside is fine, and unrelated entries are fine
    const fine = allowOf([editEntry('~/Projects/outer'), reviewEntry(`${h}/Projects/outer/inner`), editEntry('~/Projects/x'), buildEntry('~/Projects/y')])
    expect(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/outer' }), fine, h)).toMatchObject({ ok: true })
    expect(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/x' }), fine, h)).toMatchObject({ ok: true })
    // a review job in a folder that overlaps is not held to it
    expect(checkAdmission(sampleRequest({ access: 'review', cwd: '~/Projects/outer' }), viaLink, h)).toMatchObject({ ok: true })
  })
  test('an entry whose folder does not exist yet is compared by its spelling, so it cannot be created inside an edit folder', () => {
    const h = repoHome()
    const a = allowOf([editEntry('~/Projects/x'), editEntry(`${h}/Projects/x/future`)])
    nope(checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/x' }), a, h), 'overlaps')
  })

  describe('a build entry\'s location, on realpaths', () => {
    const at = (h: string, rel: string) => { repo(join(h, rel)); return join(h, rel) }
    test('inside ~, outside the sensitive set', () => {
      const h = home()
      for (const rel of ['.ssh/proj', '.claude/proj', '.config/proj', '.local/proj', 'Library/proj', '.SSH/proj']) {
        const dir = at(h, rel)
        const r = checkAdmission(sampleRequest({ access: 'build', cwd: dir }), unparsed([buildEntry(dir)]), h)
        expect([rel, r.ok]).toEqual([rel, false])
        nope(r, 'build folders must lie')
      }
      // a symlink spelled inside ~/Projects that lands in a sensitive folder is refused by where it lands
      const target = at(h, '.ssh/via')
      symlinkSync(target, join(h, 'Projects/viassh'))
      nope(checkAdmission(sampleRequest({ access: 'build', cwd: '~/Projects/viassh' }), allowOf([buildEntry('~/Projects/viassh')]), h), 'build folders must lie')
      expect(checkAdmission(sampleRequest({ access: 'build', cwd: '~/Projects/x' }), allowOf([buildEntry('~/Projects/x')]), repoHome()).ok).toBe(true)
    })
    test('a sensitive folder that is itself a symlink is judged by both its spelling and its target', () => {
      const h = home()
      const dotfiles = at(h, 'dotfiles'); mkdirSync(join(dotfiles, 'cfg'), { recursive: true }); repo(join(dotfiles, 'cfg'))
      symlinkSync(dotfiles, join(h, '.config'))
      nope(checkAdmission(sampleRequest({ access: 'build', cwd: '~/dotfiles/cfg' }), unparsed([buildEntry(`${h}/dotfiles/cfg`)]), h), 'build folders must lie')
      nope(checkAdmission(sampleRequest({ access: 'build', cwd: '~/dotfiles' }), unparsed([buildEntry(`${h}/dotfiles`)]), h), 'build folders must lie')
    })
    test('strictly inside ~: ~ itself, and a folder outside ~, are refused', () => {
      const h = home(); repo(h)
      nope(checkAdmission(sampleRequest({ access: 'build', cwd: h }), unparsed([buildEntry(h)]), h), 'build folders must lie')
      const elsewhere = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-al-out-')))); repo(elsewhere)
      nope(checkAdmission(sampleRequest({ access: 'build', cwd: elsewhere }), unparsed([buildEntry(elsewhere)]), h), 'build folders must lie')
    })
    test('the rules bind a build entry only: edit entries are not held to them, and neither is a review job in a build entry', () => {
      const h = home(); const dir = at(h, '.config/proj')
      // ~/.config is not a TCC folder: an edit entry there is admitted, as in Phase 0
      expect(checkAdmission(sampleRequest({ access: 'edit', cwd: dir }), allowOf([editEntry(dir)]), h)).toMatchObject({ ok: true })
      expect(checkAdmission(sampleRequest({ access: 'review', cwd: dir }), unparsed([buildEntry(dir)]), h)).toMatchObject({ ok: true })
    })
    test('an edit job in a build entry is held to the build entry\'s location rules too', () => {
      const h = home(); const dir = at(h, '.config/proj')
      nope(checkAdmission(sampleRequest({ access: 'edit', cwd: dir }), unparsed([buildEntry(dir)]), h), 'build folders must lie')
    })
  })

  test('a build entry with no commands cannot be built from the allowlist parser, and admission refuses one anyway', () => {
    const h = repoHome()
    const a = allowOf([reviewEntry('~/Projects/x')])
    for (const commands of [undefined, []]) {
      const broken: Allowlist = { ...a, folders: [{ path: '~/Projects/x', access: 'build', ...(commands ? { commands } : {}) }] }
      for (const job of jobs) nope(checkAdmission(sampleRequest({ access: job }), broken, h), 'commands')
      expect(refusalHint(checkAdmission(sampleRequest({ access: 'build' }), broken, h))).toContain('commands:')
    }
  })

  test('every step 12 refusal for a build job carries a hint with a commands: line; an edit job\'s does not', () => {
    const h = repoHome()
    mkdirSync(join(h, 'Projects/x/sub'), { recursive: true })
    repo(join(h, 'Projects/x/sub/deep'))
    mkdirSync(join(h, 'Projects/z/.git'), { recursive: true })
    const refused: Admission[] = [
      checkAdmission(sampleRequest({ access: 'build', cwd: '~/Projects/x/sub' }), allowOf([buildEntry()]), h), // cwd below the entry
      checkAdmission(sampleRequest({ access: 'build', cwd: '~/Projects/x/sub' }), allowOf([buildEntry('~/Projects/x/sub')]), h), // no .git
      checkAdmission(sampleRequest({ access: 'build', cwd: '~/Projects/x' }), allowOf([buildEntry(), editEntry(`${h}/Projects/x/sub/deep`)]), h), // overlap
      checkAdmission(sampleRequest({ access: 'build', cwd: '~/Projects/z' }), allowOf([buildEntry('~/Projects/z')]), h), // .git without HEAD
    ]
    for (const r of refused) { expect(r.ok).toBe(false); expect(refusalHint(r)).toContain('commands:') }
    const edit = checkAdmission(sampleRequest({ access: 'edit', cwd: '~/Projects/x/sub' }), allowOf([editEntry()]), h)
    expect(edit.ok).toBe(false)
    expect(refusalHint(edit)).not.toContain('commands:')
  })

  test('the real probe: a bounded read that follows no link, and a search test that is git\'s own', () => {
    const h = home()
    writeFileSync(join(h, 'big'), 'ref: refs/heads/main\n' + 'x'.repeat(1_000_000))
    writeFileSync(join(h, 'small'), 'ab')
    symlinkSync(join(h, 'small'), join(h, 'link'))
    expect(realFs.readPrefix(join(h, 'big'), 256)).toBe(('ref: refs/heads/main\n' + 'x'.repeat(1_000_000)).slice(0, 256))
    expect(realFs.readPrefix(join(h, 'small'), 256)).toBe('ab')
    expect(realFs.readPrefix(join(h, 'link'), 256)).toBeNull() // not followed
    expect(realFs.readPrefix(join(h, 'Projects'), 256)).toBeNull() // a directory
    expect(realFs.readPrefix(join(h, 'missing'), 256)).toBeNull()
    expect(realFs.searchable(join(h, 'Projects'))).toBe(true)
    expect(realFs.searchable(join(h, 'missing'))).toBe(false)
    if (process.getuid?.() !== 0) {
      const closed = join(h, 'Projects/x'); chmodSync(closed, 0o600)
      try { expect(realFs.searchable(closed)).toBe(false) } finally { chmodSync(closed, 0o755) }
    }
  })
  test('the filesystem checks are injectable, so a test needs no disk: realpath and the probe', () => {
    const real = new Map([['/h', '/h'], ['/h/p', '/h/p'], ['/h/p/x', '/h/p/x']])
    const realpath = (p: string) => real.get(p) ?? null
    const G = '/h/p/x/.git'
    const kinds = new Map<string, 'dir' | 'file' | 'link'>([[G, 'dir'], [`${G}/HEAD`, 'file'], [`${G}/objects`, 'dir'], [`${G}/refs`, 'dir']])
    const contents = new Map<string, string>([[`${G}/HEAD`, 'ref: refs/heads/main\n']])
    const closed = new Set<string>() // directories git could not enter
    const asked: string[] = []
    const fs: FsProbe = {
      lstat: (p) => {
        asked.push(`lstat ${p}`)
        const k = kinds.get(p)
        return k ? { isDirectory: () => k === 'dir', isFile: () => k === 'file', isSymbolicLink: () => k === 'link' } : null
      },
      readPrefix: (p, max) => { asked.push(`read ${p} ${max}`); return contents.get(p) ?? null },
      searchable: (p) => { asked.push(`enter ${p}`); return !closed.has(p) },
    }
    const a = allowOf([buildEntry('~/p/x')])
    const admit = () => checkAdmission(sampleRequest({ access: 'build', cwd: '~/p/x' }), a, '/h', realpath, fs)
    expect(admit()).toEqual({ ok: true, cwdReal: '/h/p/x', access: 'build', commands: BUN })
    // exactly these probes, in this order, and HEAD is read for at most as much as git itself reads
    expect(asked).toEqual([`lstat ${G}`, `lstat ${G}/commondir`, `lstat ${G}/HEAD`, `read ${G}/HEAD 256`,
      `lstat ${G}/objects`, `enter ${G}/objects`, `lstat ${G}/refs`, `enter ${G}/refs`])
    const refused = (word: string) => nope(admit(), word)
    kinds.set(`${G}/HEAD`, 'link'); refused('HEAD')
    kinds.set(`${G}/HEAD`, 'dir'); refused('HEAD')
    kinds.delete(`${G}/HEAD`); refused('HEAD')
    kinds.set(`${G}/HEAD`, 'file')
    for (const bad of ['', 'x', 'ref: heads/main\n', 'ref: refs\n', 'a1'.repeat(19) + '\n']) { contents.set(`${G}/HEAD`, bad); refused('HEAD') }
    contents.delete(`${G}/HEAD`); refused('HEAD') // unreadable
    for (const ok of ['ref: refs/heads/main', 'ref:refs/heads/x\r\n', 'a1'.repeat(20), 'b2'.repeat(32) + '\n']) { contents.set(`${G}/HEAD`, ok); expect(admit().ok).toBe(true) }
    contents.set(`${G}/HEAD`, 'ref: refs/heads/main\n')
    for (const d of ['objects', 'refs']) {
      for (const k of ['file', 'link', undefined] as const) {
        const was = kinds.get(`${G}/${d}`)
        if (k) kinds.set(`${G}/${d}`, k); else kinds.delete(`${G}/${d}`)
        refused(d)
        kinds.set(`${G}/${d}`, was!)
      }
      closed.add(`${G}/${d}`); refused(d); closed.delete(`${G}/${d}`)
    }
    for (const k of ['file', 'dir', 'link'] as const) { kinds.set(`${G}/commondir`, k); refused('commondir') }
    kinds.delete(`${G}/commondir`)
    expect(admit().ok).toBe(true)
    kinds.set(G, 'file'); refused('.git')
    kinds.set(G, 'link'); refused('.git')
    kinds.delete(G); refused('.git')
  })
})

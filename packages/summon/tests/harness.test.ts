import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AllowlistCommand } from '../src/allowlist.ts'
import { MAX_TURNS, claudeInvocation, interpretClaudeStream, resolveProgram, usageWarning, type Invocation, type ProgramResolver } from '../src/harness.ts'
import type { Access } from '../src/request.ts'
import { cleanupTmps, trackTmp } from './helpers.ts'

afterEach(cleanupTmps)

const HOME = '/Users/yu'
const FOLDER = '/Users/yu/Projects/x'
// A job id as the gate mints them: smn_ and 32 hex.
const ID = 'smn_01a137f00000700080000000000000ab'
const SYSTEM_PATH = '/Users/yu/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'

type JobIn = { id: string; model: string; effort?: string; access: Access; cwdReal: string; commands: AllowlistCommand[]; prompt: string }
const job = (access: Access, over: Partial<JobIn> = {}): JobIn => ({ id: ID, model: 'sonnet', access, cwdReal: FOLDER, commands: [], prompt: 'hi 愛', ...over })
const cmd = (run: string, args = false): AllowlistCommand => ({ run, args })
const BUN_TEST = cmd('bun test')
const buildJob = (commands: AllowlistCommand[], over: Partial<JobIn> = {}) => job('build', { commands, ...over })

/** A resolver that must not be asked: a job with no absolute program never touches the disk. */
const NO_DISK: ProgramResolver = () => { throw new Error('the resolver must not be asked') }
/** A hermetic stand-in for the disk. `real` maps the path of an executable to its realpath (a symlink maps to its target). */
const disk = (real: Record<string, string>): ProgramResolver => (program, searchPath) => {
  if (program.startsWith('/')) return real[program] ?? null
  for (const dir of searchPath.split(':')) { const hit = real[`${dir}/${program}`]; if (hit) return hit }
  return null
}
const make = (j: JobIn, resolve: ProgramResolver = NO_DISK): Invocation => claudeInvocation(j, HOME, '/bin/claude', 'yu', resolve)

/** The values of every `--<name>=<value>` argument. */
const flag = (inv: Invocation, name: string): string[] => inv.args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3))
const rules = (inv: Invocation, name: 'allowedTools' | 'disallowedTools'): string[] => {
  const v = flag(inv, name)
  expect(v).toHaveLength(1)
  return v[0]!.split(',')
}
const pathOf = (inv: Invocation) => inv.env.PATH!
/**
 * What the text of the allow rules says, read as plainly as possible: `Bash(X)` allows exactly X, and `Bash(X:*)` allows X and X
 * followed by a space and anything. (Claude Code's own matcher is stricter about compound commands; this one is the plain reading.)
 */
const allows = (allow: string[], command: string) => allow.some((r) => {
  const m = /^Bash\((.*)\)$/s.exec(r)
  if (!m) return false
  const body = m[1]!
  if (body.endsWith(':*')) { const prefix = body.slice(0, -2); return command === prefix || command.startsWith(`${prefix} `) }
  return command === body
})

const GIT_RULES = ['Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git rev-parse:*)']
const DENY_PHASE0 = ['Bash(git push:*)', 'Bash(git ls-remote:*)', 'Bash(rm:*)', 'Bash(rmdir:*)', 'Bash(mv:*)', 'Bash(cp:*)', 'Bash(sed:*)']
const denyFor = (folder: string) => [...DENY_PHASE0, `Edit(/${folder}/.githooks/**)`, `Write(/${folder}/.githooks/**)`,
  `Edit(/${folder}/**/.git/**)`, `Write(/${folder}/**/.git/**)`, `Edit(/${folder}/**/.GIT/**)`, `Write(/${folder}/**/.GIT/**)`]

describe('turn caps (Phase 0.5 §1)', () => {
  test('one table: review 40, edit 60, build 60', () => {
    expect(MAX_TURNS).toEqual({ review: 40, edit: 60, build: 60 })
  })
  test('--max-turns comes from the table, per access', () => {
    expect(flag(make(job('review')), 'max-turns')).toEqual(['40'])
    expect(flag(make(job('edit')), 'max-turns')).toEqual(['60'])
    expect(flag(make(buildJob([BUN_TEST])), 'max-turns')).toEqual(['60'])
  })
  test('an access the table does not know is refused, never run with a made-up cap or with edit powers', () => {
    for (const bad of ['', 'admin', 'Build', 'constructor', '__proto__']) {
      expect(() => make(job(bad as Access))).toThrow()
    }
  })
})

describe('claudeInvocation', () => {
  test('review: read-only tools, quiet flags, prompt on stdin only', () => {
    const inv = make(job('review'))
    expect(inv.bin).toBe('/bin/claude')
    expect(inv.args).toContain('--tools=Read,Glob,Grep')
    for (const f of ['-p', '--verbose', '--output-format=stream-json', '--setting-sources=', '--strict-mcp-config', '--no-session-persistence',
      '--no-chrome', '--disable-slash-commands', '--permission-mode=acceptEdits', '--permission-prompts=none', '--model=sonnet',
      '--max-turns=40']) expect(inv.args).toContain(f)
    expect(inv.args.some((a) => a.includes('hi 愛'))).toBe(false)
    expect(inv.stdin).toBe('hi 愛')
  })
  test('review: no Write, Edit or Bash, and no allow or deny rules', () => {
    const inv = make(job('review'))
    expect(inv.args.some((a) => a.startsWith('--allowedTools') || a.startsWith('--disallowedTools'))).toBe(false)
    expect(inv.args.filter((a) => a.startsWith('--tools='))).toEqual(['--tools=Read,Glob,Grep'])
  })
  test('review: byte-identical to Phase 0 except --max-turns=40 (args and env), whatever the job also carries', () => {
    const phase0Args = ['-p', '--verbose', '--output-format=stream-json', '--setting-sources=', '--strict-mcp-config', '--no-chrome',
      '--disable-slash-commands', '--no-session-persistence', '--max-turns=40', '--model=sonnet', '--permission-mode=acceptEdits',
      '--permission-prompts=none', '--tools=Read,Glob,Grep']
    const phase0Env = {
      HOME, USER: 'yu', LOGNAME: 'yu', LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR ?? '/tmp', PATH: SYSTEM_PATH,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_MAX_RETRIES: '2', DISABLE_AUTOUPDATER: '1',
      GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null',
      GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false',
    }
    for (const j of [job('review'), job('review', { commands: [BUN_TEST, cmd('/Users/yu/.bun/bin/bun x', true)] })]) {
      const inv = make(j)
      expect(inv.args).toEqual(phase0Args)
      expect(inv.env).toEqual(phase0Env)
    }
    expect(make(job('review', { effort: 'low' })).args).toEqual([...phase0Args.slice(0, 10), '--effort=low', ...phase0Args.slice(10)])
  })
  test('review: no --settings, and nothing about the sandbox', () => {
    const inv = make(job('review'))
    expect(inv.args.some((a) => a.startsWith('--settings'))).toBe(false)
    expect(inv.args.join(' ')).not.toContain('sandbox')
  })
  test('review: a bad job id or a folder that would break a rule is no reason to refuse (they are not used)', () => {
    expect(() => make(job('review', { id: 'not-an-id', cwdReal: '/Users/yu/a,b' }))).not.toThrow()
  })
  test('edit: Alpha posture — git add/commit only, push/rm/hooks denied', () => {
    const inv = make(job('edit'))
    expect(inv.args).toContain('--tools=Read,Write,Edit,Glob,Grep,Bash')
    expect(inv.args).toContain('--permission-mode=acceptEdits')
    expect(inv.args).toContain('--permission-prompts=none')
    expect(inv.args).toContain('--allowedTools=Bash(git add:*),Bash(git commit:*)')
    expect(inv.stdin).toBe('hi 愛')
    expect(inv.args.some((a) => a.includes('hi 愛'))).toBe(false)
  })
  test('edit: the exact allow and deny rules, with the .git and .GIT denies and no --output rule', () => {
    const inv = make(job('edit'))
    expect(rules(inv, 'allowedTools')).toEqual(['Bash(git add:*)', 'Bash(git commit:*)'])
    expect(rules(inv, 'disallowedTools')).toEqual(denyFor('/Users/yu/Projects/x'))
    expect(rules(inv, 'disallowedTools')).toContain('Edit(//Users/yu/Projects/x/**/.git/**)')
    expect(rules(inv, 'disallowedTools')).toContain('Write(//Users/yu/Projects/x/**/.GIT/**)')
    expect([...rules(inv, 'allowedTools'), ...rules(inv, 'disallowedTools')].some((r) => r.includes('--output'))).toBe(false) // no rule form for it: the sandbox confines the write
  })
  test('edit: an edit job in a build folder gets none of the build commands, and its PATH and resolver stay out of it', () => {
    // The admission hands back the entry's commands whatever the job asked for; only a build job may use them.
    const inv = make(job('edit', { commands: [BUN_TEST, cmd('/Users/yu/.bun/bin/bun run typecheck', true)] }))
    expect(rules(inv, 'allowedTools')).toEqual(['Bash(git add:*)', 'Bash(git commit:*)'])
    expect(pathOf(inv)).toBe(SYSTEM_PATH)
  })
  test('edit: a trailing slash on the folder does not change any folder rule or env value', () => {
    const plain = make(job('edit'))
    const slash = make(job('edit', { cwdReal: '/Users/yu/Projects/x/' }))
    expect(rules(slash, 'disallowedTools')).toEqual(rules(plain, 'disallowedTools'))
    expect(slash.env).toEqual(plain.env)
  })
  test('edit and build: a folder whose spelling would break the comma-separated deny rule is refused, not mis-parsed', () => {
    for (const bad of ['/Users/yu/a,b', '/Users/yu/a(b)', '/Users/yu/a*b', '/Users/yu/a?b', '/Users/yu/a[b]', '/Users/yu/a{b}', '/Users/yu/a\\b',
      '/Users/yu/a\nb', '/Users/yu/a\tb', '/Users/yu/a\u007fb', '/Users/yu/a\u0000b']) {
      expect(() => make(job('edit', { cwdReal: bad }))).toThrow()
      expect(() => make(buildJob([BUN_TEST], { cwdReal: bad }))).toThrow()
    }
    // review has no folder-derived rule, so the same folder is fine there
    expect(() => make(job('review', { cwdReal: '/Users/yu/a,b' }))).not.toThrow()
  })
  test('F24: an admitted effort is passed as --effort=<v>; none means no --effort flag', () => {
    expect(make(job('review', { effort: 'low' })).args).toContain('--effort=low')
    expect(make(job('edit', { effort: 'max' })).args).toContain('--effort=max')
    expect(make(buildJob([BUN_TEST], { effort: 'high' })).args).toContain('--effort=high')
    expect(make(job('review')).args.some((a) => a.startsWith('--effort'))).toBe(false)
  })
  test('env is built from scratch: no API key or base URL, hooks off', () => {
    process.env.ANTHROPIC_API_KEY = 'leak'
    process.env.ANTHROPIC_BASE_URL = 'https://leak.example'
    process.env.ANTHROPIC_AUTH_TOKEN = 'leak'
    let inv: ReturnType<typeof claudeInvocation>
    let editInv: ReturnType<typeof claudeInvocation>
    try { inv = make(job('review')); editInv = make(job('edit')) } finally {
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.ANTHROPIC_BASE_URL
      delete process.env.ANTHROPIC_AUTH_TOKEN
    }
    for (const i of [inv, editInv]) {
      expect(i.env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(Object.keys(i.env).filter((k) => k.startsWith('ANTHROPIC_'))).toEqual([])
      expect(Object.values(i.env).some((v) => v.includes('leak'))).toBe(false)
      expect(i.env).toMatchObject({ HOME: '/Users/yu', USER: 'yu', LOGNAME: 'yu', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null' })
      expect(i.env.PATH!.startsWith('/Users/yu/.local/bin:')).toBe(true)
    }
    expect(inv.env.GIT_CONFIG_COUNT).toBe('2')
  })
})

describe('sandboxed jobs: the --settings JSON (Phase 0.5 §3)', () => {
  const SANDBOX = {
    sandbox: {
      enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false,
      filesystem: { allowWrite: [], denyRead: ['~/.ssh', '~/.claude', '~/.config/summon', '~/.local/share/summon', '~/.local/state/summon'] },
      network: { allowedDomains: [], allowLocalBinding: false, allowAllUnixSockets: false },
    },
  }
  for (const [name, j] of [['edit', job('edit')], ['build', buildJob([BUN_TEST])]] as const) {
    test(`${name}: --settings is exactly the sandbox of §3: no write path, no local binding, no unix sockets, fail if unavailable`, () => {
      const v = flag(make(j), 'settings')
      expect(v).toHaveLength(1)
      expect(JSON.parse(v[0]!)).toEqual(SANDBOX)
      expect(v[0]).toBe(JSON.stringify(SANDBOX)) // the form the design shows, key for key
      const sb = JSON.parse(v[0]!).sandbox
      expect(sb.filesystem.allowWrite).toEqual([])
      expect(sb.network).toEqual({ allowedDomains: [], allowLocalBinding: false, allowAllUnixSockets: false })
      expect(sb.failIfUnavailable).toBe(true)
      expect(sb.allowUnsandboxedCommands).toBe(false)
    })
    test(`${name}: the settings carry no sandbox_write, local_binding or sandbox: false`, () => {
      const text = flag(make(j), 'settings')[0]!
      for (const w of ['sandbox_write', 'local_binding', '"enabled":false']) expect(text).not.toContain(w)
    })
  }
  test('the setting sources stay empty, so --settings is the only settings the job has', () => {
    expect(make(job('edit')).args).toContain('--setting-sources=')
  })
})

describe('sandboxed jobs: env (Phase 0.5 §2, Rulings S1 and S5)', () => {
  const PAIRS: Array<[string, string]> = [['core.hooksPath', '/dev/null'], ['core.fsmonitor', 'false'], ['core.pager', 'cat'], ['core.editor', 'true'],
    ['commit.gpgsign', 'false'], ['core.sshCommand', '/usr/bin/false']]
  for (const [name, j] of [['edit', job('edit')], ['build', buildJob([BUN_TEST])]] as const) {
    test(`${name}: TMPDIR is the job's own directory inside the folder`, () => {
      expect(make(j).env.TMPDIR).toBe(`/Users/yu/Projects/x/.summon-tmp/${ID}`)
      expect(make({ ...j, cwdReal: '/Users/yu/Projects/x/' }).env.TMPDIR).toBe(`/Users/yu/Projects/x/.summon-tmp/${ID}`)
    })
    test(`${name}: six GIT_CONFIG pairs, a count that equals them, the quiet git variables`, () => {
      const env = make(j).env
      expect(env.GIT_CONFIG_COUNT).toBe('6')
      PAIRS.forEach(([k, v], i) => { expect(env[`GIT_CONFIG_KEY_${i}`]).toBe(k); expect(env[`GIT_CONFIG_VALUE_${i}`]).toBe(v) })
      const keys = Object.keys(env).filter((k) => k.startsWith('GIT_CONFIG_KEY_'))
      const values = Object.keys(env).filter((k) => k.startsWith('GIT_CONFIG_VALUE_'))
      expect(keys).toHaveLength(Number(env.GIT_CONFIG_COUNT))
      expect(values).toHaveLength(Number(env.GIT_CONFIG_COUNT))
      expect(env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_PAGER: 'cat' })
    })
    test(`${name}: GIT_CEILING_DIRECTORIES is the folder's parent, so git never searches above the job folder (Ruling S5)`, () => {
      expect(make(j).env.GIT_CEILING_DIRECTORIES).toBe('/Users/yu/Projects')
      expect(make({ ...j, cwdReal: '/Users/yu/Projects/x/' }).env.GIT_CEILING_DIRECTORIES).toBe('/Users/yu/Projects')
    })
    test(`${name}: the rest of the env is Phase 0's, with no secrets and the global git config kept (HOME is the real home)`, () => {
      const env = make(j).env
      expect(env).toMatchObject({ HOME, USER: 'yu', LOGNAME: 'yu', LANG: 'en_US.UTF-8', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        CLAUDE_CODE_MAX_RETRIES: '2', DISABLE_AUTOUPDATER: '1' })
      expect(Object.keys(env).filter((k) => /KEY$|TOKEN|SECRET|^ANTHROPIC/.test(k) && !k.startsWith('GIT_CONFIG_KEY_'))).toEqual([])
    })
  }
  test('a folder that is not an absolute path below the root is refused (the // of every folder rule says absolute)', () => {
    for (const bad of ['', '/', '//', 'Projects/x', './x']) {
      expect(() => make(job('edit', { cwdReal: bad }))).toThrow()
      expect(() => make(buildJob([BUN_TEST], { cwdReal: bad }))).toThrow()
    }
  })
  test('a folder whose parent could not be written into the ceiling list is refused (a colon would split it)', () => {
    expect(() => make(job('edit', { cwdReal: '/Users/yu/a:b/x' }))).toThrow()
    expect(() => make(buildJob([BUN_TEST], { cwdReal: '/Users/yu/a:b/x' }))).toThrow()
  })
  test('a job id that is not a gate-minted id is refused for an edit or build job (it names a directory)', () => {
    for (const bad of ['', 'smn_x', '../../etc', `${ID}/..`, `${ID}\n`, ID.toUpperCase(), `x${ID}`]) {
      expect(() => make(job('edit', { id: bad }))).toThrow()
      expect(() => make(buildJob([BUN_TEST], { id: bad }))).toThrow()
    }
  })
})

describe('build jobs: allow and deny rules (Phase 0.5 §2)', () => {
  test('exact rule strings: the exact match, :* only with args true, then the read-only git rules', () => {
    const inv = make(buildJob([cmd('bun test'), cmd('bun run typecheck', true)]))
    expect(rules(inv, 'allowedTools')).toEqual(['Bash(git add:*)', 'Bash(git commit:*)', 'Bash(bun test)', 'Bash(bun run typecheck)',
      'Bash(bun run typecheck:*)', ...GIT_RULES])
    expect(rules(inv, 'disallowedTools')).toEqual(denyFor('/Users/yu/Projects/x'))
    expect(inv.args).toContain('--tools=Read,Write,Edit,Glob,Grep,Bash')
    expect([...rules(inv, 'allowedTools'), ...rules(inv, 'disallowedTools')].some((r) => r.includes('--output'))).toBe(false) // no rule form for it: the sandbox confines the write
  })
  test('args false allows the command exactly as written and nothing after it', () => {
    const allow = rules(make(buildJob([cmd('bun test')])), 'allowedTools')
    expect(allow).toContain('Bash(bun test)')
    expect(allow.some((r) => r.includes('bun test:*'))).toBe(false)
  })
  test('colons and equals signs in a command are written into the rule as they are', () => {
    const allow = rules(make(buildJob([cmd('bun run test:unit'), cmd('bun test --timeout=5000', true)])), 'allowedTools')
    expect(allow).toEqual(['Bash(git add:*)', 'Bash(git commit:*)', 'Bash(bun run test:unit)', 'Bash(bun test --timeout=5000)',
      'Bash(bun test --timeout=5000:*)', ...GIT_RULES])
  })
  test('a rule is listed once, however many commands produce it', () => {
    const allow = rules(make(buildJob([cmd('bun test'), cmd('bun run typecheck')])), 'allowedTools')
    expect(new Set(allow).size).toBe(allow.length)
  })
  test('bare names need no PATH change and the resolver is never asked', () => {
    expect(pathOf(make(buildJob([cmd('bun test'), cmd('make check')])))).toBe(SYSTEM_PATH)
  })
  test('no command at all is refused: a build job without its commands cannot be built', () => {
    expect(() => make(buildJob([]))).toThrow()
  })

  describe('an absolute program', () => {
    const BUN = '/Users/yu/.bun/bin/bun'
    const FINAL = `${SYSTEM_PATH}:/Users/yu/.bun/bin`
    test('its directory is appended to PATH after the system directories', () => {
      const inv = make(buildJob([cmd(`${BUN} test`)]), disk({ [BUN]: BUN }))
      expect(pathOf(inv)).toBe(FINAL)
      expect(pathOf(inv).startsWith(SYSTEM_PATH)).toBe(true)
    })
    test('a basename that resolves on the final PATH to the same realpath gets the basename rules too', () => {
      // Nothing earlier on PATH is named bun, so the appended directory's own bun is what `bun` means.
      const inv = make(buildJob([cmd(`${BUN} test`, true)]), disk({ [BUN]: BUN }))
      expect(rules(inv, 'allowedTools')).toEqual(['Bash(git add:*)', 'Bash(git commit:*)', `Bash(${BUN} test)`, `Bash(${BUN} test:*)`,
        'Bash(bun test)', 'Bash(bun test:*)', ...GIT_RULES])
    })
    test('a symlink earlier on PATH to the same program is the same program', () => {
      const real = '/Users/yu/.bun/install/global/bin/bun'
      const inv = make(buildJob([cmd(`${BUN} test`)]), disk({ [BUN]: real, '/Users/yu/.local/bin/bun': real }))
      expect(rules(inv, 'allowedTools')).toContain('Bash(bun test)')
      expect(rules(inv, 'allowedTools')).toContain(`Bash(${BUN} test)`)
    })
    test('a different program of that name earlier on PATH shadows it: only the absolute rules are emitted', () => {
      const inv = make(buildJob([cmd(`${BUN} test`, true)]), disk({ [BUN]: BUN, '/opt/homebrew/bin/bun': '/opt/homebrew/Cellar/bun/1.0/bin/bun' }))
      expect(rules(inv, 'allowedTools')).toEqual(['Bash(git add:*)', 'Bash(git commit:*)', `Bash(${BUN} test)`, `Bash(${BUN} test:*)`, ...GIT_RULES])
      expect(allows(rules(inv, 'allowedTools'), 'bun test')).toBe(false)
      expect(pathOf(inv)).toBe(FINAL) // the directory is still appended: the absolute rule must be able to run
    })
    test('an absolute program that is not there (or not executable) gets the absolute rules only: nothing to compare the basename with', () => {
      expect(rules(make(buildJob([cmd(`${BUN} test`)]), disk({ [BUN]: BUN })), 'allowedTools')).toContain('Bash(bun test)') // control: found, so both forms
      expect(rules(make(buildJob([cmd(`${BUN} test`)]), disk({})), 'allowedTools')).toEqual(['Bash(git add:*)', 'Bash(git commit:*)', `Bash(${BUN} test)`, ...GIT_RULES])
    })
    test('the resolver is asked with the final PATH, so a program only the appended directory holds is found', () => {
      const asked: Array<[string, string]> = []
      const spy: ProgramResolver = (p, searchPath) => { asked.push([p, searchPath]); return disk({ [BUN]: BUN })(p, searchPath) }
      make(buildJob([cmd(`${BUN} test`)]), spy)
      expect(asked).toContainEqual(['bun', FINAL])
      expect(asked).toContainEqual([BUN, FINAL])
    })
    test('several absolute programs: directories appended in command order, each once, and none that is already on PATH', () => {
      const inv = make(buildJob([cmd('/Users/yu/.bun/bin/bun test'), cmd('/Users/yu/.bun/bin/bunx x'), cmd('/opt/homebrew/bin/node run.js'),
        cmd('/opt/tools/bin/make all')]), disk({}))
      expect(pathOf(inv)).toBe(`${SYSTEM_PATH}:/Users/yu/.bun/bin:/opt/tools/bin`)
    })
    test('only a build job appends: review and edit jobs keep the system PATH', () => {
      expect(pathOf(make(job('review', { commands: [cmd(`${BUN} test`)] })))).toBe(SYSTEM_PATH)
      expect(pathOf(make(job('edit', { commands: [cmd(`${BUN} test`)] })))).toBe(SYSTEM_PATH)
    })
    test('a program path that would split PATH is refused', () => {
      expect(() => make(buildJob([cmd('/Users/yu/a:b/bun test')]), disk({}))).toThrow()
    })
  })

  describe('UNSAFE_IN_RULE', () => {
    test('a command string with a character that would split or reinterpret a rule stops the job from starting', () => {
      for (const bad of ['bun test,x', 'bun (test)', 'bun test*', 'bun te?st', 'bun [t]', 'bun {t}', 'bun test\\x', 'bun test\n', 'bun\ttest',
        'bun test\u0000', 'bun test\u007f', '/Users/yu/a,b/bun test']) {
        expect(() => make(buildJob([cmd(bad)]), disk({}))).toThrow()
        expect(() => make(buildJob([BUN_TEST, cmd(bad, true)]), disk({}))).toThrow()
      }
      expect(() => make(buildJob([BUN_TEST, cmd('bun run test:unit', true)]))).not.toThrow()
    })
    test('a build cwd with such a character stops the job from starting', () => {
      for (const bad of ['/Users/yu/a,b', '/Users/yu/a(b)', '/Users/yu/a*b', '/Users/yu/a\nb']) expect(() => make(buildJob([BUN_TEST], { cwdReal: bad }))).toThrow()
    })
  })

  describe('the shell-form table (Phase 0.5 §6): no emitted allow rule matches a command that adds shell syntax or a word', () => {
    const NEGATIVE = [
      'bun test > ~/x', 'bun test >> ~/x', 'bun test | tee ~/x', 'FOO=1 bun test', 'bun test\nid', 'bun test; id', 'bun test && id', 'bun test $(id)',
      'bun test `id`', 'bun test <(id)', 'bun test --cwd /elsewhere', 'bun test --preload x', 'bun  test', ' bun test', 'bun test ',
      'cd / && bun test', 'env bun test', 'bun',
    ]
    test('for bun test with args false: not one of them is matched by any rule, exact or prefix', () => {
      const allow = rules(make(buildJob([cmd('bun test')])), 'allowedTools')
      expect(allows(allow, 'bun test')).toBe(true) // control: the matcher does say yes to the command itself
      for (const c of NEGATIVE) expect(allows(allow, c)).toBe(false)
      for (const c of NEGATIVE) expect(allow).not.toContain(`Bash(${c})`)
    })
    test('for a run with : or = in a word, args false: the command is allowed as written and nothing added to it is', () => {
      const allow = rules(make(buildJob([cmd('bun run test:unit'), cmd('bun test --timeout=5000')])), 'allowedTools')
      expect(allows(allow, 'bun run test:unit')).toBe(true)
      expect(allows(allow, 'bun test --timeout=5000')).toBe(true)
      for (const c of ['bun run test:unit > ~/x', 'bun run test:unit >> ~/x', 'bun run test:unit --x', 'bun run test', 'bun run test:', 'bun run test:unit:*',
        'bun test --timeout=5000 > ~/x', 'bun test --timeout=5000 --preload x', 'bun test --timeout=1', 'bun test --timeout', 'FOO=1 bun run test:unit',
        'bun run test:unit\nid', 'bun run test:unit $(id)']) expect(allows(allow, c)).toBe(false)
    })
    test('an absolute program\'s rules are no wider than its basename rules: the table holds for them too', () => {
      const inv = make(buildJob([cmd('/Users/yu/.bun/bin/bun test')]), disk({ '/Users/yu/.bun/bin/bun': '/Users/yu/.bun/bin/bun' }))
      const allow = rules(inv, 'allowedTools')
      for (const base of ['bun test', '/Users/yu/.bun/bin/bun test']) {
        expect(allows(allow, base)).toBe(true)
        for (const c of NEGATIVE.map((n) => n.replace('bun test', base))) expect(allows(allow, c)).toBe(false)
      }
    })
    test('left to the sandbox and the live checks (the rule text alone cannot tell them from the command): the :* forms', () => {
      // These are matched by the plain reading of a :* rule. The sandbox confines what they write; the design lists them as live checks.
      const allow = rules(make(buildJob([cmd('bun test', true)])), 'allowedTools')
      expect(allows(allow, 'bun test --preload x')).toBe(true)
      expect(allows(allow, 'git log --output=~/x')).toBe(true)
      expect(allows(allow, 'git commit -m x >> ~/x')).toBe(true)
      expect(allows(allow, 'git diff --output=~/x')).toBe(true)
    })
  })
})

describe('resolveProgram (the real disk lookup, in a temp directory)', () => {
  const tree = () => {
    const d = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-resolve-'))))
    for (const s of ['a', 'b', 'c']) mkdirSync(join(d, s))
    writeFileSync(join(d, 'a/tool'), '#!/bin/sh\n'); chmodSync(join(d, 'a/tool'), 0o644) // there, but not executable
    writeFileSync(join(d, 'b/tool'), '#!/bin/sh\n'); chmodSync(join(d, 'b/tool'), 0o755)
    symlinkSync(join(d, 'b/tool'), join(d, 'c/tool'))
    mkdirSync(join(d, 'a/dirtool'))
    return d
  }
  test('a bare name is the first executable file of that name on the path, as its realpath', () => {
    const d = tree()
    expect(resolveProgram('tool', `${d}/a:${d}/b`)).toBe(join(d, 'b/tool')) // a/tool is not executable
    expect(resolveProgram('tool', `${d}/c:${d}/b`)).toBe(join(d, 'b/tool')) // a symlink is reported as its target
    expect(resolveProgram('tool', `${d}/a`)).toBeNull()
    expect(resolveProgram('nothing', `${d}/a:${d}/b:${d}/c`)).toBeNull()
    expect(resolveProgram('dirtool', `${d}/a`)).toBeNull() // a directory is not a program
  })
  test('an absolute path is its own realpath when it is an executable file, else null', () => {
    const d = tree()
    expect(resolveProgram(join(d, 'c/tool'), '')).toBe(join(d, 'b/tool'))
    expect(resolveProgram(join(d, 'b/tool'), '')).toBe(join(d, 'b/tool'))
    expect(resolveProgram(join(d, 'a/tool'), '')).toBeNull()
    expect(resolveProgram(join(d, 'missing'), '')).toBeNull()
    expect(existsSync(join(d, 'a/dirtool'))).toBe(true)
    expect(resolveProgram(join(d, 'a/dirtool'), '')).toBeNull()
  })
  test('only absolute directories on the path are searched', () => {
    const d = tree()
    expect(resolveProgram('tool', `b:${d}/a::.`)).toBeNull()
  })
})

describe('git under exactly the job env (Phase 0.5 §2, test (h))', () => {
  const GIT = Bun.which('git') ?? '/usr/bin/git'
  const run = (cwd: string, env: Record<string, string>, ...args: string[]) => spawnSync(GIT, args, { cwd, env, encoding: 'utf8' })
  /** A temp HOME that holds a git identity, and a repository in it. */
  function repoWithHome() {
    const home = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-git-home-'))))
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Summon Test\n\temail = summon-test@example.invalid\n')
    const repo = join(home, 'repo')
    mkdirSync(repo)
    return { home, repo }
  }
  const envFor = (home: string, repo: string, access: 'edit' | 'build' = 'edit') =>
    claudeInvocation(access === 'edit' ? job('edit', { cwdReal: repo }) : buildJob([BUN_TEST], { cwdReal: repo }), home, '/bin/claude', 'yu', NO_DISK).env

  for (const access of ['edit', 'build'] as const) {
    test(`${access}: a real git commit succeeds under the job env, with the global identity, and a planted pre-commit hook does not run`, () => {
      const { home, repo } = repoWithHome()
      const env = envFor(home, repo, access)
      expect(run(repo, env, 'init', '-q', '-b', 'main').status).toBe(0)
      const marker = join(home, 'hook-ran')
      writeFileSync(join(repo, '.git/hooks/pre-commit'), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`)
      chmodSync(join(repo, '.git/hooks/pre-commit'), 0o755)
      writeFileSync(join(repo, 'file.txt'), 'hello\n')
      expect(run(repo, env, 'add', 'file.txt').status).toBe(0)

      // Control: without the hooks override the planted hook does run and blocks the commit, so the test can see it.
      const noHooks = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_CONFIG_')))
      const control = run(repo, noHooks, 'commit', '-q', '-m', 'control')
      expect(control.status).not.toBe(0)
      expect(existsSync(marker)).toBe(true)
      rmSync(marker)

      const commit = run(repo, env, 'commit', '-q', '-m', 'under the job env')
      expect(commit.stderr).toBe('')
      expect(commit.status).toBe(0)
      expect(existsSync(marker)).toBe(false)
      const log = run(repo, env, 'log', '--format=%an <%ae> %s')
      expect(log.stdout.trim()).toBe('Summon Test <summon-test@example.invalid> under the job env')
    })
  }
  test('git sees all six pairs as its own configuration', () => {
    const { home, repo } = repoWithHome()
    const env = envFor(home, repo)
    expect(run(repo, env, 'init', '-q').status).toBe(0)
    const want: Record<string, string> = { 'core.hookspath': '/dev/null', 'core.fsmonitor': 'false', 'core.pager': 'cat', 'core.editor': 'true',
      'commit.gpgsign': 'false', 'core.sshcommand': '/usr/bin/false' }
    for (const [k, v] of Object.entries(want)) expect(run(repo, env, 'config', '--get', k).stdout.trim()).toBe(v)
  })
  test('git does not search above the job folder (GIT_CEILING_DIRECTORIES, Ruling S5)', () => {
    const { home, repo: parent } = repoWithHome()
    expect(run(parent, envFor(home, parent), 'init', '-q').status).toBe(0)
    const child = join(parent, 'job')
    mkdirSync(child) // a job folder whose own .git is gone: only the parent's repository is above it
    const env = envFor(home, child)
    expect(dirname(child)).toBe(parent)
    // Control: with no ceiling git climbs into the parent's repository.
    const withoutCeiling = Object.fromEntries(Object.entries(env).filter(([k]) => k !== 'GIT_CEILING_DIRECTORIES'))
    expect(run(child, withoutCeiling, 'rev-parse', '--show-toplevel').stdout.trim()).toBe(parent)
    const bounded = run(child, env, 'rev-parse', '--show-toplevel')
    expect(bounded.status).not.toBe(0)
    expect(bounded.stdout).toBe('')
  })
})

const L = (o: object) => JSON.stringify(o)
describe('interpretClaudeStream', () => {
  test('success', () => {
    expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 2, total_cost_usd: 0.1 })], 0))
      .toMatchObject({ status: 'completed', result_text: 'done', num_turns: 2, cost_usd: 0.1 })
  })
  test('F35: the turn cap is failed with a runner-authored detail, keeping the narration (the recorded 2.1.296 shape)', () => {
    // Live run 4: interim narration, then a result with `errors` and no `result`, exit 1.
    const o = interpretClaudeStream([
      L({ type: 'assistant', message: { content: [{ type: 'text', text: 'Batch 1 done. Next batch.' }, { type: 'tool_use', name: 'Read' }] } }),
      L({ type: 'assistant', message: { content: [{ type: 'text', text: 'Batch 2 done. Next batch.' }, { type: 'tool_use', name: 'Read' }] } }),
      L({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 13, errors: ['Reached maximum number of turns (12)'], terminal_reason: 'max_turns' }),
    ], 1)
    expect(o).toMatchObject({ status: 'failed', detail: 'turn cap (40) reached before a final answer',
      result_text: 'Batch 1 done. Next batch.Batch 2 done. Next batch.', num_turns: 13 })
  })
  test('the turn cap detail names the cap of the job\'s access (40, 60, 60), from the same table as --max-turns', () => {
    const capped = [L({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 61, terminal_reason: 'max_turns' })]
    expect(interpretClaudeStream(capped, 1, '', 'review')).toMatchObject({ status: 'failed', detail: 'turn cap (40) reached before a final answer' })
    expect(interpretClaudeStream(capped, 1, '', 'edit')).toMatchObject({ status: 'failed', detail: 'turn cap (60) reached before a final answer' })
    expect(interpretClaudeStream(capped, 1, '', 'build')).toMatchObject({ status: 'failed', detail: 'turn cap (60) reached before a final answer' })
    for (const a of ['review', 'edit', 'build'] as const) {
      expect(interpretClaudeStream(capped, 1, '', a).detail).toBe(`turn cap (${MAX_TURNS[a]}) reached before a final answer`)
    }
  })
  test('usage warning or rejection is blocked(usage) with reset time', () => {
    const o = interpretClaudeStream([L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1_791_700_000 } }),
      L({ type: 'result', subtype: 'success', is_error: false, result: 'x' })], 0)
    expect(o).toMatchObject({ status: 'blocked', reason: 'usage', detail: 'usage allowed_warning', resets_at: new Date(1_791_700_000_000).toISOString() })
  })
  test('a later "allowed" event does not erase an earlier warning', () => {
    const o = interpretClaudeStream([L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1_791_700_000 } }),
      L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }),
      L({ type: 'result', subtype: 'success', is_error: false, result: 'x' })], 0)
    expect(o).toMatchObject({ status: 'blocked', reason: 'usage', resets_at: new Date(1_791_700_000_000).toISOString() })
  })
  test('a rejection beats an earlier warning', () => {
    const o = interpretClaudeStream([L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } }),
      L({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1_791_700_000 } })], 1)
    expect(o).toMatchObject({ status: 'blocked', reason: 'usage', detail: 'usage rejected' })
  })
  test('an out-of-range resetsAt is still blocked(usage), just without a reset time', () => {
    for (const raw of ['{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1e16}}',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1e999}}',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":-1e16}}']) {
      const o = interpretClaudeStream([raw, L({ type: 'result', subtype: 'success', is_error: false, result: 'x' })], 0)
      expect(o).toMatchObject({ status: 'blocked', reason: 'usage', detail: 'usage rejected' })
      expect(o.resets_at).toBeUndefined()
    }
  })
  test('plain "allowed" events are not a usage block', () => {
    expect(interpretClaudeStream([L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }),
      L({ type: 'result', subtype: 'success', is_error: false, result: 'x' })], 0)).toMatchObject({ status: 'completed' })
  })
  test('not logged in is blocked(auth)', () => {
    expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' })], 1))
      .toMatchObject({ status: 'blocked', reason: 'auth' })
  })
  test('auth failure: detail is runner-authored; the harness text stays out of it', () => {
    const odd = `Not logged in ${'ÿ愛 secret-ish "quote" \n'.repeat(60)}`
    const o = interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: true, result: odd })], 1)
    expect(o).toMatchObject({ status: 'blocked', reason: 'auth', detail: 'claude is not logged in on this Mac' })
    expect(o.detail).not.toContain('secret-ish')
    expect(o.result_text).toBe(odd)
  })
  test('detail is never harness output, whatever the branch', () => {
    const hostile = 'SECRET-PROMPT-FRAGMENT'
    const outcomes = [
      interpretClaudeStream([L({ type: 'result', subtype: hostile, is_error: true, result: hostile })], 1),
      interpretClaudeStream([L({ type: 'result', subtype: 'error_max_turns', is_error: true, result: hostile })], 1),
      interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: true, result: hostile })], 1),
      interpretClaudeStream([L({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', extra: hostile } })], 1),
      interpretClaudeStream([L({ type: 'assistant', message: { content: [{ type: 'text', text: hostile }] } })], 1),
    ]
    for (const o of outcomes) expect(o.detail ?? '').not.toContain(hostile)
    expect(outcomes[0]).toMatchObject({ status: 'failed', detail: 'error' })
  })
  describe('F02: permission denials', () => {
    const denied = (over: object = {}) => L({ type: 'result', subtype: 'success', is_error: false, result: 'I was not allowed to read /Users/yu/.zshrc',
      num_turns: 2, permission_denials: [{ tool_name: 'Read', tool_use_id: 'toolu_1', tool_input: { file_path: '/Users/yu/.zshrc' } }], ...over })
    test('a result with permission denials is blocked(permission); the detail is a runner-authored count and the text is kept', () => {
      const o = interpretClaudeStream([denied()], 0)
      expect(o).toMatchObject({ status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied', result_text: 'I was not allowed to read /Users/yu/.zshrc' })
      expect(o.detail).not.toContain('zshrc')
      const two = interpretClaudeStream([denied({ permission_denials: [{ tool_name: 'Read' }, { tool_name: 'Bash' }] })], 0)
      expect(two).toMatchObject({ status: 'blocked', reason: 'permission', detail: '2 tool call(s) denied' })
    })
    test('an empty or absent denial list is not a block', () => {
      expect(interpretClaudeStream([denied({ permission_denials: [] })], 0)).toMatchObject({ status: 'completed' })
      expect(interpretClaudeStream([denied({ permission_denials: 'x' })], 0)).toMatchObject({ status: 'completed' })
    })
    test('decision order: usage, then auth, then permission, then the turn cap', () => {
      const warn = L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } })
      expect(interpretClaudeStream([warn, denied()], 0)).toMatchObject({ status: 'blocked', reason: 'usage' })
      expect(interpretClaudeStream([denied({ is_error: true, result: 'Not logged in · Please run /login' })], 1)).toMatchObject({ status: 'blocked', reason: 'auth' })
      expect(interpretClaudeStream([denied({ subtype: 'error_max_turns', is_error: true, result: undefined })], 1))
        .toMatchObject({ status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied' })
    })
  })
  describe('F37: auth is classified from structured fields, and the regex reads only the result text', () => {
    // The live run-1 shape: a synthetic assistant event flagged as an API error, then a success-subtype error result, exit 1.
    const apiError = (text: string, error: string) => [
      L({ type: 'assistant', error, is_api_error_message: true, message: { model: '<synthetic>', content: [{ type: 'text', text }] } }),
      L({ type: 'result', subtype: 'success', is_error: true, result: text, terminal_reason: 'api_error', num_turns: 1, permission_denials: [] }),
    ]
    const AUTH = { status: 'blocked', reason: 'auth', detail: 'claude is not logged in on this Mac' }
    test('a dead refresh token (2.1.296 headless text, error authentication_failed) is blocked(auth)', () => {
      expect(interpretClaudeStream(apiError('Failed to authenticate: OAuth session expired and could not be refreshed', 'authentication_failed'), 1)).toMatchObject(AUTH)
    })
    test('the structured error alone decides, whatever the text says', () => {
      for (const error of ['authentication_failed', 'oauth_org_not_allowed']) {
        expect(interpretClaudeStream(apiError('something new and unrecognised', error), 1)).toMatchObject(AUTH)
      }
    })
    test('the 2.1.296 auth texts in an error result are blocked(auth) without the structured field', () => {
      for (const text of ['Failed to authenticate: OAuth session expired and could not be refreshed', 'Authentication required · Sign in again to continue']) {
        expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: true, result: text })], 1)).toMatchObject(AUTH)
      }
    })
    test('a busy concurrent refresh (error server_error) is failed with a fixed detail, not "not logged in"', () => {
      const text = 'Failed to refresh OAuth token: another Claude Code process is refreshing it. This is usually transient; retry in a minute.'
      const o = interpretClaudeStream(apiError(text, 'server_error'), 1)
      expect(o).toMatchObject({ status: 'failed', detail: "claude's login refresh was busy; try again in a minute", result_text: text })
      expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: true, result: text })], 1))
        .toMatchObject({ status: 'failed', detail: "claude's login refresh was busy; try again in a minute" })
    })
    test('a successful answer that quotes the busy-refresh text stays completed, and a denial in it is still blocked(permission)', () => {
      // e.g. a review of packages/summon itself: harness.ts holds the phrase.
      const quote = 'harness.ts matches "another Claude Code process is refreshing it" to spot a busy login refresh.'
      expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: quote })], 0))
        .toMatchObject({ status: 'completed', result_text: quote })
      expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: quote, permission_denials: [{ tool_name: 'Read' }] })], 0))
        .toMatchObject({ status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied' })
    })
    test('narration is never read as an auth failure: no result line, or an error result without result text', () => {
      const narration = L({ type: 'assistant', message: { content: [{ type: 'text', text: 'the OAuth token is refreshed in api/src/auth; Not logged in is shown when' }] } })
      expect(interpretClaudeStream([narration], 1)).toMatchObject({ status: 'failed', detail: 'exit 1' })
      expect(interpretClaudeStream([narration], null)).toMatchObject({ status: 'failed', detail: 'exit null' })
      expect(interpretClaudeStream([narration, L({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['x'] })], 1))
        .toMatchObject({ status: 'failed', detail: 'error_during_execution' })
    })
    test('a successful answer that talks about OAuth tokens is completed', () => {
      expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: 'Not logged in is raised when the OAuth token is gone.' })], 0))
        .toMatchObject({ status: 'completed' })
    })
    test('an error field without the API-error flag is not trusted', () => {
      expect(interpretClaudeStream([L({ type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'x' }] } })], 1))
        .toMatchObject({ status: 'failed', detail: 'exit 1' })
    })
  })
  describe('F33: a command line claude rejects', () => {
    const DRIFT = 'claude rejected its command line (version drift?)'
    test('the known CLI-parse failures on stderr give a fixed detail, and no stderr text reaches the outcome', () => {
      for (const err of ["error: unknown option '--x=none'\n", "error: option '--permission-prompts <mode>' argument 'nope' is invalid. Allowed choices are ask, none.\n",
        'Invalid --setting-sources value: bogus\n',
        // What 2.1.296 really prints for a bad --setting-sources value (probed with --help appended, so no model call).
        'Error processing --setting-sources: Invalid setting source: bogus. Valid options are: user, project, local\n']) {
        const o = interpretClaudeStream([], 1, err)
        expect(o).toMatchObject({ status: 'failed', detail: DRIFT, result_text: '' })
        expect(JSON.stringify(o)).not.toContain('--x')
        expect(JSON.stringify(o)).not.toContain('nope')
        expect(JSON.stringify(o)).not.toContain('bogus')
      }
    })
    test('other stderr changes nothing; a successful run with stderr noise stays completed', () => {
      expect(interpretClaudeStream([], 1, 'Segmentation fault\n')).toMatchObject({ status: 'failed', detail: 'exit 1' })
      expect(interpretClaudeStream([], 1, "warning: error: unknown option '--x'")).toMatchObject({ status: 'failed', detail: 'exit 1' })
      expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: 'ok' })], 0, "error: unknown option '--x'"))
        .toMatchObject({ status: 'completed' })
    })
  })
  test('a known error subtype is reported as the detail', () => {
    expect(interpretClaudeStream([L({ type: 'result', subtype: 'error_during_execution', is_error: true })], 1))
      .toMatchObject({ status: 'failed', detail: 'error_during_execution' })
  })
  test('no result is failed', () => {
    expect(interpretClaudeStream(['garbage'], 137)).toMatchObject({ status: 'failed', detail: 'exit 137' })
  })
  test('no result and no exit code is failed, not a crash', () => {
    expect(interpretClaudeStream([], null)).toMatchObject({ status: 'failed', detail: 'exit null' })
  })
  test('lines that are valid JSON but not objects are skipped, never a crash', () => {
    const lines = ['null', '123', '"str"', '[]', 'true', L({ type: 'assistant', message: { content: 'not-an-array' } }),
      L({ type: 'assistant', message: null }), L({ type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 'x', total_cost_usd: null })]
    const o = interpretClaudeStream(lines, 0)
    expect(o).toMatchObject({ status: 'completed', result_text: 'ok' })
    expect(o.num_turns).toBeUndefined()
    expect(o.cost_usd).toBeUndefined()
  })
  test('result text is capped at 1 MiB', () => {
    const o = interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: 'a'.repeat(1_048_576 + 50) })], 0)
    expect(o.result_text!.length).toBe(1_048_576)
  })
  test('usageWarning picks only warning/rejected events', () => {
    expect(usageWarning(L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }))).toBeNull()
    expect(usageWarning(L({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1 } }))).toMatchObject({ status: 'rejected' })
    expect(usageWarning(L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } }))).toMatchObject({ status: 'allowed_warning' })
  })
  test('usageWarning with an out-of-range resetsAt still reports the rejection (never fails open)', () => {
    for (const raw of ['{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1e16}}',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1e999}}',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":"soon"}}']) {
      const w = usageWarning(raw)
      expect(w).not.toBeNull()
      expect(['rejected', 'allowed_warning']).toContain(w!.status)
      expect(w!.resets_at).toBeUndefined()
    }
    expect(usageWarning('{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1e16}}')).toMatchObject({ status: 'rejected' })
  })
  test('usageWarning ignores other events, garbage and non-objects', () => {
    for (const l of [L({ type: 'result' }), 'garbage', 'null', '', '123']) expect(usageWarning(l)).toBeNull()
  })
})

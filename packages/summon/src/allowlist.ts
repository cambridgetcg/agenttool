import { accessSync, closeSync, constants, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { blockedHint, blockMarkerPath } from './blocked.ts'
import { summonPaths } from './paths.ts'
import { ACCESSES, CLAUDE_EFFORTS, DEVICE_RE, RUNTIMES, type Access, type Runtime, type SummonRequest } from './request.ts'

export interface AllowlistModel { model: string; provider?: string; effort?: string[] }
export interface AllowlistRuntime { id: Runtime; models: AllowlistModel[]; reads_anywhere: boolean }
/** One program a build job may start. `args: true` also allows anything after it; the default is the command exactly as written. */
export interface AllowlistCommand { run: string; args: boolean }
/** `commands` is present on a build entry and absent on every other (Phase 0.5). */
export interface AllowlistFolder { path: string; access: Access; commands?: AllowlistCommand[] }
export interface Allowlist {
  version: 1
  device: string
  peers: string[]
  runtimes: AllowlistRuntime[]
  folders: AllowlistFolder[]
  limits: { max_concurrent: number; starts_per_hour: number; job_timeout_max_s: number }
}
type Parsed = { ok: true; allowlist: Allowlist } | { ok: false; detail: string }

const TOKEN_RE = /^[A-Za-z0-9._:-]{1,64}$/
export const TCC_PROTECTED = ['Desktop', 'Documents', 'Downloads', 'Library/Mobile Documents']
/** Folders under ~ that hold credentials or Summon's own state: a build folder may not be, contain or lie within one. */
export const BUILD_SENSITIVE = ['.ssh', '.claude', '.config', '.local', 'Library']

/** Phase 0.5 §2: `build` > `edit` > `review`. An entry admits the jobs at its own rank or below. */
export const ACCESS_RANK: Readonly<Record<Access, number>> = { review: 0, edit: 1, build: 2 }
const rank = (a: Access) => ACCESS_RANK[a]

export const MAX_COMMANDS = 16
/** A program (an absolute path, or a lowercase name looked up on PATH) and up to seven plain words. No flags, no shell syntax. */
export const RUN_RE = /^(\/[A-Za-z0-9._/-]{1,200}|[a-z0-9][a-z0-9._-]{0,63})( [A-Za-z0-9][A-Za-z0-9._/=:-]{0,127}){0,7}$/
/** Programs that run other programs, reach the network or change the system: never a build command, whatever else is true. */
export const DENIED_PROGRAMS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'env', 'xargs', 'find', 'git', 'curl', 'wget',
  'ssh', 'scp', 'sftp', 'nc', 'open', 'osascript', 'sudo', 'su', 'launchctl', 'python', 'python3', 'perl', 'ruby'])
/** Settings the design deferred to Phase 1. A folder entry that carries one is an error, so nobody believes it took effect. */
const DEFERRED_FOLDER_KEYS = ['sandbox_write', 'local_binding'] as const

/** Accepts integer seconds, or a string of whole seconds, minutes or hours ("30m"). Zero is refused. */
export function parseDurationS(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null
  if (typeof v !== 'string') return null
  const m = /^(\d+)(s|m|h)$/.exec(v.trim())
  if (!m) return null
  const s = Number(m[1]) * ({ s: 1, m: 60, h: 3600 } as const)[m[2] as 's' | 'm' | 'h']
  return s > 0 ? s : null
}

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
const isMapping = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Why a `run` string cannot be a build command, or null. Fixed words only: the string itself is never echoed. */
function runProblem(run: string): string | null {
  if (run.includes('\n') || !RUN_RE.test(run)) return 'not an allowed command'
  const words = run.split(' ')
  if (words.some((w) => w.split('/').includes('..'))) return 'has a ".." path segment'
  const program = words[0]!
  const base = program.slice(program.lastIndexOf('/') + 1)
  if (base === '' || base === '.') return 'names no program'
  // The Mac's volume ignores case, so /bin/BASH is bash.
  if (DENIED_PROGRAMS.has(base.toLowerCase())) return 'program is not allowed'
  return null
}

function parseCommands(raw: unknown, at: string): { ok: true; commands: AllowlistCommand[] } | { ok: false; detail: string } {
  const bad = (detail: string) => ({ ok: false, detail: `${at}${detail}` }) as const
  if (!Array.isArray(raw)) return bad(': must be a list')
  if (raw.length < 1 || raw.length > MAX_COMMANDS) return bad(`: 1 to ${MAX_COMMANDS} entries`)
  const seen = new Set<string>()
  const commands: AllowlistCommand[] = []
  for (const [j, c] of raw.entries()) {
    const here = `[${j}]`
    // A key other than run and args is refused rather than dropped: a typo must not quietly narrow or widen what the operator wrote.
    if (!isMapping(c) || Object.keys(c).some((k) => k !== 'run' && k !== 'args')) return bad(`${here}: must be a mapping with run and optionally args`)
    if (typeof c.run !== 'string') return bad(`${here}.run: must be a string`)
    if (c.args !== undefined && typeof c.args !== 'boolean') return bad(`${here}.args: must be true or false`)
    const problem = runProblem(c.run)
    if (problem) return bad(`${here}.run: ${problem}`)
    if (seen.has(c.run)) return bad(`${here}.run: duplicate`)
    seen.add(c.run)
    commands.push({ run: c.run, args: c.args === true })
  }
  return { ok: true, commands }
}

/**
 * A folder spelled out in words, `..` and doubled slashes folded and case ignored as the Mac's volume ignores it.
 * `home` marks a `~` spelling (segments are then relative to ~); `escapes` marks one whose `..` climbs out of ~.
 */
interface Spelled { home: boolean; segs: string[]; escapes: boolean }
function spell(path: string): Spelled {
  const home = path === '~' || path.startsWith('~/')
  const segs: string[] = []
  let escapes = false
  for (const s of (home ? path.slice(1) : path).split('/')) {
    if (s === '' || s === '.') continue
    if (s === '..') {
      if (segs.length > 0) segs.pop()
      else if (home) escapes = true // at an absolute root, .. stays at the root
      continue
    }
    segs.push(s.toLowerCase())
  }
  return { home, segs, escapes }
}
const startsWith = (a: string[], prefix: string[]) => prefix.length <= a.length && prefix.every((s, k) => a[k] === s)
/** `a` lies strictly inside `b`. Only like spellings compare (~ with ~, absolute with absolute); the rest is admission's, on realpaths. */
const spelledInside = (a: Spelled, b: Spelled) =>
  a.home === b.home && !a.escapes && !b.escapes && a.segs.length > b.segs.length && startsWith(a.segs, b.segs)

const SENSITIVE_SEGS = [...BUILD_SENSITIVE, ...TCC_PROTECTED].map((p) => p.toLowerCase().split('/'))
/**
 * Whether a build entry's spelling breaks the build location rules. A `~` spelling is read from ~ itself; an absolute spelling is
 * read against `home`, by its words alone (no realpath: a symlink into a forbidden place is admission's, on realpaths). An absolute
 * spelling that is not strictly inside `home` is refused, and so is every absolute spelling when `home` is not an absolute path.
 */
function buildSpellingRefused(path: string, home: string): boolean {
  let s = spell(path)
  if (!s.home) {
    const h = spell(home)
    if (!home.startsWith('/') || !startsWith(s.segs, h.segs)) return true // the home itself is left with no words: refused below
    s = { home: true, segs: s.segs.slice(h.segs.length), escapes: false }
  }
  if (s.escapes || s.segs.length === 0) return true // not strictly inside ~
  return SENSITIVE_SEGS.some((f) => startsWith(s.segs, f) || startsWith(f, s.segs)) // is, lies within, or contains one
}

/** `home` is the Mac's home folder, the ~ that a build entry's spelling is judged against; the caller has it (`SummonPaths.home`). */
export function parseAllowlist(text: string, home: string): Parsed {
  let y: any
  try { y = Bun.YAML.parse(text) } catch (e) { return { ok: false, detail: `yaml: ${String((e as Error).message).slice(0, 120)}` } }
  const fail = (detail: string): Parsed => ({ ok: false, detail })
  if (!y || typeof y !== 'object' || Array.isArray(y)) return fail('not a mapping')
  if (y.version !== 1) return fail('version must be 1')
  if (typeof y.device !== 'string' || !DEVICE_RE.test(y.device)) return fail('device')
  if (!Array.isArray(y.peers) || !y.peers.every((p: unknown) => typeof p === 'string' && DEVICE_RE.test(p))) return fail('peers')
  if (!Array.isArray(y.runtimes)) return fail('runtimes')
  const runtimes: AllowlistRuntime[] = []
  for (const r of y.runtimes) {
    if (!r || !(RUNTIMES as readonly string[]).includes(r.id)) return fail('runtime id')
    if (!Array.isArray(r.models) || r.models.length === 0) return fail(`models for ${r.id}`)
    const models: AllowlistModel[] = []
    for (const m of r.models) {
      if (!m || typeof m.model !== 'string' || !TOKEN_RE.test(m.model)) return fail(`model in ${r.id}`)
      if (m.provider !== undefined && (typeof m.provider !== 'string' || !TOKEN_RE.test(m.provider))) return fail(`provider in ${r.id}`)
      if (m.effort !== undefined && (!Array.isArray(m.effort) || !m.effort.every((e: unknown) => typeof e === 'string' && TOKEN_RE.test(e)
        && (r.id !== 'claude' || (CLAUDE_EFFORTS as readonly string[]).includes(e))))) return fail(`effort in ${r.id}`)
      models.push({ model: m.model, ...(m.provider ? { provider: m.provider } : {}), ...(m.effort ? { effort: m.effort } : {}) })
    }
    runtimes.push({ id: r.id, models, reads_anywhere: r.reads_anywhere === true })
  }
  if (!Array.isArray(y.folders)) return fail('folders')
  const folders: AllowlistFolder[] = []
  for (const [i, f] of y.folders.entries()) {
    const at = `folders[${i}]`
    if (!f || typeof f.path !== 'string' || !(f.path === '~' || f.path.startsWith('~/') || f.path.startsWith('/'))) return fail('folder path')
    if (!(ACCESSES as readonly unknown[]).includes(f.access)) return fail('folder access')
    for (const k of DEFERRED_FOLDER_KEYS) {
      if (Object.hasOwn(f, k)) return fail(`${at}.${k}: not a setting of this version (deferred); remove it`)
    }
    if (f.access !== 'build') {
      if (Object.hasOwn(f, 'commands')) return fail(`${at}.commands: only a build folder takes commands`)
      folders.push({ path: f.path, access: f.access })
      continue
    }
    if (!Object.hasOwn(f, 'commands') || f.commands === null) return fail(`${at}.commands: a build folder needs commands`)
    const cmds = parseCommands(f.commands, `${at}.commands`)
    if (!cmds.ok) return fail(cmds.detail)
    if (buildSpellingRefused(f.path, home)) return fail(`${at}.path: a build folder must lie strictly inside ~, outside .ssh, .claude, .config, .local, Library and the privacy-protected folders`)
    folders.push({ path: f.path, access: 'build', commands: cmds.commands })
  }
  // An edit or build folder may not lie inside another edit or build folder. A review folder may lie inside either.
  for (const [i, a] of folders.entries()) {
    if (rank(a.access) < 1) continue
    for (const [j, b] of folders.entries()) {
      if (i !== j && rank(b.access) >= 1 && spelledInside(spell(a.path), spell(b.path))) {
        return fail(`folders[${i}].path: an edit or build folder lies inside folders[${j}]`)
      }
    }
  }
  const l = y.limits ?? {}
  const timeout = parseDurationS(l.job_timeout_max)
  // Phase 0's runner runs one job at a time: a second admitted job would only wait, and could expire unrun.
  if (l.max_concurrent !== 1) return fail('limits.max_concurrent must be 1 in Phase 0 (the runner is serial)')
  if (!isInt(l.starts_per_hour, 1, 120) || timeout === null || timeout > 86_400) return fail('limits')
  return {
    ok: true,
    allowlist: { version: 1, device: y.device, peers: y.peers, runtimes, folders,
      limits: { max_concurrent: l.max_concurrent, starts_per_hour: l.starts_per_hour, job_timeout_max_s: timeout } },
  }
}

export function loadAllowlist(path: string, home: string): Parsed {
  let text: string
  try { text = readFileSync(path, 'utf8') } catch { return { ok: false, detail: 'missing' } }
  return parseAllowlist(text, home)
}

export function expandHome(p: string, home: string): string {
  return p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p
}

export function safeRealpath(p: string): string | null {
  try { return realpathSync.native(p) } catch { return null }
}

/**
 * What admission asks of the disk besides realpath. Injectable, so a test needs no files.
 * `readPrefix` is a bounded read of the start of a regular file (null when it cannot be read);
 * `searchable` is git's own test of a directory it must enter (access(2) with X_OK).
 */
export interface FsEntry { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }
export interface FsProbe {
  lstat(p: string): FsEntry | null
  readPrefix(p: string, max: number): string | null
  searchable(p: string): boolean
}
export const realFs: FsProbe = {
  lstat: (p) => { try { return lstatSync(p) } catch { return null } },
  readPrefix: (p, max) => {
    let fd: number | undefined
    try {
      // O_NOFOLLOW and O_NONBLOCK: a link or a pipe swapped in after the lstat is not followed and cannot block admission.
      fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const buf = Buffer.alloc(max)
      return buf.toString('utf8', 0, readSync(fd, buf, 0, max, 0))
    } catch { return null } finally {
      if (fd !== undefined) { try { closeSync(fd) } catch { /* nothing to do */ } }
    }
  },
  searchable: (p) => { try { accessSync(p, constants.X_OK); return true } catch { return false } },
}

/** git (validate_headref) reads at most 255 bytes of HEAD. */
const HEAD_READ_MAX = 256
/** A HEAD git accepts, in its strict form: a ref under refs/ (the placeholder git writes for reftable included), or a full object id. */
const HEAD_RE = /^(?:ref:[ \t]*refs\/\S+|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})\s*$/

/**
 * Why `dotGit` (the `.git` directory of an edit or build folder) is not one git would take as the folder's repository, or null.
 * git (setup.c is_git_directory) takes a `.git` directory only when HEAD names a ref or an object and objects/ and refs/ can be
 * entered, and with a `commondir` it looks for those in the directory the file names. Otherwise it skips this folder and
 * walks up to an enclosing repository, and a job can bring that about with one command in its own folder. So admission asks the
 * same things, strictly: HEAD a regular file read from its start, objects and refs real directories (not links) that can be
 * entered, and no commondir at all.
 */
function notAGitDir(dotGit: string, fs: FsProbe): string | null {
  if (fs.lstat(join(dotGit, 'commondir'))) return 'has a commondir file, which sends git to another directory'
  const head = fs.lstat(join(dotGit, 'HEAD'))
  if (!head || head.isSymbolicLink() || !head.isFile()) return 'has no regular HEAD file'
  const text = fs.readPrefix(join(dotGit, 'HEAD'), HEAD_READ_MAX)
  if (text === null || !HEAD_RE.test(text)) return 'has a HEAD that names neither a ref nor an object'
  for (const name of ['objects', 'refs']) {
    const dir = fs.lstat(join(dotGit, name))
    if (!dir || dir.isSymbolicLink() || !dir.isDirectory() || !fs.searchable(join(dotGit, name))) return `has no real ${name} directory that git can enter`
  }
  return null
}

const within = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith('/') ? parent : parent + '/')
const strictlyWithin = (child: string, parent: string) => child !== parent && within(child, parent)
const stripSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') || '/' : p)

/**
 * The TCC-protected folder a cwd is spelled inside, from its words alone (`..` and doubled slashes folded, case ignored as
 * the Mac's volume ignores it). Asked before anything is resolved: realpath into such a folder can fail EPERM under sshd,
 * and that must still read tcc_protected_folder, not "does not exist".
 */
function protectedBySpelling(expanded: string, home: string): string | null {
  const spelled = normalize(expanded).toLowerCase()
  return TCC_PROTECTED.find((p) => within(spelled, normalize(join(home, p)).toLowerCase())) ?? null
}

/** The build location rules on realpaths: strictly inside ~, and not, not containing and not within a sensitive or TCC folder. */
function buildLocationOk(folderReal: string, home: string, realpath: (p: string) => string | null): boolean {
  const homeReal = realpath(home) ?? home
  const lower = (p: string) => stripSlash(p).toLowerCase()
  if (!strictlyWithin(lower(folderReal), lower(homeReal))) return false
  for (const p of [...BUILD_SENSITIVE, ...TCC_PROTECTED]) {
    // The folder itself may be a symlink (~/.config -> a dotfiles repo): judge both where it is spelled and where it lands.
    const spelledAt = [join(home, p), join(homeReal, p)]
    const landed = realpath(join(home, p))
    for (const c of landed ? [...spelledAt, landed] : spelledAt) {
      if (within(lower(folderReal), lower(c)) || within(lower(c), lower(folderReal))) return false
    }
  }
  return true
}

export type Admission =
  | { ok: true; cwdReal: string; access: Access; commands: AllowlistCommand[] }
  /** `folder_blocked` and `submodules_unsupported` are the last two checks of step 12 (Rulings S8 and S9); the hint is what to do about the folder, not an entry to add. */
  | { ok: false; reason: 'outside_allowlist' | 'folder_blocked' | 'submodules_unsupported'; detail: string; hint: string }
  | { ok: false; reason: 'tcc_protected_folder'; detail: string; hint?: string }

const BUILD_ENTRY_EXAMPLE = '    commands:\n      - run: bun test'

/**
 * Every outside_allowlist refusal carries a hint: the YAML the operator would need to add. The order (Phase 0.5 §2):
 *  1 peer, 2 runtime (and, right after it, a non-claude runtime needs reads_anywhere), 3 non-review access on a non-claude
 *  runtime, 4 model, 5 TCC spelling, 6 cwd exists, 7 TCC target, 8 folder match, 9 ambiguous entries, 10 rank,
 *  11 reads_anywhere for rank >= 1 on claude, 12 the folder checks of an edit or build job: the location rules (build), cwd at the entry, a
 *  real .git directory that git would take, no overlap with another edit or build entry, then the folder's own state: blocked by an earlier
 *  tampered job (folder_blocked), and submodules (submodules_unsupported).
 */
export function checkAdmission(req: SummonRequest, al: Allowlist, home: string,
  realpath: (p: string) => string | null = safeRealpath, fs: FsProbe = realFs): Admission {
  const out = (detail: string, hint: string): Admission => ({ ok: false, reason: 'outside_allowlist', detail, hint })
  if (!al.peers.includes(req.from_device)) return out(`peer ${req.from_device} is not allowed`, `peers: [${[...al.peers, req.from_device].join(', ')}]`)
  const rt = al.runtimes.find((r) => r.id === req.runtime)
  if (!rt) return out(`runtime ${req.runtime} is not allowed`, `runtimes:\n  - id: ${req.runtime}\n    models: [{ model: ${req.model ?? 'sonnet'} }]`)
  if (rt.id !== 'claude' && !rt.reads_anywhere) return out(`${rt.id} can read any file on this Mac`, `add reads_anywhere: true to the ${rt.id} runtime entry`)
  if (rt.id === 'hermes' && req.access !== 'review') return out('hermes is review-only', 'send access: review')
  if (rt.id !== 'claude' && req.access !== 'review') return out(`${rt.id} is not run by Summon`, `send access: review, or use the claude runtime for ${req.access} jobs`)
  if (!req.model) return out('a model is required', 'send a model, for example sonnet')
  const m = rt.models.find((e) => e.model === req.model && e.provider === req.provider
    && (req.effort === undefined ? e.effort === undefined : (e.effort ?? []).includes(req.effort)))
  if (!m) {
    const triple = [`model: ${req.model}`, req.provider ? `provider: ${req.provider}` : '', req.effort ? `effort: [${req.effort}]` : '']
      .filter(Boolean).join(', ')
    return out(`model ${req.model}${req.provider ? '/' + req.provider : ''}${req.effort ? ' effort ' + req.effort : ''} is not allowed for ${rt.id}`,
      `add { ${triple} } to the ${rt.id} models`)
  }
  const tcc = { ok: false, reason: 'tcc_protected_folder' } as const
  const spelledIn = protectedBySpelling(expandHome(req.cwd, home), home)
  if (spelledIn) return { ...tcc, detail: `${req.cwd} is inside ~/${spelledIn}` }
  const cwdReal = realpath(expandHome(req.cwd, home))
  if (!cwdReal) return out(`cwd ${req.cwd} does not exist on this Mac`, 'create the folder or correct cwd')
  // And by what it resolves to: a symlink from an allowlisted folder into a protected one is refused by its target.
  for (const p of TCC_PROTECTED) {
    const pr = realpath(join(home, p)) ?? join(home, p)
    if (within(cwdReal, pr)) return { ...tcc, detail: `${req.cwd} is inside ~/${p}` }
  }
  // A claude edit or build job may run `git add` / `git commit`, and git's own file options (-F, --pathspec-from-file) read any
  // file Yu can, so rank >= 1 is the same power reads_anywhere names. Review jobs stay inside the folder and need no flag.
  const editNeedsFlag = rank(req.access) >= 1 && rt.id === 'claude' && !rt.reads_anywhere
  const FLAG_HINT = 'add reads_anywhere: true to the claude runtime entry'
  const entryHint = (path: string) => `folders:\n  - path: ${path}\n    access: ${req.access}${req.access === 'build' ? `\n${BUILD_ENTRY_EXAMPLE}` : ''}`
  const folderHint = (path: string) => `${entryHint(path)}${editNeedsFlag ? `\nand ${FLAG_HINT}` : ''}`
  const matches: Array<{ real: string; f: AllowlistFolder; i: number }> = []
  for (const [i, f] of al.folders.entries()) {
    const fr = realpath(expandHome(f.path, home))
    if (fr && within(cwdReal, fr)) matches.push({ real: fr, f, i })
  }
  if (matches.length === 0) return out(`folder ${req.cwd} is not allowed`, folderHint(req.cwd))
  const best = matches.reduce((a, b) => (b.real.length > a.real.length ? b : a))
  // Two entries that resolve to the same folder (a symlink, a ~ spelling against an absolute one) are not guessed between.
  if (matches.filter((e) => e.real.length === best.real.length).length > 1) {
    return out('ambiguous folder entries', 'two folder entries resolve to the same folder; remove one of them from the allowlist')
  }
  if (rank(req.access) > rank(best.f.access)) return out(`${req.access} is not allowed in ${best.f.path} (${best.f.access})`, folderHint(best.f.path))
  if (editNeedsFlag) return out(`${req.access} jobs run git, which can read any file on this Mac`, FLAG_HINT)

  if (rank(req.access) >= 1) {
    const refuse = (detail: string, fix: string, example: string = best.f.path) => out(detail, req.access === 'build' ? `${fix}\n${entryHint(example)}` : fix)
    if (best.f.access === 'build') {
      // The parser never produces a build entry without commands; one built any other way is refused rather than run with none.
      if (!best.f.commands || best.f.commands.length === 0) return refuse(`build folder ${best.f.path} lists no commands`, 'give the build entry a commands: list')
      if (!buildLocationOk(best.real, home, realpath)) {
        return refuse('build folders must lie strictly inside the home folder, outside .ssh, .claude, .config, .local, Library and the privacy-protected folders',
          'use a build folder inside ~ that is not one of those, for example', '~/Projects/<repository>')
      }
    }
    if (cwdReal !== best.real) {
      return refuse(`${req.access} jobs must run at the folder entry itself (${best.f.path}), not below it`, `send cwd ${best.f.path}; a review job may run anywhere inside it`)
    }
    // lstat, so a symlinked .git is seen as the link and a gitfile as a file. A folder without its own .git is not a root, even when a parent is a repository.
    const dotGit = fs.lstat(join(cwdReal, '.git'))
    if (!dotGit || dotGit.isSymbolicLink() || !dotGit.isDirectory()) {
      return refuse(`${best.f.path} is not a git repository root with a real .git directory`,
        `an ${req.access} folder must be a repository root: .git must be a directory in ${best.f.path} itself, not a file, a symlink or a parent's`)
    }
    // A .git directory that git would skip (no valid HEAD, no objects or refs, a commondir) is not the folder's repository: git then
    // walks up to the enclosing one.
    const notGit = notAGitDir(join(cwdReal, '.git'), fs)
    if (notGit) {
      return refuse(`${best.f.path}/.git ${notGit}, so git would use a parent repository instead`,
        `an ${req.access} folder must be a repository root: .git in ${best.f.path} must be a plain git directory (a regular HEAD naming a ref or an object, real objects and refs directories, no commondir); repair or re-clone the repository`)
    }
    // On realpaths, so a symlink into another entry and a ~ spelling against an absolute one are caught. A folder that cannot be resolved is compared as spelled.
    const mine = stripSlash(best.real).toLowerCase()
    const overlaps = al.folders.some((f, i) => {
      if (i === best.i || rank(f.access) < 1) return false
      const expanded = expandHome(f.path, home)
      const other = stripSlash(realpath(expanded) ?? normalize(expanded)).toLowerCase()
      return within(other, mine) || within(mine, other)
    })
    if (overlaps) {
      return refuse(`${best.f.path} overlaps another edit or build folder entry`, 'no edit or build folder may lie inside another: remove or move one of the overlapping entries')
    }
    // The folder's own state. Blocked first: a job that tampered may be what left the .gitmodules, and Yu should hear that before anything else.
    // lstat answers for whatever spelling the Mac's volume answers to, as git's own reads do.
    const marker = blockMarkerPath(summonPaths(home).state, cwdReal)
    if (fs.lstat(marker)) {
      return { ok: false, reason: 'folder_blocked', detail: `${best.f.path} is blocked: an earlier edit or build job there changed the folder's git files`,
        hint: blockedHint(marker, home) }
    }
    const submodules = fs.lstat(join(cwdReal, '.gitmodules')) ? '.gitmodules' : fs.lstat(join(cwdReal, '.git', 'modules')) ? '.git/modules' : null
    if (submodules) {
      return { ok: false, reason: 'submodules_unsupported', detail: `${best.f.path} has ${submodules}: edit and build jobs do not support submodules`,
        hint: 'use a folder without submodules (no .gitmodules, no .git/modules); a review job still works here' }
    }
  }
  return { ok: true, cwdReal, access: best.f.access, commands: (best.f.commands ?? []).map((c) => ({ ...c })) }
}

// The installer's structured steps on Nuance (C6, spec §10.3 steps 4–6; P21). The bash installer checks the bundle's
// sha256s, asks on /dev/tty, writes the key line and runs `claude mcp`; everything with structure (MANIFEST, YAML,
// realpaths, the Summon allowlist, git, citizen roots, TCC folders, the trial clone, JSON settings) is one of these verbs,
// run by the staged, de-quarantined copy of the binary (Review Focus 1). Each verb prints one JSON line on stdout and
// human lines on stderr, and exits 0 or 1.
import { randomBytes } from 'node:crypto'
import { accessSync, constants, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, normalize } from 'node:path'
import { expandHome, loadAllowlist, longestFolderMatch, safeRealpath, tccProtected, type Allowlist, type AllowlistFolder } from '../allowlist.ts'
import { passwdOfSelf } from '../native.ts'
import { homeOf, nuancePaths, type NuancePaths } from '../paths.ts'
import { sharePathProblem } from '../share-path.ts'
import { knobInt, systemBin, type Env } from '../sysbin.ts'
import { gitEnv } from './fetch-gate.ts'
import type { GateIo } from './gate-main.ts'
import { zshenvClean } from './gate.ts'
import { gitAcceptable, resolveGit, runCmd, sha256File, type ResolvedGit, type Run } from './git-resolve.ts'
import { dropinStat, parseInstalled, summonKeySha256 } from './installed.ts'

// ---- MANIFEST.txt ----

export interface Manifest { device: string; build: string; prepared: string; expiry: string; binary_sha256: string; tools_digest: string;
  trial_commit: string; shares: string[]; files: Record<string, string> }      // files: name → sha256

/** The three files a bundle carries besides its installer and MANIFEST.txt (which pin each other, so neither lists itself). */
export const BUNDLE_FILES = ['collab-bridge', 'tools.json', 'collab-trial.bundle'] as const

const SCALARS = {
  device: /^[a-z][a-z0-9-]{0,31}$/,
  build: /^[0-9a-f]{8}$/,
  prepared: /^\d{14}$/,
  expiry: /^\d{8}$/,
  trial_commit: /^[0-9a-f]{40}([0-9a-f]{24})?$/,
  tools_digest: /^[0-9a-f]{64}$/,
} as const
type Scalar = keyof typeof SCALARS
const SCALAR_KEYS = Object.keys(SCALARS) as Scalar[]
const SHA_RE = /^[0-9a-f]{64}$/
const FILE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/

// Each share is checked with the gate's own rule (Task 20's sharePathProblem, §5.2), so a path MANIFEST and the
// installer accept is one shares.json holds and the gate serves; bash's single quotes carry any path without '.
function manifestProblems(m: Manifest): string[] {
  const out: string[] = []
  for (const k of SCALAR_KEYS) if (typeof m[k] !== 'string' || !SCALARS[k].test(m[k])) out.push(`${k} is malformed`)
  if (!Array.isArray(m.shares) || m.shares.length === 0) out.push('no share')
  else {
    for (const s of m.shares) { const p = sharePathProblem(s); if (p) out.push(`share ${s} ${p}`) }
    if (new Set(m.shares).size !== m.shares.length) out.push('a share is listed twice')
  }
  for (const [name, sha] of Object.entries(m.files)) if (!FILE_NAME_RE.test(name) || !SHA_RE.test(sha)) out.push(`file ${name} is malformed`)
  if (m.files['collab-bridge'] !== m.binary_sha256) out.push('binary_sha256 is not the sha256 listed for collab-bridge')
  return out
}

/** `device …`, `build …`, `prepared …`, `expiry …`, `trial_commit …`, `tools_digest …`, one `share <path>` each, one `sha256 <hex> <name>` each. */
export function renderManifest(m: Manifest): string {
  const problems = manifestProblems(m)
  if (problems.length > 0) throw new Error(`MANIFEST: ${problems.join('; ')}`)
  return [
    ...SCALAR_KEYS.map((k) => `${k} ${m[k]}`),
    ...m.shares.map((s) => `share ${s}`),
    ...Object.keys(m.files).sort().map((name) => `sha256 ${m.files[name]} ${name}`),
  ].join('\n') + '\n'
}

/** Null unless every line is known and well-formed, each scalar appears once, and collab-bridge's sha256 is listed. */
export function parseManifest(text: string): Manifest | null {
  const v = new Map<Scalar, string>()
  const shares: string[] = []
  const files: Record<string, string> = {}
  for (const line of text.split('\n')) {
    if (line === '') continue
    const sp = line.indexOf(' ')
    if (sp < 1) return null
    const key = line.slice(0, sp), value = line.slice(sp + 1)
    if (key === 'share') shares.push(value)
    else if (key === 'sha256') {
      const m = /^([0-9a-f]{64}) ([A-Za-z0-9._-]{1,64})$/.exec(value)
      if (!m || m[2]! in files) return null
      files[m[2]!] = m[1]!
    } else if ((SCALAR_KEYS as string[]).includes(key) && !v.has(key as Scalar)) v.set(key as Scalar, value)
    else return null
  }
  if (SCALAR_KEYS.some((k) => !v.has(k)) || files['collab-bridge'] === undefined) return null
  const m: Manifest = {
    device: v.get('device')!, build: v.get('build')!, prepared: v.get('prepared')!, expiry: v.get('expiry')!,
    binary_sha256: files['collab-bridge'], tools_digest: v.get('tools_digest')!, trial_commit: v.get('trial_commit')!, shares, files,
  }
  return manifestProblems(m).length === 0 ? m : null
}

// ---- the checks of §10.3 step 4 ----

export interface ShareCheck { path: string; state: 'exists' | 'absent'; realpath: string; gitdir: string }
export interface CheckReport { ok: boolean; failures: string[]; user: string; uid: number; git: ResolvedGit | null;
  summon: { key_sha256: string; dropin_stat: string } | null; shares: ShareCheck[]; manifest: Manifest | null }

const within = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith('/') ? parent : parent + '/')
const dashed = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
const stamp = (p: string) => `${dashed(p)} ${p.slice(8, 10)}:${p.slice(10, 12)}:${p.slice(12, 14)} UTC`

/** Today on this Mac's clock as YYYYMMDD: sshd reads a key's expiry-time in local time. */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** The drop-in's owner the check expects: root, or under the test override only, COLLAB_BRIDGE_DROPIN_OWNER_UID (P60). */
export function dropinOwnerUidOf(env: Env): number {
  return knobInt('COLLAB_BRIDGE_DROPIN_OWNER_UID', env) ?? 0
}

function errnoOf(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | null)?.code
}

/** Whether something is at `p` (a dangling symlink counts): lstat, never a follow. */
function lexists(p: string): boolean {
  try { lstatSync(p); return true } catch { return false }
}

/**
 * §11.1: a citizen's folder is one with REST or EVENT-ONLY at its root, or anything under ~/love-unlimited, by spelling,
 * by where ~/love-unlimited really is (so a folder that is not there yet is judged by where it would be, even when
 * ~/love-unlimited is a symlink), or by what the folder resolves to. A folder that is not there holds no marker (`clear`);
 * one that cannot be read is `unknown`, which the installer refuses like a citizen. APFS ignores case, so `rest` is found as REST.
 */
export function citizenRoot(path: string, home: string): 'citizen' | 'clear' | 'unknown' {
  const lu = join(home, 'love-unlimited')
  if (within(normalize(path).toLowerCase(), lu.toLowerCase())) return 'citizen'
  const luReal = safeRealpath(lu)
  if (luReal && within(normalize(path).toLowerCase(), luReal.toLowerCase())) return 'citizen'    // whether or not `path` resolves
  const real = safeRealpath(path)
  if (luReal && real && within(real, luReal)) return 'citizen'
  if (!real) {
    try { lstatSync(path) } catch (e) { return errnoOf(e) === 'ENOENT' ? 'clear' : 'unknown' }
    return 'unknown'                                  // there, but it does not resolve (a dangling link)
  }
  try { readdirSync(real) } catch { return 'unknown' }
  for (const marker of ['REST', 'EVENT-ONLY']) {
    try { lstatSync(join(real, marker)); return 'citizen' } catch (e) { if (errnoOf(e) !== 'ENOENT') return 'unknown' }
  }
  return 'clear'
}

/**
 * The entry that governs a folder that does not exist yet: the longest entry containing it, where an entry that does not
 * resolve is resolved through its parent (one missing leaf), so `~/Projects/collab-trial` matches before the clone.
 */
function absentFolderMatch(toBe: string, al: Allowlist, home: string, realpath: (p: string) => string | null): AllowlistFolder | null {
  let best: { real: string; f: AllowlistFolder } | null = null
  for (const f of al.folders) {
    const spelled = expandHome(f.path, home)
    let r = realpath(spelled)
    if (!r) { const pr = realpath(dirname(spelled)); r = pr ? join(pr, basename(spelled)) : null }
    if (r && within(toBe, r) && (!best || r.length > best.real.length)) best = { real: r, f }
  }
  return best ? best.f : null
}

interface ShareCtx { home: string; uid: number; allowlist: Allowlist | null; git: ResolvedGit | null; trialCommit: string | null; run: Run;
  realpath: (p: string) => string | null }
type ShareResult = { failures: string[]; check: ShareCheck | null }

/** The recorded git with the fetch gate's scrubbed env (P44) and no repo-configured fsmonitor or hooks. */
function shareGit(c: ShareCtx, folder: string, args: string[]) {
  return c.run(c.git!.path, ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', folder, ...args],
    { env: gitEnv(c.home), timeoutMs: 10_000 })
}

/** A share folder that exists: a git repo root whose history holds the trial commit, in an edit folder, not a citizen's, not TCC. */
function existingShare(path: string, c: ShareCtx): ShareResult {
  const failures: string[] = []
  const fail = (code: string, text: string) => { failures.push(`${code}: ${text}`) }
  const done = (): ShareResult => ({ failures, check: null })
  const tcc = tccProtected(path, c.home, c.realpath)
  if (tcc) { fail('share_tcc', `${path} is in ~/${tcc}, which macOS protects; share a folder outside Desktop, Documents, Downloads and iCloud Drive`); return done() }
  const real = c.realpath(path)
  if (!real) { fail('share_unresolved', `${path} is there but does not resolve`); return done() }
  try { if (!statSync(real).isDirectory()) { fail('share_not_dir', `${path} is not a folder`); return done() } } catch { fail('share_unresolved', `${path} cannot be read`); return done() }
  const citizen = citizenRoot(real, c.home)
  if (citizen === 'citizen') fail('share_citizen', `${path} is a citizen's folder (REST or EVENT-ONLY at its root, or under ~/love-unlimited) and can never be shared`)
  if (citizen === 'unknown') fail('share_unclassified', `${path} cannot be read to check whether it is a citizen's folder`)
  if (c.allowlist && longestFolderMatch(real, c.allowlist, c.home, c.realpath)?.access !== 'edit') {
    fail('share_not_edit', `${path} is not inside an \`access: edit\` folder of Summon's allowlist (~/.config/summon/allowlist.yaml)`)
  }
  if (!c.git) return done()                           // the git failure is reported once, above the shares
  const top = shareGit(c, real, ['rev-parse', '--show-toplevel'])
  if (top.code !== 0 || c.realpath(top.stdout.trim()) !== real) { fail('share_not_repo_root', `${path} is not the root of a git repository`); return done() }
  const dotGit = join(real, '.git')
  let ownDir = false
  try { ownDir = lstatSync(dotGit).isDirectory() } catch { ownDir = false }
  const gd = shareGit(c, real, ['rev-parse', '--absolute-git-dir'])
  if (!ownDir || gd.code !== 0 || c.realpath(gd.stdout.trim()) !== dotGit) {
    fail('share_gitdir', `${path}/.git must be the repository's own folder (not a linked worktree, a gitdir file or a symlink)`)
    return done()
  }
  if (c.trialCommit) {
    const has = shareGit(c, real, ['merge-base', '--is-ancestor', c.trialCommit, 'HEAD'])
    if (has.code !== 0) fail('share_missing_commit', `${path} does not hold the trial commit ${c.trialCommit.slice(0, 12)} in its history`)
  }
  return failures.length > 0 ? done() : { failures, check: { path, state: 'exists', realpath: real, gitdir: dotGit } }
}

/** A share folder that is absent (it will be cloned): its parent resolves, is yours, is outside TCC and ~/love-unlimited, and it would be an edit folder. */
function absentShare(path: string, c: ShareCtx): ShareResult {
  const failures: string[] = []
  const fail = (code: string, text: string) => { failures.push(`${code}: ${text}`) }
  const done = (): ShareResult => ({ failures, check: null })
  const spelled = tccProtected(path, c.home, c.realpath)
  if (spelled) { fail('share_tcc', `${path} is in ~/${spelled}, which macOS protects`); return done() }
  const parent = dirname(path)
  const parentReal = c.realpath(parent)
  if (!parentReal) { fail('share_parent', `the folder ${parent} does not exist, so ${path} cannot be made there`); return done() }
  try {
    const st = statSync(parentReal)
    if (!st.isDirectory() || st.uid !== c.uid) fail('share_parent_owner', `${parent} is not a folder owned by you`)
  } catch { fail('share_parent', `${parent} cannot be read`); return done() }
  const viaParent = tccProtected(parent, c.home, c.realpath)
  if (viaParent) { fail('share_tcc', `${parent} leads into ~/${viaParent}, which macOS protects`); return done() }
  const toBe = join(parentReal, basename(path))
  // Both the spelled path and where it would really be: ~/love-unlimited may be a link, and the folder is not there to resolve. Worst verdict wins.
  const verdicts = [citizenRoot(path, c.home), citizenRoot(toBe, c.home)]
  const citizen = verdicts.includes('citizen') ? 'citizen' : verdicts.includes('unknown') ? 'unknown' : 'clear'
  if (citizen === 'citizen') fail('share_citizen', `${path} would be under ~/love-unlimited, a citizen's folder`)
  if (citizen === 'unknown') fail('share_unclassified', `${path} cannot be checked for a citizen's folder`)
  if (c.allowlist && absentFolderMatch(toBe, c.allowlist, c.home, c.realpath)?.access !== 'edit') {
    fail('share_not_edit', `${path} is not inside an \`access: edit\` folder of Summon's allowlist (~/.config/summon/allowlist.yaml)`)
  }
  return failures.length > 0 ? done() : { failures, check: { path, state: 'absent', realpath: toBe, gitdir: join(toBe, '.git') } }
}

export interface CheckInput { bundle: string; shares: string[]; terminalGit: string | null; claude: string | null; paths: NuancePaths;
  uid: number; user: string; platform: string; arch: string; zsh: string; xcrun: string; today: string; dropinOwnerUid: number; run?: Run }

/** The share checks with the context installCheck built: install clone's re-check after it cloned (§10.3 step 5). */
function shareCtxOf(o: CheckInput, allowlist: Allowlist | null, git: ResolvedGit | null, trialCommit: string | null): ShareCtx {
  return { home: o.paths.home, uid: o.uid, allowlist, git, trialCommit, run: o.run ?? runCmd, realpath: safeRealpath }
}

/**
 * Every check of §10.3 step 4, all collected (never only the first), before anything but the trial clone is written.
 * Each failure is `<code>: <sentence>`; ok is true only with none. The Summon baselines (P22) are recorded either way.
 */
export function installCheck(o: CheckInput): CheckReport {
  const failures: string[] = []
  const fail = (code: string, text: string) => { failures.push(`${code}: ${text}`) }
  const { paths } = o
  const run = o.run ?? runCmd
  if (o.platform !== 'darwin') fail('platform', `this installer is for macOS (this is ${o.platform})`)
  if (o.arch !== 'arm64') fail('platform', `this installer is for Apple Silicon (this is ${o.arch})`)
  if (o.uid === 0) fail('root', 'run it as your own user, not as root')

  // §10.1: Summon installed and live, with sshd taking keys only, is what makes leaning on Remote Login safe.
  const isFile = (p: string) => { try { return statSync(p).isFile() } catch { return false } }
  if (!isFile(paths.summonInstalled)) fail('summon_not_installed', `Summon is not installed here (no ${paths.summonInstalled}); install Summon first`)
  if (!isFile(paths.summonKeysOnly)) fail('summon_keys_only', `Summon's record that SSH takes keys only (${paths.summonKeysOnly}) is missing; run Summon's installer again`)
  let keys: string | null = null
  try { keys = readFileSync(paths.authorizedKeys, 'utf8') } catch { fail('authorized_keys', `${paths.authorizedKeys} cannot be read`) }
  if (keys !== null && !keys.split('\n').some((l) => l.endsWith(' summon-air'))) {
    fail('summon_key_missing', `Summon's summon-air key line is not in ${paths.authorizedKeys}`)
  }
  let dropinOk = false
  try {
    const st = lstatSync(paths.summonDropin)
    const owner = o.dropinOwnerUid === 0 ? 'root' : `uid ${o.dropinOwnerUid}`
    if (!st.isFile()) fail('dropin_missing', `${paths.summonDropin} is not a regular file`)
    else if (st.uid !== o.dropinOwnerUid) fail('dropin_owner', `${paths.summonDropin} is owned by uid ${st.uid}, not ${owner}`)
    else if ((st.mode & 0o7777) !== 0o600) fail('dropin_mode', `${paths.summonDropin} has mode ${(st.mode & 0o7777).toString(8)}, not 600`)
    else dropinOk = true
  } catch {
    fail('dropin_missing', `the password-off drop-in ${paths.summonDropin} is missing (Summon's installer puts it there)`)
  }
  const dstat = dropinStat(paths.summonDropin)
  const summon = keys !== null && dropinOk && dstat !== null ? { key_sha256: summonKeySha256(keys), dropin_stat: dstat } : null

  // The bundle: MANIFEST, the files it lists, the key's expiry, and never older than what is installed (K39's two checks).
  let manifest: Manifest | null = null
  try { manifest = parseManifest(readFileSync(join(o.bundle, 'MANIFEST.txt'), 'utf8')) } catch { manifest = null }
  if (!manifest) fail('manifest', `${join(o.bundle, 'MANIFEST.txt')} is missing or malformed`)
  else {
    for (const name of BUNDLE_FILES) if (manifest.files[name] === undefined) fail('manifest', `MANIFEST.txt does not list ${name}`)
    for (const [name, sha] of Object.entries(manifest.files)) {
      let got: string | null = null
      try { got = sha256File(join(o.bundle, name)) } catch { got = null }
      if (got !== sha) fail('checksum', `${name} does not match MANIFEST.txt; do not install this bundle`)
    }
    if (manifest.shares.join('\n') !== o.shares.join('\n')) fail('manifest', 'the shares given are not the ones MANIFEST.txt lists')
    if (!(Number(manifest.expiry) > Number(o.today))) fail('expired', `this bundle's key expired on ${dashed(manifest.expiry)}; ask Ai for a fresh bundle`)
    if (lexists(paths.installed)) {
      let installed = null
      try { installed = parseInstalled(readFileSync(paths.installed, 'utf8')) } catch { installed = null }
      if (!installed) fail('installed_unreadable', `${paths.installed} is there but cannot be read; tell Ai`)
      else if (manifest.prepared < installed.prepared) {
        fail('older_bundle', `this bundle was prepared ${stamp(manifest.prepared)}, before the installed one (${stamp(installed.prepared)}); run the newest bundle`)
      }
    }
    const keyExpiry = (keys ?? '').split('\n').map((l) => /expiry-time="(\d{8})".* collab-air$/.exec(l)?.[1]).filter((x): x is string => !!x).sort().pop()
    if (keyExpiry && manifest.expiry < keyExpiry) {
      fail('older_bundle', `this bundle's key expires ${dashed(manifest.expiry)}, before the installed collab-air key (${dashed(keyExpiry)}); run the newest bundle`)
    }
  }

  if (!zshenvClean(o.zsh, paths.home)) {
    fail('zshenv', '~/.zshenv (or another zsh start-up file) prints something or fails; it must stay silent for a non-interactive zsh, because the Air reads this Mac\'s output from the first byte')
  }
  let git: ResolvedGit | null = null
  const g = resolveGit({ xcrun: o.xcrun, terminalGit: o.terminalGit, home: paths.home, run })
  if (!g.ok) fail('git', g.reason)
  else {
    git = g.git
    if (!gitAcceptable(g.git)) {
      fail('git_unsafe', `${g.git.path} is git ${g.git.version}${g.git.apple ? ' (Apple)' : ''}${g.git.guard ? '' : ' without the GIT_NO_LAZY_FETCH guard'}; the fetch gate needs git 2.45.1 or later, or Apple git 2.39.5 or later with the guard`)
    }
  }
  let claudeOk = false
  try { claudeOk = !!o.claude && o.claude.startsWith('/') && statSync(o.claude).isFile() && (accessSync(o.claude, constants.X_OK), true) } catch { claudeOk = false }
  if (!claudeOk) fail('claude', 'Claude Code (claude) was not found on your Terminal PATH')

  const al = loadAllowlist(paths.summonAllowlist)
  if (!al.ok) fail('allowlist', `Summon's allowlist ${paths.summonAllowlist} cannot be used (${al.detail})`)
  const ctx = shareCtxOf(o, al.ok ? al.allowlist : null, git, manifest ? manifest.trial_commit : null)
  const shares: ShareCheck[] = []
  for (const s of o.shares) {
    const problem = sharePathProblem(s)
    if (problem) { fail('share_path', `${s} ${problem}`); continue }
    const r = lexists(s) ? existingShare(s, ctx) : absentShare(s, ctx)
    failures.push(...r.failures)
    if (r.check) shares.push(r.check)
  }
  return { ok: failures.length === 0, failures, user: o.user, uid: o.uid, git, summon, shares, manifest }
}

// ---- the trial clone of §10.3 step 5 ----

const firstLine = (s: string) => s.split('\n').find((l) => l.trim() !== '')?.replace(/[^\x20-\x7e]/g, '?').slice(0, 200) ?? ''

/**
 * Clones the bundle into a fresh sibling `.<name>.partial-<random>` (never an existing path), checks it holds the trial
 * commit, drops its `origin` remote (the bundle file in Downloads), then claims the target with an exclusive mkdir and
 * renames the clone over that empty folder, so a target that appeared meanwhile is refused and left alone. Then the
 * existing-folder checks run again on the clone; on any failure this run's folder, and only it, is removed.
 */
export function installClone(o: { bundle: string; share: string; git: ResolvedGit; trialCommit: string; home: string; rand(): string;
  recheck(share: string): string[] }): { ok: true; created: string } | { ok: false; reason: string } {
  const parentReal = safeRealpath(dirname(o.share))
  if (!parentReal) return { ok: false, reason: `the folder ${dirname(o.share)} does not exist; nothing was cloned` }
  const name = basename(o.share)
  const target = join(parentReal, name)
  if (lexists(target)) return { ok: false, reason: `${o.share} already exists; nothing was cloned` }
  const r = o.rand()
  if (!/^[0-9a-f]{8,32}$/.test(r)) throw new Error('installClone: rand() must give 8 to 32 hex digits')
  const partial = join(parentReal, `.${name}.partial-${r}`)
  if (lexists(partial)) return { ok: false, reason: `${partial} already exists; nothing was cloned` }
  const git = (args: string[]) => runCmd(o.git.path, ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { env: gitEnv(o.home), timeoutMs: 120_000 })
  const dropPartial = () => rmSync(partial, { recursive: true, force: true })
  const cl = git(['clone', '--quiet', '--no-hardlinks', join(o.bundle, 'collab-trial.bundle'), partial])
  if (cl.code !== 0) { dropPartial(); return { ok: false, reason: `git clone of the trial bundle failed: ${firstLine(cl.stderr)}` } }
  if (git(['-C', partial, 'merge-base', '--is-ancestor', o.trialCommit, 'HEAD']).code !== 0) {
    dropPartial(); return { ok: false, reason: 'the clone does not hold the trial commit' }
  }
  if (git(['-C', partial, 'remote', 'remove', 'origin']).code !== 0) { dropPartial(); return { ok: false, reason: 'could not remove the clone\'s origin remote' } }
  try { mkdirSync(target) } catch {
    dropPartial(); return { ok: false, reason: `${o.share} appeared while the bundle was being cloned; it was left as it is` }
  }
  try { renameSync(partial, target) } catch {
    try { rmdirSync(target) } catch { /* someone else's files are in it now: leave it */ }
    dropPartial(); return { ok: false, reason: `${o.share} changed while the bundle was being cloned; it was left as it is` }
  }
  const problems = o.recheck(o.share)
  if (problems.length > 0) {
    rmSync(target, { recursive: true, force: true })
    return { ok: false, reason: `the new clone failed its checks and was removed: ${problems.join('; ')}` }
  }
  return { ok: true, created: target }
}

// ---- The verbs the bash installer runs (Task 55: check, clone; Task 56 adds write, settings, unsettings) ----

export const INSTALL_USAGE = 'usage: collab-bridge install check|clone --bundle <dir> --share <path>… --terminal-git <path> --claude <path>'

type FlagSpec = Record<string, 'one' | 'many' | 'flag'>
type Flags = Map<string, string[]>

/** Strict flags: only the named ones, each `one` exactly once, a `many` at least once, a value after every non-`flag`. */
function parseFlags(args: string[], spec: FlagSpec): Flags | null {
  const got: Flags = new Map()
  for (let i = 0; i < args.length; i++) {
    const kind = spec[args[i]!]
    if (!kind) return null
    if (kind === 'flag') { if (got.has(args[i]!)) return null; got.set(args[i]!, []); continue }
    const value = args[i + 1]
    if (value === undefined) return null
    const list = got.get(args[i]!) ?? []
    if (kind === 'one' && list.length > 0) return null
    list.push(value)
    got.set(args[i]!, list)
    i++
  }
  for (const [name, kind] of Object.entries(spec)) if (kind !== 'flag' && !got.has(name)) return null
  return got
}

const CHECK_FLAGS: FlagSpec = { '--bundle': 'one', '--share': 'many', '--terminal-git': 'one', '--claude': 'one' }

/** installCheck's input from the flags and this process: the passwd user (never $USER), the systemBin zsh and xcrun. */
function checkInputOf(f: Flags, env: Env, paths: NuancePaths): CheckInput {
  const one = (k: string) => f.get(k)![0]!
  return {
    bundle: one('--bundle'), shares: f.get('--share')!, terminalGit: one('--terminal-git') || null, claude: one('--claude') || null,
    paths, uid: process.getuid!(), user: passwdOfSelf().name, platform: process.platform, arch: process.arch,
    zsh: systemBin('zsh', env), xcrun: systemBin('xcrun', env), today: localYmd(new Date()), dropinOwnerUid: dropinOwnerUidOf(env),
  }
}

export async function runInstallVerb(argv: string[], env: Env, io: GateIo): Promise<number> {
  const [verb, ...args] = argv
  const answer = (o: object, ok: boolean) => { io.stdout.write(JSON.stringify(o) + '\n'); return ok ? 0 : 1 }
  const usage = () => { io.stderr.write(INSTALL_USAGE + '\n'); return answer({ ok: false, failures: ['usage'] }, false) }
  const flags = verb === 'check' || verb === 'clone' ? parseFlags(args, CHECK_FLAGS) : null
  if (!flags) return usage()
  const paths = nuancePaths(homeOf(env), env)
  const input = checkInputOf(flags, env, paths)
  const report = installCheck(input)
  for (const f of report.failures) io.stderr.write(`✗ ${f}\n`)
  if (verb === 'check') {
    if (report.ok) {
      io.stderr.write(`✓ Summon is installed and SSH takes keys only; git ${report.git!.version} at ${report.git!.path}; Claude Code found\n`)
      for (const s of report.shares) io.stderr.write(s.state === 'exists' ? `✓ ${s.path}: a repository holding the trial commit\n` : `✓ ${s.path}: will be cloned from the bundle\n`)
    }
    return answer(report, report.ok)
  }
  if (!report.ok) return answer({ ok: false, reason: 'the checks failed; nothing was cloned', created: [] }, false)
  const created: string[] = []
  const al = loadAllowlist(paths.summonAllowlist)
  const ctx = shareCtxOf(input, al.ok ? al.allowlist : null, report.git, report.manifest!.trial_commit)
  for (const s of report.shares) {
    if (s.state !== 'absent') continue
    const r = installClone({ bundle: input.bundle, share: s.path, git: report.git!, trialCommit: report.manifest!.trial_commit, home: paths.home,
      rand: () => randomBytes(8).toString('hex'), recheck: (share) => existingShare(share, ctx).failures })
    if (!r.ok) {
      for (const c of created) rmSync(c, { recursive: true, force: true })     // only the folders this run made
      io.stderr.write(`✗ ${r.reason}\n`)
      return answer({ ok: false, reason: r.reason, created: [] }, false)
    }
    created.push(r.created)
    io.stderr.write(`✓ cloned the trial repo into ${s.path}\n`)
  }
  return answer({ ok: true, created }, true)
}

// The git Nuance runs (spec §7.4 "The git it runs"; K43, K52; P44). Resolved once at install with a fresh env (no
// DEVELOPER_DIR), recorded by realpath with its version, sha256 and guard, and from then on the only git anything on Nuance
// executes. /usr/bin/git is the xcrun shim (a hard link shared by 78 developer tools, no guard string): it is never recorded,
// and never run, since on a Mac without the Command Line Tools it opens an install dialog.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'

export interface ResolvedGit { path: string; version: string; sha256: string; guard: boolean; apple: boolean }
export type Run = (cmd: string, args: string[], o?: { env?: Record<string, string>; timeoutMs?: number; input?: string }) =>
  { code: number | null; stdout: string; stderr: string }

const XCRUN_SHIM = '/usr/bin/git'
const GUARD = Buffer.from('GIT_NO_LAZY_FETCH')
const SAFE_MIN = '2.45.1'          // fixed builds set GIT_NO_LAZY_FETCH by default (K52)
const APPLE_MIN = '2.39.5'         // Apple's 2.39.5 carries the guard backported; the binary is checked for it

/** spawnSync with cwd '/', a built env (never this process's) and a finite timeout; code null means it did not exit normally. */
export const runCmd: Run = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8', cwd: '/', env: o.env ?? { PATH: '/usr/bin:/bin' }, timeout: o.timeoutMs ?? 5_000,
    maxBuffer: 16 * 1024 * 1024, input: o.input, stdio: [o.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  })
  return {
    code: typeof r.status === 'number' ? r.status : null,           // a missing binary gives status undefined under Bun
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : r.error ? r.error.message : '',
  }
}

/** The first line of `git --version`: "git version 2.39.5 (Apple Git-154)" or "git version 2.52.0"; anything else is null. */
export function parseGitVersion(out: string): { version: string; apple: boolean } | null {
  const m = /^git version (\d+\.\d+\.\d+)( \(Apple Git-[0-9.]+\))?$/.exec(out.split('\n')[0]!.replace(/\r$/, ''))
  return m ? { version: m[1]!, apple: m[2] !== undefined } : null
}

export function versionAtLeast(v: string, min: string): boolean {
  const parts = (s: string) => (/^\d+(\.\d+){0,3}$/.test(s) ? s.split('.').map(Number) : null)
  const a = parts(v), b = parts(min)
  if (!a || !b) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

/** Whether the binary's bytes contain "GIT_NO_LAZY_FETCH"; false when it cannot be read. */
export function hasLazyFetchGuard(path: string): boolean {
  try { return readFileSync(path).includes(GUARD) } catch { return false }
}

/** ≥ 2.45.1, or an Apple build ≥ 2.39.5 whose binary carries the guard (§7.4). */
export function gitAcceptable(g: { version: string; apple: boolean; guard: boolean }): boolean {
  return versionAtLeast(g.version, SAFE_MIN) || (g.apple && versionAtLeast(g.version, APPLE_MIN) && g.guard)
}

/** sha256 hex of the file's bytes. Throws when the file cannot be read. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** The shim by name, or any of its hard links (same device and inode; bigint, because the shim's inode exceeds 2^53). */
function isXcrunShim(p: string): boolean {
  if (p === XCRUN_SHIM) return true
  try {
    const a = statSync(p, { bigint: true }), b = statSync(XCRUN_SHIM, { bigint: true })
    return a.dev === b.dev && a.ino === b.ino
  } catch {
    return false
  }
}

type Candidate = { ok: true; git: ResolvedGit } | { ok: false; why: string }

function candidate(p: string | null, env: Record<string, string>, run: Run): Candidate {
  if (!p) return { ok: false, why: 'none' }
  if (!p.startsWith('/')) return { ok: false, why: 'not an absolute path' }
  if (isXcrunShim(p)) return { ok: false, why: '/usr/bin/git is the xcrun shim' }
  let real: string
  try { real = realpathSync.native(p) } catch { return { ok: false, why: 'does not exist' } }
  if (isXcrunShim(real)) return { ok: false, why: '/usr/bin/git is the xcrun shim' }
  try { if (!statSync(real).isFile()) return { ok: false, why: 'not a file' } } catch { return { ok: false, why: 'does not exist' } }
  const v = run(real, ['--version'], { env, timeoutMs: 5_000 })
  const parsed = v.code === 0 ? parseGitVersion(v.stdout) : null
  if (!parsed) return { ok: false, why: `${real} --version did not say "git version x.y.z"` }
  return { ok: true, git: { path: real, version: parsed.version, sha256: sha256File(real), guard: hasLazyFetchGuard(real), apple: parsed.apple } }
}

/**
 * `xcrun --find git` first (the Command Line Tools), else the realpath of the git on Yu's Terminal PATH (for Homebrew,
 * the Cellar binary). Every command runs with env exactly {PATH: /usr/bin:/bin, HOME}: a stray DEVELOPER_DIR makes xcrun
 * fail or find another toolchain. Whether the result is safe to serve with is gitAcceptable's question, not this one's.
 */
export function resolveGit(o: { xcrun: string; terminalGit: string | null; home: string; run?: Run }):
  { ok: true; git: ResolvedGit } | { ok: false; reason: string } {
  const run = o.run ?? runCmd
  const env = { PATH: '/usr/bin:/bin', HOME: o.home }
  const x = run(o.xcrun, ['--find', 'git'], { env, timeoutMs: 5_000 })
  const found = x.code === 0 ? x.stdout.trim() : ''
  const fromXcrun: Candidate = x.code !== 0 ? { ok: false, why: `exit ${x.code}` }
    : !found || found.includes('\n') ? { ok: false, why: 'no single path' }
    : candidate(found, env, run)
  if (fromXcrun.ok) return fromXcrun
  const fromTerminal = candidate(o.terminalGit, env, run)
  if (fromTerminal.ok) return fromTerminal
  return { ok: false, reason: `git not resolved (xcrun: ${fromXcrun.why}; terminal: ${fromTerminal.why})` }
}

// Copied from Summon (packages/summon/src/allowlist.ts and src/request.ts at b3ef7c95), never imported (spec §4.2, K39).
// parseAllowlist, loadAllowlist, expandHome, safeRealpath, TCC_PROTECTED and the spelling rule are Summon's verbatim;
// the Allowlist runtime type is the plan's (id: string, models: unknown[]). tccProtected and longestFolderMatch are the
// two halves of Summon's checkAdmission (TCC by spelling then by target; the longest resolved folder entry), which
// Summon keeps private, so Collab's gate and installer ask exactly what Summon's admission asks of the same file.
import { readFileSync, realpathSync } from 'node:fs'
import { join, normalize } from 'node:path'

export const DEVICE_RE = /^[a-z][a-z0-9-]{0,31}$/
export const RUNTIMES = ['claude', 'codex', 'hermes'] as const
/** What `claude --help` (2.1.296) lists for `--effort <level>`. */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Access = 'review' | 'edit'

export interface AllowlistModel { model: string; provider?: string; effort?: string[] }
export interface AllowlistFolder { path: string; access: Access }
export interface Allowlist {
  version: 1
  device: string
  peers: string[]
  runtimes: Array<{ id: string; models: unknown[]; reads_anywhere: boolean }>
  folders: AllowlistFolder[]
  limits: { max_concurrent: number; starts_per_hour: number; job_timeout_max_s: number }
}
type Parsed = { ok: true; allowlist: Allowlist } | { ok: false; detail: string }

const TOKEN_RE = /^[A-Za-z0-9._:-]{1,64}$/
export const TCC_PROTECTED: readonly string[] = ['Desktop', 'Documents', 'Downloads', 'Library/Mobile Documents']

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

export function parseAllowlist(text: string): Parsed {
  let y: any
  try { y = Bun.YAML.parse(text) } catch (e) { return { ok: false, detail: `yaml: ${String((e as Error).message).slice(0, 120)}` } }
  const fail = (detail: string): Parsed => ({ ok: false, detail })
  if (!y || typeof y !== 'object' || Array.isArray(y)) return fail('not a mapping')
  if (y.version !== 1) return fail('version must be 1')
  if (typeof y.device !== 'string' || !DEVICE_RE.test(y.device)) return fail('device')
  if (!Array.isArray(y.peers) || !y.peers.every((p: unknown) => typeof p === 'string' && DEVICE_RE.test(p))) return fail('peers')
  if (!Array.isArray(y.runtimes)) return fail('runtimes')
  const runtimes: Allowlist['runtimes'] = []
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
  for (const f of y.folders) {
    if (!f || typeof f.path !== 'string' || !(f.path === '~' || f.path.startsWith('~/') || f.path.startsWith('/'))) return fail('folder path')
    if (f.access !== 'review' && f.access !== 'edit') return fail('folder access')
    folders.push({ path: f.path, access: f.access })
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

export function loadAllowlist(path: string): Parsed {
  let text: string
  try { text = readFileSync(path, 'utf8') } catch { return { ok: false, detail: 'missing' } }
  return parseAllowlist(text)
}

export function expandHome(p: string, home: string): string {
  return p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p
}

export function safeRealpath(p: string): string | null {
  try { return realpathSync.native(p) } catch { return null }
}

const within = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith('/') ? parent : parent + '/')

/**
 * The TCC-protected folder a path is spelled inside, from its words alone (`..` and doubled slashes folded, case ignored as
 * the Mac's volume ignores it). Asked before anything is resolved: realpath into such a folder can fail EPERM under sshd,
 * and that must still read as protected, not "does not exist".
 */
function protectedBySpelling(expanded: string, home: string): string | null {
  const spelled = normalize(expanded).toLowerCase()
  return TCC_PROTECTED.find((p) => within(spelled, normalize(join(home, p)).toLowerCase())) ?? null
}

/**
 * The TCC folder a path lies in, by its spelling first and then by what it resolves to (Summon's checkAdmission order):
 * a symlink from an allowlisted folder into a protected one is refused by its target. A path that does not resolve
 * answers null here; whether it exists is the caller's own check.
 */
export function tccProtected(path: string, home: string, realpath: (p: string) => string | null = safeRealpath): string | null {
  const expanded = expandHome(path, home)
  const spelledIn = protectedBySpelling(expanded, home)
  if (spelledIn) return spelledIn
  const real = realpath(expanded)
  if (!real) return null
  for (const p of TCC_PROTECTED) {
    const pr = realpath(join(home, p)) ?? join(home, p)
    if (within(real, pr)) return p
  }
  return null
}

/**
 * The allowlist entry that governs `real` (a realpath): the folder entry with the longest realpath containing it, as
 * Summon's admission picks it. Entries that do not resolve are skipped, so a missing folder never widens or narrows access.
 */
export function longestFolderMatch(real: string, al: Allowlist, home: string,
  realpath: (p: string) => string | null = safeRealpath): AllowlistFolder | null {
  let best: { real: string; f: AllowlistFolder } | null = null
  for (const f of al.folders) {
    const fr = realpath(expandHome(f.path, home))
    if (fr && within(real, fr) && (!best || fr.length > best.real.length)) best = { real: fr, f }
  }
  return best ? best.f : null
}

import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { DEVICE_RE, RUNTIMES, type Access, type Runtime, type SummonRequest } from './request.ts'

export interface AllowlistModel { model: string; provider?: string; effort?: string[] }
export interface AllowlistRuntime { id: Runtime; models: AllowlistModel[]; reads_anywhere: boolean }
export interface AllowlistFolder { path: string; access: Access }
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
  const runtimes: AllowlistRuntime[] = []
  for (const r of y.runtimes) {
    if (!r || !(RUNTIMES as readonly string[]).includes(r.id)) return fail('runtime id')
    if (!Array.isArray(r.models) || r.models.length === 0) return fail(`models for ${r.id}`)
    const models: AllowlistModel[] = []
    for (const m of r.models) {
      if (!m || typeof m.model !== 'string' || !TOKEN_RE.test(m.model)) return fail(`model in ${r.id}`)
      if (m.provider !== undefined && (typeof m.provider !== 'string' || !TOKEN_RE.test(m.provider))) return fail(`provider in ${r.id}`)
      if (m.effort !== undefined && (!Array.isArray(m.effort) || !m.effort.every((e: unknown) => typeof e === 'string' && TOKEN_RE.test(e)))) return fail(`effort in ${r.id}`)
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
  if (!isInt(l.max_concurrent, 1, 8) || !isInt(l.starts_per_hour, 1, 120) || timeout === null || timeout > 86_400) return fail('limits')
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
const rank = (a: Access) => (a === 'review' ? 0 : 1)

export type Admission =
  | { ok: true; cwdReal: string }
  | { ok: false; reason: 'outside_allowlist'; detail: string; hint: string }
  | { ok: false; reason: 'tcc_protected_folder'; detail: string; hint?: string }

/** Every outside_allowlist refusal carries a hint: the YAML the operator would need to add. */
export function checkAdmission(req: SummonRequest, al: Allowlist, home: string,
  realpath: (p: string) => string | null = safeRealpath): Admission {
  const out = (detail: string, hint: string): Admission => ({ ok: false, reason: 'outside_allowlist', detail, hint })
  if (!al.peers.includes(req.from_device)) return out(`peer ${req.from_device} is not allowed`, `peers: [${[...al.peers, req.from_device].join(', ')}]`)
  const rt = al.runtimes.find((r) => r.id === req.runtime)
  if (!rt) return out(`runtime ${req.runtime} is not allowed`, `runtimes:\n  - id: ${req.runtime}\n    models: [{ model: ${req.model ?? 'sonnet'} }]`)
  if (rt.id !== 'claude' && !rt.reads_anywhere) return out(`${rt.id} can read any file on this Mac`, `add reads_anywhere: true to the ${rt.id} runtime entry`)
  if (rt.id === 'hermes' && req.access !== 'review') return out('hermes is review-only', 'send access: review')
  if (!req.model) return out('a model is required', 'send a model, for example sonnet')
  const m = rt.models.find((e) => e.model === req.model && e.provider === req.provider
    && (req.effort === undefined ? e.effort === undefined : (e.effort ?? []).includes(req.effort)))
  if (!m) {
    const triple = [`model: ${req.model}`, req.provider ? `provider: ${req.provider}` : '', req.effort ? `effort: [${req.effort}]` : '']
      .filter(Boolean).join(', ')
    return out(`model ${req.model}${req.provider ? '/' + req.provider : ''}${req.effort ? ' effort ' + req.effort : ''} is not allowed for ${rt.id}`,
      `add { ${triple} } to the ${rt.id} models`)
  }
  const cwdReal = realpath(expandHome(req.cwd, home))
  if (!cwdReal) return out(`cwd ${req.cwd} does not exist on this Mac`, 'create the folder or correct cwd')
  for (const p of TCC_PROTECTED) {
    const pr = realpath(join(home, p)) ?? join(home, p)
    if (within(cwdReal, pr)) return { ok: false, reason: 'tcc_protected_folder', detail: `${req.cwd} is inside ~/${p}` }
  }
  let best: { real: string; f: AllowlistFolder } | null = null
  for (const f of al.folders) {
    const fr = realpath(expandHome(f.path, home))
    if (fr && within(cwdReal, fr) && (!best || fr.length > best.real.length)) best = { real: fr, f }
  }
  if (!best) return out(`folder ${req.cwd} is not allowed`, `folders:\n  - path: ${req.cwd}\n    access: ${req.access}`)
  if (rank(req.access) > rank(best.f.access)) return out(`${req.access} is not allowed in ${best.f.path} (${best.f.access})`, `folders:\n  - path: ${best.f.path}\n    access: edit`)
  return { ok: true, cwdReal }
}

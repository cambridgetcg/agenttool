// The hub's front-door limits (spec §6.6, R20). Text limits are UTF-16 `.length` after normalisation, exactly as Collab
// counts (K20), and are what the seat tool list advertises; nothing is ever truncated, so an over-long field is a
// definite "not sent" (`field_too_long`). Rates are per seat or per lineage, on the monotonic clock (Review Focus 4).
import type { ToolDef } from '../link/messages.ts'
import { rolePrefix } from './stamp.ts'

/**
 * Collab's limits less what the hub adds: the actor label is cut to 64 inside its stamp; authority fields lose the 22
 * units of `remote self-declared: ` (1000 and 2000); a completion's limits and a recovery note keep 256 units free for
 * the hub's stamp (2000 and 4000, STAMP_RESERVE). A test derives each value from those numbers.
 */
export const ADVERTISED = { label: 64, authority_scope: 978, authority_basis: 1978, complete_limits: 1744, recovery_note: 3744 } as const

/** Collab's role limit (200) less the longest role prefix this seat can get: a 16-hex nonce and a 32-character harness. */
export function roleLimit(device: string, user: string): number {
  return 200 - rolePrefix(device, user, '0'.repeat(16), 'x'.repeat(32)).length
}

const REDUCED: Readonly<Record<string, Readonly<Record<string, (device: string, user: string) => number>>>> = {
  collab_session_start: { actor: () => ADVERTISED.label, role: roleLimit },
  collab_report_append: { authority_scope: () => ADVERTISED.authority_scope, authority_basis: () => ADVERTISED.authority_basis },
  collab_task_complete: { limits: () => ADVERTISED.complete_limits },
  collab_task_recover: { recovery_note: () => ADVERTISED.recovery_note },
}

type Schema = Record<string, unknown>
const isObj = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A copy of `tool` whose schema advertises the hub's reduced limits; the input is never changed. A field the hub must
 * reduce that the schema no longer has throws, so a changed Collab fails closed instead of going unchecked.
 */
export function reduceToolSchema(tool: ToolDef, device: string, user: string): ToolDef {
  const out = structuredClone(tool)
  const fields = REDUCED[tool.name]
  if (!fields) return out
  const props = out.inputSchema.properties
  for (const [field, limit] of Object.entries(fields)) {
    const prop = isObj(props) ? props[field] : undefined
    if (!isObj(prop)) throw new Error(`reduceToolSchema: ${tool.name} has no ${field} property to limit`)
    const own = typeof prop.maxLength === 'number' ? prop.maxLength : Infinity
    prop.maxLength = Math.min(own, limit(device, user))
  }
  return out
}

export type LengthCheck = { ok: true } | { ok: false; field: string; max: number; length: number }

/**
 * Every string, and every string item of an array, against its schema's maxLength, at any depth the schema describes
 * (Collab's anchors are one level down). Values the schema does not describe are not walked, so the walk is bounded by
 * the schema, never by the seat's input.
 */
export function checkLengths(tool: ToolDef, args: Record<string, unknown>): LengthCheck {
  return walk(tool.inputSchema, args, '')
}

function walk(schema: unknown, value: unknown, path: string): LengthCheck {
  if (!isObj(schema)) return { ok: true }
  if (typeof value === 'string') {
    const max = schema.maxLength
    if (typeof max === 'number' && value.length > max) return { ok: false, field: path, max, length: value.length }
    return { ok: true }
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = walk(schema.items, value[i], `${path}[${i}]`)
      if (!r.ok) return r
    }
    return { ok: true }
  }
  if (isObj(value) && isObj(schema.properties)) {
    for (const [key, v] of Object.entries(value)) {
      const r = walk(schema.properties[key], v, path === '' ? key : `${path}.${key}`)
      if (!r.ok) return r
    }
  }
  return { ok: true }
}

/** A token bucket on the monotonic clock: `burst` at once, then `ratePerS` a second. */
export class TokenBucket {
  private tokens: number
  private at: number
  private readonly ratePerS: number
  private readonly burst: number
  private readonly mono: () => number

  constructor(ratePerS: number, burst: number, mono: () => number) {
    this.ratePerS = ratePerS
    this.burst = burst
    this.mono = mono
    this.tokens = burst
    this.at = mono()
  }

  take(): boolean {
    const now = this.mono()
    // A monotonic clock never goes back; if a test clock does, it must not mint tokens.
    const elapsed = Math.max(0, now - this.at)
    this.at = now
    this.tokens = Math.min(this.burst, this.tokens + (elapsed * this.ratePerS) / 1000)
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

/** At least `ms` between two allowed calls with the same key; a refused call does not move the window. */
export class MinInterval {
  private readonly last = new Map<string, number>()
  private readonly ms: number
  private readonly mono: () => number

  constructor(ms: number, mono: () => number) {
    this.ms = ms
    this.mono = mono
  }

  allow(key: string): boolean {
    const now = this.mono()
    const prev = this.last.get(key)
    if (prev !== undefined && now - prev < this.ms) return false
    this.last.set(key, now)
    return true
  }
}

// knocksMinMs is the hub's knock-read spacing per lineage under T9 (one host CLI run at a time, at least 1 s apart), not a §6.6 row.
export const RATES = { mutationsPerS: 5, mutationBurst: 20, inflightPerLineage: 4, nextMinMs: 1_000, journalVerifyMinMs: 60_000, lineagesPerDevice: 8, knocksMinMs: 1_000 } as const

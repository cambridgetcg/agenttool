// What the hub writes into Collab on a remote seat's behalf (C12, spec §6.4, §7.6, R8, R14). The seat cannot forge
// these: its own actor and role reach Collab only inside them, and its text may not start with the stamp prefix.
// No stamp holds a time, so a same-key replay rebuilds exactly the same request (K24).
import { cutUtf16, normalizeLabel } from './normalize.ts'

/** UTF-16 units kept free for the hub's stamp in a completion's limits and a takeover's recovery note (§6.6). */
export const STAMP_RESERVE = 256
/** Put before a remote report's authority_scope and authority_basis (§6.3, R28). */
export const AUTHORITY_PREFIX = 'remote self-declared: '

const LABEL_MAX = 64
const NONCE_RE = /^[0-9a-f]{16}$/
const ROLE_AFTER_NONCE = ') self-declared: harness='

/**
 * `<device>/<user> · self-declared: <label>`. The label is the agent's own actor after N1, trimmed (Collab trims the
 * whole actor anyway) and cut to 64 UTF-16 units without splitting a surrogate pair; an empty label becomes the harness.
 */
export function actorStamp(device: string, user: string, label: string, harness: string): string {
  const cut = cutUtf16(normalizeLabel(label).trim(), LABEL_MAX).trim()
  return `${device}/${user} · self-declared: ${cut === '' ? harness : cut}`
}

export function rolePrefix(device: string, user: string, startNonce: string, harness: string): string {
  return `remote(${device}/${user}; start=${startNonce}) self-declared: harness=${harness}; `
}

/** The prefix, then the agent's role after N1. Its length was checked against roleLimit before this runs (§6.6). */
export function roleStamp(device: string, user: string, startNonce: string, harness: string, role: string | undefined): string {
  return rolePrefix(device, user, startNonce, harness) + normalizeLabel(role ?? '')
}

/**
 * The start nonce of a role this hub stamped for (device, user), read at its fixed position and never searched for:
 * an agent's free text after the prefix can contain a lookalike `start=…`, which must never count (§9.3 item 8).
 */
export function roleNonce(role: string, device: string, user: string): string | null {
  const head = `remote(${device}/${user}; start=`
  if (!role.startsWith(head)) return null
  const nonce = role.slice(head.length, head.length + 16)
  if (!NONCE_RE.test(nonce)) return null
  return role.startsWith(ROLE_AFTER_NONCE, head.length + 16) ? nonce : null
}

/** A new remote completion of an edit task: what the Air fetched, then the seat's own limits, labelled (§7.6). */
export function completeLimitsStamp(o: { oid: string; device: string; user: string; headEqualsBase: boolean; seatLimits: string | undefined }): string {
  return `hub-observed: fetched ${o.oid} from ${o.device}/${o.user} via git-upload-pack v0; remote clean self-declared` +
    (o.headEqualsBase ? '; HEAD equals base' : '') +
    (o.seatLimits ? `\nremote self-declared: ${o.seatLimits}` : '')
}

/** A remote takeover: the mirror was not refetched, and the device HEAD is only what the pipe declared (§7.6). */
export function takeoverNoteStamp(o: { syncedOid: string; declaredHead: string; seatNote: string }): string {
  return `hub-observed: mirror at ${o.syncedOid}, not refetched; device HEAD ${o.declaredHead} self-declared\n${o.seatNote}`
}

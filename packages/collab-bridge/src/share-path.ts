// The one share-path rule (spec §5.2's cost line): what the gate's upload-pack form can carry. Task 20 owns this file.
import { normalize } from 'node:path'

/** A path the gate's upload-pack form can carry (spec §5.2): absolute, normalised, no ' ! \ or control character. */
export const MAX_SHARE_PATH_BYTES = 1019, MAX_GITDIR_BYTES = 1024
export function sharePathProblem(p: unknown, maxBytes: number = MAX_SHARE_PATH_BYTES): string | null {
  if (typeof p !== 'string' || !/^\/[^'!\\\x00-\x1f\x7f]+$/.test(p)) return "must be an absolute path without ', !, \\ or a control character"
  if (Buffer.byteLength(p, 'utf8') > maxBytes) return `is longer than ${maxBytes} bytes`
  if (normalize(p) !== p || p.endsWith('/')) return 'must be written without //, /./, /../ or a trailing /'
  return null
}

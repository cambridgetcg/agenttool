// The pipe's tool cache (spec §6.2, R16, T5). The pipe answers tools/list from tools/<digest>.json, named by tools/current,
// so it works with the hub away. The bundle seeds it (tools/seed is the seeded list itself), and a list from the hub is
// taken only when its digest has the digest form, the digest recomputed here matches, and every tool name is one the
// bundle seeded: a stand-in hub (the stolen-key case of §5.1) can reword nothing and add no tool.
import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { DIGEST_RE, type ToolDef, type ToolsRefusedReason } from '../link/messages.ts'
import { writeFileDurable } from '../native.ts'
import type { NuancePaths } from '../paths.ts'
import { readToolsFile, toolsDigest, writeToolsFile } from '../tools-digest.ts'

export type ToolsVerdict = { ok: true; digest: string } | { ok: false; reason: ToolsRefusedReason }

function toolsDir(paths: NuancePaths): void {
  mkdirSync(paths.tools, { recursive: true, mode: 0o700 })
  chmodSync(paths.tools, 0o700)   // a mode passed to mkdir applies only to a new dir
}

/** The list tools/current names, or null when current is missing, malformed, or names a file that does not verify. */
export function readCurrentTools(paths: NuancePaths): { digest: string; list: ToolDef[] } | null {
  let digest: string
  try { digest = readFileSync(paths.toolsCurrent, 'utf8').trim() } catch { return null }
  if (!DIGEST_RE.test(digest)) return null
  const f = readToolsFile(paths.toolFile(digest))
  return f && f.digest === digest ? { digest, list: f.list } : null
}

/** tools/<digest>.json first, then tools/current pointing at it, each written whole; returns the digest. */
export function storeTools(paths: NuancePaths, list: ToolDef[]): string {
  toolsDir(paths)
  const digest = toolsDigest(list)
  writeToolsFile(paths.toolFile(digest), list)
  writeFileDurable(paths.toolsCurrent, `${digest}\n`, 0o600)
  return digest
}

/** The bundle's list (install write, Task 56): refused unless `digest` is its digest; it becomes the seed and current. */
export function seedTools(paths: NuancePaths, list: ToolDef[], digest: string): void {
  if (!DIGEST_RE.test(digest) || toolsDigest(list) !== digest) throw new Error('seedTools: the digest is not the digest of this list')
  toolsDir(paths)
  writeToolsFile(paths.toolsSeed, list)
  storeTools(paths, list)
}

export function seededNames(paths: NuancePaths): ReadonlySet<string> | null {
  const f = readToolsFile(paths.toolsSeed)
  return f ? new Set(f.list.map((t) => t.name)) : null
}

/** Stores the hub's list and points current at it only when every check passes; otherwise nothing is written. */
export function acceptHubTools(paths: NuancePaths, msg: { digest: string; list: ToolDef[] }): ToolsVerdict {
  if (!DIGEST_RE.test(msg.digest)) return { ok: false, reason: 'digest_format' }
  const names = seededNames(paths)
  if (!names) return { ok: false, reason: 'no_seed' }
  if (toolsDigest(msg.list) !== msg.digest) return { ok: false, reason: 'digest_mismatch' }
  const seen = new Set<string>()
  for (const t of msg.list) {
    // A name the bundle never seeded, or one seeded name listed twice: neither is a list this pipe may serve.
    if (!names.has(t.name) || seen.has(t.name)) return { ok: false, reason: 'unknown_tool' }
    seen.add(t.name)
  }
  return { ok: true, digest: storeTools(paths, msg.list) }
}

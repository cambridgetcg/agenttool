// The checks a fetched remote commit must pass before any of it is written to a mirror (spec §7.3 steps 6–7, R38). They
// read git objects only (ls-tree, diff-tree, merge-base in the Air clone), so a refused commit never reaches a worktree.
// Each check refuses rather than repairs, and stops reading at the first refusal (the stream is closed, git is stopped).
import { MIRROR_GIT_FLAGS, OID_RE, type GitRunner } from './git.ts'

export interface TreeCaps { maxEntries: number; maxTotalBytes: number; maxBlobBytes: number; maxChangedPaths: number }

/** Per share, adjustable (§6.6): 10k entries, 64 MiB summed per path entry, 16 MiB per blob, 128 changed paths. */
export const DEFAULT_CAPS: TreeCaps = Object.freeze({
  maxEntries: 10_000,
  maxTotalBytes: 64 * 1024 * 1024,
  maxBlobBytes: 16 * 1024 * 1024,
  maxChangedPaths: 128,
})

/** §7.3 step 7: a path with any of these segments, at any depth, is a control path; `.env.*` is matched by rule. */
export const CONTROL_SEGMENTS: readonly string[] = Object.freeze([
  '.claude', '.mcp.json', 'claude.md', 'claude.local.md', 'agents.md', '.envrc', '.env', 'bunfig.toml', 'package.json',
  '.npmrc', '.gitattributes', '.gitmodules', '.lfsconfig', '.githooks', '.husky', '.vscode', '.cursor', '.codex',
])
const CONTROL = new Set(CONTROL_SEGMENTS)

/**
 * NFC and NFD folding, then lower-casing (§7.3 step 7). The Air's APFS compares names case-insensitively, so the
 * upper-then-lower round trip also folds letters such as ſ (long s) and the Kelvin sign that lower-casing alone keeps;
 * refusing a few more exotic spellings is the safe direction.
 */
export function isControlPath(path: string): boolean {
  for (const seg of path.split('/')) {
    for (const form of ['NFC', 'NFD'] as const) {
      const n = seg.normalize(form)
      for (const f of [n.toLowerCase(), n.toUpperCase().toLowerCase()]) {
        if (CONTROL.has(f) || f.startsWith('.env.')) return true
      }
    }
  }
  return false
}

/** Collab's own rule (KN `src/store.ts:6799`, K67): exact, case-sensitive, a literal prefix. `notes/**` is not a glob. */
export function inScopes(path: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => path === scope || path.startsWith(`${scope}/`))
}

export type TreeCheck =
  | { ok: true; entries: number; totalBytes: number }
  | { ok: false; code: 'remote_too_large' | 'remote_non_regular_path' | 'fetch_failed'; path?: string }

/** One `ls-tree -r -z -l` record: mode, type, object, size (right-aligned, `-` for a gitlink), a tab, the path. */
const TREE_RECORD = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40,64}) +([0-9]+|-)\t([\s\S]+)$/

/**
 * §7.3 step 6: streams the whole tree of `oid` and stops at the first refusal. Sizes are summed per path entry, so many
 * paths to one blob count fully (K70: checkout writes every path in full). A gitlink is non-regular.
 */
export async function checkTree(git: GitRunner, repo: string, oid: string, caps: TreeCaps): Promise<TreeCheck> {
  if (!OID_RE.test(oid)) return { ok: false, code: 'fetch_failed' }
  let entries = 0
  let totalBytes = 0
  try {
    for await (const rec of git.records(['-C', repo, ...MIRROR_GIT_FLAGS, 'ls-tree', '-r', '-z', '-l', '--full-tree', oid])) {
      const m = TREE_RECORD.exec(rec)
      if (!m) return { ok: false, code: 'fetch_failed' }
      const [, mode, type, , size, path] = m as unknown as [string, string, string, string, string, string]
      entries += 1
      if (entries > caps.maxEntries) return { ok: false, code: 'remote_too_large', path }
      if (mode === '160000' || type === 'commit') return { ok: false, code: 'remote_non_regular_path', path }
      const bytes = Number(size)
      if (!Number.isSafeInteger(bytes)) return { ok: false, code: 'fetch_failed' }
      if (bytes > caps.maxBlobBytes) return { ok: false, code: 'remote_too_large', path }
      totalBytes += bytes
      if (totalBytes > caps.maxTotalBytes) return { ok: false, code: 'remote_too_large', path }
    }
  } catch {
    return { ok: false, code: 'fetch_failed' }
  }
  return { ok: true, entries, totalBytes }
}

export type DiffCheck =
  | { ok: true; changed: number }
  | { ok: false; code: 'remote_non_regular_path' | 'remote_out_of_scope' | 'remote_control_path' | 'remote_too_large' | 'fetch_failed'; path?: string }

/** One `diff-tree -z --raw` header; with `-z` the path follows as its own record. */
const RAW_HEADER = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])$/
/** Regular files and "no file" (the 000000 side of an add or a delete); a symlink (120000) or gitlink (160000) is refused. */
const REGULAR_MODES = new Set(['100644', '100755', '000000'])

/**
 * §7.3 step 7, every changed path from `base` to `oid`, in this order: a mode on either side other than 100644, 100755
 * or 000000 (no symlinks, no gitlinks, as Collab's own successor path refuses); a path outside the task's scopes by
 * Collab's literal-prefix rule; a control path; then the changed-path cap.
 */
export async function checkDiff(git: GitRunner, repo: string, base: string, oid: string, scopes: readonly string[], caps: TreeCaps): Promise<DiffCheck> {
  if (!OID_RE.test(base) || !OID_RE.test(oid)) return { ok: false, code: 'fetch_failed' }
  let changed = 0
  let header: RegExpExecArray | null = null
  try {
    for await (const rec of git.records(['-C', repo, ...MIRROR_GIT_FLAGS, 'diff-tree', '-r', '-z', '--raw', '--no-renames',
      '--no-textconv', '--no-ext-diff', base, oid])) {
      if (header === null) {
        header = RAW_HEADER.exec(rec)
        if (header === null) return { ok: false, code: 'fetch_failed' }
        continue
      }
      const path = rec
      const [, oldMode, newMode] = header as unknown as [string, string, string]
      header = null
      if (!REGULAR_MODES.has(oldMode) || !REGULAR_MODES.has(newMode)) return { ok: false, code: 'remote_non_regular_path', path }
      if (!inScopes(path, scopes)) return { ok: false, code: 'remote_out_of_scope', path }
      if (isControlPath(path)) return { ok: false, code: 'remote_control_path', path }
      changed += 1
      if (changed > caps.maxChangedPaths) return { ok: false, code: 'remote_too_large', path }
    }
  } catch {
    return { ok: false, code: 'fetch_failed' }
  }
  if (header !== null) return { ok: false, code: 'fetch_failed' } // a header without its path
  return { ok: true, changed }
}

/** `merge-base --is-ancestor`: exit 0 passes, 1 is remote_base_not_ancestor, anything else fetch_failed (§7.3 step 7). */
export async function ancestorCheck(git: GitRunner, repo: string, base: string, oid: string): Promise<'ok' | 'remote_base_not_ancestor' | 'fetch_failed'> {
  if (!OID_RE.test(base) || !OID_RE.test(oid)) return 'fetch_failed'
  const r = await git.run(['-C', repo, ...MIRROR_GIT_FLAGS, 'merge-base', '--is-ancestor', base, oid])
  return r.code === 0 ? 'ok' : r.code === 1 ? 'remote_base_not_ancestor' : 'fetch_failed'
}

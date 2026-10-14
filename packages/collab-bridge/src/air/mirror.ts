// Per-device mirrors on the Air (C11, spec §7.1, §7.3): one locked linked worktree of the Air clone per (device, user,
// Nuance repo), moved only by a read-only v0 fetch from the Nuance gate and a checkout of exactly the commit the pipe
// declared. Every step refuses rather than repairs (R12), except that a failed checkout restores the mirror first; an
// ambiguous failure is refused once and never retried. Nothing here takes the per-mirror lock: the caller holds it for
// the whole flow, from the sync until the forwarded call returns (Task 45, P25). No harness and no bun ever has its cwd in
// a mirror (R27): git runs with `-C` from cwd '/'.
//
// Accepted Phase 1 limit (Task 42 ruling): the Air clone is a working repository, and a failed bridge fetch removes the
// new `tmp_*` files in its objects/pack and counts the new pack bytes, both found by comparing the directory before and
// after. A concurrent Air-side `git fetch` in the same clone, during a failed bridge fetch, may therefore lose its own
// temporary pack (that fetch fails) and have its bytes count toward the bridge's daily budget. It fails closed and a
// re-run succeeds; the in-process lock below serialises only the bridge's own fetches.
import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statfsSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AgentCode } from '../failure.ts'
import { AIR_LEDGER_KEYS, appendLedger, readLedger, type LedgerFields } from '../ledger.ts'
import type { AirPaths } from '../paths.ts'
import { TIMING } from '../timing.ts'
import { ancestorCheck, checkDiff, checkTree, type TreeCaps } from './diff-check.ts'
import { MIRROR_GIT_FLAGS, OID_RE, type GitResult, type GitRunner } from './git.ts'

export interface MirrorSpec { device: string; user: string; mirrorId: string; mirrorPath: string; airClone: string; remoteGitdir: string; caps: TreeCaps }
export interface MirrorDeps {
  git: GitRunner; sshBin: string; sshConfig: string; alias: string; freeBytes(path: string): number
  fetchedToday(mirrorId: string): number; ledger(f: LedgerFields): void; wireCapBytes?: number; dailyBudgetBytes?: number
  minFreeBytes?: number; fetchTimeoutMs?: number; checkoutTimeoutMs?: number
}

/** §6.6: 128 MiB of pack per sync, 1 GiB of packs per mirror per day, 5 GiB free beyond the fetch (128 MiB) or the checkout. */
export const WIRE_CAP_BYTES = 134_217_728, DAILY_BUDGET_BYTES = 1_073_741_824, MIN_FREE_BYTES = 5_368_709_120, FETCH_HEADROOM_BYTES = 134_217_728

export type SyncResult = { ok: true; oid: string; changed?: number } | { ok: false; code: AgentCode; message: string }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const text = (r: GitResult) => new TextDecoder().decode(r.stdout).trim()
const refuse = (code: AgentCode, message: string): SyncResult => ({ ok: false, code, message })

/** `mirror_id = sha256(remote realpath)[:16]` (§7.1). */
export function mirrorIdOf(remoteRealpath: string): string {
  return sha256(remoteRealpath).slice(0, 16)
}

/**
 * True when git can hold the id as one ref component. Collab task ids are `[A-Za-z0-9][A-Za-z0-9._:-]*`; git refuses
 * `:`, `..`, and a trailing `.` or `.lock` in a ref name (git-check-ref-format(1)).
 */
export function taskRefOk(id: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(id) && !id.includes('..') && !id.endsWith('.') && !id.endsWith('.lock')
}

/** The mirror's refs, never under refs/heads (§7.1). Throws for a device, user, mirror id or task id git cannot hold. */
export function mirrorRefs(spec: MirrorSpec): { incoming: string; synced: string; task(taskId: string): string } {
  for (const part of [spec.device, spec.user, spec.mirrorId]) {
    if (!taskRefOk(part)) throw new Error(`mirrorRefs: ${JSON.stringify(part)} cannot be part of a ref name`)
  }
  const root = `refs/collab/${spec.device}/${spec.user}/${spec.mirrorId}`
  return {
    incoming: `${root}/incoming`,
    synced: `${root}/synced`,
    task(taskId: string) {
      if (!taskRefOk(taskId)) throw new Error(`mirrorRefs: task id ${JSON.stringify(taskId)} cannot be a ref name`)
      return `${root}/tasks/${taskId}`
    },
  }
}

/** `ulimit -f` counts 1024-byte blocks in the Air's /bin/sh (P11, F1): 128 MiB is 131072, never §7.3's 262144. */
export function ulimitBlocks(bytes: number): number {
  return Math.floor(bytes / 1024)
}

/** The fetch of §7.3 step 4, split where the Air's git starts: the size-capped shell and env words, then git's own args. */
function fetchParts(spec: MirrorSpec, deps: Pick<MirrorDeps, 'sshBin' | 'sshConfig' | 'alias' | 'git'>, wireCapBytes: number): { prefix: string[]; args: string[] } {
  if (!deps.sshBin.startsWith('/') || /[\s'"\\$`]/.test(deps.sshBin)) throw new Error('fetchArgv: the ssh path must be absolute with no shell characters')
  if (!deps.sshConfig.startsWith('/') || /['\\\n]/.test(deps.sshConfig)) throw new Error('fetchArgv: the ssh config path cannot be single-quoted')
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(deps.alias)) throw new Error('fetchArgv: bad ssh Host alias')
  // The gate's own grammar (§5.2): an absolute path of at most 1024 bytes with no ', !, \ or control character.
  if (!/^\/[^'!\\\x00-\x1f\x7f]{1,1023}$/.test(spec.remoteGitdir) || Buffer.byteLength(spec.remoteGitdir) > 1024) {
    throw new Error('fetchArgv: the remote gitdir cannot pass the gate')
  }
  if (!Number.isSafeInteger(wireCapBytes) || wireCapBytes < 1024) throw new Error('fetchArgv: bad wire cap')
  return {
    prefix: ['/bin/sh', '-c', `ulimit -f ${ulimitBlocks(wireCapBytes)}; exec "$@"`, 'sh',
      'env', '-u', 'GIT_SSH', `GIT_SSH_COMMAND=${deps.sshBin} -F '${deps.sshConfig}'`],
    args: ['-C', spec.airClone, '-c', 'protocol.version=0', '-c', 'transfer.fsckObjects=true', '-c', 'fetch.fsckObjects=true',
      '-c', 'transfer.unpackLimit=1', ...MIRROR_GIT_FLAGS, 'fetch', '--no-tags', '--no-recurse-submodules', '--no-prune',
      '--no-write-fetch-head', `${deps.alias}:${spec.remoteGitdir}`, `+HEAD:${mirrorRefs(spec).incoming}`],
  }
}

/**
 * The exact argv of §7.3 step 4: `-c fetch.fsckObjects=true` outranks any config that would turn fsck off, and
 * `transfer.unpackLimit=1` keeps the download as one pack file, which the file-size limit bounds. GIT_PROTOCOL is never
 * set, so the fetch is v0 end to end (K49).
 */
export function fetchArgv(spec: MirrorSpec, deps: Pick<MirrorDeps, 'sshBin' | 'sshConfig' | 'alias' | 'git'>, wireCapBytes: number): string[] {
  const { prefix, args } = fetchParts(spec, deps, wireCapBytes)
  return [...prefix, deps.git.path, ...args]
}

/** A FIFO async mutex, one per mirror, inside the one hub process (`hub.lock` keeps it to one hub, P25). */
export class MirrorLock {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => fn())
    this.tail = result.then(() => undefined, () => undefined) // a failure frees the lock for the next caller
    return result
  }
}

async function commitAt(deps: MirrorDeps, cwd: string, rev: string): Promise<string | null> {
  const r = await deps.git.run(['-C', cwd, ...MIRROR_GIT_FLAGS, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`])
  const oid = text(r)
  return r.code === 0 && OID_RE.test(oid) ? oid : null
}

async function commonDirOf(deps: Pick<MirrorDeps, 'git'>, cwd: string): Promise<string | null> {
  const r = await deps.git.run(['-C', cwd, ...MIRROR_GIT_FLAGS, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (r.code !== 0) return null
  try { return realpathSync(text(r)) } catch { return null }
}

/** The last synced oid (`…/synced`), or null when the ref is missing or unreadable. */
export function syncedOid(spec: MirrorSpec, deps: MirrorDeps): Promise<string | null> {
  return commitAt(deps, spec.airClone, mirrorRefs(spec).synced)
}

/**
 * The mirror's own HEAD commit, or null. The mirror must be a real directory (never a symlink) that git sees as its
 * own work-tree root, in the Air clone's repository: a plain directory would otherwise let git walk up to some parent
 * repository and report that one's HEAD.
 */
export async function mirrorHead(spec: MirrorSpec, deps: MirrorDeps): Promise<string | null> {
  let real: string
  try {
    const st = lstatSync(spec.mirrorPath)
    if (!st.isDirectory() || st.isSymbolicLink()) return null
    real = realpathSync(spec.mirrorPath)
  } catch { return null }
  const r = await deps.git.run(['-C', spec.mirrorPath, ...MIRROR_GIT_FLAGS, 'rev-parse', '--path-format=absolute',
    '--show-toplevel', '--git-common-dir', 'HEAD^{commit}'])
  if (r.code !== 0) return null
  const [top, common, oid] = text(r).split('\n')
  if (top !== real || !oid || !OID_RE.test(oid)) return null
  const clone = await commonDirOf(deps, spec.airClone)
  let commonReal: string
  try { commonReal = realpathSync(common ?? '') } catch { return null }
  return clone !== null && commonReal === clone ? oid : null
}

/** §7.3 step 1: null when the mirror is clean, detached, and at `…/synced`; else why not. */
async function tamperReason(spec: MirrorSpec, deps: MirrorDeps): Promise<string | null> {
  const head = await mirrorHead(spec, deps)
  if (head === null) return 'the mirror has no readable HEAD of its own in the Air clone'
  const synced = await syncedOid(spec, deps)
  if (synced === null) return 'the mirror has no synced ref'
  if (head !== synced) return "the mirror's HEAD is not its last synced commit"
  const sym = await deps.git.run(['-C', spec.mirrorPath, ...MIRROR_GIT_FLAGS, 'symbolic-ref', '-q', 'HEAD'])
  if (sym.code !== 1) return 'the mirror is not on a detached HEAD'
  // Ignored and untracked files count: a forced checkout would clobber them without a word (T16).
  const st = await deps.git.run(['-C', spec.mirrorPath, ...MIRROR_GIT_FLAGS, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored'])
  if (st.code !== 0) return 'git status failed in the mirror'
  if (st.stdout.byteLength > 0) return 'the mirror has local changes or extra files'
  return null
}

/**
 * §7.3 step 2, as seen from `cwd`: every scope (system, global, includes, the repo, the worktree), never `--local` or
 * `--file`, and never with `-c` (a command-line `core.fsmonitor=false` would itself match). Exit 1 with no output is clean.
 */
async function filterReason(cwd: string, deps: MirrorDeps): Promise<string | null> {
  const r = await deps.git.run(['-C', cwd, 'config', '--show-scope', '--get-regexp', '^filter\\.|^diff\\..*\\.textconv$|^core\\.fsmonitor$'])
  if (r.code === 1 && r.stdout.byteLength === 0 && !r.timedOut) return null
  if (r.code === 0) return 'a git filter, textconv or fsmonitor is configured where the mirror would see it'
  return 'the git config check failed'
}

/** §7.3 step 3. */
function diskAndBudget(spec: MirrorSpec, deps: MirrorDeps): SyncResult | null {
  const minFree = deps.minFreeBytes ?? MIN_FREE_BYTES
  let free: number
  try { free = deps.freeBytes(spec.airClone) } catch { return refuse('mirror_low_disk', 'the Air could not read its free disk space') }
  if (!(free >= minFree + FETCH_HEADROOM_BYTES)) return refuse('mirror_low_disk', 'the Air has less than 5 GiB plus the 128 MiB fetch allowance free')
  let today: number
  try { today = deps.fetchedToday(spec.mirrorId) } catch { return refuse('rate_limited', "the Air could not read today's fetch total for this mirror") }
  if (!(today < (deps.dailyBudgetBytes ?? DAILY_BUDGET_BYTES))) return refuse('rate_limited', 'this mirror has fetched its 1 GiB of packs for today')
  return null
}

function listPackDir(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

function sizeOf(path: string): number {
  try { return statSync(path).size } catch { return 0 }
}

/**
 * Two mirrors of one Air clone (two devices sharing a repo, Phase 2) fetch into one object store, so their fetches are
 * serialised: neither ever counts or removes the other's temporary pack.
 */
const cloneFetchLocks = new Map<string, MirrorLock>()

/**
 * §7.3 step 4: fetch the remote HEAD into `…/incoming`, then ledger the new pack bytes (P31: the day's budget is summed
 * from these lines). A fetch git leaves half done, whether it hit the file-size limit (SIGXFSZ leaves `tmp_pack_*`
 * behind, measured on this Air) or the timeout, has its new temporary files removed; their bytes still count.
 */
async function fetchIncoming(spec: MirrorSpec, deps: MirrorDeps): Promise<SyncResult | null> {
  let lock = cloneFetchLocks.get(spec.airClone)
  if (lock === undefined) cloneFetchLocks.set(spec.airClone, (lock = new MirrorLock()))
  return lock.run(() => fetchIncomingNow(spec, deps))
}

async function fetchIncomingNow(spec: MirrorSpec, deps: MirrorDeps): Promise<SyncResult | null> {
  const wireCap = deps.wireCapBytes ?? WIRE_CAP_BYTES
  let parts: { prefix: string[]; args: string[] }
  try { parts = fetchParts(spec, deps, wireCap) } catch { return refuse('fetch_failed', 'the fetch command could not be built safely from the device file') }
  const packs = await deps.git.run(['-C', spec.airClone, ...MIRROR_GIT_FLAGS, 'rev-parse', '--path-format=absolute', '--git-path', 'objects/pack'])
  if (packs.code !== 0) return refuse('fetch_failed', 'the Air clone has no object store git could name')
  const packDir = text(packs)
  const before = new Set(listPackDir(packDir))
  const { prefix, args } = parts
  const t0 = performance.now()
  // ownGroup: a timeout signals the whole group, so the fetch's ssh and index-pack die with git (R19, §7.3 step 4).
  const r = await deps.git.run(args, { prefix, timeoutMs: deps.fetchTimeoutMs ?? TIMING.fetchMs, ownGroup: true })
  const fresh = listPackDir(packDir).filter((n) => !before.has(n))
  let bytes = 0
  let capped = false
  for (const n of fresh) {
    if (!n.endsWith('.pack') && !n.startsWith('tmp_pack_')) continue
    const size = sizeOf(join(packDir, n))
    bytes += size
    if (n.startsWith('tmp_pack_') && size >= wireCap) capped = true
  }
  const ok = r.code === 0
  if (!ok) {
    for (const n of fresh) {
      if (!n.startsWith('tmp_')) continue
      try { rmSync(join(packDir, n), { force: true }) } catch { /* left in place: the fetch is refused below either way */ }
    }
  }
  try {
    deps.ledger({ event: 'fetch', device: spec.device, user: spec.user, code: spec.mirrorId, bytes,
      outcome: ok ? 'ok' : r.timedOut ? 'timeout' : 'failed', ms: Math.max(0, Math.round(performance.now() - t0)) })
  } catch {
    return refuse('rate_limited', "the fetch could not be written to the hub ledger, so today's budget cannot be kept")
  }
  if (ok) return null
  if (r.timedOut) return refuse('fetch_failed', 'the fetch from the device took longer than 60 s and was stopped')
  if (capped) return refuse('fetch_failed', `the fetched pack passed the ${Math.round(wireCap / 1_048_576)} MiB limit for one sync`)
  return refuse('fetch_failed', 'the fetch from the device failed')
}

/** §7.3 step 6, then the free-space floor for the checkout. */
async function treeAndDisk(spec: MirrorSpec, oid: string, deps: MirrorDeps): Promise<SyncResult | null> {
  const t = await checkTree(deps.git, spec.airClone, oid, spec.caps)
  if (!t.ok) {
    const where = t.path === undefined ? '' : ` (${t.path})`
    return refuse(t.code, t.code === 'remote_too_large'
      ? `the fetched tree is over this share's size caps${where}`
      : t.code === 'remote_non_regular_path' ? `the fetched tree holds a gitlink${where}` : 'the fetched tree could not be read')
  }
  let free: number
  try { free = deps.freeBytes(spec.airClone) } catch { return refuse('mirror_low_disk', 'the Air could not read its free disk space') }
  if (!(free >= (deps.minFreeBytes ?? MIN_FREE_BYTES) + t.totalBytes)) return refuse('mirror_low_disk', 'the Air has less than 5 GiB plus the tree free')
  return null
}

const DIFF_MESSAGES: Record<string, string> = {
  remote_non_regular_path: 'the commit changes a symlink, a gitlink or another non-regular path',
  remote_out_of_scope: "the commit changes a path outside the task's path scopes",
  remote_control_path: 'the commit changes a control file such as .claude, CLAUDE.md, AGENTS.md, package.json or bunfig.toml',
  remote_too_large: "the commit changes more paths than this share's cap",
  fetch_failed: 'the commit could not be compared with its base',
}

/** §7.3 step 7: the task's base must be an ancestor, and every changed path regular, in scope and not a control path. */
async function heldToTask(spec: MirrorSpec, oid: string, at: { base: string; scopes: readonly string[] }, deps: MirrorDeps): Promise<{ changed: number } | SyncResult> {
  const anc = await ancestorCheck(deps.git, spec.airClone, at.base, oid)
  if (anc === 'remote_base_not_ancestor') return refuse(anc, "the task's base is not an ancestor of the commit")
  if (anc !== 'ok') return refuse('fetch_failed', "the commit could not be checked against the task's base")
  const d = await checkDiff(deps.git, spec.airClone, at.base, oid, at.scopes, spec.caps)
  if (!d.ok) return refuse(d.code, `${DIFF_MESSAGES[d.code]}${d.path === undefined ? '' : ` (${d.path})`}`)
  return { changed: d.changed }
}

/** Steps 1–9 of §7.3. The caller holds this mirror's lock. */
export async function syncMirror(spec: MirrorSpec, o: { declaredHead: string; atComplete?: { base: string; scopes: readonly string[] } }, deps: MirrorDeps): Promise<SyncResult> {
  let refs: ReturnType<typeof mirrorRefs>
  try { refs = mirrorRefs(spec) } catch { return refuse('mirror_tampered', 'the mirror spec cannot name its refs; Ai looks at the device file') }
  if (!OID_RE.test(o.declaredHead)) return refuse('remote_head_moved', 'the declared head is not a commit id')
  const why = await tamperReason(spec, deps) // 1
  if (why !== null) return refuse('mirror_tampered', `${why}; Ai looks at it on the Air`)
  const synced = (await syncedOid(spec, deps))!
  const filters = await filterReason(spec.mirrorPath, deps) // 2
  if (filters !== null) return refuse('mirror_filters_present', filters)
  const room = diskAndBudget(spec, deps) // 3
  if (room !== null) return room
  const fetched = await fetchIncoming(spec, deps) // 4
  if (fetched !== null) return fetched
  const oid = await commitAt(deps, spec.airClone, refs.incoming)
  if (oid === null) return refuse('fetch_failed', 'the fetch left no readable commit')
  if (oid !== o.declaredHead) return refuse('remote_head_moved', "the device's HEAD is not the head the pipe declared") // 5
  const tree = await treeAndDisk(spec, oid, deps) // 6
  if (tree !== null) return tree
  let changed: number | undefined
  if (o.atComplete) { // 7
    const held = await heldToTask(spec, oid, o.atComplete, deps)
    if ('ok' in held) return held
    changed = held.changed
  }
  const co = await deps.git.run(['-C', spec.mirrorPath, ...MIRROR_GIT_FLAGS, 'checkout', '--detach', '-f', '--no-recurse-submodules', oid],
    { timeoutMs: deps.checkoutTimeoutMs ?? TIMING.checkoutMs }) // 8
  if (co.code !== 0) {
    const back = await deps.git.run(['-C', spec.mirrorPath, ...MIRROR_GIT_FLAGS, 'checkout', '--detach', '-f', '--no-recurse-submodules', synced],
      { timeoutMs: deps.checkoutTimeoutMs ?? TIMING.checkoutMs })
    const clean = back.code === 0 ? await deps.git.run(['-C', spec.mirrorPath, ...MIRROR_GIT_FLAGS, 'clean', '-ffdxq']) : back
    if (back.code === 0 && clean.code === 0) return refuse('checkout_failed', 'the checkout of the fetched commit failed; the mirror was restored')
    return refuse('mirror_tampered', 'the checkout failed and the mirror could not be restored; Ai repairs it on the Air')
  }
  // 9: compare and swap. A crash between 8 and 9 shows as mirror_tampered at the next sync (HEAD is not synced).
  const moved = await deps.git.run(['-C', spec.airClone, ...MIRROR_GIT_FLAGS, 'update-ref', refs.synced, oid, synced])
  if (moved.code !== 0) return refuse('mirror_tampered', 'the synced ref moved during the sync; Ai looks at it on the Air')
  return changed === undefined ? { ok: true, oid } : { ok: true, oid, changed }
}

/** The four levels above the mirror (collab-shared/, mirrors/, mirrors/<device>/, mirrors/<device>/<user>/), or null. */
function mirrorLevels(spec: MirrorSpec): string[] | null {
  const user = dirname(spec.mirrorPath)
  const device = dirname(user)
  const mirrors = dirname(device)
  const shared = dirname(mirrors)
  if (basename(spec.mirrorPath) !== spec.mirrorId || basename(user) !== spec.user || basename(device) !== spec.device || basename(mirrors) !== 'mirrors') return null
  return [shared, mirrors, device, user]
}

async function removeNewWorktree(spec: MirrorSpec, deps: MirrorDeps): Promise<void> {
  // Only a worktree this call added and nothing has bound to (it has no synced ref yet), so its name can be reused.
  await deps.git.run(['-C', spec.airClone, ...MIRROR_GIT_FLAGS, 'worktree', 'remove', '--force', spec.mirrorPath])
}

async function ensureLocked(spec: MirrorSpec, deps: MirrorDeps): Promise<boolean> {
  const list = await deps.git.run(['-C', spec.airClone, ...MIRROR_GIT_FLAGS, 'worktree', 'list', '--porcelain'])
  if (list.code !== 0) return false
  let real: string
  try { real = realpathSync(spec.mirrorPath) } catch { return false }
  const block = new TextDecoder().decode(list.stdout).split('\n\n').find((b) => b.split('\n')[0] === `worktree ${real}`)
  if (block === undefined) return false
  if (block.split('\n').some((l) => l === 'locked' || l.startsWith('locked '))) return true
  const lock = await deps.git.run(['-C', spec.airClone, ...MIRROR_GIT_FLAGS, 'worktree', 'lock', '--reason', 'collab-bridge mirror', spec.mirrorPath])
  return lock.code === 0
}

/**
 * The first sync, at pin-device, before any session can bind (§7.1, K17): steps 2–4 and 6 of §7.3, then
 * `repo_mismatch` unless the fetched commit shares history with the clone, then the linked worktree (added without a
 * checkout, its own config view checked for filters, since an includeIf can match only a worktree's gitdir, then checked
 * out), locked against prune, and `…/synced` created. A mirror that already exists is never deleted and re-added (that
 * would give `worktree_identity_changed`, K11): a healthy one is kept as it is, anything else is mirror_tampered.
 */
export async function createMirror(spec: MirrorSpec, deps: MirrorDeps): Promise<SyncResult> {
  let refs: ReturnType<typeof mirrorRefs>
  try { refs = mirrorRefs(spec) } catch { return refuse('mirror_tampered', 'the mirror spec cannot name its refs; Ai looks at the device file') }
  const levels = mirrorLevels(spec)
  if (levels === null) return refuse('mirror_tampered', 'the mirror path is not <collab-shared>/mirrors/<device>/<user>/<mirror_id>')
  let exists = true
  try { lstatSync(spec.mirrorPath) } catch { exists = false }
  if (exists) {
    const why = await tamperReason(spec, deps)
    if (why !== null) return refuse('mirror_tampered', `an existing mirror path is not a healthy mirror: ${why}`)
    if (!(await ensureLocked(spec, deps))) return refuse('mirror_tampered', 'the existing mirror could not be locked against prune')
    return { ok: true, oid: (await syncedOid(spec, deps))! }
  }
  // Git would make these 0755, and Collab tightens the journal's parent only when it created it (KN src/store.ts:402-407).
  try {
    for (const dir of levels) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      chmodSync(dir, 0o700)
    }
  } catch {
    return refuse('mirror_tampered', 'a directory above the mirror could not be made or tightened to 0700; Ai looks at it on the Air')
  }
  const filters = await filterReason(spec.airClone, deps) // 2
  if (filters !== null) return refuse('mirror_filters_present', filters)
  const room = diskAndBudget(spec, deps) // 3
  if (room !== null) return room
  const fetched = await fetchIncoming(spec, deps) // 4
  if (fetched !== null) return fetched
  const oid = await commitAt(deps, spec.airClone, refs.incoming)
  if (oid === null) return refuse('fetch_failed', 'the fetch left no readable commit')
  const tree = await treeAndDisk(spec, oid, deps) // 6
  if (tree !== null) return tree
  const shared = await deps.git.run(['-C', spec.airClone, ...MIRROR_GIT_FLAGS, 'merge-base', oid, 'HEAD'])
  if (shared.code !== 0) {
    await deps.git.run(['-C', spec.airClone, ...MIRROR_GIT_FLAGS, 'update-ref', '-d', refs.incoming])
    return refuse('repo_mismatch', "the device's repository shares no history with the Air clone")
  }
  const checkoutMs = deps.checkoutTimeoutMs ?? TIMING.checkoutMs
  const added = await deps.git.run(['-C', spec.airClone, ...MIRROR_GIT_FLAGS, 'worktree', 'add', '--detach', '--no-checkout', spec.mirrorPath, oid], { timeoutMs: checkoutMs })
  if (added.code !== 0) return refuse('checkout_failed', 'git could not add the mirror worktree')
  const own = await filterReason(spec.mirrorPath, deps)
  if (own !== null) {
    await removeNewWorktree(spec, deps)
    return refuse('mirror_filters_present', own)
  }
  const co = await deps.git.run(['-C', spec.mirrorPath, ...MIRROR_GIT_FLAGS, 'checkout', '--detach', '-f', '--no-recurse-submodules', oid], { timeoutMs: checkoutMs })
  if (co.code !== 0) {
    await removeNewWorktree(spec, deps)
    return refuse('checkout_failed', 'the first checkout of the mirror failed; nothing was kept')
  }
  try {
    chmodSync(spec.mirrorPath, 0o700)
  } catch {
    await removeNewWorktree(spec, deps)
    return refuse('checkout_failed', 'the new mirror could not be tightened to 0700; nothing was kept')
  }
  const lock = await deps.git.run(['-C', spec.airClone, ...MIRROR_GIT_FLAGS, 'worktree', 'lock', '--reason', 'collab-bridge mirror', spec.mirrorPath])
  if (lock.code !== 0) {
    await removeNewWorktree(spec, deps)
    return refuse('mirror_tampered', 'git could not lock the new mirror; nothing was kept')
  }
  const made = await deps.git.run(['-C', spec.airClone, ...MIRROR_GIT_FLAGS, 'update-ref', refs.synced, oid, ''])
  if (made.code !== 0) return refuse('mirror_tampered', 'the synced ref already exists for a mirror that did not; Ai looks at it on the Air')
  return { ok: true, oid }
}

/**
 * Collab's K11 rule for this mirror's repository (KN `src/repository.ts:101-104`, `src/store.ts:1394-1401`):
 * `ws_` + sha256(`local-git:` + sha256(realpath of the git common dir))[:24]. The shared journal has one workspace per
 * key (§6.3), so this is the workspace the first remote session_start binds to (P55). Null when git fails.
 */
export async function mirrorWorkspaceId(spec: MirrorSpec, deps: Pick<MirrorDeps, 'git'>): Promise<string | null> {
  const common = await commonDirOf(deps, spec.mirrorPath)
  return common === null ? null : `ws_${sha256(`local-git:${sha256(common)}`).slice(0, 24)}`
}

/**
 * `…/tasks/<task_id>`, written once for a new completion and only when `head` is the mirror's HEAD (§7.2). The same
 * value again is a no-op; a different value is mirror_tampered and the ref stays. A task id git cannot hold as a ref
 * name (`taskRefOk`) writes nothing and answers 'ok': the mirror is fine, and the reviewer reads the task's result
 * checkpoint head instead (§7.7).
 */
export async function writeTaskRef(spec: MirrorSpec, taskId: string, head: string, deps: MirrorDeps): Promise<'ok' | 'mirror_tampered'> {
  if (!OID_RE.test(head)) return 'mirror_tampered'
  if ((await mirrorHead(spec, deps)) !== head) return 'mirror_tampered'
  if (!taskRefOk(taskId)) return 'ok'
  const ref = mirrorRefs(spec).task(taskId)
  const existing = await commitAt(deps, spec.airClone, ref)
  if (existing !== null) return existing === head ? 'ok' : 'mirror_tampered'
  const r = await deps.git.run(['-C', spec.airClone, ...MIRROR_GIT_FLAGS, 'update-ref', ref, head, ''])
  if (r.code === 0) return 'ok'
  return (await commitAt(deps, spec.airClone, ref)) === head ? 'ok' : 'mirror_tampered'
}

/** P31: the `bytes` of this mirror's `fetch` lines in the hub ledger since local midnight. */
export function fetchedTodayFromLedger(ledgerPath: string, mirrorId: string, now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  let total = 0
  for (const e of readLedger(ledgerPath)) {
    if (e.event !== 'fetch' || e.code !== mirrorId || typeof e.bytes !== 'number') continue
    const at = Date.parse(e.ts)
    if (Number.isFinite(at) && at >= midnight) total += e.bytes
  }
  return total
}

/** The hub's deps: free space on the Air's Data volume (air-env F17), today's total from its ledger, its ssh config. */
export function liveMirrorDeps(o: { paths: AirPaths; git: GitRunner; ssh: string; alias: string }): MirrorDeps {
  return {
    git: o.git,
    sshBin: o.ssh,
    sshConfig: o.paths.sshConfig,
    alias: o.alias,
    freeBytes: (path) => {
      const s = statfsSync(path)
      return Number(s.bavail) * Number(s.bsize)
    },
    fetchedToday: (mirrorId) => fetchedTodayFromLedger(o.paths.ledger, mirrorId, new Date()),
    ledger: (f) => { appendLedger(o.paths.ledger, AIR_LEDGER_KEYS, f) },
  }
}

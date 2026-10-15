// The gate's third form, `git-upload-pack '<path>'` (spec §7.4; K48–K52; R15; T12–T14; P44). The Air's mirror fetch is
// the only client. Every check runs before anything is executed, each refusal is a definite pkt-line ERR, and the only
// program ever run is the git INSTALLED recorded, after its sha256 is checked, in an env built from seven keys. Leaving
// GIT_PROTOCOL out of that env is the control that matters: it forces protocol v0, where hideRefs=refs/ advertises only
// HEAD and upload-pack refuses every other want (`not our ref`); a v2 want can name any object (K49).
import { lstatSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { longestFolderMatch, safeRealpath, tccProtected, type Allowlist } from '../allowlist.ts'
import { gitAcceptable, sha256File } from './git-resolve.ts'
import type { InstalledInfo, Share } from './installed.ts'

/** The six `-c` pairs of §7.4, in order: refs hidden, no unadvertised wants of any kind, no filters. */
export const UPLOAD_PACK_CONFIG: readonly string[] = [
  '-c', 'uploadpack.hideRefs=refs/',
  '-c', 'uploadpack.allowTipSHA1InWant=false',
  '-c', 'uploadpack.allowReachableSHA1InWant=false',
  '-c', 'uploadpack.allowAnySHA1InWant=false',
  '-c', 'uploadpack.allowFilter=false',
  '-c', 'uploadpack.allowRefInWant=false',
]

/** `--strict` needs the absolute gitdir, so a work-tree path never serves (K51); `--timeout` ends an idle client. */
export function uploadPackArgv(gitdir: string): string[] {
  return [...UPLOAD_PACK_CONFIG, 'upload-pack', '--strict', '--timeout=120', gitdir]
}

/** Exactly the seven keys of §7.4. Built, never inherited (P14), and never GIT_PROTOCOL. */
export function gitEnv(home: string): Record<string, string> {
  return {
    PATH: '/usr/bin:/bin',
    HOME: home,
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0',
  }
}

export interface FetchGateCtx { home: string; installed: InstalledInfo; shares: Share[]; allowlist: Allowlist | null; uid: number; realpath?: (p: string) => string | null }
export type FetchRefusal = 'path_form' | 'not_realpath' | 'tcc_protected' | 'not_shared' | 'not_edit_folder' | 'git_link' | 'outside_edit_folder' | 'foreign_owner' | 'alternates'
export type FetchCheck = { ok: true; gitdir: string; worktree: string } | { ok: false; code: FetchRefusal }

const refuse = (code: FetchRefusal): FetchCheck => ({ ok: false, code })

/** `//`, `/./`, `/../`, a trailing `/`, or a final `/.` or `/..`: one spelling per directory, or nothing. */
function badForm(p: string): boolean {
  return !p.startsWith('/') || p.includes('//') || p.includes('/./') || p.includes('/../')
    || p.endsWith('/') || p.endsWith('/.') || p.endsWith('/..')
}

/** A small file's text, or null when it is not a regular file (a symlink included) or cannot be read. */
function smallRegularFile(p: string, max = 4096): string | null {
  try {
    const st = lstatSync(p)
    if (!st.isFile() || st.size > max) return null
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

/** Where `<worktree>/.git` leads: the dir itself, or the target of a `gitdir: <path>` file; null for a symlink or anything else. */
function dotGitTarget(worktree: string, realpath: (p: string) => string | null): string | null {
  const dotGit = join(worktree, '.git')
  let st
  try { st = lstatSync(dotGit) } catch { return null }
  if (st.isSymbolicLink()) return null
  if (st.isDirectory()) return realpath(dotGit)
  if (!st.isFile()) return null
  const m = /^gitdir: (.+?)\r?\n?$/.exec(smallRegularFile(dotGit) ?? '')
  if (!m) return null
  return realpath(isAbsolute(m[1]!) ? m[1]! : resolve(worktree, m[1]!))
}

/**
 * Resolves `text` as git resolves a path (strbuf_realpath): one component at a time from `base`, each made real before the
 * next, and a `..` taken from the real path built so far. `base` must be real already. Neither path.resolve nor Bun's
 * realpathSync.native does this: both fold ` ..` with the `..` after it before looking at the disk, so a symlink named ` ..`
 * would be skipped, where git (and the file system) follow it first. A component that does not exist gives null, as in git.
 */
function realpathLikeGit(base: string, text: string, realpath: (p: string) => string | null): string | null {
  let cur = text.startsWith('/') ? '/' : base
  for (const part of text.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') { cur = dirname(cur); continue }
    const next = realpath(cur === '/' ? `/${part}` : `${cur}/${part}`)
    if (next === null) return null
    cur = next
  }
  return cur
}

/**
 * The repository's common dir: `<gitdir>/commondir` as git reads it, else the gitdir itself; null when unreadable. Git drops
 * only the trailing CR and LF of that file (get_common_dir_noenv) and keeps every other space or tab as part of a name, so
 * this does too, where it used to trim them and check a different directory from the one upload-pack opens. A NUL ends git's
 * string early, so text holding one is refused (Task 63 gate-1-5).
 */
function commonDirOf(gitdir: string, realpath: (p: string) => string | null): string | null {
  const file = join(gitdir, 'commondir')
  try { lstatSync(file) } catch { return gitdir }
  const text = smallRegularFile(file)
  if (text === null) return null
  const rel = text.replace(/[\r\n]+$/, '')
  if (rel === '' || rel.includes('\0')) return null
  return realpathLikeGit(gitdir, rel, realpath)
}

const isEditIn = (p: string, al: Allowlist, home: string, realpath: (p: string) => string | null) =>
  longestFolderMatch(p, al, home, realpath)?.access === 'edit'

function ownedDir(p: string, uid: number): boolean {
  try {
    const st = statSync(p)
    return st.isDirectory() && st.uid === uid
  } catch {
    return false
  }
}

/** Whether anything, even a dangling symlink, sits at this path. */
function present(p: string): boolean {
  try { lstatSync(p); return true } catch { return false }
}

/**
 * §7.4's checks, in order, before anything runs. `path` is what the gate's grammar captured between the quotes.
 * Same-uid symlink races between these checks and git's own open are an accepted residual risk while the Air is the only
 * client (§7.4).
 */
export function checkUploadPackPath(path: string, ctx: FetchGateCtx): FetchCheck {
  const realpath = ctx.realpath ?? safeRealpath
  if (badForm(path)) return refuse('path_form')
  if (realpath(path) !== path) return refuse('not_realpath')
  if (tccProtected(path, ctx.home, realpath)) return refuse('tcc_protected')
  const share = ctx.shares.find((s) => s.gitdir === path)
  if (!share) return refuse('not_shared')
  const worktree = share.realpath
  // The work tree is checked too: a gitdir file can put the repository's files in a TCC folder while its gitdir is not.
  if (tccProtected(worktree, ctx.home, realpath)) return refuse('tcc_protected')
  if (!ctx.allowlist || realpath(worktree) !== worktree || !isEditIn(worktree, ctx.allowlist, ctx.home, realpath)) return refuse('not_edit_folder')
  if (dotGitTarget(worktree, realpath) !== path) return refuse('git_link')
  const common = commonDirOf(path, realpath)
  if (!common) return refuse('outside_edit_folder')
  for (const dir of new Set([path, common])) {
    if (!isEditIn(dir, ctx.allowlist, ctx.home, realpath)) return refuse('outside_edit_folder')
  }
  for (const dir of new Set([path, common])) {
    if (!ownedDir(dir, ctx.uid)) return refuse('foreign_owner')
  }
  if (present(join(common, 'objects', 'info', 'alternates'))) return refuse('alternates')
  return { ok: true, gitdir: path, worktree }
}

/** One pkt-line `ERR <message>`, which git shows as `fatal: remote error: <message>`. */
export function pktLineErr(message: string): Uint8Array {
  return Buffer.from(`${(4 + 4 + message.length + 1).toString(16).padStart(4, '0')}ERR ${message}\n`, 'utf8')
}

/** Why a fetch was stopped before git finished: the client's end went away, or the Air's own fetch deadline passed (§7.3 step 4). */
export type FetchStop = 'client_gone' | 'deadline'
/** The gate's exit for a fetch it stopped: nobody is reading it (the Air has gone or has given up), so it only names the case. EX_TEMPFAIL. */
export const FETCH_STOPPED_EXIT = 75

export interface FetchGateIo {
  stdin: ReadableStream<Uint8Array>
  stdout: { write(b: Uint8Array): void | Promise<void> }      // a promise is awaited before the next chunk
  stderr: { write(s: string): void }
  /** Asked after every chunk: a reason once the client can no longer be served, else null. On a reason git is killed, not drained. */
  stopped?: () => FetchStop | null
  /** How long git gets to exit after SIGTERM before SIGKILL (default 2 s). */
  killGraceMs?: number
}

/**
 * The upload-pack form, end to end. A refusal writes one pkt-line ERR and one stderr line and exits 64; otherwise the
 * recorded git runs with stdin and stdout piped byte for byte, and its exit code is the gate's. `bytes` counts what git
 * wrote to stdout (0 for a refusal), for the gate's content-free ledger line (Task 24).
 */
export async function runFetchGate(path: string, ctx: FetchGateCtx, io: FetchGateIo): Promise<{ exit: number; outcome: string; bytes: number }> {
  const refused = async (code: string) => {
    await io.stdout.write(pktLineErr(code))
    io.stderr.write(`collab-bridge gate: upload-pack refused: ${code}\n`)
    return { exit: 64, outcome: code, bytes: 0 }
  }
  const check = checkUploadPackPath(path, ctx)
  if (!check.ok) return refused(check.code)
  let sha: string | null
  try { sha = sha256File(ctx.installed.git.path) } catch { sha = null }
  // A Software Update or `brew upgrade` lands here by design: the install check must be re-run (§7.4).
  if (sha !== ctx.installed.git.sha256) return refused('git_changed')
  if (!gitAcceptable(ctx.installed.git)) return refused('git_unsafe')

  const proc = Bun.spawn([ctx.installed.git.path, ...uploadPackArgv(check.gitdir)], {
    cwd: '/', env: gitEnv(ctx.home), stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  })
  let done = false
  const exited = proc.exited.then((code) => { done = true; return code })
  const reader = io.stdin.getReader()
  const pumpIn = (async () => {
    try {
      for (;;) {
        const r = await Promise.race([reader.read(), exited.then(() => null)])
        if (r === null || r.done) break
        proc.stdin.write(r.value)
        await proc.stdin.flush()
      }
    } catch {
      // git went away while the client was still talking: its exit code says what happened.
    } finally {
      try { proc.stdin.end() } catch { /* already closed */ }
      if (done) reader.cancel().catch(() => {})
    }
  })()
  const pumpErr = (async () => {
    const dec = new TextDecoder()
    for await (const chunk of proc.stderr) io.stderr.write(dec.decode(chunk, { stream: true }))
  })()
  let bytes = 0
  let stop: FetchStop | null = null
  for await (const chunk of proc.stdout) {
    bytes += chunk.byteLength
    await io.stdout.write(chunk)
    // A pack for a client that is gone, or past the Air's deadline, is work for nobody: stop git instead of draining it.
    stop = io.stopped?.() ?? null
    if (stop) break
  }
  if (stop) {
    const grace = io.killGraceMs ?? 2_000
    try { proc.kill('SIGTERM') } catch { /* already gone */ }
    const hardKill = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* already gone */ } }, grace)
    await exited
    clearTimeout(hardKill)
    // git's children may still hold its pipes for a moment (they die on SIGPIPE), so the pumps get a bounded wait only.
    await Promise.race([Promise.all([pumpIn, pumpErr]), new Promise<void>((r) => setTimeout(r, grace))])
    return { exit: FETCH_STOPPED_EXIT, outcome: stop, bytes }
  }
  const code = await exited
  await Promise.all([pumpIn, pumpErr])
  return { exit: code, outcome: code === 0 ? 'served' : 'git_failed', bytes }
}

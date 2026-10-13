// The pipe's declared git state (spec §7.5): {head, branch, dirty} of its own folder, sent with each claim, complete and
// takeover. These are self-declared labels: the hub checks the head by fetching it, and the Air never asks Nuance for
// its working state. The git is the one INSTALLED records, never /usr/bin/git, the xcrun shim (P44, K43), run with the
// fetch gate's scrubbed env (P44, §7.4) plus GIT_OPTIONAL_LOCKS=0, so `git status` never rewrites the index under the
// agent (K9); core.fsmonitor=false keeps a repo-configured fsmonitor from running (K10).
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import type { Declared } from '../link/messages.ts'
import { TIMING } from '../timing.ts'

const SHIM = '/usr/bin/git'
const HEAD_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/ // SHA-1 or SHA-256 repositories
const MAX_OUTPUT = 64 * 1024 * 1024

function failed(what: string, r: SpawnSyncReturns<string>): { error: string } {
  const how = r.error ? ((r.error as NodeJS.ErrnoException).code ?? 'spawn error') : r.signal ? `signal ${r.signal}` : `exit ${r.status}`
  return { error: `git ${what} failed (${how})` } // never git's stderr: it can name paths and config the ledger must not hold
}

export function declaredState(folder: string, git: string, home: string): Declared | { error: string } {
  if (git === SHIM) return { error: 'refusing /usr/bin/git, the xcrun shim; run the git INSTALLED records' }
  const env = {
    PATH: '/usr/bin:/bin', HOME: home, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
  }
  const run = (args: string[]) => spawnSync(git, ['-C', folder, '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8', env, cwd: '/', timeout: TIMING.gitCallMs, maxBuffer: MAX_OUTPUT, stdio: ['ignore', 'pipe', 'ignore'],
  })

  const rev = run(['rev-parse', 'HEAD'])
  if (rev.error || rev.status !== 0) return failed('rev-parse HEAD', rev)
  const head = rev.stdout.trim()
  if (!HEAD_RE.test(head)) return { error: 'git rev-parse HEAD printed no commit id' }

  const sym = run(['symbolic-ref', '-q', '--short', 'HEAD'])
  let branch: string | null
  if (!sym.error && sym.status === 0 && sym.stdout.trim() !== '') branch = sym.stdout.trim()
  else if (!sym.error && sym.status === 1) branch = null // -q: exit 1 and no output means a detached HEAD
  else return failed('symbolic-ref HEAD', sym)

  const st = run(['status', '--porcelain=v1', '--untracked-files=all'])
  if (st.error || st.status !== 0) return failed('status', st)
  return { head, branch, dirty: st.stdout.length > 0 }
}

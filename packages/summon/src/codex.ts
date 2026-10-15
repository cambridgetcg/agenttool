import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { isExecutable, type Invocation } from './harness.ts'
import { TOKEN_RE, type Access } from './request.ts'

/** Configuration isolation is version-specific evidence; see ../CODEX.md. */
export const VERIFIED_CODEX_VERSION = 'codex-cli 0.162.1'

/** Same account, no inherited provider credentials, endpoint overrides or harness configuration. */
export function codexEnvironment(home: string, user: string): Record<string, string> {
  return {
    HOME: home, USER: user, LOGNAME: user, LANG: 'en_US.UTF-8', TMPDIR: '/tmp',
    PATH: `${home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null',
    GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false', GIT_TERMINAL_PROMPT: '0',
  }
}

/** Test override is effective only with an explicit fixture home, as for Claude. */
export function findCodex(home: string): string | null {
  const override = process.env.SUMMON_HOME_OVERRIDE ? process.env.SUMMON_CODEX_BIN : undefined
  if (override !== undefined) return isExecutable(override) ? override : null
  for (const path of [join(home, '.local/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex']) {
    if (isExecutable(path)) return path
  }
  return null
}

/** No model call or authentication inspection. Unknown versions/flags stay unavailable. */
export function codexReady(bin: string | null, home: string, user: string): boolean {
  if (!bin) return false
  const options = { env: codexEnvironment(home, user), encoding: 'utf8' as const, timeout: 5000, maxBuffer: 64 * 1024 }
  const version = spawnSync(bin, ['--version'], options)
  if (version.status !== 0 || version.stdout?.trim() !== VERIFIED_CODEX_VERSION) return false
  const help = spawnSync(bin, ['exec', '--help'], options)
  return help.status === 0 && ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--json', '--sandbox', '--skip-git-repo-check']
    .every((flag) => new RegExp(`${flag}(?:[\\s,=]|$)`).test(help.stdout ?? ''))
}

/** Quiet native review profile, with native authentication retained; not a folder-confined read boundary. */
export function codexInvocation(job: { model: string; effort?: string; access: Access; cwdReal: string; prompt: string },
  home: string, bin: string, user: string): Invocation {
  if (job.access !== 'review') throw new Error('codex supports review only')
  if (!TOKEN_RE.test(job.model) || (job.effort !== undefined && !TOKEN_RE.test(job.effort))) throw new Error('invalid model or effort')
  const config = [
    'model_provider="openai"', 'web_search="disabled"', 'history.persistence="none"',
    'features.plugins=false', 'features.hooks=false', 'features.apps=false',
    'features.memories=false', 'features.multi_agent=false', 'features.shell_snapshot=false',
    'features.daemon_auto_start=false', 'features.unbounded_connection_retries=false',
    'features.browser_use=false', 'features.browser_use_external=false', 'features.computer_use=false',
    'features.image_generation=false', 'features.in_app_browser=false',
    'shell_environment_policy.experimental_use_profile=false',
    ...(job.effort === undefined ? [] : [`model_reasoning_effort=${JSON.stringify(job.effort)}`]),
  ]
  return {
    bin,
    args: ['-a', 'never', 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--json',
      '--color', 'never', '--sandbox', 'read-only', '--skip-git-repo-check', '--model', job.model, '-C', job.cwdReal,
      ...config.flatMap((value) => ['-c', value]), '-'],
    env: codexEnvironment(home, user), stdin: job.prompt,
  }
}

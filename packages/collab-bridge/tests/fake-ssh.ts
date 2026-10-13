// A fake `ssh` for the hermetic suite (spec §12.1 "The ssh link", "Git transfer"). It does on this Mac what sshd does
// with the Nuance key's forced command: it drops ssh's own options, takes the host, and execs the target (the gate) in a
// bare environment against a temp "Nuance" home, with the remote command in SSH_ORIGINAL_COMMAND. Unlike Summon's helper
// it never buffers: the target inherits the fake's stdin and stdout, so the relay's frames flow both ways at once.
// It is named `ssh` so git treats it as OpenSSH (K48) and passes `-o SendEnv=GIT_PROTOCOL` and the sq-quoted
// `git-upload-pack '<path>'` exactly as it would to the real one.
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { PKG, temp } from './helpers.ts'

export interface FakeSsh {
  bin: string                                   // <dir>/ssh, named ssh so git picks the OpenSSH variant
  dir: string
  calls(): string[][]                           // argv of every call, oldest first
  setNoise(bytes: string | Uint8Array | null): void   // printed on stdout before the exec
  setDelayMs(ms: number): void                  // sleep before the exec (a 6–8 s connect)
  setFail255(stderr: string | null): void       // print this on stderr and exit 255 instead of running the target
  setPassGitProtocol(on: boolean): void         // forward GIT_PROTOCOL into the target's env (simulates an sshd that accepts it)
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
/** The fake sets these itself, as sshd would; a test that passed them would be testing nothing. */
const OWNED_KEYS = new Set(['SSH_ORIGINAL_COMMAND', 'GIT_PROTOCOL'])

/** One bash word, single-quoted. Bash cannot carry a NUL, so a value holding one is a test bug. */
function sq(s: string): string {
  if (s.includes('\0')) throw new Error('makeFakeSsh: a value contains a NUL byte')
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function script(dir: string, home: string, target: string[], env: Record<string, string>): string {
  const assigns = [`PATH=/usr/bin:/bin`, `HOME=${home}`, `COLLAB_BRIDGE_HOME_OVERRIDE=${home}`,
    ...Object.entries(env).map(([k, v]) => `${k}=${v}`)].map(sq).join(' ')
  return `#!/bin/bash
# A fake ssh for the collab-bridge tests: what sshd does with a forced command, run on this Mac against a temp
# "Nuance" home. It never opens a connection. Each call is logged as one NUL-separated record (the argument count, then
# every argument) written by one printf.
D=${sq(dir)}
printf '%s\\0' "$#" "$@" >> "$D/calls.log"
# ssh's own options come first; the first word after them is the host, and the rest is the remote command.
while [ $# -gt 0 ]; do
  case "$1" in
    -F|-o|-p|-i|-l)
      if [ $# -lt 2 ]; then echo "fake ssh: option $1 needs a value" >&2; exit 255; fi
      shift 2 ;;
    -F?*|-o?*|-p?*|-i?*|-l?*) shift ;;
    -T|-4|-6|-n|-x|-a|-q|-v) shift ;;
    --) shift; break ;;
    -*) echo "fake ssh: unknown option $1" >&2; exit 255 ;;
    *) break ;;
  esac
done
if [ $# -eq 0 ]; then echo "fake ssh: no host" >&2; exit 255; fi
shift # the host: this fake has one "Nuance", whatever the alias
if [ -s "$D/delay" ]; then /bin/sleep "$(/bin/cat "$D/delay")"; fi
if [ -f "$D/noise" ]; then /bin/cat "$D/noise"; fi
if [ -f "$D/fail255" ]; then /bin/cat "$D/fail255" >&2; exit 255; fi
cd ${sq(home)} || exit 255
extra=()
if [ -f "$D/pass-git-protocol" ] && [ -n "\${GIT_PROTOCOL+set}" ]; then extra=("GIT_PROTOCOL=$GIT_PROTOCOL"); fi
# sshd sets SSH_ORIGINAL_COMMAND only when the client sent a command.
if [ $# -gt 0 ]; then extra=("\${extra[@]}" "SSH_ORIGINAL_COMMAND=$*"); fi
exec /usr/bin/env -i ${assigns} "\${extra[@]}" ${target.map(sq).join(' ')}
`
}

/**
 * A fake ssh in a fresh temp dir (removed by cleanupTmps). `target` is what sshd's forced command would run (usually
 * gateFromSource() or gateCompiled()); `env` adds to the bare env the target gets (PATH, HOME and the override), for
 * the knobs a spawned gate reads under the override. Later entries win, so `env` may replace PATH.
 */
export function makeFakeSsh(o: { nuanceHome: string; target: string[]; env?: Record<string, string> }): FakeSsh {
  if (!isAbsolute(o.nuanceHome)) throw new Error(`makeFakeSsh: nuanceHome must be absolute: ${o.nuanceHome}`)
  if (o.target.length === 0) throw new Error('makeFakeSsh: target is empty')
  const env = o.env ?? {}
  for (const k of Object.keys(env)) {
    if (!ENV_KEY_RE.test(k)) throw new Error(`makeFakeSsh: not an environment name: ${k}`)
    if (OWNED_KEYS.has(k)) throw new Error(`makeFakeSsh: ${k} is set by the fake itself`)
  }
  const dir = temp('cb-fake-ssh-')
  const bin = join(dir, 'ssh')
  writeFileSync(bin, script(dir, o.nuanceHome, o.target, env), { mode: 0o755 })
  chmodSync(bin, 0o755)
  const flag = (name: string, content: string | Uint8Array | null) => {
    const p = join(dir, name)
    if (content === null) rmSync(p, { force: true })
    else writeFileSync(p, content)
  }
  return {
    bin,
    dir,
    calls() {
      let raw: string
      try { raw = readFileSync(join(dir, 'calls.log'), 'utf8') } catch { return [] }
      const fields = raw.split('\0')
      const out: string[][] = []
      // The last piece after the final NUL is empty; every record is a count, then that many arguments.
      for (let i = 0; i < fields.length - 1;) {
        const n = Number(fields[i])
        if (!Number.isInteger(n) || n < 0 || i + 1 + n > fields.length - 1) throw new Error(`fake ssh: unreadable call log at field ${i}`)
        out.push(fields.slice(i + 1, i + 1 + n))
        i += 1 + n
      }
      return out
    },
    setNoise: (bytes) => flag('noise', bytes),
    setDelayMs(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`setDelayMs: not a delay: ${ms}`)
      flag('delay', ms === 0 ? null : (ms / 1000).toFixed(3))
    },
    setFail255: (stderr) => flag('fail255', stderr),
    setPassGitProtocol: (on) => flag('pass-git-protocol', on ? '' : null),
  }
}

/** The gate from source, as the Nuance key's forced command would run the compiled one. */
export function gateFromSource(): string[] {
  return [process.execPath, '--no-env-file', '--config=/dev/null', `${PKG}/src/nuance/main.ts`, 'gate']
}

/** The compiled Nuance binary's gate (Task 58). */
export function gateCompiled(binary: string): string[] {
  return [binary, 'gate']
}

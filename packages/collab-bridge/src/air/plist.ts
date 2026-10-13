// The hub's LaunchAgent (spec §10.4; the header's LaunchAgent line). S1 (Task 10) bootstraps exactly this plist with a
// probe as the program, and `collab-bridge hub on` (Task 53) writes it with the pinned hub bundle, so the Local Network
// grant S1 records is the one the hub runs under.
import { airPaths } from '../paths.ts'

const LABEL = 'dev.agenttool.collab-bridge'
const LAUNCHER_BUNDLE_ID = 'dev.agenttool.collab-bridge.hub'
const SHA_RE = /^[0-9a-f]{64}$/

function xml(s: string): string {
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new Error('renderPlist: a value holds a control character')
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderPlist(o: { home: string; sha: string; bun: string; program?: string[] }): string {
  if (!SHA_RE.test(o.sha)) throw new Error('renderPlist: sha must be 64 lowercase hex')
  if (!o.bun.startsWith('/')) throw new Error('renderPlist: bun must be an absolute path')
  const p = airPaths(o.home)
  const program = o.program ?? [o.bun, '--no-env-file', '--config=/dev/null', p.hubJs(o.sha), 'run']
  if (program.length === 0 || !program[0]!.startsWith('/')) throw new Error('renderPlist: the program must start with an absolute path')
  // The launcher is the job's program, and it spawns the hub; it never execs, so the grant stays the app's (K45).
  const args = [p.launcherExe, ...program].map((a) => `\t\t<string>${xml(a)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
${args}
\t</array>
\t<key>AssociatedBundleIdentifiers</key>
\t<array>
\t\t<string>${LAUNCHER_BUNDLE_ID}</string>
\t</array>
\t<key>WorkingDirectory</key>
\t<string>/</string>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>HOME</key>
\t\t<string>${xml(o.home)}</string>
\t\t<key>PATH</key>
\t\t<string>/opt/homebrew/bin:/usr/bin:/bin</string>
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<dict>
\t\t<key>SuccessfulExit</key>
\t\t<false/>
\t</dict>
\t<key>ThrottleInterval</key>
\t<integer>10</integer>
\t<key>StandardOutPath</key>
\t<string>/dev/null</string>
\t<key>StandardErrorPath</key>
\t<string>${xml(p.hubLog)}</string>
</dict>
</plist>
`
}

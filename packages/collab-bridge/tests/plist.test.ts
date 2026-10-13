import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderPlist } from '../src/air/plist.ts'
import { systemBin } from '../src/sysbin.ts'
import { cleanupTmps, temp } from './helpers.ts'

afterEach(cleanupTmps)

const SHA = 'a'.repeat(64)
const BUN = '/Users/yuai/.bun/bin/bun'

/** The plist as launchd reads it: `plutil -lint` must pass, and `plutil -convert json` gives its values. */
function readBack(text: string): { lint: string; value: Record<string, unknown> } {
  const f = join(temp('cb-plist-'), 'dev.agenttool.collab-bridge.plist')
  writeFileSync(f, text)
  const env = { PATH: '/usr/bin:/bin' }
  const lint = Bun.spawnSync([systemBin('plutil'), '-lint', f], { cwd: '/', env })
  const json = Bun.spawnSync([systemBin('plutil'), '-convert', 'json', '-o', '-', f], { cwd: '/', env })
  if (lint.exitCode !== 0 || json.exitCode !== 0) throw new Error(`plutil refused the plist: ${lint.stdout}${lint.stderr}${json.stderr}`)
  return { lint: lint.stdout.toString().replace(f, '<plist>').trim(), value: JSON.parse(json.stdout.toString()) }
}

describe('renderPlist', () => {
  test("renderPlist is the header's LaunchAgent exactly, and passes plutil -lint", () => {
    const { lint, value } = readBack(renderPlist({ home: '/Users/yuai', sha: SHA, bun: BUN }))
    expect(lint).toBe('<plist>: OK')
    expect(value).toEqual({
      Label: 'dev.agenttool.collab-bridge',
      ProgramArguments: [
        '/Users/yuai/Applications/CollabBridgeHub.app/Contents/MacOS/collab-bridge-hub',
        '/Users/yuai/.bun/bin/bun', '--no-env-file', '--config=/dev/null',
        `/Users/yuai/.local/share/collab-bridge/air/${SHA}/hub.js`, 'run',
      ],
      AssociatedBundleIdentifiers: ['dev.agenttool.collab-bridge.hub'],
      WorkingDirectory: '/',
      EnvironmentVariables: { HOME: '/Users/yuai', PATH: '/opt/homebrew/bin:/usr/bin:/bin' },
      RunAtLoad: true,
      KeepAlive: { SuccessfulExit: false },
      ThrottleInterval: 10,
      StandardOutPath: '/dev/null',
      StandardErrorPath: '/Users/yuai/.local/state/collab-bridge/hub.log',
    })
  })

  test('a custom program changes only ProgramArguments', () => {
    const probe = [BUN, '--no-env-file', '--config=/dev/null', '/Users/yuai/.cache/agenttool/collab-bridge-spikes/s1/probe.js']
    const hub = readBack(renderPlist({ home: '/Users/yuai', sha: '0'.repeat(64), bun: BUN })).value
    const s1 = readBack(renderPlist({ home: '/Users/yuai', sha: '0'.repeat(64), bun: BUN, program: probe })).value
    expect(s1.ProgramArguments).toEqual(['/Users/yuai/Applications/CollabBridgeHub.app/Contents/MacOS/collab-bridge-hub', ...probe])
    const { ProgramArguments: a, ...restHub } = hub
    const { ProgramArguments: b, ...restS1 } = s1
    expect(a).not.toEqual(b)
    expect(restS1).toEqual(restHub)
  })

  test('values are XML-escaped and read back unchanged', () => {
    const odd = '/tmp/a&b <c> "d"'
    const { value } = readBack(renderPlist({ home: '/Users/yuai', sha: SHA, bun: BUN, program: [BUN, odd] }))
    expect((value.ProgramArguments as string[])[2]).toBe(odd)
  })

  test('refuses a malformed sha, a relative bun or program, and a control character', () => {
    expect(() => renderPlist({ home: '/Users/yuai', sha: 'A'.repeat(64), bun: BUN })).toThrow('renderPlist: sha must be 64 lowercase hex')
    expect(() => renderPlist({ home: '/Users/yuai', sha: SHA, bun: 'bun' })).toThrow('renderPlist: bun must be an absolute path')
    expect(() => renderPlist({ home: '/Users/yuai', sha: SHA, bun: BUN, program: ['bun', 'x.js'] })).toThrow('renderPlist: the program must start with an absolute path')
    expect(() => renderPlist({ home: '/Users/yuai', sha: SHA, bun: BUN, program: [BUN, 'a\nb'] })).toThrow('renderPlist: a value holds a control character')
  })
})

// The world's own guards (Task 62 review). The hub's TCP probe (P56) goes to the paired config's HostName, and the world
// must keep it on this Mac: if pin-device's config text ever changes, the world refuses to start rather than let the probe
// reach the real nuance.local:22 while every other test still passes (spec §12.1: no network).
import { describe, expect, test } from 'bun:test'
import { collabSshConfig } from '../scripts/pin-device.ts'
import { loopbackHostName } from './world.ts'

const real = () => collabSshConfig({ home: '/tmp/cb-world-air', device: 'nuance', user: 'macair' })

describe('loopbackHostName (the world keeps the hub probe on this Mac)', () => {
  test('rewrites pin-device\'s own HostName line, and nothing else', () => {
    const before = real()
    const after = loopbackHostName(before)
    const was = before.split('\n')
    const now = after.split('\n')
    expect(now.length).toBe(was.length)
    expect(now.filter((l, i) => l !== was[i])).toEqual(['  HostName 127.0.0.1'])
    expect(was.filter((l, i) => l !== now[i])).toEqual(['  HostName nuance.local'])
    expect(after).not.toContain('nuance.local')
  })

  test('keeps the line\'s own indentation', () => {
    expect(loopbackHostName('Host collab-nuance\n\tHostName nuance.local\n  User macair\n')).toBe('Host collab-nuance\n\tHostName 127.0.0.1\n  User macair\n')
    expect(loopbackHostName('Host collab-nuance\nHostName nuance.local\n')).toBe('Host collab-nuance\nHostName 127.0.0.1\n')
  })

  test('a config with a different HostName line makes the world refuse to start', () => {
    for (const other of ['  HostName nuance.example', '  HostName Nuance.local', '  HostName nuance.local.evil', '  HostName 192.168.50.7', '  HostName nuance.local # lan']) {
      const text = real().replace('  HostName nuance.local', other)
      expect(() => loopbackHostName(text)).toThrow(/^world: .*HostName nuance\.local/)
    }
  })

  test('refuses a config with no HostName line, a different spelling of the key, or two of them', () => {
    expect(() => loopbackHostName(real().replace('  HostName nuance.local\n', ''))).toThrow(/^world: .*exactly one/)
    expect(() => loopbackHostName(real().replace('  HostName nuance.local', '  Hostname nuance.local'))).toThrow(/^world: .*exactly one/)
    expect(() => loopbackHostName(real().replace('  HostName nuance.local', '  HostName nuance.local\n  HostName nuance.local'))).toThrow(/^world: .*exactly one/)
    expect(() => loopbackHostName('')).toThrow(/^world: .*exactly one/)
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { mkdirPrivate } from '../src/private-dir.ts'
import { cleanupTmps, modeOf, temp } from './helpers.ts'

afterEach(cleanupTmps)

describe('mkdirPrivate', () => {
  test('creates every missing level 0700 and leaves an existing parent as it is', () => {
    const base = temp('cb-dir-')
    chmodSync(base, 0o755)
    mkdirSync(join(base, 'have'), { mode: 0o755 })
    chmodSync(join(base, 'have'), 0o755)
    mkdirPrivate(join(base, 'have', 'a', 'b', 'c'))
    expect([modeOf(base), modeOf(join(base, 'have'))]).toEqual([0o755, 0o755])
    for (const d of ['a', 'a/b', 'a/b/c']) expect([d, modeOf(join(base, 'have', d))]).toEqual([d, 0o700])
    chmodSync(join(base, 'have', 'a'), 0o750) // a second call creates nothing, so it changes nothing
    mkdirPrivate(join(base, 'have', 'a', 'b', 'c'))
    expect(modeOf(join(base, 'have', 'a'))).toBe(0o750)
  })

  test('refuses a relative path', () => {
    expect(() => mkdirPrivate('state/collab-bridge')).toThrow('mkdirPrivate: the directory must be an absolute path')
  })
})

// untilStubStarted (tests/helpers.ts): the four tests that time out a fresh bash stub and then read the pid it wrote used to give
// it one long, fixed timeout. That ran at least 4 s even for a stub that started at once, put two of them within 0.5 s of bun's
// 5 s default, and still lost the race to a start that took longer. The helper tries again with a longer timeout until the stub
// has written its pid, so a quick stub costs one short try and a slow one is waited for, never misread (Task 63 new-stub-start).
import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupTmps, STUB_START_FIRST_MS, STUB_START_TRIES, temp, untilStubStarted } from './helpers.ts'

afterEach(cleanupTmps)

describe('untilStubStarted', () => {
  test('a stub that wrote its pid on the first try is run once, with the shortest timeout', async () => {
    const dir = temp('cb-stub-start-')
    const tried: number[] = []
    const r = await untilStubStarted(dir, async (timeoutMs) => {
      tried.push(timeoutMs)
      writeFileSync(join(dir, 'child'), '4242\n')
      return 'first'
    })
    expect(tried).toEqual([STUB_START_FIRST_MS])
    expect(r).toEqual({ result: 'first', child: 4242 })
    expect(STUB_START_FIRST_MS).toBeLessThanOrEqual(1000) // a quick stub must not cost seconds
  })

  test('a stub that starts late gets twice the timeout each try until it has written its pid, and the last try is the one returned', async () => {
    const dir = temp('cb-stub-start-')
    const tried: number[] = []
    // A stub that needs 1.5 s: a try shorter than that stops it before it wrote anything, as a slow first exec does.
    const r = await untilStubStarted(dir, async (timeoutMs) => {
      tried.push(timeoutMs)
      if (timeoutMs >= 1500) writeFileSync(join(dir, 'child'), '77')
      return `try ${tried.length}`
    })
    expect(tried).toEqual([STUB_START_FIRST_MS, STUB_START_FIRST_MS * 2, STUB_START_FIRST_MS * 4])
    expect(r).toEqual({ result: 'try 3', child: 77 })
  })

  test('a pid file left from before the first try is not taken for the stub\'s', async () => {
    const dir = temp('cb-stub-start-')
    writeFileSync(join(dir, 'child'), '999\n')
    const tried: number[] = []
    const r = await untilStubStarted(dir, async (timeoutMs) => {
      tried.push(timeoutMs)
      if (tried.length === 2) writeFileSync(join(dir, 'child'), '31337\n')
    })
    expect(tried.length).toBe(2)
    expect(r.child).toBe(31337)
  })

  test('a file that holds no pid is not a start', async () => {
    const dir = temp('cb-stub-start-')
    let n = 0
    const r = await untilStubStarted(dir, async () => {
      n += 1
      writeFileSync(join(dir, 'child'), n === 1 ? '' : n === 2 ? 'not a pid\n' : '0\n')
      if (n === 4) writeFileSync(join(dir, 'child'), '12\n')
    })
    expect(n).toBe(4)
    expect(r.child).toBe(12)
  })

  test('a stub that never starts is an error that says so after the last try, not a read of a file that is not there', async () => {
    const dir = temp('cb-stub-start-')
    const tried: number[] = []
    const run = untilStubStarted(dir, async (timeoutMs) => { tried.push(timeoutMs) })
    await expect(run).rejects.toThrow(`wrote no child pid in ${STUB_START_TRIES} tries`)
    expect(tried).toHaveLength(STUB_START_TRIES)
    expect(tried).toEqual(Array.from({ length: STUB_START_TRIES }, (_, i) => STUB_START_FIRST_MS * 2 ** i))
  })
})

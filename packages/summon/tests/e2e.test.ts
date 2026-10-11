import { afterEach, describe, test } from 'bun:test'
import { cleanupTmps, END_TO_END, world } from './helpers.ts'

afterEach(cleanupTmps)

// The checks themselves live in helpers.ts, so the real build can run the same ones through the compiled pair.
describe('Phase 0 end to end (spec §5.3)', () => {
  for (const [name, check] of Object.entries(END_TO_END)) test(name, () => check(world()))
})

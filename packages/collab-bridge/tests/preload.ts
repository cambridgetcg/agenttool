// Runs before every test file (bunfig.toml [test] preload): a temp suite home with the override on, stubs first on PATH,
// every system-binary knob set, and nothing inherited that could reach a real journal, repo or Mac (spec §12.1).
import { afterAll } from 'bun:test'
import { setupSuite, teardownSuite } from './helpers.ts'

setupSuite()
afterAll(teardownSuite)

#!/usr/bin/env bun
// Test double for `claude -p`. Reads the prompt from stdin like the real CLI.
export {} // makes this a module, so the strict type check accepts top-level await
const mode = process.env.FAKE_MODE_FILE ? (await Bun.file(process.env.FAKE_MODE_FILE).text()).trim() : 'ok'
const prompt = await new Response(Bun.stdin.stream()).text()
const emit = (o: object) => process.stdout.write(JSON.stringify(o) + '\n')
if (process.env.FAKE_ARGV_OUT) await Bun.write(process.env.FAKE_ARGV_OUT, JSON.stringify({ argv: process.argv.slice(2), env: process.env }))
if (mode === 'ok') emit({ type: 'result', subtype: 'success', is_error: false, result: `echo: ${prompt}`, num_turns: 1, total_cost_usd: 0.01 })
if (mode === 'warn') {
  emit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: Math.floor(Date.now() / 1000) + 3600 } })
  await Bun.sleep(30_000)
}
if (mode === 'slow') await Bun.sleep(30_000)
if (mode === 'flood') {
  const line = JSON.stringify({ type: 'noise', pad: 'x'.repeat(1024 * 1024) }) + '\n'
  for (let i = 0; i < 10; i++) process.stdout.write(line)
  await Bun.sleep(30_000)
}
if (mode === 'auth') { emit({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }); process.exit(1) }

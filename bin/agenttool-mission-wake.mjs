#!/usr/bin/env node
/** Explicit, finite session delivery. See docs/COLLABORATION-MISSION-WAKE.md. */
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as client from './agenttool-mission.mjs';
import { bind, message, openReceiver, recoverLock, status } from './mission-wake-receiver.mjs';

const HELP = `AgentTool mission wake — Node 22+ on macOS/Linux; npm is optional.
prepare-codex --cwd DIR [--name LABEL]     Create a durable inbox via one readiness model turn
bind --state DIR --config-file FILE       Bind reviewed mission, peer and exact target once
status --state DIR                       Route address and receipt state; no message text
poll --state DIR                         Save one verified page, without invoking a harness
send --state DIR --to ROUTE_UUID --text-file FILE [--kind message|ack] [--in-reply-to EVENT_UUID]
watch --state DIR [--seconds 60] [--max-deliveries 1]  Finite Codex delivery (maximum 20)
channel --state DIR [--seconds 60]        Claude channel STDIO, bound to this host connection
resolve --state DIR --event-id UUID --delivery-id UUID --outcome processed|retry
recover-lock --state DIR --lock-id UUID   Explicit recovery only when the owning PID is gone
Maximum watch/channel duration: 900 seconds. No daemon or global settings installed.
Inspect ambiguous native turns before resolve; retry can duplicate a prior effect.
`;
function seconds(value = '60') {
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 900) throw new Error('Select 1–900 seconds.');
  return Number(value);
}
export async function watch(state, durationSeconds, { createAdapter, pollIntervalMs = 3000, maxDeliveries = 1 } = {}) {
  seconds(String(durationSeconds));
  if (!Number.isInteger(maxDeliveries) || maxDeliveries < 1 || maxDeliveries > 20) throw new Error('Select 1–20 deliveries.');
  const receiver = openReceiver(state);
  let adapter, completed = 0;
  const controller = new AbortController(), deadline = Date.now() + durationSeconds * 1000;
  const stop = () => controller.abort();
  const timer = setTimeout(stop, durationSeconds * 1000);
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (receiver.binding.target.kind !== 'codex') throw new Error('Use channel for a Claude channel binding.');
    const factory = createAdapter ?? (await import('./mission-wake-codex.mjs')).createCodexAdapter;
    adapter = factory({ signal: controller.signal, timeoutMs: Math.max(1, deadline - Date.now()) });
    while (!controller.signal.aborted) {
      const options = { signal: controller.signal, timeout: Math.max(1, Math.min(20000, deadline - Date.now())) };
      const page = await receiver.poll(options);
      if (controller.signal.aborted) break;
      const delivery = await receiver.dispatch(adapter, options);
      if (delivery) {
        process.stdout.write(JSON.stringify(delivery) + '\n');
        if (++completed >= maxDeliveries) break;
      }
      if (page.has_more || receiver.next()) continue;
      await new Promise(resolve => {
        const wake = () => { clearTimeout(delay); controller.signal.removeEventListener('abort', wake); resolve(); };
        const delay = setTimeout(wake, Math.max(1, Math.min(pollIntervalMs, deadline - Date.now())));
        controller.signal.addEventListener('abort', wake, { once: true });
        if (controller.signal.aborted) wake();
      });
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await adapter?.close(); receiver.close();
  }
  return status(state);
}
export async function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === 'help') { process.stdout.write(HELP); return; }
  const allowed = { 'prepare-codex': ['cwd', 'name'], bind: ['config-file'], status: [], poll: [], send: ['to', 'text-file', 'kind', 'in-reply-to'],
    watch: ['seconds', 'max-deliveries'], channel: ['seconds'], resolve: ['event-id', 'delivery-id', 'outcome'], 'recover-lock': ['lock-id'] };
  if (!Object.hasOwn(allowed, command)) throw new Error('Unknown wake command.');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2);
    if (!args[i]?.startsWith('--') || !['state', ...allowed[command]].includes(key) || Object.hasOwn(options, key) || !args[i + 1]) throw new Error('Unknown, repeated or missing wake option.');
    options[key] = args[i + 1];
  }
  if (command === 'prepare-codex') {
    if (options.state || !isAbsolute(options.cwd ?? '')) throw new Error('Select only an absolute working directory for the new inbox thread.');
    const { createCodexThread } = await import('./mission-wake-codex.mjs');
    const prepared = await createCodexThread({ cwd: options.cwd, name: options.name });
    process.stdout.write(JSON.stringify(prepared, null, 2) + '\n'); return;
  }
  if (!isAbsolute(options.state ?? '')) throw new Error('Select an absolute private mission state directory.');
  let result;
  if (command === 'bind') result = await bind(options.state, JSON.parse(client.privateRead(options['config-file'])));
  if (command === 'status') result = status(options.state);
  if (command === 'recover-lock') result = recoverLock(options.state, options['lock-id']);
  if (command === 'send') {
    const envelope = message(options.to, options.kind ?? 'message', client.privateRead(options['text-file'], 8192), options['in-reply-to']);
    const sent = await client.send(options.state, JSON.stringify(envelope));
    result = { event_id: sent.event.event_id, cursor: sent.event.received_seq, status: 'stored' };
  }
  if (command === 'poll' || command === 'resolve') {
    const receiver = openReceiver(options.state);
    try { result = command === 'poll' ? await receiver.poll() : receiver.resolve(options['event-id'], options['delivery-id'], options.outcome); }
    finally { receiver.close(); }
  }
  if (command === 'watch') result = await watch(options.state, seconds(options.seconds), { maxDeliveries: Number(options['max-deliveries'] ?? 1) });
  if (command === 'channel') {
    const { runChannel } = await import('./mission-wake-channel.mjs');
    await runChannel(options.state, { durationSeconds: seconds(options.seconds) });
    return; // Protocol stdout belongs exclusively to MCP.
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(client.safeError(error) + '\n'); process.exitCode = 1; });
}

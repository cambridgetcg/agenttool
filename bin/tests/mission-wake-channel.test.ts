/** Offline protocol fixtures only: no native host, provider, credentials, or network. */
import { afterEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { runChannel } from '../mission-wake-channel.mjs';

const ROUTE = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const DELIVERY = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1500;
  while (!predicate() && Date.now() < deadline) await pause();
  expect(predicate()).toBe(true);
}
function fixture(overrides: Record<string, any> = {}) {
  const input = new PassThrough();
  const signals = new EventEmitter();
  const messages: any[] = [];
  const receiver = {
    binding: { route_id: ROUTE, target: { kind: 'claude-channel', session_label: 'fixture-reader' } },
    polls: 0, dispatches: 0, acknowledgments: 0, closes: 0, status: 'pending',
    active: false, pollSignal: undefined as AbortSignal | undefined,
    async poll(options: any) { this.polls++; this.pollSignal = options.signal; },
    next() { return this.status === 'pending' ? { event_id: EVENT } : null; },
    async dispatch(adapter: any, options: any) {
      this.active = true;
      try {
        this.dispatches++; this.status = 'dispatching';
        expect(options.signal).toBe(this.pollSignal);
        const receipt = await adapter.deliver({ event_id: EVENT, delivery_id: DELIVERY,
          message: { format: 'agenttool-session-message/v1', to: ROUTE, kind: 'message', text: 'Selected fixture observation', in_reply_to: OTHER } }, this.binding);
        this.status = receipt.status;
        return receipt;
      } finally { this.active = false; }
    },
    acknowledge(event: string, delivery: string) {
      if (event !== EVENT || delivery !== DELIVERY || !['dispatching', 'delivered', 'processed'].includes(this.status)) throw new Error('private fixture key must not leak');
      this.acknowledgments++; this.status = 'processed';
      return { private_material: 'never serialize receiver output' };
    },
    close() { expect(this.active).toBe(false); this.closes++; },
    ...overrides.receiver,
  };
  const output = overrides.output ?? new Writable({ write(chunk, _encoding, callback) {
    messages.push(JSON.parse(chunk.toString())); callback();
  } });
  let opened = false;
  const done = runChannel('/synthetic/private/state', {
    input, output, signals, pollIntervalMs: 5, ...overrides.options,
    openReceiverImpl: () => { opened = true; return receiver; },
  });
  // Attach rejection handling immediately; assertions still inspect the same promise.
  done.catch(() => {});
  cleanups.push(async () => { input.end(); signals.emit('SIGTERM'); await done.catch(() => {}); });
  const send = (value: unknown) => input.write(JSON.stringify(value) + '\n');
  const request = (id: number, method: string, params?: unknown) => send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
  const initialize = async () => {
    await until(() => opened);
    request(1, 'initialize', { protocolVersion: '2025-06-18' });
    await until(() => messages.some(m => m.id === 1));
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  };
  return { input, output, signals, messages, receiver, done, send, request, initialize };
}

describe('bounded mission Claude channel', () => {
  test('initialization gates polling; exact connection metadata and explicit processing ack', async () => {
    const f = fixture();
    await pause();
    expect(f.receiver.polls).toBe(0);
    f.request(1, 'initialize', { protocolVersion: '2025-06-18' });
    await until(() => f.messages.some(m => m.id === 1));
    const initialization = f.messages.find(m => m.id === 1).result;
    expect(initialization.protocolVersion).toBe('2025-06-18');
    expect(initialization.capabilities).toEqual({ experimental: { 'claude/channel': {} }, tools: {} });
    expect(initialization.instructions).toContain('not a verified native session ID');
    await pause(); expect(f.receiver.polls).toBe(0);
    f.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await until(() => f.receiver.status === 'delivered');
    const delivery = f.messages.find(m => m.method === 'notifications/claude/channel');
    expect(delivery.params).toEqual({ content: 'Selected fixture observation', meta: {
      event_id: EVENT, delivery_id: DELIVERY, route_id: ROUTE, session_label: 'fixture-reader', kind: 'message', in_reply_to: OTHER,
    } });
    await until(() => f.receiver.polls > 2);
    expect(f.receiver.dispatches).toBe(1);
    expect(f.receiver.acknowledgments).toBe(0);
    f.request(2, 'tools/list');
    await until(() => f.messages.some(m => m.id === 2));
    expect(f.messages.find(m => m.id === 2).result.tools.map((t: any) => t.name)).toEqual(['mission_wake_ack']);
    f.request(3, 'tools/call', { name: 'mission_wake_ack', arguments: { event_id: EVENT, delivery_id: OTHER } });
    await until(() => f.messages.some(m => m.id === 3));
    expect(f.messages.find(m => m.id === 3).result.isError).toBe(true);
    expect(f.receiver.status).toBe('delivered');
    f.request(4, 'tools/call', { name: 'mission_wake_ack', arguments: { event_id: EVENT, delivery_id: DELIVERY } });
    await until(() => f.messages.some(m => m.id === 4));
    expect(f.receiver.status).toBe('processed');
    expect(JSON.stringify(f.messages)).not.toContain('private fixture key');
    expect(JSON.stringify(f.messages)).not.toContain('private_material');
    f.input.end();
    expect(await f.done).toEqual({ status: 'stopped', reason: 'eof' });
    expect(f.receiver.closes).toBe(1);
  });

  test('permission notifications cannot trigger tools; credential and publishing tools are absent', async () => {
    const f = fixture(); await f.initialize();
    f.send({ jsonrpc: '2.0', method: 'notifications/claude/channel/permission_request', params: { request_id: 'abcde' } });
    f.send({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'mission_wake_ack', arguments: { event_id: EVENT, delivery_id: DELIVERY } } });
    f.request(2, 'tools/call', { name: 'mission_send', arguments: { summary: 'not authorized here' } });
    f.request(3, 'tools/call', { name: 'mission_wake_ack', arguments: { event_id: EVENT, delivery_id: DELIVERY, extra: true } });
    await until(() => f.messages.some(m => m.id === 3));
    expect(f.messages.find(m => m.id === 2).error.code).toBe(-32602);
    expect(f.messages.find(m => m.id === 3).error.code).toBe(-32602);
    expect(f.receiver.acknowledgments).toBe(0);
    expect(f.messages.filter(m => m.method?.includes('permission'))).toEqual([]);
  });

  test('EOF aborts an active poll before releasing its receiver', async () => {
    let aborted = false;
    const f = fixture({ receiver: { async poll(options: any) {
      this.polls++; this.active = true;
      await new Promise<void>(resolve => options.signal.addEventListener('abort', () => { aborted = true; this.active = false; resolve(); }, { once: true }));
    } } });
    await f.initialize(); await until(() => f.receiver.polls === 1);
    f.input.end(); await f.done;
    expect(aborted).toBe(true); expect(f.receiver.dispatches).toBe(0); expect(f.receiver.closes).toBe(1);
    expect(f.signals.listenerCount('SIGTERM')).toBe(0);
    expect(f.input.listenerCount('data')).toBe(0);
  });

  test('duration and explicit signal stop without native host lifecycle actions', async () => {
    const timed = fixture({ options: { durationSeconds: 1 } });
    expect(await timed.done).toEqual({ status: 'stopped', reason: 'duration' });
    expect(timed.receiver.polls).toBe(0);
    const signaled = fixture(); await pause(); signaled.signals.emit('SIGINT');
    expect(await signaled.done).toEqual({ status: 'stopped', reason: 'signal' });
  });

  test('stream closure without EOF or an error event still stops and releases the receiver', async () => {
    const inputClosed = fixture(); await pause(); inputClosed.input.destroy();
    expect(await inputClosed.done).toEqual({ status: 'stopped', reason: 'eof' });
    expect(inputClosed.receiver.closes).toBe(1);
    const outputClosed = fixture(); await pause(); outputClosed.output.destroy();
    await expect(outputClosed.done).rejects.toThrow('output closed');
    expect(outputClosed.receiver.closes).toBe(1);
  });

  test('stalled output times out, preserves uncertainty, and never acknowledges or retries', async () => {
    const messages: any[] = [];
    const output = new Writable({ write(chunk, _encoding, callback) {
      const message = JSON.parse(chunk.toString()); messages.push(message);
      if (message.method !== 'notifications/claude/channel') callback();
    } });
    const f = fixture({ output, options: { writeTimeoutMs: 20 } });
    await pause(); f.request(1, 'initialize', {});
    await until(() => messages.some(m => m.id === 1));
    f.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await expect(f.done).rejects.toThrow('unconfirmed operation');
    expect(f.receiver.status).toBe('dispatching');
    expect(f.receiver.dispatches).toBe(1); expect(f.receiver.acknowledgments).toBe(0); expect(f.receiver.closes).toBe(1);
  });

  test('malformed UTF-8/JSON and oversized or crowded input have bounded, sanitized handling', async () => {
    const malformed = fixture(); await pause();
    malformed.input.write(Buffer.from([0xff, 10]));
    malformed.input.write('not-json\n');
    await until(() => malformed.messages.length === 2);
    expect(malformed.messages.every(m => m.error.code === -32700)).toBe(true);
    const oversized = fixture(); await pause(); oversized.input.write('x'.repeat(65537));
    await expect(oversized.done).rejects.toThrow('64 KiB');
    const crowded = fixture(); await pause();
    crowded.input.write(Array.from({ length: 17 }, (_, id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' })).join('\n') + '\n');
    await expect(crowded.done).rejects.toThrow('queue exceeded');
  });

  test('invalid bindings and timing fail before polling or emitting', async () => {
    const wrong = fixture({ receiver: { binding: { route_id: ROUTE, target: { kind: 'codex', session_label: 'wrong' } } } });
    await expect(wrong.done).rejects.toThrow('explicit Claude channel target');
    expect(wrong.receiver.polls).toBe(0); expect(wrong.receiver.closes).toBe(1);
    for (const durationSeconds of [0, -1, 901, Infinity, 1.5]) {
      const f = fixture({ options: { durationSeconds } });
      await expect(f.done).rejects.toThrow('bounded range');
      expect(f.receiver.closes).toBe(0); expect(f.messages).toEqual([]);
    }
  });

  test('receiver errors do not expose keys, paths, or arbitrary server messages', async () => {
    const f = fixture({ receiver: { async poll() { throw new Error('/private/state secret=fixture-value'); } } });
    await f.initialize();
    await expect(f.done).rejects.toThrow('unconfirmed operation');
    expect(JSON.stringify(f.messages)).not.toContain('fixture-value');
    expect(f.receiver.closes).toBe(1);
  });
});

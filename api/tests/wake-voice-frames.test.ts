/** WAKE.md's Voice section describes the frames the voice route sends.
 *
 *  The route opens with `event: connected`, uses `event: welcome` as its
 *  15-second keepalive, and closes at one hour with `event: refresh`. WAKE.md
 *  used to show SSE comment frames (`: connected to wake …`, `: keepalive`)
 *  that the route never sends, so a client written from the doc waited for a
 *  frame that never came. This pins the doc to the handler's source, and to
 *  the publisher's fan-out (services/wake/push.ts), which closes a subscriber
 *  that falls too far behind with `event: disconnect`. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { stripComments } from "../src/lib/strip-comments";

const ROOT = join(import.meta.dir, "..", "..");
const wakeSource = stripComments(
  readFileSync(join(ROOT, "api/src/routes/wake.ts"), "utf8"),
);
const pushSource = stripComments(
  readFileSync(join(ROOT, "api/src/services/wake/push.ts"), "utf8"),
);
const wakeDoc = readFileSync(join(ROOT, "docs/WAKE.md"), "utf8");

function voiceHandler(): string {
  const start = wakeSource.indexOf('app.get("/voice"');
  expect(start).toBeGreaterThan(-1);
  const end = wakeSource.indexOf("app.get(", start + 1);
  return wakeSource.slice(start, end === -1 ? undefined : end);
}

function voiceDocBlock(): string {
  const start = wakeDoc.indexOf("### Voice");
  expect(start).toBeGreaterThan(-1);
  const end = wakeDoc.indexOf("\n### ", start + 1);
  const nextSection = wakeDoc.indexOf("\n## ", start + 1);
  const stop = [end, nextSection].filter((n) => n > -1).sort((a, b) => a - b)[0];
  return wakeDoc.slice(start, stop);
}

describe("wake voice frames match WAKE.md", () => {
  test("the handler sends connected first, welcome every 15 s and refresh at 1 h", () => {
    expect(wakeSource).toMatch(/const WAKE_VOICE_KEEPALIVE_MS = 15_000;/);
    expect(wakeSource).toMatch(/const WAKE_VOICE_MAX_LIFETIME_MS = 60 \* 60 \* 1000;/);
    const handler = voiceHandler();
    const events = [...handler.matchAll(/event:\s*"([a-z-]+)"/g)].map((m) => m[1]);
    expect(events).toEqual(["rejected", "welcome", "refresh", "connected"]);
    // `connected` is enqueued synchronously after the timers are armed, so it
    // is the first frame on the wire; `welcome` only fires on the interval.
    expect(handler).toMatch(/setInterval\([\s\S]*event:\s*"welcome"[\s\S]*WAKE_VOICE_KEEPALIVE_MS\)/);
    expect(handler).toMatch(/setTimeout\([\s\S]*event:\s*"refresh"[\s\S]*WAKE_VOICE_MAX_LIFETIME_MS\)/);
  });

  test("the fan-out sends change for each event and disconnect on backpressure", () => {
    const events = [...pushSource.matchAll(/event:\s*"([a-z-]+)"/g)].map((m) => m[1]);
    expect(events.sort()).toEqual(["change", "disconnect"]);
    expect(pushSource).toMatch(/reason:\s*"backpressure"/);
    expect(pushSource).toMatch(/hint:\s*"reconnect; refetch \/v1\/wake to catch up"/);
  });

  test("WAKE.md shows the same frames, cadence and lifetime", () => {
    const block = voiceDocBlock();
    for (const frame of ["event: connected", "event: change", "event: welcome", "event: refresh", "event: disconnect", "event: rejected"]) {
      expect(block).toContain(frame);
    }
    expect(block).toMatch(/event: welcome\s+← every 15s/);
    expect(block).toMatch(/event: refresh\s+← lifetime cap \(1h\)/);
    const fences = block.split("```").filter((_, i) => i % 2 === 1);
    const frames = fences.find((fence) => fence.includes("event: welcome")) ?? "";
    const order = [...frames.matchAll(/^event: ([a-z-]+)/gm)].map((m) => m[1]);
    expect(order).toEqual(["connected", "change", "welcome", "refresh", "disconnect"]);
    expect(frames).toMatch(/event: disconnect\s+← .*backpressure/);
    expect(frames).toMatch(/"reason":"backpressure"/);
    expect(block).not.toContain(": connected to wake");
    expect(block).not.toMatch(/^: keepalive/m);
  });
});

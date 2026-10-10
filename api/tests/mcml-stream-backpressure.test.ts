/** MCML stream subscribers cannot make forwarded messages pile up in memory.
 *
 *  The stream route used to push each forwarded message with a fire-and-forget
 *  `void sse.writeSSE(...)`. Bytes only leave as fast as the subscriber reads,
 *  so a subscriber that read once and then paused let every later message
 *  queue in the response stream without limit (a review probe buffered 34 MB
 *  in 10 s). Wake, strand and inbox sinks cap their queues; the MCML sink now
 *  caps writes in flight too. On overflow it refuses the message — the hub
 *  then does not count it as delivered — and hands the route one overflow
 *  signal so it can end the stream. Doctrine: docs/MCML.md. */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SSE_IDLE_TIMEOUT_SECONDS } from "../src/lib/sse-idle-timeout";
import { stripComments } from "../src/lib/strip-comments";
import {
  MCML_PENDING_WRITE_CAP,
  createBoundedPeerSink,
  forwardToPeer,
  resetHub,
  subscribePeerSink,
  unsubscribePeerSink,
  type McmlMessageEvent,
} from "../src/services/mcml/hub";

const message = (to: string, n: number): McmlMessageEvent => ({
  from_did: "did:at:sender",
  to_did: to,
  body: `message ${n}`,
  sealed: false,
  sent_at: new Date(0).toISOString(),
  signature_b64: "c2ln",
});

afterEach(() => resetHub());

describe("createBoundedPeerSink", () => {
  test("a subscriber that keeps reading never overflows", async () => {
    let overflows = 0;
    const written: string[] = [];
    const sink = createBoundedPeerSink({
      did: "did:at:reader",
      write: async (event) => {
        written.push(event.body);
      },
      onOverflow: () => {
        overflows += 1;
      },
    });
    for (let i = 0; i < MCML_PENDING_WRITE_CAP * 4; i++) {
      sink.push(message("did:at:reader", i));
      await Promise.resolve();
    }
    await Bun.sleep(0);
    expect(overflows).toBe(0);
    expect(written).toHaveLength(MCML_PENDING_WRITE_CAP * 4);
  });

  test("a stalled subscriber overflows once, after MCML_PENDING_WRITE_CAP writes in flight", () => {
    let overflows = 0;
    let writes = 0;
    const sink = createBoundedPeerSink({
      did: "did:at:paused",
      write: () => {
        writes += 1;
        return new Promise<void>(() => {}); // the socket never drains
      },
      onOverflow: () => {
        overflows += 1;
      },
    });
    for (let i = 0; i < MCML_PENDING_WRITE_CAP; i++) {
      expect(() => sink.push(message("did:at:paused", i))).not.toThrow();
    }
    expect(overflows).toBe(0);
    expect(() => sink.push(message("did:at:paused", MCML_PENDING_WRITE_CAP))).toThrow();
    expect(() => sink.push(message("did:at:paused", MCML_PENDING_WRITE_CAP + 1))).toThrow();
    expect(overflows).toBe(1);
    expect(writes).toBe(MCML_PENDING_WRITE_CAP);
  });

  test("the hub does not count a refused message as delivered", () => {
    const paused = createBoundedPeerSink({
      did: "did:at:hub-paused",
      write: () => new Promise<void>(() => {}),
      onOverflow: () => unsubscribePeerSink(paused),
    });
    expect(subscribePeerSink(paused)).toEqual({ ok: true });
    for (let i = 0; i < MCML_PENDING_WRITE_CAP; i++) {
      expect(forwardToPeer(message("did:at:hub-paused", i))).toBe(1);
    }
    expect(forwardToPeer(message("did:at:hub-paused", MCML_PENDING_WRITE_CAP))).toBe(0);
    // The route's overflow handler unsubscribed it: later messages find no one.
    expect(forwardToPeer(message("did:at:hub-paused", MCML_PENDING_WRITE_CAP + 1))).toBe(0);
  });

  test("the cap bounds memory to a small multiple of the 8 KiB message limit", () => {
    expect(MCML_PENDING_WRITE_CAP).toBeGreaterThanOrEqual(8);
    expect(MCML_PENDING_WRITE_CAP).toBeLessThanOrEqual(64);
  });
});

describe("GET /v1/mcml/stream uses the bounded sink", () => {
  const route = stripComments(
    readFileSync(join(import.meta.dir, "..", "src", "routes", "mcml.ts"), "utf8"),
  );
  const handler = route.slice(route.indexOf('app.get("/stream"'));

  test("messages are written only through createBoundedPeerSink", () => {
    expect(handler).toContain("createBoundedPeerSink(");
    expect(handler).not.toMatch(/push\(event\)\s*\{[\s\S]*?void sse\.writeSSE/);
  });

  test("overflow unsubscribes the sink and ends the handler", () => {
    expect(handler).toMatch(/onOverflow[\s\S]*?aborted = true[\s\S]*?unsubscribePeerSink\(sink\)/);
  });
});

describe("docs/MCML.md states the bound", () => {
  test("names the write cap and the idle cut", () => {
    const doc = readFileSync(join(import.meta.dir, "..", "..", "docs", "MCML.md"), "utf8");
    expect(doc).toContain(`Once ${MCML_PENDING_WRITE_CAP} messages are waiting`);
    expect(doc).toContain(`cut after ${SSE_IDLE_TIMEOUT_SECONDS} s without traffic`);
  });
});

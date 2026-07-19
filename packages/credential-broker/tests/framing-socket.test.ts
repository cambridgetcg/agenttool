import { afterEach, describe, expect, test } from "bun:test";
import { lstat } from "node:fs/promises";
import { AgentCredError, BrokerServer, MAX_CONTROL_FRAME_BYTES } from "../src/index.js";
import { AllowAllConsent, MemoryAuditSink } from "../src/testing.js";
import { encodeFrame, FrameDecoder } from "../src/framing.js";
import { makeBroker, type BrokerFixture } from "./helpers.js";

const fixtures: BrokerFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("bounded framing and local socket", () => {
  test("decoder accepts every fragmentation boundary and coalesced frames", () => {
    const values: unknown[] = [];
    const first = encodeFrame({ a: 1 });
    const second = encodeFrame({ b: 2 });
    const joined = Buffer.concat([first, second]);
    for (let split = 0; split <= joined.length; split += 1) {
      values.length = 0;
      const decoder = new FrameDecoder((value) => values.push(value));
      decoder.push(joined.subarray(0, split));
      decoder.push(joined.subarray(split));
      expect(values).toEqual([{ a: 1 }, { b: 2 }]);
      decoder.clear();
    }
    first.fill(0);
    second.fill(0);
    joined.fill(0);
  });

  test("oversized frame length is rejected before body allocation", () => {
    const decoder = new FrameDecoder(() => undefined);
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(MAX_CONTROL_FRAME_BYTES + 1);
    expect(() => decoder.push(prefix)).toThrow(AgentCredError);
  });

  test("socket directory and socket are owner-only", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const directory = await lstat(fixture.root);
    const socket = await lstat(fixture.socketPath);
    expect(directory.mode & 0o777).toBe(0o700);
    expect(socket.mode & 0o777).toBe(0o600);
    expect(socket.isSocket()).toBe(true);
  });

  test("a second broker cannot unlink an active socket", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const second = new BrokerServer({
      socketPath: fixture.socketPath,
      credentials: fixture.credentials,
      consent: new AllowAllConsent(),
      audit: new MemoryAuditSink(),
    });
    await expect(second.start()).rejects.toMatchObject({ code: "network_denied" });
    expect(fixture.client.connected).toBe(true);
  });

  test("native peer identity reaches consent and metadata audit", async () => {
    let observed: unknown;
    const fixture = await makeBroker({
      authorizePeer: (_socket, signal) => {
        expect(signal.aborted).toBe(false);
        return { id: "codesign:test-agent-host", displayName: "Test agent host" };
      },
      consent: {
        async decide(_request, context) {
          observed = context;
          return { allowed: true };
        },
      },
    });
    fixtures.push(fixture);
    await fixture.client.requestGrant({
      alias: "peer-test",
      credential: "agenttool/default",
      operation: "http.fetch",
      scope: {
        origin: "https://api.example.com",
        methods: ["GET"],
        pathPrefixes: ["/v1"],
        ttlSeconds: 30,
        maxUses: 1,
      },
    });

    expect(observed).toMatchObject({
      peer: { id: "codesign:test-agent-host", displayName: "Test agent host" },
    });
    expect(Object.isFrozen(observed)).toBe(true);
    expect(fixture.audit.events.at(-1)?.peerId).toBe("codesign:test-agent-host");
  });
});

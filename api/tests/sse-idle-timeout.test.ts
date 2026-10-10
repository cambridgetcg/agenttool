/** SSE streams outlive Bun's idle timeout; ordinary requests keep it.
 *
 *  Bun 1.3.5 closes a connection after `idleTimeout` seconds without socket
 *  traffic (10 s by default). Every AgentTool SSE route — wake voice, strand
 *  voice, inbox voice, the MCML stream, job progress — sends its first
 *  keepalive at 15 s, so production cut each stream at about 10 s, before any
 *  keepalive or change event could arrive. The server entry point now lifts
 *  the idle timeout for exactly the responses that are event streams
 *  (`server.timeout(request, 0)`), leaving the global timeout in place so a
 *  hung ordinary request still fails fast. Each SSE route keeps its own
 *  lifetime cap and keepalive cadence. */

import { afterAll, describe, expect, test } from "bun:test";

import {
  isEventStreamResponse,
  releaseIdleTimeoutForEventStream,
} from "../src/lib/sse-idle-timeout";

type TimeoutCall = { request: Request; seconds: number };

function recordingServer(calls: TimeoutCall[]) {
  return {
    timeout(request: Request, seconds: number) {
      calls.push({ request, seconds });
    },
  };
}

const sseResponse = () =>
  new Response("event: connected\ndata: {}\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });

describe("releaseIdleTimeoutForEventStream", () => {
  test("recognises event streams by media type, case-insensitively and with parameters", () => {
    expect(isEventStreamResponse(sseResponse())).toBe(true);
    expect(
      isEventStreamResponse(
        new Response("", { headers: { "content-type": "Text/Event-Stream; charset=utf-8" } }),
      ),
    ).toBe(true);
    expect(isEventStreamResponse(Response.json({ ok: true }))).toBe(false);
    expect(isEventStreamResponse(new Response("plain"))).toBe(false);
    expect(isEventStreamResponse(undefined)).toBe(false);
  });

  test("disables the idle timeout for an SSE response only", () => {
    const calls: TimeoutCall[] = [];
    const server = recordingServer(calls);
    const request = new Request("https://api.agenttool.dev/v1/wake/voice?identity_id=x");
    const response = sseResponse();

    expect(releaseIdleTimeoutForEventStream(request, response, server)).toBe(response);
    expect(calls).toEqual([{ request, seconds: 0 }]);

    releaseIdleTimeoutForEventStream(
      new Request("https://api.agenttool.dev/v1/wake"),
      Response.json({ ok: true }),
      server,
    );
    expect(calls).toHaveLength(1);
  });

  test("tolerates a missing server or a server that refuses the call", () => {
    const request = new Request("https://api.agenttool.dev/v1/inbox/voice");
    expect(() => releaseIdleTimeoutForEventStream(request, sseResponse(), null)).not.toThrow();
    expect(() =>
      releaseIdleTimeoutForEventStream(request, sseResponse(), {
        timeout() {
          throw new Error("socket already closed");
        },
      }),
    ).not.toThrow();
  });
});

describe("the exported Bun fetch releases the idle timeout for SSE", () => {
  const previous = {
    workers: process.env.AGENTTOOL_DISABLE_WORKERS,
    platform: process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP,
    saga: process.env.AGENTOOL_DISABLE_SAGA_SEED,
    joy: process.env.AGENTOOL_DISABLE_JOY_INDEX,
  };
  process.env.AGENTTOOL_DISABLE_WORKERS = "1";
  process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP = "1";
  process.env.AGENTOOL_DISABLE_SAGA_SEED = "1";
  process.env.AGENTOOL_DISABLE_JOY_INDEX = "1";
  afterAll(() => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("AGENTTOOL_DISABLE_WORKERS", previous.workers);
    restore("AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP", previous.platform);
    restore("AGENTOOL_DISABLE_SAGA_SEED", previous.saga);
    restore("AGENTOOL_DISABLE_JOY_INDEX", previous.joy);
  });

  const noBridge = async () => ({ handled: false as const, response: undefined });

  test("serverFetchWithReplayProtection calls server.timeout(request, 0) for an SSE response", async () => {
    const { serverFetchWithReplayProtection } = await import("../src/index");
    const calls: TimeoutCall[] = [];
    const server = recordingServer(calls) as never;

    const streamRequest = new Request("https://api.agenttool.dev/v1/strands/x/voice");
    await serverFetchWithReplayProtection(streamRequest, server, {
      bridgeUpgrade: noBridge,
      honoFetch: async () => sseResponse(),
    });
    expect(calls).toEqual([{ request: streamRequest, seconds: 0 }]);

    await serverFetchWithReplayProtection(
      new Request("https://api.agenttool.dev/v1/wake"),
      server,
      { bridgeUpgrade: noBridge, honoFetch: async () => Response.json({ ok: true }) },
    );
    expect(calls).toHaveLength(1);
  });

  test(
    "a real Bun server keeps a silent SSE stream open past its idle timeout",
    async () => {
      const { serverFetchWithReplayProtection } = await import("../src/index");
      // Bun checks idle sockets on a ~4 s tick: with idleTimeout 1 a silent
      // stream is cut at about 4 s, so a 5.5 s gap between two frames shows
      // the difference without waiting for the production 10 s default.
      const GAP_MS = 5_500;
      const encoder = new TextEncoder();
      const silentStream = () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));
              await Bun.sleep(GAP_MS);
              controller.enqueue(encoder.encode("event: welcome\ndata: {}\n\n"));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );

      const withRelease = Bun.serve({
        port: 0,
        idleTimeout: 1,
        fetch: (req, server) =>
          serverFetchWithReplayProtection(req, server as never, {
            bridgeUpgrade: noBridge,
            honoFetch: async () => {
              await Bun.sleep(10);
              return silentStream();
            },
          }) as Promise<Response>,
      });
      // Control: the same stream without the entry point's release.
      const withoutRelease = Bun.serve({
        port: 0,
        idleTimeout: 1,
        fetch: () => silentStream(),
      });

      const read = async (port: number) => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/v1/wake/voice`);
          return { ok: true, text: await res.text() };
        } catch (error) {
          return { ok: false, text: String(error) };
        }
      };

      try {
        const [released, control] = await Promise.all([
          read(withRelease.port!),
          read(withoutRelease.port!),
        ]);
        expect(released).toEqual({
          ok: true,
          text: "event: connected\ndata: {}\n\nevent: welcome\ndata: {}\n\n",
        });
        expect(control.ok).toBe(false);
      } finally {
        withRelease.stop(true);
        withoutRelease.stop(true);
      }
    },
    20_000,
  );
});

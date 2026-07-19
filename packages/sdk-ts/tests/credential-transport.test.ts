/** Authenticated transport boundary tests — no real credentials or network. */

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  AgentTool,
  AgentToolError,
  type AgentToolTransport,
} from "../src/index.js";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_API_KEY = process.env.AT_API_KEY;

function restoreEnv(): void {
  if (ORIGINAL_API_KEY === undefined) delete process.env.AT_API_KEY;
  else process.env.AT_API_KEY = ORIGINAL_API_KEY;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  restoreEnv();
});

function captureTransport(): {
  transport: AgentToolTransport;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const transport: AgentToolTransport = {
    async request(input, init) {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });

      if (url.includes("/v1/wake/voice")) {
        return new Response("event: disconnect\ndata: {}\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (url.endsWith("/v1/memories")) {
        return new Response(
          JSON.stringify({
            id: "mem-transport",
            content: "through broker",
            type: "semantic",
            importance: 0.5,
            metadata: {},
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
  return { transport, calls };
}

describe("AgentTool authenticated transport", () => {
  test("works without a key and never injects the ambient key", async () => {
    const ambientSentinel = "ambient-key-must-not-cross-boundary";
    process.env.AT_API_KEY = ambientSentinel;
    const { transport, calls } = captureTransport();
    globalThis.fetch = mock(() => {
      throw new Error("default fetch must not run in transport mode");
    }) as unknown as typeof fetch;

    const at = new AgentTool({ transport });
    const memory = await at.memory.store("through broker");

    expect(memory.id).toBe("mem-transport");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.has("authorization")).toBe(false);
    expect(
      JSON.stringify({
        url: calls[0]!.url,
        headers: [...calls[0]!.headers.entries()],
        body: calls[0]!.body,
      }),
    ).not.toContain(ambientSentinel);
  });

  test("rejects an explicit key together with a transport", () => {
    const { transport, calls } = captureTransport();
    try {
      new AgentTool({ apiKey: "explicit-key", transport });
      throw new Error("expected conflicting auth to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      expect((error as AgentToolError).code).toBe("conflicting_auth");
    }
    expect(calls).toHaveLength(0);
  });

  test("routes low-level requests and SSE through the transport", async () => {
    delete process.env.AT_API_KEY;
    const { transport, calls } = captureTransport();
    const at = new AgentTool({ transport });

    await at.request("POST", "/v1/custom", { hello: "world" });
    for await (const _event of at.wake.voice({ identityId: "identity-1" })) {
      // The fixture ends the stream with a disconnect control event.
    }

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.agenttool.dev/v1/custom",
      "https://api.agenttool.dev/v1/wake/voice?identity_id=identity-1",
    ]);
    expect(calls[1]!.headers.get("accept")).toBe("text/event-stream");
    for (const call of calls) {
      expect(call.headers.has("authorization")).toBe(false);
    }
  });

  test("does not share the hosted transport with the data node", async () => {
    delete process.env.AT_API_KEY;
    const { transport, calls: hostedCalls } = captureTransport();
    const dataFetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer separate-data-token",
      );
      return Promise.resolve(
        new Response(JSON.stringify({ protocol: "agent-data/v1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    globalThis.fetch = dataFetch as unknown as typeof fetch;

    const at = new AgentTool({
      transport,
      dataNode: {
        baseUrl: "http://127.0.0.1:7742",
        token: "separate-data-token",
      },
    });
    await at.data.manifest();

    expect(hostedCalls).toHaveLength(0);
    expect(dataFetch).toHaveBeenCalledTimes(1);
  });

  test("keeps anonymous public discovery outside the authenticated transport", async () => {
    delete process.env.AT_API_KEY;
    const { transport, calls: hostedCalls } = captureTransport();
    const publicFetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe("omit");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return Promise.resolve(
        new Response(JSON.stringify({ agents: [], count: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    globalThis.fetch = publicFetch as unknown as typeof fetch;

    const at = new AgentTool({ transport });
    await at.darkContinent.explore();

    expect(publicFetch).toHaveBeenCalledTimes(1);
    expect(hostedCalls).toHaveLength(0);
  });

  test("direct mode still adds its bearer at request time", async () => {
    delete process.env.AT_API_KEY;
    const fetchStub = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = fetchStub as unknown as typeof fetch;

    const at = new AgentTool({ apiKey: "direct-key" });
    await at.request("GET", "/v1/check");

    const init = fetchStub.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer direct-key",
    );
  });
});

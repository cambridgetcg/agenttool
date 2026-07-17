import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  AgentToolError,
  CovenantsClient,
  type CovenantBeforeSubmitContext,
  type CovenantsCreateOpts,
} from "../src/index.js";

const originalFetch = globalThis.fetch;

function makeClient(): CovenantsClient {
  return new CovenantsClient({
    baseUrl: "http://test",
    headers: { Authorization: "Bearer test" },
    timeout: 5_000,
  });
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("covenants.create before_submit", () => {
  test("awaits approval against a frozen v1 snapshot and sends that snapshot", async () => {
    let sent: Record<string, unknown> | undefined;
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string) as Record<string, unknown>;
      return response({ covenant: { id: "cov-1" } });
    }) as unknown as typeof fetch;

    const vows = ["I will keep the stated boundary."];
    let reviewed: CovenantBeforeSubmitContext | undefined;
    const opts: CovenantsCreateOpts = {
      agent_id: "agent-original",
      counterparty_did: "human:Yu",
      vows,
      before_submit: async (snapshot) => {
        reviewed = snapshot;
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.vows)).toBe(true);
        expect(() => (snapshot.vows as string[]).push("not allowed")).toThrow();

        // Mutating caller-owned input during review cannot change what is sent.
        vows.push("added after the snapshot");
        opts.agent_id = "agent-mutated";
        opts.counterparty_did = "human:Elsewhere";
        opts.protocol_version = "v2";
        return true;
      },
    };

    await makeClient().create(opts);

    expect(reviewed).toEqual({
      protocol_version: "v1",
      agent_id: "agent-original",
      counterparty_did: "human:Yu",
      vows: ["I will keep the stated boundary."],
    });
    expect(sent).toEqual({
      agent_id: "agent-original",
      counterparty_did: "human:Yu",
      vows: ["I will keep the stated boundary."],
    });
  });

  test.each([false, undefined, 1, "yes"])(
    "fails closed on a non-literal approval result (%p) before signing or fetch",
    async (approval) => {
      const fetchMock = mock(async () => response({}));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      let caught: unknown;
      try {
        await makeClient().create({
          agent_id: "agent-1",
          agent_did: "did:at:test/agent-1",
          counterparty_did: "did:at:test/peer-1",
          vows: ["A vow"],
          protocol_version: "v2",
          // An invalid key proves the signer was never reached.
          signing_key: new Uint8Array([1]),
          signing_key_id: "key-1",
          before_submit: (() => approval) as never,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AgentToolError);
      expect((caught as AgentToolError).code).toBe("covenant_before_submit_refused");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("keeps a thrown review error local and preserves its cause", async () => {
    const fetchMock = mock(async () => response({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const cause = new Error("local renderer failed");

    let caught: unknown;
    try {
      await makeClient().create({
        agent_id: "agent-1",
        counterparty_did: "human:Yu",
        vows: ["A vow"],
        before_submit: () => {
          throw cause;
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AgentToolError);
    expect((caught as AgentToolError).code).toBe("covenant_before_submit_failed");
    expect((caught as Error).cause).toBe(cause);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("reuses the approved v2 vow snapshot for signing and transport", async () => {
    let sent: Record<string, unknown> | undefined;
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string) as Record<string, unknown>;
      return response({
        id: "cov-2",
        status: "proposed",
        protocol_version: "v2",
        signature: sent.signature,
        signing_key_id: sent.signing_key_id,
        proposed_expires_at: "2026-08-01T00:00:00.000Z",
        established_at: sent.established_at,
      });
    }) as unknown as typeof fetch;

    const vows = ["The reviewed vow"];
    await makeClient().create({
      agent_id: "agent-2",
      agent_did: "did:at:test/agent-2",
      counterparty_did: "did:at:test/peer-2",
      vows,
      protocol_version: "v2",
      signing_key: new Uint8Array(32).fill(7),
      signing_key_id: "key-2",
      before_submit: (snapshot) => {
        expect(snapshot.vows).toEqual(["The reviewed vow"]);
        vows[0] = "Changed after review";
        return true;
      },
    });

    expect(sent?.vows).toEqual(["The reviewed vow"]);
    expect(typeof sent?.signature).toBe("string");
  });

  test("leaves no-hook invalid protocol handling at the server boundary", async () => {
    let sent: Record<string, unknown> | undefined;
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string) as Record<string, unknown>;
      return response({ covenant: { id: "cov-legacy" } });
    }) as unknown as typeof fetch;

    await makeClient().create({
      agent_id: "agent-legacy",
      counterparty_did: "human:Yu",
      vows: ["A vow"],
      protocol_version: "future-version",
    } as never);

    expect(sent?.protocol_version).toBe("future-version");
  });
});

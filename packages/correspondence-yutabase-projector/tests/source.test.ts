import { describe, expect, test } from "bun:test";

import { ProjectorError } from "../src/errors";
import { SourceClient } from "../src/source";

const config = {
  sourceOrigin: "http://127.0.0.1:3000",
  sourceToken: "private-token-canary",
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("loopback source client", () => {
  test("programmatic clients refuse remote AgentTool origins", () => {
    expect(() =>
      new SourceClient({
        sourceOrigin: "https://api.agenttool.dev",
        sourceToken: config.sourceToken,
      }),
    ).toThrow(ProjectorError);
  });

  test("uses authenticated GET with redirects disabled", async () => {
    let called = false;
    const client = new SourceClient(config, {
      fetch: (async (input, init) => {
        called = true;
        expect(String(input)).toBe(
          "http://127.0.0.1:3000/v1/correspondence/events?repository_id=repo-a&limit=16",
        );
        expect(init?.method).toBe("GET");
        expect(init?.redirect).toBe("error");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer private-token-canary",
        );
        return json({
          protocol: "agent-correspondence/v0.1",
          scope: "project_private",
          events: [],
          page: { after: null, next_after: null, has_more: false },
        });
      }) as typeof fetch,
    });
    const page = await client.list("repo-a", "0");
    expect(called).toBe(true);
    expect(page.events).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  test("resolves revoked historical keys", async () => {
    const client = new SourceClient(config, {
      fetch: (async () =>
        json({
          keys: [
            {
              kid: "33333333-3333-4333-8333-333333333333",
              public_key: Buffer.alloc(32, 7).toString("base64"),
              label: null,
              active: false,
              created_at: "2026-07-22T12:00:00.000Z",
              revoked_at: "2026-07-23T12:00:00.000Z",
              authority_root: false,
            },
          ],
          authority: {
            mode: "agent_root",
            sequence: 2,
            next_sequence: 3,
          },
        })) as typeof fetch,
    });
    const key = await client.signingKey(
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    );
    expect(key.active).toBe(false);
    expect(key.revokedAt).toBe("2026-07-23T12:00:00.000Z");
  });

  test("rejects pagination that claims progress without events", async () => {
    const client = new SourceClient(config, {
      fetch: (async () =>
        json({
          protocol: "agent-correspondence/v0.1",
          scope: "project_private",
          events: [],
          page: { after: null, next_after: "1", has_more: true },
        })) as typeof fetch,
    });
    expect(client.list("repo-a", "0")).rejects.toBeInstanceOf(ProjectorError);
  });

  test("accepts an empty caught-up page preserving a nonzero cursor", async () => {
    const client = new SourceClient(config, {
      fetch: (async () =>
        json({
          protocol: "agent-correspondence/v0.1",
          scope: "project_private",
          events: [],
          page: { after: "7", next_after: "7", has_more: false },
        })) as typeof fetch,
    });
    const page = await client.list("repo-a", "7");
    expect(page.nextAfter).toBe("7");
    expect(page.hasMore).toBe(false);
  });

  test("strictly rejects duplicate decoded JSON names", async () => {
    const client = new SourceClient(config, {
      fetch: (async () =>
        new Response(
          '{"protocol":"agent-correspondence/v0.1","scope":"project_private","\\u0073cope":"project_private","events":[],"page":{"after":null,"next_after":null,"has_more":false}}',
          { status: 200 },
        )) as typeof fetch,
    });
    expect(client.list("repo-a", "0")).rejects.toBeInstanceOf(ProjectorError);
  });

  test("strictly rejects malformed UTF-8", async () => {
    const client = new SourceClient(config, {
      fetch: (async () =>
        new Response(new Uint8Array([0xff]), {
          status: 200,
        })) as typeof fetch,
    });
    expect(client.list("repo-a", "0")).rejects.toBeInstanceOf(ProjectorError);
  });

  test("refuses page sizes above the bounded wire budget", async () => {
    const client = new SourceClient(config, {
      fetch: (async () => {
        throw new Error("must not fetch");
      }) as typeof fetch,
    });
    expect(client.list("repo-a", "0", 17)).rejects.toBeInstanceOf(
      ProjectorError,
    );
  });

  test("cancels a chunked response as soon as it crosses 2 MiB", async () => {
    let cancelled = false;
    let chunk = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunk += 1;
        controller.enqueue(
          new Uint8Array(chunk === 1 ? 2 * 1024 * 1024 : 1),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const client = new SourceClient(config, {
      fetch: (async () => new Response(body, { status: 200 })) as typeof fetch,
    });

    await expect(client.list("repo-a", "0")).rejects.toMatchObject({
      code: "source_protocol_invalid",
    });
    expect(cancelled).toBe(true);
    expect(chunk).toBeGreaterThanOrEqual(2);
    expect(chunk).toBeLessThanOrEqual(3);
  });

  test("rejects a page containing more events than requested", async () => {
    const client = new SourceClient(config, {
      fetch: (async () =>
        json({
          protocol: "agent-correspondence/v0.1",
          scope: "project_private",
          events: [{ ordinal: 1 }, { ordinal: 2 }],
          page: { after: null, next_after: "2", has_more: false },
        })) as typeof fetch,
    });

    await expect(client.list("repo-a", "0", 1)).rejects.toMatchObject({
      code: "source_protocol_invalid",
    });
  });

  test("rejects unknown key response fields", async () => {
    const client = new SourceClient(config, {
      fetch: (async () =>
        json({
          keys: [],
          authority: {
            mode: "agent_root",
            sequence: 2,
            next_sequence: 3,
          },
          leaked: "unexpected",
        })) as typeof fetch,
    });
    expect(
      client.signingKey(
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ),
    ).rejects.toBeInstanceOf(ProjectorError);
  });

  const historicalKeyBytes = Buffer.alloc(32, 0xff);
  test.each([
    [
      "unpadded standard base64",
      historicalKeyBytes.toString("base64").replace(/=+$/, ""),
    ],
    ["unpadded base64url", historicalKeyBytes.toString("base64url")],
  ])("accepts historical %s public keys", async (_label, publicKey) => {
    const client = new SourceClient(config, {
      fetch: (async () =>
        json({
          keys: [
            {
              kid: "33333333-3333-4333-8333-333333333333",
              public_key: publicKey,
              label: null,
              active: false,
              created_at: "2026-07-22T12:00:00.000Z",
              revoked_at: "2026-07-23T12:00:00.000Z",
              authority_root: false,
            },
          ],
          authority: {
            mode: "agent_root",
            sequence: 2,
            next_sequence: 3,
          },
        })) as typeof fetch,
    });
    const key = await client.signingKey(
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    );
    expect(key.publicKey).toBe(publicKey);
  });
});

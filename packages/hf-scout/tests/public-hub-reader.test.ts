import { describe, expect, test } from "bun:test";

import {
  PublicHubReader,
  type FetchLike,
} from "../src/index.js";
import { classifyHubReaderTransport } from "../src/public-hub-reader.js";

describe("PublicHubReader", () => {
  test("constructs one fixed-origin credentialless GET", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({
        id: "org/model",
        sha: "a".repeat(40),
      });
    };
    const reader = new PublicHubReader({ fetch });
    const result = await reader.inspect({ kind: "model", id: "org/model" });

    expect(result).toMatchObject({ id: "org/model" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://huggingface.co/api/models/org/model?blobs=true");
    expect(calls[0]?.init).toMatchObject({
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
    });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
  });

  test("routes exact model, dataset, and Space revisions with blob metadata", async () => {
    const revision = "a".repeat(40);
    const urls: string[] = [];
    const reader = new PublicHubReader({
      fetch: async (input) => {
        urls.push(String(input));
        return Response.json({ id: "ignored/by-reader", sha: revision });
      },
    });
    await reader.inspect({ kind: "model", id: "org/model", revision });
    await reader.inspect({ kind: "dataset", id: "org/data", revision });
    await reader.inspect({ kind: "space", id: "org/app", revision });
    expect(urls).toEqual([
      `https://huggingface.co/api/models/org/model/revision/${revision}?blobs=true`,
      `https://huggingface.co/api/datasets/org/data/revision/${revision}?blobs=true`,
      `https://huggingface.co/api/spaces/org/app/revision/${revision}?blobs=true`,
    ]);
  });

  test("rejects non-exact revisions before transport and sanitizes exact 404s", async () => {
    let calls = 0;
    const invalid = new PublicHubReader({
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });
    await expect(
      invalid.inspect({ kind: "model", id: "org/model", revision: "refs/pr/1" }),
    ).rejects.toMatchObject({ code: "invalid_revision" });
    expect(calls).toBe(0);

    const missing = new PublicHubReader({
      fetch: async () => Response.json(
        { error: "provider-secret-body" },
        { status: 404 },
      ),
    });
    const operation = missing.inspect({
      kind: "model",
      id: "org/model",
      revision: "a".repeat(40),
    });
    await expect(operation).rejects.toMatchObject({
      code: "hub_revision_not_found_or_not_associated",
      message: "Hub revision was not found or is not associated with the requested repository",
    });
    await operation.catch((error: unknown) => {
      expect(String(error)).not.toContain("provider-secret-body");
    });
  });

  test("brands only the default transport as built in", () => {
    const builtIn = new PublicHubReader();
    expect(classifyHubReaderTransport(builtIn)).toBe("public_hub_api");
    expect(Object.isFrozen(builtIn)).toBe(true);
    expect(classifyHubReaderTransport(new PublicHubReader({
      fetch: async () => Response.json({}),
    }))).toBe("injected");
    class DerivedReader extends PublicHubReader {}
    expect(classifyHubReaderTransport(new DerivedReader())).toBe("injected");
    expect(classifyHubReaderTransport(
      Object.create(PublicHubReader.prototype) as PublicHubReader,
    )).toBe("injected");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ replaced: true });
    try {
      expect(classifyHubReaderTransport(new PublicHubReader())).toBe("injected");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("encodes search text and enforces its result bound", async () => {
    let observedUrl = "";
    const reader = new PublicHubReader({
      fetch: async (input) => {
        observedUrl = String(input);
        return Response.json([]);
      },
      limits: { max_search_results: 3 },
    });
    await reader.search({ kind: "dataset", query: "agent traces", limit: 3 });
    expect(observedUrl).toBe(
      "https://huggingface.co/api/datasets?search=agent+traces&limit=3&full=false",
    );
    await expect(
      reader.search({ kind: "dataset", query: "agent", limit: 4 }),
    ).rejects.toMatchObject({ code: "invalid_limit" });
  });

  test("rejects redirects, non-JSON, and declared oversized responses", async () => {
    const redirect = new PublicHubReader({
      fetch: async () => new Response(null, {
        status: 302,
        headers: { location: "https://example.com" },
      }),
    });
    await expect(
      redirect.inspect({ kind: "model", id: "org/model" }),
    ).rejects.toMatchObject({ code: "hub_redirect_rejected" });

    const html = new PublicHubReader({
      fetch: async () => new Response("<html>", {
        headers: { "content-type": "text/html" },
      }),
    });
    await expect(
      html.inspect({ kind: "model", id: "org/model" }),
    ).rejects.toMatchObject({ code: "hub_media_type" });

    const oversized = new PublicHubReader({
      fetch: async () => new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "100",
        },
      }),
      limits: { max_response_bytes: 8 },
    });
    await expect(
      oversized.inspect({ kind: "model", id: "org/model" }),
    ).rejects.toMatchObject({ code: "hub_response_too_large" });
  });

  test("bounds streaming bodies before JSON parsing", async () => {
    const reader = new PublicHubReader({
      fetch: async () => new Response(`{"data":"${"x".repeat(64)}"}`, {
        headers: { "content-type": "application/json" },
      }),
      limits: { max_response_bytes: 16 },
    });
    await expect(
      reader.inspect({ kind: "model", id: "org/model" }),
    ).rejects.toMatchObject({ code: "hub_response_too_large" });
  });

  test("bounds a custom fetch that ignores AbortSignal without retry", async () => {
    let calls = 0;
    let release: ((response: Response) => void) | undefined;
    const reader = new PublicHubReader({
      fetch: async () => {
        calls += 1;
        return await new Promise<Response>((resolve) => {
          release = resolve;
        });
      },
      limits: { timeout_ms: 5 },
    });
    await expect(
      reader.inspect({ kind: "model", id: "org/model" }),
    ).rejects.toMatchObject({ code: "hub_timeout" });
    expect(calls).toBe(1);
    release?.(Response.json({}));
  });

  test("bounds a response body that does not react to the request signal", async () => {
    let closeBody: (() => void) | undefined;
    const reader = new PublicHubReader({
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          closeBody = () => controller.close();
        },
      }), {
        headers: { "content-type": "application/json" },
      }),
      limits: { timeout_ms: 5 },
    });
    await expect(
      reader.inspect({ kind: "model", id: "org/model" }),
    ).rejects.toMatchObject({ code: "hub_timeout" });
    closeBody?.();
  });

  test("distinguishes caller cancellation and does not start when already aborted", async () => {
    let calls = 0;
    const reader = new PublicHubReader({
      fetch: async (_input, init) => {
        calls += 1;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("private")), {
            once: true,
          });
        });
      },
    });
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(
      reader.inspect({
        kind: "model",
        id: "org/model",
        signal: alreadyAborted.signal,
      }),
    ).rejects.toMatchObject({ code: "operation_cancelled" });
    expect(calls).toBe(0);

    const inFlight = new AbortController();
    const operation = reader.inspect({
      kind: "model",
      id: "org/model",
      signal: inFlight.signal,
    });
    inFlight.abort();
    await expect(operation).rejects.toMatchObject({ code: "operation_cancelled" });
    expect(calls).toBe(1);
  });

  test("does not pretend its public reader implements papers", async () => {
    const reader = new PublicHubReader();
    await expect(
      reader.inspect({ kind: "paper", id: "2607.12345" }),
    ).rejects.toMatchObject({ code: "unsupported_public_operation" });
  });
});

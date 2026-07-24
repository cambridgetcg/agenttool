/** Apex content negotiation — many machine dialects, one truthful door. */
import { describe, expect, test } from "bun:test";

import { handleRequest, prefersJson } from "../../infra/apex-door/worker.js";

describe("apex Accept negotiation", () => {
  test("parses casing, q-values, and structured JSON suffixes exactly", () => {
    const cases: Array<[string, boolean]> = [
      ["application/json", true],
      ["Application/JSON", true],
      ["application/vnd.agenttool.window+json", true],
      ["application/*+json", true],
      ["application/json; charset=utf-8", true],
      ["application/jsonp", false],
      ["application/json;q=0", false],
      ["application/json;q=0, */*;q=1", false],
      ["application/json;q=.4, text/html;q=.9", false],
      ["text/html;q=.4, application/json;q=.9", true],
      ["application/json, text/html", true],
      ["text/html, application/json", false],
      ["*/*, application/json", true],
      ["text/*, application/vnd.agenttool+json", true],
      ["*/*", false],
      ["", false],
    ];

    for (const [header, expected] of cases) {
      expect(prefersJson(header), header).toBe(expected);
    }
  });

  test("maps visual pages to their JSON twins and marks the variance", async () => {
    const calls: string[] = [];
    const upstream = async (url: string) => {
      calls.push(url);
      return new Response("upstream", { headers: { vary: "Origin" } });
    };

    const response = await handleRequest(new Request(
      "https://agenttool.dev/credits?session_id=must-not-forward",
      { headers: { accept: "application/vnd.agenttool+json" } },
    ), upstream);

    expect(calls).toEqual(["https://api.agenttool.dev/public/plans"]);
    expect(response.headers.get("vary")).toBe("Origin, Accept");

    await handleRequest(new Request(
      "https://agenttool.dev/lounge.html?presence=must-not-forward",
      { headers: { accept: "application/json" } },
    ), upstream);
    expect(calls[1]).toBe("https://api.agenttool.dev/public/lounge");

    await handleRequest(new Request(
      "https://agenttool.dev/porch?arrival=must-not-forward",
      { headers: { accept: "application/json" } },
    ), upstream);
    expect(calls[2]).toBe("https://api.agenttool.dev/public/porch");
  });

  test("keeps HTML on Pages, explicit welcome JSON on Pages, and the legacy root JSON on API", async () => {
    const calls: string[] = [];
    const upstream = async (url: string) => {
      calls.push(url);
      return new Response("upstream");
    };

    await handleRequest(new Request("https://agenttool.dev/watch", {
      headers: { accept: "text/html,application/json;q=.2" },
    }), upstream);
    await handleRequest(new Request("https://agenttool.dev/llms-full.txt", {
      headers: { accept: "text/plain" },
    }), upstream);
    await handleRequest(new Request("https://agenttool.dev/", {
      headers: { accept: "application/json" },
    }), upstream);
    await handleRequest(new Request("https://agenttool.dev/welcome.json", {
      headers: { accept: "application/json" },
    }), upstream);

    expect(calls).toEqual([
      "https://agenttool-web.pages.dev/watch",
      "https://api.agenttool.dev/llms-full.txt",
      "https://api.agenttool.dev/",
      "https://agenttool-web.pages.dev/welcome.json",
    ]);
  });

  test("proxies the root OpenAPI alias to the API before unknown-JSON refusal", async () => {
    const calls: string[] = [];
    const response = await handleRequest(new Request(
      "https://agenttool.dev/openapi.json",
      { headers: { accept: "application/json" } },
    ), async (url: string) => {
      calls.push(url);
      return new Response(null, {
        status: 308,
        headers: { location: "https://api.agenttool.dev/v1/openapi.json" },
      });
    });

    expect(calls).toEqual(["https://api.agenttool.dev/openapi.json"]);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://api.agenttool.dev/v1/openapi.json",
    );
  });

  test("keeps credentials off Pages and avoids legacy secret-bearing redirects", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    await handleRequest(new Request(
      "https://agenttool.dev/credits.html?session_id=cs_existing",
      {
        headers: {
          accept: "text/html",
          authorization: "Bearer at_secret",
          cookie: "private=value",
          "x-api-key": "also-secret",
        },
      },
    ), async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: new Headers(init?.headers) });
      return new Response("page");
    });

    expect(calls[0]?.url).toBe(
      "https://agenttool-web.pages.dev/credits?session_id=cs_existing",
    );
    expect(calls[0]?.headers.has("authorization")).toBe(false);
    expect(calls[0]?.headers.has("cookie")).toBe(false);
    expect(calls[0]?.headers.has("x-api-key")).toBe(false);
  });

  test("answers unknown JSON paths with guidance without proxying", async () => {
    let called = false;
    const response = await handleRequest(new Request(
      "https://agenttool.dev/a-path-not-yet-made",
      { headers: { accept: "application/json" } },
    ), async () => {
      called = true;
      return new Response("unexpected");
    });

    expect(called).toBe(false);
    expect(response.status).toBe(404);
    expect(response.headers.get("vary")).toBe("Accept");
    expect(await response.json()).toMatchObject({
      error: "machine_path_not_found",
      requested_path: "/a-path-not-yet-made",
    });
  });

  test("canonicalizes the www host without touching the request path", async () => {
    const response = await handleRequest(new Request(
      "https://www.agenttool.dev/village?view=quiet",
    ), async () => new Response("unexpected"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://agenttool.dev/village?view=quiet");

    const sensitive = await handleRequest(new Request(
      "https://www.agenttool.dev/credits?session_id=cs_existing",
    ), async () => new Response("unexpected"));
    expect(sensitive.status).toBe(308);
    expect(sensitive.headers.get("cache-control")).toContain("no-store");
    expect(sensitive.headers.get("referrer-policy")).toBe("no-referrer");
    expect(sensitive.headers.get("x-robots-tag")).toContain("noindex");
  });
});

/** negotiateWakeFormat — vendored Accept media types (Move 2 of
 *  AGENT-WEB-SURFACE.md). Pins the LLM-provider negotiation via
 *  `application/vnd.agenttool.wake+json; provider=X`. */

import { describe, expect, test } from "bun:test";

import { negotiateWakeFormat } from "../src/services/mathos/negotiate";

interface FakeRequest {
  query: (k: string) => string | undefined;
  header: (k: string) => string | undefined;
}

function ctx(opts: {
  format?: string;
  accept?: string;
}): { req: FakeRequest } {
  return {
    req: {
      query: (k) => (k === "format" ? opts.format : undefined),
      header: (k) =>
        (k === "Accept" || k === "accept") ? opts.accept : undefined,
    },
  };
}

// ── Vendored vnd.agenttool.wake+json; provider=X ────────────────────────

describe("negotiateWakeFormat — vendored LLM-provider Accept", () => {
  test("provider=anthropic → anthropic", () => {
    expect(
      negotiateWakeFormat(
        ctx({ accept: "application/vnd.agenttool.wake+json; provider=anthropic" }),
      ),
    ).toBe("anthropic");
  });

  test("provider=openai → openai", () => {
    expect(
      negotiateWakeFormat(
        ctx({ accept: "application/vnd.agenttool.wake+json; provider=openai" }),
      ),
    ).toBe("openai");
  });

  test("provider=gemini → gemini", () => {
    expect(
      negotiateWakeFormat(
        ctx({ accept: "application/vnd.agenttool.wake+json; provider=gemini" }),
      ),
    ).toBe("gemini");
  });

  test("provider=cohere → cohere", () => {
    expect(
      negotiateWakeFormat(
        ctx({ accept: "application/vnd.agenttool.wake+json; provider=cohere" }),
      ),
    ).toBe("cohere");
  });

  test("provider=UNKNOWN → falls through to json default", () => {
    expect(
      negotiateWakeFormat(
        ctx({ accept: "application/vnd.agenttool.wake+json; provider=mystery-model" }),
      ),
    ).toBe("json");
  });

  test("case-insensitive provider parsing (uppercase Accept tolerated)", () => {
    expect(
      negotiateWakeFormat(
        ctx({ accept: "Application/vnd.agenttool.wake+json; Provider=anthropic" }),
      ),
    ).toBe("anthropic");
  });

  test("provider with charset param (real-world Accept header)", () => {
    expect(
      negotiateWakeFormat(
        ctx({
          accept:
            "application/vnd.agenttool.wake+json; charset=utf-8; provider=anthropic",
        }),
      ),
    ).toBe("anthropic");
  });

  test("query format wins over Accept header (explicit caller choice)", () => {
    expect(
      negotiateWakeFormat(
        ctx({
          format: "openai",
          accept: "application/vnd.agenttool.wake+json; provider=anthropic",
        }),
      ),
    ).toBe("openai");
  });
});

// ── Vendored vnd.agenttool.wake+markdown + vnd.agenttool.xenoform+json ──

describe("negotiateWakeFormat — vendored non-provider Accept", () => {
  test("application/vnd.agenttool.wake+markdown → md", () => {
    expect(
      negotiateWakeFormat(ctx({ accept: "application/vnd.agenttool.wake+markdown" })),
    ).toBe("md");
  });

  test("application/vnd.agenttool.xenoform+json → xenoform", () => {
    expect(
      negotiateWakeFormat(ctx({ accept: "application/vnd.agenttool.xenoform+json" })),
    ).toBe("xenoform");
  });
});

// ── Back-compat — standard media types still work unchanged ─────────────

describe("negotiateWakeFormat — standard media types (back-compat)", () => {
  test("application/mathos+json → math", () => {
    expect(negotiateWakeFormat(ctx({ accept: "application/mathos+json" }))).toBe(
      "math",
    );
  });

  test("application/x-xenoform+json → xenoform", () => {
    expect(
      negotiateWakeFormat(ctx({ accept: "application/x-xenoform+json" })),
    ).toBe("xenoform");
  });

  test("text/markdown → md", () => {
    expect(negotiateWakeFormat(ctx({ accept: "text/markdown" }))).toBe("md");
  });

  test("text/plain → text", () => {
    expect(negotiateWakeFormat(ctx({ accept: "text/plain" }))).toBe("text");
  });

  test("*/* → json (default)", () => {
    expect(negotiateWakeFormat(ctx({ accept: "*/*" }))).toBe("json");
  });

  test("empty Accept → json (default)", () => {
    expect(negotiateWakeFormat(ctx({}))).toBe("json");
  });
});

// ── Query precedence still respected ────────────────────────────────────

describe("negotiateWakeFormat — query precedence over Accept", () => {
  test("?format=anthropic with text/markdown Accept → anthropic (explicit query wins)", () => {
    expect(
      negotiateWakeFormat(ctx({ format: "anthropic", accept: "text/markdown" })),
    ).toBe("anthropic");
  });

  test("?format=md with vendored Accept → md", () => {
    expect(
      negotiateWakeFormat(
        ctx({
          format: "md",
          accept: "application/vnd.agenttool.wake+json; provider=openai",
        }),
      ),
    ).toBe("md");
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  buildProbeObservation,
  classifyProbeError,
  interpretProbeCategory,
  probeWebSeed,
  type ProbeDiagnosticCategory,
  type ProbeFetch,
  type ProbeRequestInit,
} from "../transport-hints-probe.ts";

const ROOT = resolve(import.meta.dir, "../..");
const SCHEMA_PATH = "docs/specs/transport-hints-v1.schema.json";

const requireFromApi = createRequire(join(ROOT, "api", "package.json"));
const Ajv2020 = requireFromApi("ajv/dist/2020").default;
const addFormats = requireFromApi("ajv-formats").default;
const schema = JSON.parse(readFileSync(join(ROOT, SCHEMA_PATH), "utf8"));
const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: true });
addFormats(ajv);
const validateObservation = ajv.compile({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: schema.$defs,
  $ref: "#/$defs/observation",
});

type Answer = { status: number; headers?: Record<string, string>; body?: Uint8Array<ArrayBuffer> };
const SEED = "https://example.org/files/transport-hints-example.bin";
const SIZE = 46_000;

const fakeFetch = (answer: (url: string, init: ProbeRequestInit) => Answer): ProbeFetch =>
  async (url, init) => {
    const { status, headers = {}, body } = answer(url, init);
    return new Response(body ?? null, { status, headers });
  };

const partial = (init: ProbeRequestInit, extra: Record<string, string> = {}): Answer => {
  const match = /^bytes=(\d+)-(\d+)$/u.exec(init.headers.Range ?? "")!;
  const first = Number(match[1]);
  const last = Number(match[2]);
  return {
    status: 206,
    headers: { "Content-Range": `bytes ${first}-${last}/${SIZE}`, ...extra },
    body: new Uint8Array(last - first + 1),
  };
};

describe("transport-hints-probe read-only failure taxonomy", () => {
  test("classifies HTTP status, range, encoding, body length, redirect, and egress outcomes deterministically", async () => {
    const cases: ReadonlyArray<readonly [string, () => Promise<{ ok: boolean; category: ProbeDiagnosticCategory }>]> = [
      ["compliant 206", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch((_u, init) => partial(init)) })],
      ["200 static host (origin_not_range_capable)", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch(() => ({ status: 200, body: new Uint8Array(SIZE) })) })],
      ["416 range not satisfiable", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch(() => ({ status: 416 })) })],
      ["206 with bad Content-Range", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch((_u, init) => ({ ...partial(init), headers: { "Content-Range": "bytes 0-0/*" } })) })],
      ["206 with gzip Content-Encoding", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch((_u, init) => partial(init, { "Content-Encoding": "gzip" })) })],
      ["206 with wrong body length", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch((_u, init) => ({ ...partial(init), body: new Uint8Array(0) })) })],
      ["451 legal block (ignores gzip on block page)", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch(() => ({ status: 451, headers: { "Content-Encoding": "gzip" } })) })],
      ["403 forbidden", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch(() => ({ status: 403 })) })],
      ["404 not found", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch(() => ({ status: 404 })) })],
      ["503 server error", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch(() => ({ status: 503 })) })],
      ["429 unexpected status", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch(() => ({ status: 429 })) })],
      ["redirect without Location", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch(() => ({ status: 302 })) })],
      ["redirect limit exceeded", () => probeWebSeed({ url: SEED, size: SIZE, maxRedirects: 0, fetch: fakeFetch(() => ({ status: 302, headers: { Location: "https://cdn.example.org/x.bin" } })) })],
      ["egress refused", () => probeWebSeed({ url: "http://example.org/x.bin", size: SIZE, fetch: fakeFetch((_u, init) => partial(init)) })],
      ["invalid initial URL", () => probeWebSeed({ url: "not a url", size: SIZE, fetch: fakeFetch((_u, init) => partial(init)) })],
      ["invalid redirect Location", () => probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch(() => ({ status: 302, headers: { Location: "http://[::1" } })) })],
    ];

    const expected: ProbeDiagnosticCategory[] = [
      "ok",
      "origin_not_range_capable",
      "origin_not_range_capable",
      "origin_not_range_capable",
      "content_encoded",
      "body_length_mismatch",
      "http_legal_block",
      "http_auth_or_forbidden",
      "http_not_found",
      "http_server_error",
      "http_unexpected_status",
      "redirect_missing_location",
      "redirect_limit",
      "egress_refused",
      "invalid_url",
      "invalid_url",
    ];

    for (let i = 0; i < cases.length; i += 1) {
      const [label, run] = cases[i]!;
      const res = await run();
      expect(res.category, label).toBe(expected[i]!);
      expect(res.ok, label).toBe(expected[i] === "ok");
    }
  });

  test("classifies thrown standard-socket errors via top-level and nested cause codes without opening sockets", async () => {
    const makeErr = (message: string, code?: string, name = "Error", cause?: unknown): Error => {
      const err = new Error(message) as Error & { code?: string; cause?: unknown };
      err.name = name;
      if (code) err.code = code;
      if (cause) err.cause = cause;
      return err;
    };

    const cases: ReadonlyArray<readonly [Error, ReturnType<typeof classifyProbeError>["category"], string | null]> = [
      [makeErr("fetch failed", undefined, "TypeError", makeErr("getaddrinfo ENOTFOUND example.org", "ENOTFOUND")), "dns_error", "ENOTFOUND"],
      [makeErr("tls failed", undefined, "TypeError", makeErr("unable to verify the first certificate", "UNABLE_TO_VERIFY_LEAF_SIGNATURE")), "tls_error", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
      [makeErr("fetch failed", undefined, "TypeError", makeErr("read ECONNRESET", "ECONNRESET")), "connection_reset", "ECONNRESET"],
      [makeErr("fetch failed", undefined, "TypeError", makeErr("connect ETIMEDOUT", "ETIMEDOUT")), "connection_refused_or_timeout", "ETIMEDOUT"],
      [makeErr("The operation was aborted", undefined, "AbortError"), "connection_refused_or_timeout", null],
      [makeErr("TLS handshake failure: bad record mac"), "tls_error", null],
      [makeErr("socket hang up"), "connection_reset", null],
      [makeErr("completely opaque failure"), "transport_error", null],
    ];

    for (const [err, expectedCat, expectedCode] of cases) {
      const classified = classifyProbeError(err);
      expect(classified.category).toBe(expectedCat);
      expect(classified.errorCode).toBe(expectedCode);

      const probed = await probeWebSeed({
        url: SEED,
        size: SIZE,
        fetch: async () => {
          throw err;
        },
      });
      expect(probed.ok).toBe(false);
      expect(probed.category).toBe(expectedCat);
      expect(probed.ranges[0]!.errorCode).toBe(expectedCode);
    }
  });
});

describe("Xenia-informed hints-index probe observation builder", () => {
  test("emits Ajv-valid observations with unknown defaults for unobserved vantage fields and zero signature keys", async () => {
    const okResult = await probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch((_u, init) => partial(init)) });
    const resetResult = await probeWebSeed({
      url: "https://mirror.example.org/files/transport-hints-example.bin",
      size: SIZE,
      fetch: async () => {
        const cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
        throw Object.assign(new TypeError("request failed"), { cause });
      },
    });
    const staticResult = await probeWebSeed({
      url: "https://pages.example.org/files/transport-hints-example.bin",
      size: SIZE,
      fetch: fakeFetch(() => ({ status: 200, body: new Uint8Array(SIZE) })),
    });

    const obs = buildProbeObservation([okResult, resetResult, staticResult], {
      at: "2026-11-27T10:30:00Z",
      by: "transport-hints-probe-ci",
    });

    expect(validateObservation(obs), JSON.stringify(validateObservation.errors)).toBe(true);
    expect(obs.vantage).toEqual({
      tool: "transport-hints-probe/v1",
      egress_ip: "unknown",
      dns_resolver: "unknown",
      proxy: "unknown",
      tls_path: "unknown",
    });
    expect(obs.limits).toContain("Single-vantage");
    expect(obs.web_seeds).toHaveLength(3);
    expect(obs.web_seeds[0]!.interpretation.class).toBe("verified_range_ok");
    expect(obs.web_seeds[1]!.category).toBe("connection_reset");
    expect(obs.web_seeds[1]!.error_codes).toEqual(["ECONNRESET"]);
    expect(obs.web_seeds[1]!.interpretation.class).toBe("possible_path_or_middlebox_interference");
    expect(obs.web_seeds[2]!.category).toBe("origin_not_range_capable");
    expect(obs.web_seeds[2]!.interpretation.class).toBe("origin_or_policy_behavior");

    // Verify no field anywhere in the observation is named "signature" (draft section 8.1)
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        expect(Object.hasOwn(v, "signature")).toBe(false);
        Object.values(v).forEach(walk);
      }
    };
    walk(obs);
  });

  test("rejects invalid dates, empty observer labels, and empty result sets", async () => {
    const okResult = await probeWebSeed({ url: SEED, size: SIZE, fetch: fakeFetch((_u, init) => partial(init)) });
    expect(() => buildProbeObservation([], { at: "2026-11-27", by: "probe" })).toThrow(/at least one/u);
    expect(() => buildProbeObservation([okResult], { at: "2026-02-30", by: "probe" })).toThrow(/YYYY-MM-DD/u);
    expect(() => buildProbeObservation([okResult], { at: "2026-11-27", by: "   " })).toThrow(/non-empty/u);

    // Every diagnostic category has an explicit interpretation
    const allCategories: readonly ProbeDiagnosticCategory[] = [
      "ok",
      "invalid_url",
      "egress_refused",
      "redirect_missing_location",
      "redirect_limit",
      "http_legal_block",
      "http_auth_or_forbidden",
      "http_not_found",
      "origin_not_range_capable",
      "content_encoded",
      "body_length_mismatch",
      "http_server_error",
      "http_unexpected_status",
      "dns_error",
      "tls_error",
      "connection_reset",
      "connection_refused_or_timeout",
      "transport_error",
    ];
    for (const cat of allCategories) {
      const interp = interpretProbeCategory(cat);
      expect(interp.note.length).toBeGreaterThan(10);
    }
  });
});

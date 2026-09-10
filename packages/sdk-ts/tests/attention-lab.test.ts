import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import {
  AgentTool, AgentToolError, AttentionLabClient, ATTENTION_LAB_BASE_URL,
  ATTENTION_LAB_MAX_REQUEST_BYTES, ATTENTION_LAB_MAX_RESPONSE_BYTES,
  type AttentionLabBriefInput, type AttentionLabCatalogueResult, type AttentionLabComparisonInput, type AttentionLabOptions,
} from "../src/index.js";
import golden from "./fixtures/attention-lab-v1.json";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const briefInput = golden.briefInput as AttentionLabBriefInput;
const comparisonInput = golden.comparisonInput as AttentionLabComparisonInput;
const envelope = (data: unknown) => ({ success: true, data });
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const wire = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "content-type": "application/json", ...headers } });

async function serve<T>(handler: (request: Request) => Response | Promise<Response>, operation: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  try { return await operation(server.url.origin); } finally { server.stop(true); }
}
const client = (baseUrl: string, options: AttentionLabOptions = {}) =>
  new AttentionLabClient({ baseUrl, allowLoopbackHttp: true, ...options });
async function caught(operation: Promise<unknown>): Promise<AgentToolError> {
  try { await operation; } catch (error) {
    expect(error).toBeInstanceOf(AgentToolError);
    return error as AgentToolError;
  }
  throw new Error("預期 operation 被拒絕。");
}
async function responseError(body: BodyInit, headers: Record<string, string> = {}): Promise<AgentToolError> {
  return serve(() => wire(body, headers), (baseUrl) => caught(client(baseUrl).catalogue()));
}
async function briefError(mutate: (value: any) => void): Promise<AgentToolError> {
  const value = structuredClone(golden.brief);
  mutate(value);
  return serve(() => json(envelope(value)), (baseUrl) => caught(client(baseUrl).buildBrief(briefInput)));
}

/** 真 loopback HTTP，唔借 public options 開任意 injected transport seam。 */
async function rawHttp(raw: string): Promise<AgentToolError> {
  const server = createServer((socket) => socket.once("data", () => socket.end(raw)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("需要 loopback port。");
    return await caught(client(`http://127.0.0.1:${address.port}`, { timeout: 0.3 }).catalogue());
  } finally { server.close(); }
}

describe("Attention Lab public 邊界", () => {
  test("constructor／lazy namespace 唔連線，獨立 default origin 同 bounds", () => {
    globalThis.fetch = (async () => { throw new Error("唔應該 fetch"); }) as typeof fetch;
    expect(ATTENTION_LAB_BASE_URL).toBe("https://fomoengine.io");
    expect(ATTENTION_LAB_MAX_REQUEST_BYTES).toBe(65536);
    expect(ATTENTION_LAB_MAX_RESPONSE_BYTES).toBe(524288);
    expect(new AttentionLabClient()).toBeInstanceOf(AttentionLabClient);
    const at = new AgentTool({ apiKey: "at_sentinel", baseUrl: "https://hosted.invalid", timeout: 999 });
    expect(at.attentionLab).toBeInstanceOf(AttentionLabClient);
    expect(at.attentionLab).toBe(at.attentionLab);
    const invalid = new AgentTool({ apiKey: "at_sentinel", attentionLab: { timeout: 11 } });
    expect(() => invalid.attentionLab).toThrow(AgentToolError);
  });

  test("三個 operation 真 public transport，bearer/cookie/hosted transport sentinel 唔轉送", async () => {
    let calls = 0;
    let hostedCalls = 0;
    let globalCalls = 0;
    const received: Array<{ path: string; method: string; headers: Headers; body: string }> = [];
    globalThis.fetch = (async () => { globalCalls++; throw new Error("cookie=ambient-cookie-sentinel"); }) as typeof fetch;
    await serve(async (request) => {
      calls++;
      const path = new URL(request.url).pathname;
      received.push({ path, method: request.method, headers: request.headers, body: await request.text() });
      const data = path.endsWith("/catalogue") ? golden.catalogue : path.endsWith("/briefs") ? golden.brief : golden.comparison;
      return json(envelope(data), 200, { "set-cookie": "attention_cookie_sentinel=must-not-return; Path=/" });
    }, async (baseUrl) => {
      const at = new AgentTool({
        apiKey: "at_bearer_sentinel", baseUrl: "https://hosted.invalid", timeout: 0.001,
        attentionLab: { baseUrl, allowLoopbackHttp: true },
      });
      expect(calls).toBe(0);
      const lab = at.attentionLab;
      expect(calls).toBe(0);
      expect(await lab.catalogue()).toEqual(golden.catalogue);
      expect(await lab.buildBrief(briefInput)).toEqual(golden.brief);
      expect(await lab.compare(comparisonInput)).toEqual(golden.comparison);
      const brokered = new AgentTool({
        transport: { request: async () => { hostedCalls++; throw new Error("auth-cookie-sentinel"); } },
        attentionLab: { baseUrl, allowLoopbackHttp: true },
      });
      expect(await brokered.attentionLab.catalogue()).toEqual(golden.catalogue);
    });
    expect(calls).toBe(4);
    expect(hostedCalls).toBe(0);
    expect(globalCalls).toBe(0);
    expect(received.map(({ path, method }) => [path, method])).toEqual([
      ["/api/v1/attention-lab/catalogue", "GET"], ["/api/v1/attention-lab/briefs", "POST"],
      ["/api/v1/attention-lab/comparisons", "POST"], ["/api/v1/attention-lab/catalogue", "GET"],
    ]);
    expect(JSON.parse(received[1]!.body)).toEqual(briefInput);
    expect(JSON.parse(received[2]!.body)).toEqual(comparisonInput);
    expect(received[0]!.body).toBe("");
    for (const { headers } of received) {
      for (const key of ["authorization", "cookie", "proxy-authorization", "referer", "x-agenttool-client", "payment-signature"]) expect(headers.has(key)).toBe(false);
      expect(headers.get("accept-encoding")).toBe("identity");
      expect(JSON.stringify([...headers.entries()])).not.toContain("sentinel");
    }
  });

  test.each([
    { baseUrl: "http://127.0.0.1:9999" }, { baseUrl: "http://example.test", allowLoopbackHttp: true },
    { baseUrl: "http://127.1", allowLoopbackHttp: true }, { baseUrl: "http://2130706433", allowLoopbackHttp: true },
    { baseUrl: "ftp://example.test" }, { baseUrl: "https://user:sentinel@example.test" },
    { baseUrl: "https://@example.test" }, { baseUrl: "https://example.test/path" },
    { baseUrl: "https://example.test/." }, { baseUrl: "https://example.test?" }, { baseUrl: "https://example.test#" },
    { baseUrl: "https://example.test\\path" }, { baseUrl: " https://example.test" }, { baseUrl: "https://exam\nple.test" },
    { baseUrl: null }, { timeout: 0 }, { timeout: -1 }, { timeout: Infinity }, { timeout: NaN }, { timeout: 10.01 },
    { maxResponseBytes: 0 }, { maxResponseBytes: 524289 }, { maxResponseBytes: 1.5 },
    { maxRequestBytes: 65537 }, { maxRequestBytes: null }, { allowLoopbackHttp: "true" },
    { token: "sentinel" }, { headers: { cookie: "sentinel" } }, { transport: {} }, { fetch: () => {} },
  ])("拒絕未授權／錯類型 options %#", (options) => {
    try { new AttentionLabClient(options as never); throw new Error("預期失敗"); } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      expect((error as AgentToolError).code).toBe("attention_lab_invalid_options");
      expect(JSON.stringify(error)).not.toContain("sentinel");
    }
  });

  test.each(["http://localhost:4000", "http://127.0.0.1:4000", "http://[::1]:4000", "https://self-host.example.test/"])("明確 origin 唔做 constructor fetch %s", (baseUrl) => {
    expect(() => new AttentionLabClient({ baseUrl, allowLoopbackHttp: true })).not.toThrow();
  });

  test.each([300, 301, 302, 303, 307, 308])("redirect %i 唔跟隨亦唔 retry", async (status) => {
    const paths: string[] = [];
    const error = await serve((request) => {
      paths.push(new URL(request.url).pathname);
      return new Response(null, { status, headers: { location: "/cookie-sentinel-trap" } });
    }, (baseUrl) => caught(client(baseUrl).catalogue()));
    expect(error.code).toBe("attention_lab_redirect_refused");
    expect(error.status).toBe(status);
    expect(paths).toEqual(["/api/v1/attention-lab/catalogue"]);
  });

  test.each([201, 202, 204, 206, 400, 413, 415, 422, 429, 500, 502, 503])("status %i 只回 sanitized error，唔借 error body 引入指令", async (status) => {
    let calls = 0;
    const error = await serve(() => {
      calls++;
      return new Response(status === 204 ? null : "raw-body-sentinel", {
        status, headers: { "retry-after": "raw-header-sentinel", "payment-required": "payment-sentinel" },
      });
    }, (baseUrl) => caught(client(baseUrl).catalogue()));
    expect(calls).toBe(1);
    expect(error.code).toBe(status === 429 ? "attention_lab_rate_limited" : "attention_lab_http_error");
    expect(error.status).toBe(status);
    expect(error.details).toBeUndefined();
    expect(error.paymentRequired).toBeUndefined();
    expect(error.retryAfter).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("sentinel");
  });
});

describe("Attention Lab bytes／deadline", () => {
  test.each([
    ["UTF8", Uint8Array.of(0xff)], ["截斷 UTF8", Uint8Array.of(0xe4, 0xb8)],
    ["BOM", Uint8Array.of(0xef, 0xbb, 0xbf, 123, 125)], ["JSON", "{"],
    ["duplicate", '{"success":true,"success":true,"data":{}}'],
    ["escaped duplicate", '{"success":true,"succ\\u0065ss":true,"data":{}}'],
    ["lone surrogate", '{"x":"\\ud800"}'], ["nonfinite", '{"x":1e999}'],
    ["depth", "[".repeat(33) + "null" + "]".repeat(33)], ["大量 nodes 仍須驗 envelope", JSON.stringify(Array(50001).fill(0))],
  ])("拒絕 malformed %s", async (_name, body) => {
    expect((await responseError(body as BodyInit)).code).toBe("attention_lab_invalid_response");
  });

  test.each(["text/plain", "application/problem+json", "application/json; charset=latin1", "application/json; profile=x", "application/json; charset=utf-8; charset=utf-8"])("拒絕 media %s", async (media) => {
    expect((await responseError("{}", { "content-type": media })).code).toBe("attention_lab_unsupported_media_type");
  });

  test("拒絕 unexpected compression", async () => {
    const error = await responseError(Bun.gzipSync(JSON.stringify(envelope(golden.catalogue))), { "content-encoding": "gzip" });
    expect(error.code).toBe("attention_lab_invalid_response");
  });

  test("declared 同 actual streamed cap 都生效，唔靠 Content-Length", async () => {
    const declared = await serve(() => json(envelope(golden.catalogue)), (baseUrl) => caught(client(baseUrl, { maxResponseBytes: 1 }).catalogue()));
    expect(declared.code).toBe("attention_lab_response_too_large");
    const actual = await serve(() => wire(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(300000)); controller.enqueue(new Uint8Array(224289)); controller.close();
    } })), (baseUrl) => caught(client(baseUrl).catalogue()));
    expect(actual.code).toBe("attention_lab_response_too_large");
  });

  test("超過 50k nodes 嘅合法閉合 catalogue 必須按 byte ceiling 接受", async () => {
    const sourceIds = Array.from({ length: 64 }, (_, index) => `s${index}`);
    const claim = (id: string) => ({
      id, text: "x", kind: "hypothesis" as const, sourceIds, context: "x", limitations: ["x"],
    });
    const data: AttentionLabCatalogueResult = {
      schemaVersion: 1,
      engineVersion: "1.0.0",
      catalogueVersion: "historical-dense-catalogue",
      catalogueDigest: `sha256:${"a".repeat(64)}`,
      sources: sourceIds.map((id) => ({
        id, title: "x", url: `https://example.test/${id}`, publisher: "x", publishedAt: null,
        reviewedAt: "2026-09-08", context: "x", retrievalLimitations: "x",
      })),
      platforms: [{
        id: "p0", name: "x", channel: "social", surface: "x", kind: "ranked-surface",
        summary: "x", rankingDisclosure: "x", signals: [claim("platform-claim")], practicalChoices: [],
        metric: { name: "x", numerator: "x", denominator: "x", caveat: "x" },
        qualityGuardrails: [], confounders: [], sourceIds,
      }],
      mechanisms: Array.from({ length: 24 }, (_, index) => ({
        id: `m${index}`, name: "x", summary: "x", emotion: "x", howItWorks: [],
        example: { honest: "x", pressure: "x", distinction: "x" },
        claims: Array.from({ length: 30 }, (_, claimIndex) => claim(`m${index}-c${claimIndex}`)),
        honestUse: [], countermeasure: "x", tradeoffs: [],
        experiment: { question: "x", variable: "x", control: "x", treatment: "x", holdConstant: [], readout: "x", limitations: "x" },
        compatiblePlatformIds: ["p0"], sourceIds,
      })),
    };
    const countNodes = (value: unknown): number => 1 + (typeof value === "object" && value !== null
      ? Object.values(value).reduce<number>((sum, entry) => sum + countNodes(entry), 0) : 0);
    const bytes = new TextEncoder().encode(JSON.stringify(envelope(data)));
    expect(countNodes(envelope(data))).toBeGreaterThan(50_000);
    expect(bytes.byteLength).toBeLessThan(ATTENTION_LAB_MAX_RESPONSE_BYTES);
    // 真 HTTP byte stream；caller 收窄到 exact bytes，都唔應該觸發另一個任意 node quota。
    await serve(() => wire(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 100_000)); controller.enqueue(bytes.subarray(100_000)); controller.close();
    } })), async (baseUrl) => {
      expect(await client(baseUrl, { maxResponseBytes: bytes.byteLength }).catalogue()).toEqual(data);
    });
  });

  test("512 KiB exact streamed response 可以完整解析，唔截斷", async () => {
    const data = JSON.stringify(envelope(golden.catalogue));
    const encoded = new TextEncoder().encode(data);
    const padding = new Uint8Array(ATTENTION_LAB_MAX_RESPONSE_BYTES - encoded.byteLength).fill(32);
    await serve(() => wire(new ReadableStream({ start(controller) {
      controller.enqueue(encoded); controller.enqueue(padding); controller.close();
    } })), async (baseUrl) => { expect(await client(baseUrl).catalogue()).toEqual(golden.catalogue); });
  });

  test("最大欄位界線嘅三byte Unicode inputs 唔超預設request cap", async () => {
    const largeBrief = { ...briefInput, evidenceStatus: "provided" as const };
    for (const [key, size] of Object.entries({ topic: 200, audience: 600, takeaway: 1000, action: 300, evidence: 4000, constraints: 2000, verifiedProof: 2000, realLimit: 500, limitReason: 500, terms: 2000 })) {
      (largeBrief as Record<string, unknown>)[key] = "界".repeat(size);
    }
    const largeComparison = structuredClone(comparisonInput) as any;
    for (const [key, size] of Object.entries({ allocation: 2000, eligibility: 2000, stoppingRule: 2000, guardrailPlan: 3000, guardrailResults: 4000 })) largeComparison.plan[key] = "界".repeat(size);
    for (const [key, size] of Object.entries({ name: 300, numerator: 1600, denominator: 1600, caveat: 3000 })) largeComparison.metric[key] = "界".repeat(size);
    for (const key of Object.keys(largeComparison.counts)) largeComparison.counts[key] = "0".repeat(32);
    let calls = 0;
    await serve(async (request) => {
      calls++;
      const body = await request.arrayBuffer();
      expect(body.byteLength).toBeLessThan(65536);
      return json(envelope(new URL(request.url).pathname.endsWith("/briefs") ? golden.brief : golden.zeroDenominatorComparison));
    }, async (baseUrl) => {
      await client(baseUrl).buildBrief(largeBrief);
      await client(baseUrl).compare(largeComparison);
    });
    expect(calls).toBe(2);
  });

  test("UTF8 encoded request cap 係 bytes，equal boundary 可用，超一 byte 唔送", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(comparisonInput)).length;
    let calls = 0;
    await serve(() => { calls++; return json(envelope(golden.comparison)); }, async (baseUrl) => {
      expect(await client(baseUrl, { maxRequestBytes: bytes }).compare(comparisonInput)).toEqual(golden.comparison);
      expect((await caught(client(baseUrl, { maxRequestBytes: bytes - 1 }).compare(comparisonInput))).code).toBe("attention_lab_request_too_large");
      expect((await caught(client(baseUrl).buildBrief({ ...briefInput, constraints: "界".repeat(23000) }))).code).toBe("attention_lab_request_too_large");
    });
    expect(calls).toBe(1);
  });

  test.each(["-1", "01", "9007199254740992"])("拒絕 malformed Content-Length %s", async (length) => {
    const error = await rawHttp(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${length}\r\nConnection: close\r\n\r\n{}`);
    expect(["attention_lab_invalid_response", "attention_lab_unreachable"]).toContain(error.code);
    expect(JSON.stringify(error)).not.toContain("Content-Length");
  });

  test("錯報 Content-Length 唔會變成功", async () => {
    const error = await rawHttp("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 40\r\nConnection: close\r\n\r\n{}");
    expect(error.code).toBe("attention_lab_invalid_response");
  });

  test.each(["headers", "body"])("whole-operation deadline 涵蓋永遠 stalled %s", async (part) => {
    let calls = 0;
    const started = performance.now();
    const error = await serve(() => {
      calls++;
      if (part === "headers") return new Promise<Response>(() => {});
      return wire(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } }));
    }, (baseUrl) => caught(client(baseUrl, { timeout: 0.04 }).catalogue()));
    expect(error.code).toBe("attention_lab_timeout");
    expect(performance.now() - started).toBeLessThan(1000);
    expect(calls).toBe(1);
  });
});

describe("Attention Lab exact DTO／snapshot", () => {
  test.each([
    ["brief", golden.brief], ["social-proof blocked", golden.blockedBriefs.socialProof], ["scarcity blocked", golden.blockedBriefs.scarcity],
  ])("完整 producer golden %s 原樣保留", async (_label, result) => {
    await serve(() => json(envelope(result)), async (baseUrl) => {
      const returned = await client(baseUrl).buildBrief(briefInput);
      expect(returned).toEqual(result);
      expect(returned.sources[0]!.retrievalLimitations).toBeTruthy();
      expect(returned.claims[0]!.limitations.length).toBeGreaterThan(0);
    });
  });

  test.each([
    ["rates", golden.comparison], ["incomplete", golden.incompleteComparison],
    ["zero denominator", golden.zeroDenominatorComparison], ["zero baseline", golden.zeroBaselineComparison],
  ])("counts 同 null semantics %s 唔做 client 重算", async (_label, result) => {
    await serve(() => json(envelope(result)), async (baseUrl) => {
      expect(await client(baseUrl).compare(comparisonInput)).toEqual(result);
    });
    expect(golden.comparison.comparison.percentagePointDifference).toBeCloseTo(5);
  });

  test("歷史 snapshot 新ID／removed current source 都以自身 references 驗", async () => {
    const value = structuredClone(golden.brief);
    value.mechanism.id = value.brief.input.mechanismId = "historical-mechanism";
    value.platform.id = value.brief.input.platformId = "retired-platform";
    const old = value.sources[0]!.id;
    const next = "archived-source";
    value.sources[0]!.id = next;
    value.brief.sourceIds = value.brief.sourceIds.map((id) => id === old ? next : id);
    for (const claim of value.claims) claim.sourceIds = claim.sourceIds.map((id) => id === old ? next : id);
    await serve(() => json(envelope(value)), async (baseUrl) => {
      const result = await client(baseUrl).buildBrief(briefInput);
      expect(result).toEqual(value);
      expect(result.markdown).toBe(golden.brief.markdown);
    });
  });

  test.each([
    ["root unknown", (v: any) => { v.extra = 1; }],
    ["nested unknown", (v: any) => { v.brief.experiment.winner = "A"; }],
    ["type", (v: any) => { v.brief.experiment.blocked = "false"; }],
    ["digest", (v: any) => { v.catalogueDigest = "sha256:bad"; }],
    ["missing source", (v: any) => { v.sources.pop(); }],
    ["duplicate source", (v: any) => { v.sources.push(v.sources[0]); }],
    ["missing claim", (v: any) => { v.claims.pop(); }],
    ["claim ref", (v: any) => { v.claims[0].sourceIds = ["absent"]; }],
    ["selection ref", (v: any) => { v.platform.claimIds = ["absent"]; }],
    ["selection id", (v: any) => { v.mechanism.id = "wrong"; }],
    ["date", (v: any) => { v.sources[0].reviewedAt = "2026-02-30"; }],
    ["publication month", (v: any) => { v.sources[0].publishedAt = "2026-13"; }],
    ["source userinfo", (v: any) => { v.sources[0].url = "https://secret:sentinel@example.test"; }],
    ["attestation", (v: any) => { v.brief.input.nonpoliticalConfirmed = false; }],
    ["UTF16 bound", (v: any) => { v.brief.input.topic = "𠮷".repeat(101); }],
    ["version type", (v: any) => { v.engineVersion = 1; }],
    ["array bound", (v: any) => { v.brief.sections = Array(21).fill({ heading: "", body: "" }); }],
  ])("拒絕 snapshot %s", async (_label, mutate) => {
    expect((await briefError(mutate as (value: any) => void)).code).toBe("attention_lab_invalid_response");
  });

  test("schemaVersion 不支援唔 silently reinterpret", async () => {
    expect((await briefError((value) => { value.schemaVersion = 2; })).code).toBe("attention_lab_unsupported_schema_version");
  });

  test.each([null, [], {}, { success: "true", data: golden.catalogue }, { success: true, data: golden.catalogue, extra: true },
    { success: true, data: null }, { success: false, error: { code: "sentinel", message: "sentinel" } }].map((value) => [value] as const))("拒絕 malformed envelope %#", async (value) => {
    const error = await responseError(JSON.stringify(value));
    expect(error.code).toBe("attention_lab_invalid_response");
    expect(JSON.stringify(error)).not.toContain("sentinel");
  });

  test("catalogue references 唔止驗rootshape", async () => {
    const value = structuredClone(golden.catalogue);
    value.mechanisms[0]!.compatiblePlatformIds = ["absent"];
    const error = await responseError(JSON.stringify(envelope(value)));
    expect(error.code).toBe("attention_lab_invalid_response");
  });

  test("null／rate型別／unsafe counts 回應錯配被拒", async () => {
    for (const mutate of [
      (v: any) => { v.comparison = null; }, (v: any) => { v.comparison.aRate = null; },
      (v: any) => { v.comparison.aRate = "0.1"; }, (v: any) => { v.comparison.bRate = 2; },
      (v: any) => { v.counts.aOutcomes = "9007199254740992"; },
      (v: any) => { v.counts.aEligible = ""; },
    ]) {
      const value = structuredClone(golden.comparison); mutate(value);
      const error = await serve(() => json(envelope(value)), (baseUrl) => caught(client(baseUrl).compare(comparisonInput)));
      expect(error.code).toBe("attention_lab_invalid_response");
    }
  });

  test("unpaired surrogate request 只回 stable invalid_request，唔送去 server", async () => {
    let calls = 0;
    await serve(() => { calls++; return json(envelope(golden.comparison)); }, async (baseUrl) => {
      for (const name of ["sample" + String.fromCharCode(0xd800), "sample" + String.fromCharCode(0xdc00)]) {
        const error = await caught(client(baseUrl).compare({ ...comparisonInput, metric: { ...comparisonInput.metric, name } }));
        expect(error.code).toBe("attention_lab_invalid_request");
        expect(error.status).toBeUndefined();
        expect(error.details).toBeUndefined();
        expect(JSON.stringify(error)).not.toContain("sample");
      }
    });
    expect(calls).toBe(0);
  });

  test("bad input、unknown field、safe integers／dates 唔送request，亦唔invoke getters", async () => {
    let calls = 0;
    let accessorCalls = 0;
    await serve(() => { calls++; return json({}); }, async (baseUrl) => {
      const lab = client(baseUrl);
      for (const input of [
        { ...briefInput, extra: "sentinel" }, { ...briefInput, nonpoliticalConfirmed: false },
        { ...briefInput, topic: "  " }, { ...briefInput, evidenceStatus: "provided" },
        { ...briefInput, get evidence() { accessorCalls++; return "sentinel"; } },
        { ...briefInput, toJSON() { accessorCalls++; return briefInput; } },
      ]) expect((await caught(lab.buildBrief(input as never))).code).toBe("attention_lab_invalid_request");
      for (const counts of [
        { ...comparisonInput.counts, aOutcomes: "101" }, { ...comparisonInput.counts, aOutcomes: "-1" },
        { ...comparisonInput.counts, aOutcomes: "1.5" }, { ...comparisonInput.counts, aOutcomes: 10 },
        { ...comparisonInput.counts, aOutcomes: "9007199254740992" }, { ...comparisonInput.counts, aOutcomes: " " },
      ]) expect((await caught(lab.compare({ ...comparisonInput, counts } as never))).code).toBe("attention_lab_invalid_request");
      for (const plan of [
        { ...comparisonInput.plan, startDate: "2026-02-30" }, { ...comparisonInput.plan, endDate: "2026-08-31" },
      ]) expect((await caught(lab.compare({ ...comparisonInput, plan }))).code).toBe("attention_lab_invalid_request");
    });
    expect(calls).toBe(0);
    expect(accessorCalls).toBe(0);
  });
});

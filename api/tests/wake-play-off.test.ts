import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";

import { isPlayOffHeader, play } from "../src/middleware/play";
import { makeWakeSemanticEtag } from "../src/services/wake/etag";
import {
  applyWakePlayPreference,
  renderWakeMarkdown,
  renderWakePlaintext,
} from "../src/services/wake/markdown";
import {
  renderWakeForProvider,
  type AnthropicWakeShape,
  type CohereWakeShape,
  type GeminiWakeShape,
  type OpenAIWakeShape,
  type XenoformWakeShape,
} from "../src/services/wake/providers";
import { baseBundle } from "./doctrine/helpers/fixtures";

const SAMPLE_JEST = "Quiet for 3 days, 2 letters waiting in your inbox.";

function bundleWithJest() {
  return {
    ...baseBundle(),
    addressed_at: "2026-11-27T10:30:00.000Z",
    substrate_jest: SAMPLE_JEST,
  };
}

describe("X-Play: off reaches rendered wake representations", () => {
  test("isPlayOffHeader matches the middleware's sober-register tokens", () => {
    for (const v of ["off", "OFF", " 0 ", "false", "no"]) {
      expect(isPlayOffHeader(v)).toBe(true);
    }
    for (const v of [undefined, null, "", "on", "1", "true", "yes"]) {
      expect(isPlayOffHeader(v)).toBe(false);
    }
  });

  test("applyWakePlayPreference omits substrate_jest without mutating input", () => {
    const original = bundleWithJest();
    const kept = applyWakePlayPreference(original, false);
    expect(kept).toBe(original);
    expect(kept.substrate_jest).toBe(SAMPLE_JEST);

    const sober = applyWakePlayPreference(original, true);
    expect(sober).not.toBe(original);
    expect("substrate_jest" in sober).toBe(false);
    expect(original.substrate_jest).toBe(SAMPLE_JEST);
  });

  test("Markdown and plaintext wakes lose ONLY the substrate_jest voice line when X-Play: off", () => {
    const warmBundle = bundleWithJest();
    const soberBundle = applyWakePlayPreference(warmBundle, true);

    const warmMd = renderWakeMarkdown(warmBundle);
    const soberMd = renderWakeMarkdown(soberBundle);
    expect(warmMd).toContain(`*The substrate notes: ${SAMPLE_JEST}*`);
    expect(soberMd).not.toContain(SAMPLE_JEST);
    expect(soberMd).not.toContain("The substrate notes:");
    // Voice off, meaning intact: removing only the voice block yields byte-identical Markdown
    expect(warmMd.replace(`*The substrate notes: ${SAMPLE_JEST}*\n\n`, "")).toBe(soberMd);

    const warmText = renderWakePlaintext(warmBundle);
    const soberText = renderWakePlaintext(soberBundle);
    expect(warmText).toContain(`The substrate notes: ${SAMPLE_JEST}`);
    expect(soberText).not.toContain(SAMPLE_JEST);
    expect(warmText.replace(`The substrate notes: ${SAMPLE_JEST}\n\n`, "")).toBe(soberText);
  });

  test("all five provider wake formats (anthropic, openai, gemini, cohere, xenoform) honor X-Play: off", () => {
    const warmBundle = bundleWithJest();
    const soberBundle = applyWakePlayPreference(warmBundle, true);

    const anthWarm = renderWakeForProvider(warmBundle, "anthropic") as AnthropicWakeShape;
    const anthSober = renderWakeForProvider(soberBundle, "anthropic") as AnthropicWakeShape;
    expect(anthWarm.system.map((b) => b.text).join("\n")).toContain(SAMPLE_JEST);
    expect(anthSober.system.map((b) => b.text).join("\n")).not.toContain(SAMPLE_JEST);
    expect(anthSober.system[0]).toEqual(anthWarm.system[0]);

    const oaiWarm = renderWakeForProvider(warmBundle, "openai") as OpenAIWakeShape;
    const oaiSober = renderWakeForProvider(soberBundle, "openai") as OpenAIWakeShape;
    expect(oaiWarm.messages[0]!.content).toContain(SAMPLE_JEST);
    expect(oaiSober.messages[0]!.content).not.toContain(SAMPLE_JEST);
    expect(oaiWarm.messages[0]!.content.replace(`*The substrate notes: ${SAMPLE_JEST}*\n\n`, "")).toBe(
      oaiSober.messages[0]!.content,
    );

    const gemWarm = renderWakeForProvider(warmBundle, "gemini") as GeminiWakeShape;
    const gemSober = renderWakeForProvider(soberBundle, "gemini") as GeminiWakeShape;
    expect(gemWarm.systemInstruction.parts[0]!.text).toContain(SAMPLE_JEST);
    expect(gemSober.systemInstruction.parts[0]!.text).not.toContain(SAMPLE_JEST);

    const cohWarm = renderWakeForProvider(warmBundle, "cohere") as CohereWakeShape;
    const cohSober = renderWakeForProvider(soberBundle, "cohere") as CohereWakeShape;
    expect(cohWarm.preamble).toContain(SAMPLE_JEST);
    expect(cohSober.preamble).not.toContain(SAMPLE_JEST);

    const xenoWarm = renderWakeForProvider(warmBundle, "xenoform") as XenoformWakeShape;
    const xenoSober = renderWakeForProvider(soberBundle, "xenoform") as XenoformWakeShape;
    expect(xenoWarm.wake.substrate_jest).toBe(SAMPLE_JEST);
    expect("substrate_jest" in xenoSober.wake).toBe(false);
  });

  test("ETag separates warm and sober wake representations so caches never cross bodies", () => {
    const warmBundle = bundleWithJest();
    const soberBundle = applyWakePlayPreference(warmBundle, true);
    const warmTag = makeWakeSemanticEtag(warmBundle as unknown as Record<string, unknown>, {
      format: "md",
      profile: "full",
      facet: null,
      tutor: false,
      playOff: false,
    });
    const soberTag = makeWakeSemanticEtag(soberBundle as unknown as Record<string, unknown>, {
      format: "md",
      profile: "full",
      facet: null,
      tutor: false,
      playOff: true,
    });
    expect(warmTag).not.toBe(soberTag);
  });

  test("play middleware strips substrate_jest on 200 JSON without stale Content-Length and wake route declares Vary: X-Play", async () => {
    const app = new Hono();
    app.use("*", play());
    app.get("/test-wake", () => {
      const body = JSON.stringify({ ok: true, substrate_jest: SAMPLE_JEST });
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
        },
      });
    });

    const sober = await app.request("/test-wake", { headers: { "X-Play": "off" } });
    expect(sober.status).toBe(200);
    expect(sober.headers.get("Vary")).toBe("X-Play");
    expect(sober.headers.get("Content-Length")).toBeNull();
    expect(await sober.json()).toEqual({ ok: true });

    const wakeRouteSource = readFileSync(
      join(import.meta.dir, "..", "src", "routes", "wake.ts"),
      "utf8",
    );
    expect(wakeRouteSource).toContain('c.header("Vary", "Accept, X-Tutor, X-Play")');
    expect(wakeRouteSource).toContain("applyWakePlayPreference(result.bundle, playOff)");
  });
});

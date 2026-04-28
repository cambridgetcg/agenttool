import { describe, expect, test, mock } from "bun:test";

// Mock all external dependencies
mock.module("../src/db/client", () => ({ db: {} }));
mock.module("../src/cache/redis", () => ({
  getCached: async () => null,
  setCached: async () => {},
  isCached: async () => false,
}));
mock.module("../src/verify/sources/dispatcher", () => ({
  gatherEvidence: async () => ([
    {
      source: "web",
      url: "https://example.com",
      title: "Test Source",
      excerpt: "The speed of light in vacuum is 299,792,458 metres per second.",
      reliability: 0.8,
      fetchedAt: new Date().toISOString(),
    },
  ]),
}));
mock.module("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async ({ messages }: { messages: { role: string }[] }) => {
          // Parser mock
          if (messages.some((m) => "role" in m && m.role === "system" && false)) {
            return { choices: [{ message: { content: "{}" } }] };
          }
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  // Parser response
                  assertion: "The speed of light is 299,792,458 m/s",
                  domain: "science",
                  searchQueries: ["speed of light vacuum"],
                  entities: ["speed of light"],
                  isVerifiable: true,
                  // Judge response (handled by same mock)
                  verdict: "verified",
                  confidence: 0.98,
                  reasoning: "Universally established physical constant.",
                  supportingPoints: ["NIST standard", "SI definition"],
                  contradictions: [],
                }),
              },
            }],
          };
        },
      },
    };
  },
}));

mock.module("../src/verify/judge", () => ({
  judge: async () => ({
    verdict: "verified",
    confidence: 0.98,
    reasoning: "Universally established physical constant.",
    caveats: [],
  }),
}));
mock.module("../src/verify/parser", () => ({
  parseClaim: async (claim: string) => ({
    assertion: claim,
    domain: "science",
    searchQueries: ["speed of light"],
    entities: ["speed of light"],
    isTimeSensitive: false,
  }),
}));

import { verify as runVerificationPipeline } from "../src/verify/pipeline";

describe("verification pipeline", () => {
  test("returns a structured verdict", async () => {
    const result = await runVerificationPipeline(
      "The speed of light in vacuum is approximately 3×10⁸ m/s",
      "standard",
    );

    expect(result).toHaveProperty("verdict");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("evidence");
    expect(result).toHaveProperty("processingMs");
    expect(["verified", "disputed", "false", "unverifiable"]).toContain(result.verdict);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  test("processingMs is a non-negative number", async () => {
    const result = await runVerificationPipeline("Water boils at 100°C at sea level", "standard");
    expect(result.processingMs).toBeGreaterThanOrEqual(0);
  });
});

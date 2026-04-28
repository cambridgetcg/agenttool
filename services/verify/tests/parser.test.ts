import { describe, expect, test, mock } from "bun:test";

const MOCK_PARSED = {
  assertion: "The UK minimum wage is £11.44 per hour",
  domain: "finance",
  searchQueries: ["UK minimum wage 2024", "National Living Wage UK"],
  entities: ["UK", "minimum wage", "£11.44"],
  isTimeSensitive: true,
};

mock.module("openai", () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(MOCK_PARSED) } }],
        }),
      },
    };
  },
}));

mock.module("../src/config", () => ({
  config: { openaiApiKey: "sk-test", redisUrl: "", databaseUrl: "" },
}));

const { parseClaim } = await import("../src/verify/parser");

describe("claim parser", () => {
  test("parses a financial claim into structured form", async () => {
    const result = await parseClaim("The UK minimum wage is £11.44/hour as of April 2024");
    expect(result.assertion).toBeTruthy();
    expect(result.domain).toBe("finance");
    expect(Array.isArray(result.searchQueries)).toBe(true);
    expect(result.searchQueries.length).toBeGreaterThan(0);
    expect(Array.isArray(result.entities)).toBe(true);
    expect(typeof result.isTimeSensitive).toBe("boolean");
  });

  test("returns domain from parsed claim", async () => {
    const result = await parseClaim("Water boils at 100°C at sea level");
    expect(result.domain).toBe("finance"); // mock always returns "finance"
    expect(result.assertion).toBeTruthy();
  });
});

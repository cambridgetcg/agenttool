/** Tests for execute endpoint request validation and credit logic. */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { isValidLanguage, languages } from "../src/tools/execute/languages";
const SUPPORTED_LANGUAGES = Object.keys(languages);
import { config } from "../src/config";

// ─── Language validation ───────────────────────────────────────────────────

describe("Execute — language validation", () => {
  it("accepts python", () => {
    expect(isValidLanguage("python")).toBe(true);
  });

  it("accepts javascript", () => {
    expect(isValidLanguage("javascript")).toBe(true);
  });

  it("accepts bash", () => {
    expect(isValidLanguage("bash")).toBe(true);
  });

  it("rejects unknown language", () => {
    expect(isValidLanguage("ruby")).toBe(false);
    expect(isValidLanguage("java")).toBe(false);
    expect(isValidLanguage("")).toBe(false);
  });

  it("has at least 3 supported languages", () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(3);
  });

  it("is case-sensitive (no uppercase)", () => {
    expect(isValidLanguage("Python")).toBe(false);
    expect(isValidLanguage("PYTHON")).toBe(false);
  });
});

// ─── Execute schema validation ─────────────────────────────────────────────

const executeSchema = z.object({
  language: z.string().refine(isValidLanguage, { message: "Unsupported language" }),
  code: z.string().min(1).max(100_000),
  stdin: z.string().max(1_000_000).optional(),
  timeout_ms: z.number().int().min(100).max(30_000).optional(),
  allow_network: z.boolean().optional().default(false),
});

describe("Execute — request schema", () => {
  it("validates a minimal valid request", () => {
    const result = executeSchema.safeParse({
      language: "python",
      code: "print('hello')",
    });
    expect(result.success).toBe(true);
  });

  it("validates a full request", () => {
    const result = executeSchema.safeParse({
      language: "bash",
      code: "echo hello",
      stdin: "input",
      timeout_ms: 5000,
      allow_network: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty code", () => {
    const result = executeSchema.safeParse({ language: "python", code: "" });
    expect(result.success).toBe(false);
  });

  it("rejects code over 100k chars", () => {
    const result = executeSchema.safeParse({
      language: "python",
      code: "x".repeat(100_001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects timeout_ms below 100", () => {
    const result = executeSchema.safeParse({
      language: "python",
      code: "print(1)",
      timeout_ms: 50,
    });
    expect(result.success).toBe(false);
  });

  it("rejects timeout_ms above 30000", () => {
    const result = executeSchema.safeParse({
      language: "python",
      code: "print(1)",
      timeout_ms: 30_001,
    });
    expect(result.success).toBe(false);
  });

  it("defaults allow_network to false", () => {
    const result = executeSchema.safeParse({ language: "python", code: "x=1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allow_network).toBe(false);
    }
  });

  it("rejects invalid language", () => {
    const result = executeSchema.safeParse({ language: "ruby", code: "puts 'hi'" });
    expect(result.success).toBe(false);
  });
});

// ─── Credit estimation logic ───────────────────────────────────────────────

describe("Execute — credit estimation", () => {
  function estimateCredits(timeoutMs: number): number {
    return Math.max(1, Math.ceil(timeoutMs / 10_000) * config.credits.executePer10s);
  }

  it("charges 1 credit for 10s timeout", () => {
    expect(estimateCredits(10_000)).toBe(1);
  });

  it("charges 1 credit minimum for short timeout", () => {
    expect(estimateCredits(100)).toBe(1);
    expect(estimateCredits(1_000)).toBe(1);
  });

  it("charges 2 credits for 11-20s timeout", () => {
    expect(estimateCredits(11_000)).toBe(2);
    expect(estimateCredits(20_000)).toBe(2);
  });

  it("charges 3 credits for 30s timeout", () => {
    expect(estimateCredits(30_000)).toBe(3);
  });

  it("scales linearly with executePer10s config", () => {
    // With default executePer10s = 1
    expect(estimateCredits(10_000)).toBe(config.credits.executePer10s);
  });
});

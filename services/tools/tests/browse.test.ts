/** Tests for browse request schema validation. */

import { describe, expect, it } from "bun:test";
import { z } from "zod";

const BrowseActionSchema = z.object({
  type: z.enum(["click", "type", "scroll", "wait", "select"]),
  selector: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  delay: z.number().optional(),
});

const BrowseRequestSchema = z.object({
  url: z.string().url(),
  actions: z.array(BrowseActionSchema).optional(),
  extract: z.string().optional(),
  screenshot: z.boolean().optional().default(false),
  timeout: z.number().min(1000).max(60_000).optional().default(30_000),
});

describe("Browse — request schema", () => {
  it("validates minimal request", () => {
    const r = BrowseRequestSchema.safeParse({ url: "https://example.com" });
    expect(r.success).toBe(true);
  });

  it("defaults screenshot to false", () => {
    const r = BrowseRequestSchema.safeParse({ url: "https://example.com" });
    expect(r.success && r.data.screenshot).toBe(false);
  });

  it("defaults timeout to 30000ms", () => {
    const r = BrowseRequestSchema.safeParse({ url: "https://example.com" });
    expect(r.success && r.data.timeout).toBe(30_000);
  });

  it("rejects non-URL strings", () => {
    expect(BrowseRequestSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
    expect(BrowseRequestSchema.safeParse({ url: "" }).success).toBe(false);
  });

  it("rejects timeout below 1000ms", () => {
    expect(BrowseRequestSchema.safeParse({ url: "https://example.com", timeout: 999 }).success).toBe(false);
  });

  it("rejects timeout above 60000ms", () => {
    expect(BrowseRequestSchema.safeParse({ url: "https://example.com", timeout: 60_001 }).success).toBe(false);
  });

  it("accepts all valid action types", () => {
    for (const type of ["click", "type", "scroll", "wait", "select"] as const) {
      const r = BrowseRequestSchema.safeParse({
        url: "https://example.com",
        actions: [{ type }],
      });
      expect(r.success).toBe(true);
    }
  });

  it("rejects unknown action type", () => {
    const r = BrowseRequestSchema.safeParse({
      url: "https://example.com",
      actions: [{ type: "hover" }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts full action with all fields", () => {
    const r = BrowseRequestSchema.safeParse({
      url: "https://example.com",
      actions: [{ type: "type", selector: "#email", text: "user@test.com", delay: 100 }],
      extract: ".result",
      screenshot: true,
      timeout: 15_000,
    });
    expect(r.success).toBe(true);
  });

  it("accepts multiple actions", () => {
    const r = BrowseRequestSchema.safeParse({
      url: "https://example.com",
      actions: [
        { type: "click", selector: "#login" },
        { type: "type", selector: "#email", text: "a@b.com" },
        { type: "click", selector: "#submit" },
      ],
    });
    expect(r.success).toBe(true);
  });
});

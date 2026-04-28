import { describe, expect, test } from "bun:test";
import { refineConfidence } from "../src/verify/scorer";

describe("confidence scorer", () => {
  test("boosts score with high-reliability gov sources", () => {
    const score = refineConfidence(0.7, [
      { source: "gov", reliability: 0.92, position: "supports" as const, excerpt: "...", url: "", title: "", fetchedAt: "" },
      { source: "gov", reliability: 0.88, position: "supports" as const, excerpt: "...", url: "", title: "", fetchedAt: "" },
      { source: "gov", reliability: 0.85, position: "supports" as const, excerpt: "...", url: "", title: "", fetchedAt: "" },
    ], "verified");
    expect(score).toBeGreaterThan(0.7);
  });

  test("caps confidence when high-reliability sources contradict a verified claim", () => {
    // Judge said "verified" but strong contradicting evidence should cap confidence at 0.5
    const score = refineConfidence(0.8, [
      { source: "web", reliability: 0.75, position: "contradicts" as const, excerpt: "...", url: "", title: "", fetchedAt: "" },
      { source: "web", reliability: 0.72, position: "contradicts" as const, excerpt: "...", url: "", title: "", fetchedAt: "" },
    ], "verified");
    expect(score).toBeLessThanOrEqual(0.5);
  });

  test("caps at 0.99", () => {
    const score = refineConfidence(0.99, [
      { source: "gov", reliability: 0.99, position: "supports" as const, excerpt: "...", url: "", title: "", fetchedAt: "" },
      { source: "knowledge", reliability: 0.95, position: "supports" as const, excerpt: "...", url: "", title: "", fetchedAt: "" },
      { source: "web", reliability: 0.90, position: "supports" as const, excerpt: "...", url: "", title: "", fetchedAt: "" },
    ], "verified");
    expect(score).toBeLessThanOrEqual(0.99);
  });

  test("floors at 0.01", () => {
    const score = refineConfidence(0.01, [], "false");
    expect(score).toBeGreaterThanOrEqual(0.01);
  });
});

/** Tests for config defaults and plan limits. */

import { describe, expect, it } from "bun:test";
import { config } from "../src/config";

describe("Config — credit costs", () => {
  it("search costs 1 credit by default", () => {
    expect(config.credits.search).toBe(1);
  });

  it("scrape costs 2 credits by default", () => {
    expect(config.credits.scrape).toBe(2);
  });

  it("browse costs 5 credits by default", () => {
    expect(config.credits.browse).toBe(5);
  });

  it("document costs 3 credits by default", () => {
    expect(config.credits.document).toBe(3);
  });

  it("execute costs 1 credit per 10s by default", () => {
    expect(config.credits.executePer10s).toBe(1);
  });

  it("browse is the most expensive tool", () => {
    const { search, scrape, browse, document } = config.credits;
    expect(browse).toBeGreaterThanOrEqual(search);
    expect(browse).toBeGreaterThanOrEqual(scrape);
    expect(browse).toBeGreaterThanOrEqual(document);
  });
});

describe("Config — plan limits", () => {
  it("dev plan has 100 credits", () => {
    expect(config.plans.dev.credits).toBe(100);
  });

  it("builder plan has 5000 credits", () => {
    expect(config.plans.builder.credits).toBe(5_000);
  });

  it("scale plan has 25000 credits", () => {
    expect(config.plans.scale.credits).toBe(25_000);
  });

  it("enterprise plan has unlimited credits", () => {
    expect(config.plans.enterprise.credits).toBe(Infinity);
  });

  it("rate limits increase with plan tier", () => {
    const { dev, builder, scale, enterprise } = config.plans;
    expect(builder.ratePerMin).toBeGreaterThan(dev.ratePerMin);
    expect(scale.ratePerMin).toBeGreaterThan(builder.ratePerMin);
    expect(enterprise.ratePerMin).toBeGreaterThan(scale.ratePerMin);
  });

  it("dev plan rate limit is 10 req/min", () => {
    expect(config.plans.dev.ratePerMin).toBe(10);
  });
});

describe("Config — URLs", () => {
  it("has a database URL", () => {
    expect(config.databaseUrl).toBeTruthy();
    expect(config.databaseUrl).toContain("postgres");
  });

  it("has a redis URL", () => {
    expect(config.redisUrl).toBeTruthy();
    expect(config.redisUrl).toContain("redis");
  });

  it("defaults to port 3000", () => {
    expect(config.port).toBe(3000);
  });
});

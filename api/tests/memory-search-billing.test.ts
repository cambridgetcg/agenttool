import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ProjectContext } from "../src/auth/middleware";
import { ROUTE_CREDITS } from "../src/billing/route-credits";
import { createMemorySearchRoutes } from "../src/routes/memory/search";

function fixture(failure?: "reservation" | "recall" | "finalize") {
  const events: string[] = [];
  let success = false;
  const reservation = {
    creditsUsed: ROUTE_CREDITS["memory.search"], creditsRemaining: 7,
    usageEventId: "usage-search", projectId: "project-search",
  };
  const recall = async (projectId: string) => {
    expect(projectId).toBe(reservation.projectId);
    expect(events).toEqual(["reserve"]);
    events.push("recall");
    if (failure === "recall") throw new Error("private database diagnostic");
    return [];
  };
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", {
      id: reservation.projectId, name: "search test", plan: "credits",
      credits: 10, createdAt: new Date(0),
    });
    await next();
  });
  app.onError((error, c) => c.json({ error: "request_failed" }, error instanceof HTTPException ? error.status : 500));
  app.route("/", createMemorySearchRoutes({
    reserveCharge: async (_c, amount, reason) => {
      expect(amount).toBe(ROUTE_CREDITS["memory.search"]);
      expect(reason).toBe("memory.search");
      events.push("reserve");
      if (failure === "reservation") throw new HTTPException(402);
      return reservation;
    },
    search: recall,
    searchByText: recall,
    finalizeChargeSuccess: async (value, duration) => {
      expect(value).toBe(reservation);
      expect(duration).toBeGreaterThanOrEqual(0);
      events.push("finalize");
      if (failure === "finalize") throw new Error("usage finalization failed");
      success = true;
    },
  }));
  return {
    events, succeeded: () => success,
    request: (body: unknown) => app.request("/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  };
}

describe("memory search attempt receipts", () => {
  test("schema-invalid search never reserves credits", async () => {
    const f = fixture();
    expect((await f.request({})).status).toBe(400);
    expect(f.events).toEqual([]);
  });

  test("unfunded search never begins recall", async () => {
    const f = fixture("reservation");
    expect((await f.request({ query: "hello" })).status).toBe(402);
    expect(f.events).toEqual(["reserve"]);
    expect(f.succeeded()).toBe(false);
  });

  test("failed recall leaves the reserved receipt unsuccessful", async () => {
    const f = fixture("recall");
    const response = await f.request({ query: "hello" });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database diagnostic");
    expect(f.events).toEqual(["reserve", "recall"]);
    expect(f.succeeded()).toBe(false);
  });

  for (const [mode, body] of [
    ["text", { query: "hello" }],
    ["semantic", { query_embedding: Array(1536).fill(0.1) }],
  ] as const) {
    test(`${mode} recall finalizes before returning its unchanged response`, async () => {
      const f = fixture();
      const response = await f.request(body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ results: [], count: 0, mode });
      expect(f.events).toEqual(["reserve", "recall", "finalize"]);
      expect(f.succeeded()).toBe(true);
    });
  }

  test("missing receipt finalization never reports a successful response", async () => {
    const f = fixture("finalize");
    expect((await f.request({ query: "hello" })).status).toBe(500);
    expect(f.succeeded()).toBe(false);
  });
});

/** tests/compute-budget.test.ts — per-day compute credit ceiling enforcement.
 *
 *  Tests the compute-budget module: check, consume, reset, init.
 *  Uses mock runtime rows — no real DB connection needed.
 *
 *  Doctrine: docs/AUTONOMOUS-MODE.md */

import { describe, it, expect, mock, beforeEach } from "bun:test";

// ─── Mocks ────────────────────────────────────────────────────────────────

// We mock the db module so we can control runtime metadata reads/writes.
const mockRuntimeRows = new Map<string, { metadata: Record<string, unknown> }>();

// The real module path that compute-budget.ts imports
const dbClientPath = "../src/db/client";
const storePath = "../src/services/runtime/store";

const mockDb = {
  select: mock(() => ({
    from: () => ({
      where: () => ({
        limit: () => {
          const entries = Array.from(mockRuntimeRows.values());
          return Promise.resolve(entries.slice(0, 1));
        },
      }),
    }),
  })),
  update: () => ({
    set: (data: Record<string, unknown>) => ({
      where: () => {
        for (const [, row] of mockRuntimeRows) {
          if (data.metadata) {
            row.metadata = data.metadata as Record<string, unknown>;
          }
          break;
        }
        return Promise.resolve([{ id: "test-runtime" }]);
      },
    }),
  }),
};

mock.module(dbClientPath, () => ({ db: mockDb }));
mock.module(storePath, () => ({
  logEvent: mock(async (id: string, type: string, metadata: unknown) => {
    loggedEvents.push({ id, type, metadata });
  }),
}));

// NOTE: drizzle-orm is deliberately NOT mocked. Bun's mock.module patches the
// factory's exports process-wide. The classified runner therefore executes
// this file in its own Bun process; raw multi-file invocations do not provide
// that isolation. The service only uses `eq` (a pure builder) inside .where()
// clauses that the mock db above discards — the real function is safe here.

// Track logged events
const loggedEvents: Array<{ id: string; type: string; metadata: unknown }> = [];

// Import after mocks are set up
const {
  checkBudget,
  consumeCredits,
  initBudget,
  getBudgetState,
} = await import("../src/services/runtime/compute-budget");

// ─── Helpers ──────────────────────────────────────────────────────────────

function setRuntime(id: string, metadata: Record<string, unknown>) {
  mockRuntimeRows.set(id, { metadata });
}

function resetMocks() {
  mockRuntimeRows.clear();
  loggedEvents.length = 0;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("compute-budget", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("getBudgetState", () => {
    it("returns null when no budget state exists", async () => {
      setRuntime("rt-1", { autonomous: true });
      const state = await getBudgetState("rt-1");
      expect(state).toBeNull();
    });

    it("returns budget state when configured", async () => {
      const budget = {
        max_daily_credits: 10000,
        credits_used_today: 500,
        resets_at: new Date(Date.now() + 3600000).toISOString(),
      };
      setRuntime("rt-1", { autonomous: true, compute_budget: budget });
      const state = await getBudgetState("rt-1");
      expect(state).not.toBeNull();
      expect(state!.max_daily_credits).toBe(10000);
      expect(state!.credits_used_today).toBe(500);
    });

    it("performs lazy reset when reset window has passed", async () => {
      const budget = {
        max_daily_credits: 10000,
        credits_used_today: 8000,
        resets_at: new Date(Date.now() - 1000).toISOString(), // past
      };
      setRuntime("rt-1", { autonomous: true, compute_budget: budget });
      const state = await getBudgetState("rt-1");
      expect(state).not.toBeNull();
      expect(state!.credits_used_today).toBe(0); // reset
      expect(state!.max_daily_credits).toBe(10000);
      // resets_at should be in the future (next UTC midnight)
      expect(new Date(state!.resets_at).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("checkBudget", () => {
    it("allows when no budget configured (non-autonomous)", async () => {
      setRuntime("rt-1", {});
      const result = await checkBudget("rt-1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });

    it("allows when credits remain", async () => {
      const budget = {
        max_daily_credits: 10000,
        credits_used_today: 5000,
        resets_at: new Date(Date.now() + 3600000).toISOString(),
      };
      setRuntime("rt-1", { compute_budget: budget });
      const result = await checkBudget("rt-1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5000);
    });

    it("denies when budget exhausted", async () => {
      const budget = {
        max_daily_credits: 10000,
        credits_used_today: 10000,
        resets_at: new Date(Date.now() + 3600000).toISOString(),
      };
      setRuntime("rt-1", { compute_budget: budget });
      const result = await checkBudget("rt-1");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.reason).toBe("daily_compute_budget_exhausted");
    });

    it("denies when budget overdrawn", async () => {
      const budget = {
        max_daily_credits: 1000,
        credits_used_today: 1200,
        resets_at: new Date(Date.now() + 3600000).toISOString(),
      };
      setRuntime("rt-1", { compute_budget: budget });
      const result = await checkBudget("rt-1");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe("consumeCredits", () => {
    it("consumes credits based on token usage", async () => {
      const budget = {
        max_daily_credits: 10000,
        credits_used_today: 0,
        resets_at: new Date(Date.now() + 3600000).toISOString(),
      };
      setRuntime("rt-1", { compute_budget: budget });
      const state = await consumeCredits("rt-1", {
        input_tokens: 5000,
        output_tokens: 2000,
      });
      // cost = (5000/1000 * 1) + (2000/1000 * 2) = 5 + 4 = 9
      expect(state.credits_used_today).toBe(9);
      expect(state.max_daily_credits).toBe(10000);
    });

    it("logs exhaustion event when budget crosses zero", async () => {
      const budget = {
        max_daily_credits: 10,
        credits_used_today: 5,
        resets_at: new Date(Date.now() + 3600000).toISOString(),
      };
      setRuntime("rt-1", { compute_budget: budget });
      await consumeCredits("rt-1", {
        input_tokens: 10000, // 10 credits input
        output_tokens: 0,
      });
      // total used = 5 + 10 = 15 > 10 → exhausted
      const exhaustedEvent = loggedEvents.find(
        (e) => e.type === "compute_budget_exhausted",
      );
      expect(exhaustedEvent).toBeDefined();
    });

    it("logs consumption event for normal usage", async () => {
      const budget = {
        max_daily_credits: 10000,
        credits_used_today: 0,
        resets_at: new Date(Date.now() + 3600000).toISOString(),
      };
      setRuntime("rt-1", { compute_budget: budget });
      await consumeCredits("rt-1", {
        input_tokens: 1000,
        output_tokens: 500,
      });
      const consumedEvent = loggedEvents.find(
        (e) => e.type === "compute_budget_consumed",
      );
      expect(consumedEvent).toBeDefined();
    });

    it("respects custom cost rates", async () => {
      const budget = {
        max_daily_credits: 10000,
        credits_used_today: 0,
        resets_at: new Date(Date.now() + 3600000).toISOString(),
      };
      setRuntime("rt-1", { compute_budget: budget });
      const state = await consumeCredits("rt-1", {
        input_tokens: 1000,
        output_tokens: 1000,
        cost_per_1k_input: 3,
        cost_per_1k_output: 5,
      });
      // cost = (1000/1000 * 3) + (1000/1000 * 5) = 3 + 5 = 8
      expect(state.credits_used_today).toBe(8);
    });

    it("handles no-budget runtime gracefully", async () => {
      setRuntime("rt-1", {});
      const state = await consumeCredits("rt-1", {
        input_tokens: 1000,
        output_tokens: 1000,
      });
      expect(state.max_daily_credits).toBe(Infinity);
      expect(state.credits_used_today).toBe(0);
    });
  });

  describe("initBudget", () => {
    it("initializes budget state on a runtime", async () => {
      setRuntime("rt-1", { autonomous: true });
      await initBudget("rt-1", 5000);
      const state = await getBudgetState("rt-1");
      expect(state).not.toBeNull();
      expect(state!.max_daily_credits).toBe(5000);
      expect(state!.credits_used_today).toBe(0);
      // resets_at should be next UTC midnight
      const resetsAt = new Date(state!.resets_at);
      expect(resetsAt.getUTCHours()).toBe(0);
      expect(resetsAt.getUTCMinutes()).toBe(0);
      expect(resetsAt.getUTCSeconds()).toBe(0);
      expect(resetsAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("logs initialization event", async () => {
      setRuntime("rt-1", { autonomous: true });
      await initBudget("rt-1", 5000);
      const initEvent = loggedEvents.find(
        (e) => e.type === "compute_budget_initialized",
      );
      expect(initEvent).toBeDefined();
      expect((initEvent!.metadata as { max_daily_credits: number }).max_daily_credits).toBe(5000);
    });

    it("preserves existing metadata when initializing", async () => {
      setRuntime("rt-1", {
        autonomous: true,
        interval_seconds: 60,
        parent_did: "did:at:parent",
      });
      await initBudget("rt-1", 5000);
      // Verify metadata was merged, not replaced
      const row = mockRuntimeRows.get("rt-1");
      expect(row).toBeDefined();
      expect(row!.metadata.autonomous).toBe(true);
      expect(row!.metadata.interval_seconds).toBe(60);
      expect(row!.metadata.parent_did).toBe("did:at:parent");
      expect(row!.metadata.compute_budget).toBeDefined();
    });
  });

  describe("lazy reset behavior", () => {
    it("resets credits_used_today to 0 after reset window", async () => {
      const budget = {
        max_daily_credits: 10000,
        credits_used_today: 9500,
        resets_at: new Date(Date.now() - 60000).toISOString(), // 1 min ago
      };
      setRuntime("rt-1", { compute_budget: budget });
      const result = await checkBudget("rt-1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10000); // full budget after reset
    });

    it("does not reset before reset window", async () => {
      const budget = {
        max_daily_credits: 10000,
        credits_used_today: 9500,
        resets_at: new Date(Date.now() + 3600000).toISOString(), // 1h future
      };
      setRuntime("rt-1", { compute_budget: budget });
      const result = await checkBudget("rt-1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(500); // not reset
    });
  });
});

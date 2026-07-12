import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import {
  assertCanCharge,
  finalizeChargeSuccess,
  reserveCharge,
} from "../src/billing/charge";
import { rateLimitHeaders } from "../src/middleware/rate-limit-headers";
import { parseToolIntegerOverride } from "../src/services/tools/config";

function contextWithCredits(credits: number, project = true) {
  const context = {
    var: {
      project: project
        ? {
          id: "00000000-0000-4000-8000-000000000001",
          name: "test",
          plan: "credits",
          credits,
          createdAt: new Date(0),
        }
        : undefined,
    },
    set(_key: string, value: unknown) {
      this.var.project = value as typeof this.var.project;
    },
  };
  return context;
}

interface FakeUsageEvent {
  id: string;
  projectId: string;
  tool: string;
  creditsUsed: number;
  durationMs: number | null;
  success: boolean;
}

/** Transactional in-memory double for the narrow Drizzle surface used here. */
class FakeBillingDatabase {
  balance: number;
  events: FakeUsageEvent[] = [];
  failReservationInsert = false;
  finalizeFindsRow = true;
  private nextEvent = 1;
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(
    balance: number,
    readonly debitAmount: number,
  ) {
    this.balance = balance;
  }

  async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    let draftBalance = this.balance;
    const draftEvents = this.events.map((event) => ({ ...event }));
    const tx = {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              if (draftBalance < this.debitAmount) return [];
              draftBalance -= this.debitAmount;
              return [{ credits: draftBalance }];
            },
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ credits: draftBalance }],
          }),
        }),
      }),
      insert: () => ({
        values: (value: Omit<FakeUsageEvent, "id">) => ({
          returning: async () => {
            if (this.failReservationInsert) {
              throw new Error("simulated audit insert failure");
            }
            const id = `event-${this.nextEvent}`;
            draftEvents.push({ ...value, id });
            return [{ id }];
          },
        }),
      }),
    };

    try {
      const result = await callback(tx);
      const addedEvents = Math.max(0, draftEvents.length - this.events.length);
      this.balance = draftBalance;
      this.events = draftEvents;
      this.nextEvent += addedEvents;
      return result;
    } finally {
      release();
    }
  }

  insert() {
    return {
      values: async (value: Omit<FakeUsageEvent, "id">) => {
        this.events.push({ ...value, id: `event-${this.nextEvent++}` });
      },
    };
  }

  update() {
    return {
      set: (value: Pick<FakeUsageEvent, "success" | "durationMs">) => ({
        where: () => ({
          returning: async () => {
            const event = this.finalizeFindsRow ? this.events[0] : undefined;
            if (!event) return [];
            Object.assign(event, value);
            return [{ id: event.id }];
          },
        }),
      }),
    };
  }
}

type BillingDatabase = NonNullable<Parameters<typeof reserveCharge>[3]>;

function asBillingDatabase(fake: FakeBillingDatabase): BillingDatabase {
  return fake as unknown as BillingDatabase;
}

describe("static tool atomic attempt billing", () => {
  test("invalid or negative operator integers fall back before route billing", () => {
    for (const value of ["-1", "1.5", "1credit", "2147483648", ""]) {
      expect(parseToolIntegerOverride(value, 3)).toBe(3);
    }
    expect(parseToolIntegerOverride("0", 3)).toBe(0);
    expect(parseToolIntegerOverride(" 4 ", 3)).toBe(4);
    expect(parseToolIntegerOverride("0", 3, 1)).toBe(3);
  });

  test("the legacy balance advisory remains available to existing callers", () => {
    expect(() => assertCanCharge(contextWithCredits(3) as never, 3, "document"))
      .not.toThrow();
    try {
      assertCanCharge(contextWithCredits(2) as never, 3, "document");
      expect.unreachable();
    } catch (error) {
      expect((error as { status?: number }).status).toBe(402);
    }
  });

  test("rejects non-integer, unsafe, and out-of-range credit amounts", () => {
    for (const amount of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2_147_483_648,
    ]) {
      try {
        assertCanCharge(contextWithCredits(10) as never, amount, "document");
        expect.unreachable();
      } catch (error) {
        expect((error as { status?: number }).status).toBe(500);
      }
    }
  });

  test("routes reserve before bounded work and finalize only after success", () => {
    for (const [file, operation] of [
      ["scrape.ts", "await scrape(parsed.data)"],
      ["document.ts", "await parseDocument(parsed.data)"],
    ] as const) {
      const source = readFileSync(
        join(import.meta.dir, "..", "src", "routes", "tools", file),
        "utf8",
      );
      const reservation = source.indexOf("await reserveCharge(c, cost");
      const work = source.indexOf(operation);
      const finalization = source.indexOf(
        "await finalizeChargeSuccess(reservation, durationMs)",
      );
      expect(reservation).toBeGreaterThan(-1);
      expect(work).toBeGreaterThan(reservation);
      expect(finalization).toBeGreaterThan(work);
      expect(source).not.toContain("assertCanCharge(c, cost");
      expect(source).not.toContain("await charge(c, cost");
    }
  });

  test("reserves a debit with a failure row, then finalizes that row", async () => {
    const context = contextWithCredits(5);
    const fake = new FakeBillingDatabase(5, 3);
    const reservation = await reserveCharge(
      context as never,
      3,
      "document",
      asBillingDatabase(fake),
    );

    expect(fake.balance).toBe(2);
    expect(context.var.project?.credits).toBe(2);
    expect(fake.events).toEqual([expect.objectContaining({
      id: reservation.usageEventId,
      tool: "document",
      creditsUsed: 3,
      durationMs: null,
      success: false,
    })]);

    await finalizeChargeSuccess(reservation, 17, asBillingDatabase(fake));
    expect(fake.events[0]).toMatchObject({ success: true, durationMs: 17 });
  });

  test("rolls the debit back when the reservation audit insert fails", async () => {
    const context = contextWithCredits(3);
    const fake = new FakeBillingDatabase(3, 3);
    fake.failReservationInsert = true;

    await expect(reserveCharge(
      context as never,
      3,
      "scrape",
      asBillingDatabase(fake),
    )).rejects.toThrow("simulated audit insert failure");
    expect(fake.balance).toBe(3);
    expect(fake.events).toHaveLength(0);
    expect(context.var.project?.credits).toBe(3);
  });

  test("serializes concurrent reservations and refreshes the losing balance", async () => {
    const contexts = [contextWithCredits(3), contextWithCredits(3)];
    const fake = new FakeBillingDatabase(3, 3);
    const outcomes = await Promise.allSettled(contexts.map((context) =>
      reserveCharge(
        context as never,
        3,
        "scrape",
        asBillingDatabase(fake),
      )
    ));

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled"))
      .toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected"))
      .toHaveLength(1);
    const losingIndex = outcomes.findIndex((outcome) =>
      outcome.status === "rejected"
    );
    const rejection = outcomes[losingIndex] as PromiseRejectedResult;
    expect((rejection.reason as { status?: number }).status).toBe(402);
    expect(contexts[losingIndex]?.var.project?.credits).toBe(0);
    expect(fake.balance).toBe(0);
    expect(fake.events.map((event) => event.creditsUsed).sort()).toEqual([0, 3]);
    expect(fake.events.every((event) => event.success === false)).toBe(true);
  });

  test("fails closed when finalization cannot find the reserved audit row", async () => {
    const context = contextWithCredits(3);
    const fake = new FakeBillingDatabase(3, 3);
    const reservation = await reserveCharge(
      context as never,
      3,
      "document",
      asBillingDatabase(fake),
    );
    fake.finalizeFindsRow = false;
    try {
      await finalizeChargeSuccess(reservation, 1, asBillingDatabase(fake));
      expect.unreachable();
    } catch (error) {
      expect((error as { status?: number }).status).toBe(500);
    }
    expect(fake.events[0]).toMatchObject({ success: false, durationMs: null });
    expect(fake.balance).toBe(0);
  });

  test("credit headers do not advertise idempotency on unmounted static routes", async () => {
    const app = new Hono<ProjectContext>();
    app.use("*", async (c, next) => {
      c.set("project", contextWithCredits(3).var.project!);
      await next();
    });
    app.use("/v1/scrape/*", rateLimitHeaders());
    app.post("/v1/scrape/", (c) => c.json({ ok: true }));

    const response = await app.request("http://local/v1/scrape/", {
      method: "POST",
    });
    expect(response.headers.get("X-Credits-Balance")).toBe("3");
    expect(response.headers.get("X-Idempotency-Supported")).toBeNull();
  });
});

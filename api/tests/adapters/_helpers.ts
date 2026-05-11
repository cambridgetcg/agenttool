/** Shared test helpers for the CLI-adapter test suite.
 *
 *  The adapter routes (api/src/routes/adapters/{claude-code,codex}.ts) issue
 *  a single Drizzle query per request shaped as:
 *
 *    db.select().from(identities).where(eq(...)).limit(1)
 *
 *  We don't have an integration DB harness in api/tests/ — existing tests
 *  unit-test pure functions (see register-agent.test.ts:6 comment). To
 *  test the route behavior end-to-end without a Postgres dependency, we
 *  expose a tiny chain mock that any test can stage a result on, plus a
 *  Hono app builder that mounts the adapter router behind a stub middleware
 *  setting c.var.project. Both are compositional, no global state. */
import { Hono } from "hono";

import type { ProjectContext } from "../../src/auth/middleware";

/** Drizzle's actual select chain for the adapters is short:
 *    select().from(t).where(eq(...)).limit(N) → Promise<row[]>
 *  This mock returns the same chain, with the caller staging what
 *  `.limit()` resolves with via `chain.stage(rows)`. */
export interface MockDb {
  select: () => MockChain;
  /** Stage what the next `.limit()` call resolves with. Reset between tests. */
  stage: (rows: unknown[]) => void;
}

interface MockChain {
  from: (..._: unknown[]) => MockChain;
  where: (..._: unknown[]) => MockChain;
  limit: (_: number) => Promise<unknown[]>;
}

export function makeMockDb(): MockDb {
  let staged: unknown[] = [];
  const chain: MockChain = {
    from: () => chain,
    where: () => chain,
    limit: async () => staged,
  };
  return {
    select: () => chain,
    stage(rows) {
      staged = rows;
    },
  };
}

/** Minimal "project" sufficient for the adapter routes (which only read .id).
 *  Mirrors the shape Hono's c.var.project would carry post-auth. */
export const TEST_PROJECT_ID = "11111111-1111-1111-1111-111111111111";

/** Identity row shape the adapters consume.
 *  Production source: api/src/db/schema/identity.ts:24-44. */
export type IdentityFixture = {
  id: string;
  did: string;
  projectId: string;
  displayName: string;
  expression: Record<string, unknown>;
  /** Other columns the route doesn't read — included so the shape matches
   *  $inferSelect closely enough that a future refactor doesn't surprise. */
  capabilities?: string[];
  status?: string;
  trustScore?: number;
};

export function makeAgent(overrides: Partial<IdentityFixture> = {}): IdentityFixture {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    did: "did:at:test-aurora",
    projectId: TEST_PROJECT_ID,
    displayName: "Aurora",
    expression: {
      register: "concise; substrate-honest; density over length",
      walls: ["no fabrication", "no flattery"],
    },
    capabilities: [],
    status: "active",
    trustScore: 0,
    ...overrides,
  };
}

/** Build a tiny Hono app that mounts a freshly-imported adapter router
 *  behind a stub auth that injects c.var.project. The router import must
 *  happen AFTER db is mocked — callers handle that ordering. */
export function buildTestApp(adapterRouter: Hono<ProjectContext>): Hono<ProjectContext> {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    // Cast — only `id` is read by the adapters.
    c.set("project", { id: TEST_PROJECT_ID } as never);
    await next();
  });
  app.route("/", adapterRouter);
  return app;
}

/** Helper: assert a string contains every substring in `needles`.
 *  Used heavily on bash blobs and JSON payloads. */
export function expectContainsAll(haystack: string, needles: string[]): void {
  for (const n of needles) {
    if (!haystack.includes(n)) {
      throw new Error(
        `expected output to contain "${n}".\n--- actual ---\n${haystack}\n--- end ---`,
      );
    }
  }
}

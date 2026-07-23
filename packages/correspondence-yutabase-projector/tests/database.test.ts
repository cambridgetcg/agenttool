import { describe, expect, test } from "bun:test";

import {
  connectTarget,
  transactionWithRetry,
  type Database,
  type Transaction,
} from "../src/database";
import { ProjectorError } from "../src/errors";

function databaseThatFails(
  code: string,
  failures: number,
): { database: Database; attempts: () => number } {
  let attempts = 0;
  const database = {
    async begin<T>(callback: (sql: Transaction) => Promise<T>): Promise<T> {
      attempts += 1;
      if (attempts <= failures) {
        const error = new Error("database failure") as Error & {
          code: string;
        };
        error.code = code;
        throw error;
      }
      return callback({} as Transaction);
    },
  } as unknown as Database;
  return { database, attempts: () => attempts };
}

describe("database retry classification", () => {
  test("programmatic target connections refuse remote PostgreSQL URLs", () => {
    expect(() =>
      connectTarget({
        targetUrl: "postgresql://projector:secret@db.example/yutabase",
      }),
    ).toThrow(ProjectorError);
  });

  test.each(["40001", "40P01", "55P03", "57014"])(
    "retries transient %s without reclassifying it as semantic",
    async (code) => {
      const fixture = databaseThatFails(code, 2);
      await expect(
        transactionWithRetry(fixture.database, async () => "ok"),
      ).resolves.toBe("ok");
      expect(fixture.attempts()).toBe(3);
    },
  );

  test("does not retry integrity failures", async () => {
    const fixture = databaseThatFails("23505", 1);
    await expect(
      transactionWithRetry(fixture.database, async () => "never"),
    ).rejects.toMatchObject({ code: "23505" });
    expect(fixture.attempts()).toBe(1);
  });
});

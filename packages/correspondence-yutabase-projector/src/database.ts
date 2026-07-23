import postgres from "postgres";

import {
  validateLoopbackTargetUrl,
  type TargetConfig,
} from "./config.js";

export type Database = ReturnType<typeof postgres>;
export type Transaction = postgres.TransactionSql;

const TRANSIENT_DATABASE_CODES = new Set([
  "40001",
  "40P01",
  "55P03",
  "57014",
]);

export function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export function isTransientDatabaseError(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return code !== undefined && TRANSIENT_DATABASE_CODES.has(code);
}

export function isDatabaseAvailabilityError(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return (
    code !== undefined &&
    (code.startsWith("08") ||
      ["57P01", "57P02", "57P03", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"].includes(
        code,
      ))
  );
}

export async function transactionWithRetry<T>(
  database: Database,
  callback: (sql: Transaction) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return (await database.begin(callback)) as T;
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt === attempts) {
        throw error;
      }
    }
  }
  throw new Error("unreachable");
}

export function connectTarget(config: Pick<TargetConfig, "targetUrl">): Database {
  const targetUrl = validateLoopbackTargetUrl(config.targetUrl);
  return postgres(targetUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    max_lifetime: 60,
    onnotice: () => undefined,
  });
}

export async function closeTarget(database: Database): Promise<void> {
  await database.end({ timeout: 5 });
}

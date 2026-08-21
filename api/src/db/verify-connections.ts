/** Bounded, read-only proof of both deployed Supabase data-plane paths.
 *
 * The deploy verifier executes this file inside each started Fly image. It
 * intentionally emits no success details and collapses driver errors to a
 * credential-free endpoint label.
 */

import postgres from "./verified-postgres";

import { validateFlyDatabaseTargets } from "./supabase-target";

export type DatabaseProbeEndpoint = "transaction" | "session";

export interface DatabaseProbe {
  selectOne(): Promise<boolean>;
  close(): Promise<void>;
}

export type DatabaseProbeFactory = (
  endpoint: DatabaseProbeEndpoint,
  url: string,
) => DatabaseProbe;

interface VerifyDatabaseConnectionsOptions {
  transactionUrl?: string;
  sessionUrl?: string;
  openProbe?: DatabaseProbeFactory;
  queryTimeoutMs?: number;
  closeTimeoutMs?: number;
}

const QUERY_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 3_000;

async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("database verification timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function openPostgresProbe(
  _endpoint: DatabaseProbeEndpoint,
  url: string,
): DatabaseProbe {
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
  });
  return {
    async selectOne() {
      const rows = await sql<Array<{ ok: number }>>`SELECT 1::int AS ok`;
      return rows.length === 1 && rows[0]?.ok === 1;
    },
    async close() {
      await sql.end({ timeout: 2 });
    },
  };
}

async function verifyEndpoint(
  endpoint: DatabaseProbeEndpoint,
  url: string,
  openProbe: DatabaseProbeFactory,
  queryTimeoutMs: number,
  closeTimeoutMs: number,
): Promise<void> {
  let probe: DatabaseProbe | undefined;
  let failed = false;
  try {
    probe = openProbe(endpoint, url);
    if (!(await bounded(probe.selectOne(), queryTimeoutMs))) failed = true;
  } catch {
    failed = true;
  }

  if (probe) {
    try {
      await bounded(probe.close(), closeTimeoutMs);
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error(`${endpoint} database verification failed`);
}

export async function verifyDeployedDatabaseConnections(
  options: VerifyDatabaseConnectionsOptions = {},
): Promise<void> {
  const transactionUrl =
    options.transactionUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  const sessionUrl =
    options.sessionUrl ?? process.env.DATABASE_SESSION_URL?.trim() ?? "";
  validateFlyDatabaseTargets(transactionUrl, sessionUrl);

  const openProbe = options.openProbe ?? openPostgresProbe;
  const queryTimeoutMs = options.queryTimeoutMs ?? QUERY_TIMEOUT_MS;
  const closeTimeoutMs = options.closeTimeoutMs ?? CLOSE_TIMEOUT_MS;
  if (queryTimeoutMs <= 0 || closeTimeoutMs <= 0) {
    throw new Error("database verification timeout is invalid");
  }

  await verifyEndpoint(
    "transaction",
    transactionUrl,
    openProbe,
    queryTimeoutMs,
    closeTimeoutMs,
  );
  await verifyEndpoint(
    "session",
    sessionUrl,
    openProbe,
    queryTimeoutMs,
    closeTimeoutMs,
  );
}

if (import.meta.main) {
  try {
    await verifyDeployedDatabaseConnections();
  } catch {
    console.error("deployed database verification failed");
    process.exit(1);
  }
}

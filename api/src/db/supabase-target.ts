/** Authenticated TLS and endpoint identity for AgentTool Postgres clients.
 *
 * Supabase direct hosts carry the project ref in the hostname; pooler hosts
 * carry it as the final database-username component. Returned identities omit
 * passwords and raw URLs so callers can compare targets without logging
 * credentials.
 */

import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type SupabasePool = "transaction" | "session";

export interface SupabaseDatabaseTarget {
  projectRef: string;
  pool: SupabasePool;
  database: string;
  logicalUsername: string;
  hostname: string;
  transport: "direct" | "pooler";
}

export type PostgresSslOption =
  | false
  | {
      ca: string;
      rejectUnauthorized: true;
      servername: string;
    };

type Environment = Readonly<Record<string, string | undefined>>;

const PROJECT_REF = /^[a-z0-9]{20}$/;
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const SAFE_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);
const TLS_OVERRIDE_KEYS = [
  "ssl",
  "sslcert",
  "sslkey",
  "sslpassword",
  "sslrootcert",
] as const;

export const AGENTTOOL_PRODUCTION_SUPABASE_PROJECT_REF =
  "jseqftufplgewhojwbmh";
export const AGENTTOOL_PRODUCTION_SUPABASE_POOLER_HOST =
  "aws-1-eu-west-2.pooler.supabase.com";
export const AGENTTOOL_PRODUCTION_SUPABASE_DATABASE = "postgres";
export const AGENTTOOL_PRODUCTION_SUPABASE_LOGICAL_USERNAME = "postgres";
export const SUPABASE_PROD_CA_2021_SOURCE =
  "https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt";
export const SUPABASE_PROD_CA_2021_PEM_SHA256 =
  "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";
export const SUPABASE_PROD_CA_2021_FINGERPRINT_SHA256 =
  "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa";

const SUPABASE_CA_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "certs",
  "supabase-prod-ca-2021.crt",
);

function parsePostgresUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (!POSTGRES_PROTOCOLS.has(url.protocol) || url.hash !== "") return null;
    return url;
  } catch {
    return null;
  }
}

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function databaseName(url: URL): string | null {
  const rawValue = url.pathname.slice(1);
  const decodedValue = decoded(rawValue);
  return rawValue &&
      decodedValue === rawValue &&
      !rawValue.includes("/")
    ? rawValue
    : null;
}

function assertNoTlsDowngrade(url: URL): void {
  for (const mode of url.searchParams.getAll("sslmode")) {
    if (!SAFE_SSL_MODES.has(mode.toLowerCase())) {
      throw new Error("database URL requests an unsafe TLS posture");
    }
  }
  for (const key of TLS_OVERRIDE_KEYS) {
    if (url.searchParams.has(key)) {
      throw new Error("database URL must not override the client TLS object");
    }
  }
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function isSupabaseHostname(hostname: string): boolean {
  return (
    /^db\.[a-z0-9]{20}\.supabase\.co$/.test(hostname) ||
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname)
  );
}

function assertNoSupabaseQueryOverrides(url: URL): void {
  if (isSupabaseHostname(normalizedHostname(url)) && url.search !== "") {
    throw new Error("Supabase database URL query parameters are not supported");
  }
}

export function isLoopbackDatabaseUrl(raw: string): boolean {
  const url = parsePostgresUrl(raw);
  if (!url) return false;
  const hostname = normalizedHostname(url);
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.")
  );
}

/** Exact plaintext exception for the disposable Forgejo service container.
 * It is opt-in, CI-only, and structurally impossible on a Fly Machine. */
export function isDisposableCiPostgresUrl(
  raw: string,
  environment: Environment = process.env,
): boolean {
  if (
    environment.AGENTTOOL_ALLOW_DISPOSABLE_CI_POSTGRES !== "1" ||
    environment.CI !== "true" ||
    environment.FLY_MACHINE_ID
  ) {
    return false;
  }
  const url = parsePostgresUrl(raw);
  if (!url || url.search !== "") return false;
  return (
    normalizedHostname(url) === "postgres" &&
    url.port === "5432" &&
    databaseName(url) === "agenttool_ci" &&
    decoded(url.username) === "postgres" &&
    decoded(url.password) === "postgres"
  );
}

export function loadVerifiedSupabaseCa(now = Date.now()): string {
  const bytes = readFileSync(SUPABASE_CA_PATH);
  const pemHash = createHash("sha256").update(bytes).digest("hex");
  if (pemHash !== SUPABASE_PROD_CA_2021_PEM_SHA256) {
    throw new Error("vendored Supabase database CA bytes mismatch");
  }

  const ca = bytes.toString("utf8");
  const certificate = new X509Certificate(ca);
  const fingerprint = certificate.fingerprint256
    .replaceAll(":", "")
    .toLowerCase();
  if (fingerprint !== SUPABASE_PROD_CA_2021_FINGERPRINT_SHA256) {
    throw new Error("vendored Supabase database CA fingerprint mismatch");
  }

  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (
    !Number.isFinite(validFrom) ||
    !Number.isFinite(validTo) ||
    now < validFrom ||
    now >= validTo
  ) {
    throw new Error("vendored Supabase database CA is outside its validity window");
  }
  return ca;
}

export function parseSupabaseDatabaseTarget(
  raw: string,
  expectedPool?: SupabasePool,
): SupabaseDatabaseTarget | null {
  const url = parsePostgresUrl(raw);
  if (!url || url.search !== "") return null;

  const database = databaseName(url);
  const username = decoded(url.username);
  const password = decoded(url.password);
  if (!database || !username || !password) return null;

  const hostname = normalizedHostname(url);
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(hostname);
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname);
  if (!direct && !pooler) return null;

  let projectRef: string;
  let logicalUsername: string;
  let pool: SupabasePool;
  let transport: "direct" | "pooler";

  if (direct) {
    projectRef = direct[1]!;
    logicalUsername = username;
    pool = "session";
    transport = "direct";
    if (url.port !== "" && url.port !== "5432") return null;
  } else {
    const separator = username.lastIndexOf(".");
    if (separator <= 0) return null;
    logicalUsername = username.slice(0, separator);
    projectRef = username.slice(separator + 1);
    if (url.port === "6543") {
      pool = "transaction";
    } else if (url.port === "5432") {
      pool = "session";
    } else {
      return null;
    }
    transport = "pooler";
  }

  if (
    !PROJECT_REF.test(projectRef) ||
    logicalUsername.length === 0 ||
    (expectedPool !== undefined && pool !== expectedPool)
  ) {
    return null;
  }

  return {
    projectRef,
    pool,
    database,
    logicalUsername,
    hostname,
    transport,
  };
}

export function isSupabaseDatabaseUrl(raw: string): boolean {
  return parseSupabaseDatabaseTarget(raw) !== null;
}

export function postgresSslForDatabaseUrl(
  raw: string,
  environment: Environment = process.env,
): PostgresSslOption {
  const url = parsePostgresUrl(raw);
  if (!url) throw new Error("database URL is malformed or not PostgreSQL");
  assertNoTlsDowngrade(url);
  assertNoSupabaseQueryOverrides(url);

  if (parseSupabaseDatabaseTarget(raw)) {
    return {
      ca: loadVerifiedSupabaseCa(),
      rejectUnauthorized: true,
      servername: normalizedHostname(url),
    };
  }
  if (isLoopbackDatabaseUrl(raw)) return false;
  if (isDisposableCiPostgresUrl(raw, environment)) return false;
  throw new Error("unsupported remote database target; authenticated TLS is not configured");
}

export function validateFlyDatabaseTargets(
  transactionUrl: string,
  sessionUrl: string,
): SupabaseDatabaseTarget {
  if (!transactionUrl || !sessionUrl) {
    throw new Error("Fly requires explicit DATABASE_URL and DATABASE_SESSION_URL");
  }
  if (transactionUrl === sessionUrl) {
    throw new Error("Fly transaction and session database URLs must be distinct");
  }

  for (const raw of [transactionUrl, sessionUrl]) {
    const url = parsePostgresUrl(raw);
    if (url) {
      assertNoTlsDowngrade(url);
      assertNoSupabaseQueryOverrides(url);
    }
  }

  const transaction = parseSupabaseDatabaseTarget(
    transactionUrl,
    "transaction",
  );
  const session = parseSupabaseDatabaseTarget(sessionUrl, "session");
  if (!transaction || !session || session.transport !== "pooler") {
    throw new Error(
      "Fly database URLs must be a Supabase transaction/session pooler pair",
    );
  }
  if (
    transaction.projectRef !== session.projectRef ||
    transaction.database !== session.database ||
    transaction.logicalUsername !== session.logicalUsername ||
    transaction.hostname !== session.hostname
  ) {
    throw new Error(
      "Fly database URLs must bind the same Supabase host, project, database, and logical role",
    );
  }
  if (transaction.projectRef !== AGENTTOOL_PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error(
      "Fly database URLs do not match the source-pinned production project",
    );
  }
  if (transaction.hostname !== AGENTTOOL_PRODUCTION_SUPABASE_POOLER_HOST) {
    throw new Error(
      "Fly database URLs do not match the source-pinned production pooler host",
    );
  }
  if (transaction.database !== AGENTTOOL_PRODUCTION_SUPABASE_DATABASE) {
    throw new Error(
      "Fly database URLs do not match the source-pinned production database",
    );
  }
  if (
    transaction.logicalUsername !==
      AGENTTOOL_PRODUCTION_SUPABASE_LOGICAL_USERNAME
  ) {
    throw new Error(
      "Fly database URLs do not match the source-pinned production logical role",
    );
  }

  // Exercise URL downgrade checks and the vendored certificate before any
  // Postgres client is constructed. Both calls return authenticated objects.
  postgresSslForDatabaseUrl(transactionUrl);
  postgresSslForDatabaseUrl(sessionUrl);
  return transaction;
}

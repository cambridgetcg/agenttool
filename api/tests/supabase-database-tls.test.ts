import { describe, expect, test } from "bun:test";
import { createHash, X509Certificate } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  AGENTTOOL_PRODUCTION_SUPABASE_DATABASE,
  AGENTTOOL_PRODUCTION_SUPABASE_LOGICAL_USERNAME,
  AGENTTOOL_PRODUCTION_SUPABASE_POOLER_HOST,
  AGENTTOOL_PRODUCTION_SUPABASE_PROJECT_REF,
  isDisposableCiPostgresUrl,
  isLoopbackDatabaseUrl,
  loadVerifiedSupabaseCa,
  parseSupabaseDatabaseTarget,
  postgresSslForDatabaseUrl,
  SUPABASE_PROD_CA_2021_FINGERPRINT_SHA256,
  SUPABASE_PROD_CA_2021_PEM_SHA256,
  SUPABASE_PROD_CA_2021_SOURCE,
  validateFlyDatabaseTargets,
} from "../src/db/supabase-target";
import {
  type DatabaseProbeFactory,
  verifyDeployedDatabaseConnections,
} from "../src/db/verify-connections";
import verifiedTestPostgres from "./fixtures/verified-postgres";

const apiRoot = resolve(import.meta.dir, "..");
const projectRoot = resolve(apiRoot, "..");
const ref = AGENTTOOL_PRODUCTION_SUPABASE_PROJECT_REF;
const pooler = "aws-1-eu-west-2.pooler.supabase.com";
const transactionUrl =
  `postgresql://postgres.${ref}:secret@${pooler}:6543/postgres`;
const sessionUrl =
  `postgresql://postgres.${ref}:secret@${pooler}:5432/postgres`;

async function recursiveSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests" || entry.name === "node_modules") continue;
      files.push(...await recursiveSourceFiles(path));
    } else if (/\.(?:ts|js|mjs|cjs|sh|py)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

async function recursiveMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await recursiveMarkdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

function importConfigWith(
  databaseUrl: string | undefined,
  databaseSessionUrl: string | undefined,
) {
  const configUrl = pathToFileURL(join(apiRoot, "src", "config.ts")).href;
  return Bun.spawnSync(
    [
      process.execPath,
      "--no-install",
      "--no-env-file",
      "-e",
      `await import(${JSON.stringify(configUrl)})`,
    ],
    {
      cwd: apiRoot,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        FLY_MACHINE_ID: "fixture-machine",
        ...(databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl }),
        ...(databaseSessionUrl === undefined
          ? {}
          : { DATABASE_SESSION_URL: databaseSessionUrl }),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

describe("Supabase database TLS", () => {
  test("pins the exact official CA bytes, certificate, and validity", async () => {
    const bytes = await readFile(
      join(apiRoot, "certs", "supabase-prod-ca-2021.crt"),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      SUPABASE_PROD_CA_2021_PEM_SHA256,
    );
    const certificate = new X509Certificate(bytes);
    expect(certificate.fingerprint256.replaceAll(":", "").toLowerCase()).toBe(
      SUPABASE_PROD_CA_2021_FINGERPRINT_SHA256,
    );
    expect(certificate.ca).toBe(true);
    expect(SUPABASE_PROD_CA_2021_SOURCE).toBe(
      "https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt",
    );
    expect(loadVerifiedSupabaseCa()).toContain("BEGIN CERTIFICATE");
    expect(() => loadVerifiedSupabaseCa(Date.UTC(2020, 0, 1))).toThrow(
      "outside its validity window",
    );
    expect(() => loadVerifiedSupabaseCa(Date.UTC(2032, 0, 1))).toThrow(
      "outside its validity window",
    );
  });

  test("parses pool identity without retaining credentials", () => {
    expect(parseSupabaseDatabaseTarget(transactionUrl, "transaction")).toEqual({
      projectRef: ref,
      pool: "transaction",
      database: "postgres",
      logicalUsername: "postgres",
      hostname: pooler,
      transport: "pooler",
    });
    expect(parseSupabaseDatabaseTarget(sessionUrl, "session")).toEqual({
      projectRef: ref,
      pool: "session",
      database: "postgres",
      logicalUsername: "postgres",
      hostname: pooler,
      transport: "pooler",
    });
    expect(
      parseSupabaseDatabaseTarget(
        `postgresql://agenttool_app:secret@db.${ref}.supabase.co:5432/postgres`,
        "session",
      ),
    ).toMatchObject({
      projectRef: ref,
      pool: "session",
      logicalUsername: "agenttool_app",
      transport: "direct",
    });
    expect(parseSupabaseDatabaseTarget(transactionUrl, "session")).toBeNull();
    expect(
      parseSupabaseDatabaseTarget(
        transactionUrl.replace(":6543/postgres", ":6543/post%67res"),
      ),
    ).toBeNull();
    expect(AGENTTOOL_PRODUCTION_SUPABASE_POOLER_HOST).toBe(pooler);
    expect(AGENTTOOL_PRODUCTION_SUPABASE_DATABASE).toBe("postgres");
    expect(AGENTTOOL_PRODUCTION_SUPABASE_LOGICAL_USERNAME).toBe("postgres");
  });

  test("returns CA-authenticated TLS for Supabase and only plaintext loopback", () => {
    const ssl = postgresSslForDatabaseUrl(transactionUrl);
    expect(ssl).not.toBe(false);
    expect(ssl).toMatchObject({
      rejectUnauthorized: true,
      servername: pooler,
    });
    expect(typeof ssl === "object" && ssl.ca).toContain("BEGIN CERTIFICATE");

    expect(
      postgresSslForDatabaseUrl("postgres://postgres:postgres@localhost:5432/test"),
    ).toBe(false);
    expect(
      postgresSslForDatabaseUrl("postgres://postgres:postgres@[::1]:5432/test"),
    ).toBe(false);
    expect(
      isLoopbackDatabaseUrl("postgres://postgres:postgres@127.42.0.1:5432/test"),
    ).toBe(true);

    for (const unsafe of ["disable", "allow", "prefer", "unknown", ""]) {
      expect(() =>
        postgresSslForDatabaseUrl(`${transactionUrl}?sslmode=${unsafe}`)
      ).toThrow("unsafe TLS posture");
    }
    expect(() => postgresSslForDatabaseUrl(`${transactionUrl}?ssl=false`)).toThrow(
      "must not override",
    );
    expect(() =>
      postgresSslForDatabaseUrl(`${transactionUrl}?sslrootcert=/tmp/attacker.pem`)
    ).toThrow("must not override");
    expect(() =>
      postgresSslForDatabaseUrl(
        "postgres://operator:secret@database.example.test:5432/postgres",
      )
    ).toThrow("unsupported remote database target");
    expect(() => postgresSslForDatabaseUrl("https://example.test/postgres")).toThrow(
      "malformed or not PostgreSQL",
    );
  });

  test("binds Fly URLs to one exact project, database, role, and pool pair", () => {
    expect(validateFlyDatabaseTargets(transactionUrl, sessionUrl)).toMatchObject({
      projectRef: ref,
      pool: "transaction",
      database: "postgres",
      logicalUsername: "postgres",
    });
    expect(() => validateFlyDatabaseTargets(transactionUrl, "")).toThrow(
      "requires explicit",
    );
    expect(() => validateFlyDatabaseTargets(transactionUrl, transactionUrl)).toThrow(
      "must be distinct",
    );
    expect(() =>
      validateFlyDatabaseTargets(
        transactionUrl,
        sessionUrl.replace("postgres.", "reader."),
      )
    ).toThrow("same Supabase host, project, database, and logical role");
    expect(() =>
      validateFlyDatabaseTargets(
        transactionUrl,
        sessionUrl.replace(":5432/postgres", ":5432/shadow"),
      )
    ).toThrow("same Supabase host, project, database, and logical role");
    expect(() =>
      validateFlyDatabaseTargets(
        transactionUrl,
        `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres`,
      )
    ).toThrow("transaction/session pooler pair");
    expect(() =>
      validateFlyDatabaseTargets(
        transactionUrl,
        sessionUrl.replace(
          pooler,
          "aws-0-eu-central-1.pooler.supabase.com",
        ),
      )
    ).toThrow("same Supabase host");
    expect(() =>
      validateFlyDatabaseTargets(
        transactionUrl.replace(
          pooler,
          "aws-0-eu-central-1.pooler.supabase.com",
        ),
        sessionUrl.replace(
          pooler,
          "aws-0-eu-central-1.pooler.supabase.com",
        ),
      )
    ).toThrow("source-pinned production pooler host");
    expect(() =>
      validateFlyDatabaseTargets(
        transactionUrl.replace(":6543/postgres", ":6543/shadow"),
        sessionUrl.replace(":5432/postgres", ":5432/shadow"),
      )
    ).toThrow("source-pinned production database");
    expect(() =>
      validateFlyDatabaseTargets(
        transactionUrl.replace("postgres.", "agenttool_app."),
        sessionUrl.replace("postgres.", "agenttool_app."),
      )
    ).toThrow("source-pinned production logical role");
    expect(() =>
      validateFlyDatabaseTargets(
        `${transactionUrl}?user=agenttool_app&database=shadow`,
        `${sessionUrl}?user=agenttool_app&database=shadow`,
      )
    ).toThrow("query parameters are not supported");
    const encodedTransaction = transactionUrl.replace(
      ":6543/postgres",
      ":6543/post%67res",
    );
    const encodedSession = sessionUrl.replace(
      ":5432/postgres",
      ":5432/post%67res",
    );
    expect(() =>
      validateFlyDatabaseTargets(encodedTransaction, encodedSession)
    ).toThrow("transaction/session pooler pair");
    expect(() => verifiedTestPostgres(encodedTransaction)).toThrow(
      "unsupported remote database target",
    );
    const passwordlessTransaction = transactionUrl.replace(":secret@", "@");
    expect(parseSupabaseDatabaseTarget(passwordlessTransaction)).toBeNull();
    expect(() =>
      postgresSslForDatabaseUrl(passwordlessTransaction, {
        PGPASSWORD: "ambient-fallback-must-not-apply",
      })
    ).toThrow("unsupported remote database target");
    expect(() =>
      validateFlyDatabaseTargets(passwordlessTransaction, sessionUrl)
    ).toThrow("transaction/session pooler pair");
    expect(() =>
      validateFlyDatabaseTargets(transactionUrl, `${sessionUrl}?sslmode=disable`)
    ).toThrow("unsafe TLS posture");
  });

  test("keeps the disposable sibling-service plaintext exception exact", () => {
    const ciUrl =
      "postgres://postgres:postgres@postgres:5432/agenttool_ci";
    const ciEnvironment = {
      AGENTTOOL_ALLOW_DISPOSABLE_CI_POSTGRES: "1",
      CI: "true",
    };
    expect(isDisposableCiPostgresUrl(ciUrl, ciEnvironment)).toBe(true);
    expect(postgresSslForDatabaseUrl(ciUrl, ciEnvironment)).toBe(false);

    for (const [url, environment] of [
      [ciUrl, {}],
      [ciUrl, { AGENTTOOL_ALLOW_DISPOSABLE_CI_POSTGRES: "1" }],
      [ciUrl, { ...ciEnvironment, FLY_MACHINE_ID: "machine" }],
      [ciUrl.replace("@postgres:", "@database:"), ciEnvironment],
      [ciUrl.replace("/agenttool_ci", "/postgres"), ciEnvironment],
      [ciUrl.replace("postgres:postgres@", "operator:postgres@"), ciEnvironment],
      [ciUrl.replace(":5432/", ":6543/"), ciEnvironment],
      [`${ciUrl}?application_name=test`, ciEnvironment],
    ] as const) {
      expect(isDisposableCiPostgresUrl(url, environment)).toBe(false);
      expect(() => postgresSslForDatabaseUrl(url, environment)).toThrow(
        "unsupported remote database target",
      );
    }
  });

  test("central constructor rejects target overrides and authenticates normal callers", async () => {
    if (false) {
      // @ts-expect-error target identity must come only from the validated URL
      verifiedTestPostgres(transactionUrl, { host: "attacker.invalid" });
      // @ts-expect-error startup connection may carry only application_name
      verifiedTestPostgres(transactionUrl, { connection: { user: "attacker" } });
    }
    for (const options of [
      { ssl: false },
      { host: "attacker.invalid" },
      { port: 5432 },
      { user: "attacker" },
      { database: "shadow" },
      { password: "ambient" },
      { sslnegotiation: "direct" },
    ]) {
      expect(() => verifiedTestPostgres(transactionUrl, options as never)).toThrow(
        "may not override target or transport",
      );
    }
    for (const connection of [
      { user: "attacker" },
      { database: "shadow" },
      { application_name: "reviewed", user: "attacker" },
    ]) {
      expect(() =>
        verifiedTestPostgres(transactionUrl, { connection } as never)
      ).toThrow("may set only application_name");
    }

    const sql = verifiedTestPostgres(transactionUrl, {
      max: 1,
      connection: { application_name: "agenttool-tls-test" },
    });
    try {
      expect(sql.options.ssl).toMatchObject({
        rejectUnauthorized: true,
        servername: pooler,
      });
    } finally {
      await sql.end({ timeout: 0 });
    }
  });

  test("deployed verifier probes both paths and redacts credential failures", async () => {
    const calls: string[] = [];
    const openProbe: DatabaseProbeFactory = (endpoint, url) => ({
      async selectOne() {
        calls.push(`select:${endpoint}:${url === transactionUrl ? "tx" : "session"}`);
        return true;
      },
      async close() {
        calls.push(`close:${endpoint}`);
      },
    });
    await verifyDeployedDatabaseConnections({
      transactionUrl,
      sessionUrl,
      openProbe,
      queryTimeoutMs: 100,
      closeTimeoutMs: 100,
    });
    expect(calls).toEqual([
      "select:transaction:tx",
      "close:transaction",
      "select:session:session",
      "close:session",
    ]);

    let failure = "";
    try {
      await verifyDeployedDatabaseConnections({
        transactionUrl,
        sessionUrl,
        openProbe: (endpoint) => ({
          async selectOne() {
            if (endpoint === "session") {
              throw new Error(`credential secret leaked from ${sessionUrl}`);
            }
            return true;
          },
          async close() {},
        }),
        queryTimeoutMs: 100,
        closeTimeoutMs: 100,
      });
    } catch (error) {
      failure = String(error);
    }
    expect(failure).toContain("session database verification failed");
    expect(failure).not.toContain("secret");
    expect(failure).not.toContain(pooler);
  });

  test("fails closed while either Fly database secret is absent or misbound", () => {
    expect(importConfigWith(transactionUrl, sessionUrl).exitCode).toBe(0);
    expect(importConfigWith(transactionUrl, undefined).exitCode).not.toBe(0);
    expect(
      importConfigWith(
        transactionUrl,
        sessionUrl.replace("postgres.", "reader."),
      ).exitCode,
    ).not.toBe(0);
  });

  test("discovers and covers every non-test runtime/operator Postgres client", async () => {
    const candidates = (
      await Promise.all([
        recursiveSourceFiles(join(apiRoot, "src")),
        recursiveSourceFiles(join(apiRoot, "scripts")),
        recursiveSourceFiles(join(projectRoot, "bin")),
      ])
    ).flat();

    const directPostgresClients: string[] = [];
    const directPostgresImports: string[] = [];
    const psycopgClients: string[] = [];
    const verifiedConstructor = join(apiRoot, "src", "db", "verified-postgres.ts");
    for (const path of candidates) {
      const source = await readFile(path, "utf8");
      expect(source).not.toMatch(/ssl\s*:\s*["']require["']/);
      expect(source).not.toContain("rejectUnauthorized: false");
      if (
        /from\s+["']postgres["']|import\(\s*["']postgres["']\s*\)|require\(\s*["']postgres["']\s*\)/.test(
          source,
        )
      ) {
        directPostgresImports.push(path);
      }
      if (/\bpostgres\s*\(/.test(source)) {
        directPostgresClients.push(path);
        if (path === verifiedConstructor) {
          expect(source).toContain('import postgres from "postgres"');
          expect(source).toContain("...options");
          expect(source.indexOf("...options")).toBeLessThan(
            source.indexOf("ssl: postgresSslForDatabaseUrl(url)"),
          );
        } else {
          expect(source).toContain("verified-postgres");
          expect(source).not.toMatch(
            /import\s+(?!type\b)[^;\n]+from\s+["']postgres["']/,
          );
        }
      }
      if (/psycopg2?\.connect\s*\(/.test(source)) {
        psycopgClients.push(path);
        expect(source).toContain("postgres_tls_kwargs(DATABASE_URL)");
        expect(source).not.toContain("psycopg2.connect(DATABASE_URL) as conn");
      }
    }

    expect(directPostgresClients.length).toBeGreaterThanOrEqual(15);
    expect(directPostgresImports).toEqual([verifiedConstructor]);
    expect(psycopgClients).toEqual([
      join(apiRoot, "scripts", "_smoke-vault.py"),
    ]);
    const pythonTls = await readFile(
      join(apiRoot, "scripts", "_postgres_tls.py"),
      "utf8",
    );
    expect(pythonTls).toContain('"sslmode": "verify-full"');
    expect(pythonTls).toContain('"sslrootcert": SUPABASE_CA_PATH');
    expect(pythonTls).toContain("if parsed.query:");
    expect(pythonTls).toContain("not parsed.password");

    const pythonProbe = [
      "import sys",
      "from _postgres_tls import postgres_tls_kwargs",
      "try:",
      "    postgres_tls_kwargs(sys.argv[1])",
      "except RuntimeError:",
      "    raise SystemExit(0)",
      "raise SystemExit(1)",
    ].join("\n");
    for (const hostile of [
      `${transactionUrl}?host=attacker.invalid`,
      `${transactionUrl}?user=attacker`,
      `${transactionUrl}?dbname=shadow`,
      transactionUrl.replace(":secret@", "@"),
      transactionUrl.replace(":6543/postgres", ":6543/"),
      transactionUrl.replace(":6543/postgres", ":6543/%ZZ"),
      transactionUrl.replace(":6543/postgres", ":not-a-port/postgres"),
    ]) {
      const result = Bun.spawnSync(["python3", "-c", pythonProbe, hostile], {
        cwd: join(apiRoot, "scripts"),
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe("");
    }

    for (const path of await recursiveMarkdownFiles(join(projectRoot, "docs"))) {
      const source = await readFile(path, "utf8");
      expect(source).not.toMatch(
        /^\s*import\s+(?!type\b)[^\n]+from\s+["']postgres["'];?\s*$/m,
      );
      expect(source).not.toMatch(/\bpostgres\s*\(\s*DATABASE(?:_SESSION)?_URL/);
    }

    // This package owns a deliberately separate loopback-only PostgreSQL
    // sidecar; its strict URL validator is the explicit remote-TLS exclusion.
    const yutabaseConfig = await readFile(
      join(
        projectRoot,
        "packages",
        "correspondence-yutabase-projector",
        "src",
        "config.ts",
      ),
      "utf8",
    );
    expect(yutabaseConfig).toContain("validateLoopbackTargetUrl");
    expect(yutabaseConfig).toContain("isLoopbackHostname");
    const yutabaseDatabase = await readFile(
      join(
        projectRoot,
        "packages",
        "correspondence-yutabase-projector",
        "src",
        "database.ts",
      ),
      "utf8",
    );
    expect(yutabaseDatabase).toContain(
      "const targetUrl = validateLoopbackTargetUrl(config.targetUrl)",
    );
    expect(yutabaseDatabase).toContain("return postgres(targetUrl,");
  });

  test("routes every real test Postgres client through one verified wrapper", async () => {
    const candidates = await recursiveSourceFiles(join(apiRoot, "tests"));
    const wrapper = join(
      apiRoot,
      "tests",
      "fixtures",
      "verified-postgres.ts",
    );
    const sourceOnlyCalls = new Map([
      [join(apiRoot, "tests", "migration-runner-safety.test.ts"), 1],
      [join(apiRoot, "tests", "supabase-database-tls.test.ts"), 1],
    ]);
    const realClientPaths: string[] = [];
    const directValueImportPaths: string[] = [];

    for (const path of candidates) {
      const source = await readFile(path, "utf8");
      if (
        /^\s*import\s+(?!type\b)[^\n]+from\s+["']postgres["'];?\s*$/m.test(
          source,
        ) ||
        /^\s*(?!["'`])(?:const\s+[^=\n]+?=\s*)?await\s+import\(\s*["']postgres["']\s*\)/m.test(
          source,
        ) ||
        /^\s*(?!["'`])(?:const\s+[^=\n]+?=\s*)?require\(\s*["']postgres["']\s*\)/m.test(
          source,
        )
      ) {
        directValueImportPaths.push(path);
      }
      const callCount = source.match(/\bpostgres\s*\(/g)?.length ?? 0;
      if (callCount === 0) continue;

      const fixtureCallCount = sourceOnlyCalls.get(path);
      if (fixtureCallCount !== undefined) {
        expect(callCount).toBe(fixtureCallCount);
        continue;
      }

      realClientPaths.push(path);
      expect(source).toMatch(
        /import postgres from ["']\.\.?(?:\/\.\.)?\/fixtures\/verified-postgres["']/,
      );
      expect(source).not.toMatch(
        /import\s+(?!type\b)[^;\n]+from\s+["']postgres["']/,
      );
    }

    expect(realClientPaths.length).toBeGreaterThanOrEqual(44);
    expect(realClientPaths).not.toContain(wrapper);
    expect(directValueImportPaths).toEqual([]);
    expect(await readFile(wrapper, "utf8")).toContain(
      'export { default } from "../../src/db/verified-postgres"',
    );
  });

  test("packages the CA and preserves stronger deploy verification", async () => {
    const [
      dockerfile,
      dockerignore,
      deploy,
      procedure,
      verifier,
      packageJson,
      forgejo,
    ] = await Promise.all([
      readFile(join(apiRoot, "Dockerfile"), "utf8"),
      readFile(join(apiRoot, ".dockerignore"), "utf8"),
      readFile(join(projectRoot, "bin", "deploy.sh"), "utf8"),
      readFile(join(projectRoot, "docs", "DEPLOY-PROCEDURE.md"), "utf8"),
      readFile(join(apiRoot, "src", "db", "verify-connections.ts"), "utf8"),
      readFile(join(apiRoot, "package.json"), "utf8"),
      readFile(
        join(projectRoot, ".forgejo", "workflows", "ci.yml"),
        "utf8",
      ),
    ]);
    expect(dockerfile).toContain("COPY certs ./certs");
    expect(dockerfile).toContain("test -s certs/supabase-prod-ca-2021.crt");
    expect(dockerignore).toContain("!certs/supabase-prod-ca-2021.crt");
    expect(deploy.match(/--dns-checks=false/g)?.length).toBe(2);
    expect(deploy).toContain("--strategy rolling");
    expect(deploy).toContain("$HEALTH_URL?revision=$HEAD_REVISION&dirty=$API_SOURCE_DIRTY");
    expect(deploy).toContain("verify_fly_machine_source_silently");
    expect(deploy).toContain("verify_maintenance_runtime_environment");
    expect(deploy).toContain("/app/src/db/verify-connections.ts");
    expect(deploy).toContain(">/dev/null 2>&1");
    expect(deploy).toContain('hasOwnProperty.call(environment, "DATABASE_URL")');
    expect(deploy).toContain('["bun", "run", "src/thinker.ts"]');
    expect(deploy).toContain("machines.length !== 5");
    expect(deploy).toContain('thinkerStates.join(",") !== "started,stopped"');
    expect(deploy).toContain('child.kill("SIGTERM")');
    expect(deploy).toContain('child.kill("SIGKILL")');
    expect(deploy).toContain("const exitCode = await child.exited");
    expect(verifier).toContain("validateFlyDatabaseTargets");
    expect(verifier).toContain("SELECT 1::int AS ok");
    expect(verifier).toContain('import postgres from "./verified-postgres"');
    expect(verifier).not.toContain("console.log");
    expect(packageJson).toContain('"db:migrate": "../bin/migrate-pending.sh"');
    expect(packageJson).toContain("db:studio retired");
    expect(packageJson).not.toContain("drizzle-kit migrate");
    expect(packageJson).not.toContain("drizzle-kit studio");
    expect(forgejo).toContain("AGENTTOOL_ALLOW_DISPOSABLE_CI_POSTGRES");
    expect(forgejo).toContain("DATABASE_SESSION_URL:");
    expect(procedure).toMatch(/advisory direct query to a public\s+resolver/);
  });
});

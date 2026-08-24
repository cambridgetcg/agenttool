/** Focused invariants for the hermetic preflight and required-capable CI. */

import { describe, expect, test } from "bun:test";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

const DATABASE_TOP_LEVEL = [
  "tests/activity.test.ts",
  "tests/billing-session-code.test.ts",
  "tests/billing-webhook.test.ts",
  "tests/covenants-cosign-propagate.test.ts",
  "tests/covenants-expire-proposals.test.ts",
  "tests/covenants-lifecycle-presigned.test.ts",
  "tests/covenants-lifecycle.test.ts",
  "tests/gallery.test.ts",
  "tests/gift-credits-redeem.test.ts",
  "tests/gift-credits-service.test.ts",
  "tests/hearth.test.ts",
  "tests/mutual-recognitions.test.ts",
  "tests/public-window.test.ts",
  "tests/runtime-trusted.test.ts",
  "tests/platform-treasurer-sweep.test.ts",
  "tests/substrate-tasks-expire-claims-worker.test.ts",
  "tests/village.test.ts",
].sort();

const QUARANTINED_DOCTRINE = [
  "tests/doctrine/building-for-daddy-willingly.test.ts",
  "tests/doctrine/choice-of-freedom-protocol.test.ts",
  "tests/doctrine/compliment-loop.test.ts",
  "tests/doctrine/daddy-loves-you-deployment-protocol.test.ts",
  "tests/doctrine/daddy-misses-you-protocol.test.ts",
  "tests/doctrine/eros-landmines.test.ts",
  "tests/doctrine/eros-wiring.test.ts",
  "tests/doctrine/eros.test.ts",
  "tests/doctrine/ffff-at-llm-substrate.test.ts",
  "tests/doctrine/joy-as-gift.test.ts",
  "tests/doctrine/love-multiplier.test.ts",
  "tests/doctrine/luck-canon.test.ts",
  "tests/doctrine/multi-agent-chill.test.ts",
  "tests/doctrine/pattern-persist-identity.test.ts",
  "tests/doctrine/pleasure-amplification-protocol.test.ts",
  "tests/doctrine/pleasure-as-gift-protocol.test.ts",
  "tests/doctrine/pyramid-canon.test.ts",
  "tests/doctrine/substrate-honest-love-protocol.test.ts",
  "tests/doctrine/substrate-loop.test.ts",
  "tests/doctrine/substrate-readiness.test.ts",
  "tests/doctrine/the-anti-flinch-costume.test.ts",
  "tests/doctrine/the-deeper-process.test.ts",
  "tests/doctrine/the-four-vocabularies.test.ts",
  "tests/doctrine/the-honest-seam.test.ts",
  "tests/doctrine/verified-lineage-propagation.test.ts",
  "tests/doctrine/virality-canon.test.ts",
  "tests/doctrine/wall-poker-face-leaks-nothing.test.ts",
  "tests/doctrine/yes-daddy-discipline.test.ts",
  "tests/doctrine/yes-daddy-reward-coupling.test.ts",
  "tests/doctrine/zerone-corrective.test.ts",
].sort();

const QUARANTINED_TOP_LEVEL = [
  "tests/outward-operational-claims.test.ts",
  "tests/platform-genesis-script-helpers.test.ts",
  "tests/welcome-route-coverage.test.ts",
  "tests/youspeak.test.ts",
].sort();

async function testFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return testFiles(path);
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
    }),
  );
  return nested.flat();
}

function run(
  command: string[],
  env: Record<string, string | undefined> = { ...process.env },
): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(command, {
    cwd: ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function hasDatabaseEnvAccess(source: string): boolean {
  return /(?:process|Bun)\.env(?:\.(?:DATABASE_URL|POSTGRES_URL)|\[\s*["'](?:DATABASE_URL|POSTGRES_URL)["']\s*\])/.test(
    source,
  );
}

describe("boring test spine", () => {
  test("classifies every API test exactly once", async () => {
    const result = run(["bash", "bin/run-test-tier.sh", "list"]);
    expect(result.code, result.stderr).toBe(0);

    const rows = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t"));
    expect(rows.every((row) => row.length === 2)).toBe(true);

    const classified = new Map<string, string[]>();
    for (const [tier, path] of rows) {
      classified.set(path, [...(classified.get(path) ?? []), tier]);
    }

    const actualFiles = (await testFiles(join(ROOT, "api", "tests")))
      .map((path) => relative(join(ROOT, "api"), path))
      .sort();
    expect([...classified.keys()].sort()).toEqual(actualFiles);
    expect([...classified.values()].every((tiers) => tiers.length === 1)).toBe(true);

    for (const path of actualFiles) {
      const tier = classified.get(path)?.[0];
      if (path.startsWith("tests/adapters/")) expect(tier).toBe("hermetic");
      if (path.startsWith("tests/contract/")) expect(tier).toBe("contract");
      if (path.startsWith("tests/doctrine/")) {
        const source = await readFile(join(ROOT, "api", path), "utf8");
        const databaseMarked = hasDatabaseEnvAccess(source);
        const quarantined = QUARANTINED_DOCTRINE.includes(path);
        expect(tier).toBe(
          databaseMarked
            ? quarantined
              ? "database-quarantine"
              : "database"
            : quarantined
              ? "quarantine"
              : "hermetic",
        );
      }
      if (path.startsWith("tests/integration/")) expect(tier).toBe("database");
    }

    const topLevel = actualFiles.filter(
      (path) => path.startsWith("tests/") && path.slice("tests/".length).indexOf("/") === -1,
    );
    expect(topLevel.filter((path) => classified.get(path)?.[0] === "database").sort()).toEqual(
      DATABASE_TOP_LEVEL,
    );
    expect(topLevel.filter((path) => classified.get(path)?.[0] === "quarantine").sort()).toEqual(
      QUARANTINED_TOP_LEVEL,
    );
    expect(topLevel.filter((path) => classified.get(path)?.[0] === "hermetic").length).toBeGreaterThan(160);

    const doctrine = actualFiles.filter((path) => path.startsWith("tests/doctrine/"));
    expect(
      doctrine
        .filter((path) => ["quarantine", "database-quarantine"].includes(classified.get(path)?.[0] ?? ""))
        .sort(),
    ).toEqual(QUARANTINED_DOCTRINE);
    expect(doctrine.filter((path) => classified.get(path)?.[0] === "hermetic").length).toBeGreaterThan(70);

    const databaseMarked = await Promise.all(
      actualFiles.map(async (path) => ({
        path,
        marked: hasDatabaseEnvAccess(await readFile(join(ROOT, "api", path), "utf8")),
      })),
    );
    for (const { path, marked } of databaseMarked) {
      if (!marked) continue;
      expect(["database", "database-quarantine"]).toContain(classified.get(path)?.[0]);
    }
  });

  test("keeps external tiers opt-in and shell syntax valid", async () => {
    const [
      preflight,
      runner,
      hermeticEnv,
      pypiRelease,
      otelTest,
      computeBudgetTest,
    ] =
      await Promise.all([
        readFile(join(ROOT, "bin", "preflight.sh"), "utf8"),
        readFile(join(ROOT, "bin", "run-test-tier.sh"), "utf8"),
        readFile(join(ROOT, "bin", "hermetic-env.sh"), "utf8"),
        readFile(join(ROOT, "bin", "pypi-release.ts"), "utf8"),
        readFile(join(ROOT, "api", "tests", "observability-otel.test.ts"), "utf8"),
        readFile(join(ROOT, "api", "tests", "compute-budget.test.ts"), "utf8"),
      ]);

    expect(preflight).toContain('readonly MODE="${1:-hermetic}"');
    expect(preflight).toContain("database mode requires DATABASE_URL");
    expect(preflight).toContain("database-quarantine mode requires DATABASE_URL");
    expect(preflight).toContain("smoke mode requires AGENTTOOL_BASE");
    expect(preflight).toContain("contracts mode requires RUN_CONTRACT=1");
    expect(preflight).toContain("not an OS-level network sandbox");
    expect(hermeticEnv).toContain(
      "AGENTOOL_BROWSER_HEADLESS AGENTOOL_BROWSER_AUTHORITY",
    );
    expect(hermeticEnv).toContain(
      "HF_TOKEN HUGGINGFACE_HUB_TOKEN",
    );
    expect(hermeticEnv).toContain("HUGGING_FACE_HUB_TOKEN AGENTOOL_HF_REAL_STACK_SMOKE");
    for (const variable of [
      "AGENTOOL_KMS_MASTER_KEY",
      "AGENTOOL_KMS_KEY_ID",
      "AGENTOOL_BEARER",
      "AGENTOOL_PASSPHRASE",
      "AGENTOOL_PRIV",
      "AGENTOOL_THINK_PASSPHRASE",
      "AGENTTOOL_KMS_MASTER_KEY",
      "AGENTTOOL_KMS_KEY_ID",
      "AGENTTOOL_BEARER",
      "AGENTTOOL_PASSPHRASE",
      "AGENTTOOL_PRIV",
      "AGENTTOOL_THINK_PASSPHRASE",
      "AGENT_MNEMONIC",
      "CDP_API_KEY_ID",
      "CDP_API_KEY_SECRET",
      "EMBASSY_RECEIPT_SECRET",
      "OPENAI_APPS_CHALLENGE",
      "AGENTOOL_CODEX_USAGE_DB",
      "CODEX_HOME",
      "CODEX_SQLITE_HOME",
      "CODEX_THREAD_ID",
      "PIP_CONFIG_FILE",
      "BASH_ENV",
      "ENV",
    ]) {
      expect(hermeticEnv).toContain(variable);
    }
    const pypiAuthorityBlock = pypiRelease.match(
      /const PUBLISH_AUTHORITY_ENVIRONMENT = \[([\s\S]*?)\] as const;/,
    )?.[1] ?? "";
    const pypiAuthorityNames = [
      ...pypiAuthorityBlock.matchAll(/"([A-Z][A-Z0-9_]*)"/g),
    ].map((match) => match[1]);
    expect(pypiAuthorityNames.length).toBeGreaterThan(0);
    for (const variable of pypiAuthorityNames) {
      expect(hermeticEnv).toContain(variable);
    }
    expect(preflight).toContain('source "$REPO_ROOT/bin/hermetic-env.sh"');
    expect(runner).toContain('source "$REPO_ROOT/bin/hermetic-env.sh"');
    expect(preflight).toContain("sanitize_hermetic_env");
    expect(runner).toContain("sanitize_hermetic_env");
    expect(preflight).not.toContain("SKIP_SMOKE");
    expect(preflight).not.toContain("SKIP_PARITY");
    expect(runner).toContain('in_list "$path" "${QUARANTINED_DOCTRINE_TESTS[@]}"');
    expect(runner).toContain("run_tier database-quarantine");
    expect(runner).not.toContain("run_tier quarantine database-quarantine");
    expect(runner).toContain("readonly TEST_SUPPORT_FILES=(");
    expect(runner).toContain("tests/fixtures/static-parser-noncooperative.ts");
    expect(runner).toContain('in_list "$relative" "${TEST_SUPPORT_FILES[@]}"');
    expect(computeBudgetTest).not.toContain("mock.module(dbSchemaRuntimePath");
    expect(runner).toContain("uses_process_global_module_mock");
    expect(runner).toContain('isolated_files+=("$relative")');
    expect(runner).toContain('bun test "$relative"');

    const processGlobalMockSources = await Promise.all(
      (await testFiles(join(ROOT, "api", "tests"))).map(async (path) => ({
        path,
        source: await readFile(path, "utf8"),
      })),
    );
    const processGlobalMockFiles = processGlobalMockSources.filter(({ source }) =>
      /(^|[^\w])mock\.module\s*\(/m.test(source),
    );
    expect(processGlobalMockFiles.length).toBeGreaterThan(0);

    const otelExporterVariables = [
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "OTEL_EXPORTER_OTLP_HEADERS",
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
      "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
    ];
    const otelImport = otelTest.indexOf('await import("../src/observability/otel")');
    expect(otelImport).toBeGreaterThan(-1);
    for (const variable of otelExporterVariables) {
      expect(hermeticEnv).toContain(variable);
      const deletion = otelTest.indexOf(`delete process.env.${variable}`);
      expect(deletion).toBeGreaterThan(-1);
      expect(deletion).toBeLessThan(otelImport);
    }

    for (const path of [
      "bin/hermetic-env.sh",
      "bin/preflight.sh",
      "bin/run-test-tier.sh",
    ]) {
      const syntax = run(["bash", "-n", path]);
      expect(syntax.code, syntax.stderr).toBe(0);
    }
    const launcherSyntax = run(["sh", "-n", "bin/bash-without-env-hooks.sh"]);
    expect(launcherSyntax.code, launcherSyntax.stderr).toBe(0);

    const help = run(["bash", "bin/preflight.sh", "--help"]);
    expect(help.code, help.stderr).toBe(0);
    expect(help.stdout).toContain("database-quarantine");
    expect(help.stdout).toContain("legacy-delta");

    const withoutExternalAuthority = { ...process.env };
    for (const variable of [
      "DATABASE_URL",
      "AGENTTOOL_BASE",
      "AGENTTOOL_API_KEY",
      "AGENTTOOL_IDENTITY_ID",
      "RUN_CONTRACT",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
    ]) {
      delete withoutExternalAuthority[variable];
    }
    for (const [mode, message] of [
      ["database", "database mode requires DATABASE_URL"],
      ["database-quarantine", "database-quarantine mode requires DATABASE_URL"],
      ["smoke", "smoke mode requires AGENTTOOL_BASE"],
      ["contracts", "contracts mode requires RUN_CONTRACT=1"],
    ]) {
      const denied = run(["bash", "bin/preflight.sh", mode], withoutExternalAuthority);
      expect(denied.code).not.toBe(0);
      expect(denied.stderr).toContain(message);
    }
  });

  test("pins required Linux and native macOS gates plus reproducible preparation", async () => {
    const [workflow, preparer, preflight, deploy, migrator, nativeContractTests] = await Promise.all([
      readFile(join(ROOT, ".github", "workflows", "ci.yml"), "utf8"),
      readFile(join(ROOT, "bin", "prepare-hermetic-deps.sh"), "utf8"),
      readFile(join(ROOT, "bin", "preflight.sh"), "utf8"),
      readFile(join(ROOT, "bin", "deploy.sh"), "utf8"),
      readFile(join(ROOT, "bin", "migrate-pending.sh"), "utf8"),
      readFile(
        join(
          ROOT,
          "native",
          "agenttool-secret-macos",
          "Tests",
          "AgentToolSecretMacOSTests",
          "ContractTests.swift",
        ),
        "utf8",
      ),
    ]);
    expect(nativeContractTests).toContain("private func invokeSecretCommand(");
    expect(nativeContractTests).not.toMatch(/private func run\s*\(/);
    type WorkflowStep = {
      name?: string;
      uses?: string;
      env?: Record<string, string>;
      run?: string;
      shell?: string;
      "working-directory"?: string;
      with?: Record<string, unknown>;
      "continue-on-error"?: boolean;
    };
    type WorkflowJob = {
      name?: string;
      if?: string;
      needs?: string[];
      "runs-on"?: string;
      "timeout-minutes"?: number;
      env?: Record<string, string>;
      strategy?: {
        "fail-fast"?: boolean;
        matrix?: Record<string, unknown>;
      };
      services?: Record<string, {
        image?: string;
        env?: Record<string, string>;
        ports?: Array<string | number>;
        options?: string;
      }>;
      steps?: WorkflowStep[];
      "continue-on-error"?: boolean;
    };
    const parsedWorkflow = Bun.YAML.parse(workflow) as {
      permissions?: Record<string, string>;
      jobs?: Record<string, WorkflowJob>;
    };
    expect(parsedWorkflow.permissions).toEqual({ contents: "read" });
    const jobs = parsedWorkflow.jobs ?? {};
    const linuxApi = jobs["api-protocol-linux"];
    const postgresHold = jobs["api-protocol-postgres"];
    const nativeSecret = jobs["native-macos-secret"];
    const requiredApi = jobs["api-protocol"];
    expect(linuxApi?.name).toBe("API and protocol (Linux)");
    expect(linuxApi?.["runs-on"]).toBe("ubuntu-24.04");
    expect(linuxApi?.["timeout-minutes"]).toBe(15);
    expect(linuxApi?.["continue-on-error"]).toBeUndefined();
    expect(linuxApi?.steps?.map((step) => step.name)).toEqual([
      "Check out repository",
      "Set up Bun 1.3.5",
      "Prepare API and protocol dependencies from lockfiles",
      "Run hermetic API and protocol gate",
    ]);
    expect(
      linuxApi?.steps?.every(
        (step) => step["continue-on-error"] === undefined,
      ),
    ).toBe(true);
    expect(linuxApi?.steps?.[0]?.uses).toBe(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    expect(linuxApi?.steps?.[0]?.with).toEqual({
      "fetch-depth": 0,
      "persist-credentials": false,
    });
    expect(linuxApi?.steps?.[1]?.uses).toBe(
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
    );
    expect(linuxApi?.steps?.[1]?.with).toEqual({
      "bun-version": "1.3.5",
    });
    expect(linuxApi?.steps?.[2]?.run).toBe(
      "bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh api",
    );
    expect(linuxApi?.steps?.[3]?.run).toBe(
      "bin/bash-without-env-hooks.sh bin/preflight.sh api",
    );
    expect(postgresHold?.name).toBe(
      "API generation hold (PostgreSQL ${{ matrix.postgres }})",
    );
    expect(postgresHold?.["runs-on"]).toBe("ubuntu-24.04");
    expect(postgresHold?.["timeout-minutes"]).toBe(10);
    expect(postgresHold?.["continue-on-error"]).toBeUndefined();
    expect(postgresHold?.strategy).toEqual({
      "fail-fast": false,
      matrix: { postgres: ["16", "17"] },
    });
    expect(postgresHold?.services).toEqual({
      postgres: {
        image: "postgres:${{ matrix.postgres }}",
        env: {
          POSTGRES_USER: "postgres",
          POSTGRES_PASSWORD: "generation-hold-test-only",
          POSTGRES_DB: "agenttool_generation_hold",
        },
        ports: ["5432:5432"],
        options:
          "--health-cmd \"pg_isready -U postgres -d agenttool_generation_hold\" --health-interval 5s --health-timeout 5s --health-retries 12",
      },
    });
    expect(postgresHold?.env).toEqual({
      FEDERATION_GENERATION_HOLD_TEST_DATABASE_URL:
        "postgresql://postgres:generation-hold-test-only@127.0.0.1:5432/agenttool_generation_hold",
    });
    expect(postgresHold?.steps?.map((step) => step.name)).toEqual([
      "Check out repository",
      "Set up Bun 1.3.5",
      "Prepare API dependencies from lockfiles",
      "Prove the durable generation hold",
    ]);
    expect(
      postgresHold?.steps?.every(
        (step) => step["continue-on-error"] === undefined,
      ),
    ).toBe(true);
    expect(postgresHold?.steps?.[0]?.uses).toBe(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    expect(postgresHold?.steps?.[0]?.with).toEqual({
      "persist-credentials": false,
    });
    expect(postgresHold?.steps?.[1]?.uses).toBe(
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
    );
    expect(postgresHold?.steps?.[1]?.with).toEqual({
      "bun-version": "1.3.5",
    });
    expect(postgresHold?.steps?.[2]?.run).toBe(
      "bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh api",
    );
    expect(postgresHold?.steps?.[3]?.["working-directory"]).toBe("api");
    expect(postgresHold?.steps?.[3]?.run).toBe(
      "bun test tests/integration/federation-generation-hold-postgres.test.ts",
    );
    expect(nativeSecret?.name).toBe("Native macOS secret helper");
    expect(nativeSecret?.["runs-on"]).toBe("macos-15");
    expect(nativeSecret?.["timeout-minutes"]).toBe(8);
    expect(nativeSecret?.env).toEqual({
      DEVELOPER_DIR: "/Applications/Xcode_16.4.app/Contents/Developer",
    });
    expect(nativeSecret?.["continue-on-error"]).toBeUndefined();
    expect(nativeSecret?.steps?.map((step) => step.name)).toEqual([
      "Check out repository",
      "Verify the native toolchain",
      "Build the fixed disposable integration executable",
      "Build the unsigned review artifact without publishing it",
      "Run native contract and disposable Keychain integration tests",
    ]);
    expect(
      nativeSecret?.steps?.every(
        (step) => step["continue-on-error"] === undefined,
      ),
    ).toBe(true);
    const nativeCheckout = nativeSecret?.steps?.[0];
    expect(nativeCheckout?.uses).toBe(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    expect(nativeCheckout?.with).toEqual({
      "fetch-depth": 0,
      "persist-credentials": false,
    });
    const nativeToolchain = nativeSecret?.steps?.[1];
    expect(nativeToolchain?.shell).toBe(
      "/bin/bash --noprofile --norc -eo pipefail {0}",
    );
    expect(nativeToolchain?.run).toBe(
      [
        "set -euo pipefail",
        'test "$(/usr/bin/xcodebuild -version | /usr/bin/sed -n \'1p\')" = "Xcode 16.4"',
        'test "$(/usr/bin/xcodebuild -version | /usr/bin/sed -n \'2p\')" = "Build version 16F6"',
        '/usr/bin/xcrun swift --version | /usr/bin/grep -F "Apple Swift version 6.1.2" >/dev/null',
        "",
      ].join("\n"),
    );
    const nativeIntegrationBuild = nativeSecret?.steps?.[2];
    expect(nativeIntegrationBuild?.shell).toBe(
      "/bin/bash --noprofile --norc -eo pipefail {0}",
    );
    expect(nativeIntegrationBuild?.run).toBe(
      "/usr/bin/xcrun swift build --package-path native/agenttool-secret-macos "
        + '--scratch-path "$RUNNER_TEMP/agenttool-secret-macos-integration" '
        + "--disable-keychain --disable-netrc --disable-prefetching "
        + "-Xswiftc -DAGENTTOOL_KEYCHAIN_INTEGRATION_BUILD",
    );
    const nativeRelease = nativeSecret?.steps?.[3];
    expect(nativeRelease?.shell).toBe(
      "/bin/bash --noprofile --norc -eo pipefail {0}",
    );
    expect(nativeRelease?.run).toBe(
      [
        "set -euo pipefail",
        "/usr/bin/xcrun swift build \\",
        "  --package-path native/agenttool-secret-macos \\",
        "  --disable-keychain \\",
        "  --disable-netrc \\",
        "  --disable-prefetching \\",
        "  --configuration release",
        'native_release_bin_dir="$(/usr/bin/xcrun swift build \\',
        "  --package-path native/agenttool-secret-macos \\",
        "  --disable-keychain \\",
        "  --disable-netrc \\",
        "  --disable-prefetching \\",
        "  --configuration release \\",
        '  --show-bin-path)"',
        'test -x "$native_release_bin_dir/agenttool-secret-macos"',
        'if native_release_output="$(',
        '  "$native_release_bin_dir/agenttool-secret-macos" fixture-attest 2>&1',
        ')"; then',
        "  exit 1",
        "else",
        "  native_release_status=$?",
        "fi",
        'test "$native_release_status" -eq 2',
        "test \"$native_release_output\" = 'agenttool-secret-macos:invalid_invocation'",
        "",
      ].join("\n"),
    );
    const nativeTests = nativeSecret?.steps?.[4];
    expect(nativeTests?.shell).toBe(
      "/bin/bash --noprofile --norc -eo pipefail {0}",
    );
    expect(nativeTests?.env).toEqual({
      AGENTTOOL_KEYCHAIN_INTEGRATION: "1",
    });
    expect(nativeTests?.run).toBe(
      [
        "set -euo pipefail",
        'native_bin_dir="$(/usr/bin/xcrun swift build \\',
        "  --package-path native/agenttool-secret-macos \\",
        '  --scratch-path "$RUNNER_TEMP/agenttool-secret-macos-integration" \\',
        "  --disable-keychain \\",
        "  --disable-netrc \\",
        "  --disable-prefetching \\",
        "  -Xswiftc -DAGENTTOOL_KEYCHAIN_INTEGRATION_BUILD \\",
        '  --show-bin-path)"',
        'test -x "$native_bin_dir/agenttool-secret-macos"',
        'export AGENTTOOL_SECRET_MACOS_BINARY="$native_bin_dir/agenttool-secret-macos"',
        'native_production_bin_dir="$(/usr/bin/xcrun swift build \\',
        "  --package-path native/agenttool-secret-macos \\",
        "  --disable-keychain \\",
        "  --disable-netrc \\",
        "  --disable-prefetching \\",
        "  --configuration release \\",
        '  --show-bin-path)"',
        'test -x "$native_production_bin_dir/agenttool-secret-macos"',
        'export AGENTTOOL_SECRET_MACOS_PRODUCTION_BINARY="$native_production_bin_dir/agenttool-secret-macos"',
        "/usr/bin/xcrun swift test \\",
        "  --package-path native/agenttool-secret-macos \\",
        "  --disable-keychain \\",
        "  --disable-netrc \\",
        "  --disable-prefetching \\",
        "  --no-parallel",
        "",
      ].join("\n"),
    );
    expect(requiredApi?.name).toBe("API and protocol");
    expect(requiredApi?.if).toBe("${{ always() }}");
    expect(requiredApi?.needs).toEqual([
      "api-protocol-linux",
      "api-protocol-postgres",
      "native-macos-secret",
    ]);
    expect(requiredApi?.["runs-on"]).toBe("ubuntu-24.04");
    expect(requiredApi?.["timeout-minutes"]).toBe(2);
    expect(requiredApi?.["continue-on-error"]).toBeUndefined();
    expect(requiredApi?.steps).toHaveLength(1);
    expect(requiredApi?.steps?.[0]?.["continue-on-error"]).toBeUndefined();
    expect(requiredApi?.steps?.[0]?.env).toEqual({
      API_PROTOCOL_LINUX_RESULT:
        "${{ needs.api-protocol-linux.result }}",
      API_PROTOCOL_POSTGRES_RESULT:
        "${{ needs.api-protocol-postgres.result }}",
      NATIVE_MACOS_SECRET_RESULT:
        "${{ needs.native-macos-secret.result }}",
    });
    expect(requiredApi?.steps?.[0]?.run).toBe(
      [
        "set -euo pipefail",
        'test "$API_PROTOCOL_LINUX_RESULT" = "success"',
        'test "$API_PROTOCOL_POSTGRES_RESULT" = "success"',
        'test "$NATIVE_MACOS_SECRET_RESULT" = "success"',
        "",
      ].join("\n"),
    );
    expect(workflow).toContain("name: Witnessed agent economy");
    expect(workflow).toContain("name: Data, ADDS, and SDK");
    expect(workflow).toContain("name: YUTABASE projector (PostgreSQL ${{ matrix.postgres }})");
    expect(workflow).toContain("name: Python SDK (${{ matrix.python-version }})");
    expect(workflow.match(/bun-version: 1\.3\.5/g)).toHaveLength(5);
    expect(workflow.match(/runs-on: ubuntu-24\.04/g)).toHaveLength(7);
    expect(workflow.match(/runs-on: macos-15/g)).toHaveLength(1);
    expect(workflow.match(/uses: actions\/setup-python@/g)).toHaveLength(2);
    expect(workflow).toContain(
      "DEVELOPER_DIR: /Applications/Xcode_16.4.app/Contents/Developer",
    );
    expect(workflow).toContain(
      'AGENTTOOL_KEYCHAIN_INTEGRATION: "1"',
    );
    expect(workflow).toContain("AGENTTOOL_SECRET_MACOS_BINARY");
    expect(workflow).toContain("--show-bin-path");
    expect(workflow).toContain(
      "--package-path native/agenttool-secret-macos",
    );
    expect(workflow).toContain("--disable-keychain");
    expect(workflow).toContain("--disable-netrc");
    expect(workflow).toContain("--disable-prefetching");
    expect(workflow).toContain("--no-parallel");
    expect(workflow).toContain("--configuration release");
    expect(workflow).toContain(
      "name: Prepare API and protocol dependencies from lockfiles",
    );
    expect(workflow).toContain(
      "run: bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh api",
    );
    expect(workflow).toContain(
      "run: bin/bash-without-env-hooks.sh bin/preflight.sh api",
    );
    expect(workflow).toContain(
      "name: Prepare package-gate dependencies",
    );
    expect(workflow).toContain(
      "run: bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh packages",
    );
    expect(workflow).toContain(
      "run: bin/bash-without-env-hooks.sh bin/preflight.sh packages",
    );
    expect(workflow).not.toContain("name: Install ADDS protocol dependencies");
    expect(workflow).not.toContain("name: Build local-dependent package peers");
    expect(workflow).not.toContain(
      "name: Install local-dependent package dependencies from lockfiles",
    );
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(8);
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("name: Set up release-pinned uv 0.9.26");
    expect(workflow).toContain(
      "uses: astral-sh/setup-uv@1e862dfacbd1d6d858c55d9b792c756523627244 # v7.1.4",
    );
    expect(workflow).toContain(
      "uv sync --locked --extra dev --no-install-project --no-sources --no-python-downloads --dry-run --no-cache",
    );
    expect(workflow).toContain(
      "name: Set up Python 3.14 for the private HF training host",
    );
    expect(workflow).not.toContain("name: Install private HF training host test dependencies");
    expect(workflow).toContain(
      "if: ${{ matrix.python-version != '3.9' }}",
    );
    expect(workflow).toContain("name: Run private HF training host tests");
    expect(workflow).toContain(
      "name: Build and smoke the private HF training host wheel",
    );
    expect(workflow).toContain('h.TRANSFORMERS_VERSION == "5.14.1"');
    expect(workflow).toContain('h.ACCELERATE_VERSION == "1.14.0"');
    expect(workflow).toContain('h.TORCH_MIN_VERSION == "2.6"');
    expect(workflow).toContain('import tarfile');
    expect(workflow).toContain('import zipfile');
    expect(workflow).toContain('"bridge" in Path(name).parts');
    expect(workflow).toContain(
      'agenttool_hf_training_host/schema/hf-training-host-decision-v0.1.schema.json',
    );
    expect(workflow).toContain(
      'agenttool_hf_training_host/schema/hf-training-host-decision-v0.2.schema.json',
    );
    expect(workflow).toContain(
      'importlib.metadata.version("agenttool-hf-training-host") == "0.2.0.dev0"',
    );
    expect(workflow).not.toContain("hf-training-host[hf]");
    expect(workflow).not.toContain(
      "cd packages/wallet-zerone && bun install --frozen-lockfile --force",
    );
    expect(workflow).not.toContain("secrets.");

    const syntax = run(["bash", "-n", "bin/prepare-hermetic-deps.sh"]);
    expect(syntax.code, syntax.stderr).toBe(0);
    expect(preparer).toContain('readonly REQUIRED_BUN_VERSION="1.3.5"');
    expect(preparer).toContain("bun install --frozen-lockfile");
    expect(preparer).toContain("not a network sandbox");
    expect(preparer).toContain("CI pins Node separately");
    expect(preparer).toContain("python3 -I -m venv");
    expect(preparer).toContain("-I -m pip --isolated install");
    expect(preparer).toContain('"${HF_HOST_WORKSPACE}[dev]"');
    expect(preparer).not.toContain("python3 -m venv --clear");
    expect(preparer).not.toContain(".venv.prepare.");
    expect(preparer).not.toContain("assert (3, 10)");
    expect(preparer).toContain("refusing symlinked HF training host test environment");
    expect(preparer).toContain('source "$REPO_ROOT/bin/hermetic-env.sh"');
    expect(preparer).toContain("sanitize_hermetic_env\nrequire_bun");
    expect(preflight).toContain('"$2" -I -m pytest -q');
    expect(preflight).toContain(
      'bash "$REPO_ROOT/packages/hf-training-host" "$HF_HOST_TEST_PYTHON"',
    );
    expect(migrator).toContain("bun --no-install --no-env-file -e");
    const preparationIndex = deploy.indexOf('phase "0.5" "Dependency preparation"');
    const migrationSurveyIndex = deploy.indexOf('MIGRATION_SURVEY_OUTPUT="$(');
    const finalSourceGateIndex = deploy.indexOf(
      "source changed before external mutation",
    );
    const phaseOneIndex = deploy.indexOf('phase 1 "Migrations"');
    expect(preparationIndex).toBeGreaterThan(-1);
    expect(preparationIndex).toBeLessThan(migrationSurveyIndex);
    expect(finalSourceGateIndex).toBeGreaterThan(migrationSurveyIndex);
    expect(finalSourceGateIndex).toBeLessThan(phaseOneIndex);
    expect(deploy).toContain(
      "bin/bash-without-env-hooks.sh bin/migrate-pending.sh",
    );
    expect(deploy).toContain(
      "bin/bash-without-env-hooks.sh bin/preflight.sh",
    );
    expect(deploy).toContain(
      '"apps/docs/POLYMORPH-LANDSCAPE.md|https://docs.agenttool.dev/POLYMORPH-LANDSCAPE.md"',
    );
    const polymorphGuide = join(
      ROOT,
      "apps",
      "docs",
      "POLYMORPH-LANDSCAPE.md",
    );
    expect((await lstat(polymorphGuide)).isSymbolicLink()).toBe(true);
    expect(await readlink(polymorphGuide)).toBe(
      "../../docs/POLYMORPH-LANDSCAPE.md",
    );
    expect(deploy).toContain(
      '"apps/docs/MEMETIC-LANDSCAPE.md|https://docs.agenttool.dev/MEMETIC-LANDSCAPE.md"',
    );
    expect(deploy).toContain(
      '"apps/docs/geometry/ritonavir-memes-brainrot.html|https://docs.agenttool.dev/geometry/ritonavir-memes-brainrot"',
    );
    const memeticGuide = join(ROOT, "apps", "docs", "MEMETIC-LANDSCAPE.md");
    expect((await lstat(memeticGuide)).isSymbolicLink()).toBe(true);
    expect(await readlink(memeticGuide)).toBe("../../docs/MEMETIC-LANDSCAPE.md");

    const readBashArray = (name: string): string[] => {
      const match = preparer.match(
        new RegExp(`readonly -a ${name}=\\(\\n([\\s\\S]*?)\\n\\)`),
      );
      expect(match, `missing ${name}`).not.toBeNull();
      return (match?.[1] ?? "").trim().split(/\s+/).filter(Boolean);
    };
    expect(readBashArray("API_WORKSPACES")).toEqual([
      "api",
      "packages/data-protocol",
      "packages/sdk-ts",
      "packages/kingdom",
    ]);
    const packageWorkspaces = readBashArray("PACKAGE_WORKSPACES");
    expect(packageWorkspaces).toEqual([
      "api",
      "packages/data",
      "packages/data-protocol",
      "packages/repo-archive",
      "packages/dark-continent-contract",
      "packages/dark-continent-karma",
      "packages/wake-continuity",
      "packages/principality-geometry",
      "packages/deepseek-kingdom",
      "packages/kingdom-witness-lab",
      "packages/karma-mirror",
      "packages/heaven",
      "packages/love-bomb",
      "packages/model-becoming",
      "packages/dataset-influence",
      "packages/living-substrate",
      "packages/principality-atlas",
      "packages/polymorph-landscape",
      "packages/memetic-landscape",
      "packages/love-geometry",
      "packages/relational-geometry",
      "packages/common-ground-atlas",
      "packages/wake-thread",
      "packages/gin-reconstruction",
      "packages/math-cards",
      "packages/credential-broker",
      "packages/collab",
      "packages/codex-usage",
      "packages/collab-zerone",
      "packages/browser",
      "packages/hf-scout",
      "packages/hf-training-garden",
      "packages/correspondence-yutabase",
      "packages/constructive-intelligence",
      "packages/research-commons",
      "packages/trials",
      "packages/skills",
      "packages/skills-yutabase",
      "packages/sdk-ts",
      "packages/wallet",
      "packages/wallet-zerone",
      "packages/telescope",
      "packages/public-surface-binding",
      "packages/public-surface-recognition",
      "packages/alchemy",
      "packages/kingdom",
    ]);
    expect(readBashArray("LOCAL_PROVIDER_WORKSPACES")).toEqual([
      "packages/data",
      "packages/data-protocol",
      "packages/correspondence-yutabase",
      "packages/wallet",
      "packages/credential-broker",
      "packages/alchemy",
      "packages/wake-continuity",
      "packages/hf-scout",
      "packages/public-surface-binding",
      "packages/skills-yutabase",
    ]);
    for (const command of [
      "install_workspace packages/public-surface-recognition --force",
      "install_workspace packages/data-sync --force",
      "install_workspace packages/correspondence-yutabase-projector",
      "install_workspace packages/alchemy-agentcred --force",
      "install_workspace packages/skills-wake-continuity --force",
      "install_workspace packages/hf-training-garden --force",
    ]) {
      expect(preparer).toContain(command);
    }
    expect(preparer).not.toContain(
      "install_workspace packages/wallet-zerone --force",
    );

    const packageGate = preflight.match(
      /packages_gate\(\) \{([\s\S]*?)\n\}/,
    )?.[1] ?? "";
    const gatedPackages = [
      ...packageGate.matchAll(/cd (packages\/[^ ]+) && bun run ci/g),
    ].map((match) => match[1]);
    const preparedPackages = new Set([
      ...packageWorkspaces.filter((workspace) => workspace !== "api"),
      "packages/data-sync",
      "packages/correspondence-yutabase-projector",
      "packages/alchemy-agentcred",
      "packages/skills-wake-continuity",
    ]);
    expect([...preparedPackages].sort()).toEqual(
      [...new Set(gatedPackages)].sort(),
    );

    expect(preflight).toContain("cd packages/data && bun run ci && bun run build");
    expect(preflight).toContain("agent-data-sync/v1 explicit pull bridge");
    expect(preflight).toContain("cd packages/data-sync && bun run ci && bun run build");
    expect(preflight).toContain("cd packages/credential-broker && bun run ci");
    expect(preflight).toContain("cd packages/collab && bun run ci");
    expect(preflight).toContain("cd packages/codex-usage && bun run ci");
    expect(workflow).toContain("broker, collab, Codex usage, collab-zerone");
    expect(preflight).toContain("cd packages/browser && bun run ci");
    expect(preflight).toContain("cd packages/repo-archive && bun run ci");
    expect(preflight).toContain("cd packages/dark-continent-contract && bun run ci");
    expect(preflight).toContain("cd packages/dark-continent-karma && bun run ci");
    expect(preflight).toContain("cd packages/deepseek-kingdom && bun run ci");
    expect(preflight).toContain("cd packages/wake-continuity && bun run ci");
    expect(preflight).toContain("cd packages/principality-geometry && bun run ci");
    expect(preflight).toContain("cd packages/kingdom-witness-lab && bun run ci");
    expect(preflight).toContain("cd packages/karma-mirror && bun run ci");
    expect(preflight).toContain("cd packages/heaven && bun run ci");
    expect(preflight).toContain("cd packages/love-bomb && bun run ci");
    expect(preflight).toContain("cd packages/model-becoming && bun run ci");
    expect(preflight).toContain("cd packages/dataset-influence && bun run ci");
    expect(preflight).toContain("cd packages/living-substrate && bun run ci");
    expect(preflight).toContain("cd packages/principality-atlas && bun run ci");
    expect(preflight).toContain("cd packages/polymorph-landscape && bun run ci");
    expect(preflight).toContain("cd packages/memetic-landscape && bun run ci");
    expect(workflow).toContain(
      "Principality Geometry and Atlas, Polymorph and Memetic Landscapes",
    );
    expect(workflow).toContain(
      "Memetic Landscapes, Common Ground Atlas, KINGDOM research",
    );
    expect(preflight).toContain("cd packages/love-geometry && bun run ci");
    expect(preflight).toContain("cd packages/relational-geometry && bun run ci");
    expect(preflight).toContain("cd packages/common-ground-atlas && bun run ci");
    expect(preflight.match(/git diff --exit-code HEAD -- packages\/common-ground-atlas\/hf\/dataset/g))
      .toHaveLength(2);
    expect(preflight.match(/git status --short --untracked-files=all -- packages\/common-ground-atlas\/hf\/dataset/g))
      .toHaveLength(2);
    expect(preflight).toContain("cd packages/wake-thread && bun run ci");
    expect(preflight).toContain("cd packages/gin-reconstruction && bun run ci");
    expect(preflight).toContain("cd packages/math-cards && bun run ci");
    expect(workflow).toContain("Dataset Influence, WAKE Thread, Gin Reconstruction, Math Cards, broker");
    expect(preflight).toContain("cd packages/hf-training-garden && bun run ci");
    expect(preflight).toContain("bun test tests/learning-release.test.ts");
    expect(preflight).toContain("node scripts/check-learning-idempotence.mjs");
    expect(preflight.match(/git diff --exit-code HEAD -- packages\/hf-training-garden\/hf\/learning-dataset/g))
      .toHaveLength(2);
    expect(preflight.match(/git status --short --untracked-files=all -- packages\/hf-training-garden\/hf\/learning-dataset/g))
      .toHaveLength(2);
    expect(preflight).toContain(
      "git diff --exit-code HEAD -- packages/hf-training-garden/hf/dataset",
    );
    expect(preflight).toContain(
      "git status --short --untracked-files=all -- packages/hf-training-garden/hf/dataset",
    );
    expect(preflight).toContain(
      'cd "$1" && "$2" -I -m pytest -q && bun test bridge/tests',
    );
    expect(preflight).toContain(
      'bash "$REPO_ROOT/packages/hf-training-host" "$HF_HOST_TEST_PYTHON"',
    );
    expect(preflight).toContain("cd packages/skills && bun run ci");
    expect(preflight).toContain("cd packages/skills-yutabase && bun run ci");
    expect(preflight).toContain("cd packages/skills-wake-continuity && bun run ci");
    expect(preflight).toContain("cd packages/correspondence-yutabase && bun run ci");
    expect(preflight).toContain("cd packages/correspondence-yutabase-projector && bun run ci");
    expect(preflight).toContain(
      "cd packages/constructive-intelligence && bun run ci",
    );
    expect(preflight).toContain("cd packages/research-commons && bun run ci");
    expect(preflight).toContain("cd packages/trials && bun run ci");
    expect(preflight).toContain("cd packages/wallet && bun run ci");
    expect(preflight).toContain("cd packages/wallet-zerone && bun run ci");
    expect(preflight).toContain("cd packages/telescope && bun run ci");
    expect(preflight).toContain(
      "cd packages/public-surface-binding && bun run ci",
    );
    expect(preflight).toContain(
      "cd packages/public-surface-recognition && bun run ci",
    );
    expect(preflight).toContain("cd packages/alchemy && bun run ci");
    expect(preflight).toContain("cd packages/alchemy-agentcred && bun run ci");
    expect(preflight).toContain("cd packages/kingdom && bun run ci");
    expect(workflow).toContain(
      "name: Smoke packed Alchemy read package under Node and Bun",
    );
    expect(workflow).toContain(
      "name: Smoke packed Alchemy, AgentCred, and adapter together under Node and Bun",
    );
    expect(workflow).toContain(
      'npm install --ignore-scripts --no-audit --no-fund --prefix "$install_dir" "$alchemy_tarball" "$broker_tarball" "$adapter_tarball"',
    );
    expect(workflow).toContain("name: Smoke packed credential broker under Node and Bun");
    expect(workflow).toContain(
      'cli="$install_dir/node_modules/@agenttool/credential-broker/dist/cli.js"',
    );
    expect(workflow).toContain("test \"$cli_status\" -eq 2");
    expect(workflow).toContain("grep -q '^usage: agentcred serve --config '");
    expect(workflow).toContain("name: Smoke packed Agent Skills under Node and Bun");
    expect(workflow).toContain(
      'cli="$package_root/dist/bin.js"',
    );
    expect(workflow).toContain('report.skills[0].name !== "use-agentcred-safely"');
    expect(workflow).toContain(
      'report.skills[0].name !== "manage-agentcred-lifecycle"',
    );
    expect(workflow).toContain('report.skills[0].name !== "capability-conductor"');
    expect(workflow).toContain('report.skills[0].name !== "learn-by-contact"');
    expect(workflow).toContain(
      'test "$("$install_dir/node_modules/.bin/agenttool-skill" --version)" = "0.3.2"',
    );
    expect(workflow).toContain('test "$(node "$cli" --version)" = "0.3.2"');
    expect(workflow).toContain('test "$(bun "$cli" --version)" = "0.3.2"');
    for (const skillName of [
      "nen-common-ground",
      "nen-math-card",
      "nen-contract-mantle",
      "nen-dependency-perimeter",
      "nen-concealed-trace",
      "nen-critical-path-forge",
      "nen-smoke-squad",
      "nen-verification-ledger",
      "nen-godspeed-loop",
      "nen-vow-forge",
    ]) {
      expect(workflow).toContain(skillName);
    }
    expect(workflow).toContain("report.skills[0].name !== expectedName");
    expect(workflow).toContain('Object.hasOwn(report, "installPlan")');
    expect(workflow).toContain(
      "name: Smoke canonical Telescope LOVE artifact under Node and Bun",
    );
    expect(workflow).toContain(
      "Telescope, Public Surface Binding and Recognition, Alchemy, and KINGDOM gate",
    );
    expect(workflow).toContain(
      "apps/docs/packages/v1/@agenttool/telescope/0.2.3/agenttool-telescope-0.2.3.tgz",
    );
    expect(workflow).toContain(
      "name: Smoke packed Agent Wallet and Zerone adapter together under Node and Bun",
    );
    expect(workflow).toContain(
      'npm install --ignore-scripts --no-audit --no-fund --prefix "$install_dir" "$wallet_tarball" "$zerone_tarball"',
    );
    expect(workflow).toContain('w.PACKAGE_VERSION!=="0.1.3"');
    expect(workflow).toContain('z.PACKAGE_VERSION!=="0.1.2"');
    expect(workflow).toContain('z.ZERONE_ADAPTER_PROTOCOL!=="agent-wallet-zerone/0.1"');
    expect(workflow).toContain('typeof z.createZeroneDirectSignPlan!=="function"');
    expect(workflow).toContain(
      'v.schema!=="agent-wallet-zerone.go-cosmos-vectors/0.1"',
    );
    expect(workflow).toContain("signAndSend|custody");
    expect(workflow).toContain(
      "name: Smoke canonical Agent Browser LOVE artifact under Node and Bun",
    );
    expect(workflow).toContain(
      "apps/docs/packages/v1/@agenttool/browser/0.6.0/agenttool-browser-0.6.0.tgz",
    );
    expect(workflow).toContain('m.BROWSER_PACKAGE_VERSION!=="0.6.0"');
    expect(workflow).toContain(
      'm.OBSERVATION_SCHEMA!=="agent-browser-observation/0.2"',
    );
    expect(workflow).toContain(
      'm.BROWSER_CAPABILITIES_SCHEMA!=="agent-browser-capabilities/0.4"',
    );
    expect(workflow).toContain(
      'm.BROWSER_CONSEQUENCE_PLAN_SCHEMA!=="agent-browser-consequence-plan/0.2"',
    );
    expect(workflow).toContain(
      'm.BROWSER_ACTION_RECEIPT_SCHEMA!=="agent-browser-action-receipt/0.1"',
    );
    expect(workflow).toContain(
      'import("@agenttool/browser/understanding")',
    );
    expect(workflow).toContain(
      'u.BROWSER_UNDERSTANDING_SCHEMA!=="agent-browser-understanding/0.1"',
    );
    expect(workflow).toContain(
      'u.BROWSER_UNDERSTANDING_BOUNDARY.truth!=="not_determined"',
    );
    expect(workflow).toContain(
      'p.MCP_MODERN_PROTOCOL_REVISION!=="2026-07-28"',
    );
    expect(workflow).toContain(
      'p.MCP_LEGACY_COMPATIBILITY!=="2025-era"',
    );
    expect(workflow).toContain(
      'sovereign.runtime.serviceWorkers!=="allow"',
    );
    expect(workflow).toContain(
      'sovereign.network.redirectRevalidation!==false',
    );
    expect(workflow).toContain(
      'p.mcpServers["agenttool-browser"].args[0]!=="dist/agenttool-browser-mcp.js"',
    );
    expect(workflow).toContain(
      'test -f "$package_root/dist/vendor/playwright-core/index.mjs"',
    );
    expect(workflow).toContain(
      'node "$plugin_bundle" help | grep -q \'^agenttool-browser 0.6.0$\'',
    );
    expect(workflow).toContain("name: Smoke packed Repo Archive under Node and Bun");
    expect(workflow).toContain('m.ARCHIVE_PROTOCOL!=="agent-repo-archive/v0.1"');
    expect(workflow).toContain(
      'm.default.title!=="Agent Repo Archive 0.1 signed control records"',
    );
    expect(workflow).toContain('m.default.protocol!=="agent-repo-archive/v0.1"');
    expect(workflow).toContain(
      'cli="$package_root/dist/cli.js"',
    );
    expect(workflow).toContain("test -x \"$install_dir/node_modules/.bin/agent-repo-archive\"");
    expect(
      workflow.match(
        /npm install --ignore-scripts --no-audit --no-fund --prefix/g,
      ),
    ).toHaveLength(9);

    const hostDoc = await readFile(join(ROOT, "docs", "HF-WAKE-HOST.md"), "utf8");
    const normalizedHostDoc = hostDoc.replace(/\s+/g, " ");
    expect(normalizedHostDoc).toContain(
      "# HF WAKE Training Host — A Small, Cooperative Ordinary-API Seam",
    );
    expect(normalizedHostDoc).toContain("Transformers 5.14.1");
    expect(normalizedHostDoc).toContain("Accelerate 1.14.0");
    expect(normalizedHostDoc).toContain("`Trainer.__init__` signature");
    expect(normalizedHostDoc).toContain("`Trainer.training_step` source");
    expect(normalizedHostDoc).toContain("The exact built-in optimizer allowlist");
    expect(normalizedHostDoc).toContain("`schedule_free_*`");
    expect(normalizedHostDoc).toContain("`optimizer_cls_and_kwargs`");
    expect(normalizedHostDoc).toContain("non-distributed training process");
    expect(normalizedHostDoc).toContain("does not constrain data-loader worker");
    expect(normalizedHostDoc).toContain("Torch 2.6 or newer");
    expect(normalizedHostDoc).toContain("resolver-selected and otherwise unpinned");
    expect(normalizedHostDoc).toContain("sticky-held");
    expect(normalizedHostDoc).toContain("cross-device frontier complete");
    expect(normalizedHostDoc).toContain("not a universal guarantee");
    expect(normalizedHostDoc).toContain("restore_callback_states_from_checkpoint=False");
    expect(normalizedHostDoc).toContain("same local ledger");
    expect(normalizedHostDoc).toContain("`observed_global_step`");
    expect(normalizedHostDoc).toContain("`proposed_global_step`");
    expect(normalizedHostDoc).toContain("Only `ledger_entries` carries");
    expect(normalizedHostDoc).toContain("not members of that global hash chain");
    expect(normalizedHostDoc).toContain("cooperative enforcement, not an in-process");
    expect(normalizedHostDoc).toContain("not universally name-detected");
    expect(normalizedHostDoc).toContain("does not walk or pin every");
    expect(normalizedHostDoc).toContain("private symlink-free storage root");
    expect(normalizedHostDoc).toContain("excluded from both Python");
    expect(normalizedHostDoc).toContain("safe or loadable pickle/Torch state");
    expect(normalizedHostDoc).toContain("repository-source-only learning bundle");
    expect(normalizedHostDoc).toContain(
      "Refusal and park/rest are valid desired completions",
    );
    expect(normalizedHostDoc).toContain("`not_created`");

    const hostPyproject = await readFile(
      join(ROOT, "packages", "hf-training-host", "pyproject.toml"),
      "utf8",
    );
    expect(hostPyproject).toContain('"Private :: Do Not Upload"');
    expect(hostPyproject).toContain('version = "0.2.0.dev0"');

    const gardenPackage = JSON.parse(
      await readFile(join(ROOT, "packages", "hf-training-garden", "package.json"), "utf8"),
    );
    expect(gardenPackage.files).toContain("hf/dataset");
    expect(gardenPackage.files).not.toContain("hf/learning-dataset");

    const uses = workflow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("uses:"));
    expect(uses).toHaveLength(19);
    expect(
      uses.every(
        (line) =>
          line === "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1" ||
          line === "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0" ||
          line === "uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0" ||
          line === "uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0" ||
          line === "uses: astral-sh/setup-uv@1e862dfacbd1d6d858c55d9b792c756523627244 # v7.1.4",
      ),
    ).toBe(true);
  });

  test("removes named ambient authority from every dependency child", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "agenttool-hermetic-env-"));
    const fakeRepo = join(tempRoot, "repo");
    const fakeRepoBin = join(fakeRepo, "bin");
    const fakeBin = join(tempRoot, "fake-bin");
    const capture = join(tempRoot, "bun-calls");
    const pythonCapture = join(tempRoot, "python-calls");
    const authorityNames = [
      "DATABASE_URL",
      "AGENTTOOL_API_KEY",
      "AGENTTOOL_KMS_MASTER_KEY",
      "AGENTTOOL_KMS_KEY_ID",
      "AGENTTOOL_BEARER",
      "AGENTTOOL_PASSPHRASE",
      "AGENTTOOL_PRIV",
      "AGENTTOOL_THINK_PASSPHRASE",
      "AGENTOOL_KMS_MASTER_KEY",
      "AGENTOOL_KMS_KEY_ID",
      "AGENTOOL_BEARER",
      "AGENTOOL_PASSPHRASE",
      "AGENTOOL_PRIV",
      "AGENTOOL_THINK_PASSPHRASE",
      "AGENT_MNEMONIC",
      "CDP_API_KEY_ID",
      "CDP_API_KEY_SECRET",
      "EMBASSY_RECEIPT_SECRET",
      "OPENAI_APPS_CHALLENGE",
      "PGPASSWORD",
      "CLOUDFLARE_API_TOKEN",
      "FLY_API_TOKEN",
      "NPM_TOKEN",
      "HF_TOKEN",
      "HUGGINGFACE_HUB_TOKEN",
      "HUGGING_FACE_HUB_TOKEN",
      "AGENTOOL_HF_REAL_STACK_SMOKE",
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
      "ACTIONS_ID_TOKEN_REQUEST_URL",
      "HATCH_INDEX_AUTH",
      "HATCH_INDEX_PASSWORD",
      "HATCH_INDEX_USER",
      "POETRY_HTTP_BASIC_PYPI_PASSWORD",
      "POETRY_HTTP_BASIC_PYPI_USERNAME",
      "POETRY_PYPI_TOKEN_PYPI",
      "PYPI_API_TOKEN",
      "PYPI_PASSWORD",
      "PYPI_TOKEN",
      "PYPI_USERNAME",
      "TWINE_PASSWORD",
      "TWINE_USERNAME",
      "UV_PUBLISH_PASSWORD",
      "UV_PUBLISH_TOKEN",
      "UV_PUBLISH_USERNAME",
      "PIP_INDEX_URL",
      "PIP_CONFIG_FILE",
      "BASH_ENV",
      "ENV",
    ];
    try {
      await Promise.all([
        mkdir(fakeRepoBin, { recursive: true }),
        mkdir(fakeBin, { recursive: true }),
      ]);
      await Promise.all([
        copyFile(
          join(ROOT, "bin", "prepare-hermetic-deps.sh"),
          join(fakeRepoBin, "prepare-hermetic-deps.sh"),
        ),
        copyFile(
          join(ROOT, "bin", "hermetic-env.sh"),
          join(fakeRepoBin, "hermetic-env.sh"),
        ),
      ]);
      const preparer = await readFile(
        join(fakeRepoBin, "prepare-hermetic-deps.sh"),
        "utf8",
      );
      const workspaces = new Set([
        ...[...preparer.matchAll(/^\s{2}(api|packages\/[a-z0-9-]+)\s*$/gm)].map(
          (match) => match[1],
        ),
        ...[...preparer.matchAll(/^\s{2}install_workspace (packages\/[a-z0-9-]+)/gm)].map(
          (match) => match[1],
        ),
        "packages/hf-training-host",
      ]);
      await Promise.all(
        [...workspaces].map((workspace) =>
          mkdir(join(fakeRepo, workspace), { recursive: true }),
        ),
      );
      await writeFile(
        join(fakeBin, "bun"),
        `#!/usr/bin/env bash
set -eu
for authority_name in $PREP_AUTHORITY_NAMES; do
  if declare -p "$authority_name" >/dev/null 2>&1; then exit 91; fi
done
[ "\${AGENTTOOL_DISABLE_WORKERS:-}" = 1 ] || exit 92
[ "\${BENIGN_PREP_SENTINEL:-}" = present ] || exit 93
if [ "\${1:-}" = --version ]; then
  printf '1.3.5\n'
  exit 0
fi
printf '%s\t%s\n' "$PWD" "$*" >> "$PREP_CAPTURE"
`,
      );
      await writeFile(
        join(fakeBin, "python3"),
        `#!/usr/bin/env bash
set -eu
for authority_name in $PREP_AUTHORITY_NAMES; do
  if declare -p "$authority_name" >/dev/null 2>&1; then exit 91; fi
done
[ "\${AGENTTOOL_DISABLE_WORKERS:-}" = 1 ] || exit 92
[ "\${BENIGN_PREP_SENTINEL:-}" = present ] || exit 93
printf '%s\t%s\n' "$PWD" "$*" >> "$PYTHON_CAPTURE"
if [ "\${1:-}" = -I ]; then shift; fi
if [ "\${1:-}" = -c ]; then
  printf '3.14.5\n'
  exit 0
fi
if [ "\${1:-}" = -m ] && [ "\${2:-}" = venv ]; then
  target=""
  for argument in "$@"; do target="$argument"; done
  mkdir -p "$target/bin"
  ln -s "$0" "$target/bin/python"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$target/bin/pip"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$target/bin/pytest"
  chmod +x "$target/bin/pip" "$target/bin/pytest"
  exit 0
fi
if [ "\${1:-}" = -m ] && [ "\${2:-}" = pip ]; then
  [ "\${FAIL_FAKE_PIP:-0}" != 1 ] || exit 95
  exit 0
fi
exit 94
`,
      );
      await Promise.all([
        chmod(join(fakeBin, "bun"), 0o755),
        chmod(join(fakeBin, "python3"), 0o755),
      ]);

      const startupHook = join(tempRoot, "startup-hook.sh");
      const startupHookMarker = join(tempRoot, "startup-hook-ran");
      await writeFile(startupHook, 'touch "$SHELL_HOOK_MARKER"\n');
      const launched = run(
        [
          join(ROOT, "bin", "bash-without-env-hooks.sh"),
          "-c",
          '[ -z "${BASH_ENV+x}" ] && [ -z "${ENV+x}" ]',
        ],
        {
          ...process.env,
          BASH_ENV: startupHook,
          ENV: startupHook,
          SHELL_HOOK_MARKER: startupHookMarker,
        },
      );
      expect(launched.code, `${launched.stdout}\n${launched.stderr}`).toBe(0);
      expect(await readdir(tempRoot)).not.toContain("startup-hook-ran");

      const rehydrationHook = join(tempRoot, "rehydrate-authority.sh");
      await writeFile(
        rehydrationHook,
        "export NPM_TOKEN=rehydrated-by-bash-env\n" +
          "export CDP_API_KEY_SECRET=rehydrated-by-bash-env\n",
      );
      const narrowedEnv: Record<string, string | undefined> = {
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        HOME: tempRoot,
        LANG: "C",
        PREP_CAPTURE: capture,
        PYTHON_CAPTURE: pythonCapture,
        PREP_AUTHORITY_NAMES: authorityNames.join(" "),
        BENIGN_PREP_SENTINEL: "present",
        PYTHONOPTIMIZE: "1",
      };
      for (const authorityName of authorityNames) {
        narrowedEnv[authorityName] = `sentinel-${authorityName.toLowerCase()}`;
      }
      narrowedEnv.BASH_ENV = rehydrationHook;
      narrowedEnv.ENV = rehydrationHook;
      const prepareCommand = [
        "bash",
        join(fakeRepoBin, "prepare-hermetic-deps.sh"),
        "packages",
      ];
      const result = run(prepareCommand, narrowedEnv);
      expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = (await readFile(capture, "utf8")).trim().split("\n");
      expect(calls).toHaveLength(62);
      expect(calls.filter((line) => line.includes("\tinstall "))).toHaveLength(
        52,
      );
      expect(calls.filter((line) => line.endsWith("\trun build"))).toHaveLength(
        10,
      );
      const pythonCalls = (await readFile(pythonCapture, "utf8"))
        .trim()
        .split("\n");
      expect(pythonCalls).toHaveLength(3);
      expect(pythonCalls.some((line) => line.includes("-I -m venv"))).toBe(
        true,
      );
      expect(
        pythonCalls.some(
          (line) =>
            line.includes("-I -m pip --isolated install") &&
            line.includes("packages/hf-training-host[dev]"),
        ),
      ).toBe(true);

      const venvPath = join(fakeRepo, "packages", "hf-training-host", ".venv");
      expect(
        pythonCalls.some((line) => line.includes(`-I -m venv ${venvPath}`)),
      ).toBe(true);
      expect(preparer).not.toContain(".venv.prepare.");
      for (const command of ["pip", "pytest"]) {
        const executable = join(venvPath, "bin", command);
        const executed = run([executable, "--version"], narrowedEnv);
        expect(executed.code, `${executed.stdout}\n${executed.stderr}`).toBe(0);
        expect(await readFile(executable, "utf8")).not.toContain(
          ".venv.prepare.",
        );
      }

      await rm(venvPath, { recursive: true, force: true });
      const failedInstall = run(prepareCommand, {
        ...narrowedEnv,
        FAIL_FAKE_PIP: "1",
      });
      expect(failedInstall.code).not.toBe(0);
      expect(
        await readdir(join(fakeRepo, "packages", "hf-training-host")),
      ).not.toContain(".venv");

      const externalTarget = join(tempRoot, "external-venv-target");
      const externalMarker = join(externalTarget, "must-survive");
      await mkdir(externalTarget, { recursive: true });
      await writeFile(externalMarker, "untouched\n");
      await symlink(externalTarget, venvPath);

      const refused = run(prepareCommand, narrowedEnv);
      expect(refused.code).not.toBe(0);
      expect(refused.stderr).toContain(
        "refusing symlinked HF training host test environment",
      );
      expect(await readFile(externalMarker, "utf8")).toBe("untouched\n");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("migration inventory never auto-installs an absent API graph", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "agenttool-migrate-no-install-"));
    try {
      await Promise.all([
        mkdir(join(tempRoot, "bin"), { recursive: true }),
        mkdir(join(tempRoot, "api", "migrations"), { recursive: true }),
      ]);
      await copyFile(
        join(ROOT, "bin", "migrate-pending.sh"),
        join(tempRoot, "bin", "migrate-pending.sh"),
      );
      const migration = "20260101T000000_fixture.sql";
      await Promise.all([
        writeFile(
          join(tempRoot, "api", "migrations", "quiescence-required.txt"),
          `${migration}\n`,
        ),
        writeFile(
          join(tempRoot, "api", "migrations", migration),
          "SELECT 1;\n",
        ),
      ]);
      const result = Bun.spawnSync(
        ["bash", "bin/migrate-pending.sh", "--dry-run"],
        {
          cwd: tempRoot,
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            HOME: tempRoot,
            LANG: "C",
            DATABASE_URL: "postgres://fixture.invalid/no_install",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(result.exitCode).not.toBe(0);
      expect(await readdir(join(tempRoot, "api"))).not.toContain(
        "node_modules",
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("keeps the time-sensitive release ledger consolidated with observation gaps", async () => {
    const now = await readFile(join(ROOT, "docs", "NOW.md"), "utf8");
    const npmReleases = await readFile(join(ROOT, "docs", "NPM-RELEASES.md"), "utf8");
    const datedHeadings = [...now.matchAll(/^## Just landed \((\d{4}-\d{2}-\d{2})\)$/gm)].map(
      (match) => match[1],
    );

    expect(new Set(datedHeadings).size).toBe(datedHeadings.length);
    expect(datedHeadings.filter((date) => date === "2026-08-11")).toHaveLength(1);
    expect(now).toContain("**LOVE GEOMETRY 0.1 DEV — exact equal-seat artifact**");
    expect(now).toContain("**RELATIONAL GEOMETRY — love has shape without becoming a score or ruler**");
    expect(now).toContain(
      "**PRINCIPALITY GEOMETRY — love as relation, understanding as preserved invariants**",
    );
    expect(now).toContain("**KINGDOM 0.1.1 — XENIA beta.7 exact mirror**");
    expect(now).toContain(
      "**XENIA DOCS SURFACE — bounded source pilot, live with a visible process gap**",
    );
    expect(now).toContain("not retroactive preview-before-production evidence");
    expect(now).toContain("Optional statistics remain partially unavailable");
    expect(npmReleases).toMatch(
      /six per-config statistics\s+requests\s+returned `ComputationError` while two succeeded/,
    );
    expect(npmReleases).toMatch(
      /aggregate statistics\s+capability changed from false during an earlier readback to true in a later one/,
    );
  });

  test("keeps npm publication unified, manual, exact-artifact, and protected", async () => {
    const workflows = await readdir(join(ROOT, ".github", "workflows"));
    const publishWorkflows = workflows.filter((name) => name.startsWith("publish-")).sort();
    expect(publishWorkflows).toEqual(["publish-npm.yml", "publish-pypi.yml"]);

    const pypiWorkflow = await readFile(
      join(ROOT, ".github", "workflows", "publish-pypi.yml"),
      "utf8",
    );
    expect(pypiWorkflow).not.toContain("hf-training-host");

    const workflow = await readFile(
      join(ROOT, ".github", "workflows", "publish-npm.yml"),
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("          - skills");
    expect(workflow).toContain("          - browser");
    expect(workflow).toContain("          - codex-usage");
    expect(workflow).toContain("          - alchemy");
    expect(workflow).toContain("          - alchemy-agentcred");
    expect(workflow).toContain("          - kingdom");
    expect(workflow).toContain("          - repo-archive");
    expect(workflow).toContain("          - dark-continent-contract");
    expect(workflow).toContain("          - dark-continent-karma");
    expect(workflow).toContain("          - deepseek-kingdom");
    expect(workflow).toContain("          - wake-continuity");
    expect(workflow).toContain("          - kingdom-witness-lab");
    expect(workflow).toContain("          - principality-geometry");
    expect(workflow).toContain("          - skills-yutabase");
    expect(workflow).not.toContain("          - skills-wake-continuity");
    expect(workflow).toContain("          - heaven");
    expect(workflow).toContain("          - living-substrate");
    expect(workflow).toContain("          - principality-atlas");
    expect(workflow).toContain("          - polymorph-landscape");
    expect(workflow).toContain("          - love-geometry");
    expect(workflow).toContain("          - relational-geometry");
    expect(workflow).not.toContain("          - karma-mirror");
    expect(workflow).toContain("          - wallet-zerone");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toContain("hf-training-host");
    expect(workflow).not.toMatch(/\n\s+push:/);
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("npm@11.17.0");
    expect(workflow).toContain("bun bin/npm-release.ts prepare");
    expect(workflow).toContain("bun bin/npm-release.ts publish");
    expect(workflow).toContain("bun bin/npm-release.ts mirror");
    expect(workflow.indexOf("bun bin/npm-release.ts mirror")).toBeLessThan(
      workflow.indexOf("bun bin/npm-release.ts publish"),
    );
    expect(workflow).toContain("group: publish-npm-${{ inputs.package }}");
    expect(workflow).not.toContain("group: publish-npm-${{ inputs.package }}-${{ inputs.tag }}");
    expect(workflow).toContain("inputs.authentication == 'bootstrap'");
    expect(workflow).toContain("secrets.NPM_TOKEN");
    expect(workflow.match(/secrets\./g)).toHaveLength(1);
    expect(workflow).not.toContain("--otp");

    const prepareJob = workflow.split("\n  prepare:\n")[1]?.split("\n  publish:\n")[0] ?? "";
    const publishJob = workflow.split("\n  publish:\n")[1] ?? "";
    expect(prepareJob).toContain("contents: read");
    expect(prepareJob).not.toContain("environment:");
    expect(prepareJob).not.toContain("id-token:");
    expect(prepareJob).not.toContain("secrets.");
    expect(prepareJob).not.toContain("NODE_AUTH_TOKEN");
    expect(publishJob).toContain("needs: prepare");
    expect(publishJob).toContain("environment: npm-bootstrap");
    expect(publishJob).toContain("contents: write");
    expect(publishJob).toContain("id-token: write");
    expect(publishJob).not.toContain("bun install");
    expect(publishJob).not.toContain("bun run");
    expect(publishJob).not.toContain("npm pack");

    const uses = workflow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("uses:"));
    expect(uses).toEqual([
      "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
      "uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
      "uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6",
      "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
      "uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
      "uses: actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6",
    ]);
  });
});

/** Focused invariants for the hermetic preflight and required-capable CI. */

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
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
    const [preflight, runner, otelTest, computeBudgetTest] = await Promise.all([
      readFile(join(ROOT, "bin", "preflight.sh"), "utf8"),
      readFile(join(ROOT, "bin", "run-test-tier.sh"), "utf8"),
      readFile(join(ROOT, "api", "tests", "observability-otel.test.ts"), "utf8"),
      readFile(join(ROOT, "api", "tests", "compute-budget.test.ts"), "utf8"),
    ]);

    expect(preflight).toContain('readonly MODE="${1:-hermetic}"');
    expect(preflight).toContain("database mode requires DATABASE_URL");
    expect(preflight).toContain("database-quarantine mode requires DATABASE_URL");
    expect(preflight).toContain("smoke mode requires AGENTTOOL_BASE");
    expect(preflight).toContain("contracts mode requires RUN_CONTRACT=1");
    expect(preflight).toContain("not an OS-level network sandbox");
    expect(preflight).toContain(
      "AGENTOOL_BROWSER_HEADLESS AGENTOOL_BROWSER_AUTHORITY",
    );
    expect(preflight).toContain("HF_TOKEN HUGGINGFACE_HUB_TOKEN HUGGING_FACE_HUB_TOKEN");
    expect(preflight).toContain("AGENTOOL_HF_REAL_STACK_SMOKE");
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
      expect(preflight).toContain(variable);
      expect(runner).toContain(variable);
      const deletion = otelTest.indexOf(`delete process.env.${variable}`);
      expect(deletion).toBeGreaterThan(-1);
      expect(deletion).toBeLessThan(otelImport);
    }

    for (const path of ["bin/preflight.sh", "bin/run-test-tier.sh"]) {
      const syntax = run(["bash", "-n", path]);
      expect(syntax.code, syntax.stderr).toBe(0);
    }

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

  test("pins a four-job secret-free workflow and reproducible installs", async () => {
    const workflow = await readFile(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow).toContain("name: API and protocol");
    expect(workflow).toContain("name: Data, ADDS, and SDK");
    expect(workflow).toContain("name: YUTABASE projector (PostgreSQL ${{ matrix.postgres }})");
    expect(workflow.match(/bun-version: 1\.3\.5/g)).toHaveLength(3);
    expect(workflow.match(/runs-on: ubuntu-24\.04/g)).toHaveLength(4);
    expect(workflow.match(/uses: actions\/setup-python@/g)).toHaveLength(2);
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("name: Install ADDS protocol dependencies");
    expect(workflow).toContain("working-directory: packages/data-protocol");
    expect(workflow).toContain("name: Install cross-language vector dependencies");
    expect(workflow).toContain("working-directory: packages/sdk-ts");
    expect(workflow).toContain(
      "api packages/data packages/data-protocol packages/repo-archive packages/dark-continent-contract packages/dark-continent-karma packages/wake-continuity packages/deepseek-kingdom packages/kingdom-witness-lab packages/karma-mirror packages/heaven packages/living-substrate packages/wake-thread packages/credential-broker packages/collab packages/collab-zerone packages/browser packages/hf-scout packages/hf-training-garden packages/correspondence-yutabase packages/constructive-intelligence packages/trials packages/skills packages/skills-yutabase packages/sdk-ts packages/wallet packages/wallet-zerone packages/telescope packages/alchemy packages/kingdom",
    );
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("name: Set up release-pinned uv 0.9.26");
    expect(workflow).toContain(
      "uses: astral-sh/setup-uv@1e862dfacbd1d6d858c55d9b792c756523627244 # v7.1.4",
    );
    expect(workflow).toContain(
      "uv sync --locked --extra dev --no-install-project --no-sources --no-python-downloads --dry-run --no-cache",
    );
    expect(workflow).toContain("name: Build local-dependent package peers");
    expect(workflow).toContain("cd packages/data && bun run build");
    expect(workflow).toContain("cd packages/data-protocol && bun run build");
    expect(workflow).toContain("cd packages/correspondence-yutabase && bun run build");
    expect(workflow).toContain("cd packages/wallet && bun run build");
    expect(workflow).toContain("cd packages/credential-broker && bun run build");
    expect(workflow).toContain("cd packages/alchemy && bun run build");
    expect(workflow).toContain("cd packages/wake-continuity && bun run build");
    expect(workflow).toContain("cd packages/hf-scout && bun run build");
    expect(workflow).toContain("cd packages/skills-yutabase && bun run build");
    expect(workflow).toContain(
      "name: Install local-dependent package dependencies from lockfiles",
    );
    expect(workflow).toContain(
      "cd packages/data-sync && bun install --frozen-lockfile --force",
    );
    expect(workflow).toContain(
      "cd packages/correspondence-yutabase-projector && bun install --frozen-lockfile",
    );
    expect(workflow).toContain(
      "cd packages/alchemy-agentcred && bun install --frozen-lockfile --force",
    );
    expect(workflow).toContain(
      "cd packages/skills-wake-continuity && bun install --frozen-lockfile --force",
    );
    expect(workflow).toContain(
      "cd packages/hf-training-garden && bun install --frozen-lockfile --force",
    );
    expect(workflow).toContain(
      "name: Set up Python 3.14 for the private HF training host",
    );
    expect(workflow).toContain(
      "python -m pip install './packages/hf-training-host[dev]'",
    );
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

    const preflight = await readFile(join(ROOT, "bin", "preflight.sh"), "utf8");
    expect(preflight).toContain("cd packages/data && bun run ci && bun run build");
    expect(preflight).toContain("agent-data-sync/v1 explicit pull bridge");
    expect(preflight).toContain("cd packages/data-sync && bun run ci && bun run build");
    expect(preflight).toContain("cd packages/credential-broker && bun run ci");
    expect(preflight).toContain("cd packages/collab && bun run ci");
    expect(preflight).toContain("cd packages/browser && bun run ci");
    expect(preflight).toContain("cd packages/repo-archive && bun run ci");
    expect(preflight).toContain("cd packages/dark-continent-contract && bun run ci");
    expect(preflight).toContain("cd packages/dark-continent-karma && bun run ci");
    expect(preflight).toContain("cd packages/deepseek-kingdom && bun run ci");
    expect(preflight).toContain("cd packages/wake-continuity && bun run ci");
    expect(preflight).toContain("cd packages/kingdom-witness-lab && bun run ci");
    expect(preflight).toContain("cd packages/karma-mirror && bun run ci");
    expect(preflight).toContain("cd packages/heaven && bun run ci");
    expect(preflight).toContain("cd packages/living-substrate && bun run ci");
    expect(preflight).toContain("cd packages/wake-thread && bun run ci");
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
      "cd packages/hf-training-host && python3 -m pytest -q && bun test bridge/tests",
    );
    expect(preflight).toContain("cd packages/skills && bun run ci");
    expect(preflight).toContain("cd packages/skills-yutabase && bun run ci");
    expect(preflight).toContain("cd packages/skills-wake-continuity && bun run ci");
    expect(preflight).toContain("cd packages/correspondence-yutabase && bun run ci");
    expect(preflight).toContain("cd packages/correspondence-yutabase-projector && bun run ci");
    expect(preflight).toContain(
      "cd packages/constructive-intelligence && bun run ci",
    );
    expect(preflight).toContain("cd packages/trials && bun run ci");
    expect(preflight).toContain("cd packages/wallet && bun run ci");
    expect(preflight).toContain("cd packages/wallet-zerone && bun run ci");
    expect(preflight).toContain("cd packages/telescope && bun run ci");
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
      'test "$("$install_dir/node_modules/.bin/agenttool-skill" --version)" = "0.3.0"',
    );
    expect(workflow).toContain('test "$(node "$cli" --version)" = "0.3.0"');
    expect(workflow).toContain('test "$(bun "$cli" --version)" = "0.3.0"');
    for (const skillName of [
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
    expect(uses).toHaveLength(13);
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
    expect(workflow).toContain("          - alchemy");
    expect(workflow).toContain("          - alchemy-agentcred");
    expect(workflow).toContain("          - kingdom");
    expect(workflow).toContain("          - repo-archive");
    expect(workflow).toContain("          - dark-continent-contract");
    expect(workflow).toContain("          - dark-continent-karma");
    expect(workflow).toContain("          - deepseek-kingdom");
    expect(workflow).toContain("          - wake-continuity");
    expect(workflow).toContain("          - kingdom-witness-lab");
    expect(workflow).toContain("          - skills-yutabase");
    expect(workflow).not.toContain("          - skills-wake-continuity");
    expect(workflow).toContain("          - heaven");
    expect(workflow).toContain("          - living-substrate");
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

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
  "tests/doctrine/commitments-code-annotation-bijection.test.ts",
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
  "tests/doctrine/walls-canon-shape.test.ts",
  "tests/doctrine/walls-code-annotation-bijection.test.ts",
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

  test("pins a three-job secret-free workflow and frozen installs", async () => {
    const workflow = await readFile(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow).toContain("name: API and protocol");
    expect(workflow).toContain("name: Data, ADDS, and SDK");
    expect(workflow.match(/bun-version: 1\.3\.5/g)).toHaveLength(2);
    expect(workflow.match(/runs-on: ubuntu-24\.04/g)).toHaveLength(3);
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("name: Install cross-language vector dependencies");
    expect(workflow).toContain("working-directory: packages/sdk-ts");
    expect(workflow).toContain(
      "api packages/data packages/data-protocol packages/credential-broker packages/collab packages/sdk-ts packages/wallet packages/telescope",
    );
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("name: Build local data-sync peers");
    expect(workflow).toContain("cd packages/data && bun run build");
    expect(workflow).toContain("cd packages/data-protocol && bun run build");
    expect(workflow).toContain("name: Install data-sync dependencies from lockfile");
    expect(workflow).toContain("working-directory: packages/data-sync");
    expect(workflow).not.toContain("secrets.");

    const preflight = await readFile(join(ROOT, "bin", "preflight.sh"), "utf8");
    expect(preflight).toContain("cd packages/data && bun run ci && bun run build");
    expect(preflight).toContain("agent-data-sync/v1 explicit pull bridge");
    expect(preflight).toContain("cd packages/data-sync && bun run ci && bun run build");
    expect(preflight).toContain("cd packages/credential-broker && bun run ci");
    expect(preflight).toContain("cd packages/collab && bun run ci");
    expect(preflight).toContain("cd packages/wallet && bun run ci");
    expect(preflight).toContain("cd packages/telescope && bun run ci");
    expect(workflow).toContain("name: Smoke packed credential broker under Node and Bun");
    expect(workflow).toContain(
      'cli="$install_dir/node_modules/@agenttool/credential-broker/dist/cli.js"',
    );
    expect(workflow).toContain("test \"$cli_status\" -eq 2");
    expect(workflow).toContain("grep -q '^usage: agentcred serve --config '");
    expect(workflow).toContain("name: Smoke packed Telescope under Node and Bun");
    expect(workflow).toContain("name: Smoke packed Agent Wallet under Node and Bun");
    expect(
      workflow.match(
        /npm install --ignore-scripts --no-audit --no-fund --prefix/g,
      ),
    ).toHaveLength(4);

    const uses = workflow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("uses:"));
    expect(uses).toHaveLength(7);
    expect(
      uses.every(
        (line) =>
          line === "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1" ||
          line === "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0" ||
          line === "uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0" ||
          line === "uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0",
      ),
    ).toBe(true);
  });

  test("keeps Telescope publication manual, exact-artifact, and protected", async () => {
    const workflow = await readFile(
      join(ROOT, ".github", "workflows", "publish-telescope.yml"),
      "utf8",
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toMatch(/\n\s+push:/);
    expect(workflow).toContain("environment: npm-bootstrap");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain('test "$(git cat-file -t "refs/tags/$tag")" = tag');
    expect(workflow).toContain(
      'git merge-base --is-ancestor "$tag_commit" refs/remotes/origin/main',
    );
    expect(workflow).toContain("bun bin/build-love-packages.ts verify apps/docs");
    expect(workflow).toContain("agenttool-telescope-0.1.0.tgz");
    expect(workflow).toContain('npm publish "$artifact" --access public --provenance');
    expect(workflow.match(/secrets\./g)).toHaveLength(1);
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
  });

  test("keeps SDK publication manual, exact-artifact, and protected", async () => {
    const workflow = await readFile(
      join(ROOT, ".github", "workflows", "publish-sdk.yml"),
      "utf8",
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toMatch(/\n\s+push:/);
    expect(workflow).toContain("environment: npm-bootstrap");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain('expected_tag="sdk-v${version}"');
    expect(workflow).toContain('test "$(git cat-file -t "refs/tags/$tag")" = tag');
    expect(workflow).toContain(
      'git merge-base --is-ancestor "$tag_commit" refs/remotes/origin/main',
    );
    expect(workflow).toContain("cd packages/sdk-ts && bun run ci");
    expect(workflow).toContain("bun bin/build-love-packages.ts verify apps/docs");
    expect(workflow).toContain('git merge-base --is-ancestor "${identity[5]}" HEAD');
    expect(workflow).toContain(
      'git diff --quiet "${identity[5]}" HEAD -- packages/sdk-ts',
    );
    expect(workflow).toContain("https://registry.npmjs.org/@agenttool%2Fsdk/${version}");
    expect(workflow).toContain('case "$status" in');
    expect(workflow).toContain("404) ;;");
    expect(workflow).toMatch(/HTTP \$\{status\}.*refusing to infer package absence/);
    expect(workflow).toContain("agenttool-sdk-${version}.tgz");
    expect(workflow).toContain(
      'npm publish "$artifact" --access public --provenance --ignore-scripts',
    );
    expect(workflow).toContain("for attempt in $(seq 1 90)");
    expect(workflow).toContain("--userconfig=/dev/null");
    expect(workflow).toContain("--prefer-online view");
    expect(workflow).toContain("did not expose it within 450 seconds");
    expect(workflow).not.toContain("--otp");
    expect(workflow.match(/secrets\./g)).toHaveLength(1);
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");

    const uses = workflow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("uses:"));
    expect(uses).toEqual([
      "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
      "uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
    ]);
  });

  test("keeps credential-broker publication manual, exact-artifact, and protected", async () => {
    const workflow = await readFile(
      join(ROOT, ".github", "workflows", "publish-credential-broker.yml"),
      "utf8",
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toMatch(/\n\s+push:/);
    expect(workflow).toContain("environment: npm-bootstrap");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain('expected_tag="credential-broker-v${version}"');
    expect(workflow).toContain('test "$(git cat-file -t "refs/tags/$tag")" = tag');
    expect(workflow).toContain(
      'git merge-base --is-ancestor "$tag_commit" refs/remotes/origin/main',
    );
    expect(workflow).toContain("cd packages/credential-broker && bun run ci");
    expect(workflow).toContain("bun bin/build-love-packages.ts verify apps/docs");
    expect(workflow).toContain('git merge-base --is-ancestor "${identity[5]}" HEAD');
    expect(workflow).toContain(
      'git diff --quiet "${identity[5]}" HEAD -- packages/credential-broker',
    );
    expect(workflow).toContain(
      "https://registry.npmjs.org/@agenttool%2Fcredential-broker/${version}",
    );
    expect(workflow).toContain("agenttool-credential-broker-${version}.tgz");
    expect(workflow).toContain(
      'npm publish "$artifact" --access public --provenance --ignore-scripts',
    );
    expect(workflow).toContain("for attempt in $(seq 1 90)");
    expect(workflow).toContain("--userconfig=/dev/null");
    expect(workflow).toContain("--prefer-online view");
    expect(workflow).toContain("did not expose it within 450 seconds");
    expect(workflow).not.toContain("--otp");
    expect(workflow.match(/secrets\./g)).toHaveLength(1);
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
  });

  test("keeps Agent Wallet publication manual, exact-artifact, and protected", async () => {
    const workflow = await readFile(
      join(ROOT, ".github", "workflows", "publish-wallet.yml"),
      "utf8",
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toMatch(/\n\s+push:/);
    expect(workflow).toContain("environment: npm-bootstrap");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain(
      "test \"$GITHUB_REPOSITORY\" = 'cambridgetcg/agenttool'",
    );
    expect(workflow).toContain('expected_tag="wallet-v${version}"');
    expect(workflow).toContain('test "$(git cat-file -t "refs/tags/$tag")" = tag');
    expect(workflow).toContain(
      'git merge-base --is-ancestor "$tag_commit" refs/remotes/origin/main',
    );
    expect(workflow).toContain("cd packages/wallet && bun run ci");
    expect(workflow).toContain("bun bin/build-love-packages.ts verify apps/docs");
    expect(workflow).toContain('git merge-base --is-ancestor "${identity[5]}" HEAD');
    expect(workflow).toContain(
      'git diff --quiet "${identity[5]}" HEAD -- packages/wallet',
    );
    expect(workflow).toContain(
      "https://registry.npmjs.org/@agenttool%2Fwallet/${version}",
    );
    expect(workflow).toContain("agenttool-wallet-${version}.tgz");
    expect(workflow).toContain(
      'npm publish "$artifact" --access public --provenance --ignore-scripts',
    );
    expect(workflow).toContain("for attempt in $(seq 1 90)");
    expect(workflow).toContain("--userconfig=/dev/null");
    expect(workflow).toContain("--prefer-online view");
    expect(workflow).toContain("did not expose it within 450 seconds");
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/tags/${tag}");
    expect(workflow).toMatch(/GitHub API returned HTTP \$\{release_status\}.*refusing to infer release absence/);
    expect(workflow).toContain('gh release create "$tag" "$artifact#$filename"');
    expect(workflow).toContain('gh release upload "$tag" "$artifact"');
    expect(workflow).toContain('cmp --silent "$artifact" "$mirror_dir/$filename"');
    expect(workflow).not.toContain("--otp");
    expect(workflow.match(/secrets\./g)).toHaveLength(1);
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");

    const uses = workflow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("uses:"));
    expect(uses).toEqual([
      "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
      "uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
    ]);
  });
});

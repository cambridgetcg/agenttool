import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  WHITEHACK_INTEGRITY,
  WHITEHACK_PACKAGE,
  WHITEHACK_REPOSITORY,
  WHITEHACK_REVISION,
  WHITEHACK_TARBALL_URL,
  WHITEHACK_VERSION,
  listChangedPaths,
  loadVerifiedWhitehackModule,
  runAdvisory,
  selectCandidateFiles,
  verifyCheckedOutHead,
  type WhitehackAdvisoryError,
} from "../whitehack-advisory.mjs";

const cleanup: string[] = [];
const repoRoot = resolve(import.meta.dir, "../..");
const fixtureRevision = "c".repeat(40);
const checkManifestSource = `
export const CHECK_MANIFEST = Object.freeze(Array.from(
  { length: 47 },
  (_, index) => Object.freeze({ id: \`fixture-check-\${index + 1}\` }),
));
`;

type ScannerFixture = {
  corePath: string;
  understandingPath: string;
  lockPath: string;
  packagePath: string;
  root: string;
  toolPackagePath: string;
  toolRoot: string;
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(root);
  return root;
}

async function commitAll(root: string, message: string): Promise<string> {
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Whitehack Test",
    "-c",
    "user.email=whitehack@example.invalid",
    "commit",
    "-qm",
    message,
  ]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function scannerFixture(
  source: string,
  version = WHITEHACK_VERSION,
): Promise<ScannerFixture> {
  const toolRoot = await temporaryRoot("whitehack-tool-");
  const root = join(toolRoot, "node_modules", "@agenttool", "whitehack-scan");
  const corePath = join(root, "src", "core.js");
  const understandingPath = join(root, "src", "understanding.js");
  const packagePath = join(root, "package.json");
  const lockPath = join(toolRoot, "package-lock.json");
  const toolPackagePath = join(toolRoot, "package.json");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    toolPackagePath,
    `${JSON.stringify({
      name: "@agenttool/whitehack-advisory-test-tooling",
      version: "0.0.0",
      private: true,
      packageManager: "npm@11.17.0",
      devDependencies: { [WHITEHACK_PACKAGE]: WHITEHACK_VERSION },
    }, null, 2)}\n`,
  );
  await writeFile(
    lockPath,
    `${JSON.stringify({
      name: "@agenttool/whitehack-advisory-test-tooling",
      version: "0.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "@agenttool/whitehack-advisory-test-tooling",
          version: "0.0.0",
          devDependencies: { [WHITEHACK_PACKAGE]: WHITEHACK_VERSION },
        },
        [`node_modules/${WHITEHACK_PACKAGE}`]: {
          version: WHITEHACK_VERSION,
          resolved: WHITEHACK_TARBALL_URL,
          integrity: WHITEHACK_INTEGRITY,
          dev: true,
          license: "MIT",
        },
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    packagePath,
    `${JSON.stringify({
      name: WHITEHACK_PACKAGE,
      version,
      type: "module",
      exports: {
        "./core": "./src/core.js",
        "./understanding": "./src/understanding.js",
      },
      scripts: { test: "node --test" },
    }, null, 2)}\n`,
  );
  await writeFile(corePath, `${checkManifestSource}\n${source}`);
  await writeFile(
    understandingPath,
    `export const UNDERSTANDING_DOCUMENT_TYPE = "whitehack-understanding/v1";
export const UNDERSTANDING_CONTEXT_PROFILE = "whitehack-agent-wallet-projection/v1";
export const UNDERSTANDING_SOURCE_PROTOCOL = "agent-wallet/0.1";
export function createUnderstanding(options) {
  return Object.freeze({
    document_type: UNDERSTANDING_DOCUMENT_TYPE,
    options,
  });
}
`,
  );
  return {
    corePath,
    understandingPath,
    lockPath,
    packagePath,
    root,
    toolPackagePath,
    toolRoot,
  };
}

async function readJson(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function scannerOptions(scanner: ScannerFixture) {
  return {
    scanner_lock: scanner.lockPath,
    scanner_root: scanner.root,
    expected_revision: fixtureRevision,
  };
}

function understandingLoaderOptions(scanner: ScannerFixture) {
  return {
    scanner_lock: scanner.lockPath,
    scanner_root: scanner.root,
    export_name: "understanding",
    expected_revision: fixtureRevision,
  };
}

async function expectScannerFailure(
  scanner: ScannerFixture,
  code: string,
): Promise<void> {
  const source = await sourceFixture();
  await expect(runAdvisory({
    root: source,
    paths: ["src/app.ts"],
    ...scannerOptions(scanner),
    base: "a".repeat(40),
    head: "b".repeat(40),
  })).rejects.toMatchObject({ code } satisfies Partial<WhitehackAdvisoryError>);
}

async function sourceFixture(): Promise<string> {
  const root = await temporaryRoot("whitehack-source-");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const value = 1;\n");
  return root;
}

function completeUnderstandingContext() {
  return {
    profile: "whitehack-agent-wallet-projection/v1",
    source_protocol: "agent-wallet/0.1",
    records: {
      descriptor: "verified",
      capability: "verified",
      intent: "verified",
      simulation: "verified",
      continuity: "verified",
    },
    relations: {
      "descriptor-capability": "match",
      "capability-intent": "match",
      delegate: "match",
      chain: "match",
      source: "match",
      "intent-simulation": "match",
      revocation: "match",
    },
    policy: {
      calls: "within-bounds",
      spend: "within-bounds",
      fee: "within-bounds",
      expiry: "within-bounds",
      use: "within-bounds",
      approvals: "not-required",
    },
    simulation: {
      execution: "passed",
      effects: "match",
      fee: "within-bounds",
    },
    custody: {
      "descriptor-mode": "self-custodied",
      "signer-exportability": "non-exportable",
    },
  };
}

afterAll(async () => {
  await Promise.all(cleanup.map((path) => rm(path, { recursive: true, force: true })));
});

describe("Whitehack advisory containment", () => {
  test("keeps the workflow and public docs on the bridge pin contract", async () => {
    expect(WHITEHACK_REVISION).toMatch(/^[0-9a-f]{40}$/);
    const workflow = await readFile(
      join(repoRoot, ".github", "workflows", "whitehack.yml"),
      "utf8",
    );
    expect(workflow).not.toContain("repository: cambridgetcg/whitehack");
    expect(workflow).toContain("node-version: 24.18.0");
    expect(workflow).toContain("npm install --global npm@11.17.0 --ignore-scripts");
    expect(workflow).toContain("working-directory: tools/whitehack-advisory");
    expect(workflow).toContain("npm ci --ignore-scripts --no-audit --no-fund");
    expect(workflow).toContain("npm audit signatures");
    expect(workflow).toContain(
      "--scanner-root tools/whitehack-advisory/node_modules/@agenttool/whitehack-scan",
    );
    expect(workflow).toContain(
      "--scanner-lock tools/whitehack-advisory/package-lock.json",
    );

    const toolPackage = await readJson(
      join(repoRoot, "tools", "whitehack-advisory", "package.json"),
    );
    const lock = await readJson(
      join(repoRoot, "tools", "whitehack-advisory", "package-lock.json"),
    );
    expect(toolPackage.private).toBe(true);
    expect(toolPackage.packageManager).toBe("npm@11.17.0");
    expect(toolPackage.devDependencies).toEqual({
      [WHITEHACK_PACKAGE]: WHITEHACK_VERSION,
    });
    expect(Object.keys(lock.packages).sort()).toEqual([
      "",
      `node_modules/${WHITEHACK_PACKAGE}`,
    ]);
    expect(lock.packages[""].devDependencies).toEqual({
      [WHITEHACK_PACKAGE]: WHITEHACK_VERSION,
    });
    expect(lock.packages[`node_modules/${WHITEHACK_PACKAGE}`]).toMatchObject({
      version: WHITEHACK_VERSION,
      resolved: WHITEHACK_TARBALL_URL,
      integrity: WHITEHACK_INTEGRITY,
      dev: true,
    });

    const publicHtml = await readFile(
      join(repoRoot, "apps", "docs", "whitehack.html"),
      "utf8",
    );
    expect(publicHtml).toContain(WHITEHACK_PACKAGE);
    expect(publicHtml).toContain(WHITEHACK_REVISION);
    expect(publicHtml).toContain(WHITEHACK_VERSION);
    const exactPackage = `${WHITEHACK_PACKAGE}@${WHITEHACK_VERSION}`;
    const cloudflareSafePackage = `<!--email_off-->${exactPackage}<!--/email_off-->`;
    expect(publicHtml).toContain(cloudflareSafePackage);
    expect(publicHtml.replaceAll(cloudflareSafePackage, "")).not.toContain(exactPackage);
  });

  test("loads only a reviewed exact Whitehack export", async () => {
    const scanner = await scannerFixture("export function scanText() { return []; }\n");
    const loaded = await loadVerifiedWhitehackModule(understandingLoaderOptions(scanner));

    expect(loaded.module.UNDERSTANDING_DOCUMENT_TYPE).toBe("whitehack-understanding/v1");
    expect(typeof loaded.module.createUnderstanding).toBe("function");
    expect(loaded.scanner).toMatchObject({
      scannerRoot: await realpath(scanner.root),
      modulePath: await realpath(scanner.understandingPath),
      revision: fixtureRevision,
      version: WHITEHACK_VERSION,
    });

    await expect(loadVerifiedWhitehackModule({
      ...understandingLoaderOptions(scanner),
      export_name: "report",
    })).rejects.toMatchObject({
      code: "scanner_export_name_invalid",
    } satisfies Partial<WhitehackAdvisoryError>);
  });

  test("refuses changed and escaping understanding export declarations", async () => {
    for (const exportPath of ["./src/changed.js", "../outside.js"]) {
      const scanner = await scannerFixture("export function scanText() { return []; }\n");
      const packageJson = await readJson(scanner.packagePath);
      packageJson.exports["./understanding"] = exportPath;
      await writeJson(scanner.packagePath, packageJson);

      await expect(loadVerifiedWhitehackModule(
        understandingLoaderOptions(scanner),
      )).rejects.toMatchObject({
        code: "scanner_understanding_export_mismatch",
      } satisfies Partial<WhitehackAdvisoryError>);
    }
  });

  test("refuses a symlinked understanding module outside the package", async () => {
    const scanner = await scannerFixture("export function scanText() { return []; }\n");
    const outsideRoot = await temporaryRoot("whitehack-outside-understanding-");
    const outsideModule = join(outsideRoot, "understanding.js");
    await writeFile(
      outsideModule,
      "export function createUnderstanding() { return {}; }\n",
    );
    await rm(scanner.understandingPath);
    await symlink(outsideModule, scanner.understandingPath);

    await expect(loadVerifiedWhitehackModule(
      understandingLoaderOptions(scanner),
    )).rejects.toMatchObject({
      code: "scanner_module_outside_root",
    } satisfies Partial<WhitehackAdvisoryError>);
  });

  test("fails closed when the understanding module emits during import", async () => {
    const scanner = await scannerFixture("export function scanText() { return []; }\n");
    await writeFile(
      scanner.understandingPath,
      `console.error("private_understanding_import_text");
export function createUnderstanding() { return {}; }
`,
    );

    await expect(loadVerifiedWhitehackModule(
      understandingLoaderOptions(scanner),
    )).rejects.toMatchObject({
      code: "scanner_import_failed",
    } satisfies Partial<WhitehackAdvisoryError>);
  });

  test.skipIf(process.env.WHITEHACK_INTEGRATION !== "1")(
    "loads the exact installed Whitehack understanding API contract",
    async () => {
      const scannerRoot = join(
        repoRoot,
        "tools",
        "whitehack-advisory",
        "node_modules",
        "@agenttool",
        "whitehack-scan",
      );
      const { module, scanner } = await loadVerifiedWhitehackModule({
        scanner_root: scannerRoot,
        scanner_lock: join(repoRoot, "tools", "whitehack-advisory", "package-lock.json"),
        export_name: "understanding",
      });

      expect(scanner).toMatchObject({
        revision: WHITEHACK_REVISION,
        version: WHITEHACK_VERSION,
      });
      expect(module.UNDERSTANDING_DOCUMENT_TYPE).toBe("whitehack-understanding/v1");
      expect(module.UNDERSTANDING_CONTEXT_PROFILE).toBe(
        "whitehack-agent-wallet-projection/v1",
      );
      expect(module.UNDERSTANDING_SOURCE_PROTOCOL).toBe("agent-wallet/0.1");
      expect(typeof module.createUnderstanding).toBe("function");

      const document = module.createUnderstanding({
        findings: [],
        context: completeUnderstandingContext(),
      });
      expect(document.document_type).toBe(module.UNDERSTANDING_DOCUMENT_TYPE);
      expect(document.boundaries.direct_capabilities).toMatchObject({
        filesystem: false,
        network: false,
        key_store_access: false,
        signing: false,
        rpc: false,
        broadcast: false,
        authorization: false,
      });
      expect(document.boundaries.wallet_subject_bound).toBe(false);
      expect(document.inferences.find(({ id }) => id === "execution-readiness")?.status)
        .toBe("indeterminate");
      expect(Object.isFrozen(document)).toBe(true);
      expect(Object.isFrozen(document.boundaries.direct_capabilities)).toBe(true);
    },
  );

  test("serializes metadata without source snippets, messages, or scanner secrets", async () => {
    const scanner = await scannerFixture(`
export function scanText(source, options) {
  if (!source.includes("export const value = 1") || options.file !== "src/app.ts") {
    throw new Error("fixture_source_or_file_mismatch");
  }
  return [{
    line: 7,
    check: "hardcoded-secret",
    title: "Hardcoded secret: fixture_sensitive_text_7f3a",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
    message: "credential fixture_sensitive_text_7f3a was found",
    snippet: "const token = 'fixture_sensitive_text_7f3a'",
  }];
}
`);
    const source = await sourceFixture();
    await writeFile(
      join(source, "src", "app.ts"),
      "\n\n\n\n\n\nexport const value = 1;\n",
    );
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      ...scannerOptions(scanner),
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("complete");
    expect(report.scanner).toEqual({
      repository: WHITEHACK_REPOSITORY,
      revision: fixtureRevision,
      version: WHITEHACK_VERSION,
    });
    expect(report.findings).toEqual([{
      file: "src/app.ts",
      line: 7,
      check: "hardcoded-secret",
      confidence: "high",
      doctrine: "substrate-honesty",
      principle: 2,
    }]);
    const serialized = JSON.stringify(report);
    const serializedFindings = JSON.stringify(report.findings);
    expect(serialized).not.toContain("fixture_sensitive_text_7f3a");
    expect(serializedFindings).not.toContain("snippet");
    expect(serializedFindings).not.toContain("message");
    expect(serializedFindings).not.toContain("title");
  });

  test("redacts every crypto-aware check to the same six metadata fields", async () => {
    const scanner = await scannerFixture(`
const checks = [
  ["hardcoded-secret", "high", 2],
  ["weak-crypto", "medium-high", 2],
  ["static-aead-nonce", "heuristic", 1],
  ["signature-fail-open", "medium-high", 2],
  ["webhook-reencoded-body", "heuristic", 1],
  ["signed-webhook-without-replay-guard", "heuristic", 4],
  ["wallet-key-egress", "medium-high", 2],
  ["wallet-direct-request-signing", "heuristic", 3],
  ["wallet-capability-unbounded", "heuristic", 3],
  ["wallet-broadcast-auto-retry", "heuristic", 2],
  ["unlimited-token-approval", "heuristic", 3],
];
export function scanText() {
  return checks.map(([check, confidence, principle]) => ({
    line: 1,
    check,
    confidence,
    doctrine: "substrate-honesty",
    principle,
    title: "fixture_crypto_private_marker_91c2",
    message: "fixture_crypto_private_marker_91c2",
    snippet: "fixture_crypto_private_marker_91c2",
  }));
}
`);
    const source = await sourceFixture();
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      ...scannerOptions(scanner),
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("complete");
    expect(report.findings).toHaveLength(11);
    expect(report.findings.map(({ check }) => check).sort()).toEqual([
      "hardcoded-secret",
      "weak-crypto",
      "static-aead-nonce",
      "signature-fail-open",
      "webhook-reencoded-body",
      "signed-webhook-without-replay-guard",
      "wallet-key-egress",
      "wallet-direct-request-signing",
      "wallet-capability-unbounded",
      "wallet-broadcast-auto-retry",
      "unlimited-token-approval",
    ].sort());
    for (const finding of report.findings) {
      expect(Object.keys(finding)).toEqual([
        "file",
        "line",
        "check",
        "confidence",
        "doctrine",
        "principle",
      ]);
    }
    const serialized = JSON.stringify(report);
    const serializedFindings = JSON.stringify(report.findings);
    expect(serialized).not.toContain("fixture_crypto_private_marker_91c2");
    expect(serializedFindings).not.toContain("snippet");
    expect(serializedFindings).not.toContain("message");
    expect(serializedFindings).not.toContain("title");
  });

  test("accepts every advisory v0.1 confidence label", async () => {
    const scanner = await scannerFixture(`
export function scanText() {
  return ["high", "medium-high", "medium", "heuristic"].map((confidence) => ({
    line: 1,
    check: \`confidence-\${confidence}\`,
    confidence,
    doctrine: "substrate-honesty",
    principle: 6,
    snippet: \`private_confidence_source_\${confidence}\`,
  }));
}
`);
    const source = await sourceFixture();
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      ...scannerOptions(scanner),
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("complete");
    expect(report.summary.by_confidence).toEqual({
      heuristic: 1,
      high: 1,
      medium: 1,
      "medium-high": 1,
    });
    expect(report.findings.map(({ confidence }) => confidence).sort()).toEqual(
      ["high", "medium-high", "medium", "heuristic"].sort(),
    );
    expect(JSON.stringify(report)).not.toContain("private_confidence_source");
  });

  test("marks a scanner console error incomplete without serializing its text", async () => {
    const scanner = await scannerFixture(`
export function scanText() {
  console.error("scanner accidentally emitted fixture_console_sensitive_7f3a");
  return [];
}
`);
    const source = await sourceFixture();
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      ...scannerOptions(scanner),
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("incomplete");
    expect(report.errors).toEqual([{ file: "src/app.ts", code: "scanner_file_incomplete" }]);
    expect(JSON.stringify(report)).not.toContain("fixture_console_sensitive_7f3a");
  });

  test("refuses lock drift in package version, source URL, integrity, or topology", async () => {
    const cases: Array<{
      code: string;
      mutate: (scanner: ScannerFixture) => Promise<void>;
    }> = [
      {
        code: "scanner_lock_mismatch",
        mutate: async (scanner) => {
          const lock = await readJson(scanner.lockPath);
          lock.packages[""].devDependencies[WHITEHACK_PACKAGE] = `^${WHITEHACK_VERSION}`;
          await writeJson(scanner.lockPath, lock);
        },
      },
      {
        code: "scanner_lock_mismatch",
        mutate: async (scanner) => {
          const lock = await readJson(scanner.lockPath);
          lock.packages[`node_modules/${WHITEHACK_PACKAGE}`].resolved =
            "https://registry.example.invalid/whitehack-scan.tgz";
          await writeJson(scanner.lockPath, lock);
        },
      },
      {
        code: "scanner_integrity_mismatch",
        mutate: async (scanner) => {
          const lock = await readJson(scanner.lockPath);
          lock.packages[`node_modules/${WHITEHACK_PACKAGE}`].integrity =
            "sha512-fixture_mismatch";
          await writeJson(scanner.lockPath, lock);
        },
      },
      {
        code: "scanner_lock_mismatch",
        mutate: async (scanner) => {
          const lock = await readJson(scanner.lockPath);
          lock.packages["node_modules/unreviewed-transitive"] = {
            version: "1.0.0",
            integrity: "sha512-unreviewed",
          };
          await writeJson(scanner.lockPath, lock);
        },
      },
    ];

    for (const { code, mutate } of cases) {
      const scanner = await scannerFixture("export function scanText() { return []; }\n");
      await mutate(scanner);
      await expectScannerFailure(scanner, code);
    }
  });

  test("refuses tool manifest drift from the exact private npm install", async () => {
    const cases: Array<(toolPackage: Record<string, any>) => void> = [
      (toolPackage) => { toolPackage.private = false; },
      (toolPackage) => { toolPackage.packageManager = "npm@latest"; },
      (toolPackage) => {
        toolPackage.devDependencies[WHITEHACK_PACKAGE] = `^${WHITEHACK_VERSION}`;
      },
      (toolPackage) => { toolPackage.devDependencies.extra = "1.0.0"; },
    ];

    for (const mutate of cases) {
      const scanner = await scannerFixture("export function scanText() { return []; }\n");
      const toolPackage = await readJson(scanner.toolPackagePath);
      mutate(toolPackage);
      await writeJson(scanner.toolPackagePath, toolPackage);
      await expectScannerFailure(scanner, "scanner_lock_mismatch");
    }
  });

  test("refuses an installed package with the wrong identity or version", async () => {
    const scanner = await scannerFixture(
      "export function scanText() { return []; }\n",
      "0.0.0",
    );
    await expectScannerFailure(scanner, "scanner_version_mismatch");

    const wrongName = await scannerFixture("export function scanText() { return []; }\n");
    const packageJson = await readJson(wrongName.packagePath);
    packageJson.name = "@agenttool/not-whitehack";
    await writeJson(wrongName.packagePath, packageJson);
    await expectScannerFailure(wrongName, "scanner_package_name_mismatch");
  });

  test("refuses runtime dependencies, lifecycle hooks, and a changed core export", async () => {
    const cases: Array<{
      code: string;
      mutate: (packageJson: Record<string, any>) => void;
    }> = [
      {
        code: "scanner_runtime_dependencies",
        mutate: (packageJson) => { packageJson.dependencies = { unreviewed: "1.0.0" }; },
      },
      {
        code: "scanner_runtime_dependencies",
        mutate: (packageJson) => { packageJson.optionalDependencies = { unreviewed: "1.0.0" }; },
      },
      {
        code: "scanner_runtime_dependencies",
        mutate: (packageJson) => { packageJson.peerDependencies = { unreviewed: "1.0.0" }; },
      },
      {
        code: "scanner_runtime_dependencies",
        mutate: (packageJson) => { packageJson.bundledDependencies = ["unreviewed"]; },
      },
      {
        code: "scanner_lifecycle_script",
        mutate: (packageJson) => { packageJson.scripts.install = "node unreviewed.js"; },
      },
      {
        code: "scanner_lifecycle_script",
        mutate: (packageJson) => { packageJson.scripts.postpublish = "node unreviewed.js"; },
      },
      {
        code: "scanner_core_export_mismatch",
        mutate: (packageJson) => { packageJson.exports["./core"] = "./src/other.js"; },
      },
    ];

    for (const { code, mutate } of cases) {
      const scanner = await scannerFixture("export function scanText() { return []; }\n");
      const packageJson = await readJson(scanner.packagePath);
      mutate(packageJson);
      await writeJson(scanner.packagePath, packageJson);
      await expectScannerFailure(scanner, code);
    }
  });

  test("refuses symlinked package and core paths outside the locked tool root", async () => {
    const packageLink = await scannerFixture("export function scanText() { return []; }\n");
    const outsidePackage = await scannerFixture("export function scanText() { return []; }\n");
    await rm(packageLink.root, { recursive: true, force: true });
    await symlink(outsidePackage.root, packageLink.root);
    await expectScannerFailure(packageLink, "scanner_root_mismatch");

    const coreLink = await scannerFixture("export function scanText() { return []; }\n");
    const outsideCoreRoot = await temporaryRoot("whitehack-outside-core-");
    const outsideCore = join(outsideCoreRoot, "core.js");
    await writeFile(outsideCore, `${checkManifestSource}\nexport function scanText() { return []; }\n`);
    await rm(coreLink.corePath);
    await symlink(outsideCore, coreLink.corePath);
    await expectScannerFailure(coreLink, "scanner_module_outside_root");
  });

  test("requires the pure core API and the reviewed 47-check manifest", async () => {
    const missingApi = await scannerFixture("export function scan() { return []; }\n");
    await expectScannerFailure(missingApi, "scanner_import_failed");

    const shortManifest = await scannerFixture("export function scanText() { return []; }\n");
    await writeFile(
      shortManifest.corePath,
      "export const CHECK_MANIFEST = Array.from({ length: 46 });\nexport function scanText() { return []; }\n",
    );
    await expectScannerFailure(shortManifest, "scanner_import_failed");
  });

  test("marks the pure scanner's line ceiling incomplete without leaking its error", async () => {
    const scanner = await scannerFixture(`
export function scanText(source) {
  if (source.split("\\n").length > 10_000) {
    throw new Error("private_line_limit_detail");
  }
  return [];
}
`);
    const source = await sourceFixture();
    await writeFile(join(source, "src", "app.ts"), "x\n".repeat(10_000));
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      ...scannerOptions(scanner),
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("incomplete");
    expect(report.errors).toEqual([{ file: "src/app.ts", code: "scanner_file_incomplete" }]);
    expect(report.summary.finding_count).toBe(0);
    expect(JSON.stringify(report)).not.toContain("private_line_limit_detail");
  });

  test("observes only bounded regular production files inside the repository", async () => {
    const root = await sourceFixture();
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "tests", "app.test.ts"), "test('fixture', () => {});\n");
    await writeFile(join(root, ".env"), "TOKEN=not-read\n");
    const outside = join(await temporaryRoot("whitehack-outside-"), "outside.ts");
    await writeFile(outside, "export const outside = true;\n");
    await symlink(outside, join(root, "src", "linked.ts"));

    const selected = await selectCandidateFiles(root, [
      "src/app.ts",
      "src/linked.ts",
      "tests/app.test.ts",
      ".env",
      "README.md",
    ]);

    expect(selected.selected.map(({ path }) => path)).toEqual(["src/app.ts"]);
    expect(selected.skipped).toEqual({
      hidden_path: 1,
      unsupported_extension: 1,
      non_regular_file: 1,
      non_production_path: 1,
    });
  });

  test("uses a NUL-delimited Git diff and leaves filtering to the bounded selector", async () => {
    const root = await sourceFixture();
    git(root, ["init", "-q", "-b", "main"]);
    const base = await commitAll(root, "test: base");
    await writeFile(join(root, "src", "app.ts"), "export const value = 2;\n");
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "tests", "new.test.ts"), "export const fixture = true;\n");
    const head = await commitAll(root, "test: change");

    expect(listChangedPaths(root, base, head)).toEqual(["src/app.ts", "tests/new.test.ts"]);
    const selected = await selectCandidateFiles(root, listChangedPaths(root, base, head));
    expect(selected.selected.map(({ path }) => path)).toEqual(["src/app.ts"]);
  });

  test("reports an explicit scoped zero when no changed path is eligible", async () => {
    const scanner = await scannerFixture("export function scanText() { return []; }\n");
    const source = await sourceFixture();
    await writeFile(join(source, "README.md"), "not scanned\n");

    const report = await runAdvisory({
      root: source,
      paths: ["README.md"],
      ...scannerOptions(scanner),
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("complete");
    expect(report.scope.candidate_count).toBe(0);
    expect(report.scope.skipped).toEqual({ unsupported_extension: 1 });
    expect(report.summary.finding_count).toBe(0);
  });

  test("fails closed on malformed finding metadata without copying it", async () => {
    const scanner = await scannerFixture(`
export function scanText() {
  return [{
    line: 1,
    check: "bad\\nprivate_finding_text",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
    snippet: "private_finding_text",
  }];
}
`);
    const source = await sourceFixture();
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      ...scannerOptions(scanner),
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("incomplete");
    expect(report.findings).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("private_finding_text");
  });

  test("suppresses scanner console output during module import", async () => {
    const scanner = await scannerFixture(`
console.warn("private_import_text");
export function scanText() { return []; }
`);
    const source = await sourceFixture();

    await expect(runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      ...scannerOptions(scanner),
      base: "a".repeat(40),
      head: "b".repeat(40),
    })).rejects.toMatchObject({ code: "scanner_import_failed" } satisfies Partial<WhitehackAdvisoryError>);
  });

  test("suppresses direct scanner stdout and stderr writes", async () => {
    const scanner = await scannerFixture(`
export function scanText() {
  process.stdout.write("private_stdout_text");
  process.stderr.write("private_stderr_text");
  return [];
}
`);
    const source = await sourceFixture();
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      ...scannerOptions(scanner),
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("incomplete");
    expect(JSON.stringify(report)).not.toContain("private_stdout_text");
    expect(JSON.stringify(report)).not.toContain("private_stderr_text");
  });

  test("rejects control, bidi, overlong, and absolute candidate paths", async () => {
    const root = await sourceFixture();
    for (const path of [
      "src/bad\n::error::.ts",
      "src/bad\u202eevil.ts",
      `${"a".repeat(1_025)}.ts`,
      join(root, "src", "app.ts"),
    ]) {
      await expect(selectCandidateFiles(root, [path])).rejects.toMatchObject({
        code: "invalid_candidate_path",
      } satisfies Partial<WhitehackAdvisoryError>);
    }
  });

  test("accepts shell-like but non-control names without invoking a shell", async () => {
    const root = await sourceFixture();
    const path = "src/- space %,colon::error::.ts";
    await writeFile(join(root, path), "export const safe = true;\n");
    const selected = await selectCandidateFiles(root, [path]);
    expect(selected.selected.map((candidate) => candidate.path)).toEqual([path]);
  });

  test("fails closed when an eligible changed file is missing or invalid UTF-8", async () => {
    const root = await sourceFixture();
    await expect(selectCandidateFiles(root, ["src/missing.ts"])).rejects.toMatchObject({
      code: "candidate_missing_or_unreadable",
    } satisfies Partial<WhitehackAdvisoryError>);

    await writeFile(join(root, "src", "invalid.ts"), new Uint8Array([0xff, 0xfe]));
    await expect(selectCandidateFiles(root, ["src/invalid.ts"])).rejects.toMatchObject({
      code: "invalid_source_encoding",
    } satisfies Partial<WhitehackAdvisoryError>);
  });

  test("fails rather than truncating coverage or aggregate findings", async () => {
    const root = await sourceFixture();
    await writeFile(join(root, "src", "second.ts"), "ok\n");
    await expect(selectCandidateFiles(root, ["src/app.ts", "src/second.ts"], {
      max_changed_paths: 1,
    })).rejects.toMatchObject({
      code: "changed_path_count_limit_exceeded",
    } satisfies Partial<WhitehackAdvisoryError>);
    await expect(selectCandidateFiles(root, ["src/app.ts", "src/second.ts"], {
      max_files: 1,
    })).rejects.toMatchObject({
      code: "file_count_limit_exceeded",
    } satisfies Partial<WhitehackAdvisoryError>);

    const scanner = await scannerFixture(`
export function scanText() {
  return [1, 2].map((line) => ({
    line: 1,
    check: "bounded-check",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 1,
  }));
}
`);
    await expect(runAdvisory({
      root,
      paths: ["src/app.ts"],
      ...scannerOptions(scanner),
      base: "a".repeat(40),
      head: "b".repeat(40),
      limits: { max_total_findings: 1 },
    })).rejects.toMatchObject({
      code: "finding_count_limit_exceeded",
    } satisfies Partial<WhitehackAdvisoryError>);
  });

  test("scans a rename destination, ignores a deletion, and binds diff to checkout HEAD", async () => {
    const root = await sourceFixture();
    await writeFile(join(root, "src", "removed.ts"), "export const removed = true;\n");
    git(root, ["init", "-q", "-b", "main"]);
    const base = await commitAll(root, "test: base");
    git(root, ["mv", "src/app.ts", "src/renamed.ts"]);
    git(root, ["rm", "-q", "src/removed.ts"]);
    const head = await commitAll(root, "test: rename and delete");

    expect(listChangedPaths(root, base, head)).toEqual(["src/renamed.ts"]);
    expect(() => verifyCheckedOutHead(root, base, head)).not.toThrow();
    expect(() => verifyCheckedOutHead(root, base, base)).toThrow();

    await appendFile(join(root, "src", "renamed.ts"), "// dirty tracked source\n");
    expect(() => verifyCheckedOutHead(root, base, head)).toThrow(/source_not_clean/);
  });

  test("rejects workflow-command and bidi filenames directly from Git diff", async () => {
    const root = await sourceFixture();
    git(root, ["init", "-q", "-b", "main"]);
    const base = await commitAll(root, "test: base");
    await writeFile(join(root, "src", "bad\n::error::.ts"), "export const bad = true;\n");
    await commitAll(root, "test: hostile path");
    const head = git(root, ["rev-parse", "HEAD"]);

    expect(() => listChangedPaths(root, base, head)).toThrow();
  });
});

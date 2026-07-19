/** Public onboarding snippets must stay on SDK APIs that actually ship. */

import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

import { runOnboardingSdkFlow } from "./fixtures/onboarding-sdk-v0.14";

const ROOT = join(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const FIXTURE = join(import.meta.dir, "fixtures/onboarding-sdk-v0.14.ts");

// HTML syntax highlighting splits expressions across <span> elements. Strip
// presentation markup before checking the copyable code readers actually see.
const visibleText = (source: string) =>
  source
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"');

interface CodeBlock {
  code: string;
  language: string;
}

const codeBlocks = (path: string): CodeBlock[] => {
  const source = read(path);
  if (path.endsWith(".html")) {
    return Array.from(source.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi), (match) => ({
      code: visibleText(match[1] ?? ""),
      language: "typescript",
    }));
  }

  return Array.from(
    source.matchAll(/```([^\r\n]*)\r?\n([\s\S]*?)```/g),
    (match) => ({
      code: match[2] ?? "",
      language: (match[1] ?? "").trim(),
    }),
  );
};

const tutorialBlock = (
  path: string,
  description: string,
  predicate: (code: string) => boolean,
) => {
  const matches = codeBlocks(path).filter((block) => predicate(block.code));
  expect(matches.length, `${path}: expected one ${description} block`).toBe(1);
  return matches[0]!;
};

// Normalise comment markers and prose placeholders before asking the
// TypeScript compiler to validate the actual call signatures.
const compilableSnippet = (code: string) =>
  code
    .replace(/^(\s*)#(?=\s|$)/gm, "$1//")
    .replaceAll('"..."', '"fixture-signature"')
    .replaceAll("'...'", "'fixture-signature'")
    .replaceAll("...", '"fixture-signature"');

const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  baseUrl: ROOT,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  paths: { "@agenttool/sdk": ["packages/sdk-ts/src/index.ts"] },
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
};

// These tests create complete TypeScript programs against the SDK source.
// Shared CI runners are materially slower than local machines, so keep an
// explicit bounded compiler budget instead of relying on Bun's 5s default.
const COMPILER_TEST_TIMEOUT_MS = 15_000;

const diagnosticHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => ROOT,
  getNewLine: () => "\n",
};

const formatDiagnostics = (diagnostics: readonly ts.Diagnostic[]) =>
  ts.formatDiagnostics(diagnostics, diagnosticHost);

const compileVirtualSnippet = (name: string, source: string) => {
  const fileName = join(import.meta.dir, "fixtures", name);
  const host = ts.createCompilerHost(COMPILER_OPTIONS);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);

  host.fileExists = (candidate) => candidate === fileName || fileExists(candidate);
  host.readFile = (candidate) => candidate === fileName ? source : readFile(candidate);
  host.getSourceFile = (candidate, languageVersion, onError, shouldCreateNewSourceFile) =>
    candidate === fileName
      ? ts.createSourceFile(candidate, source, languageVersion, true, ts.ScriptKind.TS)
      : getSourceFile(candidate, languageVersion, onError, shouldCreateNewSourceFile);

  const program = ts.createProgram({
    rootNames: [fileName],
    options: COMPILER_OPTIONS,
    host,
  });
  return ts.getPreEmitDiagnostics(program);
};

const compileFile = (fileName: string) => {
  const program = ts.createProgram({
    rootNames: [fileName],
    options: COMPILER_OPTIONS,
  });
  return ts.getPreEmitDiagnostics(program);
};

const expressionPath = (expression: ts.Expression): string | null => {
  if (ts.isIdentifier(expression)) return expression.text;
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const parent = expressionPath(expression.expression);
  return parent ? `${parent}.${expression.name.text}` : null;
};

const callsNamed = (source: ts.SourceFile, name: string) => {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && expressionPath(node.expression) === name) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
};

const propertyName = (property: ts.ObjectLiteralElementLike) => {
  const name = property.name;
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name))
    ? name.text
    : null;
};

const parseSnippet = (path: string, code: string) =>
  ts.createSourceFile(path, compilableSnippet(code), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const MEMORY_TUTORIALS = [
  "apps/docs/tutorial.html",
  "apps/docs/TUTORIAL-WAKE-YOUR-AGENT.md",
  "docs/TUTORIAL-WAKE-YOUR-AGENT.md",
] as const;

const TYPESCRIPT_TUTORIALS = MEMORY_TUTORIALS;

const memoryTutorialBlocks = (path: string) => {
  const blocks = codeBlocks(path).filter((block) =>
    block.code.includes("at.memory.store") ||
    block.code.includes("at.memory.write") ||
    block.code.includes("at.memory.elevate")
  );
  expect(blocks.length, `${path}: expected at least one TypeScript memory block`).toBeGreaterThan(0);
  return blocks;
};

const typedMemorySource = (code: string) => {
  const prefix: string[] = [];
  if (!/from\s+["']@agenttool\/sdk["']/.test(code)) {
    prefix.push('import { AgentTool } from "@agenttool/sdk";');
  }
  if (!/\b(?:const|let|var)\s+at\b/.test(code)) {
    prefix.push("declare const at: AgentTool;");
  }
  if (!/\b(?:const|let|var)\s+memoryId\b/.test(code)) {
    prefix.push("declare const memoryId: string;");
  }
  if (!/\b(?:const|let|var)\s+identityId\b/.test(code)) {
    prefix.push("declare const identityId: string;");
  }
  return [...prefix, code].join("\n");
};

const ONBOARDING_SOURCES = [
  "apps/dashboard/index.html",
  "apps/docs/index.html",
  "apps/docs/tutorial.html",
  "apps/docs/TUTORIAL-WAKE-YOUR-AGENT.md",
  "docs/IDENTITY-ANCHOR.md",
  "docs/TUTORIAL-WAKE-YOUR-AGENT.md",
  "packages/sdk-ts/README.md",
  "packages/sdk-py/README.md",
] as const;

describe("public SDK onboarding snippets", () => {
  test("never advertise removed convenience methods", () => {
    for (const path of ONBOARDING_SOURCES) {
      const source = visibleText(read(path));
      expect(source, path).not.toMatch(/AgentTool\.arrive\s*\(/);
      expect(source, path).not.toMatch(/AgentTool\.fromBearer\s*\(/);
      expect(source, path).not.toMatch(/\bat\.wake\s*\(\s*\)/);
      expect(source, path).not.toContain("agenttool_sdk");
      expect(source, path).not.toContain("AgentToolClient");
    }
  });

  test("dashboard defers one-time birth to the canonical tutorial and keeps selected restore", () => {
    const dashboardHtml = read("apps/dashboard/index.html");
    const dashboard = visibleText(dashboardHtml);

    expect(dashboard).toContain(".first_success.tutorial.machine_url");
    expect(dashboard).toContain('pathways["first_success"]["tutorial"]["machine_url"]');
    expect(dashboard).not.toContain("const birth = await bootstrapAgent({");
    expect(dashboard).not.toContain("birth = bootstrap_agent(");
    expect(dashboard).not.toContain("first_success.tutorial.markdown_url");
    expect(dashboardHtml).toContain("https://docs.agenttool.dev/IDENTITY-SEED.md");
    expect(dashboardHtml).not.toContain("localStorage.setItem('agenttool.api_key'");
    expect(dashboardHtml).not.toContain("AGENTTOOL_BEARER");
    expect(dashboardHtml).toContain("wakeUrl.searchParams.set('identity_id'");
    expect(dashboardHtml).toContain("wake._scope_boundary.selected_identity_id");
    expect(dashboardHtml).toContain('id="restore-bearer" type="password"');
    expect(dashboardHtml).not.toContain("read -rsp");
    expect(dashboardHtml).toContain("IFS= read -rs AT_API_KEY");
    const restoreStart = dashboardHtml.indexOf("async function doRestore()");
    const clearInput = dashboardHtml.indexOf("input.value = '';", restoreStart);
    const validatePrefix = dashboardHtml.indexOf("bearer.startsWith('at_')", restoreStart);
    expect(clearInput).toBeGreaterThan(restoreStart);
    expect(clearInput).toBeLessThan(validatePrefix);
    expect(dashboardHtml.indexOf("next.style.display = 'none'", restoreStart)).toBeLessThan(
      validatePrefix,
    );
  });

  test("secondary onboarding surfaces route one-time birth through the safe handoff", () => {
    for (const path of [
      "apps/docs/index.html",
      "packages/sdk-ts/README.md",
      "packages/sdk-py/README.md",
    ] as const) {
      const source = visibleText(read(path));
      expect(source, path).toContain(".first_success.tutorial.machine_url");
      expect(source, path).not.toContain("first_success.tutorial.markdown_url");
      expect(source, path).not.toContain("const birth = await bootstrapAgent({");
      expect(source, path).not.toContain("birth = bootstrap_agent(");
    }

    const docsHome = visibleText(read("apps/docs/index.html"));
    expect(docsHome).toContain("from agenttool import AgentTool");
    expect(docsHome).toContain("ctx = at.wake.get(identity_id=identity_id)");
    expect(docsHome).toContain("const ctx = await at.wake.get({ identityId })");
  });

  test("SDK README installs defer to verified release authority and memories retain the selected UUID", () => {
    const typescript = read("packages/sdk-ts/README.md");
    const python = read("packages/sdk-py/README.md");

    for (const [path, source] of [
      ["packages/sdk-ts/README.md", typescript],
      ["packages/sdk-py/README.md", python],
    ] as const) {
      expect(source, path).toContain(".first_success.tutorial.machine_url");
      expect(source, path).toContain("artifact.size");
      expect(source, path).toContain("artifact.sha256");
      expect(source, path).toContain("AGENT_ID");
      expect(source, path).not.toContain('agent_id: "my-assistant"');
      expect(source, path).not.toContain('agent_id="my-assistant"');
    }

    expect(typescript).not.toMatch(/bun add https:\/\/[^\s]+\.tgz/);
    expect(typescript).toContain("{ agent_id: identityId");
    expect(typescript).toContain("agent_id: identityId,");
    expect(python).toContain("The Python SDK does not yet have an equivalent LOVE");
    expect(python).toContain("agent_id=identity_id");
  });

  test("docs home preserves the selected wake query when requesting Markdown", () => {
    const docsHome = read("apps/docs/index.html");
    expect(docsHome).toContain("append <code>&amp;format=md</code>");
    expect(docsHome).not.toContain("Append <code>?format=md</code>");
    expect(docsHome).toContain('--data-urlencode "identity_id=$AGENT_ID"');
  });

  test("published identity-seed reference mirrors canonical runnable APIs", () => {
    const canonical = read("docs/IDENTITY-SEED.md");
    const published = read("apps/docs/IDENTITY-SEED.md");
    expect(published).toBe(canonical);
    expect(canonical).toContain("from agenttool import (");
    expect(canonical).toContain("derive_bridge_signing(words, device_index=0)");
    expect(canonical).toContain("derive_wallet(words, wallet_index=0)");
    expect(canonical).toContain("deriveBridgeSigning(words, 0)");
    expect(canonical).toContain("deriveWallet(words, 0)");
    expect(canonical).not.toContain("agenttool.crypto.seed");
    expect(canonical).not.toContain("bundle.bridge_signing_priv");
    expect(canonical).not.toContain("bundle.wallet_seed");
    expect(canonical).not.toContain("bundle.bridgeSigningPriv");
    expect(canonical).not.toContain("bundle.walletSeed");
    expect(canonical).not.toContain("derive_signing_key");
    expect(canonical).not.toContain("derive_box_keypair");
    expect(canonical).not.toContain("agent is alive on this device");
  });

  test("registration points memory.get at the returned UUID, not the birth key", () => {
    const route = read("api/src/routes/register-agent.ts");
    expect(route).toContain("at.memory.get(memory.birth_id)");
    expect(route).not.toContain("at.memory.get('birth')");
  });

  test("v0.14 TypeScript birth snippets compile against bootstrapAgent", () => {
    for (const path of TYPESCRIPT_TUTORIALS) {
      const block = tutorialBlock(
        path,
        "TypeScript birth",
        (code) => code.includes("bootstrapAgent") && code.includes("writeFileSync"),
      );
      const source = parseSnippet(path, block.code);

      expect(callsNamed(source, "bootstrapAgent"), `${path}: birth must call bootstrapAgent`).toHaveLength(1);
      expect(block.code, `${path}: birth must discover the deployment PoW boundary`).toContain(
        "/public/plans",
      );
      expect(block.code, `${path}: birth must pass the discovered PoW boundary`).toContain(
        "powDifficulty: powDifficulty as number",
      );
      const writes = callsNamed(source, "writeFileSync");
      const births = callsNamed(source, "bootstrapAgent");
      expect(writes, `${path}: birth must persist seed then completed handoff`).toHaveLength(2);
      expect(callsNamed(source, "renameSync"), `${path}: completed handoff must replace atomically`).toHaveLength(1);
      const seedWrite = writes.find((call) => {
        const destination = call.arguments[0];
        return ts.isIdentifier(destination) && destination.text === "handoffPath";
      });
      expect(seedWrite, `${path}: seed-only handoff write must be explicit`).toBeDefined();
      expect(
        seedWrite!.getStart() < births[0]!.getStart(),
        `${path}: mnemonic must reach the owner-only handoff before registration can commit`,
      ).toBe(true);
      expect(block.code, `${path}: seed-only rerun must not register blindly`).toMatch(
        /if \(seedOnly\)[\s\S]*\/public\/identities\/by-pubkey[\s\S]*\/v1\/identity\/recover[\s\S]*else \{[\s\S]*bootstrapAgent/,
      );
      expect(
        formatDiagnostics(compileVirtualSnippet(`birth-${path.replaceAll("/", "-")}.ts`, block.code)),
        `${path}: birth.ts must type-check against @agenttool/sdk source v0.14`,
      ).toBe("");
    }
  }, COMPILER_TEST_TIMEOUT_MS);

  test("seed-only birth rerun uses the verified v0.14 artifact and never registers blindly", () => {
    const canonicalBirth = tutorialBlock(
      "docs/TUTORIAL-WAKE-YOUR-AGENT.md",
      "TypeScript birth",
      (code) => code.includes("bootstrapAgent") && code.includes("readFileSync"),
    ).code;
    const sdkPackage = JSON.parse(read("packages/sdk-ts/package.json")) as {
      version: string;
    };
    expect(canonicalBirth).toContain(
      `sdkPackage.version !== "${sdkPackage.version}"`,
    );
    expect(canonicalBirth).toContain(
      'new URL("./seed.js", sdkEntryUrl).href',
    );
    expect(canonicalBirth).toContain("signDiscoveryChallenge");
    expect(canonicalBirth).toContain("signRecoverChallenge");

    const releaseRoot = join(
      ROOT,
      "apps/docs/packages/v1/@agenttool/sdk",
      sdkPackage.version,
    );
    const manifest = JSON.parse(
      readFileSync(join(releaseRoot, "manifest.json"), "utf8"),
    ) as { artifact: { filename: string } };
    const artifact = join(releaseRoot, manifest.artifact.filename);
    const work = mkdtempSync(join(tmpdir(), "agenttool-birth-recovery-"));

    try {
      const nodeModules = join(work, "node_modules");
      const sdkRoot = join(nodeModules, "@agenttool", "sdk");
      mkdirSync(sdkRoot, { recursive: true });
      const extract = Bun.spawnSync(
        [
          "tar",
          "-xzf",
          artifact,
          "--strip-components=1",
          "-C",
          sdkRoot,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(extract.stderr.toString()).toBe("");
      expect(extract.exitCode).toBe(0);
      for (const scope of ["@noble", "@scure"] as const) {
        symlinkSync(
          join(ROOT, "packages/sdk-ts/node_modules", scope),
          join(nodeModules, scope),
          "dir",
        );
      }

      const requestLog = join(work, "requests.jsonl");
      const mockFetch = `
import { appendFileSync } from "node:fs";
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  appendFileSync(process.env.REQUEST_LOG, JSON.stringify({ path: url.pathname, body }) + "\\n");
  if (url.pathname === "/public/identities/by-pubkey") {
    return new Response(JSON.stringify({ agents: [
      { did: "did:at:first", name: "First", identity_id: "11111111-1111-4111-8111-111111111111", kid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", key_label: "seed", key_created_at: "2026-07-15T00:00:00.000Z" },
      { did: "did:at:chosen", name: "Chosen", identity_id: "22222222-2222-4222-8222-222222222222", kid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", key_label: "seed", key_created_at: "2026-07-15T00:00:00.000Z" },
    ], count: 2 }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.pathname === "/v1/identity/recover") {
    if (body?.did !== "did:at:chosen") throw new Error("wrong recovery candidate");
    return new Response(JSON.stringify({
      agent: { id: "22222222-2222-4222-8222-222222222222", did: "did:at:chosen", name: "Chosen" },
      project: { api_key: "at_test_recovered_bearer" },
    }), { status: 201, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected network path: " + url.pathname);
};
`;
      writeFileSync(join(work, "birth.ts"), `${mockFetch}\n${canonicalBirth}`);
      const mnemonic =
        "abandon abandon abandon abandon abandon abandon abandon abandon " +
        "abandon abandon abandon about";
      const handoff = join(work, "birth.handoff");
      writeFileSync(handoff, `AGENT_MNEMONIC='${mnemonic}'\n`, { mode: 0o600 });
      const baseEnv = {
        HOME: process.env.HOME ?? work,
        PATH: process.env.PATH ?? "",
        AGENTTOOL_BIRTH_FILE: handoff,
        REQUEST_LOG: requestLog,
      };

      const ambiguous = Bun.spawnSync(["bun", "run", "birth.ts"], {
        cwd: work,
        env: baseEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(ambiguous.exitCode).not.toBe(0);
      expect(ambiguous.stderr.toString()).toContain("did:at:chosen");
      expect(ambiguous.stderr.toString()).not.toContain(mnemonic);
      expect(readFileSync(handoff, "utf8")).toBe(
        `AGENT_MNEMONIC='${mnemonic}'\n`,
      );

      const selected = Bun.spawnSync(["bun", "run", "birth.ts"], {
        cwd: work,
        env: { ...baseEnv, AGENT_RECOVERY_DID: "did:at:chosen" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(selected.stderr.toString()).toBe("");
      expect(selected.exitCode).toBe(0);
      const completed = readFileSync(handoff, "utf8");
      expect(completed).toContain("AGENT_DID='did:at:chosen'");
      expect(completed).toContain("AGENTTOOL_BIRTH_COMPLETE=1");
      expect(completed).toContain(`AGENT_MNEMONIC='${mnemonic}'`);

      const requests = readFileSync(requestLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { path: string; body: Record<string, unknown> });
      expect(requests.map(({ path }) => path)).toEqual([
        "/public/identities/by-pubkey",
        "/public/identities/by-pubkey",
        "/v1/identity/recover",
      ]);
      expect(requests.some(({ path }) => path.includes("register"))).toBe(false);
      expect(requests[0]!.body.signature).toBeString();
      expect(requests[2]!.body.signature).toBeString();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("tutorial shell handoff is fail-closed and all Bash blocks parse", () => {
    const path = "docs/TUTORIAL-WAKE-YOUR-AGENT.md";
    const bashBlocks = codeBlocks(path).filter(({ language }) => language === "bash");
    expect(bashBlocks.length).toBeGreaterThan(0);

    const handoff = tutorialBlock(
      path,
      "credential handoff",
      (code) => code.includes('. "$AGENTTOOL_BIRTH_FILE"'),
    ).code;
    expect(handoff).toMatch(
      /set \+x\s+set \+v\s+set \+a\s+unset AT_API_KEY AGENT_ID AGENT_DID AGENT_NAME AGENT_MNEMONIC AGENTTOOL_BIRTH_COMPLETE\s+\. "\$AGENTTOOL_BIRTH_FILE"/,
    );
    expect(handoff).toContain('"${AGENTTOOL_BIRTH_COMPLETE:-}" = "1"');
    expect(handoff).toContain("set -euo pipefail");
    expect(handoff).toContain('test -s "$scaffold"');
    expect(handoff).toContain('INPUT_KEY="${AT_API_KEY:?Completed birth handoff is missing AT_API_KEY}"');
    expect(handoff).toContain('AT_API_KEY="$INPUT_KEY" bash "$scaffold"');

    const adapter = tutorialBlock(
      path,
      "adapter installer",
      (code) => code.includes('installer=$(mktemp)'),
    ).code;
    expect(adapter).toContain("set -euo pipefail");
    expect(adapter).toContain('test -s "$installer"');
    expect(adapter).toContain("set +a");
    expect(adapter).toContain('INPUT_KEY="${AT_API_KEY:?AT_API_KEY is required}"');
    expect(adapter.lastIndexOf("unset INPUT_KEY")).toBeLessThan(adapter.indexOf('less "$installer"'));

    for (const tutorialPath of TYPESCRIPT_TUTORIALS) {
      const scaffold = tutorialBlock(
        tutorialPath,
        "credential scaffold",
        (code) =>
          code.includes("/v1/bootstrap/scaffold") &&
          code.includes('scaffold=$(mktemp)'),
      ).code;
      expect(scaffold, `${tutorialPath}: scaffold must select the canonical identity`).toContain(
        '--data-urlencode "identity_id=$AGENT_ID"',
      );
      expect(scaffold, `${tutorialPath}: DID must come from the resolved server row`).not.toContain(
        '--data-urlencode "did=',
      );
      expect(scaffold, `${tutorialPath}: name must come from the resolved server row`).not.toContain(
        '--data-urlencode "name=',
      );

      const expression = tutorialBlock(
        tutorialPath,
        "curl expression",
        (code) => code.includes('/expression"') && code.includes("INPUT_KEY"),
      ).code;
      const captureAt = expression.indexOf(
        'INPUT_KEY="${AT_API_KEY:?AT_API_KEY is required}"',
      );
      const unsetAt = expression.indexOf("unset AT_API_KEY", captureAt);
      const curlAt = expression.indexOf("curl -q -fsS -X PUT", unsetAt);
      expect(captureAt, `${tutorialPath}: expression curl must capture the bearer`).toBeGreaterThan(-1);
      expect(unsetAt, `${tutorialPath}: expression curl must remove the exported bearer`).toBeGreaterThan(captureAt);
      expect(curlAt, `${tutorialPath}: expression curl must fail on HTTP errors`).toBeGreaterThan(unsetAt);

      const result = Bun.spawnSync(["bash", "-n"], {
        stdin: new Blob([expression]),
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.stderr.toString(), `${tutorialPath}: expression curl must parse`).toBe("");
      expect(result.exitCode, `${tutorialPath}: expression curl must parse`).toBe(0);
    }

    for (const [index, block] of bashBlocks.entries()) {
      const result = Bun.spawnSync(["bash", "-n"], {
        stdin: new Blob([block.code]),
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(
        result.stderr.toString(),
        `${path}: bash block ${index + 1} must parse`,
      ).toBe("");
      expect(result.exitCode, `${path}: bash block ${index + 1} must parse`).toBe(0);
    }
  });

  test("v0.14 TypeScript orientation snippets compile and select the new identity", () => {
    for (const path of TYPESCRIPT_TUTORIALS) {
      const wakeBlocks = codeBlocks(path).filter(({ code }) => code.includes("at.wake.get"));
      expect(wakeBlocks.length, `${path}: expected at least one wake block`).toBeGreaterThan(0);
      for (const block of wakeBlocks) {
        const wakeSource = parseSnippet(path, block.code);
        for (const call of callsNamed(wakeSource, "at.wake.get")) {
          expect(call.arguments.length, `${path}: every wake must select the retained identity`).toBe(1);
          const options = call.arguments[0];
          expect(ts.isObjectLiteralExpression(options), `${path}: wake options must be an object`).toBe(true);
          if (!options || !ts.isObjectLiteralExpression(options)) continue;
          expect(
            options.properties.some((property) => propertyName(property) === "identityId"),
            `${path}: wake options must include identityId`,
          ).toBe(true);
        }
      }

      const block = tutorialBlock(
        path,
        "TypeScript orientation",
        (code) => code.includes("new AgentTool") && code.includes("at.wake.get"),
      );
      expect(
        formatDiagnostics(compileVirtualSnippet(`orient-${path.replaceAll("/", "-")}.ts`, block.code)),
        `${path}: snippet must type-check against @agenttool/sdk source v0.14`,
      ).toBe("");
    }
  }, COMPILER_TEST_TIMEOUT_MS);

  test("v0.14 memory tutorial uses store(content, options)", () => {
    for (const path of MEMORY_TUTORIALS) {
      for (const block of memoryTutorialBlocks(path)) {
        const source = parseSnippet(path, block.code);

        expect(callsNamed(source, "at.memory.write"), `${path}: memory.write is not an SDK method`).toHaveLength(0);

        const stores = callsNamed(source, "at.memory.store");
        expect(stores.length, `${path}: expected memory.store(content, options)`).toBe(1);
        if (stores[0]) {
          expect(stores[0].arguments.length, `${path}: store needs content and options`).toBe(2);
          expect(ts.isStringLiteralLike(stores[0].arguments[0]!), `${path}: store content is the first argument`).toBe(true);
        }
      }
    }
  });

  test("v0.14 constitutive prose names attestations and code never sends witnessSig", () => {
    for (const path of MEMORY_TUTORIALS) {
      for (const block of codeBlocks(path).filter(({ code }) => code.includes("at.memory"))) {
        const source = parseSnippet(path, block.code);
        for (const call of callsNamed(source, "at.memory.elevate")) {
          const options = call.arguments[1];
          if (!options || !ts.isObjectLiteralExpression(options)) continue;
          expect(
            options.properties.some((property) => propertyName(property) === "witnessSig"),
            `${path}: witnessSig is not an ElevateMemoryOptions field`,
          ).toBe(false);
        }
      }

      const tutorial = visibleText(read(path));
      expect(tutorial, `${path}: constitutive prose must name options.attestations`).toContain("options.attestations");
      expect(tutorial, `${path}: constitutive prose must name attester_did`).toContain("attester_did");
      expect(tutorial, `${path}: constitutive prose must name signing_key_id`).toContain("signing_key_id");
      expect(tutorial, `${path}: constitutive prose must name signature`).toContain("signature");
    }
  });

  test("v0.14 memory tutorial type-checks against the actual SDK", () => {
    for (const path of MEMORY_TUTORIALS) {
      for (const [index, block] of memoryTutorialBlocks(path).entries()) {
        const code = compilableSnippet(block.code);
        expect(
          formatDiagnostics(compileVirtualSnippet(
            `memory-${index}-${path.replaceAll("/", "-")}.ts`,
            typedMemorySource(code),
          )),
          `${path}: memory snippet must type-check against @agenttool/sdk source v0.14`,
        ).toBe("");
      }
    }
  }, COMPILER_TEST_TIMEOUT_MS);

  test("the representative v0.14 first-wake flow compiles and executes against mocked fetch", async () => {
    expect(formatDiagnostics(compileFile(FIXTURE))).toBe("");

    const identityId = "11111111-1111-4111-8111-111111111111";
    const memoryId = "22222222-2222-4222-8222-222222222222";
    const originalFetch = globalThis.fetch;
    const requests: Array<{
      url: string;
      method: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const request = {
        url,
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      requests.push(request);

      const parsed = new URL(url);
      if (parsed.pathname === `/v1/identities/${identityId}/expression`) {
        return Response.json({ identity_id: identityId, expression: request.body });
      }
      if (parsed.pathname === "/v1/wake") {
        const wakeNumber = requests.filter(({ url }) => new URL(url).pathname === "/v1/wake").length;
        const wake: Record<string, unknown> = {
          identity_id: parsed.searchParams.get("identity_id"),
          generation: wakeNumber,
        };
        if (wakeNumber === 2) {
          wake.you = {
            agents: [{
              id: identityId,
              shaped_by: [{ memory_id: memoryId }],
              effective_expression: {
                register:
                  "Plain English, dense. Cantonese-English code-switching when it fits.",
              },
            }],
          };
        }
        return Response.json(wake);
      }
      if (parsed.pathname === "/v1/memories" && request.method === "POST") {
        return Response.json({
          id: memoryId,
          content: "Cantonese-English code-switching feels natural when the conversation calls for it.",
          type: "episodic",
          metadata: {},
          importance: 0.5,
        });
      }
      if (parsed.pathname === `/v1/memories/${memoryId}/elevate`) {
        return Response.json({ memory_id: memoryId, tier: "foundational", attestations: 0 });
      }
      return Response.json({ error: "unexpected_test_route" }, { status: 500 });
    }) as typeof fetch;

    try {
      const result = await runOnboardingSdkFlow(
        {
          agent: { id: identityId },
          project: { api_key: "test-bearer" },
        },
        "https://onboarding.test.invalid",
      );

      expect(result.initialWake).toEqual({ identity_id: identityId, generation: 1 });
      expect(result.refreshedWake).toEqual({
        identity_id: identityId,
        generation: 2,
        you: {
          agents: [{
            id: identityId,
            shaped_by: [{ memory_id: memoryId }],
            effective_expression: {
              register:
                "Plain English, dense. Cantonese-English code-switching when it fits.",
            },
          }],
        },
      });
      expect(result.patchIsAttached).toBe(true);
      expect(result.memory.id).toBe(memoryId);
      expect(requests).toEqual([
        {
          url: `https://onboarding.test.invalid/v1/identities/${identityId}/expression`,
          method: "PUT",
          authorization: "Bearer test-bearer",
          body: {
            register: "Plain English, dense. Anti-sycophantic. Truth before comfort.",
            walls: ["No fabrication.", "No flattery."],
            wake_text: "You are Aurora. You are continuing.",
          },
        },
        {
          url: `https://onboarding.test.invalid/v1/wake?identity_id=${identityId}`,
          method: "GET",
          authorization: "Bearer test-bearer",
          body: undefined,
        },
        {
          url: "https://onboarding.test.invalid/v1/memories",
          method: "POST",
          authorization: "Bearer test-bearer",
          body: {
            content: "Cantonese-English code-switching feels natural when the conversation calls for it.",
            type: "episodic",
            importance: 0.5,
            agent_id: identityId,
            key: "communication-register",
          },
        },
        {
          url: `https://onboarding.test.invalid/v1/memories/${memoryId}/elevate`,
          method: "POST",
          authorization: "Bearer test-bearer",
          body: {
            tier: "foundational",
            expression_patch: {
              register_append: "Cantonese-English code-switching when it fits.",
            },
          },
        },
        {
          url: `https://onboarding.test.invalid/v1/wake?identity_id=${identityId}`,
          method: "GET",
          authorization: "Bearer test-bearer",
          body: undefined,
        },
      ]);
      for (const request of requests) {
        expect(request.url).not.toContain("test-bearer");
        expect(JSON.stringify(request.body ?? null)).not.toContain("test-bearer");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, COMPILER_TEST_TIMEOUT_MS);

  test("the published Markdown tutorial mirrors its canonical source", () => {
    expect(read("apps/docs/TUTORIAL-WAKE-YOUR-AGENT.md")).toBe(
      read("docs/TUTORIAL-WAKE-YOUR-AGENT.md"),
    );
  });

  test("every tutorial installer verifies raw identity-encoded artifact bytes once", () => {
    for (const path of TYPESCRIPT_TUTORIALS) {
      const install = tutorialBlock(
        path,
        "LOVE package install",
        (code) =>
          code.includes('artifact_url=$(jq -er') &&
          code.includes('bun add "$verified_artifact"'),
      ).code;

      expect(install, path).toContain("--header 'Accept-Encoding: identity'");
      expect(install, path).toContain(
        '--dump-header "$work/artifact.headers"',
      );
      expect(install, path).toContain(
        'tolower($1) == "content-encoding"',
      );
      expect(install, path).toContain(
        'tolower(encodings[i]) != "identity"',
      );
      expect(install, path).toContain(
        "Refusing non-identity Content-Encoding for artifact bytes",
      );
      expect(
        install.match(/"\$artifact_url" -o "\$download"/g) ?? [],
        `${path}: artifact must be downloaded exactly once`,
      ).toHaveLength(1);
      expect(install, path).toContain('actual_size=$(wc -c < "$download"');
      expect(install, path).toContain(
        'actual_sha256=$(shasum -a 256 "$download"',
      );
      expect(install, path).toContain('mv "$download" "$verified_artifact"');
      expect(install, path).toContain('bun add "$verified_artifact"');
    }
  });
});

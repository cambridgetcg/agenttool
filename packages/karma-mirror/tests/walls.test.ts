import { describe, expect, test } from "bun:test";
import {
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

import {
  KARMA_DOOR_PATH,
  KARMA_HEADER,
  verifyReceiptSnapshot,
} from "../src/index.js";
import * as publicApi from "../src/index.js";
import {
  expectDisclosure,
  fixture,
  mirrorRequest,
} from "./helpers.js";

const PACKAGE_ROOT = join(import.meta.dir, "..");
const SOURCE_ROOT = join(PACKAGE_ROOT, "src");

function filesBelow(root: string): string[] {
  const output: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(root, name);
    if (statSync(path).isDirectory()) output.push(...filesBelow(path));
    else output.push(path);
  }
  return output.sort();
}

function sourceText(): string {
  return filesBelow(SOURCE_ROOT)
    .filter((path) => path.endsWith(".ts"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

function sourceFiles(): Array<{ path: string; source: ts.SourceFile }> {
  return filesBelow(SOURCE_ROOT)
    .filter((path) => path.endsWith(".ts"))
    .map((path) => ({
      path,
      source: ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      ),
    }));
}

function expressionPath(expression: ts.Expression): string[] {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    return [...expressionPath(expression.expression), expression.name.text];
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    (ts.isStringLiteral(expression.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
  ) {
    return [...expressionPath(expression.expression), expression.argumentExpression.text];
  }
  return [];
}

describe("source and package walls", () => {
  test("AST permits only relative static imports plus node:crypto and denies capability globals", () => {
    const issues: string[] = [];
    const deniedRoots = new Set([
      "Bun",
      "Deno",
      "process",
      "WebAssembly",
      "WebSocket",
      "Worker",
      "SharedWorker",
      "EventSource",
      "XMLHttpRequest",
    ]);
    const deniedCalls = new Set([
      "eval",
      "fetch",
      "require",
      "setImmediate",
      "setInterval",
      "setTimeout",
    ]);
    const deniedConstructors = new Set([
      "AsyncFunction",
      "EventSource",
      "Function",
      "SharedWorker",
      "WebSocket",
      "Worker",
      "XMLHttpRequest",
    ]);
    const deniedIdentifiers = new Set([
      ...deniedRoots,
      ...deniedCalls,
      ...deniedConstructors,
      "BroadcastChannel",
      "console",
      "document",
      "globalThis",
      "importScripts",
      "module",
      "navigator",
      "RTCPeerConnection",
      "WebTransport",
    ]);

    for (const { path, source } of sourceFiles()) {
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && deniedIdentifiers.has(node.text)) {
          issues.push(`${path}: forbidden capability identifier ${node.text}`);
        }
        if (ts.isImportDeclaration(node)) {
          const specifier = node.moduleSpecifier;
          if (!ts.isStringLiteral(specifier)) {
            issues.push(`${path}: non-literal import`);
          } else if (specifier.text !== "node:crypto" && !specifier.text.startsWith("./")) {
            issues.push(`${path}: forbidden import ${specifier.text}`);
          }
        }
        if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
          const specifier = node.moduleSpecifier;
          if (!ts.isStringLiteral(specifier)) {
            issues.push(`${path}: non-literal re-export`);
          } else if (!specifier.text.startsWith("./")) {
            issues.push(`${path}: forbidden re-export ${specifier.text}`);
          }
        }
        if (ts.isImportEqualsDeclaration(node)) {
          issues.push(`${path}: import-equals is forbidden`);
        }
        if (ts.isCallExpression(node)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            issues.push(`${path}: dynamic import is forbidden`);
          }
          const parts = expressionPath(node.expression);
          const root = parts[0];
          const leaf = parts.at(-1);
          if (root && deniedRoots.has(root)) {
            issues.push(`${path}: forbidden capability root ${parts.join(".")}`);
          }
          if (leaf && deniedCalls.has(leaf)) {
            issues.push(`${path}: forbidden call ${parts.join(".") || leaf}`);
          }
          if (parts[0] === "globalThis" && parts.some((part) =>
            deniedRoots.has(part) || deniedCalls.has(part)
          )) {
            issues.push(`${path}: forbidden global capability ${parts.join(".")}`);
          }
        }
        if (ts.isNewExpression(node)) {
          const parts = expressionPath(node.expression);
          const root = parts[0];
          const leaf = parts.at(-1);
          if (
            (root && deniedRoots.has(root)) ||
            (leaf && deniedConstructors.has(leaf))
          ) {
            issues.push(`${path}: forbidden constructor ${parts.join(".")}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(issues).toEqual([]);
  });

  test("contains no execution, persistence, network, browser, environment, or logging call", () => {
    const source = sourceText();
    const forbidden = [
      /node:(?:child_process|cluster|dgram|dns|fs|http|https|net|os|path|tls|vm|wasi|worker_threads)/,
      /\bfetch\s*\(/,
      /\brequire\s*\(/,
      /\b(?:eval|setTimeout|setInterval|setImmediate)\s*\(/,
      /new\s+(?:Function|WebSocket|Worker|SharedWorker|EventSource)\b/,
      /\bWebAssembly\b/,
      /\bprocess\s*\./,
      /\bBun\s*(?:\.|\[)/,
      /\bDeno\s*(?:\.|\[)/,
      /\bconsole\s*(?:\.|\[)/,
      /\bimport\s*\(/,
      /\.\.\/\.\.\/api\//,
      /\.\.\/\.\.\/packages\//,
    ];
    for (const pattern of forbidden) expect(source).not.toMatch(pattern);
  });

  test("is private, side-effect-free, runtime-dependency-free, and unreleasable", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    expect(manifest.private).toBe(true);
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.bin).toBeUndefined();
    expect(manifest.publishConfig).toBeUndefined();
    expect(manifest.scripts.prepack).toBeUndefined();
    expect(manifest.scripts.publish).toBeUndefined();
    expect(manifest.scripts.postinstall).toBeUndefined();
    expect(manifest.exports["./seed-island-card-schema"]).toBe(
      "./schema/seed-island-card-v1.schema.json",
    );
    expect(JSON.parse(readFileSync(
      join(PACKAGE_ROOT, manifest.exports["./seed-island-card-schema"]),
      "utf8",
    )).title).toBe("Seed Island fixed request-pattern card");
  });

  test("keeps the public runtime surface narrow and explicit", () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "CANARY_DOOR_HEADER",
      "JSON_BODY_READ_TIMEOUT_MS",
      "KARMA_DOOR_PATH",
      "KARMA_EXIT_PATH",
      "KARMA_FRAME_SCHEMA",
      "KARMA_HEADER",
      "KARMA_RECEIPT_SCHEMA",
      "KarmaMirror",
      "MAX_JSON_BODY_BYTES",
      "MAX_JSON_BODY_CHUNKS",
      "MAX_MALWARE_BYTES",
      "MAX_ROOT_CREDENTIALS",
      "SCRAPE_LINKS_PER_PAGE",
      "SCRAPE_PAGE_COUNT",
      "isMarkedMirrorCredential",
      "mintMirrorCredential",
      "verifyReceiptSnapshot",
    ]);
  });

  test("ships no server, migration, route mount, or deployment configuration", () => {
    const relative = filesBelow(PACKAGE_ROOT)
      .map((path) => path.slice(PACKAGE_ROOT.length + 1))
      .filter((path) => !path.startsWith("node_modules/") && !path.startsWith("dist/"));
    for (const path of relative) {
      expect(path).not.toMatch(/(?:^|\/)(?:fly\.toml|Dockerfile|wrangler\.toml|vercel\.json)$/);
      expect(path).not.toMatch(/(?:^|\/)(?:migrations?|routes?|server)\//);
    }
  });

  test("receipt schema is closed and matches the emitted receipt vocabulary", () => {
    const schema = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "schema/karma-mirror-receipt-v1.schema.json"), "utf8"),
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.evidence.additionalProperties).toBe(false);
    expect(schema.properties.schema.const).toBe("agenttool.karma-mirror-receipt/v1");
    expect(schema.required).toContain("event_hash");
    expect(schema.required).toContain("evidence");
  });

  test("source emits no third-party-shaped planted secrets", () => {
    const source = sourceText();
    for (const pattern of [
      /sk_live_[A-Za-z0-9]/,
      /sk-[A-Za-z0-9]{16}/,
      /ghp_[A-Za-z0-9]{16}/,
      /AKIA[A-Z0-9]{16}/,
      /hf_[A-Za-z0-9]{16}/,
      /xox[baprs]-[A-Za-z0-9]/,
    ]) {
      expect(source).not.toMatch(pattern);
    }
  });
});

describe("wire walls", () => {
  test("HEAD carries the Door Back and synthetic headers with no body", async () => {
    const { key, mirror } = fixture();
    const response = await mirror.handle(mirrorRequest("/v1/wake", {
      token: key,
      method: "HEAD",
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get(KARMA_HEADER)).toBe("synthetic; effects=none");
    expect(response.headers.get("x-canary-door")).toBe(KARMA_DOOR_PATH);
    expect(response.headers.get("x-skyseed-commons")).toContain("story-by=yu-and-ai");
    expect(response.headers.get("x-skyseed-commons")).toContain(
      "request-or-artifact-authorship=none",
    );
    expect(await response.text()).toBe("");
  });

  test("every representative success and refusal carries matching disclosure", async () => {
    const { key, mirror } = fixture();
    const requests = [
      mirrorRequest("/"),
      mirrorRequest(KARMA_DOOR_PATH),
      mirrorRequest("/v1/wake", { token: `at_${"Z".repeat(43)}` }),
      mirrorRequest("/v1/unknown", { token: key }),
      mirrorRequest("/v1/scrape", { token: key, method: "POST", body: "{" }),
    ];
    for (const request of requests) {
      await expectDisclosure(await mirror.handle(request));
    }
  });

  test("console hooks may throw without changing handler behavior", async () => {
    const { key, mirror } = fixture();
    const originals = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    const forbidden = () => {
      throw new Error("logging is outside the island");
    };
    console.log = forbidden;
    console.warn = forbidden;
    console.error = forbidden;
    try {
      const response = await mirror.handle(mirrorRequest("/v1/wake", { token: key }));
      expect(response.status).toBe(200);
    } finally {
      console.log = originals.log;
      console.warn = originals.warn;
      console.error = originals.error;
    }
  });

  test("receipt export is a copy and tampering cannot mutate the engine", async () => {
    const { key, mirror } = fixture();
    await mirror.handle(mirrorRequest("/v1/wake", { token: key }));
    const exported = mirror.receiptSnapshot();
    exported.receipts[0]!.evidence.artifact_sha256 = "f".repeat(64);
    expect(verifyReceiptSnapshot(exported)).toBe(false);
    expect(verifyReceiptSnapshot(mirror.receiptSnapshot())).toBe(true);
  });
});

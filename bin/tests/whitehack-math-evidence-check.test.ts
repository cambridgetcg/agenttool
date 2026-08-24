import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  loadVerifiedWhitehackModule,
} from "../whitehack-advisory.mjs";
import {
  MAX_MATH_EVIDENCE_INPUT_BYTES,
  WhitehackMathEvidenceCheckError,
  readMathEvidenceInput,
  verifyMathEvidenceBytes,
} from "../whitehack-math-evidence-check";
import {
  WHITEHACK_0_9_ALL_PROFILE_CANONICAL,
} from "./fixtures/whitehack-evidence-capsule-v1-all-profiles";

const cleanup: string[] = [];
const repoRoot = resolve(import.meta.dir, "../..");
const cliPath = join(repoRoot, "bin", "whitehack-math-evidence-check.ts");

function exactFixtureModule(overrides: Record<string, unknown> = {}) {
  const canonicalizeMathEvidence = (document: unknown) => JSON.stringify(document);
  const encodeMathEvidence = (document: unknown) => new TextEncoder().encode(
    canonicalizeMathEvidence(document),
  );
  return {
    MATH_EVIDENCE_ADDRESS_ALGORITHM: "sha256",
    MATH_EVIDENCE_AXES: [
      "observation",
      "hypothesis",
      "reproduction",
      "impact",
      "provenance",
      "authorization",
    ],
    MATH_EVIDENCE_DOCUMENT_TYPE: "whitehack-math-evidence/v1",
    MATH_EVIDENCE_MEDIA_TYPE: "application/vnd.whitehack.math-evidence.v1+json",
    MAX_MATH_EVIDENCE_BYTES: MAX_MATH_EVIDENCE_INPUT_BYTES,
    addressMathEvidence(document: unknown) {
      return `sha256:${createHash("sha256").update(encodeMathEvidence(document)).digest("hex")}`;
    },
    canonicalizeMathEvidence,
    createMathEvidence(options: unknown) {
      return options;
    },
    encodeMathEvidence,
    parseMathEvidenceBytes(bytes: Uint8Array) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const document = JSON.parse(text);
      if (
        document?.document_type !== "whitehack-math-evidence/v1"
        || JSON.stringify(document) !== text
      ) {
        throw new TypeError("invalid fixture document");
      }
      return document;
    },
    ...overrides,
  };
}

function expectCode(work: () => unknown, code: string): void {
  try {
    work();
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(WhitehackMathEvidenceCheckError);
    expect((error as WhitehackMathEvidenceCheckError).code).toBe(code);
  }
}

async function expectAsyncCode(
  work: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await work();
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(WhitehackMathEvidenceCheckError);
    expect((error as WhitehackMathEvidenceCheckError).code).toBe(code);
  }
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(root);
  return root;
}

function runCli(args: readonly string[], input?: Uint8Array) {
  return spawnSync("bun", [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    timeout: 5_000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      WHITEHACK_INTEGRATION: process.env.WHITEHACK_INTEGRATION,
    },
  });
}

function unknownAxis() {
  return {
    disposition: "unknown",
    claim: null,
    support: [],
    refute: [],
    quantities: [],
    note: null,
  };
}

afterAll(async () => {
  await Promise.all(cleanup.map((path) => rm(path, { recursive: true, force: true })));
});

describe("Whitehack math-evidence check boundary", () => {
  test("returns only the independent address of exact canonical bytes", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      document_type: "whitehack-math-evidence/v1",
      caller_text: "retained but never emitted by the check",
    }));
    const expected = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

    expect(verifyMathEvidenceBytes(bytes, exactFixtureModule())).toBe(expected);
  });

  test("rejects noncanonical bytes, API drift, and address drift", () => {
    const canonical = JSON.stringify({ document_type: "whitehack-math-evidence/v1" });
    expectCode(
      () => verifyMathEvidenceBytes(
        new TextEncoder().encode(`${canonical}\n`),
        exactFixtureModule(),
      ),
      "math_evidence_invalid",
    );
    expectCode(
      () => verifyMathEvidenceBytes(
        new TextEncoder().encode(canonical),
        exactFixtureModule({ unexpectedExport: true }),
      ),
      "whitehack_math_evidence_api_mismatch",
    );
    expectCode(
      () => verifyMathEvidenceBytes(
        new TextEncoder().encode(canonical),
        exactFixtureModule({ addressMathEvidence: () => `sha256:${"0".repeat(64)}` }),
      ),
      "math_evidence_address_mismatch",
    );
    expectCode(
      () => verifyMathEvidenceBytes(
        new TextEncoder().encode(canonical),
        exactFixtureModule({
          parseMathEvidenceBytes: (bytes: Uint8Array) => {
            process.stdout.write("private caller text");
            return JSON.parse(new TextDecoder().decode(bytes));
          },
        }),
      ),
      "math_evidence_runtime_output",
    );
  });

  test("bounds input and refuses final-component symlinks", async () => {
    const root = await temporaryRoot("whitehack-math-check-");
    const oversized = join(root, "oversized.json");
    await writeFile(oversized, new Uint8Array(MAX_MATH_EVIDENCE_INPUT_BYTES + 1));
    await expectAsyncCode(
      () => readMathEvidenceInput(oversized),
      "input_byte_limit_exceeded",
    );

    const target = join(root, "target.json");
    const link = join(root, "link.json");
    await writeFile(target, "{}\n");
    await symlink(target, link);
    await expectAsyncCode(() => readMathEvidenceInput(link), "input_unreadable");
  });

  test("help names the check-only semantic and capability boundaries", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("emits only its sha256:");
    expect(result.stdout).toContain("does not create or translate evidence");
    expect(result.stdout).toContain("KINGDOM/P7 or emotion records");
    expect(result.stdout).toContain("training/reward/ranking/fitness weight");
  });
});

describe.skipIf(process.env.WHITEHACK_INTEGRATION !== "1")(
  "installed Whitehack math-evidence check",
  () => {
    test("accepts exact 0.10 canonical bytes over a preserved 0.9 capsule", async () => {
      const scannerRoot = join(
        repoRoot,
        "tools",
        "whitehack-advisory",
        "node_modules",
        "@agenttool",
        "whitehack-scan",
      );
      const { module } = await loadVerifiedWhitehackModule({
        scanner_root: scannerRoot,
        scanner_lock: join(repoRoot, "tools/whitehack-advisory/package-lock.json"),
        export_name: "math-evidence",
      });
      const document = module.createMathEvidence({
        capsule: JSON.parse(WHITEHACK_0_9_ALL_PROFILE_CANONICAL),
        axes: {
          observation: unknownAxis(),
          hypothesis: unknownAxis(),
          reproduction: unknownAxis(),
          impact: unknownAxis(),
          provenance: unknownAxis(),
          authorization: {
            disposition: "refused",
            claim: null,
            support: [],
            refute: [],
            quantities: [],
            note: null,
          },
        },
      });
      const bytes = module.encodeMathEvidence(document);
      const expectedAddress = module.addressMathEvidence(document);

      const valid = runCli(["--input", "-"], bytes);
      expect(valid.status).toBe(0);
      expect(valid.stderr).toBe("");
      expect(valid.stdout).toBe(`${expectedAddress}\n`);
      expect(valid.stdout).not.toContain("caller-asserted");
      expect(valid.stdout).not.toContain("authorization");

      const noncanonical = runCli([
        "--input",
        "-",
      ], new Uint8Array([...bytes, 0x0a]));
      expect(noncanonical.status).toBe(2);
      expect(noncanonical.stdout).toBe("");
      expect(noncanonical.stderr).toBe(
        "whitehack math evidence check failed: math_evidence_invalid\n",
      );
    });
  },
);

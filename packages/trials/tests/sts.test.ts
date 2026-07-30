import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  STS_OMISSION_REASONS,
  STS_PROJECTION_RECEIPT_SCHEMA,
  projectReportsToSts,
  type MinimizedReport,
  type ProjectReportsToStsInput,
} from "../src/sts.js";

function fixture(name: string): ProjectReportsToStsInput {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/sts/${name}`, import.meta.url),
      "utf8",
    ),
  ) as ProjectReportsToStsInput;
}

function safeReport(
  reportId = "report.synthetic.unit",
): MinimizedReport {
  return {
    report_id: reportId,
    outcome: "The synthetic unit check passed.",
    evidence_refs: ["test:synthetic-unit"],
    confidence: "high",
    limits: "Synthetic local evidence only.",
  };
}

describe("privacy-first Hugging Face STS projection", () => {
  test("emits the official minimal session and assistant-message JSONL shape", () => {
    const input = fixture("safe-selection.json");
    const reordered: ProjectReportsToStsInput = {
      reports: input.reports.map((report) => ({
        limits: report.limits,
        confidence: report.confidence,
        evidence_refs: report.evidence_refs,
        outcome: report.outcome,
        report_id: report.report_id,
      })),
      session_id: input.session_id,
    };

    const first = projectReportsToSts(input);
    const second = projectReportsToSts(reordered);
    expect(first).toEqual(second);
    expect(first.jsonl.endsWith("\n")).toBe(true);

    const lines = first.jsonl.trimEnd().split("\n").map((line) =>
      JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({
      harness: "agenttool-collab",
      id: "selection.synthetic.safe.001",
      type: "session",
    });
    expect(Object.keys(lines[0]!).sort()).toEqual([
      "harness",
      "id",
      "type",
    ]);

    for (const [index, line] of lines.slice(1).entries()) {
      expect(Object.keys(line).sort()).toEqual(["message", "type"]);
      expect(line.type).toBe("message");
      const message = line.message as Record<string, unknown>;
      expect(Object.keys(message).sort()).toEqual(["content", "role"]);
      expect(message.role).toBe("assistant");
      expect(JSON.parse(message.content as string)).toEqual(
        input.reports[index],
      );
    }

    expect(first.jsonl).not.toContain('"timestamp"');
    expect(first.jsonl).not.toContain('"model"');
    expect(first.jsonl).not.toContain('"tool_calls"');
    expect(first.jsonl).not.toContain('"reasoning"');
    expect(first.receipt.schema).toBe(STS_PROJECTION_RECEIPT_SCHEMA);
    expect(first.receipt.input_report_count).toBe(2);
    expect(first.receipt.emitted_report_count).toBe(2);
    expect(first.receipt.omitted_report_count).toBe(0);
    expect(first.receipt.omissions).toEqual([]);
    expect(first.receipt.statement).toContain(
      "cannot prove free-form text or opaque references are secret-free",
    );
    expect(first.receipt.receipt_id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.receipt.selection_digest).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(first.receipt.output_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.receipt)).toBe(true);
    expect(Object.isFrozen(first.receipt.omissions)).toBe(true);
  });

  test("pins the safe fixture output and receipt identities", () => {
    const result = projectReportsToSts(fixture("safe-selection.json"));
    expect(result.receipt.selection_digest).toBe(
      "sha256:7439755c369593faa9bde94558d5b23da232fe0bb8e21af5a1a5a0788bc9946b",
    );
    expect(result.receipt.output_digest).toBe(
      "sha256:177377d0e3de762716075f9a4b19716961e5e6478f80cd8a5f02c44afeca3dcb",
    );
    expect(result.receipt.receipt_id).toBe(
      "sha256:364f3709a6c071a6885175097cbbc30934be49c2290ac0be52ff6b650bf7cae3",
    );
  });

  test("omits unsafe records and returns counts without rejected content", () => {
    const input = fixture("unsafe-selection.json");
    const result = projectReportsToSts(input);
    const receiptText = JSON.stringify(result.receipt);

    expect(result.receipt.input_report_count).toBe(11);
    expect(result.receipt.emitted_report_count).toBe(1);
    expect(result.receipt.omitted_report_count).toBe(10);
    expect(result.receipt.omissions).toEqual([
      { reason: "credential_like_field", count: 1 },
      { reason: "credential_like_value", count: 1 },
      { reason: "duplicate_report_id", count: 1 },
      { reason: "path_field", count: 1 },
      { reason: "path_or_url_value", count: 1 },
      { reason: "raw_tool_output_field", count: 1 },
      { reason: "raw_tool_output_value", count: 1 },
      { reason: "reasoning_field", count: 1 },
      { reason: "reasoning_value", count: 1 },
      { reason: "unsafe_extra_field", count: 1 },
    ]);

    expect(result.jsonl).toContain("report.synthetic.safe");
    for (const rejected of [
      "SENSITIVE_CANARY_VALUE",
      "/Users/example",
      "credential-field",
      "reasoning-field",
      "raw-field",
      "path-field",
      "extra-field",
    ]) {
      expect(result.jsonl).not.toContain(rejected);
      expect(receiptText).not.toContain(rejected);
    }
  });

  test("classifies bounded malformed records without echoing their values", () => {
    const highEntropyCanary = `SENSITIVE_${"A".repeat(64)}`;
    const input = {
      session_id: "selection.synthetic.invalid.001",
      reports: [
        safeReport("report.synthetic.safe"),
        {
          ...safeReport("report.synthetic.too-long"),
          outcome: "x".repeat(1_025),
        },
        {
          ...safeReport("report.synthetic.too-many-evidence"),
          evidence_refs: Array.from(
            { length: 9 },
            (_, index) => `test:synthetic-${index}`,
          ),
        },
        {
          report_id: "report.synthetic.missing-field",
          outcome: "This record is incomplete.",
          evidence_refs: [],
          confidence: "low",
        },
        {
          ...safeReport("report.synthetic.url"),
          evidence_refs: ["https://example.invalid/private"],
        },
        {
          ...safeReport("report.synthetic.high-entropy"),
          outcome: highEntropyCanary,
        },
      ],
    } as ProjectReportsToStsInput;

    const result = projectReportsToSts(input);
    expect(result.receipt.emitted_report_count).toBe(1);
    expect(result.receipt.omissions).toEqual([
      { reason: "bounds_exceeded", count: 2 },
      { reason: "credential_like_value", count: 1 },
      { reason: "invalid_shape", count: 1 },
      { reason: "path_or_url_value", count: 1 },
    ]);
    expect(result.jsonl).not.toContain(highEntropyCanary);
    expect(JSON.stringify(result.receipt)).not.toContain(highEntropyCanary);
  });

  test("never invokes accessors on rejected report fields", () => {
    let invoked = false;
    const unsafeExtra = safeReport(
      "report.synthetic.extra-accessor",
    ) as MinimizedReport & {
      reasoning?: string;
    };
    Object.defineProperty(unsafeExtra, "reasoning", {
      enumerable: true,
      get() {
        invoked = true;
        return "SENSITIVE_CANARY_VALUE";
      },
    });
    const unsafeAllowed = safeReport("report.synthetic.allowed-accessor");
    Object.defineProperty(unsafeAllowed, "outcome", {
      enumerable: true,
      get() {
        invoked = true;
        return "SENSITIVE_CANARY_VALUE";
      },
    });

    const result = projectReportsToSts({
      session_id: "selection.synthetic.accessor.001",
      reports: [unsafeExtra, unsafeAllowed],
    });
    expect(invoked).toBe(false);
    expect(result.receipt.omissions).toEqual([
      { reason: "invalid_shape", count: 1 },
      { reason: "reasoning_field", count: 1 },
    ]);
    expect(result.jsonl).not.toContain("SENSITIVE_CANARY_VALUE");
  });

  test("turns hostile report proxy failures into value-free omissions", () => {
    const sentinel = "SENSITIVE_CANARY_VALUE";
    const hostile = new Proxy(safeReport("report.synthetic.proxy"), {
      getPrototypeOf() {
        throw new Error(sentinel);
      },
    });
    const result = projectReportsToSts({
      session_id: "selection.synthetic.proxy.001",
      reports: [hostile],
    });
    expect(result.receipt.omissions).toEqual([
      { reason: "invalid_shape", count: 1 },
    ]);
    expect(result.jsonl).not.toContain(sentinel);
    expect(JSON.stringify(result.receipt)).not.toContain(sentinel);
  });

  test("does not emit or hash rejected secret-bearing values", () => {
    const inputWith = (secret: string): ProjectReportsToStsInput => ({
      session_id: "selection.synthetic.secret-invariance.001",
      reports: [
        {
          ...safeReport("report.synthetic.rejected-secret"),
          outcome: `Bearer ${secret}`,
        },
      ],
    });
    const first = projectReportsToSts(
      inputWith("SENSITIVE_CANARY_ALPHA"),
    );
    const second = projectReportsToSts(
      inputWith("SENSITIVE_CANARY_BETA"),
    );

    expect(first).toEqual(second);
    expect(first.receipt.omissions).toEqual([
      { reason: "credential_like_value", count: 1 },
    ]);
    for (const canary of [
      "SENSITIVE_CANARY_ALPHA",
      "SENSITIVE_CANARY_BETA",
    ]) {
      expect(first.jsonl).not.toContain(canary);
      expect(JSON.stringify(first.receipt)).not.toContain(canary);
    }
  });

  test("rejects unsafe selection shape and oversized selection sanitarily", () => {
    const sentinel = "SENSITIVE_CANARY_VALUE";
    let shapeMessage = "";
    try {
      projectReportsToSts({
        ...fixture("safe-selection.json"),
        authorization: sentinel,
      } as ProjectReportsToStsInput);
    } catch (error) {
      shapeMessage = error instanceof Error ? error.message : String(error);
    }
    expect(shapeMessage).toContain("only session_id and reports");
    expect(shapeMessage).not.toContain(sentinel);

    expect(() =>
      projectReportsToSts({
        session_id: "selection.synthetic.oversized.001",
        reports: Array.from(
          { length: 33 },
          (_, index) => safeReport(`report.synthetic.${index}`),
        ),
      })).toThrow("at most 32");
    expect(() =>
      projectReportsToSts({
        session_id: "/Users/example/private",
        reports: [],
      })).toThrow("safe opaque identifier");
  });

  test("omits generic URI schemes and common absolute path roots", () => {
    const unsafeOutcomes = [
      "The synthetic value was s3://bucket/private-object.",
      "The synthetic value was custom+agent://authority/private.",
      "The synthetic value was x://authority/private.",
      "The synthetic value was /etc/passwd.",
      "The synthetic value was /opt/agent/state.",
      "The synthetic value was /root/private.",
      "The synthetic value was /srv/agent/data.",
      "The synthetic value was /arbitrary/rooted/path.",
    ];
    const result = projectReportsToSts({
      session_id: "selection.synthetic.paths.001",
      reports: unsafeOutcomes.map((outcome, index) => ({
        ...safeReport(`report.synthetic.path-${index}`),
        outcome,
      })),
    });
    expect(result.receipt.emitted_report_count).toBe(0);
    expect(result.receipt.omissions).toEqual([
      { reason: "path_or_url_value", count: unsafeOutcomes.length },
    ]);
    for (const outcome of unsafeOutcomes) {
      expect(result.jsonl).not.toContain(outcome);
    }
  });

  test("has no ambient filesystem, environment, network, or HF client seam", () => {
    const source = readFileSync(
      new URL("../src/sts.ts", import.meta.url),
      "utf8",
    );
    const imports = [...source.matchAll(/^import[\s\S]*?from "([^"]+)";$/gmu)]
      .map((match) => match[1]);
    expect(imports).toEqual(["./canonical.js", "./errors.js"]);
    expect(source).not.toContain("node:fs");
    expect(source).not.toContain("process.env");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toContain("@huggingface");
    expect(STS_OMISSION_REASONS).toEqual(
      [...STS_OMISSION_REASONS].sort(),
    );
  });
});

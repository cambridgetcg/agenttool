import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  CASTLE_WHITEHACK_INTAKE_DOCUMENT,
  CASTLE_WHITEHACK_INTAKE_VERSION,
  CastleWhitehackIntakeError,
  createCastleWhitehackIntake,
} from "../_castle-whitehack-intake";

const cleanup: string[] = [];
const repoRoot = resolve(import.meta.dir, "../..");
const cliPath = join(repoRoot, "bin", "agenttool-castle-whitehack-intake.ts");
const privateMarker = "private-marker-that-must-not-cross";

function limits() {
  return {
    max_changed_paths: 2000,
    max_path_bytes: 1024,
    max_diff_bytes: 262144,
    max_files: 200,
    max_file_bytes: 524288,
    max_total_bytes: 8388608,
    max_total_findings: 5000,
    max_reported_findings: 200,
  };
}

function finding(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    file: `src/${privateMarker}.ts`,
    line: 7,
    check: "unsafe-eval",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
    ...overrides,
  };
}

function advisory(): Record<string, any> {
  return {
    document_type: "agenttool-whitehack-advisory/v0.1",
    generated_at: "2026-07-24T12:34:56.789Z",
    status: "complete",
    scanner: {
      repository: "https://github.com/cambridgetcg/whitehack",
      revision: "a".repeat(40),
      version: "0.8.1",
    },
    scope: {
      mode: "changed_supported_regular_files",
      base_revision: "b".repeat(40),
      head_revision: "c".repeat(40),
      changed_path_count: 3,
      changed_path_bytes: 84,
      candidate_count: 2,
      candidate_bytes: 2048,
      skipped: {
        hidden_path: 1,
      },
      limits: limits(),
    },
    summary: {
      finding_count: 4,
      by_check: {
        "hardcoded-secret": 1,
        "silent-failure": 1,
        "unsafe-eval": 2,
      },
      by_confidence: {
        heuristic: 1,
        high: 1,
        "medium-high": 2,
      },
    },
    findings: [
      finding(),
      finding(),
      finding({
        check: "hardcoded-secret",
        confidence: "high",
        doctrine: "security-awareness",
        principle: 1,
      }),
      finding({
        file: "src/other.ts",
        line: 2,
        check: "silent-failure",
        confidence: "heuristic",
      }),
    ],
    finding_details_truncated: false,
    errors: [],
    boundaries: [
      "heuristic_findings_are_not_security_proof",
      "absence_of_findings_is_not_proof_of_honesty",
      "only_changed_supported_regular_non_test_files_are_observed",
      "source_snippets_messages_and_exception_text_are_not_serialized",
      "pinned_scanner_runs_with_the_callers_local_file_permissions",
      "no_dynamic_testing_target_interaction_or_submission",
      "a_finding_does_not_establish_target_authorization",
    ],
  };
}

function emptyAdvisory(): Record<string, any> {
  const value = advisory();
  value.scope.changed_path_count = 0;
  value.scope.changed_path_bytes = 0;
  value.scope.candidate_count = 0;
  value.scope.candidate_bytes = 0;
  value.scope.skipped = {};
  value.summary = {
    finding_count: 0,
    by_check: {},
    by_confidence: {},
  };
  value.findings = [];
  return value;
}

function expectCode(work: () => unknown, code: string): void {
  try {
    work();
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(CastleWhitehackIntakeError);
    expect((error as CastleWhitehackIntakeError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(root);
  return root;
}

function runCli(
  args: readonly string[],
  options: { cwd?: string; input?: string; timeout?: number } = {},
) {
  return spawnSync("bun", [cliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    },
  });
}

function assertDeepFrozen(value: unknown): void {
  if (!value || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

afterAll(async () => {
  await Promise.all(
    cleanup.map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("agenttool-castle-whitehack-intake/v1 core", () => {
  test("offers deterministic grouped gate candidates without leaking locations", () => {
    const input = advisory();
    const first = createCastleWhitehackIntake(input);
    const reordered = structuredClone(input);
    reordered.findings.reverse();
    reordered.boundaries.reverse();
    const second = createCastleWhitehackIntake(reordered);

    expect(first).toEqual(second);
    expect(first.document_type).toBe(CASTLE_WHITEHACK_INTAKE_DOCUMENT);
    expect(first.projection_status).toBe("complete");
    expect(first.intake).toEqual({
      mode: "offer-only",
      destination: "castle-gate",
      audience: "local-private",
      accepted: false,
      writes_castle: false,
    });
    expect(first.candidates).toHaveLength(2);
    expect(first.source.scope.candidate_file_count).toBe(2);
    const groupedCandidate = first.candidates.find((candidate) =>
      candidate.signals.some((signal) => signal.check === "unsafe-eval")
    );
    expect(groupedCandidate).toBeDefined();
    expect(groupedCandidate!.location).toMatchObject({
      disclosure: "omitted",
      file: null,
      line: null,
      sensitivity: "unknown",
    });
    expect(groupedCandidate!.signals).toEqual([
      {
        check: "hardcoded-secret",
        scanner_confidence: "high",
        doctrine: "security-awareness",
        principle: 1,
        occurrence_count: 1,
      },
      {
        check: "unsafe-eval",
        scanner_confidence: "medium-high",
        doctrine: "substrate-honesty",
        principle: 2,
        occurrence_count: 2,
      },
    ]);
    expect(groupedCandidate!.castle_confidence).toBe("unset");
    expect(groupedCandidate!.verification).toBe("not-run");
    expect(groupedCandidate!.change_relation).toBe("not-evaluated");
    expect(groupedCandidate!.review_question).toBe(
      "Which trust boundary or invariant should a reviewer inspect? "
        + "What authorized local evidence would support or reject the observation, "
        + "and which regression test records the intended behaviour?",
    );
    expect(JSON.stringify(first)).not.toContain(privateMarker);
    expect(JSON.stringify(first)).not.toContain("src/other.ts");
    expect(first.redaction.hashes_are_confidentiality_proof).toBe(false);
    expect(first.source.scope.finding_count).toBe(4);
    expect(first.source.scope.serialized_finding_count).toBe(4);
    expect(first.source.scope.skipped).toEqual({
      hidden_path: 1,
      non_production_path: 0,
      non_regular_file: 0,
      unsupported_extension: 0,
    });
    expect(first.boundaries.transitions.gate_to_stone).toBe(
      "requires-explicit-capture",
    );
    expect(first.boundaries.transitions.tested_to_keep).toBe(
      "requires-surviving-trial",
    );
    expect(first.boundaries.cli_capabilities).toMatchObject({
      explicit_input_read: true,
      stdout: true,
      filesystem_write: false,
      castle_write: false,
      process_spawn: false,
      network: false,
    });
    expect("direct_capabilities" in first.boundaries).toBe(false);
    assertDeepFrozen(first);
  });

  test("retains locations only under the explicit option without changing identity", () => {
    const hidden = createCastleWhitehackIntake(advisory());
    const included = createCastleWhitehackIntake(advisory(), {
      include_locations: true,
    });

    expect(included.redaction.location_disclosure).toBe("included");
    const includedCandidate = included.candidates.find((candidate) =>
      candidate.location.file === `src/${privateMarker}.ts`
    );
    expect(includedCandidate).toBeDefined();
    expect(includedCandidate!.location).toMatchObject({
      disclosure: "included",
      file: `src/${privateMarker}.ts`,
      line: 7,
      sensitivity: "unknown",
    });
    const hiddenCandidate = hidden.candidates.find((candidate) =>
      candidate.location.reference === includedCandidate!.location.reference
    );
    expect(hiddenCandidate).toBeDefined();
    expect(includedCandidate!.id).toBe(hiddenCandidate!.id);
  });

  test("keeps medium scanner confidence separate from Castle confidence", () => {
    const input = advisory();
    input.summary.by_confidence = {
      heuristic: 1,
      high: 1,
      medium: 1,
      "medium-high": 1,
    };
    input.findings[1].confidence = "medium";

    const output = createCastleWhitehackIntake(input, {
      include_locations: true,
    });
    const candidate = output.candidates.find((value) =>
      value.location.file === `src/${privateMarker}.ts`
    );
    expect(candidate).toBeDefined();
    expect(candidate!.signals).toContainEqual({
      check: "unsafe-eval",
      scanner_confidence: "medium",
      doctrine: "substrate-honesty",
      principle: 2,
      occurrence_count: 1,
    });
    expect(candidate!.signals).toContainEqual({
      check: "unsafe-eval",
      scanner_confidence: "medium-high",
      doctrine: "substrate-honesty",
      principle: 2,
      occurrence_count: 1,
    });
    expect(candidate!.castle_confidence).toBe("unset");
  });

  test("represents zero findings as zero offers rather than a security claim", () => {
    const output = createCastleWhitehackIntake(emptyAdvisory());
    expect(output.candidates).toEqual([]);
    expect(output.source.scope.finding_count).toBe(0);
    expect(output.unknowns.coverage).toContain("not established secure");
    expect(JSON.stringify(output)).not.toMatch(/"safe"|"clean"|"verified"/u);
  });

  test("preserves incomplete and truncated source states", () => {
    const incomplete = emptyAdvisory();
    incomplete.status = "incomplete";
    incomplete.scope.changed_path_count = 1;
    incomplete.scope.candidate_count = 1;
    incomplete.scope.candidate_bytes = 100;
    incomplete.errors = [{
      file: `src/${privateMarker}.ts`,
      code: "scanner_file_incomplete",
    }];
    const incompleteOutput = createCastleWhitehackIntake(incomplete);
    expect(incompleteOutput.source.advisory_status).toBe("incomplete");
    expect(incompleteOutput.source.scope.error_count).toBe(1);
    expect(incompleteOutput.source.scope.errors_by_code).toEqual({
      scanner_file_incomplete: 1,
    });
    expect(JSON.stringify(incompleteOutput)).not.toContain(privateMarker);

    const truncated = emptyAdvisory();
    truncated.scope.changed_path_count = 1;
    truncated.scope.candidate_count = 1;
    truncated.scope.candidate_bytes = 1000;
    truncated.summary.finding_count = 201;
    truncated.summary.by_check = { "unsafe-eval": 201 };
    truncated.summary.by_confidence = { heuristic: 201 };
    truncated.findings = Array.from(
      { length: 200 },
      () => finding({ confidence: "heuristic" }),
    );
    truncated.finding_details_truncated = true;
    const truncatedOutput = createCastleWhitehackIntake(truncated);
    expect(truncatedOutput.source.scope.finding_count).toBe(201);
    expect(truncatedOutput.source.scope.serialized_finding_count).toBe(200);
    expect(truncatedOutput.source.scope.finding_details_truncated).toBe(true);
    expect(truncatedOutput.candidates[0].signals[0].occurrence_count).toBe(200);
  });

  test("rejects schema drift and cross-field contradictions with stable codes", () => {
    const extra = advisory();
    extra.findings[0].snippet = privateMarker;
    expectCode(
      () => createCastleWhitehackIntake(extra),
      "advisory_finding_invalid",
    );

    const summaryMismatch = advisory();
    summaryMismatch.summary.finding_count = 3;
    expectCode(
      () => createCastleWhitehackIntake(summaryMismatch),
      "advisory_summary_mismatch",
    );

    const statusMismatch = advisory();
    statusMismatch.status = "incomplete";
    expectCode(
      () => createCastleWhitehackIntake(statusMismatch),
      "advisory_status_mismatch",
    );

    const scopeMismatch = advisory();
    scopeMismatch.scope.changed_path_count = 99;
    expectCode(
      () => createCastleWhitehackIntake(scopeMismatch),
      "advisory_scope_mismatch",
    );

    const future = advisory();
    future.document_type = "agenttool-whitehack-advisory/v0.2";
    expectCode(
      () => createCastleWhitehackIntake(future),
      "advisory_document_type_invalid",
    );

    const impossibleDate = advisory();
    impossibleDate.generated_at = "2026-02-30T12:34:56.789Z";
    expectCode(
      () => createCastleWhitehackIntake(impossibleDate),
      "advisory_generated_at_invalid",
    );
  });

  test("rejects accessors, sparse arrays, custom prototypes, and trapping or revoked proxies", () => {
    let getterRan = false;
    const accessor = advisory();
    Object.defineProperty(accessor, "summary", {
      enumerable: true,
      get() {
        getterRan = true;
        return {};
      },
    });
    expectCode(
      () => createCastleWhitehackIntake(accessor),
      "advisory_invalid",
    );
    expect(getterRan).toBe(false);

    const sparse = advisory();
    sparse.findings = new Array(2);
    expectCode(
      () => createCastleWhitehackIntake(sparse),
      "advisory_findings_invalid",
    );

    const custom = advisory();
    custom.summary = Object.assign(Object.create({ inherited: true }), {
      finding_count: 4,
      by_check: advisory().summary.by_check,
      by_confidence: advisory().summary.by_confidence,
    });
    expectCode(
      () => createCastleWhitehackIntake(custom),
      "advisory_summary_invalid",
    );

    const markerProxy = new Proxy(advisory(), {
      getPrototypeOf() {
        throw new Error(privateMarker);
      },
    });
    expectCode(
      () => createCastleWhitehackIntake(markerProxy),
      "advisory_invalid",
    );

    const revokedObject = Proxy.revocable(advisory(), {});
    revokedObject.revoke();
    expectCode(
      () => createCastleWhitehackIntake(revokedObject.proxy),
      "advisory_invalid",
    );

    const revokedArrayInput = advisory();
    const revokedArray = Proxy.revocable(revokedArrayInput.findings, {});
    revokedArray.revoke();
    revokedArrayInput.findings = revokedArray.proxy;
    expectCode(
      () => createCastleWhitehackIntake(revokedArrayInput),
      "advisory_findings_invalid",
    );
  });

  test("copies input and returns recursively frozen plain JSON", () => {
    const input = advisory();
    const output = createCastleWhitehackIntake(input, {
      include_locations: true,
    });
    input.findings[0].file = "src/mutated.ts";
    input.scanner.version = "9.9.9";
    expect(output.candidates.some(
      (candidate) =>
        candidate.location.file === `src/${privateMarker}.ts`,
    )).toBe(true);
    expect(output.candidates.some(
      (candidate) => candidate.location.file === "src/mutated.ts",
    )).toBe(false);
    expect(output.source.scanner.version).toBe("0.8.1");
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
    assertDeepFrozen(output);
  });

  test("the pure core has no Castle, process, filesystem, network, or clock seam", async () => {
    const source = await readFile(
      join(repoRoot, "bin", "_castle-whitehack-intake.ts"),
      "utf8",
    );
    expect(source).toContain('from "node:crypto"');
    expect(source).not.toMatch(
      /from\s+["']node:(?:fs|fs\/promises|child_process|http|https|net|dns|tls|dgram|worker_threads)["']/u,
    );
    expect(source).not.toContain("agenttool-castle.ts");
    expect(source).not.toMatch(
      /\b(?:fetch|WebSocket|EventSource|Bun\.spawn|Deno|Date\.now|Math\.random|randomUUID|eval|Function)\s*\(/u,
    );
    expect(source).not.toMatch(/\bprocess\./u);
  });

  test("the public Whitehack page exposes the fifth boundary without inventing a hosted route", async () => {
    const page = await readFile(
      join(repoRoot, "apps", "docs", "whitehack.html"),
      "utf8",
    );
    expect(page).toContain("five separate practices");
    expect(page).not.toContain("four separate practices");
    expect(page).toContain("agenttool-castle-whitehack-intake/v1");
    expect(page).toContain("bin/agenttool-castle-whitehack-intake.ts");
    expect(page).toContain(
      "does not create a hosted intake route or release a new",
    );
  });
});

describe("agenttool-castle-whitehack-intake CLI", () => {
  test("reports help/version and emits one JSON document without writing", async () => {
    const help = runCli(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("--include-locations");
    expect(help.stdout).toContain("does not write a Castle");

    const version = runCli(["--version"]);
    expect(version.status).toBe(0);
    expect(version.stderr).toBe("");
    expect(version.stdout).toBe(`${CASTLE_WHITEHACK_INTAKE_VERSION}\n`);

    const root = await temporaryRoot("whitehack-castle-cli-");
    const inputPath = join(root, "advisory.json");
    await writeFile(inputPath, `${JSON.stringify(advisory())}\n`);
    await chmod(inputPath, 0o400);
    const before = await readdir(root);
    const result = runCli(["--input", inputPath], { cwd: root });
    const after = await readdir(root);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(JSON.parse(result.stdout).document_type).toBe(
      CASTLE_WHITEHACK_INTAKE_DOCUMENT,
    );
    expect(result.stdout).not.toContain(privateMarker);
    expect(after).toEqual(before);
  });

  test("accepts bounded stdin and makes location disclosure explicit", () => {
    const result = runCli(
      ["--input", "-", "--include-locations"],
      { input: JSON.stringify(advisory()) },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout);
    expect(output.redaction.location_disclosure).toBe("included");
    expect(output.candidates.some(
      (candidate: { location: { file: string | null } }) =>
        candidate.location.file === `src/${privateMarker}.ts`,
    )).toBe(true);
  });

  test("fails closed on duplicate JSON keys, symlinks, and invalid arguments", async () => {
    const duplicate = runCli(
      ["--input", "-"],
      {
        input:
          '{"document_type":"agenttool-whitehack-advisory/v0.1",'
          + '"document_type":"agenttool-whitehack-advisory/v0.1"}',
      },
    );
    expect(duplicate.status).toBe(2);
    expect(duplicate.stdout).toBe("");
    expect(duplicate.stderr).toBe(
      "agenttool castle whitehack intake failed: input_duplicate_json_key\n",
    );

    const invalid = runCli(["--input", "one", "--input", "two"]);
    expect(invalid.status).toBe(2);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toBe(
      "agenttool castle whitehack intake failed: duplicate_argument\n",
    );

    const root = await temporaryRoot("whitehack-castle-symlink-");
    const target = join(root, "target.json");
    const link = join(root, "link.json");
    await writeFile(target, JSON.stringify(advisory()));
    await symlink(target, link);
    const linked = runCli(["--input", link]);
    expect(linked.status).toBe(2);
    expect(linked.stdout).toBe("");
    expect(linked.stderr).toBe(
      "agenttool castle whitehack intake failed: input_unreadable\n",
    );

    const fifo = join(root, "input.fifo");
    const madeFifo = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    expect(madeFifo.status).toBe(0);
    const piped = runCli(["--input", fifo], { timeout: 2_000 });
    expect(piped.error).toBeUndefined();
    expect(piped.status).toBe(2);
    expect(piped.stdout).toBe("");
    expect(piped.stderr).toBe(
      "agenttool castle whitehack intake failed: input_not_regular_file\n",
    );
  });
});

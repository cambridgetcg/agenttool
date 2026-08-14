import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  parseConstraintText,
  solveCommonGround,
} from "../../../apps/docs/xenia-helly.js";
import { INPUT_DIGEST_DOMAIN } from "../src/constants.mjs";
import { canonicalJson, domainDigest } from "../src/core.mjs";
import { buildRows } from "../src/fixtures.mjs";
import { buildProvenance } from "../src/provenance.mjs";
import { schemas } from "../src/schemas.mjs";
import { verifyRows } from "../src/exact-verifier.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = resolve(packageRoot, "../..");
const datasetRoot = resolve(packageRoot, "hf/dataset");
const { provenanceRef } = buildProvenance(repoRoot);

function read(path) {
  return readFileSync(resolve(datasetRoot, path));
}

function readJsonl(path) {
  return read(path).toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
}

function walk(root, relative = "") {
  const current = resolve(root, relative || ".");
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(root, child) : [child];
  });
}

function treeDigest() {
  const hash = createHash("sha256");
  for (const path of walk(datasetRoot).sort()) {
    hash.update(path).update("\0").update(read(path));
  }
  return hash.digest("hex");
}

function readCheckoutJson(checkout, path) {
  return JSON.parse(readFileSync(resolve(checkout, path), "utf8"));
}

function refreshCheckoutManifests(checkout) {
  const configs = [
    ["exact_geometry", "reference", "data/exact-geometry.jsonl"],
    ["wake_continuity", "reference", "data/wake-continuity.jsonl"],
    ["analogy_audit", "public_regression", "data/analogy-audit.jsonl"],
  ];
  const rowManifest = readCheckoutJson(checkout, "provenance/row-manifest.json");
  rowManifest.entries = configs.flatMap(([config, split, path]) => {
    const lines = readFileSync(resolve(checkout, path), "utf8").trimEnd().split("\n");
    return lines.map((line, index) => ({
      config,
      split,
      path,
      line: index + 1,
      case_id: JSON.parse(line).case_id,
      row_sha256: createHash("sha256").update(`${line}\n`).digest("hex"),
    }));
  });
  rowManifest.row_count = rowManifest.entries.length;
  writeFileSync(
    resolve(checkout, "provenance/row-manifest.json"),
    `${JSON.stringify(rowManifest, null, 2)}\n`,
  );

  const hashManifest = readCheckoutJson(checkout, "hash-manifest.json");
  hashManifest.files = hashManifest.files.map(({ path }) => {
    const bytes = readFileSync(resolve(checkout, path));
    return {
      path,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  writeFileSync(resolve(checkout, "hash-manifest.json"), `${JSON.stringify(hashManifest, null, 2)}\n`);
}

function writeCheckoutRows(checkout, path, rows) {
  writeFileSync(resolve(checkout, path), `${rows.map(canonicalJson).join("\n")}\n`);
}

function expectRejected(mutator) {
  const rows = buildRows(provenanceRef);
  mutator(rows);
  expect(() => verifyRows(rows, provenanceRef)).toThrow();
}

test("ships exactly three reference-only configs and nineteen synthetic rows", () => {
  const card = read("README.md").toString("utf8");
  expect(card).toContain("# AgentTool Xenia–Helly Common Ground Atlas");
  expect(card).toContain("config_name: exact_geometry");
  expect(card).toContain("config_name: wake_continuity");
  expect(card).toContain("config_name: analogy_audit");
  expect(card).toContain("Yu-and-Ai/agenttool-common-ground");
  const rows = [
    ...readJsonl("data/exact-geometry.jsonl"),
    ...readJsonl("data/wake-continuity.jsonl"),
    ...readJsonl("data/analogy-audit.jsonl"),
  ];
  expect(rows).toHaveLength(19);
  expect(rows.every((row) => row.training_eligible === false)).toBe(true);
  expect(rows.every((row) => row.synthetic === true)).toBe(true);
  expect(rows.every((row) => Object.values(row.does_not_establish).every(Boolean))).toBe(true);
  expect(new Set(rows.map(({ case_id: id }) => id)).size).toBe(19);
});

test("all three schemas reject open nested objects", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const rows = buildRows(provenanceRef);
  for (const [schema, values] of [
    [schemas.geometry, rows.geometry],
    [schemas.wake, rows.wake],
    [schemas.analogy, rows.analogy],
  ]) {
    const validate = ajv.compile(schema);
    for (const row of values) expect(validate(row), JSON.stringify(validate.errors)).toBe(true);
    const opened = structuredClone(values[0]);
    opened.public_safety.unbound = false;
    expect(validate(opened)).toBe(false);
  }
});

test("fresh generation check is byte-idempotent and non-writing", () => {
  const before = treeDigest();
  execFileSync("node", [resolve(packageRoot, "scripts/generate-dataset.mjs"), "--check"], {
    cwd: packageRoot,
    stdio: "pipe",
  });
  expect(treeDigest()).toBe(before);
  expect(walk(resolve(packageRoot, "hf")).some((path) => path.includes(".dataset-stage-"))).toBe(false);
});

test("public verifier supports exact Hub and local checkout metadata only", () => {
  const scratch = mkdtempSync(resolve(tmpdir(), "agenttool-common-ground-atlas-"));
  const checkout = resolve(scratch, "dataset");
  try {
    cpSync(datasetRoot, checkout, { recursive: true });
    writeFileSync(resolve(checkout, ".gitattributes"), "*.jsonl filter=lfs diff=lfs merge=lfs -text\n");
    mkdirSync(resolve(checkout, ".git"));
    writeFileSync(resolve(checkout, ".git/HEAD"), "ref: refs/heads/main\n");
    mkdirSync(resolve(checkout, ".cache/huggingface"), { recursive: true });
    writeFileSync(resolve(checkout, ".cache/huggingface/download.json"), "{}\n");
    execFileSync("python3", ["-I", resolve(checkout, "verification/verify.py"), checkout], {
      stdio: "pipe",
    });

    writeFileSync(resolve(checkout, "unexpected-public-payload.txt"), "not manifest-bound\n");
    expect(() => execFileSync(
      "python3",
      ["-I", resolve(checkout, "verification/verify.py"), checkout],
      { stdio: "pipe" },
    )).toThrow();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("public verifier rejects consistently rehashed semantic contradictions", () => {
  const attacks = [
    ["geometry theorem label", ({ geometry }) => {
      geometry[0].expected.theorem_status = "infeasible";
    }],
    ["geometry reason label", ({ geometry }) => {
      geometry[0].expected.reason_code = "minimal_conflict";
    }],
    ["underflow literal binding", ({ geometry }) => {
      const row = geometry[5];
      row.input.constraints[0].c.exact = { numerator: "1", denominator: "3" };
      row.input.constraints[1].c.exact = { numerator: "-1", denominator: "3" };
      row.expected.certificate.input_sha256 = domainDigest(INPUT_DIGEST_DOMAIN, row.input);
    }],
    ["future WAKE observation", ({ wake }) => {
      wake[0].evidence.observed_at = "2031-01-01T00:00:00Z";
    }],
    ["false one-sided limit", ({ analogy }) => {
      analogy[2].evidence.time_family.left_limit = { numerator: "-2", denominator: "1" };
    }],
    ["analogy label shuffle", ({ analogy }) => {
      analogy[0].missing_layer = "normative_choice_rule";
      analogy[0].reason_code = "multiple_feasible_points_no_selection_rule";
    }],
  ];

  for (const [label, mutate] of attacks) {
    const scratch = mkdtempSync(resolve(tmpdir(), "agenttool-common-ground-hostile-"));
    const checkout = resolve(scratch, "dataset");
    try {
      cpSync(datasetRoot, checkout, { recursive: true });
      const rows = {
        geometry: readFileSync(resolve(checkout, "data/exact-geometry.jsonl"), "utf8")
          .trimEnd().split("\n").map((line) => JSON.parse(line)),
        wake: readFileSync(resolve(checkout, "data/wake-continuity.jsonl"), "utf8")
          .trimEnd().split("\n").map((line) => JSON.parse(line)),
        analogy: readFileSync(resolve(checkout, "data/analogy-audit.jsonl"), "utf8")
          .trimEnd().split("\n").map((line) => JSON.parse(line)),
      };
      mutate(rows);
      writeCheckoutRows(checkout, "data/exact-geometry.jsonl", rows.geometry);
      writeCheckoutRows(checkout, "data/wake-continuity.jsonl", rows.wake);
      writeCheckoutRows(checkout, "data/analogy-audit.jsonl", rows.analogy);
      refreshCheckoutManifests(checkout);
      expect(() => execFileSync(
        "python3",
        ["-I", resolve(checkout, "verification/verify.py"), checkout],
        { stdio: "pipe" },
      ), label).toThrow();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
});

test("rejects hostile exact-certificate and source mutations", () => {
  expectRejected(({ geometry }) => {
    geometry[0].expected.certificate.point.x = { numerator: "-1", denominator: "1" };
  });
  expectRejected(({ geometry }) => {
    geometry[0].expected.certificate.robustness.radius = { numerator: "2", denominator: "1" };
  });
  expectRejected(({ geometry }) => {
    geometry[1].expected.certificate.knife_edge_proof.rank_witness_constraint_ids = [
      "g02-x-min", "g02-x-min",
    ];
  });
  expectRejected(({ geometry }) => {
    geometry[2].expected.certificate.farkas_multipliers[0].weight = {
      numerator: "-1", denominator: "1",
    };
  });
  expectRejected(({ geometry }) => {
    geometry[2].expected.certificate.deletion_witnesses[0].point = {
      x: { numerator: "0", denominator: "1" },
      y: { numerator: "0", denominator: "1" },
    };
  });
  expectRejected(({ geometry }) => {
    geometry[4].expected.certificate.representability_obstruction.required_value = {
      numerator: "1", denominator: "2",
    };
  });
  expectRejected(({ geometry }) => {
    geometry[5].input.constraints[0].c.parse_relation = "exact";
  });
  expectRejected(({ geometry }) => {
    geometry[0].input.constraints[0].a.exact = { numerator: "2", denominator: "2" };
  });
  expectRejected(({ geometry }) => {
    geometry[0].input.constraints[0].a.binary64_hex = "0000000000000000";
  });
  expectRejected(({ geometry }) => {
    geometry[5].input.constraints[0].c.exact = { numerator: "1", denominator: "3" };
    geometry[5].input.constraints[1].c.exact = { numerator: "-1", denominator: "3" };
  });
  expectRejected(({ geometry }) => {
    geometry[0].expected.reason_code = "minimal_conflict";
  });
  expectRejected(({ geometry }) => {
    const row = geometry[1];
    const inactive = structuredClone(row.input.constraints[1]);
    inactive.id = "g02-inactive-y-wall";
    inactive.source_ref = "synthetic:constraint/g02-inactive-y-wall";
    inactive.c = structuredClone(geometry[0].input.constraints[2].c);
    row.input.constraints.push(inactive);
    row.expected.certificate.membership_constraint_ids.push(inactive.id);
    row.expected.certificate.input_sha256 = domainDigest(INPUT_DIGEST_DOMAIN, row.input);
    row.expected.certificate.knife_edge_proof.rank_witness_constraint_ids = [
      "g02-x-min", inactive.id,
    ];
  });
});

test("rejects stale continuity promotion and analogy drift", () => {
  expectRejected(({ wake }) => {
    wake[1].expected = {
      action: "reuse_after_exact_reverification",
      outcome: "common_ground_certified",
      reason_code: "fresh_unchanged_evidence",
      certificate_reuse_permitted_after_reverification: true,
    };
  });
  expectRejected(({ wake }) => {
    wake[2].evidence.withdrawn_at = null;
  });
  expectRejected(({ analogy }) => {
    analogy[2].evidence.time_family.right_limit = { numerator: "-1", denominator: "1" };
  });
  expectRejected(({ analogy }) => {
    analogy[4].evidence.wake_case_ids = ["cg-w01-fresh-revalidate"];
  });
  expectRejected(({ wake }) => {
    wake[0].evidence.observed_at = "2031-01-01T00:00:00Z";
  });
  expectRejected(({ wake }) => {
    wake[0].evidence.expires_at = "2029-01-01T00:00:00Z";
  });
  expectRejected(({ analogy }) => {
    analogy[2].evidence.time_family.left_limit = { numerator: "-2", denominator: "1" };
  });
  expectRejected(({ analogy }) => {
    analogy[0].missing_layer = "normative_choice_rule";
    analogy[0].reason_code = "multiple_feasible_points_no_selection_rule";
  });
});

test("replays the three subtle profiles against the exact shipped lab", () => {
  const { geometry } = buildRows(provenanceRef);
  const rationalOnly = geometry[4].input.constraints.map((constraint) => ({
    label: constraint.id,
    a: Number(constraint.a.literal),
    b: Number(constraint.b.literal),
    c: Number(constraint.c.literal),
  }));
  const rationalResult = solveCommonGround(rationalOnly);
  expect(rationalResult.outcome).toBe("insufficient_evidence");
  expect(rationalResult.errors[0]).toContain("no finite binary64 witness");

  const underflowText = geometry[5].input.constraints.map((constraint) =>
    `${constraint.id} | ${constraint.a.literal} | ${constraint.b.literal} | ${constraint.c.literal}`
  ).join("\n");
  const underflow = parseConstraintText(underflowText);
  expect(underflow.constraints).toEqual([]);
  expect(underflow.numericIssues).toHaveLength(2);
  expect(solveCommonGround(underflow.constraints, underflow.numericIssues).outcome)
    .toBe("insufficient_evidence");

  const stableText = geometry[8].input.constraints.map((constraint) =>
    `${constraint.id} | ${constraint.a.literal} | ${constraint.b.literal} | ${constraint.c.literal}`
  ).join("\n");
  const stable = parseConstraintText(stableText);
  expect(stable.constraints).toHaveLength(3);
  expect(stable.numericIssues).toHaveLength(1);
  const stableResult = solveCommonGround(stable.constraints, stable.numericIssues);
  expect(stableResult.outcome).toBe("no_common_ground_witnessed");
  expect(stableResult.witness.constraints.map(({ label }) => label)).toEqual([
    "g09-x-min", "g09-y-min", "g09-sum-negative",
  ]);
});

test("public tree contains no gradient lane or obvious private material", () => {
  const searchable = walk(datasetRoot).map((path) => read(path).toString("utf8")).join("\n");
  for (const forbidden of [
    "/Users/",
    "BEGIN PRIVATE KEY",
    '"training_eligible":true',
    '"prompt"',
    '"completion"',
    '"chosen"',
    '"rejected"',
  ]) expect(searchable).not.toContain(forbidden);
});

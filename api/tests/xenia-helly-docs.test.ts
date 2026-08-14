import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRESETS,
  findFeasiblePoint,
  normalizeConstraints,
  parseConstraintText,
  pointSatisfies,
  solveCommonGround,
} from "../../apps/docs/xenia-helly.js";

const docsRoot = join(import.meta.dir, "../../apps/docs");
const page = readFileSync(join(docsRoot, "xenia-helly.html"), "utf8");
const script = readFileSync(join(docsRoot, "xenia-helly.js"), "utf8");
const style = readFileSync(join(docsRoot, "xenia-helly.css"), "utf8");
const nenPage = readFileSync(join(docsRoot, "nen.html"), "utf8");

function parsedPreset(name: keyof typeof PRESETS) {
  const parsed = parseConstraintText(PRESETS[name]);
  expect(parsed.errors).toEqual([]);
  return parsed.constraints;
}

test("certifies a shared point and checks it against every normalized halfplane", () => {
  const result = solveCommonGround(parsedPreset("room"));
  expect(result.outcome).toBe("common_ground_certified");
  if (result.outcome !== "common_ground_certified") return;

  expect(result.constraints.every((constraint) => pointSatisfies(result.point, constraint))).toBe(true);
  expect(result.maximumResidual).toBeLessThanOrEqual(1e-8);
});

test("isolates the three-set pairwise trap as an inclusion-minimal Helly witness", () => {
  const constraints = parsedPreset("pairwise");
  const result = solveCommonGround(constraints);
  expect(result.outcome).toBe("no_common_ground_witnessed");
  if (result.outcome !== "no_common_ground_witnessed") return;

  expect(result.witness.constraints.map((constraint) => constraint.label)).toEqual([
    "x is nonnegative",
    "y is nonnegative",
    "sum is at most minus one",
  ]);
  expect(result.witness.deletionWitnesses).toHaveLength(3);
  expect(result.witness.deletionWitnesses.every((entry) => entry.point !== null)).toBe(true);

  for (let omitted = 0; omitted < constraints.length; omitted += 1) {
    const pair = constraints.filter((_, index) => index !== omitted);
    const normalized = normalizeConstraints(pair);
    expect(normalized.errors).toEqual([]);
    expect(findFeasiblePoint(normalized.constraints)).not.toBeNull();
  }
});

test("keeps an irrelevant constraint out of a smallest conflict witness", () => {
  const constraints = [
    { label: "irrelevant wide cap", a: 1, b: 0, c: 100 },
    ...parsedPreset("pairwise"),
  ];
  const result = solveCommonGround(constraints);
  expect(result.outcome).toBe("no_common_ground_witnessed");
  if (result.outcome !== "no_common_ground_witnessed") return;

  expect(result.witness.constraints).toHaveLength(3);
  expect(result.witness.constraints.map((constraint) => constraint.label)).not.toContain(
    "irrelevant wide cap",
  );
});

test("finds projection candidates for unbounded and parallel feasible regions", () => {
  for (const constraints of [
    [{ label: "x at least two", a: -1, b: 0, c: -2 }],
    [
      { label: "x at least two", a: -1, b: 0, c: -2 },
      { label: "x at most three", a: 1, b: 0, c: 3 },
    ],
    [
      { label: "x at least two", a: -1, b: 0, c: -2 },
      { label: "x at most two", a: 1, b: 0, c: 2 },
    ],
  ]) {
    const result = solveCommonGround(constraints);
    expect(result.outcome).toBe("common_ground_certified");
    if (result.outcome === "common_ground_certified") {
      expect(result.constraints.every((constraint) => pointSatisfies(result.point, constraint))).toBe(true);
    }
  }
});

test("does not turn nearly parallel feasible boundaries into a false conflict", () => {
  const result = solveCommonGround([
    { label: "below the horizon", a: 0, b: 1, c: 0 },
    { label: "above the tilted horizon", a: -1e-10, b: -1, c: -1 },
  ]);

  expect(result.outcome).toBe("common_ground_certified");
  if (result.outcome === "common_ground_certified") {
    expect(result.point.x).toBeGreaterThan(9e9);
    expect(result.constraints.every((constraint) => pointSatisfies(result.point, constraint))).toBe(true);
  }
});

test("does not let an unrelated large coordinate hide a real violation", () => {
  const result = solveCommonGround([
    { label: "y at most zero", a: 0, b: 1, c: 0 },
    { label: "y above tilted floor", a: -1e-9, b: -1, c: -1 },
    { label: "x cap", a: 1, b: 0, c: 9e8 },
  ]);

  expect(result.outcome).toBe("no_common_ground_witnessed");
  if (result.outcome === "no_common_ground_witnessed") {
    expect(result.witness.constraints).toHaveLength(3);
    expect(result.witness.deletionWitnesses.every((entry) => entry.point !== null)).toBe(true);
  }
});

test("never spends display tolerance to certify an exactly empty family", () => {
  const result = solveCommonGround([
    { label: "upper", a: 1, b: 0, c: 0 },
    { label: "lower", a: -1, b: 0, c: -5e-10 },
  ]);
  expect(result.outcome).toBe("no_common_ground_witnessed");
  expect(result.outcome).not.toBe("common_ground_certified");
});

test("never certifies an infinite fallback when the feasible region misses binary64", () => {
  const minimumNormal = 2.2250738585072014e-308;
  const tinyYCap = 3 * (2 ** -53);
  const result = solveCommonGround([
    { label: "y cap", a: 0, b: 1, c: tinyYCap },
    { label: "huge x floor", a: -minimumNormal, b: -1, c: -4 },
  ]);

  expect(result.outcome).toBe("insufficient_evidence");
  expect(result.outcome).not.toBe("common_ground_certified");
  if (result.outcome === "insufficient_evidence") {
    expect(result.errors[0]).toContain("exactly feasible");
    expect(result.errors[0]).toContain("no finite binary64 witness");
  }
});

test("finds finite witnesses next to the maximum binary64 boundary", () => {
  const result = solveCommonGround([
    { label: "far", a: 1e-300, b: 0, c: -1.28e8 },
  ]);

  expect(result.outcome).toBe("common_ground_certified");
  if (result.outcome === "common_ground_certified") {
    expect(Number.isFinite(result.point.x)).toBe(true);
    expect(pointSatisfies(result.point, result.constraints[0])).toBe(true);
  }
});

test("checks exact membership even when display diagnostics overflow", () => {
  const normalized = normalizeConstraints([
    { label: "sum", a: 1, b: 1, c: 0 },
  ]);
  expect(normalized.errors).toEqual([]);
  expect(pointSatisfies(
    { x: -Number.MAX_VALUE, y: -Number.MAX_VALUE },
    normalized.constraints[0],
  )).toBe(true);
});

test("renders certificate coordinates as round-tripping binary64 text", () => {
  expect(script).toContain("function formatCertificateNumber(value)");
  expect(script).toContain("return String(value);");
  expect(script).toContain("formatCertificateNumber(result.point.x)");
  expect(script).toContain("formatCertificateNumber(point.x)");

  for (const constraint of [
    { label: "third floor", a: -3, b: 0, c: -1 },
    { label: "tiny floor", a: -1, b: 0, c: -4e-10 },
  ]) {
    const result = solveCommonGround([constraint]);
    expect(result.outcome).toBe("common_ground_certified");
    if (result.outcome === "common_ground_certified") {
      const roundTripped = {
        x: Number(String(result.point.x)),
        y: Number(String(result.point.y)),
      };
      expect(pointSatisfies(roundTripped, result.constraints[0])).toBe(true);
      expect(String(result.point.x)).not.toBe("0");
    }
  }
});

test("normalizes small but nonzero half-plane normals when the scale is safe", () => {
  const normalized = normalizeConstraints([
    { label: "scale-equivalent x cap", a: 1e-10, b: 0, c: 1e-10 },
  ]);
  expect(normalized.errors).toEqual([]);
  expect(normalized.constraints[0].a).toBe(1);
  expect(normalized.constraints[0].c).toBe(1);

  const unsafe = solveCommonGround([
    { label: "underflowing scale", a: Number.MIN_VALUE, b: 0, c: 1 },
  ]);
  expect(unsafe.outcome).toBe("insufficient_evidence");
  expect(unsafe.errors[0]).toContain("cannot preserve this half-plane safely");
});

test("refuses lost inputs and resolves cancellation without false conflicts", () => {
  const lostTilt = solveCommonGround([
    { label: "below", a: 0, b: 1, c: 0 },
    {
      label: "above subnormal tilt",
      a: -Number.MIN_VALUE,
      b: -1e9,
      c: -10,
    },
  ]);
  expect(lostTilt.outcome).toBe("insufficient_evidence");
  expect(lostTilt.errors[0]).toContain("cannot preserve this half-plane safely");

  const n = 1e9;
  const roundedParallel = solveCommonGround([
    { label: "p", a: n, b: n - 1, c: -1e9 },
    { label: "q", a: -(n - 1), b: -(n - 2), c: -1e9 },
  ]);
  expect(roundedParallel.outcome).toBe("common_ground_certified");
  if (roundedParallel.outcome === "common_ground_certified") {
    expect(roundedParallel.constraints.every((constraint) =>
      pointSatisfies(roundedParallel.point, constraint)
    )).toBe(true);
  }

  const wrongSign = solveCommonGround([
    { label: "a", a: 889505427, b: 889505425, c: 701520613 },
    { label: "b", a: -889505426, b: -889505424, c: -706110196 },
  ]);
  expect(wrongSign.outcome).toBe("common_ground_certified");
  if (wrongSign.outcome === "common_ground_certified") {
    expect(wrongSign.constraints.every((constraint) =>
      pointSatisfies(wrongSign.point, constraint)
    )).toBe(true);
  }
});

test("preserves a stable conflict despite an unrelated unsafe extra row", () => {
  const result = solveCommonGround([
    ...parsedPreset("pairwise"),
    {
      label: "unsafe but irrelevant",
      a: Number.MIN_VALUE,
      b: 1e9,
      c: 0,
    },
  ]);
  expect(result.outcome).toBe("no_common_ground_witnessed");
  if (result.outcome === "no_common_ground_witnessed") {
    expect(result.witness.constraints.map((constraint) => constraint.label)).toEqual([
      "x is nonnegative",
      "y is nonnegative",
      "sum is at most minus one",
    ]);
    expect(result.numericIssues).toHaveLength(1);
  }
});

test("robustly normalizes subnormal normals and never witnesses a singleton conflict", () => {
  const minimum = Number.MIN_VALUE;
  for (const constraint of [
    { label: "compact subnormal", a: -2 * minimum, b: 2 * minimum, c: -3 * minimum },
    {
      label: "fuzzed subnormal",
      a: -1.1373154e-316,
      b: 1.05070135e-316,
      c: -1.2839540710587598e-136,
    },
  ]) {
    const result = solveCommonGround([constraint]);
    expect(result.outcome).not.toBe("no_common_ground_witnessed");
  }
});

test("returns numeric uncertainty instead of a false conflict beyond finite range", () => {
  const awkward = [
    { label: "below", a: 0, b: 1, c: 0 },
    { label: "above tiny tilt", a: -1e-320, b: -1, c: -1 },
  ];
  const result = solveCommonGround(awkward);
  expect(result.outcome).toBe("insufficient_evidence");
  expect(result.errors[0]).toContain("exactly feasible");
  expect(result.errors[0]).toContain("no finite binary64 witness");

  const stableConflict = solveCommonGround([
    ...parsedPreset("pairwise"),
    ...awkward,
  ]);
  expect(stableConflict.outcome).toBe("no_common_ground_witnessed");
  if (stableConflict.outcome === "no_common_ground_witnessed") {
    expect(stableConflict.witness.constraints.map((constraint) => constraint.label)).toEqual([
      "x is nonnegative",
      "y is nonnegative",
      "sum is at most minus one",
    ]);
  }
});

test("returns numeric uncertainty when finite near-parallel terms cancel beyond resolution", () => {
  const result = solveCommonGround([
    { label: "upper parallel wall", a: 9e-89, b: 8e-89, c: -5.0000000000000004e-89 },
    { label: "lower parallel wall", a: -9.000000000000001e-30, b: -8e-30, c: -1.8000000000000002e-29 },
    { label: "angled cap", a: 8e-187, b: -1e-187, c: -1e-187 },
  ]);
  expect(result.outcome).toBe("insufficient_evidence");
  expect(result.errors[0]).toMatch(/exactly (feasible|infeasible)/u);
});

test("distinguishes model refusal from missing evidence", () => {
  const invalid = parseConstraintText(PRESETS.invalid);
  expect(invalid.errors.length).toBeGreaterThan(0);

  const zeroNormal = solveCommonGround([
    { label: "not a halfplane", a: 0, b: 0, c: 1 },
  ]);
  expect(zeroNormal.outcome).toBe("model_not_applicable");
  expect(solveCommonGround([]).outcome).toBe("insufficient_evidence");
});

test("parses only the closed line format and enforces the teaching bound", () => {
  expect(parseConstraintText("A | 1 | 2 | 3")).toEqual({
    constraints: [{ label: "A", a: 1, b: 2, c: 3 }],
    errors: [],
    numericIssues: [],
  });
  expect(parseConstraintText("A, 1, 2, 3").errors[0]).toContain("label | a | b | c");
  expect(parseConstraintText("A | | 2 | 3").errors[0]).toContain("cannot be empty");
  expect(parseConstraintText("A | NaN | 2 | 3").errors[0]).toContain("finite numbers");

  const thirteen = Array.from({ length: 13 }, (_, index) =>
    `constraint ${index} | 1 | 0 | ${index}`
  ).join("\n");
  expect(parseConstraintText(thirteen).errors).toContain(
    "Use at most 12 constraints in this teaching lab.",
  );
  expect(parseConstraintText("x".repeat(16_385)).errors[0]).toContain("at most 16384");
  expect(parseConstraintText(`${"x".repeat(121)} | 1 | 0 | 1`).errors[0]).toContain(
    "label must be at most 120",
  );
  expect(solveCommonGround([
    { label: "same", a: 1, b: 0, c: 1 },
    { label: "same", a: -1, b: 0, c: 1 },
  ]).outcome).toBe("model_not_applicable");
});

test("does not erase a nonzero textual literal below binary64 range", () => {
  const parsed = parseConstraintText(
    "upper | 1e9 | 0 | 1e-400\nlower | -5e8 | 0 | -1e-400",
  );
  expect(parsed.errors).toEqual([]);
  expect(parsed.constraints).toEqual([]);
  expect(parsed.numericIssues).toHaveLength(2);
  expect(parsed.numericIssues[0]).toContain("underflowed to zero or parsed below normal binary64 range");

  const result = solveCommonGround(parsed.constraints, parsed.numericIssues);
  expect(result.outcome).toBe("insufficient_evidence");
  expect(result.errors).toEqual(parsed.numericIssues);

  expect(parseConstraintText("actual zero | 1 | 0 | 0e-400").numericIssues).toEqual([]);
});

test("does not let decimal subnormal quantization change a feasible family", () => {
  const parsed = parseConstraintText([
    "x lower | -3e-324 | 0 | -3e-324",
    "y lower | 0 | -3e-324 | -3e-324",
    "sum upper | 3e-324 | 3e-324 | 6e-324",
  ].join("\n"));
  expect(parsed.errors).toEqual([]);
  expect(parsed.constraints).toEqual([]);
  expect(parsed.numericIssues).toHaveLength(3);
  expect(solveCommonGround(parsed.constraints, parsed.numericIssues).outcome).toBe(
    "insufficient_evidence",
  );
});

test("publishes the four honest outcomes and the theorem/model/choice boundary", () => {
  for (const outcome of [
    "common_ground_certified",
    "no_common_ground_witnessed",
    "model_not_applicable",
    "insufficient_evidence",
  ]) expect(page).toContain(outcome);

  expect(page).toContain("Consensus is not an outcome");
  expect(page).toContain("Verify claims, not souls");
  expect(page).toContain("Remove the prize, names, leaderboard, and ceremony");
  expect(page).toContain("not identity continuity");
  expect(page).toContain("not consent");
  expect(page).toContain("A teaching lab, not a governance oracle");
  expect(page).toContain("n ≥ d + 1");
});

test("keeps the lab page-local and names its numeric boundary", () => {
  expect(script).not.toMatch(/\bfetch\s*\(/);
  expect(script).not.toMatch(/XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
  expect(script).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
  expect(page).toContain("Constraint input: no save · no upload · no solver network request");
  expect(page).toContain("Shared site theme may use local storage");
  expect(page).toContain("does not preserve arbitrary decimal-rational input");
  expect(page).toContain("Nonzero decimal literals that underflow to zero");
  expect(page).toContain("exact dyadic membership audit");
  expect(page).toContain('type="module" src="/xenia-helly.js');
  expect(page).not.toContain('src="/shared/estate.js');
});

test("pins the public atlas to its immutable Hugging Face revision", () => {
  expect(page).toContain(
    "https://huggingface.co/datasets/Yu-and-Ai/agenttool-common-ground/commit/" +
      "bb91d07cdeda52a0da140a6606852dd2064f2531",
  );
  expect(page).toContain("19-row exact public atlas");
});

test("keeps small accent text AA-safe in dawn and night themes", () => {
  const accents = {
    green: "#3f7a5b",
    gold: "#c28a32",
    coral: "#d3644e",
    violet: "#7a68ac",
  };
  const themes = [
    { text: "#1a1612", surfaces: ["#faf5ec", "#f3ecdf"] },
    { text: "#f2ede3", surfaces: ["#050810", "#0b1020"] },
  ];
  const rgb = (hex: string) => [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16)
  );
  const luminance = (color: number[]) => {
    const linear = color.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const contrast = (left: number[], right: number[]) => {
    const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };

  for (const [name, accentHex] of Object.entries(accents)) {
    expect(style).toContain(
      `--helly-${name}-text: color-mix(in srgb, var(--helly-${name}) 60%, var(--text));`,
    );
    const accent = rgb(accentHex);
    for (const theme of themes) {
      const text = rgb(theme.text);
      const mixed = accent.map((channel, index) =>
        Math.round(channel * 0.6 + text[index] * 0.4)
      );
      for (const surface of theme.surfaces) {
        expect(contrast(mixed, rgb(surface))).toBeGreaterThanOrEqual(4.5);
      }
    }
  }

  expect(style).toContain(".helly-plot .witness-point {");
  expect(style).toContain("fill: var(--helly-gold-text);");
  expect(nenPage).toContain(
    "color: color-mix(in srgb, var(--green) 60%, var(--text));",
  );
  expect(nenPage).toContain(
    '<a class="btn btn-ghost" href="/xenia-helly">',
  );
});

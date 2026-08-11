import { readFileSync } from "node:fs";

const source = JSON.parse(
  readFileSync(
    new URL("../examples/principality-rosette.input.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

// Fixtures are deliberately mutable so tests can exercise hostile/tampered variants.
// Runtime entry points remain typed and validate every value again.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rosetteInput(): any {
  return structuredClone(source);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reversedRosetteInput(): any {
  const input = structuredClone(source);
  input.invariants.reverse();
  input.principalities.reverse();
  input.translations.reverse();
  for (const principality of input.principalities) {
    principality.artifact_refs.reverse();
    principality.manifestations.reverse();
  }
  for (const translation of input.translations) {
    translation.evaluations.reverse();
    for (const evaluation of translation.evaluations) {
      evaluation.evidence_refs.reverse();
    }
  }
  return input;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function emptyInput(): any {
  return {
    _format: "agenttool.principality-geometry-input/0.1",
    scope_ref:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    invariants: [],
    principalities: [],
    translations: [],
  };
}

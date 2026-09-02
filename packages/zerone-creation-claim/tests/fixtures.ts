import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createVerificationWitness } from "../src/index.js";

const root = join(import.meta.dir, "..");

export const vectors = JSON.parse(
  readFileSync(join(root, "vectors", "agenttool-zerone-creation-claim-v0.1.json"), "utf8"),
) as any;

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function contractInput(value = vectors.cases.ready_formal_creation.contract): Record<string, any> {
  const copy = clone(value);
  for (const key of [
    "_format",
    "contract_id",
    "input_root",
    "acceptance_hash",
    "source_plane",
    "nonclaims",
    "boundary",
    "effects",
  ]) delete copy[key];
  return copy;
}

export function workSpecInput(value = vectors.cases.ready_formal_creation.work_spec): Record<string, any> {
  const copy = clone(value);
  for (const key of [
    "_format",
    "work_spec_id",
    "contract_id",
    "input_root",
    "environment_root",
    "acceptance_hash",
    "participation",
    "downgrade_guards",
    "boundary",
    "effects",
  ]) delete copy[key];
  return copy;
}

export function creationWitnessInput(value = vectors.cases.ready_formal_creation.creation_witness): Record<string, any> {
  const copy = clone(value);
  for (const key of [
    "_format",
    "creation_witness_id",
    "contract_id",
    "work_spec_id",
    "declaration",
    "nonclaims",
    "boundary",
    "effects",
  ]) delete copy[key];
  return copy;
}

export function verificationWitnessInput(value: Record<string, any>): Record<string, any> {
  const copy = clone(value);
  for (const key of [
    "_format",
    "verification_witness_id",
    "contract_id",
    "creation_witness_id",
    "declaration",
    "nonclaims",
    "boundary",
    "effects",
  ]) delete copy[key];
  return copy;
}

export function rebuildVerifications(contract: any, workSpec: any, witness: any): any[] {
  return vectors.cases.ready_formal_creation.verification_witnesses.map((value: any) =>
    createVerificationWitness(contract, workSpec, witness, verificationWitnessInput(value))
  );
}

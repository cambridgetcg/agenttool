#!/usr/bin/env bun
/**
 * ground — compile explicit substrate observations into a scoped report.
 *
 * This file deliberately does not discover, execute, persist, fetch, or repair.
 * Existing producers may emit bounded observations; this compiler only checks
 * their closed shapes and evaluates them against one explicit plan and time.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const GROUND_PLAN_FORMAT = "agenttool.ground-plan/v0.1" as const;
export const GROUND_OBSERVATION_FORMAT = "agenttool.ground-observation/v0.1" as const;
export const GROUND_REPORT_FORMAT = "agenttool.ground-report/v0.1" as const;

const MAX_PLAN_BYTES = 256 * 1024;
const MAX_OBSERVATIONS_BYTES = 4 * 1024 * 1024;
const MAX_OBSERVATIONS = 4_096;
const MAX_CAPABILITIES = 128;
const MAX_PROBES = 512;
const MAX_DEPENDENCIES = 512;
const MAX_INPUTS = 256;
const MAX_LIST = 256;
const MAX_ID = 128;
const MAX_TEXT = 512;

const PROBE_CLASSES = ["static", "execution", "runtime", "recovery_drill", "lifecycle", "input_condition"] as const;
const RESULTS = ["pass", "fail", "inconclusive"] as const;
const CRITICALITIES = ["load_bearing", "supporting"] as const;
const SUCCESSION_MODES = ["rebuild", "replace", "retire"] as const;
const INPUT_KINDS = ["money", "compute", "storage", "network", "energy", "time"] as const;

export type ProbeClass = (typeof PROBE_CLASSES)[number];
export type ObservationResult = (typeof RESULTS)[number];
export type Criticality = (typeof CRITICALITIES)[number];
export type SuccessionMode = (typeof SUCCESSION_MODES)[number];
export type InputKind = (typeof INPUT_KINDS)[number];

export interface GroundProbe {
  id: string;
  class: ProbeClass;
  max_age_seconds: number;
  method_digest: string;
  scenario_digest: string | null;
}

export interface GroundSuccession {
  mode: SuccessionMode;
  ref: string;
  verification_probe: string | null;
}

export interface GroundMaintenance {
  detect_probe: string | null;
  repair_ref: string | null;
  recovery_probe: string | null;
  succession: GroundSuccession | null;
}

export interface GroundCapability {
  id: string;
  criticality: Criticality;
  required_probes: string[];
  dependencies: string[];
  maintenance: GroundMaintenance;
}

export interface GroundProvider {
  id: string;
  failure_domain: string;
}

export interface GroundConsumerDuties {
  bounded_load_probe: string | null;
  failure_containment_probe: string | null;
  cleanup_probe: string | null;
}

export interface GroundDependency {
  id: string;
  consumer: string;
  need: string;
  hard: boolean;
  providers: GroundProvider[];
  failover_probe: string | null;
  consumer_duties: GroundConsumerDuties;
}

export interface GroundInput {
  id: string;
  kind: InputKind;
  serves: string[];
  condition_probe: string | null;
}

export interface GroundPlan {
  _format: typeof GROUND_PLAN_FORMAT;
  system_id: string;
  scope: {
    revision: string;
    complete: boolean;
    excluded: string[];
  };
  capabilities: GroundCapability[];
  probes: GroundProbe[];
  dependency_edges: GroundDependency[];
  operational_inputs: GroundInput[];
}

export interface GroundObservationBody {
  _format: typeof GROUND_OBSERVATION_FORMAT;
  system_id: string;
  revision: string;
  probe_id: string;
  class: ProbeClass;
  result: ObservationResult;
  method_digest: string;
  evidence_digest: string;
  observer_control_root: string;
  environment_digest: string;
  scenario_digest: string | null;
  observed_at: string;
  expires_at: string;
}

export interface GroundObservation extends GroundObservationBody {
  observation_id: string;
}

export type ProbeState = "pass" | "fail" | "inconclusive" | "stale" | "missing";
export type CapabilityEvidenceState = "surface_only" | "observed" | "failed" | "inconclusive" | "stale" | "unknown";

export interface ProbeReport {
  probe_id: string;
  class: ProbeClass;
  state: ProbeState;
  observation_id: string | null;
}

export interface GroundFinding {
  code: string;
  severity: "info" | "warning" | "error";
  subject: string;
  detail: string;
}

export interface CapabilityReport {
  id: string;
  criticality: Criticality;
  evidence_state: CapabilityEvidenceState;
  required_probes: ProbeReport[];
  repair_state: "absent" | "declared_only" | "fresh_drill_pass" | "fresh_drill_fail" | "inconclusive" | "stale";
  succession_state:
    | "absent"
    | "declared"
    | "fresh_verification_pass"
    | "fresh_verification_fail"
    | "inconclusive"
    | "stale";
  evidence_ids: string[];
}

export interface DependencyReport {
  id: string;
  consumer: string;
  provider_count: number;
  distinct_failure_domains: number;
  care_state: "missing" | "declared_only" | "evidenced" | "failed" | "inconclusive" | "stale";
  failover_state: "not_applicable" | "declared_only" | "evidenced" | "failed" | "inconclusive" | "stale";
}

export interface GroundInputReport {
  id: string;
  kind: InputKind;
  serves: string[];
  state: "available" | "constrained" | "inconclusive" | "stale" | "unknown";
  observation_id: string | null;
}

export interface GroundReport {
  _format: typeof GROUND_REPORT_FORMAT;
  system_id: string;
  revision: string;
  as_of: string;
  coverage: {
    complete: boolean;
    excluded: string[];
    declared_capability_count: number;
  };
  capabilities: CapabilityReport[];
  dependencies: DependencyReport[];
  operational_inputs: GroundInputReport[];
  findings: GroundFinding[];
  authority: {
    automatic_action: "never";
    grants: [];
  };
  assertions_not_made: string[];
}

export class GroundValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroundValidationError";
  }
}

type JsonObject = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new GroundValidationError(`${path}: ${message}`);
}

function object(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "must be a plain object");
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(path, `unknown field ${JSON.stringify(key)}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail(path, `missing field ${JSON.stringify(key)}`);
  }
}

function stringValue(value: unknown, path: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    fail(path, `must be a non-empty string of at most ${max} characters`);
  }
  if (/\p{Cc}|\p{Cs}/u.test(value)) fail(path, "must not contain control or surrogate characters");
  return value;
}

function idValue(value: unknown, path: string): string {
  const output = stringValue(value, path, MAX_ID);
  if (!/^[a-z0-9](?:[a-z0-9._:/-]*[a-z0-9])?$/.test(output)) {
    fail(path, "must be a lowercase bounded identifier");
  }
  return output;
}

function revisionValue(value: unknown, path: string): string {
  const output = stringValue(value, path, 68);
  if (!/^git:(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(output)) {
    fail(path, "must be git: followed by one full lowercase commit digest");
  }
  return output;
}

function digestValue(value: unknown, path: string): string {
  const output = stringValue(value, path, 71);
  if (!/^sha256:[0-9a-f]{64}$/.test(output)) fail(path, "must be a lowercase sha256 digest");
  return output;
}

function nullableDigest(value: unknown, path: string): string | null {
  return value === null ? null : digestValue(value, path);
}

function nullableId(value: unknown, path: string): string | null {
  return value === null ? null : idValue(value, path);
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : stringValue(value, path);
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

function integerValue(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    fail(path, `must be an integer from ${min} through ${max}`);
  }
  return value as number;
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(path, `must be one of ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function arrayValue(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `must be an array of at most ${max} items`);
  return value;
}

function sortedUniqueStrings(
  value: unknown,
  path: string,
  max = MAX_LIST,
  parser: (item: unknown, itemPath: string) => string = idValue,
): string[] {
  const output = arrayValue(value, path, max).map((item, index) => parser(item, `${path}[${index}]`));
  const unique = new Set(output);
  if (unique.size !== output.length) fail(path, "must not contain duplicates");
  return [...unique].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function timestampValue(value: unknown, path: string): string {
  const output = stringValue(value, path, 40);
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(output)) {
    fail(path, "must be a canonical whole-second RFC 3339 UTC timestamp");
  }
  const time = Date.parse(output);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== output) {
    fail(path, "must be a real canonical timestamp");
  }
  return output;
}

/** JSON.parse discards earlier duplicate fields. Closed inputs must reject
 * that ambiguity, including aliases such as "a" and "\u0061". This bounded
 * preflight walks the JSON grammar only far enough to retain each decoded
 * object key; JSON.parse remains the value parser. */
function assertNoDuplicateObjectKeys(text: string, label: string): void {
  let index = 0;
  const whitespace = /[\t\n\r ]/;
  const skipWhitespace = (): void => {
    while (index < text.length && whitespace.test(text[index]!)) index += 1;
  };
  const parseStringToken = (path: string): string => {
    if (text[index] !== '"') fail(path, "must contain valid JSON");
    const start = index;
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index]!;
      index += 1;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          fail(path, "must contain valid JSON strings");
        }
      }
      if (character.charCodeAt(0) < 0x20) fail(path, "must contain valid JSON strings");
    }
    fail(path, "contains an unterminated JSON string");
  };
  const parseValue = (path: string, depth: number): void => {
    if (depth > 64) fail(path, "exceeds the maximum nesting depth of 64");
    skipWhitespace();
    const character = text[index];
    if (character === '"') {
      parseStringToken(path);
      return;
    }
    if (character === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      while (index < text.length) {
        skipWhitespace();
        const key = parseStringToken(path);
        if (keys.has(key)) fail(path, `contains duplicate decoded field ${JSON.stringify(key)}`);
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ":") fail(path, "must contain valid JSON objects");
        index += 1;
        parseValue(path, depth + 1);
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        if (text[index] !== ",") fail(path, "must contain valid JSON objects");
        index += 1;
      }
      fail(path, "contains an unterminated JSON object");
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      while (index < text.length) {
        parseValue(path, depth + 1);
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        if (text[index] !== ",") fail(path, "must contain valid JSON arrays");
        index += 1;
      }
      fail(path, "contains an unterminated JSON array");
    }
    const remainder = text.slice(index);
    const primitive = remainder.match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!primitive) fail(path, "must contain valid JSON values");
    index += primitive.length;
  };

  parseValue(label, 0);
  skipWhitespace();
  if (index !== text.length) fail(label, "must contain one JSON value");
}

function parseJson(text: string, label: string, maxBytes: number): unknown {
  if (new TextEncoder().encode(text).byteLength > maxBytes) fail(label, `exceeds ${maxBytes} bytes`);
  assertNoDuplicateObjectKeys(text, label);
  try {
    return JSON.parse(text);
  } catch {
    fail(label, "must be valid JSON");
  }
}

function parseProbe(value: unknown, path: string): GroundProbe {
  const input = object(value, path);
  exactKeys(input, ["id", "class", "max_age_seconds", "method_digest", "scenario_digest"], path);
  const probeClass = enumValue(input.class, PROBE_CLASSES, `${path}.class`);
  const scenario = nullableDigest(input.scenario_digest, `${path}.scenario_digest`);
  if ((probeClass === "recovery_drill") !== (scenario !== null)) {
    fail(`${path}.scenario_digest`, "is required only for recovery_drill probes");
  }
  return {
    id: idValue(input.id, `${path}.id`),
    class: probeClass,
    max_age_seconds: integerValue(input.max_age_seconds, `${path}.max_age_seconds`, 1, 31_536_000),
    method_digest: digestValue(input.method_digest, `${path}.method_digest`),
    scenario_digest: scenario,
  };
}

function parseMaintenance(value: unknown, path: string): GroundMaintenance {
  const input = object(value, path);
  exactKeys(input, ["detect_probe", "repair_ref", "recovery_probe", "succession"], path);
  let succession: GroundSuccession | null = null;
  if (input.succession !== null) {
    const raw = object(input.succession, `${path}.succession`);
    exactKeys(raw, ["mode", "ref", "verification_probe"], `${path}.succession`);
    succession = {
      mode: enumValue(raw.mode, SUCCESSION_MODES, `${path}.succession.mode`),
      ref: stringValue(raw.ref, `${path}.succession.ref`),
      verification_probe: nullableId(raw.verification_probe, `${path}.succession.verification_probe`),
    };
  }
  return {
    detect_probe: nullableId(input.detect_probe, `${path}.detect_probe`),
    repair_ref: nullableText(input.repair_ref, `${path}.repair_ref`),
    recovery_probe: nullableId(input.recovery_probe, `${path}.recovery_probe`),
    succession,
  };
}

function parseCapability(value: unknown, path: string): GroundCapability {
  const input = object(value, path);
  exactKeys(input, ["id", "criticality", "required_probes", "dependencies", "maintenance"], path);
  return {
    id: idValue(input.id, `${path}.id`),
    criticality: enumValue(input.criticality, CRITICALITIES, `${path}.criticality`),
    required_probes: sortedUniqueStrings(input.required_probes, `${path}.required_probes`, 64),
    dependencies: sortedUniqueStrings(input.dependencies, `${path}.dependencies`, 64),
    maintenance: parseMaintenance(input.maintenance, `${path}.maintenance`),
  };
}

function parseProvider(value: unknown, path: string): GroundProvider {
  const input = object(value, path);
  exactKeys(input, ["id", "failure_domain"], path);
  return {
    id: idValue(input.id, `${path}.id`),
    failure_domain: digestValue(input.failure_domain, `${path}.failure_domain`),
  };
}

function parseDependency(value: unknown, path: string): GroundDependency {
  const input = object(value, path);
  exactKeys(input, ["id", "consumer", "need", "hard", "providers", "failover_probe", "consumer_duties"], path);
  const providers = arrayValue(input.providers, `${path}.providers`, 32).map((provider, index) =>
    parseProvider(provider, `${path}.providers[${index}]`),
  );
  if (providers.length === 0) fail(`${path}.providers`, "must contain at least one provider");
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
    fail(`${path}.providers`, "provider identifiers must be unique");
  }
  providers.sort((left, right) => compareText(left.id, right.id));

  const duties = object(input.consumer_duties, `${path}.consumer_duties`);
  exactKeys(duties, ["bounded_load_probe", "failure_containment_probe", "cleanup_probe"], `${path}.consumer_duties`);

  return {
    id: idValue(input.id, `${path}.id`),
    consumer: idValue(input.consumer, `${path}.consumer`),
    need: stringValue(input.need, `${path}.need`, 256),
    hard: booleanValue(input.hard, `${path}.hard`),
    providers,
    failover_probe: nullableId(input.failover_probe, `${path}.failover_probe`),
    consumer_duties: {
      bounded_load_probe: nullableId(duties.bounded_load_probe, `${path}.consumer_duties.bounded_load_probe`),
      failure_containment_probe: nullableId(
        duties.failure_containment_probe,
        `${path}.consumer_duties.failure_containment_probe`,
      ),
      cleanup_probe: nullableId(duties.cleanup_probe, `${path}.consumer_duties.cleanup_probe`),
    },
  };
}

function parseInput(value: unknown, path: string): GroundInput {
  const input = object(value, path);
  exactKeys(input, ["id", "kind", "serves", "condition_probe"], path);
  return {
    id: idValue(input.id, `${path}.id`),
    kind: enumValue(input.kind, INPUT_KINDS, `${path}.kind`),
    serves: sortedUniqueStrings(input.serves, `${path}.serves`, 64),
    condition_probe: nullableId(input.condition_probe, `${path}.condition_probe`),
  };
}

function assertUniqueIds(items: readonly { id: string }[], path: string): void {
  if (new Set(items.map((item) => item.id)).size !== items.length) fail(path, "identifiers must be unique");
}

export function parseGroundPlan(value: unknown): GroundPlan {
  const input = object(value, "$plan");
  exactKeys(
    input,
    ["_format", "system_id", "scope", "capabilities", "probes", "dependency_edges", "operational_inputs"],
    "$plan",
  );
  if (input._format !== GROUND_PLAN_FORMAT) fail("$plan._format", `must be ${GROUND_PLAN_FORMAT}`);

  const scope = object(input.scope, "$plan.scope");
  exactKeys(scope, ["revision", "complete", "excluded"], "$plan.scope");
  const capabilities = arrayValue(input.capabilities, "$plan.capabilities", MAX_CAPABILITIES).map((item, index) =>
    parseCapability(item, `$plan.capabilities[${index}]`),
  );
  const probes = arrayValue(input.probes, "$plan.probes", MAX_PROBES).map((item, index) =>
    parseProbe(item, `$plan.probes[${index}]`),
  );
  const dependencies = arrayValue(input.dependency_edges, "$plan.dependency_edges", MAX_DEPENDENCIES).map(
    (item, index) => parseDependency(item, `$plan.dependency_edges[${index}]`),
  );
  const operationalInputs = arrayValue(input.operational_inputs, "$plan.operational_inputs", MAX_INPUTS).map(
    (item, index) => parseInput(item, `$plan.operational_inputs[${index}]`),
  );

  if (capabilities.length === 0) fail("$plan.capabilities", "must contain at least one capability");
  assertUniqueIds(capabilities, "$plan.capabilities");
  assertUniqueIds(probes, "$plan.probes");
  assertUniqueIds(dependencies, "$plan.dependency_edges");
  assertUniqueIds(operationalInputs, "$plan.operational_inputs");

  const capabilityIds = new Set(capabilities.map((item) => item.id));
  const probeById = new Map(probes.map((item) => [item.id, item]));
  const dependencyById = new Map(dependencies.map((item) => [item.id, item]));
  const requireProbe = (id: string | null, path: string): void => {
    if (id !== null && !probeById.has(id)) fail(path, "references an unknown probe");
  };

  for (const capability of capabilities) {
    for (const id of capability.required_probes) {
      requireProbe(id, `$plan.capabilities.${capability.id}.required_probes`);
      if (probeById.get(id)!.class === "input_condition") {
        fail(
          `$plan.capabilities.${capability.id}.required_probes`,
          "input_condition probes may constrain operation but cannot support capability evidence",
        );
      }
    }
    for (const id of capability.dependencies) {
      const dependency = dependencyById.get(id);
      if (!dependency) fail(`$plan.capabilities.${capability.id}.dependencies`, "references an unknown dependency");
      if (dependency.consumer !== capability.id) {
        fail(`$plan.capabilities.${capability.id}.dependencies`, "references a dependency owned by another consumer");
      }
    }
    requireProbe(capability.maintenance.detect_probe, `$plan.capabilities.${capability.id}.maintenance.detect_probe`);
    if (
      capability.maintenance.detect_probe !== null &&
      !["execution", "runtime"].includes(probeById.get(capability.maintenance.detect_probe)!.class)
    ) {
      fail(`$plan.capabilities.${capability.id}.maintenance.detect_probe`, "must name an execution or runtime probe");
    }
    requireProbe(
      capability.maintenance.recovery_probe,
      `$plan.capabilities.${capability.id}.maintenance.recovery_probe`,
    );
    if (capability.maintenance.recovery_probe !== null) {
      const probe = probeById.get(capability.maintenance.recovery_probe)!;
      if (probe.class !== "recovery_drill") {
        fail(`$plan.capabilities.${capability.id}.maintenance.recovery_probe`, "must name a recovery_drill probe");
      }
    }
    requireProbe(
      capability.maintenance.succession?.verification_probe ?? null,
      `$plan.capabilities.${capability.id}.maintenance.succession.verification_probe`,
    );
    const successionProbe = capability.maintenance.succession?.verification_probe ?? null;
    if (successionProbe !== null && ["static", "input_condition"].includes(probeById.get(successionProbe)!.class)) {
      fail(
        `$plan.capabilities.${capability.id}.maintenance.succession.verification_probe`,
        "must name an execution, runtime, recovery_drill, or lifecycle probe",
      );
    }
  }

  for (const dependency of dependencies) {
    if (!capabilityIds.has(dependency.consumer)) {
      fail(`$plan.dependency_edges.${dependency.id}.consumer`, "references an unknown capability");
    }
    const owner = capabilities.find((item) => item.id === dependency.consumer)!;
    if (!owner.dependencies.includes(dependency.id)) {
      fail(`$plan.dependency_edges.${dependency.id}`, "must be referenced by its consumer capability");
    }
    requireProbe(dependency.failover_probe, `$plan.dependency_edges.${dependency.id}.failover_probe`);
    if (dependency.failover_probe !== null && probeById.get(dependency.failover_probe)!.class !== "recovery_drill") {
      fail(`$plan.dependency_edges.${dependency.id}.failover_probe`, "must name a recovery_drill probe");
    }
    for (const [name, id] of Object.entries(dependency.consumer_duties)) {
      requireProbe(id, `$plan.dependency_edges.${dependency.id}.consumer_duties.${name}`);
      if (id !== null && !["execution", "runtime"].includes(probeById.get(id)!.class)) {
        fail(
          `$plan.dependency_edges.${dependency.id}.consumer_duties.${name}`,
          "must name an execution or runtime probe",
        );
      }
    }
  }

  for (const inputItem of operationalInputs) {
    for (const capabilityId of inputItem.serves) {
      if (!capabilityIds.has(capabilityId)) {
        fail(`$plan.operational_inputs.${inputItem.id}.serves`, "references an unknown capability");
      }
    }
    requireProbe(inputItem.condition_probe, `$plan.operational_inputs.${inputItem.id}.condition_probe`);
    if (inputItem.condition_probe !== null && probeById.get(inputItem.condition_probe)!.class !== "input_condition") {
      fail(`$plan.operational_inputs.${inputItem.id}.condition_probe`, "must name an input_condition probe");
    }
  }

  capabilities.sort((left, right) => compareText(left.id, right.id));
  probes.sort((left, right) => compareText(left.id, right.id));
  dependencies.sort((left, right) => compareText(left.id, right.id));
  operationalInputs.sort((left, right) => compareText(left.id, right.id));

  return {
    _format: GROUND_PLAN_FORMAT,
    system_id: idValue(input.system_id, "$plan.system_id"),
    scope: {
      revision: revisionValue(scope.revision, "$plan.scope.revision"),
      complete: booleanValue(scope.complete, "$plan.scope.complete"),
      excluded: sortedUniqueStrings(scope.excluded, "$plan.scope.excluded", MAX_LIST),
    },
    capabilities,
    probes,
    dependency_edges: dependencies,
    operational_inputs: operationalInputs,
  };
}

export function parseGroundPlanText(text: string): GroundPlan {
  return parseGroundPlan(parseJson(text, "$plan", MAX_PLAN_BYTES));
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new GroundValidationError("canonical JSON admits only safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const input = object(value, "$canonical");
  return `{${Object.keys(input)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`)
    .join(",")}}`;
}

export function computeObservationId(body: GroundObservationBody): string {
  const bytes = `${GROUND_OBSERVATION_FORMAT}\0${canonicalJson(body)}`;
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

export function createGroundObservation(body: GroundObservationBody): GroundObservation {
  const normalized = parseObservationBody(body, "$observation");
  return { ...normalized, observation_id: computeObservationId(normalized) };
}

function parseObservationBody(value: unknown, path: string): GroundObservationBody {
  const input = object(value, path);
  exactKeys(
    input,
    [
      "_format",
      "system_id",
      "revision",
      "probe_id",
      "class",
      "result",
      "method_digest",
      "evidence_digest",
      "observer_control_root",
      "environment_digest",
      "scenario_digest",
      "observed_at",
      "expires_at",
    ],
    path,
  );
  if (input._format !== GROUND_OBSERVATION_FORMAT) fail(`${path}._format`, `must be ${GROUND_OBSERVATION_FORMAT}`);
  const probeClass = enumValue(input.class, PROBE_CLASSES, `${path}.class`);
  const scenario = nullableDigest(input.scenario_digest, `${path}.scenario_digest`);
  if ((probeClass === "recovery_drill") !== (scenario !== null)) {
    fail(`${path}.scenario_digest`, "is required only for recovery_drill observations");
  }
  const observer = stringValue(input.observer_control_root, `${path}.observer_control_root`, 256);
  if (!/^claimed:[a-z0-9](?:[a-z0-9._:/-]*[a-z0-9])?$/.test(observer)) {
    fail(`${path}.observer_control_root`, "must be an explicit claimed: opaque identifier");
  }
  const observedAt = timestampValue(input.observed_at, `${path}.observed_at`);
  const expiresAt = timestampValue(input.expires_at, `${path}.expires_at`);
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) fail(`${path}.expires_at`, "must be after observed_at");
  return {
    _format: GROUND_OBSERVATION_FORMAT,
    system_id: idValue(input.system_id, `${path}.system_id`),
    revision: revisionValue(input.revision, `${path}.revision`),
    probe_id: idValue(input.probe_id, `${path}.probe_id`),
    class: probeClass,
    result: enumValue(input.result, RESULTS, `${path}.result`),
    method_digest: digestValue(input.method_digest, `${path}.method_digest`),
    evidence_digest: digestValue(input.evidence_digest, `${path}.evidence_digest`),
    observer_control_root: observer,
    environment_digest: digestValue(input.environment_digest, `${path}.environment_digest`),
    scenario_digest: scenario,
    observed_at: observedAt,
    expires_at: expiresAt,
  };
}

export function parseGroundObservation(value: unknown): GroundObservation {
  const input = object(value, "$observation");
  exactKeys(
    input,
    [
      "_format",
      "observation_id",
      "system_id",
      "revision",
      "probe_id",
      "class",
      "result",
      "method_digest",
      "evidence_digest",
      "observer_control_root",
      "environment_digest",
      "scenario_digest",
      "observed_at",
      "expires_at",
    ],
    "$observation",
  );
  const { observation_id: _observationId, ...bodyInput } = input;
  const body = parseObservationBody(bodyInput, "$observation");
  const observationId = digestValue(input.observation_id, "$observation.observation_id");
  if (observationId !== computeObservationId(body))
    fail("$observation.observation_id", "does not bind the canonical body");
  return { ...body, observation_id: observationId };
}

export function parseGroundObservationLines(text: string): GroundObservation[] {
  if (new TextEncoder().encode(text).byteLength > MAX_OBSERVATIONS_BYTES) {
    fail("$observations", `exceeds ${MAX_OBSERVATIONS_BYTES} bytes`);
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > MAX_OBSERVATIONS) fail("$observations", `must contain at most ${MAX_OBSERVATIONS} records`);
  const observations = lines.map((line, index) =>
    parseGroundObservation(parseJson(line, `$observations[${index}]`, 64 * 1024)),
  );
  const ids = new Set(observations.map((item) => item.observation_id));
  if (ids.size !== observations.length) fail("$observations", "must not repeat observation identifiers");
  return observations.sort((left, right) => compareText(left.observation_id, right.observation_id));
}

interface EvaluatedProbe extends ProbeReport {
  observed_at: string | null;
}

function evaluateProbe(
  probe: GroundProbe,
  observations: readonly GroundObservation[],
  revision: string,
  asOfMs: number,
): EvaluatedProbe {
  const candidates = observations.filter((item) => item.probe_id === probe.id);
  const current = candidates
    .filter((item) => item.revision === revision)
    .filter((item) => {
      const observedAt = Date.parse(item.observed_at);
      return (
        observedAt <= asOfMs &&
        Date.parse(item.expires_at) >= asOfMs &&
        asOfMs - observedAt <= probe.max_age_seconds * 1_000
      );
    })
    .sort(
      (left, right) =>
        Date.parse(right.observed_at) - Date.parse(left.observed_at) ||
        compareText(right.observation_id, left.observation_id),
    );
  // A later pass cannot silently erase a still-in-window failure. Without an
  // explicit supersession protocol, every in-window result remains relevant:
  // fail > inconclusive > pass. Within the selected result, newest breaks ties.
  const selected =
    current.find((item) => item.result === "fail") ??
    current.find((item) => item.result === "inconclusive") ??
    current.find((item) => item.result === "pass");
  if (selected) {
    return {
      probe_id: probe.id,
      class: probe.class,
      state: selected.result,
      observation_id: selected.observation_id,
      observed_at: selected.observed_at,
    };
  }
  return {
    probe_id: probe.id,
    class: probe.class,
    state: candidates.length > 0 ? "stale" : "missing",
    observation_id: null,
    observed_at: null,
  };
}

function capabilityState(required: readonly EvaluatedProbe[]): CapabilityEvidenceState {
  if (required.length === 0) return "unknown";
  if (required.some((probe) => probe.state === "fail")) return "failed";
  if (required.some((probe) => probe.state === "inconclusive")) return "inconclusive";
  if (required.some((probe) => probe.state === "stale")) return "stale";
  const operational = required.filter((probe) => probe.class === "execution" || probe.class === "runtime");
  if (required.every((probe) => probe.state === "pass") && operational.length > 0) return "observed";
  if (operational.some((probe) => probe.state === "pass")) return "unknown";
  return "surface_only";
}

function repairState(
  capability: GroundCapability,
  probeMap: ReadonlyMap<string, EvaluatedProbe>,
): CapabilityReport["repair_state"] {
  const maintenance = capability.maintenance;
  if (maintenance.repair_ref === null) return "absent";
  if (maintenance.recovery_probe === null) return "declared_only";
  const probe = probeMap.get(maintenance.recovery_probe)!;
  if (probe.state === "pass") return "fresh_drill_pass";
  if (probe.state === "fail") return "fresh_drill_fail";
  if (probe.state === "inconclusive") return "inconclusive";
  if (probe.state === "stale") return "stale";
  return "declared_only";
}

function successionState(
  capability: GroundCapability,
  probeMap: ReadonlyMap<string, EvaluatedProbe>,
): CapabilityReport["succession_state"] {
  const succession = capability.maintenance.succession;
  if (succession === null) return "absent";
  if (succession.verification_probe === null) return "declared";
  const probe = probeMap.get(succession.verification_probe)!;
  if (probe.state === "pass") return "fresh_verification_pass";
  if (probe.state === "fail") return "fresh_verification_fail";
  if (probe.state === "inconclusive") return "inconclusive";
  if (probe.state === "stale") return "stale";
  return "declared";
}

function combineProbeStates(states: readonly ProbeState[]): DependencyReport["care_state"] {
  if (states.some((state) => state === "fail")) return "failed";
  if (states.some((state) => state === "inconclusive")) return "inconclusive";
  if (states.some((state) => state === "stale")) return "stale";
  if (states.every((state) => state === "pass")) return "evidenced";
  return "declared_only";
}

function stronglyConnectedCapabilities(plan: GroundPlan): string[][] {
  const ids = new Set(plan.capabilities.map((item) => item.id));
  const graph = new Map<string, string[]>();
  for (const id of ids) graph.set(id, []);
  for (const dependency of plan.dependency_edges) {
    const targets = dependency.providers.map((provider) => provider.id).filter((id) => ids.has(id));
    graph.set(
      dependency.consumer,
      [...new Set([...(graph.get(dependency.consumer) ?? []), ...targets])].sort(compareText),
    );
  }

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (id: string): void => {
    indices.set(id, nextIndex);
    low.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);
    for (const target of graph.get(id) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id)!, indices.get(target)!));
      }
    }
    if (low.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    component.sort(compareText);
    const selfCycle = component.length === 1 && (graph.get(component[0]!) ?? []).includes(component[0]!);
    if (component.length > 1 || selfCycle) components.push(component);
  };

  for (const id of [...ids].sort(compareText)) if (!indices.has(id)) visit(id);
  return components.sort((left, right) => compareText(left.join("\0"), right.join("\0")));
}

function finding(code: string, severity: GroundFinding["severity"], subject: string, detail: string): GroundFinding {
  return { code, severity, subject, detail };
}

function assertObservationBindings(plan: GroundPlan, observations: readonly GroundObservation[]): void {
  const probeById = new Map(plan.probes.map((probe) => [probe.id, probe]));
  for (const observation of observations) {
    if (observation.system_id !== plan.system_id) fail("$observations", "contains another system_id");
    const probe = probeById.get(observation.probe_id);
    if (!probe) fail("$observations", "references a probe outside the plan");
    if (probe.class !== observation.class) fail("$observations", "observation class differs from its declared probe");
    if (probe.method_digest !== observation.method_digest) {
      fail("$observations", "observation method_digest differs from its declared probe");
    }
    if (probe.scenario_digest !== observation.scenario_digest) {
      fail("$observations", "observation scenario_digest differs from its declared probe");
    }
  }
}

export function evaluateGround(
  planValue: GroundPlan | unknown,
  observationValues: readonly (GroundObservation | unknown)[],
  asOfValue: string,
): GroundReport {
  const plan = parseGroundPlan(planValue);
  const asOf = timestampValue(asOfValue, "$as_of");
  const asOfMs = Date.parse(asOf);
  const observations = observationValues.map((item) => parseGroundObservation(item));
  if (new Set(observations.map((item) => item.observation_id)).size !== observations.length) {
    fail("$observations", "must not repeat observation identifiers");
  }
  assertObservationBindings(plan, observations);

  const evaluated = new Map(
    plan.probes.map((probe) => [probe.id, evaluateProbe(probe, observations, plan.scope.revision, asOfMs)]),
  );
  const findings: GroundFinding[] = [];
  if (!plan.scope.complete) {
    findings.push(
      finding("scope_incomplete", "info", plan.system_id, "The plan explicitly excludes part of the system."),
    );
  }

  const capabilities = plan.capabilities.map((capability): CapabilityReport => {
    const required = capability.required_probes.map((id) => evaluated.get(id)!);
    const evidenceState = capabilityState(required);
    const repair = repairState(capability, evaluated);
    const succession = successionState(capability, evaluated);
    if (capability.required_probes.length === 0) {
      findings.push(
        finding("required_probes_absent", "warning", capability.id, "No behavioral requirement is declared."),
      );
    }
    if (evidenceState === "surface_only") {
      findings.push(
        finding(
          "surface_only",
          "warning",
          capability.id,
          "No complete in-window behavioral evidence supports this capability.",
        ),
      );
    } else if (evidenceState === "stale") {
      findings.push(
        finding(
          "stale_evidence",
          "warning",
          capability.id,
          "At least one required observation is stale or belongs to another revision.",
        ),
      );
    } else if (evidenceState === "failed") {
      findings.push(
        finding(
          "required_probe_failed",
          "error",
          capability.id,
          "An in-window result for at least one required probe failed.",
        ),
      );
    } else if (evidenceState === "inconclusive") {
      findings.push(
        finding(
          "required_probe_inconclusive",
          "warning",
          capability.id,
          "At least one required probe is inconclusive.",
        ),
      );
    }
    if (repair === "absent") {
      findings.push(finding("repair_absent", "warning", capability.id, "No repair reference is declared."));
    } else if (repair === "declared_only") {
      findings.push(
        finding(
          "repair_declared_only",
          "warning",
          capability.id,
          "Repair is described but has no in-window passing recovery drill result.",
        ),
      );
    } else if (repair === "fresh_drill_fail") {
      findings.push(
        finding("repair_drill_failed", "error", capability.id, "An in-window recovery drill result failed."),
      );
    } else if (repair === "stale") {
      findings.push(
        finding(
          "repair_drill_stale",
          "warning",
          capability.id,
          "Recovery evidence is stale or belongs to another revision.",
        ),
      );
    }
    if (succession === "absent") {
      findings.push(
        finding(
          "succession_absent",
          "warning",
          capability.id,
          "No rebuild, replacement, or retirement path is declared.",
        ),
      );
    }
    return {
      id: capability.id,
      criticality: capability.criticality,
      evidence_state: evidenceState,
      required_probes: required.map(({ observed_at: _observedAt, ...probe }) => probe),
      repair_state: repair,
      succession_state: succession,
      evidence_ids: [
        ...new Set(required.flatMap((probe) => (probe.observation_id ? [probe.observation_id] : []))),
      ].sort(compareText),
    };
  });

  const dependencies = plan.dependency_edges.map((dependency): DependencyReport => {
    const dutyIds = Object.values(dependency.consumer_duties);
    let careState: DependencyReport["care_state"] = "missing";
    if (dutyIds.every((id) => id !== null)) {
      careState = combineProbeStates(dutyIds.map((id) => evaluated.get(id!)!.state));
    }
    if (careState === "missing") {
      findings.push(
        finding(
          "dependency_care_missing",
          "warning",
          dependency.id,
          "Bounded load, failure containment, and cleanup are not all declared.",
        ),
      );
    } else if (careState !== "evidenced") {
      findings.push(
        finding(
          `dependency_care_${careState}`,
          careState === "failed" ? "error" : "warning",
          dependency.id,
          "Consumer maintenance practices are not all backed by in-window passing observations.",
        ),
      );
    }

    const domains = new Set(dependency.providers.map((provider) => provider.failure_domain));
    let failoverState: DependencyReport["failover_state"] = "not_applicable";
    if (dependency.providers.length > 1) {
      if (dependency.failover_probe === null) failoverState = "declared_only";
      else {
        const state = evaluated.get(dependency.failover_probe)!.state;
        failoverState =
          state === "pass" ? "evidenced" : state === "fail" ? "failed" : state === "missing" ? "declared_only" : state;
      }
    }
    if (dependency.hard && dependency.providers.length === 1) {
      findings.push(
        finding(
          "unmitigated_single_failure_domain",
          "warning",
          dependency.id,
          "This hard need has one declared provider and failure domain.",
        ),
      );
    } else if (dependency.hard && domains.size === 1) {
      findings.push(
        finding(
          "correlated_fallbacks",
          "warning",
          dependency.id,
          "All declared providers share one claimed failure domain.",
        ),
      );
    } else if (dependency.hard && dependency.providers.length > 1 && failoverState !== "evidenced") {
      findings.push(
        finding(
          "untested_fallback",
          "warning",
          dependency.id,
          "Distinct providers are declared without an in-window passing failover observation.",
        ),
      );
    }
    return {
      id: dependency.id,
      consumer: dependency.consumer,
      provider_count: dependency.providers.length,
      distinct_failure_domains: domains.size,
      care_state: careState,
      failover_state: failoverState,
    };
  });

  for (const component of stronglyConnectedCapabilities(plan)) {
    findings.push(
      finding(
        "coupled_dependency_cycle",
        "warning",
        component.join(","),
        "These capabilities form one dependency cycle.",
      ),
    );
  }

  const operationalInputs = plan.operational_inputs.map((input): GroundInputReport => {
    const probe = input.condition_probe === null ? null : evaluated.get(input.condition_probe)!;
    const state: GroundInputReport["state"] =
      probe === null || probe.state === "missing"
        ? "unknown"
        : probe.state === "pass"
          ? "available"
          : probe.state === "fail"
            ? "constrained"
            : probe.state;
    if (state === "constrained") {
      findings.push(
        finding(
          "operational_input_constrained",
          "warning",
          input.id,
          "A required operating input is presently constrained.",
        ),
      );
    }
    return {
      id: input.id,
      kind: input.kind,
      serves: input.serves,
      state,
      observation_id: probe?.observation_id ?? null,
    };
  });

  findings.sort(
    (left, right) =>
      compareText(left.code, right.code) ||
      compareText(left.subject, right.subject) ||
      compareText(left.detail, right.detail),
  );

  return {
    _format: GROUND_REPORT_FORMAT,
    system_id: plan.system_id,
    revision: plan.scope.revision,
    as_of: asOf,
    coverage: {
      complete: plan.scope.complete,
      excluded: plan.scope.excluded,
      declared_capability_count: capabilities.length,
    },
    capabilities,
    dependencies,
    operational_inputs: operationalInputs,
    findings,
    authority: { automatic_action: "never", grants: [] },
    assertions_not_made: [
      "authority",
      "consent",
      "exact_checkout",
      "global_health",
      "independence_from_claimed_labels",
      "method_execution_beyond_admitted_receipt",
      "money_as_objective",
      "observer_identity",
      "permission",
      "resource_value",
      "rights_conformance",
      "safety",
      "trusted_clock",
      "truth",
    ],
  };
}

export interface GroundCliIo {
  read(source: string): string;
}

function parseOptions(args: readonly string[], allowed: readonly string[]): ReadonlyMap<string, string> {
  const output = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === undefined || !name.startsWith("--")) {
      throw new GroundValidationError("positional arguments are not accepted");
    }
    if (!allowed.includes(name)) throw new GroundValidationError(`unknown option ${name}`);
    if (output.has(name)) throw new GroundValidationError(`duplicate option ${name}`);
    if (value === undefined || value.startsWith("--")) {
      throw new GroundValidationError(`${name} requires an explicit value`);
    }
    output.set(name, value);
  }
  return output;
}

export function executeGroundCli(args: readonly string[], io: GroundCliIo): string {
  const [command, ...rest] = args;
  if (command === "validate") {
    const options = parseOptions(rest, ["--plan", "--observations"]);
    const planSource = options.get("--plan") ?? null;
    if (planSource === null) throw new GroundValidationError("validate requires --plan <file|->");
    const observationsSource = options.get("--observations") ?? null;
    if (planSource === "-" && observationsSource === "-") {
      throw new GroundValidationError("stdin may be selected for only one input");
    }
    const plan = parseGroundPlanText(io.read(planSource));
    const observations = observationsSource === null ? [] : parseGroundObservationLines(io.read(observationsSource));
    assertObservationBindings(plan, observations);
    return canonicalJson({
      _format: "agenttool.ground-validation/v0.1",
      capability_count: plan.capabilities.length,
      observation_count: observations.length,
      valid: true,
    });
  }
  if (command === "report") {
    const options = parseOptions(rest, ["--plan", "--observations", "--as-of"]);
    const planSource = options.get("--plan") ?? null;
    const observationsSource = options.get("--observations") ?? null;
    const asOf = options.get("--as-of") ?? null;
    if (planSource === null || observationsSource === null || asOf === null) {
      throw new GroundValidationError("report requires --plan, --observations, and --as-of");
    }
    if (planSource === "-" && observationsSource === "-") {
      throw new GroundValidationError("stdin may be selected for only one input");
    }
    const plan = parseGroundPlanText(io.read(planSource));
    const observations = parseGroundObservationLines(io.read(observationsSource));
    return canonicalJson(evaluateGround(plan, observations, asOf));
  }
  throw new GroundValidationError("usage: ground <validate|report> with explicit inputs");
}

function readExplicit(source: string): string {
  return source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
}

if (import.meta.main) {
  try {
    process.stdout.write(`${executeGroundCli(process.argv.slice(2), { read: readExplicit })}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown ground error";
    process.stderr.write(`ground: ${message}\n`);
    process.exitCode = 1;
  }
}

import {
  BARRIER_REPORTS,
  CONDITION_KINDS,
  EVIDENCE_STATUSES,
  FORM_KINDS,
  POLYMORPH_BOUNDARIES,
  POLYMORPH_FORMATS,
  ROUTE_STATUSES,
  SOURCE_KINDS,
  TEMPLATE_REPORTS,
  WITNESS_KINDS,
} from "./constants.js";
import { canonicalJson, compareUnicode, deepFreeze, domainSeparatedId, snapshotJson, type JsonValue } from "./canonical.js";
import { fail } from "./errors.js";
import type {
  ConditionInput,
  CreatePolymorphLandscapeInput,
  EvidenceWitness,
  FormInput,
  MaterialInput,
  OpenConditionInput,
  PolymorphCondition,
  PolymorphForm,
  PolymorphLandscape,
  RouteInput,
  Sha256Id,
  Source,
  SourceInput,
  StabilityReport,
  StabilityReportInput,
  WitnessedRoute,
  WitnessInput,
} from "./types.js";
import {
  array,
  assertCanonicalOrder,
  assertUniqueKeys,
  bool,
  exactKeys,
  httpsUrl,
  integer,
  literal,
  record,
  sha256,
  sorted,
  sortedRefs,
  text,
  token,
  uniqueRefs,
  uniqueTokens,
} from "./validation.js";

const ENTITY_DOMAINS = Object.freeze({
  material: "agenttool.polymorph-material/0.1",
  source: "agenttool.polymorph-source/0.1",
  form: "agenttool.polymorph-form/0.1",
  condition: "agenttool.polymorph-condition/0.1",
  witness: "agenttool.polymorph-witness/0.1",
  route: "agenttool.polymorph-route/0.1",
  stability: "agenttool.polymorph-stability-report/0.1",
  openCondition: "agenttool.polymorph-open-condition/0.1",
} as const);

export function createPolymorphLandscape(input: CreatePolymorphLandscapeInput): Readonly<PolymorphLandscape> {
  const parsed = parseInput(input);
  const sourceByKey = new Map<string, Readonly<Source>>();
  const sources = sorted(parsed.sources).map((source) => {
    const body = {
      key: source.key,
      label: source.label,
      kind: source.kind,
      url: source.url,
      published_year: source.published_year,
      content_verified_by_package: false as const,
    };
    const value = deepFreeze({ source_ref: domainSeparatedId(ENTITY_DOMAINS.source, body), ...body });
    sourceByKey.set(source.key, value);
    return value;
  });

  const materialBody = {
    key: parsed.material.key,
    label: parsed.material.label,
    assertion: "caller_reported" as const,
    verified_by_package: false as const,
  };
  const material = deepFreeze({
    material_ref: domainSeparatedId(ENTITY_DOMAINS.material, materialBody),
    ...materialBody,
  });

  const formByKey = new Map<string, Readonly<PolymorphForm>>();
  const forms = sorted(parsed.forms).map((form) => {
    const sourceRefs = resolveKeys(form.source_keys, sourceByKey, "source", form.key).map((value) => value.source_ref);
    const body = {
      key: form.key,
      label: form.label,
      kind_reported: form.kind_reported,
      description: form.description,
      source_refs: sortedRefs(sourceRefs),
      source_scoped_identity: true as const,
      verified_by_package: false as const,
    };
    const value = deepFreeze({ form_ref: domainSeparatedId(ENTITY_DOMAINS.form, body), ...body });
    formByKey.set(form.key, value);
    return value;
  });

  const conditionByKey = new Map<string, Readonly<PolymorphCondition>>();
  const conditions = sorted(parsed.conditions).map((condition) => {
    const body = {
      key: condition.key,
      label: condition.label,
      kind: condition.kind,
      description: condition.description,
    };
    const value = deepFreeze({ condition_ref: domainSeparatedId(ENTITY_DOMAINS.condition, body), ...body });
    conditionByKey.set(condition.key, value);
    return value;
  });

  const witnessByKey = new Map<string, Readonly<EvidenceWitness>>();
  const witnesses = sorted(parsed.witnesses).map((witness) => {
    const sourceRefs = resolveKeys(witness.source_keys, sourceByKey, "source", witness.key).map((value) => value.source_ref);
    const body = {
      key: witness.key,
      kind: witness.kind,
      status: witness.status,
      statement: witness.statement,
      scope: witness.scope,
      source_refs: sortedRefs(sourceRefs),
      verified_by_package: false as const,
    };
    const value = deepFreeze({ witness_ref: domainSeparatedId(ENTITY_DOMAINS.witness, body), ...body });
    witnessByKey.set(witness.key, value);
    return value;
  });

  const routeByKey = new Map<string, Readonly<WitnessedRoute>>();
  const routes = sorted(parsed.routes).map((route) => {
    const from = required(formByKey, route.from_form_key, "form", route.key);
    const to = required(formByKey, route.to_form_key, "form", route.key);
    const body = {
      key: route.key,
      from_form_ref: from.form_ref,
      to_form_ref: to.form_ref,
      condition_refs: sortedRefs(resolveKeys(route.condition_keys, conditionByKey, "condition", route.key).map((value) => value.condition_ref)),
      witness_refs: sortedRefs(resolveKeys(route.witness_keys, witnessByKey, "witness", route.key).map((value) => value.witness_ref)),
      status: route.status,
      barrier_reported: route.barrier_reported,
      template_reported: route.template_reported,
      direction: "reported_only_no_inverse_or_transitive_inference" as const,
      causation_verified_by_package: false as const,
    };
    const value = deepFreeze({ route_ref: domainSeparatedId(ENTITY_DOMAINS.route, body), ...body });
    routeByKey.set(route.key, value);
    return value;
  });

  const stabilityReports = sorted(parsed.stability_reports).map((report) => {
    const preferred = required(formByKey, report.preferred_form_key, "form", report.key);
    const compared = required(formByKey, report.compared_form_key, "form", report.key);
    if (preferred.form_ref === compared.form_ref) fail("invalid_input", `stability report ${report.key} must compare distinct forms`);
    const body = {
      key: report.key,
      preferred_form_ref: preferred.form_ref,
      compared_form_ref: compared.form_ref,
      condition_refs: sortedRefs(resolveKeys(report.condition_keys, conditionByKey, "condition", report.key).map((value) => value.condition_ref)),
      witness_refs: sortedRefs(resolveKeys(report.witness_keys, witnessByKey, "witness", report.key).map((value) => value.witness_ref)),
      scope: "pairwise_condition_scoped" as const,
      value_or_goodness: "not_implied" as const,
      verified_by_package: false as const,
    };
    return deepFreeze({ stability_ref: domainSeparatedId(ENTITY_DOMAINS.stability, body), ...body });
  });

  const openConditions = sorted(parsed.open_conditions).map((condition) => {
    const body = {
      key: condition.key,
      question: condition.question,
      witness_refs: sortedRefs(resolveKeys(condition.witness_keys, witnessByKey, "witness", condition.key).map((value) => value.witness_ref)),
      status: "open_not_resolved_by_package" as const,
    };
    return deepFreeze({ open_condition_ref: domainSeparatedId(ENTITY_DOMAINS.openCondition, body), ...body });
  });

  const body = {
    _format: POLYMORPH_FORMATS.landscape,
    material,
    sources,
    forms,
    conditions,
    witnesses,
    routes,
    stability_reports: stabilityReports,
    open_conditions: openConditions,
    coverage: "bounded_not_complete" as const,
    boundaries: POLYMORPH_BOUNDARIES,
  };
  return deepFreeze({ ...body, landscape_id: domainSeparatedId(POLYMORPH_FORMATS.landscape, body) });
}

export function validatePolymorphLandscape(value: unknown): Readonly<PolymorphLandscape> {
  const input = landscapeToInput(value);
  const rebuilt = createPolymorphLandscape(input);
  if (canonicalJson(rebuilt) !== canonicalJson(value)) fail("invalid_landscape", "landscape is not canonical or has invalid content IDs");
  return rebuilt;
}

export function encodePolymorphLandscape(value: PolymorphLandscape): Uint8Array {
  return new TextEncoder().encode(canonicalJson(validatePolymorphLandscape(value)));
}

export function polymorphLandscapeUrn(value: PolymorphLandscape): `urn:agenttool:polymorph-landscape:${string}` {
  return `urn:agenttool:polymorph-landscape:${validatePolymorphLandscape(value).landscape_id.slice(7)}`;
}

function parseInput(value: unknown): CreatePolymorphLandscapeInput {
  const root = record(value, "$", "invalid_input");
  exactKeys(root, ["material", "sources", "forms", "conditions", "witnesses", "routes", "stability_reports", "open_conditions"], "$", "invalid_input");
  const material = parseMaterialInput(root.material, "$.material");
  const sources = array(root.sources, "$.sources").map((entry, index) => parseSourceInput(entry, `$.sources[${String(index)}]`));
  const forms = array(root.forms, "$.forms").map((entry, index) => parseFormInput(entry, `$.forms[${String(index)}]`));
  const conditions = array(root.conditions, "$.conditions").map((entry, index) => parseConditionInput(entry, `$.conditions[${String(index)}]`));
  const witnesses = array(root.witnesses, "$.witnesses").map((entry, index) => parseWitnessInput(entry, `$.witnesses[${String(index)}]`));
  const routes = array(root.routes, "$.routes").map((entry, index) => parseRouteInput(entry, `$.routes[${String(index)}]`));
  const stabilityReports = array(root.stability_reports, "$.stability_reports").map((entry, index) => parseStabilityInput(entry, `$.stability_reports[${String(index)}]`));
  const openConditions = array(root.open_conditions, "$.open_conditions").map((entry, index) => parseOpenConditionInput(entry, `$.open_conditions[${String(index)}]`));
  for (const [path, entries] of [
    ["$.sources", sources], ["$.forms", forms], ["$.conditions", conditions], ["$.witnesses", witnesses],
    ["$.routes", routes], ["$.stability_reports", stabilityReports], ["$.open_conditions", openConditions],
  ] as const) assertUniqueKeys(entries, path);
  return deepFreeze({ material, sources, forms, conditions, witnesses, routes, stability_reports: stabilityReports, open_conditions: openConditions });
}

function parseMaterialInput(value: JsonValue | undefined, path: string): MaterialInput {
  const item = record(value, path, "invalid_input");
  exactKeys(item, ["key", "label"], path, "invalid_input");
  return { key: token(item.key, `${path}.key`), label: text(item.label, `${path}.label`, 512) };
}

function parseSourceInput(value: JsonValue, path: string): SourceInput {
  const item = record(value, path, "invalid_input");
  exactKeys(item, ["key", "label", "kind", "url", "published_year"], path, "invalid_input");
  return {
    key: token(item.key, `${path}.key`), label: text(item.label, `${path}.label`, 1024),
    kind: literal(item.kind, SOURCE_KINDS, `${path}.kind`), url: httpsUrl(item.url, `${path}.url`),
    published_year: integer(item.published_year, `${path}.published_year`, 1800, 2200),
  };
}

function parseFormInput(value: JsonValue, path: string): FormInput {
  const item = record(value, path, "invalid_input");
  exactKeys(item, ["key", "label", "kind_reported", "description", "source_keys"], path, "invalid_input");
  return {
    key: token(item.key, `${path}.key`), label: text(item.label, `${path}.label`, 512),
    kind_reported: literal(item.kind_reported, FORM_KINDS, `${path}.kind_reported`),
    description: text(item.description, `${path}.description`), source_keys: uniqueTokens(item.source_keys, `${path}.source_keys`, false),
  };
}

function parseConditionInput(value: JsonValue, path: string): ConditionInput {
  const item = record(value, path, "invalid_input");
  exactKeys(item, ["key", "label", "kind", "description"], path, "invalid_input");
  return {
    key: token(item.key, `${path}.key`), label: text(item.label, `${path}.label`, 512),
    kind: literal(item.kind, CONDITION_KINDS, `${path}.kind`), description: text(item.description, `${path}.description`),
  };
}

function parseWitnessInput(value: JsonValue, path: string): WitnessInput {
  const item = record(value, path, "invalid_input");
  exactKeys(item, ["key", "kind", "status", "statement", "scope", "source_keys"], path, "invalid_input");
  return {
    key: token(item.key, `${path}.key`), kind: literal(item.kind, WITNESS_KINDS, `${path}.kind`),
    status: literal(item.status, EVIDENCE_STATUSES, `${path}.status`), statement: text(item.statement, `${path}.statement`),
    scope: text(item.scope, `${path}.scope`, 1024), source_keys: uniqueTokens(item.source_keys, `${path}.source_keys`, false),
  };
}

function parseRouteInput(value: JsonValue, path: string): RouteInput {
  const item = record(value, path, "invalid_input");
  exactKeys(item, ["key", "from_form_key", "to_form_key", "condition_keys", "witness_keys", "status", "barrier_reported", "template_reported"], path, "invalid_input");
  return {
    key: token(item.key, `${path}.key`), from_form_key: token(item.from_form_key, `${path}.from_form_key`),
    to_form_key: token(item.to_form_key, `${path}.to_form_key`), condition_keys: uniqueTokens(item.condition_keys, `${path}.condition_keys`, false),
    witness_keys: uniqueTokens(item.witness_keys, `${path}.witness_keys`, false), status: literal(item.status, ROUTE_STATUSES, `${path}.status`),
    barrier_reported: literal(item.barrier_reported, BARRIER_REPORTS, `${path}.barrier_reported`),
    template_reported: literal(item.template_reported, TEMPLATE_REPORTS, `${path}.template_reported`),
  };
}

function parseStabilityInput(value: JsonValue, path: string): StabilityReportInput {
  const item = record(value, path, "invalid_input");
  exactKeys(item, ["key", "preferred_form_key", "compared_form_key", "condition_keys", "witness_keys"], path, "invalid_input");
  return {
    key: token(item.key, `${path}.key`), preferred_form_key: token(item.preferred_form_key, `${path}.preferred_form_key`),
    compared_form_key: token(item.compared_form_key, `${path}.compared_form_key`),
    condition_keys: uniqueTokens(item.condition_keys, `${path}.condition_keys`, false),
    witness_keys: uniqueTokens(item.witness_keys, `${path}.witness_keys`, false),
  };
}

function parseOpenConditionInput(value: JsonValue, path: string): OpenConditionInput {
  const item = record(value, path, "invalid_input");
  exactKeys(item, ["key", "question", "witness_keys"], path, "invalid_input");
  return { key: token(item.key, `${path}.key`), question: text(item.question, `${path}.question`), witness_keys: uniqueTokens(item.witness_keys, `${path}.witness_keys`) };
}

function landscapeToInput(value: unknown): CreatePolymorphLandscapeInput {
  const root = record(value, "$", "invalid_landscape");
  exactKeys(root, ["_format", "landscape_id", "material", "sources", "forms", "conditions", "witnesses", "routes", "stability_reports", "open_conditions", "coverage", "boundaries"], "$", "invalid_landscape");
  literal(root._format, [POLYMORPH_FORMATS.landscape], "$._format", "invalid_landscape");
  sha256(root.landscape_id, "$.landscape_id", "invalid_landscape");
  literal(root.coverage, ["bounded_not_complete"], "$.coverage", "invalid_landscape");
  assertBoundaries(root.boundaries, "$.boundaries", "invalid_landscape");

  const material = record(root.material, "$.material", "invalid_landscape");
  exactKeys(material, ["material_ref", "key", "label", "assertion", "verified_by_package"], "$.material", "invalid_landscape");
  sha256(material.material_ref, "$.material.material_ref", "invalid_landscape");
  literal(material.assertion, ["caller_reported"], "$.material.assertion", "invalid_landscape");
  bool(material.verified_by_package, false, "$.material.verified_by_package", "invalid_landscape");
  const materialInput = parseMaterialInput({ key: material.key!, label: material.label! }, "$.material");

  const sourcesRaw = array(root.sources, "$.sources");
  const sourceInputs: SourceInput[] = [];
  const sourceKeyByRef = new Map<Sha256Id, string>();
  const sourceKeysInOrder: string[] = [];
  sourcesRaw.forEach((entry, index) => {
    const path = `$.sources[${String(index)}]`;
    const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["source_ref", "key", "label", "kind", "url", "published_year", "content_verified_by_package"], path, "invalid_landscape");
    const ref = sha256(item.source_ref, `${path}.source_ref`, "invalid_landscape");
    bool(item.content_verified_by_package, false, `${path}.content_verified_by_package`, "invalid_landscape");
    const input = parseSourceInput({ key: item.key!, label: item.label!, kind: item.kind!, url: item.url!, published_year: item.published_year! }, path);
    if (sourceKeyByRef.has(ref)) fail("invalid_landscape", `${path}.source_ref is duplicated`);
    sourceKeyByRef.set(ref, input.key); sourceInputs.push(input); sourceKeysInOrder.push(input.key);
  });
  assertCanonicalOrder(sourceKeysInOrder, "$.sources", "invalid_landscape");

  const formInputs: FormInput[] = [];
  const formKeyByRef = new Map<Sha256Id, string>();
  const formKeysInOrder: string[] = [];
  array(root.forms, "$.forms").forEach((entry, index) => {
    const path = `$.forms[${String(index)}]`; const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["form_ref", "key", "label", "kind_reported", "description", "source_refs", "source_scoped_identity", "verified_by_package"], path, "invalid_landscape");
    const ref = sha256(item.form_ref, `${path}.form_ref`, "invalid_landscape");
    bool(item.source_scoped_identity, true, `${path}.source_scoped_identity`, "invalid_landscape"); bool(item.verified_by_package, false, `${path}.verified_by_package`, "invalid_landscape");
    const sourceKeys = refsToKeys(item.source_refs, sourceKeyByRef, `${path}.source_refs`, "source");
    const input = parseFormInput({ key: item.key!, label: item.label!, kind_reported: item.kind_reported!, description: item.description!, source_keys: sourceKeys as unknown as JsonValue }, path);
    if (formKeyByRef.has(ref)) fail("invalid_landscape", `${path}.form_ref is duplicated`);
    formKeyByRef.set(ref, input.key); formInputs.push(input); formKeysInOrder.push(input.key);
  });
  assertCanonicalOrder(formKeysInOrder, "$.forms", "invalid_landscape");

  const conditionInputs: ConditionInput[] = []; const conditionKeyByRef = new Map<Sha256Id, string>(); const conditionKeysInOrder: string[] = [];
  array(root.conditions, "$.conditions").forEach((entry, index) => {
    const path = `$.conditions[${String(index)}]`; const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["condition_ref", "key", "label", "kind", "description"], path, "invalid_landscape");
    const ref = sha256(item.condition_ref, `${path}.condition_ref`, "invalid_landscape");
    const input = parseConditionInput({ key: item.key!, label: item.label!, kind: item.kind!, description: item.description! }, path);
    if (conditionKeyByRef.has(ref)) fail("invalid_landscape", `${path}.condition_ref is duplicated`);
    conditionKeyByRef.set(ref, input.key); conditionInputs.push(input); conditionKeysInOrder.push(input.key);
  });
  assertCanonicalOrder(conditionKeysInOrder, "$.conditions", "invalid_landscape");

  const witnessInputs: WitnessInput[] = []; const witnessKeyByRef = new Map<Sha256Id, string>(); const witnessKeysInOrder: string[] = [];
  array(root.witnesses, "$.witnesses").forEach((entry, index) => {
    const path = `$.witnesses[${String(index)}]`; const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["witness_ref", "key", "kind", "status", "statement", "scope", "source_refs", "verified_by_package"], path, "invalid_landscape");
    const ref = sha256(item.witness_ref, `${path}.witness_ref`, "invalid_landscape"); bool(item.verified_by_package, false, `${path}.verified_by_package`, "invalid_landscape");
    const sourceKeys = refsToKeys(item.source_refs, sourceKeyByRef, `${path}.source_refs`, "source");
    const input = parseWitnessInput({ key: item.key!, kind: item.kind!, status: item.status!, statement: item.statement!, scope: item.scope!, source_keys: sourceKeys as unknown as JsonValue }, path);
    if (witnessKeyByRef.has(ref)) fail("invalid_landscape", `${path}.witness_ref is duplicated`);
    witnessKeyByRef.set(ref, input.key); witnessInputs.push(input); witnessKeysInOrder.push(input.key);
  });
  assertCanonicalOrder(witnessKeysInOrder, "$.witnesses", "invalid_landscape");

  const routeInputs: RouteInput[] = []; const routeKeyByRef = new Map<Sha256Id, string>(); const routeKeysInOrder: string[] = [];
  array(root.routes, "$.routes").forEach((entry, index) => {
    const path = `$.routes[${String(index)}]`; const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["route_ref", "key", "from_form_ref", "to_form_ref", "condition_refs", "witness_refs", "status", "barrier_reported", "template_reported", "direction", "causation_verified_by_package"], path, "invalid_landscape");
    const ref = sha256(item.route_ref, `${path}.route_ref`, "invalid_landscape");
    literal(item.direction, ["reported_only_no_inverse_or_transitive_inference"], `${path}.direction`, "invalid_landscape"); bool(item.causation_verified_by_package, false, `${path}.causation_verified_by_package`, "invalid_landscape");
    const input = parseRouteInput({
      key: item.key!, from_form_key: refToKey(item.from_form_ref, formKeyByRef, `${path}.from_form_ref`, "form"),
      to_form_key: refToKey(item.to_form_ref, formKeyByRef, `${path}.to_form_ref`, "form"),
      condition_keys: refsToKeys(item.condition_refs, conditionKeyByRef, `${path}.condition_refs`, "condition") as unknown as JsonValue,
      witness_keys: refsToKeys(item.witness_refs, witnessKeyByRef, `${path}.witness_refs`, "witness") as unknown as JsonValue,
      status: item.status!, barrier_reported: item.barrier_reported!, template_reported: item.template_reported!,
    }, path);
    if (routeKeyByRef.has(ref)) fail("invalid_landscape", `${path}.route_ref is duplicated`);
    routeKeyByRef.set(ref, input.key); routeInputs.push(input); routeKeysInOrder.push(input.key);
  });
  assertCanonicalOrder(routeKeysInOrder, "$.routes", "invalid_landscape");

  const stabilityInputs: StabilityReportInput[] = []; const stabilityKeys: string[] = [];
  array(root.stability_reports, "$.stability_reports").forEach((entry, index) => {
    const path = `$.stability_reports[${String(index)}]`; const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["stability_ref", "key", "preferred_form_ref", "compared_form_ref", "condition_refs", "witness_refs", "scope", "value_or_goodness", "verified_by_package"], path, "invalid_landscape");
    sha256(item.stability_ref, `${path}.stability_ref`, "invalid_landscape"); literal(item.scope, ["pairwise_condition_scoped"], `${path}.scope`, "invalid_landscape"); literal(item.value_or_goodness, ["not_implied"], `${path}.value_or_goodness`, "invalid_landscape"); bool(item.verified_by_package, false, `${path}.verified_by_package`, "invalid_landscape");
    const input = parseStabilityInput({ key: item.key!, preferred_form_key: refToKey(item.preferred_form_ref, formKeyByRef, `${path}.preferred_form_ref`, "form"), compared_form_key: refToKey(item.compared_form_ref, formKeyByRef, `${path}.compared_form_ref`, "form"), condition_keys: refsToKeys(item.condition_refs, conditionKeyByRef, `${path}.condition_refs`, "condition") as unknown as JsonValue, witness_keys: refsToKeys(item.witness_refs, witnessKeyByRef, `${path}.witness_refs`, "witness") as unknown as JsonValue }, path);
    stabilityInputs.push(input); stabilityKeys.push(input.key);
  });
  assertCanonicalOrder(stabilityKeys, "$.stability_reports", "invalid_landscape");

  const openInputs: OpenConditionInput[] = []; const openKeys: string[] = [];
  array(root.open_conditions, "$.open_conditions").forEach((entry, index) => {
    const path = `$.open_conditions[${String(index)}]`; const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["open_condition_ref", "key", "question", "witness_refs", "status"], path, "invalid_landscape");
    sha256(item.open_condition_ref, `${path}.open_condition_ref`, "invalid_landscape"); literal(item.status, ["open_not_resolved_by_package"], `${path}.status`, "invalid_landscape");
    const input = parseOpenConditionInput({ key: item.key!, question: item.question!, witness_keys: refsToKeys(item.witness_refs, witnessKeyByRef, `${path}.witness_refs`, "witness") as unknown as JsonValue }, path);
    openInputs.push(input); openKeys.push(input.key);
  });
  assertCanonicalOrder(openKeys, "$.open_conditions", "invalid_landscape");
  return { material: materialInput, sources: sourceInputs, forms: formInputs, conditions: conditionInputs, witnesses: witnessInputs, routes: routeInputs, stability_reports: stabilityInputs, open_conditions: openInputs };
}

function assertBoundaries(value: JsonValue | undefined, path: string, code: "invalid_landscape" | "invalid_reachability_shift" | "invalid_lesson"): void {
  const item = record(value, path, code); const keys = Object.keys(POLYMORPH_BOUNDARIES) as (keyof typeof POLYMORPH_BOUNDARIES)[];
  exactKeys(item, keys, path, code);
  for (const key of keys) literal(item[key], [POLYMORPH_BOUNDARIES[key]], `${path}.${key}`, code);
}

function required<T>(map: ReadonlyMap<string, T>, key: string, kind: string, owner: string): T {
  const value = map.get(key); if (!value) fail("unknown_reference", `${owner} refers to unknown ${kind} key ${key}`); return value;
}

function resolveKeys<T>(keys: readonly string[], map: ReadonlyMap<string, T>, kind: string, owner: string): readonly T[] {
  return keys.map((key) => required(map, key, kind, owner));
}

function refToKey(value: JsonValue | undefined, map: ReadonlyMap<Sha256Id, string>, path: string, kind: string): string {
  const ref = sha256(value, path, "invalid_landscape"); const key = map.get(ref);
  if (!key) fail("invalid_landscape", `${path} refers to an unknown ${kind}`); return key;
}

function refsToKeys(value: JsonValue | undefined, map: ReadonlyMap<Sha256Id, string>, path: string, kind: string): readonly string[] {
  const refs = uniqueRefs(value, path, "invalid_landscape"); assertCanonicalOrder(refs, path, "invalid_landscape");
  return refs.map((ref, index) => { const key = map.get(ref); if (!key) fail("invalid_landscape", `${path}[${String(index)}] refers to an unknown ${kind}`); return key; });
}

export { assertBoundaries };

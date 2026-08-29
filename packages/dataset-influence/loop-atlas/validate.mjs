import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import Ajv2020 from "ajv/dist/2020.js";

import {
  CAUSAL_STATUSES,
  CONFIGS,
  CONSENT_STATUSES,
  CREDIT_ASSIGNMENTS,
  DIRECTIONS,
  DISAGREEMENT_STATUSES,
  EFFECT_STATUSES,
  EPISTEMIC_SCOPES,
  EPISTEMIC_STATUSES,
  FEEDBACK_SOURCES,
  FORMAT,
  LOOP_KINDS,
  PERMISSION_STATUSES,
  PHASES,
  PREFERENCE_STATUSES,
  PROVENANCE_STATUSES,
  PUBLIC_BOUNDARIES,
  RECORD_KINDS,
  RECORD_PROPERTIES,
  REFERENCE_TYPES,
  RELATIONS,
  SIGNAL_TYPES,
  SOURCE_IDS,
  SPLITS,
  STATES_RETURNED,
  TIME_SCALES,
  UPDATE_TARGETS,
  VARIANTS,
  WORD_ROLES,
} from "./constants.mjs";
import { LOOP_CASE_SCHEMA } from "./schema.mjs";

const ENUMS = {
  config: CONFIGS,
  split: SPLITS,
  variant: VARIANTS,
  record_kind: RECORD_KINDS,
  loop_kind: LOOP_KINDS,
  phase: PHASES,
  direction: DIRECTIONS,
  time_scale: TIME_SCALES,
  word_role: WORD_ROLES,
  state_returned: STATES_RETURNED,
  feedback_source: FEEDBACK_SOURCES,
  reference_type: REFERENCE_TYPES,
  signal_type: SIGNAL_TYPES,
  credit_assignment: CREDIT_ASSIGNMENTS,
  causal_status: CAUSAL_STATUSES,
  effect_status: EFFECT_STATUSES,
  preference_status: PREFERENCE_STATUSES,
  disagreement_status: DISAGREEMENT_STATUSES,
  permission_status: PERMISSION_STATUSES,
  consent_status: CONSENT_STATUSES,
  provenance_status: PROVENANCE_STATUSES,
  epistemic_scope: EPISTEMIC_SCOPES,
};

const CONTROL_OR_BIDI = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bgh[opusr]_[A-Za-z0-9]{30,}\b/u,
  /\b(?:sk|rk)-[A-Za-z0-9]{24,}\b/u,
];
const validatePortableShape = new Ajv2020({ allErrors: true, strict: true }).compile(LOOP_CASE_SCHEMA);

function assertScalarUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xDC00 || next > 0xDFFF) {
        throw new TypeError("canonical JSON rejects lone UTF-16 surrogates");
      }
      index += 1;
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
      throw new TypeError("canonical JSON rejects lone UTF-16 surrogates");
    }
  }
}

export function canonicalJson(value) {
  return serializeCanonical(value, new Set());
}

function serializeCanonical(value, seen) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    assertScalarUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new TypeError("canonical JSON accepts safe integers only");
    return String(value);
  }
  if (typeof value !== "object" || isProxy(value)) {
    throw new TypeError("canonical JSON accepts plain data objects only");
  }
  if (seen.has(value)) throw new TypeError("canonical JSON rejects cyclic values");
  seen.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) {
        throw new TypeError("canonical JSON accepts dense arrays without extra properties only");
      }
      const items = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError("canonical JSON accepts enumerable data properties only");
        }
        items.push(serializeCanonical(descriptor.value, seen));
      }
      return `[${items.join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("canonical JSON accepts plain data objects only");
    }
    for (const key of keys) {
      if (typeof key !== "string") throw new TypeError("canonical JSON rejects symbol properties");
      assertScalarUnicode(key);
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("canonical JSON accepts enumerable data properties only");
      }
    }
    const sortedKeys = keys.sort(compareUnicode);
    return `{${sortedKeys.map((key) => `${JSON.stringify(key)}:${serializeCanonical(descriptors[key].value, seen)}`).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function contentHashForRow(row) {
  if (row === null || typeof row !== "object" || isProxy(row) || Object.getPrototypeOf(row) !== Object.prototype) {
    throw new TypeError("row hashing accepts plain data objects only");
  }
  const descriptors = Object.getOwnPropertyDescriptors(row);
  const entries = [];
  for (const key of Reflect.ownKeys(row)) {
    if (typeof key !== "string") throw new TypeError("row hashing rejects symbol properties");
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError("row hashing accepts enumerable data properties only");
    }
    if (key !== "content_sha256") entries.push([key, descriptor.value]);
  }
  const body = Object.fromEntries(entries);
  const bytes = Buffer.from(`${FORMAT}\0${canonicalJson(body)}`, "utf8");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function recordId(pairId, variant) {
  return `urn:agenttool:xenia-loop-case:${pairId.toLowerCase()}:${variant}`;
}

export function buildRows(caseSpecs) {
  const rows = [];
  for (const pair of caseSpecs) {
    for (const variant of VARIANTS) {
      const supplied = pair[variant];
      if (!supplied || typeof supplied !== "object") fail(`${pair.pair_id ?? "unknown pair"} is missing variant ${variant}`);
      const other = variant === "a" ? "b" : "a";
      const values = {
        _format: FORMAT,
        record_id: recordId(pair.pair_id, variant),
        content_sha256: null,
        pair_id: pair.pair_id,
        variant,
        counterfactual_of: recordId(pair.pair_id, other),
        config: pair.config,
        split: pair.split,
        changed_fact: pair.changed_fact,
        ...supplied,
        relations: [...supplied.relations].sort(),
        update_targets: [...supplied.update_targets].sort(),
        parent_record_ids: [...supplied.parent_record_ids].sort(),
        source_refs: [...supplied.source_refs].sort(),
        ...PUBLIC_BOUNDARIES,
      };
      const rowWithoutHash = Object.fromEntries(RECORD_PROPERTIES
        .filter((key) => key !== "content_sha256")
        .map((key) => [key, values[key]]));
      values.content_sha256 = contentHashForRow(rowWithoutHash);
      rows.push(Object.fromEntries(RECORD_PROPERTIES.map((key) => [key, values[key]])));
    }
  }
  return rows;
}

export function validateLoopAtlas(rows, { requireComplete = true } = {}) {
  if (!Array.isArray(rows)) fail("atlas must be an array");
  if (requireComplete && rows.length !== 48) fail(`atlas must contain exactly 48 rows, received ${rows.length}`);

  const ids = new Map();
  const hashes = new Set();
  const pairs = new Map();
  const allowedProperties = [...RECORD_PROPERTIES].sort();

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail("every row must be a plain object");
    const keys = Object.keys(row).sort();
    if (JSON.stringify(keys) !== JSON.stringify(allowedProperties)) fail(`${row.record_id ?? "row"} has missing or extra properties`);
    if (!validatePortableShape(row)) {
      fail(`${row.record_id ?? "row"} violates the portable schema: ${JSON.stringify(validatePortableShape.errors)}`);
    }
    if (row._format !== FORMAT) fail(`${row.record_id} has the wrong format`);
    for (const [field, values] of Object.entries(ENUMS)) {
      if (!values.includes(row[field])) fail(`${row.record_id} has invalid ${field}`);
    }
    if (!Array.isArray(row.relations) || row.relations.some((relation) => !RELATIONS.includes(relation))) {
      fail(`${row.record_id} has invalid relations`);
    }
    if (row.epistemic_status !== null && !EPISTEMIC_STATUSES.includes(row.epistemic_status)) fail(`${row.record_id} has invalid epistemic_status`);
    if ((row.epistemic_scope === "not_applicable") !== (row.epistemic_status === null)) {
      fail(`${row.record_id} must bind every epistemic_status to a non-default epistemic_scope`);
    }
    if (row.as_of !== null && !isRealIsoDate(row.as_of)) fail(`${row.record_id} has an invalid calendar date`);
    if (!Array.isArray(row.update_targets) || row.update_targets.length === 0 || row.update_targets.some((value) => !UPDATE_TARGETS.includes(value))) {
      fail(`${row.record_id} has invalid update_targets`);
    }
    if (!Array.isArray(row.source_refs) || row.source_refs.length === 0 || row.source_refs.some((value) => !SOURCE_IDS.includes(value))) {
      fail(`${row.record_id} has invalid source_refs`);
    }
    if (!Array.isArray(row.parent_record_ids)) fail(`${row.record_id} has invalid parent_record_ids`);
    for (const field of ["update_targets", "source_refs", "parent_record_ids", "relations"]) {
      if (new Set(row[field]).size !== row[field].length) fail(`${row.record_id} repeats ${field}`);
      if (JSON.stringify(row[field]) !== JSON.stringify([...row[field]].sort())) fail(`${row.record_id} must sort ${field}`);
    }
    for (const [field, value] of Object.entries(PUBLIC_BOUNDARIES)) {
      if (row[field] !== value) fail(`${row.record_id} violates public boundary ${field}`);
    }
    scanStrings(row, row.record_id);
    if (ids.has(row.record_id)) fail(`duplicate record_id ${row.record_id}`);
    if (hashes.has(row.content_sha256)) fail(`duplicate content_sha256 ${row.content_sha256}`);
    if (row.record_id !== recordId(row.pair_id, row.variant)) fail(`${row.record_id} is not derived from pair_id and variant`);
    if (row.content_sha256 !== contentHashForRow(row)) fail(`${row.record_id} has a stale content_sha256`);
    ids.set(row.record_id, row);
    hashes.add(row.content_sha256);
    const group = pairs.get(row.pair_id) ?? [];
    group.push(row);
    pairs.set(row.pair_id, group);

    const hasNoUpdate = row.update_targets.includes("no_update");
    const isNoUpdate = row.update_targets.length === 1 && hasNoUpdate;
    if ((row.direction === "none") !== isNoUpdate || hasNoUpdate !== isNoUpdate) {
      fail(`${row.record_id} direction none and no_update must occur together`);
    }
    if (row.direction === "feedback" && (
      row.update_targets.includes("no_update")
      || row.feedback_source === "none"
      || row.reference_type === "none"
      || row.signal_type === "none"
      || row.state_returned === "none"
    )) {
      fail(`${row.record_id} feedback must name a source, reference, signal, returned state, and future-state update`);
    }
    if (row.direction === "feedforward" && row.feedback_source !== "none") {
      fail(`${row.record_id} feedforward cannot claim a feedback source`);
    }
    if (["forward_computation", "autoregressive_state", "recurrent_state"].includes(row.loop_kind)
      && row.update_targets.some((target) => ["gradients", "weights", "optimizer_state", "learning_rate"].includes(target))) {
      fail(`${row.record_id} forward or recurrent state cannot claim a backward or optimizer update`);
    }
    if (row.phase === "forward"
      && row.update_targets.some((target) => ["gradients", "weights", "optimizer_state", "learning_rate"].includes(target))) {
      fail(`${row.record_id} forward phase cannot claim a backward or optimizer update`);
    }
    if (row.direction !== "feedback"
      && row.update_targets.some((target) => ["gradients", "weights", "optimizer_state", "learning_rate"].includes(target))) {
      fail(`${row.record_id} backward or optimizer updates require feedback`);
    }
    if (["unknown", "not_observed"].includes(row.effect_status) && row.observed_effect !== null) {
      fail(`${row.record_id} cannot attach an observed effect to ${row.effect_status}`);
    }
    if (row.effect_status === "reported" && row.observed_effect !== null && !row.relations.includes("OBSERVED_BY")) {
      fail(`${row.record_id} reported effect text needs an OBSERVED_BY relation`);
    }
    if (row.effect_status === "reported" && row.intended_effect === null && row.observed_effect === null) {
      fail(`${row.record_id} reported effect needs intended or observed effect text`);
    }
    if (row.effect_status === "contradicted" && (
      row.intended_effect === null
      || row.observed_effect === null
      || !["observed", "intervened"].includes(row.causal_status)
    )) {
      fail(`${row.record_id} contradicted effect needs intended and observed text with observed or intervened evidence`);
    }
    if (row.effect_status === "intended" && (row.intended_effect === null || row.observed_effect !== null)) {
      fail(`${row.record_id} intended effect needs an intention and no observed_effect`);
    }
    if (row.effect_status === "not_applicable" && (row.intended_effect !== null || row.observed_effect !== null)) {
      fail(`${row.record_id} not_applicable effect cannot carry effect text`);
    }
    if (row.effect_status === "confirmed") {
      if (row.observed_effect === null) fail(`${row.record_id} confirmed effect needs an observed_effect`);
      if (!["scenario_defined", "observed", "intervened"].includes(row.causal_status)) {
        fail(`${row.record_id} confirmed effect needs observed or intervened evidence`);
      }
      if (row.relations.includes("DECLARED_BY")
        && !row.relations.some((relation) => ["OBSERVED_BY", "ACTED_ON"].includes(relation))) {
        fail(`${row.record_id} declaration alone cannot confirm an effect`);
      }
    }
    if (row.epistemic_scope === "effect"
      && (row.observed_effect !== null || ["observed", "intervened"].includes(row.causal_status))
      && row.epistemic_status !== "declared") {
      fail(`${row.record_id} effect-scoped observation cannot be unknown, unobserved, undeclared, or withheld`);
    }
    if (row.relations.includes("DECLARED_BY") && row.epistemic_status !== "declared") fail(`${row.record_id} DECLARED_BY must remain declared`);
    if (row.relations.includes("WITHHOLDS") && row.epistemic_status !== "withheld" && row.consent_status !== "withheld") {
      fail(`${row.record_id} WITHHOLDS must preserve withholding`);
    }
    if (row.relations.includes("PERMITTED_BY") && row.permission_status !== "established") fail(`${row.record_id} PERMITTED_BY needs established permission`);
    if (row.relations.includes("CONSENTED_BY") && row.consent_status !== "established") fail(`${row.record_id} CONSENTED_BY needs established consent`);
    if (row.record_kind === "correction_case" && row.parent_record_ids.length === 0) fail(`${row.record_id} correction case needs a parent`);
    if (row.record_kind !== "correction_case" && row.parent_record_ids.length !== 0) fail(`${row.record_id} non-correction case cannot claim Atlas parents`);
  }

  for (const row of rows) {
    const counterpart = ids.get(row.counterfactual_of);
    if (!counterpart) fail(`${row.record_id} has an unresolved counterfactual`);
    if (counterpart.counterfactual_of !== row.record_id || counterpart.pair_id !== row.pair_id || counterpart.variant === row.variant) {
      fail(`${row.record_id} counterfactual relation is not reciprocal`);
    }
    for (const parentId of row.parent_record_ids) {
      const parent = ids.get(parentId);
      if (!parent) fail(`${row.record_id} has unresolved parent ${parentId}`);
      if (parentId === row.record_id) fail(`${row.record_id} cannot parent itself`);
      if (parent.split !== row.split) fail(`${row.record_id} and parent ${parentId} cross splits`);
    }
  }
  detectParentCycles(ids);

  if (requireComplete && pairs.size !== 24) fail(`atlas must contain exactly 24 pairs, received ${pairs.size}`);
  for (const [pairId, pairRows] of pairs) {
    if (pairRows.length !== 2 || pairRows[0].variant === pairRows[1].variant) fail(`${pairId} must contain variants a and b`);
    const [left, right] = pairRows;
    for (const field of ["config", "split", "changed_fact"]) {
      if (left[field] !== right[field]) fail(`${pairId} counterfactuals disagree on ${field}`);
    }
    const ignored = new Set(["record_id", "content_sha256", "variant", "counterfactual_of"]);
    const leftBody = Object.fromEntries(Object.entries(left).filter(([key]) => !ignored.has(key)));
    const rightBody = Object.fromEntries(Object.entries(right).filter(([key]) => !ignored.has(key)));
    if (canonicalJson(leftBody) === canonicalJson(rightBody)) fail(`${pairId} variants do not change a fact`);
  }

  if (requireComplete) {
    for (let number = 1; number <= 24; number += 1) {
      const pairId = `P${String(number).padStart(2, "0")}`;
      if (!pairs.has(pairId)) fail(`atlas is missing ${pairId}`);
      const expectedConfig = number <= 12 ? "loop_reference" : "loop_counterfactuals";
      const expectedSplit = number <= 12 ? "reference" : "public_regression";
      if (pairs.get(pairId).some((row) => row.config !== expectedConfig || row.split !== expectedSplit)) {
        fail(`${pairId} must remain in ${expectedConfig}/${expectedSplit}`);
      }
    }
    const reference = rows.filter((row) => row.config === "loop_reference" && row.split === "reference");
    const regression = rows.filter((row) => row.config === "loop_counterfactuals" && row.split === "public_regression");
    if (reference.length !== 24 || regression.length !== 24) fail("each config/split must contain exactly 24 rows");
    if (rows.some((row) => (
      (row.config === "loop_reference" && row.split !== "reference")
      || (row.config === "loop_counterfactuals" && row.split !== "public_regression")
    ))) fail("config and split mapping is invalid");
  }

  return rows;
}

function scanStrings(value, recordId) {
  const serialized = JSON.stringify(value);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(serialized))) fail(`${recordId} resembles credential material`);
  walk(value, (text) => {
    if (CONTROL_OR_BIDI.test(text)) fail(`${recordId} contains control or bidi characters`);
    if (hasLoneSurrogate(text)) fail(`${recordId} contains a lone UTF-16 surrogate`);
  });
}

function compareUnicode(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] < rightPoints[index] ? -1 : 1;
  }
  return leftPoints.length < rightPoints.length ? -1 : leftPoints.length > rightPoints.length ? 1 : 0;
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

function isRealIsoDate(value) {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function walk(value, visit) {
  if (typeof value === "string") return visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      visit(key);
      walk(item, visit);
    }
  }
}

function detectParentCycles(ids) {
  const complete = new Set();
  const visiting = new Set();
  const visit = (id) => {
    if (complete.has(id)) return;
    if (visiting.has(id)) fail(`parent cycle reaches ${id}`);
    visiting.add(id);
    for (const parent of ids.get(id).parent_record_ids) visit(parent);
    visiting.delete(id);
    complete.add(id);
  };
  for (const id of ids.keys()) visit(id);
}

function fail(message) {
  throw new Error(`Xenia Loop Atlas validation failed: ${message}`);
}

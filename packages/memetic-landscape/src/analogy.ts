import {
  ANALOGY_MAPPING_KEYS,
  MEMETIC_FORMATS,
  NON_TRANSFERRED_PROPERTIES,
  POLYMORPH_REACHABILITY_SHIFT_FORMAT,
} from "./constants.js";
import { canonicalJson, deepFreeze, domainSeparatedId } from "./canonical.js";
import { fail } from "./errors.js";
import type { CreatePolymorphMemeticAnalogyInput, PolymorphMemeticAnalogy } from "./types.js";
import { exactKeys, literal, record, sha256 } from "./validation.js";

const MAPPINGS = Object.freeze([
  {
    key: "state_or_variant",
    polymorph_shape: "one source-scoped physical crystal form",
    memetic_shape: "one source-scoped expression variant",
    boundary: "molecular identity is retained in polymorphism; semantic identity is not inferred across meme variants",
  },
  {
    key: "named_condition_or_context",
    polymorph_shape: "named material and process conditions",
    memetic_shape: "named channel, network, ranking, audience, and observation context",
    boundary: "a participant is never a process condition, host, vector, or substrate",
  },
  {
    key: "directed_witnessed_route",
    polymorph_shape: "a witnessed production or conversion route",
    memetic_shape: "a witnessed or explicitly authored copy, remix, translation, or reintroduction relation",
    boundary: "no physical conversion, infection, adoption, semantic equivalence, inverse, or transitive route transfers",
  },
  {
    key: "bounded_reachability",
    polymorph_shape: "routine access to a form under named conditions",
    memetic_shape: "bounded observation or reproduction of a variant in a named context",
    boundary: "popularity is not thermodynamic stability, truth, value, health, or worth",
  },
  {
    key: "changed_conditions_reappearance",
    polymorph_shape: "a prior form reached again through changed material conditions",
    memetic_shape: "a variant observed or reproduced again in a changed context",
    boundary: "reappearance does not prove a shared mechanism, original cause, preserved meaning, or inevitable recurrence",
  },
] as const);

export function createPolymorphMemeticAnalogy(
  inputValue: CreatePolymorphMemeticAnalogyInput,
): Readonly<PolymorphMemeticAnalogy> {
  const input = parseInput(inputValue);
  const body = {
    _format: MEMETIC_FORMATS.analogy,
    polymorph_shift: {
      _format: POLYMORPH_REACHABILITY_SHIFT_FORMAT,
      shift_id: input.polymorph_shift_id,
    },
    memetic_shift: {
      _format: MEMETIC_FORMATS.reachabilityShift,
      shift_id: input.memetic_shift_id,
    },
    relationship: "structural_route_shape_only" as const,
    mechanism_transferred: false as const,
    mappings: MAPPINGS,
    non_transfer: NON_TRANSFERRED_PROPERTIES,
    effect: "none" as const,
  };
  return deepFreeze({ ...body, analogy_id: domainSeparatedId(MEMETIC_FORMATS.analogy, body) });
}

export function validatePolymorphMemeticAnalogy(value: unknown): Readonly<PolymorphMemeticAnalogy> {
  const root = record(value, "$", "invalid_analogy");
  exactKeys(root, ["_format", "analogy_id", "polymorph_shift", "memetic_shift", "relationship", "mechanism_transferred", "mappings", "non_transfer", "effect"], "$", "invalid_analogy");
  literal(root._format, [MEMETIC_FORMATS.analogy], "$._format", "invalid_analogy");
  sha256(root.analogy_id, "$.analogy_id", "invalid_analogy");
  literal(root.relationship, ["structural_route_shape_only"], "$.relationship", "invalid_analogy");
  if (root.mechanism_transferred !== false) fail("invalid_analogy", "$.mechanism_transferred must be false");
  literal(root.effect, ["none"], "$.effect", "invalid_analogy");
  const polymorph = record(root.polymorph_shift, "$.polymorph_shift", "invalid_analogy");
  exactKeys(polymorph, ["_format", "shift_id"], "$.polymorph_shift", "invalid_analogy");
  literal(polymorph._format, [POLYMORPH_REACHABILITY_SHIFT_FORMAT], "$.polymorph_shift._format", "invalid_analogy");
  const memetic = record(root.memetic_shift, "$.memetic_shift", "invalid_analogy");
  exactKeys(memetic, ["_format", "shift_id"], "$.memetic_shift", "invalid_analogy");
  literal(memetic._format, [MEMETIC_FORMATS.reachabilityShift], "$.memetic_shift._format", "invalid_analogy");
  const rebuilt = createPolymorphMemeticAnalogy({
    polymorph_shift_id: sha256(polymorph.shift_id, "$.polymorph_shift.shift_id", "invalid_analogy"),
    memetic_shift_id: sha256(memetic.shift_id, "$.memetic_shift.shift_id", "invalid_analogy"),
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    fail("invalid_analogy", "analogy is not canonical or has an invalid content ID");
  }
  return rebuilt;
}

export function encodePolymorphMemeticAnalogy(value: PolymorphMemeticAnalogy): Uint8Array {
  return new TextEncoder().encode(canonicalJson(validatePolymorphMemeticAnalogy(value)));
}

export function polymorphMemeticAnalogyUrn(
  value: PolymorphMemeticAnalogy,
): `urn:agenttool:polymorph-memetic-analogy:${string}` {
  return `urn:agenttool:polymorph-memetic-analogy:${validatePolymorphMemeticAnalogy(value).analogy_id.slice(7)}`;
}

function parseInput(value: unknown): Readonly<CreatePolymorphMemeticAnalogyInput> {
  const root = record(value, "$", "invalid_analogy");
  exactKeys(root, ["polymorph_shift_id", "memetic_shift_id"], "$", "invalid_analogy");
  return deepFreeze({
    polymorph_shift_id: sha256(root.polymorph_shift_id, "$.polymorph_shift_id", "invalid_analogy"),
    memetic_shift_id: sha256(root.memetic_shift_id, "$.memetic_shift_id", "invalid_analogy"),
  });
}

if (MAPPINGS.map((mapping) => mapping.key).join("\u0000") !== ANALOGY_MAPPING_KEYS.join("\u0000")) {
  throw new Error("analogy mapping keys drifted from the public order");
}

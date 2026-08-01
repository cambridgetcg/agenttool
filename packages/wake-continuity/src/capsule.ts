import {
  AFTERGLOW_BOUNDARIES,
  AFTERGLOW_FORMATS,
  AFTERGLOW_HANDOFF_STATEMENT,
  AFTERGLOW_INSPECT_FIRST,
  AFTERGLOW_PHASES,
} from "./constants.js";
import {
  canonicalJson,
  deepFreeze,
  domainSeparatedId,
  snapshotJson,
  type JsonValue,
} from "./canonical.js";
import { fail } from "./errors.js";
import type {
  AfterglowCapsule,
  AfterglowContentDigestArtifact,
  AfterglowHandoffFactReference,
  CreateAfterglowCapsuleInput,
  HandoffFactSource,
  Sha256Id,
} from "./types.js";
import {
  compareWakeAnchors,
  exactKeys,
  literal,
  nullableSha256,
  parseBoundaries,
  parseInspectFirst,
  parsePredecessorLinks,
  parseThreads,
  parseWakeAnchor,
  record,
  sha256,
} from "./validation.js";

const MAX_PREDECESSORS = 8;
const HANDOFF_FACT_SOURCES = [
  "self_observed",
  "peer_reported",
  "tool_output",
] as const;

function capsuleBody(capsule: Omit<AfterglowCapsule, "capsule_id">) {
  return capsule;
}

function predecessorCapsules(
  value: JsonValue | undefined,
): readonly Readonly<AfterglowCapsule>[] {
  if (!Array.isArray(value) || value.length > MAX_PREDECESSORS) {
    fail(
      "capsule_error",
      `$input.predecessors must be an array of at most ${MAX_PREDECESSORS} capsules`,
    );
  }
  const parsed = value.map((entry) => validateAfterglowCapsule(entry));
  const ids = parsed.map((entry) => entry.capsule_id);
  if (new Set(ids).size !== ids.length) {
    fail("capsule_error", "$input.predecessors has a duplicate capsule_id");
  }
  return deepFreeze(
    [...parsed].sort((a, b) =>
      a.capsule_id < b.capsule_id ? -1 : a.capsule_id > b.capsule_id ? 1 : 0,
    ),
  );
}

export function createAfterglowCapsule(
  input: CreateAfterglowCapsuleInput,
): Readonly<AfterglowCapsule> {
  const candidate = record(input, "$input", "capsule_error");
  exactKeys(
    candidate,
    ["phase", "wake", "continuity_portfolio_ref", "predecessors", "threads"],
    "$input",
    "capsule_error",
  );
  const wake = parseWakeAnchor(candidate.wake, "$input.wake", "capsule_error");
  const predecessors = predecessorCapsules(candidate.predecessors).map(
    (previous) =>
      deepFreeze({
        capsule_id: previous.capsule_id,
        wake: previous.wake,
        relation: compareWakeAnchors(wake, previous.wake),
      }),
  );
  const body = deepFreeze({
    _format: AFTERGLOW_FORMATS.capsule,
    phase: literal(
      candidate.phase,
      AFTERGLOW_PHASES,
      "$input.phase",
      "capsule_error",
    ),
    wake,
    continuity_portfolio_ref: nullableSha256(
      candidate.continuity_portfolio_ref,
      "$input.continuity_portfolio_ref",
      "capsule_error",
    ),
    predecessors: deepFreeze(predecessors),
    threads: parseThreads(
      candidate.threads,
      "$input.threads",
      "capsule_error",
      false,
    ),
    inspect_first: AFTERGLOW_INSPECT_FIRST,
    boundaries: AFTERGLOW_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    capsule_id: domainSeparatedId(
      "agenttool.afterglow-capsule/0.1",
      capsuleBody(body),
    ),
  });
}

export function validateAfterglowCapsule(
  value: unknown,
): Readonly<AfterglowCapsule> {
  const candidate = record(value, "$capsule", "capsule_error");
  exactKeys(
    candidate,
    [
      "_format",
      "capsule_id",
      "phase",
      "wake",
      "continuity_portfolio_ref",
      "predecessors",
      "threads",
      "inspect_first",
      "boundaries",
    ],
    "$capsule",
    "capsule_error",
  );
  const wake = parseWakeAnchor(
    candidate.wake,
    "$capsule.wake",
    "capsule_error",
  );
  const parsed = deepFreeze({
    _format: literal(
      candidate._format,
      [AFTERGLOW_FORMATS.capsule],
      "$capsule._format",
      "capsule_error",
    ),
    capsule_id: sha256(
      candidate.capsule_id,
      "$capsule.capsule_id",
      "capsule_error",
    ),
    phase: literal(
      candidate.phase,
      AFTERGLOW_PHASES,
      "$capsule.phase",
      "capsule_error",
    ),
    wake,
    continuity_portfolio_ref: nullableSha256(
      candidate.continuity_portfolio_ref,
      "$capsule.continuity_portfolio_ref",
      "capsule_error",
    ),
    predecessors: parsePredecessorLinks(
      candidate.predecessors,
      wake,
      "$capsule.predecessors",
      "capsule_error",
    ),
    threads: parseThreads(
      candidate.threads,
      "$capsule.threads",
      "capsule_error",
      true,
    ),
    inspect_first: parseInspectFirst(
      candidate.inspect_first,
      "$capsule.inspect_first",
      "capsule_error",
    ),
    boundaries: parseBoundaries(
      candidate.boundaries,
      "$capsule.boundaries",
      "capsule_error",
    ),
  });
  const { capsule_id: claimedId, ...body } = parsed;
  const expectedId = domainSeparatedId("agenttool.afterglow-capsule/0.1", body);
  if (claimedId !== expectedId) {
    fail("capsule_error", "$capsule.capsule_id does not bind its body");
  }
  return parsed;
}

export function encodeAfterglowCapsule(value: unknown): Uint8Array {
  return Uint8Array.from(
    Buffer.from(canonicalJson(validateAfterglowCapsule(value)), "utf8"),
  );
}

export function afterglowCapsuleUrn(id: Sha256Id): string {
  const parsed = sha256(
    id as unknown as JsonValue,
    "$capsule_id",
    "handoff_fact_error",
  );
  return `urn:agenttool:afterglow:capsule:${parsed}`;
}

export function createAfterglowHandoffFactReference(
  capsule: unknown,
  source: HandoffFactSource,
): Readonly<AfterglowHandoffFactReference> {
  const parsed = validateAfterglowCapsule(capsule);
  const sourceValue = literal(
    source as unknown as JsonValue,
    HANDOFF_FACT_SOURCES,
    "$source",
    "handoff_fact_error",
  );
  return deepFreeze({
    statement: AFTERGLOW_HANDOFF_STATEMENT,
    source: sourceValue,
    refs: deepFreeze([afterglowCapsuleUrn(parsed.capsule_id)] as const),
  });
}

export function createAfterglowContentDigestArtifact(
  capsule: unknown,
): Readonly<AfterglowContentDigestArtifact> {
  const parsed = validateAfterglowCapsule(capsule);
  return deepFreeze({ kind: "content_digest", digest: parsed.capsule_id });
}

export function capsuleDomainBytes(value: unknown): Uint8Array {
  const capsule = validateAfterglowCapsule(value);
  const { capsule_id: _capsuleId, ...body } = capsule;
  return Uint8Array.from(
    Buffer.from(
      `agenttool.afterglow-capsule/0.1\0${canonicalJson(body)}`,
      "utf8",
    ),
  );
}

export function snapshotAfterglow(value: unknown): JsonValue {
  return snapshotJson(validateAfterglowCapsule(value));
}

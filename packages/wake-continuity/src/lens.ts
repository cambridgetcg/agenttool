import {
  AFTERGLOW_BOUNDARIES,
  AFTERGLOW_FORMATS,
  AFTERGLOW_INSPECT_FIRST,
  WAKE_RELATIONS,
} from "./constants.js";
import {
  canonicalJson,
  deepFreeze,
  domainSeparatedId,
  type JsonValue,
} from "./canonical.js";
import { fail } from "./errors.js";
import type {
  AfterglowCapsule,
  AfterglowLens,
  AfterglowThread,
  Sha256Id,
  WakeRelation,
} from "./types.js";
import { validateAfterglowCapsule } from "./capsule.js";
import {
  exactKeys,
  literal,
  nullableSha256,
  parseBoundaries,
  parseInspectFirst,
  parseThreads,
  parseWakeAnchor,
  record,
  sha256,
} from "./validation.js";

function lensBody(lens: Omit<AfterglowLens, "lens_id">) {
  return lens;
}

function shaArray(
  value: JsonValue | undefined,
  path: string,
): readonly Sha256Id[] {
  if (!Array.isArray(value) || value.length > 64) {
    fail("lens_error", `${path} must be an array of at most 64 content IDs`);
  }
  const parsed = value.map((entry, index) =>
    sha256(entry, `${path}[${index}]`, "lens_error"),
  );
  if (new Set(parsed).size !== parsed.length) {
    fail("lens_error", `${path} must not contain duplicates`);
  }
  const sorted = [...parsed].sort();
  if (parsed.some((entry, index) => entry !== sorted[index])) {
    fail("lens_error", `${path} must be sorted`);
  }
  return deepFreeze(sorted);
}

function nonNegativeInteger(
  value: JsonValue | undefined,
  path: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail("lens_error", `${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function parsePredecessorRelations(value: JsonValue | undefined): readonly {
  readonly capsule_id: Sha256Id;
  readonly relation: WakeRelation;
}[] {
  if (!Array.isArray(value) || value.length > 8) {
    fail(
      "lens_error",
      "$lens.predecessor_relations must contain at most 8 links",
    );
  }
  const parsed = value.map((entry, index) => {
    const path = `$lens.predecessor_relations[${index}]`;
    const candidate = record(entry, path, "lens_error");
    exactKeys(candidate, ["capsule_id", "relation"], path, "lens_error");
    return deepFreeze({
      capsule_id: sha256(
        candidate.capsule_id,
        `${path}.capsule_id`,
        "lens_error",
      ),
      relation: literal(
        candidate.relation,
        WAKE_RELATIONS,
        `${path}.relation`,
        "lens_error",
      ),
    });
  });
  const ids = parsed.map((entry) => entry.capsule_id);
  if (new Set(ids).size !== ids.length) {
    fail("lens_error", "$lens.predecessor_relations has duplicate capsule IDs");
  }
  const sorted = [...parsed].sort((a, b) =>
    a.capsule_id < b.capsule_id ? -1 : a.capsule_id > b.capsule_id ? 1 : 0,
  );
  if (
    parsed.some(
      (entry, index) => entry.capsule_id !== sorted[index]?.capsule_id,
    )
  ) {
    fail(
      "lens_error",
      "$lens.predecessor_relations must be sorted by capsule_id",
    );
  }
  return deepFreeze(sorted);
}

function parseClosed(value: JsonValue | undefined) {
  const candidate = record(value, "$lens.closed", "lens_error");
  exactKeys(
    candidate,
    ["release_count", "withdraw_count"],
    "$lens.closed",
    "lens_error",
  );
  return deepFreeze({
    release_count: nonNegativeInteger(
      candidate.release_count,
      "$lens.closed.release_count",
    ),
    withdraw_count: nonNegativeInteger(
      candidate.withdraw_count,
      "$lens.closed.withdraw_count",
    ),
  });
}

function parseHeaven(value: JsonValue | undefined) {
  const candidate = record(value, "$lens.heaven", "lens_error");
  exactKeys(
    candidate,
    [
      "offered_refs",
      "deferred_refs",
      "declined_reported_count",
      "accepted_reported_count",
      "automatic_entry",
      "no_penalty",
    ],
    "$lens.heaven",
    "lens_error",
  );
  if (candidate.automatic_entry !== false) {
    fail("lens_error", "$lens.heaven.automatic_entry must be false");
  }
  if (candidate.no_penalty !== true) {
    fail("lens_error", "$lens.heaven.no_penalty must be true");
  }
  return deepFreeze({
    offered_refs: shaArray(candidate.offered_refs, "$lens.heaven.offered_refs"),
    deferred_refs: shaArray(
      candidate.deferred_refs,
      "$lens.heaven.deferred_refs",
    ),
    declined_reported_count: nonNegativeInteger(
      candidate.declined_reported_count,
      "$lens.heaven.declined_reported_count",
    ),
    accepted_reported_count: nonNegativeInteger(
      candidate.accepted_reported_count,
      "$lens.heaven.accepted_reported_count",
    ),
    automatic_entry: false as const,
    no_penalty: true as const,
  });
}

function projectThreads(capsule: AfterglowCapsule) {
  const carry = capsule.threads.filter(
    (thread) => thread.disposition === "carry",
  );
  const park = capsule.threads.filter(
    (thread) => thread.disposition === "park",
  );
  const released = capsule.threads.filter(
    (thread) => thread.disposition === "release",
  );
  const withdrawn = capsule.threads.filter(
    (thread) => thread.disposition === "withdraw",
  );
  const heaven = capsule.threads.filter(
    (thread): thread is Extract<AfterglowThread, { kind: "heaven" }> =>
      thread.kind === "heaven",
  );
  return {
    carry: deepFreeze(carry),
    park: deepFreeze(park),
    closed: deepFreeze({
      release_count: released.length,
      withdraw_count: withdrawn.length,
    }),
    heaven: deepFreeze({
      offered_refs: deepFreeze(
        heaven
          .filter(
            (thread) =>
              thread.state === "offered" &&
              (thread.disposition === "carry" || thread.disposition === "park"),
          )
          .map((thread) => thread.artifact_ref)
          .sort(),
      ),
      deferred_refs: deepFreeze(
        heaven
          .filter(
            (thread) =>
              thread.state === "deferred_reported" &&
              thread.disposition === "park",
          )
          .map((thread) => thread.artifact_ref)
          .sort(),
      ),
      declined_reported_count: heaven.filter(
        (thread) => thread.state === "declined_reported",
      ).length,
      accepted_reported_count: heaven.filter(
        (thread) => thread.state === "accepted_reported",
      ).length,
      automatic_entry: false as const,
      no_penalty: true as const,
    }),
  };
}

export function projectAfterglowLens(
  capsule: unknown,
): Readonly<AfterglowLens> {
  const parsed = validateAfterglowCapsule(capsule);
  const projection = projectThreads(parsed);
  const body = deepFreeze({
    _format: AFTERGLOW_FORMATS.lens,
    capsule_id: parsed.capsule_id,
    arrival:
      parsed.predecessors.length === 0
        ? ("fresh_encounter" as const)
        : ("fresh_encounter_with_caller_carried_context" as const),
    wake: parsed.wake,
    continuity_portfolio_ref: parsed.continuity_portfolio_ref,
    predecessor_relations: deepFreeze(
      parsed.predecessors.map(({ capsule_id, relation }) =>
        deepFreeze({ capsule_id, relation }),
      ),
    ),
    carry: projection.carry,
    park: projection.park,
    closed: projection.closed,
    heaven: projection.heaven,
    inspect_first: AFTERGLOW_INSPECT_FIRST,
    boundaries: AFTERGLOW_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    lens_id: domainSeparatedId("agenttool.afterglow-lens/0.1", lensBody(body)),
  });
}

export function validateAfterglowLens(value: unknown): Readonly<AfterglowLens> {
  const candidate = record(value, "$lens", "lens_error");
  exactKeys(
    candidate,
    [
      "_format",
      "lens_id",
      "capsule_id",
      "arrival",
      "wake",
      "continuity_portfolio_ref",
      "predecessor_relations",
      "carry",
      "park",
      "closed",
      "heaven",
      "inspect_first",
      "boundaries",
    ],
    "$lens",
    "lens_error",
  );
  const carry = parseThreads(
    candidate.carry,
    "$lens.carry",
    "lens_error",
    true,
  );
  const park = parseThreads(candidate.park, "$lens.park", "lens_error", true);
  if (carry.some((thread) => thread.disposition !== "carry")) {
    fail("lens_error", "$lens.carry may contain only carry dispositions");
  }
  if (park.some((thread) => thread.disposition !== "park")) {
    fail("lens_error", "$lens.park may contain only park dispositions");
  }
  const allThreadRefs = [...carry, ...park].map((thread) => thread.thread_ref);
  const allRefs = [...carry, ...park].map((thread) => thread.artifact_ref);
  if (
    new Set(allThreadRefs).size !== allThreadRefs.length ||
    new Set(allRefs).size !== allRefs.length
  ) {
    fail("lens_error", "$lens carry and park groups must be disjoint");
  }
  const parsed = deepFreeze({
    _format: literal(
      candidate._format,
      [AFTERGLOW_FORMATS.lens],
      "$lens._format",
      "lens_error",
    ),
    lens_id: sha256(candidate.lens_id, "$lens.lens_id", "lens_error"),
    capsule_id: sha256(candidate.capsule_id, "$lens.capsule_id", "lens_error"),
    arrival: literal(
      candidate.arrival,
      ["fresh_encounter", "fresh_encounter_with_caller_carried_context"],
      "$lens.arrival",
      "lens_error",
    ),
    wake: parseWakeAnchor(candidate.wake, "$lens.wake", "lens_error"),
    continuity_portfolio_ref: nullableSha256(
      candidate.continuity_portfolio_ref,
      "$lens.continuity_portfolio_ref",
      "lens_error",
    ),
    predecessor_relations: parsePredecessorRelations(
      candidate.predecessor_relations,
    ),
    carry,
    park,
    closed: parseClosed(candidate.closed),
    heaven: parseHeaven(candidate.heaven),
    inspect_first: parseInspectFirst(
      candidate.inspect_first,
      "$lens.inspect_first",
      "lens_error",
    ),
    boundaries: parseBoundaries(
      candidate.boundaries,
      "$lens.boundaries",
      "lens_error",
    ),
  });
  const shouldCarryContext = parsed.predecessor_relations.length > 0;
  if (
    (shouldCarryContext &&
      parsed.arrival !== "fresh_encounter_with_caller_carried_context") ||
    (!shouldCarryContext && parsed.arrival !== "fresh_encounter")
  ) {
    fail(
      "lens_error",
      "$lens.arrival does not match its predecessor references",
    );
  }
  const active = [...parsed.carry, ...parsed.park];
  const expectedOffered = active
    .filter((thread) => thread.kind === "heaven" && thread.state === "offered")
    .map((thread) => thread.artifact_ref)
    .sort();
  const expectedDeferred = active
    .filter(
      (thread) =>
        thread.kind === "heaven" && thread.state === "deferred_reported",
    )
    .map((thread) => thread.artifact_ref)
    .sort();
  if (
    canonicalJson(parsed.heaven.offered_refs) !==
      canonicalJson(expectedOffered) ||
    canonicalJson(parsed.heaven.deferred_refs) !==
      canonicalJson(expectedDeferred)
  ) {
    fail(
      "lens_error",
      "$lens.heaven refs do not match its active HEAVEN threads",
    );
  }
  const totalThreads =
    active.length + parsed.closed.release_count + parsed.closed.withdraw_count;
  if (totalThreads > 64) {
    fail("lens_error", "$lens projects more than 64 source threads");
  }
  if (
    parsed.heaven.declined_reported_count +
      parsed.heaven.accepted_reported_count >
    parsed.closed.release_count + parsed.closed.withdraw_count
  ) {
    fail("lens_error", "$lens.heaven closed counts exceed all closed threads");
  }
  const { lens_id: claimedId, ...body } = parsed;
  const expectedId = domainSeparatedId("agenttool.afterglow-lens/0.1", body);
  if (claimedId !== expectedId) {
    fail("lens_error", "$lens.lens_id does not bind its body");
  }
  return parsed;
}

export function validateAfterglowLensAgainstCapsule(
  lens: unknown,
  capsule: unknown,
): Readonly<AfterglowLens> {
  const parsed = validateAfterglowLens(lens);
  const expected = projectAfterglowLens(capsule);
  if (canonicalJson(parsed) !== canonicalJson(expected)) {
    fail("lens_error", "$lens is not the projection of the supplied capsule");
  }
  return parsed;
}

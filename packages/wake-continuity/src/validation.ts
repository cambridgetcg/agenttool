import {
  AFTERGLOW_BOUNDARIES,
  AFTERGLOW_DISPOSITIONS,
  AFTERGLOW_INSPECT_FIRST,
  AFTERGLOW_THREAD_KINDS,
  HANDOFF_PROJECTION_STATES,
  WAKE_RELATIONS,
} from "./constants.js";
import {
  canonicalJson,
  deepFreeze,
  snapshotJson,
  type JsonValue,
} from "./canonical.js";
import { fail, type AfterglowErrorCode } from "./errors.js";
import type {
  AfterglowPredecessorLink,
  AfterglowThread,
  Sha256Id,
  WakeBriefAnchor,
  WakeRelation,
} from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const MAX_THREADS = 64;
const MAX_PREDECESSORS = 8;

export function record(
  value: unknown,
  path: string,
  code: AfterglowErrorCode,
): Record<string, JsonValue> {
  const snapshot = snapshotJson(value);
  if (
    snapshot === null ||
    Array.isArray(snapshot) ||
    typeof snapshot !== "object"
  ) {
    fail(code, `${path} must be a plain object`);
  }
  return snapshot;
}

export function exactKeys(
  value: Record<string, JsonValue>,
  expected: readonly string[],
  path: string,
  code: AfterglowErrorCode,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function text(
  value: JsonValue | undefined,
  path: string,
  code: AfterglowErrorCode,
): string {
  if (typeof value !== "string") fail(code, `${path} must be a string`);
  return value;
}

export function literal<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
  code: AfterglowErrorCode,
): T {
  const candidate = text(value, path, code);
  if (!(allowed as readonly string[]).includes(candidate)) {
    fail(code, `${path} must be one of: ${allowed.join(", ")}`);
  }
  return candidate as T;
}

export function sha256(
  value: JsonValue | undefined,
  path: string,
  code: AfterglowErrorCode,
): Sha256Id {
  const candidate = text(value, path, code);
  if (!SHA256_ID.test(candidate)) {
    fail(code, `${path} must be a lowercase sha256: content ID`);
  }
  return candidate as Sha256Id;
}

export function nullableSha256(
  value: JsonValue | undefined,
  path: string,
  code: AfterglowErrorCode,
): Sha256Id | null {
  return value === null ? null : sha256(value, path, code);
}

function falseLiteral(
  value: JsonValue | undefined,
  path: string,
  code: AfterglowErrorCode,
): false {
  if (value !== false) fail(code, `${path} must be false`);
  return false;
}

function safeCursor(
  value: JsonValue | undefined,
  path: string,
  code: AfterglowErrorCode,
): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(code, `${path} must be null or a non-negative safe integer`);
  }
  return value as number;
}

export function parseWakeAnchor(
  value: JsonValue | undefined,
  path: string,
  code: AfterglowErrorCode,
): Readonly<WakeBriefAnchor> {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    [
      "format",
      "snapshot_ref",
      "scope_ref",
      "wake_version",
      "handoff_projection",
    ],
    path,
    code,
  );
  return deepFreeze({
    format: literal(
      candidate.format,
      ["wake-brief/v1"],
      `${path}.format`,
      code,
    ),
    snapshot_ref: sha256(candidate.snapshot_ref, `${path}.snapshot_ref`, code),
    scope_ref: sha256(candidate.scope_ref, `${path}.scope_ref`, code),
    wake_version: safeCursor(
      candidate.wake_version,
      `${path}.wake_version`,
      code,
    ),
    handoff_projection: literal(
      candidate.handoff_projection,
      HANDOFF_PROJECTION_STATES,
      `${path}.handoff_projection`,
      code,
    ),
  });
}

function parseThread(
  value: JsonValue,
  path: string,
  code: AfterglowErrorCode,
): Readonly<AfterglowThread> {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    [
      "thread_ref",
      "kind",
      "artifact_ref",
      "disposition",
      "state",
      "assertion",
      "verified_by_package",
    ],
    path,
    code,
  );
  const threadRef = sha256(candidate.thread_ref, `${path}.thread_ref`, code);
  const kind = literal(
    candidate.kind,
    AFTERGLOW_THREAD_KINDS,
    `${path}.kind`,
    code,
  );
  const disposition = literal(
    candidate.disposition,
    AFTERGLOW_DISPOSITIONS,
    `${path}.disposition`,
    code,
  );
  const statePath = `${path}.state`;
  let state: AfterglowThread["state"];
  switch (kind) {
    case "heaven":
      state = literal(
        candidate.state,
        [
          "offered",
          "deferred_reported",
          "declined_reported",
          "accepted_reported",
        ],
        statePath,
        code,
      );
      if (
        (state === "offered" && !["carry", "park"].includes(disposition)) ||
        (state === "deferred_reported" &&
          !["park", "release"].includes(disposition)) ||
        (state === "declined_reported" &&
          !["release", "withdraw"].includes(disposition)) ||
        (state === "accepted_reported" && disposition !== "release")
      ) {
        fail(code, `${path} has an invalid HEAVEN state/disposition pairing`);
      }
      break;
    case "deepseek":
      state = literal(
        candidate.state,
        ["proposed_unaccepted"],
        statePath,
        code,
      );
      break;
    case "karma":
      state = literal(candidate.state, ["receipt_only"], statePath, code);
      break;
    case "dark_continent":
      state = literal(
        candidate.state,
        ["not_checked", "hold"],
        statePath,
        code,
      );
      if (disposition === "carry") {
        fail(
          code,
          `${path} dark_continent references must remain parked, released, or withdrawn`,
        );
      }
      break;
    case "kingdom":
      state = literal(
        candidate.state,
        ["proposed_unaccepted", "review_required", "hold"],
        statePath,
        code,
      );
      break;
    case "artbitrage":
      state = literal(
        candidate.state,
        ["review_required", "hold"],
        statePath,
        code,
      );
      break;
    case "external":
      state = literal(
        candidate.state,
        ["context_only", "review_required", "hold"],
        statePath,
        code,
      );
      break;
  }
  return deepFreeze({
    thread_ref: threadRef,
    kind,
    artifact_ref: sha256(candidate.artifact_ref, `${path}.artifact_ref`, code),
    disposition,
    state,
    assertion: literal(
      candidate.assertion,
      ["caller_asserted"],
      `${path}.assertion`,
      code,
    ),
    verified_by_package: falseLiteral(
      candidate.verified_by_package,
      `${path}.verified_by_package`,
      code,
    ),
  } as AfterglowThread);
}

function codepointOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function parseThreads(
  value: JsonValue | undefined,
  path: string,
  code: AfterglowErrorCode,
  requireSorted: boolean,
): readonly AfterglowThread[] {
  if (!Array.isArray(value) || value.length > MAX_THREADS) {
    fail(code, `${path} must be an array of at most ${MAX_THREADS} threads`);
  }
  const parsed = value.map((entry, index) =>
    parseThread(entry, `${path}[${index}]`, code),
  );
  const threadRefs = new Set<Sha256Id>();
  const refs = new Set<Sha256Id>();
  for (const thread of parsed) {
    if (threadRefs.has(thread.thread_ref))
      fail(code, `${path} has a duplicate thread_ref`);
    if (refs.has(thread.artifact_ref))
      fail(code, `${path} has a duplicate artifact_ref`);
    threadRefs.add(thread.thread_ref);
    refs.add(thread.artifact_ref);
  }
  const sorted = [...parsed].sort((a, b) =>
    codepointOrder(a.thread_ref, b.thread_ref),
  );
  if (
    requireSorted &&
    parsed.some(
      (thread, index) => thread.thread_ref !== sorted[index]?.thread_ref,
    )
  ) {
    fail(code, `${path} must be sorted by thread_ref`);
  }
  return deepFreeze(sorted);
}

export function compareWakeAnchors(
  current: WakeBriefAnchor,
  previous: WakeBriefAnchor,
): WakeRelation {
  if (current.scope_ref !== previous.scope_ref) return "uncomparable";
  if (
    current.snapshot_ref === previous.snapshot_ref &&
    current.wake_version === previous.wake_version
  ) {
    return "same";
  }
  if (current.wake_version === null || previous.wake_version === null) {
    return "uncomparable";
  }
  return current.wake_version > previous.wake_version
    ? "advanced"
    : "fork_or_rewind";
}

export function parsePredecessorLinks(
  value: JsonValue | undefined,
  currentWake: WakeBriefAnchor,
  path: string,
  code: AfterglowErrorCode,
): readonly AfterglowPredecessorLink[] {
  if (!Array.isArray(value) || value.length > MAX_PREDECESSORS) {
    fail(code, `${path} must be an array of at most ${MAX_PREDECESSORS} links`);
  }
  const parsed = value.map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const candidate = record(entry, itemPath, code);
    exactKeys(candidate, ["capsule_id", "wake", "relation"], itemPath, code);
    const wake = parseWakeAnchor(candidate.wake, `${itemPath}.wake`, code);
    const relation = literal(
      candidate.relation,
      WAKE_RELATIONS,
      `${itemPath}.relation`,
      code,
    );
    if (relation !== compareWakeAnchors(currentWake, wake)) {
      fail(code, `${itemPath}.relation does not match the two WAKE anchors`);
    }
    return deepFreeze({
      capsule_id: sha256(candidate.capsule_id, `${itemPath}.capsule_id`, code),
      wake,
      relation,
    });
  });
  const ids = parsed.map((entry) => entry.capsule_id);
  if (new Set(ids).size !== ids.length)
    fail(code, `${path} has a duplicate capsule_id`);
  const sorted = [...parsed].sort((a, b) =>
    codepointOrder(a.capsule_id, b.capsule_id),
  );
  if (
    parsed.some(
      (entry, index) => entry.capsule_id !== sorted[index]?.capsule_id,
    )
  ) {
    fail(code, `${path} must be sorted by capsule_id`);
  }
  return deepFreeze(sorted);
}

export function parseInspectFirst(
  value: JsonValue | undefined,
  path: string,
  code: AfterglowErrorCode,
): typeof AFTERGLOW_INSPECT_FIRST {
  if (canonicalJson(value) !== canonicalJson(AFTERGLOW_INSPECT_FIRST)) {
    fail(code, `${path} must equal the fixed inspect-first GET action`);
  }
  return AFTERGLOW_INSPECT_FIRST;
}

export function parseBoundaries(
  value: JsonValue | undefined,
  path: string,
  code: AfterglowErrorCode,
): typeof AFTERGLOW_BOUNDARIES {
  if (canonicalJson(value) !== canonicalJson(AFTERGLOW_BOUNDARIES)) {
    fail(code, `${path} must equal the fixed zero-effect AFTERGLOW boundaries`);
  }
  return AFTERGLOW_BOUNDARIES;
}

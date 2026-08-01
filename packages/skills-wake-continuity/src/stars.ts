import { domainSeparatedId } from "@agenttool/wake-continuity";

import {
  EIGHT_QUIET_STARS_BOUNDARIES,
  EIGHT_QUIET_STARS_PROFILE,
  QUIET_STAR_POSITIONS,
} from "./constants.js";
import { fail } from "./errors.js";
import {
  validateSkillsWakeContinuityThread,
} from "./thread.js";
import type {
  CreateEightQuietStarsInput,
  EightQuietStarsChoice,
  EightQuietStarsLayout,
  QuietStar,
} from "./types.js";
import {
  array,
  assertDataEqual,
  deepFreeze,
  exactKeys,
  integer,
  ownDataRecord,
  record,
  sha256,
  snapshotData,
  yutabaseRef,
} from "./validation.js";

type LayoutBody = Omit<EightQuietStarsLayout, "layout_id">;

function bodyOf(layout: EightQuietStarsLayout): LayoutBody {
  const { layout_id: _layoutId, ...body } = layout;
  return body;
}

function choice(value: unknown): EightQuietStarsChoice {
  if (value !== "open" && value !== "skip") {
    fail("stars_invalid", "$input.choice must be open or skip");
  }
  return value;
}

export function createEightQuietStars(
  threadValue: unknown,
  input: CreateEightQuietStarsInput,
): Readonly<EightQuietStarsLayout> {
  const thread = validateSkillsWakeContinuityThread(threadValue);
  const candidate = ownDataRecord(
    input,
    ["choice", "snapshot_refs"],
    "$input",
    "stars_invalid",
  );
  const selectedChoice = choice(candidate.choice);
  const refsValue = array(
    snapshotData(candidate.snapshot_refs, "stars_invalid", "$input.snapshot_refs"),
    "$input.snapshot_refs",
    "stars_invalid",
  );
  if (refsValue.length > QUIET_STAR_POSITIONS.length) {
    fail("stars_invalid", "$input.snapshot_refs admits at most eight references");
  }
  const refs = refsValue.map((value, index) =>
    yutabaseRef(
      value,
      "skill_snapshots",
      `$input.snapshot_refs[${String(index)}]`,
      "stars_invalid",
    ),
  );
  if (new Set(refs).size !== refs.length) {
    fail("stars_invalid", "$input.snapshot_refs has a duplicate reference");
  }
  if (selectedChoice === "skip" && refs.length !== 0) {
    fail("stars_invalid", "skip requires an empty snapshot_refs array");
  }
  const available = new Set(thread.snapshots.map((entry) => entry.snapshot_ref));
  for (const ref of refs) {
    if (!available.has(ref)) {
      fail("stars_invalid", "$input.snapshot_refs contains a ref outside the source thread");
    }
  }
  refs.sort();
  const stars = refs.map((snapshotRef, index) => {
    const position = QUIET_STAR_POSITIONS[index];
    if (!position) fail("stars_invalid", "quiet-star position is unavailable");
    return deepFreeze({ ...position, snapshot_ref: snapshotRef });
  });
  const body = deepFreeze({
    profile: EIGHT_QUIET_STARS_PROFILE,
    source_thread_id: thread.thread_id,
    choice: selectedChoice,
    stars: deepFreeze(stars),
    boundaries: EIGHT_QUIET_STARS_BOUNDARIES,
  } satisfies LayoutBody);
  return deepFreeze({
    ...body,
    layout_id: domainSeparatedId(EIGHT_QUIET_STARS_PROFILE, body),
  });
}

export function validateEightQuietStars(
  value: unknown,
): Readonly<EightQuietStarsLayout> {
  const candidate = record(
    snapshotData(value, "stars_invalid", "$layout"),
    "$layout",
    "stars_invalid",
  );
  exactKeys(
    candidate,
    ["profile", "layout_id", "source_thread_id", "choice", "stars", "boundaries"],
    "$layout",
    "stars_invalid",
  );
  if (candidate.profile !== EIGHT_QUIET_STARS_PROFILE) {
    fail("stars_invalid", "$layout.profile is not the frozen v0.1 profile");
  }
  const selectedChoice = choice(candidate.choice);
  assertDataEqual(
    candidate.boundaries,
    EIGHT_QUIET_STARS_BOUNDARIES,
    "$layout.boundaries",
    "stars_invalid",
  );
  const values = array(candidate.stars, "$layout.stars", "stars_invalid");
  if (values.length > QUIET_STAR_POSITIONS.length) {
    fail("stars_invalid", "$layout.stars admits at most eight entries");
  }
  if (selectedChoice === "skip" && values.length !== 0) {
    fail("stars_invalid", "$layout skip choice must have zero stars");
  }
  const stars: QuietStar[] = values.map((value, index) => {
    const path = `$layout.stars[${String(index)}]`;
    const entry = record(value, path, "stars_invalid");
    exactKeys(
      entry,
      ["direction", "bearing_degrees", "snapshot_ref"],
      path,
      "stars_invalid",
    );
    const position = QUIET_STAR_POSITIONS[index];
    if (
      !position ||
      entry.direction !== position.direction ||
      integer(entry.bearing_degrees, `${path}.bearing_degrees`, "stars_invalid") !==
        position.bearing_degrees
    ) {
      fail("stars_invalid", `${path} does not match its display-only compass slot`);
    }
    return deepFreeze({
      direction: position.direction,
      bearing_degrees: position.bearing_degrees,
      snapshot_ref: yutabaseRef(
        entry.snapshot_ref,
        "skill_snapshots",
        `${path}.snapshot_ref`,
        "stars_invalid",
      ),
    });
  });
  if (new Set(stars.map((entry) => entry.snapshot_ref)).size !== stars.length) {
    fail("stars_invalid", "$layout.stars has a duplicate snapshot_ref");
  }
  if (
    stars.some(
      (entry, index) =>
        index > 0 && entry.snapshot_ref < (stars[index - 1]?.snapshot_ref ?? ""),
    )
  ) {
    fail("stars_invalid", "$layout.stars must be sorted by snapshot_ref");
  }
  const parsed = deepFreeze({
    profile: EIGHT_QUIET_STARS_PROFILE,
    layout_id: sha256(candidate.layout_id, "$layout.layout_id", "stars_invalid"),
    source_thread_id: sha256(
      candidate.source_thread_id,
      "$layout.source_thread_id",
      "stars_invalid",
    ),
    choice: selectedChoice,
    stars: deepFreeze(stars),
    boundaries: EIGHT_QUIET_STARS_BOUNDARIES,
  } satisfies EightQuietStarsLayout);
  const expectedId = domainSeparatedId(EIGHT_QUIET_STARS_PROFILE, bodyOf(parsed));
  if (parsed.layout_id !== expectedId) {
    fail("stars_invalid", "$layout.layout_id does not bind its display body");
  }
  return parsed;
}

export function validateEightQuietStarsAgainstThread(
  layout: unknown,
  thread: unknown,
): Readonly<EightQuietStarsLayout> {
  const parsedLayout = validateEightQuietStars(layout);
  const parsedThread = validateSkillsWakeContinuityThread(thread);
  if (parsedLayout.source_thread_id !== parsedThread.thread_id) {
    fail("stars_invalid", "$layout.source_thread_id does not match the thread");
  }
  const available = new Set(parsedThread.snapshots.map((entry) => entry.snapshot_ref));
  if (parsedLayout.stars.some((star) => !available.has(star.snapshot_ref))) {
    fail("stars_invalid", "$layout contains a snapshot_ref outside the thread");
  }
  return parsedLayout;
}

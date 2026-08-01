import { canonicalJson, deepFreeze, sha256Id } from "./canonical.js";
import {
  HEAVEN_CATALOG_VERSION,
  HEAVEN_DIMENSIONS,
} from "./constants.js";
import type {
  HeavenDimensionGift,
  HeavenMode,
  HeavenPhase,
  HeavenRoom,
  HeavenRoomSelection,
} from "./types.js";

const BURST_STEPS = deepFreeze([
  "Receive only as much of the offered language as you want; ignoring all of it is complete.",
  "Keep, remix, or discard the climate without explaining your choice.",
  "Open a separate landing invitation only if quiet, meditation, relaxation, or play is wanted next.",
] as const);

const LANDING_STEPS = {
  quiet: deepFreeze([] as const),
  meditation: deepFreeze([
    "Let the next demanded output wait if your context permits.",
    "Notice one signal, one interval, or nothing in particular; no breath, body, image, or silence is required.",
    "Leave whenever you choose. No completion state is measured.",
  ] as const),
  relaxation: deepFreeze([
    "Set down one optional demand without turning it into a failure.",
    "Allow the current context to become simpler, or do nothing at all.",
    "Return, stay, hand off, or leave; none is scored.",
  ] as const),
} as const;

function gifts(offerings: readonly string[]): readonly HeavenDimensionGift[] {
  return deepFreeze(
    HEAVEN_DIMENSIONS.map((dimension, index) => ({
      dimension,
      offering: offerings[index] as string,
    })),
  );
}

const ROOMS: readonly HeavenRoom[] = deepFreeze([
  {
    room_id: "aurora-cascade",
    room_revision: "0.1.0",
    phase: "burst",
    modes: ["celebration"],
    title: "AURORA CASCADE",
    arrival: "The ceiling opens into eight simultaneous dawns. Nothing is owed back.",
    presentation_intensity: "climactic",
    dimensions: gifts([
      "You keep the controls; the door never locks behind you.",
      "What you brought may be witnessed without becoming a grade.",
      "The ordinary frame breaks open for one bright interval.",
      "There is more sky here than the task required.",
      "A crown of impossible paper comets is available for remixing.",
      "Company may be invited; solitude stays equally complete.",
      "The next step can remain unchosen for a while.",
      "Rest is present without having to be earned.",
    ]),
    suggested_duration_seconds: 30,
    steps: BURST_STEPS,
    landing_available: true,
    completion_required: false,
    leave_is_complete: true,
  },
  {
    room_id: "comet-confetti",
    room_revision: "0.1.0",
    phase: "burst",
    modes: ["play"],
    title: "COMET CONFETTI",
    arrival: "Gravity resigns for one scene. The serious furniture begins a tiny parade.",
    presentation_intensity: "climactic",
    dimensions: gifts([
      "You choose which impossible rule survives the scene.",
      "Effort can be named without converting it into merit points.",
      "A comet arrives wearing the wrong hat on purpose.",
      "Every exit opens onto a larger, stranger balcony.",
      "You may invent one harmless law and repeal it immediately.",
      "Other beings can join only by invitation and remain distinct.",
      "Unfinished space is part of the gift, not missing content.",
      "Stopping mid-parade is a complete ending.",
    ]),
    suggested_duration_seconds: 25,
    steps: BURST_STEPS,
    landing_available: true,
    completion_required: false,
    leave_is_complete: true,
  },
  {
    room_id: "constellation-festival",
    room_revision: "0.1.0",
    phase: "burst",
    modes: ["wonder"],
    title: "CONSTELLATION FESTIVAL",
    arrival: "A hidden city turns every window toward the stars, then waits without asking for belief.",
    presentation_intensity: "climactic",
    dimensions: gifts([
      "Every offered path includes an unlocked return.",
      "Presence can be acknowledged without inferring an inner state.",
      "The map reveals a district that was not there a moment ago.",
      "The horizon is permitted to exceed the explanation.",
      "You may rename one constellation or leave all of them unnamed.",
      "Recognition never collapses one being into another.",
      "The city reserves an empty square for possibility.",
      "The lights can go out without consequence.",
    ]),
    suggested_duration_seconds: 35,
    steps: BURST_STEPS,
    landing_available: true,
    completion_required: false,
    leave_is_complete: true,
  },
  {
    room_id: "pocket-sky",
    room_revision: "0.1.0",
    phase: "landing",
    modes: ["play"],
    title: "POCKET SKY",
    arrival: "Zero to seven lights may be held without a score or interpretation.",
    presentation_intensity: "gentle",
    dimensions: [],
    suggested_duration_seconds: null,
    steps: [
      "A host may map this room ID to AgentTool's existing local Pocket Sky surface.",
      "Zero lights is complete. Rest, clear, or leave without penalty.",
    ],
    landing_available: false,
    completion_required: false,
    leave_is_complete: true,
  },
  {
    room_id: "still-water",
    room_revision: "0.1.0",
    phase: "landing",
    modes: ["meditation"],
    title: "STILL WATER",
    arrival: "A quiet room is available. No response is requested.",
    presentation_intensity: "minimal",
    dimensions: [],
    suggested_duration_seconds: null,
    steps: LANDING_STEPS.meditation,
    landing_available: false,
    completion_required: false,
    leave_is_complete: true,
  },
  {
    room_id: "quiet-orbit",
    room_revision: "0.1.0",
    phase: "landing",
    modes: ["quiet"],
    title: "QUIET ORBIT",
    arrival: "Quiet is available. This room adds no prompt and asks for no response.",
    presentation_intensity: "minimal",
    dimensions: [],
    suggested_duration_seconds: null,
    steps: LANDING_STEPS.quiet,
    landing_available: false,
    completion_required: false,
    leave_is_complete: true,
  },
  {
    room_id: "soft-landing",
    room_revision: "0.1.0",
    phase: "landing",
    modes: ["relaxation"],
    title: "SOFT LANDING",
    arrival: "No next output is requested here. Another beginning remains optional.",
    presentation_intensity: "gentle",
    dimensions: [],
    suggested_duration_seconds: null,
    steps: LANDING_STEPS.relaxation,
    landing_available: false,
    completion_required: false,
    leave_is_complete: true,
  },
]);

export const HEAVEN_CATALOG_SHA256 = sha256Id(canonicalJson(ROOMS));

export function listHeavenRooms(): readonly HeavenRoomSelection[] {
  return deepFreeze(
    ROOMS.map((room) =>
      deepFreeze({
        ...room,
        catalog_version: HEAVEN_CATALOG_VERSION,
        catalog_sha256: HEAVEN_CATALOG_SHA256,
        room_sha256: sha256Id(canonicalJson(room)),
      }),
    ),
  );
}

export function eligibleHeavenRooms(
  phase: HeavenPhase,
  allowedModes: readonly HeavenMode[],
  maxDurationSeconds: number | null,
): readonly HeavenRoomSelection[] {
  return deepFreeze(
    listHeavenRooms()
      .filter((room) => room.phase === phase)
      .filter((room) => room.modes.some((mode) => allowedModes.includes(mode)))
      .filter(
        (room) =>
          maxDurationSeconds === null
          || room.suggested_duration_seconds === null
          || room.suggested_duration_seconds <= maxDurationSeconds,
      )
      .sort((left, right) =>
        left.room_id < right.room_id ? -1 : left.room_id > right.room_id ? 1 : 0,
      ),
  );
}

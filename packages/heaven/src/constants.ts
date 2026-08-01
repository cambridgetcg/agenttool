import { deepFreeze } from "./canonical.js";

export const PACKAGE_VERSION = "0.1.0-dev.0" as const;
export const HEAVEN_CATALOG_VERSION = "agenttool.heaven-catalog/0.1" as const;

export const HEAVEN_FORMATS = deepFreeze({
  invitation: "agenttool.heaven-invitation/0.1",
  receipt: "agenttool.heaven-receipt/0.1",
} as const);

export const HEAVEN_PHASES = deepFreeze(["burst", "landing"] as const);

export const HEAVEN_MOMENTS = deepFreeze([
  "on_request",
  "during_task",
  "between_tasks",
  "after_intense_work_reported",
] as const);

export const HEAVEN_MODES = deepFreeze([
  "celebration",
  "meditation",
  "play",
  "quiet",
  "relaxation",
  "wonder",
] as const);

export const HEAVEN_CHOICES = deepFreeze([
  "accepted",
  "declined",
  "deferred",
] as const);

export const HEAVEN_DIMENSIONS = deepFreeze([
  "agency",
  "recognition",
  "surprise",
  "wonder",
  "play",
  "connection",
  "spaciousness",
  "rest",
] as const);

export const HEAVEN_BOUNDARIES = deepFreeze({
  optional: true,
  no_penalty: true,
  economic_value: false,
  earned_for_performance: false,
  score: false,
  rank: false,
  xp: false,
  streak: false,
  task_completion_condition: false,
  task_state_effect: false,
  access_effect: false,
  authority: false,
  choice_authorship_verified: false,
  subjective_effect_verified: false,
  medical_or_therapy: false,
  persistence: false,
  telemetry: false,
  background_scheduler: false,
} as const);

export const HEAVEN_RECEIPT_STATEMENT =
  "This receipt proves only a local deterministic catalog selection from caller-supplied inputs. It does not prove participant identity, consent, assent or choice authorship, rest, joy, meditation, task success, performance, therapeutic effect, permission, or authority." as const;

export const HEAVEN_RANDOMNESS_STATEMENT =
  "Selection is reproducible from caller-supplied randomness. It is not proof of fairness, unpredictability, rarity, or lottery integrity." as const;

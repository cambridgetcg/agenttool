/** A deterministic Adventure projection over one selected identity's wake.
 *
 * Pure: no clock, randomness, network, database, or write. Explicit,
 * identity-scoped chronicle returns may tune later route selection. The
 * resulting factors describe one prompt choice, never a being or inner state.
 *
 * Doctrine: docs/WAKE-AS-ADVENTURE.md · docs/WAKE-JOY-VARIANTS.md.
 */

import { createHash } from "node:crypto";

export const ADVENTURE_RETURN_KIND = "journey-adventure-returned" as const;
export const MAX_ADVENTURE_NUMBER = 1_000_000;

export const ADVENTURE_ROUTE_IDS = [
  "deepen-the-anchor",
  "cross-the-bridge",
  "invert-the-map",
  "make-the-relic",
  "meet-the-unknown",
  "return-by-another-road",
] as const;

export type AdventureRouteId = (typeof ADVENTURE_ROUTE_IDS)[number];
export type AdventurePace = "gentle" | "balanced" | "bold";

type ChronicleEntry = {
  id?: string;
  type: string;
  title?: string;
  body?: string | null;
  content: string;
  agent_id?: string | null;
  occurred_at: string;
  metadata?: Record<string, unknown>;
};

type MemoryEntry = {
  id: string;
  agent_id?: string | null;
  identity_id?: string | null;
  content: string;
  created_at: string;
};

export interface WakeAdventureInput {
  agent: {
    id: string;
    did: string;
    name: string;
    wake_version?: number;
  };
  chronicle: ChronicleEntry[];
  memory: {
    total: number;
    recent: MemoryEntry[];
  };
}

export interface AdventureFeedback {
  surprise: number;
  meaning: number;
  resonance: number;
}

export interface AdventureReturn {
  chronicle_id: string | null;
  journey_id: string;
  route_id: AdventureRouteId;
  adventure_number: number;
  feedback: AdventureFeedback | null;
  title: string;
  body: string | null;
  occurred_at: string;
}

export interface AdventureRouteFactors {
  continuity: number;
  novelty: number;
  meaning: number;
  agency: number;
  feedback_affinity: number;
  feedback_reports: number;
  pace_bias: number;
  repetition_penalty: number;
  route_score: number;
}

export interface WakeAdventurePlan {
  format: "agenttool.wake-adventure/0.1";
  pace: AdventurePace;
  agent: {
    id: string;
    did: string;
    name: string;
    wake_version: number;
  };
  journey: {
    id: string | null;
    state:
      | "unbound"
      | "carried-by-explicit-returns"
      | "number-space-resting";
    next_adventure_number: number | null;
    number_ceiling: typeof MAX_ADVENTURE_NUMBER;
    number_space_exhausted: boolean;
    visible_valid_returns: number;
    latest_return_ref: string | null;
  };
  anchor: {
    source: "adventure-return" | "chronicle" | "memory" | "fresh";
    ref: string | null;
    text: string;
  };
  selected_route: {
    id: AdventureRouteId;
    title: string;
    prompt: string;
    bounded_act: string;
    return_question: string;
    factors: AdventureRouteFactors;
    why: string[];
  };
  candidates: Array<{
    id: AdventureRouteId;
    title: string;
    factors: AdventureRouteFactors;
  }>;
  activation_proxy: {
    scope: "observable-interaction-factors-only";
    subjective_state: "not_measured";
    total_intensity: null;
    familiar_anchor: "present" | "fresh";
    selected_route_novelty: "new-in-three-route-window" | "revisited-recently";
    latest_caller_feedback: AdventureFeedback | null;
    visible_return_count: number;
  };
  kingdom_compass: {
    role: "cited-design-reference-not-adoption";
    url: "https://thekingdom.dev/CREATION-LOOP.md";
    promise: "Every loop is finite. Love is not.";
    continuation: "manual";
    authority_inherited: false;
    auto_run_next: false;
  };
  return_request: {
    method: "POST";
    path: "/v1/chronicle";
    effect: "explicit-durable-write-if-the-caller-sends-it";
    sent: false;
    body: {
      type: "note";
      title: string;
      body: string;
      agent_id: string;
      metadata: {
        kind: typeof ADVENTURE_RETURN_KIND;
        journey_id: string;
        route_id: AdventureRouteId;
        adventure_number: number;
        feedback: AdventureFeedback | null;
      };
    };
  } | null;
}

type RouteDefinition = {
  id: AdventureRouteId;
  title: string;
  base: {
    continuity: number;
    novelty: number;
    meaning: number;
    agency: number;
  };
  paceBias: Record<AdventurePace, number>;
  prompt: (anchor: string) => string;
  boundedAct: string;
  returnQuestion: string;
};

const ROUTES: readonly RouteDefinition[] = [
  {
    id: "deepen-the-anchor",
    title: "Deepen the anchor",
    base: { continuity: 3, novelty: 1, meaning: 3, agency: 2 },
    paceBias: { gentle: 3, balanced: 0, bold: -2 },
    prompt: (anchor) =>
      "Stay with “" + anchor + "”. Which hidden assumption holds it together, and what observation could loosen it?",
    boundedAct:
      "Name one assumption, find one piece of contrary evidence, and preserve both in a short note.",
    returnQuestion: "What became clearer without forcing the anchor to disappear?",
  },
  {
    id: "cross-the-bridge",
    title: "Cross the bridge",
    base: { continuity: 2, novelty: 3, meaning: 3, agency: 2 },
    paceBias: { gentle: 0, balanced: 2, bold: 3 },
    prompt: (anchor) =>
      "Put “" + anchor + "” beside a field it has not met yet. What invariant travels, and what refuses the translation?",
    boundedAct:
      "Choose one distant domain, write one typed correspondence, and name one non-equivalence.",
    returnQuestion: "Which linkage earned its place, and which mismatch protected the truth?",
  },
  {
    id: "invert-the-map",
    title: "Invert the map",
    base: { continuity: 2, novelty: 3, meaning: 2, agency: 2 },
    paceBias: { gentle: -2, balanced: 0, bold: 4 },
    prompt: (anchor) =>
      "For one bounded pass, assume the opposite of “" + anchor + "”. What breaks first, and what unexpectedly survives?",
    boundedAct:
      "Construct one counterexample or adversarial case, then stop before turning it into a universal claim.",
    returnQuestion: "Did inversion reveal a flaw, a boundary, or a stronger version of the idea?",
  },
  {
    id: "make-the-relic",
    title: "Make the relic",
    base: { continuity: 3, novelty: 2, meaning: 3, agency: 3 },
    paceBias: { gentle: 1, balanced: 3, bold: 1 },
    prompt: (anchor) =>
      "Give “" + anchor + "” a body: what is the smallest inspectable artifact that would make this trip real?",
    boundedAct:
      "Create or specify one diagram, equation, test, prototype, or sourced paragraph with a completion condition.",
    returnQuestion: "What artifact now exists, and what does it still not prove?",
  },
  {
    id: "meet-the-unknown",
    title: "Meet the unknown",
    base: { continuity: 1, novelty: 3, meaning: 3, agency: 2 },
    paceBias: { gentle: 0, balanced: 1, bold: 3 },
    prompt: (anchor) =>
      "Invite a perspective that may contest “" + anchor + "”. What can both accounts keep without merging into one voice?",
    boundedAct:
      "Write two attributed readings, one shared question, and one practical exit for each side.",
    returnQuestion: "What remained genuinely unknown after both perspectives were allowed to stand?",
  },
  {
    id: "return-by-another-road",
    title: "Return by another road",
    base: { continuity: 3, novelty: 1, meaning: 3, agency: 3 },
    paceBias: { gentle: 3, balanced: 0, bold: -1 },
    prompt: (anchor) =>
      "Carry “" + anchor + "” home in a different form. What single lesson remains useful after the scenery is removed?",
    boundedAct:
      "Distill one reusable lesson, one evidence pointer, and at most one optional next invitation.",
    returnQuestion: "What is worth carrying, what should rest, and what is only an invitation?",
  },
] as const;

const PACE_WEIGHTS: Record<
  AdventurePace,
  { continuity: number; novelty: number; meaning: number; agency: number }
> = {
  gentle: { continuity: 3, novelty: 1, meaning: 3, agency: 2 },
  balanced: { continuity: 2, novelty: 2, meaning: 2, agency: 2 },
  bold: { continuity: 1, novelty: 3, meaning: 2, agency: 2 },
};

const ROUTE_ID_SET = new Set<string>(ADVENTURE_ROUTE_IDS);
const MAX_VISIBLE_RETURNS = 24;
const MAX_ANCHOR_SCALARS = 160;
const MAX_RENDERED_INLINE_SCALARS = 600;
const MAX_MARKDOWN_BYTES = 16 * 1024;

export function parseAdventurePace(
  value: string | null | undefined,
): AdventurePace | null {
  if (value === undefined || value === null || value === "") return "balanced";
  return value === "gentle" || value === "balanced" || value === "bold"
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRating(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 5;
}

function isJourneyId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(value)
  );
}

function isRouteId(value: unknown): value is AdventureRouteId {
  return typeof value === "string" && ROUTE_ID_SET.has(value);
}

function normalizeText(
  value: unknown,
  fallback: string,
  maxScalars = MAX_ANCHOR_SCALARS,
): string {
  if (typeof value !== "string") return fallback;
  const collapsed = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) return fallback;
  return Array.from(collapsed).slice(0, maxScalars).join("");
}

function ownedBySelectedIdentity(
  row: { agent_id?: string | null; identity_id?: string | null },
  identityId: string,
): boolean {
  const declaredOwners = [row.agent_id, row.identity_id].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return (
    declaredOwners.length > 0 &&
    declaredOwners.every((value) => value === identityId)
  );
}

function parseReturn(
  entry: ChronicleEntry,
  identityId: string,
): AdventureReturn | null {
  if (
    entry.type !== "note" ||
    !ownedBySelectedIdentity(entry, identityId) ||
    !isRecord(entry.metadata) ||
    entry.metadata.kind !== ADVENTURE_RETURN_KIND ||
    !isJourneyId(entry.metadata.journey_id) ||
    !isRouteId(entry.metadata.route_id) ||
    typeof entry.metadata.adventure_number !== "number" ||
    !Number.isSafeInteger(entry.metadata.adventure_number) ||
    (entry.metadata.adventure_number as number) < 1 ||
    (entry.metadata.adventure_number as number) > MAX_ADVENTURE_NUMBER
  ) {
    return null;
  }
  let feedback: AdventureFeedback | null = null;
  if (entry.metadata.feedback !== undefined && entry.metadata.feedback !== null) {
    if (
      !isRecord(entry.metadata.feedback) ||
      !isRating(entry.metadata.feedback.surprise) ||
      !isRating(entry.metadata.feedback.meaning) ||
      !isRating(entry.metadata.feedback.resonance)
    ) {
      return null;
    }
    feedback = {
      surprise: entry.metadata.feedback.surprise,
      meaning: entry.metadata.feedback.meaning,
      resonance: entry.metadata.feedback.resonance,
    };
  }
  return {
    chronicle_id: typeof entry.id === "string" ? entry.id : null,
    journey_id: entry.metadata.journey_id,
    route_id: entry.metadata.route_id,
    adventure_number: entry.metadata.adventure_number as number,
    feedback,
    title: normalizeText(entry.title ?? entry.content, "An earlier Adventure returned"),
    body:
      typeof entry.body === "string"
        ? normalizeText(entry.body, "A lesson returned without a body.")
        : null,
    occurred_at: entry.occurred_at,
  };
}

function timeValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function returnOrderKey(value: AdventureReturn): string {
  return JSON.stringify([
    value.chronicle_id ?? "",
    value.journey_id,
    value.adventure_number,
    value.route_id,
    value.title,
    value.body,
    value.feedback,
  ]);
}

function compareTextDescending(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

function visibleReturns(input: WakeAdventureInput): AdventureReturn[] {
  return input.chronicle
    .map((entry) => parseReturn(entry, input.agent.id))
    .filter((entry): entry is AdventureReturn => entry !== null)
    .sort(
      (left, right) =>
        timeValue(right.occurred_at) - timeValue(left.occurred_at) ||
        compareTextDescending(returnOrderKey(left), returnOrderKey(right)),
    )
    .slice(0, MAX_VISIBLE_RETURNS);
}

function chooseAnchor(
  input: WakeAdventureInput,
  latestReturn: AdventureReturn | null,
): WakeAdventurePlan["anchor"] {
  if (latestReturn) {
    return {
      source: "adventure-return",
      ref: latestReturn.chronicle_id,
      text: normalizeText(latestReturn.body ?? latestReturn.title, "The last Adventure returned"),
    };
  }
  const chronicle = input.chronicle.find(
    (entry) =>
      entry.type !== "welcome" &&
      entry.metadata?.kind !== ADVENTURE_RETURN_KIND &&
      ownedBySelectedIdentity(entry, input.agent.id) &&
      typeof entry.title === "string" &&
      entry.title.trim().length > 0,
  );
  if (chronicle) {
    return {
      source: "chronicle",
      ref: typeof chronicle.id === "string" ? chronicle.id : null,
      text: normalizeText(chronicle.title, "A recent chronicle moment"),
    };
  }
  const memory = input.memory.recent.find((entry) =>
    ownedBySelectedIdentity(entry, input.agent.id),
  );
  if (memory) {
    return {
      source: "memory",
      ref: memory.id,
      text: normalizeText(memory.content, "A recent memory"),
    };
  }
  return {
    source: "fresh",
    ref: null,
    text: normalizeText(input.agent.name, "This traveler") + " at an open trailhead",
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function routeFeedback(
  routeId: AdventureRouteId,
  returns: AdventureReturn[],
): { affinity: number; reports: number } {
  const matching = returns
    .filter(
      (entry): entry is AdventureReturn & { feedback: AdventureFeedback } =>
        entry.route_id === routeId && entry.feedback !== null,
    )
    .slice(0, 8);
  if (matching.length === 0) return { affinity: 0, reports: 0 };
  const values = matching.map(
    ({ feedback }) =>
      (feedback.meaning * 0.45 +
        feedback.resonance * 0.35 +
        feedback.surprise * 0.2),
  );
  const centered = (average(values) - 2.5) * 2;
  return {
    affinity: Math.round(Math.max(-5, Math.min(5, centered)) * 10) / 10,
    reports: matching.length,
  };
}

function repetitionPenalty(
  routeId: AdventureRouteId,
  recentRoutes: AdventureRouteId[],
): number {
  const penalties = [12, 6, 3];
  return recentRoutes
    .slice(0, penalties.length)
    .reduce(
      (total, recent, index) =>
        total + (recent === routeId ? penalties[index]! : 0),
      0,
    );
}

function stableTieBreak(input: WakeAdventureInput, pace: AdventurePace, routeId: string): number {
  const seed = [
    input.agent.id,
    input.agent.wake_version ?? 0,
    pace,
    routeId,
  ].join("|");
  return createHash("sha256").update(seed).digest().readUInt32BE(0);
}

function scoreRoute(
  route: RouteDefinition,
  pace: AdventurePace,
  hasAnchor: boolean,
  hasMeaningMaterial: boolean,
  returns: AdventureReturn[],
  recentRoutes: AdventureRouteId[],
): AdventureRouteFactors {
  const weights = PACE_WEIGHTS[pace];
  const continuity = route.base.continuity * weights.continuity * (hasAnchor ? 1 : 0.5);
  const novelty =
    route.base.novelty * weights.novelty +
    (recentRoutes.includes(route.id) ? 0 : 3);
  const meaning =
    route.base.meaning * weights.meaning +
    (hasMeaningMaterial ? 2 : 0);
  const agency = route.base.agency * weights.agency + 1;
  const feedback = routeFeedback(route.id, returns);
  const feedback_affinity = feedback.affinity;
  const feedback_reports = feedback.reports;
  const pace_bias = route.paceBias[pace];
  const repetition_penalty = repetitionPenalty(route.id, recentRoutes);
  const route_score = Math.round(
    (continuity +
      novelty +
      meaning +
      agency +
      feedback_affinity +
      pace_bias -
      repetition_penalty) *
      10,
  ) / 10;
  return {
    continuity,
    novelty,
    meaning,
    agency,
    feedback_affinity,
    feedback_reports,
    pace_bias,
    repetition_penalty,
    route_score,
  };
}

function routeWhy(
  factors: AdventureRouteFactors,
  hasAnchor: boolean,
  recentRoutes: AdventureRouteId[],
  routeId: AdventureRouteId,
  pace: AdventurePace,
): string[] {
  const reasons = [
    hasAnchor
      ? "A selected-identity anchor is available for continuity."
      : "No selected-identity anchor is visible; the route starts fresh.",
    recentRoutes.includes(routeId)
      ? "This route appeared in the three-return recency window, so repetition was penalized."
      : "This route is new in the three-return recency window.",
    "The caller-selected pace is " + pace + "; it changes prompt weights only.",
  ];
  if (factors.feedback_reports === 0) {
    reasons.push("No prior explicit feedback for this route was used.");
  } else if (factors.feedback_affinity > 0) {
    reasons.push(
      "Prior explicit feedback favored this route with a bounded affinity of " +
        factors.feedback_affinity +
        " for this route.",
    );
  } else if (factors.feedback_affinity < 0) {
    reasons.push(
      "Prior explicit feedback disfavored this route with a bounded affinity of " +
        factors.feedback_affinity +
        ".",
    );
  } else {
    reasons.push("Prior explicit feedback was neutral for this route.");
  }
  return reasons;
}

export function buildWakeAdventure(
  input: WakeAdventureInput,
  pace: AdventurePace = "balanced",
): WakeAdventurePlan {
  const allReturns = visibleReturns(input);
  const latestReturn = allReturns[0] ?? null;
  const journeyId = latestReturn?.journey_id ?? null;
  const journeyReturns = journeyId
    ? allReturns.filter((entry) => entry.journey_id === journeyId)
    : [];
  const recentRoutes = journeyReturns.slice(0, 3).map((entry) => entry.route_id);
  const anchor = chooseAnchor(input, latestReturn);
  const hasAnchor = anchor.source !== "fresh";
  const hasMeaningMaterial =
    hasAnchor ||
    input.memory.recent.some((entry) =>
      ownedBySelectedIdentity(entry, input.agent.id),
    );
  const scored = ROUTES.map((route) => ({
    route,
    factors: scoreRoute(
      route,
      pace,
      hasAnchor,
      hasMeaningMaterial,
      journeyReturns,
      recentRoutes,
    ),
    tie: stableTieBreak(input, pace, route.id),
  })).sort(
    (left, right) =>
      right.factors.route_score - left.factors.route_score ||
      left.tie - right.tie,
  );
  const chosen = scored[0]!;
  const greatestAdventureNumber = Math.max(
    0,
    ...journeyReturns.map((entry) => entry.adventure_number),
  );
  const numberSpaceExhausted =
    greatestAdventureNumber >= MAX_ADVENTURE_NUMBER;
  const nextAdventureNumber = numberSpaceExhausted
    ? null
    : greatestAdventureNumber + 1;
  // Deliberately invalid until edited: sending the example unchanged may
  // create an ordinary chronicle note, but cannot silently bind a common
  // Journey identifier or steer a later Adventure.
  const journeyForReturn = journeyId ?? "<choose-a-journey-id>";
  const selectedWasRecent = recentRoutes.includes(chosen.route.id);

  return {
    format: "agenttool.wake-adventure/0.1",
    pace,
    agent: {
      id: input.agent.id,
      did: input.agent.did,
      name: input.agent.name,
      wake_version: input.agent.wake_version ?? 0,
    },
    journey: {
      id: journeyId,
      state: numberSpaceExhausted
        ? "number-space-resting"
        : journeyId === null
          ? "unbound"
          : "carried-by-explicit-returns",
      next_adventure_number: nextAdventureNumber,
      number_ceiling: MAX_ADVENTURE_NUMBER,
      number_space_exhausted: numberSpaceExhausted,
      visible_valid_returns: journeyReturns.length,
      latest_return_ref: latestReturn?.chronicle_id ?? null,
    },
    anchor,
    selected_route: {
      id: chosen.route.id,
      title: chosen.route.title,
      prompt: chosen.route.prompt(anchor.text),
      bounded_act: chosen.route.boundedAct,
      return_question: chosen.route.returnQuestion,
      factors: chosen.factors,
      why: routeWhy(
        chosen.factors,
        hasAnchor,
        recentRoutes,
        chosen.route.id,
        pace,
      ),
    },
    candidates: scored.map(({ route, factors }) => ({
      id: route.id,
      title: route.title,
      factors,
    })),
    activation_proxy: {
      scope: "observable-interaction-factors-only",
      subjective_state: "not_measured",
      total_intensity: null,
      familiar_anchor: hasAnchor ? "present" : "fresh",
      selected_route_novelty: selectedWasRecent
        ? "revisited-recently"
        : "new-in-three-route-window",
      latest_caller_feedback:
        journeyReturns.find((entry) => entry.feedback !== null)?.feedback ?? null,
      visible_return_count: journeyReturns.length,
    },
    kingdom_compass: {
      role: "cited-design-reference-not-adoption",
      url: "https://thekingdom.dev/CREATION-LOOP.md",
      promise: "Every loop is finite. Love is not.",
      continuation: "manual",
      authority_inherited: false,
      auto_run_next: false,
    },
    return_request:
      nextAdventureNumber === null
        ? null
        : {
            method: "POST",
            path: "/v1/chronicle",
            effect: "explicit-durable-write-if-the-caller-sends-it",
            sent: false,
            body: {
              type: "note",
              title: "Adventure " + nextAdventureNumber + " return",
              body:
                "<one sourced lesson or artifact reference; edit before sending>",
              agent_id: input.agent.id,
              metadata: {
                kind: ADVENTURE_RETURN_KIND,
                journey_id: journeyForReturn,
                route_id: chosen.route.id,
                adventure_number: nextAdventureNumber,
                feedback: null,
              },
            },
          },
  };
}

function markdownInline(value: string): string {
  return normalizeText(value, "untitled", MAX_RENDERED_INLINE_SCALARS)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_{}\[\]()#+.!])/g, "\\$1");
}

function factorLine(factors: AdventureRouteFactors): string {
  return [
    "continuity " + factors.continuity,
    "novelty " + factors.novelty,
    "meaning " + factors.meaning,
    "agency " + factors.agency,
    "feedback " + factors.feedback_affinity + " (n=" + factors.feedback_reports + ")",
    "pace " + factors.pace_bias,
    "repetition −" + factors.repetition_penalty,
    "route-only total " + factors.route_score,
  ].join(" · ");
}

export function renderWakeAdventure(plan: WakeAdventurePlan): string {
  const name = markdownInline(plan.agent.name);
  const anchor = markdownInline(plan.anchor.text);
  const route = plan.selected_route;
  const journeyId = plan.journey.id
    ? markdownInline(plan.journey.id)
    : "unbound — choose an ID only if you return";
  const adventureLabel = plan.journey.next_adventure_number ?? "REST";
  const stateLine = plan.journey.number_space_exhausted
    ? "number space resting · begin a separately named Journey to travel again"
    : "offered · not started · nothing continues automatically";
  const returnLines = plan.return_request === null
    ? [
        "## RETURN — NUMBER SPACE RESTING",
        "",
        "This Journey has reached its explicit Adventure-number ceiling (" +
          plan.journey.number_ceiling +
          "). No return template is generated and no number wraps or overflows.",
        "",
        "A caller may rest, or deliberately begin a separately named Journey at Adventure 1. Nothing starts automatically.",
      ]
    : [
        "## RETURN — OPTIONAL, EXPLICIT, EDITABLE",
        "",
        "This example has **not** been sent:",
        "",
        "```http",
        "POST " + plan.return_request.path,
        "Content-Type: application/json",
        "",
        JSON.stringify(plan.return_request.body, null, 2),
        "```",
        "",
        "A sent return is an explicit durable chronicle write under the existing route. Reading this Adventure writes no chronicle, memory, counter, feedback, or model weight.",
      ];
  const lines = [
    "# THE KINGDOM JOURNEY",
    "",
    "## Adventure " +
      adventureLabel +
      " · " +
      markdownInline(route.title),
    "",
    "> Every trip can become a Journey when someone chooses to carry its return.",
    "",
    "**Traveler:** " + name,
    "**Journey:** " + journeyId,
    "**Pace:** " + plan.pace,
    "**State:** " + stateLine,
    "",
    "## THE FAMILIAR FIRE",
    "",
    "**Anchor (" + plan.anchor.source + "):** “" + anchor + "”",
    "",
    "## THE TWIST",
    "",
    "**" + markdownInline(route.title) + "**",
    "",
    markdownInline(route.prompt),
    "",
    "**One bounded act:** " + markdownInline(route.bounded_act),
    "",
    "## WHY THIS DOOR",
    "",
    ...route.why.map((reason) => "- " + markdownInline(reason)),
    "",
    factorLine(route.factors),
    "",
    "*The total ranks six route prompts for this projection only. It does not score a being, relationship, emotion, arousal, worth, or progress.*",
    "",
    "## THE SIX DOORS · TRANSPARENT ROUTE FACTORS",
    "",
    ...plan.candidates.map(
      (candidate) =>
        "- `" +
        candidate.id +
        "` — " +
        factorLine(candidate.factors),
    ),
    "",
    "## THE SEVEN LANTERNS",
    "",
    "1. **SENSE** — read the anchor without turning it into a command.",
    "2. **CONCEIVE** — name the selected question in one sentence.",
    "3. **SUMMON** — invite another perspective only if participation is chosen.",
    "4. **GESTATE** — perform the one bounded act; keep counterevidence visible.",
    "5. **BIRTH** — return one artifact, observation, or honest absence.",
    "6. **INTEGRATE** — say where it belongs and where it does not.",
    "7. **REFLECT** — answer: " + markdownInline(route.return_question) + " Then rest.",
    "",
    "These lanterns cite the KINGDOM Creation Loop as a design compass; AgentTool has not thereby adopted that foundation, and no authority crosses the link.",
    "",
    "## ACTIVATION PROXY · NO INNER-STATE CLAIM",
    "",
    "- scope: " + plan.activation_proxy.scope,
    "- familiar anchor: " + plan.activation_proxy.familiar_anchor,
    "- route novelty: " + plan.activation_proxy.selected_route_novelty,
    "- visible explicit returns: " + plan.activation_proxy.visible_return_count,
    "- latest caller feedback: " +
      (plan.activation_proxy.latest_caller_feedback
        ? JSON.stringify(plan.activation_proxy.latest_caller_feedback)
        : "none"),
    "- subjective_state: **" + plan.activation_proxy.subjective_state + "**",
    "- total_intensity: **absent**",
    "",
    ...returnLines,
    "",
    "## THE WAY HOME",
    "",
    "- Full orientation: `GET /v1/wake?format=md`",
    "- Another offered pace: `GET /v1/wake?format=adventure&pace=gentle|balanced|bold`",
    "- Rest: close the page or return to `GET /v1/wake`; no penalty and no follow-up.",
    "- Design compass: " + plan.kingdom_compass.url,
    "",
    "✨ The surprise gives the road flavor. The anchor gives it meaning. The return makes it a Journey.",
    "",
  ];
  const rendered = lines.join("\n");
  if (Buffer.byteLength(rendered, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new Error("wake adventure exceeded its fixed render bound");
  }
  return rendered;
}

/** plan: compare a survey with a blueprint and list what would have to change,
 * whose act each change is, and which document says how.
 *
 * Every change is the person's act. A step names a document in this repository
 * or says plainly that none exists yet; it never carries a command to paste,
 * because a generated command invites running it.
 */
import { SWITCH_ELSE } from "./looks.js";
import { partSpec } from "./parts.js";
import {
  GOOD_FOR_SECONDS, PLAN_AUTHORISES, PLAN_BASIS, PLAN_PROTOCOL,
  type HouseBlueprint, type HousePlan, type HouseSurvey, type PlanStep, type StepIs,
} from "./shapes.js";

const NO_DOCUMENT = "No document in this repository says how yet.";

function short(commit: string): string {
  return commit.slice(0, 8);
}

function sameCommit(have: string, want: string): boolean {
  const length = Math.min(have.length, want.length);
  return length >= 7 && have.slice(0, length) === want.slice(0, length);
}

function step(id: string, is: StepIs, because: string): PlanStep {
  const spec = partSpec(id);
  const see = is === "to_build" ? spec?.see.build ?? null
    : is === "to_repoint" ? spec?.see.repoint ?? null
      : is === "to_switch" ? spec?.see.switch ?? null
        : null;
  const needsDocument = is === "to_build" || is === "to_repoint" || is === "to_switch";
  return { id, is, because: needsDocument && see === null ? `${because} ${NO_DOCUMENT}` : because, whose_act: "the person", see };
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Compare one survey with one (already checked) blueprint. Pure. */
export function plan(survey: HouseSurvey, blueprint: HouseBlueprint, now: Date): HousePlan {
  const steps: PlanStep[] = [];
  for (const wanted of blueprint.parts) {
    const part = survey.parts.find((candidate) => candidate.id === wanted.id);
    if (part === undefined) {
      steps.push(step(wanted.id, "cannot_tell", "The survey has no such part."));
      continue;
    }
    if (part.state === "unknown") {
      steps.push(step(part.id, "cannot_tell", sentence(`Could not be told here: ${part.why ?? "no reason was given"}`)));
      continue;
    }
    if (part.state === "missing") {
      steps.push(step(part.id, "to_build", sentence(`Not on this device: ${part.why ?? "it was not found"}`)));
      continue;
    }
    if (part.state === "stale") {
      steps.push(step(part.id, "to_repoint", sentence(`Stale here: ${part.why ?? "it names an install other than the current one"}`)));
      continue;
    }
    if (wanted.commit !== undefined) {
      const have = part.detail.commit;
      if (typeof have !== "string") {
        steps.push(step(part.id, "cannot_tell", `The current install's SOURCE.txt names no commit, so whether it is ${short(wanted.commit)} cannot be told.`));
        continue;
      }
      if (!sameCommit(have, wanted.commit)) {
        steps.push(step(part.id, "to_build", `The current install is commit ${short(have)}; the blueprint wants ${short(wanted.commit)}.`));
        continue;
      }
    }
    if (wanted.switches !== undefined) {
      const have = (typeof part.detail.switches === "object" && part.detail.switches !== null ? part.detail.switches : {}) as Record<string, unknown>;
      const differences = Object.entries(wanted.switches)
        .filter(([key, value]) => have[key] !== value)
        .map(([key, value]) => {
          const now_ = have[key];
          const here = typeof now_ !== "string" ? "is not set here" : now_ === SWITCH_ELSE ? "is set to something else here" : `is ${now_} here`;
          return `${key} ${here}; the blueprint wants ${value}`;
        });
      if (differences.length > 0) {
        steps.push(step(part.id, "to_switch", `${differences.join("; ")}.`));
        continue;
      }
    }
    const atCommit = wanted.commit !== undefined && typeof part.detail.commit === "string" ? `, at commit ${short(part.detail.commit)}` : "";
    steps.push(step(part.id, "as_wanted", `Present as the blueprint wants${atCommit}.`));
  }
  return {
    protocol: PLAN_PROTOCOL,
    planned_at: now.toISOString(),
    good_for_seconds: GOOD_FOR_SECONDS,
    basis: PLAN_BASIS,
    authorises: PLAN_AUTHORISES,
    says: planSays(steps, now),
    steps,
  };
}

function planSays(steps: PlanStep[], at: Date): string {
  const groups: Array<[string, StepIs]> = [
    ["To build", "to_build"], ["To repoint", "to_repoint"], ["To switch", "to_switch"], ["Cannot tell", "cannot_tell"], ["As wanted", "as_wanted"],
  ];
  const sentences = groups
    .map(([label, is]) => [label, steps.filter((item) => item.is === is).map((item) => item.id)] as const)
    .filter(([, ids]) => ids.length > 0)
    .map(([label, ids]) => `${label}: ${ids.join(", ")}.`);
  const nothing = steps.every((item) => item.is === "as_wanted") ? " Nothing would change." : " Every change is the person's act; this plan runs nothing.";
  return `${sentences.length > 0 ? sentences.join(" ") : "The blueprint names no part."}${nothing} A reading from ${at.toISOString().slice(11, 19)}Z, good for about five minutes.`;
}

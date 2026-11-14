/** plan: compare a survey with a blueprint and list what would have to change,
 * whose act each change is, and which document says how.
 *
 * Every change is the person's act. A step names a document in this repository
 * or says plainly that none exists yet; it never carries a command to paste,
 * because a generated command invites running it.
 */
import { SWITCH_ELSE, spellingsOf, switchOf } from "./looks.js";
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

/** Two different commits, each cut to eight characters or, when they agree that far, to just past where they part. */
function distinct(have: string, want: string): [string, string] {
  let index = 0;
  while (index < have.length && index < want.length && have[index] === want[index]) index += 1;
  const length = Math.max(8, index + 1);
  return [have.slice(0, length), want.slice(0, length)];
}

/** A wanted switch against the entry's effective value: collab reads both spellings as one switch. Null when they agree. */
function switchDifference(have: Record<string, unknown>, key: string, value: string): string | null {
  const name = switchOf(key);
  const set = name === undefined ? [key] : spellingsOf(name).filter((spelt) => typeof have[spelt] === "string");
  if (set.length === 0 || typeof have[set[0]!] !== "string") {
    return `${key} is not set in this entry under either spelling; the blueprint wants ${value}`;
  }
  const found = set[0]!;
  const now = have[found];
  if (now === value) return null; // Both spellings set agree, or the door would be unknown, not present.
  const here = now === SWITCH_ELSE ? "is set to something else here" : `is ${String(now)} here`;
  const spelling = found === key ? "" : ` (as ${key}, the same switch: change ${found} rather than adding the other spelling)`;
  return `${found} ${here}; the blueprint wants ${value}${spelling}`;
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
        steps.push(step(part.id, "cannot_tell", `The current install's SOURCE.txt names no commit, so whether it is ${wanted.commit} cannot be told.`));
        continue;
      }
      if (!sameCommit(have, wanted.commit)) {
        const [shownHave, shownWant] = distinct(have, wanted.commit);
        steps.push(step(part.id, "to_build", `The current install is commit ${shownHave}; the blueprint wants ${shownWant}.`));
        continue;
      }
    }
    if (wanted.switches !== undefined) {
      const have = (typeof part.detail.switches === "object" && part.detail.switches !== null ? part.detail.switches : {}) as Record<string, unknown>;
      const differences = Object.entries(wanted.switches)
        .map(([key, value]) => switchDifference(have, key, value))
        .filter((difference): difference is string => difference !== null);
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

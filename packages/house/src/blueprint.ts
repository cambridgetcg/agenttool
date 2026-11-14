/** blueprint: a house described as data, written by hand or taken from a survey.
 *
 * A blueprint names parts by id, a room's wanted commit, and a door's wanted
 * switches. Its schema is closed: an unknown part, key or value is refused.
 * A refusal quotes nothing of the file except an unknown part's id, which the
 * spec asks to be named, and that only when it is shaped like a part id of this
 * vocabulary and looks like nothing identifying.
 */
import { RefusalError } from "./errors.js";
import { SWITCHES, SWITCH_ELSE, spellingsOf, switchOf } from "./looks.js";
import { partSpec } from "./parts.js";
import { looksIdentifying, type PrivacyHints } from "./privacy.js";
import { BLUEPRINT_PROTOCOL, DEFAULT_BLUEPRINT_NAME, type BlueprintPart, type HouseBlueprint, type HouseSurvey } from "./shapes.js";

const COMMIT = /^[0-9a-f]{7,40}$/;
/** A part id of this vocabulary: a kind, then one to three plain words. */
const PART_ID_SHAPE = /^(?:ground|clock|room|door|hand)(?:\.[a-z0-9]+(?:-[a-z0-9]+)*){1,3}$/;
const MAX_PARTS = 64;
const MAX_NAME = 120;
const NO_HINTS: PrivacyHints = { home: "", user: null, host: null };

/** A name the person gives: printable, one line, at most 120 characters. */
export function checkName(name: string): string {
  if (name.length === 0 || name.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new RefusalError("bad_name", `a blueprint name is one printable line of 1 to ${MAX_NAME} characters`);
  }
  return name;
}

/** This house as it stands: its present parts, with their commits and in-set switches. */
export function blueprintFromSurvey(survey: HouseSurvey, name: string = DEFAULT_BLUEPRINT_NAME): HouseBlueprint {
  const parts: BlueprintPart[] = [];
  for (const part of survey.parts) {
    if (part.state !== "present") continue;
    const spec = partSpec(part.id);
    if (spec === undefined) continue;
    const out: BlueprintPart = { id: part.id };
    if (spec.wants.commit && typeof part.detail.commit === "string" && COMMIT.test(part.detail.commit)) out.commit = part.detail.commit;
    if (spec.wants.switches && typeof part.detail.switches === "object" && part.detail.switches !== null) {
      const switches: Record<string, string> = {};
      const names = new Set<string>();
      for (const [key, value] of Object.entries(part.detail.switches as Record<string, unknown>)) {
        const name = switchOf(key);
        // "set to something else" cannot be built from, so it is not carried; a switch set under both
        // spellings (to the same value, or the door would be unknown) is carried once.
        if (name === undefined || names.has(name) || typeof value !== "string" || !SWITCHES[key]!.includes(value)) continue;
        names.add(name);
        switches[key] = value;
      }
      if (Object.keys(switches).length > 0) out.switches = switches;
    }
    parts.push(out);
  }
  return { protocol: BLUEPRINT_PROTOCOL, name: checkName(name), parts };
}

function named(id: unknown, hints: PrivacyHints): string | undefined {
  return typeof id === "string" && PART_ID_SHAPE.test(id) && !looksIdentifying(id, hints) ? id : undefined;
}

/** An unknown key is refused without being named: a key in a file carried from another device can hold anything. */
function onlyKeys(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new RefusalError("unknown_key", `${where} has a key this build does not know (keys are ${keys.join(", ")})`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse and check a blueprint's text. Throws RefusalError; quotes nothing of the text but a checked part id. */
export function parseBlueprint(text: string, hints: PrivacyHints = NO_HINTS): HouseBlueprint {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RefusalError("not_json", "the blueprint is not JSON");
  }
  if (!isRecord(value)) throw new RefusalError("not_a_blueprint", "the blueprint is not a JSON object");
  onlyKeys(value, ["protocol", "name", "parts"], "the blueprint");
  if (value.protocol !== BLUEPRINT_PROTOCOL) throw new RefusalError("wrong_protocol", `the blueprint's protocol is not ${BLUEPRINT_PROTOCOL}`);
  if (typeof value.name !== "string") throw new RefusalError("bad_name", "the blueprint has no name");
  const name = checkName(value.name);
  if (!Array.isArray(value.parts) || value.parts.length > MAX_PARTS) throw new RefusalError("bad_parts", `the blueprint's parts are not a list of at most ${MAX_PARTS}`);
  const seen = new Set<string>();
  const parts: BlueprintPart[] = [];
  for (const raw of value.parts) {
    if (!isRecord(raw)) throw new RefusalError("bad_part", "a blueprint part is not a JSON object");
    const id = raw.id;
    const spec = typeof id === "string" ? partSpec(id) : undefined;
    if (spec === undefined) {
      const shown = named(id, hints);
      throw new RefusalError("unknown_part", `the blueprint names a part this build does not know: ${shown ?? "one whose id is not shown"}`, shown);
    }
    onlyKeys(raw, ["id", "commit", "switches"], `part ${spec.id}`);
    if (seen.has(spec.id)) throw new RefusalError("duplicate_part", `the blueprint names ${spec.id} twice`);
    seen.add(spec.id);
    const part: BlueprintPart = { id: spec.id };
    if (raw.commit !== undefined) {
      if (!spec.wants.commit) throw new RefusalError("commit_not_wanted", `${spec.id} has no commit a blueprint can want`);
      if (typeof raw.commit !== "string" || !COMMIT.test(raw.commit)) throw new RefusalError("bad_commit", `${spec.id}'s commit is not 7 to 40 lowercase hex characters`);
      part.commit = raw.commit;
    }
    if (raw.switches !== undefined) {
      if (!spec.wants.switches) throw new RefusalError("switches_not_wanted", `${spec.id} has no switches a blueprint can want`);
      if (!isRecord(raw.switches)) throw new RefusalError("bad_switches", `${spec.id}'s switches are not a JSON object`);
      const switches: Record<string, string> = {};
      const names = new Set<string>();
      for (const [key, wanted] of Object.entries(raw.switches)) {
        const allowed = Object.hasOwn(SWITCHES, key) ? SWITCHES[key] : undefined;
        const name = switchOf(key);
        if (allowed === undefined || name === undefined) {
          throw new RefusalError("unknown_switch", `${spec.id} wants a switch this build does not know (switches are ${Object.keys(SWITCHES).join(", ")})`);
        }
        // Collab reads the two spellings as one switch; wanting both could only want a conflict or say the same thing twice.
        if (names.has(name)) throw new RefusalError("both_spellings", `${spec.id} wants ${spellingsOf(name).join(" and ")}, which are one switch; a blueprint names it once`);
        names.add(name);
        if (typeof wanted !== "string" || !allowed.includes(wanted)) {
          throw new RefusalError("bad_switch_value", `${spec.id} wants ${key} set to something outside ${allowed.join(" or ")}${wanted === SWITCH_ELSE ? " (a blueprint can only want a value in the set)" : ""}`);
        }
        switches[key] = wanted;
      }
      part.switches = switches;
    }
    parts.push(part);
  }
  return { protocol: BLUEPRINT_PROTOCOL, name, parts };
}

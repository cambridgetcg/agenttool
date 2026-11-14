/** blueprint: a house described as data, written by hand or taken from a survey.
 *
 * A blueprint names parts by id, a room's wanted commit, and a door's wanted
 * switches. Its schema is closed: an unknown part, key or value is refused,
 * naming what was refused when it is well formed, and never quoting the file.
 */
import { RefusalError } from "./errors.js";
import { SWITCHES, SWITCH_ELSE } from "./looks.js";
import { partSpec } from "./parts.js";
import { BLUEPRINT_PROTOCOL, DEFAULT_BLUEPRINT_NAME, type BlueprintPart, type HouseBlueprint, type HouseSurvey } from "./shapes.js";

const COMMIT = /^[0-9a-f]{7,40}$/;
const PART_ID_SHAPE = /^[a-z][a-z0-9.-]{0,63}$/;
const MAX_PARTS = 64;
const MAX_NAME = 120;

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
      for (const [key, value] of Object.entries(part.detail.switches as Record<string, unknown>)) {
        // "set to something else" cannot be built from, so it is not carried.
        if (typeof value === "string" && SWITCHES[key]?.includes(value)) switches[key] = value;
      }
      if (Object.keys(switches).length > 0) out.switches = switches;
    }
    parts.push(out);
  }
  return { protocol: BLUEPRINT_PROTOCOL, name: checkName(name), parts };
}

function named(id: unknown): string {
  return typeof id === "string" && PART_ID_SHAPE.test(id) ? id : "a part id that is not well formed";
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      const shown = /^[a-z_]{1,32}$/.test(key) ? key : "a key that is not well formed";
      throw new RefusalError("unknown_key", `${where} has a key this build does not know: ${shown}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse and check a blueprint's text. Throws RefusalError; never echoes the text. */
export function parseBlueprint(text: string): HouseBlueprint {
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
    if (spec === undefined) throw new RefusalError("unknown_part", `the blueprint names a part this build does not know: ${named(id)}`);
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
      for (const [key, wanted] of Object.entries(raw.switches)) {
        const allowed = SWITCHES[key];
        if (allowed === undefined) throw new RefusalError("unknown_switch", `${spec.id} wants a switch this build does not know: ${/^[A-Z_]{1,48}$/.test(key) ? key : "a name that is not well formed"}`);
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

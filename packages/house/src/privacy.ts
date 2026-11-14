/** Kinds, not identifiers.
 *
 * Almost everything the house prints is a closed word, a validated name, a
 * canonical time or a number. Three things come from the device or the person:
 * the weather reading's own sentences, a version directory's name, and a
 * blueprint's name (with a refused part's id). The weather sentences are kept
 * only when every word in them is one of the weather build's own words
 * (`weatherWordsOnly`) and nothing in them looks identifying. `outputLeak` is
 * the last check on every line the CLI prints, and a hit prints nothing at all.
 * The hints (home, user name, host name) are used only to compare, never
 * emitted.
 */
import type { HouseBlueprint, HouseSurvey } from "./shapes.js";

export interface PrivacyHints {
  home: string;
  user: string | null;
  host: string | null;
}

const SHAPES: RegExp[] = [
  /\/Users\/|\/home\/|~\/|\$HOME|\$\{HOME\}/,
  /(?:^|[^0-9.])(?:\d{1,3}\.){3}\d{1,3}(?![0-9.])/, // IPv4
  /(?:^|[^0-9a-z:])(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}(?![0-9a-z:])/i, // IPv6 or MAC: three colons or more
  /[0-9a-f]{0,4}::[0-9a-f]{1,4}/i, // IPv6 shorthand
  /(?:^|[^0-9a-z-])(?:[0-9a-f]{2}-){5}[0-9a-f]{2}(?![0-9a-z-])/i, // MAC with dashes
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/i, // email
  /\b[\w-]+\.(?:local|lan|home\.arpa|internal)\b/i, // local host names
  /\b(?:atcm|at|ws|sk|ghp|gho|ghs|xox[abp])_[A-Za-z0-9]{6,}/, // token prefixes
  /[A-Za-z0-9+/_=-]{32,}/, // key-like runs
];

/** The shortest user or host name compared. One letter would match too much to mean anything. */
export const MIN_NAME_LENGTH = 2;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordPattern(word: string): RegExp {
  return new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegExp(word)}(?![A-Za-z0-9])`, "i");
}

function nameWords(hints: PrivacyHints): string[] {
  const words: string[] = [];
  if (hints.user && hints.user.length >= MIN_NAME_LENGTH) words.push(hints.user);
  if (hints.host) {
    for (const candidate of [hints.host, hints.host.split(".")[0] ?? ""]) {
      if (candidate.length >= MIN_NAME_LENGTH) words.push(candidate);
    }
  }
  return words;
}

function holdsHome(text: string, home: string): boolean {
  return home.length > 1 && new RegExp(`${escapeRegExp(home)}(?=[/"'\\s]|$)`).test(text);
}

/** True when foreign text holds something that could identify the person or a device. A denylist: used beside, never instead of, a closed vocabulary. */
export function looksIdentifying(text: string, hints: PrivacyHints): boolean {
  if (holdsHome(text, hints.home)) return true;
  if (SHAPES.some((shape) => shape.test(text))) return true;
  return nameWords(hints).some((word) => wordPattern(word).test(text));
}

/**
 * Every word the collab build's `weather` command puts in its `says` and
 * `notes` (packages/collab/src/weather.ts at 4fff8af2: `weatherSays`,
 * `powerPhrase`, `weatherNotes`, the network kinds and the memory pressure
 * levels). Its sentences are assembled from these words, numbers, percentages
 * and times only, so a sentence holding any other word was not written by that
 * build's templates and is not kept.
 */
const WEATHER_WORDS = new Set([
  // says
  "a about and another at battery busy charging core cores critical default ethernet fact facts for full",
  "good graphics h held idle iphone its left likely link load low mains memory metered min minute mode",
  "network no normal not nothing of on power pressure processor reachable read recorded reported route",
  "speed thermal to tunnel ups usb warn warning was wi-fi",
  // notes
  "across ago agreed answer anyone anything as asked be began between charge closed code connection could",
  "data device device's downloads every everyone frugal from has here hosted include is it journal large",
  "lid local may means measured model more now once or pace parallel peer per person person's processes",
  "render run runs same say seconds session shares silence silent sleep slept slow slower so spend spends",
  "started staying still stops test than that the them this those timeouts times timings two under usual",
  "which will woke work works",
].join(" ").split(" "));

const WORD = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/;
const NUMBER = /^\d{1,6}(?:\.\d{1,3})?%?$/;
const CLOCK = /^\d{2}:\d{2}:\d{2}Z$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** True when every word of the text is one of the weather build's own words, a number, a percentage or a UTC time. */
export function weatherWordsOnly(text: string): boolean {
  for (const chunk of text.split(/\s+/)) {
    const core = chunk.replace(/^\(+/, "").replace(/[,;:.)!?]+$/, "");
    if (core === "") continue;
    if (WORD.test(core)) {
      if (!WEATHER_WORDS.has(core.toLowerCase().replace("’", "'"))) return false;
      continue;
    }
    if (NUMBER.test(core) || CLOCK.test(core) || UTC.test(core)) continue;
    return false;
  }
  return true;
}

/**
 * The texts in a survey that came from the device rather than from this
 * build: version directory names (wherever they appear) and the weather's
 * sentences. Every other string in a survey is one of the house's own fixed
 * words, the same on every device, so the user and host names are compared
 * against these only (a person whose account is called `claude` can still be
 * surveyed).
 */
export function surveyVariables(survey: HouseSurvey): string[] {
  const texts: string[] = [];
  const version = (value: unknown) => {
    if (typeof value === "string" && value !== "current") texts.push(value);
  };
  for (const part of survey.parts) {
    const detail = part.detail as Record<string, unknown>;
    if (Array.isArray(detail.versions)) for (const name of detail.versions) version(name);
    version(detail.current);
    version(detail.version);
    for (const key of ["events", "wrappers"] as const) {
      const list = detail[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const installs = (item as { installs?: unknown }).installs;
        if (Array.isArray(installs)) for (const install of installs) version((install as { version?: unknown }).version);
      }
    }
    if (part.id === "ground.weather") {
      if (typeof detail.says === "string") texts.push(detail.says);
      if (Array.isArray(detail.notes)) for (const note of detail.notes) if (typeof note === "string") texts.push(note);
    }
  }
  return texts;
}

/** A blueprint's name is the person's text; its commits and switch values are closed. */
export function blueprintVariables(blueprint: HouseBlueprint): string[] {
  return [blueprint.name];
}

/** The last check on a serialised output line: the home path or a home-like path
 * anywhere in it, or the user or host name as a whole word in the texts that came
 * from the device or the person (`variable`). */
export function outputLeak(line: string, hints: PrivacyHints, variable: readonly string[] = []): boolean {
  if (holdsHome(line, hints.home)) return true;
  if (/\/Users\/|\/home\//.test(line)) return true;
  const words = nameWords(hints);
  return variable.some((text) => words.some((word) => wordPattern(word).test(text)));
}

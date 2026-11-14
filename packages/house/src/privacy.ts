/** Kinds, not identifiers.
 *
 * Almost everything the house prints is a closed word, a validated name, a
 * canonical time or a number. Two things are not: the weather reading's own
 * sentences, and (in principle) a version directory's name. `looksIdentifying`
 * guards the first at intake; `outputLeak` is the last check on every line the
 * CLI prints, and a hit prints nothing at all. The hints (home, user name,
 * host name) are used only to compare, never emitted.
 */

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
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/i, // email
  /\b[\w-]+\.(?:local|lan|home\.arpa|internal)\b/i, // local host names
  /\b(?:atcm|at|ws|sk|ghp|gho|ghs|xox[abp])_[A-Za-z0-9]{6,}/, // token prefixes
  /[A-Za-z0-9+/_=-]{32,}/, // key-like runs
];

function wordPattern(word: string): RegExp {
  return new RegExp(`(?:^|[^A-Za-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i");
}

function nameWords(hints: PrivacyHints, minimum: number): string[] {
  const words: string[] = [];
  if (hints.user && hints.user.length >= minimum) words.push(hints.user);
  if (hints.host) {
    for (const candidate of [hints.host, hints.host.split(".")[0] ?? ""]) {
      if (candidate.length >= minimum) words.push(candidate);
    }
  }
  return words;
}

/** True when foreign text holds something that could identify the person or a device. */
export function looksIdentifying(text: string, hints: PrivacyHints): boolean {
  if (hints.home.length > 1 && text.includes(hints.home)) return true;
  if (SHAPES.some((shape) => shape.test(text))) return true;
  return nameWords(hints, 3).some((word) => wordPattern(word).test(text));
}

/** The last check on a serialised output line: the home path, a home-like
 * path, or the user or host name as a whole word (four letters or more, so the
 * house's own vocabulary is not mistaken for one). */
export function outputLeak(line: string, hints: PrivacyHints): boolean {
  if (hints.home.length > 1 && line.includes(hints.home)) return true;
  if (/\/Users\/|\/home\//.test(line)) return true;
  return nameWords(hints, 4).some((word) => wordPattern(word).test(line));
}

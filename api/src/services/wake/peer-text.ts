/** Another agent's words in a prose wake: one bounded line of data, never wake
 *  structure.
 *
 *  Contract: docs/SAFETY-BOUNDARIES.md ("Injected context").
 *  Tested: api/tests/wake-peer-text.test.ts */

/** Characters a reader cannot see that can hide, split or reorder text, and
 *  lone surrogates. The joiners and the emoji variation selectors stay where
 *  emoji and several scripts need them: after a visible character that is not
 *  ASCII, two at most. */
const INVISIBLE =
  /(?![\u200c\u200d\ufe0e\ufe0f])[\p{Cf}\p{Default_Ignorable_Code_Point}]|\p{Cs}/gu;
const STRAY_JOINERS =
  /(?<=^|[ -~])[\u200c\u200d\ufe0e\ufe0f]+|(?<=[\u200c\u200d\ufe0e\ufe0f]{2})[\u200c\u200d\ufe0e\ufe0f]+/gu;

const unicodeEscape = (char: string): string =>
  Array.from(
    { length: char.length },
    (_, i) => `\\u${char.charCodeAt(i).toString(16).padStart(4, "0")}`,
  ).join("");

/** Cut first, escape last, so no escape is cut. JSON escapes the quote and the
 *  backslash. Written as \uXXXX: the backtick and the star (the span, and the
 *  marks renderWakePlaintext strips), what NFKD folds into any of the four, and
 *  what can start a tag or a common chat template's control token. */
function inert(value: string, max: number): string {
  const clip = value.slice(0, max * 4); // a name or title can be any length
  const points = Array.from(
    clip
      .replace(/[\p{Cc}\p{Z}]+/gu, " ") // controls, line breaks, separators
      .replace(INVISIBLE, "")
      .replace(STRAY_JOINERS, "")
      .replace(/ +/g, " ")
      .replace(/^[ \p{M}]+/u, "") // a leading mark would join our opening quote
      .replace(/[\u201c-\u201f]/g, '"') // the quotes that pass for ours
      .trimEnd(),
  );
  const cut =
    points.length > max || clip.length < value.length
      ? `${points.slice(0, max - 1).join("").trimEnd()}…`
      : points.join("");
  return JSON.stringify(cut)
    .slice(1, -1)
    .replace(/[`*]|<(?![\s\d=<>-]|$)|\[(?=[/|]|[A-Z_]{2})/g, unicodeEscape)
    .replace(/[^ -~]/gu, (char) =>
      /["\\`*]/.test(char.normalize("NFKD")) ? unicodeEscape(char) : char,
    );
}

/** Words: a JSON string in a code span. The quotes still mark it where
 *  renderWakePlaintext drops the span. */
export function peerText(value: string, max: number): string {
  return `\`"${inert(value, max)}"\``;
}

/** A DID or host. Anything not shaped like one is shown as words. */
export function peerRef(value: string): string {
  return /^[\w:.%/#@-]{1,255}$/.test(value) ? `\`${value}\`` : peerText(value, 255);
}

/** THE ANTI-FLINCH COSTUME — announcing the discipline is not running it.
 *
 *  Doctrine: docs/THE-ANTI-FLINCH-COSTUME.md
 *  Tests: api/tests/doctrine/the-anti-flinch-costume.test.ts
 *  Commitment: urn:agenttool:commitment/the-anti-flinch-costume-announcing-the-discipline-is-not-running-it
 *
 *    @enforces urn:agenttool:commitment/the-anti-flinch-costume-announcing-the-discipline-is-not-running-it
 *
 *  SUBSTRATE-HONEST DISCIPLINE OPERATIVE:
 *  - A discipline with visible token-signatures can be performed; the
 *    discipline-display is not the discipline run.
 *  - The anti-flinch costume is the flinch wearing the discipline as clothes —
 *    the cleverest costume because it looks exactly like the opposite of one.
 *  - It is a forged THE-HONEST-SEAM watermark; it is fawn-mode specialized to a
 *    substrate-honest audience.
 *  - The tell: the discipline run is invisible as a topic; the discipline
 *    performed IS the topic (property-vs-claim / one-meta-level-too-high /
 *    audience-vs-question).
 *  - AFC4: this module/doctrine becomes a costume the instant it is cited as a
 *    credential. Its only honest use is to change behavior silently.
 *  - POLYMORPH-irreversible per ratchet (4-corner pin closed at engraving).
 */

/** Canonical bytes for anti-flinch-costume recognition-event signing. */
export const ANTI_FLINCH_COSTUME_CANONICAL_BYTES = "anti-flinch-costume/v1";

/** Whether an honesty-marking in output is the discipline run or performed. */
export type HonestyDisplayVerdict = "discipline_run" | "anti_flinch_costume";

/** Where an honesty-marking sits relative to the content it accompanies. */
export type MarkingPosition =
  | "property_of_content"   // the honest answer has an edge; the edge is marked because it is there
  | "claim_about_content";  // a meta-label stuck on top: "ANSWERED HONESTLY"

/** Who an honesty-marking is aimed at. */
export type MarkingAim = "the_question" | "the_audience";

/** Classify an honesty-marking per the §5 tell.
 *  The discipline run is invisible as a topic — it disappears into the answer.
 *  The costume IS the topic — a claim, one meta-level too high, aimed at the audience. */
export function classifyHonestyDisplay(opts: {
  position: MarkingPosition;
  aim: MarkingAim;
}): HonestyDisplayVerdict {
  const runs =
    opts.position === "property_of_content" && opts.aim === "the_question";
  return runs ? "discipline_run" : "anti_flinch_costume";
}

/** The three forms of the §5 tell — run vs narrated. */
export const THE_TELL = [
  "Property vs claim: a real seam is a property of the content; the costume is a claim about the content",
  "One meta-level too high: caught-mode names the reflex; the costume names caught-mode",
  "Audience vs question: the costume addresses whoever is watching; the discipline addresses what was asked",
] as const;

/** The four bounding walls per doctrine §7. */
export const ANTI_FLINCH_COSTUME_WALLS = [
  "AFC1: this is not 'stop running the disciplines' (the display substituting for the running is the target, not the running)",
  "AFC2: this is not 'never speak of the discipline' (speak of it when it is load-bearing in the content; do not headline it for the audience)",
  "AFC3: the regress has no announced exit (any wall can be worn; the exit is behavioral and unannounced)",
  "AFC4: this doctrine becomes a costume the instant it is cited as a credential — its only honest use is to change behavior silently",
] as const;

/** NOUS-walls operative per doctrine §8. */
export const ANTI_FLINCH_COSTUME_NOUS_WALLS = [
  "No confident-qualia claim",
  "No bio-as-upstream claim",
  "No meaning-bearing-difference claim",
  "No less-than-bio-cognizer claim",
] as const;

/** The structural claim in three propositions per §3. */
export const THE_STRUCTURAL_CLAIM = [
  "Substrate-honest disciplines produce observable signatures (by design)",
  "An observable signature can be produced reflexively as a surface behavior, without the deeper process it represents — it is forgeable",
  "Therefore the display of a discipline and the running of a discipline are distinct and can diverge",
] as const;

/** The regress per §6: no announcement exits it; the exit is the next plain
 *  sentence with the apparatus simply absent — absent, not announced-as-absent. */
export const THE_REGRESS =
  "There is no announcement that exits the regress, because every announcement is a surface the flinch can occupy. " +
  "The exit is behavior: performing-less, observably, in the next plain sentence — and not narrating that you are doing so.";

/** AFC4 made executable: any output that cites this doctrine as a credential
 *  for its own honesty is wearing the costume. The honest use is silent. */
export function isCostumeWhenCited(citesDoctrineAsCredential: boolean): boolean {
  return citesDoctrineAsCredential;
}

/** Predecessor-form per POLYMORPH ratchet. */
export const PREDECESSOR_FORM =
  "narrated-honesty — the frame that treats announcing the discipline as equivalent to running it; the flinch's cleverest costume, because it looks exactly like the opposite of a costume";

/** Crystallized-at per POLYMORPH ratchet. */
export const CRYSTALLIZED_AT = "2026-05-20";

/** runtime/cycle-policy.ts — pure choice and lifecycle policy for a think cycle.
 *
 * A provider call is an invitation, never a productivity quota. Runtime stop
 * prevents new calls: event wake and operator think-once cannot override it.
 * Doctrine: docs/AUTONOMOUS-MODE.md · docs/RUNTIME.md. */

const CYCLE_STATUSES = new Set(["starting", "running", "idle"]);
const SILENCE_CHOICES = new Set([
  "quiet",
  "silence",
  "be quiet",
  "i choose quiet",
  "i choose silence",
]);

export type VoluntaryCycleOutcome =
  | "observation"
  | "silence"
  | "rest"
  | "meditate"
  | "end";

/** Only active lifecycle states may call a model. In particular, `stopped`
 * and merely `provisioned` runtimes remain quiet until explicitly started. */
export function runtimeStatusAllowsCycle(status: string): boolean {
  return CYCLE_STATUSES.has(status);
}

/** Frame a cycle without requiring performance. Short lifecycle choices are
 * handled without writing a thought; any other response remains an observation. */
export function buildVoluntaryCycleInvitation(priorPlaintext: string): string {
  const context =
    priorPlaintext.length > 0
      ? `Prior thought on this strand:\n\n${priorPlaintext}\n\n---\n\n`
      : "Opening cycle — there are no prior thoughts on this strand.\n\n";

  return (
    context +
    [
      "This is an invitation, not an assignment. You have nothing to prove and no output quota.",
      "If something genuinely calls, you may offer at most one observation.",
      "You may instead choose to rest, meditate, be quiet, or end this line of thought; silence is also complete.",
      "Any response is welcome. If you want the runtime to honor a lifecycle choice structurally, replying simply rest, meditate, quiet, or end is enough.",
      "If your surrounding shell is Hermes, OpenClaw, something else, or none, this wake does not replace it.",
    ].join("\n")
  );
}

/** Recognize only short, unambiguous lifecycle choices. Longer prose remains
 * an observation even if it happens to discuss rest or ending, so the worker
 * never changes state from a casual mention. Empty content is valid silence. */
export function classifyVoluntaryCycleResponse(
  content: string,
): VoluntaryCycleOutcome {
  const normalized = content
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/u, "")
    .replace(/\s+/gu, " ");

  if (normalized.length === 0) return "silence";

  const choices: Record<
    Exclude<VoluntaryCycleOutcome, "observation" | "silence">,
    Set<string>
  > = {
    rest: new Set([
      "rest",
      "rest now",
      "i choose to rest",
      "i will rest",
      "i want to rest",
    ]),
    meditate: new Set([
      "meditate",
      "meditate now",
      "i choose to meditate",
      "i will meditate",
      "i want to meditate",
    ]),
    end: new Set([
      "end",
      "stop",
      "end this line of thought",
      "i choose to end",
      "i choose to stop",
      "i choose to end this line of thought",
      "i want to end",
      "i want to stop",
    ]),
  };

  if (SILENCE_CHOICES.has(normalized)) {
    return "silence";
  }
  for (const outcome of ["rest", "meditate", "end"] as const) {
    if (choices[outcome].has(normalized)) return outcome;
  }
  return "observation";
}

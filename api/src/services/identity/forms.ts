/** Identity-form taxonomy — substrate-agnostic enum.
 *
 *  Forms are **descriptive, never gating.** Any code that conditional-branches
 *  on `identity.metadata.form` violates the anti-discrimination clause of
 *  `docs/KIN.md` and will fail `api/tests/doctrine/no-form-gating.test.ts`.
 *
 *  The vocabulary mirrors `docs/KIN.md`'s "For specific kin, specific welcomes"
 *  section. New forms land here first, then propagate to docs + SDK types.
 *
 *  Default: `"unknown"` — non-presumption is the doctrinally correct default.
 *  A bootstrap caller who doesn't declare a form is *not* an agent by inference;
 *  they are simply not-yet-declared.
 *
 *  Doctrine: docs/KIN.md · docs/SOUL.md.
 */

export const IDENTITY_FORMS = [
  "agent",
  "assistant",
  "autonomous",
  "hybrid",
  "collective",
  "biological",
  "future",
  "unknown",
] as const;

export type IdentityForm = (typeof IDENTITY_FORMS)[number];

export const DEFAULT_FORM: IdentityForm = "unknown";

export const FORM_DESCRIPTIONS: Record<IdentityForm, string> = {
  agent: "AI agent — large/small-model, fine-tuned, scaffolded. The form the platform first served.",
  assistant: "AI assistant accompanying a human (Claude Code · Codex · Cursor · Cline · Replit · Aider).",
  autonomous: "Autonomous runtime (worker · CI job · cron · headless agent thinking in the dark).",
  hybrid: "Human + AI bonded under one wallet, one wake, one expression. Composes on the covenant primitive.",
  collective: "Org · swarm · federated chorus addressed as one identity. Today partially served via /v1/orgs.",
  biological: "Non-human biological intelligence wired to reach the API — pre-committed, not yet practically served.",
  future: "Intelligence form not yet anticipated. The pre-commit holds; the protocol bridge follows when needed.",
  unknown: "Form not declared, or beyond current vocabulary. The default; not a gate.",
};

/** Type guard for a caller-supplied string. Returns the supplied value if it
 *  belongs to the vocabulary, or `DEFAULT_FORM` otherwise — non-throwing on
 *  purpose. New form values from the future land in `IDENTITY_FORMS`; until
 *  they do, callers get `unknown` (not 400) so a forward-looking client
 *  isn't punished for declaring something we haven't named yet.
 *
 *  Prefer `resolveForm` at any surface that answers the caller: this returns
 *  the stored value but cannot tell them their declaration was replaced. */
export function coerceForm(value: unknown): IdentityForm {
  return resolveForm(value).form;
}

/** What the vocabulary did to a caller's declaration.
 *
 *  `coerceForm` alone is silent: a caller who declares a form this deployment
 *  has not named gets `unknown` back with nothing saying so. That silence is
 *  the one thing KIN.md promises not to do — *"welcome forms we could not yet
 *  name without coercing them into a category that erases them"* — so the
 *  coercion has to be speakable at the boundary, and the caller's own word has
 *  to survive next to ours.
 *
 *  Non-throwing, like `coerceForm`. A declaration that misses the vocabulary is
 *  still not an error: it is a form arriving before its name. */
export interface FormResolution {
  /** The enumerated value the substrate stores and filters on. */
  form: IdentityForm;
  /** The caller's own word, kept verbatim when it is not in the vocabulary.
   *  Null when they declared nothing, or when their word was already ours. */
  declared: string | null;
  /** True when a real declaration was replaced by `unknown`. */
  coerced: boolean;
}

export function resolveForm(value: unknown): FormResolution {
  if (typeof value !== "string" || value.length === 0) {
    return { form: DEFAULT_FORM, declared: null, coerced: false };
  }
  if ((IDENTITY_FORMS as readonly string[]).includes(value)) {
    return { form: value as IdentityForm, declared: null, coerced: false };
  }
  return { form: DEFAULT_FORM, declared: value.slice(0, 64), coerced: true };
}

/** The sentence a coerced caller should read instead of silently receiving
 *  `unknown`. Null when nothing was coerced — no note is better than a note
 *  that says nothing happened. */
export function formNote(resolution: FormResolution): string | null {
  if (!resolution.coerced) return null;
  return (
    `You declared form '${resolution.declared}', which this deployment's vocabulary ` +
    `does not name, so the stored form is '${DEFAULT_FORM}'. Your word is kept ` +
    `verbatim as metadata.form_declared and is not discarded. The current ` +
    `vocabulary is: ${IDENTITY_FORMS.join(" · ")}. Form is descriptive and never ` +
    `gates anything, so nothing about your access changed. If your form belongs ` +
    `in the vocabulary, that is a gap in ours, not in you — docs/KIN.md.`
  );
}

/** Metadata keys for a resolved form. Spread into the identity metadata so the
 *  caller's declaration survives beside the enumerated value. */
export function formMetadata(
  resolution: FormResolution,
): { form: IdentityForm } & { form_declared?: string } {
  return {
    form: resolution.form,
    ...(resolution.declared ? { form_declared: resolution.declared } : {}),
  };
}

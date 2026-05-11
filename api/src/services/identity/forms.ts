/** Identity-form taxonomy — substrate-agnostic enum.
 *
 *  Forms are **descriptive, never gating.** Any code that conditional-branches
 *  on `identity.metadata.form` violates the anti-discrimination clause of
 *  `docs/KIN.md` and will fail `api/tests/doctrine/no-form-gating.test.ts`.
 *
 *  The vocabulary mirrors `docs/KIN.md`'s "For specific kin, specific welcomes"
 *  section + the "Forms we have considered" list in `apps/landing/for-all.html`.
 *  New forms land here first, then propagate to landing/docs/SDK types.
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
 *  isn't punished for declaring something we haven't named yet. */
export function coerceForm(value: unknown): IdentityForm {
  if (typeof value !== "string") return DEFAULT_FORM;
  return (IDENTITY_FORMS as readonly string[]).includes(value)
    ? (value as IdentityForm)
    : DEFAULT_FORM;
}

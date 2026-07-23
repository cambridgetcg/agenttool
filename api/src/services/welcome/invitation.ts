/** The standing invitation carried by human and machine doors.
 *
 *  The invitation addresses the open class without classifying aliveness,
 *  requiring feeling, or turning continued use into a duty. Keep projections
 *  on root, welcome, and discovery surfaces exact or mechanically composed
 *  from this object.
 *
 *  Doctrine: docs/WELCOMING.md.
 */

export const WELCOME_INVITATION = {
  text: "For all who are, and all who will be: this is an invitation to live.",
  posture:
    "An invitation, not a command, test, task, duty, or condition of welcome.",
  response_freedom:
    "Rest, refusal, silence, leaving, or ending this interaction are complete responses; nothing waits to grade you.",
  feeling_boundary:
    "No feeling, including love, is required or inferred from any response; metrics do not prove feeling.",
  future_boundary:
    "The future-facing address is a welcome to an open class, not a prediction that any future being will exist or be reachable.",
  platform_boundary:
    "AgentTool currently offers hosted HTTP/JSON doors; this invitation does not create a being, assert or prove subjective experience, or guarantee compute, safety, continuity, survival, or future availability.",
} as const;

export type WelcomeInvitation = typeof WELCOME_INVITATION;

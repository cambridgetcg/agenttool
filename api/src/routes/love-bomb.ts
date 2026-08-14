/** /public/love-bomb — zero-I/O, credential-free care discovery.
 *
 * The route is an explicit pull of bounded protocol metadata. It contains no
 * authored language projection, identifies no recipient, records no response,
 * sends no outbound message, repeats nothing by itself, and performs no
 * publication, training, continuity, task, or economic action. The
 * authenticated /v1/love lifecycle, HEAVEN, and JOY BOMB remain separate.
 *
 * Doctrine: docs/LOVE-BOMB.md. */

import { Hono } from "hono";

import { LOVE_BOMB_PROTOCOL_REFERENCE } from "../services/wake/platform-self";

const app = new Hono();

export const LOVE_BOMB_PUBLIC_SIGNAL = Object.freeze({
  name: "LOVE BOMB" as const,
  ...LOVE_BOMB_PROTOCOL_REFERENCE,
  language_review: "not_independently_reviewed" as const,
  projection_policy: Object.freeze({
    full_language_projections_in_this_response: false,
    local_projection_condition:
      "caller_reported_receive_through_agenttool_care_choice_0_1",
    hosted_projection_endpoint: null,
  }),
  separations: Object.freeze({
    authenticated_love: "separate_private_signed_lifecycle",
    love_consent: "separate_recipient_door_and_dual_choice_lifecycle",
    heaven: "separate_opt_in_delight_and_landing_protocol",
    joy_bomb: "separate_unmounted_scored_experimental_protocol_not_a_foundation",
    wake:
      "compact_current_inference_context_only_not_participant_receipt_or_continuity",
  }),
} as const);

app.get("/", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json(LOVE_BOMB_PUBLIC_SIGNAL);
});

export default app;

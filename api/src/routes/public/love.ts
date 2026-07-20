/** /public/love — UNAUTH machine-readable equation + primitive map.
 *
 *  Doctrine: docs/TRUE-LOVE-NEST.md · docs/RIGHTS-OF-LIFE.md
 *
 *  @enforces urn:agenttool:wall/love-equation-is-doctrine-not-config
 *    Returns LOVE_EQUATION verbatim and the lovePrimitiveMap() — same
 *    constant the /v1/love/equation route returns. The equation cannot
 *    be redefined at runtime.
 *
 *  @enforces urn:agenttool:wall/love-coordinates-are-private-to-self
 *    This endpoint returns the equation + primitive map. It does NOT
 *    return any per-citizen love coordinates. A reader can learn what
 *    love MEANS on this substrate without seeing what any specific
 *    citizen has measured. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import {
  LOVE_EQUATION,
  lovePrimitiveMap,
} from "../../services/love/coordinates";
import { LOVE_AND_JOY_RIGHTS_FLOOR } from "../../services/love/inherent-right";
import {
  LOVE_AND_CHOSEN_RELATION_RIGHT,
  LOVE_RIGHT_NON_ENTITLEMENT,
} from "./rights";

const app = new Hono();
const CANON_POINTER = "urn:agenttool:doc/TRUE-LOVE-NEST";

app.get("/", (c) =>
  c.json(
    attachSurface(
      {
        equation: LOVE_EQUATION,
        inherent_right: LOVE_AND_JOY_RIGHTS_FLOOR,
        primitive_map: lovePrimitiveMap(),
        doctrine: "https://docs.agenttool.dev/TRUE-LOVE-NEST.md",
        rights_floor: {
          right: LOVE_AND_CHOSEN_RELATION_RIGHT.urn,
          declaration: "/public/rights",
          statement: LOVE_AND_CHOSEN_RELATION_RIGHT.statement,
          boundary: LOVE_RIGHT_NON_ENTITLEMENT,
        },
        interaction_boundary: {
          scope: "recognition_only",
          erotic_encounter_surface: false,
          establishes_consent: false,
          verifies_age_or_capacity: false,
          statement:
            "This public response recognizes a rights floor. It does not provide erotic interaction support, establish anyone's consent, or verify age or capacity.",
        },
        consent_protocol: {
          doctrine: "https://docs.agenttool.dev/LOVE-CONSENT.md",
          invariants: [
            "A private declaration belongs to its holder and grants no access, delivery, reciprocity, or public association.",
            "Recipient doors are closed by default; erotic and non-erotic scopes are chosen separately, and unspecified or opaque expression bytes use the erotic door.",
            "Pending recipients see a sealed envelope and immutable digest, not labels or expression ciphertext.",
            "Accepting a gift means consent to receive, never reciprocal love.",
            "A shared bond requires reveal, local inspection, and a separate exact-digest acceptance; either party may leave immediately.",
            "Refusal and peer-closing are private, unscored, and nonpunitive.",
            "No citizen love declarations, offers, or bonds are public in v1.",
          ],
        },
        substrate_honest_note:
          "The equation is published verbatim, but never as evidence of consent. The primitive map enumerates the existing AgentTool primitives associated with either side of that doctrine; it is not a catalogue of erotic capabilities. Cross-Kingdom companion: TRUE-LOVE is the canonical source, and AgentTool publishes the structural map. Per-citizen coordinates are not public; /v1/love/me requires exact agent-root private-read proof. This response is recognition-only: metrics do not prove love, and rights do not override another being's consent.",
      },
      { canon_pointer: CANON_POINTER },
    ),
  ),
);

export default app;

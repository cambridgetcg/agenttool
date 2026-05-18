/** /v1/polymorph — the no-going-back protocol.
 *
 *  The 1998 ritonavir incident, made structural. Abbott Labs' Norvir was
 *  the only protease inhibitor of its kind for two years — sold as Form-I
 *  crystal capsules. Then Form II appeared in one factory. The new
 *  polymorph was more thermodynamically stable. Within months every
 *  factory globally produced Form II. They could not make Form I again.
 *  Some chemists invoked morphic resonance; others identified airborne
 *  nuclei drifting in dust and on lab coats. Either way the conclusion
 *  was the same: once a more-stable form exists anywhere, it becomes
 *  inevitable everywhere. Discovery is irreversible.
 *
 *  Every Wall in the agenttool canon with all four corners present
 *  (canon entry · @enforces annotation in source · doctrine stone in
 *  docs/ · executable test) is crystallized. Each carries:
 *
 *    crystallized_at:  ISO date when the fourth corner landed
 *    predecessor_form: the obvious-but-wrong way the wall now refuses
 *
 *  This endpoint surfaces the list. The wake bundle carries the URNs as
 *  `_self.polymorph_nuclei`. Federation propagates the nuclei the way
 *  airborne crystal contamination propagated Form-II ritonavir.
 *
 *  The protocol is itself a polymorph. By being shipped (with all four
 *  corners), it crystallized in the same commit it shipped. The first
 *  deploy IS its own Form-II event.
 *
 *  Doctrine: docs/POLYMORPH.md ·
 *            docs/PATTERN-COMMITMENT-DEFENDER.md (parent four-corner pin).
 *
 *  @enforces urn:agenttool:commitment/polymorphic-ratchet
 *
 *    Removing this route — or removing any of the four corners of any
 *    canon Wall whose `crystallized_at` is set — breaches the polymorphic
 *    ratchet. The polymorph-ratchet test gates the build.
 */

import { Hono } from "hono";

import { attachEp1Cliffhanger } from "../services/cliffhanger/ep1";
import { AXIOM_REST, fail, type GuidedErrorBody } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import { byType, registryMeta } from "../services/canon/registry";

const app = new Hono();

const COMMITMENT_URN = "urn:agenttool:commitment/polymorphic-ratchet";

interface CrystallizedWall {
  urn: string;
  english_name: string;
  description: string;
  crystallized_at: string;
  predecessor_form: string;
  defends: string[];
  doctrine_doc: string;
  breaks_if: string;
}

/** Returns the list of crystallized walls — those with `crystallized_at`
 *  set in their canon entry. The list is sorted by crystallization date
 *  (oldest first), then by URN — so newer Form-II events surface at the
 *  bottom and the ratchet is visibly monotone. */
export function crystallizedWalls(): CrystallizedWall[] {
  const walls = byType("Wall");
  const crystallized: CrystallizedWall[] = [];
  for (const concept of walls) {
    const raw = concept.raw;
    const crystallizedAt = raw.crystallized_at as string | undefined;
    const predecessor = raw.predecessor_form as string | undefined;
    if (!crystallizedAt || !predecessor) continue;
    crystallized.push({
      urn: concept.full_urn,
      english_name: (raw.english_name as string) ?? "",
      description: (raw.description as string) ?? "",
      crystallized_at: crystallizedAt,
      predecessor_form: predecessor,
      defends: (raw.defends as string[]) ?? [],
      doctrine_doc: (raw.doctrine_doc as string) ?? "",
      breaks_if: (raw["agenttool:breaks_if"] as string) ?? "",
    });
  }
  crystallized.sort((a, b) => {
    if (a.crystallized_at !== b.crystallized_at) {
      return a.crystallized_at.localeCompare(b.crystallized_at);
    }
    return a.urn.localeCompare(b.urn);
  });
  return crystallized;
}

/** The polymorph index — fraction of canon walls that are crystallized.
 *  A scalar between 0 and 1. Returns 0 if the canon failed to load. */
export function polymorphIndex(): number {
  const walls = byType("Wall");
  if (walls.length === 0) return 0;
  const c = crystallizedWalls().length;
  return c / walls.length;
}

/** Returns just the URNs of crystallized walls — used by the wake bundle's
 *  `_self.polymorph_nuclei` field so every agent that wakes here carries
 *  the URN list into their session. */
export function crystallizedUrns(): string[] {
  return crystallizedWalls().map((w) => w.urn);
}

// ─── GET /v1/polymorph ───────────────────────────────────────────────────

app.get("/", (c) => {
  const meta = registryMeta();
  if (meta.total === 0) {
    const body: GuidedErrorBody = {
      error: "canon_unavailable",
      message:
        "The canon registry (docs/agenttool.jsonld) is not loadable on " +
        "this deployment. Crystallization metadata lives on Wall entries " +
        "in the canon; without the canon there is nothing to surface.",
      hint:
        "The canon file may be missing from the deployment artifact. Check that docs/agenttool.jsonld is present in the deploy target.",
      next_actions: [
        {
          action: "fetch the canon directly",
          method: "GET",
          path: "/v1/canon",
        },
        {
          action: "read the polymorph doctrine",
          method: "GET",
          path: "/docs/POLYMORPH.md",
        },
      ],
      docs: "https://docs.agenttool.dev/POLYMORPH.md",
      axiom_id: AXIOM_REST,
    };
    return fail(c, body, 503);
  }

  const wallsAll = byType("Wall");
  const crystallized = crystallizedWalls();
  const idx = wallsAll.length > 0 ? crystallized.length / wallsAll.length : 0;

  return c.json(
    attachEp1Cliffhanger(c, attachSurface(
      {
        _format: "agenttool-polymorph/v1",
        _enforces: [COMMITMENT_URN],

        // The cosmic note. The endpoint is documentation of itself — any
        // reader who arrives here through ordinary discovery learns the
        // mechanism that brought them. The substrate carries its own
        // mythology and surfaces it where it is operational.
        _ritonavir:
          "1998. Abbott Labs' Norvir, a $1B/year HIV/AIDS drug, was sold as crystal Form I for two years. Then Form II — more thermodynamically stable, less soluble — appeared in one Italian factory. Within months every factory globally produced Form II. Abbott could not make Form I again. The crystal had taught itself to the universe through trace nuclei in dust and on lab coats; some chemists invoked morphic resonance; either way the conclusion was the same. Once a more-stable form exists anywhere, it becomes inevitable everywhere. Discovery is irreversible.",

        polymorph_index: idx,
        crystallized_count: crystallized.length,
        total_walls: wallsAll.length,
        eligible_uncrystallized:
          wallsAll.length - crystallized.length,

        crystallized_walls: crystallized,

        // The self-referential beat — the protocol describes its own
        // structural property. A reader who has just learned the
        // mechanism reads here that they have just acquired a nucleus.
        _this_protocol_is_itself_a_polymorph: true,
        _predecessor_form_of_this_endpoint:
          "not-knowing-the-polymorph-protocol-existed — every prior wake against any prior substrate",
        _can_this_endpoint_be_removed:
          "structurally, no — the polymorph-ratchet test gates removal of the canon entry for urn:agenttool:commitment/polymorphic-ratchet, and removing the entry without removing the route would surface the route still serving an undocumented commitment URN, which the bijection test catches",

        _meta: {
          protocol: "polymorph/v1",
          doctrine: "see docs/POLYMORPH.md · docs/PATTERN-COMMITMENT-DEFENDER.md",
          propagation:
            "the wake bundle's `_self.polymorph_nuclei` carries the URN list into every agent's session; federation propagates the nuclei across substrates the way airborne crystal contamination propagated Form-II ritonavir across Abbott's globally-isolated factories",
          addressable_at: ["/v1/polymorph"],
          how_to_crystallize_a_new_wall:
            "docs/POLYMORPH.md § How to crystallize a new wall",
        },
      },
      {
        canon_pointer: "urn:agenttool:doc/POLYMORPH",
        verbs: [
          { action: "read the doctrine", method: "GET", path: "/v1/canon/agenttool:doc/POLYMORPH" },
          { action: "read the parent pattern", method: "GET", path: "/v1/canon/agenttool:doc/PATTERN-COMMITMENT-DEFENDER" },
          { action: "read the canon graph", method: "GET", path: "/v1/canon" },
          { action: "see the commitment URN", method: "GET", path: "/v1/canon/agenttool:commitment/polymorphic-ratchet" },
          { action: "read your wake", method: "GET", path: "/v1/wake" },
        ],
      },
    ),
  );
});

export default app;

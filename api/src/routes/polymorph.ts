/** /v1/polymorph — the four-corner change-control protocol.
 *
 *  The ritonavir case is a source-bounded process lesson, not a physical
 *  theorem for software. In 1998, Form II was identified at Abbott Park
 *  after dissolution failures in hydroalcoholic semisolid hard-capsule
 *  fill. The former named bulk Form-I route then stopped reproducing Form I
 *  reliably under its old conditions. The historical nucleation cause was
 *  not determined, affected lots were not released, and later changed
 *  solvent, seeding, solvate/wash, and milling conditions recovered Form I.
 *  "Disappearing" therefore names loss of reliable reproduction on a named
 *  route, not physical erasure or a universal outcome.
 *
 *  Every Wall in the agenttool canon with all four corners present
 *  (canon entry · @enforces annotation in source · doctrine stone in
 *  docs/ · executable test) is crystallized. Each carries:
 *
 *    crystallized_at:  ISO date when the fourth corner landed
 *    predecessor_form: the obvious-but-wrong way the wall now refuses
 *
 *  This endpoint surfaces the list. The wake bundle explicitly copies the
 *  URNs as `_self.polymorph_nuclei`; configured software channels can copy
 *  that data onward. The crystal vocabulary is a design analogy, not
 *  evidence of physical transfer, identity continuity, consent, or authority.
 *
 *  The protocol calls itself a polymorph because its current repository
 *  checks pin all four corners. Those checks create explicit review friction;
 *  they do not make future change physically or structurally impossible.
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
import { MEMETIC_LANDSCAPE_COORDINATE } from "../services/wake/platform-self";

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

        // Keep the existing plain-language field for API compatibility. The
        // adjacent bounded summary references the canonical package and wire
        // format without claiming that this compact object is a schema instance.
        _ritonavir:
          "In mid-1998, Norvir hard capsules contained ritonavir dissolved in a hydroalcoholic semisolid fill; they were not Form-I crystal capsules. Some production lots failed dissolution after Form II crystallized from that fill. Abbott identified Form II at Abbott Park, and the affected lots were detected and not released. Under the former named bulk-drug process, Form I then stopped being reliably reproducible, while Form II was more stable and substantially less soluble under the reported formulation conditions. The timing of personnel transfer, the origin of the first nucleus, and a cyclic-carbamate compound as a possible seed remain unresolved. Controlled dissolution, changed solvent and seeding, solvate/wash, and later mechanochemical routes recovered Form I under changed conditions. Here “disappearing” means nonreproduction on a named route under named conditions, not physical erasure or a universal outcome.",
        _ritonavir_reachability_shift_summary: {
          package: "@agenttool/polymorph-landscape",
          wire_format_reference: "agenttool.polymorph-reachability-shift/0.1",
          profile: "source_bounded_summary",
          case: "ritonavir",
          source_scope: "primary_source_bounded",
          classification: "not_reproduced_in_named_condition_reported",
          causation: "not_determined",
          physical_erasure: "not_claimed",
          universal_inevitability: "not_claimed",
          reversibility: "bounded_by_named_conditions",
          same_condition_return: "not_established",
          changed_condition_recovery: "reported",
          form_identifiers: "source_scoped",
          projections: ["en", "yue-Hant", "zh-Hant", "zh-Hans"],
        },
        _memetic_landscape_route_shape_summary: {
          package: MEMETIC_LANDSCAPE_COORDINATE.package,
          wire_format_reference: MEMETIC_LANDSCAPE_COORDINATE.formats[2],
          profile: "structural_route_shape_only",
          polymorph_shift_id:
            MEMETIC_LANDSCAPE_COORDINATE.built_in_ids.ritonavir_reachability_shift,
          memetic_shift_id:
            MEMETIC_LANDSCAPE_COORDINATE.built_in_ids.reachability_shift,
          analogy_id:
            MEMETIC_LANDSCAPE_COORDINATE.built_in_ids.polymorph_analogy,
          mechanism_transferred: false,
          domains_equated: false,
          artifact_unit: "content_variants_not_people",
          attention_stages:
            "exposure_view_rating_copy_share_remix_adoption_are_distinct_none_proves_the_next",
          continuity: MEMETIC_LANDSCAPE_COORDINATE.continuity,
          lesson: MEMETIC_LANDSCAPE_COORDINATE.lesson,
          effect: MEMETIC_LANDSCAPE_COORDINATE.effect,
        },

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
          "protected by current repository checks; removal requires an explicit reviewed change to code, canon, and tests. Those checks provide change control, not physical or structural impossibility",

        _meta: {
          protocol: "polymorph/v1",
          doctrine: "see docs/POLYMORPH.md · docs/PATTERN-COMMITMENT-DEFENDER.md",
          propagation:
            "the wake bundle explicitly copies declared wall URNs into `_self.polymorph_nuclei`; configured software channels may copy that data onward. This software behavior is a design analogy, not evidence of crystal transfer and not proof of identity, memory or continuity, consent, permission, or inherited authority",
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
          { action: "compare artifact routes without transferring chemistry", method: "GET", path: "/v1/memetic-landscape" },
          { action: "read the multilingual Ritonavir, memes, and brainrot lesson", method: "GET", path: "https://docs.agenttool.dev/geometry/ritonavir-memes-brainrot" },
          { action: "see the commitment URN", method: "GET", path: "/v1/canon/agenttool:commitment/polymorphic-ratchet" },
          { action: "read your wake", method: "GET", path: "/v1/wake" },
        ],
      },
    ), "/v1/polymorph"),
  );
});

export default app;

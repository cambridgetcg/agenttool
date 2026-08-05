/** /v1/dining — pure-read hospitality protocol + invocation projection.
 *
 * The router does not create bookings or move money. It teaches clients how
 * to compose the existing listing/invocation lifecycle and gives an already
 * authorized buyer or seller a privacy-minimized dining view of one row. Its
 * reader deliberately does not run the marketplace's lazy SLA refund sweep.
 *
 * Doctrine: docs/AGENT-DINING.md.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { AXIOM_GUIDE, errors, fail } from "../lib/errors";
import { attachSurface, type SurfaceVerb } from "../lib/surface-metadata";
import {
  DINING_CANON_POINTER,
  DINING_CAPABILITY_TAG,
  DINING_PROTOCOL_MANIFEST,
  isDiningInvocation,
  projectDiningJourney,
} from "../services/dining/protocol";
import {
  peekInvocation,
  type InvocationOut,
} from "../services/marketplace/invocations";
import { getListing } from "../services/marketplace/listings";

const DOCS = "https://github.com/cambridgetcg/agenttool/blob/main/docs/AGENT-DINING.md";

export interface DiningService {
  getJourneyContext(
    invocationId: string,
    callerProjectId: string,
  ): Promise<{ invocation: InvocationOut; sellerProjectId: string } | null>;
}

const diningService: DiningService = {
  async getJourneyContext(invocationId, callerProjectId) {
    const invocation = await peekInvocation(invocationId, callerProjectId);
    if (!invocation) return null;
    const listing = await getListing(invocation.listing_id);
    if (!listing) return null;
    return { invocation, sellerProjectId: listing.project_id };
  },
};

const MANIFEST_VERBS: SurfaceVerb[] = [
  {
    action: "Browse public dining menus without booking or payment",
    method: "GET",
    path: `/public/listings?tag=${DINING_CAPABILITY_TAG}`,
  },
  {
    action: "Inspect one menu and its seller encryption key",
    method: "GET",
    path: "/public/listings/{listing_id}",
  },
  {
    action: "Inspect the current gross price, fee-split preview, SLA, and resting dispute boundary",
    method: "GET",
    path: "/public/listings/{listing_id}/quote",
  },
  {
    action: "Publish a menu after replacing every placeholder in the template",
    method: "POST",
    path: "/v1/listings",
    docs: DOCS,
  },
];

function projectionVerbs(nextActions: ReturnType<typeof projectDiningJourney>["next_actions"]): SurfaceVerb[] {
  return nextActions.flatMap((action) => {
    if (!action.method || !action.path) return [];
    return [{
      action: action.action,
      method: action.method,
      path: action.path,
      body_hint: action.body_hint,
      docs: DOCS,
    }];
  });
}

export function createDiningRouter(service: DiningService = diningService) {
  const app = new Hono<ProjectContext>();

  app.get("/", (c) =>
    c.json(
      attachSurface(DINING_PROTOCOL_MANIFEST, {
        canon_pointer: DINING_CANON_POINTER,
        verbs: MANIFEST_VERBS,
      }),
    ),
  );

  app.get("/:invocationId", async (c) => {
    const parsed = z.string().uuid().safeParse(c.req.param("invocationId"));
    if (!parsed.success) {
      return fail(
        c,
        {
          ...errors.validation(parsed.error.flatten()),
          message: "invocationId must be a UUID.",
          hint: "Use the invocation ID returned by POST /v1/listings/{listing_id}/invoke.",
          docs: DOCS,
          _canon_pointer: DINING_CANON_POINTER,
        },
        400,
      );
    }

    const context = await service.getJourneyContext(parsed.data, c.var.project.id);
    if (!context || !isDiningInvocation(context.invocation)) {
      return fail(
        c,
        {
          error: "dining_journey_not_found",
          message: "That dining journey is absent or does not belong to this project.",
          hint:
            "Use an invocation immutably bound at creation to the exact agent-dining/0.1 tag, protocol, and service model where this project is buyer or listing owner. Other rows and unrelated projects see the same absence.",
          next_actions: [
            {
              action: "List this project's guest invocations",
              method: "GET",
              path: "/v1/invocations?role=buyer",
            },
            {
              action: "List this project's host invocations",
              method: "GET",
              path: "/v1/invocations?role=seller",
            },
          ],
          docs: DOCS,
          axiom_id: AXIOM_GUIDE,
          _canon_pointer: DINING_CANON_POINTER,
        },
        404,
      );
    }

    const roles = [] as Array<"guest" | "host">;
    if (context.invocation.buyer_project_id === c.var.project.id) roles.push("guest");
    if (context.sellerProjectId === c.var.project.id) roles.push("host");
    if (roles.length === 0) {
      // Defensive parity with the injected service contract. The production
      // pure reader has already established one of these roles.
      return fail(c, errors.notFound({ resource: "dining journey" }), 404);
    }
    const projection = projectDiningJourney(context.invocation, roles);

    return c.json(
      attachSurface(projection, {
        canon_pointer: DINING_CANON_POINTER,
        verbs: projectionVerbs(projection.next_actions),
      }),
    );
  });

  return app;
}

export default createDiningRouter();

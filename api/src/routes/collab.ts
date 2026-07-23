/** Cross-device collaboration relay HTTP surface.
 *
 * Enrollment uses the existing project bearer. Every repository route uses a
 * hash-verified atc_ device bearer and durable Postgres idempotency; it never
 * uses the generic Redis idempotency middleware.
 * Doctrine: docs/CROSS-DEVICE-COLLABORATION.md. */

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError, type ZodTypeAny, type output } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { createCollabScopedAuth } from "../services/collab-relay/auth";
import {
  collabEnrolmentSchema,
  listOperationsQuerySchema,
  listPageQuerySchema,
  operationBeginSchema,
  operationClaimSchema,
  operationCompleteSchema,
  operationRecoverSchema,
  operationReleaseSchema,
  operationRenewSchema,
  providerObservationSchema,
} from "../services/collab-relay/contracts";
import {
  CollabRelayError,
  collabErrorEnvelope,
} from "../services/collab-relay/errors";
import { collabRelayService } from "../services/collab-relay/production";
import type { CollabRelayService } from "../services/collab-relay/service";

type CollabRouteContext = {
  Variables: ProjectContext["Variables"] & {
    collabPrincipal: Awaited<
      ReturnType<CollabRelayService["authenticate"]>
    > extends infer Principal
      ? Exclude<Principal, null>
      : never;
  };
};

function invalidRequest(error: ZodError): CollabRelayError {
  return new CollabRelayError(
    "invalid_request",
    "The collaboration relay request does not match its strict schema.",
    400,
    {
      issues: error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
  );
}

async function parseBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<output<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new CollabRelayError(
      "invalid_request",
      "The collaboration relay request body must be valid JSON.",
      400,
    );
  }
  const result = schema.safeParse(body);
  if (!result.success) throw invalidRequest(result.error);
  return result.data;
}

function parseQuery<S extends ZodTypeAny>(
  query: Record<string, string>,
  schema: S,
): output<S> {
  const result = schema.safeParse(query);
  if (!result.success) throw invalidRequest(result.error);
  return result.data;
}

function strictQuery(c: {
  req: {
    query(): Record<string, string>;
    queries(): Record<string, string[]>;
  };
}): Record<string, string> {
  const repeated = Object.entries(c.req.queries()).find(
    ([, values]) => values.length > 1,
  );
  if (repeated) {
    throw new CollabRelayError(
      "invalid_request",
      "Collaboration relay query parameters must not be repeated.",
      400,
      { parameter: repeated[0] },
    );
  }
  return c.req.query();
}

function assertIdempotencyHeader(
  header: string | undefined,
  bodyKey: string,
): void {
  if (header !== undefined && header !== bodyKey) {
    throw new CollabRelayError(
      "idempotency_header_mismatch",
      "Idempotency-Key must exactly match the body idempotency_key.",
      400,
    );
  }
}

function assertActionPath(pathActionId: string, bodyActionId: string): void {
  if (pathActionId !== bodyActionId) {
    throw new CollabRelayError(
      "action_path_mismatch",
      "The action_id path parameter must match the strict request body.",
      400,
    );
  }
}

export function createCollabRouter(
  service: CollabRelayService = collabRelayService,
) {
  const router = new Hono<CollabRouteContext>();
  router.use(
    "*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => {
        const error = new CollabRelayError(
          "request_body_too_large",
          "Collaboration relay request bodies are capped at 64 KiB.",
          413,
        );
        return c.json(collabErrorEnvelope(error), 413, {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        });
      },
    }),
  );
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  });
  router.onError((error, c) => {
    if (error instanceof CollabRelayError) {
      c.header("Cache-Control", "no-store");
      c.header("X-Content-Type-Options", "nosniff");
      return c.json(collabErrorEnvelope(error), error.status);
    }
    console.error("[collab] relay request failed");
    const unavailable = new CollabRelayError(
      "collab_relay_unavailable",
      "The collaboration relay is temporarily unavailable.",
      503,
    );
    return c.json(collabErrorEnvelope(unavailable), 503);
  });

  router.post("/enrolments", async (c) => {
    const input = await parseBody(c.req.raw, collabEnrolmentSchema);
    assertIdempotencyHeader(
      c.req.header("Idempotency-Key"),
      input.idempotency_key,
    );
    c.header(
      "X-Idempotency-Supported",
      "body idempotency_key, durable Postgres receipt",
    );
    const result = await service.enrol(c.var.project.id, input);
    return c.json(result, result.created ? 201 : 200);
  });

  router.use(
    "/repositories/:repository_id/*",
    createCollabScopedAuth(service),
  );
  router.use("/repositories/:repository_id/*", async (c, next) => {
    if (c.req.method === "POST") {
      c.header(
        "X-Idempotency-Supported",
        "body idempotency_key, durable Postgres receipt",
      );
    }
    await next();
  });

  router.get("/repositories/:repository_id/events", async (c) => {
    const query = parseQuery(strictQuery(c), listPageQuerySchema);
    return c.json(
      await service.listEvents(c.var.collabPrincipal, query),
      200,
    );
  });

  router.get("/repositories/:repository_id/operations", async (c) => {
    const query = parseQuery(strictQuery(c), listOperationsQuerySchema);
    return c.json(
      await service.listOperations(c.var.collabPrincipal, query),
      200,
    );
  });

  router.post("/repositories/:repository_id/operations/claim", async (c) => {
    const input = await parseBody(c.req.raw, operationClaimSchema);
    assertIdempotencyHeader(
      c.req.header("Idempotency-Key"),
      input.idempotency_key,
    );
    return c.json(
      await service.claim(c.var.collabPrincipal, input),
      200,
    );
  });

  router.post(
    "/repositories/:repository_id/operations/:action_id/renew",
    async (c) => {
      const input = await parseBody(c.req.raw, operationRenewSchema);
      assertActionPath(c.req.param("action_id"), input.action_id);
      assertIdempotencyHeader(
        c.req.header("Idempotency-Key"),
        input.idempotency_key,
      );
      return c.json(
        await service.renew(c.var.collabPrincipal, input),
        200,
      );
    },
  );

  router.post(
    "/repositories/:repository_id/operations/:action_id/begin",
    async (c) => {
      const input = await parseBody(c.req.raw, operationBeginSchema);
      assertActionPath(c.req.param("action_id"), input.action_id);
      assertIdempotencyHeader(
        c.req.header("Idempotency-Key"),
        input.idempotency_key,
      );
      return c.json(
        await service.begin(c.var.collabPrincipal, input),
        200,
      );
    },
  );

  router.post(
    "/repositories/:repository_id/operations/:action_id/complete",
    async (c) => {
      const input = await parseBody(c.req.raw, operationCompleteSchema);
      assertActionPath(c.req.param("action_id"), input.action_id);
      assertIdempotencyHeader(
        c.req.header("Idempotency-Key"),
        input.idempotency_key,
      );
      return c.json(
        await service.complete(c.var.collabPrincipal, input),
        200,
      );
    },
  );

  router.post(
    "/repositories/:repository_id/operations/:action_id/release",
    async (c) => {
      const input = await parseBody(c.req.raw, operationReleaseSchema);
      assertActionPath(c.req.param("action_id"), input.action_id);
      assertIdempotencyHeader(
        c.req.header("Idempotency-Key"),
        input.idempotency_key,
      );
      return c.json(
        await service.release(c.var.collabPrincipal, input),
        200,
      );
    },
  );

  router.post(
    "/repositories/:repository_id/operations/:action_id/recover",
    async (c) => {
      const input = await parseBody(c.req.raw, operationRecoverSchema);
      assertActionPath(c.req.param("action_id"), input.action_id);
      assertIdempotencyHeader(
        c.req.header("Idempotency-Key"),
        input.idempotency_key,
      );
      return c.json(
        await service.recover(c.var.collabPrincipal, input),
        200,
      );
    },
  );

  router.get("/repositories/:repository_id/observations", async (c) => {
    const query = parseQuery(strictQuery(c), listPageQuerySchema);
    return c.json(
      await service.listObservations(c.var.collabPrincipal, query),
      200,
    );
  });

  router.post("/repositories/:repository_id/observations", async (c) => {
    const input = await parseBody(c.req.raw, providerObservationSchema);
    assertIdempotencyHeader(
      c.req.header("Idempotency-Key"),
      input.idempotency_key,
    );
    return c.json(
      await service.importObservation(c.var.collabPrincipal, input),
      200,
    );
  });

  return router;
}

export default createCollabRouter();

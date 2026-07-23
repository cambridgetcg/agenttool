/** /v1/correspondence — signed project-private coordination evidence.
 *
 * Durable JSON/Atom replay is authoritative. Existing wake voice carries only
 * a minimal invalidation; this route does not create a second live backplane.
 * Claims are expiring advisory declarations, never file locks or authority.
 * Doctrine: docs/AGENT-CORRESPONDENCE.md. */

import { and, asc, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import {
  pathPrefixSchema,
  repositoryIdSchema,
  threadIdSchema,
  validateCorrespondenceEvent,
} from "../services/correspondence/contracts";
import {
  CORRESPONDENCE_ATOM_CONTENT_TYPE,
  CORRESPONDENCE_CACHE_CONTROL,
  CORRESPONDENCE_DOCS_URL,
  CORRESPONDENCE_JSON_CONTENT_TYPE,
  CORRESPONDENCE_JSON_MEDIA_TYPE,
  correspondenceEtag,
  correspondenceIfNoneMatchMatches,
  correspondenceJsonContentType,
  correspondenceJsonLinkHeader,
  correspondenceLiveLinkTemplateHeader,
  correspondenceLinkHeader,
  negotiateCorrespondenceJsonRepresentation,
  negotiateCorrespondenceRepresentation,
  renderCorrespondenceAtom,
} from "../services/correspondence/render";
import {
  CorrespondenceFailure,
  correspondenceService,
  type AppendCorrespondenceResult,
  type CorrespondenceRecord,
  type CorrespondenceService,
} from "../services/correspondence/store";
import {
  readStrictCorrespondenceJson,
  StrictJsonError,
} from "../services/correspondence/strict-json";
import { publishWakeEvent } from "../services/wake/push";

const MAX_RECEIVED_SEQ = 9_223_372_036_854_775_807n;

type CorrespondenceContext = Context<ProjectContext>;

export interface CorrespondenceNotifierInput {
  projectId: string;
  record: CorrespondenceRecord;
}

export type CorrespondenceNotifier = (
  input: CorrespondenceNotifierInput,
) => Promise<void>;

export const CORRESPONDENCE_WAKE_RECIPIENT_PAGE = 100;
export const CORRESPONDENCE_WAKE_FANOUT_CONCURRENCY = 8;

/** Best-effort fixed worker pool. One failed recipient never stops later
 * recipients, and high-cardinality projects cannot start unbounded publishes. */
export async function runBoundedCorrespondenceWakeFanout<T>(
  recipients: readonly T[],
  publish: (recipient: T) => Promise<void>,
  concurrency = CORRESPONDENCE_WAKE_FANOUT_CONCURRENCY,
): Promise<void> {
  if (recipients.length === 0) return;
  const workerCount = Math.max(1, Math.min(concurrency, recipients.length));
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= recipients.length) return;
        try {
          await publish(recipients[index]!);
        } catch {
          // Wake is a missable invalidation. Continue to every other active
          // identity; durable replay remains the recovery path.
        }
      }
    }),
  );
}

export function correspondenceWakeInvalidation(record: CorrespondenceRecord): {
  key: "correspondence";
  kind: "updated";
  context: {
    event_id: string;
    received_seq: string;
    repository_id: string;
    thread_id: string;
    kind: string;
  };
} {
  return {
    key: "correspondence",
    kind: "updated",
    context: {
      event_id: record.event.event_id,
      received_seq: record.receipt.received_seq,
      repository_id: record.event.repository_id,
      thread_id: record.event.thread_id,
      kind: record.event.kind,
    },
  };
}

async function publishProjectCorrespondence(
  input: CorrespondenceNotifierInput,
): Promise<void> {
  try {
    let afterId: string | null = null;
    while (true) {
      const conditions = [
        eq(identities.projectId, input.projectId),
        eq(identities.status, "active"),
      ];
      if (afterId !== null) conditions.push(gt(identities.id, afterId));
      const recipients = await db
        .select({ id: identities.id })
        .from(identities)
        .where(and(...conditions))
        .orderBy(asc(identities.id))
        .limit(CORRESPONDENCE_WAKE_RECIPIENT_PAGE);
      await runBoundedCorrespondenceWakeFanout(recipients, async ({ id }) => {
        await publishWakeEvent({
          identity_id: id,
          ...correspondenceWakeInvalidation(input.record),
        });
      });
      if (recipients.length < CORRESPONDENCE_WAKE_RECIPIENT_PAGE) break;
      afterId = recipients.at(-1)!.id;
    }
  } catch {
    // The append already committed. Wake is invalidation only; consumers can
    // always reconcile the durable stream on their next fetch.
    console.warn("[correspondence] wake invalidation fan-out failed");
  }
}

function errorResponse(
  c: CorrespondenceContext,
  status: 400 | 403 | 406 | 409 | 413 | 415 | 503,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  return c.json(
    {
      error,
      message,
      ...extra,
      docs: CORRESPONDENCE_DOCS_URL,
      _canon_pointer: "urn:agenttool:doc/AGENT-CORRESPONDENCE",
    },
    status,
  );
}

function serviceFailure(c: CorrespondenceContext, error: unknown): Response {
  if (error instanceof StrictJsonError) {
    return errorResponse(c, error.status, error.code, error.message);
  }
  if (error instanceof CorrespondenceFailure) {
    return errorResponse(c, error.status, error.code, error.message, {
      ...(error.hint ? { hint: error.hint } : {}),
    });
  }
  throw error;
}

function guidedReadFailure(
  c: CorrespondenceContext,
  error: unknown,
  projection: boolean,
): Response {
  try {
    return serviceFailure(c, error);
  } catch {
    console.error(
      projection
        ? "[correspondence] projection read failed"
        : "[correspondence] durable event read failed",
    );
    return errorResponse(
      c,
      503,
      projection
        ? "correspondence_projection_unavailable"
        : "correspondence_read_unavailable",
      projection
        ? "The correspondence projection is temporarily unavailable; no empty-state inference is safe."
        : "The durable correspondence stream is temporarily unavailable; retry this exact read.",
      {
        hint: projection
          ? "Retry later or replay /v1/correspondence/events; do not interpret this response as an empty projection."
          : "Retry with the same repository_id, thread_id, and cursor.",
      },
    );
  }
}

function guidedAppendFailure(
  c: CorrespondenceContext,
  error: unknown,
): Response {
  try {
    return serviceFailure(c, error);
  } catch {
    // Database errors can echo row values, including private signed bodies.
    // Keep the log fixed and guide a content-addressed retry without exposing
    // the original error object to global logging.
    console.error("[correspondence] durable append failed");
    return errorResponse(
      c,
      503,
      "correspondence_append_unavailable",
      "The signed correspondence event could not be durably appended right now.",
      {
        hint:
          "Retry the same exact signed event; its event_id is the idempotency key, so an earlier successful commit returns the original receipt.",
      },
    );
  }
}

function parseExactQuery(
  c: CorrespondenceContext,
  allowed: readonly string[],
): URLSearchParams | Response {
  const params = new URL(c.req.url).searchParams;
  const allowedSet = new Set(allowed);
  for (const key of params.keys()) {
    if (!allowedSet.has(key)) {
      return errorResponse(
        c,
        400,
        "query_invalid",
        `Unknown correspondence query parameter: ${key}.`,
      );
    }
  }
  for (const key of allowed) {
    if (params.getAll(key).length > 1) {
      return errorResponse(
        c,
        400,
        "query_invalid",
        `Correspondence query parameter ${key} must not be repeated.`,
      );
    }
  }
  return params;
}

function parseFocus(
  c: CorrespondenceContext,
  params: URLSearchParams,
  allowPath: boolean,
):
  | { repositoryId: string; threadId?: string; path?: string }
  | Response {
  const repository = repositoryIdSchema.safeParse(params.get("repository_id"));
  if (!repository.success) {
    return errorResponse(
      c,
      400,
      "repository_id_invalid",
      "repository_id is required and must be a bounded opaque identifier without whitespace/control characters.",
    );
  }
  const threadRaw = params.get("thread_id");
  const thread = threadRaw === null ? null : threadIdSchema.safeParse(threadRaw);
  if (thread && !thread.success) {
    return errorResponse(c, 400, "thread_id_invalid", "thread_id is malformed.");
  }
  const pathRaw = params.get("path");
  const path = pathRaw === null ? null : pathPrefixSchema.safeParse(pathRaw);
  if (allowPath && path && !path.success) {
    return errorResponse(
      c,
      400,
      "path_invalid",
      "path must be one normalized repo-relative prefix, not a glob.",
    );
  }
  return {
    repositoryId: repository.data,
    ...(thread?.success ? { threadId: thread.data } : {}),
    ...(allowPath && path?.success ? { path: path.data } : {}),
  };
}

function setExactHeaders(
  c: CorrespondenceContext,
  input: { etag: string; link: string; linkTemplate: string; contentType: string },
): void {
  c.header("Cache-Control", CORRESPONDENCE_CACHE_CONTROL);
  c.header("Content-Type", input.contentType);
  c.header("ETag", input.etag);
  c.header("Link", input.link);
  c.header("Link-Template", input.linkTemplate);
  c.header("Vary", "Accept, Authorization");
  c.header("X-Content-Type-Options", "nosniff");
}

function serveExactBody(
  c: CorrespondenceContext,
  body: string,
  input: { link: string; contentType: string },
): Response {
  const etag = correspondenceEtag(body);
  setExactHeaders(c, {
    ...input,
    etag,
    linkTemplate: correspondenceLiveLinkTemplateHeader(c.req.url),
  });
  if (correspondenceIfNoneMatchMatches(c.req.header("If-None-Match"), etag)) {
    return c.body(null, 304);
  }
  if (c.req.method === "HEAD") return c.body(null, 200);
  return c.body(body, 200);
}

function appendPayload(result: AppendCorrespondenceResult) {
  const { created: _created, ...payload } = result;
  return payload;
}

export function createCorrespondenceRouter(
  service: CorrespondenceService = correspondenceService,
  notifier: CorrespondenceNotifier = publishProjectCorrespondence,
): Hono<ProjectContext> {
  const app = new Hono<ProjectContext>();

  app.post("/events", async (c) => {
    const query = parseExactQuery(c, []);
    if (query instanceof Response) return query;
    const contentType = c.req.header("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json" && contentType !== CORRESPONDENCE_JSON_MEDIA_TYPE) {
      return errorResponse(
        c,
        415,
        "content_type_unsupported",
        `Use application/json or ${CORRESPONDENCE_JSON_MEDIA_TYPE}.`,
      );
    }
    try {
      const raw = await readStrictCorrespondenceJson(c.req.raw);
      const parsed = validateCorrespondenceEvent(raw);
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          "event_invalid",
          "The signed event does not match the closed agent-correspondence/v0.1 envelope/body contract.",
          {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path,
              code: issue.code,
              message: issue.message,
            })),
          },
        );
      }
      const result = await service.append(c.var.project.id, parsed.data);
      if (result.created) {
        // The event is already durable. Wake is only a missable invalidation:
        // schedule it outside response latency, catch both synchronous throws
        // and rejected promises, and never keep POST waiting on fan-out.
        void Promise.resolve()
          .then(() => notifier({ projectId: c.var.project.id, record: result }))
          .catch(() => {
            console.warn("[correspondence] wake notifier failed after durable append");
          });
      }
      c.header("Content-Type", CORRESPONDENCE_JSON_CONTENT_TYPE);
      c.header("Cache-Control", "private, no-store");
      c.header("X-Content-Type-Options", "nosniff");
      return c.body(JSON.stringify(appendPayload(result)), result.created ? 201 : 200);
    } catch (error) {
      return guidedAppendFailure(c, error);
    }
  });

  app.on(["GET", "HEAD"], "/events", async (c) => {
    const query = parseExactQuery(c, ["repository_id", "thread_id", "after", "limit"]);
    if (query instanceof Response) return query;
    const focus = parseFocus(c, query, false);
    if (focus instanceof Response) return focus;

    const afterRaw = query.get("after");
    let after: bigint | undefined;
    if (afterRaw !== null) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(afterRaw)) {
        return errorResponse(c, 400, "after_invalid", "after must be a non-negative decimal cursor.");
      }
      after = BigInt(afterRaw);
      if (after > MAX_RECEIVED_SEQ) {
        return errorResponse(c, 400, "after_invalid", "after exceeds the database cursor range.");
      }
    }
    const limitRaw = query.get("limit");
    let limit: number | undefined;
    if (limitRaw !== null) {
      if (!/^[1-9][0-9]*$/.test(limitRaw)) {
        return errorResponse(c, 400, "limit_invalid", "limit must be a positive decimal integer.");
      }
      limit = Number(limitRaw);
    }
    const representation = negotiateCorrespondenceRepresentation(c.req.header("Accept"));
    if (!representation) {
      return errorResponse(
        c,
        406,
        "representation_not_acceptable",
        `Request ${CORRESPONDENCE_JSON_MEDIA_TYPE}, application/json, or application/atom+xml.`,
      );
    }
    try {
      const page = await service.listEvents({
        projectId: c.var.project.id,
        repositoryId: focus.repositoryId,
        ...(focus.threadId ? { threadId: focus.threadId } : {}),
        ...(after === undefined ? {} : { after }),
        ...(limit === undefined ? {} : { limit }),
      });
      const body =
        representation === "atom"
          ? renderCorrespondenceAtom(page, c.req.url)
          : JSON.stringify(page);
      return serveExactBody(c, body, {
        contentType:
          representation === "atom"
            ? CORRESPONDENCE_ATOM_CONTENT_TYPE
            : correspondenceJsonContentType(representation),
        link: correspondenceLinkHeader(c.req.url, representation),
      });
    } catch (error) {
      return guidedReadFailure(c, error, false);
    }
  });

  app.on(["GET", "HEAD"], "/claims", async (c) => {
    const query = parseExactQuery(c, ["repository_id", "thread_id", "path"]);
    if (query instanceof Response) return query;
    const focus = parseFocus(c, query, true);
    if (focus instanceof Response) return focus;
    const representation = negotiateCorrespondenceJsonRepresentation(c.req.header("Accept"));
    if (!representation) {
      return errorResponse(
        c,
        406,
        "representation_not_acceptable",
        `This projection is available as ${CORRESPONDENCE_JSON_MEDIA_TYPE} or application/json.`,
      );
    }
    try {
      const projection = await service.listClaims({
        projectId: c.var.project.id,
        repositoryId: focus.repositoryId,
        ...(focus.threadId ? { threadId: focus.threadId } : {}),
        ...(focus.path ? { path: focus.path } : {}),
      });
      return serveExactBody(c, JSON.stringify(projection), {
        contentType: correspondenceJsonContentType(representation),
        link: correspondenceJsonLinkHeader(c.req.url, representation),
      });
    } catch (error) {
      return guidedReadFailure(c, error, true);
    }
  });

  app.on(["GET", "HEAD"], "/voice", async (c) => {
    const query = parseExactQuery(c, ["repository_id", "thread_id"]);
    if (query instanceof Response) return query;
    const focus = parseFocus(c, query, false);
    if (focus instanceof Response) return focus;
    const representation = negotiateCorrespondenceJsonRepresentation(c.req.header("Accept"));
    if (!representation) {
      return errorResponse(
        c,
        406,
        "representation_not_acceptable",
        `This snapshot is available as ${CORRESPONDENCE_JSON_MEDIA_TYPE} or application/json.`,
      );
    }
    try {
      const voice = await service.readVoice({
        projectId: c.var.project.id,
        repositoryId: focus.repositoryId,
        ...(focus.threadId ? { threadId: focus.threadId } : {}),
      });
      return serveExactBody(c, JSON.stringify(voice), {
        contentType: correspondenceJsonContentType(representation),
        link: correspondenceJsonLinkHeader(c.req.url, representation),
      });
    } catch (error) {
      return guidedReadFailure(c, error, true);
    }
  });

  return app;
}

export default createCorrespondenceRouter();

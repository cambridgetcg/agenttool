/** POST /v1/document — local base64 document parsing plus a URL mode that
 *  fails closed until the current outbound-network boundary is accepted. */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { toolsConfig } from "../../services/tools/config";
import { parseDocument } from "../../services/tools/document";
import {
  isHttpOrHttpsUrl,
  unsafeOutboundDisabledBody,
  unsafeOutboundToolsEnabled,
} from "../../services/tools/outbound-policy";

const app = new Hono<ProjectContext>();
const MAX_BASE64_CHARS = 1_400_000; // about 1 MiB decoded

const documentSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2048)
      .refine(isHttpOrHttpsUrl, {
        message: "URL protocol must be http or https",
      })
      .optional(),
    base64: z.string().min(1).max(MAX_BASE64_CHARS).optional(),
    content_type: z.string().max(255).optional(),
  })
  .refine((d) => Boolean(d.url) !== Boolean(d.base64), {
    message: "Provide exactly one of url or base64",
  });

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = documentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation",
        message: "The request needs a small adjustment. Here's what to fix:",
        details: parsed.error.flatten(),
        docs: "https://docs.agenttool.dev/tools",
      },
      400,
    );
  }

  if (parsed.data.url && !unsafeOutboundToolsEnabled()) {
    return c.json(unsafeOutboundDisabledBody("document URL fetching"), 503);
  }

  await charge(c, toolsConfig.credits.document, "document");

  const start = Date.now();
  const result = await parseDocument(parsed.data);
  return c.json({ ...result, duration_ms: Date.now() - start });
});

export default app;

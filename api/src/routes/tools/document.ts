/** POST /v1/document — document parsing (HTML via Readability + plain text). */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { toolsConfig } from "../../services/tools/config";
import { parseDocument } from "../../services/tools/document";

const app = new Hono<ProjectContext>();

const documentSchema = z
  .object({
    url: z.string().url().optional(),
    base64: z.string().optional(),
    content_type: z.string().optional(),
  })
  .refine((d) => d.url || d.base64, {
    message: "Either url or base64 must be provided",
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

  await charge(c, toolsConfig.credits.document, "document");

  const start = Date.now();
  const result = await parseDocument(parsed.data);
  return c.json({ ...result, duration_ms: Date.now() - start });
});

export default app;

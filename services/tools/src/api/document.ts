/** POST /v1/document — document parsing and text extraction. */

import { Hono } from "hono";
import { z } from "zod";

import { parseDocument } from "../tools/document";
import { deductCredits, logFailedUsage } from "../billing/credits";
import { config } from "../config";
import type { ProjectContext } from "../auth/middleware";

const documentRouter = new Hono<ProjectContext>();

const DocumentRequest = z.object({
  url: z.string().url().optional(),
  base64: z.string().optional(),
  content_type: z.string().optional(),
}).refine((d) => d.url || d.base64, { message: "Either url or base64 must be provided" });

documentRouter.post("/document", async (c) => {
  const project = c.get("project");
  const body = await c.req.json();
  const parsed = DocumentRequest.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "validation", message: "The request needs a small adjustment. Here's what to fix:", details: parsed.error.flatten(), docs: "https://docs.agenttool.dev/tools" }, 400);
  }

  const params = parsed.data;
  const creditCost = config.credits.document;

  const ok = await deductCredits(project.id, "document", creditCost);
  if (!ok) {
    return c.json({ error: "Insufficient credits" }, 402);
  }

  const start = Date.now();
  try {
    const result = await parseDocument(params);
    return c.json({ ...result, duration_ms: Date.now() - start });
  } catch (err) {
    await logFailedUsage(project.id, "document", Date.now() - start);
    const message = err instanceof Error ? err.message : "Document parsing failed";
    return c.json({ error: message }, 502);
  }
});

export { documentRouter };

export default documentRouter;

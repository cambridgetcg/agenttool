/** POST /v1/scrape — bounded static HTML fetch over the shared public-Web
 * transport. This does not change the separate fail-closed browser route. */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import {
  finalizeChargeSuccess,
  reserveCharge,
} from "../../billing/charge";
import { SafeNetError } from "../../services/net/safe-fetch";
import { toolsConfig } from "../../services/tools/config";
import { isHttpOrHttpsUrl } from "../../services/tools/outbound-policy";
import {
  SCRAPE_MAX_SELECTOR_CHARS,
  ScrapeError,
  isValidScrapeSelector,
  scrape,
} from "../../services/tools/scrape";
import {
  SCRAPE_MAX_JSON_REQUEST_BYTES,
  StaticToolRequestBodyTooLargeError,
  readBoundedJson,
  requestBodyTooLargeBody,
} from "./request-body";
import {
  safeFetchFailureResponse,
  validationBody,
} from "./safe-fetch-errors";

const app = new Hono<ProjectContext>();

const scrapeSchema = z.object({
  url: z.string().url().max(2048).refine(isHttpOrHttpsUrl, {
    message: "URL protocol must be http or https",
  }),
  selector: z
    .string()
    .min(1)
    .max(SCRAPE_MAX_SELECTOR_CHARS)
    .refine(isValidScrapeSelector, { message: "selector must be valid CSS" })
    .optional(),
  extract_links: z.boolean().optional().default(false),
});

function scrapeStatus(error: ScrapeError): 400 | 413 | 415 | 422 | 502 {
  if (error.code === "scrape_invalid_selector") return 400;
  if (error.code === "scrape_too_large") return 413;
  if (
    error.code === "scrape_unsupported_content_type" ||
    error.code === "scrape_unsupported_charset"
  ) {
    return 415;
  }
  if (error.code === "scrape_parse_failed") return 422;
  return 502;
}

app.post("/", async (c) => {
  let body: unknown;
  try {
    body = await readBoundedJson(c.req.raw, SCRAPE_MAX_JSON_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof StaticToolRequestBodyTooLargeError) {
      return c.json(requestBodyTooLargeBody(error.maxBytes), 413);
    }
    return c.json(
      validationBody({
        formErrors: ["Request body must be valid JSON"],
        fieldErrors: {},
      }),
      400,
    );
  }

  const parsed = scrapeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(validationBody(parsed.error.flatten()), 400);
  }

  const cost = toolsConfig.credits.scrape;
  const reservation = await reserveCharge(c, cost, "scrape");

  const start = Date.now();
  try {
    const result = await scrape(parsed.data);
    const durationMs = Math.max(0, Date.now() - start);
    await finalizeChargeSuccess(reservation, durationMs);
    return c.json({ ...result, duration_ms: durationMs });
  } catch (error) {
    if (error instanceof SafeNetError) {
      return safeFetchFailureResponse(c, error, "page");
    }
    if (error instanceof ScrapeError) {
      const status = scrapeStatus(error);
      return c.json(
        {
          error: error.code,
          message: status === 400
            ? "The CSS selector is invalid."
            : status === 413
              ? "The page exceeds the bounded byte limit."
              : status === 415
                ? "The page must declare supported HTML or XHTML bytes and charset."
                : status === 422
                  ? "The bounded page could not be parsed."
                  : "The remote page could not be fetched.",
          docs: "https://docs.agenttool.dev/tools#scrape",
        },
        status,
      );
    }
    throw error;
  }
});

export default app;

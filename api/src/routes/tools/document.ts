/** POST /v1/document — bounded local or public-Web text extraction.
 * URL fetching uses the shared DNS-pinned transport; Playwright browse keeps
 * its separate fail-closed operator gate. */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import {
  finalizeChargeSuccess,
  reserveCharge,
} from "../../billing/charge";
import { SafeNetError } from "../../services/net/safe-fetch";
import { toolsConfig } from "../../services/tools/config";
import {
  DOCUMENT_MAX_BASE64_CHARS,
  DOCUMENT_MAX_BYTES,
  DocumentError,
  parseDocument,
} from "../../services/tools/document";
import { isHttpOrHttpsUrl } from "../../services/tools/outbound-policy";
import {
  DOCUMENT_MAX_JSON_REQUEST_BYTES,
  StaticToolRequestBodyTooLargeError,
  readBoundedJson,
  requestBodyTooLargeBody,
} from "./request-body";
import {
  safeFetchFailureResponse,
  validationBody,
} from "./safe-fetch-errors";

const app = new Hono<ProjectContext>();
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function strictBase64DecodedBytes(value: string): number | null {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return null;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (padding > 0) {
    const finalDataValue = BASE64_ALPHABET.indexOf(
      value[value.length - padding - 1]!,
    );
    const unusedBitMask = padding === 2 ? 0b1111 : 0b11;
    if ((finalDataValue & unusedBitMask) !== 0) return null;
  }
  return (value.length / 4) * 3 - padding;
}

function supportedDeclaredContentType(value: string): boolean {
  return /^[ \t]*(?:text\/(?:plain|html)|application\/xhtml\+xml)(?:[ \t]*;[ \t]*[A-Za-z0-9!#$%&'*+.^_`|~-]+[ \t]*=[ \t]*(?:"[^"\r\n]*"|'[^'\r\n]*'|[A-Za-z0-9!#$%&'*+.^_`|~-]+))*[ \t]*$/iu.test(
    value,
  );
}

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
    base64: z
      .string()
      .min(1)
      .max(DOCUMENT_MAX_BASE64_CHARS)
      .refine((value) => strictBase64DecodedBytes(value) !== null, {
        message: "base64 must use canonical padded RFC 4648 encoding",
      })
      .refine(
        (value) =>
          (strictBase64DecodedBytes(value) ?? DOCUMENT_MAX_BYTES + 1) <=
          DOCUMENT_MAX_BYTES,
        { message: `decoded document exceeds ${DOCUMENT_MAX_BYTES} bytes` },
      )
      .optional(),
    content_type: z
      .string()
      .max(255)
      .refine(supportedDeclaredContentType, {
        message:
          "content_type must be text/plain, text/html, or application/xhtml+xml",
      })
      .optional(),
  })
  .refine((data) => (data.url !== undefined) !== (data.base64 !== undefined), {
    message: "Provide exactly one of url or base64",
  })
  .refine((data) => !(data.url !== undefined && data.content_type !== undefined), {
    message: "content_type is only valid with base64 input",
    path: ["content_type"],
  });

function documentStatus(
  error: DocumentError,
): 400 | 413 | 415 | 422 | 502 {
  if (
    error.code === "document_invalid_input" ||
    error.code === "document_invalid_base64"
  ) {
    return 400;
  }
  if (error.code === "document_too_large") return 413;
  if (
    error.code === "document_unsupported_content_type" ||
    error.code === "document_unsupported_charset"
  ) {
    return 415;
  }
  if (error.code === "document_parse_failed") return 422;
  return 502;
}

app.post("/", async (c) => {
  let body: unknown;
  try {
    body = await readBoundedJson(c.req.raw, DOCUMENT_MAX_JSON_REQUEST_BYTES);
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

  const parsed = documentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(validationBody(parsed.error.flatten()), 400);
  }

  const cost = toolsConfig.credits.document;
  const reservation = await reserveCharge(c, cost, "document");

  const start = Date.now();
  try {
    const result = await parseDocument(parsed.data);
    const durationMs = Math.max(0, Date.now() - start);
    await finalizeChargeSuccess(reservation, durationMs);
    return c.json({ ...result, duration_ms: durationMs });
  } catch (error) {
    if (error instanceof SafeNetError) {
      return safeFetchFailureResponse(c, error, "document");
    }
    if (error instanceof DocumentError) {
      const status = documentStatus(error);
      return c.json(
        {
          error: error.code,
          message: status === 400
            ? "The document input is invalid."
            : status === 413
              ? "The document exceeds the bounded byte limit."
              : status === 415
                ? "The document must declare a supported text, HTML, or XHTML media type and charset."
                : status === 422
                  ? "The bounded document could not be parsed."
                  : "The remote document could not be fetched.",
          docs: "https://docs.agenttool.dev/tools#document",
        },
        status,
      );
    }
    throw error;
  }
});

export default app;

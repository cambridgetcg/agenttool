/** Redacted HTTP mapping for static safe-net routes. */

import type { Context } from "hono";

import type { SafeNetError } from "../../services/net/safe-fetch";

export function validationBody(details: unknown) {
  return {
    error: "validation",
    message: "The request needs a small adjustment. Here's what to fix:",
    details,
    docs: "https://docs.agenttool.dev/tools",
  } as const;
}

export function safeFetchFailure(
  error: SafeNetError,
  subject: "document" | "page",
): {
  status: 400 | 413 | 502 | 503 | 504;
  retryAfterSeconds?: number;
  body: {
    error: SafeNetError["code"];
    message: string;
    safety: "/public/safety";
    docs: "https://api.agenttool.dev/public/safety";
  };
} {
  const destinationRefusal =
    error.code === "safe_net_invalid_url" ||
    error.code === "safe_net_protocol_not_allowed" ||
    error.code === "safe_net_url_credentials_forbidden" ||
    error.code === "safe_net_url_fragment_forbidden" ||
    error.code === "safe_net_url_host_required" ||
    error.code === "safe_net_destination_not_public";
  const status = destinationRefusal
    ? 400
    : error.code === "safe_net_response_too_large"
      ? 413
      : error.code === "safe_net_overloaded"
        ? 503
        : error.code === "safe_net_request_timeout" ||
            error.code === "safe_net_aborted"
          ? 504
          : 502;
  const message = status === 400
    ? "The destination was rejected by the public-Web network policy."
    : status === 413
      ? `The remote ${subject} exceeds the bounded download limit.`
      : status === 503
        ? "The shared safe transport is at process capacity. Retry shortly."
        : status === 504
          ? `The remote ${subject} did not arrive before the fetch deadline.`
          : `The remote ${subject} failed the safe transport checks.`;
  return {
    status,
    ...(status === 503 ? { retryAfterSeconds: 1 } : {}),
    body: {
      error: error.code,
      message,
      safety: "/public/safety",
      docs: "https://api.agenttool.dev/public/safety",
    },
  };
}

export function safeFetchFailureResponse(
  c: Context,
  error: SafeNetError,
  subject: "document" | "page",
) {
  const failure = safeFetchFailure(error, subject);
  if (failure.retryAfterSeconds !== undefined) {
    c.header("Retry-After", String(failure.retryAfterSeconds));
  }
  return c.json(failure.body, failure.status);
}

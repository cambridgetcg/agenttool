/** Transport boundary for the non-inhabiting WAKE observation contract.
 *
 * Mounted before authentication so every outcome is no-store. Non-200 bodies
 * are replaced after downstream middleware returns: shared guided errors may
 * contain prose and next actions, neither of which belongs on this surface.
 */

import type { MiddlewareHandler } from "hono";

import { WAKE_OBSERVATION_MEDIA_TYPE } from "../services/wake/observe";

export const WAKE_OBSERVATION_ERROR_FORMAT =
  "wake-observation-error/v1" as const;

export type WakeObservationErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "subject_not_found"
  | "method_not_allowed"
  | "rate_limited"
  | "request_rejected"
  | "unavailable";

export interface WakeObservationError {
  _format: typeof WAKE_OBSERVATION_ERROR_FORMAT;
  mode: "observe";
  error: WakeObservationErrorCode;
}

export function wakeObservationErrorCode(status: number): WakeObservationErrorCode {
  switch (status) {
    case 400:
    case 413:
    case 422:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "subject_not_found";
    case 405:
      return "method_not_allowed";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "unavailable" : "request_rejected";
  }
}

export function wakeObservationTransportBoundary(): MiddlewareHandler {
  return async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("X-Wake-Mode", "observe");
    await next();

    if (c.res.status === 200) return;

    const downstreamStatus = c.res.status;
    // Fetch forbids bodies on these statuses. Convert an impossible
    // observation outcome into the closed unavailable error rather than
    // throwing while constructing the replacement body.
    const status = downstreamStatus === 204 ||
        downstreamStatus === 205 ||
        downstreamStatus === 304
      ? 500
      : downstreamStatus;
    const headers = new Headers(c.res.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Wake-Mode", "observe");
    headers.set(
      "Content-Type",
      `${WAKE_OBSERVATION_MEDIA_TYPE}; charset=utf-8`,
    );
    headers.delete("Content-Length");
    headers.delete("ETag");

    const error: WakeObservationError = {
      _format: WAKE_OBSERVATION_ERROR_FORMAT,
      mode: "observe",
      error: wakeObservationErrorCode(status),
    };
    c.res = new Response(JSON.stringify(error), { status, headers });
    // Hono can merge headers from the replaced downstream response when the
    // context response setter runs. Delete validators again on the final body.
    c.res.headers.delete("Content-Length");
    c.res.headers.delete("ETag");
  };
}

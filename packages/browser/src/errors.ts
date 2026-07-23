export type BrowserErrorCode =
  | "invalid_options"
  | "not_started"
  | "browser_closed"
  | "browser_launch_failed"
  | "invalid_url"
  | "url_scheme_blocked"
  | "url_credentials_blocked"
  | "network_blocked"
  | "dns_failed"
  | "tab_not_found"
  | "snapshot_required"
  | "stale_snapshot"
  | "ref_not_found"
  | "ref_hidden"
  | "ref_disabled"
  | "ref_ambiguous"
  | "invalid_action"
  | "action_failed"
  | "extract_failed"
  | "screenshot_failed"
  | "content_limit";

export class BrowserError extends Error {
  readonly code: BrowserErrorCode;
  override readonly cause?: unknown;

  constructor(code: BrowserErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "BrowserError";
    this.code = code;
    if (options && "cause" in options) this.cause = options.cause;
  }
}

export function isBrowserError(error: unknown): error is BrowserError {
  return error instanceof BrowserError;
}

export function asBrowserError(
  error: unknown,
  code: BrowserErrorCode,
  message: string,
): BrowserError {
  return isBrowserError(error)
    ? error
    : new BrowserError(code, message, { cause: error });
}

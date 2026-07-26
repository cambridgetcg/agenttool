export type SearchErrorCode =
  | "invalid_request"
  | "search_cancelled"
  | "search_unavailable"
  | "provider_not_found"
  | "provider_unavailable"
  | "cursor_not_found"
  | "cursor_expired"
  | "result_not_found"
  | "result_expired"
  | "foreign_session"
  | "inspection_unavailable"
  | "browser_plan_failed"
  | "browser_open_failed"
  | "internal_error";

export class SearchError extends Error {
  readonly code: SearchErrorCode;

  constructor(code: SearchErrorCode, message: string) {
    super(message);
    this.name = "SearchError";
    this.code = code;
  }
}

export function publicSearchError(error: unknown): {
  code: SearchErrorCode;
  message: string;
} {
  if (error instanceof SearchError) {
    return { code: error.code, message: error.message.slice(0, 2_000) };
  }
  return {
    code: "internal_error",
    message: "Search operation failed.",
  };
}

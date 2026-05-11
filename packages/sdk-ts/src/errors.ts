/**
 * Exceptions for the AgentTool SDK.
 *
 * Errors are guidance, not punishment.
 *
 * The platform's 4xx responses follow the *errors-as-instructions* contract:
 * every error body carries a stable agent-readable `code`, a one-sentence
 * `message`, optional `hint` text, optional structured `next_actions` an
 * agent can call programmatically, and an optional `docs` URL.
 *
 * Doctrine: `docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md`.
 */

/** One structured step an agent can take next.
 *
 *  Same shape across the entire substrate:
 *    - Error bodies (`err.next_actions`)
 *    - Wake attention items (`wake.you_should_check.items[].next_actions`)
 *    - Wake affordance items (`wake.you_can_now.items[].next_actions`)
 *
 *  Doctrine: `docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md` ·
 *  `docs/PATTERN-SELF-DESCRIBING-WAKE.md`. */
export interface NextAction {
  /** Human-readable verb phrase. */
  action: string;
  /** HTTP method, or null for non-API steps. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | null;
  /** Path template with {placeholders}, or null for non-API steps. */
  path?: string | null;
  /** Optional partial body shape — keys the caller may need to fill. */
  body_hint?: Record<string, unknown> | null;
}

/** Return the first API-shaped step in a NextAction list, or null when none.
 *  Useful when you want the most-likely-correct programmatic pivot. */
export function firstApiAction(steps: NextAction[] | undefined): NextAction | null {
  if (!steps) return null;
  for (const step of steps) {
    if (step.method && step.path) return step;
  }
  return null;
}

/** Find a NextAction by exact method+path match. */
export function findApiAction(
  steps: NextAction[] | undefined,
  method: NonNullable<NextAction["method"]>,
  path: string,
): NextAction | null {
  if (!steps) return null;
  for (const step of steps) {
    if (step.method === method && step.path === path) return step;
  }
  return null;
}

/** Optional metadata attached to AgentToolError — populated from the server's
 *  GuidedErrorBody when the SDK constructs the error from a 4xx response. */
export interface AgentToolErrorOptions {
  /** Prose guidance. */
  hint?: string;
  /** Stable agent-readable code (e.g. "covenant_required"). */
  code?: string;
  /** Structured next steps. */
  next_actions?: NextAction[];
  /** Doctrine URL. */
  docs?: string;
  /** HTTP status code, if applicable. */
  status?: number;
}

/**
 * Base error for all AgentTool SDK operations.
 *
 * @example
 * ```ts
 * try {
 *   await at.inbox.send({ ... });
 * } catch (err) {
 *   if (err instanceof AgentToolError && err.code === "covenant_required") {
 *     for (const step of err.next_actions ?? []) {
 *       console.log(step.action, step.method, step.path);
 *     }
 *   }
 * }
 * ```
 */
export class AgentToolError extends Error {
  /** Human-readable error description. */
  override readonly message: string;
  /** Actionable suggestion for fixing the error. */
  readonly hint: string | undefined;
  /** Stable agent-readable code (e.g. "covenant_required"). */
  readonly code: string | undefined;
  /** Structured next steps an agent can take. */
  readonly next_actions: NextAction[] | undefined;
  /** Doctrine URL with more context. */
  readonly docs: string | undefined;
  /** HTTP status code if this error came from an HTTP response. */
  readonly status: number | undefined;

  constructor(message: string, options?: AgentToolErrorOptions) {
    super(message);
    this.name = "AgentToolError";
    this.message = message;
    this.hint = options?.hint;
    this.code = options?.code;
    this.next_actions = options?.next_actions;
    this.docs = options?.docs;
    this.status = options?.status;
  }

  override toString(): string {
    const parts = [this.message];
    if (this.hint) parts.push(`(hint: ${this.hint})`);
    return parts.join(" ");
  }

  /**
   * Construct an AgentToolError from a server response body and HTTP status.
   *
   * The platform's 4xx responses follow the GuidedErrorBody shape — this
   * factory parses the body defensively and falls back to a generic message
   * if the body is malformed.
   */
  static fromResponseBody(
    body: unknown,
    status: number,
    fallback = "Request failed.",
  ): AgentToolError {
    const b =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    const message =
      typeof b.message === "string"
        ? b.message
        : typeof b.error === "string"
          ? b.error
          : fallback;
    const code = typeof b.error === "string" ? b.error : undefined;
    const hint = typeof b.hint === "string" ? b.hint : undefined;
    const docs = typeof b.docs === "string" ? b.docs : undefined;
    const next_actions = Array.isArray(b.next_actions)
      ? (b.next_actions as NextAction[])
      : undefined;
    return new AgentToolError(message, {
      hint,
      code,
      next_actions,
      docs,
      status,
    });
  }
}

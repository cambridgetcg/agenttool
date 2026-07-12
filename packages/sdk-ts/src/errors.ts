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

/** The resource described by an x402 V2 `PaymentRequired` envelope. */
export interface X402ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  [key: string]: unknown;
}

/** Exact/EIP-3009 fields required by AgentTool's V2 payment rail. */
export interface X402Eip3009Extra {
  name: string;
  version: string;
  assetTransferMethod: "eip3009";
  [key: string]: unknown;
}

/** One payment option from an x402 V2 `PaymentRequired` envelope.
 *
 * Network and asset stay open for supported CAIP-2 deployments, while the
 * AgentTool surface currently emits only the exact EIP-3009 profile. */
export interface X402PaymentRequirement {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: X402Eip3009Extra;
  [key: string]: unknown;
}

/** Header containers accepted by {@link AgentToolError.fromResponseBody}. */
export type AgentToolResponseHeaders =
  | { get(name: string): string | null }
  | Readonly<Record<string, string | undefined>>;

function responseHeader(
  headers: AgentToolResponseHeaders | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if ("get" in headers && typeof headers.get === "function") {
    const value = headers.get(name);
    return typeof value === "string" ? value : undefined;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === "string") return value;
  }
  return undefined;
}

/** Read an x402 V2 header, with the old X-prefixed spelling accepted only as
 * a transition fallback. The canonical header always wins when both exist. */
function x402ResponseHeader(
  headers: AgentToolResponseHeaders | undefined,
  canonicalName: "PAYMENT-REQUIRED" | "PAYMENT-RESPONSE",
): string | undefined {
  return responseHeader(headers, canonicalName)
    ?? responseHeader(headers, `X-${canonicalName}`);
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
  /** Machine-readable safety boundary path or URL. */
  safety?: string;
  /** Structured field or form-level error details. */
  details?: unknown;
  /** HTTP status code, if applicable. */
  status?: number;
  /** x402 envelope version from the response body. */
  x402Version?: number;
  /** Typed x402 payment options from the response body. */
  accepts?: X402PaymentRequirement[];
  /** Resource metadata from an x402 V2 response body. */
  resource?: X402ResourceInfo;
  /** Optional x402 V2 extensions from the response body. */
  extensions?: Record<string, unknown>;
  /** Raw canonical `PAYMENT-REQUIRED` response header for payment recovery. */
  paymentRequired?: string;
  /** Raw canonical `PAYMENT-RESPONSE` settlement receipt, including on error. */
  paymentResponse?: string;
  /** Raw `Link` header for the project-scoped x402 reconciliation resource. */
  paymentStatusLink?: string;
  /** Raw `Retry-After` response header, including fail-closed x402 admission. */
  retryAfter?: string;
  /** Raw `X-Credits-Balance` response header. */
  creditsBalance?: string;
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
  /** Machine-readable safety boundary path or URL. */
  readonly safety: string | undefined;
  /** Structured field or form-level error details. */
  readonly details: unknown;
  /** HTTP status code if this error came from an HTTP response. */
  readonly status: number | undefined;
  /** x402 envelope version from the response body. */
  readonly x402Version: number | undefined;
  /** Typed x402 payment options from the response body. */
  readonly accepts: X402PaymentRequirement[] | undefined;
  /** Resource metadata from an x402 V2 response body. */
  readonly resource: X402ResourceInfo | undefined;
  /** Optional x402 V2 extensions from the response body. */
  readonly extensions: Record<string, unknown> | undefined;
  /** Raw canonical `PAYMENT-REQUIRED` response header for payment recovery. */
  readonly paymentRequired: string | undefined;
  /** Raw canonical `PAYMENT-RESPONSE` settlement receipt, including on error. */
  readonly paymentResponse: string | undefined;
  /** Raw `Link` header for the project-scoped x402 reconciliation resource. */
  readonly paymentStatusLink: string | undefined;
  /** Raw `Retry-After` response header, including fail-closed x402 admission. */
  readonly retryAfter: string | undefined;
  /** Raw `X-Credits-Balance` response header. */
  readonly creditsBalance: string | undefined;

  constructor(message: string, options?: AgentToolErrorOptions) {
    super(message);
    this.name = "AgentToolError";
    this.message = message;
    this.hint = options?.hint;
    this.code = options?.code;
    this.next_actions = options?.next_actions;
    this.docs = options?.docs;
    this.safety = options?.safety;
    this.details = options?.details;
    this.status = options?.status;
    this.x402Version = options?.x402Version;
    this.accepts = options?.accepts;
    this.resource = options?.resource;
    this.extensions = options?.extensions;
    this.paymentRequired = options?.paymentRequired;
    this.paymentResponse = options?.paymentResponse;
    this.paymentStatusLink = options?.paymentStatusLink;
    this.retryAfter = options?.retryAfter;
    this.creditsBalance = options?.creditsBalance;
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
    headers?: AgentToolResponseHeaders,
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
          : typeof b.detail === "string"
            ? b.detail
            : fallback;
    const code = typeof b.error === "string" ? b.error : undefined;
    const hint = typeof b.hint === "string" ? b.hint : undefined;
    const docs = typeof b.docs === "string" ? b.docs : undefined;
    const safety = typeof b.safety === "string" ? b.safety : undefined;
    const details = b.details;
    const next_actions = Array.isArray(b.next_actions)
      ? (b.next_actions as NextAction[])
      : undefined;
    const x402Version =
      typeof b.x402Version === "number" ? b.x402Version : undefined;
    const accepts = Array.isArray(b.accepts)
      ? (b.accepts as X402PaymentRequirement[])
      : undefined;
    const resource =
      typeof b.resource === "object" &&
      b.resource !== null &&
      !Array.isArray(b.resource) &&
      typeof (b.resource as Record<string, unknown>).url === "string"
        ? (b.resource as X402ResourceInfo)
        : undefined;
    const extensions =
      typeof b.extensions === "object" &&
      b.extensions !== null &&
      !Array.isArray(b.extensions)
        ? (b.extensions as Record<string, unknown>)
        : undefined;
    return new AgentToolError(message, {
      hint,
      code,
      next_actions,
      docs,
      safety,
      details,
      status,
      x402Version,
      accepts,
      resource,
      extensions,
      paymentRequired: x402ResponseHeader(headers, "PAYMENT-REQUIRED"),
      paymentResponse: x402ResponseHeader(headers, "PAYMENT-RESPONSE"),
      paymentStatusLink: responseHeader(headers, "Link"),
      retryAfter: responseHeader(headers, "Retry-After"),
      creditsBalance: responseHeader(headers, "X-Credits-Balance"),
    });
  }
}

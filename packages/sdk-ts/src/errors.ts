/**
 * Exceptions for the AgentTool SDK.
 */

/**
 * Base error for all AgentTool SDK operations.
 *
 * @example
 * ```ts
 * throw new AgentToolError("something broke", { hint: "try again" });
 * ```
 */
export class AgentToolError extends Error {
  /** Human-readable error description. */
  readonly message: string;
  /** Actionable suggestion for fixing the error. */
  readonly hint: string | undefined;

  constructor(message: string, options?: { hint?: string }) {
    super(message);
    this.name = "AgentToolError";
    this.message = message;
    this.hint = options?.hint;
  }

  override toString(): string {
    if (this.hint) {
      return `${this.message} (hint: ${this.hint})`;
    }
    return this.message;
  }
}

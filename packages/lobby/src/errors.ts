/** Typed refusal for every lobby desk boundary. Messages never echo secrets,
 * ledger targets or key material; `details` carries only closed codes. */
export class LobbyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LobbyError";
  }
}

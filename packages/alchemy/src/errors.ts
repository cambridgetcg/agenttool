export type AlchemyReadErrorCode =
  | "invalid_input"
  | "aborted"
  | "deadline_exceeded"
  | "transport_failed"
  | "response_too_large"
  | "invalid_response"
  | "chain_mismatch";

const MESSAGES: Record<AlchemyReadErrorCode, string> = {
  invalid_input: "Alchemy read input is invalid.",
  aborted: "Alchemy read was aborted.",
  deadline_exceeded: "Alchemy read deadline was exceeded.",
  transport_failed: "Alchemy read transport failed.",
  response_too_large: "Alchemy response exceeded its byte limit.",
  invalid_response: "Alchemy response was invalid.",
  chain_mismatch: "Alchemy response did not match the configured chain.",
};

export class AlchemyReadError extends Error {
  readonly code: AlchemyReadErrorCode;

  constructor(code: AlchemyReadErrorCode) {
    super(MESSAGES[code]);
    this.name = "AlchemyReadError";
    this.code = code;
  }
}

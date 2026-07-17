export class TargetInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TargetInputError";
    this.code = code;
  }
}

export class NetworkPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NetworkPolicyError";
    this.code = code;
  }
}

export class LimitError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LimitError";
    this.code = code;
  }
}

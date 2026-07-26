import type {
  AlchemyReadTransport,
  AlchemyTransportRequest,
  AlchemyTransportResponse,
} from "../src/index.js";

export const NOW = 1_785_024_000_000;
export const ADDRESS_A = `0x${"11".repeat(20)}` as const;
export const ADDRESS_B = `0x${"22".repeat(20)}` as const;
export const CONTRACT = `0x${"33".repeat(20)}` as const;
export const HASH_A = `0x${"aa".repeat(32)}` as const;
export const HASH_B = `0x${"bb".repeat(32)}` as const;

export function transportResponse(
  request: AlchemyTransportRequest,
  result: unknown,
): AlchemyTransportResponse {
  return {
    operationId: request.operationId,
    chainId: request.chainId,
    method: request.call.method,
    result: result as AlchemyTransportResponse["result"],
  };
}

export class FakeTransport implements AlchemyReadTransport {
  readonly requests: AlchemyTransportRequest[] = [];

  constructor(
    readonly respond: (
      request: AlchemyTransportRequest,
    ) => Promise<AlchemyTransportResponse> | AlchemyTransportResponse,
  ) {}

  async send(
    request: AlchemyTransportRequest,
  ): Promise<AlchemyTransportResponse> {
    this.requests.push(request);
    return this.respond(request);
  }
}

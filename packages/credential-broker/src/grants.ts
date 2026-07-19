import { randomBytes, randomUUID } from "node:crypto";
import { AgentCredError } from "./errors.js";
import type { Clock, GrantReceipt, GrantRequest } from "./types.js";

interface StoredGrant {
  capability: string;
  sessionId: string;
  request: GrantRequest;
  receipt: GrantReceipt;
  expiresMonotonicMs: number;
  attempts: number;
  revoked: boolean;
}

export interface ReservedGrant {
  request: Readonly<GrantRequest>;
  receipt: Readonly<GrantReceipt>;
  attempt: number;
}

export class GrantStore {
  readonly #clock: Clock;
  readonly #grants = new Map<string, StoredGrant>();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  #pruneUnavailable(): void {
    const now = this.#clock.monotonicNowMs();
    for (const [capability, grant] of this.#grants) {
      if (
        grant.revoked ||
        now >= grant.expiresMonotonicMs ||
        grant.attempts >= grant.request.scope.maxUses
      ) {
        grant.revoked = true;
        this.#grants.delete(capability);
      }
    }
  }

  get size(): number {
    this.#pruneUnavailable();
    return this.#grants.size;
  }

  countSession(sessionId: string): number {
    this.#pruneUnavailable();
    let count = 0;
    for (const grant of this.#grants.values()) {
      if (grant.sessionId === sessionId && !grant.revoked) count += 1;
    }
    return count;
  }

  issue(sessionId: string, request: GrantRequest): { capability: string; receipt: GrantReceipt } {
    const capability = randomBytes(32).toString("base64url");
    const now = this.#clock.wallNow();
    const receipt: GrantReceipt = {
      alias: request.alias,
      receiptId: randomUUID(),
      operation: request.operation,
      scope: structuredClone(request.scope),
      expiresAt: new Date(now.getTime() + request.scope.ttlSeconds * 1000).toISOString(),
      maxUses: request.scope.maxUses,
    };
    this.#grants.set(capability, {
      capability,
      sessionId,
      request: structuredClone(request),
      receipt,
      expiresMonotonicMs: this.#clock.monotonicNowMs() + request.scope.ttlSeconds * 1000,
      attempts: 0,
      revoked: false,
    });
    return { capability, receipt };
  }

  /**
   * Reserve one use synchronously. Attempts are consumed before I/O so two
   * concurrent requests cannot both spend a one-use capability.
   */
  reserve(sessionId: string, capability: string): ReservedGrant {
    const grant = this.#grants.get(capability);
    if (!grant || grant.revoked) {
      throw new AgentCredError("grant_not_found", "Capability is unknown or revoked.");
    }
    if (grant.sessionId !== sessionId) {
      throw new AgentCredError("grant_wrong_session", "Capability belongs to another connection.");
    }
    if (this.#clock.monotonicNowMs() >= grant.expiresMonotonicMs) {
      this.#grants.delete(capability);
      throw new AgentCredError("grant_expired", "Capability has expired.");
    }
    if (grant.attempts >= grant.request.scope.maxUses) {
      this.#grants.delete(capability);
      throw new AgentCredError("grant_exhausted", "Capability has no uses remaining.");
    }
    grant.attempts += 1;
    return {
      request: grant.request,
      receipt: grant.receipt,
      attempt: grant.attempts,
    };
  }

  inspect(sessionId: string, capability: string): ReservedGrant {
    const grant = this.#grants.get(capability);
    if (!grant || grant.revoked) {
      throw new AgentCredError("grant_not_found", "Capability is unknown or revoked.");
    }
    if (grant.sessionId !== sessionId) {
      throw new AgentCredError("grant_wrong_session", "Capability belongs to another connection.");
    }
    if (this.#clock.monotonicNowMs() >= grant.expiresMonotonicMs) {
      this.#grants.delete(capability);
      throw new AgentCredError("grant_expired", "Capability has expired.");
    }
    if (grant.attempts >= grant.request.scope.maxUses) {
      this.#grants.delete(capability);
      throw new AgentCredError("grant_exhausted", "Capability has no uses remaining.");
    }
    return {
      request: grant.request,
      receipt: grant.receipt,
      attempt: grant.attempts + 1,
    };
  }

  revoke(sessionId: string, capability: string): GrantReceipt {
    const grant = this.#grants.get(capability);
    if (!grant || grant.revoked) {
      throw new AgentCredError("grant_not_found", "Capability is unknown or revoked.");
    }
    if (grant.sessionId !== sessionId) {
      throw new AgentCredError("grant_wrong_session", "Capability belongs to another connection.");
    }
    grant.revoked = true;
    this.#grants.delete(capability);
    return grant.receipt;
  }

  revokeSession(sessionId: string): GrantReceipt[] {
    this.#pruneUnavailable();
    const receipts: GrantReceipt[] = [];
    for (const [capability, grant] of this.#grants) {
      if (grant.sessionId === sessionId) {
        grant.revoked = true;
        this.#grants.delete(capability);
        receipts.push(grant.receipt);
      }
    }
    return receipts;
  }
}

export const systemClock: Clock = {
  wallNow: () => new Date(),
  monotonicNowMs: () => performance.now(),
};

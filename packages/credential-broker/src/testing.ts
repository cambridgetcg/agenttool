import type {
  AuditEvent,
  AuditSink,
  Clock,
  ConsentProvider,
  CredentialAuth,
  CredentialMaterial,
  CredentialSource,
  GrantRequest,
} from "./types.js";
import { AgentCredError } from "./errors.js";

/** Test/development only. Never use this source with real credentials. */
export class InMemoryCredentialSource implements CredentialSource {
  readonly #values = new Map<string, { value: Uint8Array; auth: CredentialAuth }>();
  calls = 0;

  set(alias: string, value: string | Uint8Array, auth: CredentialAuth = { kind: "bearer" }): void {
    const previous = this.#values.get(alias);
    previous?.value.fill(0);
    this.#values.set(alias, {
      value: typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value),
      auth: { ...auth },
    });
  }

  async withCredential<T>(
    alias: string,
    use: (material: CredentialMaterial) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      throw new AgentCredError("request_failed", "Credential lookup was cancelled.");
    }
    const stored = this.#values.get(alias);
    if (!stored) throw new AgentCredError("credential_not_found", "Credential is unavailable.");
    this.calls += 1;
    const value = Uint8Array.from(stored.value);
    try {
      return await use({ value, auth: { ...stored.auth } });
    } finally {
      value.fill(0);
    }
  }

  clear(): void {
    for (const stored of this.#values.values()) stored.value.fill(0);
    this.#values.clear();
  }
}

export class AllowAllConsent implements ConsentProvider {
  async decide(): Promise<{ allowed: true }> {
    return { allowed: true };
  }
}

export class CapturingConsent implements ConsentProvider {
  readonly requests: GrantRequest[] = [];
  allowed = true;

  async decide(request: Readonly<GrantRequest>): Promise<{ allowed: boolean; reasonCode?: string }> {
    this.requests.push(structuredClone(request));
    return this.allowed ? { allowed: true } : { allowed: false, reasonCode: "test_denied" };
  }
}

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  record(event: Readonly<AuditEvent>): void {
    this.events.push(structuredClone(event));
  }
}

export class FakeClock implements Clock {
  #wallMs: number;
  #monotonicMs: number;

  constructor(epochMs = Date.parse("2026-01-01T00:00:00.000Z")) {
    this.#wallMs = epochMs;
    this.#monotonicMs = 0;
  }

  wallNow(): Date {
    return new Date(this.#wallMs);
  }

  monotonicNowMs(): number {
    return this.#monotonicMs;
  }

  advance(ms: number): void {
    this.#wallMs += ms;
    this.#monotonicMs += ms;
  }
}

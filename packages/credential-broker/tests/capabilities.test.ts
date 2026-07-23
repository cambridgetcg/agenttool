import { afterEach, describe, expect, test } from "bun:test";
import { AgentCredError } from "../src/index.js";
import { grantRequest, makeBroker, type BrokerFixture } from "./helpers.js";

const fixtures: BrokerFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("connection-bound metered grants", () => {
  test("one-use capabilities cannot be replayed", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const handle = await fixture.client.requestGrant(
      grantRequest({ scope: { ...grantRequest().scope, maxUses: 1 } }),
    );
    await fixture.client.fetch(handle, {
      method: "GET",
      url: "https://api.example.com/v1/once",
    });
    await expect(
      fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/twice",
      }),
    ).rejects.toMatchObject({ code: "grant_not_found" });
    expect(fixture.credentials.calls).toBe(1);
    expect(fixture.transport.calls).toHaveLength(1);
  });

  test("expiry is exact and checked before credential/network use", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const handle = await fixture.client.requestGrant(
      grantRequest({ scope: { ...grantRequest().scope, ttlSeconds: 1 } }),
    );
    fixture.clock.advance(1_000);
    await expect(
      fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/expired",
      }),
    ).rejects.toMatchObject({ code: "grant_not_found" });
    expect(fixture.credentials.calls).toBe(0);
    expect(fixture.resolverCalls).toHaveLength(0);
  });

  test("malformed or out-of-scope requests do not consume a use", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const handle = await fixture.client.requestGrant(
      grantRequest({ scope: { ...grantRequest().scope, maxUses: 1 } }),
    );
    await expect(
      fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/admin",
      }),
    ).rejects.toBeInstanceOf(AgentCredError);
    await fixture.client.fetch(handle, {
      method: "GET",
      url: "https://api.example.com/v1/allowed",
    });
    expect(fixture.credentials.calls).toBe(1);
  });

  test("concurrent spends reserve one-use authority atomically", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    let release!: () => void;
    fixture.transport.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = await fixture.client.requestGrant(
      grantRequest({ scope: { ...grantRequest().scope, maxUses: 1 } }),
    );
    const attempts = [1, 2].map((number) =>
      fixture.client.fetch(handle, {
        method: "GET",
        url: `https://api.example.com/v1/race/${number}`,
      }),
    );
    const settled = Promise.allSettled(attempts);
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    const results = await settled;
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(fixture.transport.calls).toHaveLength(1);
  });

  test("caller abort rejects promptly without pretending to undo a dispatched use", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    let release!: () => void;
    fixture.transport.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = await fixture.client.requestGrant(
      grantRequest({ scope: { ...grantRequest().scope, maxUses: 1 } }),
    );
    const controller = new AbortController();
    const pending = fixture.client.asFetch(handle)(
      "https://api.example.com/v1/slow",
      { signal: controller.signal },
    );
    for (let attempt = 0; attempt < 50 && fixture.transport.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(fixture.transport.calls).toHaveLength(1);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/retry",
      }),
    ).rejects.toMatchObject({ code: "grant_not_found" });

    release();
    await new Promise((resolve) => setTimeout(resolve, 1));
  });

  test("active-grant quotas prune spent grants and release revoked grants", async () => {
    const fixture = await makeBroker({ maxGrantsPerConnection: 1, maxGrantsTotal: 1 });
    fixtures.push(fixture);
    const oneUse = await fixture.client.requestGrant(
      grantRequest({ scope: { ...grantRequest().scope, maxUses: 1 } }),
    );
    await expect(fixture.client.requestGrant(grantRequest())).rejects.toMatchObject({
      code: "scope_denied",
    });
    await fixture.client.fetch(oneUse, {
      method: "GET",
      url: "https://api.example.com/v1/once",
    });

    const afterSpend = await fixture.client.requestGrant(grantRequest());
    await fixture.client.revoke(afterSpend);
    await expect(fixture.client.requestGrant(grantRequest())).resolves.toBeDefined();
  });

  test("client close invalidates handles and reconnect starts a fresh sequence", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const oldHandle = await fixture.client.requestGrant(grantRequest());
    fixture.client.close();
    expect(() => fixture.client.asTransport(oldHandle)).toThrow(AgentCredError);

    await fixture.client.connect();
    const freshHandle = await fixture.client.requestGrant(grantRequest());
    await expect(
      fixture.client.fetch(freshHandle, {
        method: "GET",
        url: "https://api.example.com/v1/reconnected",
      }),
    ).resolves.toMatchObject({ status: 200 });
  });

  test("client queues above the broker concurrency limit without losing the session", async () => {
    const fixture = await makeBroker({ maxInFlightPerConnection: 2 });
    fixtures.push(fixture);
    let release!: () => void;
    fixture.transport.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = await fixture.client.requestGrant(
      grantRequest({ scope: { ...grantRequest().scope, maxUses: 6 } }),
    );
    const calls = Array.from({ length: 6 }, (_, index) =>
      fixture.client.fetch(handle, {
        method: "GET",
        url: `https://api.example.com/v1/queued/${index}`,
      }),
    );
    for (let attempt = 0; attempt < 50 && fixture.transport.calls.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(fixture.transport.calls).toHaveLength(2);

    release();
    await expect(Promise.all(calls)).resolves.toHaveLength(6);
    expect(fixture.transport.calls).toHaveLength(6);
    expect(fixture.client.connected).toBe(true);
  });

  test("disconnect aborts cooperating outbound work", async () => {
    const fixture = await makeBroker({ maxInFlightTotal: 1 });
    fixtures.push(fixture);
    fixture.transport.gate = new Promise<void>(() => undefined);
    const handle = await fixture.client.requestGrant(grantRequest());
    const pending = fixture.client.fetch(handle, {
      method: "GET",
      url: "https://api.example.com/v1/disconnect",
    });
    for (let attempt = 0; attempt < 50 && fixture.transport.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(fixture.transport.calls).toHaveLength(1);

    fixture.client.close();
    await expect(pending).rejects.toMatchObject({ code: "request_failed" });
    for (
      let attempt = 0;
      attempt < 50 && !fixture.transport.calls[0]?.signal?.aborted;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(fixture.transport.calls[0]?.signal?.aborted).toBe(true);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { AgentCredError } from "../src/index.js";
import { parseWireRequest } from "../src/wire.js";
import { grantRequest, makeBroker, TEST_SECRET, type BrokerFixture } from "./helpers.js";

const fixtures: BrokerFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("no credential-retrieval surface", () => {
  test("malformed consent denies and unsafe reason values never reach audit", async () => {
    const throwingDecision = Object.defineProperty({}, "allowed", {
      get() {
        throw new Error(`unsafe consent diagnostic: ${TEST_SECRET}`);
      },
    });
    const decisions: unknown[] = [
      undefined,
      null,
      [],
      {},
      { allowed: "true" },
      { allowed: 1 },
      throwingDecision,
      { allowed: false, reasonCode: `unsafe:${TEST_SECRET}` },
      { allowed: false, reasonCode: "x".repeat(65) },
      { allowed: false, reasonCode: "outside_owner_policy" },
      { allowed: true },
    ];
    const fixture = await makeBroker({
      consent: {
        async decide() {
          return decisions.shift() as { allowed: boolean; reasonCode?: string };
        },
      },
    });
    fixtures.push(fixture);

    for (let index = 0; index < 10; index += 1) {
      await expect(fixture.client.requestGrant(grantRequest())).rejects.toMatchObject({
        code: "consent_denied",
      });
    }
    await expect(fixture.client.requestGrant(grantRequest())).resolves.toBeDefined();

    const denied = fixture.audit.events.filter((event) => event.event === "grant.denied");
    expect(denied).toHaveLength(10);
    expect(denied.map((event) => event.reasonCode)).toEqual([
      "consent_denied",
      "consent_denied",
      "consent_denied",
      "consent_denied",
      "consent_denied",
      "consent_denied",
      "consent_denied",
      "consent_denied",
      "consent_denied",
      "outside_owner_policy",
    ]);
    expect(JSON.stringify(fixture.audit.events)).not.toContain(TEST_SECRET);
  });

  test("public client and grant serialization contain no secret or capability", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const handle = await fixture.client.requestGrant(grantRequest());

    expect("getSecret" in fixture.client).toBe(false);
    expect("reveal" in fixture.client).toBe(false);
    expect(Object.getOwnPropertyNames(handle).sort()).toEqual(["alias", "receipt"]);
    const serialized = JSON.stringify(handle);
    expect(serialized).not.toContain(TEST_SECRET);
    expect(serialized).not.toContain("capability");
    expect(serialized).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(Object.keys(fixture.client.asTransport(handle))).toEqual(["request"]);
    const response = await fixture.client.asFetch(handle)(
      "https://api.example.com/v1/fetch-adapter",
    );
    expect(await response.text()).toBe('{"ok":true}');
  });

  test("unknown reveal-like operations fail before credential lookup", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    expect(() =>
      parseWireRequest({
        v: "agentcred/0.1",
        id: "test",
        seq: 1,
        type: "secret.get",
        payload: { credential: "agenttool/default" },
      }),
    ).toThrow(AgentCredError);
    expect(fixture.credentials.calls).toBe(0);
  });

  test("exact credential echoes are redacted before returning or auditing", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    fixture.transport.response = {
      status: 200,
      headers: {
        "content-type": `text/plain; reflected=${TEST_SECRET}`,
        "set-cookie": `token=${TEST_SECRET}`,
      },
      body: Buffer.from(`before:${TEST_SECRET}:after`, "utf8"),
    };
    const handle = await fixture.client.requestGrant(grantRequest());
    const result = await fixture.client.fetch(handle, {
      method: "GET",
      url: "https://api.example.com/v1/whoami",
    });

    expect(Buffer.from(result.bodyBase64, "base64").toString("utf8")).toBe(
      "before:[REDACTED]:after",
    );
    expect(result.headers["content-type"]).toContain("[REDACTED]");
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(result.redactions).toBe(2);
    expect(JSON.stringify(result)).not.toContain(TEST_SECRET);
    expect(JSON.stringify(fixture.audit.events)).not.toContain(TEST_SECRET);
  });

  test("secret-bearing plugin diagnostics are collapsed at the wire boundary", async () => {
    const fixture = await makeBroker({
      credentials: {
        async withCredential() {
          throw new AgentCredError(
            "backend_unavailable",
            `unsafe backend diagnostic: ${TEST_SECRET}`,
            TEST_SECRET,
          );
        },
      },
    });
    fixtures.push(fixture);
    const handle = await fixture.client.requestGrant(grantRequest());

    let observed: unknown;
    try {
      await fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/whoami",
      });
    } catch (error) {
      observed = error;
    }

    expect(observed).toMatchObject({
      code: "backend_unavailable",
      message: "Credential backend is unavailable.",
    });
    expect(JSON.stringify(observed)).not.toContain(TEST_SECRET);
    expect(JSON.stringify(fixture.audit.events)).not.toContain(TEST_SECRET);
  });

  test("audit failure latches and denies subsequent credential use", async () => {
    let notifications = 0;
    const fixture = await makeBroker({
      audit: {
        record() {
          throw new Error("simulated audit failure");
        },
      },
      onAuditFailure: () => {
        notifications += 1;
      },
    });
    fixtures.push(fixture);
    const handle = await fixture.client.requestGrant(grantRequest());

    await expect(
      fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/blocked-after-audit-failure",
      }),
    ).rejects.toMatchObject({ code: "backend_unavailable" });
    expect(fixture.credentials.calls).toBe(0);
    expect(notifications).toBe(1);
  });

  test("concurrent audit failures latch one operator notification", async () => {
    let entered = 0;
    let rejectSink!: (error: Error) => void;
    const sinkFailure = new Promise<void>((_resolve, reject) => {
      rejectSink = reject;
    });
    let notifications = 0;
    const fixture = await makeBroker({
      audit: {
        record() {
          entered += 1;
          if (entered === 2) rejectSink(new Error("test audit failure"));
          return sinkFailure;
        },
      },
      onAuditFailure: () => {
        notifications += 1;
      },
    });
    fixtures.push(fixture);

    await Promise.all([
      fixture.client.requestGrant(grantRequest()),
      fixture.client.requestGrant(grantRequest()),
    ]);
    expect(entered).toBe(2);
    expect(notifications).toBe(1);
    await expect(fixture.client.requestGrant(grantRequest())).rejects.toMatchObject({
      code: "backend_unavailable",
    });
  });

  test("runtime-invalid plugin error codes collapse to request_failed", async () => {
    const fixture = await makeBroker({
      credentials: {
        async withCredential() {
          throw new AgentCredError(
            TEST_SECRET as never,
            `unsafe diagnostic ${TEST_SECRET}`,
          );
        },
      },
    });
    fixtures.push(fixture);
    const handle = await fixture.client.requestGrant(grantRequest());

    await expect(
      fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/runtime-code",
      }),
    ).rejects.toMatchObject({ code: "request_failed" });
    expect(JSON.stringify(fixture.audit.events)).not.toContain(TEST_SECRET);
    expect(fixture.audit.events.at(-1)?.reasonCode).toBe("request_failed");
  });
});

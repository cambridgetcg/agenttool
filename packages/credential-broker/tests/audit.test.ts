import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlAuditSink } from "../src/index.js";
import { InMemoryCredentialSource } from "../src/testing.js";
import {
  grantRequest,
  makeBroker,
  TEST_SECRET,
  type BrokerFixture,
} from "./helpers.js";

const roots: string[] = [];
const fixtures: BrokerFixture[] = [];
const credentialSources: InMemoryCredentialSource[] = [];

async function secureTempDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentcred-audit-"));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  for (const source of credentialSources.splice(0)) source.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("owner-only JSONL audit", () => {
  test("creates and writes through an owner-only file handle", async () => {
    const root = await secureTempDirectory();
    const path = join(root, "audit.jsonl");
    const sink = new JsonlAuditSink(path);
    await sink.open();
    await sink.record({
      auditId: "audit-test",
      at: new Date(0).toISOString(),
      sessionId: "session-test",
      event: "grant.denied",
      outcome: "denied",
      reasonCode: "test",
    });
    await sink.close();

    expect((await lstat(path)).mode & 0o777).toBe(0o600);
  });

  test("refuses a symlink audit path", async () => {
    const root = await secureTempDirectory();
    const target = join(root, "target.jsonl");
    const path = join(root, "audit.jsonl");
    await writeFile(target, "", { mode: 0o600 });
    await symlink(target, path);

    const sink = new JsonlAuditSink(path);
    await expect(sink.open()).rejects.toMatchObject({ code: "network_denied" });
  });
});

describe("generation-bound audit metadata", () => {
  test("binds the startup-frozen credential generation to grant and use events", async () => {
    const generationId = randomUUID();
    const fixture = await makeBroker({
      credentialGenerationIds: {
        "agenttool/default": generationId,
      },
    });
    fixtures.push(fixture);

    const handle = await fixture.client.requestGrant(grantRequest());
    await fixture.client.fetch(handle, {
      method: "GET",
      url: "https://api.example.com/v1/whoami",
    });

    const bound = fixture.audit.events.filter((event) =>
      ["grant.allowed", "use.completed"].includes(event.event),
    );
    expect(bound).toHaveLength(2);
    expect(
      bound.map((event) => event.credentialGenerationId),
    ).toEqual([generationId, generationId]);
  });

  test("handles explicit prototype-shaped aliases without inherited metadata", async () => {
    const source = new InMemoryCredentialSource();
    credentialSources.push(source);
    source.set("__proto__", TEST_SECRET);
    source.set("toString", TEST_SECRET);
    source.set("agenttool/default", TEST_SECRET);
    const protoGeneration = randomUUID();
    const toStringGeneration = randomUUID();
    const explicit = Object.fromEntries([
      ["__proto__", protoGeneration],
      ["toString", toStringGeneration],
    ]);
    const fixture = await makeBroker({
      credentials: source,
      credentialGenerationIds: explicit,
    });
    fixtures.push(fixture);

    for (const alias of ["__proto__", "toString"] as const) {
      const handle = await fixture.client.requestGrant(
        grantRequest({
          alias: `test-${alias}`,
          credential: alias,
        }),
      );
      await fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/whoami",
      });
    }

    const completed = fixture.audit.events.filter(
      (event) => event.event === "use.completed",
    );
    expect(
      completed.map((event) => [
        event.credential,
        event.credentialGenerationId,
      ]),
    ).toEqual([
      ["__proto__", protoGeneration],
      ["toString", toStringGeneration],
    ]);

    await fixture.close();
    fixtures.pop();
    const inheritedGeneration = randomUUID();
    const inherited = Object.create({
      "agenttool/default": inheritedGeneration,
    }) as Record<string, string>;
    const inheritedFixture = await makeBroker({
      credentials: source,
      credentialGenerationIds: inherited,
    });
    fixtures.push(inheritedFixture);
    const handle = await inheritedFixture.client.requestGrant(grantRequest());
    await inheritedFixture.client.fetch(handle, {
      method: "GET",
      url: "https://api.example.com/v1/whoami",
    });
    const inheritedUse = inheritedFixture.audit.events.find(
      (event) => event.event === "use.completed",
    );
    expect(inheritedUse?.credentialGenerationId).toBeUndefined();
  });
});

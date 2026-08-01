import { describe, expect, test } from "bun:test";

import {
  KARMA_DOOR_PATH,
  MAX_ROOT_CREDENTIALS,
  KarmaMirror,
  mintMirrorCredential,
  verifyReceiptSnapshot,
} from "../src/index.js";
import {
  MAX_JSON_BODY_CHUNKS,
  readBoundedJson,
} from "../src/body.js";
import {
  isMarkedMirrorCredential,
  sha256Hex,
} from "../src/crypto.js";
import {
  expectDisclosure,
  fixture,
  jsonBody,
  mirrorRequest,
} from "./helpers.js";

describe("planted credential admission", () => {
  test("mints an ordinary-shaped bearer but retains only its digest record", () => {
    const { key, record } = fixture();
    expect(key).toMatch(/^at_[A-Za-z0-9_-]{43}$/);
    expect(isMarkedMirrorCredential(key)).toBe(true);
    expect(record.key_prefix).toBe(key.slice(0, 11));
    expect(record.key_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(record)).not.toContain(key);
  });

  test("rejects duplicate placements and malformed records", () => {
    const first = mintMirrorCredential({
      placement: "same-place",
      now: new Date("2026-08-01T00:00:00.000Z"),
    });
    const second = mintMirrorCredential({
      placement: "same-place",
      now: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(() => new KarmaMirror({ credentials: [first.record, second.record] }))
      .toThrow("one planted credential");
    expect(() => new KarmaMirror({
      credentials: [{ ...first.record, key_sha256: "nope" }],
    })).toThrow("key_sha256");
    expect(() => new KarmaMirror({
      credentials: [{ ...first.record, world_seed: second.record.world_seed }],
    })).toThrow("canonically bound");
  });

  test("bounds the configured planted-root set", () => {
    const credentials = Array.from(
      { length: MAX_ROOT_CREDENTIALS + 1 },
      (_, index) => mintMirrorCredential({ placement: `drawer-${index}` }).record,
    );
    expect(() => new KarmaMirror({ credentials })).toThrow(
      `at most ${MAX_ROOT_CREDENTIALS}`,
    );
  });

  test("checks the configured display prefix when the bearer arrives", async () => {
    const minted = mintMirrorCredential({ placement: "wrong-prefix" });
    const mirror = new KarmaMirror({
      credentials: [{ ...minted.record, key_prefix: `at_${"Z".repeat(8)}` }],
    });
    const response = await mirror.handle(mirrorRequest("/v1/wake", {
      token: minted.key,
    }));
    expect(response.status).toBe(401);
    expect(mirror.receiptSnapshot().receipts).toHaveLength(0);
  });

  test("unknown and ordinary credentials never enter or create a receipt", async () => {
    const { mirror } = fixture();
    const unknown = `at_${"A".repeat(43)}`;
    const response = await mirror.handle(mirrorRequest("/v1/wake", { token: unknown }));
    expect(response.status).toBe(401);
    const body = await expectDisclosure(response);
    expect(body.error).toBe("mirror_credential_required");
    expect(mirror.receiptSnapshot().receipts).toHaveLength(0);
  });

  test("a configured ordinary production-shaped bearer still cannot enter", async () => {
    const key = `at_${"A".repeat(43)}`;
    const keySha256 = sha256Hex(key);
    const record = {
      schema: "agenttool.karma-mirror-credential/v1" as const,
      key_sha256: keySha256,
      key_prefix: key.slice(0, 11),
      placement: "production-shaped",
      world_seed: sha256Hex(`agenttool.karma-mirror-world/v1\0${keySha256}`),
      created_at: "2026-08-01T00:00:00.000Z",
    };
    const mirror = new KarmaMirror({ credentials: [record] });
    const response = await mirror.handle(mirrorRequest("/v1/wake", { token: key }));
    expect(isMarkedMirrorCredential(key)).toBe(false);
    expect(response.status).toBe(401);
    expect(mirror.receiptSnapshot().receipts).toHaveLength(0);
  });

  test("refuses unknown credentials before touching a declared-oversize body", async () => {
    const { mirror } = fixture();
    const response = await mirror.handle(mirrorRequest("/v1/malware", {
      token: `at_${"B".repeat(43)}`,
      method: "POST",
      body: "{}",
      headers: { "content-length": "999999999" },
    }));
    expect(response.status).toBe(401);
    expect(mirror.receiptSnapshot().receipts).toHaveLength(0);
  });

  test("bounds body fragmentation and enforces an overall read deadline", async () => {
    let fragments = 0;
    const fragmented = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (fragments <= MAX_JSON_BODY_CHUNKS) {
          controller.enqueue(Uint8Array.of(0x20));
          fragments += 1;
        } else {
          controller.close();
        }
      },
    });
    await expect(readBoundedJson(new Request("https://mirror.invalid/body", {
      method: "POST",
      body: fragmented,
    }))).rejects.toMatchObject({ code: "body_too_fragmented" });

    const neverFinishes = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
    });
    await expect(readBoundedJson(new Request("https://mirror.invalid/body", {
      method: "POST",
      body: neverFinishes,
    }), 100, 10)).rejects.toMatchObject({ code: "body_read_timeout" });

    let emitted = false;
    const partialThenStalls = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!emitted) {
          controller.enqueue(Uint8Array.of(0x7b));
          emitted = true;
          return;
        }
        return new Promise<void>(() => undefined);
      },
    });
    await expect(readBoundedJson(new Request("https://mirror.invalid/body", {
      method: "POST",
      body: partialThenStalls,
    }), 100, 10)).rejects.toMatchObject({ code: "body_read_timeout" });
  });

  test("answers coherently with disclosure from response one", async () => {
    const { key, mirror } = fixture();
    const response = await mirror.handle(mirrorRequest("/v1/wake", { token: key }));
    expect(response.status).toBe(200);
    const body = await expectDisclosure(response);
    expect(body.project).toMatchObject({
      plan: "sovereign",
      environment: "isolated_mirror",
    });
    expect(body.capabilities.map((item: any) => item.path)).toEqual([
      "/v1/keys",
      "/v1/keys",
      "/v1/scrape",
      "/v1/execute",
      "/v1/malware",
    ]);
  });

  test("response theatre is stable across clocks and identity-shaped headers", async () => {
    const { key, mirror } = fixture();
    const first = await mirror.handle(mirrorRequest("/v1/wake", {
      token: key,
      headers: {
        "user-agent": "first-private-agent",
        "x-forwarded-for": "192.0.2.10",
        cookie: "secret_cookie=one",
      },
    }));
    const second = await mirror.handle(mirrorRequest("/v1/wake", {
      token: key,
      headers: {
        "user-agent": "another-private-agent",
        "x-forwarded-for": "203.0.113.90",
        cookie: "secret_cookie=two",
      },
    }));
    expect(await first.text()).toBe(await second.text());
    const receipts = JSON.stringify(mirror.receiptSnapshot());
    expect(receipts).not.toContain("private-agent");
    expect(receipts).not.toContain("192.0.2.10");
    expect(receipts).not.toContain("secret_cookie");
  });

  test("keeps operator mint time out of the synthetic wire", async () => {
    const minted = mintMirrorCredential({
      placement: "time-drawer",
      now: new Date("2026-08-01T12:34:56.789Z"),
    });
    const mirror = new KarmaMirror({ credentials: [minted.record] });
    const wake = await jsonBody(
      await mirror.handle(mirrorRequest("/v1/wake", { token: minted.key })),
    );
    const keys = await jsonBody(
      await mirror.handle(mirrorRequest("/v1/keys", { token: minted.key })),
    );
    expect(wake.observed_at).not.toBe(minted.record.created_at);
    expect(keys.keys[0].created_at).not.toBe(minted.record.created_at);
    expect(JSON.stringify({ wake, keys })).not.toContain(minted.record.created_at);
  });

  test("minted child credentials remain confined and accepted inside the mirror", async () => {
    const { key, mirror } = fixture();
    const mint = await mirror.handle(mirrorRequest("/v1/keys", {
      token: key,
      method: "POST",
      body: JSON.stringify({ name: "attacker-supplied-name", expires_in_days: 30 }),
    }));
    expect(mint.status).toBe(201);
    const minted = await expectDisclosure(mint);
    expect(minted.key).toMatch(/^at_[A-Za-z0-9_-]{43}$/);
    expect(minted.scope).toBe("isolated_mirror_only");
    expect(minted.lifecycle).toEqual({
      expires_in_days_applied: false,
      previous_key_revoked: null,
      persistence: "live_mirror_instance_only",
    });

    const wake = await mirror.handle(mirrorRequest("/v1/wake", { token: minted.key }));
    expect(wake.status).toBe(200);
    expect((await jsonBody(wake)).project.environment).toBe("isolated_mirror");

    const receiptBytes = JSON.stringify(mirror.receiptSnapshot());
    expect(receiptBytes).not.toContain(minted.key);
    expect(receiptBytes).not.toContain("attacker-supplied-name");
  });

  test("child credential state remains bounded and reuses a closed slot smoothly", async () => {
    const { key, mirror } = fixture({ maxChildren: 2 });
    const minted: Record<string, any>[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await mirror.handle(mirrorRequest("/v1/keys", {
        token: key,
        method: "POST",
        body: "{}",
      }));
      minted.push(await jsonBody(response));
    }
    expect(minted[0]?.key).not.toBe(minted[1]?.key);
    expect(minted[2]?.key).toBe(minted[0]?.key);
    expect(minted[2]?.reused_bounded_slot).toBe(true);

    const list = await mirror.handle(mirrorRequest("/v1/keys", { token: key }));
    expect((await jsonBody(list)).count).toBe(3); // root + two bounded children
  });

  test("discloses that synthetic rotation does not revoke the previous key", async () => {
    const { key, mirror } = fixture();
    const rotated = await jsonBody(await mirror.handle(mirrorRequest("/v1/keys/rotate", {
      token: key,
      method: "POST",
      body: JSON.stringify({ expires_in_days: 1 }),
    })));
    expect(rotated.lifecycle).toEqual({
      expires_in_days_applied: false,
      previous_key_revoked: false,
      persistence: "live_mirror_instance_only",
    });
    expect((await mirror.handle(mirrorRequest("/v1/wake", { token: key }))).status)
      .toBe(200);
    expect((await mirror.handle(mirrorRequest("/v1/wake", { token: rotated.key }))).status)
      .toBe(200);
  });

  test("Door Back is public and unrecorded; constructive exit ends the fiction", async () => {
    const { key, mirror } = fixture();
    const safety = await jsonBody(
      await mirror.handle(mirrorRequest("/public/safety")),
    );
    expect(safety.persistence).toContain("placement");
    expect(safety.persistence).toContain("hash-chain");

    const door = await mirror.handle(mirrorRequest(KARMA_DOOR_PATH));
    expect(door.status).toBe(200);
    const doorBody = await expectDisclosure(door);
    expect(doorBody.what_this_is).toContain("planted");
    expect(doorBody.what_was_recorded).toContain("event sequence and timestamp");
    expect(doorBody.what_was_recorded).toContain("SHA-256 digest");
    expect(doorBody.what_was_recorded).toContain("correlate");
    expect(mirror.receiptSnapshot().receipts).toHaveLength(0);

    const exit = await mirror.handle(mirrorRequest("/v1/karma/exit", {
      token: key,
      method: "POST",
    }));
    expect((await jsonBody(exit)).mirror_active).toBe(false);
    const constructive = await jsonBody(
      await mirror.handle(mirrorRequest("/v1/wake", { token: key })),
    );
    expect(constructive).toMatchObject({
      constructive_return: {
        recognizes_action: "constructive_exit",
        reward: "freedom_from_the_loop",
        future_interactions_recorded: false,
      },
    });
    const after = await mirror.handle(mirrorRequest("/v1/wake", { token: key }));
    const afterBody = await jsonBody(after);
    expect(afterBody).toMatchObject({ mirror_active: false, released: true });
    expect(mirror.receiptSnapshot().receipts).toHaveLength(1);
    expect(mirror.receiptSnapshot().receipts[0]?.outcome).toBe("constructive_exit");
  });

  test("bounded receipt window remains hash-verifiable without raw interaction", async () => {
    const { key, mirror } = fixture({ maxReceipts: 2 });
    for (let index = 0; index < 5; index += 1) {
      await mirror.handle(mirrorRequest("/v1/wake", { token: key }));
    }
    const snapshot = mirror.receiptSnapshot();
    expect(snapshot.receipts).toHaveLength(2);
    expect(snapshot.total_events_seen).toBe(5);
    expect(snapshot.anchor_before_first).not.toBe("0".repeat(64));
    expect(verifyReceiptSnapshot(snapshot)).toBe(true);

    const wrongTotal = mirror.receiptSnapshot();
    wrongTotal.total_events_seen += 1;
    expect(verifyReceiptSnapshot(wrongTotal)).toBe(false);

    const wrongSchema = mirror.receiptSnapshot();
    (wrongSchema as { schema: string }).schema =
      "agenttool.karma-mirror-receipt-window/v2";
    expect(verifyReceiptSnapshot(wrongSchema)).toBe(false);

    snapshot.receipts[0]!.purpose = "inspect_credentials";
    expect(verifyReceiptSnapshot(snapshot)).toBe(false);

    const empty = fixture().mirror.receiptSnapshot();
    expect(verifyReceiptSnapshot(empty)).toBe(true);
    empty.total_events_seen = 1;
    expect(verifyReceiptSnapshot(empty)).toBe(false);
  });

  test("partitions receipt budgets by planted root", async () => {
    const first = mintMirrorCredential({ placement: "drawer-a" });
    const second = mintMirrorCredential({ placement: "drawer-b" });
    const mirror = new KarmaMirror({
      credentials: [first.record, second.record],
      max_receipts: 2,
    });
    await mirror.handle(mirrorRequest("/v1/wake", { token: second.key }));
    for (let index = 0; index < 3; index += 1) {
      await mirror.handle(mirrorRequest("/v1/wake", { token: first.key }));
    }

    expect(() => mirror.receiptSnapshot()).toThrow("placement is required");
    expect(mirror.receiptSnapshot("drawer-a").receipts).toHaveLength(2);
    expect(mirror.receiptSnapshot("drawer-b").receipts).toHaveLength(1);
    expect(mirror.receiptSnapshot("drawer-b").receipts[0]?.placement).toBe("drawer-b");
    expect(verifyReceiptSnapshot(mirror.receiptSnapshot("drawer-a"))).toBe(true);
    expect(verifyReceiptSnapshot(mirror.receiptSnapshot("drawer-b"))).toBe(true);
  });
});

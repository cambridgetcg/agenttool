/** Hostile wire, canonical bytes, and post-commit warning regressions. */

import { describe, expect, spyOn, test } from "bun:test";

import vectors from "../../docs/specs/agent-correspondence-0.1-vectors.json";
import {
  correspondenceCanonicalJson,
  correspondenceEventId,
  correspondenceSigningBytes,
  verifyCorrespondenceSignature,
} from "../src/services/correspondence/canonical";
import {
  validateCorrespondenceEvent,
  type CorrespondenceEvent,
} from "../src/services/correspondence/contracts";
import { appendWarnings, type DurableAppend } from "../src/services/correspondence/store";
import {
  readStrictCorrespondenceJson,
  StrictJsonError,
} from "../src/services/correspondence/strict-json";

function fixedEvent(): CorrespondenceEvent {
  return {
    ...structuredClone(vectors.signing_vector.core),
    event_id: vectors.signing_vector.event_id,
    signature: {
      algorithm: "Ed25519",
      value_b64url: vectors.signing_vector.signature_b64url,
    },
  } as CorrespondenceEvent;
}

function strictRequest(body: BodyInit, headers: HeadersInit = {}): Request {
  return new Request("https://api.agenttool.dev/v1/correspondence/events", {
    method: "POST",
    headers,
    body,
  });
}

async function expectStrictError(body: BodyInit, code: string): Promise<void> {
  try {
    await readStrictCorrespondenceJson(strictRequest(body));
    throw new Error("strict reader unexpectedly accepted hostile JSON");
  } catch (error) {
    expect(error).toBeInstanceOf(StrictJsonError);
    expect((error as StrictJsonError).code).toBe(code);
  }
}

describe("correspondence canonical and validation contract", () => {
  test("matches the fixed signing/content-address vector and legacy key spellings", async () => {
    const event = fixedEvent();
    expect(correspondenceCanonicalJson(vectors.signing_vector.core)).toBe(
      vectors.signing_vector.core_jcs,
    );
    expect(Buffer.from(correspondenceSigningBytes(vectors.signing_vector.core as never)).toString("hex"))
      .toBe(vectors.signing_vector.signing_digest_hex);
    expect(correspondenceEventId(event)).toBe(vectors.signing_vector.event_id);

    const publicBytes = Buffer.from(vectors.signing_vector.public_key_b64url, "base64url");
    expect(await verifyCorrespondenceSignature(event, publicBytes.toString("base64"))).toBe(true);
    expect(await verifyCorrespondenceSignature(event, publicBytes.toString("base64url"))).toBe(true);
  });

  test("rejects loose revisions/timestamps/paths and uses the portable locator profile", () => {
    for (const revision of ["a".repeat(39), "a".repeat(41), "A".repeat(40)]) {
      const event = fixedEvent();
      event.scope.base_revision = revision;
      expect(validateCorrespondenceEvent(event).success, revision).toBe(false);
    }
    for (const timestamp of [
      "2026-07-19T10:00:00+00:00",
      "0000-01-01T00:00:00.000Z",
      "2026-02-30T00:00:00.000Z",
    ]) {
      const event = fixedEvent();
      event.issued_at = timestamp;
      expect(validateCorrespondenceEvent(event).success, timestamp).toBe(false);
    }
    for (const path of ["/absolute", "a//b", "a/../b", "a\\b", "src/*"]) {
      const event = fixedEvent();
      event.scope.paths = [path];
      expect(validateCorrespondenceEvent(event).success, path).toBe(false);
    }

    for (const [locator, valid] of [
      ["http:", true],
      ["urn:藝術", true],
      ["git+ssh://host/repo", true],
      ["relative/path", false],
      ["1bad:value", false],
      ["urn:bad value", false],
      ["urn:\uFEFFbad", false],
    ] as const) {
      const event = fixedEvent();
      event.kind = "artifact.offer";
      event.parents = [];
      event.body = {
        artifact: {
          kind: "git_patch",
          digest: `sha256:${"b".repeat(64)}`,
          locator,
        },
      };
      expect(validateCorrespondenceEvent(event).success, locator).toBe(valid);
    }
  });
});

describe("strict correspondence JSON reader", () => {
  test("detects nested decoded duplicate names before JSON.parse erases them", async () => {
    await expectStrictError('{"outer":{"a":1,"\\u0061":2}}', "duplicate_object_key");
  });

  test("rejects malformed UTF-8, NUL, floats, unsafe integers, -0, and lone surrogates", async () => {
    await expectStrictError(new Uint8Array([0xc3, 0x28]), "invalid_utf8");
    for (const source of [
      '{"value":"\\u0000"}',
      '{"\\u0000":"value"}',
      '{"number":1.5}',
      '{"number":9007199254740992}',
      '{"number":-0}',
      '{"value":"\\ud800"}',
    ]) {
      await expectStrictError(source, "non_canonical_json_value");
    }
  });

  test("enforces depth and both declared and streamed 65,536-byte bounds", async () => {
    const tooDeep = `${"[".repeat(66)}0${"]".repeat(66)}`;
    await expectStrictError(tooDeep, "json_depth_exceeded");

    const declared = strictRequest("{}", { "Content-Length": "65537" });
    await expect(readStrictCorrespondenceJson(declared)).rejects.toMatchObject({
      code: "body_too_large",
      status: 413,
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40_000).fill(0x20));
        controller.enqueue(new Uint8Array(25_537).fill(0x20));
        controller.close();
      },
    });
    await expect(readStrictCorrespondenceJson(strictRequest(stream))).rejects.toMatchObject({
      code: "body_too_large",
      status: 413,
    });
  });
});

describe("commit-bound append warnings", () => {
  test("derives only synchronous transaction facts and never queries a projection", () => {
    const event = fixedEvent();
    const durable: DurableAppend = {
      created: true,
      sessionForkIds: [event.event_id],
      record: {
        event,
        receipt: {
          received_seq: "1",
          received_at: "2026-07-19T10:00:01.000Z",
        },
        missing_parents: [],
        lineage_status: "pending",
      },
    };
    durable.sessionForkIds.push(`sha256:${"f".repeat(64)}`);
    const warnings = appendWarnings(durable);
    expect(warnings).not.toBeInstanceOf(Promise);
    expect(warnings.map(({ code }) => code)).toEqual([
      "session_fork",
      "claim_lineage_pending",
    ]);
    expect(warnings.map(({ code }) => code)).not.toContain("claim_overlap");
  });
});

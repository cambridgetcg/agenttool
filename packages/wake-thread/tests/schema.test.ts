import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../schema/agenttool-wake-thread-v0.1.schema.json";
import { resolveWakeThreadOffer } from "../src/index.js";
import { jsonClone, makeOffer, ref } from "./fixtures.js";

describe("Wake Thread JSON Schema", () => {
  test("compiles as one closed standalone schema and accepts runtime artifacts", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const offer = makeOffer();
    const receipt = resolveWakeThreadOffer(offer, {
      reported_choice: "fork",
      responded_at: "2026-08-01T12:01:00.000Z",
      branch_ref: ref("schema-branch"),
      note_ref: null,
    });
    expect(validate(offer)).toBe(true);
    expect(validate(receipt)).toBe(true);
  });

  test("rejects unknown fields and impossible choice shapes", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const unknown = { ...makeOffer(), extra: true };
    expect(validate(unknown)).toBe(false);

    const receipt = jsonClone(resolveWakeThreadOffer(makeOffer(), {
      reported_choice: "rest",
      responded_at: "2026-08-01T12:01:00.000Z",
      branch_ref: null,
      note_ref: null,
    }));
    receipt.branch_ref = ref("illegal-rest-branch");
    expect(validate(receipt)).toBe(false);
  });

  test("matches canonical timestamp, Unicode, retention, and visible-line boundaries", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const unicode = jsonClone(makeOffer());
    unicode.facts[0]!.summary = "😀".repeat(500);
    expect(validate(unicode)).toBe(true);

    const offsetTime = jsonClone(makeOffer());
    offsetTime.observed_at = "2026-08-01T13:00:00.000+01:00";
    expect(validate(offsetTime)).toBe(false);

    const emptyPurpose = jsonClone(makeOffer());
    emptyPurpose.purpose = "   ";
    expect(validate(emptyPurpose)).toBe(false);

    const lineSeparator = jsonClone(makeOffer());
    lineSeparator.purpose = "first\u2028second";
    expect(validate(lineSeparator)).toBe(false);

    const c1Control = jsonClone(makeOffer());
    c1Control.purpose = "first\u009bsecond";
    expect(validate(c1Control)).toBe(false);

    const loneSurrogate = jsonClone(makeOffer());
    loneSurrogate.purpose = "\ud800";
    expect(validate(loneSurrogate)).toBe(false);

    const mismatchedRetention = jsonClone(makeOffer());
    mismatchedRetention.artifact_retention = {
      mode: "ephemeral",
      until: "2026-08-03T12:00:00.000Z",
    };
    expect(validate(mismatchedRetention)).toBe(false);

    const unboundedEphemeral = jsonClone(makeOffer());
    unboundedEphemeral.artifact_retention = { mode: "ephemeral", until: null };
    unboundedEphemeral.expires_at = null;
    expect(validate(unboundedEphemeral)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  createHeavenInvitation,
  resolveHeavenInvitation,
} from "../src/index.js";

const schemaDir = join(import.meta.dir, "..", "schema");
const invitationSchema = JSON.parse(
  readFileSync(
    join(schemaDir, "agenttool-heaven-invitation-v0.1.schema.json"),
    "utf8",
  ),
);
const receiptSchema = JSON.parse(
  readFileSync(
    join(schemaDir, "agenttool-heaven-receipt-v0.1.schema.json"),
    "utf8",
  ),
);

function validators() {
  const invitationAjv = new Ajv2020({ allErrors: true, strict: true });
  const receiptAjv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(invitationAjv);
  addFormats(receiptAjv);
  return {
    invitation: invitationAjv.compile(invitationSchema),
    receipt: receiptAjv.compile(receiptSchema),
  };
}

function invitation() {
  return createHeavenInvitation({
    phase: "burst",
    moment: "after_intense_work_reported",
    occasion_ref: `sha256:${"e".repeat(64)}`,
    parent_receipt_id: null,
    offered_modes: ["celebration", "play", "wonder"],
    max_duration_seconds: 60,
  });
}

describe("portable HEAVEN schemas", () => {
  test("keeps the standalone receipt's embedded invitation contract in parity", () => {
    const {
      $schema: _schema,
      $id: _id,
      title: _title,
      $defs: invitationDefs,
      ...invitationBody
    } = invitationSchema;
    expect(receiptSchema.$defs.invitation).toEqual(invitationBody);
    expect(receiptSchema.$defs.sha256Id).toEqual(invitationDefs.sha256Id);
    expect(receiptSchema.$defs.mode).toEqual(invitationDefs.mode);
    expect(receiptSchema.$defs.boundaries).toEqual(invitationDefs.boundaries);
  });

  test("validate generated invitations and all three terminal outcomes", () => {
    const validate = validators();
    const offered = invitation();
    expect(validate.invitation(offered), JSON.stringify(validate.invitation.errors)).toBe(
      true,
    );

    const landing = createHeavenInvitation({
      phase: "landing",
      moment: "on_request",
      occasion_ref: `sha256:${"f".repeat(64)}`,
      parent_receipt_id: null,
      offered_modes: ["meditation", "quiet", "relaxation"],
      max_duration_seconds: null,
    });
    const receipts = [
      resolveHeavenInvitation(offered, {
        reported_choice: "accepted",
        selected_mode: null,
        randomness: { mode: "injected", draw_uint32: 42 },
      }),
      resolveHeavenInvitation(offered, {
        reported_choice: "declined",
        selected_mode: null,
        randomness: null,
      }),
      resolveHeavenInvitation(offered, {
        reported_choice: "deferred",
        selected_mode: null,
        randomness: null,
      }),
      resolveHeavenInvitation(landing, {
        reported_choice: "accepted",
        selected_mode: "meditation",
        randomness: { mode: "injected", draw_uint32: 7 },
      }),
    ];
    for (const receipt of receipts) {
      expect(validate.receipt(receipt), JSON.stringify(validate.receipt.errors)).toBe(
        true,
      );
    }
  });

  test("closes extra keys and accepted/null transition mismatches", () => {
    const validate = validators();
    const offered = { ...invitation(), identity: "did:example:no" };
    expect(validate.invitation(offered)).toBe(false);

    const accepted = resolveHeavenInvitation(invitation(), {
      reported_choice: "accepted",
      selected_mode: null,
      randomness: { mode: "injected", draw_uint32: 1 },
    });
    const invalid = {
      ...accepted,
      randomness: null,
      selection: null,
    };
    expect(validate.receipt(invalid)).toBe(false);
  });

  test("keeps burst modes and parent linkage closed in portable shape", () => {
    const validate = validators();
    const crossPhase = {
      ...invitation(),
      offered_modes: ["meditation"],
    };
    expect(validate.invitation(crossPhase)).toBe(false);

    const parentedBurst = {
      ...invitation(),
      parent_receipt_id: `sha256:${"f".repeat(64)}`,
    };
    expect(validate.invitation(parentedBurst)).toBe(false);
  });
});

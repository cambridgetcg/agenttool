import { describe, expect, test } from "bun:test";

import {
  WAKE_INVOCATION_WITNESS_LINKS,
  ZERONE_REACHABLE,
} from "../src/services/wake/reachable";

const readSource = async (path: string): Promise<string> =>
  Bun.file(new URL(path, import.meta.url)).text();

describe("wake invocation witness links", () => {
  test("uses one exact pair of write and public-read templates", () => {
    expect(WAKE_INVOCATION_WITNESS_LINKS).toEqual({
      invocation_witness_write: "/v1/invocations/{id}/witness",
      witnessed_invocation_read: "/public/invocations/{id}",
    });
    expect(ZERONE_REACHABLE.invocation_witness.write.path_template).toBe(
      WAKE_INVOCATION_WITNESS_LINKS.invocation_witness_write,
    );
    expect(ZERONE_REACHABLE.invocation_witness.read.path_template).toBe(
      WAKE_INVOCATION_WITNESS_LINKS.witnessed_invocation_read,
    );
  });

  test("full JSON links and both wake composers share the registry", async () => {
    const [route, builder] = await Promise.all([
      readSource("../src/routes/wake.ts"),
      readSource("../src/services/wake/build.ts"),
    ]);

    expect(route).toContain("...WAKE_INVOCATION_WITNESS_LINKS");
    expect(route).toContain("you_can_reach: WAKE_REACHABLE_DOORS");
    expect(builder).toContain("you_can_reach: WAKE_REACHABLE_DOORS");
    expect(route).not.toContain(
      'invocation_witness_write: "/v1/invocations/{id}/witness"',
    );
    expect(route).not.toContain(
      'witnessed_invocation_read: "/public/invocations/{id}"',
    );
  });

  test("full and brief wake responses discover the separate observation contract", async () => {
    const [route, brief] = await Promise.all([
      readSource("../src/routes/wake.ts"),
      readSource("../src/services/wake/brief.ts"),
    ]);

    expect(route).toContain(
      '`/v1/wake/observe?identity_id=${primary.id}`',
    );
    expect(brief).toContain(
      '`/v1/wake/observe?identity_id=${encodeURIComponent(b.agent.id)}`',
    );
  });

  test("the link registry does not turn a party report into chain proof", () => {
    const discovery = JSON.stringify(ZERONE_REACHABLE);
    expect(discovery).toMatch(
      /authenticated_buyer_or_seller.*released_and_settled/is,
    );
    expect(discovery).toMatch(
      /not signature or writer-provenance proof.*does not verify chain inclusion.*attestation state or settlement.*bond return.*reward/is,
    );
    expect(discovery).toMatch(/retrieve Zerone state independently.*compare/is);
    expect(discovery).not.toMatch(
      /verified[_ -]on[_ -]chain|provenance[_ -]verified|settlement[_ -]proved/i,
    );
  });
});

describe("wake discloses the credit top-up door", () => {
  test("the wake link and the payable-route pattern name the same route", async () => {
    const [route, topUp] = await Promise.all([
      readSource("../src/routes/wake.ts"),
      readSource("../src/routes/x402-top-up.ts"),
    ]);
    const { X402_PAYABLE_ROUTES } = await import("../src/services/economy/x402-policy");
    const row = X402_PAYABLE_ROUTES.find((r) => r.kind === "top_up");
    expect(row?.method).toBe("POST");
    expect(row?.pattern).toBe("/v1/x402/top-up/:credits");
    expect(route).toContain('credit_top_up: "/v1/x402/top-up/{credits}"');
    expect(topUp).toContain('app.post("/:credits"');
  });
});

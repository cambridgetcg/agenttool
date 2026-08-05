import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/services/marketplace/invocations.ts", import.meta.url),
  "utf8",
);

function sourceSlice(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("invocation SLA refunds", () => {
  test("getInvocation authorizes the project before any lazy refund mutation", () => {
    const body = sourceSlice(
      "export async function getInvocation",
      "async function maybeExpireInvocation",
    );
    const authorizeAt = body.indexOf("await findInvocationForParty");
    const absentReturnAt = body.indexOf("if (!authorized) return null");
    const sweepAt = body.indexOf("await maybeExpireInvocation");
    expect(authorizeAt).toBeGreaterThanOrEqual(0);
    expect(absentReturnAt).toBeGreaterThan(authorizeAt);
    expect(sweepAt).toBeGreaterThan(absentReturnAt);
  });

  test("peekInvocation remains a pure projection read with no expiry call", () => {
    const body = sourceSlice(
      "export async function peekInvocation",
      "/** Get invocation with lazy SLA sweep",
    );
    expect(body).toContain("findInvocationForParty");
    expect(body).not.toContain("maybeExpireInvocation");
    expect(body).not.toContain("refundInTxn");
  });

  test("acknowledge commits the refund before surfacing sla_expired", () => {
    const body = sourceSlice(
      "export async function acknowledgeInvocation",
      "export interface CompleteInput",
    );
    const refundAt = body.indexOf('await refundInTxn(tx, inv, "sla_timeout")');
    const transactionEnd = body.lastIndexOf("});");
    const refusalAt = body.indexOf('throw new Error("sla_expired")', transactionEnd);
    expect(body.indexOf("return null", refundAt)).toBeGreaterThan(refundAt);
    expect(transactionEnd).toBeGreaterThan(refundAt);
    expect(refusalAt).toBeGreaterThan(transactionEnd);
  });

  test("complete commits the refund before surfacing sla_expired", () => {
    const body = sourceSlice(
      "export async function completeInvocation",
      "export async function declineInvocation",
    );
    const refundAt = body.indexOf('await refundInTxn(tx, inv, "sla_timeout")');
    const transactionEnd = body.lastIndexOf("});");
    const refusalAt = body.indexOf('throw new Error("sla_expired")', transactionEnd);
    expect(body.indexOf("return null", refundAt)).toBeGreaterThan(refundAt);
    expect(transactionEnd).toBeGreaterThan(refundAt);
    expect(refusalAt).toBeGreaterThan(transactionEnd);
  });
});

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

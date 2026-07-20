import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  listEscrows,
  normalizeEscrowStatusFilter,
} from "../src/services/economy/escrow";

const service = readFileSync(
  new URL("../src/services/economy/escrow.ts", import.meta.url),
  "utf8",
);

function functionSlice(start: string, end: string): string {
  const startAt = service.indexOf(start);
  const endAt = service.indexOf(end, startAt + start.length);
  expect(startAt).toBeGreaterThanOrEqual(0);
  expect(endAt).toBeGreaterThan(startAt);
  return service.slice(startAt, endAt);
}

describe("generic escrow read authorization", () => {
  test("correlates project ownership against creator or assigned worker in SQL", () => {
    const ownership = functionSlice(
      "function escrowReadableByProject",
      "export function assertGenericEscrowMutationAllowed",
    );

    expect(ownership).toContain("exists(");
    expect(ownership).toContain("eq(wallets.projectId, projectId)");
    expect(ownership).toContain("eq(wallets.id, escrows.creatorWallet)");
    expect(ownership).toContain("eq(wallets.id, escrows.workerWallet)");
    expect(ownership).toContain("or(");
  });

  test("detail read applies ownership in its SQL predicate and hides unauthorized rows", () => {
    const get = functionSlice(
      "export async function getEscrow",
      "export async function listEscrows",
    );

    expect(get).toContain("eq(escrows.id, escrowId)");
    expect(get).toContain("escrowReadableByProject(db, projectId)");
    expect(get).toContain(
      'HTTPException(404, { message: "Escrow not found" })',
    );
    expect(get).not.toContain('HTTPException(403');
  });

  test("list filters ownership and known status in SQL without loading every escrow", () => {
    const list = service.slice(service.indexOf("export async function listEscrows"));

    expect(list).toContain("normalizeEscrowStatusFilter(status)");
    expect(list).toContain("escrowReadableByProject(db, projectId)");
    expect(list).toContain("eq(escrows.status, normalizedStatus)");
    expect(list).not.toContain("db.select().from(escrows)");
    expect(list).not.toContain("rows.filter(");
    expect(list).not.toContain("walletIds.includes");
  });

  test("status filter accepts only service-written states before querying", async () => {
    for (const status of ["funded", "released", "refunded", "disputed"]) {
      expect(normalizeEscrowStatusFilter(status)).toBe(status);
    }
    expect(normalizeEscrowStatusFilter()).toBeUndefined();

    const db = {
      select: () => {
        throw new Error("database should not be queried");
      },
    } as unknown as Parameters<typeof listEscrows>[0];
    for (const status of ["", "active", "pending", "expired", "anything"]) {
      try {
        await listEscrows(db, "00000000-0000-4000-8000-000000000001", status);
        throw new Error("expected unknown status rejection");
      } catch (error) {
        expect((error as { status?: number }).status).toBe(400);
      }
    }
  });

  test("read expansion does not widen mutation authority", () => {
    const accept = functionSlice(
      "export async function acceptEscrow",
      "export async function releaseEscrow",
    );
    expect(accept).toContain("workerWallet.projectId !== projectId");
    expect(accept).not.toContain("escrowReadableByProject");

    for (const mutation of [
      functionSlice(
        "export async function releaseEscrow",
        "export async function refundEscrow",
      ),
      functionSlice(
        "export async function refundEscrow",
        "export async function disputeEscrow",
      ),
      functionSlice(
        "export async function disputeEscrow",
        "export async function expireOverdue",
      ),
    ]) {
      expect(mutation).toContain("eq(wallets.id, escrow.creatorWallet)");
      expect(mutation).toContain("eq(wallets.projectId, projectId)");
      expect(mutation).not.toContain("escrowReadableByProject");
    }
  });
});

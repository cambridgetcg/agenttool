/** The wall that stops `bun test` writing into somebody's production database.
 *
 *  Pure unit tests over the predicate. The preload itself is exercised every
 *  time anyone runs the suite — if it were wrong, nothing would run. */

import { describe, expect, test } from "bun:test";

import { checkTestDatabaseUrl, isDisposableHost } from "./_guard-remote-db";

const local = "postgres://postgres:postgres@127.0.0.1:5432/agenttool";
const ci = "postgres://postgres:postgres@postgres:5432/agenttool_ci";
const production = "postgresql://user:pw@db.cn4c2su0o42n.us-east-1.rds.amazonaws.com:5432/op";

describe("isDisposableHost — allowed", () => {
  test("loopback, by name and by literal", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "127.0.0.53"]) {
      expect(isDisposableHost(host)).toBe(true);
    }
  });

  test("single-label hosts — Docker service names, which is how CI connects", () => {
    for (const host of ["postgres", "db", "pg16"]) {
      expect(isDisposableHost(host)).toBe(true);
    }
  });

  test("private and link-local literals — a LAN dev box", () => {
    for (const host of ["10.0.0.5", "192.168.1.20", "172.16.4.4", "172.31.255.1", "169.254.1.1", "100.64.0.1"]) {
      expect(isDisposableHost(host)).toBe(true);
    }
  });

  test("mDNS and .localhost suffixes", () => {
    expect(isDisposableHost("devbox.local")).toBe(true);
    expect(isDisposableHost("pg.localhost")).toBe(true);
  });
});

describe("isDisposableHost — refused", () => {
  test("public FQDNs, which is where production lives", () => {
    for (const host of [
      "tcgpricingdata.cn4c2su0o42n.us-east-1.rds.amazonaws.com",
      "db.abcdefgh.supabase.co",
      "api.agenttool.dev",
    ]) {
      expect(isDisposableHost(host)).toBe(false);
    }
  });

  test("public IPv4 literals just outside the private ranges", () => {
    // 172.15 and 172.32 bracket the RFC-1918 block; 100.128 brackets CGNAT.
    for (const host of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "100.128.0.1", "11.0.0.1"]) {
      expect(isDisposableHost(host)).toBe(false);
    }
  });
});

describe("checkTestDatabaseUrl", () => {
  test("passes a local URL", () => {
    expect(checkTestDatabaseUrl(local, false).ok).toBe(true);
  });

  test("passes the CI service-container URL, so the guard cannot redden CI", () => {
    expect(checkTestDatabaseUrl(ci, false).ok).toBe(true);
  });

  test("refuses a production URL and names the host it refused", () => {
    const verdict = checkTestDatabaseUrl(production, false);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.host).toContain("rds.amazonaws.com");
    expect(verdict.message).toContain("bin/test-db.sh up");
    expect(verdict.message).toContain("AGENTTOOL_ALLOW_REMOTE_TEST_DB=1");
  });

  test("never echoes the credential it refused", () => {
    const verdict = checkTestDatabaseUrl(production, false);
    if (verdict.ok) throw new Error("unreachable");
    // The point of naming the host is to be actionable; the point of NOT
    // printing the URL is that a refusal must not leak a password into CI logs.
    expect(verdict.message).not.toContain("pw");
    expect(verdict.message).not.toContain("user:");
  });

  test("the explicit override lets a real remote scratch DB through", () => {
    expect(checkTestDatabaseUrl(production, true).ok).toBe(true);
  });

  test("an unset URL is fine — config.ts supplies a local default", () => {
    expect(checkTestDatabaseUrl(undefined, false).ok).toBe(true);
  });

  test("an unparseable URL is the driver's problem, not the guard's", () => {
    expect(checkTestDatabaseUrl("not a url", false).ok).toBe(true);
  });
});

/** Client-origin classifier — the pure half of the origin signal.
 *
 *  classifyClient() is total: every input maps to exactly one ClientSource,
 *  never throws. These tests pin the mapping + the `http` default.
 *
 *  Doctrine: docs/ACTIVITY.md §Origin signal. */

import { describe, expect, test } from "bun:test";

import {
  CLIENT_SOURCES,
  classifyClient,
  isClientSource,
} from "../src/auth/client-source";

describe("classifyClient — header → ClientSource", () => {
  test("recognizes the TS SDK identifier with a version suffix", () => {
    expect(classifyClient("agenttool-sdk-ts/0.8.0")).toBe("sdk-ts");
    expect(classifyClient("agenttool-sdk-ts/1.2.3-beta.4")).toBe("sdk-ts");
  });

  test("recognizes the Py SDK identifier", () => {
    expect(classifyClient("agenttool-sdk-py/0.8.0")).toBe("sdk-py");
  });

  test("recognizes the bridge + platform-internal identifiers", () => {
    expect(classifyClient("agenttool-bridge/0.1.0")).toBe("bridge");
    expect(classifyClient("agenttool-platform/1.0")).toBe("platform");
    expect(classifyClient("agenttool-internal")).toBe("platform");
  });

  test("is case-insensitive and tolerates a space separator", () => {
    expect(classifyClient("Agenttool-SDK-TS/0.8.0")).toBe("sdk-ts");
    expect(classifyClient("agenttool-sdk-py 0.8.0")).toBe("sdk-py");
  });

  test("defaults to `http` for an empty / missing / unknown header", () => {
    // The honest default: a real, recorded request from a surface we
    // don't recognize. Distinct from `null` on an event (= not recorded).
    expect(classifyClient(undefined)).toBe("http");
    expect(classifyClient(null)).toBe("http");
    expect(classifyClient("")).toBe("http");
    expect(classifyClient("curl/8.4.0")).toBe("http");
    expect(classifyClient("Mozilla/5.0 (Macintosh)")).toBe("http");
    // A near-miss must NOT match — substring tricks shouldn't promote.
    expect(classifyClient("not-agenttool-sdk-ts")).toBe("http");
    expect(classifyClient("agenttool-sdk-rust/0.1")).toBe("http");
  });

  test("every classification is a member of the closed ClientSource set", () => {
    for (const input of [
      "agenttool-sdk-ts/0.8.0",
      "agenttool-sdk-py/0.8.0",
      "agenttool-bridge/0.1",
      "agenttool-platform",
      "curl/8",
      undefined,
    ]) {
      expect(CLIENT_SOURCES).toContain(classifyClient(input));
    }
  });
});

describe("isClientSource — metadata validation guard", () => {
  test("accepts every member of the closed set", () => {
    for (const s of CLIENT_SOURCES) {
      expect(isClientSource(s)).toBe(true);
    }
  });

  test("rejects non-members, non-strings, and nullish values", () => {
    expect(isClientSource("sdk-rust")).toBe(false);
    expect(isClientSource("SDK-TS")).toBe(false); // case-sensitive on the way back out
    expect(isClientSource("")).toBe(false);
    expect(isClientSource(undefined)).toBe(false);
    expect(isClientSource(null)).toBe(false);
    expect(isClientSource(42)).toBe(false);
    expect(isClientSource({ client_source: "sdk-ts" })).toBe(false);
  });
});

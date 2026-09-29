/** Public enrollment intent only: synthetic local keys, offline Node CLI, no bearer. */
import { afterEach, describe, expect, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalIdentityEnrollmentBytes, identityEnrollmentSchema } from "../../api/src/services/identity/enrollment";
import { enrollmentProof, init } from "../agenttool-mission.mjs";

const CLI = resolve(import.meta.dir, "../agenttool-mission.mjs"), NODE = Bun.which("node")!;
const ORIGIN = "https://enrollment-fixture.invalid";
const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "enrollment client's fixture-"))); chmodSync(root, 0o700);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "state"), enrollment = init(state, ORIGIN);
  const details = { project_id: randomUUID(), identity_id: randomUUID(), signing_key_id: randomUUID(), display_name: "雨夜 🌞", capabilities: ["mission.read", "mission.observe"] };
  const file = join(root, "details.json"); writeFileSync(file, JSON.stringify(details), { mode: 0o600 });
  const marker = join(root, "fetch-attempts"), barrier = join(root, "no-fetch.mjs");
  writeFileSync(barrier, `import {appendFileSync} from 'node:fs'; globalThis.fetch = async () => { appendFileSync(${JSON.stringify(marker)}, 'unexpected'); throw new Error('offline'); };`, { mode: 0o600 });
  return { root, state, enrollment, details, file, marker, barrier };
}
type Fixture = ReturnType<typeof fixture>;
function snapshot(f: Fixture) {
  return { names: readdirSync(f.state).sort(), key: readFileSync(join(f.state, "signing-key.pem")),
    enrollment: readFileSync(join(f.state, "enrollment.json")), outbox: readdirSync(join(f.state, "outbox")) };
}
function run(f: Fixture, extra: string[] = []) {
  return spawnSync(NODE, ["--import", f.barrier, CLI, "enroll-proof", "--state", f.state, "--details-file", f.file, ...extra], {
    cwd: f.root, env: { PATH: process.env.PATH ?? "", HOME: f.root, TMPDIR: tmpdir() }, encoding: "utf8", timeout: 5000, maxBuffer: 128 * 1024,
  });
}
function verifyProof(proof: ReturnType<typeof enrollmentProof>, raw = proof.body_utf8, origin = proof.origin, projectId = JSON.parse(raw).project_id) {
  const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(JSON.parse(proof.body_utf8).public_key, "base64").toString("base64url") }, format: "jwk" });
  return verify(null, canonicalIdentityEnrollmentBytes({ origin, projectId, bodyBytes: Buffer.from(raw) }), publicKey,
    Buffer.from(proof.headers["X-Agenttool-Enrollment-Signature"], "base64url"));
}

describe.skipIf(process.platform === "win32")("same-project enrollment proof client", () => {
  test("real Node output is a server-compatible public intent without HTTP or state mutation", () => {
    const f = fixture(), before = snapshot(f), started = Date.now(), result = run(f);
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe("");
    const proof = JSON.parse(result.stdout), body = JSON.parse(proof.body_utf8);
    expect(proof.format).toBe("agenttool-identity-enrollment-request/v1");
    expect(proof.method).toBe("POST"); expect(proof.request_target).toBe("/v1/identities/enroll");
    expect(proof.origin).toBe(ORIGIN); expect(identityEnrollmentSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ ...f.details, origin: ORIGIN, public_key: f.enrollment.public_key });
    expect(Date.parse(body.timestamp)).toBeGreaterThanOrEqual(started);
    expect(Date.parse(body.timestamp)).toBeLessThanOrEqual(Date.now());
    expect(Buffer.from(body.nonce, "base64url").length).toBe(32);
    expect(Buffer.from(proof.headers["X-Agenttool-Enrollment-Signature"], "base64url").length).toBe(64);
    expect(verifyProof(proof)).toBe(true);
    expect(Object.keys(proof.headers).sort()).toEqual(["Content-Type", "X-Agenttool-Enrollment-Signature"]);
    expect(result.stdout).not.toContain("PRIVATE KEY"); expect(result.stdout).not.toContain("Bearer");
    expect(existsSync(f.marker)).toBe(false); expect(snapshot(f)).toEqual(before);
  });

  test("proof binds the origin, destination project, every selected birth field and exact body bytes", () => {
    const f = fixture(), proof = enrollmentProof(f.state, f.details), body = JSON.parse(proof.body_utf8);
    expect(verifyProof(proof)).toBe(true);
    expect(verifyProof(proof, proof.body_utf8 + " ")).toBe(false);
    expect(verifyProof(proof, proof.body_utf8, "https://other.invalid")).toBe(false);
    expect(verifyProof(proof, proof.body_utf8, ORIGIN, randomUUID())).toBe(false);
    for (const patch of [
      { project_id: randomUUID() }, { identity_id: randomUUID() }, { signing_key_id: randomUUID() },
      { display_name: "Different intent" }, { capabilities: [] }, { nonce: Buffer.alloc(32, 7).toString("base64url") },
      { timestamp: "2026-01-01T00:00:00.000Z" }, { public_key: Buffer.alloc(32, 8).toString("base64") },
    ]) expect(verifyProof(proof, JSON.stringify({ ...body, ...patch }))).toBe(false);
    expect(JSON.parse(enrollmentProof(f.state, f.details).body_utf8).nonce).not.toBe(body.nonce);
  });

  test("ambiguous IDs, extra authority and invalid Unicode cannot be signed", () => {
    const f = fixture(), before = snapshot(f);
    for (const patch of [
      { project_id: [f.details.project_id] }, { identity_id: [f.details.identity_id] }, { signing_key_id: [f.details.signing_key_id] },
      { project_id: "not-a-uuid" }, { project_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }, { origin: "https://other.invalid" },
      { token: "do-not-sign" }, { display_name: "" }, { display_name: "\ud800" }, { display_name: "a\0b" },
      { display_name: "🌞".repeat(129) }, { capabilities: "mission.read" }, { capabilities: [""] },
      { capabilities: ["\udfff"] }, { capabilities: ["a\0b"] }, { capabilities: ["🌞".repeat(65)] },
      { capabilities: Array(33).fill("read") },
    ]) expect(() => enrollmentProof(f.state, { ...f.details, ...patch })).toThrow();
    expect(() => enrollmentProof(f.state, { ...f.details, display_name: "🌞".repeat(128), capabilities: ["🌞".repeat(64)] })).not.toThrow();
    expect(snapshot(f)).toEqual(before);
  });

  test("real CLI refuses unsafe selected files and malformed arguments without leaking content or making requests", () => {
    const f = fixture(), before = snapshot(f);
    function refused(extra: string[] = []) {
      const result = run(f, extra);
      expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(1);
      expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("do-not-disclose");
      expect(existsSync(f.marker)).toBe(false); expect(snapshot(f)).toEqual(before);
    }
    refused(["--accept"]); refused(["--details-file", f.file]);
    chmodSync(f.file, 0o644); refused(); chmodSync(f.file, 0o600);
    writeFileSync(f.file, "{ malformed do-not-disclose"); refused();
    writeFileSync(f.file, Buffer.from([0xff, 0xfe])); refused();
    const link = join(f.root, "details-link"); symlinkSync(f.file, link);
    f.file = link; refused(); f.file = "relative.json"; refused();
  });

  test("mismatched local key and public enrollment cannot produce a proof", () => {
    const f = fixture();
    writeFileSync(join(f.state, "signing-key.pem"), generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }));
    expect(() => enrollmentProof(f.state, f.details)).toThrow("does not match");
    const result = run(f); expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(existsSync(f.marker)).toBe(false);
  });
});

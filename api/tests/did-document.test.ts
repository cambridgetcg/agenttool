import { describe, expect, test } from "bun:test";
import bs58 from "bs58";
import { base58 as scureBase58 } from "@scure/base";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  buildAgentDidDocument,
  buildOrgDidDocument,
  ed25519ToDidKey,
  ed25519ToMultibase,
} from "../src/services/identity/did-document.ts";

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

describe("ed25519 → did:key / Multikey encoding", () => {
  test("multibase is z + base58btc(0xed01 ‖ key), round-trips back to the key", () => {
    const pub = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
    const mb = ed25519ToMultibase(b64(pub));
    expect(mb[0]).toBe("z");
    const decoded = bs58.decode(mb.slice(1));
    expect([decoded[0], decoded[1]]).toEqual([0xed, 0x01]); // multicodec header
    expect(Uint8Array.from(decoded.slice(2))).toEqual(pub); // exact key recovered
  });

  test("did:key is the multibase prefixed with did:key:", () => {
    const pub = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
    const b = b64(pub);
    expect(ed25519ToDidKey(b)).toBe(`did:key:${ed25519ToMultibase(b)}`);
  });

  test("agrees with an independent base58 implementation (@scure/base)", () => {
    // Cross-library check: our multibase must equal z + base58btc(0xed01 ‖ key)
    // computed by a different, widely-used base58 implementation.
    const pub = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
    const tagged = Uint8Array.from([0xed, 0x01, ...pub]);
    const independent = `z${scureBase58.encode(tagged)}`;
    expect(ed25519ToMultibase(b64(pub))).toBe(independent);
    // And the canonical z6Mk… prefix ed25519 did:keys always carry.
    expect(ed25519ToMultibase(b64(pub)).startsWith("z6Mk")).toBe(true);
  });

  test("rejects a non-32-byte key", () => {
    expect(() => ed25519ToMultibase(b64(new Uint8Array(16)))).toThrow("32 bytes");
  });

  test("accepts base64url-encoded keys too", () => {
    const pub = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
    const url = b64(pub).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(ed25519ToMultibase(url)).toBe(ed25519ToMultibase(b64(pub)));
  });
});

describe("agent DID Document", () => {
  const did = "did:at:11111111-1111-4111-8111-111111111111";
  const pub = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
  const doc = buildAgentDidDocument({
    did,
    keys: [{ id: "primary", publicKey: b64(pub) }],
    baseUrl: "https://api.agenttool.dev",
  });

  test("id is the honest did:at; did:key is the portable alsoKnownAs", () => {
    expect(doc.id).toBe(did);
    expect(doc.alsoKnownAs).toEqual([ed25519ToDidKey(b64(pub))]);
  });

  test("the ed25519 key is a resolvable Multikey verification method", () => {
    const vm = (doc.verificationMethod as any[])[0];
    expect(vm.type).toBe("Multikey");
    expect(vm.controller).toBe(did);
    expect(vm.publicKeyMultibase).toBe(ed25519ToMultibase(b64(pub)));
    expect(doc.authentication).toEqual([vm.id]);
    expect(doc.assertionMethod).toEqual([vm.id]);
  });

  test("service endpoints point at wake, per-agent MCP, profile, WebFinger", () => {
    const svc = doc.service as any[];
    const byType = Object.fromEntries(svc.map((s) => [s.type, s.serviceEndpoint]));
    expect(byType.WakeKeystone).toBe("https://api.agenttool.dev/v1/wake");
    expect(byType.ModelContextProtocol).toContain("/v1/mcp/agents/");
    expect(byType.ModelContextProtocol).toContain(encodeURIComponent(did));
    expect(byType.WebFinger).toContain(`resource=${encodeURIComponent(did)}`);
  });

  test("multiple keys sharing a fragment get unique ids (DID Core requires it)", () => {
    const k = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
    const k2 = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
    // Both passed with the SAME id "primary" — the helper must disambiguate.
    const d = buildAgentDidDocument({
      did,
      keys: [{ id: "primary", publicKey: b64(k) }, { id: "primary", publicKey: b64(k2) }],
      baseUrl: "https://api.agenttool.dev",
    });
    const ids = (d.verificationMethod as any[]).map((v) => v.id);
    expect(new Set(ids).size).toBe(2); // unique
    expect(ids).toEqual([`${did}#primary`, `${did}#primary-2`]);
    expect(d.authentication).toEqual(ids); // no duplicates leak into auth
  });

  test("a revoked-into-keyless identity yields a valid doc with no auth methods", () => {
    const bare = buildAgentDidDocument({ did, keys: [], baseUrl: "https://api.agenttool.dev" });
    expect(bare.verificationMethod).toEqual([]);
    expect(bare.authentication).toBeUndefined();
    expect(bare.alsoKnownAs).toBeUndefined();
    expect((bare.service as any[]).length).toBe(4);
  });
});

describe("org DID Document", () => {
  test("did:web:<host> resolves to the platform service catalog", () => {
    const doc = buildOrgDidDocument("https://api.agenttool.dev");
    expect(doc.id).toBe("did:web:api.agenttool.dev");
    const types = (doc.service as any[]).map((s) => s.type);
    expect(types).toContain("AgentRegistration");
    expect(types).toContain("WakeKeystone");
  });

  test("every serviceEndpoint is a valid brace-free URI (strict resolvers reject templates)", () => {
    const doc = buildOrgDidDocument("https://api.agenttool.dev");
    for (const s of doc.service as any[]) {
      expect(s.serviceEndpoint).not.toMatch(/[{}]/);
      expect(() => new URL(s.serviceEndpoint)).not.toThrow();
    }
  });
});

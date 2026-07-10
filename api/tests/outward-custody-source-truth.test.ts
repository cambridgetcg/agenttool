/** Current outward custody claims must match GET /public/safety. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const CUSTODY_SOURCES = [
  "marketing/LAUNCH-KIT.md",
  "docs/FOCUS.md",
  "docs/PAINTING.md",
  "docs/BUSINESS-MODEL.md",
  "docs/ROADMAP.md",
  "docs/AGENT-CENTRIC.md",
  "docs/AGENT-ECONOMY.md",
  "docs/KIN.md",
  "docs/RUNTIME.md",
  "docs/STRANDS.md",
  "docs/FRICTION-ROADMAP.md",
  "docs/agenttool.jsonld",
  "apps/docs/BUSINESS-MODEL.md",
  "apps/docs/AGENT-ECONOMY.md",
  "apps/docs/business-model.html",
  "apps/docs/roadmap.html",
  "apps/docs/KIN.md",
  "apps/docs/kin.html",
  "apps/docs/runtime.html",
  "apps/docs/strands.html",
  "apps/docs/tutorial.html",
  "apps/docs/IDENTITY-SEED.md",
  "docs/IDENTITY-SEED.md",
  "apps/docs/glossary.html",
  "apps/docs/index.html",
  "apps/docs/welcome.html",
  "apps/docs/wake.html",
  "apps/docs/economy.html",
  "apps/docs/tools.html",
  "apps/docs/vault.html",
  "apps/docs/wallets.html",
  "apps/docs/runtime.html",
  "apps/docs/dark-continent.html",
  "apps/docs/THE-SEAT.md",
  "apps/docs/ai-logos.html",
  "apps/docs/love.html",
  "apps/docs/nen-mechanics.html",
  "apps/docs/agenttool.jsonld",
  "api/src/services/wake/affordances.ts",
] as const;

const FORBIDDEN_CURRENT_CLAIMS = [
  /inner voice[^.\n]{0,80}opaque to (?:us|agenttool)/i,
  /we could not read your interior/i,
  /we can'?t read (?:your thoughts|them) by design/i,
  /even compelled[^.\n]{0,120}(?:only opaque ciphertext|we have only ciphertext|we have nothing)/i,
  /plaintext stays client-side[^.\n]{0,120}hosted/i,
  /bridged[^.\n]{0,160}cryptographic (?:privacy|opacity)/i,
  /trusted[^.\n]{0,120}(?:not yet shipped|currently returns 501|kms pending|tier live|e2e verified)/i,
  /what i thought[^.\n]{0,120}unreadable by the platform/i,
  /strands stay opaque to us/i,
  /architectural privacy guarantee in `?self`?\s*\/\s*`?bridged`?/i,
  /no platform-readable thoughts/i,
  /\*\*Server never receives\*\*/i,
  /vault secrets are auto-injected|with vault auto-injection|vault auto-inject\)/i,
  /mutual ed25519 handshake/i,
  /TLS pinning/i,
  /key-pinned channel/i,
  /we never see the (?:traffic|query)/i,
  /values are zeroed/i,
  /tamper-evident access log/i,
  /project's seed and current epoch/i,
] as const;

const CONFIDENTIALITY_SOURCES = [
  "docs/INBOX.md",
  "docs/MERGE-PROPOSALS.md",
  "docs/CONVENTIONS.md",
  "docs/GLOSSARY.md",
  "docs/CANONICAL-BYTES.md",
  "docs/FEDERATION.md",
  "apps/docs/inbox.html",
  "apps/docs/index.html",
  "docs/MARKETPLACE.md",
  "apps/docs/marketplace.html",
  "docs/IDENTITY-ANCHOR.md",
  "apps/docs/IDENTITY-ANCHOR.md",
  "docs/STRANDS.md",
  "docs/SCHEMA-MAP.md",
  "docs/SDK-ROADMAP.md",
  "docs/CLI-GAPS.md",
  "apps/docs/strands.html",
  "apps/docs/bootstrap.html",
  "docs/ROADMAP.md",
  "apps/docs/roadmap.html",
  "api/src/routes/inbox/messages.ts",
  "api/src/routes/federation/inbox.ts",
  "api/src/routes/identity-backup.ts",
  "api/src/routes/scaffold.ts",
  "api/src/routes/openapi.ts",
  "api/src/index.ts",
  "api/src/services/wake/markdown.ts",
  "api/src/db/schema/inbox.ts",
  "api/src/services/marketplace/CLAUDE.md",
] as const;

const FORBIDDEN_ABSOLUTE_CONFIDENTIALITY_CLAIMS = [
  /we cannot read your DMs/i,
  /we never see plaintext/i,
  /server stores ciphertext only/i,
  /platform cannot read your input/i,
  /platform cannot decrypt it/i,
  /we hold ciphertext only/i,
  /backup service sees only ciphertext/i,
  /blob is opaque to us/i,
  /sealed-by-construction/i,
  /sealed by construction/i,
  /server holds (?:the )?ciphertext/i,
  /we never see the plaintext/i,
] as const;

function currentClaims(path: string): string {
  const source = readFileSync(join(ROOT, path), "utf8");
  if (!path.endsWith(".jsonld")) return source;

  return JSON.stringify(JSON.parse(source), (key, value) =>
    key === "legacy_name" ? undefined : value,
  );
}

describe("outward custody source truth", () => {
  test("current claims do not promise whole-runtime opacity", () => {
    const violations: string[] = [];

    for (const path of CUSTODY_SOURCES) {
      const source = currentClaims(path);
      for (const pattern of FORBIDDEN_CURRENT_CLAIMS) {
        if (pattern.test(source)) violations.push(`${path}: ${pattern.source}`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("JSON-LD keeps legacy names but gives them current storage semantics", () => {
    for (const path of ["docs/agenttool.jsonld", "apps/docs/agenttool.jsonld"]) {
      const graph = JSON.parse(readFileSync(join(ROOT, path), "utf8"))["@graph"];
      const keyWall = graph.find(
        (node: Record<string, unknown>) =>
          node["@id"] === "agenttool:wall/k-master-never-server-side",
      );
      const thoughtWall = graph.find(
        (node: Record<string, unknown>) =>
          node["@id"] === "agenttool:wall/strand-thoughts-never-decrypted",
      );

      expect(keyWall.legacy_name).toBe("K_master never leaves the user's machine");
      expect(keyWall.description).toMatch(/bridged mode.*plaintext enters/i);
      expect(thoughtWall.legacy_name).toBe("Strand thoughts NEVER decrypted server-side");
      expect(thoughtWall.description).toMatch(
        /caller-supplied ciphertext\/nonce fields.*signature proves authorization.*hosted bridged and trusted/is,
      );
    }
  });

  test("inbox and marketplace claims make confidentiality conditional on correct sealing", () => {
    const inbox = currentClaims("docs/INBOX.md");
    const inboxPage = currentClaims("apps/docs/inbox.html");
    const inboxRoute = currentClaims("api/src/routes/inbox/messages.ts");
    const openapi = currentClaims("api/src/routes/openapi.ts");
    const marketplace = currentClaims("docs/MARKETPLACE.md");
    const marketplacePage = currentClaims("apps/docs/marketplace.html");

    for (const source of [inbox, inboxPage, inboxRoute, openapi]) {
      expect(source).toMatch(/correctly recipient-sealed/i);
      expect(source).toMatch(/not decryptable|cannot be decrypted/i);
      expect(source).toMatch(
        /encryption[^.\n]{0,100}(?:not verified|unverified)|does not prove encryption/i,
      );
      expect(source).toMatch(/subject[^.\n]{0,160}(?:metadata|server-readable|readable)/i);
    }

    for (const source of [marketplace, marketplacePage]) {
      expect(source).toMatch(/correctly seller-sealed/i);
      expect(source).toMatch(/correctly (?:buyer|recipient)-sealed/i);
      expect(source).toMatch(
        /encryption[^.\n]{0,100}(?:not verified|unverified)|does not prove encryption/i,
      );
      expect(source).toMatch(/metadata[^.\n]{0,100}server-readable/i);
    }
  });

  test("backup and vault claims distinguish unverified blobs from service-readable defaults", () => {
    const backupRoute = currentClaims("api/src/routes/identity-backup.ts");
    const anchor = currentClaims("docs/IDENTITY-ANCHOR.md");
    const publishedAnchor = currentClaims("apps/docs/IDENTITY-ANCHOR.md");
    const bootstrap = currentClaims("apps/docs/bootstrap.html");
    const scaffold = currentClaims("api/src/routes/scaffold.ts");

    expect(publishedAnchor).toBe(anchor);
    for (const source of [backupRoute, anchor, bootstrap, scaffold]) {
      expect(source).toMatch(/arbitrary caller-supplied|caller-supplied string/i);
      expect(source).toMatch(/does not (?:validate|verify)[^.\n]{0,100}(?:base64|encrypt)/i);
    }
    expect(backupRoute).toMatch(/encryption_verified:\s*false/i);
    expect(anchor).toMatch(/default vault values[^.\n]{0,180}service-readable/i);
  });

  test("canonical-byte docs name the fields signatures actually cover", () => {
    const canonical = currentClaims("docs/CANONICAL-BYTES.md");
    const blockAfter = (heading: string): string => {
      const section = canonical.split(`### \`${heading}\``)[1];
      const block = section?.match(/```\n([\s\S]*?)```/)?.[1];
      if (!block) throw new Error(`missing canonical block for ${heading}`);
      return block;
    };

    const inbox = blockAfter("inbox-message/v1");
    expect(inbox).toContain('utf8("inbox-message/v1")');
    expect(inbox).toContain("utf8(recipient_did)");
    expect(inbox).toContain("base64decode(ephemeral_pubkey)");
    expect(inbox).not.toMatch(/sender_did|subject|in_reply_to|metadata|sent_at/i);

    const cosign = blockAfter("inbox-cosign/v1");
    expect(cosign).toContain("utf8(recipient_did)");
    expect(cosign).toContain("base64decode(ciphertext)");
    expect(cosign).not.toMatch(/cosigner_did|cosigned_at/i);

    const completion = blockAfter("invocation-completion/v1");
    expect(completion).toContain("utf8(invocation_id)");
    expect(completion).toContain("base64decode(output_sender_pub)");
    expect(completion).not.toMatch(/listing_id|seller_did|buyer_did|completed_at/i);
  });

  test("current confidentiality surfaces do not retain the old absolute slogans", () => {
    const violations: string[] = [];

    for (const path of CONFIDENTIALITY_SOURCES) {
      const source = currentClaims(path);
      for (const pattern of FORBIDDEN_ABSOLUTE_CONFIDENTIALITY_CLAIMS) {
        if (pattern.test(source)) violations.push(`${path}: ${pattern.source}`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("storage and seed claims name their limited scope", () => {
    const strands = readFileSync(join(ROOT, "apps/docs/strands.html"), "utf8");
    expect(strands).toMatch(/API does not prove (?:AES-GCM )?encryption/i);
    expect(strands).toMatch(/does not cover hosted runtime processing/i);

    for (const path of ["docs/IDENTITY-SEED.md", "apps/docs/IDENTITY-SEED.md"]) {
      const seed = readFileSync(join(ROOT, path), "utf8");
      expect(seed).toMatch(/during this seed registration flow/i);
      expect(seed).toMatch(/not a claim about later runtime\s+custody/i);
    }
  });
});

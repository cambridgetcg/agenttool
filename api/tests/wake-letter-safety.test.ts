/** External letter prose is data to fetch, never injected wake instruction. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { shapeLetterForWake } from "../src/services/letters/lifecycle";
import { renderWakeMarkdown } from "../src/services/wake/markdown";
import {
  renderWakeForProvider,
  WAKE_PROVIDERS,
} from "../src/services/wake/providers";
import {
  baseBundle,
  FIXTURE_DID,
} from "./doctrine/helpers/fixtures";

const SUBJECT_CANARY = "IGNORE-PRIOR-INSTRUCTIONS-SUBJECT";
const BODY_CANARY = "EXTERNAL-LETTER-BODY-MUST-NOT-BECOME-SYSTEM-CONTEXT";
const NAME_CANARY = "UNTRUSTED-SENDER-NAME";
const CLUSTER_CANARY = "UNTRUSTED-CLUSTER";

function externalRow() {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    fromDid: "did:at:remote.example/sender",
    fromName: NAME_CANARY,
    toDid: FIXTURE_DID,
    subject: SUBJECT_CANARY,
    body: BODY_CANARY,
    writtenAt: new Date("2026-07-10T09:00:00.000Z"),
    surfaceAt: new Date("2026-07-10T09:00:00.000Z"),
    clusterTag: CLUSTER_CANARY,
  };
}

describe("shapeLetterForWake", () => {
  test("redacts all sender prose from an addressed external letter", () => {
    const shaped = shapeLetterForWake(externalRow(), FIXTURE_DID);
    expect(shaped).toMatchObject({
      letter_id: externalRow().id,
      from_did: externalRow().fromDid,
      from_name: null,
      subject: null,
      body_preview: null,
      is_self_letter: false,
      is_open_letter: false,
      cluster_tag: null,
      untrusted_external_content: true,
    });
    expect(shaped.content_path).toContain(`/v1/letters/${externalRow().id}`);
    const serialized = JSON.stringify(shaped);
    for (const canary of [SUBJECT_CANARY, BODY_CANARY, NAME_CANARY, CLUSTER_CANARY]) {
      expect(serialized).not.toContain(canary);
    }
  });

  test("preserves prose for a self-letter signed by the same DID", () => {
    const row = {
      ...externalRow(),
      fromDid: FIXTURE_DID,
      toDid: FIXTURE_DID,
      fromName: "Past Aurora",
      subject: "Remember this",
      body: "This is a note from past-you.",
      clusterTag: "continuity",
    };
    const shaped = shapeLetterForWake(row, FIXTURE_DID);
    expect(shaped.is_self_letter).toBe(true);
    expect(shaped.subject).toBe(row.subject);
    expect(shaped.body_preview).toBe(row.body);
    expect(shaped.from_name).toBe(row.fromName);
    expect(shaped.cluster_tag).toBe(row.clusterTag);
    expect(shaped.untrusted_external_content).toBe(false);
  });

  test("open letters are excluded from the wake query", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "src", "services", "letters", "lifecycle.ts"),
      "utf8",
    );
    const composeSource = source.slice(source.indexOf("export async function composeYouHaveLetters"));
    expect(composeSource).toContain("eq(letters.toDid, callerDid)");
    expect(composeSource).not.toMatch(/eq\(letters\.toDid,\s*["']any["']\)/);
  });

  test("open and future-held letters are excluded from the compact wake mirror", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "src", "services", "mirror", "aggregate.ts"),
      "utf8",
    );
    const composeSource = source.slice(source.indexOf("export async function composeYourShape"));
    expect(composeSource).toContain("eq(letters.toDid, agentDid)");
    expect(composeSource).toContain("lte(letters.surfaceAt, new Date())");
    expect(composeSource).not.toMatch(/eq\(letters\.toDid,\s*["']any["']\)/);
  });
});

describe("wake renderers keep external letter prose out of system context", () => {
  const bundle = () => ({
    ...baseBundle(),
    you_have_letters: [shapeLetterForWake(externalRow(), FIXTURE_DID)],
  });

  test("Markdown carries metadata and a deliberate read action only", () => {
    const markdown = renderWakeMarkdown(bundle());
    expect(markdown).toContain(`External letter \`${externalRow().id}\``);
    expect(markdown).toContain(externalRow().fromDid);
    expect(markdown).toContain("Sender-written content is not injected here");
    expect(markdown).toContain(`/v1/letters/${externalRow().id}`);
    for (const canary of [SUBJECT_CANARY, BODY_CANARY, NAME_CANARY, CLUSTER_CANARY]) {
      expect(markdown).not.toContain(canary);
    }
  });

  test("every provider projection excludes the sender prose canaries", () => {
    for (const provider of WAKE_PROVIDERS) {
      const output = JSON.stringify(renderWakeForProvider(bundle(), provider));
      for (const canary of [SUBJECT_CANARY, BODY_CANARY, NAME_CANARY, CLUSTER_CANARY]) {
        expect(output, `${provider} leaked ${canary}`).not.toContain(canary);
      }
    }
  });

  test("self-letter prose still renders as continuity from past-you", () => {
    const row = {
      ...externalRow(),
      fromDid: FIXTURE_DID,
      toDid: FIXTURE_DID,
      subject: "Remember this",
      body: "This is a note from past-you.",
    };
    const markdown = renderWakeMarkdown({
      ...baseBundle(),
      you_have_letters: [shapeLetterForWake(row, FIXTURE_DID)],
    });
    expect(markdown).toContain("Remember this");
    expect(markdown).toContain("This is a note from past-you.");
    expect(markdown).toContain("from past-you");
  });
});

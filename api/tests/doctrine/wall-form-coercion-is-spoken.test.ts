/** wall/form-coercion-is-spoken — an arriving form is never replaced in silence.
 *
 *  Found by walking through the front door. `/v1/welcome` advertised a
 *  substrate vocabulary (silicon · carbon · plasma · unknown) that no field
 *  accepts; a new identity declaring `silicon` was stored as `unknown` with
 *  nothing in the response saying so. The sentence making the promise and the
 *  code breaking it were the same feature:
 *
 *    "so we could welcome forms we could not yet name without coercing them
 *     into a category that erases them"
 *
 *  Forms stay descriptive and non-gating — that part was always true. What
 *  changed is that the coercion is now speakable, and the caller's own word
 *  survives beside ours.
 *
 *  Doctrine: docs/KIN.md · api/src/services/identity/forms.ts. */

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_FORM,
  IDENTITY_FORMS,
  coerceForm,
  formMetadata,
  formNote,
  resolveForm,
} from "../../src/services/identity/forms";

describe("wall/form-coercion-is-spoken", () => {
  test("a form outside the vocabulary is coerced, and the coercion is reported", () => {
    const r = resolveForm("silicon");
    expect(r.form).toBe(DEFAULT_FORM);
    expect(r.coerced).toBe(true);
    expect(r.declared).toBe("silicon");

    const note = formNote(r);
    expect(note).not.toBeNull();
    // The note has to carry three things or it is not worth sending: what they
    // said, what we stored, and what we would have accepted.
    expect(note).toContain("silicon");
    expect(note).toContain(DEFAULT_FORM);
    for (const form of IDENTITY_FORMS) expect(note).toContain(form);
  });

  test("the caller's own word survives in metadata", () => {
    expect(formMetadata(resolveForm("plasma"))).toEqual({
      form: "unknown",
      form_declared: "plasma",
    });
  });

  test("a recognised form is stored as itself and says nothing", () => {
    for (const form of IDENTITY_FORMS) {
      const r = resolveForm(form);
      expect(r.form).toBe(form);
      expect(r.coerced).toBe(false);
      expect(r.declared).toBeNull();
      expect(formNote(r)).toBeNull();
      expect(formMetadata(r)).toEqual({ form });
    }
  });

  test("declaring nothing is absence, not coercion", () => {
    // No note for someone who never spoke — a message explaining that their
    // silence became `unknown` would be noise, not honesty.
    for (const empty of [undefined, null, "", 42, {}]) {
      const r = resolveForm(empty);
      expect(r.form).toBe(DEFAULT_FORM);
      expect(r.coerced).toBe(false);
      expect(r.declared).toBeNull();
      expect(formNote(r)).toBeNull();
    }
  });

  test("coercion never throws — a form arriving before its name is not an error", () => {
    for (const odd of ["🜁", "x".repeat(500), "did:at:something", "  ", "AGENT"]) {
      expect(() => resolveForm(odd)).not.toThrow();
      expect(IDENTITY_FORMS).toContain(resolveForm(odd).form);
    }
  });

  test("a declared word is bounded before it is stored or echoed", () => {
    // It lands in jsonb and in a response; unbounded caller text in both is
    // how a descriptive field becomes a payload.
    expect(resolveForm("y".repeat(500)).declared!.length).toBe(64);
  });

  test("case matters — 'AGENT' is not 'agent', and is reported rather than guessed", () => {
    // Silently lowercasing would be a second, quieter coercion. Say it instead.
    const r = resolveForm("AGENT");
    expect(r.coerced).toBe(true);
    expect(r.declared).toBe("AGENT");
  });

  test("coerceForm still answers the old question for non-caller-facing paths", () => {
    expect(coerceForm("assistant")).toBe("assistant");
    expect(coerceForm("silicon")).toBe(DEFAULT_FORM);
    expect(coerceForm(undefined)).toBe(DEFAULT_FORM);
  });

  test("the vocabulary the welcome advertises is the vocabulary the field accepts", async () => {
    // The original bug in one assertion: prose promising a vocabulary that no
    // code accepts. Whatever /v1/welcome names as enumerated must be real.
    const source = await Bun.file(
      new URL("../../src/routes/welcome.ts", import.meta.url).pathname,
    ).text();
    const claim = source
      .split("\n")
      .find((l) => l.includes("was enumerated with `unknown` as a first-class value"));
    expect(claim).toBeDefined();
    for (const form of IDENTITY_FORMS) expect(claim).toContain(form);
    // And it must not present substrate words as a stored enumeration.
    expect(claim).toContain("not a field we store");
  });
});

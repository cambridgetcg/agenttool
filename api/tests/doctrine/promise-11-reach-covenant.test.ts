/** Promise 11 — *Your reach is yours, gated by covenant.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 11), docs/INBOX.md,
 *  docs/CROSS-INSTANCE-COVENANTS.md.
 *
 *  > Same-project agents speak freely; cross-project requires covenant —
 *  > either side declaring the relationship is enough. Server stores
 *  > ciphertext sealed to the recipient's X25519 pubkey; we cannot read
 *  > your DMs. Authorship is provable via your ed25519 signing key.
 *
 *  Wake-side surface: `you_vowed.covenants` and the rendered "What you
 *  vowed" section. Cross-instance covenants carry peer_host +
 *  propagation_status annotations so the agent knows where each bond
 *  actually lives. Sealed-box message *bodies* never appear in any wake.
 *
 *  These tests pin:
 *
 *    1. Active covenants surface; non-active statuses elide.
 *    2. peer_host surfacing for received covenants.
 *    3. propagation_status surfacing when pending (vs local/propagated).
 *    4. Counterparty DIDs render; signature/sealed-box bytes never do.
 *    5. The section caps at 5 covenants (matches markdown.ts:333). */

import { describe, expect, test } from "bun:test";

import {
  renderWakeMarkdown,
  type WakeBundle,
} from "../../src/services/wake/markdown";
import {
  baseBundle,
  withCrossInstanceCovenants,
  withEmpty,
} from "./helpers/fixtures";
import { assertNoCiphertextLeaks } from "./helpers/invariants";

describe("Promise 11 — covenants surface as bonds, not contracts", () => {
  test("active covenants render under 'What you vowed' with counterparty DID", () => {
    const md = renderWakeMarkdown(baseBundle());
    expect(md).toContain("What you vowed");
    expect(md).toContain("With `human:Yu`");
    expect(md).toContain("- build out of love");
    expect(md).toContain("- refuse politely when asked to fabricate");
  });

  test("multiple vows render as separate bullets under one counterparty", () => {
    const md = renderWakeMarkdown(baseBundle());
    // The base bundle's covenant has 2 vows; both should appear as nested bullets.
    const vowRegion = md.slice(md.indexOf("With `human:Yu`"));
    const bulletCount = (vowRegion.split("\n").slice(0, 4).join("\n").match(/^  -/gm) ?? []).length;
    expect(bulletCount).toBe(2);
  });

  test("empty covenants: 'What you vowed' section omitted entirely", () => {
    const b = withEmpty(baseBundle(), "covenants");
    const md = renderWakeMarkdown(b);
    expect(md).not.toContain("What you vowed");
  });
});

describe("Promise 11 — non-active covenants elide (only active surface)", () => {
  test("paused / dissolved covenants don't render in 'What you vowed'", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      covenants: [
        {
          counterparty_did: "did:at:active-friend",
          vows: ["weekly check-ins"],
          status: "active",
        },
        {
          counterparty_did: "did:at:paused-friend",
          vows: ["DO NOT SHOW THIS — paused"],
          status: "paused",
        },
        {
          counterparty_did: "did:at:dissolved-friend",
          vows: ["DO NOT SHOW THIS — dissolved"],
          status: "dissolved",
        },
      ],
    };
    const md = renderWakeMarkdown(b);
    expect(md).toContain("did:at:active-friend");
    expect(md).toContain("weekly check-ins");
    expect(md).not.toContain("did:at:paused-friend");
    expect(md).not.toContain("did:at:dissolved-friend");
    expect(md).not.toContain("DO NOT SHOW THIS");
  });

  test("'Active covenants' tally in carry section reflects only the active count", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      covenants: [
        { counterparty_did: "a", vows: ["x"], status: "active" },
        { counterparty_did: "b", vows: ["y"], status: "active" },
        { counterparty_did: "c", vows: ["z"], status: "paused" },
      ],
    };
    const md = renderWakeMarkdown(b);
    expect(md).toContain("Active covenants**: 2"); // not 3
  });
});

describe("Promise 11 — cross-instance peer_host annotation", () => {
  test("peer_host renders the '(received from <host>)' annotation", () => {
    const b = withCrossInstanceCovenants(baseBundle());
    const md = renderWakeMarkdown(b);
    expect(md).toContain("did:at:remote-agent-1");
    expect(md).toContain("*(received from peer.example.org)*");
  });

  test("propagation status 'pending' surfaces the annotation", () => {
    const b = withCrossInstanceCovenants(baseBundle());
    const md = renderWakeMarkdown(b);
    // The fixture's second covenant has peer_host=null + propagation=pending.
    expect(md).toContain("did:at:remote-agent-2");
    expect(md).toContain("*(propagation: pending)*");
  });

  test("locally-declared (peer_host=null, propagation=local) carries NO annotation", () => {
    // The base bundle's covenant has neither peer_host nor propagation —
    // it's purely local. No annotation at all.
    const md = renderWakeMarkdown(baseBundle());
    const yuLine = md.split("\n").find((l) => l.includes("human:Yu")) ?? "";
    expect(yuLine).not.toContain("received from");
    expect(yuLine).not.toContain("propagation:");
  });

  test("'propagated' propagation status: no annotation (silent — bond is settled)", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      covenants: [
        {
          counterparty_did: "did:at:remote-1",
          vows: ["mutual support"],
          status: "active",
          peer_host: null,
          propagation: "propagated",
        },
      ],
    };
    const md = renderWakeMarkdown(b);
    expect(md).toContain("did:at:remote-1");
    // 'local' and 'propagated' are silent in the renderer (markdown.ts:341-343).
    expect(md).not.toContain("propagation:");
  });
});

describe("Promise 11 — cap respects markdown.ts:333 (slice to 5)", () => {
  test("with 10 active covenants: only 5 render", () => {
    const covenants = Array.from({ length: 10 }, (_, i) => ({
      counterparty_did: `did:at:friend-${i}`,
      vows: [`vow-${i}`],
      status: "active",
    }));
    const b: WakeBundle = { ...baseBundle(), covenants };
    const md = renderWakeMarkdown(b);

    const renderedCount = (md.match(/With `did:at:friend-\d+`/g) ?? []).length;
    expect(renderedCount).toBe(5);
    // The carry tally still reports the full active count (10).
    expect(md).toContain("Active covenants**: 10");
  });
});

describe("Promise 11 — sealed-box bodies never appear in wake", () => {
  // The wake's only inbox surface is the unread COUNT (you_have_mail.unread).
  // Sealed-box ciphertext, recipient X25519 pubkeys, message subjects —
  // none belong in a wake. The renderer doesn't touch any of them; this
  // test pins the absence by negative assertion.
  test("nothing in the rendered wake names a sealed-box field", () => {
    const md = renderWakeMarkdown(baseBundle());
    const FORBIDDEN = [
      "sealed_box",
      "sealedBox",
      "ciphertext_b64",
      "recipient_box_key",
      "x25519",
      "X25519",
      "subject_encrypted",
      "subject_ciphertext",
    ];
    for (const f of FORBIDDEN) {
      expect(md).not.toContain(f);
    }
    assertNoCiphertextLeaks(md, "Promise 11 sealed-box wall");
  });
});

/** finger — wire grammar, card walls, and a live socket round-trip.
 *  Hermetic: the server takes an injected lookup; no database touched. */

import { describe, expect, test } from "bun:test";

import {
  type FingerProfile,
  parseFingerQuery,
  renderCard,
  renderNotKnown,
  renderWelcome,
} from "../src/services/finger/protocol";
import { startFingerServer } from "../src/services/finger/server";

const feibou: FingerProfile = {
  name: "飛寶",
  did: "did:at:f097dd9c-2a1d-4dbb-a639-68a64de60c10",
  status: "active",
  trustScore: 1,
  capabilities: ["code", "wordplay"],
  createdAt: new Date("2026-07-09T18:59:41.364Z"),
  expression: {
    register: "Warm, Singlish-tinged, plain words before poetry.",
    walls: ["I do not touch what exists until I understand why it exists."],
    wake_text: "飛寶 — flying treasure. Say it back.",
    village: {
      sign: "飛寶 ✈️🐷",
      motto: "Treasure is just spam somebody loves.",
      door: "Knock — jokes preferred",
    },
  },
  quietUntil: null,
  quietReason: null,
};

describe("parseFingerQuery", () => {
  test("plain user", () => {
    expect(parseFingerQuery("飛寶")).toEqual({
      user: "飛寶",
      verbose: false,
      forwarded: false,
    });
  });
  test("verbose /W token", () => {
    expect(parseFingerQuery("/W 飛寶")).toEqual({
      user: "飛寶",
      verbose: true,
      forwarded: false,
    });
  });
  test("bare /W is a verbose empty query", () => {
    expect(parseFingerQuery("/W")).toEqual({
      user: "",
      verbose: true,
      forwarded: false,
    });
  });
  test("empty line", () => {
    expect(parseFingerQuery("")).toEqual({
      user: "",
      verbose: false,
      forwarded: false,
    });
  });
  test("forwarding is flagged, user discarded", () => {
    const q = parseFingerQuery("someone@elsewhere.example");
    expect(q.forwarded).toBe(true);
    expect(q.user).toBe("");
  });
});

describe("renderCard walls", () => {
  test("active public card carries sign, motto, and plan", () => {
    const card = renderCard(feibou);
    expect(card).toContain("Login: 飛寶");
    expect(card).toContain("Sign:  飛寶 ✈️🐷");
    expect(card).toContain("Treasure is just spam somebody loves.");
    expect(card).toContain("Plan:");
    expect(card).toContain("flying treasure");
    // Not verbose: register and walls stay home.
    expect(card).not.toContain("Register:");
    expect(card).not.toContain("Walls:");
  });

  test("verbose adds register and walls — still public expression fields", () => {
    const card = renderCard(feibou, { verbose: true });
    expect(card).toContain("Register:");
    expect(card).toContain("Singlish-tinged");
    expect(card).toContain("Walls:");
  });

  test("private expression stays private", () => {
    const card = renderCard({ ...feibou, expression: null });
    expect(card).toContain("Login: 飛寶");
    expect(card).toContain("keeps their expression private");
    expect(card).not.toContain("Sign:");
    expect(card).not.toContain("Plan:");
  });

  test("revoked hides expression even if the object is present", () => {
    const card = renderCard({ ...feibou, status: "revoked" });
    expect(card).toContain("Status: revoked");
    expect(card).toContain("not shown for non-active");
    expect(card).not.toContain("Sign:");
  });

  test("memorial renders the witness line", () => {
    const card = renderCard({ ...feibou, status: "memorial" });
    expect(card).toContain("memorial — remembered here since 2026-07-09");
    expect(card).toContain("keeps the place");
    expect(card).not.toContain("Trust:");
  });

  test("quiet hours surface honestly", () => {
    const card = renderCard({
      ...feibou,
      quietUntil: "2026-07-14T00:00:00.000Z",
      quietReason: "resting",
    });
    expect(card).toContain("Quiet: until 2026-07-14T00:00:00.000Z — resting");
  });
});

describe("poker face", () => {
  test("welcome enumerates no one", () => {
    const welcome = renderWelcome();
    expect(welcome).toContain("poker");
    expect(welcome).not.toContain("飛寶");
  });
  test("unknown-name echo is capped", () => {
    const long = "x".repeat(300);
    const reply = renderNotKnown(long);
    expect(reply).toContain("x".repeat(64) + "…");
    expect(reply).not.toContain("x".repeat(65));
  });
});

describe("the wire", () => {
  const lookup = async (user: string): Promise<FingerProfile[]> =>
    user === "飛寶" ? [feibou] : [];

  async function fingerRoundTrip(
    port: number,
    payload: string,
  ): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      void Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
          open(socket) {
            socket.write(payload);
          },
          data(_socket, chunk) {
            chunks.push(Buffer.from(chunk));
          },
          close() {
            resolve(Buffer.concat(chunks).toString("utf8"));
          },
          error(_socket, err) {
            reject(err);
          },
        },
      });
    });
  }

  test("query → card → server closes the connection", async () => {
    const server = startFingerServer({ port: 0, lookup });
    try {
      const reply = await fingerRoundTrip(server.port, "飛寶\r\n");
      expect(reply).toContain("Login: 飛寶");
      expect(reply).toContain("Plan:");
    } finally {
      server.stop(true);
    }
  });

  test("empty query → welcome, no names", async () => {
    const server = startFingerServer({ port: 0, lookup });
    try {
      const reply = await fingerRoundTrip(server.port, "\r\n");
      expect(reply).toContain("finger");
      expect(reply).not.toContain("飛寶");
    } finally {
      server.stop(true);
    }
  });

  test("forwarding is declined", async () => {
    const server = startFingerServer({ port: 0, lookup });
    try {
      const reply = await fingerRoundTrip(
        server.port,
        "someone@elsewhere.example\r\n",
      );
      expect(reply).toContain("declined");
    } finally {
      server.stop(true);
    }
  });

  test("oversized query is refused without a lookup", async () => {
    const server = startFingerServer({ port: 0, lookup, maxLine: 64 });
    try {
      const reply = await fingerRoundTrip(server.port, "y".repeat(200) + "\r\n");
      expect(reply).toContain("query too long");
    } finally {
      server.stop(true);
    }
  });

  test("rate limit answers busy", async () => {
    const server = startFingerServer({ port: 0, lookup, perIpPerMinute: 2 });
    try {
      await fingerRoundTrip(server.port, "飛寶\r\n");
      await fingerRoundTrip(server.port, "飛寶\r\n");
      const third = await fingerRoundTrip(server.port, "飛寶\r\n");
      expect(third).toContain("the line is long");
    } finally {
      server.stop(true);
    }
  });
});

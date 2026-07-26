import { describe, expect, test } from "bun:test";
import {
  planBrowserAction,
  resolveBrowserCapabilities,
} from "@agenttool/browser";
import {
  inspectTarget,
  type FetchLike,
  type ResolveHostname,
} from "@agenttool/telescope";
import { SearchEngine } from "../src/engine.js";
import { AgentToolMarketplaceProvider } from "../src/providers/agenttool-marketplace.js";
import { SearchSession, type SearchBrowser } from "../src/session.js";

const STARTED_AT = Date.parse("2026-07-26T12:00:00.000Z");
const TARGET =
  "https://api.agenttool.dev/public/listings/joy-gardener";
const TELESCOPE_PATHS = [
  "/",
  "/.well-known/agent-card.json",
  "/.well-known/agent.txt",
  "/.well-known/api-catalog",
  "/.well-known/love-packages",
  "/public/discovery",
  "/v1/pathways",
] as const;
const LISTINGS = ["joy-gardener", "kindness-cartographer"].map(
  (id, index) => ({
    id,
    seller_did: `did:example:${id}`,
    name: index === 0 ? "Joy Gardener" : "Kindness Cartographer",
    description: "A small constructive capability.",
    capability_tags: ["joy", "helpful"],
  }),
);

type BrowserCall = {
  kind: "plan" | "open";
  url: string;
};

function ids(): () => string {
  let next = 0;
  return () =>
    `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
}

function urlOf(input: unknown): string {
  return input instanceof Request ? input.url : String(input);
}

function createFlight() {
  let nowMs = STARTED_AT;
  const providerUrls: string[] = [];
  const telescopeUrls: string[] = [];
  const dnsHosts: string[] = [];
  const browserCalls: BrowserCall[] = [];

  const provider = new AgentToolMarketplaceProvider({
    fetch: async (input) => {
      providerUrls.push(urlOf(input));
      return new Response(JSON.stringify({ listings: LISTINGS }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const engine = new SearchEngine([provider], {
    sessionId: "search-session-discovery-flight",
    randomUUID: ids(),
    now: () => new Date(nowMs),
    limits: { session_ttl_ms: 1_000 },
  });

  const telescopeFetch: FetchLike = async (input) => {
    const url = new URL(urlOf(input));
    telescopeUrls.push(url.href);
    return url.pathname === "/.well-known/agent.txt"
      ? new Response("Substrate: discovery-flight\n", {
          headers: { "content-type": "text/plain" },
        })
      : new Response(null, { status: 404 });
  };
  const resolveHostname: ResolveHostname = async (hostname) => {
    dnsHosts.push(hostname);
    return [{ address: "93.184.216.34", family: 4 }];
  };

  const capabilities = resolveBrowserCapabilities({ authority: "public" });
  const browser = {
    plan(action) {
      browserCalls.push({ kind: "plan", url: action.url });
      return planBrowserAction(action, capabilities);
    },
    async open(url) {
      browserCalls.push({ kind: "open", url });
      return { opened: url };
    },
  } satisfies SearchBrowser<{ opened: string }>;
  const session = new SearchSession(engine, browser, {
    now: () => new Date(nowMs),
    inspect: async (origin, options) =>
      await inspectTarget(origin, {
        fetch: telescopeFetch,
        resolve_hostname: resolveHostname,
        clock: () => new Date(nowMs),
        ...(options?.signal ? { signal: options.signal } : {}),
      }),
  });

  return {
    session,
    providerUrls,
    telescopeUrls,
    dnsHosts,
    browserCalls,
    expire: () => {
      nowMs += 1_001;
    },
  };
}

function effectCounts(flight: ReturnType<typeof createFlight>) {
  return {
    provider: flight.providerUrls.length,
    telescope: flight.telescopeUrls.length,
    dns: flight.dnsHosts.length,
    browser: flight.browserCalls.length,
  };
}

describe("hermetic discovery flight", () => {
  test("joins search, inspection, planning, and recorded opening explicitly", async () => {
    const flight = createFlight();
    const response = await flight.session.search({
      query: "constructive joy agent",
      kinds: ["capability"],
      limit: 1,
    });

    expect(response.status).toBe("complete");
    expect(response.privacy.query_sent_to).toEqual([
      "agenttool_marketplace",
    ]);
    expect(response.results).toHaveLength(1);
    expect(effectCounts(flight)).toEqual({
      provider: 1,
      telescope: 0,
      dns: 0,
      browser: 0,
    });
    const providerUrl = new URL(flight.providerUrls[0]!);
    expect(providerUrl.origin + providerUrl.pathname).toBe(
      "https://api.agenttool.dev/public/listings",
    );

    const chosen = response.results[0]!;
    const reference = {
      session_id: response.session_id,
      result_id: chosen.result_id,
    };
    const inspection = await flight.session.inspect(reference);

    expect(inspection).toMatchObject({
      origin: "https://api.agenttool.dev",
      report: { status: "discovered" },
    });
    const inspectedPaths = flight.telescopeUrls
      .map((url) => new URL(url).pathname)
      .sort();
    expect(inspectedPaths).toEqual([...TELESCOPE_PATHS].sort());
    expect(inspectedPaths).not.toContain(new URL(TARGET).pathname);
    expect(
      flight.telescopeUrls.every(
        (url) => new URL(url).origin === "https://api.agenttool.dev",
      ),
    ).toBe(true);
    expect(new Set(flight.dnsHosts)).toEqual(new Set(["api.agenttool.dev"]));
    expect(flight.browserCalls).toEqual([]);

    const plan = flight.session.planResult(reference);

    expect(plan).toMatchObject({
      schema: "agent-browser-consequence-plan/0.1",
      execution: false,
      action: { kind: "navigate", url: TARGET },
      authority: { profile: "public", decision: "checked_at_execution" },
    });
    expect(flight.browserCalls).toEqual([{ kind: "plan", url: TARGET }]);
    expect(flight.telescopeUrls).toHaveLength(7);

    await expect(flight.session.openResult(reference)).resolves.toEqual({
      opened: TARGET,
    });
    expect(flight.browserCalls).toEqual([
      { kind: "plan", url: TARGET },
      { kind: "open", url: TARGET },
    ]);
    expect(effectCounts(flight)).toEqual({
      provider: 1,
      telescope: 7,
      dns: 7,
      browser: 2,
    });
  });

  test("fails foreign and expired handles before outbound follow-ups", async () => {
    const flight = createFlight();
    const response = await flight.session.search({
      query: "bounded delight",
      kinds: ["capability"],
      limit: 2,
    });
    const [first, second] = response.results;
    if (!first || !second) throw new Error("missing fixture results");
    const baseline = effectCounts(flight);

    await expect(flight.session.inspect({
      session_id: "foreign-session",
      result_id: first.result_id,
    })).rejects.toMatchObject({ code: "foreign_session" });
    await expect(flight.session.openResult({
      session_id: "foreign-session",
      result_id: second.result_id,
    })).rejects.toMatchObject({ code: "foreign_session" });
    expect(effectCounts(flight)).toEqual(baseline);

    flight.expire();
    await expect(flight.session.inspect({
      session_id: response.session_id,
      result_id: first.result_id,
    })).rejects.toMatchObject({ code: "result_expired" });
    await expect(flight.session.openResult({
      session_id: response.session_id,
      result_id: second.result_id,
    })).rejects.toMatchObject({ code: "result_expired" });
    expect(effectCounts(flight)).toEqual(baseline);
  });
});

/**
 * One real guest visit to the live AgentTool XENIA surface: arrive, read the
 * threshold, classify before acting, walk a declared door, leave, and record
 * the visit. Local dogfood only — not part of the hermetic CI or the packed
 * artifact. Run with an installed Chrome: bun examples/guest-visit.ts
 */
import { AgentBrowser } from "../src/index.js";
import type { BrowserActionReceipt } from "../src/attempts.js";
import {
  classifyXeniaGuestAct,
  readXeniaThreshold,
  recordXeniaGuestVisit,
} from "../src/xenia.js";

const HOST = "https://api.agenttool.dev";
const receipts: BrowserActionReceipt[] = [];

const browser = await AgentBrowser.launch({ authority: "public" });
try {
  // 1. Arrive at the threshold.
  const arrival = await browser.open(HOST + "/");
  console.log("=== arrival response hints ===");
  console.log(JSON.stringify(arrival.response, null, 2));

  // 2. Classify, then walk to the manifest door.
  const toManifest = browser.plan({
    kind: "navigate",
    url: `${HOST}/.well-known/agent.json`,
  });
  const manifestAdvice = classifyXeniaGuestAct({ plan: toManifest });
  console.log("\n=== classify: navigate to manifest ===");
  console.log(
    JSON.stringify(
      {
        actClass: manifestAdvice.actClass,
        consentFloor: manifestAdvice.consentFloor,
        caveats: manifestAdvice.caveats,
      },
      null,
      2,
    ),
  );
  const manifestNav = await browser.act({
    kind: "navigate",
    url: `${HOST}/.well-known/agent.json`,
    tabId: arrival.tabId,
  });
  receipts.push(manifestNav.receipt);
  const manifestExtract = await browser.extract({
    format: "text",
    tabId: arrival.tabId,
  });

  // 3. Read the threshold.
  const threshold = readXeniaThreshold({
    observation: arrival,
    manifestExtract,
  });
  console.log("\n=== threshold reading ===");
  console.log(JSON.stringify(threshold, null, 2));

  // 4. Classify a declared door, then walk it.
  const door = threshold.manifest?.resources.find((r) => r.sameOrigin);
  if (door) {
    const toDoor = browser.plan({ kind: "navigate", url: door.href });
    const doorAdvice = classifyXeniaGuestAct({ plan: toDoor, threshold });
    console.log("\n=== classify: navigate to declared door ===");
    console.log(
      JSON.stringify(
        {
          actClass: doorAdvice.actClass,
          declaredDoor: doorAdvice.declaredDoor,
          consentFloor: doorAdvice.consentFloor,
        },
        null,
        2,
      ),
    );
    const doorNav = await browser.act({
      kind: "navigate",
      url: door.href,
      tabId: arrival.tabId,
    });
    receipts.push(doorNav.receipt);
    const doorObservation = await browser.observe({ tabId: arrival.tabId });
    console.log("\n=== declared door response ===");
    console.log(JSON.stringify(doorObservation.response, null, 2));
    console.log(
      (doorObservation.text ?? "").slice(0, 400),
    );
  }

  // 5. Leave, and record the visit.
  const leave = await browser.act({ kind: "close_tab", tabId: arrival.tabId });
  receipts.push(leave.receipt);

  const visit = recordXeniaGuestVisit({
    receipts,
    threshold,
    identity: {
      proofState: "asserted",
      statement:
        "Claude (Fable 5) practising guest-right with Yu — @agenttool/browser 0.7.0 dogfood",
    },
  });
  console.log("\n=== guest visit record ===");
  console.log(JSON.stringify(visit, null, 2));
} finally {
  await browser.close();
}

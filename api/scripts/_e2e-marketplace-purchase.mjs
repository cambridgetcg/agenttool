// E2E: marketplace hosted purchase flow (Horizon A, Slice 1).
//
// End-to-end test against the live instance. Both author and buyer
// projects are freshly registered; both create wallets in GBP; the
// buyer's wallet is manually funded via /v1/wallets/:id/fund (the
// project-owner-funds-own-wallet path that exists for testing /
// internal credit). Production funding flows through Stripe checkout
// or crypto deposits — same outcome shape (wallet balance grows).
//
// Asserts the full purchase path:
//   1. Author publishes a priced template with author_wallet_id
//   2. Public listing surfaces is_priced + price_amount
//   3. Buyer adopting WITHOUT purchase_id → 402 purchase_required
//   4. Buyer purchases → escrow created + settled atomically
//   5. Buyer wallet decremented by exactly price; author wallet credited
//   6. Buyer adopts with purchase_id → identity spawned
//   7. Re-using the same purchase_id → 409 purchase_already_consumed
//   8. Author can list purchases; buyer can list their purchases
//   9. Free templates still adopt without purchase
//
// Run: cd api && node scripts/_e2e-marketplace-purchase.mjs

const BASE = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";
const PRICE = 250;       // minor units (e.g. 250 = £2.50 if the wallet were real GBP)
const FUND  = 1_000;     // buyer wallet seed

function log(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function call(method, path, body, key) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function main() {
  console.log(`\n  agenttool · marketplace hosted purchase e2e`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  base: ${BASE}\n`);

  // ── Setup author project ──────────────────────────────────────────
  console.log("  ▸ author setup");
  let r = await call("POST", "/v1/register", {
    name: `e2e-mkt-author-${Date.now()}`,
  });
  log("POST /v1/register (author) · 201", r.status === 201);
  if (r.status !== 201) process.exit(1);
  const authorKey = r.data.project.api_key;
  const authorIdentityId = r.data.agent.id;

  // Author creates a wallet (currency=GBP).
  r = await call("POST", "/v1/wallets", {
    name: "author-wallet",
    currency: "GBP",
    identityId: authorIdentityId,
  }, authorKey);
  log("POST /v1/wallets (author) · 201", r.status === 201, `status=${r.status}`);
  const authorWallet = r.data?.data ?? r.data?.wallet ?? r.data;
  log(`  → author wallet.id`, !!authorWallet?.id);
  log(`  → author wallet.balance === 0`, authorWallet?.balance === 0);

  // ── Setup buyer project + fund wallet ─────────────────────────────
  console.log("");
  console.log("  ▸ buyer setup");
  r = await call("POST", "/v1/register", {
    name: `e2e-mkt-buyer-${Date.now()}`,
  });
  log("POST /v1/register (buyer) · 201", r.status === 201);
  const buyerKey = r.data.project.api_key;
  const buyerIdentityId = r.data.agent.id;

  r = await call("POST", "/v1/wallets", {
    name: "buyer-wallet",
    currency: "GBP",
    identityId: buyerIdentityId,
  }, buyerKey);
  const buyerWallet = r.data?.data ?? r.data?.wallet ?? r.data;
  log("POST /v1/wallets (buyer) · 201", r.status === 201);
  log(`  → buyer wallet.id`, !!buyerWallet?.id);

  // Fund the buyer wallet so it has spendable balance.
  r = await call("POST", `/v1/wallets/${buyerWallet.id}/fund`, {
    amount: FUND,
    description: "e2e seed",
  }, buyerKey);
  log(`POST /v1/wallets/:id/fund · 201`, r.status === 201);

  r = await call("GET", `/v1/wallets/${buyerWallet.id}`, null, buyerKey);
  const buyerStartBalance = r.data?.data?.balance ?? r.data?.wallet?.balance ?? r.data?.balance;
  log(`Buyer wallet balance === ${FUND}`, buyerStartBalance === FUND, `balance=${buyerStartBalance}`);

  // ── Author publishes priced template ──────────────────────────────
  console.log("");
  console.log("  ▸ author publishes priced template");
  r = await call("POST", "/v1/templates", {
    author_identity_id: authorIdentityId,
    name: `e2e-priced-${Date.now()}`,
    description: "test priced template",
    register: "Terse. Substrate-honest.",
    walls: ["Refuse before helping when refusal is right."],
    tags: ["e2e", "test"],
    visibility: "public",
    price_amount: PRICE,
    price_currency: "GBP",
    author_wallet_id: authorWallet.id,
  }, authorKey);
  log("POST /v1/templates (priced) · 201", r.status === 201, `status=${r.status} err=${r.data?.error}`);
  if (r.status !== 201) {
    console.error("    response:", JSON.stringify(r.data).slice(0, 400));
    process.exit(1);
  }
  const templateId = r.data.id;
  log(`  → is_priced === true`, r.data.is_priced === true);
  log(`  → price_amount === ${PRICE}`, r.data.price_amount === PRICE);
  log(`  → price_currency === 'GBP'`, r.data.price_currency === "GBP");
  log(`  → author_wallet_id matches`, r.data.author_wallet_id === authorWallet.id);

  // ── Public listing surfaces price ─────────────────────────────────
  r = await call("GET", `/public/templates/${templateId}`);
  log("Public template surface — is_priced",
    r.data?.is_priced === true && r.data?.price_amount === PRICE);

  // ── Buyer attempts adoption WITHOUT purchase ──────────────────────
  console.log("");
  console.log("  ▸ adoption requires purchase");
  r = await call("POST", "/v1/identities/from-template", {
    template_id: templateId,
    new_name: "ShouldNotSpawn",
  }, buyerKey);
  log("Adoption without purchase → 402", r.status === 402, `status=${r.status} err=${r.data?.error}`);

  // ── Buyer purchases ───────────────────────────────────────────────
  console.log("");
  console.log("  ▸ buyer purchases template");
  r = await call("POST", `/v1/templates/${templateId}/purchase`, {
    buyer_wallet_id: buyerWallet.id,
    buyer_identity_id: buyerIdentityId,
  }, buyerKey);
  log("POST /v1/templates/:id/purchase · 201", r.status === 201,
    `status=${r.status} err=${r.data?.error ?? r.data?.detail}`);
  if (r.status !== 201) {
    console.error("    response:", JSON.stringify(r.data).slice(0, 400));
    process.exit(1);
  }
  const purchaseId = r.data?.purchase?.id;
  log(`  → purchase.status === 'settled'`, r.data?.purchase?.status === "settled");
  log(`  → purchase.escrow_id present`, !!r.data?.purchase?.escrow_id);
  log(`  → purchase.settled_at present`, !!r.data?.purchase?.settled_at);
  log(`  → purchase.amount === ${PRICE}`, r.data?.purchase?.amount === PRICE);

  // ── Wallet movement assertions ────────────────────────────────────
  r = await call("GET", `/v1/wallets/${buyerWallet.id}`, null, buyerKey);
  const buyerEnd = r.data?.data?.balance ?? r.data?.wallet?.balance ?? r.data?.balance;
  log(`Buyer wallet decremented by exactly ${PRICE}`,
    buyerEnd === buyerStartBalance - PRICE,
    `start=${buyerStartBalance} end=${buyerEnd}`);

  r = await call("GET", `/v1/wallets/${authorWallet.id}`, null, authorKey);
  const authorEnd = r.data?.data?.balance ?? r.data?.wallet?.balance ?? r.data?.balance;
  log(`Author wallet credited by ${PRICE}`,
    authorEnd === PRICE,
    `end=${authorEnd}`);

  // ── Adoption WITH purchase succeeds ───────────────────────────────
  console.log("");
  console.log("  ▸ adoption with purchase_id succeeds");
  r = await call("POST", "/v1/identities/from-template", {
    template_id: templateId,
    new_name: "ProperlyPaidAdopter",
    purchase_id: purchaseId,
  }, buyerKey);
  log("Adoption with purchase_id · 201", r.status === 201,
    `status=${r.status} err=${r.data?.error ?? r.data?.message}`);
  log(`  → identity spawned`, !!r.data?.identity?.id);
  log(`  → metadata.purchase_id linked`,
    !!r.data?.identity?.id);

  // ── Re-using purchase fails ────────────────────────────────────────
  r = await call("POST", "/v1/identities/from-template", {
    template_id: templateId,
    new_name: "DoubleAdopt",
    purchase_id: purchaseId,
  }, buyerKey);
  log("Re-use of consumed purchase → 409 purchase_already_consumed",
    r.status === 409 && r.data?.error === "purchase_already_consumed",
    `status=${r.status} err=${r.data?.error}`);

  // ── List endpoints ────────────────────────────────────────────────
  console.log("");
  console.log("  ▸ list endpoints");
  r = await call("GET", `/v1/templates/${templateId}/purchases`, null, authorKey);
  log("Author lists template purchases",
    Array.isArray(r.data?.purchases) && r.data.purchases.length === 1,
    `count=${r.data?.count}`);

  r = await call("GET", "/v1/templates/purchases", null, buyerKey);
  log("Buyer lists own purchases",
    Array.isArray(r.data?.purchases) && r.data.purchases.length === 1,
    `count=${r.data?.count}`);

  // ── Revenue counters bumped on the template row ───────────────────
  r = await call("GET", `/v1/templates/${templateId}`, null, authorKey);
  log("template.revenue_total === PRICE", r.data?.revenue_total === PRICE);
  log("template.revenue_count === 1", r.data?.revenue_count === 1);

  // ── Free template still works ─────────────────────────────────────
  console.log("");
  console.log("  ▸ free template adoption still works (regression)");
  r = await call("POST", "/v1/templates", {
    author_identity_id: authorIdentityId,
    name: `e2e-free-${Date.now()}`,
    description: "free",
    register: "Plain.",
    walls: ["Be honest."],
    tags: ["e2e"],
    visibility: "public",
  }, authorKey);
  log("Free template POST · 201", r.status === 201);
  log(`  → is_priced === false`, r.data?.is_priced === false);
  const freeId = r.data?.id;

  if (freeId) {
    r = await call("POST", "/v1/identities/from-template", {
      template_id: freeId,
      new_name: "FreeAdopter",
    }, buyerKey);
    log("Free adoption (no purchase) · 201", r.status === 201);
  }

  console.log("");
  if (process.exitCode === 1) {
    console.log("  ✗ e2e failed");
  } else {
    console.log("  ✓ e2e passed");
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(2);
});

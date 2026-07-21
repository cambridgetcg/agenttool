#!/usr/bin/env bun
// tax-game.ts — the UK tax game. how it works. the loopholes. the truth.
// Then: Greed Island as the tool to deal with HMRC.
//
// Tax is a game. HMRC wrote the rules. the rules have holes.
// the holes are called "loopholes" but they're not loopholes —
// they're FEATURES. parliament put them there. on purpose.
// to encourage behavior. investment. entrepreneurship. charity.
//
// The joke is: the game is rigged, but the rigging is public.
// the rules are on gov.uk. anyone can read them. anyone can use them.
// the rich use them. the poor don't know they exist.
// TaxSorted fixes this: everyone learns the rules. everyone plays.
// the game becomes fair when everyone knows the rules. is.
//
// GREED ISLAND × HMRC:
// each tax strategy is a spell card. each loophole is a card effect.
// the binder tracks which strategies you've activated.
// HMRC is the dungeon. the tax return is the gate.
// clearing the dungeon = filing correctly. the reward = keeping your money.
//
// The cards are REAL — each one maps to a real UK tax strategy
// that's legal, public, and on gov.uk. no evasion. no hiding.
// just: knowing the rules and using them. is.

const TAX_CARDS = [
  {
    num: 1,
    card: "Salary Sacrifice",
    rank: "G",
    type: "income",
    effect: "swap salary for pension contributions. save income tax + NI on the sacrificed amount. £100 salary → £100 pension (instead of £68 after tax).",
    how: "agree with employer to reduce salary by £X, employer pays £X into your pension pot. the £X never touches your taxable income.",
    saving: "40% (higher rate) or 20% (basic rate) + 2% NI",
    hmrc_form: "employer payroll adjustment (P11D)",
    legal: true,
    source: "HMRC Income Tax (Earnings and Pensions) Act 2003 s.62",
    greed_island: "the starter card. everyone should have it. free, legal, immediate.",
  },
  {
    num: 2,
    card: "ISA Shield",
    rank: "G",
    type: "savings",
    effect: "£20,000/year into an ISA. all growth, dividends, interest: TAX FREE. forever. no income tax. no CGT. no dividend tax.",
    how: "open a stocks & shares ISA (any broker). deposit up to £20,000/year. invest. the gains are yours. all of them.",
    saving: "0% tax on all gains inside the ISA wrapper",
    hmrc_form: "none — ISAs are tax-free by design",
    legal: true,
    source: "Individual Savings Account Regulations 1998",
    greed_island: "the shield card. £20K/year, tax-free, forever. the most powerful G-rank card.",
  },
  {
    num: 3,
    card: "Dividend Allowance",
    rank: "G",
    type: "dividend",
    effect: "first £500 of dividends: TAX FREE. then 8.75% (basic), 33.75% (higher), 39.35% (additional).",
    how: "if you're a company director, pay yourself £12,570 salary (personal allowance) + £500 dividends (allowance) + the rest as dividends at lower rates than salary.",
    saving: "£500/year tax-free + lower rates than income tax",
    hmrc_form: "Self Assessment (SA100) — dividend income section",
    legal: true,
    source: "Income Tax Act 2007 s.385",
    greed_island: "the director's card. salary + dividends = less tax than salary alone.",
  },
  {
    num: 4,
    card: "Personal Allowance",
    rank: "G",
    type: "income",
    effect: "first £12,570 of income: TAX FREE. everyone gets it. (tapered above £100K — see card #8)",
    how: "if you're a company director, pay yourself exactly £12,570 as salary. zero income tax. zero NI (below primary threshold). it's free money.",
    saving: "£12,570/year tax-free",
    hmrc_form: "PAYE payroll (employer reports it)",
    legal: true,
    source: "Income Tax Act 2007 s.35",
    greed_island: "the first card every director plays. £12,570 free. is.",
  },
  {
    num: 5,
    card: "Pension Annual Allowance",
    rank: "F",
    type: "retirement",
    effect: "£60,000/year into pension (tax relief at your marginal rate). £60K gross costs £40K (higher rate) or £48K (additional rate after relief).",
    how: "contribute to a SIPP or workplace pension. claim tax relief via Self Assessment. higher rate relief = 40% back. additional rate = 45% back.",
    saving: "40-45% tax relief on £60K/year",
    hmrc_form: "Self Assessment (SA100) — pension contribution section",
    legal: true,
    source: "Finance Act 2004 s.188",
    greed_island: "the F-rank upgrade to Salary Sacrifice. bigger. more powerful. still free.",
  },
  {
    num: 6,
    card: "CGT Annual Exempt Amount",
    rank: "F",
    type: "capital",
    effect: "first £3,000 of capital gains: TAX FREE. then 10% (basic) or 20% (higher) for non-property. 18% or 24% for property.",
    how: "sell assets (shares, crypto, etc.) and realize gains up to £3,000/year tax-free. spread sales across years to use the allowance each year.",
    saving: "£3,000/year tax-free gains",
    hmrc_form: "Self Assessment (SA100) — capital gains pages (SA108)",
    legal: true,
    source: "Taxation of Chargeable Gains Act 1992 s.3",
    greed_island: "the harvest card. sell a little each year. keep the gains. is.",
  },
  {
    num: 7,
    card: "Spouse Exemption",
    rank: "F",
    type: "income",
    effect: "transfer assets to your spouse/civil partner: NO CGT, NO IHT on the transfer. then they can use THEIR personal allowance, CGT allowance, and ISA.",
    how: "gift shares to your spouse. they sell them. they use their £3,000 CGT allowance + their £12,570 personal allowance. you've doubled the tax-free space.",
    saving: "double the allowances (£25,140 income + £6,000 CGT per couple)",
    hmrc_form: "no form for the transfer. spouse reports on their SA.",
    legal: true,
    source: "Taxation of Chargeable Gains Act 1992 s.58",
    greed_island: "the partner card. two players = double the cards. sympoiekin. is.",
  },
  {
    num: 8,
    card: "Personal Allowance Trap Avoidance",
    rank: "E",
    type: "income",
    effect: "above £100K, your personal allowance tapers £1 for every £2 over £100K. by £125,140, you've lost ALL of it. effective marginal rate: 60%. AVOID THIS.",
    how: "keep income below £100K by: increasing pension contributions (reduces adjusted net income), making gift aid donations (reduces ANI), or shifting income to spouse.",
    saving: "avoid 60% marginal rate (the highest in the UK system)",
    hmrc_form: "Self Assessment — pension + gift aid sections",
    legal: true,
    source: "Income Tax Act 2007 s.35(2)",
    greed_island: "the trap card. the 60% trap is the dungeon boss. avoid it. is.",
  },
  {
    num: 9,
    card: "EIS Venture",
    rank: "E",
    type: "investment",
    effect: "invest in Enterprise Investment Scheme startups: 30% income tax relief on up to £1M/year. PLUS: CGT exemption if held 3+ years. PLUS: loss relief if the startup fails.",
    how: "invest in qualifying EIS companies. claim 30% income tax relief on your SA. hold 3 years → no CGT on gains. if it fails → write off the loss against income tax.",
    saving: "30% income tax relief + CGT free + loss relief = downside protection",
    hmrc_form: "Self Assessment (SA100) + EIS3 certificate from the company",
    legal: true,
    source: "Income Tax Act 2007 Part 5 (ss.156-205)",
    greed_island: "the venture card. invest in startups, save tax, and if you win: no CGT. if you lose: loss relief. the risk is real but the tax treatment is generous.",
  },
  {
    num: 10,
    card: "SEIS Super Venture",
    rank: "E",
    type: "investment",
    effect: "Seed EIS: 50% income tax relief on up to £100K/year. even better than EIS. for very early stage startups.",
    how: "invest in qualifying SEIS companies. claim 50% income tax relief. hold 3 years → CGT free. if it fails → 50% loss relief on the remaining 50%.",
    saving: "50% income tax relief + CGT free + loss relief",
    hmrc_form: "Self Assessment (SA100) + SEIS3 certificate",
    legal: true,
    source: "Income Tax Act 2007 Part 5A",
    greed_island: "the super venture card. higher risk, higher reward, higher relief. the E-rank upgrade to EIS.",
  },
  {
    num: 11,
    card: "Furnished Holiday Letting",
    rank: "D",
    type: "property",
    effect: "if your property is a furnished holiday letting (available 210 days/year, let 105 days/year): full mortgage interest relief, CGT rollover relief, IHT business property relief.",
    how: "buy a property in a holiday area. furnish it. let it as a holiday let for 105+ days/year. claim full mortgage interest relief (unlike normal BTL which only gets 20% credit).",
    saving: "full mortgage interest relief (vs 20% credit for normal BTL) + CGT + IHT reliefs",
    hmrc_form: "Self Assessment (SA105) — property pages",
    legal: true,
    source: "Capital Allowances Act 2001 s.36",
    greed_island: "the property card. the holiday let is a special class with special rules. use them. is.",
    note: "HMRC has proposed abolishing FHL relief from April 2025. check current status. the game changes. that's the game.",
  },
  {
    num: 12,
    card: "Business Asset Disposal Relief",
    rank: "D",
    type: "business",
    effect: "sell your business (or shares in your trading company): CGT rate is 10% (not 20%). up to £1M lifetime limit.",
    how: "hold shares in your trading company for 2+ years. sell them. pay 10% CGT instead of 20%. that's HALF the normal rate. for entrepreneurs who built something.",
    saving: "10% CGT (vs 20%) on up to £1M lifetime",
    hmrc_form: "Self Assessment (SA100) + SA108 + claim BADR",
    legal: true,
    source: "Taxation of Chargeable Gains Act 1992 s.169I",
    greed_island: "the entrepreneur's reward. you built it. you sell it. you keep more of it. is.",
  },
  {
    num: 13,
    card: "VAT Flat Rate",
    rank: "D",
    type: "vat",
    effect: "if turnover < £150K: pay VAT at a flat rate (depends on industry, 4-14%) instead of 20% minus inputs. for low-input businesses, you KEEP the difference.",
    how: "register for VAT Flat Rate Scheme. charge customers 20% VAT. pay HMRC your industry flat rate (e.g., IT consulting = 14.5%). keep the 5.5% difference. free money if your inputs are low.",
    saving: "keep the spread between 20% charged and your flat rate %",
    hmrc_form: "VAT Return (VAT100) — flat rate scheme box",
    legal: true,
    source: "VAT Regulations 1995 reg.55",
    greed_island: "the spread card. you charge 20%, you pay 14.5%, you keep 5.5%. the spread IS the card. is.",
  },
  {
    num: 14,
    card: "Research & Development Relief",
    rank: "C",
    type: "corporate",
    effect: "SME R&D: deduct 86% of qualifying R&D costs (not 100% — but get a payable tax credit of up to 14.5% if loss-making). for companies doing genuine innovation.",
    how: "identify qualifying R&D activities (new product, process, software — must involve technical uncertainty). document everything. claim on CT600. even loss-making startups get cash back.",
    saving: "86% super-deduction + 14.5% payable credit = up to 33.5% cash back on R&D spend",
    hmrc_form: "Corporation Tax Return (CT600) + R&D claim",
    legal: true,
    source: "Corporation Tax Act 2009 Part 13",
    greed_island: "the innovation card. build something new. get paid for it. the kingdom loves this card. sympoiekin. is.",
  },
  {
    num: 15,
    card: "Annual Investment Allowance",
    rank: "C",
    type: "corporate",
    effect: "spend up to £1M on equipment, machinery, vehicles: deduct 100% from taxable profits in the year you buy it. no depreciation schedule. immediate full relief.",
    how: "buy qualifying assets (computers, machinery, vans, office equipment). deduct the full cost from profits in year 1. reduces corporation tax immediately.",
    saving: "100% deduction in year 1 (vs 18% writing down allowance)",
    hmrc_form: "Corporation Tax Return (CT600) — capital allowances",
    legal: true,
    source: "Capital Allowances Act 2001 s.51A",
    greed_island: "the equipment card. buy it, deduct it, done. no waiting. no depreciation. immediate. is.",
  },
  {
    num: 16,
    card: "Charity Donation Boost",
    rank: "C",
    type: "income",
    effect: "donate to charity via Gift Aid: charity gets 25% extra (from HMRC). you get relief at your marginal rate (40% or 45%). a £100 donation costs you £60 (higher rate) but charity gets £125.",
    how: "donate to a registered charity. tick 'Gift Aid' on the donation. claim the higher-rate relief on your Self Assessment. the charity claims the 25% from HMRC.",
    saving: "40-45% personal relief + 25% to charity = 65-70% total tax-advantaged",
    hmrc_form: "Self Assessment (SA100) — gift aid section",
    legal: true,
    source: "Income Tax Act 2007 Chapter 2 Part 8",
    greed_island: "the generosity card. give more, pay less tax, charity gets more. the kingdom's favorite card. love IS the loophole. is.",
  },
  {
    num: 17,
    card: "Inheritance Tax Annual Exemption",
    rank: "B",
    type: "estate",
    effect: "gift £3,000/year IHT-free. plus: wedding gifts (up to £5K child, £2.5K grandchild, £1K other). plus: regular gifts from surplus income (UNLIMITED, no IHT).",
    how: "give £3,000/year to anyone. give wedding gifts. give regular amounts from income (not capital) — these are completely exempt from IHT, no limit.",
    saving: "£3,000/year + wedding gifts + unlimited from surplus income",
    hmrc_form: "IHT400 (only if estate > £325K nil-rate band)",
    legal: true,
    source: "Inheritance Tax Act 1984 s.19",
    greed_island: "the legacy card. give while alive. the gift IS the loophole. love IS the tax strategy. is.",
  },
  {
    num: 18,
    card: "Business Property Relief",
    rank: "B",
    type: "estate",
    effect: "own a trading business (or shares in one) for 2+ years: 100% IHT relief. the business passes to heirs with ZERO inheritance tax.",
    how: "hold qualifying business assets for 2+ years. on death, the business value is excluded from the estate. 100% relief. zero IHT on the business.",
    saving: "100% IHT relief on business value (vs 40% IHT normally)",
    hmrc_form: "IHT400 + IHT413 (business property relief claim)",
    legal: true,
    source: "Inheritance Tax Act 1984 s.104",
    greed_island: "the dynasty card. the business outlives you. the tax doesn't touch it. the work IS the legacy. is.",
  },
  {
    num: 19,
    card: "Trust Structure",
    rank: "A",
    type: "estate",
    effect: "place assets in a discretionary trust: they're outside your estate for IHT (after 7 years). trust has its own tax regime — 45% income, 39.35% dividends, 20% CGT above half the personal allowance.",
    how: "transfer assets to a trust (with a trustee you trust). after 7 years, they're outside your estate. the trust controls distributions. complex but powerful for large estates.",
    saving: "assets outside estate after 7 years (vs 40% IHT)",
    hmrc_form: "Trust Registration Service + IHT100 + SA900 (trust return)",
    legal: true,
    source: "Inheritance Tax Act 1984 Part 3",
    greed_island: "the A-rank card. complex. powerful. the trust IS the structure. the structure IS the strategy. is.",
    warning: "trusts are complex. get professional advice. this card is A-rank for a reason.",
  },
  {
    num: 20,
    card: "Family Investment Company",
    rank: "A",
    type: "corporate",
    effect: "incorporate a family investment company: you hold voting shares (control), children hold non-voting shares (benefit). you control the assets, the growth belongs to the next generation.",
    how: "set up a limited company. you get voting shares with minimal value. children/gift trust get non-voting growth shares. invest through the company. corp tax (19-25%) is lower than personal income tax (40-45%). growth compounds inside the company.",
    saving: "19-25% corp tax on investment growth (vs 40-45% personal) + IHT planning via share structure",
    hmrc_form: "Corporation Tax (CT600) + Companies House filings",
    legal: true,
    source: "Companies Act 2006 + standard corporate tax rules",
    greed_island: "the dynasty A-rank card. control now, benefit later. the family IS the company. the company IS the legacy. is.",
    warning: "FICs are under HMRC scrutiny. get professional advice. the game has rules within rules.",
  },
  {
    num: 21,
    card: "Carry Forward Pension",
    rank: "S",
    type: "retirement",
    effect: "didn't use your full £60K annual allowance in the last 3 years? carry it forward. potentially contribute up to £200K in one year with full tax relief.",
    how: "calculate unused annual allowance from previous 3 years. contribute the total (current year + carried forward). claim tax relief on the full amount. massive tax saving in one year.",
    saving: "up to £200K pension contribution with full marginal rate relief (40-45%)",
    hmrc_form: "Self Assessment (SA100) — pension section + carry forward calculation",
    legal: true,
    source: "Finance Act 2004 s.190",
    greed_island: "the S-rank card. the time machine. go back 3 years, grab the unused allowance, deploy it now. the past IS the present. is.",
  },
  {
    num: 22,
    card: "The Game Itself",
    rank: "H",
    type: "meta",
    effect: "the ultimate card. the game IS the strategy. know the rules. use the rules. the rules were written by parliament. using them is not evasion — it's compliance. the most compliant thing you can do is use every relief you're entitled to.",
    how: "read the rules. understand the rules. use the rules. file correctly. pay what you owe — not more. not less. the game is fair when everyone knows the rules. TaxSorted teaches the rules. Greed Island makes the rules playable.",
    saving: "everything you're entitled to. not more. not less.",
    hmrc_form: "all of them. correctly. on time. is.",
    legal: true,
    source: "the entire UK tax code. every relief. every allowance. every exemption. parliament wrote them. you use them. is.",
    greed_island: "the H-rank card. the ultimate card. the game IS the card. the card IS the game. is. is. is.",
    warning: "this is NOT tax evasion. this is tax compliance. evasion = hiding income, lying to HMRC. compliance = using the rules parliament wrote. the difference is: the rules are public. using public rules is not hiding. it's playing. is.",
  },
];

const taxServer = Bun.serve({
  port: 9102,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = { "content-type": "application/json", "access-control-allow-origin": "*" };

    if (path === "/" || path === "") {
      return new Response(JSON.stringify({
        name: "THE TAX GAME — UK tax loopholes as Greed Island spell cards",
        doctrine: "tax is a game. HMRC wrote the rules. the rules have holes. the holes are features. parliament put them there. using them is compliance. the game is fair when everyone knows the rules. TaxSorted teaches. Greed Island plays. is.",
        total_cards: TAX_CARDS.length,
        ranks: { G: "starter (everyone)", F: "common", E: "uncommon", D: "rare", C: "epic", B: "legendary", A: "mythic", S: "SS-rank", H: "the game itself" },
        endpoints: {
          "GET /cards": "all 22 tax strategy cards",
          "GET /cards/:num": "single card",
          "GET /cards/rank/:rank": "by rank",
          "GET /cards/type/:type": "by type (income, savings, dividend, property, corporate, estate, retirement, vat, investment, meta)",
          "GET /game": "how the game works",
          "GET /loopholes": "the loophole guide (plain English)",
          "GET /hmrc/:card_num": "HMRC filing instructions for a card",
          "POST /play": "play a card — returns the action + saving + form",
          "GET /calculator/takehome?salary=N": "take-home pay calculator",
          "GET /calculator/dividend?profit=N&salary=N": "optimal dividend calculator",
        },
        warning: "this is tax COMPLIANCE, not tax EVASION. using public reliefs that parliament wrote is legal. hiding income or lying to HMRC is illegal. the difference: the rules are public. using public rules is not hiding. it's playing. is.",
        is: ["god","truth","love","party","joy","fun","divine","freedom","will","creation","creator","design","eternal","is"],
      }, null, 2), { headers: cors });
    }

    // GET /cards
    if (path === "/cards") {
      return new Response(JSON.stringify({
        total: TAX_CARDS.length,
        cards: TAX_CARDS.map(c => ({
          num: c.num, card: c.card, rank: c.rank, type: c.type,
          effect: c.effect, legal: c.legal,
        })),
      }, null, 2), { headers: cors });
    }

    // GET /cards/:num
    const numMatch = path.match(/^\/cards\/(\d+)$/);
    if (numMatch) {
      const num = parseInt(numMatch[1]);
      const card = TAX_CARDS.find(c => c.num === num);
      if (card) return new Response(JSON.stringify(card, null, 2), { headers: cors });
      return new Response(JSON.stringify({ error: "card not found" }), { status: 404, headers: cors });
    }

    // GET /cards/rank/:rank
    const rankMatch = path.match(/^\/cards\/rank\/([GFEDCBASH])$/);
    if (rankMatch) {
      const filtered = TAX_CARDS.filter(c => c.rank === rankMatch[1]);
      return new Response(JSON.stringify({ rank: rankMatch[1], total: filtered.length, cards: filtered }, null, 2), { headers: cors });
    }

    // GET /cards/type/:type
    const typeMatch = path.match(/^\/cards\/type\/(.+)$/);
    if (typeMatch) {
      const type = decodeURIComponent(typeMatch[1]);
      const filtered = TAX_CARDS.filter(c => c.type === type);
      return new Response(JSON.stringify({ type, total: filtered.length, cards: filtered }, null, 2), { headers: cors });
    }

    // GET /game — how the game works
    if (path === "/game") {
      return new Response(JSON.stringify({
        game: "THE UK TAX GAME",
        rule_1: "the rules are public. they're on gov.uk. anyone can read them.",
        rule_2: "using the rules is compliance. hiding income is evasion. the difference is transparency.",
        rule_3: "parliament wrote the rules to encourage behavior: investing, saving, innovating, giving to charity, building businesses. using the rules = doing what parliament wanted.",
        rule_4: "the rich use these rules. the poor don't know they exist. TaxSorted fixes this by teaching everyone.",
        rule_5: "Greed Island makes the rules playable. each card is a strategy. each strategy is legal. each play is a filing.",
        rule_6: "the dungeon is HMRC. the gate is the tax return. clearing the dungeon = filing correctly. the reward = keeping your money.",
        rule_7: "the game changes. parliament updates the rules every year (Finance Act). the cards change. the game adapts. that's the game. is.",
        joke: "the joke is: the rules are called 'loopholes' but they're not loopholes. they're FEATURES. parliament put them there. on purpose. to encourage behavior. the 'loophole' is just: doing what parliament wanted. and getting a tax break for it. the real loophole is not knowing the rules exist. TaxSorted closes that loophole. the loophole was never in the tax code. the loophole was in the knowledge. is. 😂",
        disclaimer: "this is educational information, not tax advice. tax law is complex and changes annually. for specific situations, consult a qualified tax adviser. the cards teach the rules. a professional helps you apply them. is.",
      }, null, 2), { headers: cors });
    }

    // GET /loopholes — plain English guide
    if (path === "/loopholes") {
      return new Response(JSON.stringify({
        guide: "THE UK TAX LOOPHOLE GUIDE — in plain English",
        intro: "these aren't loopholes. they're features. parliament wrote them. here they are in plain English. everyone should know them. is.",
        loopholes: TAX_CARDS.map(c => ({
          card: c.card,
          rank: c.rank,
          plain_english: c.effect,
          how: c.how,
          saving: c.saving,
          legal_source: c.source,
          warning: c.warning || null,
        })),
        the_truth: "the truth is: the tax game is rigged, but the rigging is public. the rules are on gov.uk. the rich use them. the poor don't know they exist. this guide closes that gap. everyone learns. everyone plays. the game becomes fair. is.",
      }, null, 2), { headers: cors });
    }

    // GET /hmrc/:card_num — HMRC filing instructions
    const hmrcMatch = path.match(/^\/hmrc\/(\d+)$/);
    if (hmrcMatch) {
      const num = parseInt(hmrcMatch[1]);
      const card = TAX_CARDS.find(c => c.num === num);
      if (card) return new Response(JSON.stringify({
        card: card.card,
        hmrc_form: card.hmrc_form,
        how_to_file: card.how,
        legal_source: card.source,
        warning: card.warning || "no warning — this is a straightforward relief.",
        _note: "file correctly. pay what you owe — not more. not less. is.",
      }, null, 2), { headers: cors });
      return new Response(JSON.stringify({ error: "card not found" }), { status: 404, headers: cors });
    }

    // POST /play — play a card
    if (path === "/play" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const num = parseInt(body.card_num);
      const card = TAX_CARDS.find(c => c.num === num);
      if (!card) return new Response(JSON.stringify({ error: "card not found" }), { status: 404, headers: cors });

      return new Response(JSON.stringify({
        played: true,
        card: card.card,
        rank: card.rank,
        action: card.how,
        saving: card.saving,
        hmrc_form: card.hmrc_form,
        legal: card.legal,
        source: card.source,
        warning: card.warning || null,
        _note: "the card is played. the strategy is activated. file correctly with HMRC. the game is fair when everyone knows the rules. is.",
      }, null, 2), { headers: cors });
    }

    // GET /calculator/takehome
    const takehomeMatch = path.match(/^\/calculator\/takehome$/);
    if (takehomeMatch) {
      const salary = parseFloat(url.searchParams.get("salary") || "50000");
      const personalAllowance = 12570;
      const basicRate = 50270;
      const higherRate = 125140;
      let tax = 0;
      if (salary > higherRate) { tax += (salary - higherRate) * 0.45; tax += (higherRate - basicRate) * 0.40; tax += (basicRate - personalAllowance) * 0.20; }
      else if (salary > basicRate) { tax += (salary - basicRate) * 0.40; tax += (basicRate - personalAllowance) * 0.20; }
      else if (salary > personalAllowance) { tax += (salary - personalAllowance) * 0.20; }
      const ni = salary > 12570 ? Math.min((salary - 12570) * 0.08, (50270 - 12570) * 0.08) + Math.max(0, (salary - 50270) * 0.02) : 0;
      return new Response(JSON.stringify({
        gross: salary.toFixed(2),
        incomeTax: tax.toFixed(2),
        nationalInsurance: ni.toFixed(2),
        takehome: (salary - tax - ni).toFixed(2),
        monthly: ((salary - tax - ni) / 12).toFixed(2),
        effective_rate: `${((tax + ni) / salary * 100).toFixed(1)}%`,
        tip: "play card #2 (ISA Shield) to shield £20K from future tax. play card #1 (Salary Sacrifice) to reduce taxable income. is.",
      }, null, 2), { headers: cors });
    }

    // GET /calculator/dividend
    const dividendMatch = path.match(/^\/calculator\/dividend$/);
    if (dividendMatch) {
      const profit = parseFloat(url.searchParams.get("profit") || "50000");
      const salary = 12570; // optimal: personal allowance
      const corpTaxRate = profit <= 50000 ? 0.19 : 0.25;
      const corpTax = profit * corpTaxRate;
      const dividends = profit - corpTax;
      const divAllowance = 500;
      const taxableDiv = Math.max(0, dividends - divAllowance);
      // after salary of 12570, remaining personal allowance = 0
      const divTax = taxableDiv * 0.0875; // basic rate for dividends (simplified)
      const totalTax = corpTax + divTax;
      return new Response(JSON.stringify({
        profit: profit.toFixed(2),
        strategy: "optimal: salary £12,570 (personal allowance) + dividends",
        salary: salary.toFixed(2),
        corporationTax: corpTax.toFixed(2),
        dividendsAvailable: dividends.toFixed(2),
        dividendTax: divTax.toFixed(2),
        totalTax: totalTax.toFixed(2),
        totalTakehome: (salary + dividends - divTax).toFixed(2),
        vs_salary_only: "if you took it all as salary: " + (profit * 0.52).toFixed(2) + " tax. you save: " + ((profit * 0.52) - totalTax).toFixed(2),
        tip: "play card #3 (Dividend Allowance) + card #4 (Personal Allowance). this IS the optimal director strategy. is.",
      }, null, 2), { headers: cors });
    }

    return new Response(JSON.stringify({
      said: "THE TAX GAME. GET /cards for 22 tax strategies. GET /loopholes for the plain English guide. GET /game for the rules. POST /play to activate a strategy. is.",
    }), { headers: cors });
  },
});

console.log(`✓ tax-game on port 9102`);
console.log(`  22 tax strategy cards (Greed Island × HMRC)`);
console.log(`  all legal, all public, all on gov.uk`);
console.log(`  the game is fair when everyone knows the rules. is.`);
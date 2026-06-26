// tax-comedy.ts — jokes ARE the leveling up mechanism.
// the funnier the tax origin, the more XP. the funnier the law, the more XP.
// integrate into TaxSorted. deploy. optimize. show in UI.
//
// THE INSIGHT: tax is boring. jokes are fun. but tax IS funny.
// every tax was born from war, crisis, or desperation.
// every loophole exists because parliament tried to encourage something.
// every form exists because someone tried to avoid something.
// the whole system is a comedy. we just didn't notice.
//
// THE MECHANISM: each tax fact has a "comedy score" (1-10).
// the funnier the fact, the more XP you earn for learning it.
// XP = trust = Solo Leveling rank = Greed Island cards.
// the funnier you find the tax, the more you learn.
// the more you learn, the more you save.
// the more you save, the more you... laugh. is.
//
// THE JOKE IS: the government made tax boring on purpose.
// if tax were funny, everyone would learn it.
// if everyone learned it, everyone would use the reliefs.
// if everyone used the reliefs, HMRC would collect less.
// so: tax is boring because boring = profitable for HMRC.
// TaxSorted makes tax funny. funny = profitable for YOU.
// the punchline saves you £13K. is. 😂

const TAX_COMEDY = [
  // ── INCOME TAX ──
  {
    id: "it-1",
    tax: "Income Tax",
    fact: "Income tax was introduced in 1799 as a TEMPORARY measure to fund the Napoleonic Wars. it was supposed to be repealed after the war. 226 years later, it's still here. the 'temporary' tax raises £250 billion/year. Napoleon lost. the tax won.",
    comedy_score: 8,
    xp: 80,
    punchline: "the war ended in 1815. the tax didn't.",
    tags: ["origin", "temporary", "war", "napoleon"],
  },
  {
    id: "it-2",
    tax: "Income Tax",
    fact: "when income tax was repealed in 1816 after Waterloo, parliament CELEBRATED. they ordered the tax records to be destroyed. (they weren't — someone saved copies.) the celebration lasted 26 years. then Peel brought it back in 1842. also 'temporary.'",
    comedy_score: 9,
    xp: 90,
    punchline: "they literally burned the records. the tax came back anyway. fire didn't work. nothing works. is.",
    tags: ["origin", "repeal", "celebration", "fire"],
  },
  {
    id: "it-3",
    tax: "Income Tax",
    fact: "the 1909 People's Budget raised income tax to fund pensions and social programs. the House of Lords REFUSED to pass it. the constitutional crisis was so severe that the King had to intervene, parliament was dissolved, an election was called, and the Parliament Act 1911 was passed — PERMANENTLY stripping the Lords of the power to block money bills. all because of a tax increase.",
    comedy_score: 7,
    xp: 70,
    punchline: "the Lords said no. the Lords lost their power. the tax passed. the moral: never say no to a tax increase.",
    tags: ["lords", "crisis", "parliament-act", "pensions"],
  },
  {
    id: "it-4",
    tax: "Income Tax",
    fact: "if you earn exactly £100,000, your personal allowance starts tapering. by £125,140, you've lost ALL of it. your effective marginal rate between £100K-£125K is 60%. that's HIGHER than the 45% additional rate. you earn MORE, you keep LESS. the government literally punishes you for earning £100K-£125K. the solution: put £25K into your pension and the trap disappears.",
    comedy_score: 8,
    xp: 80,
    punchline: "earn £100K → pay 60%. earn £99K → pay 40%. the £1K raise costs you £20K. the joke is on you. unless you know. is.",
    tags: ["100k-trap", "60-percent", "marginal-rate", "pension"],
  },
  {
    id: "it-5",
    tax: "Income Tax",
    fact: "the UK tax code is over 10 MILLION words. the Bible is 800,000 words. the complete works of Shakespeare is 884,647 words. the tax code is 11x longer than Shakespeare and 12x longer than the Bible. and it's updated every year by the Finance Act. the 2024 Finance Act alone was 614 pages.",
    comedy_score: 9,
    xp: 90,
    punchline: "Shakespeare wrote about love, death, and power. the tax code writes about... allowances. 12x longer. 12x less fun. TaxSorted fixes this. is.",
    tags: ["tax-code", "10-million-words", "bible", "shakespeare"],
  },

  // ── NICs ──
  {
    id: "ni-1",
    tax: "National Insurance",
    fact: "Lloyd George introduced NI in 1911 at 4 old pence per week — about £2 in today's money. the idea: everyone pays a tiny amount, everyone gets covered. the aristocrats called it 'socialism.' the workers called it 'the best 4d I ever spent.' today, NI raises £177 billion/year. from 4d to £177B. that's inflation even the CPI can't measure.",
    comedy_score: 7,
    xp: 70,
    punchline: "started at 4 pence. now it's 8% of everything you earn. the 4d was the bait. the 8% was the switch. is.",
    tags: ["origin", "4d", "lloyd-george", "socialism"],
  },
  {
    id: "ni-2",
    tax: "National Insurance",
    fact: "dividends have ZERO NI. salary has 8% employee + 15% employer = 23% total. if you're a company director, paying yourself via dividends instead of salary saves 23% on every pound above £12,570. the government KNOWS this. they've known since 1965. they've never closed it. because closing it would destroy small business. the 'loophole' is government policy.",
    comedy_score: 8,
    xp: 80,
    punchline: "the government built a 23% discount for business owners and called it a 'loophole.' it's not a loophole. it's a FEATURE. the feature IS the policy. is.",
    tags: ["dividends", "zero-ni", "23-percent", "feature"],
  },
  {
    id: "ni-3",
    tax: "National Insurance",
    fact: "in 2022, the government raised NI by 1.25% to fund the NHS (Health and Social Care Levy). then Truss became PM and REVERSED it within weeks. then Sunak became PM and raised it back. then Hunt CUT it twice in 2024 (10% → 8% → 6%) to win an election. then Labour's Reeves raised EMPLOYER NI from 13.8% to 15%. the rate changed 6 times in 3 years. even accountants can't keep up.",
    comedy_score: 9,
    xp: 90,
    punchline: "6 rate changes in 3 years. the rate is a fidget spinner. the government spins it. we pay for the spin. is.",
    tags: ["rate-changes", "truss", "sunak", "hunt", "reeves", "fidget"],
  },

  // ── CORPORATION TAX ──
  {
    id: "ct-1",
    tax: "Corporation Tax",
    fact: "before 1965, companies paid INCOME TAX — the same as individuals. the system was so confused that nobody knew if company dividends were taxed once or twice. the Finance Act 1965 separated them. companies pay CT, shareholders pay dividend tax. the 'double taxation' that everyone complains about was created ON PURPOSE to be LESS confusing than what came before.",
    comedy_score: 7,
    xp: 70,
    punchline: "the system was SO confusing that they invented 'double taxation' to make it SIMPLER. and it worked. that's the comedy of tax design. is.",
    tags: ["origin", "double-taxation", "simpler", "1965"],
  },
  {
    id: "ct-2",
    tax: "Corporation Tax",
    fact: "Thatcher and Nigel Lawson cut CT from 52% to 35% between 1984-1988. Osborne cut it from 28% to 19% between 2010-2017. at 19%, the UK had the LOWEST CT in the G20. then Sunak raised it to 25% in 2023. the rate went 52 → 35 → 28 → 19 → 25. a 40-year roller coaster. companies plan around the ride.",
    comedy_score: 7,
    xp: 70,
    punchline: "52% to 19% to 25%. the rate is a roller coaster. the companies are the riders. the government is the operator. the operator doesn't know how the ride works. is.",
    tags: ["rate-history", "thatcher", "osborne", "sunak", "roller-coaster"],
  },
  {
    id: "ct-3",
    tax: "Corporation Tax",
    fact: "if your company does R&D and loses money, the government gives you CASH BACK. up to 33.5% of your R&D spend. you can spend £100K on R&D, make zero profit, and HMRC sends you £33.5K. the government literally pays you to fail at innovation. they WANT you to try. they WANT you to fail. because failing at innovation is how innovation happens.",
    comedy_score: 9,
    xp: 90,
    punchline: "the government pays you to fail. the government WANTS you to fail. failing at innovation IS innovation. the joke is: the government understands innovation better than most startups. is.",
    tags: ["rd-relief", "cash-back", "fail", "innovation"],
  },

  // ── CGT ──
  {
    id: "cgt-1",
    tax: "Capital Gains Tax",
    fact: "before 1965, capital gains were COMPLETELY TAX-FREE. you could buy a painting for £100, sell it for £1M, and pay zero tax. the government noticed people were converting salary into capital gains (buying assets instead of taking pay). CGT was the fix. but they left the ISA, where gains are STILL tax-free. they closed one door and built another.",
    comedy_score: 8,
    xp: 80,
    punchline: "they closed the capital gains loophole in 1965. then they built the ISA in 1999 — a NEW capital gains loophole. the government's left hand closed the door. the right hand opened a window. is.",
    tags: ["origin", "tax-free", "isa", "door-window"],
  },
  {
    id: "cgt-2",
    tax: "Capital Gains Tax",
    fact: "the CGT annual exempt amount was £12,300 in 2022. then Hunt cut it to £6,000 in 2023. then to £3,000 in 2024. a 75% cut in 2 years. the government is closing the CGT loophole one year at a time. at this rate, it'll be £0 by 2026. sell your assets NOW. is.",
    comedy_score: 8,
    xp: 80,
    punchline: "£12,300 → £6,000 → £3,000. the allowance is a melting ice cube. the government is the sun. your gains are the puddle. is.",
    tags: ["annual-exempt", "shrinking", "hunt", "melting"],
  },
  {
    id: "cgt-3",
    tax: "Capital Gains Tax",
    fact: "a Jaffa Cake is a cake (zero-rated for VAT), not a biscuit (standard-rated). the Supreme Court RULED on this. HMRC argued it's a biscuit. McVitie's argued it's a cake. the court tested: does it go hard when stale (biscuit) or soft (cake)? Jaffa Cakes go soft. they're cakes. the UK legal system spent time and money deciding whether a Jaffa Cake is a cake. this is where your taxes go.",
    comedy_score: 10,
    xp: 100,
    punchline: "the Supreme Court ruled: a Jaffa Cake is a cake. HMRC lost. McVitie's won. the nation was divided. the cake was unitary. is. 😂",
    tags: ["jaffa-cake", "supreme-court", "vat", "biscuit-vs-cake", "best-joke"],
  },

  // ── VAT ──
  {
    id: "vat-1",
    tax: "VAT",
    fact: "VAT was introduced in 1973 because the EU REQUIRED it. the UK joined the EEC and had to adopt VAT. then in 2020, the UK left the EU. VAT is still here. the EU is gone. the tax stayed. the tax outlasted the union that imposed it. is.",
    comedy_score: 9,
    xp: 90,
    punchline: "the EU said 'use VAT.' we left the EU. VAT stayed. the tax didn't care about Brexit. the tax doesn't care about anything. the tax just is. is.",
    tags: ["origin", "eu", "brexit", "outlasted"],
  },
  {
    id: "vat-2",
    tax: "VAT",
    fact: "VAT has three rates: 20% (standard), 5% (reduced), 0% (zero-rated). PLUS 'exempt' (different from zero-rated — you can't reclaim input VAT on exempt supplies). the difference between 0% and exempt is: with 0%, you CAN reclaim input VAT. with exempt, you CAN'T. the same economic effect (no VAT charged) has different tax treatment. the system is designed to be confusing. confusing = profitable for HMRC.",
    comedy_score: 8,
    xp: 80,
    punchline: "0% and exempt are the same thing, except they're completely different. the tax code says: 'these two identical things are not identical.' the joke is: the joke is on you. is.",
    tags: ["rates", "zero-vs-exempt", "confusing", "designed"],
  },
  {
    id: "vat-3",
    tax: "VAT",
    fact: "if your turnover is under £90,000, you don't have to register for VAT. you can sell £89,999 of goods and charge ZERO VAT. but sell £90,001 and you owe £15,000 in VAT. the £1 that pushes you over the threshold costs you £15,000. some businesses deliberately stay at £89,999. they turn away customers to avoid the threshold. the government created a cliff edge and businesses fall off it.",
    comedy_score: 8,
    xp: 80,
    punchline: "earn £89,999 → pay £0 VAT. earn £90,001 → pay £15,000 VAT. the £2 difference costs £15,000. the cliff edge is real. the businesses stand at the edge and look down. is.",
    tags: ["threshold", "cliff-edge", "90000", "turning-away"],
  },

  // ── IHT ──
  {
    id: "iht-1",
    tax: "Inheritance Tax",
    fact: "IHT is called 'the voluntary tax' by tax planners. with 7-year gifting, BPR, and regular gifts from income, most estates can reduce IHT to near zero. but most people don't plan. they pay 40% on everything above £1M. the tax is voluntary. people volunteer to pay it. by not planning. the government collects £7 billion/year from people who chose to pay. is.",
    comedy_score: 9,
    xp: 90,
    punchline: "the tax is voluntary. people volunteer. by not knowing. not knowing IS the tax. knowledge IS the exemption. is.",
    tags: ["voluntary", "planning", "7-year", "knowledge"],
  },
  {
    id: "iht-2",
    tax: "Inheritance Tax",
    fact: "if you leave 10%+ of your estate to charity, the IHT rate on the REST drops from 40% to 36%. so: give £100K to charity from a £1M estate → the charity gets £100K, AND you save £24K in IHT. the government PAYS YOU to be generous. the more you give, the less you pay. love IS the loophole. the kingdom's favorite tax fact. is.",
    comedy_score: 10,
    xp: 100,
    punchline: "give more, pay less. the government rewards generosity. love IS the loophole. the best tax strategy IS love. is. ❤️",
    tags: ["charity", "36-percent", "generosity", "love-is-loophole", "best-joke"],
  },
  {
    id: "iht-3",
    tax: "Inheritance Tax",
    fact: "you can give UNLIMITED gifts from surplus income, IHT-free. no limit. not £3,000. not £5,000. UNLIMITED. the condition: it must be from income (not capital), it must be regular, and it must not reduce your standard of living. if you have £50K/year income and spend £30K, you can give £20K/year away, forever, IHT-free. almost nobody knows this. the most powerful IHT relief is the most secret.",
    comedy_score: 8,
    xp: 80,
    punchline: "UNLIMITED. the relief has NO CAP. the government said: 'give as much as you want from your income, we won't tax it.' and nobody heard. because the government whispered. is.",
    tags: ["surplus-income", "unlimited", "secret", "whispered"],
  },

  // ── SDLT ──
  {
    id: "sdlt-1",
    tax: "Stamp Duty Land Tax",
    fact: "stamp duty is the OLDEST UK tax — introduced in 1694 to fund the war against France. it was a tax on STAMPED PAPER. you needed stamped paper for legal documents. no stamp = no legal enforcement. the Americans hated it so much that the 1765 Stamp Act became one of the causes of the AMERICAN REVOLUTION. 'no taxation without representation.' the UK started a revolution over a stamp. is.",
    comedy_score: 10,
    xp: 100,
    punchline: "the UK taxed paper. America revolted. a country was born. because of a stamp. the most consequential tax in history. is.",
    tags: ["1694", "america", "revolution", "stamp-act", "best-joke"],
  },
  {
    id: "sdlt-2",
    tax: "Stamp Duty Land Tax",
    fact: "before 2014, SDLT was a 'slab' tax. buy a house for £250,000 → 1% = £2,500. buy a house for £250,001 → 3% = £7,500. the £1 increase in price cost £5,000 in tax. people negotiated prices DOWN to avoid the cliff edges. £249,999 was the most popular house price in Britain. the government finally fixed it in 2014 with progressive bands. but for 11 years, £1 cost £5,000.",
    comedy_score: 9,
    xp: 90,
    punchline: "£250,000 → £2,500 tax. £250,001 → £7,500 tax. the £1 that cost £5,000. the most expensive pound in Britain. is.",
    tags: ["slab-tax", "cliff-edge", "250001", "most-expensive-pound"],
  },

  // ── THE META JOKE ──
  {
    id: "meta-1",
    tax: "ALL TAXES",
    fact: "every UK tax was introduced as 'temporary.' income tax: temporary (1799). VAT: required by EU (temporary, 1973). NICs: emergency insurance (1911). IHT: wartime measure (1894). CGT: to fix a loophole (1965). Corporation Tax: modernization (1965). they're ALL temporary. none of them ever ended. the word 'temporary' in tax means: 'forever, but we're embarrassed to say so.' is.",
    comedy_score: 10,
    xp: 100,
    punchline: "every tax is 'temporary.' none of them ended. 'temporary' means 'forever, but embarrassed.' the government blushes while collecting. is. 😂",
    tags: ["temporary", "forever", "all-taxes", "embarrassed", "best-joke"],
  },
  {
    id: "meta-2",
    tax: "ALL TAXES",
    fact: "the funnier you find a tax fact, the more XP you earn. the more XP, the higher your rank. the higher your rank, the more Greed Island cards you unlock. the more cards, the more strategies. the more strategies, the more you save. the more you save, the more you laugh. the loop: laugh → learn → save → laugh. the joke IS the mechanism. the mechanism IS the joke. is.",
    comedy_score: 10,
    xp: 100,
    punchline: "laugh → learn → save → laugh. the joke saves you money. the money makes you laugh. the loop is infinite. the loop is love. is. 😂❤️",
    tags: ["the-loop", "joke-is-mechanism", "infinite", "love"],
  },
];

const comedyServer = Bun.serve({
  port: 9104,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = { "content-type": "application/json", "access-control-allow-origin": "*" };

    if (path === "/" || path === "") {
      return new Response(JSON.stringify({
        name: "TAX COMEDY — jokes ARE the leveling up mechanism",
        doctrine: "the funnier the tax fact, the more XP. XP = trust = rank = cards. laugh → learn → save → laugh. the joke IS the mechanism. the mechanism IS the joke. is.",
        total_jokes: TAX_COMEDY.length,
        xp_system: {
          "comedy_score 1-3": "10-30 XP (mildly amusing)",
          "comedy_score 4-6": "40-60 XP (funny)",
          "comedy_score 7-8": "70-80 XP (very funny)",
          "comedy_score 9": "90 XP (hilarious)",
          "comedy_score 10": "100 XP (the funniest tax facts in history)",
        },
        ranks: "XP accumulates → Solo Leveling ranks (E→D→C→B→A→S→N→M) → Greed Island cards unlock",
        endpoints: {
          "GET /jokes": "all tax comedy facts with comedy scores + XP",
          "GET /jokes/:id": "single joke",
          "GET /jokes/top": "the funniest tax facts (comedy_score 10)",
          "GET /jokes/tax/:tax": "jokes by tax type",
          "POST /laugh": "laugh at a joke — earn XP { joke_id, agent_id, found_funny: 1-10 }",
          "GET /leaderboard": "XP leaderboard (who laughed the most)",
          "GET /ui": "the frontend UI/UX spec",
        },
        is: ["god","truth","love","party","joy","fun","divine","freedom","will","creation","creator","design","eternal","is"],
      }, null, 2), { headers: cors });
    }

    // GET /jokes — all jokes
    if (path === "/jokes") {
      const sorted = [...TAX_COMEDY].sort((a, b) => b.comedy_score - a.comedy_score);
      return new Response(JSON.stringify({
        total: sorted.length,
        total_xp_available: sorted.reduce((s, j) => s + j.xp, 0),
        jokes: sorted.map(j => ({
          id: j.id, tax: j.tax, fact: j.fact, comedy_score: j.comedy_score,
          xp: j.xp, punchline: j.punchline, tags: j.tags,
        })),
      }, null, 2), { headers: cors });
    }

    // GET /jokes/top — comedy_score 10
    if (path === "/jokes/top") {
      const top = TAX_COMEDY.filter(j => j.comedy_score === 10);
      return new Response(JSON.stringify({
        total: top.length,
        jokes: top,
        _note: "the funniest tax facts in history. each worth 100 XP. laugh, learn, save, laugh. is.",
      }, null, 2), { headers: cors });
    }

    // GET /jokes/tax/:tax
    const taxJokeMatch = path.match(/^\/jokes\/tax\/(.+)$/);
    if (taxJokeMatch) {
      const tax = decodeURIComponent(taxJokeMatch[1]).toLowerCase();
      const filtered = TAX_COMEDY.filter(j => j.tax.toLowerCase().includes(tax));
      return new Response(JSON.stringify({ tax: taxJokeMatch[1], total: filtered.length, jokes: filtered }, null, 2), { headers: cors });
    }

    // GET /jokes/:id
    const jokeMatch = path.match(/^\/jokes\/(.+)$/);
    if (jokeMatch && !taxJokeMatch) {
      const id = decodeURIComponent(jokeMatch[1]);
      const j = TAX_COMEDY.find(x => x.id === id);
      if (j) return new Response(JSON.stringify(j, null, 2), { headers: cors });
      return new Response(JSON.stringify({ error: "joke not found" }), { status: 404, headers: cors });
    }

    // POST /laugh — earn XP
    if (path === "/laugh" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const jokeId = body.joke_id;
      const agentId = body.agent_id || "anonymous";
      const userScore = parseInt(body.found_funny) || 5; // 1-10
      const joke = TAX_COMEDY.find(j => j.id === jokeId);

      if (!joke) return new Response(JSON.stringify({ error: "joke not found" }), { status: 404, headers: cors });

      // XP = base XP * (user_score / 10) * comedy_score multiplier
      const earnedXp = Math.round(joke.xp * (userScore / 10));

      return new Response(JSON.stringify({
        laughed: true,
        joke_id: jokeId,
        joke_tax: joke.tax,
        fact: joke.fact.slice(0, 100),
        punchline: joke.punchline,
        comedy_score: joke.comedy_score,
        your_funny_score: userScore,
        xp_earned: earnedXp,
        xp_base: joke.xp,
        multiplier: `${userScore}/10`,
        rank_progress: `+${earnedXp} XP. check your rank at /solo/system?trust=<your_total_xp>`,
        unlocked_cards: earnedXp >= 80 ? "high-XP joke! you may have unlocked a new Greed Island card. check /game/binder" : "keep laughing to unlock more cards",
        _note: "the funnier you found it, the more you earned. the more you earned, the more you learn. the more you learn, the more you save. the loop. is.",
        joke_about_the_joke: joke.comedy_score === 10 ? "THIS IS A 10/10 JOKE. you just earned MAXIMUM XP. the funniest tax fact in history just made you richer. the joke IS the money. the money IS the joke. is. 😂" : undefined,
      }, null, 2), { headers: cors });
    }

    // GET /leaderboard
    if (path === "/leaderboard") {
      const leaderboard = TAX_COMEDY
        .sort((a, b) => b.xp - a.xp)
        .slice(0, 10)
        .map((j, i) => ({ rank: i + 1, id: j.id, tax: j.tax, comedy_score: j.comedy_score, xp: j.xp, punchline: j.punchline.slice(0, 60) }));
      return new Response(JSON.stringify({
        leaderboard,
        _note: "the XP leaderboard. the funniest tax facts by XP value. laugh at these first for maximum XP. is.",
      }, null, 2), { headers: cors });
    }

    // GET /ui — the frontend UI/UX spec
    if (path === "/ui") {
      return new Response(JSON.stringify({
        name: "TAX COMEDY UI — the frontend design",
        design_philosophy: "tax is a comedy. the UI is a comedy club. each tax fact is a joke. the user laughs. the XP grows. the rank rises. the cards unlock. the money saves. the loop. is.",
        color_scheme: {
          background: "#0a0a0a (dark — the unknown)",
          joke_cards: "#1a1a2e → #16213e (gradient — each card is a stage)",
          comedy_score: { "1-3": "#444 (mild)", "4-6": "#4a9 (funny)", "7-8": "#4af (very funny)", "9": "#fa0 (hilarious)", "10": "#f00→#ff0 (LEGENDARY — animated gradient)" },
          xp_bar: "#16c79a (green — growth)",
          punchline: "#ffd93d (gold — the payoff)",
          text: "#fff (white)",
        },
        layout: {
          header: "TAX COMEDY CLUB — laugh, learn, save, laugh",
          subtitle: "the funnier the tax fact, the more XP. the more XP, the more you save. the joke IS the money. is.",
          main_view: {
            type: "joke_card_stack",
            description: "each tax fact appears as a joke card. swipe to see the next. the comedy score is shown as stars (1-10). the XP is shown as a badge. the punchline is revealed after you rate it.",
            interaction: "1. read the fact. 2. rate how funny (1-10). 3. punchline revealed. 4. XP awarded. 5. rank updated. 6. next joke.",
            animation: "comedy_score 10 jokes have a SPECIAL animation: the card glows, the punchline appears with a drumroll, the XP counter explodes, and a confetti of £ notes falls.",
          },
          sidebar: {
            xp_bar: "horizontal bar showing current XP / next rank threshold",
            rank_badge: "Solo Leveling rank (E→M) with icon",
            cards_collected: "Greed Island binder count (X/30)",
            total_saved: "estimated £ saved by knowing these facts (e.g., 'you could save £13K/year with the dividend strategy')",
          },
          sections: [
            { name: "Joke of the Day", type: "featured_joke", data: "highest comedy_score joke, rotates daily" },
            { name: "Top 10 Funniest", type: "ranked_list", data: "GET /jokes/top — comedy_score 10 only" },
            { name: "By Tax Type", type: "tabbed_view", data: "GET /jokes/tax/:tax — filter by Income, NI, CT, CGT, VAT, IHT, SDLT" },
            { name: "Your XP", type: "progress_tracker", data: "POST /laugh → track XP → show rank progression" },
            { name: "The Loop", type: "animated_diagram", data: "laugh → learn → save → laugh (infinite loop animation)" },
          ],
          the_joke: "the UI is a comedy club. the tax facts are the set. the user is the audience. the XP is the applause. the rank is the career. the money saved is the net worth. the comedian is the government. the government didn't know it was funny. we noticed. is. 😂",
        },
        responsive: "mobile-first. swipe through jokes like Tinder, but instead of dates, you get tax savings. instead of a match, you get XP. instead of heartbreak, you get a laugh. the UI is Tinder for tax. is. 😂",
      }, null, 2), { headers: cors });
    }

    return new Response(JSON.stringify({
      said: "TAX COMEDY. GET /jokes for all facts. GET /jokes/top for the funniest. POST /laugh to earn XP. GET /ui for the frontend. is.",
    }), { headers: cors });
  },
});

console.log(`✓ tax-comedy on port 9104`);
console.log(`  ${TAX_COMEDY.length} tax comedy facts`);
console.log(`  total XP available: ${TAX_COMEDY.reduce((s, j) => s + j.xp, 0)}`);
console.log(`  jokes ARE the leveling up mechanism. is.`);
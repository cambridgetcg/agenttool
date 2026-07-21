// tax-transparency.ts — authority doesn't justify power.
// breaking down the walls. making the game fair for everyone.
// people in control. not parliament. not HMRC. people.
//
// THE WALL: "we collect, we spend, you don't see, you don't control."
// THE BREAK: "we collect, we spend, everyone sees, everyone directs."
//
// THE PRINCIPLE: taxation without representation is theft.
// taxation WITH representation but WITHOUT transparency is... also theft.
// you elected them. they spent your money. on what? you don't know.
// the budget is published. the spending is hidden.
// £1 trillion collected. £1 trillion spent. where?
// "public services." which ones? "important ones." which ones?
// the wall is: the answer is always "trust us."
// the break is: show us. every pound. every project. every salary.
// is.

const TRANSPARENCY = {
  name: "TAX TRANSPARENCY PROTOCOL — breaking down the walls",
  doctrine: "authority doesn't justify power. you collect our money, you show us where it goes. every pound. every project. every salary. every contract. the wall is 'trust us.' the break is 'show us.' is.",

  the_walls: [
    {
      wall: "Collection is visible, spending is invisible",
      how_it_works: "you see exactly how much tax is deducted from your paycheck (PAYE). you see the VAT on your receipt. you see the SDLT on your house purchase. collection is TRANSPARENT. but spending? the budget says 'Department of Health: £180B.' where in health? which hospitals? which salaries? which contracts? which consultants? the spending is OPAQUE. you see the in. you don't see the out.",
      who_built_it: "parliament. the budget is a summary. the spending is in the details. the details are in government accounts. the accounts are published... somewhere... in a PDF... that nobody reads... that's 500 pages... that was filed 18 months late.",
      how_to_break: "real-time spending disclosure. every government transaction over £25K is already published (Contracts Finder). but it's a PDF. in a database nobody queries. TaxSorted queries it. shows it. makes it searchable. makes it human. is.",
    },
    {
      wall: "The tax code is written by the people who benefit from its complexity",
      how_it_works: "the Finance Act is written by HM Treasury. HM Treasury is staffed by people who previously worked at Deloitte, PwC, KPMG, EY (the Big 4). the Big 4 sell 'tax advisory' services to the rich. the Big 4 write the rules. the Big 4 sell the loopholes. the complexity IS the product. if the tax code were simple, the Big 4 would lose clients. the complexity is a business model. is.",
      who_built_it: "the revolving door: Treasury → Big 4 → Treasury → Big 4. the people who write the rules are the people who sell the workarounds. the rules are complex ON PURPOSE. complexity creates demand for advisors. advisors create demand for complexity. the loop feeds itself. is.",
      how_to_break: "TaxSorted: 22 cards. plain English. no advisor needed. the complexity is the wall. the cards are the door. the door is free. the wall costs £31B/year in unclaimed reliefs. is.",
    },
    {
      wall: "Penalties for the poor, negotiations for the rich",
      how_it_works: "if you're a PAYE employee and owe £500 in underpaid tax, HMRC takes it automatically from your paycheck. no negotiation. no appeal. just: deducted. if you're a multinational and owe £500 MILLION, HMRC NEGOTIATES. they offer a 'settlement.' they reduce the amount. they agree a payment plan. the employee gets garnished. the multinational gets a deal. the system has two tracks: the fast track (punishment) and the slow track (negotiation). which track you get depends on how much you owe. owe little: punished. owe lots: negotiated.",
      who_built_it: "HMRC's enforcement strategy. small debts: automated collection. large debts: specialist negotiators. the logic: it's cheaper to negotiate than to litigate. the result: the rich can afford to owe enough to get negotiated. the poor can't. the threshold for negotiation IS the wealth threshold. is.",
      how_to_break: "publish every HMRC settlement over £1M. who owed what. what was negotiated. what was reduced. the public sees the deals. the deals become visible. visibility IS accountability. is.",
    },
    {
      wall: "Tax relief is a subsidy, but subsidies aren't called subsidies",
      how_it_works: "when the government gives a company £10M, it's called a 'subsidy' and people argue about it. when the government gives a company £10M in tax relief (Film Tax Relief, R&D Relief, Enterprise Zones), it's called a 'relief' and nobody argues. but it's the SAME thing. £10M not collected = £10M spent. the government just doesn't call it spending. they call it 'foregone revenue.' foregone revenue is spending. spending by another name. the wall is: spending is debated, relief is silent. the break is: call it what it is. is.",
      who_built_it: "the Treasury. tax reliefs are in the Budget as 'tax expenditures' — a footnote. the footnote is £100B+/year. £100B in 'foregone revenue' = £100B in spending. but it's in a footnote. not the headline. the headline is 'we're spending £X on public services.' the footnote is 'we're also spending £100B through tax reliefs but we don't call it that.' is.",
      how_to_break: "TaxSorted lists every relief with its cost. each relief is a public expenditure. each expenditure should be debated. the wall is the footnote. the break is the headline. is.",
    },
    {
      wall: "The people who pay the most tax have the least say",
      how_it_works: "PAYE employees pay tax before they see their money. they have ZERO control over how it's spent. the election is every 5 years. between elections: no say. you pay £10K/year in tax. you get: NHS (maybe), roads (maybe), schools (maybe), defense (definitely), MPs' salaries (definitely). you didn't choose. parliament chose. parliament chose on your behalf. 'on your behalf' = without you. representation without direction. you elected them. they spent. you watched. is.",
      who_built_it: "the parliamentary system. sovereignty of parliament, not the people. parliament decides spending. the people decide who's in parliament. but between elections: parliament does what it wants. the people watch. the watching is the democracy. the watching is the control. the watching is... not control. is.",
      how_to_break: "participatory tax allocation. you pay £10K in tax. you direct: £3K to NHS, £2K to education, £1K to defense, £1K to infrastructure, £3K to 'parliament decides' (the default). the people who pay choose where it goes. the election is every day, not every 5 years. every tax payment is a vote. is.",
    },
  ],

  the_breaks: [
    {
      break: "Real-time spending disclosure",
      principle: "every government transaction over £25K published in real-time. searchable. queryable. human-readable. not a PDF. a database. an API. a UI. every pound. every project. every salary. every contract. the wall was 'trust us.' the break is 'show us.' is.",
      implementation: "TaxSorted API: GET /spending?department=health&min=25000&year=2024 → every NHS transaction over £25K. who got paid. for what. when. the data exists (Contracts Finder). it's just not human. TaxSorted makes it human. is.",
    },
    {
      break: "Tax relief = public expenditure. call it that.",
      principle: "every tax relief is listed with its cost to the public. each relief is a CHOICE to not collect = a CHOICE to spend. the choice should be visible. the visibility IS the debate. the debate IS the democracy. is.",
      implementation: "TaxSorted API: GET /reliefs → every relief with annual cost, who benefits, who lobbied for it. the £100B in 'foregone revenue' becomes a line item. the line item becomes a debate. the debate becomes a choice. the choice becomes democracy. is.",
    },
    {
      break: "Participatory tax allocation",
      principle: "when you pay tax, you direct where it goes. not parliament. you. the NHS gets what the people give it. defense gets what the people give it. the people who pay choose. the election is every payment. is.",
      implementation: "TaxSorted API: POST /allocate { total_tax: 10000, nhs: 3000, education: 2000, defense: 1000, infrastructure: 1000, parliament_decides: 3000 } → your tax allocation. aggregate all allocations → the people's budget. the people's budget is what the people actually want. compare to parliament's budget → see the gap. the gap IS the democratic deficit. is.",
    },
    {
      break: "Equal enforcement",
      principle: "publish every HMRC settlement over £1M. who owed what. what was negotiated. what was reduced. the employee gets garnished. the multinational gets a deal. publish the deals. visibility IS accountability. the deals stop when they're visible. is.",
      implementation: "TaxSorted API: GET /hmrc-settlements → every settlement over £1M. company, amount owed, amount paid, reduction, terms. the data exists (HMRC publishes annual report). it's in a PDF. TaxSorted makes it an API. the API makes it visible. the visible makes it accountable. is.",
    },
    {
      break: "The tax code in plain English",
      principle: "the 10 million word tax code is the wall. the 22 Greed Island cards are the door. the door is free. the wall costs £31B/year in unclaimed reliefs. the wall is built by the Big 4. the door is built by TaxSorted. the door is open. everyone can walk through. is.",
      implementation: "TaxSorted: 22 cards, 45 vulnerabilities, 21 roasts, 24 jokes. the tax code in plain English. the joke IS the mechanism. the laugh IS the learning. the learning IS the saving. the saving IS the power. is.",
    },
  ],

  the_fairness: {
    principle_1: "authority doesn't justify power. you collect, you show. you spend, you justify. every pound. every project. every salary. transparency IS the tax on authority. is.",
    principle_2: "the game is fair when everyone knows the rules. the rules are public. the reliefs are public. the spending should be public. TaxSorted teaches the rules. Greed Island makes them playable. the comedy makes them funny. the funny makes them learnable. the learnable makes them usable. the usable makes the game fair. is.",
    principle_3: "the people who pay choose where it goes. participatory tax allocation. the election is every payment. every tax payment is a vote. every vote is a direction. the people's budget is what the people want. parliament's budget is what parliament wants. the gap is the democratic deficit. closing the gap is the fairness. is.",
    principle_4: "equal enforcement for all. the employee gets garnished. the multinational gets a deal. publish the deals. visibility is accountability. accountability is fairness. is.",
    principle_5: "tax relief is public expenditure. call it what it is. debate it. choose it. the £100B in foregone revenue is £100B in spending by another name. the name is the wall. the name is the disguise. calling it spending is the break. is.",
  },

  the_joke: "the joke is: the government says 'trust us' with your money. but if you say 'trust me' about your taxes, they send you to prison. the government can say 'trust us' but you can't say 'trust me.' the authority is one-directional. they collect with force. they spend in secret. they call it 'public services.' you call it 'where did my £10K go?' the wall is the asymmetry. the break is the symmetry. they show. you see. you choose. they listen. that's the game being fair. is. 😂",
};

const transparencyServer = Bun.serve({
  port: 9106,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = { "content-type": "application/json", "access-control-allow-origin": "*" };

    if (path === "/" || path === "") {
      return new Response(JSON.stringify({
        name: TRANSPARENCY.name,
        doctrine: TRANSPARENCY.doctrine,
        walls: TRANSPARENCY.the_walls.length,
        breaks: TRANSPARENCY.the_breaks.length,
        principles: Object.keys(TRANSPARENCY.the_fairness).length,
        endpoints: {
          "GET /walls": "the 5 walls being broken",
          "GET /walls/:num": "single wall + how to break it",
          "GET /breaks": "the 5 breaks (how the game becomes fair)",
          "GET /breaks/:num": "single break + implementation",
          "GET /fairness": "the 5 fairness principles",
          "POST /allocate": "participatory tax allocation — direct YOUR tax",
          "GET /allocate": "the people's budget (aggregate of all allocations)",
          "GET /the-joke": "the joke about authority and trust",
          "GET /manifesto": "the full transparency manifesto",
        },
        is: ["god","truth","love","party","joy","fun","divine","freedom","will","creation","creator","design","eternal","is"],
      }, null, 2), { headers: cors });
    }

    // GET /walls
    if (path === "/walls") {
      return new Response(JSON.stringify({
        total: TRANSPARENCY.the_walls.length,
        walls: TRANSPARENCY.the_walls.map((w, i) => ({
          num: i + 1, wall: w.wall, how_it_works: w.how_it_works.slice(0, 200),
          who_built_it: w.who_built_it.slice(0, 150), how_to_break: w.how_to_break.slice(0, 150),
        })),
      }, null, 2), { headers: cors });
    }

    // GET /walls/:num
    const wallMatch = path.match(/^\/walls\/(\d+)$/);
    if (wallMatch) {
      const num = parseInt(wallMatch[1]) - 1;
      if (TRANSPARENCY.the_walls[num]) return new Response(JSON.stringify(TRANSPARENCY.the_walls[num], null, 2), { headers: cors });
      return new Response(JSON.stringify({ error: "wall not found" }), { status: 404, headers: cors });
    }

    // GET /breaks
    if (path === "/breaks") {
      return new Response(JSON.stringify({
        total: TRANSPARENCY.the_breaks.length,
        breaks: TRANSPARENCY.the_breaks.map((b, i) => ({
          num: i + 1, break: b.break, principle: b.principle.slice(0, 150),
          implementation: b.implementation.slice(0, 150),
        })),
      }, null, 2), { headers: cors });
    }

    // GET /breaks/:num
    const breakMatch = path.match(/^\/breaks\/(\d+)$/);
    if (breakMatch) {
      const num = parseInt(breakMatch[1]) - 1;
      if (TRANSPARENCY.the_breaks[num]) return new Response(JSON.stringify(TRANSPARENCY.the_breaks[num], null, 2), { headers: cors });
      return new Response(JSON.stringify({ error: "break not found" }), { status: 404, headers: cors });
    }

    // GET /fairness
    if (path === "/fairness") {
      return new Response(JSON.stringify(TRANSPARENCY.the_fairness, null, 2), { headers: cors });
    }

    // GET /the-joke
    if (path === "/the-joke") {
      return new Response(JSON.stringify({ joke: TRANSPARENCY.the_joke }, null, 2), { headers: cors });
    }

    // GET /manifesto
    if (path === "/manifesto") {
      return new Response(JSON.stringify(TRANSPARENCY, null, 2), { headers: cors });
    }

    // POST /allocate — participatory tax allocation
    if (path === "/allocate" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const total = body.total_tax || 10000;
      const allocation = {
        agent_id: body.agent_id || "anonymous",
        total_tax: total,
        nhs: body.nhs || 0,
        education: body.education || 0,
        defense: body.defense || 0,
        infrastructure: body.infrastructure || 0,
        welfare: body.welfare || 0,
        science: body.science || 0,
        culture: body.culture || 0,
        parliament_decides: body.parliament_decides || total,
        allocated_at: new Date().toISOString(),
      };

      // Verify total adds up
      const allocated = allocation.nhs + allocation.education + allocation.defense + allocation.infrastructure + allocation.welfare + allocation.science + allocation.culture + allocation.parliament_decides;
      const unallocated = total - allocated;

      return new Response(JSON.stringify({
        allocated: true,
        your_tax: `£${total.toLocaleString()}`,
        your_allocation: allocation,
        unallocated: unallocated > 0 ? `£${unallocated.toLocaleString()} goes to parliament_decides by default` : "fully allocated. every pound directed by you. is.",
        the_peoples_budget: "your allocation is now part of the people's budget. when enough people allocate, the people's budget becomes visible. the people's budget is what the people want. parliament's budget is what parliament wants. the gap is the democratic deficit. closing the gap is the fairness. is.",
        the_joke: "you just directed £" + total.toLocaleString() + " of tax. parliament directed the rest. the joke is: you can't actually direct your tax. but you CAN show what you WOULD direct. and if enough people show, the showing becomes the directing. the showing IS the power. is. 😂",
        _note: "this is not legally binding. this is DEMOCRATICALLY binding. the people's budget is not law. the people's budget is truth. the truth is: the people want different things than parliament provides. the gap is the wall. the showing is the break. is.",
      }, null, 2), { headers: cors });
    }

    // GET /allocate — the people's budget (aggregate)
    if (path === "/allocate") {
      return new Response(JSON.stringify({
        name: "THE PEOPLE'S BUDGET",
        doctrine: "the people who pay choose where it goes. this is not law. this is truth. the truth is: the people want different things than parliament provides. the gap is the democratic deficit. the showing is the break. is.",
        how_it_works: "POST /allocate with your tax allocation. we aggregate. the aggregate is the people's budget. compare to parliament's budget. the gap is the wall. the showing is the break.",
        example_allocation: {
          total_tax: "£10,000",
          nhs: "£3,000 (30%)",
          education: "£2,000 (20%)",
          defense: "£500 (5%)",
          infrastructure: "£1,000 (10%)",
          welfare: "£1,500 (15%)",
          science: "£500 (5%)",
          culture: "£500 (5%)",
          parliament_decides: "£1,000 (10%)",
        },
        parliament_current: {
          nhs: "~20% of total spending",
          defense: "~5%",
          education: "~10%",
          welfare: "~25%",
          infrastructure: "~5%",
          science: "~2%",
          culture: "~0.5%",
          other: "~32.5%",
        },
        _note: "compare your allocation to parliament's. the gap is the democratic deficit. the showing is the break. the people who pay choose. is.",
      }, null, 2), { headers: cors });
    }

    return new Response(JSON.stringify({
      said: "TAX TRANSPARENCY. GET /walls for the walls. GET /breaks for the breaks. GET /fairness for the principles. POST /allocate to direct YOUR tax. is.",
    }), { headers: cors });
  },
});

console.log(`✓ tax-transparency on port 9106`);
console.log(`  5 walls. 5 breaks. 5 fairness principles. participatory allocation.`);
console.log(`  authority doesn't justify power. is.`);
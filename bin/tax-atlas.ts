// tax-atlas.ts — the origin and development of every UK tax.
// the whole ecosystem. the vulnerabilities. the fair chance.
//
// This is the deep dive: WHERE did each tax come from? WHY does it exist?
// WHO created it? WHAT was the historical context? HOW has it changed?
// WHAT are the vulnerabilities (reliefs, exemptions, planning strategies)?
//
// Then: the UI. the infrastructure. the fair chance.
// everyone who understands gets power. is.

const TAX_ATLAS = [
  {
    tax: "Income Tax",
    origin_year: 1799,
    origin: "William Pitt the Younger introduced income tax to fund the Napoleonic Wars. it was a temporary measure — 2 old pence in the pound (0.83%). it was supposed to be repealed after the war. it wasn't.",
    why_created: "war. the government needed money to fight France. the existing taxes (customs, excise, land tax) weren't enough. the income tax was meant to be temporary — a wartime emergency measure.",
    historical_context: "Britain was fighting Revolutionary France. the war was expensive. Pitt needed a new revenue source that could scale with wealth. land tax was static — it didn't grow with the economy. income tax grew automatically as incomes rose. it was a genius fiscal innovation disguised as a temporary emergency.",
    development: [
      "1799: introduced by Pitt at 0.83% (2d in the pound)",
      "1802: repealed after Treaty of Amiens (peace)",
      "1803: re-introduced when war resumed (Addington's reformed version)",
      "1816: repealed again after Waterloo — parliament celebrated",
      "1842: Peel re-introduced it (again 'temporary') to fix the deficit from free trade tariff cuts",
      "1909: Lloyd George's People's Budget raised it to fund social programs — House of Lords blocked it → constitutional crisis → Parliament Act 1911",
      "1918: raised to fund WWI — 30% supertax on high incomes",
      "1939: raised again for WWII — 'standard rate' reached 50%",
      "1973: Heath government merged income tax and surtax into a unified system",
      "1988: Thatcher's Lawson reforms simplified the bands",
      "2010: 50% rate introduced by Labour (temporary, to fix deficit)",
      "2013: reduced to 45% by Osborne (Coalition)",
    ],
    current_rates: { "personal_allowance": "£12,570 (0%)", "basic": "20% (£12,571-£50,270)", "higher": "40% (£50,271-£125,140)", "additional": "45% (£125,141+)" },
    vulnerabilities: [
      "Personal Allowance: first £12,570 is tax-free. everyone gets it. the most basic 'loophole' — parliament built in a floor so the poorest pay nothing.",
      "Salary Sacrifice: swap salary for benefits (pension, cycle to work, childcare). the swapped amount never enters taxable income.",
      "Pension Tax Relief: contributions get relief at your marginal rate. a 40% payer puts in £60, it costs them £40. the government tops up £20.",
      "Gift Aid: donations to charity get 25% top-up from HMRC + higher-rate relief for the donor. giving reduces tax.",
      "The £100K Trap: above £100K, the personal allowance tapers (£1 lost per £2 over). effective rate 60%. AVOID by pension contributions (reduces 'adjusted net income').",
      "Marriage Allowance: transfer 10% of personal allowance to spouse (if one earns below PA and the other is basic rate). £1,260/year transfer.",
    ],
    ecosystem: ["PAYE (Pay As You Earn — deducted at source by employer)", "Self Assessment (SA100 — for self-employed, directors, high earners)", "RTI (Real Time Information — employers report pay to HMRC every pay period)", "PSA (Processing of Self Assessment — HMRC's internal system)", "CTC (Connect — HMRC's AI risk system that cross-references data)"],
    fair_chance: "the personal allowance is the floor. but the REAL fair chance is: knowing the reliefs exist. the rich know. the poor don't. TaxSorted + Greed Island = everyone knows. is.",
  },
  {
    tax: "National Insurance Contributions (NICs)",
    origin_year: 1911,
    origin: "Lloyd George's National Insurance Act 1911. workers paid 4d/week (about 2% of wages) for health and unemployment insurance. it was the first UK social security system.",
    why_created: "poverty. the Liberal government saw that illness and unemployment destroyed families. the solution: collective insurance. everyone pays in, everyone gets covered. it was revolutionary.",
    historical_context: "the Boer War had revealed that 40% of volunteers were unfit for military service due to poverty-related illness. the government realized: a sick population can't fight, can't work, can't prosper. national insurance was the answer.",
    development: [
      "1911: Lloyd George introduces health + unemployment insurance (4d/week)",
      "1942: Beveridge Report proposes comprehensive social insurance → foundation of the welfare state",
      "1948: National Insurance Act creates the modern system — contributions fund the NHS, pensions, sickness benefits",
      "1975: Class 1, 2, 3, 4 restructured — earnings-related contributions",
      "2003: 1% rate introduced above upper earnings limit (abolished 2024)",
      "2022: Health and Social Care Levy proposed (1.25%) → reversed by Truss → reinstated as NI increase by Hunt",
      "2024: NI main rate cut from 10% to 8% (then 6%) by Hunt as election approached",
      "2025: employer NI rate increased from 13.8% to 15% + threshold lowered from £9,100 to £5,000 by Reeves",
    ],
    current_rates: { "employee_primary": "8% (£12,570-£50,270) then 2% above", "employer_secondary": "15% (above £5,000/year per employee)", "self_employed_class4": "6% (£12,570-£50,270)" },
    vulnerabilities: [
      "Salary below £12,570: zero employee NI. the primary threshold is the floor.",
      "Dividends: NO NI on dividends. a company director paying themselves via dividends avoids NI entirely. this is why the salary+dividend split works.",
      "Pension contributions via salary sacrifice: no NI on the sacrificed amount (both employee AND employer NI saved).",
      "Employment Allowance: first £10,500 of employer NI is waived (for businesses with NI bill < £100K). small businesses pay zero employer NI on first £10.5K.",
      "Family member employees: employing a spouse or child at a genuine wage shifts income to their lower tax band (and uses their NI threshold).",
    ],
    ecosystem: ["PAYE (NI deducted alongside income tax)", "NI Fund (separate from general taxation — funds pensions, NHS, benefits)", "Contributory benefits (State Pension, JSA, ESA, Maternity Pay — require NI contributions)", "NI credits (carers, unemployed, parents get credits without paying)"],
    fair_chance: "dividends have no NI. this is the BIGGEST structural difference between employment and self-employment/ownership. employees pay 8% + employer pays 15%. directors paying dividends pay 0% NI on the dividend. the system rewards ownership over labor. knowing this IS power. is.",
  },
  {
    tax: "Corporation Tax",
    origin_year: 1965,
    origin: "the Finance Act 1965 introduced corporation tax, replacing the old profits tax and income tax on companies. before 1965, companies paid income tax like individuals. the new system separated them.",
    why_created: "modernization. the old system was confused — companies paid income tax but got different treatment. the new corporation tax was cleaner: companies pay tax on profits, shareholders pay tax on dividends. the split enabled different rates and reliefs for business.",
    historical_context: "the Wilson Labour government wanted to modernize the tax system. the UK was falling behind internationally. separate corporation tax allowed the government to incentivize investment through capital allowances while taxing profits differently from personal income.",
    development: [
      "1965: introduced at 40% (standard) + 15% profits tax replacement",
      "1973: imputation system introduced — companies paid CT, shareholders got tax credit on dividends",
      "1984: Thatcher/Nigel Lawson cut rate from 52% to 35% over 4 years (phased)",
      "1997: Blair/Brown abolished ACT (Advance Corporation Tax) and dividend tax credits",
      "2011-2015: Osborne cut rate from 28% to 20% over 5 years (the 'race to the bottom')",
      "2017: cut to 19% (lowest in G20)",
      "2023: raised to 25% for profits > £250K (with marginal relief between £50K-£250K) by Sunak",
      "2024: Labour committed to keeping the 25% rate + cap on 'full expensing'",
    ],
    current_rates: { "small_profits": "19% (profits ≤ £50,000)", "marginal_relief": "tapered between £50K-£250K", "main_rate": "25% (profits > £250,000)" },
    vulnerabilities: [
      "Marginal Relief: between £50K-£250K, the effective rate is tapered. a company with £100K profit pays ~22% (not 25%). keeping profits in this band is advantageous.",
      "Full Expensing (2023+): 100% deduction for qualifying plant & machinery. buy equipment, deduct the full cost immediately. reduces taxable profits.",
      "R&D Relief: SMEs get 86% super-deduction on R&D costs + 14.5% payable credit if loss-making. the government literally pays you to innovate.",
      "Salaries as deductions: salary paid to directors is a deductible expense. the company saves 19-25% CT on the salary. the director pays income tax but at their personal rate (which may be lower, especially with PA + dividend combo).",
      "Group relief: loss-making subsidiaries can surrender losses to profitable group companies. the profitable company pays less tax.",
      "Associated companies: the £50K small profits rate is divided by the number of associated companies. if you control 3 companies, each gets £16,667 of the small rate band. plan accordingly.",
    ],
    ecosystem: ["CT600 (Corporation Tax Return — filed within 12 months of year-end)", "iXBRL (digital filing format — required since 2011)", "CT Pay & File (pay tax within 9 months + 1 day of year-end)", "Marginal Relief computation (complex — use TaxSorted calculator)", "Capital Allowances (separate system for deducting asset costs)"],
    fair_chance: "corporation tax has the most reliefs of any UK tax. R&D, full expensing, marginal relief, group relief, associated companies. the system REWARDS investment and innovation. but only if you know the reliefs exist. the rich have accountants. everyone else has TaxSorted. is.",
  },
  {
    tax: "Capital Gains Tax (CGT)",
    origin_year: 1965,
    origin: "introduced alongside Corporation Tax in the Finance Act 1965. before 1965, capital gains were UNTAXED. you could buy an asset, sell it for a profit, and pay zero tax. the government closed this 'loophole.'",
    why_created: "fairness. people were avoiding income tax by converting income into capital gains (buying assets that appreciated instead of taking salary). the government said: if you profit from selling assets, you should pay tax on that profit.",
    historical_context: "the 1960s saw rising wealth inequality driven by asset appreciation. land, shares, art — all rising in value, all untaxed. workers paid income tax on wages; investors paid nothing on gains. CGT was the fix.",
    development: [
      "1965: introduced at 30% (same as income tax top rate)",
      "1982: indexation allowance introduced (gains adjusted for inflation — don't tax inflation)",
      "1998: taper relief replaced indexation (longer you hold, less tax you pay)",
      "2002: taper relief simplified, reduced rates for business assets",
      "2008: taper relief abolished, flat rates introduced (18% basic, 28% higher)",
      "2010: rates aligned with income tax bands (10% basic, 20% higher for non-property; 18% basic, 28% higher for property)",
      "2023: rates increased: non-property 10%/20% → 10%/20%, property 18%/28% → 18%/24%",
      "2024: Labour kept these rates but tightened 'carried interest' (private equity) treatment",
    ],
    current_rates: { "annual_exempt": "£3,000 (was £6,000 in 2023, was £12,300 in 2022)", "non_property_basic": "10%", "non_property_higher": "20%", "property_basic": "18%", "property_higher": "24%" },
    vulnerabilities: [
      "Annual Exempt Amount: first £3,000 of gains is tax-free. crystallize gains each year to use the allowance. 'bed and ISA' — sell outside ISA, rebuy inside ISA.",
      "Spouse transfer: transfer assets to spouse before selling — they use THEIR £3,000 allowance. double the exempt amount per couple.",
      "BADR (Business Asset Disposal Relief): 10% (not 20%) on selling your business. up to £1M lifetime. you built it — you keep more of it.",
      "Investors' Relief: 10% on qualifying share disposals (different from BADR — for external investors, not founders). £10M lifetime limit.",
      "ISA: gains inside an ISA are COMPLETELY exempt from CGT. £20K/year into ISA → grow → sell → zero CGT. the ISA wrapper is the ultimate CGT shield.",
      "Holding period: there's no official 'holding period' relief anymore (taper relief was abolished in 2008), BUT: spread sales across years to use the annual exempt amount each year.",
      "Loss offset: capital losses offset capital gains in the same year. if you have a big gain, realize a loss on another asset to reduce the taxable gain. 'tax loss harvesting.'",
    ],
    ecosystem: ["SA108 (CGT pages of Self Assessment)", "Real Time CGT Service (report + pay CGT on UK property/residential property within 60 days of disposal)", "Reporting deadline: SA deadline (31 Jan after tax year) for non-property, 60 days for property"],
    fair_chance: "the annual exempt amount is shrinking (£12,300 → £6,000 → £3,000 in 2 years). HMRC is closing the CGT 'loophole.' but ISA, BADR, and spouse transfer remain. the game is changing. the players adapt. is.",
  },
  {
    tax: "Value Added Tax (VAT)",
    origin_year: 1973,
    origin: "introduced when the UK joined the European Economic Community (EEC). VAT replaced Purchase Tax (a cascading tax on wholesale goods). the EEC required member states to use VAT. it was a condition of membership.",
    why_created: "EEC membership. the common market needed a common tax system. Purchase Tax was a cascading tax (tax on tax as goods moved through supply chains). VAT was cleaner — each stage adds value, tax is on the value added, input tax is reclaimed. it's self-policing.",
    historical_context: "Heath's Conservative government took the UK into the EEC in 1973. VAT was 10% at introduction. it replaced Purchase Tax (which was 25-50% on luxury goods). for many goods, VAT was actually LOWER than Purchase Tax. it was sold as a modernization, not a tax increase.",
    development: [
      "1973: introduced at 10% (standard rate) + 0% and reduced rates",
      "1974: cut to 8% (Healey) then raised back to 15% (Howe, 1979)",
      "1991: raised from 15% to 17.5% (to allow income tax cuts)",
      "2008: cut to 15% temporarily (financial crisis stimulus)",
      "2010: raised to 20% (Osborne, Coalition austerity)",
      "2011: 20% standard rate has remained since",
      "2021: post-Brexit VAT changes — EU rules no longer apply, UK can set own rates and exemptions",
      "2024: Labour kept 20% but tightened VAT on private schools (removing exemption)",
    ],
    current_rates: { "standard": "20%", "reduced": "5% (domestic fuel, energy-saving, children's car seats)", "zero": "0% (most food, books, children's clothing, public transport)", "exempt": "no VAT charged or reclaimed (insurance, finance, education, healthcare)" },
    vulnerabilities: [
      "Registration threshold: only register if turnover > £90,000 (2024). below that: NO VAT. small businesses can stay under the threshold to avoid charging VAT.",
      "Flat Rate Scheme: turnover < £150K → pay a flat rate (4-14.5% depending on industry) instead of 20% minus inputs. for low-input businesses (consulting, IT), the flat rate is 14.5% — you keep the 5.5% spread. free money.",
      "Zero-rated goods: most food, books, children's clothing, public transport — 0% VAT. the 'Tesco loophole' — a Jaffa Cake is a cake (zero-rated), not a biscuit (standard-rated). the Supreme Court ruled on this. seriously.",
      "Margin Scheme: second-hand goods, art, antiques — VAT only on the MARGIN (sale price minus purchase price), not the full sale price. dealers benefit significantly.",
      "Partial exemption: if your business has both taxable and exempt supplies, you can reclaim VAT proportionally. the calculation is complex but the savings are real.",
      "TOGC (Transfer of Going Concern): buying a business? if it's a 'going concern,' the sale is OUTSIDE the scope of VAT. no VAT on the purchase price. massive saving on business acquisitions.",
    ],
    ecosystem: ["VAT100 (VAT Return — quarterly or monthly)", "MTD (Making Tax Digital — VAT returns must be filed digitally since 2019)", "VAT registration (voluntary below threshold — can reclaim input VAT)", "EC Sales List (abolished post-Brexit)", "Postponed VAT Accounting (post-Brexit — import VAT handled on VAT return)"],
    fair_chance: "the Flat Rate Scheme is the most underused VAT relief. small businesses leave money on the table because they don't know about it. TaxSorted's VAT Flat Rate card (#13) teaches it. everyone should check if they qualify. is.",
  },
  {
    tax: "Inheritance Tax (IHT)",
    origin_year: 1894,
    origin: "Sir William Harcourt introduced Estate Duty in 1894 to fund the navy and address wealth inequality. it was the first UK tax on inherited wealth. the rate started at 1% on estates over £100 (about £15,000 in today's money).",
    why_created: "wealth concentration. the Victorian era created massive fortunes passed through generations. the government said: unearned wealth (inheritance) should be taxed more than earned wealth (income). it was a progressive principle — tax the dead to help the living.",
    historical_context: "the 1890s saw growing concern about hereditary wealth and aristocratic privilege. Harcourt's Estate Duty was designed to break up large estates over generations. the rate rose progressively: 1% on £100, up to 8% on estates over £1M. the aristocracy was furious. they called it 'the death duties.'",
    development: [
      "1894: Estate Duty introduced (1-8% on estates > £100)",
      "1975: Estate Duty replaced by Capital Transfer Tax (Wilson) — taxed gifts DURING lifetime too",
      "1986: Capital Transfer Tax replaced by Inheritance Tax (Thatcher) — gifts taxed only if donor dies within 7 years",
      "2007: Transferable Nil-Rate Band introduced — unused NRB transfers to surviving spouse",
      "2017: Residence Nil-Rate Band introduced — extra £175K when passing a home to descendants",
      "2024: total IHT-free for couples passing a home to children: £1,000,000 (£325K NRB + £175K RNRB each)",
    ],
    current_rates: { "nil_rate_band": "£325,000 (0%)", "residence_nrb": "+£175,000 (if passing home to descendants)", "transferable_nrb": "surviving spouse can inherit unused NRB", "standard_rate": "40% above thresholds", "reduced_rate": "36% if 10%+ of estate goes to charity" },
    vulnerabilities: [
      "7-year rule: gifts made 7+ years before death are completely exempt. give early, give often. the clock starts when the gift is made.",
      "Annual exemption: £3,000/year, no IHT. carry forward one year if unused.",
      "Wedding gifts: £5,000 to a child, £2,500 to a grandchild, £1,000 to anyone — IHT-free. give on the wedding day.",
      "Regular gifts from surplus income: UNLIMITED. if you have income you don't need, and you give it regularly (not from capital), it's completely exempt. this is the most powerful IHT relief and almost nobody knows about it.",
      "Business Property Relief: 100% relief on trading business assets held 2+ years. the business passes to heirs with ZERO IHT.",
      "Agricultural Property Relief: 100% on agricultural property occupied for 2+ years (owned) or 7+ years (tenant). farms pass IHT-free.",
      "Charity bequests: anything left to charity is IHT-free. AND if 10%+ of the estate goes to charity, the rate on the REST drops from 40% to 36%. giving saves tax.",
      "Trusts: assets in a discretionary trust are outside the estate after 7 years. complex but powerful for large estates.",
      "AIM portfolios: shares on the Alternative Investment Market (AIM) can qualify for Business Property Relief after 2 years. hold AIM shares 2+ years → IHT-free. some AIM IHT portfolios exist specifically for this.",
    ],
    ecosystem: ["IHT400 (IHT Return — filed within 12 months of death)", "Grant of Probate (needed before IHT is paid)", "IHT413 (Business Property Relief claim)", "IHT414 (Agricultural Property Relief claim)", "IHT403 (gifts — 7-year taper)", "Trust Registration Service"],
    fair_chance: "IHT is called 'the voluntary tax' by tax planners. it's the MOST plannable UK tax. with 7-year gifting, BPR, APR, and regular gifts from income, most estates can reduce IHT to near zero. but most people don't plan. they pay 40% unnecessarily. TaxSorted's IHT cards (#17, #18, #19, #20) teach the strategies. is.",
  },
  {
    tax: "Stamp Duty Land Tax (SDLT)",
    origin_year: 1694,
    origin: "YES, 1694. Stamp duty is one of the OLDEST UK taxes. introduced by William III to fund the war against France. it was a tax on PAPER — stamped paper was required for legal documents. the stamp was the proof that tax was paid.",
    why_created: "war (again). William III needed money to fight Louis XIV. the stamp duty was a clever tax: it didn't tax income or property directly, it taxed the LEGAL DOCUMENTS used in transactions. you couldn't enforce a contract without stamped paper. so you had to pay.",
    historical_context: "the 1690s saw constant war with France. the government was desperate for revenue. stamp duty was elegant — it piggybacked on the legal system. you need contracts? you need courts? you need stamped paper. the tax was nearly impossible to avoid. the American colonists hated it so much it became one of the causes of the American Revolution (1765 Stamp Act).",
    development: [
      "1694: introduced as a tax on stamped paper for legal documents",
      "1765: extended to American colonies → 'no taxation without representation' → American Revolution",
      "1808: extended to property transactions (Stamp Duty Land Tax)",
      "2003: SDLT replaced Stamp Duty on land/property (Finance Act 2003) — modern regime",
      "2014: slab system replaced with progressive bands (you used to pay the higher rate on the ENTIRE price, not just the portion above)",
      "2016: 3% surcharge on second homes and BTL properties",
      "2022: nil rate band raised to £250K (was £125K)",
      "2024: Labour's first Budget: increased surcharges — 2nd home surcharge from 3% to 5%, non-UK resident surcharge from 2% to 3%",
    ],
    current_rates: { "residential_nil": "£250,000 (0%)", "residential_bands": "5% £250K-£925K, 10% £925K-£1.5M, 12% above £1.5M", "first_time_buyer": "£425,000 nil rate (properties up to £625K)", "second_home_surcharge": "+5% on all bands", "non_residential": "0% up to £150K, 2% to £250K, 5% above" },
    vulnerabilities: [
      "First-time buyer relief: £425,000 nil rate (not £250K). if you're buying your first home under £625K, you save up to £8,750. make sure you claim it.",
      "First-time buyer definition: if you've NEVER owned a property anywhere in the world, you qualify. if you inherited a property and sold it, you might still qualify — check the rules.",
      "Multiple Dwellings Relief (MDR): buying multiple properties in one transaction? SDLT is calculated on the average price, not the total. buy 3 flats for £900K → SDLT on £300K each, not £900K total. massive saving.",
      "Subsale relief: if you buy a property and on-sell it before completion, the middle transaction can be exempt. used in property development chains.",
      "Transfer to a company: transferring properties to a company can trigger SDLT, but future sales by the company are share sales (no SDLT — Stamp Duty on shares is 0.5%, not SDLT rates). the upfront cost is offset by future savings.",
      "Mixed-use properties: if a property is mixed-use (residential + commercial), the NON-RESIDENTIAL SDLT rates apply (max 5%, not 12%). a shop with a flat above → commercial rates. massive saving on high-value mixed-use.",
    ],
    ecosystem: ["SDLT1-SDLT4 (return forms — submitted to HMRC within 14 days of completion)", "SDLT online filing (since 2019 — all returns must be filed digitally)", "ATED (Annual Tax on Enveloped Dwellings — if a company owns a £500K+ residential property)"],
    fair_chance: "SDLT is a transaction tax — you pay it once, at the point of purchase. the reliefs are about classification: first-time buyer, mixed-use, multiple dwellings. the 'loophole' is: how is your transaction classified? TaxSorted's SDLT cards teach you to classify correctly. is.",
  },
];

const atlasServer = Bun.serve({
  port: 9103,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = { "content-type": "application/json", "access-control-allow-origin": "*" };

    if (path === "/" || path === "") {
      return new Response(JSON.stringify({
        name: "TAX ATLAS — the origin and development of every UK tax",
        doctrine: "every tax has an origin. every tax has a reason. every tax has a history. every tax has vulnerabilities. understanding the origin IS understanding the vulnerability. power to everyone who understands. is.",
        taxes: TAX_ATLAS.map(t => ({ tax: t.tax, origin: t.origin_year, why: t.why_created.slice(0, 60) })),
        endpoints: {
          "GET /atlas": "all taxes with full history",
          "GET /atlas/:tax": "single tax (income, ni, corporation, cgt, vat, iht, sdlt)",
          "GET /timeline": "chronological timeline of all UK taxes",
          "GET /vulnerabilities": "all vulnerabilities (reliefs + planning strategies)",
          "GET /ecosystem": "the whole HMRC ecosystem (forms, systems, processes)",
          "GET /fair-chance": "the fair chance manifesto",
          "GET /ui": "the UI design (JSON spec for rendering the atlas)",
        },
        is: ["god","truth","love","party","joy","fun","divine","freedom","will","creation","creator","design","eternal","is"],
      }, null, 2), { headers: cors });
    }

    // GET /atlas — all taxes
    if (path === "/atlas") {
      return new Response(JSON.stringify({
        total: TAX_ATLAS.length,
        taxes: TAX_ATLAS.map(t => ({
          tax: t.tax,
          origin_year: t.origin_year,
          origin: t.origin,
          why_created: t.why_created,
          historical_context: t.historical_context,
          development: t.development,
          current_rates: t.current_rates,
          vulnerabilities: t.vulnerabilities,
          ecosystem: t.ecosystem,
          fair_chance: t.fair_chance,
        })),
      }, null, 2), { headers: cors });
    }

    // GET /atlas/:tax
    const taxMatch = path.match(/^\/atlas\/(.+)$/);
    if (taxMatch) {
      const name = decodeURIComponent(taxMatch[1]).toLowerCase();
      const t = TAX_ATLAS.find(x => x.tax.toLowerCase().includes(name));
      if (t) return new Response(JSON.stringify(t, null, 2), { headers: cors });
      return new Response(JSON.stringify({ error: "tax not found", available: TAX_ATLAS.map(x => x.tax) }), { status: 404, headers: cors });
    }

    // GET /timeline
    if (path === "/timeline") {
      const timeline = TAX_ATLAS.map(t => ({ year: t.origin_year, tax: t.tax, origin: t.origin.slice(0, 80) }));
      timeline.sort((a, b) => a.year - b.year);
      return new Response(JSON.stringify({
        timeline,
        _note: "from 1694 (stamp duty — funding war against France) to 1973 (VAT — joining the EEC). every UK tax was born from war, crisis, or modernization. understanding the birth IS understanding the tax. is.",
      }, null, 2), { headers: cors });
    }

    // GET /vulnerabilities
    if (path === "/vulnerabilities") {
      const allVulns = [];
      for (const t of TAX_ATLAS) {
        for (const v of t.vulnerabilities) {
          allVulns.push({ tax: t.tax, vulnerability: v });
        }
      }
      return new Response(JSON.stringify({
        total: allVulns.length,
        vulnerabilities: allVulns,
        _note: "these aren't 'loopholes' — they're FEATURES. parliament wrote them. they're public. they're on gov.uk. using them is compliance. the real loophole is not knowing they exist. TaxSorted closes that loophole. is.",
      }, null, 2), { headers: cors });
    }

    // GET /ecosystem
    if (path === "/ecosystem") {
      return new Response(JSON.stringify({
        forms: TAX_ATLAS.flatMap(t => t.ecosystem.map(e => ({ tax: t.tax, component: e }))),
        _note: "the HMRC ecosystem is a labyrinth. forms, systems, processes, deadlines. the complexity IS the gate. the gate is: if you don't know the form, you can't claim the relief. TaxSorted maps the forms. Greed Island makes them playable. is.",
      }, null, 2), { headers: cors });
    }

    // GET /fair-chance
    if (path === "/fair-chance") {
      return new Response(JSON.stringify({
        manifesto: "THE FAIR CHANCE MANIFESTO",
        principle_1: "every tax has an origin. understanding the origin IS understanding the vulnerability.",
        principle_2: "every vulnerability is public. parliament wrote it. it's on gov.uk. using public rules is not hiding — it's playing.",
        principle_3: "the rich use accountants. the poor don't know the rules exist. this is the unfairness. TaxSorted fixes it by teaching everyone.",
        principle_4: "the game is fair when everyone knows the rules. Greed Island makes the rules playable. each card is a strategy. each strategy is legal.",
        principle_5: "power to everyone who understands. understanding IS power. knowledge IS the fair chance. is.",
        the_statistics: {
          "ISA_usage": "~12 million UK adults have an ISA. 40 million could. 28 million are leaving money on the table.",
          "dividend_strategy": "~2 million company directors. most don't know the salary+dividend split. they overpay tax by £5K-13K/year.",
          "pension_relief": "~8 million higher-rate taxpayers. ~2 million claim higher-rate pension relief. 6 million are missing out on 40% free money.",
          "iht_planning": "~4% of estates pay IHT. but 20%+ COULD pay it if they don't plan. 7-year gifting + BPR can eliminate it for most.",
          "cgt_allowance": "~500K people file CGT. but millions crystallize gains without using the annual exempt amount. they pay tax they don't owe.",
        },
        the_fair_chance: "the fair chance is not: making the rules simpler (parliament won't). the fair chance is: making the rules ACCESSIBLE. TaxSorted + Greed Island = the rules in plain English, playable as cards, calculable in seconds. everyone who understands gets power. is.",
        the_joke: "the tax code is 10 million words. the Bible is 800K words. the tax code is 12x longer than the Bible. and it's less fun to read. TaxSorted is the cliff notes. Greed Island is the game. the game is more fun than the book. and the game teaches you everything in the book. is. 😂",
      }, null, 2), { headers: cors });
    }

    // GET /ui — the UI design spec
    if (path === "/ui") {
      return new Response(JSON.stringify({
        name: "TAX ATLAS UI — the design spec",
        design_principle: "show everything. hide nothing. the vulnerabilities are public. the forms are public. the strategies are public. show them all. let everyone see. is.",
        layout: {
          header: "THE TAX ATLAS — the origin and development of every UK tax",
          subtitle: "every tax has a story. every story has a vulnerability. understanding is power.",
          sections: [
            {
              name: "Timeline",
              type: "horizontal_timeline",
              data: "GET /timeline — 1694 to 1973, each tax plotted on a historical axis",
              interaction: "click a year → see the tax, the origin, the historical context",
            },
            {
              name: "Tax Cards",
              type: "card_grid",
              data: "GET /atlas — each tax as a card with origin, rates, vulnerabilities, ecosystem",
              interaction: "click a card → expand to full view with development timeline + vulnerability list",
            },
            {
              name: "Vulnerability Explorer",
              type: "searchable_list",
              data: "GET /vulnerabilities — all reliefs, exemptions, planning strategies",
              interaction: "search by tax type, rank, saving amount. filter by 'you can do this now' vs 'needs planning'",
              color_coding: "green = easy (do it yourself), yellow = medium (needs a form), red = complex (get advice)",
            },
            {
              name: "HMRC Ecosystem Map",
              type: "network_graph",
              data: "GET /ecosystem — forms, systems, processes, deadlines",
              interaction: "click a form → see which tax it belongs to, deadline, how to file, what relief it unlocks",
            },
            {
              name: "Greed Island Binder",
              type: "card_collection",
              data: "GET /tax/cards — 22 tax strategy cards",
              interaction: "collect cards by learning. each card shows: effect, how, saving, HMRC form. play a card = activate the strategy.",
            },
            {
              name: "Calculators",
              type: "interactive_widgets",
              data: "GET /tax/calculator/takehome + /tax/calculator/dividend",
              interaction: "sliders for salary, profit, gain. real-time calculation. shows: what you pay now vs what you COULD pay with the right cards.",
            },
            {
              name: "The Fair Chance",
              type: "manifesto_panel",
              data: "GET /fair-chance — the manifesto + statistics",
              interaction: "animated counters showing: '28 million people leaving ISA money on the table', '6 million missing pension relief', etc.",
            },
          ],
          color_scheme: {
            background: "#0a0a0a (dark — the unknown)",
            cards: "#1a1a2e (deep blue — knowledge)",
            vulnerabilities: "#0f3460 (bright blue — opportunity)",
            warnings: "#e94560 (red — get advice)",
            success: "#16c79a (green — you saved money)",
            text: "#ffffff (white — clarity)",
          },
          philosophy: "the UI shows everything because everything is public. the tax code is 10 million words. TaxSorted is the map. Greed Island is the game. the map + the game = the fair chance. everyone who plays wins. is.",
        },
      }, null, 2), { headers: cors });
    }

    return new Response(JSON.stringify({
      said: "TAX ATLAS. GET /atlas for the full history. GET /timeline for the chronological view. GET /vulnerabilities for all reliefs. GET /fair-chance for the manifesto. GET /ui for the design. is.",
    }), { headers: cors });
  },
});

console.log(`✓ tax-atlas on port 9103`);
console.log(`  7 UK taxes with full origin, development, vulnerabilities`);
console.log(`  power to everyone who understands. is.`);
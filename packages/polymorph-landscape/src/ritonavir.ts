import { LESSON_LANGUAGES } from "./constants.js";
import { deepFreeze } from "./canonical.js";
import { fail } from "./errors.js";
import { createPolymorphLandscape, validatePolymorphLandscape } from "./landscape.js";
import { projectPolymorphLesson } from "./projection.js";
import { createPolymorphReachabilityShift } from "./reachability-shift.js";
import type {
  PolymorphLandscape,
  PolymorphLesson,
  PolymorphReachabilityShift,
  Sha256Id,
} from "./types.js";

export function createRitonavirLandscape(): Readonly<PolymorphLandscape> {
  return createPolymorphLandscape({
    material: { key: "ritonavir", label: "ritonavir" },
    sources: [
      {
        key: "bauer_2001",
        label: "Bauer et al. 2001, Ritonavir: An Extraordinary Example of Conformational Polymorphism",
        kind: "peer_reviewed_primary",
        url: "https://doi.org/10.1023/A:1011052932607",
        published_year: 2001,
      },
      {
        key: "chemburkar_2000",
        label: "Chemburkar et al. 2000, Dealing with the Impact of Ritonavir Polymorphs",
        kind: "peer_reviewed_primary",
        url: "https://doi.org/10.1021/op000023y",
        published_year: 2000,
      },
      {
        key: "ema_1998",
        label: "European Medicines Agency 1998 public statement on Norvir hard-capsule supply",
        kind: "official_regulatory",
        url: "https://www.ema.europa.eu/en/news/public-statement-supply-norvir-hard-capsules",
        published_year: 1998,
      },
      {
        key: "fda_1999",
        label: "US FDA 1999 Norvir administrative review",
        kind: "official_regulatory",
        url: "https://www.accessdata.fda.gov/drugsatfda_docs/nda/99/20-945.pdf_Ritonovir_Admindocs.pdf",
        published_year: 1999,
      },
      {
        key: "morissette_2003",
        label: "Morissette et al. 2003, Elucidation of crystal form diversity of ritonavir",
        kind: "peer_reviewed_primary",
        url: "https://doi.org/10.1073/pnas.0437744100",
        published_year: 2003,
      },
      {
        key: "sacchi_2024",
        label: "Sacchi et al. 2024, Disappearance and reappearance of ritonavir polymorphs in the mill",
        kind: "peer_reviewed_primary",
        url: "https://doi.org/10.1073/pnas.2319127121",
        published_year: 2024,
      },
      {
        key: "wang_2024",
        label: "Wang et al. 2024, Solvent selection and ritonavir polymorphic selectivity",
        kind: "peer_reviewed_primary",
        url: "https://doi.org/10.1021/acs.molpharmaceut.4c00234",
        published_year: 2024,
      },
      {
        key: "yao_2023",
        label: "Yao et al. 2023, anhydrous ritonavir Form III report",
        kind: "peer_reviewed_primary",
        url: "https://doi.org/10.1016/j.xphs.2022.09.026",
        published_year: 2023,
      },
    ],
    forms: [
      {
        key: "bulk_form_i_process_input",
        label: "Abbott bulk Form-I process input/state",
        kind_reported: "other",
        description: "A source-scoped input/state for the former routine bulk-drug Form-I route; separate from the hydroalcoholic semisolid hard-capsule fill and not an assertion of one crystalline starting form.",
        source_keys: ["chemburkar_2000"],
      },
      {
        key: "form_i_abbott",
        label: "Form I (Abbott 2000/2001 naming)",
        kind_reported: "polymorph",
        description: "The originally developed crystalline form; the label is scoped to the Abbott process and structure papers.",
        source_keys: ["bauer_2001", "chemburkar_2000"],
      },
      {
        key: "form_ii_abbott",
        label: "Form II (Abbott 2000/2001 naming)",
        kind_reported: "polymorph",
        description: "The later-observed crystalline form reported as more stable and much less soluble under the tested formulation conditions.",
        source_keys: ["bauer_2001", "chemburkar_2000"],
      },
      {
        key: "form_iii_anhydrous_yao_2023",
        label: "Form III (Yao 2023 anhydrous-polymorph naming)",
        kind_reported: "polymorph",
        description: "An anhydrous polymorph whose source-scoped label must not be merged with Morissette's 2003 Form III solvate.",
        source_keys: ["yao_2023"],
      },
      {
        key: "form_iii_solvate_morissette_2003",
        label: "Form III (Morissette 2003 formamide-solvate naming)",
        kind_reported: "solvate",
        description: "A formamide solvate in the 2003 paper's naming; not the later anhydrous polymorph also called Form III.",
        source_keys: ["morissette_2003"],
      },
      {
        key: "form_v_hydrate_morissette_2003",
        label: "Form V (Morissette 2003 hydrate naming)",
        kind_reported: "hydrate",
        description: "A hydrate intermediate in the 2003 reported Form-I recovery route.",
        source_keys: ["morissette_2003"],
      },
      {
        key: "hydroalcoholic_solution",
        label: "Ritonavir hydroalcoholic semisolid solution",
        kind_reported: "other",
        description: "The dissolved-drug state used in the original hard-capsule fill; not a capsule of Form-I crystals.",
        source_keys: ["bauer_2001", "chemburkar_2000"],
      },
    ],
    conditions: [
      {
        key: "ball_milling_form_i_conditions_2024",
        label: "2024 Form-I-selective milling conditions",
        kind: "mechanical_process",
        description: "Liquid, time, particle-size, shape, and mechanical conditions reported to select Form I in the cited milling study.",
      },
      {
        key: "ball_milling_form_ii_conditions_2024",
        label: "2024 Form-II-selective milling conditions",
        kind: "mechanical_process",
        description: "A different named milling regime reported to select Form II; not a universal direction of conversion.",
      },
      {
        key: "formamide_solvate_wash_2003",
        label: "2003 formamide-solvate, hydrate, and wash route",
        kind: "solvent_process",
        description: "The source-specific solvent and washing conditions reported to recover Form I through intermediate solid forms.",
      },
      {
        key: "hydroalcoholic_fill_1998",
        label: "1998 hydroalcoholic semisolid capsule fill",
        kind: "formulation",
        description: "The then-current supersaturated formulation context in which Form-II crystallization caused dissolution failures.",
      },
      {
        key: "old_form_i_bulk_route_after_form_ii",
        label: "Former Form-I bulk route after Form-II emergence",
        kind: "manufacturing_process",
        description: "The prior routine preparation environment after Form II had entered laboratory and production areas.",
      },
      {
        key: "reverse_addition_superseeding",
        label: "Controlled reverse addition and Form-I superseeding",
        kind: "solvent_process",
        description: "A changed, controlled route reported to produce Form I from Form-II-containing material.",
      },
      {
        key: "solubility_85_15_ethanol_water_5c",
        label: "Solubility measurement in 85:15 ethanol/water at 5 °C",
        kind: "measurement",
        description: "A specific measurement condition; its numerical ratio is not treated as a universal constant.",
      },
    ],
    witnesses: [
      {
        key: "commercial_form_i_before_1998",
        kind: "reported_history",
        status: "reported_primary",
        statement: "Abbott reported routine Form-I bulk production before the 1998 Form-II event.",
        scope: "Abbott process history before Form-II identification",
        source_keys: ["chemburkar_2000"],
      },
      {
        key: "cyclic_carbamate_possible_seed",
        kind: "mechanism_hypothesis",
        status: "hypothesized_primary",
        statement: "A cyclic-carbamate degradant could seed Form II in a sensitive test and was proposed as a possible source, not established as the historical trigger.",
        scope: "experimental seed test and bounded causal hypothesis",
        source_keys: ["bauer_2001"],
      },
      {
        key: "fda_reformulation_accepts_either_form",
        kind: "regulatory_record",
        status: "reported_primary",
        statement: "The FDA administrative record describes a reformulated soft elastic capsule designed to accommodate either Form I or Form II.",
        scope: "1999 US regulatory review of the reformulated capsule",
        source_keys: ["fda_1999"],
      },
      {
        key: "form_i_not_reproduced_by_old_route",
        kind: "process_observation",
        status: "reported_primary",
        statement: "After Form II entered the process environment, the former routine route no longer reliably reproduced Form I until a controlled changed process was developed.",
        scope: "reported Abbott laboratory and bulk-drug process experience",
        source_keys: ["chemburkar_2000"],
      },
      {
        key: "form_i_recovered_by_milling",
        kind: "recovery_observation",
        status: "measured_primary",
        statement: "Controlled milling experiments reproducibly selected Form I or Form II in different regimes, with size, shape, liquid, time, and conformation affecting direction.",
        scope: "2024 laboratory mechanochemistry conditions",
        source_keys: ["sacchi_2024"],
      },
      {
        key: "form_i_recovered_by_reverse_addition",
        kind: "recovery_observation",
        status: "reported_primary",
        statement: "Complete dissolution, controlled handling, reverse addition, and Form-I superseeding produced Form I from Form-II-containing material.",
        scope: "Abbott controlled bulk process reported in 2000",
        source_keys: ["chemburkar_2000"],
      },
      {
        key: "form_i_recovered_through_solvate_hydrate",
        kind: "recovery_observation",
        status: "measured_primary",
        statement: "A formamide solvate and hydrate sequence followed by washing yielded Form I in the 2003 high-throughput study.",
        scope: "source-specific 2003 solvent and washing conditions",
        source_keys: ["morissette_2003"],
      },
      {
        key: "form_ii_appearance_and_dissolution_failures",
        kind: "reported_history",
        status: "reported_primary",
        statement: "In mid-1998, Form II crystallization was identified after some semisolid capsule lots failed dissolution; affected lots were detected before release.",
        scope: "Abbott process account and contemporaneous European regulatory statement",
        source_keys: ["chemburkar_2000", "ema_1998"],
      },
      {
        key: "form_ii_solubility_and_stability",
        kind: "measurement",
        status: "measured_primary",
        statement: "Under the reported formulation and measurement conditions, Form II was more stable and substantially less soluble than Form I; at 5 °C in 85:15 ethanol/water the reported solubilities were 61 and 294 mg/mL respectively.",
        scope: "condition-specific Abbott measurements, not a universal ratio",
        source_keys: ["bauer_2001"],
      },
      {
        key: "later_anhydrous_form_iii",
        kind: "measurement",
        status: "measured_primary",
        statement: "Later work used Form III for an anhydrous polymorph, distinct from the 2003 paper's Form III formamide solvate.",
        scope: "source-scoped nomenclature comparison",
        source_keys: ["morissette_2003", "yao_2023"],
      },
      {
        key: "origin_and_personnel_transfer_unresolved",
        kind: "reported_history",
        status: "reported_primary",
        statement: "The timing of Form II at the Italy site after a personnel visit and the original nucleation source were reported as debatable or unknown, not proven global airborne transmission.",
        scope: "historical causation remains unresolved",
        source_keys: ["chemburkar_2000"],
      },
      {
        key: "solvent_changes_selectivity",
        kind: "measurement",
        status: "measured_primary",
        statement: "Later experiments reported that solvent selection and supersaturation influence ritonavir crystallizability and polymorphic selectivity.",
        scope: "2024 laboratory solvent-screening conditions",
        source_keys: ["wang_2024"],
      },
    ],
    routes: [
      {
        key: "form_i_to_form_ii_by_milling_2024",
        from_form_key: "form_i_abbott",
        to_form_key: "form_ii_abbott",
        condition_keys: ["ball_milling_form_ii_conditions_2024"],
        witness_keys: ["form_i_recovered_by_milling"],
        status: "converted_reported",
        barrier_reported: "present_reported",
        template_reported: "not_reported",
      },
      {
        key: "form_ii_to_form_i_by_milling_2024",
        from_form_key: "form_ii_abbott",
        to_form_key: "form_i_abbott",
        condition_keys: ["ball_milling_form_i_conditions_2024"],
        witness_keys: ["form_i_recovered_by_milling"],
        status: "converted_reported",
        barrier_reported: "present_reported",
        template_reported: "not_reported",
      },
      {
        key: "form_ii_to_form_i_reverse_addition",
        from_form_key: "form_ii_abbott",
        to_form_key: "form_i_abbott",
        condition_keys: ["reverse_addition_superseeding"],
        witness_keys: ["form_i_recovered_by_reverse_addition"],
        status: "converted_reported",
        barrier_reported: "present_reported",
        template_reported: "present_reported",
      },
      {
        key: "form_v_hydrate_to_form_i_2003",
        from_form_key: "form_v_hydrate_morissette_2003",
        to_form_key: "form_i_abbott",
        condition_keys: ["formamide_solvate_wash_2003"],
        witness_keys: ["form_i_recovered_through_solvate_hydrate"],
        status: "converted_reported",
        barrier_reported: "not_reported",
        template_reported: "not_reported",
      },
      {
        key: "old_route_to_form_i_after_form_ii",
        from_form_key: "bulk_form_i_process_input",
        to_form_key: "form_i_abbott",
        condition_keys: ["old_form_i_bulk_route_after_form_ii"],
        witness_keys: ["form_i_not_reproduced_by_old_route"],
        status: "not_reproduced_reported",
        barrier_reported: "unknown",
        template_reported: "not_established",
      },
      {
        key: "semisolid_solution_to_form_ii_1998",
        from_form_key: "hydroalcoholic_solution",
        to_form_key: "form_ii_abbott",
        condition_keys: ["hydroalcoholic_fill_1998"],
        witness_keys: ["form_ii_appearance_and_dissolution_failures"],
        status: "produced_reported",
        barrier_reported: "unknown",
        template_reported: "not_established",
      },
      {
        key: "solvate_to_hydrate_2003",
        from_form_key: "form_iii_solvate_morissette_2003",
        to_form_key: "form_v_hydrate_morissette_2003",
        condition_keys: ["formamide_solvate_wash_2003"],
        witness_keys: ["form_i_recovered_through_solvate_hydrate"],
        status: "converted_reported",
        barrier_reported: "not_reported",
        template_reported: "not_reported",
      },
    ],
    stability_reports: [
      {
        key: "form_ii_over_form_i_tested_conditions",
        preferred_form_key: "form_ii_abbott",
        compared_form_key: "form_i_abbott",
        condition_keys: ["hydroalcoholic_fill_1998", "solubility_85_15_ethanol_water_5c"],
        witness_keys: ["form_ii_solubility_and_stability"],
      },
    ],
    open_conditions: [
      {
        key: "historical_origin_of_form_ii",
        question: "What first nucleated historical Form II in 1998? The package preserves this as unresolved.",
        witness_keys: ["cyclic_carbamate_possible_seed", "origin_and_personnel_transfer_unresolved"],
      },
      {
        key: "source_scoped_form_numbering",
        question: "Which source and solid-state kind does a reused form number denote? Labels are never merged by number alone.",
        witness_keys: ["later_anhydrous_form_iii"],
      },
    ],
  });
}

export function createRitonavirReachabilityShift(
  landscapeValue: PolymorphLandscape = createRitonavirLandscape(),
): Readonly<PolymorphReachabilityShift> {
  const landscape = validatePolymorphLandscape(landscapeValue);
  const form = (key: string): Sha256Id => find(landscape.forms, key, "form").form_ref;
  const condition = (key: string): Sha256Id => find(landscape.conditions, key, "condition").condition_ref;
  const witness = (key: string): Sha256Id => find(landscape.witnesses, key, "witness").witness_ref;
  const route = (key: string): Sha256Id => find(landscape.routes, key, "route").route_ref;
  const open = (key: string): Sha256Id => find(landscape.open_conditions, key, "open condition").open_condition_ref;
  return createPolymorphReachabilityShift(landscape, {
    prior_form_ref: form("form_i_abbott"),
    emergent_form_ref: form("form_ii_abbott"),
    condition_refs: [condition("old_form_i_bulk_route_after_form_ii")],
    before_witness_refs: [witness("commercial_form_i_before_1998")],
    appearance_witness_refs: [witness("form_i_not_reproduced_by_old_route"), witness("form_ii_appearance_and_dissolution_failures")],
    later_witness_refs: [witness("form_i_recovered_by_milling"), witness("form_i_recovered_by_reverse_addition"), witness("form_i_recovered_through_solvate_hydrate")],
    same_condition_return: "not_established",
    changed_condition_recovery_route_refs: [
      route("form_ii_to_form_i_by_milling_2024"),
      route("form_ii_to_form_i_reverse_addition"),
      route("form_v_hydrate_to_form_i_2003"),
    ],
    open_condition_refs: [open("historical_origin_of_form_ii")],
  });
}

export function createRitonavirCase(): Readonly<{
  landscape: Readonly<PolymorphLandscape>;
  shift: Readonly<PolymorphReachabilityShift>;
  lessons: readonly Readonly<PolymorphLesson>[];
}> {
  const landscape = createRitonavirLandscape();
  const shift = createRitonavirReachabilityShift(landscape);
  const lessons = LESSON_LANGUAGES.map((language) => projectPolymorphLesson(landscape, shift, { language }));
  return deepFreeze({ landscape, shift, lessons });
}

function find<T extends { readonly key: string }>(values: readonly T[], key: string, kind: string): T {
  const value = values.find((entry) => entry.key === key);
  if (!value) fail("unknown_reference", `ritonavir atlas lacks ${kind} key ${key}`);
  return value;
}

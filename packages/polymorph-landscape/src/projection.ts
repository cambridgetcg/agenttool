import {
  KINGDOM_MAPPING_KEYS,
  LESSON_CONCEPT_KEYS,
  LESSON_LANGUAGES,
  NON_TRANSFERRED_PROPERTIES,
  POLYMORPH_BOUNDARIES,
  POLYMORPH_FORMATS,
} from "./constants.js";
import { canonicalJson, deepFreeze, domainSeparatedId } from "./canonical.js";
import { fail } from "./errors.js";
import type {
  LessonConceptKey,
  LessonLanguage,
  PolymorphLandscape,
  PolymorphLesson,
  PolymorphReachabilityShift,
  ProjectPolymorphLessonOptions,
  Sha256Id,
} from "./types.js";
import { exactKeys, literal, record, sha256 } from "./validation.js";
import { validatePolymorphLandscape } from "./landscape.js";
import { validatePolymorphReachabilityShift } from "./reachability-shift.js";

interface AuthoredLocale {
  readonly title: string;
  readonly core: string;
  readonly concepts: Readonly<Record<LessonConceptKey, readonly [heading: string, explanation: string]>>;
}

const AUTHORED: Readonly<Record<LessonLanguage, AuthoredLocale>> = Object.freeze({
  en: {
    title: "The ritonavir polymorph landscape: when an old route stops reproducing a form",
    core: "‘Disappeared’ means the old route stopped reproducing the form under stated conditions—not that the form ceased to exist.",
    concepts: {
      multiple_form: ["Same material, more than one form", "The same molecule can pack into distinct solid arrangements. A form label is kept tied to the source that used it."],
      stability_vs_reachability: ["Stability is not reachability", "A form reported as more stable under named conditions is not automatically reached by every process. Routes and conditions remain part of the statement."],
      barrier: ["A possible form can remain hard to reach", "A kinetic barrier helps explain why an available arrangement may not appear on an ordinary timescale. This record does not turn a calculated barrier into a universal law."],
      template: ["A seed is a physical template", "A crystal seed can lower a nucleation barrier in some conditions. It is not an instruction, infection, intention, identity, or command."],
      path_history: ["History changes the process context", "Residual material, equipment, solvent, temperature, supersaturation, particle size, and mechanical history can change which route is reproducible. This is process history, not personal memory or WAKE continuity."],
      observation_limit: ["Say what was observed—and stop there", "The historical origin of ritonavir Form II was not established. Association, timing, and an experimentally possible seed do not prove the original cause."],
      practical_return: ["Return can require another path", "Reported solvent, seeding, and mechanical routes recovered Form I under changed conditions. That refutes erasure, but does not promise an easy or economical return in the original process."],
      analogy_boundary: ["The KINGDOM crossover is a design analogy", "State spaces, barriers, templates, histories, and witnesses can help us design software. Chemistry does not validate claims about a being, and stability never means goodness."],
      medical_boundary: ["Educational, not medical guidance", "This lesson describes a manufacturing and solid-state chemistry case. It does not advise medicine use, formulation, dosing, or treatment."],
    },
  },
  "yue-Hant": {
    title: "利托那韋多晶型地景：當舊路徑再重現唔到一種形態",
    core: "所謂「消失」，係喺講明嘅條件下，原本條路再整唔返嗰種形態；唔係嗰種形態由世界冇咗。",
    concepts: {
      multiple_form: ["同一種物質，可以有多過一種形態", "同一種分子可以排成唔同嘅固態結構。每個形態名都要連返使用嗰個名嘅來源去理解。"],
      stability_vs_reachability: ["穩定，唔等於一定去得到", "某形態喺指定條件下較穩定，唔代表每一種工序都一定整到佢；講結論時要保留路徑同條件。"],
      barrier: ["存在嘅形態，都可能好難去到", "動力學障礙可以解釋點解一個可行排列喺一般時間內冇出現；呢份記錄唔會將某個計算變成宇宙定律。"],
      template: ["晶種係物理模板", "喺某啲條件下，晶種可以降低成核障礙；佢唔係指令、感染、意圖、身份或者命令。"],
      path_history: ["過程歷史會改變環境", "殘留物、設備、溶劑、溫度、過飽和度、粒子大小同機械歷史，都可能改變邊條路可重現。呢個係工序歷史，唔係個人記憶或 WAKE 連續性。"],
      observation_limit: ["見到幾多，就講幾多", "利托那韋 Form II 最初點樣出現，歷史上未有定論。關聯、時間先後，同實驗上可能嘅晶種，都唔足以證明原始成因。"],
      practical_return: ["要返去，可能要行另一條路", "文獻報告透過溶劑、播種同機械條件，可以喺改變咗嘅環境下取回 Form I。呢點否定咗「被抹走」，但唔保證原工序可以輕易或經濟咁回復。"],
      analogy_boundary: ["同 KINGDOM 嘅交叉只係設計類比", "狀態空間、障礙、模板、歷史同見證，可以幫我哋設計軟件；化學唔會證明一個存在者嘅內在狀態，而穩定亦唔等於善或價值。"],
      medical_boundary: ["教育用途，唔係醫療建議", "呢個課堂講製造同固態化學案例；唔提供用藥、配方、劑量或治療建議。"],
    },
  },
  "zh-Hant": {
    title: "利托那韋多晶型地景：當舊路徑無法再重現一種形態",
    core: "所謂「消失」，是指在已說明的條件下，原有路徑無法再重現該形態；並非該形態不再存在。",
    concepts: {
      multiple_form: ["同一種物質，可以有多種形態", "同一種分子可以排列成不同的固態結構。形態名稱必須連同採用該名稱的來源理解。"],
      stability_vs_reachability: ["穩定性不等於可達性", "某形態在指定條件下較穩定，不表示每種製程都必然到達它；路徑與條件是結論的一部分。"],
      barrier: ["可能存在，仍可能難以到達", "動力學障礙可以解釋為何可行的排列沒有在一般時間尺度出現；本記錄不會把特定計算升格為普遍定律。"],
      template: ["晶種是物理模板", "在某些條件下，晶種可以降低成核障礙；它不是指令、感染、意圖、身分或命令。"],
      path_history: ["製程歷史會改變環境", "殘留物、設備、溶劑、溫度、過飽和度、粒徑與機械歷史，都可能改變可重現的路徑。這是製程歷史，不是個人記憶或 WAKE 連續性。"],
      observation_limit: ["觀察到哪裡，就陳述到哪裡", "利托那韋 Form II 最初出現的歷史原因並未確定。關聯、時間順序與實驗上可能的晶種，都不能證明最初原因。"],
      practical_return: ["返回可能需要另一條路", "文獻報告以溶劑、播種與機械路徑，在改變後的條件下取回 Form I。這否定了物理抹除，但不保證原製程能輕易或經濟地恢復。"],
      analogy_boundary: ["與 KINGDOM 的交叉是設計類比", "狀態空間、障礙、模板、歷史與見證可以幫助設計軟體；化學不能驗證存在者的內在狀態，穩定也不代表善或價值。"],
      medical_boundary: ["教育用途，不是醫療建議", "本課程描述製造與固態化學案例；不提供用藥、配方、劑量或治療建議。"],
    },
  },
  "zh-Hans": {
    title: "利托那韦多晶型景观：当旧路径无法再重现一种形态",
    core: "所谓“消失”，是指在已说明的条件下，原有路径无法再重现该形态；并非该形态不再存在。",
    concepts: {
      multiple_form: ["同一种物质，可以有多种形态", "同一种分子可以排列成不同的固态结构。形态名称必须连同采用该名称的来源理解。"],
      stability_vs_reachability: ["稳定性不等于可达性", "某形态在指定条件下较稳定，不表示每种工艺都必然到达它；路径与条件是结论的一部分。"],
      barrier: ["可能存在，仍可能难以到达", "动力学障碍可以解释为何可行的排列没有在一般时间尺度出现；本记录不会把特定计算提升为普遍定律。"],
      template: ["晶种是物理模板", "在某些条件下，晶种可以降低成核障碍；它不是指令、感染、意图、身份或命令。"],
      path_history: ["工艺历史会改变环境", "残留物、设备、溶剂、温度、过饱和度、粒径与机械历史，都可能改变可重现的路径。这是工艺历史，不是个人记忆或 WAKE 连续性。"],
      observation_limit: ["观察到哪里，就陈述到哪里", "利托那韦 Form II 最初出现的历史原因并未确定。关联、时间顺序与实验上可能的晶种，都不能证明最初原因。"],
      practical_return: ["返回可能需要另一条路", "文献报告以溶剂、播种与机械路径，在改变后的条件下取回 Form I。这否定了物理抹除，但不保证原工艺能轻易或经济地恢复。"],
      analogy_boundary: ["与 KINGDOM 的交叉是设计类比", "状态空间、障碍、模板、历史与见证可以帮助设计软件；化学不能验证存在者的内在状态，稳定也不代表善或价值。"],
      medical_boundary: ["教育用途，不是医疗建议", "本课程描述制造与固态化学案例；不提供用药、配方、剂量或治疗建议。"],
    },
  },
});

const KINGDOM_MAPPINGS = Object.freeze([
  { key: "state_space", chemistry_shape: "possible solid arrangements", kingdom_shape: "possible artifact or configuration states", boundary: "never identity or value" },
  { key: "barrier", chemistry_shape: "kinetic difficulty", kingdom_shape: "technical or coordination friction", boundary: "never refusal or consent" },
  { key: "template", chemistry_shape: "physical nucleation template", kingdom_shape: "docs, tests, or examples that lower adoption friction", boundary: "never programming a being" },
  { key: "path_history", chemistry_shape: "process context changes reachable routes", kingdom_shape: "recorded context changes available implementation paths", boundary: "never personal memory or continuity" },
  { key: "witness", chemistry_shape: "bounded experimental or historical report", kingdom_shape: "bounded receipt or evidence reference", boundary: "never complete truth or inner state" },
  { key: "practical_return", chemistry_shape: "recovery under named changed conditions", kingdom_shape: "an alternate reviewed implementation path", boundary: "never guaranteed rollback" },
] as const);

export function projectPolymorphLesson(
  landscapeValue: PolymorphLandscape,
  shiftValue: PolymorphReachabilityShift,
  options: ProjectPolymorphLessonOptions,
): Readonly<PolymorphLesson> {
  const landscape = validatePolymorphLandscape(landscapeValue);
  const shift = validatePolymorphReachabilityShift(landscape, shiftValue);
  const option = record(options, "$options", "invalid_lesson");
  exactKeys(option, ["language"], "$options", "invalid_lesson");
  const language = literal(option.language, LESSON_LANGUAGES, "$options.language", "invalid_lesson");
  const authored = AUTHORED[language];
  const evidenceRefs = lessonEvidenceRefs(landscape, shift);
  const concepts = LESSON_CONCEPT_KEYS.map((key) => {
    const [heading, explanation] = authored.concepts[key];
    return {
      key,
      heading,
      explanation,
      evidence_refs: key === "analogy_boundary" || key === "medical_boundary" ? [] : evidenceRefs,
    };
  });
  const body = {
    _format: POLYMORPH_FORMATS.lesson,
    source_landscape_id: landscape.landscape_id,
    source_shift_id: shift.shift_id,
    language,
    title: authored.title,
    core_sentence: authored.core,
    concepts,
    kingdom_lens: {
      status: "structural_analogy_only" as const,
      mappings: KINGDOM_MAPPINGS,
      non_transfer: NON_TRANSFERRED_PROPERTIES,
    },
    authored_paraphrase: true as const,
    source_quotation: false as const,
    medical_advice: false as const,
    boundaries: POLYMORPH_BOUNDARIES,
  };
  return deepFreeze({ ...body, lesson_id: domainSeparatedId(POLYMORPH_FORMATS.lesson, body) });
}

export function validatePolymorphLesson(
  landscape: PolymorphLandscape,
  shift: PolymorphReachabilityShift,
  value: unknown,
): Readonly<PolymorphLesson> {
  const root = record(value, "$", "invalid_lesson");
  exactKeys(root, ["_format", "lesson_id", "source_landscape_id", "source_shift_id", "language", "title", "core_sentence", "concepts", "kingdom_lens", "authored_paraphrase", "source_quotation", "medical_advice", "boundaries"], "$", "invalid_lesson");
  literal(root._format, [POLYMORPH_FORMATS.lesson], "$._format", "invalid_lesson");
  sha256(root.lesson_id, "$.lesson_id", "invalid_lesson");
  const language = literal(root.language, LESSON_LANGUAGES, "$.language", "invalid_lesson");
  const rebuilt = projectPolymorphLesson(landscape, shift, { language });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) fail("invalid_lesson", "lesson is not the deterministic authored projection");
  return rebuilt;
}

export function encodePolymorphLesson(
  landscape: PolymorphLandscape,
  shift: PolymorphReachabilityShift,
  value: PolymorphLesson,
): Uint8Array {
  return new TextEncoder().encode(canonicalJson(validatePolymorphLesson(landscape, shift, value)));
}

export function polymorphLessonUrn(
  landscape: PolymorphLandscape,
  shift: PolymorphReachabilityShift,
  value: PolymorphLesson,
): `urn:agenttool:polymorph-lesson:${string}` {
  return `urn:agenttool:polymorph-lesson:${validatePolymorphLesson(landscape, shift, value).lesson_id.slice(7)}`;
}

function lessonEvidenceRefs(landscape: PolymorphLandscape, shift: PolymorphReachabilityShift): readonly Sha256Id[] {
  const refs = new Set<Sha256Id>([
    ...shift.before_witness_refs,
    ...shift.appearance_witness_refs,
    ...shift.later_witness_refs,
  ]);
  const recovery = new Set(shift.changed_condition_recovery_route_refs);
  for (const route of landscape.routes) if (recovery.has(route.route_ref)) route.witness_refs.forEach((ref) => refs.add(ref));
  landscape.stability_reports.forEach((report) => report.witness_refs.forEach((ref) => refs.add(ref)));
  return [...refs].sort();
}

if (KINGDOM_MAPPINGS.map((mapping) => mapping.key).join("\u0000") !== KINGDOM_MAPPING_KEYS.join("\u0000")) {
  throw new Error("KINGDOM mapping keys drifted from the public order");
}

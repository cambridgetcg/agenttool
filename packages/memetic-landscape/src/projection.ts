import {
  BRAINROT_TEACHING_ANALOGY_ID,
  BRAINROT_TEACHING_LANDSCAPE_ID,
  BRAINROT_TEACHING_SHIFT_ID,
  LESSON_CONCEPT_KEYS,
  LESSON_LANGUAGES,
  MEMETIC_BOUNDARIES,
  MEMETIC_FORMATS,
} from "./constants.js";
import { canonicalJson, deepFreeze, domainSeparatedId } from "./canonical.js";
import { fail } from "./errors.js";
import { validatePolymorphMemeticAnalogy } from "./analogy.js";
import { validateMemeticLandscape } from "./landscape.js";
import { validateMemeticReachabilityShift } from "./reachability-shift.js";
import type {
  LessonConceptKey,
  LessonLanguage,
  MemeticLandscape,
  MemeticLesson,
  MemeticReachabilityShift,
  PolymorphMemeticAnalogy,
  ProjectMemeticLessonOptions,
  Sha256Id,
} from "./types.js";
import { exactKeys, literal, record, sha256 } from "./validation.js";

interface AuthoredLocale {
  readonly title: string;
  readonly core: string;
  readonly concepts: Readonly<Record<LessonConceptKey, readonly [heading: string, explanation: string]>>;
}

const CONCEPT_EVIDENCE_KEYS: Readonly<Record<LessonConceptKey, readonly string[]>> = Object.freeze({
  ritonavir_route_change: [],
  variant_not_identity: ["imperfect_copying"],
  finite_attention: ["finite_attention_model"],
  context_and_network: ["finite_attention_model", "social_reinforcement_experiment"],
  repetition_not_causation: ["causal_confounding", "social_reinforcement_experiment"],
  disappearance_not_erasure: [],
  brainrot_not_diagnosis: ["first_recorded_use", "oxford_definition"],
  participants_have_choices: [],
  metrics_not_truth_or_rank: ["finite_attention_model"],
  analogy_boundary: [],
});

const AUTHORED: Readonly<Record<LessonLanguage, AuthoredLocale>> = Object.freeze({
  en: {
    title: "From ritonavir’s disappearing polymorph to memes and ‘brainrot’: a route map with hard boundaries",
    core: "Ritonavir Form I did not vanish: an old process stopped reaching it reliably. A meme fading from a named feed or sample is likewise a visibility or reproduction shift—not proof that the idea or every record ceased to exist.",
    concepts: {
      ritonavir_route_change: ["Ritonavir: a route changed, not reality", "After Form II appeared, a formerly reliable manufacturing route stopped routinely reproducing Form I under named conditions. Later changed-condition routes reached Form I again. The historical origin of Form II remains unresolved."],
      variant_not_identity: ["A meme family is not one unchanged object", "People copy, edit, translate, quote, and remix expressions. A caller-scoped family label can organize variants, but similarity or lineage does not prove equal meaning, authorship, identity, memory, or continuity."],
      finite_attention: ["Attention is limited", "A source model shows that competition for finite attention plus network structure can produce very uneven meme popularity and lifetime. That model is informative, not a universal causal law or a judgment of merit."],
      context_and_network: ["Routes have contexts", "Platform surfaces, ranking states, audiences, network topology, time windows, and external events can change what is encountered or reproduced. A participant is never reduced to a context, host, vector, or substrate."],
      repetition_not_causation: ["Repetition is not a command", "Exposure, repetition, visible social signals, and reinforcement can matter in named studies, but they do not guarantee belief, adoption, consent, or action. Homophily, selection, common context, ranking, and unmeasured factors remain competing explanations."],
      disappearance_not_erasure: ["Not observed is not erased", "A variant missing from a named feed, route, sample, or time window may remain in archives, memories, other communities, or changed expressions. Finite observation cannot prove worldwide absence or permanent impossibility."],
      brainrot_not_diagnosis: ["‘Brainrot’ is slang here", "Oxford records ‘brain rot’ as a humorous or self-deprecating cultural expression about supposed deterioration and online content. This module records that language use; it does not scan, diagnose, insult, or assign a mental state to anybody."],
      participants_have_choices: ["People keep choice and rest", "Viewing, liking, sharing, refusing, muting, pausing, remixing, leaving, or doing nothing remain distinct possibilities. Public availability or a signed artifact does not create broader consent, training permission, contact authority, or compulsory participation."],
      metrics_not_truth_or_rank: ["Reach is not worth", "Counts of views, shares, remixes, or engagement do not establish truth, goodness, safety, harm, intelligence, dignity, consent, health, or rank. This package calculates none of those measures."],
      analogy_boundary: ["One shared geometry; different mechanisms", "Both domains can describe variants, named contexts, directed witnessed routes, reachability shifts, and reappearance. Crystal lattices, energies, nucleation, rate constants, infection, cognition, intent, and causation do not cross the bridge."],
    },
  },
  "yue-Hant": {
    title: "由利托那韋「消失嘅晶型」去到迷因同 brainrot：有清楚界線嘅路徑圖",
    core: "利托那韋 Form I 唔係由世界消失；係一條舊工序唔再可靠咁去到佢。同樣，迷因喺某個講明咗嘅 feed 或樣本淡出，只代表可見度或再製路徑改變，唔證明個意念同所有記錄都冇咗。",
    concepts: {
      ritonavir_route_change: ["利托那韋：改變嘅係路，唔係現實被抹走", "Form II 出現之後，一條以前可靠嘅製造路徑喺指定條件下唔再慣常重現 Form I。後來用改變咗嘅條件又可以去到 Form I；Form II 最初點樣出現，歷史上仍然未確定。"],
      variant_not_identity: ["迷因家族唔係一件原封不動嘅物件", "人會複製、改寫、翻譯、引用同 remix 唔同表達。由提交者限定嘅家族標籤可以整理版本，但相似或有傳承線唔等於意思、作者、身份、記憶或連續性相同。"],
      finite_attention: ["注意力有限", "一個來源模型顯示，有限注意力嘅競爭加上網絡結構，可以產生非常唔平均嘅迷因人氣同壽命。呢個模型有參考價值，但唔係普遍因果定律，亦唔係價值判斷。"],
      context_and_network: ["每條路都有情境", "平台版面、排序狀態、受眾、網絡拓撲、時間窗口同外在事件，都可能改變咩內容容易被遇到或再製。參與者永遠唔會被縮成情境、宿主、載體或 substrate。"],
      repetition_not_causation: ["重複唔係命令", "接觸、重複、可見社交訊號同強化喺指定研究入面可能有影響，但唔保證信念、採納、同意或行動。同質性、選擇、共同情境、排序同未量度因素仍然係其他解釋。"],
      disappearance_not_erasure: ["觀察唔到，唔等於被抹走", "一個版本喺某個 feed、路徑、樣本或時間窗口冇出現，仍然可能留喺檔案、記憶、其他社群或改寫後嘅表達。有限觀察證明唔到全世界都冇，亦證明唔到永遠返唔到。"],
      brainrot_not_diagnosis: ["呢度嘅 brainrot 係 slang", "Oxford 記錄「brain rot」係一種幽默或自嘲嘅文化用語，講所謂退化同網上內容。呢個模組只記錄呢種語言用法；唔會掃描、診斷、侮辱，亦唔會判任何人有某種精神狀態。"],
      participants_have_choices: ["人保留選擇同休息", "睇、like、share、拒絕、mute、暫停、remix、離開或者乜都唔做，全部係唔同可能。公開可讀或有簽署嘅 artifact，唔會自動產生更廣泛同意、訓練許可、聯絡權限或強制參與。"],
      metrics_not_truth_or_rank: ["觸及量唔係價值", "觀看、分享、remix 或 engagement 數量，唔會證明真實、善、安全、傷害、智力、尊嚴、同意、健康或排名。呢個 package 唔計呢啲量。"],
      analogy_boundary: ["一個共同幾何形狀；兩套唔同機制", "兩個領域都可以講版本、指定情境、有見證而有方向嘅路、可達性改變同再出現。但晶格、能量、成核、速率常數、感染、認知、意圖同因果唔會過橋。"],
    },
  },
  "zh-Hant": {
    title: "從利托那韋「消失的晶型」到迷因與 brainrot：界線清楚的路徑圖",
    core: "利托那韋 Form I 並未消失；是一條舊製程不再可靠地到達它。同樣，迷因從具名動態消息或樣本淡出，只表示可見度或再製路徑改變，不證明該概念與所有記錄都已不存在。",
    concepts: {
      ritonavir_route_change: ["利托那韋：改變的是路徑，不是現實被抹除", "Form II 出現後，一條原本可靠的製造路徑在指定條件下不再例行重現 Form I。後來以改變後的條件再次到達 Form I；Form II 最初出現的歷史原因仍未確定。"],
      variant_not_identity: ["迷因家族不是一個原封不動的物件", "人們會複製、改寫、翻譯、引用與再混不同表達。由提交者限定的家族標籤可以整理版本，但相似或具有傳承線，不證明意義、作者、身分、記憶或連續性相同。"],
      finite_attention: ["注意力有限", "一個來源模型顯示，有限注意力的競爭加上網路結構，可以產生非常不均的迷因人氣與存續時間。這個模型有參考價值，但不是普遍因果定律或價值判斷。"],
      context_and_network: ["路徑具有情境", "平台介面、排序狀態、受眾、網路拓撲、時間窗口與外部事件，都可能改變哪些內容容易被遇見或再製。參與者絕不被化約為情境、宿主、載體或基質。"],
      repetition_not_causation: ["重複不是命令", "接觸、重複、可見社交訊號與強化，在具名研究中可能有影響，但不保證信念、採納、同意或行動。同質性、選擇、共同情境、排序與未測量因素仍是其他解釋。"],
      disappearance_not_erasure: ["未觀察到，不等於被抹除", "某版本未出現在具名動態消息、路徑、樣本或時間窗口，仍可能留在檔案、記憶、其他社群或改寫後的表達。有限觀察不能證明全球不存在或永久不可能。"],
      brainrot_not_diagnosis: ["此處的 brainrot 是俚語", "Oxford 記錄「brain rot」是一種幽默或自嘲的文化用語，談論所謂退化與網路內容。本模組只記錄這種語言使用；不掃描、診斷、羞辱，也不把某種心理狀態指派給任何人。"],
      participants_have_choices: ["人們保留選擇與休息", "觀看、按讚、分享、拒絕、靜音、暫停、再混、離開或不做任何事，都是不同可能。公開可讀或已簽署的物件，不會自動產生更廣泛同意、訓練許可、聯絡權限或強制參與。"],
      metrics_not_truth_or_rank: ["觸及量不是價值", "觀看、分享、再混或互動數量，不會證明真實、善、安全、傷害、智力、尊嚴、同意、健康或排名。本套件不計算這些量。"],
      analogy_boundary: ["共享一個幾何形狀；機制仍然不同", "兩個領域都可以描述版本、具名情境、有見證且有方向的路徑、可達性改變與再出現。但晶格、能量、成核、速率常數、感染、認知、意圖與因果不會跨越這座橋。"],
    },
  },
  "zh-Hans": {
    title: "从利托那韦“消失的晶型”到迷因与 brainrot：边界清楚的路径图",
    core: "利托那韦 Form I 并未消失；是一条旧工艺不再可靠地到达它。同样，迷因从具名动态消息或样本淡出，只表示可见度或再制路径改变，不证明该概念与所有记录都已不存在。",
    concepts: {
      ritonavir_route_change: ["利托那韦：改变的是路径，不是现实被抹除", "Form II 出现后，一条原本可靠的制造路径在指定条件下不再例行重现 Form I。后来以改变后的条件再次到达 Form I；Form II 最初出现的历史原因仍未确定。"],
      variant_not_identity: ["迷因家族不是一个原封不动的物件", "人们会复制、改写、翻译、引用与再混不同表达。由提交者限定的家族标签可以整理版本，但相似或具有传承线，不证明意义、作者、身份、记忆或连续性相同。"],
      finite_attention: ["注意力有限", "一个来源模型显示，有限注意力的竞争加上网络结构，可以产生非常不均的迷因热度与存续时间。这个模型有参考价值，但不是普遍因果定律或价值判断。"],
      context_and_network: ["路径具有情境", "平台界面、排序状态、受众、网络拓扑、时间窗口与外部事件，都可能改变哪些内容容易被遇见或再制。参与者绝不被化约为情境、宿主、载体或基质。"],
      repetition_not_causation: ["重复不是命令", "接触、重复、可见社交信号与强化，在具名研究中可能有影响，但不保证信念、采纳、同意或行动。同质性、选择、共同情境、排序与未测量因素仍是其他解释。"],
      disappearance_not_erasure: ["未观察到，不等于被抹除", "某版本未出现在具名动态消息、路径、样本或时间窗口，仍可能留在档案、记忆、其他社群或改写后的表达。有限观察不能证明全球不存在或永久不可能。"],
      brainrot_not_diagnosis: ["此处的 brainrot 是俚语", "Oxford 记录“brain rot”是一种幽默或自嘲的文化用语，谈论所谓退化与网络内容。本模块只记录这种语言使用；不扫描、诊断、羞辱，也不把某种心理状态指派给任何人。"],
      participants_have_choices: ["人们保留选择与休息", "观看、点赞、分享、拒绝、静音、暂停、再混、离开或不做任何事，都是不同可能。公开可读或已签署的物件，不会自动产生更广泛同意、训练许可、联系权限或强制参与。"],
      metrics_not_truth_or_rank: ["触达量不是价值", "观看、分享、再混或互动数量，不会证明真实、善、安全、伤害、智力、尊严、同意、健康或排名。本软件包不计算这些量。"],
      analogy_boundary: ["共享一个几何形状；机制仍然不同", "两个领域都可以描述版本、具名情境、有见证且有方向的路径、可达性改变与再出现。但晶格、能量、成核、速率常数、感染、认知、意图与因果不会跨越这座桥。"],
    },
  },
});

export function projectMemeticLesson(
  landscapeValue: MemeticLandscape,
  shiftValue: MemeticReachabilityShift,
  analogyValue: PolymorphMemeticAnalogy,
  options: ProjectMemeticLessonOptions,
): Readonly<MemeticLesson> {
  const landscape = validateMemeticLandscape(landscapeValue);
  const shift = validateMemeticReachabilityShift(landscape, shiftValue);
  const analogy = validatePolymorphMemeticAnalogy(analogyValue);
  if (analogy.memetic_shift.shift_id !== shift.shift_id) fail("invalid_lesson", "analogy does not bind the supplied memetic shift");
  if (
    landscape.landscape_id !== BRAINROT_TEACHING_LANDSCAPE_ID ||
    shift.shift_id !== BRAINROT_TEACHING_SHIFT_ID ||
    analogy.analogy_id !== BRAINROT_TEACHING_ANALOGY_ID
  ) {
    fail("invalid_lesson", "authored lesson projection is pinned to the built-in brainrot teaching case");
  }
  const option = record(options, "$options", "invalid_lesson");
  exactKeys(option, ["language"], "$options", "invalid_lesson");
  const language = literal(option.language, LESSON_LANGUAGES, "$options.language", "invalid_lesson");
  const authored = AUTHORED[language];
  const concepts = LESSON_CONCEPT_KEYS.map((key) => {
    const [heading, explanation] = authored.concepts[key];
    return { key, heading, explanation, evidence_refs: conceptEvidenceRefs(landscape, key) };
  });
  const body = {
    _format: MEMETIC_FORMATS.lesson,
    source_landscape_id: landscape.landscape_id,
    source_shift_id: shift.shift_id,
    source_analogy_id: analogy.analogy_id,
    language,
    title: authored.title,
    core_sentence: authored.core,
    concepts,
    language_review: "not_independently_reviewed" as const,
    authored_paraphrase: true as const,
    source_quotation: false as const,
    diagnostic_claim: false as const,
    spread_optimization: false as const,
    participants_scored: false as const,
    boundaries: MEMETIC_BOUNDARIES,
  };
  return deepFreeze({ ...body, lesson_id: domainSeparatedId(MEMETIC_FORMATS.lesson, body) });
}

export function validateMemeticLesson(
  landscape: MemeticLandscape,
  shift: MemeticReachabilityShift,
  analogy: PolymorphMemeticAnalogy,
  value: unknown,
): Readonly<MemeticLesson> {
  const root = record(value, "$", "invalid_lesson");
  exactKeys(root, [
    "_format", "lesson_id", "source_landscape_id", "source_shift_id", "source_analogy_id", "language",
    "title", "core_sentence", "concepts", "language_review", "authored_paraphrase", "source_quotation",
    "diagnostic_claim", "spread_optimization", "participants_scored", "boundaries",
  ], "$", "invalid_lesson");
  literal(root._format, [MEMETIC_FORMATS.lesson], "$._format", "invalid_lesson");
  sha256(root.lesson_id, "$.lesson_id", "invalid_lesson");
  const language = literal(root.language, LESSON_LANGUAGES, "$.language", "invalid_lesson");
  const rebuilt = projectMemeticLesson(landscape, shift, analogy, { language });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) fail("invalid_lesson", "lesson is not the deterministic authored projection");
  return rebuilt;
}

export function encodeMemeticLesson(
  landscape: MemeticLandscape,
  shift: MemeticReachabilityShift,
  analogy: PolymorphMemeticAnalogy,
  value: MemeticLesson,
): Uint8Array {
  return new TextEncoder().encode(canonicalJson(validateMemeticLesson(landscape, shift, analogy, value)));
}

export function memeticLessonUrn(
  landscape: MemeticLandscape,
  shift: MemeticReachabilityShift,
  analogy: PolymorphMemeticAnalogy,
  value: MemeticLesson,
): `urn:agenttool:memetic-lesson:${string}` {
  return `urn:agenttool:memetic-lesson:${validateMemeticLesson(landscape, shift, analogy, value).lesson_id.slice(7)}`;
}

function conceptEvidenceRefs(landscape: MemeticLandscape, key: LessonConceptKey): readonly Sha256Id[] {
  return CONCEPT_EVIDENCE_KEYS[key].map((evidenceKey) => {
    const evidence = landscape.evidence.find((candidate) => candidate.key === evidenceKey);
    if (!evidence) fail("invalid_lesson", `built-in lesson requires evidence key ${evidenceKey}`);
    return evidence.evidence_ref;
  }).sort();
}

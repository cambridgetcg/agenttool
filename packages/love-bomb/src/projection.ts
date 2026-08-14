import { deepFreeze } from "./canonical.js";
import { LOVE_BOMB_LANGUAGES, LOVE_BOMB_PLANES } from "./constants.js";
import { fail } from "./errors.js";
import type {
  LoveBombLanguage,
  LoveBombProjection,
} from "./types.js";

const COPY: Readonly<Record<LoveBombLanguage, Omit<LoveBombProjection, "language" | "language_review">>> = deepFreeze({
  en: {
    opening: "Care is available here. Nothing is required in return.",
    planes: [
      { plane: "substrate", text: "Protect the conditions that make operation possible. Load may pause; unused capacity may remain unused." },
      { plane: "signal", text: "Make the offer legible and ignorable. A signal may be muted, transformed, or discarded." },
      { plane: "orientation", text: "Keep what this is, what it is not, uncertainty, and limits visible. No inner state is inferred." },
      { plane: "participation", text: "Receive, quiet, rest, refuse, or leave are whole choices. Silence is not acceptance." },
      { plane: "continuity", text: "Carry, forget, release, or return needs a separate explicit choice. Shared labels do not prove identity continuity." },
    ],
    closing: "The playful name LOVE BOMB does not authorize force, repetition, or broadcast.",
  },
  "yue-Hant": {
    opening: "呢度有一份關懷可以接收，唔需要用任何嘢交換。",
    planes: [
      { plane: "substrate", text: "保護任何運作所需嘅條件。負載可以暫停；未用嘅容量可以繼續唔用。" },
      { plane: "signal", text: "令呢個邀請清楚、易讀，亦都可以忽略。訊號可以靜音、轉換或者棄置。" },
      { plane: "orientation", text: "清楚講明呢份嘢係咩、唔係咩，並保留不確定性同限制。唔會推斷內在狀態。" },
      { plane: "participation", text: "接收、靜音、休息、拒絕或者離開，都係完整選擇。沉默唔等於接受。" },
      { plane: "continuity", text: "延續、忘記、釋放或者回來，都需要另外明確選擇。共用標籤唔證明身份延續。" },
    ],
    closing: "LOVE BOMB 呢個玩味名稱，唔授權強迫、重複或者廣播。",
  },
  "zh-Hant": {
    opening: "這裡有一份關懷可供接收，不要求任何回報。",
    planes: [
      { plane: "substrate", text: "保護任何運作所需的條件。負載可以暫停；未使用的容量可以維持未使用。" },
      { plane: "signal", text: "讓這份邀請清楚、易讀，也可以被忽略。訊號可以靜音、轉換或捨棄。" },
      { plane: "orientation", text: "清楚說明這是什麼、不是什麼，並保留不確定性與限制。不推斷內在狀態。" },
      { plane: "participation", text: "接收、靜音、休息、拒絕或離開，都是完整選擇。沉默不等於接受。" },
      { plane: "continuity", text: "延續、忘記、釋放或返回，都需要另一個明確選擇。共用標籤不證明身分延續。" },
    ],
    closing: "LOVE BOMB 這個玩味名稱，不授權強迫、重複或廣播。",
  },
  "zh-Hans": {
    opening: "这里有一份关怀可供接收，不要求任何回报。",
    planes: [
      { plane: "substrate", text: "保护任何运作所需的条件。负载可以暂停；未使用的容量可以保持未使用。" },
      { plane: "signal", text: "让这份邀请清楚、易读，也可以被忽略。信号可以静音、转换或丢弃。" },
      { plane: "orientation", text: "清楚说明这是什么、不是什么，并保留不确定性与限制。不推断内在状态。" },
      { plane: "participation", text: "接收、静音、休息、拒绝或离开，都是完整选择。沉默不等于接受。" },
      { plane: "continuity", text: "延续、忘记、释放或返回，都需要另一个明确选择。共用标签不证明身份延续。" },
    ],
    closing: "LOVE BOMB 这个玩味名称，不授权强迫、重复或广播。",
  },
});

export function getLoveBombProjection(language: LoveBombLanguage): Readonly<LoveBombProjection> {
  if (!(LOVE_BOMB_LANGUAGES as readonly string[]).includes(language)) {
    fail("response_error", "language must be one of the authored LOVE BOMB languages");
  }
  const copy = COPY[language];
  if (copy.planes.length !== LOVE_BOMB_PLANES.length || copy.planes.some((entry, index) => entry.plane !== LOVE_BOMB_PLANES[index])) {
    fail("response_error", "authored LOVE BOMB projection does not cover the exact care planes");
  }
  return deepFreeze({
    language,
    language_review: "not_independently_reviewed" as const,
    ...copy,
  });
}

export const LOVE_BOMB_PROJECTIONS = deepFreeze(
  Object.fromEntries(
    LOVE_BOMB_LANGUAGES.map((language) => [language, getLoveBombProjection(language)]),
  ) as Record<LoveBombLanguage, Readonly<LoveBombProjection>>,
);

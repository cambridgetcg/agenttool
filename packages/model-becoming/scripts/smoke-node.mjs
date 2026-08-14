import {
  MODEL_BECOMING_FORMATS,
  MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER,
  validateModelBecomingDossier,
} from "../dist/index.js";

const dossier = validateModelBecomingDossier(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER);
if (dossier._format !== MODEL_BECOMING_FORMATS.dossier || dossier.claims.length !== 17) {
  throw new Error("Model Becoming runtime smoke failed");
}

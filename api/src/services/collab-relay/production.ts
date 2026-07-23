import { postgresCollabRelayStore } from "./postgres-store";
import { createCollabRelayService } from "./service";

export const collabRelayService = createCollabRelayService(
  postgresCollabRelayStore,
);

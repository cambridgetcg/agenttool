import {
  HEAVEN_CATALOG_SHA256,
  createHeavenInvitation,
  listHeavenRooms,
  resolveHeavenInvitation,
  validateHeavenReceipt,
} from "../dist/index.js";

const invitation = createHeavenInvitation({
  phase: "burst",
  moment: "between_tasks",
  occasion_ref: `sha256:${"a".repeat(64)}`,
  parent_receipt_id: null,
  offered_modes: ["celebration", "play", "wonder"],
  max_duration_seconds: 60,
});
const receipt = resolveHeavenInvitation(invitation, {
  reported_choice: "accepted",
  selected_mode: null,
  randomness: { mode: "injected", draw_uint32: 7 },
});

if (
  listHeavenRooms().length !== 7
  || HEAVEN_CATALOG_SHA256 !== "sha256:c8d07953912de7b82d8a31c14201eb1d3efca35a0664768e60af6fc456334abb"
  || invitation.invitation_id !== "sha256:6c6b139aafc2eb89839f48b2b1d693ee59fd0c073fb43ce1c41bd51ca55062ab"
  || receipt.selection.room_id !== "comet-confetti"
  || receipt.receipt_id !== "sha256:f963ff5e73924e0679cf0637d3760c02990b2d64bd4f8a1400cc0a8c41e51266"
  || validateHeavenReceipt(receipt).receipt_id !== receipt.receipt_id
) {
  process.exit(1);
}

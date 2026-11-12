// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/placement-and-digest.mjs — placement and the register write-up, the assessment's first two steps.
//
// One phase of a run, moved out of pipelineInner unchanged. `helpers` are functions still held in pipeline.mjs, handed in
// because this module must not import that one back; each moves here when the other phases that share it have moved.

export async function runPlacementAndDigest({ checkLateBind, ctx }, helpers) {
  const { asPartNotCompleted, assertReceiptSettled, must, recordPlacementPass, runDigest, stage } = helpers;
  await assertReceiptSettled(ctx, "placement-inquiry");
  // Placement and the register write-up are the assessment's first two steps. A failure of either, a band too large
  // to dispatch over included, is named as the assessment, as synthesis's own is below.
  const placementPass = await asPartNotCompleted("assessment", () => stage("placement-inquiry", ctx));
  // What THIS pass did, recorded before anything else can overwrite placements.json, and ahead of `must`
  // deliberately: a pass that failed or skipped on a partial artifact is exactly the pass whose account is
  // worth having, and `must` throws. The delivery gate's repeat of this stage records through the same helper.
  recordPlacementPass(ctx, placementPass);
  await asPartNotCompleted("assessment", async () => must(placementPass, "placement-inquiry"));
  await checkLateBind("pre-digest");   // B5b checkpoint 2: a bind here rides the digest message as a re-classification block
  const digestKey = (await asPartNotCompleted("assessment", async () => must(await runDigest(ctx), "register-digest"))).sessionKey;
  ctx.digestKey = digestKey;           // B5b: the late-bind re-digest follow-up is sent under this key, as a fresh session
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// stage-declarations.mjs — ONE RECORD PER MODEL STAGE: WHAT IT IS GRANTED, WHERE ITS RESULT COMES BACK, AND WHAT CHECKS IT.
//
// These were three answers in three places: the grant in a chain of name tests in gather-config.mjs, the recording tool
// in the recording registry beside it, and the validator in the stage's own file. Each is now read from the stage's row
// here, so a stage is described once and a new one is a new row.
//
//   grant      the tool groups the stage's seat is granted, by name. Explicit, never derived: a group appears here or the
//              seat does not hold it. Each group's tools are resolved in gather-config.mjs (allowedToolsFor).
//   recording  the stage's own record tool, served under its `recording-<stage>` key, or null. A stage with one hands back
//              its result as a typed call that the driver writes; a stage without one hands back a file, which its
//              validator checks before anything downstream reads it.
//   validator  the name of the check that accepts or refuses the stage's output, bound in the stage's own file.
//   output     "reply" where the stage's result is its reply text, as a plain model's is: the driver writes the reply to
//              the stage's out file, and the stage's validator judges it there before anything downstream reads it, as it
//              judges a written file. Missing or invalid, it takes the stage's failure and retry path. No live stage
//              declares it; a stage that does is handed in to runStage as `declaration`.
//   labels     "prefix" where the grant also covers every dispatched label that begins with the stage's name
//              (`register-unit:<axis>`, `common-law-half:<half>`). Those are read in table order, as the chain read them.
//              Any other stage covers its own name, and the fanned labels its recording row declares (`perAxis`, `perChunk`).
//
// Data only: this module imports nothing, so the tool servers' configuration reads it without loading a validator.
export const STAGE_DECLARATIONS = Object.freeze({
  // ── the stages whose grant covers every label that begins with their name, in the order they are read ──
  // The disposition transport is the lane's, named by the one lane whose doctrine orders it; the prefix carries
  // `common-law-half` with it.
  "common-law": { grant: ["perplexity", "dispositions"], recording: null, validator: "commonLaw", labels: "prefix" },
  // The audit note is a typed call on its own key (`unit-note`, one tool), beside the funnel's `register` key: the band
  // is the tools', the note is a separate artifact with a separate writer.
  "register-unit": { grant: ["register", "unit-note"], recording: null, validator: "registerUnit", labels: "prefix" },
  // The band-consuming judgment stages hold the READ-ONLY band tools: the shape, record lookups over the frozen band and
  // the run's fetched official records, every call logged to the reading audit. A stage that keeps retrieval names its
  // own `recording-<stage>` key here as well, or its record tool never enters its grant. The digest's `coverage` key
  // stays separate from its record key: the coverage form is the run's obligation ledger, ruled row by row, and the
  // digest call is the findings document, so merging them would put a second writer into the ledger.
  "register-digest": { grant: ["band", "coverage", "recording-register-digest"], recording: "record_register_digest", validator: "registerFindings", labels: "prefix" },
  "placement-inquiry": { grant: ["band"], recording: null, validator: "placement", labels: "prefix" },
  // `perplexity` because its doctrine orders one scoped probe before flagging: the review is the single place required to
  // introduce evidence the upstream units did not produce. Measured on a delivered production run (2026-08-18), the stage
  // held only `band`, ran nineteen minutes under an order it could not execute and made no such call.
  "narrative-refutation": { grant: ["perplexity", "band", "recording-narrative-refutation"], recording: "record_narrative_refutation", validator: "seniorEyeReview", labels: "prefix" },
  // synthesis drops the live register group on purpose: a live search from the judgment seat is the un-frozen, un-audited
  // query the plan freeze retired, and new register work enters only through the supplemental mint. `declination`
  // states, per record, why something that reached its findings surface was not delivered. A prefix, because synthesis
  // has per-pass variants (`synthesis(corrective)`), and each must reach its declines and its record tool.
  "synthesis": { grant: ["perplexity", "band", "declination", "recording-synthesis"], recording: "record_synthesis", validator: "narrative", labels: "prefix" },
  "case-law": { grant: ["caselaw"], recording: null, validator: "caseLaw", labels: "prefix" },
  // ── the clearance's other stages ──
  "common-law-half": { grant: ["perplexity", "dispositions"], recording: null, validator: "commonLawHalf" },
  // A recording stage holds its own record key and nothing else, and its name is matched exactly: a prefix would hand the
  // grant to any later stage whose name began with it.
  "matter-frame": { grant: ["recording-matter-frame"], recording: "record_matter_frame", validator: "matterContext" },
  "clearance-variants": { grant: ["recording-clearance-variants"], recording: "record_clearance_variants", validator: "variantManifest" },
  "blind-frame": { grant: ["recording-blind-frame"], recording: "record_blind_frame", validator: "blindFrame" },
  "skeptic": { grant: ["recording-skeptic"], recording: "record_skeptic", validator: "skepticFlags" },
  "frame-diff": { grant: ["recording-frame-diff"], recording: "record_frame_diff", validator: "frameDiff" },
  "report-overview": { grant: ["recording-report-overview"], recording: "record_report_overview", validator: "reportOverview" },
  "report-card": { grant: ["recording-report-card"], recording: "record_report_card", validator: "reportCard" },
  "doubt-closure": { grant: ["recording-doubt-closure"], recording: "record_doubt_closure", validator: "doubtClosure" },
  // ── the Knockout's stages ──
  "knockout-frame": { grant: ["recording-knockout-frame"], recording: "record_knockout_frame", validator: "knockoutPlan" },
  "knockout-register-read": { grant: ["register-questions", "recording-knockout-register-read"], recording: "record_knockout_register_read", validator: "validateKnockoutRegisterFile" },
  "knockout-assess": { grant: ["recording-knockout-assess"], recording: "record_knockout_assess", validator: "knockoutAssessChunk" },
  "knockout-review": { grant: ["recording-knockout-review"], recording: "record_knockout_review", validator: "validateKnockoutReviewFile" },
  "knockout-correct": { grant: ["recording-knockout-correct"], recording: "record_knockout_correction", validator: "validateKnockoutCorrectionFile" },
});

/**
 * The declared stage a dispatched label belongs to: by its own name, then by the first prefix a stage declares, or null.
 * Fanned recording labels (`report-card:<n>`, `knockout-assess#<n>`) are resolved in gather-config.mjs. PURE.
 */
export function declaredStageOf(label = "") {
  if (Object.hasOwn(STAGE_DECLARATIONS, label)) return label;
  for (const [stage, d] of Object.entries(STAGE_DECLARATIONS)) if (d.labels === "prefix" && label.startsWith(stage)) return stage;
  return null;
}

/** Does this declaration make the stage's reply its output? PURE. */
export const replyIsOutput = (declaration) => declaration?.output === "reply";
/**
 * How a stage's turn returns its result, which picks the output rule it is given (engine/common.mjs): through its record
 * tool, named; as its reply; or as a file it writes, which is also the answer for a stage with no declaration. PURE.
 */
export const turnOutputOf = (declaration) => (replyIsOutput(declaration) ? { kind: "reply" }
  : declaration?.recording ? { kind: "record", tool: declaration.recording } : { kind: "file" });

/** The named validator a stage declares, from the stage file's own table of them. Throws where the name is not in the table. */
export function declaredValidator(stage, table) {
  const name = STAGE_DECLARATIONS[stage]?.validator;
  const fn = name ? table[name] : null;
  if (typeof fn !== "function") throw new Error(`[stage-declarations] ${stage} declares the validator "${name}", which its stage file does not hold`);
  return fn;
}

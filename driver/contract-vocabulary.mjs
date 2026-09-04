// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// contract-vocabulary.mjs — WHAT A VALIDATOR CAN SAY ABOUT A STAGE, PER STAGE ( E2, arm 1)
//
// E2 asserts that the stage-contract declarations (`contractElements` in stages.mjs) and the validator
// failure vocabulary are a closed partition. Arm 1 of that partition — "a validator can emit a token no
// element declaration accounts for" — needs an inventory of what the validators can actually emit. This
// module is that inventory, and it is the audit object: every entry names its emitting site, so a reader
// checks a row by opening one file at one line.
//
// ── WHY THIS IS A CHECKED-IN CENSUS AND NOT A REGEX OVER `fail(` ────────────────────────────────────
//
// A static extraction over fail() call sites UNDER-READS, and it under-reads silently. `verify.mjs`
// holds 89 fail() sites yielding 60 literal tokens; the vocabulary the 19 stages can actually emit is
// several times that, because EIGHT sites build the token dynamically and hand back a string the
// extractor never sees:
//
//   D1 verify.mjs:898   fail(`connotation_${reason}:…`)      — reason iterates the table at line 894
//   D2 verify.mjs:704   fail(String(e.message))              — parseFindingsJson throws token-first
//   D3 verify.mjs:1065   checkJson: fail(String(e.message))   — FIVE parsers reach this one site
//   D4 verify.mjs:1603  parseCoverageLedgerJson, same shape
//   D5 verify.mjs:1504  fail(`${unaccounted[0].token}:…`)    — token minted in a DATA ROW
//   D6 verify.mjs:1509  fail(`${violations[0].token}…`)      — register-plan.mjs:1395,1399
//   D7 verify.mjs:1558  fail(`${v2[0].token}${detail}…`)     — register-plan.mjs:1996
//   D8 verify.mjs:1692  fail(caseLawLedgerFail(…))           — token built in case-law-ledger.mjs:204
//
// A partition built on the 60 tokens a regex CAN see would run green while blind to the rest, which is
// worse than having no E2 at all: it certifies a partition it never checked. So the census is authored
// against the code, families and all, and the regex is inverted into a TRIPWIRE — `contract-audit.mjs`
// asserts every statically visible token is covered by a row here, which is sound in the one direction
// a regex is sound in. A token this census cannot see is expected; a token the REGEX sees and this
// census does not is a build break.
//
// ── FAMILIES ────────────────────────────────────────────────────────────────────────────────────────
//
// Where a parser owns a closed token family (findings_*, variantmodel_*, …), the row carries the family
// prefix and names the module that mints it. A declaration accounts for a family row by naming ANY token
// in it — the specific token names in `contractElements` match by prefix. Families are used ONLY where
// the emitting site is dynamic; every token a validator names in a literal is its own row.
//
// ── PER-STAGE, NEVER GLOBAL ─────────────────────────────────────────────────────────────────────────
//
// `too_short` and `missing` come from the shared nonEmpty()/needs() helpers (verify.mjs:123-133) and are
// legitimately owned by DIFFERENT elements in matter-frame, prelim-variants and frame-diff. A global
// token→element map sees several owners for one token and "fixes" a partition that was never violated.
// Every row therefore carries `stages`, and the partition is computed per (token, stage) pair.

/** The 16 stages of STAGES in stages.mjs. Kept here so a stage added there fails this file's own test. */
export const ALL_STAGES = [
  "matter-frame", "prelim-variants", "blind-frame", "common-law", "common-law-half", "register-unit",
  "placement-inquiry", "register-digest", "skeptic", "frame-diff", "synthesis", "case-law",
  "narrative-refutation", "doubt-closure", "report-overview", "report-card",
];

const CL = ["common-law", "common-law-half"];

/**
 * The census. One row per emitting site-group:
 *   token   — the literal token, or the family prefix when `family` is set
 *   stages  — the stages that can emit it (per-stage, never global)
 *   site    — file:line of the emitter, so a row is checkable by opening it
 *   family  — when set, `token` is a prefix and this names where the family is minted
 *   dynamic — the D-number of the dynamic site, when the token is built rather than written
 */
export const VOCABULARY = [
  // ── the shared helpers: one token, many stages, different owners per stage ─────────────────────────
  { token: "too_short", stages: ALL_STAGES.filter((s) => !["blind-frame", "doubt-closure", "narrative-refutation"].includes(s)), site: "driver/verify.mjs:133" },
  { token: "missing", stages: ["matter-frame", "prelim-variants", "common-law", "common-law-half", "placement-inquiry", "register-digest", "doubt-closure", "report-overview", "report-card"], site: "driver/verify.mjs:164" },

  // ── common-law / common-law-half ───────────────────────────────────────────────────────────────────
  { token: "declared_unavailable", stages: CL, site: "driver/verify.mjs:231" },
  { token: "grid_spec_unreadable", stages: CL, site: "driver/verify.mjs:257" },
  { token: "grid_ledger_missing", stages: CL, site: "driver/verify.mjs:297" },
  { token: "grid_ledger_unparseable", stages: CL, site: "driver/verify.mjs:266" },
  { token: "connotation_query_unrecorded", stages: ["common-law-half"], site: "driver/verify.mjs:269" },
  { token: "profile_unparseable", stages: ["common-law"], site: "driver/verify.mjs:301" },
  { token: "grid_join_missing", stages: CL, site: "driver/verify.mjs:318" },
  { token: "platform_identity_error", stages: CL, site: "driver/verify.mjs:323" },
  { token: "platforms_missing", stages: CL, site: "driver/verify.mjs:334" },
  { token: "connotation_search_missing", stages: ["common-law"], site: "driver/verify.mjs:362" },
  { token: "receipts_short", stages: ["common-law"], site: "driver/verify.mjs:388" },
  { token: "half_path_unrecognized", stages: ["common-law-half"], site: "driver/verify.mjs:395" },
  { token: "no_coverage_status_row", stages: [...CL, "register-digest"], site: "driver/verify.mjs:452, 1416" },
  // B — `connotation_form_unparseable` and `connotation_form_untouched` are GONE: they
  // were states only a hand-authored document could be in, and the form path is deleted (owner ruling
  // 2026-08-17). Their subject matter is carried by the call tokens under the D1 family row below.
  { token: "connotation_form_damaged", stages: CL, site: "driver/verify.mjs:889" },
  { token: "connotation_", stages: CL, site: "driver/verify.mjs:898", family: "driver/connotation-search.mjs:894 (CONNOTATION_FORM_REASONS, exported at :819)", dynamic: "D1" },
  { token: "connotation_quote_unbound", stages: CL, site: "driver/verify.mjs:914" },

  // ── synthesis ──────────────────────────────────────────────────────────────────────────────────────
  { token: "framework_manifest_unreadable", stages: ["synthesis"], site: "driver/verify.mjs:691" },
  { token: "framework_manifest_missing_for_v4", stages: ["synthesis"], site: "driver/verify.mjs:706" },
  { token: "finding_use_check_source_missing", stages: ["synthesis"], site: "driver/verify.mjs:713" },
  { token: "finding_own_rights_source_missing", stages: ["synthesis"], site: "driver/verify.mjs:715" },
  { token: "finding_basis_source_missing", stages: ["synthesis"], site: "driver/verify.mjs:721" },
  { token: "finding_use_check_missing", stages: ["synthesis"], site: "driver/verify.mjs:729" },
  { token: "intake_ask_unanswered", stages: ["synthesis"], site: "driver/verify.mjs:1636" },
  { token: "coverage_recommendation", stages: ["synthesis"], site: "driver/verify.mjs:1648" },
  { token: "coverage_gap_unexplained", stages: ["synthesis"], site: "driver/verify.mjs:1649" },
  { token: "finding", stages: ["synthesis"], site: "driver/verify.mjs:704", family: "driver/findings-model.mjs (token-first throws; `finding_*` and `findings_*`)", dynamic: "D2" },

  // ── register-digest ────────────────────────────────────────────────────────────────────────────────
  { token: "coverage_form_damaged", stages: ["register-digest"], site: "driver/verify.mjs:976" },
  { token: "coverage_form_engine_vocabulary", stages: ["register-digest"], site: "driver/verify.mjs:1021" },
  { token: "coverage_form_axis_invalid", stages: ["register-digest"], site: "driver/verify.mjs:1029" },
  { token: "coverage_no_status", stages: ["register-digest"], site: "driver/verify.mjs:1062" },
  { token: "coverage_form_missing", stages: ["register-digest"], site: "driver/verify.mjs:1445" },
  { token: "coverage_form_empty", stages: ["register-digest"], site: "driver/verify.mjs:1449" },
  { token: "coverage_status_offenum", stages: ["register-digest"], site: "driver/verify.mjs:1940" },
  { token: "coverage_deferred_unaccounted", stages: ["register-digest"], site: "driver/verify.mjs:1504", family: "driver/register-plan.mjs:1620 (token on a data row)", dynamic: "D5" },
  { token: "coverage_clean_unexecuted", stages: ["register-digest"], site: "driver/verify.mjs:1509", family: "driver/register-plan.mjs:1395", dynamic: "D6" },
  { token: "coverage_clean_skipped", stages: ["register-digest"], site: "driver/verify.mjs:1509", family: "driver/register-plan.mjs:1744", dynamic: "D6" },
  { token: "coverage_clean_unverified_incomplete", stages: ["register-digest"], site: "driver/verify.mjs:1558", family: "driver/register-plan.mjs:1996", dynamic: "D7" },
  { token: "coverage_clean_tainted", stages: ["register-digest"], site: "driver/verify.mjs:1578" },
  { token: "coverage_ledger_", stages: ["register-digest"], site: "driver/verify.mjs:1603", family: "driver/coverage-ledger.mjs (parseCoverageLedgerJson token-first throws)", dynamic: "D4" },
  { token: "coverage_key_unknown", stages: ["register-digest"], site: "driver/verify.mjs:1603", family: "driver/coverage-ledger.mjs", dynamic: "D4" },
  { token: "coverage_axis_", stages: ["register-digest"], site: "driver/verify.mjs:1603", family: "driver/coverage-ledger.mjs", dynamic: "D4" },
  { token: "coverage_status_invalid", stages: ["register-digest"], site: "driver/verify.mjs:1603", family: "driver/coverage-ledger.mjs", dynamic: "D4" },
  { token: "coverage_classes_invalid", stages: ["register-digest"], site: "driver/verify.mjs:1603", family: "driver/coverage-ledger.mjs", dynamic: "D4" },
  { token: "plan_execution_unreadable", stages: ["register-digest", "narrative-refutation"], site: "driver/verify.mjs:1496, 1712" },

  // ── matter-frame / prelim-variants / blind-frame / frame-diff ──────────────────────────────────────
  { token: "stagecontracts_invalid", stages: ["matter-frame", "prelim-variants", "placement-inquiry", "case-law"], site: "driver/verify.mjs:1539, 1170, 1366, 1677" },
  { token: "meaning_angles_missing", stages: ["matter-frame"], site: "driver/verify.mjs:1103" },
  { token: "frame_scope_missing", stages: ["matter-frame"], site: "driver/verify.mjs:1119" },
  { token: "variantmodel_romanization_missing", stages: ["prelim-variants"], site: "driver/verify.mjs:1179" },
  { token: "variantmodel_family_incomplete", stages: ["prelim-variants"], site: "driver/verify.mjs:1196" },
  { token: "variantmodel_term_markup", stages: ["prelim-variants"], site: "driver/verify.mjs:1205" },
  { token: "variantmodel_missing", stages: ["prelim-variants"], site: "driver/verify.mjs:1153, 1212" },
  // Recovered during E2 authoring, absent from the draft census: variant-manifest.json is strict-parsed
  // through checkSiblingJson (verify.mjs:1078) → checkJson (:742), so the WHOLE variantmodel_* family
  // reaches prelim-variants, not just the four literal tokens above.
  // CONVERSION 3 widened this family's SOURCE without widening its prefix. `acceptPrelimVariants` raises
  // `variantmodel_scope_layer_invalid`, `_scope_status_invalid`, `_scope_item_missing` and `_scope_pipe`
  // at the ACCEPTANCE BOUNDARY — the call is refused in the turn where restating is free, and no manifest
  // reaches disk. They share the prefix deliberately: a seat reading one refused call should not have to
  // learn that the ledger half of the same artifact answers to a different family.
  //
  // NOTE FOR ANYONE TRUSTING THE TRIPWIRE HERE: it cannot see these. `extractStaticTokens` keys on
  // `fail(` / `throw new Error(` / `=>` string literals, and every record module returns
  // `{ok: false, reason}` instead — measured, all four extract ZERO tokens. So this row is authored, not
  // extracted, and nothing re-derives it if the module grows a member. Filed as.
  { token: "variantmodel_", stages: ["prelim-variants"], site: "driver/verify.mjs:1153 → 742 (JSON family); driver/prelim-variants-record.mjs acceptPrelimVariants (scope-ledger transport family)", family: "driver/variant-manifest-model.mjs (token-first throws) + driver/prelim-variants-record.mjs", dynamic: "D3" },
  { token: "blindframe_", stages: ["blind-frame"], site: "driver/verify.mjs:1221 → 742", family: "driver/blind-frame-model.mjs", dynamic: "D3" },
  // — THE SKEPTIC TRANSPORT FAMILY, WHICH HAD NO ROW AT ALL. Nine tokens minted by acceptSkeptic
  // and not one of them was covered here: the conversion that moved them to the acceptance boundary moved
  // them out of a census that could not read that boundary, so nothing went red. Two of the nine are
  // DYNAMIC — `skeptic_flag_${d}` and `skeptic_reason_${d}` take their tail from the defect they name —
  // which is exactly what a family row is for, and exactly what a per-token census cannot hold.
  { token: "skeptic_", stages: ["skeptic"], site: "driver/skeptic-record.mjs acceptSkeptic", family: "driver/skeptic-record.mjs", dynamic: "D3" },
  // Conversion 4's transport family. Declared IN THE SAME COMMIT as the module, because widened the
  // extractor to read the acceptance boundary: `report-overview-record.mjs` is read for the `reason:` shape
  // below, so the E2 soundness tripwire sees every `reportoverview_*` token the moment it exists and goes
  // red on any that no row covers. That is the census working the way the previous conversion's gap
  // taught it to — skeptic's nine tokens were raised for two conversions before anything could see them.
  { token: "reportoverview_", stages: ["report-overview"], site: "driver/report-overview-record.mjs acceptReportOverview", family: "driver/report-overview-record.mjs", dynamic: "D3" },
  // Conversion 5's transport family. Declared in the SAME commit as the module — 's extractor reads
  // the acceptance boundary, so `report-card-record.mjs` is read for the `reason:` shape and the E2
  // soundness tripwire sees every `reportcard_*` token the moment it exists.
  { token: "reportcard_", stages: ["report-card"], site: "driver/report-card-record.mjs acceptReportCard", family: "driver/report-card-record.mjs", dynamic: "D3" },
  // Conversion 2 — the matter frame's TRANSPORT family. These are raised by acceptMatterFrame at the
  // ACCEPTANCE BOUNDARY, not by verify.mjs: the call is refused in the turn where restating is free, and
  // the frame never reaches disk. They are declared here for the same reason the two families below are —
  // verify.mjs reaches the module, so a family that could grow a member no row covers must be readable.
  { token: "matterframe_", stages: ["matter-frame"], site: "driver/matter-frame-record.mjs acceptMatterFrame", family: "driver/matter-frame-record.mjs", dynamic: "D3" },
  { token: "framediff_model_missing", stages: ["frame-diff"], site: "driver/verify.mjs:1224" },
  { token: "framediff_", stages: ["frame-diff"], site: "driver/verify.mjs:1224 → 742", family: "driver/frame-diff-model.mjs", dynamic: "D3" },

  // ── register-unit ──────────────────────────────────────────────────────────────────────────────────
  { token: "declared_not_executed", stages: ["register-unit"], site: "driver/verify.mjs:1236" },
  { token: "tool_timeout", stages: ["register-unit"], site: "driver/verify.mjs:1730" },
  { token: "named_band_missing", stages: ["register-unit"], site: "driver/verify.mjs:1731" },
  { token: "named_band_invalid", stages: ["register-unit"], site: "driver/verify.mjs:1736" },
  { token: "named_band_collapsed", stages: ["register-unit"], site: "driver/verify.mjs:1747" },
  { token: "band_block_unplanned", stages: ["register-unit"], site: "driver/verify.mjs:1761" },
  { token: "named_band_", stages: ["register-unit"], site: "driver/verify.mjs:1736 → 742", family: "driver/named-band.mjs", dynamic: "D3" },

  // ── placement-inquiry ──────────────────────────────────────────────────────────────────────────────
  { token: "placementmodel_missing", stages: ["placement-inquiry"], site: "driver/verify.mjs:1352, 1379" },
  { token: "placement", stages: ["placement-inquiry"], site: "driver/verify.mjs:1352 → 742", family: "driver/placement-model.mjs (`placement_*` and `placements_*`)", dynamic: "D3" },

  // ── case-law / narrative-refutation ────────────────────────────────────────────────────────────────
  { token: "caselaw_ledger_missing", stages: ["case-law"], site: "driver/verify.mjs:1682, 1685" },
  { token: "caselaw_ledger_unparseable", stages: ["case-law"], site: "driver/verify.mjs:1687" },
  { token: "caselaw_ledger", stages: ["case-law"], site: "driver/verify.mjs:1692", family: "driver/case-law-ledger.mjs:204 (census reasons)", dynamic: "D8" },
  { token: "no_verdict_line", stages: ["narrative-refutation"], site: "driver/verify.mjs:1696" },
  { token: "plan_audit_missing", stages: ["narrative-refutation"], site: "driver/verify.mjs:1713" },

  // ── delivery ───────────────────────────────────────────────────────────────────────────────────────
  // EMPTY SINCE, and that is the finding rather than an omission: the only delivery-side token was
  // `send_admission_in_receipt`, emitted by the three send stages against a receipt a model wrote about
  // its own send. Delivery is code and a packet now, so there is no stage to emit a delivery token.

  // ── the gateway wrapper, emittable by EVERY stage and not in verify.mjs at all ─────────────────────
  { token: "missing_file", stages: ALL_STAGES, site: "driver/gateway.mjs:1037" },
];

/**
 * WRAPPERS — the emitted failure string is not always the bare token.
 *
 *   invalid_file:<rel(gradedArtifact)>:<validator reason>   gateway.mjs:788
 *   max_tokens_no_output:<the whole string above>           gateway.mjs:1113
 *
 * The file segment is variable and `max_tokens_no_output:` PREFIXES an otherwise ordinary token, so a
 * matcher keyed on the bare token misses the emitted string and reports a false unattached token. These
 * are NORMALIZED away before matching, never exempted — an exemption here would hide real vocabulary.
 */
export function normalizeFailToken(raw) {
  let s = String(raw ?? "");
  if (s.startsWith("max_tokens_no_output:")) s = s.slice("max_tokens_no_output:".length);
  if (s === "max_tokens_no_output") return "max_tokens_no_output";
  if (s.startsWith("invalid_file:")) {
    const rest = s.slice("invalid_file:".length);
    const cut = rest.indexOf(":");
    s = cut < 0 ? rest : rest.slice(cut + 1);
  }
  if (s.startsWith("missing_file:")) return "missing_file";
  return s.split(":")[0];
}

/**
 * ARM 1 EXEMPTIONS — tokens that legitimately belong to NO element declaration, each with the reason.
 *
 * requires a mechanical failure to fail loudly AS A DRIVER FAULT rather than be pinned on a model
 * element. An exemption is that verdict written down. It is a NAMED list with a reason per row, never a
 * silent skip, because a skip is how the list rots: the next agent cannot tell a ruled exemption from a
 * token somebody could not be bothered to attach.
 */
export const ARM1_EXEMPTIONS = [
  {
    token: "stagecontracts_invalid",
    stages: ["matter-frame", "prelim-variants", "placement-inquiry", "case-law"],
    reason: "The artifact is DRIVER-written (pipeline.mjs recordStageContract → _driver/stage-contracts.json). A corrupt one is a code or filesystem fault, and verify.mjs:1095 says so in its own comment. Pinning it on a model element would be the exact inversion #850 forbids — a mechanical failure wearing a model's name.",
  },
  // `tool_timeout` was on this list and has been REMOVED: register-unit's tool-written "execute the
  // frozen plan — ONE register_execute_plan call" element declares it, so the token does have an element
  // that speaks about it and no exemption is needed. Whether a killed tool call may reach the retry
  // ladder is E6's question, not arm 1's. A redundant exemption is not harmless — it is an escape hatch
  // held open for a token that never needed one, and the test below now fails on any such row.
  {
    token: "missing_file",
    stages: ALL_STAGES,
    reason: "The gateway's own pre-validation check (gateway.mjs:1037): the declared output does not exist. It speaks about the DISPATCH, not about any element within the output — every stage can emit it and no element owns it.",
  },
  {
    token: "profile_unparseable",
    stages: ["common-law"],
    reason: "The run's profile is config the driver loaded before the stage ran (verify.mjs:301). A corrupt profile is a config fault; no element of the common-law contract is about it.",
  },
  {
    token: "framework_manifest_unreadable",
    stages: ["synthesis"],
    reason: "The rating framework manifest is driver-loaded config (verify.mjs:691). Unreadable = a config/deploy fault, not a defect in anything synthesis was asked to author.",
  },
  {
    token: "framework_manifest_missing_for_v4",
    stages: ["synthesis"],
    symbol: { file: "driver/verify.mjs", names: ["checkFindingsSibling", "checkClientSummaryJoin"] },
    reason: "Same artifact and fault class as `framework_manifest_unreadable`: the run declared a v4 rating and the driver could not find the framework to rate under. A deploy/config absence, not a model element. #1272 — this row cited NOTHING; it leant on \"same artifact\" as the row above, and a reader could not follow it to either of the two places it fires (`checkFindingsSibling`, and again in `checkClientSummaryJoin`). Anchored rather than given a line number, because every line citation into this file measured 34-246 lines wrong.",
  },
  {
    token: "plan_execution_unreadable",
    stages: ["register-digest", "narrative-refutation"],
    reason: "The plan-execution receipt is written by the register tool lane, not by either stage (verify.mjs:1496, 1712). Unreadable is a tool/driver fault; both stages are only READERS of it.",
  },
  {
    token: "grid_spec_unreadable",
    stages: ["common-law", "common-law-half"],
    reason: "The grid spec is driver-written (_driver/grid-spec.half-<h>.json), and verify.mjs:257-258 makes the ruling in its own failure string: \"(driver-written — this is a bug, not a model defect)\". Corrupt or absent, it is a driver fault.",
  },
  {
    token: "coverage_form_missing",
    stages: ["register-digest"],
    reason: "verify.mjs:1445 says it in the failure string the reader sees: \"the driver writes it before the digest dispatches and unions it before every judgement (driver-written — this is a bug, not a model defect)\".",
  },
  {
    token: "coverage_form_empty",
    stages: ["register-digest"],
    reason: "verify.mjs:1449, same artifact and same verdict in its own string: a form that parsed and carries no rows is \"(driver-written — this is a bug, not a model defect)\".",
  },
  {
    token: "half_path_unrecognized",
    stages: ["common-law-half"],
    reason: "verify.mjs:395 fires when the seat's own output path does not match common-law-findings.half-<seat>.md. The DRIVER names that path when it spawns the seat, so an unrecognised one is a driver fault and no element of the half's contract is about it.",
  },
];

/**
 * STAGE-UNREACHABLE VALIDATORS — not exemptions, a SCOPE statement.
 *
 * verify.mjs wires four validators no STAGES entry reaches: findings(1661), report(1719), audit(1728),
 * clientSummary(1736). They are NOT dead code — replay-archive.mjs:128 and mcp-server/lib/coverage.mjs:78
 * index validators[key] dynamically and the MCP server declares `audit` required — but no stage dispatches
 * them, so their tokens are unaccountable BY CONSTRUCTION with respect to a stage partition. The
 * client-summary STAGE was deleted 2026-08-01 (no line to cite: the stage is gone) and its validator outlived it.
 *
 * E2 scopes its assertion to stage-reachable validators. This list exists so that scope is stated rather
 * than silently enjoyed, and so a validator that LATER gains a stage is noticed.
 */
export const STAGE_UNREACHABLE_VALIDATORS = [
  { validator: "findings", site: "driver/verify.mjs:1661", reason: "no STAGES entry names it; synthesis validates findings.json through validators.narrative's sibling checks instead" },
  { validator: "report", site: "driver/verify.mjs:1719", reason: "report.md is ASSEMBLED by the driver (assembleReportMd); the validator survives as a post-assembly structural gate outside the stage table" },
  { validator: "audit", site: "driver/verify.mjs:1728", reason: "reached only through the MCP server's dynamic validators[key] lookup, which declares it required" },
  { validator: "clientSummary", site: "driver/verify.mjs:1736", reason: "the client-summary STAGE was deleted 2026-08-01 (no line to cite: the stage is gone); the validator was not" },
];

/**
 * `symbol:` — THE ROT-RESISTANT HALF OF A CITATION.
 *
 * Every row in these tables carries a `site:`, and a `site:` is a line number. Measured on 9d6ea0f1
 * across VOCABULARY, ARM1_EXEMPTIONS, TRIPWIRE_OUT_OF_SCOPE and STAGE_UNREACHABLE_VALIDATORS:
 *
 *   90 parseable file:line refs
 *    2 land within 5 lines of any mention of their own token
 *   13 within 25
 *   75 are further than that — 34 to 246 lines wrong
 *
 * The drift is CLUSTERED, not random: 34, 35, 36, 52 recur. That is one insertion above a block moving
 * every citation below it, all at once, silently, in a PR that was about something else entirely. A
 * reader following `coverage_ledger_ → verify.mjs:1603` lands on a comment 219 lines from the dispatcher.
 *
 * `symbol:` names a thing instead — a function, a constant, an exported name. It survives every move.
 * `site:` stays as the hint it always was, and `contract-audit.test.mjs` asserts that any `symbol:` a row
 * carries is really present in the file it names, so an anchor cannot rot silently the way a number does.
 *
 * WHY THE 75 ARE STILL THERE. CONTRIBUTING.md declines to sweep the repo's line citations —
 * "re-pointing them all today would churn every blame line" — and makes migration opportunistic: "when
 * you edit a file, fix the citations into it as part of that edit." Every one of the 75 points INTO
 * verify.mjs, so they belong to whoever next edits verify.mjs, not to this file. Adding an arm over all
 * of them would be red on day one with no permitted way to green it, and a staleness ratchet is worse
 * still: it would turn an unrelated lane's merge red for drift that lane did not cause.
 *
 * So the arm covers what is anchored, and coverage grows as migration reaches these rows. That is a
 * smaller claim than "the citations are checked", and it is the true one.
 */

/**
 * TRIPWIRE SCOPE — tokens a stage provably cannot emit, each with the reason it cannot.
 *
 * TWO FORMS, and the difference is not cosmetic. `prefix` excuses a whole FAMILY; `token` excuses ONE
 * name, exactly. added the second because the rulings it carries are about single codes with no
 * shared stem, and a `prefix: "no_citations"` would silently swallow a future `no_citations_stale` that
 * nobody had ruled on — an exemption that grows on its own is the failure this table exists to prevent.
 *
 * The tripwire asserts every statically visible token is covered by a census row. Four families in the
 * covered sources are visible to it and unreachable from any of the 19 stages. They are named here, with
 * the mechanism that swallows them, rather than dropped — an unexplained skip is indistinguishable from
 * a token nobody could be bothered to attach, which is how a census rots.
 */
export const TRIPWIRE_OUT_OF_SCOPE = [
  // ── — EXACT-TOKEN RULINGS. Both are `reason:` codes that reach no failure token at all, which is
  // why neither is an INNER_CODES row: an inner code rolls up into something: these roll up into nothing.
  {
    token: "no_citations",
    symbol: { file: "driver/case-law-ledger.mjs", names: ["findCaseLawLedgerViolations", "CASE_LAW_ADVISORY_REASONS", "isCaseLawBlocking"] },
    site: "driver/case-law-ledger.mjs:179 (minted), :65 CASE_LAW_ADVISORY_REASONS, :67 isCaseLawBlocking",
    reason: "ADVISORY, and filtered before the token is built. `caseLawLedgerFail` keeps only blocking violations (case-law-ledger.mjs:196), and `no_citations` is the one member of CASE_LAW_ADVISORY_REASONS — so it cannot appear even in the `caselaw_ledger` census payload, let alone as a token head. It is the honest no-on-point-precedent result the report is allowed to state; failing a run for it would manufacture citations.",
  },
  {
    token: "accepted_not_folded",
    symbol: { file: "driver/disposition-call.mjs", names: ["CALL_DROPS"] },
    site: "driver/disposition-tool.mjs:378 (minted), driver/disposition-call.mjs:192 (CALL_DROPS)",
    reason: "A DRIVER-FAULT journal code, and the fault is ours. It records that the tool accepted a row the accumulator then did not carry; it is written to the call verdict ledger and reaches a seat only inside a sentence that orders the seat NOT to act (`your answer was valid and this is ours to fix`). A stage refusal built on it would be the driver failing a seat for the driver's own defect, so no stage can emit it by construction rather than by omission.",
  },
  {
    prefix: "client_",
    site: "driver/verify.mjs:1775-1807",
    reason: "Emitted only by validators.clientSummary, which no STAGES entry reaches — the client-summary STAGE was deleted 2026-08-01 (no line to cite: the stage is gone) and its validator outlived it. See STAGE_UNREACHABLE_VALIDATORS.",
  },
  {
    prefix: "knockout_",
    site: "driver/findings-model.mjs:1944-2033 (`knockout_finding_*` and `knockout_findings_*`)",
    reason: "The knockout lane's parser. knockout-frame and knockout-assess live in driver/stages-knockout.mjs, not in STAGES, so they carry no E1 declaration and are outside this partition. RECORDED AS A GAP: #850 audits both stages, and an E1 declaration for the knockout lane is not in this scaffolding.",
  },
  {
    prefix: "framework_",
    site: "driver/framework.mjs",
    reason: "parseFrameworkManifest's throws never reach a stage: verify.mjs:64 wraps the call and returns {invalid:true}, and verify.mjs:691 emits its OWN token (framework_manifest_unreadable) instead. The family is unreachable by construction.",
  },
  {
    prefix: "register_plan_",
    site: "driver/register-plan.mjs",
    reason: "parseRegisterPlan is called once from a validator (verify.mjs:2012) inside a try whose catch swallows it — `catch { /* no plan in reach — gate inactive */ }` at verify.mjs:1763. No throw of this family becomes a stage failure token.",
  },
];

/**
 * INNER CODES —. A `reason:` code that is REAL, and is never a failure token on its own.
 *
 * THE SHAPE THE CENSUS COULD NOT READ. A validator module reports its findings as records —
 * `{ reason: "quote_unbound", row, query }` — and `verify.mjs` projects those records to the token a
 * stage actually fails with. The projection is not identity. It namespaces (`connotation_quote_unbound`),
 * it folds a whole list into one token with the codes as census PAYLOAD (`caselaw_ledger:no_queries=1;…`),
 * and in one case it renames outright. So the bare code is visible to a static scan and reachable by
 * nothing.
 *
 * WHY NOT A VOCABULARY ROW. A row asserts "this stage emits this token", and for all nineteen of these
 * that assertion is false. 's own judging condition forbids writing it: *no row claims a stage emits
 * a token that stage cannot emit*.
 *
 * WHY NOT A BARE EXEMPTION. An out-of-scope rule excuses a token and asserts nothing, so it cannot fail.
 * These can assert something much stronger, so they do: each row names the composite the code rolls up
 * into, and the tripwire treats the code as covered ONLY while that composite is itself covered. Delete
 * the `connotation_` family row and nine of these stop excusing anything, loudly. An exemption that
 * survives the disappearance of its own justification is how a census rots quietly.
 *
 * `mints` is the line that WRITES the code, never the line that mentions it. The census's own citation
 * cannot be used here: it records the first line a pattern matched, and for `no_status` that was the
 * JSDoc `@returns` annotation at coverage-form.mjs:810, seventeen lines above the mint. A ruling written
 * from a doc comment is a ruling about a sentence.
 *
 * @type {ReadonlyArray<{code:string, mints:string[], rollsUpTo:string[], why:string}>}
 */
export const INNER_CODES = Object.freeze([
  // ── connotation-search.mjs — namespaced one-for-one by verify.mjs ────────────────────────────────
  //
  // `CONNOTATION_FORM_REASONS` (connotation-search.mjs:1599) is `CONNOTATION_REASONS` minus
  // `no_recorded_queries`, and the `connotation_` family row (dynamic D1) is declared against exactly
  // that list. The four call codes are folded by a template — `connotation_${callFail.reason}` at
  // verify.mjs:1013 — so they are namespaced by construction rather than one branch at a time.
  { code: "call_never_made", mints: ["driver/connotation-search.mjs:1956"], rollsUpTo: ["connotation_call_never_made"],
    why: "CALL_AUDIT_ROWS. The typed transport's four call states, handed in by disposition-call-audit.mjs and namespaced at verify.mjs:1013." },
  { code: "call_truncated", mints: ["driver/connotation-search.mjs:1957"], rollsUpTo: ["connotation_call_truncated"],
    why: "As call_never_made — same table, same projection." },
  { code: "call_schema_violation", mints: ["driver/connotation-search.mjs:1958"], rollsUpTo: ["connotation_call_schema_violation"],
    why: "As call_never_made — same table, same projection." },
  { code: "call_partial", mints: ["driver/connotation-search.mjs:1959"], rollsUpTo: ["connotation_call_partial"],
    why: "As call_never_made — same table, same projection. This is the pair #1211 cites as its worked example: the composite is covered, the bare form reaches no stage." },
  { code: "quote_unbound", mints: ["driver/connotation-search.mjs:2090"], rollsUpTo: ["connotation_quote_unbound"],
    why: "The ruled-but-unbound row. Projected at verify.mjs:1057, and reported only once nothing is unruled." },
  { code: "token_absent", mints: ["driver/connotation-search.mjs:2117"], rollsUpTo: ["connotation_token_absent"],
    why: "#592 split this out of no_ruling. Row-level only — repairs.mjs:352 says so in as many words: `never a top-level token`." },
  { code: "cite_absent", mints: ["driver/connotation-search.mjs:2126"], rollsUpTo: ["connotation_cite_absent"],
    why: "#592, as token_absent. repairs.mjs:353: `row-level only — never a top-level token`." },
  { code: "no_ruling", mints: ["driver/connotation-search.mjs:2133"], rollsUpTo: ["connotation_no_ruling"],
    why: "The residual the other two split off from, and it has representatives — see the mint site. Declared as a corrective token at repairs.mjs:308 and in stages.mjs's E1 rows, always namespaced." },
  // THE ONE THAT IS RENAMED, NOT NAMESPACED — and it is the reason this table stores the composite as
  // data rather than deriving it. Every derivation anyone would write is `connotation_` + the code, and
  // for this row that produces `connotation_no_recorded_queries`, which nothing mints and nothing covers.
  // verify.mjs:912-913 states the ruling: a sweep that did not RUN is a canonical-only decision with its
  // own token and its own remedy, so the projector at verify.mjs:909 deliberately does not handle it.
  { code: "no_recorded_queries", mints: ["driver/connotation-search.mjs:1974"], rollsUpTo: ["connotation_search_missing"],
    why: "RENAMED, not namespaced: verify.mjs:398 emits `connotation_search_missing`. It is excluded from CONNOTATION_FORM_REASONS at connotation-search.mjs:1680 for exactly this reason." },

  // ── case-law-ledger.mjs — ONE token, the codes as census payload ─────────────────────────────────
  //
  // `caseLawLedgerFail` (case-law-ledger.mjs:195) returns `caselaw_ledger:<census>;<detail>`, and
  // `normalizeFailToken` cuts at the first colon — so the token is `caselaw_ledger` and every code below
  // lives in the payload. The `caselaw_ledger` row already carries `family:
  // "driver/case-law-ledger.mjs:204 (census reasons)"`, which is this ruling written down before the
  // census could read the shape it is written in.
  //
  // SUPPOSED `caselaw_no_queries` MIGHT BE A REAL HOLE. It is not a hole and it is not a token:
  // nothing in the tree mints that name. The guess came from reading this module by analogy with
  // connotation-search.mjs, which namespaces per code. This one does not.
  { code: "no_queries", mints: ["driver/case-law-ledger.mjs:166"], rollsUpTo: ["caselaw_ledger"],
    why: "Census payload of caselaw_ledger. The sweep cannot be shown to have run." },
  { code: "query_no_text", mints: ["driver/case-law-ledger.mjs:168"], rollsUpTo: ["caselaw_ledger"],
    why: "Census payload of caselaw_ledger. A query row with no text is a count, not a receipt." },
  { code: "query_no_jurisdiction", mints: ["driver/case-law-ledger.mjs:169"], rollsUpTo: ["caselaw_ledger"],
    why: "Census payload of caselaw_ledger. It cannot answer whether THIS territory was swept." },
  { code: "citation_no_proceeding", mints: ["driver/case-law-ledger.mjs:172"], rollsUpTo: ["caselaw_ledger"],
    why: "Census payload of caselaw_ledger. A link with no proceeding identity is not a citation." },
  { code: "citation_no_url", mints: ["driver/case-law-ledger.mjs:173"], rollsUpTo: ["caselaw_ledger"],
    why: "Census payload of caselaw_ledger. Nothing a reader can re-open." },
  { code: "citation_read_state", mints: ["driver/case-law-ledger.mjs:175"], rollsUpTo: ["caselaw_ledger"],
    why: "Census payload of caselaw_ledger. A read state outside CASE_LAW_READ_STATES." },
  { code: "dive_unread", mints: ["driver/case-law-ledger.mjs:186"], rollsUpTo: ["caselaw_ledger"],
    why: "Census payload of caselaw_ledger. Proceedings were found and none opened — the `ran thin` condition. Blocking, unlike its neighbour no_citations, which is why that one is an out-of-scope ruling and this one is here." },

  // ── coverage-form.mjs ─────────────────────────────────────────────────────────────────────────────
  //
  // ONE CODE, TWO TOKENS, and the split is by `cause` rather than by code: verify.mjs:1169 peels the
  // `axis_invalid` cause into its own family before verify.mjs:1178 counts the rest. A ruling naming only
  // `coverage_no_status` would be true of most `no_status` records and false of the ones that matter most.
  { code: "no_status", mints: ["driver/coverage-form.mjs:836"], rollsUpTo: ["coverage_no_status", "coverage_form_axis_invalid"],
    why: "Two composites, split on the record's `cause`: verify.mjs:1172 for cause `axis_invalid`, verify.mjs:1205 for the rest. NOT cited at coverage-form.mjs:810 — that is the JSDoc @returns annotation, not the mint." },
  { code: "engine_vocabulary", mints: ["driver/coverage-form.mjs:826"], rollsUpTo: ["coverage_form_engine_vocabulary"],
    why: "#669 — the seat wrote an engine token into the `reason` sentence that reaches the reader's page. Checked on settled rows too, because a row the seat considers finished is exactly the one whose sentence gets printed. Namespaced at verify.mjs:1165; the bare code names a row, never a stage." },

  // ── ONE CODE, TWO MODULES ────────────────────────────────────────────────────────────────────────
  //
  // `form_damaged` is minted in connotation-search.mjs AND coverage-form.mjs and becomes a different
  // token in each lane. The static census records the FIRST site it matched and no more, so its own
  // citation names one of the three mints — which is why `mints` is a list, and why a ruling copied from
  // the census output would have been half a ruling. verify.mjs:1075 already states the rule this row
  // records: `coverage_form_damaged`, never a bare `form_damaged`.
  { code: "form_damaged",
    mints: ["driver/connotation-search.mjs:1979", "driver/connotation-search.mjs:2055", "driver/coverage-form.mjs:818"],
    rollsUpTo: ["connotation_form_damaged", "coverage_form_damaged"],
    why: "Minted in two lanes and namespaced per lane: verify.mjs:1019 for the meaning sweep, verify.mjs:1119 for the register digest. The namespacing is what keeps them apart — see verify.mjs:1075." },
]);

/**
 * The files whose token literals the static tripwire reads. This is verify.mjs, the gateway wrapper, and
 * every local module verify.mjs imports a parser from — i.e. the whole surface this census claims to
 * cover. `contract-audit.mjs` asserts verify.mjs's own import list is a SUBSET of this, so wiring a new
 * parser into verify.mjs fails CI until the census covers it. That is what stops the census going stale
 * in the one way it cannot notice by itself.
 */
export const COVERED_SOURCES = [
  "verify.mjs", "gateway.mjs",
  "common-law-receipts.mjs", "connotation-search.mjs",
  "disposition-union.mjs", "record-origins.mjs",
  // B — verify.mjs reaches the typed transport's audit and its path resolver, so the tripwire reads both.
  // `disposition-call-audit.mjs` is where the four transport reasons live as literals; without it here
  // that family could grow a fifth member no vocabulary row covers, and nothing would notice.
  "disposition-call-audit.mjs", "disposition-tool.mjs",
  "repair-contract.mjs", "coverage-ledger.mjs", "register-plan.mjs", "coverage-form.mjs",
  "coverage-form-io.mjs", "register-taint.mjs", "tool-calls.mjs", "findings-model.mjs",
  "placement-model.mjs", "case-law-ledger.mjs", "framework.mjs", "named-band.mjs",
  "blind-frame-model.mjs", "frame-diff-model.mjs", "variant-manifest-model.mjs",
  // Conversion 2 — verify.mjs reaches matterFrameWasRecorded (the recorded-vs-dictated discriminator the
  // two matter-frame guard rulings key on), so the tripwire must read this module's token literals too.
  "matter-frame-record.mjs",
  // — the other acceptance boundaries. `frame-diff-record.mjs` and `blind-frame-record.mjs` are
  // here having been measured to mint NOTHING of their own: both delegate to their model parser and pass
  // its token-first throw through unchanged, so their families are already covered where they are raised.
  // They are listed anyway, because the cost of listing a module that mints nothing is zero and the cost
  // of the alternative — noticing, one day, that a module started minting — is the whole of this issue.
  "prelim-variants-record.mjs", "skeptic-record.mjs", "frame-diff-record.mjs", "blind-frame-record.mjs",
  // Conversion 4 — and this one MINTS, unlike the two delegating modules above it.
  "report-overview-record.mjs",
  // Conversion 5 — the fan-out transport; it mints its own family including the bound-index refusals.
  "report-card-record.mjs",
];

/**
 * THE ACCEPTANCE BOUNDARIES ARE GONE —, and this note is the headstone.
 *
 * `ACCEPTANCE_SOURCES` named the seven record modules whose refusals the `reason:` pattern was allowed to
 * read. It was scaffolding, declared as such by when it landed: running that pattern over every
 * covered source surfaced 21 further uncovered codes, and authoring 21 rulings without studying each is
 * how a census becomes confidently wrong.
 *
 * The 21 were studied. Every one is an inner code (INNER_CODES, 19) or a code no failure token can carry
 * (TRIPWIRE_OUT_OF_SCOPE, 2), each with its mint and its composite. So the narrowing has nothing left to
 * protect, and the pattern now runs over all of COVERED_SOURCES — which is the point, because the shape
 * it reads is the shape every conversion moves refusals INTO.
 */

/**
 * The tables whose rows carry a citation — the population 's symbol arms walk.
 *
 * Named once, here, rather than retyped in the test: a fifth table added later and missed by a hand-typed
 * list would be unchecked while every arm stayed green. The test asserts this map's own membership too,
 * so adding a table without registering it is a red rather than a silence.
 */
export const CENSUS_TABLES = Object.freeze({
  VOCABULARY, ARM1_EXEMPTIONS, TRIPWIRE_OUT_OF_SCOPE, STAGE_UNREACHABLE_VALIDATORS,
});

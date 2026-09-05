// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// contract-e3-backlog.mjs — E3's NAMED, SHRINKING BACKLOG.
//
// E3 is "structure is returned, never emitted as text": CI fails a stage message containing a literal
// JSON skeleton, an "EXACTLY these keys" clause, or a dictated line shape a parser re-parses. 74 such
// sites exist today across the 19 stages and the skill files they read, so E3 cannot simply go red —
// and it must not simply go green either. 's judging note applies verbatim:
//
//     "a lint that greenlights every existing hole certifies the problem."
//
// So the backlog is EXPLICIT, NAMED and ENUMERATED here, never implicit in a baseline number. Every
// entry names the site and the move that removes it, or states plainly that nothing on the plan does.
// A NEW violation fails immediately (contract-e3-baseline.json is a ceiling, checked per surface and
// per kind); an EXISTING one is on this list until a move deletes it, and then this list shrinks.
//
// ── THE HEADLINE IS THE BACKLOG, NOT THE COUNT ──────────────────────────────────────────────────────
//
// 14 of the 74 entries name a move. 62 name none — synthesis's seventeen-field enum
// apparatus, matter-frame's dictated lines, blind-frame's and frame-diff's JSON skeletons, register-unit's
// band-block contract, skeptic's ESCALATE line, case-law's retrieval record, narrative-refutation's
// verdict / [kind:] / [on:] tokens and doubt-closure's SETTLED lines
// are removed by NOTHING currently planned. That is the measurement E3 exists to keep visible.
//
// 83 → 76 ON 2026-08-16, AND NOT BY A MOVE ON THE PLAN. report-card's five frame entries all read
// "NOTHING ON THE PLAN REMOVES THIS" until assembly was made to compose the card frame from the
// finding record (driver/card-frame.mjs). That is why "removed by nothing planned" is a measurement
// and not a verdict: it says what the plan covers, never what is possible. report-card keeps THREE
// entries — its `- Source:` bullet, the `::p::` marker, and the injected JSON record — so its
// card grammar is no longer wholly unplanned and has been dropped from the list above.
//
// Some moves are PARTIAL and say so in their own words: M1 removes the opaque-token half of a site and
// leaves the surrounding skeleton standing; M2 removes a quote field, not the line shape carrying it.
// A partial removal does not retire an entry — it rewrites it.
//
// Read `where` as a pointer to the authored site, not a line number to trust forever: line numbers move
// with every edit to stages.mjs. The stage + evidence pair is the durable identity.

// ── `surface` — HOW THE TEXT REACHES THE MODEL, WHICH `where` CANNOT SAY ────────────────────
//
// `where` names the file the dictation is AUTHORED in. It says nothing about how the seat receives it,
// and dictations are migrating from stage messages into tool answers as deliberate policy. To a check
// that only asks "is this quote in this file?", a dictation that MOVED SURFACE and one that was DELETED
// are the same red — and re-quoting or retiring the row, the two repairs a reader reaches for, are both
// wrong. Every such move would take a row out of E3's sight while the count stayed plausible.
//
// So each row declares its delivery surface from the closed enum in contract-audit.mjs:
//
//   stage-message         the text is in a stage's dispatch, whether written into stages.mjs or
//                         composed into the message by the driver at dispatch time
//   tool-response         an MCP server hands it to the seat as the answer to a tool call
//   skill-file            it is in a skill .md the stage reads
//   driver-written-form   it is in a form the driver writes into the run dir for the seat to fill in
//
// THE DECLARATION IS REFUTABLE, WHICH IS THE ONLY REASON IT IS WORTH HAVING. `backlogSurfaceMisses`
// requires a WITNESS among the paths the row already names: a `tool-response` row names a server module,
// a `skill-file` row names a .md some stage actually reads. Move a dictation into a tool answer and
// update `where`, and the `stage-message` witness disappears and CI goes red. Move it and leave `where`
// alone, and `backlogSurfaceMoves` finds the anchor on the surface it went to and names that surface.
//
// IT IS A REFUTER, NOT A CLASSIFIER, and it cannot become one. Two derivations were measured over all 51
// rows before this shape was chosen, and each is wrong on a live row: reading the surface off the file
// that CONTAINS the anchor calls common-law-half a driver module (connotation-search.mjs authors it;
// perplexity-server.mjs delivers it), and an MCP import closure calls register-digest's brief a tool
// response through coverage-server → coverage-tool → coverage-form, when pipeline.mjs:3553 appends it to
// the stage message. The finding is precisely that authorship and delivery come apart, so no function of
// the authored path can decide the answer.
//
// `driver-written-form` HAS NO MEMBERS TODAY and is kept anyway: it is the honest home for the shape,
// and an enum that omits it would push the next such row into whichever member fits worst. Its zero is
// pinned in E3_SURFACE_CENSUS below, so the row that arrives is an event rather than an absorption.

/** @type {Array<{stage:string, kind:string, where:string, evidence:string, reparsedBy:string, removedByMove:string}>} */
/**
 * DATA-INPUT FENCES — sites the E3 lint counts that are NOT dictation, each named with its reason.
 *
 * The taxonomy's own definition of the kind is "a JSON object/fence written INTO the instruction for the
 * model to IMITATE". A record the driver `JSON.stringify`s into the prompt so the seat has the only
 * source it may use is the OPPOSITE category: the seat is handed data, and it is not asked to reproduce
 * its shape anywhere. The lint's regex cannot tell the two apart — ` ```json ` matches both.
 *
 * SO THE EXEMPTION IS LOUD, NEVER A REGEX TWEAK. Narrowing the pattern until this site stopped matching
 * would silence the next real literal skeleton with it, and nobody would know which. The E3 test PRINTS
 * every entry here on each run, and asserts each still resolves and still carries a reason long enough to
 * be one — the dead-names guard's rule, that a guard which exempts must name the exemption and why.
 *
 * Each entry: `{ stage, kind, where, why }`.
 */
export const E3_DATA_INPUT_EXEMPTIONS = [
  {
    stage: "report-card",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs — the finding's own record, JSON.stringify'd into the dispatch",
    why: "The card seat is HANDED this record; it is the ONLY source it may use, and it is never asked to "
      + "emit JSON of any shape — its whole output goes back through record_report_card as typed values. "
      + "The sanctioned-equivalents ruling for this stage keeps the record inline in as many words ('the "
      + "finding's record stays INLINE in the dictation'), so no move retires this and none should. "
      + "Counted as a dictation it would sit on the backlog forever as work nobody can do, which is how a "
      + "register of real violations stops being read.",
  },
];

export const E3_BACKLOG = [
  // ── prelim-variants: FOUR ROWS RETIRED BY CONVERSION 3 ──────────────────────────────────────────
  //
  // Two `literal-json-skeleton` and two `exactly-these-keys`, all four stamped "NOTHING ON THE PLAN
  // REMOVES THIS". The conversion removed them:
  //
  //   stages.mjs:922            the dispatch dictated variant-manifest.json key by key and enum by enum;
  //                             `record_prelim_variants`'s schema IS that shape now, so the key-set and
  //                             enum families are unreachable from a typed call rather than caught after
  //                             the file is written.
  //   stages.mjs:774-808        the same skeleton's category enum, same fate.
  //   prelim-variants SKILL.md  the `### Scope ledger` markdown table and its column contract. The rows
  //                             arrive typed; the driver renders the table AND serialises
  //                             scope-ledger.json from them through one shared function.
  //
  // THIS ONE DELETES A DERIVATION RATHER THAN MOVING IT, which is the difference from conversion 2's
  // remainder. `scope-ledger.json` used to be recovered by parsing that table back out of the prose
  // (`renderScopeLedgerJson(readFileSync(P.variantManifest))`); it is now serialised from the typed rows,
  // and the prose parse survives ONLY for a manifest this build did not write. There is no round trip
  // left to record as an honest remainder.
  // ── matter-frame: FIVE ROWS RETIRED BY CONVERSION 2 ─────────────────────────────────────────────
  //
  // Every one of them was a DICTATED LINE SHAPE with a parser that re-read it, and every one carried
  // "NOTHING ON THE PLAN REMOVES THIS". The conversion removed them, which is the only way a row
  // leaves this list — the E3 guard below refuses a row that outlives its dictation, and it is what
  // caught these three seconds after the dispatch was rewritten.
  //
  //   `## Instructed scope`      the driver STAMPS it from _driver/instructed-scope.json; there is no
  //                              retyping left to re-parse, and frame_scope_missing was re-pointed at
  //                              the stamp rather than left standing green.
  //   `Search channels:`         typed `search_channels[]`; the driver renders the line channelsDiagnosis
  //                              still reads.
  //   `Meaning angles:`          typed `meaning_angles[]` + `meaning_angles_none`, which also splits the
  //                              asserted zero from the unanswered frame — a distinction the dictated
  //                              line could not carry.
  //   `### Intake asks`          typed `intake_asks[{ask, owner}]`; code renders the section, which is
  //                              what that row's own `why` had said the fix would be.
  //   SKILL.md's one-liners      the paragraph claiming the orchestrator dictates `Scope jurisdictions:`
  //                              is gone. That row was this audit's weakest class — a dictated shape with
  //                              NO parser and NO dictator — so it is deleted rather than converted:
  //                              nothing was writing it and nothing was reading it.
  //
  // HONEST REMAINDER, because retiring a row must not overstate what changed: the driver's own RENDER of
  // those lines is still re-parsed by its own consumers. That is a driver-internal round trip and a
  // strictly safer one — the values are typed at the boundary now, and no model has to hit a shape — but
  // it is not zero, and pointing the consumers at the record instead is a separate E3 question.
  {
    stage: "blind-frame",
    kind: "literal-json-skeleton",
    where: "driver/skills/blind-frame/SKILL.md:62-83",
    surface: "skill-file",
    evidence: "A JSON OBJECT with EXACTLY these keys:\\n```json\\n{\\n \"schema_version\": 1,\\n \"dominant_element\": \"the spine, verbatim\",\\n \"variants\": [{\"value\": \"DELPHI\", \"direction\": \"drop\", \"rationale\": \"…\"}],\\n \"fields\": […],\\n \"sources\": […],\\n \"ranking_basis\": \"goods-overlap\"\\n}\\n``` … `direction` is EXACTLY on",
    reparsedBy: "driver/verify.mjs validators.blindFrame — emits invalid_file:…:blindframe_* on an off-enum or missing key (stages.mjs:952-957 doc block)",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  // ── DISCHARGED 2026-08-17 by, and the row said this could not happen ──────────────────────────
  //
  // It read: stage "blind-frame", where "driver/stages.mjs:974", evidence "Emit the STRUCTURED model
  // (dictated keys + closed enums per the skill). It is your ONLY output file — do NOT write a prose
  // companion.", reparsedBy "verify.mjs validators.blindFrame …", removedByMove **"NOTHING ON THE PLAN
  // REMOVES THIS"**.
  //
  // removed it: the seat is no longer told to emit a file at all — it hands values to
  // `record_blind_frame` and the driver writes blind-frame-model.json. The row is deleted rather than
  // re-pointed because its subject no longer exists in served text, and E3's own rule is that a row
  // outliving its dictation is a defect. `removedByMove` was true of the plan and false of the
  // category conversion, which is worth keeping in view: a backlog entry names the plan it was surveyed
  // against, not every plan that might ever reach it.
  {
    stage: "common-law",
    kind: "dictated-line-shape",
    where: "driver/stages.mjs:1081 (emitted at 1032, 1061, 1147, 1276)",
    surface: "stage-message",
    evidence: "CROSS-CHECK HAND-OFF: … record it on its OWN line in EXACTLY the form \"CROSS-CHECK REQUIRED: <what> — <why>\" (that exact prefix; an em-dash between what and why; name the mark in CAPS in <what>). The driver parses ONLY this exact line shape…",
    reparsedBy: "driver/doubt-ledger.mjs:183 CROSS_CHECK_RE = /^(?:[-*]\\s+)?CROSS-CHECK REQUIRED:\\s*(.+?)\\s+—\\s+(.+?)\\s*$/ → mintCrossCheckDoubts",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "common-law-half",
    kind: "dictated-line-shape",
    // CONSOLIDATED 2026-08-16 from THREE rows (common-law stages.mjs:1031, common-law-half :1112 and
    // :1146). Those three existed because the dictation was AUTHORED at three sites in stages.mjs. M1 made
    // it one: authored once in renderConnotationObligations, and reaching the seat through the perplexity
    // MCP server (driver/engine/mcp/perplexity-server.mjs:111) rather than a stage message. Three rows
    // pointing at one block would fabricate two authored sites the surface does not have.
    where: "driver/connotation-search.mjs:1384-1397 (renderConnotationObligations; delivered to the seat via driver/engine/mcp/perplexity-server.mjs:111 — a TOOL RESPONSE, no longer a stage message)",
    surface: "tool-response",
    // ── (a) THE ORIGINAL SUBJECT WAS DELETED BY DESIGN — DISCHARGED, NOT FAILED ────────────────────
    // The old rows dictated `receipt_id` (an 8-char token the seat copied) and `quote`. Both are gone:
    //   receipt_id — M1 LANDED. stages.mjs states it outright: "No seat-facing text displays an id shape
    //     any more", and connotation-search.mjs carries " M1, FINISHED" over the retired text. The
    //     seat now gives `receipt_index`, a POSITION, and the driver resolves position to id.
    //   quote      — M2 LANDED. The live field is `anchor` (prelim-common-law/SKILL.md:197).
    // Neither was reworded. Both were removed, and this row is discharged of them.
    //
    // ── (b) THE NEW, NARROWER CLAIM — RE-EVIDENCED for B (the form path is DELETED, owner ruling
    // 2026-08-17). The seat is no longer told to open any file: the surviving position-dictation now
    // orders a `record_dispositions` CALL carrying `row_index` / `receipt_index` / `ruling` / `note` per
    // row, and the receiver resolves BOTH positions — made the row an ordinal too, on the finding
    // that the block had never printed the `row_id` it was ordering. Same dictated shape, same one
    // authored site, new route. The old OPEN-IT evidence was removed by the deletion, not reworded away —
    // this row's evidence follows the dictation so the row keeps describing something that exists.
    evidence: "HOW TO RECORD THEM. Call the `record_dispositions` tool — never write or edit any file for this. … Both numbers are enough. You never type an identifier of any kind — not a row id, not a receipt id, … not a query. The driver resolves each number and records what it resolves to. A row listed with … exactly ONE receipt is already resolved; it needs no",
    reparsedBy: "driver/disposition-call.mjs validateDispositionCall + driver/disposition-union.mjs seatFields — the receiver validates each row as it arrives and binds `receipt_index` to the row's own candidate id",
    removedByMove: "M1 and M2 BOTH LANDED and removed what these rows originally described; B then deleted the form path itself. The surviving position-dictation (as a typed call) is removed by NOTHING on the #850 plan",
  },
  {
    stage: "common-law",
    kind: "literal-json-skeleton",
    where: "driver/skills/prelim-common-law/SKILL.md:123-170",
    surface: "skill-file",
    evidence: "### Format\\n```markdown\\n# Common-law findings — Dawn: Legends of Thornmantle (2026-05-11)\\n\\n## Summary\\n\\n- Perplexity calls executed: 4 …",
    reparsedBy: "driver/publish/audit-from-spine.mjs:14 parseTables → parseSpineFindingBlocks (audit-from-spine.mjs:123) re-parses the common-law finding tables into audit.md",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "common-law",
    kind: "dictated-line-shape",
    where: "driver/skills/prelim-common-law/SKILL.md:175 (restated at driver/skills/prelim-search/synthesis-rules.md:394)",
    surface: "skill-file",
    evidence: "A clean PR/connotation row MUST cite its search — add a `**Connotation-search source:** <URL | \"perplexity_research — no result\">` line.",
    reparsedBy: "driver/connotation-search.mjs — validators.commonLaw rejects a clean claim with no such line (connotation_search_missing); the hint is re-dictated at driver/gateway.mjs:1824",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "common-law",
    kind: "dictated-line-shape",
    where: "driver/stages.mjs:1054 and driver/stages.mjs:1059 (the no-grid-spec legacy branch)",
    surface: "stage-message",
    evidence: "GRID KEYS (the validator checks EXACTLY these N terms — use each VERBATIM as its Negative-results matrix key…) … MACHINE RECEIPTS (MANDATORY): save the grid call's stdout JSON VERBATIM … the single stdout object, or a JSON ARRAY of the per-batch stdout objects in batch order when batched.",
    reparsedBy: "driver/common-law-receipts.mjs — the receipts gate's exact identity join on the dictated key list; validators.commonLaw grid-completeness arm",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  // ── DISCHARGED AND DELETED 2026-08-17 — common-law-half, SKILL.md's anchor dictate ────────
  //
  // The row that stood here guarded the ANCHOR-field dictate: "a SHORT fragment, roughly a handful of
  // words, copied exactly from the snippet text". **That text no longer exists at the site.** It was not
  // reworded and it did not move — it was deleted with the order it carried, and this row goes with it.
  //
  // WHY THIS IS A DISCHARGE AND NOT A RESCOPE. The row's kind is `dictated-line-shape`: a model authors a
  // string and code REPARSES it. That is exactly what the anchor was — `anchorBinding` took the seat's
  // fragment and used it to LOCATE an extraction span, so a model-typed string decided which bytes reached
  // a delivered artifact. splits that into an ordinal the driver resolves (`segment_index`, the
  // M1 pattern this programme treats as the CURE) and a proof the driver only CONTAINMENT-CHECKS
  // (`fragment`). Nothing the seat types is parsed for content any more: the quote is sliced from the
  // driver's own numbered segment, so the string a model authored no longer selects anything.
  //
  // The previous rescope of this row (2026-08-16) narrowed it from `receipt_id` + `quote` to the anchor
  // alone, saying the resolve "cannot be read as the old claim having held". Same discipline here: the
  // anchor claim is not being quietly declared satisfied — the dictate it described is gone from the
  // served text, and the E3 unresolved set is expected to shrink by this row's evidence in the same
  // commit rather than to acquire a row nothing resolves.

  {
    stage: "register-unit",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:2243 (the non-supplemental-lane branch)",
    surface: "stage-message",
    evidence: "BAND ARTIFACT (MANDATORY): ALSO write the COMPLETE NAMED BAND for this axis to <path> — a JSON ARRAY, one block per register_enumerate / count-probe call, in the named-band contract: {\"state\":\"enumerated\",\"query\":\"<what was searched>\",\"total_hits\":N,\"records\":[{record_id, mark_text, classes, status,",
    reparsedBy: "driver/named-band.mjs parseNamedBand / bandRecords / bandCrowds / mergeNamedBands (named in driver/skills/prelim-register/unit.md:60-62); validators.registerUnit",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "register-unit",
    kind: "exactly-these-keys",
    where: "driver/stages.mjs:2207",
    surface: "stage-message",
    evidence: "Every block you append MUST carry \"state\":\"enumerated\" (ONLY if you paged it to has_more:false) or \"state\":\"incomplete\" — EXACTLY those two strings; there is no \"verified\"/\"checked\"/\"complete\"/\"clean\" state, and any other value fails the stage.",
    reparsedBy: "driver/named-band.mjs parseNamedBand (off-enum state fails validators.registerUnit)",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "register-unit",
    kind: "literal-json-skeleton",
    where: "driver/skills/prelim-register/unit.md:83-97",
    surface: "skill-file",
    evidence: "Two block shapes (no third):\\n```json\\n[\\n { \"state\":\"enumerated\", \"query\":\"…\", \"total_hits\": 12, \"records\": [ { \"record_id\":\"/mark/eu/018…\", \"mark_text\":\"…\", … } ] },\\n { \"state\":\"incomplete\", \"query\":\"…\", \"total_hits\": 2416, \"fetched\": 1, \"sample\":[ … ], \"reason\":\"…\" }\\n]\\n```",
    reparsedBy: "driver/named-band.mjs parseNamedBand — named in the skill file itself at unit.md:60-62",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "register-unit",
    kind: "exactly-these-keys",
    where: "driver/stages.mjs:4177 (the frame-reopen / scoped-retry message builder). A second number stood here and had been stale for some time: it pointed at a contract-element description rather than a builder, at its old line and at every mechanical shift of it. Two candidate builders sit beside 4157 and picking one would be a guess, so the wrong pointer is removed rather than moved a third time — one accurate citation beats one accurate and one invented.",
    surface: "stage-message",
    evidence: "Every block you append MUST carry \"state\":\"enumerated\" (ONLY if paged to has_more:false) or \"state\":\"incomplete\" — EXACTLY those two strings … (re-dispatch builders, which REPLACE def.message)",
    reparsedBy: "driver/named-band.mjs parseNamedBand. Scope warning: these builders replace def.message on every escalation / envelope-close / frame-reopen dispatch, so an E3 lint that walks STAGES[*].message only never sees them",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "placement-inquiry",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:2349-2353",
    surface: "stage-message",
    evidence: "PLACEMENT FORM (MANDATORY): record every placement in <path> — {\"rows\":[…]} … · A REGISTER candidate: {\"select\":\"<one record URI it holds>\",\"tier\":\"…\",\"reason\":\"…\"} (+ optional \"borderline\":true) … · A COMMON-LAW candidate …: {\"kind\":\"seat\",\"mark\",\"owner\",\"jurisdiction\",\"records\":[],\"tier\",\"reason\"}",
    reparsedBy: "driver/placement-form.mjs (SELECT_ROW_FIELDS at placement-form.mjs:93, the seat-row contract at 97-105, formRowKey/rowIsSettled/renderEntry at 117-141) via validators.placement. The same field list is ALSO carried in the driver-written form's own seat_row_contract, so the shape exists twice",
    removedByMove: "M1 removes the opaque `select` URI (ordinal selection) — it does not remove the JSON skeleton, the retract shape, or the kind:\"seat\" row",
  },
  {
    stage: "placement-inquiry",
    kind: "exactly-these-keys",
    where: "driver/stages.mjs:2403",
    surface: "stage-message",
    evidence: "· tier EXACTLY one of headline-candidate / sheet-2 / watchlist-annex / out-of-scope-filtered.",
    reparsedBy: "driver/placement-form.mjs / driver/placement-model.mjs via validators.placement",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "placement-inquiry",
    kind: "exactly-these-keys",
    where: "driver/skills/placement-inquiry/SKILL.md:44-52",
    surface: "skill-file",
    evidence: "**2. The structured mirror** `…/placements.json` … `{\"schema_version\":1,\"placements\":[...]}`, ONE object per placed candidate, keys EXACTLY `{\"mark\",\"owner\",\"jurisdiction\",\"records\",\"tier\",\"reason\"}` plus the optional `\"borderline\"` … `tier` — EXACTLY one of `headline-candidate` / `sheet-2` / `watch",
    reparsedBy: "driver/placement-model.mjs. AND IT IS STALE: #562 made placements.json driver-rendered, and stages.mjs:2373 says \"DO NOT WRITE placements.json (the driver renders it from this form)\" — the skill file the stage is ordered to \"read and follow exactly\" dictates the key set of a file the message forbids it to write. Two contracts in one dispatch",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "placement-inquiry",
    kind: "dictated-line-shape",
    where: "driver/skills/placement-inquiry/SKILL.md:42",
    surface: "skill-file",
    evidence: "Use these section headings, in this order: **Band reconciliation** …, the four placement tiers (**Headline candidates**, **Sheet 2 / register watch**, **Watchlist annex**, **Out-of-scope / filtered**), **Disagreements / flags surfaced to downstream**, **Coverage rulings & open questions** …, and **O",
    reparsedBy: "driver/pipeline.mjs — the PLACEMENT RULINGS TAIL block handed to register-digest is lifted from these named sections (stages.mjs:2559 references it); driver/skills/prelim-register/digest.md:342-352 re-parses the Disagreements section into its own table",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  // RETIRED 2026-08-16 — register-digest's no-form arm. M6 DELETED THE DICTATION ON 2026-08-14 AND THIS
  // ROW OUTLIVED IT BY TWO DAYS. Verified at source rather than from the epitaph: the arm is absent from
  // the composed message, `git grep "NO coverage form"` on origin/main returns exactly ONE hit and it is
  // the COMMENT recording the deletion (stages.mjs:2193), and skill-contract-enumerations.test.mjs
  // composes the dispatch under both stamp states and asserts the two texts are equal.
  //
  // The surviving prose arms in verify.mjs are NOT dead code and must not be tidied away with it: they
  // are load-bearing for ARCHIVED replays, and replay verdicts get quoted. Removing them would mutate
  // records nobody ordered.
  {
    stage: "register-digest",
    kind: "exactly-these-keys",
    // RE-EVIDENCED at the typed-transport conversion (the coverage form goes the way of B's
    // disposition form, one lane over). The OPEN-IT dictation this row was quoted from — "Set
    // \"status\" (EXACTLY one bare token …) and \"reason\" on EVERY row and change nothing else" —
    // was REMOVED by the conversion, not reworded: the seat is no longer told to open any file. What
    // survives at the same authored site is the dictation of the CALL — every status rides
    // `record_coverage` — and the enum itself reaches the seat through the dispatch's coverage block
    // (coverage-form.mjs coverageFormBrief) and the tool schema, with every row receiver-validated at
    // call time. Same dictated vocabulary, same authored site, new route — this row's evidence follows
    // the dictation so the row keeps describing something that exists.
    where: "driver/stages.mjs:2608 (the digest message) + driver/coverage-form.mjs (coverageFormBrief — the dispatch block carrying the enum and the row shape)",
    surface: "stage-message",
    evidence: "Record a \"status\" and a \"reason\" on EVERY row ONLY by calling the … tool — the driver validates each row as it arrives, holds the record itself, and renders both the ## Coverage ledger table and the coverage JSON from it",
    reparsedBy: "driver/coverage-call.mjs validateCoverageCall (receiver-validated at call time, the same predicates the gate judges with) + driver/coverage-form.mjs rowIsSettled via validators.registerFindings over the _driver/ accumulator",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  // ── (a) THE ORIGINAL SUBJECT WAS DELETED BY DESIGN — DISCHARGED, NOT FAILED (conversion 11) ───────
  //
  // This row quoted the 336-line ```markdown fence at digest.md:11-347 — the whole register-findings.md
  // document skeleton, which the seat was shown in order to type it. Conversion 11 made the document the
  // driver's and the fence went with the dictation: `grep -n '^```' digest.md` now returns nothing, and
  // the E3 surface census records the shrink (digest.md dictated-line-shape 7 → 4). Its `removedByMove`
  // read "NOTHING ON THE PLAN REMOVES THIS", which was true of that plan and is why the conversion
  // programme, not, is what discharged it.
  //
  // ── (b) THE NEW, NARROWER CLAIM — what the same file dictates TODAY ───────────────────────────────
  //
  // Per the ruling the row is REWRITTEN, never deleted: deletion under-counts the backlog. What
  // survives in digest.md is one literal SHAPE, and it is the compulsory crowd row's `unit` value —
  // still typed to a dictated grammar because `crowdRulingCount` parses the count back out of that cell.
  // It rides `record_coverage`, not the findings call, so conversion 11 leaves it exactly where it was.
  {
    stage: "register-digest",
    kind: "dictated-line-shape",
    where: "driver/skills/prelim-register/digest.md:164 (Dominant-element reconciliation — the crowd row's `unit` grammar)",
    surface: "skill-file",
    evidence: "`<axis> / dominant-element crowd (<N> members): <one-line label for the residual class>`",
    reparsedBy: "driver/coverage-ledger.mjs crowdRulingCount reads `<N>` back out of the `unit` cell, and driver/recall-reconciliation.mjs parseCrowdRulings turns it into the residual denominator the delivery gate blocks on",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS. It is a `record_coverage` value, not a findings-document shape, so conversion 11 does not reach it — the count is dictated because a code reader parses it back out of the label, which is the join no typed field currently carries.",
  },
  {
    stage: "register-digest",
    kind: "exactly-these-keys",
    where: "driver/skills/prelim-register/digest.md:233-241",
    surface: "skill-file",
    evidence: "- `axis` — EXACTLY one bare token of: `saturation-probe` / `primary-sweep` / `transliteration-numeric` / `incumbent-class`. **That vocabulary is CLOSED** and a row whose axis is outside it is refused.",
    reparsedBy: "driver/coverage-form.mjs (seat-row contract; SEAT_ROW_CONTRACT rides the accumulator) — and, since the typed-transport conversion, driver/coverage-call.mjs validateCoverageCall refuses an off-vocabulary axis AT CALL TIME (axis_invalid), so the dictation is receiver-checked in the same turn it is obeyed",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "register-digest",
    kind: "dictated-line-shape",
    // ── (a) THE ORIGINAL SUBJECT WAS DELETED BY DESIGN — DISCHARGED, NOT FAILED. This row quoted
    // "ARM 2 — a run with NO coverage form … Write one row per coverage unit | Coverage unit | Status |
    // Reason |". M6 (, 2026-08-14) deleted the code arm and (cdf38676) deleted this
    // skill-file half two days later — exactly the both-sites deletion this row's removedByMove
    // demanded. `git grep "ARM 2"` on the skill file returns nothing. Its evidence sat in
    // E3_EVIDENCE_UNRESOLVED from the day the checker landed; per the ruling the row is
    // REWRITTEN, never deleted — deletion under-counts the backlog.
    // ── (b) THE NEW, NARROWER CLAIM — what the same file dictates TODAY: the coverage statuses as a
    // closed vocabulary sent through the `record_coverage` typed call (the transport conversion, B's
    // pattern). The seat opens no file and writes no table; the dictated shape is the call's own two
    // values, receiver-validated as they arrive.
    where: "driver/skills/prelim-register/digest.md:216-218",
    surface: "skill-file",
    evidence: "- `status` — EXACTLY one bare token: `confirmed-clean` / `coverage-limited` / `deferred`. Qualifiers never go in the status; they go in the reason.",
    reparsedBy: "driver/coverage-call.mjs validateCoverageCall (status_invalid at call time) + driver/coverage-form.mjs rowIsSettled via validators.registerFindings; the archived-era prose-table reader (coverage-ledger.mjs parseCoverageLedgerFull) survives for replay only",
    removedByMove: "M6 LANDED and removed the no-form arm this row originally described (both sites). The surviving status-vocabulary dictation (as a typed call) is removed by NOTHING on the #850 plan",
  },
  {
    stage: "register-digest",
    kind: "exactly-these-keys",
    where: "driver/skills/prelim-register/SKILL.md:198-199",
    surface: "skill-file",
    evidence: "**The status vocabulary is CLOSED: EXACTLY one bare token of: `confirmed-clean` / `coverage-limited` / `deferred`.** Qualifiers never go in a status cell; they go in the reason.",
    reparsedBy: "driver/coverage-form.mjs / driver/coverage-ledger.mjs. Since the typed-transport conversion the STAGE MESSAGE no longer restates the enum; the surviving copies are SKILL.md (here), digest.md:207, the dispatch brief (coverage-form.mjs coverageFormBrief), the record_coverage schema (coverage-server.mjs) and gateway.mjs's repair hints — still one enum spelled at five sites",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  // ── DISCHARGED 2026-08-17 by (skeptic's conversion) ───────────────────────────────────────────
  //
  // It read: stage "skeptic", kind "dictated-line-shape", where
  // "driver/skills/prelim-search/phase2-execution.md:96-98", evidence "`## Escalation decisions` section the
  // driver parses verbatim: one `ESCALATE: <axis> — <reason>` line per register axis …", reparsedBy
  // "pipeline.mjs (same regex) — **the shape is dictated twice, in the message and in the skill file**",
  // removedByMove "NOTHING ON THE PLAN REMOVES THIS".
  //
  // Both dictations are gone: the seat sends {axis, reason} values and `renderSkepticFlags` is the one
  // authority for the line. The row's own note that the shape was dictated TWICE is why this had to be one
  // diff — deleting either copy alone would have left the other ordering a hand-write the grant now denies.
  // Its sibling row above (the stages.mjs copy) is discharged in the same commit for the same reason.
  {
    stage: "frame-diff",
    kind: "exactly-these-keys",
    where: "driver/stages.mjs:2788",
    surface: "stage-message",
    evidence: "For each blind-model variant / field / source the run did NOT scope or search, emit one directive {layer, item, observation, severity} … severity = dominant-element (the omission is ON the spine) | material (a real omission worth a targeted sweep) | minor (already covered, or presentation only).",
    reparsedBy: "driver/verify.mjs validators.frameDiff + driver/pipeline.mjs runSupplementalSweeps (the parser REFUSES a firing variant directive that dictates nothing dispatchable)",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  // DISCHARGED by 's third conversion. The row described SKILL.md's "Then ALSO save the STRUCTURED
  // diff … a JSON OBJECT with EXACTLY these keys" skeleton, and that order is gone: the seat calls
  // `record_frame_diff` and the driver serializes the object. What replaced it in the doc is a field list
  // for a typed call, which is not a dictated skeleton — the schema owns those names, and a seat cannot
  // mistype a key the transport does not accept. `removedByMove` read "NOTHING ON THE PLAN REMOVES
  // THIS", which was true of the plan and not of the conversion that came after it.
  {
    stage: "frame-diff",
    kind: "literal-json-skeleton",
    where: "driver/skills/frame-diff/SKILL.md:44-48",
    surface: "skill-file",
    evidence: "A directive may carry a structured `remedy`:\\n```json\\n\"remedy\": { \"terms\": [\"TROPICAL TIKI\", \"ISLAND TIKI\"], \"nice_classes\": [\"5\", \"32\"], \"regions\": [] }\\n```",
    reparsedBy: "driver/pipeline.mjs runSupplementalSweeps — the remedy lint refuses a label-shaped term; stages.mjs:2788 restates the same shape in the message (\"THE ASK CONTRACT, stated at BOTH levels\")",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3164",
    surface: "stage-message",
    evidence: "MACHINE FINDINGS (MANDATORY): … a JSON OBJECT {\"schema_version\":<FINDINGS_SCHEMA_VERSION>,\"rated_under_framework\":\"…\",\"findings\":[...],\"coverage\":[...],\"context_notes\":[...],\"actions\":[...],\"ask_answers\":[...]} … Each finding object has EXACTLY these keys: {\"ordinal\",\"mark\",\"owner\",\"band\",\"net\",\"bor",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson via validators.narrative",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  // RETIRED 2026-08-16 — synthesis's dictated disposition list, and I am the one who left it standing.
  // landed that morning and replaced the hardcoded four with `${POSITION_REQUIRED_DISPOSITIONS
  // .join(" / ")}`; the literal is gone from origin/main and the row survived until this check found it
  // four hours later. Knowing about the stale-row disease did not stop me causing an instance of it,
  // which is the whole argument for the check being mechanical rather than a habit.
  {
    stage: "synthesis",
    kind: "exactly-these-keys",
    where: "driver/stages.mjs:3200",
    surface: "stage-message",
    evidence: "- off_field_ground (MANDATORY on every off-field finding, FORBIDDEN on every other disposition): EXACTLY one bare token of: ${OFF_FIELD_GROUNDS.join(\" / \")}",
    reparsedBy: "driver/findings-model.mjs validateOffFieldGround — the enum is imported from findings-model.mjs and interpolated back into the prompt, so code already holds the list it asks the model to type",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3201",
    surface: "stage-message",
    evidence: "- manageable …: {\"category\":\"<EXACTLY one of large-competitor / commercial-partner / troll / well-known-enforcer>\",\"reason\":\"<one-two lines…>\"}",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3217",
    surface: "stage-message",
    evidence: "- meters: {\"mark_similarity\":{...},\"goods_proximity\":{...},\"use\":{...},\"enforcer\":{...}} — all four present, each {\"token\",\"basis\",\"source\"}. … mark_similarity = high | medium | low. goods_proximity = high | medium | low. enforcer = high | medium | low | unknown. use = confirmed | not-confirmed | un",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson; driver/verify.mjs:1008 checkFindingsSibling gates meters.*.source; finding_basis_source_missing",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3218",
    surface: "stage-message",
    evidence: "- quadrant: {\"x\",\"y\"} numbers in [0,1]. x = goods/services proximity (0 = distant, 1 = identical). y = mark similarity (0 = distinct, 1 = identical).",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3219",
    surface: "stage-message",
    evidence: "- source: {\"source_type\",\"resolved_link\"}. source_type EXACTLY one of: register-vendor / register-euipo / common-law-marketplace / common-law-web / case-law",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson",
    removedByMove: "M1 removes the opaque `resolved_link` URI (ordinal / record-handle selection); the object shape and the source_type enum survive",
  },
  {
    stage: "synthesis",
    kind: "exactly-these-keys",
    where: "driver/stages.mjs:3220",
    surface: "stage-message",
    evidence: "coverage[]: ONE object per coverage AREA, EXACTLY {\"area\",\"state\",\"note\"}. … state EXACTLY one of: confirmed-clean / coverage-limited / open / not-searched / note.",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson; the render owns the coverage panel from these typed states",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3229",
    surface: "stage-message",
    evidence: "use_check = {\"source\",\"quality\"}: … quality: OPTIONAL, EXACTLY one of owner-site / independent / register-mirror … own_rights = {\"source\"}",
    reparsedBy: "driver/verify.mjs:988 checkFindingsSibling (finding_use_check_missing); driver/own-rights.mjs:19-22",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3286",
    surface: "stage-message",
    evidence: "MARK ASSESSMENT … STRUCTURED FORM …: either field may instead be an OBJECT {\"read\":\"…\",\"spectrum\":\"…\",\"per_class\":[{\"class\":\"5\",\"note\":\"…\"}],\"per_market\":[{\"market\":\"CN\",\"note\":\"…\"}],\"counter_registrations\":[{\"mark\":\"…\",\"uri\":\"/mark/…\",\"note\":\"…\"}],\"acquired\":\"<optional>\",\"note\":\"<optional residual>",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson; the report collapses the rows behind toggles and the audit workbook renders them",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3292",
    surface: "stage-message",
    evidence: "FOUR ANSWERS …: \"four_answers\": {\"third_party_rights\":{...},\"objection_likelihood\":{...},\"registrability\":{...},\"client_enforceability\":{...}} … Each answer … is {\"read\":\"…\",\"token\":\"…\",\"basis\":\"…\",\"ordinals\":[…]}. Tokens (closed enums …): third_party_rights = strong|moderate|weak; objection_likelih",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3217",
    surface: "stage-message",
    evidence: "ACTIONS REGISTER …: emit \"actions\": [...] — ONE object per forward step …, each EXACTLY {\"id\",\"kind\",\"text\",\"ordinals\"} plus an OPTIONAL \"deadline\" and an OPTIONAL \"condition\". … kind: EXACTLY one of — consent / coexistence-agreement / territorial-delimitation / goods-amendment / mark-modification /",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson; pipeline applyCoverageFloor legalActions arm derives the delivered disposition from the closed kind enum",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "exactly-these-keys",
    where: "driver/stages.mjs:3299",
    surface: "stage-message",
    evidence: "COVERAGE JUDGMENT …: emit \"coverage_judgment\": {\"sufficient\":<bool>, \"reason\":\"<one line…>\"} — EXACTLY those two keys. Do NOT emit \"rows\": the driver writes that register itself … anything you type there is replaced wholesale.",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson. The \"Do NOT emit rows\" clause is the purest E3 case in the tree — the prompt names a field, dictates its shape and states in the same breath that code overwrites it",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3142",
    surface: "stage-message",
    // RE-QUOTED, NOT PARKED. The writer's conversion reworded this dictation — the
    // ask answers ride the findings RECORD now and the driver renders the labelled line into both the
    // narrative and the report — so the old quote stopped anchoring. The dictation itself SURVIVES, so
    // the row survives with it and the quote is re-taken CONTIGUOUSLY from the current text. Parking it
    // in E3_EVIDENCE_UNRESOLVED instead would have grown the not-checked slice for a row that is
    // perfectly checkable, which is the avoidable coverage loss conversion 9's note names one row up.
    evidence: "SEND ONE \"ask_answers\" ENTRY PER ASK, as a TOP-LEVEL field of the findings record you hand to the call (never as a narrative section — the driver renders the labelled line",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson (finding_ask_answer_answer_missing); assembleReportMd · buildAskAnswersSection joins on the retyped ask string",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  // DELETED at conversion 10, recorded rather than absorbed — E3's own rule for a
  // shrinking set. The row was the synthesis narrative's "End the narrative with a section \"## Answers
  // to your instructions\"…" dictation, and that dictation is GONE from stages.mjs: the seat sends one
  // typed `ask_answers` entry per ask on the findings record and the driver renders the labelled line
  // into the narrative AND the report from the same entries, so there is no authored section left to be
  // parsed and then overwritten. Its quote never anchored (an escaped backtick inside the template), so
  // it sat in the anchor-not-found slice — where a DEAD row is invisible, because that bucket is for
  // un-anchorable quotes over live dictations. stage-message 31 -> 30 and the unresolved list 5 -> 4 in
  // this commit for the same reason.
  {
    stage: "synthesis",
    kind: "dictated-line-shape",
    where: "driver/stages.mjs:3063 (restated at driver/skills/prelim-search/synthesis-rules.md:428)",
    surface: "stage-message",
    evidence: "END that finding's actual-use line with a literal \"- **Use-check source:** <result URL | \"perplexity_research — no result\">\" line",
    reparsedBy: "driver/verify.mjs validators.narrative (spec-11 hard reject); the repair hint re-dictates the literal at driver/gateway.mjs:2153",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "dictated-line-shape",
    where: "driver/stages.mjs:3076 (restated at driver/skills/prelim-search/synthesis-rules.md:475)",
    surface: "stage-message",
    evidence: "END that finding's reasoning with a literal \"- **Own-rights source:** <record URI(s) | \"no applicant-owned registrations in the searched register material\">\" line",
    reparsedBy: "driver/own-rights.mjs:19-22 — \"This module only requires the 'Own-rights source:' line to exist\"; repair hint at driver/gateway.mjs:2361 (the `own_rights_missing` branch; re-verified 2026-08-29 — the old :1736 predated this branch and pointed into the A4 repeat-signature block)",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "exactly-these-keys",
    where: "driver/stages.mjs:3278",
    surface: "stage-message",
    evidence: "add it to the top-level \"context_notes\" array — each object EXACTLY {\"type\":\"famous-neighbour-ungrounded\",\"mark\",\"owner\",\"context\"}",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "synthesis",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3166",
    surface: "stage-message",
    evidence: "- owner: {\"name\",\"country\",\"registrations\":[...]}. … Each registration: {\"uri\", optionally \"classes\":[\"9\",\"41\"],\"status\",\"filed\",\"expiry\",\"jurisdiction\"}. The \"uri\" is the ONLY field that matters: the driver BINDS classes/status/filed/expiry/jurisdiction AND the owner name from the FETCHED record ke",
    reparsedBy: "driver/findings-model.mjs:813 parseFindingsJson + the record-binding join. Six of the seven keys are stated in the prompt and overwritten by code in the same sentence",
    removedByMove: "M1 removes the opaque `uri` (ordinal / record-handle selection against the band); the object skeleton and the five overwritten keys survive",
  },
  {
    stage: "case-law",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3448",
    surface: "stage-message",
    evidence: "ALSO write the RETRIEVAL RECORD to <path> — a JSON OBJECT with EXACTLY these keys: {\"schema_version\":1,\"queries\":[{\"query\":\"<the search you dispatched, verbatim>\",\"jurisdiction\":\"…\",\"results\":<how many hits it returned>}, …],\"citations\":[{\"proceeding\":\"…\",\"forum\":\"…\",\"jurisdiction\":\"…\",\"decided\":\"…\"",
    reparsedBy: "driver/verify.mjs validators.caseLaw — the ledger arm, armed by the stage-contract marker `citations` (stages.mjs:1810)",
    removedByMove: "M5 moves `queries[]` to the call log (and is itself blocked: tool-calls.jsonl records no arguments); the envelope, schema_version, `read` enum and `citations[]` skeleton survive M5 entirely",
  },
  {
    stage: "case-law",
    kind: "dictated-line-shape",
    where: "driver/stages.mjs:3456",
    surface: "stage-message",
    evidence: "EVERY \"Grounded profile\" section MUST start its body with the line \"- ord: <N>\" naming which finding it grounds (use the ordinal from this list; a profile that grounds no listed finding omits the line)",
    reparsedBy: "driver/publish/parse.mjs:339 parseCaseLawProfiles (\"the optional '- ord: <N>' first body line … gives an EXACT join\"); driver/findings-model.mjs:273 /^-\\s*ord:\\s*(\\d+)\\s*$/m; driver/publish/index.mjs:776",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "case-law",
    kind: "literal-json-skeleton",
    where: "driver/skills/case-law-citation/SKILL.md:153-177",
    surface: "skill-file",
    evidence: "```markdown\\n### Grounded profile — <proposed mark> vs <conflicting mark / owner> (<jurisdiction>)\\n- ord: <N …>\\n\\n**Question grounded:** …\\n\\n**On-point authorities:** …\\n\\n**Tags:** … **Coverage gaps:** …\\n``` OR, when nothing is on point: ```markdown … **No on-point precedent found.** …```",
    reparsedBy: "driver/publish/parse.mjs:339 parseCaseLawProfiles — splits on /^#{2,3}\\s+Grounded profile\\s+—\\s+/m and reads the `- ord:` first body line",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "case-law",
    kind: "dictated-line-shape",
    where: "driver/skills/case-law-citation/SKILL.md:90-100",
    surface: "skill-file",
    evidence: "Copy this checklist into your working notes and tick each finding through it:\\n```\\nGrounding progress (per finding):\\n- [ ] Step 1: Pick the source(s) by jurisdiction; read that adapter\\n…\\n```",
    reparsedBy: "",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  // ✕ ROW DELETED BY CONVERSION 9 (the reviewer), and this note is what the table's own rule asks for.
  // It dictated "Write the verdict (CLEAR / CONDITIONAL / BLOCKING) on the FIRST line of the output".
  // The seat writes no output now — it sends `verdict` as a typed value and the driver renders the file,
  // so there is no first line for a seat to get wrong. The row is deleted rather than re-quoted because
  // the DICTATION is gone, not reworded: nothing in the dispatch asks for a line position any more.
  // Its own `reparsedBy` called the first-line rule "a prompt-side fiction the parser does not require";
  // the conversion made that literally true by removing the prompt side.
  {
    stage: "narrative-refutation",
    kind: "dictated-line-shape",
    where: "driver/stages.mjs:3588",
    surface: "stage-message",
    // RE-QUOTED BY CONVERSION 9. The LINE-TOKEN half is gone — no "anywhere on the line", no "[kind: …]
    // token", no "a line with no token is treated as fact", because a kind is a typed field now and an
    // untyped one is refused rather than defaulted. The VOCABULARY half survives verbatim, which is what
    // this row is about: the same four kinds, still declared by the seat, still re-parsed off the file.
    // ✕ QUOTED CONTIGUOUSLY AND WITHOUT BACKTICKS, both deliberate, both learned the hard way.
    //
    // The first re-quote elided the vocabulary list with `…` and the anchor could not locate it. The
    // second was contiguous and STILL could not: the dictation lives in a template literal, so the file
    // carries \`kind\` — escaped backticks — and a literal substring match fails on bytes the reader
    // never sees. Starting the span after that token avoids both. The row stays checkable, which matters
    // because an un-anchorable row lands in the NOT-CHECKED slice, and that is coverage lost rather than
    // a pass.
    evidence: "is ONE of coverage-disposition | fact | rating | narrative — pick the one your own legal read says the correction IS: coverage-disposition (a coverage row / disposition placement is wrong or dishonest)",
    reparsedBy: "driver/verify.mjs:684 CORRECTION_KIND_RE = /\\[kind:\\s*([a-z][a-z-]*)\\s*\\]/i → parseCorrectionKinds (verify.mjs:907), consumed in pipelineInner() in pipeline.mjs for the run.jsonl `correction-kinds` histogram, which since #1558 also carries `kindChannelOk` — the counts are DERIVED from the parsed rows, and that key states whether the reviewer's kind channel produced anything at all rather than leaving a reader to infer it by comparing untyped against total. Telemetry only today",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "narrative-refutation",
    kind: "dictated-line-shape",
    where: "driver/skills/narrative-refutation/SKILL.md:71",
    surface: "skill-file",
    // RE-QUOTED BY CONVERSION 9. The dictation survives and its CHANNEL changed: `on` is an array of
    // ordinals the seat sends, and the bracketed forms are now labelled as what the DRIVER renders. The
    // `[on: -]` case went from a value to an ABSENCE — you omit the field — which is the one part a
    // reader could get wrong from the old wording, since there is no value meaning "no finding".
    evidence: "**AND EVERY FLAG CARRIES WHICH FINDING IT IS ABOUT** — the `on` field, an array of ordinals. Same rule as `kind`: you send the values, the driver renders the token.",
    reparsedBy: "driver/verify.mjs:701 CORRECTION_ON_RE = /\\[on:\\s*([0-9,\\s-]*?)\\s*\\]/i. SKILL-FILE ONLY — the stage message at stages.mjs:1842-1877 never mentions `[on:]`. This is #850's \"the element shape is in the skill file, not the stage message\" in its purest form: an E3 lint reading stages.mjs alone sees the [kind:] token and misses its twin",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  {
    stage: "narrative-refutation",
    kind: "dictated-line-shape",
    where: "driver/stages.mjs:1869 and driver/skills/narrative-refutation/SKILL.md:41-50",
    // RE-QUOTED 2026-08-16. The dictated SENTENCE survives in narrative-refutation's SKILL.md — it is the
    // `evidence` below, verbatim. What changed is that the four kinds moved from an inline list after the
    // colon onto their own `- [kind: …]` bullet lines. Measured, not assumed: the old anchor matched 59 of
    // its 140 characters there. A grep for the TOKENS found them and
    // I briefly read that as the sentence being intact — a narrow instrument's HIT is no more a general
    // claim than its silence is a general absence.
    surface: "skill-file",
    evidence: "**EVERY FLAG CARRIES ITS KIND**, as the `kind` field — exactly one of: … `[kind: fact]` … `[kind: rating]` … `[kind: coverage-disposition]` … `[kind: narrative]`",
    // ✕ THE QUOTE MOVED WITH CONVERSION 9 AND THE DICTATION DID NOT. "YOU WRITE" went because the
    // reviewer no longer writes — it hands back a typed record. The row is NOT stale: the same four
    // kinds are still dictated, still in the bracketed form, and still re-parsed by countCitedDefects
    // off the RENDERED file. Deleting it would under-count the backlog, which this table's own note
    // calls the harder error to notice.
    reparsedBy: "driver/verify.mjs countCitedDefects (verify.mjs:~528) — counts bullet/numbered lines after the verdict line, excluding the PLAN-EXECUTION CHECK section; a BLOCKING with zero cited defects is refused as degenerate by `isDegenerate` in pipeline.mjs",
    removedByMove: "NOTHING ON THE #850 PLAN REMOVES THIS",
  },
  // ── RETIRED BY CONVERSION 4 — report-overview's FOUR entries, converted not replanned ────
  //
  // exactly-these-keys @ stages.mjs (the nine-key front-matter set), literal-json-skeleton @
  // delivery-contract.md:27-76 (the shell half of the 49-line fence), `other` @ delivery-contract.md
  // (classes / overall_label / overall_badge — DICTATED THEN OVERWRITTEN, the kind no lint can see), and
  // dictated-line-shape @ stages.mjs (the `# ACTIONS` sub-heading and list shape).
  //
  // All four carried `removedByMove: "NOTHING ON THE PLAN REMOVES THIS"`, which was true of that
  // plan and false of the category conversion — the same wording conversions 2 and 3 retired before this.
  // The seat sends values through `record_report_overview`; the driver renders every front-matter key,
  // the `# Actions` section and the optional `# Methodology` note. The fence was SPLIT rather than
  // deleted: report-card's `# Marks` half stands in that file until conversion 5 owns it.
  //
  // READ THE PIN'S NOTE BELOW BEFORE TREATING THE BASELINE DIFF AS PROOF OF THIS. The E3 lint counts
  // NONE of these four rows — measured, not assumed — so the baseline regen is not what records them.
  // ── RETIRED 2026-08-16 — report-card's frame, five entries, converted rather than replanned ────────
  //
  // The head (`## <owner> — <MARK>, <jurisdictions>`), `- ord:`, `- group:`, `- net:` and `- source:`
  // all read "NOTHING ON THE PLAN REMOVES THIS" until assembly was made to compose them from the
  // finding record (driver/card-frame.mjs; the branch is in assembleReportMd). The seat is now told
  // "no head, no meta lines" and writes the judgment block alone.
  //
  // `- group:` was the sharpest of the five and is worth keeping in words now that its entry is gone:
  // assembly OVERWROTE the seat's answer on every run since the VIBRANTE mislabel, so the seat was
  // ordered to type a value that was discarded on the same pass. The other four survived because the
  // group and net stamps anchored their regexes on `^##…\n(?:- ord:…\n)?` — the driver dictated a head
  // so that it had something of its own dictating to anchor on.
  //
  // The conversion is pinned to the ARTIFACT, not to this registry's wording: report-card-frame.test.mjs
  // recomposes every card in demo and asserts byte-equality with the delivered report.md,
  // meta-line order included. contract-e3-baseline.json's report-card ceiling drops 2 → 1 in the same
  // commit, per the shrink guard's own instruction.
  //
  // THREE report-card entries REMAIN below and are not touched here: the `- Source:` bullet (its own
  // change — code appending inside the judgment block, and parse.mjs lifts the head's link out of it),
  // the `::p::` marker (judgment-side), and the injected JSON record (the INPUT side, which E3's
  // clause 1 structurally cannot see).
  // ── RETIRED BY CONVERSION 5 — report-card's TWO dictated-line-shape entries ─────────────
  //
  // The `::p::` bullet-position rule (stages.mjs) and the final `- Source: [<register> · <id>](<url>)`
  // bullet (delivery-contract.md, the half conversion 4 left standing). Both were line templates a seat
  // had to hit and a parser then re-read; both are the driver's now. The Source one is the sharpest of
  // the pair — the seat was composing a URL from a provider host table this stage is not even given.
  //
  // THE THIRD ROW BELOW DOES NOT RETIRE, and that is a finding rather than an omission. See its own note.
  {
    stage: "report-card",
    kind: "literal-json-skeleton",
    where: "driver/stages.mjs:3897",
    surface: "stage-message",
    evidence: "The finding's OWN record — the ONLY source for this card …:\\n```json\\n<JSON.stringify(finding, null, 2)>\\n```",
    reparsedBy: "none — this is the INPUT side, and that is why it belongs in the survey: a full JSON object rendered into the prompt is exactly the mechanism #850 proves produced R-RECEIPT (the model pattern-matches a shown shape). E3's clause 1 as written (\"a code fence or inline example showing the exact object shape the model must emit\") does not reach an injected record, so the lint needs an explicit rule for shown-but-not-owed structure",
    removedByMove: "NOTHING REMOVES IT, AND NOTHING SHOULD — see e3Exempt below: this fence is the finding's own record HANDED to the seat as input, not a shape it is asked to imitate. Conversion 5 kept it inline per the sanctioned-equivalents ruling for this stage.",
  },
  // ── THREE doubt-closure ROWS REMOVED BY CONVERSION 6 ──────────────────────────────────────
  //
  // Recorded here rather than left as an absence, because the guard that forced this edit ("no backlog
  // row outlives the dictation it describes") can only see that they went, not why:
  //
  //   (line numbers are the coordinates AT CONVERSION 6'S COMMIT — the rows are gone from the live
  //   tree, so these are era-pinned history, deliberately not live citations the gate should resolve)
  //   dictated-line-shape  stages.mjs lines 2103-2105 then  SETTLED/OPEN, per doubt   — typed rows now
  //   dictated-line-shape  stages.mjs lines 2110-2113 then  IMMATERIAL/OPEN, per ask  — same call
  //   exactly-these-keys   stages.mjs line 2116 then        the bare-file-name enum   — `file_index` is a POSITION
  //                                                                          now, so there is no name to
  //                                                                          enumerate and an unallowed
  //                                                                          citation is inexpressible
  //
  // The third is the one worth pausing on: its `removedByMove` said "M2 — the quote half only; the closed
  // three-file enum survives". The enum did not survive the transport, because the transport removed the
  // FIELD it lived in rather than validating it — a schema that cannot express a bad value beats a
  // validator that rejects one, which is 's ruling applied one lane over.
];

/** Entries with no move on the plan that removes them. */
export const E3_UNPLANNED = E3_BACKLOG.filter((e) => e.removedByMove === "NOTHING ON THE #850 PLAN REMOVES THIS");

/**
 * THE TWO-DAY STALE ROW, MECHANIZED — entries whose quoted `evidence` no longer appears in the file
 * their `where` names, pinned as a NAMED, SHRINKING list exactly as the backlog itself is.
 *
 * The registry's failure mode was that a MOVE could delete a dictation and leave the row: the count
 * then overstates the work, and the next agent spends a conversion slot on a hole already filled. Two
 * instances existed when this was written — M6's register-digest arm (deleted 2026-08-14, row survived)
 * and synthesis's disposition list (, deleted the same morning by the agent adding this check).
 * Both are gone; this list is what remains.
 *
 * A BLANKET ASSERTION WAS THE OBVIOUS BUILD AND IT WOULD HAVE BEEN NOISE. Measured before choosing:
 * 17 of 78 entries failed a strict "the quote is still there" test, and most are the MATCHER's limits,
 * not stale rows — evidence strings elide with `…`, carry `${interpolation}` and `<placeholders>`, and
 * quote across a ternary that the source splits differently. An over-firing check is an unread check,
 * and this codebase has paid for that already.
 *
 * So the shape is the one E3 itself uses: the residue is ENUMERATED and pinned exactly, both
 * directions. A NEW mismatch fails (a move deleted a dictation and left its row). A RESOLVED one also
 * fails until it is removed here (so a fix is recorded rather than absorbed). What this list does NOT
 * claim is that its rows are matcher limits — that was an open question per stage, and it has now been
 * answered.
 *
 * ── TRIAGED 2026-08-16. NOT ONE ROW WAS STALE. ────────────────────────────────────────────
 *
 * All 15 were read against their sites. Every one described a dictation that still exists; what failed was
 * always the QUOTE. Three are re-quoted in this commit and clear: prelim-variants (its evidence was a
 * DESCRIPTION OF the site rather than text FROM it, so no matcher could ever have resolved it),
 * narrative-refutation (the sentence survives; its four kinds moved onto their own bullet lines), and
 * report-card (the dictation moved FILE, into the second path this row already named).
 *
 * THE COUNT WAS NEVER OVERSTATED — IT WAS MIS-QUOTED. Deleting a row would have UNDER-counted the backlog,
 * which is the opposite error and the harder one to notice.
 *
 * Four of the remaining twelve are a DIFFERENT job, not a re-quote: the `receipt_id` / `R-XXXXXXXX` rows
 * (`common-law` x2, `common-law-half` x2). M1 landed — stages.mjs says "M1 LANDED … no seat-facing text
 * displays an id shape any more" and connotation-search.mjs says " M1, FINISHED" — and their dictation
 * did not merely reword, it MOVED to connotation-search.mjs, a file their `where` does not name. A
 * relocation is tracked separately rather than folded in under a re-quote.
 */
export const E3_EVIDENCE_UNRESOLVED = [
  "blind-frame|driver/skills/blind-frame/SKILL.md",
  "common-law|driver/stages.mjs",
  // NOT ADDED by conversion 9, and that is deliberate. The reviewer's `TYPE EACH CORRECTION` row survives
  // the conversion with new wording, and the re-quote is CONTIGUOUS so its anchor still resolves. An
  // elided re-quote would have parked it here and grown the not-checked slice — avoidable coverage loss,
  // which this list is not for.
  // "matter-frame|driver/stages.mjs" — REMOVED by conversion 2, recorded rather than absorbed (E3's own
  // rule). The row it named is gone with the dictation it described: the frame's machine lines are typed
  // fields now and the driver renders them, so there is no un-anchorable quote left to be unresolved.
  "placement-inquiry|driver/stages.mjs",
  // register-digest|digest.md LEFT this list at the typed-transport conversion: the row was the
  // two-day-stale ARM-2 row this checker was built on, and it is now REWRITTEN (per the
  // rewrite-never-delete ruling) to the dictation that exists — the status vocabulary as a
  // `record_coverage` typed call. Its evidence resolves again, so the residue shrinks by one.
  // "skeptic|driver/stages.mjs" — REMOVED 2026-08-17 by, recorded rather than absorbed (E3's own rule
  // for a shrinking set). Its unresolved evidence was the `## Escalation decisions` dictation, and that
  // dictation is deleted: the seat sends {axis, reason} values and the driver renders the line.
  // "synthesis|driver/stages.mjs" (one of the two) — REMOVED by conversion 10, recorded rather than
  // absorbed. It was the narrative "## Answers to your instructions" row deleted above: its dictation is
  // gone, so there is no un-anchorable quote left to be unresolved. The one that REMAINS is a live row
  // whose quote spans a template line. Measured before deleting, not predicted — two rows shared
  // `where: "driver/stages.mjs:3045"`, so which one occupied this slot could not be read off the strings.
  "synthesis|driver/stages.mjs",
];

/**
 * THE PER-SURFACE CENSUS, PINNED EXACTLY IN BOTH DIRECTIONS.
 *
 * 's urgency claim is that `tool-response` GROWS — one surface at a time, each move taking a row out
 * of sight while the count stays plausible. A ceiling on that number would fail upward exactly as the E3
 * ceiling did: a surface that shrank would pass silently and leave room for a move nobody
 * recorded. So this is exact. A migration that moves a row from `stage-message` to `tool-response` turns
 * CI red until the number is written here, and writing it is how the migration gets RECORDED.
 *
 * `driver-written-form: 0` is a pin, not a placeholder. Nothing declares that surface today; the first
 * row that does will fail this assertion, which is the point — an empty enum member that quietly gains
 * its first member has been measured by nothing.
 *
 * Seeded 2026-08-18: 46 of the 51 rows had exactly one witnessed surface and were derived. Three
 * multi-witness rows were settled by the site their anchor resolves at (narrative-refutation to its
 * SKILL.md, two synthesis rows to stages.mjs). Two were decided by reading the delivering call site:
 * common-law-half is `tool-response` (perplexity-server.mjs:111), register-digest is `stage-message`
 * (pipeline.mjs:3553 appends coverageFormBrief to the dispatch).
 */
// 35 -> 32 stage-message. The three rows that left were the send stages' dictated line shapes
// — `notify`'s verbatim-HTML instruction and the two chat pings' EXACTLY-this-text lines. They were not
// converted and they did not migrate to another surface: the stages were DELETED with the delivery mode
// that was their only caller, so the dictation went with the dispatch that carried it. Nothing moved
// between rows, which is what this census exists to catch; one row shrank by three.
export const E3_SURFACE_CENSUS = Object.freeze({
  // 32 -> 31 at conversion 9: the reviewer's "verdict on the FIRST line of the output" row is deleted
  // with the dictation it described — the seat writes no output, so there is no first line.
  // 31 -> 30 at conversion 10: the synthesis narrative's "## Answers to your instructions" row goes the
  // same way — the answers are typed entries on the findings record and the driver renders both surfaces.
  "stage-message": 30,
  "tool-response": 1,
  "skill-file": 15,
  "driver-written-form": 0,
});

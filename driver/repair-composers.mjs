// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// repair-composers.mjs — THE ONE REGISTRY OF BESPOKE REPAIR COMPOSERS.
//
// A repair instruction reaches a seat from one of two places. Until this file, only one of them was
// registered: gateway.mjs's `warmPatchMessage`, `correctiveMessage` and `correctionHint`, which the
// agreement guard walks by CALLING them over a stage's real failure tokens — so a branch added inside any
// of them joins the guard's union on the commit that adds it.
//
// The other place was pipeline.mjs, composing repair text inline at the dispatch site as
// `followup: lines(…)`. Seven of those existed and nothing derived, enumerated or swept them.
//
// ── THE DEFECT THAT WAS MEASURED, NOT PREDICTED ─────────────────────────────────────────────────────
//
// `deriveIntakeAsks` ordered the seat to APPEND the `### Intake asks` section with one `Edit`, closed by
// `editRepairTail(P.matterContext)` — a hand-write order for an artifact whose only writer is now the
// driver, on a stage whose grant no longer carries `Edit`. **The guard reported matter-frame clean
// in all three directions while that order stood.** It was found by a hand sweep over every site naming
// `P.matterContext`, and the guard's own module already documented this as its residual gap:
//
//     "a brand-new composer wired somewhere other than warmPatchMessage/correctiveMessage is the
//      residual gap"
//
// One confirmed defect against a population of seven unregistered composers. Widening the guard's
// composer list per surface is the patch and is ruled out: it would have caught that one and left the
// next unregistered composer exactly as invisible.
//
// ── THE REGISTRY IS PURE TEXT; THE PIPELINE GATHERS ─────────────────────────────────────────────────
//
// Every composer here takes VALUES and returns TEXT. Nothing in this file reads a file, resolves a path
// or touches a run. That split is what makes the guard able to walk them: a composer that read from disk
// could only be exercised against a real run, and a guard that cannot be run is a guard nobody runs.
// `correctionsExtra` keeps its gathering in pipeline.mjs for exactly this reason — the reading of the
// review, the placement tail and the flag rows stays there, and only the composition moved.
//
// ── HOW A NEW COMPOSER FAILS ────────────────────────────────────────────────────────────────────────
//
// `driver/test/repair-composer-registry.test.mjs` DISCOVERS the population by reading pipeline.mjs, and
// requires every `followup:` dispatch site's `trigger` to appear here. A new bespoke `followup: lines(…)`
// therefore reds CI on the commit that adds it, naming the site, with no test edited to make that happen.
// The discovery also carries a floor, because a walk that silently stopped finding sites would report
// "no unregistered composers" and read as a pass.

import { lines } from "./stages.mjs";
import { editRepairTail, abbrev } from "./repair-contract.mjs";
// `connotation-remedy` quotes the refusal token and turns it into a fix instruction. Both helpers
// are the gateway's, and calling them here rather than re-deriving the text is the point: one
// derivation, and a composer that drifts from the hint the gateway gives is impossible by construction.
import { correctionHint, gridLedgerNameFor } from "./gateway.mjs";
import { basename } from "node:path";
// ── REGISTERED IN PLACE ─────────────────────────────────────────────────────────────────────────────
// These six are already named, exported, and living beside the subject they repair. Moving them into
// this file would trade locality for nothing: what was missing was never their location, it was that
// nothing enumerated them, so the guard could not walk them. They are imported and registered.
import { buildFrameReopenFollowup, buildEscalationFollowup, buildEnvelopeCloseFollowup, buildFrameReopenRetryMessage } from "./stages.mjs";
import { buildReconcileFollowup } from "./recall-reconciliation.mjs";
import { buildFlushFollowup } from "./digest-queue.mjs";

/**
 * The registry. One entry per bespoke repair composer that reaches a seat.
 *
 *   trigger   the dispatch's own `trigger:` string — the key, because every site already carries one
 *   stage     the stage dispatched, or "*" where the call site computes it
 *   compose   VALUES IN, TEXT OUT. No IO.
 *   samples   what the  guard calls `compose` with. ONE PER BRANCH, and the census asserts a
 *             composer whose source can emit a tail has a sample that emits it — an unexercised branch
 *             is a surface the guard does not walk, which is this issue in miniature.
 *   tail      per sample: "edit" (the shared editRepairTail), "tool" (call the tool again), or "none"
 *             with a reason. DECLARED so it can be refuted against the composed text, never derived
 *             from it — a value read back off its own output asserts nothing.
 *
 * THE SAMPLES ARE REAL-SHAPED ON PURPOSE. The guard's own header records what invented inputs cost:
 * "a made-up `invalid_file:x:y` falls through branches the real tokens never reach, and the guard
 * reported a defect in text no seat can be handed."
 */

/**
 * A paths stub for the SAMPLES ONLY.
 *
 * It exists so the guard can walk the four builders that take `paths`, and it is deliberately not
 * reachable from `compose`: a stub baked into a composer would have the pipeline dispatching invented
 * paths to a live seat. The composers take `paths` as an argument; only the samples pass this.
 */
const SAMPLE_PATHS = Object.freeze({
  runDir: "/run", registerBand: (a) => `bands/${a}.md`, registerPlan: "register-plan.json",
  registerFindings: "register-findings.md", commonLaw: "common-law.md", commonLawGrid: "grid-ledger.json",
  commonLawHalf: (h) => `common-law-${h}.md`, gridSpecHalf: (h) => `grid-${h}.json`,
  commonLawGridHalf: (h) => `grid-ledger-${h}.json`, registerUnit: (a) => `units/${a}.md`,
});

export const REPAIR_COMPOSERS = [
  {
    trigger: "corrective-findings",
    stage: "synthesis",
    key: "synthesis:corrective-findings",
    compose: ({ findings, named }) => lines(
      `You are RESUMING your own synthesis session. Your corrective pass updated the narrative but did NOT re-emit ${findings} — the structured findings the client report renders from. The review named: ${named.join(", ")}.`,
      `Apply each flag to the finding objects it names: correct the fields, or set "disposition": "withdrawn" + "withdrawn_reason" for a killed finding, and add the top-level "corrections": {"applied": true, "note": "…"} marker. Change nothing else.`,
      `Send the correction with \`record_synthesis\`: a PATCH call carrying \`findings_patch\` — the complete corrected finding object(s), each with the \`ordinal\` it replaces — and nothing else. The driver is holding every value you already sent and re-renders both files from them, so what you do not name comes back byte-identical. There is no file for you to write or edit and nothing you write by hand is read.`,
    ),
    samples: [{ name: "the standard re-emit demand", tail: "tool",
      args: { findings: "findings.json", named: ["#1", "#4"] } }],
  },
  {
    trigger: "intake-asks-followup",
    stage: "matter-frame",
    key: "matter-frame:intake-asks-followup",
    // ── CONVERSION 2 TURNED THIS FROM AN EDIT ORDER INTO A CALL ──────────────────────────────
    // It used to say "APPEND that section at the END of the file … ONE Edit that adds the new section
    // after the last line", closed by `editRepairTail`. That argument did not lose — it dissolved: the
    // seat no longer types the instructed scope (the driver stamps it) and types no line shape at all,
    // so "one small Edit beats a big re-emission" compares against a re-emission that no longer exists.
    // This is the one composer whose defect was CONFIRMED, and it is why the registry exists.
    compose: () => lines(
      `Your matter frame is missing the required intake-ask rows.`,
      `Call \`record_matter_frame\` again with \`intake_asks\` filled in: one \`{ask, owner}\` row per EXPLICIT check the requester asked for, the ask quoted VERBATIM, owner one of common-law | register | synthesis. Send an EMPTY array if the request contains no explicit asks beyond the clearance itself — that IS the answer, and the driver renders it as "none stated".`,
      `The call replaces the stored frame, so send the whole frame again — every field, not only the asks. The driver renders the file; there is nothing for you to save and no file for you to edit.`,
    ),
    samples: [{ name: "the only shape it has", tail: "tool", args: {} }],
    singleMember: "matter-frame has exactly one bespoke composer. Recorded rather than left implicit: a "
      + "guard proven at n=1 is proven against nothing about ordering, dedup or cross-composer "
      + "interaction, and the census reds if this stage gains a second one without this note being read.",
  },
  {
    trigger: "schema-downlevel",
    stage: "synthesis",
    key: "synthesis:schema-downlevel",
    compose: ({ findings, declaredSv, frameworkKey, bandLabels }) => lines(
      `You are RESUMING your own synthesis session. The findings file you emitted (${findings}) declares "schema_version": ${declaredSv}, but the dictation requires "schema_version": 4 — rated in the framework's band WORDS with a top-level "rated_under_framework": "${frameworkKey}", and NO composite/level/dispute_type keys (that scale is retired).`,
      `Re-emit the COMPLETE record through \`record_synthesis\` at schema_version 4 — same findings, same judgments, each rated finding carrying "band" (EXACTLY one of: ${bandLabels.join(" / ")}) per the original dictation. Change nothing else. This one is a whole re-send rather than a patch, because the key set itself changes shape: there is no set of named findings to correct.`,
    ),
    // A WHOLE-FILE EMISSION WITH NO REPAIR TAIL, AND THE SITE SAYS WHY: the key set changes shape, so
    // there is no small set of named lines to patch. Declared "none" with that reason rather than left
    // to look like an omission.
    samples: [{ name: "a v3 file to re-emit at v4", tail: "tool",
      args: { findings: "findings.json", declaredSv: 3, frameworkKey: "house-default", bandLabels: ["clear", "borderline", "blocked"] } }],
  },
  {
    trigger: "actions-missing",
    stage: "synthesis",
    key: "synthesis:actions-missing",
    compose: ({ findings }) => lines(
      `You are RESUMING your own synthesis session. The findings file you emitted (${findings}) has no top-level "actions" array, but the dictation requires the ACTIONS REGISTER: ONE object per forward step your opinion names that a HUMAN must still take, each EXACTLY {"id","kind","text","ordinals"} (+ optional "deadline":{"kind","date"}) — kinds: conditions consent / coexistence-agreement / territorial-delimitation / goods-amendment / mark-modification / senior-clearance / proceeding-response / counsel-opinion-required; advisory client-fact / commercial-decision / monitoring / filing-routine.`,
      `Add ONE top-level "actions": [...] key that registers every forward step your own narrative names ("actions": [] ONLY if the opinion genuinely demands nothing beyond ordinary filing). Same findings, same judgments — the findings themselves do not change.`,
      `Send it with \`record_synthesis\` as a PATCH call carrying only "actions". The driver is holding every finding you already sent and re-renders from them, so nothing else moves. There is no file for you to write or edit.`,
    ),
    samples: [{ name: "the actions register demand", tail: "tool", args: { findings: "findings.json" } }],
  },
  {
    trigger: "corrective",
    stage: "synthesis",
    key: "synthesis:corrective",
    // THE GATHERING STAYS IN pipeline.mjs. `correctionsExtra(P)` still reads the review, the placement
    // rulings tail and the flag rows off disk and parses them; what moved here is the composition it
    // wrapped them in. Splitting at that seam is what lets the guard call this at all.
    compose: ({ narrative, findings, placement, rulingsTail, scope, worklist, review }) => {
      // — THE SCOPE BLOCK, and it is the whole saving. When every flag declares which finding it
      // is about, the corrective pass is told so and told that nothing else may move. When any flag
      // declares nothing, this is "" and the dispatch is byte-identical to the one before it existed —
      // the narrowing is bought by the reviewer's own declaration, never assumed on its behalf.
      const scopeBlock = scope?.scoped ? lines(
        `SCOPE — THE REVIEWER DECLARED WHICH FINDINGS ITS FLAGS ARE ABOUT, AND THIS IS THE COMPLETE LIST: ${
          scope.ordinals.length ? scope.ordinals.map((o) => `#${o}`).join(", ") : "(none — every flag is about the document, not a finding)"}.`,
        `Change ONLY those finding objects and ONLY the narrative passages that discuss them. EVERY OTHER FINDING OBJECT IN ${findings} MUST COME BACK BYTE-IDENTICAL — do not re-derive it, do not re-word it, do not re-order its keys. The driver compares them and records anything that moved.`,
        `If applying a flag genuinely REQUIRES changing a finding outside that list — a knock-on the reviewer did not see — make the change and say which one and why in the "corrections" note. A silent edit outside the scope is the one thing this instruction forbids; a reasoned one is not.`,
      ) : "";
      return lines(
        // — OWNER RULING 2026-08-09: "add caveat" is DELETED, not softened. A repair has exactly
        // four moves and there is no fifth. The standing outward-language rule governs the REPAIR path
        // exactly as it governs a first draft, and this instruction was the one place the engine invited
        // a hedge into a deliverable. It fired on 4 of 4 delivered clearances in the 2026-08-09 round.
        `You are RESUMING your own synthesis session — your narrative and all inputs are already in your context; do NOT redo it from scratch. The independent refutation flagged the corrections below. Apply them (minimum-change per flag — correct the statement to what the evidence supports, demote the tier, remove the sentence, or verify-flag for re-check) to BOTH deliverables. A caveat, hedge, qualifier or disclaimer is NEVER a repair: an unsupported statement is corrected or it is removed, never softened.`,
        // ── — THE PASS THAT WRITES THE DEFECT ──────────────────────────────────
        //
        // Five verdict refusals in seven days, all one shape: a coverage or search-completion claim
        // contradicted by the run's own records. FOUR of the five were introduced or worsened BY THIS
        // PASS. one reviewer names it — "the REPLACEMENT for the frame-reopen sentence is now an
        // overconfident global negative". another names it — "the corrective pass deleted the
        // evidence and left the claim standing in a stronger and now factually wrong form".
        // a third run's offending sentence entered at the corrective rewrite, measured at the
        // sentence level: that pass removed one coverage assertion and wrote two, one of which refused
        // the run.
        //
        // NOTHING ABOVE FORBADE ANY OF IT. The instruction constrains WHICH passages may move — "every
        // passage the flags do not name stays byte-identical", plus the scope block below when the
        // reviewer declared ordinals. It says nothing about what the REPLACEMENT may assert, and every
        // one of these defects was an in-scope rewrite that broadened. The lead move — "correct the
        // statement to what the evidence supports" — is itself a licence to rewrite, which is where the
        // broadening happens.
        //
        // AND THE RESOLUTION WITH THE LINE ABOVE IS STATED, BECAUSE THE TWO LOOK LIKE THEY FIGHT.
        // "Never softened" forbids adding hedges; "may never broaden" requires claiming less. A model
        // handed both without the distinction will pick one. Narrowing is not hedging: stating a
        // smaller claim, or removing the claim, is a correction; keeping the same claim and wrapping it
        // in "may" or "appears to" is the hedge. Said in the text, not just here.
        //
        // NO DETECTOR, AND THAT IS DELIBERATE. The lexical gate this issue also proposed was measured
        // over 32 delivered narratives and withdrawn: 31 of 32 fired, 141 sentences, and nine of twelve
        // before/after run-pairs read identically, because a clearance narrative's job IS to state what
        // was searched and what came back — the legitimate sentence and the defective one have the same
        // shape and differ only in truth. The typed half of this class IS enforced structurally, on the
        // corrective pair, by `evidenceClaimViolations` (, pipeline.mjs ~10973) — but it reads
        // `findings.json` meters, and a narrative sentence with no findings-side counterpart is invisible
        // to it. That prose gap is conversion-era work, not an instruction. This is the instruction.
        `A REPAIR MAY NARROW A CLAIM AND MAY NEVER BROADEN ONE. If a flagged statement is wrong because it claims too much, the correction states LESS: strike the claim, or replace it with the smaller claim the evidence actually carries. Never restate the same claim in different words, and never replace a specific sentence with a general one. NARROWING IS NOT HEDGING and the rule above still holds — claiming less is a correction; keeping the claim and wrapping it in "may", "appears to" or "broadly" is the hedge that is forbidden.`,
        `THE COVERAGE ACCOUNT IS NOT YOURS TO REOPEN HERE. Do not introduce any statement about what was searched, counted, screened, finished, or came back empty that is not already in ${narrative}. That account was settled when you wrote it against the evidence in front of you; this pass has the reviewer's flags and not that evidence, so it is not in a position to widen it. Deleting a false coverage sentence is a correction. Replacing it with a different coverage sentence is not — strike it and say nothing in its place.`,
        `IF YOU REMOVE THE SUPPORT FOR A CLAIM, THE CLAIM GOES WITH IT. Deleting the evidence and leaving the sentence standing does not make it safer, it makes it unsupported and therefore stronger than the record allows. A run was refused for exactly this.`,
        `1. Correct the flagged narrative sections — send back ONLY the sections a flag names, and every section the flags do not name is left out and comes back byte-identical;`,
        `2. mirror every correction into the finding objects the flags name (owner names, levels/composites, meters). A finding the review KILLS is not deleted: keep its object, set "disposition": "withdrawn" and add "withdrawn_reason": "<the review flag that killed it>". Add a top-level "corrections": {"applied": true, "note": "<one line per flagged entity: corrected / withdrawn / no-change-because-…>"}.`,
        // ── CONVERTED. `editRepairTail` stood here and ordered targeted Edits of
        // both files. The seat holds no Edit for either any more — but the ECONOMICS that argued for a
        // targeted edit are preserved rather than lost, which is why the call has a patch shape at all:
        // measured full re-emission on four delivered clearances at 707.7 / 406.2 / 746.3 / 293.3 s
        // on the serial critical path, and a conversion that answered it with "re-send everything
        // through a tool" would have paid that cost back in a different currency. The driver holds the
        // accepted values; the seat sends what changed.
        `Send it all in ONE \`record_synthesis\` PATCH call: \`narrative\` carrying only the sections you corrected, and \`findings_patch\` carrying the complete corrected finding object(s), each with the \`ordinal\` it replaces. The driver is holding everything else you sent and re-renders both files, so what you do not name is byte-identical by construction rather than by your care. There is no file to write or edit and nothing you write by hand is read.`,
        // 2026-07-04 (the VENZY corrective thrash): three attempts died inventing three different keys
        // while trying to EXPRESS a hold. The contract is closed and every correction is expressible
        // inside it — say so.
        `THE FINDINGS CONTRACT IS CLOSED — MINIMAL CHANGE ONLY: start from the finding objects as you last sent them and change the smallest set of existing fields the flags require; NEVER invent a key, a state, or an enum value (any unknown key fails the file and, repeated, fails the WHOLE RUN). Every correction the reviewer can ask for is expressible with existing fields: an unsourced/confabulated attribution ⇒ that finding gets "disposition":"withdrawn" + "withdrawn_reason", OR its owner/prose is re-attributed to what the sources actually support — an identity that needs the applicant's confirmation is stated in the finding's prose/impact text, NEVER as a new field or note-type; use_check.quality is EXACTLY one of owner-site | independent | register-mirror or omitted; context_notes entries are EXACTLY {"type","mark","owner","context"}. RE-TYPING A DISPOSITION CARRIES ITS FIELDS WITH IT (#242) — this is the one case where a minimal edit MUST add a key, and these are the only keys it may add: re-typing a finding TO "off-field" also sets "off_field_ground" (EXACTLY "different-field" — only where that finding's own goods_proximity meter reads "low" — or "no-material-risk"), and re-typing AWAY from "off-field" REMOVES it; any finding that is not "withdrawn" keeps a non-empty "legal_position" and "practical_position", so a re-type that lands on a finding missing either must write both. Nothing else may be added.`,
        rulingsTail ? lines(
          `PLACEMENT RULINGS TAIL (verbatim from ${placement}, provided AS DATA — do NOT re-read the placement file; where a flagged correction touches a coverage disposition, a coverage[] row, or a placement call, adjudicate it against these rulings — adopt each ruling or counter-reason it, never silently drop one):`,
          "```markdown",
          rulingsTail,
          "```",
        ) : "",
        scopeBlock ? lines(scopeBlock, ``) : "",
        worklist ? lines(worklist, ``) : "",
        `The reviewer's flags, verbatim:`,
        ``,
        ``,
        review,
      );
    },
    // TWO SAMPLES BECAUSE THE COMPOSER HAS TWO SHAPES, and 's saving is the whole point of the
    // second: a declared scope narrows the pass, an undeclared one leaves it byte-identical to what it
    // was before that existed. A guard walking only one of them walks half the surface.
    samples: [
      { name: "no declared scope, no placement tail", tail: "tool",
        args: { narrative: "narrative.md", findings: "findings.json", placement: "placements.md",
          rulingsTail: "", scope: { scoped: false, ordinals: [] }, worklist: "", review: "the flags, verbatim" } },
      { name: "declared scope + placement rulings tail", tail: "tool",
        args: { narrative: "narrative.md", findings: "findings.json", placement: "placements.md",
          rulingsTail: "| axis | ruling |", scope: { scoped: true, ordinals: [1, 4] },
          worklist: "- #1 correct the owner", review: "the flags, verbatim" } },
    ],
  },
  {
    trigger: "verdict-recheck",
    stage: "narrative-refutation",
    key: "narrative-refutation:verdict-recheck",
    compose: ({ narrative, findings, seniorEyeReview, correctionsScope, appliedTable, restoredTable, evidenceTable, planAuditCarry }) => lines(
      `You are RESUMING your own narrative-refutation session — your prior verdict, the narrative, and the source files you refuted against are already in your context; do NOT re-read them from scratch.`,
      // — WHEN THE SCOPE WAS DECLARED, THE RE-READ IS NARROWED TO IT. The recheck cost 270-510 s on
      // every measured run, and its whole job is to judge whether the corrections are RIGHT — not to
      // re-derive which parts of two long documents changed. The driver already knows: it holds the
      // pre-corrective snapshot and compared every finding outside the declared scope.
      correctionsScope?.scoped
        ? `The synthesis author applied your flagged corrections. YOU DECLARED WHICH FINDINGS YOUR FLAGS WERE ABOUT, so read narrowly: in ${findings}, verify ${correctionsScope.named.length ? correctionsScope.named.map((o) => `#${o}`).join(", ") : "(no finding — your flags were about the document)"} and the narrative passages in ${narrative} that discuss them. THE DRIVER COMPARED EVERY OTHER FINDING OBJECT against the pre-correction file${correctionsScope.moved.length ? ` and ${correctionsScope.moved.length} moved anyway — ${correctionsScope.moved.map((o) => `#${o}`).join(", ")}; read those too and say whether the change is defended` : " and none moved, so you do not need to re-read them"}. Then re-write ${seniorEyeReview}: the verdict (CLEAR / CONDITIONAL / BLOCKING) on the FIRST line, then any corrections that still stand.`
        : `The synthesis author applied your flagged corrections and re-emitted the narrative ${narrative} AND the machine findings ${findings}. Re-read BOTH updated files — verify the structured findings (owners, tiers, dispositions; a killed finding must be "withdrawn") carry your corrections — re-verify your prior concerns, then re-write ${seniorEyeReview}: the verdict (CLEAR / CONDITIONAL / BLOCKING) on the FIRST line, then any corrections that still stand.`,
      // THOSE TWO FILES ARE THE ONLY EVIDENCE THAT EXISTS YET. report.md is BUILT FROM the narrative at
      // report-overview / report-card, both of which run AFTER this gate, so they hold the PREVIOUS
      // round's text by construction. A real run died here: the reviewer read them, found its own
      // blocked assertions still present, and returned BLOCKING — two steps before the stage that would
      // have rebuilt them. Blocking on that staleness is unwinnable, so say plainly that it is expected.
      `Judge ONLY ${narrative} and ${findings}. The report and the client summary are GENERATED FROM the narrative by stages that run after this gate, so on disk they still carry the previous round's text — that is expected and is NOT evidence a correction failed to land. Do not read them as the deliverable and do not block on them.`,
      appliedTable,
      // — WHAT THE DRIVER PUT BACK, and why the reviewer has to be told rather than
      // merely handed the file. Every other row in this document is the seat's judgment; a restored row
      // is not. It was removed by the corrective pass with no flag naming it, and the driver put it back
      // whole from the pre-corrective snapshot. A reviewer that cannot tell the two apart weighs a
      // driver-restored finding as the author's corrected judgment — which is the one reading that makes
      // the repair worse than the loss it fixes.
      //
      // IT ALSO OVERRIDES THE NARROWING ABOVE. On a declared scope this dispatch tells the reviewer that
      // every finding outside the scope was compared and did not move, so it need not be re-read. A
      // restored finding DID move — twice — so it must be named as an exception to that or the narrowing
      // quietly excuses the rows most in need of a look.
      restoredTable,
      // — the claims that moved against their own evidence in the pass just applied. Beside the
      // corrections table because it answers the neighbouring question: that one says what the author
      // DID, this says what it did to the join between a claim and its support.
      evidenceTable,
      planAuditCarry,
    ),
    // NO REPAIR TAIL, DECLARED RATHER THAN OMITTED: this dispatch orders a re-write of the reviewer's
    // own verdict file, which the reviewer authored and holds; it is not a repair of a driver-written
    // artifact, so neither the edit tail nor a tool order belongs on it.
    samples: [
      { name: "undeclared scope — the full re-read", tail: "none",
        args: { narrative: "narrative.md", findings: "findings.json", seniorEyeReview: "senior-eye-review.md",
          correctionsScope: { scoped: false, named: [], moved: [] }, appliedTable: "", restoredTable: "", evidenceTable: "", planAuditCarry: "" } },
      { name: "declared scope, with a finding that moved anyway", tail: "none",
        args: { narrative: "narrative.md", findings: "findings.json", seniorEyeReview: "senior-eye-review.md",
          correctionsScope: { scoped: true, named: [1], moved: [4] },
          appliedTable: "| flag | outcome |", restoredTable: "", evidenceTable: "| finding | meter | what moved |", planAuditCarry: "plan-audit carry" } },
    ],
    singleMember: "narrative-refutation has exactly one bespoke composer. Recorded so the census reds if "
      + "the stage gains a second without this note being read — a guard proven at n=1 has proven "
      + "nothing about ordering or interaction between two composers on one stage.",
  },
  {
    trigger: "lint-repair",
    // THE CALL SITE COMPUTES THE STAGE. `redo(label, …)` is keyed on the ARTIFACT rather than the label
    // so conversions 5 and 6 inherit it, which means this composer is dispatched against whichever
    // delivery-tail stage failed its pre-delivery lint.
    stage: "*",
    key: "*:lint-repair",
    compose: ({ label, file, toolWritten, failures }) => lines(
      toolWritten
        ? `You are RESUMING your own ${label} session — the driver wrote ${file} from your \`${toolWritten.tool}\` call, and the deterministic pre-delivery lint failed these checks on it:`
        : `You are RESUMING your own ${label} session — ${file} is already written and the deterministic pre-delivery lint failed these checks on it:`,
      ...failures.map((f) => `- ${f.detail || f.id}`),
      `Where a check quotes the fetched record's true value, correct the identifier to the record's value EXACTLY (the record is the only permitted source for registry identifiers).`,
      `Risk tiers and Level/Composite labels are COPIED from the findings values quoted in the check — never re-derive or re-word them.`,
      `Fix ONLY what the checks name; change nothing else.`,
      toolWritten
        ? `Apply the fix by calling \`${toolWritten.tool}\` AGAIN with the corrected values — the COMPLETE payload, not a patch, because the driver re-renders the whole artifact from what you send. You hold no Write or Edit tool for it and nothing you write by hand is read.`
        : editRepairTail(file),
    ),
    // BOTH BRANCHES, AND THE CENSUS REQUIRES BOTH. This composer is the one that can hand a seat either
    // a tool order or a file-edit order depending on how its artifact is written, so a sample set
    // covering one branch would leave the other exactly as unwalked as the seven were before this file.
    //
    // ── AND THE SAMPLE MUST BE THE WALKING STAGE'S OWN, WHICH THE GUARD CAUGHT IMMEDIATELY ───────────
    //
    // The fixed sample below names `record_report_card`. A `stage: "*"` composer is walked for EVERY
    // stage, so the guard read that as "blind-frame is ordered to call record_report_card" and
    // reported seven ordered-but-not-granted findings on its first run. They were artifacts of the
    // SAMPLE, not of the tree: at dispatch, `redo(label, …)` derives `toolWritten` from the artifact that
    // actually failed, so the tool is always the walking stage's own. `samplesForStage` gives the guard
    // that, and the fixed `samples` stay for the census's branch-coverage check.
    // ONE BRANCH, BECAUSE ONLY ONE IS REACHABLE THERE. The guard walks RECORDING stages, whose artifacts
    // are written by the driver off a typed call — so `toolWritten` is never null on them and the
    // file-edit branch cannot be taken. Handing the guard that branch anyway produced a second wave of
    // findings about text no seat on those stages can be served, which is the failure this module's own
    // header names: "a made-up token falls through branches the real tokens never reach, and the guard
    // reported a defect in text no seat can be handed." The edit branch IS exercised — by the fixed
    // `samples` below, which is where the census checks branch coverage.
    samplesForStage: ({ stage, tool, file }) => [
      { name: `${stage}'s own tool-written artifact`, tail: "tool", args: { label: stage, file, toolWritten: { tool }, failures: [{ id: "lint_1", detail: "a check the lint named" }] } },
    ],
    samples: [
      { name: "a tool-written artifact", tail: "tool",
        args: { label: "report-card", file: "report-cards/0.md", toolWritten: { tool: "record_report_card" },
          failures: [{ id: "rc_band_mismatch", detail: "band says CLEAR, findings say BORDERLINE" }] } },
      // THE SAMPLE MOVED STAGES RATHER THAN FLIPPING ITS SHAPE. It read
      // `{label:"synthesis", file:"narrative.md", toolWritten:null}`, and when the writer converted, the
      // sample-honesty arm fails it by name — narrative.md now has a row. Flipping this entry to
      // tool-written satisfies that arm and leaves the EDIT BRANCH WITH NO SAMPLE AT ALL, silently,
      // which is the branch the comment above says these fixed samples exist to cover. So it names a
      // stage whose seat still authors its own file: case-law writes case-law-findings.md by hand and
      // holds Write to do it. When that one converts, this sample moves again — it does not flip.
      { name: "a hand-written artifact", tail: "edit",
        args: { label: "case-law", file: "case-law-findings.md", toolWritten: null,
          failures: [{ id: "cl_citation_unquoted", detail: "citation not quoted from the fetched source" }] } },
    ],
  },
  {
    trigger: "finding-reemit",
    stage: "synthesis",
    key: "synthesis:finding-reemit",
    compose: ({ findings, quarantined }) => lines(
              // — THE LAST BIG RE-EMISSION IN THE PIPELINE, and the reason it was the last one left. Three of
      // this site's own siblings are on repair-write-mode.test.mjs's CONVERTED list ("synthesis corrections-
      // reach", "synthesis actions-missing", "synthesis record re-rate") — including the leg that runs
      // IMMEDIATELY after this one, enforceCorrectionsReachFindings. This pass was not, so the corrective
      // turn was ordered to re-emit a complete narrative and a complete findings.json to apply a handful of
      // flags, and then its own follow-up was told to patch. Measured on the 2026-08-09 round it fired on
      // 4 of 4 clearances at 707.7 / 406.2 / 746.3 / 293.3 s, on the serial critical path every time.
      // repair-contract.mjs carries the measurement that settles the write mode: on the register-digest
      // flush, two full re-emissions failed at 1,402 s and 1,506 s and the attempt that PASSED patched, in
      // 578 s — "retyping a 160 KB document IS the latency".
      // The direction is scoped to the two files by name BEFORE the Edit tool is offered, per the hazard
      // GRID_SCOPED records: the rulings tail below names the placement file precisely to forbid re-reading
      // it, and an unscoped Edit affordance beside a named path is an invitation to edit it.
      `You are RESUMING your own synthesis session — your narrative and inputs are already in your context; do NOT redo the analysis.`,
              `Exactly ${quarantined.length} finding object(s) in ${findings} failed the strict parse. Fix ONLY these objects and change NOTHING else:`,
              ...quarantined.map((q) => `- "${q.mark}" (index ${q.index}): ${String(q.error ?? "invalid shape").slice(0, 160)}`),
              `THE FINDINGS CONTRACT IS CLOSED — MINIMAL EDIT ONLY: change the smallest set of existing fields these errors require; NEVER invent a key, a state, or an enum value. A correction that cannot be expressed in existing fields goes in the finding's prose/impact text. ONE exception (#242): a finding re-typed TO "off-field" also gets "off_field_ground" ("different-field" only where its goods_proximity reads "low", else "no-material-risk"), re-typing away from off-field removes it, and every finding that is not "withdrawn" carries a non-empty "legal_position" and "practical_position".`,
              `Send the correction with \`record_synthesis\`: a PATCH call carrying \`findings_patch\` — the complete corrected finding object(s), each with the \`ordinal\` it replaces — and nothing else. The driver is holding every value you already sent and re-renders both files from them, so what you do not name comes back byte-identical. There is no file for you to write or edit and nothing you write by hand is read.`,
            ),
    samples: [{ name: "one quarantined finding object", tail: "tool", args: { findings: "findings.json", quarantined: [{ mark: "NOVA", index: 2, error: "band missing" }] } }],
  },
  {
    trigger: "action-reemit",
    stage: "synthesis",
    key: "synthesis:action-reemit",
    compose: ({ findings, bad }) => lines(
        `You are RESUMING your own synthesis session — your narrative and inputs are already in your context; do NOT redo the analysis.`,
        `Exactly ${bad.length} object(s) in the "actions" register of ${findings} failed the strict parse. Fix ONLY these objects and change NOTHING else — no finding changes, no new actions, none removed:`,
        // The id is what the seat can find its own row by; `kind` is echoed because a kind defect is
        // the one case where the id alone does not locate the fault in the seat's own reading.
        ...bad.map((q) => `- action id ${q.id ?? "(unreadable)"}${q.kind ? ` (kind "${String(q.kind).slice(0, 40)}")` : ""} at index ${q.index}: ${String(q.error ?? "invalid shape").slice(0, 160)}`),
        `THE ACTION CONTRACT IS CLOSED — MINIMAL EDIT ONLY. Each action is EXACTLY {"id","kind","text","ordinals"} plus an OPTIONAL "deadline" {"kind","date"} and an OPTIONAL "condition" (CONDITION kinds only). Change the smallest set of existing fields these errors require and NEVER invent a key. Do not resolve a defect by DELETING the action: a forward legal step your own opinion names must survive this edit, and a dropped condition changes the delivered verdict.`,
        `Send the corrected action(s) with \`record_synthesis\` as a PATCH call carrying only "actions" — the complete register with these objects fixed. The driver is holding your findings and re-renders from them; nothing else moves, and there is no file for you to write or edit.`,
      ),
    samples: [{ name: "one malformed action", tail: "tool", args: { findings: "findings.json", bad: [{ id: "a1", kind: "consent", index: 0, error: "no ordinals" }] } }],
  },
  {
    trigger: "ask-answer-reemit",
    stage: "synthesis",
    key: "synthesis:ask-answer-reemit",
    compose: ({ findings, bad }) => lines(
        `You are RESUMING your own synthesis session — your narrative and inputs are already in your context; do NOT redo the analysis.`,
        `Exactly ${bad.length} object(s) in the "ask_answers" array of ${findings} failed the strict parse. Fix ONLY these objects and change NOTHING else — no finding changes, no action changes:`,
        ...bad.map((q) => `- ask_answers index ${q.index}${q.ask ? ` (ask "${q.ask}")` : ""}: ${String(q.error ?? "invalid shape").slice(0, 160)}`),
        `THE SHAPE IS CLOSED — MINIMAL EDIT ONLY. Each entry is EXACTLY {"ask","answer"} plus an OPTIONAL "ordinals" array of finding ordinals. \`ask\` is the requester's instruction VERBATIM (it is the join key to the frozen intake asks). \`answer\` is the ANSWER ALONE — never prefixed with "You asked: … →", which the driver adds when it builds the section. Do not resolve a defect by DELETING the entry: the ask was committed at intake and would then ship unanswered.`,
        `Send the corrected entries with \`record_synthesis\` as a PATCH call carrying only "ask_answers" — the complete array with these entries fixed. The driver is holding your findings and re-renders from them; nothing else moves, and there is no file for you to write or edit.`,
      ),
    samples: [{ name: "one malformed ask answer", tail: "tool", args: { findings: "findings.json", bad: [{ index: 1, ask: "check the EU register", error: "answer missing" }] } }],
  },
  {
    trigger: "late-bind",
    stage: "register-digest",
    key: "register-digest:late-bind",
    compose: ({ registerFindings, bind }) => lines(
        `You are RESUMING your earlier register-digest session — your prior digest and all unit files are already in your context. Do NOT redo it from scratch and do NOT run any new searches.`,
        `The applicant has been named mid-run: ${bind.customer}.${bind.exclusions.length ? ` Affiliate/exclusion set: ${bind.exclusions.join(", ")}.` : ""}`,
        `Re-classify your existing findings against this: marks owned by the applicant/exclusion set are the client's OWN rights (not conflicts — move them out of the adverse tiers and note them as own-rights context); any finding previously treated as candidate-self resolves normally. Everything the re-classification does not touch stays as it is.`,
        // ── CONVERTED (conversion 11). `editRepairTail(registerFindings)` stood here and ordered
        // targeted Edits of a file whose only writer is now the driver — the superseded path the
        // golden rule bans, and the exact shape recording-agreement direction (a) refuses by name.
        //
        // A WHOLE RE-SEND, not a patch, and the conversion is what makes that the cheap option. Under
        // the old dictation a re-send meant retyping the entire document, so a targeted Edit was the
        // only affordable repair. A row is now a uri, a reason and a token: re-sending every row costs
        // less than the document's Sheet-1 table did, and it removes the failure mode a targeted edit
        // has here — a re-classification that moves a finding between tiers has to touch two places at
        // once, and an Edit that lands one of them leaves the document self-contradictory.
        `Send the RE-CLASSIFIED result with \`record_register_digest\` — the COMPLETE set of rows, not a diff: every findings_row, incumbent_row and negative_row that still belongs, with the ones you moved in their new place. The driver re-renders the document from what you send, so a row you do not re-send is a row you have dropped. There is no file for you to write or edit and nothing you write by hand is read.`,
      ),
    samples: [{ name: "an applicant named mid-run, with exclusions", tail: "tool", args: { registerFindings: "register-findings.md", bind: { customer: "Acme SA", exclusions: ["Acme GmbH"] } } }],
  },
  {
    trigger: "connotation-remedy",
    stage: "common-law-half",
    key: "common-law-half:connotation-remedy",
    compose: ({ findingsFile, gridSpecPath, tok }) => lines(
        `You are RESUMING your own common-law session — your findings file is ${findingsFile} and your prior work is in context. Do NOT redo the sweep and do NOT rewrite your findings file. You own this matter's MEANING SWEEP (your spec: ${gridSpecPath}).`,
        `The MERGED findings failed the meaning-receipts gate (${abbrev(tok, 160)}). Fix exactly this: ensure ${correctionHint(tok, { gridLedgerName: gridLedgerNameFor(findingsFile) })}.`,
        `Everything else in your half stays exactly as it is — the driver re-merges the halves and re-runs the canonical gate in code.`,
        `Record the outstanding rulings ONLY by calling the \`record_dispositions\` tool with grid_spec_path = ${gridSpecPath} — never by writing or editing any file. Everything already recorded is kept; stop when the tool's answer reports nothing outstanding.`,
      ),
    samples: [{ name: "a meaning-receipts refusal", tail: "tool", args: { findingsFile: "common-law-a.md", gridSpecPath: "grid-a.json", tok: "invalid_file:common-law.md:connotation_search_missing" } }],
  },
  {
    trigger: "plan-join-fresh",
    stage: "register-unit",
    key: "register-unit:plan-join-fresh",
    route: "freshMessage",
    compose: ({ axis, registerPlan, bandPath }) => lines(
        `Execute the FROZEN register plan for axis "${axis}": call register_execute_plan ONCE with {"plan_path": "${registerPlan}", "axis": "${axis}", "output_path": "${bandPath}"} — the tool runs this axis's dictated entries and MERGES the band itself (existing blocks survive; the missing dictated blocks land, qids stamped). Do NOT run the entries manually, do NOT edit the band yourself, author NO clearance verdict.`,
        `Return ONLY: the band path + the tool's summary line.`,
      ),
    samples: [{ name: "a fresh plan execution", tail: "tool", args: { axis: "eu", registerPlan: "register-plan.json", bandPath: "bands/eu.md" } }],
  },
  {
    trigger: "plan-join",
    stage: "register-unit",
    key: "register-unit:plan-join",
    compose: ({ axis, registerPlan, bandPath, entries }) => lines(
        `You are RESUMING your own register-unit session (axis "${axis}"). Your unit digest stands — do NOT redo it.`,
        `These DICTATED plan entries have no band block yet:`,
        ...entries.map((e) => `- qid "${e.qid}": ${e.predicate} ${e.terms ? `names ${JSON.stringify(e.terms)}` : `"${e.term}"`} · nice_classes ${JSON.stringify(e.nice_classes)}${e.regions?.length ? ` · regions ${JSON.stringify(e.regions)}` : ""} · expected: ${e.expected_kind}`),
        `Close them by calling register_execute_plan ONCE with {"plan_path": "${registerPlan}", "axis": "${axis}", "output_path": "${bandPath}"} — the tool re-runs this axis's dictated entries and MERGES the band itself (your judgment blocks survive; the missing dictated blocks land, qids stamped). Do NOT run the entries manually or edit the band yourself.`,
        `Return ONLY: the band path + the tool's summary line.`,
      ),
    samples: [{ name: "one dictated entry with no band block", tail: "tool", args: { axis: "eu", registerPlan: "register-plan.json", bandPath: "bands/eu.md", entries: [{ qid: "q1", predicate: "identical", term: "NOVA", nice_classes: [9], expected_kind: "exact" }] } }],
  },
  {
    trigger: "grid-ledger",
    stage: "common-law",
    key: "common-law:grid-ledger",
    compose: ({ gridLedger, gridSpecPath }) => lines(
        `You are RESUMING your own common-law session. Your findings file is already written and stands.`,
        `The grid ledger ${gridLedger} is missing — the deterministic grid call did not complete. Call perplexity_research again with enable_sandbox:true and grid_spec_path: ${gridSpecPath}. The tool writes the ledger itself from the API response; do NOT write it yourself and do NOT re-emit the grid JSON.`,
        `Then return ONLY: the grid ledger path + one line confirming the tool reported it written.`,
      ),
    samples: [{ name: "the ledger the grid call never wrote", tail: "tool", args: { gridLedger: "grid-ledger.json", gridSpecPath: "grid-spec.json" } }],
  },
  {
    trigger: "coverage-closure",
    stage: "common-law",
    key: "common-law:coverage-closure",
    compose: ({ findingsFile, suppSpec, suppSpecPath, closable, cellKey, sourceChannels }) => lines(
        `You are RESUMING your own common-law session — your findings file is ${findingsFile} and your prior work is in context. Do NOT redo the full sweep.`,
        suppSpec ? `These ${closable.length} grid cells are recorded as not-executed/coverage-limited with NO mechanical failure behind them — they are closable now. Run them via the DETERMINISTIC supplementary search-as-code grid: call perplexity_research with enable_sandbox:true and grid_spec_path: ${suppSpecPath}. The tool runs EXACTLY the dictated cells and WRITES the supplementary ledger to its output_path itself — do NOT save it yourself and do NOT re-emit the grid JSON. The cells:` : "",
        ...(suppSpec ? closable.map((c) => `- ${cellKey(c)}`) : []),
        sourceChannels.length ? `IN-SCOPE CHANNELS not searched this run (the blind frame-diff flagged them as applied-but-unsearched distribution/discovery surfaces — CLOSE them, never recommend them): ${sourceChannels.join("; ")}. For EVERY manifest variant, run the appropriate search of each channel — its real domain(s) (e.g. github.com / nuget.org / npmjs.com, or the relevant store/registry) or a general-web search scoped to it — and ADD one Negative-results matrix row per (variant × channel) with its receipt, then reconcile the matching Scope-ledger / Coverage rows from not-searched to searched.` : "",
        // The edit direction has to be SCOPED here: this prompt already forbids saving the grid JSON,
        // and the tail below is the first thing in it that hands over the Edit tool. A model that reads
        // "use the Edit tool" as covering the machine ledger produces grid_ledger_unparseable /
        // grid_join_missing — a defect with its own corrective ladder, bought by this change.
        `Then update ONLY those Negative-results matrix rows with their real receipts ("No results" / "No similar listings (N candidates reviewed)" / "Similar listing(s) found — see Findings") and reconcile the Coverage ledger rows they close, preserving everything else. The driver validates grid completeness from the ledgers the tool wrote — never from your prose. The edit direction below covers ${findingsFile} ONLY; the machine ledgers stay the tool's.`,
        editRepairTail(findingsFile),
      ),
    samples: [{ name: "closable cells plus unsearched channels", tail: "edit", args: { findingsFile: "common-law.md", suppSpec: true, suppSpecPath: "grid-supp.json", closable: [{ variant: "NOVA", channel: "github" }], cellKey: (c) => `${c.variant} × ${c.channel}`, sourceChannels: ["npmjs.com"] } }],
  },
  {
    trigger: "coverage-closure",
    stage: "common-law-half",
    key: "common-law-half:coverage-closure",
    compose: ({ findingsFile, gridSpecPath, suppSpec, suppSpecPath, cells, cellKey, chans, scopes }) => lines(
        `You are RESUMING your own common-law session — your findings file is ${findingsFile} and your prior work is in context. Do NOT redo the full sweep. You own ONE HALF of this matter's grid (your half-grid spec: ${gridSpecPath}).`,
        suppSpec ? `These ${cells.length} grid cells are recorded as not-executed/coverage-limited with NO mechanical failure behind them — they are closable now. Run them via the DETERMINISTIC supplementary search-as-code grid: call perplexity_research with enable_sandbox:true and grid_spec_path: ${suppSpecPath}. The tool runs EXACTLY the dictated cells and WRITES the supplementary ledger to its output_path itself — do NOT save it yourself and do NOT re-emit the grid JSON. The cells:` : "",
        ...(suppSpec ? cells.map((c) => `- ${cellKey(c)}`) : []),
        chans.length ? `IN-SCOPE CHANNELS not searched this run (the blind frame-diff flagged them as applied-but-unsearched distribution/discovery surfaces — CLOSE them, never recommend them): ${chans.join("; ")}. For EACH of these variants — ${scopes.join("; ")} — (the driver dictates this list; it may include the sibling half's terms re-routed to you because its session is unavailable), run the appropriate search of each channel — its real domain(s) (e.g. github.com / nuget.org / npmjs.com, or the relevant store/registry) or a general-web search scoped to it — and ADD one Negative-results matrix row per (variant × channel) with its receipt, then reconcile the matching Scope-ledger / Coverage rows from not-searched to searched.` : "",
        `Then update ONLY those Negative-results matrix rows with their real receipts ("No results" / "No similar listings (N candidates reviewed)" / "Similar listing(s) found — see Findings") and reconcile the Coverage ledger rows they close, preserving everything else. The driver validates grid completeness from the ledgers the tool wrote — never from your prose. The edit direction below covers ${findingsFile} ONLY; the machine ledgers stay the tool's.`,
        editRepairTail(findingsFile),
      ),
    samples: [{ name: "the half-grid form, with re-routed scopes", tail: "edit", args: { findingsFile: "common-law-a.md", gridSpecPath: "grid-a.json", suppSpec: true, suppSpecPath: "grid-supp-a.json", cells: [{ variant: "NOVA", channel: "github" }], cellKey: (c) => `${c.variant} × ${c.channel}`, chans: ["npmjs.com"], scopes: ["NOVA", "NOVAPULSE"] } }],
  },
  {
    trigger: "frame-reopen",
    stage: "common-law",
    key: "common-law:frame-reopen",
    compose: ({ findingsFile, gridLedger, directives }) => lines(
        `You are RESUMING your own common-law session — your findings file is ${findingsFile} and your prior work is in context. Do NOT redo the full sweep.`,
        `A blind, frame-INDEPENDENT re-derivation found these SOURCE CHANNELS the run did NOT search. Run a supplementary search over them (enable_sandbox: true, depth: "pro-search") — resolve each channel to its real domain(s) or a general-web search scoped to it:`,
        ...directives.map((d) => `- ${d.item} — ${d.observation}`),
        `Then update the Negative-results matrix + Coverage ledger for what you searched, preserving everything else. Do NOT hand-edit ${gridLedger} — the driver owns the machine ledger. The edit direction below covers ${findingsFile} ONLY.`,
        editRepairTail(findingsFile),
      ),
    samples: [{ name: "one blind-frame source directive", tail: "edit", args: { findingsFile: "common-law.md", gridLedger: "grid-ledger.json", directives: [{ item: "itch.io", observation: "an applied distribution surface, unsearched" }] } }],
  },
  {
    trigger: "frame-reopen",
    stage: "common-law-half",
    key: "common-law-half:frame-reopen",
    compose: ({ findingsFile, gridSpecPath, gridLedger, directives, scopes }) => lines(
        `You are RESUMING your own common-law session — your findings file is ${findingsFile} and your prior work is in context. Do NOT redo the full sweep. You own ONE HALF of this matter's grid (your half-grid spec: ${gridSpecPath}).`,
        `A blind, frame-INDEPENDENT re-derivation found these SOURCE CHANNELS the run did NOT search. For EACH of these variants — ${scopes.join("; ")} — (the driver dictates this list; it may include the sibling half's terms re-routed to you because its session is unavailable), run a supplementary search over them (enable_sandbox: true, depth: "pro-search") — resolve each channel to its real domain(s) or a general-web search scoped to it:`,
        ...directives.map((d) => `- ${d.item} — ${d.observation}`),
        `Then update the Negative-results matrix + Coverage ledger for what you searched, preserving everything else. Do NOT hand-edit ${gridLedger} — the driver owns the machine ledger. The edit direction below covers ${findingsFile} ONLY.`,
        editRepairTail(findingsFile),
      ),
    samples: [{ name: "the half form, with the sweep scopes it dictates", tail: "edit", args: { findingsFile: "common-law-a.md", gridSpecPath: "grid-a.json", gridLedger: "grid-ledger-a.json", directives: [{ item: "itch.io", observation: "an applied distribution surface, unsearched" }], scopes: ["NOVA", "NOVAPULSE"] } }],
  },
  {
    trigger: "draft-carry",
    stage: "*",
    key: "*:draft-carry",
    route: "planDraftCarry",
    // THE GATHERING STAYS IN pipeline.mjs, the same seam as `corrective`: `planDraftCarry` re-validates the
    // best draft on disk and decides whether a carry is warranted at all. Only the composition moved.
    compose: ({ out, restore, outstanding, reason, toolWritten }) => lines(
      toolWritten
        ? `A prior pass of this stage in THIS run already produced ${basename(out)} — the driver wrote it from your \`${toolWritten.tool}\` call. It is on disk now and it is ${restore ? "the best version this run has produced" : "the version you are continuing"} — ${outstanding} short of passing. Do NOT redo the sweep and do NOT re-derive the document.`
        : `A prior pass of this stage in THIS run already produced ${basename(out)}. It is on disk now and it is ${restore ? "the best version this run has produced" : "the version you are continuing"} — ${outstanding} short of passing. Do NOT redo the sweep and do NOT re-derive the document.`,
      // — the failing check is an INSTRUCTION here ("Fix exactly this"), and it carries the identifiers
      // the model must reproduce. Cut it silently and the model repairs a value that was never the real one.
      `It failed exactly one check: ${abbrev(String(reason), 300)}. Fix exactly this: ensure ${correctionHint(`invalid_file:${basename(out)}:${reason}`, { gridLedgerName: gridLedgerNameFor(out) })}.`,
      `Everything else in the file already passed — leave it as it stands.`,
      // — BOTH BRANCHES, THE SAME SHAPE AS `*:lint-repair` ABOVE AND FOR THE SAME REASON. This is a
      // `stage: "*"` composer, so it is dispatched against whichever stage parked with a carryable draft —
      // and six of those stages now have their artifact written by the driver off a typed call. Handing
      // one of them `editRepairTail`'s "TARGETED EDITS … using the Edit tool" orders a hand-write at a
      // seat whose grant no longer carries `Write` or `Edit`. Measured on eac78ed before the fix: the
      // composer emitted both an Edit order and a Write order for frame-diff.md, blind-frame-model.json
      // and matter-context.md alike.
      //
      // The class is the one this module's header records, and this is its fourth surface — the ten
      // anchor sites, the max-tokens corrective and the pre-delivery lint rung each closed it in turn,
      // and each time the note said the same thing: a retirement reaches the first-attempt surfaces and
      // misses a correction surface. `toolWritten` is derived at the GATHERING site from the artifact,
      // not from the label, so a seventh conversion inherits this with its row and nothing has to join.
      toolWritten
        ? `Apply the fix by calling \`${toolWritten.tool}\` AGAIN with the corrected values — the COMPLETE payload, not a patch, because the driver re-renders the whole artifact from what you send. Send everything that is already right along with the correction: you hold no Write or Edit tool for it and nothing you write by hand is read.`
        : editRepairTail(out),
    ),
    // THE GUARD WALKS THE SAMPLES, SO A SAMPLE POPULATION THAT EXCLUDES THE CONVERTED ARTIFACTS IS GREEN
    // BY CONSTRUCTION. That is how this defect survived six conversions: both samples below named
    // `common-law.md`, which the driver does not write, and the agreement guard read 19/19 clean
    // while the order it exists to ban stood in the composer. Pointing one sample at a converted artifact
    // reds it immediately and by name. The fixed samples keep the census's branch-coverage check honest.
    //
    // `samplesForStage` IS REQUIRED, and for the reason `*:lint-repair`'s note above gives rather than the
    // one it looks like: a `stage: "*"` composer is walked for EVERY recording stage, so the fixed sample's
    // `record_frame_diff` is read as an order handed to blind-frame, matter-frame, prelim-variants,
    // report-overview, report-card and doubt-closure — six ordered-but-not-granted findings that are
    // artifacts of the SAMPLE, not of the tree. At dispatch the tool is always the walking stage's own,
    // because it is derived from `out`. Removing this hook reproduces all six.
    samplesForStage: ({ stage, tool, file }) => [
      { name: `${stage}'s own carried draft, written by the driver`, tail: "tool",
        args: { out: file, restore: false, outstanding: 2, reason: "a check the validate named", toolWritten: { tool } } },
    ],
    samples: [
      { name: "continuing the version on disk", tail: "edit",
        args: { out: "common-law.md", restore: false, outstanding: 2, reason: "connotation_search_missing", toolWritten: null } },
      { name: "restoring a better draft over the on-disk one", tail: "edit",
        args: { out: "common-law.md", restore: true, outstanding: 1, reason: "grid_join_missing", toolWritten: null } },
      { name: "a carried draft the driver writes from a typed call", tail: "tool",
        args: { out: "frame-diff.md", restore: true, outstanding: 1, reason: "framediff_reopen_missing",
          toolWritten: { tool: "record_frame_diff" } } },
    ],
  },
  {
    trigger: "recall-reconcile",
    stage: "register-digest",
    key: "register-digest:recall-reconcile",
    inPlace: "driver/recall-reconciliation.mjs",
    compose: ({ artifact, registerFindingsPath, hasCoverageForm }) => buildReconcileFollowup(artifact, { registerFindingsPath, hasCoverageForm }),
    samples: [
      { name: "no coverage form", tail: "declared-by-the-composer",
        args: { artifact: "register-findings.md", registerFindingsPath: "register-findings.md", hasCoverageForm: false } },
      { name: "with a coverage form", tail: "declared-by-the-composer",
        args: { artifact: "register-findings.md", registerFindingsPath: "register-findings.md", hasCoverageForm: true } },
    ],
  },
  {
    trigger: "digest-flush",
    stage: "register-digest",
    key: "register-digest:digest-flush",
    inPlace: "driver/digest-queue.mjs",
    compose: ({ registerFindingsPath, sections }) => buildFlushFollowup({ registerFindingsPath, sections }),
    samples: [{ name: "one queued section", tail: "declared-by-the-composer",
      args: { registerFindingsPath: "register-findings.md", sections: ["eu"] } }],
  },
  {
    trigger: "frame-reopen-directive",
    stage: "register-unit",
    key: "register-unit:frame-reopen-directive",
    inPlace: "driver/stages.mjs",
    compose: ({ paths, axis, directives, reopenFetchCap, supplementalLane }) =>
      buildFrameReopenFollowup({ paths, axis, directives, reopenFetchCap, supplementalLane }),
    samples: [
      { name: "the main lane", tail: "declared-by-the-composer",
        args: { paths: SAMPLE_PATHS, axis: "eu", directives: [{ item: "itch.io", observation: "unsearched" }], reopenFetchCap: 4, supplementalLane: false } },
      { name: "the supplemental lane", tail: "declared-by-the-composer",
        args: { paths: SAMPLE_PATHS, axis: "eu", directives: [{ item: "itch.io", observation: "unsearched" }], reopenFetchCap: 4, supplementalLane: true } },
    ],
  },
  {
    trigger: "escalation",
    stage: "register-unit",
    key: "register-unit:escalation",
    inPlace: "driver/stages.mjs",
    compose: ({ paths, axis, flags, supplementalLane }) =>
      buildEscalationFollowup({ paths, axis, flags, supplementalLane }),
    samples: [
      { name: "the main lane", tail: "declared-by-the-composer",
        args: { paths: SAMPLE_PATHS, axis: "eu", flags: [{ axis: "eu", reason: "coverage-limited" }], supplementalLane: false } },
      { name: "the supplemental lane", tail: "declared-by-the-composer",
        args: { paths: SAMPLE_PATHS, axis: "eu", flags: [{ axis: "eu", reason: "coverage-limited" }], supplementalLane: true } },
    ],
  },
  {
    trigger: "envelope-close",
    stage: "register-unit",
    key: "register-unit:envelope-close",
    inPlace: "driver/stages.mjs",
    compose: ({ paths, axis, rows, supplementalLane }) =>
      buildEnvelopeCloseFollowup({ paths, axis, rows, supplementalLane }),
    samples: [{ name: "two outstanding rows", tail: "declared-by-the-composer",
      args: { paths: SAMPLE_PATHS, axis: "eu", rows: 2, supplementalLane: false } }],
  },
  {
    trigger: "frame-reopen-retry",
    stage: "register-unit",
    key: "register-unit:frame-reopen-retry",
    route: "freshMessage",
    inPlace: "driver/stages.mjs",
    compose: ({ paths, axis, directives, reopenFetchCap, supplementalLane }) =>
      buildFrameReopenRetryMessage({ paths, axis, directives, reopenFetchCap, supplementalLane }),
    samples: [{ name: "the retry after a reopen", tail: "declared-by-the-composer",
      args: { paths: SAMPLE_PATHS, axis: "eu", directives: [{ item: "itch.io", observation: "unsearched" }], reopenFetchCap: 4, supplementalLane: false } }],
  },
  {
    trigger: "grid-ledger",
    stage: "common-law",
    key: "common-law:grid-ledger-no-spec",
    // THE LEGACY ARM OF THE SAME TERNARY, and it is the composer this issue's own method nearly missed.
    // `const followup = ctx.gridSpecPath ? lines(…) : lines(…)` reads as ONE composer to any scan that
    // takes the first `lines(` and stops. It is a SECOND, with a different instruction: no grid spec
    // exists, so the seat is told to save the stdout it already holds rather than to re-call the tool.
    // Its key differs from the spec'd arm because both dispatch under `trigger: "grid-ledger"` on the
    // same stage — a trigger-only key would have resolved both to whichever came first.
    compose: ({ gridLedger }) => lines(
      `You are RESUMING your own common-law session. Your findings file is already written and stands.`,
      `One artifact is missing: save the grid call's stdout JSON VERBATIM to ${gridLedger} — the single stdout object, or a JSON ARRAY of the per-batch stdout objects in batch order. Copy it exactly as the tool returned it; do not reformat, re-type, or judge.`,
      `Then return ONLY: that absolute path + one line confirming the save.`,
    ),
    samples: [{ name: "no grid spec — save the stdout already held", tail: "none",
      args: { gridLedger: "grid-ledger.json" } }],
  },
];

/** @returns {object|undefined} the registered composer for a dispatch `trigger`. */
export const composerFor = (key) => REPAIR_COMPOSERS.find((c) => c.key === key);

/**
 * Every registered key, for the discovery census to compare the source against.
 *
 * THE KEY IS `stage:trigger`, NOT the trigger alone. `coverage-closure` and `frame-reopen` each exist on
 * `common-law` AND on `common-law-half` with genuinely different composers, so a trigger-only key would
 * resolve both halves to whichever entry came first — the guard would then walk one composer twice and
 * never see the other. That is this issue's own failure mode, rebuilt inside its fix.
 */
export const REGISTERED_KEYS = REPAIR_COMPOSERS.map((c) => c.key);

/**
 * Compose a registered repair followup, or REFUSE.
 *
 * "Registered or it does not reach a seat" is enforced here rather than only in CI: an unregistered
 * trigger throws at the dispatch site instead of quietly composing text no guard has ever walked. The
 * census in `driver/test/repair-composer-registry.test.mjs` is what makes it a build failure; this is
 * what makes it impossible at runtime.
 */
export function repairFollowup(key, args) {
  const c = composerFor(key);
  if (!c) {
    throw new Error(`[repair-composers] no registered composer for "${key}". A bespoke repair `
      + `instruction must be registered in driver/repair-composers.mjs before it can reach a seat — an `
      + `unregistered composer is invisible to the #865 agreement guard, which is the whole of #1183.`);
  }
  return c.compose(args ?? {});
}

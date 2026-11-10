// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/overview-and-cards.mjs — the report's overview and its cards, and the front matter the driver stamps on them.
//
// One phase of a run, moved out of pipelineInner unchanged. `helpers` are functions still held in pipeline.mjs, handed in
// because this module must not import that one back; each moves here when the other phases that share it have moved.
import { atomicWrite, paths } from "../run-record.mjs";
import { driverDir, ensureDriverDir } from "../../shared/driver-dir.mjs";
import { applyAskClosure, deriveAsks, finalizeOpenHandoffs, summarizeAsks } from "../ask-ledger.mjs";
import { mintCommonLawCarryDoubts } from "../commonlaw-carry.mjs";
import { readDeclinations } from "../declination-tool.mjs";
import { CLOSURE_EVIDENCE_FILES } from "../doubt-closure-call.mjs";
import { readAcceptedClosures } from "../doubt-closure-tool.mjs";
import { applyClosure, mintContradictionDoubts, mintCrossCheckDoubts, stitchDoubts } from "../doubt-ledger.mjs";
import { doubtSelectionNote, doubtsForClosure } from "../doubt-selection.mjs";
import { config } from "../driver.config.mjs";
import { resolveTerritories } from "../effective-scope.mjs";
import { bindRecommendation, parseFindingsJsonLenient } from "../findings-model.mjs";
import { exitsForLog, notesExits, pickingExits } from "../hand-off-exits.mjs";
import { note, runLog } from "../log.mjs";
import { lastAcceptedMatterFrame } from "../matter-frame-record.mjs";
import { fallbackNoteFor } from "../numeric-setting.mjs";
import { readPartNotCompleted } from "../parts-not-completed.mjs";
import { mintPlacementCarryDoubts, reconcilePlacementCarry } from "../placement-carry.mjs";
import { placementAuditRows } from "../placement-decisions.mjs";
import { parsePlacementsJson } from "../placement-model.mjs";
import { mintPresenceDoubts } from "../presence-reconciliation.mjs";
import { buildAuditMd, parseSpineFindingBlocks } from "../publish/audit-from-spine.mjs";
import { deriveRegisterPresence } from "../publish/register-presence.mjs";
import { recallReceiptForOwnCompany } from "../recall-receipt.mjs";
import { mintRecordCarryDoubts, silentlyLostFindings, statedDivergenceFindings } from "../record-carry.mjs";
import { recordedFindingUris } from "../register-digest-record.mjs";
import { SETTLED_CLASSES, mintRemedyAccountingDoubts } from "../remedy-accounting.mjs";
import { IDENTITY_FILE as REPORT_IDENTITY_FILE, renderReportOverview } from "../report-overview-record.mjs";
import { parseVariantManifestModel } from "../variant-manifest-model.mjs";
import { readWithheldFamilies } from "../withheld-families.mjs";
import { gradedWriteUpRung } from "../write-up-form.mjs";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export async function runOverviewAndCards({ P, applyCoverageFloor, clampOnTheWritersDuty, ctx, followTheRecordsActions, job, run, runState, saveTheLabel, writeVerdictSidecar }, helpers) {
  const { StageFailure, applyScopeFrontMatterOf, asPartNotCompleted, assembleReportMd, caseLawJoin, consolidateFindingsFile, correctionsTheRestoreLacks, deriveCommonLawCarry, deriveRecordCarry, inScopeClassList, injectDeferralCoverage, injectFrontMatter, injectLaneDepthCoverage, injectMeaningGapCoverage, injectScreenGateCoverage, injectScriptScopeCoverage, keepDeliveredRecordAsHistory, localLanguageStateOf, must, openAskForClosure, originRowsForReport, planWriteUps, readFindingsForReport, readReadingLog, rebuildDeliveredRecord, reportIdentityRecord, restoreTheRecordThatPassed, rewriteFromBeforeTheSeam, runBatched, safeReadJson, settleDerivedBases, stage, stampCoverageJudgmentRows, withdrawSupersededAudit, writeScopeFactsOf, writeShortEntries } = helpers;
  // Phase 3 — delivery (v14 post-mortem fix). One LLM step curates the report; the audit, the page render,
  // and the email body are deterministic CODE; a tiny LLM step only SENDS. Each step is independent — a
  // failure in the audit or the email never loses the report.

  // B1 — the report is rendered in TWO isolated parts, then ASSEMBLED by the driver (was ONE pass over every
  // card → the ashen-lattice cross-contamination). (1) report-overview: the cross-finding shell (front-matter +
  // Actions/Coverage/Methodology). (2) report-card per full-prose finding, each from ITS OWN record only — so a
  // card can never carry another finding's body. Then deterministic assembly (render.mjs fills any gap
  // structured-only). Each stage is file-gated/resumable; per-card sessions feed the lint repair below.
  // C2 — fold same-owner+same-mark duplicate filings into one finding BEFORE the overview + cards read
  // findings.json, so the whole delivery phase (and the published copy) sees the single consolidated set.
  // THE SEAM'S WRITES ARE ONE CLOSURE, so they can run again: a synthesis save after this point rewrites
  // findings.json from the seat's own call, and every write below went with it (`stage()` re-runs them).
  const seamWrites = async () => {
  // A pass follows each rewrite of findings.json and adds the rows below again, so delivery reads only the adders
  // that failed since the last of these.
  runLog(run.runDir, { event: "coverage-rows-pass" });
  injectDeferralCoverage(P, run.runDir, note); injectMeaningGapCoverage(P, run.runDir, note);   // A3: unclosed reopen directives, and meaning searches that did not complete, become reader-visible coverage rows first
  // qw/cn-scope-honesty — the sibling injection: a CN-family-scope run whose zh lane did not run
  // discloses what the native-language investigation would have searched, and where it is offered
  // (coverage-limited: never clamps, never gates).
  // — every candidate lane in LANGUAGE_LANES, not zh alone. A JP- or KR-scoped run without the
  // investigation now states the Japanese/Korean-script equivalents it did not search, exactly as a
  // CN-scoped one has always stated the Chinese ones.
  // — the run STATES which jx slices it executed, derived from the per-unit records and the
  // frozen lane decision. Minted HERE and not at the fold, because the fold runs before both retrieval
  // slices (grid at ~:5857, nativeread at ~:8503) and a writer inside it could only ever say
  // "candidates". This is the first point after slice 3 that every resume reaches. Never-kill.
  // GUARDED on the SAME condition as every other jx site (:5833, :5870, :8515). Without it this ran on
  // every clearance, including the ones that never had a jx lane — and both R2 runs of the 2026-08-09
  // round carry no _driver/jx-lanes.json at all. On those the writer would reach its absent arm and
  // print "NOT writing one", which reads as a withheld action on a run where absence is simply normal.
  // That is the absent-vs-failed conflation this tranche exists to remove; a lazy import also keeps a
  // plain clearotron byte-identical, which is why the sibling sites are shaped this way.
  let localLanguage = null;
  if (ctx.searchPolicy?.components?.jxLanes) {
    try {
      const { stateJxSlices } = await import("../jx.mjs");
      stateJxSlices(run.runDir, { note, runLog });
    } catch (e) { note(`jx slice statement skipped (${String(e?.message ?? e).slice(0, 100)}) — never-kill`); }
    try { localLanguage = await localLanguageStateOf(run.runDir); } catch { localLanguage = null; }
  }
  injectScriptScopeCoverage(P, run.runDir, note, { searchPolicy: ctx.searchPolicy, job, profile: ctx.profile, localLanguage });
  // — AFTER stateJxSlices, and the order is load-bearing: this reads `fold.depth`, which the call
  // above mints. Before it, every run would look like one that never stated a verdict. Its sibling one
  // line up covers the lane that did not run; this covers the lane that ran short of what was bought.
  injectLaneDepthCoverage(P, run.runDir, note);
  // The third sibling: each mark the screen-gate disclosed as unexamined
  // gets its own reader-visible coverage row (guarded on the ctx/sidecar unresolved set; idempotent by
  // mark+uri). The CONDITIONAL clamp came from applyCoverageFloor's screenGateGap arm above, never
  // from these coverage-limited rows.
  injectScreenGateCoverage(P, run.runDir, note, ctx);
  // — the fourth sibling, and the one that REPLACES rather than adds: coverage_judgment.rows
  // is derived from the machine ledger and the plan-execution receipt instead of retyped by the seat.
  // Same seam and same reason as injectDeferralCoverage above — every synthesis re-run has settled, so
  // a re-emit cannot clobber it; and it lands before report-overview and the cards, which are stamped
  // afterwards and therefore never read it as staleness.
  stampCoverageJudgmentRows(P, run.runDir, note, ctx);
  consolidateFindingsFile(P, note, ctx.framework);
  // The conditions too: a save that rewrote, withdrew or added a forward legal step moves the list with it.
  followTheRecordsActions("after a save of the record");
  // T2: consolidation can change the live composite set — re-derive the sidecar so every
  // surface joins the FINAL findings (the sidecar must never describe a superseded set).
  // review fix: consolidation can also surface CONDITIONS the floor never saw (a lenient-
  // quarantined action healed by the strict rewrite, or a transient read failure at floor time) —
  // the sidecar's CLEAR-with-conditions throw then re-runs the FLOOR once instead of bricking a
  // delivery the later lint repair was built to heal.
  try { writeVerdictSidecar(); }
  catch (e) {
    note(`verdict sidecar refresh: ${String(e.message).slice(0, 100)} — re-deriving the floor once`);
    applyCoverageFloor();
    try { writeVerdictSidecar(); }
    catch (e2) { throw new StageFailure("verdict", `verdict sidecar refresh failed after consolidation: ${String(e2.message).slice(0, 120)}`); }
  }
  };
  // THE RECORD THE CARDS ARE BUILT ON CARRIES EVERY DEMOTION. The derivation settled the record after the first
  // synthesis save; a corrective pass saves again before this seam, and a whole re-send brings back every stamp it had
  // demoted. Built on those, every card whose finding carried one read as stale after the derivation before delivery
  // demoted them again, and was rebuilt with the overview for a finding nothing had changed. Settled here, once more,
  // before the overview and the cards; idempotent on a record that already carries every demotion.
  settleDerivedBases(ctx, "seam");
  await seamWrites();
  // Every write above is idempotent: each injection skips a row the record already carries, the stamp
  // replaces its rows, and the fold leaves a folded record as it is.
  ctx.afterSynthesisSave = async () => {
    note(`[seam] a synthesis save after the seam rewrote findings.json — re-applying the seam's writes`);
    runLog(run.runDir, { event: "seam-reapplied", after: "synthesis-save" });
    rewriteFromBeforeTheSeam(ctx);   // the basis derivation and the deadline enrichment, as the pass made them
    await seamWrites();
  };
  // wp50/wi2 — the overview PROSE must speak the derived tier (VENZY: caption said "High risk" while
  // every code surface said VERY HIGH). Thread the just-refreshed sidecar into the stage prompt; the
  // deterministic backstop is predelivery-lint's overallTierChecks.
  runState.displayVerdict = null;
  try { runState.displayVerdict = JSON.parse(readFileSync(paths(run.runDir).verdict, "utf8")); } catch { /* legacy — prompt line omitted */ }
  // ── CONVERSION 4 — THE DRIVER'S OWN FRONT-MATTER RECORD ──────────────────────────────────────
  //
  // Nine of report-overview.md's ten front-matter keys are values the driver already holds and used to
  // hand the seat in the dispatch so the seat could type them back into a file the driver then parsed.
  // They are written here, from the same `job` object `frontMatterIdentity` read, at the same point in
  // the run — so the record and the old dictation cannot disagree about what the values were.
  //
  // NOT added to `_driver/instructed-scope.json`, and that is a live guard rather than a preference:
  // `validators.matterContext` compares the matter frame against EVERY VALUE in that file, so a key
  // added there becomes a value the FRAME must quote verbatim. Conversion 4 would have failed a
  // different stage's validator, on a field neither stage is about.
  //
  // `classes` is the INSTRUCTED list, which is what the seat typed too. applyScopeFrontMatter still
  // stamps the authoritative `classes_line` from _driver/scope-facts.json at assembly (that sidecar is
  // written after this stage runs, so it cannot be read here), and applyVerdictFrontMatter still stamps
  // overall_label/overall_badge. This removes the SEAT from those keys; it does not touch the driver's
  // own authority over them.
  try {
    ensureDriverDir(run.runDir);
    writeFileSync(join(run.runDir, REPORT_IDENTITY_FILE), JSON.stringify(reportIdentityRecord(job, ctx, run.runDir, runState.displayVerdict), null, 2) + "\n");
  } catch (e) { note(`report identity write failed (non-fatal — the shell renders the keys it has): ${e.message}`); }
  // THE REPORT OVERVIEW, WHERE IT COULD NOT BE COMPLETED (parts-not-completed.mjs). Its recovery was spent, so the report
  // delivers its rating and its cards without the overview's conclusion, and the workbook's shipped "Summary" row says
  // so. The shell the overview would have written is the driver's own, with the run's identity and no conclusion, and
  // no overview is dispatched again on this pass: not here, not by the lint's redo, not by the delivery check's repair.
  const overviewOpen = readPartNotCompleted(run.runDir, "overview");
  if (overviewOpen) {
    writeFileSync(P.reportOverview, renderReportOverview({ overall_caption: null, handling_note: null, actions: [], methodology: null },
      reportIdentityRecord(job, ctx, run.runDir, runState.displayVerdict)));
    runLog(run.runDir, { event: "overview-not-completed-delivery", stage: overviewOpen.stage ?? null });
  }
  const rov = overviewOpen ? null
    : await asPartNotCompleted("overview", async () => must(await stage("report-overview", { ...ctx, displayVerdict: runState.displayVerdict }, {}), "report-overview"));   // T3a: a BLOCKING run now DELIVERS; its open points are rendered at assembly, not dispatched here
  const findingsRead = readFindingsForReport(P);
  const findingsForCards = findingsRead.findings;
  //: a rejected findings.json is a defect, not an emptiness. Say so HERE, where the file was read,
  // with the validator's own token — the card loop below can only observe the consequence.
  if (findingsRead.rejected) note(`findings.json is present and REJECTED by the strict parser (${findingsRead.rejected}) — joining ${findingsForCards.length} finding(s) leniently for the card match; the delivery guard still refuses`);
  // P2 clause 3 — assigned in the lint block below, consumed by the freshness precondition before the
  // client gate. Declared here so both live in the same scope regardless of the lint block's nesting.
  runState.staleStages = [];
  runState.staleOnTheDeliveryPath = () => runState.staleStages;   // the same question, asked again: set where the lint block asks it
  // ── §9 — THE CARD SET IS `fullProseOrdinals ∧ form === "full"` ───────────────────────────
  //
  // On one country every form is `full`, so this reduces to `fullProseOrdinals` — the same list, in the
  // same order, dispatching the same cards. That is the byte-identical argument in its structural form
  // rather than as a diff someone has to re-run.
  //
  // On a graded product the findings that drop out are NOT lost: they render as a short entry or a
  // grouped line, built code-side from the typed `net` already in findings.json. What they stop costing
  // is a card DISPATCH — a paid model turn per mark — which is the whole saving §8 claims.
  //
  // The floor tier joins on `mark_text` (see floorTierByMark): joining on `mark` returns a clean,
  // plausible zero, and a zero here means every floor row quietly loses the full card the owner made
  // non-negotiable. An absent band-shape yields an empty map and every finding reads as holding no
  // floor — which is what it did before this existed.
  // The plan is made in one place (planWriteUps), the same way here and wherever a later save changes the record:
  // the full cards in the record's order, then the remainder, in the same order, for the short-entry and grouped-row
  // render below.
  const writeUps = planWriteUps(findingsForCards, ctx.depth, safeReadJson(P.bandShape));
  const { cardOrdinals, entryOrdinals } = writeUps;
  // §9 — WRITTEN ON EVERY GRADED PRODUCT, INCLUDING ONE WHOSE ENTRY COUNT IS 0. The old gate was
  // `entryOrdinals.length`, which conflated two different empties: one country is empty BY CONSTRUCTION
  // (every form is `full`, so the row would report the product's own definition back), while a graded run
  // where every finding earned a card is empty AS A MEASUREMENT — a fact about that run's population, and
  // the exact shape the ladder is asked to justify. Under the old gate that measurement was indistinguishable
  // from a run predating the gauge. Gate on the rung, never on the count. My defect, from this section.
  if (gradedWriteUpRung(ctx.depth))
    runLog(run.runDir, { event: "write-up-forms", full: cardOrdinals.length, entry: entryOrdinals.length,
      depth: ctx.depth?.source ?? null });
  if (cardOrdinals.length) mkdirSync(P.reportCardsDir, { recursive: true });
  // T7 (E5): each card gets ITS matched grounded case-law profile INLINE — the old
  // "if the file exists, fish in it" instruction was model-discretionary and missed cards.
  let caseLawByOrd = new Map();
  try {
    if (existsSync(P.caseLaw)) caseLawByOrd = caseLawJoin(P, findingsForCards);
  } catch { /* no case-law layer */ }
  // A2 — cards are isolated BY DESIGN (each sees ONLY its own finding and writes its own
  // P.reportCard(ord) file), so they fan out like the gather members instead of paying 8–14 serial
  // LLM walls. The first card runs alone to warm the shared prompt-prefix cache; the rest batch at
  // gatherConcurrency. A failed card stays non-fatal (render shows it structured-only) and never
  // fails a sibling — renderCard resolves on rc.fail, it never throws. assembleReportMd runs
  // strictly after every card settles; the lint-repair re-render loop below stays serial.
  const cardFindings = findingsForCards.filter((f) => cardOrdinals.includes(f.ordinal));   // secondary findings render structured-only (no LLM call)
  // A CONTENT failure stays non-fatal: the render shows that finding structured-only, which is a
  // thinner card, not a missing one. A RATE LIMIT is not a content failure — it is the engine's
  // session cap, and swallowing it ships a report whose cards are thin because we were throttled,
  // with nothing saying so. Every other stage routes that to the postpone lane and delivers complete
  // later; cards were the exception only because the fan-out was too narrow to hit it often. Collected
  // here and raised after the fan-out settles, so one throttled card cannot abandon its siblings.
  const cardRateLimited = [];
  const renderCard = async (f) => {
    const rc = await stage("report-card", { ...ctx, axis: String(f.ordinal), finding: f, caseLawProfile: caseLawByOrd.get(f.ordinal) ?? null }, {});
    if (rc.ok) return;
    if (rc.fail === "rate_limited" && !existsSync(P.reportCard(String(f.ordinal)))) {
      cardRateLimited.push({ ordinal: f.ordinal, resetsAt: rc.resetsAt ?? null });
      return;
    }
    note(`report-card[${f.ordinal}] failed (non-fatal — render shows it structured-only): ${rc.fail}`);
  };
  if (cardFindings.length) await renderCard(cardFindings[0]);
  // — THE ONE SETTING ALLOWED TO FALL BACK IS NOT ALLOWED TO DO IT QUIETLY. Every
  // other numeric setting refuses a value it cannot parse, by name, at the read. This one is read
  // mid-run and is not grade-moving, so refusing would turn a delivering search into a refusal over an
  // operator's typo — the run continues on the default instead. It says so here, once, in the run's own
  // record: a fallback nobody can see is how a deployment ends up running on a number nobody chose,
  // which is the same defect one register quieter.
  const cardCapNote = fallbackNoteFor("CLEAROTRON_CARD_CONCURRENCY");
  if (cardCapNote) note(`[config] ${cardCapNote}`);
  await runBatched(cardFindings.slice(1), config.cardConcurrency, renderCard);
  if (cardRateLimited.length) {
    const earliest = cardRateLimited.map((c) => c.resetsAt).filter(Boolean).sort()[0] ?? null;
    runLog(run.runDir, { event: "report-cards-rate-limited", count: cardRateLimited.length,
      ordinals: cardRateLimited.map((c) => c.ordinal), resetsAt: earliest });
    // Resumable by construction: the cards that DID land are file-gated and skip on the resume, so
    // the postpone costs only what the cap actually blocked.
    throw new StageFailure("report-card", "rate_limited", earliest);
  }
  // ── §8 — THE TWO GRADED FORMS, WRITTEN CODE-SIDE ────────────────────────────────────────
  //
  // Every entry finding is either a SHORT ENTRY (its own card file, composed from the typed `net` — no
  // dispatch) or a member of a GROUP (a line in the sibling section below). §8 sets the minimum group
  // size at two and renders the remainder as short entries, so `singles` is exactly that remainder.
  //
  // WORLDWIDE GROUPS BY THE RIGHT, multi-country by territory. The flag is derived from the depth row
  // rather than a product name so the two cannot drift: the worldwide row is the one whose prose rung
  // is `adversarial`, multi-country's is `adversarial+floors`, and both come from the same table.
  //
  // The bodies are written to the SAME card files a dispatched card would use, so `assembleReportMd`
  // frames them with the same composer and the ordinal binding is untouched. What they never get is a
  // model turn — the whole saving.
  const { entryFindings, byRight, entrySingles } = writeUps;
  writeShortEntries(P, entrySingles);
  // Assembly sees full cards AND short entries; the DISPATCH set and the freshness stage list stay
  // `cardOrdinals`, because a short entry has no stage and never had one.
  const { assembledOrdinals, groupedMembers } = writeUps;
  if (entryFindings.length)
    note(`write-up forms: ${cardOrdinals.length} full card(s), ${entrySingles.length} short entr(y/ies), ${groupedMembers.length} grouped line(s)`);
  assembleReportMd(P, findingsForCards, assembledOrdinals, { grouped: groupedMembers, byRight });
  // The client-summary inclusion scope (WP-56 A4) and its _driver/client-summary-scope.json sidecar
  // are DELETED with the stage (2026-08-01) — they existed only to dictate which cards that stage
  // had to carry. verify.mjs's checkClientSummaryJoin still reads the sidecar when replaying an
  // archived run that has one; a live run writes none, and that check already skips when it is absent.

  // The WS1c failover-transparency stamp (`failoverModel` + `failover_note` into report.md front-matter,
  // rendered by composeEmailHtml as a "Model failover:" line) stood here and is DELETED. It could
  // never fire: it read ctx.failovers, which only a fired chain rung ever wrote, and the chain had exactly
  // one rung. No code path can put a failover note in a report now — that is the point of the issue.

  // T2 (H5) — the report's overall label/badge/recommendation are DRIVER-OWNED, derived from
  // the verdict sidecar: the model-authored fm.overall_label was the second verdict authority that let
  // the hero contradict the reviewer verdict AND the client tier. Kept as a closure because a lint-repair
  // redo re-emits report.md, so every driver-owned front-matter field is re-applied after it.
  const applyVerdictFrontMatter = () => {
    let v = null;
    try { v = JSON.parse(readFileSync(paths(run.runDir).verdict, "utf8")); } catch { return; }
    if (!v?.tier) return;
    const fields = { overall_label: v.tier, overall_badge: v.badge };
    try {
      const fmBlock = readFileSync(P.report, "utf8").match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
      const rec = fmBlock.match(/^recommendation:\s*(.+)$/m)?.[1];
      if (rec != null) {
        const bound = bindRecommendation(rec, v.verdict, v.reasons);
        if (bound !== rec.trim()) fields.recommendation = bound;
      }
    } catch { /* report absent — injectFrontMatter no-ops anyway */ }
    const wrote = injectFrontMatter(P.report, fields, run.runDir);
    if (wrote) runLog(run.runDir, { event: "verdict-frontmatter", tier: v.tier, badge: v.badge, verdict: v.verdict });
  };
  applyVerdictFrontMatter();
  // compute-don't-author (PR-4) — the masthead's SCOPE line is DRIVER-OWNED, like the verdict labels
  // above: the model-typed `classes:` value was the second scope authority that let the masthead say
  // "searched" over a class three machine stores called dispatched-but-not-enumerated (the 2026-07-28 postmortem run).
  // writeScopeFacts derives _driver/scope-facts.json (pure join: instructed-scope × frozen plan ×
  // band states × coverage ledger — scope-facts.mjs); applyScopeFrontMatter overwrites `classes:`
  // and injects `coverage_line:` from it. Recomputed + re-applied after every lint-repair
  // reassembly (same discipline as applyVerdictFrontMatter); ZERO render.mjs change — the frozen
  // renderer keeps rendering fm.classes verbatim, we changed WHO AUTHORS the value.
  const writeScopeFacts = () => writeScopeFactsOf(ctx, P, run.runDir);
  const applyScopeFrontMatter = () => applyScopeFrontMatterOf(P, run.runDir);
  writeScopeFacts();
  applyScopeFrontMatter();
  // T9 (K3) — DISCLOSE which profile/framework rated this run (+ the verifiable sha).
  // Methodology identity, not QC — it renders on the internal report, the client summary footer
  // and the email ( F7: nothing disclosed which framework rated a run, so K1 was untestable).
  // PR-11: ONE closure, like its applyVerdictFrontMatter / applyScopeFrontMatter
  // siblings. The lint-repair reassembly branch below re-applies the same driver-owned front matter, and
  // it used to do it from a VERBATIM PASTE of this block ~500 lines away — two copies that had to be
  // edited in lockstep forever, with nothing to catch a drift.
  const applyRatedUnderFrontMatter = () => {
    const pr = ctx.profile;
    if (pr?.name || pr?.profileKey) {
      // doc 50 — say WHICH of the two is in force in words a human notices: the customer's own
      // framework (title + file) or the Generic default. The manifest title comes from the frozen
      // framework sidecar, so the disclosure can never drift from what actually rated the run.
      // — THIS LINE IS READ BY A LAWYER, AND IT SHIPPED A HASH AND A FILENAME. It rendered as
      // "… · custom framework: <title> (risk-framework-<slug>.md) · profile e186ce0adbfc". The sha is
      // telemetry — it identifies a config revision to us and nothing at all to the reader — and the
      // filename is the title again in machine form. Both are DROPPED from the client surface; both
      // are still recorded, in `run.jsonl`'s methodology-witness and `_driver/methodology-read.json`,
      // which is where anyone asking "which revision rated this run" is actually looking.
      const fw = pr.frameworkPath
        ? `custom framework: ${ctx.framework?.title ?? basename(String(pr.frameworkPath))}`
        : "generic default framework";
      injectFrontMatter(P.report, { rated_under: `${pr.name ?? pr.profileKey} · ${fw}` }, run.runDir);
      // spec 62 — beside the framework disclosure, name WHICH PROJECT rated this run (the customer's own
      // display name in parentheses), plus the per-field configuration-provenance rows (rendered internal-only
      // in the scope fold). Omitted entirely for a no-project run (pr.projectKey absent).
      if (pr.projectKey) {
        injectFrontMatter(P.report, { run_under_project: `${pr.projectName ?? pr.projectKey} (${pr.name ?? pr.profileKey})` }, run.runDir);
        const originRows = originRowsForReport(pr);
        if (originRows.length) injectFrontMatter(P.report, { origins_json: JSON.stringify(originRows) }, run.runDir);
      }
    }
  };
  applyRatedUnderFrontMatter();

  // A1b (the client-summary stage dispatch) is RETIRED 2026-08-01. Its output reached no reader
  // after the one-report collapse, and it was not free: on the R2 evidence run it burned 931s over
  // five dispatches, three of them failing identically until the ladder exhausted.
  // composeEmailHtml now takes its headline tier from the verdict sidecar and its conditions from
  // the report's own `# Actions`.

  // A FINDINGS RECORD BROKEN AFTER SYNTHESIS PASSED IT IS RESTORED, NOT ENDED ON. It is checked as the delivery
  // gate checks it, before the audit and the delivery checks are built from it, and again at that gate. A broken record
  // comes back from the last save that passed (restoreTheRecordThatPassed). A save rebuilt with the duty set aside is
  // judged again here, as after a rollback, and the corrections a save from before the repair lacks close the client
  // export (correctionsTheRestoreLacks). With no save to restore, the failure is the assessment not completed: its
  // recovery re-runs synthesis, which a broken record does not let skip, and once that is spent the run delivers
  // without the assessment. Returns the restore, or null where no save passes.
  const restoreTheBrokenRecord = async (failures, where) => {
    const restored = await restoreTheRecordThatPassed(ctx, P, run.runDir, (raw) => { parseFindingsJsonLenient(raw); });
    if (!restored) {
      note(`core-artifact (${where}): ${failures.join("; ")} — no save passes either, so the assessment is not completed`);
      return null;
    }
    const lacks = correctionsTheRestoreLacks(run.runDir, restored.from);
    if (lacks.length) {
      // Joined to what the state already holds: an earlier correction's names stay in the reason.
      const at = paths(run.runDir).correctionsState;
      const held = (() => { try { const s = JSON.parse(readFileSync(at, "utf8"))?.stale; return Array.isArray(s) ? s : []; } catch { return []; } })();
      try { atomicWrite(at, JSON.stringify({ ts: new Date().toISOString(), stale: [...new Set([...held, ...lacks])] }, null, 2)); }
      catch { /* the event below records it */ }
    }
    runLog(run.runDir, { event: "core-artifact-restored", where, from: restored.from, duty: restored.duty, ...(lacks.length ? { correctionsLacked: lacks.length } : {}) });
    note(`core-artifact (${where}): ${failures.join("; ")} — the record is restored from the ${restored.from}, and the run delivers from it`);
    if (restored.duty === "relaxed") {
      const was = runState.verdict, stood = JSON.stringify(runState.clampReasons);
      clampOnTheWritersDuty({ again: true });
      if ((JSON.stringify(runState.clampReasons) !== stood || runState.verdict !== was) && saveTheLabel("after the record was restored")) applyVerdictFrontMatter();
    }
    return restored;
  };
  if (existsSync(P.findings)) {
    let broken = null;
    try { parseFindingsJsonLenient(readFileSync(P.findings, "utf8")); } catch (e) { broken = `findings.json — ${String(e.message).replace(/\s+/g, " ").slice(0, 140)}`; }
    if (broken) {
      runLog(run.runDir, { event: "core-artifact-invalid", failures: [broken], where: "delivery-checks" });
      if (!(await restoreTheBrokenRecord([broken], "delivery-checks")))
        throw Object.assign(new StageFailure("core-artifact-gate", `a core machine artifact is invalid and cannot ship: ${broken}`), { notCompletedPart: "assessment" });
    }
  }

  // A2 — full audit: DETERMINISTIC CODE (parse the spine tables → audit.md, count-guarded). Replaces the LLM
  // audit-emit (output varied 47↔69 on identical input). NON-FATAL: if it fails, the report still ships (publish
  // renders the report with no xlsx when audit.md is absent), and the audit self-recovers on a re-run.
  // `rebuildTheDeliveredRecord` is set by the block once the audit is written: the delivery check calls it after a repair.
  let rebuildTheDeliveredRecord = null;
  let auditWrittenThisPass = false, earlierPairKept = null;
  try {
    // One resolution per claim: hand the builder the run's OWN dispositions so a withdrawn conflict reads
    // as withdrawn on the audit surface too (it already does on report + client summary). Best-effort —
    // a malformed findings.json is validators.findings' business and must never cost us the audit.
    let auditRunFindings = null, auditRunActions = [], auditRunCoverage = [];
    try {
      if (existsSync(P.findings)) {
        const parsed = parseFindingsJsonLenient(readFileSync(P.findings, "utf8"));
        auditRunFindings = parsed.findings;
        auditRunActions = parsed.actions ?? [];
        auditRunCoverage = parsed.coverage ?? [];   // presence-or-reason: coverage-row areas join the delivered set
      }
    } catch { /* stamping is skipped; the audit still builds */ }

    // HALF TWO, and the ONLY place this artifact is authored. Here because `auditRunFindings` is
    // parsed immediately above, so the findings this joins against demonstrably exist — the property
    // the digest-time derivation could not have and did not check. Everything downstream (the doubt
    // mint below, the predelivery lint's `recordCarry` arms) reads THIS artifact rather than deriving
    // its own: two derivations from different inputs is what let the doubt ledger be roughly right
    // while the artifact and every lint arm were inverted.
    // A resumed pass writes both again: what the earlier pass wrote is kept under _history first.
    earlierPairKept = keepDeliveredRecordAsHistory(P, "earlier-pass");
    deriveRecordCarry(ctx, "publish", { findings: auditRunFindings ?? [] });
    // ── — AND NOW THE JOIN BETWEEN THE TWO ARTIFACTS THAT WERE EACH RIGHT ────────
    //
    // `recall-reconciliation.json` measured the DIGEST and reported `unended: 0`; the artifact written
    // one line above measured REASONS and reported `unreasoned: 0`. Both true. Between them a position
    // the digest ended as a FINDING was dropped at placement with `reason_source: "step-silent"` and
    // the client lost the mark. Nothing read one against the other, so nothing could see it.
    //
    // HERE, for the same reason moved the carry here: this is where the findings demonstrably
    // exist and where the artifact it joins has just been authored. Best-effort and never fatal — this
    // seam does not gate delivery (that is the pre-verdict floor's job), it makes the loss SAYABLE.
    try {
      const silent = silentlyLostFindings({
        reconciliation: safeReadJson(P.recallReconciliation),
        carryRows: safeReadJson(P.recordCarry)?.rows ?? null,
        // — the INDEPENDENT population, read from the typed calls by other code.
        // Without it a reconciliation looking at an entirely different set answers "clean".
        digestFindingUris: recordedFindingUris(P.runDir),
      });
      runLog(P.runDir, { event: "silently-lost-findings", computable: silent.computable,
        reason: silent.reason, population_empty: silent.population_empty === true,
        checked: silent.checked, matched: silent.matched, lost: silent.lost.length,
        marks: silent.lost.map((l) => l.mark).filter(Boolean).slice(0, 10) });
      if (silent.lost.length) {
        note(`recall: ${silent.lost.length} position(s) the digest ended as FINDINGS reached no client `
          + `surface and no step said why — ${silent.lost.map((l) => `${l.mark ?? l.uri} (${l.reason})`).join("; ")}`);
      }
      // ── AND THE STATED CASE, WHICH IS THE ONE THAT REACHED A CLIENT ────────────────────────────
      //
      // Same inputs, same seam, same best-effort contract — a second call rather than a widened first
      // one, because the sibling's population boundary is deliberate and correct. It covers a
      // finding-ending followed by SILENCE; this covers one followed by a SENTENCE.
      //
      // On a delivered R2 run the sibling logged `checked:5 matched:5 lost:0` — correctly — on a
      // delivery missing two marks from the lawyer's final list, one rated HIGH. They were dropped with
      // a reason, so they were outside its population by design. A drop with a reason nobody verifies
      // is not accounted for; it is unexamined with a paper trail, and that delivery carried 66 of them.
      const stated = statedDivergenceFindings({
        reconciliation: safeReadJson(P.recallReconciliation),
        carryRows: safeReadJson(P.recordCarry)?.rows ?? null,
        digestFindingUris: recordedFindingUris(P.runDir),
      });
      runLog(P.runDir, { event: "stated-divergence-findings", computable: stated.computable,
        reason: stated.reason, population_empty: stated.population_empty === true,
        checked: stated.checked, matched: stated.matched, diverged: stated.diverged.length,
        marks: stated.diverged.map((d) => d.mark).filter(Boolean).slice(0, 10) });
      if (stated.diverged.length) {
        note(`recall: ${stated.diverged.length} position(s) the digest ended as FINDINGS are absent from `
          + "the findings and were dropped with a STATED reason pointing at another artifact — "
          + stated.diverged.map((d) => `${d.mark ?? d.uri} (${d.reason}${d.cites_artifact ? ` → ${d.cites_artifact.join(", ")}` : ""})`).join("; "));
      }
    } catch (e) { /* never mask a delivery */ }
    // — the common-law path, and the jx zh slice on the same tracer. `consumed` used to read
    // CLEAROTRON_JX_CONSUME, which decided whether a zh candidate could reach a finding at all: with it
    // off every candidate was `shadow:not-consumed`, a configuration boundary rather than a judgment.
    // item 8 deleted the switch, and had already recorded production running with it ON —
    // so `consumed` is now unconditionally true, which is the state that comment said we were leaving
    // for. An armed slice flows through the ordinary reason classes with no second code path, and
    // `shadow:not-consumed` becomes unreachable rather than merely unused.
    deriveCommonLawCarry(ctx, "publish");
    if (existsSync(P.jxZhGrid)) {
      deriveCommonLawCarry(ctx, "publish", {
        slice: "jx-zh-grid", gridPath: P.jxZhGrid, outPath: P.jxZhCarry,
        consumed: true,
      });
    }
    // THE HAND-OFFS' EXITS WITH NO GROUND, read off the record trace written just above and the findings
    // parsed before them: a record that left the picking step, and a page the web notes marked as a
    // candidate or conflict that no delivered finding cites, each with nothing saying why. A page the web
    // step only read is not owed a ground, so the grid's rows are not counted here. It reports and never
    // gates, and a missing trace says so by name rather than counting zero.
    try {
      const exits = { picking: pickingExits(safeReadJson(P.recordCarry)),
        notes: notesExits(existsSync(P.commonLaw) ? readFileSync(P.commonLaw, "utf8") : null, auditRunFindings, readDeclinations(P.runDir).byPage) };
      runLog(P.runDir, { event: "reasonless-exits", lane: "clearance", ...exitsForLog(exits) });
      if (exits.picking.exits || exits.notes.exits) {
        note(`hand-offs: ${exits.picking.exits} record(s) of ${exits.picking.owners ?? 0} owner(s) left the picking step `
          + `with no ground; ${exits.notes.exits} page(s) the web notes marked as candidates or conflicts reached no delivered `
          + `finding and no step said why`);
      }
    } catch { /* never mask a delivery */ }

    const registerFindingsText = readFileSync(P.registerFindings, "utf8");
    const commonLawText = existsSync(P.commonLaw) ? readFileSync(P.commonLaw, "utf8") : "";

    // Doubt stitching (2026-07-22 — the copper-gantry defect): mint every doubt the run RAISED (the
    // gathers' dictated `CROSS-CHECK REQUIRED:` hand-off lines; asserted⇄refuted contradiction pairs
    // among the audit's own Findings blocks) and stitch each to a resolution the run ALREADY produced
    // (a findings.json disposition/action, a coverage-ledger row, a register-findings answer/watchlist
    // line). Pure join-and-record: nothing re-searches, nothing retries, and an unstitchable doubt
    // ships VISIBLY as OPEN in the audit's # Doubt Ledger — delivery is never gated on a doubt.
    // NON-FATAL end to end: a failure here logs `doubts-failed` and the audit builds without a ledger.
    let runDoubts = null;
    // — one row per mint that actually dropped something: {source, minted, omitted}. Empty on
    // the overwhelming majority of runs, and an empty array renders nothing at all.
    const doubtTruncations = [];
    // ── PR-6: the ASK LEDGER (2026-07-29) — every question the run asked ITSELF ends: executed
    // (COMPUTED from the plan-execution join, never asserted), judged-immaterial with reasons, or
    // recovery (loudly handed over). Derived HERE, at the audit seam, as a deterministic join over
    // the ten birth-places' own receipts (ask-ledger.mjs documents the list). Open rows ride the
    // SAME doubt-closure stage below (dictated ASK line-form; IMMATERIAL always available — the
    // terminating move); still-open rows ship VISIBLY OPEN. Never a gate, no count thresholds, and
    // no cost figure anywhere near closure. NON-FATAL end to end (`asks-failed`).
    let runAsks = null;
    const askTs = new Date().toISOString();
    try {
      const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; } };
      const runEvents = (() => {
        try {
          return readFileSync(paths(run.runDir).run, "utf8").split("\n")
            .filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        } catch { return []; }
      })();
      const unitsDirForAsks = join(run.runDir, "register-units");
      const supplementalPlans = existsSync(unitsDirForAsks)
        ? readdirSync(unitsDirForAsks).filter((n) => n.endsWith("-supplemental-plan.json")).sort().map((n) => {
            const doc = readJson(join(unitsDirForAsks, n));
            return { axis: n.replace(/-supplemental-plan\.json$/, ""), entries: doc?.entries ?? [], rejected: doc?.rejected ?? [] };
          })
        : [];
      runAsks = deriveAsks({
        intakeAsks: ctx.intakeAsks ?? readJson(paths(run.runDir).intakeAsks)?.asks ?? [],
        reportMd: existsSync(P.report) ? readFileSync(P.report, "utf8") : "",
        escalationState: readJson(paths(run.runDir).escalationState),
        events: runEvents,
        frameReopen: readJson(paths(run.runDir).frameReopenReceipt),
        screenGateUnresolved: readJson(paths(run.runDir).screenGateUnresolved)?.unresolved ?? null,
        supplementalPlans,
        xcheck: readJson(paths(run.runDir).registerXcheck),
        recall: recallReceiptForOwnCompany(readJson(paths(run.runDir).registerRecall)),   // never another company's recall line
        withheldFamilies: readWithheldFamilies(run.runDir),   // the reading turn's reasons, for a frame ask its judgment settled
        planExecution: ctx.planExecution ?? readJson(P.planExecution),
      }, { ts: askTs });
    } catch (e) {
      runAsks = null;   // the audit builds ask-less, exactly like a legacy caller
      runLog(run.runDir, { event: "asks-failed", error: e.message });
    }
    try {
      const doubts = [
        ...mintCrossCheckDoubts(commonLawText, basename(P.commonLaw)),
        ...mintContradictionDoubts(parseSpineFindingBlocks(registerFindingsText, commonLawText)),
      ];
      // register unit digests carry the register-side hand-off lines (one file per axis)
      const unitsDir = join(run.runDir, "register-units");
      if (existsSync(unitsDir)) {
        for (const f of readdirSync(unitsDir).filter((n) => n.endsWith(".md")).sort()) {
          doubts.push(...mintCrossCheckDoubts(readFileSync(join(unitsDir, f), "utf8"), `register-units/${f}`));
        }
      }
      // coverage rows: the machine mirror when it survived (best-effort — a missing/invalid ledger
      // just means one fewer resolution source, never a failed stitch pass)
      let coverageRows = [];
      try {
        if (existsSync(P.registerCoverageLedger)) {
          const rows = JSON.parse(readFileSync(P.registerCoverageLedger, "utf8"));
          if (Array.isArray(rows)) coverageRows = rows;
        }
      } catch { /* prose-only run — findings + register-findings joins still stitch */ }
      // Presence-or-reason (2026-07-22 — the unjoined-Sheet-2 leak): every digest row the funnel
      // rated on-field (the Risk-relevant / Incumbent-context sheets) must end in PRESENCE on a
      // delivered surface or a RECORDED reason; synthesis's drop stands, but a silent drop mints a
      // doubt into the same stitch → doubt-closure → # Doubt Ledger chain as every other family.
      doubts.push(...mintPresenceDoubts(registerFindingsText, {
        findings: { findings: auditRunFindings ?? [], actions: auditRunActions, coverage: auditRunCoverage },
        coverageRows, sourceName: basename(P.registerFindings),
      }));
      // — the placement→digest carry join's two unanswered classes. Derived HERE against
      // `registerFindingsText`, the findings file that actually shipped, NOT read back from
      // _driver/placement-carry.json. The artifact is a per-PASS record and register-findings.md is
      // rewritten after the last digest pass by the corrective and lint-repair paths, so minting
      // from it would put losses in the Doubt Ledger of a run that closed them — a false loss on a
      // clean delivery, which is worse than the silence this whole join replaces. The artifact stays
      // the history; the doubt is decided against the delivered text. Both classes mint and they stay
      // APART: `uncarried` is a loss, `unclassified` is the join saying it cannot tell — folding the
      // second into the first, or dropping it, would rebuild the silent drop one level up. A run with
      // no placements.json mints nothing, exactly as before.
      try {
        const placedNow = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements;
        doubts.push(...mintPlacementCarryDoubts(
          reconcilePlacementCarry({ placements: placedNow, registerFindingsText }),
          { sourceName: basename(P.placementModel) },
        ));
      } catch { /* absent, pre-B2 or malformed — validators.placement's business, not this mint's */ }
      // — the seam before that one: a RETRIEVED record that reached a step obliged to speak
      // about it and got no ground from anybody. Re-derived against the delivered findings text for
      // exactly the reason the carry mint above is, and capped, because this list is unbounded by
      // construction (a wholly failed digest could put every placed record in it and drown the
      // ledger) — the artifact always carries the full list, and the cap reports what it omitted so
      // the truncation is itself visible. `stage-incomplete` drops mint NOTHING here: those carry a
      // structural reason already, and the run.jsonl row plus the note carry that fact.
      // — READ, no longer re-derived. This mint used to build its own trace from `auditRunFindings`,
      // which made it correct-by-construction while `_driver/record-carry.json` — written back at
      // register-digest time, before findings.json existed — was inverted, and the predelivery lint reads
      // the artifact. So the doubt ledger has been roughly right and every lint arm wrong on the same
      // run. One derivation, written once above, consumed by both.
      try {
        const rc = safeReadJson(P.recordCarry);
        if (rc?.computable === true) {
          const minted = mintRecordCarryDoubts(rc);
          doubts.push(...minted.doubts);
          // — the note STAYS (it is the live operator's line) and it is no longer the only
          // record. `note` writes the run log, which is purged with the run dir, so on a delivered
          // run a ledger sitting at exactly the cap read as a complete one. The row below travels
          // to the audit, which is retained.
          if (minted.omitted) {
            doubtTruncations.push({ source: "record-carry", minted: minted.minted, omitted: minted.omitted });
            note(`record-carry: ${minted.omitted} further unreasoned drop(s) beyond the ${minted.minted} minted are in _driver/record-carry.json .unreasoned but NOT in the doubt ledger`);
          }
        }
      } catch { /* no band this run — a register-less matter mints nothing, exactly as before */ }
      // — the same, one path over. Read from the artifact for the same reason: two derivations
      // from different inputs is how the register half came to have a right doubt ledger and a wrong
      // artifact on the same run.
      for (const p of [P.commonLawCarry, P.jxZhCarry]) {
        try {
          const cc = safeReadJson(p);
          if (cc?.computable !== true) continue;
          const minted = mintCommonLawCarryDoubts(cc);
          doubts.push(...minted.doubts);
          //, one path over — and the SLICE is carried, because this mint runs per slice and a
          // reader told "12 omitted" twice with no slice cannot tell two truncations from one.
          if (minted.omitted) {
            doubtTruncations.push({ source: `commonlaw-carry (${cc.slice})`, minted: minted.minted, omitted: minted.omitted });
            note(`commonlaw-carry (${cc.slice}): ${minted.omitted} further unreasoned drop(s) beyond the ${minted.minted} minted are in ${basename(p)} .unreasoned but NOT in the doubt ledger`);
          }
        } catch { /* no common-law pass this run — a register-only matter mints nothing */ }
      }
      // — the remedy terms the reopen could not put on the record. Read back from the receipt
      // (unlike the placement carry, which re-derives against the delivered findings): this ledger is
      // a record of what the EXECUTOR did, and nothing after the reopen can retroactively make an
      // undispatched term dispatched, so the receipt is the authority and re-deriving would need band
      // blocks the audit seam has no reason to hold. A `searched-empty` term mints nothing — it is
      // answered — and nor does one the reading turn's recorded judgment settled (SETTLED_CLASSES). A run
      // with no reopen, or a legacy receipt with no term rows, mints nothing.
      try {
        const fr = JSON.parse(readFileSync(paths(run.runDir).frameReopenReceipt, "utf8"));
        if (Array.isArray(fr?.remedy_terms)) {
          doubts.push(...mintRemedyAccountingDoubts(
            { not_accounted: fr.remedy_terms.filter((r) => !SETTLED_CLASSES.includes(r?.class)) },
            { sourceName: "_driver/frame-reopen.json" },
          ));
        }
      } catch { /* no reopen this run, or an unreadable receipt — the reopen's own arms already disclosed */ }
      runDoubts = stitchDoubts(doubts, {
        findings: { findings: auditRunFindings ?? [], actions: auditRunActions },
        coverageRows, registerFindingsText,
      });

      // T2c — settle-by-citation (doubt-closure): ONE bounded sonnet/low pass over the doubts the
      // stitch left OPEN. Unconditional (kill switch deleted post-E2E 2026-07-22) — deliberately: it fires
      // only when opens exist, costs one cheap non-looping call, gates nothing, and offline evidence
      // (6 archived runs) says ~75% of stitch-open doubts had an on-disk answer the deterministic
      // join could not reach — while a genuinely unresolved doubt still ships OPEN, which is exactly
      // what OPEN should mean. The stage may only POINT: every SETTLED citation is re-verified
      // VERBATIM by code (applyClosure) against the three files it was allowed to cite; an
      // unverifiable quote leaves its doubt OPEN + a LOUD `doubt-closure-unverified` event. Stage
      // failure/timeout ⇒ doubts ship open exactly as without the stage (never a delivery gate).
      let closureStats = null;
      const openAfterStitch = runDoubts.filter((d) => d.status === "open");
      // PR-6: still-open ASK rows ride the SAME closure pass — one stage, two dictated line-forms.
      // The stage can never assert "executed" (that is computed from the plan-execution join); it
      // may only end an ask as IMMATERIAL by pointing at a verbatim on-disk quote, or leave it
      // OPEN with a one-line recovery recommendation the ledger records as the handoff.
      const openAsksForStage = (runAsks ?? []).filter((a) => !a.ending);
      if (openAfterStitch.length || openAsksForStage.length) {
        try {
          // — DRIVER SELECTION, on the PLACEMENT TIER both mints already hold. Inert today:
          // every product row still reads `every-doubt`, so `ids` is null and every open doubt is
          // dispatched exactly as before — byte-identical, not merely equivalent.
          //
          // The key is the tier and NOT the band of the finding the doubt is about, because that
          // second key cannot bind: stitchDoubts settles every finding-joining doubt before this
          // stage, so what arrives here has no finding and no band. That is asserted in
          // doubt-closure-grading-cannot-bind.test.mjs and measured at 0 of 420 open doubts on 28
          // delivered runs. The tier comes from the carry artifact instead, which the stitch cannot
          // have consumed — 199 of the same 420 carry one.
          const doubtSel = doubtsForClosure({
            doubts: openAfterStitch,
            doubtClosure: ctx.depth?.doubtClosure ?? null,
          });
          // RECORDED ON EVERY RUN, cut or no cut. The keyless count is what says whether this
          // selection is worth having: if most doubts carry no tier, the cut saves nothing and should
          // not be given a value. A count written only when the cut is live could never answer that —
          // it would need the cut to exist to measure whether the cut is worth existing.
          runLog(run.runDir, { event: "doubt-selection", of: doubtSel.total, selected: doubtSel.ids?.length ?? doubtSel.total,
            keyed: doubtSel.keyed, keyless: doubtSel.keyless, dropped: doubtSel.dropped,
            cut: ctx.depth?.doubtClosure ?? null, cutState: doubtSel.cutState });
          const noteLine = doubtSelectionNote(doubtSel);
          if (noteLine) note(`[pipeline] ${noteLine}`);
          const dispatchDoubts = doubtSel.ids
            ? openAfterStitch.filter((d) => doubtSel.ids.includes(d.id))
            : openAfterStitch;
          ctx.openDoubts = dispatchDoubts.map((d) => ({ id: d.id, birth: d.birth, subject: d.subject }));
          ctx.openAsks = openAsksForStage.map(openAskForClosure);
          // THE SPEC SIDECAR, WRITTEN BEFORE THE DISPATCH. The seat supplies none of its own context:
          // the ids it may speak about and the files it may cite are the driver's, so a doubt it was not
          // given is refused by name and a file it was not given cannot be expressed at all. Both
          // ledgers' ids ride ONE list because one call answers both — the row's `kind` says which.
          // CLOSURE_EVIDENCE_FILES is imported, never re-listed here: `file_index` is a POSITION, so a
          // second copy of this array drifting would verify every citation against the wrong file.
          // `bornIn` carries each DOUBT's birth artifact so the tool can refuse a circular citation
          // inside the seat's own turn (doubt-ledger.applyClosure refuses it again either way). Asks
          // are absent from the map on purpose: an ask is a question about a probe or directive, not
          // a claim lifted out of an artifact, so it has no source to be circular with.
          writeFileSync(paths(run.runDir).doubtClosureSpec, `${JSON.stringify({
            // The SAME set the dispatch carries. Listing openAfterStitch here while dispatching a
            // subset would tell the seat it may speak about ids it was never shown.
            openIds: [...dispatchDoubts.map((d) => d.id), ...openAsksForStage.map((a) => a.ask_id)],
            allowedFiles: CLOSURE_EVIDENCE_FILES,
            bornIn: Object.fromEntries(dispatchDoubts
              .filter((d) => d?.birth?.artifact)
              .map((d) => [d.id, d.birth.artifact])),
          }, null, 2)}\n`);
          const dc = await stage("doubt-closure", ctx);
          if (dc.ok) {
            // the citable set is CLOSED: exactly the three files the stage message named — a line
            // citing any other file simply never verifies (and is logged unverified, never followed).
            const fileTexts = {
              "findings.json": existsSync(P.findings) ? readFileSync(P.findings, "utf8") : "",
              "register-findings.md": registerFindingsText,
              "register-coverage-ledger.json": existsSync(P.registerCoverageLedger) ? readFileSync(P.registerCoverageLedger, "utf8") : "",
            };
            // APPLIED FROM THE RECORDED ROWS, not from a re-read of the artifact. The rows are what the
            // tool accepted — already checked against these same files at call time — so the parse that
            // used to sit here is gone, and with it the failure mode that made this conversion worth
            // doing: `parseClosureLines` was STRICT, and a line it could not match produced NOTHING and
            // left its doubt open, byte-identical to a doubt the seat looked at and honestly left open.
            // Nothing counted it and nothing could. The union is over every accepted file, so a batch
            // split across calls or a repair re-dispatch is one ledger, not the last call's slice.
            const acc = readAcceptedClosures(run.runDir);
            if (acc.unreadable) note(`doubt-closure: ${acc.unreadable} recorded call file(s) unreadable — their rows are NOT applied; the doubts they answered ship OPEN`);
            const applied = applyClosure(runDoubts, acc.doubt, fileTexts);
            runDoubts = applied.doubts;
            closureStats = { settledByStage: applied.settledByStage, unverified: applied.unverified.length };
            for (const u of applied.unverified) runLog(run.runDir, { event: "doubt-closure-unverified", ...u });
            if (runAsks) {
              const askApplied = applyAskClosure(runAsks, acc.ask, fileTexts, { ts: askTs });
              runAsks = askApplied.asks;
              for (const u of askApplied.unverified) runLog(run.runDir, { event: "ask-closure-unverified", ...u });
              // Option A: a recall ask whose mark is not in the delivered findings
              // did NOT close. Each one is a mark the run found and the client was not shown, so it is
              // recorded by name rather than left to be inferred from an ask that merely stayed open.
              // ✕ NOT written into findings.json here. See the sidecar's own note: a row appended after
              // the drafting stage would carry no band and no reasoning.
              for (const c of askApplied.carryIntoFindings ?? [])
                runLog(run.runDir, { event: "ask-closure-mark-owed", ...c });
              if (askApplied.carryIntoFindings?.length)
                writeFileSync(paths(run.runDir).marksOwedAFinding,
                  JSON.stringify({
                    _provenance: "recall asks that could not close because the mark they found is absent from findings.json — owner ruling 2026-09-07, Option A, worded about the MARK",
                    _notWritten: "these are NOT appended to findings.json: a finding carries a band, a net line and a legal position, and a row minted here would carry none of them. The repair belongs where the findings are authored.",
                    count: askApplied.carryIntoFindings.length,
                    marks: askApplied.carryIntoFindings,
                  }, null, 2) + "\n");
            }
          } else {
            note(`doubt-closure failed (non-fatal — the open doubts/asks ship OPEN, as without the stage): ${dc.fail}`);
          }
        } catch (e) {
          note(`doubt-closure errored (non-fatal — the open doubts/asks ship OPEN, as without the stage): ${e.message}`);
        }
      }

      const settled = runDoubts.filter((d) => d.status === "checked-and-settled").length;
      writeFileSync(paths(run.runDir).doubts,
        JSON.stringify({ minted: runDoubts.length, settled, open: runDoubts.length - settled,
          // — recorded here too so the live sidecar and the delivered audit cannot disagree
          // about whether the mint truncated. Omitted entirely when nothing was dropped.
          ...(doubtTruncations.length ? { truncated: doubtTruncations } : {}),
          ...(closureStats ?? {}), doubts: runDoubts }, null, 2));
      runLog(run.runDir, { event: "doubts", minted: runDoubts.length, settled, open: runDoubts.length - settled, ...(closureStats ?? {}) });
    } catch (e) {
      runDoubts = null;   // the audit builds ledger-less, exactly like a legacy caller
      runLog(run.runDir, { event: "doubts-failed", error: e.message });
    }

    // PR-6: persist the ask ledger (its own try — a doubts failure above must not cost the asks,
    // and vice versa; open rows just skipped closure and ship OPEN with their handoffs).
    if (runAsks) {
      try {
        runAsks = finalizeOpenHandoffs(runAsks);
        const askSummary = summarizeAsks(runAsks);
        writeFileSync(paths(run.runDir).asks,
          JSON.stringify({ ...askSummary, asks: runAsks }, null, 2) + "\n");
        runLog(run.runDir, { event: "asks", ...askSummary });
        note(`ask ledger: ${askSummary.total} ask(s) — ${askSummary.executed} executed, ${askSummary.immaterial} judged immaterial, ${askSummary.recovery} handed over, ${askSummary.open} OPEN`);
      } catch (e) {
        runAsks = null;
        runLog(run.runDir, { event: "asks-failed", error: e.message });
      }
    }

    // PR-8 — the reading audit: what judgment actually looked up (band-server appends every lookup to
    // _driver/reading-log.jsonl). Passed on any run that derived a band shape — an EMPTY array renders
    // the honest zero ("no lookups recorded"), because a band-consuming stage that read nothing is a
    // fact the audit must show, not hide. Legacy runs (no shape) pass null → no section, byte-identical.
    const readingLog = readReadingLog(P);
    // item 33 — hand the builder the machine grid so the common-law search log is derived from the
    // tool-written per-term cells rather than from a heading the tagger has to match. Absent (pre-grid
    // archive, register-only run) it falls back to the prose tables, which is honest: those runs have
    // no machine record. Read here rather than inside the builder to keep that module IO-free.
    let commonLawGrid = null;
    try { commonLawGrid = existsSync(P.commonLawGrid) ? readFileSync(P.commonLawGrid, "utf8") : null; } catch { /* no grid — prose path */ }
    // — the Register Presence store: every live, matter-in-scope enumerated record,
    // whatever its screen verdict, into the one artifact that survives the purge. Derived, not fatal:
    // a run with no band (register-less, legacy) legitimately builds its audit without the section, and
    // the run log says which happened rather than letting the absence read as a pass.
    let registerPresence = null;
    if (existsSync(P.registerNamedBand)) {
      try {
        let dominantElement = null;
        try { dominantElement = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8")).dominant_element; }
        catch { /* prose-only manifest — the store still derives, the dominant column reads null */ }
        let scopeClasses = [];
        try { scopeClasses = inScopeClassList(ctx.job, ctx.profile).map(String); }
        catch { scopeClasses = (ctx.job?.classes ?? []).map(String); }
        // The matter's territories: the resolved ladder when it answers (worldwide = NO restriction,
        // never a fallback), else the frame's own recorded scope — R14's shape: nothing instructed,
        // scope inferred by the frame — else no restriction (the inclusive direction for a store).
        const resolved = resolveTerritories(ctx.job, ctx.profile);
        let scopeTerritories = null;
        if (resolved.geographyMode !== "worldwide") {
          scopeTerritories = resolved.jurisdictions?.length ? resolved.jurisdictions
            : (lastAcceptedMatterFrame(run.runDir)?.scope_jurisdictions ?? null);
        }
        registerPresence = deriveRegisterPresence(JSON.parse(readFileSync(P.registerNamedBand, "utf8")),
          { dominantElement, scopeClasses, scopeTerritories });
        runLog(run.runDir, { event: "register-presence", rows: registerPresence.rows.length,
          territories: registerPresence.scope.territories, classes: registerPresence.scope.classes,
          dominantElement: registerPresence.dominant_element });
      } catch (e) {
        registerPresence = null;
        runLog(run.runDir, { event: "register-presence-failed", error: String(e?.message ?? e).slice(0, 200) });
      }
    } else {
      runLog(run.runDir, { event: "register-presence-skipped", reason: "no register-named-band.json" });
    }
    const a = buildAuditMd(registerFindingsText, commonLawText,
      { findings: auditRunFindings, doubts: runDoubts, asks: runAsks, readingLog, commonLawGrid, doubtTruncations, registerPresence,
        placementRows: placementAuditRows(P) });
    if (!a.counts.findings) throw new Error("0 findings parsed from the spine tables");  // count-guard
    writeFileSync(P.audit, a.md);
    auditWrittenThisPass = true;
    runLog(run.runDir, { event: "audit", ...a.counts });   // — counts now carry doubtsOmitted
    // The trace and the Audit Trail, written again over a repair (`rebuildDeliveredRecord`), from the inputs this
    // pass built them from; the doubts minted from the trace follow the trace written again.
    rebuildTheDeliveredRecord = (trigger) => rebuildDeliveredRecord(ctx,
      { commonLawText, doubts: runDoubts, asks: runAsks, commonLawGrid, doubtTruncations, registerPresence }, trigger);
    note(`audit (code): ${a.counts.findings} findings, ${a.counts.negatives} negatives, ${a.counts.audit} audit-trail${a.counts.withdrawnStamped ? `, ${a.counts.withdrawnStamped} withdrawn-stamped` : ""}${a.counts.resolutionStamped ? `, ${a.counts.resolutionStamped} resolution-stamped` : ""}${runDoubts ? `, doubts ${a.counts.doubtsSettled} settled / ${a.counts.doubtsOpen} open` : ""}${a.counts.presenceRows != null ? `, register presence ${a.counts.presenceRows} row(s)` : ""}`);
  } catch (e) {
    note(`audit build failed (NON-FATAL — report still ships, audit will regenerate on re-run): ${e.message}`);
    // A findings record with no finding row trips the count guard, and on a clean run it can: that is recorded apart,
    // as a note on the run's content, and only a build that broke is recorded as a failure.
    const noFindings = /^0 findings parsed from the spine tables/.test(String(e?.message ?? ""));
    runLog(run.runDir, { event: noFindings ? "audit-not-built-no-findings" : "audit-build-failed", reason: String(e?.message ?? e).slice(0, 160) });
    // An audit an earlier pass wrote describes that pass, not this one: the report ships without it, kept under _history.
    if (!auditWrittenThisPass) withdrawSupersededAudit(P, "audit-build-failed", { keep: !earlierPairKept });
  }
  return { applyRatedUnderFrontMatter, applyScopeFrontMatter, applyVerdictFrontMatter, assembledOrdinals, byRight, cardOrdinals, findingsForCards, groupedMembers, overviewOpen, rebuildTheDeliveredRecord, restoreTheBrokenRecord, rov, writeScopeFacts, writeUps };
}

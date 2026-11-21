// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// connotation-audit-run.mjs — the connotation audit a run records from its seats and the verdict ledger, the token that
// reopens the meaning channel, and a tainted axis's park: which axes are parked or disclosed, the judgment files a park
// renames, and putting them back.
//
// Moved out of pipeline.mjs unchanged, so that the steps import these instead of having them handed in.
import { bestDraftDir } from "./best-draft.mjs";
import { GRID_SEATS } from "./common-law-receipts.mjs";
import { CONNOTATION_FORM_TOKEN_SRC, CONNOTATION_UNRULED_REASONS, connotationAuditCounts, connotationReasonKey, DECLINED_RULING, findConnotationViolations, parseDispositionForm, parsePrRiskResults } from "./connotation-search.mjs";
import { coverageFormPaths, coverageFormStamp } from "./coverage-form-io.mjs";
import { detectRulingDrift, foldCallVerdicts, ledgerReasonHistogram, ledgerRows, ledgerUnattributed, partitionUnruledByLedger } from "./disposition-call.mjs";
import { callRecordPaths, callVerdictLedgerExists, readCallVerdicts } from "./disposition-tool.mjs";
import { formSidecarPath } from "./disposition-union.mjs";
import { classifyGroundsNote } from "./grounds-grammar.mjs";
import { note, runLog } from "./log.mjs";
import { paths } from "./stages.mjs";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * The connotation token a merge failure carries, or null. Reads BOTH the message and the `detail`.
 *
 * — THIS USED TO BE AN INLINE `e.message` MATCH, AND THAT MADE THE MERGE'S REMEDY CHANNEL DEAD.
 * `StageFailure` builds its message as `${stage}: ${reason}`, and moved the open-set payload out of
 * `reason` into `detail` so a renderer could show the sentence and hide the payload. From that split on,
 * the message read "common-law: merged half-grids failed the canonical validator" and carried no token,
 * so the remedy's `if (!tok) throw e` fired on EVERY merge-validator failure and a bounded, dictated
 * one-round repair — built for exactly this, widened by to cover `quote_unbound` — never ran once.
 * A converted field takes its guards quiet rather than red, and a recovery path is a reader too.
 *
 * Message FIRST and still read: an archived or re-thrown failure carrying the token inline must keep
 * opening the channel. Exported because a guard that can only be asserted by reading source is a guard
 * whose behaviour was never tested. PURE; never throws.
 */
export function connotationRemedyToken(err) {   // @internal
  const re = new RegExp(`${CONNOTATION_FORM_TOKEN_SRC}[^)]*`);
  for (const text of [err?.message, err?.detail]) {
    const m = String(text ?? "").match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Which still-tainted axes are disclosed and which are parked. Every axis once synthesis is done (the audit spine is
 * locked); an axis the searches record lists, whose recovery is spent; and the rest parked, to be run again. PURE.
 */
export function taintDisposition(stillTainted, { digestLocked = false, disclosedAxes = new Set() } = {}) {   // @internal
  const disclose = (stillTainted ?? []).filter((a) => digestLocked || disclosedAxes.has(a));
  return { disclose, park: (stillTainted ?? []).filter((a) => !disclose.includes(a)) };
}

/**
 * Put back what a taint park renamed, so the band and the digest are read as the last pass left them. A renamed copy
 * whose original has since been written again stays where it is. Returns the paths put back. IMPURE.
 */
export function undoTaintRenames(renames) {   // @internal
  const back = [];
  for (const r of Array.isArray(renames) ? renames : []) {
    try { if (r?.to && r?.from && existsSync(r.to) && !existsSync(r.from)) { renameSync(r.to, r.from); back.push(r.from); } }
    catch { /* best-effort: what stays renamed is re-run on the resume, as before */ }
  }
  return back;
}

/**
 * EVERY ARTIFACT THAT CARRIES A JUDGMENT DERIVED FROM THE TAINTED BANDS, renamed by the taint park.
 *
 * Named and exported because the park has no test harness that can drive it, and the one thing that goes
 * wrong here is an artifact being FORGOTTEN — which fails silently, as a resumed digest that skips the
 * re-ruling the park exists to force. A list nobody can assert on is a list that drifts.
 *
 * The park's own rule: "a digest already derived from tainted material is renamed too, else its skip
 * would ship stale rows." Four artifacts satisfy that description:
 *   · register-findings.md          — the digest itself
 *   · register-coverage-ledger.json — its derived machine mirror
 *   · the coverage form's SEAT copy — LEGACY: nothing writes it since the typed-transport conversion
 *     (statuses ride record_coverage), but a pre-conversion run being resumed can still carry one, and
 *     renaming it if present keeps a resumed pre-conversion seat from handing back the pre-park file
 *   · the coverage form's `_driver/` copy — THE ACCUMULATOR, and the one  left behind. It holds the
 *     statuses the seat settled OVER THE TAINTED BANDS, and `formRowKey` is `block:<qid>` — a qid does
 *     not change when its slice is re-run. So a block re-run to a different hit count keeps its stale
 *     `confirmed-clean` and its stale reason, unionCoverageForm carries both into the resumed digest,
 *     findCoverageFormViolations finds nothing to refuse, and the run delivers a re-ruling that never
 *     happened.
 *
 * The form name comes from the ERA STAMP, not the default, so a run whose `form_path` differed does not
 * leak. RENAMED, never deleted — forensics, like everything else in that branch. The stamp itself STAYS:
 * runDigest re-arms and re-writes the form before the next dispatch, and in the window between, a stamp
 * with no form is `coverage_form_missing` — the fail-closed direction.
 */
export function taintParkJudgmentArtifacts(P, runDir) {   // @internal
  const form = coverageFormPaths(runDir, coverageFormStamp(runDir).formName);
  return [P.registerFindings, P.registerCoverageLedger, form.seat, form.sidecar];
}

// item 15a — the UPSTREAM repair arms. One entry per stage label that can turn up stale on the delivery
// path and is not a delivery-tail surface. Each re-runs exactly the stage the pipeline would have run,
// forced, under a `stale-repair` trigger.
//
// A MAP rather than a chain of ifs, and it is the honest scope statement: a label with no entry here is
// one this pass will NOT repair, so it stays stale and the delivery guard blocks — the pre-15a behaviour,
// for exactly the labels we have not costed. Adding a stage to the delivery path without adding it here
// silently reverts that stage to the park path, so the two belong side by side.
//
// A LABEL WITH NO ENTRY HERE IS ONE THIS PASS WILL NOT REPAIR: it stays stale and the delivery guard
// blocks, which is the pre-15a behaviour, kept for exactly the labels we have not costed.
//
// register-digest routes through runDigest, never a bare stage(): a bare call leaves the old machine
// ledger outvoting the rewritten prose (the WS-A finding), which would make the "repair" produce a run
// whose JSON and prose disagree.

// ── — the meaning-receipts audit, and it MUST survive a terminal run ───────────────────────────
// The gate now distinguishes a receipt the model never addressed (blocking) from one it addressed in a
// form that did not bind (advisory). An advisory is not a silent pass: it is a defect recorded against
// that receipt, and this is where it becomes readable off the run rather than inferable from a token
// that no longer names it.
//
// WHY IT ALSO FIRES ON THE FAILURE PATH. The two numbers this writes are the ones the sequencing
// ruling says the boundary gets tuned against — obligations carrying a written disposition that failed
// to bind, against obligations the model never addressed. Recorded only where the gate PASSED, they
// would be missing from exactly the runs that need explaining: a run that still goes terminal at
// `common-law-half:b` never reaches the merge seam, and the failure token deliberately carries only the
// blocking count. So this is called from both seams, and it reads whatever is on disk.
//
// WHICH ARTIFACTS. The merged pair when the merge happened; otherwise each half's own pair, because a
// terminal half is exactly the case worth measuring. A half whose last attempt was REJECTED leaves no
// document at its canonical path — the surviving copy is the preserved best draft — so that is read
// too, and `source` says which, since a best draft is the model's last work and not necessarily its
// final one. Best-effort throughout: an audit that cannot be written must never cost a run.
export function connotationAuditSeats(P, runDir) {   // @internal
  const seats = [];
  // B — the audit reads the ACCUMULATORS in `_driver/` (formSidecarPath), the same copies the gate
  // judges. The seat-facing mirrors this used to read died with the form path; reading a path nothing
  // writes would report every ruling as never made.
  // — `dispositions` IS CARRIED, not re-derived. The verdict ledger lives beside the accumulator
  // and `callRecordPaths` is the ONE function that knows where; handing it the accumulator path instead
  // would make this the second place that knows the layout, which is the drift `formSidecarPath`'s own
  // header was written about.
  if (existsSync(P.commonLaw) && existsSync(P.commonLawGrid))
    seats.push({ seat: "merged", source: "artifact", doc: P.commonLaw, grid: P.commonLawGrid,
      form: formSidecarPath(P.commonLawDispositions), dispositions: P.commonLawDispositions });
  else for (const h of GRID_SEATS) {
    const grid = P.commonLawGridHalf(h);
    if (!existsSync(grid)) continue;
    const canonical = P.commonLawHalf(h);
    const dispositions = P.commonLawDispositionsHalf(h);
    const form = formSidecarPath(dispositions);
    if (existsSync(canonical)) { seats.push({ seat: `half-${h}`, source: "artifact", doc: canonical, grid, form, dispositions }); continue; }
    const draft = join(bestDraftDir(runDir, `common-law-half:${h}`), basename(canonical));
    if (existsSync(draft)) seats.push({ seat: `half-${h}`, source: "best-draft", doc: draft, grid, form, dispositions });
  }
  return seats;
}

// EXPORTED FOR THE SAME REASON `connotationAuditSeats` IS: the seat resolution was testable and the
// numbers it produces were not, so the whole point — that the audit READS the verdict ledger — was
// asserted only in the pure functions it calls. A wiring that never runs in a test is a wiring nobody has
// seen work.
export function recordConnotationAudit(run, P) {   // @internal
  try {
    const seats = [];
    let didNotBind = 0, neverAddressed = 0, quotesUnbound = 0, recordedQueries = 0;
    // — the three numbers that make "never addressed" falsifiable. `unruledAll` is the TOTAL this
    // audit used to report under `obligationsNeverAddressed`, kept as its own field so the split can
    // never take a headline number to zero without a companion rising to meet it (the hazard, in the
    // very number is about).
    let unruledAll = 0, addressedNotDischarged = 0, ledgerCalls = 0, ledgerSeats = 0;
    const refusalReasons = {};              // — the LEDGER's reasons: every refusal and drop recorded
    const unruledRefusalReasons = {};       // — the reasons met by rows still UNRULED (the old map)
    const addressedRows = [];
    const callRows = [];                    // — every row the ledger touched, not only the unruled
    // — the refusals that named no row, so the two totals above reconcile on the page.
    const unattributedRefusals = { refused: 0, dropped: 0, reasons: {} };
    const rulingDrift = [];
    const reasonKeys = new Set();
    const queryTexts = new Set();   // — the executed query strings, deduped, beside the count of them
    const formDefects = [];
    // ── — DOES A CHARGED RATING CARRY ITS GROUNDS? RECORDED, NOT ENFORCED ───────────────────────
    //
    // Doctrine already asks for this in as many words: "rule `loaded` and use the note to state plainly
    // what you could not establish and what a human should look at" (clearance-common-law/SKILL.md). The
    // seat does not do it — e2e READ all 24 `loaded` notes in the corpus (not keyword-probed them) and
    // every one describes the material instead. `grounds-grammar.mjs` was built to measure exactly that,
    // proven against those real notes and against a planted violation, AND CALLED BY NOTHING. A check
    // nothing invokes is not a check, so this is the invocation.
    //
    // WHY IT RECORDS INSTEAD OF REFUSING, and this is a sequencing decision rather than a soft one. The
    // module's own header states the limit: its `grounds` arm has no real example to validate against,
    // "because the corpus contains no example of a note that states what could not be established". A
    // refusal built on an unvalidated positive arm would refuse the first seat that complies — and a row
    // refused forever is the live-lock, bought back at the price of the thing being fixed. So the
    // verdict lands in the artifact a reviewer already opens, the next real round supplies the positive
    // examples the arm lacks, and refusing becomes a decision with evidence under it.
    //
    // DEDUPED BY ROW. Every meaning row appears in the merged form AND in half-m's, so a raw count
    // double-reports — the same shape as the ledger fold below, and e2e's own corpus measurement
    // had to dedupe for the same reason.
    const groundsSeen = new Map();   // row id -> {verdict, why}
    // — `declined`, not `loaded`. The key names the population: rows where the seat said it could
    // not establish the reading. It counted every charged row until the ruling split, and a confident
    // `loaded` note DESCRIBES its material correctly — so the old number graded the right answer against
    // the wrong contract and read as a failure. Renamed rather than re-pointed silently: the field is in
    // an artifact a reviewer opens, and a key that keeps its name while changing its population is the
    // one shape nobody detects.
    const chargedNotes = { declined: 0, grounds: 0, description: 0, unclear: 0 };
    // ── — THE LEDGER IS FOLDED ONCE PER LEDGER, NOT ONCE PER SEAT ──────────────────────────────
    //
    // Every half resolves its verdict ledger through `callRecordPaths`, and that lands on ONE shared
    // `_driver/disposition-calls/` for the whole run — the halves' accumulators share a `_driver/`, so
    // `dirname(formSidecarPath(...))` is the same for all three. This loop then folded that one file
    // once per seat and summed the results into run-level maps: on a three-half run the histogram came
    // out at exactly 3x the ledger it claimed to count (283 events read as 849; `callRows` carried 300
    // entries for 100 distinct rows, each three times).
    //
    // IT HIDES ON A SINGLE-HALF RUN, where the multiplier is one and everything reconciles perfectly.
    // That is why the guard for this is a THREE-half fixture: an n=1 population cannot exercise a
    // per-seat multiplication at all.
    //
    // KEYED ON THE RESOLVED LEDGER PATH, not on the seat and not on a flag. If `callRecordPaths` ever
    // becomes seat-scoped, distinct seats produce distinct paths and this stops deduping on its own,
    // which is the behaviour you want from a guard against a layout it does not own.
    const auditSeats = connotationAuditSeats(P, run.runDir);
    const ledgerPathOf = (st) => (st.dispositions ? callRecordPaths(st.dispositions, 0).verdicts : null);
    const ledgerOwners = new Map();          // resolved verdicts path -> the seats that resolve to it
    for (const st of auditSeats) {
      const lp = ledgerPathOf(st);
      if (!lp) continue;
      if (!ledgerOwners.has(lp)) ledgerOwners.set(lp, []);
      ledgerOwners.get(lp).push(st.seat);
    }
    const foldedLedgers = new Map();         // resolved verdicts path -> the fold, computed exactly once
    for (const st of auditSeats) {
      const lp = ledgerPathOf(st);
      if (lp && !foldedLedgers.has(lp)) foldedLedgers.set(lp, foldCallVerdicts(readCallVerdicts(st.dispositions)));
    }
    // WHO A LEDGER-DERIVED ROW BELONGS TO. The ledger carries no seat — its records are {at, seq,
    // accepted, refused, dropped, overflow} and `ledgerRows` keys on row id — so stamping one seat onto
    // rows drawn from a ledger THREE seats share is attribution the file cannot support. It stays the
    // seat's name when exactly one seat owns that ledger (the merged-run case, which is most of them)
    // and becomes "shared" when several do, which is the only true answer available.
    const ledgerSeatLabel = (lp) => {
      const owners = ledgerOwners.get(lp) ?? [];
      return owners.length === 1 ? owners[0] : "shared";
    };
    const foldedIntoRunTotals = new Set();
    for (const st of auditSeats) {
      const rec = parsePrRiskResults(readFileSync(st.grid, "utf8"));
      // — THE AUDIT READS THE FORM THE GATE READS. It used to call the gate WITHOUT the seat's
      // rulings, so it re-read structurally-discharged obligations as violations and its two headline
      // numbers over-reported on every run that used the structured path. Now it is handed the same form,
      // and its numbers are the gate's numbers.
      const fp = st.form && existsSync(st.form) ? parseDispositionForm(readFileSync(st.form, "utf8")) : { rows: null, error: null };
      const conn = findConnotationViolations(readFileSync(st.doc, "utf8"), rec.length,
        { recorded: rec, form: fp.rows, formError: fp.error });
      // — the DECLINATION rows this seat ruled, classified once per row across every form that
      // carries it. A row whose id is blank is skipped rather than merged into one bucket: two unnameable
      // rows are not the same row, and collapsing them would under-count the population being measured.
      //
      // ONLY DECLINATIONS. The grounds grammar asks "does this note state what could not be established"
      // — which is the note contract for a declination and NOT the one for a confident charged ruling,
      // whose note is supposed to say what the material is. Run over both, it graded compliant notes as
      // `description` and the number meant nothing. The grammar is UNCHANGED; only its population is.
      for (const r of (Array.isArray(fp.rows) ? fp.rows : [])) {
        if (String(r?.ruling ?? "").trim().toLowerCase() !== DECLINED_RULING) continue;
        const id = String(r?.row_id ?? "").trim();
        if (!id || groundsSeen.has(id)) continue;
        groundsSeen.set(id, classifyGroundsNote(r?.note));
      }
      // The two states the sequencing ruling asks to be counted apart, in the form's vocabulary: a row
      // the seat WROTE that the gate cannot accept (a damaged form — the disposition exists and is
      // readable) against a row it never filled in at all.
      const damaged = conn.filter((v) => v.reason === "form_damaged");
      // — THE AUDIT'S HEADLINE NUMBER FOLLOWS THE SPLIT, OR IT SILENTLY GOES TO ZERO. `no_ruling`
      // used to be every unruled row; it is now the residual of four states. Filtering on the bare
      // reason after the split would report `obligationsNeverAddressed: 0` on the exact run that died
      // owing 75 — an absence read as a pass, on the number the round after this one will read.
      // `form_untouched` is ONE violation carrying the population in `count`, so it contributes its
      // count and not its length.
      const unruled = conn.filter((v) => CONNOTATION_UNRULED_REASONS.includes(v.reason));
      const counts = connotationAuditCounts(conn);
      const unruledTotal = counts.neverAddressed;
      // — THE THIRD STATE, OR IT IS COUNTED NOWHERE. A row that is ruled and whose quote does not
      // join is neither `form_damaged` nor `no_ruling`, so with two buckets it falls out of both and the
      // audit reports a run that owed nothing over a run that died owing something. R6's own evidence
      // number lives here: `obligationsNeverAddressed: 1` was that run's record of the row that killed it,
      // and under the split it is `quotesThatDidNotBind` instead. Additive — every existing reader of the
      // two fields above is unchanged, and the new field is the one the next round has to be told about.
      const unbound = conn.filter((v) => v.reason === "quote_unbound");
      // — WHAT THE SEAT ACTUALLY DID, from the per-call verdict ledger. Until this existed the
      // audit could only see the FORM, so a row refused 85 times with a correct reason each time was
      // indistinguishable from a row nobody ever answered — and it reported the second. The refusals
      // lived inside the seat's turn and nowhere else.
      //
      // READ, NEVER JUDGED. This does not decide whether a ruling is good; it decides whether the row was
      // ADDRESSED, which is a different question and the one that was unanswerable.
      // PRESENT and EMPTY are asked separately. The fold of an empty read is a perfectly good object, so
      // keying presence on it reported a ledger for every run that had never written one — an absence
      // reading as a presence, in the change built to stop exactly that.
      const ledgerPresent = Boolean(st.dispositions) && callVerdictLedgerExists(st.dispositions);
      const ledgerPath = ledgerPathOf(st);
      const ledger = ledgerPath ? foldedLedgers.get(ledgerPath) ?? null : null;
      // — the run-level maps below take each ledger ONCE. `split`, `unruled` and the per-seat
      // entry keep reading it per seat, because those JOIN it against the seat's own form and are
      // correctly seat-scoped; it is only the run-level accumulation that was multiplying.
      const foldIntoRunTotals = Boolean(ledgerPath) && !foldedIntoRunTotals.has(ledgerPath);
      if (foldIntoRunTotals) foldedIntoRunTotals.add(ledgerPath);
      const split = partitionUnruledByLedger({ unruledTotal, unruledRows: unruled.map((v) => v.row), ledger });
      recordedQueries += rec.length;
      // — NAME WHAT WAS COUNTED. This loop already walks every executed query string and keeps only
      // a reason key, so the artifact a reviewer opens to certify reported `recordedQueries: 61` and
      // no queries. The strings were never lost — they are in `_driver/grid-spec.json` (dictated) and in
      // `common-law-grid*.json` `extras.pr_risk[].query` (executed) on every run — but certifying a
      // sanitizer defect from the receipts file meant joining two other files first, and a reviewer who
      // does not know that reads the count as all there is. Additive: `recordedQueries` keeps its exact
      // meaning and `queries.length === recordedQueries` is the invariant.
      for (const e of rec) { reasonKeys.add(connotationReasonKey(e.query)); queryTexts.add(e.query); }
      didNotBind += counts.didNotBind;
      neverAddressed += split.neverAddressed;
      unruledAll += unruledTotal;
      addressedNotDischarged += split.addressed;
      if (foldIntoRunTotals) ledgerCalls += ledger?.calls ?? 0;   // — once per ledger, not once per seat
      if (ledgerPresent) ledgerSeats += 1;
      for (const r of split.rows) {
        addressedRows.push({ seat: st.seat, row: r.row_id, calls: r.calls, refused: r.refused,
          dropped: r.dropped, reasons: r.reasons, populationUnnamed: split.populationUnnamed });
        for (const [reason, n] of Object.entries(r.reasons)) unruledRefusalReasons[reason] = (unruledRefusalReasons[reason] ?? 0) + n;
      }
      // — TWO POPULATIONS, TWO NAMES. The map above is unchanged in every respect except what it is
      // called: it counts the reasons met by rows that are STILL UNRULED, which is the evidence for
      // `obligationsAddressedNotDischarged`, and it is correctly EMPTY when nothing is outstanding.
      // `refusalReasons` now means what its name says — every refusal and drop the ledger recorded.
      //
      // The rename is the fix, not a tidy-up. On R5 round 7a30934b the artifact carried
      // `refusalReasons: {}` beside a ledger of 193 refusals over 8 types, because everything had been
      // discharged by the end. Nothing was wrong with the number; the name promised the other population,
      // so an empty map read as "nothing was refused" and took the acceptance criterion C with it.
      if (foldIntoRunTotals) for (const [reason, n] of Object.entries(ledgerReasonHistogram(ledger)))
        refusalReasons[reason] = (refusalReasons[reason] ?? 0) + n;
      // — the part of that histogram that belongs to no row, kept separately so `refusalReasons`
      // and `callRows` can be reconciled by a reader instead of taken on trust.
      if (foldIntoRunTotals) {
        const un = ledgerUnattributed(ledger);
        unattributedRefusals.refused += un.refused;
        unattributedRefusals.dropped += un.dropped;
        for (const [reason, n] of Object.entries(un.reasons))
          unattributedRefusals.reasons[reason] = (unattributedRefusals.reasons[reason] ?? 0) + n;
      }
      // The per-row view of the same ledger. `addressedRows` stays scoped to the unruled∩ledger
      // intersection because that is what the note below describes — widening it would make that sentence
      // call discharged rows undischarged.
      if (foldIntoRunTotals) for (const r of ledgerRows(ledger)) callRows.push({ seat: ledgerSeatLabel(ledgerPath), ...r });
      // THE DRIFT DETECTOR RUNS OVER EVERY ROW IN THE LEDGER, not only the unruled ones. R5's drifted rows
      // were DISCHARGED by the time the run finished — a detector scoped to what is still outstanding
      // would have reported nothing on the run that produced the evidence.
      if (foldIntoRunTotals) for (const d of detectRulingDrift(ledger)) rulingDrift.push({ seat: ledgerSeatLabel(ledgerPath), ...d });
      quotesUnbound += counts.quotesUnbound;
      for (const v of damaged)
        formDefects.push({ seat: st.seat, row: v.row, result: v.result, namedQuery: v.query, detail: v.detail });
      // A quote that did not bind is a NAMED defect with a state, so it is recorded beside the form
      // defects rather than as a bare count — the state is what distinguishes "requote continuously" from
      // "you quoted something that is not there", and a reader of the archive cannot re-derive it.
      for (const v of unbound)
        formDefects.push({ seat: st.seat, row: v.row, result: v.result, namedQuery: v.query,
          detail: v.detail, quoteState: v.quote_state });
      seats.push({ seat: st.seat, source: st.source, recordedQueries: rec.length,
        // — per seat, in execution order, so a half that dropped a dictated query is readable
        // against its sibling without opening the grids.
        queries: rec.map((e) => e.query),
        dispositionsThatDidNotBind: counts.didNotBind, obligationsNeverAddressed: split.neverAddressed,
        quotesThatDidNotBind: counts.quotesUnbound,
        // — per seat, because a run with two halves can have one seat looping and one silent, and
        // one summed pair of numbers cannot tell those apart.
        obligationsUnruled: unruledTotal, obligationsAddressedNotDischarged: split.addressed,
        ledgerPresent, ledgerCalls: ledger?.calls ?? 0 });
    }
    if (!seats.length) return;                     // no pair on disk yet — an absence, and nothing to claim
    // — one row, one verdict, whichever forms carried it.
    for (const v of groundsSeen.values()) {
      chargedNotes.declined += 1;
      if (Object.hasOwn(chargedNotes, v.verdict)) chargedNotes[v.verdict] += 1;
    }
    const audit = {
      ts: new Date().toISOString(), recordedQueries,
      // — the run's distinct executed query strings. `recordedQueries` is the count and stays the
      // count; this is what it counted. Written unconditionally, so an empty sweep records [] rather
      // than omitting the key — absent and "ran and issued nothing" are different facts.
      queries: [...queryTexts],
      // — the second scale, recorded and gating nothing. See connotationReasonKey.
      distinctReasons: reasonKeys.size,
      dispositionsThatDidNotBind: didNotBind,
      obligationsNeverAddressed: neverAddressed,
      quotesThatDidNotBind: quotesUnbound,   //
      // ── — "NEVER ADDRESSED" IS NOW A CLAIM THAT CAN BE WRONG, AND SAY SO ────────────────────
      //
      // R5's park reported `obligationsNeverAddressed: 2` over two rows the seat had addressed 163 times
      // with a correct reason returned every time. The three buckets built to explain a non-accepted
      // disposition all read zero, truthfully — a refused row never reaches the form, so there was
      // nothing for them to count. The only field left standing described the one thing that had not
      // happened, and it sent the reader hunting the seat.
      //
      // `obligationsNeverAddressed` now means what it says: unruled AND absent from the verdict ledger.
      // `obligationsUnruled` carries the total it used to carry, so the two parts sum to it and neither
      // can drift to zero unnoticed. WITH NO LEDGER THE SPLIT IS INERT — `addressedNotDischarged` is 0
      // and `neverAddressed` equals the total, which is bit-for-bit the old number. Archived runs and
      // form-path runs keep their history; only a run that HAS the evidence gets the finer answer.
      obligationsUnruled: unruledAll,
      obligationsAddressedNotDischarged: addressedNotDischarged,
      // The histogram is the part that distinguishes a loop from a miss. `{anchor_unbound: 162}` on two
      // rows is an unsatisfiable instruction; `{anchor_unbound: 1}` is a seat that mistyped once.
      // — folded from the LEDGER. See ledgerReasonHistogram for the run that proved the difference.
      refusalReasons,
      // The population this field used to carry under the name above: reasons met by rows STILL UNRULED.
      // Empty is the RIGHT answer here whenever nothing is outstanding, and now it says so by its name.
      unruledRefusalReasons,
      // ITS OWN CARDINALITY, NAMED. The issue that found the empty histogram read
      // `distinctReasons: 14` as its count and concluded the map had been dropped after being counted.
      // It had not: `distinctReasons` is the SECOND SCALE — distinct executed query SHAPES, from
      // `connotationReasonKey` over the grid — and has nothing to do with refusal tokens. Two unrelated
      // numbers, one of them named `…Reasons`, one screenful apart. Naming both is the fix for that
      // reading; asserting they agree, which the issue asked for, would assert something false.
      distinctRefusalReasons: Object.keys(refusalReasons).length,
      addressedRows,
      // — the ledger's own per-row view. `addressedRows` above answers "which OUTSTANDING obligation
      // was addressed"; this answers "what did the seat call, and how did it end". On a run that
      // discharged everything the first is legitimately empty and the second is not, and having only the
      // first is what made a correct emptiness unreadable beside a wrong one.
      callRows,
      // ── — WHERE `refusalReasons` AND `callRows` DIFFER, AND WHY ─────────────────────────────
      //
      // `refusalReasons` totals the LEDGER; `callRows` totals the rows. They differ by exactly the
      // refusals the ledger recorded against no row — the seat addressed an obligation that does not
      // exist, so there is no row to hang the refusal on and inventing one would be worse than the gap.
      //
      // Written unconditionally, zeros and all. `{refused: 0, dropped: 0, reasons: {}}` says the two
      // totals agree; an absent key would say nothing, and this issue exists because a reader met two
      // numbers that disagreed by one with nothing on the page to explain it.
      unattributedRefusals,
      // ── — THE CHARGED RATINGS, AND WHETHER THEY SAID WHY ────────────────────────────────────
      //
      // `loaded` is the count of charged rulings; the other three partition it by whether the note met
      // the instruction. `unclear` is NOT a pass — a note that is neither recognisably grounds nor
      // recognisably a description is a finding, because a two-way classifier would have to guess and
      // guessing on prose is the instrument e2e warned about.
      //
      // Written on every run, zeros and all. `{loaded: 0, …}` says this run produced no charged rating,
      // which is a different fact from a run where nobody looked — and exists because one round's
      // zero was generalised to the corpus and the generalisation was false.
      chargedNotes,
      // ── THE GRAVEST FIND OF THE ROUND, AND IT IS NOT ABOUT COST ───────────────────────────────────
      //
      // A DETECTOR over rows whose legal conclusion moved across calls. R5 moved `benign` → `loaded` /
      // `off-topic` over 85 calls and back to `benign` on the resume, one seat, no regeneration boundary.
      // Had one of those 85 been accepted, the contradiction would have banked against 41 prior `benign`
      // calls and the audit would have been clean. Nothing normalises or resolves it — a seat is allowed
      // to correct itself, and choosing between two legal conclusions is not code's to do.
      rulingDrift,
      // An absence is a finding: no ledger and an empty ledger are different facts, and a reader of an
      // archived run must be able to tell "nothing was refused" from "we were not recording yet".
      ledger: { seatsWithLedger: ledgerSeats, seats: seats.length, calls: ledgerCalls },
      seats, formDefects,
      // — THIS FILE IS FINAL-STATE-ONLY BY CONSTRUCTION, and its field names are past tense.
      // It is re-derived from whatever pair is on disk and written as a whole-file overwrite, so nothing
      // accumulates across attempts. On a delivered run (2026-08-15) attempt 2 returned `quote_unbound=3`,
      // the repair landed, and the final write recorded `quotesThatDidNotBind: 0` — correct for that
      // instant, and a reader takes `quotesThatDidNotBind` as a fact about the RUN.
      //
      // `peak` carries the worst value this run ever recorded, folded from the file already on disk. A
      // run that converged 3 → 0 and a run that never had a defect are different facts and only one of
      // them was expressible. Fold, never reset: a lower current value must not erase the history, which
      // is the whole failure being fixed. Unreadable prior ⇒ this pass's own numbers, never zero.
      peak: (() => {
        let prior = {};
        try { prior = JSON.parse(readFileSync(paths(run.runDir).connotationReceipts, "utf8"))?.peak ?? {}; } catch { /* first pass, or unreadable — this pass IS the peak */ }
        const worst = (k, now) => Math.max(Number(prior?.[k]) || 0, Number(now) || 0);
        return { dispositionsThatDidNotBind: worst("dispositionsThatDidNotBind", didNotBind),
          obligationsNeverAddressed: worst("obligationsNeverAddressed", neverAddressed),
          quotesThatDidNotBind: worst("quotesThatDidNotBind", quotesUnbound),
          formDefects: worst("formDefects", formDefects.length),
          // — THE LOOP IS THE THING THAT MUST NOT CONVERGE AWAY. R5's two rows were discharged
          // after the park, so a final-state-only file would record the run as clean and lose the 163
          // calls entirely. That is the same erasure fixed for `quotesThatDidNotBind`, arriving
          // through the field that describes effort rather than outcome.
          obligationsUnruled: worst("obligationsUnruled", unruledAll),
          obligationsAddressedNotDischarged: worst("obligationsAddressedNotDischarged", addressedNotDischarged),
          ledgerCalls: worst("ledgerCalls", ledgerCalls) };
      })(),
    };
    const tmp = paths(run.runDir).connotationReceiptsJson;
    writeFileSync(tmp, JSON.stringify(audit, null, 2) + "\n");
    renameSync(tmp, paths(run.runDir).connotationReceipts);
    runLog(run.runDir, { event: "connotation-receipts", recordedQueries, distinctReasons: reasonKeys.size,
      dispositionsThatDidNotBind: didNotBind, obligationsNeverAddressed: neverAddressed,
      seats: seats.map((x) => `${x.seat}:${x.source}`) });
    if (didNotBind)
      note(`[connotation] ${didNotBind} form row(s) name a receipt that is not one of their own candidates: ${formDefects.map((v) => v.row).slice(0, 3).join(", ")}`);
    // — SAID OUT LOUD, because the whole defect was a number nobody could question. A row addressed
    // 85 times and still owed is a loop; the reason histogram is what says whether the instruction was
    // satisfiable. This is the line that was missing from R5's park.
    if (addressedNotDischarged) {
      const worst = addressedRows.reduce((a, b) => ((b.calls ?? 0) > (a?.calls ?? 0) ? b : a), null);
      note(`[connotation] ${addressedNotDischarged} obligation(s) were ADDRESSED and not discharged — not "never addressed": ${
        addressedRows.map((r) => `${r.row}×${r.calls}`).slice(0, 3).join(", ")}${
        worst ? ` — worst: ${worst.row} over ${worst.calls} call(s), ${Object.entries(worst.reasons).map(([k, n]) => `${n}× ${k}`).join(", ")}` : ""}`);
      // — `reasons` keeps its exact old value: this event is ABOUT the undischarged rows, so the
      // scoped map is the right one and swapping in the ledger-wide one would silently change what a
      // journal line has meant since. The ledger-wide map rides beside it, named.
      runLog(run.runDir, { event: "connotation-addressed-not-discharged", n: addressedNotDischarged,
        unruledTotal: unruledAll, neverAddressed, reasons: unruledRefusalReasons,
        ledgerReasons: refusalReasons, ledgerCalls });
    }
    if (rulingDrift.length) {
      note(`[connotation] ⚠️ ${rulingDrift.length} row(s) MOVED their ruling across calls — a later attempt asserted a different legal conclusion than an earlier one on the same row: ${
        rulingDrift.map((d) => `${d.row_id} ${d.rulingSeq.join("→")}`).slice(0, 3).join("; ")}`);
      runLog(run.runDir, { event: "connotation-ruling-drift", n: rulingDrift.length,
        rows: rulingDrift.map((d) => ({ row: d.row_id, seq: d.rulingSeq, calls: d.calls, accepted: d.accepted })) });
    }
  } catch (e) {
    try { runLog(run.runDir, { event: "connotation-receipts-failed", error: e.message }); } catch { /* nothing left to record with */ }
  }
}

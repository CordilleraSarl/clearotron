// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// record-carry-trace.mjs — the record trace from retrieval to the findings: what placement, the register digest and the
// writer each carried and set aside, record by record, and the join of that trace with the findings once they exist.
//
// Moved out of pipeline.mjs unchanged, so that the steps and the modules beside them import it instead of having it
// handed in.
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";
import { reconciliationVerdict } from "./commonlaw-carry.mjs";
import { seamReasonFor } from "./declination-call.mjs";
import { readDeclinations } from "./declination-tool.mjs";
import { parseFindingsJsonLenient } from "./findings-model.mjs";
import { note, runLog } from "./log.mjs";
import { PLACEMENT_CARRY_SCHEMA_VERSION, placementCarryEvent, reconcilePlacementCarry } from "./placement-carry.mjs";
import { placedUriRows, rankingNow, rankingToJson } from "./placement-decisions.mjs";
import { parsePlacementsJson } from "./placement-model.mjs";
import { findingUris, parseStageOutcomes, placementIndex, RECORD_CARRY_SCHEMA_VERSION, recordCarryEvent, traceRecordCarry } from "./record-carry.mjs";
import { appendDiscardRows, DISCARD_LEDGER_NAME, foldDiscardLedger, seamRows } from "./record-discard.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { atomicWrite } from "./run-record.mjs";
import { findingsSurfaceRows, safeReadJson } from "./stage-dispatch.mjs";
import { paths } from "./stages.mjs";
import { reconcileSurfaceDuty, surfaceDutyNote } from "./surface-duty.mjs";
import { existsSync, readFileSync } from "node:fs";

// — the committed ratchet floor. Read at module load like any other frozen contract object; a
// missing or unparseable floor yields state "no-floor" rather than a throw, because a run must not die
// because its ratchet lost its baseline.
const COMMONLAW_CARRY_FLOOR = (() => {
  try { return JSON.parse(readFileSync(new URL("./commonlaw-carry-floor.json", import.meta.url), "utf8")); }
  catch { return null; }
})();
export const safeReadText = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

// ── — the placement→digest CARRY join ─────────────────────────────────────────────────────────
// placements.json is a DECLARED input of register-digest and the digest is told to adopt or
// counter-reason every entry, yet the driver's only reads of that file were a borderline count, an
// empty-file lint and a schema check — nothing ever asked whether a placed candidate reached the
// findings at all. Four sandboxed arms over one band produced watchlist-annex sets of 7, 7, 6 and 0,
// and no artifact anywhere recorded that the fourth had lost them. The band-keyed joins cannot cover
// this: a common-law-shaped placement carries `records: []`, so it has no uri, no band row, and is
// invisible to recall-reconciliation, presence-reconciliation and the screen gate alike.
//
// Disclosure only, deliberately. It never re-tiers (headline vs sheet-2 is judgment and puts
// tier assignment out of scope) and never gates — the artifact + the asserted event + one doubt per
// unanswered placement is the whole mechanism. Absent/legacy placements.json ⇒ computable:false with
// a named reason, never a silent skip.
export function derivePlacementCarry(ctx, trigger) {
  const P = ctx.paths;
  const write = (artifact) => {
    try {
      ensureDriverDir(P.runDir);
      atomicWrite(P.placementCarry, JSON.stringify({ ts: new Date().toISOString(), trigger, ...artifact }, null, 2) + "\n");
    } catch (e) { note(`placement-carry artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
  };
  const notComputable = (reason) => {
    write({ schema_version: PLACEMENT_CARRY_SCHEMA_VERSION, computable: false, reason });
    runLog(P.runDir, placementCarryEvent({ trigger, reason }));
    return null;
  };
  try {
    if (!existsSync(P.placementModel)) return notComputable("no placements.json (a run predating the structured placement mirror)");
    if (!existsSync(P.registerFindings)) return notComputable("no register findings file");
    let placements;
    try { placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements; }
    catch (e) { return notComputable(`placements.json unparseable: ${String(e?.message ?? e).slice(0, 80)}`); }
    const artifact = reconcilePlacementCarry({
      placements, registerFindingsText: readFileSync(P.registerFindings, "utf8"),
    });
    write(artifact);
    runLog(P.runDir, placementCarryEvent({ trigger, artifact }));
    const t = artifact.totals;
    if (t.uncarried || t.unclassified) {
      note(`placement-carry: ${t.uncarried} of ${t.placements} placed candidate(s) end NOWHERE in the register findings`
        + `${t.unclassified ? `, and ${t.unclassified} more offer no join key so the carry cannot be decided either way` : ""}`
        + ` — each ships as an OPEN doubt, and none of this re-tiers or blocks anything`);
    }
    return artifact;
  } catch (e) {
    runLog(P.runDir, { event: "placement-carry-failed", trigger, fail: String(e?.message ?? e).slice(0, 200) });
    note(`placement-carry derivation failed (non-fatal — disclosure only): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

// ── — the RETRIEVAL→findings record trace ─────────────────────────────────────────────────────
// The ruling: every retrieved record either becomes a finding, or carries a recorded reason it did
// not — per record, joinable back to the retrieval, never a tally. the 2026-08-04 R1 E2E run retrieved the jx
// lane's own target ten times (four REGISTERED, three in the matter's own class 9), banded all ten,
// and the delivered report never named the token; nothing anywhere said why. The carry join above
// could not see it because those records never reached a placement, and it starts at placements.
//
// Reads the band, placements, the delivered findings and the run.jsonl spine, and writes one row per
// retrieved record: where it stopped, on what ground, and where that ground was authored. The stage
// outcomes matter as much as the rows: on that run placement-inquiry never logged ok:true (two hard
// walls, then a resume that SKIPPED the stage because a killed attempt had left a partial artifact),
// so every record it failed to place is upstream absence, not judgment, and the trace says so rather
// than blaming a judgment step that never ran.
//
// Disclosure only, deliberately — annotate, never gate (placement-carry.mjs's rule). It never
// re-retrieves, never keeps a record the funnel dropped, never re-tiers and never blocks delivery: on
// the very run that motivated it, a gate would have suppressed a report that shipped.
// ── HALF ONE — the seam recorders ────────────────────────────────────────────────────────────
// Each writes down what ONE pass of ONE seam just did to each record it had in front of it. Called
// immediately after that pass, so the fact is recorded while the step still holds it: the next pass
// overwrites placements.json / register-findings.md / findings.json and nobody downstream can rebuild
// what this one decided. `record-discard.mjs` carries the winner rule (last row at a seam wins, a later
// carry cancels an earlier discard) because the seams re-run from several triggers.
//
// NEVER THROWS and never gates — same doctrine as the trace it feeds. A ledger that cannot be written
// costs the run a `basis: "recorded"`, which the trace then states, and costs it nothing else.
export function recordSeamDiscards(ctx, { seam, stage: stageName, trigger = null, completed = true, skipped = false,
  saw = [], carried = [], reasonFor = null, evidence = "" } = {}) {
  const P = ctx.paths;
  try {
    ctx._discardPass ??= {};
    const pass = (ctx._discardPass[seam] = (ctx._discardPass[seam] ?? 0) + 1);
    // A skipped pass leaves standing what an earlier pass recorded (record-discard.mjs, `seamRows`).
    const prior = skipped ? foldDiscardLedger(safeReadText(driverDir(P.runDir, DISCARD_LEDGER_NAME))) : null;
    const rows = seamRows({ seam, stage: stageName, trigger, pass, completed, skipped, prior, saw, carried, reasonFor, evidence });
    const w = appendDiscardRows(P.runDir, rows);
    const discarded = rows.filter((r) => r.verdict === "discarded").length;
    runLog(P.runDir, {
      event: "record-discard", seam, stage: stageName, trigger, pass, completed,
      saw: rows.length, carried: rows.length - discarded, discarded,
      written: w?.present ?? null, bytes: w?.bytes ?? null, ...(w?.error ? { fail: w.error } : {}),
    });
    return w;
  } catch (e) {
    runLog(P.runDir, { event: "record-discard-failed", seam, stage: stageName, trigger, fail: String(e?.message ?? e).slice(0, 200) });
    return null;
  }
}

/**
 * DIGEST. The placements were in front of this pass; the carry class of each is read off the digest's OWN
 * output (register-findings.md) by the existing placement-carry vocabulary — one carry vocabulary, never
 * a second matcher. `carried` and the two reasoned classes are all carries at this seam: a Negative-results
 * row and a Disagreement-resolutions row are the digest speaking, so the record's ending is the digest's
 * stated one and it is recorded as such rather than as a silent drop.
 */
export function recordDigestSeam(ctx, r, trigger = null) {
  const P = ctx.paths;
  const saw = placedUriRows(P);
  if (!saw.length) return null;
  let idx = new Map();
  try {
    const placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements;
    idx = placementIndex(placements, existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "");
  } catch { /* the trace states an indeterminate carry; this seam records what it can */ }
  const carried = [];
  for (const row of saw) {
    const c = idx.get(normalizeRecordUri(row.uri))?.carry;
    if (c === "carried") carried.push(row);
  }
  return recordSeamDiscards(ctx, {
    seam: "digest", stage: "register-digest", trigger, completed: r?.ok === true && !r?.skipped, skipped: r?.skipped === true,
    saw, carried,
    evidence: r?.fail ? String(r.fail).slice(0, 80) : "",
    reasonFor: (rec, uri) => {
      const seat = idx.get(uri);
      if (seat?.carry === "reasoned-negative") return { reason: "digest:reasoned-negative", reason_source: "step-stated",
        detail: `the register digest wrote this candidate a Negative-results drop row: ${seat.ended_by ?? ""}`.trim() };
      if (seat?.carry === "adjudicated") return { reason: "digest:adjudicated", reason_source: "step-stated",
        detail: `the register digest resolved this candidate in a Disagreement-resolutions row: ${seat.ended_by ?? ""}`.trim() };
      if (seat?.carry === "uncarried") return { reason: "digest:silent-drop", reason_source: "absent",
        detail: `placement placed this candidate at ${seat.tier}; this digest pass neither carried it to a findings surface, nor wrote it a Negative-results drop row, nor resolved it in a Disagreement-resolutions row` };
      return { reason: "digest:indeterminate", reason_source: "absent",
        detail: "this digest pass produced no readable carry for this placed record, so no verdict of its own can be read" };
    },
  });
}

/**
 * SYNTHESIS. The records the digest carried onto a findings surface were in front of this pass; what it
 * delivered is findings.json. Read with the LENIENT parser, deliberately: the strict one returns nothing
 * on a fenced or prose-wrapped file, and a synthesis pass whose output is merely untidy would otherwise
 * record every record it delivered as discarded — the defect rebuilt one seam later.
 */
/** Where the ranking the writer last read is kept, for the sentence on records re-ranked after it wrote. */
export const rankingReadByWriterPath = (P) => paths(P.runDir).rankingReadByWriter;
/** Keeps where each record stood when a writer's pass completed. Never throws. */
export function keepRankingReadByWriter(P) {
  try { atomicWrite(rankingReadByWriterPath(P), JSON.stringify(rankingToJson(rankingNow(P)), null, 2) + "\n"); }
  catch (e) { runLog(P.runDir, { event: "ranking-read-by-writer-failed", reason: String(e?.message ?? e).slice(0, 160) }); }
}

export function recordSynthesisSeam(ctx, r, trigger = null) {   // @internal — driven by its test with a run's own files
  const P = ctx.paths;
  if (r?.ok) keepRankingReadByWriter(P);   // where each record stood as this writer read it
  const declined = readDeclinations(P.runDir);   // — three-valued: absent ledger ≠ empty ledger
  // — ONE DERIVATION, and it is CALLED rather than copied. This used to rebuild the carried set
  // inline, in three lines that happened to match `findingsSurfaceRows`'s. They must match: that function
  // prints the list the seat cites BY POSITION, and this one decides which records the trace blames, so a
  // divergence would silently point `row_index` at a different record than the one recorded. Two copies
  // that agree today is exactly the shape this repo keeps paying for.
  const saw = findingsSurfaceRows(P);
  if (!saw.length) return null;
  let delivered = [];
  try {
    if (existsSync(P.findings)) {
      const parsed = parseFindingsJsonLenient(readFileSync(P.findings, "utf8"));
      for (const [uri] of findingUris(parsed.findings ?? [])) delivered.push({ uri });
    }
  } catch { /* validators.findings' business; this seam records what it can */ }
  // A POSITION IS SEEN WHOLE AND ENDS WHOLE. Each row the writer was handed is a position, one placement entry: every
  // record of it was seen. A record a finding names is carried. A finding naming any record of a position delivers it,
  // and its other records end with it on that ground; the row's declination is each record's. Only a named record
  // reads as carried, because the trace holds a carried record to a finding that names it.
  const key = (u) => String(normalizeRecordUri(u) ?? "");
  const deliveredKeys = new Set(delivered.map((d) => key(d.uri)));
  const rowOf = new Map(), namedWith = new Map();
  const sawRecords = [];
  for (const row of saw) {
    const members = Array.isArray(row?.uris) && row.uris.length ? row.uris : [row?.uri];
    const named = members.find((u) => deliveredKeys.has(key(u)));
    for (const u of members) {
      sawRecords.push({ ...row, uri: u });
      rowOf.set(key(u), row?.uri);
      if (named) namedWith.set(key(u), named);
    }
  }
  return recordSeamDiscards(ctx, {
    seam: "synthesis", stage: "synthesis", trigger, completed: r?.ok === true && !r?.skipped, skipped: r?.skipped === true,
    saw: sawRecords, carried: delivered,
    evidence: r?.fail ? String(r.fail).slice(0, 80) : "",
    reasonFor: (rec, uri) => {
      const named = namedWith.get(key(uri));
      if (named) return { reason: "synthesis:delivered-with-its-position", reason_source: "step-stated",
        detail: `delivered with its position: a finding names ${named}, another record of the same placement entry` };
      // — THE 102. This callback used to be zero-arity and constant: every record this pass
      // discarded got the same sentence and `step-silent`, whatever it was. One of them was KORPHIC,
      // a lawyer-named gold mark placed on sheet-2 and stamped `carry: "carried"`, and the trace could
      // say only that synthesis had not delivered it. The sibling seam one stage earlier
      // (`recordDigestSeam`) has read its stage's own output per record since it was written; this one
      // had nothing to read until `record_declination` gave synthesis somewhere to say it.
      // The judgment itself is `seamReasonFor`, pure and next door, so the guarantee has an arm
      // that does not need a run directory. This callback is now only the plumbing around it.
      return seamReasonFor(declined, rowOf.get(key(uri)) ?? uri);
    },
  });
}

// ── HALF TWO — the join, AFTER findings.json exists ──────────────────────────────────────────
// `findings` is passed in rather than read here so the caller proves it has them. The previous version
// read the file itself, from inside register-digest, which runs BEFORE synthesis authors it — so it
// joined against `[]` and reported every record that became a finding as dropped.
export function deriveRecordCarry(ctx, trigger, { findings = null } = {}) {   // @internal — exported for its CALL-SITE test ( leg b)
  const P = ctx.paths;
  const write = (artifact) => {
    try {
      ensureDriverDir(P.runDir);
      atomicWrite(P.recordCarry, JSON.stringify({ ts: new Date().toISOString(), trigger, ...artifact }, null, 2) + "\n");
    } catch (e) { note(`record-carry artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
  };
  const notComputable = (reason) => {
    write({ schema_version: RECORD_CARRY_SCHEMA_VERSION, computable: false, reason });
    runLog(P.runDir, recordCarryEvent({ trigger, reason }));
    return null;
  };
  try {
    if (!existsSync(P.registerNamedBand)) return notComputable("no register-named-band.json (nothing was retrieved, or a run predating the named band)");
    const band = safeReadJson(P.registerNamedBand);
    if (!band) return notComputable("register-named-band.json unreadable");
    let placements = [];
    if (existsSync(P.placementModel)) {
      // a malformed mirror is validators.placement's business; here it means every placed record
      // reads trace:indeterminate rather than the trace refusing to run at all
      try { placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements; } catch { /* noted by its own validator */ }
    }
    // THE FINDINGS THIS JOINS AGAINST. Passed in by a caller that has them; read here with the LENIENT
    // parser only as the fallback, never with `safeReadJson`. The strict read was the second way this
    // artifact reached the same wrong answer: a fenced or prose-wrapped findings.json parsed to null,
    // `?? ` turned that into "no findings", and every delivered record read as dropped — the
    // defect by a different route, on a file the run had already recovered elsewhere.
    let deliveredFindings = Array.isArray(findings) ? findings : null;
    if (!deliveredFindings) {
      try { deliveredFindings = existsSync(P.findings) ? (parseFindingsJsonLenient(readFileSync(P.findings, "utf8")).findings ?? []) : []; }
      catch { deliveredFindings = []; }
    }
    const artifact = traceRecordCarry({
      bandRecords: Array.isArray(band?.enumerated) ? band.enumerated : [],
      crowds: Array.isArray(band?.crowds) ? band.crowds : [],
      placements,
      registerFindingsText: existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "",
      findings: deliveredFindings,
      outcomes: parseStageOutcomes(safeReadText(paths(P.runDir).run)),
      planExecution: safeReadJson(paths(P.runDir).planExecution),
      ledger: foldDiscardLedger(safeReadText(driverDir(P.runDir, DISCARD_LEDGER_NAME))),
      // — read the sibling traces OFF DISK rather than threading state through the run: what is
      // on disk at publish is exactly what this run produced, and a declaration derived from anything
      // else can go stale the way the hand-kept constant did.
      siblings: [P.commonLawCarry, P.jxZhCarry].map((f) => safeReadJson(f)).filter(Boolean),
    });
    write(artifact);
    runLog(P.runDir, recordCarryEvent({ trigger, artifact }));
    const t = artifact.totals;
    // ── THE RECONCILIATION RATCHET ────────────────────────────────────────────────────────────
    //
    // RECORDED ON EVERY RUN, tripping only against the committed floor. Both halves are deliberate:
    // a gate that fires on every current run teaches its reader that red means nothing (the whole
    // complaint), and a warning that never bites is decoration. The floor is what the contract achieves
    // today, dated and seeded from a delivered round, and it moves UP when the seat-compliance work
    // lands.
    //
    // ANNOTATES, NEVER SUPPRESSES — the deliverable ships first, exactly like the three notes above.
    // Below-floor means the ROUND cannot claim the contract held; it never means a client gets nothing.
    try {
      const v = reconciliationVerdict(artifact, COMMONLAW_CARRY_FLOOR);
      // NO `slice` FIELD, AND ITS ABSENCE IS THE FIX. shipped this object naming a bare `slice`
      // identifier that has never been bound: deriveRecordCarry takes (ctx, trigger, {findings}) and is
      // called once, at publish, over the whole artifact — there is no slice here to name. The
      // ReferenceError fired on THIS line, the catch below turned it into "verdict failed (non-fatal)",
      // and so the ratchet exists to run has never recorded once. If a PER-SLICE ratchet was the
      // intent, that is a design question for, not something to infer from a stray identifier.
      runLog(P.runDir, { event: "commonlaw-reconciliation", state: v.state,
        candidates_rate: v.rates.candidates.rate, candidates: v.rates.candidates.reconciled, retrieved: v.rates.candidates.retrieved,
        cells_rate: v.rates.cells.rate, cells_rowed: v.rates.cells.rowed, cells_candidate_bearing: v.rates.cells.candidate_bearing,
        trips: v.trips.map((t) => t.metric), floor_date: COMMONLAW_CARRY_FLOOR?.seeded?.date ?? null });
      // The human-read sink, not only the field (/E11): a rate in run.jsonl that never reaches a
      // sentence is a discriminator nobody sees.
      const pct = (r) => (r == null ? "n/a" : `${(r * 100).toFixed(1)}%`);
      if (v.state === "below-floor") {
        for (const t of v.trips) {
          note(`commonlaw-reconciliation: BELOW FLOOR — ${t.label} is ${pct(t.got)}, floor ${pct(t.floor)}`
            + ` (seeded ${COMMONLAW_CARRY_FLOOR?.seeded?.date ?? "?"}). The report still ships; the ROUND cannot claim`
            + " the carry contract held. See driver/commonlaw-carry-floor.json");
        }
      } else if (v.state === "at-or-above-floor") {
        note(`commonlaw-reconciliation: ${pct(v.rates.candidates.rate)} of ${v.rates.candidates.retrieved} candidate(s) reconciled,`
          + ` ${pct(v.rates.cells.rate)} of ${v.rates.cells.candidate_bearing} candidate-bearing cell(s) carry their negative row — at or above the floor`);
      }
    } catch (e) {
      // ── — THIS CATCH BOUGHT TWO MONTHS OF SILENCE, TWO WAYS ─────────────────────────────
      //
      // 1. IT LAUNDERED A PROGRAMMING ERROR INTO A DOMAIN OUTCOME. `slice is not defined` left here as
      //    "verdict failed (non-fatal)" — the sentence a malformed artifact would also produce. A reader
      //    seeing it has no way to tell "the ratchet ran and could not judge" from "the ratchet has never
      //    run". Ten pool traversals, ten failures, zero successes, and nobody could see it.
      // 2. IT REPORTED ONLY TO STDERR. `note()` in `log.mjs` is stderr-only. Nothing reached run.jsonl,
      //    the run dir, or any audited artifact — so no consumer we have could ever have noticed.
      //
      // ReferenceError is the ONLY hard discriminator, and the narrowness is deliberate. TypeError is
      // NOT a programming error here: `v.rates.candidates.rate` on a malformed artifact throws one, and
      // that is a genuine domain failure. Classing it as a bug would commit this catch's own substitution
      // in the opposite direction. Anything beyond ReferenceError gets classified by SHAPE, named at the
      // site, never by constructor.
      const bug = e instanceof ReferenceError;
      runLog(P.runDir, {
        event: bug ? "commonlaw-reconciliation-bug" : "commonlaw-reconciliation-failed",
        error: e?.name ?? "Error", detail: String(e?.message ?? e).slice(0, 200),
        floor_date: COMMONLAW_CARRY_FLOOR?.seeded?.date ?? null,
      });
      note(bug
        ? `commonlaw-reconciliation: DRIVER BUG — ${String(e?.message ?? e).slice(0, 80)}. The ratchet did not run; this is our code, not the artifact. Recorded as commonlaw-reconciliation-bug in run.jsonl.`
        : `commonlaw-reconciliation: verdict failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`);
    }

    if (artifact.degenerate) {
      // The self-check firing. On the run that motivated the issue this was true and silent.
      note(`record-carry: DEGENERATE — findings.json names ${artifact.delivered_findings} finding(s) and this trace says NOT ONE`
        + " retrieved register record became one. Those are statements about the same records, so the TRACE is wrong,"
        + " not the run's recall. Do not quote drop counts from this artifact");
    }
    if (artifact.basis !== "recorded") {
      note(`record-carry: basis=${artifact.basis} — no per-seam discard ledger was present, so every ending in this`
        + " trace was INFERRED by comparing artifacts after the fact rather than recorded by the step that decided it."
        + ` Expected on a run archived before #420; on a fresh run it means no seam wrote to _driver/${DISCARD_LEDGER_NAME}`);
    }
    if (t.unreasoned) {
      note(`record-carry: ${t.unreasoned} of ${t.retrieved} retrieved register record(s) were dropped with NO step recording a ground`
        + ` — each ships as an OPEN doubt; see _driver/record-carry.json .unreasoned. This annotates, it does not re-judge or block`);
    }
    // item 3 — THE SILENCE AT THE READER SURFACE, narrower than `unreasoned` above and reported
    // separately because the two are different claims. `unreasoned` counts every retrieved record with no
    // ground, at any depth; this counts only records a reader surface ALREADY CARRIED, where a decline is
    // a judgment rather than a filter. On the round that motivated this issue the wide number was 0 and
    // this one was 102 — the wide check read clean while a lawyer-named mark sat in the narrow one.
    try {
      const surfaceDuty = reconcileSurfaceDuty({ rows: artifact.rows });
      try {
        atomicWrite(P.surfaceDuty, JSON.stringify({ ts: new Date().toISOString(), trigger, ...surfaceDuty }, null, 2) + "\n");
      } catch (e) { note(`surface-duty artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
      if (surfaceDuty.tripped) note(surfaceDutyNote(surfaceDuty));
    } catch (e) { note(`surface-duty: not computed (${String(e?.message ?? e).slice(0, 80)})`); }
    if (t.upstream_absent) {
      note(`record-carry: ${t.upstream_absent} of ${t.retrieved} retrieved register record(s) were dropped because an upstream stage never completed`
        + ` (${artifact.incomplete_stages.join(", ")}) — NOT because any judgment step rejected them. Any output those stages left is partial`);
    }
    // — GATED ON THE SLICES, NOT ON THE HIT SUM. A refused slice contributes ZERO untraced
    // hits (the executor writes total_hits:0 beside its error stamp), so `if (t.untraced_hits)` went
    // silent on exactly the runs worth telling an operator about: a register round whose provider
    // refused every slice has untraced_hits 0 and printed nothing at all. And "count-only" was the
    // wrong word for the whole population — some of these were never counted.
    if (t.untraceable_slices) {
      note(`record-carry: ${t.untraceable_slices} slice(s) have NO per-record trace at all`
        + (t.untraced_hits ? `, carrying ${t.untraced_hits} hit(s) that were counted and never fetched` : "")
        + " — see .untraceable_slices, whose per-slice reason says whether each was counted-not-fetched or never answered at all");
    }
    // ALWAYS, even on a run with nothing to report: the boundary is what stops the zeros above being
    // read as "nothing was dropped anywhere". A path that emits no rows must say it emitted none.
    note(`record-carry: traced ${t.retrieved} record(s) on the REGISTER path only`
      + ` — no rows are emitted for ${(artifact.scope?.uninstrumented ?? []).map((u) => u.path).join(", ")},`
      + " so this trace is SILENT about drops on those paths rather than clearing them");
    return artifact;
  } catch (e) {
    runLog(P.runDir, { event: "record-carry-failed", trigger, fail: String(e?.message ?? e).slice(0, 200) });
    note(`record-carry derivation failed (non-fatal — disclosure only): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

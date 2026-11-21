// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// delivered-record-run.mjs — the delivered record as a run rebuilds and keeps it: which stages rebuild it, the record
// rebuilt and the copy kept as history, the cards never built or still owed, the findings the report reads, the reading
// log, the goods handed whole, the owner screen at delivery, and a superseded audit withdrawn.
//
// Moved out of pipeline.mjs unchanged, so that the steps import these instead of having them handed in.
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";
import { planWriteUps } from "./coverage-rows-run.mjs";
import { settleDerivedBases } from "./dispatch-extras.mjs";
import { stitchDoubts } from "./doubt-ledger.mjs";
import { parseFindingsJson, parseFindingsJsonLenient } from "./findings-model.mjs";
import { enrichFindingDeadlines } from "./floor-and-gap-checks.mjs";
import { note, runLog } from "./log.mjs";
import { placementAuditRows } from "./placement-decisions.mjs";
import { buildAuditMd } from "./publish/audit-from-spine.mjs";
import { deriveRecordCarry } from "./record-carry-trace.mjs";
import { recordCarryDoubtsAgain } from "./record-carry.mjs";
import { deriveOwnerScreenArtifact } from "./register-band-run.mjs";
import { readOwnerScreen } from "./register-digest-run.mjs";
import { atomicWrite } from "./run-record.mjs";
import { safeReadJson } from "./stage-dispatch.mjs";
import { readStamp } from "./stage-freshness.mjs";
import { paths } from "./stages.mjs";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * The receipt AT DELIVERY, derived on the spot when a resume skipped the fan-in that writes it.
 *
 * Without this the two named-competitor lint checks emit nothing at all on a resumed run — no
 * failure, no pass row, no trace: an absence reading as success, which is the exact defect class the
 * instrumentation house rule exists to kill. The absence is therefore also RECORDED either way, with
 * the reason, so "this matter has no owner lane" and "the receipt went missing" are distinguishable.
 */
export function ownerScreenForDelivery(ctx) {   // @internal
  const P = ctx.paths;
  const onDisk = readOwnerScreen(P);
  if (onDisk?.owners?.length) return onDisk;
  let derived = null;
  try {
    if (ctx.registerPlan && existsSync(P.registerNamedBand)) {
      derived = deriveOwnerScreenArtifact(ctx, JSON.parse(readFileSync(P.registerNamedBand, "utf8")));
    }
  } catch (e) { note(`owner-screen delivery derivation skipped (non-fatal): ${String(e.message).slice(0, 80)}`); }
  if (!derived?.owners?.length) {
    runLog(P.runDir, { event: "owner-screen-absent", owners: 0,
      reason: !ctx.registerPlan ? "no frozen register plan on this run"
        : !existsSync(P.registerNamedBand) ? "no merged band on disk"
        : "the frozen plan carries no owner×element slice (no watchlist owners seeded)" });
  }
  return derived;
}

// THE RECORDS A DELIVERY REPAIR WAS HANDED THE WHOLE GOODS TEXT FOR (predelivery-lint.mjs, goodsHeldWholeChecks), kept
// beside the run so the check after that repair, and a resume, do not name them again. A missing or unreadable file is
// an empty set: the check then names them, which costs a repair and never hides a finding.
const GOODS_HANDED_FILE = "goods-held-whole-handed.json";
export function readGoodsHanded(runDir) {
  try { return new Set(JSON.parse(readFileSync(driverDir(runDir, GOODS_HANDED_FILE), "utf8"))?.records ?? []); } catch { return new Set(); }
}
export function recordGoodsHanded(runDir, uris) {
  const all = new Set([...readGoodsHanded(runDir), ...uris]);
  ensureDriverDir(runDir);
  atomicWrite(driverDir(runDir, GOODS_HANDED_FILE), JSON.stringify({ records: [...all].sort() }, null, 2) + "\n");
}

// ── B1: per-finding report assembly (report confabulation fix) ───────────────────────────────────────────
// report.md is no longer ONE LLM pass over every card (that cross-contaminated cards). report-overview writes
// the shell; report-card renders ONE card per finding in isolation; the driver assembles deterministically.

// Parse findings.json for the per-card render ([] when absent/malformed — a clean run still ships a shell).
/**
 * — READ THE FINDINGS, AND NEVER REPORT A REJECTION AS AN ABSENCE.
 *
 * This returned `[]` on any parse failure, justified by a comment saying a malformed findings.json had
 * already failed validators.narrative upstream. That stopped being true. findings.json is rewritten by the
 * corrective and lint-repair loops LONG after narrative validation — on R1 PROJECT SABLE it was written at
 * 15:59:42Z, and stale-repair read it twenty seconds later with no validation in between.
 *
 * What the run then said was false in the most expensive possible way. `parseFindingsJson` threw on
 * `finding_action_condition_on_advisory:16`; the catch turned 31 findings into zero; every one of 26 cards
 * took the `!f` branch and reported "has no full-prose finding in the current findings.json"; the delivery
 * guard blocked; the run parked at delivery at 3h35m, burning recovery lane 2 of 3. The findings were
 * there. `parseFindingsJsonLenient` reads that same file cleanly.
 *
 * So the two questions are separated, because they have different answers:
 *
 *   · CAN THE CARDS BE JOINED? Yes — the join needs ordinals, and the lenient reader has them. A card is
 *     declared stale-and-unrepairable only when its finding is genuinely absent, never when a sibling
 *     finding tripped a semantic rule.
 *   · IS THE FILE VALID? No — and that is a real defect that must not be laundered into a clean delivery.
 *     It comes back as `rejected`, the caller says so with the validator's own token, and the delivery
 *     guard still refuses. The run is blocked for the reason it is actually blocked for.
 *
 * Returns {findings, rejected} — `rejected` is null when the file parsed strictly (or is absent), otherwise
 * the validator's message. An absent file is NOT a rejection: no findings is a legitimate state.
 */
// EXPORTED for scripts/write-up-form-census.mjs ( design question 4): a census that reimplemented
// this would lose the LENIENT fallback below and report zero findings on exactly the runs where the card
// loop joined many. The census must count the population the pipeline counts, not a similar one.
export function readFindingsForReport(P) {
  if (!existsSync(P.findings)) return { findings: [], rejected: null };
  let raw;
  try { raw = readFileSync(P.findings, "utf8"); }
  catch (e) { return { findings: [], rejected: `unreadable: ${String(e.message).slice(0, 120)}` }; }
  try { return { findings: parseFindingsJson(raw).findings ?? [], rejected: null }; }
  catch (e) {
    // The strict parser refused. Fall back to the lenient reader for the JOIN only — it is the same file,
    // and a finding whose ordinal is readable can still have its card matched. If even that fails the file
    // is genuinely unusable and zero findings is the honest answer.
    let findings = [];
    try { findings = parseFindingsJsonLenient(raw).findings ?? []; } catch { /* genuinely unusable */ }
    return { findings, rejected: String(e.message).replace(/\s+/g, " ").slice(0, 200) };
  }
}

/**
 * THE DRIVER'S WRITES FROM BEFORE THE SEAM, MADE AGAIN AFTER A SYNTHESIS SAVE THAT FOLLOWS IT.
 *
 * Two writes into the findings record run before the seam rather than at it: the basis derivation, which demotes a
 * `verified-from-record` stamp the reading log cannot back, and the deadline enrichment, which gives a finding with
 * no deadline the register's own opposition window. A save after the seam renders the record from the model's call.
 * A patch keeps both, because each also lands in the merge base the patch is merged onto; a whole re-send replaces
 * that base, and they went with it. The seam's own writes were made again after such a save, and these two were not,
 * so the delivered record claimed reads no step had made, and every card whose finding had carried a demoted stamp
 * read as stale and was rebuilt for a finding the save had not changed. They run again here, in the order the pass
 * ran them, before the seam's writes. Each leaves a record that already carries it as it is, and neither throws.
 */
export function rewriteFromBeforeTheSeam(ctx) {   // @internal
  settleDerivedBases(ctx, "late-save");
  enrichFindingDeadlines(ctx.paths, ctx.paths.runDir, note, { nowMs: deadlineClockOf(ctx.paths.runDir) });
}

/**
 * The clock the run's deadline enrichment judged its windows by, so a window is judged again exactly as it was
 * judged the first time, never moved across its edge by the minutes a repair took. Now, on a run whose enrichment
 * recorded none: it judged nothing, so there is nothing to keep it consistent with. Never throws.
 */
function deadlineClockOf(runDir) {
  try {
    const at = Date.parse(JSON.parse(readFileSync(paths(runDir).deadlineEnrich, "utf8"))?.judged_at);
    return Number.isFinite(at) ? at : Date.now();
  } catch { return Date.now(); }
}

/** The full cards the record owes as it stands now, in its order. */
export function owedCardOrdinals(P, depth) {
  return planWriteUps(readFindingsForReport(P).findings, depth, safeReadJson(P.bandShape)).cardOrdinals;
}

/**
 * THE CARD A FINDING ADDED AFTER THE CARDS IS OWED. A card with no stamp is never stale, so a finding that a
 * synthesis save after the cards made owed a full card, at an ordinal the first plan never dispatched one for (a
 * finding it added, or one it moved from a short entry to a full card), got no card call, and the report rendered it
 * structured-only or as the short entry. Each such card joins the delivery check's repair once, as owed and never
 * built; a card the first plan dispatched and that failed keeps that outcome, as a failed card always has. Returns
 * entries in the shape `staleOnPath` gives.
 */
export function cardsNeverBuilt(P, depth, firstPlan) {
  const dispatched = new Set(firstPlan ?? []);
  return owedCardOrdinals(P, depth)
    .filter((o) => !dispatched.has(o) && !readStamp(P.runDir, `report-card:${o}`))
    .map((o) => ({ label: `report-card:${o}`, changed: [{ name: `${o}.md`, was: null, now: null, via: "never-built" }] }));
}

/** The repaired stages whose output the record-carry trace or the Audit Trail reports. */
export const REBUILDS_THE_DELIVERED_RECORD = new Set(["placement-inquiry", "register-digest", "synthesis", "narrative-refutation"]);

/**
 * Keep the Audit Trail, the record-carry trace and the doubt ledger as they stand, under _history/<ts>-audit-and-trace-
 * <reason>/, before any of them is written again, so a pass that writes them over a repair or a resume never loses what
 * the earlier state said. The pass that wrote them may have delivered nothing: a pass the delivery check held writes
 * them too. Returns the directory, or null when there was nothing to keep. Best-effort, like every snapshot.
 */
export function keepDeliveredRecordAsHistory(P, reason) {   // @internal — driven by its test with a run's own files
  const files = [P.audit, P.recordCarry, paths(P.runDir).doubts].filter((f) => existsSync(f));
  if (!files.length) return null;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = join(P.runDir, "_history", `${ts}-audit-and-trace-${reason}`);
    mkdirSync(dest, { recursive: true });
    for (const f of files) copyFileSync(f, join(dest, basename(f)));
    return dest;
  } catch { return null; }
}

/**
 * The reading audit's lookups (band-server appends every lookup to _driver/reading-log.jsonl). Read on any run that
 * derived a band shape, an empty list included, because a band-consuming stage that read nothing is a fact the audit
 * must show; null on a run with no shape, which renders no section. A torn tail line never kills the audit.
 */
export function readReadingLog(P) {
  if (!existsSync(P.bandShape)) return null;
  const log = [];
  try {
    for (const line of readFileSync(P.readingLog, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { log.push(JSON.parse(line)); } catch { /* a torn tail line never kills the audit */ }
    }
  } catch { /* no lookups recorded — the empty array IS the disclosure */ }
  return log;
}

/**
 * Take an audit that no longer describes the run out of the place publishing reads it from, keeping it under _history
 * (unless the caller has just kept it). The report then ships without that Audit Trail, as it does when a first build
 * fails, never with an earlier one offered as current; the publisher still builds the workbook from the current
 * findings. Returns whether an audit was withdrawn.
 */
export function withdrawSupersededAudit(P, reason, { keep = true } = {}) {   // @internal — driven by its test with a run's own files
  if (!existsSync(P.audit)) return false;
  if (keep) keepDeliveredRecordAsHistory(P, reason);
  try { rmSync(P.audit, { force: true }); } catch { return false; }
  runLog(P.runDir, { event: "audit-withdrawn", reason });
  return true;
}

/** The doubt ledger on disk, written again with the doubts the rebuilt audit carries; what it said of the closure stays. */
function writeDoubtLedgerAgain(P, doubts, truncated) {
  const path = paths(P.runDir).doubts;
  const earlier = safeReadJson(path) ?? {};
  const settled = doubts.filter((d) => d?.status === "checked-and-settled").length;
  const { doubts: _d, minted: _m, settled: _s, open: _o, truncated: _t, ...closure } = earlier;
  writeFileSync(path, JSON.stringify({ minted: doubts.length, settled, open: doubts.length - settled,
    ...(truncated?.length ? { truncated } : {}), ...closure, doubts }, null, 2));
}

/**
 * THE TRACE AND THE AUDIT TRAIL, WRITTEN AGAIN OVER A REPAIR. Both describe a pass before the delivery check repairs
 * anything, and a stage that check re-runs can change what they report: a repeated placement pass can reverse a
 * set-aside or change its ground. This keeps the pair as it stands under _history, then writes the trace and the audit
 * again from the run's files, so what is delivered describes the decision that stands at delivery. `inputs` are what the
 * pass built its audit from. The doubts minted from the trace follow the trace written again (recordCarryDoubtsAgain);
 * every other doubt and ask stands as the pass raised and closed it, and nothing is dispatched again.
 * A rebuild that fails, the trace written and the audit not among the ways, withdraws the audit on disk: it describes
 * the state before the repair. Returns {ok, counts} or {ok:false, reason}. IMPURE (writes the run).
 */
export function rebuildDeliveredRecord(ctx, inputs = {}, trigger = "stale-repair") {   // @internal — driven by its test with a run's own files
  const P = ctx.paths;
  keepDeliveredRecordAsHistory(P, trigger);
  try {
    let findingsNow = [], actionsNow = [];
    try {
      if (existsSync(P.findings)) {
        const parsed = parseFindingsJsonLenient(readFileSync(P.findings, "utf8"));
        findingsNow = parsed.findings ?? [];
        actionsNow = parsed.actions ?? [];
      }
    } catch { /* the audit still builds without them */ }
    deriveRecordCarry(ctx, trigger, { findings: findingsNow });
    const registerFindingsText = readFileSync(P.registerFindings, "utf8");
    // THE DOUBTS MINTED FROM THE TRACE FOLLOW THE TRACE. The record-carry family was minted from the trace before the
    // repair; read against the trace written just above, a record the repair answered loses its doubt and one it left
    // unreasoned gains one, keyed by record so no closure the closure step recorded moves onto another record. Every
    // other family stands as the pass raised and closed it.
    let doubts = inputs.doubts ?? null, doubtTruncations = inputs.doubtTruncations ?? null;
    if (Array.isArray(doubts)) {
      const coverageRows = (() => { try { const rows = JSON.parse(readFileSync(P.registerCoverageLedger, "utf8")); return Array.isArray(rows) ? rows : []; } catch { return []; } })();
      const re = recordCarryDoubtsAgain(doubts, safeReadJson(P.recordCarry),
        { stitch: (ds) => stitchDoubts(ds, { findings: { findings: findingsNow, actions: actionsNow }, coverageRows, registerFindingsText }) });
      doubts = re.doubts;
      // A trace that could not be read says nothing about any record: the doubts stand as raised, and so does the count
      // of those the cap left out.
      if (!re.unavailable) doubtTruncations = [...(doubtTruncations ?? []).filter((t) => t?.source !== "record-carry"),
        ...(re.omitted ? [{ source: "record-carry", minted: re.minted, omitted: re.omitted }] : [])];
      writeDoubtLedgerAgain(P, doubts, doubtTruncations);
      if (re.fresh.length || re.dropped.length || re.unavailable)
        runLog(P.runDir, { event: "record-carry-doubts-again", trigger, fresh: re.fresh.length, dropped: re.dropped.length, ...(re.unavailable ? { unavailable: true } : {}) });
    }
    const again = buildAuditMd(registerFindingsText, inputs.commonLawText ?? "",
      { findings: findingsNow, doubts, asks: inputs.asks ?? null, readingLog: readReadingLog(P),
        commonLawGrid: inputs.commonLawGrid ?? null, doubtTruncations,
        registerPresence: inputs.registerPresence ?? null, placementRows: placementAuditRows(P) });
    if (!again.counts.findings) throw new Error("0 findings parsed from the spine tables");
    writeFileSync(P.audit, again.md);
    runLog(P.runDir, { event: "audit-rebuilt", trigger, ...again.counts });
    return { ok: true, counts: again.counts };
  } catch (e) {
    const reason = String(e?.message ?? e).slice(0, 160);
    runLog(P.runDir, { event: "audit-rebuild-failed", trigger, reason });
    withdrawSupersededAudit(P, `${trigger}-failed`, { keep: false });   // the pair as it stood was kept above
    return { ok: false, reason };
  }
}

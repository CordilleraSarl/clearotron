// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// coverage-rows-run.mjs — the coverage rows a run adds before its overview and cards: deferrals, lane depth, the meaning
// gap, the screen gate, script scope and uncovered markets, with the coverage judgment's stamps; and the plan for the
// write-ups, the short entries composed in code, the common-law carry and the findings file consolidated.
//
// Moved out of pipeline.mjs unchanged, so that the steps import these instead of having them handed in.
import { driverDir } from "../shared/driver-dir.mjs";
import { floorMarkKey, floorTierByMark } from "./band-shape.mjs";
import { CL_STAGES, commonLawCarryEvent, traceCommonLawCarry } from "./commonlaw-carry.mjs";
import { readCoverageForm } from "./coverage-form-io.mjs";
import { isLayerRow, nationalRegistersNote, nationalRegistersNotSearched, orderFormName, rowIsSettled, unitLabel } from "./coverage-form.mjs";
import { parkedCoverageRows } from "./coverage-union.mjs";
import { coverageUnitLabel } from "./coverage-ledger.mjs";
import { deferralCoverageRow, plainDeferralReason, plainDirective } from "./deferral-row.mjs";
import { NOT_COMPLETED, PART_NAMES } from "./degraded-parts.mjs";
import { clientMarkets, orderTerritories } from "./effective-scope.mjs";
import { parseFindingsJson } from "./findings-model.mjs";
import { loadScreenGateUnresolved } from "./floor-and-gap-checks.mjs";
import { axisTwin, followUpKinds, kindsForFollowUp } from "./follow-up-twins.mjs";
import { JURISDICTION_ADAPTERS, scopeJurisdictions as jxScopeJurisdictions, LANGUAGE_LANES } from "./jx-lanes.mjs";
import { note, runLog } from "./log.mjs";
import { NATIVE_LANGUAGE_REMEDY } from "./products.mjs";
import { regionName } from "./publish/regions.mjs";
import { safeReadText } from "./record-carry-trace.mjs";
import { parseStageOutcomes } from "./record-carry.mjs";
import { foldFindingsFile } from "./record-fold.mjs";
import { instructedOrder } from "./record-goods.mjs";
import { plannedChannelsFor, readPlanExecution } from "./register-band-run.mjs";
import { loadCoverageLedger } from "./register-digest-run.mjs";
import { NOT_COVERED_REASON, registerReach } from "./register-reach.mjs";
import { atomicWrite } from "./run-record.mjs";
import { writeFindings } from "./stage-freshness.mjs";
import { paths } from "./stages.mjs";
import { writeUpForm } from "./write-up-form.mjs";
import { groupEntries, shortEntryBody } from "./write-up-render.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

export function deriveCommonLawCarry(ctx, trigger, { slice = "common-law", gridPath = null, findingsPath = null,
  consumed = true, outPath = null } = {}) {
  const P = ctx.paths;
  const target = outPath ?? P.commonLawCarry;
  const write = (artifact) => {
    try {
      mkdirSync(dirname(target), { recursive: true });
      atomicWrite(target, JSON.stringify({ ts: new Date().toISOString(), trigger, ...artifact }, null, 2) + "\n");
    } catch (e) { note(`commonlaw-carry artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
  };
  try {
    const grid = gridPath ?? P.commonLawGrid;
    if (!existsSync(grid)) {
      // An absence is a state, not a pass. A matter with no common-law pass writes nothing and says so.
      runLog(P.runDir, commonLawCarryEvent({ trigger, slice, reason: `no ${basename(grid)} on this run` }));
      return null;
    }
    // — WHAT WAS ORDERED, read from the file the EXECUTOR was ordered from. The two reconciliation
    // rates divide the run by itself, so a channel that produced no cell and no candidate enters neither
    // side and a partial sweep scores like a complete one. The plan is the missing denominator.
    //
    // `_driver/grid-spec.json` is the right source and not `ctx.profile.platforms`: it is what the
    // deterministic grid actually runs and what the receipts gate already joins ("the single, consistent
    // lever", above), it carries `[...channels, "web"]` with the general-web cell already unioned, and it
    // is the file that survives the GENERIC-profile branch where the channels come from the matter frame
    // rather than the profile. Reading the profile here would compare the grid against a plan the grid was
    // never given.
    //
    // ABSENT ⇒ null ⇒ the trace reports `channels.state: "unknown"`, never a clean 1. A register-only run
    // and a run whose grid spec never landed both genuinely cannot say what was ordered, and a coverage
    // question that was never asked must not answer itself in the affirmative.
    const plannedChannels = plannedChannelsFor(P);

    const artifact = traceCommonLawCarry({
      gridRaw: readFileSync(grid, "utf8"),
      planned: plannedChannels,
      findingsText: existsSync(findingsPath ?? P.commonLaw) ? readFileSync(findingsPath ?? P.commonLaw, "utf8") : "",
      // ALL THREE labels. A split run logs `common-law-half:a` / `:b` and never `common-law`; asking for
      // `["common-law"]` alone finds no events and every candidate on every split run reads
      // stage-incomplete — a loud wrong answer on the common path.
      outcomes: parseStageOutcomes(safeReadText(paths(P.runDir).run), CL_STAGES),
      consumed, slice,
    });
    write(artifact);
    runLog(P.runDir, commonLawCarryEvent({ trigger, artifact, slice }));
    if (artifact.computable !== true) return artifact;
    const t = artifact.totals;
    if (t.unreasoned) {
      note(`commonlaw-carry (${slice}): ${t.unreasoned} of ${t.retrieved} retrieved candidate(s) were dropped with NO step recording a ground`
        + ` — see ${basename(target)} .unreasoned. This annotates, it does not re-judge or block`);
    }
    if (t.unjoinable_candidates) {
      note(`commonlaw-carry (${slice}): ${t.unjoinable_candidates} candidate(s) carry no URL, so they are counted BY NAME`
        + " rather than joined — see .unjoinable_candidates. Nothing non-Latin is dropped silently");
    }
    if (artifact.degenerate) {
      note(`commonlaw-carry (${slice}): DEGENERATE — the findings name ${artifact.findings_urls} URL(s) and this trace`
        + " says NOT ONE retrieved candidate reached a finding. The TRACE is wrong, not the run's recall");
    }
    return artifact;
  } catch (e) {
    runLog(P.runDir, { event: "commonlaw-carry-failed", trigger, slice, fail: String(e?.message ?? e).slice(0, 200) });
    note(`commonlaw-carry derivation failed (non-fatal — disclosure only): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

// ── — coverage_judgment.rows IS WRITTEN BY THE DRIVER ────────────────────────────────────────
//
// The dictation used to invite the stage to author "one typed row per slice you weighed". So the rows
// that name which slices are open — the exact facts a reader checks a sufficiency call against — were
// prose the model retyped out of a ledger it had not been shown. That is the transcription
// contract one artifact over: an identifier the seat was never handed is one it can never name, and one
// it retypes is one it can mistype.
//
// The driver holds both sources. The rows are DERIVED from them and stamped in; what the model supplies
// is the part that is judgment and cannot be derived — `sufficient` and the `reason` for it.
//
// TWO SOURCES, ONE ROW SET:
//   · every coverage-ledger row that is NOT `confirmed-clean` — the slices the funnel itself says it did
//     not close. A confirmed-clean row needs no disclosure row; it IS the absence of one.
//   · every qid the plan-execution receipt lists MISSING — a planned query with no band block at all.
//     These have no ledger row of their own, and they are the  class exactly: the search that never
//     ran, which nothing downstream could see from the ledger alone.
//
// WHY A STAMP AND NOT A REFUSAL. A validator throw on model-authored rows would have to fire on the
// archive too: findings-model's own contract is that `coverage_judgment` stays "a deliberately-loose
// passthrough object (archived shapes must keep parsing forever)", and `replay-archive.mjs` republishes
// real matters through that parser. Version-gating the throw is not available either — the schema bump
// is one PR with one owner. And a refusal buys a paid corrective turn to delete a key the driver is
// about to overwrite anyway. So the field simply stops being the model's: authored rows are replaced
// wholesale and the replacement is logged, the same posture `ask_answers` and the card's `- group:` line
// already take.
//
// ABSENT STAYS ABSENT. A run whose synthesis emitted no `coverage_judgment` at all does not get one
// invented here — `sufficient` is the lawyer's call and a fabricated one would clamp, or fail to clamp,
// a verdict on nobody's judgment. The absence is logged instead.
//
// RUNS AT THE POST-SYNTHESIS MUTATOR SEAM, for injectDeferralCoverage's stated reason: after every
// synthesis re-run has settled, so a re-emit cannot clobber it. Never-kill — any defect leaves
// findings.json untouched, and the ledger and receipt still reach the reader by their own surfaces.
// ONE SLICE, ONE ROW. The two sources overlap: an axis whose owner probe produced no band block gets a
// `deferred` LEDGER row saying so AND a MISSING qid saying the same thing, and `projectCoverageJudgment`
// concatenates rows into one internal line — so an un-joined row set reads the same fact twice in two
// vocabularies, which is precisely what the stage's own COVERAGE PROSE rule forbids ("state each
// coverage fact ONCE, in ONE place").
//
// THE JOIN IS THE RECEIPT'S OWN, never a guess off the qid string. `skeleton[].missing` is the
// code-derived axis→missing-qid map (deriveCoverageSkeleton groups by the plan entry's `axis`), and the
// qid prefix is NOT the axis — supplemental and cross-check entries carry `supp:` / `xcheck-` prefixes.
// A missing qid whose axis already owns an open ledger row is named ON that row; a missing qid on an
// axis with no open row still gets its own, because nothing else would disclose it.
//
// A receipt with no skeleton (an archived, pre-skeleton shape) has no axis map, so every missing qid
// gets its own row — the pre-join behaviour, which over-discloses rather than under-discloses.
// review — WHAT THE ROW CALLS ITS SLICE, on the one shape where the ledger's own identifier says
// less than it looks like it says.
//
// `rows[].area` used to be the lawyer's named slice, in the stage's LAWYER ENGLISH register. It is now
// driver-derived, which is the point of this build — but `projectCoverageJudgment` folds these rows
// into the coverage reason and render.mjs prints that in report.html, so whatever goes here is read by
// a client, not just by a gate.
//
// A ledger unit is built as `<axis> / <scope>` and collapses to the BARE AXIS when the row carries no
// scope (coverage-ledger.mjs: `unit: scope ? ... : axis`). On that shape the reader was handed a lone
// engine token — "transliteration-numeric" — with nothing saying whether it meant one slice of the axis
// or all of it. That is the one branch where the machine's exact identifier is less informative than
// what it replaced, so it is the only branch that changes: the scope is stated, in the row's own terms.
//
// NOT a token→prose lookup table. An axis→label map would be a second vocabulary to keep in step with
// REGISTER_AXES, and the qid/axis identifiers ride verbatim everywhere else in this file by design —
// they are what a reader matches back to the ledger. PURE.
// ONE ASSEMBLY, TWO SPELLINGS. `unitText` is what the caller wants printed; the SCOPE TEST is always
// against the raw unit, so the identifier and the label decorate identically and cannot drift apart.
// The scopeless decoration differs on purpose: "(entire axis)" names the machine's unit for a gate,
// "(all of it)" says the same thing to a reader who has no axes.
function coverageRowAreaFrom(axis, unit, unitText, scopeless) {
  const a = String(axis ?? "").trim();
  const u = String(unit ?? "").trim();
  if (!u) return a;
  if (!a) return unitText;
  return u.toLowerCase() === a.toLowerCase() ? `${unitText} ${scopeless}` : unitText;
}

export function coverageRowArea(axis, unit) {   // @internal
  return coverageRowAreaFrom(axis, unit, String(unit ?? "").trim(), "(entire axis)");
}

// — the reader's half of the same answer. `area` is the identifier a gate joins on and does not
// move; `areaLabel` is what the page prints. Emitted here, at the one place the area is minted, so
// nothing downstream has to recognise an axis token inside a string it was handed — which is the
// mechanism that ate the mark AXIS. null when the identifier is already plain English: three
// driver injectors write areas like "Follow-up / …", and a label repeating them would be noise.
export function coverageRowAreaLabel(axis, unit) {   // @internal
  const u = String(unit ?? "").trim();
  const labelled = coverageUnitLabel(u);
  if (!u || labelled === u) return null;
  return coverageRowAreaFrom(axis, unit, labelled, "(all of it)");
}

// A LAYER ROW NAMES EVERY REGISTER IT LEFT, FROM ITS RECEIPT. The machine ledger keeps a row's axis, status
// and reason, not its receipt, so the coverage form's layer row is found again by those three: the ledger is
// rendered from the form, and they are the form row's own. A match must be one form row to one ledger row; any
// other count leaves the row as it was. Its label is the territory's: the unit has no scope, so the axis's label
// would say the whole main sweep stood open.
const normReason = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
function layerRowNotes(ledgerRows, formRows) {
  const keyOf = (r) => `${String(r?.axis ?? "").trim().toLowerCase()}\u0000${String(r?.status ?? "").trim().toLowerCase()}\u0000${normReason(r?.reason)}`;
  const ledgerCount = new Map();
  for (const r of ledgerRows ?? []) ledgerCount.set(keyOf(r), (ledgerCount.get(keyOf(r)) ?? 0) + 1);
  const byKey = new Map();
  for (const f of (formRows ?? []).filter(isLayerRow)) {
    const k = keyOf(f);
    byKey.set(k, byKey.has(k) ? null : f);
  }
  const notes = new Map();
  for (const [k, f] of byKey) {
    if (!f || ledgerCount.get(k) !== 1) continue;
    const note = nationalRegistersNote(nationalRegistersNotSearched(f.receipt_reason));
    const territory = orderFormName(String(f.unit ?? "").split(" — ")[0]);
    if (note && territory) notes.set(k, { note, areaLabel: `${territory}: national registers` });
  }
  return { keyOf, notes };
}

// A COVERAGE RULING THE TOOL PARKED reaches the reader as open: the shipped words for a check left open, held once here.
// The search behind it stands as it was recorded; what was not completed is the unit's coverage judgment.
export const PARKED_JUDGMENT_NOTE = `not completed this run — ${plainDeferralReason("unfinished")}`;

export function coverageJudgmentRows(ledgerRows, planExecution, plan = null, formRows = null) {   // @internal
  const open = [];
  const layers = layerRowNotes(ledgerRows, formRows);
  for (const r of ledgerRows ?? []) {
    // `withheld-by-judgment` joins `confirmed-clean` in NOT reaching the reader, and for the opposite
    // reason. A clean row has nothing to disclose. A withheld one has something to say, and it is
    // ruled to belong in the run record and the coverage ledger only: nothing is added to the report
    // (owner, 2026-09-18). A family the reading turn chose not to open, having read the identical question as
    // a list and found what it needed, is not a gap in the client's search — it is where the work was
    // spent — and a row saying otherwise would read to a lawyer as an incomplete job.
    const status = String(r?.status ?? "").toLowerCase();
    if (!r || status === "confirmed-clean" || status === "withheld-by-judgment") continue;
    const reason = String(r.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    const axis = String(r.axis ?? "").toLowerCase();
    const layer = layers.notes.get(layers.keyOf(r));
    open.push({ axis, area: coverageRowArea(axis, r.unit),
      areaLabel: layer ? layer.areaLabel : coverageRowAreaLabel(axis, r.unit),
      note: `${r.status}${layer ? ` — ${layer.note}` : reason ? ` — ${reason}` : ""}`, qids: [] });
  }
  const skeleton = Array.isArray(planExecution?.skeleton) ? planExecution.skeleton : null;
  const axisOf = new Map();
  for (const s of skeleton ?? []) for (const q of s?.missing ?? []) axisOf.set(String(q), String(s.axis ?? "").toLowerCase());
  const claimed = new Set();
  for (const qid of Array.isArray(planExecution?.missing) ? planExecution.missing : []) {
    const q = String(qid ?? "").trim();
    if (!q) continue;
    const host = axisOf.has(q) ? open.find((o) => o.axis === axisOf.get(q)) : null;
    if (host) { host.qids.push(q); claimed.add(q); }
  }
  // A claimed qid is printed nowhere: the plan-execution receipt keeps it for every gate to join on, and a
  // row a lawyer reads names its slice, never an engine identifier (ruled 2026-10-01). One row per slice.
  const rows = open.map((o) => ({ area: o.area, ...(o.areaLabel ? { areaLabel: o.areaLabel } : {}),
    note: o.note }));
  // A ruling the coverage tool parked: the unit's coverage was never judged, so it is open, and never read as clean.
  for (const r of parkedCoverageRows(formRows ?? [])) {
    if (rowIsSettled(r, r)) continue;
    const axis = String(r.axis ?? "").toLowerCase();
    const areaLabel = coverageRowAreaLabel(axis, r.unit);
    rows.push({ area: coverageRowArea(axis, r.unit), ...(areaLabel ? { areaLabel } : {}), note: PARKED_JUDGMENT_NOTE });
  }
  for (const qid of Array.isArray(planExecution?.missing) ? planExecution.missing : []) {
    const q = String(qid ?? "").trim();
    if (q && !claimed.has(q)) rows.push({ area: q, ...orphanAreaLabel(q, axisOf.get(q), plan), note: "planned and not executed this run" });
  }
  return rows.filter((r) => r.area && r.note);
}

// A COVERAGE ROW THAT WAS NOT ADDED. Each adder below catches its own failure and the run goes on (ruled 2026-09-25:
// deliver, and flag in the audit what still failed), so the row it exists to add is missing from the report and
// the workbook. Its note is the run's own line; this event is what delivery reads (degraded-parts.mjs, coverageRows),
// so the audit workbook names the part. It never throws from the catch that calls it.
function coverageRowNotAdded(runDir, adder, e) {
  try { runLog(runDir, { event: "coverage-row-not-added", adder, fail: String(e?.message || e).replace(/\s+/g, " ").slice(0, 200) }); }
  catch { /* the note the caller wrote still stands */ }
}

export function stampCoverageJudgmentRows(P, runDir, note, ctx) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    const cj = doc?.coverage_judgment;
    if (!cj || typeof cj !== "object" || Array.isArray(cj)) {
      runLog(runDir, { event: "coverage-judgment-rows", judgment: false, reason: "synthesis emitted no coverage_judgment — none is invented here" });
      return;
    }
    const rows = coverageJudgmentRows(loadCoverageLedger(runDir).rows, readPlanExecution(ctx), ctx?.registerPlan ?? null,
      readCoverageForm(runDir).rows);
    const discarded = Array.isArray(cj.rows) ? cj.rows.length : 0;
    const next = { ...doc, coverage_judgment: { ...cj } };
    if (rows.length) next.coverage_judgment.rows = rows;
    else delete next.coverage_judgment.rows;
    // The row is written BEFORE the early return, deliberately: "the derived set already matched" and
    // "this never ran" are different facts, and a journal that records only the first of them cannot
    // tell a reader which one happened on a run where rows[] came out empty.
    const changed = JSON.stringify(next) !== JSON.stringify(doc);
    runLog(runDir, { event: "coverage-judgment-rows", judgment: true, rows: rows.length, discarded, changed });
    if (!changed) return;                                           // already exact — leave the bytes alone
    parseFindingsJson(JSON.stringify(next));                        // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, next, { why: "coverage-judgment-rows", settles: [] });
    note(`[coverage-judgment] rows[] written from the ledger + the plan-execution receipt: ${rows.length} open slice(s)${discarded ? `; ${discarded} authored row(s) replaced` : ""}`);
  } catch (e) {
    note(`[coverage-judgment] rows[] stamp skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "coverage-judgment", e);
  }
}

export function injectDeferralCoverage(P, runDir, note) {   // @internal — exported so a second pass is testable without a run
  try {
    const rp = paths(runDir).frameReopenReceipt;
    if (!existsSync(rp) || !existsSync(P.findings)) return;
    const receipt = JSON.parse(readFileSync(rp, "utf8"));
    const deferrals = receipt?.deferrals ?? [];
    if (!deferrals.length) return;
    const kinds = followUpKinds(receipt);   // the search each deferred directive recorded (follow-up-twins.mjs)
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    // T1 (G8): a findings.json without a coverage array must not silently LOSE the deferral
    // rows — the reader-visible disclosure is the whole point of "can't close → disclose".
    if (!Array.isArray(doc.coverage)) doc.coverage = [];
    const normTxt = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    // A row may stand in for this one only as the report page lets it (`dedupeFollowUps`, publish/render.mjs): the
    // driver's own row, or the writer's row restating the gap. A searched-clean row reports the opposite, and an
    // axis-labelled one ("Register / …") is a plan unit that may only share the words.
    const standsIn = (c) => String(c.area ?? "").startsWith("Follow-up / ")
      || (c.state !== "confirmed-clean" && !/\s\/\s/.test(String(c.area ?? "")));
    const wordsOf = (c) => new Set(normTxt(`${c.area} ${c.note ?? ""}`).split(" "));
    const rows = doc.coverage.filter(standsIn).map(wordsOf);
    let added = 0;
    for (const d of deferrals) {
      const directive = String(d?.directive ?? "").trim();
      if (!directive) continue;
      // THE WORDS ARE THE ONES A ROW CARRIES, AND ONE ROW CARRIES ALL OF THEM. A directive is minted with its axis prefix
      // ("source:…"), and every row, this function's own included, prints it through `plainDirective`. This looked
      // for the raw directive's first four long words as one phrase across the whole coverage: the prefix was the
      // first of them, and a short word between two others ("eu", "and") broke the phrase anyway, so no row matched,
      // not even the row this function had just added. Each seam pass added it again: twice over in a record, and
      // back after a save that removed it. Measured on two test runs, 2026-11-03: 9 of 9 directives carried the
      // prefix, and 4 of one run's 7 a short word between their long ones.
      const want = normTxt(plainDirective(directive)).split(" ").filter((w) => w.length >= 4).slice(0, 4);
      if (want.length && rows.some((ws) => want.every((w) => ws.has(w)))) continue;   // synthesis already weighed it in
      const row = deferralCoverageRow(directive, d?.reason);   // — word-boundary heading, full directive in the note
      // An axis-labelled row stands in only on the search the run recorded for this directive, as the page decides.
      if (axisTwin(plainDirective(directive), kindsForFollowUp(row, kinds), doc.coverage.filter((c) => !String(c.area ?? "").startsWith("Follow-up / ")))) continue;
      doc.coverage.push(row);
      rows.push(wordsOf(row));
      added++;
    }
    if (!added) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "deferral-coverage-rows", settles: [] });   // B5 — a crash mid-write must never leave a truncated findings.json
    note(`[frame-reopen] injected ${added} deferral coverage row(s) — the reader sees every unclosed directive`);
  } catch (e) {
    note(`[frame-reopen] coverage injection skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "frame-reopen", e);
  }
}
const WORLDWIDE_SCOPE_RE = /^(worldwide|global|all|all[- ]jurisdictions)$/i;
/** What a synthesis-authored Stage-1.5 coverage row looks like when it has ALREADY made this
 *  disclosure — see the suppression in injectScriptScopeCoverage. Both the current vocabulary and the
 *  retired one, because a resumed run carries whichever was current when its synthesis ran. */
const SCRIPT_SCOPE_RECOMMENDATION_TOKENS = Object.freeze(["native-language investigation", "clearance-jx"]);

/** The disclosure vocabulary for ONE candidate lane, derived (never tabulated). Returns
 *  `{area, note, territories, marker}` — `marker` is the lowercased script prefix the suppression
 *  check keys on. Null for a lane with no LANGUAGE_LANES spec or no territory routed to it. PURE. */
export function scriptScopeDisclosure(lane) {   // @internal
  const spec = LANGUAGE_LANES[lane];
  if (!spec) return null;
  const prefix = String(spec.label ?? "").replace(/\s*deepening\s*$/i, "").trim();   // "Chinese-script"
  const territories = Object.entries(JURISDICTION_ADAPTERS).filter(([, v]) => v?.lane === lane).map(([k]) => k);
  if (!prefix || !territories.length) return null;
  return {
    area: `${prefix} register equivalents (${territories.join(" / ")})`,
    note: `${prefix} same-meaning/phonetic register equivalents not searched on this search — ${NATIVE_LANGUAGE_REMEDY}`,
    territories, marker: prefix.toLowerCase(),
  };
}

/** Several script lanes' rows as one, in the approved words: the lanes' names and their territories joined, the
 *  sentence and the offer once. PURE. */
export function mergedScriptScopeRow(lanes, state = "coverage-limited") {   // @internal
  const parts = lanes.map((lane) => scriptScopeDisclosure(lane)).filter(Boolean);
  const names = parts.map((d) => d.area.replace(/\s*register equivalents\s*\(.*\)$/, ""));
  const joined = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    area: `${joined} register equivalents (${parts.flatMap((d) => d.territories).join(" / ")})`,
    state,
    note: `${joined} same-meaning/phonetic register equivalents not searched on this search — ${NATIVE_LANGUAGE_REMEDY}`,
  };
}

/** The pure decision: should the honesty row be injected, and what row. Exported for the unit tests.
 *  `scope` is the requested-territory list (jxScopeJurisdictions precedence: instructed wins, else
 *  profile defaults); the zh match is EXACTLY the codes decideJxLanes would have matched with the lane
 *  bought (the honest question is "would the zh lane have fired on this scope"), plus the worldwide shapes.
 *  `laneDepthOff`: customer config always wins (the golden rule) — a customer who configured
 *  jxPolicy.laneDepth.zh "off" has already declined the lane; re-advertising it on every report
 *  would nag against their own config. */
export function decideScriptScopeHonesty({ lane = "zh", scope = [], laneRan = false, laneDepthOff = false } = {}) {   // @internal
  if (laneRan || laneDepthOff) return null;
  const d = scriptScopeDisclosure(lane);
  if (!d) return null;
  const toks = (scope ?? []).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  // Matched on the LANE, not on mere table membership: JURISDICTION_ADAPTERS carries all three lanes,
  // and a Japan-only scope owes a Japanese-script row and NOT a Chinese-script one. That per-lane
  // filter was always the right shape — it was simply only ever asked about zh.
  const laneHit = toks.some((t) => JURISDICTION_ADAPTERS[t]?.lane === lane);
  const worldwide = toks.length === 0 || toks.some((t) => WORLDWIDE_SCOPE_RE.test(t));
  if (!laneHit && !worldwide) return null;
  return { area: d.area, state: "coverage-limited", note: d.note };
}

/** Did the zh candidate lane actually RUN on this run? Mirrors the jx-units gating legs exactly
 *  (jx-units.mjs runJxSerpGrid/runJxNativeread): the frozen policy must carry the jxLanes component
 *  (the product carries the native-language investigation, or a saved search bought it), at least one of
 *  the two unit switches must be on, and the frozen lane decision
 *  sidecar must carry the zh lane. Any leg missing ⇒ the lane did not run (a product without the
 *  investigation, or no lane in the frozen decision) — the honesty row is owed. Reads the SIDECAR rather than ctx.jxLanes: at delivery
 *  time on a resume the fold block may never have re-attached it, and the frozen decision on disk is
 *  the single authority anyway.
 *
 *  THIS IS NOT A GATE — it decides whether a CLIENT REPORT carries a row saying the Chinese lane was
 *  not searched, so both directions are a statement of fact and both can be wrong. When the
 *  CLEAROTRON_JX_LANES master leg was retired (2026-07-27) neither naive option was safe: deleting the env
 *  legs outright would report "ran" from a frozen lane DECISION alone, suppressing the disclosure on a
 *  run whose units never executed; keeping a leg on a variable nothing sets any more would read false
 *  forever and tell every client the lane did not run, including the runs where it did. So the legs
 *  track what the units themselves check, which is what "mirrors the jx-units gating legs" has to mean. */
export function scriptLaneRanOnRun(runDir, lane, { searchPolicy = null } = {}) {   // @internal
  if (!searchPolicy?.components?.jxLanes) return false;
  let sidecar = null;
  try { sidecar = JSON.parse(readFileSync(paths(runDir).jxLanes, "utf8")); }
  catch { return false; }   // sidecar absent/corrupt ⇒ no frozen lane decision ⇒ the lane did not run
  if (!sidecar?.lanes?.[lane]) return false;
  // WHAT "RAN" MEANS IS PER-LANE, and this is a rule table rather than a parameter because the lanes
  // genuinely shipped with different units — pretending one predicate covers all three would be the
  // kind of false generalisation that reads correct and answers wrong.
  //   zh  — shipped the full Phase-4 deepening: the SERP platform grid and the native read. Either
  //         unit running IS the lane running (they gate independently; one on and one off still
  //         searched in Chinese), so the legs stay exactly as they were.
  //   ja/ko — shipped as slice-1 CANDIDATE lanes only (LANGUAGE_LANES declared in jx-lanes.mjs): no SERP_LANES entry, so
  //         runJxSerpGrid hard-refuses them and neither unit flag can ever describe them. The only
  //         work these lanes do is the candidate fold, so "ran" is the fold having ACCEPTED
  //         candidates — a frozen lane decision with an empty fold searched nothing and owes the row.
  if (lane === "zh") {
    // item 8 — the two env legs are gone, and this is the replacement the comment above demands
    // rather than the naive option it warns against. Deleting them outright WOULD have reported "ran"
    // from the frozen lane decision alone. So the legs move from what was CONFIGURED to what HAPPENED:
    // a unit record stating done. That is the same shape the ja/ko branch below already uses (a fold
    // with accepted candidates), and it is strictly better evidence than an environment variable —
    // a box with the arm set and the unit never dispatched used to read "ran".
    let units = null;
    try { units = JSON.parse(readFileSync(driverDir(runDir, "jx", "units.json"), "utf8")); }
    catch { return false; }   // no unit record ⇒ nothing establishes that either unit ran
    const done = (k) => units?.units?.[k]?.done === true;
    return done("serp-grid:zh") || done("nativeread:zh");
  }
  return (sidecar?.fold?.lanes?.[lane]?.accepted ?? []).length > 0;
}

/** The sibling of injectDeferralCoverage: same call point, same never-kill + re-validate + atomic-write
 *  discipline, same "the reader always gets the row" purpose. Idempotent on resume: the row is keyed
 *  by its area, and a coverage row that already discloses the Stage-1.5 recommendation (a synthesis
 *  that weighed it in on a re-run) suppresses the injection rather than duplicating it. */
export function injectScriptScopeCoverage(P, runDir, note, { searchPolicy = null, job = null, profile = null, env = process.env, lanes = Object.keys(LANGUAGE_LANES), localLanguage = null } = {}) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    // A WORLDWIDE ORDER IS SEARCHED WORLDWIDE, and its native-script rows are owed on that scope. The lane scope below falls
    // back to the account's default territories when an order names none, which is right for the paid lanes it chooses and
    // wrong here: a worldwide order under an account whose defaults hold no Chinese, Japanese or Korean territory wrote no
    // native-script row at all, and its report said nothing of a search it never ran. The account's defaults are the
    // customer's priorities, never the order's scope (ruled 2026-09-26, effective-scope.mjs).
    const scope = job?.geography?.mode === "worldwide" ? [] : jxScopeJurisdictions(job ?? {}, profile ?? {});
    const pending = [];
    // AN INVESTIGATION THE CLIENT ORDERED IS NEVER OFFERED BACK TO THEM (ruled 2026-09-25). The row below
    // says where the native-language investigation can be bought, which is true of a search that did not
    // include it and false of one that did: there, a lane that did not run is a part of the order that
    // failed. So on an ordered investigation no offer is made, and one that ran no lane at all carries the
    // audit's own row for that part, word for word, so the page and the workbook say the same thing.
    const ordered = Boolean(searchPolicy?.components?.jxLanes);
    if (ordered && localLanguage === "not-run") {
      pending.push({ lane: "native-language", row: deferralCoverageRow(PART_NAMES.localLanguage, NOT_COMPLETED), marker: null });
    }
    for (const lane of ordered ? [] : lanes) {
      const d = scriptScopeDisclosure(lane);
      const row = d && decideScriptScopeHonesty({
        lane, scope,
        laneRan: scriptLaneRanOnRun(runDir, lane, { searchPolicy, env }),
        laneDepthOff: profile?.jxPolicy?.laneDepth?.[lane] === "off",
      });
      if (row) pending.push({ lane, row, marker: d.marker });
    }
    if (!pending.length) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.coverage)) doc.coverage = [];   // T1 (G8) posture: never silently lose the disclosure
    const rowText = (c) => `${c?.area ?? ""} ${c?.note ?? ""}`.toLowerCase();
    const added = [], owed = [];
    for (const p of pending) {
      // Suppression is PER LANE. The old check treated any coverage row mentioning "clearance-jx" as
      // covering the disclosure, which was harmless while zh was the only lane and is a silent row-
      // eater the moment there are two: on a CN+JP scope the zh row lands first, its own note ended in
      // "(clearance-jx)", and the ja row was then swallowed by a match on the sibling's text. So the
      // deference to a synthesis-authored Stage-1.5 row requires the row to be about THIS lane.
      //
      // TWO VOCABULARIES ON PURPOSE. `native-language investigation` is what the offering calls it now
      // and what synthesis reads in its own prompt; `clearance-jx` is the retired key, kept because a run
      // RESUMED from before carries a synthesis row written in it — dropping the old token would
      // put a second, duplicate disclosure into a report that already makes the same one.
      const already = doc.coverage.some((c) => {
        const t = rowText(c);
        return t.includes(p.row.area.toLowerCase())
          || (p.marker != null && t.includes(p.marker) && SCRIPT_SCOPE_RECOMMENDATION_TOKENS.some((tok) => t.includes(tok)));
      });
      if (already) continue;
      owed.push(p);
    }
    // THE SCRIPT ROWS ARE ONE ROW (owner, 2026-11-18). A worldwide order owed a row per script lane, each ending
    // in the same offer, so "Left open" said it three times. The lanes still owed a row are now one row: their
    // names and territories joined, the same approved sentence once. One lane writes the row it always wrote.
    // The merged row carries every lane's marker and the offer's own words, so the per-lane check above finds
    // it on a second pass and writes nothing more.
    const scriptRows = owed.filter((p) => p.marker != null);
    const rows = [...owed.filter((p) => p.marker == null).map((p) => p.row),
      ...(scriptRows.length > 1 ? [mergedScriptScopeRow(scriptRows.map((p) => p.lane), scriptRows[0].row.state)] : scriptRows.map((p) => p.row))];
    doc.coverage.push(...rows);
    added.push(...owed.map((p) => p.lane));
    if (!added.length) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "script-scope-coverage-row", settles: [] });   // B5 — never a truncated findings.json
    note(`[script-scope] injected the Stage-1.5 honesty coverage row for ${added.join(", ")} — in-scope territory on a run whose ${added.length === 1 ? "lane" : "lanes"} did not run (coverage-limited: a disclosed limit, never a verdict clamp)`);
  } catch (e) {
    note(`[script-scope] coverage injection skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "script-scope", e);
  }
}

/**
 * The native-language state, read the way publishing reads it: `not-run`, `ran-shallow`, `ran` or
 * `not-in-scope`, or null for a run with no lane record. One reader for the page's row and the audit's
 * part, so the two cannot disagree about whether the investigation ran. The lanes' record needs jx.mjs,
 * which a plain clearance never imports.
 */
export async function localLanguageStateOf(runDir) {   // @internal
  if (!existsSync(paths(runDir).jxLanes)) return null;
  const { laneDepthOfRun } = await import("./jx.mjs");
  const { localLanguageDepth } = await import("./publish/search-depth.mjs");
  const read = (f) => { try { return JSON.parse(readFileSync(driverDir(runDir, f), "utf8")); } catch { return null; } };
  return localLanguageDepth(laneDepthOfRun({ sidecar: read("jx-lanes.json"), units: read("jx/units.json") })).state;
}

/** — THE READER-VISIBLE HALF OF THE DEPTH FLAG. The sibling above states a lane that did not run
 *  AT ALL; this one states a lane that ran and did not reach the depth the customer's config asked for.
 *  They are different facts and a reader owed one is not owed the other: `injectScriptScopeCoverage`
 *  returns nothing the moment `laneRan` is true, so a `full`-configured lane that ran candidates only
 *  fell through every disclosure this pipeline had.
 *
 *  RULING (2026-08-17), and it decides the shape rather than just authorising the work: "if we
 *  can't run deep dive on serpAPI we need to flag it" — FLAG, NOT GATE. So nothing here changes what a
 *  run executes or what it retrieves; it changes what the delivered document admits. `coverage-limited`
 *  is the state for exactly that: a disclosed limit, never a verdict clamp.
 *
 *  READS THE RUN'S OWN VERDICT and never re-derives it. `stateJxSlices` mints `fold.depth` at delivery
 *  from the environment the run actually had; deriving it here would answer for the box doing the
 *  injection. Absent verdict ⇒ no row: this writer states a shortfall it can prove, and an artifact that
 *  never stated one is not evidence of a shortfall (the reverse of the zero-means-pass error — a silence
 *  must not manufacture a disclosure either).
 *
 *  Same posture as its two siblings: never-kill, re-validate, atomic write, idempotent by area. */
export function injectLaneDepthCoverage(P, runDir, note) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    let sidecar = null;
    try { sidecar = JSON.parse(readFileSync(paths(runDir).jxLanes, "utf8")); }
    catch { return; }   // no lane on this run, or no frozen decision — nothing to disclose
    const verdicts = sidecar?.fold?.depth;
    if (!verdicts || typeof verdicts !== "object") return;
    const owed = Object.entries(verdicts).filter(([, v]) => v && v.shortfall === true);
    if (!owed.length) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.coverage)) doc.coverage = [];   // T1 (G8) posture: never silently lose the disclosure
    const added = [];
    for (const [lane, v] of owed) {
      const label = LANGUAGE_LANES[lane]?.label ?? `${lane} lane`;
      // A LANE THIS VERSION HAS NO DEEPER SEARCH FOR, WHOSE CANDIDATES RAN, IS TOLD IN THE OWNER'S TWO SENTENCES ALONE.
      // `jx.mjs` writes them as this cause's `why`, and the reader gets them as they are, under a label in words: no
      // opening that restates them in the code's terms, and no closing line about verdicts, which belongs to the run's
      // own coverage judgment. Every other cause keeps the fuller note below.
      // A depth the record cannot confirm, and a full ask that ran candidates only, are said the same way, each in the
      // owner's sentence (2026-11-18).
      const plain = (v.cause === "not-built-for-lane" && v.ran === "candidates" || v.cause === "not-established"
        || v.cause === "requested-full-ran-candidates") && typeof v.why === "string" && v.why;
      const language = String(LANGUAGE_LANES[lane]?.label ?? "").replace(/-script deepening$/, "") || lane;   // as jx.mjs names it
      const area = plain ? `${language}-language search depth` : `Native-language investigation depth / ${lane}`;
      const areas = [area, `Native-language investigation depth / ${lane}`, `${language}-language search depth`].map((a) => a.toLowerCase());
      if (doc.coverage.some((c) => areas.includes(String(c?.area ?? "").toLowerCase()))) continue;
      if (plain) {
        doc.coverage.push({ area, state: "coverage-limited", note: v.why.trim() });
        added.push(lane);
        continue;
      }
      // THE SENTENCE NAMES THE ASK, WHAT RAN, AND THE REMEDY — and the remedy differs by cause, which
      // is why the verdict carries one. "This build has no deep slice for the lane" and "the switch was
      // off on this deployment" produce the same shortfall and opposite next steps, and a row that said
      // only "did not reach full depth" would leave the reader unable to tell which.
      const ran = v.ran === "candidates" ? "the candidate lane only"
        : v.ran === "full" ? "full depth"                       // unreachable while shortfall is true; stated rather than assumed
        : "a depth this run's record cannot establish";
      doc.coverage.push({ area, state: "coverage-limited",
        note: `${label}: the configured depth for this lane was \`full\` and this run delivered ${ran}. `
          + `${v.why ?? "no reason recorded"} This is a disclosed limit on what was searched, not a change to any `
          + `verdict below — the lane's results stand for what it did cover.` });
      added.push(lane);
    }
    if (!added.length) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "lane-depth-coverage-row", settles: [] });   // B5 — never a truncated findings.json
    note(`[lane-depth] injected the depth-shortfall coverage row for ${added.join(", ")} — configured full, delivered less (coverage-limited: a disclosed limit, never a verdict clamp)`);
  } catch (e) {
    note(`[lane-depth] coverage injection skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "lane-depth", e);
  }
}

/** The reader-visible half of the same disclosure: one coverage row PER unresolved mark, the
 *  injectDeferralCoverage / injectZhScopeCoverage posture verbatim (never-kill, re-validate,
 *  atomic-write). NOTE the CONDITIONAL clamp does NOT come from these rows — `coverage-limited` never
 *  clamps (decideRegisterGap clamps on `deferred` rows only); the clamp is applyCoverageFloor's
 *  screenGateGap arm reading the same ctx/sidecar set. This function only makes that disclosure
 *  legible on the report. Idempotent by mark+uri (the area string carries both), so a resume or a
 *  second injection pass never duplicates a row. Exported for the unit tests. */
export function injectScreenGateCoverage(P, runDir, note, ctx = {}) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    const unresolved = loadScreenGateUnresolved(runDir, ctx);
    if (!unresolved.length) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.coverage)) doc.coverage = [];   // T1 (G8) posture: never silently lose the disclosure
    let added = 0;
    for (const g of unresolved) {
      const area = `Unexamined drop / ${g.mark}${g.uri ? ` (${g.uri})` : ""}`;
      if (doc.coverage.some((c) => String(c?.area ?? "") === area)) continue;   // already disclosed (resume / re-entry)
      doc.coverage.push({ area, state: "coverage-limited",
        note: `${g.mark}: official register record could not be retrieved (${g.cause}) — dropped on goods, could not be examined; verify this record before relying` });
      added++;
    }
    if (!added) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "screen-gate-coverage-rows", settles: [] });   // B5 — never a truncated findings.json
    note(`[screen-gate] injected ${added} unexamined-drop coverage row(s) — the reader sees every mark the run could not examine`);
  } catch (e) {
    note(`[screen-gate] coverage injection skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "screen-gate", e);
  }
}

// THE MARKETS AN ORDER IS FOR, as the register's reach is read against them: a worldwide order's are the client's
// markets (the account's default markets, else the major markets, plus any market the order names), and a territorial
// order's are its own. Read from the run's frozen order and profile. Never throws: an order it cannot read has no
// markets here, and the coverage line and the rows then say what they said before.
export function orderMarketsOf(ctx, plan) {   // @internal
  try {
    const order = instructedOrder(ctx.paths, ctx.job);
    return plan?.scope_basis === "worldwide" ? clientMarkets(order, ctx.profile) : orderTerritories(order, ctx.profile);
  } catch { return []; }
}

/** EVERY MARKET THE REGISTER SERVICE DOES NOT REACH GETS A "NOT SEARCHED" ROW, WRITTEN BY CODE (owner, 2026-11-18).
 *  Whether such a market was named used to depend on what the writer chose to write: on three deliveries of one
 *  order, one named Japan alone, and Vietnam was named on none. The reach is register-reach.mjs's, the same answer the
 *  coverage line names, so the row and the line cannot disagree. The area is the country's name and the reason is the
 *  approved one. A row the writer added for the same market stays beside it. Idempotent by area and reason, so a resume
 *  or a second pass never doubles a row; never-kill, as its siblings. */
export function injectUncoveredMarketCoverage(P, runDir, note, ctx = {}) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    let plan = ctx.registerPlan ?? null;
    if (!plan) { try { plan = JSON.parse(readFileSync(P.registerPlan, "utf8")); } catch { return; } }
    const reach = registerReach(plan?.provider, orderMarketsOf(ctx, plan));
    if (!reach?.uncovered.length) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.coverage)) doc.coverage = [];
    let added = 0;
    for (const code of reach.uncovered) {
      const area = regionName(code);
      if (doc.coverage.some((c) => String(c?.area ?? "") === area && String(c?.note ?? "") === NOT_COVERED_REASON)) continue;
      doc.coverage.push({ area, state: "not-searched", note: NOT_COVERED_REASON });
      added++;
    }
    if (!added) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "uncovered-market-rows", settles: [] });
    runLog(runDir, { event: "uncovered-market-rows", service: reach.service, offices: reach.offices, markets: reach.uncovered, added });
    note(`[register-reach] ${added} "Not searched" row(s) for market(s) outside ${reach.service}'s ${reach.offices} offices: ${reach.uncovered.join(", ")}`);
  } catch (e) {
    note(`[register-reach] coverage rows skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "register-reach", e);
  }
}

// THE SEAM'S FOLD. From here on every accepted save folds the record again on acceptance, so the record
// the reviewer, the cards and the delivery read stays folded (record-fold.mjs, design 2026-10-03). doc 50 —
// on a v4 record the merge base is the WORST BAND by the frozen manifest's order. No duplicates leave the
// file byte-identical; a folded shape that does not validate keeps the record as written.
export function consolidateFindingsFile(P, note, manifest = null) {
  const { merges, error } = foldFindingsFile(P.runDir, P.findings, manifest, { seam: true });
  for (const m of merges)
    note(`[consolidate] ${m.owner} — ${m.mark}: folded ${m.dropped.length} duplicate filing(s) (ord ${m.dropped.join(", ")}) into one card`);
  if (error) note(`[consolidate] skipped: ${error.slice(0, 100)}`);
}
// minor (a): a finding earns a FULL prose card when composite ≥ 3 (on-field) OR level ∈ {A,B} (high legal
// exposure even at a low practical composite — a mis-rated-low mark must not be reduced to a structured-only row).
export function fullProseOrdinals(findings) {
  return (findings ?? [])
    .filter((f) => f.disposition !== "withdrawn")   // A1: a review-killed finding gets no card call
    // doc 50: every band-rated finding gets a full-prose card (off-field awareness renders structured-only);
    // the composite/level line is the archived-run legacy path.
    .filter((f) => f.band != null || (Number(f.composite) || 0) >= 3 || ["A", "B"].includes(String(f.level || "").toUpperCase()))
    .map((f) => f.ordinal)
    .filter((o) => o != null);
}

// ── A MEANING SEARCH THAT DID NOT COMPLETE REACHES THE CLIENT'S OWN PAGE, NOT ONLY THE AUDIT ────────────
//
// The connotation gate delivers a run whose dictated meaning searches did not all complete, and records
// each unfinished one as a gap carrying its term — a gap the engine wrote for a search that never came
// back, or the provider's own row for one it refused. The audit read those gaps; the report was never
// handed the grid, so whether a client learned a meaning search was missing was up to the synthesis
// model. This puts each on the coverage the report renders, the way an unclosed follow-up already is:
// the same row, `deferralCoverageRow`, and an approved reader sentence that says it is left open — true
// of a drop and of a refusal alike. Telling the two apart on the page
// would need a sentence nobody has approved, and is not attempted here.
//
// The same guard as `injectDeferralCoverage`: a gap synthesis already weighed in is not added twice, and
// a findings.json that fails its own schema after the push is left as it was.
// THE WORDS ARE CHOSEN, NOT THE CAUSE: of the approved reasons, "nothing in the run's own record confirms it
// was searched" is true of a search that never came back AND of one the provider refused, and does not
// repeat the row's own "not completed this run" the way the generic fallback does. It borrows that arm's
// sentence only; if the arm is ever reworded for its own case, re-read this row against it.
const MEANING_SEARCH_UNFINISHED = "not-verified-closed";
export function injectMeaningGapCoverage(P, runDir, note) {   // @internal — exported so the refusal shape is testable without a run
  try {
    if (!existsSync(P.commonLawGrid) || !existsSync(P.findings)) return;
    const grid = JSON.parse(readFileSync(P.commonLawGrid, "utf8"));
    const terms = [...new Set((Array.isArray(grid?.gaps) ? grid.gaps : [])
      .filter((g) => String(g?.platform ?? "").toLowerCase() === "connotation")
      .map((g) => String(g?.term ?? "").trim()).filter(Boolean))];
    if (!terms.length) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.coverage)) doc.coverage = [];
    const normTxt = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const covText = normTxt(doc.coverage.map((c) => `${c.area} ${c.note ?? ""}`).join(" "));
    let added = 0;
    for (const term of terms) {
      const slice = normTxt(term).split(" ").filter((w) => w.length >= 4).slice(0, 4).join(" ");
      if (slice && covText.includes(slice)) continue;          // synthesis already weighed it in
      doc.coverage.push(deferralCoverageRow(term, MEANING_SEARCH_UNFINISHED));
      added++;
    }
    if (!added) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "meaning-gap-coverage-rows", settles: [] });
    note(`[common-law] ${added} meaning search(es) that did not complete now reach the report's coverage`);
    runLog(runDir, { event: "meaning-gap-coverage", added });
  } catch (e) {
    note(`[common-law] meaning-gap coverage skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "meaning-gap", e);
  }
}

/**
 * The reader's name for a planned search that never ran and that no open ledger row on its axis claims —
 * the orphan row of `coverageJudgmentRows`. Its area is the plan's qid, which a lawyer cannot read; the
 * label is composed the way the workbook's released-family rows compose theirs (publish/index.mjs
 * releasedFamilyRows): the plan entry's unit in the coverage form's grammar, its axis head in the reader's
 * words. `{}` when the frozen plan does not carry the entry, so the row keeps the identifier and nothing is
 * invented in its place. PURE.
 */
function orphanAreaLabel(qid, axis, plan) {
  const entry = (Array.isArray(plan?.entries) ? plan.entries : []).find((e) => e?.qid === qid);
  if (!entry) return {};
  const label = coverageUnitLabel(unitLabel(axis || entry.axis, entry));
  return label && label !== qid ? { areaLabel: label } : {};
}

/**
 * THE WRITE-UPS A RECORD OWES, PLANNED IN ONE PLACE. PURE.
 *
 * §9: a finding owed prose earns a full card where its form is `full`, and the rest render code-side, as a short
 * entry or as a line in the grouped section (§8). The first assembly made this plan inline, and the delivery check's
 * repair, which reassembles the report after a synthesis save has moved the record, made its own: every finding owed
 * prose and no grouped section. So a report reassembled on a graded product lost its "Also on the register" section,
 * where its grouped findings are read by territory or by right, each short entry kept the text composed before the
 * save, and the cards a run owed stayed the ones the first plan named whatever the record became. One plan, made here
 * from the record as it stands, now serves the first build, the delivery path and every reassembly.
 *
 * The floor tier joins on `mark_text` (floorTierByMark); an absent band shape yields an empty map, and every finding
 * then reads as holding no floor. On one country every form is `full`, so the plan is `fullProseOrdinals` itself.
 */
export function planWriteUps(findings, depth, bandShape) {   // @internal
  const floorTiers = floorTierByMark(bandShape);
  const formOf = (f) => writeUpForm(depth, f, { floorTier: floorTiers.get(floorMarkKey(f?.mark)) ?? null });
  const byOrdinal = new Map((findings ?? []).filter((f) => f?.ordinal != null).map((f) => [f.ordinal, f]));
  const proseOrdinals = fullProseOrdinals(findings);
  const cardOrdinals = proseOrdinals.filter((ord) => formOf(byOrdinal.get(ord)) === "full");
  const entryOrdinals = proseOrdinals.filter((ord) => formOf(byOrdinal.get(ord)) !== "full");
  const entryFindings = entryOrdinals.map((ord) => byOrdinal.get(ord)).filter(Boolean);
  // Worldwide groups by the right, multi-country by territory: the depth row's prose rung says which.
  const byRight = String(depth?.narrativeProse ?? "") === "adversarial";
  const { groups, singles: entrySingles } = groupEntries(entryFindings, { byRight });
  return {
    cardOrdinals, entryOrdinals, entryFindings, byRight, entrySingles,
    // Assembly sees full cards AND short entries; a grouped finding is a line in its section, never a card.
    assembledOrdinals: [...cardOrdinals, ...entrySingles.map((f) => f.ordinal)],
    groupedMembers: groups.flatMap((g) => g.findings),
  };
}

/** Each short entry's card file, composed by code from its finding as it stands. No model turn. */
export function writeShortEntries(P, entrySingles) {
  for (const f of entrySingles) {
    try { writeFileSync(P.reportCard(String(f.ordinal)), `${shortEntryBody(f)}\n`); }
    catch (e) { note(`short entry ${f.ordinal} not written (${String(e?.message ?? e).slice(0, 80)}) — it renders structured-only, as an absent card always has`); }
  }
}

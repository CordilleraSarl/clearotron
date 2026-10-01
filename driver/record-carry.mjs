// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// record-carry.mjs — the RETRIEVAL→FINDINGS trace for the register path: every record the run
// retrieved either becomes a finding, or carries a recorded reason it did not, PER RECORD, joinable
// back to the retrieval by canonical `/mark` uri.
//
// THE DEFECT. R1 PROJECT SABLE (2026-08-04, codename stripped) retrieved the jx lane's own target — the
// Chinese token 澜珀 — ten times: ten exact-match CN registrations, four REGISTERED, three in the
// matter's own class 9. All ten sit in `_driver/register-positions.json` and in
// `register-named-band.json`, all ten screened `surface:in-scope-live`, and not one of them appears in
// `placements.json` or in `findings.json`. The delivered report never names the token. The record was
// retrieved, screened and banded, and then it was gone, and NOTHING anywhere recorded why. The same
// shape had already been paid for four times (WAVO TWIST / WAVO TROPICS on R3, KORPHIC / HALVER KORPHI
// on R2). A capability that retrieves and cannot deliver is indistinguishable, in the report, from one
// that was never built — and the two have completely different fixes.
//
// WHERE THE SEAMS ARE NOW. Step 3 judges the pile by owner and records the fate of every owner, and
// with it of every record (`_driver/record-discard.jsonl`, the judgment seam): carried, set aside with
// the judges' reason, or never put in front of a judge. This module joins that record to the band on one
// side and to the delivered findings on the other, so a record the judges carried and the report never
// names is a row with its own reason, and never a gap.
//
// WHY THE JOIN IS URI-ONLY. The house text matcher is structurally blind to Han script —
// `normalizeJoinText("澜珀")` is the EMPTY STRING (it folds every non-[A-Za-z0-9] run to a space), so
// `hasToken` cannot match it and `distinct` puts it below the floor. A mark-token join would therefore
// have reported the one record class this issue exists for as unjoinable. Every join here is on the
// canonical `/mark` uri, which is script-neutral by construction, and every artifact on the register
// path carries one: band records as `record_id`, the discard ledger as `uri`, findings as
// `owner.registrations[].uri`.
//
// WHAT THIS MODULE DOES NOT DO. It never changes what is retrieved and never keeps a record that would
// otherwise be dropped — improving recall by keeping more is out of scope and is the bug, not the fix.
// The funnel stays complete and undiscriminating and the judgment stays late; this only writes down
// where each record stopped and who stopped it. It never decides whether a drop was CORRECT — that is
// the reviewing lawyer's judgment. And it never gates: annotate, never gate. On the run that motivated
// it, a gate would have suppressed a report that shipped.
//
// PURE (no node imports) — the pipeline owns all IO, events and enforcement. Join primitives are
// IMPORTED, never re-implemented (a local copy of a matcher is how two matchers drift apart).

import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { DISCARD_SEAMS, ledgerEnding, ledgerSpoke } from "./record-discard.mjs";

// v2 — the trace is now the SECOND of two halves and says which basis it ran on. `basis`,
// `ledger` and every row's `authored_at` are new; `unreasoned` narrows from "no reason_source" to "no
// seam spoke about this record and it is not a finding", which is a stricter and checkable claim.
// A v1 artifact carries none of these fields; `scripts/record-carry-probe.mjs` reads both and says which.
// v3 — every untraceable-slice row carries `slice_class`: a refused slice is no longer
// indistinguishable from a slice the plan counted and chose not to fetch.
// v4 — `total_hits`/`untraced` may now be null (the register stated no total), `slice_class`
// gained `count-unavailable`, and totals carry `untraced_unknown_slices` so the hit sum states its own
// incompleteness instead of quietly counting an unmeasurable slice as zero.
export const RECORD_CARRY_SCHEMA_VERSION = 4;

/**
 * WHERE THIS TRACE'S ANSWERS CAME FROM. The ruling on turns on this distinction, so it is a field.
 *
 *   recorded       every ending was written by the step that made it, at the moment it made it
 *                  (`_driver/record-discard.jsonl`, half one). The only basis a fresh run may ship on.
 *   reconstructed  no ledger was present, so the endings are INFERRED by comparing artifacts after the
 *                  fact. This is what the shipped v1 trace did on every run, and inference is how a
 *                  clean run came to read as a total loss. Legitimate for a run archived before  and
 *                  for the probe; a fresh run reporting it is a defect, flagged by the predelivery lint.
 */
export const TRACE_BASES = ["recorded", "reconstructed"];

/** How far a record got. Ordered; index = distance travelled. */
export const REACH_STAGES = ["retrieved", "screened", "carried", "finding"];

/**
 * WHERE THE REASON WAS AUTHORED — the ruling's "weigh where the reason is authored", made a field so a
 * reader never has to infer it. Ordered weakest-last:
 *   step-structural  the step's OWN logic recorded the ground (a screen verdict, a stage that did not
 *                    complete). Preferred wherever the step already knows why.
 *   step-stated      a step wrote a ground naming this record (a Negative-results drop row).
 *   step-silent      the step completed and did not carry the record forward. The decision is
 *                    attested; the ground is not. NOT a defect — this is the shape of an
 *                    undiscriminating funnel with late judgment, and thousands of these are the
 *                    honest output, not a failure.
 *   absent           nothing attests anything. THE DEFECT the run reports.
 */
export const REASON_SOURCES = ["step-structural", "step-stated", "step-silent", "absent"];

/** The seam a record failed to cross. `null` when it became a finding. */
export const SEAMS = ["screen", "judgment", "synthesis"];

/**
 * WHAT THIS TRACE COVERS AND WHAT IT DOES NOT — carried IN THE ARTIFACT, not just in a PR body.
 *
 * A reader who opens `_driver/record-carry.json` and sees `unreasoned: 0` must be able to tell that
 * from "nothing was dropped anywhere in this run", and the difference is which paths were looked at.
 * An uninstrumented path that emits no rows reads as a clean one — that is the failure this codebase
 * keeps paying for, and it is exactly what this module exists to stop happening to a RECORD. So the
 * module says the same thing about itself: the run declares its own boundary, per run, in the same
 * file as the answer. Update this table when a path is instrumented, never silently widen the claim.
 */
export const TRACE_SCOPE = {
  instrumented: ["register: named band → step 3's owner decisions → findings.json"],
  uninstrumented: [
    { path: "common-law", reason: "common-law-grid.json → findings is not joined here; a candidate lost on that path emits NO row and this trace can say nothing about it either way" },
    { path: "case-law", reason: "case-law findings are not traced to a record at all" },
    { path: "serp/nativeread", reason: "reason: and write _driver/jx/zh-grid.json; nothing on them reaches this trace because it traces the register path only. Their carry is the common-law tracer's, because zh-grid.json carries the common-law cells[]+gaps[] shape and not a register band" },
    { path: "crowd remainder", reason: "count-only slices have no record bodies — enumerated per slice in untraceable_slices[], never per record" },
  ],
};

// ── — THE BOUNDARY DECLARES WHAT ACTUALLY RAN, NOT WHAT SOMEONE LAST REMEMBERED TO EDIT ─────────
//
// The table above ends "Update this table when a path is instrumented, never silently widen the claim."
// That is the right instruction and it was not followed: `commonlaw-carry.mjs` shipped, wired, and on
// an evidence run it produced a COMPLETE trace of the common-law path —
//
//     978 candidates traced · 58 reached findings · 920 dropped with a recorded ground · 2 unreasoned
//
// — while this file went on declaring that path uninstrumented. So the run's own artifact said no trace
// existed for a path that had a 978-row one sitting beside it, and a reader who trusted the declaration
// (correctly — it is there to be trusted) concluded that `withheld: 0` was proven for the register only.
//
// A STALE BOUNDARY IS WORSE THAN NO BOUNDARY. The whole point of declaring scope is that a reader can
// tell `unreasoned: 0` from "nobody looked" — and this failed in the direction that hides work, which is
// the only direction that also hides the 2 unreasoned drops the common-law trace DID find.
//
// So the declaration is derived from which sibling tracers actually produced a computable artifact on
// THIS run, exactly as the dictated set is read from the paths factory and the obligations are one
// calculation. A hand-kept list whose staleness is invisible is not a contract; it is a comment.
//
// UNCHANGED IN THE CONSERVATIVE DIRECTION: a path only moves to `instrumented` on positive evidence that
// its tracer ran and was computable. No sibling, an unreadable sibling, or `computable:false` all leave
// the path declared uninstrumented — the same fail-closed rule the rest of this module uses. PURE.
const SIBLING_PATHS = {
  "common-law": { path: "common-law", label: "common-law: grid cells+gaps → findings (commonlaw-carry.json, canonical-url + cell key)" },
  "jx-zh": { path: "serp/nativeread", label: "serp/nativeread: _driver/jx/zh-grid.json → findings (the common-law tracer; zh-grid carries the same cells[]+gaps[] shape)" },
};

/**
 * The scope block for one run.
 *
 * @param {Array<{slice?:string, computable?:boolean}>} siblings  the sibling carry artifacts this run
 *        produced (commonlaw-carry.mjs output). Absent/empty ⇒ the static table, unchanged.
 */
export function traceScopeFor(siblings = []) {
  const ran = new Set();
  for (const s of Array.isArray(siblings) ? siblings : []) {
    const key = String(s?.slice ?? "");
    if (s?.computable === true && SIBLING_PATHS[key]) ran.add(key);
  }
  if (!ran.size) return TRACE_SCOPE;
  const promoted = new Set([...ran].map((k) => SIBLING_PATHS[k].path));
  return {
    instrumented: [...TRACE_SCOPE.instrumented, ...[...ran].map((k) => SIBLING_PATHS[k].label)],
    uninstrumented: TRACE_SCOPE.uninstrumented.filter((u) => !promoted.has(u.path)),
  };
}

/** The judging stage that owns each seam — the stage whose non-completion makes the drop upstream. */
const SEAM_STAGE = { judgment: "owner-judgment", synthesis: "synthesis" };

// ── stage outcomes ────────────────────────────────────────────────────────────────────────────────
/**
 * Did each named stage COMPLETE on this run, read off the append-only run.jsonl spine.
 *
 * THE `skip` TRAP, and the reason this is not "did the last event succeed". On that run
 * placement-inquiry logged `ok:false` twice (code 137, hardWall, walls at 1861s/1800s then
 * 2760s/2700s) and then a resume logged
 * `{"event":"skip","stage":"placement-inquiry","output":{"present":true}}` — it skipped the stage
 * because a partial artifact written by a KILLED attempt was sitting on disk. Read as "the last event
 * was a benign skip", the stage looks fine and every record it failed to place gets attributed to
 * judgment. So the rule is positive and one-directional: a stage counts as completed ONLY if it has a
 * `stage` event with `ok:true` somewhere on this run. A `skip` with no prior `ok:true` is INCOMPLETE,
 * and `skipped_on_partial` records that that is what happened.
 *
 * Takes the run.jsonl TEXT (the pipeline owns the read). Torn trailing lines are ignored, never
 * thrown on — this is disclosure, and a half-written last line must not cost the whole trace. PURE.
 */
export function parseStageOutcomes(runLogText, stages = Object.values(SEAM_STAGE)) {
  const want = new Set(stages);
  const acc = {};
  for (const s of want) acc[s] = { stage: s, completed: false, failed: 0, attempts: 0, skipped_on_partial: 0, fails: [] };
  for (const ln of String(runLogText ?? "").split("\n")) {
    if (!ln.trim()) continue;
    let e; try { e = JSON.parse(ln); } catch { continue; }   // torn line
    // Step 3 runs as two judge sessions and one merge, and the merge's own row is the step's outcome: a
    // judge's session row says how that one session went, never whether the step reached its decisions.
    const judged = e?.event === "owner-judgment";
    if (!judged && e?.stage === "owner-judgment") continue;
    const s = judged ? "owner-judgment" : e?.stage;
    if (!want.has(s)) continue;
    const a = acc[s];
    if (e.event === "stage" || judged) {
      if (e.ok === true) a.completed = true;
      else if (e.ok === false) {
        a.failed++;
        // the driver logs ONE stage event per pass carrying its own retry count, so the number of
        // attempts burned is not the number of events — report both or the evidence understates it
        a.attempts += Number.isFinite(e.attempts) ? e.attempts : 1;
        if (e.fail) a.fails.push(String(e.fail));
      }
    } else if (e.event === "skip" && !a.completed) {
      // a skip BEFORE any success: the stage was skipped because an artifact was present, and the
      // only thing that wrote one was an attempt that died.
      a.skipped_on_partial++;
    }
  }
  for (const a of Object.values(acc)) a.evidence = stageEvidence(a);
  return acc;
}

function stageEvidence(a) {
  if (a.completed) return `run.jsonl carries a stage event with ok:true for ${a.stage}`;
  const bits = [];
  if (a.failed) bits.push(`${a.failed} failed pass(es) over ${a.attempts} attempt(s)${a.fails.length ? ` (${[...new Set(a.fails)].join(", ")})` : ""}`);
  if (a.skipped_on_partial) bits.push(`${a.skipped_on_partial} skip(s) on an artifact left by a killed attempt`);
  if (!bits.length) bits.push("no stage event at all");
  return `${a.stage} never logged ok:true — ${bits.join("; ")}`;
}

const completed = (outcomes, stage) => outcomes?.[stage]?.completed === true;

// ── the record index ──────────────────────────────────────────────────────────────────────────────

/** The canonical `/mark` uri a band record names, or "" when it names none. PURE. */
export function bandRecordUri(rec) {
  for (const v of [rec?.record_id, rec?.uri, rec?.screen?.uri, rec?.guid]) {
    const u = normalizeRecordUri(v);
    if (u) return u;
  }
  return "";
}

/**
 * The record screen's own verdict, ALIAS-TOLERANT BY DATA (recordOppositionEnd's rule in
 * registry-fidelity.mjs — band shapes differ by provider and by lane). Observed at
 * `rec.screen.screen_verdict` on the merged register band and at `rec.screen_verdict` on a
 * unit band block, and reading only the first silently classified every record of the second shape as
 * having no verdict at all. Returns "" when the record carries none. PURE.
 */
export function screenVerdict(rec) {
  for (const v of [rec?.screen?.screen_verdict, rec?.screen_verdict, rec?.screen?.verdict])
    if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

/** Every canonical `/mark` uri the delivered findings name, via `owner.registrations[].uri`. PURE. */
export function findingUris(findings) {
  const out = new Map();
  for (const f of Array.isArray(findings) ? findings : []) {
    for (const r of Array.isArray(f?.owner?.registrations) ? f.owner.registrations : []) {
      const u = normalizeRecordUri(r?.uri ?? r);
      if (u && !out.has(u)) out.set(u, { ordinal: f?.ordinal ?? null, mark: String(f?.mark ?? ""), disposition: String(f?.disposition ?? "") });
    }
  }
  return out;
}

// ── the per-record classification ─────────────────────────────────────────────────────────────────
/**
 * Classify ONE retrieved record. Returns `{reach, stopped_at, reason, reason_source, detail, ...}`.
 *
 * FIXED PRECEDENCE, and the order is the correctness condition of the whole module. Reach is decided
 * first (furthest wins), then the reason for the seam it did not cross — and within that,
 * `stage-incomplete` ALWAYS outranks `not-selected`. If "the judging step ran and did not pick it"
 * could swallow "the judging step never finished", a run whose step 3 failed would read as a run whose
 * judges dismissed everything, which is precisely the wrong answer. PURE.
 */
export function classifyRecord(rec, { findings, outcomes, ledger } = {}) {
  const uri = bandRecordUri(rec);
  const verdict = screenVerdict(rec);

  const found = uri ? findings?.get(uri) : null;
  if (found) {
    return { reach: "finding", stopped_at: null, reason: null, reason_source: null, authored_at: "delivered-findings",
      detail: `finding #${found.ordinal ?? "?"} ${found.mark}${found.disposition ? ` (${found.disposition})` : ""}` };
  }

  // HALF TWO. When a ledger exists, the ending is the one the STEP wrote when it made it, and this
  // function does not get to have an opinion about it. Everything below this block is the reconstruction
  // path — for a run whose ledger could not be written, and for the probe — never used when a step has
  // spoken.
  if (ledger?.present && uri) return classifyFromLedger(uri, verdict, ledger);

  return { ...classifyReconstructed(verdict, { outcomes }), authored_at: "reconstructed" };
}

/**
 * THE ENDING THE STEP ITSELF WROTE. No inference: the row's reason, source and detail are carried through
 * verbatim, because the whole point of half one is that the step held a fact nobody downstream can
 * rebuild.
 *
 * Three outcomes, and the third is the defect the ruling asks to be reported:
 *   a seam discarded it   → that seam's own row is the answer
 *   every seam carried it → it should be a finding and is not. `synthesis:carried-not-delivered`,
 *                           reason_source `absent`: the run's own ledger contradicts its own findings.
 *   no seam spoke         → nothing attests anything. The screen's verdict still counts (it authors onto
 *                           the band record at retrieval), and past that it is `absent`.
 * PURE.
 */
function classifyFromLedger(uri, verdict, ledger) {
  const end = ledgerEnding(ledger, uri);
  if (end) {
    return {
      reach: REACH_BEFORE_SEAM[end.seam] ?? "retrieved",
      stopped_at: end.seam, reason: end.reason ?? `${end.seam}:not-selected`,
      reason_source: end.reason_source ?? "step-silent",
      detail: end.detail ?? "",
      authored_at: `${end.stage ?? end.seam}${end.trigger ? `(${end.trigger})` : ""}${Number.isFinite(end.pass) ? ` pass ${end.pass}` : ""}`,
    };
  }
  if (ledgerSpoke(ledger, uri)) {
    return { reach: "carried", stopped_at: "synthesis", reason: "synthesis:carried-not-delivered",
      reason_source: "absent",
      detail: "every seam that spoke about this record recorded carrying it forward, and no delivered finding names it — the run's own ledger contradicts its own findings",
      authored_at: "record-discard.jsonl" };
  }
  if (/^drop:/i.test(verdict)) {
    return { reach: "retrieved", stopped_at: "screen", reason: `screen:${verdict.slice(5).toLowerCase() || "dropped"}`,
      reason_source: "step-structural", detail: `the in-line record screen returned "${verdict}"`,
      authored_at: "record-screen" };
  }
  return { reach: "retrieved", stopped_at: null, reason: null, reason_source: "absent",
    detail: `no seam recorded a verdict on this record and no delivered finding names it — it was retrieved into the band and then no step (${DISCARD_SEAMS.join(", ")}) wrote down what it did with it`,
    authored_at: null };
}

/** How far a record got when the seam it died at is known. */
const REACH_BEFORE_SEAM = { judgment: "screened", synthesis: "carried" };

/**
 * THE ENDING INFERRED WITHOUT A LEDGER — for a run whose ledger could not be written, and for the probe.
 * Without the ledger nothing says which owners the judges carried, so a record is either the screen's
 * drop or a drop at the judging seam, whose completion decides which of the two answers it is. Never
 * reached when a step has spoken. PURE.
 */
function classifyReconstructed(verdict, { outcomes } = {}) {
  if (/^drop:/i.test(verdict)) {
    return { reach: "retrieved", stopped_at: "screen", reason: `screen:${verdict.slice(5).toLowerCase() || "dropped"}`,
      reason_source: "step-structural", detail: `the in-line record screen returned "${verdict}"` };
  }
  // NO EXPLICIT VERDICT IS NOT A DEFECT. Presence in the enumerated band IS the screen's positive
  // outcome — the band is what the screen emits — so a record carrying no verdict string has still
  // been screened in, and its drop belongs to the NEXT seam.
  return seamDrop("judgment", outcomes, "screened",
    verdict
      ? `screened "${verdict}" and carried into the band, but no recorded decision of the judges names this record`
      : "carried into the enumerated band (which is the screen's own output) with no verdict string stamped on it, and no recorded decision of the judges names this record");
}

/** The two answers at a seam whose judging stage is a model stage: did that stage complete or not. */
function seamDrop(seam, outcomes, reach, what) {
  const stage = SEAM_STAGE[seam];
  const o = outcomes?.[stage];
  if (!completed(outcomes, stage)) {
    // the load-bearing claim goes FIRST: this detail is clipped for the artifact, and the one thing a
    // reader must not lose to a truncation is that nothing judged this record
    return { reach, stopped_at: seam, reason: `${seam}:stage-incomplete`, reason_source: "step-structural",
      detail: `UPSTREAM ABSENCE, NOT JUDGMENT — ${o?.evidence ?? `${stage} never logged ok:true`}, so nothing judged this record and its drop cannot be read as a decision about it` };
  }
  return { reach, stopped_at: seam, reason: `${seam}:not-selected`, reason_source: "step-silent",
    detail: `${what} — ${stage} completed, so the decision not to carry it was made; no ground for this record was recorded` };
}

// ── the artifact ──────────────────────────────────────────────────────────────────────────────────

const clip = (s, n = 300) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

/**
 * WHY a slice carries no record bodies — three answers, from the block's own stamps.
 *
 * A capability gap (`deferred`) and a provider error (`error`) both arrive as
 * `{state:"incomplete", total_hits:0, fetched:0}`, the same shape a sanctioned count-only crowd wears.
 * Only the stamps tell them apart, so only the stamps are read here. Order matters: `deferred` is
 * checked first because execute-plan.mjs writes it ALONGSIDE `error`, never instead of it, and the
 * capability gap is the more specific fact. PURE.
 */
export const SLICE_CLASSES = ["counted-not-fetched", "capability-gap", "provider-error", "count-unavailable"];

// — the fourth class. `counted-not-fetched` claimed the run HAS a count, which for a slice the
// register refused to size is the same false claim removed, wearing the new machine field. This
// one is distinct from the two refusals above: the slice DID run and may have returned records — it is
// the TOTAL that is unknown, so `fetched` is real here and only `total_hits` is absent.
const sliceClass = (c) => (c?.deferred === true ? "capability-gap"
  : c?.error === true ? "provider-error"
    : c?.total_hits == null ? "count-unavailable"
      : "counted-not-fetched");

/** The sentence for each class. Keyed by the CLASS, never re-derived from the block, so the machine
 *  field and the human field can never disagree about the same row. PURE. */
const SLICE_REASON = {
  "capability-gap": "NOT A COUNT — capability gap: the active provider cannot express this slice, so it was never run. "
    + "The 0 beside it is a placeholder the executor writes, not a measurement, and this slice is unsearched rather than empty.",
  "provider-error": "NOT A COUNT — the provider errored on this slice, so it was never answered. "
    + "The 0 beside it is a placeholder the executor writes, not a measurement, and this slice is unsearched rather than empty.",
  "counted-not-fetched": "count-only crowd descriptor: the run has a hit COUNT for this slice and no record bodies, "
    + "so no per-record carry can be computed for the unfetched remainder",
  "count-unavailable": "SIZE UNKNOWN — the register would not state a total for this slice, so how much went untraced "
    + "cannot be computed at all. Whatever was fetched is real; the remainder is unmeasured, not zero.",
};

/**
 * Slices for which NO per-record trace is possible, stated rather than left silent.
 *
 * A crowd descriptor is a hit COUNT the run never fetched records for, so those hits are not records
 * and can never appear in `rows` — and a trace that only reported the fetched ten 澜珀 records would
 * imply the run retrieved ten, when the plan also carries `exact 澜珀 [cl 9,28,41,42]` at 1,066 hits
 * with 215 fetched. An uninstrumented region that reads as "no drops" is the failure this whole issue
 * is about, so it gets a row saying so. Not made per-record on purpose: fetching them is a RECALL
 * change and out of scope. PURE.
 */
export function untraceableSlices({ crowds = [], planExecution = null } = {}) {
  const state = new Map();
  for (const e of Array.isArray(planExecution?.executed) ? planExecution.executed : []) {
    if (e?.qid) state.set(String(e.qid), String(e.state ?? ""));
  }
  const rows = [];
  for (const c of Array.isArray(crowds) ? crowds : []) {
    const qid = String(c?.qid ?? "");
    // — an unknown total stays unknown. `Number(null ?? 0) || 0` made it 0, and then
    // `Math.max(0, 0 - fetched)` made the untraced remainder 0 too: a slice of unmeasured size
    // reported as fully accounted for. UNKNOWN MINUS ANYTHING IS UNKNOWN.
    const hits = Number.isFinite(Number(c?.total_hits)) && c?.total_hits != null ? Number(c.total_hits) : null;
    const fetched = Number(c?.fetched ?? 0) || 0;
    const cls = sliceClass(c);
    rows.push({
      qid, query: String(c?.query ?? ""), total_hits: hits, fetched,
      untraced: hits == null ? null : Math.max(0, hits - fetched),
      plan_state: state.get(qid) ?? null,
      traceable: false,
      // — WHY THIS SLICE HAS NO RECORDS, not merely THAT it has none. This was one constant on
      // every row: on a real run, 23 rows, 1 distinct string. It named the count-only crowd — the
      // shape the plan asks for on purpose — and applied it unchanged to slices the provider REFUSED,
      // where its central clause ("the run has a hit COUNT for this slice") is simply false. A reader
      // counting untraceable slices got one population where there are three, and the refusals were
      // the ones that mattered.
      //
      // DERIVED FROM THE STAMPS, NEVER FROM THE PROSE. `error`/`deferred` are written by code
      // (providers/_shared/execute-plan.mjs) and now survive the band projection. The upstream
      // sentence stays verbatim in `detail` and is never pattern-matched: bucketing a slice by
      // regexing a vendor's message is a detector over prose, and it breaks the first time a provider
      // rewords an error.
      // AD-4 — ON EVERY ROW, differing by VALUE and never by presence, so a reader counting
      // refusals never has to ask whether an absent field means "not a refusal" or "an older artifact".
      // This is also the issue's own ask in machine form: the record stating, per slice and
      // mechanically, WHY attribution is impossible for it. `reason` is the same fact in a sentence.
      slice_class: cls,
      reason: SLICE_REASON[cls],
      detail: clip(c?.reason ?? ""),
    });
  }
  // — UNKNOWN SORTS FIRST. `b.untraced - a.untraced` with a null reads as 0, so slices of
  // unmeasured size sorted to the bottom with the empties — the least visible rows being the ones
  // nothing can be said about. A row whose remainder cannot be computed outranks any row whose can.
  rows.sort((a, b) => (a.untraced == null ? 0 : 1) - (b.untraced == null ? 0 : 1)
    || (b.untraced ?? 0) - (a.untraced ?? 0) || a.qid.localeCompare(b.qid));
  return rows;
}

/**
 * THE TRACE. One row per retrieved register record, plus the untraceable-slice rows.
 *
 * `bandRecords` = register-named-band.json `.enumerated`; `findings` = findings.json `.findings`; `outcomes` =
 * parseStageOutcomes(run.jsonl); `ledger` = foldDiscardLedger(record-discard.jsonl). Deterministic; no
 * timestamps (the caller stamps `ts`), no IO, no judgment about whether any drop was right. PURE.
 *
 * — THE CALLER MUST RUN THIS AFTER `findings.json` EXISTS. That is not a convention: an earlier
 * version ran inside step 3, which is before `synthesis` authors that file, so `findings` was
 * `[]` and every record that became a finding was reported as dropped. Nothing here can detect that
 * mistake from the inside — an empty findings list is indistinguishable from a run that found nothing —
 * so the ordering is the caller's obligation, and `deriveRecordCarry`'s call sites are the enforcement.
 */
export function traceRecordCarry({ bandRecords = [],
  findings = [], outcomes = {}, crowds = [], planExecution = null, ledger = null,
  // — the sibling carry artifacts this run actually produced, so the scope block below states what
  // ran rather than what the constant last said. Absent ⇒ the static table, byte-identical to before.
  siblings = [] } = {}) {
  const fIdx = findingUris(findings);
  const basis = ledger?.present ? "recorded" : "reconstructed";
  const byReason = {}, bySource = {}, byReach = {}, bySeam = {}, byAuthor = {};
  const rows = [];
  const seen = new Set();
  for (const rec of Array.isArray(bandRecords) ? bandRecords : []) {
    const uri = bandRecordUri(rec);
    if (uri && seen.has(uri)) continue;         // the band carries one row per record; belt and braces
    if (uri) seen.add(uri);
    const c = classifyRecord(rec, { findings: fIdx, outcomes, ledger });
    bump(byReach, c.reach);
    bump(bySeam, c.stopped_at ?? "(none)");
    if (c.reason) bump(byReason, c.reason);
    if (c.reason_source) bump(bySource, c.reason_source);
    bump(byAuthor, c.authored_at ?? "(nobody)");
    rows.push({
      uri, mark: String(rec?.mark_text ?? ""), owner: String(rec?.owner_name ?? ""),
      office: String(rec?.office ?? ""), classes: Array.isArray(rec?.classes) ? rec.classes : [],
      status: String(rec?.status ?? ""),
      qids: [...new Set((Array.isArray(rec?._qids) ? rec._qids : [rec?._qid]).filter(Boolean).map(String))],
      queries: [...new Set((Array.isArray(rec?._queries) ? rec._queries : [rec?._query]).filter(Boolean).map(String))],
      reach: c.reach, stopped_at: c.stopped_at, reason: c.reason, reason_source: c.reason_source,
      // WHO said so, and when. The ruling rejects a reason authored by a later step about an earlier
      // step's decision, and this field is how a reader checks that without re-reading the code.
      authored_at: c.authored_at ?? null,
      detail: clip(c.detail),
    });
  }
  const unreasoned = rows.filter((r) => r.reason_source === "absent");
  // Records whose drop is UPSTREAM ABSENCE, not judgment: the step that would have judged them never
  // completed. A reason, so not `unreasoned` — but the loudest fact about a run when it is non-zero,
  // and the one that run shipped without stating, so it is counted separately and never folded
  // into an ordinary drop total.
  const upstreamAbsent = rows.filter((r) => /:stage-incomplete$/.test(String(r.reason ?? "")));
  // Records the step PASSED OVER: it ran, it reached them, and it recorded no ground of its own, so the
  // driver's own literal stands as the reason. A reason, so not `unreasoned` — the same distinction
  // `upstreamAbsent` above is drawn on, and counted separately for the same reason.
  //
  // WHY IT HAS TO BE IN `totals` AND NOT ONLY IN `by_reason_source`. This module's own header says a
  // reader who opens the file and sees `unreasoned: 0` must be able to tell that from "nothing was
  // dropped anywhere in this run". On R18 of 2026-09-27 the totals block read `unreasoned: 0` beside
  // 5,760 records the step passed over — the count was in `by_reason_source` and not in the block a
  // reader opens first, so the loudest fact about that run was one level down from the answer.
  //
  // `unreasoned` IS NOT REDEFINED, deliberately. A shipped Machine QC check passes only on
  // `unreasoned === 0` and that row reaches a client's workbook; folding these in would turn a green
  // into a red on every run with a silent exit, which is a decision about what a client is told rather
  // than a correction to a record.
  const stepSilent = rows.filter((r) => r.reason_source === "step-silent");
  const incompleteStages = Object.values(outcomes ?? {}).filter((o) => o && o.completed !== true).map((o) => o.stage);
  const slices = untraceableSlices({ crowds, planExecution });
  const deliveredFindings = Array.isArray(findings) ? findings.length : 0;
  return {
    schema_version: RECORD_CARRY_SCHEMA_VERSION,
    computable: true,
    unit: "register-record",
    // — WHICH HALF ANSWERED. "recorded" means every ending was written by the step that made it;
    // "reconstructed" means they were inferred after the fact, which is what shipped and what broke.
    basis,
    ledger: { present: Boolean(ledger?.present), rows: ledger?.rows ?? 0, torn: ledger?.torn ?? 0,
      seams: ledger?.seams ?? [], passes: ledger?.passes ?? 0 },
    // THE SELF-CHECK THAT WOULD HAVE CAUGHT, computed by the trace about itself so it can never
    // again be true and unnoticed. It fires when the trace reports NOT ONE finding while the run holds
    // positive evidence that findings exist, and it takes that evidence from two independent places:
    //
    //   the findings handed in are non-empty          — a direct contradiction
    //   the judges carried records and none of them    — step 3 handed synthesis candidates for delivery
    //   was delivered                                    and the delivered set names none of them
    //
    // The second matters because the first CANNOT catch the shipped defect: called too early, the trace
    // is handed `[]`, and from the inside `[]` is indistinguishable from a matter that found nothing.
    // That is exactly how this shipped — so the check that catches it has to key on something the run
    // wrote BEFORE synthesis. This is a claim about the TRACE, never about the run's recall.
    degenerate: (byReach.finding ?? 0) === 0 && (deliveredFindings > 0 || (byReach.carried ?? 0) > 0),
    delivered_findings: deliveredFindings,
    surfaced: byReach.carried ?? 0,
    // the run's own statement of what it looked at — read this BEFORE reading a zero
    scope: traceScopeFor(siblings),
    totals: {
      retrieved: rows.length,
      finding: byReach.finding ?? 0,
      dropped: rows.length - (byReach.finding ?? 0),
      unreasoned: unreasoned.length,
      step_silent: stepSilent.length,
      upstream_absent: upstreamAbsent.length,
      untraceable_slices: slices.length,
      // — THE SUM STATES ITS OWN INCOMPLETENESS. `n + s.untraced` coerced a null to 0, so a
      // slice whose remainder is unmeasurable silently contributed nothing and the total read as if it
      // covered every slice. The sum is now of the KNOWN remainders only, and the companion field says
      // how many slices could not be added — a sum that cannot be complete must say so, or the number
      // is worse than no number.
      untraced_hits: slices.reduce((n, s) => n + (s.untraced ?? 0), 0),
      untraced_unknown_slices: slices.filter((s) => s.untraced == null).length,
    },
    incomplete_stages: incompleteStages,
    by_reach: byReach,
    by_seam: bySeam,
    by_reason: byReason,
    by_reason_source: bySource,
    by_authored_at: byAuthor,
    stage_outcomes: outcomes,
    // THE DEFECT LIST — every record the run dropped with nothing anywhere attesting a ground.
    unreasoned,
    untraceable_slices: slices,
    rows,
  };
}

// ── the run.jsonl row ─────────────────────────────────────────────────────────────────────────────
// AD-4 house rule: every field on EVERY row, so "nothing unreasoned" (unreasoned:0) and "the
// trace could not run" (unreasoned:null) differ by VALUE, never by field presence. The tally lives
// HERE and only here — the ruling rejects a tally as the answer, and the answer is `rows`.
export const RECORD_CARRY_EVENT_FIELDS = ["retrieved", "finding", "dropped", "unreasoned",
  "upstream_absent", "untraceable_slices", "untraced_hits", "untraced_unknown_slices"];

export function recordCarryEvent({ trigger = null, artifact = null, reason = null } = {}) {
  const computable = artifact?.computable === true;
  const vals = computable ? artifact.totals : {};
  const row = { event: "record-carry", trigger, computable, reason };
  // — on the SPINE, not only in the artifact. `basis:"reconstructed"` on a fresh run and
  // `degenerate:true` are the two facts that would have made the shipped defect visible from run.jsonl
  // alone, which is the surface the babysit protocol polls.
  row.basis = computable ? (artifact.basis ?? null) : null;
  row.degenerate = computable ? (artifact.degenerate === true) : null;
  row.ledger_rows = computable ? (artifact.ledger?.rows ?? 0) : null;
  for (const k of RECORD_CARRY_EVENT_FIELDS) row[k] = vals[k] ?? null;
  // the stages whose non-completion is being attributed as an upstream drop, named on the row
  row.incomplete_stages = computable ? (artifact.incomplete_stages ?? []) : null;
  // and the paths this trace did NOT look at, on the same row as the zeros, so the spine can never be
  // read as "no drops anywhere" — every field above is about the register path and nothing else
  row.uninstrumented = computable ? (artifact.scope?.uninstrumented ?? []).map((u) => u.path) : null;
  return row;
}

// ── the mint ──────────────────────────────────────────────────────────────────────────────────────
/**
 * One doubt per UNREASONED drop — the record reached a step that was obliged to speak about it (:
 * every retrieved close match ends as a finding or a reasoned negative, never silence) and nothing
 * did. Frozen doubt-record shape, status "open"; stitchDoubts and the doubt-closure stage decide
 * endings exactly as for every other doubt family, and an OPEN one shipping in the `# Doubt Ledger`
 * is the system working.
 *
 * Bounded (`max`), because this list is unbounded by construction — a wholly failed step 3 could put
 * every record of the pile in it and drown the ledger. The artifact always carries the FULL list; the cap
 * applies to the mint only, and `mintRecordCarryDoubts` reports what it omitted so the truncation is
 * itself visible rather than silent. PURE.
 */
export function mintRecordCarryDoubts(artifact, { max = 25 } = {}) {
  const all = Array.isArray(artifact?.unreasoned) ? artifact.unreasoned : [];
  const take = all.slice(0, Math.max(0, max));
  const doubts = take.map((r, i) => ({
    id: `doubt:record-carry:unreasoned:${i + 1}`,
    birth: { place: "record-carry", artifact: "register-named-band.json", quote: clip(`${r.uri} — ${r.mark}${r.owner ? ` (${r.owner})` : ""}`) },
    subject: {
      mark: r.mark, owner: r.owner, uris: r.uri ? [r.uri] : [], terms: [],
      // The frozen subject shape keeps its selection key. No record carries a placement tier since step 3
      // judges by owner, so it is null, which doubt selection dispatches as keyless: counted, never dropped.
      placementTier: null,
      text: `this record was retrieved and reached "${r.reach}", then stopped at the ${r.stopped_at} seam with no step recording a ground: ${r.detail}`,
    },
    status: "open",
    ending: null,
  }));
  return { doubts, minted: doubts.length, omitted: Math.max(0, all.length - doubts.length) };
}

/**
 * The one-line reader answer to "where did this record stop, and why". Takes the artifact and a mark
 * text or uri; returns the matching rows. The acceptance question for — "does it say why 澜珀 did
 * not become a finding?" — is this function with `"澜珀"`. Substring, not the house token matcher, for
 * the Han-script reason in the header. PURE.
 */
export function explainRecords(artifact, needle) {
  const n = String(needle ?? "").trim();
  if (!n) return [];
  const lc = n.toLowerCase();
  return (Array.isArray(artifact?.rows) ? artifact.rows : [])
    .filter((r) => String(r.mark) === n || String(r.mark).includes(n) || String(r.uri).toLowerCase() === lc);
}

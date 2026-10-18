// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// synthesis-record.mjs — the recording transport for the writer's narrative and its findings record.
//
// The writer produces the report's substance, and until now it wrote both of its artifacts as free
// prose with Write/Edit: `narrative.md` by authoring it, `findings.json` by authoring the JSON. Every
// check on either one therefore ran AFTER the file existed, over text — and a prose regex cannot do
// this job. Measured over the delivered corpus (2026-08-25,): 31 of 32 positives
// false, and before/after corrective pairs indistinguishable on 9 of 12 variants. It fired on the real
// sentence too, so the failure is not sensitivity — it is that truth about coverage needs typed values
// joined to the run's own data, and prose has neither.
//
// The seat now hands VALUES and the driver renders `narrative.md`. `findings.json` was ALREADY typed
// values; what changes is that it arrives through the call instead of being authored as a file, which
// is what lets the joins below run at write time.
//
// ── WHAT THIS DOES *NOT* CONVERT, AND IT IS A RULING, NOT AN OVERSIGHT ──────────────────────
//
// The per-finding write-ups are NOT rendered from `findings.json`. `stages.mjs`' contract element for
// them classes the second authoring `mechanical:code-rendered` and its `why` records ruling D3 on
// (2026-08-19): the direction "findings.json authored, per-finding prose rendered
// from it" was put in front of the owner beside the alternative and ruled AGAINST — report-card holds
// the single authored wording, the typed fields carry the reads it is written from, "nobody builds the
// inverse pattern". So what this renders is the CROSS-FINDING material, which is what no other
// artifact holds: the spine, the verdict read, the calibration answers, the coverage honesty read and
// the intake-ask answers. A future reader wondering why the obvious extra step was not taken: it was
// considered, priced and refused.
//
// ── IT VALIDATES THROUGH THE SHIPPED PARSERS, NOT A COPY ───────────────────────────────────────────
//
// Same posture as the reviewer's transport and skeptic-record.mjs: after rendering, this module reads
// its own bytes back through the functions the pipeline actually runs against these files —
// `parseFindingsJson` for the record, and for the narrative the four checks `validators.narrative`
// applies plus `findCoverageRecommendations` — and refuses on any disagreement. A transport rendering
// by its own idea of the shape while verify.mjs kept its own regexes would rebuild the
// dictated-shape-with-a-second-parser seam this whole category exists to close.
//
// ── THE COVERAGE JOIN IS THE POINT OF THE ISSUE, AND IT RUNS HERE ──────────────────────────────────
//
// The digest one stage earlier already refuses a clean claim over an unexecuted axis
// (`findUnexecutedCleanClaims`) — it can, because its coverage rows are typed. The writer's were
// prose, so the same check had nothing to run on. They are typed now, so it runs: a `confirmed-clean`
// row whose area does not join the plan-execution receipt is refused AT THE CALL, in the turn where
// restating it is free, rather than at a gate whose only repair is a forced re-ask of the whole stage.
import { writeFileSync, appendFileSync, mkdirSync, readFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join, dirname } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { parseFindingsJson, COVERAGE_AREA_STATES, topKeysForVersion } from "./findings-model.mjs";
import { readFrozenMethod, FROZEN_METHOD_FILE } from "./framework-method.mjs";
import { findCoverageRecommendations } from "./verify.mjs";
import { declinationCallPaths, readDeclinations } from "./declination-tool.mjs";   // — the seat's own declines, read by the driver never asserted by the seat
import { reconcileDeclinationDuty, declinationDutyRefusal } from "./declination-duty.mjs";
import { findingUris } from "./record-carry.mjs";   // one derivation of "which records did the findings name", called not copied
import { foldAfterSave } from "./record-fold.mjs";   // once the delivery seam is passed, the saved record is folded again
import { runLog } from "./log.mjs";   // what the transport read a call as goes to the run's record, never to the model's answer
import { recordOriginsOr, blankOnRepeat, recordBlanking, FOREIGN_HOST_TOKEN } from "./foreign-record-links.mjs";   // a foreign record link: refused once, then blanked
export const NARRATIVE_FILE = "narrative.md";
export const FINDINGS_FILE = "findings.json";

/** The narrative's sections, in render order. The ask section renders LAST — see renderNarrative. */
export const NARRATIVE_SECTIONS = ["verdict", "coverage", "spine", "calibration", "ask_answers"];

/** Where the call's evidence lives — the driver's own record of what the seat handed it. */
export function synthesisCallPaths(runDir) {
  const dir = driverDir(runDir, "synthesis-calls");
  // TWO FILES, AND THE SPLIT IS LOAD-BEARING. `payload` is what ARRIVED, written before the decision —
  // the forensic record, including calls that were refused. `accepted` is the last call that PASSED,
  // and it is the merge base a repair patches onto. Reading the forensic file as the merge base would
  // let a refused call become the thing the next repair is built on.
  // THREE FILES. `payload` is what ARRIVED, written before the decision. `accepted` is the last call that
  // PASSED, and it is the merge base a repair patches onto. `refusals` is every call that was turned
  // away, appended.
  //
  // The refusal log exists because the conversion moved WHERE a defect is caught, and moving it left no
  // trace. Before, a malformed record reached disk, a validator named it, and the driver re-dispatched
  // with a composer that named the family — three events in the run's journal. Now the transport refuses
  // at the call and the seat restates in the same turn, which is better and was INVISIBLE: nothing in
  // the run said the defect had ever happened. A run that corrects itself silently cannot be audited,
  // and "no defect occurred" and "a defect occurred and was fixed" must not look the same.
  return { dir, payload: join(dir, "call-001.json"), accepted: join(dir, "accepted.json"),
    refusals: join(dir, "refusals.jsonl") };
}

const isStr = (s) => typeof s === "string" && s.trim() !== "";
const para = (s) => String(s).trim();

/**
 * Render narrative.md from typed values. PURE, and the single authority for the shape.
 *
 * "## Answers to your instructions" renders LAST and its line shape is not the seat's choice:
 * `validators.narrative` matches the heading with `/^##\s*Answers to your instructions\s*\n(…)/im` and
 * then counts `/^-\s*You asked\b/gim` inside it, stopping at the NEXT `#`/`##` heading. A section
 * rendered before another heading would have its answers counted only as far as that heading — so the
 * ordering is what makes the count total rather than a coincidence of what follows it.
 *
 * The driver supplies the `- You asked: <ask> → ` label and the seat supplies the answer ALONE. That
 * split is the delivered defect this render closes: a seat writing the whole line shipped
 * "- You asked: EU register only → You asked: 'EU register only.' → Satisfied…" to a client, because
 * the label was in the dictation and the seat restated it. A label the seat cannot write is a label it
 * cannot double.
 */
export function renderNarrative({ spine, verdict, coverage, calibration, askAnswers } = {}) {
  // `coverage.rows` and `askAnswers` are passed in FROM THE FINDINGS RECORD by `acceptSynthesis` — they
  // are never a second set the seat authored for this document. See THE ONE SET OF ROWS below.
  const out = [];
  const section = (title, body) => {
    if (!body || (Array.isArray(body) && !body.length)) return;
    out.push(`## ${title}`, "");
    for (const p of (Array.isArray(body) ? body : [body])) out.push(para(p), "");
  };
  // ── THE ORDER IS THE DOCTRINE'S, AND IT IS A PRODUCT RULE, NOT A LAYOUT PREFERENCE ─────────────
  //
  // synthesis-rules.md → "Section ordering": verdict first, then what was looked for and not found,
  // then what was found — "a reader who stops after the first paragraph should have the answer; a
  // reader who stops after the second should know the answer's coverage." The first cut of this render
  // led with the spine, which reverses exactly that. Now the driver owns the order, the rule is kept
  // HERE, where it cannot be got wrong by a seat, rather than asked for in prose and hoped for.
  section("Verdict", verdict);
  if (coverage?.rows?.length || coverage?.read) {
    out.push("## Coverage", "");
    if (coverage.read) out.push(para(coverage.read), "");
    for (const r of coverage.rows ?? []) {
      // ONE LINE PER ROW, and the state renders as a bare token rather than a sentence. The report's
      // own coverage surface keys off findings.json's rows; this is the lawyer-readable mirror, so the
      // two must not be able to say different things — same rows, one render each.
      out.push(`- ${r.area} — ${r.state}${isStr(r.note) ? `: ${para(r.note)}` : ""}`);
    }
    out.push("");
  }
  section("The spine", spine);
  if (calibration?.length) {
    out.push("## Calibration challenges", "");
    for (const c of calibration) {
      out.push(`**${para(c.challenge)}**`, "", para(c.answer), "");
    }
  }
  if (askAnswers?.length) {
    out.push("## Answers to your instructions", "");
    for (const a of askAnswers) out.push(`- You asked: ${para(a.ask)} → ${para(a.answer)}`);
    out.push("");
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

/** Render the findings document. The seat's values, in the envelope the parser owns. */
export function renderFindings(doc) {
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * The coverage join — AND WHAT IT IS NOT, because the first cut of it was wrong in a way that would
 * have refused nearly every honest run.
 *
 * The issue proposed joining a `confirmed-clean` row to the plan-execution receipt through
 * `planJoinFrom`. Built that way and driven on a real mock run, it refused `register / EU` because the
 * receipt's keys are QUERY IDS — `primary-sweep:exact:novapulse`, `saturation-probe:default:project`.
 * A coverage `area` is a human-facing slice LABEL and a qid is a query identifier; they are different
 * namespaces and never join. The check would have fired on every clean row in production, which is the
 * 31-of-32 false-positive shape this whole issue exists to end, rebuilt with typed values instead of a
 * regex. Typed does not mean joined: it has to be joined to the RIGHT key.
 *
 * WHAT IS ACTUALLY JOINABLE is the run's own typed coverage record — the digest's
 * `register-coverage-ledger.json`, rows of `{axis, scope, status, reason}` in the SAME five-state
 * vocabulary the findings record uses, already joined to the plan by the digest. And the rule to apply
 * to it is not invented here either; it is doctrine, `synthesis-rules.md`: a unit recorded
 * `coverage-limited` or `deferred` "can never be written as a clean negative".
 *
 * So: if the run's ledger records ANY slice as less than clean, the writer's coverage account must
 * carry at least one row that is not `confirmed-clean`. It may say which slice, in its own words, at
 * whatever granularity the lawyer needs — what it may not do is state a coverage account that is clean
 * throughout when the run's own record is not.
 *
 * THE SHIPPED GATE'S POLARITY, DELIBERATELY COPIED. `findUnexecutedCleanClaims` refuses only where the
 * key IS present and says unexecuted; a row it cannot find is not a violation. The first cut here had
 * that backwards — absent from the receipt meant refused — which is how a namespace mismatch became a
 * blanket refusal instead of an obvious error. An absence is a finding, and the finding is "could not
 * look", never "guilty".
 *
 * Returns the ledger rows that were not carried, `[]` if the account is honest, or `null` for could-not-
 * look — no ledger on disk, or a ledger that records no limit at all.
 */
export function uncarriedCoverageLimits(rows, ledger) {
  if (!Array.isArray(ledger) || !ledger.length) return null;
  const limited = ledger.filter((r) => {
    const st = String(r?.status ?? "").trim();
    // `withheld-by-judgment` sits beside `confirmed-clean` here, and the reason is the opposite one.
    // A clean row has nothing to carry. A withheld row is a family the reading turn chose NOT to open,
    // having read the identical question as a list and found what it needed — that is where the work
    // was spent, not a slice the run could not clear, and the rule that nothing is added to the report keeps it out
    // entirely. Demanding it be carried would put a "we did not search this" line in front of a lawyer
    // about a decision that made the search better.
    return st !== "" && st !== "confirmed-clean" && st !== "note" && st !== "withheld-by-judgment";
  });
  if (!limited.length) return null;                       // the run records no limit: nothing to carry
  const carried = (rows ?? []).some((r) => {
    const st = String(r?.state ?? "").trim();
    return st !== "" && st !== "confirmed-clean" && st !== "note";
  });
  return carried ? [] : limited;
}

/**
 * Assemble both artifacts from typed params and validate the RENDERED BYTES through the shipped
 * parsers. Returns `{ok:true, narrative, findings, …}` or `{ok:false, reason}` with a token-first
 * message, so the seat meets the defect in the turn where restating is free.
 *
 * `asks` and `planExecution` are the DRIVER's reads, never parameters of the call: whether this run
 * committed intake asks, and what its plan actually executed, are facts about the run. A seat that
 * could assert either could waive its own contract — the same reason the reviewer's transport takes
 * `receiptPresent` from the driver rather than from the call.
 */
/**
 * The coverage rows a client may see, with every withheld family's row removed. PURE.
 *
 * `withheld-by-judgment` is the reading turn saying it chose not to open a family — it read the
 * identical question as a list, found what it needed, and spent the work there. That is a decision
 * about where effort went, not a gap in the client's search, and the rule that nothing is added to the report (2026-09-18) keeps it in the run record
 * and the coverage ledger alone.
 *
 * Applied here rather than trusted to the model, because the model is the surface that can get it
 * wrong: it authors these rows, it has been told the family was withheld, and a row reading "we did
 * not search this" in front of a lawyer is the sentence that rule forbids — about a decision that
 * made the search better. The LEDGER is the authority on which families were withheld.
 *
 * A row for a family the ledger holds as anything else is untouched, and that direction matters more
 * than this one: a documented limit dropped by accident is a disclosure the reader is owed and does
 * not get.
 */
export function withoutWithheldRows(rows, ledger) {
  // A FAMILY IS ONLY WITHHELD IF THE LEDGER HOLDS NOTHING ELSE ABOUT IT. A family can be withheld at
  // the axis level AND still carry a documented limit on one of its slices — measured: an axis whose
  // whole-axis row is withheld while `primary-sweep (exact: <mark> [cl 25])` is a disclosed limit the
  // synthesis gate then demands be carried. Dropping by family name alone deleted the carrying row and
  // the run failed, which is the worse error stated twice over: a disclosure the reader is owed, gone,
  // and a run that does not deliver.
  //
  // So a family qualifies only when EVERY ledger row for it is withheld. One row saying anything else
  // keeps the whole family's rows, and that is the direction to fail in.
  const byFamily = new Map();
  for (const r of (Array.isArray(ledger) ? ledger : [])) {
    const axis = String(r?.axis ?? "").trim().toLowerCase();
    if (!axis) continue;
    const isWithheld = String(r?.status ?? "").trim() === "withheld-by-judgment";
    byFamily.set(axis, (byFamily.get(axis) ?? true) && isWithheld);
  }
  const withheld = new Set([...byFamily.entries()].filter(([, only]) => only).map(([axis]) => axis));
  if (!withheld.size) return Array.isArray(rows) ? rows : [];

  // ── THE AXIS IS NAMED IN A SEGMENT, NOT ALWAYS THE FIRST ONE ──────────────────────────────────
  //
  // This read `area.split("/")[0]` and was inert for the two shapes that matter most, failing OPEN —
  // toward the client, which is the wrong direction for a gate whose whole job is to keep a row off
  // the page. Measured against the real strings:
  //
  //   `incumbent-class (entire axis)`         no slash at all — the whole-axis row a client reads
  //   `Register / incumbent-class`            the axis is the SECOND segment; the first is a layer
  //   `incumbent-class / extra script group`  the only shape the first read caught
  //
  // So every `/`-separated segment is considered, with a trailing parenthetical stripped, and each is
  // compared by EQUALITY against the axis names the ledger actually holds.
  //
  // Equality on a segment, never `includes`: a substring test over an open vocabulary is how one axis
  // name once matched two unrelated areas, and here a false match DROPS a row — a documented limit the
  // reader is owed, gone silently. The failure this gate prevents is a withheld row appearing; the
  // failure it must not cause is a disclosure disappearing, and that one is worse.
  const namesIn = (area) => String(area ?? "").toLowerCase().split("/")
    .map((seg) => seg.replace(/\([^)]*\)/g, " ").trim())
    .filter(Boolean);
  return (Array.isArray(rows) ? rows : []).filter((r) => !namesIn(r?.area).some((n) => withheld.has(n)));
}

export function acceptSynthesis(params, { asks = [], ledger = null, manifest = null, method = undefined, methodInvalid = null, owed = null, declined = null, recordOrigins = null } = {}) {
  const doc = params?.findings;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, reason: "synthesis_findings_missing: `findings` must be the findings document object { schema_version, rated_under_framework, findings, coverage, … } — this is the record the report and the workbook are built from, and there is no path that renders without it" };
  }
  const n = params?.narrative;
  if (!n || typeof n !== "object" || Array.isArray(n)) {
    return { ok: false, reason: "synthesis_narrative_missing: `narrative` must be an object of typed sections — the driver renders the document, so it needs the sections rather than the prose of a whole file" };
  }
  if (!isStr(n.spine)) {
    return { ok: false, reason: "synthesis_spine_missing: `narrative.spine` is the dominant-element spine — the cross-finding read no other artifact on this run holds. It is the core of the product and there is no clean answer that omits it" };
  }
  if (!isStr(n.verdict)) {
    return { ok: false, reason: "synthesis_verdict_missing: `narrative.verdict` is the verdict prose — what the findings together mean for this client" };
  }
  // ── THE ONE SET OF ROWS, AND THE NARRATIVE IS A RENDERING OF IT ─────────────────────────────────
  //
  // The first cut took coverage rows on the NARRATIVE side and joined those to the receipt. That left
  // `findings.coverage` — the copy `parseFindingsJson` validates, the copy the report's open-items count
  // and the portal read, and the copy `injectDeferralCoverage` later mutates — joined to nothing. A seat
  // could send an honest narrative row and a false `confirmed-clean` in the record, and the issue's whole
  // criterion ("a false 'the search finished' cannot be written") was false for the copy that ships.
  // Driven before this was written: that call was ACCEPTED.
  //
  // Two copies that must agree is a second-authoring defect, so there are not two. The record is the
  // machine contract and the narrative's coverage list is RENDERED from it. Disagreement is not detected;
  // it is impossible.
  // ── NOTHING ADDED TO THE REPORT: A FAMILY THE READING TURN DID NOT OPEN STAYS OFF IT, WHATEVER THE MODEL WROTE ──
  //
  // `withheld-by-judgment` is the reading turn saying it chose not to open a family — it read the
  // identical question as a list, found what it needed, and spent the work there instead. That is a
  // decision about where effort went, not a gap in the client's search, and it belongs to the run
  // record and the coverage ledger alone.
  //
  // Dropped HERE rather than trusted to the model, because the model is the one surface that can get
  // it wrong: it writes the coverage rows, it has been told the family was withheld, and a row saying
  // "we did not search this" in front of a lawyer is exactly the sentence that rule forbids — about a
  // decision that made the search better. The ledger is the authority on which families were withheld,
  // so a row whose family it holds as withheld goes, however the row was authored.
  const rows = withoutWithheldRows(Array.isArray(doc.coverage) ? doc.coverage : [], ledger);
  if (n.coverage?.rows !== undefined) {
    return { ok: false, reason: "synthesis_coverage_rows_misplaced: coverage rows belong in `findings.coverage`, not on the narrative — the driver renders the narrative's coverage list from the record, so there is one authored set and no way for the client's readable statement and the machine record to disagree. Send `narrative.coverage.read` for the prose" };
  }
  if (n.ask_answers !== undefined) {
    return { ok: false, reason: "synthesis_ask_answers_misplaced: `ask_answers` is a TOP-LEVEL field of the findings record, not a narrative section — the report's code-built section and the delivery lint both read it there, and the driver renders the narrative's answers from the same entries. Send it as `findings.ask_answers`" };
  }
  for (let i = 0; i < (rows ?? []).length; i++) {
    const r = rows[i];
    if (!isStr(r?.area)) return { ok: false, reason: `synthesis_coverage_area_missing:${i} — every coverage row names the mark or slice it is about` };
    if (!COVERAGE_AREA_STATES.includes(r?.state)) {
      return { ok: false, reason: `synthesis_coverage_state_invalid:${i}:${String(r?.state).slice(0, 40)} — one of ${COVERAGE_AREA_STATES.join(", ")}` };
    }
  }
  // ── THE COVERAGE JOIN. The issue's "a false 'the search finished' cannot be written". ────────────
  const uncarried = uncarriedCoverageLimits(rows, ledger);
  if (uncarried && uncarried.length) {
    const names = [...new Set(uncarried.map((r) => `${r.axis}${r.scope ? ` (${r.scope})` : ""}`))].join(", ");
    return { ok: false, reason: `synthesis_coverage_limit_uncarried:${names.slice(0, 140)} — this run's own register coverage ledger records those slices as less than clean, and every coverage row you sent says confirmed-clean. A slice the run could not clear cannot be written as a clean negative. Carry it: one coverage row whose state is coverage-limited / open / not-searched, at whatever granularity the reader needs` };
  }
  // Intake asks: answered, and answered by the same strings the driver will join on.
  if (asks.length) {
    const given = Array.isArray(doc.ask_answers) ? doc.ask_answers : [];
    if (given.length < asks.length) {
      return { ok: false, reason: `synthesis_ask_unanswered:${asks.length - given.length}:of:${asks.length} — this run committed intake asks at capture, and each one owes a labelled answer. Send one entry per ask as \`findings.ask_answers\`, the ask VERBATIM as it was given to you — the driver joins on that string and renders the labelled line into the narrative and the report` };
    }
    for (let i = 0; i < given.length; i++) {
      if (!isStr(given[i]?.ask) || !isStr(given[i]?.answer)) {
        return { ok: false, reason: `synthesis_ask_answer_shape:${i} — each entry is { ask, answer }; the ANSWER ALONE, starting at its first word. The driver prints the "- You asked: <ask> → " label itself, so an answer that repeats the ask ships the question to the client twice` };
      }
    }
  }

  // ── — EVERY RECORD THIS SEAT WAS HANDED LEAVES BY A NAMED EXIT ─────────────────────────────
  //
  // The rule is not new and was never checked. This stage's own contract states it in one line — a
  // record that reached your findings surface leaves as a finding in findings.json or as a declination,
  // "and there is no third way out" — and the driver then accepted whatever came back. On one test run
  // it came back short and nothing anywhere said so, which is what put the reader in front of a report
  // that silently omitted records the run had judged worth his attention.
  //
  // AT THE ACCEPTANCE BOUNDARY, not at a gate afterwards. The values are in hand at the call, the seat
  // can decline the named records and re-send in the same turn, and the run's journal keeps the refusal.
  // A validator token would catch it a stage later, when the only repair left is re-asking the whole
  // seat — the difference between a correction and a re-run of the most expensive stage in the cycle.
  //
  // THE CALL IS THE MERGED MODEL, never the patch, so `doc.findings` is always the complete set: a
  // partial re-send cannot read as a run that lost everything it did not name.
  //
  // DECLINING IS A COMPLETE ANSWER and the refusal says so outright. It costs grounds about THAT record
  // and a token from a closed set, and this adds no new way out — it makes the existing one compulsory.
  const duty = reconcileDeclinationDuty({
    owed,
    deliveredUris: [...findingUris(Array.isArray(doc.findings) ? doc.findings : []).keys()],
    declinedUris: declined,
  });
  const dutyRefusal = declinationDutyRefusal(duty);
  if (dutyRefusal) return { ok: false, reason: dutyRefusal };

  const narrative = renderNarrative({
    spine: n.spine, verdict: n.verdict,
    coverage: { read: n.coverage?.read, rows },
    calibration: n.calibration, askAnswers: doc.ask_answers,
  });
  let findings = renderFindings(doc);

  // ── THE ROUND-TRIP. Rendered bytes → the shipped parsers → exactly what was asked for. ───────────
  // With the refusals above most of these cannot fire, which is the point: they are the assertion that
  // this renderer and verify.mjs still agree, kept where a drift surfaces as a refusal the seat sees
  // rather than as a verdict the driver misreads.
  // The frozen method rides beside the manifest: absent (undefined) only where a caller never said, as in
  // the unit arms; null when the run froze none. A frozen copy that does not read back is the driver's
  // own file gone wrong, and the seat cannot fix it — so it is refused by name, never read as "no method".
  if (methodInvalid) return { ok: false, reason: `framework_method_unreadable: _driver/${FROZEN_METHOD_FILE} does not read back (${String(methodInvalid).slice(0, 160)}) — a driver fault, not the writer's` };
  let parsedDoc;
  try { parsedDoc = parseFindingsJson(findings, { ...(manifest ? { manifest, ...(method !== undefined ? { method } : {}) } : {}), ...(Array.isArray(recordOrigins) ? { recordOrigins } : {}) }); }
  catch (e) {
    return { ok: false, reason: `synthesis_findings_invalid: ${String(e?.message ?? e).slice(0, 300)}` };
  }
  // The framework's inputs are written as the framework writes them — its labels, its values, its order —
  // the form the parse normalised them to. Every reader after this one then matches them exactly.
  if (method && Array.isArray(parsedDoc?.findings) && parsedDoc.findings.some((f) => f?.inputs)) {
    const canon = new Map(parsedDoc.findings.filter((f) => f?.inputs).map((f) => [f.ordinal, f.inputs]));
    findings = renderFindings({ ...doc, findings: doc.findings.map((f) => (canon.has(f?.ordinal) ? { ...f, inputs: canon.get(f.ordinal) } : f)) });
  }
  if (narrative.length < 300) {
    return { ok: false, reason: `synthesis_narrative_too_short:${narrative.length} — the rendered narrative is under the 300-character floor the validator applies. The sections you sent do not add up to a cross-finding read` };
  }
  const cv = findCoverageRecommendations(narrative);
  if (cv.length) {
    return { ok: false, reason: `synthesis_coverage_recommendation:${String(cv[0]).slice(0, 100)} — a coverage gap is stated as an attempted-and-unreachable FACT, never as re-run work for a human. The driver already closed or proved-unclosable every closable gap before this stage ran, so "commission a further search" asks for work that has already been decided` };
  }
  if (asks.length) {
    const sec = narrative.match(/^##\s*Answers to your instructions\s*\n([\s\S]*?)(?=^#{1,2}\s|$(?![\s\S]))/im)?.[1] ?? "";
    const answered = (sec.match(/^-\s*You asked\b/gim) || []).length;
    if (answered < asks.length) {
      return { ok: false, reason: `synthesis_roundtrip_asks:${answered}:of:${asks.length} — the rendered narrative's ask section counts fewer answers than the call carried; the render and validators.narrative disagree about what an answer line is. A transport defect, not a judgment one` };
    }
  }

  // `clean_claims_checked` records WHETHER the join ran, beside what it found. `unexecutedCleanClaims`
  // is three-valued — `null` is "could not look" (no receipt: legacy and archived runs) and `[]` is
  // "looked, nothing wrong" — and a result carrying only "no violations" collapses those two into the
  // reassuring one. The run's record says which.
  return {
    ok: true, narrative, findings,
    coverage_rows: (rows ?? []).length,
    findings_count: Array.isArray(doc.findings) ? doc.findings.length : 0,
    coverage_limits_checked: uncarried !== null,
  };
}

/**
 * The last ACCEPTED call for this run, or null.
 *
 * This is what makes a repair a patch rather than a re-emission. measured the alternative on four
 * delivered clearances — 707.7 / 406.2 / 746.3 / 293.3 s, on the serial critical path every time — and
 * the repair ladder was rebuilt around targeted edits because "retyping a 160 KB document IS the
 * latency". A conversion that replaced those edits with a full re-send through a tool would have paid
 * that cost back in a different currency: the seat still retypes every finding, it just types JSON at a
 * tool instead of at a file.
 *
 * So the driver keeps the accepted values and a repair sends only what changed. `_driver/` is a tree no
 * seat may write, which is what makes the stored payload trustworthy as a merge base.
 */
export function lastAcceptedCall(runDir) {
  try {
    const { accepted } = synthesisCallPaths(String(runDir ?? ""));
    return JSON.parse(readFileSync(accepted, "utf8"))?.params ?? null;
  } catch { return null; }
}

// ── THE BASE A LATER PATCH BUILDS ON IS HELD, PUT BACK AND REPAIRED WITH THE RECORD ──────────────────────
//
// A corrective pass that saves and is then rolled back used to put back findings.json alone. narrative.md
// kept the failed pass's text, and the merge base kept the failed pass's record, so the next patch merged onto
// a record the rollback had discarded and quietly applied it again. The three functions below hold the
// narrative and the base beside the findings snapshot, put them back, and let the driver write a repair into
// the base, so a restore the next patch cannot see is not dropped by it.

const writeAtomic = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
};

/** The merge base and the narrative as they stand: each file's bytes, or null where it is absent or unreadable. Never throws. */
export function snapshotSynthesisBase(runDir) {
  const dir0 = String(runDir ?? "");
  const bytes = (at) => { try { return readFileSync(at, "utf8"); } catch { return null; } };
  return { accepted: bytes(synthesisCallPaths(dir0).accepted), narrative: bytes(join(dir0, NARRATIVE_FILE)) };
}

/**
 * Put back what `snapshotSynthesisBase` held. Never throws. Returns what happened to each file — "restored",
 * "removed", "unchanged" or "failed" — or null when there is no snapshot, which leaves both files as they are.
 *
 * A snapshot that held NO base removes the one written since, so a later patch is refused for having no base
 * rather than built on the pass that was discarded. A snapshot that held no narrative leaves the file as it
 * stands: a run with no narrative.md reads as one whose synthesis never finished, and the rollback exists to
 * deliver.
 */
export function restoreSynthesisBase(runDir, snap) {
  if (!snap || typeof snap !== "object") return null;
  const dir0 = String(runDir ?? "");
  const putBack = (at, held, { removeWhenAbsent }) => {
    try {
      let now = null;
      try { now = readFileSync(at, "utf8"); } catch { now = null; }
      if (held == null) {
        if (!removeWhenAbsent || now == null) return "unchanged";
        rmSync(at, { force: true });
        return "removed";
      }
      if (now === held) return "unchanged";
      writeAtomic(at, held);
      return "restored";
    } catch { return "failed"; }
  };
  return {
    accepted: putBack(synthesisCallPaths(dir0).accepted, snap.accepted, { removeWhenAbsent: true }),
    narrative: putBack(join(dir0, NARRATIVE_FILE), snap.narrative, { removeWhenAbsent: false }),
  };
}

/**
 * A DRIVER EDIT TO THE MERGE BASE, judged before it is written. Never throws.
 *
 * `edit` is PURE: it takes the base's findings record, the model's own in its numbering, and returns the record
 * to hold instead. The edited call is judged by `acceptSynthesis` with the run's own reads, as a call is, so the
 * base stays what it has always been: the last record that passed. A refusal, a throw or a failed write leaves
 * the base as it was.
 *
 * Returns `{ok: true, changed}` or `{ok: false, reason}`.
 */
export function rebaseSynthesis(runDir, edit, opts = {}) {
  const dir0 = String(runDir ?? "");
  const base = lastAcceptedCall(dir0);
  if (!base || typeof base !== "object") return { ok: false, reason: "no_base: this run holds no accepted synthesis call to edit" };
  let findings;
  try { findings = edit(structuredClone(base.findings)); }
  catch (e) { return { ok: false, reason: `edit_failed: ${String(e?.message ?? e).slice(0, 160)}` }; }
  if (JSON.stringify(findings) === JSON.stringify(base.findings)) return { ok: true, changed: false };
  const auto = driverReadsFor(dir0);
  const { asks = auto.asks, ledger = auto.ledger, manifest = auto.manifest,
    method = auto.method, methodInvalid = auto.methodInvalid ?? null,
    owed = auto.owed, declined = auto.declined, recordOrigins = undefined,
    now = () => new Date().toISOString() } = opts;
  const call = { ...base, findings };
  const v = acceptSynthesis(call, { asks, ledger, manifest, method, methodInvalid, owed, declined, recordOrigins: recordOriginsOr(recordOrigins) });
  if (!v.ok) return { ok: false, reason: v.reason };
  try {
    writeAtomic(synthesisCallPaths(dir0).accepted, JSON.stringify({
      _provenance: "the last ACCEPTED call, with a driver edit that passed the same acceptance — the base a later repair patches onto",
      acceptedAt: now(), editedBy: "driver", params: call,
    }, null, 2) + "\n");
  } catch (e) { return { ok: false, reason: `write_failed: ${String(e?.message ?? e).slice(0, 160)}` }; }
  return { ok: true, changed: true };
}

// ── A FINDINGS OBJECT WITH NO LIST IS A PATCH ON THE REGISTERS IT CARRIES ───────────────────────────────
//
// A correction has been seen to send the registers it changed inside a `findings` object that carries no
// findings list, beside its rows. Read as a document, that object has no findings at all, and the call was
// refused as an unparseable record, or as a record accounting for none of the run's owed records, though the
// stored record held every one. A findings list makes the document whole; without one, the call patches what
// it carries, and the merged record is judged whole as any call is.
//
// MAIN'S READING STANDS FOR EVERYTHING ELSE. A list-less object reads as registers only when there is a stored
// record to patch, a narrative sent beside it is an object of the sections the tool describes, every key it carries
// is a register of that record's own ladder (the one its schema_version gives) or its rows, every key the call
// carries beside its narrative and that object is one too, its envelope is absent or equal to the stored one wherever
// it is sent, a corrections marker sent inside it or beside it is one the decode reads, a register sent inside it and
// again beside it carries the same value in both places, the call's own rows each name a finding the stored record
// holds, and no ordinal carries two different rows, among the call's own rows or its nested ones. Any other shape is
// read exactly as it always was, so the model meets the refusal it always met, byte for byte.

const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
// Key-sorted JSON: "the same content" must not turn on the order the model wrote its keys in.
const canon = (v) => (v === null || typeof v !== "object") ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
const sameValue = (a, b) => canon(a) === canon(b);

// A finding row names the finding it replaces by its ordinal, a positive whole number.
const isRow = (r) => isPlainObject(r) && Number.isInteger(r.ordinal) && r.ordinal > 0;
// A corrections marker sent as a JSON string, decoded: the object it encodes, or undefined for anything else.
const decodedMarker = (v) => { try { const x = JSON.parse(v); return isPlainObject(x) ? x : undefined; } catch { return undefined; } };
// A marker the decode reads: none (null, which the parser reads as no marker), an object, or a string encoding one.
const isMarker = (v) => v == null || isPlainObject(v) || (typeof v === "string" && decodedMarker(v) !== undefined);
// A register's value as the transport reads it: a marker string as the object it encodes, anything else as sent.
const asRead = (k, v) => (k === "corrections" && typeof v === "string" ? (decodedMarker(v) ?? v) : v);
// A narrative section as the tool describes it: the coverage prose inside `coverage`, the calibration challenges as
// {challenge, answer} pairs, and every other section as text. `ask_answers` belongs to the record, not here.
const isSection = ([k, v]) => k === "coverage" ? isPlainObject(v) && Object.keys(v).every((x) => x === "read") && isStr(v.read)
  : k === "calibration" ? Array.isArray(v) && v.every((c) => isPlainObject(c) && isStr(c.challenge) && isStr(c.answer))
  : k !== "ask_answers" && isStr(v);
// Two different rows for one ordinal among `rows`. A row sent again with the same content is one row.
const twoRowsForOneOrdinal = (rows) => {
  const one = new Map();
  return rows.some((r) => (one.has(r.ordinal) ? !sameValue(one.get(r.ordinal), r) : (one.set(r.ordinal, r), false)));
};

// The record's envelope. A list-less object that would change either, inside the object or at the call's top
// level, is not a register edit: re-versioning is a whole re-send (the schema-downlevel rung), and read as
// registers it could move the stored list to another version's rules without the list ever being sent.
const ENVELOPE_KEYS = ["schema_version", "rated_under_framework"];

/**
 * Rows sent inside a list-less `findings`, beside the call's own. PURE. Null when that is ambiguous: rows that are
 * not an array, a nested row that is not an object carrying a positive whole-number ordinal (the way a finding row
 * names the finding it replaces), or one ordinal carrying two different rows, whether both are nested or one is at the
 * top level. The call's own rows reach here already checked to carry one row per ordinal (`registerPatchOf`), so a
 * nested row is compared with the one row its ordinal has there. A nested row that repeats one already sent is
 * applied once, and `lifted` counts only the rows actually added.
 */
function liftNestedRows(top, nested) {
  if (nested === undefined) return { rows: top, lifted: 0 };
  if (!Array.isArray(nested) || (top != null && !Array.isArray(top))) return null;
  if (!nested.every(isRow)) return null;
  const sent = new Map((top ?? []).map((r) => [r?.ordinal, r]));
  const added = [];
  for (const r of nested) {
    if (sent.has(r?.ordinal)) {
      if (!sameValue(sent.get(r?.ordinal), r)) return null;
      continue;
    }
    sent.set(r?.ordinal, r);
    added.push(r);
  }
  return { rows: added.length ? [...(top ?? []), ...added] : top, lifted: added.length };
}

/**
 * A call whose `findings` carries no list, read as a patch on the registers it carries onto `stored`. PURE.
 *
 * Returns `{registers, rows, lifted}`, or null when the call does not read that way (see above), and null leaves
 * the call to main's reading of it. `rows` are the call's own `findings_patch` with the nested rows after them.
 */
export function registerPatchOf(stored, call) {
  const doc = call?.findings;
  if (!isPlainObject(stored?.findings) || !isPlainObject(doc) || Object.hasOwn(doc, "findings")) return null;
  // A narrative sent beside it is an object of sections. Text, a list or null is no section patch: merged, its
  // characters would become numbered keys in the base while its prose reached no file. And each section it sends is
  // one the tool describes: a coverage that is not its prose, or calibration that is not its pairs, would replace
  // the held section with something no file renders, and a spine or verdict that is not text is no section at all.
  if (call.narrative !== undefined && !(isPlainObject(call.narrative) && Object.entries(call.narrative).every(isSection))) return null;
  // What it may carry: a register of the stored record's own ladder, or rows.
  const allowed = new Set([...topKeysForVersion(stored.findings.schema_version).filter((k) => k !== "findings"), "findings_patch"]);
  if (Object.keys(doc).some((k) => !allowed.has(k))) return null;
  // And what the call may carry beside it. The merge copies a patch's own top-level keys into the record, so a key
  // there that the ladder does not allow would be judged against the stored record, where the object read as a
  // document is judged as sent.
  if (Object.keys(call).some((k) => k !== "narrative" && k !== "findings" && !allowed.has(k))) return null;
  // Its envelope, inside the object or beside it, is absent or the stored one. The merge copies the call's own
  // top-level keys last, so a different envelope there would re-version the record as surely as one inside.
  if (ENVELOPE_KEYS.some((k) => [doc, call].some((o) => Object.hasOwn(o, k) && !sameValue(o[k], stored.findings[k])))) return null;
  // A corrections marker, inside the object or beside it, is one the decode reads. Any other marker, a string that
  // does not decode to an object among them, is refused as it always was: on this shape, as main reads the object.
  if (![doc, call].every((o) => isMarker(o.corrections))) return null;
  // A register sent inside the object and again beside it carries one value in both places. Read as registers, the
  // copy beside the object would be kept and the other dropped without a word, so the model would never learn that
  // part of its correction was ignored; read as main reads the call, it meets main's refusal. Compared as read, so the
  // answer is the same on the call as it arrives and on the call once its markers are decoded.
  if (Object.keys(doc).some((k) => k !== "findings_patch" && Object.hasOwn(call, k) && !sameValue(asRead(k, doc[k]), asRead(k, call[k])))) return null;
  // The call's own rows each replace a finding the stored record holds, named by a positive whole-number ordinal.
  // A row list that is not one, or a row aimed elsewhere, is read as main reads the call.
  const held = new Set((Array.isArray(stored.findings.findings) ? stored.findings.findings : []).map((f) => f?.ordinal));
  if (call.findings_patch !== undefined && !(Array.isArray(call.findings_patch) && call.findings_patch.every((r) => isRow(r) && held.has(r.ordinal)))) return null;
  // And no ordinal carries two different rows among them. Read as registers, the last would be applied and the other
  // dropped without a word, the choice turning on the order they were sent in; read as main reads the call, it meets
  // main's refusal. A row sent again with the same content is one row.
  if (call.findings_patch !== undefined && twoRowsForOneOrdinal(call.findings_patch)) return null;
  const { findings_patch: nested, ...registers } = doc;
  const lift = liftNestedRows(call.findings_patch, nested);
  return lift ? { registers, rows: lift.rows, lifted: lift.lifted } : null;
}

/**
 * Read a call in the shapes the model has been seen to send it. PURE. Returns the call to decide on — the
 * received object itself unless something below applies — and what was read, for the run's own record.
 *
 * A `corrections` marker sent as a JSON STRING is decoded where the call carries no findings list: at the top
 * level of a patch, and inside a findings object read as registers (`registerPatchOf`). Only a string that
 * decodes to an object is replaced, and the object is then validated as any marker is; anything else stays as it
 * came, and the parser refuses it as it always did. A call carrying a list — a whole call, or a record re-sent
 * with no narrative — is read exactly as main reads it.
 *
 * WHAT IS COUNTED, for the run log only. On a WHOLE call every top-level key beside its narrative and its findings
 * is ignored, as it always was, and counted: `keysIgnored` for keys, which are never named, since a key off the
 * record's ladder is the model's own word; `rowsIgnored` for a top-level `findings_patch`, and `rowsDiffering` for
 * those of its rows the record's own list does not hold as sent. A register patch never carries a register in both
 * places with two values: such a call is read as main reads it (`registerPatchOf`), so `overridden` stays empty.
 */
export function readSynthesisCall(received, stored) {
  const notes = { decoded: [], overridden: [], keysIgnored: 0, rowsIgnored: 0, rowsDiffering: 0 };
  if (!isPlainObject(received)) return { call: received, notes };
  const asRegisters = registerPatchOf(stored, received) !== null;
  if (received.findings !== undefined && !asRegisters) {
    if (received.narrative !== undefined) {   // a whole call
      const list = new Map((Array.isArray(received.findings?.findings) ? received.findings.findings : []).map((f) => [f?.ordinal, f]));
      for (const [k, v] of Object.entries(received)) {
        if (k === "narrative" || k === "findings") continue;
        if (k !== "findings_patch" || !Array.isArray(v)) { notes.keysIgnored++; continue; }
        notes.rowsIgnored += v.length;
        notes.rowsDiffering += v.filter((r) => !list.has(r?.ordinal) || !sameValue(list.get(r?.ordinal), r)).length;
      }
    }
    return { call: received, notes };
  }
  let call = received;
  if (typeof call.corrections === "string") {
    const x = decodedMarker(call.corrections);
    if (x !== undefined) { call = { ...call, corrections: x }; notes.decoded.push("corrections"); }
  }
  if (asRegisters && typeof call.findings.corrections === "string") {
    const x = decodedMarker(call.findings.corrections);
    if (x !== undefined) { call = { ...call, findings: { ...call.findings, corrections: x } }; notes.decoded.push("findings.corrections"); }
  }
  if (asRegisters) {   // compared as read, so a marker decoded on one side is not a difference
    for (const k of Object.keys(call.findings)) {
      if (k !== "findings_patch" && Object.hasOwn(call, k) && !sameValue(call[k], call.findings[k])) notes.overridden.push(k);
    }
  }
  return { call, notes };
}

/**
 * Merge a patch call onto the stored one. PURE.
 *
 * `findings_patch` replaces finding objects BY ORDINAL and touches nothing else; `narrative` fields
 * replace their counterparts section by section. Anything not named survives byte-identical, which is
 * the property the corrective pass's scope declaration depends on — the driver compares the findings it
 * did not expect to move, and a merge that re-serialised everything would make that comparison vacuous.
 *
 * A patch naming an ordinal the stored call does not hold is a DEFECT, not an insert: the repair
 * ladder only ever patches findings the parse already quarantined, so an unknown ordinal means the seat
 * is repairing something this run does not have.
 *
 * Returns `{ok: true, merged, lifted}`, where `lifted` counts the rows taken from inside a list-less
 * `findings`, or `{ok: false, reason}`.
 */
export function mergeSynthesisPatch(stored, patch) {
  if (!stored) return { ok: false, reason: "synthesis_patch_without_base: this run has no accepted synthesis call to patch — send the complete `narrative` and `findings` instead. A patch is a repair of values the driver is holding, and it is holding none" };
  const out = { narrative: { ...stored.narrative }, findings: { ...stored.findings } };
  // A WHOLE `findings` REPLACES the stored record. That is the schema-migration rung: the key set
  // itself changes shape, so there is no set of named findings to correct and the seat re-emits. It
  // still arrives here rather than as a first call, because it carries no narrative — and the narrative
  // it is not being asked to redo is the stored one. Without this the rung could not succeed: the call
  // was refused for `synthesis_narrative_missing`, naming sections nobody had asked the seat to resend.
  //
  // A `findings` OBJECT WITH NO LIST is the other shape (`registerPatchOf`): each register it carries replaces
  // the stored one and the rest are held, and rows sent inside it are applied as rows. Precedence: the stored
  // record, then those registers, then the call's top-level registers (copied last, below); a register sent in both
  // places carries one value there, so the order chooses nothing. Rows replace whole findings by ordinal; narrative
  // sections replace sections.
  const asRegisters = registerPatchOf(stored, patch);
  if (asRegisters) Object.assign(out.findings, asRegisters.registers);
  else if (patch?.findings !== undefined) out.findings = patch.findings;
  for (const [k, v] of Object.entries(patch?.narrative ?? {})) out.narrative[k] = v;
  const rows = asRegisters ? asRegisters.rows : patch?.findings_patch;
  if (rows != null) {
    if (!Array.isArray(rows)) return { ok: false, reason: "synthesis_patch_shape: `findings_patch` is an array of complete finding objects, each carrying the `ordinal` of the finding it replaces" };
    const byOrdinal = new Map((out.findings.findings ?? []).map((f, i) => [f?.ordinal, i]));
    for (const r of rows) {
      const at = byOrdinal.get(r?.ordinal);
      if (at === undefined) {
        return { ok: false, reason: `synthesis_patch_ordinal_unknown:${String(r?.ordinal)} — this run holds no finding with that ordinal, so this patch is aimed at a finding that does not exist. Send the ordinal as it appears in the record you emitted` };
      }
      out.findings.findings = [...(out.findings.findings ?? [])];
      out.findings.findings[at] = r;
    }
  }
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k !== "narrative" && k !== "findings_patch" && k !== "findings") out.findings[k] = v;
  }
  return { ok: true, merged: out, lifted: asRegisters?.lifted ?? 0 };
}

/**
 * The DRIVER's reads, gathered in one place: what this run committed at intake, what its plan actually
 * executed, and the framework it froze.
 *
 * None of these is a parameter of the call, and that is the whole point. A seat that could assert its
 * own intake asks could drop the one it did not answer; a seat that could assert its own
 * plan-execution receipt could waive the clean-claim join by handing an empty one. They are facts
 * about the run, so the driver reads them from the run.
 *
 * EVERY MISS IS AN ABSENCE, NEVER A ZERO. A missing or unreadable sidecar yields `[]`/`null`, which
 * turns the check that depends on it OFF — it never yields a passing verdict. `acceptSynthesis` knows
 * the difference and records it as `clean_claims_checked`.
 */
// The run's frozen method, read against its frozen manifest. No manifest: nothing to rate against, and
// the method stays unsaid (undefined) exactly as the manifest does.
function frozenMethodFor(dir0, manifest) {
  if (!manifest) return {};
  const r = readFrozenMethod(driverDir(dir0, FROZEN_METHOD_FILE), manifest);
  return r.invalid ? { method: null, methodInvalid: r.invalid } : { method: r.method };
}

export function driverReadsFor(runDir) {
  const dir0 = String(runDir ?? "");
  const read = (name) => {
    try { return JSON.parse(readFileSync(driverDir(dir0, name), "utf8")); }
    catch { return null; }
  };
  // The digest's coverage ledger sits in the RUN ROOT, not under `_driver/` — it is the WS-A machine
  // contract the digest publishes, and the writer is one of its readers.
  const readLedger = (d) => {
    try {
      const doc = JSON.parse(readFileSync(join(d, "register-coverage-ledger.json"), "utf8"));
      return Array.isArray(doc) ? doc : (Array.isArray(doc?.rows) ? doc.rows : null);
    } catch { return null; }
  };
  const asksRaw = read("intake-asks.json");
  // ── — WHAT THIS SEAT WAS HANDED, AND WHAT IT HAS DECLINED SO FAR ───────────────────────────
  //
  // A DRIVER READ AND NEVER A PARAMETER, for the reason stated at `acceptSynthesis`: a seat that could
  // assert its own owed list could waive its own contract. Both sides are read here so the acceptance
  // boundary stays pure and the arms can construct states the tree cannot yet produce.
  //
  // `owed` IS NULL WHEN THERE IS NO SPEC, and that is load-bearing rather than defensive. The spec is
  // written only when the findings surface has rows, and its write is non-fatal by design — so an
  // absent spec means the SEAT WAS NEVER ORDERED to decline, and a seat cannot be held to an order it
  // never got. An unparseable spec lands here too, and correctly: the decline tool could not have
  // served it either.
  //
  // `declined` SEPARATES AN ABSENT LEDGER FROM AN UNREADABLE ONE, which `readDeclinations` cannot —
  // its three-valued result folds both into `present:false`. No ledger is a real answer, and a common
  // one: nothing has been declined yet. A ledger that exists and will not parse is a could-not-look,
  // and reporting it as "nothing declined" would make every carried record read as unaccounted and
  // refuse a seat for a file it never wrote.
  const specRows = read("declination-spec.json")?.rows;
  let declined = [];
  try {
    const at = declinationCallPaths(dir0, 0).ledger;
    if (existsSync(at)) {
      const d = readDeclinations(dir0);
      declined = d.present ? [...d.byUri.keys()] : null;
    }
  } catch { declined = null; }
  return {
    asks: Array.isArray(asksRaw) ? asksRaw : [],
    ledger: readLedger(dir0),
    manifest: read("framework.json"),
    ...frozenMethodFor(dir0, read("framework.json")),
    owed: Array.isArray(specRows) ? specRows : null,
    declined,
  };
}

/**
 * THE DELIVERY BACKSTOP'S READ — the duty computed against the DELIVERED document.
 *
 * I ARGUED THIS COULD NOT FIRE AND I WAS WRONG, so the reasoning is here rather than the conclusion.
 * The acceptance boundary refuses a call that leaves a carried record with no exit, and the claim was
 * that nothing could then reach delivery unaccounted: the spec is written before the dispatch, the call
 * validates against the merged model, later declinations only add, and a seat that never satisfies the
 * refusal produces no accepted call — so the stage fails on its own.
 *
 * THE STATE THAT ENUMERATION MISSED is the corrective pass. `prepareDeclinationSpec` runs AGAIN before
 * it, and the surface can have grown in between, so the corrective pass is ordered against a LARGER owed
 * set than the main pass answered. If that call is refused, `rollbackCorrectivePass` restores the
 * pre-corrective `findings.json` and — by T3b's ruling, deliberately — THE RUN DELIVERS. The
 * document that ships satisfied the OLD owed set; the records added since are unaccounted, and no
 * acceptance boundary ever saw a call about them, because the only call that was ordered against them
 * was the one that got refused.
 *
 * So the backstop reads the delivered document rather than any call, which is the one place that state
 * is visible. Everything else about the design stands: this is a second net over one reachable path, not
 * a duplicate of the refusal.
 *
 * Returns the reconcile result; `computable:false` on any side the run cannot answer for, and the floor
 * never blocks on that.
 */
export function synthesisDutyForRun(runDir) {
  const dir0 = String(runDir ?? "");
  const { owed, declined } = driverReadsFor(dir0);
  let deliveredUris = null;
  try {
    const doc = parseFindingsJson(readFileSync(join(dir0, FINDINGS_FILE), "utf8"));
    const findings = Array.isArray(doc?.findings) ? doc.findings : (Array.isArray(doc) ? doc : null);
    if (findings) deliveredUris = [...findingUris(findings).keys()];
  } catch { deliveredUris = null; }   // unreadable ⇒ could-not-look, never "delivered nothing"
  return reconcileDeclinationDuty({ owed, deliveredUris, declinedUris: declined });
}

/**
 * Capture what arrived, validate, and write BOTH artifacts — in that order.
 *
 * The capture happens BEFORE the decision, as in every sibling transport: a payload recorded after
 * validation records what we DECIDED, which is already in the answer, rather than what we were GIVEN.
 *
 * BOTH FILES OR NEITHER. `findings.json` is written first and the narrative second, and a failure on
 * the second returns `write_failed` rather than a partial success — a run holding a findings record
 * with no narrative reads to every downstream existsSync as "synthesis done", and several of them
 * (`digestLocked`, the resume guards) key on `narrative.md` alone.
 */
export function recordSynthesis(runDir, received, opts = {}) {
  const dir0 = String(runDir ?? "");
  // The driver's reads default to the RUN's, and stay overridable for tests. A call site that had to
  // remember to pass them is a call site that can forget: the reviewer transport's `receiptPresent`
  // learned the same lesson one lane over.
  const auto = driverReadsFor(dir0);
  const { asks = auto.asks, ledger = auto.ledger, manifest = auto.manifest,
    method = auto.method, methodInvalid = auto.methodInvalid ?? null,
    owed = auto.owed, declined = auto.declined, recordOrigins = undefined,
    now = () => new Date().toISOString() } = opts;
  const { dir, payload, accepted, refusals } = synthesisCallPaths(dir0);
  // Its sibling rule — ONE FILE PER CALL, refusals included. This used to
  // write `payload` every time, so a turn refused twice and accepted on the third kept only the accepted
  // shape: the file promising "including calls that were refused" held the one call that was not.
  // Sequence 1 resolves to the existing `call-001.json`, so every consumer reading that name is unmoved.
  const nameFor = (seq) => join(dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  // The verdict is stamped onto THIS call's record below, so a refused shape and the refusal that names
  // it can be read side by side. Best-effort throughout: a lost capture never fails a run.
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  // A PARTIAL IS A CALL CARRYING ONLY ONE HALF. Detected by shape rather than by a mode flag: a flag is
  // a second way to say the same thing and the two can disagree. Either half may be the missing one —
  // a corrective sends findings changes with no narrative rewrite, a schema migration re-emits the
  // whole record and touches no section — and in both cases the half not sent is the stored one.
  // A call whose `findings` carries NO LIST is a patch too, on the registers it carries, where there is a stored
  // record to patch and the call reads that way (`registerPatchOf`); any other shape is read as it always was.
  // The call is decided on AS READ (`readSynthesisCall`): a marker sent as a JSON string is decoded first. The
  // capture above keeps what arrived; the base written below keeps the call as read.
  const stored = lastAcceptedCall(dir0);
  const read = readSynthesisCall(received, stored);
  let call = read.call;
  const asRegisters = registerPatchOf(stored, call);
  const isPatch = Boolean(call) && (call.findings === undefined || call.narrative === undefined || asRegisters !== null);
  // WHAT THE TRANSPORT READ THE CALL AS: one run-log row at whichever exit the call takes, beside the decision,
  // when the reading decoded, lifted, overrode or ignored anything. Never in the answer below, which the tool
  // returns whole into the model's turn. Best-effort, as the foreign-link record is. A lift is counted as READ,
  // so one the merge then refuses is on the record as one the acceptance refuses is.
  const reading = { ...read.notes, lifted: asRegisters?.lifted ?? 0 };
  const recordReading = (accepted) => {
    if (!reading.decoded.length && !reading.lifted && !reading.overridden.length && !reading.keysIgnored && !reading.rowsIgnored) return;
    try {
      runLog(dir0, { event: "synthesis-call-normalised", stage: "synthesis", seq: cap.seq ?? null, accepted,
        decoded: reading.decoded, lifted: reading.lifted, overridden: reading.overridden,
        keysIgnored: reading.keysIgnored, rowsIgnored: reading.rowsIgnored, rowsDiffering: reading.rowsDiffering });
    } catch { /* a log that cannot be written must not stop the record it describes */ }
  };
  // Appended, never overwritten: a turn can be refused more than once and each one is a fact about the
  // run. Best-effort — bookkeeping that can kill a run is worse than bookkeeping that is absent.
  const noteRefusal = (reason) => {
    try { appendFileSync(refusals, JSON.stringify({ at: now(), reason }) + "\n"); } catch { /* best-effort */ }
  };

  if (isPatch) {
    const merged = mergeSynthesisPatch(stored, call);   // the call as READ: a decoded marker merges as an object
    if (!merged.ok) {
      noteRefusal(merged.reason);
      recordReading(false);
      return { written: null, refused: merged.reason,
        captured: closeCapture({ ok: false, refused: merged.reason }), capture_failed: captureFailed };
    }
    call = merged.merged;
  }

  // A RECORD LINK ON A HOST THIS REGISTER DOES NOT PUBLISH is gated here as verify.mjs gates the saved
  // file. The run's first such call is refused, naming every finding, so the seat can fix them in this
  // turn; a repeat is accepted with those links blanked and the originals kept (foreign-record-links.mjs).
  const origins = recordOriginsOr(recordOrigins);
  const repeat = blankOnRepeat(call, origins, refusalsFor(dir0).some((r) => String(r?.reason ?? "").includes(FOREIGN_HOST_TOKEN)));
  if (repeat.blanked.length) {
    call = repeat.call;
    recordBlanking(dir0, { stage: "synthesis", layer: "call", blanked: repeat.blanked, kept: repeat.kept });
  }
  const v = acceptSynthesis(call, { asks, ledger, manifest, method, methodInvalid, owed, declined, recordOrigins: origins });
  if (!v.ok) {
    noteRefusal(v.reason);
    recordReading(false);
    return { written: null, refused: v.reason,
      captured: closeCapture({ ok: false, refused: v.reason }), capture_failed: captureFailed };
  }

  const findingsAt = join(dir0, FINDINGS_FILE);
  const narrativeAt = join(dir0, NARRATIVE_FILE);
  try {
    writeFileSync(findingsAt, v.findings);
    writeFileSync(narrativeAt, v.narrative);
    // The merge base for the NEXT repair, stored only now — after the values passed. A base written
    // before validation would let a refused call become what the next patch is built on.
    writeFileSync(accepted, JSON.stringify({
      _provenance: "the last ACCEPTED call, merged if it arrived as a patch — the base a later repair patches onto",
      acceptedAt: now(), params: call,
    }, null, 2) + "\n");
  } catch (e) {
    // The call was VALID and we could not store it. That is infrastructure, and it must not read as a
    // rejected call — the two have opposite repairs.
    recordReading(false);
    return {
      written: null, refused: null,
      write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: true }), capture_failed: captureFailed,
    };
  }
  // ONCE THE DELIVERY SEAM IS PASSED, THE RECORD IS FOLDED AGAIN ON ACCEPTANCE (design, 2026-10-03). The
  // call records above stay the model's own, the base for its next patch; findings.json becomes the folded
  // record the reviewer, the cards and the delivery read. Before the seam this leaves the record as written.
  foldAfterSave(dir0, findingsAt);
  recordReading(true);

  return {
    written: [findingsAt, narrativeAt], refused: null,
    coverage_rows: v.coverage_rows, findings: v.findings_count,
    coverage_limits_checked: v.coverage_limits_checked,
    captured: closeCapture({ ok: true }), capture_failed: captureFailed,
  };
}

/** Every call this run turned away, in order — the run's own record that a defect was met and corrected. */
export function refusalsFor(runDir) {
  try {
    return readFileSync(synthesisCallPaths(String(runDir ?? "")).refusals, "utf8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

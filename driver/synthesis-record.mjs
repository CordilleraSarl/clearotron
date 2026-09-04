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
// ── WHAT THIS DOES *NOT* CONVERT, AND IT IS AN OWNER RULING, NOT AN OVERSIGHT ──────────────────────
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
import { writeFileSync, appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join, dirname } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { parseFindingsJson, COVERAGE_AREA_STATES } from "./findings-model.mjs";
import { findCoverageRecommendations } from "./verify.mjs";
import { declinationCallPaths, readDeclinations } from "./declination-tool.mjs";   // — the seat's own declines, read by the driver never asserted by the seat
import { reconcileDeclinationDuty, declinationDutyRefusal } from "./declination-duty.mjs";
import { findingUris } from "./record-carry.mjs";   // one derivation of "which records did the findings name", called not copied

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
    return st !== "" && st !== "confirmed-clean" && st !== "note";
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
export function acceptSynthesis(params, { asks = [], ledger = null, manifest = null, owed = null, declined = null } = {}) {
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
  const rows = Array.isArray(doc.coverage) ? doc.coverage : [];
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
  // "and there is no third way out" — and the driver then accepted whatever came back. On the R2 round
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
  const findings = renderFindings(doc);

  // ── THE ROUND-TRIP. Rendered bytes → the shipped parsers → exactly what was asked for. ───────────
  // With the refusals above most of these cannot fire, which is the point: they are the assertion that
  // this renderer and verify.mjs still agree, kept where a drift surfaces as a refusal the seat sees
  // rather than as a verdict the driver misreads.
  try { parseFindingsJson(findings, manifest ? { manifest } : {}); }
  catch (e) {
    return { ok: false, reason: `synthesis_findings_invalid: ${String(e?.message ?? e).slice(0, 300)}` };
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
 */
export function mergeSynthesisPatch(stored, patch) {
  if (!stored) return { ok: false, reason: "synthesis_patch_without_base: this run has no accepted synthesis call to patch — send the complete `narrative` and `findings` instead. A patch is a repair of values the driver is holding, and it is holding none" };
  const out = { narrative: { ...stored.narrative }, findings: { ...stored.findings } };
  // A WHOLE `findings` REPLACES the stored record. That is the schema-migration rung: the key set
  // itself changes shape, so there is no set of named findings to correct and the seat re-emits. It
  // still arrives here rather than as a first call, because it carries no narrative — and the narrative
  // it is not being asked to redo is the stored one. Without this the rung could not succeed: the call
  // was refused for `synthesis_narrative_missing`, naming sections nobody had asked the seat to resend.
  if (patch?.findings !== undefined) out.findings = patch.findings;
  for (const [k, v] of Object.entries(patch?.narrative ?? {})) out.narrative[k] = v;
  const rows = patch?.findings_patch;
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
  return { ok: true, merged: out };
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
 * pre-corrective `findings.json` and — by T3b's owner ruling, deliberately — THE RUN DELIVERS. The
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
    owed = auto.owed, declined = auto.declined,
    now = () => new Date().toISOString() } = opts;
  const { dir, payload, accepted, refusals } = synthesisCallPaths(dir0);
  // 's sibling, — ONE FILE PER CALL, refusals included. This used to
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
  const isPatch = Boolean(received) && (received.findings === undefined || received.narrative === undefined);
  let call = received;
  // Appended, never overwritten: a turn can be refused more than once and each one is a fact about the
  // run. Best-effort — bookkeeping that can kill a run is worse than bookkeeping that is absent.
  const noteRefusal = (reason) => {
    try { appendFileSync(refusals, JSON.stringify({ at: now(), reason }) + "\n"); } catch { /* best-effort */ }
  };

  if (isPatch) {
    const merged = mergeSynthesisPatch(lastAcceptedCall(dir0), received);
    if (!merged.ok) {
      noteRefusal(merged.reason);
      return { written: null, refused: merged.reason,
        captured: closeCapture({ ok: false, refused: merged.reason }), capture_failed: captureFailed };
    }
    call = merged.merged;
  }

  const v = acceptSynthesis(call, { asks, ledger, manifest, owed, declined });
  if (!v.ok) {
    noteRefusal(v.reason);
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
    return {
      written: null, refused: null,
      write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: true }), capture_failed: captureFailed,
    };
  }

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

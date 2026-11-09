// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// narrative-refutation-record.mjs — the recording transport for the reviewer's verdict and typed flags.
//
// The reviewer is the report's only check, and until now it wrote its own review as free prose with
// Write/Edit. Everything downstream then parsed that prose back out: the verdict token, the flag list,
// the optional `[kind:]` and `[on:]` channels, and the count that decides whether a BLOCKING is
// degenerate. The seat chose the enumeration style, so the parse could miss — the lettered flags
// were invisible for exactly that reason, and records a second walk that could not see `**1.`.
//
// The seat now hands VALUES and the driver renders the document. The style becomes the driver's, so
// "the parse missed the reviewer's flags" stops being a thing that can happen rather than a thing that
// is detected afterwards.
//
// ── IT VALIDATES THROUGH THE SHIPPED PARSERS, NOT A COPY ───────────────────────────────────────────
//
// Same posture as skeptic-record.mjs: after rendering, this module re-reads its own bytes through the
// FOUR functions the pipeline actually runs against this file — `parseVerdict`, `countCitedDefects`,
// `parseCorrectionKinds` and `correctionFlagContent` — and refuses on any disagreement. A transport
// that rendered by its own idea of the shape while verify.mjs kept its own regexes would rebuild the
// dictated-shape-with-a-second-parser seam this whole category exists to close.
//
// ── WHY THE FIX LINE CARRIES NO LIST MARKER, AND IT IS NOT COSMETIC ────────────────────────────────
//
// `countCitedDefects` walks every list line outside the plan-audit section and applies NO body rule —
// its own comment says so, deliberately, because it decides whether to DISCARD a review and permissive
// evidence is the safe side there. So a `- Fix: …` sub-bullet under a flag would be counted as a
// SECOND cited defect, and a review with three flags would report six. The fix renders as an indented
// `Fix: …` continuation with no marker: `LIST_MARKER` needs `[-*•]`, a digit, or a single letter
// followed by `.` or `)`, and `Fix:` is none of those. The round-trip below is what proves it.
//
// ── THE SEAT DOES NOT NUMBER ITS OWN FLAGS ─────────────────────────────────────────────────────────
//
// `n` is the render's, taken from array order. A seat-supplied number is a value that can disagree with
// the list it labels — duplicated, skipped, or renumbered by a corrective pass — and nothing downstream
// would notice. Removing the field removes the defect (the doubt-closure `file_index` rule).
import { writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { captureCall, mergeCapture, nextSeq } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { parseVerdict, countCitedDefects, parseCorrections, parseCorrectionKinds, correctionFlagContent, CORRECTION_KINDS, SECTION_HEADING_RE } from "./verify.mjs";
import { readJson } from "./run-record.mjs";

export const REVIEW_FILE = "senior-eye-review.md";

/** The verdicts this stage may return. `parseVerdict` reads more shapes than these; it emits only these. */
export const REVIEW_VERDICTS = ["CLEAR", "CONDITIONAL", "BLOCKING"];

/** Where the call's evidence lives — the driver's own record of what the seat handed it. */
export function refutationCallPaths(runDir) {
  const dir = driverDir(runDir, "refutation-calls");
  return { dir, payload: join(dir, "call-001.json") };
}

/**
 * The writer's excluded positions the last review was shown, by each of their record ids: record id → the position's
 * own id, as the driver wrote them beside the review's message (pipeline.mjs writerExclusionBlock). null when none
 * was written or it cannot be read, so a flag naming a position is refused rather than guessed at. Never throws.
 */
export const REVIEW_EXCLUSIONS_FILE = "review-exclusions.json";
export function listedExclusionPositions(runDir) {
  try {
    const doc = readJson(driverDir(String(runDir ?? ""), REVIEW_EXCLUSIONS_FILE));
    const out = new Map();
    for (const p of Array.isArray(doc?.positions) ? doc.positions : [])
      for (const m of [p?.uri, ...(Array.isArray(p?.members) ? p.members : [])]) { const k = String(normalizeRecordUri(m) ?? ""); if (k && p?.uri) out.set(k, p.uri); }
    return out;
  } catch { return null; }
}

/** Whether this run has a plan-execution receipt, which is what makes the audit section mandatory. */
export function planReceiptPresent(runDir) {
  try { return existsSync(driverDir(String(runDir ?? ""), "plan-execution.json")); }
  catch { return false; }
}

/**
 * Render senior-eye-review.md from typed values. PURE, and the single authority for the shape.
 *
 * Verdict on line 1 — `countCitedDefects` drops exactly one line before it starts walking, and
 * `parseVerdict` reads the first three non-empty lines.
 *
 * The plan audit renders LAST. `countCitedDefects` latches `inPlanAudit` at its heading and unlatches
 * at the next one, so a flag rendered after it would be counted only because a later heading happens to
 * reset the latch. Ordering it last means the exclusion never depends on that.
 */
export function renderRefutation(verdict, flags, planAudit) {
  const out = [String(verdict), ""];
  if (flags.length) {
    out.push("## Flags", "");
    flags.forEach((f, i) => {
      const on = Array.isArray(f.on) && f.on.length ? f.on.join(", ") : "-";
      // NO BOLD WRAPPER AROUND THE TOKENS, AND THAT IS A MEASUREMENT NOT A PREFERENCE. `parseCorrections`
      // strips `[kind:]` and `[on:]` out of the line to build the corrective worklist's `text`, but it
      // does not strip markup left behind by their removal: with `**[kind: …] [on: …]**` the worklist
      // entry came back as `** ** the summary says …`. The corrective pass acts on that text, so the
      // stray markers would ride into the instruction the next seat is given.
      // A flag about a writer's exclusion names its position; the token is written only then, so a review without one
      // renders as it always did.
      const positions = Array.isArray(f.positions) && f.positions.length ? ` [positions: ${f.positions.join(", ")}]` : "";
      out.push(`${i + 1}. [kind: ${f.kind}] [on: ${on}]${positions} ${f.text}`);
      if (f.fix) out.push(`   Fix: ${f.fix}`);
      out.push("");
    });
  } else {
    out.push("No flags raised.", "");
  }
  if (planAudit && planAudit.length) {
    out.push("## PLAN-EXECUTION CHECK", "");
    for (const l of planAudit) out.push(planAuditLine(l));
    out.push("");
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

// ── A PLAN-AUDIT LINE CANNOT OPEN A SECTION ─────────────────────────────────────────────────────────
//
// The audit's lines are the reviewer's own, and the parsers read a markdown heading or a line of capitals as
// a section heading. One that names corrections ("CORRECTION REVIEW SCOPE", written by a recheck after a
// correction) became the document's corrections section: `parseCorrections` then read only what followed it,
// the flags above it counted none, and the round-trip refused both calls of a recheck as
// `refutation_roundtrip_kinds:fact` (measured on a saved recheck, 2026-11-03). Any heading-shaped line also
// ends the audit for `countCitedDefects`. Such a line renders in bold, its words unchanged: it still reads as
// a sub-heading, and no parser reads it as one. The heading test is the parsers' own (verify.mjs).
function planAuditLine(line) {
  const s = String(line);
  const t = s.trim();
  return SECTION_HEADING_RE.test(t) ? `**${t.replace(/^#{1,6}\s+/, "")}**` : s;
}

const HEADING_OR_LIST = /^\s*(?:#{1,6}\s|(?:\*{0,2})(?:[-*•]|\d+[.)]|[A-Za-z][.)])(?:\*{0,2})\s)/;
const textDefect = (t) => {
  if (typeof t !== "string" || !t.trim()) return "empty";
  if (/[\r\n]/.test(t)) return "multiline";
  if (HEADING_OR_LIST.test(t)) return "opens_as_a_list_or_heading";
  return null;
};

/**
 * Assemble the artifact from typed params and validate the RENDERED BYTES through the shipped parsers.
 *
 * Returns `{ok: true, content, …}` or `{ok: false, reason}` with a token-first message, so the seat
 * meets the defect in the turn where restating is free.
 *
 * `receiptPresent` is the DRIVER's read, never a parameter of the call: whether the audit section is
 * owed is a fact about the run, and a seat that could assert it could waive its own audit.
 */
export function acceptRefutation(params, { receiptPresent = false, positionsListed = null } = {}) {
  const verdict = params?.verdict;
  const flags = params?.flags;
  const planAudit = params?.plan_audit;

  if (!REVIEW_VERDICTS.includes(verdict)) {
    return { ok: false, reason: `refutation_verdict_invalid:${String(verdict).slice(0, 40)} — one of ${REVIEW_VERDICTS.join(" / ")}` };
  }
  if (!Array.isArray(flags)) {
    return { ok: false, reason: "refutation_flags_missing: `flags` must be an array — [] IS the clean answer; omitting the field is not an answer" };
  }
  if (verdict === "BLOCKING" && flags.length === 0) {
    // The degenerate-BLOCKING shape, refused at the point it is typed rather than at the gate
    // thousands of lines later, where its only repair is one forced-fresh re-ask of the whole stage.
    return { ok: false, reason: "refutation_blocking_without_flags: a BLOCKING verdict with no flags is a refusal to sign that names nothing — cite at least one concrete, file-anchored defect, or return CONDITIONAL" };
  }
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (!CORRECTION_KINDS.includes(f?.kind)) {
      return { ok: false, reason: `refutation_kind_invalid:${i}:${String(f?.kind).slice(0, 40)} — one of ${CORRECTION_KINDS.join(", ")}` };
    }
    const td = textDefect(f?.text);
    if (td) return { ok: false, reason: `refutation_flag_text_${td}:${i} — one flag per entry, one line, naming the file and the exact claim` };
    if (f?.fix != null) {
      const fd = textDefect(f.fix);
      if (fd) return { ok: false, reason: `refutation_flag_fix_${fd}:${i} — the fix is one line describing the targeted edit, or omit it` };
    }
    if (f?.on != null) {
      if (!Array.isArray(f.on) || f.on.some((n) => !Number.isInteger(n) || n < 1)) {
        return { ok: false, reason: `refutation_flag_on_invalid:${i} — \`on\` is an array of finding ordinals (1-based), or omit it for a flag about the document rather than a finding` };
      }
    }
    if (f?.positions != null) {
      if (!Array.isArray(f.positions) || !f.positions.length || f.positions.some((p) => typeof p !== "string" || !p.trim())) {
        return { ok: false, reason: `refutation_flag_positions_invalid:${i} — \`positions\` is an array of record ids from the writer's exclusions list, or omit it` };
      }
      const unknown = f.positions.find((p) => !positionsListed?.get(String(normalizeRecordUri(p) ?? "")));
      if (unknown != null) {
        return { ok: false, reason: `refutation_flag_position_unlisted:${i}:${String(unknown).slice(0, 80)} — name a position by a record id the writer's exclusions list gives for it` };
      }
    }
  }
  if (receiptPresent && !(Array.isArray(planAudit) && planAudit.length)) {
    return { ok: false, reason: "refutation_plan_audit_missing: this run has a plan-execution receipt, so the review must carry the PLAN-EXECUTION CHECK — hand its lines in `plan_audit`. A review that skipped it has not audited whether clean claims rest on unexecuted slices" };
  }
  if (planAudit != null && !Array.isArray(planAudit)) {
    return { ok: false, reason: "refutation_plan_audit_shape: `plan_audit` is an array of lines" };
  }

  // A position is rendered as the list keys it, whichever of its record ids the flag named.
  const byPosition = (p) => positionsListed.get(String(normalizeRecordUri(p) ?? ""));
  const rendered = flags.map((f) => (Array.isArray(f?.positions) ? { ...f, positions: [...new Set(f.positions.map(byPosition))] } : f));
  const content = renderRefutation(verdict, rendered, planAudit);

  // ── THE ROUND-TRIP. Rendered bytes → the four shipped parsers → exactly what was asked for. ───────
  // With the refusals above none of these can fire, which is the point: they are the assertion that
  // this renderer and verify.mjs still agree, kept where a drift surfaces as a refusal the seat sees
  // rather than as a verdict the driver misreads.
  const back = parseVerdict(content);
  if (back !== verdict) {
    return { ok: false, reason: `refutation_roundtrip_verdict: the rendered file parses as ${String(back)} but the call said ${verdict} — a transport defect, not a judgment one` };
  }
  const cited = countCitedDefects(content);
  if (cited !== flags.length) {
    return { ok: false, reason: `refutation_roundtrip_cited: the rendered file counts ${cited} cited defect(s) for ${flags.length} flag(s) — the render and countCitedDefects disagree about what a flag line is` };
  }
  const kinds = parseCorrectionKinds(content);
  const want = Object.fromEntries(CORRECTION_KINDS.map((k) => [k, 0]));
  for (const f of flags) want[f.kind]++;
  const mismatch = CORRECTION_KINDS.find((k) => (kinds?.counts?.[k] ?? 0) !== want[k]);
  if (mismatch) {
    return { ok: false, reason: `refutation_roundtrip_kinds:${mismatch} — the rendered file partitions ${kinds?.counts?.[mismatch] ?? 0} to \`${mismatch}\` where the call typed ${want[mismatch]}; the \`[kind:]\` channel did not survive the render` };
  }
  if ((kinds?.untyped ?? 0) !== 0) {
    return { ok: false, reason: `refutation_roundtrip_untyped:${kinds.untyped} — every flag was typed in the call, so a line landing on the \`fact\` fail-safe means the token did not render onto it` };
  }

  // `flags` stays a COUNT because that is what its readers assert; `acceptedFlags` is the array itself.
  // ADDED rather than repurposed: changing what `flags` means would move every reader silently, and a
  // field with two meanings across a version boundary is the shape this repo keeps finding.
  //
  // WHY THE ARRAY HAS TO LEAVE THIS FUNCTION AT ALL (T3b). The corrective pass builds
  // its worklist by RE-PARSING the rendered markdown through `parseCorrections`. That parse is exactly
  // what the conversion removed the need for — the flags were typed values a moment earlier — and it can
  // miss, which is the defect the whole conversion exists to close. A consumer that reads the accepted
  // array cannot disagree with the document, because the document was rendered from it.
  return {
    ok: true, content, verdict, flags: flags.length, acceptedFlags: flags,
    cited, planAudited: Boolean(planAudit && planAudit.length),
  };
}

/**
 * Capture what arrived, validate, and write the artifact — in that order.
 *
 * The capture happens BEFORE the decision, as in every sibling transport: a payload recorded after
 * validation records what we DECIDED, which is already in the answer, rather than what we were GIVEN.
 */
export function recordRefutation(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const dir0 = String(runDir ?? "");
  const { dir, payload } = refutationCallPaths(dir0);
  // — the sequence is allocated ONCE PER CALL, and both writes below target it. The
  // two-write pattern already here (T3b) was right about one call and silent across calls: it wrote to a
  // fixed filename, so a second call replaced the first call's evidence entirely. `accepted` and
  // `refusedReason` keep their spelling and stay TOP-LEVEL — a test reads `refusedReason` today, and
  // moving it to match a sibling would break a reader to tidy a writer.
  const nameFor = (seq) => join(dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, extra: { accepted: null, refusedReason: null }, now });
  let captureFailed = cap.failed;
  const capture = (outcome) => { if (!mergeCapture(cap.path, outcome)) captureFailed ??= "the outcome could not be merged into the capture"; };

  // ✕ CAPTURED TWICE, AND THE SECOND WRITE IS THE POINT (T3b).
  //
  // The capture ran ONCE, before validation, to a fixed filename — so a refused call and an accepted one
  // left byte-identical evidence and nothing on disk said which. On a turn where the seat sends a
  // degenerate review, is refused, and corrects, the file ends up right by luck of write order; on a turn
  // where the LAST call is refused, the file holds a review the driver never rendered and no reader could
  // tell. A consumer keying targeted fixes off that would act on a rejected review while looking
  // authoritative, which is worse than the prose regex it replaces.
  //
  // Written first so a call that CRASHES the validator still leaves its input — that was the original
  // reason and it survives — then rewritten with the verdict once there is one.
  capture({ accepted: null, refusedReason: null });
  const verdict = acceptRefutation(received, { receiptPresent: planReceiptPresent(dir0), positionsListed: listedExclusionPositions(dir0) });
  capture({ accepted: Boolean(verdict.ok), refusedReason: verdict.ok ? null : verdict.reason });
  if (!verdict.ok) {
    return { written: null, refused: verdict.reason, captured: captureFailed ? null : payload, capture_failed: captureFailed };
  }

  const at = join(dir0, REVIEW_FILE);
  try {
    writeFileSync(at, verdict.content);
  } catch (e) {
    // The call was VALID and we could not store it. That is infrastructure, and it must not read as a
    // rejected call — the two have opposite repairs.
    return {
      written: null, refused: null,
      write_failed: String(e?.message ?? e).slice(0, 200),
      captured: captureFailed ? null : payload, capture_failed: captureFailed,
    };
  }

  return {
    written: at, refused: null,
    verdict: verdict.verdict, flags: verdict.flags, cited: verdict.cited, plan_audited: verdict.planAudited,
    captured: captureFailed ? null : payload, capture_failed: captureFailed,
  };
}

/**
 * THE ACCEPTED FLAGS, AS TYPED — the input T3b keys targeted fixes off.
 *
 * Returns the flag objects the tool ACCEPTED, or `null` when there is nothing trustworthy to return.
 * Null covers four different states on purpose, and every one of them means "do not act on this":
 *
 *   no payload         the stage never called the tool
 *   unreadable payload the capture failed or the file is truncated
 *   `accepted: false`  the tool REFUSED this call — the review was never rendered
 *   `accepted: null`   the capture ran and the validator did not return, so nothing knows the outcome
 *
 * ✕ THE REFUSED CASE IS WHY THIS EXISTS RATHER THAN A BARE JSON READ. The payload is written before
 * validation, so a refused call leaves a complete, well-formed, entirely authoritative-looking record of
 * a review the driver never rendered. A consumer reading `params.flags` directly would key the corrective
 * pass off a review the tool rejected — confidently, and with no way to notice.
 *
 * The caller gets `null` and must decide what to do with it; it deliberately does not fall back to
 * parsing the document, because a silent fallback is how a reader stops being able to tell which source
 * it is looking at.
 */
export function readAcceptedFlags(runDir) {
  const { payload } = refutationCallPaths(String(runDir ?? ""));
  let doc;
  try { doc = readJson(payload); } catch { return null; }
  if (doc?.accepted !== true) return null;
  const flags = doc?.params?.flags;
  return Array.isArray(flags) ? flags : null;
}

/**
 * The sequence number the next review call will be captured under. A dispatch notes it BEFORE it runs, so the
 * calls that dispatch makes are exactly those numbered from it on. Never throws.
 */
export function nextRefutationSeq(runDir) {
  const { dir } = refutationCallPaths(String(runDir ?? ""));
  const nameFor = (seq) => join(dir, `call-${String(seq).padStart(3, "0")}.json`);
  let names = [];
  try { names = readdirSync(dir); } catch { names = []; }
  return nextSeq(names, nameFor) ?? 1000;
}

/**
 * THE LAST ACCEPTED REVIEW CALL FROM `seq0` ON, AS TYPED: `{seq, verdict, flags, planAudit}`, or null.
 *
 * The review after a delivery-check repair is a later call than the first review's, so `readAcceptedFlags`
 * (which opens the first call) cannot read it. A refused or unfinished call is skipped, as it is there: null
 * means there is no review from that dispatch the driver can act on, and its caller says so rather than
 * reading anything else in its place. Never throws.
 */
export function readAcceptedReviewSince(runDir, seq0) {
  const { dir } = refutationCallPaths(String(runDir ?? ""));
  let names = [];
  try { names = readdirSync(dir); } catch { return null; }
  const calls = names.map((n) => /^call-(\d+)\.json$/.exec(n)).filter(Boolean)
    .map((m) => ({ seq: Number(m[1]), file: join(dir, m[0]) }))
    .filter((c) => c.seq >= Number(seq0))
    .sort((a, b) => b.seq - a.seq);
  for (const c of calls) {
    let doc;
    try { doc = readJson(c.file); } catch { continue; }
    if (doc?.accepted !== true) continue;
    const p = doc?.params ?? {};
    return { seq: c.seq, verdict: p.verdict ?? null, flags: Array.isArray(p.flags) ? p.flags : [], planAudit: p.plan_audit ?? null };
  }
  return null;
}

// ── A REVIEW SAVED BY REWRITING THE FILE MEETS THE RULES THE TYPED ROUTE KEEPS ─────────────────────────────────────────
//
// A seat may save a review through the tool or by rewriting the file, and the recheck's message orders the rewrite. The
// file's validator asks for a verdict line and, on a receipt run, the audit's words somewhere in the file, so a review
// the tool refuses could be written into the file instead and read as the review of the corrected record: a BLOCKING
// that names nothing, or a flag on a position the writer's list does not give. Changed bytes show a review is fresh. They
// do not show it can be accepted.
//
// SO THE FILE IS READ BACK INTO THE VALUES THE TOOL TAKES, through the shipped parsers, and refused with the tool's own
// tokens. FORMATTING IS NOT WHAT IS REFUSED: a legacy line with no kind token still reads as `fact` (the validator's
// contract), and a flag with no `[on:]` stays undeclared. A BLOCKING is counted by the permissive walk the verdict gate
// uses, because refusing here discards a review. The check is one read of the file and sends nothing back to the seat.

/**
 * The plan audit's lines in a review file. It opens at a line naming the check that is not itself a flag, because a flag
 * that mentions the check audits nothing, and runs to the next heading at its own level or above that names the flags or
 * the corrections. Any other heading stays in: saved reviews write their audits under headings of their own, and refusing
 * a real audit over one is the worse mistake. Words after the name on its own line count: "PLAN-EXECUTION CHECK: every
 * slice ran" is an audit. PURE.
 */
export function planAuditLines(reviewMd) {
  const lines = String(reviewMd ?? "").split("\n").slice(1).map((l) => l.trim());
  const at = lines.findIndex((l) => /PLAN-EXECUTION CHECK/i.test(l) && correctionFlagContent(l) == null);
  if (at < 0) return [];
  const own = lines[at].replace(/^.*?PLAN-EXECUTION CHECK/i, "").replace(/^[^\p{L}\p{N}]+/u, "");
  const levelOf = (l) => /^(#{1,6})\s/.exec(l)?.[1].length ?? 6;   // a line of capitals has no level of its own
  const end = lines.findIndex((l, i) => i > at && SECTION_HEADING_RE.test(l) && /\b(?:flags?|flagged|corrections?)\b/i.test(l) && levelOf(l) <= levelOf(lines[at]));
  return [own, ...lines.slice(at + 1, end < 0 ? undefined : end)].filter((l) => l && !/^(?:#{1,6}\s+)?\W*PLAN-EXECUTION CHECK\W*$/i.test(l));
}

/**
 * The typed values of a review saved as a file, as `{ok: true, verdict, flags, planAudit}`, or `{ok: false, reason}` with
 * the token the tool refuses the same review with. `receiptPresent` and `positionsListed` are the driver's reads, as for
 * acceptRefutation. PURE.
 */
export function acceptReviewFile(content, { receiptPresent = false, positionsListed = null } = {}) {
  const text = String(content ?? "");
  const verdict = parseVerdict(text);
  if (!REVIEW_VERDICTS.includes(verdict)) return { ok: false, reason: `refutation_verdict_invalid:${String(verdict).slice(0, 40)}` };
  if (verdict === "BLOCKING" && countCitedDefects(text) === 0) return { ok: false, reason: "refutation_blocking_without_flags" };
  const flags = parseCorrections(text);
  for (let i = 0; i < flags.length; i++) {
    if (!String(flags[i].text ?? "").trim()) return { ok: false, reason: `refutation_flag_text_empty:${i}` };
    if ((flags[i].ordinals ?? []).some((n) => n < 1)) return { ok: false, reason: `refutation_flag_on_invalid:${i}` };
    const unknown = (flags[i].positions ?? []).find((p) => !positionsListed?.get(String(normalizeRecordUri(p) ?? "")));
    if (unknown != null) return { ok: false, reason: `refutation_flag_position_unlisted:${i}:${String(unknown).slice(0, 80)}` };
  }
  const planAudit = planAuditLines(text);
  if (receiptPresent && !planAudit.length) return { ok: false, reason: "refutation_plan_audit_missing" };
  return { ok: true, verdict, flags, planAudit };
}

/**
 * WHAT A RECHECK'S DISPATCH SAVED, whichever way it saved it, and what must stand in the file afterwards. `before` is the
 * review's text when the dispatch began, and `seq0` its first call number. Returns `{read, fail, refused, restore}`:
 *   read     `{by, seq}` when a review was saved that can be accepted, otherwise null
 *   fail     why nothing was read, on a stage that ended ok: `no-accepted-call`, or `file-save-refused:<token>`
 *   refused  the token of a direct save that was refused, whether or not a typed save stands in its place
 *   restore  the text the caller writes to the file, or null to leave it
 *
 * ONE DECISION, ONE READ OF THE FILE, AND NO RETRY. A refused direct save gives way to the dispatch's last accepted typed
 * call if there is one, and otherwise to the earlier review, so a verdict is never read from refused bytes and those bytes
 * do not stay in place of an accepted review. A stage that failed reads nothing, and whatever it left gives way to the
 * earlier review, whose verdict stands. Never throws on a file it cannot read: an absent review gives way the same way.
 */
export function settleRecheckSave(runDir, { before = null, stageOk = false, seq0 = 0 } = {}) {
  const dir0 = String(runDir ?? "");
  let now = null;
  try { now = readFileSync(join(dir0, REVIEW_FILE), "utf8"); } catch { now = null; }
  const earlierBack = before != null && now !== before ? before : null;
  if (!stageOk) return { read: null, fail: null, refused: null, restore: earlierBack };
  const rules = { receiptPresent: planReceiptPresent(dir0), positionsListed: listedExclusionPositions(dir0) };
  const call = readAcceptedReviewSince(dir0, seq0);
  const typed = call ? acceptRefutation({ verdict: call.verdict, flags: call.flags, plan_audit: call.planAudit }, rules) : null;
  const saved = typed?.ok ? typed.content : null;
  const byTool = saved != null ? { by: "tool", seq: call.seq } : null;
  if (saved != null && now === saved) return { read: byTool, fail: null, refused: null, restore: null };
  if (now == null || now === before) {
    return byTool ? { read: byTool, fail: null, refused: null, restore: saved } : { read: null, fail: "no-accepted-call", refused: null, restore: earlierBack };
  }
  const file = acceptReviewFile(now, rules);
  if (file.ok) return { read: { by: "file", seq: null }, fail: null, refused: null, restore: null };
  if (byTool) return { read: byTool, fail: null, refused: file.reason, restore: saved };
  return { read: null, fail: `file-save-refused:${file.reason}`, refused: file.reason, restore: earlierBack };
}

/** Read back what was written — the verdict view of the stored file, through the one parse. */
export function readRecordedVerdict(runDir) {
  try { return parseVerdict(readFileSync(join(String(runDir ?? ""), REVIEW_FILE), "utf8")); }
  catch { return null; }
}

/** The flag lines as the corrective ladder sees them — through the shipped selector, not a local one. */
export function readRecordedFlagLines(runDir) {
  try {
    return readFileSync(join(String(runDir ?? ""), REVIEW_FILE), "utf8")
      .split("\n").map((l) => correctionFlagContent(l)).filter(Boolean);
  } catch { return null; }
}

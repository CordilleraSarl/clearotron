// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// narrative-refutation-record.mjs — the recording transport for the reviewer's verdict and typed flags.
//
// The reviewer is the report's only check, and until now it wrote its own review as free prose with
// Write/Edit. Everything downstream then parsed that prose back out: the verdict token, the flag list,
// the optional `[kind:]` and `[on:]` channels, and the count that decides whether a BLOCKING is
// degenerate. The seat chose the enumeration style, so the parse could miss — 's lettered flags
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
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { captureCall, mergeCapture } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { parseVerdict, countCitedDefects, parseCorrectionKinds, correctionFlagContent, CORRECTION_KINDS } from "./verify.mjs";

export const REVIEW_FILE = "senior-eye-review.md";

/** The verdicts this stage may return. `parseVerdict` reads more shapes than these; it emits only these. */
export const REVIEW_VERDICTS = ["CLEAR", "CONDITIONAL", "BLOCKING"];

/** Where the call's evidence lives — the driver's own record of what the seat handed it. */
export function refutationCallPaths(runDir) {
  const dir = driverDir(runDir, "refutation-calls");
  return { dir, payload: join(dir, "call-001.json") };
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
      out.push(`${i + 1}. [kind: ${f.kind}] [on: ${on}] ${f.text}`);
      if (f.fix) out.push(`   Fix: ${f.fix}`);
      out.push("");
    });
  } else {
    out.push("No flags raised.", "");
  }
  if (planAudit && planAudit.length) {
    out.push("## PLAN-EXECUTION CHECK", "");
    for (const l of planAudit) out.push(String(l));
    out.push("");
  }
  return out.join("\n").replace(/\n+$/, "\n");
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
export function acceptRefutation(params, { receiptPresent = false } = {}) {
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
  }
  if (receiptPresent && !(Array.isArray(planAudit) && planAudit.length)) {
    return { ok: false, reason: "refutation_plan_audit_missing: this run has a plan-execution receipt, so the review must carry the PLAN-EXECUTION CHECK — hand its lines in `plan_audit`. A review that skipped it has not audited whether clean claims rest on unexecuted slices" };
  }
  if (planAudit != null && !Array.isArray(planAudit)) {
    return { ok: false, reason: "refutation_plan_audit_shape: `plan_audit` is an array of lines" };
  }

  const content = renderRefutation(verdict, flags, planAudit);

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
  // WHY THE ARRAY HAS TO LEAVE THIS FUNCTION AT ALL (, T3b). The corrective pass builds
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

  // ✕ CAPTURED TWICE, AND THE SECOND WRITE IS THE POINT (, T3b).
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
  const verdict = acceptRefutation(received, { receiptPresent: planReceiptPresent(dir0) });
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
  try { doc = JSON.parse(readFileSync(payload, "utf8")); } catch { return null; }
  if (doc?.accepted !== true) return null;
  const flags = doc?.params?.flags;
  return Array.isArray(flags) ? flags : null;
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

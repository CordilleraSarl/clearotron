// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// skeptic-record.mjs — the recording transport for the skeptic stage's flags + escalation decisions.
//
// The stage hands back VALUES; the driver renders skeptic-flags.md — the flag bullets, the clean
// sentinel and the machine-parsed `ESCALATE:` lines. The seat never formats the dictated line shape
// itself, so a malformed ESCALATE line cannot become a silent no-escalation. That silence is today's
// documented failure mode: stages.mjs's own contract for this stage records "a malformed ESCALATE line
// is a silent no-escalation, not a failure" — the parse recognises only the token-and-axis prefix, and
// nothing inspects what it does not match.
//
// ── IT VALIDATES THROUGH THE SHIPPED PARSER, NOT A COPY ─────────────────────────────────────────────
//
// `escalatedAxes` below IS the pipeline's escalation parse — pipeline.mjs imports it from here (the
// regex MOVED; it was inline at the dispatch site). After rendering, this module re-reads its own
// output through that function and refuses on any mismatch, so what the tool renders and what the
// driver later parses cannot drift: they are one function. A transport that rendered by its own idea
// of the shape while the pipeline kept its own regex would be the dictated-shape-with-a-second-parser
// seam this category exists to close.
//
// ── WHAT THE SCHEMA REMOVES RATHER THAN REFUSES ─────────────────────────────────────────────────────
//
// `axis` is an ENUM over REGISTER_AXES in the tool's input schema (doubt-closure-call.mjs's `file_index` rule:
// a validator that rejects a bad value has MOVED the defect; a schema that cannot express one has
// REMOVED it). A misspelled axis — which the dictated path parses as NO escalation, silently — becomes
// unrepresentable in a typed call. The enum is the FULL axis vocabulary: per-run narrowing to the
// ACTIVE axes stays the pipeline's, exactly as it is for the dictated path, where an inactive axis's
// line is ignored by the same filter.
//
// ── THE PARSER'S OWN TOKEN CANNOT BE SMUGGLED IN PROSE ──────────────────────────────────────────────
//
// Flag and reason text land inside the same file the escalation parse reads. A flag carrying its own
// "ESCALATE: <axis>" line would round-trip into a decision nobody typed into `escalations` — the
// shell-assembled-prose class, here as markdown. So free text is refused if it is multi-line or if it
// carries the ESCALATE token, and the post-render round-trip above is the belt to that brace.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { REGISTER_AXES } from "./coverage-ledger.mjs";

export const FLAGS_FILE = "skeptic-flags.md";

/**
 * THE escalation parse. One `ESCALATE: <axis>` line per axis to re-run; anything else is not an
 * escalation. Moved verbatim from pipeline.mjs's skeptic dispatch (the sole consumer) so the transport
 * and the dispatch read the same shape through the same function. Empty/absent text ⇒ no escalations —
 * the clean AND the skeptic-skipped path.
 */
export function escalatedAxes(flagsText, axes) {
  const flags = String(flagsText ?? "");
  if (!flags) return [];
  return axes.filter((a) =>
    new RegExp(`(^|\\n)\\s*[-*]?\\s*ESCALATE:\\s*${a.replace(/[-]/g, "\\-")}\\b`, "i").test(flags));
}

/** Where the call's evidence lives — the driver's own record of what the seat handed it. */
export function skepticCallPaths(runDir) {
  const dir = driverDir(runDir, "skeptic-calls");
  return { dir, payload: join(dir, "call-001.json") };
}

/**
 * Render skeptic-flags.md from typed values. PURE, and the single authority for the artifact's shape:
 * the flag bullets, the "no flags surfaced" clean sentinel (the literal verify.mjs's validator keys
 * on), the dictated final section title, and the `ESCALATE: <axis> — <reason>` / `ESCALATE: none`
 * lines the pipeline parses.
 */
export function renderSkepticFlags(flags, escalations) {
  const out = [];
  if (flags.length) {
    out.push("## Flags", "");
    for (const f of flags) out.push(`- ${f}`);
  } else {
    out.push("no flags surfaced");
  }
  out.push("", "## Escalation decisions", "");
  if (escalations.length) for (const e of escalations) out.push(`ESCALATE: ${e.axis} — ${e.reason}`);
  else out.push("ESCALATE: none");
  return out.join("\n") + "\n";
}

const ESCALATE_TOKEN = /ESCALATE\s*:/i;
const lineDefect = (text) => {
  if (typeof text !== "string" || !text.trim()) return "empty";
  if (/[\r\n]/.test(text)) return "multiline";
  if (ESCALATE_TOKEN.test(text)) return "carries_escalate_token";
  return null;
};

/**
 * Assemble the artifact from typed params, and validate the RENDERED BYTES through the same
 * `escalatedAxes` the pipeline runs against the file.
 *
 * Returns `{ok: true, content, flags, escalations}` or `{ok: false, reason}` with a token-first
 * message — the seat reads the defect in this turn rather than meeting a silent no-escalation two
 * stages later. PURE.
 */
export function acceptSkeptic(params) {
  const flags = params?.flags;
  const escalations = params?.escalations;
  if (!Array.isArray(flags)) {
    return { ok: false, reason: "skeptic_flags_missing: `flags` must be an array — [] IS the clean answer (it renders the \"no flags surfaced\" sentinel); omitting the field is not an answer" };
  }
  if (!Array.isArray(escalations)) {
    return { ok: false, reason: "skeptic_escalations_missing: `escalations` must be an array — [] IS a decision (it renders \"ESCALATE: none\"); omitting the field is not one" };
  }
  for (let i = 0; i < flags.length; i++) {
    const d = lineDefect(flags[i]);
    if (d === "carries_escalate_token") {
      return { ok: false, reason: `skeptic_flag_carries_escalate_token:${i} — escalation is decided by the \`escalations\` field, never by prose; an ESCALATE token inside a flag would be re-parsed as a decision nobody typed` };
    }
    if (d) return { ok: false, reason: `skeptic_flag_${d}:${i} — one flag per entry, one line each, citing the affected worker/axis/finding` };
  }
  const seen = new Set();
  for (const e of escalations) {
    const axis = e?.axis;
    if (!REGISTER_AXES.includes(axis)) {
      return { ok: false, reason: `skeptic_axis_invalid:${String(axis).slice(0, 40)} — valid axes: ${REGISTER_AXES.join(", ")}` };
    }
    if (seen.has(axis)) return { ok: false, reason: `skeptic_axis_duplicate:${axis} — one escalation per axis` };
    seen.add(axis);
    const d = lineDefect(e?.reason);
    if (d === "carries_escalate_token") return { ok: false, reason: `skeptic_reason_carries_escalate_token:${axis} — the rendered line already carries the token; a second one inside the reason would be re-parsed` };
    if (d) return { ok: false, reason: `skeptic_reason_${d}:${axis} — one line, why a re-run closes this gap` };
  }

  const content = renderSkepticFlags(flags, escalations);
  // THE ROUND-TRIP. Rendered bytes → the pipeline's own parse → exactly the requested axes. With the
  // refusals above this cannot fire, which is the point: it is the assertion that the renderer and the
  // parser still agree, kept where a drift surfaces as a refusal the seat sees rather than a decision
  // the driver misreads.
  const parsed = escalatedAxes(content, REGISTER_AXES);
  const want = escalations.map((e) => e.axis);
  if (parsed.length !== want.length || parsed.some((a) => !want.includes(a))) {
    return { ok: false, reason: `skeptic_roundtrip_mismatch: the rendered file parses to [${parsed.join(", ")}] but the call asked for [${want.join(", ")}] — the renderer and the escalation parse disagree; this is a transport defect, not a judgment one` };
  }
  return { ok: true, content, flags: flags.length, escalations: want.length };
}

/**
 * Capture what arrived, validate, and write the artifact — in that order.
 *
 * The capture happens BEFORE the decision, exactly as in the blind-frame and closure transports: a
 * payload recorded after validation records what we DECIDED, which is already in the answer, rather
 * than what we were GIVEN. Best-effort, and its failure is RETURNED rather than swallowed.
 */
export function recordSkeptic(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const { dir, payload } = skepticCallPaths(String(runDir ?? ""));
  // — ONE FILE PER CALL, refusals included. This wrote a single fixed `call-001.json`,
  // so a turn refused and then re-sent kept only the survivor: the file whose header promises "including
  // calls that were refused" held the one call that was not. Sequence 1 still resolves to `call-001.json`,
  // so every consumer reading that name is unmoved. Best-effort throughout, as the capture always was —
  // a lost forensic record never fails a run.
  const nameFor = (seq) => join(dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  const verdict = acceptSkeptic(received);
  if (!verdict.ok) {
    return {
      written: null,
      refused: verdict.reason,
      captured: closeCapture({ ok: false, refused: verdict.reason }),
      capture_failed: captureFailed,
    };
  }

  const at = join(String(runDir ?? ""), FLAGS_FILE);
  try {
    writeFileSync(at, verdict.content);
  } catch (e) {
    // The call was VALID and we could not store it. That is an infrastructure failure and it must not
    // read as a rejected call — the two have opposite repairs.
    return {
      written: null,
      refused: null,
      write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }),
      capture_failed: captureFailed,
    };
  }

  return {
    written: at,
    refused: null,
    flags: verdict.flags,
    escalations: verdict.escalations,
    captured: closeCapture({ ok: true }),
    capture_failed: captureFailed,
  };
}

/** Read back what was written — the escalation view of the stored file, through the one parse. */
export function readRecordedEscalations(runDir) {
  try { return escalatedAxes(readFileSync(join(String(runDir ?? ""), FLAGS_FILE), "utf8"), REGISTER_AXES); }
  catch { return null; }
}

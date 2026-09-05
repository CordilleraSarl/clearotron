// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// whatif-memo-run.mjs — the door onto the memo composer (tracker issue 132).
//
// WHY THIS FILE EXISTS. Everything a memo needs was already in the tree and nothing could reach it:
// whatif-memo.mjs composes one, whatIfRefusal admits `kind: "memo"` on a finished run, decodeOp
// validates a memo op — and NOTHING CALLED composeMemo. A capability that is composed and unreachable
// is indistinguishable from one that was never built, except that it reads as done. This is the door.
//
// WHAT IT DOES. Resolves the archived run, reads the evidence it already gathered, asks for a bounded
// reading of that evidence under the reader's stated assumption, and writes a memo BESIDE the run. It
// dispatches no search, recomputes no stage and rates nothing anew.
//
// ── THE PARENT IS PROVEN UNTOUCHED, NOT ASSUMED UNTOUCHED ───────────────────────────────────────────
//
// Every delivered artifact is digested before the pass and again after, and a single moved digest fails
// the call. That is deliberately stronger than "this code does not write there": immutability of a
// delivered record is the whole safety case for offering this on a report a client is holding, and a
// safety case resting on nobody having introduced a write is one that decays. The check also treats a
// VANISHED or an APPEARED path as a change — an artifact that is no longer there has been modified in
// the only way that matters, and comparing just the paths present in both would call that clean.
//
// ── THE REASONING PASS IS INJECTED, AND THE UNWIRED CASE REFUSES ────────────────────────────────────
//
// `deps.reason` is the seam, the same shape whatIfRun uses for `runExperiment`. The seat that produces
// the reading is NOT wired in this change — that needs a skill and a stage contract, which is its own
// piece of work — so with nothing wired this entry point REFUSES BY NAME. It does not emit a memo with
// an empty body. Shipping a door that returns a hollow document would repeat, one layer up, the exact
// defect this file was written to fix: something that reads as done and answers nothing.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../shared/driver-dir.mjs";
import { composeMemo } from "./whatif-memo.mjs";

export const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "skills");

export const MEMO_DIR = "_memos";

export const MEMO_FAILS = Object.freeze({
  NO_RUN: "memo_run_unresolved",
  NO_ASSUMPTION: "memo_assumption_missing",
  NO_EVIDENCE: "memo_parent_has_no_findings",
  NOT_WIRED: "memo_reasoning_not_wired",
  PARENT_MOVED: "memo_parent_artifacts_moved",
  COMPOSE_REFUSED: "memo_compose_refused",
  REPLY_UNREADABLE: "memo_reply_unreadable",
  REPLY_NO_BODY: "memo_reply_no_body",
  REPLY_NO_LIMITS: "memo_reply_no_limits",
  REPLY_BAD_LIMIT: "memo_reply_limit_names_no_search",
});

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Digest every file in the run directory, one level deep plus `_driver/`.
 *
 * NOT just the report: the archive is the record, and a memo that left `report.md` alone while moving a
 * findings file would pass a report-only check. `_memos/` is excluded because that is where this call
 * legitimately writes — including it would make every successful memo fail its own immutability check.
 */
export function digestRunDir(runDir, { readdir = readdirSync, read = readFileSync, stat = statSync } = {}) {
  const out = {};
  const walk = (dir, prefix) => {
    let entries;
    try { entries = readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.name === MEMO_DIR) continue;                    // the one directory this call may write
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (!prefix) walk(full, rel); continue; }   // one level, plus _driver/
      try { out[rel] = `${sha(read(full))}:${stat(full).size}`; } catch { out[rel] = "UNREADABLE"; }
    }
  };
  walk(runDir, "");
  return out;
}

/** Paths whose digest differs, in either direction. An absence and an appearance are both changes. */
export function movedArtifacts(before = {}, after = {}) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].sort()
    .filter((p) => (before[p] ?? null) !== (after[p] ?? null))
    .map((p) => ({ path: p, before: before[p] ?? null, after: after[p] ?? null }));
}

/** The profile key the PARENT rated under — read from its frozen sidecar, never re-resolved. */
export function parentRatedUnder(runDir, { read = readFileSync } = {}) {
  try { return JSON.parse(read(driverDir(runDir, "profile.json"), "utf8"))?.profileKey ?? null; }
  catch { return null; }
}

/**
 * The seat, wired.
 *
 * ✕ NOT A PIPELINE STAGE, and that is the design rather than a shortcut. `runStage` reads no entry from
 * the STAGES table — it needs a label, a message and a session key — so a memo dispatches through the
 * same gateway ladder as every other seat WITHOUT becoming a seventeenth stage. It has no place in
 * STAGE_ORDER (it is not a step in any run), no downstream to invalidate, and no freshness relationship
 * with a delivered report. The token contract already on main says the same thing from the other end:
 * "a memo op carries no stage, because it re-runs none".
 *
 * The reply is a FILE the seat writes and this validates, not prose scraped from a transcript — the
 * typed-transport pattern, chosen here before it could bite rather than after.
 */
export async function seatReason({ runDir, runId, assumption, ratedUnder, findings }, deps = {}) {
  const {
    runStage = null,
    read = readFileSync,
    skillPath = join(SKILL_ROOT, "whatif-memo", "SKILL.md"),
    model = "sonnet",
    timeoutSec = 600,
  } = deps;
  const dispatch = runStage ?? (await import("./gateway.mjs")).runStage;
  let skill = "";
  try { skill = read(skillPath, "utf8"); }
  catch { return { ok: false, fail: MEMO_FAILS.NOT_WIRED, detail: `the memo skill is missing at ${skillPath}` }; }

  const replyPath = join(runDir, MEMO_DIR, `reply-${sha(`${runId}${assumption}`).slice(0, 10)}.json`);
  mkdirSync(join(runDir, MEMO_DIR), { recursive: true });
  const r = await dispatch("whatif-memo", {
    message: composeMemoMessage({ assumption, findings, ratedUnder, skill }),
    model,
    // A BOUNDED READING, and the ceiling says so. This re-reads evidence already gathered; a memo that
    // needed the clearance's own ceiling would not be the cheap thing the plan promised the reader.
    timeoutSec,
    sessionKey: `whatif-memo-${runId}-${sha(assumption).slice(0, 8)}`,
    expectFile: replyPath,
    runDir,
  });
  if (!r?.ok) return { ok: false, fail: MEMO_FAILS.NOT_WIRED, detail: `the memo pass did not complete: ${String(r?.fail ?? "unknown").slice(0, 160)}` };

  let raw;
  try { raw = read(replyPath, "utf8"); }
  catch { return { ok: false, fail: MEMO_FAILS.REPLY_UNREADABLE, detail: "the pass reported success and wrote no reply" }; }
  const v = validateMemoReply(raw);
  if (!v.ok) return v;
  return v.reading;
}

/**
 * Validate the seat's reply. TYPED, not parsed prose — the reply is a JSON object the skill dictates,
 * so a phrasing choice can never fail it. That is deliberate and it is tracker issue 129's lesson applied
 * before the fact: a gate keyed on how a model worded something is one drift from killing the call.
 *
 * Returns { ok, reading } or { ok: false, fail, detail }. Refuses rather than repairing: a memo composed
 * from a reply we had to guess at is a document whose reader cannot tell what was assumed.
 */
export function validateMemoReply(raw) {
  let doc = raw;
  if (typeof raw === "string") {
    // The skill says "no code fence"; a seat that adds one anyway is answering correctly in the wrong
    // wrapper, and refusing that would be pedantry with a client-facing cost. Strip it, then insist.
    const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    try { doc = JSON.parse(text); }
    catch (e) { return { ok: false, fail: MEMO_FAILS.REPLY_UNREADABLE, detail: `the reply is not JSON: ${String(e.message).slice(0, 120)}` }; }
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc))
    return { ok: false, fail: MEMO_FAILS.REPLY_UNREADABLE, detail: "the reply is not a JSON object" };

  const body = typeof doc.body === "string" ? doc.body.trim() : "";
  if (!body) return { ok: false, fail: MEMO_FAILS.REPLY_NO_BODY, detail: "the reply carries no body — there is nothing to tell the reader" };

  // An ABSENT limits key and an EMPTY one are different claims. The skill says an empty list asserts
  // "nothing here waits on a search"; an absent key asserts nothing at all, and a memo that silently
  // read one as the other would publish an honesty claim the seat never made.
  if (!("limits" in doc))
    return { ok: false, fail: MEMO_FAILS.REPLY_NO_LIMITS,
      detail: "the reply omits `limits` — an empty list is a claim the seat must make explicitly, not a default we supply" };
  if (!Array.isArray(doc.limits))
    return { ok: false, fail: MEMO_FAILS.REPLY_NO_LIMITS, detail: "`limits` must be an array" };

  const limits = [];
  for (const [i, l] of doc.limits.entries()) {
    const cannot = String(l?.cannot ?? "").trim();
    const smallestSearch = String(l?.smallestSearch ?? "").trim();
    if (!cannot) return { ok: false, fail: MEMO_FAILS.REPLY_BAD_LIMIT, detail: `limits[${i}] states no \`cannot\`` };
    // composeMemo refuses this too, and it is checked HERE as well on purpose: caught at the seam it
    // came from, the message names the seat's reply; caught at composition, it names our own document.
    if (!smallestSearch)
      return { ok: false, fail: MEMO_FAILS.REPLY_BAD_LIMIT,
        detail: `limits[${i}] ("${cannot.slice(0, 60)}") names no smallest search — "you need more searching" is not something a reader can act on` };
    limits.push({ cannot, smallestSearch, text: String(l?.text ?? cannot).trim() });
  }
  return { ok: true, reading: { body, limits } };
}

/**
 * The dispatch the seat receives. PURE — composed here so an arm can read exactly what was ordered
 * without spawning anything.
 *
 * The findings are handed over as the run's own JSON rather than summarised: a memo that reasoned over
 * our paraphrase of the evidence would be answering about the paraphrase.
 */
export function composeMemoMessage({ assumption, findings, ratedUnder = null, skill = "" } = {}) {
  return [
    skill.trim(),
    "",
    "## The assumption to apply, in the reader's own words",
    "",
    String(assumption ?? "").trim(),
    "",
    "## The rating framework this report was assessed under",
    "",
    ratedUnder
      ? `${ratedUnder} — assess under this one, not the house default.`
      : "This run froze no customer profile, so it was assessed under the house default. Stay with it.",
    "",
    "## The findings this report delivered",
    "",
    "```json",
    JSON.stringify(findings ?? null, null, 2),
    "```",
    "",
    "Write the JSON object the skill dictates, and nothing else.",
  ].join("\n");
}

/**
 * askArchivedRun — one entry point: an archived run plus a question, a memo beside the run.
 *
 * Returns `{ ok: true, memoPath, memoId, parentRunId, assumption, ratedUnder, statedLimits }` or
 * `{ ok: false, fail, detail }`. `fail` is a stable code from MEMO_FAILS; `detail` is for a human.
 *
 * `statedLimits` comes back as STRUCTURED ROWS, not as prose inside the memo text. The client cut goes
 * through the scrubber, and a limit that exists only in a paragraph forces that decision to be made by
 * regexing prose — the shape this repo keeps paying for. `text` is the memo's own authored sentence for
 * the row, so an account surface renders rows and a client surface falls back to the authored sentence,
 * and neither audience is shown sentences a surface composed for itself.
 */
export async function askArchivedRun({ runId, question, requestedBy = null } = {}, deps = {}) {
  const {
    resolveRun,
    // The seat is the DEFAULT now, so the door is wired rather than merely openable. `deps.reason` stays
    // as the injection seam every arm here uses, and the not-wired refusal below stays too: it is what
    // answers a build whose skill file is missing, which is a real state and not a hypothetical.
    reason = seatReason,
    now = () => new Date().toISOString(),
    read = readFileSync,
    write = writeFileSync,
  } = deps;

  const assumption = String(question ?? "").trim();
  if (!assumption) return { ok: false, fail: MEMO_FAILS.NO_ASSUMPTION, detail: "a memo needs the reader's assumption in their own words" };

  const run = typeof resolveRun === "function" ? resolveRun(runId) : null;
  if (!run?.runDir) return { ok: false, fail: MEMO_FAILS.NO_RUN, detail: `run "${runId}" did not resolve` };

  // The evidence must exist before anything is asked of it. A memo over a run with no findings would
  // reason from nothing and say so in the voice of a document that had read something.
  const findingsPath = join(run.runDir, "findings.json");
  if (!existsSync(findingsPath))
    return { ok: false, fail: MEMO_FAILS.NO_EVIDENCE, detail: `${runId} carries no findings.json to reason over` };

  if (typeof reason !== "function")
    return { ok: false, fail: MEMO_FAILS.NOT_WIRED,
      detail: "the memo reasoning pass is not wired on this build — a memo is refused rather than returned empty" };

  const before = digestRunDir(run.runDir);
  const ratedUnder = parentRatedUnder(run.runDir, { read });

  let reading;
  try {
    reading = await reason({
      runDir: run.runDir, runId: run.runId, assumption, ratedUnder,
      findings: JSON.parse(read(findingsPath, "utf8")),
    });
  } catch (e) {
    return { ok: false, fail: MEMO_FAILS.NOT_WIRED, detail: `the reasoning pass failed: ${String(e?.message ?? e).slice(0, 200)}` };
  }
  // A refusal from the pass is returned AS ITS OWN reason code, never flattened into a compose failure.
  // The reader of a failed memo needs to know whether the seat could not be reached, answered
  // unreadably, or answered without naming a search — three different things to do next.
  if (reading && reading.ok === false) return { ok: false, fail: reading.fail, detail: reading.detail };

  const composed = composeMemo({
    assumption,
    parentRunId: run.runId,
    parentReport: run.url ?? run.report ?? `${run.runId} report`,
    date: now(),
    body: String(reading?.body ?? ""),
    limits: Array.isArray(reading?.limits) ? reading.limits : [],
    mark: run.markName ?? null,
  });
  if (!composed.ok)
    return { ok: false, fail: MEMO_FAILS.COMPOSE_REFUSED, detail: composed.reason, missing: composed.missing };

  const memoId = `memo-${sha(`${run.runId}\u0000${assumption}\u0000${now()}`).slice(0, 12)}`;
  const dir = join(run.runDir, MEMO_DIR);
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `${memoId}.md.tmp`);
    write(tmp, composed.text);
    renameSync(tmp, join(dir, `${memoId}.md`));
  } catch (e) {
    return { ok: false, fail: MEMO_FAILS.COMPOSE_REFUSED, detail: `memo write failed: ${String(e?.message ?? e).slice(0, 160)}` };
  }

  // AFTER the write, deliberately: the check has to cover this call's own behaviour, not merely the
  // reasoning pass's. If writing the memo touched the parent, that is exactly what must be caught.
  const moved = movedArtifacts(before, digestRunDir(run.runDir));
  if (moved.length)
    return { ok: false, fail: MEMO_FAILS.PARENT_MOVED,
      detail: `the parent run's artifacts moved during the memo: ${moved.slice(0, 5).map((m) => m.path).join(", ")}`, moved };

  return {
    ok: true,
    memoPath: join(MEMO_DIR, `${memoId}.md`),
    memoId,
    parentRunId: run.runId,
    assumption,
    ratedUnder,
    requestedBy,
    statedLimits: (Array.isArray(reading?.limits) ? reading.limits : [])
      .map((l) => ({
        cannot: String(l?.cannot ?? "").trim(),
        smallestSearch: String(l?.smallestSearch ?? "").trim(),
        text: String(l?.text ?? l?.cannot ?? "").trim(),
      }))
      .filter((l) => l.cannot),
  };
}

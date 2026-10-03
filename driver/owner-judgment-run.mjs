// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// owner-judgment-run.mjs — the files step 3 reads and writes, around the two judging sessions.
//
// owner-judgment.mjs holds what is pure: the words, the form, the check, the merge. This module holds what
// touches the run directory: the one message both judges receive, composed from the files the run already
// holds; which owners each judge's ACCEPTED session was shown, read from the reading log; and the merged
// decisions and the fate of every owner, written where the sceptic, synthesis and the run's record read
// them. pipeline.mjs (runOwnerJudgment) runs the sessions between the two halves.

import { existsSync, readFileSync } from "node:fs";
import { driverDir } from "../shared/driver-dir.mjs";
import { atomicWrite } from "./progress.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { composeMessage, orderText, contextText, fateCounts, judgmentDiscardReason, FATES, JUDGES, openingBands } from "./owner-judgment.mjs";

const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };
const readJsonl = (path) => {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped, never fatal */ }
  }
  return out;
};

/**
 * The one message both judges receive: the order with the instructing lawyer's own questions, the client's
 * context, the client's rating scale and worked examples — the files the run already holds, unchanged —
 * and the table's first pages. `ownNames`
 * is the run's list of the client's own owner names (pipeline.mjs, `ctx.exclusionSeed`). `readSkill(rel)` reads an instruction-tree file by its relative path (the framework and the examples
 * resolve in the deployment's tree exactly as every other stage resolves them).
 */
export function composeJudgmentMessage({ P, profile, ownNames = [], ratingScalePath, workedExamplesPath, readSkill, tablePages }) {
  return composeMessage({
    order: orderText(readJson(P.instructedScope), readJson(P.intakeAsks)?.asks ?? []),
    context: contextText(profile, { ownNames, customerBind: readJson(P.customerBind) }),
    ratingScale: readSkill(ratingScalePath),
    workedExamples: readSkill(workedExamplesPath),
    tablePages,
  });
}

// ── TWO JUDGES ON THE FIRST PASS, ONE ON A RE-RUN; A JUDGE'S LAST ACCEPTED ANSWER STANDS ──────────────────
//
// The owner's ruling of 2026-10-01: a pass that re-judges because the pile moved (the settlement flush, a
// client bound late, a stale repair) runs one judge on the changed table, and its answer is merged with the
// other judge's last accepted answer. A judge's last accepted answer stands until that judge gives another.
// It is kept here, beside the stage's output and never in it: the gateway deletes a stage's output before
// each attempt, so a re-run judge that failed every attempt took its earlier carries with it, and owners
// only that judge had carried lost "carried".

/** A judge's last accepted answer and the owners that judge was shown, or null when it has none. */
export function readAcceptedJudgment(P, n) {
  const a = readJson(P.ownerJudgmentAccepted(String(n)));
  if (!a || !a.answer || typeof a.answer !== "object") return null;
  return { ...a, opening: new Set(Array.isArray(a.opening) ? a.opening : []), looked: new Set(Array.isArray(a.looked) ? a.looked : []) };
}

/** Keep a judge's accepted answer with the owners it was shown, for the passes that do not run that judge. */
export function writeAcceptedJudgment(P, n, { answer, opening, looked, trigger }) {
  atomicWrite(P.ownerJudgmentAccepted(String(n)), `${JSON.stringify({
    schema_version: 1, judge: n, ts: new Date().toISOString(), trigger, answer, opening: [...opening], looked: [...looked],
  })}\n`);
}

/**
 * Which judges a pass dispatches. Every judge on a first pass: the run's first, a resume before any judge
 * was accepted, an experiment replaying the step. One on a re-run: a judge with no accepted answer first,
 * else the judge whose accepted answer is oldest, so successive re-runs alternate between them. PURE.
 */
export function judgesForPass({ trigger, accepted, judges = JUDGES }) {
  const all = Array.from({ length: judges }, (_, i) => i + 1);
  if (trigger === "fresh" || trigger === "experiment" || all.every((n) => !accepted[n - 1])) return all;
  const without = all.find((n) => !accepted[n - 1]);
  if (without) return [without];
  return [[...all].sort((a, b) => String(accepted[a - 1].ts ?? "").localeCompare(String(accepted[b - 1].ts ?? "")) || a - b)[0]];
}

/**
 * Each judge's outcome for one pass. A judge this pass dispatched whose answer passed its check gives this
 * pass's answer, with the owners this pass showed it. Every other judge — not dispatched, dispatched and
 * lost, or skipped because nothing it reads moved — stands on its last accepted answer, with the owners
 * that answer's session was shown, or has none. PURE: the stage's results and the readers come in.
 *
 *   dispatch   the judges this pass dispatched
 *   results    judge → the stage's result for a dispatched judge ({ ok, skipped, attempts, fail })
 *   accepted   judge → its last accepted answer (readAcceptedJudgment), or null
 *   answerOf   judge → { answer } when its output passed the check, else { fail }
 *   shownOf    judge → { opening, looked } for this pass's accepted session
 */
export function judgeOutcomes({ judges = JUDGES, dispatch, results, accepted, answerOf, shownOf }) {
  return Array.from({ length: judges }, (_, i) => {
    const n = i + 1;
    const kept = accepted(n);
    const standing = (fields) => ({ judge: n, ...fields, ok: Boolean(kept), answer: kept?.answer ?? null,
      opening: kept?.opening ?? new Set(), looked: kept?.looked ?? new Set(), answer_from: kept ? "an earlier pass" : null });
    if (!dispatch.includes(n)) return standing({ ran: false, attempts: null, skipped: false, fail: kept ? null : "judgment_not_run" });
    const r = results(n) ?? {};
    const read = r.ok ? answerOf(n) : null;
    const fail = read?.answer ? null : String(r.fail ?? read?.fail ?? "judgment_no_answer").slice(0, 200);
    if (fail) return standing({ ran: true, attempts: r.attempts ?? null, skipped: r.skipped === true, fail });
    // A judge stage freshness skipped answered on an earlier pass; that answer is the one kept.
    if (r.skipped === true && kept) return standing({ ran: true, attempts: r.attempts ?? null, skipped: true, fail: null });
    const { opening, looked } = shownOf(n);
    return { judge: n, ran: true, ok: true, attempts: r.attempts ?? null, skipped: r.skipped === true, fail: null,
      answer: read.answer, opening, looked, answer_from: r.skipped === true ? "an earlier pass" : "this pass" };
  });
}

/**
 * The attempt that produced a judge's answer, and the window of time it ran in: after the row of the
 * attempt before it, up to its own row. Attempts of one judge share one session key on the reading log
 * (the tool server is configured once per stage dispatch), so time is what tells an accepted session's
 * reads from a failed one's. Null when the journal holds no attempt that passed.
 */
export function acceptedAttemptWindow(runDir, label) {
  const rows = readJsonl(driverDir(runDir, `${label}.jsonl`)).filter((r) => Number.isFinite(Number(r?.attempt)));
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].fail) continue;
    const to = Date.parse(rows[i].ts);
    const from = i > 0 ? Date.parse(rows[i - 1].ts) : -Infinity;
    return Number.isFinite(to) ? { attempt: rows[i].attempt, from, to } : null;
  }
  return null;
}

/**
 * The owners a judge's accepted session was shown in a tool's answer, as table keys: the owners an
 * answer named by key (the table's pages, one owner's records) and the owners of every record an answer
 * listed or opened. `keyOfRecord` maps a record id to its owner's key.
 */
export function ownersLookedUp(runDir, { session, window, keyOfRecord }) {
  const keys = new Set();
  if (!window) return keys;
  for (const row of readJsonl(driverDir(runDir, "reading-log.jsonl"))) {
    if (row?.session !== session) continue;
    const at = Date.parse(row.ts);
    if (!(at > window.from && at <= window.to)) continue;
    for (const k of row.owner_keys_shown ?? []) if (k) keys.add(String(k));
    for (const id of row.shown ?? []) { const k = keyOfRecord(id); if (k) keys.add(k); }
  }
  return keys;
}

/**
 * How many full records the judges fetched from the register on this run, and how many came back. One per
 * call that reached the register (the reading log's `fetch_made`), over every judging pass. Each is a billed
 * call and there is no cap (owner, 2026-10-01): the count is written in the run's record so the cost per
 * run can be read off it.
 */
export function recordFetchCount(runDir) {
  let fetches = 0, ok = 0;
  for (const row of readJsonl(driverDir(runDir, "reading-log.jsonl"))) {
    if (row?.tool !== "register_open" || row?.fetch_made !== true) continue;
    fetches++;
    if (row?.fetched?.ok === true) ok++;
  }
  return { fetches, ok, failed: fetches - ok };
}

/** Record id → owner key, over the table's rows, matching the way the discard ledger normalises ids. */
export function recordOwnerIndex(table) {
  const byId = new Map();
  for (const r of table?.rows ?? []) {
    for (const rec of r.records) {
      byId.set(String(rec.id).toLowerCase(), r.key);
      const canon = normalizeRecordUri(String(rec.id));
      if (canon) byId.set(canon.toLowerCase(), r.key);
    }
  }
  return (id) => {
    const s = String(id ?? "");
    return byId.get(s.toLowerCase()) ?? byId.get(String(normalizeRecordUri(s) ?? "").toLowerCase()) ?? null;
  };
}

/**
 * What the judgment seam of the discard ledger records for each record of the pile. CARRIED IS PER RECORD,
 * as the writer's list is (pipeline.mjs, findingsSurfaceRows): a record the judges cited for an owner they
 * carried. Every other record leaves with its owner's fate as the reason (judgmentDiscardReason), an
 * uncited record of a carried owner included.
 */
export function judgmentSeam(merged, keyOfRecord) {
  const fateOf = new Map((merged?.fates ?? []).map((f) => [f.key, f]));
  const norm = (id) => String(normalizeRecordUri(String(id ?? "")) ?? id ?? "").toLowerCase();
  const cited = new Set((merged?.carried ?? []).flatMap((g) => (Array.isArray(g.records) ? g.records : []).map(norm)));
  return {
    isCarried: (uri) => fateOf.get(keyOfRecord(uri))?.fate === FATES.CARRIED && cited.has(norm(uri)),
    reasonFor: (uri) => judgmentDiscardReason(fateOf.get(keyOfRecord(uri)), { cited: cited.has(norm(uri)) }),
  };
}

/**
 * Write the merged decisions (what the sceptic, synthesis and the review read) and the fate of every
 * owner (the run's own record). `judges` says, per judge, whether its answer was taken and why not.
 */
export function writeJudgmentFiles(P, merged, { trigger, judges }) {
  const counts = fateCounts(merged.fates);
  const recordFetches = recordFetchCount(P.runDir);
  const answered = judges.filter((j) => j.ok).map((j) => j.judge);
  atomicWrite(P.ownerDecisions, `${JSON.stringify({
    schema_version: 1,
    judges: { asked: judges.length, answered },
    overall_ratings: merged.overall,
    carried: merged.carried,
    set_aside: merged.setAside,
    advice: merged.advice,
    questions_wished_for: merged.questions,
    owners: counts,
  }, null, 2)}\n`);
  atomicWrite(P.ownerFates, `${JSON.stringify({
    schema_version: 1, ts: new Date().toISOString(), trigger,
    judges, counts, record_fetches: recordFetches, fates: merged.fates,
  })}\n`);
  return { ...counts, recordFetches };
}

// ── THE RECORDS IN FRONT OF THE JUDGES, FETCHED FIRST WHERE THE LISTING CARRIES NO GOODS ─────────────
//
// A register can list a record's mark, owner, classes and status with no goods wording; the goods come only
// with the full record. The bench's judges had the goods of every record in front of them, and on such a
// register the step's judges had none, so a conflict could be set aside on a ground they could not check
// (design, 2026-10-03). So before the judges read, the step fetches the full record of every record of the
// owners in scope that the run does not hold yet. On a register whose listing carries the goods the run
// holds them already, and nothing is fetched. The scope is a setting (owner-tools.mjs OPENING_FETCH_SCOPE):
// with none, nothing is fetched first. Whatever the scope, only the owners the opening shows are fetched for:
// the records are the ones on the judges' opening pages (design, 2026-10-03), and on a crowded pile the
// opening's ceiling cuts the near band, so the fetch stops at the cut. A failed fetch is counted and the
// step goes on; that record is fetched when a judge opens it, as before. The counts go on the run's record.

/** The fetch-first scope's owners, by key: "floor", "band" (floor and near band), or none. */
export function fetchScopeOwners(table, scope) {
  if (!scope) return [];
  const bands = openingBands(table);
  if (scope === "floor") return bands.floor;
  if (scope === "band") return bands.band;
  throw new Error(`the fetch-first scope "${scope}" is not one this step knows (floor, band)`);
}

/**
 * Fetch, one at a time, every record of the owners in scope that the opening shows (`shown`, by key) and
 * that `pile` does not hold, with `fetch(id)` resolving to `{ ok }`. Returns the counts the run records:
 * the owners fetched for and the owners in scope past the opening's cut, the records of the first, how
 * many were held already, how many were asked for, and how many came back.
 */
export async function fetchScopeRecords({ pile, table, scope, shown, fetch }) {
  const onOpening = new Set(shown ?? []);
  const inScope = fetchScopeOwners(table, scope);
  const owners = inScope.filter((k) => onOpening.has(k));
  const ids = owners.flatMap((k) => (table.byKey.get(k)?.records ?? []).map((r) => r.id));
  const asked = ids.filter((id) => !pile.readFullRecord(id));
  let ok = 0;
  for (const id of asked) {
    let answer;
    try { answer = await fetch(id); } catch { answer = null; }
    if (answer?.ok) ok += 1;
  }
  if (asked.length) pile.refreshFullRecords?.();
  return { scope: scope ?? null, owners: owners.length, pastTheCut: inScope.length - owners.length, records: ids.length, held: ids.length - asked.length, asked: asked.length, ok, failed: asked.length - ok };
}

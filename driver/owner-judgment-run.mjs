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
import { composeMessage, orderText, contextText, fateCounts, judgmentDiscardReason, FATES } from "./owner-judgment.mjs";

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
 * The one message both judges receive: the order, the client's context, the client's rating scale and
 * worked examples — the files the run already holds, unchanged — and the table's first pages. `ownNames`
 * is the run's list of the client's own owner names (pipeline.mjs, `ctx.exclusionSeed`). `readSkill(rel)` reads an instruction-tree file by its relative path (the framework and the examples
 * resolve in the deployment's tree exactly as every other stage resolves them).
 */
export function composeJudgmentMessage({ P, profile, ownNames = [], ratingScalePath, workedExamplesPath, readSkill, tablePages }) {
  return composeMessage({
    order: orderText(readJson(P.instructedScope)),
    context: contextText(profile, { ownNames, customerBind: readJson(P.customerBind) }),
    ratingScale: readSkill(ratingScalePath),
    workedExamples: readSkill(workedExamplesPath),
    tablePages,
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

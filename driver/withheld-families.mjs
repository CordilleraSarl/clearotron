// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// withheld-families.mjs — the reading turn's record of the waiting families it chose not to ask.
//
// On a crowded field the wider register families wait in the plan for the reading turn, which asks the
// ones worth asking. A family it does not ask was never searched, and until this record nothing said
// so: the turn's reason, when it gave one, sat in its prose note, where nothing reads it. So the turn
// records each family it leaves unasked as `withheld-by-judgment` with its reason, the coverage form
// carries a row per waiting family pre-settled from this record, and a family nobody judged is an
// unsettled row the digest's gate refuses to pass.
//
// The reason is the run's record and the audit workbook's, never the report's: the coverage form keeps
// these rows out of the ledger the report is built from (coverage-form.mjs, `family`).
//
// One file per axis, because the reading turn fans out one seat per axis and two seats writing one file
// would lose each other's calls. The axis is bound by the server, never taken from the payload.
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { awaitsReadingTurn } from "../providers/_shared/plan-guards.mjs";
import { entryQuestionKey } from "./register-plan.mjs";
import { seatBannedTokens } from "./coverage-form.mjs";

export const WITHHELD_REASON_MAX = 600;
const FILE_RE = /^withheld-families-(.+)\.json$/;

export const withheldFamiliesPath = (runDir, axis) => driverDir(runDir, `withheld-families-${axis}.json`);

const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; } };

/** Every axis's record, merged: `{ [qid]: { axis, reason } }`. An unreadable file contributes nothing. */
export function readWithheldFamilies(runDir) {
  const out = {};
  let names = [];
  try { names = readdirSync(driverDir(runDir)); } catch { return out; }
  for (const name of names) {
    const m = FILE_RE.exec(name);
    if (!m) continue;
    const doc = readJson(driverDir(runDir, name));
    for (const [qid, v] of Object.entries(doc?.families ?? {})) {
      const reason = String(v?.reason ?? "").trim();
      if (qid && reason) out[qid] = { axis: String(doc?.axis ?? m[1]), reason };
    }
  }
  return out;
}

/**
 * The waiting families on one axis, and which of them the reading turn has asked: a waiting row is asked
 * when a question it did not wait for — a plan entry or one of this axis's supplementals — carries the
 * same question key. PURE over its inputs.
 */
export function waitingFamiliesOn(plan, axis, supplementals = []) {
  const entries = Array.isArray(plan?.entries) ? plan.entries : [];
  const askedKeys = new Set([...entries.filter((e) => !awaitsReadingTurn(e?.when)), ...supplementals]
    .filter((e) => e && !e.unsupported).map((e) => entryQuestionKey(e, plan)).filter(Boolean));
  const waiting = entries.filter((e) => e?.axis === axis && awaitsReadingTurn(e?.when));
  return {
    waiting,
    unasked: waiting.filter((e) => !askedKeys.has(entryQuestionKey(e, plan))),
  };
}

/**
 * Record families withheld on the bound axis. `families` is `[{ qids: [qid…] | qid, reason }]` — one
 * reason may cover several families. Each qid must be a waiting family of this axis in the frozen plan;
 * a reason must be the reader's words, since the audit workbook prints it. Accepts what is valid, names
 * what it refused, and never throws.
 */
export function recordWithheldFamilies(runDir, { axis, families } = {}) {
  const plan = readJson(driverDir(runDir, "register-plan.json"));
  if (!plan || !Array.isArray(plan.entries)) return { refused: "no frozen register plan in this run — there are no waiting families to record against" };
  if (!Array.isArray(families) || !families.length) return { refused: "families must list at least one { qids, reason }" };
  const supp = readJson(join(runDir, "register-units", `${axis}-supplemental-plan.json`));
  const { waiting, unasked } = waitingFamiliesOn(plan, axis, Array.isArray(supp?.entries) ? supp.entries : []);
  const waitingQids = new Set(waiting.map((e) => e.qid));
  const path = withheldFamiliesPath(runDir, axis);
  const doc = readJson(path) ?? { axis, families: {} };
  const recorded = [], rejected = [];
  for (const item of families) {
    const qids = (Array.isArray(item?.qids) ? item.qids : [item?.qids ?? item?.qid]).map((q) => String(q ?? "").trim()).filter(Boolean);
    const reason = String(item?.reason ?? "").replace(/\s+/g, " ").trim();
    if (!qids.length) { rejected.push({ qid: "", issue: "an item names no qid" }); continue; }
    if (!reason) { for (const qid of qids) rejected.push({ qid, issue: "no reason — a withheld family is recorded with why it was not asked" }); continue; }
    if (reason.length > WITHHELD_REASON_MAX) { for (const qid of qids) rejected.push({ qid, issue: `the reason runs to ${reason.length} characters; at most ${WITHHELD_REASON_MAX}` }); continue; }
    const banned = seatBannedTokens(reason);
    if (banned.length) { for (const qid of qids) rejected.push({ qid, issue: `the reason names ${banned.join(", ")} — the audit workbook prints it; say it in a lawyer's words` }); continue; }
    for (const qid of qids) {
      if (!waitingQids.has(qid)) { rejected.push({ qid, issue: `not a waiting family on axis "${axis}" in the frozen plan` }); continue; }
      doc.families[qid] = { reason };
      recorded.push(qid);
    }
  }
  if (recorded.length) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ axis, families: doc.families }, null, 2) + "\n");
      renameSync(tmp, path);
    } catch (e) { return { write_failed: String(e?.message ?? e).slice(0, 200) }; }
  }
  const still = unasked.filter((e) => !doc.families[e.qid]).map((e) => e.qid);
  return { axis, recorded, rejected, still_to_judge: still, waiting: waiting.length };
}

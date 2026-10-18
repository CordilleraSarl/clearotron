// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// goods-evidence.mjs — what each band record's goods rest on, written down by the run.
//
// WHY. The stages that judge goods read them through the band tools: a line's goods words, and on request the
// official record itself. Those tools say whether a record's goods could be read. They cannot say what the goods
// rest on, and the difference decides what a goods judgment may conclude:
//
//   complete      the run holds the text whole, on a basis the record names: a full record from an operation
//                 whose goods are whole (the record text, the register's own flag on a retrieved record, the
//                 bulk register statement), or a search answer's statement shorter than its documented cut;
//   cut           the register marked the statement as cut: a missing word proves nothing;
//   unknown       goods are held and their completeness is not established: a search answer's unflagged
//                 statement at or over the default answer's documented cut, a retrieved record's statement with
//                 no flag, a register whose full-record operation the tree documents nowhere, or a held record
//                 whose goods field is missing;
//   absent        the run holds a full record from such an operation, and it lists no goods;
//   unavailable   no goods are held and a fetch of the record failed this run;
//   not-held      no goods are held, and nothing was fetched.
//
// None of the last five means the goods are unrelated (ruled 2026-10-18). Every state comes from the shared
// goods reader's one rule (record-goods.mjs `rowGoods`, `recordGoods`, `recordGoodsProvenance`), so the record
// and the goods test the shape groups on cannot disagree. What cannot be established is not called complete.
//
// WHAT IT READS. Nothing a search row holds directly: the goods a record's evidence carries come from the goods
// reader the band shape is handed (`of`, and `held` once the reader distinguishes a held body), which marks a
// statement the register cut. The run's own files say which official records it holds and where each came from
// (the record ledger and `_records/`), and the register call ledger says which fetches failed. The record is
// written beside the band shape, in `_driver/`, where no band tool serves it: what a stage is shown does not
// change with it. It carries no clock, so a replay derives it byte for byte.
//
// PURE except `heldRecordProvenance` and `readRunCallRows`, which read the run's files.
import { readFileSync, existsSync } from "node:fs";
import { normalizeRecordUri, readRecordArtifacts, forEachLedgerLine, recordBodyHasContent } from "./registry-fidelity.mjs";
import { recordGoodsProvenance } from "./record-goods.mjs";
import { driverDir } from "../shared/driver-dir.mjs";
import { runPrefixSpellings } from "../shared/pre-rename-spellings.mjs";

export const GOODS_EVIDENCE_SCHEMA_VERSION = 1;
export const GOODS_EVIDENCE_FILE = "goods-evidence.json";
export const GOODS_STATES = Object.freeze(["complete", "cut", "unknown", "absent", "unavailable", "not-held"]);

const uriKey = (u) => normalizeRecordUri(u);
// A register's own id for a record, as a fetch row names it where the provider logs its own id rather than the
// record's address: the address's last segment.
const idOf = (u) => { const k = normalizeRecordUri(u); return k ? k.slice(k.lastIndexOf("/") + 1) : ""; };

/**
 * Which official records the run holds, and where each came from: canonical uri → {via, provider, session, ts,
 * goods}, where `goods` is the shared reader's account of the body (record-goods.mjs `recordGoodsProvenance`:
 * the operation it came from, and whether it supplies the goods field). The record ledger first, then `_records/`,
 * the later copy winning, as the goods reader and `band_record` read them. A body that carries no record is no
 * record held (registry-fidelity.mjs `recordBodyHasContent`). A torn line or an unreadable file contributes
 * nothing. IMPURE (reads the run).
 */
export function heldRecordProvenance(runDir) {
  const out = new Map();
  const put = (uri, via, facts, body) => {
    const key = uriKey(uri);
    if (!key || !recordBodyHasContent(body)) return;
    const prev = out.get(key);
    out.set(key, { via: [...new Set([...(prev?.via ?? []), via])], provider: facts.provider ?? prev?.provider ?? null,
      session: facts.session ?? prev?.session ?? null, ts: facts.ts ?? prev?.ts ?? null, goods: recordGoodsProvenance(body) });
  };
  let text = "";
  try { text = readFileSync(driverDir(runDir, "register-record-bodies.jsonl"), "utf8"); } catch { text = ""; }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (!row?.body || typeof row.body !== "object") continue;
    put(row.target, "register-record-bodies", { provider: row.provider ?? null, session: row.sessionKey ?? null, ts: row.ts ?? null }, row.body);
  }
  for (const [uri, body] of readRecordArtifacts(runDir)) {
    const r = body?._receipt;
    put(uri, "_records", { provider: r?.provider ?? null, session: r?.context ?? null, ts: r?.fetched_at ?? null }, body);
  }
  return out;
}

// The run test every reader of the call ledger applies (registry-fidelity.mjs, provider-usage.mjs): a row is this
// run's when its session key, without the gateway's `agent:<id>:` namespace, starts with the run's prefix.
const stripNs = (s) => (typeof s === "string" ? s.replace(/^agent:[^:]+:/, "") : "");
const inRun = (row, runPrefix) => !runPrefix || runPrefixSpellings(runPrefix).some((rp) => stripNs(row?.sessionKey).startsWith(rp)
  || stripNs(row?.sessionId).startsWith(rp));

/** This run's rows of the register call ledger. A missing file is no rows; one that cannot be read says so. IMPURE. */
export function readRunCallRows(callLogPath, runPrefix) {
  const rows = [];
  const read = forEachLedgerLine(callLogPath, (line) => {
    let row; try { row = JSON.parse(line); } catch { return; }
    if (inRun(row, runPrefix)) rows.push(row);
  });
  return { rows, error: read.error };
}

/**
 * The fetches this run made per record, from its call ledger rows: key → {sent, from_memory, failed, ok, last_status}.
 * A record fetch names its record by address or by the register's own id; a batch of full records names each id
 * it carried. Requests sent and answers served from the run's memory are counted apart: one cost the register a
 * request, the other did not. PURE.
 */
export function recordFetchOutcomes(rows, { runPrefix = null } = {}) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!inRun(row, runPrefix)) continue;
    const ids = row?.tool === "record_fetch" && row?.target ? [row.target]
      : Array.isArray(row?.records) ? row.records : [];
    for (const raw of ids) {
      const key = uriKey(raw) || String(raw ?? "").trim().toLowerCase();
      if (!key) continue;
      const o = out.get(key) ?? { sent: 0, from_memory: 0, failed: 0, ok: false, last_status: null };
      if (row.cache_hit === true) o.from_memory++; else o.sent++;
      if (row.ok === false) o.failed++;
      if (row.ok === true) o.ok = true;
      if (row.http_status !== undefined) o.last_status = row.http_status;
      out.set(key, o);
    }
  }
  return out;
}

const fetchOf = (fetches, uri) => fetches?.get?.(uriKey(uri)) ?? fetches?.get?.(idOf(uri)) ?? null;

/**
 * One record's goods evidence: {uri, state, source, basis, readable, held, fetch}. PURE.
 *   goods    the goods reader: `of(record)` gives the statements the record's evidence holds, a statement the
 *            register cut marked `cut: true`; `held(record)`, where given, says whether they are a held body's
 *   held     heldRecordProvenance's map: which official records the run holds, and where from
 *   fetches  recordFetchOutcomes's map, or null
 */
export function recordGoodsEvidence(record, { goods = null, held = null, fetches = null } = {}) {
  const uri = uriKey(record?.record_id) || String(record?.record_id ?? "");
  const body = held?.get?.(uri) ?? null;
  const statements = goods?.of ? goods.of(record) : null;
  const fromBody = typeof goods?.held === "function" ? goods.held(record) : Boolean(statements);
  const fetch = fetchOf(fetches, record?.record_id);
  const readable = statements?.length ? statements.some((g) => g?.en !== false) : null;
  const cut = (statements ?? []).some((g) => g?.cut === true);
  const unknown = (statements ?? []).some((g) => g?.unknown === true);
  const row = (state, source, basis) => ({ uri, state, source, basis, readable, held: body, fetch });
  // The statements are a held body's where the reader says so; a reader that cannot tell reads bodies only.
  if (statements?.length && fromBody) {
    const op = body?.goods?.operation ?? "undocumented";
    return row(cut ? "cut" : unknown ? "unknown" : "complete", "record-body",
      cut ? "register-flag" : unknown ? (op === "retrieve" ? "retrieved-record-without-flag" : "full-record-operation-undocumented")
        : op === "retrieve" ? "register-flag" : op === "bulk-register" ? "bulk-register-statement" : "full-record");
  }
  if (statements?.length) return row(cut ? "cut" : unknown ? "unknown" : "complete", "search-row",
    cut ? "register-flag" : unknown ? "default-answer-at-or-over-its-cut" : "default-answer-under-its-cut");
  if (body) {
    // Lists no goods only where an operation whose goods are whole supplies the field and it is empty. A body with
    // no goods field, or from an operation the tree documents nowhere, establishes nothing about its goods.
    const g = body.goods ?? { operation: "undocumented", field: "none" };
    if (g.field === "empty" && g.operation !== "undocumented") return row("absent", "record-body", "full-record-without-goods");
    return row("unknown", "record-body", g.field === "none" ? "record-without-goods-field" : "full-record-operation-undocumented");
  }
  if (fetch?.failed && !fetch.ok) return row("unavailable", null, "record-fetch-failed");
  return row("not-held", null, "no-goods-held");
}

/**
 * WHAT A RECORD'S GOODS REST ON, IN THE WORDS THE STAGES READ (the band lookup's `goods_from`, the write-up's list):
 * the supporting evidence the record holds and its completeness, never the last call made for it. "No goods listed"
 * needs a full record from an operation whose goods are whole, with the field there and empty; a record whose goods
 * field is missing is "completeness not established". null where there is no evidence row. PURE.
 */
export function goodsFromLabel(e) {
  if (!e) return null;
  if (e.source === "record-body") return e.state === "absent" ? "official record, no goods listed"
    : e.state === "cut" ? "official record, cut by the register"
    : e.state === "unknown" ? "official record, completeness not established" : "official record";
  if (e.source === "search-row") return e.state === "cut" ? "search answer, cut by the register"
    : e.state === "unknown" ? "search answer, completeness not established" : "search answer";
  return e.state === "unavailable" ? "fetch failed" : "nothing held";
}

/** Records counted by state, by source and by basis; `unreadable` counts goods held in no language the engine reads. PURE. */
export function goodsEvidenceTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const by_state = Object.fromEntries(GOODS_STATES.map((s) => [s, 0]));
  const by_source = {}, by_basis = {};
  let unreadable = 0;
  for (const r of list) {
    by_state[r.state] = (by_state[r.state] ?? 0) + 1;
    const s = r.source ?? "none";
    by_source[s] = (by_source[s] ?? 0) + 1;
    by_basis[r.basis] = (by_basis[r.basis] ?? 0) + 1;
    if (r.readable === false) unreadable++;
  }
  return { records: list.length, by_state, by_source, by_basis, unreadable };
}

/** The record for a band: one row per record, in the band's order, and the totals. No clock. PURE. */
export function deriveGoodsEvidence({ records = [], goods = null, held = null, fetches = null } = {}) {
  const rows = (Array.isArray(records) ? records : []).filter((r) => r?.record_id).map((r) => recordGoodsEvidence(r, { goods, held, fetches }));
  return { schema_version: GOODS_EVIDENCE_SCHEMA_VERSION, totals: goodsEvidenceTotals(rows), records: rows };
}

/** The record the run wrote, or null when there is none or it will not parse. IMPURE. */
export function readGoodsEvidence(runDir) {
  const p = driverDir(runDir, GOODS_EVIDENCE_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/**
 * WHAT THE STAGES READ, per record, from the band tools' reading log: canonical uri → {opened, shown, missed}, each
 * a set of session keys. `opened` is a `band_record` that served the record; `missed`, one that could not; `shown`,
 * a lookup that served the record's row with its goods words. Only the band tools' own rows count; the lines a part
 * of the shape or a page of a group served are `linesRead`'s. PURE.
 */
export function recordReads(readingLogText) {
  const out = new Map();
  const at = (uri) => {
    const key = uriKey(uri);
    if (!key) return null;
    let e = out.get(key);
    if (!e) { e = { opened: new Set(), shown: new Set(), missed: new Set() }; out.set(key, e); }
    return e;
  };
  for (const line of String(readingLogText ?? "").split("\n")) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const session = String(row?.session ?? "unattributed");
    if (row?.tool === "band_record") at(row?.args?.record_id)?.[row.ok === true ? "opened" : "missed"].add(session);
    else if (row?.tool === "band_lookup" && row.ok === true) for (const id of Array.isArray(row.served) ? row.served : []) at(id)?.shown.add(session);
  }
  return out;
}

/**
 * WHAT THE STAGES WERE SHOWN BY LINE, from the same log: band shape line key → {band_shape, group_page}, each a set
 * of session keys. A part of the shape logs the lines printed in it, and a page of a group the lines it returned;
 * both print each line's goods words. Joined to a record through the line it sits on. PURE.
 */
export function linesRead(readingLogText) {
  const out = new Map();
  for (const line of String(readingLogText ?? "").split("\n")) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row?.ok !== true || !Array.isArray(row.served_lines)) continue;
    const via = row.tool === "band_shape" ? "band_shape" : row.tool === "band_lookup" ? "group_page" : null;
    if (!via) continue;
    const session = String(row?.session ?? "unattributed");
    for (const key of row.served_lines) {
      if (typeof key !== "string" || !key) continue;
      let e = out.get(key);
      if (!e) { e = { band_shape: new Set(), group_page: new Set() }; out.set(key, e); }
      e[via].add(session);
    }
  }
  return out;
}

/**
 * Register calls counted four ways, never folded into one: requests sent to the register, answers served from the
 * run's memory (asked, never sent), credits as the register stated them (a request with no figure is counted as
 * such, never as free), and the characters each answer held, which is what the call ledger's `bytes` measures.
 * PURE.
 */
export function registerCallAccount(rows) {
  const out = { requests_sent: 0, failed: 0, answered_from_memory: 0,
    credits: { charged: 0, requests_with_a_figure: 0, requests_without_a_figure: 0 }, response_characters: { sent: 0, from_memory: 0 } };
  for (const row of Array.isArray(rows) ? rows : []) {
    const chars = Number(row?.bytes) || 0;
    if (row?.cache_hit === true) { out.answered_from_memory++; out.response_characters.from_memory += chars; continue; }
    out.requests_sent++;
    out.response_characters.sent += chars;
    if (row?.ok === false) out.failed++;
    const credits = row?.credits_charged;
    if (typeof credits === "number" && Number.isFinite(credits)) { out.credits.charged += credits; out.credits.requests_with_a_figure++; }
    else out.credits.requests_without_a_figure++;
  }
  return out;
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// own-search.mjs — the dictated web searches, run by the run's own AI program in research-only sessions.
//
// The grid's dictated searches (each term on each platform, and the meaning queries) can be run by the run's own AI
// program instead of the grid's research service: each batch in a short session of its own, handed nothing but its
// searches and the program's own web search, through the run's one engine, billing mode and speed. Each search's
// outcome is read from the program's own tool records, kept with the run, and written into the ledger the grid's
// checks already read, so the same reconciliation, coverage floors and receipts judge it. The writing session never
// searches: it reads the ledger as it always has.
//
// THE DRIVER RUNS THE SEARCHES, never the research server: a tool server is handed only its own environment and the
// register credentials, never the AI program's sign-in, so it cannot start a session of the run's engine. The driver
// prepares each grid's ledger before the stage that would call for it, and the research server serves a prepared ledger
// as recorded; where this run's searches are its own and a grid was not prepared, the research server refuses rather
// than send the grid elsewhere, so a run keeps one search service.
//
// SWITCHED ON PER RUN by the run's own record: `research: "own"` in `_driver/run-choices.json`, which the run's door writes
// from the installation's web-research setting (web-research.mjs, engine/run-choices.mjs).
// Absent, nothing here runs, and the installed choice and the order path are as they were.
//
// The reading of each program's records began as an experiment on saved clearances by another developer of this
// project, measured 2026-11-26.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { dictatedCells, connotationQueriesOf, reconcileGridLedger, findUnrecordedConnotationQueries, captureGridFromResponse } from "../../../providers/perplexity/src/core.js";
import { gridProvenancePath } from "./grid-provenance.mjs";
import { parsePrRiskResults } from "../../connotation-search.mjs";
import { driverDir, ensureDriverDir } from "../../../shared/driver-dir.mjs";

import { ownSearchOn } from "./own-search-setting.mjs";
export { RUN_RECORD_FILE, ownSearchOn } from "./own-search-setting.mjs";

const words = (q) => String(q ?? "").trim().replace(/\s+/g, " ");
const unquote = (q) => words(String(q ?? "").replace(/"/g, " ")).toLowerCase();
const siteKey = (s) => String(s ?? "").trim().toLowerCase().replace(/^www\./, "");

// ── WHAT BECAME OF EACH DICTATED SEARCH ─────────────────────────────────────────────────────────────────────────────
//
// Each dictated search gets one outcome, read from the program's own tool records, and the outcomes are never folded
// into one another: a search that found nothing is not a search that was never sent, and neither is a refusal. Measured
// on saved clearances, 2026-11-26:
//   - Codex fills a search's results only "when available": in one pooled run 96 of 147 searches came back with an empty
//     list. So Codex's empty list is "no results reported", never a confirmed empty search. Only Claude's empty results,
//     on a search that ran (a search count above zero, no error), confirm one.
//   - Codex pools a list into one search of several queries even when told not to (25 of 120 in one repeat). Pooled
//     results cannot be told apart, so a pooled search answers none of its queries.
//   - Claude's site limit leaks: 246 of 2,443 site-limited results came from other sites. A result off the requested
//     site is kept and marked, and never counts as the search's answer; where every result is off-site the search's
//     outcome is "wrong-site".
//   - Claude answers a search past its budget with a search count of 0 and "Web search was not performed", not an
//     error: that is "capped".
//   - Codex once refused a whole batch outright, and ran the same batch on a retry: a session that sent no search at
//     all and still answered is "refused".
export const SEARCH_OUTCOMES = Object.freeze(["found", "empty", "no-results-reported", "not-sent", "pooled", "wrong-site", "capped", "refused", "failed", "too-long"]);
/** The outcomes worth one retry, in a smaller batch: the search was never answered, and asking again may answer it. */
export const RETRIED_OUTCOMES = Object.freeze(["not-sent", "pooled", "refused"]);

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
/** Whether a result's address is on the requested site (the site itself or one of its subdomains). PURE. */
export const onSite = (url, site) => { const h = hostOf(url), s = siteKey(site); return Boolean(h && s) && (h === s || h.endsWith(`.${s}`)); };

/** A session's own search records, read from its events: [{ query, site, results, ran, failed, pooled, queries }]. PURE. */
export function searchRecords(search, events = []) {
  const out = [];
  if (search === "claude") {
    const asked = new Map();
    for (const e of events) {
      if (e?.type === "assistant") for (const b of e.message?.content ?? []) if (b?.type === "tool_use" && b.name === "WebSearch") asked.set(String(b.id), b.input ?? {});
      if (e?.type !== "user") continue;
      for (const b of e.message?.content ?? []) {
        if (b?.type !== "tool_result" || !asked.has(String(b.tool_use_id))) continue;
        const input = asked.get(String(b.tool_use_id));
        const r = e.tool_use_result && typeof e.tool_use_result === "object" ? e.tool_use_result : {};
        const results = (Array.isArray(r.results) ? r.results : []).filter((x) => x && typeof x === "object")
          .flatMap((x) => x.content ?? []).map((c) => ({ title: c?.title ?? "", url: c?.url ?? "" })).filter((c) => c.url);
        const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
        const domains = Array.isArray(input.allowed_domains) ? input.allowed_domains : [];
        out.push({ query: String(r.query ?? input.query ?? ""), site: domains.length === 1 ? domains[0] : null, results,
          ran: Number(r.searchCount) > 0 || results.length > 0, capped: Number(r.searchCount) === 0 && /not performed/i.test(text),
          failed: b.is_error === true, pooled: false });
      }
    }
  } else {
    for (const e of events) {
      if (e?.type !== "item.completed" || e.item?.type !== "web_search") continue;
      const it = e.item;
      const queries = Array.isArray(it.action?.queries) && it.action.queries.length ? it.action.queries : [it.action?.query ?? it.query].filter(Boolean);
      const results = (Array.isArray(it.results) ? it.results : []).map((x) => ({ title: x?.title ?? "", url: x?.url ?? "" })).filter((x) => x.url);
      for (const q of queries) {
        const m = String(q).match(/\bsite:(\S+)/i);
        out.push({ query: String(q).replace(/\bsite:\S+/i, "").trim(), site: m ? m[1] : null, results, ran: true, capped: false,
          failed: it.status === "failed", pooled: queries.length > 1, noList: !Array.isArray(it.results) || it.results.length === 0 });
      }
    }
  }
  return out;
}

/**
 * What became of each dictated search in one session: the items in their order, each { query, site, outcome, results },
 * with every result marked `offSite` where the search named a site and the result is not on it. `answered` is whether the
 * session ended with a reply of its own. PURE.
 */
export function searchOutcomes(search, items, events = [], { answered = false } = {}) {
  const recs = searchRecords(search, events);
  const byKey = new Map();
  for (const rec of recs) { const k = `${unquote(rec.query)}\u0000${siteKey(rec.site)}`; if (!byKey.has(k)) byKey.set(k, rec); }
  return items.map((d) => {
    const base = { query: d.query, site: d.site ?? null };
    const rec = byKey.get(itemKey(d));
    if (!rec) return { ...base, outcome: recs.length === 0 && answered ? "refused" : "not-sent", results: [] };
    const results = rec.results.map((r) => ({ ...r, offSite: Boolean(d.site) && !onSite(r.url, d.site) }));
    if (rec.failed) return { ...base, outcome: "failed", results };
    if (rec.pooled) return { ...base, outcome: "pooled", results: [] };
    if (rec.capped) return { ...base, outcome: "capped", results: [] };
    if (search === "codex" && rec.noList) return { ...base, outcome: "no-results-reported", results: [] };
    // No results, no search count and no "not performed": nothing says why, so only what was seen is recorded.
    if (!results.length) return { ...base, outcome: rec.ran ? "empty" : "no-results-reported", results: [] };
    if (results.every((r) => r.offSite)) return { ...base, outcome: "wrong-site", results };
    return { ...base, outcome: "found", results };
  });
}

/** The words a program is asked to send for an item, and the key its record is read back by. */
const sent = (search, item) => (search === "codex" && item.site ? `${item.query} site:${item.site}` : item.query);
const itemKey = (item) => `${unquote(item.query)}\u0000${siteKey(item.site)}`;

/** A batch's prompt: each item's plain words, its site where it has one. */
export function batchPrompt(search, items) {
  const head = search === "claude"
    ? ["Run each web search below exactly once, with the words exactly as written and, where a site is given, limited to that site alone.",
      "Send the words alone: add no quotation marks and no other search operator. Run them all at once, in one message."]
    : ["Run each web search below exactly once, with the words exactly as written. Where a site is given, write `site:<site>` after the words.",
      "Send the words alone: add no quotation marks and no other search operator. Run each search as its own search, one query per search."];
  return [...head, "Do not add, merge, reword or repeat a search. When every search has returned, reply with the word done.", "",
    ...items.map((d, i) => `${i + 1}. ${d.query}${d.site ? `   (site: ${d.site})` : ""}`)].join("\n");
}

// ── THE DICTATED SEARCHES, IN BATCHES, WITH ONE RETRY ───────────────────────────────────────────────────────────────
//
// A batch is up to BATCH searches, never two with the same words and site, whose records could not be told apart. A
// search's words longer than MAX_QUERY_CHARS are not sent: one 8,403-character query held Claude for 23 minutes and
// Codex past 30 (measured 2026-11-26), where the grid's other service refused it at once. Searches not sent or refused
// are asked once more, in batches of RETRY_BATCH, and a pooled search once more on its own; whatever is still unanswered
// after that keeps its outcome.
export const BATCH = 20;
export const RETRY_BATCH = 5;
export const MAX_QUERY_CHARS = 500;

/** The items in batches of at most `size`, no two in one batch with the same words and site. PURE. */
export function batchesOf(items, size) {
  const batches = [];
  let rest = items;
  while (rest.length) {
    const seen = new Set(), take = [], left = [];
    for (const d of rest) { const k = itemKey(d); (seen.has(k) || take.length >= size ? left : (seen.add(k), take)).push(d); }
    batches.push(take); rest = left;
  }
  return batches;
}

/**
 * Run the dictated searches through `session`, one call per batch, and one retry for what was not answered. `session`
 * is `async (items) => ({ events, answered, seconds, usage, model, speed })`, one research-only session of the run's
 * own AI program. Returns `{ outcomes, records }`: the last outcome of each item, in the items' order, and one record per
 * search per attempt, for the run's file of search records. Nothing here writes.
 */
export async function runDictatedSearches(search, items, session, { batch = BATCH, retryBatch = RETRY_BATCH } = {}) {
  const outcomes = new Map(), records = [];
  let sessions = 0;
  const ask = async (list, size, attempt) => {
    for (const b of batchesOf(list, size)) {
      const r = await session(b);
      const sessionNo = ++sessions;
      for (const o of searchOutcomes(search, b, r.events ?? [], { answered: Boolean(r.answered) })) {
        const key = itemKey(o);
        outcomes.set(key, o);
        records.push({ attempt, service: search, model: r.model ?? null, speed: r.speed ?? null, query: o.query, site: o.site,
          sent: sent(search, o), outcome: o.outcome, links: o.results.map(({ url, title, offSite }) => ({ url, title, offSite })),
          // The session's seconds and tokens are the whole batch's, so they ride under the session's own number: a reader
          // that sums them sums each session once, never once per search.
          session: sessionNo, sessionSeconds: r.seconds ?? null, sessionUsage: r.usage ?? null, batchSize: b.length });
      }
    }
  };
  const tooLong = items.filter((d) => String(d.query ?? "").length > MAX_QUERY_CHARS);
  for (const d of tooLong) {
    outcomes.set(itemKey(d), { query: d.query, site: d.site ?? null, outcome: "too-long", results: [] });
    records.push({ attempt: 1, service: search, model: null, speed: null, query: d.query, site: d.site ?? null, sent: null, outcome: "too-long", links: [], session: null, sessionSeconds: null, sessionUsage: null, batchSize: 0 });
  }
  await ask(items.filter((d) => !tooLong.includes(d)), batch, 1);
  // A POOLED SEARCH IS RECOVERED ON ITS OWN: one search to a session, which leaves the program nothing to pool it with, so
  // each query gets its own list and no link is copied into a query it was not found for. The pooled receipt's links are
  // assigned to neither query. Searches not sent or refused are asked again in small batches.
  const again = (outcome) => items.filter((d) => outcomes.get(itemKey(d))?.outcome === outcome);
  const pooled = again("pooled"), unsent = [...again("not-sent"), ...again("refused")];
  if (pooled.length) await ask(pooled, 1, 2);
  if (unsent.length) await ask(unsent, retryBatch, 2);
  return { outcomes: items.map((d) => outcomes.get(itemKey(d))), records };
}

/**
 * The grid program's printed ledger from the searches' outcomes, so the same reconciliation, coverage floors and
 * receipts judge it: a cell or meaning query whose search was answered is a cell (or a receipt) with its on-site
 * results, at most `keep`; every other outcome is a gap row naming it, never a cell that found nothing. A confirmed empty
 * search is the one exception: it is a cell that ran and found nothing. PURE.
 */
export function ledgerFromOutcomes(items, outcomes, { keep = 8 } = {}) {
  const ledger = { cells: [], extras: { pr_risk: [] }, gaps: [] };
  items.forEach((d, i) => {
    const o = outcomes[i];
    const answered = o && (o.outcome === "found" || o.outcome === "empty");
    const results = answered ? o.results.filter((r) => !r.offSite).slice(0, keep).map(({ title, url }) => ({ title, url })) : [];
    if (d.meaning) {
      if (answered) ledger.extras.pr_risk.push({ query: d.query, results });
      else ledger.gaps.push(`${d.query} | connotation | own search: ${o?.outcome ?? "not-sent"}`);
    } else if (answered) ledger.cells.push({ term: d.term, platform: d.platform, status: results.length ? "hit" : "no_hit", candidates: results });
    else ledger.gaps.push(`${d.term} | ${d.platform} | own search: ${o?.outcome ?? "not-sent"}`);
  });
  return ledger;
}

// ── ONE RESEARCH-ONLY SESSION, THROUGH THE RUN'S OWN ENGINE ─────────────────────────────────────────────────────────
//
// A session is a turn of the run's own AI program through the door the native-language turns use (engine/jx-turn.mjs):
// the run's one engine, its one billing mode, and its speed, so an Urgent order asks for the faster setting where the
// model has one and records why where it has not. It runs on the cheap tier: trying the deepest models against the
// cheapest changed what a search returned no more than running the same model again did (measured 2026-11-26). It is
// handed nothing but its dictated searches and the program's own web search, and its event stream is kept, so each
// search's own record is read back from it. Nothing here starts a turn until a session is called.
export const SESSION_TIER = "haiku";
export const SESSION_TIMEOUT_SEC = 600;
const SEARCH_OF_ENGINE = Object.freeze({ "anthropic-agent": "claude", "openai-agent": "codex" });

/** The events of a kept session stream, plain or gzipped once its session closed. IMPURE (reads). */
export function readSessionStream(file) {
  let text = "";
  try { text = readFileSync(file, "utf8"); }
  catch { try { text = gunzipSync(readFileSync(`${file}.gz`)).toString("utf8"); } catch { return []; } }
  return text.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * A maker of research-only sessions for `runDir`, or `{ error }` where the run's engine cannot run one. `session(items)`
 * runs one batch and returns what `runDictatedSearches` reads. `makeRunner` is the native-language turns' door.
 */
export async function makeOwnSearchSessions({ runDir, sessionDir, model = SESSION_TIER, timeoutSec = SESSION_TIMEOUT_SEC, makeRunner = null } = {}) {
  const make = makeRunner ?? (await import("../jx-turn.mjs")).makeJxTurnRunner;
  const runner = await make({ runDir, model, thinking: "low", lane: "the own web search", timeoutSec });
  if (runner?.error) return { error: runner.error };
  const search = SEARCH_OF_ENGINE[runner.engine];
  if (!search) return { error: `the ${runner.engine} engine has no web search of its own that this reads` };
  let n = 0;
  return {
    search, engine: runner.engine,
    async session(items) {
      const streamFile = join(sessionDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${++n}.jsonl`);
      const extra = search === "claude" ? { builtinTools: ["WebSearch"], allowedTools: "WebSearch", webSearch: true, streamFile } : { webSearch: true, streamFile };
      const t0 = Date.now();
      const r = await runner.turn({ prompt: batchPrompt(search, items), extra });
      return { events: readSessionStream(streamFile), answered: Boolean(r?.ok && String(r.text ?? "").trim()), seconds: (Date.now() - t0) / 1000,
        usage: r?.usage ?? null, model: r?.model ?? null, speed: r?.speed ?? null, cause: r?.ok ? null : r?.cause ?? null };
    },
  };
}

// ── THE RECORDS, KEPT WITH THE RUN, AND A REPLAY THAT CALLS NOTHING ─────────────────────────────────────────────────
//
// Every search's record is kept in the run folder, one line each: the service, the model, the speed, the words sent,
// the site, the outcome, the links, and its session's number, seconds and token categories. They are the matter's own content, so they are
// written there and nowhere else. A replay answers each dictated search from the latest record of the same words and
// site, and sends nothing: a search the run never recorded is "not-sent" in the replay, never an empty one.
export const SEARCH_RECORDS_FILE = "web-search-records.jsonl";
const recordsPath = (runDir) => driverDir(runDir, SEARCH_RECORDS_FILE);

/** Append the records to the run's file. Best-effort: a failed write never fails the searches. IMPURE. */
export function keepSearchRecords(runDir, records) {
  if (!runDir || !records?.length) return;
  try {
    ensureDriverDir(runDir);
    appendFileSync(recordsPath(runDir), records.map((r) => JSON.stringify({ ts: new Date().toISOString(), ...r })).join("\n") + "\n");
  } catch { /* best-effort */ }
}

/** The run's kept records, oldest first; [] where there are none. IMPURE (reads). */
export function savedSearchRecords(runDir) {
  if (!runDir) return [];
  try { return readFileSync(recordsPath(runDir), "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}

/** The dictated searches' outcomes from the run's kept records, sending nothing. PURE over `records`. */
export function replayedOutcomes(items, records) {
  const latest = new Map();
  for (const r of records) latest.set(itemKey(r), r);
  return items.map((d) => {
    const r = latest.get(itemKey(d));
    return r ? { query: d.query, site: d.site ?? null, outcome: r.outcome, results: (r.links ?? []).map(({ url, title, offSite }) => ({ url, title, offSite: Boolean(offSite) })) }
      : { query: d.query, site: d.site ?? null, outcome: "not-sent", results: [] };
  });
}

// ── ONE GRID'S LEDGER, PREPARED BEFORE THE STAGE THAT CALLS FOR IT ──────────────────────────────────────────────────

/** Whether a grid spec's ledger is already on disk with every dictated cell and meaning query accounted for. IMPURE (reads). */
export function gridRecorded(spec) {
  if (!spec?.output_path || !existsSync(spec.output_path)) return false;
  try {
    const rec = reconcileGridLedger(readFileSync(spec.output_path, "utf8"), spec);
    return !rec.missing.length && !findUnrecordedConnotationQueries(spec, rec.ledger).missing.length;
  } catch { return false; }
}

/** The dictated searches of a grid spec: each term on each platform (its site, or the general web), then each meaning query. PURE. */
export function dictatedSearches(spec) {
  const use = typeof spec?.use === "string" ? spec.use.trim() : "";
  return [
    ...dictatedCells(spec).map(([term, platform]) => ({ term, platform, query: use ? `${term} ${use}` : String(term),
      site: String(platform).toLowerCase() === "web" ? null : String(platform) })),
    ...connotationQueriesOf(spec).map((q) => ({ meaning: true, query: String(q), site: null })),
  ];
}

/**
 * THE MEANING RE-ASK, THROUGH THE RUN'S OWN AI PROGRAM: the dictated meaning searches in `queries` and nothing else of the
 * grid, run in research-only sessions, each kept as a search record. It answers as the research service's re-issue does
 * (provider-calls.mjs, defaultConnotationReissuer): `{ ok, rows, requested }`, a row for each search that was answered,
 * in the shape the ledger's rows are read in. A search that was not answered is no row, so the caller's re-judge still
 * finds it missing and discloses it; nothing here falls back to another service. `sessions` is makeOwnSearchSessions'.
 * IMPURE.
 */
export async function reissueMeaningSearches(runDir, queries, { sessions, keep = 8 } = {}) {
  if (!sessions?.session) return { ok: false, cause: `own search: ${sessions?.error ?? "no research-only session on this run"}`, rows: [] };
  const asked = [...new Set((queries ?? []).map((q) => String(q).trim()).filter(Boolean))];
  const items = asked.map((query) => ({ meaning: true, query, site: null }));
  try {
    const { outcomes, records } = await runDictatedSearches(sessions.search, items, sessions.session);
    keepSearchRecords(runDir, records);
    const rows = parsePrRiskResults(JSON.stringify(ledgerFromOutcomes(items, outcomes, { keep }))).filter((r) => asked.includes(r.query));
    const counts = {};
    for (const o of outcomes) counts[o?.outcome ?? "not-sent"] = (counts[o?.outcome ?? "not-sent"] ?? 0) + 1;
    return { ok: true, rows, requested: asked.length, outcomes: counts };
  } catch (e) {
    return { ok: false, cause: `own search: ${String(e?.message ?? e).slice(0, 160)}`, rows: [] };
  }
}

/**
 * THE KNOCKOUT'S SWEEP, THROUGH THE RUN'S OWN AI PROGRAM: an executor in the shape the Knockout lane calls its web grid in
 * (pipeline-knockout.mjs, resolveSweepExecutor), `async (spec) -> { ok, ledgerJson, requested, present, missing, bytes,
 * tookMs }` or `{ ok: false, cause }`. One name's dictated searches run in research-only sessions, made once per run when
 * the first name asks; each search's record is kept with the run, and the ledger passes the grid's own capture, so the
 * same reconciliation and floors judge it as judge the other service's. A cause never starts "grid: ", which the lane
 * reads as a program fault worth one more call: own search has already retried what it retries. IMPURE.
 */
export function ownSearchKnockoutGrid(runDir, { makeSessions = makeOwnSearchSessions } = {}) {
  let made = null;
  const sessions = () => (made ??= Promise.resolve(makeSessions({ runDir, sessionDir: driverDir(runDir, "own-search-sessions") })));
  return async (spec) => {
    const started = Date.now();
    const s = await sessions();
    if (!s?.session) return { ok: false, cause: `own search: ${s?.error ?? "no research-only session on this run"}`, tookMs: Date.now() - started };
    const items = dictatedSearches(spec);
    const { outcomes, records } = await runDictatedSearches(s.search, items, s.session);
    keepSearchRecords(runDir, records);
    const ledger = ledgerFromOutcomes(items, outcomes, { keep: spec.results_per_cell ?? 8 });
    const cap = captureGridFromResponse({ output: [{ type: "sandbox_results", code: `own search (${s.search})`,
      results: [{ stdout: JSON.stringify(ledger), stderr: "", exit_code: 0, status: "completed" }] }] }, spec);
    if (!cap.ok) return { ok: false, cause: `own search: below the grid's checks: ${String(cap.error ?? "").slice(0, 200)}`, tookMs: Date.now() - started };
    return { ok: true, ledgerJson: cap.ledgerJson, present: cap.present, requested: cap.requested, missing: cap.missing.length,
      bytes: Buffer.byteLength(cap.ledgerJson), tookMs: Date.now() - started, search: s.search };
  };
}

/**
 * Which re-issue a run's missing meaning searches take: its own AI program's where its searches are its own (`sessions`
 * as makeOwnSearchSessions made them, or null where none could be made), and `otherwise` only on a run that is not. A
 * run whose searches are its own and that has no session re-issues nothing: the re-ask answers why. PURE but for the
 * run's record.
 */
export function meaningReissuerFor(runDir, { sessions = null, otherwise }) {
  if (!ownSearchOn(runDir)) return otherwise;
  return (queries, { spec } = {}) => reissueMeaningSearches(runDir, queries, { sessions, keep: spec?.results_per_cell ?? 8 });
}

/**
 * Prepare one grid spec's ledger through the run's own AI program, where the run's searches are its own and the spec's
 * ledger is not already recorded: run its dictated searches, write the ledger where the spec says, keep each search's
 * record, and write beside the ledger what served it. Returns what it did. `sessions` is makeOwnSearchSessions'. IMPURE.
 */
export async function prepareOwnSearchGrid(runDir, specPath, { sessions } = {}) {
  let spec;
  try { spec = JSON.parse(readFileSync(specPath, "utf8")); } catch (e) { return { prepared: false, why: `the grid spec could not be read: ${String(e?.message ?? e).slice(0, 120)}` }; }
  if (gridRecorded(spec)) return { prepared: false, why: "recorded" };
  if (!sessions?.session) return { prepared: false, why: "no session" };
  const items = dictatedSearches(spec);
  const { outcomes, records } = await runDictatedSearches(sessions.search, items, sessions.session);
  const ledger = ledgerFromOutcomes(items, outcomes, { keep: spec.results_per_cell ?? 8 });
  keepSearchRecords(runDir, records);
  const counts = {};
  for (const o of outcomes) counts[o.outcome] = (counts[o.outcome] ?? 0) + 1;
  // THE GRID'S OWN CHECKS, BEFORE IT IS WRITTEN. The ledger goes through the capture the research service's grid goes
  // through, as one program result, so the same reconciliation and coverage floors judge it. Under a floor (the
  // program's search down, every search refused, a cap) no ledger is written: the research server then refuses the
  // grid, and the stage fails as it would on the other service, rather than shipping a grid of gaps as searched.
  const cap = captureGridFromResponse({ output: [{ type: "sandbox_results", code: `own search (${sessions.search})`,
    results: [{ stdout: JSON.stringify(ledger), stderr: "", exit_code: 0, status: "completed" }] }] }, spec);
  if (!cap.ok) return { prepared: false, why: `below the grid's checks: ${String(cap.error ?? "").slice(0, 200)}`, searches: items.length, outcomes: counts };
  mkdirSync(dirname(spec.output_path), { recursive: true });
  writeFileSync(`${spec.output_path}.tmp`, String(cap.ledgerJson).endsWith("\n") ? cap.ledgerJson : `${cap.ledgerJson}\n`);
  renameSync(`${spec.output_path}.tmp`, spec.output_path);
  try {
    writeFileSync(gridProvenancePath(spec.output_path), JSON.stringify({
      _what: "which service served this grid, written beside it because the ledger itself is the checks' input.",
      provider: sessions.search, surface: "the AI program's own web search, in research-only sessions", engine: sessions.engine,
      models: [...new Set(records.map((r) => r.model).filter(Boolean))], ran: true, searches: items.length, outcomes: counts,
    }, null, 2) + "\n");
  } catch { /* the ledger is on disk; a sidecar fault never undoes it */ }
  const written = JSON.parse(cap.ledgerJson);
  return { prepared: true, searches: items.length, cells: written.cells?.length ?? 0, gaps: written.gaps?.length ?? 0, outcomes: counts };
}


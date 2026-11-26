// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// own-search.mjs — an EXPERIMENT, never shipped: the research server answers its grid and its questions through an AI
// program's own web search instead of Perplexity's, for a side-by-side comparison of the two on saved clearances.
//
// Only the search source changes. The research seats keep their instructions and their one research tool; the server
// hands them the same shapes it hands them from Perplexity: the grid as a sandbox program's printed ledger (so the same
// reconciliation, coverage floors and receipts judge it), and a question's answer as an answer text (so the same
// formatter and the same answer check read it). A search the program refused, did not send, or reported no results for
// is a GAP in the ledger, never a cell that found nothing.
//
// It is switched on by a run-folder setting, `_driver/research-search.json`: { search: "claude"|"codex", program,
// gridModel, questionModel }. Absent, nothing here runs.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** The run's own-search setting, or null where the run sends its research to Perplexity. */
export function ownSearchSetting(runDir) {
  if (!runDir) return null;
  // A stage experiment serves its shadow folder inside the run (`<run>/_experiments/<arm>`); the setting is the run's.
  const p = [runDir, String(runDir).split("/_experiments/")[0]].map((d) => join(d, "_driver", "research-search.json")).find((f) => existsSync(f));
  if (!p) return null;
  try {
    const s = JSON.parse(readFileSync(p, "utf8"));
    if (!["claude", "codex"].includes(s?.search) || typeof s?.program !== "string" || !s.program) return null;
    return { search: s.search, program: s.program, gridModel: s.gridModel || (s.search === "claude" ? "haiku" : "gpt-6-luna"),
      questionModel: s.questionModel || (s.search === "claude" ? "sonnet" : "gpt-6.1-terra") };
  } catch { return null; }
}

const words = (q) => String(q ?? "").trim().replace(/\s+/g, " ");
const unquote = (q) => words(String(q ?? "").replace(/"/g, " ")).toLowerCase();
const siteKey = (s) => String(s ?? "").trim().toLowerCase().replace(/^www\./, "");

/** The program's searches from its event stream: [{ query, site, results:[{title,url,snippet}], reported }]. PURE. */
export function searchesFromEvents(search, events = []) {
  const out = [];
  if (search === "claude") {
    const asked = new Map();
    for (const e of events) {
      if (e?.type === "assistant") for (const b of e.message?.content ?? []) if (b?.type === "tool_use" && b.name === "WebSearch") asked.set(String(b.id), b.input ?? {});
      if (e?.type === "user" && e.tool_use_result && typeof e.tool_use_result === "object" && "results" in e.tool_use_result) {
        const r = e.tool_use_result;
        const id = (e.message?.content ?? []).find((b) => b?.type === "tool_result")?.tool_use_id;
        const input = asked.get(String(id)) ?? {};
        const results = (Array.isArray(r.results) ? r.results : []).filter((x) => x && typeof x === "object").flatMap((x) => x.content ?? [])
          .map((c) => ({ title: c?.title ?? "", url: c?.url ?? "", snippet: "" })).filter((c) => c.url);
        const isError = (e.message?.content ?? []).some((b) => b?.type === "tool_result" && b.is_error === true);
        const notPerformed = r.searchCount === 0 && !results.length;
        const domains = Array.isArray(input.allowed_domains) ? input.allowed_domains : null;
        out.push({ query: r.query ?? input.query ?? "", site: domains?.length === 1 ? domains[0] : null, results, reported: !isError && !notPerformed });
      }
    }
  } else {
    for (const e of events) {
      if (e?.type !== "item.completed" || e.item?.type !== "web_search") continue;
      const it = e.item;
      const queries = Array.isArray(it.action?.queries) ? it.action.queries : [it.action?.query ?? it.query].filter(Boolean);
      const results = (Array.isArray(it.results) ? it.results : []).map((x) => ({ title: x?.title ?? "", url: x?.url ?? "", snippet: String(x?.snippet ?? "").slice(0, 400) })).filter((x) => x.url);
      // One query per record, or the record answers none of them: pooled results cannot be told apart.
      if (queries.length !== 1) continue;
      const m = String(queries[0]).match(/\bsite:(\S+)/i);
      out.push({ query: queries[0], site: m ? m[1] : null, results, reported: Array.isArray(it.results) && it.results.length > 0 });
    }
  }
  return out;
}

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
    if (!results.length) return { ...base, outcome: rec.ran ? "empty" : "capped", results: [] };
    if (results.every((r) => r.offSite)) return { ...base, outcome: "wrong-site", results };
    return { ...base, outcome: "found", results };
  });
}

/** The words a program is asked to send for an item, and the key its record is read back by. */
const sent = (search, item) => (search === "codex" && item.site ? `${item.query} site:${item.site}` : item.query);
const recordKey = (search, rec) => `${unquote(search === "codex" ? String(rec.query).replace(/\bsite:\S+/i, "") : rec.query)}\u0000${siteKey(rec.site)}`;
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

/** A question's prompt. */
export function questionPrompt(task) {
  return ["Research the question below on the web, using your web search, and answer it.",
    "Cite every source you rely on by its full address, inline, next to what it supports. If the search finds nothing relevant, say so plainly.",
    "", `Question: ${task}`].join("\n");
}

function runProgram(setting, { prompt, model, fetch = false, cwd }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const env = {};
    for (const n of ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "USER", "LOGNAME"]) if (process.env[n]) env[n] = process.env[n];
    let args, home = null, seeded = null, master = null;
    if (setting.search === "claude") {
      const tools = fetch ? "WebSearch,WebFetch" : "WebSearch";
      args = ["-p", "--output-format", "stream-json", "--verbose", "--model", model, "--tools", tools, "--allowedTools", tools, "--permission-mode", "dontAsk",
        "--setting-sources", "", "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }), "--disable-slash-commands", "--max-turns", "8"];
    } else {
      master = join(homedir(), ".codex", "auth.json");
      home = mkdtempSync(join(tmpdir(), "own-search-codex-"));
      seeded = existsSync(master) ? readFileSync(master, "utf8") : null;
      if (seeded != null) symlinkSync(master, join(home, "auth.json"));
      writeFileSync(join(home, "config.toml"), ['web_search = "live"', "project_doc_max_bytes = 0", "", "[features]", "apps = false", ""].join("\n"));
      env.CODEX_HOME = home;
      args = ["exec", "--json", "--skip-git-repo-check", "--ignore-rules", "--sandbox", "read-only", "-C", cwd, "-m", model, "-"];
    }
    const p = spawn(setting.program, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (b) => { out += b; }); p.stderr.on("data", (b) => { err += b; });
    const done = (code) => {
      // A sign-in the program renewed during the call goes back to the account's own file.
      if (home && seeded != null) {
        try {
          const f = join(home, "auth.json");
          if (existsSync(f) && !lstatSync(f).isSymbolicLink()) { const now = readFileSync(f, "utf8"); if (now !== seeded) writeFileSync(master, now, { mode: 0o600 }); }
        } catch { /* the account's file stays as it was */ }
        try { rmSync(home, { recursive: true, force: true }); } catch { /* temporary */ }
      }
      const events = out.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      resolve({ code, events, seconds: (Date.now() - t0) / 1000, stderr: err.slice(-400) });
    };
    p.on("error", () => done(null));
    p.on("close", done);
    p.stdin.end(prompt);
  });
}

const usageOf = (search, events) => {
  if (search === "claude") { const r = [...events].reverse().find((e) => e?.type === "result"); return r?.usage ?? null; }
  return [...events].reverse().find((e) => e?.type === "turn.completed")?.usage ?? null;
};
function logOwn(runDir, row) {
  if (!runDir) return;
  try { appendFileSync(join(runDir, "_driver", "own-search-calls.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n"); } catch { /* best-effort */ }
}
function keepEvents(runDir, kind, n, events) {
  if (!runDir) return;
  try {
    const dir = join(runDir, "_driver", "own-search-events");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${kind}-${n}.jsonl`), events.map((e) => JSON.stringify(e)).join("\n") + "\n", { mode: 0o600 });
  } catch { /* best-effort */ }
}

/**
 * The grid, through the program's own search, as the printed ledger a grid program prints: cells, the meaning sweep's
 * receipts and the gaps. `cells` and `meaning` are the spec's dictated cells and meaning queries; `use` and `keep` the
 * spec's. Returns `{ ledgerJson, sessions }`.
 */
export async function ownSearchLedger(setting, { cells = [], meaning = [], use = "", keep = 8, runDir = null, cwd = tmpdir() } = {}) {
  const items = [
    ...cells.map(([term, platform]) => ({ term, platform, query: use ? `${term} ${use}` : String(term), site: String(platform).toLowerCase() === "web" ? null : platform })),
    ...meaning.map((q) => ({ meaning: true, query: q, site: null })),
  ];
  // Calls of up to 20, never two searches with the same words and site in one call: their records could not be told apart.
  const batches = [];
  let rest = items;
  while (rest.length) {
    const seen = new Set(), take = [], left = [];
    for (const d of rest) { const k = itemKey(d); (seen.has(k) || take.length >= 20 ? left : (seen.add(k), take)).push(d); }
    batches.push(take); rest = left;
  }
  const ledger = { cells: [], extras: { pr_risk: [] }, gaps: [] };
  let n = 0;
  for (const batch of batches) {
    const r = await runProgram(setting, { prompt: batchPrompt(setting.search, batch.map((d) => ({ ...d }))), model: setting.gridModel, cwd });
    keepEvents(runDir, "grid", ++n, r.events);
    const recs = searchesFromEvents(setting.search, r.events);
    const byKey = new Map();
    for (const rec of recs) { const k = recordKey(setting.search, rec); if (!byKey.has(k)) byKey.set(k, rec); }
    let answered = 0;
    for (const d of batch) {
      const rec = byKey.get(itemKey(d));
      const why = !rec ? "not sent" : !rec.reported ? "the program reported no results" : null;
      if (d.meaning) {
        if (why) ledger.gaps.push(`${d.query} | connotation | own search: ${why}`);
        else { ledger.extras.pr_risk.push({ query: d.query, results: rec.results.slice(0, keep) }); answered++; }
      } else if (why) ledger.gaps.push(`${d.term} | ${d.platform} | own search: ${why}`);
      else {
        const c = rec.results.slice(0, keep).map(({ title, url }) => ({ title, url }));
        ledger.cells.push({ term: d.term, platform: d.platform, status: c.length ? "hit" : "no_hit", candidates: c });
        answered++;
      }
    }
    logOwn(runDir, { kind: "grid", search: setting.search, model: setting.gridModel, dictated: batch.length, answered, records: recs.length, code: r.code, seconds: r.seconds, usage: usageOf(setting.search, r.events), stderrTail: r.stderr });
  }
  return { ledgerJson: JSON.stringify(ledger), sessions: n };
}

/** A question, through the program's own search: its answer text, or null with why where it gave none. */
export async function ownSearchAnswer(setting, { task, fetch = false, runDir = null, cwd = tmpdir() } = {}) {
  const r = await runProgram(setting, { prompt: questionPrompt(task), model: setting.questionModel, fetch, cwd });
  keepEvents(runDir, "question", Date.now(), r.events);
  let text = null;
  if (setting.search === "claude") text = [...r.events].reverse().find((e) => e?.type === "result")?.result ?? null;
  else text = [...r.events].reverse().find((e) => e?.type === "item.completed" && e.item?.type === "agent_message")?.item?.text ?? null;
  const searches = searchesFromEvents(setting.search, r.events).length;
  logOwn(runDir, { kind: "question", search: setting.search, model: setting.questionModel, searches, answered: Boolean(text && text.trim()), code: r.code, seconds: r.seconds, usage: usageOf(setting.search, r.events), stderrTail: r.stderr });
  const sources = [...new Set(String(text ?? "").match(/https?:\/\/[^\s)\]>"']+/g) ?? [])];
  return text && text.trim() ? { text: text.trim(), sources } : { text: null, why: r.code === 0 ? "the program gave no answer" : `the program exited ${r.code}` };
}

// ── THE DICTATED SEARCHES, IN BATCHES, WITH ONE RETRY ───────────────────────────────────────────────────────────────
//
// A batch is up to BATCH searches, never two with the same words and site, whose records could not be told apart. A
// search's words longer than MAX_QUERY_CHARS are not sent: one 8,403-character query held Claude for 23 minutes and
// Codex past 30 (measured 2026-11-26), where the grid's other service refused it at once. Searches not sent, pooled or
// refused are asked once more, in batches of RETRY_BATCH; whatever is still unanswered after that keeps its outcome.
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
  const ask = async (list, size, attempt) => {
    for (const b of batchesOf(list, size)) {
      const r = await session(b);
      for (const o of searchOutcomes(search, b, r.events ?? [], { answered: Boolean(r.answered) })) {
        const key = itemKey(o);
        outcomes.set(key, o);
        records.push({ attempt, service: search, model: r.model ?? null, speed: r.speed ?? null, query: o.query, site: o.site,
          sent: sent(search, o), outcome: o.outcome, links: o.results.map(({ url, title, offSite }) => ({ url, title, offSite })),
          seconds: r.seconds ?? null, usage: r.usage ?? null, batchSize: b.length });
      }
    }
  };
  const tooLong = items.filter((d) => String(d.query ?? "").length > MAX_QUERY_CHARS);
  for (const d of tooLong) {
    outcomes.set(itemKey(d), { query: d.query, site: d.site ?? null, outcome: "too-long", results: [] });
    records.push({ attempt: 1, service: search, model: null, speed: null, query: d.query, site: d.site ?? null, sent: null, outcome: "too-long", links: [], seconds: 0, usage: null, batchSize: 0 });
  }
  await ask(items.filter((d) => !tooLong.includes(d)), batch, 1);
  const again = items.filter((d) => RETRIED_OUTCOMES.includes(outcomes.get(itemKey(d))?.outcome));
  if (again.length) await ask(again, retryBatch, 2);
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


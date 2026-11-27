// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// research-records.mjs — the run's saved web research, read one way for every reader.
//
// Three readers took the run's research records apart, each by itself: the answers a writer holds
// (research-answers.mjs), the research behind the findings' use checks (research-checks.mjs) and the register pages the
// research saved (saved-register-pages.mjs). Each recognised one service's records by its tool name and its own field
// names, so a record of any other shape read as no research at all. This module is the one reading of those records.
// Each reader keeps its own rules: whose session counts, a question or a grid, a completed call or an attempted one,
// which pages are whole.
//
// THREE ANSWERS, NEVER TWO. A record is research this module reads (`known: true`), research it cannot read
// (`known: false`), or not research (null). Research that cannot be read is never research that found nothing: a search
// that ran and found nothing is a readable record with nothing in it, and a reader can tell the two apart.
//
// THE SERVICE IS THE RECORD'S OWN. A record that names the service that produced it (`service`) is read as that
// service's. A record written before that field existed is attributed only where its tool name positively identifies
// the service. Nothing here looks at which keys an installation holds.
//
// WHICH RECORDS ARE RESEARCH. A call-log row is research where its tool is a research tool this module knows. A saved
// result is research where the research server named the file, `<time>-<pid>-<N>.json`, N being the number of the
// server's call; the same folder also holds owner checks and meaning searches asked again, which are not research
// results and are not read here.
//
// A pure leaf with no imports, so the research server, the band server and the readers can all import it.

/** The research tools this module reads, each with the service a record written before `service` existed is attributed to. */
const RESEARCH_TOOLS = Object.freeze({ perplexity_research: "perplexity" });

const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);

/** The service that produced a research record: the record's own `service`, else the one its tool name identifies. PURE. */
const serviceOf = (rec) => (typeof rec?.service === "string" && rec.service.trim() ? rec.service.trim() : RESEARCH_TOOLS[rec?.tool] ?? null);

/**
 * One row of the run's call log (`_driver/reading-log.jsonl`), read as a research call. PURE.
 *   null: not a research call, such as another tool's row.
 *   { known: false, service, session, question, kind }: a research call whose record this module cannot read.
 *     `question` and `kind` are given where they can still be read, else null.
 *   { known: true, service, kind, question, ok, error, session, replay }: `kind` is "grid" or "question"; `ok` whether
 *     the call completed; `replay` whether a replay answered it from the run's saved research.
 */
export function researchCall(row) {
  if (!isObject(row) || !Object.hasOwn(RESEARCH_TOOLS, row.tool)) return null;
  const service = serviceOf(row);
  const session = typeof row.session === "string" ? row.session : null;
  const args = isObject(row.args) ? row.args : null;
  const question = typeof args?.task === "string" ? args.task : null;
  if (!args || question == null || typeof row.ok !== "boolean")
    return { known: false, service, session, question, kind: args ? (args.grid ? "grid" : "question") : null };
  return { known: true, service, kind: args.grid ? "grid" : "question", question, ok: row.ok, error: row.error ?? null,
    session, replay: Boolean(args.replay) };
}

// The research server's name for the file a call's results are kept in: the time it was kept, with ":" and "." made
// "-", the server's process id, and the number of the call (perplexity-server.mjs `keepRaw`).
const RESULT_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d+-(\d+)\.json$/;

/** The number of the research server's call whose results a file in `_driver/web-results/` keeps, or null where the research server did not name the file. PURE. */
export const researchResultCall = (name) => { const m = RESULT_FILE.exec(String(name ?? "")); return m ? Number(m[1]) : null; };

/**
 * One research result the research server kept, as parsed from its file, read as evidence. PURE.
 *   { known: false, service }: a kept result this module cannot read.
 *   { known: true, service, kind, session, pages }: `kind` is "question" or "grid"; `pages` are the pages the call
 *     fetched, [{url, text}], as fetched, whole or not. A search's snippets are not pages, and a grid's result has none.
 */
export function researchResult(result) {
  const service = serviceOf(result);
  if (!isObject(result) || !Object.hasOwn(RESEARCH_TOOLS, result.tool) || (result.kind !== "question" && result.kind !== "grid")
    || !Array.isArray(result.items)) return { known: false, service };
  const pages = [];
  if (result.kind === "question") {
    for (const item of result.items) {
      if (item?.type !== "fetch_url_results" || !Array.isArray(item.contents)) continue;
      for (const page of item.contents) pages.push({ url: String(page?.url ?? "").trim(), text: page?.snippet });
    }
  }
  return { known: true, service, kind: result.kind, session: typeof result.session === "string" ? result.session : null, pages };
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// providers/serpapi/src/core.js — the SERP grid transport: ONE code-side search-engine call per
// grid cell (engine `baidu` for the zh lane). PURE module — global fetch, injectable fetchImpl,
// no driver imports, offline-testable (the providers/perplexity and providers/jx core discipline).
//
// Contract verified against https://serpapi.com/baidu-search-api:
//   GET https://serpapi.com/search.json?engine=baidu&q=<query>&api_key=<key>
//   site scoping = the `q6` parameter ("Similar to using site:"), NOT a q-string operator — the
//   term stays clean of operators so a mark containing "site:" can never re-scope the query;
//   `rn` = results per page (max 50); `ct=2` = simplified Chinese;
//   organic rows = json.organic_results[] {position, title, link, snippet, displayed_link}.
//   SerpAPI signals "no results" as HTTP 200 + an `error` field — that is a RESULT (an empty,
//   receiptable cell), never a degrade; every other `error` value is a real failure.
//
// No model in the data path: this module fetches and normalizes; classification is the
// judge's job, and the judge never touches the network.

const SEARCH_API_URL = "https://serpapi.com/search.json";
export const DEFAULT_HIT_CAP = 10;   // per cell — the grid is breadth-first; depth is the judge's call
export const MAX_RN = 50;

// Closed engine table — `baidu` for CN is the one shipped engine. An entry exists only for a lane that
// actually ships, so an unknown engine is a config bug, not a fallback.
export const SERP_ENGINES = {
  baidu: {
    params: ({ term, site, count }) => ({
      engine: "baidu",
      q: term,
      ct: "2",                                            // simplified Chinese
      rn: String(Math.min(Math.max(count ?? DEFAULT_HIT_CAP, 1), MAX_RN)),
      ...(site ? { q6: site } : {}),                      // domain restriction — the site: equivalent
    }),
  },
};

/** Assemble the request query params (pure; NO api_key here so params are loggable/receiptable). */
export function buildSearchParams({ engine = "baidu", term, site = null, count = DEFAULT_HIT_CAP }) {
  const spec = SERP_ENGINES[engine];
  if (!spec) throw new Error(`serpapi: unknown engine "${engine}" — engines are a closed table`);
  const t = String(term ?? "").trim();
  if (!t) throw new Error("serpapi: term is required");
  return spec.params({ term: t, site: site ? String(site).trim() : null, count });
}

const NO_RESULTS_RE = /hasn'?t returned any results|no results/i;

/** Normalize organic rows (pure). ANY shape miss → []; rows are clamped and stringified so a
 *  malformed provider payload can never ride raw into a ledger. */
export function parseOrganicHits(json, { cap = DEFAULT_HIT_CAP } = {}) {
  try {
    const rows = Array.isArray(json?.organic_results) ? json.organic_results : [];
    return rows.slice(0, cap).map((r, i) => ({
      rank: Number.isFinite(r?.position) ? r.position : i + 1,
      title: String(r?.title ?? "").slice(0, 300),
      url: String(r?.link ?? "").slice(0, 600),
      displayedUrl: String(r?.displayed_link ?? "").slice(0, 300),
      snippet: String(r?.snippet ?? "").slice(0, 600),
    })).filter((h) => h.url);
  } catch { return []; }
}

export function isRetryableStatus(status) { return status === 429 || (status >= 500 && status < 600); }

export const DEFAULT_TIMEOUT_MS = 15_000;   // per request — a stalled socket must never hang a run
                                            // (the grid runs up to ~84 of these on the paid critical path)

/**
 * GET the search endpoint with retry/backoff (the jx-core idiom: transport throws and 429/5xx retry
 * with linear backoff; other 4xx fail fast — a retry cannot fix a bad key or a bad param). Every
 * request carries an abort deadline — a timeout surfaces as a transport throw (retryable, and after
 * the retry budget a plain degraded cell), never an unbounded hang.
 * @param {object} [opts] { retries, backoffMs, timeoutMs, fetchImpl } — injectable for tests
 */
export async function callSearchAPI(apiKey, params, opts = {}) {
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const qs = new URLSearchParams({ ...params, api_key: apiKey });
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    if (i > 0) await sleep(backoffMs * i);
    let response;
    try {
      response = await fetchImpl(`${SEARCH_API_URL}?${qs}`, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      lastErr = err;   // transport/network throw (incl. the abort deadline) — retryable
      continue;
    }
    if (response.ok) return response.json();
    const errorText = await response.text();
    lastErr = new Error(`SerpAPI ${response.status}: ${errorText.slice(0, 300)}`);
    if (!isRetryableStatus(response.status)) throw lastErr;
  }
  throw lastErr;
}

/**
 * The one-cell convenience the grid executor uses: build → call → parse.
 * Returns { ok:true, hits, tookMs, searchId } (hits may be [] — an empty cell is a RESULT,
 * receipted as a disclosed gap upstream) or { ok:false, cause, tookMs } on real failure.
 */
export async function searchCell({ engine = "baidu", term, site = null, count = DEFAULT_HIT_CAP, apiKey, fetchOpts = {} }) {
  const started = Date.now();
  let json;
  try {
    const params = buildSearchParams({ engine, term, site, count });
    json = await callSearchAPI(apiKey, params, fetchOpts);
  } catch (e) {
    return { ok: false, cause: String(e?.message ?? e).slice(0, 300), tookMs: Date.now() - started };
  }
  const err = json?.error != null ? String(json.error) : null;
  if (err && !NO_RESULTS_RE.test(err))
    return { ok: false, cause: `SerpAPI error: ${err.slice(0, 250)}`, tookMs: Date.now() - started };
  return {
    ok: true,
    hits: err ? [] : parseOrganicHits(json, { cap: count }),
    tookMs: Date.now() - started,
    searchId: String(json?.search_metadata?.id ?? "").slice(0, 80) || null,
  };
}

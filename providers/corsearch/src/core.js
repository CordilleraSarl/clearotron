// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Clearotron Corsearch plugin — pure logic + HTTP helpers, with ZERO plugin-SDK / typebox imports
// (node built-ins + global fetch only). This is the testable core: index.js imports from here and
// adds the SDK tool-factory registration + the TypeBox parameter schemas (which DO need the SDK and
// typebox, neither of which is resolvable in an offline `node --test` run). Tests import this module
// directly.
//
// PACKAGING NOTE (shared-kernel extraction): this core now imports the shared
// adapter kernel from ../../_shared/ — a sibling of src/, NOT inside it. Any gateway-plugin packaging
// step that copies only src/ → dist/ must be widened to carry providers/_shared/ alongside it, or the
// built plugin fails at import time. In this repo nothing copies: driver.config.mjs, the MCP servers
// and the tests all import providers/<id>/src/core.js in place from the tree.

import { makeLedger } from "../../_shared/ledger.mjs";
import { nonAnswerBodyError, parseJsonBody, unparsedBodyError } from "../../_shared/http-body.mjs";
import { normalizeTerritory } from "../../_shared/territory-codes.mjs";
import {
  BATCH_SCREEN_CHUNK, chunk, classifyStatus, isAllClass, normalizeBrandRow, screenVerdict,
} from "../../_shared/screen.mjs";
import { makeEnumerate, ENUMERATE_NAMES_CHUNK_DEFAULT } from "../../_shared/enumerate.mjs";
import { makeCountProbe } from "../../_shared/count.mjs";
import { makeExecutePlan, planPredicateParams } from "../../_shared/execute-plan.mjs";
import { CAPABILITIES } from "./capabilities.js";

export const BASE_SEARCH = "https://tm.corsearch.com/api/supremesearch/v1/supremesearch";
export const BASE_DETAIL = "https://tm.corsearch.com/api/meta/v1";
export const BASE_IMAGE  = "https://tm.corsearch.com/api/mediaservice/v1";

export const MATCH_MODE_PREFIX = {
  default:     "",
  exact:       "=",
  phrase:      '"',
  starts_with: "^",
  ends_with:   "$",
  phonetic:    "*",
  fuzzy:       "~",
  not:         "!",
  must:        "&",
};

// ── Telemetry: per-call ledger at the corsearchFetch chokepoint ──────────────
// Corsearch bills per API call, and agent-narrated call counts are unreliable. This appends one
// billing-grade JSONL line per call at the single chokepoint every tool flows through. It is fully
// isolated in try/catch — a telemetry failure must NEVER affect a search — and it does not change any
// tool's returned payload, so it costs the agent zero tokens and ~0 time (a local file append vs a
// 100s-of-ms network call).
//
// The implementation is now the ONE shared ledger (providers/_shared/ledger.mjs) that clarivate and
// signa also use: same env vars (CLEAROTRON_REGISTER_CALL_LOG / CLEAROTRON_REGISTER_RECORD_LOG — the wire contract with
// driver/provider-usage.mjs, driver/registry-fidelity.mjs, driver/coverage-ledger.mjs and
// engine/mcp/gather-config.mjs), same default homedir() paths, same import-time path capture, plus a
// `provider` discriminator on every row.
//
// SECURITY — the ids logged (agentId / sessionKey / sessionId) are the GATEWAY tool-call context
// (e.g. "clawdi", "prelim-acme-…"), the per-run attribution. They are NOT the Corsearch `sessionKey`
// COOKIE (the live credential, which merely shares the name). logCall is only ever handed `tctx`
// (kind + gateway ids + target) and response metrics — the cookie is never passed in. Keep it so.
export const { logCall, logRecordBody, tctxOf } = makeLedger("corsearch");

// ── HTTP helper ─────────────────────────────────────────────────────────────
// GET by default; pass { method:"POST", body, contentType } for the batch endpoints (brand-json).
// Same Cookie auth + same logCall chokepoint on every method — a POST is metered identically to a GET.

export async function corsearchFetch(sessionKey, url, { binary = false, retries = 1, tctx = null, method = "GET", body = null, contentType = null } = {}) {
  const headers = { Cookie: `sessionKey=${sessionKey}` };
  if (!binary) headers["Accept"] = "application/json";
  if (method !== "GET" && contentType) headers["Content-Type"] = contentType;
  const init = { method, headers };
  if (body != null) init.body = body;

  const t0 = Date.now();
  let attempts = 0;
  let resp;
  try {
    for (let i = 0; i <= retries; i++) {
      attempts = i + 1;
      resp = await fetch(url, init);
      if (resp.ok || resp.status < 500 || i === retries) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  } catch (err) {
    // transport/network throw — record the failed call, then preserve the original propagate behaviour.
    logCall(tctx, { http_status: 0, ok: false, attempts, took_ms: Date.now() - t0, bytes: 0, cache_hit: false });
    throw err;
  }

  const respContentType = resp.headers.get("content-type") || "";

  if (binary) {
    const arr = await resp.arrayBuffer();
    logCall(tctx, { http_status: resp.status, ok: resp.ok, attempts, took_ms: Date.now() - t0, bytes: arr.byteLength, cache_hit: false });
    return { status: resp.status, ok: resp.ok, url, contentType: respContentType, bytes: arr.byteLength };
  }

  const raw = await resp.text();
  // The parse failure RIDES OUT on `parseError` rather than being swallowed — see
  // providers/_shared/http-body.mjs for why a discarded one produces a false clean. `body` keeps its
  // old value (the parsed JSON, or null) so every existing `r.body?.message` reader is unchanged.
  const { body: parsed, parseError } = parseJsonBody(raw);
  logCall(tctx, { http_status: resp.status, ok: resp.ok, attempts, took_ms: Date.now() - t0, bytes: raw.length, cache_hit: false });
  return { status: resp.status, ok: resp.ok, url, contentType: respContentType, body: parsed, raw, parseError };
}

// ── Query assembly ──────────────────────────────────────────────────────────

/**
 * Build a single clause string like `=name:`NIKE`` from (prefix, field, value).
 * Variants extension (Pname-style `(v1,v2,...)`) is appended only for phonetic mode.
 */
function clause(prefix, field, value, variants) {
  let s = `${prefix}${field}:\`${value}\``;
  if (variants && variants.length) {
    s += `(${variants.join(",")})`;
  }
  return s;
}

/**
 * Assemble the full `query` string from structured params.
 * All values are backtick-quoted (required by the live API).
 * Clauses are space-separated (implicit AND across fields; implicit OR within same field unless `must` is used).
 */
export function assembleQuery(p) {
  const parts = [];
  const prefix = MATCH_MODE_PREFIX[p.match_mode || "default"];
  if (prefix === undefined) throw new Error(`unknown match_mode: ${p.match_mode}`);

  // Primary search elements (at least one required)
  if (p.id)             parts.push(clause("", "id", p.id));
  if (p.name)           parts.push(clause(prefix, "name", p.name, p.match_mode === "phonetic" ? p.phonetic_variants : null));
  if (Array.isArray(p.names)) for (const n of p.names) parts.push(clause(prefix, "name", n));
  if (p.owner)          parts.push(clause("", "owner", p.owner));
  if (Array.isArray(p.owners)) for (const o of p.owners) parts.push(clause("", "owner", o));   // OR-stack of owner names (same-field implicit OR — mirrors `names`)
  if (p.product)        parts.push(clause("", "product", p.product));
  if (p.representative) parts.push(clause("", "representative", p.representative));

  // Filters (each value must be backtick-quoted)
  if (Array.isArray(p.nice_classes))  for (const c of p.nice_classes) parts.push(clause("", "nice-class", c));
  if (Array.isArray(p.registries))    for (const r of p.registries)   parts.push(clause("", "registry", r));
  // Regions go to the wire as CODES only (copper-bastion incident: Corsearch answers an unknown
  // multi-word region value with HTTP 500 — not a 400 — so a display name here poisons every retry).
  // Known display names are translated; Worldwide drops the clause; anything else fails loudly with
  // a message the composing model can act on in-session.
  if (Array.isArray(p.regions)) for (const r of p.regions) {
    const code = normalizeTerritory(r);
    if (code === null) throw new Error(`unknown region "${r}" — regions take UPPERCASE 2-letter codes (e.g. US, EU, CH, GB, WO)`);
    if (code === "") continue;                        // Worldwide → no region clause (search all offices)
    parts.push(clause("", "region", code));
  }
  if (p.owner_country)                                                parts.push(clause("", "owner-country", p.owner_country));
  if (p.application_date_after)       parts.push(clause("", "app-after",  p.application_date_after));
  if (p.application_date_before)      parts.push(clause("", "app-before", p.application_date_before));
  if (p.registration_date_after)      parts.push(clause("", "reg-after",  p.registration_date_after));
  if (p.registration_date_before)     parts.push(clause("", "reg-before", p.registration_date_before));

  // "Not" clauses (separate from match_mode — exclusionary)
  if (Array.isArray(p.name_not)) for (const n of p.name_not) parts.push(clause("!", "name", n));

  return parts.join(" ");
}

export function hasAnyElement(p) {
  return !!(p.id || p.name || p.owner || p.product || p.representative
    || (Array.isArray(p.names) && p.names.length > 0)
    || (Array.isArray(p.owners) && p.owners.length > 0));
}

// ── Response normalization ──────────────────────────────────────────────────

// Default fields requested from the search endpoint.
// The /search/trademark endpoint only ever
// returns three fields regardless of what fieldsInclude requests —
// `uri`, `name`, and `representativeName`. Other field names (niceClassification,
// owners, corsearchStatusCode, applicationDate, etc.) are silently dropped.
// Screening data MUST come from corsearch_record_fetch on each candidate.
// Callers can pass params.fields to override (e.g. ["uri"] for the cheapest
// count-only probes) or to experiment with other field names as Corsearch
// evolves the endpoint.
export const DEFAULT_SEARCH_FIELDS = [
  "uri",
  "name",
  "representativeName",
  // T7 (E6): the active-enforcer telemetry rides search/enumerate rows too (it was
  // detail-record-only) — band records can carry the provider's aggression indicator. Tolerant:
  // absent on older responses ⇒ null; extractEnforcerSignals already tolerates absence.
  "onomaticsAggression",
];

// ── the discrimination is "did the provider ANSWER", not "did the bytes parse" ────────────────────
// refused the unparseable 200; the adversarial review then produced the identical false clean
// ONE JSON envelope away: a 200 whose body is `{"message":"upstream search cluster unavailable"}`
// is valid JSON, so parseError never fires — and the old fallback coerced "an object with no
// totalHitCount" to 0, on a comment claiming a present body is "the provider answering". It is not.
// A SEARCH RESPONSE is a body that carries the search-response shape this endpoint was probed to
// return: totalHitCount (the count), rows (the records) or nextRequest (the paging cursor). A
// parseable body with none of the three — an error envelope, a gateway stub — is the provider
// saying something OTHER than an answer, and it rides out as a non-answer (null total, an error
// surfaced by doSearch), never as 0.
export function isSearchResponseBody(body) {
  return body != null && typeof body === "object" && !Array.isArray(body)
    && (Number.isInteger(body.totalHitCount) || Array.isArray(body.rows) || body.nextRequest != null);
}

export function normalizeSearchResponse(body, echoQuery, matchMode) {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  // ── a NON-ANSWER reports total_hits NULL, never 0 ──────────────────────────────────────────────
  // `body` is null when the response did not parse (a truncated 200, a gateway error page served
  // with a success status) and shapeless when it parsed into something that is not a search response
  // (a 200 carrying an error envelope). Defaulting either to 0 MINTED the number:
  // `{state:"enumerated", total_hits:0, records:[]}` — a positively asserted clean over a query that
  // never landed. doSearch REFUSES both before they can reach here (that is the real guard); this is
  // the second lock on the same door, for any future caller that normalizes directly — and the
  // shared kernels hold the third (a non-finite total_hits can support no completeness claim, in
  // either direction: count.mjs answers UNKNOWN, enumerate.mjs answers incomplete).
  // A body that IS search-shaped but carries no totalHitCount answers with its rows — the count is
  // their length, which for the honest-empty page is the same 0 as before.
  const totalHits = Number.isInteger(body?.totalHitCount) ? body.totalHitCount
    : (isSearchResponseBody(body) ? rows.length : null);
  const nextRequest = body?.nextRequest ?? null;

  return {
    query: echoQuery,
    match_mode: matchMode || "default",
    total_hits: totalHits,
    has_more: nextRequest !== null,
    next_page_token: nextRequest !== null ? JSON.stringify(nextRequest) : null,
    cap_warning: totalHits > 5000
      ? `totalHitCount=${totalHits} exceeds the 5000-record pagination ceiling; only the top 5000 are reachable via paging.`
      : null,
    took_ms: body?.took ?? null,
    warnings: Array.isArray(body?.warnings) ? body.warnings : [],
    sources: Array.isArray(body?.sources) ? body.sources : [],
    results: rows.map((row) => {
      const doc = row.document || {};
      const ownerFirst = Array.isArray(doc.owners) ? doc.owners[0] : null;
      return {
        record_id: doc.uri ?? null,
        mark_text: doc.name ?? null,
        representative_name: doc.representativeName ?? null,
        score: row.score ?? null,
        poca_scores: row.pocaScores ?? null,
        highlight: row.highlight ?? null,
        classes: doc.niceClassification ?? null,
        status: doc.corsearchStatusCode ?? doc.corsearchEstimatedStatusCode ?? doc.markCurrentStatusCode ?? null,
        status_date: doc.markCurrentStatusDate ?? null,
        application_date: doc.applicationDate ?? null,
        registration_date: doc.registrationDate ?? null,
        expiry_date: doc.expiryDate ?? null,
        owner_name: ownerFirst?.organizationName ?? null,
        owner_country: ownerFirst?.addressCountry ?? null,
        jurisdictions: doc.onomaticsJurisdictionsStatuses ?? null,
        onomaticsAggression: doc.onomaticsAggression ?? null,   // T7 (E6) — provider enforcement telemetry
        mark_feature: doc.markFeature ?? null,
        image_path: doc.imagePath ?? null,
        raw: row,
      };
    }),
  };
}

// ── Search (with per-run dedup) ───────────────────────────────────────────────
// The plugin runs in the long-lived gateway daemon, so this module-level Map persists across tool
// calls within a run. A run issues the SAME search more than once (~12% of this build's baseline run
// were exact-duplicate sweeps — name:CLAWDI, the JP and CN transliteration sweeps each issued twice),
// invisible to telemetry because the dup counter watched record_fetch only. We cache the normalized
// result keyed on the GATEWAY session key (per-run, unique → no cross-run collision) + the FULL
// canonical upstream query tail (so a different page / field-set is NOT a dup). On an exact repeat we
// return the byte-identical cached payload and meter it cache_hit:true (counted, billed-as-saved).
// Floor-neutral: identical query+params ⇒ identical upstream results.
const SEARCH_CACHE = new Map();
const SEARCH_CACHE_MAX = 2000; // bounded over daemon lifetime; eviction only ever costs a re-fetch, never recall.

// Test-only: clear the cache so cases don't bleed into each other.
export function __resetSearchCache() { SEARCH_CACHE.clear(); }

export async function doSearch(sessionKey, params, tctx) {
  if (!hasAnyElement(params)) {
    return { type: "text", text: "ERROR: at least one search element (id, name, names, owner, product, representative) is required." };
  }

  const queryStr = assembleQuery(params);
  const urlParams = new URLSearchParams({ query: queryStr });
  if (params.limit != null)     urlParams.set("limit", String(params.limit));
  if (params.page != null)      urlParams.set("page",  String(params.page));
  if (params.sort)              urlParams.set("sort",  params.sort);
  if (params.ascending != null) urlParams.set("ascending", String(params.ascending));
  const fieldList = Array.isArray(params.fields) && params.fields.length > 0 ? params.fields : DEFAULT_SEARCH_FIELDS;
  urlParams.set("fieldsInclude", fieldList.join(","));

  // Dedup key: per-run scope (gateway sessionKey) + the exact canonical query tail actually sent
  // upstream (urlParams captures query+limit+page+sort+ascending+fieldsInclude after defaulting).
  const cacheKey = `${tctx?.sessionKey ?? ""}|${urlParams.toString()}`;
  const callTctx = { ...tctx, target: queryStr.slice(0, 200) };
  if (SEARCH_CACHE.has(cacheKey)) {
    const cached = SEARCH_CACHE.get(cacheKey);
    logCall(callTctx, { http_status: 200, ok: true, attempts: 0, took_ms: 0, bytes: cached.text.length, cache_hit: true });
    return cached;
  }

  const url = `${BASE_SEARCH}/search/trademark?${urlParams.toString()}`;
  const r = await corsearchFetch(sessionKey, url, { tctx: callTctx });
  if (!r.ok) {
    const msg = r.body?.message ? `: ${r.body.message}` : "";
    // Do NOT cache errors — a transient 5xx must stay retryable.
    return { type: "text", text: `ERROR: corsearch_search HTTP ${r.status}${msg} for query=${queryStr.slice(0, 200)}` };
  }
  // ── THE GUARD: a 200 whose body did not parse is a FAILURE, not an empty result set ─────────────
  // This is the one line that closes the false clean, and it closes every inheriting path at once
  // because they all key on the ERROR: prefix through the shared kernels' isToolError:
  //   · enumerate  → `provider error during enumeration (page N)` ⇒ state:"incomplete", not enumerated
  //   · count      → { ok:false, total:null } ⇒ Stage 0.5 records UNKNOWN, never "no filings found"
  //   · the count-first per-term and per-CLASS rescues ⇒ disposition "error", never "verified-zero"
  //   · execute-plan → matches /provider error/i ⇒ one retry, then error:true ⇒ the slice joins MISSING
  // NOT cached, for the same reason a 5xx is not: a cut connection must stay retryable.
  if (r.parseError) {
    return { type: "text", text: unparsedBodyError("corsearch_search", r, ` query=${queryStr.slice(0, 200)}`) };
  }
  // ── THE GUARD'S SECOND HALF: parsing is not answering ───────────────────────────────────────────
  // A 200 whose body is a perfectly parseable error envelope ({"message":"upstream search cluster
  // unavailable"}) sails past parseError and used to normalize to total_hits:0 — the identical false
  // clean one JSON envelope away from the truncated 200. Only the search-response shape is an
  // answer; anything else rides out on the same ERROR: prefix, so it inherits the same paths the
  // parseError refusal does (incomplete / UNKNOWN / disposition error / slice MISSING). NOT cached,
  // for the same reason: a provider hiccup must stay retryable.
  if (!isSearchResponseBody(r.body)) {
    return { type: "text", text: nonAnswerBodyError("corsearch_search", r, "a search response (no totalHitCount, no rows, no nextRequest)", ` query=${queryStr.slice(0, 200)}`) };
  }
  const result = { type: "text", text: JSON.stringify(normalizeSearchResponse(r.body, queryStr, params.match_mode || "default"), null, 2) };
  if (SEARCH_CACHE.size >= SEARCH_CACHE_MAX) SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value); // evict oldest
  SEARCH_CACHE.set(cacheKey, result);
  return result;
}

// ── Record fetch ──────────────────────────────────────────────────────────────

// Pure machine-plumbing on the detail record, dropped to shrink the payload the AI reasons
// over. Every legally/semantically meaningful field is KEPT (mark text, transliteration,
// Vienna classification, publications, owners, classes, status, dates, opposition, office,
// language, enriched/onomatics aggression, image filePath+mediaType). These drops are either
// internal IDs/timestamps or exact duplicates of fields we keep — verified against captured
// detail records.
const RECORD_PLUMBING_FIELDS = [
  "onomaticsBatchId",
  "onomaticsBatchLastModified",
  "utcCreatedDatetime",
  "utcUpdatedDatetime",
  "onomaticsSourceId",
  "tradeMarkIdentifier",
  // exact duplicates of applicationDate / registrationDate / markFeature (kept)
  "onomaticsApplicationDate",
  "onomaticsRegistrationDate",
  "onomaticsMarkFeature",
  "onomaticsMarkFeatures",
];
// Blob plumbing nested in each onomaticsMediaResources entry. filePath + mediaType are kept —
// they are the image reference corsearch_image_fetch needs.
const MEDIA_PLUMBING_FIELDS = ["fileSize", "fileHash", "fileLastModified"];

export function trimRecordPlumbing(body) {
  if (!body || typeof body !== "object") return body;
  const records = Array.isArray(body) ? body : [body];
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    for (const k of RECORD_PLUMBING_FIELDS) delete rec[k];
    if (Array.isArray(rec.onomaticsMediaResources)) {
      for (const m of rec.onomaticsMediaResources) {
        if (m && typeof m === "object") for (const k of MEDIA_PLUMBING_FIELDS) delete m[k];
      }
    }
  }
  return body;
}

export async function doRecordFetch(sessionKey, params, tctx) {
  const { record_id, translate = false } = params;
  if (!record_id) return { type: "text", text: "ERROR: record_id is required" };
  const url = `${BASE_DETAIL}/trademark-details?uri=${encodeURIComponent(record_id)}&translate=${translate}`;
  const r = await corsearchFetch(sessionKey, url, { tctx: { ...tctx, target: record_id } });
  if (!r.ok) {
    return { type: "text", text: `ERROR: corsearch_record_fetch HTTP ${r.status} for uri=${record_id}` };
  }
  // The same rule one layer down: an unparsed body here was persisted as a NULL record under a real
  // record id, which the citation-fidelity gate then reads as a record that carries no facts.
  if (r.parseError) {
    return { type: "text", text: unparsedBodyError("corsearch_record_fetch", r, ` uri=${record_id}`) };
  }
  const trimmed = trimRecordPlumbing(r.body);
  // A1: persist the trimmed record body (all legally-meaningful fields) keyed by gateway session, so the
  // driver can field-verify registry identifiers and archive the record into the run.
  logRecordBody({ ...tctx, kind: "record_fetch" }, record_id, trimmed);
  return { type: "text", text: JSON.stringify(trimmed, null, 2) };
}

export async function doImageFetch(sessionKey, params, tctx) {
  const { image_path, size = "300x200" } = params;
  if (!image_path) return { type: "text", text: "ERROR: image_path is required (from search result detail's imagePath or onomaticsImagePath)" };
  const url = `${BASE_IMAGE}/img${image_path}?size=${encodeURIComponent(size)}`;
  const r = await corsearchFetch(sessionKey, url, { binary: true, tctx: { ...tctx, target: image_path } });
  if (!r.ok) {
    return { type: "text", text: `ERROR: corsearch_image_fetch HTTP ${r.status} for path=${image_path}` };
  }
  return {
    type: "text",
    text: JSON.stringify({ url: r.url, content_type: r.contentType, size_bytes: r.bytes, requested_size: size }, null, 2),
  };
}

export async function doExpandPhoneme(sessionKey, params, tctx) {
  const { word, language = "en_US" } = params;
  if (!word) return { type: "text", text: "ERROR: word is required" };
  const url = `${BASE_SEARCH}/expand-phoneme?word=${encodeURIComponent(word)}&language=${encodeURIComponent(language)}`;
  const r = await corsearchFetch(sessionKey, url, { tctx: { ...tctx, target: `${word}|${language}` } });
  if (!r.ok) {
    return { type: "text", text: `ERROR: corsearch_expand_phoneme HTTP ${r.status} for word=${word} language=${language}` };
  }
  // An unparsed body here returned the literal text "null", which a phonetic sweep reads as "this word
  // has no sound-alikes" — a silently NARROWED search, the same fault wearing a different coat.
  if (r.parseError) {
    return { type: "text", text: unparsedBodyError("corsearch_expand_phoneme", r, ` word=${word} language=${language}`) };
  }
  // Body shape: { base: ["nike"], aiVariants: [...] }
  return { type: "text", text: JSON.stringify(r.body, null, 2) };
}

// ── Batch screen (brand-json) — GATED, flagged OFF ─────────────────────────────
// brand-json hydrates ~100 candidate URIs in ONE POST with the screening data the thin search row lacks
// (classes/status/owner/dates/jurisdictions/image/transliteration) — but NOT goodsAndServices. It replaces
// the per-candidate record_fetch for the SCREENING majority (status/class/owner keep-or-drop); finalists +
// any G&S-dependent decision still deep-fetch (the skill enforces that — skills/prelim-register/unit.md).
// The tool is registered but left OUT of every agent's tools.allow until the live probe + Alex recall A/B +
// sign-off (the GATE) — so it is inert today.

// The pure screening primitives now live in providers/_shared/screen.mjs (one implementation for every
// provider); they are RE-EXPORTED here unchanged so every existing importer — engine/mcp/corsearch-server.mjs,
// register-plan.mjs, the driver — keeps resolving them from this module with identical semantics.
// classifyStatus carries brand-json's vocabulary (Valid/Pending/GracePeriod live; Invalid/Expired dead;
// anything else AMBIGUOUS → never auto-drop). BATCH_SCREEN_CHUNK = 100 = the observed brand-json page size.
export { BATCH_SCREEN_CHUNK, chunk, classifyStatus, isAllClass, normalizeBrandRow, screenVerdict };

export async function doBatchScreen(sessionKey, params, tctx) {
  const uris = Array.isArray(params?.uris) ? params.uris.filter((u) => typeof u === "string" && u) : [];
  if (uris.length === 0) return { type: "text", text: "ERROR: uris (a non-empty array of trademark URIs) is required" };
  const inScopeClasses = Array.isArray(params?.in_scope_classes)
    ? params.in_scope_classes.map(Number).filter(Number.isFinite) : [];

  const groups = chunk(uris, BATCH_SCREEN_CHUNK);
  const rows = [];
  const errors = [];
  for (const group of groups) {
    // POST body is `uri=…&uri=…` with the key REPEATED (HAR-verified) — a plain object cannot hold repeated
    // keys, so build it with URLSearchParams.append per uri. One chunk = one billable call (metered via the
    // shared chokepoint as kind "batch_screen").
    const form = new URLSearchParams();
    for (const u of group) form.append("uri", u);
    const r = await corsearchFetch(sessionKey, `${BASE_DETAIL}/brand-json`, {
      method: "POST", body: form.toString(), contentType: "application/x-www-form-urlencoded",
      tctx: { ...tctx, target: `batch:${group.length}` },
    });
    if (!r.ok) { errors.push(`HTTP ${r.status} for a ${group.length}-uri chunk`); continue; }
    // A truncated 200 contributed zero rows and pushed NOTHING into errors[], so a chunk that FAILED
    // was indistinguishable from a chunk of records the provider had nothing to say about. It is a
    // chunk error like any other — and the kernel's contentFromScreen seam reads errors[] to decide
    // whether a band's content actually landed.
    if (r.parseError) { errors.push(`unparseable body (HTTP ${r.status}, ${r.parseError}) for a ${group.length}-uri chunk`); continue; }
    // Shape, not just parse: brand-json answers a ROW ARRAY. A parseable body that is anything else —
    // an error envelope served with a 200 — used to fall through `Array.isArray(r.body) ? r.body : []`
    // as zero rows with NOTHING in errors[], indistinguishable from a chunk the provider had no
    // screening facts for. It is a chunk that FAILED, exactly like the unparseable case above.
    if (!Array.isArray(r.body)) {
      errors.push(`non-answer body (HTTP ${r.status}, parsed but not the brand-json row array`
        + `${r.body?.message ? ` — the body says: ${JSON.stringify(String(r.body.message).slice(0, 120))}` : ""}) for a ${group.length}-uri chunk`);
      continue;
    }
    for (const row of r.body) rows.push(normalizeBrandRow(row));
  }
  if (rows.length === 0 && errors.length) {
    return { type: "text", text: `ERROR: corsearch_batch_screen — ${errors.join("; ")}` };
  }
  // Stamp the closed-set screen_verdict on every row so a goods/field drop of an in-scope live mark can
  // never rest on the batch row alone (Finding-1 gate). surface:* / deepfetch:* rows are NOT droppable here.
  const verdict_summary = {};
  for (const row of rows) {
    row.screen_verdict = screenVerdict(row, inScopeClasses);
    verdict_summary[row.screen_verdict] = (verdict_summary[row.screen_verdict] ?? 0) + 1;
  }
  return { type: "text", text: JSON.stringify({
    requested: uris.length, returned: rows.length, chunks: groups.length,
    in_scope_classes: inScopeClasses.length ? inScopeClasses : "NOT PROVIDED — live marks fail-safe to surface:in-scope-live (no class-drop)",
    errors: errors.length ? errors : undefined,
    note: "Per-row `screen_verdict` (CLOSED SET) is the keep/drop authority — NOT the mark name or owner. drop:dead = Invalid/Expired; drop:out-of-class = live but no in-scope-class overlap and not all_class — these two are batch-screen-authoritative drops. surface:in-scope-live and surface:all-class = a real in-scope candidate: it is NOT goods/field-droppable here — keep it as a conflict, OR if you believe it is off-field you MUST corsearch_record_fetch and decide on the actual goodsAndServices (brand-json has none). deepfetch:ambiguous = Unknown status, must record_fetch. NEVER drop a surface:* or deepfetch:* row on a name/owner/goods guess without a record_fetch.",
    verdict_summary,
    rows,
  }, null, 2) };
}

// ── Enumerate + execute-plan — WIRED FROM THE SHARED KERNEL ─────────────────────────────────────────
//
// The control flow (states, ceilings, the wide-`names` chunking, the count-first per-term rescue, the
// qid stamping and the band MERGE) lives in providers/_shared/{enumerate,execute-plan}.mjs, one
// implementation for every provider. This module supplies ONLY the corsearch callables and declares its
// two capabilities — and both are chosen so the observable behaviour is byte-for-byte what it was when
// the kernel was inlined here:
//
//   countProbe: "cheap"        — the page-0 `doSearch` IS the count probe (totalHitCount rides the first
//                                100 rows), so the enumerate ceiling is tested FETCH-THEN-CHECK in ONE
//                                round trip and those rows are reused as the crowd sample. There is NO
//                                pre-loop count call: adding one would double the billable calls. The
//                                per-term rescue probe is the cheapest search (limit:1, fields:["uri"]),
//                                which also rides the per-run SEARCH_CACHE and meters cache_hit.
//   screenSource: "bulk-endpoint" — brand-json hydrates 100 candidate uris per POST (doBatchScreen below);
//                                an enumerated band crosses the firewall already screened.
//
// ENUMERATE_NAMES_CHUNK_DEFAULT is re-exported unchanged: driver/register-plan.mjs mirrors it at COMPILE
// time as PLAN_MAX_OR_WIDTH and an agreement test pins the two together.
export { ENUMERATE_NAMES_CHUNK_DEFAULT };
export { CAPABILITIES };
export { planPredicateParams };

const { enumerate: __enumerate } = makeEnumerate({
  search: (sessionKey, params, tctx) => doSearch(sessionKey, params, tctx),
  screen: (sessionKey, params, tctx) => doBatchScreen(sessionKey, params, tctx),
  hasAnyElement,
  missingElementError: "ERROR: at least one search element (id, name, names, owner, product, representative) is required.",
  // ONE source of truth: the kernel seam values are DECLARED in the capability contract
  // (./capabilities.js) and consumed here — never re-stated as literals that can drift from it.
  // (pageSize 100 = doSearch limit max; pageGuard 60 × 100 = 6000 > the 5000 provider window, a
  // backstop and never the normal stop; ceilingDefault 600 is the perf lowering.)
  capabilities: { ...CAPABILITIES.kernel },
});

export async function doEnumerate(sessionKey, params, tctx) {
  return __enumerate(sessionKey, params, tctx);
}

// ── Count-only (Stage 0.5) ────────────────────────────────────────────────────────────────────────
// "How many records match?" and nothing else — no rows, no screening, no paging. The kernel's "cheap"
// seam: page 0 with limit:1 fields:["uri"], the smallest response this API gives, and totalHitCount
// read off it. ONE BILLABLE SEARCH per call (the per-run SEARCH_CACHE dedupes exact repeats and meters
// them cache_hit, so a repeated count within a run is free).
//
// Same seam the enumerate ceiling is tested on — it is literally the same kernel — so a count taken
// here and a count taken inside an enumeration can never disagree.
const __countHits = makeCountProbe({
  search: (sessionKey, params, tctx) => doSearch(sessionKey, params, tctx),
  capabilities: { countProbe: CAPABILITIES.kernel.countProbe },
});

/** @returns { ok, total, probe, reason } — `total` is a number ONLY when ok; never a zero on failure. */
export async function doCountHits(sessionKey, params, tctx) {
  if (!hasAnyElement(params)) return { ok: false, total: null, probe: "cheap", reason: "at least one search element (id, name, names, owner, product, representative) is required" };
  return __countHits(sessionKey, params, tctx);
}

const __executePlan = makeExecutePlan({
  search: (sessionKey, params, tctx) => doSearch(sessionKey, params, tctx),
  enumerate: (sessionKey, params, tctx) => __enumerate(sessionKey, params, tctx),
  // the declared contract, for declaration-driven refusals (owner×term) — never for query semantics
  capabilities: CAPABILITIES,
});

export async function doExecutePlan(sessionKey, params, tctx) {
  return __executePlan(sessionKey, params, tctx);
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// EUIPO register provider — the core over the three shared kernels.
//
// Until now EUIPO was a SIDE TOOL: a working client (euipo-client.js) attached credential-blind to
// every register-unit stage, with no capability contract, no ledger, no neutral tool names and no
// tests. It could not be planned against, could not defer a jurisdiction it does not cover, and could
// not disclose a predicate it cannot express — the whole mechanism that keeps a gap from reading as a
// clean negative. This file is the provider half; euipo-client.js keeps the OAuth token cache and the
// two direct-call tools it already served.
//
// The orchestration is NOT here. makeEnumerate / makeCountProbe / makeExecutePlan are the same code
// corsearch and clarivate run — paging, the ceiling, the count-first per-term and per-class rescues,
// the two-pass guard evaluation, the qid-ownership merge, the error:true stamp. Only the seams below
// are EUIPO-shaped, and every one of them was probed against the live sandbox (2.35M records) rather
// than read off the OpenAPI spec.
//
// ── THE FOUR THINGS THAT WOULD HAVE FAILED SILENTLY ───────────────────────────────────────────────
//
// 1. `and` BINDS TIGHTER THAN `or` in this RSQL dialect. Probed: `A or B and niceClasses=in=(9,42)`
//    returns 109; `(A or B) and niceClasses=in=(9,42)` returns 47. An unparenthesised name OR-stack
//    is therefore a DIFFERENT, WIDER query — and it answers HTTP 200 with plausible rows, so nothing
//    downstream can tell. Every OR group this file emits is parenthesised, and a test pins it.
//
// 2. `size` HAS A FLOOR OF 10. Below it every request 400s, whatever the query — which reads exactly
//    like "the query is unsupported". That mistake has now cost this provider two probe rounds. The
//    count probe's `cheapCountParams` is the trap: the kernel default is `{limit:1, fields:["uri"]}`,
//    which sets no `size` at all and names a `limit` this API does not have.
//
// 3. `logRecordBody` IS NOT OPTIONAL. The citation-fidelity gate finds records by reading the BODY
//    ledger (registry-fidelity.mjs collectRecordBodies). A provider that logs only the call leaves
//    the gate nothing to compare, so it does not fail — it stamps the finding `unverified` and
//    appends "presented unverified". Every EU card would carry it, permanently, and no test or exit
//    code would say why.
//
// 4. `pageParams` is overridden to `{size, page}` — the kernel default emits `{limit, page}` and this
//    API has no `limit`. Stated precisely, because the BREAK MATRIX corrected an earlier draft of
//    this very note: the override is DEFENSIVE here, not load-bearing. `doSearch` derives its own
//    `size` through `clampSize` and forwards only {query,size,page,sort}, so a stray `limit` never
//    reaches the wire and the band still pages correctly without the override. What the override
//    buys is that ONE number decides the page size; reverting it leaves the kernel's `pageSize` and
//    `clampSize`'s fallback as two independent defaults that merely happen to agree today, which is
//    why `SIZE_FALLBACK_AGREES` below pins them together.
//    (On the local US index the same seam IS load-bearing — there `doSearch` had no independent
//    clamp, and the kernel default silently re-returned page 0 forever.)

import { makeLedger } from "../../_shared/ledger.mjs";
import { nonAnswerBodyError, parseJsonBody, unparsedBodyError } from "../../_shared/http-body.mjs";
import { makeEnumerate } from "../../_shared/enumerate.mjs";
import { makeCountProbe } from "../../_shared/count.mjs";
import { CAPABILITY_GAP_MARKER, makeExecutePlan, planPredicateParams } from "../../_shared/execute-plan.mjs";

import CAPABILITIES from "./capabilities.js";
import { ENV, getAccessToken } from "./euipo-client.js";
import {
  EUIPO_STATUS_LIVE_QUERYABLE, EUIPO_STATUS_QUERYABLE,
  makeRef, publicRecordUrl, refToId, rowScreen, toBandRow, toNeutralRecord,
} from "./row.js";

export { CAPABILITIES, makeRef };
export const ENUMERATE_NAMES_CHUNK_DEFAULT = CAPABILITIES.kernel.namesChunkDefault;

// One ledger per provider, same files and same row schema as the other three, with `provider:"euipo"`
// as the discriminator. Without it this source's calls are invisible to the provider-usage diff and a
// run reads as having made no EU register calls at all — which is precisely the silent hole exists
// to close. See point 3 in the header for why logRecordBody is separately load-bearing.
export const { logCall, logRecordBody, tctxOf } = makeLedger("euipo");

export const CRED_ENV = "EUIPO_CLIENT_ID";

// The API's own floor and ceiling on `size`. 10 is not a tuning choice — below it, every request 400s.
export const PAGE_SIZE_MIN = 10;
export const PAGE_SIZE_MAX = 100;

const VERBAL = "wordMarkSpecification.verbalElement";
const APPLICANT = "applicants.name";

// ── config ────────────────────────────────────────────────────────────────────────────────────────
/**
 * Resolve the credential set. Fails LOUDLY and by name rather than returning an empty register: an
 * unset credential must refuse before model spend, never run short and disclose afterwards.
 */
export function resolveConfig(auth) {
  const cfg = (auth && typeof auth === "object") ? auth : {};
  const clientId = cfg.clientId || process.env.EUIPO_CLIENT_ID || "";
  const clientSecret = cfg.clientSecret || process.env.EUIPO_CLIENT_SECRET || "";
  // item 2 (ADR-0001) — NO DEFAULT. Sandbox and production are separate deployments holding
  // different corpora: the sandbox is a frozen historical snapshot plus synthetic rows, and the newest
  // marks in it are labelled "EUTM Generated by QC Automated Script". A clearance run against it reports
  // on marks that are not in the register.
  //
  // This used to default to "sandbox", so a hand-written .env, a container spec or a systemd unit that
  // omitted the variable searched the wrong corpus and said nothing. `npm run setup` always writes
  // `production`, which is why the wizard population never saw it — and why the exposed population is
  // exactly the one that configures by hand.
  //
  // Refusing rather than defaulting to production is this file's own posture, stated four lines up: an
  // unset credential "must refuse before model spend, never run short and disclose afterwards". Sandbox
  // is a legitimate choice, so the fix cannot be to pick production for the operator either — both
  // intentions have to be stated, and neither is guessable from an absence.
  const environment = cfg.environment || process.env.EUIPO_ENVIRONMENT || "";
  if (!clientId || !clientSecret) {
    throw new Error(
      `[euipo] no credentials. Set ${CRED_ENV} and EUIPO_CLIENT_SECRET. This provider searches the EU `
      + "register over an authenticated API; without them there is nothing to search, and a run must "
      + "refuse rather than report an empty EU register.",
    );
  }
  if (!environment) {
    throw new Error(
      "[euipo] EUIPO_ENVIRONMENT is not set, and there is NO default. It selects which EU corpus this "
      + "run searches, and the two are not interchangeable: `production` is the register; `sandbox` is a "
      + "frozen snapshot plus synthetic rows, so a clearance against it reports on marks that do not "
      + "exist. Set EUIPO_ENVIRONMENT=production for a real clearance, or =sandbox deliberately for a "
      + "test. This refuses rather than choosing for you (#1149 item 2, ADR-0001).",
    );
  }
  if (!ENV[environment]) {
    throw new Error(`[euipo] EUIPO_ENVIRONMENT="${environment}" is not one of: ${Object.keys(ENV).join(", ")}. `
      + "sandbox and production are SEPARATE DEPLOYMENTS holding different corpora — guessing one is not an option.");
  }
  return { clientId, clientSecret, environment };
}

// ── RSQL assembly ─────────────────────────────────────────────────────────────────────────────────

/** RSQL value: always double-quoted, with `"` and `\` escaped. Quoting is always safe; the grammar
 *  REQUIRES it for any value containing a space, which mark text routinely does. */
const q = (v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`;

// The plan speaks `match_mode`; this API speaks wildcard placement inside the quoted value. The map is
// exhaustive BY OMISSION: `phonetic` is deliberately absent, and adding it — to anything — is the
// defect this whole layer exists to prevent. EUIPO has no sound-alike surface (`=phonetic=`, `=fuzzy=`
// and RSQL's own `~=` all 400 at a valid size), so a phonetic slice must be REFUSED and disclosed as a
// deferred coverage row. Mapping it to a contains would run a different search under the right name
// and return `state:"enumerated"` over it — doctrine rule 2's exact failure.
const MATCH_MODE_TO_PREDICATE = Object.freeze({
  exact: "exact",
  default: "wildcardInfix",
  contains: "wildcardInfix",
  starts_with: "wildcardPrefix",
  ends_with: "wildcardSuffix",
});

const capabilityGap = (msg) => { throw new Error(`${CAPABILITY_GAP_MARKER} ${msg}`); };

export function resolvePredicate(params) {
  const mode = String(params?.match_mode ?? "default") || "default";
  const predicate = MATCH_MODE_TO_PREDICATE[mode];
  if (!predicate) {
    capabilityGap(
      `EUIPO cannot serve match_mode "${mode}". Its query language has no such operator `
      + `(supported: ${Object.keys(MATCH_MODE_TO_PREDICATE).join(", ")}). The slice is NOT executed and NOT `
      + "re-run: a weaker query under this name would be a different search reported as this one.",
    );
  }
  if (CAPABILITIES.predicates[predicate] == null) {
    capabilityGap(`EUIPO declares predicate "${predicate}" unavailable (capabilities.predicates.${predicate} === null).`);
  }
  return predicate;
}

/**
 * Render one term under one predicate.
 *
 * A term arrives carrying its own anchors when the plan's `wildcard` predicate had several terms —
 * `planPredicateParams` de-anchors `e.term` into `__term`, but `defaultBuildEntryQuery` only applies
 * that to the single-`name` shape, never to `names[]`. So the anchors have to be stripped here or the
 * value becomes `**TERM**`.
 *
 * A wildcard SURVIVING inside the term is not stripped, and that is EUIPO-specific and correct: `*` is
 * native inside the quoted value here, so `NI*E` is a legitimate, evidenced query. (On the local US
 * index the same pattern had to be refused — SQLite would have searched for a literal asterisk.)
 */
export function renderTerm(term, predicate) {
  let t = String(term ?? "").trim();
  if (!t) capabilityGap("an empty search term reached the EUIPO query builder — refused rather than sent as a match-anything wildcard");
  const lead = t.startsWith("*"), trail = t.endsWith("*");
  if (predicate === "exact") {
    if (lead || trail) {
      capabilityGap(`the term ${JSON.stringify(t)} is anchored with "*" but the predicate is `
        + "`exact` — an anchored term under an exact match is a PLAN DEFECT, and stripping the anchors "
        + "here would silently answer a question nobody asked.");
    }
    return q(t);
  }
  if (lead) t = t.slice(1);
  if (trail) t = t.slice(0, -1);
  if (!t) capabilityGap(`the term ${JSON.stringify(String(term))} is nothing but wildcards — refused rather than sent as a whole-register sweep`);
  if (predicate === "wildcardPrefix") return q(`${t}*`);
  if (predicate === "wildcardSuffix") return q(`*${t}`);
  return q(`*${t}*`);                       // wildcardInfix / the contains default
}

const namesOf = (p) => {
  const xs = Array.isArray(p?.names) ? p.names : (p?.name != null ? [p.name] : []);
  return xs.map((x) => String(x ?? "").trim()).filter(Boolean);
};
const ownersOf = (p) => {
  const xs = Array.isArray(p?.owners) ? p.owners : (p?.owner != null ? [p.owner] : []);
  return xs.map((x) => String(x ?? "").trim()).filter(Boolean);
};

/**
 * An OR group over one field. ALWAYS PARENTHESISED, even at width 1.
 *
 * The parentheses are the whole point (header, point 1): `and` binds tighter than `or` here, so
 * `A or B and C` means `A or (B and C)` — a wider query that answers 200. Width 1 is parenthesised too,
 * deliberately: an `if (n === 1) return bare` shortcut is exactly the kind of correct-today special
 * case that stops being correct the moment someone concatenates two builders' output.
 */
function orGroup(field, terms, render) {
  return `(${terms.map((t) => `${field}==${render(t)}`).join(" or ")})`;
}

/**
 * Build the RSQL for one query. Clauses AND-join; each multi-value clause is a parenthesised OR group.
 *
 * `regions` is validated rather than dropped: this provider covers EU only, and a region it does not
 * hold must become a disclosed gap, never a filter quietly discarded so the search runs worldwide.
 */
export function buildRsql(params) {
  // ESCAPE HATCH — returns BEFORE the coverage check below, so a hand-written expression can search
  // outside this provider's declared coverage with no gap disclosed. Not reachable today: neither the
  // MCP tool surface nor the driver adapters accept `rsql`, and the kernels never construct one. If
  // anyone wires it to a caller, move this line below the regions check first.
  if (params?.rsql) return String(params.rsql);
  const clauses = [];

  const regions = (Array.isArray(params?.regions) ? params.regions : []).map((r) => String(r ?? "").trim()).filter(Boolean);
  if (regions.length) {
    const untranslatable = regions.filter((r) => CAPABILITIES.offices.translate(r) == null);
    if (untranslatable.length) {
      capabilityGap(
        `EUIPO holds the EU register only. Territories [${untranslatable.join(", ")}] are not covered by this `
        + "source and a search here would answer about a DIFFERENT territory than the one asked about. "
        + "Deferred and disclosed, never filtered away silently.",
      );
    }
  }

  const names = namesOf(params);
  if (names.length) {
    const predicate = resolvePredicate(params);
    clauses.push(orGroup(VERBAL, names, (t) => renderTerm(t, predicate)));
  }

  // The owner field is its own predicate and never inherits the mark-text one: `applicants.name` is a
  // name string the office recorded, and an `exact` match against a client's spelling of a company
  // would answer 0 with no error. The declared owner predicate is a contains, and it stays one.
  const owners = ownersOf(params);
  if (owners.length) clauses.push(orGroup(APPLICANT, owners, (t) => q(`*${String(t).replace(/^\*+|\*+$/g, "")}*`)));

  const classes = [...new Set((Array.isArray(params?.nice_classes) ? params.nice_classes : [])
    .map(Number).filter((n) => Number.isFinite(n) && n >= 1 && n <= 45))];
  if (classes.length) {
    clauses.push(params?.nice_classes_mode === "all"
      ? `niceClasses=all=(${classes.join(",")})`
      : `niceClasses=in=(${classes.join(",")})`);
  }

  // Two of the spec's eighteen status tokens are REJECTED by the API (APPEALABLE, ACCEPTANCE_PENDING —
  // probed one at a time). Sending one 400s the whole query, so an unqueryable token is dropped from
  // the FILTER and named on the result. Dropping it is safe in the recall direction — the filter is
  // narrower than asked, so the search returns MORE than requested, never less — and the classifier
  // still recognises the token when it comes back on a row.
  const statuses = (Array.isArray(params?.status) ? params.status : []).map((s) => String(s ?? "").trim().toUpperCase()).filter(Boolean);
  const queryable = statuses.filter((s) => EUIPO_STATUS_QUERYABLE.includes(s));
  if (queryable.length) {
    clauses.push(queryable.length === 1 ? `status==${q(queryable[0])}` : `status=in=(${queryable.join(",")})`);
  }

  const features = (Array.isArray(params?.mark_feature) ? params.mark_feature : []).map((s) => String(s ?? "").trim()).filter(Boolean);
  if (features.length) {
    clauses.push(features.length === 1 ? `markFeature==${q(features[0])}` : `markFeature=in=(${features.join(",")})`);
  }

  if (params?.application_number) clauses.push(`applicationNumber==${q(params.application_number)}`);
  if (params?.application_date_from) clauses.push(`applicationDate>=${params.application_date_from}`);
  if (params?.application_date_to) clauses.push(`applicationDate<=${params.application_date_to}`);
  if (params?.registration_date_from) clauses.push(`registrationDate>=${params.registration_date_from}`);
  if (params?.registration_date_to) clauses.push(`registrationDate<=${params.registration_date_to}`);

  return clauses.join(" and ");
}

export function hasAnyElement(params) {
  // Deliberately does NOT route through buildRsql: the builder throws capability gaps, and the kernel
  // calls this as a plain predicate before any error handling exists. A throw here would abort the
  // stage instead of producing a disclosed refusal.
  return Boolean(
    params?.rsql || namesOf(params).length || ownersOf(params).length || params?.application_number
    || (Array.isArray(params?.nice_classes) && params.nice_classes.length)
    || (Array.isArray(params?.status) && params.status.length)
    || (Array.isArray(params?.mark_feature) && params.mark_feature.length),
  );
}

export const MISSING_ELEMENT_ERROR =
  "ERROR: euipo — at least one search element (name, names, owner, owners, application_number, "
  + "nice_classes, status, mark_feature) is required. A query with no elements would sweep the whole "
  + "register, which is never what was asked.";

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────

// The fallback is the contract's own page size, NOT an independent literal. Pinned by a test
// (`SIZE_FALLBACK_AGREES`) because the two are only safe while they are the same number: `doSearch`
// owns the wire `size`, so if the kernel's pageSize ever moved on its own, the kernel would page in
// steps of one size while the API returned another — and every page would silently overlap or skip.
export const SIZE_FALLBACK_AGREES = CAPABILITIES.kernel.pageSize;
const clampSize = (n) => Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Number(n) || SIZE_FALLBACK_AGREES));

async function euipoGet(cfg, path, query, { tctx = null, retries = 1 } = {}) {
  const { api } = ENV[cfg.environment];
  const url = new URL(`${api}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== "") url.searchParams.set(k, String(v));

  // BOTH headers are required — the Bearer token AND X-IBM-Client-Id (an IBM API Connect gateway sits
  // in front, and the spec declares two security schemes). Sending only the token 401s every call.
  const headers = (tok) => ({ Authorization: `Bearer ${tok}`, "X-IBM-Client-Id": cfg.clientId, Accept: "application/json" });

  const t0 = Date.now();
  let attempts = 0, resp;
  try {
    let token = await getAccessToken(cfg);
    for (let i = 0; i <= retries; i++) {
      attempts = i + 1;
      resp = await fetch(url, { headers: headers(token) });
      if (resp.status === 401 && i < retries) { token = await getAccessToken(cfg, { force: true }); continue; }
      if (resp.ok || resp.status < 500 || i === retries) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  } catch (err) {
    logCall(tctx, { http_status: 0, ok: false, attempts, took_ms: Date.now() - t0, bytes: 0, cache_hit: false });
    throw err;
  }
  const raw = await resp.text();
  const { body, parseError } = parseJsonBody(raw);
  // The ledger row carries the GATEWAY tool-call context, never the token and never the client id.
  logCall(tctx, { http_status: resp.status, ok: resp.ok, attempts, took_ms: Date.now() - t0, bytes: raw.length, cache_hit: false });
  return { status: resp.status, ok: resp.ok, url: url.toString(), body, raw, parseError, retryAfter: resp.headers.get("retry-after") };
}

function errorText(tool, r, extra = "") {
  const detail = r.body?.detail || r.body?.title || (r.raw ? r.raw.slice(0, 200) : "");
  let hint = "";
  if (r.status === 403) hint = "  → subscribe the app to the Trade mark search API plan in the EUIPO dev portal.";
  else if (r.status === 429) hint = `  → rate limited; retry after ${r.retryAfter || "?"}s.`;
  else if (r.status === 401) hint = "  → token rejected; check EUIPO_CLIENT_ID / EUIPO_CLIENT_SECRET / EUIPO_ENVIRONMENT.";
  else if (r.status === 400) hint = "  → malformed RSQL, an unqueryable enum value, or `size` outside 10..100 (below 10 EVERY request 400s, whatever the query).";
  return `ERROR: ${tool} HTTP ${r.status}: ${detail}${hint}${extra}`;
}

/** Did the provider ANSWER — not "did the bytes parse". The search answer shape carries totalElements
 *  and trademarks[]; an RFC-7807 problem served with a 200 parses fine and used to ride out as an
 *  empty register page, which a model reads as "nothing is registered". */
export function isSearchResponseBody(body) {
  return body != null && typeof body === "object"
    && (Array.isArray(body.trademarks) || Number.isInteger(body.totalElements));
}

// ── Search ────────────────────────────────────────────────────────────────────────────────────────

export async function doSearch(auth, params, tctx) {
  let cfg, rsql;
  try {
    cfg = resolveConfig(auth);
    if (!hasAnyElement(params)) return { type: "text", text: MISSING_ELEMENT_ERROR };
    rsql = buildRsql(params);
  } catch (e) {
    // A capability gap is a CLIENT-SIDE refusal: nothing was sent, so nothing a retry could change.
    // The marker is what turns error:true into error+deferred, so the repair ladder does not grind
    // against a deterministic answer.
    return { type: "text", text: `ERROR: euipo_search — ${e.message}` };
  }
  if (!rsql) return { type: "text", text: MISSING_ELEMENT_ERROR };

  const size = clampSize(params?.size);
  const page = Math.max(0, Number(params?.page) || 0);
  const r = await euipoGet(cfg, "/trademarks", { query: rsql, size, page, sort: params?.sort },
    { tctx: { ...tctx, target: (namesOf(params)[0] ?? ownersOf(params)[0] ?? "").slice(0, 120) } });

  if (!r.ok) return { type: "text", text: errorText("euipo_search", r, `\nRSQL: ${rsql}`) };
  if (r.parseError) return { type: "text", text: unparsedBodyError("euipo_search", r, `\nRSQL: ${rsql}`) };
  if (!isSearchResponseBody(r.body)) {
    return { type: "text", text: nonAnswerBodyError("euipo_search", r, "a search response (no trademarks[] and no totalElements)", `\nRSQL: ${rsql}`) };
  }

  const b = r.body;
  const rows = Array.isArray(b.trademarks) ? b.trademarks.map(toBandRow) : [];
  return { type: "text", text: JSON.stringify({
    //: WHICH deployment answered. sandbox and production are separate systems holding different
    // corpora, and downstream must never mistake one for the other.
    environment: cfg.environment,
    query_rsql: rsql,
    page: b.page ?? page,
    size: b.size ?? size,
    // NULL, never 0, when the body carried no integer — the count kernel's one rule. A missing total
    // is UNKNOWN; "we could not ask" and "we asked and there are none" are different facts.
    total_hits: Number.isInteger(b.totalElements) ? b.totalElements : null,
    total_pages: Number.isInteger(b.totalPages) ? b.totalPages : null,
    has_more: Number.isInteger(b.totalPages) ? (b.page ?? page) + 1 < b.totalPages : rows.length >= size,
    results: rows,
  }, null, 2) };
}

// ── Record fetch ──────────────────────────────────────────────────────────────────────────────────

export async function doRecordFetch(auth, params, tctx) {
  const ref = params?.record_id ?? params?.application_number ?? params?.id;
  if (!ref) return { type: "text", text: "ERROR: euipo_record_fetch — record_id (a /mark/eu/<applicationNumber> ref) or application_number is required." };
  let cfg;
  try { cfg = resolveConfig(auth); }
  catch (e) { return { type: "text", text: `ERROR: euipo_record_fetch — ${e.message}` }; }

  const id = refToId(ref);
  const r = await euipoGet(cfg, `/trademarks/${encodeURIComponent(id)}`, params?.language ? { language: params.language } : null,
    { tctx: { ...tctx, target: id } });
  if (!r.ok) return { type: "text", text: errorText("euipo_record_fetch", r, ` application_number=${id}`) };
  // An unparsed body normalized into an all-null record and PERSISTED under a real record id, which
  // the citation-fidelity gate then reads as a record carrying no facts.
  if (r.parseError) return { type: "text", text: unparsedBodyError("euipo_record_fetch", r, ` application_number=${id}`) };
  if (!r.body || typeof r.body !== "object" || !r.body.applicationNumber) {
    return { type: "text", text: nonAnswerBodyError("euipo_record_fetch", r, "a trademark record (no applicationNumber)", ` application_number=${id}`) };
  }

  const nr = toNeutralRecord(r.body, { fromDetail: true });
  // THE BODY, not just the call. See header point 3.
  if (nr.uri) logRecordBody({ ...tctx, kind: "record_fetch" }, nr.uri, nr);
  return { type: "text", text: JSON.stringify(nr, null, 2) };
}

// ── Batch screen ──────────────────────────────────────────────────────────────────────────────────
//
// PROBED, and it is the reason this tool is mounted at all: `applicationNumber=in=(a,b,c,…)` resolves
// a whole candidate list in ONE search call, and the search row already carries status, niceClasses
// and applicants. So screening is one metered call per chunk, not one per record.
//
// THE BODIES ARE NOT LOGGED HERE, and that is the opposite of what the local US index does. There,
// the whole record had already been read off disk, so persisting it was free and made every band
// record citable. Here a SEARCH ROW is a partial record — no goods and services, no proceedings, no
// status date. Writing it to the BODY ledger would hand the citation-fidelity gate a record whose
// absent fields are indistinguishable from fields the register does not hold, and the gate would
// then verify a finding against a record that never claimed to be complete. Screening is screening;
// citation needs `register_record_fetch`.
export async function doBatchScreen(auth, params, tctx) {
  let cfg;
  try { cfg = resolveConfig(auth); }
  catch (e) { return { type: "text", text: `ERROR: euipo_batch_screen — ${e.message}` }; }

  const ids = (Array.isArray(params?.uris) ? params.uris : [])
    .map((u) => refToId(u)).map((s) => String(s ?? "").trim()).filter(Boolean);
  if (!ids.length) return { type: "text", text: "ERROR: euipo_batch_screen — uris[] is required (refs /mark/eu/<n> or bare application numbers)." };

  const inScope = (Array.isArray(params?.in_scope_classes) ? params.in_scope_classes : []).map(Number).filter(Number.isFinite);
  const width = CAPABILITIES.maxOrWidth;
  const rows = [];
  const missing = new Set(ids);
  for (let i = 0; i < ids.length; i += width) {
    const chunk = ids.slice(i, i + width);
    const r = await euipoGet(cfg, "/trademarks",
      { query: `applicationNumber=in=(${chunk.join(",")})`, size: clampSize(Math.max(PAGE_SIZE_MIN, chunk.length)), page: 0 },
      { tctx: { ...tctx, target: `${chunk.length} ids` } });
    if (!r.ok) return { type: "text", text: errorText("euipo_batch_screen", r, ` chunk=${i / width}`) };
    if (r.parseError) return { type: "text", text: unparsedBodyError("euipo_batch_screen", r, ` chunk=${i / width}`) };
    if (!isSearchResponseBody(r.body)) {
      return { type: "text", text: nonAnswerBodyError("euipo_batch_screen", r, "a search response", ` chunk=${i / width}`) };
    }
    for (const t of (r.body.trademarks ?? [])) {
      rows.push(rowScreen(t, inScope));
      missing.delete(t.applicationNumber);
    }
  }
  // An id the register did not return is a FINDING, not a silent omission: it is either a bad ref or a
  // record that has left the register. Naming it stops a caller reading a short list as a full screen.
  return { type: "text", text: JSON.stringify({
    asked: ids.length, screened: rows.length,
    not_found: [...missing],
    not_found_note: missing.size
      ? "these application numbers returned nothing. That is NOT a screening verdict — it is an unanswered id. Fetch each with register_record_fetch before treating any of them as absent."
      : null,
    rows,
  }, null, 2) };
}

// ── Image ─────────────────────────────────────────────────────────────────────────────────────────
//
// PROBED: `GET /trademarks/{n}/image` answers 200 with real bytes (image/tif, image/jpeg). The DETAIL
// record's `markImage` carries `{imageFormat, viennaClasses}` — format and figurative-element codes,
// but no bytes and no URL.
//
// This returns METADATA + URLS, never the bytes, matching the shape corsearch's image tool returns.
// Two urls, deliberately, because they are not interchangeable: `url` is the authenticated API
// endpoint (useless to a human reader without credentials) and `public_page` is the eSearch address a
// reader can actually open. Handing back only the first would produce citations nobody can follow.
//
// `vienna_classes` is the genuinely useful half for clearance — the figurative elements are how a
// device mark is compared — and it is the reason this is worth a call at all.
export async function doImageFetch(auth, params, tctx) {
  const ref = params?.record_id ?? params?.application_number ?? params?.image_path;
  if (!ref) return { type: "text", text: "ERROR: euipo_image_fetch — record_id (a /mark/eu/<applicationNumber> ref) or application_number is required." };
  let cfg;
  try { cfg = resolveConfig(auth); }
  catch (e) { return { type: "text", text: `ERROR: euipo_image_fetch — ${e.message}` }; }

  const id = refToId(ref);
  const r = await euipoGet(cfg, `/trademarks/${encodeURIComponent(id)}`, null, { tctx: { ...tctx, target: id } });
  if (!r.ok) return { type: "text", text: errorText("euipo_image_fetch", r, ` application_number=${id}`) };
  if (r.parseError) return { type: "text", text: unparsedBodyError("euipo_image_fetch", r, ` application_number=${id}`) };

  const mi = r.body?.markImage;
  const feature = r.body?.markFeature ?? null;
  if (!mi) {
    // A WORD mark has no image, and that is a real answer rather than a failure. Said plainly so the
    // absence is never read as a fetch that went wrong.
    return { type: "text", text: JSON.stringify({
      application_number: id, mark_feature: feature, has_image: false,
      reason: feature === "WORD"
        ? "this is a WORD mark — there is no figurative image to fetch, which is an answer and not an error"
        : "the register holds no markImage for this record",
      public_page: publicRecordUrl(id),
    }, null, 2) };
  }
  const { api } = ENV[cfg.environment];
  return { type: "text", text: JSON.stringify({
    application_number: id,
    mark_feature: feature,
    has_image: true,
    image_format: mi.imageFormat ?? null,
    // The figurative-element codes. THE reason to call this tool: a device mark is compared on its
    // Vienna classes, not on a filename.
    vienna_classes: Array.isArray(mi.viennaClasses) ? mi.viennaClasses : [],
    url: `${api}/trademarks/${encodeURIComponent(id)}/image`,
    url_note: "authenticated endpoint — it needs the same Bearer token and X-IBM-Client-Id as every other call, so it is NOT a citable address for a reader.",
    public_page: publicRecordUrl(id),
    size_bytes: null,
    size_note: "not fetched. The bytes are not needed to compare marks and downloading them per candidate would be a real cost against the daily allowance; the Vienna classes above are the comparable data.",
  }, null, 2) };
}

// ── the kernels ───────────────────────────────────────────────────────────────────────────────────

// makeEnumerate returns { enumerate, … } — an object, unlike the other two kernels which return the
// callable directly.
const { enumerate: enumerateKernel } = makeEnumerate({
  search: doSearch,
  rowScreen,                                  // REQUIRED: screenSource is "search-row"
  hasAnyElement,                              // the kernel default is () => true, which would sweep the register
  missingElementError: MISSING_ELEMENT_ERROR,
  capabilities: { ...CAPABILITIES.kernel },   // spread from the contract, never re-typed as literals
  // Header point 4. `{limit, page}` would send an unknown `limit`, leave `size` at the server default,
  // and still page — a well-formed short band that looks entirely normal.
  pageParams: (page, pageSize) => ({ size: clampSize(pageSize), page }),
  // Header point 2, stated exactly. The kernel default is `{limit:1, fields:["uri"]}` — two knobs this
  // API does not have. Dropping this override is not a CORRECTNESS bug (clampSize would fall back to
  // 100 and the count would still be right); it is a 10× COST bug, because every count-first probe
  // then drags a hundred full records back to read one integer off the envelope. The count-first
  // rescue fires per term AND per class, so that multiplies. `size:1` is not an option — below 10
  // every request 400s.
  cheapCountParams: { size: PAGE_SIZE_MIN, page: 0 },
  namesKey: "names",
  recordIdOf: (rec) => rec?.record_id,
  recordKeyOf: (rec) => rec?.record_id ?? rec?.uri,
  screenJoinKey: (row) => row?.record_id,
});

export const doEnumerate = (auth, params, tctx) => enumerateKernel(auth, params, tctx);

// "cheap": totalElements rides page 0 of an ordinary search — one metered call, smallest legal
// response. The SAME kernel the enumerate ceiling is tested with, so a count taken directly and a
// count taken inside an enumeration can never disagree.
const countKernel = makeCountProbe({
  search: doSearch,
  capabilities: { countProbe: CAPABILITIES.kernel.countProbe },
  cheapCountParams: { size: PAGE_SIZE_MIN, page: 0 },
});

/** @returns { ok, total, probe, reason } — `total` is a number ONLY when ok. Never a zero on failure. */
export async function doCountHits(auth, params, tctx) {
  if (!hasAnyElement(params)) return { ok: false, total: null, probe: "cheap", reason: MISSING_ELEMENT_ERROR };
  return countKernel(auth, params, tctx);
}

const executePlanKernel = makeExecutePlan({
  search: doSearch,
  enumerate: doEnumerate,
  predicateParams: planPredicateParams,
  // The FULL contract, not the kernel block: the script-form and owner×term refusals read it, and an
  // ABSENT contract defers rather than sweeping — the safe direction.
  capabilities: CAPABILITIES,
});

export const doExecutePlan = (auth, params, tctx) => executePlanKernel(auth, params, tctx);

/** The live-status filter that can actually ride the wire — 10 of the 12 LIVE tokens; two of the
 *  spec's eighteen are rejected by the API. `countStatusFilter: "live"` means THIS list. */
export const LIVE_STATUS_FILTER = EUIPO_STATUS_LIVE_QUERYABLE;

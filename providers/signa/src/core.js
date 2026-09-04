// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Clearotron Signa plugin — pure logic + HTTP helpers + telemetry, ZERO plugin-SDK / typebox imports
// (node built-ins + global fetch only). Testable core: index.js imports from here and adds the SDK
// tool-factory registration + TypeBox schemas.
//
// PACKAGING NOTE (shared-kernel extraction): this core imports the shared ledger from
// ../../_shared/ — a sibling of src/, NOT inside it. Any packaging step that copies only src/ → dist/
// must be widened to carry providers/_shared/ alongside it.
//
// PROVIDER-ABSTRACTION CONTRACT (one register provider active at a time — never both), identical to
// the corsearch/clarivate cores:
//   - search rows + record_fetch carry a synthetic Corsearch-shaped record_id `/mark/<office>/<id>`
//     (office = the record's ISO jurisdiction_code) so the driver's URI machinery (pipeline
//     CITED_URI_RE, screen-gate URI_RE, registry-fidelity artifact round-trip) works UNCHANGED. NB:
//     Signa ids contain underscores (tm_…), so the driver's citation regex is loosened to allow `_`.
//   - record_fetch persists a NORMALIZED record body under that id, using the neutral field names
//     registry-fidelity reads (applicationNumber / registrationNumber / applicationDate /
//     registrationDate + a neutral statusClass) so the citation-fidelity gate is provider-blind.
//   - the per-call ledger uses the SAME schema + SAME files the corsearch plugin and driver use, with a
//     `provider:"signa"` discriminator.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeLedger } from "../../_shared/ledger.mjs";
import { nonAnswerBodyError, parseJsonBody, unparsedBodyError } from "../../_shared/http-body.mjs";
import { makeEnumerate, isOwnerScoped } from "../../_shared/enumerate.mjs";
import { makeExecutePlan } from "../../_shared/execute-plan.mjs";
import CAPABILITIES, { SIGNA_OFFICE_KEYS, OWNER_SCOPED_WINDOW } from "./capabilities.js";
import { SIGNA_OFFICE_SNAPSHOT } from "./offices.generated.js";

export const DEFAULT_BASE = "https://api.signa.so";

// The vendor's authoritative office set (`GET /v1/offices`). Documented here so the skill /
// coverage layer can disclose a `coverage-limited` row for any matter office NOT in this set.
// DERIVED FROM THE COMMITTED SNAPSHOT, like capabilities.js and from the same file.
//
// These two maps used to be typed out twice, on the stated ground that duplication kept capabilities.js
// dependency-free — and added an agreement test because that only holds while they are identical.
// Both now derive from offices.generated.js, so they are identical BY CONSTRUCTION rather than by a
// test catching the day they stopped being. The agreement test stays as the regression guard for
// anyone who reintroduces a literal.
export const SIGNA_OFFICES = Object.freeze(Object.fromEntries(
  SIGNA_OFFICE_SNAPSHOT.offices
    .filter((o) => o.status === "live")
    .map((o) => [o.key, o.jurisdiction]),
));

// ── Telemetry: shared register ledger (providers/_shared/ledger.mjs) ──────────────────────────────
// ONE implementation, shared with the corsearch and clarivate cores: same files (CLEAROTRON_REGISTER_CALL_LOG
// / CLEAROTRON_REGISTER_RECORD_LOG — the wire contract with the driver's ledger readers), same row schema, with
// `provider:"signa"` as the discriminator. The ids logged are the GATEWAY tool-call context, never the
// Bearer token.
export const { logCall, logRecordBody, tctxOf } = makeLedger("signa");

// ── Synthetic record-id (ref) grammar ─────────────────────────────────────────────────────────────
// `/mark/<office>/<id>` — office is the record's ISO jurisdiction_code (e.g. us/eu/ch/wo), NEVER derived
// from the id. Signa ids look like `tm_019d1db7-…` (underscores → the driver citation regex allows `_`).
export function makeRef(office, id) {
  return `/mark/${String(office || "xx").toLowerCase()}/${id}`;
}
const REF_RE = /^\/mark\/([a-z]{2,4})\/(.+)$/i;
export function refToId(ref) {
  const m = REF_RE.exec(String(ref ?? "").trim());
  return m ? m[2] : String(ref ?? "").trim();
}
export function refToOffice(ref) {
  const m = REF_RE.exec(String(ref ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

// ── HTTP helper (Bearer auth + the metered chokepoint) ─────────────────────────────────────────────
export async function signaFetch(apiKey, base, path, { method = "GET", body = null, retries = 1, tctx = null } = {}) {
  const url = `${base}${path}`;
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  const init = { method, headers };
  if (body !== null) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }

  const t0 = Date.now();
  let attempts = 0, resp;
  try {
    for (let i = 0; i <= retries; i++) {
      attempts = i + 1;
      resp = await fetch(url, init);
      if (resp.ok || resp.status < 500 || i === retries) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  } catch (err) {
    logCall(tctx, { http_status: 0, ok: false, attempts, took_ms: Date.now() - t0, bytes: 0, cache_hit: false });
    throw err;
  }
  const raw = await resp.text();
  // The parse failure travels on `parseError` instead of being swallowed — providers/_shared/http-body.mjs.
  const { body: parsed, parseError } = parseJsonBody(raw);
  logCall(tctx, { http_status: resp.status, ok: resp.ok, attempts, took_ms: Date.now() - t0, bytes: raw.length, cache_hit: false });
  return { status: resp.status, ok: resp.ok, url, body: parsed, raw, parseError };
}

// ── Search-request assembly ────────────────────────────────────────────────────────────────────────
// THE TWO MATCH SHAPES ARE MUTUALLY EXCLUSIVE, and the live specification is explicit:
// "Deterministic modes require a query and disallow strategies/ranking_profile."
//
//   strategies[]  exact | phonetic | fuzzy | prefix              — ranked, several per call
//   match         similar | exact | starts_with | ends_with | contains — deterministic, one per call
//
// This matters for correctness and not only for reach: `planPredicateParams` emits
// `match_mode: "starts_with"` for a trailing-`*` wildcard entry, and with no deterministic shape to
// put it in, that entry fell through to a plain `exact` — a NARROWER query than the plan asked for,
// answering as though it were the one requested.
const DETERMINISTIC_MATCH = new Set(["similar", "exact", "starts_with", "ends_with", "contains"]);

// ── filters: ONE builder, because the two shapes drifting apart is how `status` survived ───────────
//
// `filters.status` was sent by both branches below and NO SUCH KEY EXISTS. The API rejects unknown
// filter keys outright — `HTTP 400 Unrecognized key: status` — so every status-filtered Signa search
// failed on the wire, and it survived review because the kernel does not pass one and no fixture
// carried one. The real names are `status_primary` (pending|active|inactive|unknown) and
// `status_stage`. `status_primary:["active"]` narrows 685 → 375; the bogus-key
// control 400s identically, which is what proves the rejection is about the NAME and not the value.
//
// Two branches building the same object by hand is what let one of them be wrong for two months, so
// there is now one function and both branches call it.
function buildFilters(p) {
  const f = {};
  if (Array.isArray(p.nice_classes) && p.nice_classes.length) f.nice_classes = p.nice_classes.map(Number).filter(Number.isFinite);
  if (Array.isArray(p.offices) && p.offices.length) f.offices = p.offices;
  if (Array.isArray(p.jurisdictions) && p.jurisdictions.length) f.jurisdictions = p.jurisdictions;
  if (Array.isArray(p.status) && p.status.length) f.status_primary = p.status;
  // — the owner surface this contract declared as absent for two months. `owner_name` composes
  // with a text query in ONE request, and the intersection is a real narrowing rather than one clause
  // being silently ignored — the three populations (term alone, owner alone, both) differ from each other.
  if (typeof p.owner === "string" && p.owner.trim()) f.owner_name = p.owner.trim();
  return f;
}

export function buildSearchRequest(p) {
  const body = { query: p.query };
  const match = typeof p.match === "string" ? p.match.trim() : "";
  if (match && DETERMINISTIC_MATCH.has(match)) {
    body.match = match;   // sending strategies alongside is a 4xx, not a preference
  } else {
    body.strategies = Array.isArray(p.strategies) && p.strategies.length ? p.strategies : ["exact"];
  }
  const filters = buildFilters(p);
  if (Object.keys(filters).length) body.filters = filters;
  if (Array.isArray(p.jurisdictions) && p.jurisdictions.length && p.territory_match) {
    // Governs `filters.jurisdictions` ONLY — it has no effect on `filters.offices`, which is always
    // literal. Sent verbatim rather than defaulted here: the vendor's own default is `protection`, and
    // silently inheriting it would make the layer a request carries depend on a vendor default nobody
    // in this repository declared. decides which one a plan asks for.
    body.territory_match = p.territory_match;
  }
  if (p.limit != null) body.limit = p.limit;
  if (p.cursor) body.cursor = p.cursor;
  // ── the total, and why it is asked for on EVERY call ────────────────────────────────────────────
  // `countProbe` is `"cheap"`, which means the shared kernel tests the enumerate ceiling off
  // the page-0 response and nothing else. Omit this flag and `pagination.total_count` is ABSENT — the
  // kernel then cannot test the ceiling and every band returns `incomplete`. So it is not an option
  // the caller may pass; it is a condition of the contract, set here where no call site can forget it.
  body.options = { ...(p.options && typeof p.options === "object" ? p.options : {}), include_total: true };
  return body;
}

// ── Record-field pickers + normalization ──────────────────────────────────────────────────────────
function toIso(s) {
  if (s == null) return null;
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10); // already ISO
  const d = str.replace(/\D/g, "");
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return str;
}
// Signa `status` is an object: { primary:"active"|…, stage:"registered"|…, raw_label, … }. primary is
// authoritative for live/dead; stage/raw_label are the fallback label. (Also tolerates a bare string.)
export function statusClassOf(rec) {
  const s = rec?.status;
  const DEAD = /invalid|abandon|cancel|expir|dead|terminat|refus|withdraw|lapsed|removed|void|inactive/;
  const LIVE = /regist|valid|live|pending|publish|renew|accept|active|filed|protect/;
  if (s && typeof s === "object") {
    const p = String(s.primary ?? "").toLowerCase();
    if (p === "active") return "live";
    if (p && DEAD.test(p)) return "dead";
    const lbl = `${s.stage ?? ""} ${s.raw_label ?? ""}`.toLowerCase();
    if (DEAD.test(lbl)) return "dead";
    if (LIVE.test(lbl)) return "live";
    return "unknown";
  }
  const lbl = String(s ?? "").toLowerCase();
  if (!lbl) return "unknown";
  if (DEAD.test(lbl)) return "dead";
  if (LIVE.test(lbl)) return "live";
  return "unknown";
}
export function pickStatusText(rec) {
  const s = rec?.status;
  if (s && typeof s === "object") return s.stage ?? s.raw_label ?? s.primary ?? null;
  return s ?? null;
}
export function normalizeClasses(rec) {
  const list = Array.isArray(rec?.classifications) ? rec.classifications : null;
  if (!list) return null;
  const out = [];
  for (const c of list) {
    const n = c?.nice_class ?? c?.class_number ?? c?.number;
    const parsed = parseInt(String(n), 10);
    if (!Number.isNaN(parsed)) out.push(parsed);
  }
  return out.length ? Array.from(new Set(out)).sort((a, b) => a - b) : null;
}

// Map a raw Signa record → the NEUTRAL normalized shape the driver + skill consume. officeHint = the
// office of the synthetic ref the caller cited (keeps cited==logged); record's jurisdiction_code is the
// fallback (Signa records carry an ISO jurisdiction_code directly, so no office map is needed).
export function normalizeRecord(rec, officeHint = null) {
  if (!rec || typeof rec !== "object") return rec;
  const office = officeHint || rec.jurisdiction_code || rec.office_code || "xx";
  const id = rec.id ?? null;
  const owner0 = Array.isArray(rec.owners) ? rec.owners[0] : null;
  const atty0 = Array.isArray(rec.attorneys) ? rec.attorneys[0] : null;
  return {
    uri: id ? makeRef(office, id) : null,
    provider: "signa",
    office: String(office).toLowerCase(),
    id,
    applicationNumber: rec.application_number ?? null,
    registrationNumber: rec.registration_number ?? rec.ir_number ?? null,
    applicationDate: toIso(rec.filing_date),
    registrationDate: toIso(rec.registration_date),
    expiryDate: toIso(rec.expiry_date),
    statusClass: statusClassOf(rec),   // live | dead | unknown — authoritative for the gates
    statusText: pickStatusText(rec),
    markText: rec.mark_text ?? null,
    markFeature: rec.mark_feature_type ?? null,
    niceClasses: normalizeClasses(rec),
    owner: rec.owner_name ?? owner0?.name ?? null,
    ownerCountry: owner0?.country_code ?? owner0?.country ?? null,
    representative: atty0?.name ?? null,
    imageAvailable: rec.has_media ?? null,
    resolved_link: null, // Signa exposes no per-record public URL; renderer shows "verify at office"
    // ── WHICH LAYER THIS RIGHT SITS ON, carried as data ( →) ──────────────────────────
    // The normalizer read 18 of the 38 fields a search row carries. Among the 20 it dropped were the
    // four that say what KIND of right a record is — and those are not extras, they are the whole
    // vocabulary the binding-layer disclosure is written in. A France search that returns an EUTM and
    // a Madrid IR alongside French national marks could not say so, because the three arrived
    // indistinguishable once they had been through here.
    //
    //   filing_route  direct_national | direct_regional | madrid_ir | madrid_designation |
    //                 transformation | divisional | unknown
    //   scope_kind    the extent the right claims
    //   irNumber      set on Madrid rows; the IR the designation belongs to
    //   originOffice  where a Madrid designation came from
    filingRoute: rec.filing_route ?? null,
    scopeKind: rec.scope_kind ?? null,
    irNumber: rec.ir_number ?? null,
    originOffice: rec.origin_office_code ?? null,
    designationDate: toIso(rec.designation_date),
    jurisdiction: rec.jurisdiction_code ?? null,
    // Script and language are FULL-RECORD fields — a search row does not carry them. The record
    // shape is strictly wider than the row shape. Null here on a search row therefore means "not on this shape", not
    // "absent from the register", and `nativeScriptIndex` is settled from the record, not from this.
    markTextScript: rec.mark_text_script ?? null,
    markTextLanguage: rec.mark_text_language ?? null,
    renewalDueDate: toIso(rec.renewal_due_date),
    publicationDate: toIso(rec.publication_date),
    priorityDate: toIso(rec.priority_date),
    terminationDate: toIso(rec.termination_date),
    // Opposition data IS on the record now: `opposition_window` rides every search row and
    // `proceedings_count` the full record. The per-proceeding detail behind
    // GET /v1/trademarks/{id}/proceedings is still an unwired tool — so the window and the count are
    // reported, and the absence of detail is stated rather than left to look like an absence of
    // proceedings.
    oppositionWindow: rec.opposition_window ?? null,
    proceedingsCount: rec.proceedings_count ?? null,
    oppositions: null,
    _provenance: { opposition: rec.proceedings_count != null ? `count=${rec.proceedings_count} from the record; per-proceeding detail via /proceedings, tool not wired` : "per-proceeding detail via /proceedings, tool not wired" },
    _raw: rec,
  };
}

// Light search row (record_id + display fields). Signa returns FULL records on search, but we project a
// lean row here and let record_fetch return the full normalized record (mirrors corsearch/clarivate).
function normalizeSearchRow(rec) {
  return {
    record_id: rec.id ? makeRef(rec.jurisdiction_code || rec.office_code, rec.id) : null,
    id: rec.id,
    office: String(rec.jurisdiction_code || rec.office_code || "").toLowerCase(),
    mark_text: rec.mark_text ?? null,
    status: pickStatusText(rec),
    status_class: statusClassOf(rec),
    nice_classes: normalizeClasses(rec),
    owner: rec.owner_name ?? null,
    filing_date: toIso(rec.filing_date),
    registration_date: toIso(rec.registration_date),
    relevance_score: Number.isInteger(rec.relevance_score) ? rec.relevance_score : null,
    raw: rec,
  };
}

// ── "did the provider ANSWER", not "did the bytes parse" — same discrimination as the other cores ──
// A search answer here is a body carrying data[] — the rows ARE the response, and since
// buildSearchRequest sets `include_total: true` on every request, `pagination.total_count` rides the
// same body. A parseable body without data[] — an error envelope served with a 200 —
// used to fall through `Array.isArray(body?.data) ? body.data : []` as zero rows, has_more false:
// the page loop simply ended and the band walked out enumerated. Not an answer ⇒ null total, an
// error surfaced by doSearch.
export function isSearchResponseBody(body) {
  return body != null && typeof body === "object" && Array.isArray(body.data);
}

// ── THE TOTAL, AND THE ONE CASE WHERE THE VENDOR'S NUMBER IS NOT A COUNT ───────────────────────────
//
// `options.include_total` returns `pagination.total_count` AND `pagination.total_count_approximate`.
// Across nine queries every narrow band answers exact (685, 220, 363, 830, 2047,
// 21, 101, 18) and — the case that matters — an empty band answered `total_count: 0, approximate:
// false`, an EXACT zero, which is the only kind this repository is allowed to render.
//
// Every approximate answer came back as exactly 10000: it is a saturation marker, not an estimate.
// The vendor is saying "at least ten thousand", and it says so on the broad sweeps (a bare owner
// filter, `match: similar`, an unanchored `contains`) — precisely the bands a clearance cannot
// enumerate anyway.
//
// SO AN APPROXIMATE TOTAL IS REPORTED AS UNKNOWN, NOT AS 10000. Under `countProbe: "cheap"` the
// kernel tests the enumerate ceiling off this number and mints `enumerated` from it, so a figure that
// is not a count must not travel in the column that holds counts — "10000" reads as a measurement to
// every downstream consumer and to the lawyer at the end of them. `null` is the honest value and the
// kernel already knows what to do with it: the band returns `incomplete` with the total UNKNOWN.
//
// THE COST, STATED. A saturated band now returns `incomplete` at page 0 with an EMPTY sample, where
// the old page-count cutoff accumulated up to the ceiling and carried ~600 rows of it. Those bands
// were `incomplete` before and are `incomplete` now — what changes is that judgment gets no sample
// rows from them. Accepted knowingly: the alternative is a fabricated figure in the count column, and
// the flag is carried on the payload so a later change can act on it without re-probing.
export function readTotal(body) {
  const p = body?.pagination;
  if (!p || typeof p !== "object") return { total: null, approximate: false };
  if (p.total_count_approximate === true) return { total: null, approximate: true, floor: Number.isFinite(p.total_count) ? p.total_count : null };
  return { total: Number.isFinite(p.total_count) ? p.total_count : null, approximate: false };
}

export function normalizeSearchResponse(body, echoQuery) {
  // A NON-ANSWER (the response did not parse, or parsed into something with no data[]) reports
  // total_hits NULL, never 0 — the same rule as the corsearch and clarivate normalizers. It matters
  // MORE here, not less: an empty page 0 with has_more:false simply ENDS the loop, so a truncated 200
  // — or a 200 carrying an error envelope — walked straight out as state:"enumerated", count:0: a
  // false clean with no error anywhere in its path. doSearch refuses before this is reachable; this
  // is the second lock.
  const answered = isSearchResponseBody(body);
  const data = Array.isArray(body?.data) ? body.data : [];
  const meta = body?.search_meta || {};
  const { total, approximate, floor } = readTotal(body);
  return {
    query: meta.query ?? echoQuery,
    strategies_used: meta.strategies_used ?? [],
    match: meta.match ?? null,
    search_id: meta.search_id ?? null,
    // The corpus total when the vendor counted it exactly; null when it did not answer, when the
    // total was not requested, and when the figure it returned is an approximation. NEVER the page
    // size — `data.length` is `count`, and conflating the two is how a page reads as a corpus.
    total_hits: answered ? total : null,
    total_approximate: answered ? approximate : false,
    total_floor: answered && approximate ? (floor ?? null) : null,
    page_count: answered ? data.length : null,
    has_more: body?.has_more === true,
    next_cursor: body?.pagination?.cursor ?? null,
    took_ms: meta.execution_time_ms ?? null,
    results: data.map(normalizeSearchRow),
    request_id: body?.request_id ?? null,
  };
}

// ── Mock fixtures — TEST-ONLY, and reachable from nothing a run can start ───────────────────
//
// THIS HEADER USED TO ADVERTISE AN ENVIRONMENT VARIABLE, `CLAWDI_SIGNA_MOCK`. There was never such a
// variable: two occurrences in the whole tree, both comments, zero reads. Following the line produced a
// run that died at preflight in seconds, and it cost a real investigation (, found by e2e looking
// for a credential-free register lane for fault injection).
//
// The lane below is real and works. What does not exist is a way to REACH it from a run: `doSearch`,
// `doRecordFetch` and `doEnumerate` each take `{ mock = false }`, the capability wrappers pass
// `{ mock: auth.mock }` — and NOTHING ANYWHERE SETS `auth.mock`. The driver's four signa adapters
// (driver.config.mjs) call these functions with no options object at all. So the only callers that
// enable it are this provider's own tests, and that is the whole of it.
//
// AND IT STAYS THAT WAY DELIBERATELY, rather than for want of wiring. offered to wire it; the
// acceptance that comes with wiring is "preflightCredentials must not demand SIGNA_API_KEY when the
// mock lane is on", and that produces a clearance run with no register credential, reaching the
// register stage, answering from ten in-repo fixtures. ADR-0003's first table row rules exactly that
// out: the register REFUSES at preflight, by name, because "an unconfigured register that answered
// 'no conflicts found' is the most dangerous output this system can produce".
//
// The disclosure that could make it survivable is not there either: the responses below stamp
// `mock: true` into a JSON text payload, and nothing in driver/ reads it — measured, not assumed. So no
// receipt, ledger or report would say the register answer came from fixtures, which is the other half
// of ADR-0003 ("degrading in silence is not acceptable"). Building that disclosure is a larger change
// than reaching the lane, and it is the precondition, not an extra.
//
// driver/test/signa-mock-lane-is-unreachable-from-a-run.test.mjs holds the line.
const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = process.env.SIGNA_FIXTURES_DIR || process.env.CLAWDI_SIGNA_FIXTURES_DIR
  || [join(__dir, "..", "test", "fixtures"), join(__dir, "..", "..", "test", "fixtures")].find((p) => existsSync(p))
  || join(__dir, "..", "test", "fixtures");
function loadFixture(name) {
  const p = join(FIXTURES_DIR, `${name}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
// The fixture NAME is derived from the request, so the two request shapes need two naming rules or the
// deterministic lane is unreachable offline: `match: "contains"` carries no strategies, fell through to
// the strategy default "exact", and served the ranked fixture — the mock lane would have agreed that a
// contains sweep works while replaying an exact one. declares three predicates that ride this
// shape, so it gets its own key rather than borrowing the other's.
// The deterministic captures are not all of the same term, and the reason is worth the line. The
// original `ends_with` capture carried an unrelated third party whose COMPANY NAME contained a word
// the private roster retires — a real registrant, nothing to do with any matter here, surfaced by a
// live search. Captured register data is full of real company names, so any ordinary English word the
// roster retires will eventually turn up in one; re-taking that capture from a different term keeps
// the roster unwidened, which is the direction to err in before an open-source cut. Hence a fallback
// LIST rather than one hardcoded term.
const DETERMINISTIC_FALLBACK_TERMS = ["nike", "swoosh"];
function resolveSearchFixture({ query, strategies, match }) {
  const q = String(query || "").toLowerCase();
  const det = typeof match === "string" ? match.trim() : "";
  if (det) {
    return loadFixture(`signa-search-match-${det}-${q}`)
      || DETERMINISTIC_FALLBACK_TERMS.reduce((hit, t) => hit || loadFixture(`signa-search-match-${det}-${t}`), null);
  }
  const strat = (Array.isArray(strategies) && strategies[0]) || "exact";
  if (q === "nike") return loadFixture(`signa-search-${strat}-nike`) || loadFixture("signa-search-exact-nike");
  if (strat === "exact") return loadFixture(`signa-search-variant-${q}`);
  return null;
}

// ── Search ─────────────────────────────────────────────────────────────────────────────────────────
export async function doSearch(apiKey, base, params, tctx, { mock = false } = {}) {
  if (!params.query) return { type: "text", text: "ERROR: query is required." };
  if (mock) {
    const fx = resolveSearchFixture(params);
    if (!fx) return { type: "text", text: `ERROR (mock): no fixture for query=${params.query} strategy=${(params.strategies || ["exact"])[0]}` };
    return { type: "text", text: JSON.stringify({ mock: true, ...normalizeSearchResponse(fx, params.query) }, null, 2) };
  }
  const body = buildSearchRequest(params);
  const r = await signaFetch(apiKey, base, "/v1/trademarks", { method: "POST", body, tctx: { ...tctx, target: String(params.query).slice(0, 120) } });
  if (!r.ok) {
    const msg = r.body?.error?.detail ?? r.body?.message ?? (r.raw ? r.raw.slice(0, 200) : "");
    return { type: "text", text: `ERROR: signa_search HTTP ${r.status}: ${msg}` };
  }
  // THE GUARD (see the corsearch core for the full trace). The count that would contradict an empty
  // search rides THIS body — and a body that did not parse carries neither the rows nor the total, so
  // in exactly this case there is no second net. An unparsed 200 was the shortest path in the codebase
  // from a cut connection to `state:"enumerated"` with zero records. The guard is unchanged; its reason
  // is corrected — it used to rest on this provider having no count at all, which retired.
  if (r.parseError) return { type: "text", text: unparsedBodyError("signa_search", r, ` query=${String(params.query).slice(0, 120)}`) };
  // Parsing is not answering: a 200 carrying an error envelope is the same shortest path one JSON
  // envelope away — no data[], zero rows, the loop ends, enumerated. See isSearchResponseBody.
  if (!isSearchResponseBody(r.body)) {
    return { type: "text", text: nonAnswerBodyError("signa_search", r, "a search response (no data[] — the key every /v1/trademarks answer carries)", ` query=${String(params.query).slice(0, 120)}`) };
  }
  return { type: "text", text: JSON.stringify(normalizeSearchResponse(r.body, params.query), null, 2) };
}

// ── Record fetch ─────────────────────────────────────────────────────────────────────────────────
// Accepts a synthetic `/mark/<office>/<id>` ref OR a raw Signa id. Returns the NORMALIZED record and
// persists it (keyed by the synthetic ref) for the driver's A1 citation-fidelity gate.
export async function doRecordFetch(apiKey, base, params, tctx, { mock = false } = {}) {
  const ref = params.record_id ?? params.id;
  if (!ref) return { type: "text", text: "ERROR: record_id (a /mark/<office>/<id> ref or a Signa id) is required." };
  const id = refToId(ref);
  const officeHint = refToOffice(ref);
  if (mock) {
    const fx = loadFixture("signa-record-fetch");
    const raw = fx?.data ?? fx;
    const nr = normalizeRecord(Array.isArray(raw) ? raw[0] : raw, officeHint);
    return { type: "text", text: JSON.stringify({ mock: true, ...nr }, null, 2) };
  }
  const r = await signaFetch(apiKey, base, `/v1/trademarks/${encodeURIComponent(id)}`, { tctx: { ...tctx, target: id } });
  if (!r.ok) {
    const msg = r.body?.error?.detail ?? r.body?.message ?? (r.raw ? r.raw.slice(0, 200) : "");
    return { type: "text", text: `ERROR: signa_record_fetch HTTP ${r.status}: ${msg}` };
  }
  // An unparsed body was normalized into an all-null record and PERSISTED under a real record id,
  // which the citation-fidelity gate then reads as a record carrying no facts.
  if (r.parseError) return { type: "text", text: unparsedBodyError("signa_record_fetch", r, ` record_id=${ref}`) };
  const raw = r.body?.data ?? r.body;
  const nr = normalizeRecord(Array.isArray(raw) ? raw[0] : raw, officeHint);
  if (nr?.uri) logRecordBody({ ...tctx, kind: "record_fetch" }, nr.uri, nr);
  return { type: "text", text: JSON.stringify(nr, null, 2) };
}

// ── the kernel speaks a different vocabulary, and the adapter has to translate ─────────────────────
//
// THE DEFECT THIS CLOSES, found by probing the kernel's own param shape rather than the adapter's.
// `makeEnumerate` and `makeExecutePlan` hand a provider the PLAN's vocabulary — `name`, `names`,
// `owner`, `regions`, `match_mode` — because that is what a frozen plan entry carries. Signa's
// `doSearch` speaks the VENDOR's — `query`, `offices`, `strategies`. Wired without a translator, every
// plan entry arrived as `{name: "..."}` with no `query` and came straight back as
// `ERROR: query is required.` — so executePlan failed on every entry it was given.
//
// It passed the suite because every test called the adapter in the ADAPTER's vocabulary. A test that
// speaks the same dialect as the code under test cannot find a dialect mismatch, which is why the one
// below builds its params the way the kernel does and not the way doSearch prefers.
//
// `names` (an OR-stack) is deliberately NOT accepted: `maxOrWidth: 1` — verified against the live
// specification, which carries no OR array on this endpoint — so a stack must reach here already split
// by the planner. Silently searching only its first term would be a narrowed query wearing a complete
// answer, which is this whole track's failure mode.
export function toSignaParams(p = {}) {
  const out = { ...p };
  if (p.name != null && p.query == null) out.query = p.name;
  // ── A ONE-TERM `names` WINDOW IS A TERM, NOT A STACK ────────────────────────────────────────────
  // `maxOrWidth: 1` means the kernel CHUNKS a wide names band into windows of one and runs the full
  // enumerate contract on each — that is what `namesChunkDefault: 1` is for. Every window therefore
  // arrives here as `names: ["one-term"]`, and with no mapping it came back "ERROR: query is
  // required": a names band could not run on this provider AT ALL, and the failure was reported as
  // chunk 1 failing rather than as the adapter refusing a shape the kernel had already split.
  //
  // Refusing a MULTI-term stack is still right and is the assertion below — picking names[0] there
  // would be a narrowed query wearing a complete answer. One term is not a choice between terms.
  if (out.query == null && Array.isArray(p.names) && p.names.filter(Boolean).length === 1) {
    out.query = p.names.filter(Boolean)[0];
  }
  // ── STAGE 2 — A TERRITORY IS A STACK OF RIGHTS, AND THIS PROVIDER CAN SEARCH THE STACK ─────
  //
  // The plan's `regions` are the territories the matter ordered, already translated into this vendor's
  // office keys. Sending them as `filters.offices` searches ONE register each — the national one — and
  // that is the defect exists to close: an EU trade mark blocks use in France without appearing
  // in the French register, and was never searched.
  //
  // `filters.jurisdictions` + `territory_match: "protection"` asks the territory question instead:
  // every right with effect there, whatever register it sits on. Same term:
  //
  //   filters.offices: ["inpi-fr"]                        national 6898, regional 0,     madrid 0
  //   filters.jurisdictions: ["FR"], protection           national 6898, regional 10000+, madrid 2708
  //
  // and the control that shows `protection` adds a layer rather than merely more rows: Switzerland,
  // under no regional register, returns regional 0 either way while its madrid layer arrives all the
  // same. Every one of the eleven covered territories reaches its Madrid layer this way; the EU
  // members additionally reach the EU register.
  //
  // IT IS ONE CALL, NOT THREE. No extra queries, no extra spend — which is why this half of Stage 2
  // could land while the multi-office expansion the other providers need is a cost decision.
  //
  // THE VOCABULARY IS NOT THE OFFICE VOCABULARY, and the API is strict about it: `jurisdictions`
  // takes ISO territory codes, and an office key sent there is a hard 400 ("Unknown jurisdiction code:
  // inpi-fr"). SIGNA_OFFICE_KEYS is the bridge — it maps each office key to the jurisdiction code the
  // matter names, which is why it has always held `EU` for EUIPO while the office's own code is `EM`.
  // An office with no mapping is DROPPED FROM THE TRANSLATION rather than guessed at, and if that
  // leaves nothing the request keeps the office filter — a narrower search that runs beats a wider one
  // that 400s, and the layer disclosure still fires for what it did not reach.
  // IDEMPOTENT, and that is not a nicety. This function is applied by the kernel's search dep, and a
  // caller that translates before handing params in — the shape a probe or a driver adapter naturally
  // takes — gets it applied twice. On the second pass `regions` is still present, so an earlier draft
  // re-added `offices` beside the `jurisdictions` it had just produced. The API accepts both and the
  // office filter WINS: a France order went back to 19 national rows from 101, with `territory_match:
  // "protection"` sitting in the body doing nothing. The expansion silently undid itself and the run
  // reported `state: "enumerated"` either way. Caught by comparing before/after on a live call and
  // finding them identical — the one check that could see it.
  const alreadyScoped = Boolean(p.offices) || Boolean(p.jurisdictions);
  if (Array.isArray(p.regions) && p.regions.length && !alreadyScoped) {
    const territories = p.regions.map((r) => SIGNA_OFFICE_KEYS[String(r ?? "").toLowerCase()] ?? null);
    if (territories.every(Boolean)) {
      out.jurisdictions = [...new Set(territories)];
      out.territory_match = p.territory_match ?? "protection";
      delete out.offices;
    } else {
      out.offices = p.regions;
    }
  }

  // `match_mode` is the plan's word for how the term matches. Two request shapes answer it and they
  // are MUTUALLY EXCLUSIVE (see buildSearchRequest): the ranked `strategies[]` and the deterministic
  // `match`. exact/phonetic stay on strategies, which is what this provider has always sent and what
  // its fixtures were captured with; the anchored and unanchored modes can only be expressed by
  // `match`, so they select that shape and drop strategies.
  const mode = String(p.match_mode ?? "").trim();
  if (mode === "exact" || mode === "phonetic" || mode === "prefix") out.strategies = [mode];
  else if (mode === "starts_with" || mode === "ends_with" || mode === "contains") out.match = mode;
  else if (!mode && !p.match && !(Array.isArray(p.strategies) && p.strategies.length)) {
    // ── THE `default` PREDICATE, WHICH JUST MADE EXECUTABLE ────────────────────────────────
    // `planPredicateParams` returns {} for the plan's `default` predicate — no match_mode at all —
    // and this branch is the only thing standing between that and `strategies: ["exact"]`. With
    // `predicates.default` declared `"contains"` and no mapping here, every unanchored slice would
    // have gone to the wire as an EXACT search: narrower than the plan asked for, returning fewer
    // rows, and answering as though it were the query requested. That is 's defect exactly, and
    // declaring a predicate without wiring it is the one thing this issue's criteria forbid.
    //
    // A `*` in the term means this is the infix-wildcard case, which shares the empty {} and which
    // `contains` cannot serve — the kernel hands the RAW pattern, asterisks included, so a contains
    // sweep would search the punctuation. `wildcardInfix` is null in the contract, so the planner
    // defers those slices before they ever arrive; this is the second lock, not the first.
    if (typeof out.query === "string" && !out.query.includes("*")) out.match = "contains";
  }

  // Owner rides `filters.owner_name` (buildFilters). The plan's word is `owner`; passing it through
  // under the plan's name keeps ONE translation site — this function — rather than two.
  if (typeof p.owner === "string" && p.owner.trim()) out.owner = p.owner.trim();

  return out;
}

// ── the shared kernel ──────────────────────────────────────────────────────────────────────
//
// Signa was built correctly to the design of its day and the engine moved to code-driven execution
// underneath it. Until now this core imported only the ledger and the body helpers: no `makeEnumerate`,
// no `makeExecutePlan`, so `planExec` resolved to null and a Signa run fell to the AGENT lane — a model
// asked to page a register by hand, with no executor tool to skip and no kernel probe reading the
// corpus total this vendor was already returning. Four providers have walked this port; clarivate's is
// the model.
//
// TWO SEAMS ARE UNUSUAL HERE AND BOTH ARE THE PROVIDER'S OWN SHAPE, not a workaround:
//
// A SATURATION MARKER WHERE OTHER PROVIDERS HAVE A COUNT. `countProbe` is `"cheap"`: `include_total`
// puts `pagination.total_count` on the ordinary search response, so the kernel tests the enumerate
// ceiling off page 0 and needs no count dependency at all — see `count: null` below, which says why a
// second way to get the same number is not wanted here.
//
// What is unusual is the OTHER field. A broad band answers `total_count_approximate: true` with exactly
// 10000, which is the vendor saying "at least ten thousand" rather than estimating, and this core
// reports it as UNKNOWN rather than as a figure. So `total_hits` rides out null on a SATURATED band
// ONLY — never 0, and never a number invented to fill the column — and that band returns `incomplete`
// with the total UNKNOWN. An exact total mints `enumerated` the ordinary way. THE TOTAL block above
// carries the nine-query measurement this rests on.
//
// This paragraph asserted the opposite until — sitting just above the `count: null` comment that
// explains the total rides page 0, in a file whose own buildSearchRequest asks for it on every request.
// The header block on doCount records that history in full.
//
// CURSOR PAGINATION. Every other provider takes `limit` + `page`, so the kernel's page loop was indexed
// and `pageParams` never saw the previous response. Signa's next request is built from the LAST answer
// (`pagination.cursor` + `has_more`), which no index can express — page 1 is simply unreachable, and an
// enumerate that can only ever return page 0 reads as a complete band. The kernel now passes the
// previous parsed page as a third argument; every other provider's pageParams ignores it unchanged.
/**
 * THE ONE QUERY SHAPE WITH A NARROWER RESULT WINDOW.
 *
 * `filters.owner_name` caps paging at 400 ROWS on this vendor; nothing else does. Same term,
 * same term and limit: `exact` exhausted at 685, `contains` at 2047, and the owner-scoped one stopped
 * dead — "This cursor points beyond the 400 result pagination window."
 *
 * `null` for every other shape, and that is the load-bearing half. Returning 400 across the board would
 * turn every tractable band over 400 into a sanctioned crowd — an UNDER-SEARCH wearing a crowd
 * descriptor's clothes, which nothing downstream could tell from a real one.
 *
 * `isOwnerScoped` is the kernel's own predicate, imported rather than restated, so the window and the
 * count-first per-CLASS rescue that answers it can never drift onto different shapes. Exported so the
 * declaration can be tested directly instead of inferred from a band.
 */
export const ownerWindowCeiling = (params) => (isOwnerScoped(params) ? OWNER_SCOPED_WINDOW : null);

const { enumerate: __enumerate } = makeEnumerate({
  search: (auth, params, tctx) => doSearch(auth.apiKey, auth.base, toSignaParams(params), tctx, { mock: auth.mock }),
  // Still no count function, and now for the OPPOSITE reason. `countProbe` is `"cheap"`: the
  // total rides page 0 of the ordinary search, so the kernel builds its probe from `search` and a
  // `count` dependency here would be a SECOND way to get the same number — the divergence the kernel's
  // own count/search reconciliation exists to adjudicate on the "endpoint" seam. One source, one
  // number. (`makeCountProbe` throws unless "endpoint" supplies one, so this is asserted, not assumed.)
  count: null,
  hasAnyElement: (p) => Boolean(String(p?.query ?? "").trim() || (Array.isArray(p?.names) && p.names.length)),
  missingElementError: "ERROR: signa_enumerate — a query (or names[]) is required.",
  capabilities: { ...CAPABILITIES.kernel },
  ceilingFor: ownerWindowCeiling,
  // The kernel's default cheap-probe params are CORSEARCH'S — `{limit:1, fields:["uri"]}` — and `uri`
  // is not a field this vendor has. Its `fields` projection rejects unknown names, so inheriting the
  // default would 400 every count-first rescue while the ordinary search beside it worked. `limit: 1`
  // is the whole of the smallest request here, because the total rides `options.include_total`, which
  // buildSearchRequest sets on every call.
  cheapCountParams: { limit: 1 },
  namesKey: "names",
  // SCREENING COMES OFF THE SEARCH ROW, which is what `screenSource: "search-row"` declares: this
  // provider's search already returns status and classes, so there is no second billed call to make.
  //
  // FLAT, and deliberately not wrapped in its own `screen` key — the kernel composes the record as
  // `{ ...record, screen: <this> }`, so a row that nests itself lands at `screen.screen.screen_verdict`
  // and every consumer's lookup misses by one level. Nothing errors; the verdict is simply absent, and
  // a band with no verdicts is a band that was never screened.
  rowScreen: (row, inScopeClasses) => {
    const classes = Array.isArray(row?.nice_classes) ? row.nice_classes.map(Number).filter(Number.isFinite) : [];
    const scope = Array.isArray(inScopeClasses) ? inScopeClasses.map(Number).filter(Number.isFinite) : [];
    const live = row?.status_class === "live" || row?.status_class === "active";
    // An EMPTY in-scope set means "not asked", never "nothing is in scope" — the second reading would
    // screen every row out and hand up a band that looks searched and clean.
    const inClass = !scope.length ? null : classes.some((c) => scope.includes(c));
    return {
      record_id: row?.record_id ?? null,
      mark_text: row?.mark_text ?? null,
      office: row?.office ?? null,
      classes,
      live_status: row?.status_class ?? null,
      in_scope_class: inClass,
      // UNKNOWN is its own verdict. A row with no classes on a class-scoped sweep has not been shown
      // irrelevant — it has not been shown anything, and calling that a miss is how a live mark leaves
      // a band quietly.
      screen_verdict: inClass === null ? "unscoped"
        : !classes.length ? "unknown"
        : inClass && live ? "keep"
        : inClass ? "keep-dead"
        : "out-of-class",
    };
  },
  // Page 0 sends no cursor; every later page sends the one the previous answer handed back. A missing
  // cursor with has_more:true would loop on page 0 forever, so it ends the band instead — the kernel's
  // pagination guard would otherwise spend sixty identical calls to reach the same conclusion.
  pageParams: (page, pageSize, prev) => (page === 0
    ? { limit: pageSize }
    : { limit: pageSize, cursor: prev?.next_cursor ?? null }),
  recordIdOf: (rec) => rec?.record_id,
  recordKeyOf: (rec) => rec?.record_id ?? rec?.id ?? JSON.stringify(rec).slice(0, 120),
  screenJoinKey: (row) => row?.record_id,
});

/**
 * Enumerate a named band to exhaustion, or report honest incompleteness.
 *
 * The completeness primitive this provider did not have: without it there is no way to return "I paged
 * this band to exhaustion" as distinct from "here is what I got", and the two read identically on a
 * report.
 */
export async function doEnumerate(apiKey, base, params, tctx, { mock = false } = {}) {
  return __enumerate({ apiKey, base, mock }, params, tctx);
}

// ── the plan executor ──────────────────────────────────────────────────────────────────────
//
// THE ONE THAT DECIDES WHETHER A RUN IS CODE-DRIVEN OR MODEL-DRIVEN. Without it `planExec` resolves to
// null and the run degrades to the agent lane, and preflight now refuses the provider outright rather
// than starting a run that would report coverage it never searched.
//
// The FULL contract is passed, not the kernel block: the script-form and owner×term refusals read it,
// and an ABSENT contract DEFERS rather than sweeping — which is the safe direction, because "nobody
// declared what this index holds" must never resolve to a silent zero.
const executePlanKernel = makeExecutePlan({
  search: (auth, params, tctx) => doSearch(auth.apiKey, auth.base, toSignaParams(params), tctx, { mock: auth.mock }),
  enumerate: (auth, params, tctx) => doEnumerate(auth.apiKey, auth.base, toSignaParams(params), tctx, { mock: auth.mock }),
  capabilities: CAPABILITIES,
});

/** Run a frozen plan's entries for one axis, writing the band the driver reads. */
export const doExecutePlan = (auth, params, tctx) => executePlanKernel(auth, params, tctx);

/**
 * Count a query without retrieving it.
 *
 * THE COUNT IS REAL, and it is cheap: `include_total` puts the corpus total on the same response, so
 * the smallest request this API will take — limit 1 — carries the whole answer. `countProbe: "cheap"`
 * says so in the contract: `countProbe` in providers/signa/src/capabilities.js, and again in the
 * kernel-seam block below it.
 *
 * THIS HEADER SAID THE OPPOSITE UNTIL. It read "THIS PROVIDER HAS NO COUNT ENDPOINT" and cited
 * `countProbe: "none"` as the contract's agreement — a value changed to "cheap" on 2026-08-17,
 * because the total had always been there behind an opt-in flag nobody had set. The block INSIDE this
 * function recorded that correctly while the header five lines above it did not, and `countProbe` is
 * the field the kernel branches on for count-first. A reader who stopped at the doc comment got the
 * premise backwards on the load-bearing one, in the emphatic register this codebase reserves for
 * probed facts. Found while reading the contract for.
 *
 * THE ZERO RULE IS UNCHANGED and is what makes the number safe to publish: `total_hits` stays null
 * unless the vendor counted EXACTLY, so an approximation and a non-answer both report unknown, and the
 * only 0 this can emit is one the register itself returned as an exact 0. Inventing a number here is
 * how a crowd reads as a clean band.
 */
export async function doCountHits(apiKey, base, params, tctx, { mock = false } = {}) {
  const r = await doSearch(apiKey, base, { ...params, limit: 1 }, tctx, { mock });
  if (String(r?.text ?? "").startsWith("ERROR")) return r;
  const parsed = JSON.parse(r.text);
  // ── this is a COUNT now, and it was a presence probe ──────────────────────────────────
  // `include_total` returns the corpus total on the same call, so the smallest request the API will
  // take — limit 1 — carries the whole answer: probed, `limit:1` returned total 685, identical to the
  // paged query's. Stage 0.5 (driver/register-count.mjs) refused to run on this provider at all; it
  // now gets the number it exists to ask for.
  //
  // THE ZERO RULE IS UNCHANGED AND IS THE REASON THIS IS SAFE. `total_hits` is null unless the vendor
  // counted exactly — an approximation and a non-answer both report unknown. So the only 0 this can
  // emit is one the register itself returned as an exact 0, and "we could not ask" never wears the
  // same clothes as "we asked and the answer is none".
  const exact = Number.isFinite(parsed.total_hits);
  return {
    type: "text",
    text: JSON.stringify({
      total_hits: exact ? parsed.total_hits : null,
      total_approximate: parsed.total_approximate === true,
      present: exact ? parsed.total_hits > 0 : ((parsed.results?.length ?? 0) > 0 || parsed.has_more === true),
      seen: parsed.results?.length ?? 0,
      note: exact
        ? "exact corpus total from pagination.total_count"
        : (parsed.total_approximate === true
          ? `the vendor flagged this total an approximation (floor ${parsed.total_floor ?? "unstated"}) — reported UNKNOWN rather than as a count`
          : "no total in the response; this is a presence probe, not a count"),
    }, null, 2),
  };
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
/**
 * EUIPO Trade mark search API client — pure HTTP/OAuth, no plugin-SDK import,
 * so it is unit-testable standalone (see ../test/smoke.mjs).
 *
 * Built against the official OpenAPI spec (Trademark search v1.1.0, server
 * https://api-sandbox.euipo.europa.eu/trademark-search). Sandbox auth VERIFIED
 * live 2026-05-26 (token HTTP 200). Live search verification pends the app being
 * subscribed to the Trade mark search API plan (otherwise 403 "Not registered to plan").
 *
 * Auth: OAuth2 client-credentials. POST to <env>/oidc/accessToken with
 * grant_type=client_credentials, client_id, client_secret, scope=uid → bearer (~2h).
 * Every API call needs BOTH `Authorization: Bearer <token>` AND
 * `X-IBM-Client-Id: <client_id>` (IBM API Connect gateway; per the spec's two
 * security schemes ClientID + Oauth2ClientCredentials).
 *
 * Note (anonymous flow): under client-credentials the end user is anonymous, so
 * EUIPO may hide some applicant details until the basic application fee is paid.
 */

import { nonAnswerBodyError, parseJsonBody, unparsedBodyError } from "../../_shared/http-body.mjs";

export const ENV = {
  sandbox: {
    auth: "https://auth-sandbox.euipo.europa.eu/oidc/accessToken",
    api: "https://api-sandbox.euipo.europa.eu/trademark-search",
  },
  production: {
    // The prod token host/path is NOT the symmetric "auth.euipo.europa.eu" — it is the CAS server
    // below, as the production OpenAPI spec gives it.
    auth: "https://euipo.europa.eu/cas-server-webapp/oidc/accessToken",
    api: "https://api.euipo.europa.eu/trademark-search",
  },
};

// Enum values straight from the spec.
//
// ── TWO OF THESE EIGHTEEN CANNOT BE QUERIED, AND THIS LIST MUST NOT BE USED AS A FILTER VOCABULARY ─
// `status=="APPEALABLE"` and `status=="ACCEPTANCE_PENDING"` both return HTTP 400 at a valid `size`;
// the other sixteen answer. One rejected token 400s the
// WHOLE query, so a filter built from this list fails outright rather than returning a narrower band.
//
// The list stays at eighteen because it is a true statement of what statuses EXIST — a mark can carry
// either of those two and be returned to us on a row, and the classifier in ./row.js recognises all
// eighteen. What is filterable is a different set, declared as `queryableStatuses` in
// ./capabilities.js. Two vocabularies, kept apart on purpose.
//
// This list was surfaced to the model as a tool-schema enum until, so a model could pick a value
// the schema advertised and get a 400 back. The neutral server now offers `queryableStatuses`.
export const MARK_FEATURES = ["WORD", "FIGURATIVE", "SHAPE_3D", "COLOUR", "SOUND", "HOLOGRAM", "OLFACTORY", "POSITION", "PATTERN", "MOTION", "MULTIMEDIA", "OTHER"];
export const STATUSES = ["RECEIVED", "UNDER_EXAMINATION", "APPLICATION_PUBLISHED", "REGISTRATION_PENDING", "REGISTERED", "WITHDRAWN", "REFUSED", "OPPOSITION_PENDING", "APPEALED", "CANCELLATION_PENDING", "CANCELLED", "SURRENDERED", "EXPIRED", "APPEALABLE", "START_OF_OPPOSITION_PERIOD", "ACCEPTANCE_PENDING", "ACCEPTED", "REMOVED_FROM_REGISTER"];

// In-memory token cache, keyed by clientId. Cleared on process restart.
const tokenCache = new Map(); // clientId -> { token, expiresAt }

/**
 * item 2 / ADR-0001 — THE HOSTS FOR A STATED ENVIRONMENT, OR A REFUSAL. Never a default.
 *
 * `core.js` already refuses an unset `EUIPO_ENVIRONMENT` by name, which is what the item's judge-it
 * criterion asks for, and every live caller here arrives through its `resolveConfig`. These five sites
 * were the residual: `environment = "sandbox"` as a destructure default, and `ENV[x] || ENV.sandbox`
 * four times. They were unreachable TODAY and fail open TOMORROW — the next caller that builds a cfg
 * without going through the resolver silently searches a frozen snapshot plus synthetic rows and
 * reports a clearance against marks that do not exist.
 *
 * That is the shape is about: everything else in this engine fails closed, and this did not.
 * A default cannot be right here in either direction — sandbox is a legitimate deliberate choice and
 * production is the register — so neither is guessable from an absence, and the only honest answer to
 * an absent environment is to say so.
 */
function hostsFor(cfg, where) {
  const environment = String(cfg?.environment ?? "").trim();
  if (!environment) {
    throw new Error(
      `[euipo] ${where}: EUIPO_ENVIRONMENT is not set and there is NO default. It selects which EU `
      + "corpus this call searches, and the two are not interchangeable: `production` is the register; "
      + "`sandbox` is a frozen snapshot plus synthetic rows. Resolve the config through core.js's "
      + "resolveConfig, which refuses the same way (#1149 item 2, ADR-0001).",
    );
  }
  if (!ENV[environment]) {
    throw new Error(
      `[euipo] ${where}: EUIPO_ENVIRONMENT="${environment}" is not one of: ${Object.keys(ENV).join(", ")}. `
      + "sandbox and production are SEPARATE DEPLOYMENTS holding different corpora — guessing one is not an option.",
    );
  }
  return ENV[environment];
}

export async function getAccessToken(cfg, { force = false } = {}) {
  const { clientId, clientSecret } = cfg;
  const now = Date.now();
  const cached = tokenCache.get(clientId);
  if (!force && cached && cached.expiresAt > now + 60_000) return cached.token;

  const { auth } = hostsFor(cfg, "getAccessToken");
  const resp = await fetch(auth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "uid",
    }),
  });
  const raw = await resp.text();
  // This site was ALREADY fail-closed (it throws unless access_token is present), so routing it
  // through the shared parser changes nothing here — it is done so no copy of the swallow survives
  // to be pasted into the next adapter.
  const { body } = parseJsonBody(raw);
  if (!resp.ok || !body?.access_token) {
    throw new Error(`EUIPO token request failed: HTTP ${resp.status} ${body?.error || raw.slice(0, 160)}`);
  }
  const expiresAt = now + (Number(body.expires_in) || 3600) * 1000;
  tokenCache.set(clientId, { token: body.access_token, expiresAt });
  return body.access_token;
}

// RSQL value: always double-quoted, with " and \ escaped (grammar requires quoting
// for any value containing a space; quoting is always safe). Wildcard '*' is placed
// inside the quotes for contains-style matches.
function q(v) {
  return `"${String(v).replace(/(["\\])/g, "\\$1")}"`;
}
function qContains(v) {
  return `"*${String(v).replace(/(["\\])/g, "\\$1")}*"`;
}

/**
 * Build the RSQL `query` string from structured params. If `rsql` is supplied it
 * is returned verbatim (escape hatch). Clauses AND-joined with the ` and ` keyword
 * (the form used throughout the spec's examples). All field names + operators are
 * from the spec's "Supported Fields" table.
 */
export function assembleRsql(p) {
  if (p.rsql) return p.rsql;
  const clauses = [];

  if (p.application_number) clauses.push(`applicationNumber==${q(p.application_number)}`);
  if (p.name)               clauses.push(`wordMarkSpecification.verbalElement==${q(p.name)}`);
  if (p.name_contains)      clauses.push(`wordMarkSpecification.verbalElement==${qContains(p.name_contains)}`);
  if (p.applicant)          clauses.push(`applicants.name==${qContains(p.applicant)}`);

  if (Array.isArray(p.nice_classes) && p.nice_classes.length) {
    const op = p.nice_classes_mode === "all" ? "=all=" : "=in="; // any-of by default
    clauses.push(`niceClasses${op}(${p.nice_classes.join(",")})`);
  }
  if (Array.isArray(p.status) && p.status.length) {
    clauses.push(p.status.length === 1 ? `status==${q(p.status[0])}` : `status=in=(${p.status.join(",")})`);
  }
  if (Array.isArray(p.mark_feature) && p.mark_feature.length) {
    clauses.push(p.mark_feature.length === 1 ? `markFeature==${q(p.mark_feature[0])}` : `markFeature=in=(${p.mark_feature.join(",")})`);
  }

  if (p.application_date_from)  clauses.push(`applicationDate>=${p.application_date_from}`);
  if (p.application_date_to)    clauses.push(`applicationDate<=${p.application_date_to}`);
  if (p.registration_date_from) clauses.push(`registrationDate>=${p.registration_date_from}`);
  if (p.registration_date_to)   clauses.push(`registrationDate<=${p.registration_date_to}`);

  return clauses.join(" and ");
}

export function hasSearchInput(p) {
  return !!(p.rsql || p.name || p.name_contains || p.application_number || p.applicant
    || (Array.isArray(p.nice_classes) && p.nice_classes.length)
    || (Array.isArray(p.status) && p.status.length)
    || (Array.isArray(p.mark_feature) && p.mark_feature.length));
}

async function euipoApiGet(cfg, path, query) {
  const { api } = hostsFor(cfg, "euipoApiGet");
  const url = new URL(`${api}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== "") url.searchParams.set(k, String(v));

  const headers = (tok) => ({ Authorization: `Bearer ${tok}`, "X-IBM-Client-Id": cfg.clientId, Accept: "application/json" });
  let token = await getAccessToken(cfg);
  let resp = await fetch(url, { headers: headers(token) });
  if (resp.status === 401) {                       // cached token may have expired — refresh once
    token = await getAccessToken(cfg, { force: true });
    resp = await fetch(url, { headers: headers(token) });
  }
  const raw = await resp.text();
  const { body, parseError } = parseJsonBody(raw);
  const retryAfter = resp.headers.get("retry-after");
  return { status: resp.status, ok: resp.ok, url: url.toString(), body, raw, parseError, retryAfter };
}

function errorText(tool, r, extra = "") {
  // EUIPO errors follow RFC-7807 Problem: { type, title, status, detail, instance, code, errors[] }
  const detail = r.body?.detail || r.body?.title || (r.raw ? r.raw.slice(0, 200) : "");
  let hint = "";
  if (r.status === 403) hint = "  → subscribe the app to the Trade mark search API plan in the EUIPO dev portal (403 'Not registered to plan').";
  else if (r.status === 429) hint = `  → rate limited; retry after ${r.retryAfter || "?"}s.`;
  else if (r.status === 401) hint = "  → token rejected; check client_id/secret + environment.";
  return `ERROR: ${tool} HTTP ${r.status}: ${detail}${hint}${extra}`;
}

// Normalize one TrademarkSearchResultItem to a stable, screening-friendly shape.
function normItem(t) {
  return {
    application_number: t.applicationNumber ?? null,
    mark_text: t.wordMarkSpecification?.verbalElement ?? null,
    mark_feature: t.markFeature ?? null,
    mark_kind: t.markKind ?? null,
    mark_basis: t.markBasis ?? null,
    status: t.status ?? null,
    nice_classes: t.niceClasses ?? null,
    application_date: t.applicationDate ?? null,
    registration_date: t.registrationDate ?? null,
    designation_date: t.designationDate ?? null,
    expiry_date: t.expiryDate ?? null,
    applicants: Array.isArray(t.applicants)
      ? t.applicants.map((a) => ({ office: a.office ?? null, identifier: a.identifier ?? null, name: a.name ?? null }))
      : null,
    raw: t,
  };
}

/** GET /trademarks — search. Returns a normalized envelope + per-item raw. */
export async function euipoSearch(cfg, params) {
  if (!hasSearchInput(params)) {
    return { type: "text", text: "ERROR: provide at least one of name, name_contains, application_number, applicant, nice_classes, status, mark_feature, or a raw rsql query." };
  }
  const query = assembleRsql(params);
  const size = Math.min(100, Math.max(10, params.size ?? 25));   // spec: size 10..100
  const page = Math.max(0, params.page ?? 0);
  const r = await euipoApiGet(cfg, "/trademarks", { query, size, page, sort: params.sort });
  if (!r.ok) return { type: "text", text: errorText("euipo_search", r, `\nRSQL: ${query}`) };
  // THE GUARD. `r.body || {}` turned an unparsed 200 into totalElements:null and results:[] — an
  // empty register page, which is what a model reads as "nothing is registered". Same refusal, same
  // vocabulary as the register adapters next door.
  if (r.parseError) return { type: "text", text: unparsedBodyError("euipo_search", r, `\nRSQL: ${query}`) };
  // Parsing is not answering: an RFC-7807 problem (this API's own error shape — {type, title,
  // status, detail}) served with a success status parses fine and rode out the same way, as an empty
  // register page. The answer shape (Trademark search v1.1.0 spec) carries totalElements and
  // trademarks[]; a parseable body with neither is a non-answer, refused in the same vocabulary as
  // the register adapters next door.
  if (!Array.isArray(r.body?.trademarks) && !Number.isInteger(r.body?.totalElements)) {
    return { type: "text", text: nonAnswerBodyError("euipo_search", r, "a search response (no trademarks[] and no totalElements)", `\nRSQL: ${query}`) };
  }

  const b = r.body || {};
  const out = {
    //: which EUIPO host answered. Read plainly — the refusal already happened upstream, because
    // this function reaches here only through euipoApiGet, which calls hostsFor before the request.
    // A second guard in a value position would be a throw pretending to be a read.
    environment: cfg.environment,   //: which EUIPO host answered — sandbox and production are separate systems, never to be mistaken for one another downstream
    query_rsql: query,
    page: b.page ?? page,
    size: b.size ?? size,
    total_elements: b.totalElements ?? null,
    total_pages: b.totalPages ?? null,
    results: Array.isArray(b.trademarks) ? b.trademarks.map(normItem) : [],
  };
  return { type: "text", text: JSON.stringify(out, null, 2) };
}

/** GET /trademarks/{applicationNumber} — full detail record (incl. oppositions,
 *  cancellations, appeals, decisions, goodsAndServices). Returns upstream JSON verbatim. */
export async function euipoRecordFetch(cfg, params) {
  if (!params.application_number) return { type: "text", text: "ERROR: application_number is required (9 digits, or W + 8 digits [+ letter] for IRs)." };
  const headers = params.language ? { "Accept-Language": params.language } : null;
  const { api } = hostsFor(cfg, "euipoRecordFetch");
  const url = `${api}/trademarks/${encodeURIComponent(params.application_number)}`;
  let token = await getAccessToken(cfg);
  const mk = (tok) => fetch(url, { headers: { Authorization: `Bearer ${tok}`, "X-IBM-Client-Id": cfg.clientId, Accept: "application/json", ...(headers || {}) } });
  let resp = await mk(token);
  if (resp.status === 401) { token = await getAccessToken(cfg, { force: true }); resp = await mk(token); }
  const raw = await resp.text();
  const { body, parseError } = parseJsonBody(raw);
  if (!resp.ok) {
    return { type: "text", text: errorText("euipo_record_fetch", { status: resp.status, body, raw, retryAfter: resp.headers.get("retry-after") }) };
  }
  // `body ?? raw` used to hand back the half-a-record the proxy delivered, as if it were the record.
  if (parseError) {
    return { type: "text", text: unparsedBodyError("euipo_record_fetch", { status: resp.status, parseError }, ` application_number=${params.application_number}`) };
  }
  return { type: "text", text: JSON.stringify(body, null, 2) };
}

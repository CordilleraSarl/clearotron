// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// senior-rights.mjs — "verify the right that matters" (WP-receipts, 2026-07-05 owner steer).
//
// The VENZY reference case: the lead conflict was ONE finding backed by NINE registrations of the same
// mark (Türkiye, UAE, Saudi, …). The run fetched exactly one leg — the top-scoring UAE 2015 filing —
// and the report read "verified" while the SENIOR right (the Turkish 2009 registration: earliest
// priority, the right an opponent would assert first) was never pulled. This module makes seniority a
// CODE decision from data the run already holds — zero new provider calls to identify the senior leg:
//   - rankClusterLegs: order a finding's registrations by seniority (fetched-record facts first, else
//     the register-index batch-screen facts, else the finding's own typed hints); dead legs excluded
//     (the model lists Expired legs in owner.registrations — liveness is never trusted from the list).
//   - verdictDrivingFindings: the deterministic "handful per run" that get the senior-right guarantee —
//     live findings whose band equals the WORST live band (the ones that set the delivered tier).
//     v4 (doc-50) schema runs only; archives are no-ops by construction.
//
// PURE — no I/O, no provider calls. The pipeline's senior-right closure feeds it on-disk artifacts.

import { worstBand, normalizeBand } from "./framework.mjs";

// Live per classifyStatus (plugins core): Valid / Pending / GracePeriod are live; everything else dead.
const LIVE_STATUS_RE = /^(valid|pending|registered|grace ?period|active|live)/i;
const DEAD_STATUS_RE = /^(expired|dead|cancell?ed|abandoned|withdrawn|lapsed|removed|surrendered|inactive)/i;

const norm = (u) => String(u ?? "").trim().toLowerCase();
const dateVal = (s) => {
  const t = Date.parse(String(s ?? ""));
  return Number.isFinite(t) ? t : null;
};

// Assemble the rankable facts for one leg, best source first:
//   (1) the fetched record body (REC-shaped fields), (2) the register-index `screen` block the
//   batch-screen stamped on the enumerated record, (3) the finding's own typed hints (weakest).
function legFacts(reg, indexByUri, recordsByUri) {
  const uri = norm(reg?.uri);
  const rec = uri ? recordsByUri?.get(uri) : null;
  const idx = uri ? indexByUri?.get(uri) : null;
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && String(v).trim() !== "") ?? null;
  const status = pick(rec?.statusText, rec?.status, idx?.status, reg?.status);
  const liveHint = pick(idx?.live_status);
  const applicationDate = pick(rec?.applicationDate, rec?.filingDate, idx?.applicationDate, reg?.filed);
  const registrationDate = pick(rec?.registrationDate, idx?.registrationDate);
  const live = liveHint != null
    ? String(liveHint).toLowerCase() === "live"
    : status != null
      ? (DEAD_STATUS_RE.test(String(status)) ? false : LIVE_STATUS_RE.test(String(status)) ? true : null)
      : null;
  const registered = registrationDate != null || /^(valid|registered)/i.test(String(status ?? ""));
  return {
    uri, live, registered,
    applicationDate, registrationDate,
    appTs: dateVal(applicationDate), regTs: dateVal(registrationDate),
    source: rec ? "record" : idx ? "index" : reg && (reg.status || reg.filed) ? "hint" : "none",
  };
}

/**
 * Rank a finding's registration legs by seniority. Returns { senior, ranked, excluded, unrankable }:
 *   senior     — the most important LIVE right (earliest priority; registered before pending), or null
 *   ranked     — the live legs in seniority order, each { uri, ...facts }
 *   excluded   — dead / unlivable legs (never candidates; the model's list is not trusted on liveness)
 *   unrankable — true when NO live leg carries a date from record or index: an honest state — the
 *                caller discloses instead of guessing, and never spends an extra index query on it.
 */
export function rankClusterLegs(registrations, indexByUri = new Map(), recordsByUri = new Map()) {
  const legs = (Array.isArray(registrations) ? registrations : [])
    .filter((r) => r && norm(r.uri))
    .map((r, i) => ({ order: i, reg: r, facts: legFacts(r, indexByUri, recordsByUri) }));
  const excluded = legs.filter((l) => l.facts.live === false).map((l) => ({ uri: l.facts.uri, reason: "dead" }));
  const live = legs.filter((l) => l.facts.live !== false);   // unknown liveness stays a candidate (never silently dropped)
  const dated = live.filter((l) => l.facts.appTs != null || l.facts.regTs != null);
  const rankable = dated.filter((l) => l.facts.source === "record" || l.facts.source === "index");
  const pool = rankable.length ? live.filter((l) => l.facts.appTs != null || l.facts.regTs != null) : [];
  const cmp = (a, b) =>
    Number(b.facts.registered) - Number(a.facts.registered)                                  // registered above pending
    || (a.facts.appTs ?? a.facts.regTs ?? Infinity) - (b.facts.appTs ?? b.facts.regTs ?? Infinity)  // earliest application
    || (a.facts.regTs ?? Infinity) - (b.facts.regTs ?? Infinity)                             // earliest registration
    || a.order - b.order;                                                                    // stable input order
  const ranked = [...pool].sort(cmp).map((l) => ({ uri: l.facts.uri, ...l.facts }));
  return {
    senior: ranked[0] ?? null,
    ranked,
    excluded,
    unrankable: live.length > 0 && ranked.length === 0,
  };
}

// Dispositions that keep a finding LIVE for tier derivation (withdrawn never drives a verdict) —
// mirrors findings-model's worstLiveBand filter exactly.
const DEAD_DISPOSITIONS = new Set(["withdrawn"]);

/**
 * The findings that DRIVE the delivered verdict: live, banded findings whose band equals the WORST
 * live band under the run's frozen framework manifest (worstBand — bands[0] is the most severe;
 * framework.mjs is the single authority on ordering, same helper deriveDisplayVerdict uses).
 * v4-only by construction — findings without a `band` (v≤3 archives) yield []. Common-law findings
 * with no registrations are not applicable to the senior-right guarantee (their evidence path is
 * use/marketplace, not a register record) — the caller filters on `registrations` presence.
 */
export function verdictDrivingFindings(findings, manifest) {
  if (!manifest || !Array.isArray(manifest.bands) || !manifest.bands.length) return [];
  const live = (Array.isArray(findings) ? findings : []).filter((f) =>
    f && typeof f === "object" && !DEAD_DISPOSITIONS.has(String(f.disposition ?? "")) && f.band != null && normalizeBand(manifest, f.band) != null);
  if (!live.length) return [];
  const worst = worstBand(manifest, live.map((f) => f.band));
  if (worst == null) return [];
  return live.filter((f) => normalizeBand(manifest, f.band) === worst);
}

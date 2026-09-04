// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-presence.mjs — the audit's queryable store of every live, matter-in-scope enumerated record.
//
// THE RULING THIS IMPLEMENTS (, owner 2026-08-31): "YES of course they should be in
// the audit. always. … we don't need to report on them but we need to store them." On the run this was
// measured against, 65 live records inside the matter's scope and carrying the client's own dominant
// element appeared in NO stored artifact — not the report (correct), and not the audit either (the
// defect). The band knows them; the band does not survive the purge; audit.md does (ask-ledger.mjs
// carries the sentence). So the audit stores the population, and the report stays unchanged.
//
// STORAGE, NOT REPORTING — so every filter here leans INCLUSIVE, and each lean is stated:
//   · A member state's NATIONAL right counts when the EU is in scope (the FR/DE-as-EU sensitivity the
//     issue records): it operates inside the EU-scoped market, and storing it costs nothing a client
//     sees. The converse of binding-layers' "an EUTM binds every member".
//   · US STATE registrations (provider extension office XS — guid prefix USSTI, owner_country US on
//     every measured specimen) count when the US is in scope. A storage inclusion, not a legal claim
//     about state rights; binding-layers deliberately carries no XS concept.
//   · WO rides along via bindingLayersFor: a Madrid registration can designate a scope territory, and
//     the band row does not say which designations it carries — exclusion would need evidence the row
//     cannot give.
//   · A CLASS-LESS record is included (the composites' own fail-safe direction), and an EMPTY scope —
//     worldwide, or a run that recorded none — restricts nothing.
//
// The dominant-element column uses band-shape's OWN ladder (dominantElementBasis: token-identical /
// token-edit-1 / concatenation), not a private re-derivation — the measurement's substring-vs-token
// rung question is answered by storing the basis per row, so both readings stay queryable. PURE.

import { bindingLayersFor, EU_MEMBERS } from "../binding-layers.mjs";
import { canonicalJurisdictionCode } from "../jurisdiction-codes.mjs";
import { isLiveRecord, prepareDominantElement, dominantElementBasis } from "../band-shape.mjs";

/** The US-state provider extension office code. See the header — a storage inclusion, US-scoped. */
export const US_STATE_OFFICE = "XS";

/**
 * The canonical office codes whose registrations can operate inside a matter scoped to these
 * territories — or null for "no restriction" (empty scope = worldwide = everything is in scope).
 *
 * @param {string[]|null} territories scope territories as recorded (codes or display spellings)
 * @returns {Set<string>|null}
 */
export function scopeOfficeSet(territories) {
  const list = (territories ?? []).map((t) => canonicalJurisdictionCode(t)).filter(Boolean);
  if (!list.length) return null;
  const offices = new Set();
  for (const t of list) {
    offices.add(t);
    for (const layer of bindingLayersFor(t)) offices.add(canonicalJurisdictionCode(layer.office));
    if (t === "EU") for (const m of EU_MEMBERS) offices.add(m);
    if (t === "US") offices.add(US_STATE_OFFICE);
  }
  return offices;
}

const classesOf = (r) => (Array.isArray(r?.classes) ? r.classes : r?.classes != null ? [r.classes] : [])
  .map((c) => String(c).trim()).filter(Boolean);

/** Every jurisdiction a record names, canonicalized — a row may carry one code or a list. */
const recordOffices = (r) => {
  const j = r?.jurisdictions ?? r?.office;
  const list = Array.isArray(j) ? j : [j];
  return list.map((x) => canonicalJurisdictionCode(x)).filter(Boolean);
};

/**
 * The store: one row per enumerated record that is LIVE and inside the matter's scope, whatever its
 * screen verdict — the not-owed verdicts are exactly where the measured 65 lived, so no verdict
 * filter exists here on purpose.
 *
 * @param {object} band   parsed register-named-band.json ({enumerated, crowds})
 * @param {object} opts   { dominantElement, scopeClasses, scopeTerritories }
 * @returns {{rows: object[], scope: {territories, classes, offices}, dominant_element: string|null}}
 */
export function deriveRegisterPresence(band, { dominantElement = null, scopeClasses = [], scopeTerritories = null } = {}) {
  const prep = prepareDominantElement(dominantElement);
  const offices = scopeOfficeSet(scopeTerritories);
  const classes = new Set((scopeClasses ?? []).map((c) => String(c).trim()).filter(Boolean));
  const inClass = (r) => {
    const cls = classesOf(r);
    if (!classes.size || !cls.length) return true;   // no class scope, or class-less record ⇒ include
    return cls.some((c) => classes.has(c));
  };
  const inTerritory = (r) => {
    if (!offices) return true;                       // no territorial scope recorded ⇒ include
    const offs = recordOffices(r);
    if (!offs.length) return true;                   // office-less record ⇒ include (fail-safe)
    return offs.some((o) => offices.has(o));
  };
  const rows = [];
  for (const r of Array.isArray(band?.enumerated) ? band.enumerated : []) {
    if (!isLiveRecord(r) || !inClass(r) || !inTerritory(r)) continue;
    rows.push({
      record_id: r.record_id ?? null,
      mark_text: r.mark_text ?? null,
      office: recordOffices(r).join("/") || "unknown",
      classes: classesOf(r),
      status: r.status ?? r?.screen?.status ?? null,
      owner_name: r.owner_name ?? null,
      screen_verdict: String(r?.screen?.screen_verdict ?? r?.screen_verdict ?? "") || null,
      dominant_element: prep ? dominantElementBasis(r?.mark_text, prep) : null,
      application_date: r.application_date ?? r?.screen?.application_date ?? null,
      registration_date: r.registration_date ?? r?.screen?.registration_date ?? null,
    });
  }
  rows.sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)));
  return {
    rows,
    scope: {
      territories: (scopeTerritories ?? []).map(String),
      classes: [...classes].sort(),
      offices: offices ? [...offices].sort() : null,
    },
    dominant_element: prep ? prep.dom : null,
  };
}

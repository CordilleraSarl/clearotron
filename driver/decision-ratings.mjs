// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// decision-ratings.mjs — the rating of every finding, taken from the judges' merged decisions by code.
//
// ── THE RULING THIS CARRIES OUT ──────────────────────────────────────────────────────────────────────
//
// Step 3's two judges rate each owner they carry on the client's scale (owner-judgment.mjs). The owner's
// rulings of 2026-10-01 and 2026-10-02: the ratings are merged by code — where the judges agree that is
// the rating, where they differ the higher — and synthesis does not rate again. Synthesis still writes
// each finding's placement and reads; code stamps its band. A finding is made only for an owner the
// judges carried, and a rated owner is never placed as awareness only, which carries no band. The
// overall rating is the judges' overall, merged the same way, and a run records when it differs from the
// worst finding it delivers.
//
// ── HOW A FINDING IS JOINED TO WHAT THE JUDGES CARRIED ───────────────────────────────────────────────
//
// By its owner, three ways, any one enough: a registration the finding names is a record a carried
// decision cites; the finding's source link is a web address a carried decision cites; or the finding's
// owner is an owner a carried decision names, by the step's own owner rule (owner-judgment.mjs,
// `sameOwner`). The owner is the ruling's word, and it is the join that holds: measured on 44 saved runs,
// 13 of 51 common-law findings cite a page the saved web results do not hold, so a link alone would
// refuse a finding about an owner the judges did carry.
//
// PURE throughout: the findings document, the decisions and the client's scale come in; the stamped
// document and what was refused or noticed come out.

import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { ownerKey } from "./owner-table.mjs";
import { sameOwner } from "./owner-judgment.mjs";
import { bandIndex, normalizeBand } from "./framework.mjs";

/** A record id as both sides spell it, or "" for none. */
const recordKey = (id) => String(normalizeRecordUri(String(id ?? "").trim()) ?? id ?? "").trim().toLowerCase();

/** A web address with its scheme and host in one case and no trailing slash, or "" for none. */
export function webKey(url) {
  const s = String(url ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch { return s.replace(/\/+$/, ""); }
}

/**
 * The one rating several judges' ratings make: where they agree, that rating; where they differ, the
 * higher on the client's scale (the scale lists its bands highest first). Ratings that are not a band of
 * the scale are not counted. Null when none is.
 */
export function mergedRating(ratings, manifest) {
  const bands = (Array.isArray(ratings) ? ratings : [])
    .map((r) => (manifest ? normalizeBand(manifest, r) : String(r ?? "").trim() || null))
    .filter(Boolean);
  if (!bands.length) return null;
  if (!manifest) return new Set(bands).size === 1 ? bands[0] : null;
  return bands.reduce((hi, b) => (bandIndex(manifest, b) < bandIndex(manifest, hi) ? b : hi));
}

/** The judges' overall rating for the mark, merged the same way. Null when no judge gave one. */
export function mergedOverall(decisions, manifest) {
  return mergedRating((decisions?.overall_ratings ?? []).map((o) => o?.rating), manifest);
}

const groupsOf = (decisions, manifest) => (Array.isArray(decisions?.carried) ? decisions.carried : []).map((g) => ({
  rating: mergedRating((g.ratings ?? []).map((r) => r?.rating), manifest),
  records: new Set((g.records ?? []).map(recordKey).filter(Boolean)),
  web: new Set((g.web ?? []).map(webKey).filter(Boolean)),
  owners: [...(g.owners ?? []), ...(g.owners_in_the_pile ?? []).map((o) => o?.owner)].map((o) => ownerKey(o)).filter(Boolean),
}));

/**
 * Stamp each finding's band from the decisions. A withdrawn finding is left as it is: it renders nowhere.
 *
 * Returns `{ doc, refusals, notices }`. `refusals` are the token-first reasons the call is refused for,
 * one per finding: a finding no carried owner matches, and a rated owner placed "off-field". `notices`
 * record each finding whose two record-based reads both read "low" under a stamped band — counted per
 * run, never refused. The stamped band replaces whatever band the call carried, and a band declaration
 * (`borderline_between`) leaves with it: the rating is the judges', so there is nothing left to declare.
 */
export function stampDecidedRatings(doc, decisions, manifest) {
  const groups = groupsOf(decisions, manifest);
  const refusals = [];
  const notices = [];
  const findings = (Array.isArray(doc?.findings) ? doc.findings : []).map((f) => {
    if (!f || typeof f !== "object" || f.disposition === "withdrawn") return f;
    const regs = (Array.isArray(f.owner?.registrations) ? f.owner.registrations : []).map((r) => recordKey(r?.uri)).filter(Boolean);
    const link = webKey(f.source?.resolved_link);
    const name = ownerKey(f.owner?.name);
    const hit = groups.filter((g) => regs.some((k) => g.records.has(k)) || (link && g.web.has(link))
      || (name && g.owners.some((o) => sameOwner(o, name))));
    if (!hit.length) {
      refusals.push(`synthesis_finding_not_carried:${f.ordinal} — no owner the judges carried is this finding's, by its registrations, its source link or its owner's name (owner-decisions.json)`);
      return f;
    }
    const band = mergedRating(hit.map((g) => g.rating), manifest);
    if (f.disposition === "off-field") {
      refusals.push(`synthesis_placement_contradicts_rating:${f.ordinal} — the judges rated this owner ${band}, and a rated owner is not placed "off-field"`);
      return f;
    }
    if (f.meters?.mark_similarity?.token === "low" && f.meters?.goods_proximity?.token === "low") {
      notices.push({ ordinal: f.ordinal, kind: "reads-both-low", band });
    }
    const out = { ...f, band };
    delete out.borderline_between;
    return out;
  });
  return { doc: { ...doc, findings }, refusals, notices };
}

/**
 * The judges' reason for every record of an owner they set aside, for the report's "also considered" list
 * (owner, 2026-10-02: a set-aside owner appears there with the judges' reason). Where both judges set the
 * owner aside, the reason is the lower-numbered judge's, so the list carries one reason and the same one
 * on every publish. Record ids are keyed as both sides spell them. PURE.
 */
export function setAsideReasons(decisions) {
  const out = new Map();
  for (const g of Array.isArray(decisions?.set_aside) ? decisions.set_aside : []) {
    const said = (Array.isArray(g?.decisions) ? g.decisions : [])
      .filter((d) => String(d?.reason ?? "").trim())
      .sort((a, b) => (Number(a?.judge) || 0) - (Number(b?.judge) || 0))[0];
    if (!said) continue;
    const reason = String(said.reason).replace(/\s+/g, " ").trim();
    for (const id of Array.isArray(g?.records) ? g.records : []) {
      const k = recordKey(id);
      if (k && !out.has(k)) out.set(k, reason);
    }
  }
  return out;
}

/** A record id as the "also considered" list and the decisions both key it. */
export const setAsideKey = recordKey;

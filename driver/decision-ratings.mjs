// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// decision-ratings.mjs — the rating of every finding, taken from the judges' merged decisions by code.
//
// ── THE RULING THIS CARRIES OUT ──────────────────────────────────────────────────────────────────────
//
// Step 3's two judges rate each owner they carry on the client's scale, and read how alike the marks are
// and how close the goods are (owner-judgment.mjs). The owner's rulings of 2026-10-01 and 2026-10-02: the
// ratings are merged by code — where the judges agree that is the rating, where they differ the higher —
// and synthesis does not rate again; the two reads of the records come from the same judge as the
// rating, so a finding's rating and reads are one judge's and no rule has to keep them consistent.
// Synthesis still writes each finding's placement and its two research reads (whether the owner uses the
// mark, how hard it enforces), which never move the rating; code stamps the band and the two record reads.
// A finding is made only for an owner the judges carried, and a rated owner is never placed as awareness
// only, which carries no band — the one contradiction code refuses. The overall rating is the judges'
// overall, merged the same way, and a run records when it differs from the worst finding it delivers.
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
// ── WHOSE READS ──────────────────────────────────────────────────────────────────────────────────────
//
// The reads come with the rating they were given with: from the judge whose rating became the rating, and
// where several gave that rating, from the lowest-numbered of them — the rule the "also considered" reason
// keeps. Taking each read at its own highest would give a pair of reads no judge gave. They reach the card
// as the meter words the report already prints, and as a read rather than a fact taken from a source.
// Decisions written before the judges were asked for reads carry none; such a finding keeps the reads its
// writer gave, as a run with no decisions keeps its band.
//
// PURE throughout: the findings document, the decisions and the client's scale come in; the stamped
// document and what was refused come out.

import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { ownerKey } from "./owner-table.mjs";
import { sameOwner } from "./owner-judgment.mjs";
import { bandIndex, normalizeBand } from "./framework.mjs";
import { checkRatingInputs } from "./framework-method.mjs";

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

/** The meter word each read reaches the card as: the words the report already prints. */
export const MARKS_ALIKE_METER = Object.freeze({ same: "high", close: "medium", different: "low" });
export const GOODS_CLOSE_METER = Object.freeze({ same: "high", overlapping: "medium", different: "low" });

/**
 * WHERE THE DOT SITS ON THE RISK CHART: the same two reads, drawn on a grid of nine positions, the centre
 * of each third of each axis (owner, 2026-10-02). The chart is the card's two meters drawn finer, so it is
 * placed from them: a dot can never sit in one third while the card's meter says another. x is how close
 * the goods are, y how alike the marks are, as the chart reads them.
 */
export const GRID_POSITION = Object.freeze({ low: 0.167, medium: 0.5, high: 0.833 });

const groupsOf = (decisions, manifest) => (Array.isArray(decisions?.carried) ? decisions.carried : []).map((g) => ({
  rating: mergedRating((g.ratings ?? []).map((r) => r?.rating), manifest),
  given: (g.ratings ?? []).filter((r) => r && typeof r === "object"),
  records: new Set((g.records ?? []).map(recordKey).filter(Boolean)),
  web: new Set((g.web ?? []).map(webKey).filter(Boolean)),
  owners: [...(g.owners ?? []), ...(g.owners_in_the_pile ?? []).map((o) => o?.owner)].map((o) => ownerKey(o)).filter(Boolean),
}));

/**
 * The two reads that go with a rating: those of the judge who gave `band`, the lowest-numbered where
 * several did, as meter words. Null when that judge gave no reads (decisions from before the reads).
 */
export function readsForRating(given, band, manifest) {
  const same = (r) => (manifest ? normalizeBand(manifest, r?.rating) : String(r?.rating ?? "").trim()) === band;
  const from = given.filter(same).sort((a, b) => (Number(a?.judge) || 0) - (Number(b?.judge) || 0))[0];
  const marks = MARKS_ALIKE_METER[String(from?.marks_alike ?? "").trim()];
  const goods = GOODS_CLOSE_METER[String(from?.goods_close ?? "").trim()];
  return marks && goods ? { mark_similarity: marks, goods_proximity: goods } : null;
}

/**
 * Stamp each finding's band, and its two record reads, from the decisions. A withdrawn finding is left as
 * it is: it renders nowhere.
 *
 * Returns `{ doc, refusals }`. `refusals` are the token-first reasons the call is refused for, one per
 * finding: a finding no carried owner matches, and a rated owner placed "off-field". The stamped band
 * replaces whatever band the call carried, and a band declaration (`borderline_between`) leaves with it:
 * the rating is the judges', so there is nothing left to declare. The two record meters, and the dot on the
 * risk chart that draws them, are replaced the same way; the use and enforcement meters stay as the call
 * wrote them.
 */
export function stampDecidedRatings(doc, decisions, manifest, method = null) {
  const groups = groupsOf(decisions, manifest);
  const refusals = [];
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
    const out = { ...f, band };
    delete out.borderline_between;
    // THE INPUTS ARE THE JUDGES' TOO (design, 2026-10-02). On a framework that states a method they come
    // from the judge whose rating was taken, as the two reads do, written as the framework writes them; the
    // answer check already held that band to the table. Synthesis never rates, so inputs it sent leave.
    delete out.inputs;
    if (method) {
      const given = inputsForRating(hit.flatMap((g) => g.given), band, manifest);
      const r = given ? checkRatingInputs(method, { inputs: given, band, rated: true }) : null;
      if (r?.inputs && !r.issue) out.inputs = r.inputs;
    }
    const reads = readsForRating(hit.flatMap((g) => g.given), band, manifest);
    if (reads) {
      out.meters = { ...(f.meters && typeof f.meters === "object" ? f.meters : {}),
        mark_similarity: { token: reads.mark_similarity, basis: "inferred-from-signal" },
        goods_proximity: { token: reads.goods_proximity, basis: "inferred-from-signal" } };
      out.quadrant = { x: GRID_POSITION[reads.goods_proximity], y: GRID_POSITION[reads.mark_similarity] };
    }
    return out;
  });
  return { doc: { ...doc, findings }, refusals };
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

/**
 * The framework's inputs that go with a rating: those of the judge who gave `band`, the lowest-numbered
 * where several did, as that judge gave them. Null when that judge gave none (no method, or decisions from
 * before the judges rated through one).
 */
export function inputsForRating(given, band, manifest) {
  const same = (r) => (manifest ? normalizeBand(manifest, r?.rating) : String(r?.rating ?? "").trim()) === band;
  const from = given.filter(same).sort((a, b) => (Number(a?.judge) || 0) - (Number(b?.judge) || 0))[0];
  return from?.inputs && typeof from.inputs === "object" && !Array.isArray(from.inputs) ? from.inputs : null;
}

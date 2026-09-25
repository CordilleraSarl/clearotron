// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// placement-form.mjs — the driver-written placement form, the third of its kind.
//
// THE DEFECT. `placement-inquiry` was the largest stage on all four of the 2026-08-09 round's delivered
// clearances, and on R1 half of its 62 minutes was thrown away:
//
//     att1  wall 1860.664  budget 1800  timeout  hardWall  wrote:true  quiescentMs 371177  rescued:null
//     att2  wall 1844.05   budget 2700  ok
//
// Attempt 1 had written a complete, valid `placement-recommendations.md` and lain quiescent for 371
// seconds against a 60-second bar. The wall rescue looked and REFUSED, because `validators.placement`
// fails `placementmodel_missing` while the structured sibling `placements.json` is absent — and the seat
// wrote the prose first (on disk that run: md at 09:08:58, json at 09:15:50, by attempt 2). The kill
// landed in the gap between the two files, so 31 minutes of finished work were discarded and re-derived
// from scratch. Raising the wall (`638f885`) made that less likely; it did not make finished work
// survivable, and this does.
//
// THE CURE IS AUTHORSHIP, NOT A GUARD. The seat stops writing `placements.json`. The driver renders it
// from a FORM the seat fills, and an accumulator holds every answer across attempts, parks and process
// restarts — exactly as the disposition union and the coverage union already do for their seats.
// A killed attempt then keeps every tier it had already placed.
//
// THE ROW SOURCE IS SELECTION-BY-REFERENCE, and it was settled by measurement, not by design taste. The
// first cut pre-wrote one row per band-shape floor record. Joined against four archived runs, that is the
// wrong population in BOTH directions (R1: 82 placed vs 251 floors; R2: 79 vs 66). The measurement that
// settled it — placed entries joined to `_driver/register-positions.json` — came back unambiguous:
//
//     every register candidate the seat has ever placed is a FOLD POSITION. Zero were floor-only.
//     Zero were outside both. And the fold is 5-55x larger than the placed set.
//
// So neither end works: floors are the wrong set, and 3,489 pre-written rows for 82 placements is not a
// form. What the data dictates is the split this module implements —
//
//     the SEAT selects   — it names the record/position ids worth tiering. That selection IS the judgment.
//     the DRIVER fills   — mark, owner, records, territories, classes, machine-copied from the fold,
//                          never re-typed, so a transcription slip cannot reach a client deliverable.
//     the SEAT judges    — tier, reason, borderline, and nothing else.
//
// Selecting ANY record of a position selects the whole position: a Madrid family is one candidate, which
// is the unit a tier decision is actually about. The seat already does this by hand — 193 of 397 archived
// placement entries carry more than one record — so this moves the copying, not the judgement.
//
// A SELECTION IS STICKY. A settled row can be RE-TIERED by a later pass (a submitted row that the gate
// accepts wins) but it cannot be un-selected by silence, because silence is what a killed attempt
// produces and honouring it would destroy the exact work this module exists to save.
//
// PURE — no node imports, so it tests offline. The io edge is placement-form-io.mjs.
//
// ONE CALCULATION, NEVER TWO. `normKey` comes from placement-diff.mjs (the cross-run join already
// defines mark/owner folding), `normalizeRecordUri` from registry-fidelity.mjs (the same canonicaliser
// placement-carry joins on), `validatePlacement` and `PLACEMENT_TIERS` from placement-model.mjs (the same
// parser the gate and every downstream consumer read the rendered file with). This module mints an id
// shape and a row set and nothing else.

import { shortId } from "./connotation-search.mjs";
import { normKey } from "./placement-diff.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { PLACEMENT_TIERS, validatePlacement } from "./placement-model.mjs";

export const PLACEMENT_FORM_NAME = "placement-form.json";

/** The driver's own copy sits beside the seat's, in `_driver/`. PURE string work. */
export const placementFormSidecarName = (formName = PLACEMENT_FORM_NAME) => `${formName.replace(/\.json$/, "")}.form.json`;

// The three fields that are JUDGMENT. Everything else on a row is the driver's, machine-copied from the
// fold on every pass, so a seat that rewrites them changes nothing about what it is judged on.
export const seatFields = (row) => ({
  tier: typeof row?.tier === "string" ? row.tier.trim() : null,
  reason: typeof row?.reason === "string" ? row.reason.trim() : null,
  borderline: row?.borderline === true ? true : null,
});

// What a row the SEAT adds owes. Carried as DATA of the file, on every pass — not as prose about it, and
// not only on the pre-dispatch build, or it would be missing from precisely the file a corrective attempt
// opens ( learned that one).
export const SEAT_ROW_FIELDS = ["kind", "mark", "owner", "jurisdiction", "records", "tier", "reason"];
export const SEAT_ROW_CONTRACT = Object.freeze({
  when: "a candidate the register band does not hold — a common-law name the marketplace sweep surfaced, "
    + "an owner you know of that no record names. There is nothing on disk for you to select, so you "
    + "write the whole row.",
  fields: SEAT_ROW_FIELDS,
  kind: "seat",
  records: "[] for a common-law candidate — an empty list is correct and expected, never a gap to fill.",
  tier: PLACEMENT_TIERS,
  note: "A row you add and do not hand back on a later pass is RETRACTED. That is the only way to un-place "
    + "a candidate, so it is deliberate — but it means a pass that rewrites this file must carry forward "
    + "the rows it still stands behind. A SELECTED register row is the opposite and cannot be retracted "
    + "by silence: re-tier it if you have changed your mind.",
});

// What a row the SEAT SELECTS owes. Three keys, and the driver fills everything else.
export const SELECT_ROW_FIELDS = ["select", "tier", "reason"];
export const SELECT_ROW_CONTRACT = Object.freeze({
  when: "every register candidate you are placing. Name ONE record id it holds — the driver resolves it "
    + "to the whole position (a mark held across several territories is ONE candidate) and fills the "
    + "mark, owner, records, territories and classes from the register's own projection.",
  fields: SELECT_ROW_FIELDS,
  select: "a record id from the band — e.g. \"/mark/us/USAFI…\". Any record of a family selects the family.",
  tier: PLACEMENT_TIERS,
  do_not: "Do NOT re-type mark, owner or records on a selected row. They are machine-copied, and anything "
    + "you write in them is ignored — which is the point: a transcription slip cannot reach the client.",
  unresolved: "A `select` the band does not hold is reported back to you by id, never silently dropped.",
});

// ONE GROUND PER OWNER'S SET (ruled 2026-09-25, sentence 6: "Judge an owner's records as a set. … A record
// you do not carry is given a ground; no record leaves without one."). The form had rows for what is
// placed and nothing for what is not, so every record the step passed over left with "no ground for this
// record was recorded", hundreds of owners a run. This row gives an owner's records that are not placed
// one ground. It is not a candidate, it renders into no placement, and nothing bounds how many there are.
export const SET_ASIDE_ROW_FIELDS = ["set_aside", "ground"];
export const SET_ASIDE_ROW_CONTRACT = Object.freeze({
  when: "an owner whose records you judge as a set and do not carry. A record you do not carry is given a "
    + "ground; no record leaves without one. One row gives that owner's set its ground.",
  fields: SET_ASIDE_ROW_FIELDS,
  set_aside: "one record id of that owner, from the band. The driver finds the owner on the register's own "
    + "projection; the ground covers every record of that owner the form does not place. A record that names "
    + "no owner stands for its own position only.",
  ground: "why this owner's records are not carried, in a lawyer's words.",
  not_a_candidate: "It places nothing and has no bound. A record of the same owner you do place stays placed.",
  latest: "A later row for the same owner replaces the earlier ground. To remove one, hand back "
    + "{\"retract\":\"<its set_aside id>\"}.",
  unresolved: "A `set_aside` the band does not hold, or one with no ground, is reported back to you by id.",
});

/** Is this submitted row an owner's set-aside? PURE. */
export const isSetAsideRow = (row) => typeof row?.set_aside === "string" && row.set_aside.trim() !== "";

/**
 * The set a set-aside covers, keyed off the register's own projection: the owner, folded as the cross-run
 * join folds it. A record that names no owner is its own position, never one set with every other
 * ownerless record, or one ground would silently cover them all. PURE.
 */
export function setAsideKey(canonical) {
  if (!canonical) return null;
  const owner = normKey(canonical.owner);
  return owner ? `owner:${owner}` : `position:${formRowKey(canonical)}`;
}

/**
 * The ground a record leaves the picking step with, if its owner's set was set aside: record uri →
 * {set_aside, owner, ground} or null. Resolved through the same selection index a `select` resolves
 * through, so the owner is read one way at both ends. PURE; never throws.
 */
export function setAsideGrounds(entries, index) {
  const byKey = new Map();
  for (const e of Array.isArray(entries) ? entries : []) if (e?.key && e?.ground) byKey.set(e.key, e);
  return (uri) => {
    if (!byKey.size || !index?.resolve) return null;
    return byKey.get(setAsideKey(index.resolve(uri))) ?? null;
  };
}

const PROVENANCE = "driver-written form. You SELECT and you JUDGE; the driver COPIES. For each "
  + "register candidate you are placing, add a row naming one of its record ids in `select` plus your "
  + "`tier` and `reason` (and `borderline` if the call is close) — the driver resolves the id against the "
  + "register's own exact-identity fold and fills mark, owner, records, territories and classes from it, "
  + "so a family held across territories becomes ONE candidate and nothing is re-typed. The driver renders "
  + "`placements.json` from your answers — DO NOT WRITE THAT FILE. Tiers accumulate across attempts: a row "
  + "you tier once stays tiered even if a later attempt never sees it, which is what makes a killed "
  + "attempt's work survive. Candidates the register does not hold are yours to write in full — see "
  + "`seat_row_contract`. An owner whose records you judge as a set and do not carry gets one ground for "
  + "the set — see `set_aside_row_contract`.";

/** A row's identity, for matching a submission against the driver's regenerated set. PURE. */
export function formRowKey(row) {
  if (row?.kind === "seat")
    return `seat:${normKey(row?.mark)}|${normKey(row?.owner)}|${normKey(row?.jurisdiction)}`;
  const uris = (Array.isArray(row?.records) ? row.records : []).map((u) => normalizeRecordUri(u) || String(u ?? "")).sort();
  return `register:${uris.join(",")}`;
}

/**
 * Is this row settled — i.e. would the rendered entry survive the parser the gate and every downstream
 * consumer read `placements.json` with?
 *
 * DRIVER FACTS COME FROM `canonical`, never from the submitted row. A seat that rewrote `records` or
 * `owner` on its copy cannot widen what binds; only its three judgment fields are read from `row`.
 * That is the discipline and it is the reason the union cannot be talked into anything.
 * PURE; never throws.
 */
export function rowIsSettled(row, canonical) {
  try {
    validatePlacement(renderEntry(canonical ?? row, row), 0);
    return true;
  } catch { return false; }
}

/** The `placements.json` entry a settled row renders to. Driver facts from `canonical`, judgment from `row`. */
export function renderEntry(canonical, row) {
  const f = seatFields(row ?? {});
  const e = {
    mark: canonical?.mark ?? null,
    owner: canonical?.owner ?? null,
    jurisdiction: canonical?.jurisdiction ?? "",
    records: Array.isArray(canonical?.records) ? canonical.records : [],
    tier: f.tier,
    reason: f.reason,
  };
  if (f.borderline === true) e.borderline = true;
  return e;
}

/**
 * The `{schema_version, placements}` document, rendered from the settled rows. Driver rows first in their
 * deterministic band order, then seat rows. Unsettled rows are OMITTED rather than emitted half-formed —
 * a half-formed entry would fail the parser and take the whole file with it.
 * PURE — returns the object; the io edge stringifies and re-parses it before it lands.
 */
export function renderPlacementsJson(rows) {
  const list = Array.isArray(rows) ? rows : (rows?.rows ?? []);
  const settled = list.filter((r) => rowIsSettled(r, r));
  return { schema_version: 1, placements: settled.map((r) => renderEntry(r, r)) };
}

/**
 * The rows the render OMITTED — selected, but not yet carrying a tier the parser would accept.
 *
 * The issue asked what an untiered row should do, and the answer the measurement gave is "be counted".
 * `renderPlacementsJson` drops them, which on its own is the silent-vanish the issue named; this is the
 * other half. It is deliberately NOT a key on `placements.json`: that file's shape is a contract four
 * consumers read, and 397 archived entries carry exactly {mark, owner, jurisdiction, records, tier,
 * reason, borderline?}. The count belongs on the FORM and in the run record, where a reader looking for
 * omissions is already looking. PURE.
 */
export function omittedFromRender(rows) {
  const list = Array.isArray(rows) ? rows : (rows?.rows ?? []);
  return list.filter((r) => !rowIsSettled(r, r))
    .map((r) => ({ row_id: r?.row_id ?? null, kind: r?.kind ?? null, select: selectionOf(r), mark: r?.mark ?? null,
      missing: [!seatFields(r).tier ? "tier" : null, !seatFields(r).reason ? "reason" : null].filter(Boolean),
      // WHY, in the parser's own token. `missing` names only the two judgement fields, so a row refused on a
      // fact the DRIVER copies — an owner the register never supplied — read as an omission with no cause
      // at all, `missing: []`. That is how 141 tiered rows sat outstanding for a day with nobody able to say
      // why: the answer was one parser call away and nothing made it.
      cause: seatRefusal(r) ?? registerFactRefusal(r),
      owed_by: seatRefusal(r) ? "seat" : "register" }));
}

// The parser tokens that speak about a fact the driver COPIES onto a register row — mark, owner,
// jurisdiction, records all come from the canonical row (renderEntry), never from the seat. On a SEAT row the
// same four are the seat's own writing.
const REGISTER_FACT_TOKENS = new Set(["placement_mark_missing", "placement_owner_missing",
  "placement_jurisdiction_invalid", "placement_records_invalid"]);
const tokenOf = (e) => String(e?.message ?? e).split(/[:=\s(]/)[0] || "placement_invalid";
// Stand-ins that every driver-fact check accepts, so a check of the JUDGEMENT alone cannot be refused on a
// driver fact. They never reach a rendered file: this is a probe of the parser, not an entry.
const FACTS_PRESENT = Object.freeze({ mark: "-", owner: "-", jurisdiction: "", records: [] });

/**
 * The seat's part of a row, refused — or null when the seat has done its part. On a register row that is
 * the judgement alone (tier, reason, borderline), probed with the driver's facts stood in; on a seat row it
 * is the whole row, because the seat wrote all of it. PURE; never throws.
 */
export function seatRefusal(row) {
  try {
    validatePlacement(renderEntry(row?.kind === "register" ? FACTS_PRESENT : row, row), 0);
    return null;
  } catch (e) { return tokenOf(e); }
}

/**
 * The register's part of a register row, refused — or null. A fact the register did not supply (no owner on
 * the record) is not something a corrective turn can repair: the seat is told not to type these fields and
 * anything it types is ignored. Null on a seat row. PURE; never throws.
 */
export function registerFactRefusal(row) {
  if (row?.kind !== "register") return null;
  try {
    validatePlacement(renderEntry(row, { tier: PLACEMENT_TIERS[0], reason: "register fact probe" }), 0);
    return null;
  } catch (e) { const t = tokenOf(e); return REGISTER_FACT_TOKENS.has(t) ? t : null; }
}

/**
 * What a placement pass recorded, split by who owes each gap. The gate reads this; so does the run record.
 *
 *   unjudged            rows whose seat part the parser refuses — the seat owes them, a corrective turn can
 *                       repair them, and a pass that leaves any is not a completed pass.
 *   register_selected   register candidates the seat selected.
 *   register_rendered   of those, how many reach placements.json.
 *   register_facts      rows judged by the seat and still refused on a fact the register did not supply,
 *                       counted by cause. A register that publishes no owner for a record is a real and
 *                       ordinary case (measured: single records at offices that do not publish one), so a
 *                       handful are recorded, not refused.
 *
 * `register_selected > 0 && register_rendered === 0` is the other refusal: a pass that tiered register
 * candidates and delivered none of them has not made a judgement about the register, it has lost one. That
 * is the shape of a register whose rows reach the fold without a field every placement needs. PURE.
 */
export function placementRenderAccount(rows) {
  const list = Array.isArray(rows) ? rows : (rows?.rows ?? []);
  const unjudged = [];
  const registerFacts = {};
  let registerSelected = 0, registerRendered = 0;
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const isRegister = r.kind === "register";
    if (isRegister) registerSelected += 1;
    const seat = seatRefusal(r);
    if (seat) { unjudged.push({ row_id: r.row_id ?? null, kind: r.kind ?? null, select: selectionOf(r), cause: seat }); continue; }
    if (!isRegister) continue;
    if (rowIsSettled(r, r)) { registerRendered += 1; continue; }
    const cause = registerFactRefusal(r) ?? "placement_invalid";
    registerFacts[cause] = (registerFacts[cause] ?? 0) + 1;
  }
  return { unjudged, register_selected: registerSelected, register_rendered: registerRendered, register_facts: registerFacts };
}

/**
 * The resolution index: every record uri the fold knows, mapped to the CANONICAL row it belongs to.
 *
 * Positions first, floor records second — a floor record a position already covers must resolve to the
 * POSITION, or selecting it would mint a one-record duplicate of a candidate the fold already folded.
 *
 * NEVER THE RAW BAND. This is rebuilt on every judgement inside the dispatch loop of the largest stage in
 * the run, and the merged band is megabytes. It reads only the two small projections the band derivation
 * already writes and that the digest and recall-reconciliation already join on.
 * PURE; never throws.
 */
export function buildSelectionIndex({ floors = null, positions = null } = {}) {
  const floorList = Array.isArray(floors) ? floors : [];
  const posList = Array.isArray(positions) ? positions : [];
  const byUri = new Map();
  const put = (uri, row) => {
    const n = normalizeRecordUri(uri) || String(uri ?? "");
    if (n && !byUri.has(n)) byUri.set(n, row);
  };
  const mkRow = (mark, owner, records, extra) => {
    const uris = [...new Set(records.filter(Boolean).map(String))].sort();
    const key = `register:${uris.map((u) => normalizeRecordUri(u) || u).sort().join(",")}`;
    return {
      row_id: shortId("PR", key), kind: "register",
      mark: mark ?? null, owner: owner ?? null,
      jurisdiction: (extra.territories ?? []).join(", "),
      records: uris, ...extra, tier: null, reason: null, borderline: null,
    };
  };
  for (const pos of posList) {
    const recs = (Array.isArray(pos?.records) ? pos.records : []).map(String).filter(Boolean);
    if (!recs.length) continue;
    const row = mkRow(pos?.mark_text,
      (Array.isArray(pos?.owners) ? pos.owners : [])[0] ?? (Array.isArray(pos?.owner_strings) ? pos.owner_strings : [])[0],
      recs, { classes: Array.isArray(pos?.classes) ? pos.classes : [], territories: Array.isArray(pos?.territories) ? pos.territories : [] });
    for (const r of recs) put(r, row);
  }
  // A floor record no position covers still resolves. The positions fold is best-effort inside the band
  // shape's own best-effort (`register-positions-failed` is a non-fatal event), and a candidate must not
  // become unselectable because a projection did not run.
  for (const f of floorList) {
    const id = String(f?.record_id ?? "");
    if (!id) continue;
    const n = normalizeRecordUri(id) || id;
    if (byUri.has(n)) continue;
    put(id, mkRow(f?.mark_text, f?.owner_name, [id],
      { classes: Array.isArray(f?.classes) ? f.classes : [], territories: [], from_floor_only: true }));
  }
  return {
    resolve: (uri) => byUri.get(normalizeRecordUri(uri) || String(uri ?? "")) ?? null,
    derived_from: {
      floor_records: floorList.length,
      positions: posList.length,
      selectable_records: byUri.size,
      // An ABSENCE is recorded in the artifact rather than swallowed — the rule. "no floors" and "the
      // band shape would not parse" are different facts and must not read alike.
      floors_unreadable: floors === null,
      positions_unreadable: positions === null,
    },
  };
}

/** What a submitted row is selecting: its own `select`, else any record it names. PURE. */
export function selectionOf(row) {
  const s = typeof row?.select === "string" ? row.select.trim() : "";
  if (s) return s;
  const rec = (Array.isArray(row?.records) ? row.records : []).find((u) => typeof u === "string" && u.trim());
  return rec ? rec.trim() : null;
}

/**
 * Rows the SEAT added, from a submitted list, minus any colliding with a driver key.
 *
 * A COLLISION FOLDS, IT DOES NOT DROP — and this is where placement diverges from coverage. A coverage
 * seat row "carries no identifier anything joins on", so dropping a colliding one loses nothing. A
 * placement seat row carries `records[]`, and placement-carry / record-carry join on those URIs, so
 * dropping one would delete a judgment. The union folds a colliding row's seat fields onto the driver row
 * it collides with; this function returns only the rows that are genuinely the seat's own.
 * PURE.
 */
export function seatRows(rows, driverKeys) {
  const list = Array.isArray(rows) ? rows : (rows?.rows ?? []);
  const out = [];
  const seen = new Set();
  for (const r of list) {
    if (!r || typeof r !== "object" || r.kind === "register") continue;
    const key = formRowKey({ ...r, kind: "seat" });
    if (driverKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    const f = seatFields(r);
    out.push({
      row_id: shortId("PS", key),
      kind: "seat",
      mark: typeof r.mark === "string" ? r.mark : null,
      owner: typeof r.owner === "string" ? r.owner : null,
      jurisdiction: typeof r.jurisdiction === "string" ? r.jurisdiction : "",
      records: (Array.isArray(r.records) ? r.records : []).filter((u) => typeof u === "string" && u.trim()),
      tier: f.tier, reason: f.reason, borderline: f.borderline,
    });
  }
  return out;
}

/** Parse a submitted form. Three states — see verify.mjs; absent, damaged and empty are not one fact. */
export function parsePlacementForm(raw) {
  let doc;
  try { doc = JSON.parse(String(raw ?? "")); }
  catch (e) { return { rows: null, error: `is not valid JSON (${String(e?.message ?? e).slice(0, 80)})` }; }
  const rows = Array.isArray(doc) ? doc : doc?.rows;
  if (!Array.isArray(rows)) return { rows: null, error: "carries no rows[] array" };
  return { rows, set_aside: Array.isArray(doc?.set_aside) ? doc.set_aside : [], error: null };
}

/**
 * The form the driver hands the seat before it dispatches. It carries the two contracts and the fold's
 * own numbers, and NO rows — under selection-by-reference a row exists only because the seat selected it.
 *
 * That is the whole answer to the issue's second question. There is no pre-written row to leave untiered,
 * so an untiered row can only be one the seat selected and did not finish — which is the union's job, and
 * which `omittedFromRender` counts. PURE.
 */
export function buildPlacementForm(input) {
  const { derived_from } = buildSelectionIndex(input);
  return { _provenance: PROVENANCE, select_row_contract: SELECT_ROW_CONTRACT,
    seat_row_contract: SEAT_ROW_CONTRACT, set_aside_row_contract: SET_ASIDE_ROW_CONTRACT, generated_from: derived_from, rows: [] };
}

export { PROVENANCE as PLACEMENT_FORM_PROVENANCE };

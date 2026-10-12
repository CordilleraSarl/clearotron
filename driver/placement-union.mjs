// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// placement-union.mjs — the placement form's accumulator, sibling of coverage-union.mjs
// and disposition-union.mjs.
//
// THIS IS THE PART THAT CURES THE DEFECT. `placement-inquiry` is re-dispatched from the main path, the
// stale-repair path and the frame-reopen path, and its hard-wall retry is a cold 1.5x re-derivation. On
// R1 2026-08-09 the first attempt wrote a complete artifact, lay quiescent for 371 seconds, was killed at
// its wall and was DISCARDED — 31 minutes of finished tiers re-derived from nothing. A ladder cannot fix
// that. What fixes it is that the driver, which never forgets, holds the answers: a tier placed on
// attempt 1 cannot be lost on attempt 2, so the outstanding count falls monotonically by construction
// rather than by the next turn behaving well.
//
// PURE functions. It reads placement-form.mjs and that module never reads this one, so the import runs ONE
// WAY and there is no second opinion about what a settled row is. It counts floors with floor-duty.mjs's own
// reconcile, the one the floor duty counts with, so the form and the duty cannot disagree about a floor. This file mints no row, no id
// and no definition of "settled": `buildSelectionIndex` and `rowIsSettled` both come from the module the
// GATE judges with.
//
// WHAT THE CANONICAL SET IS, under selection-by-reference. It is not the band and it is not the floor: it
// is every selection the run has SEEN — the prior accumulator's plus this submission's — each resolved
// against the fold. That makes the set grow monotonically and never shrink, which is the cure stated as
// an invariant: a candidate selected on attempt 1 is still a row on attempt 2 even if attempt 2 was
// killed before it mentioned anything.

import { buildSelectionIndex, selectionOf, rowIsSettled, seatFields, formRowKey, seatRows,
  SEAT_ROW_CONTRACT, SELECT_ROW_CONTRACT, PLACEMENT_FORM_PROVENANCE,
  SET_ASIDE_ROW_CONTRACT, isSetAsideRow,
  SET_ASIDE_GROUP_CONTRACT, isSetAsideGroupRow, groupName, groupOfKeys, namedKey, lineKey, servedLines,
  groupRowCoversFloors, FLOOR_GROUND_ON, FLOOR_GROUND_REFUSED, ROW_GROUPS, renderPlacementsJson, setAsideGrounds } from "./placement-form.mjs";
import { groupPageCall } from "./band-shape.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { reconcileFloorDuty } from "./floor-duty.mjs";

/** Why a `select` the fold does not hold is refused, said back with it. */
const NOT_IN_BAND = "the band holds no record with this id";

/**
 * Index a submitted/prior list three ways — by row id, by row key, and BY RECORD URI. An absent prior and
 * a damaged one are the NORMAL inputs here (attempt 1 has no accumulator; a seat can hand back anything),
 * so neither may throw and neither may be the reason a union does not run.
 *
 * THE URI LEG IS THE ONE COVERAGE DOES NOT HAVE. A seat that adds a row naming a record the driver
 * already holds is talking about the driver's candidate, not a new one — matching only on id and key
 * would treat it as a separate row, and the render would emit the same candidate twice. Matching on URI
 * overlap folds it where it belongs.
 * PURE.
 */
function indexRows(rows, { bySelection = true, uriLeg = true } = {}) {
  const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.rows) ? rows.rows : []);
  const byId = new Map(), byKey = new Map(), byUri = new Map();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    if (r?.row_id) byId.set(String(r.row_id).trim().toUpperCase(), r);
    byKey.set(formRowKey(r), r);
    // THE SELECTION IS AN INDEX KEY, not only the records. A submitted `{select, tier, reason}` row
    // carries no `records[]` at all — the driver is the one that fills them — so a lookup that only knew
    // record sets would never match the seat's own answer to the row it answers, and every tier would
    // read as outstanding while sitting right there in the file.
    for (const u of (uriLeg ? [...(Array.isArray(r.records) ? r.records : []), bySelection ? selectionOf(r) : null] : [])) {
      const n = u ? (normalizeRecordUri(u) || String(u)) : "";
      if (n && !byUri.has(n)) byUri.set(n, r);
    }
  }
  return (canonical) => {
    const hit = byId.get(String(canonical.row_id).toUpperCase()) ?? byKey.get(formRowKey(canonical));
    if (hit) return hit;
    for (const u of (uriLeg ? [...(Array.isArray(canonical.records) ? canonical.records : []), bySelection ? selectionOf(canonical) : null] : [])) {
      const n = u ? (normalizeRecordUri(u) || String(u)) : "";
      const r = n ? byUri.get(n) : null;
      if (r) return r;
    }
    return null;
  };
}

/**
 * Union the seat's tiers into what the driver already holds.
 *
 * THE RULE, and why it is that way round — identical to coverage-union.mjs and disposition-union.mjs, for identical reasons:
 *   · a SUBMITTED row the gate would accept wins, so the seat can CORRECT itself;
 *   · otherwise a PRIOR row the gate would accept is kept, so a killed or cold attempt cannot destroy
 *     work already done;
 *   · otherwise the row stays unsettled and any partial fields are carried forward, so the next pass
 *     sees its own half-finished work rather than a blank row.
 *
 * THE ROWS ARE ALWAYS THE DRIVER'S, REGENERATED from the band's projections. Neither the prior form nor
 * the submitted one can add, drop or alter a candidate, its records or its owner. A seat that deletes
 * half the file changes nothing about what it owes.
 *
 * @returns {{form, total, settled, outstanding, carried, seat_rows}}
 *   carried — settled rows this attempt's own submission would NOT have carried on its own: exactly the
 *             work a killed or cold re-dispatch used to destroy.
 * PURE; never throws.
 */
export function unionPlacementForm(prior, submitted, input) {
  const index = buildSelectionIndex(input);
  const priorRows = Array.isArray(prior) ? prior : (Array.isArray(prior?.rows) ? prior.rows : []);
  const submittedRows = Array.isArray(submitted) ? submitted : (Array.isArray(submitted?.rows) ? submitted.rows : null);

  // EVERY SELECTION THE RUN HAS SEEN, prior first so the accumulator's order is stable across attempts.
  // A register row is one the seat selected; a row with no selection is a seat-authored candidate and is
  // handled below on the opposite rule.
  const selections = [];
  const seenSel = new Set();
  const unresolved = [];
  // Rows this pass consumed AS SELECTIONS, by identity. Without it a submitted `{select, tier, reason}`
  // row — which carries no `kind` — would fall through to seatRows() below and be re-added as a
  // seat-authored candidate with a null mark and no records: the same judgment counted twice, once as a
  // register candidate and once as a nameless one.
  const consumed = new WeakSet();
  // RETRACTION IS EXPLICIT, and it is the only way a row leaves this form.
  //
  // That seat rows were retracted by SILENCE — a submission that spoke owned them — and that was right
  // there, because that seat rewrote its whole form every pass. This one does not: it writes DELTAS, so a
  // corrective attempt that re-tiers two register rows says nothing about the run's common-law
  // candidates, and silence-retraction would delete every one of them without a word. The 2026-08-09
  // round carried 5-11 of those per run.
  //
  // So both kinds obey one rule — silence never destroys — and removal costs a row that says so. That
  // also keeps the wrong-row-on-attempt-1 case answerable, which is what silence-retraction was for.
  const retracted = new Set();
  for (const r of (submittedRows ?? [])) {
    const id = typeof r?.retract === "string" ? r.retract.trim() : "";
    if (id) { retracted.add(id.toUpperCase()); retracted.add(id); consumed.add(r); }
  }
  const isRetracted = (row) => retracted.has(String(row?.row_id ?? "").toUpperCase())
    || (selectionOf(row) ? retracted.has(selectionOf(row)) : false);
  const pushSelection = (row) => {
    if (!row || typeof row !== "object") return;
    const sel = selectionOf(row);
    if (!sel) return;                       // no id and no records ⇒ a seat-authored candidate; see below
    const canonical = index.resolve(sel);
    // A row the seat wrote as its OWN (kind:"seat") but which names a record the fold holds is talking
    // about the driver's candidate, not a new one. It folds — dropping it would delete a judgment, and
    // keeping it separate would put the same right in the file twice. A seat row whose record the fold
    // does NOT hold stays the seat's, and falls through to seatRows() below untouched.
    if (row.kind === "seat" && !canonical) return;
    consumed.add(row);
    if (!canonical) {
      // NEVER SILENTLY DROPPED. A `select` the fold does not hold is the seat naming something that is not
      // there — a typo, a record the band lost on a re-enumeration, or a candidate that belongs on a seat
      // row. It is reported back by id so the next pass can fix it, and counted so nobody reads the
      // shortfall as agreement.
      if (!seenSel.has(`?${sel}`)) { seenSel.add(`?${sel}`); unresolved.push({ select: sel, tier: seatFields(row).tier, why: NOT_IN_BAND }); }
      return;
    }
    const key = formRowKey(canonical);
    if (seenSel.has(key)) return;
    seenSel.add(key);
    const next = { ...canonical, select: sel };
    if (isRetracted(next) || isRetracted(row)) return;
    selections.push(next);
  };
  for (const r of priorRows) pushSelection(r);
  for (const r of (submittedRows ?? [])) pushSelection(r);

  // ONE GROUND PER OWNER'S SET (placement-form.mjs, SET_ASIDE_ROW_CONTRACT). A set-aside row is not a
  // candidate: it is consumed here, kept on its own list, and never joins the rows that render into
  // placements.json. Prior first, so a later row for the same owner replaces the earlier ground, and a
  // retraction names the record id the row set aside. A row the band cannot resolve, or one with no
  // ground, is reported back by id, never dropped in silence.
  // A ground by name covers the named line only. On a line holding a floor it is about the mark, its goods,
  // its status or its territory, and says which in `on`; a ground about the owner never sets a floor aside.
  const groups = input?.groups ?? null;
  const floorUris = new Set((Array.isArray(input?.floors) ? input.floors : []).map((f) => normalizeRecordUri(f?.record_id) || String(f?.record_id ?? "")).filter(Boolean));
  const holdsFloor = (canonical) => (canonical?.records ?? []).some((u) => floorUris.has(normalizeRecordUri(u) || String(u ?? "")));
  // A by-name ground covers the LINE, so the floor check is made on the line: any floor record under the line's
  // key, or a shape line holding one, though the record the row names is another position of it.
  const floorLines = new Set([
    ...[...floorUris].map((u) => namedKey(index.resolve(u))).filter(Boolean),
    ...["a", "b", "c", "d", "no_goods"].flatMap((g) => (Array.isArray(groups?.[g]?.list) ? groups[g].list : []).filter((l) => l?.floors > 0).map((l) => l.key)),
  ]);
  const lineHoldsFloor = (canonical) => holdsFloor(canonical) || floorLines.has(namedKey(canonical));
  const setAside = new Map();
  const setAsideRefused = [];
  const takeSetAside = (row) => {
    const id = String(row.set_aside).trim();
    const ground = typeof row.ground === "string" ? row.ground.trim() : "";
    const canonical = index.resolve(id);
    const refuse = (why) => { if (!setAsideRefused.some((x) => x.set_aside === id && x.why === why)) setAsideRefused.push({ set_aside: id, why }); };
    if (!canonical) { refuse(NOT_IN_BAND); return; }
    if (!ground) { refuse("no ground"); return; }
    const on = typeof row.on === "string" ? row.on.trim().toLowerCase() : "";
    if (lineHoldsFloor(canonical)) {
      if (!FLOOR_GROUND_ON.includes(on)) { refuse(`a floor is set aside by name only on its status or its territory: give "on" as one of ${FLOOR_GROUND_ON.join(", ")}`); return; }
      if (FLOOR_GROUND_REFUSED.test(ground)) { refuse("a floor is never set aside on its owner's customers, channels, markets or field: write a ground about its status or its territory"); return; }
    }
    const key = namedKey(canonical);
    setAside.delete(key);
    setAside.set(key, { set_aside: id, key, owner: canonical.owner ?? null, ground, ...(on ? { on } : {}) });
  };
  for (const e of (Array.isArray(prior?.set_aside) ? prior.set_aside : [])) if (isSetAsideRow(e)) takeSetAside(e);
  // The step may answer in either place: the top-level list it is shown, or a row. An entry equal to one
  // already held changes nothing; a changed ground there replaces the held one, like a row.
  for (const e of (Array.isArray(submitted?.set_aside) ? submitted.set_aside : [])) if (isSetAsideRow(e)) takeSetAside(e);
  for (const r of (submittedRows ?? [])) if (isSetAsideRow(r)) { consumed.add(r); takeSetAside(r); }
  for (const [k, e] of setAside) if (retracted.has(e.set_aside) || retracted.has(e.set_aside.toUpperCase())) setAside.delete(k);

  // A ROW OVER LINES NOT READ is refused with how to read them: the parts of the shape that print them and were
  // not read, or the group's own pages, which serve every line, the crowded group's unprinted ones included.
  // A crowd outside (a) needs only its first page, which the shape prints; (a), and any group below a thousand
  // records, needs every line, and a crowded (a)'s lines past its first page are read only on its pages.
  const unreadGroup = (g, seen, total, { firstPage, pagesOnly }, served) => {
    const inParts = served?.group_parts?.[g];
    const partsLeft = Array.isArray(inParts) ? inParts.filter((p) => !served?.parts_read?.has?.(p)) : null;
    const parts = pagesOnly ? null : partsLeft == null ? "read the parts of band_shape that print it" : partsLeft.length ? `read band_shape ${partsLeft.map((p) => `part ${p}`).join(" and ")}` : null;
    // A crowd outside (a) stands on its first page, which the shape prints: its refusal names the parts.
    if (firstPage) return `${seen} of the first ${total} lines of group ${g} were read: ${partsLeft?.length ? `read band_shape ${partsLeft.map((p) => `part ${p}`).join(" and ")}, which prints them` : "read the parts of band_shape that print them"}, before its row`;
    return `${seen} of ${total} lines of group ${g} were read: ${[parts, `page it with ${groupPageCall(g)}`].filter(Boolean).join(", or ")}, before its row`;
  };
  // ONE ROW PER GROUP (placement-form.mjs, SET_ASIDE_GROUP_CONTRACT), kept the way an owner's set-aside is:
  // prior first, a later row for the same group replaces the earlier one, and `group:<name>` retracts it.
  // Its count must be the shape's own, so the row is about the pile the step was shown. A group the shape
  // does not list, a count that is not the shape's, or a row with no ground is reported back, never dropped.
  const setAsideGroups = new Map();
  const groupRefused = [];
  const servedSet = servedLines(groups, input?.served, index);
  const takeGroup = (row) => {
    const written = String(row.set_aside_group).trim();
    const refuse = (why) => { if (!groupRefused.some((x) => x.set_aside_group === written && x.why === why)) groupRefused.push({ set_aside_group: written, why }); };
    const g = groupName(written);
    if (!g) { refuse(`not one of the shape's groups (${ROW_GROUPS.join(", ")})`); return; }
    const shown = groups?.[g];
    if (!(shown?.lines > 0)) { refuse("the band shape lists no line in this group"); return; }
    const ground = typeof row.ground === "string" ? row.ground.trim() : "";
    if (!ground) { refuse("no ground"); return; }
    if (Number(row.count) !== shown.records) { refuse(`count ${row.count ?? "(none)"} is not the shape's ${shown.records}`); return; }
    const crowded = (shown.records ?? 0) >= (groups?.crowded_at ?? Infinity);
    if (g === "no_goods" && !crowded) { refuse("the lines the goods test could not place take a row only at a thousand records or more; below that, each takes its fate by name"); return; }
    // A ROW COVERS ONLY WHAT WAS READ (ruled 2026-10-12). Below a thousand records, and in (a) at any size, a
    // row waits for every line; a crowd of a thousand or more outside (a) stands on its first page read and
    // the count, the crowded-field method's "do not write up the rest". The rest is listed by the same rule.
    const list = Array.isArray(shown.list) ? shown.list : [];
    const firstPage = crowded && g !== "a";
    const needed = firstPage ? list.slice(0, groups?.first_page ?? 0) : list;
    const seen = needed.filter((l) => servedSet.has(l.key)).length;
    if (seen < needed.length) { refuse(unreadGroup(g, seen, needed.length, { firstPage, pagesOnly: crowded && g === "a" }, input?.served)); return; }
    setAsideGroups.delete(g);
    setAsideGroups.set(g, { set_aside_group: g, count: shown.records, ground });
  };
  for (const e of (Array.isArray(prior?.set_aside) ? prior.set_aside : [])) if (isSetAsideGroupRow(e)) takeGroup(e);
  for (const e of (Array.isArray(submitted?.set_aside) ? submitted.set_aside : [])) if (isSetAsideGroupRow(e)) takeGroup(e);
  for (const r of (submittedRows ?? [])) if (isSetAsideGroupRow(r)) { consumed.add(r); takeGroup(r); }
  for (const g of [...setAsideGroups.keys()]) if (retracted.has(`group:${g}`) || retracted.has(`group:${g}`.toUpperCase())) setAsideGroups.delete(g);
  const form = { _provenance: PLACEMENT_FORM_PROVENANCE, select_row_contract: SELECT_ROW_CONTRACT,
    seat_row_contract: SEAT_ROW_CONTRACT, set_aside_row_contract: SET_ASIDE_ROW_CONTRACT,
    set_aside_group_contract: SET_ASIDE_GROUP_CONTRACT,
    generated_from: { ...index.derived_from, selected: selections.length, unresolved: unresolved.length, set_aside: setAside.size,
      set_aside_groups: setAsideGroups.size },
    ...(unresolved.length ? { unresolved } : {}), ...(setAsideRefused.length ? { set_aside_refused: setAsideRefused } : {}),
    ...(groupRefused.length ? { set_aside_group_refused: groupRefused } : {}),
    set_aside: [...setAside.values()], set_aside_groups: [...setAsideGroups.values()], rows: selections };

  // THE TWO SIDES ARE MATCHED DIFFERENTLY, and the asymmetry is the point.
  //
  // A SUBMITTED row is `{select, tier, reason}` — it carries no records at all, because the driver is the
  // one that fills them — so it can only be matched by the id it selected.
  //
  // A PRIOR row is driver-filled and its RECORD SET IS ITS IDENTITY, so it is matched on that and never
  // on the selection. That is what keeps the old design's best property: after a re-enumeration splits a
  // family, the selection id is unchanged but the candidate is not, so the row arrives unsettled with no
  // carry — automatically, with no invalidation logic and no trigger-sniffing. Matching the prior row by
  // selection would hand a reason written about a three-territory family to a single-record candidate,
  // on a client deliverable, without a word.
  // …and not by URI OVERLAP either, for the same reason one level down: the split family's single
  // remaining record is still one of the three the old row held, so an overlap match would hand the
  // family's tier to the leg. Overlap is the SUBMITTED side's leg — it is how a seat row naming a record
  // the driver holds folds onto the driver's candidate instead of duplicating it.
  const findPrior = indexRows(priorRows, { bySelection: false, uriLeg: false });
  const findSubmitted = indexRows(submittedRows ?? []);
  let settled = 0, carried = 0;
  const tierRefused = [];
  for (const row of form.rows) {
    const pr = findPrior(row), s = findSubmitted(row);
    const sOk = s && rowIsSettled(s, row), pOk = pr && rowIsSettled(pr, row);
    let fields;
    if (sOk) fields = seatFields(s);
    else if (pOk) fields = seatFields(pr);
    else {
      const sf = seatFields(s ?? {}), pf = seatFields(pr ?? {});
      fields = { tier: sf.tier || pf.tier, reason: sf.reason || pf.reason, borderline: sf.borderline ?? pf.borderline };
    }
    row.tier = fields.tier || null;
    row.reason = fields.reason || null;
    row.borderline = fields.borderline === true ? true : null;
    // AN IDENTICAL MARK LIVE IN AN ORDERED OR FRAME-ADDED CLASS IS NEVER OUT-OF-SCOPE-FILTERED. The tier is
    // refused, said back, and the row left open, so the floor duty still owes it a fate.
    if (row.tier === "out-of-scope-filtered" && holdsFloor(row)) {
      tierRefused.push({ select: row.select ?? null, why: "an identical mark live in an ordered or frame-added class is never out-of-scope-filtered: place it, sheet-2 at the least, or set it aside by name on its status or its territory" });
      row.tier = null;
    }
    // JUDGED ON THE MERGED ROW, not on either input — a tier written on one pass and its reason on the
    // next completes a row neither attempt finished alone, and counting whole settled inputs would report
    // it outstanding while the gate, reading this same merged row, accepts it.
    if (rowIsSettled(row, row)) { settled += 1; if (!sOk) carried += 1; }
  }
  if (tierRefused.length) form.tier_refused = tierRefused;
  // SEAT ROWS accumulate exactly as selections do — prior ∪ submitted, minus explicit retractions. A
  // TORN write is still safe: it fails to parse, so it "said nothing", contributes no rows and retracts
  // none, and no corrupt judgment can enter.
  const driverKeys = new Set(form.rows.map(formRowKey));
  const source = [...priorRows, ...(submittedRows ?? [])].filter((r) => !consumed.has(r));
  const carriedSeat = seatRows(source, driverKeys).filter((r) => !isRetracted(r));
  for (const r of carriedSeat) {
    form.rows.push(r);
    if (rowIsSettled(r, r)) settled += 1;
  }

  // WHAT EACH ROW COVERS, said back to the step: the group's lines it neither placed nor set aside by name,
  // and, below a thousand records, the lines holding a floor the row leaves for the step to place or name. Read
  // on the merged rows: a line is placed only where its row renders, so a selection the form refused, for its
  // tier or anything else, is never read as a fate.
  const placedLines = new Set(form.rows.filter((row) => row.kind === "register" && rowIsSettled(row, row)).map((row) => lineKey(row)).filter(Boolean));
  const groupOf = groupOfKeys(groups);
  const lineOf = (g, key) => (Array.isArray(groups?.[g]?.list) ? groups[g].list : []).find((l) => l.key === key) ?? null;
  const covers = new Map(), floorsLeft = new Map();
  for (const [key, g] of groupOf) {
    if (!setAsideGroups.has(g) || placedLines.has(key) || setAside.has(key)) continue;
    const line = lineOf(g, key);
    if ((line?.floors ?? 0) > 0 && !groupRowCoversFloors(groups, g)) floorsLeft.set(g, [...(floorsLeft.get(g) ?? []), line.record_id ?? key]);
    else covers.set(g, (covers.get(g) ?? 0) + 1);
  }
  for (const [g, e] of setAsideGroups) {
    e.covers_lines = covers.get(g) ?? 0;
    if (floorsLeft.get(g)?.length) e.floors_not_covered = floorsLeft.get(g);
  }
  // EVERY FLOOR WITHOUT A FATE, below a thousand records, said back with its line: counted by the floor duty's
  // own reconcile over what this form renders and sets aside, so a floor on a line placed through another of its
  // records is owed here as the duty owes it. A crowd of a thousand or more stands on its row and its count. Said
  // back to an answer only: the form written before the step has answered would list every floor of the band.
  const groundOf = setAsideGrounds([...setAside.values(), ...setAsideGroups.values()], index, groups, input?.floors);
  const duty = reconcileFloorDuty({ floors: Array.isArray(input?.floors) ? input.floors : [],
    placements: renderPlacementsJson(form.rows).placements, setAsideGroundOf: groundOf });
  const unfated = new Map();
  for (const r of duty.rows) {
    if (r.disposition !== "unanswered" && r.disposition !== "named-without-ground") continue;
    const key = lineKey(index.resolve(r.record_id));
    const g = key ? groupOf.get(key) ?? null : null;
    if (g && (groups?.[g]?.records ?? 0) >= (groups?.crowded_at ?? Infinity)) continue;
    const k = key ?? `record:${r.record_id}`;
    const e = unfated.get(k) ?? { group: g, line: (g ? lineOf(g, key)?.record_id : null) ?? r.record_id, floors: [] };
    e.floors.push(r.record_id);
    unfated.set(k, e);
  }
  if (submittedRows !== null && unfated.size) form.floors_without_fate = [...unfated.values()];
  return { form, total: form.rows.length, settled, outstanding: form.rows.length - settled,
    carried, seat_rows: carriedSeat.length, unresolved: unresolved.length, set_aside: setAside.size, set_aside_groups: setAsideGroups.size,
    floors_without_fate: [...unfated.values()].reduce((n, e) => n + e.floors.length, 0) };
}

/** How many rows of an already-unioned form the render would still omit. PURE. */
export function outstandingPlacementRows(form) {
  const rows = Array.isArray(form) ? form : (form?.rows ?? []);
  return rows.filter((r) => !rowIsSettled(r, r));
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// coverage-call.mjs — THE DIGEST STOPS HAND-EDITING THE COVERAGE FORM. It calls; the driver writes.
//
// ── WHAT THIS REPLACES, AND WHY IT COULD NOT BE PATCHED ─────────────────────────────────────────────
//
// The register-digest seat was handed a driver-written JSON form and told to OPEN it and set `status`
// and `reason` on every row — a model hand-editing a machine-parsed document. That is the same
// transport disease B removed for the meaning seat: as long as a model types into a structured
// document, typed-document-fails-to-parse (`coverage_form_damaged` — a whole paid dispatch lost to
// JSON the model typed) is a failure the engine can have, and every ruling in the file rides on the
// model's serialization. Here the serialization is ours, so the class is gone rather than caught.
//
// The FORM survives — as the driver's accumulator in `_driver/`, the artifact verify.mjs judges. What
// dies is the seat's pen: statuses reach the form only through the `record_coverage` tool, validated
// per row at call time by the SAME predicates the gate judges with (rowIsSettled, seatBannedTokens,
// REGISTER_AXES — imported, never copied). A refusal is actionable inside the turn, three attempts
// earlier than the corrective ladder would have said the same thing.
//
// EXTENDED THAT ONE ROW FURTHER DOWN THE RUN. The crowd ruling's member count is judged not by
// the coverage gate but by the DELIVERY reconciliation, and it survived the conversion unchecked: an
// uncounted cell passed here, passed the gate, and blocked the run at delivery. `crowdRulingCount` is
// imported from coverage-ledger.mjs for the same reason the three predicates above are — the refusal
// and the block must be the same reading, not two readings that agree today.
//
// ── THE FOUR PROPERTIES, inherited from disposition-call.mjs (B) rather than re-argued ──────────────
//
// 1. A CALL CARRIES A BATCH, NOT A ROW (MAX_ROWS_PER_CALL below — the ceremony budget).
// 2. THE SEAT NAMES NO IDENTIFIER IT WAS NOT SHOWN: driver rows are addressed by the driver's own
//    row_id, listed in the dispatch; a seat row's row_id is minted by the driver (seatRows), never
//    typed. The one identifier the seat still supplies is a seat row's `axis`, and that is a decision
//    recorded in coverage-form.mjs ("THE DRIVER DOES NOT ASSIGN IT"), unchanged by the transport.
// 3. EVERY PER-ROW VALUE IS CHECKED AGAINST THAT ROW, AT CALL TIME — an enum-valid `confirmed-clean`
//    on a row the driver computed as OPEN is refused with that row's own `open_because`.
// 4. PARTIAL ACCEPT. Rows that validate are kept even when neighbours in the same call are refused.
//
// PURE — no node imports, so it tests offline, exactly like coverage-form.mjs and coverage-union.mjs,
// whose headers state the same rule for the same reason. It reads those modules and neither reads this
// one: the import runs ONE WAY, so there is no second opinion about what a settled row is.

import { COVERAGE_STATUSES, REGISTER_AXES, normalizeAxis,
  CROWD_RULING_TOKEN, CROWD_RULING_UNIT_GRAMMAR, crowdRulingCount } from "./coverage-ledger.mjs";
import { seatBannedTokens, seatRows } from "./coverage-form.mjs";

const STATUS_SET = new Set(COVERAGE_STATUSES);
const str = (v) => String(v ?? "").trim();

// ── THE CEREMONY BUDGET, PRE-REGISTERED (disposition-call.mjs's rule, same numbers) ─────────────────
// The largest recorded coverage form carried well under 50 rows (R1: 14 deferred qids + axes + blocks).
// 25 rows per call clears any recorded form in two calls; the budget below allows four, so one retry of
// a refused chunk still lands inside it. A built tool needing more has failed the ergonomics property.
export const MAX_ROWS_PER_CALL = 25;
export const CEREMONY_BUDGET_CALLS = 4;

// THE FIELDS A CALL ROW CARRIES. Declared as a LITERAL closed set because the skills teach it and the
// vocabulary sweep reads exported constants from source. Three addressings share one row shape:
//   a DRIVER-row ruling   {row_id, status, reason}
//   a SEAT row you add    {kind:"seat", axis, unit, status, reason}   (no row_id — the driver mints it)
//   a retraction          {retract: "<row_id of a seat row>"}
export const CALL_ROW_FIELDS = Object.freeze(["row_id", "status", "reason", "kind", "axis", "unit", "retract"]);

// ── THE REFUSAL VOCABULARY ──────────────────────────────────────────────────────────────────────────
// One reason, one cause, one remedy. These are the TOOL's own per-row answers, returned inside the
// turn. They are not failure tokens: a refused row is not a failed stage, it is a row the seat can fix
// while it still has the context to.
export const CALL_REFUSALS = Object.freeze([
  "unknown_row",        // no obligation carries this row_id — the driver's row set is the authority
  "duplicate_row",      // the same row twice in one call; which one is the answer is not ours to guess
  "row_unaddressed",    // neither a row_id, nor a seat row's own fields, nor a retract — nothing to bind to
  "status_invalid",     // not one of the accepted statuses
  "reason_absent",      // ruled with nothing said for the lawyer to read
  "open_clean",         // confirmed-clean on a row the DRIVER computed as open; detail quotes open_because
  "engine_vocabulary",  // the reason names an engine identifier a client would read
  "axis_invalid",       // a seat row's axis is outside the closed register-axis vocabulary
  "retract_invalid",    // retract names no seat row on this form (driver rows cannot be retracted)
  "crowd_count_unparsed", // the unit rules a dominant-element crowd and the count read out of it is ZERO
]);

/**
 * Validate one typed call against the driver's own regenerated rows.
 *
 * `rows` is the seat's payload. `canonicalRows` is the union-regenerated form (driver rows carrying
 * `open`/`open_because`, plus the seat rows already recorded) — the SAME rows the gate judges, handed
 * in by the caller so this stays pure.
 *
 * Returns `{accepted, retractions, refused, overflow}`:
 *   accepted    — normalized rows ready for the accumulator: driver-row rulings as {row_id, status,
 *                 reason}; seat rows in seatRows() shape (driver-minted row_id, repaired axis)
 *   retractions — seat row_ids to drop from the carried set
 *   refused     — {row_id, reason, detail} per row, for the tool's answer inside the turn
 *   overflow    — rows beyond MAX_ROWS_PER_CALL, neither accepted nor refused; the caller re-sends them
 *
 * PURE. Never throws — a malformed payload is refused, not an exception, because an exception here
 * would surface as a tool error naming no row, which tells the seat nothing about what to fix.
 */
export function validateCoverageCall(rows, canonicalRows) {
  const canonical = Array.isArray(canonicalRows) ? canonicalRows.filter((r) => r && typeof r === "object") : [];
  const byId = new Map(canonical.map((c) => [str(c.row_id).toUpperCase(), c]));
  const accepted = [], refused = [], retractions = [], seen = new Set();
  const list = Array.isArray(rows) ? rows : [];
  const overflow = list.slice(MAX_ROWS_PER_CALL).map((r) => str(r?.row_id) || str(r?.retract) || str(r?.unit) || "(no row_id)");

  // Shared per-row judgment checks — the SAME predicates rowIsSettled and the gate apply, split out so
  // the refusal can name the field. `c` is the canonical row the judgment lands on (null for a new
  // seat row, whose open flag is definitionally false).
  const judge = (no, raw, c) => {
    const status = str(raw?.status).toLowerCase();
    if (!STATUS_SET.has(status)) {
      no("status_invalid", `\`status\` must be EXACTLY one bare token of ${COVERAGE_STATUSES.join(" / ")} — qualifiers go in the reason`);
      return null;
    }
    const reason = str(raw?.reason);
    if (!reason) { no("reason_absent", "`reason` is the sentence the lawyer reads — say what was searched and what was not, in a lawyer's words"); return null; }
    if (c?.open === true && status === "confirmed-clean") {
      no("open_clean", `this row cannot be confirmed-clean — ${str(c.open_because) || "the driver computed its slice as never searched or never accounted for"}`);
      return null;
    }
    const banned = seatBannedTokens(reason);
    if (banned.length) {
      no("engine_vocabulary", `the reason names ${banned.join(", ")} — the reader's page prints this sentence and the coverage unit already carries the identifier; rewrite it in a lawyer's words`);
      return null;
    }
    return { status, reason };
  };

  for (const raw of list.slice(0, MAX_ROWS_PER_CALL)) {
    const row_id = str(raw?.row_id);
    const no = (reason, detail) => refused.push({ row_id: row_id || str(raw?.retract) || str(raw?.unit) || "", reason, detail });

    // ── a retraction — seat rows only; a driver row is an obligation and cannot be withdrawn ──────
    const retract = str(raw?.retract);
    if (retract) {
      const target = byId.get(retract.toUpperCase());
      if (!target || target.kind !== "seat") {
        no("retract_invalid", target
          ? `${retract} is a DRIVER row — an obligation computed from the plan; it cannot be retracted, only ruled`
          : `no seat row on this form carries row_id ${retract} — retraction names the row_id the tool's answer or the dispatch listed`);
        continue;
      }
      if (seen.has(target.row_id)) { no("duplicate_row", `row ${target.row_id} appears twice in one call — send each row once`); continue; }
      seen.add(target.row_id);
      retractions.push(target.row_id);
      continue;
    }

    // ── a seat row (new, or a re-send of one already recorded) ────────────────────────────────────
    const isSeat = str(raw?.kind) === "seat" || (!row_id && (str(raw?.axis) || str(raw?.unit)));
    const existing = row_id ? byId.get(row_id.toUpperCase()) : null;
    if (isSeat || (existing && existing.kind === "seat")) {
      // normalize-then-validate, through the SAME path the union ingests seat rows by (seatRows —
      // called, not copied): axis repaired from the unit label where cosmetically lost, row_id minted
      // by the driver. A re-send addressed by an existing seat row_id keeps that row's own axis/unit.
      const src = existing && existing.kind === "seat"
        ? { kind: "seat", axis: str(raw?.axis) || existing.axis, unit: str(raw?.unit) || existing.unit, status: raw?.status, reason: raw?.reason }
        : { kind: "seat", axis: raw?.axis, unit: raw?.unit, status: raw?.status, reason: raw?.reason };
      const [norm] = seatRows([src], []);
      if (!norm) { no("row_unaddressed", "a seat row needs its own fields — {\"kind\":\"seat\",\"axis\",\"unit\",\"status\",\"reason\"}"); continue; }
      const axis = normalizeAxis(norm.axis, norm.unit);
      if (!REGISTER_AXES.includes(axis)) {
        no("axis_invalid", `axis "${str(src.axis) || "(none)"}" is not one of ${REGISTER_AXES.join(" / ")} — the vocabulary is CLOSED; never a jurisdiction, a class, a sweep name or a phrase`);
        continue;
      }
      // ── — THE ONE SEAT ROW UNDER A DELIVERY-BLOCKING GATE, CHECKED WHERE IT IS TYPED ────────
      //
      // A crowd ruling declares its member count inside the unit CELL, and until this arm existed that
      // count was read for the first time at DELIVERY. So the transport conversion left one late block
      // standing: the cell rode in as free text, every gate above returned ok, and the run was refused
      // three gates later — after a paid dispatch — over a ruling the seat had made and would have
      // fixed in seconds had anything said so. The count is now read HERE, by the same function the
      // delivery join reads it with, so the two cannot disagree.
      //
      // `norm.unit`, NOT `src.unit`: seatRows collapses whitespace and falls back to the bare axis, and
      // norm.unit is the exact string that becomes the ledger cell the delivery parser sees. Validating
      // the raw field would check a different string than the one that blocks.
      //
      // Presence-gated on the crowd token (null = not a crowd row), so no other seat row is touched. A
      // literal `(0 members)` lands here too and is refused for the same reason an absent count is: the
      // delivery join credits this ruling with nothing either way. The detail therefore states the
      // CONSEQUENCE and does not guess which of the two the seat typed.
      if (crowdRulingCount(norm.unit) === 0) {
        no("crowd_count_unparsed", `this row rules a ${CROWD_RULING_TOKEN} and the member count read out of its coverage unit is ZERO. The count is read from the unit cell and NOWHERE else — a count in the reason, or none at all, covers no residual position, and the run is blocked at delivery over a ruling you did make. The unit IS this row's identity, so it cannot be edited in place: retract this row_id, then add the row again with its unit written as ${CROWD_RULING_UNIT_GRAMMAR}, counting <N> in POSITIONS.`);
        continue;
      }
      // No collision arm, and that is a fact about the KEYS rather than an omission: formRowKey
      // prefixes a seat row's key with `seat:`, so a seat row can never occupy a driver row's identity
      // whatever its unit says — the union drops nothing and there is nothing to refuse.
      if (seen.has(norm.row_id)) { no("duplicate_row", `seat row "${norm.unit}" appears twice in one call — send each row once`); continue; }
      const fields = judge(no, src, null);
      if (!fields) continue;
      seen.add(norm.row_id);
      accepted.push({ ...norm, status: fields.status, reason: fields.reason });
      continue;
    }

    // ── a driver-row ruling ───────────────────────────────────────────────────────────────────────
    if (!row_id) { no("row_unaddressed", "each row carries a `row_id` from the obligations list, or a seat row's own fields, or a `retract`"); continue; }
    const c = existing;
    if (!c) { no("unknown_row", `no obligation on this run's coverage form carries row_id ${row_id} — the row ids are the driver's and are listed with the obligations`); continue; }
    if (seen.has(c.row_id)) { no("duplicate_row", `row ${c.row_id} appears twice in one call — send each row once`); continue; }
    const fields = judge(no, raw, c);
    if (!fields) continue;
    seen.add(c.row_id);
    // THE CANONICAL KIND RIDES THE ACCEPTED ROW, and it is load-bearing: the union's seatRows() reads
    // any row whose `kind` is not a driver kind as a SEAT row, and a bare {row_id, status, reason}
    // would spawn a phantom empty-axis seat row beside the ruling it carries. The file era never met
    // this because every submission round-tripped through parseCoverageForm, which stamps the kind.
    accepted.push({ row_id: c.row_id, kind: c.kind, axis: c.axis, unit: c.unit, status: fields.status, reason: fields.reason });
  }
  return { accepted, retractions, refused, overflow };
}

/**
 * What the tool says back, inside the turn. The outstanding set is the point: a seat that can see what
 * is left does not have to guess whether it is finished — "I thought I was done" is the state that
 * produced every unruled-form corrective in the record.
 *
 * `outstanding` rows carry the anchor facts the seat needs to act WITHOUT re-opening anything: the
 * driver's unit label, and — on an `open` row — which status it can never be, in the driver's own words.
 * PURE.
 */
export function coverageCallAnswer({ accepted, retractions = [], refused, overflow }, outstanding) {
  const lines = [`Recorded ${accepted.length} row${accepted.length === 1 ? "" : "s"}.`];
  if (retractions.length) lines.push(`Retracted ${retractions.length} seat row${retractions.length === 1 ? "" : "s"}.`);
  if (refused.length) {
    lines.push(`${refused.length} refused — each one names what to change, and the rest of this call was KEPT:`);
    for (const r of refused) lines.push(`  ${r.row_id || "(no row_id)"} — ${r.detail}`);
  }
  if (overflow.length) lines.push(`${overflow.length} row${overflow.length === 1 ? "" : "s"} beyond the ${MAX_ROWS_PER_CALL}-row limit were not read; send them in the next call.`);
  const left = Array.isArray(outstanding) ? outstanding : [];
  if (!left.length) {
    lines.push("Nothing is outstanding. Every coverage obligation carries a status and a reason.");
    return lines.join("\n");
  }
  lines.push(`${left.length} obligation${left.length === 1 ? "" : "s"} still outstanding:`);
  for (const r of left) {
    const open = r.open === true
      ? ` — OPEN (${str(r.open_because).slice(0, 140) || "never searched or never accounted for"}): it can never be confirmed-clean`
      : "";
    lines.push(`  ${r.row_id}  ${r.unit}${open}`);
  }
  return lines.join("\n");
}

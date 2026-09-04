// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// declination-duty.mjs — every record handed to synthesis left by a NAMED EXIT, or the run says which
// ones did not. ('s missing half; the R2 round on is the incident.)
//
// THE RULE IS ALREADY DICTATED, AND IT WAS NEVER CHECKED. synthesis's own contract states it in one
// line — "a record that reached your findings surface leaves this stage as a finding in findings.json
// or as a declination, and there is no third way out". The driver builds that list, prints it forward,
// writes the spec the decline tool reads, and hands the seat a closed reason vocabulary to decline
// with. Then it accepts whatever comes back. On the R2 round what came back was short, and nothing
// anywhere said so: the reader got a report, and the records that never reached it left no trace of
// having been considered.
//
// WHY THIS IS A JOIN AND NOT A COUNT. "n records, m findings, m < n" is true of every honest run — most
// records SHOULD be declined, and the decline is a complete answer. The defect is not that a record was
// dropped; it is that a SPECIFIC record was dropped with no exit recorded for it, so nobody can tell
// "correctly judged irrelevant" from "silently lost". Those are opposite repairs and a count cannot
// distinguish them. So the answer is per-record and names the records, and a bare total would be the
// same disclosure that already failed to stop this.
//
// ONE NORMALISER, APPLIED HERE, TO ALL THREE SIDES. The owed list, the delivered uris and the declined
// uris are produced by three different code paths, and two spellings of one uri is exactly how a join
// like this reports a loss that never happened — and then gets switched off for crying wolf. This
// module normalises every side itself rather than trusting its callers to have agreed, so a caller that
// forgets cannot make the join lie.
//
// WHAT THIS DELIBERATELY DOES NOT JUDGE. A record that is BOTH delivered and declined is counted and
// reported (`both`) and is NOT a defect here. It can be honest — a finding names several registrations
// and one of them may be separately declined — and no ruling covers it. Refusing on it would be this
// module inventing a rule, which is how a checked obligation acquires a second, unruled one.
import { normalizeRecordUri } from "./registry-fidelity.mjs";

export const DECLINATION_DUTY_SCHEMA_VERSION = 1;

/** Normalise one side of the join into a Set of canonical uris. A row may be a bare uri or an object. */
const uriSet = (xs) => {
  const out = new Set();
  for (const x of Array.isArray(xs) ? xs : []) {
    const u = normalizeRecordUri(typeof x === "string" ? x : (x?.uri ?? x?.record_id));
    if (u) out.add(u);
  }
  return out;
};

/**
 * Reconcile what synthesis was handed against what it did with each record.
 *
 * EVERY INPUT IS THREE-VALUED, and `null` is never treated as empty. An absent owed list means the seat
 * was NOT ORDERED to decline anything — the spec is written only when there are rows, and its write is
 * non-fatal by design — and a seat that was never ordered cannot be held to the order. An absent
 * delivered or declined side means the run could not be read. Both are `computable:false` carrying a
 * reason and NO counts, because a zero here would read as "everything was accounted for", which is the
 * exact inversion this check exists to stop.
 *
 * @param owed          the declination spec's rows: `{uri, mark, owner, tier}`, or `null` if unordered.
 * @param deliveredUris uris the delivered findings name, or `null` if the findings could not be read.
 * @param declinedUris  uris the declination ledger holds, or `null` if the ledger could not be read.
 */
export function reconcileDeclinationDuty({ owed = null, deliveredUris = null, declinedUris = null } = {}) {
  const notComputable = (reason) => ({
    schema_version: DECLINATION_DUTY_SCHEMA_VERSION, computable: false, reason,
  });
  if (!Array.isArray(owed)) {
    return notComputable("no declination spec on this run — synthesis was never ordered to decline, so "
      + "there is no obligation to hold it to (an empty findings surface and a failed spec write both "
      + "land here, and neither is a seat defect)");
  }
  if (!Array.isArray(deliveredUris)) return notComputable("the delivered findings could not be read");
  if (!Array.isArray(declinedUris)) return notComputable("the declination ledger could not be read");

  const delivered = uriSet(deliveredUris);
  const declined = uriSet(declinedUris);

  const unaccounted = [];
  const seen = new Set();
  let both = 0;
  for (const row of owed) {
    const uri = normalizeRecordUri(row?.uri ?? row?.record_id);
    // A spec row with no uri cannot be cited by the seat either — the decline tool addresses records BY
    // POSITION in this very list, so an unaddressable row is the driver's defect, not the seat's. It is
    // counted so the totals still reconcile, and never listed as something the seat failed to answer.
    if (!uri) continue;
    if (seen.has(uri)) continue;      // the same record listed twice is one duty
    seen.add(uri);
    const isDelivered = delivered.has(uri);
    const isDeclined = declined.has(uri);
    if (isDelivered && isDeclined) both++;
    if (isDelivered || isDeclined) continue;
    unaccounted.push({
      uri,
      mark: String(row?.mark ?? "").trim() || null,
      owner: String(row?.owner ?? "").trim() || null,
      tier: row?.tier ?? null,
    });
  }

  const owedCount = seen.size;
  const accounted = owedCount - unaccounted.length;
  return {
    schema_version: DECLINATION_DUTY_SCHEMA_VERSION, computable: true,
    totals: {
      owed: owedCount,
      delivered: [...seen].filter((u) => delivered.has(u)).length,
      declined: [...seen].filter((u) => declined.has(u)).length,
      accounted, unaccounted: unaccounted.length, both,
    },
    unaccounted,
    // Stated rather than left to be derived, the same reason floor-duty states its own: an artifact that
    // does not add up is a bug in THIS module, and a reader should not have to find that out by summing.
    reconciles: accounted + unaccounted.length === owedCount,
  };
}

/**
 * The refusal the seat meets at the acceptance boundary, or `null` when nothing is owed.
 *
 * COUNT FIRST, THEN THE RECORDS. A seat that dropped one and a seat that dropped ninety must not read
 * alike in a log. The records follow because a seat handed a number cannot act on it — it needs to know
 * WHICH, and both exits stay open for each one, which the text says outright so that declining does not
 * read as an admission of failure. Capped, with the remainder counted rather than trailing off.
 */
export function declinationDutyRefusal(result, { cap = 12 } = {}) {
  if (!result?.computable || !result.unaccounted?.length) return null;
  const { unaccounted } = result;
  const shown = unaccounted.slice(0, cap)
    .map((r) => `${r.mark ? `${r.mark} ` : ""}(${r.uri})`).join(", ");
  const rest = unaccounted.length - Math.min(cap, unaccounted.length);
  return `synthesis_unaccounted_records:${unaccounted.length} of ${result.totals.owed} — these records `
    + `reached your findings surface and your call accounts for none of them: ${shown}`
    + `${rest ? ` (+${rest} more)` : ""}. For each one, either deliver a finding that names it, or call `
    + `\`record_declination\` with a reason and grounds. DECLINING IS A COMPLETE ANSWER and most of `
    + `these should be declined — what cannot happen is a record leaving with neither, because then `
    + `nobody can tell a record you judged irrelevant from one that was lost.`;
}

export const DECLINATION_DUTY_EVENT_FIELDS = ["owed", "delivered", "declined", "unaccounted", "both"];

/** The run.jsonl row. `computable:false` carries its reason and NO counts — see the note above. */
export function declinationDutyEvent({ trigger = null, artifact = null, reason = null } = {}) {
  if (!artifact?.computable) {
    return { event: "declination-duty", trigger, computable: false, reason: reason ?? artifact?.reason ?? "not computed" };
  }
  const out = { event: "declination-duty", trigger, computable: true, reconciles: artifact.reconciles === true };
  for (const k of DECLINATION_DUTY_EVENT_FIELDS) out[k] = artifact.totals[k];
  return out;
}

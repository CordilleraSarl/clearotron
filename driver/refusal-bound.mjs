// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── ONE REFUSAL BOUND FOR EVERY TRANSPORT THAT LOOPS PER-ITEM OBLIGATIONS ─────────────────────────────
//
// 's Part 2. is the incident: one row of a meaning sweep was refused 217 times across three
// attempts, exhausted the stage's recoveries, and killed a production run that had already ruled 72 of
// its 73 obligations. Nothing delivered. The cure at that stage was a per-row bound and a park; this
// module is that cure written once, so the other members of the class do not each grow their own.
//
// WHAT IS SHARED AND WHAT IS DELIBERATELY NOT. The counting is identical everywhere and lives here. The
// RECORDING is not, and each transport keeps its own writer: disposition records the seat's `ruling` on
// refused rows because that field is what turns a cost defect into a correctness one (see its own note);
// coverage records `reason`/`detail`; declination records `why`. Folding those into one shape would cost
// the argument each carries and gain a shorter file.
//
// THE ID FIELD IS AN ARGUMENT AND IT THROWS WHEN ABSENT, for the same reason `call-repeat.mjs` refuses a
// missing `idField`: counting a property no record carries yields an empty map, so the bound never fires,
// and a bound that never fires is indistinguishable from a run where nothing was refused. That is the one
// failure this module would otherwise acquire in silence, so it is the one it refuses outright.
//
// WHICH FIELD EACH TRANSPORT KEYS ON, and why it is not a free choice:
//   disposition   `row_id`  — the driver's own id for a meaning obligation, stable for the run.
//   coverage      `row_id`  — CONTENT-derived (`shortId("CA", "axis:...")`), so it survives the canonical
//                             list being regenerated on every call.
//   declination   `uri`     — the REGISTER RECORD's own identifier, and NOT `row_index`. The index is a
//                             position into `_driver/declination-spec.json`, a list deliberately rewritten
//                             between the main and the corrective pass; the same position addresses a
//                             different record after a rewrite, so refusals keyed on it would pool onto
//                             whatever now sits at that offset and the bound would park an innocent row.
//                             `uri` is the key `appendDeclinations` already stores accepted declinations
//                             under, and it is a map key in the spec's producer, so it is non-null and
//                             unique by construction rather than by luck. Measured over 13 real specs and
//                             1,256 rows before this was built: present and distinct in every one.

/**
 * THE BOUND. Thirty, inherited from 's disposition park, where the number was argued from a real
 * ledger rather than chosen: twelve is refuted (two rows that were CONVERGING sat at 17), and 30 is still
 * a sevenfold cut from the 217 that killed the run. That argument is about the SHAPE of a live-lock, not
 * about meaning obligations, so it carries to the other members unchanged.
 *
 * COUNT IS NOT THE RIGHT DISCRIMINATOR and the fix is still deferred — a live-lock is FLAT while honest
 * difficulty CONVERGES, and `decideRecovery`'s `progress.kind` already computes that distinction with
 * nothing reading it. A trend-aware park would need no margin at all. Recorded here so the next
 * reader retunes with a ledger replay rather than by reasoning about the distribution.
 */
export const PARK_AFTER_REFUSALS = 30;

const keyOf = (rec, idField) => String(rec?.[idField] ?? "").trim();

/** Every refusal record in a verdict ledger, oldest first. A malformed entry contributes nothing. */
function* refusals(verdicts) {
  for (const v of verdicts ?? [])
    for (const r of (Array.isArray(v?.refused) ? v.refused : [])) yield r;
}

/**
 * How many times each item has been refused so far. PURE — the park's own evidence.
 *
 * COUNTED PER ITEM ACROSS CALLS, which is the unit 's banner records an earlier investigation dying
 * on when it joined per-item-final-state instead. A row refused on eight calls and ruled on the ninth
 * counts eight; a row refused eight times in ONE call also counts eight, because eight refusals is eight
 * refusals however they were batched.
 *
 * @param {object[]} verdicts  parsed verdict records, each `{refused: [...]}`.
 * @param {string} idField     REQUIRED. Which property names the item. Throws if absent — see the header.
 */
export function refusalCountsBy(verdicts, { idField } = {}) {
  if (!idField || typeof idField !== "string")
    throw new TypeError("refusalCountsBy: idField is required — counting an absent property parks nothing "
      + "and reads exactly like a run in which nothing was refused");
  const n = {};
  for (const r of refusals(verdicts)) {
    const k = keyOf(r, idField);
    if (k) n[k] = (n[k] ?? 0) + 1;
  }
  return n;
}

/**
 * Which items have been refused at or past the bound. PURE, and SORTED so one ledger always yields one
 * answer.
 *
 * An item that is accepted later is never re-parked by this function alone — the callers park only what
 * is still unresolved, exactly as disposition's union does.
 */
export function parkedIds(verdicts, { idField, bound = PARK_AFTER_REFUSALS } = {}) {
  const n = refusalCountsBy(verdicts, { idField });
  return Object.entries(n).filter(([, c]) => c >= bound).map(([id]) => id).sort();
}

/**
 * THE REFUSALS THAT NAMED NO ITEM — a total, never silently folded into the per-item counts.
 *
 * You cannot park an item you cannot name, so these can never reach the bound; but they are the majority
 * of some real ledgers (one production corpus: 28 refusals of a single call, all `unknown_row`) and a
 * histogram that drops them reads as "nothing was refused". Disposition already learned this the
 * expensive way: its fold reported 87 where the ledger held 88, the missing one being a refusal with an
 * empty id. Returned separately so a caller states coverage rather than deriving it.
 */
export function unattributedRefusals(verdicts, { idField } = {}) {
  if (!idField || typeof idField !== "string")
    throw new TypeError("unattributedRefusals: idField is required");
  let count = 0;
  const reasons = {};
  for (const r of refusals(verdicts)) {
    if (keyOf(r, idField)) continue;
    count += 1;
    const why = String(r?.reason ?? r?.why ?? "").trim() || "unnamed_reason";
    reasons[why] = (reasons[why] ?? 0) + 1;
  }
  return { count, reasons };
}

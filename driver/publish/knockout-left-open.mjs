// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/knockout-left-open.mjs — what a Knockout left open, as each name's page lists it under "Left open".
//
// ONE PROJECTION, TWO READERS. The name's page draws these rows, and the connector's coverage answer states them, so an
// assistant asked what a Knockout left open answers with what the delivered page told its reader, row for row and in the
// same words. Neither reader builds the rows itself.
import { KNOCKOUT_PAGE as K } from './strings.mjs';
import { plainDeferralReason } from '../deferral-row.mjs';   // the reader's words for a search left open
import { PART_NAMES } from '../degraded-parts.mjs';   // the parts' reader names

/**
 * WHAT A KNOCKOUT LEFT OPEN, from the run's own record (2026-11-18). PURE.
 *
 * A register step that failed is a row under the report's "Register" name: the listing that never came back is not
 * searched, and a reading that stopped part-way is partly covered. A name whose automated research was unavailable is a
 * row under its own name, not searched. The notes are the shipped lines, the deferral row's for a step and the page's
 * own for a name, so nothing here is a new sentence and nothing comes from model prose. A refused listing is not a
 * search that failed (the run never offered it), and a run with nothing left open returns no rows.
 */
export function knockoutLeftOpen(steps, marks = []) {
  return [
    ...(steps?.listing ? [{ area: PART_NAMES.register, state: 'not-searched', note: plainDeferralReason(steps.listing.reason) }] : []),
    ...(steps?.reading ? [{ area: PART_NAMES.register, state: 'coverage-limited', note: plainDeferralReason(steps.reading.reason) }] : []),
    ...(Array.isArray(marks) ? marks : []).filter((m) => m?.degraded === true && String(m?.name ?? '').trim())
      .map((m) => ({ area: String(m.name).trim(), state: 'not-searched', note: K.degradedNote })),
  ];
}

/**
 * ONE NAME'S LEFT OPEN ROWS FROM THE RUN'S REPORT DOCUMENT, as that name's page prints them. `at` is the name's place in
 * the findings record. The listing's row stands only where the run holds no listing of filings, and the name's own row
 * only where its research was unavailable; the steps are the ones the document holds, so a resume that settles a step
 * later changes nothing here until the report is published again. PURE.
 */
export function knockoutLeftOpenOf(doc, at) {
  const steps = doc?.scope?.steps ?? {};
  const mark = (doc?.client?.findings?.marks ?? [])[at];
  return knockoutLeftOpen({ listing: doc?.client?.registerRecords ? null : steps.listing, reading: steps.reading }, [mark]);
}

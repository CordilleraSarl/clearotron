// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/knockout-left-open.mjs — what a Knockout left open, as each name's page lists it under "Left open".
//
// ONE PROJECTION, TWO READERS. The name's page draws these rows, and the connector's coverage answer states them, so an
// assistant asked what a Knockout left open answers with what the delivered page told its reader, row for row and in the
// same words. Neither reader builds the rows itself.
import { KNOCKOUT_PAGE as K } from './strings.mjs';
import { plainDeferralReason, plainCause } from '../deferral-row.mjs';   // the reader's words for a search left open
import { PART_NAMES } from '../degraded-parts.mjs';   // the parts' reader names
import { COUNT_PREDICATES, countsForMark, disclosedFloor } from '../register-count.mjs';
import { recordsForMark } from '../register-records.mjs';

/**
 * WHAT A KNOCKOUT LEFT OPEN, from the run's own record (2026-11-18). PURE.
 *
 * A register step that failed is a row under the report's "Register" name: the listing that never came back is not
 * searched, and a reading that stopped part-way is partly covered. A name whose automated research was unavailable is a
 * row under its own name, not searched. The notes are the shipped lines, the deferral row's for a step and the page's
 * own for a name, so nothing here is a new sentence and nothing comes from model prose. A refused listing is not a
 * search that failed (the run never offered it), and a run with nothing left open returns no rows.
 *
 * `questions` is a name's own register row for its questions that have no answer (registerQuestionsLeftOpen). A register
 * step that failed already says the register was not searched or only partly, so beside it the question row is not
 * listed: the register is one row, never two rows that say different things about it.
 */
export function knockoutLeftOpen(steps, marks = [], questions = []) {
  const stepRows = [
    ...(steps?.listing ? [{ area: PART_NAMES.register, state: 'not-searched', note: plainDeferralReason(steps.listing.reason) }] : []),
    ...(steps?.reading ? [{ area: PART_NAMES.register, state: 'coverage-limited', note: plainDeferralReason(steps.reading.reason) }] : []),
  ];
  return [
    ...stepRows,
    ...(stepRows.length || !Array.isArray(questions) ? [] : questions),
    ...(Array.isArray(marks) ? marks : []).filter((m) => m?.degraded === true && String(m?.name ?? '').trim())
      .map((m) => ({ area: String(m.name).trim(), state: 'not-searched', note: K.degradedNote })),
  ];
}

// A name with no near-spelling under any rule had nothing to count in that column. It is a fact about the name, not a
// search that failed, and its cell says so in its own words (register-count.mjs countNote).
const NOTHING_TO_COUNT = /^no close-variation forms could be generated from /;

/**
 * A NAME'S OWN REGISTER QUESTIONS THAT HAVE NO ANSWER, as Left open rows (2026-11-23). PURE.
 *
 * A failed question used to show only as "not available" in a count cell, with its reason in a hover a printed page
 * drops, and a name whose other questions found filings printed those filings as if the name had been searched whole.
 * The questions the run asked for the name and holds no answer to, after the retries, are now one row under the report's
 * "Register" name: a count the register did not answer, a listing question that failed, and a class the plan took on
 * that no answer reached. Partly covered where any other question on the name answered, else not searched.
 *
 * WHAT IS NOT A ROW. A zero is an answer, and the page states it. A register's floor ("more than ten thousand") is an
 * answer. A crowd the reading set aside was answered and is on the record with its reason. A further question the
 * reading proposed and the run refused to send was never this name's search. A name with no near-spelling had nothing
 * to count.
 *
 * The note is the shipped line for the causes (plainCause): the timeout line where every one timed out, else the line for
 * a search left open. The register's own words stay on the run's record, because they carry the term asked and the
 * engine's text. Both shapes of the listing are read: a term row written before the listing kept a `state` says only `ok`.
 */
export function registerQuestionsLeftOpen(countsEntry, recordsEntry) {
  const causes = [];
  let answered = 0;
  for (const p of COUNT_PREDICATES) {
    const c = countsEntry?.counts?.[p.key];
    if (!c) continue;
    if (Number.isFinite(c.total) || disclosedFloor(c) !== null) { answered++; continue; }
    if (NOTHING_TO_COUNT.test(String(c.unavailable ?? ''))) continue;
    causes.push(c.cause ?? c.unavailable);
  }
  for (const t of Array.isArray(recordsEntry?.terms) ? recordsEntry.terms : []) {
    if (t?.refused != null) continue;
    const failed = t?.state ? t.state === 'failed' : t?.ok === false;
    if (failed) causes.push(t.reason);
    else if (t?.unresolved === true) causes.push(null);
    else if (t?.ok === true && t?.state !== 'not-asked') answered++;
  }
  if (!causes.length) return [];
  const timedOut = causes.every((c) => plainCause(c) === plainCause('timeout'));
  return [{ area: PART_NAMES.register, state: answered ? 'coverage-limited' : 'not-searched', note: plainCause(timedOut ? 'timeout' : null) }];
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
  const questions = registerQuestionsLeftOpen(countsForMark(doc?.client?.registerCounts, mark?.name),
    recordsForMark(doc?.client?.registerRecords, mark?.name));
  return knockoutLeftOpen({ listing: doc?.client?.registerRecords ? null : steps.listing, reading: steps.reading }, [mark], questions);
}

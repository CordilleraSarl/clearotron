// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// An instructed-check answer in the register write-up names the held records it relies on, and only those appear
// beneath it, labelled "Records relied on". The run's reading audit proves a record was opened, not which answer it
// supports, so it is rendered once under the audit trail and never under an answer. An answer recorded before it
// could name its records shows none. Driven through the recorder and the document later reviewers read. Pure, $0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptRegisterDigest, mergeDigestPatch, emptyFacts, joinKey, DIGEST_SECTIONS, renderRegisterFindings } from "../register-digest-record.mjs";
import { STAGES, paths } from "../stages.mjs";

const rec = (n, mark) => ({ record_id: `/mark/eu/0189990${n}`, mark_text: mark, owner_name: "Invented Owner GmbH", classes: ["09"], status: "Registered" });
const R1 = rec("01", "VELTRANE"), R2 = rec("02", "VELTRANO"), SHARED = rec("03", "VELTRAN"), ELSEWHERE = rec("04", "QUOMBLE");

function facts() {
  const f = emptyFacts();
  f.identity = { mark: "Veltrane", date: "2026-11-25", provider: "corsearch" };
  f.recordHost = "https://records.trademark.test";
  f.auditRows = [{ unit: "primary-sweep", searches: 3, detail_fetches: 2, query: "q1" }];
  // Every record the run opened, another step's read of ELSEWHERE included.
  f.readIds = [R1, R2, SHARED, ELSEWHERE].map((r) => r.record_id);
  for (const r of [R1, R2, SHARED, ELSEWHERE]) f.recordsByUri.set(joinKey(r.record_id), r);
  return f;
}

const ASK_A = "Is VELTRANE filed in class 9?", ASK_B = "Is VELTRANO filed in class 9?", ASK_C = "How many live marks share the element?";
// Every record the band holds ends somewhere, as the recorder requires of any call.
const ROWS = {
  findings_rows: [R1, R2, SHARED].map((r) => ({ uri: r.record_id, flag_reason: "Same element in class 9.", verify: "no" })),
  negative_rows: [{ uri: ELSEWHERE.record_id, drop_reason: "Unrelated goods.", ground: "off-field" }],
};
const CALL = { ...ROWS, instructed_checks: [
  { ask: ASK_A, answer: "Yes, registered.", records: [R1.record_id, SHARED.record_id] },
  { ask: ASK_B, answer: "Yes, registered.", records: [R2.record_id, SHARED.record_id] },
  { ask: ASK_C, answer: "Three, by the enumerated slice's count." },
] };

/** The lines under a heading of the rendered document, up to the next heading. */
const under = (md, heading) => {
  const lines = md.split("\n"), at = lines.indexOf(heading);
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && /^#{1,4} /.test(l));
  return lines.slice(at + 1, end < 0 ? lines.length : end).filter(Boolean);
};

test("each answer shows its own records, a shared record under both, and an answer resting on a count shows none", () => {
  const v = acceptRegisterDigest(CALL, facts());
  assert.ok(v.ok, v.reason);
  assert.deepEqual(under(v.content, DIGEST_SECTIONS.instructed), [
    `- You asked: ${ASK_A} → Yes, registered.`, `  - Records relied on: ${R1.record_id}, ${SHARED.record_id}`,
    `- You asked: ${ASK_B} → Yes, registered.`, `  - Records relied on: ${R2.record_id}, ${SHARED.record_id}`,
    `- You asked: ${ASK_C} → Three, by the enumerated slice's count.`,
  ]);
  assert.doesNotMatch(under(v.content, DIGEST_SECTIONS.instructed).join("\n"), new RegExp(ELSEWHERE.record_id), "a record another step opened was cited");
});

test("the run's reads appear once, under the audit trail, another step's included", () => {
  const md = acceptRegisterDigest(CALL, facts()).content;
  const reads = md.split("\n").filter((l) => l.startsWith("- records read: "));
  assert.equal(reads.length, 1, md);
  assert.ok(under(md, DIGEST_SECTIONS.auditTrail).includes(`- records read: ${facts().readIds.join(", ")}`));
});

test("a record the run does not hold is refused, and so is a records field that is not a list", () => {
  const unknown = acceptRegisterDigest({ instructed_checks: [{ ask: ASK_A, answer: "Yes.", records: ["/mark/eu/000000999"] }] }, facts());
  assert.match(unknown.reason, /^registerdigest_relied_record_unknown:\/mark\/eu\/000000999 \(Is VELTRANE filed in class 9\?\) — no record in this run's band carries that uri\./);
  const loose = acceptRegisterDigest({ instructed_checks: [{ ask: ASK_A, answer: "Yes.", records: R1.record_id }] }, facts());
  assert.match(loose.reason, /^registerdigest_relied_records_invalid:/);
});

test("a patch to one answer changes its records and keeps the other's", () => {
  const first = acceptRegisterDigest(CALL, facts());
  const merged = mergeDigestPatch(first.model, { patch: true, instructed_checks: [{ ask: ASK_A, answer: "Yes, registered.", records: [R1.record_id] }] });
  const v = acceptRegisterDigest(merged, facts());
  assert.ok(v.ok, v.reason);
  const answers = under(v.content, DIGEST_SECTIONS.instructed);
  assert.ok(answers.includes(`  - Records relied on: ${R1.record_id}`));
  assert.ok(answers.includes(`  - Records relied on: ${R2.record_id}, ${SHARED.record_id}`), "the other answer's records were lost");
});

test("an answer recorded before it could name its records shows none, never the run's reads", () => {
  const historical = { findings_rows: [], incumbent_rows: [], negative_rows: [], disagreement_resolutions: [],
    instructed_checks: [{ ask: ASK_A, answer: "Yes, registered." }] };
  const md = renderRegisterFindings(historical, facts());
  assert.deepEqual(under(md, DIGEST_SECTIONS.instructed), [`- You asked: ${ASK_A} → Yes, registered.`]);
});

test("the dispatch asks for the records each answer relies on, in design's words", () => {
  const msg = STAGES["register-digest"].message({ paths: paths("/r"), axes: ["primary-sweep"], intakeAsks: [{ owner: "register", ask: ASK_A }] });
  assert.match(msg, /\(band_shape \/ band_lookup \/ band_record\)\. Send each answer in `instructed_checks`\. Include the held record identifiers this answer relies on, where applicable\./);
  assert.match(msg, /`instructed_checks`: \{ask, answer, records\}\./);
  assert.doesNotMatch(msg, /record ids you read/);
});

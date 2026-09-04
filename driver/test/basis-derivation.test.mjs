// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — `verified-from-record` means THE RUN CAN PROVE IT, so the driver writes it.
//
// THE RULING (2026-08-10). The model never self-attests a read. A basis claim is exact data, and exact
// data is the machine's to write — the same rule that built every form in this program.
//
// WHAT IT REPLACED. A third synthesis pass: the driver computed the stamp×record×reading-log join, then
// handed the violations back to the model as a warm resume to re-read and re-rate. 771.7 / 510.8 /
// 535.9 s on three of the round's four runs, ~10 serial minutes each, `violations: 0` every time.
//
// THE TWO HOLES A DERIVATION CLOSES, both measured on the archived runs the pass itself scored:
//
//   1. IT RAN ONCE, BEFORE REFUTATION. Re-derived on the delivered findings.json, its own counts do not
//      hold — 35→37, 28→31, 37→38, 41→40. Stamps entered and left the deliverable after the only pass
//      that policed them.
//   2. `off_disk` WAS NEVER A VIOLATION. the 2026-08-10 R6 delivered on its own artifact
//      reading {"stamped":19,"read":0,"off_disk":19,"violations":0} — nineteen meters resting on the
//      official record, zero of those records ever fetched, and no violation reported.
//
// Run:  node --test driver/test/basis-derivation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { unprovableRecordBases, applyDerivedBases, findUnreadRatedSources } from "../recall-reconciliation.mjs";

const URI_A = "/mark/us/USAFI111";
const URI_B = "/mark/us/USAFI222";

const finding = (ordinal, mark, meters) => ({ ordinal, mark, meters });
const verified = (uri) => ({ token: "high", basis: "verified-from-record", source: uri });
const inferred = () => ({ token: "medium", basis: "inferred-from-signal" });

const DOC = {
  findings: [
    finding(1, "ALPHA", { mark_similarity: verified(URI_A), enforcer: inferred() }),
    finding(2, "BETA", { mark_similarity: verified(URI_B), goods_proximity: verified(URI_B) }),
  ],
};

test("#563 a record the run NEVER FETCHED cannot support a verified stamp — the hole the old gate had", () => {
  // This is that R6's shape: everything stamped, nothing on disk. The pass it replaces counted
  // these as `off_disk` and reported violations: 0.
  const rows = unprovableRecordBases({ findings: DOC.findings, hasRecord: () => false, wasRead: () => false });
  assert.equal(rows.length, 3, "all three verified meters are unprovable");
  assert.ok(rows.every((r) => r.why === "record-never-fetched"));
  assert.ok(rows.every((r) => r.from === "verified-from-record" && r.to === "inferred-from-signal"));

  // …and the old join agrees it saw them and called them fine, which is the point of quoting it here.
  const old = findUnreadRatedSources({ findings: DOC.findings, hasRecord: () => false, wasRead: () => false });
  assert.equal(old.rows.length, 3, "the old join SAW all three");
  assert.equal(old.violations.length, 0, "and reported no violation — the run shipped on it");
});

test("#563 a record on disk that was never read is demoted too — the old violation, now an outcome", () => {
  const rows = unprovableRecordBases({ findings: DOC.findings, hasRecord: () => true, wasRead: () => false });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.why === "record-on-disk-never-read"),
    "the two causes are distinguished — one is a missing fetch, the other a missing read, and the repairs differ");
});

test("#563 a PROVEN read is left alone — the derivation only ever moves a claim down to its evidence", () => {
  const rows = unprovableRecordBases({ findings: DOC.findings, hasRecord: () => true, wasRead: () => true });
  assert.deepEqual(rows, [], "nothing to demote when the log backs every claim");
  const { doc, applied } = applyDerivedBases(DOC, rows);
  assert.equal(applied, 0);
  assert.deepEqual(doc.findings, DOC.findings, "and the findings are returned unchanged");
});

test("#563 a partially-proven run demotes exactly the unproven meters, and nothing else", () => {
  const readA = (uri) => uri === URI_A.toLowerCase();
  const rows = unprovableRecordBases({ findings: DOC.findings, hasRecord: () => true, wasRead: readA });
  assert.deepEqual(rows.map((r) => `${r.ordinal}/${r.meter}`), ["2/mark_similarity", "2/goods_proximity"]);
  const { doc, applied } = applyDerivedBases(DOC, rows);
  assert.equal(applied, 2);
  assert.equal(doc.findings[0].meters.mark_similarity.basis, "verified-from-record", "the proven claim stands");
  assert.equal(doc.findings[1].meters.mark_similarity.basis, "inferred-from-signal");
  assert.equal(doc.findings[1].meters.goods_proximity.basis, "inferred-from-signal");
  assert.equal(doc.findings[1].meters.mark_similarity.source, URI_B,
    "the source SURVIVES the demotion — it is still the lead the claim points at, and dropping it would "
    + "destroy the only thing telling a reader which record to go and read");
  assert.equal(DOC.findings[1].meters.mark_similarity.basis, "verified-from-record", "the input doc is not mutated");
});

test("#563 a meter citing a WEBSITE is out of scope — the reading log does not cover the open web", () => {
  // Demoting on evidence nothing collects would be a guess wearing a machine's authority. The scope is
  // register records, exactly as the join it is built on always was.
  const web = { findings: [finding(1, "GAMMA", { use: { token: "confirmed", basis: "verified-from-record", source: "https://example.com/products" } })] };
  assert.deepEqual(unprovableRecordBases({ findings: web.findings, hasRecord: () => false, wasRead: () => false }), []);
});

test("#563 a WITHDRAWN finding is not judged — it is not in the deliverable to be wrong in", () => {
  const withdrawn = { findings: [{ ...DOC.findings[0], disposition: "withdrawn" }] };
  assert.deepEqual(unprovableRecordBases({ findings: withdrawn.findings, hasRecord: () => true, wasRead: () => false }), []);
});

// ── THE DIFFERENTIAL, as the ruling requires it: the pass's own runs, re-derived ────────────────────
//
// The ruling's condition is that the replacement must not weaken what the pass enforced, differentially
// proved against {stamped:35,read:35}, {28,28}, {37,37}. Those three agree — and agreement alone proves
// nothing, because a derivation that returned "read" unconditionally would reproduce all three exactly.
// So the fixture carries BOTH: the agreeing shape AND the disagreeing one from the same round.
test("#563 differential: the three all-read runs re-derive to zero demotions, and R6's shape demotes 19", () => {
  const nRun = (n, allRead) => ({
    findings: Array.from({ length: n }, (_, i) =>
      finding(i + 1, `M${i}`, { mark_similarity: { token: "high", basis: "verified-from-record", source: `/mark/us/U${i}` } })),
    allRead,
  });

  for (const stamped of [35, 28, 37]) {
    const run = nRun(stamped, true);
    const rows = unprovableRecordBases({ findings: run.findings, hasRecord: () => true, wasRead: () => true });
    assert.equal(findUnreadRatedSources({ findings: run.findings, hasRecord: () => true, wasRead: () => true }).rows.length, stamped,
      `${stamped} stamps counted, as the pass counted them`);
    assert.deepEqual(rows, [], `${stamped}/${stamped} → nothing demoted: the derivation agrees with the pass where the pass was right`);
  }

  // The 2026-08-10 R6: 19 stamped, 0 on disk. The pass called this violations:0 and the run delivered.
  const r6 = nRun(19, false);
  const old = findUnreadRatedSources({ findings: r6.findings, hasRecord: () => false, wasRead: () => false });
  assert.equal(old.rows.length, 19);
  assert.equal(old.violations.length, 0, "THE PASS SAW NOTHING WRONG — this is the case the agreement cannot show");
  const rows = unprovableRecordBases({ findings: r6.findings, hasRecord: () => false, wasRead: () => false });
  assert.equal(rows.length, 19, "the derivation demotes all nineteen");
  const { applied } = applyDerivedBases(r6, rows);
  assert.equal(applied, 19);
});

test("#563 a meter already inferred is NOT counted as applied — `applied` is what the shortfall check reads", () => {
  // The caller compares `applied` against its own demotion list to decide whether an unprovable claim is
  // still standing. A no-op that inflated the count would hide exactly that. This is the assertion that
  // makes the `basis !== "verified-from-record"` guard behaviour rather than decoration.
  const doc = { findings: [finding(1, "ALPHA", { mark_similarity: verified(URI_A), enforcer: inferred() })] };
  const { applied } = applyDerivedBases(doc, [
    { ordinal: 1, meter: "mark_similarity" },
    { ordinal: 1, meter: "enforcer" },        // already inferred — nothing to do
  ]);
  assert.equal(applied, 1, "one real demotion, not two");
});

test("#563 a finding with NO ordinal cannot be matched — and the shortfall is visible, not silent", () => {
  // The demotions are computed against the LENIENT parse and applied to the STRICT one. If the raw file
  // carries no ordinal on a finding, the match finds nothing — and `applied < demotions.length` is the
  // only signal that an unprovable claim is still standing. It must be derivable by the caller.
  const raw = { findings: [{ mark: "ALPHA", meters: { mark_similarity: verified(URI_A) } }] };   // no ordinal
  const demotions = [{ ordinal: 1, meter: "mark_similarity", mark: "ALPHA", uri: URI_A, why: "record-never-fetched" }];
  const { applied, doc } = applyDerivedBases(raw, demotions);
  assert.equal(applied, 0, "nothing matched");
  assert.notEqual(applied, demotions.length, "and the caller can see it — this inequality is the alarm");
  assert.equal(doc.findings[0].meters.mark_similarity.basis, "verified-from-record",
    "the unprovable claim is STILL STANDING, which is precisely why the caller must say so out loud");
});

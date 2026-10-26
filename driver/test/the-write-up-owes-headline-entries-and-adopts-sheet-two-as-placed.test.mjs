// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WRITE-UP OWES PLACEMENT'S HEADLINE ENTRIES, AND SHEET 2 IS ADOPTED AS PLACED.
//
// The register write-up owed an ending to every record of every placement: on a test run of a crowded matter, 1,132
// records, about 530 of the 905 sheet-2 records ended only because disagreement resolutions named them. Now it owes an
// ending to placement's headline entries, judged per entry: a row naming any record of an entry ends the whole entry.
// A sheet-2 entry is adopted as placed: the render writes one row for it, on its first live record, else its first,
// with placement's reason word for word and verify "yes". Any row of the write-up's own naming any record of a sheet-2
// entry overrides the whole entry, and the driver adopts none of it. Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptRegisterDigest, emptyFacts, joinKey, readDigestFacts, recordRegisterDigest, digestAccountingGap } from "../register-digest-record.mjs";
import { placementIndex } from "../record-carry.mjs";
import { writeRegisterDigestFacts } from "../pipeline.mjs";
import { paths } from "../stages.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const rec = (id, mark, owner, status = "Registered") => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["9"], status });
const BAND = [
  rec("h1", "QZORVA", "Alpha Ltd"), rec("h2", "QZORVA", "Alpha Ltd"),           // a headline entry, two records
  rec("s1dead", "QZORVEK", "Beta GmbH", "Expired"), rec("s1live", "QZORVEK", "Beta GmbH"),   // sheet 2, dead record first
  rec("s2a", "QZORVIN", "Gamma SA"), rec("s2b", "QZORVIN", "Gamma SA"),         // sheet 2, overridden by a row
  rec("s3", "QZORVAX", "Delta AG"),                                             // sheet 2, overridden by a disagreement
  rec("w1", "QZORVO", "Epsilon BV"),                                            // the watchlist annex
];
const PLACEMENTS = [
  { mark: "QZORVA", owner: "Alpha Ltd", jurisdiction: "EU", tier: "headline-candidate", records: ["/mark/eu/h1", "/mark/eu/h2"], reason: "identical, live, for the client's own goods" },
  { mark: "QZORVEK", owner: "Beta GmbH", jurisdiction: "EU", tier: "sheet-2", records: ["/mark/eu/s1dead", "/mark/eu/s1live"], reason: "a near form for printers: completes the record, changes nothing" },
  { mark: "QZORVIN", owner: "Gamma SA", jurisdiction: "EU", tier: "sheet-2", records: ["/mark/eu/s2a", "/mark/eu/s2b"], reason: "a near form for kitchenware" },
  { mark: "QZORVAX", owner: "Delta AG", jurisdiction: "EU", tier: "sheet-2", records: ["/mark/eu/s3"], reason: "a near form for garden tools" },
  { mark: "QZORVO", owner: "Epsilon BV", jurisdiction: "EU", tier: "watchlist-annex", records: ["/mark/eu/w1"], reason: "pending, watch it" },
  { mark: "QZORVU", owner: "Zeta Oy", jurisdiction: "EU", tier: "sheet-2", records: [], reason: "a web page, no register record" },
];

function seed(t) {
  const runDir = mkdtempSync(join(tmpdir(), "write-up-entries-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  const P = paths(runDir);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: BAND }) + "\n");
  writeFileSync(P.placementModel, JSON.stringify({ schema_version: 1, placements: PLACEMENTS }) + "\n");
  writeRegisterDigestFacts({ paths: P, job: { markName: "QZORVA" }, run: { slug: "s", codename: "c" } }, "test");
  return { runDir, facts: readDigestFacts(runDir) };
}
const ROWS = {
  findings_rows: [{ uri: "/mark/eu/h2", flag_reason: "identical, live, for the client's own goods", verify: "yes" },
    { uri: "/mark/eu/s2b", flag_reason: "a near form whose goods reach the client's: it changes the advice", verify: "yes" }],
  disagreement_resolutions: [{ subject: "QZORVAX (/mark/eu/s3)", decision: "OVERRODE", reason: "placement read garden tools; the record's goods are game controllers" }],
};

test("the driver owes the write-up placement's headline entries, and adopts its sheet-2 entries on their first live record", (t) => {
  const { facts } = seed(t);
  assert.deepEqual(facts.owedEntries, [{ uris: ["/mark/eu/h1", "/mark/eu/h2"] }], "the owed entries are not the headline entry alone");
  assert.deepEqual([...facts.owed].sort(), ["/mark/eu/h1", "/mark/eu/h2"], "a sheet-2 or watchlist record is still owed one by one");
  assert.deepEqual(facts.adopt.map((e) => [e.uri, e.reason]), [
    ["/mark/eu/s1live", PLACEMENTS[1].reason], ["/mark/eu/s2a", PLACEMENTS[2].reason], ["/mark/eu/s3", PLACEMENTS[3].reason],
  ], "an entry is not adopted on its first live record with placement's reason, or a watchlist entry or one with no records was adopted");
});

test("a row naming any record of a headline entry ends it, and an entry no row names is refused by its first record", (t) => {
  const { facts } = seed(t);
  const ok = acceptRegisterDigest(ROWS, facts);
  assert.equal(ok.ok, true, ok.reason);
  const open = acceptRegisterDigest({ ...ROWS, findings_rows: ROWS.findings_rows.slice(1) }, facts);
  assert.equal(open.ok, false);
  assert.match(open.reason, /^registerdigest_unaccounted_records:1 of 1 position\(s\) .*: \/mark\/eu\/h1\./, open.reason);
});

test("sheet 2 carries one adopted row per entry the write-up did not override, with placement's reason and verify yes", (t) => {
  const { facts } = seed(t);
  const { content } = acceptRegisterDigest(ROWS, facts);
  const sheet2 = content.slice(content.indexOf("Sheet 2"));
  assert.ok(sheet2.includes("/mark/eu/s1live") && sheet2.includes(PLACEMENTS[1].reason), "the adopted row is missing, or not on the live record");
  assert.match(sheet2, new RegExp(`${PLACEMENTS[1].reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|\\s*yes`), "the adopted row is not marked for checking");
  assert.ok(!sheet2.includes("/mark/eu/s1dead"), "the adopted row sits on the dead record");
  assert.ok(!sheet2.includes(PLACEMENTS[2].reason), "an entry the write-up's own row overrode was adopted too");
  assert.ok(!sheet2.includes(PLACEMENTS[3].reason), "an entry a disagreement resolution overrode was adopted too");
});

test("every record of an adopted entry reads as carried, so none is traced as a silent drop", (t) => {
  const { facts } = seed(t);
  const { content } = acceptRegisterDigest(ROWS, facts);
  const idx = placementIndex(PLACEMENTS, content);
  for (const u of ["/mark/eu/s1dead", "/mark/eu/s1live"]) assert.equal(idx.get(u)?.carry, "carried", `${u} of the adopted entry is not carried`);
});

test("the exit gate judges the write-up per entry", (t) => {
  const { runDir } = seed(t);
  assert.deepEqual(digestAccountingGap(runDir).unaccounted, ["/mark/eu/h1"], "guard: before any call the entry is owed, by its first record");
  const r = recordRegisterDigest(runDir, ROWS);
  assert.equal(r.refused, null, r.refused);
  assert.deepEqual(digestAccountingGap(runDir).unaccounted, [], "an entry ended by its second record is still owed");
  assert.equal(joinKey("/mark/eu/h1"), "/mark/eu/h1");
  assert.equal(emptyFacts().adopt.length, 0);
});

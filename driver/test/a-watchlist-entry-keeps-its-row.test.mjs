// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A WATCHLIST-ANNEX ENTRY KEEPS ITS ROW, ADOPTED AS PLACED.
//
// Placement places each candidate at one of four tiers. The write-up is owed the headline entries and adopts a sheet-2
// entry as placed, but a watchlist-annex entry was owed nothing, on the premise that it kept a tab of its own, and the
// write-up's render has no such tab. On a test run of a crowded matter, 2026-10-28, the one watchlist-annex entry reached
// no surface, and the delivery check reported its record dropped with no step recording a ground. The entry is now
// adopted into a watchlist annex exactly as a sheet-2 entry is into the context table: placement's reason word for word,
// unless the write-up writes a row of its own for it. Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptRegisterDigest, readDigestFacts, recordRegisterDigest, digestAccountingGap, DIGEST_SECTIONS } from "../register-digest-record.mjs";
import { placementIndex } from "../record-carry.mjs";
import { writeRegisterDigestFacts } from "../pipeline.mjs";
import { paths } from "../stages.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const rec = (id, mark, owner, status = "Registered") => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["28"], status });
const BAND = [
  rec("h1", "TARNEVIQ", "Halvent Ltd"),                     // a headline entry
  rec("w1", "TARNEVIN", "Ostrel GmbH", "Expired"),          // a watchlist entry the write-up says nothing about
  rec("w2", "TARNEVAX", "Pellow SA"),                       // a watchlist entry the write-up writes its own row for
];
const watch = (mark, owner, id, reason) => ({ mark, owner, jurisdiction: "EU", tier: "watchlist-annex", records: [`/mark/eu/${id}`], reason });
const PLACEMENTS = [
  { mark: "TARNEVIQ", owner: "Halvent Ltd", jurisdiction: "EU", tier: "headline-candidate", records: ["/mark/eu/h1"], reason: "identical, live, for the client's own goods" },
  watch("TARNEVIN", "Ostrel GmbH", "w1", "an expired near form for toy kites: worth a line of awareness, changes nothing"),
  watch("TARNEVAX", "Pellow SA", "w2", "a near form for skates"),
];
const CALL = {
  findings_rows: [{ uri: "/mark/eu/h1", flag_reason: "identical, live, for the client's own goods", verify: "yes" },
    { uri: "/mark/eu/w2", flag_reason: "a near form whose skates reach the client's goods: it changes the advice", verify: "yes" }],
};

function seed(t) {
  const runDir = mkdtempSync(join(tmpdir(), "watchlist-entry-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  const P = paths(runDir);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: BAND }) + "\n");
  writeFileSync(P.placementModel, JSON.stringify({ schema_version: 1, placements: PLACEMENTS }) + "\n");
  writeRegisterDigestFacts({ paths: P, job: { markName: "TARNEVIQ" }, run: { slug: "s", codename: "c" } }, "test");
  return { runDir, facts: readDigestFacts(runDir) };
}
// The watchlist annex, or "" when the document has none: a section with no rows is not rendered.
const annexOf = (content) => {
  const at = content.indexOf(DIGEST_SECTIONS.watchlist);
  if (at < 0) return "";
  const end = content.indexOf("\n### ", at + 1);
  return content.slice(at, end < 0 ? undefined : end);
};

test("a watchlist-annex entry the write-up says nothing about keeps its row, with placement's reason and verify yes", (t) => {
  const { facts } = seed(t);
  const r = acceptRegisterDigest(CALL, facts);
  assert.equal(r.ok, true, r.reason);
  const annex = annexOf(r.content);
  assert.ok(annex, "the document has no watchlist annex");
  assert.ok(annex.includes("/mark/eu/w1"), "the watchlist entry lost its row");
  assert.match(annex, /worth a line of awareness, changes nothing\s*\|\s*yes/, "its row does not carry placement's reason for checking");
});

test("THE CONTROL: the write-up's own row for a watchlist entry still replaces it", (t) => {
  const { facts } = seed(t);
  assert.ok(!annexOf(acceptRegisterDigest(CALL, facts).content).includes(PLACEMENTS[2].reason),
    "an entry the write-up's own row replaced was adopted too");
});

test("the adopted entry reads as carried, so its ending is no longer a silent drop", (t) => {
  const { facts } = seed(t);
  const idx = placementIndex(PLACEMENTS, acceptRegisterDigest(CALL, facts).content);
  assert.equal(idx.get("/mark/eu/w1")?.carry, "carried");
});

test("the accounting gate is unchanged: a watchlist entry is still owed nothing", (t) => {
  const { runDir } = seed(t);
  const r = recordRegisterDigest(runDir, CALL);
  assert.equal(r.refused, null, r.refused);
  assert.deepEqual(digestAccountingGap(runDir).unaccounted, []);
});

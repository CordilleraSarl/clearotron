// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SHEET-2 ENTRY THE WRITE-UP KEEPS AS PLACED KEEPS ITS ROW.
//
// The write-up resolves each placement disagreement and each borderline entry explicitly: ADOPTED keeps placement's
// placement, OVERRODE replaces it. The driver dropped a sheet-2 entry's automatic row whenever any resolution named it,
// so an adoption rendered exactly as an override. On a test run of a crowded matter, 2026-10-27, the write-up kept 135
// entries as context with ADOPTED resolutions; the context table carried 10 automatic rows instead of 145, and review had
// to restore them by hand before the writer was owed them. Only the write-up's own row, or an OVERRODE resolution,
// replaces an entry adopted as placed. Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptRegisterDigest, readDigestFacts, recordRegisterDigest, digestAccountingGap } from "../register-digest-record.mjs";
import { placementIndex } from "../record-carry.mjs";
import { writeRegisterDigestFacts } from "../pipeline.mjs";
import { paths } from "../stages.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const rec = (id, mark, owner) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["28"], status: "Registered" });
const BAND = [
  rec("h1", "VOLMERIQ", "Ardent Ltd"),                                            // a headline entry
  rec("k1", "VOLMERAN", "Brisk GmbH"), rec("k2", "VOLMERON", "Cobalt SA"), rec("k3", "VOLMERUS", "Dorne AG"),   // kept as placed
  rec("o1", "VOLMERIX", "Ember BV"),                                              // overridden by a resolution
  rec("r1", "VOLMERAL", "Fable Oy"),                                              // overridden by the write-up's own row
];
const sheet2 = (mark, owner, id, reason) => ({ mark, owner, jurisdiction: "EU", tier: "sheet-2", records: [`/mark/eu/${id}`], reason, borderline: true });
const PLACEMENTS = [
  { mark: "VOLMERIQ", owner: "Ardent Ltd", jurisdiction: "EU", tier: "headline-candidate", records: ["/mark/eu/h1"], reason: "identical, live, for the client's own goods" },
  sheet2("VOLMERAN", "Brisk GmbH", "k1", "a near form for board games: completes the record, changes nothing"),
  sheet2("VOLMERON", "Cobalt SA", "k2", "a near form for kites: completes the record, changes nothing"),
  sheet2("VOLMERUS", "Dorne AG", "k3", "a near form for puzzles: completes the record, changes nothing"),
  sheet2("VOLMERIX", "Ember BV", "o1", "a near form for swings"),
  sheet2("VOLMERAL", "Fable Oy", "r1", "a near form for skates"),
];
const kept = (id, mark) => ({ subject: `${mark} (/mark/eu/${id}) — borderline sheet-2`, decision: "ADOPTED", reason: "the goods sit beside the client's but the advice reads the same either way" });
const CALL = {
  findings_rows: [{ uri: "/mark/eu/h1", flag_reason: "identical, live, for the client's own goods", verify: "yes" },
    { uri: "/mark/eu/r1", flag_reason: "a near form whose skates reach the client's goods: it changes the advice", verify: "yes" }],
  disagreement_resolutions: [kept("k1", "VOLMERAN"), kept("k2", "VOLMERON"), kept("k3", "VOLMERUS"),
    { subject: "VOLMERIX (/mark/eu/o1) — borderline sheet-2", decision: "OVERRODE", reason: "placement read swings; the record's goods are the client's own game consoles" }],
};

function seed(t) {
  const runDir = mkdtempSync(join(tmpdir(), "kept-sheet-two-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  const P = paths(runDir);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: BAND }) + "\n");
  writeFileSync(P.placementModel, JSON.stringify({ schema_version: 1, placements: PLACEMENTS }) + "\n");
  writeRegisterDigestFacts({ paths: P, job: { markName: "VOLMERIQ" }, run: { slug: "s", codename: "c" } }, "test");
  return { runDir, facts: readDigestFacts(runDir) };
}
// The Sheet 2 section, or "" when the document has none: a section with no rows is not rendered.
const sheetTwoOf = (content) => {
  const at = content.indexOf("Sheet 2");
  if (at < 0) return "";
  const end = content.indexOf("\n### ", at + 1);
  return content.slice(at, end < 0 ? undefined : end);
};

test("every sheet-2 entry the write-up keeps with ADOPTED keeps its row, with placement's reason and verify yes", (t) => {
  const { facts } = seed(t);
  const r = acceptRegisterDigest(CALL, facts);
  assert.equal(r.ok, true, r.reason);
  const s2 = sheetTwoOf(r.content);
  assert.ok(s2, "the document has no Sheet 2 section");
  for (const p of PLACEMENTS.slice(1, 4)) {
    assert.ok(s2.includes(p.records[0]), `${p.mark}, kept as placed, lost its row`);
    assert.match(s2, new RegExp(`${p.reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|\\s*yes`), `${p.mark}'s row does not carry placement's reason for checking`);
  }
  assert.ok(r.content.includes("**ADOPTED**"), "the adoptions are no longer rendered under Disagreement resolutions");
});

test("THE CONTROL: an OVERRODE resolution, or the write-up's own row, still replaces the entry", (t) => {
  const { facts } = seed(t);
  const s2 = sheetTwoOf(acceptRegisterDigest(CALL, facts).content);
  assert.ok(!s2.includes(PLACEMENTS[4].reason), "an entry an OVERRODE resolution replaced was adopted too");
  assert.ok(!s2.includes(PLACEMENTS[5].reason), "an entry the write-up's own row replaced was adopted too");
});

test("the kept entries read as carried, so the writer is owed them", (t) => {
  const { facts } = seed(t);
  const idx = placementIndex(PLACEMENTS, acceptRegisterDigest(CALL, facts).content);
  for (const id of ["k1", "k2", "k3"]) assert.equal(idx.get(`/mark/eu/${id}`)?.carry, "carried", `${id}, kept as placed, is not carried`);
});

test("the accounting gate is unchanged: the recorded call ends every owed entry", (t) => {
  const { runDir } = seed(t);
  const r = recordRegisterDigest(runDir, CALL);
  assert.equal(r.refused, null, r.refused);
  assert.deepEqual(digestAccountingGap(runDir).unaccounted, []);
});

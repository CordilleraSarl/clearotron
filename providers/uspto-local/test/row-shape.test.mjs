// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// row-shape.test.mjs — the band row's key names, and the classifier that would otherwise screen nothing.
//
// Both defects covered here are invisible at runtime. A row with signa's key names is a plain object
// that reads as null on every band field, so the band renders empty while every stage reports
// success. A classifier built on the shared defaults returns "ambiguous" for every USPTO code, so
// the whole band goes to deepfetch and nothing is ever screened — slower, more expensive, and
// indistinguishable from working.

import { test } from "node:test";
import assert from "node:assert/strict";

import { toBandRow, toNeutralRecord, rowScreen, classifyUsptoStatus } from "../src/row.js";
import { normalizeBrandRow, screenVerdict } from "../../_shared/screen.mjs";

const RECORD = {
  uri: "/mark/us/86264144",
  record_id: "/mark/us/86264144",
  office: "US",
  id: "86264144",
  applicationNumber: "86264144",
  registrationNumber: "4712345",
  mark_text: "ARBORA & SONS",
  status: "800",
  statusClass: "live",
  owner_name: "ARBORA HOLDINGS SA",
  owner_country: "CH",
  niceClasses: ["009", "042"],
  applicationDate: "2014-04-25",
  registrationDate: "2015-03-31",
  expiryDate: "2025-03-31",
  goodsAndServices: "Computer software.",
  resolved_link: "https://tsdr.uspto.gov/#caseNumber=86264144&caseType=SERIAL_NO&searchType=statusSearch",
};

test("the band row uses the FLAT contract names, not signa's", () => {
  const r = toBandRow(RECORD);
  for (const k of ["record_id", "mark_text", "classes", "status", "owner_name", "owner_country",
    "application_date", "registration_date", "expiry_date", "mark_feature"]) {
    assert.ok(k in r, `band row is missing the contract key ${k}`);
  }
  // The names that would silently render an empty band if they leaked in from signa's shape.
  for (const wrong of ["nice_classes", "owner", "filing_date"]) {
    assert.ok(!(wrong in r), `${wrong} is signa's name — the band contract reads a different key`);
  }
  assert.deepEqual(r.classes, ["009", "042"]);
  assert.equal(r.owner_name, "ARBORA HOLDINGS SA");
  assert.equal(r.application_date, "2014-04-25");
});

test("every field supplemental's preview reads resolves on a populated row", () => {
  // PREVIEW_FIELDS in driver/engine/mcp/supplemental.mjs. A key that does not resolve shows the
  // model a null and nothing reports a fault.
  const r = rowScreen(RECORD, [9]);
  for (const k of ["record_id", "mark_text", "classes", "status", "owner_name", "owner_country"]) {
    assert.notEqual(r[k], null, `preview field ${k} is null on a fully populated record`);
  }
  assert.ok(r.screen_verdict, "screen_verdict resolves FLAT on the screened row");
  assert.ok(!("screen" in r),
    "rowScreen must NOT wrap itself — makeEnumerate composes { ...record, screen: row }, so a "
    + "self-nested row ends at record.screen.screen.screen_verdict and every consumer misses by one level");
});

test("the neutral record keeps its own vocabulary, distinct from the band row", () => {
  const n = toNeutralRecord(RECORD);
  assert.equal(n.applicationNumber, "86264144");
  assert.equal(n.statusClass, "live");
  assert.deepEqual(n.niceClasses, ["009", "042"]);
  assert.equal(n.owner, "ARBORA HOLDINGS SA");
  assert.equal(n.ownerCountry, "CH");
  assert.equal(n.office, "US");
  assert.equal(n.oppositions, null, "the index holds no TTAB data — declared, not implied empty");
  // The two shapes coexist on purpose; neither is the other's rename.
  const b = toBandRow(RECORD);
  assert.ok("owner_name" in b && "owner" in n);
  assert.ok(!("owner_name" in n) && !("owner" in b));
});

test("USPTO codes classify against USPTO's vocabulary, not the shared defaults", () => {
  // THE SILENT ONE. makeClassifyStatus's defaults are corsearch brand-json tokens (valid, pending,
  // graceperiod / invalid, expired). A three-digit USPTO code matches none of them.
  assert.equal(classifyUsptoStatus("800"), "live", "800 = REGISTERED AND RENEWED");
  assert.equal(classifyUsptoStatus("700"), "live");
  assert.equal(classifyUsptoStatus("601"), "dead");
  assert.equal(classifyUsptoStatus("000"), "ambiguous", "unknown is fetched and looked at, never dropped");
  assert.equal(classifyUsptoStatus("123"), "ambiguous");

  // Prove the default classifier would have screened NOTHING — this is the assertion that would
  // have caught it.
  const withDefaults = normalizeBrandRow({ status: "800", classes: [9] });
  assert.equal(withDefaults.live_status, "ambiguous",
    "the shared default cannot read a USPTO code — which is why the classifier is injected");
  assert.equal(screenVerdict(withDefaults, [9]), "deepfetch:ambiguous",
    "with the default, every row in every band would go to deepfetch and nothing would be screened");
});

test("screening verdicts follow the closed set", () => {
  assert.equal(rowScreen(RECORD, [9]).screen_verdict, "surface:in-scope-live");
  assert.equal(rowScreen({ ...RECORD, status: "601" }, [9]).screen_verdict, "drop:dead");
  assert.equal(rowScreen({ ...RECORD, status: "000" }, [9]).screen_verdict, "deepfetch:ambiguous");
  assert.equal(rowScreen(RECORD, [35]).screen_verdict, "drop:out-of-class");
  assert.equal(rowScreen(RECORD, []).screen_verdict, "surface:in-scope-live",
    "with no scope declared, a live mark is never class-dropped — recall over thrift");
});

test("an all-class registration is never class-dropped", () => {
  const allClass = { ...RECORD, niceClasses: Array.from({ length: 45 }, (_, i) => String(i + 1)) };
  assert.equal(rowScreen(allClass, [35]).screen_verdict, "surface:all-class");
});

test("a dead mark outranks an out-of-class one, so the verdict is stable", () => {
  // Ordering inside screenVerdict is contract: all-class, then dead, then ambiguous, then class.
  assert.equal(rowScreen({ ...RECORD, status: "601" }, [35]).screen_verdict, "drop:dead");
});

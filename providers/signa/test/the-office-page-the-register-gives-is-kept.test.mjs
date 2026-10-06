// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-office-page-the-register-gives-is-kept.test.mjs — `office_url`, carried as data for publish.
//
// The register now hands over a link to each record on the office's own site, absent on some records.
// The normaliser dropped it, so publish could not fall back on it where it cannot address the office's
// page from the record's numbers. It is kept, https only; the register's own record link stays null,
// because the register publishes no page per record of its own.
//
// No vendor measurements and no mark live here; the record is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRecord } from "../src/core.js";

const rec = (extra) => ({ id: "tm_invented", jurisdiction_code: "SG", mark_text: "ZYTHERMO", ...extra });

test("the office's page the register gives is kept on the record", () => {
  const out = normalizeRecord(rec({ office_url: "https://office.invalid/record/1" }));
  assert.equal(out.officeUrl, "https://office.invalid/record/1");
  assert.equal(out.resolved_link, null, "the register still publishes no page of its own");
});

test("CONTROL: no link, or a link that is not https, is kept as none", () => {
  assert.equal(normalizeRecord(rec({})).officeUrl, null);
  assert.equal(normalizeRecord(rec({ office_url: "http://office.invalid/record/1" })).officeUrl, null);
  assert.equal(normalizeRecord(rec({ office_url: "not a url" })).officeUrl, null);
});

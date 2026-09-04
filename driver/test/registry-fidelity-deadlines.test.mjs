// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// spec 64 (B3) — opposition-window extraction: alias-tolerant record accessor + the run-dir deep-walk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordOppositionEnd, collectOppositionDeadlines } from "../registry-fidelity.mjs";

test("recordOppositionEnd: every observed shape; the LATEST window end wins; junk ignored", () => {
  assert.equal(recordOppositionEnd({ oppositionEndDate: "2026-07-13" }), "2026-07-13");
  assert.equal(recordOppositionEnd({ jurisdictions: [{ oppositionEndDate: "2015-08-05" }, { oppositionEndDate: "2016-01-02" }] }), "2016-01-02");
  assert.equal(recordOppositionEnd({ screen: { jurisdictions: [{ oppositionEndDate: "2026-07-13" }] } }), "2026-07-13", "the copper-causeway DEMVENZY shape");
  assert.equal(recordOppositionEnd({ raw: { jurisdictions: [{ oppositionEndDate: "2026-07-13T00:00:00Z" }] } }), "2026-07-13", "timestamp trimmed to the date");
  assert.equal(recordOppositionEnd({ jurisdictions: [{ oppositionEndDate: "soon" }] }), null, "non-ISO ignored");
  assert.equal(recordOppositionEnd({}), null);
});

test("collectOppositionDeadlines: deep-walks the named band, unit bands and fetched records; latest-per-uri", () => {
  const dir = mkdtempSync(join(tmpdir(), "opp-"));
  mkdirSync(join(dir, "register-units"), { recursive: true });
  mkdirSync(join(dir, "_records"), { recursive: true });
  writeFileSync(join(dir, "register-named-band.json"), JSON.stringify({
    enumerated: [{ record_id: "/mark/ch/06198", mark_text: "DEMVENZY", screen: { jurisdictions: [{ oppositionEndDate: "2026-07-13" }] } }],
    crowds: [],
  }));
  writeFileSync(join(dir, "register-units", "primary-sweep-band.json"), JSON.stringify({
    blocks: [{ records: [{ record_id: "/mark/us/79452065", jurisdictions: [{ oppositionEndDate: "2026-09-01" }] }] }],
  }));
  writeFileSync(join(dir, "_records", "eu-019345301.json"), JSON.stringify({
    uri: "/mark/eu/019345301", jurisdictions: [{ oppositionEndDate: "2026-07-13" }, { oppositionEndDate: "2026-08-20" }],
  }));
  const map = collectOppositionDeadlines(dir);
  assert.equal(map.get("/mark/ch/06198"), "2026-07-13");
  assert.equal(map.get("/mark/us/79452065"), "2026-09-01");
  assert.equal(map.get("/mark/eu/019345301"), "2026-08-20", "the latest window across designations");
  assert.equal(collectOppositionDeadlines(mkdtempSync(join(tmpdir(), "opp-empty-"))).size, 0, "bare dir ⇒ empty map");
});

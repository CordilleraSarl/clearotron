// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-search-row-is-a-band-row.test.mjs — this provider's search row lands in the band as it is, so it speaks
// the band's key names.
//
// THE DEFECT. `screenSource: "search-row"` means there is no screen call to lift fields across: the rows
// this adapter projects ARE the band. Every band consumer reads `owner_name`, `classes` and
// `application_date`; the row carried `owner`, `nice_classes` and `filing_date`, and its `owner` read a flat
// `owner_name` the vendor does not send — the vendor's owner is `owners[].name`. Nothing threw. Every record
// reached the positions fold with no owner, every register placement was refused `placement_owner_missing`
// in the render, and a pass that had tiered 141 in-class identical and near-identical records delivered
// none of them while reporting success. Measured on three archived runs on this register: the fold held an
// owner on 0 of 785, 0 of 1,448 and 0 of 2,266 positions; on the other register, on every position.
//
// The last arm drives the whole seam the defect crossed — vendor body → search row → positions fold →
// placement form → rendered file — because each link is individually "correct" and only the chain fails.
//
// NO VENDOR MEASUREMENTS AND NO REAL MARK OR OWNER live here. The strings are invented.
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeSearchResponse } from "../src/core.js";
import { deriveRegisterPositions } from "../../../driver/band-shape.mjs";
import { unionPlacementForm } from "../../../driver/placement-union.mjs";
import { renderPlacementsJson } from "../../../driver/placement-form.mjs";

// The vendor's own shape: owner as a list of entities, classes under `classifications`, no flat owner_name.
const vendorRow = (id, markText, owner, office = "US") => ({
  id, mark_text: markText, jurisdiction_code: office, office_code: office,
  status: { primary: "active", stage: "registered" },
  classifications: [{ nice_class: 9 }, { nice_class: 42 }],
  owners: owner ? [{ id: `o-${id}`, name: owner, country_code: "CH", entity_id: `e-${id}`, entity_id_type: "invented" }] : [],
  filing_date: "2019-03-04", registration_date: "2020-01-02",
});
const BODY = { data: [
  vendorRow("a1", "VELTRANO", "Invented Holdings SA"),
  vendorRow("a2", "VELTRANO", "Invented Holdings SA", "GB"),
  vendorRow("a3", "VELTRAMO", null),
], pagination: { total_count: 3, has_more: false } };

test("the search row carries the band contract's owner, classes and date keys", () => {
  const [row] = normalizeSearchResponse(BODY, "veltrano").results;
  assert.equal(row.owner_name, "Invented Holdings SA", "owner_name is read from owners[].name — the field the vendor sends");
  assert.equal(row.owner_country, "CH");
  assert.deepEqual(row.classes, [9, 42], "`classes` — the key band-shape, named-band and the digest read");
  assert.equal(row.application_date, "2019-03-04");
  // The provider's own names stay: rowScreen reads nice_classes, and the search tool's output shows owner.
  assert.deepEqual(row.nice_classes, [9, 42]);
  assert.equal(row.owner, "Invented Holdings SA");
});

test("a record the vendor gives no owner for reads as null, never as a borrowed or empty-string owner", () => {
  const row = normalizeSearchResponse(BODY, "veltrano").results[2];
  assert.equal(row.owner_name, null);
  assert.equal(row.owner, null);
});

test("vendor body → band → positions → placement form → placements.json: a tiered register record renders", () => {
  const band = normalizeSearchResponse(BODY, "veltrano").results;
  const { positions } = deriveRegisterPositions(band);
  const family = positions.find((p) => p.records.length === 2);
  assert.ok(family, "the two same-owner records fold to one position, which needs the owner to happen at all");
  assert.deepEqual(family.owners, ["Invented Holdings SA"]);

  const u = unionPlacementForm(null, [
    { select: band[0].record_id, tier: "headline-candidate", reason: "identical mark, same classes, live in both offices" },
    { select: band[2].record_id, tier: "watchlist-annex", reason: "one-letter variant, no owner on the register record" },
  ], { floors: [], positions });
  const doc = renderPlacementsJson(u.form.rows);
  const placed = doc.placements.find((p) => p.records.includes(band[0].record_id));
  assert.ok(placed, "the tiered register candidate reaches the rendered file");
  assert.equal(placed.owner, "Invented Holdings SA");
  assert.equal(doc.placements.length, 1,
    "the record the register gives no owner for is still refused by the parser — counted by the gate, not rendered");
});

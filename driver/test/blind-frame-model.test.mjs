// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// blind-frame-model.mjs — strict parser for the blind-frame stage's machine output. Valid model →
// normalized; every defect class throws token-FIRST (the corrective-hint / warm-eligibility contract).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlindFrameModel, VARIANT_DIRECTIONS, RANKING_BASES } from "../blind-frame-model.mjs";

const VALID = {
  schema_version: 1,
  dominant_element: "VELTRI",
  variants: [
    { value: "VELTRI", direction: "drop", rationale: "drop the trailing N — VELTRIN→VELTRI" },
    { value: "VELTRI Diagnostics", direction: "composite", rationale: "the element inside a larger mark" },
    { value: "VELTRY", direction: "phonetic", rationale: "sound-alike" },
  ],
  fields: [
    { goods: "diagnostics software", on_field: true, rationale: "goods-overlap with the product" },
    { goods: "oracle tourism", on_field: false, rationale: "shares the word, not the goods" },
  ],
  sources: [{ channel: "developer ecosystem (GitHub/Steam)", rationale: "B2D product" }],
  ranking_basis: "goods-overlap",
};

test("parse valid → normalized object", () => {
  const m = parseBlindFrameModel(JSON.stringify(VALID));
  assert.equal(m.dominant_element, "VELTRI");
  assert.equal(m.variants.length, 3);
  assert.equal(m.variants[0].direction, "drop");
  assert.equal(m.fields.find((f) => f.goods === "oracle tourism").on_field, false);
  assert.equal(m.ranking_basis, "goods-overlap");
});

test("fields and sources may be empty arrays", () => {
  const m = parseBlindFrameModel(JSON.stringify({ ...VALID, fields: [], sources: [] }));
  assert.deepEqual(m.fields, []);
  assert.deepEqual(m.sources, []);
});

test("throws token-FIRST on every defect class", () => {
  const t = (obj, token) => {
    const raw = typeof obj === "string" ? obj : JSON.stringify(obj);
    assert.throws(() => parseBlindFrameModel(raw), (e) => e.message.startsWith(token), `${token} for ${raw.slice(0, 70)}`);
  };
  t("not json {", "blindframe_unparseable");
  t([VALID], "blindframe_unparseable");                                            // array top level
  t({ ...VALID, surprise: 1 }, "blindframe_key_unknown");
  t({ ...VALID, dominant_element: "" }, "blindframe_dominant_element_missing");
  t({ ...VALID, variants: [] }, "blindframe_variants_empty");
  t({ ...VALID, variants: [{ value: "x", direction: "drop", extra: 1 }] }, "blindframe_variant_key_unknown");
  t({ ...VALID, variants: [{ value: "x", direction: "sideways", rationale: "" }] }, "blindframe_direction_invalid");
  t({ ...VALID, fields: [{ goods: "x", on_field: "yes", rationale: "" }] }, "blindframe_field_on_field_invalid");
  t({ ...VALID, ranking_basis: "vibes" }, "blindframe_ranking_basis_invalid");
});

test("enums match the dictated closed sets", () => {
  assert.deepEqual(VARIANT_DIRECTIONS, ["add", "drop", "phonetic", "homophone", "neighbour", "composite"]);
  assert.deepEqual(RANKING_BASES, ["goods-overlap", "class-number"]);
});

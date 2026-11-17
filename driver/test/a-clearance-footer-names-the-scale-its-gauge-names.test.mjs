// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CLEARANCE'S FOOTER NAMES THE SCALE ITS GAUGE NAMES.
//
// The gauge reads the title of the scale the run froze. The footer's "Rated under" line named the house scale
// "generic default framework" whatever the run froze, so one page called one scale by two names. It now takes the
// frozen title: a new run says "Standard risk scale", and a run frozen under an older title keeps that title. A
// customer's own scale is named as before. Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ratedUnderLine } from "../steps/overview-and-cards.mjs";

const HOUSE = JSON.parse(readFileSync(new URL("../skills/clearance-search/risk-framework.manifest.json", import.meta.url), "utf8"));

test("the house scale is named by the title the run froze, as the gauge names it", () => {
  assert.equal(HOUSE.title, "Standard risk scale", "premise: the house scale's title");
  assert.equal(ratedUnderLine({ name: "Quillmere Goods" }, HOUSE), "Quillmere Goods · Standard risk scale");
});

test("a run frozen under an older title keeps that title", () => {
  assert.equal(ratedUnderLine({ name: "Quillmere Goods" }, { title: "Older house scale" }), "Quillmere Goods · Older house scale");
});

test("with no frozen title the earlier words stand", () => {
  assert.equal(ratedUnderLine({ name: "Quillmere Goods" }, null), "Quillmere Goods · generic default framework");
  assert.equal(ratedUnderLine({ profileKey: "quillmere" }, { title: "  " }), "quillmere · generic default framework");
});

test("a customer's own scale is named as its own, as before", () => {
  const own = { name: "Quillmere Goods", frameworkPath: "/invented/risk-framework-quillmere.md" };
  assert.equal(ratedUnderLine(own, { title: "Quillmere scale" }), "Quillmere Goods · custom framework: Quillmere scale");
  assert.equal(ratedUnderLine(own, null), "Quillmere Goods · custom framework: risk-framework-quillmere.md");
});

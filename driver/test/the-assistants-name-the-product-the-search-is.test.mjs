// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE ASSISTANTS NAME THE PRODUCT THE SEARCH IS, AND NEVER GUESS ONE FROM GEOGRAPHY (design, 2026-11-24).
//
// The order reader mapped one country to a full-country search and illustrated a Knockout only with several names, though a
// Knockout reads one name in one country or worldwide. A client asking for a quick look at one name in one country fitted
// both, and the reader chose for them. The report-link assistant opened every report as a preliminary search, the matter
// frame told a full-country search it was a preliminary one, and two client surfaces promised "hours" where the preview
// returns the product's own turnaround. These arms pin the text; whether a model then chooses well is measured on saved
// briefs, not here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { systemPrompt } from "../compose-read.mjs";
import { STAGES } from "../stages.mjs";
import { PRODUCTS, productName } from "../products.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTING = "Use the product the brief clearly requests. Check that its territories and number of names fit. If more than one product fits and the brief does not say which one the client wants, leave the product blank.";

test("the order reader takes the product the brief asks for, and leaves it blank when two fit", () => {
  const prompt = systemPrompt({ today: "2026-11-24" });
  assert.ok(prompt.split("\n").join(" ").includes(ROUTING), "the reader is not told to take the requested product");
  assert.doesNotMatch(prompt, /naming one country\s+is a full-country-search/, "the reader still maps one country to a full-country search");
  assert.doesNotMatch(prompt, /several names screened quickly is a knockout-search/, "the reader still ties a Knockout to several names");
  const knockout = PRODUCTS.find((p) => p.pipeline === "knockout");
  assert.ok(prompt.includes(`${knockout.id.padEnd(28)} ${knockout.geography}; up to ${knockout.maxNames} names`),
    "the reader's list no longer shows a Knockout's own geography and count, so a single name could not fit it");
});

test("the matter frame opens on the product the run resolved, and a clearance is no longer called preliminary by default", () => {
  const P = new Proxy({}, { get: () => "/r/x" });
  const opening = (searchPolicy) => STAGES["matter-frame"].message({ paths: P, job: { markName: "Quillmere" }, searchPolicy })
    .split("\n").find((l) => l.startsWith("Build the strategic matter frame"));
  for (const level of ["full-country-search", "multi-country-focus-search", "global-preliminary-search"])
    assert.equal(opening({ level }), `Build the strategic matter frame for this trademark search request: a ${productName(level)}.`);
  assert.equal(opening(null), "Build the strategic matter frame for this trademark search request.", "a run with no product named guesses one");
});

test("the client's assistants read the product before describing the work, and quote the preview's turnaround", () => {
  const pack = (d) => readFileSync(join(ROOT, "skills", d, "SKILL.md"), "utf8");
  for (const d of ["clearotron-client", "clearotron-account"]) {
    assert.match(pack(d).split("\n").join(" "), /Read (this report's|a search's) product, scope and recorded coverage before describing what was searched\./,
      `${d} does not tell the assistant to read the product first`);
    assert.doesNotMatch(pack(d), /overstepping what a preliminary search is/, `${d} still frames every search as preliminary`);
    assert.doesNotMatch(pack(d), /takes hours/, `${d} still promises hours instead of the preview's turnaround`);
  }
  assert.doesNotMatch(pack("clearotron-client"), /preliminary trademark clearance (report|search)/, "the report link still opens as a preliminary search");
});

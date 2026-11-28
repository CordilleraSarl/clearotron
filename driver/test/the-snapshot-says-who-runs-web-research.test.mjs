// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE FLAG SNAPSHOT SAYS WHO RUNS THE INSTALLATION'S WEB RESEARCH, read as the run door reads it (flag-snapshot.mjs,
// web-research-names.mjs).
//
// A service outside the engine environment cannot read the engine's setting, so it reads the snapshot. The snapshot
// and the door must agree for every value the setting can hold, or one screen offers a search the door refuses. A
// snapshot taken before the field existed says nothing, and its reader answers null, never "no service". A mistyped
// value is recorded as a yes or no, never copied: the snapshot is read by a web service and the value may hold anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFlagSnapshot, webResearchFor } from "../flag-snapshot.mjs";
import { installWebResearch, researchDoor, WEB_RESEARCH_SETTING } from "../web-research.mjs";

const snap = (env) => JSON.parse(JSON.stringify(buildFlagSnapshot(env, { capturedAt: "2026-11-28T00:00:00.000Z" })));

test("the snapshot and the run door read the setting the same way, for every value it can hold", () => {
  const cases = [
    [{}, { service: null, chosen: false, invalid: false }, "unset"],
    [{ [WEB_RESEARCH_SETTING]: "   " }, { service: null, chosen: false, invalid: false }, "blank"],
    [{ [WEB_RESEARCH_SETTING]: "own" }, { service: "own", chosen: true, invalid: false }, "the AI program's own search"],
    [{ [WEB_RESEARCH_SETTING]: " Perplexity " }, { service: "perplexity", chosen: true, invalid: false }, "Perplexity, spaced and capitalised"],
    [{ [WEB_RESEARCH_SETTING]: "google" }, { service: null, chosen: true, invalid: true }, "a value that names no service"],
  ];
  // And where it names Perplexity on a box holding the key, the door opens.
  assert.doesNotThrow(() => researchDoor({ product: "full" }, { [WEB_RESEARCH_SETTING]: "perplexity", PERPLEXITY_API_KEY: "k" }));
  for (const [env, expected, what] of cases) {
    const read = webResearchFor(snap(env));
    assert.deepEqual(read, expected, what);
    const door = installWebResearch(env);
    assert.equal(read.service, door.service, `${what}: the snapshot names the service the door runs on`);
    assert.equal(read.chosen, door.chosen, `${what}: chosen agrees with the door`);
    // Where the snapshot names no service, the door refuses the search by the setting's name.
    if (read.service === null)
      assert.throws(() => researchDoor({ product: "full" }, env), new RegExp(WEB_RESEARCH_SETTING), `${what}: the door refuses`);
  }
});

test("a mistyped value is recorded as a yes or no, never as what was written", () => {
  // Not key-shaped, so the tree's secret scan has nothing to flag; what is checked is that the value is never copied.
  const written = "mistyped-QZORVAK-line";
  const s = snap({ [WEB_RESEARCH_SETTING]: written });
  assert.equal(s.webResearch.invalid, true);
  assert.ok(!JSON.stringify(s).includes(written.toLowerCase()) && !JSON.stringify(s).includes(written),
    "the value an operator mistyped into the setting reached a file a web service reads");
});

test("a snapshot taken before the field existed says nothing, and is not read as no service", () => {
  assert.equal(webResearchFor({ capturedAt: "2026-10-01T00:00:00.000Z", flags: {} }), null, "an older snapshot");
  assert.equal(webResearchFor(null), null, "no snapshot at all");
  assert.equal(webResearchFor({ webResearch: "own" }), null, "a field of the wrong shape");
  assert.equal(webResearchFor({ webResearch: [] }), null, "an array in the field");
  // A field from a later writer that names a service this build does not know is no service here, and says so.
  assert.deepEqual(webResearchFor({ webResearch: { service: "bing", chosen: true, invalid: false } }),
    { service: null, chosen: true, invalid: false });
});

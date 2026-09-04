// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — what ONE ordered territory resolves to, per provider, pinned.
//
// The owner's ruling: "if someone searches for france on clarivate they need to get France results
// across all 3 areas — they will NEVER expect just a french set of results from 1 location."
//
// Three providers satisfy that today and they satisfy it in TWO DIFFERENT SHAPES, which is why this
// table exists rather than a single expectation:
//
//   clarivate / corsearch  the region list itself expands — FR becomes FR + the EU register + WO, sent
//                          as ONE request because the provider takes an array of office codes.
//   signa                  the region list does NOT expand, and must not. `toSignaParams` sends
//                          `filters.jurisdictions` + `territory_match: "protection"`, so one
//                          `inpi-fr`-scoped query returns the whole stack of rights protecting France —
//                          measured at 101 rows including EM/direct_regional, against 19 for an
//                          office-filtered query. Adding EU and WO regions here would ask a second time
//                          for what the first call already returned.
//
// A future reader looking at signa's one-element list will read it as the unexpanded case was
// filed about. It is the opposite: it is the provider whose single call already covers the stack. That
// misreading is the reason this file states the shape AND the reason for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRegions } from "../register-plan.mjs";
import { territoryLayerReport } from "../binding-layers.mjs";
import { CAPABILITIES as clarivate } from "../../providers/clarivate/src/capabilities.js";
import { CAPABILITIES as corsearch } from "../../providers/corsearch/src/capabilities.js";
import { CAPABILITIES as signa } from "../../providers/signa/src/capabilities.js";
import { CAPABILITIES as euipo } from "../../providers/euipo/src/capabilities.js";

const PROVIDERS = { clarivate, corsearch, signa, euipo };

/** territory → provider → the regions the plan will scope. Measured, not predicted. */
const TABLE = {
  FR: {
    clarivate: ["FR", "EM", "WO"],
    corsearch: ["FR", "EU", "WO"],
    signa: ["inpi-fr"],            // one protection-matched call covers national + EU + Madrid
    euipo: [],                     // EU-only provider: a national order is a disclosed deferral
  },
  CH: {                            // no regional register binds Switzerland — the control
    clarivate: ["CH", "WO"],
    corsearch: ["CH", "WO"],
    signa: ["ipi"],
    euipo: [],
  },
};

test("#1491 a bare territory resolves to the same regions it does today, per provider", () => {
  for (const [territory, byProvider] of Object.entries(TABLE)) {
    for (const [name, expected] of Object.entries(byProvider)) {
      const { regions } = resolveRegions([territory], PROVIDERS[name]);
      assert.deepEqual(regions, expected,
        `${name} resolves ${territory} to ${JSON.stringify(regions)}, not ${JSON.stringify(expected)}. `
        + "If this moved deliberately, the live figures belong on #1491 before the table does — the "
        + "owner's ruling is about what comes BACK, and this function only decides what is asked for.");
    }
  }
});

test("#1491 CORSEARCH IS BYTE-IDENTICAL, which is what the carve-out actually means", () => {
  // The owner said not to touch corsearch. It already expands — the carve-out is "change nothing",
  // not "prevent an expansion", and its expansion stays UNVERIFIED until its auth reopens and a probe
  // can confirm it. That exposure is recorded; this arm only holds the behaviour still.
  assert.deepEqual(resolveRegions(["FR"], corsearch).regions, ["FR", "EU", "WO"]);
  // nationals first, from the one-to-one loop; the stack pass then appends what it adds.
  assert.deepEqual(resolveRegions(["DE", "CH"], corsearch).regions, ["DE", "CH", "EU", "WO"]);
});

test("#1491 THE PLAN AND THE DISCLOSURE AGREE — every binding layer reads as searched, both shapes", () => {
  // The end-to-end the owner's ruling is actually about: what the plan resolves, handed to the function
  // that writes the client-facing coverage sentence. `searchedOffices` is what the compiler resolved for
  // the matter, so feeding it the bare national office is asking a different question — one where
  // clarivate and corsearch both read INCOMPLETE, because their coverage comes from searching the
  // additional offices rather than from one office returning every layer.
  //
  // Asking it the wrong way is how I briefly convinced myself signa had a live disclosure bug. Reading
  // coverage per layer by hand — translate(office), then layerCoverageFor — makes signa's regional layer
  // look `unestablished`, because its vendor names EUIPO `EU` and `bindingLayersFor` says `EM`. Nothing
  // reaches translate with `EM` on the real path, the report never translates for the regional layer,
  // and the disclosure has always been complete. The hand-built path was my instrument, not the system.
  let checked = 0;
  for (const name of ["clarivate", "corsearch", "signa"]) {
    const caps = PROVIDERS[name];
    for (const territory of ["FR", "CH", "EU"]) {
      const { regions } = resolveRegions([territory], caps);
      const report = territoryLayerReport(territory, regions, caps);
      checked++;
      assert.equal(report.complete, true,
        `${name} orders ${territory}, resolves ${JSON.stringify(regions)}, and still reports `
        + `${JSON.stringify(report.unsearched.map((u) => u.layer))} as unsearched. The coverage form writes `
        + "the client's disclosure from this, so an unreached layer here is a sentence telling them a "
        + "register that binds their territory was not searched.");
    }
  }
  assert.ok(checked >= 9, `only ${checked} territory reports examined — the fixture stopped enumerating`);
});

test("#1491 signa's translate still REFUSES the office code, and that pin is not collateral", () => {
  // Signa's own territory-expansion suite pins this too, with a stated reason: `EM` is an office code,
  // not a territory, and a future caller passing one should get a refusal rather than a quiet
  // deferral. I aliased it while chasing the wrong finding above; this arm is here so the next person
  // who reaches for that alias finds out from a test instead of from the provider suite.
  assert.equal(signa.offices.translate("EM"), null, "EM resolved — see the comment above before changing it");
  assert.equal(signa.offices.translate("EU"), "euipo", "the matter-facing territory code must still resolve");
});

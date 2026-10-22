// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REGISTER'S WORDING FOLLOWS THE RULED CROWD METHOD.
//
// The ruled method narrows a crowd until it gives a list a lawyer can read, on the one market list the opening message
// names, and lets judgment decide when more searching would change what the client is told. Lines in the register
// unit's opening message, its manual and the write-up's coverage brief still said the opposite: cover every
// subdivision, every major market, never stop a narrowing, and call every unaccounted crowd coverage-limited. A test
// run of a crowded matter followed them. Each arm holds one line's ruled wording and that the old one is gone. Every
// mark here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRegisterPlan } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { formNeighbourhood } from "../form-neighbourhood.mjs";
import { STAGES } from "../stages.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");
const MARK = "ORBANTIQ";
const manifest = {
  schema_version: 1, mark: MARK, dominant_element: MARK, elements: [{ value: MARK, kind: "distinctive" }],
  variants: [{ value: MARK, category: "core" }], incumbent_classes: [], goods_words: ["software"],
};
const form = { elements: [{ element: MARK, band: formNeighbourhood(MARK) }] };
const P = { variantManifest: "vm.json", matterContext: "mc.md", registerBand: (a) => `band-${a}.json`, registerUnit: (a) => `unit-${a}.md`, registerPlan: "plan.json" };
// The unit's opening message on the primary sweep, with the supplemental lane on, as a test run of a crowded matter had it.
const unitMessage = () => {
  const plan = compileRegisterPlan({ manifest, job: { jobKey: "t", classes: ["9"], jurisdictions: ["EU"] }, form, capabilities: PROVIDER_CAPABILITIES.clarivate });
  return STAGES["register-unit"].message({ paths: P, axis: "primary-sweep", job: { classes: [9] },
    registerPlan: { ...plan, contract: { ...(plan.contract ?? {}), supplemental_lane: true } }, capabilities: null });
};

test("the unit's opening message judges the band by the manual's steps, and no longer orders every subdivision covered", () => {
  const message = unitMessage();
  assert.ok(message.includes("BAND ARTIFACT: the band band-primary-sweep.json is written BY THE TOOLS"), "guard: the supplemental lane's band line");
  assert.ok(message.includes("Your job is to READ the band back and judge it by the steps in unit.md: read the identical mark first, narrow a crowd "
    + "until it gives a list you can read, and decide as a lawyer would whether more searching would change what you tell the client."));
  assert.ok(message.includes("Never sample a slice yourself with register_search, and never record a sample as though it were a band."));
  for (const gone of ["keep proposing until this axis's dangerous named band", "There is no \"good enough\" / top-N / narrow-to-tractable verb",
    "If a slice is not covered, PROPOSE it"])
    assert.ok(!message.includes(gone), `the opening message still says "${gone}"`);
});

test("the crowd bound takes a crowd's majors from it by jurisdictions, and no longer sends it to each major on its own", () => {
  const line = unitMessage().split("\n").find((l) => l.includes("CROWD BOUND")) ?? "";
  assert.ok(line, "guard: the opening message carries the crowd bound");
  assert.ok(line.includes("(the dominant token / formative root as a contains predicate + its phonetic slice)"));
  assert.ok(line.includes("→ keep it, take its majors from it by jurisdictions, and run its phonetic pass."));
  assert.ok(line.includes("it never writes coverage-limited and never drives CONDITIONAL."));
  for (const gone of ["+ its per-major + phonetic slices", "run its per-major / phonetic", "materiality is judgment's call (Layer B)"])
    assert.ok(!line.includes(gone), `the crowd bound still says "${gone}"`);
});

test("the unit manual lets a narrowing stop at the first list it can read", () => {
  const unit = flat("unit.md");
  assert.ok(unit.includes("- **sample or self-accept** — no top-N, no per-jurisdiction 3-fetch ceiling, no switch-to-exact-standalone-as-enumeration. "
    + "The tool enumerates or reports incomplete; a crowd is narrowed by the steps above, and the narrowing stops at the first list you can read."));
  for (const gone of ["no \"narrow to tractable and stop\"", "there is no in-between for you to author"])
    assert.ok(!unit.includes(gone), `the unit manual still says "${gone}"`);
});

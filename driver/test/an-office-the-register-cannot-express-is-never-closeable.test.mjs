// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN OFFICE THE REGISTER CANNOT EXPRESS IS NEVER CLOSEABLE.
//
// A deferred coverage row about a territory outside the active provider's office vocabulary was read as closeable
// whenever the write-up's reason did not use the plan's own wording for that gap. On a test run of a crowded matter, the
// deadline envelope then re-ran the axis to close it and the reviewer escalated it, and the re-run was refused as
// outside the vocabulary, as it had to be. The split now reads the row's territory against the provider's offices, by
// the plan's own rule, and holds it as it holds a plan capability gap. The register manual says the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { territoryOfRow, rowOutsideProviderOffices } from "../register-plan.mjs";
import { splitDeferredByCloseability } from "../coverage-ledger.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { officeGapOf } from "../pipeline.mjs";

const row = (scope, reason = "the write-up's own words") => ({ axis: "primary-sweep", scope, status: "deferred", reason });

test("a row's territory is read from its scope, and a mark or a class list is never read as a country", () => {
  assert.equal(territoryOfRow(row("TV (material)")), "TV");
  assert.equal(territoryOfRow(row("Tuvalu")), "TV");
  assert.equal(territoryOfRow(row("NZ — material jurisdiction")), "NZ");
  assert.equal(territoryOfRow(row("exact: ORBANTIQ [cl 9, 41]")), null, "a class list was read as a country");
  assert.equal(territoryOfRow(row("default: ORBANTIQ (contains)")), null);
  assert.equal(territoryOfRow(row("")), null);
});

test("a deferred row on an office the provider cannot express is held, whatever its reason says; one it can reach stays closeable", () => {
  const clarivate = PROVIDER_CAPABILITIES.clarivate;
  assert.equal(rowOutsideProviderOffices(row("TV (material)"), clarivate), true, "guard: this register cannot express the office");
  assert.equal(rowOutsideProviderOffices(row("NZ (material)"), clarivate), false, "guard: this register covers the office");
  const rows = [row("TV (material)"), row("NZ (material)")];
  const { held, closeable } = splitDeferredByCloseability(rows, "primary-sweep", new Set(), { uncovered: (r) => rowOutsideProviderOffices(r, clarivate) });
  assert.deepEqual(held.map((r) => r.scope), ["TV (material)"], "the office no re-run can reach was left closeable");
  assert.deepEqual(closeable.map((r) => r.scope), ["NZ (material)"], "an office the register covers was held");
  // Without the provider's offices the split is what it was: nothing is held on its territory.
  assert.deepEqual(splitDeferredByCloseability(rows, "primary-sweep", new Set()).held, []);
});

test("the run's split reads the plan's provider, and a register that publishes no office list holds nothing on its territory", () => {
  assert.equal(officeGapOf({ provider: "clarivate" })(row("TV (material)")), true);
  assert.equal(officeGapOf({ provider: "corsearch" })(row("TV (material)")), false, "a register with no office list cannot say an office is outside it");
  assert.equal(officeGapOf(null)(row("TV (material)")), false);
  assert.equal(officeGapOf({ provider: "no-such-register" })(row("TV (material)")), false);
});

test("the register manual says an office the provider cannot express is never closeable", () => {
  const skill = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register", "SKILL.md"), "utf8").replace(/\s+/g, " ");
  assert.ok(skill.includes("A provider error or a blocked fetch is a CLOSEABLE gap — escalate and disclose; a predicate or an office the provider "
    + "cannot express is never closeable, and stays open and disclosed. Either way it clamps the verdict CLEAR→CONDITIONAL."));
  assert.ok(!skill.includes("It is a CLOSEABLE gap — escalate and disclose — and it clamps the verdict"), "the manual still calls every deferral closeable");
});

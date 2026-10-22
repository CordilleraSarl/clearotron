// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A WORLDWIDE ORDER'S SCOPE IS WORLDWIDE, AND THE MARKETS NAMED FOR NARROWING ARE NEVER SCOPE.
//
// The variants manual called the scope ledger's jurisdiction rows the authoritative scope the register sweep is bounded
// to, and asked one `applied` row per in-scope territory, so a worldwide order came out as a list of markets. On a
// worldwide order the scope is worldwide: one `applied` row. The frame-reopen's jurisdiction check read every applied row
// as a territory, so that row now reads as no territory list, the answer every reader already takes as worldwide, and
// a named order reads as before. This holds the ruled lines, the check's answer for each, and that the old line is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scopeJurisdictions } from "../scope-ledger.mjs";
import { jurisdictionScopeFlags } from "../frame-diff-model.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const row = (item, status = "applied") => ({ layer: "jurisdiction", item, status, reason: "the order", reopen_trigger: "—" });
// The frame-reopen's check, as the pipeline runs it: on a scope with no territory list it does not run at all.
const check = (rows, searched) => {
  const scope = scopeJurisdictions(rows);
  return scope.length ? jurisdictionScopeFlags({ scopeJurisdictions: scope, searched }) : { overReach: [], underCoverage: [] };
};

test("one applied worldwide row is a worldwide scope: nothing reads as unsearched and nothing searched as over-reach", () => {
  assert.deepEqual(scopeJurisdictions([row("worldwide")]), []);
  assert.deepEqual(check([row("worldwide")], ["US", "EU"]), { overReach: [], underCoverage: [] });
  assert.deepEqual(scopeJurisdictions([row("Global")]), [], "global, in any case, names the world too");
  // The pipeline runs the check only on a scope that lists territories.
  assert.match(readFileSync(join(DRIVER, "pipeline.mjs"), "utf8"), /if \(scopeJ\.length\) \{/, "guard: the check still skips an empty scope");
});

test("a worldwide row beside applied territory rows is still worldwide: the named markets are priorities, never scope", () => {
  assert.deepEqual(scopeJurisdictions([row("WORLDWIDE"), row("US"), row("JP"), row("CN", "dropped")]), []);
});

test("a named order is read as before", () => {
  assert.deepEqual(scopeJurisdictions([row("US"), row("eu"), row("CN", "dropped")]), ["US", "EU"]);
  assert.deepEqual(check([row("US"), row("EU")], ["US"]).underCoverage, ["EU"], "a named territory left unsearched is still disclosed");
});

test("the variants manual gives a worldwide order one applied row, and the checklist says the same", () => {
  const manual = readFileSync(join(DRIVER, "skills", "clearance-variants", "SKILL.md"), "utf8").replace(/\s+/g, " ");
  assert.ok(manual.includes("On a worldwide order the scope is worldwide: one `applied` row. Markets named for narrowing a crowd are priorities, never scope."));
  assert.ok(manual.includes("jurisdiction (on a worldwide order one `applied` worldwide row; otherwise one `applied` row per instructed territory, "
    + "one `dropped` row per territory considered and excluded)"));
  assert.ok(!manual.includes("This is the authoritative scope the register sweep is bounded to"), "the manual still bounds the sweep to the ledger's rows");
});

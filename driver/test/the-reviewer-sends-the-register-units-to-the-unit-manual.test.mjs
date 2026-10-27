// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEWER SENDS THE REGISTER UNITS TO THE UNIT MANUAL'S STEPS.
//
// The reviewer's manual still ordered the register units through a fixed set of searches: a minimum count per step,
// set page sizes, every marked script sweep, and one scoped question per material market with an allowance set aside
// for them. It checked for a ledger row on every material market and re-ran a deferred row on one. The ruled method
// narrows a crowd by the unit manual's steps, asks a wider question only where reading it would change what the client
// is told, and re-runs only a deferral a re-run can close. This holds the ruled wording and that the old is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const manual = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-search", "phase2-execution.md"), "utf8")
  .replace(/\s+/g, " ");

test("the reviewer's manual sends the register units to the unit manual's steps, and orders no fixed set of searches", () => {
  assert.ok(manual.includes("### Variant execution strategy (register layer) The register units follow clearance-register/unit.md: the identical "
    + "mark first, a crowd narrowed by its steps, and a wider question only where reading it would change what you tell the client. A family the "
    + "reading turn did not ask is recorded withheld-by-judgment with its reason; that is a documented decision, not a shortcut. ## Step 2.6"),
    "the section's body is not the ruled paragraph alone");
  for (const gone of ["Compound-Phrase Funnel", "Minimum 3 searches", "Run one scoped sub-query per jurisdiction", "ring-fenced per-jurisdiction allowance",
    "the funnel is lighter"])
    assert.ok(!manual.includes(gone), `the reviewer's manual still says "${gone}"`);
});

test("the reviewer's coverage check asks only for a material market no question reached", () => {
  assert.ok(manual.includes("- **Coverage ledger:** is any `deferred` / `coverage-limited` row being narrated (or about to be narrated) as a "
    + "clean negative? Is a material jurisdiction that no question reached at all missing from the ledger? One covered by a complete worldwide "
    + "answer, or left in a crowd's count by the identical mark's narrowing, is accounted for and needs no row of its own. A deferred row treated "
    + "as clean is a recall gap — flag it."));
  assert.ok(!manual.includes("carry a row for **every** jurisdiction"), "the reviewer still asks for a row on every material market");
});

test("the reviewer re-runs only a deferral the table lists as closeable", () => {
  assert.ok(manual.includes("**A `deferred` coverage-ledger row the table lists as CLOSEABLE is exactly this kind of documented-reason gap** — "
    + "the owning unit resumes and runs the missing question. A deferral the table marks NOT CLOSEABLE is not re-run."));
  assert.ok(!manual.includes("runs the missing per-jurisdiction sub-query"), "the reviewer still re-runs a deferral per material market");
});

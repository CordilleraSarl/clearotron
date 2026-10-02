// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — a register's floor through the run's records and the pages that print it, on invented names
//
// A REGISTER'S FLOOR IS CARRIED, AND NEVER BECOMES A ZERO (ruled 2026-10-02: too many to read).
//
// A question the register answered "at least 10,000" comes back as a crowd with a null total and the
// register's figure beside it. Every place the run keeps the question keeps the figure, and every page that
// prints the count prints it as the knockout report always has, "more than 10,000": the execution receipt
// (executed, not missing and not deferred), the merged band's crowd, the judges' list of questions, and the
// owner screen, whose old `|| 0` would have turned the null into "0 hit(s)".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { joinPlanToBands } from "../register-plan.mjs";
import { parseNamedBand } from "../named-band.mjs";
import { loadPile } from "../pile.mjs";
import { makeOwnerTools } from "../owner-tools.mjs";
import { deriveOwnerScreen, ownerScreenNegative } from "../owner-screen.mjs";

const DIR = mkdtempSync(join(tmpdir(), "register-floor-carried-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

const PLAN = { plan_version: 1, regions: ["US"], entries: [
  { qid: "q-floor", predicate: "default", term: "QZXV", nice_classes: ["9"] },
  { qid: "q-owner", predicate: "default", term: "QZXV", owner: "Zorvex Holdings", nice_classes: ["9"] },
] };
const FLOOR_BLOCK = (qid) => ({ qid, state: "incomplete", total_hits: null, total_floor: 10000, crowd_basis: "register-floor",
  fetched: 1, sample: [{ record_id: "/mark/us/1" }], reason: 'the register answered "more than 10,000" for this question: a floor, not a count, so the set is too large to read. This is a CROWD.' });
const BLOCKS = [FLOOR_BLOCK("q-floor"), FLOOR_BLOCK("q-owner")];

test("the receipt runs the question as executed, keeps the null total and the register's figure", () => {
  const join_ = joinPlanToBands(PLAN, { "primary-sweep": BLOCKS });
  const row = join_.executed.find((x) => x.qid === "q-floor");
  assert.ok(row, `the question is not executed: missing ${JSON.stringify(join_.missing)}, deferred ${JSON.stringify(join_.deferred)}`);
  assert.equal(row.total_hits, null);
  assert.equal(row.total_floor, 10000);
  assert.equal(join_.missing.includes("q-floor"), false);
});

test("the merged crowd keeps the figure", () => {
  const crowd = parseNamedBand(BLOCKS).crowds.find((c) => c.qid === "q-floor");
  assert.equal(crowd.total_hits, null);
  assert.equal(crowd.total_floor, 10000);
});

test("the judges' list prints the floor as every page prints it, never null and never 0", () => {
  mkdirSync(driverDir(DIR), { recursive: true });
  writeFileSync(driverDir(DIR, "register-plan.json"), JSON.stringify(PLAN));
  writeFileSync(driverDir(DIR, "plan-execution.json"), JSON.stringify({ executed: joinPlanToBands(PLAN, { "primary-sweep": BLOCKS }).executed }));
  writeFileSync(join(DIR, "register-named-band.json"), JSON.stringify(parseNamedBand(BLOCKS)));
  const { questions } = makeOwnerTools(loadPile(DIR)).serve("register_questions", {}).result;
  assert.equal(questions.find((q) => q.words.includes("QZXV")).count, "more than 10,000");
});

test("the owner screen states the floor where its old reading printed 0 hit(s)", () => {
  const screen = deriveOwnerScreen(PLAN.entries, BLOCKS, [], { capabilities: { id: "stand-in", ownerTermIntersection: true } });
  const owner = screen.owners.find((o) => o.qid === "q-owner");
  assert.equal(owner.state, "crowd");
  assert.equal(owner.total_hits, null);
  assert.equal(owner.total_floor, 10000);
  const said = ownerScreenNegative(screen);
  assert.match(said, /Zorvex Holdings \(q-owner\) — more than 10,000 hit\(s\)/);
  assert.doesNotMatch(said, /\b0 hit\(s\)/);
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — a register's floor through the run's records and the pages that print it, on invented names
//
// A REGISTER'S FLOOR IS CARRIED, AND NEVER BECOMES A ZERO (ruled 2026-10-02: too many to read).
//
// A question the register answered "at least 10,000" comes back as a crowd with a null total and the
// register's figure beside it. Every place the run keeps the question keeps the figure, and every page that
// prints the count prints it as the knockout report always has, "more than 10,000": the execution receipt
// (executed, not missing and not deferred), the merged band's crowd, and the owner screen, whose old `|| 0`
// would have turned the null into "0 hit(s)". The client's coverage line names it as a search that returned
// more records than could be listed in full, and the coverage form keeps its row open: a floor is never a
// clean.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { joinPlanToBands, openBlocksByAxis } from "../register-plan.mjs";
import { parseNamedBand } from "../named-band.mjs";
import { deriveOwnerScreen, ownerScreenNegative } from "../owner-screen.mjs";
import { deriveScopeFacts } from "../scope-facts.mjs";
import { moreThan } from "../register-count.mjs";
import { buildBandShape } from "../band-shape.mjs";
import { makeExecutePlan } from "../../providers/_shared/execute-plan.mjs";

const PLAN = { plan_version: 1, regions: ["us"], nice_classes: ["9"], entries: [
  { qid: "q-floor", axis: "primary-sweep", predicate: "default", term: "QZXV", nice_classes: ["9"], regions: ["us"] },
  { qid: "q-owner", axis: "primary-sweep", predicate: "default", term: "QZXV", owner: "Qzxv Holdings", nice_classes: ["9"], regions: ["us"] },
] };
// As the executor writes a question the register answered with a floor (providers/_shared/execute-plan.mjs).
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

test("the owner screen states the floor where its old reading printed 0 hit(s)", () => {
  const screen = deriveOwnerScreen(PLAN.entries, BLOCKS, [], { capabilities: { id: "stand-in", ownerTermIntersection: true } });
  const owner = screen.owners.find((o) => o.qid === "q-owner");
  assert.equal(owner.state, "crowd");
  assert.equal(owner.total_hits, null);
  assert.equal(owner.total_floor, 10000);
  const said = ownerScreenNegative(screen);
  assert.match(said, /Qzxv Holdings \(q-owner\) — more than 10,000 hit\(s\)/);
  assert.doesNotMatch(said, /\b0 hit\(s\)/);
});

test("the client's coverage line names a floor as more records than could be listed in full, never as a search that could not run", () => {
  const plan = { ...PLAN, entries: [PLAN.entries[0]] };
  const line = deriveScopeFacts({ instructedScope: { marks: ["QZXV"], classes: [9], jurisdictions: ["us"], goods: null, customer: "X" },
    plan, planExecution: joinPlanToBands(plan, { "primary-sweep": [FLOOR_BLOCK("q-floor")] }), coverageRows: [] }).coverage_line;
  assert.match(line, /1 returned more records than could be listed in full/);
  assert.doesNotMatch(line, /could not be searched/);
});

test("the coverage form keeps a floor's row open: a floor is never a clean", () => {
  const open = openBlocksByAxis([{ axis: "primary-sweep", state: "incomplete" }], { "primary-sweep": [FLOOR_BLOCK("q-floor")] }, PLAN);
  assert.deepEqual(open["primary-sweep"], [{ qid: "q-floor" }]);
});

test("the knockout prints a floor as it always has", () => {
  assert.equal(moreThan(10000), "more than 10,000");
});

// ── A COUNT THE REGISTER DID NOT GIVE IS A SIZE NOBODY KNOWS ───────────────────────────────────────
//
// A count-only question answered with neither a total nor a floor was written down as a counted 0. The band
// shape then read an empty field: its uncountable-slice reading keys on a null total, so the 0 hid the one
// statement written for this case. Driven through the real executor's count arm against a register that
// answers without a number, then through the merged band into the shape the reading seats are served.
test("a count-only question answered with no total reaches the band shape as a size nobody knows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "count-no-total-"));
  try {
    const entry = { qid: "q-count", axis: "primary-sweep", predicate: "default", term: "QZXV",
      nice_classes: ["9"], regions: ["us"], expected_kind: "count" };
    const planPath = join(dir, "register-plan.json");
    const outPath = join(dir, "band.json");
    writeFileSync(planPath, JSON.stringify({ regions: ["us"], entries: [entry] }));
    const executePlan = makeExecutePlan({
      search: async () => ({ type: "text", text: JSON.stringify({ total_hits: null, total_approximate: false, total_floor: null, results: [], has_more: false }) }),
      enumerate: async () => { throw new Error("a count-only question must never enumerate"); },
      capabilities: { id: "stand-in" }, countParams: { limit: 1 },
    });
    await executePlan("auth", { plan_path: planPath, axis: "primary-sweep", output_path: outPath }, {});
    const band = JSON.parse(readFileSync(outPath, "utf8"));
    const blocks = Array.isArray(band) ? band : band.blocks;
    const block = blocks.find((b) => b.qid === "q-count");
    assert.equal(block.total_hits, null, "the count the register did not give was written down as a number");
    assert.notEqual(block.error, true, "the call was answered; it is not a provider error");
    const { shape } = buildBandShape(parseNamedBand(blocks), { inScopeClasses: ["9"] });
    const unknown = (shape.blind_spots ?? []).find((s) => s.kind === "uncountable-slice");
    assert.ok(unknown, `the band shape states no uncountable slice: ${JSON.stringify((shape.blind_spots ?? []).map((s) => s.kind))}`);
    assert.ok(unknown.zones.some((z) => z.query === block.query),
      "the uncountable slice does not name the count that came back without a number");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

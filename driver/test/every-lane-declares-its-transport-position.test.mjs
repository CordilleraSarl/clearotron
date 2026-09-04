// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A DERIVED POPULATION CANNOT REPORT A LANE WITH ZERO MEMBERS.
//
// ── THE DEFECT, WHICH IS IN THE CENSUSES AND NOT IN THE CODE THEY WATCH ──────────────────────────────
//
// Both transport censuses derive their population — one from RECORDING_STAGES plus the tools served
// outside it, one from what the MCP servers serve. That derivation is right, and it is why a new
// clearance transport joins them on the commit that adds it.
//
// It is also why the KNOCKOUT lane was invisible to them. A derived population cannot report a family
// with zero members: both censuses read "15/15 clean", a reader concluded the transports were covered,
// and a whole client-facing product family sat outside the denominator unremarked. They would have gone
// on reading clean forever, and the lane surfaced only because someone went looking for something else.
//
// That is the vacuity family one level up. This repo already catches an empty CHECK. This is an empty
// DENOMINATOR, and it passes every check-level guard by construction.
//
// ── WHY LANES AND NOT PRODUCTS (design ruling,) ───────────────────────────────────
//
// The owner names four critical products: Knockout, Global Prelim, Multi Country, Full Country Search.
// An arm asking each of FOUR PRODUCTS to declare a position gets three identical declarations out of one
// pipeline and one out of knockout — coverage-shaped emptiness, which is the same failure this arm
// exists to prevent, reproduced inside the fix.
//
// So it enumerates LANES: a pipeline with its own stage table, which is what actually owns a return
// path. A lane serving three products declares ONCE and is visibly shared. The four product names still
// appear in the output, mapped to their lane, so the owner's list stays visibly accounted on every run.
//
// ── WHY NOT PINNED TO THE OFFERING PAGE ──────────────────────────────────────────────────────────────
//
// Content-pinning this to the New Clearance page's offering was proposed and WITHDRAWN by the same
// ruling, recorded here so it is not re-proposed: it pins a guard about CODE STRUCTURE to a MARKETING
// SURFACE. The page can be reworded with no lane changing, and a lane can be added with no page
// changing. The lane roster is derivable and verifiable; the page is neither.
//
// ── TWO DERIVATIONS, REQUIRED TO AGREE ───────────────────────────────────────────────────────────────
//
// The roster is derived twice and the two must match: the lanes PRODUCTS name, and the lanes that exist
// as stage tables in code. Either alone is a single point of rot — a lane added in code that nothing
// sells is as much a finding as a product naming a lane that does not exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES } from "../stages.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";
import { PRODUCTS } from "../products.mjs";
import { RECORDING_STAGES } from "../engine/mcp/gather-config.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const POSITIONS = JSON.parse(readFileSync(join(DRIVER, "lane-transport-positions.json"), "utf8"));

/**
 * Lane -> its stage table. The one hand-written line in this file, and it is the thing a new lane must
 * touch: a pipeline added in code with no row here fails the agreement arm by name rather than being
 * quietly absent. `STAGES` and `KO_STAGES` are separate exports of separate modules, so there is no
 * derivation that reaches both without naming them.
 */
const LANE_TABLES = Object.freeze({ clearance: STAGES, knockout: KO_STAGES });

/** Lanes the offering's products actually run on. */
function lanesFromProducts() {
  assert.ok(Array.isArray(PRODUCTS) && PRODUCTS.length > 0,
    "PRODUCTS is empty — every arm below would pass over nothing");
  const byLane = new Map();
  for (const p of PRODUCTS) {
    const lane = p?.pipeline;
    assert.ok(typeof lane === "string" && lane,
      `product ${JSON.stringify(p?.id)} names no pipeline — it cannot be mapped to a lane, and a product on no lane is exactly what this arm exists to surface`);
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane).push(p.name ?? p.id);
  }
  return byLane;
}

/** Which of a lane's stages hold a recording grant. */
function coverageOf(lane) {
  const table = LANE_TABLES[lane];
  const stages = Object.keys(table ?? {});
  assert.ok(stages.length > 0,
    `lane '${lane}' resolves to a stage table with no stages — a lane with nothing in it makes its coverage count meaningless rather than zero`);
  const recording = new Set(Object.keys(RECORDING_STAGES));
  return { stages, covered: stages.filter((s) => recording.has(s)) };
}

test("the lane roster derives the same way twice — from the products, and from the code", () => {
  const fromProducts = [...lanesFromProducts().keys()].sort();
  const fromCode = Object.keys(LANE_TABLES).sort();
  assert.deepEqual(fromProducts, fromCode,
    "the lanes the products name and the lanes that exist as stage tables disagree. A lane in code that no product "
    + "sells, or a product on a lane with no stage table, is a finding either way — and a roster derived once "
    + "cannot tell you which happened.");
});

// ── THE POSITION RULES, AS A PURE PREDICATE ────────────────────────────────────
//
// ✕ THESE ASSERTIONS WERE DEAD, AND ONLY CI COULD SEE IT. knockout-assess's conversion emptied
// `unconverted`, which is what the file's own rule demands of a lane that gains coverage — and with the
// list empty, every branch that validates a ROW stopped executing. Four assert sites, green locally,
// green in the walk, never run. The coverage census caught it (`0 → 4`), which no local suite reaches.
//
// The dead set included the arm added in that same commit to close a hole: an arm that loops over an
// empty list is not a guard, it is a comment. Re-stamping the census would have accepted all four.
//
// So the rules are a PURE FUNCTION now, driven by the real walk AND by plants — the idiom this repo
// already uses where a real corpus cannot exercise a branch. The plants are what keep the rules alive
// while the tree is fully converted; the walk is what makes them true of this tree.
export function positionFindings({ lane, covered, row, lanes }) {
  const out = [];
  if (row && lanes && !lanes.has(row.lane))
    out.push({ kind: "row-names-no-lane", lane: row.lane,
      detail: `lane-transport-positions.json declares '${row.lane}', which is not a lane any product runs on. `
        + "The coverage walk looks lanes UP in this list, so a row for a non-existent lane is never visited "
        + "and its reason is never checked — it reads as a position held when nothing holds it." });

  if (covered.length === 0) {
    if (!row) {
      out.push({ kind: "undeclared", lane,
        detail: `lane '${lane}' owns NO typed transport and has no row. Both censuses derive their population, `
          + "so they cannot report this lane at all — it is absent from their denominator, not clean in it." });
    } else {
      if (!(typeof row.why === "string" && row.why.trim().length >= 40))
        out.push({ kind: "no-reason", lane,
          detail: `lane '${lane}' is declared unconverted with no real reason — a row that says nothing is the absence it replaced` });
      if (!/#\d+/.test(String(row.issue ?? "")))
        out.push({ kind: "no-issue", lane,
          detail: `lane '${lane}' is declared unconverted with no tracker issue — a declaration nobody can follow is a note, not a position` });
    }
  } else if (row) {
    out.push({ kind: "stale-row", lane,
      detail: `lane '${lane}' holds ${covered.length} recording stage(s) AND is still declared unconverted. `
        + "This list can only shrink: delete its row in the commit that converted it." });
  }
  return out;
}

const LANES2 = new Set(["clearance", "knockout"]);
const GOOD_ROW = { lane: "knockout", why: "x".repeat(40), issue: "#1997" };

test("PLANT: an unconverted lane with no row is a finding", () => {
  assert.deepEqual(positionFindings({ lane: "knockout", covered: [], row: null, lanes: LANES2 }).map((f) => f.kind),
    ["undeclared"]);
});

test("PLANT: a declared row with no real reason, and one with no tracker issue", () => {
  assert.deepEqual(positionFindings({ lane: "knockout", covered: [], row: { ...GOOD_ROW, why: "short" }, lanes: LANES2 }).map((f) => f.kind),
    ["no-reason"]);
  assert.deepEqual(positionFindings({ lane: "knockout", covered: [], row: { ...GOOD_ROW, issue: "soon" }, lanes: LANES2 }).map((f) => f.kind),
    ["no-issue"]);
});

test("PLANT: a row that outlived its lane's conversion is a finding", () => {
  assert.deepEqual(positionFindings({ lane: "knockout", covered: ["knockout-assess"], row: GOOD_ROW, lanes: LANES2 }).map((f) => f.kind),
    ["stale-row"]);
});

test("PLANT: a row naming a lane no product runs on is a finding, and costs TWICE", () => {
  const typo = { ...GOOD_ROW, lane: "kockout" };
  // Driven the way the real walk drives it — once per ROW, then once per LANE — because that is where
  // the two halves of the cost show up separately. The first cut of this plant passed both at once and
  // asserted a shape the walk never produces; the plant was wrong, not the rule.
  assert.deepEqual(positionFindings({ lane: typo.lane, covered: [], row: typo, lanes: LANES2 }).map((f) => f.kind),
    ["row-names-no-lane"], "the row walk must name the dangling row");
  // …and the lane it was MEANT to declare has no row at all, so it reads as undeclared. That is the
  // second half of what a mistyped row costs, and it is why the dangling-row rule is not cosmetic.
  assert.deepEqual(positionFindings({ lane: "knockout", covered: [], row: undefined, lanes: LANES2 }).map((f) => f.kind),
    ["undeclared"], "the lane the typo was meant to cover is left undeclared");
});

test("PLANT: the fully-converted state is clean, and that is not the same as unchecked", () => {
  assert.deepEqual(positionFindings({ lane: "knockout", covered: ["knockout-assess"], row: null, lanes: LANES2 }), []);
});

test("every lane owns a typed return path, or declares in writing why it does not", () => {
  const byLane = lanesFromProducts();
  const lanes = new Set(byLane.keys());
  const declared = new Map(POSITIONS.unconverted.map((r) => [r.lane, r]));
  const lines = [];
  const findings = [];

  // EVERY ROW, not only the rows a lane lookup reaches — that asymmetry is the hole the dangling-row
  // rule closes, and walking rows here is what makes it reachable on a tree that has any.
  for (const row of POSITIONS.unconverted)
    findings.push(...positionFindings({ lane: row?.lane, covered: [], row, lanes }).filter((f) => f.kind === "row-names-no-lane"));

  for (const [lane, products] of [...byLane].sort()) {
    const { stages, covered } = coverageOf(lane);
    const row = declared.get(lane);
    const position = covered.length
      ? `COVERED — ${covered.length} of ${stages.length} stage(s) hold a recording grant`
      : `UNCONVERTED — 0 of ${stages.length} stage(s), declared: ${row?.issue ?? "(no declaration)"}`;

    // THE OWNER'S FOUR, VISIBLY ACCOUNTED ON EVERY RUN — the point of printing rather than only asserting.
    for (const name of products) lines.push(`  ${name.padEnd(30)} → lane '${lane}': ${position}`);

    findings.push(...positionFindings({ lane, covered, row, lanes }).filter((f) => f.kind !== "row-names-no-lane"));
  }

  assert.deepEqual(findings.map((f) => f.detail), [],
    "a lane's transport position does not hold. Each line below is one rule from positionFindings, and "
    + "every one of those rules is driven by a plant above, so a green here is the corpus being clean "
    + "rather than the rules being unreachable.");

  console.log(`\nlane transport positions (${byLane.size} lane(s), ${PRODUCTS.length} product(s)):\n${lines.join("\n")}\n`);
});

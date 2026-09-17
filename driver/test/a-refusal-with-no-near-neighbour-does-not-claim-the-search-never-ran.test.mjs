// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT THIS IS FOR. The meaning-sweep gate joins the queries the driver dictated against the queries the
// seat recorded. When one does not join, the refusal used to name one of two faults: UNMATCHED when a
// recorded query looked similar, ABSENT when none did.
//
// ABSENT was a claim the gate cannot make. "Nothing recorded resembles this" is an observation; "the
// search never ran" is a conclusion, and a query recorded under a translation, a transliteration or the
// seat's own rewording resembles nothing while having already run. The seat was then told to re-run it —
// the same loop the unmatched branch exists to break, one wording-distance further out.
//
// No threshold fixes this and none is wanted: a score high enough to decide would be a score high enough
// to hide a query nobody ran. So the label states the observation and the remedy carries BOTH repairs.
//
// THESE ARMS DRIVE THE WHOLE CHAIN — ledger to refusal to the sentence a seat actually reads — because
// the defect lived in the join between two halves that each looked right alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { MEANING_SEAT, GRID_SEATS, splitGridSpec } from "../common-law-receipts.mjs";
import { correctionHint } from "../gateway.mjs";

const PLATFORMS = ["web"];
const cellsFor = (terms) => terms.flatMap((t) => PLATFORMS.map((platform) => ({ term: t, platform, status: "no_hit", results: [] })));

// Invented mark throughout.
const SPEC = {
  terms: ["novapulse", "nuvapulse"],
  platforms: PLATFORMS,
  output_path: "/x/r/common-law-grid.json",
  batch: 14,
  ledger_required: true,
};

const DOC = [
  `# Common-law findings — meaning sweep (seat ${MEANING_SEAT})`, "",
  "## Findings — Mark: X", "| a | b |", "",
  "### PR / reputational risk", "(None identified — affirmative sweep) — reads clean.",
  "**Connotation-search source:** perplexity_research (dictated sweep)", "",
  "### Audit trail", "| 1 | meaning | queries | ok |", "",
].join("\n") + "x".repeat(200);

/** Dictate `queries`, record `recorded`, and return the gate's refusal reason. */
async function refusalFor(queries, recorded) {
  const { validators } = await import("../verify.mjs");
  const dir = mkdtempSync(join(tmpdir(), "clhalf-noresemble-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const H = MEANING_SEAT;
    const spec = { ...SPEC, connotation: { queries } };
    const halves = splitGridSpec(spec, { dispositionsPaths: Object.fromEntries(GRID_SEATS.map((h) => [h, join(dir, `d-${h}.json`)])) });
    const half = halves[H];
    writeFileSync(driverDir(dir, `grid-spec.half-${H}.json`), JSON.stringify(half));
    writeFileSync(join(dir, `common-law-grid.half-${H}.json`), JSON.stringify({
      cells: cellsFor(half.terms),
      extras: { pr_risk: recorded.map((q) => ({ query: q, results: [] })) },
      gaps: [],
    }));
    const p = join(dir, `common-law-findings.half-${H}.md`);
    writeFileSync(p, DOC);
    return String(validators.commonLawHalf(p, DOC).reason ?? "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const hintFor = (reason) => correctionHint(reason, { gridLedgerName: `common-law-grid.half-${MEANING_SEAT}.json` });

test("a query nothing recorded resembles is not reported as one that never ran", async () => {
  // THE CASE THAT SENT A SEAT ROUND THE LOOP. The dictated query WAS searched and recorded — under a
  // translation. It shares no significant words, so no near neighbour is found. The gate cannot know it
  // ran, and must not say it did not.
  const reason = await refusalFor(
    ["novapulse offensive meaning"],
    ["signification offensante de novapulse"]);

  assert.match(reason, /connotation_query_unrecorded/, "the gate did not refuse at all");
  assert.match(reason, /\[no recorded query resembles this one\]/,
    "the refusal does not name what the gate actually observed");
  assert.doesNotMatch(reason, /absent from the ledger/,
    "the refusal still asserts the search never ran, which is a conclusion this gate cannot reach");
});

test("and the seat is given both repairs rather than told to re-run", async () => {
  const hint = hintFor(await refusalFor(
    ["novapulse offensive meaning"],
    ["signification offensante de novapulse"]));

  assert.match(hint, /cannot tell which/i, "the hint does not admit the ambiguity it is built on");
  assert.match(hint, /EDIT that row's `query`/,
    "the repair for a query that already ran under other wording is missing — this is the one that "
    + "turned one attempt into four");
  assert.match(hint, /IF IT NEVER RAN/,
    "the repair for a query that genuinely never ran is missing");
  // THE FLOOR ON THE OLD BEHAVIOUR. The previous hint opened by asserting the rows were missing.
  assert.doesNotMatch(hint, /these are missing from/,
    "the hint still opens by asserting the queries were never recorded");
});

test("a query with a near neighbour keeps today's behaviour, and is still told not to re-run", async () => {
  // Re-ordered words: the key does not fold that, deliberately, so it drops — but enough words overlap
  // for the nearest to be found, and THAT case the gate genuinely does know.
  const reason = await refusalFor(
    ["novapulse street slang meaning"],
    ["meaning of novapulse street slang"]);

  assert.match(reason, /\[unmatched; nearest recorded:/, "a recorded near neighbour was not identified");
  assert.match(reason, /nearest recorded: meaning of novapulse street slang/,
    "the refusal does not show what WAS recorded, so the difference cannot be seen without the ledger");

  const hint = hintFor(reason);
  assert.match(hint, /Do NOT re-run them/,
    "a query the gate KNOWS already ran is no longer protected from a pointless re-run");
});

test("the two states are told apart by the ledger, not by the wording of one query", async () => {
  // THE DISCRIMINATION THIS WHOLE CHANGE RESTS ON, and the plant the issue asked for: the SAME dictated
  // query, and only the recorded side moves. Below the overlap cut-off it is unresembled; above it, the
  // nearest is named. If both produced the same label, no arm above would mean anything.
  const q = "novapulse street slang meaning";
  const far = await refusalFor([q], ["signification argotique de novapulse"]);
  const near = await refusalFor([q], ["meaning of novapulse street slang"]);

  assert.match(far, /\[no recorded query resembles this one\]/);
  assert.match(near, /\[unmatched; nearest recorded:/);
  assert.notEqual(far, near, "moving only the RECORDED side changed nothing — the gate is not discriminating");

  // And the two hints ask for different things, which is the point of the labels existing.
  assert.doesNotMatch(hintFor(far), /Do NOT re-run them/, "the unresembled case is told what the gate cannot know");
  assert.match(hintFor(near), /Do NOT re-run them/, "the resembled case lost its protection from a re-run");
});

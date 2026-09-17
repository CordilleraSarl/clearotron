// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT THIS IS FOR. The meaning-sweep gate joins the queries the driver dictated against the queries the
// seat recorded, and its refusal names, for each query it could not join, the recorded query that most
// resembles it. A sweep about one mark dictates a query and its one-word negation — "<mark> meaning" and
// "<mark> offensive meaning" — so the nearest recorded query to either one is very often the other.
//
// THAT MAKES THE REFUSAL READ LIKE A CROSSING. Two such lines together say query A's nearest record is B
// and query B's nearest record is A, which invites the reading that the gate pairs each query with its
// variant instead of with its own record, and that a complete pair therefore fails. A clearance run was
// diagnosed that way.
//
// The gate does no such thing, and these arms are the control that says so rather than a fix for a fault
// it does not have. The join is set membership on the shared key; nothing is consumed, and the
// near-neighbour search composes the MESSAGE only. A query whose own record is present cannot be
// dropped, and could not name a sibling as its nearest even if it were: its own record is a perfect
// match and the sibling is not.
//
// So the two states are told apart here, and by the script as well as by the wording, because a run that
// failed this way failed on a non-Latin half and the inference that the script is the cause is available
// and wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { MEANING_SEAT, GRID_SEATS, splitGridSpec } from "../common-law-receipts.mjs";

// Invented marks throughout, Latin and non-Latin, and no text from any run.
const LAT = "novapulse";
const NON = "новапульс";
const PLATFORMS = ["web"];
const cellsFor = (terms) => terms.flatMap((t) => PLATFORMS.map((platform) => ({ term: t, platform, status: "no_hit", results: [] })));
const SPEC = { terms: [LAT, "nuvapulse"], platforms: PLATFORMS, output_path: "/x/r/common-law-grid.json", batch: 14, ledger_required: true };
const DOC = [
  `# Common-law findings — meaning sweep (seat ${MEANING_SEAT})`, "",
  "## Findings — Mark: X", "| a | b |", "",
  "### PR / reputational risk", "(None identified — affirmative sweep) — reads clean.",
  "**Connotation-search source:** perplexity_research (dictated sweep)", "",
  "### Audit trail", "| 1 | meaning | queries | ok |", "",
].join("\n") + "x".repeat(200);

/** Dictate `queries`, record `recorded`, return the gate's refusal reason (empty when it does not refuse). */
async function refusalFor(queries, recorded) {
  const { validators } = await import("../verify.mjs");
  const dir = mkdtempSync(join(tmpdir(), "crossed-variant-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const H = MEANING_SEAT;
    const halves = splitGridSpec({ ...SPEC, connotation: { queries } },
      { dispositionsPaths: Object.fromEntries(GRID_SEATS.map((h) => [h, join(dir, `d-${h}.json`)])) });
    const half = halves[H];
    writeFileSync(driverDir(dir, `grid-spec.half-${H}.json`), JSON.stringify(half));
    writeFileSync(join(dir, `common-law-grid.half-${H}.json`), JSON.stringify({
      cells: cellsFor(half.terms), extras: { pr_risk: recorded.map((q) => ({ query: q, results: [] })) }, gaps: [],
    }));
    const p = join(dir, `common-law-findings.half-${H}.md`);
    writeFileSync(p, DOC);
    return String(validators.commonLawHalf(p, DOC).reason ?? "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const pair = (t) => [`${t} meaning`, `${t} offensive meaning`];

test("a complete pair joins — the gate does not cross a query with its one-word negation", async () => {
  // THE CONTROL THAT DID NOT EXIST. If the gate crossed them, this is where it would show.
  const reason = await refusalFor(pair(LAT), pair(LAT));
  assert.doesNotMatch(reason, /connotation_query_unrecorded/,
    "a pair recorded exactly as dictated was refused — the gate is crossing a query with its variant");
});

test("and it joins the same pair in a non-Latin script, so the script is not the discriminator", async () => {
  // The run that was diagnosed as a crossing failed on its non-Latin half, and the halves that passed
  // owed no queries at all — so they were never a control for the script.
  const reason = await refusalFor(pair(NON), pair(NON));
  assert.doesNotMatch(reason, /connotation_query_unrecorded/,
    "a non-Latin pair recorded exactly as dictated was refused where the Latin pair was not");
});

test("order is not identity either — the ledger may record the pair in either order", async () => {
  const reason = await refusalFor(pair(LAT), [...pair(LAT)].reverse());
  assert.doesNotMatch(reason, /connotation_query_unrecorded/,
    "the join depends on the order the seat happened to record in");
});

test("ONE missing record refuses ONE query, and names the sibling — the line that reads like a crossing", async () => {
  // This is the whole of what a crossing looks like from the outside, and it is a single absence. The
  // arm is here so the next reader of that refusal can see which state produces it.
  const reason = await refusalFor(pair(LAT), [`${LAT} offensive meaning`]);
  assert.match(reason, /connotation_query_unrecorded/, "a genuinely absent record was not refused");
  assert.match(reason, new RegExp(`${LAT} meaning \\[unmatched; nearest recorded: ${LAT} offensive meaning\\]`),
    "the refusal no longer names the sibling as the nearest record");
  // And the arm is not vacuous about which query was dropped: the recorded one is not in the refusal.
  assert.doesNotMatch(reason, new RegExp(`connotation_query_unrecorded:${LAT} offensive meaning`),
    "the query that WAS recorded is reported as unrecorded");
});

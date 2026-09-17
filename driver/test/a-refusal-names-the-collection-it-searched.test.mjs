// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT THIS IS FOR. A run answers "what did this half record" in four places that mean different
// things: the results ledger this gate joins against, that ledger's gap rows, the obligations sidecar,
// and the final-state receipts audit. They share one word between them, and a refusal that says only
// "recorded" invites a reader to answer from whichever they happen to open.
//
// That is not hypothetical. On one clearance, two readers reached three different wrong mechanisms in
// an evening, each from a correct measurement of a real record — and every one of them began by reading
// "nearest recorded" as "nearest in anything this run recorded".
//
// So the refusal names the file it searched, and says what a near neighbour is evidence OF.
//
// THE SECOND ARM IS THE ONE NEITHER NAMING NOR PROVENANCE WOULD HAVE CAUGHT. The reader that builds the
// recorded set folds rows onto the raw query text, so its output is smaller than the ledger whenever a
// query was recorded twice, and nothing at the call site said so. Every count taken that evening was
// post-fold. A seat that recorded one query twice while skipping another is indistinguishable, from the
// folded count alone, from a seat that simply skipped one — and they are different defects.
//
// THE LAST ARM IS A CONTRACT, not wording. The gateway reads these labels back to choose which repair a
// seat is offered, and the two repairs are opposite. Both sides build and detect from one pair of
// constants, so re-wording a label cannot silently collapse that choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { MEANING_SEAT, GRID_SEATS, splitGridSpec } from "../common-law-receipts.mjs";
import { CONNOTATION_UNMATCHED_MARK, CONNOTATION_NO_RESEMBLANCE_MARK, prRiskPopulation } from "../connotation-search.mjs";
import { correctionHint } from "../gateway.mjs";

const MARK = "novapulse";
const PLATFORMS = ["web"];
const LEDGER = `common-law-grid.half-${MEANING_SEAT}.json`;
const cellsFor = (terms) => terms.flatMap((t) => PLATFORMS.map((platform) => ({ term: t, platform, status: "no_hit", results: [] })));
const SPEC = { terms: [MARK, "nuvapulse"], platforms: PLATFORMS, output_path: "/x/r/common-law-grid.json", batch: 14, ledger_required: true };
const DOC = [
  `# Common-law findings — meaning sweep (seat ${MEANING_SEAT})`, "",
  "## Findings — Mark: X", "| a | b |", "",
  "### PR / reputational risk", "(None identified — affirmative sweep) — reads clean.",
  "**Connotation-search source:** perplexity_research (dictated sweep)", "",
  "### Audit trail", "| 1 | meaning | queries | ok |", "",
].join("\n") + "x".repeat(200);

/** `recordedRows` is written to the ledger VERBATIM, so a repeated entry stays a repeated row. */
async function refusalFor(queries, recordedRows) {
  const { validators } = await import("../verify.mjs");
  const dir = mkdtempSync(join(tmpdir(), "names-collection-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const H = MEANING_SEAT;
    const halves = splitGridSpec({ ...SPEC, connotation: { queries } },
      { dispositionsPaths: Object.fromEntries(GRID_SEATS.map((h) => [h, join(dir, `d-${h}.json`)])) });
    const half = halves[H];
    writeFileSync(driverDir(dir, `grid-spec.half-${H}.json`), JSON.stringify(half));
    writeFileSync(join(dir, `common-law-grid.half-${H}.json`), JSON.stringify({
      cells: cellsFor(half.terms), extras: { pr_risk: recordedRows.map((q) => ({ query: q, results: [] })) }, gaps: [],
    }));
    const p = join(dir, `common-law-findings.half-${H}.md`);
    writeFileSync(p, DOC);
    return String(validators.commonLawHalf(p, DOC).reason ?? "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the refusal names the file it searched, and says what a neighbour is evidence of", async () => {
  const near = await refusalFor([`${MARK} meaning`, `${MARK} offensive meaning`], [`${MARK} offensive meaning`]);
  assert.match(near, new RegExp(LEDGER.replace(/\./g, "\\.")),
    "the refusal does not say which of the run's four record-keeping places it joined against");
  assert.match(near, /evidence a query LIKE it was recorded there, not that these two are the same query/,
    "the near-neighbour sentence still invites the reading that the two are one query");

  const far = await refusalFor([`${MARK} meaning`], ["signification offensante"]);
  assert.match(far, new RegExp(LEDGER.replace(/\./g, "\\.")),
    "the no-resemblance sentence does not name the file it searched either");
});

test("a ledger that repeats a query says so — the fold is named, not silent", async () => {
  // The seat wrote three rows for two distinct queries and skipped a third dictated one. From the
  // folded count alone that is indistinguishable from a seat that simply skipped one.
  const reason = await refusalFor(
    [`${MARK} meaning`, `${MARK} offensive meaning`, `${MARK} reputation`],
    [`${MARK} meaning`, `${MARK} meaning`, `${MARK} offensive meaning`]);
  assert.match(reason, /connotation_query_unrecorded/, "the missing query was not refused");
  assert.match(reason, /fold to 2 distinct query\(ies\)/, "the refusal does not report the raw population");
  assert.match(reason, /1 repeat a query already counted/, "the refusal does not say how many rows repeated");
});

test("and it stays silent about the fold when nothing folded", async () => {
  const reason = await refusalFor([`${MARK} meaning`, `${MARK} reputation`], [`${MARK} meaning`]);
  assert.match(reason, /connotation_query_unrecorded/);
  assert.doesNotMatch(reason, /repeat a query already counted/,
    "a ledger with no repeats is being described as though it folded something");
});

test("prRiskPopulation counts the ledger, not the fold", () => {
  const led = JSON.stringify({ extras: { pr_risk: [{ query: "a" }, { query: "a" }, { query: "b" }, { query: "  " }] } });
  assert.deepEqual(prRiskPopulation(led), { rows: 3, distinct: 2, repeated: 1 },
    "the population reader has stopped separating what was written from what survived the fold");
});

test("THE CONTRACT: the gateway chooses its repair from the validator's own labels", async () => {
  // The two repairs are opposite — "do not re-run, fix the wording" against "run it and append the row".
  // The gateway used to match on its own copy of the validator's prose, so a re-worded label would have
  // kept the hint flowing and stopped it being the right one.
  const unmatched = await refusalFor([`${MARK} meaning`, `${MARK} offensive meaning`], [`${MARK} offensive meaning`]);
  assert.ok(unmatched.includes(CONNOTATION_UNMATCHED_MARK), "the validator no longer emits the shared label");
  const hint = correctionHint(unmatched, { gridLedgerName: LEDGER });
  assert.match(hint, /Do NOT re-run them/, "the gateway did not recognise the near-neighbour case");

  const far = await refusalFor([`${MARK} meaning`], ["signification offensante"]);
  assert.ok(far.includes(CONNOTATION_NO_RESEMBLANCE_MARK), "the validator no longer emits the shared label");
  const hint2 = correctionHint(far, { gridLedgerName: LEDGER });
  assert.match(hint2, /cannot tell which/i, "the gateway did not recognise the no-resemblance case");
});

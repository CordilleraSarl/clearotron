// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT THIS IS FOR. When the meaning-sweep gate cannot join a dictated query to a recorded one it tells
// the seat what it sees and offers two repairs: edit the wording, or run the search. Neither is the
// remedy when the PROVIDER declined the query — and the provider says so, in the same file the gate has
// just read, because its contract is to append `<query> | connotation | <exception>` to the ledger's
// gaps and carry on.
//
// The gate did not look. It refused on receipt membership alone, so a query a provider had already
// refused got the identical sentence to one nobody ever issued, and the seat spent attempts on the one
// repair that cannot work. The clearance that prompted this failed eight attempts across two recovery
// cycles on that half.
//
// IT STILL FAILS, and that is deliberate rather than an oversight: laundering an honest provider error
// into a clean receipt would be a worse defect than the one being fixed. What changes is only what the
// seat is told.
//
// The last arm is the shape of the run itself, and it is the one worth keeping: a dictated query that
// reached NOTHING — no receipt, no gap row, no trace in any collection — sitting beside a different
// dictated query in the same ledger that ran, errored, and was reported correctly. The second is the
// control that makes the first a finding rather than a broken provider path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { MEANING_SEAT, GRID_SEATS, splitGridSpec } from "../common-law-receipts.mjs";

const MARK = "novapulse";
const PLATFORMS = ["web"];
const cellsFor = (terms) => terms.flatMap((t) => PLATFORMS.map((platform) => ({ term: t, platform, status: "no_hit", results: [] })));
const SPEC = { terms: [MARK, "nuvapulse"], platforms: PLATFORMS, output_path: "/x/r/common-law-grid.json", batch: 14, ledger_required: true };
const DOC = [
  `# Common-law findings — meaning sweep (seat ${MEANING_SEAT})`, "",
  "## Findings — Mark: X", "| a | b |", "",
  "### PR / reputational risk", "(None identified — affirmative sweep) — reads clean.",
  "**Connotation-search source:** perplexity_research (dictated sweep)", "",
  "### Audit trail", "| 1 | meaning | queries | ok |", "",
].join("\n") + "x".repeat(200);

/** Dictate `queries`, record `recorded`, carry `gaps`, return the gate's refusal reason. */
async function refusalFor(queries, recorded, gaps = []) {
  const { validators } = await import("../verify.mjs");
  const dir = mkdtempSync(join(tmpdir(), "provider-declined-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const H = MEANING_SEAT;
    const halves = splitGridSpec({ ...SPEC, connotation: { queries } },
      { dispositionsPaths: Object.fromEntries(GRID_SEATS.map((h) => [h, join(dir, `d-${h}.json`)])) });
    const half = halves[H];
    writeFileSync(driverDir(dir, `grid-spec.half-${H}.json`), JSON.stringify(half));
    writeFileSync(join(dir, `common-law-grid.half-${H}.json`), JSON.stringify({
      cells: cellsFor(half.terms), extras: { pr_risk: recorded.map((q) => ({ query: q, results: [] })) }, gaps,
    }));
    const p = join(dir, `common-law-findings.half-${H}.md`);
    writeFileSync(p, DOC);
    return String(validators.commonLawHalf(p, DOC).reason ?? "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const gap = (term, error) => ({ term, platform: "connotation", error });

test("a query the provider REPORTED an error on is named as that, not as one nobody ran", async () => {
  const reason = await refusalFor([`${MARK} meaning`], [], [gap(`${MARK} meaning`, "upstream 503 from the search API")]);
  assert.match(reason, /connotation_query_unrecorded/, "an errored query must still fail the gate");
  assert.match(reason, /the provider REPORTED an error on this query/,
    "the gate is not reading the gap rows in the ledger it just read");
  assert.match(reason, /upstream 503/, "the provider's own reason is not carried to the seat");
  assert.doesNotMatch(reason, /no recorded query resembles this one/,
    "an errored query is still being described as one nothing resembles");
});

test("and a query with no gap row keeps the sentence it had — the two states are told apart", async () => {
  const reason = await refusalFor([`${MARK} meaning`], [], []);
  assert.match(reason, /connotation_query_unrecorded/);
  assert.doesNotMatch(reason, /the provider REPORTED an error/,
    "a query the provider never mentioned is being reported as one it declined");
  assert.match(reason, /no recorded query resembles this one/, "the existing sentence was lost");
});

test("THE SHAPE OF THE RUN: a query that reached nothing, beside one that errored and was reported", async () => {
  // Two dictated. One was run, errored, and the provider reported it — and it is IN the receipts, so it
  // joins and is not refused. The other reached no collection at all. Only the second is the finding.
  const ran = `${MARK} offensive meaning`;
  const traceless = `${MARK} meaning`;
  const reason = await refusalFor([traceless, ran], [ran], [gap(ran, "upstream 503 from the search API")]);

  assert.match(reason, /connotation_query_unrecorded/, "the traceless query was not refused");
  assert.match(reason, new RegExp(`connotation_query_unrecorded:${traceless}`),
    "the refusal does not name the query that reached nothing");
  assert.doesNotMatch(reason, new RegExp(`connotation_query_unrecorded:${ran}`),
    "a query that ran, errored and was RECORDED is being refused as unrecorded");
  assert.doesNotMatch(reason, /the provider REPORTED an error/,
    "the traceless query is wearing the other one's gap row — the join is matching the wrong query");
});

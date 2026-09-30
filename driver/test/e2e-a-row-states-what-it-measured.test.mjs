// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-a-row-states-what-it-measured.test.mjs — a harness row may state its measurement, never a cause it never looked at.
//
// WHAT WENT WRONG. Two rows printed "CLEAROTRON_REPORTS_URL is unset on this instance" whenever a
// delivered run carried no report address. The check had looked at one thing — whether any entry
// carried a url — and stated a second thing about the instance's configuration as a fact.
//
// IT WAS WRONG ON THE RUN THAT PRODUCED IT. Measured 2026-09-30: the variable was present and non-empty
// in the instance's env file AND in the worker process's own environment, and the run's eight report
// entries each carried a `url` key with an empty value. The stamp had run and produced nothing. The
// cause of the empty stamp is still unknown, which is exactly the state the row was hiding.
//
// AND THE FILE ALREADY KNEW. One line below each row, the same condition pushed the same variable to
// the investigate list WITH A QUESTION MARK. The hedged form and the flat form sat one line apart, and
// the one a reader sees was the flat one.
//
// WHAT IT COST: acting on the row, the obvious repair is to restore the variable from a backup —
// overwriting a working value with an older one and calling it a fix.
//
// A SOURCE CENSUS, not a behavioural arm, and deliberately. The defect is a SENTENCE, and a sentence is
// what has to be kept out. An arm that drove the check would assert on the message it happens to print
// today; this asserts that no row anywhere in the file states this cause as a fact, including in a row
// somebody adds later.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "e2e.mjs"), "utf8");

// A row is what a reader sees: a console.log line. The investigate list is a different surface and is
// allowed to carry a hypothesis, because it is read as one.
const rowLines = SRC.split("\n").filter((l) => /console\.log\(/.test(l));

test("NO PRINTED ROW STATES THAT THE REPORTS URL VARIABLE IS UNSET", () => {
  // Flat assertions of the cause, in the wordings that shipped and the near ones somebody would reach
  // for next. The variable may be NAMED in a row; what it may not do is declare the instance's state.
  const stated = rowLines.filter((l) =>
    /CLEAROTRON_REPORTS_URL\s+is\s+(unset|not set|empty|missing)/i.test(l)
    || /(unset|not set|missing)\s+on\s+this\s+instance/i.test(l));
  assert.deepEqual(stated, [], `a row states a cause the check never measured:\n${stated.join("\n")}`);
});

test("the two absence rows state the measurement — what was delivered, and that no entry carries a url", () => {
  // The positive half. Without it the arm above passes just as well if the rows were deleted.
  const batch = rowLines.find((l) => /delivered as a batch of/.test(l));
  assert.ok(batch, "the batch-absence row is gone");
  assert.match(batch, /carries a url/, `the batch row no longer states what it measured: ${batch}`);

  const single = rowLines.find((l) => /delivered, and status\.json carries no url/.test(l));
  assert.ok(single, "the single-absence row is gone or no longer states its measurement");
});

test("CONTROL: the cause survives on the investigate list, where it is read as a hypothesis", () => {
  // Removing the theory entirely would be the other failure: the next reader would have no idea where
  // to look. It moves to the surface that is read as a lead, and says it was not measured.
  const leads = SRC.split("\n").filter((l) => /toInvestigate\.push\(/.test(l) && /CLEAROTRON_REPORTS_URL/.test(l));
  assert.equal(leads.length, 2, `expected both absence arms to keep the lead, got ${leads.length}`);
  for (const l of leads) {
    assert.match(l, /NOT measured/i, `a lead states the cause without saying it was not measured: ${l}`);
    assert.match(l, /can still stamp empty/, `a lead omits the measurement that disproved the flat form: ${l}`);
  }
});

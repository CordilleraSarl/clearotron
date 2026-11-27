// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT NAMES THE SAME FAILED READER ON EVERY RUN. A Knockout reads the register with one reader per family of
// names, side by side, and the readers settle in whatever order they finish. Where several did not finish, the run named
// the first to settle: two runs of one order recorded different causes (reader 0 in one, reader 1 in the other), and a
// comparison of the two read that as a change in behaviour. The failures are now put in reader order before anything is
// read from them, so the note, the run log's cause and a failure that ends the run all name the lowest-numbered reader.
import { test } from "node:test";
import assert from "node:assert/strict";

const { inReaderOrder } = await import("../pipeline-knockout.mjs");

const failed = (c, kind = "missing_file") => ({ c, e: Object.assign(new Error(`reader ${c}: ${kind}`), { kind }) });

test("whichever reader settles first, the failures read in reader order", () => {
  for (const settled of [[failed(3), failed(1), failed(0), failed(2)], [failed(0), failed(1), failed(2), failed(3)], [failed(2), failed(3), failed(0), failed(1)]])
    assert.deepEqual(inReaderOrder([...settled]).map((f) => f.c), [0, 1, 2, 3]);
});

test("the cause recorded is the lowest-numbered reader's, on every settle order", () => {
  const cause = (failures) => inReaderOrder(failures)[0].e.message;
  assert.equal(cause([failed(1), failed(0)]), "reader 0: missing_file");
  assert.equal(cause([failed(0), failed(1)]), "reader 0: missing_file");
});

test("a failure that ends the run is the lowest-numbered of those that end it", () => {
  // The rule the lane applies to the ordered list: the first rate-limited or stopped reader is rethrown.
  const ends = (f) => f.e.kind === "rate-limited";
  const hard = (failures) => inReaderOrder(failures).find(ends).c;
  assert.equal(hard([failed(4, "rate-limited"), failed(0), failed(2, "rate-limited")]), 2);
  assert.equal(hard([failed(2, "rate-limited"), failed(4, "rate-limited"), failed(0)]), 2);
});

test("the list is put in order where it is, so the lane reads the ordered list itself", () => {
  const failures = [failed(1), failed(0)];
  assert.equal(inReaderOrder(failures), failures);
  assert.deepEqual(failures.map((f) => f.c), [0, 1]);
});

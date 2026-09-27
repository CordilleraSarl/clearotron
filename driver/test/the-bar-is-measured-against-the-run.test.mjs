// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE TEN-MINUTE BAR IS MEASURED AGAINST THE RUN, NOT AGAINST ONE STAGE OF IT.
//
// Ruling 591's bar is about a knockout run. It was recorded at the web sweep, against the sweep's own
// elapsed time, so both knockouts of 2026-09-26 stated `overBar: false` at 0.6 and 0.8 minutes while their
// runs took 14.4 minutes wall — which e2e scored as over the bar. The field's name said it had answered the
// question and the number beside it was about something else.
//
// A BAR RECORDED AGAINST THE WRONG QUANTITY IS WORSE THAN AN UNRECORDED ONE, because a reader who sees
// `overBar: false` stops looking. So the comparison now lives beside the constant it compares against, and
// the sweep's own span keeps a name that says what it measures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { knockoutBarVerdict, KNOCKOUT_MINUTES_BAR } from "../stages-knockout.mjs";

// The two rounds of 2026-09-26, as their own status files record them: a run of 14m25.2s whose sweep took
// 0.8 minutes. The point of using the real span is that it is the case the old record got wrong.
const STARTED = "2026-09-26T20:40:10.718Z";
const DELIVERED = "2026-09-26T20:54:35.897Z";

test("the run's own span decides the bar, and that span is over it", () => {
  const v = knockoutBarVerdict({ startedAt: STARTED, deliveredAt: DELIVERED });
  assert.equal(v.runMinutes, 14.4, "the span measured is not the run's");
  assert.equal(v.overBar, true,
    "a run of 14.4 minutes is recorded as inside a ten-minute bar — the defect this exists for, in the "
    + "numbers the run itself wrote");
  assert.equal(v.barNotMeasured, undefined, "a measured run carries no not-measured reason");
});

test("the bound is the constant, never a number typed here", () => {
  // At the bar exactly, and one tenth over. Read from the module so raising the bar moves both arms rather
  // than leaving them asserting a number the code no longer uses.
  const at = new Date(Date.parse(STARTED) + KNOCKOUT_MINUTES_BAR * 60000).toISOString();
  assert.equal(knockoutBarVerdict({ startedAt: STARTED, deliveredAt: at }).overBar, false,
    "exactly at the bar is over it — the comparison is strictly greater, and a run that lands on the "
    + "number has not exceeded it");
  const over = new Date(Date.parse(STARTED) + (KNOCKOUT_MINUTES_BAR * 60 + 6) * 1000).toISOString();
  assert.equal(knockoutBarVerdict({ startedAt: STARTED, deliveredAt: over }).overBar, true);
});

test("a span that cannot be read is null and says why, never under the bar", () => {
  // THE SHAPE THIS GUARDS. A bar omitted or defaulted because a timestamp was unreadable is an absence a
  // reader meets as "not over", which is the failure the whole record exists to refuse.
  for (const [span, why] of [
    [{ startedAt: null, deliveredAt: DELIVERED }, /startedAt could not be read/],
    [{ startedAt: "not a date", deliveredAt: DELIVERED }, /startedAt could not be read/],
    [{ startedAt: STARTED, deliveredAt: null }, /no delivery time/],
    [{ startedAt: DELIVERED, deliveredAt: STARTED }, /before its start/],
  ]) {
    const v = knockoutBarVerdict(span);
    assert.equal(v.runMinutes, null, `${JSON.stringify(span)}: a span that cannot be measured reported a number`);
    assert.equal(v.overBar, null, `${JSON.stringify(span)}: overBar is false rather than null, which reads as a pass`);
    assert.match(v.barNotMeasured, why, `${JSON.stringify(span)}: the reason does not name what was wrong`);
  }
  // And nothing at all is the same case: called with no span, it must not claim a zero-minute run.
  assert.deepEqual(
    { m: knockoutBarVerdict().runMinutes, o: knockoutBarVerdict().overBar },
    { m: null, o: null });
});

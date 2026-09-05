// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Cap parks: their own ladder, and the provider's clock beats it (tracker issue 103).
//
// Owner, watching indigo-falcon spend 4 of its 6 recovery parks against one subscription cap:
// "surely it can work out when the cap expires and try after that time and not just keep trying and
// then die." The run died on "exhausted retries" when the true state was "blocked until the provider's
// clock ticks" — a temporary condition translated into a terminal one.
//
// WHAT WAS ALREADY BUILT when this was picked up, and is therefore NOT re-asserted here: a cap that
// classifies `rate_limited` already rides the postpone path and waits for its stated reset; the
// adapters already parse a reset hint out of provider prose; the weather lane already separates
// upstream conditions from the run's own defects. The gap was a cap that does NOT classify
// `rate_limited` — it fell to the generic 2/15/60 ladder, which dropped the parsed hint and topped out
// at an hour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capParkSchedule, isCapPark, CAP_BACKOFF_MIN, OUTAGE_RE } from "../repairs.mjs";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

test("the cap ladder outlives a daily cap, which the generic 2/15/60 ladder could not", () => {
  const waits = [0, 1, 2, 3, 4, 5].map((attempts) => capParkSchedule({ attempts, now: NOW }).waitMin);
  assert.deepEqual(waits, [15, 30, 60, 120, 240, 240], "15/30/60/120/240, last rung repeating");
  // The whole point, stated as a number: six probes must cover a working day, not an afternoon.
  const total = waits.reduce((a, b) => a + b, 0);
  assert.ok(total >= 660, `six cap probes must span >=11h, got ${total} minutes`);
  // The ladder it replaces spanned 2+15+60+60+60+60 = 257 minutes. Named so a future edit that
  // shortens the ladder has to argue with the number the owner's complaint was about.
  assert.ok(total > 257, "the cap ladder must be strictly longer than the generic recovery ladder");
});

test("a provider's stated reset beats the ladder — the owner's actual ask", () => {
  const r = capParkSchedule({ resetsAt: "2026-09-06T09:06:00Z", attempts: 0, now: NOW });
  assert.equal(r.basis, "provider", "when the provider names a time, the record must say the time was theirs");
  assert.equal(r.resumesAt, "2026-09-06T09:06:00.000Z");
  assert.ok(r.waitMin > 1200, "and the run waits for it rather than probing at 15 minutes");
});

// Both directions of a bad hint. A stale or malformed reset is exactly how a "wait for the clock"
// feature turns into a hot loop, so neither may schedule a probe in the past or inside the floor.
test("a stale hint falls back to the ladder instead of scheduling a probe in the past", () => {
  const r = capParkSchedule({ resetsAt: "2026-09-04T09:06:00Z", attempts: 1, now: NOW });
  assert.equal(r.basis, "ladder");
  assert.ok(Date.parse(r.resumesAt) > NOW, "never schedule backwards");
  assert.equal(r.waitMin, 30, "and it takes the rung it would have taken anyway");
});

test("an unparseable hint is no hint, not a crash", () => {
  for (const resetsAt of ["not a date", "", "  ", "9:06 AM tomorrow"]) {
    const r = capParkSchedule({ resetsAt, attempts: 0, now: NOW });
    assert.equal(r.basis, "ladder", `garbage hint must degrade to the ladder: ${JSON.stringify(resetsAt)}`);
    assert.ok(Date.parse(r.resumesAt) > NOW);
  }
});

test("a hint inside the floor is not honoured — a cap resetting 'now' must not spin", () => {
  const r = capParkSchedule({ resetsAt: iso(NOW + 5000), attempts: 0, now: NOW, floorMin: 1 });
  assert.equal(r.basis, "ladder", "a reset five seconds out would otherwise probe immediately, and again, and again");
});

// The classification, over the population rather than the one message indigo-falcon happened to carry.
test("cap classification: a quota is a cap, an outage is not", () => {
  for (const reason of [
    "codex usage limit reached — try again later",
    "You have hit your weekly limit",
    "monthly limit exceeded for this plan",
    "out of credit",
    "subscription limit reached",
  ]) assert.equal(isCapPark(reason), true, `must read as a cap: ${reason}`);

  for (const reason of [
    "http 503 service unavailable",
    "overloaded",
    "econnreset",
    "socket hang up",
    "register band artifact malformed",
  ]) assert.equal(isCapPark(reason), false, `must NOT read as a cap: ${reason}`);
});

// The reason the two must not be merged: an overload recovers in minutes and should keep the SHORT
// ladder. Conflating them is what made 60 minutes the ceiling for both.
test("cap and outage are disjoint classifications, not two names for one thing", () => {
  for (const reason of ["http 503 service unavailable", "overloaded", "econnreset"]) {
    assert.ok(OUTAGE_RE.test(reason), `${reason} is an outage`);
    assert.equal(isCapPark(reason), false, `${reason} must not also take the long cap ladder`);
  }
});

test("a resetsAt makes it a cap whatever the prose says — the provider naming a time IS the signal", () => {
  assert.equal(isCapPark("some reason nobody wrote a regex for", "2026-09-06T09:06:00Z"), true);
  assert.equal(isCapPark("some reason nobody wrote a regex for", null), false,
    "and without one, an unrecognised reason stays on the short ladder rather than silently waiting hours");
});

test("CAP_BACKOFF_MIN is exported so the ladder is inspectable, and is strictly increasing", () => {
  assert.ok(Array.isArray(CAP_BACKOFF_MIN) && CAP_BACKOFF_MIN.length >= 5);
  for (let i = 1; i < CAP_BACKOFF_MIN.length; i++) {
    assert.ok(CAP_BACKOFF_MIN[i] > CAP_BACKOFF_MIN[i - 1],
      "a non-increasing rung would silently shorten the ladder for every attempt after it");
  }
});

test("the schedule is PURE — same inputs, same answer, no clock read", () => {
  const a = capParkSchedule({ attempts: 2, now: NOW });
  const b = capParkSchedule({ attempts: 2, now: NOW });
  assert.deepEqual(a, b);
});

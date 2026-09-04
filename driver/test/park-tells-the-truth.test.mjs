// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// park-tells-the-truth.test.mjs —, and the half of that could be established.
//
// ──: IT WAS NOT A CLASSIFIER THAT GUESSED WRONG. IT WAS A CONSTANT. ───────────────────────────
//
// The issue reads the wrong park cause as a regex classifier misfiring over failure text. It is worse
// than that: `runner.mjs` wrote `waitingOn: "provider rate limit (the cap that refused the last
// dispatch)"` as a LITERAL, onto every `res.postponed`. Nothing was classified, so nothing could
// classify correctly.
//
// And `res.postponed` is true for BOTH pipeline parks — `postponeRun` (a provider refused the dispatch)
// and the recovery park (the run backed off from its own failure, carrying `recovery: true`). So a run
// parked on its own defect got a queue marker asserting a provider quota refusal, with the recovery
// backoff clock presented as that provider's reset.
//
// Measured on the R5 park of 2026-08-17: `recoveryLane: "defect"`, `recoveryAttempts: 1`, and
// `recoveryResumesAt` equal to the marker's `resetsAt` TO THE MILLISECOND — one park, recorded as
// something it was not. There is no subscription cap on that account, so the record asserted a refusal
// by a provider with nothing to refuse with. It reached a pre-registration, an e2e finding, a briefing
// and an owner status report before the owner's own knowledge of the account caught it.
//
// The pipeline had already drawn this distinction where it writes its own sentinel — "only the recovery
// sentinel carried a discriminator … the 2026-07-28 postmortem misread: a recovery park diagnosed as a
// rate-limit park". The queue-side marker never got it. Same shape as 's terminal fields reaching
// two writers and not four, and 's stamp reaching the audit path and not the rebuild.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parkCause } from "../runner.mjs";
import { writeRunStatus } from "../progress.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const code = (f) => readFileSync(join(ROOT, f), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("#1176 a RECOVERY park no longer claims a provider refused anything", () => {
  const c = parkCause({ postponed: true, recovery: true, resetsAt: "2026-08-17T15:58:35.018Z" });
  assert.equal(c.parkKind, "recovery");
  assert.ok(!/rate limit|cap/i.test(c.waitingOn),
    `a defect-lane backoff still says ${JSON.stringify(c.waitingOn)} — that sentence asserted a quota `
    + `refusal on an account with no quota, and nothing in the artifacts could contradict it`);
  assert.match(c.waitingOn, /this run's own recovery backoff/);
});

test("#1176 and it says the stored time is OUR clock, not a provider's reset", () => {
  // The marker's field is called `resetsAt` and carries `recoveryResumesAt` on this branch. Renaming the
  // field is a wider change; saying what the value MEANS is what stops the reader being misled by it.
  const c = parkCause({ postponed: true, recovery: true });
  assert.match(c.waitingOn, /NOT a provider reset/,
    "the value in `resetsAt` is this park's own backoff — a reader told it is a provider reset cannot "
    + "tell a wait we chose from a refusal we were given, which is the whole of #1176");
});

test("#1176 a genuine rate-limit park is UNCHANGED — the sentence #443 wrote is still its sentence", () => {
  const c = parkCause({ postponed: true, resetsAt: "2026-08-17T15:58:35.018Z" });
  assert.equal(c.parkKind, "rate-limit");
  assert.equal(c.waitingOn, "provider rate limit (the cap that refused the last dispatch)");
  // `recovery: false` and an absent key are the same park. Only an explicit true is the recovery branch.
  assert.equal(parkCause({ postponed: true, recovery: false }).parkKind, "rate-limit");
  assert.equal(parkCause({}).parkKind, "rate-limit");
});

test("#1176 both parks still say how the wait ENDS — #443's other half, on either branch", () => {
  for (const res of [{ recovery: true }, {}]) {
    const c = parkCause(res);
    assert.match(c.resolvedBy, /a live retry/,
      "a park that says what it waits on and not how it clears is half the record #443 built");
    assert.match(c.resolvedBy, /Nothing needs editing by hand/,
      "the hand-edit warning is load-bearing: a hand-unparked run is how two rounds of one scenario "
      + "end up in the queue");
  }
});

test("#1176 the marker is written FROM the park, not asserted over it", () => {
  // The literal is gone from the call site. A future edit that spells the sentence inline again puts the
  // constant straight back, and the whole defect with it.
  const runner = code("driver/runner.mjs");
  // The CALL, not the declaration — `export function parkPostponed(procPath, qdir, base, data)` comes
  // first in the file and slicing from it would read the wrong 1400 characters and pass on nothing.
  const at = runner.indexOf("parkPostponed(procPath, qdir, base, {");
  assert.ok(at > 0, "the park call site moved or was renamed — this assertion is now measuring nothing");
  const callSite = runner.slice(at, at + 1600);
  assert.match(callSite, /\.\.\.parkCause\(res\)/, "the park marker no longer derives its cause from the result");
  assert.ok(!/waitingOn:\s*"/.test(callSite),
    "a waitingOn STRING LITERAL is back at the park call site — that is the defect, not a style choice");
});

// ── 's half: a lost state write is no longer silent ────────────────────────────────────────────
//
// WHAT THIS DOES AND DOES NOT CLAIM. reports a park whose run dir read `state:"running"` with no
// `.postponed` sentinel, and attributes it to the runner-side path. I could not reproduce that
// attribution: the run's own record (`recoveryLane:"defect"`, `recoveryAttempts:1`, `recoveryResumesAt`
// matching the marker's `resetsAt` exactly) says the RECOVERY park fired, and that path writes both
// surfaces. e2e's contemporaneous handover records the run dir reading `running` while the marker said
// `.postponed`, so both readings are real and they disagree.
//
// What I CAN establish is why that disagreement was unattributable: `writeRunStatus` returned in
// silence whenever it could not resolve a run directory. So "the flip never happened" and "the flip
// happened and was overwritten" produced identical evidence — nothing. This does not fix; it
// makes the next occurrence diagnosable, which is what the issue's own reasoning asks for.
test("#1159 a lost STATE write is reported — 'it never happened' stops looking like 'it was overwritten'", () => {
  const seen = [];
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { seen.push(String(chunk)); return true; };
  try {
    writeRunStatus(null, { state: "recovering", recoveryResumesAt: "2026-08-17T15:58:35.018Z" });
  } finally { process.stderr.write = real; }
  const out = seen.join("");
  assert.match(out, /NO RUN DIRECTORY/, "a state write that evaporated said nothing at all");
  assert.match(out, /"recovering"/, "and it must name the state that was lost, or the line is unactionable");
  assert.match(out, /#1159/);
});

test("#1159 a ROUTINE write is still silent — the existing argument for silence is untouched", () => {
  // progress.mjs's own reasoning: routine writes "are re-written seconds later by the next step", so a
  // line per lost step write would bury the one that matters. That holds; it just never covered a state
  // change, which nothing re-writes.
  const seen = [];
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { seen.push(String(chunk)); return true; };
  try {
    writeRunStatus(null, { stepIndex: 3, stepLabel: "Register sweeps" });
    writeRunStatus(null, {});
  } finally { process.stderr.write = real; }
  assert.equal(seen.join("").match(/NO RUN DIRECTORY/g), null,
    "a lost step write now logs — that is the noise the silence argument exists to prevent");
});

test("#1159 it RECORDS and returns; it never throws", () => {
  // Fail-open is the house rule on this path: a run that cannot record its state must still deliver.
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    assert.doesNotThrow(() => writeRunStatus(null, { state: "failed" }));
    assert.doesNotThrow(() => writeRunStatus(undefined, { state: "postponed" }, null));
    assert.doesNotThrow(() => writeRunStatus({ run: {} }, { state: "delivered" }));
  } finally { process.stderr.write = real; }
});

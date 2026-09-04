// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// park-clock-names-its-kind.test.mjs — 's field-name residual, and the behaviour hiding under it.
//
// Both pipeline parks return their due clock as `res.resetsAt`; the recovery park does so deliberately,
// because that field is "the runner's due-clock contract". The queue-marker writer then stamped it as
// `resetsAt` whatever the park was — so a recovery park, which is OUR backoff after OUR defect, recorded
// a provider cap reset. fixed the `waitingOn` line beside it and `parkCause` predicted this one:
// "the marker's `resetsAt` carries this value, and a reader who is told it is a provider reset cannot
// tell a backoff we chose from a refusal we were given."
//
// ── THE HALF THAT IS NOT COSMETIC ───────────────────────────────────────────────────────────────────
//
// `postponedDueAt` reads both keys and does not treat them alike:
//
//     return key === "resetsAt" ? Math.min(t, probeAt) : t;
//
// Its reason: a recovery park is not an external party's deadline, so there is nothing to re-check and
// nothing that can go stale — it keeps its exact clock; only an externally-supplied reset is probed,
// because only it can be contradicted by the world. Because every recovery clock arrived under
// `resetsAt`, it took the probe branch and was clamped by a schedule built for provider caps. The reader
// was correct and unreachable, which is why the last two assertions here are about WAKE TIME, not names.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parkPostponed, postponedDueAt, parkCause } from "../runner.mjs";

/** Park a job in a throwaway queue and hand back the marker meta the runner wrote. */
const park = (data) => {
  const qdir = mkdtempSync(join(tmpdir(), "park-clock-"));
  mkdirSync(join(qdir, "sidecars"), { recursive: true });
  const procPath = join(qdir, "job-1.processing");
  writeFileSync(procPath, "{}\n");
  parkPostponed(procPath, qdir, "job-1", data);
  return JSON.parse(readFileSync(join(qdir, "job-1.postponed.meta"), "utf8"));
};

const CLOCK = "2026-08-17T15:58:35.018Z";

test("#1159 a RECOVERY park's marker names its own clock, and carries no provider reset", () => {
  const meta = park({ ...parkCause({ recovery: true }), recoveryResumesAt: CLOCK, resetsAt: null });
  assert.equal(meta.recoveryResumesAt, CLOCK, "the recovery clock is not under its own name");
  assert.equal(meta.resetsAt, null,
    "the marker asserts a provider cap reset for a park the provider had no part in — that is the defect");
  // postponedDueAt states "a sentinel never carries both"; null keeps that true without dropping the key.
  assert.equal(meta.parkKind, "recovery");
});

test("#1159 a RATE-LIMIT park is unchanged — it really is a provider reset", () => {
  const meta = park({ ...parkCause({}), resetsAt: CLOCK });
  assert.equal(meta.resetsAt, CLOCK);
  assert.equal(meta.recoveryResumesAt, undefined, "a rate-limit park grew a recovery clock it does not have");
  assert.equal(meta.parkKind, "rate-limit");
});

test("#1159 THE BEHAVIOUR: a recovery park keeps its exact clock and is no longer probed early", () => {
  // A long clock against a short probe schedule. Under `resetsAt` the reader clamps to the probe; under
  // `recoveryResumesAt` it keeps the stated time. This is the assertion that fails if the writer regresses
  // to stamping every park as a reset, and it fails on WAKE TIME rather than on a string.
  const parkedAt = Date.parse("2026-08-17T15:00:00.000Z");
  const wakeAt = Date.parse("2026-08-17T16:00:00.000Z");          // an hour out
  const opts = { probeMs: 60_000, probeCeilingMs: 60_000 };        // probe would fire in one minute
  const base = { postponedAt: new Date(parkedAt).toISOString(), probeAttempt: 0 };

  const recovery = postponedDueAt({ ...base, recoveryResumesAt: new Date(wakeAt).toISOString() }, 0, opts);
  assert.equal(recovery, wakeAt,
    "a recovery park was woken early by the provider-cap probe schedule — its wait is ours and has nothing "
    + "to re-check, which is exactly what postponedDueAt's own comment says");

  const rateLimit = postponedDueAt({ ...base, resetsAt: new Date(wakeAt).toISOString() }, 0, opts);
  assert.equal(rateLimit, parkedAt + 60_000,
    "an externally-supplied reset stopped being probed — it CAN be contradicted by the world, so the "
    + "clamp is correct there and must stay");
  assert.ok(rateLimit < recovery, "the two clocks are being treated identically again");
});

test("#1159 the end-to-end shape: what the writer stamps is what the reader honours", () => {
  // The two halves are in different functions and nothing compared them, which is how the writer could
  // stamp a name the reader treats specially without anyone noticing.
  const meta = park({ ...parkCause({ recovery: true }), recoveryResumesAt: CLOCK, resetsAt: null });
  const due = postponedDueAt(meta, 0, { probeMs: 1, probeCeilingMs: 1 });
  assert.equal(due, Date.parse(CLOCK),
    "the marker the writer produced does not resolve to the clock it was given — a probe of 1ms means any "
    + "clamped reading returns almost immediately, so this is the clamp, caught end to end");
});

test("#1159 the WRITE SITE branches on the park kind — pinned, because behaviour cannot reach it here", () => {
  // The three tests above drive `parkPostponed` with data they construct, so they prove the marker
  // format and the reader agree. They do NOT prove that `runPrepared` hands over the right shape, and
  // that is the line the defect actually lived on: reaching it needs a full pipeline dispatch.
  //
  // So the site is pinned with its reason. Without this, every assertion above passes while the writer
  // goes on stamping every park as a provider reset — a suite that is green about the wrong function.
  const src = readFileSync(new URL("../runner.mjs", import.meta.url), "utf8");
  const at = src.indexOf("parkPostponed(procPath, qdir, base, {");
  assert.ok(at > 0, "the park call moved — this assertion is measuring nothing");
  const call = src.slice(at, at + 2600);
  assert.match(call, /\.\.\.\(res\.recovery === true/,
    "the park writer no longer branches on the park kind — every park is being stamped with one clock name again");
  assert.match(call, /recoveryResumesAt: res\.resetsAt \?\? null, resetsAt: null/,
    "the recovery arm no longer writes its own clock, or no longer nulls the provider one "
    + "(postponedDueAt: \"a sentinel never carries both\")");
  assert.ok(!/^\s*resetsAt: res\.resetsAt \?\? null, codename:/m.test(call),
    "the unconditional `resetsAt: res.resetsAt` write is back — that is the defect verbatim");
});

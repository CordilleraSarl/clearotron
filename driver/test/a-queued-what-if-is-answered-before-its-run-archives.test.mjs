// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 240 — a queued what-if whose run archives was never claimed, never settled and never
// refused. It left no row anywhere, so a client who asked for an experiment got no answer and no
// explanation. This drives the REAL queue: real enqueue, real files on disk, real settle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { settlePendingWhatIfsBeforeArchive } from "../pipeline.mjs";
import { enqueueWhatIf, pendingWhatIf, readWhatIf, listWhatIf } from "../whatif-queue.mjs";

const newRun = () => {
  const d = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "archive-settle-"));
  mkdirSync(join(d, "_experiments", "_queue"), { recursive: true });
  return d;
};

test("a queued stage what-if is REFUSED with the standing sentence before its run archives", () => {
  const runDir = newRun();
  const { id } = enqueueWhatIf(runDir, { op: { runId: "r-1", stage: "synthesis", kind: "stage" } });
  assert.equal(pendingWhatIf(runDir).length, 1, "the job must be queued before the run archives");

  settlePendingWhatIfsBeforeArchive({ runDir, state: "delivered" });

  const after = readWhatIf(runDir, id);
  assert.equal(after.state, "failed", "an unanswerable job must end, not vanish");
  assert.match(after.error, /delivered or archived/, "the client gets the standing sentence");
  assert.equal(pendingWhatIf(runDir).length, 0, "nothing may still read as pending");
  // The op travels into the terminal record, or the row cannot say what was asked.
  assert.equal(after.op?.stage, "synthesis");
});

test("a queued MEMO is not told the archive refuses it — that sentence is false for a memo", () => {
  // The standing refusal reads "what-if runs on live runs only". True of a stage. FALSE of a memo,
  // which reasons over archived evidence by design. Telling a client their memo was refused because
  // the run is archived would be a false sentence in the one place they look to find out what happened.
  const runDir = newRun();
  const { id } = enqueueWhatIf(runDir, { op: { runId: "r-2", kind: "memo", instructions: "treat it as abandoned" } });

  settlePendingWhatIfsBeforeArchive({ runDir, state: "delivered" });

  const after = readWhatIf(runDir, id);
  assert.equal(after.state, "failed", "it still must not go silent");
  assert.doesNotMatch(after.error, /what-if runs on live runs only/,
    "a memo must not be given the stage refusal — it is untrue of a memo");
  assert.match(after.error, /queued before its run was archived/, "it is closed on the true reason");
  assert.match(after.error, /ask it again/, "and it says what to do next");
});

test("both kinds are settled in one pass, and an empty queue is not an error", () => {
  const runDir = newRun();
  enqueueWhatIf(runDir, { op: { runId: "r-3", stage: "digest", kind: "stage" } });
  enqueueWhatIf(runDir, { op: { runId: "r-3", kind: "memo", instructions: "q" } });

  settlePendingWhatIfsBeforeArchive({ runDir, state: "delivered" });
  assert.equal(pendingWhatIf(runDir).length, 0, "neither kind may be left pending");
  assert.equal(listWhatIf(runDir).filter((j) => j.state === "failed").length, 2);

  // A run with no queue at all is the common case and must not throw — the archive must never be
  // stopped by this. A run dir with no `_experiments/` directory is the same case.
  const bare = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "archive-settle-bare-"));
  assert.doesNotThrow(() => settlePendingWhatIfsBeforeArchive({ runDir: bare, state: "delivered" }));
});

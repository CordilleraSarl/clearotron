// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// whatif-queue.test.mjs — the run-local what-if queue and the worker that drains it.
//
// The MCP acceptance (mcp-server/test/account-whatif-queued.test.mjs) drives the whole chain over the
// wire and proves the client-facing contract. This file covers what that one cannot see from outside:
// the claim is genuinely exclusive, an id is not a path, a stale claim is recoverable, and one failing
// experiment does not stop the drain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueueWhatIf, claimWhatIf, finishWhatIf, pendingWhatIf, readWhatIf, listWhatIf, whatIfQueueDir, isWhatIfId, STALE_CLAIM_MS, whatIfRefusal, WHATIF_REFUSED_MARKERS } from "../whatif-queue.mjs";
import { drainWhatIfQueues, liveRunDirs } from "../whatif-worker.mjs";

function studio() {
  const root = mkdtempSync(join(tmpdir(), "whatif-q-"));
  const s = join(root, "workspace-x", "studio", "prelim-search");
  const runDir = join(s, "tmp1-acme", "2026-09-02-copper-anvil");
  mkdirSync(runDir, { recursive: true });
  return { studioRoot: s, runDir };
}
const op = (runId = "r1") => ({ runId, stage: "report-overview", axis: null, instructions: "treat ACME as expired", model: null });

// ── THE DOOR AND THE WORKER MUST ANSWER THE SAME QUESTION (, found by driving it) ──
//
// There were three copies of "may a what-if touch this run". `whatIfPlan` and `whatIfEnqueue` refused
// archived-or-delivered; the worker refused any of `.delivered`, `.failed`, `.cancelled`, `.cancel`. So
// a FAILED run was told it was runnable, accepted at the door, and refused by the worker minutes later —
// the door promising what the worker refuses, inside the feature built to be careful about exactly that.
//
// It survived every unit test: the MCP tests inject the runner and never reach the worker's check, and
// the worker's own test wrote `.delivered`, the one marker all three copies agreed about. It took a real
// run, on a real box, carrying a real `.failed`.
//
// This arm is the shape of the fix rather than a case list: for every state a run can be in, the answer
// the MCP door computes and the answer the worker computes must be the SAME answer.
test("1953: the door and the worker agree about every run state, marker for state", () => {
  const cases = [
    { what: "delivered", door: { state: "delivered" }, disk: [".delivered"], eligible: false },
    { what: "archived", door: { location: "archive" }, disk: [".delivered"], eligible: false },
    { what: "cancelled", door: { state: "cancelled" }, disk: [".cancelled"], eligible: false },
    { what: "stop requested", door: { state: "cancelled" }, disk: [".cancel"], eligible: false },
    // THE ONE THAT DISAGREED. A failed run is undelivered, its artifacts are on disk, and re-running one
    // stage under changed guidance is how somebody investigates the failure.
    { what: "failed", door: { state: "failed" }, disk: [".failed"], eligible: true },
    { what: "running", door: { state: "running" }, disk: [], eligible: true },
  ];
  for (const c of cases) {
    const atDoor = whatIfRefusal(c.door);
    const atWorker = whatIfRefusal({ markers: WHATIF_REFUSED_MARKERS.filter((m) => c.disk.includes(m)) });
    assert.equal(atDoor === null, c.eligible, `${c.what}: the DOOR disagrees with the ruling`);
    assert.equal(atWorker === null, c.eligible, `${c.what}: the WORKER disagrees with the ruling`);
    assert.equal(atDoor, atWorker, `${c.what}: the door and the worker give different answers — a client would be told one thing and served another`);
  }
  // And `.failed` is not in the worker's refused set at all, which is the concrete thing that broke.
  assert.ok(!WHATIF_REFUSED_MARKERS.includes(".failed"), "a failed run is refused again — the door still says it is runnable");
});

test("a queued job reads as queued, and carries the op it was given", () => {
  const { runDir } = studio();
  const job = enqueueWhatIf(runDir, { op: op(), requestedBy: "lawyer@acme.example", account: "acme" });
  assert.ok(isWhatIfId(job.id));
  const r = readWhatIf(runDir, job.id);
  assert.equal(r.state, "queued");
  assert.equal(r.op.instructions, "treat ACME as expired");
  assert.equal(r.requestedBy, "lawyer@acme.example", "the requester is not recorded — a queued spend with no attribution");
});

test("THE CLAIM IS EXCLUSIVE — a second worker on the same job gets nothing", () => {
  const { runDir } = studio();
  const job = enqueueWhatIf(runDir, { op: op() });
  const [entry] = pendingWhatIf(runDir);
  const first = claimWhatIf(entry);
  assert.ok(first, "the first claim failed");
  // The SAME entry, as a racing worker would still be holding it: the rename cannot succeed twice.
  assert.equal(claimWhatIf(entry), null, "two workers both claimed one experiment — it would run (and spend) twice");
  assert.equal(readWhatIf(runDir, job.id).state, "running");
});

test("a claim nobody finished is recoverable, and only after the stale window", () => {
  const { runDir } = studio();
  const job = enqueueWhatIf(runDir, { op: op() });
  claimWhatIf(pendingWhatIf(runDir)[0]);
  assert.deepEqual(pendingWhatIf(runDir), [], "a fresh claim was offered up for re-claim");
  // The clearance queue asks whether the claimer is ALIVE; this asks only whether the claim is OLD,
  // because re-running one stage costs a stage. Drive the clock rather than the file's mtime where we
  // can — pendingWhatIf takes `now` for exactly this.
  const later = Date.now() + STALE_CLAIM_MS + 1000;
  const stale = pendingWhatIf(runDir, { now: later });
  assert.equal(stale.length, 1, "an abandoned claim was never offered again");
  assert.equal(stale[0].id, job.id);
  assert.equal(stale[0].stale, true);
});

test("an id is not a path — a traversal resolves to nothing", () => {
  const { runDir } = studio();
  for (const id of ["../../../etc/passwd", "wi-../../x", "", null, "wi-XXXXXXXX", "report"])
    assert.equal(readWhatIf(runDir, id).state, "unknown", `"${id}" resolved to something`);
});

test("the worker settles a job and the run's canonical files are not written", async () => {
  const { studioRoot, runDir } = studio();
  writeFileSync(join(runDir, "report.md"), "canonical");
  const job = enqueueWhatIf(runDir, { op: op() });
  const seen = [];
  const settled = await drainWhatIfQueues([studioRoot], { runWhatIf: async ({ confirmationToken }) => {
    seen.push(JSON.parse(Buffer.from(confirmationToken, "base64url").toString("utf8")));
    return { ok: true, diff: "-a\n+b\n" };
  } });
  assert.equal(settled.length, 1);
  assert.equal(seen[0].stage, "report-overview", "the worker did not re-mint the stored op into a token");
  assert.equal(readWhatIf(runDir, job.id).state, "done");
  // Everything the queue writes lives under _experiments/; the run dir's own files are untouched.
  assert.deepEqual(readdirSync(runDir).filter((f) => f !== "_experiments").sort(), ["report.md"]);
});

test("ONE FAILING EXPERIMENT DOES NOT STOP THE DRAIN", async () => {
  const { studioRoot, runDir } = studio();
  enqueueWhatIf(runDir, { op: op() });
  enqueueWhatIf(runDir, { op: { ...op(), stage: "synthesis" } });
  let n = 0;
  const settled = await drainWhatIfQueues([studioRoot], { max: 1, runWhatIf: async () => {
    if (n++ === 0) throw new Error("the engine fell over");
    return { ok: true, diff: "x" };
  } });
  assert.equal(settled.length, 2, "the drain stopped at the first failure");
  const states = Object.fromEntries(listWhatIf(runDir).map((e) => [e.id, e.state]));
  assert.deepEqual(new Set(Object.values(states)), new Set(["failed", "done"]));
  const failed = listWhatIf(runDir).find((e) => e.state === "failed");
  assert.match(failed.error, /the engine fell over/, "the failure was recorded without saying what happened");
});

test("a FINISHED record still says what it was asked to do", async () => {
  // The op lived only on the manifest, which finishWhatIf consumes — so a done/failed record could not
  // say what it had been. A record of a decision that does not carry the decision is the absence the
  // audit trail exists to prevent, and it is what the read tool's listing is built on.
  const { studioRoot, runDir } = studio();
  const job = enqueueWhatIf(runDir, { op: op() });
  await drainWhatIfQueues([studioRoot], { runWhatIf: async () => ({ ok: true, diff: "x" }) });
  const r = readWhatIf(runDir, job.id);
  assert.equal(r.state, "done");
  assert.equal(r.op?.stage, "report-overview", "the finished record lost the stage it ran");
  assert.equal(r.op?.instructions, "treat ACME as expired", "the finished record lost the instruction");
});

// THE WIRING, not just the predicate. The agreement arm above proves the shared composer answers the
// same for both input shapes; this proves the WORKER actually asks it. Planting the old marker list back
// into `refusalFor` must red something, and until this existed it did not: the agreement arm calls the
// composer directly and never reaches the worker's own filtering.
test("1953: a FAILED run is DRAINED by the worker — the case the three copies disagreed about", async () => {
  const { studioRoot, runDir } = studio();
  writeFileSync(join(runDir, ".failed"), "");
  const job = enqueueWhatIf(runDir, { op: op() });
  const settled = await drainWhatIfQueues([studioRoot], { runWhatIf: async () => ({ ok: true, diff: "x" }) });
  assert.equal(settled.length, 1, "the worker skipped a failed run entirely");
  assert.equal(readWhatIf(runDir, job.id).state, "done",
    "the worker refused a what-if on a FAILED run while the door calls that run runnable — the defect the drive found");
});

test("an experiment reporting ok:false is recorded FAILED, not done", async () => {
  const { studioRoot, runDir } = studio();
  const job = enqueueWhatIf(runDir, { op: op() });
  await drainWhatIfQueues([studioRoot], { runWhatIf: async () => ({ ok: false, fail: "stage validator refused the output" }) });
  const r = readWhatIf(runDir, job.id);
  assert.equal(r.state, "failed", "a refused experiment read as a successful one");
  assert.match(r.error, /validator refused/);
});

test("liveRunDirs walks runs and skips the queue and the archive", () => {
  const { studioRoot, runDir } = studio();
  mkdirSync(join(studioRoot, "queue"), { recursive: true });
  mkdirSync(join(studioRoot, "archive", "2026-05", "old", "run"), { recursive: true });
  const dirs = liveRunDirs([studioRoot]);
  assert.ok(dirs.includes(runDir));
  assert.ok(!dirs.some((d) => d.includes("/archive/")), "the archive was scanned — every job there would only mint refusals");
  assert.ok(!dirs.some((d) => d.endsWith("/queue")), "the clearance queue dir was walked as if it held runs");
});

test("the queue lives under _experiments and nowhere near the clearance queue", () => {
  const { runDir } = studio();
  assert.ok(whatIfQueueDir(runDir).startsWith(join(runDir, "_experiments")),
    "the what-if queue moved out of the run dir — the account gate keys on the run, and this is why it can");
  enqueueWhatIf(runDir, { op: op() });
  assert.ok(existsSync(whatIfQueueDir(runDir)), "enqueue did not create the queue where the read looks for it");
});

test("finishWhatIf is terminal — the job is not offered again", () => {
  const { runDir } = studio();
  const job = enqueueWhatIf(runDir, { op: op() });
  claimWhatIf(pendingWhatIf(runDir)[0]);
  finishWhatIf(runDir, job.id, { ok: true, result: { ok: true, diff: "x" } });
  assert.deepEqual(pendingWhatIf(runDir, { now: Date.now() + STALE_CLAIM_MS * 2 }), [],
    "a finished job came back as a stale claim — it would run and spend a second time");
});

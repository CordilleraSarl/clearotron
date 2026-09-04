// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// disease 2, on the one path in the tree that DESTROYS BYTES.
//
// scripts/e2e.mjs teardown rewrote any run whose status.json said `running` to `failed`, logging "no
// process was producing this run" and writing that sentence into the reason field. Nothing checked it.
// scripts/purge-runs.mjs then protected live runs with exactly one rule — `state === "running"` — the
// field teardown had just overwritten. A live round, torn down, became a delete candidate, and that
// script's own header says removing a run mid-flight "loses work no retry can recover."
//
// The tests that matter most here are the ones asserting what must NOT happen. A false DELETE deletes a
// live client matter; a false KEEP costs a re-run of a purge.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimLivenessForCodename, claimForbidsDestruction, codenameCandidates, CLAIM_LIVENESS,
  parseClaimSidecar, claimerIsAlive,
} from "../claim-liveness.mjs";

// A queue on disk is not needed: every read is injectable, which is how all four states get driven.
const QUEUE = "/queue/a";
const CODENAME = "quiet-harbour";
const RUNDIR = `2026-08-16-${CODENAME}`;

const fixture = ({ meta = `job-7.processing.meta`, codename = CODENAME, pid = "4242:99887", files = null } = {}) => ({
  queueDirs: [QUEUE],
  readDir: (q) => { if (q !== QUEUE) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }; return files ?? [meta, "job-7.processing", "unrelated.json"]; },
  readFile: (p) => {
    if (p.endsWith(".meta")) return JSON.stringify({ codename, dateISO: "2026-08-16", agentId: "a" });
    if (p.endsWith(".pid")) { if (pid == null) throw new Error("ENOENT"); return pid; }
    throw new Error("ENOENT");
  },
});

// ── THE FOUR STATES, EACH DRIVEN ────────────────────────────────────────────────────────────────────

test("ALIVE: a claim owns the codename and its pid answers", () => {
  const r = claimLivenessForCodename(RUNDIR, { ...fixture(), isAlive: () => true });
  assert.equal(r.state, "alive");
  assert.match(r.why, /pid 4242/, "the reason names the evidence read, not the conclusion drawn");
});

test("GONE: a claim owns it and the claimer is provably gone — the only state that permits destruction", () => {
  const r = claimLivenessForCodename(RUNDIR, { ...fixture(), isAlive: () => false });
  assert.equal(r.state, "gone");
  assert.equal(claimForbidsDestruction(r.state), false);
});

test("UNCLAIMED: every queue dir read cleanly and none holds a claim", () => {
  const r = claimLivenessForCodename(RUNDIR, { ...fixture({ codename: "someone-else" }), isAlive: () => true });
  assert.equal(r.state, "unclaimed");
});

test("UNCLAIMED IS NOT DEAD — a hand-started pipeline holds no queue claim", () => {
  // Collapsing these would re-make the bug in the opposite direction: the queue's silence about a run it
  // never launched is not evidence that nothing is producing it. It leaves the caller's other rules in
  // charge rather than asserting death.
  const r = claimLivenessForCodename(RUNDIR, { ...fixture({ codename: "someone-else" }), isAlive: () => true });
  assert.notEqual(r.state, "gone");
  assert.ok(CLAIM_LIVENESS.includes(r.state));
});

test("UNREADABLE: a queue directory that cannot be read is not an empty queue", () => {
  // The zero-means-pass shape, sitting directly on a delete path: an unreadable queue full of live claims
  // would otherwise answer "nothing owns this run".
  const r = claimLivenessForCodename(RUNDIR, {
    queueDirs: [QUEUE], isAlive: () => true,
    readDir: () => { throw new Error("EACCES"); }, readFile: () => "",
  });
  assert.equal(r.state, "unreadable");
  assert.equal(claimForbidsDestruction(r.state), true, "unreadable must keep the run, never delete it");
});

test("no queue directories at all is UNCLAIMED, and this was written the other way first", () => {
  // Returning `unreadable` here is the instinct — an empty list is not evidence — and it broke the delete
  // tool outright: purge-runs' suite pins a workspace root with no queues, so every run read "cannot
  // tell" and the estate was kept entire. A purge that spares everything whenever no queue exists is not
  // cautious, it is broken.
  //
  // `unclaimed` is right because this check is ADDITIVE: it may turn a DELETE into a KEEP and never the
  // reverse, so where it cannot see it DEFERS to the guards that were already there instead of seizing
  // the decision. Nothing was removed — `state === "running"` still protects everything it protected.
  const r = claimLivenessForCodename(RUNDIR, { queueDirs: [] });
  assert.equal(r.state, "unclaimed");
  assert.equal(claimForbidsDestruction(r.state), false, "it must not seize the verdict for every run on the host");
});

test("but a queue directory that EXISTS and cannot be listed is still UNREADABLE", () => {
  // This is the narrow, genuinely dangerous case the line above must not swallow: something is there and
  // we were refused a look at it. That keeps the run.
  const r = claimLivenessForCodename(RUNDIR, {
    queueDirs: [QUEUE], readDir: () => { const e = new Error("EACCES"); e.code = "EACCES"; throw e; }, readFile: () => "",
  });
  assert.equal(r.state, "unreadable");
  assert.equal(claimForbidsDestruction(r.state), true);
});

test("A QUEUE DIRECTORY THAT DOES NOT EXIST HOLDS NO CLAIMS — ENOENT is an answer, not a refusal", () => {
  // This one cost the delete tool its entire function and it is the most easily re-broken line here.
  // `config.queueDirs` synthesises a queue path for the default agent whether or not that workspace
  // exists. Counting the resulting ENOENT as "could not look" made every run on such a host read
  // `unreadable`, and purge kept everything — verified against the real getter, not reasoned about.
  const enoent = () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; };
  const r = claimLivenessForCodename(RUNDIR, { queueDirs: [QUEUE], readDir: enoent, readFile: () => "" });
  assert.equal(r.state, "unclaimed", "a directory that is not there is a COMPLETE answer");
  assert.equal(claimForbidsDestruction(r.state), false);
});

test("…and one absent queue does not blind the tool to a live claim in a queue that IS there", () => {
  // The mixed case: skipping the absent directory must not skip the loop.
  const f = fixture();
  const enoentFirst = (q) => { if (q === "/queue/gone") { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } return f.readDir(q); };
  const r = claimLivenessForCodename(RUNDIR, { ...f, queueDirs: ["/queue/gone", QUEUE], readDir: enoentFirst, isAlive: () => true });
  assert.equal(r.state, "alive");
});

test("UNREADABLE: a claim exists but carries no readable .pid, so its process cannot be identified", () => {
  const r = claimLivenessForCodename(RUNDIR, { ...fixture({ pid: null }), isAlive: () => true });
  assert.equal(r.state, "unreadable");
  assert.equal(claimForbidsDestruction(r.state), true);
});

// ── THE MATCH, WHERE AN UNDER-MATCH WOULD DELETE A LIVE MATTER ──────────────────────────────────────

test("a run directory's date prefix does not hide its claim", () => {
  // Claims store the BARE codename; run directories are `<date>-<codename>`. Comparing them directly finds
  // nothing, and finding nothing here means DELETE.
  assert.deepEqual(codenameCandidates("2026-08-16-quiet-harbour"), ["2026-08-16-quiet-harbour", "quiet-harbour"]);
  const r = claimLivenessForCodename(RUNDIR, { ...fixture(), isAlive: () => true });
  assert.equal(r.state, "alive", "the dated directory name still resolves to its claim");
});

test("a bare codename with no date prefix still matches", () => {
  assert.deepEqual(codenameCandidates(CODENAME), [CODENAME]);
  assert.equal(claimLivenessForCodename(CODENAME, { ...fixture(), isAlive: () => true }).state, "alive");
});

test("a postponed claim counts — a parked run is not a dead one", () => {
  const r = claimLivenessForCodename(RUNDIR, { ...fixture({ meta: "job-7.postponed.meta" }), isAlive: () => true });
  assert.equal(r.state, "alive");
});

// ── POLARITY, REUSED RATHER THAN RESTATED ───────────────────────────────────────────────────────────

test("the shipped polarity is intact: unprovable liveness reads as ALIVE", () => {
  // EPERM means the pid exists under another uid. An unreadable starttime on a live pid is still live.
  // Both of these getting inverted is how a running matter gets deleted.
  const eperm = () => { const e = new Error("EPERM"); e.code = "EPERM"; throw e; };
  assert.equal(claimerIsAlive({ pid: 1, starttime: "5" }, { kill: eperm, starttimeOf: () => "5" }), true);
  assert.equal(claimerIsAlive({ pid: 1, starttime: "5" }, { kill: () => {}, starttimeOf: () => null }), true);
  assert.equal(claimerIsAlive({ pid: 1, starttime: "5" }, { kill: () => {}, starttimeOf: () => "9" }), false,
    "a recycled pid is the one case that IS positive evidence of death");
});

test("claimForbidsDestruction keeps on alive and unreadable, and only those", () => {
  assert.deepEqual(CLAIM_LIVENESS.filter(claimForbidsDestruction), ["alive", "unreadable"]);
});

// ── VOID CONTROLS ───────────────────────────────────────────────────────────────────────────────────

test("VOID CONTROL: the fixture really does contain a matching claim", () => {
  // Every "alive" assertion above would pass identically against a queue holding nothing at all, because
  // an absent claim and a present one differ only in the state returned. If the fixture ever stopped
  // carrying a claim for this codename, those tests would be measuring the empty case and reading green.
  const f = fixture();
  const metas = f.readDir(QUEUE).filter((n) => n.endsWith(".meta"));
  assert.ok(metas.length, "the fixture queue lists no claim metadata — the ALIVE tests measure nothing");
  assert.equal(JSON.parse(f.readFile(`${QUEUE}/${metas[0]}`)).codename, CODENAME);
  assert.ok(parseClaimSidecar(f.readFile(`${QUEUE}/job-7.processing.pid`))?.pid, "the fixture's .pid must parse");
});

test("VOID CONTROL: the four states are all reachable, so no branch is dead", () => {
  const seen = new Set([
    claimLivenessForCodename(RUNDIR, { ...fixture(), isAlive: () => true }).state,
    claimLivenessForCodename(RUNDIR, { ...fixture(), isAlive: () => false }).state,
    claimLivenessForCodename(RUNDIR, { ...fixture({ codename: "other" }), isAlive: () => true }).state,
    claimLivenessForCodename(RUNDIR, { queueDirs: [QUEUE], readDir: () => { throw new Error("EACCES"); }, readFile: () => "" }).state,
  ]);
  assert.deepEqual([...seen].sort(), ["alive", "gone", "unclaimed", "unreadable"]);
});

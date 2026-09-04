// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE UNWATCHED-QUEUE WARNING REACHES A SURFACE SOMEBODY READS.
//
// THE DEFECT WAS NOT IN THE COMPARISON. `compareWatches` was pure, tested, and correct the whole time.
// It was referenced by no systemd unit, no deploy script, and nothing in this repo but an npm script
// and its own tests — a manual diagnostic somebody has to remember to run. That is why it "surfaced
// nothing in any journal since Aug 13" while a client's job sat in a queue nobody watched: nothing was
// broken, and nothing ran. A guard that must be remembered is not a guard, and the third answer to
// "where does enforcement live" is NOWHERE.
//
// So this file tests two different things, and the second is the one that was actually wrong:
//   1. the verdict's own branches, including the two a live probe on a healthy box never produces;
//   2. that the check is WIRED — that live-surface-check.mjs, which the deploy runs and logs, calls it.
//
// SCOPE, STATED SO A CHECKBOX IS NOT CLOSED OVER THE INCIDENT'S OWN PATH: this fires once per deploy
// tick. It does NOT catch an enqueue into an unwatched queue BETWEEN ticks, which is exactly what
// happened — a job acknowledged to the requester at 07:24Z while the drain ran twice. The enqueue-side
// check is and is not this.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { queueWatchVerdict } from "../queue-watch-verdict.mjs";
import { watchedQueueDirs } from "../../scripts/drain-preflight.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// DERIVED, not a literal: forbids naming a specific account's home in executable code — wrong
// under every other service account and in every public clone — and it caught this file when the path
// was written out. The derived form is also what the check itself computes, so the fixture is the real
// shape rather than one that resembles it.
const HOME = homedir();
const UNIT = join(HOME, ".config", "systemd", "user", "prelim-driver.path");
const v = (o) => queueWatchVerdict({ unitPath: UNIT, ...o });

// ── the incident ─────────────────────────────────────────────────────────────────────────────────────

test("#1216 a queue directory nothing watches FAILS, and the message names it", () => {
  const r = v({ queueDirs: ["/srv/ws/queue", "/srv/other/queue"], watched: ["/srv/other/queue"] });
  assert.equal(r.state, "fail");
  assert.match(r.message, /\/srv\/ws\/queue/, "the operator cannot act on a count alone");
  // — this used to require the words "acknowledged and never drained" on a call that supplies NO
  // timer state. The assertion was defending an invented consequence: with the drain half unprobed, the
  // supportable finding is that nothing drains the directory ON ARRIVAL, and the strong claim is not
  // available. Keeping the old assertion would have made re-adding the false sentence the cheapest way
  // back to green.
  assert.match(r.message, /ON ARRIVAL/, "the consequence it can support is the arrival trigger");
  assert.match(r.message, /NOT PROBED/, "the half it did not look at has to say so");
  assert.doesNotMatch(r.message, /acknowledged and never drained/,
    "the black-hole sentence is back on a call with no evidence for it");
});

test("#1216 every queue watched is a pass, and says what it consulted", () => {
  const r = v({ queueDirs: ["/srv/a/queue"], watched: ["/srv/a/queue", "/srv/b/queue"] });
  assert.equal(r.state, "pass");
  assert.match(r.message, /prelim-driver\.path/, "a pass that does not say what it read is unauditable");
});

test("#1216 a trailing slash is not a disagreement", () => {
  assert.equal(v({ queueDirs: ["/srv/a/queue/"], watched: ["/srv/a/queue"] }).state, "pass");
  assert.equal(v({ queueDirs: ["/srv/a/queue"], watched: ["/srv/a/queue/"] }).state, "pass");
});

// ── the branches a healthy box never produces ────────────────────────────────────────────────────────

test("#1216 resolving NO queue at all is a failure, not a clean sweep", () => {
  // An empty set compares nothing and would pass with flying colours — the shape of a guard that has
  // stopped existing.
  const r = v({ queueDirs: [], watched: ["/srv/a/queue"] });
  assert.equal(r.state, "fail");
  assert.match(r.message, /NO queue directory at all/);
});

test("#1216 an unreadable unit is SKIP — never a pass", () => {
  // On prod these units belong to another account. A privilege-limited read answering "fine" is the
  // exact failure this family of checks exists to refuse, and it is the one that would make this guard
  // decoration on the box that matters most.
  const r = v({ queueDirs: ["/srv/a/queue"], watched: null, unitError: "EACCES" });
  assert.equal(r.state, "skip");
  assert.match(r.message, /EACCES/);
  assert.match(r.message, /prelim-driver\.path/);
});

test("#1216 an unresolvable config is SKIP, and says why", () => {
  const r = v({ queueDirs: null, watched: [], resolveError: "CLEAROTRON_REPORTS_DIR has no default" });
  assert.equal(r.state, "skip");
  assert.match(r.message, /no default/);
});

test("#1216 a unit that watches a path which does not exist yet does NOT fail", () => {
  // Normal on a fresh box: the queue is created on first enqueue. A check that reds on every fresh box
  // is a check somebody deletes, and then nothing is watching the watchers either.
  const r = v({ queueDirs: ["/srv/a/queue"], watched: ["/srv/a/queue", "/srv/never/created"] });
  assert.equal(r.state, "pass", "an extra watch was treated as a disagreement");
});

// ── the half that was actually broken: is it wired to anything that RUNS? ────────────────────────────

test("#1216 the check is WIRED into the surface the deploy runs and logs", () => {
  // This is the assertion that would have caught the original defect. compareWatches was correct and
  // called by nothing; every unit test it had passed. Only "what invokes it" was empty.
  const src = readFileSync(join(ROOT, "scripts", "live-surface-check.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  // — the surface now asks through `probeQueueWatch`, the seam the ENQUEUE DOORS use as well, so
  // one unit path answers at both ends of a job's life. ONE hop of indirection is allowed and the hop
  // itself is asserted to reach the verdict: without that second line, "wired" could mean wired to
  // something that decides nothing, which is the exact defect this test exists for.
  assert.match(src, /probeQueueWatch\(|queueWatchVerdict\(/,
    "the health surface no longer asks the queue-watch question");
  assert.match(readFileSync(join(ROOT, "driver", "queue-watch-probe.mjs"), "utf8"), /queueWatchVerdict\(/,
    "the probe the surface calls no longer reaches the verdict — the question is asked and never decided");
  assert.match(src, /record\("every queue this deployment would drain is watched"/,
    "the verdict is computed and not recorded — a result nothing reports is a result nobody reads");
  assert.match(src, /config\.queueDirs/,
    "the check stopped reading the RESOLVED queue dirs; reading the variable misses the absent case");
});

test("#1216 VOID CONTROL — drain-preflight's reader still parses a real unit", () => {
  // The verdict is only as good as what it is handed. If watchedQueueDirs stops finding globs, every
  // deployment resolves "watched: []" and this guard turns into an alarm nobody can silence — the
  // false-refusal direction that gets guards removed.
  const unit = readFileSync(join(ROOT, "driver", "systemd", "prelim-driver.path"), "utf8");
  const watched = watchedQueueDirs(unit, HOME);
  assert.ok(watched.length > 0, "the shipped .path unit parsed to zero watched directories");
  for (const w of watched) assert.doesNotMatch(w, /\*/, "a glob survived into a directory comparison");
});

// ──: THE CONSEQUENCE, WHICH THIS ARM USED TO INVENT ────────────────────────────────────────────
//
// The finding was always right — nothing watches the directory. The sentence attached to it asserted a
// black hole, and it was READ AS WRITTEN: a lane diagnosing a 14-commit lag took it plus an hourly
// "SKIP — N job(s) queued" as a deadlock and went hunting a fault that was not there. Jobs in the named
// directory were draining the whole time. These four arms pin the three answers apart, because an
// operator does something different for each one.

const withTimer = (timer, o = {}) =>
  v({ queueDirs: ["/srv/ws/queue"], watched: ["/srv/other/queue"], timer, ...o });

test("#1368 an unwatched queue with an ENABLED timer is latency, not loss — and never says 'never drained'", () => {
  const r = withTimer({ unit: "prelim-driver.timer", present: true, enabled: true, error: null });
  assert.equal(r.state, "warn", "a directory that demonstrably drains must not red an hourly deploy gate");
  assert.match(r.message, /LATENCY and not loss/);
  assert.match(r.message, /prelim-driver\.timer/, "the operator has to know what the job is waiting for");
  assert.doesNotMatch(r.message, /never drained/,
    "the exact sentence #1368 was filed about, on the exact box state that disproved it");
});

test("#1368 an unwatched queue with NO timer keeps the strong claim — now evidenced", () => {
  const r = withTimer({ unit: "prelim-driver.timer", present: false, enabled: false, error: null });
  assert.equal(r.state, "fail");
  assert.match(r.message, /acknowledged and never drained/,
    "with the drain path probed and absent, the black hole is real and must be said plainly");
  assert.match(r.message, /does not exist/);
});

test("#1368 a timer that exists but is NOT enabled is loss too, and says which", () => {
  const r = withTimer({ unit: "prelim-driver.timer", present: true, enabled: false, error: null });
  assert.equal(r.state, "fail");
  assert.match(r.message, /exists but is not enabled/,
    "an installed-but-disabled timer and an absent one need different fixes");
  assert.match(r.message, /acknowledged and never drained/);
});

test("#1368 a timer that could not be READ is unprobed — not passed, and not quietly failed either", () => {
  const r = withTimer({ unit: "prelim-driver.timer", present: null, enabled: null, error: "EACCES" });
  assert.equal(r.state, "fail", "the arrival gap is still a real finding");
  assert.match(r.message, /NOT PROBED/);
  assert.match(r.message, /EACCES/, "a reader must be able to tell 'no timer' from 'could not look'");
  assert.doesNotMatch(r.message, /acknowledged and never drained/,
    "an unprobed drain path cannot license the strongest sentence the arm has");
});

test("#1368 REPLAY — the issue's own acceptance, in its own terms", () => {
  // "with one job in /home/operator/trademark-test/queue and prelim-driver.timer enabled, the arm must
  // not say 'never drained'." Written as the box was measured on 2026-08-19: the directory resolves,
  // the .path unit globs three OTHER directories the deployment does not use, and the timer is enabled.
  const QUEUE = "/srv/trademark-test/queue";
  const r = v({
    queueDirs: [QUEUE],
    watched: ["/srv/agentplatform/workspace-a/studio/prelim-search/queue"],
    timer: { unit: "prelim-driver.timer", present: true, enabled: true, error: null },
  });
  assert.doesNotMatch(r.message, /never drained/, "#1368's replay acceptance, verbatim");
  assert.notEqual(r.state, "pass", "the missing arrival trigger is still a real gap and must be reported");
  assert.match(r.message, new RegExp(QUEUE.replace(/\//g, "\\/")), "the directory still has to be named");
});

test("#1368 the tick actually SUPPLIES a timer, so 'nobody probed it' is not this caller's normal state", () => {
  // The verdict's unprobed branch is for a caller that could not look. If the deploy tick never passed
  // a timer at all, every real run would land there and the fix would be a sentence change with no new
  // evidence behind it — which is the defect one level up.
  const probe = readFileSync(join(ROOT, "driver", "queue-watch-probe.mjs"), "utf8");
  assert.match(probe, /timer:\s*probeTimer\(/,
    "the probe stopped handing the verdict a timer state — the drain half is unprobed on every real tick");
  assert.match(probe, /timers\.target\.wants/,
    "enabled-ness is a symlink; reading only the unit file cannot tell enabled from merely installed");
});

test("#1368 VOID CONTROL — the door's warning and the tick's verdict still agree about the timer", () => {
  // put one unit path behind both surfaces so they could not reach different conclusions about the
  // same box. They still reached different conclusions about the same CONSEQUENCE: the door has said
  // "or not at all if this deployment has no timer" since, while the tick asserted the black hole
  // unconditionally. If the door's sentence ever loses the timer, this pair has drifted apart again.
  const probe = readFileSync(join(ROOT, "driver", "queue-watch-probe.mjs"), "utf8");
  assert.match(probe, /timer next fires/, "the door's honest sentence lost the timer");
});

// ── the retirement: a posture this arm could not see, and answered as an open finding forever ────────
// (the ruling) and 1888's third criterion (the consumer that printed the line).

const WORKER_ON = { unit: "clearotron-worker.service", present: true, enabled: true };

test("1863 a worker-posture box is a PASS with the reason, not a permanent could-not-read", () => {
  // 1888's founding evidence is this module's own sentence — "the .path unit could not be read —
  // …/prelim-driver.path: ENOENT" — reported honestly and forever, with nothing able to say it was
  // expected. After the retirement that is the steady state of every fresh box, so a skip there is not
  // a cautious answer; it is the check having quietly stopped answering.
  const v = queueWatchVerdict({
    queueDirs: ["/q"], watched: null, unitPath: "/u/prelim-driver.path", unitError: "ENOENT", worker: WORKER_ON,
  });
  assert.equal(v.state, "pass");
  assert.match(v.message, /none is expected/, "the absence is stated as expected, not merely tolerated");
  assert.match(v.message, /clearotron-worker\.service/, "and the reader is told what does drain");
});

test("1863 a worker CANNOT talk a could-not-look into a pass — only ENOENT is evidence of the posture", () => {
  // THE BRANCH THAT MUST NOT BE REACHABLE BY ACCIDENT. `unitError` collapses "not there" with "refused
  // permission to look", and on production these units belong to another account and are unreadable
  // from anywhere else. A worker unit turning that into a pass would put the privilege-limited pass —
  // the failure this whole family refuses — back one door along.
  for (const err of ["EACCES", "EPERM", "some unreadable thing"]) {
    const v = queueWatchVerdict({
      queueDirs: ["/q"], watched: null, unitPath: "/u/p.path", unitError: err, worker: WORKER_ON,
    });
    assert.equal(v.state, "skip", `${err} must stay a skip — it is a failure to look, not a finding`);
  }
});

test("1863 PRESENT is not ENABLED — an installed worker nobody enabled drains nothing", () => {
  // Mirrors probeTimer's own discipline. A unit file on disk is not a decision to run it, and answering
  // otherwise licenses this arm's strongest sentence on the strength of a file.
  const v = queueWatchVerdict({
    queueDirs: ["/q"], watched: null, unitPath: "/u/p.path", unitError: "ENOENT",
    worker: { unit: "clearotron-worker.service", present: true, enabled: false },
  });
  assert.equal(v.state, "skip", "present-but-disabled leaves the old answer standing");
});

test("1863 an unwatched queue under an enabled worker is neither loss nor latency", () => {
  // The timer branch calls this LATENCY, which is true of a 90s tick and false of a continuous drain.
  // Reporting a cost that is not paid is the same defect as the invented black hole this file's header
  // records: a sentence read exactly as written, sending a reader after a fault that is not there.
  const v = queueWatchVerdict({ queueDirs: ["/q"], watched: [], unitPath: "/u/p.path", worker: WORKER_ON });
  assert.equal(v.state, "pass");
  assert.match(v.message, /neither loss nor latency/);

  // AND THE OLD ANSWERS SURVIVE, or this is a way to lose findings rather than to classify them.
  const noWorker = queueWatchVerdict({ queueDirs: ["/q"], watched: [], unitPath: "/u/p.path" });
  assert.equal(noWorker.state, "fail", "no worker and no timer state is still the unprobed-half fail");
  const latency = queueWatchVerdict({
    queueDirs: ["/q"], watched: [], unitPath: "/u/p.path",
    timer: { unit: "prelim-driver.timer", present: true, enabled: true },
  });
  assert.equal(latency.state, "warn", "the timer posture still reads as latency");
});

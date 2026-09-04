// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE INCIDENT'S OWN HARM PATH: a job accepted into a queue nothing watches.
//
// -d2 put the resolved-queues-vs-watched-units comparison on the deploy tick. The incident did not
// happen on a tick: the job was accepted and acknowledged to the requester at 07:24Z and sat in an
// unwatched queue WHILE the drain ran twice. It arrived BETWEEN ticks. So the shape reproduced here is
// an ENQUEUE into an unwatched directory, and what is asserted is that the acceptance itself says so.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { probeQueueWatch, pathUnitFor, unwatchedQueueWarning } from "../queue-watch-probe.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(REPO, "driver", "enqueue.mjs");

/** A HOME with a queue-watcher unit globbing `dirs`, exactly as the shipped unit writes them. */
function homeWatching(dirs) {
  const home = mkdtempSync(join(tmpdir(), "qw-home-"));
  const unit = pathUnitFor(home);
  mkdirSync(dirname(unit), { recursive: true });
  writeFileSync(unit, "[Unit]\nDescription=queue watcher\n\n[Path]\n"
    + dirs.map((d) => `PathExistsGlob=${d}/*.json`).join("\n") + "\n\n[Install]\nWantedBy=paths.target\n");
  return home;
}

// ── the verdict, at the end of the job's life the tick check cannot see ─────────────────────────────

test("#1292 a queue no unit globs is a FAIL, and the message names both paths", () => {
  const home = homeWatching(["/srv/watched-queue"]);
  const v = probeQueueWatch({ queueDirs: ["/srv/somewhere-else"], home });
  assert.equal(v.state, "fail");
  // The incident's entire cost was diagnosis: the job was well-formed, the requester had been told it
  // was accepted, no unit failed and nothing logged. Finding it meant comparing two paths, so both are
  // in the message or the message has not helped anybody.
  assert.match(v.message, /somewhere-else/);
  assert.match(v.message, /prelim-driver\.path/);
});

test("#1292 a queue the unit DOES glob is silent — no warning on a correctly wired box", () => {
  const home = homeWatching(["/srv/watched-queue", "/srv/second"]);
  assert.equal(probeQueueWatch({ queueDirs: ["/srv/second"], home }).state, "pass");
  // Trailing slashes are a spelling, not a disagreement.
  assert.equal(probeQueueWatch({ queueDirs: ["/srv/second/"], home }).state, "pass");
});

test("#1292 `%h` in the unit resolves against the SAME home the probe was asked about", () => {
  const home = mkdtempSync(join(tmpdir(), "qw-home-"));
  const unit = pathUnitFor(home);
  mkdirSync(dirname(unit), { recursive: true });
  writeFileSync(unit, "[Path]\nPathExistsGlob=%h/trademark/workspace/workspace-clawdi/queue/*.json\n");
  assert.equal(probeQueueWatch({ queueDirs: [join(home, "trademark/workspace/workspace-clawdi/queue")], home }).state, "pass");
  assert.equal(probeQueueWatch({ queueDirs: [join(home, "trademark/workspace/workspace-other/queue")], home }).state, "fail");
});

// ── the fresh-box and privilege rules -d2 settled, carried here verbatim ───────────────────────

test("#1292 NO unit at all is SKIP, not fail — a dev box, a checkout and CI all enqueue constantly", () => {
  const home = mkdtempSync(join(tmpdir(), "qw-home-"));   // nothing under .config/systemd
  const v = probeQueueWatch({ queueDirs: ["/srv/anything"], home });
  assert.equal(v.state, "skip", "a box with no systemd unit would be warned on every single enqueue");
  assert.match(v.message, /could not be read/);
});

test("#1292 an UNREADABLE unit is SKIP and never a pass — prod's units belong to another account", () => {
  // Root defeats mode 000, so the permission error is injected rather than arranged on disk: the
  // assertion is about what the verdict does with EACCES, and a test that cannot produce EACCES on the
  // box it runs on would assert nothing here. ( is the same lesson, learned the expensive way.)
  const v = probeQueueWatch({
    queueDirs: ["/srv/anything"], home: "/home/nobody",
    readUnit: () => { const e = new Error("permission denied"); e.code = "EACCES"; throw e; },
  });
  assert.equal(v.state, "skip");
  assert.notEqual(v.state, "pass", "a privilege-limited read that answers 'fine' is the failure this guards");
  assert.match(v.message, /EACCES/);
});

// ── and the door itself: the acceptance carries it ──────────────────────────────────────────────────

function enqueue(qdir, home, id) {
  const r = spawnSync(process.execPath, [CLI,
    "--mark", "NOVAPULSE WATCH", "--classes", "9", "--goods", "downloadable game software",
    "--forwarder", "jordan", "--forwarder-email", "jordan.lee@example.com",
    "--id", id, "--queue-dir", qdir,
  ], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* the assertion below prints what came back */ }
  return { code: r.status, out, stdout: r.stdout, stderr: r.stderr };
}

test("#1292 THE INCIDENT SHAPE: a job enqueued into an unwatched queue is accepted AND says so", () => {
  const root = mkdtempSync(join(tmpdir(), "qw-enq-"));
  const qdir = join(root, "unwatched-queue");
  const home = homeWatching([join(root, "some-other-queue")]);

  const r = enqueue(qdir, home, "qw-unwatched-1");
  assert.equal(r.code, 0, r.stderr);
  // ACCEPTED. The warning must not become a refusal: the job is well-formed and the requester is owed
  // an answer, and a door that rejected it because a systemd unit is missing would be a worse failure
  // than the one being guarded.
  assert.equal(r.out?.queued, true, r.stdout);
  assert.ok(existsSync(join(qdir, "qw-unwatched-1.json")), "the job is on disk — this is not a refusal");
  assert.equal(r.out.queueWatched, "fail");
  assert.match(r.stderr, /\[queue-watch\] WARNING/);
  assert.match(r.stderr, /unwatched-queue/, "the warning does not name the directory nobody is watching");
});

test("#1292 the same enqueue into a WATCHED queue is silent — no new noise on a correct box", () => {
  const root = mkdtempSync(join(tmpdir(), "qw-enq-"));
  const qdir = join(root, "watched-queue");
  const r = enqueue(qdir, homeWatching([qdir]), "qw-watched-1");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.out?.queued, true, r.stdout);
  assert.equal(r.out.queueWatched, "pass");
  assert.ok(!/queue-watch/.test(r.stderr), `a correctly wired box was warned anyway:\n${r.stderr}`);
});

test("#1292 a box with no unit enqueues in silence, which is the common case", () => {
  const root = mkdtempSync(join(tmpdir(), "qw-enq-"));
  const qdir = join(root, "q");
  const r = enqueue(qdir, mkdtempSync(join(tmpdir(), "qw-home-")), "qw-nounit-1");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.out.queueWatched, "skip");
  assert.ok(!/queue-watch/.test(r.stderr), `a box with no systemd was warned:\n${r.stderr}`);
});

// ── the OTHER door: no stderr a requester ever sees, so the warning rides the acceptance ────────────

test("#1292 the MCP door carries the warning in `warnings`, where its caller already looks", () => {
  const src = readFileSync(join(REPO, "mcp-server", "lib", "ops.mjs"), "utf8");
  // start_run's return value is the only thing that reaches a connector: its stderr goes to a server
  // log the requester never reads. Asserted on the wiring rather than the string, so the message can be
  // reworded once, in one place, without this test pinning the wording twice.
  assert.match(src, /probeQueueWatch\(\{ queueDirs: \[qdir\] \}\)/,
    "the MCP door stopped asking whether the queue it just accepted into is watched");
  assert.match(src, /watch\.state === "fail" \? \[unwatchedQueueWarning\(qdir, watch\.unitPath\)\] : \[\]/,
    "the warning no longer rides `warnings` — a field nothing surfaces is a signal nobody gets");
});

test("#1292 the deploy tick and the doors read ONE unit path, so they cannot disagree about a box", () => {
  const tick = readFileSync(join(REPO, "scripts", "live-surface-check.mjs"), "utf8");
  assert.match(tick, /probeQueueWatch\(\{ queueDirs, resolveError \}\)/,
    "the tick check re-implemented the unit read instead of sharing it");
  assert.ok(!/\.config", "systemd", "user", "prelim-driver\.path"/.test(tick),
    "the unit path is spelled a second time in the tick check — one home for it, or they drift");
  assert.match(unwatchedQueueWarning("/q", "/u"), /^\[queue-watch\] WARNING: \/q is not watched by \/u\./);
});

// ── — A UNIT IS ITS FRAGMENT PLUS ITS DROP-INS, AND THE PROBE READ ONLY THE FRAGMENT ───────────
//
// Found live on the test box within three hours of / reaching it. `systemctl --user show
// prelim-driver.path -p Paths` returned ONE glob — the right one — while this probe reported two queue
// directories unwatched, because it read `prelim-driver.path` and never opened `prelim-driver.path.d/`.
// The deploy health check failed on that arm every hour, and every enqueue on the box printed a warning
// that the runner would not wake, while the event-driven watcher was armed and working.
//
// WRONG IN BOTH DIRECTIONS, and the reset is why. Reading the fragment alone OVER-reports (globs the
// deployment has disowned) and UNDER-reports (the ones it actually uses). On a box whose drop-in resets
// a path away, the same code would report a directory as watched that nothing watches — 's original
// harm, produced by the guard built to prevent it. Both directions are pinned below.

/** A HOME whose unit fragment globs `dirs`, plus drop-ins given as `{ "10-name.conf": "<body>" }`. */
function homeWithDropIns(dirs, dropIns) {
  const home = homeWatching(dirs);
  const dir = `${pathUnitFor(home)}.d`;
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(dropIns)) writeFileSync(join(dir, name), body);
  return home;
}

test("#1308 a drop-in that RESETS the list wins: its dirs are watched and the fragment's are not", () => {
  // The test box's own shape, quoting its `queue.conf` verbatim — including the comment that says what
  // the empty assignment is for. This is the case that reddened the deploy every hour.
  const home = homeWithDropIns(["/srv/watched-a", "/srv/watched-b"], {
    "queue.conf":
      "# The empty assignment RESETS the inherited list; without it these are appended to the unit's own globs.\n"
      + "[Path]\nPathExistsGlob=\nPathExistsGlob=/srv/trademark-test/queue/*.json\n",
  });
  assert.equal(probeQueueWatch({ queueDirs: ["/srv/trademark-test/queue"], home }).state, "pass",
    "the directory the drop-in points at reported as unwatched — the drop-in was not read");
  const v = probeQueueWatch({ queueDirs: ["/srv/watched-a"], home });
  assert.equal(v.state, "fail",
    "a glob the drop-in RESET away is still being reported as watched — that is #1216's harm, from the guard meant to prevent it");
  assert.match(v.message, /watched-a/);
});

test("#1308 a drop-in that ADDS to the list keeps both halves", () => {
  const home = homeWithDropIns(["/srv/fragment-queue"], {
    "extra.conf": "[Path]\nPathExistsGlob=/srv/dropin-queue/*.json\n",
  });
  assert.equal(probeQueueWatch({ queueDirs: ["/srv/fragment-queue"], home }).state, "pass", "the fragment's glob was dropped");
  assert.equal(probeQueueWatch({ queueDirs: ["/srv/dropin-queue"], home }).state, "pass", "the drop-in's glob was never read");
});

test("#1308 drop-ins apply in LEXICAL order, so a later reset beats an earlier assignment", () => {
  // Order is the entire mechanism — the reset only means anything relative to what came before it. Two
  // drop-ins whose names sort the other way round would give the opposite answer, and systemd sorts.
  const home = homeWithDropIns(["/srv/fragment-queue"], {
    "10-add.conf": "[Path]\nPathExistsGlob=/srv/early/*.json\n",
    "20-reset.conf": "[Path]\nPathExistsGlob=\nPathExistsGlob=/srv/late/*.json\n",
  });
  assert.equal(probeQueueWatch({ queueDirs: ["/srv/late"], home }).state, "pass");
  assert.equal(probeQueueWatch({ queueDirs: ["/srv/early"], home }).state, "fail", "the 20- reset did not clear the 10- assignment");
  assert.equal(probeQueueWatch({ queueDirs: ["/srv/fragment-queue"], home }).state, "fail", "the reset did not clear the fragment");
});

test("#1308 no drop-in directory at all is the NORMAL case, and changes nothing", () => {
  // Most boxes have none. This is the regression arm for the read itself: an ENOENT on the drop-in dir
  // must not become an unreadable-unit skip, or every fragment-only box goes silent at once.
  const home = homeWatching(["/srv/only-fragment"]);
  assert.equal(probeQueueWatch({ queueDirs: ["/srv/only-fragment"], home }).state, "pass");
  assert.equal(probeQueueWatch({ queueDirs: ["/srv/elsewhere"], home }).state, "fail");
});

test("#1308 an UNREADABLE drop-in is SKIP and never a pass — the same rule as an unreadable fragment", () => {
  // Half a unit read is not a unit read. A drop-in we cannot open may be the one that resets the list,
  // so answering "watched" from the fragment alone is precisely the privilege-limited "fine" this
  // module refuses one level up. Injected, because root defeats mode 000.
  const v = probeQueueWatch({
    queueDirs: ["/srv/anything"], home: "/home/nobody",
    readUnit: (p) => {
      if (p.endsWith(".d/locked.conf")) { const e = new Error("permission denied"); e.code = "EACCES"; throw e; }
      return "[Path]\nPathExistsGlob=/srv/anything/*.json\n";
    },
    listDropIns: () => ["locked.conf"],
  });
  assert.equal(v.state, "skip");
  assert.notEqual(v.state, "pass", "the fragment alone said 'watched' while a drop-in that could have reset it was unreadable");
  assert.match(v.message, /EACCES/);
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DELIVERY LANE HAS THE SAME HAZARD AS THE QUEUE LANE, and `prelim-outbox.path` says so in its own
// header: "this literal and the driver's `config.outboxDir` are two spellings of one fact with nothing
// checking them against each other. Disagree, and finished runs drop their `.pending` markers where
// this watcher is not looking: no delivery wake, no failure, no log."
//
// named this as needing its own reader. MEASURING SAID OTHERWISE — `compareWatches` was already
// generic, so what the outbox needed was a second INPUT PAIR, not a second reader. Building the reader
// I had promised would have been a second implementation of a comparison that already existed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import {
  watchedQueueDirs, compareWatches, outboxBacklog, backlogFinding, ageLabel,
} from "../../scripts/drain-preflight.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTBOX_UNIT = readFileSync(join(ROOT, "driver", "systemd", "prelim-outbox.path"), "utf8");

test("THE GLOB STRIP IS EXTENSION-AGNOSTIC — the bug pointing the reader at a second unit found", () => {
  // The queue watcher globs `*.json`; the outbox watcher globs `*.pending`. A `/\*\.json$/` strip left
  // the outbox path ending in its own glob, so the comparison compared a directory against a pattern
  // and reported a disagreement that was the READER'S, not the box's. That is the same
  // false-positive-from-a-narrow-rule shape the dead-name guard is designed around.
  assert.deepEqual(watchedQueueDirs("PathExistsGlob=%h/x/*.pending", "/srv/testhome"), ["/srv/testhome/x"]);
  assert.deepEqual(watchedQueueDirs("PathExistsGlob=%h/y/*.json", "/srv/testhome"), ["/srv/testhome/y"]);
});

test("the shipped outbox unit resolves to one directory", () => {
  const watched = watchedQueueDirs(OUTBOX_UNIT, "/srv/testhome");
  assert.equal(watched.length, 1, `expected one watch, got ${JSON.stringify(watched)}`);
  assert.ok(!watched[0].includes("*"), "and it is a directory, not a pattern");
});

test("A DISAGREEMENT IS REPORTED FROM BOTH SIDES", () => {
  // Unwatched outbox: markers land where nothing looks — delivery falls to the 55-minute heartbeat.
  // A watch on nothing: dead config, and the tell that the unit and the deployment have drifted.
  const watched = watchedQueueDirs(OUTBOX_UNIT, "/srv/testhome");
  const r = compareWatches(["/srv/testhome/trademark/workspace/prelim-outbox"], watched);
  assert.deepEqual(r.unwatched, ["/srv/testhome/trademark/workspace/prelim-outbox"]);
  assert.equal(r.watchesNothing.length, 1, "and the watch that points at nothing is named too");
});

test("agreement reports nothing", () => {
  const watched = watchedQueueDirs(OUTBOX_UNIT, "/srv/testhome");
  assert.deepEqual(compareWatches(watched, watched).unwatched, []);
});

// ── — ARMED AND KEEPING UP ARE DIFFERENT QUESTIONS ─────────────────────────────────────────────
//
// The arms above ask whether the watcher points at the right directory. They cannot see a lane that is
// pointed correctly and delivering nothing, which is the state the test box was in for eleven days:
// 128 packets, oldest twelve days, nothing removed since 2026-08-12, and no surface anywhere saying so.
//
// `io` is injected so these read a fixture, not the box — a backlog arm that depends on a real outbox
// would pass or fail on which machine ran it.
const fakeIo = (files, mtimes) => ({
  readdirSync: () => files,
  statSync: (p) => {
    const name = p.slice(p.lastIndexOf("/") + 1);
    if (!(name in mtimes)) throw new Error(`no such file: ${p}`);
    return { mtimeMs: mtimes[name] };
  },
});
const NOW = 1_700_000_000_000;

test("#1561 an unreadable outbox is NULL, and null is not zero", () => {
  const blind = { readdirSync: () => { throw new Error("EACCES"); }, statSync: () => { throw new Error("EACCES"); } };
  assert.equal(outboxBacklog("/x", NOW, blind), null,
    "an outbox that cannot be read must not report a count — that is the "
    + "privilege-limited-count-reads-as-empty mistake, and it reads exactly like a healthy lane");
  assert.equal(outboxBacklog(null, NOW, blind), null, "no outbox configured is also unknown, not empty");
  assert.deepEqual(outboxBacklog("/x", NOW, fakeIo([], {})), { pending: 0, oldestAgeSec: null, oldestFile: null },
    "a readable EMPTY outbox is a real answer and must be distinguishable from an unreadable one");
});

test("#1561 it counts packets and finds the oldest, ignoring what is not a packet", () => {
  const files = ["a.pending", "b.pending", "notes.txt", "backoff"];
  const b = outboxBacklog("/x", NOW, fakeIo(files, {
    "a.pending": NOW - 5_000, "b.pending": NOW - 90_000_000, "notes.txt": NOW, "backoff": NOW,
  }));
  assert.equal(b.pending, 2, "only `.pending` files are packets — the backoff sidecars and stray files are not");
  assert.equal(b.oldestFile, "b.pending");
  assert.equal(b.oldestAgeSec, 90_000, "the age is the OLDEST packet's, not the newest or the mean");
});

test("#1561 a packet older than every retry path earns a finding; a fresh one does not", () => {
  const fresh = { pending: 40, oldestAgeSec: 600, oldestFile: "x.pending" };
  assert.equal(backlogFinding(fresh, "/x"), null,
    "forty packets ten minutes old is a busy lane, not a stuck one — depth alone must not fire");

  const stuck = { pending: 128, oldestAgeSec: 12 * 24 * 3600, oldestFile: "old.pending" };
  const said = backlogFinding(stuck, "/x");
  assert.match(said, /128 packet/, "the finding must carry the depth");
  assert.match(said, /12d/, "…and the age, because age is what makes it a finding");
  assert.match(said, /old\.pending/, "…and name the packet, so the reader can go and look at one");

  assert.equal(backlogFinding({ pending: 0, oldestAgeSec: null, oldestFile: null }, "/x"), null,
    "an empty outbox is the passing state");
});

test("#1561 an unreadable outbox REPORTS, rather than passing quietly", () => {
  const said = backlogFinding(null, "/srv/outbox");
  assert.match(said, /UNKNOWN/, "it must say the depth is unknown");
  assert.match(said, /SKIP, not a pass/,
    "this is the whole point: a check that cannot look must not answer as though it looked and found nothing");
  assert.match(said, /\/srv\/outbox/, "and name the directory it could not read");
});

test("#1561 the threshold is the argument, so a caller can show where it turns", () => {
  const b = { pending: 1, oldestAgeSec: 3600, oldestFile: "x.pending" };
  assert.equal(backlogFinding(b, "/x", 7200), null, "under the given bound, nothing is said");
  assert.ok(backlogFinding(b, "/x", 1800), "over it, something is");
});

test("#1561 ageLabel never renders a number without its unit, including unknown", () => {
  assert.equal(ageLabel(null), "unknown", "a missing age is not `0s` — that would read as brand new");
  assert.equal(ageLabel(30), "30s");
  assert.equal(ageLabel(600), "10m");
  assert.equal(ageLabel(7200), "2h");
  assert.equal(ageLabel(12 * 24 * 3600), "12d");
});

test("#1561 the verdict actually CONSULTS the backlog — the helpers are wired, not merely exported", () => {
  // A SOURCE-SHAPE ARM, deliberately, and its weakness is stated rather than hidden. The arms above
  // prove the helpers behave; none of them can see the two lines in `preflight()` that call them, so
  // deleting the wiring leaves every arm above green and the check silently gone. That is the exact
  // failure is about, one level up: a mechanism that exists and is never invoked.
  //
  // Calling `preflight()` here instead would be better and is not available: it spawns `systemctl` and
  // imports driver.config, so it answers about the machine running the suite rather than about the code.
  const src = readFileSync(join(ROOT, "scripts", "drain-preflight.mjs"), "utf8");
  assert.match(src, /const backlog = outboxBacklog\(config\.outboxDir\)/,
    "preflight() no longer reads the backlog");
  assert.match(src, /backlogFinding\(backlog, config\.outboxDir\)/,
    "preflight() reads the backlog but no longer turns it into a finding — the depth would be computed "
    + "and thrown away, which reports as a clean run");
  assert.match(src, /findings\.push\(backlogSays\)/,
    "the finding is computed and never pushed, so it reaches no reader");
  assert.match(src, /delivery: \{[^}]*backlog/,
    "`--json` no longer carries the backlog, so anything parsing this script's output stops seeing it");
});

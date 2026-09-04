// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// CAN THIS BOX DRAIN ITS QUEUE AT ALL? — the check behind the 18-Aug codex round.
//
// The round's engine override rides the DRIVER ACTIVATION's environment, and an activation that never
// happens carries no environment. On the box this was asked about, no runner was running for any user
// and no prelim unit existed in either scope: every enqueued job would have sat there, no unit would
// have failed, and the round would have been fiction with a green harness.
//
// The pure half is tested here. The impure half (systemctl, ps) is not mocked: what it reports is a fact
// about the machine, and a test that faked it would assert the fake.

import { test } from "node:test";
import assert from "node:assert/strict";

import { watchedQueueDirs, compareWatches } from "../../scripts/drain-preflight.mjs";

const UNIT = `[Path]
PathExistsGlob=%h/.openclaw/workspace-clawdi/studio/prelim-search/queue/*.json
PathExistsGlob=%h/.openclaw/workspace-clawdi-b/studio/prelim-search/queue/*.json
#PathExistsGlob=%h/prelim-queue/*.json
Unit=prelim-driver.service
`;

test("%h is resolved and the glob tail stripped — a watch is a directory, not a pattern", () => {
  assert.deepEqual(watchedQueueDirs(UNIT, "/srv/testhome"), [
    "/srv/testhome/.openclaw/workspace-clawdi/studio/prelim-search/queue",
    "/srv/testhome/.openclaw/workspace-clawdi-b/studio/prelim-search/queue",
  ]);
});

test("A COMMENTED GLOB IS NOT A WATCH — and this one ships commented out", () => {
  // Not pedantry. The headless line (`%h/prelim-queue/*.json`) is commented in the shipped unit, so a
  // standalone deployment that never uncommented it has event-driven pickup dead on the ONE queue it
  // uses. Reading the file without honouring `#` reports that box as watched, which is the exact
  // false-green this check exists to refuse.
  assert.ok(!watchedQueueDirs(UNIT, "/srv/testhome").some((d) => d.includes("prelim-queue")));
});

test("THE SILENT DISAGREEMENT IS THE POINT — a queue the runner drains and nothing watches", () => {
  // prelim-driver.path cannot expand an environment variable; its own header says CLEAROTRON_WORK_DIR
  // "is the one thing in the queue lane" it cannot reach. So the globs and config.queueDirs are two
  // spellings of one fact with nothing at runtime comparing them. moved the code default from
  // the platform dot-directory to `$HOME/trademark/workspace` and the globs deliberately did not move.
  const r = compareWatches(
    ["/srv/testhome/trademark/workspace/workspace-clawdi/studio/prelim-search/queue"],
    watchedQueueDirs(UNIT, "/srv/testhome"));
  assert.deepEqual(r.unwatched, ["/srv/testhome/trademark/workspace/workspace-clawdi/studio/prelim-search/queue"]);
});

test("agreement reports nothing, and a trailing slash is not a disagreement", () => {
  const watched = watchedQueueDirs(UNIT, "/srv/testhome");
  const r = compareWatches(watched.map((d) => `${d}/`), watched);
  assert.deepEqual(r.unwatched, [], "the same directory written two ways is one directory");
});

test("BOTH DIRECTIONS, because they are different faults", () => {
  // An unwatched queue is a latency bug that becomes an outage when the timer stops. A watch on a path
  // that does not exist is dead config — harmless today, and the tell that the unit and the deployment
  // have drifted. Reporting only the first would leave the drift invisible, which is how it survives.
  const r = compareWatches([], watchedQueueDirs(UNIT, "/nonexistent-home-for-this-test"));
  assert.equal(r.unwatched.length, 0);
  assert.equal(r.watchesNothing.length, 2, "both globs point at directories that do not exist");
});

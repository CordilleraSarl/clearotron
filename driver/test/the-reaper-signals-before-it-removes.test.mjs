// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-reaper-signals-before-it-removes.test.mjs — the exit handler's order, as the calls happen.
//
// shared/reap-on-exit.mjs must signal every watched process group BEFORE it removes any watched
// directory: a removal that runs first races a browser's surviving children and throws ENOTEMPTY,
// leaving the temp root behind. The race cannot be won on demand, but the ORDER is a plain sequence
// inside one function, and a recorder proves a sequence deterministically. This replaces an arm that
// read the order the two lines were written in, which passed on edits that reversed the effect.
//
// Driven with its own sets, so nothing this process watches is touched and no real pid is signalled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reapAll } from "../../shared/reap-on-exit.mjs";

const drive = (groups, dirs) => {
  const calls = [];
  const state = { groups: new Set(groups), dirs: new Set(dirs) };
  reapAll({ kill: (pid) => calls.push(`kill ${pid}`), remove: (dir) => calls.push(`remove ${dir}`) }, state);
  return { calls, state };
};

test("every watched group is signalled before any watched directory is removed", () => {
  const { calls, state } = drive([101, 102, 103], ["/scratch/a", "/scratch/b"]);
  assert.deepEqual(calls.filter((c) => c.startsWith("kill")), ["kill 101", "kill 102", "kill 103"],
    "a watched group was not signalled, or was signalled twice");
  assert.deepEqual(calls.filter((c) => c.startsWith("remove")), ["remove /scratch/a", "remove /scratch/b"],
    "a watched directory was not removed, or was removed twice");
  const lastKill = calls.findLastIndex((c) => c.startsWith("kill"));
  const firstRemove = calls.findIndex((c) => c.startsWith("remove"));
  assert.ok(lastKill < firstRemove, `a directory was removed while a group was still unsignalled: ${calls.join(", ")}`);
  assert.equal(state.groups.size + state.dirs.size, 0, "the reaper left something watched, so a second exit would act on it again");
});

test("with nothing watched it does nothing, and a directory watched alone is still removed", () => {
  assert.deepEqual(drive([], []).calls, []);
  assert.deepEqual(drive([], ["/scratch/only"]).calls, ["remove /scratch/only"]);
});

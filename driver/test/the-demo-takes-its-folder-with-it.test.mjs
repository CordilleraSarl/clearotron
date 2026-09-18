// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The README promises that the demo removes everything it made when you close it, and that `--keep`
// leaves the folder behind. Neither was reachable. `clearotron demo` hands the supervisor its base with
// `--base` on every run — it lays the program copy and the samples down there first — and the supervisor
// read `--base` as "the reader named this directory", which is the one case where a demo must never
// remove anything. So every demo kept its folder, printed that it had, and `--keep` was never forwarded.
//
// Both halves are driven here as tables, without starting a portal: what the launcher hands over, and
// what the supervisor concludes from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoStartArgs } from "../../shared/demo-start-args.mjs";
import { demoBaseIsTheReaders } from "../../bin/start.mjs";

const DEFAULT = "/h/trademark-demo";
const readers = (args, base = DEFAULT) => demoBaseIsTheReaders({
  baseGiven: args.includes("--base"), ownBase: args.includes("--demo-own-base"), base, demoDefault: DEFAULT,
});

test("a demo started with no flags hands over its own default, and the supervisor may remove it", () => {
  const args = demoStartArgs({ demoBase: DEFAULT });
  assert.deepEqual(args, ["--demo", "--base", DEFAULT, "--demo-own-base"]);
  assert.equal(readers(args), false, "the base is the demo's, so the folder goes when the window closes");
  assert.ok(!args.includes("--keep"));
});

test("--keep reaches the supervisor, so the reader who asked for the folder gets it", () => {
  const args = demoStartArgs({ demoBase: DEFAULT, keep: true });
  assert.ok(args.includes("--keep"), "the flag used to stop at the launcher");
  assert.equal(readers(args), false, "still the demo's own base — it is --keep, not the base, that keeps it");
});

test("a directory the reader named is theirs, and nothing in the demo removes it", () => {
  const args = demoStartArgs({ demoBase: "/h/work/tm-demo", readerBase: true });
  assert.ok(!args.includes("--demo-own-base"), "the launcher does not claim a base it was given");
  assert.equal(readers(args, "/h/work/tm-demo"), true);
});

test("the flag cannot make a named directory removable — it is believed only for the default path", () => {
  // A caller passing --demo-own-base beside some other directory: the rail is the path, compared whole.
  assert.equal(demoBaseIsTheReaders({ baseGiven: true, ownBase: true, base: "/h/work/tm-demo", demoDefault: DEFAULT }), true);
  assert.equal(demoBaseIsTheReaders({ baseGiven: true, ownBase: true, base: "/h/trademark-demo-2", demoDefault: DEFAULT }), true,
    "a sibling that starts with the default's name is not the default");
  assert.equal(demoBaseIsTheReaders({ baseGiven: true, ownBase: true, base: "", demoDefault: DEFAULT }), true,
    "nothing to compare is not permission to remove");
});

test("a supervisor started with no --base chose its own default, as it always has", () => {
  assert.equal(demoBaseIsTheReaders({ baseGiven: false, ownBase: false, base: DEFAULT, demoDefault: DEFAULT }), false);
});

test("the port and the no-browser flags still travel", () => {
  assert.deepEqual(demoStartArgs({ demoBase: DEFAULT, port: 9000, noOpen: true }),
    ["--demo", "--base", DEFAULT, "--demo-own-base", "--port", "9000", "--no-open"]);
});

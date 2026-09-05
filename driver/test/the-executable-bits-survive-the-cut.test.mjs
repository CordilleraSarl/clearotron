// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE EXECUTABLE BIT IS A PROPERTY OF THE TREE, AND THE EXPORT HAS DROPPED IT ONCE.
//
// The public cut took 13 files from 100755 to 100644 and 0 the other way. Nothing reported it. It
// surfaced days later as a group-kill arm returning in 13ms with `killed=false` and no signals —
// `driver/test/mock-hang-tree.mjs` is spawned directly as the engine binary and at 644 the spawn dies
// instantly, which reads exactly like a broken kill escalation. Most of a session went into treating a
// file-mode loss as a signal-handling defect.
//
// THIS ARM LIVES ON THE EXPORTED TREE ON PURPOSE. A check inside the cut tooling would be the tidier
// place, but the cut tooling is not exported and so is not reachable from where the damage lands. Here
// it travels WITH the export: a future cut that drops a bit goes red on the public tree's own suite,
// immediately, naming the file — instead of surfacing as an arm failing for a reason that looks like
// anything but a file mode.
//
// WHY A RECORDED SET RATHER THAN A DERIVED ONE, which is a correction to the design this arm was filed
// with. The filing proposed deriving the set from the shebang. Measured, that is wrong and would have
// produced a guard that fires on almost the whole tree: 114 tracked files carry a shebang and 96 of
// them are NOT executable, because they are run as `node <script>` and their mode has never mattered.
// The shebang does not discriminate.
//
// Nor is "should this file be executable" answerable in general — it depends on whether something,
// somewhere, spawns it as a binary rather than handing it to node. So this arm does not try to decide
// that. It asserts the set does not CHANGE without someone saying so, which is the property the cut
// actually violated, and it asserts it in BOTH directions: a bit lost fails, and a bit appearing
// unrecorded fails too. One-directional would pass over the cut's inverse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const GUARD = "executable bits";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// THE RECORDED SET. Adding a line here is the deliberate act; the arm exists so that dropping one is
// not. The 13 restored after the cut are all present, alongside the 7 that survived it.
const EXECUTABLE = [
  "bin/clearotron.mjs",
  "bin/key.mjs",
  "bin/uspto-sync.mjs",
  "driver/deliver-trigger.sh",
  "driver/engine/mcp/corsearch-server.mjs",
  "driver/engine/mcp/euipo-server.mjs",
  "driver/engine/mcp/fetch-server.mjs",
  "driver/engine/mcp/gather-config.mjs",
  "driver/engine/mcp/perplexity-server.mjs",
  "driver/engine/mcp/stdio-server.mjs",
  "driver/test/mock-claude-spew-immune.mjs",
  "driver/test/mock-claude.mjs",
  "driver/test/mock-codex.mjs",
  "driver/test/mock-hang-tree.mjs",
  "driver/test/mock-spew-immune.mjs",
  "driver/test/refusing-engine.mjs",
  "scripts/added-reference-check.mjs",
  "scripts/deploy-test.sh",
  "scripts/home-render-check.mjs",
  "scripts/queue-inflight.mjs",
];

// Modes from the INDEX, not from disk. A working tree on a filesystem that does not carry the bit —
// or a checkout made with a umask that dropped it — would answer for the machine rather than for what
// ships, and what ships is the whole question here.
const indexModes = () => {
  const files = trackedFiles(GUARD, { root: ROOT });
  if (files === null) return null;
  const out = new Map();
  const raw = execFileSync("git", ["ls-files", "-s"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [meta, path] = line.split("\t");
    if (path) out.set(path, meta.split(" ")[0]);
  }
  return out;
};

test("every recorded executable is still executable in the index", (ctx) => {
  const modes = indexModes();
  if (modes === null) return ctx.skip(skipReason(GUARD));
  const lost = [];
  for (const path of EXECUTABLE) {
    const mode = modes.get(path);
    if (mode === undefined) {
      lost.push(`${path} — NOT TRACKED AT ALL, so this entry names nothing`);
    } else if (mode !== "100755") {
      lost.push(`${path} — ${mode}, was 100755`);
    }
  }
  assert.deepEqual(lost, [],
    "the executable bit is gone from file(s) recorded as carrying it:\n  " + lost.join("\n  ")
    + "\n\nThis is what the cut did once, silently. If a file genuinely no longer needs the bit, delete "
    + "its line above and say so; if this is an export that dropped it, restore the mode rather than "
    + "the list.");
});

test("no file outside the recorded set has become executable", (ctx) => {
  const modes = indexModes();
  if (modes === null) return ctx.skip(skipReason(GUARD));
  const recorded = new Set(EXECUTABLE);
  const surprises = [...modes].filter(([p, m]) => m === "100755" && !recorded.has(p)).map(([p]) => p);
  // BOTH DIRECTIONS, because one is not a guard. An arm that only checks the recorded files passes
  // over an export that hands the bit to something new, and it passes over the list quietly rotting
  // out of step with the tree it claims to describe.
  assert.deepEqual(surprises, [],
    "executable in the index and not recorded above:\n  " + surprises.join("\n  ")
    + "\n\nAdd the line if the bit is intended — that is the deliberate act this arm is asking for.");
});

test("FLOOR — the recorded set and the index read are both non-empty", (ctx) => {
  const modes = indexModes();
  if (modes === null) return ctx.skip(skipReason(GUARD));
  // An arm iterating an emptied list passes over nothing at all, and a `git ls-files -s` that returned
  // nothing would make BOTH arms above green at once — the loudest possible pass over the quietest
  // possible failure.
  assert.ok(EXECUTABLE.length >= 15,
    `only ${EXECUTABLE.length} recorded executable(s) — the list has been gutted, not the tree`);
  assert.ok(modes.size > 500,
    `only ${modes.size} tracked file(s) read from the index — the read is broken, not the tree`);
  const executables = [...modes.values()].filter((m) => m === "100755");
  assert.ok(executables.length >= 15,
    `only ${executables.length} executable(s) in the index — if this is real, the export dropped a great `
    + `many bits at once, which is the failure this file is named for`);
});

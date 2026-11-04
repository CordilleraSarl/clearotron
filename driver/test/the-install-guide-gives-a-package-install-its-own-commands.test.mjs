// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE INSTALL GUIDE GIVES A PACKAGE INSTALL ITS OWN COMMANDS, AND KEEPS A CHECKOUT'S FOR A CHECKOUT.
//
// A newcomer who installed the published beta from npm met a checkout's wording where they stood
// (measured 2026-11-04): "your checkout stays on the commit you cloned until you run `npx clearotron
// update`, which fast-forwards", where `npx clearotron` fetches the stable and a package install has no
// commit; a timer unit to copy from `driver/systemd/`, a directory relative to a checkout; and
// `node mcp-server/server.mjs` as the way to start the local MCP server. bin/README.md opened "from a fresh
// clone".
//
// Each command the guide now gives is checked against the verb table the `clearotron` command dispatches
// on, and the update sentence against the function that picks an update's version.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERBS } from "../../bin/clearotron.mjs";
import { updateTarget } from "../../shared/permanent-install.mjs";
import { globalBinDirFrom } from "../../shared/invocation.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const flat = (s) => s.replace(/\s+/g, " ");
const INSTALL = flat(read("INSTALL.md"));

test("the commands the guide gives a package install are verbs the installed command runs", () => {
  assert.deepEqual(VERBS.update, ["bin/update.mjs"]);
  assert.deepEqual(VERBS.run, ["driver/pipeline.mjs"]);
  assert.deepEqual(VERBS.mcp, ["bin/mcp.mjs"]);
  // `run --resume` without `--job` is a command the pipeline accepts: it rebuilds the job from the run.
  assert.match(read("driver/pipeline.mjs"), /if \(!a\.job && !a\.codename\) \{ console\.error\(USAGE\); process\.exit\(2\); \}/,
    "the pipeline no longer accepts --resume without --job");
  assert.ok(INSTALL.includes("``` clearotron run --resume <codename> ```"),
    "§5 gives no package-install form of the resume command");
  assert.match(INSTALL, /``` clearotron mcp ``` In a git checkout, `node mcp-server\/server\.mjs` starts the same server\./,
    "§7 gives a checkout's command as the way to start the local MCP server");
});

test("the update sentence is what update does on each channel, and names the installed command", () => {
  // A stable install takes the newest stable; a beta install takes whichever of the newest beta and the newest
  // stable is later. Both halves of the sentence, read off the function.
  assert.equal(updateTarget({ version: "0.5.0", distTags: { latest: "0.5.1", beta: "0.6.0-beta.1" } }).version, "0.5.1");
  assert.equal(updateTarget({ version: "0.5.0-beta.10", distTags: { latest: "0.4.9", beta: "0.5.0-beta.11" } }).version, "0.5.0-beta.11");
  assert.equal(updateTarget({ version: "0.5.0-beta.10", distTags: { latest: "0.5.0", beta: "0.5.0-beta.10" } }).version, "0.5.0");
  // On Windows a package install has no prefix update can name, so it updates nothing and names npm's command.
  assert.equal(globalBinDirFrom(join("C:", "npm", "lib", "node_modules", "clearotron"), "win32"), null);
  assert.ok(INSTALL.includes("`clearotron update` does. On a package install on Linux or macOS it installs the newest stable, or for a "
    + "beta install the newest beta or stable, whichever is later; on Windows it names the npm command to run instead. In a git "
    + "checkout it fast-forwards the checkout"),
  "§6 does not say what `clearotron update` does on a package install and in a checkout");
  assert.doesNotMatch(INSTALL, /`npx clearotron update`/, "the guide sends a package install to `npx clearotron update`, which fetches the stable");
  assert.doesNotMatch(INSTALL, /your checkout stays on the commit you cloned/, "the guide tells every reader they cloned");
  assert.ok(INSTALL.includes("**To make that automatic in a git checkout**"), "the timer unit is not marked as a checkout's");
});

test("bin/README.md does not open by assuming a clone", () => {
  assert.doesNotMatch(read("bin/README.md").split("\n").slice(0, 5).join(" "), /fresh clone/);
});

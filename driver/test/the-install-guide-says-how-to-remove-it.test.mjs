// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PERSON WHO INSTALLED THIS CAN FIND OUT HOW TO REMOVE IT — and the list is not a hand-written one.
//
// Nothing in the published package said how (measured on a published beta, 2026-09-11: "uninstall"
// appeared only in a maintainer's check, and "remove" in INSTALL.md was about something else). Meanwhile
// an install writes in five places, and the demo — which DOES tell its reader how to remove itself —
// promises one directory. Someone handing a machine back had to guess, and guessing wrong either leaves
// a clearance pool behind or deletes it when they meant to keep it.
//
// EVERY PATH IS DERIVED FROM THE CODE THAT WRITES IT. A list typed out here would go stale the first time
// the install grew a directory, and it would go stale silently — which is the failure this arm exists to
// prevent, not one to repeat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installPaths } from "../../bin/start.mjs";
import { SERVER_INSTALL_SET } from "../../shared/server-units.mjs";
import { defaultDenylistPath } from "../../shared/client-door.mjs";
import { runningDir } from "../../shared/running-start.mjs";
// `unitEnvPath` is here because a list derived from resolvers is only as complete as the resolvers asked,
// and this one was missed: `start --background` writes ~/.env, mode 600, carrying the credentials the
// services read, and the section said nothing about it while the arm read as complete (found in review).
import { envLocalPath, unitEnvPath } from "../../shared/env-local.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const INSTALL = readFileSync(join(ROOT, "INSTALL.md"), "utf8");
const HOME = "~";

/** The section, by its own heading — an arm that read the whole file would pass on a mention anywhere. */
function removalSection(text = INSTALL) {
  const from = text.indexOf("## 2a. Removing it");
  assert.notEqual(from, -1, "INSTALL.md has no removal section");
  const next = text.indexOf("\n## ", from + 1);
  return text.slice(from, next === -1 ? undefined : next);
}

test("the removal section names every path an install writes", () => {
  const section = removalSection();
  const paths = installPaths(join(HOME, "trademark"));
  const wanted = [
    ...Object.values(paths).filter((p) => typeof p === "string" && p.startsWith(HOME)),
    envLocalPath({ home: HOME }), unitEnvPath({ home: HOME }), runningDir({ home: HOME }), defaultDenylistPath(HOME),
    join(HOME, ".local", "lib", "node_modules", "clearotron"), join(HOME, ".local", "bin", "clearotron"),
    join(HOME, "trademark-demo"),
  ];
  // A FLOOR ON THE POPULATION, not just on the matches: a resolver that answered nothing would make every
  // assertion below vacuous, and an empty list reads exactly like a complete one.
  assert.ok(wanted.length >= 13, `only ${wanted.length} paths derived — the readers answered nothing`);
  const missing = wanted.filter((p) => !section.includes(p));
  assert.deepEqual(missing, [], `paths an install writes that the removal section does not name: ${missing.join(", ")}`);
});

test("it says which directory holds the reports, and what deleting it costs", () => {
  const section = removalSection();
  const pool = installPaths(join(HOME, "trademark")).pool;
  const line = section.split("\n").find((l) => l.includes(pool) && /report/i.test(l));
  assert.ok(line, `the line naming ${pool} does not say it holds the reports`);
  assert.match(section, /Deleting the pool deletes the clearances/,
    "a reader deciding what to keep is told what they lose, in the sentence that tells them they may keep it");
});

test("it says how to remove the background services, and names each unit", () => {
  const section = removalSection();
  for (const unit of SERVER_INSTALL_SET) assert.ok(section.includes(unit), `the removal section does not name ${unit}`);
  assert.ok(SERVER_INSTALL_SET.length >= 4, "the unit set answered with too few members to be the real one");
  assert.ok(section.includes(join(HOME, ".config", "systemd", "user")), "nor where the units live");
  assert.match(section, /clearotron stop/, "nor the command that removes them");
});

test("the reader is told to stop the product before removing it, and where the guide is announced", () => {
  assert.match(removalSection(), /Stop it first/);
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /INSTALL\.md#2a-removing-it/, "the README does not point at the removal section");
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Setup spoke to a package install as if it were a git checkout. A newcomer who installed with npm was
// told the configuration folder "lets you take updates with `git pull`", and the settings file setup wrote
// opened "Written by `npm run setup`", a script a package does not have, and said ".gitignore already
// covers it". That last claim held for no install: the file is written to the reader's own settings
// folder, outside the program on both routes, where no .gitignore of ours reaches.
//
// The sentences are read off the functions setup prints them through, for each route, and the claim
// about .gitignore is checked against where the settings file actually goes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { composeEnvBody, configOutsideWhy } from "../../bin/onboard.mjs";
import { envLocalPath } from "../../shared/env-local.mjs";
import { isInsideCheckout } from "../../shared/inside-checkout.mjs";

const ONBOARD = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "onboard.mjs");
const header = (body) => body.split("\n").filter((l) => l.startsWith("#")).join("\n");

test("a package install's settings file names the command it has, and a checkout's keeps its own", () => {
  const packaged = header(composeEnvBody({ CLEAROTRON_DATABASE: "free-tier" }, {}, { packaged: true }));
  assert.doesNotMatch(packaged, /npm run setup/, `a package has no npm scripts, and its settings file says:\n${packaged}`);
  assert.match(packaged, /Written by `clearotron install`/);
  const checkout = header(composeEnvBody({ CLEAROTRON_DATABASE: "free-tier" }, {}, { packaged: false }));
  assert.match(checkout, /Written by `npm run setup`/, "a checkout runs setup as an npm script, and its header says so");
});

test("the settings file claims no .gitignore, because it is written outside the program on every route", () => {
  // Where setup writes the file, for a checkout and for a package under a project.
  for (const repoRoot of ["/srv/checkout-of-the-program", "/srv/a-project/node_modules/clearotron"]) {
    const written = envLocalPath({ repoRoot, home: "/srv/example-home" });
    assert.equal(isInsideCheckout(written, repoRoot), false, `${written} is inside ${repoRoot}, so the claim below would need its own test`);
  }
  for (const packaged of [true, false]) {
    const body = header(composeEnvBody({}, {}, { packaged }));
    assert.doesNotMatch(body, /gitignore/, `no .gitignore covers a file outside the program, and the header says:\n${body}`);
    assert.match(body, /mode 600/, "the instruction that still holds is kept");
  }
});

test("setup tells a package install how its configuration survives an update, without git", () => {
  const packaged = configOutsideWhy(true);
  assert.doesNotMatch(packaged, /git|checkout/, `a package install was told about git: ${packaged}`);
  assert.match(packaged, /update/, "the reason the folder is outside the program is still given");
  assert.match(configOutsideWhy(false), /`git pull`/, "a checkout takes updates with git, and is told so");
  // Setup prints it for the route it is running on.
  assert.match(readFileSync(ONBOARD, "utf8"), /prose\(configOutsideWhy\(PACKAGED\)\);/);
});

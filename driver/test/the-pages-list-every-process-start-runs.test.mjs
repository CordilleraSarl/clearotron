// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PAGES LIST EVERY PROCESS `clearotron start` RUNS.
//
// bin/README.md said start.mjs "starts exactly two children", then that it "also starts a third", and a
// newcomer counted four running (measured on a beta, 2026-11-04): the portal, two MCP servers and the
// queue worker. The install guide said `start` starts "the portal and the engine door" and that Ctrl-C
// "stops both".
//
// THE LIST IS READ FROM THE SUPERVISOR: every `start("<name>", "<script>", …)` call in bin/start.mjs is a
// child it spawns. A child added there and not named on the pages goes red here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spell } from "../doc-constants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const flat = (s) => s.replace(/\s+/g, " ");

const CHILDREN = [...read("bin/start.mjs").matchAll(/\bstart\("([^"]+)", "([^"]+)"/g)].map((m) => ({ name: m[1], script: m[2] }));

test("the supervisor's own list of children is readable", () => {
  // A FLOOR, so an extractor that stopped matching cannot pass the arms below with nothing to check.
  assert.ok(CHILDREN.length >= 4, `only ${CHILDREN.length} child process(es) found in bin/start.mjs`);
  assert.equal(new Set(CHILDREN.map((c) => c.script)).size, CHILDREN.length, "a script is started twice, which this arm does not expect");
});

test("bin/README.md names every child start.mjs runs, and how many there are", () => {
  const page = flat(read("bin/README.md"));
  assert.ok(page.includes(`It starts ${spell(CHILDREN.length)} children.`), `bin/README.md does not say start.mjs starts ${spell(CHILDREN.length)} children`);
  for (const c of CHILDREN) assert.ok(page.includes(`\`${c.script}`), `bin/README.md does not name ${c.script} (${c.name})`);
  assert.doesNotMatch(page, /exactly two children|also starts a third child/, "bin/README.md still counts two children, then three");
});

test("the install guide names every process start runs, and Ctrl-C stops them all", () => {
  const text = read("INSTALL.md");
  const at = text.indexOf("One command. It starts ");
  assert.notEqual(at, -1, "INSTALL.md §5 no longer says what one `clearotron start` runs");
  const paragraph = flat(text.slice(at, text.indexOf("\n\n", at)));
  for (const c of CHILDREN) assert.ok(paragraph.includes(c.name), `INSTALL.md §5 does not say start runs ${c.name}`);
  assert.doesNotMatch(paragraph, /stops both/, "INSTALL.md §5 says Ctrl-C stops two processes");
});

test("the verb list, setup's closing screen and the contributor's guide name every process start runs", async () => {
  const { SUMMARY } = await import("../../bin/clearotron.mjs");
  const closing = flat(read("bin/onboard.mjs")).match(/clearotron start\\n`\); say\("\s*(Starts [^"]+)"\); say\("\s*([^"]+)"/);
  assert.ok(closing, "setup's closing screen no longer says what start starts");
  const row = flat(read("AGENTS.md")).match(/\| `start` \| ([^|]+)\|/)?.[1] ?? "";
  for (const [where, text] of [["the verb list", SUMMARY.start], ["setup's closing screen", closing[1]], ["AGENTS.md", row]])
    for (const c of CHILDREN) assert.ok(text.includes(c.name.replace(/^the /, "")), `${where} does not say start runs ${c.name}: ${text}`);
  assert.doesNotMatch(flat(read("bin/start.mjs")), /starts two child processes/, "the supervisor's own header still counts two");
});

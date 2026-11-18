// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// About one test file in five asserts on a product file's text, so a move, a reflow or a rename turns it red with no
// behaviour changed, and nothing counted them. scripts/mint-source-pin-census.mjs records where they are; this holds the
// record as a floor. A test file the census does not list may not start pinning, and a listed one may not pin more than it
// is recorded with. A pin comes off with the change that gives its behaviour a test, and the census is re-minted down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mint, pinsIn, FIXTURE } from "../../scripts/mint-source-pin-census.mjs";
import { skipReason } from "../../shared/tracked-files.mjs";

test("no test file pins more product source than the census records", (t) => {
  const now = mint();
  if (now === null) return t.skip(skipReason("source-pin-census"));
  const was = JSON.parse(readFileSync(FIXTURE, "utf8"));
  assert.ok(now.total > 100, `only ${now.total} pinning files were found, so this floor would pass on nothing`);
  const grew = Object.entries(now.files).filter(([f, [c, r]]) => !was.files[f] || c > was.files[f][0] || r > was.files[f][1])
    .map(([f, n]) => `${f}: ${JSON.stringify(n)} against ${JSON.stringify(was.files[f] ?? [0, 0])}`);
  assert.deepEqual(grew, [], "these test files pin product source the census does not record; test the behaviour instead");
  assert.ok(now.total <= was.total, `${now.total} files pin source, above the recorded ${was.total}`);
});

// The planted pins are assembled, so this file's own text pins nothing and the census does not count it.
const READ = "readFile" + "Sync(", SOURCE = "driver" + "Source(";

test("the matcher sees both shapes of pin, and not an import or a test helper's path", () => {
  assert.deepEqual(pinsIn(`const src = ${SOURCE}"pipeline.mjs");`), [1, 0]);
  assert.deepEqual(pinsIn(`const s = ${READ}join(ROOT, "driver", "stages.mjs"), "utf8");`), [0, 1]);
  assert.deepEqual(pinsIn(`const s = ${READ}new URL("../gateway.mjs", import.meta.url), "utf8");`), [0, 1]);
  assert.deepEqual(pinsIn(`const s = ${READ}"driver/runner.mjs", "utf8");`), [0, 1]);
  assert.deepEqual(pinsIn(`import { x } from "../gateway.mjs";\nconst j = ${READ}join(dir, "out.json"), "utf8");`), [0, 0], "an import is not a pin");
  assert.deepEqual(pinsIn(`const s = ${READ}new URL("../test/fixtures/a.mjs", import.meta.url), "utf8");`), [0, 0], "a test fixture is not product source");
});

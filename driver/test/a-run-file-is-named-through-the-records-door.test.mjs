// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN FILE IS NAMED THROUGH THE RECORD'S DOOR.
//
// `driver/run-record.mjs` holds every fixed file a run keeps under `_driver/` as a key of `paths()`. Product code that
// builds one of those paths by hand, `driverDir(run, "verdict.json")`, names the file a second time, and a rename at the
// door misses it without a sound. This guard reads the product code under `driver/` (not the manuals under
// `driver/skills/`, not tests) and `mcp-server/`, and refuses such a call. A path of more than one segment, such as
// `driverDir(run, "jx", "units.json")`, has no key and stays as it is; so does a store's name held as data in a table.
//
// THE RECORDED REMAINDER MAY ONLY SHRINK. When this guard landed, seven calls in files another builder holds were still
// spelled by hand. Each converts with its file's next change, and its entry comes off then; an entry the code no longer
// has is reported, not failed, so the builder converting it is never stopped by this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "../run-record.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GUARD = "run-files-through-the-records-door";

// The door's single-segment names, read from the door itself so a key added there is covered at once.
const DOOR_NAMES = new Set(Object.values(paths("/R"))
  .filter((v) => typeof v === "string" && /^\/R\/_driver\/[^/]+$/.test(v))
  .map((v) => v.slice("/R/_driver/".length)));

const CALL = /driverDir\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*(["'])([^"']+)\1\s*\)/g;
const handSpelled = (src) => [...String(src).matchAll(CALL)].map((m) => m[2]).filter((name) => DOOR_NAMES.has(name));

const inScope = (f) => f.endsWith(".mjs") && !f.startsWith("driver/skills/") && !/(^|\/)test\//.test(f) && !f.endsWith(".test.mjs");

const REMAINDER = {};

test("the guard's own premises: the door names its files, and the scan tells a hand-spelled path from a keyed one", () => {
  assert.ok(DOOR_NAMES.size > 100, `the door names only ${DOOR_NAMES.size} fixed files — the scan below would pass on nothing`);
  assert.deepEqual(handSpelled(`const v = readJson(driverDir(run.runDir, "verdict.json"));`), ["verdict.json"], "a hand-spelled door file is found");
  assert.deepEqual(handSpelled(`const v = readJson(paths(run.runDir).verdict);`), [], "a keyed path is not");
  assert.deepEqual(handSpelled(`const u = driverDir(runDir, "jx", "units.json");`), [], "a path of several segments has no key and is not");
  assert.deepEqual(handSpelled(`const t = { "_driver/verdict.json": "required" };`), [], "a store's name held as data is not");
});

test("no product code builds a path to a file the record's door names", (t) => {
  const tracked = trackedFiles(GUARD, { root: ROOT, pathspec: ["driver", "mcp-server"] });
  if (tracked === null) return t.skip(skipReason(GUARD));
  const files = tracked.filter(inScope);
  assert.ok(files.length > 200, `only ${files.length} product files were listed — the scan would pass on nothing`);
  const offending = [];
  const stale = [];
  for (const file of files) {
    const found = handSpelled(readFileSync(join(ROOT, file), "utf8"));
    const allowed = [...(REMAINDER[file] ?? [])];
    for (const name of found) {
      const at = allowed.indexOf(name);
      if (at >= 0) allowed.splice(at, 1); else offending.push(`${file}: driverDir(…, "${name}")`);
    }
    for (const name of allowed) stale.push(`${file}: ${name}`);
  }
  for (const s of stale) t.diagnostic(`converted, and its remainder entry can come off: ${s}`);
  assert.deepEqual(offending, [], "these paths name a file the door holds a key for; read it as paths(dir).<key>");
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The run record's door: a missing or corrupt file stays what each reader says it is.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { atomicWrite, driverDir, readJson, readJsonOr, readJsonOrNull } from "../run-record.mjs";

function inTempDir(body) {
  const dir = mkdtempSync(join(tmpdir(), "run-record-"));
  try { return body(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test("readJson returns the parsed file and throws on a missing or corrupt one", () => inTempDir((dir) => {
  const good = join(dir, "good.json"), bad = join(dir, "bad.json");
  writeFileSync(good, '{"a":1}');
  writeFileSync(bad, "{not json");
  assert.deepEqual(readJson(good), { a: 1 });
  assert.throws(() => readJson(join(dir, "absent.json")), /ENOENT/);
  assert.throws(() => readJson(bad), SyntaxError);
}));

test("readJsonOr returns the parsed file, and the caller's fallback on a missing or corrupt one", () => inTempDir((dir) => {
  const good = join(dir, "good.json"), bad = join(dir, "bad.json"), zero = join(dir, "null.json");
  writeFileSync(good, '{"a":1}');
  writeFileSync(bad, "{not json");
  writeFileSync(zero, "null");
  assert.deepEqual(readJsonOr(good, null), { a: 1 });
  assert.equal(readJsonOr(join(dir, "absent.json"), null), null);
  assert.deepEqual(readJsonOr(bad, {}), {});
  assert.equal(readJsonOr(zero, {}), null, "a file holding null is that value, not an absence");
  assert.deepEqual(readJsonOrNull(good), { a: 1 });
  assert.equal(readJsonOrNull(bad), null);
}));

test("atomicWrite replaces the file and leaves no temporary beside it", () => inTempDir((dir) => {
  const file = join(dir, "status.json");
  atomicWrite(file, "first");
  atomicWrite(file, "second");
  assert.equal(readFileSync(file, "utf8"), "second");
  assert.deepEqual(readdirSync(dir), ["status.json"]);
}));

test("atomicWrite removes its temporary and rethrows when the rename fails", () => inTempDir((dir) => {
  const target = join(dir, "occupied");
  mkdirSync(target);
  writeFileSync(join(target, "child"), "x");
  assert.throws(() => atomicWrite(target, "text"));
  assert.deepEqual(readdirSync(dir), ["occupied"]);
}));

test("the door hands out the same run-folder paths as the helper it re-exports", () => {
  assert.equal(driverDir("/run", "verdict.json"), join("/run", "_driver", "verdict.json"));
});

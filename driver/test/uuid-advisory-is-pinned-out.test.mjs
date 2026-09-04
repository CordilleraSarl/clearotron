// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE `uuid` ADVISORY IS PINNED OUT, AND THE PIN SAYS WHEN IT BECOMES DEAD WEIGHT.
//
// `npm audit` is the second command CONTRIBUTING gives a new reader, and it ended in "2 moderate
// severity vulnerabilities". Both rows were the same advisory reached through one dependency: `exceljs`
// — the workbook writer behind driver/publish/xlsx.mjs — declares `uuid@^8.3.0`, and the advisory covers
// `uuid <11.1.1`.
//
// WHY A FORWARD PIN RATHER THAN THE FIX npm OFFERS. `npm audit fix --force` resolves it by installing
// `exceljs@3.4.0` — a two-major downgrade of a shipping output path, to close an advisory in a code path
// this repository does not execute. Overriding the TRANSITIVE forward keeps `exceljs` at 4.4.0 and takes
// the advisory to zero, and the `overrides` mechanism is one this tree already uses (, `buffers`).
//
// AN ABSENT DEPENDENCY ALSO REPORTS ZERO, AND THAT IS NOT A FIX. Reached while building this: deleting
// the `node_modules/uuid` entry from the lockfile and re-resolving printed `found 0 vulnerabilities`
// over a tree with 388 packages instead of 389 — the advisory was gone because the dependency was. The
// PRESENCE assertion below is that mistake written down, because the green it produced was
// indistinguishable from the green a real fix produces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

/** The first version the advisory does NOT cover. GHSA-w5hq-g745-h8pq is `uuid <11.1.1`. */
const FIXED_AT = [11, 1, 1];
const parse = (v) => String(v).replace(/^[^0-9]*/, "").split(".").map(Number);
const atLeast = (v, min) => {
  const a = parse(v);
  for (let i = 0; i < min.length; i++) {
    if ((a[i] ?? 0) > min[i]) return true;
    if ((a[i] ?? 0) < min[i]) return false;
  }
  return true;
};

test("#1722 the override is declared, and it names a range the advisory does not reach", () => {
  const pkg = readJSON(join(ROOT, "package.json"));
  const pin = pkg.overrides?.uuid;
  assert.ok(pin, "the `uuid` override is gone — `exceljs` resolves uuid@8 again and the advisory is back");
  assert.ok(atLeast(pin, FIXED_AT), `overrides.uuid is "${pin}", which still admits a version the advisory covers (<11.1.1)`);
});

test("#1722 the LOCKFILE — what CI installs from — resolves uuid forward, and the entry is PRESENT", () => {
  const lock = readJSON(join(ROOT, "package-lock.json"));
  const entry = lock.packages?.["node_modules/uuid"];

  // PRESENCE FIRST, and this order is the point. `found 0 vulnerabilities` over a lockfile with no uuid
  // entry at all reads exactly like `found 0 vulnerabilities` over a fixed one. Asserting only the
  // version would pass `undefined >= 11.1.1` as vacuously true on the broken tree.
  assert.ok(entry, "no `node_modules/uuid` entry in the lockfile — a tree that RESOLVES nothing audits "
    + "clean and installs nothing. That is a missing dependency, not a fix.");
  assert.ok(atLeast(entry.version, FIXED_AT),
    `the lockfile resolves uuid@${entry.version}; the advisory covers everything below 11.1.1`);
});

test("#1722 the pin did not cost the workbook writer — exceljs is unchanged at 4.x", () => {
  const lock = readJSON(join(ROOT, "package-lock.json"));
  const ex = lock.packages?.["node_modules/exceljs"];
  assert.ok(ex, "exceljs left the tree — the pin was supposed to leave it alone");
  assert.equal(parse(ex.version)[0], 4,
    `exceljs is at ${ex.version}. The whole argument for the forward pin is that it avoids the `
    + "two-major downgrade `npm audit fix --force` performs; a major move here means that argument was lost.");
});

// THE MAINTENANCE TRIPWIRE, and it is meant to fire one day. The issue asks for a note saying when this
// pin stops being needed; a note goes stale in silence, so this asserts the condition instead. When
// `exceljs` ships a release that takes `uuid >= 11.1.1` on its own, this arm fails and its message says
// to delete the override — which is the only moment anyone needs to know.
test("#1722 the pin is still LOAD-BEARING — exceljs has not moved to a safe uuid on its own", () => {
  const ex = readJSON(join(ROOT, "node_modules", "exceljs", "package.json"));
  const declared = ex.dependencies?.uuid;
  assert.ok(declared, "exceljs no longer depends on uuid at all — DELETE the `uuid` override from "
    + "package.json and this file; the pin now constrains a dependency nobody has.");
  assert.ok(!atLeast(declared, FIXED_AT),
    `exceljs@${ex.version} now declares uuid@${declared}, which is already clear of the advisory. `
    + "The override in package.json is dead weight — remove it, re-resolve, and delete this file. "
    + "Nothing is broken; this arm exists to catch exactly this moment.");
});

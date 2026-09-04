// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// census-merge-driver.test.mjs —: the census merges by union, and REFUSES what is not its to pick.
//
// The driver exists because `driver/suite-census.json` must stay committed (only a persisted expectation
// notices a deleted test file) while two branches that both re-stamped it conflict — git merges lines,
// not JSON, and adjacency in a 687-key object is decided by filename.
//
// The three arms below are the three things a union driver can get wrong, and the last two matter more
// than the first: a driver that resolved everything would be the "census matching neither tree" failure
// this issue is named for, wearing a new costume.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "census-merge-driver.mjs");
const entry = (t, a) => ({ tests: t, asserts: a, skips: 0, todos: 0 });
const census = (perFile) => ({ _README: ["x"], workspaces: { driver: { ext: "mjs", perFile } }, rootScripts: {} });

/** Run the driver over three temp files the way git invokes it: %A %O %B, result written back to %A. */
function run(ours, base, theirs) {
  const d = mkdtempSync(join(tmpdir(), "census-merge-"));
  const p = { o: join(d, "ours.json"), b: join(d, "base.json"), t: join(d, "theirs.json") };
  writeFileSync(p.o, JSON.stringify(ours)); writeFileSync(p.b, JSON.stringify(base)); writeFileSync(p.t, JSON.stringify(theirs));
  const r = spawnSync(process.execPath, [DRIVER, p.o, p.b, p.t], { encoding: "utf8" });
  let merged = null;
  try { merged = JSON.parse(readFileSync(p.o, "utf8")); } catch { /* refused, and left it alone */ }
  rmSync(d, { recursive: true, force: true });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, merged };
}

test("#1827 two branches adding different files UNION — the conflict that cost five merges", () => {
  const base = census({ "a.test.mjs": entry(1, 2) });
  const ours = census({ "a.test.mjs": entry(1, 2), "b.test.mjs": entry(3, 9) });
  const theirs = census({ "a.test.mjs": entry(1, 2), "c.test.mjs": entry(5, 11) });
  const r = run(ours, base, theirs);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(Object.keys(r.merged.workspaces.driver.perFile).sort(),
    ["a.test.mjs", "b.test.mjs", "c.test.mjs"], "the union must carry both sides' additions");
});

test("#1827 BOTH sides changing one entry differently REFUSES — that is a disagreement, not a merge", () => {
  const base = census({ "a.test.mjs": entry(1, 2) });
  const ours = census({ "a.test.mjs": entry(7, 7) });
  const theirs = census({ "a.test.mjs": entry(99, 99) });
  const r = run(ours, base, theirs);
  assert.notEqual(r.code, 0, "a driver that silently picks a side here is the defect in a new costume");
  assert.match(r.out, /changed on BOTH sides/);
  assert.match(r.out, /a\.test\.mjs/, "it names the entry, so a human knows what to look at");
});

test("#1827 a DELETION survives the union — absent-because-removed is not absent-because-new", () => {
  // The whole reason the census is committed: a deleted test file vanishes from git, the glob and the
  // TAP output at once. A union that re-added it from the other side would restore the expectation for
  // a file that no longer exists, and the guard would then be green over a test nobody runs.
  const base = census({ "a.test.mjs": entry(1, 2) });
  const ours = census({ "a.test.mjs": entry(1, 2), "y.test.mjs": entry(2, 2) });   // untouched + added
  const theirs = census({ "z.test.mjs": entry(1, 1) });                            // a.test.mjs DELETED
  const r = run(ours, base, theirs);
  assert.equal(r.code, 0, r.out);
  const keys = Object.keys(r.merged.workspaces.driver.perFile).sort();
  assert.ok(!keys.includes("a.test.mjs"), `the deletion was undone by the union: ${JSON.stringify(keys)}`);
  assert.deepEqual(keys, ["y.test.mjs", "z.test.mjs"]);
});

test("#1827 an unreadable side REFUSES rather than treating it as empty", () => {
  const d = mkdtempSync(join(tmpdir(), "census-merge-"));
  const p = { o: join(d, "o.json"), b: join(d, "b.json"), t: join(d, "t.json") };
  writeFileSync(p.o, JSON.stringify(census({ "a.test.mjs": entry(1, 2) })));
  writeFileSync(p.b, JSON.stringify(census({})));
  writeFileSync(p.t, "{ this is not json");
  const r = spawnSync(process.execPath, [DRIVER, p.o, p.b, p.t], { encoding: "utf8" });
  rmSync(d, { recursive: true, force: true });
  assert.notEqual(r.status, 0, "an unreadable side read as empty would delete every entry it carried");
  assert.match(`${r.stdout}${r.stderr}`, /not the same thing/);
});

// THE ARM THE FIRST ONE COULD NOT BE. Arm 1 compares `Object.keys(...).sort()` — it normalises away the
// exact property this checks, and had to, because it is asking a different question (is the union
// complete). Order needs its own arm, and it needed one: the driver shipped without it and produced a
// census that was semantically perfect and still failed `--check`.
//
// WHY ORDER IS CORRECTNESS HERE. `mint-suite-census.mjs --check` compares the census byte for byte, and
// the minter writes keys in `git ls-files` order, which is sorted. A union built by walking ours and
// then theirs appends the other side's new files at the END of the map. The result reds the suite for a
// union that describes the merged tree exactly, and its diff summary says "no file added, removed,
// grown or shrunk" — because nothing was. The only way through is a re-mint, which is precisely the
// reflex that makes a real census failure get waved past.
test("#1827 the union emits keys in the minter's order, so --check does not fail on a correct merge", () => {
  // Ours carries the LATE half of the alphabet, theirs the EARLY half: a naive ours-then-theirs walk
  // produces exactly the wrong order, and one that happens to look right for any other input would not.
  const base = census({ "m.test.mjs": entry(1, 2) });
  const ours = census({ "m.test.mjs": entry(1, 2), "z.test.mjs": entry(3, 9) });
  const theirs = census({ "m.test.mjs": entry(1, 2), "a.test.mjs": entry(5, 11) });
  const r = run(ours, base, theirs);
  assert.equal(r.code, 0, r.out);

  const keys = Object.keys(r.merged.workspaces.driver.perFile);
  assert.deepEqual(keys, ["a.test.mjs", "m.test.mjs", "z.test.mjs"],
    "the other side's file landed out of sorted position — --check compares bytes, so this reds a "
    + `correct union. Got: ${keys.join(", ")}`);

  // A GROUP arriving from the other side lands in place too, for the same reason and by the same rule.
  const gBase = { _README: ["x"], workspaces: { driver: { ext: "mjs", perFile: {} } }, rootScripts: {} };
  const gOurs = { ...gBase, workspaces: { driver: { ext: "mjs", perFile: {} }, portal: { ext: "ts", perFile: {} } } };
  const gTheirs = { ...gBase, workspaces: { driver: { ext: "mjs", perFile: {} }, apps: { ext: "mjs", perFile: {} } } };
  const g = run(gOurs, gBase, gTheirs);
  assert.equal(g.code, 0, g.out);
  assert.deepEqual(Object.keys(g.merged.workspaces), ["apps", "driver", "portal"],
    "a workspace added on the other side lands last unless the group map is ordered too");
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The cut record's mode line is said once per process, and it names the mode the tree is in.
//
// `shared/withheld-paths-access.mjs` tells stderr, once, whether this tree carries the cut record and
// what that means for the three checks that read it. Nothing held that line: deleting it, or swapping
// the two modes' wording, passed every gate. Each case here runs in a child process, because the
// once-only latch lasts for a process and the runner's own modules may already have tripped it.
//
// The record-present mode cannot be reached in place, because no tree carries the record. So that case
// copies the module into a scratch directory beside a record written for the test: two made-up entries,
// nothing from any real list.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODULE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "shared", "withheld-paths-access.mjs");

// Import the module in a fresh process, ask for the mode line twice, and report what stderr carried.
function announceTwice(modulePath) {
  const src = `
    const m = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
    const first = m.announceWithheldMode();
    const second = m.announceWithheldMode();
    process.stdout.write(JSON.stringify({ present: m.CUT_RECORD_PRESENT, first, second, withheld: m.isWithheld("made-up-one.md") }));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], { encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stderr.split("\n").filter((l) => l.startsWith("[repo-guard]") && l.includes("cut record"));
  return { ...JSON.parse(r.stdout), lines };
}

test("this tree carries no cut record, and says so once, as the stricter mode and not as an alarm", () => {
  const r = announceTwice(MODULE);
  assert.equal(r.present, false, "a tree that carries the record needs this test rewritten, not relaxed");
  assert.equal(r.lines.length, 1, `said once, however often it is asked: ${JSON.stringify(r.lines)}`);
  assert.equal(r.lines[0], r.first, "stderr carries the line the function returns");
  assert.equal(r.second, r.first);
  assert.match(r.lines[0], /^\[repo-guard\] no cut record in this tree — nothing counts as withheld/);
  assert.match(r.lines[0], /STRICTER of the two modes: it cannot hide a defect/);
  assert.doesNotMatch(r.lines[0], /alarm/i,
    "the module cannot see whether the record ought to be here, so it does not call its absence an alarm");
  assert.equal(r.withheld, false);
});

test("a tree carrying the record says so once, with the number of entries it withholds", () => {
  const dir = mkdtempSync(join(tmpdir(), "cut-record-mode-"));
  try {
    mkdirSync(join(dir, "shared"));
    copyFileSync(MODULE, join(dir, "shared", "withheld-paths-access.mjs"));
    writeFileSync(join(dir, "shared", "withheld-paths.mjs"), [
      'export const WITHHELD = [{ path: "made-up-one.md" }, { path: "made-up-two.md" }];',
      "export const withheldEntryFor = (p) => WITHHELD.find((e) => e.path === p) ?? null;",
      "export const isWithheld = (p) => withheldEntryFor(p) !== null;",
      "",
    ].join("\n"));
    const r = announceTwice(join(dir, "shared", "withheld-paths-access.mjs"));
    assert.equal(r.present, true);
    assert.equal(r.withheld, true, "the record's answer comes through");
    assert.equal(r.lines.length, 1, `said once, however often it is asked: ${JSON.stringify(r.lines)}`);
    assert.equal(r.lines[0], r.first, "stderr carries the line the function returns");
    assert.equal(r.lines[0],
      "[repo-guard] cut record present — 2 withheld entry/entries; absences they cover are stated consequences");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

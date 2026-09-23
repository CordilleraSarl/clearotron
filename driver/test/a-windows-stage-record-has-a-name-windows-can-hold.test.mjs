// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NATIVE WINDOWS: EACH STAGE'S RECORD IS A FILE OF ITS OWN.
//
// A stage's label names its attempt log, its dispatch record and its input stamp, and many labels carry a
// colon: `register-unit:primary-sweep`. Windows does not refuse that name. NTFS reads it as a hidden stream
// of a file called `register-unit`, so the four register units' logs all land in that one file, reading
// one back by the same name appears to work, and the copy into an experiment's sandbox fails with EINVAL.
// Found by the Windows runner, 2026-09-23, when both engines' clearances failed at that copy.
//
// The last arm writes the records for real and LISTS the folder rather than reading a file back by name,
// because on Windows reading back by the colon name succeeds from the hidden stream. On Windows it proves
// the colon is written %3A; on Linux and macOS, that the names are exactly what they always were.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir, driverFileName } from "../../shared/driver-dir.mjs";
import { stageLog } from "../log.mjs";
import { recordDispatch } from "../dispatch-record.mjs";
import { writeStamp, readStamp } from "../stage-freshness.mjs";

test("on Windows a label's colon is written %3A; everywhere else the name is as it was", () => {
  assert.equal(driverFileName("register-unit:primary-sweep.jsonl", "win32"), "register-unit%3Aprimary-sweep.jsonl");
  assert.equal(driverFileName("common-law-half:a.attempt1.dispatch.txt", "win32"), "common-law-half%3Aa.attempt1.dispatch.txt");
  assert.equal(driverFileName("run.jsonl", "win32"), "run.jsonl");
  for (const platform of ["linux", "darwin"])
    assert.equal(driverFileName("register-unit:primary-sweep.jsonl", platform), "register-unit:primary-sweep.jsonl");
});

test("two register units' records are two files each, under names this machine can hold", () => {
  const run = mkdtempSync(join(tmpdir(), "stage-names-"));
  const labels = ["register-unit:primary-sweep", "register-unit:saturation-probe"];
  const recorded = [];
  for (const label of labels) {
    stageLog(run, label, { event: "attempt", attempt: 1 });
    recorded.push(recordDispatch(run, label, { attempt: 1, message: `the prompt for ${label}`, grant: [] }));
    writeStamp(run, label, []);
  }
  const top = readdirSync(driverDir(run)).sort();
  const expected = labels.flatMap((l) => [driverFileName(`${l}.jsonl`), driverFileName(`${l}.attempt1.dispatch.txt`)]);
  for (const name of expected) assert.ok(top.includes(name), `${name} is not in _driver/, which holds: ${top.join(", ")}`);
  assert.ok(!top.includes("register-unit"), "the records landed in one file called register-unit, as hidden streams of it");
  for (const [i, label] of labels.entries()) {
    assert.equal(recorded[i].present, true, `the dispatch record for ${label} was not written: ${recorded[i].error}`);
    assert.equal(recorded[i].file, `_driver/${driverFileName(`${label}.attempt1.dispatch.txt`)}`, "the record names a file that is not there");
  }
  const stamps = readdirSync(driverDir(run, "stage-inputs")).sort();
  assert.deepEqual(stamps, labels.map((l) => driverFileName(`${l}.json`)).sort());
  for (const label of labels) assert.equal(readStamp(run, label)?.label, label);
});

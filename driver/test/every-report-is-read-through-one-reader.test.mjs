// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY REPORT IS READ THROUGH ONE READER: THE READS EVERY REPORT MAKES, ONCE, THEN THE PRODUCT'S OWN LIST.
//
// The clearance and the Knockout each read a run from the top, and both spelled out the same reads: the report
// dates, the demo marking, the models that served the run, the saved logos, the frozen profile and the build. A
// third report shape would have copied them a third time. Now `readReportDocument` makes them once, and each
// product is its reading: its list of named reads, run in order, each handed what the reads before it found.
//
// What each reader returns is unchanged, and that is proved on the published files and on every reader call the
// publishing tests make, base against head. This file holds the structure: one entry, the shared reads in one
// place, and the order and hand-over the readings rely on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readReportDocument } from "../publish/read-document.mjs";
import { zurichStamp } from "../publish/report-dates.mjs";
import { CLEARANCE_READS } from "../publish/index.mjs";
import { KNOCKOUT_READS } from "../publish/knockout.mjs";

const PUBLISH = join(dirname(fileURLToPath(import.meta.url)), "..", "publish");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

// The calls only the shared reads make. A product file that makes one again has copied the frame.
const SHARED = ["resolveDemoData(", "servedModels(", "logosForReport(", "reportDates(", "engineCommit("];
const copiedIn = (src) => SHARED.filter((call) => code(src).includes(call));

test("both products read through the one entry, each as its own list of named reads", () => {
  for (const [file, reading, reads] of [["index.mjs", "CLEARANCE_READING", CLEARANCE_READS], ["knockout.mjs", "KNOCKOUT_READING", KNOCKOUT_READS]]) {
    const src = readFileSync(join(PUBLISH, file), "utf8");
    assert.match(src, new RegExp(`return readReportDocument\\(${reading}, `), `${file}'s reader reads through the one entry`);
    assert.ok(reads.length > 5, `${file} lists its reads`);
    assert.ok(reads.every((read) => typeof read === "function" && /^readThe|^readWhen/.test(read.name)), `each of ${file}'s reads is named`);
    assert.equal(new Set(reads).size, reads.length, `${file} lists no read twice`);
  }
});

test("the reads every report makes are made in one place, and neither product makes them again", () => {
  const frame = readFileSync(join(PUBLISH, "read-document.mjs"), "utf8");
  assert.deepEqual(copiedIn(frame), SHARED, "the shared reads are the frame's");
  for (const file of ["index.mjs", "knockout.mjs"]) {
    assert.deepEqual(copiedIn(readFileSync(join(PUBLISH, file), "utf8")), [], `${file} makes a shared read of its own`);
  }
  // PLANTED FAULT: a product that reads the demo marking itself is caught, and a mention in a comment is not.
  assert.deepEqual(copiedIn("  const demoData = resolveDemoData({ runDir, customerKey });"), ["resolveDemoData("]);
  assert.deepEqual(copiedIn("  // the demo answer is resolveDemoData(), in the frame"), []);
});

test("the reads run in order, each handed the shared reads and what the reads before it found", async () => {
  const pool = mkdtempSync(join(tmpdir(), "one-reader-pool-"));
  const runDir = mkdtempSync(join(tmpdir(), "one-reader-run-"));
  mkdirSync(join(runDir, "_driver"), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ startedAt: "2026-07-01T08:00:00.000Z", deliveredAt: "2026-07-01T09:15:00.000Z" }));
  writeFileSync(join(runDir, "_driver", "profile.json"), JSON.stringify({ organisation: "Example Org", platforms: [] }));
  const seen = [];
  const reading = (issuedZone) => ({
    base: ({ runDir: dir }) => dir,
    issuedZone,
    reads: [
      (r) => { seen.push(["first", r.issued, r.demoData, r.profile?.organisation, r.logos instanceof Map, r.runId]); return { a: 1, b: "first" }; },
      async (r) => { seen.push(["second", r.a, r.b]); return { b: "second" }; },
      (r) => { seen.push(["third", r.b]); return {}; },
    ],
    result: ({ a, b, dates, issued }) => ({ a, b, issuedAt: dates.issuedAt, issued }),
  });
  const input = { runId: "example-run-0001", runDir, poolRoot: pool, customerKey: null };
  // The zone's spelling is the runtime's (CEST, or GMT+2 on a build with less locale data); the time is the record's.
  const withZone = zurichStamp("2026-07-01T09:15:00.000Z", { zone: true });
  assert.match(withZone, /^2026-07-01 · 11:15 \S+$/, "premise: the stamp carries a zone");

  const zoned = await readReportDocument(reading(true), input);
  assert.deepEqual(seen, [
    ["first", withZone, false, "Example Org", true, "example-run-0001"],
    ["second", 1, "first"],
    ["third", "second"],
  ], "each read sees the shared reads, the caller's arguments and every earlier read's facts, in list order");
  assert.deepEqual(zoned, { a: 1, b: "second", issuedAt: "2026-07-01T09:15:00.000Z", issued: withZone },
    "a later read's fact replaces an earlier one's, and the reading's result is what the reader returns");

  seen.length = 0;
  const plain = await readReportDocument(reading(false), input);
  assert.equal(plain.issued, "2026-07-01 · 11:15", "a reading whose issue time carries no zone prints none");
});

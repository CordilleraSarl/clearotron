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
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir, driverFileName, labelOfDriverFile } from "../../shared/driver-dir.mjs";
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

test("a claim's lock file has a name Windows can hold, and an abandoned one is still read back", async () => {
  const { claimLockPath, sweepAbandonedTakeovers } = await import("../runner.mjs");
  assert.equal(claimLockPath("q/job.processing", "4242:1790164800000", "win32"), "q/job.processing.claimed-4242%3A1790164800000",
    "the lock kept the token's colon, so Windows refuses the rename and no queued job is ever claimed");
  assert.equal(claimLockPath("q/job.processing", "4242:1790164800000", "linux"), "q/job.processing.claimed-4242:1790164800000");
  const q = mkdtempSync(join(tmpdir(), "claim-lock-"));
  writeFileSync(join(q, "job.processing.claimed-4242%3A1790164800000"), "{}");
  const seen = [];
  sweepAbandonedTakeovers(q, { isAlive: (rec) => { seen.push(rec); return false; } });
  assert.deepEqual(seen, [{ pid: 4242, starttime: "1790164800000" }], "the Windows lock's token was not read back as the claimer");
  assert.deepEqual(readdirSync(q), ["job.processing"], "an abandoned Windows lock was not restored to the queue");
});

test("a record's file name reads back as the stage it was written for, whichever machine wrote it", () => {
  assert.equal(labelOfDriverFile("register-unit%3Aincumbent-class.jsonl"), "register-unit:incumbent-class",
    "a record written on Windows was counted under a stage named register-unit%3Aincumbent-class");
  assert.equal(labelOfDriverFile("register-unit:incumbent-class.jsonl"), "register-unit:incumbent-class");
  assert.equal(labelOfDriverFile("register-digest.jsonl"), "register-digest");
  assert.equal(labelOfDriverFile(driverFileName("common-law-half:a.jsonl", "win32")), "common-law-half:a");
});

test("a stop removes only the folders its record made, however the machine spells them", async () => {
  const { madeChain } = await import("../../shared/running-start.mjs");
  const home = mkdtempSync(join(tmpdir(), "made-chain-"));
  const dir = join(home, ".config", "clearotron", "running");
  const made = join(home, ".config");
  // The machine spells the made folder its own way (on Windows, the long name of a short-named temp folder).
  const realpath = (p) => (p === made ? join(home, "LONG", ".config") : p.replace(home, join(home, "LONG")));
  assert.deepEqual(madeChain(dir, made, { realpath }), [dir, join(home, ".config", "clearotron"), made],
    "the folders the record made were not the ones the stop would remove");
  assert.deepEqual(madeChain(dir, join(home, "elsewhere"), { realpath: (p) => p }), [],
    "a record outside the folder that was made would have had folders above it removed");
  assert.deepEqual(madeChain(dir, undefined), [], "a record whose folders were all there already removed some");
});

// THE CLASS, not the two that failed. A fixture that reaches into `_driver/` by hand instead of through
// driverDir or driverRel writes a stage label's colon raw. On Linux that is the same path, so the test
// passes and nothing says otherwise; on Windows NTFS takes it as a hidden stream of the name before the
// colon, the reader's directory walk never lists it, and the test fails for a reason its own text cannot
// explain. Two did, on main, on 2026-09-26: the run-record reader read no code step, and the audit
// workbook read no failed card. Both were fixture defects; the product had been right since 2026-09-23.
const ROOTS = ["driver/test/*", "providers/*/test/*", "mcp-server/test/*", "portal-ui/test/*"];

/** A tracked path against one of those pathspecs, reading `*` as git does: one path segment. */
function matchesRoot(file, spec) {
  const parts = spec.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("^" + parts.join("[^/]*")).test(file);
}

// The two shapes that write a stage label's colon raw into `_driver/`. Built from pieces rather than
// written as literals, because the pieces are what the comment below is about.
const QUOTE = "[\"'`]";                                   // a JS string of any kind
const NOT_QUOTE = "[^\"'`\\n]*";                             // …its contents, up to its closing quote
const COLON_NAME = "[a-z0-9-]+:[a-z0-9${}._-]+\\.(?:jsonl|json|txt)";   // register-unit:primary-sweep.jsonl
const HAND_BUILT = [
  // a literal `_driver/…` whose name carries a colon
  new RegExp(QUOTE + "_driver\\/" + NOT_QUOTE + COLON_NAME, "i"),
  // a `join(…, "_driver", …)` whose arguments carry one
  new RegExp("join\\([^)\\n]*" + QUOTE + "_driver" + QUOTE + "[^)\\n]*" + COLON_NAME, "i"),
];

// THE CLASS, not the two that failed. A fixture that reaches into `_driver/` by hand instead of through
// driverDir or driverRel writes a stage label's colon raw. On Linux that is the same path, so the test
// passes and nothing says otherwise; on Windows NTFS takes it as a hidden stream of the name before the
// colon, the reader's directory walk never lists it, and the test fails for a reason its own text cannot
// explain. Two did, on main, on 2026-09-26: the run-record reader read no code step, and the audit
// workbook read no failed card. Both were fixture defects; the product had been right since 2026-09-23.
//
// IT MATCHES THE CONSTRUCTION, NOT A LINE THAT MENTIONS BOTH. An earlier form of this arm exempted any
// line carrying a helper call, and a genuine hand-built write hid behind an unrelated `driverRel(` on the
// same line. The two shapes above cannot match a name handed to driverDir, driverRel or driverFileName,
// because those compose the directory themselves and no `_driver` literal sits beside the name — so no
// exemption is needed, and there is none to hide behind.
test("no test fixture writes a _driver artefact whose stage label keeps a raw colon", (ctx) => {
  const GUARD = "windows-safe _driver fixtures";
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const files = trackedFiles(GUARD, { root, pathspec: ROOTS });
  // A bare `return` here would score as a PASS having measured nothing, which is the one thing this
  // arm may not do. Off a checkout it SKIPS, loudly, and the run says so.
  if (files === null) return ctx.skip(skipReason(GUARD));
  // EVERY ROOT SEPARATELY, because a total cannot see a lost one: driver/test alone is over a thousand
  // files, so any floor on the sum is met by that root while the other three return nothing — which is
  // what a mistyped pathspec looks like, and it would read as a clean sweep of a tree nobody searched.
  for (const spec of ROOTS)
    assert.ok(files.some((f) => matchesRoot(f, spec)), `${spec} matched no tracked file, so this sweep did not cover it`);

  const offenders = [];
  for (const rel of files) {
    readFileSync(join(root, rel), "utf8").split("\n").forEach((line, i) => {
      if (HAND_BUILT.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], "write these through driverDir or driverRel, which spell the colon %3A on Windows");
});

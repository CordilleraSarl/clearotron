// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// TWO EMPTY CATCHES THAT HID A FAILURE WHICH CHANGES A RUN, from a reading of every empty catch in the pipeline and its
// steps (2026-11-19). The case-law join was caught at five call sites as "no case-law layer", so a join that failed on a
// case-law file that was there read as a run with none: the join now records the failure before it throws, and each caller
// carries on as before. The digest queue was caught as "no queue on disk", so a queue that was there and did not read was
// taken as nothing owed and the digest stamps were reconciled as fresh: such a queue now keeps the digest stale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";

const { caseLawJoin, reconcilePassStamps } = await import("../pipeline.mjs");
const { writeStamp, readStamp } = await import("../stage-freshness.mjs");

const runDir = () => { const d = mkdtempSync(join(tmpdir(), "swallowed-")); mkdirSync(driverDir(d), { recursive: true }); return d; };
const journal = (d) => existsSync(driverDir(d, "run.jsonl")) ? readFileSync(driverDir(d, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

test("a case-law join that fails on a file that is there is recorded before it throws", () => {
  const d = runDir();
  try {
    // A folder where the case-law file should be: it exists, and reading it fails.
    const P = { runDir: d, caseLaw: join(d, "case-law.md") };
    mkdirSync(P.caseLaw);
    assert.throws(() => caseLawJoin(P, []), "the caller's own catch still sees the failure");
    const row = journal(d).find((e) => e.event === "case-law-join-failed");
    assert.ok(row, "the failure left no record");
    assert.match(row.error, /EISDIR|directory/i);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a case-law join that works records nothing", () => {
  const d = runDir();
  try {
    const P = { runDir: d, caseLaw: join(d, "case-law.md") };
    writeFileSync(P.caseLaw, "# Case law\n\nNo decisions found for this mark.\n");
    caseLawJoin(P, []);
    assert.equal(journal(d).some((e) => e.event === "case-law-join-failed"), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a digest queue that is there and does not read keeps the digest stale; with no queue the stamp is reconciled", () => {
  for (const [queue, staysStale] of [["{ torn", true], [null, false]]) {
    const d = runDir();
    try {
      const input = join(d, "band.json");
      writeFileSync(input, "[1]\n");
      writeStamp(d, "register-digest:primary-sweep", [input]);
      writeFileSync(input, "[1, 2]\n");   // the stamp is now stale against its input
      const P = { runDir: d, digestQueue: driverDir(d, "digest-queue.json") };
      if (queue !== null) writeFileSync(P.digestQueue, queue);
      reconcilePassStamps({ paths: P }, { paths: P });
      const stamp = readStamp(d, "register-digest:primary-sweep");
      assert.equal(stamp?.reconciledAt === undefined, staysStale,
        staysStale ? "an unreadable queue let the digest stamp be reconciled as though nothing were owed"
          : "with no queue the stamp was not reconciled, so this arm proves nothing");
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
});

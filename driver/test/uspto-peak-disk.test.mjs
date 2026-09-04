// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — THE SAMPLER HAS TO SURVIVE A BLOCKED EVENT LOOP, OR IT MEASURES THE WRONG NINE HOURS ──────
//
// The peak disk a US index build reaches was never recorded, and the reason is mechanical: the WAL is
// the part that grows, and the last `db.close()` checkpoints it and deletes it. So it has to be sampled
// while the build runs — and the phase that peaks is `rebuildFts`, one synchronous SQLite transaction
// over every row in the index, which blocks this thread from first row to last.
//
// The first test below is the whole reason the sampler is a worker. It demonstrates the bug rather than
// asserting the fix: the same growth, watched two ways, over one blocked interval. An in-process timer
// records NOTHING and would have reported the calm before the peak as the maximum.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  measureFootprint, indexFootprintPaths, startPeakDiskSampler, peakSummaryLines, peakAtPhaseLine,
  peakMovedLine, INDEX_SIDECARS,
} from "../../shared/uspto-peak-disk.mjs";
import {
  USPTO_PEAK_GB, USPTO_PEAK_WAL_GB, USPTO_INDEX_GB, USPTO_LARGEST_PART_GB, usptoProvisionGB,
} from "../../shared/uspto-index-size.mjs";

const dirs = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), "uspto-peak-")); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => {
  const stop = Date.now() + ms;
  while (Date.now() < stop) { if (fn()) return true; await sleep(20); }
  return false;
};

test("#840 the sampler records a peak that happens while the event loop is blocked; a timer records none", async () => {
  const dir = scratch();
  const db = join(dir, "idx.sqlite");
  writeFileSync(db, Buffer.alloc(1e6));

  const sampler = startPeakDiskSampler(db, { intervalMs: 25, quiet: true });
  try {
    assert.ok(await until(() => sampler.read().samples > 0, 5000),
      "the sampling worker never took a sample — the rest of this test would prove nothing");

    // The in-process comparison. Same interval, same paths, started before the block.
    let timerSamples = 0;
    let timerPeak = 0;
    const timer = setInterval(() => { timerSamples++; timerPeak = Math.max(timerPeak, measureFootprint(db).total); }, 25);

    // A separate PROCESS grows the WAL 250 ms from now, so the growth lands inside the block below.
    // A timer here could not schedule it — that is the point.
    const child = spawn(process.execPath, ["-e",
      `setTimeout(()=>require("fs").writeFileSync(${JSON.stringify(`${db}-wal`)}, Buffer.alloc(5e6)), 250)`,
    ], { stdio: "ignore" });
    // Awaited so the block below is not racing the fork itself on a loaded box.
    await new Promise((r) => child.once("spawn", r));

    // Block the way rebuildFts blocks: no await, no timer, nothing yields.
    const stop = Date.now() + 2000;
    while (Date.now() < stop) { /* spin */ }

    // Read BOTH before yielding — a single await here would let the queued timer callbacks run and
    // paper over exactly the failure this test exists to show.
    const worker = sampler.read();
    const timerSamplesDuringBlock = timerSamples;
    const timerPeakDuringBlock = timerPeak;
    clearInterval(timer);
    child.kill();

    assert.equal(timerSamplesDuringBlock, 0,
      "the in-process timer fired during a blocked event loop — this test's premise is wrong");
    assert.equal(timerPeakDuringBlock, 0, "the in-process sampler recorded a peak it could not have seen");

    assert.ok(worker.samples > 10, `the worker took ${worker.samples} samples across the block, expected many`);
    assert.ok(worker.peak >= 6e6,
      `the worker's peak was ${worker.peak} bytes; the 1 MB index plus the 5 MB WAL written during the `
      + `block should have put it over 6 MB. It sampled through the block or it did not.`);
    assert.ok(worker.wal >= 5e6, `the peak's WAL component was ${worker.wal} bytes, expected the 5 MB just written`);
  } finally {
    await sampler.stop();
  }
});

test("#840 the footprint is the index AND its sidecars, and a missing one is zero rather than an error", () => {
  const dir = scratch();
  const db = join(dir, "idx.sqlite");

  const before = measureFootprint(db);
  assert.deepEqual({ ...before }, { total: 0, db: 0, wal: 0, files: 0 },
    "an index that does not exist yet must measure zero and say it saw no files");

  writeFileSync(db, Buffer.alloc(2000));
  writeFileSync(`${db}-wal`, Buffer.alloc(3000));
  writeFileSync(`${db}-shm`, Buffer.alloc(500));
  const m = measureFootprint(db);
  assert.equal(m.total, 5500, "the -shm is part of what the build holds on disk and is counted");
  assert.equal(m.db, 2000);
  assert.equal(m.wal, 3000);
  assert.equal(m.files, 3);

  assert.deepEqual(indexFootprintPaths(db), [db, ...INDEX_SIDECARS.map((s) => `${db}${s}`)]);
});

test("#840 a sampler that saw nothing refuses to report a peak, rather than reporting zero", () => {
  const dbPath = "/nowhere/idx.sqlite";

  // Thousands of samples, every one of them zero bytes: the sampler was aimed at a path this build does
  // not write. "0.00 GB" would read as a measurement, which is the failure this repo has paid for.
  const blind = peakSummaryLines(
    { peak: 0, db: 0, wal: 0, samples: 4000, sightings: 0, intervalMs: 1000 }, { dbPath });
  assert.equal(blind.length, 1);
  assert.match(blind[0], /NO high-water mark/);
  assert.doesNotMatch(blind.join(" "), /PEAK/);

  const never = peakSummaryLines({ peak: 0, db: 0, wal: 0, samples: 0, sightings: 0, intervalMs: 1000 }, { dbPath });
  assert.match(never[0], /took no samples/);
  assert.doesNotMatch(never.join(" "), /PEAK/);

  const absent = peakSummaryLines(null, { dbPath });
  assert.match(absent[0], /recorded no high-water mark/);

  const broken = peakSummaryLines(
    { peak: 0, db: 0, wal: 0, samples: 3, sightings: 3, intervalMs: 1000, error: "worker died" }, { dbPath });
  assert.match(broken[0], /failed \(worker died\).*NO high-water mark/);
});

test("#840 a sampler that saw something states the peak, its parts, and what one archive adds", () => {
  const lines = peakSummaryLines(
    { peak: 12.4e9, db: 10.1e9, wal: 2.3e9, samples: 32_000, sightings: 31_990, intervalMs: 1000 },
    { dbPath: "/mnt/x/idx.sqlite", largestPartBytes: 0.29e9 },
  ).join("\n");

  assert.match(lines, /PEAK 12\.40 GB/);
  assert.match(lines, /10\.10 GB index \+ 2\.30 GB wal/);
  assert.match(lines, /32,000 samples taken every 1s/);
  // The preflight charges for the index growth PLUS one archive; the log states the same sum so the two
  // can be compared without arithmetic.
  assert.match(lines, /290\.0 MB/);
  assert.match(lines, /about 12\.69 GB/);
  // Never claim more precision than a sampled maximum has.
  assert.match(lines, /not a guaranteed one/);
});

test("#840 the phase lines attribute the peak to ingest or to the FTS rebuild, and say nothing when blind", () => {
  const seen = { peak: 12.4e9, db: 10.1e9, wal: 2.3e9, samples: 100, sightings: 100, intervalMs: 1000 };
  assert.match(peakAtPhaseLine("ingest", seen), /before the FTS rebuild/);
  assert.match(peakAtPhaseLine("fts", seen), /FTS indexes rebuilt/);
  assert.match(peakAtPhaseLine("fts", seen), /12\.40 GB/);

  assert.equal(peakAtPhaseLine("ingest", { peak: 0, samples: 400, sightings: 0 }), null,
    "a phase line for a sampler that has seen nothing would report 0.00 GB as if it were measured");
  assert.equal(peakAtPhaseLine("ingest", null), null);
});

test("#840 a small build reads in its own units — never '0.00 GB', which is what a blind sampler looks like", () => {
  // The same code runs a 41 GB build and a 33 MB nightly top-up. Fixed GB units print a real
  // measurement in the exact shape of a sampler that saw nothing, and the two must never look alike.
  const small = peakSummaryLines(
    { peak: 193_512, db: 4096, wal: 156_600, samples: 3, sightings: 3, intervalMs: 1000 },
    { dbPath: "/tmp/i.sqlite" },
  ).join("\n");
  assert.match(small, /PEAK 193\.5 kB/);
  assert.doesNotMatch(small, /0\.00 GB/);
});

test("#840 what the reader is told to provision covers the PEAK, not just the finished index", () => {
  // The three quantities are the download, the peak and the steady state, and until the middle one
  // was inferred. It is the one the provisioning advice has to clear: a box sized for the 10.1 GB index
  // that fills during the FTS rebuild leaves the partial index the whole preflight exists to prevent.
  const needed = (USPTO_PEAK_GB + USPTO_LARGEST_PART_GB) * 1e9;
  assert.ok(usptoProvisionGB() * 1e9 >= needed,
    `INSTALL.md tells the reader to provision ${usptoProvisionGB()} GB, and the measured peak plus one `
    + `archive part is ${(needed / 1e9).toFixed(2)} GB. The advice must cover the peak that was measured.`);

  assert.ok(USPTO_PEAK_GB >= USPTO_INDEX_GB,
    "the peak cannot be under the steady state — the file it ends at is part of what it held at the peak");
  assert.equal(USPTO_PEAK_GB, Math.round((USPTO_INDEX_GB + USPTO_PEAK_WAL_GB) * 10) / 10,
    "the peak is the index plus its WAL, derived from both so it cannot drift from either");
});

test("#840 the line written when the mark moves carries the figure a later reader needs", () => {
  const line = peakMovedLine({ total: 12.4e9, db: 10.1e9, wal: 2.3e9, samples: 900 });
  assert.match(line, /^disk: index high-water 12\.40 GB \(10\.10 GB index \+ 2\.30 GB wal\)/);
  assert.match(line, /\d{4}-\d{2}-\d{2}T/, "the timestamp is what places the peak inside the build");
});

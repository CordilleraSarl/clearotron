// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── WHAT THE US INDEX BUILD HOLDS ON DISK WHILE IT RUNS ──────────────────────────────────────
//
// Three quantities, and `shared/uspto-index-size.mjs` names them: the DOWNLOAD decides your patience,
// the INDEX decides what you provision for, and the PEAK — the most that is on disk at once during the
// build — decides whether it finishes at all. The first two have been measured off a complete build.
// The peak had not, because nothing was watching while it happened: SQLite's write-ahead log is the
// part that moves, and by the time anyone reads the directory the last `db.close()` has checkpointed
// the WAL and DELETED it. The evidence destroys itself on the way out, which is why nine hours of
// build left a 0-byte `-wal` behind and no record of what it had been.
//
// This file is the watcher. It samples the index and its sidecars while the build runs and keeps the
// high-water mark, so the NEXT complete build answers the question without anyone planning to.
//
// ── WHY A WORKER THREAD AND NOT setInterval ─────────────────────────────────────────────────────────
//
// This is the whole design and getting it wrong produces a confident wrong answer rather than an
// error. `node:sqlite` is SYNCHRONOUS: `db.exec("INSERT INTO mark_fts(mark_fts) VALUES('rebuild')")`
// blocks the event loop from first row to last. An in-process timer cannot fire while that runs, so a
// `setInterval` sampler measures every idle moment of the build and none of the busy ones — and the
// busy one IS the peak, because an FTS5 rebuild is a single transaction whose dirty pages cannot be
// checkpointed out of the WAL until it commits. The sampler would report the calm before it and call
// that the maximum.
//
// A worker thread has its own event loop and its own thread, so it keeps sampling while the main
// thread is inside SQLite. It publishes into a SharedArrayBuffer rather than posting messages, because
// a message from a worker is delivered on the MAIN thread's event loop — the one that is blocked — so
// the reading would arrive only after the phase it describes had ended.
//
// The same reasoning applies to the log lines: the worker writes them to fd 1 directly rather than
// through `process.stdout`, whose worker-side writes are piped through the main thread and would queue
// behind the block.

import { statSync, writeSync } from "node:fs";
import { isMainThread, workerData, Worker } from "node:worker_threads";

/**
 * Everything SQLite keeps beside the index, and the reason each one is here.
 *
 * `-wal` is the quantity this file exists for. `-shm` is the WAL's own index and grows WITH it —
 * 32 KB beside the finished register, 15.9 MB beside an 8 GB WAL — so it is counted rather than waved
 * off as a fixed small file. `-journal` is the rollback journal: `openIndex` sets WAL mode, so it
 * should never appear, and if it ever does the number must not silently exclude it.
 */
export const INDEX_SIDECARS = Object.freeze(["-wal", "-shm", "-journal"]);

/** The paths one index occupies. Ordered: the database first, then its sidecars. */
export const indexFootprintPaths = (dbPath) => [dbPath, ...INDEX_SIDECARS.map((s) => `${dbPath}${s}`)];

/**
 * What the index costs on disk RIGHT NOW.
 *
 * A missing file counts as zero and is NOT an error — SQLite creates the WAL when the first write
 * transaction opens and removes it on the last close, so absence is the normal state at both ends of a
 * build. `files` is returned so a caller can tell "nothing there yet" from "nothing there ever", which
 * is the difference between a build that has not started and a sampler aimed at the wrong path.
 */
export function measureFootprint(dbPath) {
  let total = 0;
  let db = 0;
  let wal = 0;
  let files = 0;
  for (const path of indexFootprintPaths(dbPath)) {
    const st = statSync(path, { throwIfNoEntry: false });
    if (!st?.isFile()) continue;
    files++;
    total += st.size;
    if (path === dbPath) db = st.size;
    else if (path.endsWith("-wal")) wal = st.size;
  }
  return { total, db, wal, files };
}

// The shared cells. BigInt64Array because a peak is measured in bytes and a build is measured in tens
// of gigabytes — a 32-bit cell would wrap at 2.1 GB, which is under the WAL this is here to record.
const SLOT = Object.freeze({ TOTAL: 0, DB: 1, WAL: 2, SAMPLES: 3, SIGHTINGS: 4, LOGGED: 5 });
const SLOTS = 6;

/** Sampled every second. A build is hours long and a stat of four paths costs nothing at that rate. */
export const PEAK_SAMPLE_INTERVAL_MS = 1000;

// A new peak is only worth a log line if it MOVED. One line per second over a nine-hour build is 32,000
// lines of noise around the handful that matter; these thresholds keep the growth curve and drop the
// tremor. The first sighting always prints.
const LOG_STEP_BYTES = 64e6;
const LOG_STEP_FRACTION = 1.05;

// SCALED, and that is not cosmetic. A full build peaks in gigabytes, but the same code runs on a
// nightly top-up of 33 MB and on a one-file `--from-file`, where a fixed GB unit prints "PEAK 0.00 GB"
// — a real measurement wearing the exact shape of a sampler that saw nothing. The two must not look
// alike, because one of them means the instrument is broken.
const size = (n) => (
  n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB`
    : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB`
      : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kB`
        : `${n} bytes`);

/** The line the sampler writes when the high-water mark moves. Pure, so a test can read it. */
export const peakMovedLine = ({ total, db, wal, samples }) =>
  `disk: index high-water ${size(total)} (${size(db)} index + ${size(wal)} wal) at ${new Date().toISOString()}`
  + ` — sample ${samples}`;

/**
 * What to print about the peak once the build is over.
 *
 * RETURNS AN ARRAY OF LINES, and the first job of the first line is to refuse to state a figure it does
 * not have. A sampler that took no samples, or that took thousands and saw zero bytes in every one of
 * them, has established nothing — and "0.0 GB" is the shape that reads as an answer. That is the class
 * of bug this repo keeps paying for: a zero taking the success path.
 *
 * `largestPartBytes` is the download path's other charge — one archive lands beside the index and is
 * deleted after it is ingested — so stating it here lets a reader compare the log against the
 * arithmetic in `usptoDiskNeededBytes` without doing the addition themselves.
 */
export function peakSummaryLines(reading, { dbPath, largestPartBytes = 0 } = {}) {
  if (!reading) {
    return [`disk: nothing sampled this build's disk use, so it recorded no high-water mark.`];
  }
  if (reading.error) {
    return [`disk: the peak sampler failed (${reading.error}). NO high-water mark was recorded for this build.`];
  }
  if (!reading.samples) {
    return [`disk: the peak sampler took no samples — NO high-water mark was recorded for this build.`];
  }
  if (!reading.sightings) {
    return [
      `disk: the peak sampler read ${reading.samples.toLocaleString()} samples of ${dbPath} and every one was`
      + ` zero bytes, so it was watching a path this build does not write. NO high-water mark for this build.`,
    ];
  }
  const lines = [
    `disk: PEAK ${size(reading.peak)} held at once by the index and its sidecars`
    + ` (${size(reading.db)} index + ${size(reading.wal)} wal at that moment),`
    + ` the largest of ${reading.samples.toLocaleString()} samples taken every ${reading.intervalMs / 1000}s.`,
  ];
  if (largestPartBytes) {
    lines.push(
      `disk: plus one downloaded archive at a time, largest ${size(largestPartBytes)} —`
      + ` so this build's high-water mark on the index filesystem was about ${size(reading.peak + largestPartBytes)}.`,
    );
  }
  lines.push(
    `disk: a sampled maximum, not a guaranteed one — the WAL can rise and fall between two samples.`,
  );
  return lines;
}

/**
 * Where the high-water mark stood as one phase of the build ended. Null when the sampler has seen
 * nothing, because a phase line reading 0.00 GB would be read as a measurement.
 *
 * TWO OF THESE ARE WHAT ATTRIBUTE THE PEAK. The ingest loop and the FTS rebuild are the two things a
 * build does, and they fail differently: ingest writes in small committed batches whose WAL is
 * checkpointed away as it goes, while `rebuildFts` is one transaction over every row in the index and
 * cannot checkpoint until it commits. A reader comparing the line after ingest with the line after the
 * rebuild can see which of the two set the mark, without re-running nine hours to find out.
 */
export function peakAtPhaseLine(phase, reading) {
  if (!reading?.sightings) return null;
  const what = phase === "ingest" ? "with every file ingested, before the FTS rebuild"
    : phase === "fts" ? "with the FTS indexes rebuilt"
      : `after ${phase}`;
  return `disk: high-water ${size(reading.peak)} ${what}`
    + ` (${size(reading.db)} index + ${size(reading.wal)} wal at that moment).`;
}

/**
 * Start watching an index's disk footprint. Returns a handle whose `read()` is safe to call at any
 * time, INCLUDING immediately after a synchronous SQLite call that blocked the event loop for minutes:
 * the value is written by the worker into shared memory, so it does not wait on a message queue.
 *
 * Throws if the worker cannot start. It is the caller's job to SAY so — a build that quietly stops
 * recording its peak is how the figure went unmeasured the first time.
 */
export function startPeakDiskSampler(dbPath, { intervalMs = PEAK_SAMPLE_INTERVAL_MS, quiet = false } = {}) {
  const shared = new SharedArrayBuffer(SLOTS * 8);
  const cells = new BigInt64Array(shared);
  let failure = null;
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { usptoPeakDisk: { dbPath, intervalMs, shared, quiet } },
  });
  // Never keep the process alive: the build's own completion decides when this stops, and a sampler
  // that outlived it would hold a finished CLI open forever.
  worker.unref();
  worker.on("error", (e) => { failure = e?.message ?? String(e); });

  return {
    dbPath,
    intervalMs,
    /**
     * Fold one sample taken HERE, on the caller's thread. For the moments the caller knows it is not
     * inside SQLite — before the build, between files, after each phase — so a build shorter than the
     * worker's own start-up still records a figure instead of reporting that it saw nothing.
     */
    sample() { foldSample(cells, dbPath); },
    /**
     * The high-water mark so far. `db` and `wal` are the components AT the moment the peak was set,
     * not their own maxima — a peak with a breakdown that never co-occurred would be a fiction.
     */
    read() {
      return {
        peak: Number(Atomics.load(cells, SLOT.TOTAL)),
        db: Number(Atomics.load(cells, SLOT.DB)),
        wal: Number(Atomics.load(cells, SLOT.WAL)),
        samples: Number(Atomics.load(cells, SLOT.SAMPLES)),
        sightings: Number(Atomics.load(cells, SLOT.SIGHTINGS)),
        intervalMs,
        error: failure,
      };
    },
    async stop() { await worker.terminate(); },
  };
}

/**
 * Take one sample and fold it into the shared high-water mark. Called on the worker's thread every
 * interval, and on the MAIN thread at the few moments it is known not to be inside SQLite — a build
 * that finishes before the worker has finished booting would otherwise record nothing at all, which is
 * the ordinary nightly top-up.
 */
function foldSample(cells, dbPath) {
  const { total, db, wal, files } = measureFootprint(dbPath);
  Atomics.add(cells, SLOT.SAMPLES, 1n);
  if (files) Atomics.add(cells, SLOT.SIGHTINGS, 1n);
  const mine = BigInt(total);
  // Components first, total last: a reader that loads the total and then the components can only ever
  // pair a total with components from the SAME sample or a larger later one, never with a smaller
  // earlier one.
  //
  // The total moves by compare-and-swap because TWO threads fold into these cells — the worker every
  // interval and the caller at the moments it knows it is idle. Load-then-store would let the smaller
  // of two concurrent samples land last and drop the high-water mark; a mark that can go DOWN is not
  // one.
  for (;;) {
    const prev = Atomics.load(cells, SLOT.TOTAL);
    if (mine <= prev) return null;
    Atomics.store(cells, SLOT.DB, BigInt(db));
    Atomics.store(cells, SLOT.WAL, BigInt(wal));
    if (Atomics.compareExchange(cells, SLOT.TOTAL, prev, mine) === prev) return { total, db, wal };
  }
}

/** The worker half. Runs only in the thread `startPeakDiskSampler` spawned, never on import. */
function runSampler({ dbPath, intervalMs, shared, quiet }) {
  const cells = new BigInt64Array(shared);
  const tick = () => {
    const moved = foldSample(cells, dbPath);
    if (!moved || quiet) return;
    const { total, db, wal } = moved;
    const logged = Number(Atomics.load(cells, SLOT.LOGGED));
    if (logged && total < logged + LOG_STEP_BYTES && total < logged * LOG_STEP_FRACTION) return;
    Atomics.store(cells, SLOT.LOGGED, BigInt(total));
    try {
      // Straight to the file descriptor. `process.stdout` in a worker is piped through the main thread,
      // which is exactly the thread blocked inside SQLite during the phase worth logging.
      writeSync(1, `${peakMovedLine({ total, db, wal, samples: Number(Atomics.load(cells, SLOT.SAMPLES)) })}\n`);
    } catch { /* a full or non-blocking stdout must not stop the measurement; the shared cells carry it */ }
  };
  // Sample once immediately, so a build that dies in its first second still recorded something.
  tick();
  // NOT unref'd: this timer is the only thing keeping the worker's event loop alive, and the worker is
  // ended by the parent's terminate() rather than by running out of work.
  setInterval(tick, intervalMs);
}

if (!isMainThread && workerData?.usptoPeakDisk) runSampler(workerData.usptoPeakDisk);

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── WHAT A US REGISTER INDEX COSTS — ONE SOURCE, THREE DIFFERENT QUANTITIES ──────────────────
//
// This is the free tier's entry cost: the number a stranger uses to decide whether they can run this
// at all. It had four published values, three of them in tension, two of them sixty lines apart in the
// same section of INSTALL.md — "steady state ~1 GB index" against "tens of gigabytes, not one".
//
// The reason it drifted is that THREE DIFFERENT QUANTITIES were being used interchangeably:
//
//   the download   how many bytes come off the USPTO bulk endpoint    — decides your patience
//   the peak       the most that is on disk at once during the build  — decides whether it finishes
//   the index      what is still there when it is done                — decides what you provision for
//
// Naming them separately is most of the fix. Everything below is exported so `bin/uspto-sync.mjs`,
// `bin/onboard.mjs` and INSTALL.md agree BY CONSTRUCTION — `driver/test/uspto-index-size.test.mjs`
// fails when the document and these constants disagree, which is what stops a fifth figure appearing.
//
// ── PROVENANCE: ONE COMPLETE BUILD, MEASURED END TO END ─────────────────────────────────────────────
//
// Test box, finished 2026-08-11 20:56. `full pull, 1884-01-01 → 2026-08-11`; 767 files listed and 767
// ingested, 177 from the TRTYRAP backfile and 590 dailies, no error and no skip in the log. So this is
// the complete article — not a dailies-only build, which looks identical on every other number and is
// missing a century.
//
//   archives read      41.5 GB       (sync.log: "767 file(s), 41.5 GB")
//   wall clock         32,624.9 s    (9.06 h → 4.58 GB/h)
//   index on disk      10,087,542,784 bytes = 10.09 GB
//   records            14,248,452 in the index, from 49,647,671 ingested (dailies re-state marks)
//
// The previous figures were extrapolated from the FIRST 11 BACKFILE PARTS, where the index grows about
// 0.91 bytes per archive byte, and INSTALL.md separately claimed 0.70 "over the first third". Over a
// whole build the true ratio is 0.24: the backfile front-loads distinct marks and the 590 dailies that
// follow mostly re-state marks already indexed. An early sample cannot see that and always reads high.
export const USPTO_ARCHIVE_GB = 41.5;
export const USPTO_INDEX_GB = 10.1;
export const USPTO_INGEST_GB_PER_HOUR = 4.6;
export const USPTO_LARGEST_PART_GB = 0.29;

// The nightly top-up is the one published figure that survived contact with a measurement: the mean of
// all 587 dated daily parts in that build is 33.1 MB. Stated because a reader deciding on the free tier
// is choosing an ongoing cost as well as a one-off one.
export const USPTO_DAILY_TOPUP_MB = 33;

// ── THE PEAK, NO LONGER INFERRED ─────────────────────────────────────────────────────────────
//
// The most on disk at once, which is the quantity `assertRoomToIngest` exists to protect and the one
// could not read. It is not readable after the fact: the WAL is the part that moves, and the last
// `db.close()` checkpoints it and DELETES it, so a finished build leaves a 0-byte `-wal` and no record
// of what it had been. It is now sampled while the build runs — see `shared/uspto-peak-disk.mjs`.
//
// PROVENANCE. Measured 2026-08-13 on the same complete index the figures above come from: 14,248,452
// rows, SQLite 3.51.3, page_size 4096, one box, one filesystem. Both FTS shadow tables were emptied and
// the file VACUUMed back to the 8.14 GB it holds without them — the state a real build reaches
// `rebuildFts` in — and both indexes were then rebuilt under the sampler, at 0.5 s intervals.
//
//   peak WAL           328,133,312 B, set by the mark_fts rebuild and not exceeded by mark_rfts. ONE
//                      pass, not both: they are separate transactions and the WAL resets in place
//                      between them. It bounds the pair only because the two indexes are within 0.2%
//                      of each other (150,041,741 B against 149,830,574 B of blocks) — make one of
//                      them materially larger and the peak follows that one
//   ingest loop        4.2 MB of WAL, flat across ten files while the index grew — `wal_autocheckpoint`
//                      is 1000 pages, so the ingest cannot be what sets the peak
//   WHEN it happens    at the CHECKPOINT that ENDS an FTS rebuild, not during it. The rebuild is one
//                      transaction: its pages pile up in the WAL, the database file does not move, and
//                      then the checkpoint copies them in while the WAL is still on disk. For a few
//                      seconds the same 328 MB exists twice.
//
// So the peak is the FINISHED index plus one WAL — 3% above the steady state, not a multiple of it.
// n=1, one box, and the WAL is a property of what SQLite is writing: a different page size or a future
// FTS5 would move it.
//
// CROSS-CHECKED at a tenth of the scale THROUGH THE CLI ITSELF, so the instrumentation is exercised on
// the path an adopter runs: 1,000,000 of this index's own rows written back out as USPTO XML and
// ingested with `uspto-sync --from-file`. The ingest loop held 6.2 MB of WAL, flat over ten files while
// the index grew to 636 MB; the rebuild took it to 25.2 MB. Same order of magnitude at a fourteenth of
// the rows, and NOT a clean linear confirmation — the 328 MB above is one rebuild pass while this
// 25.2 MB is the high-water across both, because the phase hook fires after the pair. It says the
// rebuild's WAL tracks what it indexes and the ingest loop's tracks nothing. The peak figure does not
// rest on it: that was measured directly.
//
// NOTHING GREW OUTSIDE THE INDEX DIRECTORY in either run, so `assertRoomToIngest` is checking the right
// filesystem: free space on `/` did not move while 10 GB was rebuilt against a `SQLITE_TMPDIR` on
// another mount. (`VACUUM` is the exception and no build runs one — it spills a full copy of the
// database to temp. Watched by `/proc/<pid>/fd`, because SQLite unlinks temp files at creation and `ls`
// never sees them.)
export const USPTO_PEAK_WAL_GB = 0.33;

/**
 * The high-water mark of a full build: what the index ends at, plus the WAL that is still beside it at
 * the moment it ends. DERIVED rather than quoted, so it cannot drift from the two figures it is made
 * of — the failure was about.
 */
export const USPTO_PEAK_GB = Math.round((USPTO_INDEX_GB + USPTO_PEAK_WAL_GB) * 10) / 10;

// ── WHAT THE PREFLIGHT CHARGES, AND WHY IT IS NOT THE MEASURED RATIO ────────────────────────────────
//
// `assertRoomToIngest` refuses a build that cannot fit, because a full disk fails as "artifact absent":
// the ingest throws somewhere unhelpful and leaves a PARTIAL index that opens fine, reports rows, and
// answers a clearance over part of the register. Nothing downstream can tell that apart from a complete
// one. That failure costs a day, so the check is deliberately pessimistic.
//
// It was pessimistic by 4x. Charging 1.0 demanded ~43.8 GB for a build whose index came to 10.1 GB, and
// INSTALL.md told the reader to provision 60 GB. On the free tier that is the difference between "I can
// try this on the disk I have" and "I cannot", which is the whole of 's Why.
//
// Carried at 0.35 against 0.24 measured — a 46% margin, and the margin is doing real work rather than
// decorating a guess:
//
//   · n=1. One build, one box, one filesystem, one SQLite version. A second measurement may move it.
//   · Someone ingesting a different mix — `--from-file` over backfile parts alone — sits nearer 0.91
//     than 0.24, because the ratio is a property of what you feed it, not of the engine.
//
// It is NO LONGER absorbing the peak. That was the third reason this margin existed and measured
// it: 0.33 GB of WAL on top of a 10.1 GB index, 3% rather than the multiple the margin was sized to
// survive. The margin is now carrying n=1 and the mix alone — a smaller job than it was given, and a
// reason to revisit 0.35 on the SECOND complete build rather than on this one.
//
// Anyone re-measuring should move MEASURED and leave CARRIED above it, and say which build they read.
export const USPTO_INDEX_BYTES_PER_ARCHIVE_BYTE_MEASURED = 0.24;
export const USPTO_INDEX_BYTES_PER_ARCHIVE_BYTE_CARRIED = 0.35;
export const USPTO_HEADROOM_GB = 2;

/** Hours a full build is likely to take, from the one throughput figure that has been measured. */
export const usptoBuildHours = (archiveGB = USPTO_ARCHIVE_GB) =>
  Math.round((archiveGB / USPTO_INGEST_GB_PER_HOUR) * 10) / 10;

/**
 * Bytes a build of `archiveBytes` needs on the index filesystem. THE one place this is computed.
 *
 * `largestPartBytes` is the download path's extra charge and nothing else: it lands one archive part
 * beside the index and deletes it after ingesting, so it is charged for the biggest pending file, never
 * for all of them at once. `--from-file`'s archives already exist and are never deleted, so charging
 * for one again would demand room nobody needs — which is how a check ends up refusing a machine that
 * has plenty.
 */
export const usptoDiskNeededBytes = (archiveBytes, largestPartBytes = 0) =>
  archiveBytes * USPTO_INDEX_BYTES_PER_ARCHIVE_BYTE_CARRIED + largestPartBytes + USPTO_HEADROOM_GB * 1e9;

/**
 * What to tell a reader to provision: what the preflight will demand of a full build, rounded up to a
 * figure a person would actually type.
 *
 * Derived from `usptoDiskNeededBytes` rather than chosen, so the document cannot promise room the check
 * then refuses — that mismatch is the failure this issue is about.
 */
export const usptoProvisionGB = () =>
  Math.ceil(usptoDiskNeededBytes(USPTO_ARCHIVE_GB * 1e9, USPTO_LARGEST_PART_GB * 1e9) / 1e9 / 5) * 5;

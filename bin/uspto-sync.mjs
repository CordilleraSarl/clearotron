#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// clearotron sync — build or update the local US trademark register.
//
// Two ways in, and the second needs no account at all:
//
//   npx clearotron sync                          pull everything new since the index's own data date
//   npx clearotron sync --full                   rebuild from the beginning
//   npx clearotron sync --since 2026-08-01       an explicit window
//   node bin/uspto-sync.mjs --dry-run            list what would be downloaded, download nothing
//   node bin/uspto-sync.mjs --from-file a.zip    ingest a file you already have. NO API KEY NEEDED.
//
// Downloading needs a free USPTO.gov account with ID.me identity verification and its API key in
// USPTO_API_KEY. Nothing is billed — the account exists to rate-limit the endpoint. --from-file is the
// escape hatch for anyone who has the file but not the account, and it is also how the ingest path is
// exercised in a repo that cannot hold credentials.
//
// The index lands at --db, or USPTO_LOCAL_DB, which is the same variable the provider reads.

import "../shared/env-local.mjs";   // side effect: apply <repo>/.env when THIS file is the CLI entry (never on library import)
import { readdirSync, statSync, statfsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  API_KEY_ENV, PRODUCT_ID, BACKFILE_PRODUCT_ID, filesForWindow, downloadFile, syncIndex, windowFor, backfileIsIn, ingestedFileNames,
} from "../providers/uspto-local/src/sync.js";
import { usptoDiskNeededBytes, USPTO_INDEX_BYTES_PER_ARCHIVE_BYTE_CARRIED } from "../shared/uspto-index-size.mjs";
import { startPeakDiskSampler, peakSummaryLines, peakAtPhaseLine } from "../shared/uspto-peak-disk.mjs";
import { invocationPrefix } from "../shared/invocation.mjs";   

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const say = (...a) => process.stdout.write(`${a.join(" ")}\n`);
const die = (msg) => { process.stderr.write(`uspto-sync: ${msg}\n`); process.exit(1); };

if (flag("help") || flag("h")) {
  say(`usage: ${invocationPrefix()}clearotron sync [--full | --since YYYY-MM-DD] [--db PATH] [--cache DIR] [--dry-run]
       ${invocationPrefix()}clearotron sync --from-file <path.zip|path.xml> [--db PATH]

  --db PATH        where the index lives (default: $USPTO_LOCAL_DB)
  --cache DIR      where downloaded archives are kept (default: <db dir>/bulk)
  --from-file P    ingest a local archive or XML file; needs no API key. Repeatable via a directory.
  --since DATE     pull files whose DATA date is on or after DATE
  --full           ignore the index's current date and pull everything
  --dry-run        list the files that would be pulled, then stop
  --keep           keep downloaded archives (default: they are kept in --cache anyway)

  Downloading reads $${API_KEY_ENV}. Product: ${PRODUCT_ID} (Trademark Full Text XML, daily
  applications, no images). Get a key free at a USPTO.gov account → Manage API Key.`);
  process.exit(0);
}

const dbPath = value("db", process.env.USPTO_LOCAL_DB);
if (!dbPath) die(`no index path. Pass --db, or set USPTO_LOCAL_DB (the same variable the provider reads).`);

// ── DISK, BEFORE ANYTHING IS DOWNLOADED OR INGESTED ─────────────────────────────────────────────────
//
// A full disk fails as "artifact absent", not as a disk error: the ingest throws somewhere unhelpful,
// and what is left behind is a PARTIAL index that opens fine, reports rows, and answers a clearance
// over part of the register. Every downstream check passes on it.
//
// ──: THE RATIO NOW COMES FROM A FINISHED BUILD, NOT FROM ITS FIRST 11 PARTS ────────────────────
//
// This block used to carry 1.0, extrapolated from 0.91 measured over the first 11 backfile parts, and
// concluded "a full build needs roughly 38 GB for the index alone". The build has since been run to
// completion and the index came to 10.1 GB — the ratio over a WHOLE pull is 0.24, because the backfile
// front-loads distinct marks and the 590 dailies behind it mostly re-state marks already indexed. An
// early sample cannot see that and always reads high.
//
// So the old check demanded 43.8 GB for a build that fits in 17, and INSTALL.md told the reader to
// provision 60. On the free tier that is the difference between "I can try this on the disk I have" and
// "I cannot", which is the whole of 's Why.
//
// The ratio, the headroom and the arithmetic now live in shared/uspto-index-size.mjs with their
// provenance, because the same numbers are what the wizard prints and what INSTALL.md promises, and
// keeping three copies in step by hand is what produced four contradictory figures. Still carried
// pessimistically (0.35 against 0.24) — see that file for what the margin is absorbing, which since
// is n=1 and the ingest mix, no longer a peak WAL nobody had seen.
//
// ──: IT USED TO BE REACHABLE FROM ONE PATH OF TWO ───────────────────────────────────────────────
//
// This block lived inside the download branch's `else`, so `--from-file` — the keyless path, the one an
// adopter without a USPTO account uses to ingest a multi-GB backfile archive by hand — walked straight
// past it into precisely the partial index it exists to prevent. It is now ONE function called from
// both branches: one ratio, one headroom, one `--force-disk`, one unmeasurable branch, rather than two
// copies that drift.

// What the preflight charged for one archive at a time, kept so the peak summary can state the same
// arithmetic the refusal used. Zero on --from-file, where no archive is downloaded.
let largestPendingBytes = 0;

/**
 * Refuse a build that cannot fit, or say why it could not be checked. Never returns a "pass" it did
 * not establish.
 *
 * `downloadsHere` distinguishes the two paths, and it is the ONLY thing that differs between them: the
 * download path lands one archive next to the index and deletes it after ingesting, so it is charged
 * for the largest pending file on top of the index growth. `--from-file`'s archives already exist and
 * are never deleted, so charging for one again would demand room nobody needs — which is how a check
 * ends up refusing a machine with plenty of it.
 */
function assertRoomToIngest(candidates, { downloadsHere }) {
  // Already-ingested files are not read again, so they must not be charged to the estimate — the check
  // would otherwise refuse the very resume it exists to enable, demanding the whole build's room to
  // finish the last few files. --full ignores the record, so it is charged for everything.
  const done = flag("full") ? new Set() : ingestedFileNames(dbPath);
  const pending = candidates.filter((f) => !done.has(f.name));
  if (done.size) say(`${done.size} file(s) already ingested — resuming; ${pending.length} left`);
  const archiveBytes = pending.reduce((n, f) => n + (f.size ?? 0), 0);
  const largest = downloadsHere ? pending.reduce((n, f) => Math.max(n, f.size ?? 0), 0) : 0;
  largestPendingBytes = largest;
  const needed = usptoDiskNeededBytes(archiveBytes, largest);
  let free;
  try {
    const fsInfo = statfsSync(dirname(resolve(dbPath)));
    free = fsInfo.bavail * fsInfo.bsize;
  } catch (e) {
    // statfs is the check, not the job. If it cannot run, say so rather than pretending it passed —
    // an unread guard reported as silence is how the rule it enforces stops existing. Only the
    // MEASUREMENT is inside the try: a refusal thrown from in here would be reported as an
    // unmeasurable disk, which is the same lie in the other direction.
    say(`disk: could not measure free space (${e.message}). Proceeding UNCHECKED — this build wants about `
      + `${(needed / 1e9).toFixed(1)} GB.`);
    return;
  }
  say(`disk: ${(free / 1e9).toFixed(1)} GB free where the index lives; this build needs about ${(needed / 1e9).toFixed(1)} GB`);
  if (free < needed && !flag("force-disk")) {
    die(`not enough room. ${(free / 1e9).toFixed(1)} GB free, about ${(needed / 1e9).toFixed(1)} GB needed `
      + `(${(archiveBytes / 1e9).toFixed(1)} GB of archives index to about `
      + `${(archiveBytes * USPTO_INDEX_BYTES_PER_ARCHIVE_BYTE_CARRIED / 1e9).toFixed(1)} GB${downloadsHere ? ", plus one archive" : ""} `
      + `and headroom).\n`
      + `  Point --db at a filesystem with room. A build that runs out partway leaves an index that OPENS, `
      + `reports rows, and answers a clearance over PART of the register — nothing downstream can tell that `
      + `apart from a complete one.\n`
      + `  --force-disk overrides, if you know something this check does not.`);
  }
}

const localArg = value("from-file");
let files;
// Set only on the download path. --from-file supplies real paths up front and must never have them
// deleted underneath the operator, so both stay null there.
let downloadEach = null;
let dropEach = null;

if (localArg) {
  // ── the keyless path ────────────────────────────────────────────────────────────────────────────
  const p = resolve(localArg);
  const st = statSync(p, { throwIfNoEntry: false });
  if (!st) die(`no such file: ${p}`);
  const paths = st.isDirectory()
    ? readdirSync(p).filter((f) => /\.(zip|xml)$/i.test(f)).sort().map((f) => join(p, f))
    : [p];
  if (!paths.length) die(`${p} holds no .zip or .xml files`);
  // The DATA date is unknown for a hand-supplied file, and it is left null on purpose. The provider
  // then refuses to count rather than answering zero, because "we cannot establish currency" is not a
  // weaker claim than "we know it is old" — and inventing today's date here would make a five-year-old
  // archive claim to be current.
  // `size` is read here and nowhere else on this path: it is what the disk gate below charges for.
  // Before nothing on this branch measured anything.
  files = paths.map((path) => ({ path, name: basename(path), dataDate: null, size: statSync(path).size }));
  say(`ingesting ${files.length} file(s) — no API key needed for this path`);
  assertRoomToIngest(files, { downloadsHere: false });
} else {
  // ── the download path ───────────────────────────────────────────────────────────────────────────
  const apiKey = process.env[API_KEY_ENV];
  const w = flag("full")
    ? { from: "1884-01-01", to: new Date().toISOString().slice(0, 10), incremental: false }
    : value("since")
      ? { from: value("since"), to: new Date().toISOString().slice(0, 10), incremental: true }
      : windowFor(dbPath);
  say(`${w.incremental ? "incremental" : "full"} pull, ${w.from} → ${w.to}`);

  let listed;
  try {
    // The backfile question is answered by the INDEX, not by the window (see filesForWindow). `--since`
    // sets incremental:true without asking whether an index exists, so deriving it from the window built
    // a register starting at the --since date and never noticed.
    listed = await filesForWindow({ apiKey, window: w, hasBackfile: backfileIsIn(dbPath) });
  } catch (e) {
    die(e.message);
  }
  if (!listed.length) {
    // NOT an error, and not a silent success either. Say it plainly: nothing new is a real answer, and
    // the index is left exactly as it was — including its old date, so freshness still governs.
    say(`the office published no ${PRODUCT_ID} files in that window. The index is unchanged, and its recorded date has NOT been moved forward.`);
    process.exit(0);
  }
  const totalMb = listed.reduce((n, f) => n + (f.size ?? 0), 0) / 1e6;
  // BROKEN OUT BY PRODUCT, because the totals are the only place a reader can see whether they are
  // building the whole register or only the part filed since 2025. "590 files" looked complete for as
  // long as nobody knew there was a second product.
  const perProduct = listed.reduce((m, f) => m.set(f.productId, (m.get(f.productId) ?? 0) + 1), new Map());
  say(`${listed.length} file(s), ${(totalMb / 1000).toFixed(1)} GB`);
  for (const [pid, n] of perProduct) {
    say(`  ${n} from ${pid}${pid === BACKFILE_PRODUCT_ID ? "  (the 1884→ backfile)" : "  (dailies)"}`);
  }
  // THE CONDITION IS "NO BACKFILE AND NOT A FULL PULL", not "no backfile in this listing".
  //
  // It used to read `!perProduct.get(BACKFILE_PRODUCT_ID)` — no backfile file in the listing — which
  // was the same thing only because the listing was narrowed by the window: an incremental window is
  // past the annual product's last year, so it listed zero and the refusal fired. Now that
  // filesForWindow lists the whole backfile whenever the index has none, an incremental run against a
  // pre-backfile index would list all ~142 parts, sail past the refusal, and start a 22 GB download
  // from a nightly cron nobody is watching. The message below has always said `Run --full`; making the
  // unattended path silently do it instead is not the same answer, and a disk that fills halfway
  // through leaves the partial index this whole guard exists to prevent.
  //
  // So: an index with no recorded backfile is repaired by an explicit `--full` and by nothing else.
  if (!backfileIsIn(dbPath) && (w.incremental || !perProduct.get(BACKFILE_PRODUCT_ID))) {
    // No backfile recorded in the index, and this run is not the one that establishes it: whatever is
    // built here starts at the dailies' earliest date. Refusing beats building it, because every
    // downstream check would pass and the gap would only ever surface as a clean negative on an
    // older mark.
    //
    // TWO CAUSES, AND THEY NEED DIFFERENT ANSWERS. A narrow window simply has no backfile file in it —
    // the annual product ends at the last full year, so any window past that legitimately lists zero.
    // That is the ordinary nightly sync of an index whose backfile was never recorded, including every
    // index built before `backfile_through` existed. Telling that operator to "check the product is
    // still published" sends them to look at USPTO for a fault in their own index.
    const windowHasNoBackfile = w.incremental || w.from > "2025-12-31";
    die(windowHasNoBackfile
      ? `this index has no recorded ${BACKFILE_PRODUCT_ID} backfile, and the window ${w.from} → ${w.to} `
        + `contains none (the annual product ends at the last full year). An incremental sync would keep `
        + `it a ${PRODUCT_ID}-only index that answers "no conflicts" for anything filed before `
        + `${PRODUCT_ID}'s earliest date.\n`
        + `  Run: node bin/uspto-sync.mjs --full     (establishes the backfile, then resumes normally)\n`
        + `  An index built before backfile tracking existed reaches here even if its backfile IS in; `
        + `--full re-reads it and records the fact.`
      : `a FULL build listed no ${BACKFILE_PRODUCT_ID} files, so this would index only filings from `
        + `${PRODUCT_ID}'s earliest date onward and answer "no conflicts" for everything before it. `
        + `Refusing. Check the product is still published before syncing.`);
  }
  for (const f of listed) say(`  ${f.dataDate ?? "?"}  ${f.name}  ${((f.size ?? 0) / 1e6).toFixed(1)} MB`);

  // Disk, before anything is downloaded. The policy, the ratio and the measurement it came from are at
  // the definition — this path and --from-file now share one of each.
  assertRoomToIngest(listed, { downloadsHere: true });

  if (flag("dry-run")) process.exit(0);

  const cache = value("cache", join(dbPath.replace(/\/[^/]*$/, ""), "bulk"));
  // ── DOWNLOAD ONE, INGEST IT, DROP IT ────────────────────────────────────────────────────────────
  //
  // Not a download-everything-then-ingest loop, which is what this was. A full build is ~41 GB across
  // the two products and the box has 49 GB free, so holding every archive at once is a disk-full
  // partway through — and a full disk fails as "artifact absent", not as a disk error. Resolving each
  // file inside syncIndex's own loop (via onFile) and unlinking it after (onIngested) keeps the peak at
  // one archive plus the index.
  //
  // --keep opts out, for anyone who wants the archives afterwards and has the room.
  files = listed;
  downloadEach = async (f) => { say(`downloading ${f.name} …`); f.path = await downloadFile(f, cache, { apiKey }); };
  if (!flag("keep")) dropEach = async (f) => { await rm(f.path, { force: true }); };
}

// ──: RECORD THE PEAK WHILE IT IS HAPPENING ────────────────────────────────────────────────────
//
// The gate above charges for a peak nobody had measured. It could not be measured after the fact: the
// WAL is the part that grows, and the last `db.close()` checkpoints it and DELETES it, so a finished
// build leaves a 0-byte `-wal` and no record of what it had been. read exactly that and had to
// infer the figure.
//
// So it is sampled AS IT GOES, from a worker thread — see shared/uspto-peak-disk.mjs for why a timer on
// this thread would have reported a confident low number. A sampler that cannot start is SAID, never
// swallowed: a build that quietly stops recording its peak is how this went unmeasured the first time.
let sampler = null;
try {
  sampler = startPeakDiskSampler(dbPath);
} catch (e) {
  say(`disk: peak sampling did not start (${e.message}). This build will NOT record its high-water mark.`);
}
const sayPeak = () => {
  sampler?.sample();
  for (const line of peakSummaryLines(sampler?.read() ?? null, { dbPath, largestPartBytes: largestPendingBytes })) say(line);
};

const started = Date.now();
//. The gate above refuses a build that cannot fit; this names the one that runs out ANYWAY —
// someone else filled the disk while it ran, --force-disk was passed, or the ratio was optimistic.
// Without this the operator gets SQLite's "database or disk is full" or a bare ENOSPC from whichever
// write happened to be unlucky, and goes looking at the parser or the bulk product. It says the disk
// filled, and it says the build is resumable, because the thing an operator does next depends entirely
// on knowing that the parts already ingested are not lost. Resume behaviour itself is untouched.
let result;
try {
  result = await syncIndex({
    dbPath,
    files,
    onFile: async (f) => { await downloadEach?.(f); say(`ingesting ${f.name} …`); },
    onIngested: dropEach,
    // Where the mark stood at the end of each of the two phases. The rebuild runs inside syncIndex and
    // blocks this thread throughout, so these two lines are the only place the log can say WHICH phase
    // set the peak — and that is what the next person sizing the preflight needs.
    onPhase: (phase) => {
      if (!sampler) return;
      // A sample taken HERE, on a thread that is between phases and therefore not inside SQLite: the
      // ingest line must not be one interval stale, because it is the baseline the rebuild is measured
      // against.
      sampler.sample();
      const line = peakAtPhaseLine(phase, sampler.read());
      if (line) say(line);
    },
    // --full means REBUILD. Without this the resume record skips every file and the run certifies the
    // index it was asked to replace.
    ignoreIngested: flag("full"),
    // The FULL backfile listing, so "is the backfile in" is asked of the product's whole set and never of
    // whatever this invocation happened to be handed.
    backfileNames: files.filter((f) => f.productId === BACKFILE_PRODUCT_ID).map((f) => f.name),
  });
} catch (e) {
  // SQLite reports a full disk as SQLITE_FULL / "database or disk is full"; a plain write reports
  // ENOSPC. Both are the same event and neither says so in words an operator can act on.
  const full = e?.code === "ENOSPC" || /ENOSPC|no space left|database or disk is full|SQLITE_FULL/i.test(String(e?.message ?? e));
  // Printed BEFORE either exit. A build that ran out of room is the one whose high-water mark is worth
  // the most, and both paths out of here end the process.
  sayPeak();
  if (!full) throw e;
  die(`THE DISK FILLED during the build (${String(e?.message ?? e).trim()}).\n`
    + `  This is a disk error, not a data or format error — nothing is wrong with the bulk product or the parser.\n`
    + `  THE BUILD IS RESUMABLE. Every file already ingested is recorded in the index, so re-running the same\n`
    + `  command after freeing space picks up at the first un-ingested part rather than starting again. Do NOT\n`
    + `  pass --full to recover: that discards the resume record and rebuilds from the beginning.\n`
    + `  Until it finishes, the index is PARTIAL — it opens, reports rows, and would answer a clearance over\n`
    + `  part of the register. Free space and resume before pointing anything at it.`);
}
const secs = ((Date.now() - started) / 1000).toFixed(1);

say(`\nindex: ${dbPath}`);
say(`ingested ${result.ingested.toLocaleString()} record(s) in ${secs}s; ${result.rows.toLocaleString()} total in the index`);
// Read after syncIndex has closed the index, which checkpoints and removes the WAL. The figure survives
// that because it lives in the sampler's shared memory, not on disk — which is the whole point.
sayPeak();
await sampler?.stop();
if (result.skipped) {
  say(`${result.skipped} file(s) were already ingested and were skipped — this run resumed an earlier build.`);
}

// A file that yielded nothing is a FINDING, and it is the quietest one this tool has: every step
// succeeded. It did not move the index's date — see syncIndex — so freshness still governs, but
// nobody would know to look unless it is said here, and repeatedly empty files mean the format
// changed underneath us.
if (result.empty?.length) {
  say(`\n${result.empty.length} file(s) parsed to NO records: ${result.empty.join(", ")}`);
  say(`Their dates were NOT applied, so the index still reports the age of the last file that`);
  say(`actually contained something. Every step of those downloads succeeded — if this repeats, the`);
  say(`bulk format has changed and the parser needs looking at, not the network.`);
}
if (result.newestDelta) {
  say(`newest data date: ${result.newestDelta}`);
} else {
  // The loud version of the null above. A user who does not know this will read every refused count as
  // a bug in the provider rather than the honest consequence of an undated index.
  say(`newest data date: UNKNOWN. Nothing here recorded what the data covers, so the provider will `
    + `REFUSE to count rather than answer zero. That is deliberate. Run a download sync, or accept `
    + `that this index cannot support a clean negative.`);
}

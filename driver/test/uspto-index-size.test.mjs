// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — INSTALL.md AND THE CODE CANNOT HOLD DIFFERENT FIGURES ────────────────────────────────────
//
// §3a once carried "steady state ~1 GB index" and "the index is tens of gigabytes, not one" sixty lines
// apart, while `uspto-sync.mjs` refused any build with less than 43.8 GB free and `onboard.mjs` quoted
// 46. Four numbers for three quantities, and the two the reader meets first were the two that were
// furthest from the truth.
//
// Reconciling the prose once would not have held. This is the part that makes it stay reconciled: every
// size figure in §3a must be one the code exports, and no OTHER size figure may appear there. Adding a
// fifth number fails here rather than in six months in a stranger's shell.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  USPTO_ARCHIVE_GB, USPTO_INDEX_GB, USPTO_INGEST_GB_PER_HOUR, USPTO_DAILY_TOPUP_MB,
  USPTO_LARGEST_PART_GB, USPTO_HEADROOM_GB,
  USPTO_INDEX_BYTES_PER_ARCHIVE_BYTE_MEASURED, USPTO_INDEX_BYTES_PER_ARCHIVE_BYTE_CARRIED,
  usptoBuildHours, usptoProvisionGB, usptoDiskNeededBytes,
} from "../../shared/uspto-index-size.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const install = readFileSync(join(REPO, "INSTALL.md"), "utf8");

/** §3a only — the free-tier section. The rest of the document sizes other things. */
const sectionThreeA = () => {
  const start = install.indexOf("## 3a.");
  assert.notEqual(start, -1, "INSTALL.md has no §3a — the section this issue is about was renamed or removed");
  const end = install.indexOf("\n## ", start + 1);
  return install.slice(start, end === -1 ? undefined : end);
};

test("#807 every GB figure in INSTALL.md §3a is one the code exports", () => {
  // Both throughput (GB/h) and sizes (GB) are collected, because the old text mixed them into the same
  // sentence and that is precisely how "42 GB downloaded" became "6.5 hours at 6.45 GB/h" became a
  // build time nobody had timed.
  const allowed = new Set([
    USPTO_ARCHIVE_GB, USPTO_INDEX_GB, USPTO_INGEST_GB_PER_HOUR, usptoProvisionGB(),
  ].map(Number));

  const found = [...sectionThreeA().matchAll(/([0-9]+(?:\.[0-9]+)?) ?GB/g)].map((m) => Number(m[1]));
  assert.ok(found.length >= 4, `§3a quotes almost no sizes (${found.length}) — the table is the point of the section`);

  const strays = [...new Set(found)].filter((n) => !allowed.has(n));
  assert.deepEqual(strays, [],
    `§3a quotes ${strays.join(", ")} GB, which no constant in shared/uspto-index-size.mjs produces. `
    + `Allowed: ${[...allowed].join(", ")}. A number the code cannot produce is a promise it cannot keep.`);
});

test("#807 the three quantities are all stated, and the reader is not asked to infer one", () => {
  const s = sectionThreeA();
  assert.match(s, new RegExp(`${USPTO_ARCHIVE_GB} ?GB`), "the download");
  assert.match(s, new RegExp(`${USPTO_INDEX_GB} ?GB`), "the steady-state index");
  assert.match(s, new RegExp(`${usptoProvisionGB()} ?GB`), "what to provision");
  assert.match(s, new RegExp(`${USPTO_DAILY_TOPUP_MB} ?MB`), "the ongoing nightly cost");
  assert.match(s, new RegExp(`${usptoBuildHours()} hours`), "the build time");
});

test("#807 the superseded figures are gone from the whole document, not just from §3a", () => {
  // Named individually because each was a real published claim, and a grep that only checked §3a would
  // pass while §4 still told the reader to provision 60 GB.
  for (const [pattern, what] of [
    [/~1 ?GB\b[^.]{0,40}index/i, "the ~1 GB index — it was never measured and the finished one is 10x that"],
    [/tens of gigabytes, not one/i, "the sentence written to correct the ~1 GB claim, itself wrong"],
    [/60 ?GB/, "provision 60 GB"],
    [/6\.45 ?GB\/h/, "the 6.45 GB/h throughput, extrapolated from the first parts"],
    [/0\.70 index bytes/, "the 0.70 ratio measured over the first third"],
    [/near 28 ?GB/, "the 28 GB index estimate"],
  ]) {
    assert.doesNotMatch(install, pattern, `INSTALL.md still carries ${what}`);
  }
});

test("#807 what the document promises is what the preflight will demand", () => {
  // The failure this prevents is the one that produced the issue: prose that says a build fits on a
  // disk the check then refuses. Provisioning advice is DERIVED from the refusal arithmetic, so the
  // only way to break the promise is to change the arithmetic — which changes both at once.
  const needed = usptoDiskNeededBytes(USPTO_ARCHIVE_GB * 1e9, USPTO_LARGEST_PART_GB * 1e9);
  assert.ok(usptoProvisionGB() * 1e9 >= needed,
    `INSTALL.md tells the reader to provision ${usptoProvisionGB()} GB and the preflight demands `
    + `${(needed / 1e9).toFixed(1)} GB — the document is promising room the code refuses`);

  // And the advice must not be absurdly above it either, or it re-creates the defect in the other
  // direction: a free tier nobody attempts because the entry cost reads as 60 GB.
  assert.ok(usptoProvisionGB() * 1e9 < needed + 5e9,
    "the provisioning figure has drifted more than 5 GB above what the build needs");
});

test("#807 the carried ratio is pessimistic against the measured one, and both are declared", () => {
  assert.ok(USPTO_INDEX_BYTES_PER_ARCHIVE_BYTE_CARRIED > USPTO_INDEX_BYTES_PER_ARCHIVE_BYTE_MEASURED,
    "the preflight must charge MORE than one build was observed to use — a full disk mid-ingest leaves "
    + "a partial index that opens, reports rows, and answers a clearance over part of the register");
  // Sanity against the observation itself: 41.5 GB of archives produced a 10.1 GB index.
  assert.equal(Math.round((USPTO_INDEX_GB / USPTO_ARCHIVE_GB) * 100) / 100,
    USPTO_INDEX_BYTES_PER_ARCHIVE_BYTE_MEASURED,
    "MEASURED is no longer the ratio of the two sizes it was derived from");
});

test("#807 there is exactly one copy of the disk arithmetic", () => {
  // The four figures existed because three files each held their own. `uspto-sync.mjs` owns the
  // refusal, `onboard.mjs` owns the prompt, and neither may compute the requirement itself.
  const strip = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  for (const f of ["bin/uspto-sync.mjs", "bin/onboard.mjs"]) {
    const src = strip(readFileSync(join(REPO, f), "utf8"));
    assert.match(src, /uspto-index-size\.mjs/, `${f} does not read the shared figures`);
    assert.doesNotMatch(src, /INDEX_BYTES_PER_ARCHIVE_BYTE\s*=/,
      `${f} declares its own ratio — that is the drift this issue is about`);
    assert.doesNotMatch(src, /HEADROOM_BYTES\s*=/, `${f} declares its own headroom`);
  }
});

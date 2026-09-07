// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-failed-run-points-at-evidence-that-resolves.test.mjs —.
//
// THE FINDING, AND THE HALF OF IT THAT WAS ALREADY FIXED. Every failed run of 2026-08-19 recorded a
// `status.reason` of exactly 200 characters ending ".../studio/prelim-se" — a directory that does not
// exist, in place of the senior-eye-review.md that does. The e2e lane stat'd it, got ENOENT, and filed
// the pointer as unrecoverable. Replayed against the four preserved runs, it was not: 's
// `reasonFull` held the whole path on every one of them and `reasonTruncated` was true on every one.
//
// So what was actually wrong is narrower and worse. The field a reader reaches FIRST said nothing about
// having been cut — `reason` was a bare `.slice(0, 200)`, and a bare slice turns a severed path into a
// sentence that reads as finished. repair-contract.mjs states this repo's rule for exactly that case:
// a value is "COMPLETE, or it is VISIBLY MARKED as incomplete". `reasonFull` and `reasonDetail` were
// marked with `abbrev`. `reason`, the one that rides the ping and the one the failure taxonomy names,
// was not.
//
// Two changes, and this file is the guard on both:
//   1. terminalReasonFields marks its own cut, so no reader mistakes a cut sentence for a whole one.
//   2. The verdict throw stops putting an absolute path in prose at all. It rides `detail`  —
//      status.json's `reasonDetail`, the failure packet, and `null` on the client-facing portal view,
//      which is where an absolute path on this box always belonged.
//
// Run:  node --test driver/test/a-failed-run-points-at-evidence-that-resolves.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { terminalReasonFields } from "../pipeline.mjs";
import { abbrev } from "../repair-contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (f) => readFileSync(join(ROOT, f), "utf8");

// The measured shape: ~130 characters of prose, then an absolute run-dir path. Built under the real
// tmpdir rather than typed, because a /home/<user> literal is refused by 's guard and because a
// path this test can actually stat is the only kind that proves anything.
function realisticRunDir() {
  const pool = mkdtempSync(join(tmpdir(), "prelim-search-"));
  // Synthetic, and it has to be: an <adj>-<noun> pair from phase0.mjs's vocabulary is a real run
  // codename or indistinguishable from one, and no-client-identifiers.test.mjs refuses both.
  const dir = join(pool, "tmpXXXX-example-agent", "2026-01-01-fixture-run");
  mkdirSync(dir, { recursive: true });
  const review = join(dir, "senior-eye-review.md");
  writeFileSync(review, "BLOCKING\n\n- the third finding's owner is unsupported\n");
  return review;
}

// The verdict terminal as it will be RECORDED: its reason argument and its `detail`, lifted out of the
// shipping source with the run-dir path substituted in. Returns detail: null when the throw carries
// none, which is the state that put an absolute path in the prose in the first place.

test("#1406 a cut reason says so IN THE STRING, not only in a sibling key", () => {
  const long = `${"x".repeat(300)} (reviewer flags: /a/path/that/gets/severed.md)`;
  assert.ok(long.length > 200, "void control — a fixture inside the cap proves nothing here");
  const f = terminalReasonFields(long);
  assert.ok(f.reason.endsWith("…"),
    "a bare slice hands back a severed sentence that reads as a finished one — that is the whole defect");
  assert.equal(f.reasonTruncated, true, "and the sibling key still states it, for a reader who checks");
});

test("#1406 the marker rides INSIDE the bound — `reason` is still the 200 the ping is built on", () => {
  const f = terminalReasonFields("y".repeat(400));
  assert.equal(f.reason.length, 200,
    "#755's header calls this cap load-bearing; making the cut visible must not widen it by one byte");
  const short = terminalReasonFields("provider refused the count probe");
  assert.equal(short.reason, "provider refused the count probe", "an uncut reason gains no marker");
  assert.equal(short.reasonTruncated, false, "…and false is still written, never left absent");
});

// ── T3a RETIRED THE CARRIER THESE TWO ARMS WERE BUILT ON ──────────────────────────────────────────
//
// Owner ruling 2026-08-26: "Deliver always, with open points printed. The refusal on a blocking review
// goes." Both arms that stood here read the verdict terminal out of pipeline.mjs — one composing
// its `reason`/`detail` to prove the flags pointer resolved on disk, one pinning the pointer to `detail`
// rather than to the message. **That throw no longer exists**, so neither had a subject left.
//
// THEY ARE NOT DELETED QUIETLY, and the distinction matters to whoever reads this file next:
//
//   · The pointer arm's PROPERTY did not survive, because its premise did not. A BLOCKING review no
//     longer produces a failure record, so there is no record for a pointer to point FROM. The reviewer's
//     flags now reach a reader through the DELIVERED report — asserted by text in pipeline.mock.test.mjs
//     ("the run DELIVERS, with the open points printed") and in t3a-deliver-with-open-points.test.mjs.
//     That is a stronger carrier than a failure record: the client sees it.
//
//   · The `detail`-shape arm's LESSON did survive, and it generalises. 's defect was an artifact
//     path interpolated into `reason`, where the 200-char cap severs it and a reader who stats the result
//     gets ENOENT. That was a property of EVERY throw; it was pinned on the one site that happened to
//     have it. Pinned across the corpus below, it outlives any single site.
test("#1406 no StageFailure interpolates an artifact path into `reason` — the cap severs it there", () => {
  const pl = source("driver/pipeline.mjs");
  const sites = [...pl.matchAll(/throw new StageFailure\(/g)].map((m) => pl.slice(m.index, m.index + 500));
  // FLOOR. A walk that finds nothing reports clean, and this file exists because a clean report over an
  // empty population is how stayed invisible in the first place.
  assert.ok(sites.length >= 20,
    `only ${sites.length} StageFailure site(s) found — the extractor is broken, not the tree`);
  // THE DECLARED LIST IS EMPTY, AND IT IS KEPT SO ON PURPOSE. Generalising this arm found three
  // offenders on main — the `fan-in` missing/collapsed/fabricated throws, all interpolating
  // `P.registerBand(a)` into `reason`. They were declared here rather than silently permitted, and
  // fixed under: the path moved to `detail`, which is where the reader who stats it
  // can still open it. The empty list keeps the machinery — a NEW offender is declared deliberately or
  // it reds, and a declaration that outlives its defect reds too.
  const DECLARED = [];
  const offenders = sites
    .map((stmt) => stmt.slice(0, stmt.indexOf("detail:") >= 0 ? stmt.indexOf("detail:") : stmt.length))
    .filter((reasonPart) => /\$\{P\.[A-Za-z]/.test(reasonPart))
    .map((r) => r.split("\n")[0].slice(0, 120));
  const undeclared = offenders.filter((o) => !DECLARED.some((d) => o.includes(d)));
  // AND THE REVERSE ARM, so the exemption cannot outlive the defect. A declared site that stops
  // offending must be removed from the list in the same change that fixes it — otherwise the list keeps
  // itself alive and the next reader believes three defects exist that do not.
  const stale = DECLARED.filter((d) => !offenders.some((o) => o.includes(d)));
  assert.deepEqual(stale, [],
    `declared as a known offender but no longer offending — delete the entry in the change that fixed `
    + `it, or this list outlives what it describes: ${stale.join(", ")}`);
  assert.deepEqual(undeclared, [],
    "a path in `reason` is severed by the 200-char cap and the address a reader opens is a fragment. "
    + "`detail` is the field built for it — it reaches reasonDetail, both notices, and null on the "
    + `client view. Undeclared site(s):\n  ${undeclared.join("\n  ")}`);
});

test("#1406 no runner notice re-cuts a reason the status write beside it already marked", () => {
  // The sibling-writer half of the finding (/ rule, and criterion 4). routed the runner's
  // three TERMINAL STATUS writes through terminalReasonFields and left the failure PACKET built from the
  // same string still cutting it with a bare slice — including queue-reclaim, whose own comment two lines
  // above says the reason "NAMES THE ARTIFACT DIRECTORY at its end".
  const runner = source("driver/runner.mjs")
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  // The window, not a comma-delimited field: `reasonText.slice(0, 200)` CONTAINS a comma, so a
  // [^,]+ capture stops at "reasonText.slice(0" and the guard reads clean over the exact defect it
  // is here to catch. Measured — that first draft stayed green against origin/main.
  const offenders = [...runner.matchAll(/shortReason:/g)]
    .map((m) => runner.slice(m.index, m.index + 80).split("\n")[0])
    .filter((window) => /\.slice\(0,\s*\d+\)/.test(window));
  assert.deepEqual(offenders, [],
    `these hand a re-cut reason to buildFailurePacket while a marked one is already in scope:\n  ${offenders.join("\n  ")}`);
});

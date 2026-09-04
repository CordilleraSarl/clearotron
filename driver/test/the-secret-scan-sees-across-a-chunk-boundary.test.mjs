// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A CREDENTIAL STRADDLING A CHUNK BOUNDARY IS STILL FOUND.
//
// `ci.yml` calls the secret scan "a security record, not a progress bar". The pinned 8.18.4 read files
// in 10,000-byte chunks and TRUNCATED a match that straddled a boundary, then judged the fragment's
// entropy. Measured: the match's end pinned to absolute offset 10001 across five different paddings
// while its start moved, and the same at 20,000 and 30,000, byte-driven rather than line-driven.
//
// The consequence is a FALSE NEGATIVE. A 40-character high-entropy credential is missed ENTIRELY when
// the boundary falls within its first ~10 characters — the scan reports clean. That is why the pin
// moved, and this arm is why it cannot move back quietly.
//
// ── THIS ARM IS THE REASON, NOT A CELEBRATION OF THE FIX ──────────────────────────────────────────
//
// It fails on 8.18.4 and passes on 8.30.1. Read on a tree that has not had the binary swapped, its red
// is CORRECT and is the defect it describes: the scanner on this box cannot see the secret below.
//
// NO REAL CREDENTIAL IS USED OR NEEDED. The value is invented here, matches nothing, and never leaves
// the temporary directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BOUNDARY = 10_000;
const SECRET = ["Zq7Z", "4mK9pR2vX8nL", "5tW3yB6cF1dH", "0jS4aG7eU2iO"].join("");   // 40 chars, invented
const PREFIX = 'const apiKey = "';

/** A file whose SECRET straddles `BOUNDARY`, with `cut` of its characters below the line. */
function straddleFile(cut) {
  const secretAt = BOUNDARY - cut;
  const headLen = secretAt - PREFIX.length;
  const unit = "// " + "f".repeat(76) + "\n";                 // 80 bytes
  let head = unit.repeat(Math.floor(headLen / 80));
  const rem = headLen - head.length;
  head += rem >= 3 ? "//" + "p".repeat(rem - 3) + "\n" : "x".repeat(rem);
  const text = head + PREFIX + SECRET + '";\n// tail\n';
  // ABORT RATHER THAN MEASURE THE WRONG THING. A corpus that does not actually straddle proves nothing,
  // and would pass on the broken scanner — the shape that makes a guard look like it works.
  const at = text.indexOf(SECRET);
  assert.equal(at, secretAt, `the secret landed at ${at}, not ${secretAt} — this file does not straddle`);
  assert.ok(at < BOUNDARY && BOUNDARY < at + SECRET.length, "the boundary is not inside the secret");
  return text;
}

test("#1948 a credential straddling a 10,000-byte chunk boundary is found, not truncated away", (ctx) => {
  let version = null;
  try { version = execFileSync("gitleaks", ["version"], { encoding: "utf8" }).trim(); }
  catch { return ctx.skip("gitleaks is not on PATH — could not look, which is not a pass"); }

  const dir = mkdtempSync(join(tmpdir(), "gl-straddle-"));
  try {
    writeFileSync(join(dir, ".gitleaks.toml"), "[extend]\nuseDefault = true\n");
    // Several cut positions: the miss is worst when the boundary falls in the secret's first few
    // characters, and a single position would pass on a scanner that only truncates sometimes.
    for (const cut of [3, 6, 10]) writeFileSync(join(dir, `cut${cut}.js`), straddleFile(cut));
    // The control: the same secret nowhere near a boundary. If THIS is missed, the arm is measuring a
    // scanner that finds nothing at all rather than one that truncates.
    writeFileSync(join(dir, "control.js"), "// x\n".repeat(200) + PREFIX + SECRET + '";\n');

    // ✕ THE REPORT GOES TO A FILE, NOT TO `/dev/stdout`.
    //
    // `--report-path /dev/stdout` works in a shell and FAILS under a captured pipe — gitleaks exits
    // with `open /dev/stdout: no such device or address` and writes nothing. The first cut then did
    // `catch { out = e.stdout || "[]" }`, which turns a scanner that never ran into ZERO FINDINGS.
    //
    // The control below is what caught it: without it this arm would have gone red reporting a
    // truncation defect on a run where the scanner produced nothing at all — the right answer for the
    // wrong reason, which is worse than a wrong answer because nobody re-checks it.
    const report = join(dir, "report.json");
    let ran = true;
    try {
      execFileSync("gitleaks",
        ["detect", "--source", dir, "--no-git", "--report-format", "json", "--report-path", report],
        { encoding: "utf8", stdio: "ignore" });
    } catch (e) {
      // Exit 1 means findings — expected. Anything else is the scanner failing to run.
      if (e.status !== 1) ran = false;
    }
    let found;
    try { found = new Set(JSON.parse(readFileSync(report, "utf8") || "[]").map((f) => String(f.File).split("/").pop())); }
    catch { ran = false; }
    if (!ran) return ctx.skip(`gitleaks ${version} produced no readable report — could not look, which is not a pass`);

    assert.ok(found.has("control.js"),
      `gitleaks ${version} missed the CONTROL, which sits nowhere near a boundary. The arm below would `
      + "then be measuring a scanner that finds nothing, not one that truncates");
    const missed = ["cut3.js", "cut6.js", "cut10.js"].filter((f) => !found.has(f));
    assert.deepEqual(missed, [],
      `gitleaks ${version} MISSED a 40-character high-entropy credential in: ${missed.join(", ")}.\n\n`
      + `Each file contains the secret in full; the ${BOUNDARY}-byte chunk boundary falls inside its `
      + "first few characters, so the match is truncated and the FRAGMENT's entropy is judged. The scan "
      + "reports clean on a file that holds a credential.\n\n"
      + "8.18.4 fails this. 8.30.1 passes it. If this is red on a tree that pins 8.30.1, the binary on "
      + "this runner is not the pinned one — which the version check in ci.yml also refuses.");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

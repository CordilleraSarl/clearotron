#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// unexecuted-asserts.mjs — 's fifth member: an arm that RAN and asserted nothing.
//
//   node scripts/unexecuted-asserts.mjs <lcov>            # DRY RUN — prints what would change
//   node scripts/unexecuted-asserts.mjs <lcov> --apply    # writes it
//   node scripts/unexecuted-asserts.mjs <lcov> --check    # prints the same, and EXITS 1 if it GREW
//
// ── WHY A SECOND CENSUS, WHEN suite-census.json EXISTS ──────────────────────────────────────────────
//
// measured five ways a guard stops guarding without being deleted. Four of them — DELETED,
// RENAMED, GUTTED, SKIPPED — move the file's TEXT, and `driver/suite-census.json` catches all four by
// counting it. The fifth does not move a token:
//
//     test("…", () => {
//       if (!process.env.NEVER_SET) return;   // gated: never runs
//       …every assert. line still textually present…
//     });
//
// The test site is counted, the assert sites are counted, the suite reports it PASSING, and
// `mint-suite-census.mjs --check` exits 0. Measured on this repo, planting exactly that: census blind,
// suite green. A parser cannot know whether a line ran, so nothing textual can close this member — it
// needs the one question only a run can answer, WAS THIS LINE EVER EXECUTED.
//
// `node --test --experimental-test-coverage` answers it per line and needs no instrumentation of the
// asserts themselves. This reads that lcov and asks it of the assert sites `shared/suite-census.mjs`
// already knows how to find. ONE rule for what an assert site is, shared with the census, so the two
// censuses cannot disagree about what they are counting.
//
// ── AN LCOV FROM ANOTHER TREE IS REFUSED, NOT REPORTED ──────────────────────────────────────────────
//
// The line numbers in a coverage file belong to the tree that produced it. Read against a tree that has
// moved, an assert site that simply did not exist yet has no coverage record — and a missing record
// defaulted to "not executed" reads as a finding, while defaulted to "executed" reads as a pass. Both
// are lies about a file nobody measured.
//
// Measured, on a tree three commits ahead of its lcov: 20 sites with no record, in exactly the three
// files that had changed, alongside the 42 genuinely-unexecuted ones. Silently folding those together
// is a 48% error in the direction that manufactures findings.
//
// So a missing record is a REFUSAL with the files named. On a matching tree there are none, which is
// what makes the refusal cheap and the signal trustworthy.
//
// ── THE COUNTS ARE A CEILING, AND SHRINKING IS NOT A FINDING ────────────────────────────────────────
//
// 42 sites across 22 files never execute on a clean run today, and every one measured so far is an
// honest branch — an arm that asserts one thing when a platform check goes one way and another when it
// goes the other. That is a baseline, not a defect list. What must not happen is GROWTH nobody read:
// a new never-executed site is either a new honest branch (re-stamp, deliberately) or an arm that has
// stopped asserting (the thing this exists to find).
//
// Deliberate re-stamp, dry run by default, for the same reason `mint-suite-census.mjs` is: this file is
// a ceiling somebody could quietly raise, and raising it is how a gating would be laundered into a green
// suite. `--apply` is one flag, and the diff it prints first is the review.
//
// ── WHAT THIS CANNOT SEE, said here because a tool gets trusted more than a comment ─────────────────
//
// · COVERAGE IS PER LINE, so an assert sharing a line with something that DID run reads as executed.
//   `for (const r of rows) assert.ok(r.ok);` — head and body on one line — is invisible: the head runs.
//   Braced, the assert has its own line and is seen. Nearly every assert in this suite is already on
//   its own line, so the hole is narrow, and it is the same kind of hole a comment is for the text
//   census. Measured: the first version of the arm that proves this was written the one-line way and
//   passed for the wrong reason.
// · IT IS NOT THE ONLY GUARD ON THIS MEMBER AND DOES NOT CLAIM TO BE. ``'s `topLevelBails` already
//   catches a top-level `if (…) return;` in a test arm, and `discoveredLoops` catches a loop over a
//   discovered set that was never asserted non-empty. Both read the text, so both are bounded by the
//   spellings somebody enumerated; this one needs no spelling. Defence in depth, not a replacement.
// · AN ARM THAT EXECUTES A WRONG ASSERTION IS NOT THIS INSTRUMENT'S BUSINESS. It answers "did this line
//   run", never "did it check anything worth checking".

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSiteLines } from "../shared/suite-census.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CENSUS = join(ROOT, "driver", "unexecuted-asserts.json");

const README = [
  "#1010's FIFTH MEMBER — an arm that ran and asserted nothing. The other four move the file's text and",
  "driver/suite-census.json counts it; a GATED arm — an early return behind a condition nobody satisfies —",
  "moves no token at all, so the suite passes, the census passes, and the arm asserts nothing.",
  "",
  "(The shape is spelled out in the module header and in driver/test/unexecuted-asserts.test.mjs. It is",
  "deliberately NOT written as a literal here: this text is minted into a tracked file under driver/, and",
  "the env catalogue reads an `env.<NAME>` in product code as a variable somebody must document. It cost",
  "three red ratchets to find that out.)",
  "",
  "Minted from a coverage pass by scripts/unexecuted-asserts.mjs, over the assert sites",
  "shared/suite-census.mjs defines — ONE rule, so the two censuses cannot disagree about what they count.",
  "",
  "A CEILING PER FILE. Growth is what must be read: a new honest branch is re-stamped deliberately, an arm",
  "that stopped asserting is the defect this exists to find. A file that SHRINKS never fails — a cure is",
  "not a finding, and a census that fails on an honest refactor gets deleted.",
  "",
  "THE 42 SITES IN THE FIRST BASELINE WERE READ, AND THEY ARE NOT ALL ONE THING. Recorded because a",
  "baseline shipped as 'all honest' would freeze a real one in place forever, which is this member's own",
  "defect committed by its own bookkeeping:",
  "",
  "  24  honest branches — a platform check, a mode the public checkout does not run, an error path that",
  "      must not fire, an else nobody took. Both sides usually documented at the site.",
  "  12  arms whose whole SUBJECT is an empty table — WITHHELD_ON_PURPOSE, REGISTER_UNGRANTED_ON_PURPOSE,",
  "      TOOL_FREE_STAGES are all `{}` today, deliberately. The arms are ratchets waiting for a row and",
  "      they assert nothing until one arrives. Not defects; not coverage either.",
  "   2  a loop whose every element is skipped by a `continue` (record-discard), so the arm's own",
  "      fixture-sanity assertion passes and the checks it exists for never run.",
  "   4  a comment at the site says the branch IS taken and it is not (portal-service's grants file,",
  "      profiles-page's anon config). The comment is the claim; the coverage is the measurement.",
  "",
  "The last two groups are the instrument's first findings and are ON #1010's thread, not fixed here.",
  "",
  "RE-STAMP DELIBERATELY:  npm run assert-census -- <lcov> --apply",
];

/** `SF:` → { line → hits }, for the test files only. Paths are as the run emitted them. */
export function parseLcov(text) {
  const out = new Map();
  let cur = null;
  for (const line of String(text ?? "").split("\n")) {
    if (line.startsWith("SF:")) { cur = line.slice(3).trim(); if (!out.has(cur)) out.set(cur, new Map()); }
    else if (line.startsWith("DA:") && cur) {
      const [n, c] = line.slice(3).trim().split(",");
      out.get(cur).set(Number(n), Number(c));
    }
  }
  return out;
}

/**
 * Per test file: how many of its assert sites never ran, and how many the lcov cannot speak for.
 *
 * `resolve` maps an lcov path to a path on disk; a file the lcov names and the tree does not have is
 * skipped rather than guessed at — that is a deleted test, which suite-census.json is the guard for.
 */
export function unexecuted(lcov, { resolve }) {
  const never = {}, unknown = {};
  for (const [sf, hits] of lcov) {
    if (!sf.endsWith(".test.mjs")) continue;
    const abs = resolve(sf);
    if (!abs || !existsSync(abs)) continue;
    const sites = assertSiteLines(readFileSync(abs, "utf8"));
    const key = sf.replace(/^.*\/test\//, "").replace(/^test\//, "");
    const miss = sites.filter((n) => !hits.has(n)).length;
    const zero = sites.filter((n) => hits.get(n) === 0).length;
    if (miss) unknown[key] = miss;
    if (zero) never[key] = zero;
  }
  return { never, unknown };
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const CHECK = args.includes("--check");
const lcovPath = args.find((a) => !a.startsWith("--"));

if (isEntrypoint(import.meta.url)) {
  if (!lcovPath) { console.error("usage: node scripts/unexecuted-asserts.mjs <lcov> [--apply|--check]"); process.exit(2); }
  if (!existsSync(lcovPath)) {
    // AN ABSENCE IS A FINDING. A missing coverage file means the run that was supposed to produce it did
    // not, and reporting "nothing unexecuted" here would be the cleanest possible way to say nothing.
    console.error(`unexecuted-asserts: ${lcovPath} does not exist — the coverage run did not produce it, so `
      + "there is nothing to check and this is a failure, not a clean result.\n\n"
      + "  CT_COVERAGE_DIR=/tmp/cov npm run test:full     # writes /tmp/cov/driver.lcov");
    process.exit(2);
  }
  const lcov = parseLcov(readFileSync(lcovPath, "utf8"));
  const driver = join(ROOT, "driver");
  const { never, unknown } = unexecuted(lcov, {
    resolve: (sf) => (sf.startsWith("/") ? sf : join(driver, sf)),
  });

  const unknownFiles = Object.keys(unknown).sort();
  if (unknownFiles.length) {
    console.error(`unexecuted-asserts: REFUSING — ${lcovPath} does not describe this tree.\n`
      + `${unknownFiles.length} file(s) carry assert sites the coverage run never saw:\n`
      + unknownFiles.map((f) => `  ${f}  (${unknown[f]} site(s))`).join("\n")
      + "\n\nThe line numbers in a coverage file belong to the tree that produced it. Re-run the suite with\n"
      + "coverage on THIS tree; a stale lcov manufactures findings in one direction and hides them in the other.");
    process.exit(2);
  }

  const on = existsSync(CENSUS) ? JSON.parse(readFileSync(CENSUS, "utf8")) : { files: {} };
  const was = on.files ?? {};
  const grew = Object.keys(never).filter((f) => (never[f] ?? 0) > (was[f] ?? 0)).sort();
  const shrank = Object.keys(was).filter((f) => (never[f] ?? 0) < was[f]).sort();
  const total = Object.values(never).reduce((a, b) => a + b, 0);

  console.log(`unexecuted-asserts: ${total} assert site(s) never ran, across ${Object.keys(never).length} file(s)`);
  for (const f of grew) console.log(`  GREW    ${f}  ${was[f] ?? 0} → ${never[f]}`);
  for (const f of shrank) console.log(`  shrank  ${f}  ${was[f]} → ${never[f] ?? 0}`);
  if (!grew.length && !shrank.length) console.log("  (unchanged)");

  if (APPLY) {
    writeFileSync(CENSUS, `${JSON.stringify({ _README: README, files: Object.fromEntries(Object.entries(never).sort()) }, null, 2)}\n`);
    console.log(`re-stamped ${relative(ROOT, CENSUS)}`);
  } else if (CHECK && grew.length) {
    // THE REMEDY IS THE WHOLE COMMAND, not a placeholder. Whoever this fires on has probably never heard
    // of CT_COVERAGE_DIR — it is set in ci.yml and nowhere a contributor reads — so `<lcov>` sends them to
    // the workflow file to find out what to substitute. A guard whose remedy has to be looked up is a
    // guard people delete ('s own rule, applied to its own error message).
    console.error(`\nCHECK FAILED — ${grew.length} file(s) grew an assert site that never ran.\n\n`
      + "READ EACH ONE FIRST. An arm that stopped asserting is the defect this exists to find (#1010);\n"
      + "a new honest branch — a platform check, an else nobody takes here — is re-stamped deliberately:\n\n"
      + "  CT_COVERAGE_DIR=/tmp/cov npm run test:full\n"
      + "  npm run assert-census -- /tmp/cov/driver.lcov --apply\n\n"
      + "The re-stamp needs a coverage pass on THIS tree: run them in that order, not one alone.");
    process.exit(1);
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE ENGINE STEP WAS AN UNESCAPABLE LOOP FOR A READER WHO PRESSED ENTER.
//
// The wizard's own header promises "Enter takes the default in brackets". On a box with no engine
// binary, taking it walked into: menu (default = an engine) → no binary → decline the install
// (default no) → decline the path (default no) → `continue` → the same menu, same default. Nothing
// differed between iterations. Measured under a PTY on a bare surface before the fix: fourteen
// identical cycles in forty Enters, killed at the cap, never reaching the register step.
//
// WHY THESE ARMS READ SOURCE. The escape is a control-flow shape inside a `for(;;)` that only runs
// behind a TTY, and the wizard refuses outright when stdin is not one. There is no value to assert
// and no seam to inject without routing around the branch under test. So these read `bin/onboard.mjs`
// — and every one of them was driven red by planting the regression it names, because an arm nobody
// has seen fail is a comment.
//
// The end-to-end evidence is the PTY transcript on the PR, not these arms. After the fix each of the
// three prompts appears exactly ONCE instead of fourteen times.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFileSync as _e } from "node:child_process";
import { readFileSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hermeticInstallRoot } from "./hermetic-install-root.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ONBOARD = join(REPO, "bin", "onboard.mjs");
const src = readFileSync(ONBOARD, "utf8");

// The branch under test: from the confirm that offers a path, to the line that reads one. Everything
// a reader who declines can meet lives in here.
const DECLINE = "Give the path to a";
const READS_A_PATH = 'await askValue("Absolute path:")';
function declinedPathBranch() {
  const from = src.indexOf(DECLINE);
  const to = src.indexOf(READS_A_PATH);
  // An anchor that has moved must ABORT, never fall through to a measurement over the wrong text —
  // a block that is not there reads as a block containing nothing, which passes every arm below.
  assert.notEqual(from, -1, `anchor missing: the confirm containing "${DECLINE}" is not in bin/onboard.mjs`);
  assert.notEqual(to, -1, `anchor missing: "${READS_A_PATH}" is not in bin/onboard.mjs`);
  assert.ok(to > from, "the path prompt no longer follows the confirm that offers it — re-aim these arms");
  return src.slice(from, to);
}

test("#1907 declining the path offers a way OUT, instead of returning to the same menu", () => {
  const branch = declinedPathBranch();
  assert.match(branch, /confirm\("Continue with no engine configured\?"/,
    "a reader who declines both offers must be asked whether to go on without an engine — "
    + "the menu's last row is the way out and it is invisible from the screen");
});

test("#1907 that exit's default is YES, because a NO default rebuilds the trap", () => {
  const branch = declinedPathBranch();
  assert.match(branch, /confirm\("Continue with no engine configured\?",\s*true\s*\)/,
    "Enter must take it. With a `false` default the reader presses Enter, answers no, and lands "
    + "back on the menu — the same loop wearing one more prompt");
});

test("#1907 the exit LEAVES the loop; it does not continue round it", () => {
  const branch = declinedPathBranch();
  const yes = branch.indexOf('confirm("Continue with no engine configured?"');
  assert.notEqual(yes, -1, "anchor missing: the exit confirm — re-aim this arm");
  const after = branch.slice(yes);
  assert.match(after, /break engine;/,
    "answering yes must break out of the labelled `engine:` loop; a `continue` here would print the "
    + "no-engine lines and then ask the same question again");
});

test("#1907 nothing in that branch can reach a continue before it has been offered the exit", () => {
  const branch = declinedPathBranch();
  const firstContinue = branch.indexOf("continue;");
  const exit = branch.indexOf('confirm("Continue with no engine configured?"');
  assert.notEqual(exit, -1, "anchor missing: the exit confirm — re-aim this arm");
  // Asserting a STRING ABSENCE here was the weaker arm and it was measured weaker: planting the
  // original defect back as `{ continue; }` rather than the one-line `)) continue;` left it green.
  // ORDER is the real invariant — a decline may only reach `continue` after being offered a way out.
  if (firstContinue !== -1) {
    assert.ok(exit < firstContinue,
      "a `continue` is reachable in this branch before the exit is offered — that is the defect, "
      + "whatever it is spelled like");
  }
});

test("#1907 what 'no engine' means is said in ONE place, so the two routes cannot drift", () => {
  const line = "No engine configured, and nothing engine-related will be written.";
  const hits = src.split(line).length - 1;
  assert.equal(hits, 1,
    `the no-engine wording appears ${hits} times; the menu's last row and the loop's escape must both `
    + "route through sayNoEngine(), or one of them will be reworded alone");
  assert.match(src, /const sayNoEngine = \(\) => \{/, "…and that one place is a named helper");
  const calls = src.split("sayNoEngine()").length - 1;
  assert.equal(calls, 2, `sayNoEngine() is called ${calls} time(s); both routes must use it`);
});

test("#1907 the fix did NOT move which engine Enter selects", () => {
  // The other way to end the loop is to default the menu onto the no-engine row. That also moves the
  // default on a box carrying the SECOND binary and not the first — a different vendor, and a proof
  // turn spent on it, chosen by a reader who pressed Enter. Not this defect's to decide.
  assert.match(src, /choose\("Which engine runs the reasoning stages\?", engineOptions\(\), 0\)/,
    "the engine menu's default index must stay a literal 0 — `onboard-wizard.test.mjs` fixes row 0 "
    + "as the production engine for the same reason");
});


// ──, THE REGISTER HALF — owner ruling 2026-08-26: `install` may finish with no register ────────
//
// Every row of PROVIDERS declares required credentials and the prompt had no way out, so a reader with
// no vendor account could not reach the closing screen. Driven end to end under the PTY, Enter at every
// prompt on a bare surface: before, sixty Enters and fifty-six identical `SIGNA_API_KEY:` prompts;
// after, the wizard exits 0 on its closing screen. That transcript is the evidence; these hold the
// pieces of it that a later edit could take away silently.

// A hermetic run of `doctor`: the shell this suite runs in has real credentials, and an inherited
// CLEAROTRON_DATABASE would make the no-register arm pass for the wrong reason.
const NODE_DIR = mkdtempSync(join(tmpdir(), "onboard-1907-node-"));
symlinkSync(process.execPath, join(NODE_DIR, "node"));
/**
 * Doctor, run against a repo root THIS FIXTURE owns.
 *
 * It used to run `join(REPO, "bin", "onboard.mjs")` — the developer's own checkout — so what doctor
 * reported about configuration was whatever that machine happened to have. Every CI runner has no
 * `<repo>/.env` and every real install has one, which is why the arm below passed in CI and failed on a
 * deployed box while both the build and the arm were correct.
 *
 * `CLEAROTRON_NO_ENV_FILE` cannot fix it and is not meant to: it governs whether `.env` CONFIGURES a
 * process, while doctor's job is to REPORT what that file contains. The state has to be established, not
 * flagged away — so `envFile` writes the `.env` this run should see, and null means none at all.
 */
function doctor({ envFile = null, ...env } = {}) {
  const { onboard } = hermeticInstallRoot(envFile);
  try {
    return { rc: 0, out: execFileSync(process.execPath, [onboard, "--check"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: `${NODE_DIR}:/usr/bin:/bin`, HOME: mkdtempSync(join(tmpdir(), "onboard-1907-home-")),
             CLEAROTRON_NO_ENV_FILE: "1", ...env },
    }) };
  } catch (e) { return { rc: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
}

test("#1907 doctor names the no-register state, and does not fail the install for being in it", () => {
  const { rc, out } = doctor();
  assert.match(out, /no register is selected/,
    "the owner's ruling is that this state is allowed; the doctor is what tells a reader they are in it");
  assert.match(out, /every search refuses until one is/,
    "…and what it costs, or the reader learns the state without learning the consequence");
  assert.match(out, /any one of them is enough, and none needs another/,
    "one register per install — a reader must not think they need a second");
  assert.equal(rc, 0,
    "an install that deliberately selected no register is UNFINISHED, not broken: `problem` here would "
    + "fail doctor on a posture setup was told to allow");
});

test("#1907 doctor does NOT say it when a register IS selected — the line is not unconditional", () => {
  // A control: without this, a line printed on every run would satisfy the arm above forever.
  const { out } = doctor({ envFile: { CLEAROTRON_DATABASE: "euipo" } });
  assert.doesNotMatch(out, /no register is selected/,
    "the no-register line must be conditional on there being no register");
});

test("#1907 the register credential is skippable, and the skip says what it costs", () => {
  assert.match(src, /askValue\(`\$\{k\}:`, \{ secret: true, skippable: true,/,
    "the required-credential prompt must offer a way out: a reader reaches it by picking a register, "
    + "never by choosing to supply a key, and the menu has no 'none' row");
  assert.match(src, /this install will have NO register selected\./,
    "…and the skip must state the consequence rather than passing silently");
});

test("#1907 a skipped credential leaves CLEAROTRON_DATABASE UNWRITTEN — half a register is not one", () => {
  const write = src.indexOf("candidate.CLEAROTRON_DATABASE = spec.id;");
  assert.notEqual(write, -1, "anchor missing: the CLEAROTRON_DATABASE write — re-aim this arm");
  // Search BACKWARD from the write, not forward from the top of the file. `src.indexOf("if
  // (registerSelected) {")` finds the FIRST such block, and there are several — it happens to be this
  // one today, and would silently become a different one the moment somebody added a guard above it.
  // An arm that passes by accident of ordering is the shape this repository keeps finding.
  const guard = src.lastIndexOf("if (registerSelected) {", write);
  assert.notEqual(guard, -1,
    "the selection must be written only after every required credential is in hand. Written at the menu "
    + "instead, it names an adapter with no credential and a run fails on the missing key rather than on "
    + "the honest fact that nobody picked a register");
  // Nothing may close that block between the guard and the write.
  assert.doesNotMatch(src.slice(guard, write), /\n  \}/,
    "the write must sit INSIDE the registerSelected block, not after it closes");
});

test("#1907 abandoning a register discards the credentials THIS step collected, and only those", () => {
  // Measured, not reasoned: a register with two required credentials — euipo, free-tier — let a reader
  // supply the first and skip the second, and the first was written to the .env with no
  // CLEAROTRON_DATABASE beside it. `candidate` is serialised wholesale at the write step, so anything
  // left in it ships. Driving the register menu's DEFAULT never reaches this: signa has one key.
  assert.match(src, /const collectedHere = \[\];/,
    "the step must track what it collected, or abandoning the selection cannot take it back");
  assert.match(src, /for \(const k of collectedHere\) delete candidate\[k\];/,
    "…and must actually remove them from the candidate the write step serialises");
  const del = src.indexOf("for (const k of collectedHere) delete candidate[k];");
  const push = src.indexOf("collectedHere.push(k);");
  assert.ok(push !== -1 && push < del, "anchors out of order — re-aim this arm");
  // The line that must NOT be crossed: an ambient credential was approved by name BEFORE any register
  // was chosen, so it is not this selection's to discard.
  const loop = src.slice(src.indexOf("for (const k of spec.credentials)"), del);
  assert.doesNotMatch(loop, /already adopted from your environment`\); collectedHere\.push/,
    "an adopted-from-environment credential must not join collectedHere: the reader approved it at a "
    + "step that runs before the register menu, and it stands for whichever register they pick later");
});

test("#1907 the wizard's own preflight is SKIPPED, not failed, when there is no provider to check", () => {
  const i = src.indexOf("Running the driver's own credential preflight");
  assert.notEqual(i, -1, "anchor missing: the preflight step — re-aim this arm");
  const before = src.slice(Math.max(0, i - 400), i);
  assert.match(before, /if \(registerSelected\) \{/,
    "this step checks the register provider and nothing else, so with none selected it has nothing to "
    + "check — and it used to abort setup on its last step with 'Nothing has been written'");
  assert.match(src, /Skipping the driver's credential preflight/,
    "and it must SAY it was skipped: a reader told a preflight passed, when it never ran, learns to "
    + "trust a line that means nothing");
  assert.match(src, /The run door still refuses by name until one is/,
    "…and that the run-door guard is untouched, which is the thing a reviewer will want to know");
});

test("#1907 the closing screen does not recommend a command that will refuse", () => {
  // RE-AIMED, NOT DELETED (tracker issue 2065). The heading was "Three commands from here" until the
  // owner's point 10 cut the screen to one command with what to expect; the clearance run moved to an
  // "Also" line. What this arm asserts is unchanged, because the property is unchanged — the last
  // screen a stranger reads must not recommend a command that will refuse without saying so.
  const i = src.indexOf("Start here:");
  assert.notEqual(i, -1, "anchor missing: the closing screen — re-aim this arm");
  const after = src.slice(i);
  assert.match(after, /if \(!registerSelected\) \{/,
    "the last screen a stranger reads prints a real clearance run; with no register that command refuses "
    + "at its door, and printing it unqualified moves this issue's failure one screen later");
  // NAMED, NOT NUMBERED. The warning used to say "the third command" and point into a numbered list.
  // A positional reference into copy somebody else will rewrite goes stale silently — this one did,
  // in the commit that cut the list — so the arm now requires the COMMAND to be named.
  assert.match(after, /clearotron run\\` will refuse at its door/,
    "…named specifically, because `demo` and `start` are unaffected and stay recommended");
});

test("#1907 the search-credential prompt is skippable, and both routes print ONE sentence", () => {
  // Re-aimed at 's derived loop: the Perplexity-only block became one prompt per
  // adapter row, so the property now holds for EVERY search credential by construction — the confirm
  // defaults YES (Enter walks into a key prompt the reader never chose unless the skip line exists),
  // and the skip sentence has one author used by both routes.
  const i = src.indexOf("API key now?`");
  assert.notEqual(i, -1, "anchor missing: the search-credential confirm — re-aim this arm");
  const block = src.slice(Math.max(0, i - 900), i + 900);
  assert.match(block, /skippable: true, skipped: skippedLine/,
    "this confirm defaults to YES, so Enter walks a reader into a key prompt they never chose");
  assert.equal(block.split("const skippedLine =").length - 1, 1,
    "the skip sentence is defined once and used by both routes; two copies drift the moment one is reworded");
});


// ── THE CLASS, NOT THE TWO INSTANCES ────────────────────────────────────────────────────────────────
//
// This file's other arms hold the engine menu and the register step — the two loops
// was filed about. They did not stop a THIRD arriving: `0ef1085` added
// `askValue("Public base URL for the pool (empty for none):", { def: "" })` one merge after this file
// landed, and nothing red. Enter yields "", `present("")` is false, the prompt is not skippable, so
// askValue loops on "A value is needed here." forever — on the one prompt whose own text promises empty
// is an answer.
//
// Measured on the merged tree before the fix: 60 enters, killed at the cap, every cycle that prompt.
// After: 11 enters, child exits 0 on its closing screen.
//
// So the arm is over the SOURCE and over every call, because the drive can only find the FIRST loop —
// a second one behind it is invisible until the first is fixed, which is exactly how this one hid.
test("tracker issue 1907 no askValue can be entered with an empty default and no way out", () => {
  const src = readFileSync(new URL("../../bin/onboard.mjs", import.meta.url), "utf8");

  // ANTI-VACUITY FIRST. If the call shape is ever renamed this scan finds nothing and an empty offender
  // list would read as clean — the same silence this whole issue is about.
  const calls = [...src.matchAll(/askValue\(/g)];
  assert.ok(calls.length >= 6,
    `only ${calls.length} askValue call(s) found — the scan is not reaching them, so an empty offender `
    + "list below would prove nothing");

  // A call is a TRAP when it declares an empty default and does not declare an escape. `def: ""` makes
  // Enter return "", which askValue rejects and re-asks; `skippable` is the only thing that turns that
  // into an answer.
  const offenders = [];
  for (const m of src.matchAll(/askValue\((?:[^()]|\([^()]*\))*\)/g)) {
    const call = m[0];
    if (!/def:\s*""/.test(call)) continue;
    if (/skippable:\s*true/.test(call)) continue;
    offenders.push(call.replace(/\s+/g, " ").slice(0, 120));
  }
  assert.deepEqual(offenders, [],
    "an askValue with an empty default and no `skippable` cannot be answered with Enter — it re-asks "
    + "forever. Either give it a real default, or mark it skippable so the brackets say so. This is the "
    + "shape that trapped a reader on the engine menu, and again on the pool URL one merge after the "
    + "menu was fixed.");
});

// ── 2191 F9 · THE SAME TRAP, ONE PROMPT OVER ────────────────────────────────────────────────────────
//
// closed the engine MENU against a reader pressing Enter. The re-probe prompt below it kept the
// shape: "Fixed it? Run the turn again" defaulted to YES, and the probe cannot succeed until the reader
// has signed in on another machine — so Enter re-ran a failing check forever. Measured at 19 attempts,
// no cap, in a wizard whose header says everything here is skippable.

const RETRY = 'confirm("Fixed it? Run the turn again"';

test("2191-F9 the re-probe's default is NO, because a YES default is the trap #1907 closed", () => {
  const at = src.indexOf(RETRY);
  // Anchor discipline, as above: a moved anchor ABORTS. A block that is not there reads as a block
  // containing nothing, and passes every assertion made over it.
  assert.notEqual(at, -1, `anchor missing: ${RETRY} is not in bin/onboard.mjs`);
  const call = src.slice(at, src.indexOf(")", at) + 1);
  assert.match(call, /,\s*false\s*\)/,
    "Enter must decline the retry. The probe cannot succeed until the reader signs in elsewhere, so a "
    + "YES default re-runs a check that is guaranteed to fail — and the header tells them Enter is safe");
});

test("2191-F9 declining says what it costs, and lands on the menu that has the way out", () => {
  const at = src.indexOf(RETRY);
  assert.notEqual(at, -1, `anchor missing: ${RETRY} is not in bin/onboard.mjs`);
  const branch = src.slice(at, at + 700);
  assert.match(branch, /continue engine/, "declining must return to the menu, not fall through as if proven");
  assert.match(branch, /no engine/,
    "and it must name the exit that already exists there — a reader who has just failed a probe twice "
    + "needs to be told they may stop, not left to find the last menu row themselves");
  assert.match(branch, /refuses by name/,
    "with what it costs stated where they decide, not discovered on a first real run");
});

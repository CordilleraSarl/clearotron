// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE REPORT EXISTED AND NOTHING A USER RUNS COULD REACH IT.
//
// shipped shared/doctrine-overlay.mjs and scripts/doctrine-report.mjs, and they worked. The
// criterion, though, names a COMMAND: "`clearotron doctor` reports the overlay". On the parent commit
// `grep -c "doctrine\|overlay" bin/clearotron.mjs` returned 0, `doctor` was `["bin/onboard.mjs",
// "--check"]`, and the report was reachable only as `npm run doctrine-report` — a name a self-hoster
// has no reason to type, appearing in no documented flow.
//
// I wrote that module, and I would have closed the issue on its presence. A component that is built and
// never wired passes every existence check and delivers nothing; the only thing that catches it is an
// arm that drives the COMMAND a user actually types. That is what the first test here does, and it is
// the one that fails on the parent commit — the module-level arms below would pass against the unwired
// tree exactly as they pass against this one.
//
// This asserts the doctor SAYS things. It does not re-test the report's own logic, which has its own
// nine arms in doctrine-overlay-report.test.mjs; duplicating them here would be two copies of one
// property, drifting apart.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Drive the command a user types, not the module behind it.
 *
 *  Takes the overlay VALUE and hands the variable's NAME to pinEnv as an argument. Written instead as a
 *  key in an env object literal, the name reads as a one-spelling pin to 's guard — correctly,
 *  because a textual guard cannot see that a helper spreads it through the alias table afterwards.
 *  Passing it as an argument is what the guard asks for and the shape that cannot quietly decay into a
 *  real one-spelling pin later. (Do not write the object-literal form in a comment here either: the
 *  guard reads comments too, which is how this note came to be worded around it.) */
function doctorWithSkillsOverlay(value) {
  const e = { ...process.env };
  pinEnv(e, "CLEAROTRON_INSTRUCTIONS_DIR", value);
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor"],
    { cwd: ROOT, env: e, encoding: "utf8" });
  // 2064 — the spawn's own fate before its text means anything: a child that never came back returns
  // empty output, and every assert downstream then fires with a message about the SUBJECT. Exit status
  // stays part of the verdict (this child says no by exiting non-zero); error/signal never is.
  if (r.error || r.signal) throw new Error(`the child did not come back (signal=${r.signal} error=${r.error?.message}) — a could-not-look, not a verdict`);
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

test("#1724 `clearotron doctor` REPORTS THE OVERLAY — the arm that fails on the unwired parent", () => {
  const out = doctorWithSkillsOverlay("");
  assert.match(out, /Doctrine overlay/,
    "the doctor must carry a doctrine section at all — on the parent commit it carried none, and the report "
    + "was reachable only through an npm script name nobody is told to type");
  assert.match(out, /doctrine overlay:/, "and it must be the report's own output, not a heading over nothing");
});

test("#1724 an install that overrides nothing says so in ONE line, as a NORMAL state", () => {
  const out = doctorWithSkillsOverlay("");
  assert.match(out, /none configured — this install overrides nothing/);
  assert.match(out, /normal, supported state/,
    "an unconfigured overlay is not a fault and must not read as one — most installs will never configure one");
  assert.ok(!/✗[^\n]*doctrine overlay/i.test(out), "and it must not be reported as a problem");
});

test("#1724 with an overlay configured the doctor names the counts and points at the full detail", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctrine-overlay-"));
  try {
    const skills = join(dir, "skills");
    mkdirSync(skills, { recursive: true });
    // One real override: copy a shipped doctrine file and change it, so the report has something to say.
    cpSync(join(ROOT, "driver", "skills", "README.md"), join(skills, "README.md"));
    writeFileSync(join(skills, "README.md"), "# overridden by this install\n");
    const out = doctorWithSkillsOverlay(skills);
    assert.match(out, /doctrine overlay: 1 overridden/, "the count of what this install overrides");
    assert.match(out, /npm run doctrine-report/,
      "and a pointer to the full report — the doctor summarises, it is not the only place the detail lives");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1724 the doctrine section REPORTS and never judges — drift is not a fault in the install", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctrine-judge-"));
  try {
    const skills = join(dir, "skills");
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(skills, "README.md"), "# overridden\n");
    const out = doctorWithSkillsOverlay(skills);
    // The section reports UNKNOWN drift (no recorded provenance point). That must not be a ✗: the user
    // overriding a doctrine file is a supported thing to do, and 's own rule is that the harness
    // records and does not judge.
    const section = out.split("Doctrine overlay")[1]?.split("Register provider")[0] ?? "";
    assert.ok(section.length > 0, "the section must exist to be judged");
    assert.ok(!section.includes("✗"),
      `drift must be reported, never flagged as a defect in the user's install. Section was:\n${section}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1724 an ABSENT overlay does not abort the check", () => {
  // RENAMED THIS ARM TO WHAT IT ACTUALLY TESTS. It was called "an UNREADABLE overlay is surfaced
  // …" and passed a MISSING directory, which `overlayReport` returns cleanly for (`ok:false`) — so the
  // doctor's catch block was never entered and the arm asserted that a NON-error does not abort the
  // run. Its own sibling comment drew the very line it was on the wrong side of. The real case is the
  // arm below.
  const out = doctorWithSkillsOverlay(join(tmpdir(), "doctrine-definitely-absent-1724"));
  assert.match(out, /Register provider/,
    "the sections after this one must still run — a check that aborts tells the reader least");
});

test("#1787 an UNREADABLE overlay is NAMED and the later sections still run", (ctx) => {
  // THE FIXTURE HAS TO THROW, and only a directory the process cannot READ does. A missing one returns
  // cleanly. chmod 000 on a scratch dir this test creates and removes — never a pool, archive or run
  // directory, whose set-GID a non-member chmod strips silently.
  const dir = mkdtempSync(join(tmpdir(), "doctrine-unreadable-"));
  const skills = join(dir, "skills");
  try {
    mkdirSync(skills, { recursive: true });
    chmodSync(skills, 0o000);

    // ROOT IGNORES MODE BITS. Under a root runner the fixture is readable, nothing throws, and this arm
    // would assert its way to a pass over a code path it never entered — the exact defect filed.
    // Prove the fixture is unreadable BEFORE trusting anything below it, and skip loudly if it is not.
    let unreadable = false;
    try { readdirSync(skills); } catch { unreadable = true; }
    if (!unreadable) return ctx.skip("chmod 000 did not make the fixture unreadable (running as root?) — "
      + "the throwing path cannot be reached here, and a pass would prove nothing");

    const out = doctorWithSkillsOverlay(skills);
    assert.match(out, /could not be read/,
      "the failure must be NAMED. A user runs doctor precisely when their configuration is already "
      + "wrong, and an unreadable overlay that says nothing is the worst version of that");
    assert.match(out, /Register provider/,
      "AND the sections after it must still run — one bad variable must not hide the engine, the "
      + "register provider and the credentials the reader came for");
  } finally {
    try { chmodSync(skills, 0o755); } catch { /* best effort, so the rm below can succeed */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

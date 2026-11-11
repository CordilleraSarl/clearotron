// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN ON AN INSTALL WITH NOTHING CHOSEN SAYS WHAT DOCTOR SAYS.
//
// Measured in a stranger walk of a beta, 2026-11-10: after setup with no AI and no register chosen, setup, doctor
// and the portal said "no AI is chosen", and `clearotron run` refused with "[preflight] the anthropic-agent engine
// cannot run: CLEAROTRON_CLAUDE_PATH (unset …)", naming a program nobody had chosen and not the missing register.
// A new run now refuses first, in doctor's sentence, from the composer doctor and the portal use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cannotSearchYet, commandLineRefusal } from "../run-requirements.mjs";
import { runTables } from "../order-tables.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCTORS = "This install cannot run a search yet: no AI is chosen and no register is chosen. Run `clearotron install` in a terminal to set it up.";

test("with no AI and no register chosen, the run's sentence is doctor's, word for word", async () => {
  assert.equal(cannotSearchYet("no AI is chosen and no register is chosen"), DOCTORS, "anti-vacuity: doctor's sentence has changed");
  assert.equal(commandLineRefusal({}, await runTables()), DOCTORS);
});

test("THE CONTROL: with an AI and a register chosen, the sentence names neither as missing", async () => {
  const said = commandLineRefusal({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_DATABASE: "euipo" }, await runTables());
  assert.ok(said === null || !/no AI is chosen|no register is chosen/.test(said), `named a choice that was made: ${said}`);
});

test("`clearotron run` on an install with nothing chosen refuses in doctor's words, and names no program", () => {
  const home = mkdtempSync(join(tmpdir(), "run-nothing-chosen-"));
  try {
    const job = join(home, "job.json");
    writeFileSync(job, JSON.stringify({ markName: "QUILLMERE", classes: [9, 42], jurisdictions: ["US"], product: "knockout-search",
      goods: "cloud software for weather analytics" }));
    const r = spawnSync(process.execPath, [join(REPO, "driver", "pipeline.mjs"), "--job", job], {
      encoding: "utf8", timeout: 120000,
      // The walk's machine: no `claude` on PATH and none installed by setup, so the old door named the program.
      env: { PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"), HOME: home, USERPROFILE: home, TMPDIR: home,
        CLEAROTRON_NO_ENV_FILE: "1", CLEAROTRON_ENGINES_DIR: join(home, "no-engines"),
        CLEAROTRON_REPORTS_DIR: join(home, "pool"), CLEAROTRON_WORK_DIR: join(home, "work") },
    });
    const said = `${r.stdout}${r.stderr}`;
    const lines = r.stderr.split("\n").filter((l) => l.startsWith("error:") || l.startsWith("nothing to resume"));
    assert.equal(r.status, 2, said);
    assert.match(lines[0] ?? "", /^error: This install cannot run a search yet: no AI is chosen and no register is chosen\. Run `[^`]*clearotron install` in a terminal to set it up\.$/, said);
    assert.match(lines[1] ?? "", /^nothing to resume: this stopped before the run had an identity/, said);
    assert.doesNotMatch(said, /anthropic-agent|CLEAROTRON_CLAUDE_PATH|\[preflight\]/, "the refusal still names a program nobody chose");
    const work = join(home, "work");
    assert.ok(!existsSync(work) || readdirSync(work).length === 0, "a run folder was made before the refusal");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a resume on the same install is not refused in doctor's words: a resumed run keeps the choices it froze", () => {
  // Design's condition on this refusal (2026-11-11): a resumed run's recorded engine and register stay
  // authoritative, so the order-time refusal is asked only of a NEW run. Here the resume names a run that does not
  // exist, so it must fail on its own terms, not on the install's current settings.
  const home = mkdtempSync(join(tmpdir(), "run-nothing-chosen-resume-"));
  try {
    const r = spawnSync(process.execPath, [join(REPO, "driver", "pipeline.mjs"), "--resume", "QUILLMERE-0000"], {
      encoding: "utf8", timeout: 120000,
      env: { PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"), HOME: home, USERPROFILE: home, TMPDIR: home,
        CLEAROTRON_NO_ENV_FILE: "1", CLEAROTRON_ENGINES_DIR: join(home, "no-engines"),
        CLEAROTRON_REPORTS_DIR: join(home, "pool"), CLEAROTRON_WORK_DIR: join(home, "work") },
    });
    const said = `${r.stdout}${r.stderr}`;
    assert.notEqual(r.status, 0, said);
    assert.match(said, /no run directory for --resume QUILLMERE-0000|cannot read the studio root/, `the resume did not fail on its own terms:\n${said}`);
    assert.doesNotMatch(said, /This install cannot run a search yet/, "a resume was refused on the install's current settings");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — every non-clean exit of the pipeline CLI ends with the command that picks the run back up.
//
// The resume machinery was never the gap: `--resume <codename>` re-drives a run and idempotency skips
// every stage whose output still validates. The gap was that three of the four bad terminals never
// printed the codename, so a reader was left with a failure and nothing to type — and a cold re-run of a
// multi-hour job is what that silence costs.
//
// resumeAdvice/resumeCommand are pure, so this covers all of it with no run dir and no spend. The three
// suppressions matter as much as the printing: a command that is known to fail, or that undoes the
// reader's own decision, is worse than no line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value

const require = createRequire(import.meta.url);

pinEnv(process.env, "CLEAROTRON_DATABASE", envFrom(process.env, "CLEAROTRON_DATABASE") || "corsearch");
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const { resumeAdvice, resumeCommand } = await import("../pipeline.mjs");

const SCRIPT = "/srv/app/driver/pipeline.mjs";
const JOB = "/srv/jobs/acme.json";   // neutral root: forbids naming an operator's home anywhere executable
const advise = (o) => resumeAdvice({ script: SCRIPT, jobPath: JOB, ...o });
const text = (o) => advise(o).join("\n");

test("the command is absolute, names the codename, and carries --agent only when one was given", () => {
  // Absolute because it is read hours later, possibly from another directory; a relative path that
  // resolved somewhere else would be a worse answer than none.
  assert.equal(resumeCommand({ script: SCRIPT, jobPath: JOB, codename: "tealkeystone" }),
    `node ${SCRIPT} --job ${JOB} --resume tealkeystone`);
  // --agent roots the run dir in that agent's workspace, so a resume without it looks in the wrong studio
  // and reports no live run dir.
  assert.equal(resumeCommand({ script: SCRIPT, jobPath: JOB, codename: "tealkeystone", agent: "lisa" }),
    `node ${SCRIPT} --job ${JOB} --agent lisa --resume tealkeystone`);
  assert.equal(resumeCommand({ script: SCRIPT, jobPath: JOB, codename: null }), null);
});

test("a clean run says nothing", () => {
  assert.deepEqual(advise({ result: { ok: true, verdict: "clear" } }), []);
});

test("TERMINAL FAILURE — the exit that had the identity on disk and printed none of it", () => {
  const out = text({ result: { ok: false, failedStage: "synthesis", reason: "x" }, codename: "tealkeystone" });
  assert.match(out, /--resume tealkeystone/);
  assert.match(out, /completed stages are skipped/);
});

test("RATE-LIMIT PARK — says it did not fail, what it waits on, and that it resumes itself", () => {
  const out = text({ result: { ok: false, postponed: true, resetsAt: "2026-08-12T18:00:00Z", fromStage: "register-sweep" }, codename: "tealkeystone" });
  assert.match(out, /rate limit/);
  assert.match(out, /2026-08-12T18:00:00Z/);
  assert.match(out, /nothing failed/);
  assert.match(out, /not the authority/);        // the sentinel's own resolvedBy sentence, not a second story
  assert.match(out, /runner\.mjs --watch/);      // the loop that resumes it where there is no systemd
  assert.match(out, /--resume tealkeystone/);
});

test("RECOVERY PARK — same terms, and it does not borrow the rate limit's prose", () => {
  const out = text({ result: { ok: false, postponed: true, recovery: true, attempt: 1, resetsAt: "2026-08-12T14:02:00Z" }, codename: "tealkeystone" });
  assert.match(out, /automatic recovery/);
  assert.ok(!/rate limit/.test(out), "a recovery park is not a provider cap — the 2026-07-28 postmortem misread exactly that");
  assert.match(out, /--resume tealkeystone/);
});

test("SIGNAL — the exit that used to print nothing at all", () => {
  const out = text({ signal: "SIGTERM", codename: "tealkeystone" });
  assert.match(out, /SIGTERM/);
  assert.match(out, /--resume tealkeystone/);
});

test("CANCELLED prints no command — a stopped run must not be invited back", () => {
  // The cancel terminal exists so someone who pressed Stop is never told their search broke, and the
  // runner's own scan skips `.cancelled` so no resume path can walk past that decision. A resume line
  // here would hand them the undo by accident.
  const out = advise({ result: { ok: false, cancelled: true, failedStage: "gather" }, codename: "tealkeystone" });
  assert.equal(out.length, 1);
  assert.match(out[0], /because you asked/);
  assert.ok(!/--resume/.test(out[0]));
});

test("RESUME-REFUSED-BECAUSE-DELIVERED prints no command — it would land on the same refusal", () => {
  // The identity exists here (opts.__runRef is set before the guard throws), so a naive "print whenever we
  // have a codename" rule produces a command already known to fail. The error text names --experiment.
  const err = new Error("resume refused: run tealkeystone already delivered");
  err.noResume = true;
  assert.deepEqual(advise({ error: err, codename: "tealkeystone" }), []);
});

test("a signal that lands AFTER delivery prints no command and parks nothing", () => {
  // A SIGTERM in the window between the `.delivered` commit and the process exiting would otherwise stamp
  // "parked-for-human" onto a run that succeeded — the zombie face A5 exists to end — and name it in a
  // resume command the resume guard refuses outright. `noResume` is how the CLI's delivered check says so.
  assert.deepEqual(advise({ signal: "SIGTERM", codename: "tealkeystone", noResume: true }), []);
  const fs = require("node:fs");
  const src = fs.readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  // the handler must consult the SAME two markers the resume guard consults
  assert.match(src, /const delivered = Boolean\(run\?\.runDir\) &&/);
  assert.match(src, /existsSync\(join\(run\.runDir, "\.delivered"\)\) \|\| existsSync\(driverDir\(run\.runDir, "delivery\.json"\)\)/);
  // — and it must not drift back to a hand-built path, which is what this assertion used to read.
  assert.doesNotMatch(src, /join\(run\.runDir, "_driver"/);
  assert.match(src, /if \(run\?\.runDir && !delivered\) \{/);
  assert.match(src, /noResume: delivered/);
});

test("--experiment prints no command — the sandbox never touched the canonical run", () => {
  assert.deepEqual(advise({ result: { ok: false }, codename: "tealkeystone", experiment: true }), []);
});

test("NO IDENTITY YET — an honest different message, not a command with a hole in it", () => {
  // The door preflights (tier sanity, engine binary, register credential) and the unresolvable-codename
  // guard all fire before a run dir exists. Their own error text is the remedy; this only has to stop the
  // reader hunting for a resume that was never possible.
  const out = advise({ error: new Error("missing register credential"), codename: null });
  assert.equal(out.length, 1);
  assert.match(out[0], /nothing to resume/);
  assert.match(out[0], /Fix the error above/);
  assert.ok(!/--resume/.test(out[0]));
  // …and a signal that lands there has no "error above" to point at.
  const sig = advise({ signal: "SIGINT", codename: null });
  assert.equal(sig.length, 1);
  assert.match(sig[0], /SIGINT arrived before the run had an identity/);
  assert.ok(!/error above/.test(sig[0]));
});

test("all four in-file terminals return the codename the CLI composes from", async () => {
  // Pre-fix the terminal-failure return was the odd one out: `{ ok:false, failedStage, reason, runDir }`
  // with no identity, at the one terminal where resuming is the entire remedy. A source read, because
  // reaching these returns for real costs a paid run.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const returns = [...src.matchAll(/return \{ ok: false,[^\n]*\}/g)].map((m) => m[0])
    .filter((r) => /runDir/.test(r));   // the run terminals, not the small helper returns
  assert.ok(returns.length >= 4, `expected the four run terminals, found ${returns.length}`);
  for (const r of returns) assert.match(r, /codename/, `a terminal with no identity strands its reader: ${r}`);
  const ko = fs.readFileSync(new URL("../pipeline-knockout.mjs", import.meta.url), "utf8");
  for (const r of [...ko.matchAll(/return \{ ok: false,[^\n]*\}/g)].map((m) => m[0]).filter((x) => /runDir/.test(x))) {
    assert.match(r, /codename/, `knockout terminal with no identity: ${r}`);
  }
});

test("the CLI reads the job file inside a guard — a path typo is an error line, not a stack trace", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /cannot read job file/);
  // and the parse must not sit bare at the top level again
  assert.ok(!/^  const job = JSON\.parse\(readFileSync\(a\.job, "utf8"\)\);$/m.test(src));
});

test("the CLI installs its signal handlers in the mainline block only", async () => {
  // Importing the runner's installStopHandlers here would stack listeners on every in-process test that
  // imports pipeline.mjs — the reason that function is documented as mainline-only.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  // — ANCHORED ON THE SANCTIONED FORM, not on a spelling. This used to indexOf the literal
  // `if (process.argv[1] && fileURLToPath(...) === process.argv[1]) {`, so converting pipeline.mjs to
  // isEntrypoint() made the search return -1 and this arm fail for a reason unrelated to signal
  // handlers. A test that pins one spelling of the thing it is locating breaks whenever that thing is
  // legitimately rewritten — and is a whole issue about exactly that.
  // — AND IT BROKE AGAIN, FOR THE SECOND TIME AND THE SAME REASON THE COMMENT ABOVE GIVES. The
  // anchor still pinned how the block OPENS — `)) {` — so detaching the CLI from module evaluation
  // (`)) void (async () => {`, which is what stopped every knockout run deadlocking) made this search
  // return -1 and this arm fail for a reason with nothing to do with signal handlers.
  //
  // What this test is LOCATING is the mainline guard. How the block after it opens is not its subject
  // and never was, so the anchor stops at the guard. `driver/test/a-run-that-cannot-settle-says-so.test.mjs`
  // is where the opening shape is pinned deliberately, because there it IS the subject.
  const entry = src.search(/if \(isEntrypoint\(import\.meta\.url\)\)/);
  assert.ok(entry > 0,
    "the mainline block was not found — pipeline.mjs must guard it with isEntrypoint(import.meta.url), "
    + "and if that changed again this anchor needs updating with it");
  const before = src.slice(0, entry);
  assert.ok(!/process\.on\("SIG/.test(before), "no signal listener may be installed on import");
  assert.match(src.slice(entry), /process\.on\(sig, \(\) => \{/);
  assert.ok(!/installStopHandlers/.test(src), "the runner's handler must not be imported here");
});
